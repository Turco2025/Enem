// robo/teste_local.mjs — ensaio do operário SEM rede e SEM gastar IA.
//
// Abre o index.html deste repositório num Chromium sem tela e chama a entrada de automação
// (window.enemAutomacao) exatamente como o operário faz, mas com o backend simulado:
//   • generate-question devolve uma questão real arquivada (fixture) — com ou sem imagem;
//   • generate-image devolve a imagem dessa questão;
//   • Auth/REST do Supabase respondem o mínimo (usuário, sessão, arquivamento em "simulados");
//   • as bibliotecas de CDN (jsPDF, docx, supabase-js, Chart.js) vêm de arquivos locais.
// O que se verifica: parâmetros aplicados, geração concluída, PDF e DOCX válidos nas duas versões.
//
// Uso: node robo/teste_local.mjs [--fixture caminho.json] [--libs pasta] [--saida pasta]
//   (padrões: tests/fixtures/wa_operario/questoes_exemplo.json, robo/libs_locais, saída em pasta temporária)

import path from "node:path";
import os from "node:os";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { gerarNoApp, servirApp, log } from "./operario.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (nome, padrao) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : padrao; };
const FIXTURE = arg("--fixture", path.join(RAIZ, "tests", "fixtures", "wa_operario", "questoes_exemplo.json"));
const LIBS = arg("--libs", path.join(RAIZ, "robo", "libs_locais"));
const SAIDA = arg("--saida", null);

const fixture = JSON.parse(await readFile(FIXTURE, "utf8"));
const semImagem = structuredClone(fixture.sem_imagem.data);
const comImagem = structuredClone(fixture.com_imagem.data);
const imagemDataUrl = comImagem.visual.imagemDataUrl;
delete comImagem.visual.imagemDataUrl;   // o backend real devolve o prompt; a imagem vem de generate-image
// Gráfico e tabela de ensaio (recurso "misto", v18.36): a mesma questão sem imagem, com o visual que o
// backend devolveria para cada recurso (o app exige labels/datasets e colunas/linhas, respectivamente).
const comGrafico = structuredClone(semImagem);
comGrafico.recurso = "grafico";
comGrafico.visual = { tipo: "grafico", chartType: "bar", titulo: "Consumo de oxigênio (mL/min) por temperatura", labels: ["10 °C", "20 °C", "30 °C"], datasets: [{ label: "Consumo", data: [12, 25, 48] }], descricao: "Gráfico de barras do consumo de oxigênio em três temperaturas.", fonte: "Dados hipotéticos para o ensaio." };
const comTabela = structuredClone(semImagem);
comTabela.recurso = "tabela";
comTabela.visual = { tipo: "tabela", titulo: "Concentração de gases (%)", colunas: ["Gás", "Ar inspirado", "Ar expirado"], linhas: [["O₂", "21", "16"], ["CO₂", "0,04", "4"], ["N₂", "78", "78"]], descricao: "Tabela com a composição do ar inspirado e expirado.", fonte: "Dados hipotéticos para o ensaio." };
const questaoPara = (recurso) => recurso === "imagem" ? comImagem : recurso === "grafico" ? comGrafico : recurso === "tabela" ? comTabela : semImagem;

const LIB_URLS = {
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js": "jspdf.umd.min.js",
  "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js": "docx.umd.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js": "supabase.js",
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.0/chart.umd.min.js": "chart.umd.js",
};
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwtFalso = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "u-teste", aud: "authenticated", role: "authenticated", email: "teste@exemplo.local", exp: Math.floor(Date.now() / 1000) + 3600 })}.assinatura`;
const USUARIO = { id: "u-teste", aud: "authenticated", role: "authenticated", email: "teste@exemplo.local", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };

let chamadasQuestao = 0, chamadasImagem = 0, chamadasPlanejar = 0, simuladosGravados = 0, logoutsRecebidos = 0;
async function instalarMocks(context) {
  for (const [url, arquivo] of Object.entries(LIB_URLS)) {
    const corpo = await readFile(path.join(LIBS, arquivo));
    await context.route(url, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: corpo }));
  }
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 404, body: "" }));
  await context.route(/^https:\/\/gkceyrkdmnhgqimmrsre\.supabase\.co\//, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (o, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(o) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (u.pathname === "/auth/v1/user") return json(USUARIO);
    if (u.pathname === "/auth/v1/token") return json({ access_token: jwtFalso, refresh_token: "refresh-teste", token_type: "bearer", expires_in: 3600, user: USUARIO });
    if (u.pathname === "/auth/v1/logout") { if (u.searchParams.get("scope") === "local") logoutsRecebidos++; return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" }, body: "" }); }
    if (u.pathname.startsWith("/auth/v1/")) return json({});
    if (u.pathname === "/rest/v1/simulados") {
      if (req.method() === "POST") {
        simuladosGravados++;
        const umObjeto = /vnd\.pgrst\.object/.test(req.headers()["accept"] || "");   // .single() do supabase-js pede um objeto, não uma lista
        return json(umObjeto ? { id: "11111111-2222-4333-8444-555555555555" } : [{ id: "11111111-2222-4333-8444-555555555555" }], 201);
      }
      return json([]);
    }
    if (u.pathname.startsWith("/rest/v1/rpc/")) return json([]);
    if (u.pathname.startsWith("/rest/v1/")) return json([]);
    if (u.pathname === "/functions/v1/generate-question") {
      if (!(req.headers()["authorization"] || "").startsWith("Bearer ")) return json({ error: "Faça login para gerar questões." }, 401);
      let corpo = {}; try { corpo = JSON.parse(req.postData() || "{}"); } catch { /* vazio */ }
      if (corpo.planejarRecortes) { chamadasPlanejar++; return json({ recortes: [], uso: { chamadas: 1, entradaNova: 100, cacheEscrito: 0, cacheLido: 0, saida: 50, custoUSD: 0.001 } }); }
      chamadasQuestao++;
      await new Promise((r) => setTimeout(r, 150));
      const q = structuredClone(questaoPara(corpo.recurso));
      q.tema = `${corpo.tema || q.tema} (${chamadasQuestao})`;   // temas distintos, como numa leva real
      /* v18.37 — História: resposta do fluxo direto (backend v74.33), questão autoral sem auditor,
         com uma reescrita em código — para provar os avisos novos da tela. */
      if (corpo.disciplina === "História") {
        q.disciplina = "História"; q.area = "humanas";
        q.fonte = { tipoUso: "proprio", autor: "", instituicao: "", obra: "", ano: "", referencia: "", comoVerificou: "texto autoral do elaborador", conferidoNaFonte: false, urlVerificacao: "" };
        return json({ question: q, uso: { chamadas: 2, entradaNova: 1500, cacheEscrito: 0, cacheLido: 18000, saida: 1900, buscasWeb: 0, custoUSD: 0.03 },
          fontesDiag: { aplicavel: true, estado: "aprovado", auditor: "dispensado_fluxo_direto", chamadas: 0, pesquisaPrevia: false, reelaboracoes: 1, tentativa: 1, doBanco: false, fluxoDireto: { modo: "autoral", auditor: "dispensado", reelaboracoesMax: 1 } } });
      }
      return json({ question: q, uso: { chamadas: 3, entradaNova: 2000, cacheEscrito: 0, cacheLido: 25000, saida: 1800, buscasWeb: 0, custoUSD: 0.02 }, fontesDiag: { estado: "ok", doBanco: true } });
    }
    if (u.pathname === "/functions/v1/generate-image") {
      if (!(req.headers()["authorization"] || "").startsWith("Bearer ")) return json({ error: "Faça login para gerar imagens." }, 401);
      chamadasImagem++;
      await new Promise((r) => setTimeout(r, 100));
      return json({ imageDataUrl: imagemDataUrl, uso: { qualidade: "low", segundos: 9, tokensEntrada: 100, tokensSaida: 272, custoUSD: 0.011, bytesImagem: 90000 } });
    }
    return json({ error: "rota não simulada: " + u.pathname }, 500);
  });
}

function confere(cond, msg) { if (!cond) throw new Error("FALHOU: " + msg); log("PASS", msg); }
function contaPaginasPdf(bytes) { return (bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length; }
async function listaDocx(bytes) {   // nomes dos arquivos dentro do .docx (zip), sem dependências
  const nomes = []; const s = bytes;
  let i = 0;
  while ((i = s.indexOf("PK\x03\x04", i, "latin1")) >= 0) {
    const nLen = s.readUInt16LE(i + 26), eLen = s.readUInt16LE(i + 28);
    nomes.push(s.toString("utf8", i + 30, i + 30 + nLen)); i += 30 + nLen + eLen;
  }
  return nomes;
}

async function cenario(browser, urlApp, nome, parametros, esperado) {
  log(`\n=== cenário: ${nome} ===`);
  chamadasQuestao = 0; chamadasImagem = 0; chamadasPlanejar = 0; simuladosGravados = 0; logoutsRecebidos = 0;
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  await instalarMocks(context);
  const page = await context.newPage();
  const errosPagina = [];
  page.on("pageerror", (e) => errosPagina.push(e.message));
  try {
    const progressos = [];
    const r = await gerarNoApp({ page, url: urlApp, parametros, sessao: { access_token: jwtFalso, refresh_token: "refresh-teste" }, aoProgresso: (e) => progressos.push(e), limiteMs: 4 * 60 * 1000, intervaloMs: 1000 });
    confere(r.total === parametros.quantidade && r.prontas === parametros.quantidade && r.falhas.length === 0, `${parametros.quantidade} questões geradas e prontas`);
    confere(chamadasQuestao === parametros.quantidade, `backend de questões chamado ${parametros.quantidade}×`);
    confere(chamadasImagem === esperado.imagens, `backend de imagens chamado ${esperado.imagens}×`);
    confere(simuladosGravados === 1 && r.simuladoId === "11111111-2222-4333-8444-555555555555", `simulado arquivado em Meus Simulados (inserções: ${simuladosGravados}, id: ${r.simuladoId})`);
    confere(r.arquivos.length === 4 && ["pdf_aluno", "pdf_professor", "docx_aluno", "docx_professor"].every((k) => r.arquivos.some((a) => a.rotulo === k)), "4 arquivos: PDF/Word × aluno/professor");
    const estadoApp = await page.evaluate(() => ({ area: state.area, disciplina: state.disciplina, qty: state.qty, recursos: state.questions.map((q) => q.recurso), niveis: state.questions.map((q) => q.dificuldade), temas: state.questions.map((q) => q.tema), fase: enemAutomacao.estado().fase }));
    confere(estadoApp.area === parametros.area && estadoApp.disciplina === parametros.disciplina && estadoApp.qty === parametros.quantidade, "área, disciplina e quantidade aplicadas no app");
    if (esperado.recursos) confere(estadoApp.recursos.join() === esperado.recursos.join(), `recurso misto em rodízio: ${estadoApp.recursos.join(", ")}`);
    else confere(estadoApp.recursos.every((x) => x === parametros.recurso), `recurso "${parametros.recurso}" em todas as questões`);
    const contagem = { "Fácil": 0, "Médio": 0, "Difícil": 0 };
    estadoApp.niveis.forEach((n) => { contagem[n] = (contagem[n] || 0) + 1; });
    const esperada = esperado.contagem || parametros.contagem;
    confere(["Fácil", "Médio", "Difícil"].every((n) => contagem[n] === (esperada[n] || 0)), `níveis distribuídos conforme a contagem ${JSON.stringify(esperada)} (real: ${estadoApp.niveis.join(", ")})`);
    if (esperado.temas) confere(esperado.temas.every((t) => estadoApp.temas.includes(t)), `temas em rodízio: ${esperado.temas.join(" · ")}`);
    if (esperado.temasExatos) confere(new Set(estadoApp.temas).size === esperado.temasExatos, `exatamente ${esperado.temasExatos} temas distintos (vírgula dentro do tema preservada)`);
    if (esperado.textoNaTela) {   // v18.37 — avisos da auditoria local do card (só tela)
      const tela = await page.evaluate(() => document.body.innerText);
      for (const t of esperado.textoNaTela) confere(tela.includes(t), `a tela mostra "${t.slice(0, 70)}"`);
      for (const t of esperado.textoForaDaTela || []) confere(!tela.includes(t), `a tela NÃO mostra "${t.slice(0, 70)}"`);
    }
    confere(estadoApp.fase === "concluido", "fase final: concluido");
    for (const a of r.arquivos) {
      if (a.rotulo.startsWith("pdf")) {
        confere(a.bytes.subarray(0, 5).toString() === "%PDF-" && a.bytes.length > 20_000, `${a.rotulo}: é PDF (${Math.round(a.bytes.length / 1024)} KB)`);
        const paginas = contaPaginasPdf(a.bytes);
        confere(paginas >= esperado.minPaginas[a.rotulo], `${a.rotulo}: ${paginas} página(s)`);
        confere(a.nome.endsWith(a.rotulo === "pdf_aluno" ? "_aluno.pdf" : "_professor.pdf") && a.nome.startsWith("Simulado_ENEM_"), `${a.rotulo}: nome ${a.nome}`);
      } else {
        const nomes = await listaDocx(a.bytes);
        confere(a.bytes.subarray(0, 2).toString() === "PK" && nomes.includes("word/document.xml") && nomes.includes("[Content_Types].xml"), `${a.rotulo}: é DOCX válido (${Math.round(a.bytes.length / 1024)} KB, ${nomes.length} partes)`);
        if (parametros.recurso === "imagem" || parametros.recurso === "misto") confere(nomes.some((n) => /^word\/media\//.test(n)), `${a.rotulo}: contém as imagens`);
      }
    }
    if (esperado.professorMaior) {
      const pa = r.arquivos.find((a) => a.rotulo === "pdf_aluno"), pp = r.arquivos.find((a) => a.rotulo === "pdf_professor");
      confere(contaPaginasPdf(pp.bytes) > contaPaginasPdf(pa.bytes), "versão do professor tem mais páginas (gabarito e resoluções)");
    }
    confere(errosPagina.length === 0, "nenhum erro de JavaScript na página" + (errosPagina.length ? ": " + errosPagina.slice(0, 2).join(" | ") : ""));
    const saiu = await page.evaluate(() => enemAutomacao.encerrarSessao());
    confere(saiu === true && logoutsRecebidos >= 1, "encerrarSessao: saiu só desta sessão (POST /auth/v1/logout?scope=local)");
    if (SAIDA) {
      await mkdir(SAIDA, { recursive: true });
      for (const a of r.arquivos) await writeFile(path.join(SAIDA, `${nome}_${a.nome}`), a.bytes);
      log(`arquivos gravados em ${SAIDA}`);
    }
    return r;
  } finally { await context.close(); }
}

const app = await servirApp(RAIZ);
const browser = await chromium.launch({ headless: true });
try {
  await cenario(browser, app.url, "biologia_imagem", { area: "natureza", disciplina: "Biologia", quantidade: 3, temas_texto: "fotossíntese, respiração celular", contagem: { "Fácil": 1, "Médio": 1, "Difícil": 1 }, recurso: "imagem", nivel: "Mista" },
    { imagens: 3, minPaginas: { pdf_aluno: 2, pdf_professor: 3 }, professorMaior: true, temas: ["fotossíntese", "respiração celular"] });
  // tema com vírgula dentro ("Era Vargas, Estado Novo" é UM tema): a lista vai um por linha e o app mantém 2 itens
  await cenario(browser, app.url, "historia_sem_recurso", { area: "humanas", disciplina: "História", quantidade: 2, temas: ["Era Vargas, Estado Novo", "Guerra Fria"], temas_texto: "Era Vargas, Estado Novo; Guerra Fria", contagem: { "Fácil": 0, "Médio": 2, "Difícil": 0 }, recurso: "nenhum", nivel: "Médio" },
    { imagens: 0, minPaginas: { pdf_aluno: 1, pdf_professor: 2 }, professorMaior: true, temas: ["Era Vargas, Estado Novo", "Guerra Fria"], temasExatos: 2,
      textoNaTela: ["Fluxo direto (História): a biblioteca não tinha texto para o tema — texto-base autoral com dados reais", "sem auditor", "reelaborada 1× após a conferência em código"],
      textoForaDaTela: ["após o auditor", "ÚLTIMO RECURSO", "Fonte validada pelo agente validador"] });
  // contagem inconsistente → o app divide igualmente (2 fáceis, 1 média, 1 difícil… para 4: 2/1/1)
  await cenario(browser, app.url, "matematica_contagem_invalida", { area: "matematica", disciplina: "Matemática", quantidade: 4, temas_texto: "", contagem: { "Fácil": 9 }, recurso: "nenhum", nivel: "Mista" },
    { imagens: 0, minPaginas: { pdf_aluno: 1, pdf_professor: 2 }, professorMaior: true, contagem: { "Fácil": 2, "Médio": 1, "Difícil": 1 } });
  // recurso "misto" (v18.36): rodízio de quatro — sem recurso, imagem, tabela, gráfico, sem recurso… — e os 4 arquivos saem com tudo
  await cenario(browser, app.url, "biologia_misto", { area: "natureza", disciplina: "Biologia", quantidade: 5, temas_texto: "respiração", contagem: { "Fácil": 2, "Médio": 2, "Difícil": 1 }, recurso: "misto", nivel: "Mista" },
    { imagens: 1, minPaginas: { pdf_aluno: 2, pdf_professor: 3 }, professorMaior: true, recursos: ["nenhum", "imagem", "tabela", "grafico", "nenhum"] });
  // parâmetros inválidos → erro definitivo imediato
  log("\n=== cenário: parâmetros inválidos ===");
  const context = await browser.newContext(); await instalarMocks(context); const page = await context.newPage();
  let erro = "";
  try { await gerarNoApp({ page, url: app.url, parametros: { area: "quimica", disciplina: "Química", quantidade: 2 }, sessao: { access_token: jwtFalso, refresh_token: "r" }, limiteMs: 60_000, intervaloMs: 500 }); } catch (e) { erro = e.message; }
  confere(/^área inválida/.test(erro), `erro definitivo: ${erro}`);
  await context.close();
  log("\n>>> ensaio local do operário: tudo passou");
} finally {
  await browser.close();
  await app.fechar();
}

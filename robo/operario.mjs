// robo/operario.mjs — o operário do WhatsApp (etapa C).
//
// Roda no GitHub Actions (.github/workflows/wa-operario.yml), disparado na hora do pedido
// (repository_dispatch) ou pela varredura de 10 em 10 minutos (schedule). O que faz:
//   1. autentica no webhook com o token OIDC que o próprio GitHub emite para esta execução
//      (sem segredo guardado em lugar nenhum; o webhook confere repositório, branch, workflow e evento);
//   2. "pegar": recebe um pedido da fila (wa_trabalhos), um "dono" (identidade desta execução
//      sobre o pedido) e uma sessão do professor;
//   3. abre o aplicativo (o index.html deste repositório, servido em localhost) num Chromium
//      sem tela e chama window.enemAutomacao — a geração é a MESMA da tela: mesmas funções,
//      mesmo backend, mesmo PDF e DOCX;
//   4. "entregar": envia os 4 arquivos (PDF e Word, versões do aluno e do professor) ao
//      webhook, que os sobe para a Meta; "concluir": o webhook manda tudo ao professor.
// Em caso de erro, "falhou": o webhook devolve o pedido à fila (até 3 tentativas, com 10 min de
// espera) ou avisa o professor. Se outro robô retomar o pedido (sinal de vida perdido), este para.
//
// Nos registros desta execução (públicos, porque o repositório é público) só saem números,
// fases e tempos: nunca telefone, e-mail, tokens ou o conteúdo das questões.
//
// Uso local (desenvolvimento): OPERARIO_TOKEN=<segredo compartilhado> node robo/operario.mjs
// Variáveis: WEBHOOK_URL, TRABALHO_ID (opcional), MAX_PEDIDOS (padrão 3), LIMITE_MINUTOS (padrão 40),
//            ORCAMENTO_MINUTOS (padrão 95: tempo total que o job tem; só pega outro pedido se couber).

import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { AUDIENCIA_OIDC, log, dorme, curto, obterCredencial } from "./comum.mjs";

export const VERSAO_ROBO = "C1.0";
export { AUDIENCIA_OIDC, log, obterCredencial };
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBHOOK_URL = (process.env.WEBHOOK_URL || "https://gkceyrkdmnhgqimmrsre.supabase.co/functions/v1/whatsapp-webhook").replace(/\/+$/, "");
const TRABALHO_ID = (process.env.TRABALHO_ID || "").trim() || null;
const MAX_PEDIDOS = Math.max(1, Number(process.env.MAX_PEDIDOS) || 3);
const LIMITE_MS = Math.max(5, Number(process.env.LIMITE_MINUTOS) || 40) * 60 * 1000;
const ORCAMENTO_MS = Math.max(10, Number(process.env.ORCAMENTO_MINUTOS) || 95) * 60 * 1000;
const FOLGA_MS = 12 * 60 * 1000;   // instalação já feita; sobra para exportar, entregar e concluir
const ORDEM = ["pdf_aluno", "pdf_professor", "docx_aluno", "docx_professor"];
const INICIO_EXECUCAO = Date.now();
const transitorio = (status) => status === 500 || status === 503 || status === 504 || status === 429;   // 502 = recusa permanente da Meta (não repetir)

// Erro que significa "este pedido não é mais meu" (outro robô retomou): não chamar `falhou`.
export class PedidoPerdido extends Error { constructor(m) { super(m); this.name = "PedidoPerdido"; } }

export async function chamar(acao, corpo = {}, { tentativas = 3, timeoutMs = 90_000 } = {}) {
  let ultimo = null;
  for (let i = 1; i <= tentativas; i++) {
    try {
      const r = await fetch(`${WEBHOOK_URL}?operario=1`, {
        method: "POST", headers: { authorization: `Bearer ${await obterCredencial()}`, "content-type": "application/json" },
        body: JSON.stringify({ acao, ...corpo }), signal: AbortSignal.timeout(timeoutMs),
      });
      const texto = await r.text();
      let j = {}; try { j = JSON.parse(texto); } catch { j = { erro: curto(texto, 200) }; }
      if (transitorio(r.status) && i < tentativas) { ultimo = new Error(`${acao}: HTTP ${r.status} ${curto(j.erro || j.detalhe || "", 160)}`); await dorme(3000 * i); continue; }
      return { status: r.status, json: j };
    } catch (e) { ultimo = e; if (i < tentativas) await dorme(3000 * i); }
  }
  throw ultimo || new Error(`${acao}: sem resposta`);
}

async function entregar(trabalhoId, dono, arquivo, bytes, tentativas = 3) {
  let ultimo = null;
  for (let i = 1; i <= tentativas; i++) {
    try {
      const fd = new FormData();
      fd.append("acao", "entregar"); fd.append("trabalho_id", trabalhoId); fd.append("dono", dono); fd.append("rotulo", arquivo.rotulo); fd.append("nome", arquivo.nome);
      fd.append("arquivo", new Blob([bytes], { type: arquivo.mime }), arquivo.nome);
      const r = await fetch(`${WEBHOOK_URL}?operario=1`, { method: "POST", headers: { authorization: `Bearer ${await obterCredencial()}` }, body: fd, signal: AbortSignal.timeout(180_000) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      if (r.status === 409) throw new PedidoPerdido(`entregar ${arquivo.rotulo}: ${curto(j.erro || "pedido não é mais desta execução", 120)}`);
      if (r.status === 413) throw new Error(`arquivo grande demais para a entrega: ${arquivo.rotulo} com ${Math.round(bytes.length / 1048576)} MB`);
      if (transitorio(r.status) && i < tentativas) { ultimo = new Error(`entregar ${arquivo.rotulo}: HTTP ${r.status} ${curto(j.erro || "", 120)}`); await dorme(4000 * i); continue; }
      throw new Error(`entregar ${arquivo.rotulo}: HTTP ${r.status} ${curto(j.erro || "", 160)} ${curto(j.detalhe || "", 160)}`);
    } catch (e) { if (e instanceof PedidoPerdido || i === tentativas) throw e; ultimo = e; await dorme(4000 * i); }
  }
  throw ultimo;
}

// ---------------------------------------------------------------------------
// o aplicativo, servido em localhost a partir do index.html deste repositório
// ---------------------------------------------------------------------------
export async function servirApp(raiz = RAIZ) {
  const html = await readFile(path.join(raiz, "index.html"));
  const servidor = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(html); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const porta = servidor.address().port;
  return { url: `http://127.0.0.1:${porta}/index.html`, fechar: () => new Promise((r) => servidor.close(() => r())) };
}

// Erros de parâmetro não melhoram tentando de novo: o pedido falha na hora.
// (Erros vindos do navegador chegam como "page.evaluate: Error: …"; o prefixo é descartado.)
export function limpaMotivo(msg) {
  return String(msg || "").split("\n")[0].replace(/^page\.evaluate:\s*/i, "").replace(/^(Error|TypeError|RangeError):\s*/i, "").replace(/\s+at\s+\S.*$/, "").trim();
}
export function erroDefinitivo(msg) {
  return /^(área inválida|disciplina inválida|quantidade inválida|parâmetros ausentes|sessão incompleta|arquivo grande demais)/i.test(limpaMotivo(msg));
}

// ---------------------------------------------------------------------------
// gerar no app: entra com a sessão, roda a entrada de automação, acompanha e recolhe os arquivos
// ---------------------------------------------------------------------------
export async function gerarNoApp({ page, url, parametros, sessao, aoProgresso = null, limiteMs = LIMITE_MS, intervaloMs = 5000 }) {
  page.setDefaultTimeout(90_000);
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => globalThis.enemAutomacao && typeof globalThis.enemAutomacao.pronto === "function");
  await page.evaluate(() => globalThis.enemAutomacao.pronto());
  const versao = await page.evaluate(() => globalThis.enemAutomacao.versao);
  log(`app pronto (entrada de automação v${versao})`);
  await page.evaluate((s) => globalThis.enemAutomacao.entrarComSessao(s), { access_token: sessao.access_token, refresh_token: sessao.refresh_token });
  log("sessão do professor ativa no app");

  await page.evaluate((p) => {
    globalThis.__waResultado = null; globalThis.__waErro = null;
    globalThis.enemAutomacao.gerar(p).then((r) => { globalThis.__waResultado = r; }).catch((e) => { globalThis.__waErro = String((e && e.message) || e); });
  }, parametros);

  const inicio = Date.now();
  let ultimoBatimento = 0, ultimaFase = "";
  while (true) {
    await dorme(intervaloMs);
    const s = await page.evaluate(() => ({ pronto: !!globalThis.__waResultado, erro: globalThis.__waErro, estado: globalThis.enemAutomacao.estado() }));
    if (s.erro) throw new Error(s.erro);
    const e = s.estado || {};
    const fase = `${e.fase} ${e.prontas ?? 0}/${e.total ?? 0}` + (e.erros ? ` erros=${e.erros}` : "") + (e.imagensPendentes ? ` imagens=${e.imagensPendentes}` : "");
    if (fase !== ultimaFase) { log(`andamento: ${fase}`); ultimaFase = fase; }
    if (aoProgresso && Date.now() - ultimoBatimento > 60_000) {
      ultimoBatimento = Date.now();
      try { await aoProgresso(e); } catch (err) { if (err instanceof PedidoPerdido) throw err; log("batimento falhou:", curto(err.message, 120)); }
    }
    if (s.pronto) break;
    if (Date.now() - inicio > limiteMs) throw new Error(`tempo esgotado após ${Math.round(limiteMs / 60000)} min (${fase})`);
  }
  // metadados primeiro; os bytes de cada arquivo em chamadas separadas (evita um payload gigante)
  const meta = await page.evaluate(() => { const r = globalThis.__waResultado; return { ...r, arquivos: r.arquivos.map((a) => ({ rotulo: a.rotulo, nome: a.nome, mime: a.mime, tamanhoB64: a.base64.length })) }; });
  const arquivos = [];
  for (let i = 0; i < meta.arquivos.length; i++) {
    const b64 = await page.evaluate((k) => globalThis.__waResultado.arquivos[k].base64, i);
    arquivos.push({ ...meta.arquivos[i], bytes: Buffer.from(b64, "base64") });
  }
  return { ...meta, arquivos };
}

// ---------------------------------------------------------------------------
// um pedido, do começo ao fim
// ---------------------------------------------------------------------------
// Bibliotecas que o app carrega de CDNs. Em ambientes sem acesso a CDN (LIBS_LOCAIS=pasta), são
// servidas a partir das cópias locais — as mesmas versões que o app pede (ver robo/libs_locais/).
export const LIBS_CDN = {
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js": "jspdf.umd.min.js",
  "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js": "docx.umd.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js": "supabase.js",
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.0/chart.umd.min.js": "chart.umd.js",
};
export async function servirLibsLocais(contexto, pasta) {
  for (const [url, arquivo] of Object.entries(LIBS_CDN)) {
    const corpo = await readFile(path.join(pasta, arquivo));
    await contexto.route(url, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: corpo }));
  }
}

// Em ambientes em que o Chromium não alcança a rede diretamente (proxy corporativo que só o Node
// honra, via HTTPS_PROXY/NODE_USE_ENV_PROXY), REDE_PELO_NODE=1 faz TODA requisição da página passar
// pelo fetch do Node. Só para uso local/depuração; no GitHub Actions o Chromium fala direto.
const CABECALHOS_PROIBIDOS = new Set(["host", "content-length", "connection", "accept-encoding", "transfer-encoding", "keep-alive", "upgrade", "te", "trailer", "proxy-connection"]);
export async function redePeloNode(contexto) {
  await contexto.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url) || !/^https?:/.test(url)) return route.continue();
    try {
      const cab = Object.fromEntries(Object.entries(req.headers()).filter(([k]) => !CABECALHOS_PROIBIDOS.has(k.toLowerCase()) && !k.startsWith(":")));
      const corpo = req.postDataBuffer();
      const resp = await fetch(url, { method: req.method(), headers: cab, body: corpo && corpo.length ? corpo : undefined, redirect: "manual", signal: AbortSignal.timeout(170_000) });
      const bytes = Buffer.from(await resp.arrayBuffer());
      const saida = {};
      resp.headers.forEach((v, k) => { if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k.toLowerCase())) saida[k] = v; });
      await route.fulfill({ status: resp.status, headers: saida, body: bytes });
    } catch (e) {
      await route.fulfill({ status: 502, contentType: "text/plain", body: "rede pelo Node falhou: " + String(e && e.message || e).slice(0, 200) });
    }
  });
}

async function processar(browser, urlApp, trabalho, dono, sessao) {
  const id = trabalho.id;
  const p = trabalho.parametros || {};
  log(`pedido ${id.slice(0, 8)} · tentativa ${trabalho.tentativa} · ${p.disciplina} · ${p.quantidade} questões · recurso ${p.recurso} · níveis ${JSON.stringify(p.contagem)}`);
  let contexto = null, page = null;
  try {
    contexto = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
    // ordem importa: o Playwright consulta as rotas da última para a primeira — o encaminhamento geral entra antes, as bibliotecas locais depois (prevalecem)
    if (process.env.REDE_PELO_NODE === "1") { await redePeloNode(contexto); log("rede da página encaminhada pelo Node (proxy do ambiente)"); }
    if (process.env.LIBS_LOCAIS) { await servirLibsLocais(contexto, process.env.LIBS_LOCAIS); log("bibliotecas de CDN servidas das cópias locais"); }
    page = await contexto.newPage();
    page.on("pageerror", (e) => log("erro na página:", curto(e.message, 200)));
    page.on("console", (m) => { if (m.type() === "error") log("console.error:", curto(m.text(), 200)); });
    const resultado = await gerarNoApp({
      page, url: urlApp, parametros: p, sessao,
      aoProgresso: async (estado) => {
        const r = await chamar("progresso", { trabalho_id: id, dono, estado }, { tentativas: 1, timeoutMs: 30_000 });
        if (r.status === 409) throw new PedidoPerdido("outro robô retomou este pedido (sinal de vida perdido)");
      },
    });
    log(`geração concluída: ${resultado.prontas}/${resultado.total} prontas · ${resultado.falhas.length} falha(s) · custo texto US$ ${resultado.custo.textoUSD.toFixed(3)} · imagens US$ ${resultado.custo.imagensUSD.toFixed(3)} (${resultado.custo.imagens})`);
    for (const rotulo of ORDEM) {
      const a = resultado.arquivos.find((x) => x.rotulo === rotulo);
      if (!a) throw new Error(`arquivo ${rotulo} não foi produzido`);
      const r = await entregar(id, dono, a, a.bytes);
      log(`entregue ${rotulo} (${Math.round(a.bytes.length / 1024)} KB) → mídia ok (${r.documentos} de 4)`);
    }
    const c = await chamar("concluir", { trabalho_id: id, dono, resumo: { total: resultado.total, prontas: resultado.prontas, falhas: resultado.falhas, custo: resultado.custo, simuladoId: resultado.simuladoId } }, { tentativas: 2, timeoutMs: 150_000 });
    if (c.status === 409) throw new PedidoPerdido(`concluir: ${curto(c.json.erro || "", 120)}`);
    if (c.status !== 200) throw new Error(`concluir: HTTP ${c.status} ${curto(c.json.erro || "", 160)}`);
    log(`pedido ${id.slice(0, 8)} → ${c.json.status}`);
    return "ok";
  } catch (e) {
    if (e instanceof PedidoPerdido) { log(`pedido ${id.slice(0, 8)} não é mais desta execução: ${curto(e.message, 160)}`); return "perdido"; }
    const motivo = curto(limpaMotivo(e && e.message || e), 300);
    log(`pedido ${id.slice(0, 8)} FALHOU: ${motivo}`);
    try {
      const f = await chamar("falhou", { trabalho_id: id, dono, motivo, definitivo: erroDefinitivo(motivo) }, { tentativas: 3, timeoutMs: 60_000 });
      log(f.status === 409 ? "o pedido já estava com outra execução" : `webhook registrou a falha → ${f.json.status || f.status}`);
    } catch (e2) { log("não consegui registrar a falha:", curto(e2.message, 160)); }
    return "falhou";
  } finally {
    try { if (page) await page.evaluate(() => globalThis.enemAutomacao && globalThis.enemAutomacao.encerrarSessao && globalThis.enemAutomacao.encerrarSessao()); } catch { /* melhor esforço */ }
    if (contexto) await contexto.close().catch(() => {});
  }
}

export async function main() {
  log(`operário ${VERSAO_ROBO} · webhook ${WEBHOOK_URL.replace(/^https?:\/\//, "")} · ${TRABALHO_ID ? "pedido " + TRABALHO_ID.slice(0, 8) : "varredura da fila"}`);
  const app = await servirApp();
  const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  let feitos = 0, falhas = 0;
  try {
    for (let n = 0; n < (TRABALHO_ID ? 1 : MAX_PEDIDOS); n++) {
      const restante = ORCAMENTO_MS - (Date.now() - INICIO_EXECUCAO);
      if (n > 0 && restante < LIMITE_MS + FOLGA_MS) { log(`sem tempo para outro pedido nesta execução (restam ${Math.round(restante / 60000)} min); a próxima varredura continua`); break; }
      // "pegar" não é repetido em erro: repetir poderia reivindicar um segundo pedido sem gerar o primeiro
      const r = await chamar("pegar", TRABALHO_ID ? { trabalho_id: TRABALHO_ID } : {}, { tentativas: 1, timeoutMs: 140_000 });
      if (r.status === 503) { log(`pegar: ${curto(r.json.erro || "indisponível", 120)} — ${curto(r.json.detalhe || "", 120)}; o pedido voltou à fila com espera; tentando o próximo`); falhas++; continue; }
      if (r.status !== 200) { log(`pegar: HTTP ${r.status} ${curto(r.json.erro || "", 160)} ${curto(r.json.motivo || "", 160)}`); break; }
      if (r.json.falhasAvisadas) log(`${r.json.falhasAvisadas} desistência(s) avisada(s) ao professor`);
      if (!r.json.trabalho) { log(`nada a fazer: ${r.json.motivo || "fila vazia"}`); break; }
      const resultado = await processar(browser, app.url, r.json.trabalho, r.json.dono, r.json.sessao);
      if (resultado === "ok") feitos++; else if (resultado === "falhou") falhas++;
    }
    if (!TRABALHO_ID) {
      const e = await chamar("entregas_pendentes", {}, { tentativas: 1, timeoutMs: 150_000 }).catch(() => null);
      if (e && e.json && (e.json.entregues || e.json.destravados)) log(`varredura de entregas: ${e.json.entregues} entregue(s), ${e.json.destravados} destravada(s)`);
    }
  } finally {
    await browser.close().catch(() => {});
    await app.fechar();
  }
  log(`fim: ${feitos} concluído(s), ${falhas} falha(s)`);
  if (falhas && !feitos) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { log("erro fatal:", curto(e && e.stack || e, 600)); process.exit(1); });
}

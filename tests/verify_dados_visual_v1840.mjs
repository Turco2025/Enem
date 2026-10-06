// v18.40 — AVISO NO CARTÃO DA CONFERÊNCIA TEXTO × DADOS DO GRÁFICO/TABELA (app).
//
// O backend (generate-question v74.35) confere em código se o que o texto AFIRMA sobre os dados
// (contagem de categorias, qual rótulo é o menor/maior, valores citados) bate com os números do
// gráfico ou da tabela — caso real da questão 4 do simulado de Biologia (06/10/2026) — e, quando
// falha, pede uma correção dirigida do texto. O resultado vem na própria questão (d.dadosVisual),
// vai junto com o simulado arquivado e aparece na auditoria local do cartão. Este teste abre o
// index.html num Chromium real (bibliotecas de robo/libs_locais, sem rede) e prova:
//   A. auditaQuestaoLocal: "corrigido" vira observação com os campos e o que foi detectado;
//      "justificado" vira observação com a justificativa e pede uma conferida; "pendente" vira
//      AVISO com o motivo e o pedido de "Regenerar"; sem d.dadosVisual, nada aparece;
//   B. o log técnico do cartão (diagImagem "dados") só é escrito quando o backend conferiu;
//   C. versão 18.40 e nenhum erro de JavaScript.
//
// Uso: node tests/verify_dados_visual_v1840.mjs [caminho do index.html]
import { chromium } from "../robo/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = process.argv[2] ? path.resolve(process.argv[2]) : path.join(RAIZ, "index.html");
const LIBS = path.join(RAIZ, "robo", "libs_locais");
const mapa = { "chart.umd.min.js": "chart.umd.js", "jspdf.umd.min.js": "jspdf.umd.min.js", "index.umd.js": "docx.umd.js", "supabase": "supabase.js" };

let ok = 0, bad = 0;
const t = (n, c, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await context.route(/^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com)\//, (route) => {
  const u = route.request().url(); const nome = Object.keys(mapa).find((k) => u.includes(k));
  if (!nome) return route.fulfill({ status: 404, body: "" });
  route.fulfill({ status: 200, contentType: "application/javascript", body: fs.readFileSync(path.join(LIBS, mapa[nome]), "utf8") });
});
await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 404, body: "" }));
await context.route(/^https:\/\/gkceyrkdmnhgqimmrsre\.supabase\.co\//, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
const page = await context.newPage();
const erros = []; page.on("pageerror", (e) => erros.push(e.message));
await page.goto("file://" + INDEX);
await page.waitForFunction(() => typeof auditaQuestaoLocal === "function" && typeof AUTOMACAO_VERSAO === "string", null, { timeout: 20000 });

const base = {
  disciplina: "Biologia", recurso: "grafico", gabarito: "B",
  textoBase: "Um usuário registrou sua urina em cinco horários do dia.", comando: "O horário em que a urina apresentou maior concentração de solutos corresponde a",
  alternativas: { A: "8h, após acordar.", B: "14h, antes do almoço.", C: "17h, após o lanche.", D: "19h, após o copo de água.", E: "22h, após o jantar." },
  analiseAlternativas: { A: { status: "incorreta", comentario: "a" }, B: { status: "correta", comentario: "b" }, C: { status: "incorreta", comentario: "c" }, D: { status: "incorreta", comentario: "d" }, E: { status: "incorreta", comentario: "e" } },
  resolucaoComentada: "Às 14h a nota de escurecimento foi a mais alta.",
  visual: { tipo: "grafico", chartType: "bar", titulo: "t", labels: ["8h", "14h", "17h", "19h", "22h"], datasets: [{ label: "Água ingerida acumulada (mL)", data: [300, 350, 700, 900, 1400] }, { label: "Nota de escurecimento da urina (1 a 5)", data: [2, 5, 3, 1, 2] }] },
};
const problemas = ['contagem: o texto-base fala em "quatro horarios" e o gráfico tem 5 rótulos (8h, 14h, 17h, 19h, 22h) e 2 séries', 'extremo: a resolução diz que 14h tem o menor valor de "Água ingerida acumulada" ("..."), mas o mínimo é em 8h (300 mL); em 14h o valor é 350 mL'];

/* ---------- A. a auditoria local do cartão ---------- */
const A = await page.evaluate(({ base, problemas }) => {
  const roda = (dadosVisual, extra = {}) => auditaQuestaoLocal({ recurso: "grafico", data: { ...base, ...extra, ...(dadosVisual ? { dadosVisual } : {}) } }).filter((i) => /Conferência dos dados/.test(i.texto));
  return {
    sem: roda(null),
    corrigido: roda({ estado: "corrigido", problemas, campos: ["textoBase", "resolucaoComentada", "comentários B"], justificativa: "ajustei", motivo: "" }),
    justificado: roda({ estado: "justificado", problemas, campos: [], justificativa: "a frase fala da concentração de solutos, grandeza que o gráfico não traz", motivo: "" }),
    pendente: roda({ estado: "pendente", problemas, campos: [], justificativa: "", motivo: "a resposta deixou de ser coerente (a resolução conclui pela A)" }),
    tabela: roda({ estado: "corrigido", problemas: ["contagem: x"], campos: ["textoBase"], justificativa: "", motivo: "" }, { recurso: "tabela", visual: { tipo: "tabela", titulo: "t", colunas: ["Região", "Produção (t)"], linhas: [["Norte", "10"], ["Sul", "40"]] } }),
  };
}, { base, problemas });
t("A1 sem d.dadosVisual (questão sã ou sem gráfico/tabela) a auditoria não diz nada sobre dados", A.sem.length === 0);
t("A2 corrigido: observação (nível info) que diz o que foi ajustado e o que foi detectado",
  A.corrigido.length === 1 && A.corrigido[0].nivel === "info" && A.corrigido[0].texto.includes("do gráfico") && A.corrigido[0].texto.includes("foi ajustado aos dados (textoBase; resolucaoComentada; comentários B)")
  && A.corrigido[0].texto.includes('Detectado: contagem: o texto-base fala em "quatro horarios"') && A.corrigido[0].texto.includes("mínimo é em 8h (300 mL)"), JSON.stringify(A.corrigido));
t("A3 justificado: observação com a justificativa da IA e o pedido de uma conferida do professor",
  A.justificado.length === 1 && A.justificado[0].nivel === "info" && A.justificado[0].texto.includes("a IA manteve o texto, justificando: a frase fala da concentração de solutos") && A.justificado[0].texto.includes("Vale uma conferida sua."), JSON.stringify(A.justificado));
t("A4 pendente: AVISO com o motivo e o pedido de \"Regenerar\"",
  A.pendente.length === 1 && A.pendente[0].nivel === "aviso" && A.pendente[0].texto.includes("a correção automática não foi possível (a resposta deixou de ser coerente") && A.pendente[0].texto.includes('use "Regenerar"'), JSON.stringify(A.pendente));
t("A5 com tabela o aviso fala \"da tabela\"", A.tabela.length === 1 && A.tabela[0].texto.includes("Conferência dos dados da tabela"), JSON.stringify(A.tabela));
t("A6 o detectado é cortado a 220 caracteres por problema (não vira um muro de texto)",
  (await page.evaluate(({ base }) => auditaQuestaoLocal({ recurso: "grafico", data: { ...base, dadosVisual: { estado: "corrigido", problemas: ["x".repeat(500)], campos: ["textoBase"] } } }).find((i) => /Conferência dos dados/.test(i.texto)).texto.length, { base })) < 420);

/* ---------- B. o log técnico ---------- */
const src = fs.readFileSync(INDEX, "utf8");
t("B1 o diagnóstico técnico \"dados\" só é escrito quando o backend conferiu (payload.dadosDiag.aplicavel)",
  src.includes("if(payload.dadosDiag && payload.dadosDiag.aplicavel){") && src.includes('diagImagem(q, "dados", `conferência texto × dados: ${dd.estado}`'));
t("B2 a auditoria lê d.dadosVisual (que vai junto com o simulado arquivado), nunca o payload",
  src.includes('if(d.dadosVisual && typeof d.dadosVisual === "object"){') && !src.includes("q.dadosDiag"));

/* ---------- C. versão e erros ---------- */
t("C1 versão 18.40 ou posterior", /^18\.(4\d|[5-9]\d)$/.test(await page.evaluate(() => AUTOMACAO_VERSAO)));
t("C2 nenhum erro de JavaScript na página", erros.length === 0, erros.join(" | "));

await browser.close();
console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
process.exit(bad ? 1 : 0);

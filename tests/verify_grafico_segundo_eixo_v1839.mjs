// v18.39 — GRÁFICO COM SÉRIES EM ESCALAS INCOMPATÍVEIS GANHA UM SEGUNDO EIXO (app).
//
// Caso real (06/10/2026): simulado de Biologia "Sistema urinário humano", questão 4 — barras de
// "Água ingerida acumulada (mL)" (300 a 1400) e "Nota de escurecimento da urina (1 a 5)" no MESMO
// eixo: a nota, que respondia a questão, saía com menos de 1 pixel de altura e o professor viu o
// gráfico "sem dados". Este teste abre o index.html num Chromium real (as bibliotecas vêm de
// robo/libs_locais, sem rede) e prova:
//   A. eixosDoGrafico: a série ≥ 8× menor vai para "y1"; séries na mesma escala ficam em "y";
//      pizza e série única nunca ganham segundo eixo;
//   B. o gráfico renderizado tem o eixo y1 à direita, a série pequena como linha (em barras) e
//      altura legível (dezenas de pixels, não 1);
//   C. a restilização para impressão/PDF/Word (pdfGetVisualChartInfo) pinta e restaura TODAS
//      as escalas, inclusive y1 e os títulos dos eixos;
//   D. gráfico comum (uma escala) continua exatamente como antes (sem y1, sem títulos de eixo);
//   E. a auditoria local do card avisa o professor que houve segundo eixo.
//
// Uso: node tests/verify_grafico_segundo_eixo_v1839.mjs [caminho do index.html]
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
await page.waitForFunction(() => !!window.Chart && typeof eixosDoGrafico === "function", null, { timeout: 20000 });

const q4 = { tipo: "grafico", chartType: "bar", titulo: "Ingestão acumulada de água e escurecimento da urina ao longo do dia", labels: ["8h", "14h", "17h", "19h", "22h"],
  datasets: [{ label: "Água ingerida acumulada (mL)", data: [300, 350, 700, 900, 1400] }, { label: "Nota de escurecimento da urina (1 a 5)", data: [2, 5, 3, 1, 2] }] };
const comum = { tipo: "grafico", chartType: "line", titulo: "Creatinina sérica", labels: ["Dia 1", "Dia 2", "Dia 3"], datasets: [{ label: "Creatinina (mg/dL)", data: [3.2, 2.6, 2] }, { label: "Ureia (mg/dL)", data: [80, 60, 45] }] };

/* ---------- A. a decisão dos eixos ---------- */
const A = await page.evaluate((q4) => ({
  q4: eixosDoGrafico(q4.datasets, "bar"),
  iguais: eixosDoGrafico([{ data: [10, 20, 30] }, { data: [12, 25, 28] }], "bar"),
  limite: eixosDoGrafico([{ data: [80] }, { data: [10] }], "bar"),          // exatamente 8× → segundo eixo
  quaseLimite: eixosDoGrafico([{ data: [79] }, { data: [10] }], "bar"),     // menos de 8× → um eixo só
  pizza: eixosDoGrafico(q4.datasets, "pie"),
  umaSerie: eixosDoGrafico([q4.datasets[0]], "bar"),
  negativos: eixosDoGrafico([{ data: [-1400, -900] }, { data: [2, 5] }], "line"),
  vazio: eixosDoGrafico([], "bar"),
  tresSeries: eixosDoGrafico([{ data: [1000, 1200] }, { data: [3, 4] }, { data: [900, 1100] }], "bar"),
  constante: eixosDoGrafico(GRAFICO_RAZAO_SEGUNDO_EIXO === 8 ? [{ data: [1] }, { data: [1] }] : [], "bar"),
}), q4);
t("A1 questão 4: a série de notas (1 a 5) vai para o eixo da direita; a de mL fica à esquerda", A.q4.join() === "y,y1");
t("A2 séries na mesma escala ficam num eixo só", A.iguais.join() === "y,y" && A.quaseLimite.join() === "y,y");
t("A3 o limite é 8×: exatamente 8× já ganha o segundo eixo", A.limite.join() === "y,y1" && A.constante.join() === "y,y");
t("A4 pizza, série única e lista vazia nunca ganham segundo eixo", A.pizza.join() === "y,y" && A.umaSerie.join() === "y" && A.vazio.length === 0);
t("A5 valores negativos contam pelo módulo; com três séries, só a pequena vai para a direita", A.negativos.join() === "y,y1" && A.tresSeries.join() === "y,y1,y");

/* ---------- B. o gráfico renderizado ---------- */
const B = await page.evaluate(async (q4) => {
  const body = document.createElement("div"); body.className = "visual-body"; body.style.cssText = "width:900px;background:#1e1b4b;padding:12px"; document.body.appendChild(body);
  renderVisualContent(body, q4, {});
  await new Promise((r) => setTimeout(r, 700));
  const canvas = body.querySelector("canvas"); const chart = Chart.getChart(canvas);
  const y = chart.scales.y, y1 = chart.scales.y1;
  const d1 = chart.data.datasets[1];
  return { temY1: !!y1, posicao: y1 && y1.options.position, yMax: y.max, y1Max: y1 && y1.max, tipoSerie2: d1.type || null, eixoSerie2: d1.yAxisID, tensao: d1.tension,
    alturaNota5: y1 ? Math.abs(y1.getPixelForValue(0) - y1.getPixelForValue(5)) : 0, alturaSeUmEixo: Math.abs(y.getPixelForValue(0) - y.getPixelForValue(5)),
    tituloY: y.options.title && y.options.title.text, tituloY1: y1 && y1.options.title && y1.options.title.text, gradeY1: y1 && y1.options.grid.drawOnChartArea };
}, q4);
t("B1 há um eixo y1 à direita, com a escala da nota (0–5), e o da esquerda vai a 1400", B.temY1 && B.posicao === "right" && B.y1Max === 5 && B.yMax === 1400, JSON.stringify(B));
t("B2 em gráfico de barras, a série do eixo direito é desenhada como linha reta (sem curva), no eixo y1", B.tipoSerie2 === "line" && B.eixoSerie2 === "y1" && B.tensao === 0);
t("B3 a nota 5 passa de menos de 1 pixel para mais de 100 pixels de altura", B.alturaSeUmEixo < 2 && B.alturaNota5 > 100, `antes ${B.alturaSeUmEixo.toFixed(2)} px · depois ${B.alturaNota5.toFixed(0)} px`);
t("B4 cada eixo mostra a unidade da sua série como título; a grade do eixo direito não se sobrepõe", B.tituloY === q4.datasets[0].label && B.tituloY1 === q4.datasets[1].label && B.gradeY1 === false);

/* ---------- C. impressão / PDF / Word ---------- */
const C = await page.evaluate(() => {
  const body = document.querySelector(".visual-body");
  const wrap = document.createElement("div"); wrap.id = "questionResults"; const card = document.createElement("div"); card.className = "qcard"; card.appendChild(body); wrap.appendChild(card); document.body.appendChild(wrap);
  const chart = Chart.getChart(body.querySelector("canvas"));
  let pretoDuranteCaptura = null;
  const original = chart.update.bind(chart); let primeira = true;
  chart.update = function (m) { if (primeira) { primeira = false; pretoDuranteCaptura = chart.options.scales.y1.ticks.color === "#000000" && chart.options.scales.y1.title.color === "#000000" && chart.options.scales.y.title.color === "#000000" && chart.options.scales.x.ticks.color === "#000000"; } return original(m); };
  const info = pdfGetVisualChartInfo(0);
  chart.update = original;
  const o = chart.options.scales;
  return { png: !!(info && info.dataUrl && info.dataUrl.startsWith("data:image/png")), pretoDuranteCaptura,
    restaurado: o.y1.ticks.color === "#8a92b8" && o.y1.title.color === "#c7cde3" && o.y.ticks.color === "#8a92b8" && o.y.title.color === "#c7cde3" && o.x.ticks.color === "#8a92b8" && o.x.grid.color === "rgba(255,255,255,.06)" };
});
t("C1 a captura para PDF/Word sai em PNG, com TODAS as escalas (x, y, y1 e títulos) em preto durante a captura", C.png && C.pretoDuranteCaptura === true, JSON.stringify(C));
t("C2 depois da captura, as cores da tela são restauradas em todas as escalas", C.restaurado === true);

/* ---------- D. gráfico comum continua igual ---------- */
const D = await page.evaluate(async (comum) => {
  const body = document.createElement("div"); body.style.cssText = "width:900px"; document.body.appendChild(body);
  renderVisualContent(body, comum, {});
  await new Promise((r) => setTimeout(r, 500));
  const chart = Chart.getChart(body.querySelector("canvas"));
  return { temY1: !!chart.scales.y1, tituloY: !!(chart.options.scales.y.title && chart.options.scales.y.title.display), tipos: chart.data.datasets.map((d) => d.type || null).join(), eixos: chart.data.datasets.map((d) => d.yAxisID || "").join() };
}, comum);
const D2 = await page.evaluate(async () => {
  const body = document.createElement("div"); body.style.cssText = "width:900px"; document.body.appendChild(body);
  renderVisualContent(body, { tipo: "grafico", chartType: "bar", titulo: "TFG", labels: ["A", "B", "C"], datasets: [{ label: "TFG (mL/min)", data: [95, 90, 68] }, { label: "Idade média (anos)", data: [40, 55, 70] }] }, {});
  await new Promise((r) => setTimeout(r, 500));
  const chart = Chart.getChart(body.querySelector("canvas"));
  return { temY1: !!chart.scales.y1, tituloY: !!(chart.options.scales.y.title && chart.options.scales.y.title.display), tipos: chart.data.datasets.map((d) => d.type || null).join(), eixos: chart.data.datasets.map((d) => d.yAxisID || "").join() };
});
t("D1 gráfico com séries na mesma ordem de grandeza: sem y1, sem título de eixo, barras normais — exatamente como antes", !D2.temY1 && !D2.tituloY && D2.tipos === "," && D2.eixos === ",", JSON.stringify(D2));
t("D2 gráfico de linhas com 25× de diferença também ganha o eixo direito, mantendo as duas como linhas", D.temY1 && D.tipos === ",", JSON.stringify(D));

/* ---------- E. auditoria local do card ---------- */
const src = fs.readFileSync(INDEX, "utf8");
t("E1 a auditoria local do card avisa sobre o segundo eixo e nomeia a série", src.includes('"Gráfico com séries em escalas muito diferentes: "') && src.includes("desenhada(s) num segundo eixo, à direita"));
t("E2 as instruções fixas do backend (recurso_instrucoes.ts) passaram a exigir a mesma unidade/escala por gráfico",
  (() => { try { const ri = fs.readFileSync(path.join(RAIZ, "supabase", "functions", "generate-question", "recurso_instrucoes.ts"), "utf8"); return ri.includes("ESCALAS: todas as séries de um mesmo gráfico devem ter a MESMA unidade") && ri.includes("climograma"); } catch { return false; } })());
t("E3 nenhum erro de JavaScript na página", erros.length === 0, erros.join(" | "));

await browser.close();
console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
process.exit(bad ? 1 : 0);

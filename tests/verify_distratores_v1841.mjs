// v18.41 — AVISO NO CARTÃO DA REVISÃO DOS DISTRATORES (app) + termos de exagero na auditoria local.
//
// O backend (generate-question v74.36) aplica a cada distrator o teste do candidato mediano e reescreve
// os que falham como quase-acertos da correta; o resultado vem na questão (d.distratores) e fica no
// simulado arquivado. Este teste abre o index.html num Chromium real (bibliotecas de robo/libs_locais,
// sem rede) e prova:
//   A. auditaQuestaoLocal: "revisado" vira observação com as letras; "pendente" vira AVISO com o motivo e
//      o pedido de "Regenerar"; sem d.distratores, nada aparece;
//   B. termo de exagero numa alternativa vira observação; nas cinco (estrutura do item), não;
//   C. o log técnico "distratores" só é escrito quando o backend revisou; versão 18.41; sem erro de JS.
//
// Uso: node tests/verify_distratores_v1841.mjs [caminho do index.html]
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
  disciplina: "Biologia", recurso: "nenhum", gabarito: "E",
  textoBase: "Trabalhadores em ambiente quente apresentaram urina escura e em pequeno volume.", comando: "A redução do volume urinário decorre de um mecanismo que",
  alternativas: { A: "reduz a filtração glomerular para poupar água no sangue.", B: "estimula a secreção de ADH, que aumenta a filtração glomerular.", C: "estimula a aldosterona, que retém sódio nos túbulos renais.", D: "eleva a reabsorção de sódio no túbulo renal via aldosterona.", E: "eleva a reabsorção de água no túbulo renal via ADH." },
  analiseAlternativas: { A: { status: "incorreta", comentario: "a" }, B: { status: "incorreta", comentario: "b" }, C: { status: "incorreta", comentario: "c" }, D: { status: "incorreta", comentario: "d" }, E: { status: "correta", comentario: "e" } },
  resolucaoComentada: "A desidratação eleva o ADH. Portanto, a alternativa correta é a E.",
};

const A = await page.evaluate(({ base }) => {
  const roda = (extra) => auditaQuestaoLocal({ recurso: "nenhum", data: { ...base, ...extra } });
  const so = (itens, re) => itens.filter((i) => re.test(i.texto));
  return {
    sem: so(roda({}), /Distratores revisados|Revisão dos distratores/),
    revisado: so(roda({ distratores: { estado: "revisado", letras: ["B", "D"] } }), /Distratores revisados/),
    pendente: so(roda({ distratores: { estado: "pendente", motivo: "a resposta deixou de ser coerente" } }), /Revisão dos distratores/),
    exagero: so(roda({ alternativas: { ...base.alternativas, D: "bloqueia de modo permanente a formação de urina." } }), /Termo de exagero/),
    cinco: so(roda({ alternativas: Object.fromEntries(Object.entries(base.alternativas).map(([L, v]) => [L, v.replace(".", " de forma total.")])) }), /Termo de exagero/),
    limpo: so(roda({}), /Termo de exagero/),
  };
}, { base });
t("A1 sem d.distratores a auditoria não fala em revisão", A.sem.length === 0);
t("A2 revisado: observação com as letras reescritas e a garantia de que a correta não mudou",
  A.revisado.length === 1 && A.revisado[0].nivel === "info" && A.revisado[0].texto.includes("alternativa(s) B, D reescrita(s) como quase-acerto(s)") && A.revisado[0].texto.includes("A correta não foi alterada."), JSON.stringify(A.revisado));
t("A3 pendente: AVISO com o motivo e o pedido de \"Regenerar\"",
  A.pendente.length === 1 && A.pendente[0].nivel === "aviso" && A.pendente[0].texto.includes("(a resposta deixou de ser coerente)") && A.pendente[0].texto.includes('use "Regenerar"'), JSON.stringify(A.pendente));
t("B1 termo de exagero numa alternativa vira observação (letra D); nas cinco, não; sem termo, nada",
  A.exagero.length === 1 && A.exagero[0].texto.includes(" em D ") && A.cinco.length === 0 && A.limpo.length === 0, JSON.stringify(A.exagero));

const src = fs.readFileSync(INDEX, "utf8");
t("C1 o log técnico \"distratores\" só é escrito quando o backend revisou (payload.distratoresDiag.aplicavel)",
  src.includes("if(payload.distratoresDiag && payload.distratoresDiag.aplicavel){") && src.includes('diagImagem(q, "distratores", `revisão dos distratores: ${rd.estado}`'));
t("C2 a auditoria lê d.distratores (que vai junto com o simulado arquivado)", src.includes('if(d.distratores && typeof d.distratores === "object"){'));
t("C3 versão 18.41 ou posterior", /^18\.(4[1-9]|[5-9]\d)$/.test(await page.evaluate(() => AUTOMACAO_VERSAO)));
t("C4 nenhum erro de JavaScript na página", erros.length === 0, erros.join(" | "));

await browser.close();
console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
process.exit(bad ? 1 : 0);

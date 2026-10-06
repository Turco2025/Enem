/* v74.37 — BANCO DE FONTES DESLIGADO (generate-question), SEM CHAMAR A ANTHROPIC NEM O BANCO.

   Decisão do professor (06/10/2026): "não quero que o elaborador recorra ao banco de questões
   geradas pelo aplicativo em nenhuma disciplina, quando uma nova questão for solicitada".
   Levantamento: a geração nunca leu os simulados arquivados; a biblioteca (textos_enem) é acervo
   de provas oficiais e do professor; o ÚNICO material produzido pelo próprio aplicativo que a
   geração consultava era o banco de fontes validadas (fontes_validadas, v74.23). Aqui se prova:
     A. a chave de produção está desligada (leitura e gravação) e as duas funções devolvem antes
        de tocar na tabela — em TODAS as disciplinas e nos três caminhos (pesquisa normal, fluxo
        direto de História/Artes, ordem IA), sem que os chamadores precisem mudar;
     B. religar é mudar dois valores: com leitura = true a lógica antiga volta (mesmo código);
     C. a geração não lê os simulados arquivados (nenhum acesso à tabela "simulados" no backend) e
        a única leitura do log de custos é a do cache (houveGeracaoRecente);
     D. selftest e impressão digital.
   Uso: deno run -A tests/verify_banco_desligado_v7437.ts supabase/functions/generate-question/index.ts */
const alvo = Deno.args[0] || "supabase/functions/generate-question/index.ts";
const fonte = await Deno.readTextFile(alvo);
function recorta(nome: string, prefixo = "function "): string {
  const ini = fonte.indexOf(`\n${prefixo}${nome}(`);
  if (ini < 0) { console.error(`FALHA: não achei ${prefixo}${nome}`); Deno.exit(1); }
  const fim = fonte.indexOf("\n}\n", ini);
  return fonte.slice(ini, fim + 3);
}
function entre(a: string, b: string): string {
  const i = fonte.indexOf(a); const j = fonte.indexOf(b, i);
  if (i < 0 || j < 0) { console.error(`FALHA: não achei o trecho ${a.slice(0, 40)}`); Deno.exit(1); }
  return fonte.slice(i, j);
}
const modulo = `
export const __db: any = { selects: 0, inserts: 0, updates: 0, linhas: [] as any[] };
const supabase: any = {
  from(_t: string) {
    const q: any = { select() { __db.selects++; return q; }, eq() { return q; }, order() { return q; },
      limit() { return Promise.resolve({ data: __db.linhas, error: null }); },
      insert() { __db.inserts++; return Promise.resolve({ error: null }); },
      update() { __db.updates++; return { eq() { return Promise.resolve({}); } }; } };
    return q;
  },
};
${entre("function tokensDeFonte(", "\n/* Palavras que aparecem")}
${entre("const PALAVRAS_VAZIAS_FONTE", "\n]);\n")}
]);
${recorta("normalizaUrl")}${recorta("fonteEstaNaListaDeEvitar")}
${entre("const BANCO_FONTES_MINIMO_TOKENS", "async function consultarBancoFontes(")}
${recorta("consultarBancoFontes", "async function ")}
${recorta("guardarNoBancoFontes", "async function ")}
export { consultarBancoFontes, guardarNoBancoFontes, BANCO_FONTES };
`;
const tmp = await Deno.makeTempDir();
await Deno.writeTextFile(`${tmp}/banco.ts`, modulo);
const M: any = await import(`file://${tmp}/banco.ts`);
const { __db } = M;

let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };
const cala = () => { const o = { w: console.warn, l: console.log }; console.warn = () => {}; console.log = (...a: any[]) => { if (/^(PASS|FAIL)/.test(String(a[0]))) o.l(...a); }; return () => { console.warn = o.w; console.log = o.l; }; };
const linha = (id: number, obra: string) => ({ id, tema_chave: "", autor: "Clarice Lispector", instituicao: "", obra, ano: "2015", referencia: `X. ${obra}. 2015.`, url: `https://ufpe.br/${id}`, trecho: "t", trecho_literal: false, restrito: false, nivel: "A", validacao: { estado: "aprovado", libera: true }, usos: 0 });
const dossieAprovado = { encontrou: true, url: "https://ufpe.br/1", autor: "Clarice Lispector", obra: "A hora da estrela", referencia: "r", validacao: { libera: true, estado: "aprovado" }, trecho: "t" };

/* ---------- A. desligado em produção ---------- */
t("A1 a chave de produção: leitura false, gravação false", M.BANCO_FONTES.leitura === false && M.BANCO_FONTES.gravacao === false);
const volta = cala();
__db.linhas = [linha(1, "A hora da estrela de Clarice Lispector")]; __db.selects = 0;
const r1 = await M.consultarBancoFontes({ area: "linguagens", disciplina: "Literatura", tema: "Clarice Lispector e a epifania" }, [], false);
const r2 = await M.consultarBancoFontes({ area: "humanas", disciplina: "História", tema: "Canudos" }, [], true);
const r3 = await M.consultarBancoFontes({ area: "linguagens", disciplina: "Artes", tema: "Barroco" }, [], true);
t("A2 a consulta devolve null em qualquer disciplina e com qualquer modo (pesquisa normal, fluxo direto, ordem IA) — e NÃO toca na tabela",
  r1 === null && r2 === null && r3 === null && __db.selects === 0);
__db.inserts = 0; __db.updates = 0;
await M.guardarNoBancoFontes({ area: "linguagens", disciplina: "Literatura", tema: "t" }, dossieAprovado);
t("A3 a gravação também não acontece: dossiê aprovado não vai para a tabela", __db.inserts === 0 && __db.updates === 0);
t("A4 os chamadores não mudaram (a função é que devolve nada): pesquisa normal, fluxo direto de História/Artes e gravação após a validação continuam no lugar",
  fonte.includes("await consultarBancoFontes(o, evitar, semPesquisaWeb(o.disciplina))") && fonte.includes("await consultarBancoFontes(o, evitar, true)") && /await guardarNoBancoFontes\(/.test(fonte));
t("A5 a chave fica ANTES de qualquer acesso, nas duas funções",
  (() => { const c = M.consultarBancoFontes.toString(), g = M.guardarNoBancoFontes.toString(); return c.indexOf("BANCO_FONTES.leitura") < c.indexOf('from("fontes_validadas")') && g.indexOf("BANCO_FONTES.gravacao") < g.indexOf("d.encontrou !== true"); })());

/* ---------- B. religar é mudar dois valores ---------- */
M.BANCO_FONTES.leitura = true; __db.selects = 0;
const r4 = await M.consultarBancoFontes({ area: "linguagens", disciplina: "Literatura", tema: "Clarice Lispector e a epifania" }, [], false);
t("B1 com a leitura religada a lógica antiga volta intacta: consulta a tabela e devolve a fonte compatível", !!r4 && r4.doBanco && r4.doBanco.id === 1 && __db.selects === 1, JSON.stringify(r4 && r4.doBanco));
M.BANCO_FONTES.gravacao = true; __db.inserts = 0;
await M.guardarNoBancoFontes({ area: "linguagens", disciplina: "Literatura", tema: "t" }, { ...dossieAprovado, url: "https://ufpe.br/novo" });
t("B2 com a gravação religada o dossiê aprovado volta a ser guardado", __db.inserts === 1 || __db.updates === 1);
M.BANCO_FONTES.leitura = false; M.BANCO_FONTES.gravacao = false;
volta();

/* ---------- C. a geração nunca leu os simulados arquivados ---------- */
const tabelas = [...fonte.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
t("C1 as únicas tabelas que o backend acessa são fontes_validadas, question_generation_log e textos_enem — nunca \"simulados\" (o arquivo de questões geradas)",
  [...new Set(tabelas)].sort().join() === "fontes_validadas,question_generation_log,textos_enem", [...new Set(tabelas)].join());
t("C2 as duas leituras do log de custos são só CONTAGEM (cache recente e teto diário): nada do conteúdo de questões anteriores entra no pedido",
  (fonte.match(/\.from\("question_generation_log"\)\s*\.select\("id", \{ count: "exact", head: true \}\)/g) || []).length === 2
  && (fonte.match(/\.from\("question_generation_log"\)\s*\.select/g) || []).length === 2
  && recorta("houveGeracaoRecente", "async function ").includes('count: "exact", head: true'));
t("C3 textos_enem é acervo de provas (ENEM e provas da biblioteca do professor), não material do app: a consulta filtra por prova/ano, nunca por simulado",
  !/textos_enem[\s\S]{0,400}simulado/.test(fonte.slice(fonte.indexOf("async function consultarTextosEnem("), fonte.indexOf("async function consultarTextosEnem(") + 3000)));

/* ---------- D. selftest e impressão digital ---------- */
t("D1 selftest v7437 e impressão digital incluem a chave",
  fonte.includes("v7437_bancoDesligado: (() => {") && fonte.includes("BANCO_FONTES_MINIMO_TOKENS, BANCO_FONTES]),   // v74.37: + BANCO_FONTES"));

console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
if (bad) Deno.exit(1);

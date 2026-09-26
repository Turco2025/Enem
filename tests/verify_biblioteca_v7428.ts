/* v74.28 — BIBLIOTECA DE TEXTOS E LITERATURA SEM PESQUISA NA INTERNET (generate-question).

   Prova, SEM chamar a Anthropic e SEM banco de dados de verdade:
     A. texto de outra prova (coluna "prova") é apresentado como tal — nunca como ENEM —
        e o texto do ENEM continua com os prompts de antes;
     B. a escolha do texto MAIS PRÓXIMO (palavra rara pesa mais; empate → menos usado);
     C. o fluxo de pesquisarFonteReal: em Literatura, Língua Portuguesa e Artes nunca chega
        ao pesquisador (zero chamadas ao modelo); em História continua pesquisando;
     D. geração e auditoria sem busca na web nessas três; leitura da biblioteca em páginas
        de 1000 linhas; ligação no handler e no selftest.
   O código conferido é o do arquivo de produção: cada função é recortada dele (do
   "function nome(" até a primeira linha "}" na coluna zero) e só as dependências
   externas (banco, modelo) viram dublês.

   Uso:
     deno run --allow-read --allow-write --allow-env tests/verify_biblioteca_v7428.ts supabase/functions/generate-question/index.ts  */
const alvo = Deno.args[0] || "supabase/functions/generate-question/index.ts";
const fonte = await Deno.readTextFile(alvo);
function recorta(nome: string, prefixo = "function "): string {
  const ini = fonte.indexOf(`\n${prefixo}${nome}(`);
  if (ini < 0) { console.error(`FALHA: não achei ${prefixo}${nome} em ${alvo}`); Deno.exit(1); }
  const fim = fonte.indexOf("\n}\n", ini);
  return fonte.slice(ini, fim + 3);
}
function entre(a: string, b: string): string {
  const i = fonte.indexOf(a), j = fonte.indexOf(b, i);
  if (i < 0 || j < 0) { console.error(`FALHA: não achei o trecho ${a.slice(0, 40)}`); Deno.exit(1); }
  return fonte.slice(i, j);
}
const modulo = `
const LETRAS_ALT_FONTE = ["A", "B", "C", "D", "E"];
const MAX_FONTES_EVITAR = 20;
export const __d: any = { tabela: [] as any[], enem: null, banco: null, chamadasModelo: 0, updates: 0, erroBanco: false, paginas: [] as number[][] };
const supabase: any = {
  from(_t: string) {
    const q: any = { _f: {} as any, _id: null as any,
      select() { return q; }, in(_c: string, v: string[]) { q._f.in = v; return q; }, eq(c: string, v: any) { if (c === "id") q._id = v; else q._f[c] = v; return q; },
      order() { return q; },
      range(a: number, b: number) { __d.paginas.push([a, b]); return Promise.resolve(__d.erroBanco ? { data: null, error: { message: "fora do ar" } } : { data: __d.tabela.filter((r: any) => (!q._f.in || q._f.in.includes(r.disciplina)) && (q._f.aproveitavel === undefined || r.aproveitavel === q._f.aproveitavel)).slice(a, b + 1), error: null }); },
      maybeSingle() { return Promise.resolve({ data: __d.tabela.find((r: any) => r.id === q._id) || null, error: null }); },
      update() { __d.updates++; return { eq() { return Promise.resolve({}); } }; } };
    return q;
  },
};
async function consultarTextosEnem() { return __d.enem; }
async function consultarBancoFontes() { return __d.banco; }
function fontesReaisEstrito(area: string) { return ["linguagens", "humanas"].includes(area); }
function precisaFontesReais() { return true; }
function webSearchTool(d: string) { return { type: "web_search", disciplina: d }; }
function cacheControlAtual() { return { type: "ephemeral" }; }
function temAcervoPrioritario() { return false; }
function buildPesquisaFontePrompt() { return "pesquisa"; }
const SISTEMA_PESQUISA_FONTE = "x", RODADAS_VALIDACAO = 3, MS_MINIMO_PARA_SEGUNDA_RODADA = 90_000;
const BUSCA_PESQUISADOR_ACERVOS = {}, BUSCA_PESQUISADOR = {}, BUSCA_PESQUISADOR_RETRY = {}, FERRAMENTA_DOSSIE_FONTE = {};
async function callClaudeForJSON() { __d.chamadasModelo++; return null; }
${entre("const TEXTOS_ENEM_MINIMO_PONTOS", "function normalizaTemaEnem(")}
${recorta("normalizaTemaEnem")}${recorta("radicalEnem")}${recorta("chaveEvitarEnem")}${recorta("urlsDaReferencia")}
${entre("function tokensDeFonte(", "\n/* Palavras que aparecem")}
${entre("const PALAVRAS_VAZIAS_FONTE", "\n]);\n")}
]);
${recorta("normalizaUrl")}${recorta("fonteEstaNaListaDeEvitar")}
${entre("/* ═══════════ v74.28 — BIBLIOTECA", "/* ═══════════ FIM DA BIBLIOTECA (v74.28)")}
${recorta("dossieDoTextoEnem")}${recorta("buildBlocoTextoEnem")}${recorta("buscaDaGeracao")}
${recorta("pesquisarFonteReal", "async function ")}
export { semPesquisaWeb, provaDoTexto, escolheTextoMaisProximo, consultarTextoMaisProximo, dossieDoTextoEnem, buildBlocoTextoEnem, buscaDaGeracao, pesquisarFonteReal, DISCIPLINAS_SEM_PESQUISA_WEB, linhasDaBiblioteca, BIBLIOTECA_PAGINA };
`;
const tmp = await Deno.makeTempDir();
await Deno.writeTextFile(`${tmp}/bib.ts`, modulo);
const M: any = await import(`file://${tmp}/bib.ts`);
const { __d } = M;

let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };
const cala = () => { const o = { w: console.warn, l: console.log, e: console.error }; console.warn = () => {}; console.error = () => {}; console.log = (...a: any[]) => { if (/^(PASS|FAIL)/.test(String(a[0]))) o.l(...a); }; return () => { console.warn = o.w; console.log = o.l; console.error = o.e; }; };

const coli: any = { id: 101, chave: "sp-262494", ano: 2026, numero: 0, prova: "Unesp 2026", disciplina: "Artes", aproveitavel: true, tipo_texto: "ensaio",
  autor: "Jorge Coli", instituicao: "", obra: "Bom dia, senhor Courbet!", ano_obra: "", temas: ["gustave courbet", "realismo na pintura", "artista marginal"],
  referencia: "COLI, J. Bom dia, senhor Courbet! Trecho inicial do ensaio, reproduzido na prova do vestibular Unesp 2026.", texto: "Gustave Courbet (1819-1877) e sua obra...",
  comando_original: "De acordo com Jorge Coli, a obra de Courbet, em contradição com o modo de ser do artista, caracteriza-se",
  alternativas_originais: { A: "pela eloquência.", B: "pela discrição.", C: "pelo escárnio.", D: "pelo rebuscamento.", E: "pela combatividade." }, gabarito_original: "B", habilidade_original: "", usos: 0 };
const lit = (id: number, temas: string[], autor: string, obra: string, usos = 0, extra: any = {}) => ({ id, chave: `2015-regular-${id}`, ano: 2015, numero: id, prova: "ENEM", disciplina: "Literatura", aproveitavel: true,
  tipo_texto: "poema", autor, instituicao: "", obra, ano_obra: "", temas, referencia: `${autor.toUpperCase()}. ${obra}. Rio de Janeiro: Editora, 2000.`, texto: `Texto de ${autor}.`,
  comando_original: "c", alternativas_originais: { A: "a", B: "b", C: "c", D: "d", E: "e" }, gabarito_original: "A", habilidade_original: "H16", usos, ...extra });

/* ---------- A. a prova de origem ---------- */
const dU = M.dossieDoTextoEnem(coli, 2), dE = M.dossieDoTextoEnem({ ...coli, chave: "2011-regular-3", ano: 2011, numero: 3, prova: "ENEM" }, 2);
const dSem = M.dossieDoTextoEnem({ ...coli, chave: "2011-regular-3", ano: 2011, numero: 3, prova: undefined }, 2);
t("A1 texto de outra prova: o dossiê diz 'prova Unesp 2026' e não fala em INEP nem em ENEM",
  dU.doEnem.prova === "Unesp 2026" && dU.validacao.afirmacoesComSuporte[0].includes("na prova Unesp 2026")
  && !JSON.stringify(dU.validacao).includes("INEP") && !JSON.stringify(dU.validacao).includes("ENEM") && dU.comoVerificou.includes("biblioteca de textos do professor"));
t("A2 texto do ENEM: igual à v74.25 (com ou sem a coluna 'prova' no banco)",
  dE.doEnem.prova === "ENEM" && JSON.stringify(dE.validacao) === JSON.stringify(dSem.validacao) && dE.comoVerificou === dSem.comoVerificou
  && dE.validacao.afirmacoesComSuporte[0].includes("impressa pelo INEP na prova oficial do ENEM 2011") && dE.comoVerificou === "texto-base da prova oficial do ENEM 2011 (questão 3), com a referência impressa pelo INEP");
const bU = M.buildBlocoTextoEnem(dU), bE = M.buildBlocoTextoEnem(dE);
t("A3 o elaborador recebe a prova certa, a questão original para EVITAR e a ordem de NÃO inventar livro, editora ou ano",
  bU.includes("DA PROVA UNESP 2026 (biblioteca de textos do professor)") && !bU.includes("ENEM 2026") && bU.includes("NÃO os invente")
  && bU.includes("«De acordo com Jorge Coli") && bU.includes("resposta correta original (B): «pela discrição.»"));
t("A4 texto do ENEM: o bloco do elaborador é o mesmo de antes",
  bE.includes("🆕 ESTE TEXTO-BASE VEIO DA PROVA OFICIAL DO ENEM 2011 (questão 3). Autor, obra e referência são os que o INEP imprimiu. A questão que você vai escrever tem de ser INÉDITA:")
  && bE.includes('· REFERÊNCIA: copie a do dossiê, que é a do INEP. A fonte é a OBRA ORIGINAL — não escreva "ENEM" na referência, no texto-base nem no comando. Deixe "urlVerificacao" vazio')
  && !bE.includes("biblioteca de textos do professor") && !bE.includes("TEXTO MAIS PRÓXIMO"));

/* ---------- B. o texto mais próximo ---------- */
const zero = () => 0;
const rows = [
  lit(1, ["castro alves", "condoreirismo", "romantismo"], "Castro Alves", "O navio negreiro", 2),
  lit(2, ["modernismo", "poesia"], "Carlos Drummond de Andrade", "Alguma poesia", 0),
  lit(3, ["romantismo", "indianismo"], "José de Alencar", "Iracema", 0),
  lit(4, ["romantismo", "ultrarromantismo", "mal do século"], "Álvares de Azevedo", "Lira dos vinte anos", 1),
];
t("B1 a palavra rara decide: 'condoreira' leva ao Castro Alves, mesmo sendo o mais usado", M.escolheTextoMaisProximo("Romantismo brasileiro da terceira geração condoreira", rows, zero).row.id === 1);
t("B2 'Indianismo romântico' → Iracema; 'Ultrarromantismo' → Álvares de Azevedo",
  M.escolheTextoMaisProximo("Indianismo romântico", rows, zero).row.id === 3 && M.escolheTextoMaisProximo("Ultrarromantismo e o mal do século", rows, zero).row.id === 4);
t("B3 empate (só 'romantismo'): vence o MENOS usado (Iracema, 0 usos) e não o Castro Alves (2) nem o Álvares (1)", M.escolheTextoMaisProximo("Romantismo", rows, zero).row.id === 3);
t("B4 pedido genérico ('Literatura') ou sem nada em comum: rodízio entre os menos usados, 0 ponto", (() => {
  const a = M.escolheTextoMaisProximo("Literatura", rows, zero), b = M.escolheTextoMaisProximo("Literatura", rows, () => 0.99);
  return a.pontos === 0 && [2, 3].includes(a.row.id) && [2, 3].includes(b.row.id) && a.row.id !== b.row.id && M.escolheTextoMaisProximo("x", [], zero) === null;
})());

/* ---------- C. o fluxo de pesquisarFonteReal ---------- */
const fala = cala();
const pesquisa = async (disciplina: string, tema: string, evitar: string[] = [], area = "linguagens") =>
  M.pesquisarFonteReal({ area, disciplina, tema, recorte: "", fontesEvitar: evitar }, [], [], () => 120_000);
__d.tabela = [...rows, coli]; __d.enem = null; __d.banco = null; __d.chamadasModelo = 0;
let r = await pesquisa("Literatura", "Romantismo brasileiro da terceira geração condoreira");
t("C1 Literatura sem texto que case e sem banco: devolve o texto MAIS PRÓXIMO, marcado como tal, e o modelo NUNCA é chamado",
  r && r.encontrou === true && r.doEnem.aproximado === true && r.doEnem.chave === "2015-regular-1" && r.validacao.libera === true && __d.chamadasModelo === 0 && __d.updates >= 1);
t("C2 o bloco do elaborador avisa que é o texto mais próximo e proíbe forçar o tema ou acrescentar informação", M.buildBlocoTextoEnem(r).includes("TEXTO MAIS PRÓXIMO DA BIBLIOTECA") && M.buildBlocoTextoEnem(r).includes("Não force o tema"));
r = await pesquisa("Literatura", "Romantismo brasileiro da terceira geração condoreira", ["enem:2015-regular-1"]);
t("C3 texto já recusado pelo app (fontesEvitar) fica de fora: vem o próximo da fila", r && r.doEnem.chave !== "2015-regular-1" && __d.chamadasModelo === 0);
__d.enem = { encontrou: true, doEnem: { chave: "x" }, referencia: "REF", validacao: { libera: true } };
r = await pesquisa("Literatura", "Machado de Assis");
t("C4 havendo texto que casa com o tema (camada zero), é ele que vale — o mais próximo nem é consultado", r === __d.enem && __d.chamadasModelo === 0);
__d.enem = null; __d.banco = { encontrou: true, doBanco: true, url: "https://x", validacao: { libera: true } };
r = await pesquisa("Literatura", "Graciliano Ramos");
t("C5 banco de fontes já validadas continua valendo (sem internet: são fontes guardadas)", r === __d.banco && __d.chamadasModelo === 0);
__d.banco = null; __d.erroBanco = true;
r = await pesquisa("Literatura", "Graciliano Ramos");
t("C6 biblioteca fora do ar: Literatura NÃO cai na pesquisa na internet — devolve bloqueio com o motivo", r && r.encontrou === false && r.bloqueado === true && r.semPesquisaWeb === true && __d.chamadasModelo === 0 && /não se pesquisa na internet/.test(r.motivo));
__d.erroBanco = false; __d.chamadasModelo = 0;
r = await pesquisa("Artes", "Courbet e a autonomia do artista");
t("C7 Artes e Língua Portuguesa também não pesquisam: Artes cai no texto mais próximo (o de Jorge Coli, prova Unesp 2026), com zero chamadas ao modelo",
  r && r.encontrou === true && r.doEnem.chave === "sp-262494" && r.doEnem.prova === "Unesp 2026" && __d.chamadasModelo === 0);
__d.chamadasModelo = 0;
r = await pesquisa("Língua Portuguesa", "Variação linguística");
t("C8 Língua Portuguesa sem nenhum texto na biblioteca (neste dublê): bloqueio com o motivo, sem cair na internet", r && r.encontrou === false && r.semPesquisaWeb === true && __d.chamadasModelo === 0);
r = await pesquisa("História", "Revolução Francesa", [], "humanas");
t("C9 História (e as demais) continuam pesquisando na internet quando não há texto nem banco", __d.chamadasModelo >= 1);
__d.tabela = Array.from({ length: 2345 }, (_, i) => lit(1000 + i, ["tema " + i], "Autor " + i, "Obra " + i));
__d.paginas = [];
const todas = await M.linhasDaBiblioteca(["Literatura"]);
t("C10 a biblioteca é lida inteira em páginas de 1000 (2.345 linhas → 3 páginas), e não mais cortada em 500",
  todas.length === 2345 && __d.paginas.length === 3 && __d.paginas[2][0] === 2000 && M.BIBLIOTECA_PAGINA === 1000);
fala();

/* ---------- D. geração, auditoria, handler e selftest ---------- */
t("D1 a geração nunca busca na internet em Literatura, Língua Portuguesa e Artes; nas demais, sem dossiê, continua podendo buscar",
  M.buscaDaGeracao(null, "linguagens", "Literatura") === false && M.buscaDaGeracao(null, "linguagens", "Artes") === false && M.buscaDaGeracao(null, "linguagens", "Língua Portuguesa") === false
  && M.buscaDaGeracao(null, "humanas", "História") !== false && M.buscaDaGeracao(null, "humanas", "Geografia") !== false);
const garantir = recorta("garantirFontesReais", "async function ");
t("D2 auditor: sem busca na web nessas disciplinas, mesmo sem dossiê (a disciplina chega do handler)",
  garantir.includes("dossiePrevio?: any, disciplina = \"\",") && garantir.includes("auditoriaSemWeb ? false : buscaDaAuditoria")
  && fonte.includes("area, buscasWeb, dossie, disciplina,\n") && fonte.includes("area, buscasWeb, dossie, disciplina);"));
t("D3 a resposta ao app diz de que prova veio o texto e se foi o mais próximo (sem a questão original)",
  fonte.includes('if (textoEnem) Object.assign(textoEnem, { prova: String(dossie.doEnem.prova || "ENEM"), aproximado: dossie.doEnem.aproximado === true });'));
t("D4 sem pesquisa na internet: Literatura, Língua Portuguesa e Artes (decisões do professor, 26/09); História, Geografia, Sociologia e Língua Estrangeira seguem pesquisando",
  M.DISCIPLINAS_SEM_PESQUISA_WEB.join() === "Literatura,Língua Portuguesa,Artes" && M.semPesquisaWeb("Língua Portuguesa") && M.semPesquisaWeb("Artes")
  && !M.semPesquisaWeb("História") && !M.semPesquisaWeb("Geografia") && !M.semPesquisaWeb("Sociologia") && !M.semPesquisaWeb("Língua Estrangeira (Inglês/Espanhol)"));
t("D5 selftest confere a biblioteca e inclui as funções na impressão digital",
  fonte.includes("v7428_biblioteca: (() => {") && fonte.includes("semPesquisaWeb.toString(), provaDoTexto.toString(), escolheTextoMaisProximo.toString(), consultarTextoMaisProximo.toString()"));

console.log(`\n${ok} passaram, ${bad} falharam`);
if (bad) Deno.exit(1);

/* v74.31 — BIBLIOTECA → CONHECIMENTO DA IA → INTERNET (generate-question), SEM CHAMAR A ANTHROPIC.

   Decisões do professor (01/10/2026) para História, Geografia, Filosofia, Sociologia,
   Práticas Corporais e Língua Estrangeira:
     · tema sem autor nem obra pedidos → biblioteca; sem texto, texto-base AUTORAL com
       dados reais, do conhecimento da IA, sem internet e sem validador;
     · tema com autor ou obra → biblioteca → paráfrase do conhecimento da IA (referência
       só com dados certos, sem validador) → questão semelhante autoral, com dados reais
       → UMA pesquisa na internet (com o validador), só no 2º pedido do app, quando a
       autoral não passou no auditor (ordem trocada pelo professor em 01/10).
   Este arquivo prova o COMPORTAMENTO de pesquisarFonteReal com dublês roteirizados no
   lugar de callClaudeForJSON (parte O) e a biblioteca de Língua Estrangeira e o rodízio
   em consultarTextosEnem com um dublê do banco (parte B). O código conferido é o do
   arquivo de produção, recortado dele. A conferência estrutural e o auditor dos modos
   da IA estão na seção S de verify_fontes_backend.ts.

   Uso: deno run -A tests/verify_ordem_ia_v7431.ts supabase/functions/generate-question/index.ts */
const alvo = Deno.args[0] || "supabase/functions/generate-question/index.ts";
const fonte = await Deno.readTextFile(alvo);

function fatiar(ini: string, fim: string): string {
  const a = fonte.indexOf(ini), b = fonte.indexOf(fim, a);
  if (a < 0 || b < 0) { console.error(`FALHA: não achei o trecho ${ini.slice(0, 40)} … ${fim.slice(0, 40)}`); Deno.exit(1); }
  return fonte.slice(a, b);
}
function recorta(nome: string, prefixo = "function "): string {
  const ini = fonte.indexOf(`\n${prefixo}${nome}(`);
  if (ini < 0) { console.error(`FALHA: não achei ${prefixo}${nome} em ${alvo}`); Deno.exit(1); }
  const fim = fonte.indexOf("\n}\n", ini);
  return fonte.slice(ini, fim + 3);
}
function recortaConstArray(nome: string): string {
  const m = fonte.match(new RegExp(`const ${nome}: string\\[\\] = (\\[[^;]*?\\]);`, "s"));
  if (!m) { console.error(`FALHA: não achei ${nome}`); Deno.exit(1); }
  return `const ${nome}: string[] = ${m[1]};`;
}
const mAcervos = fonte.match(/const ACERVOS_PRIORITARIOS: \{ nome: string; url: string; dominio: string \}\[\] = (\[[^;]*?\]);/s)!;
const blocoValidador = fatiar("/* ═══════════ v74.21 — AGENTE VALIDADOR DE FONTES E EVIDÊNCIAS", "/* ═══════════ FIM DO BLOCO DO VALIDADOR");
const blocoOrdemIA = fatiar("/* ═══════════ v74.31 — BIBLIOTECA → CONHECIMENTO DA IA", "/* ═══════════ FIM DO v74.31");
const pesquisar = fatiar("async function pesquisarFonteReal(", "/* v74.23 — ÚLTIMO RECURSO");
const dominios = fatiar("const ORDEM_NIVEL = ", "\n/* ═══════════ v74.21 — AGENTE VALIDADOR");
const acervosFns = fatiar("function hostDaUrl(", "const DOMINIOS_VETADOS");
const tokens = fatiar("function tokensDeFonte(", "\nfunction conferenciaDossie(");   // tokensDeFonte + PALAVRAS_VAZIAS_FONTE

/* ---------- O. o fluxo de pesquisarFonteReal ---------- */
const moduloFluxo = `type SistemaPrompt = any;
type FetchRegistro = { url: string; ok: boolean; erro: string };
const LIMITE_FUNCAO_MS = 140_000;
const AREA_LABELS: Record<string, string> = { linguagens: "Linguagens", humanas: "Humanas", natureza: "Natureza" };
const AREAS_FONTES_REAIS_ESTRITO = ["linguagens", "humanas"];
function fontesReaisEstrito(area: string) { return AREAS_FONTES_REAIS_ESTRITO.includes(String(area || "").toLowerCase()); }
function cacheControlAtual() { return { type: "ephemeral" }; }
const SISTEMA_PESQUISA_FONTE = "sistema do pesquisador";
const FERRAMENTA_DOSSIE_FONTE = { name: "entregar_dossie_fonte" };
export const __banco: any = { resposta: null, consultas: [] as any[], guardados: [] as any[] };
async function consultarBancoFontes(o: any, evitar: string[]) { __banco.consultas.push({ o, evitar: [...evitar] }); return __banco.resposta; }
async function guardarNoBancoFontes(o: any, d: any) { __banco.guardados.push({ o, d }); }
export const __enem: any = { resposta: null, consultas: [] as any[] };
async function consultarTextosEnem(o: any, evitar: string[]) { __enem.consultas.push({ o, evitar: [...evitar] }); return __enem.resposta; }
${fatiar("function urlsDaReferencia(", "\nfunction dossieDoTextoEnem(")}
const ACERVOS_PRIORITARIOS: { nome: string; url: string; dominio: string }[] = ${mAcervos[1]};
const DOMINIOS_ACERVO_PRIORITARIO: string[] = Array.from(new Set(ACERVOS_PRIORITARIOS.map((a) => a.dominio)));
${recortaConstArray("DOMINIOS_VETADOS")}
${recortaConstArray("DOMINIOS_NIVEL_A")}
${recortaConstArray("DOMINIOS_NIVEL_B")}
const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", blocked_domains: DOMINIOS_VETADOS, max_uses: 3 };
const BUSCA_PESQUISADOR_ACERVOS = { type: WEB_SEARCH_TOOL.type, name: WEB_SEARCH_TOOL.name, allowed_domains: DOMINIOS_ACERVO_PRIORITARIO, max_uses: 1 };
const BUSCA_PESQUISADOR = { ...WEB_SEARCH_TOOL, max_uses: 1 };
const BUSCA_PESQUISADOR_RETRY = { ...WEB_SEARCH_TOOL, max_uses: 1 };
${recorta("normalizaUrl")}
${recorta("normalizaParaComparar")}
${tokens}
${acervosFns}
${dominios}
${blocoValidador}
${blocoOrdemIA}
${pesquisar}
export const __stub: any = { fila: [] as any[], chamadas: [] as any[] };
async function callClaudeForJSON(_s: any, userMsg: string, ferramentaServidor: any, usos: any[], ferramenta: any, buscas?: any[], etapa = "", fetches?: any[], _timeoutMs?: number) {
  const passo = __stub.fila.shift();
  __stub.chamadas.push({ etapa, ferramentaServidor, ferramentaNome: ferramenta && ferramenta.name, userMsg });
  if (usos) usos.push({ input_tokens: 1, output_tokens: 1, etapa });
  if (!passo) throw new Error("fila do dublê vazia em " + etapa);
  if (passo.erro) throw new Error(passo.erro);
  if (buscas && Array.isArray(passo.buscas)) buscas.push(...passo.buscas);
  if (fetches && Array.isArray(passo.fetches)) fetches.push(...passo.fetches);
  return passo.resposta;
}
export { pesquisarFonteReal, DISCIPLINAS_ORDEM_IA, RODADAS_PESQUISA_UNICA };
`;
const tmp = await Deno.makeTempDir();
await Deno.writeTextFile(`${tmp}/fluxo.ts`, moduloFluxo);
const F: any = await import("file://" + `${tmp}/fluxo.ts`);
const { pesquisarFonteReal, __stub, __banco, __enem } = F;

let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };
const cala = () => { const o = { w: console.warn, l: console.log, e: console.error }; console.warn = () => {}; console.error = () => {}; console.log = (...a: any[]) => { if (/^(PASS|FAIL)/.test(String(a[0]))) o.l(...a); }; return () => { console.warn = o.w; console.log = o.l; console.error = o.e; }; };
const roteiro = (...passos: any[]) => { __stub.fila = passos; __stub.chamadas = []; };
const zera = () => { __enem.resposta = null; __enem.consultas = []; __banco.resposta = null; __banco.consultas = []; __banco.guardados = []; };
const muitoTempo = () => 140_000;
const etapas = () => __stub.chamadas.map((c: any) => c.etapa).join(",");

const iaSemAutor = { pedeAutorOuObra: false, autorPedido: "", obraPedida: "", conheceComSeguranca: false, autor: "", obra: "", anoOriginal: "", referencia: "", parafrase: "",
  fatos: ["Getúlio Vargas chegou ao poder com a Revolução de 1930.", "O Estado Novo foi instaurado em novembro de 1937.", "A Consolidação das Leis do Trabalho (CLT) é de 1943."], fonteDosFatos: "Constituição de 1937 e Decreto-Lei 5.452/1943 (CLT)", idioma: "portugues" };
const iaArendt = { pedeAutorOuObra: true, autorPedido: "Hannah Arendt", obraPedida: "", conheceComSeguranca: true, autor: "Hannah Arendt", obra: "Eichmann em Jerusalém", anoOriginal: "1963",
  referencia: "ARENDT, Hannah. Eichmann em Jerusalém. 1963.", parafrase: "A autora sustenta que crimes de enorme gravidade podem ser cometidos por pessoas comuns, que cumprem ordens sem pensar no sentido do que fazem; o mal, nesse caso, nasce da incapacidade de julgar.",
  fatos: ["O julgamento de Adolf Eichmann ocorreu em Jerusalém, em 1961."], fonteDosFatos: "registros do julgamento", idioma: "portugues" };
const iaNaoSabe = { ...iaArendt, autorPedido: "Autor Pouco Conhecido", conheceComSeguranca: false, autor: "", obra: "", anoOriginal: "", referencia: "", parafrase: "" };
const URL_WEB = "https://www.scielo.br/j/rbh/a/xyz";
const dossieWeb = { encontrou: true, autor: "Autor Pouco Conhecido", instituicao: "", obra: "Ensaio", ano: "2001", referencia: "AUTOR, P. Ensaio. Revista, 2001.", url: URL_WEB, trecho: "Fatos do ensaio.", trechoEhLiteral: false, abriuAFonte: true, comoVerificou: "busca" };
const vAprovado = { status: "aprovado", fonteExiste: true, autorConfirmado: true, obraConfirmada: true, dataConfirmada: "confirmada", referenciaConfere: true, suporteDaEvidencia: "direto", trechoLiteralConfere: "nao_se_aplica", naturezaDoMaterial: "fato_documental", nivelFonte: "A", risco: "baixo", confianca: "alta", afirmacoesComSuporte: ["O ensaio trata do tema."], afirmacoesSemSuporte: [], divergenciaDocumental: "", correcoesNecessarias: [], observacoesAoElaborador: "", comoVerificou: "abri", motivo: "" };
const vRejeita = { ...vAprovado, status: "rejeitar", fonteExiste: false, suporteDaEvidencia: "ausente", confianca: "baixa", afirmacoesComSuporte: [], motivo: "obra não localizada" };

const fala = cala();
/* O1 — tema sem autor nem obra */
zera(); roteiro({ resposta: iaSemAutor });
let buscas: any[] = [];
let r = await pesquisarFonteReal({ area: "humanas", disciplina: "História", tema: "Era Vargas" }, [], buscas, muitoTempo);
t("O1 História, tema sem autor nem obra e sem texto na biblioteca: UMA chamada à IA, SEM internet, e o dossiê é autoral com dados reais",
  etapas() === "pesquisa-ia" && __stub.chamadas[0].ferramentaServidor === false && __stub.chamadas[0].ferramentaNome === "entregar_material_ia"
  && r && r.encontrou === true && r.origemIA === "autoral" && r.validacao.libera === true && r.validacao.estado === "ia_autoral"
  && r.autor === "" && r.referencia === "" && r.trecho.includes("1. Getúlio Vargas chegou ao poder") && buscas.length === 0, etapas());
t("O2 a biblioteca e o banco foram consultados ANTES da IA, na ordem",
  __enem.consultas.length === 1 && __banco.consultas.length === 1);
/* O3 — autor que a IA conhece */
zera(); roteiro({ resposta: iaArendt });
r = await pesquisarFonteReal({ area: "humanas", disciplina: "Filosofia", tema: "Hannah Arendt" }, [], [], muitoTempo);
t("O3 Filosofia, autor que a IA conhece com segurança: paráfrase com referência, UMA chamada, sem internet e sem validador",
  etapas() === "pesquisa-ia" && r.origemIA === "parafrase" && r.validacao.estado === "ia_parafrase" && r.referencia === iaArendt.referencia && r.url === "" && r.trecho === iaArendt.parafrase);
/* O4 — autor que a IA não conhece: 3º passo, questão autoral, sem internet */
zera(); roteiro({ resposta: iaNaoSabe });
buscas = [];
r = await pesquisarFonteReal({ area: "humanas", disciplina: "Sociologia", tema: "Autor Pouco Conhecido" }, [], buscas, muitoTempo);
t("O4 autor que a IA não conhece com segurança, 1º pedido: questão semelhante AUTORAL, com dados reais — UMA chamada, SEM internet",
  etapas() === "pesquisa-ia" && r.origemIA === "autoral" && r.validacao.libera === true && r.autorNaoConfirmado === "Autor Pouco Conhecido"
  && r.pesquisouNaInternet === false && /questão semelhante autoral/.test(r.validacao.motivo) && buscas.length === 0, etapas());
/* O5 — 4º passo: 2º pedido do app (a autoral não passou no auditor), pesquisa única aprovada */
zera(); roteiro({ resposta: iaNaoSabe }, { resposta: dossieWeb, buscas: [{ url: URL_WEB, title: "" }] }, { resposta: vAprovado, buscas: [{ url: URL_WEB, title: "" }] });
buscas = [];
r = await pesquisarFonteReal({ area: "humanas", disciplina: "Sociologia", tema: "Autor Pouco Conhecido", tentativaApp: 2 }, [], buscas, muitoTempo);
t("O5 2º pedido do app (a autoral não passou no auditor): UMA pesquisa na internet (aberta, 1 busca) + o validador; aprovada, vale a fonte da web",
  etapas() === "pesquisa-ia,pesquisa/tentativa-1,validacao/rodada-1" && __stub.chamadas[1].ferramentaServidor && __stub.chamadas[1].ferramentaServidor.max_uses === 1
  && !("allowed_domains" in __stub.chamadas[1].ferramentaServidor) && r.validacao.estado === "aprovado" && r.url === URL_WEB && !r.origemIA && __banco.guardados.length === 1, etapas());
zera(); roteiro({ resposta: iaNaoSabe }, { resposta: dossieWeb, buscas: [{ url: URL_WEB, title: "" }] }, { resposta: vRejeita, buscas: [] });
r = await pesquisarFonteReal({ area: "humanas", disciplina: "Sociologia", tema: "Autor Pouco Conhecido", tentativaApp: 2 }, [], [], muitoTempo);
t("O6 a pesquisa única não confirmou a fonte: NÃO há segunda rodada — volta a questão semelhante AUTORAL, marcada como pesquisada",
  etapas() === "pesquisa-ia,pesquisa/tentativa-1,validacao/rodada-1" && r.encontrou === true && r.origemIA === "autoral" && r.validacao.libera === true
  && r.autorNaoConfirmado === "Autor Pouco Conhecido" && r.pesquisouNaInternet === true && r.rodadas === 1 && r.fontesTentadas.length === 1 && /pesquisa única/.test(r.validacao.motivo), etapas());
zera(); roteiro({ resposta: iaNaoSabe }, { resposta: { ...dossieWeb, encontrou: false, trecho: "" }, buscas: [] });
r = await pesquisarFonteReal({ area: "humanas", disciplina: "Geografia", tema: "Autor Pouco Conhecido", tentativaApp: 2 }, [], [], muitoTempo);
t("O6b a pesquisa única nem achou fonte: o validador não é chamado e volta a questão autoral",
  etapas() === "pesquisa-ia,pesquisa/tentativa-1" && r.origemIA === "autoral" && r.autorNaoConfirmado === "Autor Pouco Conhecido" && r.pesquisouNaInternet === true);
zera(); roteiro({ resposta: iaNaoSabe });
r = await pesquisarFonteReal({ area: "humanas", disciplina: "Filosofia", tema: "Autor Pouco Conhecido", tentativaApp: 3 }, [], [], muitoTempo);
t("O6c a pesquisa é ÚNICA: no 3º pedido do app não se pesquisa de novo — questão autoral, sem internet",
  etapas() === "pesquisa-ia" && r.origemIA === "autoral" && r.pesquisouNaInternet === false);
zera(); roteiro({ resposta: iaSemAutor });
r = await pesquisarFonteReal({ area: "humanas", disciplina: "História", tema: "Era Vargas", tentativaApp: 2 }, [], [], muitoTempo);
t("O6d tema sem autor nem obra nunca vai à internet, nem no 2º pedido do app", etapas() === "pesquisa-ia" && r.origemIA === "autoral" && !r.autorNaoConfirmado);
zera(); roteiro({ resposta: iaArendt });
r = await pesquisarFonteReal({ area: "humanas", disciplina: "Filosofia", tema: "Hannah Arendt", tentativaApp: 2 }, [], [], muitoTempo);
t("O6e autor que a IA conhece: a paráfrase vale também no 2º pedido (a internet é só para o que a IA não conhece)", etapas() === "pesquisa-ia" && r.origemIA === "parafrase");
/* O7 — biblioteca e banco primeiro */
zera(); __enem.resposta = { encontrou: true, doEnem: { chave: "k" }, referencia: "REF", validacao: { libera: true, estado: "aprovado_enem" } }; roteiro();
r = await pesquisarFonteReal({ area: "humanas", disciplina: "História", tema: "Era Vargas" }, [], [], muitoTempo);
t("O7 havendo texto na biblioteca, é ele: nenhuma chamada à IA nem à internet", r === __enem.resposta && __stub.chamadas.length === 0);
zera(); __banco.resposta = { encontrou: true, doBanco: { id: 1 }, url: "https://www.ibge.gov.br/x", validacao: { libera: true, estado: "aprovado_banco" } }; roteiro();
r = await pesquisarFonteReal({ area: "linguagens", disciplina: "Práticas Corporais", tema: "Capoeira" }, [], [], muitoTempo);
t("O8 banco de fontes já validadas continua no 1º passo, sem chamada à IA", r === __banco.resposta && __stub.chamadas.length === 0);
/* O9 — Língua Estrangeira entra; Literatura não muda */
zera(); roteiro({ resposta: { ...iaSemAutor, idioma: "ingles" } });
r = await pesquisarFonteReal({ area: "linguagens", disciplina: "Língua Estrangeira (Inglês/Espanhol)", tema: "social media" }, [], [], muitoTempo);
t("O9 Língua Estrangeira segue a mesma ordem: autoral, sem internet, com o idioma escolhido", etapas() === "pesquisa-ia" && r.origemIA === "autoral" && r.idioma === "ingles");
zera(); roteiro();
r = await pesquisarFonteReal({ area: "linguagens", disciplina: "Literatura", tema: "Machado de Assis" }, [], [], muitoTempo);
t("O10 Literatura (e Língua Portuguesa e Artes) NÃO chamam a IA: continuam só na biblioteca, como na v74.28",
  __stub.chamadas.length === 0 && r && r.encontrou === false && r.semPesquisaWeb === true);
/* O11 — falha da IA e lista a evitar */
zera(); roteiro({ erro: "API fora do ar" });
r = await pesquisarFonteReal({ area: "humanas", disciplina: "História", tema: "Canudos" }, [], [], muitoTempo);
t("O11 a chamada à IA falhou: sem saber se o tema pede autor, NÃO pesquisa na internet — devolve o bloqueio e o app repete o pedido",
  etapas() === "pesquisa-ia" && r.encontrou === false && r.bloqueado === true);
zera(); roteiro({ resposta: iaArendt });
r = await pesquisarFonteReal({ area: "humanas", disciplina: "Filosofia", tema: "Hannah Arendt", fontesEvitar: ["Hannah Arendt — Eichmann em Jerusalém"] }, [], [], muitoTempo);
t("O12 obra que o app mandou evitar (auditor reprovou antes) não volta como paráfrase: vai para a questão autoral, sem internet",
  etapas() === "pesquisa-ia" && r.origemIA === "autoral" && r.autorNaoConfirmado === "Hannah Arendt" && __stub.chamadas[0].userMsg.includes("A evitar"));
zera(); roteiro();
r = await pesquisarFonteReal({ area: "natureza", disciplina: "Biologia", tema: "t" }, [], [], muitoTempo);
t("O13 fora de Linguagens e Humanas nada muda: null, sem chamada", r === null && __stub.chamadas.length === 0);
fala();

/* ---------- B. consultarTextosEnem: Língua Estrangeira e rodízio ---------- */
const moduloBiblioteca = `
const LETRAS_ALT_FONTE = ["A", "B", "C", "D", "E"];
const MAX_FONTES_EVITAR = 12;
export const __b: any = { tabela: [] as any[], consultas: 0 };
const supabase: any = {
  from(_t: string) {
    const q: any = { _f: {} as any, _id: null as any,
      select() { return q; }, in(_c: string, v: string[]) { q._f.in = v; return q; }, eq(c: string, v: any) { if (c === "id") q._id = v; else q._f[c] = v; return q; },
      order() { return q; },
      range(a: number, b: number) { __b.consultas++; return Promise.resolve({ data: __b.tabela.filter((r: any) => (!q._f.in || q._f.in.includes(r.disciplina)) && r.aproveitavel === true).slice(a, b + 1), error: null }); },
      maybeSingle() { return Promise.resolve({ data: __b.tabela.find((r: any) => r.id === q._id) || null, error: null }); },
      update() { return { eq() { return Promise.resolve({}); } }; } };
    return q;
  },
};
function cacheControlAtual() { return { type: "ephemeral" }; }
async function callClaudeForJSON() { return null; }
${fatiar("const TEXTOS_ENEM_MINIMO_PONTOS", "function normalizaTemaEnem(")}
${recorta("normalizaTemaEnem")}${recorta("radicalEnem")}${recorta("chaveEvitarEnem")}${recorta("pontuaTextoEnem")}${recorta("urlsDaReferencia")}
${tokens}
${recorta("normalizaUrl")}${recorta("fonteEstaNaListaDeEvitar")}${recorta("normalizaParaComparar")}
${fatiar("/* ═══════════ v74.28 — BIBLIOTECA", "/* ═══════════ FIM DA BIBLIOTECA (v74.28)")}
${recorta("dossieDoTextoEnem")}${recorta("consultarTextosEnem", "async function ")}
${blocoOrdemIA}
export { consultarTextosEnem, usadoHaPouco, pedeEspanhol };
`;
await Deno.writeTextFile(`${tmp}/bib.ts`, moduloBiblioteca);
const B: any = await import("file://" + `${tmp}/bib.ts`);
const { __b } = B;
const agora = Date.now();
const linha = (id: number, disciplina: string, temas: string[], usos = 0, minutosAtras = 99999, extra: any = {}) => ({ id, chave: `k-${id}`, ano: 2020, numero: id, prova: "Fuvest 2020", disciplina, aproveitavel: true,
  tipo_texto: "jornalistico", autor: "Autor " + id, instituicao: "", obra: "Obra " + id, ano_obra: "", temas, referencia: `AUTOR ${id}. Obra ${id}. 2020.`, texto: `Texto ${id}.`,
  comando_original: "c", alternativas_originais: { A: "a", B: "b", C: "c", D: "d", E: "e" }, gabarito_original: "A", habilidade_original: "", usos,
  updated_at: new Date(agora - minutosAtras * 60_000).toISOString(), ...extra });
const fala2 = cala();
__b.tabela = [linha(1, "Língua Estrangeira", ["redes sociais", "instagram", "adolescentes"])];
let rb = await B.consultarTextosEnem({ disciplina: "Língua Estrangeira (Inglês/Espanhol)", tema: "redes sociais" }, []);
t("B1 Língua Estrangeira passou a usar a biblioteca (tema em português casa com os temas catalogados)", rb && rb.doEnem && rb.doEnem.chave === "k-1");
__b.consultas = 0;
rb = await B.consultarTextosEnem({ disciplina: "Língua Estrangeira (Inglês/Espanhol)", tema: "redes sociais em espanhol" }, []);
t("B2 tema que pede espanhol não consulta a biblioteca (só há textos em inglês)", rb === null && __b.consultas === 0);
__b.tabela = [linha(2, "História", ["cruzadas", "terra santa"], 3, 60)];
rb = await B.consultarTextosEnem({ disciplina: "História", tema: "Cruzadas na Terra Santa" }, []);
t("B3 rodízio: o único texto que casa foi usado há 1 hora — não se repete; segue para o próximo passo", rb === null);
__b.tabela = [linha(2, "História", ["cruzadas", "terra santa"], 3, 60), linha(3, "História", ["cruzadas", "terra santa", "igreja"], 1, 300)];
rb = await B.consultarTextosEnem({ disciplina: "História", tema: "Cruzadas na Terra Santa" }, []);
t("B4 rodízio: havendo outro texto que casa (usado há mais de 3 horas), é ele que vem", rb && rb.doEnem.chave === "k-3");
__b.tabela = [linha(4, "Literatura", ["romantismo", "indianismo"], 3, 60)];
rb = await B.consultarTextosEnem({ disciplina: "Literatura", tema: "Indianismo" }, []);
t("B5 Literatura não entra no rodízio (comportamento da v74.28 mantido)", rb && rb.doEnem.chave === "k-4");
__b.tabela = [linha(5, "História", ["cruzadas"], 0, 5)];
rb = await B.consultarTextosEnem({ disciplina: "História", tema: "Cruzadas" }, []);
t("B6 texto recém-carregado (0 usos) não conta como usado", rb && rb.doEnem.chave === "k-5");
fala2();
t("B7 a leitura da biblioteca traz updated_at (é o relógio do rodízio)",
  fonte.includes('.select("id, chave, temas, autor, instituicao, obra, referencia, usos, updated_at")'));
t("B8 pedeEspanhol reconhece espanhol/español/hispânico/castelhano e não confunde com inglês",
  B.pedeEspanhol("texto em Espanhol") && B.pedeEspanhol("cultura hispânica") && B.pedeEspanhol("español") && B.pedeEspanhol("castelhano") && !B.pedeEspanhol("environment") && !B.pedeEspanhol("inglês"));

/* ---------- H. ligação no handler e no selftest ---------- */
t("H1 o handler devolve ao app de onde veio o material da IA e passa o número do pedido à pesquisa",
  fonte.includes("if (dossie && dossie.origemIA) fontesDiag.conhecimentoIA = { modo: String(dossie.origemIA)")
  && fonte.includes("pesquisarFonteReal({ area, disciplina, tema, eixoTematico, recorte, fontesEvitar, usarBanco, usarTextosEnem, tentativaApp }"));
t("H2 o selftest confere a ordem nova e inclui as funções novas na impressão digital",
  fonte.includes("v7431_ordemIA: (() => {") && fonte.includes("usaOrdemIA.toString(), usadoHaPouco.toString(), pedeEspanhol.toString()")
  && fonte.includes("buildBlocoConhecimentoIA.toString(), buildBlocoAuditoriaIA.toString(), consultarTextosEnem.toString()"));
t("H3 nada mudou para Literatura, Língua Portuguesa e Artes",
  fonte.includes('const DISCIPLINAS_SEM_PESQUISA_WEB = ["Literatura", "Língua Portuguesa", "Artes"];')
  && !F.DISCIPLINAS_ORDEM_IA.some((d: string) => ["Literatura", "Língua Portuguesa", "Artes"].includes(d)) && F.RODADAS_PESQUISA_UNICA === 1);

console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
if (bad) Deno.exit(1);

/* v74.29 — CUSTO SEM MEXER NA QUALIDADE (generate-question, 26/09/2026).

   Na leva de 26/09 (9 questões de Literatura, US$ 1,06) metade do gasto foi reescrita:
     · a conferência das alternativas gravava um cache só dela (≈ US$ 0,05 por gravação);
     · duas questões vieram de fonte "restrita ao confirmado" do banco de fontes e foram
       reescritas (uma reprovada depois de duas reescritas);
     · uma trocou o poema da biblioteca por outro do mesmo autor, de memória;
     · e o campo "fonte" de outra trazia uma instituição fora da referência.

   Prova, SEM chamar a Anthropic e SEM banco de verdade:
     A. geração, reescrita e correções dirigidas (alternativas, gabarito, idioma) declaram a
        MESMA lista de ferramentas — só o tool_choice muda —; com busca na web, nada muda;
     B. o banco de fontes, sem pesquisa na internet, pula a fonte restrita (e só aí);
     C. o bloco do texto da biblioteca proíbe trocar o texto por outro do mesmo autor;
     D. a ligação no handler, no aquecimento do cache e no selftest.
   (O campo "fonte" completado pelo dossiê é provado em verify_fontes_backend.ts, série R.)

   Uso:
     deno run --allow-read --allow-write --allow-env tests/verify_custo_v7429.ts supabase/functions/generate-question/index.ts  */
const alvo = Deno.args[0] || "supabase/functions/generate-question/index.ts";
const fonte = await Deno.readTextFile(alvo);
function recorta(nome: string, prefixo = "function "): string {
  const ini = fonte.indexOf(`\n${prefixo}${nome}(`);
  if (ini < 0) { console.error(`FALHA: não achei ${prefixo}${nome} em ${alvo}`); Deno.exit(1); }
  const fim = fonte.indexOf("\n}\n", ini);
  return fonte.slice(ini, fim + 3);
}
function constObjeto(nome: string): string {
  const ini = fonte.indexOf(`\nconst ${nome} = {`);
  if (ini < 0) { console.error(`FALHA: não achei const ${nome}`); Deno.exit(1); }
  const fim = fonte.indexOf("\n};\n", ini);
  return fonte.slice(ini, fim + 4);
}
function entre(a: string, b: string): string {
  const i = fonte.indexOf(a), j = fonte.indexOf(b, i);
  if (i < 0 || j < 0) { console.error(`FALHA: não achei o trecho ${a.slice(0, 40)}`); Deno.exit(1); }
  return fonte.slice(i, j);
}
const modulo = `
type FerramentaServidor = any;
const LETRAS_ALT_FONTE = ["A", "B", "C", "D", "E"];
export const __d: any = { linhas: [] as any[] };
const supabase: any = {
  from(_t: string) {
    const q: any = { select() { return q; }, eq() { return q; }, order() { return q; },
      limit() { return Promise.resolve({ data: __d.linhas, error: null }); },
      update() { return { eq() { return Promise.resolve({}); } }; } };
    return q;
  },
};
${constObjeto("FERRAMENTA_ALTERNATIVAS")}
${constObjeto("FERRAMENTA_GABARITO")}
${constObjeto("FERRAMENTA_IDIOMA")}
${recorta("montaFerramentas")}${recorta("ferramentasDaQuestao")}
${entre("function tokensDeFonte(", "\n/* Palavras que aparecem")}
${entre("const PALAVRAS_VAZIAS_FONTE", "\n]);\n")}
]);
${recorta("normalizaUrl")}${recorta("fonteEstaNaListaDeEvitar")}
${entre("const BANCO_FONTES_MINIMO_TOKENS", "async function consultarBancoFontes(")}
${recorta("consultarBancoFontes", "async function ")}
export { montaFerramentas, ferramentasDaQuestao, consultarBancoFontes, FERRAMENTA_ALTERNATIVAS, FERRAMENTA_GABARITO, FERRAMENTA_IDIOMA };
`;
const tmp = await Deno.makeTempDir();
await Deno.writeTextFile(`${tmp}/custo.ts`, modulo);
const M: any = await import(`file://${tmp}/custo.ts`);
const { __d } = M;

let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };
const cala = () => { const o = { w: console.warn, l: console.log }; console.warn = () => {}; console.log = (...a: any[]) => { if (/^(PASS|FAIL)/.test(String(a[0]))) o.l(...a); }; return () => { console.warn = o.w; console.log = o.l; }; };

/* ---------- A. a mesma lista de ferramentas ---------- */
const Q = { name: "entregar_questao", description: "q", input_schema: { type: "object", properties: { fonte: { type: "object" } } } };
const fam = M.ferramentasDaQuestao(Q);
const ger = M.montaFerramentas(false, Q, fam), alt = M.montaFerramentas(false, M.FERRAMENTA_ALTERNATIVAS, fam);
const gab = M.montaFerramentas(false, M.FERRAMENTA_GABARITO, fam), idi = M.montaFerramentas(false, M.FERRAMENTA_IDIOMA, fam);
t("A1 a família é questão + alternativas + gabarito + idioma, nesta ordem",
  fam.map((f: any) => f.name).join() === "entregar_questao,entregar_alternativas,entregar_gabarito,entregar_item_em_portugues");
t("A2 geração, alternativas, gabarito e idioma mandam a MESMA lista (mesmo JSON = mesmo prefixo de cache)",
  JSON.stringify(ger.tools) === JSON.stringify(alt.tools) && JSON.stringify(ger.tools) === JSON.stringify(gab.tools) && JSON.stringify(ger.tools) === JSON.stringify(idi.tools));
t("A3 só o tool_choice muda, e ele continua OBRIGANDO a ferramenta da etapa",
  ger.tool_choice.type === "tool" && ger.tool_choice.name === "entregar_questao" && alt.tool_choice.name === "entregar_alternativas"
  && gab.tool_choice.name === "entregar_gabarito" && idi.tool_choice.name === "entregar_item_em_portugues");
const web = { type: "web_search_20250305", name: "web_search" };
const comWeb = M.montaFerramentas(web, Q, fam);
t("A4 com busca na web a família NÃO entra: [busca, questão] e escolha automática, como antes",
  comWeb.tools.length === 2 && comWeb.tools[0].name === "web_search" && comWeb.tools[1].name === "entregar_questao" && comWeb.tool_choice.type === "auto");
t("A5 sem família (demais etapas) a chamada fica como antes: só a ferramenta da etapa",
  JSON.stringify(M.montaFerramentas(false, M.FERRAMENTA_ALTERNATIVAS, null)) === JSON.stringify({ tools: [M.FERRAMENTA_ALTERNATIVAS], tool_choice: { type: "tool", name: "entregar_alternativas" } }));
const outra = { name: "entregar_recortes", input_schema: {} };
t("A6 ferramenta que não é da família ignora a lista declarada (não carrega ferramenta alheia)",
  JSON.stringify(M.montaFerramentas(false, outra, fam).tools) === JSON.stringify([outra]));
t("A7 sem ferramenta nenhuma: corpo sem tools (planejamento sem ferramenta continua igual)",
  JSON.stringify(M.montaFerramentas(false, null, null)) === "{}" && JSON.stringify(M.montaFerramentas(false, null, fam)) === "{}");
t("A8 a busca na web sozinha continua saindo como antes", JSON.stringify(M.montaFerramentas(web, null, null)) === JSON.stringify({ tools: [web], tool_choice: { type: "auto" } }));

/* ---------- B. banco de fontes sem fonte restrita (só sem pesquisa na internet) ---------- */
const linha = (id: number, restrito: boolean, obra: string) => ({ id, tema_chave: "", autor: "Clarice Lispector", instituicao: "UFPE", obra, ano: "2015",
  referencia: `UFPE. ${obra}. Recife, 2015.`, url: `https://ufpe.br/${id}`, trecho: "t", trecho_literal: false, restrito, nivel: "A",
  validacao: { estado: restrito ? "aprovado_restrito" : "aprovado" }, usos: 0 });
__d.linhas = [linha(1, true, "Epifania em Clarice Lispector"), linha(2, false, "A hora da estrela de Clarice Lispector")];
let volta = cala();
const pedido = { area: "linguagens", disciplina: "Literatura", tema: "Clarice Lispector e a epifania", recorte: "" };
const b1 = await M.consultarBancoFontes(pedido, [], true);
const b2 = await M.consultarBancoFontes(pedido, [], false);
__d.linhas = [linha(1, true, "Epifania em Clarice Lispector")];
const b3 = await M.consultarBancoFontes(pedido, [], true);
volta();
t("B1 sem pesquisa na internet, a fonte restrita é pulada e vem a de texto liberado", !!b1 && b1.doBanco.id === 2 && b1.restritoAoConfirmado === false, JSON.stringify(b1 && b1.doBanco));
t("B2 nas demais disciplinas nada muda: a restrita continua disputando (e ganha, aqui, pela pontuação)", !!b2 && b2.doBanco.id === 1 && b2.validacao.estado === "aprovado_restrito", JSON.stringify(b2 && b2.doBanco));
t("B3 só havia fonte restrita: o banco não devolve nada (o fluxo segue para o texto da biblioteca)", b3 === null);
t("B4 o fluxo liga o filtro pela disciplina e mantém a ordem: biblioteca → banco → texto mais próximo",
  fonte.includes("const doBanco = await consultarBancoFontes(o, evitar, semPesquisaWeb(o.disciplina));")
  && fonte.indexOf("await consultarTextosEnem(o, evitar)") < fonte.indexOf("await consultarBancoFontes(o, evitar, semPesquisaWeb(o.disciplina))")
  && fonte.indexOf("await consultarBancoFontes(o, evitar, semPesquisaWeb(o.disciplina))") < fonte.indexOf("const proximo = await consultarTextoMaisProximo(o, evitar);"));

/* ---------- C. o texto da biblioteca não se troca ---------- */
const bloco = recorta("buildBlocoTextoEnem");
t("C1 o bloco do texto da biblioteca proíbe trocar o texto por outro, mesmo do mesmo autor ou da mesma obra",
  bloco.includes("· O TEXTO-BASE É ESTE: a questão se faz sobre este texto (ou um recorte dele).")
  && bloco.includes("nem do mesmo autor, nem da mesma obra") && bloco.includes("texto trocado reprova a questão na auditoria"));
t("C2 a regra vale para ENEM e para as demais provas (fica fora dos trechos condicionais)",
  bloco.indexOf("· O TEXTO-BASE É ESTE") > bloco.indexOf("prevalece o texto.") && bloco.indexOf("· O TEXTO-BASE É ESTE") < bloco.indexOf("${e.aproximado ?"));

/* ---------- D. ligação ---------- */
t("D1 o handler monta a ferramenta da questão uma vez e a família com ela",
  fonte.includes("const ferramentaQ = ferramentaQuestaoPara(recurso, fontesReaisEstrito(area), disciplina);\n    const familiaQ = ferramentasDaQuestao(ferramentaQ);"));
t("D2 a geração declara a família só sem busca na web",
  fonte.includes('let data = await callClaudeForJSON(system, userMsg, webSearch, usos, ferramentaQ, buscasWeb, "geracao", undefined, undefined, webSearch ? null : familiaQ);'));
t("D3 reescrita pedida pelo auditor, gabarito e alternativas (antes e depois da reescrita) declaram a família",
  fonte.includes("usos, ferramentaQ, buscasWeb, `geracao/reelaboracao-${reelaboracoes}`, undefined, undefined, familiaQ);")
  && fonte.includes("data, system, usos, LIMITE_FUNCAO_MS - (Date.now() - inicioReq), familiaQ,\n    );")
  && (fonte.match(/data, system, usos, LIMITE_FUNCAO_MS - \(Date\.now\(\) - inicioReq\), familiaQ,/g) || []).length === 2
  && fonte.includes("const gd2 = await garantirGabaritoCoerente(nova, system, usos, LIMITE_FUNCAO_MS - (Date.now() - inicioReq), familiaQ);")
  && fonte.includes("const ad2 = await garantirAlternativasConformes(nova, system, usos, LIMITE_FUNCAO_MS - (Date.now() - inicioReq), familiaQ);"));
t("D4 as correções repassam a lista até a chamada (alternativas, idioma e gabarito)",
  fonte.includes("FERRAMENTA_ALTERNATIVAS, undefined, `alternativas-${tentativa}`, undefined, undefined, declaradas);")
  && fonte.includes("FERRAMENTA_IDIOMA, undefined, `idioma-${tentativa}`, undefined, undefined, declaradas);")
  && fonte.includes('FERRAMENTA_GABARITO, undefined, "gabarito", undefined, undefined, declaradas);')
  && fonte.includes("const di = await passarItemParaPortugues(data, system, usos, prazo, pIdioma.detalhe, declaradas);"));
t("D5 callClaudeForJSON repassa a lista nas três chamadas (primeira, truncada, JSON inválido)",
  (fonte.match(/enableWebSearch, ferramenta, timeoutMs, declaradas\);/g) || []).length === 3
  && fonte.includes("...montaFerramentas(enableWebSearch, ferramenta, declaradas),"));
t("D6 o aquecimento do cache grava o MESMO prefixo da geração (com a família)",
  fonte.includes('await tentar("geracao", sistemaGeracao, ferramentaQ, ferramentasDaQuestao(ferramentaQ));')
  && fonte.includes('const r = await callClaude(sistema, "ok", 16, false, ferramenta, 240_000, declaradas);'));
t("D7 o selftest de produção confere a v74.29 e as funções novas entram na impressão digital",
  fonte.includes("v7429_custo: (() => {") && fonte.includes("montaFerramentas.toString(), ferramentasDaQuestao.toString(), corrigeFonteDoDossie.toString()"));
t("D8 o campo \"fonte\" completado pelo dossiê está ligado na conferência estrutural, com desfazer",
  fonte.includes("const campos = corrigeFonteDoDossie(data, dossiePrevio, det.estado);") && fonte.includes("data.fonte = fonteAntes;")
  && fonte.includes("diag.fonteCompletadaPeloDossie = campos;"));

console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
if (bad) Deno.exit(1);

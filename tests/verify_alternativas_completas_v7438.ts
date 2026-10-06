/* v74.38 — AS CINCO ALTERNATIVAS, SEMPRE (generate-question), SEM CHAMAR A ANTHROPIC.

   Caso real (06/10/2026): simulado de Matemática "Cilindros, prismas, esferas, troncos" — a questão 6
   chegou ao professor sem alternativas. No arquivo, data.alternativas era a STRING
   "\n<parameter name=\"A\">20%." e B, C, D, E estavam soltas na raiz da questão; a questão 9 tinha
   alternativas = {} e B–E soltas (A perdida). Ninguém conferia se as cinco estavam lá: a questão saiu
   "pronta" com uma chamada só. Aqui se prova, com as funções recortadas do arquivo:
     A. REPARO EM CÓDIGO (normalizarCamposEstruturados): parâmetros vazados desdobrados, letras soltas
        recolhidas (texto → alternativas; {status, comentario} → analiseAlternativas), lista → A–E,
        número → texto; questão sã passa intacta;
     B. COMPLETAR SÓ O QUE FALTA (aplicaAlternativasFaltantes): só a letra faltante entra; as outras
        ficam idênticas mesmo que o modelo as mude; recusa vazia, repetida, vazada, fora do tamanho e
        sem comentário; status da letra escrita;
     C. o pedido (buildAlternativasFaltantesPrompt) e a ordem de refazer (buildCorrecaoAlternativasIncompletas);
     D. o handler: porteira logo depois da geração (antes do visual e do revisor), refazer uma vez,
        erro 502 em vez de questão sem alternativas, reposição após o revisor, reescrita do auditor
        também conferida, resposta com completasDiag, selftest e impressão digital.
   Uso: deno run -A tests/verify_alternativas_completas_v7438.ts supabase/functions/generate-question/index.ts */
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
const console = { log() {}, warn() {}, error() {} };
${entre("const LETRAS_ALTERNATIVAS = [", "\n")}
${recorta("desescaparJsonString")}${recorta("objetoDeString")}${recorta("alternativasDeString")}${recorta("alternativasUtilizaveis")}
${entre("const RE_PARAMETRO_VAZADO", "\n")}
${recorta("objetoDeParametrosVazados")}${recorta("recolheLetrasSoltas")}${recorta("letrasFaltantes")}${recorta("normalizarCamposEstruturados")}
${recorta("normalizaAlternativa")}${recorta("conferenciaGabarito")}
${entre("const ALTERNATIVAS_FALTANTES_MAX", "\n")}
${recorta("buildAlternativasFaltantesPrompt")}${recorta("aplicaAlternativasFaltantes")}${recorta("buildCorrecaoAlternativasIncompletas")}
export { objetoDeParametrosVazados, recolheLetrasSoltas, letrasFaltantes, normalizarCamposEstruturados, alternativasUtilizaveis, buildAlternativasFaltantesPrompt, aplicaAlternativasFaltantes, buildCorrecaoAlternativasIncompletas, ALTERNATIVAS_FALTANTES_MAX, RE_PARAMETRO_VAZADO };
`;
const tmp = await Deno.makeTempDir();
await Deno.writeTextFile(`${tmp}/cinco.ts`, modulo);
const M: any = await import(`file://${tmp}/cinco.ts`);

let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };
const L5 = ["A", "B", "C", "D", "E"];
const an = (c: string) => Object.fromEntries(L5.map((L) => [L, { status: L === c ? "correta" : "incorreta", comentario: "c" + L }]));

/* ---------- A. reparo em código ---------- */
const q6 = M.normalizarCamposEstruturados({ textoBase: "t", comando: "c", gabarito: "B", alternativas: '\n<parameter name="A">20%.', B: "44%.", C: "40%.", D: "60%.", E: "728%.", analiseAlternativas: an("B") });
t("A1 questão 6 real: alternativas = string com <parameter name=\"A\"> e B–E soltas → as cinco no objeto, nenhuma letra na raiz, nada faltando",
  M.alternativasUtilizaveis(q6.alternativas) && q6.alternativas.A === "20%." && q6.alternativas.B === "44%." && q6.alternativas.E === "728%." && !("B" in q6) && !("C" in q6) && !("D" in q6) && !("E" in q6) && M.letrasFaltantes(q6).length === 0, JSON.stringify(q6.alternativas));
const q9 = M.normalizarCamposEstruturados({ textoBase: "t", comando: "c", gabarito: "D", alternativas: {}, B: "correta, pois troncos são cilíndricos.", C: "subestimada, pois a base tem menor raio.", D: "superestimada, pois tratou o tronco como cilindro.", E: "superestimada, pois usou o raio no diâmetro.", analiseAlternativas: an("D") });
t("A2 questão 9 real: alternativas = {} e B–E soltas (A perdida) → B–E recolhidas, raiz limpa, falta só a A", M.letrasFaltantes(q9).join() === "A" && q9.alternativas.D === "superestimada, pois tratou o tronco como cilindro." && !("B" in q9) && !("E" in q9), JSON.stringify(q9.alternativas));
const v1 = M.objetoDeParametrosVazados('\n<parameter name="A">20%.</parameter>\n<parameter name="B">44%.</parameter><parameter name="C">60%.');
const v2 = M.objetoDeParametrosVazados('<parameter name="analise">{"A": {"status": "correta", "comentario": "x"}}</parameter>');
t("A3 objetoDeParametrosVazados: com e sem </parameter>, valor até o próximo parâmetro; valor JSON vira objeto; sem marcação → null; chave repetida não sobrescreve",
  !!v1 && v1.A === "20%." && v1.B === "44%." && v1.C === "60%." && !!v2 && v2.analise && v2.analise.A.status === "correta" && M.objetoDeParametrosVazados("sem nada") === null && M.objetoDeParametrosVazados(12 as any) === null
  && M.objetoDeParametrosVazados('<parameter name="A">1</parameter><parameter name="A">2</parameter>').A === "1", JSON.stringify([v1, v2]));
const lista = M.normalizarCamposEstruturados({ alternativas: ["20%.", "44%.", 60, "72,8%.", "144%."] });
const numero = M.normalizarCamposEstruturados({ alternativas: { A: 20, B: "44%.", C: "60%.", D: "72,8%.", E: "144%." } });
t("A4 lista de cinco vira A–E (número vira texto); número dentro do objeto vira texto", M.alternativasUtilizaveis(lista.alternativas) && lista.alternativas.C === "60" && lista.alternativas.A === "20%." && numero.alternativas.A === "20" && M.alternativasUtilizaveis(numero.alternativas), JSON.stringify([lista.alternativas, numero.alternativas]));
const anStr = M.normalizarCamposEstruturados({ alternativas: { A: "a", B: "b", C: "c", D: "d", E: "e" }, analiseAlternativas: '<parameter name="A">{"status": "correta", "comentario": "x"}</parameter><parameter name="B">{"status": "incorreta", "comentario": "y"}' });
t("A5 analiseAlternativas como texto com parâmetros vazados é desdobrada em objeto por letra", anStr.analiseAlternativas && anStr.analiseAlternativas.A.status === "correta" && anStr.analiseAlternativas.B.comentario === "y", JSON.stringify(anStr.analiseAlternativas));
const solta = M.normalizarCamposEstruturados({ alternativas: { A: "a", B: "b", C: "c", D: "d", E: "e" }, analiseAlternativas: { A: { status: "correta", comentario: "x" } }, B: { status: "incorreta", comentario: "y" }, C: "texto que não substitui a C existente" });
t("A6 letra solta que é {status, comentario} vai para analiseAlternativas; letra solta de texto NÃO sobrescreve alternativa existente; as duas saem da raiz",
  solta.analiseAlternativas.B.comentario === "y" && solta.alternativas.B === "b" && solta.alternativas.C === "c" && !("B" in solta) && !("C" in solta), JSON.stringify(solta));
const sa = { textoBase: "t", comando: "c", gabarito: "B", alternativas: { A: "a.", B: "b.", C: "c.", D: "d.", E: "e." }, analiseAlternativas: an("B"), competencia: { numero: 1 }, habilidade: { codigo: "H1" } };
const saDepois = M.normalizarCamposEstruturados(JSON.parse(JSON.stringify(sa)));
t("A7 questão sã passa intacta pelo reparo (idempotente)", JSON.stringify(saDepois) === JSON.stringify(sa), JSON.stringify(saDepois));

/* ---------- B. completar só o que falta ---------- */
const base: any = { textoBase: "t", comando: "c", gabarito: "D", alternativas: { B: "correta, pois troncos de eucalipto são cilíndricos.", C: "subestimada, pois a base tem menor raio que a ponta.", D: "superestimada, pois tratou o tronco como cilindro.", E: "superestimada, pois usou o raio no lugar do diâmetro." }, analiseAlternativas: { ...an("D"), A: { status: "incorreta", comentario: "inversão de polaridade" } } };
const A_OK = "subestimada, pois ignorou o afinamento do tronco.";
const okA = M.aplicaAlternativasFaltantes(base, { alternativas: { ...base.alternativas, A: A_OK, B: "MUDOU a B de propósito." }, comentarios: { A: "usar o maior raio aumenta o volume calculado" }, resolucaoComentada: "" }, ["A"]);
t("B1 só a A entra; a B que o modelo mudou volta IDÊNTICA; comentário da A atualizado; status incorreta; cinco utilizáveis; original não é alterado no lugar",
  okA.ok && okA.nova.alternativas.A === A_OK && okA.nova.alternativas.B === base.alternativas.B && okA.nova.analiseAlternativas.A.comentario === "usar o maior raio aumenta o volume calculado" && okA.nova.analiseAlternativas.A.status === "incorreta"
  && M.alternativasUtilizaveis(okA.nova.alternativas) && !("A" in base.alternativas), JSON.stringify(okA));
const semC = M.aplicaAlternativasFaltantes(base, { alternativas: { ...base.alternativas, A: A_OK }, comentarios: {}, resolucaoComentada: "" }, ["A"]);
t("B2 sem comentário novo, vale o comentário já registrado para a letra", semC.ok && semC.nova.analiseAlternativas.A.comentario === "inversão de polaridade", JSON.stringify(semC));
const semNada = M.aplicaAlternativasFaltantes({ ...base, analiseAlternativas: { ...an("D"), A: {} } }, { alternativas: { ...base.alternativas, A: A_OK }, comentarios: {}, resolucaoComentada: "" }, ["A"]);
t("B3 sem comentário novo NEM registrado → recusa", !semNada.ok && semNada.motivo.includes("comentário"), JSON.stringify(semNada));
t("B4 recusas: A vazia; A igual à C (não distintas); A com <parameter vazado; A fora do tamanho das demais; resposta sem alternativas",
  !M.aplicaAlternativasFaltantes(base, { alternativas: { ...base.alternativas, A: " " }, comentarios: { A: "x" } }, ["A"]).ok
  && M.aplicaAlternativasFaltantes(base, { alternativas: { ...base.alternativas, A: base.alternativas.C }, comentarios: { A: "x" } }, ["A"]).motivo.includes("distintas")
  && !M.aplicaAlternativasFaltantes(base, { alternativas: { ...base.alternativas, A: '<parameter name="A">x' }, comentarios: { A: "x" } }, ["A"]).ok
  && M.aplicaAlternativasFaltantes(base, { alternativas: { ...base.alternativas, A: "errada." }, comentarios: { A: "x" } }, ["A"]).motivo.includes("tamanho")
  && M.aplicaAlternativasFaltantes(base, { alternativas: { ...base.alternativas, A: "x".repeat(120) }, comentarios: { A: "x" } }, ["A"]).motivo.includes("tamanho")
  && M.aplicaAlternativasFaltantes(base, { comentarios: {} }, ["A"]).motivo.includes("sem as alternativas"));
const gabFalta = M.aplicaAlternativasFaltantes({ ...base, gabarito: "A", alternativas: { ...base.alternativas }, analiseAlternativas: { ...an("A"), A: {} } }, { alternativas: { ...base.alternativas, A: A_OK }, comentarios: { A: "é a resposta" } }, ["A"]);
t("B5 quando a letra que falta é a CORRETA, o status da análise fica \"correta\"", gabFalta.ok && gabFalta.nova.analiseAlternativas.A.status === "correta", JSON.stringify(gabFalta));
const duas = M.aplicaAlternativasFaltantes({ ...base, alternativas: { B: base.alternativas.B, D: base.alternativas.D, E: base.alternativas.E } }, { alternativas: { ...base.alternativas, A: A_OK }, comentarios: { A: "a", C: "c" } }, ["A", "C"]);
t("B6 duas letras faltando: as duas entram, as três existentes ficam", duas.ok && duas.nova.alternativas.A === A_OK && duas.nova.alternativas.C === base.alternativas.C && duas.nova.alternativas.D === base.alternativas.D, JSON.stringify(duas));
t("B7 teto de duas tentativas; a expressão do parâmetro vazado é a mesma do reparo", M.ALTERNATIVAS_FALTANTES_MAX === 2 && M.RE_PARAMETRO_VAZADO.test('<parameter name="A">') && !M.RE_PARAMETRO_VAZADO.test("20%."));

/* ---------- C. o pedido e a ordem de refazer ---------- */
const p1 = M.buildAlternativasFaltantesPrompt(base, ["A"]);
const p2 = M.buildAlternativasFaltantesPrompt({ ...base, gabarito: "A", alternativas: { ...base.alternativas } }, ["A"], 2, "a alternativa A voltou vazia");
t("C1 o pedido: cabeçalho, só a letra que falta marcada, correta marcada, comentários registrados (guia), ordem lógica, não mexer nas existentes, ferramenta entregar_alternativas",
  p1.startsWith("ALTERNATIVAS FALTANTES — a questão abaixo está pronta") && p1.includes("A) (FALTANDO — escrever)") && p1.includes("D) superestimada, pois tratou o tronco como cilindro.   ← CORRETA") && !p1.includes("B) (FALTANDO")
  && p1.includes("A: inversão de polaridade") && p1.includes("COMENTÁRIOS REGISTRADOS") && p1.includes("ORDEM LÓGICA") && p1.includes("devolva-as IDÊNTICAS") && p1.includes('ferramenta "entregar_alternativas"') && p1.includes("QUASE-ACERTO") && !p1.includes("é a CORRETA — a única resposta defensável"), p1.slice(0, 400));
t("C2 tentativa 2 com recusa anterior e letra correta faltando: diz a tentativa, o motivo e o papel de correta", p2.includes("— TENTATIVA 2") && p2.includes("recusada pela conferência automática: a alternativa A voltou vazia") && p2.includes("a A é a CORRETA — a única resposta defensável"), p2.slice(0, 500));
const ordem = M.buildCorrecaoAlternativasIncompletas(["A", "C"]);
t("C3 a ordem de refazer nomeia as letras e o formato exato do campo", ordem.includes("veio SEM a(s) alternativa(s) A, C") && ordem.includes('as cinco chaves "A", "B", "C", "D" e "E"') && ordem.includes("nunca com letras fora desse objeto"));

/* ---------- D. o handler ---------- */
const h = fonte.slice(fonte.indexOf("Deno.serve("));
const iGate = h.indexOf("const completasDiag: any = await garantirAlternativasCompletas(data, system, usos, LIMITE_FUNCAO_MS - (Date.now() - inicioReq), familiaQ);");
const iVisual = h.indexOf("const visualDiag = await garantirVisual(data, { area, disciplina, recurso, tema, instrucoesVisual }, usos);");
const iRevisor = h.indexOf("review-math-question");
const iNormaliza = h.indexOf("data = normalizarCamposEstruturados(data);\n    repoeTextoDaBiblioteca(data, \"geração\");");
t("D1 a porteira roda logo depois do reparo em código e ANTES do visual e do revisor matemático, com a família de ferramentas (mesmo cache)", iGate > 0 && iNormaliza > 0 && iNormaliza < iGate && iGate < iVisual && iGate < iRevisor, String([iNormaliza, iGate, iVisual, iRevisor]));
t("D2 sem completar: a questão é refeita UMA vez com a ordem sobre o formato, só com tempo, declarando a família; a refeita passa pela mesma porteira",
  h.includes('let nova = await callClaudeForJSON(system, userMsg + buildCorrecaoAlternativasIncompletas(completasDiag.faltantes), false, usos, ferramentaQ, buscasWeb, "geracao/alternativas-incompletas", undefined, undefined, familiaQ);')
  && h.includes("if (restante > MS_MINIMO_PARA_REELABORAR) {") && h.includes("const c2 = await garantirAlternativasCompletas(nova, system, usos, LIMITE_FUNCAO_MS - (Date.now() - inicioReq), familiaQ);")
  && h.includes('if (c2.estado !== "pendente") { data = nova; completasDiag.estado = "refeita"; }'));
t("D3 sem as cinco: registra o custo (alternativas_incompletas) e responde ERRO em vez de entregar a questão",
  h.includes("if (!data || typeof data !== \"object\" || letrasFaltantes(data).length) {") && h.includes('validacao: { estado: "alternativas_incompletas" }') && h.includes("throw new Error(`a questão veio sem a(s) alternativa(s) ${faltam} e não foi possível completá-la — peça esta questão de novo (Regenerar)`);")
  && h.indexOf("throw new Error(`a questão veio sem a(s) alternativa(s)") < iVisual);
t("D4 depois do revisor matemático, alternativas perdidas no caminho são repostas", h.includes("const alternativasAntesDoRevisor = data.alternativas, analiseAntesDoRevisor = data.analiseAlternativas;") && h.includes("if (data && typeof data === \"object\" && letrasFaltantes(data).length && alternativasUtilizaveis(alternativasAntesDoRevisor)) {") && h.indexOf("alternativasUtilizaveis(alternativasAntesDoRevisor)") > iRevisor);
t("D5 a reescrita pedida pelo auditor também passa pela porteira, antes do visual; sem completar, fica a versão anterior",
  h.includes("const cd2 = await garantirAlternativasCompletas(nova, system, usos, LIMITE_FUNCAO_MS - (Date.now() - inicioReq), familiaQ);") && h.indexOf("const cd2 = await") < h.indexOf("const vd2 = await garantirVisual(nova") && h.includes('if (cd2.estado === "pendente") {') && h.indexOf('if (cd2.estado === "pendente") {') < h.indexOf("const vd2 = await garantirVisual(nova"));
t("D6 a resposta traz completasDiag (antes de gabaritoDiag, sem mudar o resto da assinatura)", h.includes("notacaoDiag, completasDiag, gabaritoDiag, distratoresDiag, alternativasDiag, dadosDiag, fontesDiag, objetoDiag: objetoDiagFinal })"));
t("D7 selftest v7438 e impressão digital incluem as funções novas",
  fonte.includes("v7438_alternativasCompletas: (() => {") && fonte.includes("objetoDeParametrosVazados.toString(), recolheLetrasSoltas.toString(), letrasFaltantes.toString(), normalizarCamposEstruturados.toString(), alternativasDeString.toString(),")
  && fonte.includes("buildAlternativasFaltantesPrompt.toString(), aplicaAlternativasFaltantes.toString(), garantirAlternativasCompletas.toString(), buildCorrecaoAlternativasIncompletas.toString(), JSON.stringify([ALTERNATIVAS_FALTANTES_MAX, String(RE_PARAMETRO_VAZADO)]),"));
const g = recorta("garantirAlternativasCompletas", "async function ");
t("D8 garantirAlternativasCompletas: custo zero com as cinco; usa entregar_alternativas na etapa alternativas-faltantes-N; respeita o tempo; só altera a questão quando a proposta passa; exige gabarito coerente quando ele já era coerente",
  g.includes('if (!faltantes.length) { diag.estado = "ok"; return diag; }') && g.includes("FERRAMENTA_ALTERNATIVAS, undefined, `alternativas-faltantes-${tentativa}`") && g.includes("if (restante < MS_MINIMO_PARA_CORRIGIR_ALTERNATIVAS)")
  && g.indexOf("const p = aplicaAlternativasFaltantes(data, bruto, faltantes);") < g.indexOf("data.alternativas = p.nova.alternativas;") && g.includes('if (gabAntes.estado === "ok") {') && g.includes("gab2.letra !== gabAntes.letra"));

console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
if (bad) Deno.exit(1);

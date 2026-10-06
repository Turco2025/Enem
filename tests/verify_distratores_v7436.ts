/* v74.36 — DISTRATORES PLAUSÍVEIS (generate-question), SEM CHAMAR A ANTHROPIC.

   Pedido do professor (06/10/2026), com o Guia do Inep na mão: "os distratores estão
   absurdamente errados, facilitando a identificação da alternativa correta; um distrator deve
   ser muito semelhante ao item correto; o texto não pode conter termos que ajudem a identificar
   a resposta". Três camadas, provadas aqui com o código de produção recortado função a função:
     A. REGRA DOS DISTRATORES no bloco cacheado do prompt (quase-acerto, teste do candidato
        mediano, pista de tom, pista de classe, eco do texto-base, justificável, numéricas,
        exemplos reais), entre a REGRA DAS CINCO ALTERNATIVAS e o schema;
     B. conferenciaAlternativas ganha "exagero" (total, permanente, definitivo, irreversível,
        imediato, exclusivo, aleatório…) e "ecoTexto" (a correta como a única a repetir duas ou
        mais palavras do texto-base), com as ordens de reescrita correspondentes;
     C. garantirDistratoresPlausiveis: a revisão por IA (ligada), que só mexe nos distratores,
        aceita "os quatro passaram", recusa proposta que altera a correta, que muda de tamanho
        demais, que repete alternativa, que cria problema novo ou que troca a resposta; marca
        a questão; respeita o relógio; não roda em alternativas numéricas;
     D. a ligação com o handler (antes da conferência em código; de novo na reelaboração), o
        selftest e a impressão digital.
   Uso: deno run -A tests/verify_distratores_v7436.ts supabase/functions/generate-question/index.ts */
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
type SistemaPrompt = any;
const LETRAS_ALTERNATIVAS = ["A", "B", "C", "D", "E"];
const JSON_SCHEMA_TXT = "ESQUEMA JSON DE SAÍDA (placeholder do teste) xxxxxxxxxxxxxxxxxxxxxxxx";
function buildRecorteDaDisciplina() { return ""; } function buildRegraFontesReais() { return ""; } function buildCalibracaoExtensao() { return "CALIBRAÇÃO"; }
export const __stub: any = { respostas: [] as any[], chamadas: [] as any[], teto: 125 };
function tetosDaDisciplina(_d: string) { return __stub.teto ? { item: __stub.teto, alvoItem: 100, texto: 900, alvoTexto: 600, comando: 200, alvoComando: 120 } : null; }
async function callClaudeForJSON(_s: any, prompt: string, _w: any, usos: any[], ferramenta: any, _b: any, etapa: string, _f: any, _t: any, declaradas: any[] | null) {
  __stub.chamadas.push({ etapa, ferramenta: ferramenta.name, prompt, declaradas: (declaradas || []).map((d: any) => d.name) });
  if (usos) usos.push({ etapa });
  const r = __stub.respostas.shift();
  if (r instanceof Error) throw r;
  return r;
}
${recorta("normalizaParaComparar")}
${recorta("visualConforme")}
${recorta("conferenciaGabarito")}
${recorta("letraNaResolucao")}
${recorta("buildRegraAlternativas")}
${recorta("buildRegraDistratores")}
${recorta("buildBlocoFixo")}
${recorta("ehLinguaEstrangeira")}
${recorta("buildRegraIdiomaLinguaEstrangeira")}
${recorta("idiomaDaDisciplina")}
${entre("/* ═══════════ v74.27 — CONFERÊNCIA DAS ALTERNATIVAS", "/* ═══════════ FIM DA CONFERÊNCIA DAS ALTERNATIVAS")}
${entre("/* ═══════════ v74.36 — REVISÃO DOS DISTRATORES", "/* ═══════════ FIM DA REVISÃO DOS DISTRATORES")}
export { conferenciaAlternativas, termosExageradosEm, buildCorrecaoAlternativasPrompt, buildRegraDistratores, buildBlocoFixo, buildRevisaoDistratoresPrompt, aplicaRevisaoDistratores, garantirDistratoresPlausiveis,
  EXAGEROS_ALTERNATIVAS, ECO_TEXTO_MIN_RADICAIS, REVISAO_DISTRATORES, REVISOES_DISTRATORES_MAX, MS_MINIMO_PARA_REVISAR_DISTRATORES, DISTRATOR_RAZAO_MIN, DISTRATOR_RAZAO_MAX, FERRAMENTA_ALTERNATIVAS };
`;
const tmp = await Deno.makeTempDir();
await Deno.writeTextFile(`${tmp}/dist.ts`, modulo);
const M: any = await import(`file://${tmp}/dist.ts`);
const { __stub } = M;

let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };
const cala = () => { const o = { w: console.warn, l: console.log }; console.warn = () => {}; console.log = (...a: any[]) => { if (/^(PASS|FAIL)/.test(String(a[0]))) o.l(...a); }; return () => { console.warn = o.w; console.log = o.l; }; };
const an = (c: string, coments: Record<string, string> = {}) => { const o: any = {}; for (const L of ["A", "B", "C", "D", "E"]) o[L] = { status: L === c ? "correta" : "incorreta", comentario: coments[L] || "c" + L }; return o; };
const tipos = (c: any) => c.problemas.map((p: any) => p.tipo).sort().join();

/* ---------- a questão real (Biologia, 06/10): a correta é a única formulação específica ---------- */
const base: any = {
  textoBase: "Trabalhadores em ambiente quente, sem reposição de líquidos, apresentaram urina escura e em pequeno volume ao fim do turno. O organismo ajusta a reabsorção de água nos rins conforme o estado de hidratação.",
  comando: "A redução do volume urinário observada nos trabalhadores desidratados decorre de um mecanismo que",
  alternativas: { A: "reduz a filtração glomerular para poupar água no sangue.", B: "inibe a sede, diminuindo a ingestão hídrica do trabalhador.", C: "estimula a aldosterona, que retém sódio nos túbulos renais.", D: "aumenta a sudorese, compensando a perda de água pela urina.", E: "eleva a reabsorção de água no túbulo renal via ADH." },
  gabarito: "E", analiseAlternativas: an("E"), resolucaoComentada: "A desidratação eleva o ADH, que aumenta a reabsorção de água no túbulo renal. Portanto, a alternativa correta é a E.",
};

/* ---------- A. a regra no prompt ---------- */
const regra = M.buildRegraDistratores();
const fixo = M.buildBlocoFixo({ area: "natureza", disciplina: "Biologia" });
t("A1 a REGRA DOS DISTRATORES existe, com os sete itens e os exemplos reais",
  regra.startsWith("REGRA DOS DISTRATORES") && regra.includes("1. CADA DISTRATOR É UM QUASE-ACERTO") && regra.includes("2. TESTE DO CANDIDATO MEDIANO") && regra.includes("3. SEM PISTA DE TOM")
  && regra.includes("4. SEM PISTA DE CLASSE") && regra.includes("5. SEM ECO DO TEXTO-BASE") && regra.includes("6. JUSTIFICÁVEL") && regra.includes("7. ALTERNATIVAS NUMÉRICAS")
  && regra.includes('"eleva a reabsorção de sódio no túbulo renal via aldosterona."') && regra.includes('"reduz-se a um entretenimento sem relação entre forma audiovisual e percepção do público."'));
t("A2 ela entra no bloco cacheado, depois da REGRA DAS CINCO ALTERNATIVAS e antes do schema — em TODA disciplina (bloco fixo por área × disciplina, como manda a v74.17)",
  fixo.indexOf("REGRA DOS DISTRATORES") > fixo.indexOf("REGRA DAS CINCO ALTERNATIVAS") && fixo.indexOf("REGRA DOS DISTRATORES") < fixo.indexOf("ESQUEMA JSON DE SAÍDA")
  && M.buildBlocoFixo({ area: "linguagens", disciplina: "Artes" }).includes("REGRA DOS DISTRATORES") && M.buildBlocoFixo({ area: "matematica", disciplina: "Matemática" }).includes("7. ALTERNATIVAS NUMÉRICAS"));
t("A3 o bloco fixo continua estável (mesmo texto em duas chamadas) e a regra tem tamanho razoável (< 6 mil caracteres: ≈ US$ 0,0003 por questão na leitura do cache)",
  fixo === M.buildBlocoFixo({ area: "natureza", disciplina: "Biologia" }) && regra.length < 6000, String(regra.length));

/* ---------- B. conferência em código ---------- */
t("B1 a questão real passa na conferência (nenhum termo da lista; eco não atinge o mínimo)", M.conferenciaAlternativas(base).estado === "ok", JSON.stringify(M.conferenciaAlternativas(base).problemas));
const exag = { ...base, alternativas: { ...base.alternativas, D: "bloqueia de modo permanente a formação de urina nos rins." } };
const cE = M.conferenciaAlternativas(exag);
t("B2 exagero: \"permanente\" num distrator é apontado com a letra e o termo; a ordem de reescrita pede o quase-acerto",
  tipos(cE) === "exagero" && cE.letras.join() === "D" && cE.problemas[0].termos.join() === "permanente"
  && M.buildCorrecaoAlternativasPrompt(exag, cE).includes("EXAGERO (pista de tom) em D (\"permanente\")") && M.buildCorrecaoAlternativasPrompt(exag, cE).includes("QUASE-ACERTO da correta"));
t("B3 a lista: termos de exagero reconhecidos (flexões), expressões de duas palavras; termos técnicos ficam de fora (isolado, absoluto, infinito, invariável, direta)",
  M.termosExageradosEm("Efeito imediato e irreversível, em excesso, com resultado definitivo.").join() === "definitivo,irreversivel,imediato,em excesso"
  && M.termosExageradosEm("sistema isolado, zero absoluto, infinitas soluções, palavra invariável, razão direta").length === 0
  && M.termosExageradosEm("nenhuma alteração; por si só; na totalidade").join() === "nenhuma,por si so,na totalidade");
const cinco = { ...base, alternativas: Object.fromEntries(Object.entries(base.alternativas).map(([L, v]) => [L, String(v).replace(".", " de forma total.")])) };
t("B4 termo de exagero nas CINCO alternativas é estrutura do item, não pista (como nos absolutos)", !M.conferenciaAlternativas(cinco).problemas.some((p: any) => p.tipo === "exagero"));
t("B5 exagero na CORRETA também é apontado (a correta não pode ser a extremada)",
  (() => { const c = M.conferenciaAlternativas({ ...base, alternativas: { ...base.alternativas, E: "eleva de forma definitiva a reabsorção de água no túbulo renal via ADH." } }); return c.problemas.some((p: any) => p.tipo === "exagero" && p.letras.join() === "E"); })());
const ecoT = { ...base, textoBase: "O túbulo renal reabsorve água sob ação do hormônio ADH; a reabsorção aumenta na desidratação.", alternativas: { ...base.alternativas, E: "eleva a reabsorção de água no túbulo renal pelo hormônio ADH." } };
const cT = M.conferenciaAlternativas(ecoT);
t("B6 eco do texto-base: a correta como a única a repetir duas ou mais palavras características do texto é apontada (letra da correta); a ordem prefere levar as palavras a dois distratores",
  cT.problemas.some((p: any) => p.tipo === "ecoTexto" && p.letras.join() === "E" && p.termos.length >= 2) && M.buildCorrecaoAlternativasPrompt(ecoT, cT).includes("ECO DO TEXTO-BASE") && M.buildCorrecaoAlternativasPrompt(ecoT, cT).includes("reescreva DOIS distratores"),
  JSON.stringify(cT.problemas));
t("B7 uma palavra só não basta (mínimo 2), palavra que também está no comando fica com o eco do comando, e distrator que repete a palavra desfaz o eco",
  M.ECO_TEXTO_MIN_RADICAIS === 2
  && !M.conferenciaAlternativas({ ...base, textoBase: "O túbulo renal reabsorve água.", alternativas: { ...base.alternativas, E: "eleva a reabsorção de água no túbulo renal pelo ADH." } }).problemas.some((p: any) => p.tipo === "ecoTexto")
  && !M.conferenciaAlternativas({ ...ecoT, alternativas: { ...ecoT.alternativas, C: "estimula a aldosterona, hormônio que retém sódio no túbulo renal." } }).problemas.some((p: any) => p.tipo === "ecoTexto"));
t("B8 alternativas numéricas: nem eco do texto-base nem tamanho se aplicam (exagero continua valendo)",
  M.conferenciaAlternativas({ ...base, textoBase: "O valor 625 aparece no texto, com 900 e 1600.", alternativas: { A: "625", B: "900", C: "1 600", D: "2 500", E: "4 900" }, gabarito: "A", analiseAlternativas: an("A") }).estado === "ok");
const prompt = M.buildCorrecaoAlternativasPrompt(ecoT, cT);
t("B9 com eco do texto-base a correção pode mexer em todas as letras e mostra o texto-base inteiro (até 4 mil caracteres)",
  fonte.includes('conf.problemas.some((p) => p.tipo === "eco" || p.tipo === "ecoTexto") ? LETRAS_ALTERNATIVAS : conf.letras') && prompt.includes(ecoT.textoBase) && fonte.includes('p.tipo === "ecoTexto") ? 4000 : 2500'));

/* ---------- C. a revisão por IA ---------- */
const bruto = (alts: any, comentarios: any = {}) => ({ alternativas: alts, comentarios, resolucaoComentada: "" });
const quase = { ...base.alternativas, B: "estimula a secreção de ADH, que aumenta a filtração glomerular.", D: "eleva a reabsorção de sódio no túbulo renal via aldosterona." };
const p1 = M.aplicaRevisaoDistratores(base, bruto(quase, { B: "inverte o efeito do ADH: ele reduz a diurese pela reabsorção, não pela filtração", D: "troca o hormônio que retém água pelo que retém sódio" }), "Biologia");
t("C1 proposta boa: dois distratores reescritos como quase-acertos, correta intacta, comentários novos só neles",
  p1.ok && !p1.aprovado && p1.mudadas.join() === "B,D" && p1.nova.alternativas.E === base.alternativas.E && p1.nova.alternativas.A === base.alternativas.A
  && p1.nova.analiseAlternativas.D.comentario.startsWith("troca o hormônio") && p1.nova.analiseAlternativas.E.comentario === "cE" && p1.nova.analiseAlternativas.E.status === "correta");
t("C2 os quatro idênticos = aprovado (nenhuma mudança, nenhum comentário exigido)", (() => { const p = M.aplicaRevisaoDistratores(base, bruto(base.alternativas), "Biologia"); return p.ok && p.aprovado && p.mudadas.length === 0 && p.nova === base; })());
t("C3 recusas: resposta vazia; só a correta alterada (ela não pode mudar); distrator reescrito sem comentário; tamanho fora de 0,75×–1,3×; cresceu além do teto da disciplina (encolher pode); duas alternativas iguais",
  !M.aplicaRevisaoDistratores(base, null, "Biologia").ok
  && !M.aplicaRevisaoDistratores(base, bruto({ ...base.alternativas, E: "eleva a reabsorção de água via ADH." }), "Biologia").ok && M.aplicaRevisaoDistratores(base, bruto({ ...base.alternativas, E: "eleva a reabsorção de água via ADH." }), "Biologia").motivo.includes("só a alternativa correta")
  && !M.aplicaRevisaoDistratores(base, bruto(quase), "Biologia").ok
  && !M.aplicaRevisaoDistratores(base, bruto({ ...base.alternativas, D: "eleva a reabsorção de sódio no túbulo renal via aldosterona, e não de água, como faria o ADH nos trabalhadores." }, { D: "c" }), "Biologia").ok
  && !M.aplicaRevisaoDistratores(base, bruto({ ...base.alternativas, D: "eleva o sódio." }, { D: "c" }), "Biologia").ok
  && (() => { __stub.teto = 60; const r = M.aplicaRevisaoDistratores(base, bruto({ ...base.alternativas, D: "eleva a reabsorção de sódio no túbulo renal distal via aldosterona." }, { D: "c" }), "Biologia"); const r2 = M.aplicaRevisaoDistratores({ ...base, alternativas: { ...base.alternativas, D: "eleva a reabsorção de sódio no túbulo renal distal e coletor via aldosterona." } }, bruto({ ...base.alternativas, D: "eleva a reabsorção de sódio no túbulo renal distal via aldosterona." }, { D: "c" }), "Biologia"); __stub.teto = 125; return !r.ok && r.motivo.includes("teto da disciplina") && r2.ok; })()
  && !M.aplicaRevisaoDistratores(base, bruto({ ...base.alternativas, D: base.alternativas.C }, { D: "c" }), "Biologia").ok);
t("C4 a correta alterada JUNTO com um distrator: a mudança na correta é descartada (fica a original) e o distrator entra",
  (() => { const p = M.aplicaRevisaoDistratores(base, bruto({ ...quase, E: "outra coisa." }, { B: "x", D: "y" }), "Biologia"); return p.ok && p.nova.alternativas.E === base.alternativas.E && p.mudadas.join() === "B,D"; })());
const prm = M.buildRevisaoDistratoresPrompt(base, 2, "o distrator D mudou de tamanho demais");
t("C5 o prompt da revisão: teste do candidato mediano, correta marcada como intocável, quase-acerto, 85–115%, ferramenta entregar_alternativas, recusa anterior na 2ª tentativa",
  prm.includes("TESTE DO CANDIDATO MEDIANO") && prm.includes("E) eleva a reabsorção de água no túbulo renal via ADH.   ← CORRETA (não alterar)") && prm.includes("QUASE-ACERTO") && prm.includes("entre 85% e 115%")
  && prm.includes('"entregar_alternativas"') && prm.includes("TENTATIVA 2") && prm.includes("recusada pela conferência automática: o distrator D mudou de tamanho demais") && prm.includes("Se os quatro passam, devolva os quatro idênticos"));

const fam = [{ name: "entregar_questao" }, { name: "entregar_alternativas" }, { name: "entregar_gabarito" }, { name: "entregar_item_em_portugues" }, { name: "entregar_coerencia_dados" }];
const fresca = () => JSON.parse(JSON.stringify(base));
const zera = () => { __stub.respostas = []; __stub.chamadas = []; __stub.teto = 125; };
const volta = cala();
zera(); __stub.respostas = [bruto(quase, { B: "inverte o efeito do ADH", D: "troca o hormônio que retém água pelo que retém sódio" })];
const d1 = fresca(); const usos1: any[] = [];
const g1 = await M.garantirDistratoresPlausiveis(d1, "sys", usos1, 120_000, fam, "Biologia");
t("C6 fluxo: uma chamada (etapa distratores-1, ferramenta entregar_alternativas, família declarada), distratores B e D trocados na questão, correta/gabarito intactos, marca distratores = revisado",
  g1.aplicavel && g1.estado === "revisado" && g1.chamadas === 1 && g1.letrasReescritas.join() === "B,D" && d1.alternativas.D === quase.D && d1.alternativas.E === base.alternativas.E && d1.gabarito === "E"
  && d1.distratores.estado === "revisado" && d1.distratores.letras.join() === "B,D" && __stub.chamadas[0].etapa === "distratores-1" && __stub.chamadas[0].ferramenta === "entregar_alternativas"
  && __stub.chamadas[0].declaradas.join() === "entregar_questao,entregar_alternativas,entregar_gabarito,entregar_item_em_portugues,entregar_coerencia_dados" && usos1.length === 1, JSON.stringify(g1));
zera(); __stub.respostas = [bruto(base.alternativas)];
const d2 = fresca();
const g2 = await M.garantirDistratoresPlausiveis(d2, "sys", [], 120_000, fam, "Biologia");
t("C7 os quatro passaram: estado aprovado, uma chamada, questão sem marca", g2.estado === "aprovado" && g2.chamadas === 1 && !("distratores" in d2) && d2.alternativas.B === base.alternativas.B);
zera(); __stub.respostas = [bruto({ ...base.alternativas, D: "eleva de forma permanente a reabsorção de sódio no túbulo renal." }, { D: "c" }), bruto(quase, { B: "b", D: "d" })];
const d3 = fresca();
const g3 = await M.garantirDistratoresPlausiveis(d3, "sys", [], 120_000, fam, "Biologia");
t("C8 proposta que cria problema NOVO (exagero \"permanente\") é recusada; a 2ª tentativa recebe a recusa e entra",
  g3.estado === "revisado" && g3.chamadas === 2 && g3.tentativas === 2 && __stub.chamadas[1].prompt.includes("TENTATIVA 2") && __stub.chamadas[1].prompt.includes("criou problema novo: exagero"));
zera(); __stub.respostas = [bruto({ ...base.alternativas, E: "x." }), bruto({ ...base.alternativas, E: "y." })];
const d4 = fresca();
const g4 = await M.garantirDistratoresPlausiveis(d4, "sys", [], 120_000, fam, "Biologia");
t("C9 duas propostas recusadas → pendente, com o motivo, questão intacta e marcada", g4.estado === "pendente" && g4.chamadas === 2 && String(g4.motivoRecusa).includes("só a alternativa correta") && d4.alternativas.E === base.alternativas.E && d4.distratores.estado === "pendente" && d4.distratores.motivo.includes("só a alternativa correta"));
zera(); __stub.respostas = [bruto({ ...base.alternativas, D: "eleva a reabsorção de sódio no túbulo renal via aldosterona." }, { D: "c" }), bruto({ ...base.alternativas, D: "eleva a reabsorção de sódio no túbulo renal via aldosterona." }, { D: "c" })];
const d5 = fresca(); d5.analiseAlternativas = an("E"); d5.analiseAlternativas.D.status = "correta";   // análise já divergente antes
const g5 = await M.garantirDistratoresPlausiveis(d5, "sys", [], 120_000, fam, "Biologia");
t("C10 se gabarito e análise divergem, a proposta é recusada (a resposta tem de continuar coerente)", g5.estado === "pendente" && String(g5.motivoRecusa).includes("deixou de ser coerente"));
zera();
const d6 = fresca();
const g6 = await M.garantirDistratoresPlausiveis(d6, "sys", [], 30_000, fam, "Biologia");
t("C11 sem tempo (< 40 s): nenhuma chamada, pendente com o motivo", g6.estado === "pendente" && g6.chamadas === 0 && String(g6.pulado).includes("sem tempo"));
zera(); __stub.respostas = [new Error("rede caiu")];
const d7 = fresca();
const g7 = await M.garantirDistratoresPlausiveis(d7, "sys", [], 120_000, fam, "Biologia");
t("C12 erro na chamada nunca derruba a questão: pendente com o erro", g7.estado === "pendente" && g7.erro === "rede caiu" && d7.alternativas.D === base.alternativas.D);
zera();
const num = { ...fresca(), alternativas: { A: "625", B: "900", C: "1 600", D: "2 500", E: "4 900" }, gabarito: "A", analiseAlternativas: an("A") };
const gN = await M.garantirDistratoresPlausiveis(num, "sys", [], 120_000, fam, "Matemática");
t("C13 alternativas numéricas não passam pela revisão (nao_aplicavel, sem chamada)", !gN.aplicavel && gN.estado === "nao_aplicavel" && gN.motivo === "alternativas numéricas" && __stub.chamadas.length === 0);
const gI = await M.garantirDistratoresPlausiveis({ ...fresca(), alternativas: { ...base.alternativas, A: "" } }, "sys", [], 120_000, fam, "Biologia");
t("C14 alternativas incompletas: nao_aplicavel", gI.estado === "nao_aplicavel" && __stub.chamadas.length === 0);
volta();
t("C15 constantes: revisão LIGADA, até 2 tentativas, 40 s de folga, extensão 0,75×–1,3×", M.REVISAO_DISTRATORES === true && M.REVISOES_DISTRATORES_MAX === 2 && M.MS_MINIMO_PARA_REVISAR_DISTRATORES === 40_000 && M.DISTRATOR_RAZAO_MIN === 0.75 && M.DISTRATOR_RAZAO_MAX === 1.3);

/* ---------- D. ligação ---------- */
t("D1 o handler chama a revisão depois da coerência do gabarito e ANTES da conferência em código das alternativas, e de novo em cada reelaboração (antes de ad2)",
  fonte.indexOf("const distratoresDiag: any = await garantirDistratoresPlausiveis(") > fonte.indexOf("const gabaritoDiag = await garantirGabaritoCoerente(")
  && fonte.indexOf("const distratoresDiag: any = await garantirDistratoresPlausiveis(") < fonte.indexOf("const alternativasDiag: any = await garantirAlternativasConformes(")
  && fonte.indexOf("const rd2 = await garantirDistratoresPlausiveis(nova") < fonte.indexOf("const ad2 = await garantirAlternativasConformes(nova") && fonte.includes("distratoresDiag.aposReelaboracao = rd2;"));
t("D2 a resposta ao app carrega distratoresDiag; a questão carrega distratores (vai junto com o simulado arquivado)",
  fonte.includes("gabaritoDiag, distratoresDiag, alternativasDiag, dadosDiag, fontesDiag, objetoDiag: objetoDiagFinal })") && fonte.includes('data.distratores = { estado: "revisado", letras: p.mudadas };') && fonte.includes('data.distratores = { estado: "pendente", motivo:'));
t("D3 a revisão usa a ferramenta da família (entregar_alternativas) — lê o cache da geração; a etapa de custo é distratores-N",
  fonte.includes("FERRAMENTA_ALTERNATIVAS, undefined, `distratores-${tentativa}`, undefined, undefined, declaradas);"));
t("D4 selftest v7436 e impressão digital incluem as três camadas",
  fonte.includes("v7436_distratores: (() => {") && fonte.includes("JSON.stringify([EXAGEROS_ALTERNATIVAS, EXAGEROS_EXIBICAO, ECO_TEXTO_MIN_RADICAIS]), termosExageradosEm.toString(), buildRegraDistratores(),")
  && fonte.includes("buildRevisaoDistratoresPrompt.toString(), aplicaRevisaoDistratores.toString(), garantirDistratoresPlausiveis.toString(),"));

console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
if (bad) Deno.exit(1);

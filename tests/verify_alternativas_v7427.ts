/* v74.27 — CONFERÊNCIA DAS ALTERNATIVAS NO BACKEND (generate-question).

   Prova, SEM chamar a Anthropic, as três regras (linguagem absolutista, correta
   maior que as demais, correta como única a repetir palavra do comando), a
   reescrita dirigida e (seção D, v74.27 b) o IDIOMA DO ITEM: comando e
   alternativas de Língua Estrangeira em português, como no ENEM. O teste extrai do próprio arquivo de produção o bloco da
   v74.27 e o da conferência da resposta (v74.6), e troca só a chamada ao modelo
   por um dublê controlável. O código conferido é o que roda em produção.

   Uso:
     deno run --allow-read --allow-write --allow-env \
       tests/verify_alternativas_v7427.ts supabase/functions/generate-question/index.ts \
       [provas/extracao/textos_enem_bruto.jsonl]
   (o 2º argumento é opcional: com o extrato das provas, D2 confere os 612 itens
   reais de 2022–2025; sem ele, D2 é pulado.)  */
const alvo = Deno.args[0] || "supabase/functions/generate-question/index.ts";
const extrato = Deno.args[1] || "provas/extracao/textos_enem_bruto.jsonl";
const fonte = await Deno.readTextFile(alvo);
const i = fonte.indexOf("/* ═══════════ v74.27 — CONFERÊNCIA DAS ALTERNATIVAS");
const j = fonte.indexOf("/* ═══════════ FIM DA CONFERÊNCIA DAS ALTERNATIVAS ═══════════ */");
const g1 = fonte.indexOf("function conferenciaGabarito");
const g2 = fonte.indexOf("const FERRAMENTA_GABARITO");
const r1 = fonte.indexOf("function ehLinguaEstrangeira(");
const r2 = fonte.indexOf("\n}\n", fonte.indexOf("function buildRegraIdiomaLinguaEstrangeira(")) + 3;
if (i < 0 || j < 0 || j < i || g1 < 0 || g2 < g1 || r1 < 0 || r2 < r1) { console.error("FALHA: não achei os blocos em " + alvo); Deno.exit(1); }
const modulo = `const LETRAS_ALTERNATIVAS = ["A","B","C","D","E"];
type SistemaPrompt = any;
export const __stub: any = { respostas: [] as any[], erro: null, chamadas: 0, prompts: [] as string[], etapas: [] as string[] };
async function callClaudeForJSON(_s: any, userMsg: string, _w: any, usos: any[], ferramenta: any, _b: any, etapa: string) {
  __stub.chamadas++; __stub.prompts.push(userMsg); __stub.etapas.push(etapa); __stub.ferramenta = ferramenta && ferramenta.name;
  if (usos) usos.push({ input_tokens: 1, output_tokens: 1, etapa });
  if (__stub.erro) throw new Error(__stub.erro);
  return __stub.respostas.length ? __stub.respostas.shift() : null;
}
` + fonte.slice(g1, g2) + fonte.slice(i, j) + fonte.slice(r1, r2) + `
export { conferenciaAlternativas, termosAbsolutosEm, aplicaCorrecaoAlternativas, buildCorrecaoAlternativasPrompt, garantirAlternativasConformes,
  FERRAMENTA_ALTERNATIVAS, ABSOLUTOS_ALTERNATIVAS, CORRETA_DOMINANTE_RAZAO, CORRETA_DOMINANTE_CARACTERES, MS_MINIMO_PARA_CORRIGIR_ALTERNATIVAS, ENEM_REAL_ALTERNATIVAS,
  contaMarcasIdioma, linguaEstrangeiraEm, idiomaDoItem, buildPortuguesDoItemPrompt, aplicaPortuguesDoItem, FERRAMENTA_IDIOMA, ENEM_REAL_IDIOMA,
  ehLinguaEstrangeira, buildRegraIdiomaLinguaEstrangeira };
`;
const tmp = await Deno.makeTempDir();
const caminho = `${tmp}/alt_mod.ts`;
await Deno.writeTextFile(caminho, modulo);
const M: any = await import("file://" + caminho);
const { conferenciaAlternativas, termosAbsolutosEm, aplicaCorrecaoAlternativas, buildCorrecaoAlternativasPrompt, garantirAlternativasConformes, __stub } = M;
const { linguaEstrangeiraEm, idiomaDoItem, buildPortuguesDoItemPrompt, aplicaPortuguesDoItem } = M;

let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };
const an = (c: string) => { const o: any = {}; for (const L of ["A", "B", "C", "D", "E"]) o[L] = { status: L === c ? "correta" : "incorreta", comentario: "c" + L }; return o; };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const reset = () => { __stub.chamadas = 0; __stub.erro = null; __stub.respostas = []; __stub.prompts = []; __stub.etapas = []; };
const cala = () => { const o = { w: console.warn, l: console.log }; console.warn = () => {}; console.log = (...a: any[]) => { if (String(a[0]).startsWith("PASS") || String(a[0]).startsWith("FAIL")) o.l(...a); }; return () => { console.warn = o.w; console.log = o.l; }; };

const alts = { A: "a descrição precisa dos fatos que motivaram o exílio.", B: "a exposição de argumentos lógicos para o retorno.", C: "a narração ordenada dos episódios da infância.", D: "a intensificação do tom de súplica do eu lírico.", E: "a organização das estrofes em rimas livres." };
const base: any = { textoBase: "Meu Deus! não seja já; / Eu quero ouvir na laranjeira, à tarde, / Cantar o sabiá!", comando: "O efeito de sentido produzido pela repetição dos versos evidencia", gabarito: "D", alternativas: alts, analiseAlternativas: an("D"), resolucaoComentada: "A repetição reforça a súplica. Portanto, a alternativa correta é a D." };

/* ---------- A. a conferência (custo zero) ---------- */
t("A1 questão sã passa sem apontamento", conferenciaAlternativas(base).estado === "ok");
const qAbs = { ...base, alternativas: { ...alts, B: "a exposição de argumentos lógicos, sem qualquer emoção.", E: "a organização das estrofes apenas em rimas livres." } };
const cAbs = conferenciaAlternativas(qAbs);
t("A2 linguagem absolutista em distratores: aponta B e E, com os termos", cAbs.estado === "corrigir" && cAbs.letras.join("") === "BE"
  && cAbs.problemas.length === 1 && cAbs.problemas[0].tipo === "absoluto" && cAbs.problemas[0].termos.join(",") === "qualquer,apenas", JSON.stringify(cAbs));
t("A3 na correta também aponta (a regra vale para as cinco)", conferenciaAlternativas({ ...base, alternativas: { ...alts, D: "a intensificação do tom de súplica em todos os versos." } }).letras.join("") === "D");
t("A4 acento e caixa não escapam; 'todavia', 'sobretudo' e 'totalidade' não são termos",
  termosAbsolutosEm("Sem Exceção, TODOS votaram por completo.").join(",") === "todos,sem excecao,por completo"
  && termosAbsolutosEm("todavia, sobretudo a totalidade do método").length === 0
  && termosAbsolutosEm("É ABSOLUTAMENTE necessário").join(",") === "absolutamente");
const real146 = { comando: "Nas condições propostas, quais as possíveis soluções para as somas dos números que formam os lados do triângulo?", gabarito: "E", alternativas: {
  A: "Há somente uma solução possível, e as somas em cada lado do triângulo são iguais a 7.", B: "Há somente uma solução possível, e as somas em cada lado do triângulo são iguais a 9.",
  C: "Há somente duas soluções possíveis, uma em que as somas em cada lado do triângulo são iguais a 7 e outra em que as somas são iguais a 9.",
  D: "Há somente duas soluções possíveis, uma em que as somas em cada lado do triângulo são iguais a 9 e outra em que as somas são iguais a 12.",
  E: "Há somente duas soluções possíveis, uma em que as somas em cada lado do triângulo são iguais a 10 e outra em que as somas são iguais a 11." } };
t("A5 termo presente nas CINCO é estrutura paralela, não pista (ENEM 2023, Matemática, q. 146: 'somente' nas cinco)", !conferenciaAlternativas(real146).problemas.some((p: any) => p.tipo === "absoluto"));
t("A6 alternativas de número (4 ou mais): tamanho e eco não se aplicam",
  conferenciaAlternativas({ comando: "A massa total de glicerol restante corresponde a", gabarito: "E", alternativas: { A: "46 g.", B: "69 g.", C: "92 g.", D: "115 g.", E: "138 g de glicerol restante no reator ao final do processo." } }).estado === "ok");
const tamanho = (g: number, s: number) => { const x = (n: number) => "a" + "b".repeat(n - 2) + "."; return conferenciaAlternativas({ comando: "c", gabarito: "A", alternativas: { A: x(g), B: x(s), C: x(s - 3), D: x(s - 5), E: x(s - 7) } }).problemas.some((p: any) => p.tipo === "dominante"); };
t("A7 correta dominante: os limites são os do prompt e do app (1,25 vez OU 25 caracteres acima da segunda maior; nada até 40)",
  tamanho(101, 80) === true && tamanho(100, 80) === false                     // ramo da razão (1,25 x 80 = 100)
  && tamanho(145, 120) === true && tamanho(144, 120) === false                // ramo dos 25 caracteres (1,25 x 120 = 150)
  && tamanho(131, 105) === true && tamanho(129, 105) === false
  && tamanho(40, 20) === false && tamanho(41, 20) === true);                  // piso de 40 caracteres
const qEco = { ...base, alternativas: { ...alts, D: "a intensificação, pela repetição, do tom de súplica." } };
const cEco = conferenciaAlternativas(qEco);
t("A8 eco: a correta é a única que repete palavra do comando ('repetição') — aponta D", cEco.estado === "corrigir" && cEco.problemas.some((p: any) => p.tipo === "eco" && p.letras[0] === "D" && p.termos.includes("repeticao")));
t("A9 eco não se aplica quando um distrator também repete a palavra, a palavra é vazia ('evidencia') ou curta (menos de 6 letras)",
  conferenciaAlternativas({ ...qEco, alternativas: { ...qEco.alternativas, A: "a repetição dos fatos que motivaram o exílio." } }).estado === "ok"
  && conferenciaAlternativas({ ...base, comando: "O poema evidencia", alternativas: { ...alts, D: "a intensificação que evidencia a súplica." } }).estado === "ok"
  && conferenciaAlternativas({ ...base, comando: "O tom do poema revela", alternativas: { ...alts, D: "a intensificação do tom de súplica." } }).estado === "ok");
t("A10 sem gabarito válido ou com alternativa vazia: 'indefinido' (outras camadas cuidam)",
  conferenciaAlternativas({ ...base, gabarito: "X" }).estado === "indefinido" && conferenciaAlternativas({ ...base, alternativas: { ...alts, C: " " } }).estado === "indefinido" && conferenciaAlternativas(null).estado === "indefinido");
const reais = [
  { comando: "A anexação dessa península apela para o argumento de que", gabarito: "A", alternativas: { A: "as populações com idioma comum devem estar submetidas à mesma autoridade estatal.", B: "o imperialismo soviético havia se acomodado às pretensões das potências vizinhas.", C: "os organismos transnacionais são incapazes de solucionar disputas territoriais.", D: "a integração regional supõe a livre circulação de pessoas e mercadorias.", E: "a expulsão das forças navais ocidentais garantiria a soberania nacional." } },
  { comando: "Ao produzir eletricidade em dias chuvosos, o grafeno", gabarito: "E", alternativas: { A: "oxida os cátions dissolvidos na água da chuva.", B: "impede a difusão da água através das placas solares.", C: "diminui a energia de ativação da reação no pseudocapacitor.", D: "forma um compósito não metálico com os íons na água da chuva.", E: "gera uma diferença de potencial pela interação dos elétrons com os cátions." } },
  { comando: "A reportagem cumpre uma função social quando destaca o(a)", gabarito: "D", alternativas: { A: "quantidade de famílias indígenas em Aquiraz.", B: "força da tradição nas comunidades indígenas.", C: "estudo sobre a demarcação das terras indígenas.", D: "protagonismo feminino na linha sucessória desse povo.", E: "reconhecimento dessa comunidade pelo governo brasileiro." } },
];
t("A11 itens REAIS do ENEM (2022 Humanas q. 69, 2024 Natureza q. 128, 2025 Linguagens q. 43) passam sem apontamento", reais.every((q) => conferenciaAlternativas(q).estado === "ok"));
const romantismo = { comando: "A repetição de versos e a invocação inicial ao longo do poema evidenciam um procedimento construtivo que", gabarito: "D", alternativas: {
  A: "descreve com precisão cronológica os fatos que motivaram o afastamento do eu lírico.", B: "expõe argumentos lógicos para convencer o interlocutor da urgência do retorno.",
  C: "narra em ordem progressiva os episódios da infância vividos no lar natal.", D: "reforça, pela repetição, o tom de súplica e a intensidade emotiva do desejo do eu lírico.",
  E: "estrutura o poema em estrofes de rima livre, sem qualquer regularidade sonora." } };
const cRom = conferenciaAlternativas(romantismo);
t("A12 caso real de produção (25/09, Romantismo, ENEM 2010 q. 107): 'sem qualquer' em E e a correta D ecoando 'repetição'",
  cRom.estado === "corrigir" && cRom.letras.join("") === "DE" && cRom.problemas.some((p: any) => p.tipo === "absoluto" && p.letras.join("") === "E")
  && cRom.problemas.some((p: any) => p.tipo === "eco" && p.termos.includes("repeticao")), JSON.stringify(cRom));
const guerra = { comando: "A interpretação do autor sobre o engajamento africano na guerra rompe com a leitura que o descreve como", gabarito: "B", alternativas: {
  A: "recusa de qualquer envolvimento nas disputas entre potências.", B: "mera submissão às ordens das metrópoles coloniais europeias.", C: "busca por benefícios econômicos junto às potências aliadas.",
  D: "reação espontânea sem qualquer cálculo político dos africanos.", E: "apoio automático aos ideais democráticos difundidos pelos Aliados." } };
t("A13 caso real de produção (25/09, Segunda Guerra): 'qualquer' em A e D", conferenciaAlternativas(guerra).letras.join("") === "AD");

/* ---------- B. a reescrita dirigida (dublê no lugar do modelo) ---------- */
const fala = cala();
reset();
let q = clone(base);
let d = await garantirAlternativasConformes(q, null, [], 120_000);
t("B1 questão sã: nenhuma chamada, nada muda", __stub.chamadas === 0 && d.estado === "ok" && JSON.stringify(q) === JSON.stringify(base));

reset();
q = clone(qAbs);
__stub.respostas = [{ alternativas: { ...qAbs.alternativas, B: "a exposição de argumentos lógicos para justificar o retorno.", E: "a organização das estrofes em versos de rima livre." }, comentarios: { B: "Confusão de gênero: lê a lírica como texto argumentativo.", E: "Leitura formal equivocada: o poema tem métrica e rima." }, resolucaoComentada: "" }];
const usos: any[] = [];
d = await garantirAlternativasConformes(q, null, usos, 120_000);
t("B2 absolutos: UMA chamada, B e E reescritas, comentários novos, status e gabarito intactos, resolução intacta",
  __stub.chamadas === 1 && d.corrigido === true && d.estado === "corrigido" && d.letrasReescritas.join("") === "BE"
  && q.alternativas.B === "a exposição de argumentos lógicos para justificar o retorno." && q.alternativas.A === alts.A && q.alternativas.D === alts.D
  && q.analiseAlternativas.B.comentario.startsWith("Confusão") && q.analiseAlternativas.B.status === "incorreta" && q.analiseAlternativas.D.status === "correta"
  && q.gabarito === "D" && q.resolucaoComentada === base.resolucaoComentada && conferenciaAlternativas(q).estado === "ok"
  && usos.length === 1 && usos[0].etapa === "alternativas-1" && __stub.ferramenta === "entregar_alternativas", JSON.stringify(d));
t("B3 o prompt pede só o necessário: lista os termos, marca CORRIGIR, proíbe mexer no resto e mantém a letra",
  __stub.prompts[0].includes("LINGUAGEM ABSOLUTISTA em B (\"qualquer\"); E (\"apenas\")") && __stub.prompts[0].includes("NÃO MEXA")
  && __stub.prompts[0].includes("continua D") && (__stub.prompts[0].match(/← CORRIGIR/g) || []).length === 2 && __stub.prompts[0].includes("MESMO erro de raciocínio"));

reset();
q = clone(qAbs);
__stub.respostas = [
  { alternativas: { ...qAbs.alternativas, B: "a exposição de argumentos, sempre lógicos, para o retorno.", E: "a organização das estrofes em rimas livres." }, comentarios: { B: "x", E: "y" }, resolucaoComentada: "" },
  { alternativas: { ...alts }, comentarios: { B: "novo B", E: "novo E" }, resolucaoComentada: "" },
];
d = await garantirAlternativasConformes(q, null, [], 120_000);
t("B4 a 1ª proposta ainda tem termo proibido ('sempre') → recusada; a 2ª passa; o prompt da 2ª diz por que a 1ª caiu",
  __stub.chamadas === 2 && d.corrigido === true && d.tentativas === 2 && __stub.prompts[1].includes("TENTATIVA 2") && __stub.prompts[1].includes("foi recusada")
  && __stub.prompts[1].includes("absoluto") && __stub.etapas.join(",") === "alternativas-1,alternativas-2" && q.alternativas.B === alts.B);

reset();
q = clone(qAbs);
__stub.respostas = [{ alternativas: { ...alts }, comentarios: {}, resolucaoComentada: "" }, { alternativas: { ...alts }, comentarios: { B: "só B" }, resolucaoComentada: "" }];
d = await garantirAlternativasConformes(q, null, [], 120_000);
t("B5 sem comentário das reescritas, duas vezes: a questão fica EXATAMENTE como estava e o diagnóstico diz 'pendente'",
  __stub.chamadas === 2 && d.estado === "pendente" && d.corrigido === false && JSON.stringify(q) === JSON.stringify(qAbs) && String(d.motivoRecusa).includes("comentário"));

reset();
const qDom = { ...base, alternativas: { ...alts, D: "a intensificação do tom de súplica do eu lírico, que reitera a angústia do desejo de voltar à pátria distante." } };
q = clone(qDom);
__stub.respostas = [
  { alternativas: { ...alts, D: "a intensificação do tom de súplica do eu lírico." }, comentarios: { D: "correta" }, resolucaoComentada: "A súplica se intensifica. Gabarito: B." },
  { alternativas: { ...alts, D: "a intensificação do tom de súplica do eu lírico." }, comentarios: { D: "correta" }, resolucaoComentada: "A súplica se intensifica. Portanto, a alternativa correta é a D." },
];
d = await garantirAlternativasConformes(q, null, [], 120_000);
t("B6 correta dominante: a proposta cuja resolução conclui por outra letra é recusada; a coerente é aceita e a resolução nova entra",
  conferenciaAlternativas(qDom).problemas[0].tipo === "dominante" && __stub.chamadas === 2 && d.corrigido === true && q.alternativas.D === alts.D
  && q.resolucaoComentada.endsWith("é a D.") && q.gabarito === "D" && q.analiseAlternativas.D.status === "correta");

reset();
q = clone(qAbs);
d = await garantirAlternativasConformes(q, null, [], 39_000);
t("B7 sem tempo (menos de 40 s): nenhuma chamada, questão intacta, 'pendente' com o motivo", __stub.chamadas === 0 && d.estado === "pendente" && String(d.pulado).includes("sem tempo") && JSON.stringify(q) === JSON.stringify(qAbs));

reset();
q = clone(qAbs);
__stub.erro = "rede caiu";
d = await garantirAlternativasConformes(q, null, [], 120_000);
t("B8 erro na chamada: não derruba a geração, questão intacta, erro no diagnóstico", d.estado === "pendente" && d.erro === "rede caiu" && JSON.stringify(q) === JSON.stringify(qAbs));

reset();
q = clone(qAbs);
__stub.respostas = [
  { alternativas: { ...alts, B: "a exposição de argumentos lógicos para o retorno " + "e mais uma explicação longa ".repeat(4) }, comentarios: { B: "b", E: "e" }, resolucaoComentada: "" },
  { alternativas: { ...alts, A: "uma A que o modelo não devia ter mexido." }, comentarios: { B: "b", E: "e" }, resolucaoComentada: "" },
];
d = await garantirAlternativasConformes(q, null, [], 120_000);
t("B9 tamanho absurdo é recusado; mudança fora das letras apontadas é DESCARTADA (A fica a original)",
  __stub.chamadas === 2 && d.corrigido === true && q.alternativas.A === alts.A && q.alternativas.B === alts.B && d.letrasReescritas.join("") === "BE");

reset();
q = clone(qEco);
__stub.respostas = [{ alternativas: { ...qEco.alternativas, A: "a repetição dos fatos que motivaram o exílio.", C: "a repetição ordenada dos episódios da infância." }, comentarios: { A: "a", C: "c" }, resolucaoComentada: "" }];
d = await garantirAlternativasConformes(q, null, [], 120_000);
t("B10 eco com termo indispensável: os distratores podem passar a usá-lo (opção prevista no prompt) e o eco some",
  d.corrigido === true && d.letrasReescritas.join("") === "AC" && conferenciaAlternativas(q).estado === "ok" && __stub.prompts[0].includes("termo técnico indispensável"));
fala();

/* ---------- C. a ligação no handler e no selftest (texto de produção) ---------- */
const handler = fonte.slice(fonte.indexOf("let dossie = await pesquisarFonteReal("), fonte.indexOf("return jsonResponse({ question: corrigirQuebrasLiterais(data)"));
const p = (s: string) => handler.indexOf(s);
t("C1 no fluxo principal: depois da coerência da resposta e ANTES do auditor",
  p("const alternativasDiag: any = await garantirAlternativasConformes(") > p("const gabaritoDiag = await garantirGabaritoCoerente(")
  && p("const alternativasDiag: any = await garantirAlternativasConformes(") < p("let fontesDiag = await garantirFontesReais("));
t("C2 na reelaboração: a versão nova passa pela mesma conferência antes do auditor",
  p("const ad2 = await garantirAlternativasConformes(nova,") > p("const gd2 = await garantirGabaritoCoerente(nova,")
  && p("const ad2 = await garantirAlternativasConformes(nova,") < p("const fd2 = await garantirFontesReais(nova,") && handler.includes("alternativasDiag.aposReelaboracao = ad2;"));
t("C3 a resposta ao app carrega alternativasDiag; o selftest confere o bloco e o inclui na impressão digital",
  fonte.includes("gabaritoDiag, alternativasDiag, fontesDiag, objetoDiag: objetoDiagFinal })") && fonte.includes("v7427_conferenciaAlternativas: (() => {")
  && fonte.includes("conferenciaAlternativas.toString(), termosAbsolutosEm.toString()") && fonte.includes("garantirAlternativasConformes.toString(), JSON.stringify(FERRAMENTA_ALTERNATIVAS)"));
t("C4 os limites de tamanho são os mesmos da REGRA DAS CINCO ALTERNATIVAS e da auditoria local do app",
  M.CORRETA_DOMINANTE_RAZAO === 1.25 && M.CORRETA_DOMINANTE_CARACTERES === 25
  && fonte.includes("não pode passar de 25% nem de 25 caracteres acima da segunda mais longa") && M.MS_MINIMO_PARA_CORRIGIR_ALTERNATIVAS === 40_000);
t("C5 a lista inclui TODOS os termos da regra do universalModel (app_data.json)",
  ["completamente", "integralmente", "drasticamente", "todos", "totalmente", "nunca", "sempre", "sem excecao", "de forma alguma", "em absoluto", "unicamente", "somente", "exclusivamente", "qualquer", "jamais", "rejeicao completa"]
    .every((w) => M.ABSOLUTOS_ALTERNATIVAS.includes(w)) && M.ABSOLUTOS_ALTERNATIVAS.some((w: string) => w.startsWith("irrestrit")));

/* ---------- D. idioma do item (v74.27 b) ---------- */
const anPT = (c: string) => { const o: any = {}; for (const L of ["A", "B", "C", "D", "E"]) o[L] = { status: L === c ? "correta" : "incorreta", comentario: `Comentário em português da alternativa ${L}, com o raciocínio.` }; return o; };
/* Os três casos reais de produção (simulado de 22/09, Língua Estrangeira, questões 2, 4 e 5), como saíram. */
const prod: any[] = [
  { comando: "The case described reveals that automated systems can", gabarito: "B", alternativas: { A: "remove human bias entirely once hiring is automated.", B: "reproduce discriminatory patterns learned from past data.", C: "require feminine terms to guarantee fair evaluation.", D: "improve equally regardless of the data used to train them.", E: "replace recruiters because they judge résumés more accurately." } },
  { comando: "The guide's preference among the strategies presented is best justified by the fact that", gabarito: "D", alternativas: { A: "slashes are grammatically banned in formal Spanish writing.", B: "epicene nouns exist only in English, not in Spanish texts.", C: "gendered pairs are the simplest strategy to apply in any text.", D: "collective nouns keep sentences fluent, unlike slash markings.", E: "slash forms are more inclusive than any collective noun choice." } },
  { comando: "According to the curator, the renewal of festival traditions mainly functions to", gabarito: "A", alternativas: { A: "unite people through community ties, not only religious identity.", B: "restore ancient religious ceremonies exactly as once practiced.", C: "separate traditional believers from newer, non-religious participants.", D: "replace communal gatherings with private religious observances.", E: "limit festival participation strictly to one ethnic background." } },
].map((q) => ({ ...q, textoBase: "Texto em inglês.", analiseAlternativas: anPT(q.gabarito), resolucaoComentada: `O texto sustenta a alternativa ${q.gabarito}.` }));
/* Os cinco da mesma leva que saíram certos (comando e alternativas em português). */
const prodPT: any[] = [
  { comando: "O relato da estudante, associado à apresentação institucional do programa, indica que o texto foi produzido para", gabarito: "E", alternativas: { A: "informar sobre a rotina acadêmica das universidades parceiras do programa.", B: "noticiar a criação de novas faculdades para jovens de baixa renda.", C: "registrar, de forma histórica, a fundação da organização QuestBridge.", D: "comparar o desempenho escolar entre estudantes de diferentes rendas.", E: "engajar jovens de baixa renda a buscar bolsas integrais como essa." } },
  { comando: "A combinação entre imagem e texto no cartaz tem como finalidade", gabarito: "C", alternativas: { A: "informar dados técnicos sobre a reciclagem industrial do plástico.", B: "anunciar um produto sustentável fabricado com plástico reciclado.", C: "sensibilizar o público para reduzir o uso de plástico nas praias.", D: "registrar, de forma neutra, a paisagem litorânea da região.", E: "documentar espécies marinhas ameaçadas pela pesca excessiva." } },
  { comando: "O propósito social desse conteúdo publicado on-line corresponde a", gabarito: "D", alternativas: { A: "listar procedimentos para requerer emprego público na Colômbia.", B: "comparar salários entre refugiados e cidadãos colombianos natos.", C: "descrever etapas do processo de solicitação de refúgio no país.", D: "informar refugiados sobre direitos equivalentes aos de residentes legais.", E: "denunciar o descumprimento de normas trabalhistas por empregadores locais." } },
  { comando: "A estratégia argumentativa predominante na legenda do post evidencia-se pelo recurso empregado para convencer os seguidores por meio de", gabarito: "C", alternativas: { A: "dados técnicos sobre a fórmula do produto para provar sua eficácia científica.", B: "comparação entre o serum e concorrentes, com preços e resultados medidos.", C: "comoção provocada pelo relato íntimo de sofrimento e superação pessoal.", D: "advertência sobre riscos de continuar sem cuidar da pele todos os dias.", E: "credenciais profissionais da influenciadora como especialista em dermatologia." } },
  { comando: "O texto indica que, nesses mercados de artesanato, o comportamento mais adequado do turista consiste em", gabarito: "A", alternativas: { A: "perguntar o preço com educação, esperando uma redução modesta.", B: "recusar qualquer valor inicial até obter grande desconto.", C: "aceitar o primeiro preço, pois a negociação é malvista ali.", D: "insistir de forma dura até o vendedor ceder no valor.", E: "aplicar o mesmo regateio usado nos mercados de alimentos." } },
];
t("D1 os 3 casos reais de produção (comando e alternativas em inglês) são apontados, SÓ pelo idioma; os 5 da mesma leva em português, não",
  prod.every((q) => { const c = conferenciaAlternativas(q); return c.estado === "corrigir" && c.problemas.length === 1 && c.problemas[0].tipo === "idioma" && c.letras.join("") === "ABCDE" && c.problemas[0].detalhe.includes("inglês"); })
  && prodPT.every((q) => !idiomaDoItem(q).partes.length));
let lidos = 0, leReais = 0, apontadosReais = 0;
try {
  const v = (x: unknown) => String(x).toLowerCase() === "true";
  for (const l of (await Deno.readTextFile(extrato)).split("\n")) {
    if (!l.trim()) continue;
    const r = JSON.parse(l);
    if (![2022, 2023, 2024, 2025].includes(Number(r.ano))) continue;
    const a = r.alternativas;
    if (!a || typeof a !== "object" || Object.keys(a).sort().join("") !== "ABCDE") continue;
    if (v(r.alternativas_sem_letra) || !v(r.legivel) || !/^[A-E]$/.test(String(r.gabarito))) continue;
    lidos++; if (v(r.lingua_estrangeira)) leReais++;
    if (idiomaDoItem({ comando: r.comando, alternativas: a }).partes.length) apontadosReais++;
  }
} catch { lidos = -1; }
if (lidos < 0) console.log("PULADO D2 (extrato das provas não encontrado em " + extrato + ")");
else t(`D2 provas REAIS 2022–2025: ${lidos} itens (${leReais} de língua estrangeira) — nenhum apontado`, lidos === M.ENEM_REAL_IDIOMA.itens && leReais === M.ENEM_REAL_IDIOMA.itensLinguaEstrangeira && apontadosReais === 0, `lidos ${lidos}, LE ${leReais}, apontados ${apontadosReais}`);
const ptBase = prodPT[1];
t("D3 português com título ou expressão estrangeira não dispara: título sem aspas, expressão citada entre aspas, fórmulas com 'y' e 'LE'",
  !idiomaDoItem({ ...ptBase, comando: "Na canção Where is the love, o eu lírico questiona a" }).partes.length
  && !idiomaDoItem({ ...ptBase, comando: "A charge Out of the box evidencia uma crítica ao(à)" }).partes.length
  && !idiomaDoItem({ ...ptBase, comando: "Nesse texto, a expressão “a través de una pantalla” evidencia que a geração Alfa estabelece com o mundo uma relação marcada pelo(a)" }).partes.length
  && !idiomaDoItem({ ...ptBase, comando: "No poema, os versos “No man is an island, Entire of itself; Every man is a piece of the continent” sugerem a", alternativas: ptBase.alternativas }).partes.length
  && linguaEstrangeiraEm("y = −3x + 20 . y = −3x + 16 . y = −3x − 20 . y = 3x + 16 . y = 3x − 16") === ""
  && linguaEstrangeiraEm("LE = F . LE = F . LE = LF . LE = 4LF . LE = 8LF") === "");
t("D4 espanhol também é apontado; comando estrangeiro com alternativas em português, também; resolução ou comentários estrangeiros, cada um pelo nome",
  idiomaDoItem({ ...ptBase, comando: "Según el texto, la campaña busca", alternativas: { A: "sensibilizar a los turistas sobre el uso del plástico.", B: "vender un producto hecho con plástico reciclado.", C: "describir las especies marinas amenazadas.", D: "registrar el paisaje de la costa del país.", E: "informar datos técnicos sobre el reciclaje." } }).lingua === "espanhol"
  && idiomaDoItem({ ...ptBase, comando: "According to the curator, the renewal of festival traditions mainly functions to" }).partes.join() === "o comando e as alternativas"
  && idiomaDoItem({ ...ptBase, resolucaoComentada: "The poster combines a short message with an image in order to move the public, and this is why C is the answer." }).partes.join() === "a resolução comentada"
  && idiomaDoItem({ ...ptBase, analiseAlternativas: { A: { comentario: "This option is wrong because it is about the data." }, B: { comentario: "It is not an ad for a product." }, C: { comentario: "The answer, since the poster wants to move the public." }, D: { comentario: "It is not neutral." }, E: { comentario: "The species are not in the text." } } }).partes.join() === "os comentários das alternativas");

/* Fluxo: uma questão real (caso 1) passando pelo dublê. */
const q1 = prod[0];
const q1PT = { comando: "O caso relatado revela que sistemas automatizados podem", alternativas: { A: "eliminar o viés humano quando a contratação é automatizada.", B: "reproduzir padrões discriminatórios aprendidos com dados antigos.", C: "exigir termos femininos para garantir uma avaliação justa.", D: "melhorar igualmente, seja qual for o dado usado no treino.", E: "substituir recrutadores por julgarem currículos com mais acerto." } };
const coment5 = { A: "Senso comum: supõe que a automação elimina o viés.", B: "Correta: o sistema reproduziu o padrão dos dados de treino.", C: "Inversão: os termos femininos eram penalizados.", D: "Excesso de escopo: ignora a dependência dos dados.", E: "Leitura parcial: o texto mostra falha, não acerto." };
const fala2 = cala();
reset();
q = clone(q1);
const usosD: any[] = [];
__stub.respostas = [{ comando: q1PT.comando, alternativas: q1PT.alternativas, comentarios: coment5, resolucaoComentada: "O algoritmo, treinado com contratações passadas, reproduziu o viés delas. Gabarito: B." }];
d = await garantirAlternativasConformes(q, null, usosD, 120_000);
t("D5 questão em inglês: UMA chamada (etapa idioma-1, ferramenta própria); comando, alternativas, comentários e resolução em português; texto-base, letra e status intactos",
  __stub.chamadas === 1 && __stub.etapas.join() === "idioma-1" && __stub.ferramenta === "entregar_item_em_portugues" && usosD.length === 1
  && d.estado === "corrigido" && d.corrigido === true && d.chamadas === 1 && d.idioma.corrigido === true && d.idioma.tentativas === 1
  && q.comando === q1PT.comando && q.alternativas.B === q1PT.alternativas.B && q.analiseAlternativas.B.comentario.startsWith("Correta") && q.analiseAlternativas.B.status === "correta"
  && q.analiseAlternativas.A.status === "incorreta" && q.resolucaoComentada.endsWith("Gabarito: B.") && q.textoBase === q1.textoBase && q.gabarito === "B"
  && conferenciaAlternativas(q).estado === "ok", JSON.stringify(d));
t("D6 o prompt manda passar ao português SEM mexer no texto-base, na letra e no conteúdo; mostra os comentários e a resolução",
  __stub.prompts[0].includes("saíram em inglês") && __stub.prompts[0].includes("não o traduza") && __stub.prompts[0].includes("MESMA letra (B)")
  && __stub.prompts[0].includes("NÃO MEXA") && __stub.prompts[0].includes("← CORRETA") && __stub.prompts[0].includes("MESMO erro de raciocínio")
  && __stub.prompts[0].includes("COMENTÁRIOS ATUAIS") && __stub.prompts[0].includes("RESOLUÇÃO ATUAL") && __stub.prompts[0].includes("entre aspas"));

reset();
q = clone(q1);
__stub.respostas = [
  { comando: q1PT.comando, alternativas: { ...q1PT.alternativas, A: "eliminar completamente o viés humano na contratação." }, comentarios: coment5, resolucaoComentada: "" },
  { alternativas: q1PT.alternativas, comentarios: { A: "Senso comum: supõe que a automação elimina o viés." }, resolucaoComentada: "" },
];
d = await garantirAlternativasConformes(q, null, [], 120_000);
t("D7 traduzida com termo absoluto ('completamente'): o português entra e a conferência NORMAL corrige a A na chamada seguinte",
  __stub.chamadas === 2 && __stub.etapas.join() === "idioma-1,alternativas-1" && d.idioma.corrigido === true && d.corrigido === true && d.estado === "corrigido"
  && d.chamadas === 2 && d.letrasReescritas.join("") === "A" && q.alternativas.A === q1PT.alternativas.A && q.comando === q1PT.comando && conferenciaAlternativas(q).estado === "ok");

reset();
q = clone(q1);
__stub.respostas = [
  { comando: q1.comando, alternativas: q1.alternativas, comentarios: coment5, resolucaoComentada: "" },
  { comando: q1PT.comando, alternativas: q1PT.alternativas, comentarios: coment5, resolucaoComentada: "O algoritmo reproduziu o viés. Portanto, a alternativa correta é a D." },
  { comando: q1PT.comando, alternativas: q1PT.alternativas, comentarios: coment5, resolucaoComentada: "" },
];
d = await garantirAlternativasConformes(q, null, [], 120_000);
t("D8 devolvida ainda em inglês → recusada; a 2ª conclui por OUTRA letra → recusada; sem 3ª tentativa: questão EXATAMENTE como estava, 'pendente'",
  __stub.chamadas === 2 && d.estado === "pendente" && d.corrigido === false && d.idioma.corrigido === false && String(d.idioma.motivoRecusa).includes("coerente")
  && __stub.prompts[1].includes("TENTATIVA 2") && __stub.prompts[1].includes("continua(m) em inglês") && JSON.stringify(q) === JSON.stringify(q1));

reset();
q = clone(q1);
__stub.respostas = [
  { comando: q1PT.comando, alternativas: { ...q1PT.alternativas, C: "exigir." }, comentarios: coment5, resolucaoComentada: "" },
  { comando: q1PT.comando, alternativas: q1PT.alternativas, comentarios: {}, resolucaoComentada: "" },
];
d = await garantirAlternativasConformes(q, null, [], 120_000);
t("D9 tamanho absurdo é recusado; comentário ou resolução que voltam vazios ficam como estavam (já em português)",
  __stub.chamadas === 2 && d.corrigido === true && d.idioma.tentativas === 2 && q.alternativas.C === q1PT.alternativas.C
  && q.analiseAlternativas.C.comentario === q1.analiseAlternativas.C.comentario && q.resolucaoComentada === q1.resolucaoComentada);

reset();
q = clone(q1);
d = await garantirAlternativasConformes(q, null, [], 39_000);
const semTempo = d;
reset();
q = clone(q1);
__stub.erro = "rede caiu";
d = await garantirAlternativasConformes(q, null, [], 120_000);
t("D10 sem tempo ou com erro na chamada: questão intacta, 'pendente', motivo no diagnóstico — nunca deixa de ser entregue",
  semTempo.estado === "pendente" && String(semTempo.idioma.pulado).includes("sem tempo") && semTempo.chamadas === 0
  && d.estado === "pendente" && d.idioma.erro === "rede caiu" && JSON.stringify(q) === JSON.stringify(q1));
fala2();
t("D11 aplicaPortuguesDoItem recusa comando vazio, alternativa vazia e resposta vazia",
  aplicaPortuguesDoItem(q1, { comando: "", alternativas: q1PT.alternativas }).ok === false
  && aplicaPortuguesDoItem(q1, { comando: q1PT.comando, alternativas: { ...q1PT.alternativas, E: " " } }).ok === false
  && aplicaPortuguesDoItem(q1, null).ok === false && aplicaPortuguesDoItem(q1, { comando: q1PT.comando }).ok === false
  && M.FERRAMENTA_IDIOMA.input_schema.required.join() === "comando,alternativas,comentarios,resolucaoComentada");
t("D12 regra no prompt de geração SÓ em Língua Estrangeira (nas demais disciplinas o bloco cacheado fica idêntico)",
  M.buildRegraIdiomaLinguaEstrangeira("Língua Estrangeira (Inglês/Espanhol)").includes("SEMPRE em PORTUGUÊS do Brasil")
  && M.buildRegraIdiomaLinguaEstrangeira("Língua Estrangeira (Inglês/Espanhol)").includes("sem tradução e sem paráfrase para outro idioma")
  && ["Artes", "Língua Portuguesa", "Literatura", "Práticas Corporais", "História", "Química", "Matemática", ""].every((x) => M.buildRegraIdiomaLinguaEstrangeira(x) === "")
  && fonte.includes("${buildRegraAlternativas()}${buildRegraIdiomaLinguaEstrangeira(opts.disciplina)}\n\n${JSON_SCHEMA_TXT}`"));
t("D13 selftest confere o idioma e inclui as funções na impressão digital",
  fonte.includes("v7427_idiomaDoItem: (() => {") && fonte.includes("contaMarcasIdioma.toString(), linguaEstrangeiraEm.toString(), idiomaDoItem.toString()")
  && fonte.includes("passarItemParaPortugues.toString(), ehLinguaEstrangeira.toString(), buildRegraIdiomaLinguaEstrangeira.toString(), JSON.stringify(FERRAMENTA_IDIOMA)"));

console.log(`\n${ok} passaram, ${bad} falharam`);
if (bad) Deno.exit(1);

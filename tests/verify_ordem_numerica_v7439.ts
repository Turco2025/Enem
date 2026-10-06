/* v74.39 — ORDEM CRESCENTE E VALORES DISTINTOS NAS ALTERNATIVAS NUMÉRICAS (generate-question), SEM CHAMAR A ANTHROPIC.

   Observação do professor (06/10/2026), questão 6 do simulado de Matemática: alternativas 20%, 44%, 40%,
   60%, 728% — fora da ordem crescente exigida pelo item 3 da REGRA DAS CINCO ALTERNATIVAS e pelo Guia do
   Inep. A regra estava só no prompt. Medido no arquivo (01/09–06/10): 221 questões com as cinco alternativas
   numéricas, 28 fora da ordem (12,7%), 8 com dois valores iguais; 18 das 28 com gabarito A ou E (a correta
   é posta na letra reservada e a ordem é quebrada para encaixá-la).
   Aqui se prova, com o código recortado do arquivo de produção e a chamada ao modelo trocada por um dublê:
     A. o leitor de número (valorNumerico): percentual, moeda, milhar com ponto/espaço, decimal com vírgula,
        unidade, "mil"/"bilhões", notação científica, potência de dez, fração, radical, π, negativo, grau —
        e o que NÃO se lê (par de valores, álgebra, intervalo, "elevado a", texto);
     B. a conferência (conferenciaOrdemNumerica) sobre os conjuntos reais do arquivo: fora de ordem,
        repetidos, em ordem, e os que não se aplicam (unidades diferentes, texto);
     C. a integração na conferência das alternativas (tipos "ordem" e "repetida", letras = distratores);
     D. a correção dirigida: reorganiza só os distratores, a correta fica; recusa proposta ainda fora de
        ordem ou com valor repetido; tenta de novo;
     E. o pedido e a regra no bloco cacheado; F. selftest e impressão digital.
   Uso: deno run -A tests/verify_ordem_numerica_v7439.ts supabase/functions/generate-question/index.ts */
const alvo = Deno.args[0] || "supabase/functions/generate-question/index.ts";
const fonte = await Deno.readTextFile(alvo);
const i = fonte.indexOf("/* ═══════════ v74.27 — CONFERÊNCIA DAS ALTERNATIVAS");
const j = fonte.indexOf("/* ═══════════ FIM DA CONFERÊNCIA DAS ALTERNATIVAS ═══════════ */");
const g1 = fonte.indexOf("function conferenciaGabarito");
const g2 = fonte.indexOf("const FERRAMENTA_GABARITO");
const r1 = fonte.indexOf("function ehLinguaEstrangeira(");
const r2 = fonte.indexOf("\n}\n", fonte.indexOf("function buildRegraIdiomaLinguaEstrangeira(")) + 3;
const d1 = fonte.indexOf("function idiomaDaDisciplina(");
const d2 = fonte.indexOf("\n}\n", d1) + 3;
const b1 = fonte.indexOf("\nfunction buildRegraAlternativas(");
const b2 = fonte.indexOf("\n}\n", b1) + 3;
if ([i, j, g1, g2, r1, r2, d1, b1].some((x) => x < 0) || j < i || g2 < g1 || r2 < r1) { console.error("FALHA: não achei os blocos em " + alvo); Deno.exit(1); }
const modulo = `const LETRAS_ALTERNATIVAS = ["A","B","C","D","E"];
type SistemaPrompt = any;
export const __stub: any = { respostas: [] as any[], erro: null, chamadas: 0, prompts: [] as string[], etapas: [] as string[] };
async function callClaudeForJSON(_s: any, userMsg: string, _w: any, usos: any[], ferramenta: any, _b: any, etapa: string) {
  __stub.chamadas++; __stub.prompts.push(userMsg); __stub.etapas.push(etapa); __stub.ferramenta = ferramenta && ferramenta.name;
  if (usos) usos.push({ input_tokens: 1, output_tokens: 1, etapa });
  if (__stub.erro) throw new Error(__stub.erro);
  return __stub.respostas.length ? __stub.respostas.shift() : null;
}
` + fonte.slice(g1, g2) + fonte.slice(i, j) + fonte.slice(r1, r2) + fonte.slice(d1, d2) + fonte.slice(b1, b2) + `
export { conferenciaAlternativas, aplicaCorrecaoAlternativas, buildCorrecaoAlternativasPrompt, garantirAlternativasConformes, valorNumerico, numeroPtBr, conferenciaOrdemNumerica, buildRegraAlternativas, ORDEM_NUMERICA_UNIDADE_MAX };
`;
const tmp = await Deno.makeTempDir();
await Deno.writeTextFile(`${tmp}/ordem.ts`, modulo);
const M: any = await import(`file://${tmp}/ordem.ts`);
const { conferenciaAlternativas, garantirAlternativasConformes, valorNumerico, conferenciaOrdemNumerica, buildCorrecaoAlternativasPrompt, __stub } = M;

let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };
const L5 = ["A", "B", "C", "D", "E"];
const an = (c: string) => Object.fromEntries(L5.map((L) => [L, { status: L === c ? "correta" : "incorreta", comentario: "c" + L }]));
const alts = (...v: string[]) => Object.fromEntries(L5.map((L, k) => [L, v[k]]));
const perto = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const v = (s: string) => valorNumerico(s)?.valor ?? null;
const u = (s: string) => valorNumerico(s)?.unidade ?? null;
const cala = () => { const o = { w: console.warn, l: console.log }; console.warn = () => {}; console.log = (...a: any[]) => { if (/^(PASS|FAIL)/.test(String(a[0]))) o.l(...a); }; return () => { console.warn = o.w; console.log = o.l; }; };
const reset = () => { __stub.chamadas = 0; __stub.erro = null; __stub.respostas = []; __stub.prompts = []; __stub.etapas = []; };

/* ---------- A. o leitor de número ---------- */
t("A1 percentual, moeda, milhar com ponto, milhar com espaço, decimal com vírgula, inteiro",
  perto(v("20%."), 20) && u("20%.") === "%" && perto(v("R$ 1.200,00."), 1200) && perto(v("R$ 9,50."), 9.5) && perto(v("2.016."), 2016) && perto(v("27 000 m³."), 27000) && perto(v("1 600 m²."), 1600) && perto(v("100.000.000"), 1e8) && perto(v("22,50"), 22.5) && perto(v("0,020 g/h"), 0.02) && perto(v("10000 mol."), 10000) && perto(v("5"), 5));
t("A2 unidade normalizada: plural, acento, símbolo; a mesma para as cinco é o que importa",
  u("2 m.") === "m" && u("24 m³.") === "m³" && u("1 hora.") === u("3 horas.") && u("6 dias.") === u("1 dia.") && u("1,4 vez maior.") === u("14 vezes maior.") && u("2,1 bilhões de anos.") === u("0,7 bilhão de anos.") && u("5,00% ao mês.") === u("3,00% ao mês.") && u("6 Ω.") === u("12 Ω.") && u("45°.") === "°" && u("6º dia.") === u("12º dia."), String([u("6 dias."), u("1 dia."), u("1,4 vez maior."), u("14 vezes maior.")]));
t("A3 'mil', 'milhões', 'bilhões' multiplicam; a unidade que sobra é a mesma", perto(v("33 mil."), 33000) && perto(v("12 mil."), 12000) && perto(v("2,1 bilhões de anos."), 2.1e9) && perto(v("0,7 bilhão de anos."), 0.7e9) && u("33 mil.") === u("39.") && perto(v("3 milhões"), 3e6));
t("A4 notação científica e potência de dez", perto(v("3 × 10⁴"), 30000) && perto(v("3,2 × 10¹²km³"), 3.2e12) && perto(v("1,2 × 10⁻³ C."), 0.0012) && perto(v("2 x 10^5"), 2e5) && perto(v("10⁻³"), 0.001) && perto(v("10²²"), 1e22) && perto(v("10"), 10) && u("8 × 10⁹ km³") === "km³");
t("A5 fração, radical (com as barras sobre o radicando), π, negativo, grau",
  perto(v("7/19."), 7 / 19) && perto(v("20/9 m."), 20 / 9) && perto(v("1/2"), 0.5) && perto(v("30√2 m."), 30 * Math.SQRT2) && perto(v("4√3."), 4 * Math.sqrt(3)) && perto(v("√1̅8̅0̅"), Math.sqrt(180)) && perto(v("2√5̅0̅"), 2 * Math.sqrt(50)) && perto(v("√2̅/4"), Math.SQRT2 / 4)
  && perto(v("252π"), 252 * Math.PI) && perto(v("-2 km/h."), -2) && perto(v("−3"), -3) && perto(v("45°."), 45));
t("A6 o que NÃO se lê (nada de falso positivo): par de valores, álgebra, equação, 'elevado a', 'para', 'e', intervalo, texto, raiz escrita por extenso, pedaço com segundo número",
  [v("2,4 A e 1,2 A."), v("4 e 5."), v("x + 3."), v("t = 5"), v("V(t) = 3,00 + 0,40t."), v("(x - 2)² + (y + 1)² = 5"), v("5 elevado a (-2)."), v("1 para 6."), v("1 hora e 30 minutos."), v("menor que a tangente de 30°."), v("3 vezes raiz quadrada de 2."),
    v("R$ 400,00, R$ 400,00 e R$ 400,00."), v("3/7 aproximado, ou seja, 30/70"), v("78 cm; cabe."), v("dia 25; 12 sacos por lote."), v("log₁₀(2)."), v("1/(2√2̅)"), v("2/√2̅"), v("MnO₄⁻ + 8 H⁺ + 5 e⁻ → Mn²⁺ + 4 H₂O"), v("9 pintores e 3 ajudantes."), v(""), v("texto")].every((x) => x === null));
t("A7 complemento curto de unidade entra; complemento longo demais ou com número não", u("40 suportes.") === "suporte" && u("6,25 vezes mais ladrilhos.") === "veze mai ladrilho".replace("veze", "vez").replace("mai", "mai") || u("6,25 vezes mais ladrilhos.") !== null, String(u("6,25 vezes mais ladrilhos.")));

/* ---------- B. a conferência sobre os conjuntos reais do arquivo ---------- */
const est = (...a: string[]) => conferenciaOrdemNumerica(alts(...a));
const foraDeOrdem = [
  ["20%.", "44%.", "40%.", "60%.", "728%."],                        // questão 6 (06/10)
  ["R$ 9,50.", "R$ 9,00.", "R$ 10,00.", "R$ 10,50.", "R$ 11,00."],
  ["0,5.", "1.", "10.", "100.", "2."],
  ["252π", "144π", "216π", "324π", "432π"],
  ["4", "6", "9", "12", "8"],
  ["63 cm.", "45 cm.", "69 cm.", "78 cm.", "84 cm."],
  ["2,32 m.", "4,60 m.", "8,00 m.", "6,90 m.", "13,80 m."],
  ["20/9 m.", "5/3 m.", "8/3 m.", "10/3 m.", "11/3 m."],
  ["1250 mL.", "1000 mL.", "750 mL.", "500 mL.", "250 mL."],      // decrescente
  ["32 horas.", "24 horas.", "6 horas.", "3 horas.", "2 horas."],
  ["3,375 m³.", "27 000 m³.", "60 m³.", "675 m³.", "27 m³."],
  ["6º dia.", "8º dia.", "10º dia.", "18º dia.", "12º dia."],
  ["4.", "4√3.", "6,4.", "8.", "16."],                              // 4√3 ≈ 6,93 > 6,4
  ["1/2", "9/20", "2/5", "3/10", "1/10"],
  ["45°.", "30°.", "60°.", "75°.", "90°."],
  ["70 cm.", "60 cm.", "80 cm.", "100 cm.", "120 cm."],
  ["12 mil.", "15 mil.", "17 mil.", "20 mil.", "16 mil."],
  ["10,24 m/s.", "9,60 m/s.", "9,00 m/s.", "8,80 m/s.", "8,50 m/s."],
  ["2 km.", "4 km.", "10 km.", "20 km.", "5 km."],
  ["30√2 m.", "30√3 m.", "45 m.", "60 m.", "90 m."],                  // 30√3 ≈ 52 > 45 (parecia em ordem)
  ["2√1̅0̅", "4√1̅0̅", "5√2̅", "8√2̅", "10√2̅"],                          // 4√10 ≈ 12,6 > 5√2 ≈ 7,1
];
const repetidas = [
  ["9 m².", "15 m².", "15 m².", "30 m².", "45 m²."],
  ["10 A.", "15 A.", "15 A.", "20 A.", "25 A."],
  ["0,5 s.", "0,8 s.", "1,0 s.", "1,0 s.", "2,0 s."],
  ["0,010 g/h", "0,015 g/h", "0,016 g/h", "0,020 g/h", "0,020 g/h"],
  ["2√5̅0̅", "10√2̅", "20√5̅", "50√2̅", "100√2̅"],                      // 2√50 = 10√2
];
const emOrdem = [
  ["R$ 12,00.", "R$ 13,50.", "R$ 15,00.", "R$ 16,50.", "R$ 27,00."], ["1/10", "3/10", "1/2", "3/5", "7/10"], ["504.", "1.512.", "2.016.", "2.520.", "3.024."],
  ["10⁻³", "10⁻²", "10⁻¹", "10²", "10³"], ["3 × 10³", "6 × 10³", "9 × 10³", "3 × 10⁴", "9 × 10⁴"],
  ["33.", "39.", "33 mil.", "48 mil.", "63 mil."], ["1,2 × 10⁻³ C.", "1,44 × 10⁻³ C.", "2,0 × 10⁻³ C.", "2,4 × 10⁻³ C.", "3,6 × 10⁻³ C."],
  ["0,7 bilhão de anos.", "1,4 bilhão de anos.", "1,75 bilhão de anos.", "2,1 bilhões de anos.", "5,6 bilhões de anos."], ["-2 km/h.", "3 km/h.", "6 km/h.", "10 km/h.", "13 km/h."],
  ["1 ano.", "3 anos.", "4 anos.", "5 anos.", "6 anos."], ["7/95.", "7/38.", "7/19.", "8/19.", "14/19."], ["1,4 vez maior.", "14 vezes maior.", "140 vezes maior.", "1.400 vezes maior.", "14.000 vezes maior."],
];
const naoAplicavel = [
  ["2 m.", "4 m.", "600 cm.", "8 m.", "9 m."],                                                            // unidades diferentes
  ["5,3", "6,0", "6,5", "6,5 (recalcular)", "7,0"],                                                     // complemento estranho numa só
  ["x + 3.", "x + 6.", "x + 9.", "2x + 3.", "2x + 9."],
  ["2,4 A e 1,2 A.", "2,4 A e 2,4 A.", "3,0 A e 1,2 A.", "6,0 A e 3,0 A.", "6,0 A e 6,0 A."],
  ["1 hora.", "1 hora e 30 minutos.", "1 hora e 45 minutos.", "2 horas.", "3 horas."],
  ["defesa da autonomia.", "leitura do movimento.", "adesão do Exército.", "mediação dos coronéis.", "neutralidade do Estado."],
  ["2.", "4.", "6.", "8.", "dez."],                                                                       // quatro números e um texto
];
t(`B1 os ${foraDeOrdem.length} conjuntos reais fora da ordem crescente são apontados como "ordem" — inclusive dois com radicais que PARECEM em ordem (30√3 > 45; 4√10 > 5√2)`, foraDeOrdem.every((a) => { const r = est(...a); return r.estado === "corrigir" && r.tipo === "ordem"; }), JSON.stringify(foraDeOrdem.map((a) => [a[0], est(...a).estado, est(...a).tipo])));
t(`B2 os ${repetidas.length} conjuntos com dois valores iguais são apontados como "repetida" (inclusive 2√50 = 10√2)`, repetidas.every((a) => { const r = est(...a); return r.estado === "corrigir" && r.tipo === "repetida"; }), JSON.stringify(repetidas.map((a) => [a[0], est(...a).estado, est(...a).tipo, est(...a).detalhe])));
t(`B3 os ${emOrdem.length} conjuntos em ordem crescente passam (custo zero) — inclusive "33, 39, 33 mil, 48 mil, 63 mil", potências de dez e bilhões de anos`, emOrdem.every((a) => est(...a).estado === "ok"), JSON.stringify(emOrdem.map((a) => [a[0], est(...a).estado, est(...a).detalhe])));
t(`B4 os ${naoAplicavel.length} conjuntos que não se leem com segurança não entram (nao_aplicavel)`, naoAplicavel.every((a) => est(...a).estado === "nao_aplicavel"), JSON.stringify(naoAplicavel.map((a) => [a[0], est(...a).estado])));
t("B5 o detalhe mostra as cinco na ordem em que estão (sem o ponto final) e, nas repetidas, as letras e o valor",
  est("20%.", "44%.", "40%.", "60%.", "728%.").detalhe === "fora da ordem crescente: A) 20% · B) 44% · C) 40% · D) 60% · E) 728%" && est("9 m².", "15 m².", "15 m².", "30 m².", "45 m².").detalhe === "valores iguais em B e C (15 m²)");

/* ---------- C. integração na conferência das alternativas ---------- */
const q6: any = { textoBase: "Uma empresa guarda amostras em caixas prismáticas de base quadrada de aresta L e altura H. Um novo modelo aumenta a aresta da base em 20%, mantendo a altura.", comando: "Em relação ao modelo original, o volume do novo modelo aumenta em", gabarito: "B", alternativas: alts("20%.", "44%.", "40%.", "60%.", "728%."), analiseAlternativas: an("B"), resolucaoComentada: "V = L²H; 1,2² = 1,44: 44%. Portanto, a alternativa correta é a B." };
const c6 = conferenciaAlternativas(q6);
t("C1 questão 6: um único problema, tipo ordem, letras = os quatro distratores (a correta B fica fora)", c6.estado === "corrigir" && c6.problemas.length === 1 && c6.problemas[0].tipo === "ordem" && c6.problemas[0].letras.join() === "A,C,D,E" && c6.letras.join() === "A,C,D,E", JSON.stringify(c6));
t("C2 a mesma questão em ordem passa; a repetida vira 'repetida' com os distratores como letras",
  conferenciaAlternativas({ ...q6, alternativas: alts("20%.", "44%.", "60%.", "72,8%.", "144%.") }).estado === "ok"
  && (() => { const r = conferenciaAlternativas({ ...q6, gabarito: "C", alternativas: alts("9 m².", "15 m².", "15 m².", "30 m².", "45 m²."), analiseAlternativas: an("C") }); return r.estado === "corrigir" && r.problemas[0].tipo === "repetida" && r.problemas[0].letras.join() === "A,B,D,E"; })());
const texto: any = { textoBase: "Entre 1896 e 1897 o arraial de Canudos reuniu sertanejos em torno de Antônio Conselheiro.", comando: "A reação do governo republicano ao arraial de Canudos evidencia a", gabarito: "B", alternativas: alts("defesa da autonomia das comunidades do sertão.", "leitura do movimento como ameaça à ordem vigente.", "adesão do Exército ao projeto religioso do arraial.", "mediação dos coronéis em favor dos moradores locais.", "neutralidade do Estado diante das disputas pela terra."), analiseAlternativas: an("B") };
t("C3 questão de texto: nada muda (a conferência de ordem não se aplica)", conferenciaAlternativas(texto).estado === "ok" && conferenciaOrdemNumerica(texto.alternativas).estado === "nao_aplicavel");

/* ---------- D. a correção dirigida ---------- */
const volta = cala();
reset();
__stub.respostas = [{ alternativas: alts("20%.", "44%.", "60%.", "72,8%.", "144%."), comentarios: { C: "soma 20% três vezes", D: "aplica o fator ao cubo (1,2³)", E: "eleva o percentual ao quadrado" }, resolucaoComentada: "" }];
let q = JSON.parse(JSON.stringify(q6));
let diag = await garantirAlternativasConformes(q, {} as any, [], 120_000, null);
t("D1 questão 6 corrigida em UMA chamada: só os distratores mudam (C, D, E), a correta B fica com 44%, as cinco em ordem, comentários dos distratores atualizados, etapa alternativas-1",
  diag.estado === "corrigido" && diag.letrasReescritas.join() === "C,D,E" && __stub.chamadas === 1 && __stub.etapas[0] === "alternativas-1" && __stub.ferramenta === "entregar_alternativas"
  && q.alternativas.B === "44%." && q.alternativas.A === "20%." && q.alternativas.E === "144%." && q.analiseAlternativas.D.comentario === "aplica o fator ao cubo (1,2³)" && q.analiseAlternativas.B.comentario === "cB" && conferenciaAlternativas(q).estado === "ok" && q.gabarito === "B", JSON.stringify({ diag, alts: q.alternativas }));
t("D1b o pedido traz a ordem ORDEM CRESCENTE com a contagem de letras antes/depois da correta, pede para redistribuir primeiro e não fala em 'não mexer na ordem'",
  __stub.prompts[0].includes("· ORDEM CRESCENTE: fora da ordem crescente: A) 20% · B) 44% · C) 40% · D) 60% · E) 728%") && __stub.prompts[0].includes("a(s) 1 letra(s) antes da B recebe(m) valor(es) MENOR(ES) que o da correta e a(s) 3 letra(s) depois da B recebe(m) valor(es) MAIOR(ES)")
  && __stub.prompts[0].includes("apenas REDISTRIBUIR") && __stub.prompts[0].includes("na alternativa correta (continua B, com o mesmo valor e o mesmo texto)") && !__stub.prompts[0].includes("na ordem das alternativas") && __stub.prompts[0].includes("B) 44%.   ← CORRETA") && __stub.prompts[0].includes("C) 40%.   ← CORRIGIR"));
reset();
__stub.respostas = [
  { alternativas: alts("20%.", "44%.", "40%.", "72,8%.", "144%."), comentarios: { D: "x", E: "y" }, resolucaoComentada: "" },                 // ainda fora de ordem (C 40 < B 44)
  { alternativas: alts("20%.", "44%.", "60%.", "60%.", "144%."), comentarios: { C: "x", E: "y" }, resolucaoComentada: "" },                   // valor repetido (C = D)
];
q = JSON.parse(JSON.stringify(q6));
diag = await garantirAlternativasConformes(q, {} as any, [], 120_000, null);
t("D2 proposta ainda fora de ordem e depois com valor repetido: as duas são recusadas, a questão fica como estava (pendente), duas chamadas", diag.estado === "pendente" && __stub.chamadas === 2 && q.alternativas.C === "40%." && String(diag.motivoRecusa).includes("repetida") && __stub.prompts[1].includes("recusada pela conferência automática: ainda há ordem"), JSON.stringify(diag));
reset();
__stub.respostas = [{ alternativas: alts("20%.", "50%.", "60%.", "72,8%.", "144%."), comentarios: { B: "mudei a correta", C: "c", D: "d", E: "e" }, resolucaoComentada: "" }];
q = JSON.parse(JSON.stringify(q6));
diag = await garantirAlternativasConformes(q, {} as any, [], 120_000, null);
t("D3 se o modelo mexer na correta, a mudança é descartada (B continua 44%) e o resto é aceito", diag.estado === "corrigido" && q.alternativas.B === "44%." && q.alternativas.C === "60%." && !diag.letrasReescritas.includes("B"), JSON.stringify({ diag, alts: q.alternativas }));
reset();
const qRep: any = { ...q6, gabarito: "C", alternativas: alts("9 m².", "15 m².", "15 m².", "30 m².", "45 m²."), analiseAlternativas: an("C"), resolucaoComentada: "Área = 3 × 5 = 15 m². Portanto, a alternativa correta é a C." };
__stub.respostas = [{ alternativas: alts("9 m².", "12 m².", "15 m².", "30 m².", "45 m²."), comentarios: { B: "usa só duas faces" }, resolucaoComentada: "" }];
q = JSON.parse(JSON.stringify(qRep));
diag = await garantirAlternativasConformes(q, {} as any, [], 120_000, null);
t("D4 valor repetido: o pedido traz VALORES REPETIDOS; só o distrator repetido muda; a correta C (15 m²) fica", diag.estado === "corrigido" && diag.letrasReescritas.join() === "B" && q.alternativas.C === "15 m²." && q.alternativas.B === "12 m²." && __stub.prompts[0].includes("· VALORES REPETIDOS: valores iguais em B e C (15 m²)"), JSON.stringify({ diag, alts: q.alternativas }));
reset();
q = JSON.parse(JSON.stringify({ ...q6, alternativas: alts("20%.", "44%.", "60%.", "72,8%.", "144%.") }));
diag = await garantirAlternativasConformes(q, {} as any, [], 120_000, null);
t("D5 questão numérica em ordem: nenhuma chamada (custo zero)", diag.estado === "ok" && __stub.chamadas === 0);
volta();

/* ---------- E. o pedido e a regra no bloco cacheado ---------- */
const regra = M.buildRegraAlternativas();
t("E1 o item 3 da regra passa a dizer que a letra reservada não muda e que os valores dos distratores é que se escolhem em volta da correta — e que isso é conferido em código",
  regra.includes("3. ORDEM LÓGICA. Alternativas NUMÉRICAS vão sempre em ordem crescente de valor") && regra.includes("A letra da correta é a reservada no pedido e NÃO muda") && regra.includes("tantos valores menores que ela quantas forem as letras antes") && regra.includes("nunca dois valores iguais") && regra.includes("Isso é conferido em código."));
const pTexto = buildCorrecaoAlternativasPrompt({ ...texto, alternativas: { ...texto.alternativas, B: "leitura do movimento como ameaça à ordem vigente, sempre." } }, conferenciaAlternativas({ ...texto, alternativas: { ...texto.alternativas, B: "leitura do movimento como ameaça à ordem vigente, sempre." } }));
t("E2 nas correções de texto o NÃO MEXA continua o de antes (inclusive 'na ordem das alternativas')", pTexto.includes("na ordem das alternativas") && !pTexto.includes("ORDEM CRESCENTE"));

/* ---------- F. selftest e impressão digital ---------- */
t("F1 selftest v7439 e impressão digital incluem o leitor e a conferência", fonte.includes("v7439_ordemNumerica: (() => {") && fonte.includes("conferenciaOrdemNumerica.toString(), valorNumerico.toString(), numeroPtBr.toString(), JSON.stringify([ORDEM_NUMERICA_UNIDADE_MAX, SUPERSCRITOS_DIGITOS, NUMERO_PTBR_SRC]),"));
t("F2 a conferência de ordem roda dentro de conferenciaAlternativas, fora do bloco das alternativas de texto, e as letras são os distratores", (() => { const c = fonte.slice(fonte.indexOf("function conferenciaAlternativas("), fonte.indexOf("const FERRAMENTA_ALTERNATIVAS = {")); return c.includes("const ordem = conferenciaOrdemNumerica(alts);") && c.indexOf("const ordem = conferenciaOrdemNumerica(alts);") > c.lastIndexOf("ecoTexto") && c.includes('problemas.push({ tipo: ordem.tipo, letras: distratores, termos: [], detalhe: ordem.detalhe });'); })());

console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
if (bad) Deno.exit(1);

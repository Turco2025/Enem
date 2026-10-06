/* v74.35 — COERÊNCIA ENTRE O TEXTO E OS DADOS DO GRÁFICO/TABELA (generate-question), SEM CHAMAR A ANTHROPIC.

   Defeito relatado pelo professor (06/10/2026): simulado de Biologia, questão 4 — "quatro
   horários" no texto-base com cinco colunas no gráfico; "às 14h o menor volume do dia" na
   resolução com 8h = 300 mL < 14h = 350 mL. Aqui se prova, com o código de produção
   recortado função a função:
     A. a conferência em código (contagem, extremo, valor) acusa a questão 4 real e NÃO
        acusa frases legítimas: negação, comparativo, ordinal, variação, prazo ("em dois
        anos"), grandeza fora do gráfico, linha "Total", marcador no nome da série, relação
        temporal ("após o pico"), objeto que não é a série ("maior reabsorção"), sigla (LH);
     B. a proposta da IA só entra se passar em tudo (sem mexer no visual; sem gabarito
        trocado; sem alternativa vazia; "semAlteracao" só com justificativa);
     C. o fluxo garantirDadosCoerentes: custo zero na questão sã; corrige na 1ª tentativa;
        aceita a justificativa; recusa e tenta de novo; marca "pendente" quando não dá;
        respeita o relógio; a família de ferramentas inclui a nova (mesmo cache);
     D. a ligação com o handler, o selftest e a impressão digital.

   Uso: deno run -A tests/verify_dados_visual_v7435.ts supabase/functions/generate-question/index.ts */
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
export const __stub: any = { respostas: [] as any[], chamadas: [] as any[], agora: 0 };
async function callClaudeForJSON(_s: any, prompt: string, _w: any, usos: any[], ferramenta: any, _b: any, etapa: string, _f: any, _t: any, declaradas: any[] | null) {
  __stub.chamadas.push({ etapa, ferramenta: ferramenta.name, prompt, declaradas: (declaradas || []).map((d: any) => d.name) });
  if (usos) usos.push({ etapa });
  const r = __stub.respostas.shift();
  if (r instanceof Error) throw r;
  return r;
}
function conferenciaAlternativas(d: any) { return { estado: __stub.alternativas || "ok", problemas: [] as any[], letras: [] as string[] }; }
${recorta("normalizaParaComparar")}
${recorta("visualConforme")}
${recorta("conferenciaGabarito")}
${recorta("letraNaResolucao")}
${entre("/* ═══════════ v74.35 — COERÊNCIA ENTRE O TEXTO E OS DADOS", "/* ═══════════ FIM DA COERÊNCIA DOS DADOS ═══════════ */")}
export { conferenciaDadosVisual, dadosDoVisual, listaDadosDoVisual, numeroDeTexto, aplicaCorrecaoDados, buildCorrecaoDadosPrompt, garantirDadosCoerentes, marcaDadosVisual, FERRAMENTA_DADOS, CORRECOES_DADOS_MAX, MS_MINIMO_PARA_CORRIGIR_DADOS, DADOS_SUBSTANTIVOS_CONTAGEM };
`;
const tmp = await Deno.makeTempDir();
await Deno.writeTextFile(`${tmp}/dados.ts`, modulo);
const M: any = await import(`file://${tmp}/dados.ts`);
const { __stub } = M;

let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };
const cala = () => { const o = { w: console.warn, l: console.log }; console.warn = () => {}; console.log = (...a: any[]) => { if (/^(PASS|FAIL)/.test(String(a[0]))) o.l(...a); }; return () => { console.warn = o.w; console.log = o.l; }; };
const tipos = (c: any) => c.problemas.map((p: any) => p.tipo).join();

/* ---------- a questão 4 real (simulado 3a17f9b1, 06/10/2026) ---------- */
const an = (c: string, coments: Record<string, string> = {}) => { const o: any = {}; for (const L of ["A", "B", "C", "D", "E"]) o[L] = { status: L === c ? "correta" : "incorreta", comentario: coments[L] || "c" + L }; return o; };
const visualQ4 = { tipo: "grafico", labels: ["8h", "14h", "17h", "19h", "22h"], titulo: "Ingestão acumulada de água e escurecimento da urina ao longo do dia", datasets: [{ data: [300, 350, 700, 900, 1400], label: "Água ingerida acumulada (mL)" }, { data: [2, 5, 3, 1, 2], label: "Nota de escurecimento da urina (1 a 5)" }], chartType: "bar" };
const q4: any = {
  textoBase: "Um aplicativo de monitoramento de saúde pede que o usuário registre, em horários fixos do dia, a cor da própria urina, comparando-a a uma escala que vai do amarelo bem claro ao âmbar escuro. O app explica que os rins ajustam a quantidade de água eliminada conforme o volume de líquido ingerido: quando o corpo está bem hidratado, a urina sai mais diluída; quando há pouca ingestão de água, os rins reabsorvem mais água e concentram os solutos (ureia, sais) na urina eliminada. Um usuário registrou sua urina em quatro horários do dia, anotando também o volume de água ingerido até aquele momento.",
  comando: "O horário em que a urina desse usuário apresentou maior concentração de solutos corresponde a",
  alternativas: { A: "8h, após o usuário acordar e beber água.", B: "14h, antes do almoço, com baixa ingestão.", C: "17h, logo após o lanche da tarde.", D: "19h, após o usuário beber um copo de água.", E: "22h, após o jantar com sopa e suco." },
  gabarito: "B",
  analiseAlternativas: an("B", { A: "Às 8h a ingestão era a menor do dia, mas a nota de escurecimento era 2.", B: "O gráfico mostra que às 14h a ingestão acumulada de água era a menor do dia e a nota, a mais alta, condizente com maior reabsorção renal de água." }),
  resolucaoComentada: "O gráfico relaciona, para cada horário, o volume de água ingerida (eixo com os dados de hidratação) e a nota de escurecimento da cor da urina (escala de 1, bem clara, a 5, âmbar escuro). Quanto menor a ingestão de água até aquele momento, menor o volume de líquido disponível para os rins eliminarem, e por isso a urina sai mais concentrada em solutos (ureia, sais), apresentando cor mais escura. Os dados mostram que às 14h o usuário havia ingerido o menor volume acumulado de água do dia e a nota de escurecimento da urina foi a mais alta (nota 5), indicando a maior concentração de solutos entre os quatro horários registrados. Nos demais horários, a ingestão recente de água (ao acordar, no lanche, após o copo de água e no jantar com sopa e suco) aumentou o volume urinário e diluiu os solutos, deixando a urina mais clara.",
  visual: visualQ4,
};
const c4 = M.conferenciaDadosVisual(q4);
t("A1 a questão 4 real é acusada: 2 contagens (texto-base e resolução) + 2 extremos (resolução e comentário da correta), nada mais",
  c4.estado === "corrigir" && tipos(c4) === "contagem,contagem,extremo,extremo", JSON.stringify(c4.problemas, null, 1));
t("A2 os detalhes dizem o que o professor precisa ler: \"quatro horarios\" × 5 rótulos; 14h × mínimo em 8h (300 mL)",
  c4.problemas[0].detalhe.includes('"quatro horarios"') && c4.problemas[0].detalhe.includes("5 rótulos (8h, 14h, 17h, 19h, 22h) e 2 séries")
  && c4.problemas[2].detalhe.includes('14h tem o menor valor de "Água ingerida acumulada"') && c4.problemas[2].detalhe.includes("mínimo é em 8h (300 mL); em 14h o valor é 350 mL"));
t("A3 o comentário dos DISTRATORES não é lido (diz coisa errada de propósito) — só o da correta",
  M.conferenciaDadosVisual({ ...q4, textoBase: "Cinco horários.", resolucaoComentada: "r", analiseAlternativas: an("B", { A: "Às 8h a nota foi a mais alta do dia." }) }).estado === "ok"
  && M.conferenciaDadosVisual({ ...q4, textoBase: "Cinco horários.", resolucaoComentada: "r", analiseAlternativas: an("B", { B: "Às 8h a nota foi a mais alta do dia." }) }).estado === "corrigir");
const sa: any = { ...q4, textoBase: q4.textoBase.replace("quatro horários", "cinco horários"), analiseAlternativas: an("B"),
  resolucaoComentada: q4.resolucaoComentada.replace("havia ingerido o menor volume acumulado de água do dia e a nota", "havia ingerido apenas 350 mL de água, pouco mais que os 300 mL das 8h, e a nota").replace("entre os quatro horários registrados", "entre os cinco horários registrados") + " Às 8h o volume era o menor, mas a nota era 2." };
t("A4 a versão corrigida da questão 4 passa (contagem certa, extremo certo, valores certos)", M.conferenciaDadosVisual(sa).estado === "ok", JSON.stringify(M.conferenciaDadosVisual(sa).problemas));
const soResol = (r: string, extra: any = {}) => M.conferenciaDadosVisual({ ...sa, resolucaoComentada: r, ...extra });
t("A5 negação, comparativo, ordinal e variação NÃO acusam",
  soResol("Às 14h o volume de água ingerida não era o menor do dia.").estado === "ok" && soResol("Às 14h o volume de água ingerida era maior que o das 8h.").estado === "ok"
  && soResol("Às 14h o volume de água ingerida era o segundo menor do dia.").estado === "ok" && soResol("Entre 14h e 17h houve o maior aumento do volume de água ingerida; às 17h o maior aumento.").estado === "ok");
t("A6 prazo (\"em dois anos\") não é contagem; com determinante (\"nos quatro anos\") é; \"cinco pontos percentuais\" e \"marcou cinco pontos\" não são",
  M.conferenciaDadosVisual({ ...sa, textoBase: "Em dois anos a cidade dobrou de tamanho.", resolucaoComentada: "" }).estado === "ok"
  && M.conferenciaDadosVisual({ ...sa, textoBase: "Nos quatro anos analisados a cidade cresceu.", resolucaoComentada: "" }).estado === "corrigir"
  && M.conferenciaDadosVisual({ ...sa, textoBase: "A taxa subiu cinco pontos percentuais; o time marcou quatro pontos.", resolucaoComentada: "" }).estado === "ok");
t("A7 grandeza fora do gráfico (\"concentração de solutos\") e objeto que não é a série (\"maior reabsorção renal de água\") NÃO acusam; \"volume\" aponta a série em mL",
  soResol("Às 17h a concentração de solutos foi a maior.").estado === "ok" && soResol("Às 14h a nota 5 é condizente com maior reabsorção renal de água.").estado === "ok"
  && soResol("Às 22h o volume foi o maior e a nota era 2.").estado === "ok" && tipos(soResol("Às 19h o volume foi o maior e a nota era 1.")) === "extremo");
t("A8 \"a menor do dia\" (escopo depois do marcador) continua afirmação sobre a série",
  tipos(soResol("O gráfico mostra que às 14h a ingestão acumulada de água era a menor do dia.")) === "extremo");
t("A9 valor citado: certo passa (\"1.400 mL\", \"350 mL\"); errado acusa (\"400 mL\"); variação (\"aumentou 350 mL\") e faixa (\"de 300 mL para 350 mL\") não contam",
  soResol("Às 22h o volume acumulado chegou a 1.400 mL; às 14h eram 350 mL.").estado === "ok" && tipos(soResol("Às 14h o volume acumulado era de 400 mL.")) === "valor"
  && soResol("Às 17h o volume aumentou 350 mL em relação ao registro anterior.").estado === "ok" && soResol("De 8h a 14h o volume subiu de 300 mL para 350 mL, 50 mL a mais.").estado === "ok");
const clima = { tipo: "grafico", chartType: "line", titulo: "Clima", labels: ["8h", "14h", "17h", "19h", "22h"], datasets: [{ label: "Temperatura máxima (°C)", data: [20, 25, 30, 28, 22] }, { label: "Temperatura mínima (°C)", data: [10, 12, 15, 14, 11] }] };
t("A10 marcador que faz parte do nome da série (\"Temperatura máxima\") é ignorado", soResol("A temperatura máxima às 8h foi registrada.", { visual: clima }).estado === "ok");
const tab = { tipo: "tabela", titulo: "Produção", colunas: ["Região", "Produção de soja (t)"], linhas: [["Norte", "10"], ["Nordeste", "20"], ["Sudeste", "50"], ["Sul", "40"], ["Centro-Oeste", "45"], ["Total", "165"]] };
t("A11 tabela: linha \"Total\" não é extremo nem conta como categoria; extremo errado acusa",
  M.conferenciaDadosVisual({ ...sa, textoBase: "Cinco regiões foram comparadas.", resolucaoComentada: "A Região Sudeste tem a maior produção de soja.", visual: tab }).estado === "ok"
  && tipos(M.conferenciaDadosVisual({ ...sa, textoBase: "Cinco regiões foram comparadas.", resolucaoComentada: "A Região Sul tem a maior produção de soja.", visual: tab })) === "extremo");
const pizza = { tipo: "grafico", chartType: "pie", titulo: "Matriz", labels: ["Hidráulica", "Eólica", "Solar", "Térmica"], datasets: [{ label: "Participação (%)", data: [55, 12, 5, 28] }] };
t("A12 pizza: extremo certo e valor certo passam; valor errado (\"15%\") acusa",
  M.conferenciaDadosVisual({ ...sa, textoBase: "Quatro fontes de energia.", resolucaoComentada: "A hidráulica tem a maior participação. A fonte eólica responde por 12% da matriz.", visual: pizza }).estado === "ok"
  && tipos(M.conferenciaDadosVisual({ ...sa, textoBase: "Quatro fontes de energia.", resolucaoComentada: "A fonte eólica responde por 15% da matriz.", visual: pizza })) === "valor");
const desemprego = { tipo: "grafico", chartType: "line", titulo: "Desemprego", labels: ["2013", "2014", "2015", "2016", "2017"], datasets: [{ label: "Taxa de desemprego (%)", data: [7, 8, 9, 12, 13] }] };
t("A13 anos como rótulos: \"em 2015 ... atingiu o pico\" acusa; \"cresceu até 2017, quando atingiu o maior valor\" passa (rótulo e série herdados da frase)",
  tipos(M.conferenciaDadosVisual({ ...sa, textoBase: "Nos cinco anos.", resolucaoComentada: "Em 2015 a taxa de desemprego atingiu o pico.", visual: desemprego })) === "extremo"
  && M.conferenciaDadosVisual({ ...sa, textoBase: "Nos cinco anos.", resolucaoComentada: "A taxa de desemprego cresceu até 2017, quando atingiu o maior valor.", visual: desemprego }).estado === "ok");
const ciclo = { tipo: "grafico", chartType: "line", titulo: "Ciclo", labels: ["dia 1", "dia 7", "dia 14", "dia 20", "dia 28"], datasets: [{ label: "LH (mUI/mL)", data: [5, 8, 55, 5, 4] }, { label: "Progesterona (ng/mL)", data: [1, 1, 1.5, 14, 2] }] };
t("A14 sigla como série (LH): \"pico de LH do dia 14\" passa; \"do dia 20\" acusa; \"após o pico de LH\" (relação temporal) não é afirmação",
  M.conferenciaDadosVisual({ ...sa, textoBase: "Nos cinco dias.", resolucaoComentada: "O estrogênio é o responsável pelo pico de LH do dia 14.", visual: ciclo }).estado === "ok"
  && tipos(M.conferenciaDadosVisual({ ...sa, textoBase: "Nos cinco dias.", resolucaoComentada: "O estrogênio é o responsável pelo pico de LH do dia 20.", visual: ciclo })) === "extremo"
  && M.conferenciaDadosVisual({ ...sa, textoBase: "Nos cinco dias.", resolucaoComentada: "A ovulação ocorre por volta do dia 20, evento que só ocorre após o pico de LH.", visual: ciclo }).estado === "ok");
t("A15 rótulo só numérico seguido de unidade não é rótulo (\"10 mL\" × rótulo \"10\")",
  M.conferenciaDadosVisual({ ...sa, textoBase: "Cinco concentrações.", resolucaoComentada: "Com 10 mL de reagente, a massa obtida na concentração 20 foi a maior.", visual: { tipo: "grafico", chartType: "bar", titulo: "Massa", labels: ["5", "10", "20", "40", "80"], datasets: [{ label: "Massa obtida (g)", data: [1, 2, 9, 4, 3] }] } }).estado === "ok");
t("A16 sem visual utilizável → \"indefinido\" (imagem, null, gráfico de um rótulo, tabela de uma linha)",
  M.conferenciaDadosVisual({ ...sa, visual: null }).estado === "indefinido" && M.conferenciaDadosVisual({ ...sa, visual: { tipo: "imagem", promptImagem: "x" } }).estado === "indefinido"
  && M.conferenciaDadosVisual({ ...sa, visual: { tipo: "grafico", labels: ["a"], datasets: [{ label: "x", data: [1] }] } }).estado === "indefinido"
  && M.conferenciaDadosVisual({ ...sa, visual: { tipo: "tabela", colunas: ["a", "b"], linhas: [["x", "1"]] } }).estado === "indefinido");
t("A17 números em português: \"1.400\" = 1400, \"1 400\" = 1400, \"12,5\" = 12.5, \"350 mL\" = 350, \"3.5\" = 3.5",
  M.numeroDeTexto("1.400") === 1400 && M.numeroDeTexto("1 400") === 1400 && M.numeroDeTexto("12,5") === 12.5 && M.numeroDeTexto("350 mL") === 350 && M.numeroDeTexto("3.5") === 3.5 && M.numeroDeTexto("") === null);
t("A18 \"dose\", \"concentração\", \"temperatura\" não são substantivos de contagem (\"duas doses da vacina\" não é número de colunas)",
  !M.DADOS_SUBSTANTIVOS_CONTAGEM.includes("dose") && !M.DADOS_SUBSTANTIVOS_CONTAGEM.includes("concentracao") && !M.DADOS_SUBSTANTIVOS_CONTAGEM.includes("temperatura")
  && M.conferenciaDadosVisual({ ...sa, textoBase: "O esquema vacinal tem duas doses.", resolucaoComentada: "" }).estado === "ok");
t("A19 a lista dos dados para a IA tem rótulos, séries e valores por extenso",
  M.listaDadosDoVisual(visualQ4).includes("Rótulos (5): 8h, 14h, 17h, 19h, 22h") && M.listaDadosDoVisual(visualQ4).includes('Série "Água ingerida acumulada (mL)": 8h = 300; 14h = 350; 17h = 700; 19h = 900; 22h = 1400')
  && M.listaDadosDoVisual(tab).includes("Colunas (2): Região | Produção de soja (t)") && M.listaDadosDoVisual(tab).includes("  Total | 165"));

/* ---------- B. a proposta da IA, sem confiar nela ---------- */
const COMENT_B = "Às 14h a nota de escurecimento foi a mais alta (5), com volume ainda baixo (350 mL).";
const bruto = (extra: any = {}) => ({ semAlteracao: false, justificativa: "ajustei a contagem e o raciocínio da resolução", textoBase: sa.textoBase, comando: q4.comando, alternativas: q4.alternativas, comentarios: { B: COMENT_B }, resolucaoComentada: sa.resolucaoComentada, ...extra });
const p1 = M.aplicaCorrecaoDados(q4, bruto());
t("B1 proposta válida: muda texto-base, resolução e comentário da correta; mantém o visual (mesmo objeto), alternativas, status e gabarito",
  p1.ok && p1.campos.join() === "textoBase,resolucaoComentada,comentários B" && p1.nova.visual === q4.visual && p1.nova.alternativas === q4.alternativas && p1.nova.analiseAlternativas.B.status === "correta"
  && p1.nova.analiseAlternativas.A.comentario === q4.analiseAlternativas.A.comentario && p1.nova.gabarito === "B" && M.conferenciaDadosVisual(p1.nova).estado === "ok");
t("B2 recusas: resposta vazia; campo vazio; alternativa vazia; alternativa que muda de tamanho demais; alternativa reescrita sem comentário; nada mudado sem justificativa",
  !M.aplicaCorrecaoDados(q4, null).ok && !M.aplicaCorrecaoDados(q4, bruto({ textoBase: "" })).ok && !M.aplicaCorrecaoDados(q4, bruto({ alternativas: { ...q4.alternativas, C: "" } })).ok
  && !M.aplicaCorrecaoDados(q4, bruto({ alternativas: { ...q4.alternativas, C: "x".repeat(200) } })).ok
  && !M.aplicaCorrecaoDados(q4, bruto({ alternativas: { ...q4.alternativas, C: "17h, após o lanche da tarde, com suco." } })).ok
  && M.aplicaCorrecaoDados(q4, bruto({ alternativas: { ...q4.alternativas, C: "17h, após o lanche da tarde, com suco." }, comentarios: { C: "novo comentário" } })).ok
  && !M.aplicaCorrecaoDados(q4, bruto({ textoBase: q4.textoBase, resolucaoComentada: q4.resolucaoComentada, comentarios: {} })).ok);
t("B3 texto-base que encolhe à metade ou dobra é recusado (0,5× a 1,6×)",
  !M.aplicaCorrecaoDados(q4, bruto({ textoBase: "Curto demais." })).ok && !M.aplicaCorrecaoDados(q4, bruto({ textoBase: q4.textoBase + " " + q4.textoBase })).ok);
t("B4 \"semAlteracao\": só com justificativa de verdade (≥ 20 caracteres); a questão volta intacta",
  !M.aplicaCorrecaoDados(q4, { semAlteracao: true, justificativa: "ok" }).ok
  && M.aplicaCorrecaoDados(q4, { semAlteracao: true, justificativa: "a frase fala da concentração de solutos, grandeza que o gráfico não traz" }).semAlteracao
  && M.aplicaCorrecaoDados(q4, { semAlteracao: true, justificativa: "a frase fala da concentração de solutos, grandeza que o gráfico não traz" }).nova === q4);
t("B5 proposta que deixa o comentário da correta com o erro é aceita pela montagem, mas a conferência ainda acusa (é o fluxo quem recusa)",
  (() => { const p = M.aplicaCorrecaoDados(q4, bruto({ comentarios: {} })); return p.ok && p.campos.join() === "textoBase,resolucaoComentada" && M.conferenciaDadosVisual(p.nova).estado === "corrigir"; })());
t("B6 o prompt da correção traz os problemas, os dados por extenso, a letra correta e a regra de não mexer no visual",
  (() => { const p = M.buildCorrecaoDadosPrompt(q4, c4, 2, "ainda há contagem"); return p.includes("TENTATIVA 2") && p.includes("recusada pela conferência automática: ainda há contagem") && p.includes("· CONTAGEM:") && p.includes("· EXTREMO:")
    && p.includes("DADOS DO GRÁFICO (NÃO ALTERE") && p.includes("8h = 300; 14h = 350") && p.includes("continua B") && p.includes("B) 14h, antes do almoço, com baixa ingestão.   ← CORRETA") && p.includes('"semAlteracao": true'); })());
t("B7 a ferramenta: nome, 7 campos obrigatórios, alternativas A–E obrigatórias, formato const ... = { ... };",
  M.FERRAMENTA_DADOS.name === "entregar_coerencia_dados" && M.FERRAMENTA_DADOS.input_schema.required.join() === "semAlteracao,justificativa,textoBase,comando,alternativas,comentarios,resolucaoComentada"
  && M.FERRAMENTA_DADOS.input_schema.properties.alternativas.required.join() === "A,B,C,D,E" && fonte.includes("\nconst FERRAMENTA_DADOS = {") && fonte.includes("\n};\n\nfunction buildCorrecaoDadosPrompt("));

/* ---------- C. o fluxo ---------- */
const sys = "sistema", fam = [{ name: "entregar_questao" }, { name: "entregar_alternativas" }, { name: "entregar_gabarito" }, { name: "entregar_item_em_portugues" }, M.FERRAMENTA_DADOS];
const fresca = () => JSON.parse(JSON.stringify(q4));
const zera = () => { __stub.respostas = []; __stub.chamadas = []; __stub.alternativas = "ok"; };
const volta = cala();
zera();
const dSa = fresca(); Object.assign(dSa, { textoBase: sa.textoBase, resolucaoComentada: sa.resolucaoComentada, analiseAlternativas: an("B") });
const usos0: any[] = [];
const g0 = await M.garantirDadosCoerentes(dSa, sys, usos0, 120_000, fam, "grafico");
t("C1 questão sã: estado \"ok\", nenhuma chamada, nenhuma marca na questão (custo zero)", g0.aplicavel && g0.estado === "ok" && g0.chamadas === 0 && usos0.length === 0 && !("dadosVisual" in dSa));
const gImg = await M.garantirDadosCoerentes(fresca(), sys, [], 120_000, fam, "imagem");
const gNen = await M.garantirDadosCoerentes(fresca(), sys, [], 120_000, fam, "nenhum");
t("C2 só gráfico e tabela: com recurso imagem/nenhum é \"nao_aplicavel\", sem chamada", !gImg.aplicavel && gImg.estado === "nao_aplicavel" && gNen.estado === "nao_aplicavel" && __stub.chamadas.length === 0);
zera();
__stub.respostas = [bruto()];
const d1 = fresca(); const usos1: any[] = [];
const g1 = await M.garantirDadosCoerentes(d1, sys, usos1, 120_000, fam, "grafico");
t("C3 questão 4: corrigida na 1ª tentativa — texto-base, resolução e comentário B trocados; visual, alternativas e gabarito intactos; marca \"dadosVisual\" na questão",
  g1.estado === "corrigido" && g1.corrigido && g1.chamadas === 1 && g1.tentativas === 1 && g1.campos.join() === "textoBase,resolucaoComentada,comentários B"
  && d1.textoBase === sa.textoBase && d1.resolucaoComentada === sa.resolucaoComentada && d1.analiseAlternativas.B.comentario.startsWith("Às 14h a nota") && d1.analiseAlternativas.A.status === "incorreta"
  && JSON.stringify(d1.visual) === JSON.stringify(visualQ4) && JSON.stringify(d1.alternativas) === JSON.stringify(q4.alternativas) && d1.gabarito === "B"
  && d1.dadosVisual.estado === "corrigido" && d1.dadosVisual.problemas.length === 4 && d1.dadosVisual.campos.length === 3 && M.conferenciaDadosVisual(d1).estado === "ok");
t("C4 a chamada declara a FAMÍLIA (mesmo cache da geração), com tool_choice na ferramenta de dados, etapa \"dados-1\"",
  __stub.chamadas[0].etapa === "dados-1" && __stub.chamadas[0].ferramenta === "entregar_coerencia_dados" && __stub.chamadas[0].declaradas.join() === "entregar_questao,entregar_alternativas,entregar_gabarito,entregar_item_em_portugues,entregar_coerencia_dados" && usos1.length === 1);
zera();
__stub.respostas = [{ semAlteracao: true, justificativa: "as frases apontadas falam da concentração de solutos, grandeza que o gráfico não traz" }];
const d2 = fresca();
const g2 = await M.garantirDadosCoerentes(d2, sys, [], 120_000, fam, "grafico");
t("C5 justificativa aceita: estado \"justificado\", texto intacto, justificativa registrada na questão (o app mostra)",
  g2.estado === "justificado" && g2.chamadas === 1 && d2.textoBase === q4.textoBase && d2.dadosVisual.estado === "justificado" && d2.dadosVisual.justificativa.includes("concentração de solutos"));
zera();
__stub.respostas = [bruto({ textoBase: q4.textoBase }), bruto()];   // 1ª ainda com "quatro horários"; 2ª certa
const d3 = fresca();
const g3 = await M.garantirDadosCoerentes(d3, sys, [], 120_000, fam, "grafico");
t("C6 proposta que ainda falha é recusada e a 2ª tentativa recebe a recusa; corrige na 2ª",
  g3.estado === "corrigido" && g3.chamadas === 2 && g3.tentativas === 2 && __stub.chamadas[1].prompt.includes("TENTATIVA 2") && __stub.chamadas[1].prompt.includes("ainda há contagem"));
zera();
__stub.respostas = [bruto({ resolucaoComentada: sa.resolucaoComentada + " Portanto, a alternativa correta é a A." }), bruto({ resolucaoComentada: sa.resolucaoComentada + " Portanto, a alternativa correta é a A." })];
const d4 = fresca();
const g4 = await M.garantirDadosCoerentes(d4, sys, [], 120_000, fam, "grafico");
t("C7 resolução que passa a concluir por OUTRA letra é recusada; esgotadas as 2 tentativas → \"pendente\", texto original intacto, marca na questão",
  g4.estado === "pendente" && g4.chamadas === 2 && String(g4.motivoRecusa).includes("deixou de ser coerente") && d4.textoBase === q4.textoBase && d4.resolucaoComentada === q4.resolucaoComentada
  && d4.dadosVisual.estado === "pendente" && d4.dadosVisual.motivo.includes("deixou de ser coerente"));
zera();
__stub.alternativas = "corrigir";
__stub.respostas = [bruto()];
const d5 = fresca();
const g5 = await M.garantirDadosCoerentes(d5, sys, [], 120_000, fam, "grafico");
t("C8 se as alternativas JÁ estavam fora da regra antes, isso não barra a correção dos dados (não é regressão)", g5.estado === "corrigido");
zera();
const d6 = fresca();
const g6 = await M.garantirDadosCoerentes(d6, sys, [], 30_000, fam, "grafico");
t("C9 sem tempo (< 40 s) não chama a IA: \"pendente\" com o motivo, marca na questão", g6.estado === "pendente" && g6.chamadas === 0 && String(g6.pulado).includes("sem tempo") && d6.dadosVisual.motivo.includes("sem tempo"));
zera();
__stub.respostas = [new Error("rede caiu")];
const d7 = fresca();
const g7 = await M.garantirDadosCoerentes(d7, sys, [], 120_000, fam, "grafico");
t("C10 erro na chamada nunca derruba a questão: \"pendente\" com o erro registrado", g7.estado === "pendente" && g7.erro === "rede caiu" && d7.textoBase === q4.textoBase);
zera();
__stub.respostas = [bruto({ visual: { tipo: "grafico", labels: ["x"], datasets: [] } })];
const d8 = fresca();
await M.garantirDadosCoerentes(d8, sys, [], 120_000, fam, "grafico");
t("C11 \"visual\" devolvido pela IA é ignorado — os dados são a referência e nunca mudam", JSON.stringify(d8.visual) === JSON.stringify(visualQ4));
volta();
t("C12 constantes: até 2 tentativas, 40 s de folga mínima", M.CORRECOES_DADOS_MAX === 2 && M.MS_MINIMO_PARA_CORRIGIR_DADOS === 40_000);

/* ---------- D. ligação ---------- */
t("D1 a família de ferramentas ganhou a quinta (a correção lê o cache da geração)",
  fonte.includes("return [ferramentaQuestao, FERRAMENTA_ALTERNATIVAS, FERRAMENTA_GABARITO, FERRAMENTA_IDIOMA, FERRAMENTA_DADOS];"));
t("D2 o handler roda a conferência depois das alternativas e antes do objeto/auditoria, e de novo em cada reelaboração",
  fonte.includes("const dadosDiag: any = await garantirDadosCoerentes(\n      data, system, usos, LIMITE_FUNCAO_MS - (Date.now() - inicioReq), familiaQ, recurso,\n    );")
  && fonte.indexOf("const dadosDiag: any = await garantirDadosCoerentes(") > fonte.indexOf("const alternativasDiag: any = await garantirAlternativasConformes(")
  && fonte.indexOf("const dadosDiag: any = await garantirDadosCoerentes(") < fonte.indexOf("const objetoDiag = garantirObjetoDaDisciplina(data, area, disciplina);")
  && fonte.includes("const dd2 = await garantirDadosCoerentes(nova, system, usos, LIMITE_FUNCAO_MS - (Date.now() - inicioReq), familiaQ, recurso);") && fonte.includes("dadosDiag.aposReelaboracao = dd2;"));
t("D3 a resposta ao app carrega dadosDiag; a questão carrega dadosVisual (vai junto com o simulado arquivado)",
  fonte.includes("gabaritoDiag, distratoresDiag, alternativasDiag, dadosDiag, fontesDiag, objetoDiag: objetoDiagFinal })") && fonte.includes("data.dadosVisual = { estado: diag.estado, problemas: diag.problemas || []"));
t("D4 selftest v7435 e impressão digital (código) incluem o bloco",
  fonte.includes("v7435_coerenciaDados: (() => {") && fonte.includes("conferenciaDadosVisual.toString(), dadosDoVisual.toString(), problemasDeContagem.toString(), problemasDeExtremo.toString(), problemasDeValor.toString(),")
  && fonte.includes("buildCorrecaoDadosPrompt.toString(), aplicaCorrecaoDados.toString(), garantirDadosCoerentes.toString(), marcaDadosVisual.toString(), JSON.stringify(FERRAMENTA_DADOS),"));
t("D5 o selftest v7429 passou a esperar a família com cinco ferramentas",
  fonte.includes('=== "entregar_questao,entregar_alternativas,entregar_gabarito,entregar_item_em_portugues,entregar_coerencia_dados"'));

console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
if (bad) Deno.exit(1);

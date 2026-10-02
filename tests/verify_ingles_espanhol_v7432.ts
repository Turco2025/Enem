/* v74.32 — INGLÊS E ESPANHOL SEPARADOS (generate-question), SEM CHAMAR A ANTHROPIC.

   Pedido do professor (02/10/2026): no app, "Inglês" e "Espanhol" no lugar de "Língua
   Estrangeira (Inglês/Espanhol)". Este arquivo prova, com o código recortado do arquivo
   de produção:
     A. o idioma do texto-base é o da disciplina (regra do elaborador, pesquisador sem
        internet, pesquisador na internet), e a chave antiga continua como era;
     B. a conferência em código do idioma do texto-base acerta nos textos de exemplo
        (inglês, espanhol, português, mistos e curtos) e não acusa a chave antiga;
     C. objetos de conhecimento, calibração, biblioteca e ordem biblioteca → IA → internet
        valem para as duas disciplinas novas.
   Os textos abaixo foram escritos para o teste (nenhum vem da biblioteca do professor).

   Uso: deno run -A tests/verify_ingles_espanhol_v7432.ts supabase/functions/generate-question/index.ts
        deno run -A tests/verify_ingles_espanhol_v7432.ts supabase/functions/generate-question/index.ts <arquivo.json com textos em inglês>
        (o 2º argumento, opcional, confere que nenhum texto em inglês é acusado em "Inglês") */
const alvo = Deno.args[0] || "supabase/functions/generate-question/index.ts";
const fonte = await Deno.readTextFile(alvo);
function recorta(nome: string, prefixo = "function "): string {
  const ini = fonte.indexOf(`\n${prefixo}${nome}(`);
  if (ini < 0) { console.error(`FALHA: não achei ${prefixo}${nome}`); Deno.exit(1); }
  const fim = fonte.indexOf("\n}\n", ini);
  return fonte.slice(ini, fim + 3);
}
function entre(a: string, b: string): string {
  const i = fonte.indexOf(a), j = fonte.indexOf(b, i);
  if (i < 0 || j < 0) { console.error(`FALHA: não achei o trecho ${a.slice(0, 40)}`); Deno.exit(1); }
  return fonte.slice(i, j);
}
const modulo = `
const MAX_FONTES_EVITAR = 12;
function buildAcervosPrioritarios() { return ""; }
${entre("const OBJETOS_POR_DISCIPLINA", "\n/* Objetos que a questão PODE declarar.")}
${entre("const CALIBRACAO_EXTENSAO", "\nfunction findCalibracaoKey(")}
${entre("const DISCIPLINAS_FONTES_REAIS_OBRIGATORIAS", "\n/* v74.8")}
${entre("function ehLinguaEstrangeira(", "\n/* v18.6 / v74.5")}
${entre("const MARCAS_IDIOMA", "\nconst ENEM_REAL_IDIOMA")}
${recorta("idiomaErradoDoTextoBase")}
${entre("const TEXTOS_ENEM_MINIMO_PONTOS", "const TEXTOS_ENEM_LITERARIOS")}
${entre("const DISCIPLINAS_ORDEM_IA", "\n/* Rodízio:")}
${recorta("buildPesquisaIAPrompt")}
${recorta("buildPesquisaFontePrompt")}
export { OBJETOS_POR_DISCIPLINA, CALIBRACAO_EXTENSAO, precisaFontesReais, ehLinguaEstrangeira, idiomaDaDisciplina, buildRegraIdiomaLinguaEstrangeira,
         idiomaErradoDoTextoBase, DISCIPLINAS_TEXTOS_ENEM, usaOrdemIA, buildPesquisaIAPrompt, buildPesquisaFontePrompt };
`;
const tmp = await Deno.makeTempDir();
await Deno.writeTextFile(`${tmp}/le.ts`, modulo);
const M: any = await import(`file://${tmp}/le.ts`);

let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };
const ANTIGA = "Língua Estrangeira (Inglês/Espanhol)";

/* ---------- A. o idioma é o da disciplina ---------- */
t("A1 idiomaDaDisciplina: Inglês → ingles, Espanhol → espanhol; a chave antiga e as demais não têm idioma fixo",
  M.idiomaDaDisciplina("Inglês") === "ingles" && M.idiomaDaDisciplina("Espanhol") === "espanhol" && M.idiomaDaDisciplina(ANTIGA) === ""
  && M.idiomaDaDisciplina("Língua Portuguesa") === "" && M.idiomaDaDisciplina("") === "");
const rIng = M.buildRegraIdiomaLinguaEstrangeira("Inglês"), rEsp = M.buildRegraIdiomaLinguaEstrangeira("Espanhol"), rAnt = M.buildRegraIdiomaLinguaEstrangeira(ANTIGA);
t("A2 elaborador, Inglês: texto-base SEMPRE em inglês; espanhol ou português não servem; comando e alternativas em português",
  rIng.includes("TEXTO-BASE: SEMPRE em INGLÊS") && rIng.includes("Texto-base em espanhol ou em português não serve") && rIng.includes("SEMPRE em PORTUGUÊS do Brasil") && !rIng.includes("em inglês ou em espanhol"));
t("A3 elaborador, Espanhol: texto-base SEMPRE em espanhol",
  rEsp.includes("TEXTO-BASE: SEMPRE em ESPANHOL") && rEsp.includes("Texto-base em inglês ou em português não serve") && rEsp.includes("SEMPRE em PORTUGUÊS do Brasil"));
t("A4 a chave antiga recebe exatamente a regra de antes (inglês ou espanhol)",
  rAnt.includes("IDIOMA DO ITEM — LÍNGUA ESTRANGEIRA (é assim em todas as provas do ENEM de 2022 a 2025") && rAnt.includes("TEXTO-BASE: em inglês ou em espanhol"));
t("A5 nas demais disciplinas não entra regra de idioma", M.buildRegraIdiomaLinguaEstrangeira("Artes") === "" && M.buildRegraIdiomaLinguaEstrangeira("História") === "");
t("A6 pesquisador sem internet recebe o idioma fixo (e só nas duas disciplinas)",
  M.buildPesquisaIAPrompt({ disciplina: "Espanhol", tema: "Migração" }, []).includes('Idioma do texto-base: espanhol (a disciplina define o idioma; em "idioma" responda "espanhol")')
  && M.buildPesquisaIAPrompt({ disciplina: "Inglês", tema: "x" }, []).includes("Idioma do texto-base: inglês")
  && !M.buildPesquisaIAPrompt({ disciplina: ANTIGA, tema: "x" }, []).includes("Idioma do texto-base") && !M.buildPesquisaIAPrompt({ disciplina: "Sociologia", tema: "x" }, []).includes("Idioma do texto-base"));
t("A7 pesquisador na internet: fonte publicada originalmente no idioma da disciplina",
  M.buildPesquisaFontePrompt({ area: "linguagens", disciplina: "Espanhol", tema: "x" }).includes("publicado originalmente em ESPANHOL")
  && M.buildPesquisaFontePrompt({ area: "linguagens", disciplina: "Inglês", tema: "x" }).includes("publicado originalmente em INGLÊS")
  && !M.buildPesquisaFontePrompt({ area: "linguagens", disciplina: ANTIGA, tema: "x" }).includes("IDIOMA (v74.32)"));
t("A8 o idioma devolvido pelo pesquisador sem internet é trocado pelo da disciplina (em código)",
  fonte.includes("const fixo = idiomaDaDisciplina(o.disciplina);   // v74.32 — o idioma é o da disciplina, não o que o modelo escolher\n    if (fixo) ia.idioma = fixo;"));

/* ---------- B. conferência do idioma do texto-base ---------- */
const EN = [
  "City councils across the country are testing four-day school weeks. Supporters say the change helps teachers rest, while critics worry that working parents will struggle to find care on the extra day off.",
  "Wanted: volunteers for the community garden! No experience needed. Bring gloves and a friend. Saturdays, 9 a.m., behind the public library.",
  "When my grandmother arrived in this country, she spoke no English at all. She learned it from the radio, one song at a time, and she never stopped humming while she cooked.",
];
const ES = [
  "Los ayuntamientos del país prueban una semana escolar de cuatro días. Quienes la defienden dicen que el cambio ayuda a los docentes a descansar, pero los críticos temen que las familias no encuentren con quién dejar a los niños.",
  "Se buscan voluntarios para el huerto comunitario. No hace falta experiencia: trae guantes y un amigo. Los sábados, a las nueve, detrás de la biblioteca.",
  "Cuando mi abuela llegó a este país, no hablaba una sola palabra del idioma. Lo aprendió con la radio, canción por canción, y nunca dejó de tararear mientras cocinaba en la casa de sus hijos.",
];
const PT = "Quando a escola anunciou a mudança no calendário, os pais se reuniram para discutir o assunto. Muitos deles disseram que não teriam com quem deixar os filhos, e a direção prometeu estudar uma solução com a prefeitura. Para os professores, a medida pode ser boa, pois o descanso é necessário.";
const REF_PT = "\n\nDisponível em: www.exemplo.org. Acesso em: 10 maio 2025 (adaptado).";
t("B1 inglês em Inglês e espanhol em Espanhol: nada a acusar (também com a referência em português)",
  EN.every((x) => M.idiomaErradoDoTextoBase({ textoBase: x + REF_PT }, "Inglês") === "") && ES.every((x) => M.idiomaErradoDoTextoBase({ textoBase: x + REF_PT }, "Espanhol") === ""),
  JSON.stringify([...EN.map((x) => M.idiomaErradoDoTextoBase({ textoBase: x + REF_PT }, "Inglês")), ...ES.map((x) => M.idiomaErradoDoTextoBase({ textoBase: x + REF_PT }, "Espanhol"))]));
t("B2 espanhol em Inglês é acusado como espanhol; inglês em Espanhol, como inglês",
  ES.every((x) => M.idiomaErradoDoTextoBase({ textoBase: x }, "Inglês") === "espanhol") && EN.slice(0, 1).concat(EN.slice(2)).every((x) => M.idiomaErradoDoTextoBase({ textoBase: x }, "Espanhol") === "inglês"));
const mistoEn = EN[0] + " One parent wrote: \"No sé qué vamos a hacer con los niños los viernes.\"";
t("B3 texto em inglês com uma frase citada em espanhol continua inglês (Inglês ok; Espanhol acusa inglês)",
  M.idiomaErradoDoTextoBase({ textoBase: mistoEn }, "Inglês") === "" && M.idiomaErradoDoTextoBase({ textoBase: mistoEn }, "Espanhol") === "inglês");
t("B4 texto-base em português é acusado nas duas disciplinas", M.idiomaErradoDoTextoBase({ textoBase: PT }, "Inglês") === "português" && M.idiomaErradoDoTextoBase({ textoBase: PT }, "Espanhol") === "português");
t("B5 texto curto demais para dizer não é acusado", M.idiomaErradoDoTextoBase({ textoBase: "Sale!" }, "Espanhol") === "" && M.idiomaErradoDoTextoBase({ textoBase: "¡Oferta!" }, "Inglês") === "");
t("B6 a chave antiga e as demais disciplinas não são conferidas",
  M.idiomaErradoDoTextoBase({ textoBase: ES[0] }, ANTIGA) === "" && M.idiomaErradoDoTextoBase({ textoBase: PT }, "História") === "" && M.idiomaErradoDoTextoBase({}, "Inglês") === "");
t("B7 a conferência está ligada no auditor de fontes, antes de tudo, com reelaboração pelo motivo",
  fonte.includes('const idiomaTB = idiomaErradoDoTextoBase(data, discIdioma);') && fonte.includes('diag.determinista = "idioma_do_texto_base";')
  && fonte.indexOf("const idiomaTB = idiomaErradoDoTextoBase(") < fonte.indexOf("/* v74.31 — MODOS DA IA (sem internet). Não há busca"));
const meioMeio = "A support page for families who have just arrived explains the main rights of refugees. One of its sections states: \"Los refugiados tienen los mismos derechos que los residentes legales, incluso el acceso al empleo y a los servicios de la salud y la educación.\"";
t("B3b texto meio inglês, meio espanhol não serve para nenhuma das duas", M.idiomaErradoDoTextoBase({ textoBase: meioMeio }, "Espanhol") === "inglês" && M.idiomaErradoDoTextoBase({ textoBase: meioMeio }, "Inglês") === "espanhol",
  JSON.stringify([M.idiomaErradoDoTextoBase({ textoBase: meioMeio }, "Espanhol"), M.idiomaErradoDoTextoBase({ textoBase: meioMeio }, "Inglês")]));
const extra = Deno.args[1];
if (extra) {
  const textos: string[] = JSON.parse(await Deno.readTextFile(extra)).map((r: any) => Array.isArray(r) ? String(r[1] || "") : String(r || ""));
  const acusadosIng = textos.filter((x) => M.idiomaErradoDoTextoBase({ textoBase: x }, "Inglês") !== "");
  const acusadosEsp = textos.filter((x) => M.idiomaErradoDoTextoBase({ textoBase: x }, "Espanhol") === "inglês");
  t(`B8 ${textos.length} textos em inglês do arquivo extra: nenhum acusado em Inglês`, acusadosIng.length === 0, acusadosIng.map((x) => x.slice(0, 80)).join(" | "));
  console.log(`     (em Espanhol, ${acusadosEsp.length} de ${textos.length} seriam acusados como inglês)`);
}

/* ---------- C. as demais peças ---------- */
const objAnt = JSON.stringify(M.OBJETOS_POR_DISCIPLINA[ANTIGA]);
t("C1 objetos de conhecimento: os mesmos da Língua Estrangeira para Inglês e Espanhol",
  JSON.stringify(M.OBJETOS_POR_DISCIPLINA["Inglês"]) === objAnt && JSON.stringify(M.OBJETOS_POR_DISCIPLINA["Espanhol"]) === objAnt && objAnt.includes("Estudo do texto"));
const calAnt = JSON.stringify(M.CALIBRACAO_EXTENSAO[ANTIGA]);
t("C2 calibração de extensão: a mesma faixa medida nas provas de 2022–2025", JSON.stringify(M.CALIBRACAO_EXTENSAO["Inglês"]) === calAnt && JSON.stringify(M.CALIBRACAO_EXTENSAO["Espanhol"]) === calAnt);
t("C3 regra 'proibido inventar' e idioma do item valem para as duas", M.precisaFontesReais("Inglês") && M.precisaFontesReais("Espanhol") && M.ehLinguaEstrangeira("Inglês") && M.ehLinguaEstrangeira("Espanhol"));
t("C4 biblioteca: Inglês usa os textos de Língua Estrangeira (todos em inglês); Espanhol não tem texto na biblioteca",
  M.DISCIPLINAS_TEXTOS_ENEM["Inglês"].join() === "Língua Estrangeira" && !M.DISCIPLINAS_TEXTOS_ENEM["Espanhol"] && M.DISCIPLINAS_TEXTOS_ENEM[ANTIGA].join() === "Língua Estrangeira");
t("C5 ordem biblioteca → IA → internet vale para Inglês, Espanhol e a chave antiga", M.usaOrdemIA("Inglês") && M.usaOrdemIA("Espanhol") && M.usaOrdemIA(ANTIGA) && !M.usaOrdemIA("Literatura"));
t("C6 selftest e impressão digital", fonte.includes("v7432_inglesEspanhol: (() => {") && fonte.includes("idiomaDaDisciplina.toString(), idiomaErradoDoTextoBase.toString()"));

console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
if (bad) Deno.exit(1);

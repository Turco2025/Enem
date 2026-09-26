/* v74.30 — MENOS REESCRITAS COM TEXTO DA BIBLIOTECA (generate-question, 26/09/2026).

   Leva de Artes de 26/09: 11 questões, US$ 1,50 (US$ 0,137 por questão), 9 reescritas
   pelo auditor e uma questão perdida. As causas e o que este teste prova, SEM chamar a
   Anthropic e SEM banco de verdade:
     A. o recorte da leva não pede mais cenário ao texto da biblioteca (era "construa o
        texto-base e a situação-problema sobre esse contexto") e o domínio de contexto não
        é imposto; sem texto da biblioteca, tudo continua como antes;
     B. o bloco do texto da biblioteca proíbe acrescentar fatos (regra do Guia do Inep: o
        enunciado não traz informação que falte no texto-base) e diz que aspas = citação;
        o texto mais próximo ganha a proibição de trocar o assunto pelo do tema;
     C. a conferência estrutural compara sem acento ("Prêmio PIPA" × www.premiopipa.com) e
        aceita a instituição CADASTRADA do texto da biblioteca, com a referência dele;
        fonte da web continua com a regra de sempre;
     D. no "texto mais próximo", nome próprio do pedido só pontua inteiro ("Mestre Ataíde"
        não puxa mais o texto sobre Mestre Didi);
     E. a ligação: linha do tema, bandeira textoDaBiblioteca, garantirFontesReais, selftest.

   Uso:
     deno run --allow-read --allow-write --allow-env tests/verify_reescritas_v7430.ts supabase/functions/generate-question/index.ts  */
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
type DiversidadeExtras = any;
const LETRAS_ALT_FONTE = ["A", "B", "C", "D", "E"];
const supabase: any = { from() { throw new Error("sem banco no teste"); } };
${entre("const TEXTOS_ENEM_MINIMO_PONTOS", "function normalizaTemaEnem(")}
${recorta("normalizaTemaEnem")}${recorta("radicalEnem")}${recorta("chaveEvitarEnem")}
${entre("function tokensDeFonte(", "\n/* Palavras que aparecem")}
${entre("const PALAVRAS_VAZIAS_FONTE", "\n]);\n")}
]);
${recorta("normalizaUrl")}${recorta("fonteEstaNaListaDeEvitar")}${recorta("normalizaParaComparar")}
${entre("/* ═══════════ v74.28 — BIBLIOTECA", "/* ═══════════ FIM DA BIBLIOTECA (v74.28)")}
${recorta("dossieDoTextoEnem")}${recorta("buildBlocoTextoEnem")}${recorta("buildDiversidadeTematica")}
const TIPOS_USO_FONTE = ["citacao", "adaptacao", "parafrase", "proprio"];
${recorta("conferenciaFontes")}${recorta("textoVisivelDaQuestao")}${recorta("corrigeFonteDoDossie")}
${recorta("textoCanonicoDaBiblioteca")}${recorta("fixaTextoDaBiblioteca")}
export { escolheTextoMaisProximo, nomesDoPedido, dossieDoTextoEnem, buildBlocoTextoEnem, buildDiversidadeTematica, conferenciaFontes, corrigeFonteDoDossie, fixaTextoDaBiblioteca };
`;
const tmp = await Deno.makeTempDir();
await Deno.writeTextFile(`${tmp}/m.ts`, modulo);
const M: any = await import(`file://${tmp}/m.ts`);

let ok = 0, falhas = 0;
function t(nome: string, cond: boolean, extra = "") {
  if (cond) { ok++; console.log(`PASS ${nome}`); } else { falhas++; console.log(`FAIL ${nome}${extra ? `\n     ${extra}` : ""}`); }
}

/* ---------- A. recorte e domínio × texto da biblioteca ---------- */
const rec = "conteúdo: grafite e política pública · contexto: viaduto no centro de São Paulo";
const comBib = M.buildDiversidadeTematica("", [], "grafite", rec, { dominioContexto: "transporte urbano", dominioAlternativo: "comércio de rua", textoDaBiblioteca: true });
const semBib = M.buildDiversidadeTematica("", [], "grafite", rec, { dominioContexto: "transporte urbano", dominioAlternativo: "comércio de rua" });
const semBibSemContexto = M.buildDiversidadeTematica("", [], "grafite", "conteúdo: grafite", { dominioContexto: "transporte urbano" });
const comBibSemContexto = M.buildDiversidadeTematica("", [], "grafite", "conteúdo: grafite", { dominioContexto: "transporte urbano", textoDaBiblioteca: true });
t("A1 com texto da biblioteca, o recorte vira ÂNGULO DE LEITURA e proíbe criar cenário", comBib.includes("ÂNGULO DE LEITURA") && comBib.includes("NÃO crie cenário, contexto, obra, lugar, data ou episódio") && comBib.includes("prevalece o texto"));
t("A2 com texto da biblioteca, some a ordem de construir o texto-base sobre o contexto do recorte", !comBib.includes("construa o texto-base e a situação-problema sobre esse contexto"));
t("A3 o recorte continua visível (a diversidade da leva vira o ângulo escolhido no texto)", comBib.includes(rec));
t("A4 com texto da biblioteca, o domínio de contexto não é imposto (nem sem 'contexto:' no recorte)", !comBib.includes("DOMÍNIO DE CONTEXTO RESERVADO") && !comBibSemContexto.includes("DOMÍNIO DE CONTEXTO RESERVADO"));
t("A5 sem texto da biblioteca (pesquisa na web, outras disciplinas), o bloco é o de antes", semBib.includes("Esta questão DEVE seguir este recorte") && semBib.includes("construa o texto-base e a situação-problema sobre esse contexto") && !semBib.includes("ÂNGULO DE LEITURA"));
t("A6 sem texto da biblioteca, o domínio continua entrando quando o recorte vem sem contexto", semBibSemContexto.includes("DOMÍNIO DE CONTEXTO RESERVADO"));
t("A7 sem recorte e sem domínio, nada é acrescentado", M.buildDiversidadeTematica("", [], "t", "", { textoDaBiblioteca: true }) === "");

/* ---------- B. bloco do texto da biblioteca ---------- */
const base = { id: 1, chave: "2016-regular-114", ano: 2016, numero: 114, prova: "ENEM", tipo_texto: "jornalistico", autor: "", instituicao: "Instituto Inhotim", obra: "", ano_obra: "",
  referencia: "Disponível em: www.inhotim.org.br. Acesso em: 22 maio 2013 (adaptado).", texto: "O acervo reúne obras de arte contemporânea.", comando_original: "", alternativas_originais: null, gabarito_original: "", habilidade_original: "", usos: 0 };
const dBib = M.dossieDoTextoEnem(base, 3);
const dAprox = M.dossieDoTextoEnem(base, 1); dAprox.doEnem.aproximado = true;
const bloco = M.buildBlocoTextoEnem(dBib), blocoA = M.buildBlocoTextoEnem(dAprox);
t("B1 todo texto da biblioteca: NADA ALÉM DO TEXTO, com a regra do Guia do Inep", bloco.includes("NADA ALÉM DO TEXTO") && bloco.includes("o enunciado não traz informação que falte no texto-base") && bloco.includes("nem para contextualizar"));
t("B2 comando, alternativas, gabarito e resolução não atribuem ao texto o que ele não diz", bloco.includes("Comando, alternativas, gabarito e resolução não atribuem ao texto nem ao autor nada que o texto não diga"));
t("B3 conhecimento prévio fica no raciocínio do aluno (o método do Inep não muda)", bloco.includes("fica no raciocínio do aluno"));
t("B4 texto ORIGINAL e INTEGRAL: proibido parafrasear, adaptar, resumir, recortar; sempre citação; referência exata",
  bloco.includes("TEXTO ORIGINAL E INTEGRAL") && bloco.includes("É PROIBIDO parafrasear, adaptar, resumir, recortar, reordenar, atualizar a ortografia, acrescentar ou suprimir")
  && bloco.includes('"tipoUso": "citacao", "conferidoNaFonte": true') && !bloco.includes('"tipoUso": "adaptacao"') && !bloco.includes("adaptação LEVE") && !bloco.includes("pode recortar"));
t("B4b a criação é o item (Matriz e Guia do Inep); vale para literário e não literário",
  bloco.includes("O trabalho de criação é o ITEM") && bloco.includes("Matriz de Referência e o Guia de Elaboração e Revisão de Itens do Inep")
  && M.buildBlocoTextoEnem({ ...dBib, doEnem: { ...dBib.doEnem, literario: true, tipoTexto: "poema" } }).includes("TEXTO ORIGINAL E INTEGRAL"));
t("B5 texto mais próximo: proíbe trocar o assunto e pôr dentro dele o artista pedido", blocoA.includes("Não troque o assunto do texto pelo do tema pedido nem ponha dentro dele o artista") && !bloco.includes("Não troque o assunto do texto"));
t("B6 as regras da v74.28/v74.29 continuam (texto fixo, questão original só para evitar)", bloco.includes("O TEXTO-BASE É ESTE") && bloco.includes("nem do mesmo autor, nem da mesma obra") && bloco.includes("só para você EVITAR"));

/* ---------- C. conferência estrutural ---------- */
const inh = { tipoUso: "adaptacao", autor: "", instituicao: "Instituto Inhotim", obra: "", referencia: base.referencia, comoVerificou: "biblioteca", conferidoNaFonte: true };
const pipa = { tipoUso: "adaptacao", autor: "", instituicao: "Prêmio PIPA", obra: "", referencia: "Disponível em: www.premiopipa.com. Acesso em: 13 nov. 2021 (adaptado).", comoVerificou: "c", conferidoNaFonte: true };
t("C1 Prêmio PIPA × www.premiopipa.com passa (o acento não reprova mais)", M.conferenciaFontes({ fonte: pipa }, []).estado === "ok");
t("C2 texto da biblioteca: a instituição cadastrada vale com a referência impressa (só o endereço)", M.conferenciaFontes({ fonte: inh }, [], dBib).estado === "ok");
t("C3 a mesma fonte SEM dossiê da biblioteca (pesquisa na web) continua reprovada", M.conferenciaFontes({ fonte: inh }, []).estado === "instituicao_fora_da_referencia");
t("C4 instituição diferente da cadastrada continua reprovada", M.conferenciaFontes({ fonte: { ...inh, instituicao: "Museu Inventado" } }, [], dBib).estado === "instituicao_fora_da_referencia");
t("C5 referência trocada (não é a do texto da biblioteca) continua reprovada", M.conferenciaFontes({ fonte: { ...inh, referencia: "Revista X, 2020." } }, [], dBib).estado === "instituicao_fora_da_referencia");
t("C6 dossiê de pesquisa na web (sem doEnem) não abre exceção", M.conferenciaFontes({ fonte: inh }, [], { encontrou: true, instituicao: "Instituto Inhotim", referencia: base.referencia }).estado === "instituicao_fora_da_referencia");
t("C7 as demais regras seguem: sem autor nem instituição = incompleto; próprio = ok", M.conferenciaFontes({ fonte: { ...inh, instituicao: "" } }, [], dBib).estado === "incompleto"
  && M.conferenciaFontes({ fonte: { tipoUso: "proprio", autor: "", instituicao: "", obra: "", referencia: "", comoVerificou: "", conferidoNaFonte: false } }, []).estado === "ok");
{
  const q: any = { textoBase: "O acervo reúne obras.", comando: "c", alternativas: { A: "a", B: "b", C: "c", D: "d", E: "e" }, resolucaoComentada: "r", analiseAlternativas: {},
    fonte: { tipoUso: "adaptacao", autor: "", instituicao: "", obra: "", referencia: base.referencia, comoVerificou: "c", conferidoNaFonte: true } };
  const campos = M.corrigeFonteDoDossie(q, dBib, "incompleto");
  t("C8 campo 'fonte' sem instituição: o dossiê da biblioteca completa e a conferência passa", campos.includes("instituicao") && q.fonte.instituicao === "Instituto Inhotim" && M.conferenciaFontes(q, [], dBib).estado === "ok", JSON.stringify(campos));
}

/* ---------- D. texto mais próximo: nome próprio inteiro ---------- */
const rows = [
  { id: 1, temas: ["arte afro-brasileira", "mestre didi", "candomble"], autor: "", obra: "www.premiopipa.com", usos: 0 },
  { id: 2, temas: ["escultura", "geometria"], autor: "Ademir Luiz", obra: "Mestre das linhas retas", usos: 0 },
  { id: 3, temas: ["oscar niemeyer", "arquitetura moderna", "barroco"], autor: "Oscar Niemeyer", obra: "Entrevistas", usos: 5 },
];
const zero = () => 0;
t("D1 nomes do pedido: 'Mestre Ataíde' e 'Arthur Bispo do Rosário' (com 'do'); palavra solta não é nome",
  JSON.stringify(M.nomesDoPedido("Barroco brasileiro (Aleijadinho e Mestre Ataíde)")) === JSON.stringify(["Mestre Ataíde"])
  && JSON.stringify(M.nomesDoPedido("Arthur Bispo do Rosário")) === JSON.stringify(["Arthur Bispo do Rosário"]));
const esc = M.escolheTextoMaisProximo("Barroco brasileiro (Aleijadinho e Mestre Ataíde)", rows, zero);
t("D2 'Mestre Ataíde' não puxa mais Mestre Didi nem 'Mestre das linhas retas': vence o texto com 'barroco'", esc && esc.row.id === 3, JSON.stringify(esc));
t("D3 o nome INTEIRO continua valendo: 'Mestre Didi' leva ao texto sobre Mestre Didi", M.escolheTextoMaisProximo("Mestre Didi", rows, zero).row.id === 1);
{
  const d4 = M.escolheTextoMaisProximo("Mestre Ataíde e o ofício de mestre", rows, zero);
  t("D4 palavra do nome que também aparece solta no pedido continua valendo sozinha", d4.pontos > 0 && [1, 2].includes(d4.row.id), JSON.stringify(d4));
}
t("D5 nome de pessoa presente nos temas pontua como antes (Oscar Niemeyer)", M.escolheTextoMaisProximo("Oscar Niemeyer", rows, zero).row.id === 3);

/* ---------- E. ligação ---------- */
const bup = fonte.slice(fonte.indexOf("\nfunction buildUserPrompt("), fonte.indexOf("\n}\n", fonte.indexOf("\nfunction buildUserPrompt(")));
t("E1 buildUserPrompt liga a bandeira só com dossiê da biblioteca encontrado (nunca com texto próprio)",
  bup.includes("const textoDaBiblioteca = !opts.textoProprio && !!(opts.dossie && opts.dossie.encontrou === true && opts.dossie.doEnem);")
  && bup.includes("{ ...(opts.diversidade || {}), textoDaBiblioteca }"));
t("E2 a linha do tema avisa quando o texto é o mais próximo", bup.includes("const textoAproximado = textoDaBiblioteca && opts.dossie.doEnem.aproximado === true;") && bup.includes("A BIBLIOTECA NÃO TEM TEXTO SOBRE ESTE TEMA"));
{
  const gfr = fonte.slice(fonte.indexOf("\nasync function garantirFontesReais("), fonte.indexOf("\n}\n", fonte.indexOf("\nasync function garantirFontesReais(")));
  t("E3 garantirFontesReais confere com o dossiê (antes e depois do conserto pelo dossiê)",
    (gfr.match(/conferenciaFontes\(data, buscas, dossiePrevio\)/g) || []).length === 2 && !gfr.includes("conferenciaFontes(data, buscas);"), String(gfr.length));
}
t("E4 'Como usar' do dossiê: texto da biblioteca integral, sem alteração; web igual; o elaborador vê o texto inteiro (até 8000)",
  fonte.includes('${d.doEnem ? "O texto-base é o texto INTEGRAL acima, sem nenhuma alteração') && fonte.includes('"Você pode resumir, parafrasear e contextualizar"')
  && fonte.includes('slice(0, d.doEnem ? 8000 : 1200)'));
t("E5 selftest v7430_reescritas e impressão digital", fonte.includes("v7430_reescritas: (() => {")
  && fonte.includes("nomesDoPedido.toString(), escolheTextoMaisProximo.toString(), buildDiversidadeTematica.toString(), conferenciaFontes.toString(),   // v74.30"));

/* ---------- F. o código garante o texto e a referência originais ---------- */
{
  const canon = `${base.texto}\n\n${base.referencia}`;
  const q: any = { textoBase: "O acervo, segundo o instituto, reúne obras contemporâneas.\n\nINHOTIM (adaptado).", comando: "Com base no texto, conclui-se que", alternativas: { A: "a" },
    fonte: { tipoUso: "adaptacao", autor: "", instituicao: "Inhotim", obra: "", ano: "", referencia: "INHOTIM (adaptado).", comoVerificou: "li", conferidoNaFonte: false, urlVerificacao: "https://x" } };
  const mexeu = M.fixaTextoDaBiblioteca(q, dBib);
  t("F1 paráfrase do elaborador: o texto-base volta a ser o ORIGINAL, inteiro, com a referência ORIGINAL", mexeu === true && q.textoBase === canon, JSON.stringify(q.textoBase));
  t("F2 o campo 'fonte' recebe os dados do texto: citação, autor/instituição/obra/ano/referência originais, sem URL", q.fonte.tipoUso === "citacao" && q.fonte.referencia === base.referencia
    && q.fonte.instituicao === "Instituto Inhotim" && q.fonte.autor === "" && q.fonte.conferidoNaFonte === true && q.fonte.urlVerificacao === "" && q.fonte.comoVerificou === "li");
  t("F3 o resto da questão (comando, alternativas) não é tocado", q.comando === "Com base no texto, conclui-se que" && q.alternativas.A === "a");
  t("F4 idempotente: aplicado de novo, não muda nada e não conta como alteração", M.fixaTextoDaBiblioteca(q, dBib) === false && q.textoBase === canon);
  t("F5 a conferência estrutural passa com a fonte reposta", M.conferenciaFontes(q, [], dBib).estado === "ok");
  const poema = M.dossieDoTextoEnem({ ...base, chave: "fuvest-1980-1f-q06", prova: "Fuvest 1980", tipo_texto: "poema", autor: "Olavo Bilac", instituicao: "", obra: "Poesias",
    referencia: "Olavo Bilac. Poesias. Trecho reproduzido na prova da Fuvest 1980.", texto: "Ora (direis) ouvir estrelas! Certo\nPerdeste o senso!\n\nE eu vos direi, no entanto," }, 5);
  const qp: any = { textoBase: "Ora (direis) ouvir estrelas!\n[...]\nOlavo Bilac", fonte: {} };
  M.fixaTextoDaBiblioteca(qp, poema);
  t("F6 poema: versos e estrofes preservados (quebras de linha iguais às do original), nada recortado",
    qp.textoBase === "Ora (direis) ouvir estrelas! Certo\nPerdeste o senso!\n\nE eu vos direi, no entanto,\n\nOlavo Bilac. Poesias. Trecho reproduzido na prova da Fuvest 1980." && qp.fonte.autor === "Olavo Bilac");
  t("F7 sem dossiê da biblioteca (pesquisa na web, texto próprio): nada acontece",
    M.fixaTextoDaBiblioteca({ textoBase: "t", fonte: {} }, null) === false && M.fixaTextoDaBiblioteca({ textoBase: "t", fonte: {} }, { encontrou: true, trecho: "x", referencia: "r" }) === false);
  const h = fonte.slice(fonte.indexOf("let textoDaBibliotecaReposto = 0;"));
  t("F8 o handler repõe o texto após a geração, antes da auditoria, em cada reescrita e na entrega (depois das normalizações)",
    h.indexOf('repoeTextoDaBiblioteca(data, "geração")') > 0
    && h.indexOf('repoeTextoDaBiblioteca(data, "antes da auditoria")') < h.indexOf("let fontesDiag = await garantirFontesReais(")
    && h.indexOf("repoeTextoDaBiblioteca(nova, `reescrita ${reelaboracoes}`)") < h.indexOf("const fd2 = await garantirFontesReais(nova")
    && h.indexOf("data = normalizarNotacaoMatematica(data, disciplina);\n    repoeTextoDaBiblioteca(data, \"entrega\")") > 0
    && h.indexOf('repoeTextoDaBiblioteca(data, "entrega")') < h.indexOf("return jsonResponse({ question: corrigirQuebrasLiterais(data)"));
  t("F9 a extensão do texto-base não se aplica ao texto da biblioteca (vale para comando e alternativas)",
    fonte.includes("a meta de extensão do texto-base não se aplica a ele — vale para o comando e as alternativas"));
}

console.log(`\n${ok} verificações passaram, ${falhas} falharam.`);
if (falhas) Deno.exit(1);

/* v74.34 — FERRAMENTA DE ENTREGA ÚNICA PARA OS QUATRO RECURSOS (generate-question), SEM CHAMAR A ANTHROPIC.

   Pedido do professor (06/10/2026): "uma ferramenta que entregue única que aceite os quatro
   tipos de recursos de modo que a leva leia o mesmo cache". A definição da ferramenta vem
   antes do prompt do sistema no prefixo cacheado; com uma ferramenta por recurso (v62), cada
   troca de recurso dentro da leva regravava os 23 mil tokens (US$ 0,058). Aqui se prova:
     A. a ferramenta "entregar_questao" é byte a byte a mesma para nenhum/imagem/grafico/tabela
        (varia só por disciplina — tetos — e por área — campo "fonte");
     B. o campo "visual" é obrigatório sempre, com um ramo estrito por tipo (anyOf) e
        {"tipo":"nenhum"} para questão sem recurso; "recurso" aceita os quatro valores;
     C. normalizarVisual descarta visual em questão sem recurso e converte {"tipo":"nenhum"} em
        null; visualConforme continua exigindo o tipo pedido (quem refaz é garantirVisual);
     D. a mensagem do usuário diz o tipo exato; o refazer do visual continua com o schema do
        recurso; a família de ferramentas (v74.29) é a mesma para os quatro recursos.
   O código conferido é o do arquivo de produção, recortado função a função.

   Uso: deno run -A tests/verify_ferramenta_unica_v7434.ts supabase/functions/generate-question/index.ts */
const alvo = Deno.args[0] || "supabase/functions/generate-question/index.ts";
const fonte = await Deno.readTextFile(alvo);
function recorta(nome: string, prefixo = "function "): string {
  const ini = fonte.indexOf(`\n${prefixo}${nome}(`);
  if (ini < 0) { console.error(`FALHA: não achei ${nome}`); Deno.exit(1); }
  const fim = fonte.indexOf("\n}\n", ini);
  return fonte.slice(ini, fim + 3);
}
function entre(a: string, b: string): string {
  const i = fonte.indexOf(a); const j = fonte.indexOf(b, i);
  if (i < 0 || j < 0) { console.error(`FALHA: não achei o trecho ${a.slice(0, 40)}`); Deno.exit(1); }
  return fonte.slice(i, j);
}
const modulo = `
${entre("const CALIBRACAO_EXTENSAO", "\nfunction findCalibracaoKey(")}
${recorta("findCalibracaoKey")}
${entre("const VISUAL_SCHEMA = {", "\n/* v62 — SCHEMA DO")}
${recorta("visualSchemaPara")}
${entre("const SCHEMA_FONTE = {", "\n/* ═══════════ v74.34")}
${entre("const RECURSOS_VISUAIS_TODOS", "\n// Compatibilidade com o restante do arquivo")}
function textoDeEspecificacao(x: any) { return typeof x === "string" ? x : JSON.stringify(x); }
${recorta("normalizarVisual")}
${recorta("visualConforme")}
${recorta("ferramentasDaQuestao")}
const FERRAMENTA_ALTERNATIVAS = { name: "entregar_alternativas" }, FERRAMENTA_GABARITO = { name: "entregar_gabarito" }, FERRAMENTA_IDIOMA = { name: "entregar_item_em_portugues" };
export { ferramentaQuestaoPara, ferramentaVisualPara, visualSchemaUnico, visualSchemaPara, normalizarVisual, visualConforme, ferramentasDaQuestao, RECURSOS_VISUAIS_TODOS };
`;
const tmp = await Deno.makeTempDir();
await Deno.writeTextFile(`${tmp}/fu.ts`, modulo);
const M: any = await import(`file://${tmp}/fu.ts`);

let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };
const RECURSOS = ["nenhum", "imagem", "grafico", "tabela"];
const J = (x: any) => JSON.stringify(x);

/* ---------- A. uma ferramenta só ---------- */
const porRecurso = RECURSOS.map((r) => J(M.ferramentaQuestaoPara(r, true, "Matemática")));
t("A1 a ferramenta é idêntica para os quatro recursos (mesma disciplina, mesma área)", new Set(porRecurso).size === 1);
t("A2 idem sem o campo \"fonte\" obrigatório (Natureza)", new Set(RECURSOS.map((r) => J(M.ferramentaQuestaoPara(r, false, "Biologia")))).size === 1);
t("A3 continua variando por disciplina (tetos de extensão) e por área (fonte obrigatória)",
  J(M.ferramentaQuestaoPara("nenhum", true, "Artes")) !== J(M.ferramentaQuestaoPara("nenhum", true, "História"))
  && J(M.ferramentaQuestaoPara("nenhum", true, "História")) !== J(M.ferramentaQuestaoPara("nenhum", false, "História")));
t("A4 a família de ferramentas (geração + correções dirigidas, v74.29) também é a mesma para os quatro recursos — as correções leem o cache da geração",
  new Set(RECURSOS.map((r) => J(M.ferramentasDaQuestao(M.ferramentaQuestaoPara(r, false, "Química"))))).size === 1);
t("A5 a lista dos quatro recursos", J(M.RECURSOS_VISUAIS_TODOS) === J(RECURSOS));

/* ---------- B. o schema ---------- */
const q = M.ferramentaQuestaoPara("imagem", true, "História");
const props = q.input_schema.properties, vis = props.visual;
t("B1 \"recurso\" aceita exatamente os quatro valores", J(props.recurso.enum) === J(RECURSOS));
t("B2 \"visual\" é obrigatório sempre (também sem recurso), e \"fonte\" só na área estrita",
  q.input_schema.required.includes("visual") && q.input_schema.required.includes("fonte")
  && M.ferramentaQuestaoPara("nenhum", false, "Biologia").input_schema.required.includes("visual") && !M.ferramentaQuestaoPara("nenhum", false, "Biologia").input_schema.required.includes("fonte"));
t("B3 \"visual\" tem quatro ramos (anyOf), um por tipo, na ordem nenhum/imagem/grafico/tabela",
  Array.isArray(vis.anyOf) && vis.anyOf.length === 4 && vis.anyOf.map((x: any) => x.properties.tipo.enum.join()).join(" ") === "nenhum imagem grafico tabela");
t("B4 cada ramo exige os campos essenciais do tipo (o rigor da v62 continua dentro do tipo)",
  vis.anyOf[0].required.join() === "tipo" && vis.anyOf[1].required.join() === "tipo,descricao,promptImagem"
  && vis.anyOf[2].required.join() === "tipo,chartType,titulo,labels,datasets" && vis.anyOf[3].required.join() === "tipo,titulo,colunas,linhas");
t("B5 os ramos de imagem/gráfico/tabela são os schemas do refazer (visualSchemaPara), só com a descrição trocada",
  ["imagem", "grafico", "tabela"].every((r, i) => J({ ...vis.anyOf[i + 1], description: "" }) === J({ ...M.visualSchemaPara(r), description: "" })));
t("B6 a descrição do campo manda entregar o tipo pedido na mensagem do usuário", /Recurso visual pedido/.test(vis.description) && /\{"tipo":"nenhum"\}/.test(vis.description));
t("B7 o refazer do visual (entregar_visual) continua com o schema estrito do recurso pedido",
  J(M.ferramentaVisualPara("grafico").input_schema.properties.visual) === J(M.visualSchemaPara("grafico")) && M.ferramentaVisualPara("imagem").input_schema.required.join() === "visual");
t("B8 o schema não tem type no nível do \"visual\" (anyOf decide) e cada ramo é object", !("type" in vis) && vis.anyOf.every((x: any) => x.type === "object"));

/* ---------- C. normalização e conferência ---------- */
t("C1 questão sem recurso não carrega visual: o que vier é descartado",
  M.normalizarVisual({ tipo: "nenhum" }, "nenhum") === null && M.normalizarVisual({ tipo: "imagem", promptImagem: "x".repeat(300) }, "nenhum") === null && M.normalizarVisual("texto", "nenhum") === null);
t("C2 {\"tipo\":\"nenhum\"} em questão COM recurso vira null — e visualConforme reprova, para garantirVisual refazer",
  M.normalizarVisual({ tipo: "nenhum" }, "imagem") === null && M.normalizarVisual({ tipo: " NENHUM " }, "tabela") === null && !M.visualConforme(null, "imagem").ok && !M.visualConforme({ tipo: "nenhum" }, "grafico").ok);
t("C3 visual do tipo pedido continua passando como antes",
  M.normalizarVisual({ tipo: "Imagem", promptImagem: "p".repeat(250), descricao: "d" }, "imagem").tipo === "imagem"
  && M.visualConforme({ tipo: "imagem", promptImagem: "p".repeat(250) }, "imagem").ok
  && M.visualConforme({ tipo: "tabela", titulo: "t", colunas: ["a"], linhas: [["1"]] }, "tabela").ok && !M.visualConforme({ tipo: "tabela", titulo: "t" }, "imagem").ok);
t("C4 null continua null; string de imagem continua virando promptImagem (comportamento antigo intacto fora do \"nenhum\")",
  M.normalizarVisual(null, "imagem") === null && M.normalizarVisual("especificação", "imagem").promptImagem === "especificação");

/* ---------- D. ligação ---------- */
t("D1 a mensagem do usuário diz o tipo exato que o campo \"visual\" tem de ter",
  fonte.includes('Recurso visual pedido: ${opts.recurso} — a ferramenta "entregar_questao" aceita os quatro recursos; nesta questão o campo "visual" tem de vir com "tipo": "${opts.recurso}"'));
t("D2 o handler continua montando a ferramenta com a mesma chamada (a troca é só por dentro)",
  (fonte.match(/const ferramentaQ = ferramentaQuestaoPara\(recurso, fontesReaisEstrito\(area\), disciplina\);/g) || []).length === 2 && fonte.includes("void recurso;   // v74.34"));
t("D3 selftest e impressão digital incluem a ferramenta única",
  fonte.includes("v7434_ferramentaUnica: (() => {") && fonte.includes('visualSchemaUnico.toString(), JSON.stringify([RECURSOS_VISUAIS_TODOS, ferramentaQuestaoPara("imagem", true, "História")]), normalizarVisual.toString()'));
t("D4 as instruções fixas pedem {\"tipo\":\"nenhum\"} para questão sem recurso (recurso_instrucoes.ts)",
  await (async () => { try { const ri = await Deno.readTextFile(alvo.replace(/index\.ts$/, "recurso_instrucoes.ts")); return ri.includes('"visual" como {"tipo":"nenhum"}') && ri.includes('"visual": {"tipo":"nenhum"} quando não há recurso visual'); } catch { return false; } })());

console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
if (bad) Deno.exit(1);

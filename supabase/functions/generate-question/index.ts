import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import APP_DATA_JSON from "./app_data.json" with { type: "json" };
const APP_DATA: any = APP_DATA_JSON;


const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Chave da Anthropic (Claude), guardada em segurança do lado do servidor —
// nunca é exposta ao navegador nem a quem chama esta função.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5";
// SEM TETO DIÁRIO (decisão do professor): ausente, 0 ou negativo = ilimitado.
// Para reativar um limite depois, basta definir MAX_DAILY_QUESTIONS com um número
// positivo nos secrets do projeto Supabase — não é preciso reimplantar a função.
const MAX_DAILY_QUESTIONS = Number(Deno.env.get("MAX_DAILY_QUESTIONS") || "0");

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Matriz de Referência oficial do ENEM (competências/habilidades por área),
// contexto pedagógico por área e o "modelo universal" de elaboração de itens —
// é o mesmo conteúdo usado pelo app cliente (Gerador Inteligente de Simulados ENEM).


const AREA_LABELS: Record<string, string> = {
  linguagens: "Linguagens, Códigos e suas Tecnologias",
  humanas: "Ciências Humanas e suas Tecnologias",
  natureza: "Ciências da Natureza e suas Tecnologias",
  matematica: "Matemática e suas Tecnologias",
};

// Disciplinas em que o texto-suporte tipicamente se apoia em autores, obras, pesquisas
// ou registros históricos/culturais reais — nestas disciplinas é proibido "inventar"
// autores/textos/estudos que não existem; o modelo deve usar apenas fontes reais e,
// em caso de dúvida, pesquisar na internet antes de escrever a questão (ver
// buildUserPrompt/buildValidationChecklist). Comparação por substring, em minúsculas,
// para cobrir variações do rótulo (ex.: "Língua Estrangeira (Inglês/Espanhol)").
const DISCIPLINAS_FONTES_REAIS_OBRIGATORIAS = [
  "literatura", "língua portuguesa", "artes", "língua estrangeira",
  "história", "geografia", "filosofia", "sociologia", "biologia",
];
function precisaFontesReais(disciplina: string): boolean {
  const d = (disciplina || "").toLowerCase();
  return DISCIPLINAS_FONTES_REAIS_OBRIGATORIAS.some((alvo) => d.includes(alvo));
}

const CALIBRACAO_EXTENSAO: Record<string, { n: number; texto: [number, number, number]; comando: [number, number, number]; item: [number, number, number] }> = {
  "Língua Portuguesa": { n: 213, texto: [608, 1201, 902], comando: [82, 180, 138], item: [44, 70, 58] },
  "Literatura": { n: 105, texto: [608, 1122, 868], comando: [82, 164, 118], item: [45, 67, 57] },
  "Artes": { n: 50, texto: [384, 798, 610], comando: [107, 189, 143], item: [48, 70, 61] },
  "Educação Física": { n: 32, texto: [799, 1134, 962], comando: [83, 128, 106], item: [35, 73, 59] },
  "Língua Estrangeira (Inglês/Espanhol)": { n: 100, texto: [409, 1073, 761], comando: [77, 179, 129], item: [37, 60, 50] },
  "História": { n: 132, texto: [469, 757, 620], comando: [84, 130, 104], item: [33, 53, 45] },
  "Geografia": { n: 152, texto: [398, 737, 554], comando: [76, 126, 101], item: [29, 43, 37] },
  "Filosofia": { n: 80, texto: [477, 671, 596], comando: [78, 118, 95], item: [31, 51, 41] },
  "Sociologia": { n: 86, texto: [497, 780, 625], comando: [76, 123, 107], item: [28, 49, 40] },
  "Biologia": { n: 163, texto: [374, 634, 527], comando: [41, 102, 93], item: [13, 49, 34] },
  "Física": { n: 154, texto: [476, 805, 648], comando: [47, 122, 109], item: [5, 40, 25] },
  "Química": { n: 133, texto: [483, 780, 641], comando: [56, 110, 104], item: [7, 41, 26] },
  "Matemática": { n: 450, texto: [420, 725, 586], comando: [47, 134, 142], item: [3, 10, 9] },
};

function findCalibracaoKey(disciplina: string): string | null {
  const alvo = (disciplina || "").trim().toLowerCase();
  if (!alvo) return null;
  for (const key of Object.keys(CALIBRACAO_EXTENSAO)) {
    if (key.toLowerCase() === alvo) return key;
  }
  for (const key of Object.keys(CALIBRACAO_EXTENSAO)) {
    const k = key.toLowerCase();
    if (alvo.includes(k) || k.includes(alvo)) return key;
  }
  if (alvo.includes("tecnologia") && alvo.includes("informa")) return "Língua Portuguesa";
  return null;
}

function buildCalibracaoExtensao(disciplina: string): string {
  const key = findCalibracaoKey(disciplina);
  if (!key) return "";
  const cal = CALIBRACAO_EXTENSAO[key];
  const [tP25, tP75, tMean] = cal.texto;
  const [cP25, cP75, cMean] = cal.comando;
  const [iP25, iP75, iMean] = cal.item;
  return `

📏 CALIBRAÇÃO DE EXTENSÃO (baseada na contagem real de caracteres de ${cal.n} questões de "${key}" nas provas do ENEM 2015-2025):
- Texto-suporte (campo "textoBase"): mire em torno de ${tMean} caracteres; a maioria das questões reais desta disciplina fica entre ${tP25} e ${tP75} caracteres.
- Comando (campo "comando"): mire em torno de ${cMean} caracteres; faixa típica real: ${cP25}–${cP75} caracteres.
- Cada alternativa (A-E): mire em torno de ${iMean} caracteres cada; faixa típica real: ${iP25}–${iP75} caracteres (alternativas numéricas curtas são normais quando ${iMean} for baixo).
Trate estes números como META DE REFERÊNCIA, não como contagem rígida obrigatória: o objetivo é que a questão gerada "pareça" uma questão real do ENEM em tamanho — nem artificialmente mais curta nem mais longa que o padrão histórico desta disciplina. Pequena variação em torno da meta é normal e aceitável; o que deve ser evitado é uma questão sistematicamente muito mais longa ou muito mais curta que a média real acima.`;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/* ---------------- Prompt building (porta fiel da lógica do app cliente) ---------------- */

// Objetos de conhecimento oficiais (Anexo da Matriz de Referência do ENEM), por área.
// Vão no PROMPT DO SISTEMA — e não no prompt do usuário — para que tanto a chamada de
// geração quanto a de revisão enxerguem a mesma lista: o revisor precisa dela para
// conferir se o objeto declarado pela questão existe de fato na Matriz.
function buildObjetosConhecimento(area: string): string {
  const lista = APP_DATA.objetosConhecimento ? APP_DATA.objetosConhecimento[area] : null;
  if (!Array.isArray(lista) || lista.length === 0) return "";
  const itens = lista.map((o: string, i: number) => `${i + 1}. ${o}`).join("\n");
  return `\n\n📚 OBJETOS DE CONHECIMENTO OFICIAIS DESTA ÁREA (Anexo da Matriz de Referência do ENEM) — a questão DEVE declarar exatamente UM deles, no campo "objetoConhecimento", escolhido por ser o recorte de conteúdo que ela efetivamente mobiliza (não por afinidade temática de superfície). Copie literalmente, no campo "objetoConhecimento", um dos títulos da lista abaixo — sem abreviar, parafrasear ou combinar dois deles. É PROIBIDO declarar um objeto de conhecimento que não esteja nesta lista:\n${itens}`;
}

function buildSystemPrompt(area: string) {
  return APP_DATA.universalModel + "\n\n" + APP_DATA.areaContext[area] + buildObjetosConhecimento(area);
}

const RECURSO_INSTRUCOES: Record<string, string> = {
  nenhum: `Recurso visual: NENHUM. Não inclua gráfico, tabela ou imagem. Explore a situação-problema apenas por meio do texto-suporte. Deixe o campo "visual" como null e "recurso" como "nenhum".`,
  imagem: `Recurso visual: IMAGEM. A questão deve depender de uma imagem/ilustração pedagogicamente necessária (nunca meramente decorativa) para ser respondida corretamente — por exemplo: esquema anatômico, diagrama de processo, mapa, representação de fenômeno, estrutura, infográfico. Preencha "recurso":"imagem" e "visual" com: {"tipo":"imagem","descricao":"<legenda em português explicando o que a imagem mostra e por que ela é necessária para resolver a questão>","promptImagem":"<descrição em INGLÊS, detalhada, objetiva, no estilo de ilustração científica/educacional plana, limpa, adequada para um gerador de imagens>"}. REGRA OBRIGATÓRIA SOBRE DADOS REFERENCIAIS NA IMAGEM: evite texto ou letras soltas/decorativas sem função na imagem, MAS se a imagem contiver qualquer dado referencial necessário para resolver a questão — régua/escala graduada, marcações de altura/distância/tempo/velocidade, valores em um eixo, rótulos de unidades, ou qualquer número/rótulo que a "descricao" ou o "comando" mencionem explicitamente (ex.: "régua indicando alturas de 5 m, 10 m, 15 m e 20 m") — esses números e rótulos são OBRIGATÓRIOS e DEVEM aparecer desenhados de forma nítida e legível na própria imagem gerada, não apenas citados na legenda. Nunca descreva na "descricao" um dado que não esteja de fato visível na imagem. Para isso, o "promptImagem" deve instruir explicitamente o gerador de imagens a desenhar essas marcações/números exatos (ex.: "with a graduated ruler showing clearly legible labeled numbers at 5 m, 10 m, 15 m, and 20 m next to each tick mark"). O enunciado e o comando devem fazer referência explícita ao que aparece na imagem, e tudo que for citado como visível deve estar de fato desenhado nela.`,
  grafico: `Recurso visual: GRÁFICO. A questão deve depender de um gráfico com dados numéricos plausíveis e coerentes (cientificamente ou matematicamente consistentes com o texto-suporte), efetivamente necessários para resolver a questão — não apenas decorativos. Preencha "recurso":"grafico" e "visual" com: {"tipo":"grafico","chartType":"bar" ou "line" ou "pie","titulo":"...","labels":["...","..."],"datasets":[{"label":"...","data":[num,num,...]}]}. Os números usados no gráfico devem ser os mesmos que a resolução comentada utiliza.`,
  tabela: `Recurso visual: TABELA. A questão deve depender de uma tabela com dados relevantes (resultados experimentais, dados populacionais, séries históricas, comparações entre grupos etc.), efetivamente necessários para resolver a questão. Preencha "recurso":"tabela" e "visual" com: {"tipo":"tabela","titulo":"...","colunas":["...","..."],"linhas":[["...","..."],["...","..."]]}.`,
};

function findCompetencia(area: string, numero: number) {
  const m = APP_DATA.matriz[area];
  if (!m) return null;
  return m.competencias.find((c: any) => c.numero === numero) || null;
}

function findHabilidade(area: string, codigo: string) {
  const m = APP_DATA.matriz[area];
  if (!m) return null;
  for (const c of m.competencias) {
    const h = c.habilidades.find((h: any) => h.codigo === codigo);
    if (h) return { competencia: c, habilidade: h };
  }
  return null;
}

function buildMatrizInstrucoes(area: string, competenciaNum: number | null, habilidadeCod: string | null) {
  const m = APP_DATA.matriz[area];
  if (habilidadeCod) {
    const found = findHabilidade(area, habilidadeCod);
    if (found) {
      return `A questão DEVE mobilizar exatamente esta competência e habilidade da Matriz de Referência (cite-as literalmente nos campos "competencia" e "habilidade" da resposta):\nCompetência ${found.competencia.numero}: ${found.competencia.texto}\n${found.habilidade.codigo}: ${found.habilidade.texto}`;
    }
  }
  if (competenciaNum) {
    const c = findCompetencia(area, competenciaNum);
    if (c) {
      const habsTxt = c.habilidades.map((h: any) => `${h.codigo}: ${h.texto}`).join("\n");
      return `A questão DEVE pertencer a esta competência de área:\nCompetência ${c.numero}: ${c.texto}\nEscolha, dentre as habilidades abaixo, a que melhor corresponde à operação cognitiva exigida pela questão que você vai elaborar, e cite-a literalmente no campo "habilidade":\n${habsTxt}`;
    }
  }
  const allTxt = m.competencias
    .map((c: any) => `Competência ${c.numero}: ${c.texto}\n` + c.habilidades.map((h: any) => `  ${h.codigo}: ${h.texto}`).join("\n"))
    .join("\n\n");
  return `O professor NÃO especificou competência/habilidade. Analise o tema pedido, a disciplina e o nível de dificuldade, e escolha, dentre TODAS as competências e habilidades oficiais da área abaixo, a única competência e a única habilidade que mais correspondem à operação cognitiva que a questão vai exigir (não apenas ao assunto de superfície). Cite-as literalmente e por completo nos campos "competencia" e "habilidade" da resposta.\n\n${allTxt}`;
}

const JSON_SCHEMA_TXT = `Responda SOMENTE com um objeto JSON válido (sem markdown, sem texto antes ou depois, sem comentários), exatamente neste formato:
{
 "area": "string",
 "disciplina": "string",
 "tema": "string",
 "dificuldade": "Fácil" | "Médio" | "Difícil",
 "competencia": {"numero": number, "texto": "string (texto oficial completo da competência)"},
 "habilidade": {"codigo": "HXX", "texto": "string (texto oficial completo da habilidade)"},
 "objetoConhecimento": "string (título do objeto de conhecimento oficial da área, copiado literalmente da lista de OBJETOS DE CONHECIMENTO OFICIAIS apresentada no prompt do sistema — nunca um objeto inventado)",
 "recurso": "nenhum" | "imagem" | "grafico" | "tabela",
 "visual": null ou objeto conforme instruído acima,
 "textoBase": "string (texto-suporte com contextualização; termine com a citação de fonte no formato ENEM — real ou verossímil, EXCETO quando a regra 'PROIBIDO INVENTAR AUTORES OU TEXTOS' abaixo se aplicar à disciplina, caso em que a fonte citada TEM que ser real)",
 "comando": "string (o enunciado da pergunta, curto, indireto, SEM nenhum ponto de interrogação — é sempre uma frase afirmativa que se completa com as alternativas, nunca uma pergunta direta)",
 "alternativas": {"A":"string","B":"string","C":"string","D":"string","E":"string"},
 "gabarito": "A" | "B" | "C" | "D" | "E",
 "resolucaoComentada": "string (explicação detalhada do raciocínio para chegar à resposta correta)",
 "analiseAlternativas": {
   "A": {"status":"correta"|"incorreta","comentario":"string"},
   "B": {"status":"correta"|"incorreta","comentario":"string"},
   "C": {"status":"correta"|"incorreta","comentario":"string"},
   "D": {"status":"correta"|"incorreta","comentario":"string"},
   "E": {"status":"correta"|"incorreta","comentario":"string"}
 }
}
No campo "comentario" de cada alternativa errada, nomeie explicitamente o tipo de distrator (leitura parcial, inversão de causa/efeito, verdade parcial, anacronismo/confusão conceitual, senso comum, erro de processo, excesso de escopo, reaproveitamento fora de contexto) e explique EM TERMOS CONCEITUAIS o raciocínio equivocado que ela representa — nunca justifique a incorreção apenas apontando que a alternativa usa uma palavra absoluta/extrema; a palavra não é o motivo do erro, o raciocínio é. Nunca deixe mais de uma alternativa com status "correta".`;

// Bloco anti-alucinação: injetado apenas para disciplinas em que o texto-suporte
// tipicamente cita autor/obra/pesquisa real (ver DISCIPLINAS_FONTES_REAIS_OBRIGATORIAS).
// Instrui o modelo a nunca inventar autoria e a usar a ferramenta web_search (quando
// disponível na chamada) para verificar qualquer dado do qual não tenha certeza.
function buildRegraFontesReais(disciplina: string): string {
  if (!precisaFontesReais(disciplina)) return "";
  return `

⚠️ REGRA OBRIGATÓRIA — PROIBIDO INVENTAR AUTORES OU TEXTOS: a disciplina "${disciplina}" normalmente exige um texto-suporte apoiado em autor, obra, pesquisa, teoria, evento histórico ou registro cultural real. Você está TERMINANTEMENTE PROIBIDO de inventar, "criar hipóteses de", atribuir erroneamente ou apresentar como real qualquer autor, livro, poema, conto, artigo, quadro, obra de arte, filme, teoria, pesquisador, estudo científico, citação ou fato histórico que não exista de fato. Use SOMENTE autores/obras/estudos reais, verificáveis e reconhecidos, adequados ao nível de ensino médio/ENEM (autores consagrados da literatura em língua portuguesa e estrangeira, documentos e eventos históricos reais, teóricos e obras reais de filosofia/sociologia, pesquisas e pesquisadores reais de biologia, obras de arte reais, etc.).
Se você tiver QUALQUER dúvida sobre a existência, autoria, título exato, data, conteúdo ou trecho de um texto/autor antes de usá-lo, USE A FERRAMENTA web_search para verificar em fontes confiáveis (sites de universidades, editoras, enciclopédias reconhecidas, artigos científicos/acadêmicos, acervos como Domínio Público, Fundação Biblioteca Nacional, Scielo) antes de escrever a questão — é sempre preferível pesquisar e confirmar a arriscar citar algo inexistente ou incorreto. No campo "textoBase", cite a fonte real (autor, obra, ano) no formato ENEM; é PROIBIDO usar uma citação "verossímil"/fictícia nesta disciplina. Você pode resumir, parafrasear ou adaptar um trecho real do texto (para não reproduzir excertos extensos protegidos por direitos autorais), mas a autoria e a obra citadas devem ser genuínas e o conteúdo do resumo deve corresponder fielmente ao que a obra real de fato trata.`;
}

function buildUserPrompt(opts: {
  area: string; disciplina: string; tema: string; dificuldade: string;
  recurso: string; competenciaNum: number | null; habilidadeCod: string | null;
  instrucoesVisual?: string;
}) {
  return `Elabore UMA questão inédita, original, no padrão ENEM, com os seguintes parâmetros definidos pelo professor:

Área do conhecimento: ${AREA_LABELS[opts.area]}
Disciplina: ${opts.disciplina}
Tema/conteúdo solicitado: ${opts.tema || "(o professor não detalhou; escolha um tema representativo da disciplina e do nível de dificuldade pedidos)"}
Nível de dificuldade: ${opts.dificuldade}
${buildRegraFontesReais(opts.disciplina)}
${buildCalibracaoExtensao(opts.disciplina)}

${RECURSO_INSTRUCOES[opts.recurso]}
${opts.instrucoesVisual ? `\nInstruções adicionais do professor especificamente para o recurso visual (siga-as com prioridade, desde que compatíveis com o pedido acima): ${opts.instrucoesVisual}\n` : ""}

${buildMatrizInstrucoes(opts.area, opts.competenciaNum, opts.habilidadeCod)}

${JSON_SCHEMA_TXT}`;
}

// Prompt usado quando o professor/aluno pede para refazer SÓ o recurso visual de uma
// questão já pronta (botão "Refazer" na tela) — mantém texto-base, comando, alternativas,
// gabarito e resolução comentada intactos, e pede ao modelo apenas uma nova versão do
// recurso visual, opcionalmente guiada por instruções extras digitadas na hora.
function buildVisualRedoPrompt(opts: {
  tema: string; recurso: string; textoBase: string; comando: string;
  alternativas: Record<string, string>; gabarito: string; resolucaoComentada: string;
  instrucoesVisual?: string;
}) {
  return `Você elaborou anteriormente a questão de vestibular abaixo (padrão ENEM). O professor pediu para refazer SOMENTE o recurso visual (${opts.recurso}) desta questão — mantenha o texto-suporte, o comando, as alternativas, o gabarito e a resolução comentada exatamente como estão; gere apenas uma NOVA versão do recurso visual, coerente com o restante da questão e com os MESMOS fatos/valores já usados na resolução comentada, a menos que as instruções do professor abaixo peçam explicitamente para mudar dados.

QUESTÃO ATUAL (contexto — não repita nem altere nada disto na sua resposta):
Tema: ${opts.tema}
Texto-suporte: ${opts.textoBase}
Comando: ${opts.comando}
Alternativas: ${JSON.stringify(opts.alternativas)}
Gabarito: ${opts.gabarito}
Resolução comentada: ${opts.resolucaoComentada}

${RECURSO_INSTRUCOES[opts.recurso]}
${opts.instrucoesVisual
    ? `\nInstruções adicionais do professor para esta nova versão do recurso visual (siga-as com prioridade): ${opts.instrucoesVisual}\n`
    : `\nO professor não deu instruções adicionais desta vez — gere uma variação genuinamente diferente da anterior (ex.: outro tipo de gráfico, outra organização da tabela, outro ângulo/estilo de imagem), mantendo a coerência com a questão.\n`}

Responda SOMENTE com um objeto JSON válido (sem markdown, sem texto antes ou depois, sem comentários), exatamente neste formato:
{"visual": <objeto do recurso visual, no formato de "visual" instruído acima>}`;
}

// PROTOCOLO DE REVISÃO E VALIDAÇÃO — construído a partir da Ficha de Revisão de Item
// do Inep/MEC (Guia de Elaboração e Revisão de Itens, seção 6: 35 critérios em 5 blocos),
// acrescida do gate de falhas fatais (Guia, seção 6: motivos de devolução ao elaborador)
// e das regras adicionais obrigatórias definidas pelo professor responsável.
// Critérios condicionais: fontes reais (disciplinas que exigem autor/obra real) e
// extensão calibrada (disciplinas com amostra em CALIBRACAO_EXTENSAO).
function buildValidationChecklist(disciplina: string, dificuldade: string): string {
  const criterioFontesReais = precisaFontesReais(disciplina)
    ? `\n2.6 FONTE REAL OBRIGATÓRIA NESTA DISCIPLINA: todo autor, obra, pesquisador, teoria, evento histórico ou fonte citada no textoBase é real, verificável e corretamente atribuída — não inventada nem "hipotética". Se houver qualquer dúvida sobre existência, autoria, título exato, data ou conteúdo, use a ferramenta web_search para confirmar; se não for possível confirmar, substitua por autor/obra/estudo real e comprovadamente existente sobre o mesmo tema, com a fonte real citada no formato ABNT/ENEM.`
    : "";
  const calKey = findCalibracaoKey(disciplina);
  const criterioExtensao = calKey
    ? (() => {
        const cal = CALIBRACAO_EXTENSAO[calKey];
        return `\n5.9 EXTENSÃO CALIBRADA PELA MÉDIA REAL DO ENEM: o tamanho de textoBase (meta ~${cal.texto[2]} caracteres, faixa típica ${cal.texto[0]}–${cal.texto[1]}), de comando (meta ~${cal.comando[2]}, faixa ${cal.comando[0]}–${cal.comando[1]}) e de cada alternativa A-E (meta ~${cal.item[2]} cada, faixa ${cal.item[0]}–${cal.item[1]}) está compatível com a média real de "${calKey}" no ENEM, e o item cabe no tempo médio de três minutos de resolução previsto pelo Guia do Inep. Se algum campo estiver muito fora dessas faixas, ajuste-o preservando o conteúdo pedagógico — sem preenchimento artificial nem corte de informação necessária.`;
      })()
    : "";

  return `Você é agora o REVISOR TÉCNICO-PEDAGÓGICO do item abaixo, que você mesmo elaborou. Aplique o PROTOCOLO OBRIGATÓRIO DE REVISÃO E VALIDAÇÃO baseado na Ficha de Revisão de Item do Inep/MEC, analisando CADA critério um a um, de forma ao mesmo tempo global e detalhada. Nenhum item pode ser aprovado com qualquer critério não atendido.

═══════ ETAPA 1 — GATE DE FALHAS FATAIS (verifique ANTES de tudo) ═══════
Conforme o Guia do Inep, o item é DEVOLVIDO PARA REFORMULAÇÃO se apresentar qualquer um destes problemas. Encontrando QUALQUER um deles, você é OBRIGADO a REESCREVER O ITEM INTEIRO — correção pontual é proibida neste caso:
F1. O item não atende a nenhuma habilidade da Matriz de Referência, ou atende a mais de uma (o item deve contemplar UMA ÚNICA habilidade).
F2. Há erro conceitual, factual, numérico ou de unidade em qualquer parte do item.
F3. Há mais de um gabarito defensável, ou nenhuma alternativa é inequivocamente correta.
F4. Falta justificativa para alguma alternativa, ou alguma justificativa é insuficiente/tautológica.
F5. Há recurso visual (gráfico/tabela/imagem) ilegível, incoerente com o enunciado, meramente decorativo, ou cujos dados não sustentam a resolução comentada.
F6. Falta referência bibliográfica quando ela é necessária, ou o objeto de conhecimento declarado não existe na lista oficial da área (foi inventado).
F7. O enunciado não apresenta problematização satisfatória, ou não explicita UM ÚNICO problema a ser resolvido.

═══════ ETAPA 2 — FICHA DE REVISÃO (5 blocos) ═══════

▸ BLOCO 1 — ASPECTOS FORMAIS
1.1 O item indica a habilidade da Matriz (código e texto oficial completo).
1.2 O item indica a competência de área (número e texto oficial completo).
1.3 O item indica o nível de dificuldade, e este é o solicitado ("${dificuldade}").
1.4 O item indica o objeto de conhecimento (campo "objetoConhecimento"), copiado literalmente de um item da lista oficial da área apresentada no prompt do sistema.
1.5 O item indica o gabarito de forma explícita e única.
1.6 O item apresenta texto-base.
1.7 O item apresenta referência bibliográfica completa do texto-base, no formato ABNT/ENEM (ou NA quando o texto-base for situação hipotética formulada pelo elaborador, o que só é permitido nas disciplinas em que fonte fictícia é autorizada).
1.8 O item apresenta enunciado (comando).
1.9 O item apresenta exatamente 5 alternativas (A-E).
1.10 O item apresenta justificativa para CADA uma das 5 alternativas.

▸ BLOCO 2 — COMPOSIÇÃO DO TEXTO-BASE
2.1 O texto-base é adequado em termos de coesão e coerência.
2.2 A referência utilizada é fidedigna — recuperável em pesquisa na Internet ou em material impresso de ampla divulgação — e não é livro didático (fonte proibida pelo Guia).
2.3 O vocabulário e as situações utilizadas são NACIONALMENTE conhecidos (sem regionalismos ou referências locais que desfavoreçam parte dos candidatos).
2.4 Havendo imagem/gráfico/tabela, é pertinente, de boa qualidade, legível e efetivamente necessária à resolução (nunca decorativa); todo dado citado como visível está de fato representado.
2.5 O texto-base contém TODAS as informações necessárias à resolução e está livre de elementos meramente acessórios que gerem ambiguidade ou consumam tempo de leitura sem função; não exige informação simplesmente decorada (fórmula, data, nome, termo isolado).${criterioFontesReais}

▸ BLOCO 3 — COMPOSIÇÃO DO ENUNCIADO
3.1 O enunciado apresenta claramente o que deve ser solucionado.
3.2 A problematização proposta pelo enunciado é satisfatória e explicita UM ÚNICO problema.
3.3 O vocabulário e as situações do enunciado são nacionalmente conhecidos.
3.4 O enunciado NÃO apresenta informações adicionais ou complementares ao texto-base — ele considera exatamente a totalidade das informações já oferecidas. (Se algum dado necessário à resolução aparece só no comando, mova-o para o texto-base.)
3.5 O enunciado NÃO contém os termos "falso", "exceto", "incorreto", "não", "errado" nem qualquer formulação por negação.
3.6 O enunciado NÃO contém termos absolutos ("sempre", "nunca", "todo", "totalmente", "absolutamente", "completamente", "somente").
3.7 O enunciado NÃO usa as sentenças proibidas "Pode-se afirmar que" / "É correto afirmar que" nem equivalentes; usa termos impessoais ("considere-se", "calcula-se", "argumenta-se", "estima-se").
3.8 O enunciado NÃO contém ponto de interrogação (?) — é sempre frase declarativa que se completa com as alternativas. Se encontrar "?", reescreva na forma declarativa (ex.: "Qual é o valor de x?" vira "O valor de x corresponde a").

▸ BLOCO 4 — COMPOSIÇÃO DAS ALTERNATIVAS E DAS JUSTIFICATIVAS
4.1 As alternativas relacionam-se com o enunciado e o texto-base, sem configurar proposições independentes.
4.2 Há gabarito, e a indicação do gabarito é correta.
4.3 O gabarito é ÚNICO — nenhuma outra alternativa é defensável como correta.
4.4 O gabarito é claro e NÃO é mais atrativo que os distratores (não é o mais completo, o mais qualificado, o mais detalhado nem o mais bem redigido).
4.5 Os quatro distratores são PLAUSÍVEIS: cada um retrata uma hipótese de raciocínio efetivamente utilizada por um estudante na busca da solução (preferencialmente um erro comum de ensino-aprendizagem), é tecnicamente bem elaborado e não é absurdo, grosseiro nem facilmente eliminável.
4.6 Os distratores são claros, SEM INDUÇÃO AO ERRO — nenhum é uma "pegadinha" que faz o candidato errar por desatenção a um detalhe, em vez de por não dominar a habilidade testada.
4.7 As alternativas apresentam paralelismo sintático e semântico.
4.8 As alternativas foram redigidas SEM TERMOS ABSOLUTOS. Nenhuma delas — nem a correta, nem as 4 erradas — contém "apoio irrestrito", "somente e exclusivamente", "completamente", "rejeição completa", "negam qualquer participação", "integralmente", "drasticamente", "todos", "totalmente", "nunca", "sempre", "sem exceção", "de forma alguma", "em absoluto", "unicamente", "somente", "exclusivamente", "qualquer", "jamais" ou equivalentes. Esse tipo de termo é pista lexical: permite descartar ou marcar a alternativa só pelo tom, sem o conteúdo, nivelando por baixo qualquer nível de dificuldade. Encontrando algum, reescreva a alternativa mantendo EXATAMENTE o mesmo erro de raciocínio (ou a mesma ideia, se for a correta), porém em linguagem comedida e específica, no mesmo registro das demais.
4.9 As alternativas apresentam extensão equivalente entre si.
4.10 As alternativas seguem uma sequência lógica: valores numéricos em ordem crescente (ou decrescente) de A a E; alternativas verbais em ordem narrativa, cronológica ou alfabética quando houver ordem natural.
4.11 As alternativas são independentes entre si — não mutuamente excludentes, não negam informações do texto, não são semanticamente muito próximas; nenhuma usa "todas as anteriores"/"nenhuma das anteriores"; nenhuma repete desnecessariamente palavras do enunciado.
4.12 As justificativas são corretas, válidas e NÃO TAUTOLÓGICAS: cada uma informa exatamente por que aquela alternativa é ou não a resposta correta, nomeando o tipo de distrator e explicando EM TERMOS CONCEITUAIS o raciocínio, o conceito, a etapa de cálculo ou a leitura equivocada que a produz. É proibido justificar a incorreção apenas apontando que a alternativa "usa uma palavra absoluta/extrema" — a palavra não é o motivo do erro, o raciocínio é.
4.13 A pontuação e a grafia das alternativas seguem a regra da área. Como o comando é sempre declarativo aqui, o caso padrão é "alternativa que complementa a sentença do enunciado": inicie em minúscula e finalize com ponto final — exceto alternativas exclusivamente numéricas/simbólicas de Matemática, Física e Química, em que se apresenta apenas o valor com sua unidade.

▸ BLOCO 5 — ADEQUAÇÃO GLOBAL DO ITEM
5.1 O item atende à habilidade indicada — a operação cognitiva realmente exigida corresponde ao "saber fazer" descrito na habilidade, não apenas ao assunto de superfície.
5.2 O item atende à competência de área indicada.
5.3 O OBJETO DE CONHECIMENTO declarado é um dos objetos oficiais da área (conferido contra a lista do prompt do sistema, sem invenção nem paráfrase do título) E corresponde ao conteúdo que a questão de fato mobiliza — não apenas a um assunto vizinho ou de afinidade superficial. Se não corresponder, troque pelo objeto correto ou reformule a questão para que ela realmente trate do objeto declarado.
5.4 O item é ISENTO DE ERROS CONCEITUAIS. Reconfira todo dado científico, histórico, estatístico, numérico, gráfico, tabular, de fonte, de autoria, de data e de unidade de medida; confirme a coerência entre texto-base, recurso visual, alternativas e resolução comentada.
5.5 O item é CONTEXTUALIZADO: configura uma situação-problema autêntica que permeia toda a estrutura (do texto-base às alternativas), e não uma questão tradicional de conteúdo acompanhada de um texto decorativo. O item forma UMA unidade de proposição, com coesão e coerência entre texto-base, enunciado e alternativas, explicitando uma única situação-problema e abordagem homogênea de conteúdo.
5.6 O item é isento de informações preconceituosas, controversas ou polêmicas.
5.7 O nível de dificuldade indicado ("${dificuldade}") é adequado E decorre da COMPLEXIDADE COGNITIVA REAL exigida (profundidade de análise, número de relações conceituais a articular, grau de interpretação e contextualização) — NUNCA de pistas linguísticas, obscuridade textual, pegadinhas ou alternativas mal construídas. Uma questão fácil é fácil pelo raciocínio simples que exige, não por ter distratores óbvios; uma difícil é difícil pela profundidade exigida, não por ter alternativas mal disfarçadas.
5.8 O item está de acordo com a norma padrão da língua portuguesa e é isento de ambiguidade, dupla interpretação e informações desnecessárias.${criterioExtensao}
5.10 A resposta exige interpretação, análise, comparação, aplicação, inferência ou resolução de problema — nunca memorização direta de um fato isolado.
5.11 TEXTO-BASE NEUTRO E SEM ECO LEXICAL: o texto-base apenas apresenta material para o candidato interpretar; em nenhum momento formula, parafraseia antecipadamente ou sinaliza a conclusão que o comando pede como resposta, nem repete o vocabulário/palavras-chave que aparecem só na alternativa correta (pista por associação lexical). Se entregar a inferência que deveria ser o objeto do raciocínio, ou ecoar vocabulário exclusivo do gabarito, reescreva-o mantendo apenas o material bruto necessário para que a ponte até a resposta seja construída pelo próprio candidato.
5.12 COMANDO NÃO REVELA A ESTRATÉGIA DE RESOLUÇÃO: o comando apresenta a tarefa cognitiva a ser realizada, mas não indica qual conceito, fórmula, dado ou caminho de raciocínio conduz diretamente ao gabarito. Se estiver entregando a estratégia (não apenas o que se pede, mas como chegar lá), reescreva-o de forma mais neutra, preservando a clareza sobre o que está sendo pedido.
5.13 PARIDADE TÉCNICA E DE ELABORAÇÃO: as 5 alternativas têm nível de elaboração e precisão técnica equivalentes — a correta não é a mais longa, mais detalhada ou mais bem redigida, nem os distratores parecem rasos, genéricos ou mal elaborados em comparação com ela. Havendo desequilíbrio, reescreva as mais fracas com o mesmo cuidado técnico da mais forte, sem torná-las corretas.

═══════ ETAPA 3 — SÍNTESE DA REVISÃO ═══════
Se QUALQUER critério das etapas 1 e 2 não for plenamente atendido, REESCREVA o item corrigindo o problema — integralmente quando se tratar de falha fatal (F1-F7) — mantendo o mesmo tema, o mesmo nível de dificuldade e o mesmo recurso visual solicitados. Se todos os critérios já estiverem atendidos, devolva o mesmo item sem alterações. Devolva SEMPRE o item completo no formato JSON especificado ao final, nunca um relatório da revisão.

ITEM A REVISAR:
__DRAFT_JSON__

${JSON_SCHEMA_TXT}`;
}

/* ---------------- Claude API (server-side) ---------------- */

// Códigos de erro transitórios (sobrecarga momentânea, timeout de proxy/CDN entre
// nós de rede e a Anthropic, etc.) — vale a pena tentar de novo automaticamente.
// 524 é o "A timeout occurred" da Cloudflare: acontece quando a resposta da
// Anthropic demora demais para ser entregue por completo, algo que fica bem mais
// provável quando várias questões são geradas ao mesmo tempo (mais carga = respostas
// mais lentas). 429/500/502/503/529 também são transitórios e merecem nova tentativa.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 522, 523, 524, 529]);
const MAX_ATTEMPTS = 4;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Espera exponencial com jitter entre tentativas (0.8s, 1.6s, 3.2s... + até 400ms
// aleatórios) para não martelar a API da Anthropic logo em seguida de uma falha.
function backoffDelay(attempt: number) {
  return Math.min(800 * 2 ** (attempt - 1), 8000) + Math.random() * 400;
}

async function callClaude(system: string, userMsg: string, maxTokens: number, enableWebSearch = false): Promise<{ text: string; truncated: boolean }> {
  let lastErr: any;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const watchdog = setTimeout(() => controller.abort(), 240_000);
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: userMsg }],
          thinking: { type: "disabled" },
          stream: true,
          ...(enableWebSearch ? { tools: [WEB_SEARCH_TOOL] } : {}),
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const rawErr = await resp.text().catch(() => "");
        if (RETRYABLE_STATUS.has(resp.status) && attempt < MAX_ATTEMPTS) {
          lastErr = new Error(`HTTP ${resp.status}`);
          clearTimeout(watchdog);
          await sleep(backoffDelay(attempt));
          continue;
        }
        let msg = "";
        try { const j = rawErr ? JSON.parse(rawErr) : {}; msg = j?.error?.message || ""; } catch { /* corpo não é JSON */ }
        if (!msg) msg = rawErr ? rawErr.slice(0, 300) : `Erro HTTP ${resp.status} ${resp.statusText || ""}`.trim();
        if (resp.status === 401) {
          msg = `Chave de API da Anthropic inválida ou expirada (401) nos secrets deste projeto Supabase. Detalhe: ${msg}`;
        }
        if (resp.status === 524) {
          msg = `A Anthropic demorou demais para responder (524 - timeout de proxy) mesmo após ${attempt} tentativa(s). Detalhe: ${msg}`;
        }
        throw new Error(msg);
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let stopReason: string | null = null;
      let streamErrorMsg: string | null = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;
          let evt: any;
          try { evt = JSON.parse(jsonStr); } catch { continue; }
          if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
            text += evt.delta.text || "";
          } else if (evt.type === "message_delta" && evt.delta?.stop_reason) {
            stopReason = evt.delta.stop_reason;
          } else if (evt.type === "error") {
            streamErrorMsg = evt.error?.message || "Erro reportado pelo streaming da Anthropic.";
          }
        }
      }
      clearTimeout(watchdog);
      if (streamErrorMsg) throw new Error(streamErrorMsg);
      return { text, truncated: stopReason === "max_tokens" };
    } catch (err: any) {
      clearTimeout(watchdog);
      const isAbort = err?.name === "AbortError";
      const isNetwork = err instanceof TypeError;
      if ((isAbort || isNetwork) && attempt < MAX_ATTEMPTS) {
        lastErr = err;
        await sleep(backoffDelay(attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("Falha ao contatar a Anthropic após múltiplas tentativas.");
}

const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 5 };

function sanitizeJsonControlChars(text: string) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === "\\") { out += ch; escaped = true; continue; }
      if (ch === '"') { inString = false; out += ch; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
    } else {
      if (ch === '"') { inString = true; out += ch; continue; }
      out += ch;
    }
  }
  return out;
}

function parseJSONLoose(text: string) {
  const raw = (text || "").trim();
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) candidates.push(raw.slice(start, end + 1));

  let lastErr: any;
  for (const cand of candidates) {
    const variants = [
      cand,
      cand.replace(/,(\s*[}\]])/g, "$1"),
      sanitizeJsonControlChars(cand),
      sanitizeJsonControlChars(cand).replace(/,(\s*[}\]])/g, "$1"),
    ];
    for (const v of variants) {
      try { return JSON.parse(v); } catch (e) { lastErr = e; }
    }
  }
  const preview = raw.slice(0, 220).replace(/\s+/g, " ");
  const detail = lastErr ? lastErr.message : "erro desconhecido";
  throw new Error(`Não foi possível interpretar a resposta do modelo como JSON (${detail}). Início da resposta recebida: "${preview}${raw.length > 220 ? "..." : ""}"`);
}

async function callClaudeForJSON(system: string, userMsg: string, enableWebSearch = false) {
  const { text, truncated } = await callClaude(system, userMsg, 8000, enableWebSearch);
  try {
    return parseJSONLoose(text);
  } catch (err) {
    if (truncated) {
      const retry = await callClaude(system, userMsg, 12000, enableWebSearch);
      return parseJSONLoose(retry.text);
    }
    throw err;
  }
}

/* ---------------- HTTP handler ---------------- */

async function checkDailyCap(): Promise<Response | null> {
  // Sem limite configurado: não consulta o log nem bloqueia nada.
  if (!Number.isFinite(MAX_DAILY_QUESTIONS) || MAX_DAILY_QUESTIONS <= 0) return null;
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await supabase
      .from("question_generation_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);
    if (!countErr && typeof count === "number" && count >= MAX_DAILY_QUESTIONS) {
      return jsonResponse({
        error: `Limite diário de ${MAX_DAILY_QUESTIONS} questões atingido. Tente novamente amanhã, ou aumente MAX_DAILY_QUESTIONS nas configurações do backend.`,
      }, 429);
    }
  } catch (_e) {
    // Se o log falhar por algum motivo, não bloqueia a geração.
  }
  return null;
}

async function logGeneration(area: string, disciplina: string, tema: string) {
  try {
    await supabase.from("question_generation_log").insert({ area, disciplina, tema: tema.slice(0, 200) });
  } catch (_e) {
    // best-effort logging
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não suportado. Use POST." }, 405);
  }
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse({
      error: "Backend não configurado: falta a variável de ambiente ANTHROPIC_API_KEY nos secrets deste projeto Supabase.",
    }, 500);
  }

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "JSON inválido." }, 400); }

  const area = (body.area || "").toString();
  if (!AREA_LABELS[area]) {
    return jsonResponse({ error: `Campo 'area' inválido ou ausente. Use um destes valores: ${Object.keys(AREA_LABELS).join(", ")}.` }, 400);
  }
  const disciplina = (body.disciplina || "").toString().trim();
  if (!disciplina) {
    return jsonResponse({ error: "Campo 'disciplina' é obrigatório (ex.: 'Física', 'História', 'Matemática')." }, 400);
  }
  const dificuldade = ["Fácil", "Médio", "Difícil"].includes(body.dificuldade) ? body.dificuldade : "Médio";
  const tema = (body.tema || "").toString().trim();
  const instrucoesVisual = (body.instrucoesVisual || "").toString().trim().slice(0, 1000);

  if (body.regenerarVisual === true) {
    const recurso = ["imagem", "grafico", "tabela"].includes(body.recurso) ? body.recurso : null;
    if (!recurso) {
      return jsonResponse({ error: "Campo 'recurso' inválido para refazer o recurso visual. Use 'imagem', 'grafico' ou 'tabela'." }, 400);
    }
    const textoBase = (body.textoBase || "").toString();
    const comando = (body.comando || "").toString();
    const gabarito = (body.gabarito || "").toString();
    const resolucaoComentada = (body.resolucaoComentada || "").toString();
    const alternativas = (body.alternativas && typeof body.alternativas === "object") ? body.alternativas : {};

    const capResponse = await checkDailyCap();
    if (capResponse) return capResponse;

    try {
      const system = buildSystemPrompt(area);
      const userMsg = buildVisualRedoPrompt({ tema, recurso, textoBase, comando, alternativas, gabarito, resolucaoComentada, instrucoesVisual });
      const data = await callClaudeForJSON(system, userMsg);
      if (!data || !data.visual) {
        return jsonResponse({ error: "O modelo não retornou um novo recurso visual válido." }, 502);
      }
      await logGeneration(area, disciplina, `[refazer visual] ${tema}`);
      return jsonResponse({ visual: data.visual });
    } catch (err) {
      return jsonResponse({ error: `Erro ao refazer o recurso visual: ${String((err as any)?.message || err)}` }, 502);
    }
  }

  const recurso = ["nenhum", "imagem", "grafico", "tabela"].includes(body.recurso) ? body.recurso : "nenhum";
  const competenciaNum = typeof body.competenciaNum === "number" ? body.competenciaNum : null;
  const habilidadeCod = body.habilidadeCod ? String(body.habilidadeCod) : null;
  const validar = body.validar !== false;

  const capResponse = await checkDailyCap();
  if (capResponse) return capResponse;

  try {
    const system = buildSystemPrompt(area);
    const userMsg = buildUserPrompt({ area, disciplina, tema, dificuldade, recurso, competenciaNum, habilidadeCod, instrucoesVisual });
    const webSearch = precisaFontesReais(disciplina);
    let data = await callClaudeForJSON(system, userMsg, webSearch);

    if (validar) {
      const valPrompt = buildValidationChecklist(disciplina, dificuldade).replace("__DRAFT_JSON__", JSON.stringify(data));
      data = await callClaudeForJSON(system, valPrompt, webSearch);
    }

    await logGeneration(area, disciplina, tema);

    return jsonResponse({ question: data });
  } catch (err) {
    return jsonResponse({ error: `Erro ao gerar questão: ${String((err as any)?.message || err)}` }, 502);
  }
});

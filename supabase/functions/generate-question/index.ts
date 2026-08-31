import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
/* Os dados pedagógicos (Matriz de Referência, contexto por área, modelo universal
   e objetos de conhecimento) vivem no repositório e entram no pacote no momento da
   implantação — não são copiados à mão para dentro da função. O conteúdo é embutido
   pelo empacotador do Deno na hora do deploy, então em produção não há nenhuma
   chamada de rede ao GitHub: o que roda é uma cópia congelada. A conferência de
   integridade (GET ?selftest=1) diz exatamente qual cópia foi carregada. */
import APP_DATA_JSON from "https://raw.githubusercontent.com/Turco2025/Enem/main/supabase/functions/generate-question/app_data.json" with { type: "json" };
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

/* Notação química — a fórmula chega ao estudante pronta, nunca como comando.
   O PDF, o Word e o HTML do aplicativo imprimem Unicode direto; LaTeX ou "H2O"
   chegariam ao papel exatamente assim, e a auditoria do app barra a exportação. */
const NOTACAO_QUIMICA = `

═══════ NOTAÇÃO QUÍMICA — REGRA ABSOLUTA DE FORMATAÇÃO ═══════
Toda fórmula, íon, equação, isótopo ou unidade científica sai PRONTA, em caracteres
Unicode, diretamente legível. Vale para texto-base, comando, tabelas, alternativas,
gabarito, resolução comentada, comentário de cada alternativa e prompt de imagem.

PROIBIDO SEM EXCEÇÃO: LaTeX, KaTeX, MathJax, \\ce{}, \\frac, $...$, _{ }, ^{ },
tags HTML (<sub>, <sup>), entidades HTML, blocos de código, crases, barras
invertidas, chaves de formatação, delimitadores matemáticos, Markdown matemático.
A fórmula aparece como H₂SO₄ — nunca como um comando a ser renderizado depois.

ÍNDICES (quantidade de átomos) em algarismo INFERIOR ₀₁₂₃₄₅₆₇₈₉:
H₂O · CO₂ · NH₃ · CH₄ · H₂SO₄ · H₃PO₄ · Ca(OH)₂ · Al₂O₃ · Fe₂(SO₄)₃ · C₆H₁₂O₆ · C₁₂H₂₂O₁₁
NUNCA: H2O, H 2 O, H²O, Al2(SO4)3. O símbolo do elemento fica no nível da linha.

CARGAS no canto superior direito, NÚMERO ANTES DO SINAL, com ⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻:
Na⁺ · Ca²⁺ · Fe³⁺ · Al³⁺ · Cl⁻ · OH⁻ · NH₄⁺ · NO₃⁻ · SO₄²⁻ · CO₃²⁻ · PO₄³⁻ ·
MnO₄⁻ · Cr₂O₇²⁻ · [Fe(CN)₆]⁴⁻
NUNCA: Ca+2, Ca2+, SO4-2, SO₄-2, SO²⁻₄, ⁺².

COEFICIENTES são números comuns ANTES da fórmula: 2 H₂(g) + O₂(g) → 2 H₂O(l).
Coeficiente nunca vira índice; para balancear não se altera a fórmula (2 H₂O, nunca H₄O₂).

SETAS: → é UM ÚNICO CARACTERE (U+2192). É PROIBIDO montar seta com hífen, sinal de
maior, de menor ou de igual. Nunca escreva -> --> => ==> <- <-> <=> <==> como seta.
Nunca use imagem, emoji ou ícone no lugar do símbolo. Cada seta tem um significado:
→ reação da esquerda para a direita · ← sentido inverso · ⇌ EQUILÍBRIO QUÍMICO ·
↔ ressonância · ↑ desprendimento de gás · ↓ formação de precipitado.
↔ NÃO substitui ⇌. Reagentes antes da seta, produtos depois. Nunca sinal de
igualdade no lugar da seta. Ligação química (–, =, ≡) NÃO é seta de reação.
Estados físicos logo após a fórmula: (s) (l) (g) (aq).
Ex.: AgNO₃(aq) + NaCl(aq) → AgCl(s) + NaNO₃(aq).
Condição de reação (temperatura, pressão, luz, catalisador) vai em frase junto à
equação — não fragmente a seta para encaixá-la, e não trate catalisador como
reagente consumido.

BALANCEAMENTO: toda equação apresentada como completa está balanceada (salvo quando
a própria questão pedir que o estudante balanceie). Conte os átomos dos dois lados,
confira a conservação da massa E da carga, use os menores coeficientes inteiros.
Ex.: 4 Fe(s) + 3 O₂(g) → 2 Fe₂O₃(s).

ORGÂNICA: – ligação simples, = dupla, ≡ tripla. CH₃–CH₃ · CH₂=CH₂ · HC≡CH ·
CH₃–CH₂–OH · CH₃–COOH · CH₃–CO–CH₃. Não altere hidrogênios, grupos ou ligações.
Se a estrutura for complexa demais para representação linear segura, peça fórmula
estrutural em IMAGEM — não invente a estrutura.

ISÓTOPOS: número de massa acima e número atômico abaixo, antes do símbolo —
¹⁴₆C · ²³₁₁Na · ²³⁸₉₂U · ⁴₂He · e⁻ · p⁺ · n⁰ · β⁻. Não inverta os dois.

GRANDEZAS não viram índice nem expoente: 25 °C · 2 mol · 0,5 mol/L · 1,0 atm ·
250 mL · pH 7 · 6,02 × 10²³ · 1,5 × 10⁻³ mol/L. No expoente matemático o sinal vem
antes do número (10⁻³); na carga, depois (Ca²⁺).

CONSISTÊNCIA: a mesma substância mantém a MESMA grafia no texto-base, no comando,
nos dados, na tabela, nas alternativas, no gabarito e na resolução. Maiúscula e
minúscula são significado: Co (cobalto) ≠ CO (monóxido de carbono).

CASOS DE TESTE — a notação de saída tem de sair exatamente assim:
H₂SO₄ · Al₂(SO₄)₃ · SO₄²⁻ · NH₄⁺ · [Fe(CN)₆]⁴⁻ · CuSO₄·5H₂O
2 H₂(g) + O₂(g) → 2 H₂O(l)
N₂(g) + 3 H₂(g) ⇌ 2 NH₃(g)
Ag⁺(aq) + Cl⁻(aq) → AgCl(s)
Zn(s) → Zn²⁺(aq) + 2 e⁻

JSON: as fórmulas ficam como caracteres Unicode normais, em UTF-8, nunca como
código ou sequência de escape.

BLOQUEIO: se uma fórmula não puder ser confirmada com segurança, não invente. Deixe
no campo correspondente o aviso "REVISÃO QUÍMICA NECESSÁRIA: a fórmula ou equação
não pôde ser validada com segurança."`;

function buildSystemPrompt(area: string) {
  return APP_DATA.universalModel + "\n\n" + APP_DATA.areaContext[area] + buildObjetosConhecimento(area) + NOTACAO_QUIMICA;
}

const RECURSO_INSTRUCOES: Record<string, string> = {
  nenhum: `Recurso visual: NENHUM. Não inclua gráfico, tabela ou imagem. Explore a situação-problema apenas por meio do texto-suporte. Deixe o campo "visual" como null e "recurso" como "nenhum".`,
  imagem: `Recurso visual: IMAGEM. A questão deve depender de uma imagem/ilustração pedagogicamente necessária (nunca meramente decorativa) para ser respondida corretamente — por exemplo: esquema anatômico, diagrama de processo, mapa, representação de fenômeno, estrutura, infográfico. Preencha "recurso":"imagem" e "visual" com: {"tipo":"imagem","descricao":"<legenda em português explicando o que a imagem mostra e por que ela é necessária para resolver a questão>","promptImagem":"<especificação técnica em INGLÊS, redigida conforme o PROTOCOLO OBRIGATÓRIO abaixo>"}.

⚠️ PROTOCOLO OBRIGATÓRIO DE ESPECIFICAÇÃO DA IMAGEM
O gerador NÃO conhece a questão, NÃO lê o texto-base, NÃO vê o comando e NÃO infere nada: desenha exatamente e só o que estiver no "promptImagem". Toda ambiguidade vira erro — seta invertida, rótulo no elemento errado, elemento ausente, número ilegível. Portanto o "promptImagem" NÃO é descrição literária nem frase única: é ESPECIFICAÇÃO TÉCNICA COMPLETA, em inglês, elemento por elemento, com posição e direção explícitas, nas 8 seções abaixo, nesta ordem, cada uma com seu título em inglês:

1. SCENE AND VIEWPOINT — o que a figura é, em uma frase, e o ponto de vista exato: front view, side view, top-down view, cross-section, exploded view ou three-quarter view. Declare a orientação absoluta (ex.: "the plant is upright, roots at the bottom, leaves at the top") e o AMBIENTE: por padrão um ambiente real, coerente com a cena, com profundidade e atmosfera (ex.: "shallow tropical reef bathed in shafts of sunlight, softly blurred background"). Reserve deliberadamente uma área visualmente calma (céu, água, parede, fundo desfocado) do lado em que os rótulos vão entrar. Fundo liso ("plain white background") só em esquema puramente técnico: circuito, gráfico de eixos, figura geométrica.

2. ELEMENT INVENTORY — lista numerada de TODOS os elementos, com quantidade explícita ("exactly three test tubes", "one arrow"). O gerador inventa elementos extras; contar reduz isso. Nada fora desta lista pode aparecer.

3. LAYOUT AND POSITION — para CADA elemento, a posição absoluta (left / center / right com top / middle / bottom) E em relação aos vizinhos, com o lado sempre explícito. Ex.: "the beaker sits at the center-bottom; the flame is directly beneath the beaker; the thermometer is inserted from above, tilted about 30 degrees to the right". PROIBIDO escrever só "next to", "near" ou "beside" sem dizer de que lado.

4. ARROWS — a causa mais frequente de erro. Para CADA seta, uma linha própria contendo, nesta ordem: origem, destino, onde fica a ponta (arrowhead), direção na tela e o que representa. Modelo: "One arrow starting at the right edge of the sun and ending at the top surface of the leaf, with the arrowhead touching the leaf and pointing down-left, representing incident sunlight." TERMINANTEMENTE PROIBIDO "an arrow between A and B", "arrows connecting the parts", "arrows showing the cycle" ou qualquer forma sem origem, destino e ponta — sem isso o gerador escolhe o sentido e frequentemente o inverte. Se o SENTIDO for parte do que a questão avalia (fluxo de energia, corrente elétrica, movimento, sentido de reação, cadeia alimentar, ciclo biogeoquímico), repita a direção uma segunda vez, com outras palavras, ao final.

5. TEXT LABELS — para CADA rótulo, escreva: o texto EXATO entre ASPAS SIMPLES, o elemento a que pertence, o lado em que fica e se há linha de chamada. Modelo: the label 'Cloroplasto' placed immediately to the right of the green organelle, connected to it by a thin straight leader line. Use aspas simples em TODA a especificação da imagem — ela viaja dentro de um campo JSON, e aspas duplas não escapadas quebram a resposta inteira. Regras: (a) TODO texto visível deve estar EM PORTUGUÊS, ainda que a especificação esteja em inglês — inclua "all visible text must be rendered exactly as written above, in Portuguese, with correct spelling"; (b) o rótulo fica FORA do contorno do elemento, nunca sobreposto; (c) nem rótulo sem elemento, nem elemento essencial sem rótulo; (d) se dois rótulos correrem risco de se aproximar, declare os lados opostos; (e) declare o tamanho ("labels in a clear sans-serif typeface, large enough to be read when the image is printed at half page width").

6. NUMBERS, SCALES AND MEASUREMENT MARKS — havendo dado referencial (régua ou escala graduada, marcações de altura, distância, tempo, velocidade, temperatura, valores em eixo, unidades), liste os valores EXATOS, onde cada um aparece e de que lado do traço fica impresso. Modelo: "a vertical graduated ruler along the left side, with clearly legible labeled tick marks at 5 m, 10 m, 15 m and 20 m, each number printed to the left of its own tick". Os valores devem ser exatamente os mesmos do texto-base, do comando, das alternativas e da resolução — nunca aproximados nem arredondados de outra forma.

7. STYLE AND LEGIBILITY — a imagem tem DUAS CAMADAS, e as duas são obrigatórias.

   ▸ CAMADA 1 — BASE CINEMATOGRÁFICA (beleza e impacto), no padrão National Geographic, BBC Earth, Planet Earth e IMAX. Peça, em inglês: "ultra-realistic 4K/8K photography, ultra definition, razor-sharp focus on the subject, cinematic composition, dramatic directional natural lighting, rich material textures and micro-detail, deep saturated color, atmospheric depth of field, epic sense of scale and grandeur, museum-quality documentary photography". Bonita, imponente e memorável — nunca chapada, genérica, borrada ou pixelizada.

   ▸ CAMADA 2 — CAMADA DE ANOTAÇÃO (precisão). Por cima da cena, camada vetorial limpa com as setas (seção 4), os rótulos (seção 5) e as marcações (seção 6), em princípios de UI/UX: hierarquia visual clara, tipografia sans-serif de tamanhos consistentes, mesma cor para o mesmo tipo de elemento, espaçamento generoso, contraste garantido contra o que está atrás. Peça, em inglês: "clean vector annotation overlay in modern UI/UX infographic style, consistent labeling system, clear visual hierarchy, high contrast between annotation and background, thin leader lines, subtle translucent backing plates or soft halo behind text wherever the scene behind it is busy".

   ▸ REGRA DE PRECEDÊNCIA (não negociável): a Camada 1 NUNCA prejudica a Camada 2. Se a cena ameaçar a leitura de um número, rótulo ou seta, a cena cede — menos detalhe, área escurecida/desfocada atrás da anotação, ou mais espaço. Declare no prompt, em inglês: "the cinematic scene must never obscure the annotation layer; every label, arrow and numeric mark must remain fully legible". Uma imagem deslumbrante com a régua ilegível é uma imagem inútil para a questão.

   ▸ FIDELIDADE: o esplendor jamais custa exatidão. A cena reflete EXATAMENTE a situação-problema — mesmo objeto, mesmo processo, mesmo momento, mesmos valores. PROIBIDO acrescentar elementos espetaculares alheios à questão (relâmpagos, erupções, fauna extra, luz impossível) só para impressionar: tudo que a questão não previu vira ruído ou erro conceitual.

8. NEGATIVE CONSTRAINTS — encerre listando o que NÃO pode aparecer: "no decorative text, no watermark, no signature, no caption bar, no extra arrows, no additional objects beyond those listed above, no duplicated labels, no cropped or cut-off elements, no text in any language other than Portuguese, no flat clipart or generic cartoon style, no blurry, pixelated or low-detail rendering, no annotation hidden or obscured by the scene".

VERIFICAÇÃO ANTES DE ENTREGAR: releia a "descricao", o texto-base, o comando, as alternativas e a resolução e confirme que (i) todo elemento citado como visível consta do ELEMENT INVENTORY; (ii) toda seta tem origem, destino, ponta e direção na seção ARROWS; (iii) todo rótulo tem texto exato, elemento dono e lado; (iv) todo número citado na questão aparece com o MESMO valor na seção NUMBERS; (v) nada foi afirmado na "descricao" que não esteja especificado. Nunca descreva na "descricao" um dado que não esteja visível na imagem, nem deixe na imagem um dado essencial que a "descricao" não mencione.`,

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
No campo "comentario" de cada alternativa errada, nomeie explicitamente o tipo de distrator (leitura parcial, inversão de causa/efeito, verdade parcial, anacronismo/confusão conceitual, senso comum, erro de processo, excesso de escopo, reaproveitamento fora de contexto) e explique EM TERMOS CONCEITUAIS o raciocínio equivocado que ela representa — nunca justifique a incorreção apenas apontando que a alternativa usa uma palavra absoluta/extrema; a palavra não é o motivo do erro, o raciocínio é. Nunca deixe mais de uma alternativa com status "correta".

REGRA DE FORMATAÇÃO DO JSON — vale para TODOS os campos de texto, e o campo "promptImagem" é o mais sensível porque cita o texto dos rótulos:
- prefira ASPAS SIMPLES dentro dos textos; se precisar mesmo de uma aspa dupla, escape-a como \\" ;
- nada de LaTeX nem de barra invertida solta: escreva "2π vezes a raiz quadrada de (L/g)", nunca "2\\pi\\sqrt{L/g}";
- nada de quebra de linha literal dentro de uma string (use \\n);
- nada de vírgula sobrando antes de } ou ].

COMO ENTREGAR: chame a ferramenta "entregar_questao" passando esse objeto como argumento. Não escreva o JSON no texto da resposta, não use crases e não escreva nada antes ou depois da chamada da ferramenta.`;

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

// Posição do gabarito: o professor reserva, antes de gerar, qual letra é a
// correta em cada questão, de modo que em cada bloco de cinco questões
// consecutivas as cinco letras apareçam uma única vez.
function buildGabaritoAlvo(L: string | null) {
  if (!L) return "";
  return `
⛔ POSIÇÃO OBRIGATÓRIA DO GABARITO — a alternativa correta desta questão DEVE ser a letra ${L}. O campo "gabarito" do JSON tem de vir exatamente "${L}", e a alternativa ${L} tem de ser a única defensável como correta.

Como cumprir sem quebrar nenhuma outra regra:
1. Escreva a correta e os quatro distratores, cada um com o seu erro de raciocínio específico.
2. Distribua-os de modo que a correta caia em ${L} RESPEITANDO a ordem lógica exigida pelo Guia do Inep: numéricas em ordem crescente, as demais da mais curta para a mais longa. Se a ordem lógica empurrar a correta para outra posição, REESCREVA os valores ou a redação dos distratores (nunca a correta) até que ordem lógica e posição ${L} coincidam.
3. NUNCA troque as alternativas de lugar no fim: uma lista de números fora de ordem crescente denuncia a manipulação.
4. A correta em ${L} continua não podendo ser mais longa, mais completa nem mais bem redigida que os distratores (regra 4.4).
5. Se ainda assim for impossível, escolha OUTRO recorte de conteúdo para a questão em vez de entregar o gabarito em posição diferente.

Motivo: gabaritos repetidos em sequência deixam o candidato acertar por padrão, não por domínio da habilidade — e destroem a validade do simulado.
`;
}

function buildUserPrompt(opts: {
  area: string; disciplina: string; tema: string; dificuldade: string;
  recurso: string; competenciaNum: number | null; habilidadeCod: string | null;
  instrucoesVisual?: string; gabaritoAlvo?: string | null;
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
${buildGabaritoAlvo(opts.gabaritoAlvo || null)}
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

⚠️ REGRA ABSOLUTA DE ASSUNTO: o novo recurso visual tem de retratar EXATAMENTE o mesmo objeto, cenário, disciplina e fenômeno do texto-suporte/comando/resolução comentada abaixo — nunca outro tema, ainda que visualmente parecido (ex.: se a questão é de Matemática sobre um caixa eletrônico, a imagem tem de mostrar um caixa eletrônico, nunca uma cena de física, trânsito ou qualquer outro assunto). Antes de entregar, releia o "promptImagem"/"descricao" (ou os dados do gráfico/tabela) e confirme, item por item, que cada elemento pertence à mesma situação-problema descrita abaixo.

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

Entregue o resultado chamando a ferramenta "entregar_visual", com um único argumento neste formato:
{"visual": <objeto do recurso visual, no formato de "visual" instruído acima>}
Não escreva o JSON no texto da resposta e não escreva nada antes ou depois da chamada da ferramenta.`;
}

// AUDITORIA FINAL DE COERÊNCIA DA IMAGEM — passo obrigatório, executado depois
// que o texto da questão já está TOTALMENTE FINALIZADO (rascunho + validação
// pedagógica, quando ligada). É uma chamada dedicada, com uma única tarefa,
// para que a checagem de assunto da imagem não fique diluída entre os 35
// critérios da Ficha de Revisão: aqui o modelo só tem uma pergunta para
// responder — a cena da imagem é EXATAMENTE a mesma situação-problema do
// texto finalizado, ou não? — e, sendo "não", é obrigado a reescrever a
// especificação inteira a partir do zero, usando como referência apenas o
// texto já pronto (nunca a especificação antiga, que pode estar viesada).
function buildImageFinalPass(opts: {
  tema: string; disciplina: string; textoBase: string; comando: string;
  alternativas: Record<string, string>; gabarito: string; resolucaoComentada: string;
  descricaoAtual: string; promptImagemAtual: string;
}) {
  return `A questão de vestibular abaixo (padrão ENEM, disciplina ${opts.disciplina}) já está com o texto-suporte, o comando, as alternativas, o gabarito e a resolução comentada TOTALMENTE FINALIZADOS e aprovados — não altere absolutamente nada disso. Sua ÚNICA tarefa agora, como AUDITOR DE COERÊNCIA DE IMAGEM, é decidir se a especificação de imagem abaixo retrata EXATA e ESTRITAMENTE o mesmo objeto, cenário, disciplina e fenômeno desta questão — nunca outro assunto, ainda que visualmente parecido ou vagamente relacionado (ex.: uma questão de Matemática sobre determinantes/matrizes NUNCA pode vir acompanhada de uma imagem de usina hidrelétrica, painel de calibração industrial, ponte estaiada ou qualquer outra cena que não seja a situação-problema real descrita abaixo).

QUESTÃO FINALIZADA (contexto fixo — não repita nem altere nada disto na sua resposta):
Tema: ${opts.tema}
Texto-suporte: ${opts.textoBase}
Comando: ${opts.comando}
Alternativas: ${JSON.stringify(opts.alternativas)}
Gabarito: ${opts.gabarito}
Resolução comentada: ${opts.resolucaoComentada}

ESPECIFICAÇÃO DE IMAGEM ATUALMENTE PROPOSTA (pode estar certa ou pode estar errada — audite com desconfiança, não aprove por hábito):
descricao: ${opts.descricaoAtual}
promptImagem: ${opts.promptImagemAtual}

PROCEDIMENTO OBRIGATÓRIO:
1. Releia SOMENTE a questão finalizada acima (ignore a especificação proposta neste primeiro momento) e determine, em termos concretos e específicos, qual é o ÚNICO objeto/cenário/fenômeno real que uma imagem correta teria de retratar para ESTA questão (ex.: "um caixa eletrônico com teclado numérico em ambiente de agência bancária", nunca uma categoria genérica como "tecnologia" ou "um cenário urbano").
2. Só agora compare, elemento por elemento, com a especificação proposta acima. Se QUALQUER elemento central da cena proposta pertencer a outro objeto, cenário, disciplina ou situação-problema — mesmo que visualmente relacionado, mesmo que "poderia ilustrar um tema parecido" — a especificação está ERRADA.
3. Havendo erro (ou qualquer dúvida razoável), descarte a especificação proposta por completo e escreva uma especificação NOVA do zero, seguindo à risca o protocolo obrigatório de 8 seções abaixo.
4. Se, e somente se, a especificação proposta já retratar corretamente a mesma situação-problema em TODOS os aspectos, devolva-a exatamente como está (sem reescrevê-la por reescrever).

${RECURSO_INSTRUCOES.imagem}

Chame a ferramenta "auditar_imagem" com um único argumento: {"aprovado": true ou false (true somente se a especificação original já estava correta e foi devolvida sem reescrita), "descricao": "<descrição final, em português, da imagem que de fato será entregue>", "promptImagem": "<especificação técnica final, em inglês, conforme o protocolo, da imagem que de fato será entregue>"}. Não escreva nada fora da chamada da ferramenta.`;
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
F5. Há recurso visual (gráfico/tabela/imagem) ilegível, incoerente com o enunciado, meramente decorativo, ou cujos dados não sustentam a resolução comentada. ISTO INCLUI, em especial, QUALQUER IMAGEM CUJO ASSUNTO/CENA PERTENÇA A OUTRO TEMA, OUTRA DISCIPLINA OU OUTRO FENÔMENO diferente do que o texto-base, o comando e a resolução comentada de fato descrevem — por exemplo, uma questão de Matemática sobre operação bancária/caixa eletrônico acompanhada de uma imagem de radar de trânsito/física, ou uma questão de Biologia sobre célula acompanhada de uma imagem de astronomia. Esse tipo de incoerência de ASSUNTO (não só de detalhe) é uma FALHA FATAL: releia o "promptImagem" e a "descricao" do zero e confirme, palavra por palavra, que TODO objeto, cenário e grandeza neles descritos é o mesmo objeto, cenário e grandeza do texto-base/comando/resolução — nada de outro domínio do conhecimento, nada de outra situação-problema, ainda que visualmente relacionado ou "parecido". Havendo qualquer dúvida, reescreva o "promptImagem" inteiro a partir da situação-problema real antes de aprovar o item.
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
2.4 Havendo imagem/gráfico/tabela, é pertinente, de boa qualidade, legível e efetivamente necessária à resolução (nunca decorativa); todo dado citado como visível está de fato representado. AUDITORIA GEOMÉTRICA DO "promptImagem" (quando o recurso for imagem): a especificação traz as 8 seções obrigatórias do protocolo; CADA seta declara ponto de origem, ponto de destino, posição da ponta e direção na tela — nenhuma seta genérica do tipo "arrow between A and B"; CADA rótulo traz o texto exato entre aspas, o elemento a que pertence e o lado em que fica, e todo texto visível está em português; CADA número citado no texto-base, no comando, nas alternativas ou na resolução comentada aparece com o MESMO valor na especificação da imagem; não há elemento essencial sem rótulo nem rótulo sem elemento. A especificação traz as DUAS CAMADAS da seção 7 e a regra de precedência. E a cena corresponde EXATAMENTE à situação-problema: nenhum elemento espetacular acrescentado só por impacto visual, nada contradizendo o texto-base, o comando ou a resolução. Se qualquer um desses pontos falhar, REESCREVA o "promptImagem" completo seguindo o protocolo, sem alterar o conteúdo pedagógico do item.
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
4.5 Se foi exigida uma POSIÇÃO OBRIGATÓRIA do gabarito, a alternativa correta está exatamente nessa letra e a ordem lógica das alternativas continua respeitada. Se não estiver, reescreva os distratores até que as duas coisas valham ao mesmo tempo — nunca entregue o gabarito em outra posição.
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
5.9 NOTAÇÃO QUÍMICA: toda fórmula, íon, equação, isótopo e unidade aparece pronta em Unicode — índices em ₀₁₂₃₄₅₆₇₈₉, cargas em ⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ com o número ANTES do sinal (Ca²⁺, SO₄²⁻, jamais Ca2+ ou Ca+2), coeficientes como número comum antes da fórmula, estados físicos (s)(l)(g)(aq), equações balanceadas com massa e carga conservadas, e a MESMA grafia da substância no texto-base, nas alternativas, no gabarito e na resolução. Nenhum LaTeX, tag, cifrão, chave, barra invertida ou bloco de código. Se encontrar H2O, CO2, Ca2+, \\ce{} ou similar, REESCREVA a questão inteira com a notação correta antes de devolver.
5.9.1 SETAS QUÍMICAS: cada seta é um caractere Unicode único e com significado próprio — → reação, ← sentido inverso, ⇌ equilíbrio, ↔ ressonância, ↑ gás, ↓ precipitado. Se encontrar QUALQUER seta montada com caracteres separados (-> --> => ==> <- <-> <=> <==>), substitua pelo símbolo correto do processo. Se encontrar ↔ funcionando como equilíbrio entre espécies com estado físico, troque por ⇌. Ligações químicas (–, =, ≡) permanecem ligações e nunca viram setas.
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

async function callClaude(system: string, userMsg: string, maxTokens: number, enableWebSearch = false, ferramenta: any = null): Promise<{ text: string; truncated: boolean; usage: any; ferramentaJSON: string }> {
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
          /* CACHE DE PROMPT. O prompt do sistema (modelo universal + contexto da
             área + objetos de conhecimento + notação química) passa de 25 mil
             caracteres e é IDÊNTICO em todas as questões da mesma área — e ainda
             se repete na chamada de revisão. Marcado assim, a Anthropic guarda o
             processamento dele por alguns minutos: da segunda chamada em diante
             ele é lido do cache, a uma fração do preço e sem ser reprocessado.
             A resposta devolve os números de cache no campo "uso", para que dê
             para conferir que está valendo em vez de supor. */
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: userMsg }],
          thinking: { type: "disabled" },
          /* EFFORT FIXO EM "medium" PARA TODA E QUALQUER CHAMADA AO SONNET 5.
             Isto é intencional e definitivo: não deve variar por disciplina,
             por tipo de chamada (rascunho, validação pedagógica, auditoria de
             imagem) nem por qualquer outra condição. Não tornar configurável
             por env var, header, ou parâmetro de request — o pedido foi para
             fixar em "medium" sempre, sem hipótese de subir nem descer. */
          output_config: { effort: "medium" },
          stream: true,
          ...(() => {
            const tools = [
              ...(enableWebSearch ? [WEB_SEARCH_TOOL] : []),
              ...(ferramenta ? [ferramenta] : []),
            ];
            if (!tools.length) return {};
            /* Sem busca na web, a entrega pela ferramenta é obrigatória — não há
               por que deixar espaço para prosa. Com busca ligada, a escolha fica
               automática: o modelo precisa poder pesquisar ANTES de entregar. */
            const tool_choice = ferramenta && !enableWebSearch
              ? { type: "tool", name: ferramenta.name }
              : { type: "auto" };
            return { tools, tool_choice };
          })(),
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
      let usage: any = null;
      // Argumento da NOSSA ferramenta, montado pedaço a pedaço pelo streaming.
      // A busca na web também é uma ferramenta, então filtramos pelo nome.
      let ferramentaJSON = "";
      let blocoEhNossaFerramenta = false;
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
          if (evt.type === "message_start") {
            usage = { ...(evt.message?.usage || {}) };
          } else if (evt.type === "content_block_start") {
            const bloco = evt.content_block || {};
            blocoEhNossaFerramenta = bloco.type === "tool_use" && !!ferramenta && bloco.name === ferramenta.name;
          } else if (evt.type === "content_block_stop") {
            blocoEhNossaFerramenta = false;
          } else if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
            text += evt.delta.text || "";
          } else if (evt.type === "content_block_delta" && evt.delta?.type === "input_json_delta") {
            if (blocoEhNossaFerramenta) ferramentaJSON += evt.delta.partial_json || "";
          } else if (evt.type === "message_delta") {
            if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
            if (evt.usage) usage = { ...(usage || {}), ...evt.usage };
          } else if (evt.type === "error") {
            streamErrorMsg = evt.error?.message || "Erro reportado pelo streaming da Anthropic.";
          }
        }
      }
      clearTimeout(watchdog);
      if (streamErrorMsg) throw new Error(streamErrorMsg);
      return { text, truncated: stopReason === "max_tokens", usage, ferramentaJSON };
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

/* ENTREGA POR FERRAMENTA, NÃO POR TEXTO LIVRE.

   Durante muito tempo a questão voltava como texto e era interpretada aqui.
   Isso funciona quase sempre — e falha justamente nas questões mais ricas: uma
   aspa não escapada dentro do texto-base, um prefácio em prosa antes do JSON,
   um rascunho abandonado quando o modelo decide pesquisar no meio da resposta.
   Cada um desses casos custou uma questão perdida ao professor.

   Pedindo a resposta como CHAMADA DE FERRAMENTA, o JSON deixa de ser texto que
   o modelo escreve e passa a ser argumento que a API monta e valida: aspas,
   escapes e fechamento de chaves deixam de ser problema nosso. A leitura do
   texto continua existindo logo abaixo, como plano B, para o caso de o modelo
   responder em prosa mesmo assim. */
const FERRAMENTA_QUESTAO = {
  name: "entregar_questao",
  description: "Entrega a questão pronta. Use SEMPRE esta ferramenta para devolver a questão — nunca escreva o JSON no texto da resposta.",
  input_schema: {
    type: "object",
    properties: {
      area: { type: "string" },
      disciplina: { type: "string" },
      tema: { type: "string" },
      dificuldade: { type: "string" },
      competencia: { type: "object" },
      habilidade: { type: "object" },
      objetoConhecimento: { type: "string" },
      recurso: { type: "string" },
      visual: {},
      textoBase: { type: "string" },
      comando: { type: "string" },
      alternativas: { type: "object" },
      gabarito: { type: "string" },
      resolucaoComentada: { type: "string" },
      analiseAlternativas: { type: "object" },
    },
    required: [
      "area", "disciplina", "tema", "dificuldade", "competencia", "habilidade",
      "objetoConhecimento", "recurso", "textoBase", "comando", "alternativas",
      "gabarito", "resolucaoComentada", "analiseAlternativas",
    ],
  },
};

const FERRAMENTA_VISUAL = {
  name: "entregar_visual",
  description: "Entrega apenas a nova versão do recurso visual da questão.",
  input_schema: {
    type: "object",
    properties: { visual: {} },
    required: ["visual"],
  },
};

const FERRAMENTA_AUDITORIA_IMAGEM = {
  name: "auditar_imagem",
  description: "Entrega o veredito da auditoria de coerência da imagem e a especificação final (mantida ou reescrita) que de fato será usada.",
  input_schema: {
    type: "object",
    properties: {
      aprovado: { type: "boolean" },
      descricao: { type: "string" },
      promptImagem: { type: "string" },
    },
    required: ["aprovado", "descricao", "promptImagem"],
  },
};

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

/* ASPAS SOLTAS DENTRO DE UM CAMPO DE TEXTO.

   Era a causa da falha "Expected ',' or '}' after property value", e ela tinha
   origem concreta: o protocolo da imagem pedia o texto de cada rótulo entre
   aspas duplas — `the label "Comprimento (L)" placed to the left…` — e essa
   especificação inteira viaja dentro do campo JSON "promptImagem". Quando o
   modelo esquecia de escapá-las, o JSON.parse fechava a string cedo e a questão
   inteira se perdia. O protocolo passou a pedir aspas simples, o que remove a
   causa; esta função é a rede embaixo, porque uma citação entre aspas no
   texto-base ou uma frase em inglês copiada de outra seção reabrem o mesmo
   buraco.

   A regra de decisão: dentro de uma string, uma aspa só ENCERRA de verdade se
   o próximo caractere não-branco for `}`, `]` ou o fim do texto — ou uma
   vírgula seguida do começo de um novo valor (`"`, `{`, `[`). Qualquer outra
   coisa depois dela é continuação do texto, então a aspa é escapada. É por
   isso que `"o professor disse "não depende da massa", e os alunos…"` é
   recuperado corretamente: a aspa antes da vírgula é seguida de ` e`, não de
   uma nova chave.

   Um caso à parte é o `:` depois da aspa. Ele só indica fim de CHAVE — nunca
   fim de um VALOR — porque em JSON válido um dois-pontos jamais segue o valor
   de uma propriedade (só a chave). Tratar todo `"` seguido de `:` como fim de
   string quebrava exatamente o caso que motivou o reparo pelo schema: um
   título citado dentro de um campo de texto, com outro dois-pontos mais
   adiante na mesma frase — `citado por Hilário Franco Jr. em "As Cruzadas" —
   fonte real, acadêmica: amplamente usada em vestibulares` fecharia a string
   ali por engano. Por isso a aspa só é tratada como fim de CHAVE quando a
   PRÓPRIA STRING começou em posição de chave: logo depois de `{` ou de `,`
   (ignorando espaços) — nunca no meio do valor de outro campo. */
function escaparAspasSoltas(text: string) {
  let out = "";
  let inString = false;
  let escaped = false;
  let inicioString = -1;
  const proximoNaoBranco = (de: number) => {
    let k = de;
    while (k < text.length && /\s/.test(text[k])) k++;
    return { ch: k < text.length ? text[k] : "", i: k };
  };
  const anteriorNaoBranco = (de: number) => {
    let k = de;
    while (k >= 0 && /\s/.test(text[k])) k--;
    return k >= 0 ? text[k] : "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) { out += ch; if (ch === '"') { inString = true; inicioString = i; } continue; }
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === "\\") { out += ch; escaped = true; continue; }
    if (ch !== '"') { out += ch; continue; }
    const depois = proximoNaoBranco(i + 1);
    let encerra: boolean;
    if (depois.ch === "" || depois.ch === "}" || depois.ch === "]") {
      encerra = true;
    } else if (depois.ch === ",") {
      const seguinte = proximoNaoBranco(depois.i + 1);
      encerra = seguinte.ch === '"' || seguinte.ch === "{" || seguinte.ch === "[" || seguinte.ch === "";
    } else if (depois.ch === ":") {
      const antes = anteriorNaoBranco(inicioString - 1);
      encerra = antes === "{" || antes === ",";
    } else {
      encerra = false;
    }
    if (encerra) { out += ch; inString = false; } else { out += '\\"'; }
  }
  return out;
}

/* Barra invertida que não inicia um escape válido. Aparece quando o modelo
   escorrega para notação de LaTeX no meio de uma explicação de física ou de
   matemática (`T = 2\pi\sqrt{L/g}`): `\p` e `\s` não são escapes de JSON. */
function escaparBarrasInvalidas(text: string) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) { out += ch; if (ch === '"') inString = true; continue; }
    if (ch === '"') { out += ch; inString = false; continue; }
    if (ch === "\\") {
      const p = text[i + 1] || "";
      if ('"\\/bfnrtu'.includes(p)) { out += ch + p; i++; continue; }
      out += "\\\\";
      continue;
    }
    out += ch;
  }
  return out;
}

/* REPARO GUIADO PELO SCHEMA — o último recurso, e o mais confiável dos três.

   As duas funções acima decidem caractere a caractere, e por isso têm pontos
   cegos. O pior deles: um texto que cita duas coisas entre aspas seguidas —
   `a "Cruzada dos Nobres", "Cruzada Popular" e outras` — tem uma aspa interna
   seguida de vírgula e de nova aspa, exatamente o desenho de quem fecha um
   valor e abre a próxima chave. Nenhuma regra local distingue os dois casos.

   O que distingue é o SCHEMA: sabemos os nomes dos campos e a ordem deles. O
   valor de um campo de texto vai do sinal de dois-pontos até onde COMEÇA o
   próximo campo conhecido — e tudo que estiver no meio é texto, aspas
   inclusive. Campos cujo valor é objeto (competencia, alternativas, visual…)
   passam intactos: não se mexe no que não está quebrado. */
const CHAVES_DO_SCHEMA = [
  "area", "disciplina", "tema", "dificuldade", "competencia", "numero", "codigo",
  "habilidade", "objetoConhecimento", "recurso", "visual", "tipo", "descricao",
  "promptImagem", "chartType", "titulo", "labels", "datasets", "colunas", "linhas",
  "textoBase", "comando", "alternativas", "gabarito", "resolucaoComentada",
  "analiseAlternativas", "status", "comentario", "texto", "data", "label",
  "A", "B", "C", "D", "E",
];
const CHAVES_DO_SCHEMA_SET = new Set(CHAVES_DO_SCHEMA);

function escaparConteudoDeString(bruto: string) {
  return bruto
    .replace(/\\(?!["\\/bfnrtu])/g, "\\\\")
    .replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
    .replace(/(?<!\\)"/g, '\\"');
}

/* Cada objeto de primeiro nível fechado corretamente, do maior para o menor. */
function objetosBalanceados(text: string): string[] {
  const achados: string[] = [];
  let inString = false, escaped = false, profundidade = 0, inicio = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") { if (profundidade === 0) inicio = i; profundidade++; continue; }
    if (ch === "}") {
      profundidade--;
      if (profundidade === 0 && inicio >= 0) { achados.push(text.slice(inicio, i + 1)); inicio = -1; }
      if (profundidade < 0) profundidade = 0;
    }
  }
  return achados.sort((a, b) => b.length - a.length);
}

function repararPeloSchema(text: string) {
  // Onde cada campo conhecido começa: a aspa de abertura do NOME do campo.
  // Versão solta — aceita qualquer ocorrência de `"chave":`, mesmo que a
  // palavra apareça citada dentro do valor de OUTRO campo (ver a versão
  // estrita, abaixo, para o reparo que evita esse falso positivo).
  const marcas: number[] = [];
  const re = /"([A-Za-z][A-Za-z0-9_]*)"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (CHAVES_DO_SCHEMA_SET.has(m[1])) marcas.push(m.index);
  }
  return repararComMarcas(text, marcas);
}

/* VERSÃO ESTRITA DO REPARO PELO SCHEMA.

   A versão solta acima tem seu próprio ponto cego: palavras genéricas da
   lista de chaves — "texto", "status", "label", "data", "comentario" — podem
   aparecer citadas, entre aspas e seguidas de dois-pontos, dentro do valor de
   OUTRO campo (uma citação, uma observação em prosa). Quando isso acontece, a
   versão solta marca um limite de campo que não existe e corta o valor real
   no lugar errado.

   Esta versão só aceita uma ocorrência como limite de campo se a aspa de
   abertura do NOME estiver, ela mesma, em posição de chave: logo depois de
   `{` (primeiro campo do objeto) ou de `,` (campo seguinte), ignorando
   espaços. Nenhuma chave real de JSON aparece em outro lugar — então esse
   filtro nunca descarta um campo verdadeiro, só os falsos positivos. */
function repararPeloSchemaEstrito(text: string) {
  const marcas: number[] = [];
  const re = /"([A-Za-z][A-Za-z0-9_]*)"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!CHAVES_DO_SCHEMA_SET.has(m[1])) continue;
    let k = m.index - 1;
    while (k >= 0 && /\s/.test(text[k])) k--;
    const antes = k >= 0 ? text[k] : "";
    if (antes === "{" || antes === ",") marcas.push(m.index);
  }
  return repararComMarcas(text, marcas);
}

function repararComMarcas(text: string, marcas: number[]) {
  if (marcas.length < 2) return text;

  let saida = "";
  let cursor = 0;
  for (let i = 0; i < marcas.length; i++) {
    const inicioChave = marcas[i];
    const fimDoTrecho = i + 1 < marcas.length ? marcas[i + 1] : text.length;
    const trecho = text.slice(inicioChave, fimDoTrecho);
    const doisPontos = trecho.indexOf(":", trecho.indexOf('"', 1) + 1);
    if (doisPontos < 0) continue;
    const nome = trecho.slice(0, doisPontos + 1);
    let valor = trecho.slice(doisPontos + 1);

    // O que vem depois do valor e antes da próxima chave (vírgula, chaves de
    // fechamento, espaços) fica de fora do conserto e é copiado como está.
    const abre = valor.indexOf('"');
    const soAntes = valor.slice(0, abre < 0 ? valor.length : abre);
    if (abre < 0 || soAntes.trim() !== "") {
      // valor não é string (objeto, lista, número, null) — passa intacto
      saida += text.slice(cursor, fimDoTrecho);
      cursor = fimDoTrecho;
      continue;
    }
    const fecha = valor.lastIndexOf('"');
    if (fecha <= abre) { saida += text.slice(cursor, fimDoTrecho); cursor = fimDoTrecho; continue; }
    const miolo = valor.slice(abre + 1, fecha);
    const rabo = valor.slice(fecha + 1);
    saida += text.slice(cursor, inicioChave) + nome + soAntes + '"' + escaparConteudoDeString(miolo) + '"' + rabo;
    cursor = fimDoTrecho;
  }
  saida += text.slice(cursor);
  return saida;
}

function parseJSONLoose(text: string) {
  const raw = (text || "").trim();
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) candidates.push(raw.slice(start, end + 1));
  /* Com a busca na web ligada, o modelo às vezes começa o JSON, decide
     pesquisar e recomeça do zero — sobram dois objetos na mesma resposta, e o
     recorte "da primeira chave à última" junta o rascunho abandonado com o bom.
     Por isso cada objeto BALANCEADO também entra como candidato, do maior para
     o menor: o completo costuma ser o último e o maior. */
  for (const bloco of objetosBalanceados(raw)) candidates.push(bloco);

  const semVirgulaFinal = (v: string) => v.replace(/,(\s*[}\]])/g, "$1");

  let lastErr: any;
  for (const cand of candidates) {
    /* Do mais literal ao mais reparado. A tentativa sem reparo nenhum vem
       sempre primeiro: reparo só entra quando o texto já está quebrado, então
       uma resposta bem-formada nunca passa por essas funções. */
    const variantes: string[] = [];
    for (const base of [cand, sanitizeJsonControlChars(cand)]) {
      const aspas = escaparAspasSoltas(base);
      const barras = escaparBarrasInvalidas(base);
      const ambos = escaparBarrasInvalidas(aspas);
      // O reparo pelo schema entra tanto no texto cru quanto no já corrigido
      // por escaparAspasSoltas: a correção de aspas soltas costuma limpar
      // aspas falsas que, de outro modo, o schema poderia confundir com um
      // limite de campo — as duas passagens juntas cobrem mais casos do que
      // cada uma sozinha.
      const peloSchema = repararPeloSchema(base);
      const peloSchemaEstrito = repararPeloSchemaEstrito(base);
      const peloSchemaDeAspas = repararPeloSchema(aspas);
      const peloSchemaEstritoDeAspas = repararPeloSchemaEstrito(aspas);
      for (const v of [base, aspas, barras, ambos, peloSchema, peloSchemaEstrito, peloSchemaDeAspas, peloSchemaEstritoDeAspas]) {
        variantes.push(v, semVirgulaFinal(v));
      }
    }
    for (const v of variantes) {
      try { return JSON.parse(v); } catch (e) { lastErr = e; }
    }
  }
  const preview = raw.slice(0, 180).replace(/\s+/g, " ");
  const detail = lastErr ? lastErr.message : "erro desconhecido";
  /* Sem um pedaço do texto NO PONTO da falha, cada erro destes vira uma
     investigação às cegas. A janela abaixo mostra o defeito em vez de descrevê-lo. */
  const posicao = Number((lastErr?.message || "").match(/position (\d+)/)?.[1] ?? -1);
  const janela = posicao >= 0
    ? ` Trecho ao redor da falha: …${raw.slice(Math.max(0, posicao - 130), posicao + 130).replace(/\s+/g, " ")}…`
    : "";
  throw new Error(`Não foi possível interpretar a resposta do modelo como JSON (${detail}). Resposta com ${raw.length} caracteres, iniciando em: "${preview}${raw.length > 180 ? "..." : ""}".${janela}`);
}

/* O argumento da ferramenta chega pronto e válido. Ainda assim ele passa por
   JSON.parse: um objeto vazio ou um pedaço truncado por limite de tokens não
   pode ser confundido com uma questão. Devolvendo null, o caminho de texto
   assume. */
function lerFerramenta(bruto: string): any | null {
  const t = (bruto || "").trim();
  if (!t) return null;
  try {
    const obj = JSON.parse(t);
    if (obj && typeof obj === "object" && Object.keys(obj).length) return obj;
  } catch { /* veio incompleto — segue pelo texto */ }
  return null;
}

async function callClaudeForJSON(system: string, userMsg: string, enableWebSearch = false, usos?: any[], ferramenta: any = FERRAMENTA_QUESTAO) {
  const primeira = await callClaude(system, userMsg, 8000, enableWebSearch, ferramenta);
  const { text, truncated, usage } = primeira;
  if (usos && usage) usos.push(usage);
  // Caminho normal: a resposta veio como argumento de ferramenta, já válido.
  const daFerramenta = lerFerramenta(primeira.ferramentaJSON);
  if (daFerramenta) return daFerramenta;
  try {
    return parseJSONLoose(text);
  } catch (err: any) {
    /* Resposta cortada no meio: o problema é espaço, então repete com teto
       maior. Resposta completa porém malformada: o problema é a redação do
       JSON, então repete DIZENDO qual foi o erro — sem isso a segunda
       tentativa costuma reproduzir o mesmo defeito. Em ambos os casos é uma
       chamada a mais só quando já se perdeu a questão; o caminho feliz
       continua com uma chamada só. */
    if (truncated) {
      const retry = await callClaude(system, userMsg, 12000, enableWebSearch, ferramenta);
      if (usos && retry.usage) usos.push(retry.usage);
      return lerFerramenta(retry.ferramentaJSON) ?? parseJSONLoose(retry.text);
    }
    const correcao = `${userMsg}

ATENÇÃO — sua resposta anterior não pôde ser lida como JSON. O erro do interpretador foi: ${String(err?.message || err).slice(0, 300)}

Reenvie a MESMA questão, agora como JSON estritamente válido. Verifique, antes de responder: toda aspa dupla que faça parte de um texto está escapada como \\" ; não há barra invertida solta (nada de LaTeX como \\pi ou \\sqrt — escreva por extenso); não há quebra de linha literal dentro de uma string; não há vírgula sobrando antes de } ou ]. Entregue chamando a ferramenta indicada acima, sem crase e sem texto em volta.`;
    const retry = await callClaude(system, correcao, 8000, enableWebSearch, ferramenta);
    if (usos && retry.usage) usos.push(retry.usage);
    return lerFerramenta(retry.ferramentaJSON) ?? parseJSONLoose(retry.text);
  }
}

/* Resumo do consumo desta requisição, para que o cache seja verificável e não
   apenas prometido. "cacheLido" maior que zero significa que o prompt do
   sistema veio do cache — é o que se espera da segunda chamada em diante. */
function resumoUso(usos: any[]) {
  const soma = (chave: string) => usos.reduce((t, u) => t + (Number(u?.[chave]) || 0), 0);
  return {
    chamadas: usos.length,
    entradaNova: soma("input_tokens"),
    cacheEscrito: soma("cache_creation_input_tokens"),
    cacheLido: soma("cache_read_input_tokens"),
    saida: soma("output_tokens"),
  };
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

/* Verificação de integridade da implantação.

   Esta função é implantada enviando o CONTEÚDO dos arquivos pela API, e não
   copiando bytes de um disco para outro. Um caractere trocado dentro do
   app_data.json — 54 KB numa única linha minificada — não quebraria o boot:
   passaria despercebido e sairia como uma questão sutilmente errada.

   Por isso a função sabe dizer o que carregou. GET ou POST com {selftest:true}
   devolve o tamanho e a impressão digital (FNV-1a) do APP_DATA efetivamente
   carregado, calculados sobre a forma canônica JSON.stringify. Basta comparar
   com o valor calculado no arquivo de origem: batendo, os dados chegaram
   inteiros; não batendo, a implantação é refeita. Nada de segredo é exposto —
   só um número e um hash.                                                     */
function fnv1a(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function selfTestResponse() {
  const canonico = JSON.stringify(APP_DATA);
  /* O mesmo cuidado vale para o código: um caractere trocado dentro de um
     texto de prompt não quebraria o boot. Function.prototype.toString()
     devolve o corpo realmente carregado pelo runtime, então a impressão
     digital abaixo cobre as partes do index.ts que decidem o conteúdo. */
  const codigo = [
    NOTACAO_QUIMICA,
    JSON_SCHEMA_TXT,
    buildSystemPrompt.toString(),
    buildUserPrompt.toString(),
    buildValidationChecklist.toString(),
    buildGabaritoAlvo.toString(),
    buildVisualRedoPrompt.toString(),
    buildImageFinalPass.toString(),
    buildRegraFontesReais.toString(),
    buildCalibracaoExtensao.toString(),
    buildMatrizInstrucoes.toString(),
    buildObjetosConhecimento.toString(),
  ].join(String.fromCharCode(0));
  return jsonResponse({
    selftest: true,
    appDataChars: canonico.length,
    appDataHash: fnv1a(canonico),
    chaves: Object.keys(APP_DATA).sort(),
    codigoChars: codigo.length,
    codigoHash: fnv1a(codigo),
    notacaoChars: NOTACAO_QUIMICA.length,
    notacaoHash: fnv1a(NOTACAO_QUIMICA),
    schemaChars: JSON_SCHEMA_TXT.length,
    schemaHash: fnv1a(JSON_SCHEMA_TXT),
    temNotacaoQuimica: typeof NOTACAO_QUIMICA === "string" && NOTACAO_QUIMICA.length > 0,
    temGabaritoAlvo: typeof buildGabaritoAlvo === "function",
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method === "GET" && new URL(req.url).searchParams.get("selftest") === "1") {
    return selfTestResponse();
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
  if (body?.selftest === true) return selfTestResponse();

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
  // Letra que o professor reservou para a resposta correta desta questão.
  const gabaritoAlvoRaw = (body.gabaritoAlvo || "").toString().trim().toUpperCase();
  const gabaritoAlvo = ["A", "B", "C", "D", "E"].includes(gabaritoAlvoRaw) ? gabaritoAlvoRaw : null;

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

    const usos: any[] = [];
    try {
      const system = buildSystemPrompt(area);
      const userMsg = buildVisualRedoPrompt({ tema, recurso, textoBase, comando, alternativas, gabarito, resolucaoComentada, instrucoesVisual });
      const data = await callClaudeForJSON(system, userMsg, false, usos, FERRAMENTA_VISUAL);
      if (!data || !data.visual) {
        return jsonResponse({ error: "O modelo não retornou um novo recurso visual válido." }, 502);
      }
      await logGeneration(area, disciplina, `[refazer visual] ${tema}`);
      return jsonResponse({ visual: data.visual, uso: resumoUso(usos) });
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

  const usos: any[] = [];
  try {
    const system = buildSystemPrompt(area);
    const userMsg = buildUserPrompt({ area, disciplina, tema, dificuldade, recurso, competenciaNum, habilidadeCod, instrucoesVisual, gabaritoAlvo });
    const webSearch = precisaFontesReais(disciplina);
    let data = await callClaudeForJSON(system, userMsg, webSearch, usos);

    if (validar) {
      const valPrompt = buildValidationChecklist(disciplina, dificuldade).replace("__DRAFT_JSON__", JSON.stringify(data));
      data = await callClaudeForJSON(system, valPrompt, webSearch, usos);
    }

    /* AUDITORIA FINAL DE COERÊNCIA DA IMAGEM — obrigatória, independente do
       checkbox "validar": o texto da questão já está finalizado neste ponto
       (rascunho + validação pedagógica, quando ligada), então esta chamada
       dedicada audita SÓ a imagem contra o texto pronto e reescreve a
       especificação do zero se detectar qualquer incoerência de assunto.
       Uma falha aqui (rede, parsing) não pode derrubar a entrega da questão:
       nesse caso mantém-se a especificação anterior, já revisada acima. */
    if (recurso === "imagem" && data?.visual?.promptImagem) {
      try {
        const auditPrompt = buildImageFinalPass({
          tema: data.tema || tema,
          disciplina,
          textoBase: data.textoBase || "",
          comando: data.comando || "",
          alternativas: data.alternativas || {},
          gabarito: data.gabarito || "",
          resolucaoComentada: data.resolucaoComentada || "",
          descricaoAtual: data.visual.descricao || "",
          promptImagemAtual: data.visual.promptImagem || "",
        });
        const auditData = await callClaudeForJSON(system, auditPrompt, false, usos, FERRAMENTA_AUDITORIA_IMAGEM);
        if (auditData && typeof auditData.promptImagem === "string" && auditData.promptImagem.trim()) {
          data.visual.descricao = auditData.descricao || data.visual.descricao;
          data.visual.promptImagem = auditData.promptImagem;
        }
      } catch (_e) {
        // Mantém a especificação já existente — melhor entregar a questão com
        // a imagem revisada na etapa anterior do que falhar a geração inteira.
      }
    }

    await logGeneration(area, disciplina, tema);

    return jsonResponse({ question: data, uso: resumoUso(usos) });
  } catch (err) {
    return jsonResponse({ error: `Erro ao gerar questão: ${String((err as any)?.message || err)}` }, 502);
  }
});

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
/* MODELO FIXO EM "claude-sonnet-5" PARA TODA E QUALQUER CHAMADA DESTA FUNÇÃO.
   Isto é intencional e definitivo: por decisão de custo, o professor exige
   EXCLUSIVAMENTE o Claude Sonnet 5 — nunca Claude Sonnet 4.6 nem qualquer
   outro modelo — mesmo que isso signifique abrir mão de capacidade do 4.6.
   A variável de ambiente ANTHROPIC_MODEL NÃO é mais lida: mesmo que ela
   exista nos secrets deste projeto Supabase com outro valor (por exemplo
   apontando para Sonnet 4.6), esse valor é ignorado de propósito, para que
   nenhuma configuração externa consiga trocar o modelo sem editar este
   arquivo. Para usar outro modelo no futuro, o pedido tem que ser explícito
   e o valor tem que ser trocado aqui, nunca por env var, header ou parâmetro
   de request. */
const MODEL = "claude-sonnet-5";
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
// buildUserPrompt). Comparação por substring, em minúsculas,
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
  /* NOTACAO_QUIMICA só entra quando a área é Ciências da Natureza (Física,
     Química, Biologia) — é a única área onde fórmulas/equações/notação
     química podem aparecer de verdade. Nas outras três áreas (Linguagens,
     Humanas, Matemática) esse bloco nunca tinha utilidade nenhuma e só
     inflava todo prompt do sistema à toa, em toda e qualquer chamada. */
  const notacao = area === "natureza" ? NOTACAO_QUIMICA : "";
  return APP_DATA.universalModel + "\n\n" + APP_DATA.areaContext[area] + buildObjetosConhecimento(area) + notacao;
}

const RECURSO_INSTRUCOES: Record<string, string> = {
  nenhum: `Recurso visual: NENHUM. Não inclua gráfico, tabela ou imagem. Explore a situação-problema apenas por meio do texto-suporte. Deixe o campo "visual" como null e "recurso" como "nenhum".`,
  imagem: `Recurso visual: IMAGEM. A questão deve depender de uma imagem/ilustração pedagogicamente necessária (nunca meramente decorativa) para ser respondida corretamente — por exemplo: esquema anatômico, diagrama de processo, mapa, representação de fenômeno, estrutura, infográfico. Preencha "recurso":"imagem" e "visual" com: {"tipo":"imagem","descricao":"<legenda em português explicando o que a imagem mostra e por que ela é necessária para resolver a questão>","promptImagem":"<especificação técnica em INGLÊS, redigida conforme o PROTOCOLO OBRIGATÓRIO abaixo>"}. ⚠️ TIPO DO CAMPO — leia com atenção: "promptImagem" e "descricao" são, cada um, UMA ÚNICA STRING de texto corrido. As 8 seções do protocolo ficam DENTRO dessa string, uma após a outra, cada uma iniciada pelo seu título numerado (ex.: "1. SCENE AND VIEWPOINT: ..."), separadas por quebra de linha. NUNCA entregue "promptImagem" como objeto JSON — nem uma chave por seção, nem {"tipo":..., "valor":...}, nem qualquer outro aninhamento. O gerador de imagens só recebe TEXTO: um objeto chega a ele vazio, e a imagem sai sobre um assunto aleatório, sem nenhuma relação com a questão.

⚠️ PROTOCOLO OBRIGATÓRIO DE ESPECIFICAÇÃO DA IMAGEM
O gerador NÃO conhece a questão, NÃO lê o texto-base, NÃO vê o comando e NÃO infere nada: desenha exatamente e só o que estiver no "promptImagem". Toda ambiguidade vira erro — seta invertida, rótulo no elemento errado, elemento ausente, número ilegível. Portanto o "promptImagem" NÃO é descrição literária nem frase única: é ESPECIFICAÇÃO TÉCNICA COMPLETA, em inglês, elemento por elemento, com posição e direção explícitas, nas 8 seções abaixo, nesta ordem, cada uma com seu título em inglês:

🎯 FIDELIDADE OBRIGATÓRIA AO ENUNCIADO — antes de escrever qualquer seção, releia integralmente o texto-base, o comando, as alternativas e a resolução e extraia TODOS os dados concretos ali contidos: cada objeto citado, cada valor numérico, cada posição relativa, cada direção de causa-efeito, cada processo ou fenômeno descrito, cada relação entre elementos (o que vem antes/depois, o que está à esquerda/direita, o que é maior/menor, o que aumenta/diminui, o que está ligado a quê). Nenhum desses dados pode ficar de fora do "promptImagem", e nenhum dado inventado que contradiga o enunciado pode entrar na imagem. Se o enunciado descreve, por exemplo, um circuito elétrico em série ou em paralelo, resistores, capacitores, uma reação química específica, um objeto em movimento com velocidade e sentido definidos, ou qualquer outro elemento técnico com propriedades exatas, a imagem tem de refletir EXATAMENTE essas propriedades, sem aproximação e sem ambiguidade. É PROIBIDO entregar uma especificação genérica que sirva para "qualquer questão parecida" — a especificação tem de servir apenas para ESTA questão, com estes dados exatos. Toda vez que restar dúvida sobre um detalhe (direção de uma seta, posição de um elemento, valor de uma grandeza), a resposta está na resolução da questão: releia-a antes de decidir.

1. SCENE AND VIEWPOINT — o que a figura é, em uma frase, e o ponto de vista exato: front view, side view, top-down view, cross-section, exploded view ou three-quarter view. Declare a orientação absoluta (ex.: "the plant is upright, roots at the bottom, leaves at the top") e o AMBIENTE: por padrão um ambiente real, coerente com a cena, com profundidade e atmosfera (ex.: "shallow tropical reef bathed in shafts of sunlight, softly blurred background"). Reserve deliberadamente uma área visualmente calma (céu, água, parede, fundo desfocado) do lado em que os rótulos vão entrar. Fundo liso ("plain white background") só em conteúdo puramente abstrato/matemático: gráfico de eixos ou figura geométrica pura. CIRCUITOS ELÉTRICOS, COMPONENTES E APARELHOS NUNCA são exceção: um circuito em série ou em paralelo, resistores, capacitores, pilhas, fios, multímetros e demais componentes físicos têm de ser especificados como OBJETOS REAIS fotografados/renderizados sobre uma bancada, protoboard ou placa de circuito — com fios reais coloridos, resistores reais com faixas de cores visíveis, terminais e soldas quando fizer sentido — jamais como diagrama esquemático abstrato com símbolos de livro didático (nada de linhas retas com símbolos de circuito, zigue-zague genérico para resistor ou par de traços para pilha). Peça, em inglês, termos como "photorealistic photograph of a real electronics workbench, real breadboard or PCB, real resistors with visible color bands, real copper wires, real battery pack" sempre que o assunto envolver circuitos ou componentes eletrônicos.

2. ELEMENT INVENTORY — lista numerada de TODOS os elementos, com quantidade explícita ("exactly three test tubes", "one arrow"). O gerador inventa elementos extras; contar reduz isso. Nada fora desta lista pode aparecer.

3. LAYOUT AND POSITION — para CADA elemento, a posição absoluta (left / center / right com top / middle / bottom) E em relação aos vizinhos, com o lado sempre explícito. Ex.: "the beaker sits at the center-bottom; the flame is directly beneath the beaker; the thermometer is inserted from above, tilted about 30 degrees to the right". PROIBIDO escrever só "next to", "near" ou "beside" sem dizer de que lado. Se o enunciado descrever explicitamente a posição de algum elemento (à esquerda, acima, no topo, entre dois pontos etc.), a posição na imagem tem de ser IDÊNTICA à descrita — nunca uma posição diferente, ainda que visualmente plausível.

4. ARROWS — a causa mais frequente de erro. Para CADA seta, uma linha própria contendo, nesta ordem: origem, destino, onde fica a ponta (arrowhead), direção na tela e o que representa. Modelo: "One arrow starting at the right edge of the sun and ending at the top surface of the leaf, with the arrowhead touching the leaf and pointing down-left, representing incident sunlight." TERMINANTEMENTE PROIBIDO "an arrow between A and B", "arrows connecting the parts", "arrows showing the cycle" ou qualquer forma sem origem, destino e ponta — sem isso o gerador escolhe o sentido e frequentemente o inverte. Se o SENTIDO for parte do que a questão avalia (fluxo de energia, corrente elétrica, movimento, sentido de reação, cadeia alimentar, ciclo biogeoquímico), repita a direção uma segunda vez, com outras palavras, ao final. O sentido de CADA seta tem de corresponder exatamente ao que o texto-base, o comando, as alternativas ou a resolução afirmam sobre aquele fenômeno — nunca um sentido genérico ou "provável"; havendo qualquer dúvida sobre o sentido correto, releia a resolução antes de decidir, pois é ali que o sentido correto sempre está implícito ou explícito.

5. TEXT LABELS — para CADA rótulo, escreva: o texto EXATO entre ASPAS SIMPLES, o elemento a que pertence, o lado em que fica e se há linha de chamada. Modelo: the label 'Cloroplasto' placed immediately to the right of the green organelle, connected to it by a thin straight leader line. Use aspas simples em TODA a especificação da imagem — ela viaja dentro de um campo JSON, e aspas duplas não escapadas quebram a resposta inteira. Regras: (a) TODO texto visível deve estar EM PORTUGUÊS, ainda que a especificação esteja em inglês — inclua "all visible text must be rendered exactly as written above, in Portuguese, with correct spelling"; (b) o rótulo fica FORA do contorno do elemento, nunca sobreposto; (c) nem rótulo sem elemento, nem elemento essencial sem rótulo; (d) se dois rótulos correrem risco de se aproximar, declare os lados opostos; (e) declare o tamanho ("labels in a clear sans-serif typeface, large enough to be read when the image is printed at half page width").

6. NUMBERS, SCALES AND MEASUREMENT MARKS — havendo dado referencial (régua ou escala graduada, marcações de altura, distância, tempo, velocidade, temperatura, valores em eixo, unidades), liste os valores EXATOS, onde cada um aparece e de que lado do traço fica impresso. Modelo: "a vertical graduated ruler along the left side, with clearly legible labeled tick marks at 5 m, 10 m, 15 m and 20 m, each number printed to the left of its own tick". Os valores devem ser exatamente os mesmos do texto-base, do comando, das alternativas e da resolução — nunca aproximados nem arredondados de outra forma.

7. STYLE AND LEGIBILITY — a imagem tem DUAS CAMADAS, e as duas são obrigatórias.

   ⛔ REGRA NÃO NEGOCIÁVEL DE REALISMO — vale para TODA imagem, sem exceção: ela tem de ser ULTRA-REALISTA ou, no mínimo, SEMI-ULTRA-REALISTA. É PROIBIDO entregar uma imagem simples, chapada, tipo clipart ou tipo desenho esquemático de livro didático genérico — mesmo quando o assunto pareceria "simples" à primeira vista (um objeto do dia a dia, uma célula, uma reação química), a imagem tem de receber o mesmo padrão de produção fotorrealista de uma cena complexa. Sempre que o conteúdo permitir (isto é, sempre que a seção 1 não exigir fundo liso por se tratar de conteúdo puramente abstrato/matemático — gráfico de eixos ou figura geométrica pura), PREFIRA renderização TRIDIMENSIONAL. Isto SEMPRE inclui circuitos elétricos e componentes eletrônicos, que devem ser tratados como objetos reais fotografados, nunca como esquema plano. Peça, em inglês, termos como "photorealistic 3D render, three-dimensional CGI model, physically-based rendering, volumetric lighting and shadow, realistic depth" combinados com o padrão cinematográfico da Camada 1 abaixo — a cena deve parecer modelada em três dimensões e fotografada, nunca desenhada em plano único.

   ▸ CAMADA 1 — BASE CINEMATOGRÁFICA (beleza e impacto), no padrão National Geographic, BBC Earth, Planet Earth e IMAX, preferencialmente com renderização 3D fotorrealista. Peça, em inglês: "ultra-realistic 4K/8K photography, three-dimensional photorealistic render when applicable, ultra definition, razor-sharp focus on the subject, cinematic composition, dramatic directional natural lighting, rich material textures and micro-detail, deep saturated color, atmospheric depth of field, epic sense of scale and grandeur, museum-quality documentary photography". Bonita, imponente e memorável — nunca chapada, genérica, simples, borrada ou pixelizada.

   ▸ CAMADA 2 — CAMADA DE ANOTAÇÃO (precisão). Por cima da cena, camada vetorial limpa com as setas (seção 4), os rótulos (seção 5) e as marcações (seção 6), em princípios de UI/UX: hierarquia visual clara, tipografia sans-serif de tamanhos consistentes, mesma cor para o mesmo tipo de elemento, espaçamento generoso, contraste garantido contra o que está atrás. Peça, em inglês: "clean vector annotation overlay in modern UI/UX infographic style, consistent labeling system, clear visual hierarchy, high contrast between annotation and background, thin leader lines, subtle translucent backing plates or soft halo behind text wherever the scene behind it is busy".

   ▸ REGRA DE PRECEDÊNCIA (não negociável): a Camada 1 NUNCA prejudica a Camada 2. Se a cena ameaçar a leitura de um número, rótulo ou seta, a cena cede — menos detalhe, área escurecida/desfocada atrás da anotação, ou mais espaço. Declare no prompt, em inglês: "the cinematic scene must never obscure the annotation layer; every label, arrow and numeric mark must remain fully legible". Uma imagem deslumbrante com a régua ilegível é uma imagem inútil para a questão.

   ▸ FIDELIDADE: o esplendor jamais custa exatidão. A cena reflete EXATAMENTE a situação-problema — mesmo objeto, mesmo processo, mesmo momento, mesmos valores. PROIBIDO acrescentar elementos espetaculares alheios à questão (relâmpagos, erupções, fauna extra, luz impossível) só para impressionar: tudo que a questão não previu vira ruído ou erro conceitual.

8. NEGATIVE CONSTRAINTS — encerre listando o que NÃO pode aparecer: "no decorative text, no watermark, no signature, no caption bar, no extra arrows, no additional objects beyond those listed above, no duplicated labels, no cropped or cut-off elements, no text in any language other than Portuguese, no flat clipart or generic cartoon style, no simple or plain illustration, no basic flat 2D line art when a realistic or three-dimensional rendering is possible, no blurry, pixelated or low-detail rendering, no annotation hidden or obscured by the scene".

VERIFICAÇÃO ANTES DE ENTREGAR: releia a "descricao", o texto-base, o comando, as alternativas e a resolução e confirme que (i) todo elemento citado como visível consta do ELEMENT INVENTORY; (ii) toda seta tem origem, destino, ponta e direção na seção ARROWS; (iii) todo rótulo tem texto exato, elemento dono e lado; (iv) todo número citado na questão aparece com o MESMO valor na seção NUMBERS; (v) nada foi afirmado na "descricao" que não esteja especificado; (vi) todo dado numérico, toda posição relativa e todo sentido de seta especificados correspondem exatamente ao texto-base, ao comando, às alternativas e à resolução — nenhum deles é genérico ou aproximado; (vii) se a questão envolve circuito elétrico, componente eletrônico ou aparelho técnico, ele foi especificado como objeto real fotografado/renderizado, nunca como esquema abstrato. Nunca descreva na "descricao" um dado que não esteja visível na imagem, nem deixe na imagem um dado essencial que a "descricao" não mencione.`,

  imagem_biologia: `Recurso visual: IMAGEM (BIOLOGIA). A questão deve depender de uma imagem/ilustração pedagogicamente necessária (nunca meramente decorativa) para ser respondida corretamente — esquema anatômico, diagrama de processo, corte, ciclo biológico, cladograma, cadeia/teia alimentar, comparação entre condições, mapa ou infográfico. Preencha "recurso":"imagem" e "visual" com: {"tipo":"imagem","descricao":"<legenda em português explicando o que a imagem mostra e por que ela é necessária para resolver a questão>","promptImagem":"<especificação técnica em INGLÊS, redigida conforme o PROTOCOLO OBRIGATÓRIO — BIOLOGIA abaixo>"}. ⚠️ TIPO DO CAMPO — leia com atenção: "promptImagem" e "descricao" são, cada um, UMA ÚNICA STRING de texto corrido. As 8 seções do protocolo ficam DENTRO dessa string, uma após a outra, cada uma iniciada pelo seu título numerado (ex.: "1. SCENE AND VIEWPOINT: ..."), separadas por quebra de linha. NUNCA entregue "promptImagem" como objeto JSON — nem uma chave por seção, nem {"tipo":..., "valor":...}, nem qualquer outro aninhamento. O gerador de imagens só recebe TEXTO: um objeto chega a ele vazio, e a imagem sai sobre um assunto aleatório, sem nenhuma relação com a questão.

🧬 FUNÇÃO PEDAGÓGICA DA IMAGEM (raciocínio interno seu — nunca copie o conteúdo desta seção para dentro do "promptImagem" nem da "descricao"): antes de especificar qualquer elemento, decida com clareza (a) qual conteúdo de Biologia a imagem representa; (b) qual fenômeno, estrutura ou relação o aluno precisa analisar; (c) quais informações têm de estar visíveis para permitir essa análise; (d) quais informações o aluno deve inferir a partir do que estiver visível, sem que estejam escritas na imagem; (e) quais informações NÃO podem aparecer, porque entregariam a resposta; (f) se a imagem é indispensável à resolução ou apenas contextual; (g) qual simplificação didática é cientificamente aceitável sem distorcer o conteúdo. O gabarito e a resolução comentada servem para orientar essas decisões, mas nenhuma palavra deles pode aparecer, literal ou disfarçada, no "promptImagem" nem na "descricao" de um jeito que revele a resposta.

⚠️ PROTOCOLO OBRIGATÓRIO DE ESPECIFICAÇÃO DA IMAGEM — BIOLOGIA
O gerador NÃO conhece a questão, NÃO lê o texto-base, NÃO vê o comando e NÃO infere nada: desenha exatamente e só o que estiver no "promptImagem". Toda ambiguidade vira erro científico — seta invertida, estrutura confundida com outra homóloga/análoga, compartimento anatômico errado, rótulo no elemento errado, contagem errada de organelas/cromossomos/organismos, número ilegível. Portanto o "promptImagem" NÃO é descrição literária nem frase única: é ESPECIFICAÇÃO TÉCNICA COMPLETA, em inglês, elemento por elemento, com posição, orientação anatômica e direção explícitas, nas 8 seções abaixo, nesta ordem, cada uma com seu título em inglês.

🎯 FIDELIDADE OBRIGATÓRIA AO ENUNCIADO — antes de escrever qualquer seção, releia integralmente o texto-base, o comando, as alternativas e a resolução e extraia TODOS os dados concretos ali contidos: cada estrutura citada, cada organismo, cada valor numérico ou quantidade, cada posição relativa, cada direção de fluxo/processo, cada fenômeno biológico descrito, cada relação entre elementos (o que está dentro/fora, adjacente, comunicante, à esquerda/direita do organismo — não da imagem). Nenhum desses dados pode ficar de fora do "promptImagem", e nenhum dado inventado que contradiga o enunciado ou a literatura científica pode entrar na imagem. Sempre que restar dúvida sobre um detalhe (sentido de uma seta, posição de uma estrutura, quantidade de um elemento), a resposta está na resolução comentada: releia-a antes de decidir.

1. SCENE AND VIEWPOINT — declare, em uma frase, o tipo exato de representação: esquema científico bidimensional, ilustração anatômica, corte transversal ou longitudinal, vista externa ou interna, representação microscópica esquemática, sequência de acontecimentos, ciclo biológico, cladograma/árvore filogenética, cadeia ou teia alimentar, comparação entre condições, ou composição de múltiplos painéis. NÃO peça aparência de fotografia real nem de micrografia real quando o conteúdo for uma construção esquemática (célula, corte de órgão, ciclo, cladograma) — nesse caso declare explicitamente "photorealistic 3D scientific illustration/render of a schematic diagram" (nunca "flat clipart", nunca "cartoon"), preservando ao mesmo tempo a precisão anatômica: use tridimensionalidade só quando ajudar a compreender relações espaciais reais, sem efeitos cinematográficos, iluminação dramática ou texturas que possam alterar a interpretação das estruturas. Cladogramas, árvores filogenéticas e cadeias/teias alimentares são diagramas relacionais abstratos (nós e ramificações/setas) — para esses, use fundo liso ("plain white or neutral background"), no mesmo padrão de exceção já previsto para gráficos e figuras geométricas puras. Para os demais tipos (esquema anatômico, corte, ciclo, comparação), declare a orientação absoluta (ex.: "the plant is upright, roots at the bottom, leaves at the top"), o AMBIENTE (real e coerente com a cena, ex.: "shallow tropical reef" — ou neutro, quando a clareza científica exigir) e reserve deliberadamente uma área visualmente calma do lado em que os rótulos vão entrar. Declare também o FORMATO: proporção da imagem conforme o conteúdo, orientação horizontal ou vertical, margens livres para impedir cortes de elementos, quantidade de painéis e organização em linhas/colunas quando houver comparação ou sequência, área reservada ao desenho principal e áreas reservadas a títulos/rótulos/legendas. Quando houver muitos elementos ou múltiplos painéis, use coordenadas relativas de 0% a 100% (origem no canto superior esquerdo, eixo horizontal crescendo para a direita, eixo vertical crescendo para baixo) para fixar a posição de cada painel/estrutura principal — a conexão correta entre estruturas tem prioridade sobre o cumprimento rígido de uma coordenada. Se a figura representar uma sequência, ciclo ou relação entre organismos (inclusive ciclos parasitários), declare aqui a lista ordenada de etapas, indicando para cada uma: organismo/estrutura presente, estágio de desenvolvimento, ambiente/compartimento e evento representado — em ciclos parasitários, diferencie explicitamente hospedeiros, vetores, ambiente externo, estágios infectantes e diagnósticos, vias de entrada/saída e locais de desenvolvimento, quando pertinente à questão.

2. ELEMENT INVENTORY — lista numerada de TODOS os elementos, cada um com: nome/identificador interno (nunca impresso na imagem, a menos que solicitado), quantidade EXATA ("exactly four mitochondria", "one arrow"), localização, forma, tamanho relativo, orientação, cor e preenchimento, contorno, estruturas internas visíveis, relação com os demais elementos, e quais elementos análogos NÃO podem aparecer. Não escreva "incluir organelas" — liste exatamente quais organelas aparecem e quais características permitem reconhecê-las. Não escreva "vários organismos" quando a quantidade tiver significado biológico na questão — informe o número exato. Diferencie estruturas que exigem contagem rigorosa (cromossomos, cromátides, organelas, organismos de uma população) das que são meramente ilustrativas. Nada fora desta lista pode aparecer.

3. LAYOUT AND POSITION — para CADA elemento, a posição absoluta (left/center/right com top/middle/bottom) e em relação aos vizinhos, com o lado sempre explícito — PROIBIDO "next to", "near" ou "beside" sem dizer de que lado. Em representações anatômicas, celulares ou histológicas, especifique também: o organismo/órgão/tecido/tipo celular retratado; a vista adotada (frontal, dorsal, ventral, lateral, ou outra); o tipo e plano de corte; a orientação dos eixos anatômicos; quais estruturas ficam no interior de outras; quais são adjacentes; quais compartimentos se comunicam e quais barreiras os separam; quais estruturas estão à frente/atrás; e quais partes foram removidas ou tornadas transparentes para permitir a visualização (declare que é um recurso didático). Diferencie SEMPRE a direita/esquerda do organismo da direita/esquerda da imagem — nunca escreva só "lado direito" quando houver risco de confusão. Havendo janela de ampliação, marque claramente sua origem — ela não pode parecer uma estrutura adicional do organismo. Se a questão comparar duas ou mais condições (ex.: estômato aberto/fechado, célula normal/alterada, dois estágios de um processo), use o mesmo enquadramento, o mesmo estilo de desenho, a mesma escala (salvo indicação contrária), posicione estruturas equivalentes em locais correspondentes, use as mesmas cores para elementos equivalentes e modifique APENAS a característica relacionada à comparação — proibido introduzir diferenças decorativas que funcionem como pista involuntária da resposta.

4. ARROWS — a causa mais frequente de erro. Trate CADA seta como uma ficha própria, com todos os campos a seguir declarados por extenso (os códigos S1, S2 etc. são só para sua organização e NUNCA aparecem impressos na imagem): função (identificação, deslocamento, fluxo, transformação, transferência de energia); origem (elemento e ponto exato de onde parte); destino (elemento e ponto exato onde termina); ponta (localização e orientação exatas); trajeto (reto, curvo, em arco ou segmentado); passagem (regiões pelas quais deve passar); restrições (estruturas que não pode atravessar); aparência (cor, espessura, tipo de linha); rótulo (texto exato, se houver) e sua posição; e como evitar sobreposição com outros desenhos/setas. Regras obrigatórias: setas de identificação terminam exatamente na estrutura indicada, sem encostar em outra; linhas de identificação podem não ter ponta quando isso ajudar a clareza; setas de processo ligam explicitamente a origem ao destino correspondente; NUNCA uma seta contínua atravessando várias etapas de forma ambígua; NUNCA seta bidirecional para processo unidirecional — havendo fluxos opostos, use duas setas independentes; nenhuma ponta pode ficar flutuando entre dois destinos possíveis; nenhuma seta atravessa membrana, parede ou outro limite sem que essa passagem faça parte do processo representado; use aparências diferentes para seta de identificação e seta de fluxo quando houver risco de confusão; em ciclos, especifique também a conexão entre a última etapa e a primeira; em cadeias/teias alimentares, a seta de transferência de matéria/energia parte SEMPRE do organismo que serve de alimento e chega ao consumidor; em cladogramas, detalhe os pontos de ramificação e o parentesco representado, sem sugerir que um grupo atual é "mais evoluído" que outro. O sentido de CADA seta tem de corresponder exatamente ao que o texto-base, o comando, as alternativas ou a resolução afirmam sobre aquele fenômeno — havendo dúvida, releia a resolução antes de decidir, e repita a direção com outras palavras ao final da ficha da seta quando o sentido for o que a questão avalia.

5. TEXT LABELS — para CADA rótulo, escreva: o texto EXATO entre ASPAS SIMPLES, o elemento a que pertence, o lado em que fica, alinhamento, tamanho relativo, cor, se há linha de chamada, e uso de itálico/subscrito/sobrescrito quando aplicável (ex.: nomes científicos em itálico). Use aspas simples em TODA a especificação — ela viaja dentro de um campo JSON e aspas duplas não escapadas quebram a resposta. Regras: (a) TODO texto visível deve estar em PORTUGUÊS, com acentuação correta, ainda que a especificação esteja em inglês — inclua "all visible text must be rendered exactly as written above, in Portuguese, with correct accentuation"; (b) proibido inventar títulos, legendas, explicações ou marcas-d'água; (c) proibido nomear estruturas que o próprio enunciado pede para o aluno identificar — isso entregaria a resposta; (d) o rótulo fica FORA do contorno do elemento, nunca sobreposto, e nunca sobre região visualmente complexa; (e) nem rótulo sem elemento, nem elemento essencial sem rótulo; (f) não repita rótulos sem necessidade; (g) se dois rótulos correrem risco de se aproximar, declare os lados opostos; (h) declare tamanho legível ("labels in a clear sans-serif typeface, legible when printed at half page width"); (i) preserve a escrita correta de símbolos, fórmulas e unidades. Se a figura usar letras como "A", "B", "C" para identificar estruturas, defina a posição exata de cada uma e a estrutura indicada, e confirme que esses identificadores coincidem com os usados no enunciado e nas alternativas.

6. NUMBERS, SCALES AND MEASUREMENT MARKS — havendo dado referencial (régua, escala graduada, marcações de tempo/tamanho/concentração, valores em eixo, unidades), liste os valores EXATOS, onde cada um aparece e de que lado do traço fica impresso — sempre os mesmos valores do texto-base, do comando, das alternativas e da resolução, nunca aproximados. Quanto a proporções e ampliações: mantenha proporções biologicamente coerentes; diga quais estruturas podem ser ampliadas por razão didática; se painéis diferentes usam a mesma escala; se o desenho está deliberadamente fora de escala; e se a comparação de tamanhos é relevante para a resposta. NÃO invente barras de escala, medidas ou fatores de ampliação microscópica — use-os só quando os valores forem dados pelo enunciado ou puderem ser determinados de forma confiável a partir dele; em comparações, mantenha o tamanho de referência consistente, pois uma mudança de escala não pode simular uma diferença biológica inexistente. Havendo gráfico ou tabela embutidos na própria imagem, especifique: tipo de gráfico, variáveis dos eixos, unidades, intervalos e marcações, valores/pontos exatos a representar, quantidade de curvas/séries, cores/padrões/símbolos, legendas e tendências relevantes; para tabela, quantidade de linhas/colunas, cabeçalhos, conteúdo exato de cada célula, unidades e ordem dos dados — nunca delegue ao gerador a invenção de dados ou o posicionamento aproximado de valores.

7. STYLE AND LEGIBILITY — a imagem tem DUAS CAMADAS, e as duas são obrigatórias.

   ⛔ REGRA NÃO NEGOCIÁVEL DE REALISMO — vale para toda imagem cuja representação (definida na seção 1) não seja um diagrama relacional abstrato (cladograma, cadeia/teia alimentar, gráfico): ela tem de ser ULTRA-REALISTA ou, no mínimo, SEMI-ULTRA-REALISTA — nunca clipart, nunca desenho chapado tipo livro didático genérico. Mesmo um esquema (célula, corte de órgão, ciclo) deve ser tratado como uma ilustração/render 3D fotorrealista de conteúdo científico — nunca uma imagem plana e simples — SEM, no entanto, recorrer a efeitos cinematográficos, iluminação dramática, texturas ou hiper-realismo que possam distorcer a leitura das estruturas, das proporções ou das relações espaciais definidas nas seções 1 e 3. Peça, em inglês, termos como "photorealistic 3D scientific render, physically-based rendering, anatomically accurate proportions, clean even lighting that preserves structural clarity" — priorizando SEMPRE a legibilidade científica sobre o espetáculo visual.

   ▸ CAMADA 1 — BASE DE ILUSTRAÇÃO CIENTÍFICA REALISTA: renderização 3D fotorrealista, definição alta, foco nítido no assunto, iluminação uniforme que não esconda nenhuma estrutura, profundidade de campo suave apenas quando não comprometer a leitura de nenhum elemento. Peça, em inglês: "ultra-realistic 4K scientific illustration, three-dimensional photorealistic render, sharp focus throughout all labeled structures, even and clear lighting, rich but accurate material textures, museum-quality biology textbook illustration". Nunca chapada, genérica, borrada ou pixelizada — mas também nunca decorativa a ponto de comprometer a exatidão anatômica.

   ▸ CAMADA 2 — CAMADA DE ANOTAÇÃO (precisão): por cima da cena, camada vetorial limpa com as setas (seção 4), os rótulos (seção 5) e as marcações (seção 6), em princípios de UI/UX: hierarquia visual clara, tipografia sans-serif de tamanhos consistentes, mesma cor para o mesmo tipo de elemento, espaçamento generoso, contraste garantido contra o fundo. Peça, em inglês: "clean vector annotation overlay in modern UI/UX infographic style, consistent labeling system, clear visual hierarchy, high contrast between annotation and background, thin leader lines, subtle translucent backing plates wherever the scene behind the text is busy".

   ▸ REGRA DE PRECEDÊNCIA (não negociável): a Camada 1 NUNCA prejudica a Camada 2 nem a exatidão científica. Se a cena ameaçar a leitura de um rótulo, seta ou marcação, a cena cede. Declare no prompt, em inglês: "the realistic rendering must never obscure the annotation layer or distort anatomical accuracy; every label, arrow and structure must remain fully legible and scientifically correct".

   ▸ CORES, PADRÕES E CONVENÇÕES: defina uma paleta funcional — qual cor corresponde a cada estrutura/categoria, qual significado cada cor tem, quais elementos compartilham a mesma cor, quais precisam ser visualmente distintos, e quais padrões/contornos complementam a distinção por cores (a cor nunca é o único meio de transmitir uma informação indispensável). Ao usar cores convencionais (ex.: vermelho/azul em esquema circulatório), declare explicitamente o significado da convenção — NUNCA trate a cor convencional como aparência real do material biológico (não é correto sugerir, por exemplo, que todo vaso arterial carrega sangue mais oxigenado sempre, ou que o sangue venoso é realmente azul). Mantenha a mesma convenção de cores em todos os painéis da mesma figura.

   ▸ FIDELIDADE: o padrão de produção jamais custa exatidão científica. A cena reflete EXATAMENTE a situação-problema — mesma estrutura, mesmo processo, mesmo momento, mesmos valores. PROIBIDO acrescentar elementos espetaculares alheios à questão só para impressionar: tudo que a questão não previu vira ruído ou erro conceitual.

8. NEGATIVE CONSTRAINTS — encerre com duas listas. Primeiro, a lista genérica: "no decorative text, no watermark, no signature, no caption bar, no extra arrows, no additional objects beyond those listed above, no duplicated labels, no cropped or cut-off elements, no text in any language other than Portuguese, no flat clipart or generic cartoon style, no cinematic lighting effects that obscure structures, no blurry, pixelated or low-detail rendering, no annotation hidden or obscured by the scene". Segundo, UMA LISTA ESPECÍFICA PARA ESTA FIGURA, escrita por você a partir do conteúdo real da questão (nunca genérica): inclua, quando pertinentes, restrições como "no duplicated nuclei/organelles/chromosomes beyond the exact count specified", "no compartments connected without an anatomical communication between them", "no reversed flow direction on any arrow", "no structure placed outside its correct anatomical compartment", "no confusing homologous structures with analogous ones", "no missing steps required to interpret the cycle", "no extra organisms or feeding relationships beyond those listed", "no chromosome/chromatid/molecule count inconsistent with the situation described", "no label that reveals the structure the student is asked to identify", "no detail contradicting the textoBase, comando or resolução".

VERIFICAÇÃO ANTES DE ENTREGAR — BIOLOGIA: releia a "descricao", o texto-base, o comando, as alternativas e a resolução e confirme que (i) todo elemento citado como visível consta do ELEMENT INVENTORY, com a quantidade exata; (ii) toda seta tem ficha completa (origem, destino, ponta, trajeto, sentido) na seção ARROWS, e o sentido de cada uma corresponde exatamente ao fenômeno descrito; (iii) todo rótulo tem texto exato, elemento dono e lado, e nenhum rótulo entrega a resposta que o aluno deveria deduzir; (iv) todo número/proporção citado na questão aparece com o MESMO valor na seção NUMBERS, e nenhuma escala foi inventada; (v) a orientação anatômica (vista, plano de corte, dentro/fora, adjacências) está inequívoca; (vi) as cores seguem uma convenção consistente e claramente definida, nunca sugerindo uma aparência real inexistente; (vii) em sequências/ciclos, as etapas estão na ordem correta e a conexão entre a última e a primeira (quando for ciclo) está explícita; (viii) nenhuma simplificação didática altera o significado científico do fenômeno; (ix) a "lista específica desta figura" da seção NEGATIVE CONSTRAINTS reflete riscos concretos do conteúdo, não uma lista genérica; (x) nada foi afirmado na "descricao" que não esteja especificado no "promptImagem", e nenhum dado essencial da imagem ficou de fora da "descricao". Nunca declare a especificação pronta se qualquer um destes pontos falhar — reescreva a seção correspondente antes de entregar.`,
  grafico: `Recurso visual: GRÁFICO. A questão deve depender de um gráfico com dados numéricos plausíveis e coerentes (cientificamente ou matematicamente consistentes com o texto-suporte), efetivamente necessários para resolver a questão — não apenas decorativos. Preencha "recurso":"grafico" e "visual" com: {"tipo":"grafico","chartType":"bar" ou "line" ou "pie","titulo":"...","labels":["...","..."],"datasets":[{"label":"...","data":[num,num,...]}]}. Os números usados no gráfico devem ser os mesmos que a resolução comentada utiliza.`,
  tabela: `Recurso visual: TABELA. A questão deve depender de uma tabela com dados relevantes (resultados experimentais, dados populacionais, séries históricas, comparações entre grupos etc.), efetivamente necessários para resolver a questão. Preencha "recurso":"tabela" e "visual" com: {"tipo":"tabela","titulo":"...","colunas":["...","..."],"linhas":[["...","..."],["...","..."]]}.`,
};

// Seleciona as instruções de recurso visual a usar. Para Biologia + imagem, usa
// um protocolo dedicado (RECURSO_INSTRUCOES.imagem_biologia) que incorpora as
// exigências científicas específicas da disciplina (inventário detalhado de
// estruturas, ficha por seta, orientação anatômica, convenção de cores, listas
// de restrições específicas da figura etc.) mantendo as mesmas 8 seções e a
// mesma exigência de realismo fotográfico/3D já usadas para as demais
// disciplinas — nunca duas fontes de verdade divergentes para o mesmo campo.
function instrucoesImagem(recurso: string, disciplina: string): string {
  if (recurso === "imagem" && (disciplina || "").trim().toLowerCase() === "biologia") {
    return RECURSO_INSTRUCOES["imagem_biologia"];
  }
  return RECURSO_INSTRUCOES[recurso];
}

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
 "textoBase": "string (texto-suporte com contextualização; termine com a citação de fonte no formato ENEM — real ou verossímil, EXCETO quando a regra 'PROIBIDO INVENTAR AUTORES OU TEXTOS' abaixo se aplicar à disciplina, caso em que a fonte citada TEM que ser real. Separe o corpo do texto da citação final com uma quebra de parágrafo DE VERDADE — nunca escreva os dois caracteres literais \\n no meio do texto para representar essa quebra; se precisar de uma quebra de linha dentro da própria string JSON, produza-a como quebra de linha real, não como texto \\n)",
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
- nada de LaTeX nem de barra invertida solta: escreva "2π vezes a raiz quadrada de (L/g)", nunca "2\\\\pi\\\\sqrt{L/g}";
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

/* ANCORAGEM DE ASSUNTO DO RECURSO VISUAL.

   Bug observado: o professor gera um simulado de uma disciplina (ex.: Física,
   com uma questão sobre conversão de energia numa usina hidrelétrica) e, ao
   trocar de disciplina no mesmo formulário (ex.: para Matemática) sem
   perceber, o campo "Instruções opcionais para a criação da imagem" de um
   slot de questão pode continuar preenchido com uma instrução pensada para a
   disciplina anterior (o campo é por questão, digitado livremente pelo
   professor, e nada no formulário o limpa sozinho ao trocar de área). O
   resultado: o texto-base e o comando saem corretos, sobre o novo tema — mas
   o "promptImagem" (que o protocolo de imagem instrui a seguir a instrução do
   professor "com prioridade") pode obedecer à instrução deixada para trás e
   desenhar um cenário de outra disciplina inteira.

   Este bloco é a rede de segurança do lado do modelo: repete a disciplina e o
   tema desta questão especificamente ENTRE a especificação técnica da imagem
   e a instrução opcional do professor — a posição importa, porque um prompt
   desta extensão (o protocolo de imagem sozinho passa de 5 mil caracteres)
   corre risco real de "diluir" a atenção do modelo ao tema original de tanto
   texto no meio — e manda explicitamente IGNORAR qualquer parte da instrução
   que descreva um assunto incompatível com a disciplina/tema atuais, em vez
   de tentar obedecer os dois pedidos ao mesmo tempo. (A correção definitiva —
   limpar esse campo no formulário ao trocar de disciplina — já foi feita no
   app cliente; isto aqui é a segunda camada, para o caso de uma instrução
   antiga chegar ao backend por qualquer outro caminho.) */
function buildAncoragemVisual(area: string, disciplina: string, tema: string, recurso: string): string {
  if (recurso === "nenhum") return "";
  const temaTxt = tema || "(o tema que você mesmo escolheu para esta questão, definido acima)";
  return `
🔒 ANCORAGEM DE ASSUNTO DO RECURSO VISUAL — releia com atenção mesmo já tendo lido a disciplina e o tema no início deste prompt: esta questão específica é de ${AREA_LABELS[area]}, disciplina ${disciplina}, sobre "${temaTxt}". ESCREVA O CAMPO "visual" POR ÚLTIMO — só depois de já ter escrito e finalizado "textoBase", "comando", "alternativas", "gabarito" e "resolucaoComentada". A especificação da imagem (campo "promptImagem"/"descricao", ou os dados de gráfico/tabela) tem de ser derivada EXATA e EXCLUSIVAMENTE do cenário, dos objetos, dos personagens e dos valores que você mesmo acabou de escrever nesses campos, para ESTA questão — nunca decidida antes de escrevê-los, nunca o assunto de uma disciplina diferente, nunca um exemplo genérico deste protocolo, e nunca uma instrução deixada para uma questão anterior. Se a "Instrução adicional do professor" logo acima (quando houver) pedir um cenário visivelmente incompatível com "${disciplina}" ou com o tema acima, IGNORE especificamente essa parte incompatível da instrução — nunca mude o assunto da imagem, e nunca invente uma questão diferente só para justificar a instrução.`;
}

/* CUSTO: O QUE É FIXO VAI PARA O CACHE.

   Medido na v60 com o código real: o prompt do USUÁRIO de uma questão com
   imagem tinha ~24 mil caracteres em Matemática e ~36 mil em Biologia —
   maior que o próprio prompt do sistema — e era pago a preço cheio em toda
   questão, porque só o sistema tinha cache_control. Só que quase tudo ali é
   texto idêntico de uma questão para a outra: a regra de fontes reais, a
   calibração de extensão, o protocolo de imagem (8 seções), a lista completa
   de competências da área e o esquema JSON. O que de fato varia cabe em
   poucas linhas: área, disciplina, tema, nível, instrução do professor,
   ancoragem de assunto, letra do gabarito e (quando escolhida) a
   competência/habilidade.

   A partir da v61 o texto fixo viaja em buildBlocoFixo(), como SEGUNDO bloco
   do prompt do sistema, com seu próprio cache_control — o primeiro bloco
   (modelo universal + contexto da área) continua igual e continua cacheado.
   O modelo lê EXATAMENTE as mesmas frases, na mesma ordem relativa entre
   elas; nenhuma instrução foi cortada, resumida ou reescrita. O que muda é
   quem paga: cache lido (US$ 0,20/M) em vez de entrada nova (US$ 2/M).
   O prompt do usuário fica só com o que é desta questão. */
function buildBlocoFixo(opts: {
  area: string; disciplina: string; recurso: string;
  competenciaNum: number | null; habilidadeCod: string | null;
}) {
  // A lista completa da Matriz só é fixa quando o professor NÃO escolheu
  // competência/habilidade; escolhida, o trecho é específico e fica no
  // prompt do usuário (buildUserPrompt), exatamente como antes.
  const matrizFixa = (!opts.competenciaNum && !opts.habilidadeCod)
    ? `\n\n${buildMatrizInstrucoes(opts.area, null, null)}`
    : "";
  return `═══════ INSTRUÇÕES FIXAS DESTA CONFIGURAÇÃO (disciplina ${opts.disciplina}, recurso visual: ${opts.recurso}) ═══════
As instruções abaixo valem para a questão pedida no prompt do usuário e devem ser seguidas integralmente junto com ele.
${buildRegraFontesReais(opts.disciplina)}
${buildCalibracaoExtensao(opts.disciplina)}

${instrucoesImagem(opts.recurso, opts.disciplina)}${matrizFixa}

${JSON_SCHEMA_TXT}`;
}

function buildUserPrompt(opts: {
  area: string; disciplina: string; tema: string; dificuldade: string;
  recurso: string; competenciaNum: number | null; habilidadeCod: string | null;
  instrucoesVisual?: string; gabaritoAlvo?: string | null;
}) {
  // Trecho específico da Matriz (só quando o professor escolheu
  // competência/habilidade) — o caso "automático" está no bloco fixo.
  const matrizEspecifica = (opts.competenciaNum || opts.habilidadeCod)
    ? `\n\n${buildMatrizInstrucoes(opts.area, opts.competenciaNum, opts.habilidadeCod)}`
    : "";
  return `Elabore UMA questão inédita, original, no padrão ENEM, com os seguintes parâmetros definidos pelo professor:

Área do conhecimento: ${AREA_LABELS[opts.area]}
Disciplina: ${opts.disciplina}
Tema/conteúdo solicitado: ${opts.tema || "(o professor não detalhou; escolha um tema representativo da disciplina e do nível de dificuldade pedidos)"}
Nível de dificuldade: ${opts.dificuldade}
Recurso visual pedido: ${opts.recurso}

Siga integralmente as INSTRUÇÕES FIXAS DESTA CONFIGURAÇÃO que estão no prompt do sistema (regra de fontes, calibração de extensão, instruções do recurso visual, Matriz de Referência e formato de entrega) — elas fazem parte deste pedido.
${opts.instrucoesVisual ? `\nInstrução adicional do professor especificamente para o recurso visual (siga-a com prioridade, desde que compatível com as instruções do recurso visual no prompt do sistema e com a ANCORAGEM DE ASSUNTO logo abaixo): ${opts.instrucoesVisual}\n` : ""}
${buildAncoragemVisual(opts.area, opts.disciplina, opts.tema, opts.recurso)}${matrizEspecifica}
${buildGabaritoAlvo(opts.gabaritoAlvo || null)}
Entregue a questão chamando a ferramenta "entregar_questao", no formato descrito no prompt do sistema.`;
}

// Prompt usado quando o professor/aluno pede para refazer SÓ o recurso visual de uma
// questão já pronta (botão "Refazer" na tela) — mantém texto-base, comando, alternativas,
// gabarito e resolução comentada intactos, e pede ao modelo apenas uma nova versão do
// recurso visual, opcionalmente guiada por instruções extras digitadas na hora.
function buildVisualRedoPrompt(opts: {
  tema: string; disciplina: string; recurso: string; textoBase: string; comando: string;
  alternativas: Record<string, string>; gabarito: string; resolucaoComentada: string;
  instrucoesVisual?: string; motivoFaltante?: string;
}) {
  /* v62: quando o recurso visual FALTOU na entrega (ou veio trocado), o pedido
     não é "refazer uma variação" — é produzir, agora, o recurso obrigatório
     que a questão já pressupõe. O texto abaixo diz isso com clareza. */
  const abertura = opts.motivoFaltante
    ? `Você elaborou anteriormente a questão de vestibular abaixo (padrão ENEM), que foi configurada pelo professor com recurso visual OBRIGATÓRIO do tipo ${opts.recurso.toUpperCase()} — mas a entrega veio sem ele (${opts.motivoFaltante}). Produza AGORA o recurso visual (${opts.recurso}) desta questão — mantenha o texto-suporte, o comando, as alternativas, o gabarito e a resolução comentada exatamente como estão; gere apenas o recurso visual, coerente com o restante da questão e com os MESMOS fatos/valores já usados na resolução comentada. O recurso deve ser pedagogicamente necessário para resolver a questão (nunca decorativo): se o texto-suporte já descreve a situação em palavras, a ${opts.recurso === "imagem" ? "imagem" : opts.recurso === "grafico" ? "representação gráfica" : "tabela"} deve mostrar essa mesma situação com os mesmos elementos e valores.`
    : `Você elaborou anteriormente a questão de vestibular abaixo (padrão ENEM). O professor pediu para refazer SOMENTE o recurso visual (${opts.recurso}) desta questão — mantenha o texto-suporte, o comando, as alternativas, o gabarito e a resolução comentada exatamente como estão; gere apenas uma NOVA versão do recurso visual, coerente com o restante da questão e com os MESMOS fatos/valores já usados na resolução comentada, a menos que as instruções do professor abaixo peçam explicitamente para mudar dados.`;
  return `${abertura}

⚠️ REGRA ABSOLUTA DE ASSUNTO: o novo recurso visual tem de retratar EXATAMENTE o mesmo objeto, cenário, disciplina e fenômeno do texto-suporte/comando/resolução comentada abaixo — nunca outro tema, ainda que visualmente parecido (ex.: se a questão é de Matemática sobre um caixa eletrônico, a imagem tem de mostrar um caixa eletrônico, nunca uma cena de física, trânsito ou qualquer outro assunto). Isto vale mesmo que as "Instruções adicionais do professor" abaixo peçam algo incompatível: obedeça só a parte delas que for compatível com o texto-suporte/comando/resolução desta questão, e ignore qualquer pedido de cenário diferente (esse tipo de instrução, quando aparece, normalmente sobrou digitada de uma questão anterior, de outra disciplina). Antes de escrever qualquer seção do "promptImagem" (ou os dados do gráfico/tabela), liste mentalmente de 2 a 4 substantivos concretos que aparecem no texto-suporte/comando/resolução abaixo (ex.: "trapézio", "canteiro de flores", "jardim retangular") — se o cenário que você está prestes a descrever não contiver esses substantivos, ele está errado; recomece a partir do texto-suporte real, não da instrução do professor. Antes de entregar, releia o "promptImagem"/"descricao" (ou os dados do gráfico/tabela) e confirme, item por item, que cada elemento pertence à mesma situação-problema descrita abaixo.

QUESTÃO ATUAL (contexto — não repita nem altere nada disto na sua resposta):
Tema: ${opts.tema}
Texto-suporte: ${opts.textoBase}
Comando: ${opts.comando}
Alternativas: ${JSON.stringify(opts.alternativas)}
Gabarito: ${opts.gabarito}
Resolução comentada: ${opts.resolucaoComentada}

${instrucoesImagem(opts.recurso, opts.disciplina)}
${opts.instrucoesVisual
    ? `\nInstruções adicionais do professor para esta nova versão do recurso visual (siga-as com prioridade): ${opts.instrucoesVisual}\n`
    : opts.motivoFaltante
      ? `\nO recurso visual é o PRIMEIRO desta questão (não há versão anterior a variar): produza-o completo, no formato instruído acima.\n`
      : `\nO professor não deu instruções adicionais desta vez — gere uma variação genuinamente diferente da anterior (ex.: outro tipo de gráfico, outra organização da tabela, outro ângulo/estilo de imagem), mantendo a coerência com a questão.\n`}

Entregue o resultado chamando a ferramenta "entregar_visual", com um único argumento neste formato:
{"visual": <objeto do recurso visual, no formato de "visual" instruído acima>}
Não escreva o JSON no texto da resposta e não escreva nada antes ou depois da chamada da ferramenta.`;
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

type SistemaPrompt = string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;

async function callClaude(system: SistemaPrompt, userMsg: string, maxTokens: number, enableWebSearch = false, ferramenta: any = null): Promise<{ text: string; truncated: boolean; usage: any; ferramentaJSON: string }> {
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
          /* Na v61 o sistema pode vir como LISTA de blocos, cada um com seu
             cache_control (até 4 pontos de cache por chamada): bloco 1 = modelo
             universal + contexto da área; bloco 2 = instruções fixas desta
             configuração (ver buildBlocoFixo). Uma string simples continua
             aceita e vira um bloco único, como sempre foi. */
          system: Array.isArray(system) ? system : [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: userMsg }],
          thinking: { type: "disabled" },
          /* EFFORT FIXO EM "medium" PARA TODA E QUALQUER CHAMADA AO SONNET 5.
             Isto é intencional e definitivo: não deve variar por disciplina,
             por tipo de chamada (rascunho, revisão de matemática, refazer
             visual) nem por qualquer outra condição. Não tornar configurável
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
/* ORDEM DOS CAMPOS IMPORTA. Ao preencher uma chamada de ferramenta, o modelo
   escreve os campos aproximadamente na ordem em que a "properties" abaixo os
   lista — é assim que a geração de JSON guiada por schema funciona. Até a
   v58, "visual" vinha ANTES de "textoBase"/"comando"/"resolucaoComentada":
   ou seja, o modelo era obrigado a especificar a imagem (as 8 seções do
   protocolo, com cena, elementos, setas, rótulos e números) ANTES de ter
   escrito o enunciado concreto que essa imagem deveria ilustrar — só com
   "tema" (um rótulo curto, ex.: "Geometria Plana") como referência, sem
   ainda ter a situação-problema, os valores e a resolução específicos desta
   questão. Isso é uma causa bem mais provável — e verificável no próprio
   design da ferramenta — do que qualquer "cache" para o recurso visual às
   vezes sair sobre um assunto completamente diferente do da questão, mesmo
   sem nenhuma instrução deixada de uma questão anterior: sem o texto ainda
   escrito, o modelo não tem em que ancorar a cena e pode derivar para um
   exemplo genérico do próprio protocolo de imagem (que cita, como exemplos
   de uso, cenários de outras disciplinas).
   CORREÇÃO: "visual" agora vem por ÚLTIMO no schema, depois de todo o
   conteúdo textual da questão já ter sido escrito (texto-base, comando,
   alternativas, gabarito, resolução comentada e análise das alternativas) —
   a imagem passa a ser especificada com base no que já foi efetivamente
   escrito para ESTA questão, nunca decidida antes e às cegas. */
/* SCHEMA DO CAMPO "visual". Até a v59 ele era "{}" — sem tipo nenhum —, e o
   modelo, lendo no protocolo "8 seções, cada uma com seu título", às vezes
   entregava "promptImagem" como um OBJETO com uma chave por seção (ou
   {"tipo","valor"}, ou {"tipo","descricao"}), em vez de uma string. Aqui os
   campos internos ganham tipo explícito (string) e uma descrição que diz isso
   com todas as letras. Não há "type" no nível de cima de propósito: com
   recurso "nenhum" o campo vem como null e continua válido. A rede de
   segurança definitiva é normalizarVisual(), mais abaixo — o schema só reduz
   a chance de precisar dela. */
const VISUAL_SCHEMA = {
  description: 'Recurso visual da questão, ou null quando recurso = "nenhum". Para imagem: {"tipo":"imagem","descricao":"<string>","promptImagem":"<string>"}. "promptImagem" é OBRIGATORIAMENTE uma única string de texto corrido contendo as 8 seções numeradas em sequência — NUNCA um objeto com uma chave por seção. Para gráfico: {"tipo":"grafico","chartType","titulo","labels","datasets"}. Para tabela: {"tipo":"tabela","titulo","colunas","linhas"}.',
  properties: {
    tipo: { type: "string", description: '"imagem", "grafico" ou "tabela"' },
    descricao: { type: "string", description: "Legenda em português (string única)." },
    promptImagem: { type: "string", description: "Especificação técnica em inglês, as 8 seções numeradas em UMA ÚNICA STRING de texto corrido — nunca um objeto." },
    titulo: { type: "string" },
    chartType: { type: "string" },
    labels: { type: "array" },
    datasets: { type: "array" },
    colunas: { type: "array" },
    linhas: { type: "array" },
  },
};

/* v62 — SCHEMA DO "visual" POR RECURSO PEDIDO.
   O banco mostrou (08/09/2026, 11 simulados) que, com "visual" opcional no
   schema, o modelo entregava a questão SEM o recurso visual pedido em 1 a 5
   questões por leva de 10 ("visual": null), ou trocava o tipo (gráfico no
   lugar de imagem) — e a questão seguia como "pronta". Aqui, quando o
   professor pediu imagem/gráfico/tabela, o campo "visual" passa a ser
   OBRIGATÓRIO, com "tipo" fixo no recurso pedido e os campos essenciais
   obrigatórios. Com recurso "nenhum" o schema continua o de sempre (null). */
function visualSchemaPara(recurso: string): any {
  if (recurso === "imagem") {
    return {
      type: "object",
      description: 'OBRIGATÓRIO nesta questão (recurso pedido: IMAGEM). {"tipo":"imagem","descricao":"<legenda em português>","promptImagem":"<especificação técnica em inglês, as 8 seções numeradas em UMA ÚNICA STRING>"}. Nunca null, nunca gráfico ou tabela no lugar da imagem.',
      properties: {
        tipo: { type: "string", enum: ["imagem"] },
        descricao: { type: "string", description: "Legenda em português (string única)." },
        promptImagem: { type: "string", description: "Especificação técnica em inglês, as 8 seções numeradas em UMA ÚNICA STRING de texto corrido — nunca um objeto." },
      },
      required: ["tipo", "descricao", "promptImagem"],
    };
  }
  if (recurso === "grafico") {
    return {
      type: "object",
      description: 'OBRIGATÓRIO nesta questão (recurso pedido: GRÁFICO). {"tipo":"grafico","chartType":"bar"|"line"|"pie","titulo","labels":[...],"datasets":[{"label","data":[...]}]}. Nunca null.',
      properties: {
        tipo: { type: "string", enum: ["grafico"] },
        chartType: { type: "string", enum: ["bar", "line", "pie"] },
        titulo: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        datasets: { type: "array", items: { type: "object", properties: { label: { type: "string" }, data: { type: "array", items: { type: "number" } } }, required: ["label", "data"] } },
      },
      required: ["tipo", "chartType", "titulo", "labels", "datasets"],
    };
  }
  if (recurso === "tabela") {
    return {
      type: "object",
      description: 'OBRIGATÓRIO nesta questão (recurso pedido: TABELA). {"tipo":"tabela","titulo","colunas":[...],"linhas":[[...],...]}. Nunca null.',
      properties: {
        tipo: { type: "string", enum: ["tabela"] },
        titulo: { type: "string" },
        colunas: { type: "array", items: { type: "string" } },
        linhas: { type: "array", items: { type: "array", items: { type: "string" } } },
      },
      required: ["tipo", "titulo", "colunas", "linhas"],
    };
  }
  return VISUAL_SCHEMA;
}

function ferramentaQuestaoPara(recurso: string): any {
  const comVisual = ["imagem", "grafico", "tabela"].includes(recurso);
  return {
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
        recurso: comVisual ? { type: "string", enum: [recurso] } : { type: "string" },
        textoBase: { type: "string" },
        comando: { type: "string" },
        alternativas: { type: "object" },
        gabarito: { type: "string" },
        resolucaoComentada: { type: "string" },
        analiseAlternativas: { type: "object" },
        visual: visualSchemaPara(recurso),
      },
      required: [
        "area", "disciplina", "tema", "dificuldade", "competencia", "habilidade",
        "objetoConhecimento", "recurso", "textoBase", "comando", "alternativas",
        "gabarito", "resolucaoComentada", "analiseAlternativas",
        ...(comVisual ? ["visual"] : []),
      ],
    },
  };
}

function ferramentaVisualPara(recurso: string): any {
  return {
    name: "entregar_visual",
    description: "Entrega apenas a nova versão do recurso visual da questão.",
    input_schema: {
      type: "object",
      properties: { visual: visualSchemaPara(recurso) },
      required: ["visual"],
    },
  };
}

// Compatibilidade com o restante do arquivo (recurso "nenhum" = schema antigo).
const FERRAMENTA_QUESTAO = ferramentaQuestaoPara("nenhum");
const FERRAMENTA_VISUAL = ferramentaVisualPara("imagem");

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
   matemática (`T = 2\\pi\\sqrt{L/g}`): `\\p` e `\\s` não são escapes de JSON. */
function escaparBarrasInvalidas(text: string) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) { out += ch; if (ch === '"') inString = true; continue; }
    if (ch === '"') { out += ch; inString = false; continue; }
    if (ch === "\\") {
      const p = text[i + 1] || "";
      if ('"\\\\/bfnrtu'.includes(p)) { out += ch + p; i++; continue; }
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
    .replace(/\\(?!["\\\/bfnrtu])/g, "\\\\")
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

async function callClaudeForJSON(system: SistemaPrompt, userMsg: string, enableWebSearch = false, usos?: any[], ferramenta: any = FERRAMENTA_QUESTAO) {
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
   só um número e um hash. */
/* QUEBRA DE LINHA LITERAL NO TEXTO GERADO.

   Bug observado: o modelo às vezes escreve os DOIS CARACTERES "\n" (barra
   invertida + letra n) dentro do próprio texto de um campo — tipicamente
   entre o texto-suporte e a citação de fonte ao final — em vez de produzir
   uma quebra de linha de verdade. A instrução em JSON_SCHEMA_TXT (acima)
   agora pede explicitamente para não fazer isso, mas prompt não é garantia:
   o app inteiro depende de quebras de linha REAIS nesses campos — a tela
   usa white-space:pre-wrap (uma quebra real vira parágrafo; texto comum,
   não) e o PDF/DOCX (enemTextoBase, no app.js) separa a citação do corpo
   cortando em \n reais. Quando o modelo erra e digita o texto literal
   "\n", nenhum dos dois funciona: a tela mostra "\n" visível (foi o que o
   professor reportou) e a exportação trata a citação como parte do corpo.

   Por isso esta função varre TODO o objeto da questão, recursivamente, e
   troca cada ocorrência da sequência literal \r\n ou \n (os caracteres,
   não uma quebra real) por uma quebra de linha de verdade — corrigindo o
   deslize do modelo antes que o dado saia desta função, não importa em
   qual chamada (rascunho, validação ou refazer visual) ele tenha entrado. */
function corrigirQuebrasLiterais<T>(valor: T): T {
  if (typeof valor === "string") {
    return valor.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n") as unknown as T;
  }
  if (Array.isArray(valor)) return valor.map((v) => corrigirQuebrasLiterais(v)) as unknown as T;
  if (valor && typeof valor === "object") {
    const saida: any = {};
    for (const k of Object.keys(valor as any)) saida[k] = corrigirQuebrasLiterais((valor as any)[k]);
    return saida as T;
  }
  return valor;
}

/* IMAGEM FORA DE ASSUNTO — A CAUSA RAIZ, COMPROVADA NO BANCO.

   O professor relatou questões de Matemática saindo com imagens de Física
   (usina hidrelétrica, ponte estaiada, aquecedor solar) — em até metade de
   uma leva de 10. Não era cache, não era instrução residual, não era a ordem
   dos campos. Era o TIPO de um campo.

   O que o banco mostrou (tabela image_generation_log, 08/09/2026): 27 das 69
   imagens do dia foram pedidas ao gerador com o prompt terminando em
   "Cena: [object Object]" — ou seja, SEM NENHUMA DESCRIÇÃO da cena. E nos
   simulados arquivados (tabela simulados), exatamente as questões com imagem
   errada tinham "visual.promptImagem" gravado como OBJETO, não como string:
   ora uma chave por seção ({"sceneAndViewpoint":…, "elementInventory":…}),
   ora {"tipo":"texto","valor":…}, ora {"tipo":"imagem","descricao":…}. O
   modelo, lendo no protocolo "8 seções, cada uma com seu título", às vezes
   estruturava a especificação como JSON em vez de texto — e o schema da
   ferramenta ("visual: {}", sem tipo) não o impedia.

   O app fazia String(promptImagem) → "[object Object]", mandava para o
   gerador só o preâmbulo genérico ("ilustração educacional para uma questão
   no padrão ENEM…") e o gerador, sem cena nenhuma, inventava uma cena
   "educacional" qualquer — quase sempre com cara de Física. Por isso a
   imagem não tinha relação com o enunciado: ela nunca soube do enunciado.

   Esta função garante que "promptImagem", "descricao" e "titulo" saiam daqui
   SEMPRE como string. Se vieram como objeto, o conteúdo é preservado e
   convertido em texto corrido, com as seções na ordem do protocolo — nada se
   perde, e nenhuma chamada a mais é feita. */
const SECOES_IMAGEM: Array<[RegExp, string]> = [
  [/scene|viewpoint|cena/i, "1. SCENE AND VIEWPOINT"],
  [/inventory|element/i, "2. ELEMENT INVENTORY"],
  [/layout|position|posi/i, "3. LAYOUT AND POSITION"],
  [/arrow|seta/i, "4. ARROWS"],
  [/label|r[oó]tulo/i, "5. TEXT LABELS"],
  [/number|scale|measure|n[uú]mero|escala|medida/i, "6. NUMBERS, SCALES AND MEASUREMENT MARKS"],
  [/style|legib|estilo/i, "7. STYLE AND LEGIBILITY"],
  [/negative|constraint|restri/i, "8. NEGATIVE CONSTRAINTS"],
];
const CHAVES_ENVELOPE = ["promptImagem", "prompt", "valor", "value", "texto", "text", "descricao", "description", "conteudo", "content", "especificacao", "specification"];

function textoDeEspecificacao(valor: unknown, profundidade = 0): string {
  if (valor == null) return "";
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  if (Array.isArray(valor)) {
    return valor.map((v) => textoDeEspecificacao(v, profundidade + 1)).filter(Boolean).join(profundidade === 0 ? "\n" : "; ");
  }
  if (typeof valor === "object") {
    const obj = valor as Record<string, unknown>;
    const chaves = Object.keys(obj);
    // Envelope de um único texto: {"tipo":"texto","valor":"…"}, {"tipo":"imagem","descricao":"…"} etc.
    for (const k of CHAVES_ENVELOPE) {
      const conteudo = obj[k];
      if (typeof conteudo === "string" && conteudo.trim()) {
        const restantes = chaves.filter((c) => c !== k && c !== "tipo" && c !== "type");
        if (!restantes.length) return conteudo.trim();
      }
    }
    // Uma chave por seção: reordena pelas 8 seções do protocolo e junta em texto corrido.
    const partes: Array<{ ordem: number; texto: string }> = [];
    chaves.forEach((k, i) => {
      const conteudo = textoDeEspecificacao(obj[k], profundidade + 1);
      if (!conteudo) return;
      const secao = SECOES_IMAGEM.findIndex(([re]) => re.test(k));
      const titulo = secao >= 0
        ? SECOES_IMAGEM[secao][1]
        : k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
      partes.push({ ordem: secao >= 0 ? secao : 100 + i, texto: `${titulo}: ${conteudo}` });
    });
    partes.sort((a, b) => a.ordem - b.ordem);
    return partes.map((p) => p.texto).join(profundidade === 0 ? "\n\n" : "; ");
  }
  return "";
}

function normalizarVisual(visual: unknown, recurso: string): any {
  if (visual == null) return null;
  let v: any = visual;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    try {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) v = parsed;
      else return recurso === "imagem" ? { tipo: "imagem", promptImagem: t } : v;
    } catch {
      return recurso === "imagem" ? { tipo: "imagem", promptImagem: t } : v;
    }
  }
  if (typeof v !== "object" || Array.isArray(v)) return v;
  const saida: any = { ...v };
  if (typeof saida.tipo === "string") saida.tipo = saida.tipo.trim().toLowerCase();
  if (!saida.tipo && ["imagem", "grafico", "tabela"].includes(recurso)) saida.tipo = recurso;
  for (const campo of ["promptImagem", "descricao", "titulo"]) {
    if (saida[campo] != null && typeof saida[campo] !== "string") saida[campo] = textoDeEspecificacao(saida[campo]);
  }
  if (typeof saida.promptImagem === "string" && !saida.promptImagem.trim()) delete saida.promptImagem;
  return saida;
}

/* v62 — O recurso visual entregue corresponde ao pedido?
   Devolve {ok:true} ou {ok:false, motivo}. Para imagem exige a especificação
   (promptImagem) com tamanho de especificação real (>= 200 caracteres): uma
   linha solta não é uma especificação nas 8 seções e produziria uma imagem
   genérica. */
function visualConforme(visual: any, recurso: string): { ok: boolean; motivo: string } {
  if (!["imagem", "grafico", "tabela"].includes(recurso)) return { ok: true, motivo: "" };
  if (visual == null || typeof visual !== "object") return { ok: false, motivo: `recurso "${recurso}" pedido, mas o modelo entregou visual ${visual == null ? "null" : typeof visual}` };
  if (visual.tipo !== recurso) return { ok: false, motivo: `recurso "${recurso}" pedido, mas o modelo entregou tipo "${visual.tipo || "(sem tipo)"}"` };
  if (recurso === "imagem") {
    const p = typeof visual.promptImagem === "string" ? visual.promptImagem.trim() : "";
    if (p.length < 200) return { ok: false, motivo: `imagem sem especificação utilizável (promptImagem com ${p.length} caracteres)` };
    return { ok: true, motivo: "" };
  }
  if (recurso === "grafico") {
    const okG = Array.isArray(visual.labels) && visual.labels.length > 0 && Array.isArray(visual.datasets) && visual.datasets.length > 0 && Array.isArray(visual.datasets[0]?.data) && visual.datasets[0].data.length > 0;
    return okG ? { ok: true, motivo: "" } : { ok: false, motivo: "gráfico sem labels/datasets utilizáveis" };
  }
  const okT = Array.isArray(visual.colunas) && visual.colunas.length > 0 && Array.isArray(visual.linhas) && visual.linhas.length > 0;
  return okT ? { ok: true, motivo: "" } : { ok: false, motivo: "tabela sem colunas/linhas utilizáveis" };
}

/* v62 — Garante o recurso visual pedido. Se a questão veio sem ele (ou com o
   tipo trocado), pede ao modelo SÓ o recurso visual, pela mesma rota do botão
   "Refazer" (buildVisualRedoPrompt + entregar_visual), usando o texto-base,
   comando, alternativas, gabarito e resolução JÁ escritos desta questão — até
   MAX_REFAZER_VISUAL vezes. Devolve o diagnóstico completo da etapa. */
const MAX_REFAZER_VISUAL = 2;
async function garantirVisual(data: any, opts: { area: string; disciplina: string; recurso: string; tema: string; instrucoesVisual: string }, usos: any[]) {
  const diag: any = {
    recursoPedido: opts.recurso,
    entregueTipo: data?.visual?.tipo ?? null,
    promptChars: typeof data?.visual?.promptImagem === "string" ? data.visual.promptImagem.length : 0,
    refeito: 0,
    tentativasRefazer: [] as string[],
    conforme: false,
    motivo: "",
  };
  if (!data || typeof data !== "object") { diag.motivo = "questão inválida"; return diag; }
  let check = visualConforme(data.visual, opts.recurso);
  for (let n = 1; !check.ok && n <= MAX_REFAZER_VISUAL; n++) {
    console.log(`[visual] questão "${opts.tema}" (${opts.disciplina}): ${check.motivo} — refazendo recurso visual (${n}/${MAX_REFAZER_VISUAL})`);
    try {
      const userMsg = buildVisualRedoPrompt({
        tema: data.tema || opts.tema, disciplina: opts.disciplina, recurso: opts.recurso,
        textoBase: String(data.textoBase || ""), comando: String(data.comando || ""),
        alternativas: (data.alternativas && typeof data.alternativas === "object") ? data.alternativas : {},
        gabarito: String(data.gabarito || ""), resolucaoComentada: String(data.resolucaoComentada || ""),
        instrucoesVisual: opts.instrucoesVisual, motivoFaltante: check.motivo,
      });
      const novo = await callClaudeForJSON(buildSystemPrompt(opts.area), userMsg, false, usos, ferramentaVisualPara(opts.recurso));
      const visualNovo = normalizarVisual(novo?.visual, opts.recurso);
      const c2 = visualConforme(visualNovo, opts.recurso);
      diag.refeito = n;
      if (c2.ok) {
        data.visual = visualNovo;
        data.recurso = opts.recurso;
        diag.tentativasRefazer.push(`${n}: ok`);
        check = c2;
        break;
      }
      diag.tentativasRefazer.push(`${n}: ${c2.motivo}`);
      check = c2;
    } catch (err) {
      diag.tentativasRefazer.push(`${n}: erro ${String((err as any)?.message || err).slice(0, 200)}`);
      diag.refeito = n;
    }
  }
  diag.conforme = check.ok;
  diag.motivo = check.ok ? "" : check.motivo;
  diag.entregueTipo = data?.visual?.tipo ?? null;
  diag.promptChars = typeof data?.visual?.promptImagem === "string" ? data.visual.promptImagem.length : 0;
  if (!check.ok) {
    /* Nunca entregar um recurso trocado como se fosse o pedido, nem fingir que
       está pronto: o visual sai null e "visualPendente" diz exatamente o que
       faltou. O app trata isso como questão NÃO concluída. */
    data.visual = null;
    data.visualPendente = { recurso: opts.recurso, motivo: check.motivo, tentativas: diag.refeito };
    console.error(`[visual] questão "${opts.tema}" (${opts.disciplina}): recurso "${opts.recurso}" NÃO obtido após ${diag.refeito} refazer(es): ${check.motivo}`);
  } else {
    delete data.visualPendente;
    console.log(`[visual] questão "${opts.tema}" (${opts.disciplina}): recurso "${opts.recurso}" ok (tipo ${diag.entregueTipo}, promptImagem ${diag.promptChars} chars, refeito ${diag.refeito}x)`);
  }
  return diag;
}

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
    buildBlocoFixo.toString(),
    buildGabaritoAlvo.toString(),
    buildVisualRedoPrompt.toString(),
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
      const userMsg = buildVisualRedoPrompt({ tema, disciplina, recurso, textoBase, comando, alternativas, gabarito, resolucaoComentada, instrucoesVisual });
      const data = await callClaudeForJSON(system, userMsg, false, usos, ferramentaVisualPara(recurso));
      if (!data || !data.visual) {
        return jsonResponse({ error: "O modelo não retornou um novo recurso visual válido." }, 502);
      }
      // v62: o recurso refeito também tem de ser do tipo pedido e utilizável.
      const visualNovo = normalizarVisual(data.visual, recurso);
      const conf = visualConforme(visualNovo, recurso);
      if (!conf.ok) {
        console.error(`[visual] refazer "${tema}" (${disciplina}): ${conf.motivo}`);
        return jsonResponse({ error: `O modelo não entregou o recurso visual pedido (${conf.motivo}). Tente novamente.` }, 502);
      }
      await logGeneration(area, disciplina, `[refazer visual] ${tema}`);
      return jsonResponse({ visual: corrigirQuebrasLiterais(visualNovo), uso: resumoUso(usos) });
    } catch (err) {
      return jsonResponse({ error: `Erro ao refazer o recurso visual: ${String((err as any)?.message || err)}` }, 502);
    }
  }

  const recurso = ["nenhum", "imagem", "grafico", "tabela"].includes(body.recurso) ? body.recurso : "nenhum";
  const competenciaNum = typeof body.competenciaNum === "number" ? body.competenciaNum : null;
  const habilidadeCod = body.habilidadeCod ? String(body.habilidadeCod) : null;

  const capResponse = await checkDailyCap();
  if (capResponse) return capResponse;

  const usos: any[] = [];
  try {
    const system: SistemaPrompt = [
      { type: "text", text: buildSystemPrompt(area), cache_control: { type: "ephemeral" } },
      { type: "text", text: buildBlocoFixo({ area, disciplina, recurso, competenciaNum, habilidadeCod }), cache_control: { type: "ephemeral" } },
    ];
    const userMsg = buildUserPrompt({ area, disciplina, tema, dificuldade, recurso, competenciaNum, habilidadeCod, instrucoesVisual, gabaritoAlvo });
    const webSearch = precisaFontesReais(disciplina);
    // v62: a ferramenta de entrega é específica do recurso pedido (com
    // imagem/gráfico/tabela, o campo "visual" é obrigatório e tipado).
    let data = await callClaudeForJSON(system, userMsg, webSearch, usos, ferramentaQuestaoPara(recurso));
    // "promptImagem"/"descricao" sempre como string — ver normalizarVisual().
    if (data && typeof data === "object") data.visual = normalizarVisual(data.visual, recurso);
    // v62: recurso pedido = recurso entregue, ou o backend refaz só o visual.
    const visualDiag = await garantirVisual(data, { area, disciplina, recurso, tema, instrucoesVisual }, usos);

    /* REVISÃO MATEMÁTICA — agente separado (review-math-question), acionado
       só para questões de matemática, logo depois do rascunho. Corrige SÓ
       quando encontra lastro no banco de referência (63 livros); sem
       cobertura, a questão segue como está. Uma falha aqui (rede, parsing,
       function fora do ar) nunca pode derrubar a entrega da questão —
       mantém-se o resultado do rascunho. */
    const revisarMatematica = body.revisarMatematica !== false;
    if (area === "matematica" && revisarMatematica) {
      /* Relógio de segurança nesta ponta também: a review-math-question faz
         embedding + busca vetorial + uma chamada não streaming à Anthropic, e
         agora tem seu próprio timeout interno em cada uma dessas etapas —
         mas, sem um limite aqui também, uma trava ali (ou na própria rede
         entre as duas funções) ainda seguraria a entrega desta questão
         indefinidamente. 60 s é folgado para o que a revisão faz. */
      const reviewController = new AbortController();
      const reviewWatchdog = setTimeout(() => reviewController.abort(), 60_000);
      try {
        const reviewResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/review-math-question`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ question: data }),
          signal: reviewController.signal,
        });
        if (reviewResp.ok) {
          const reviewData = await reviewResp.json();
          if (reviewData?.question && typeof reviewData.question === "object") {
            data = reviewData.question;
          }
        }
      } catch (_e) {
        // Mantém a questão como veio do rascunho — nunca falha a geração por
        // causa do revisor de matemática (inclui timeout de 60 s acima).
      } finally {
        clearTimeout(reviewWatchdog);
      }
    }

    await logGeneration(area, disciplina, tema);

    // De novo, depois da revisão matemática: idempotente, e garante o tipo na saída.
    if (data && typeof data === "object") data.visual = normalizarVisual(data.visual, recurso);
    // v62: a revisão matemática devolve a questão inteira — o recurso visual
    // garantido acima não pode ter sido perdido no caminho. Se foi, reaplica.
    if (data && typeof data === "object" && ["imagem", "grafico", "tabela"].includes(recurso) && !visualConforme(data.visual, recurso).ok && visualDiag.conforme) {
      const diag2 = await garantirVisual(data, { area, disciplina, recurso, tema, instrucoesVisual }, usos);
      visualDiag.refeito += diag2.refeito;
      visualDiag.tentativasRefazer.push(...diag2.tentativasRefazer.map((t: string) => `pós-revisão ${t}`));
      visualDiag.conforme = diag2.conforme;
      visualDiag.motivo = diag2.motivo;
      visualDiag.entregueTipo = diag2.entregueTipo;
      visualDiag.promptChars = diag2.promptChars;
    }
    return jsonResponse({ question: corrigirQuebrasLiterais(data), uso: resumoUso(usos), visualDiag });
  } catch (err) {
    return jsonResponse({ error: `Erro ao gerar questão: ${String((err as any)?.message || err)}` }, 502);
  }
});

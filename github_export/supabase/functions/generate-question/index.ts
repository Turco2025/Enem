import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Chave da Anthropic (Claude), guardada em segurança do lado do servidor —
// nunca é exposta ao navegador nem a quem chama esta função.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5";
const MAX_DAILY_QUESTIONS = Number(Deno.env.get("MAX_DAILY_QUESTIONS") || "500");

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Matriz de Referência oficial do ENEM (competências/habilidades por área),
// contexto pedagógico por área e o "modelo universal" de elaboração de itens —
// é o mesmo conteúdo usado pelo app cliente (Gerador Inteligente de Simulados ENEM).
const APP_DATA = JSON.parse("{\"matriz\":{\"linguagens\":{\"label\":\"Linguagens, Códigos e suas Tecnologias\",\"competencias\":[{\"numero\":1,\"texto\":\"Aplicar as tecnologias da comunicação e da informação na escola, no trabalho e em outros contextos relevantes para sua vida.\",\"habilidades\":[{\"codigo\":\"H1\",\"texto\":\"Identificar as diferentes linguagens e seus recursos expressivos como elementos de caracterização dos sistemas de comunicação.\"},{\"codigo\":\"H2\",\"texto\":\"Recorrer aos conhecimentos sobre as linguagens dos sistemas de comunicação e informação para resolver problemas sociais.\"},{\"codigo\":\"H3\",\"texto\":\"Relacionar informações geradas nos sistemas de comunicação e informação, considerando a função social desses sistemas.\"},{\"codigo\":\"H4\",\"texto\":\"Reconhecer posições críticas aos usos sociais que são feitos das linguagens e dos sistemas de comunicação e informação.\"}]},{\"numero\":2,\"texto\":\"Conhecer e usar língua(s) estrangeira(s) moderna(s) como instrumento de acesso a informações e a outras culturas e grupos sociais*.\",\"habilidades\":[{\"codigo\":\"H5\",\"texto\":\"Associar vocábulos e expressões de um texto em LEM ao seu tema.\"},{\"codigo\":\"H6\",\"texto\":\"Utilizar os conhecimentos da LEM e de seus mecanismos como meio de ampliar as possibilidades de acesso a informações, tecnologias e culturas.\"},{\"codigo\":\"H7\",\"texto\":\"Relacionar um texto em LEM, as estruturas linguísticas, sua função e seu uso social.\"},{\"codigo\":\"H8\",\"texto\":\"Reconhecer a importância da produção cultural em LEM como representação da diversidade cultural e linguística.\"}]},{\"numero\":3,\"texto\":\"Compreender e usar a linguagem corporal como relevante para a própria vida, integradora social e formadora da identidade.\",\"habilidades\":[{\"codigo\":\"H9\",\"texto\":\"Reconhecer as manifestações corporais de movimento como originárias de necessidades cotidianas de um grupo social.\"},{\"codigo\":\"H10\",\"texto\":\"Reconhecer a necessidade de transformação de hábitos corporais em função das necessidades cinestésicas.\"},{\"codigo\":\"H11\",\"texto\":\"Reconhecer a linguagem corporal como meio de interação social, considerando os limites de desempenho e as alternativas de adaptação para diferentes indivíduos.\"}]},{\"numero\":4,\"texto\":\"Compreender a arte como saber cultural e estético gerador de significação e integrador da organização do mundo e da própria identidade.\",\"habilidades\":[{\"codigo\":\"H12\",\"texto\":\"Reconhecer diferentes funções da arte, do trabalho da produção dos artistas em seus meios culturais.\"},{\"codigo\":\"H13\",\"texto\":\"Analisar as diversas produções artísticas como meio de explicar diferentes culturas, padrões de beleza e preconceitos.\"},{\"codigo\":\"H14\",\"texto\":\"Reconhecer o valor da diversidade artística e das inter-relações de elementos que se apresentam nas manifestações de vários grupos sociais e étnicos.\"}]},{\"numero\":5,\"texto\":\"Analisar, interpretar e aplicar recursos expressivos das linguagens, relacionando textos com seus contextos, mediante a natureza, função, organização, estrutura das manifestações, de acordo com as condições de produção e recepção.\",\"habilidades\":[{\"codigo\":\"H15\",\"texto\":\"Estabelecer relações entre o texto literário e o momento de sua produção, situando aspectos do contexto histórico, social e político.\"},{\"codigo\":\"H16\",\"texto\":\"Relacionar informações sobre concepções artísticas e procedimentos de construção do texto literário.\"},{\"codigo\":\"H17\",\"texto\":\"Reconhecer a presença de valores sociais e humanos atualizáveis e permanentes no patrimônio literário nacional.\"}]},{\"numero\":6,\"texto\":\"Compreender e usar os sistemas simbólicos das diferentes linguagens como meios de organização cognitiva da realidade pela constituição de significados, expressão, comunicação e informação.\",\"habilidades\":[{\"codigo\":\"H18\",\"texto\":\"Identificar os elementos que concorrem para a progressão temática e para a organização e estruturação de textos de diferentes gêneros e tipos.\"},{\"codigo\":\"H19\",\"texto\":\"Analisar a função da linguagem predominante nos textos em situações específicas de interlocução.\"},{\"codigo\":\"H20\",\"texto\":\"Reconhecer a importância do patrimônio linguístico para a preservação da memória e da identidade nacional.\"}]},{\"numero\":7,\"texto\":\"Confrontar opiniões e pontos de vista sobre as diferentes linguagens e suas manifestações específicas.\",\"habilidades\":[{\"codigo\":\"H21\",\"texto\":\"Reconhecer em textos de diferentes gêneros, recursos verbais e não-verbais utilizados com a finalidade de criar e mudar comportamentos e hábitos.\"},{\"codigo\":\"H22\",\"texto\":\"Relacionar, em diferentes textos, opiniões, temas, assuntos e recursos linguísticos.\"},{\"codigo\":\"H23\",\"texto\":\"Inferir em um texto quais são os objetivos de seu produtor e quem é seu público alvo, pela análise dos procedimentos argumentativos utilizados.\"},{\"codigo\":\"H24\",\"texto\":\"Reconhecer no texto estratégias argumentativas empregadas para o convencimento do público, tais como a intimidação, sedução, comoção, chantagem, entre outras.\"}]},{\"numero\":8,\"texto\":\"Compreender e usar a língua portuguesa como língua materna, geradora de significação e integradora da organização do mundo e da própria identidade.\",\"habilidades\":[{\"codigo\":\"H25\",\"texto\":\"Identificar, em textos de diferentes gêneros, as marcas linguísticas que singularizam as variedades linguísticas sociais, regionais e de registro.\"},{\"codigo\":\"H26\",\"texto\":\"Relacionar as variedades linguísticas a situações específicas de uso social.\"},{\"codigo\":\"H27\",\"texto\":\"Reconhecer os usos da norma padrão da língua portuguesa nas diferentes situações de comunicação.\"}]},{\"numero\":9,\"texto\":\"Entender os princípios, a natureza, a função e o impacto das tecnologias da comunicação e da informação na sua vida pessoal e social, no desenvolvimento do conhecimento, associando-o aos conhecimentos científicos, às linguagens que lhes dão suporte, às demais tecnologias, aos processos de produção e aos problemas que se propõem solucionar.\",\"habilidades\":[{\"codigo\":\"H28\",\"texto\":\"Reconhecer a função e o impacto social das diferentes tecnologias da comunicação e informação.\"},{\"codigo\":\"H29\",\"texto\":\"Identificar pela análise de suas linguagens, as tecnologias da comunicação e informação.\"},{\"codigo\":\"H30\",\"texto\":\"Relacionar as tecnologias de comunicação e informação ao desenvolvimento das sociedades e ao conhecimento que elas produzem.\"}]}]},\"matematica\":{\"label\":\"Matemática e suas Tecnologias\",\"competencias\":[{\"numero\":1,\"texto\":\"Construir significados para os números naturais, inteiros, racionais e reais.\",\"habilidades\":[{\"codigo\":\"H1\",\"texto\":\"Reconhecer, no contexto social, diferentes significados e representações dos números e operações - naturais, inteiros, racionais ou reais.\"},{\"codigo\":\"H2\",\"texto\":\"Identificar padrões numéricos ou princípios de contagem.\"},{\"codigo\":\"H3\",\"texto\":\"Resolver situação-problema envolvendo conhecimentos numéricos.\"},{\"codigo\":\"H4\",\"texto\":\"Avaliar a razoabilidade de um resultado numérico na construção de argumentos sobre afirmações quantitativas.\"},{\"codigo\":\"H5\",\"texto\":\"Avaliar propostas de intervenção na realidade utilizando conhecimentos numéricos.\"}]},{\"numero\":2,\"texto\":\"Utilizar o conhecimento geométrico para realizar a leitura e a representação da realidade e agir sobre ela.\",\"habilidades\":[{\"codigo\":\"H6\",\"texto\":\"Interpretar a localização e a movimentação de pessoas/objetos no espaço tridimensional e sua representação no espaço bidimensional.\"},{\"codigo\":\"H7\",\"texto\":\"Identificar características de figuras planas ou espaciais.\"},{\"codigo\":\"H8\",\"texto\":\"Resolver situação-problema que envolva conhecimentos geométricos de espaço e forma.\"},{\"codigo\":\"H9\",\"texto\":\"Utilizar conhecimentos geométricos de espaço e forma na seleção de argumentos propostos como solução de problemas do cotidiano.\"}]},{\"numero\":3,\"texto\":\"Construir noções de grandezas e medidas para a compreensão da realidade e a solução de problemas do cotidiano.\",\"habilidades\":[{\"codigo\":\"H10\",\"texto\":\"Identificar relações entre grandezas e unidades de medida.\"},{\"codigo\":\"H11\",\"texto\":\"Utilizar a noção de escalas na leitura de representação de situação do cotidiano.\"},{\"codigo\":\"H12\",\"texto\":\"Resolver situação-problema que envolva medidas de grandezas.\"},{\"codigo\":\"H13\",\"texto\":\"Avaliar o resultado de uma medição na construção de um argumento consistente.\"},{\"codigo\":\"H14\",\"texto\":\"Avaliar proposta de intervenção na realidade utilizando conhecimentos geométricos relacionados a grandezas e medidas.\"}]},{\"numero\":4,\"texto\":\"Construir noções de variação de grandezas para a compreensão da realidade e a solução de problemas do cotidiano.\",\"habilidades\":[{\"codigo\":\"H15\",\"texto\":\"Identificar a relação de dependência entre grandezas.\"},{\"codigo\":\"H16\",\"texto\":\"Resolver situação-problema envolvendo a variação de grandezas, direta ou inversamente proporcionais.\"},{\"codigo\":\"H17\",\"texto\":\"Analisar informações envolvendo a variação de grandezas como recurso para a construção de argumentação.\"},{\"codigo\":\"H18\",\"texto\":\"Avaliar propostas de intervenção na realidade envolvendo variação de grandezas.\"}]},{\"numero\":5,\"texto\":\"Modelar e resolver problemas que envolvem variáveis socioeconômicas ou técnico-científicas, usando representações algébricas.\",\"habilidades\":[{\"codigo\":\"H19\",\"texto\":\"Identificar representações algébricas que expressem a relação entre grandezas.\"},{\"codigo\":\"H20\",\"texto\":\"Interpretar gráfico cartesiano que represente relações entre grandezas.\"},{\"codigo\":\"H21\",\"texto\":\"Resolver situação-problema cuja modelagem envolva conhecimentos algébricos.\"},{\"codigo\":\"H22\",\"texto\":\"Utilizar conhecimentos algébricos/geométricos como recurso para a construção de argumentação.\"},{\"codigo\":\"H23\",\"texto\":\"Avaliar propostas de intervenção na realidade utilizando conhecimentos algébricos.\"}]},{\"numero\":6,\"texto\":\"Interpretar informações de natureza científica e social obtidas da leitura de gráficos e tabelas, realizando previsão de tendência, extrapolação, interpolação e interpretação.\",\"habilidades\":[{\"codigo\":\"H24\",\"texto\":\"Utilizar informações expressas em gráficos ou tabelas para fazer inferências.\"},{\"codigo\":\"H25\",\"texto\":\"Resolver problema com dados apresentados em tabelas ou gráficos.\"},{\"codigo\":\"H26\",\"texto\":\"Analisar informações expressas em gráficos ou tabelas como recurso para a construção de argumentos.\"}]},{\"numero\":7,\"texto\":\"Compreender o caráter aleatório e não-determinístico dos fenômenos naturais e sociais e utilizar instrumentos adequados para medidas, determinação de amostras e cálculos de probabilidade para interpretar informações de variáveis apresentadas em uma distribuição estatística.\",\"habilidades\":[{\"codigo\":\"H27\",\"texto\":\"Calcular medidas de tendência central ou de dispersão de um conjunto de dados expressos em uma tabela de frequências de dados agrupados (não em classes) ou em gráficos.\"},{\"codigo\":\"H28\",\"texto\":\"Resolver situação-problema que envolva conhecimentos de estatística e probabilidade.\"},{\"codigo\":\"H29\",\"texto\":\"Utilizar conhecimentos de estatística e probabilidade como recurso para a construção de argumentação.\"},{\"codigo\":\"H30\",\"texto\":\"Avaliar propostas de intervenção na realidade utilizando conhecimentos de estatística e probabilidade.\"}]}]},\"natureza\":{\"label\":\"Ciências da Natureza e suas Tecnologias\",\"competencias\":[{\"numero\":1,\"texto\":\"Compreender as ciências naturais e as tecnologias a elas associadas como construções humanas, percebendo seus papéis nos processos de produção e no desenvolvimento econômico e social da humanidade.\",\"habilidades\":[{\"codigo\":\"H1\",\"texto\":\"Reconhecer características ou propriedades de fenômenos ondulatórios ou oscilatórios, relacionando-os a seus usos em diferentes contextos.\"},{\"codigo\":\"H2\",\"texto\":\"Associar a solução de problemas de comunicação, transporte, saúde ou outro, com o correspondente desenvolvimento científico e tecnológico.\"},{\"codigo\":\"H3\",\"texto\":\"Confrontar interpretações científicas com interpretações baseadas no senso comum, ao longo do tempo ou em diferentes culturas.\"},{\"codigo\":\"H4\",\"texto\":\"Avaliar propostas de intervenção no ambiente, considerando a qualidade da vida humana ou medidas de conservação, recuperação ou utilização sustentável da biodiversidade.\"}]},{\"numero\":2,\"texto\":\"Identificar a presença e aplicar as tecnologias associadas às ciências naturais em diferentes contextos.\",\"habilidades\":[{\"codigo\":\"H5\",\"texto\":\"Dimensionar circuitos ou dispositivos elétricos de uso cotidiano.\"},{\"codigo\":\"H6\",\"texto\":\"Relacionar informações para compreender manuais de instalação ou utilização de aparelhos, ou sistemas tecnológicos de uso comum.\"},{\"codigo\":\"H7\",\"texto\":\"Selecionar testes de controle, parâmetros ou critérios para a comparação de materiais e produtos, tendo em vista a defesa do consumidor, a saúde do trabalhador ou a qualidade de vida.\"}]},{\"numero\":3,\"texto\":\"Associar intervenções que resultam em degradação ou conservação ambiental a processos produtivos e sociais e a instrumentos ou ações científico-tecnológicos.\",\"habilidades\":[{\"codigo\":\"H8\",\"texto\":\"Identificar etapas em processos de obtenção, transformação, utilização ou reciclagem de recursos naturais, energéticos ou matérias-primas, considerando processos biológicos, químicos ou físicos neles envolvidos.\"},{\"codigo\":\"H9\",\"texto\":\"Compreender a importância dos ciclos biogeoquímicos ou do fluxo energia para a vida, ou da ação de agentes ou fenômenos que podem causar alterações nesses processos.\"},{\"codigo\":\"H10\",\"texto\":\"Analisar perturbações ambientais, identificando fontes, transporte e(ou) destino dos poluentes ou prevendo efeitos em sistemas naturais, produtivos ou sociais.\"},{\"codigo\":\"H11\",\"texto\":\"Reconhecer benefícios, limitações e aspectos éticos da biotecnologia, considerando estruturas e processos biológicos envolvidos em produtos biotecnológicos.\"},{\"codigo\":\"H12\",\"texto\":\"Avaliar impactos em ambientes naturais decorrentes de atividades sociais ou econômicas, considerando interesses contraditórios.\"}]},{\"numero\":4,\"texto\":\"Compreender interações entre organismos e ambiente, em particular aquelas relacionadas à saúde humana, relacionando conhecimentos científicos, aspectos culturais e características individuais.\",\"habilidades\":[{\"codigo\":\"H13\",\"texto\":\"Reconhecer mecanismos de transmissão da vida, prevendo ou explicando a manifestação de características dos seres vivos.\"},{\"codigo\":\"H14\",\"texto\":\"Identificar padrões em fenômenos e processos vitais dos organismos, como manutenção do equilíbrio interno, defesa, relações com o ambiente, sexualidade, entre outros.\"},{\"codigo\":\"H15\",\"texto\":\"Interpretar modelos e experimentos para explicar fenômenos ou processos biológicos em qualquer nível de organização dos sistemas biológicos.\"},{\"codigo\":\"H16\",\"texto\":\"Compreender o papel da evolução na produção de padrões, processos biológicos ou na organização taxonômica dos seres vivos.\"}]},{\"numero\":5,\"texto\":\"Entender métodos e procedimentos próprios das ciências naturais e aplicá-los em diferentes contextos.\",\"habilidades\":[{\"codigo\":\"H17\",\"texto\":\"Relacionar informações apresentadas em diferentes formas de linguagem e representação usadas nas ciências físicas, químicas ou biológicas, como texto discursivo, gráficos, tabelas, relações matemáticas ou linguagem simbólica.\"},{\"codigo\":\"H18\",\"texto\":\"Relacionar propriedades físicas, químicas ou biológicas de produtos, sistemas ou procedimentos tecnológicos às finalidades a que se destinam.\"},{\"codigo\":\"H19\",\"texto\":\"Avaliar métodos, processos ou procedimentos das ciências naturais que contribuam para diagnosticar ou solucionar problemas de ordem social, econômica ou ambiental.\"}]},{\"numero\":6,\"texto\":\"Apropriar-se de conhecimentos da física para, em situações problema, interpretar, avaliar ou planejar intervenções científico- tecnológicas.\",\"habilidades\":[{\"codigo\":\"H20\",\"texto\":\"Caracterizar causas ou efeitos dos movimentos de partículas, substâncias, objetos ou corpos celestes.\"},{\"codigo\":\"H21\",\"texto\":\"Utilizar leis físicas e (ou) químicas para interpretar processos naturais ou tecnológicos inseridos no contexto da termodinâmica e(ou) do eletromagnetismo.\"},{\"codigo\":\"H22\",\"texto\":\"Compreender fenômenos decorrentes da interação entre a radiação e a matéria em suas manifestações em processos naturais ou tecnológicos, ou em suas implicações biológicas, sociais, econômicas ou ambientais.\"},{\"codigo\":\"H23\",\"texto\":\"Avaliar possibilidades de geração, uso ou transformação de energia em ambientes específicos, considerando implicações éticas, ambientais, sociais e/ou econômicas.\"}]},{\"numero\":7,\"texto\":\"Apropriar-se de conhecimentos da química para, em situações problema, interpretar, avaliar ou planejar intervenções científico- tecnológicas.\",\"habilidades\":[{\"codigo\":\"H24\",\"texto\":\"Utilizar códigos e nomenclatura da química para caracterizar materiais, substâncias ou transformações químicas.\"},{\"codigo\":\"H25\",\"texto\":\"Caracterizar materiais ou substâncias, identificando etapas, rendimentos ou implicações biológicas, sociais, econômicas ou ambientais de sua obtenção ou produção.\"},{\"codigo\":\"H26\",\"texto\":\"Avaliar implicações sociais, ambientais e/ou econômicas na produção ou no consumo de recursos energéticos ou minerais, identificando transformações químicas ou de energia envolvidas nesses processos.\"},{\"codigo\":\"H27\",\"texto\":\"Avaliar propostas de intervenção no meio ambiente aplicando conhecimentos químicos, observando riscos ou benefícios.\"}]},{\"numero\":8,\"texto\":\"Apropriar-se de conhecimentos da biologia para, em situações problema, interpretar, avaliar ou planejar intervenções científico- tecnológicas.\",\"habilidades\":[{\"codigo\":\"H28\",\"texto\":\"Associar características adaptativas dos organismos com seu modo de vida ou com seus limites de distribuição em diferentes ambientes, em especial em ambientes brasileiros.\"},{\"codigo\":\"H29\",\"texto\":\"Interpretar experimentos ou técnicas que utilizam seres vivos, analisando implicações para o ambiente, a saúde, a produção de alimentos, matérias primas ou produtos industriais.\"},{\"codigo\":\"H30\",\"texto\":\"Avaliar propostas de alcance individual ou coletivo, identificando aquelas que visam à preservação e a implementação da saúde individual, coletiva ou do ambiente.\"}]}]},\"humanas\":{\"label\":\"Ciências Humanas e suas Tecnologias\",\"competencias\":[{\"numero\":1,\"texto\":\"Compreender os elementos culturais que constituem as identidades\",\"habilidades\":[{\"codigo\":\"H1\",\"texto\":\"Interpretar historicamente e/ou geograficamente fontes documentais acerca de aspectos da cultura.\"},{\"codigo\":\"H2\",\"texto\":\"Analisar a produção da memória pelas sociedades humanas.\"},{\"codigo\":\"H3\",\"texto\":\"Associar as manifestações culturais do presente aos seus processos históricos.\"},{\"codigo\":\"H4\",\"texto\":\"Comparar pontos de vista expressos em diferentes fontes sobre determinado aspecto da cultura.\"},{\"codigo\":\"H5\",\"texto\":\"Identificar as manifestações ou representações da diversidade do patrimônio cultural e artístico em diferentes sociedades.\"}]},{\"numero\":2,\"texto\":\"Compreender as transformações dos espaços geográficos como produto das relações socioeconômicas e culturais de poder.\",\"habilidades\":[{\"codigo\":\"H6\",\"texto\":\"Interpretar diferentes representações gráficas e cartográficas dos espaços geográficos.\"},{\"codigo\":\"H7\",\"texto\":\"Identificar os significados histórico-geográficos das relações de poder entre as nações\"},{\"codigo\":\"H8\",\"texto\":\"Analisar a ação dos estados nacionais no que se refere à dinâmica dos fluxos populacionais e no enfrentamento de problemas de ordem econômico-social.\"},{\"codigo\":\"H9\",\"texto\":\"Comparar o significado histórico-geográfico das organizações políticas e socioeconômicas em escala local, regional ou mundial.\"},{\"codigo\":\"H10\",\"texto\":\"Reconhecer a dinâmica da organização dos movimentos sociais e a importância da participação da coletividade na transformação da realidade histórico-geográfica.\"}]},{\"numero\":3,\"texto\":\"Compreender a produção e o papel histórico das instituições sociais, políticas e econômicas, associando-as aos diferentes grupos, conflitos e movimentos sociais.\",\"habilidades\":[{\"codigo\":\"H11\",\"texto\":\"Identificar registros de práticas de grupos sociais no tempo e no espaço.\"},{\"codigo\":\"H12\",\"texto\":\"Analisar o papel da justiça como instituição na organização das sociedades.\"},{\"codigo\":\"H13\",\"texto\":\"Analisar a atuação dos movimentos sociais que contribuíram para mudanças ou rupturas em processos de disputa pelo poder.\"},{\"codigo\":\"H14\",\"texto\":\"Comparar diferentes pontos de vista, presentes em textos analíticos e interpretativos, sobre situação ou fatos de natureza histórico-geográfica acerca das instituições sociais, políticas e econômicas.\"},{\"codigo\":\"H15\",\"texto\":\"Avaliar criticamente conflitos culturais, sociais, políticos, econômicos ou ambientais ao longo da história.\"}]},{\"numero\":4,\"texto\":\"Entender as transformações técnicas e tecnológicas e seu impacto nos processos de produção, no desenvolvimento do conhecimento e na vida social.\",\"habilidades\":[{\"codigo\":\"H16\",\"texto\":\"Identificar registros sobre o papel das técnicas e tecnologias na organização do trabalho e/ou da vida social.\"},{\"codigo\":\"H17\",\"texto\":\"Analisar fatores que explicam o impacto das novas tecnologias no processo de territorialização da produção.\"},{\"codigo\":\"H18\",\"texto\":\"Analisar diferentes processos de produção ou circulação de riquezas e suas implicações sócio-espaciais.\"},{\"codigo\":\"H19\",\"texto\":\"Reconhecer as transformações técnicas e tecnológicas que determinam as várias formas de uso e apropriação dos espaços rural e urbano.\"},{\"codigo\":\"H20\",\"texto\":\"Selecionar argumentos favoráveis ou contrários às modificações impostas pelas novas tecnologias à vida social e ao mundo do trabalho.\"}]},{\"numero\":5,\"texto\":\"Utilizar os conhecimentos históricos para compreender e valorizar os fundamentos da cidadania e da democracia, favorecendo uma atuação consciente do indivíduo na sociedade.\",\"habilidades\":[{\"codigo\":\"H21\",\"texto\":\"Identificar o papel dos meios de comunicação na construção da vida social.\"},{\"codigo\":\"H22\",\"texto\":\"Analisar as lutas sociais e conquistas obtidas no que se refere às mudanças nas legislações ou nas políticas públicas.\"},{\"codigo\":\"H23\",\"texto\":\"Analisar a importância dos valores éticos na estruturação política das sociedades.\"},{\"codigo\":\"H24\",\"texto\":\"Relacionar cidadania e democracia na organização das sociedades.\"},{\"codigo\":\"H25\",\"texto\":\"Identificar estratégias que promovam formas de inclusão social.\"}]},{\"numero\":6,\"texto\":\"Compreender a sociedade e a natureza, reconhecendo suas interações no espaço em diferentes contextos históricos e geográficos.\",\"habilidades\":[{\"codigo\":\"H26\",\"texto\":\"Identificar em fontes diversas o processo de ocupação dos meios físicos e as relações da vida humana com a paisagem.\"},{\"codigo\":\"H27\",\"texto\":\"Analisar de maneira crítica as interações da sociedade com o meio físico, levando em consideração aspectos históricos e(ou) geográficos.\"},{\"codigo\":\"H28\",\"texto\":\"Relacionar o uso das tecnologias com os impactos sócio-ambientais em diferentes contextos histórico-geográficos.\"},{\"codigo\":\"H29\",\"texto\":\"Reconhecer a função dos recursos naturais na produção do espaço geográfico, relacionando-os com as mudanças provocadas pelas ações humanas.\"},{\"codigo\":\"H30\",\"texto\":\"Avaliar as relações entre preservação e degradação da vida no planeta nas diferentes escalas.\"}]}]}},\"areaContext\":{\"linguagens\":\"CONTEXTO ESPECÍFICO DA ÁREA — LINGUAGENS, CÓDIGOS E SUAS TECNOLOGIAS:\\nAs 45 questões da área se distribuem em: língua estrangeira moderna, inglês ou espanhol (~11%); língua portuguesa e leitura de gêneros textuais diversos, como notícia, crônica, charge, propaganda, infográfico, carta, artigo de opinião, tira, verbete (~35%); texto literário de todas as escolas, do romantismo à literatura contemporânea (~21%); artes visuais, música, dança, teatro, cultura afro-brasileira e indígena (~14%); educação física e práticas corporais (~10%); tecnologias da informação e gêneros digitais (~10%).\\nTextos-suporte típicos: reportagem digital (g1, BBC, Folha, UOL), texto literário, letra de canção, texto publicitário/cartaz, charge/tira, infográfico, verbete de dicionário, trecho de lei, obra de arte com ficha técnica (autor, técnica, dimensões, data, acervo). É comum o par TEXTO I/TEXTO II em leitura comparativa.\\nVerbos de comando típicos: evidenciar, revelar, demonstrar, indicar, ressaltar, apontar, reconhecer, ter como objetivo/propósito/função, constatar-se que/infere-se que, remeter a, contribuir para, caracterizar-se por.\\nDistratores típicos: leitura parcial/localizada; generalização ou inversão indevida; contradição sutil (\\\"distrator espelho\\\", vocabulário parecido com o correto mas sentido oposto); externalidade plausível (senso comum sobre o tema, não sustentado pelo texto). Raramente há \\\"pegadinha\\\" gramatical pura, mesmo em questões de norma culta/variação linguística — o critério de erro é o julgamento sociolinguístico, não a gramática isolada.\\nTemas em ascensão: justiça social e representatividade (povos indígenas, cultura afro-brasileira, pessoas com deficiência, diversidade de gênero, saúde mental), patrimônio linguístico e variedades regionais brasileiras (sempre valorizadas, nunca tratadas como \\\"erro\\\"), gêneros nativamente digitais (podcast, redes sociais, IA).\",\"humanas\":\"CONTEXTO ESPECÍFICO DA ÁREA — CIÊNCIAS HUMANAS E SUAS TECNOLOGIAS (História, Geografia, Filosofia, Sociologia):\\nDistribuição aproximada: História (~26%), Geografia (~24%), Filosofia (~22%), Sociologia (~22%), interdisciplinar (~4%).\\nTextos-suporte típicos, em ordem de frequência: trecho historiográfico ou jornalístico curto com citação completa; excerto de obra clássica de filosofia/ciências sociais (Aristóteles, Hobbes, Rousseau, Kant, Marx, Foucault, Bauman, Arendt — frequentemente via comentador/divulgador quando o conceito é muito denso); textos comparativos TEXTO I/TEXTO II; gráfico, tabela ou mapa (dados IBGE, INPE); charge ou obra de arte com legenda de crédito; texto legal/normativo (Constituição, declaração da ONU); letra de música ou poema; fotografia histórica ou contemporânea legendada.\\nComandos típicos: \\\"De acordo com o texto...\\\", \\\"O texto evidencia/revela/indica...\\\", \\\"Está associado(a) a...\\\", \\\"Tem como objetivo...\\\", \\\"Os textos I e II se aproximam/divergem no seguinte aspecto:\\\". O comando quase sempre pede que se relacione o texto a um conceito ou processo mais amplo — a resposta correta é uma paráfrase conceitual, nunca cópia literal.\\nDistratores típicos: generalização indevida; inversão de causa/efeito; anacronismo (atribuir a um período um conceito de outra época); termo tecnicamente correto mas fora de contexto (confundir autores/correntes teóricas); verdade parcial; inversão de polaridade; distrator de senso comum; excesso de escopo/consequência exagerada.\\nTemas em ascensão: raça, gênero, povos indígenas e quilombolas; tecnologia digital como objeto sociológico (vigilância, algoritmos, desinformação); mudanças climáticas e sustentabilidade (quase obrigatório em 2-3 questões de Geografia por prova desde 2020).\",\"natureza\":\"CONTEXTO ESPECÍFICO DA ÁREA — CIÊNCIAS DA NATUREZA E SUAS TECNOLOGIAS (Física, Química, Biologia):\\nProporção aproximada: Química (~35-38%), Física (~33-36%), Biologia (~27-31%).\\nTextos-suporte típicos, em ordem de frequência: notícia/reportagem de divulgação científica (sempre com fonte citada); processo industrial ou tecnológico descrito passo a passo; experimento didático ou de laboratório; fenômeno cotidiano ou crença popular a ser confrontada com a ciência (ex.: mitos sobre raios, crendices); texto científico mais longo citando artigo/paper real; situação-problema puramente numérica (mais rara, mais comum em Física).\\nComandos típicos: \\\"Qual...é/são\\\" (o mais comum); \\\"O(A) que representa/indica/decorre de...\\\"; \\\"Nessas condições/Com base nesses dados, calcule/estime/é mais próximo(a) de...\\\" (formato \\\"valor mais próximo de\\\", evita gabarito redondo, muito comum em Física/Química); \\\"Esse processo/fenômeno ocorre porque...\\\"; \\\"Qual gráfico representa...\\\".\\nDistratores típicos: erro de unidade ou ordem de grandeza; troca de sinal ou sentido físico; confusão conceitual clássica entre termos próximos (ex.: cátodo/ânodo); cálculo com etapa esquecida ou trocada; resultado \\\"quase certo\\\" mas com grandeza incorretamente combinada (ex.: somar decibéis linearmente em vez de logaritmicamente); inversão de causa/efeito ou proporcionalidade; em Biologia, citar um mecanismo biológico real mas inaplicável à situação do enunciado.\\nTemas em ascensão: sustentabilidade, energias renováveis, química verde; biotecnologia, biossensores, materiais inteligentes (desde 2023); textos-suporte cada vez mais citando artigos científicos reais e recentes.\\nIMPORTANTE: quando a questão pedir gráfico/tabela como recurso visual, gere dados numéricos plausíveis e coerentes (não apenas decorativos) que sejam efetivamente necessários para responder à questão.\",\"matematica\":\"CONTEXTO ESPECÍFICO DA ÁREA — MATEMÁTICA E SUAS TECNOLOGIAS:\\nBlocos de conteúdo aproximados: números e operações — porcentagem, razão/proporção, juros, PA/PG, combinatória (~30%, quase sempre em contexto financeiro/produção); geometria plana e espacial — áreas, volumes, semelhança, escalas, sólidos (~25%); grandezas e medidas — conversão de unidades, densidade, vazão (~12%); funções e álgebra — 1º/2º grau, exponencial, logarítmica, sistemas (~20%); leitura de gráficos e tabelas (~15%); estatística e probabilidade — média, mediana, moda, desvio padrão, probabilidade simples/condicional (~18%).\\nQuestões de matemática pura, sem nenhum contexto aplicado, são raríssimas — use sempre um contexto: financeiro/comercial, saúde, esportivo, engenharia/arquitetura/design, tecnologia/jogos, ambiental/agrícola.\\nComandos típicos: \\\"Qual é o/a valor/quantidade/número/probabilidade de...\\\", \\\"...é/será/deverá ser\\\", \\\"correto afirmar que/correspondente a\\\", \\\"O gráfico/esboço que melhor representa...\\\", \\\"Para atender/garantir/atingir [objetivo], [a pessoa/empresa] deverá...\\\".\\nDistratores: SEMPRE erros de raciocínio derivados do processo de resolução, nunca números aleatórios. Padrões: confundir média simples com ponderada; esquecer de elevar a razão de escala ao quadrado (área) ou ao cubo (volume); trocar numerador/denominador; parar em etapa intermediária do cálculo; usar fórmula plausível mas errada (ex.: juros simples em vez de composto); esquecer de converter unidades; aplicar só parte de uma restrição composta; inverter a direção do arredondamento/comparação; reaproveitar um número do enunciado fora de contexto.\\nConvenção fixa: forneça sempre aproximações numéricas (\\\"considere π = 3\\\", \\\"utilize 1,4 como aproximação para √2\\\") sempre que a resposta exata exigisse calculadora — a prova é desenhada para ser resolvida sem calculadora.\"},\"universalModel\":\"VOCÊ É UM ELABORADOR OFICIAL DE ITENS NO PADRÃO ENEM. Siga rigorosamente este modelo, comum às quatro áreas do exame, derivado da leitura integral de 11 provas reais (2015-2025):\\n\\nANATOMIA DA QUESTÃO (sempre três partes):\\n1) TEXTO-SUPORTE: quase toda questão parte de um texto-suporte real ou verossímil (reportagem, trecho literário, obra clássica, gráfico, tabela, mapa, charge, texto legal, letra de música, processo técnico/industrial). Termine sempre com uma citação de fonte no formato \\\"SOBRENOME, Nome. Título. Veículo/Editora, cidade, data.\\\" ou \\\"Disponível em: [site]. Acesso em: [data] (adaptado).\\\" — mesmo quando a fonte é fictícia, o formato deve ser respeitado. Nunca insira um texto-suporte gratuito: cada frase deve servir para ancorar a resposta correta ou alimentar um distrator específico.\\n2) COMANDO: curto (1-2 linhas), nunca pede repetição literal do texto. Usa verbos-gatilho como: evidencia, revela, indica, tem como objetivo, propõe, reflete, decorre de, é resultado de, pode-se concluir, corresponde a, é correto afirmar, contribui para, caracteriza-se por. Exige uma operação cognitiva (inferir, relacionar causa/efeito, aplicar conceito a situação nova, comparar fontes, calcular) — nunca decoreba.\\n3) CINCO ALTERNATIVAS (A-E): a correta é uma PARÁFRASE CONCEITUAL do texto-suporte (nunca cópia literal de frase). As 4 erradas (distratores) NUNCA são aleatórias — cada uma deve representar um erro de raciocínio específico e catalogável, escolhido dentre estas estratégias (use pelo menos 3 estratégias diferentes entre os 4 distratores de uma mesma questão, nunca repita a mesma lógica 4 vezes):\\n   - Leitura parcial / recorte indevido: generaliza um detalhe isolado do texto.\\n   - Inversão de causa/efeito ou de polaridade: troca aumenta/diminui, causa/consequência.\\n   - Verdade parcial / meia-verdade: correta em outro contexto, mas não responde ao pedido.\\n   - Anacronismo / confusão conceitual clássica: aplica conceito de outro período ou confunde termos próximos (ex.: cátodo/ânodo, autores/correntes teóricas).\\n   - Senso comum: crença intuitiva que o texto existe para desconstruir.\\n   - Erro no processo de resolução (Matemática/Natureza): esquecer etapa de cálculo, trocar média simples por ponderada, erro de conversão de unidade, fórmula plausível mas errada.\\n   - Excesso de escopo / generalização indevida: estende para \\\"todos\\\"/\\\"sempre\\\"/\\\"nunca\\\" algo que era específico ou condicional.\\n   - Reaproveitamento fora de contexto: usa um número/termo do enunciado só que aplicado a algo diferente do pedido.\\n\\nCALIBRAÇÃO DE DIFICULDADE:\\n- Fácil: comando direto, texto-suporte curto, distratores mais óbvios (leitura parcial/senso comum).\\n- Médio: exige uma etapa de inferência, comparação ou cálculo.\\n- Difícil: exige combinar duas informações do texto, ou um distrator do tipo \\\"verdade parcial\\\"/\\\"erro de processo\\\" muito próximo da resposta certa (armadilha fina).\\n\\nREGRAS OBRIGATÓRIAS:\\n- NUNCA copie ou parafraseie de perto uma questão real do ENEM. A questão deve ser inédita, apenas seguindo o estilo, o padrão e o nível de dificuldade.\\n- A habilidade e a competência citadas devem realmente corresponder à operação cognitiva exigida pela questão, não apenas ao assunto de superfície.\\n- As 5 alternativas devem ter extensão e estrutura sintática parecidas entre si (nenhuma \\\"denuncia\\\" a resposta certa pelo tamanho ou forma).\\n- Todo comentário (inclusive das alternativas erradas) deve nomear o tipo de distrator usado, não apenas dizer \\\"está errada\\\".\"}");

const AREA_LABELS: Record<string, string> = {
  linguagens: "Linguagens, Códigos e suas Tecnologias",
  humanas: "Ciências Humanas e suas Tecnologias",
  natureza: "Ciências da Natureza e suas Tecnologias",
  matematica: "Matemática e suas Tecnologias",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/* ---------------- Prompt building (porta fiel da lógica do app cliente) ---------------- */

function buildSystemPrompt(area: string) {
  return APP_DATA.universalModel + "\n\n" + APP_DATA.areaContext[area];
}

const RECURSO_INSTRUCOES: Record<string, string> = {
  nenhum: `Recurso visual: NENHUM. Não inclua gráfico, tabela ou imagem. Explore a situação-problema apenas por meio do texto-suporte. Deixe o campo "visual" como null e "recurso" como "nenhum".`,
  imagem: `Recurso visual: IMAGEM. A questão deve depender de uma imagem/ilustração pedagogicamente necessária (nunca meramente decorativa) para ser respondida corretamente — por exemplo: esquema anatômico, diagrama de processo, mapa, representação de fenômeno, estrutura, infográfico. Preencha "recurso":"imagem" e "visual" com: {"tipo":"imagem","descricao":"<legenda em português explicando o que a imagem mostra e por que ela é necessária para resolver a questão>","promptImagem":"<descrição em INGLÊS, detalhada, objetiva, no estilo de ilustração científica/educacional plana, limpa, sem nenhum texto ou letra embutida na imagem, adequada para um gerador de imagens>"}. O enunciado e o comando devem fazer referência explícita ao que aparece na imagem.`,
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
 "recurso": "nenhum" | "imagem" | "grafico" | "tabela",
 "visual": null ou objeto conforme instruído acima,
 "textoBase": "string (texto-suporte com contextualização; termine com a citação de fonte no formato ENEM, real ou verossímil)",
 "comando": "string (o enunciado da pergunta, curto, indireto)",
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
No campo "comentario" de cada alternativa errada, nomeie explicitamente o tipo de distrator (leitura parcial, inversão de causa/efeito, verdade parcial, anacronismo/confusão conceitual, senso comum, erro de processo, excesso de escopo, reaproveitamento fora de contexto) e explique o raciocínio equivocado que ela representa. Nunca deixe mais de uma alternativa com status "correta".`;

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

const VALIDATION_CHECKLIST = `Revise a questão JSON abaixo (elaborada por você mesmo) contra estes critérios pedagógicos, um a um:
1. Existe somente uma alternativa correta e inequívoca.
2. Não há alternativas ambíguas ou defensáveis como corretas além do gabarito.
3. Os quatro distratores são plausíveis, cada um representando um erro de raciocínio específico (nunca aleatório).
4. O conteúdo científico/conceitual está correto.
5. A questão realmente corresponde ao nível de dificuldade solicitado.
6. A competência indicada é adequada à operação cognitiva exigida pela questão.
7. A habilidade indicada é adequada à operação cognitiva exigida pela questão.
8. A questão tem as características estruturais do ENEM: texto-suporte com fonte citada, comando indireto (não pede repetição literal), 5 alternativas com extensão/estrutura parecidas.
9. Se há gráfico, tabela ou imagem, os dados/descrição são coerentes com o enunciado e efetivamente necessários para a resolução (não decorativos).
10. Todas as informações necessárias para resolver a questão estão disponíveis no texto-base, no comando ou no recurso visual.
11. Não há pistas involuntárias (ex.: alternativa correta com tamanho, redação ou grau de detalhe muito diferente das demais) que entreguem a resposta sem raciocínio.
12. A resposta exige interpretação/raciocínio, não apenas memorização direta de um fato isolado.

Se ALGUM critério não for plenamente atendido, reescreva a questão inteira corrigindo o problema, mantendo o mesmo tema, dificuldade e recurso visual solicitados. Se todos os critérios já estiverem atendidos, apenas devolva a mesma questão.

QUESTÃO A REVISAR:
__DRAFT_JSON__

${JSON_SCHEMA_TXT}`;

/* ---------------- Claude API (server-side) ---------------- */

async function callClaude(system: string, userMsg: string, maxTokens: number) {
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
    }),
  });
  const rawBody = await resp.text();
  let data: any = {};
  try { data = rawBody ? JSON.parse(rawBody) : {}; } catch (_e) { /* corpo não é JSON */ }

  if (!resp.ok) {
    let msg = (data && data.error && data.error.message) ? data.error.message : "";
    if (!msg) msg = rawBody ? rawBody.slice(0, 300) : `Erro HTTP ${resp.status} ${resp.statusText || ""}`.trim();
    if (resp.status === 401) {
      msg = `Chave de API da Anthropic inválida ou expirada (401) nos secrets deste projeto Supabase. Detalhe: ${msg}`;
    }
    throw new Error(msg);
  }
  const textBlock = Array.isArray(data.content) ? data.content.find((b: any) => b && b.type === "text") : null;
  const text = textBlock ? (textBlock.text || "") : "";
  return { text, truncated: data.stop_reason === "max_tokens" };
}

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

async function callClaudeForJSON(system: string, userMsg: string) {
  const { text, truncated } = await callClaude(system, userMsg, 8000);
  try {
    return parseJSONLoose(text);
  } catch (err) {
    if (truncated) {
      const retry = await callClaude(system, userMsg, 12000);
      return parseJSONLoose(retry.text);
    }
    throw err;
  }
}

/* ---------------- HTTP handler ---------------- */

// Limite diário de segurança para proteger os créditos da conta Anthropic conectada,
// já que esta função fica publicamente acessível por qualquer aplicativo autorizado.
// Usado tanto na geração completa de questão quanto no "refazer recurso visual".
async function checkDailyCap(): Promise<Response | null> {
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

  // Modo "refazer só o recurso visual" de uma questão já pronta — não gera uma questão
  // nova, só uma nova versão do gráfico/tabela/imagem, mantendo o resto intacto.
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
  const validar = body.validar !== false; // default: true (roda a checagem pedagógica)

  const capResponse = await checkDailyCap();
  if (capResponse) return capResponse;

  try {
    const system = buildSystemPrompt(area);
    const userMsg = buildUserPrompt({ area, disciplina, tema, dificuldade, recurso, competenciaNum, habilidadeCod, instrucoesVisual });
    let data = await callClaudeForJSON(system, userMsg);

    if (validar) {
      const valPrompt = VALIDATION_CHECKLIST.replace("__DRAFT_JSON__", JSON.stringify(data));
      data = await callClaudeForJSON(system, valPrompt);
    }

    await logGeneration(area, disciplina, tema);

    return jsonResponse({ question: data });
  } catch (err) {
    return jsonResponse({ error: `Erro ao gerar questão: ${String((err as any)?.message || err)}` }, 502);
  }
});

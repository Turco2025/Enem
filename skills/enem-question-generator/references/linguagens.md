# Manual de Padrões de Construção — ENEM Linguagens, Códigos e suas Tecnologias (2015–2025)

Análise de 11 provas do primeiro dia (ou, nos anos 2015–2016, do bloco de Linguagens do segundo dia): questões 91–135 (2015, 2016) e 1–45 (2017–2025). Cor Azul, sempre que disponível.

**Nota metodológica:** o arquivo de 2021 (`ENEM_2021_Prova_Dia1_Azul.txt`) apresenta corrupção de codificação de fonte na extração de texto (pdftotext), tornando o corpo da maior parte das questões ilegível (símbolos em vez de palavras), embora a estrutura (marcadores "Questão XX", alternativas A–E) permaneça íntegra — confirmando que a prova de 2021 seguiu o mesmo padrão estrutural das demais, mas impedindo a extração de conteúdo verbal confiável daquele ano. Os arquivos de 2022 e 2024 contêm ruído de marca d'água ("ENEM2022ENEM2022..." / "ENEM2024ENEM2024...") inserido em massa entre as linhas de texto, mas o conteúdo integral estava recuperável por leitura seletiva. Os demais anos (2015–2020, 2023, 2025) estão limpos. As conclusões abaixo baseiam-se em leitura extensa (a maior parte das 45 questões) de 2015, 2017, 2019, 2020, 2022, 2023, 2024 e 2025, e em leitura substancial de 2016 e 2018.

---

## a) Estrutura geral

As 45 questões de Linguagens seguem uma arquitetura bastante estável ano a ano:

| Bloco | Questões aproximadas | Peso aproximado |
|---|---|---|
| Língua estrangeira moderna (LEM) — inglês ou espanhol, à escolha do candidato | 1 a 5 | 5 questões (≈11%) |
| Língua portuguesa / leitura e interpretação de gêneros textuais diversos (notícia, crônica, charge, propaganda, infográfico, carta, artigo de opinião, tira, verbete) — inclui coesão, semântica, variação linguística, argumentação | 6 a ~30 (intercaladas) | ≈15–16 questões (≈35%) |
| Texto literário (romantismo, realismo, simbolismo, modernismo, romance de 30, literatura contemporânea, poesia, conto, crônica de autor) | intercaladas, concentração maior entre 24–40 | ≈9–10 questões (≈21%) |
| Artes (artes visuais, música, dança, teatro, cultura afro-brasileira e indígena, produções populares) | intercaladas | ≈6–7 questões (≈14%) |
| Educação Física / práticas corporais (lutas, esportes radicais, parasporte, saúde e corpo) | intercaladas | ≈4–5 questões (≈10%) |
| Tecnologias da informação e comunicação / gêneros digitais (redes sociais, podcast, telemedicina, jogos eletrônicos, influenciadores digitais) | intercaladas, mais concentradas nos anos recentes | ≈4–5 questões (≈10%) |

Características estruturais constantes:
- As questões de LEM (1–5) sempre aparecem em **dois blocos paralelos e completos** ("opção inglês" e "opção espanhol"), cada um cobrindo o mesmo leque de habilidades (H5–H8), mas com textos de suporte diferentes — o candidato responde a apenas um dos dois blocos, que por isso devem ser tratados, para fins de calibração de gerador, como uma única "família" de item (LEM), não como conjuntos independentes.
- Não há mais uma separação rígida em "blocos temáticos" (por exemplo, todas as questões de arte juntas); os blocos são **intercalados livremente** ao longo da prova, alternando um texto jornalístico, um texto literário, uma peça publicitária, um texto sobre esporte etc.
- É comum (a partir de ~2019, mais consolidado em 2022–2025) o uso de **pares de textos comparados** (TEXTO I / TEXTO II), muitas vezes um verbal e outro imagético (pintura, escultura, capa de revista, cartaz), ou dois textos do mesmo gênero em relação intertextual.
- A Proposta de Redação aparece sempre entre a questão 45 (ou 135) e o início de Ciências Humanas, e frequentemente reaproveita, nos "textos motivadores", temas tangentes aos que já apareceram nas questões objetivas de Linguagens do mesmo dia.

---

## b) Distribuição por habilidade (H1–H30)

Frequência estimada com base na amostra lida (frequente = aparece em praticamente todos os anos analisados; média = aparece em bastantes anos, mas não em todos; rara = aparece esporadicamente ou é mobilizada de forma secundária dentro de outras questões).

- **H1** — Identificar as diferentes linguagens e seus recursos expressivos como elementos de caracterização dos sistemas de comunicação. **Frequente.** Ex.: 2015, Questão 91 (poema em inglês de tradição oral indígena norte-americana; pede a relação entre o poema e a "importância dos elementos da natureza").
- **H2** — Recorrer aos conhecimentos sobre as linguagens dos sistemas de comunicação e informação para resolver problemas sociais. **Rara/média.** Ex.: 2023, Questão ~39 (petição on-line que altera verbete de dicionário sobre "casamento" — uso da linguagem/mobilização digital para mudança social).
- **H3** — Relacionar informações geradas nos sistemas de comunicação e informação, considerando a função social desses sistemas. **Frequente.** Ex.: 2020, Questão ~36 (notícia sobre campanha de vacinação de cães contra leishmaniose em Belo Horizonte — pede a função social da notícia, "conscientizar a população sobre grave problema de saúde pública").
- **H4** — Reconhecer posições críticas aos usos sociais que são feitos das linguagens e dos sistemas de comunicação e informação. **Frequente.** Ex.: 2024, Questão 01 inglês (texto sobre fantasias de Halloween que apropriam elementos da cultura indígena — objetivo do texto é "criticar a exploração indevida de elementos da identidade indígena").
- **H5** — Associar vocábulos e expressões de um texto em LEM ao seu tema. **Frequente** (mobilizada quase sempre em uma das 5 questões de LEM). Ex.: 2019, Questão 01 inglês (texto sobre benefícios de animais de estimação — associação de "research", "a growing number of research", "several studies" ao objetivo de convencer o leitor).
- **H6** — Utilizar os conhecimentos da LEM como meio de ampliar acesso a informações, tecnologias e culturas. **Média.** Ex.: 2017, Questão 02 inglês (notícia sobre recrutamento de jovens "gamers" como ciberespiões pelo governo britânico).
- **H7** — Relacionar um texto em LEM, as estruturas linguísticas, sua função e seu uso social. **Frequente.** Ex.: 2017, Questão 01 espanhol (conto "El carpintero", de Eduardo Galeano — sentido da expressão idiomática "ni le va ni le viene").
- **H8** — Reconhecer a importância da produção cultural em LEM como representação da diversidade cultural e linguística. **Média.** Ex.: 2025, Questão 03 inglês (poema de Joy Harjo, autora de ascendência indígena norte-americana).
- **H9** — Reconhecer as manifestações corporais de movimento como originárias de necessidades cotidianas de um grupo social. **Rara.** Ex.: 2020, Questão ~36 (definição de "luta" como prática corporal regida por regras, em oposição à "briga").
- **H10** — Reconhecer a necessidade de transformação de hábitos corporais em função de necessidades cinestésicas. **Rara.** Ex.: 2023, Questão ~34 (mountainboard — adaptação do equipamento a diferentes tipos de terreno na ausência de neve).
- **H11** — Reconhecer a linguagem corporal como meio de interação social, considerando limites de desempenho e alternativas de adaptação. **Média.** Ex.: 2025, Questão 12 (programa "Maré Inclusiva" de parasurf para pessoas com deficiência).
- **H12** — Reconhecer diferentes funções da arte, do trabalho de produção dos artistas em seus meios culturais. **Frequente.** Ex.: 2024, Questão 16 (arte afro-brasileira de Carybé, Mestre Didi e Djanira, ligada à cultura religiosa nagô baiana).
- **H13** — Analisar as diversas produções artísticas como meio de explicar diferentes culturas, padrões de beleza e preconceitos. **Frequente.** Ex.: 2025, Questão 35 (crônica sobre críticas à aparência física de Margot Robbie e Paolla Oliveira — fiscalização do corpo feminino).
- **H14** — Reconhecer o valor da diversidade artística e das inter-relações de elementos nas manifestações de grupos sociais e étnicos. **Frequente.** Ex.: 2023, Questão 38 (Marabaixo, manifestação cultural das comunidades negras do Amapá, Patrimônio Cultural do Brasil).
- **H15** — Estabelecer relações entre o texto literário e o momento de sua produção, situando aspectos do contexto histórico, social e político. **Frequente.** Ex.: 2022, Questão 31 (trecho de *A Bagaceira*, de José Américo de Almeida — retirantes da seca de 1898, ligado ao "Romance de 30").
- **H16** — Relacionar informações sobre concepções artísticas e procedimentos de construção do texto literário. **Frequente.** Ex.: 2022, Questão ~29-30 (visita de duas senhoras a uma vidente em conto de Machado de Assis — a ironia como traço da narrativa machadiana).
- **H17** — Reconhecer a presença de valores sociais e humanos atualizáveis e permanentes no patrimônio literário nacional. **Média.** Ex.: 2025, Questão 11 (*Inocência*, de Visconde de Taunay — ideais românticos na fala do pai sobre a filha).
- **H18** — Identificar os elementos que concorrem para a progressão temática e para a organização/estruturação de textos de diferentes gêneros e tipos. **Frequente.** Ex.: 2025, Questão 10 (crônica "De próprio punho" — recurso linguístico que marca a síntese da opinião da autora).
- **H19** — Analisar a função da linguagem predominante nos textos em situações específicas de interlocução. **Frequente.** Ex.: 2025, Questão 36 (capa de revista com a frase "VOCÊ (NÃO) ESTÁ SOZINHO" — função poética da linguagem).
- **H20** — Reconhecer a importância do patrimônio linguístico para a preservação da memória e da identidade nacional. **Frequente, em crescimento nos anos recentes.** Ex.: 2025, Questão 20 ("língua de santo" do candomblé baiano, com léxico de línguas africanas).
- **H21** — Reconhecer em textos de diferentes gêneros recursos verbais e não-verbais utilizados para criar e mudar comportamentos e hábitos. **Frequente.** Ex.: 2025, Questão 24 (cartaz da UNICEF com frases que projetam a vida profissional de duas crianças, para sensibilizar contra o racismo).
- **H22** — Relacionar, em diferentes textos, opiniões, temas, assuntos e recursos linguísticos. **Frequente.** Ex.: 2024, Questão 19 (reportagem comparando casos de ansiedade/depressão de vários atletas — Naomi Osaka, Nick Kyrgios, Kevin Love).
- **H23** — Inferir em um texto quais são os objetivos de seu produtor e quem é seu público-alvo, pela análise dos procedimentos argumentativos utilizados. **Muito frequente — é o "molde-padrão" mais recorrente da prova.** Ex.: 2017, Questão 01 inglês (comentário sobre o filme *Frida* — a autora mostra-se impressionada com a "beleza singular" da pintora).
- **H24** — Reconhecer no texto estratégias argumentativas empregadas para o convencimento do público (intimidação, sedução, comoção, chantagem etc.). **Média.** Ex.: 2020, Questão ~38 (relato de viagem a Portugal — sedução do leitor por meio de citações de "vozes externas" sobre a identidade do povo português).
- **H25** — Identificar, em textos de diferentes gêneros, as marcas linguísticas que singularizam as variedades linguísticas sociais, regionais e de registro. **Frequente.** Ex.: 2024, Questão 14 (o "maranhês" — variedade regional do Maranhão, uso de "pães misturados").
- **H26** — Relacionar as variedades linguísticas a situações específicas de uso social. **Frequente.** Ex.: 2024, Questão 09 (fala do filólogo Evanildo Bechara sobre estrangeirismos — variedade linguística geracional/ocupacional).
- **H27** — Reconhecer os usos da norma padrão da língua portuguesa nas diferentes situações de comunicação. **Média.** Ex.: 2025, Questão 13 (texto de lei — Lei n. 10.639/2003 — justificado pelo emprego da norma-padrão em razão dos "contextos pedagógicos em que circula").
- **H28** — Reconhecer a função e o impacto social das diferentes tecnologias da comunicação e informação. **Frequente.** Ex.: 2025, Questão 39 ("Do rádio ao podcast" — permanência do rádio e sua evolução por meio da tecnologia digital).
- **H29** — Identificar, pela análise de suas linguagens, as tecnologias da comunicação e informação. **Rara/média.** Ex.: 2025, Questão 33 (múltiplos sentidos da palavra "rede" — comunicação em meios digitais).
- **H30** — Relacionar as tecnologias de comunicação e informação ao desenvolvimento das sociedades e ao conhecimento que elas produzem. **Rara.** Ex.: 2024, Questão 17 (dado estatístico de aumento de 6.000% no alcance de uma digital influencer negra — relação entre alcance de conteúdo digital e viés racial).

**Observação geral sobre a matriz:** as habilidades mais "genéricas" de leitura/inferência (H18, H19, H21, H22, H23, H25, H26) concentram a maior parte das questões — são o motor da prova. As habilidades mais específicas de um só domínio (H2, H9, H10, H29, H30) aparecem com menor frequência e quase sempre "hospedadas" dentro de um texto que também poderia ser lido por uma habilidade mais genérica (ou seja, a etiqueta oficial de habilidade é frequentemente polissêmica/sobreposta na prática).

---

## c) Padrão de construção das questões

### Texto de apoio
- Quase sempre um **único texto** por questão (verbal, misto ou não verbal), raramente ultrapassando 15–20 linhas; quando maior (crônicas, trechos literários), serve de base para 2 a 5 questões consecutivas ("Texto para as Questões de X a Y").
- Fontes predominantes: reportagem/notícia de veículo digital (g1, BBC, Folha, UOL, Estadão), texto literário (romance, conto, poema, crônica de autor consagrado ou contemporâneo), letra de canção, texto publicitário/cartaz, charge/tira/cartum, infográfico, verbete de dicionário/enciclopédia, trecho de lei ou documento oficial, obra de arte (pintura, escultura, fotografia) com legenda técnica (autor, técnica, dimensões, data, acervo).
- É recorrente (mais nos anos recentes) o **par de textos** (TEXTO I/TEXTO II), muitas vezes cruzando um texto verbal com uma imagem (pintura, escultura, gráfico) para forçar a leitura comparativa/multimodal.
- Toda fonte traz a formatação padronizada "Disponível em: [site]. Acesso em: [data] (adaptado)." — e é comum que a data de acesso seja **anterior em vários anos** à aplicação da prova (reaproveitamento de banco de itens/textos).
- Nas questões de literatura, o texto vem seguido da referência bibliográfica completa (autor, obra, editora, ano), sem contextualização prévia — o candidato precisa inferir o momento/escola literária a partir de pistas internas do próprio texto.

### Formulação do comando (enunciado)
O comando é tipicamente curto (1–2 linhas), remete diretamente ao texto ("Nesse texto...", "No texto...", "Nessa reportagem...", "Considerando esse texto...") e usa um verbo que já direciona o tipo de resposta esperada. Verbos de comando mais frequentes observados na amostra:
- **evidenciar / evidencia** ("esse texto evidencia...")
- **revelar / revela**
- **demonstrar / demonstra**
- **indicar / indica**
- **ressaltar / ressalta**
- **apontar(-se) / aponta**
- **reconhecer** ("é possível reconhecer...")
- **ter como objetivo / propósito / finalidade / função** ("esse texto tem por objetivo...", "cumpre uma função social quando...")
- **constatar-se que / pode-se inferir que / infere-se que**
- **remeter a / referir-se a**
- **contribuir para**
- **caracterizar(-se) por**

Estrutura sintática típica do comando: **[referência ao texto] + [verbo-gatilho] + [objeto a ser identificado]**, por exemplo: "Nesse texto, a expressão X é usada para..."; "Segundo a argumentação construída nesse texto, o podcast..."; "Ao abordar [tema], esse texto tem por objetivo...". Muitas vezes o comando já cita um trecho entre aspas do próprio texto (palavra, expressão ou verso), pedindo que se explique sua função ali.

### Construção das alternativas
- Sempre **5 alternativas (A–E)**, geralmente com estrutura sintática paralela entre si (mesmo início de frase, mesma categoria gramatical), o que reforça que a diferenciação está no **conteúdo semântico**, não na forma.
- **Uma alternativa correta**, que via de regra sintetiza a ideia central/o efeito de sentido predominante do texto, frequentemente parafraseando com vocabulário mais abstrato/técnico o que o texto diz de forma concreta.
- **Quatro distratores plausíveis**, construídos predominantemente por estas estratégias (não por "pegadinhas" gramaticais):
  1. **Leitura parcial/localizada** — o distrator pega um detalhe real do texto, mas que não é o foco/a ideia central pedida pelo comando.
  2. **Generalização ou inversão indevida** — inverte causa/efeito, ou generaliza um caso particular do texto como se fosse regra geral.
  3. **Contradição sutil com o texto** — afirma o oposto do que o texto sustenta, mas em vocabulário semelhante ao correto (funciona como "distrator espelho").
  4. **Externalidade plausível** — traz uma informação verossímil sobre o tema, coerente com o "senso comum" sobre o assunto, mas que não está de fato sustentada pelo texto apresentado (o candidato precisa resistir ao que "sabe" do mundo e ficar apenas no que o texto diz).
- Raramente há distratores baseados em erro gramatical do enunciado ou "pegadinha" de norma culta — mesmo nas questões que tratam de variação linguística e norma-padrão (H25–H27), o critério de erro está no **julgamento sociolinguístico equivocado** (ex.: tratar uma variedade como "erro" ou como "superior"), não em gramática pura.
- Nas questões de dois textos (I/II), o padrão mais comum é pedir o que os dois têm em comum, ou o que o Texto II acrescenta/ilustra em relação ao Texto I — os distratores costumam atribuir a um texto uma característica que só pertence ao outro.

---

## d) Nota sobre exemplos ilustrativos

Por respeito aos direitos autorais do INEP sobre as provas originais, este manual não reproduz o enunciado completo de questões reais. Para exemplos ilustrativos de tema, ano e habilidade mobilizada, consulte a tabela de frequência da seção (b) acima, que já traz uma referência curta (ano, número da questão e um resumo de uma linha do tema) para cada habilidade. Os padrões de construção descritos na seção (c) foram derivados da leitura integral das 11 provas, mas expressos aqui como descrição estrutural, não como cópia de texto original.

---

## e) Observações finais — evolução ao longo dos anos

1. **Ampliação constante de temas de justiça social e representatividade.** A partir de meados da década (mais nitidamente 2022–2025), cresce a presença de textos sobre povos indígenas (línguas indígenas, arte indígena, poesia em língua indígena), cultura afro-brasileira (candomblé, arte afro-brasileira, quilombolas, Lei 10.639), pessoas com deficiência e parasporte, diversidade de gênero (inclusive um caso de atleta trans em 2022) e saúde mental de atletas e jovens. Esse eixo temático hoje atravessa praticamente todos os blocos (LEM, literatura, artes, educação física), não ficando restrito a uma habilidade específica.

2. **Crescimento do peso do "patrimônio linguístico" (H20) e da variação linguística (H25/H26).** Nos anos mais recentes (2024–2025) multiplicam-se questões sobre línguas e variedades brasileiras pouco visibilizadas (Língua da Tabatinga em Minas Gerais, "amazonês", "maranhês", "língua de santo"), quase sempre com abordagem valorizadora (a variação como patrimônio, nunca como "erro").

3. **Multimodalidade e gêneros digitais em ascensão, mas ainda minoritários.** Cartazes, infográficos, capas de revista, charges e obras de arte (fotografadas com ficha técnica) aparecem em praticamente toda prova; gêneros nativamente digitais (podcast, redes sociais, influenciadores digitais, telemedicina, aplicativos) crescem de frequência ano a ano, mas ainda como um bloco temático (tecnologia), não substituindo o predomínio de textos verbais escritos.

4. **Reaproveitamento de textos "atrasados" em relação ao ano da prova.** É comum encontrar referências "Acesso em: [ano bem anterior ao da prova]" (por exemplo, textos "adaptado" com data de acesso de 2017, 2018 ou 2021 usados nas provas de 2023–2025), sugerindo um banco de itens em rotação, não necessariamente atualidade jornalística estrita — um gerador automático não precisa restringir-se a fatos do ano corrente.

5. **Estabilidade estrutural muito forte.** Apesar da variação temática, o "molde" de construção (texto curto com referência + comando de uma linha com verbo-gatilho + 5 alternativas paralelas sintaticamente, uma correta e quatro plausíveis por leitura parcial) é extremamente estável de 2015 a 2025, o que é a informação mais importante para calibrar um gerador automático: a variabilidade está no conteúdo/tema e na habilidade mobilizada, não na arquitetura do item.

6. **Limitação de dados:** o ano de 2021 não pôde ser analisado em nível de conteúdo devido a problema de extração de texto do PDF de origem (corrupção de codificação de fonte); a estrutura da prova (número de questões, presença de LEM em 1–5, formato A–E) foi confirmada, mas nenhum exemplo verbatim de 2021 pôde ser incluído no banco de exemplos.

---

**Arquivos-fonte analisados:**
`/home/claude/enem/text/2015/ENEM_2015_Prova_Dia2_Azul.txt`, `/home/claude/enem/text/2016/ENEM_2016_Prova_Dia2_Azul.txt`, `/home/claude/enem/text/2017/ENEM_2017_Prova_Dia1_Azul.txt`, `/home/claude/enem/text/2018/ENEM_2018_Prova_Dia1_Azul.txt`, `/home/claude/enem/text/2019/ENEM_2019_Prova_Dia1_Azul.txt`, `/home/claude/enem/text/2020/ENEM_2020_Prova_Dia1_Azul.txt`, `/home/claude/enem/text/2021/ENEM_2021_Prova_Dia1_Azul.txt` (corrompido), `/home/claude/enem/text/2022/ENEM_2022_Prova_Dia1_Azul.txt`, `/home/claude/enem/text/2023/ENEM_2023_Prova_Dia1_Azul.txt`, `/home/claude/enem/text/2024/ENEM_2024_Prova_Dia1_Azul.txt`, `/home/claude/enem/text/2025/ENEM_2025_Prova_Dia1_Azul.txt`.

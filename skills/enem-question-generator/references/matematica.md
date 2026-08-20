# Manual de Padrões de Elaboração — ENEM Matemática e suas Tecnologias (2015–2025)

Análise das questões 136–180 (Matemática, Caderno Azul, Dia 2) das provas de 2015 a 2025, com o objetivo de calibrar um gerador automático de questões estilo ENEM.

**Nota metodológica sobre qualidade dos dados:** os textos foram extraídos via `pdftotext -layout` de PDFs de duas colunas. Na maioria dos anos a extração é boa, mas o arquivo de **2021** apresenta corrupção severa de caracteres especiais (acentos, alguns algarismos e símbolos aparecem substituídos por caracteres estranhos como `%`, `¶`, `§`, `x`, `@`). Os enunciados de 2021 foram interpretados com base no contexto e nas alternativas ainda legíveis, mas alguns detalhes finos (unidades, nomes) podem estar incompletos. Isso está sinalizado explicitamente nos exemplos daquele ano. Os demais anos (2015–2020, 2022–2025) têm boa legibilidade, embora 2022 e 2024 tragam uma marca d'água repetida ("ENEM 2022"/"ENEM2024") intercalada no meio do texto, que não afeta o conteúdo mas exige filtragem visual.

---

## a) Estrutura geral

Sobre as 45 questões de Matemática de cada ano (136–180), a distribuição aproximada por bloco de conteúdo (um mesmo item pode tocar mais de um bloco, por isso os percentuais não somam 100%):

| Bloco de conteúdo | Peso aproximado | Observações |
|---|---|---|
| Números e operações (porcentagem, razão/proporção, juros, PA/PG, divisibilidade, contagem/combinatória, notação científica) | ~30% | É o bloco mais frequente; quase sempre em contexto financeiro ou de produção/consumo |
| Geometria (plana e espacial: áreas, volumes, semelhança, Tales, trigonometria, sólidos, escalas de mapas/plantas) | ~25% | Forte presença de sólidos de revolução, troncos de cone/pirâmide, prismas e cilindros em contexto de engenharia/design |
| Grandezas e medidas (conversão de unidades, densidade, vazão, escalas, análise dimensional) | ~12% | Frequentemente cruza com geometria (volume/vazão) ou com álgebra (unidades de grandezas compostas) |
| Funções e álgebra (1º/2º grau, exponencial, logarítmica, trigonométrica, sistemas, inequações, plano cartesiano) | ~20% | Presença crescente de funções trigonométricas (senoides) e logarítmicas nos anos mais recentes |
| Leitura/interpretação de gráficos e tabelas (inferência, interpolação/extrapolação de tendência) | ~15% | Muitas vezes o "veículo" de outra habilidade (ex.: usar gráfico para resolver problema de porcentagem) |
| Estatística e probabilidade (média, mediana, moda, desvio padrão, probabilidade simples/condicional, contagem) | ~18% | Presença muito estável ano a ano; média/mediana/moda é o tópico mais repetido de todo o exame |

**Questões dependentes de figura/gráfico não capturado:** entre 40% e 55% das 45 questões de cada ano fazem referência a alguma figura, gráfico, mapa, esquema ou imagem. Cerca de metade desses casos é parcialmente reconstruível porque os números-chave aparecem soltos no texto (ex.: valores de eixos de gráficos de barras/linhas, dimensões escritas ao lado da figura); a outra metade depende genuinamente de suporte visual não capturado pela extração de texto (formas geométricas compostas, planificações, trajetos em mapas, dobraduras, sólidos de revolução, layouts de tabuleiro/jogo). Nas seções (b)–(d) abaixo, sinalizamos explicitamente quando uma questão "usa suporte visual não capturado".

---

## b) Distribuição por habilidade (H1–H30)

Frequência estimada com base na leitura das 11 provas (alta = aparece quase todo ano, geralmente mais de uma vez; média = aparece na maioria dos anos; baixa = aparece esporadicamente).

| Habilidade | Frequência | Exemplo real (ano + nº) |
|---|---|---|
| H1 – significados de números (nat., int., racionais, reais) | Média | 2019 Q140 (notação científica do diâmetro do vírus influenza) |
| H2 – padrões numéricos / contagem | Média | 2020 Q143 (extrapolação de PA do tempo médio de estudo) |
| H3 – situação-problema numérico | Alta | 2016 Q146 (precificação de picolés para atingir lucro-alvo) |
| H4 – avaliar razoabilidade de resultado numérico | Média | 2024 Q136 (aluno divide soma de notas por 5 em vez de 4) |
| H5 – avaliar proposta de intervenção numérica | Baixa/Média | 2015 Q151 (escolher proposta de vacinação HPV que atinge meta com menor custo) |
| H6 – localização/movimentação 3D→2D | Média | 2025 Q138 (projeções ortogonais de um cubo após deslocamentos) — *usa suporte visual não capturado* |
| H7 – características de figuras planas/espaciais | Alta | 2019 Q157 (faces de um tetraedro truncado) |
| H8 – situação-problema geométrico de espaço/forma | Alta | 2020 Q151 (planificação de um tronco de pirâmide — Templo de Kukulkán) |
| H9 – selecionar argumentos geométricos para problemas do cotidiano | Baixa | 2018 Q157 (comparar escala de mapa para validar distância real) |
| H10 – relações entre grandezas e unidades de medida | Média | 2020 Q147 (converter consumo "L/100km" para "km/L") |
| H11 – escalas | Alta | 2016 Q137 (redução de desenho de guarda-roupa em escala 1:8, depois -20%) |
| H12 – situação-problema com medidas de grandezas | Alta | 2019 Q142 (área de círculo pavimentado, ampliação de diâmetro) |
| H13 – avaliar resultado de medição | Média | 2015 Q173 (escolher espessura de lente mais próxima de 3 mm) |
| H14 – avaliar proposta de intervenção em grandezas/geometria | Baixa/Média | 2020 Q174 (metodologia de estimativa de público em manifestação) |
| H15 – dependência entre grandezas | Média | 2016 Q150 (custo do isolamento acústico ∝ volume, ∝ 1/distância²) |
| H16 – variação direta/inversa entre grandezas | Alta | 2025 Q136 (consumo de GNV proporcional à distância percorrida) |
| H17 – analisar variação de grandezas para argumentação | Média | 2016 Q162 (gráfico de pluviosidade/temperatura para decidir mês de plantio) |
| H18 – avaliar proposta de intervenção em variação de grandezas | Média | 2015 Q150 (preço do pão que maximiza quantidade sem reduzir receita) |
| H19 – representações algébricas de relação entre grandezas | Alta | 2024 Q156 (expressão do valor de corrida de aplicativo: fixo + tempo + distância) |
| H20 – interpretar gráfico cartesiano | Alta | 2017 Q152 (gráfico de altura da água vs. volume em reservatórios ligados) |
| H21 – situação-problema com modelagem algébrica | Alta | 2015 Q174 (temperatura da estufa como função quadrática do tempo) |
| H22 – conhecimentos algébricos/geométricos como argumento | Média | 2018 Q142 (posição de satélites no plano cartesiano m×r para comparar forças) |
| H23 – avaliar proposta de intervenção algébrica | Média | 2022 Q163 (definir % máximo de reajuste salarial mantendo média-teto) |
| H24 – usar gráficos/tabelas para inferências | Alta | 2015 Q169 (gráficos de setores do destino do PET reciclado) |
| H25 – resolver problema com dados em tabela/gráfico | Alta | 2016 Q144 (decidir compra de matéria-prima com base na média de lucro mensal) |
| H26 – analisar gráficos/tabelas para argumentação | Média | 2016 Q171 (% de aumento da população nas capitais do Nordeste, censo IBGE) |
| H27 – medidas de tendência central/dispersão (dados agrupados) | Alta | 2022 Q149 (mediana do nº de crianças por família, tabela de frequência) |
| H28 – situação-problema de estatística/probabilidade | Alta | 2022 Q137 (probabilidade de o vencedor do 1º jogo ser campeão da World Series) |
| H29 – estatística/probabilidade como argumentação | Média | 2015 Q179 (comparar P(I), P(II), P(III) de sorteio de atleta dopado) |
| H30 – avaliar proposta de intervenção em estatística/probabilidade | Média | 2023 Q138 (quantas bolinhas brancas acrescentar para reduzir a probabilidade de vitória a ≤1%) |

---

## c) Padrão de construção das questões

**1. Contextualização quase universal.** Nas 11 provas lidas, a esmagadora maioria das 45 questões de cada ano parte de uma situação prática — nunca de "resolva a equação" ou "calcule o valor de x" isolados. Os contextos mais recorrentes são:
- **Financeiro/comercial**: preços, promoções, juros, financiamentos, lucro, folha de pagamento, reajustes (muito presente todo ano).
- **Saúde/biologia aplicada**: dosagem de medicamento, vacinação, IMC/frequência cardíaca, epidemiologia.
- **Esportivo**: tênis, corrida, natação, futebol, basquete, torneios eliminatórios.
- **Engenharia/arquitetura/design**: reservatórios, tanques, plantas em escala, embalagens, estruturas.
- **Tecnologia e jogos**: senhas, criptografia (Cifra de César), jogos digitais/tabuleiro, aplicativos.
- **Ambiental/agrícola**: reciclagem, chuva, produtividade agrícola, energia solar.
- Questões "matemática pura" (sem nenhum contexto) são raríssimas — mesmo tópicos de álgebra pura como sistemas ou funções normalmente aparecem vestidos de contexto (ex.: "custo de produção em função da quantidade").

**2. Verbos/formas de comando mais frequentes** (na frase final que introduz as alternativas):
- "...é" / "...será/deverá ser" (afirmação a completar, ex.: "A quantidade mínima de... é")
- "corresponde a" / "correspondente a"
- ⚠️ **Formas vedadas pelo Guia do Inep**, ainda que apareçam em provas antigas: "Qual é o/a valor/quantidade/número/probabilidade de...?" (comando interrogativo — reescreva como afirmação: "O valor de... corresponde a") e "correto afirmar que" (proibido pelo item 10 do Guia). Ver `guia_inep_elaboracao_itens.md`.
- "Nessas condições, ..." / "De acordo com..." / "Com base nessas informações, ..." (frase de transição antes do comando)
- "O gráfico/esboço que melhor representa..." (para questões de leitura/interpretação gráfica)
- "Para atender/garantir/atingir [objetivo]..., [a pessoa/empresa] deverá..."
- Muitas questões terminam pedindo para **escolher entre 5 opções nomeadas** (produto, pessoa, cidade, proposta I a V) em vez de um valor numérico direto — um padrão típico de H5/H9/H14/H18/H23/H30 (avaliação de propostas).

**3. Construção dos distratores — sempre erros de raciocínio típicos, nunca números aleatórios.** Em todas as questões analisadas em profundidade, cada alternativa errada corresponde a um erro plausível e específico que um estudante cometeria ao aplicar mal um conceito. Padrões recorrentes observados:
- **Confundir média aritmética simples com média ponderada** (ex.: 2023 Q137 — somar os dois salários e dividir por 2, ignorando o número de funcionários de cada setor, dá exatamente uma das alternativas erradas).
- **Esquecer de elevar a razão de escala ao cubo (volume) ou ao quadrado (área)**, aplicando a escala linearmente (comum em questões de escala 1:n com volume/área).
- **Trocar numerador e denominador** em razões, taxas ou porcentagens.
- **Não completar todas as etapas do problema** — parar no resultado de um passo intermediário (ex.: calcular só a variação em vez do valor final, ou usar N em vez de N−1 pessoas).
- **Usar a fórmula errada mas plausível** (ex.: aplicar juros simples em vez de compostos, ou aplicar a interseção de eventos em vez da probabilidade condicional correta, como em 2019 Q173).
- **Esquecer de converter unidades** (mm vs cm vs m; litros vs m³; minutos vs horas) — extremamente comum como "pegadinha" central da questão, não apenas como distrator.
- **Aplicar apenas parte de uma restrição composta** (ex.: usar somente o desconto mínimo OU somente o máximo de um intervalo, como em 2018 Q163 sobre redução de pena).
- **Inverter a direção do arredondamento ou da comparação** (escolher o valor imediatamente "errado" ao lado do correto num intervalo).
- **Usar dado do enunciado fora de contexto** (pegar um número que aparece no texto — mas que se refere a outra grandeza — e aplicá-lo diretamente).

Não foi observado nenhum caso de distrator "aleatório" sem lastro conceitual: mesmo alternativas obviamente erradas remontam a um caminho de resolução incompleto ou equivocado, o que é essencial para calibrar um gerador automático — os distratores devem ser **derivados do processo de resolução**, não sorteados.

**4. Estrutura de apresentação.** É comum a questão trazer: (i) um texto-base com contexto (às vezes com fonte/referência bibliográfica real, ex. "Disponível em: ... Acesso em: ..."); (ii) dados em tabela, gráfico ou figura; (iii) um parágrafo final que isola o comando específico da pergunta, muitas vezes introduzindo uma restrição adicional de última hora (ex.: "considere 3 como aproximação para π", "utilize 1,4 como aproximação para √2") — essas aproximações numéricas são fornecidas quase sempre que a questão envolve π, raiz não exata ou logaritmo, para permitir que o cálculo seja fechado sem calculadora.

---

## d) Nota sobre exemplos ilustrativos

Por respeito aos direitos autorais do INEP sobre as provas originais, este manual não reproduz o enunciado completo de questões reais. Para exemplos ilustrativos de tema, ano e habilidade mobilizada, consulte a tabela de frequência da seção (b) acima, que já traz uma referência curta (ano, número da questão e um resumo de uma linha do tema) para cada habilidade. Os padrões de construção descritos na seção (c) foram derivados da leitura integral das 11 provas, mas expressos aqui como descrição estrutural, não como cópia de texto original.

---

## e) Observações finais — mudanças de tendência ao longo do tempo

1. **Estabilidade estrutural muito forte.** A macroestrutura (45 questões de Matemática, sempre 136–180, sempre a segunda metade do caderno do Dia 2, sempre 5 alternativas A–E) não mudou em nenhum dos 11 anos. O "tom" das questões — contextualização longa seguida de comando curto — também é constante desde 2015.

2. **Qualidade da extração de texto varia por ano por razões de diagramação, não de conteúdo.** 2021 tem falhas graves de encoding (fontes provavelmente não padrão/CID no PDF original). 2022 e 2024 inserem uma marca d'água repetida "ENEM20XX" no meio do texto (ruído de OCR/layout, não de conteúdo). Isso é um problema de **pipeline de dados**, não de mudança editorial do exame, e deve ser tratado antes de qualquer treinamento automatizado nesses anos.

3. **Leve aumento de questões com múltiplas grandezas/parâmetros simbólicos (2022–2025).** Comparado aos primeiros anos (2015–2017), os últimos exames trazem mais questões cuja resposta é uma **expressão algébrica** (em vez de valor numérico), como fórmulas de tarifas de aplicativos (2024 Q156), fluxo através de membrana (2024 Q159) ou unidades de medida de grandezas compostas (2023 Q173, 2025 Q179) — um padrão de habilidade H19/H22 que parece mais recorrente nos anos recentes.

4. **Estatística e probabilidade seguem presença constante e crescente em sofisticação.** Nos anos iniciais, é comum probabilidade simples (razão favorável/total) e médias/medianas diretas. A partir de 2019–2022, aparecem mais problemas de **probabilidade condicional** (2019 Q173), **eventos compostos com "pelo menos um"** (2021 Q142, presença desde sempre mas mais frequente), e **combinatória aplicada a torneios eliminatórios** (2018 Q162, 2022 Q137) — sugerindo maior ênfase em raciocínio probabilístico multietapas, não só em fórmulas de contagem.

5. **Geometria com sólidos "híbridos" e figuras compostas aumenta a dependência de suporte visual.** Anos mais recentes (2022–2025) trazem mais frequentemente sólidos obtidos por composição/corte (tronco de cone perfurado, poliedro de Johnson, justaposição de prisma+tronco de pirâmide, cubo com projeções em 3 planos) — todas essas questões dependem fortemente de figura não capturada em texto. Um gerador automático que queira reproduzir esse padrão precisará de um motor de geração de imagens geométricas, não apenas de texto.

6. **Uso de dados reais e citações de fonte é uma convenção fixa.** Praticamente todo problema com gráfico ou tabela cita uma fonte fictícia-plausível ("Disponível em: www.[site].com.br. Acesso em: [data]") — esse padrão de citação (mesmo quando o "site" é genérico) é consistente em todos os 11 anos e deveria ser reproduzido por um gerador para manter o realismo estilístico do ENEM.

7. **Aproximações numéricas fornecidas ("considere π=3", "utilize log 2 ≈ 0,3" etc.) são um recurso de calibração de dificuldade, não de conteúdo.** Aparecem em praticamente todo ano sempre que a resposta exata exigiria calculadora — um sinal claro de que o exame é desenhado para ser resolvido sem calculadora, e que um gerador automático deve inserir essas aproximações sempre que o modelo matemático da questão envolver π, raízes não exatas, ou logaritmos/exponenciais não fechados.

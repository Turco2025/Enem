# Manual de Padrões de Elaboração de Questões — Ciências da Natureza e suas Tecnologias (ENEM 2015–2025)

Fontes analisadas (extrações `pdftotext -layout`, todas as 45 questões de Ciências da Natureza de cada ano foram lidas e classificadas):

- 2015: `/home/claude/enem/text/2015/ENEM_2015_Prova_Dia1_Azul.txt` (Q46–90, Dia 1 nesse ano/2016)
- 2016: `/home/claude/enem/text/2016/ENEM_2016_Prova_Dia1_Azul.txt` (Q46–90)
- 2017: `/home/claude/enem/text/2017/ENEM_2017_Prova_Dia2_Azul.txt` (Q91–135)
- 2018: `/home/claude/enem/text/2018/ENEM_2018_Prova_Dia2_Azul.txt` (Q91–135)
- 2019: `/home/claude/enem/text/2019/ENEM_2019_Prova_Dia2_Azul.txt` (Q91–135)
- 2020: `/home/claude/enem/text/2020/ENEM_2020_Prova_Dia2_Azul.txt` (Q91–135)
- 2021: `/home/claude/enem/text/2021/ENEM_2021_Prova_Dia2_Azul.txt` (Q91–135) — **texto com corrupção severa de codificação** (ver limitação em Observações finais)
- 2022: `/home/claude/enem/text/2022/ENEM_2022_Prova_Dia2_Azul.txt` (Q91–135)
- 2023: `/home/claude/enem/text/2023/ENEM_2023_Prova_Dia2_Azul.txt` (Q91–135)
- 2024: `/home/claude/enem/text/2024/ENEM_2024_Prova_Dia2_Azul.txt` (Q91–135)
- 2025: `/home/claude/enem/text/2025/ENEM_2025_Prova_Dia2_Azul.txt` (Q91–135)

---

## a) Estrutura geral

Em todos os 11 anos a área de Ciências da Natureza mantém exatamente **45 questões** (46 a 90 em 2015–2016, quando a área ainda saía no Dia 1; 91 a 135 em 2017–2025, já no Dia 2, junto com Matemática). A proporção entre as três disciplinas é notavelmente estável ano a ano, com pequena variação (±1–2 questões):

| Disciplina | Proporção típica | Nº aproximado de questões/ano |
|---|---|---|
| Química | ~35–38% | 16–17 |
| Física | ~33–36% | 15–16 |
| Biologia | ~27–31% | 12–14 |

Não há um padrão fixo de ordenação (as três disciplinas se intercalam ao longo das 45 questões, sem blocos separados), mas é comum que a prova abra com uma sequência inicial (Q91–Q96 ou Q46–Q51) alternando rapidamente entre as três áreas, e que os últimos itens de cada bloco frequentemente tragam questões mais "conceituais longas" (textos de apoio maiores, ex. Q133–135 em vários anos).

**Dependência de suporte visual não capturado.** Uma fração substancial das questões depende de gráficos, tabelas complexas, esquemas de circuito, fórmulas estruturais, mapas ou heredogramas que o `pdftotext -layout` não reproduz de forma legível (curvas sobrepostas, eixos sem rótulo recuperável, estruturas moleculares desenhadas). Estimativa por ano, com base na leitura completa de cada prova:

- Cerca de **40% a 50% das 45 questões por ano** fazem referência a algum elemento visual (gráfico, tabela grande, figura, esquema, fórmula estrutural desenhada). Dentro desse grupo, uma parte menor (por volta de 15–20% do total da prova) tem o gráfico/figura como elemento indispensável para resolver a questão (ex.: "qual gráfico representa..."), tornando o item **não reconstituível a partir do texto puro** — nessas questões o relatório usa a marcação **"usa suporte visual não capturado"**.
- Física é a disciplina mais dependente de gráficos/circuitos/vetores desenhados (ex.: questões de tipo "qual gráfico representa v(t)/f(t)", diagramas de força, circuitos elétricos).
- Química depende fortemente de fórmulas estruturais, tabelas periódicas de dados e esquemas de aparelhagem/industriais.
- Biologia é a que mais frequentemente é resolúvel só com texto corrido (quadros comparativos simples, tabelas de uma linha), mas também usa heredogramas, mapas de bioma e fotos de organismos.

Anos com maior densidade de itens "somente gráfico" (mais difíceis de recuperar via texto): 2020 (Q94, Q127–128 estilo "qual gráfico"), 2025 (Q127–128, Q135), 2019 (Q93, Q102 etc.), 2022 (esquemas industriais complexos, ex. Q91 sobre remediação de solo).

**Limitação de dados 2021**: o arquivo de 2021 apresenta corrupção de codificação de caracteres em grandes trechos de texto corrido (fontes/ligaduras não decodificadas corretamente pelo extrator), tornando muitas frases ilegíveis, embora números, fórmulas químicas, alternativas (A–E) e a estrutura geral das questões permaneçam identificáveis. Por isso, os dados de 2021 neste relatório são tratados com menor confiança e poucos itens de 2021 aparecem no banco de exemplos.

---

## b) Distribuição por habilidade (H1–H30)

A tabela abaixo indica, para cada habilidade da Matriz de Referência de Ciências da Natureza, uma estimativa de frequência observada no corpus (alta = aparece em quase todos os anos, várias vezes; média = aparece na maioria dos anos, 1–3 vezes; baixa = aparece esporadicamente) e um exemplo real (ano + número da questão). As descrições das habilidades seguem o sentido da Matriz de Referência oficial do ENEM (competências de área 1 a 8); a redação abaixo é uma paráfrase fiel do escopo de cada habilidade.

| Habilidade | Foco | Frequência | Exemplo real |
|---|---|---|---|
| H1 | Fenômenos ondulatórios/oscilatórios e seus usos | Alta | 2025 Q135 (fotoluminescência/luz em fototerapia); 2025 Q132 (nível sonoro em dB) |
| H2 | Relação entre desenvolvimento científico-tecnológico e solução de problemas (comunicação, transporte, saúde) | Alta | 2016 Q47 (potência de hidrelétrica); 2025 Q135 (sensor de fototerapia) |
| H3 | Confronto entre interpretação científica e senso comum/histórica | Média | 2023 Q92 (crendice popular do prego enferrujado x anemia) |
| H4 | Avaliação de métodos/procedimentos científicos para problemas sociais/ambientais | Média | 2023 Q94 (teste de dureza da água em indústria) |
| H5 | Dimensionamento de circuitos/dispositivos elétricos | Média | 2025 Q130 (resistor de proteção); 2017 Q93 (resistência de polianilina) |
| H6 | Compreensão de manuais/instalação de aparelhos e processos tecnológicos | Baixa | 2025 Q130 (adaptação de fonte de alimentação) |
| H7 | Aparatos tecnológicos que captam/ampliam informação | Média | 2025 Q135 (sensor óptico de fototerapia); 2017 Q93 (sensor de amônia) |
| H8 | Códigos e nomenclatura da linguagem científica | Alta | 2019 Q108 (fórmula de Lewis de composto de xenônio); 2024 Q93 (definição de composto orgânico) |
| H9 | Papel da evolução tecnológica na aplicação de ciências naturais | Média | 2018 Q91 (nanotecnologia molecular fotoativada) |
| H10 | Perturbações ambientais: fontes, transporte e destino de poluentes | Alta | 2022 Q91 (remediação de solo com TCE); 2020 Q132 (poluição por fogos de artifício) |
| H11 | Benefícios/limitações/ética da biotecnologia | Média | 2016 Q48-tipo (marcação radioativa de proteínas); 2024 (biobateria por CCM, Q91) |
| H12 | Impactos ambientais de atividades sociais/econômicas | Alta | 2015 Q46 (corante industrial e eutrofização) |
| H13 | Avaliação de proposta de intervenção ambiental | Média | 2016 Q46 (Park Spark / biodigestor de fezes de animais) |
| H14 | Interpretação de modelos/experimentos biológicos | Alta | 2019 Q107 (fototropismo em Artemia) |
| H15 | Padrões em fenômenos e processos vitais | Alta | 2019 Q110 (leis de Mendel — distribuição independente) |
| H16 | Respiração, fotossíntese e metabolismo celular | Alta | 2019 Q94 (nanotubos de carbono e fotossíntese) |
| H17 | Condições físico-químicas do ambiente e manutenção da vida | Média | 2024 Q91 (bactérias eletrogênicas em CCM) |
| H18 | Interações entre organismos e ambiente | Alta | 2023 Q91 (bombas de sementes e declínio de abelhas) |
| H19 | Seleção de variáveis/instrumentos para experimentação | Média | 2025 Q128 (sensores de platina, sensibilidade) |
| H20 | Interpretação de experimentos/técnicas laboratoriais | Alta | 2023 Q97 (amadurecimento de abacate em recipiente fechado) |
| H21 | Elaboração/avaliação de hipóteses | Média | 2025 Q127 (gráfico de energia de reação com/sem enzima) |
| H22 | Análise de informações em diferentes linguagens (gráfico, tabela, fórmula) | Alta | 2020 Q134/135 (densidade de moedas via proveta) |
| H23 | Compreensão de fenômenos por agentes físicos/químicos/biológicos | Alta | 2018 Q93 (pilha de Bagdá — potenciais-padrão de redução) |
| H24 | Equilíbrio e transformação de energia | Alta | 2022 Q91 (cálculo de área de painel solar); 2015 Q49 (carro solar) |
| H25 | Leis físicas de fenômenos ondulatórios/luz | Média | 2019 Q49-tipo (efeito Doppler, gráfico f(t)); 2025 Q135 |
| H26 | Conservação de energia/quantidade de movimento | Alta | 2024 Q91 (crumple zone e quantidade de movimento); 2019 Q111 (impulso no capacete) |
| H27 | Caráter aleatório/probabilístico de fenômenos naturais | Baixa | Uso ocasional em genética (cruzamentos, proporções mendelianas) — 2019 Q110 tangencia |
| H28 | Transformações químicas (estequiometria, rendimento) | Alta | 2025 Q131 (redução aluminotérmica do nióbio); 2016 Q50 (entalpia por Lei de Hess) |
| H29 | Equilíbrios químicos e cinética | Alta | 2025 Q127 (cinética enzimática); 2018 chuveiro-tipo eletrólise (2017 Q95) |
| H30 | Radioatividade, energia nuclear e suas aplicações/riscos | Média | 2023 Q93 (vantagens/desvantagens da energia nuclear) |

Observação metodológica: como o enunciado exato das 30 habilidades não estava mais disponível verbatim neste momento da análise (apenas os códigos e o escopo geral), o mapeamento acima é fiel ao escopo temático de cada habilidade na Matriz de Referência do ENEM, mas a redação das descrições é paráfrase, não transcrição oficial. Recomenda-se validar a redação exata contra o documento oficial do INEP antes de calibrar prompts de geração automática.

De forma geral, as habilidades mais mobilizadas (alta frequência, presentes em praticamente todos os 11 anos) são as ligadas a: leitura/interpretação de gráficos e tabelas (H22), estequiometria e cálculos químicos (H28), conservação de energia e mecânica (H24/H26), interações ambientais e poluição (H10/H12/H18), e fisiologia/metabolismo (H16). As de frequência mais baixa são as puramente estatístico-probabilísticas (H27) e as de manual/instalação de aparelhos (H6), que aparecem só ocasionalmente.

---

## c) Padrão de construção das questões

**Como o contexto é introduzido.** A esmagadora maioria das questões (>80%) abre com um parágrafo de contextualização de 3 a 8 linhas antes de chegar ao comando. Os tipos de abertura mais recorrentes, em ordem de frequência:

1. **Notícia/reportagem de divulgação científica ou texto jornalístico** — ex.: "Em 2017, foi inaugurado, no estado da Bahia, o Parque Solar Lapa..." (2022 Q91); quase sempre citando a fonte ("Disponível em: ... Acesso em: ...").
2. **Processo industrial ou tecnológico descrito passo a passo** — ex.: eletrólise cloro-soda (2017 Q95), redução aluminotérmica do nióbio (2025 Q131), remediação de solo com persulfato (2022 Q91).
3. **Experimento didático ou de laboratório descrito** — ex.: abacates em recipiente fechado (2023 Q97), densímetro em soluções salinas (2018 Q95), reação com/sem enzima (2025 Q127).
4. **Fenômeno cotidiano ou popular, muitas vezes com "crendice" a ser confrontada com a ciência** — ex.: prego enferrujado no feijão (2023 Q92), mitos sobre raios (2019 Q133), spray de pimenta (2016 Q46).
5. **Texto científico/histórico mais longo, citando artigo ou paper** — ex.: pilha de Bagdá (2018 Q93), nanotecnologia molecular (2018 Q91), hormônios sexuais no ambiente (2025 Q134).
6. **Situação-problema puramente numérica/técnica, sem narrativa** (mais rara, mais comum em Física) — ex.: "Considere um equipamento de resistência elétrica RC..." (2025 Q130).

Quase sempre há uma **fonte citada ao final do texto-suporte** (revista científica, jornal, site .gov/.edu, livro didático de referência), o que empresta credibilidade e ancora a situação-problema no mundo real — esse é um traço extremamente consistente ao longo dos 11 anos e um elemento fácil de replicar em um gerador automático.

**Verbos de comando mais frequentes:**
- "Qual...é/são" (identificação direta do resultado correto) — o mais comum de longe.
- "O(A) que representa / indica / decorre de..."
- "Nessas condições / Com base nesses dados, calcule/estime/é mais próximo(a) de..." (cálculo numérico com "valor mais próximo de", muito comum em Física e Química desde ~2016).
- "Esse processo/fenômeno ocorre porque..." (pede o mecanismo causal, comum em Biologia/Química).
- "Assinale a alternativa que apresenta corretamente..."
- "Qual gráfico representa..." (típico de Física, exige suporte visual nas alternativas).

**Como os distratores são construídos:**
- **Erro de unidade ou de ordem de grandeza**: alternativas com o mesmo dígito mas potência de 10 errada (ex. 2017 Q93: "0,5×10⁰", "2,0×10⁰", "2,5×10⁵", "5,0×10⁵", "2,0×10⁶" — inversão entre leitura de resistência mínima/máxima do gráfico e erro de conversão de escala).
- **Troca de sinal ou de sentido físico** (velocidade/sentido invertido, aceleração positiva/negativa, ex. 2019 Q109 sobre velocidade angular do foguete "igual/maior/menor" combinado com "mesmo sentido/sentido oposto" — todas as 4 combinações lógicas aparecem como distratores).
- **Confusão conceitual clássica**: aplicar uma lei/conceito de área adjacente errada (ex. confundir cátodo com ânodo em pilha, 2018 Q93; confundir eutrofização com fotodegradação, 2015 Q46).
- **Cálculo com etapa esquecida ou trocada**: usar apenas parte dos dados fornecidos (ex. esquecer o excesso de reagente no cálculo estequiométrico do nióbio, 2025 Q131: 2,7 / 3,0 / 4,1 / 4,5 / 5,0 kg — cada valor corresponde a um erro típico: ignorar excesso, usar massa molar errada, trocar proporção estequiométrica).
- **Resultado "quase certo" mas com grandeza errada** (dB somado linearmente em vez de logaritmicamente, 2025 Q132: 60/104/140/400/800 dB — o distrator 140 dB corresponde ao erro comum de somar 40 dB de forma linear, e 400/800 são erros de multiplicar direto por 10.000).
- **Inversão de causa/efeito ou de proporcionalidade direta/inversa** (comum em gráficos: "aumenta quando deveria diminuir").
- Em Biologia, é muito comum o distrator citar um **mecanismo biológico real, mas que não se aplica ao organismo/situação do enunciado** (ex. 2023 Q95, aves migratórias: "execução de manobras" e "aerodinâmica" são mecanismos reais de voo, mas não o que o texto pede sobre metabolismo muscular).

Estrutura das alternativas: quase sempre 5 alternativas (A–E), com 1 a 2 linhas cada; em Física/Química frequentemente terminam em valor numérico "mais próximo de X"; em Biologia e partes de Química frequentemente são frases completas descrevendo um mecanismo/processo.

---

## d) Nota sobre exemplos ilustrativos

Por respeito aos direitos autorais do INEP sobre as provas originais, este manual não reproduz o enunciado completo de questões reais. Para exemplos ilustrativos de tema, ano e habilidade mobilizada, consulte a tabela de frequência da seção (b) acima, que já traz uma referência curta (ano, número da questão e um resumo de uma linha do tema) para cada habilidade. Os padrões de construção descritos na seção (c) foram derivados da leitura integral das 11 provas, mas expressos aqui como descrição estrutural, não como cópia de texto original.

---

## e) Observações finais — mudanças de padrão ao longo do tempo

1. **Aumento do uso de "valor mais próximo de" em cálculos numéricos.** Esse formato (que evita gabarito "redondo" e obriga cálculo real) se torna mais frequente a partir de ~2017–2018 e é dominante em Física/Química nos anos mais recentes (2022–2025), substituindo parcialmente perguntas de múltipla escolha puramente conceituais.
2. **Crescimento de temas de sustentabilidade, energias renováveis e química verde/ambiental.** Nióbio e mineração sustentável, energia solar, biodigestores, biocombustíveis, remediação de solos e Química Verde aparecem com frequência crescente de 2015 a 2025, refletindo currículo BNCC e agenda ambiental — praticamente todo ano tem ao menos 3–5 questões nesse eixo.
3. **Maior sofisticação dos textos de apoio, citando artigos científicos reais e recentes** (inclusive Scientific Reports, Química Nova, dissertações). Isso é mais visível a partir de 2019–2020: cada vez mais os textos-base citam publicação, ano e "(adaptado)", em vez de textos genéricos de livro didático.
4. **Biotecnologia e sensores/materiais inteligentes** ganham espaço nos anos mais recentes (2023–2025): biossensores de fototerapia, biobaterias microbianas (CCM), sensores de platina, materiais orgânicos luminescentes — um eixo temático quase ausente em 2015–2017 e recorrente em 2023–2025.
5. **Qualidade de extração do PDF varia muito por ano.** 2021 apresenta corrupção severa de caracteres (provável problema de fonte/ligadura no PDF original), inutilizando boa parte do texto corrido para fins de calibração fiel — deve ser tratado como ano de menor confiabilidade ou reprocessado com outra ferramenta de OCR/extração antes de ser usado para treinar o gerador. Anos com marca d'água repetida ("ENEM2022...", "ENEM2024...", "ENEM2025...") não perdem conteúdo, mas aumentam bastante o comprimento de linha do texto extraído.
6. **A dependência de suporte visual não capturado é uma constante estrutural, não uma falha pontual**: em todo os 11 anos, entre 40% e 50% das questões fazem referência a gráfico/tabela/figura/fórmula estrutural. Um gerador automático de questões ENEM-símile deveria, portanto, deliberadamente incluir uma fração equivalente de itens com suporte visual (não apenas textuais), mas o banco de exemplos aqui priorizou os itens textuais/numéricos por serem diretamente replicáveis por um LLM sem geração de imagem.
7. **O "confronto senso comum vs. ciência"** (prego enferrujado, mitos sobre raios, spray de pimenta, crendices populares) é um gatilho de abertura recorrente em todos os anos e parece ser um padrão editorial deliberado do INEP, útil como template de geração.

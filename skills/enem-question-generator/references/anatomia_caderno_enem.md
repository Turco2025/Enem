# Anatomia do caderno ENEM — system design obrigatório

Especificação de impresso para **PDF, DOCX e impressão** — vale para as **duas versões**, aluno e professor.

**Fonte da medição:** ENEM **2025**, 2º dia, Caderno 7, versão **Azul** (INEP/MEC), 32 páginas,
90 questões (91–180). Todas as medidas abaixo foram extraídas da geometria vetorial, das
fontes incorporadas e da amostragem de pixels do PDF oficial — nenhuma foi estimada a olho.

> **Escopo.** Vale para as **duas versões**. A diagramação das questões é idêntica
> nas duas. Depois de todas as questões, cada versão fecha de um jeito: a do aluno
> com a **folha de gabarito** (só as letras) e a do professor com o **caderno de
> respostas** completo (§7). Nada de gabarito, resolução ou comentário aparece
> junto das questões — em nenhuma das duas.

> ⚠️ **Esta é a revisão 2025.** A versão anterior deste arquivo descrevia o caderno de
> **2019**. O INEP redesenhou a prova: a família tipográfica, a entrelinha, os filetes, o
> ornamento da questão, o uso de cor e a lógica de margens **mudaram**. A seção 9 lista
> item a item o que foi corrigido.

---

## 1. Formato e grade

| Elemento | Medida | Observação |
|---|---|---|
| Página | **200 × 275 mm** | Formato próprio do INEP, menor que A4 (210 × 297). Inalterado desde 2019 |
| Mancha (largura) | **182,33 mm** | Idêntica em todas as páginas do miolo |
| Mancha (topo) | **y = 26,88 mm** | Topo da caixa do primeiro texto |
| Mancha (base) | **y ≤ 261,4 mm** | Fluxo das colunas termina em **y = 260,0 mm** |
| Colunas | **2 × 89,47 mm** | `89,47 × 2 + 3,40 = 182,34 mm` |
| Calha central | **3,40 mm** | Com **fio vertical sólido** (ver §4) |
| Modo coluna única | **182,33 mm** | Página inteira em 1 coluna quando há figura larga (ver §6) |
| Recuo de parágrafo | **6,0 mm** | Só na primeira linha; **sem** linha em branco entre parágrafos |

### Margens espelhadas (mudança importante)

A mancha **não** fica centralizada: ela desliza 2,5 mm conforme a paridade da página,
deixando a margem **externa** maior que a **interna**.

| Página | Margem esquerda | Margem direita | Interna | Externa |
|---|---|---|---|---|
| **Ímpar** (dir.) | **8,00 mm** | 9,67 mm | 8,00 (esq.) | 9,67 (dir.) |
| **Par** (esq.) | **10,50 mm** | 7,17 mm | 7,17 (dir.) | 10,50 (esq.) |

Tudo que é "de canto" segue a margem **externa**: código de barras, fólio (número da
página) e tarja de cor. Tudo que é "de miolo" segue a **interna**: logotipo e texto
corrido do rodapé.

---

## 2. Tipografia

**A família mudou: o ENEM 2025 é composto em Calibri, não em Arial.**
Distribuição real de caracteres no miolo: Calibri 68,9 % · Calibri-Bold 3,8 % ·
Calibri-Light 2,0 % · Calibri-Italic 0,3 % · BundesbahnPiStd-1 0,5 % (letras-opção) ·
C39HrP36DlTt 0,4 % (código de barras) · Arial-Bold 1,5 pt 23,9 % (microtexto de
segurança, §4).

| Papel | Fonte | Corpo | Entrelinha | Alinhamento | Cor |
|---|---|---|---|---|---|
| **Corpo de texto** | Calibri Regular | **10 pt** | **12,0 pt (1,20×)** | justificado, recuo 6 mm | #231F20 |
| **Alternativas A–E** | Calibri Regular | **10 pt** | **13,4 pt (1,34×)** | **justificado**, pendurado 4,5 mm | #231F20 |
| **Rótulo "QUESTÃO N"** | Calibri Bold | **11 pt** | — | caixa alta, margem da coluna | #231F20 |
| **Título de área** | Calibri Bold | **11 pt** | — | caixa alta, recuado 2 mm | #231F20 |
| **Rótulo "TEXTO I / II"** | Calibri Bold | **10 pt** | 12,0 pt | à esquerda | #231F20 |
| **Subtítulo interno** (ficha, resolução, comentários) | Calibri Bold | **10 pt** caixa alta | 12,0 pt | **justificado** (linha única, não estica) | #231F20 |
| **Referência do texto introdutório** | Calibri ***Italic*** | **8 pt** (corpo − 2) | 9,6 pt | **à direita** (bandeira à esquerda) | #231F20 |
| **Referência de imagem, tabela e gráfico** | Calibri Regular | **8 pt** (corpo − 2) | 9,6 pt | **justificada** | #231F20 |
| **Título da obra na referência** | Calibri **Bold** (bold-itálico no texto introdutório) | 8 pt | — | — | #231F20 |
| **Rodapé corrido** | Calibri **Light** | **9 pt** | — | margem interna | **#58595B** |
| **Fólio (nº da página)** | Calibri Bold | **9 pt** | — | margem **externa** | #231F20 |
| **Índices e expoentes** | Calibri Regular | **6,5 pt** (0,65×) | — | — | #231F20 |
| **Cabeçalho de tabela** | Calibri Bold | 10 pt | 12,0 pt | centralizado | #231F20 sobre #6DCFF6 |
| **Símbolos matemáticos** | SymbolMT / Times New Roman | 6–12 pt | — | — | #231F20 |

Escala da capa: 32 pt bold (título) · 23 pt bold branco ("2º DIA") · 20 pt bold ("AZUL")
· 15 pt bold (nome das provas) · 13 pt ("CADERNO") · 12 pt (instruções destacadas) ·
11 pt (lista numerada) · 45 pt bold (número do caderno).

### 2.1 As duas referências bibliográficas

O corpo é sempre o **corpo do texto menos dois pontos** — 8 pt para um corpo de
10 pt. O que muda é o tratamento, e os dois **não se misturam**:

| | Texto introdutório (texto-base) | Imagem, tabela e gráfico |
|---|---|---|
| Corpo | 8 pt (corpo − 2) | 8 pt (corpo − 2) |
| Inclinação | ***itálico*** | redondo |
| Alinhamento | **à direita** | **justificado** |
| Título da obra | negrito-itálico | negrito |

A leitura por trás da regra: a referência do texto introdutório fecha um bloco de
leitura e recua para a direita, em itálico, sem competir com o corpo. A referência
de um recurso visual é a legenda de uma figura — ela pertence à caixa da figura e
por isso ocupa a largura inteira, justificada nas duas margens.

**Espaçamento entre letras: zero.** Tracking nativo da fonte, sem kerning manual —
medido caractere a caractere em 14 518 pares: mediana **0,0000 pt**.

**Peso e inclinação são exceção, não regra.** No corpo de 10 pt: 97,7 % regular,
0,9 % negrito (rótulos de texto, cabeçalho de tabela), 0,4 % itálico (nome científico e
estrangeirismo). Na referência de 8 pt: 85 % regular e **15 % negrito** — o título da
obra vai em **negrito, nunca em itálico**.

> **Nota de implementação.** O jsPDF não embarca Calibri. Use Carlito (métrica
> idêntica a Calibri, licença livre) ou, na falta dela, Helvetica com **+2 % de corpo**
> para compensar a altura-x menor. No Word declare **Calibri** de verdade.

---

### 2.2 Justificação — regra do professor

**Todo texto do simulado sai justificado nas duas margens.** Vale para o
texto-base, o comando, as **alternativas A–E**, o gabarito, a ficha pedagógica,
a resolução comentada e o comentário de cada alternativa — e vale nas três
saídas: **PDF, Word (DOCX) e HTML**, que precisam continuar idênticas entre si.

O que isso significa na prática:

- a última linha de cada parágrafo **nunca** é esticada — é assim que a
  justificação funciona, e é o que evita o efeito de palavras espalhadas;
- alternativa de uma linha só (o caso comum em Matemática, Física e Química)
  fica visualmente igual ao alinhamento à esquerda, porque linha única é
  sempre última linha;
- rótulos e subtítulos de uma linha (`QUESTÃO N`, `FICHA PEDAGÓGICA`) recebem o
  alinhamento declarado por coerência, sem efeito visual;
- o **espaço inseparável** que mantém a fórmula química inteira (§ notação
  química) não é vão de justificação: o esticamento distribui-se só pelos
  espaços comuns, para que `CaCO₃(s) ⇌ Ca²⁺(aq)` não se abra no meio.

**Única exceção:** a *referência bibliográfica do texto introdutório*, que
permanece em itálico e alinhada à direita, como no caderno oficial (§2.1).

> Divergência assumida em relação ao ENEM 2025: o caderno oficial alinha as
> alternativas à esquerda. A justificação das alternativas é uma determinação
> do professor responsável, registrada aqui para que ninguém a "corrija" de
> volta achando que é um desvio do padrão.

## 3. Cor

O caderno de 2025 **usa cor no miolo**. Isso é a maior ruptura em relação a 2019.

| Uso | Cor |
|---|---|
| Texto (todo o miolo) | **#231F20** — preto quente de impressão, **não** #000000 |
| Rodapé corrido | **#58595B** |
| Ornamento e quadrados do cabeçalho | **#939598** |
| Azul da versão (tarja, barra da questão, filetes) | **#B9E5FA** |
| Azul do logotipo "enem" | **#004B8D** |
| Azul de cabeçalho de tabela | **#6DCFF6** |
| Azul de realce claro | **#E8F6FD** |
| Papel | #FFFFFF |

Paleta de apoio observada em gráficos: verde #82CA9C / #9DD29C, amarelo #FFCB04 /
#FFF2D1, salmão #F69679 / #FEE7DD.

### Ilustrações

Das **83 figuras** do miolo, **41 (49 %) são coloridas** e 42 são monocromáticas.
Fotos, esquemas biológicos, mapas e gráficos estatísticos saem em cor plena; esquemas
puramente geométricos ou físicos costumam ficar em preto.

> Ou seja: **imagem colorida na versão do aluno agora é fiel ao original**, não mais uma
> divergência autorizada. A observação da revisão anterior está revogada.

---

## 4. Cromo da página (o que se repete em toda página do miolo)

**Cabeçalho**

- **Logotipo `enem2025`** — vetorial, 28,01 × 6,67 mm, em `y = 10,34–17,01 mm`, na
  margem **interna**. "enem" em #004B8D, "2025" em #939598, com a linha
  "Exame Nacional do Ensino Médio" abaixo.
- **Quatro quadrados girados** de 5,4–5,6 × 6,6 mm em **#939598**, encostados no
  logotipo — é o "enfeite" que em 2019 ficava ao lado do rótulo da questão.
- **Barra cinza** de 48,93 × 2,38 mm em #939598, `y = 19,29–21,67 mm`, sob o logotipo.
- **Código de barras Code 39** (fonte `C39HrP36DlTt`, 20 pt) na margem **externa**,
  `y ≈ 12,3 mm`, conteúdo `*020325AZ<página>*`.
- **Filete de cabeçalho em `y = 25,00 mm`**, composto de dois trechos:
  – um segmento **#B9E5FA** de **49,16 mm** encostado na margem **interna**;
  – um segmento de **microtexto** de **131,54 mm** encostado na margem **externa**.

**Microtexto de segurança (substitui o "fio pontilhado" de 2019)**

O que parece um filete pontilhado é, na verdade, a palavra `ENEM2025` repetida em
**Arial-Bold 1,5 pt**, cor #231F20, ocupando 131,54 mm. É recurso antifraude, não
ornamento. Aparece duas vezes por página: `y = 24,63–25,39 mm` e
`y = 262,63–263,39 mm`. **No cabeçalho fica do lado externo; no rodapé, do interno** —
sempre cruzado em relação ao segmento azul.

**Rodapé**

- Filete em `y = 263,00 mm`, com a mesma composição invertida (azul externo / microtexto interno).
- **Texto corrido** Calibri-Light 9 pt #58595B em `y ≈ 264,1 mm`, na margem **interna**:
  `ÁREA DE CONHECIMENTO | 2º DIA | CADERNO 7 | AZUL`.
- **Fólio** Calibri-Bold 9 pt #231F20 na margem **externa**, mesma linha.

**Tarja da versão (marca de cor)**

Retângulo **#B9E5FA** de **11 × 30 mm** sangrando na borda **externa**, com um quadrado
de registro **#231F20** de **3 × 3 mm** na sua quina interna. A posição vertical
identifica a área — é um índice de polegar:

| Páginas | Área | Posição da tarja |
|---|---|---|
| 2–15 | Ciências da Natureza | **topo** (`y = −5 … 25 mm`) |
| 16–31 | Matemática | **base** (`y = 250 … 280 mm`) |

**Fio vertical da calha**

Linha **sólida** de **0,5 pt**, cor **#231F20**, em `x = 98,75 mm`, de `y = 28,00 mm` a
`y = 260,00 mm`. **Não é pontilhada.** Só existe nas páginas de duas colunas — é o
detector confiável do modo de página.

---

## 5. Anatomia de uma questão

Na ordem em que entra no fluxo da coluna:

1. **Rótulo `QUESTÃO N`** — Calibri-Bold 11 pt, **caixa alta**, encostado na margem da
   coluna, caixa em `y = 26,88–32,26 mm` quando abre a coluna.
2. **Barra-ornamento** na mesma linha do rótulo, à direita dele:
   - começa sempre em **24,47 mm** a partir da borda esquerda da coluna (posição fixa,
     independentemente do comprimento do rótulo);
   - termina **0,30 mm** antes da borda direita da coluna → **64,69 mm** em duas colunas,
     **157,56 mm** em coluna única;
   - altura **1,06 mm**, com um **filete escuro de 1 pt (#231F20)** no topo;
   - a faixa abaixo do filete é **#B9E5FA nos primeiros ~79,5 %** e **#231F20 nos
     ~20,5 % finais**.
3. **Rótulo de texto** (`TEXTO I`, `TEXTO II`) quando houver — Calibri-Bold 10 pt.
4. **Texto-base** — 10 pt / 12,0 pt, justificado, recuo de 6 mm na primeira linha.
5. **Recurso visual** — imagem, gráfico, esquema (colorido quando o original for) ou
   tabela vetorial.
6. **Referência / fonte bibliográfica** — corpo − 2 pt. Do **texto introdutório**:
   itálico, à direita. De **imagem, tabela ou gráfico**: redonda, justificada. Ver §2.1.
7. **Comando** — 10 pt, justificado, **sem recuo**.
8. **Alternativas A–E** — letra circulada (`BundesbahnPiStd-1`, 10 pt) encostada na
   margem da coluna, texto começando **4,5 mm** à direita da letra, com recuo pendurado
   nessa mesma medida; entrelinha 13,4 pt; **texto justificado** (§2.2).
9. **Filete de fechamento** — linha **sólida** de 0,5 pt, cor #231F20, **largura cheia da
   coluna (88,63 mm)**, usada **apenas quando a questão é a última da coluna** e sobra
   espaço abaixo. Ocorre em 15 das 60 colunas do caderno. **Não há filete entre questões
   consecutivas** — quem separa é a barra-ornamento da questão seguinte.

### Ritmo vertical (medido)

| Transição | Espaço |
|---|---|
| Rótulo → 1ª linha do texto-base | 0,76 mm |
| Texto → figura | 1,60 mm |
| Figura → texto | 2,11 mm |
| Último parágrafo → 1ª alternativa | 1,51 mm |
| Entre alternativas | 0 (a entrelinha de 13,4 pt já resolve) |
| Última alternativa → próximo rótulo | 2,53 mm |

---

## 6. Recursos visuais

- **Figura de coluna**: largura mediana **69,7 mm**, altura mediana **44,3 mm**,
  altura máxima observada **143,5 mm**. Nunca ultrapassa 89,47 mm de largura.
- **Figura larga**: 7 das 83 figuras passam de 95 mm (até **175,4 mm**). Quando isso
  acontece, **a página inteira vira coluna única** de 182,33 mm — não existe figura
  "atravessando" duas colunas com texto correndo ao redor.
- **Páginas de coluna única no caderno 2025**: 5, 16, 17, 20, 26, 27, 28 (7 de 30).
- **Tabelas**: moldura externa 1 pt e divisórias internas 0,5 pt em #231F20; célula de
  cabeçalho preenchida em **#6DCFF6** com texto **bold 10 pt centralizado**; células de
  corpo brancas, texto 10 pt centralizado; milhar separado por espaço fino (`1 100`).

---

## 7. As duas versões

### 7.1 Caderno de questões — igual nas duas versões

**Entra:** rótulo da questão, barra-ornamento, rótulos de texto, texto-base, recurso
visual (colorido), referência, comando, alternativas A–E, filete de fechamento quando
for o caso.

**Não entra, em nenhuma das duas:** gabarito, resolução comentada, comentários das
alternativas, competência, habilidade, objeto de conhecimento. Nada que entregue a
resposta pode aparecer ao lado da questão — nem no caderno do professor. O professor
lê a questão exatamente como o aluno a lê.

### 7.2 Folha de gabarito — versão do aluno

Abre em **página nova**, com o **título de área** `GABARITO`, e segue no fluxo de duas
colunas. Traz **somente a letra de cada questão**, uma por linha:

- número da questão em **bold 10 pt**, encostado na margem da coluna;
- **letra circulada** a 8 mm — o mesmo glifo usado nas alternativas, para o aluno
  reconhecer de imediato;
- entrelinha de 13,4 pt, a mesma das alternativas;
- **filete sólido** de fechamento ao fim da lista.

**Não entra nada além disso.** Sem resolução, sem comentário de alternativa, sem
competência, habilidade, objeto de conhecimento, conteúdo ou nível de dificuldade —
tudo isso é exclusivo da versão do professor.

### 7.3 Caderno de respostas — só na versão do professor

Abre em **página nova**, com o **título de área** `GABARITO E RESOLUÇÕES` (11 pt bold
caixa alta, recuado 2 mm), e segue no mesmo fluxo de duas colunas. Nenhum componente
novo é criado: o que muda é o conteúdo, não a forma.

Para **cada questão**, nesta ordem:

1. **`QUESTÃO N`** — o mesmo rótulo com barra-ornamento das questões
2. **Gabarito** — letra circulada na margem e `GABARITO: X` em negrito ao lado, com o
   texto da alternativa correta pendurado a 4,5 mm
3. **`FICHA PEDAGÓGICA`** — subtítulo em bold 10 pt caixa alta, seguido de uma linha
   por item, com o rótulo em negrito: **Competência**, **Habilidade**,
   **Objeto de conhecimento**, **Conteúdo abordado**, **Nível de dificuldade**
4. **`RESOLUÇÃO COMENTADA`** — subtítulo e o texto em corpo 10/12,0 pt justificado
5. **`COMENTÁRIOS DAS ALTERNATIVAS`** — subtítulo e, para cada letra A–E, a letra
   circulada com `CORRETA` / `INCORRETA` e o comentário, no mesmo recuo pendurado das
   alternativas
6. **Filete de fechamento** quando o bloco encerra a coluna

O rodapé corrido identifica a versão: `… | VERSÃO DO ALUNO` ou `… | VERSÃO DO PROFESSOR`.

### 7.4 Subtítulo interno

Componente novo do sistema, com o mesmo papel que `TEXTO I` cumpre dentro de uma
questão: **Calibri Bold 10 pt, caixa alta**, alinhado à margem da coluna, com 1,5 mm
de respiro acima. É o que abre `FICHA PEDAGÓGICA`, `RESOLUÇÃO COMENTADA` e
`COMENTÁRIOS DAS ALTERNATIVAS`.

---

## 7.1 Divergências autorizadas em relação ao caderno oficial

Tudo o mais deste documento reproduz o ENEM 2025 à risca. Estas três regras são
decisão do professor e **prevalecem** sobre a medição do original:

| Regra | No caderno oficial de 2025 | Neste sistema |
|---|---|---|
| Referência do texto introdutório | redonda, à direita | ***itálico***, à direita |
| Referência de imagem, tabela e gráfico | redonda, à direita | redonda, **justificada** |
| Marca do cabeçalho | logotipo `enem2025` do INEP | marca neutra `simulado <ano>` — o material não pode se passar por prova oficial |

Medição de apoio: no caderno oficial não há **nenhum** caractere em itálico nos
3.484 caracteres de referência, e todos os blocos de referência são alinhados à
direita. As duas primeiras linhas da tabela são, portanto, divergências
deliberadas — não erros de leitura do original.

---

## 8. Conferência antes de entregar

- [ ] Página 200 × 275 mm, não A4
- [ ] Margens **espelhadas** (ímpar 8,00 / par 10,50 na esquerda)
- [ ] Duas colunas de 89,47 mm com calha de 3,40 mm e **fio vertical sólido** em x = 98,75 mm
- [ ] Coluna única de 182,33 mm quando a figura passar de 95 mm
- [ ] Corpo **Calibri** 10 pt com entrelinha **12,0 pt** (razão 1,20)
- [ ] Texto justificado, primeira linha recuada em 6 mm, sem espaço entre parágrafos
- [ ] Tinta #231F20 no miolo; rodapé corrido em #58595B
- [ ] `QUESTÃO N` em **caixa alta**, Calibri-Bold 11 pt
- [ ] Barra-ornamento começando em 24,47 mm da coluna, azul #B9E5FA (79,5 %) + escuro (20,5 %)
- [ ] Referência sempre em **corpo − 2 pt** (8 pt para corpo de 10 pt)
- [ ] Referência do **texto introdutório**: **itálico**, à direita, título em negrito-itálico
- [ ] Referência de **imagem, tabela e gráfico**: redonda, **justificada**, título em negrito
- [ ] Letras-opção circuladas, texto pendurado a 4,5 mm, entrelinha 13,4 pt
- [ ] Filete de fechamento **sólido** só no fim de coluna
- [ ] Tarja #B9E5FA de 11 × 30 mm na borda externa, no topo ou na base conforme a área
- [ ] Cabeçalho com logotipo, quadrados #939598, código de barras e filete misto
- [ ] **Figuras coloridas** quando o original for colorido
- [ ] Caderno de questões **idêntico** nas duas versões, sem gabarito ao lado da questão
- [ ] Na versão do **aluno**, a folha de gabarito ao fim traz **somente as letras**
- [ ] Na versão do **professor**, o caderno de respostas abre em página nova, com título de área
- [ ] Cada bloco de resposta traz gabarito, ficha pedagógica, resolução e comentários A–E
- [ ] Rodapé identificando VERSÃO DO ALUNO / VERSÃO DO PROFESSOR
- [ ] **A impressão entrega o mesmo documento do PDF** — nunca a tela do aplicativo
- [ ] **Fórmulas em Unicode** em todas as saídas — ver `notacao_quimica.md` (índices ₀–₉, cargas ⁰–⁹⁺⁻, setas → e ⇌, nada de LaTeX ou tag)

---

## 9. O que mudou de 2019 para 2025

| Item | Revisão anterior (2019) | **Medido em 2025** |
|---|---|---|
| Família tipográfica | Arial | **Calibri** (Regular / Bold / Light / Italic) |
| Entrelinha do corpo | 12,8 pt (1,28×) | **12,0 pt (1,20×)** |
| Margens | fixas, 10,5 mm dos dois lados | **espelhadas** — 8,00 / 10,50 mm |
| Topo da mancha | 25,6 mm | **26,88 mm** (filete de cabeçalho em 25,00 mm) |
| Base da mancha | 12,6 mm de margem | fluxo até **260,0 mm**; filete em 263,00 mm |
| Coluna | 2 × 88 mm, calha 3,3 mm | **2 × 89,47 mm, calha 3,40 mm** |
| Modo de página | sempre 2 colunas | **2 colunas ou 1 coluna de 182,33 mm** |
| Fio da calha | pontilhado | **sólido, 0,5 pt** |
| Separador de questão | filete pontilhado **abaixo** de cada questão | **barra-ornamento acima**, ao lado do rótulo; filete sólido só no fim de coluna |
| Rótulo | `Questão N`, 11 pt bold | **`QUESTÃO N` em caixa alta**, 11 pt bold |
| Título de área | 12 pt bold | **11 pt bold**, recuado 2 mm |
| Quadrados girados | ao lado de cada `Questão N` | **no cabeçalho**, junto ao logotipo, em #939598 |
| "Fio pontilhado" | traço pontilhado | **microtexto `ENEM2025` em Arial-Bold 1,5 pt** |
| Ilustrações | 100 % em tons de cinza | **49 % coloridas** |
| Cor no miolo | nenhuma (só a capa) | **tarja, barra da questão, tabelas e gráficos coloridos** |
| Cinza dos filetes | #63656A | **#939598** (ornamento) e **#58595B** (rodapé) |
| Referência bibliográfica | 8 pt abaixo do corpo | 8 pt (corpo − 2); do texto introdutório em **itálico à direita**, de recurso visual **justificada**; título em **negrito** |
| Rodapé | logotipo `enem2019` centralizado | **texto corrido + fólio**, sem logotipo |
| Marca da versão | só no fundo da capa | **tarja sangrada em toda página**, posição indica a área |

---

*Levantamento independente a partir do PDF oficial do ENEM 2025 (2º dia, Caderno 7,
Azul — INEP/MEC). Documento de referência sem vínculo com o INEP.*

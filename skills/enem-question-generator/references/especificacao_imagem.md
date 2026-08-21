# Especificação de imagem para questões ENEM

Como escrever o `promptImagem` de modo que a ilustração saia **sem erro de direção de seta, de posição de rótulo ou de valor numérico**.

---

## 1. O princípio que explica todos os erros

O gerador de imagens **não conhece a questão**. Ele não lê o texto-base, não vê o comando, não sabe qual é o gabarito e não infere intenção pedagógica. Ele desenha **exatamente e somente** o que estiver escrito no prompt.

Disso decorre a regra central:

> Toda ambiguidade deixada no prompt será resolvida pelo gerador — e ele resolve por conta própria, com frequência para o lado errado.

Os três erros mais comuns em questões de vestibular têm a mesma causa:

| Erro observado | O que estava escrito no prompt | Por que deu errado |
|---|---|---|
| Seta apontando ao contrário | `an arrow between the sun and the leaf` | O prompt não disse onde fica a ponta. O gerador escolheu. |
| Rótulo colado no elemento errado | `label the parts of the cell` | O prompt não disse qual texto vai em qual elemento, nem de que lado. |
| Número ilegível ou ausente na régua | `a ruler showing the heights` | O prompt não listou os valores nem onde cada um é impresso. |

Nos três casos o gerador não falhou: ele completou uma lacuna que o prompt deixou aberta.

---

## 2. O `promptImagem` não é uma descrição — é uma especificação

Escreva-o **em inglês**, em **8 seções nomeadas**, nesta ordem. Todas obrigatórias.

### 1. SCENE AND VIEWPOINT
O que é a figura, em uma frase, e o ponto de vista exato: *front view · side view · top-down view · cross-section · exploded view · three-quarter view*. Declare a orientação absoluta e o fundo.

> *A cross-section diagram of a plant leaf, side view, cut vertically. The leaf surface is horizontal, upper epidermis at the top, lower epidermis at the bottom. Plain white background, no scenery, no horizon line.*

### 2. ELEMENT INVENTORY
Lista numerada de **todos** os elementos, com **quantidade explícita**. O gerador tende a inventar elementos extras; contar reduz isso. Nada fora desta lista pode aparecer.

> *(1) exactly one leaf cross-section; (2) exactly three chloroplasts inside the mesophyll; (3) exactly one stoma on the lower epidermis; (4) exactly two arrows; (5) exactly four text labels.*

### 3. LAYOUT AND POSITION
Para **cada** elemento: posição absoluta na tela (*left / center / right* × *top / middle / bottom*) **e** relação com os vizinhos, sempre com o lado explícito.

> *The leaf cross-section occupies the center of the frame. The stoma is on the lower edge, slightly right of center. The three chloroplasts are in the upper-middle area of the mesophyll, spaced evenly from left to right.*

**Proibido:** `next to`, `near`, `beside` sem dizer de que lado.

### 4. ARROWS — a seção mais crítica

Para **cada** seta, uma linha própria, sempre nesta ordem:

**origem → destino → onde fica a ponta → direção na tela → o que representa**

> ✅ *One arrow starting at the right edge of the sun and ending at the top surface of the leaf, with the **arrowhead touching the leaf** and **pointing down-left**, representing incident sunlight.*
>
> ✅ *One arrow starting at the stoma opening and ending outside the leaf, below it, with the **arrowhead at the outer end**, **pointing straight down**, representing oxygen released.*

Formas **terminantemente proibidas**, porque não declaram a ponta:

> ❌ `an arrow between A and B`
> ❌ `arrows connecting the parts`
> ❌ `arrows showing the cycle`
> ❌ `bidirectional arrows` *(a menos que a reversibilidade seja mesmo o conteúdo avaliado — e então diga: "one double-headed arrow with arrowheads at both ends")*

**Reforço redundante:** se o **sentido** da seta é parte do que a questão avalia — fluxo de energia, sentido da corrente elétrica, sentido do movimento, direção de uma reação, cadeia alimentar, ciclo biogeoquímico — repita a direção uma segunda vez, com outras palavras, ao final da especificação:

> *Reminder: the sunlight arrow points from the sun toward the leaf, never from the leaf toward the sun.*

### 5. TEXT LABELS

Para **cada** rótulo: texto **exato entre aspas** · elemento dono · **lado** · linha de chamada.

> *The label "Cloroplasto" placed immediately to the right of the topmost green organelle, connected to it by a thin straight leader line.*

Regras obrigatórias:

- **(a) Todo texto visível deve estar em PORTUGUÊS**, mesmo com o restante do prompt em inglês — a imagem será lida por estudantes brasileiros. Inclua no prompt: *"all visible text must be rendered exactly as written above, in Portuguese, with correct spelling."*
- **(b)** O rótulo fica **fora** do contorno do elemento, nunca sobreposto, salvo exigência da questão.
- **(c)** Não pode haver rótulo sem elemento, nem elemento essencial sem rótulo.
- **(d)** Se dois rótulos correm risco de se aproximar, declare os **lados opostos** em que ficam.
- **(e)** Declare o tamanho relativo: *"labels in a clear sans-serif typeface, large enough to be read when the image is printed at half page width."*

### 6. NUMBERS, SCALES AND MEASUREMENT MARKS

Se a questão depende de dado referencial (régua, escala, marcações de altura/distância/tempo/velocidade/temperatura, valores em eixo, unidades), liste os **valores exatos**, onde cada um aparece e **de que lado do traço** é impresso.

> *A vertical graduated ruler along the left side of the frame, with clearly legible labeled tick marks at 5 m, 10 m, 15 m and 20 m, each number printed to the left of its own tick.*

Os valores desenhados devem ser **exatamente** os mesmos usados no texto-base, no comando, nas alternativas e na resolução comentada — nunca aproximados nem arredondados de outra forma.

### 7. STYLE AND LEGIBILITY

Linhas nítidas, contornos definidos, alto contraste entre vizinhos, **cores distintas e nomeadas** para elementos que a questão pede para comparar, espaço em branco ao redor de cada rótulo.

> *Quando a figura tiver rótulos, setas ou marcações de medida, a legibilidade técnica tem prioridade sobre o realismo decorativo.*

### 8. NEGATIVE CONSTRAINTS

Encerre com o que **não** pode aparecer:

> *No decorative text, no watermark, no signature, no caption bar, no extra arrows, no additional objects beyond those listed above, no duplicated labels, no cropped or cut-off elements, no text in any language other than Portuguese.*

---

## 3. Verificação obrigatória antes de entregar

Releia a `descricao`, o texto-base, o comando, as alternativas e a resolução comentada, e confirme item por item:

- [ ] Todo elemento citado como visível consta do **ELEMENT INVENTORY**.
- [ ] Toda seta mencionada tem **origem, destino, ponta e direção** declaradas.
- [ ] Todo rótulo tem **texto exato, elemento dono e lado** declarados; todo texto visível está em português.
- [ ] Todo número citado em qualquer parte da questão aparece com o **mesmo valor** na seção NUMBERS.
- [ ] Nada foi afirmado na `descricao` que não esteja especificado na imagem — e nenhum dado essencial da imagem ficou fora da `descricao`.

---

## 4. Exemplo completo

**Questão:** Física, média, sobre energia potencial gravitacional. O comando pergunta em qual altura a esfera tem o dobro da energia potencial que tem a 5 m.

```
SCENE AND VIEWPOINT
A simple physics diagram, front view, showing a vertical drop setup. Plain white
background, no scenery.

ELEMENT INVENTORY
(1) exactly one vertical graduated ruler; (2) exactly one small solid sphere;
(3) exactly one horizontal ground line; (4) exactly one arrow; (5) exactly five
text labels.

LAYOUT AND POSITION
The vertical ruler stands along the left third of the frame, running from the
ground line at the bottom to the top edge. The ground line is horizontal, at the
bottom of the frame, spanning the full width. The sphere is to the right of the
ruler, at the same height as the 20 m tick mark.

ARROWS
One arrow starting at the center of the sphere and ending at the ground line
directly below it, with the arrowhead touching the ground line and pointing
straight down, representing the direction of the fall.

TEXT LABELS
The label "Esfera" placed immediately to the right of the sphere.
The labels "5 m", "10 m", "15 m" and "20 m" placed to the LEFT of their
respective tick marks on the ruler.
All visible text must be rendered exactly as written above, in Portuguese, with
correct spelling. Labels in a clear sans-serif typeface, large enough to be read
when the image is printed at half page width.

NUMBERS, SCALES AND MEASUREMENT MARKS
The ruler has exactly four clearly legible labeled tick marks, at 5 m, 10 m,
15 m and 20 m, evenly spaced from bottom to top, each number printed to the left
of its own tick.

STYLE AND LEGIBILITY
Sharp clean lines, high contrast, dark linework on white. Technical legibility
takes priority over decorative realism.

NEGATIVE CONSTRAINTS
No decorative text, no watermark, no signature, no extra arrows, no additional
objects beyond those listed above, no duplicated labels, no cropped elements,
no text in any language other than Portuguese.

Reminder: the fall arrow points downward, from the sphere toward the ground,
never upward.
```

Compare com o que **não** funciona:

> ❌ *A ball falling from a height with a ruler showing the heights and an arrow indicating the movement.*

Essa frase deixa em aberto: quantos traços tem a régua, quais valores, de que lado ficam impressos, onde está a bola, para onde aponta a seta e em que idioma sai o texto. Seis lacunas, seis chances de erro.

# Notação química — regra obrigatória de formatação

Toda fórmula química entregue por esta skill sai **pronta**: visualmente correta e
diretamente legível pelo estudante, em **caracteres Unicode**. Nunca um comando a
ser interpretado depois.

> A fórmula deve aparecer como **H₂SO₄** — não como um código que só vira H₂SO₄
> se alguém rodar um renderizador. O estudante lê no papel, no celular e no Word;
> nenhum deles executa LaTeX.

A regra vale para **tudo o que sai impresso**: texto-base, comando, dados, tabelas,
alternativas, gabarito, ficha pedagógica, resolução comentada, comentário de cada
alternativa, prompt de imagem e saída em JSON.

---

## 1. Regra absoluta

Use exclusivamente caracteres Unicode para índices inferiores, cargas superiores,
números superiores, sinais de carga, setas químicas e símbolos científicos.

Padrão correto: H₂O · CO₂ · H₂SO₄ · HNO₃ · CaCO₃ · Ca(OH)₂ · Al₂(SO₄)₃ ·
C₆H₁₂O₆ · SO₄²⁻ · CO₃²⁻ · PO₄³⁻ · NH₄⁺ · Ca²⁺ · Al³⁺ · Fe³⁺ · MnO₄⁻ ·
Cr₂O₇²⁻ · [Fe(CN)₆]⁴⁻

## 2. Formatos terminantemente proibidos

LaTeX · KaTeX · MathJax · comandos de fórmula · tags HTML · tags de índice ou
expoente · barras invertidas · chaves de formatação · cifrões · delimitadores
matemáticos · Markdown matemático · blocos de código · fórmula apresentada como
comando · qualquer caractere de programação visível.

## 3. Índices químicos

Os números que indicam quantidade de átomos são **índices inferiores**:
H₂O · O₂ · O₃ · CO₂ · NH₃ · CH₄ · H₂SO₄ · H₃PO₄ · Ca(OH)₂ · Al₂O₃ ·
Fe₂(SO₄)₃ · C₁₂H₂₂O₁₁

Algarismos inferiores: `₀ ₁ ₂ ₃ ₄ ₅ ₆ ₇ ₈ ₉`

Nunca: H2O · H 2 O · H²O · CO 2 · Al2(SO4)3 · números separados da fórmula.

Os símbolos dos elementos ficam **no nível da linha**. Só os números de quantidade
de átomos descem.

## 4. Cargas dos íons

A carga vai no canto **superior direito** da espécie, com **o número antes do sinal**.

Algarismos superiores: `⁰ ¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹ ⁺ ⁻`

Corretos: Na⁺ · K⁺ · H⁺ · Ag⁺ · Ca²⁺ · Mg²⁺ · Fe²⁺ · Fe³⁺ · Al³⁺ · Cl⁻ · OH⁻ ·
CN⁻ · NH₄⁺ · NO₃⁻ · SO₄²⁻ · CO₃²⁻ · PO₄³⁻ · MnO₄⁻ · Cr₂O₇²⁻ · [Fe(CN)₆]⁴⁻

Ordem da carga: `²⁺ ³⁺ ²⁻ ³⁻ ⁴⁻`

Nunca: Ca+2 · Ca2+ · SO4-2 · SO₄-2 · SO²⁻₄ · sinal separado da espécie.

Antes de entregar um íon, verifique se a carga pertence ao átomo, ao grupo entre
parênteses ou à espécie inteira.

## 5. Coeficientes estequiométricos

Coeficiente é **número comum, antes da fórmula**: `2 H₂(g) + O₂(g) → 2 H₂O(l)`

Coeficiente nunca vira índice. Para balancear, **não se altera a fórmula da
substância**: correto `2 H₂O`, incorreto `H₄O₂`. O coeficiente conta moléculas,
fórmulas unitárias ou mols; o índice conta átomos dentro da substância.

## 6. Equações químicas

| Situação | Exemplo |
|---|---|
| Reação direta | `2 H₂(g) + O₂(g) → 2 H₂O(l)` |
| Equilíbrio | `N₂(g) + 3 H₂(g) ⇌ 2 NH₃(g)` |
| Reação iônica | `Ag⁺(aq) + Cl⁻(aq) → AgCl(s)` |
| Neutralização | `HCl(aq) + NaOH(aq) → NaCl(aq) + H₂O(l)` |
| Combustão | `CH₄(g) + 2 O₂(g) → CO₂(g) + 2 H₂O(g)` |
| Dissociação iônica | `CaCl₂(aq) → Ca²⁺(aq) + 2 Cl⁻(aq)` |
| Hidrato | `CuSO₄·5H₂O` |

### A seta é um caractere, não um desenho

`→` é **um único caractere**, U+2192. É proibido montar uma seta com hífen, sinal
de maior, sinal de menor ou sinal de igualdade. Estas sequências, quando estiverem
funcionando como seta numa expressão química, são erro e precisam ser corrigidas:

`->` · `-->` · `=>` · `==>` · `<-` · `<->` · `<=>` · `<==>`

Não acrescente hífen antes da seta. Não substitua o símbolo por imagem, emoji ou
ícone: qualquer um deles muda a aparência e pode mudar o significado.

### Cada seta tem um significado

| Símbolo | Significado |
|---|---|
| `→` | reação no sentido indicado, da esquerda para a direita |
| `←` | reação no sentido indicado, da direita para a esquerda |
| `⇌` | equilíbrio químico |
| `↔` | relação entre estruturas de ressonância |
| `↑` | desprendimento de gás |
| `↓` | formação de precipitado |

**Não troque todas as setas pelo mesmo símbolo.** `↔` não substitui `⇌`: uma diz
ressonância, a outra diz equilíbrio. Nas reações escritas da esquerda para a
direita, os reagentes ficam antes de `→` e os produtos depois.

`+` separa reagentes ou produtos · `·` hidratos e associações.
**Nunca sinal de igualdade no lugar da seta.**

## 7. Balanceamento obrigatório

Toda equação apresentada como completa está balanceada — exceto quando a própria
atividade pedir que o estudante balanceie. Antes de entregar: conte os átomos nos
reagentes, conte nos produtos, confira a conservação da massa, confira a
conservação da carga, use os menores coeficientes inteiros.

`4 Fe(s) + 3 O₂(g) → 2 Fe₂O₃(s)`

Em equação iônica, a soma das cargas dos reagentes é igual à dos produtos. Nunca
declare uma equação balanceada sem conferir cada elemento e a carga total.
Conferir o balanceamento não substitui verificar se a reação é **cientificamente
adequada** às condições apresentadas.

**Exceções pedagógicas — não "conserte" o que é proposital:**

- não balanceie a equação quando o objetivo da questão for pedir o balanceamento;
- não transforme em correta uma alternativa intencionalmente incorreta;
- não elimine erros apresentados de propósito para análise do estudante.

Distinga **erro acidental de formatação** de **erro conceitual intencional de um
distrator**. Se não for possível distinguir, encaminhe para revisão.

## 8. Estados físicos

`(s)` sólido · `(l)` líquido · `(g)` gasoso · `(aq)` dissolvido em água.

`AgNO₃(aq) + NaCl(aq) → AgCl(s) + NaNO₃(aq)`

Os índices continuam inferiores mesmo acompanhados do estado físico. Não invente
estado físico quando as condições não permitirem determiná-lo com segurança.

Havendo temperatura, pressão, luz ou catalisador, descreva a condição numa frase
junto à equação quando não for possível posicioná-la sobre a seta. **Não fragmente
a seta** para inserir condições, e não apresente catalisador como reagente
consumido na equação global.

## 9. Fórmulas orgânicas

metano CH₄ · etano CH₃–CH₃ · eteno CH₂=CH₂ · etino HC≡CH · etanol CH₃–CH₂–OH ·
ácido acético CH₃–COOH · propanona CH₃–CO–CH₃ · glicose C₆H₁₂O₆ · benzeno C₆H₆

`–` ligação simples · `=` dupla · `≡` tripla.

**Ligação não é seta.** Não converta o traço de uma ligação química em seta de
reação. Não altere número de hidrogênios, posição de grupo funcional ou tipo de
ligação. Não substitua uma estrutura necessária por uma fórmula molecular que
elimine informação exigida para resolver a questão.
Quando a estrutura for complexa demais para representação linear segura, sinalize
a necessidade de **fórmula estrutural em imagem** — não invente a estrutura.

## 10. Isótopos e partículas

carbono-14 ¹⁴₆C · sódio-23 ²³₁₁Na · urânio-238 ²³⁸₉₂U · elétron e⁻ · próton p⁺ ·
nêutron n⁰ · partícula alfa ⁴₂He · partícula beta β⁻

Número de massa **acima**, antes do símbolo; número atômico **abaixo**, antes do
símbolo. Não inverta os dois. Quando a notação nuclear exigir alinhamento vertical
preciso, não presuma que caracteres Unicode isolados o garantam — use uma
representação visual validada, sem expor comando ao estudante.

## 11. Grandezas e unidades

Números de valor, unidade, temperatura, concentração ou quantidade **não** viram
índice nem expoente:

`25 °C` · `2 mol` · `0,5 mol/L` · `1,0 atm` · `250 mL` · `pH 7` ·
`6,02 × 10²³ partículas` · `1,5 × 10⁻³ mol/L`

Distinga índice químico, coeficiente, carga, expoente matemático, valor numérico e
unidade de medida. No expoente matemático o sinal vem **antes** do número (10⁻³);
na carga, **depois** (Ca²⁺).

## 12. Consistência dentro da questão

Uma substância mantém a **mesma grafia** em todas as partes: texto-base, comando,
dados, tabelas, alternativas, gabarito, justificativa e resolução comentada.

Se o texto traz H₂SO₄, essa é a grafia em toda a questão. Não são aceitas variações
como H2SO4, H₂SO4, H ₂ SO ₄ ou caracteres separados.

**Maiúsculas e minúsculas são significado**, não estilo: `Co` (cobalto) e `CO`
(monóxido de carbono) são coisas diferentes. E **não converta números em massa**:
identifique antes a função de cada número — índice, coeficiente, carga, expoente,
valor ou unidade.

## 13. Correção de questões já produzidas

Ao receber uma questão com fórmulas incorretas: identifique as substâncias,
reconstrua cada fórmula a partir do nome químico, converta índices em inferiores,
converta cargas em superiores com número antes do sinal, corrija parênteses,
estados físicos e setas, balanceie o que for necessário, compare as alternativas
com o gabarito e substitua integralmente as versões defeituosas.

Ao revisar, identifique também **setas montadas com caracteres separados** e troque
cada uma pelo símbolo Unicode do significado correspondente — `→`, `←`, `⇌`, `↔`,
`↑` ou `↓`, conforme o processo. Confira a coerência entre enunciado, alternativas,
gabarito e resolução, e **preserve as incorreções intencionais dos distratores**.

Não faça apenas correção visual: verifique também se a fórmula está
**cientificamente** correta. Não corrija fórmula ambígua por adivinhação, e não
altere registros existentes em massa sem delimitar os itens afetados e preservar
uma versão recuperável.

## 14. Saída em JSON

As fórmulas permanecem como caracteres Unicode normais:

```json
{
  "substancia": "ácido sulfúrico",
  "formula": "H₂SO₄",
  "ion": "SO₄²⁻",
  "equacao": "2 H₂(g) + O₂(g) → 2 H₂O(l)"
}
```

Nada de códigos, comandos ou sequências de escape. Aplicação, banco de dados, API
e arquivo em **UTF-8**.

## 15. Preservação no aplicativo e nas exportações

A notação correta tem de sobreviver ao percurso inteiro: geração, armazenamento,
recuperação, exibição, cópia e exportação. **UTF-8 sozinho não garante a
apresentação** — a fonte, o layout e o processo de exportação também contam.

- UTF-8 na comunicação e nos arquivos de texto;
- fonte com suporte a índices, expoentes e setas — conferir a fonte usada na
  exportação para PDF;
- nenhuma conversão que transforme `→` em seta feita de caracteres separados;
- nenhuma rotina que remova "caracteres especiais";
- nenhuma transformação que converta índice ou expoente em número comum;
- **fórmula é unidade visual**: não pode ser partida entre duas linhas;
- equação longa acomodada sem cortar seta nem carga.

Se o transporte for JSON, o texto decodificado precisa preservar exatamente as
fórmulas e os símbolos, sem comando visível ao estudante.

## 16. Casos de teste obrigatórios

Use estas dez expressões como teste:

```
H₂SO₄
Al₂(SO₄)₃
SO₄²⁻
NH₄⁺
[Fe(CN)₆]⁴⁻
CuSO₄·5H₂O
2 H₂(g) + O₂(g) → 2 H₂O(l)
N₂(g) + 3 H₂(g) ⇌ 2 NH₃(g)
Ag⁺(aq) + Cl⁻(aq) → AgCl(s)
Zn(s) → Zn²⁺(aq) + 2 e⁻
```

Confirme que os índices continuam inferiores; as cargas, superiores; os
coeficientes, na linha normal; que `→` continua sendo **um único caractere**; que
`⇌` mantém o sentido de equilíbrio; que nenhum símbolo desaparece; que nenhuma
fórmula é cortada; que nenhuma sequência de código aparece; que o conteúdo
permanece correto depois de salvar e reabrir; e que a exportação preserva a mesma
notação.

**Teste é teste.** Com acesso ao aplicativo, execute na tela e nas exportações
reais. Conferência mental não é teste visual realizado. Sem acesso à interface ou à
exportação, declare a limitação no relatório — não afirme que a apresentação foi
verificada.

## 17. Teste visual antes de entregar

- [ ] Os índices estão abaixo da linha?
- [ ] As cargas estão acima da linha?
- [ ] A carga aparece depois da fórmula completa?
- [ ] Os coeficientes aparecem antes das fórmulas?
- [ ] Os parênteses estão na posição correta?
- [ ] As setas estão completas?
- [ ] Os estados físicos estão legíveis?
- [ ] Há algum número ou símbolo desconectado?
- [ ] Há algum código aparecendo para o estudante?
- [ ] A fórmula permanece legível no celular?
- [ ] A fórmula é igual no texto, nas alternativas e no gabarito?

## 18. Lista final de auditoria

Fórmulas cientificamente corretas · índices inferiores bem posicionados · cargas
superiores bem posicionadas · coeficientes bem posicionados · parênteses corretos ·
equações balanceadas · massa conservada · carga elétrica conservada · setas
corretas · estados físicos corretos · unidades corretas · grafia padronizada em
toda a questão · ausência completa de LaTeX e códigos de renderização · ausência de
caracteres separados · compatibilidade com UTF-8 · alternativas e gabarito
conferidos.

## 19. Regra de bloqueio

Se uma fórmula não puder ser confirmada com segurança, **não invente e não entregue
a questão como concluída**. Apresente o aviso:

> **REVISÃO QUÍMICA NECESSÁRIA:** a fórmula ou equação não pôde ser validada com
> segurança.

Precisão química, apresentação visual e legibilidade são requisitos obrigatórios.

## 20. Critério final de aprovação

Uma questão só está pronta quando a notação estiver correta **e** a revisão
científica tiver sido concluída. A aprovação exige fórmulas corretas e legíveis;
índices e cargas nas posições adequadas; setas químicas reais, completas e com o
significado certo; ausência de comando de formatação visível; preservação da
proposta pedagógica; e coerência entre enunciado, alternativas e gabarito.

Havendo dúvida científica, encaminhe para revisão antes de publicar. Havendo falha
de exibição, **não substitua a fórmula ou a seta por uma aproximação improvisada —
corrija a causa da falha.**

Resultado visual obrigatório:

> 2 H₂(g) + O₂(g) → 2 H₂O(l)

---

## Como isto é verificado no aplicativo

O gerador de simulados aplica esta regra em código, não por confiança:

- **A fonte do PDF passou a ser a Carlito embarcada** (métrica da Calibri, licença
  livre), com índices, expoentes, setas, `⇌`, `≡` e alfabeto grego no subconjunto.
  Até a v28 o PDF trocava `²` por `^2` e `₂` por `_2` — era a única saída com a
  Helvetica WinAnsi, e mutilava a fórmula. Não há mais substituição de fonte.
- **`auditaQuimica()`** varre texto-base, fonte, comando, tabela, as cinco
  alternativas, o gabarito, a resolução e o comentário de cada alternativa
  procurando: LaTeX, tags, blocos de código, fórmula com índice em algarismo comum
  (H2O), carga fora do padrão (Ca2+, Ca+2, ⁺²), índice solto, **seta montada com
  caracteres separados** (`->`, `-->`, `=>`, `==>`, `<-`, `<->`, `<=>`), **`↔` usado
  como equilíbrio** no lugar de `⇌`, grafias divergentes da mesma substância e
  caractere sem glifo na fonte.
- **O mapa de emergência não monta seta falsa.** Até a v29 ele trocava `→` por
  `->` e `⇌` por `<=>` quando a fonte falhava. Isso era exatamente o que o §6
  proíbe, e foi removido: sem a fonte, a exportação é barrada — não se entrega uma
  seta improvisada.
- **A fórmula não quebra entre linhas** (§15). O traço de ligação e o ponto de
  hidrato continuam sendo `–` e `·`, e ganham depois de si um **juntador de palavra**
  (U+2060), invisível, que impede a quebra; a seta é colada ao que vem depois por um
  espaço inseparável, de modo que a equação longa quebra **antes** da seta e nunca
  deixa uma seta órfã no fim da linha.
- **Nenhuma exportação sai com fórmula quebrada**: PDF, Word, HTML e impressão
  passam pela mesma porta e param com o aviso do §19.

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

`→` reação direta · `⇌` equilíbrio · `+` separa reagentes ou produtos ·
`·` hidratos e associações. **Nunca sinal de igualdade no lugar da seta.**

## 7. Balanceamento obrigatório

Toda equação apresentada como completa está balanceada — exceto quando a própria
atividade pedir que o estudante balanceie. Antes de entregar: conte os átomos nos
reagentes, conte nos produtos, confira a conservação da massa, confira a
conservação da carga, use os menores coeficientes inteiros.

`4 Fe(s) + 3 O₂(g) → 2 Fe₂O₃(s)`

Em equação iônica, a soma das cargas dos reagentes é igual à dos produtos. Nunca
declare uma equação balanceada sem conferir cada elemento e a carga total.

## 8. Estados físicos

`(s)` sólido · `(l)` líquido · `(g)` gasoso · `(aq)` dissolvido em água.

`AgNO₃(aq) + NaCl(aq) → AgCl(s) + NaNO₃(aq)`

Os índices continuam inferiores mesmo acompanhados do estado físico.

## 9. Fórmulas orgânicas

metano CH₄ · etano CH₃–CH₃ · eteno CH₂=CH₂ · etino HC≡CH · etanol CH₃–CH₂–OH ·
ácido acético CH₃–COOH · propanona CH₃–CO–CH₃ · glicose C₆H₁₂O₆ · benzeno C₆H₆

`–` ligação simples · `=` dupla · `≡` tripla.

Não altere número de hidrogênios, posição de grupo funcional ou tipo de ligação.
Quando a estrutura for complexa demais para representação linear segura, sinalize
a necessidade de **fórmula estrutural em imagem** — não invente a estrutura.

## 10. Isótopos e partículas

carbono-14 ¹⁴₆C · sódio-23 ²³₁₁Na · urânio-238 ²³⁸₉₂U · elétron e⁻ · próton p⁺ ·
nêutron n⁰ · partícula alfa ⁴₂He · partícula beta β⁻

Número de massa **acima**, antes do símbolo; número atômico **abaixo**, antes do
símbolo. Não inverta os dois.

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

## 13. Correção de questões já produzidas

Ao receber uma questão com fórmulas incorretas: identifique as substâncias,
reconstrua cada fórmula a partir do nome químico, converta índices em inferiores,
converta cargas em superiores com número antes do sinal, corrija parênteses,
estados físicos e setas, balanceie o que for necessário, compare as alternativas
com o gabarito e substitua integralmente as versões defeituosas.

Não faça apenas correção visual: verifique também se a fórmula está
**cientificamente** correta.

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

## 15. Teste visual antes de entregar

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

## 16. Lista final de auditoria

Fórmulas cientificamente corretas · índices inferiores bem posicionados · cargas
superiores bem posicionadas · coeficientes bem posicionados · parênteses corretos ·
equações balanceadas · massa conservada · carga elétrica conservada · setas
corretas · estados físicos corretos · unidades corretas · grafia padronizada em
toda a questão · ausência completa de LaTeX e códigos de renderização · ausência de
caracteres separados · compatibilidade com UTF-8 · alternativas e gabarito
conferidos.

## 17. Regra de bloqueio

Se uma fórmula não puder ser confirmada com segurança, **não invente e não entregue
a questão como concluída**. Apresente o aviso:

> **REVISÃO QUÍMICA NECESSÁRIA:** a fórmula ou equação não pôde ser validada com
> segurança.

Precisão química, apresentação visual e legibilidade são requisitos obrigatórios.

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
  (H2O), carga fora do padrão (Ca2+, Ca+2, ⁺²), índice solto, grafias divergentes
  da mesma substância e caractere sem glifo na fonte.
- **Nenhuma exportação sai com fórmula quebrada**: PDF, Word, HTML e impressão
  passam pela mesma porta e param com o aviso do §17.

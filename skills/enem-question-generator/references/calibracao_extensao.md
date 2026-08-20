# Calibração de extensão por disciplina

Esta tabela define a extensão-alvo (em número de caracteres, contando espaços) de cada
parte de uma questão ENEM real, por disciplina. Os valores foram calculados a partir de
2.035 questões reais do ENEM 2015–2025 (exceto 2021, cujo PDF fonte tem problema de
extração de texto), classificadas por matéria. É a mesma calibração usada para treinar a
Edge Function `generate-question` do aplicativo (fonte única de verdade: mantenha esta
tabela sincronizada com a constante `CALIBRACAO_EXTENSAO` em
`supabase/functions/generate-question/index.ts`).

Para cada disciplina: `n` é o tamanho da amostra real usada no cálculo; `texto`, `comando`
e `alternativa` trazem `[p25, p75, média]` em caracteres — ou seja, a faixa onde caem 50%
das questões reais (do percentil 25 ao 75) e a média da amostra.

| Disciplina | n | Texto-suporte (p25–p75, méd) | Comando (p25–p75, méd) | Cada alternativa (p25–p75, méd) |
|---|---:|---|---|---|
| Língua Portuguesa | 213 | 608–1201, méd 902 | 82–180, méd 138 | 44–70, méd 58 |
| Literatura | 105 | 608–1122, méd 868 | 82–164, méd 118 | 45–67, méd 57 |
| Artes | 50 | 384–798, méd 610 | 107–189, méd 143 | 48–70, méd 61 |
| Educação Física | 32 | 799–1134, méd 962 | 83–128, méd 106 | 35–73, méd 59 |
| Língua Estrangeira (Inglês/Espanhol) | 100 | 409–1073, méd 761 | 77–179, méd 129 | 37–60, méd 50 |
| História | 132 | 469–757, méd 620 | 84–130, méd 104 | 33–53, méd 45 |
| Geografia | 152 | 398–737, méd 554 | 76–126, méd 101 | 29–43, méd 37 |
| Filosofia | 80 | 477–671, méd 596 | 78–118, méd 95 | 31–51, méd 41 |
| Sociologia | 86 | 497–780, méd 625 | 76–123, méd 107 | 28–49, méd 40 |
| Biologia | 163 | 374–634, méd 527 | 41–102, méd 93 | 13–49, méd 34 |
| Física | 154 | 476–805, méd 648 | 47–122, méd 109 | 5–40, méd 25 |
| Química | 133 | 483–780, méd 641 | 56–110, méd 104 | 7–41, méd 26 |
| Matemática | 450 | 420–725, méd 586 | 47–134, méd 142 | 3–10, méd 9 |

**Tecnologias da Informação e Comunicação** (gêneros digitais dentro de Linguagens) não teve
amostra própria suficiente na classificação — use a faixa de **Língua Portuguesa** como
referência de extensão para esses itens.

## Como usar esta tabela

1. **Ao escrever o texto-suporte, o comando e cada alternativa** (etapa 6 do fluxo principal
   do `SKILL.md`), mire na média da disciplina e mantenha-se, sempre que possível, dentro da
   faixa p25–p75. São metas de estilo, não regras rígidas — o conteúdo pedagógico e a clareza
   da questão vêm sempre primeiro; nunca corte ou infle um texto-suporte de forma artificial
   só para bater um número de caracteres.
2. **Note os contrastes reais entre disciplinas** — eles fazem parte do estilo autêntico
   ENEM e devem ser respeitados: em Matemática as alternativas são numéricas e curtas (poucos
   caracteres), enquanto em Português/Literatura/Artes as alternativas são frases completas e
   bem mais longas; em Física/Química/Biologia as alternativas tendem a ser mais curtas que em
   Humanas; o texto-suporte de Artes e de Ciências da Natureza costuma ser mais enxuto que o de
   Língua Portuguesa ou Educação Física.
3. **Na revisão final** (etapa 7 do fluxo principal), confira a extensão de cada parte da
   questão gerada contra a faixa da disciplina correspondente nesta tabela, junto com os
   demais critérios de qualidade (alternativas de tamanho parecido entre si, distratores
   plausíveis, etc.).

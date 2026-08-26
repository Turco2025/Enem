# Distribuição do gabarito — regra obrigatória

Os gabaritos **jamais podem ser sequencialmente os mesmos**. A regra vale para toda
entrega desta skill, do par de questões ao simulado inteiro.

---

## 1. A regra

> **Dentro de cada bloco de cinco questões consecutivas, as cinco letras A, B, C, D e E
> aparecem uma única vez.**

Consequência direta, que é o caso do dia a dia:

| Quantidade pedida | Gabaritos |
|---|---|
| 2 questões | as duas letras **diferentes** |
| 3 questões | as três **diferentes** |
| 4 questões | as quatro **diferentes** |
| 5 questões | as cinco **diferentes** — uma permutação de A–E |
| 6 ou mais | cada bloco de cinco é uma permutação de A–E |

Duas garantias adicionais nas viradas de bloco:

- a primeira letra de um bloco **nunca** repete a última do bloco anterior — não existe
  gabarito repetido em questões vizinhas em nenhum ponto da prova;
- cada bloco usa uma **permutação diferente** do bloco anterior.

## 2. Por que não é "toda janela de cinco"

Parece natural exigir que **qualquer** cinco questões consecutivas tenham as cinco
letras distintas. Isso, porém, força matematicamente a sequência a ser periódica: se as
posições `i..i+4` são uma permutação e `i+1..i+5` também, então `s[i+5] = s[i]` — a mesma
permutação repetida do começo ao fim da prova.

O resultado seria um padrão **ainda mais fácil de decorar** do que o problema que se
queria evitar. Por isso a regra vale por **bloco** de cinco, com as duas garantias de
virada acima: nunca há duas iguais seguidas, as cinco letras saem igualmente
distribuídas e não sobra período explorável.

## 3. Como cumprir sem quebrar o Guia do Inep

A posição do gabarito é decidida **antes** de escrever a questão. Com a letra-alvo em
mãos:

1. Escreva a resposta correta e os quatro distratores, cada um com o seu erro de
   raciocínio específico.
2. **Distribua-os** de modo que a correta caia na letra-alvo **respeitando a ordem lógica
   obrigatória**: numéricas em ordem crescente, as demais da mais curta para a mais longa.
3. Se a ordem lógica empurrar a correta para outra posição, **reescreva os valores ou a
   redação dos distratores** — nunca a correta — até que ordem lógica e letra-alvo
   coincidam.
4. **Nunca** resolva trocando as alternativas de lugar no fim. Uma lista de números fora
   de ordem crescente denuncia a manipulação e viola o Guia.
5. A correta na letra-alvo continua não podendo ser mais longa, mais completa nem mais
   bem redigida que os distratores (critério 4.4 da Ficha do Inep).
6. Se ainda assim for impossível pôr a correta na letra-alvo sem violar a ordem lógica ou
   a paridade técnica, **escolha outro recorte de conteúdo** para a questão — não entregue
   o gabarito em posição diferente.

## 4. Por que isso importa

Um simulado em que os gabaritos se repetem em sequência, ou alternam entre duas letras,
permite que o candidato acerte **por padrão** e não por domínio da habilidade. Isso
destrói a validade do instrumento: a nota deixa de medir o que se propôs a medir.

## 5. Conferência antes de entregar

- [ ] Nenhuma questão tem o mesmo gabarito da anterior
- [ ] Em cada bloco de cinco, as cinco letras aparecem uma única vez
- [ ] Com 2 a 5 questões, todos os gabaritos são diferentes
- [ ] As alternativas numéricas continuam em ordem crescente
- [ ] Nenhuma alternativa foi trocada de lugar depois de escrita
- [ ] A correta não ficou mais longa nem mais completa que os distratores

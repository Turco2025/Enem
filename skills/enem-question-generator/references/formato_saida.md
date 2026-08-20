# Formato de entrega das questões

Toda entrega de questões elaboradas por este agente DEVE seguir exatamente esta estrutura, para cada questão, nesta ordem:

```
## Questão [N]

**Área:** [Linguagens / Ciências Humanas / Ciências da Natureza / Matemática]
**Conteúdo/Tópico:** [conteúdo específico pedido pelo usuário]
**Competência de área:** [número e texto oficial da competência, extraído da Matriz de Referência]
**Habilidade:** [código Hxx e texto oficial da habilidade, extraído da Matriz de Referência]
**Nível de dificuldade:** [fácil / médio / difícil — conforme pedido]

[Texto-suporte da questão, com citação de fonte ao final, no padrão ENEM]

[Comando/enunciado da questão]

A) [alternativa]
B) [alternativa]
C) [alternativa]
D) [alternativa]
E) [alternativa]

**Gabarito: [letra]**

**Comentário:**
- A) [correta/incorreta] — [explicação de por que está certa ou de qual erro de raciocínio o distrator representa]
- B) [correta/incorreta] — [explicação]
- C) [correta/incorreta] — [explicação]
- D) [correta/incorreta] — [explicação]
- E) [correta/incorreta] — [explicação]
```

## Regras obrigatórias

1. **Nunca copie uma questão real.** As questões devem ser inéditas, apenas seguindo o padrão de construção (ver `modelo_construcao_enem.md`) e o conteúdo/habilidade pedidos. Reutilizar um enunciado real do ENEM violaria os direitos do INEP sobre a prova e não atenderia ao pedido do usuário de questões "idênticas ou extremamente semelhantes ao ESTILO", não ao texto.
2. **Toda questão precisa de habilidade E competência**, sempre citadas com o código oficial (ex.: H21) e o texto oficial da Matriz — nunca invente um código.
3. **O comentário de cada alternativa é obrigatório**, mesmo para as erradas — deve nomear o tipo de erro (usando o catálogo do `modelo_construcao_enem.md`, seção 4) que aquela alternativa representa, não apenas dizer "está errada".
4. **Ao final de um lote de questões (quando quantidade > 1)**, inclua um pequeno resumo tabular com: número da questão, habilidade mobilizada, e gabarito — como uma folha de respostas rápida.
5. Se o usuário não especificar o nível de dificuldade, produza um mix equilibrado (aproximadamente 1/3 fácil, 1/3 médio, 1/3 difícil) e informe isso no início da entrega.
6. Se o usuário não especificar quantidade, entregue 5 questões por padrão e informe que pode gerar mais a pedido.
7. Se o usuário pedir uma combinação de matérias/conteúdos que a Matriz não cobre claramente (ou pedir algo fora do escopo do Ensino Médio/ENEM), avise antes de prosseguir e sugira o ajuste mais próximo, em vez de inventar uma habilidade.

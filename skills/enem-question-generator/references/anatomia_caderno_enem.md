# Anatomia do caderno ENEM — system design obrigatório

Especificação de impresso para **PDF, DOCX e impressão** da **versão do aluno**.
Medidas extraídas da geometria vetorial e das fontes incorporadas no PDF oficial do
ENEM 2019 — 2º dia, Caderno 7, versão Azul (INEP/MEC) — não de leitura visual.

> **Escopo.** Vale para a **versão do aluno**. A **versão do professor** — com gabarito,
> resolução comentada e comentários das alternativas — permanece como sempre foi e
> **não é afetada por nada deste documento**.

---

## 1. Formato e grade

| Elemento | Medida | Observação |
|---|---|---|
| Página | **200 × 275 mm** | Formato próprio do INEP, menor que A4 (210 × 297) |
| Margem superior | **25,6 mm** | Filete de cabeçalho, largura total da mancha |
| Margem lateral | **10,5 mm** | Mancha gráfica |
| Margem inferior | **12,6 mm** | Filete de rodapé até a borda |
| Colunas | **2 × ≈ 88 mm** | Simétricas. O valor exato que fecha a página é **87,85 mm** |
| Calha central | **3,3 mm** | Fio pontilhado exatamente centralizado |
| Recuo de parágrafo | **6 mm** | Só na primeira linha; **sem** linha em branco entre parágrafos |
| Regra sob cada questão | filete pontilhado | Fecha cada bloco, inclusive ao fim de coluna |

Capa e folha de rosto são de **coluna única**. O miolo é sempre de duas colunas.

---

## 2. Tipografia

Uma única família — **Arial** — carrega toda a prova. A hierarquia vem só de **peso e
tamanho**, nunca de troca de fonte.

| Papel | Corpo | Peso | Detalhe |
|---|---|---|---|
| Corpo de texto e alternativas | **10 pt** | ArialMT | entrelinha **12,8 pt** (1,28×), justificado |
| Rótulo "Questão N" | **11 pt** | Arial-BoldMT | — |
| Título de área | **12 pt** | Arial-BoldMT | caixa alta |
| Legendas e fonte bibliográfica | **8 pt** | ArialMT | logo abaixo do corpo |
| Subtítulo de capa | 16 pt | bold | só na capa |
| "2º Dia / Caderno / Azul" | 20 pt | — | só na capa |
| Título principal da capa | 25 pt | — | só na capa |
| Número do caderno | 50 pt | — | só na capa |

**Espaçamento entre letras: zero.** Tracking nativo da fonte, sem kerning manual
(medido caractere a caractere: gap = 0,00 pt entre glifos consecutivos).

> **Nota de implementação.** O jsPDF não embarca Arial; usa a Helvetica padrão, que é
> metricamente idêntica. No Word a fonte declarada é Arial de verdade.

---

## 3. Cor

| Uso | Cor |
|---|---|
| Texto (todo o miolo) | **#231F20** — preto quente de impressão, **não** #000000 |
| Filetes e tarja de registro | **#63656A** |
| Papel das páginas internas | #FFFFFF |
| Fundo da capa "Azul" | #B9E5FA |

No caderno oficial, **as ilustrações são 100% em tons de cinza** — nem mesmo a figura
da Questão 98, que descreve cores, usa cor cromática.

> ⚠️ **Divergência autorizada pelo professor:** neste sistema as **ilustrações saem
> COLORIDAS**. É a única regra do original que não seguimos. Todo o resto — formato,
> tipografia, grade, cor do texto, componentes — vale à risca.

---

## 4. Componentes recorrentes

- **Letras-opção circuladas** — no original são glifos de uma fonte dingbat dedicada
  (BundesbahnPiStd-1) no mesmo corpo do texto (10 pt). Onde a fonte não pode ser
  embarcada: no PDF, círculo vetorial com a letra centralizada; no Word, o caractere
  Unicode circulado (Ⓐ Ⓑ Ⓒ Ⓓ Ⓔ).
- **Enfeite de cabeçalho da questão** — fileira de quadrados girados 20°, em degradê de
  cinza, ao lado de cada "Questão N". Vetor, não imagem.
- **Fio pontilhado** — o mesmo traço na divisória entre colunas, no fim de cada questão
  e sobre o rodapé.
- **Código de barras** — Code 39 real, alternando de margem a cada página (par →
  esquerda, ímpar → direita), sempre na margem externa. Onde não há código de barras,
  a **tarja cinza de registro** (~30 mm, #63656A) cumpre o papel de marca de controle.
- **Logotipo "enem2019"** — traçado vetorial centralizado no rodapé, não texto editável.

---

## 5. Conteúdo da versão do aluno

Entra, nesta ordem, dentro do fluxo de duas colunas:

1. Rótulo **Questão N** (11 pt bold, com o enfeite de quadrados)
2. **Texto-base** (10 pt, justificado, recuo de 6 mm)
3. **Recurso visual** — imagem/gráfico coloridos, ou tabela vetorial
4. **Legenda / fonte bibliográfica** (8 pt)
5. **Comando** (10 pt, justificado)
6. **Alternativas A–E**, letra circulada na margem e texto pendurado
7. **Filete pontilhado** fechando o bloco

**Não entra:** gabarito, resolução comentada, comentários das alternativas,
competência, habilidade, objeto de conhecimento. Nada que entregue a resposta.

---

## 6. Conferência antes de entregar

- [ ] Página 200 × 275 mm, não A4
- [ ] Duas colunas com fio pontilhado na calha
- [ ] Corpo 10 pt com entrelinha 12,8 pt (razão 1,28)
- [ ] Texto justificado, primeira linha recuada em 6 mm, sem espaço entre parágrafos
- [ ] Tinta #231F20 em todo o miolo
- [ ] "Questão N" em 11 pt bold; título de área em 12 pt bold caixa alta
- [ ] Legendas e fontes bibliográficas em 8 pt
- [ ] Letras-opção circuladas, não "A)" digitado
- [ ] Filete pontilhado fechando cada questão
- [ ] Nenhum gabarito, resolução ou comentário na versão do aluno

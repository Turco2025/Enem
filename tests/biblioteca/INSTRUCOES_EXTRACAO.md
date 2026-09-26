# Extração da biblioteca de textos — provas da Unesp (2019–2026) e da Unicamp (2000–2026)

> Registro das instruções entregues aos agentes de extração em 26/09/2026 (carga Unesp 2019–2026 e
> Unicamp 2000–2026). A carga da Fuvest (1977–2026) seguiu as mesmas regras, com oito disciplinas
> (também História, Geografia, Sociologia, Filosofia e Língua Estrangeira). Os caminhos `/home/claude/...`
> são os do ambiente de trabalho da sessão. Conversão dos PDFs: `converte_provas.py`; carga final:
> `carga_textos_enem.sql`. Os textos extraídos ficam só no banco — nunca neste repositório.

Você vai ler provas de vestibular (já convertidas em texto) e extrair **os textos-base com a fonte
impressa na prova** que sirvam à biblioteca de **Literatura, Língua Portuguesa e Artes** de um app
que elabora questões no estilo ENEM a partir deles. A fidelidade ao texto impresso é o que mais
importa. O professor informou que os textos e as referências dessas provas estão validados.

## Entrada

Cada arquivo `.txt` é uma prova, página a página (`======== PÁGINA N ========`). `[[coluna 2]]`
marca o início da coluna da direita da página. Os arquivos marcados como OCR no prompt do lote
vieram de reconhecimento de imagem e têm erros (veja "Arquivos de OCR").
Leia com a ferramenta Read em partes (offset/limit), do começo ao fim de cada arquivo.

As provas da **Unicamp** são cadernos comentados da Comvest: depois de cada questão aparecem
"Resposta esperada", comentários da banca e às vezes respostas de candidatos ("acima da média",
"abaixo da média"). **Nada disso é texto-base**: extraia só os textos impressos na questão
(ou na coletânea da redação), com a fonte deles. Se precisar do enunciado, copie só o enunciado.

## O que extrair (um registro por texto)

Entra todo texto (ou trecho, poema, fragmento, crônica, conto, cena de teatro, texto crítico,
reportagem, artigo, verbete, anúncio com texto verbal, citação longa) que tenha **autoria ou fonte
impressa na prova** e se encaixe numa destas disciplinas:

- **Literatura** — texto literário (poema, prosa de ficção, teatro, crônica literária, carta ou
  sermão literário...) ou texto sobre literatura usado em questão de literatura; texto literário
  que apareça em questão de QUALQUER disciplina (História, Geografia, Ciências...) também entra.
- **Língua Portuguesa** — texto não literário usado para leitura, interpretação, gramática,
  gêneros, variação linguística, argumentação (reportagem, artigo de opinião, ensaio, verbete,
  crônica jornalística, anúncio, tira com texto transcrito...). Os textos da **coletânea da
  redação** que tenham fonte impressa entram aqui (ou em Literatura/Artes, se forem literários ou
  sobre arte), com `comando_original` = a proposta e `questoes` = [].
- **Artes** — texto sobre artes visuais, música, teatro, dança, cinema, arquitetura, design,
  fotografia, patrimônio, crítica de arte (inclusive nas provas de habilidades específicas da
  Unicamp: Artes Visuais, Artes Cênicas, Dança, Música, Educação Artística, Arquitetura).

NÃO entra:
- texto sem fonte impressa (frases da banca, enunciados, exemplos soltos de gramática);
- questão que só tem imagem, mapa, gráfico, tabela, partitura ou pintura sem texto verbal com fonte;
- texto curto demais para sustentar uma questão (menos de ~120 caracteres), a não ser poema curto
  completo ou epígrafe/aforismo com autor;
- textos de História, Geografia, Filosofia, Sociologia, Ciências da Natureza e Matemática que não
  sejam literários, nem sobre arte, nem sobre linguagem (esta carga é só de Literatura, Língua
  Portuguesa e Artes);
- textos em língua estrangeira (inglês, espanhol, francês) — a não ser citação curta dentro de
  texto em português;
- **letras de canção** (música popular, MPB, samba, rock, rap, sertanejo, marchinha, jingle, hino
  moderno etc.), mesmo com fonte impressa: NÃO transcreva e NÃO grave — nem trechos. Cantigas
  medievais e poemas (mesmo que depois musicados) são poemas e podem entrar. Na dúvida, não grave.
  Se um texto em prosa citar versos de canção, troque os versos por "[citação de letra de canção
  omitida]" e anote em observacoes;
- o trecho do ensaio de Jorge Coli "Bom dia, senhor Courbet!" (Unesp 2026) — já está no banco.

Se a mesma questão usa dois textos com fontes diferentes (Texto I e Texto II), faça **um registro
para cada texto**. Se um mesmo texto serve a várias questões, **um registro só**, com todos os
números das questões. Nas provas da Unesp o mesmo texto é, muitas vezes, base de 2 a 4 questões
seguidas ("Leia o texto para responder às questões de 01 a 03").

## Fidelidade (o ponto mais importante)

- Copie o texto **exatamente** como impresso: mesmas palavras, mesma pontuação, mesma ortografia
  (não atualize grafias antigas), mesmos "(...)" e "[...]".
- Corrija SÓ os artefatos da conversão: hífen de quebra de linha ("inexo-\nrável" → "inexorável";
  mas "horrorizá-\nlo" → "horrorizá-lo"), números de linha na margem (5, 10, 15...), cabeçalhos e
  rodapés, a marca `[[coluna 2]]`, texto de outra questão que entrou no meio pela diagramação,
  notas de glossário que a prova põe ao pé do texto (essas vão em observacoes, não no texto).
- Poemas: um verso por linha (`\n`), estrofes separadas por linha em branco (`\n\n`). Prosa:
  parágrafos separados por `\n\n`, linhas do mesmo parágrafo juntadas com espaço.
- Nunca complete, resuma, traduza ou "melhore" o texto. Se a conversão embaralhou colunas ou
  deixou trecho ilegível, confira na imagem da página:

      pdftoppm -r 110 -f N -l N -png "<pdf>" /tmp/<lote>_pN      (N = número da página)

  e abra o PNG com a ferramenta Read. Se ainda sobrar dúvida, qualidade "duvidosa".

## Arquivos de OCR

Os arquivos que o prompt do lote marca como OCR têm letras trocadas. Para CADA texto que for
gravar deles, confira na imagem da página (comando acima) e corrija pelo impresso. Qualidade
"ocr_conferido" (conferido e fiel) ou "duvidosa".

## Campos de cada registro

- `chave`: `<instituição>-<ano>-<código do arquivo>-q<NN>` (NN = primeira questão, dois dígitos);
  mais de um texto na mesma questão: `-t1`, `-t2`...; coletânea da redação: `-redacao-t1`,
  `-redacao-t2`... Instituição = `unesp` ou `unicamp`. Ex.: `unesp-2023-1f-q05-t2`,
  `unesp-2025-mda-1f-q12`, `unicamp-2004-2f-por-q03`, `unicamp-2010-1f-red-redacao-t2`.
  Se a numeração se repete dentro do mesmo arquivo (partes/provas diferentes), acrescente um rótulo
  (ex.: `-parteB-q02`) e explique em observacoes.
- `prova`: exatamente o valor que o prompt do lote dá para cada arquivo (ex.: `Unesp 2023`,
  `Unesp 2025 (meio de ano)`, `Unicamp 2004`); `ano`; `fase`: "1ª fase", "2ª fase" ou
  "Habilidades Específicas"; `arquivo`: nome do arquivo (sem .txt); `questoes`: lista de números.
- `disciplina`: "Literatura", "Língua Portuguesa" ou "Artes" (uma só).
- `area`: "linguagens".
- `idioma`: "pt".
- `tipo_texto` (um): "poema", "literario" (prosa de ficção, teatro, crônica literária),
  "ensaio", "jornalistico", "cientifico", "documento_historico", "discurso", "carta",
  "publicitario", "didatico", "outro".
- `autor`, `instituicao` (autoria institucional: jornal, órgão, museu...), `obra`, `ano_obra` —
  só o que a prova imprime ou o que está inequívoco na própria referência. **Nunca invente** ano,
  editora ou obra; na dúvida, deixe vazio.
- `referencia`: a fonte **exatamente como impressa** na prova (ex.: "(Machado de Assis. Dom
  Casmurro, 2016.)" → sem os parênteses externos: "Machado de Assis. Dom Casmurro, 2016."). Se a
  prova só diz o autor, é só o autor.
- `referencia_completa`: true só se a referência traz autor/instituição + obra/veículo + dados de
  publicação (editora/ano/data/URL).
- `texto`: o texto fiel (ver acima).
- `comando_original`: o enunciado da (primeira) questão que usa o texto; nas questões
  discursivas, o enunciado inteiro com os itens a), b)...; na redação, a proposta.
- `alternativas_originais`: {"A": ..., "B": ..., "C": ..., "D": ..., "E": ...} nas questões de
  múltipla escolha; null nas discursivas e na redação.
- `gabarito_original`: a letra, pelo arquivo de gabarito indicado no prompt (atenção à versão/tipo
  da prova, quando houver); sem gabarito ou sem certeza, null.
- `temas`: 5 a 8 temas em minúsculas e SEM acento — autor, obra, movimento/período, assunto,
  gênero (ex.: ["machado de assis", "dom casmurro", "realismo", "ciume", "narrador em primeira pessoa"]).
- `resumo`: uma frase em português sobre o que o texto trata.
- `tem_imagem`: true só se o texto NÃO se sustenta sem a imagem que o acompanha (tira cujo sentido
  depende do desenho, legenda de pintura). Se a questão tem uma imagem mas o texto se lê sozinho,
  false (e anote a imagem em observacoes).
- `qualidade`: "boa" (texto digital limpo), "ocr_conferido" ou "duvidosa".
- `observacoes`: o que for útil (ex.: "glossário ao pé do texto: ...", "questão compara com a
  pintura X") ou vazio.

## Gravação (banco de dados)

Carregue a ferramenta com ToolSearch ("select:mcp__Supabase__execute_sql") e grave cada registro
com `mcp__Supabase__execute_sql` (project_id `gkceyrkdmnhgqimmrsre`), na tabela
`public.textos_biblioteca_carga`, **4 a 6 registros por chamada**. Use SEMPRE aspas de dólar
`$fv$...$fv$` para os textos (nada de aspas simples escapadas). Modelo:

```sql
insert into public.textos_biblioteca_carga
 (chave, prova, ano, fase, arquivo, questoes, area, disciplina, idioma, tipo_texto, autor, instituicao, obra, ano_obra,
  referencia, referencia_completa, texto, comando_original, alternativas_originais, gabarito_original, temas, resumo,
  tem_imagem, qualidade, observacoes, lote)
values
 ($fv$unesp-2023-1f-q01$fv$, $fv$Unesp 2023$fv$, 2023, $fv$1ª fase$fv$, $fv$Unesp_2023_1a_fase_prova$fv$, '{1,2,3}',
  $fv$linguagens$fv$, $fv$Literatura$fv$, $fv$pt$fv$, $fv$poema$fv$, $fv$Carlos Drummond de Andrade$fv$, null, $fv$Claro enigma$fv$, null,
  $fv$Carlos Drummond de Andrade. Claro enigma, 2012.$fv$, true,
  $fv$verso 1
verso 2

verso 3$fv$,
  $fv$O poema ...$fv$,
  jsonb_build_object('A', $fv$...$fv$, 'B', $fv$...$fv$, 'C', $fv$...$fv$, 'D', $fv$...$fv$, 'E', $fv$...$fv$),
  $fv$C$fv$, array[$fv$carlos drummond de andrade$fv$, $fv$modernismo$fv$], $fv$Poema sobre ...$fv$,
  false, $fv$boa$fv$, null, $fv$<LOTE>$fv$)
 , ( ... próximo registro ... )
on conflict (chave) do nothing;
```

Nas discursivas e na redação, `alternativas_originais` e `gabarito_original` = null. Quebras de
linha do texto vão literais dentro das aspas de dólar. Se uma chamada der erro, corrija só aquele
lote e grave de novo (o `on conflict` evita duplicar).

Ao terminar cada prova, acrescente ao arquivo `/home/claude/vest/saida/<LOTE>.jsonl` uma linha
por registro gravado, SEM o texto: {"chave", "disciplina", "tipo_texto", "autor", "obra",
"questoes", "chars" (tamanho do texto), "qualidade", "tem_imagem"}.

## Ao final

Confira no banco: `select disciplina, count(*) from public.textos_biblioteca_carga where lote = '<LOTE>' group by 1;`
e responda com um resumo curto: quantos registros por disciplina e por prova, quantos "duvidosa",
letras de canção puladas e qualquer problema (arquivo ilegível, questões que não deu para separar).
Não escreva o texto dos registros na resposta. Se alguma resposta sua for bloqueada, pule aquele
texto, anote nos problemas e siga.

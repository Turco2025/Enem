-- v74.28 (26/09/2026) — biblioteca de textos do professor.
-- A tabela textos_enem passa a guardar também os textos que o professor envia (questões de
-- vestibulares e outras provas, extraídas dos PDFs dele). A coluna "prova" diz de onde veio o
-- texto: 'ENEM' nos textos do INEP (padrão — as linhas que já existem ficam como estão) e o nome
-- da outra prova nos demais ('Unesp 2026'). O backend (generate-question v74.28) apresenta o
-- texto de outra prova como tal, nunca como ENEM.
-- Reversão: primeiro volte o generate-question para a v74.27 (que não lê a coluna); depois
--   alter table public.textos_enem drop column if exists prova;
alter table public.textos_enem add column if not exists prova text not null default 'ENEM';
comment on column public.textos_enem.prova is
  'De que prova veio o texto-base: ENEM (textos do INEP) ou o nome da outra prova (ex.: Unesp 2026) — biblioteca de textos do professor, v74.28.';

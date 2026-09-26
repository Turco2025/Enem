-- Carga da biblioteca de textos do professor (26/09/2026): tabela provisória → public.textos_enem.
-- Usada nas cargas da Fuvest (1977–2026), da Unesp (2019–2026) e da Unicamp (2000–2026).
-- Fluxo: (1) criar public.textos_biblioteca_carga (colunas abaixo, RLS ligada, sem políticas);
-- (2) os agentes de extração gravam nela, lote a lote, seguindo INSTRUCOES_EXTRACAO.md;
-- (3) conferência (contagens, duplicatas, letras de canção) e este insert; (4) drop da tabela provisória.
-- Regras: a referência que a prova não imprimiu completa ganha "Trecho reproduzido na prova da <prova>.";
-- texto igual a outro que já está no banco não entra de novo (md5); ficam fora da geração
-- (aproveitavel = false, com o motivo): texto que depende de imagem, leitura duvidosa, texto didático
-- (o Guia do Inep veda livro didático como fonte), texto com trecho omitido (letra de canção) e idioma
-- que o app não usa.
insert into public.textos_enem
  (chave, ano, aplicacao, numero, area, disciplina, tipo_texto, autor, instituicao, obra, ano_obra, referencia, texto,
   comando_original, alternativas_originais, gabarito_original, temas, resumo, tem_imagem, aproveitavel, motivo_nao_aproveitavel, prova)
select c.chave, c.ano::smallint, 'vestibular', coalesce(c.questoes[1], 0)::smallint, c.area, c.disciplina, c.tipo_texto,
       nullif(trim(c.autor), ''), nullif(trim(c.instituicao), ''), nullif(trim(c.obra), ''), nullif(trim(c.ano_obra), ''),
       case when c.referencia_completa then trim(c.referencia)
            else rtrim(trim(c.referencia))
                 || case when right(rtrim(trim(c.referencia)), 1) in ('.', '!', '?') then '' else '.' end
                 || ' Trecho reproduzido na prova da ' || c.prova || '.' end,
       c.texto, c.comando_original, c.alternativas_originais, nullif(trim(c.gabarito_original), ''),
       coalesce(c.temas, '{}'::text[]), c.resumo, coalesce(c.tem_imagem, false),
       not (coalesce(c.tem_imagem, false) or c.qualidade = 'duvidosa' or coalesce(c.idioma, 'pt') not in ('pt', 'en')
            or c.tipo_texto = 'didatico' or c.texto ~* 'omitid'),
       case when coalesce(c.tem_imagem, false) then 'O texto depende de imagem impressa na prova (não reproduzida na biblioteca).'
            when c.qualidade = 'duvidosa' then 'Leitura duvidosa na digitalização da prova.'
            when coalesce(c.idioma, 'pt') not in ('pt', 'en') then 'Texto em idioma que o app não usa (' || c.idioma || ').'
            when c.tipo_texto = 'didatico' then 'Texto de natureza didática (o Guia do Inep veda livro didático como fonte).'
            when c.texto ~* 'omitid' then 'Texto com trecho omitido na extração (letra de canção).'
            else null end,
       c.prova
from (select distinct on (md5(texto)) * from public.textos_biblioteca_carga order by md5(texto), chave) c
where not exists (select 1 from public.textos_enem e where md5(e.texto) = md5(c.texto))
on conflict (chave) do nothing;

-- Reversão de 2026-10-14_cotas_uso_gratis.sql.
-- ATENÇÃO: só rode depois de voltar generate-image e generate-question para as versões
-- anteriores (elas não chamam creditos_uso_gratis). Apaga apenas o que a migração criou:
-- a função, a tabela de uso diário e as colunas de contagem. Os créditos não mudam.
drop function if exists public.creditos_uso_gratis(uuid, text, text);
drop table if exists public.creditos_uso_diario;
alter table public.creditos_cobrancas drop column if exists usos_vez;
alter table public.creditos_cobrancas drop column if exists imagens;
alter table public.creditos_cobrancas drop column if exists visuais;
alter table if exists public.image_generation_log drop column if exists user_id;

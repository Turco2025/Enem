-- Reversão da Etapa 2 (créditos): apaga SÓ o que 2026-10-13_etapa2_creditos.sql cria.
-- Atenção: apaga também os lotes e as cobranças registrados (créditos comprados).
drop function if exists public.creditos_meu_saldo();
drop function if exists public.creditos_adicionar(uuid, integer, text, text, interval);
drop function if exists public.creditos_devolver(uuid, text, text, interval);
drop function if exists public.creditos_reconfirmar(uuid, text);
drop function if exists public.creditos_entregue(uuid, text);
drop function if exists public.creditos_cobrar(uuid, text, text);
drop function if exists public.creditos_entregas_por_cobranca(uuid, text);
drop function if exists public.creditos_saldo(uuid);
drop function if exists public.creditos_ilimitado(uuid);
drop function if exists public.creditos_exige_servidor();
drop table if exists public.creditos_cobrancas;
drop table if exists public.creditos_lotes;

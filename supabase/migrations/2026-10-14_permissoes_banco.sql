-- ============================================================================
-- Etapa 2.3: Permissões das funções do banco (análise de segurança de 13/10/2026)
-- Projeto Supabase gkceyrkdmnhgqimmrsre · 2026-10-14
--
-- As funções de crédito já recusam o navegador por dentro (creditos_exige_servidor), mas o
-- consultor de segurança do Supabase avisava que visitante e usuário logado ainda tinham a
-- permissão de chamá-las (permissão padrão de PUBLIC). Aqui essa permissão sai: só o servidor
-- (service_role) chama as funções de crédito; o usuário logado continua vendo o próprio saldo
-- (creditos_meu_saldo). É uma segunda tranca, não muda o que o app faz.
--
-- A função de busca do revisor de Matemática (match_math_reference_chunks) ganha um
-- search_path fixo (aviso "Function Search Path Mutable") e deixa de poder ser chamada pelo
-- navegador: só o revisor, com a chave de serviço, a usa.
--
-- Nada de dados muda. Reversão: 2026-10-14_permissoes_banco_rollback.sql.
-- ============================================================================

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.creditos_exige_servidor()',
    'public.creditos_ilimitado(uuid)',
    'public.creditos_saldo(uuid)',
    'public.creditos_entregas_por_cobranca(uuid, text)',
    'public.creditos_cobrar(uuid, text, text)',
    'public.creditos_entregue(uuid, text)',
    'public.creditos_devolver(uuid, text, text, interval)',
    'public.creditos_reconfirmar(uuid, text)',
    'public.creditos_adicionar(uuid, integer, text, text, interval)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- o próprio saldo: só usuário logado (e o servidor)
revoke all on function public.creditos_meu_saldo() from public, anon;
grant execute on function public.creditos_meu_saldo() to authenticated, service_role;

-- busca do revisor de Matemática
alter function public.match_math_reference_chunks(vector, integer, double precision) set search_path = public, pg_temp;
revoke all on function public.match_math_reference_chunks(vector, integer, double precision) from public, anon, authenticated;
grant execute on function public.match_math_reference_chunks(vector, integer, double precision) to service_role;

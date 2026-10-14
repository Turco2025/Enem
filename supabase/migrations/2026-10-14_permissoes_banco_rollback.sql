-- Reversão de 2026-10-14_permissoes_banco.sql: devolve a permissão padrão (PUBLIC) das funções.
-- As funções de crédito continuam recusando o navegador por dentro (creditos_exige_servidor).
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
    'public.creditos_adicionar(uuid, integer, text, text, interval)',
    'public.creditos_meu_saldo()',
    'public.match_math_reference_chunks(vector, integer, double precision)'
  ] loop
    execute format('grant execute on function %s to public', f);
  end loop;
end $$;
alter function public.match_math_reference_chunks(vector, integer, double precision) reset search_path;

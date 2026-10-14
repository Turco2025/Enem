-- ============================================================================
-- Etapa 2.2: Trava da cobrança em andamento (análise de segurança de 13/10/2026)
-- Projeto Supabase gkceyrkdmnhgqimmrsre · 2026-10-14
--
-- Problema 1: o mesmo identificador de cobrança podia ser usado em vários pedidos ao mesmo
-- tempo. O primeiro cobrava; os outros chegavam antes da entrega, contavam como "nova
-- tentativa grátis" e cada um gerava uma questão. Com 1 crédito saíam várias questões.
-- Correção: cada cobrança (nova ou reaproveitada) fica "em andamento" por até 150 segundos
-- (o tempo máximo de uma geração). Enquanto isso, outro pedido com o mesmo identificador
-- recebe {ok:false, motivo:'em_andamento'} e o servidor responde 409 sem gerar nada. A trava
-- sai quando o pedido termina: entrega (creditos_entregue), devolução (creditos_devolver),
-- recobrança (creditos_reconfirmar) ou liberação (creditos_liberar, nova).
--
-- Problema 2: uma questão de pedido do WhatsApp ("wa-<pedido>-<nº>") valia 3 entregas por
-- crédito enquanto o pedido estava "gerando", e o próprio professor podia usar esse formato
-- pelo app. Correção: o número de entregas grátis passa a ser o número de vezes que o robô
-- já começou aquele pedido (progresso.tentativas, que só o servidor grava), no máximo 3.
-- Na primeira tentativa do robô, 1 crédito = 1 questão, como em qualquer pedido.
--
-- Aditivo nas tabelas (1 coluna nova com valor padrão nulo). As funções são substituídas
-- pela mesma assinatura (as permissões continuam as mesmas). Reversão:
-- 2026-10-14_trava_cobranca_rollback.sql.
-- ============================================================================

alter table public.creditos_cobrancas add column if not exists em_andamento_ate timestamptz;
comment on column public.creditos_cobrancas.em_andamento_ate is 'Até quando este pedido está sendo gerado (trava contra pedidos simultâneos com o mesmo identificador). Nulo = livre.';

-- Quantas entregas uma cobrança paga: 1, salvo nas questões de um pedido do WhatsApp que
-- está sendo gerado agora, em que vale o número de tentativas que o robô já começou (máx. 3).
create or replace function public.creditos_entregas_por_cobranca(p_user uuid, p_cobranca text) returns integer
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_n integer;
begin
  perform public.creditos_exige_servidor();
  -- o formato é conferido antes de qualquer conversão (um id fora do formato vale 1 entrega)
  if p_cobranca is null or p_cobranca !~ '^wa-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]{1,2}$' then
    return 1;
  end if;
  select least(3, greatest(1, case when w.progresso->>'tentativas' ~ '^[0-9]{1,2}$' then (w.progresso->>'tentativas')::integer else 1 end))
    into v_n
    from public.wa_trabalhos w
   where w.id = substring(p_cobranca from 4 for 36)::uuid
     and w.user_id = p_user
     and w.status = 'gerando'
     and substring(p_cobranca from 41)::integer between 1 and
         (case when w.parametros->>'quantidade' ~ '^[0-9]{1,3}$' then (w.parametros->>'quantidade')::integer else 0 end);
  return coalesce(v_n, 1);
end; $$;

-- Cobra 1 crédito pelo pedido p_cobranca. Respostas:
--   {ok:true,  cobrado:true,  saldo}             cobrou agora
--   {ok:true,  cobrado:false, saldo}             retentativa do mesmo pedido antes da entrega: não cobra
--   {ok:true,  cobrado:false, ilimitado:true}    conta sem limite
--   {ok:false, motivo:'sem_creditos', saldo:0}   sem crédito: não gera
--   {ok:false, motivo:'em_andamento', saldo}     o mesmo pedido está sendo gerado agora: não gera (v2.2)
create or replace function public.creditos_cobrar(p_user uuid, p_cobranca text, p_motivo text default 'questao')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_cob public.creditos_cobrancas%rowtype;
  v_existe boolean;
  v_lote bigint;
  v_motivo text := case when p_motivo = 'refazer' then 'refazer' else 'questao' end;
  v_prazo interval := interval '150 seconds';   -- tempo máximo de uma geração (a Edge Function para em 150 s)
begin
  perform public.creditos_exige_servidor();
  if p_user is null or p_cobranca is null or length(p_cobranca) not between 8 and 80 then
    raise exception 'creditos_cobrar: parâmetros inválidos';
  end if;
  if public.creditos_ilimitado(p_user) then
    return jsonb_build_object('ok', true, 'cobrado', false, 'ilimitado', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select * into v_cob from public.creditos_cobrancas where user_id = p_user and id = p_cobranca for update;
  v_existe := found;
  -- v2.2: o mesmo pedido ainda está sendo gerado: não cobra e não deixa gerar em paralelo
  if v_existe and v_cob.estado = 'cobrado' and v_cob.em_andamento_ate is not null and v_cob.em_andamento_ate > now() then
    return jsonb_build_object('ok', false, 'motivo', 'em_andamento', 'saldo', public.creditos_saldo(p_user));
  end if;
  if v_existe and v_cob.estado = 'cobrado' and v_cob.entregas < public.creditos_entregas_por_cobranca(p_user, p_cobranca) then
    -- retentativa antes da entrega: não cobra; o prazo de devolução conta a partir de agora
    update public.creditos_cobrancas set cobrado_em = now(), em_andamento_ate = now() + v_prazo
     where user_id = p_user and id = p_cobranca;
    return jsonb_build_object('ok', true, 'cobrado', false, 'saldo', public.creditos_saldo(p_user));
  end if;
  -- o lote que vence primeiro é usado primeiro
  select id into v_lote from public.creditos_lotes
   where user_id = p_user and restante > 0 and expira_em > now()
   order by expira_em, id limit 1 for update;
  if v_lote is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_creditos', 'saldo', 0);
  end if;
  update public.creditos_lotes set restante = restante - 1 where id = v_lote;
  if v_existe then
    -- pedido devolvido (ou já entregue) que chega de novo: cobra de novo
    update public.creditos_cobrancas
       set estado = 'cobrado', lote_id = v_lote, vezes = vezes + 1, entregas = 0, cobrado_em = now(),
           devolvido_em = null, motivo_devolucao = null, em_andamento_ate = now() + v_prazo
     where user_id = p_user and id = p_cobranca;
  else
    insert into public.creditos_cobrancas (user_id, id, motivo, estado, lote_id, em_andamento_ate)
    values (p_user, p_cobranca, v_motivo, 'cobrado', v_lote, now() + v_prazo);
  end if;
  return jsonb_build_object('ok', true, 'cobrado', true, 'saldo', public.creditos_saldo(p_user));
end; $$;

-- O servidor avisa que a questão deste pedido foi entregue (resposta final com a questão).
create or replace function public.creditos_entregue(p_user uuid, p_cobranca text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_entregas integer;
begin
  perform public.creditos_exige_servidor();
  update public.creditos_cobrancas set entregas = entregas + 1, em_andamento_ate = null
   where user_id = p_user and id = p_cobranca and estado = 'cobrado'
   returning entregas into v_entregas;
  return jsonb_build_object('ok', true, 'entregas', v_entregas);
end; $$;

-- Devolve o crédito do pedido p_cobranca (se estiver cobrado). p_janela marca a devolução
-- pedida pelo app: só vale para cobranças recentes e no máximo 30 por dia (proteção contra
-- abuso; o servidor passa null e não tem esses limites).
create or replace function public.creditos_devolver(p_user uuid, p_cobranca text, p_motivo text default null, p_janela interval default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_cob public.creditos_cobrancas%rowtype;
  v_motivo text := left(coalesce(p_motivo, 'erro'), 190);
begin
  perform public.creditos_exige_servidor();
  if p_user is null or p_cobranca is null then
    raise exception 'creditos_devolver: parâmetros inválidos';
  end if;
  if p_janela is not null and v_motivo not like 'app:%' then v_motivo := 'app: ' || v_motivo; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select * into v_cob from public.creditos_cobrancas where user_id = p_user and id = p_cobranca for update;
  if not found or v_cob.estado <> 'cobrado' then
    return jsonb_build_object('ok', true, 'devolvido', false, 'saldo', public.creditos_saldo(p_user));
  end if;
  if p_janela is not null and v_cob.cobrado_em < now() - p_janela then
    return jsonb_build_object('ok', false, 'devolvido', false, 'motivo', 'fora_do_prazo', 'saldo', public.creditos_saldo(p_user));
  end if;
  if p_janela is not null and (select count(*) from public.creditos_cobrancas
       where user_id = p_user and estado = 'devolvido' and motivo_devolucao like 'app:%'
         and devolvido_em > now() - interval '24 hours') >= 30 then
    return jsonb_build_object('ok', false, 'devolvido', false, 'motivo', 'limite_diario', 'saldo', public.creditos_saldo(p_user));
  end if;
  if v_cob.lote_id is not null then
    update public.creditos_lotes set restante = least(quantidade, restante + 1) where id = v_cob.lote_id;
  end if;
  update public.creditos_cobrancas
     set estado = 'devolvido', devolvido_em = now(), motivo_devolucao = v_motivo, em_andamento_ate = null
   where user_id = p_user and id = p_cobranca;
  return jsonb_build_object('ok', true, 'devolvido', true, 'saldo', public.creditos_saldo(p_user));
end; $$;

-- Cobra de novo uma questão que tinha sido devolvida e acabou entregue depois (ex.: a imagem
-- falhou, o crédito voltou, e o professor clicou em "Tentar novamente" na imagem).
create or replace function public.creditos_reconfirmar(p_user uuid, p_cobranca text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_cob public.creditos_cobrancas%rowtype;
  v_res jsonb;
begin
  perform public.creditos_exige_servidor();
  if p_user is null or p_cobranca is null then
    raise exception 'creditos_reconfirmar: parâmetros inválidos';
  end if;
  if public.creditos_ilimitado(p_user) then
    return jsonb_build_object('ok', true, 'cobrado', false, 'ilimitado', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select * into v_cob from public.creditos_cobrancas where user_id = p_user and id = p_cobranca for update;
  if not found then
    return jsonb_build_object('ok', true, 'cobrado', false, 'sem_registro', true, 'saldo', public.creditos_saldo(p_user));
  end if;
  if v_cob.estado = 'cobrado' then
    return jsonb_build_object('ok', true, 'cobrado', false, 'saldo', public.creditos_saldo(p_user));
  end if;
  v_res := public.creditos_cobrar(p_user, p_cobranca, v_cob.motivo);
  if (v_res->>'cobrado')::boolean then
    -- a questão já está entregue; nenhuma geração vai acontecer: a trava sai na hora
    update public.creditos_cobrancas set entregas = 1, em_andamento_ate = null where user_id = p_user and id = p_cobranca;
  end if;
  return v_res;
end; $$;

-- v2.2: o servidor libera a trava de um pedido que terminou sem entrega nem devolução (ex.:
-- retentativa grátis que falhou, ou questão que o app vai pedir de novo com o mesmo id).
create or replace function public.creditos_liberar(p_user uuid, p_cobranca text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  perform public.creditos_exige_servidor();
  if p_user is null or p_cobranca is null then
    raise exception 'creditos_liberar: parâmetros inválidos';
  end if;
  update public.creditos_cobrancas set em_andamento_ate = null where user_id = p_user and id = p_cobranca;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.creditos_liberar(uuid, text) from public, anon, authenticated;
grant execute on function public.creditos_liberar(uuid, text) to service_role;

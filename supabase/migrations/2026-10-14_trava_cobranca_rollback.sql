-- Reversão de 2026-10-14_trava_cobranca.sql.
-- ATENÇÃO: rode só depois de voltar a generate-question para a versão anterior (v74.41), que
-- não chama creditos_liberar nem trata a resposta "em_andamento".
-- Volta as cinco funções de crédito ao texto de 2026-10-13_etapa2_creditos.sql (copiado abaixo,
-- sem mudança), apaga a função nova e, por último, a coluna da trava. Saldos e cobranças não mudam.

create or replace function public.creditos_entregas_por_cobranca(p_user uuid, p_cobranca text) returns integer
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  perform public.creditos_exige_servidor();
  -- o formato é conferido antes de qualquer conversão (um id fora do formato vale 1 entrega)
  if p_cobranca is null or p_cobranca !~ '^wa-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]{1,2}$' then
    return 1;
  end if;
  if exists (
    select 1 from public.wa_trabalhos w
     where w.id = substring(p_cobranca from 4 for 36)::uuid
       and w.user_id = p_user
       and w.status = 'gerando'
       and substring(p_cobranca from 41)::integer between 1 and
           (case when w.parametros->>'quantidade' ~ '^[0-9]{1,3}$' then (w.parametros->>'quantidade')::integer else 0 end)
  ) then
    return 3;
  end if;
  return 1;
end; $$;

create or replace function public.creditos_cobrar(p_user uuid, p_cobranca text, p_motivo text default 'questao')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_cob public.creditos_cobrancas%rowtype;
  v_existe boolean;
  v_lote bigint;
  v_motivo text := case when p_motivo = 'refazer' then 'refazer' else 'questao' end;
begin
  perform public.creditos_exige_servidor();
  if p_user is null or p_cobranca is null or length(p_cobranca) not between 8 and 80 then
    raise exception 'creditos_cobrar: parâmetros inválidos';
  end if;
  if public.creditos_ilimitado(p_user) then
    return jsonb_build_object('ok', true, 'cobrado', false, 'ilimitado', true);
  end if;
  -- o mesmo pedido nunca é processado em paralelo, mas a trava evita corrida mesmo assim
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select * into v_cob from public.creditos_cobrancas where user_id = p_user and id = p_cobranca for update;
  v_existe := found;
  if v_existe and v_cob.estado = 'cobrado' and v_cob.entregas < public.creditos_entregas_por_cobranca(p_user, p_cobranca) then
    -- retentativa antes da entrega: não cobra; o prazo de devolução conta a partir de agora
    update public.creditos_cobrancas set cobrado_em = now() where user_id = p_user and id = p_cobranca;
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
           devolvido_em = null, motivo_devolucao = null
     where user_id = p_user and id = p_cobranca;
  else
    insert into public.creditos_cobrancas (user_id, id, motivo, estado, lote_id)
    values (p_user, p_cobranca, v_motivo, 'cobrado', v_lote);
  end if;
  return jsonb_build_object('ok', true, 'cobrado', true, 'saldo', public.creditos_saldo(p_user));
end; $$;

create or replace function public.creditos_entregue(p_user uuid, p_cobranca text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_entregas integer;
begin
  perform public.creditos_exige_servidor();
  update public.creditos_cobrancas set entregas = entregas + 1
   where user_id = p_user and id = p_cobranca and estado = 'cobrado'
   returning entregas into v_entregas;
  return jsonb_build_object('ok', true, 'entregas', v_entregas);
end; $$;

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
     set estado = 'devolvido', devolvido_em = now(), motivo_devolucao = v_motivo
   where user_id = p_user and id = p_cobranca;
  return jsonb_build_object('ok', true, 'devolvido', true, 'saldo', public.creditos_saldo(p_user));
end; $$;

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
    update public.creditos_cobrancas set entregas = 1 where user_id = p_user and id = p_cobranca;   -- a questão já está entregue
  end if;
  return v_res;
end; $$;

drop function if exists public.creditos_liberar(uuid, text);
alter table public.creditos_cobrancas drop column if exists em_andamento_ate;

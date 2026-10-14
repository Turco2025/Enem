-- ============================================================================
-- Etapa 2.1: Cotas do uso grátis (verificação de segurança de 13/10/2026)
-- Projeto Supabase gkceyrkdmnhgqimmrsre · 2026-10-14
--
-- Imagem, "refazer" de imagem/gráfico/tabela e "planejar recortes" continuam sem custar
-- crédito (decisão do professor). O que muda: o servidor passa a conferir, ANTES de
-- chamar a OpenAI ou a Anthropic, que quem pede tem direito a esse uso grátis.
--   1) Uso ligado a uma questão cobrada da própria conta (o app manda o identificador
--      da cobrança): vale até 12 imagens e 8 "refazer" do recurso visual por cobrança.
--      Quando a mesma questão é cobrada de novo (creditos_cobrar: vezes + 1), a cota
--      recomeça.
--   2) Sem questão cobrada válida (simulado antigo, cota da questão esgotada, planejar
--      recortes): a conta precisa ter saldo de pelo menos 1 crédito, e há um limite por
--      dia (horário de Brasília): 20 imagens, 20 "refazer" e 30 planejamentos.
--   A conta do dono (perfis.ilimitado) não tem limite.
-- Antes disso, qualquer conta logada, mesmo sem nenhum crédito, podia chamar essas
-- rotas direto, sem limite, e cada chamada era paga pelo dono.
--
-- Tudo aqui é ADITIVO: três colunas novas com valor padrão, uma tabela e uma função
-- novas. Nada do que existe é alterado. Reversão: 2026-10-14_cotas_uso_gratis_rollback.sql.
-- ============================================================================

-- contadores por cobrança (valem para a "vez" da cobrança em usos_vez)
alter table public.creditos_cobrancas add column if not exists usos_vez integer not null default 0;
alter table public.creditos_cobrancas add column if not exists imagens integer not null default 0;
alter table public.creditos_cobrancas add column if not exists visuais integer not null default 0;

-- quem gerou cada imagem (antes o log não tinha usuário)
alter table if exists public.image_generation_log add column if not exists user_id uuid;

-- uso grátis por dia, quando não há questão cobrada para ligar o pedido
create table if not exists public.creditos_uso_diario (
  user_id uuid not null references auth.users(id) on delete cascade,
  dia date not null,
  tipo text not null check (tipo in ('imagem', 'visual', 'planejar')),
  usos integer not null default 0 check (usos >= 0),
  primary key (user_id, dia, tipo)
);
comment on table public.creditos_uso_diario is 'Uso grátis por dia (imagem, refazer recurso visual, planejar recortes) sem questão cobrada. Só o servidor lê e grava.';
alter table public.creditos_uso_diario enable row level security;
-- sem política nenhuma: com a RLS ligada, o navegador não lê nem grava (o servidor ignora a RLS)
revoke all on public.creditos_uso_diario from anon, authenticated;
grant all on public.creditos_uso_diario to service_role;

-- Confere e registra um uso grátis. Respostas:
--   {ok:true, ilimitado:true}                      conta do dono
--   {ok:true, por:'questao'}                       contou na cota da questão cobrada
--   {ok:true, por:'dia', usos, limite}             contou na cota do dia
--   {ok:false, motivo:'sem_creditos', saldo:0, limite_questao}   sem saldo (e sem cota da questão)
--   {ok:false, motivo:'limite_diario', limite}     cota do dia esgotada
create or replace function public.creditos_uso_gratis(p_user uuid, p_tipo text, p_cobranca text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_cap_questao integer := case p_tipo when 'imagem' then 12 when 'visual' then 8 else 0 end;
  v_cap_dia integer := case p_tipo when 'imagem' then 20 when 'visual' then 20 when 'planejar' then 30 else 0 end;
  v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ok boolean;
  v_tem_cobranca boolean := false;
  v_usos integer;
begin
  perform public.creditos_exige_servidor();
  if p_user is null or p_tipo is null or p_tipo not in ('imagem', 'visual', 'planejar') then
    raise exception 'creditos_uso_gratis: parâmetros inválidos';
  end if;
  if public.creditos_ilimitado(p_user) then
    return jsonb_build_object('ok', true, 'ilimitado', true);
  end if;

  -- 1) cota da questão cobrada da própria conta (um UPDATE só: confere e conta de uma vez)
  if p_cobranca is not null and v_cap_questao > 0 then
    update public.creditos_cobrancas
       set imagens  = (case when usos_vez = vezes then imagens else 0 end) + (case when p_tipo = 'imagem' then 1 else 0 end),
           visuais  = (case when usos_vez = vezes then visuais else 0 end) + (case when p_tipo = 'visual' then 1 else 0 end),
           usos_vez = vezes
     where user_id = p_user and id = p_cobranca and estado = 'cobrado'
       and cobrado_em > now() - interval '30 days'
       and (case when usos_vez = vezes then (case when p_tipo = 'imagem' then imagens else visuais end) else 0 end) < v_cap_questao
    returning true into v_ok;
    if coalesce(v_ok, false) then
      return jsonb_build_object('ok', true, 'por', 'questao');
    end if;
    v_tem_cobranca := exists (select 1 from public.creditos_cobrancas
      where user_id = p_user and id = p_cobranca and estado = 'cobrado' and cobrado_em > now() - interval '30 days');
  end if;

  -- 2) cota do dia: só para quem tem saldo
  if public.creditos_saldo(p_user) < 1 then
    return jsonb_build_object('ok', false, 'motivo', 'sem_creditos', 'saldo', 0, 'limite_questao', v_tem_cobranca);
  end if;
  insert into public.creditos_uso_diario as u (user_id, dia, tipo, usos)
  values (p_user, v_dia, p_tipo, 1)
  on conflict (user_id, dia, tipo) do update set usos = u.usos + 1 where u.usos < v_cap_dia
  returning u.usos into v_usos;
  if v_usos is null then
    return jsonb_build_object('ok', false, 'motivo', 'limite_diario', 'limite', v_cap_dia);
  end if;
  return jsonb_build_object('ok', true, 'por', 'dia', 'usos', v_usos, 'limite', v_cap_dia);
end; $$;

-- Só o servidor chama (a trava creditos_exige_servidor recusa anon e authenticated, e
-- aqui também sai a permissão padrão de PUBLIC).
revoke all on function public.creditos_uso_gratis(uuid, text, text) from public, anon, authenticated;
grant execute on function public.creditos_uso_gratis(uuid, text, text) to service_role;

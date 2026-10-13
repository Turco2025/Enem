-- ============================================================================
-- Etapa 2 — Créditos
-- Projeto Supabase gkceyrkdmnhgqimmrsre · 2026-10-13
--
-- 1 crédito = 1 questão gerada (também ao refazer). Imagem, gráfico e tabela não
-- custam crédito. Se a questão não sair, o crédito volta. Créditos valem 12 meses
-- a partir da compra. A conta do dono (perfis.ilimitado = true) não usa créditos.
--
-- O saldo é a soma do que resta nos lotes ainda válidos. Cada pedido de questão
-- do app tem um identificador (cobrança): as retentativas automáticas do mesmo
-- pedido usam o mesmo identificador e não cobram de novo.
--
-- Tudo aqui é ADITIVO: cria tabelas e funções novas, não altera nem apaga nada
-- do que já existe. Reversão: 2026-10-13_etapa2_creditos_rollback.sql.
-- O navegador só LÊ (o próprio saldo e o próprio histórico); quem cobra, devolve
-- e adiciona créditos é o servidor (service_role), pelas funções abaixo. A trava fica
-- dentro de cada função (creditos_exige_servidor): chamada pelo navegador (papéis anon e
-- authenticated da API) é recusada. As tabelas só aceitam leitura das próprias linhas (RLS).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. creditos_lotes — cada compra (ou cortesia/ajuste do dono) é um lote
-- ----------------------------------------------------------------------------
create table if not exists public.creditos_lotes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  quantidade integer not null check (quantidade > 0),
  restante integer not null check (restante >= 0),
  origem text not null check (origem in ('compra', 'cortesia', 'ajuste')),
  referencia text,                              -- id do pagamento (Etapa 3) ou observação
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '12 months',
  constraint creditos_lotes_restante_ate_quantidade check (restante <= quantidade)
);
comment on table public.creditos_lotes is 'Créditos comprados (ou dados pelo dono). Saldo = soma de restante dos lotes ainda válidos.';
create index if not exists creditos_lotes_user_idx on public.creditos_lotes (user_id, expira_em);
-- um pagamento vira um lote só (a Etapa 3 pode receber o mesmo aviso de pagamento mais de uma vez)
create unique index if not exists creditos_lotes_compra_ref_uidx on public.creditos_lotes (referencia)
  where origem = 'compra' and referencia is not null;

-- ----------------------------------------------------------------------------
-- 2. creditos_cobrancas — uma linha por questão cobrada
-- ----------------------------------------------------------------------------
create table if not exists public.creditos_cobrancas (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) between 8 and 80),   -- identificador do pedido, vindo do app
  motivo text not null check (motivo in ('questao', 'refazer')),
  estado text not null check (estado in ('cobrado', 'devolvido')),
  lote_id bigint references public.creditos_lotes(id) on delete set null,
  vezes integer not null default 1,             -- quantas vezes foi cobrada (devolvida e cobrada de novo)
  entregas integer not null default 0,          -- questões entregues com esta cobrança (ver creditos_cobrar)
  cobrado_em timestamptz not null default now(),  -- última cobrança (ou último reaproveitamento sem custo)
  devolvido_em timestamptz,
  motivo_devolucao text,
  primary key (user_id, id)
);
comment on table public.creditos_cobrancas is 'Cada questão pedida cobra 1 crédito uma vez só (retentativas do mesmo pedido, antes da entrega, não cobram de novo); erro devolve.';
create index if not exists creditos_cobrancas_user_idx on public.creditos_cobrancas (user_id, cobrado_em desc);

alter table public.creditos_lotes enable row level security;
alter table public.creditos_cobrancas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'creditos_lotes' and policyname = 'creditos_lotes_select_own') then
    create policy creditos_lotes_select_own on public.creditos_lotes for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'creditos_cobrancas' and policyname = 'creditos_cobrancas_select_own') then
    create policy creditos_cobrancas_select_own on public.creditos_cobrancas for select to authenticated using (auth.uid() = user_id);
  end if;
end $$;
-- Só há política de LEITURA (das próprias linhas): com a RLS ligada, o navegador não grava
-- nem altera nada nestas tabelas. Quem grava é o servidor (service_role ignora a RLS).

-- ----------------------------------------------------------------------------
-- 3. Funções internas (só o servidor: service_role)
-- ----------------------------------------------------------------------------
-- A trava: a API do Supabase (PostgREST) troca o papel da conexão para anon (visitante),
-- authenticated (logado) ou service_role (servidor, com a chave secreta) e a configuração
-- "role" guarda esse papel mesmo dentro das funções abaixo. Visitante e logado são recusados
-- (mesmo erro de "sem permissão" do banco); o servidor e a conexão direta do dono passam.
create or replace function public.creditos_exige_servidor() returns void
language plpgsql stable set search_path = pg_catalog, public, pg_temp as $$
begin
  if coalesce(current_setting('role', true), '') in ('anon', 'authenticated') then
    raise exception 'créditos: só o servidor do app pode fazer isto' using errcode = '42501';
  end if;
end; $$;

create or replace function public.creditos_ilimitado(p_user uuid) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  perform public.creditos_exige_servidor();
  return coalesce((select ilimitado from public.perfis where user_id = p_user), false);
end; $$;

create or replace function public.creditos_saldo(p_user uuid) returns integer
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  perform public.creditos_exige_servidor();
  return coalesce((select sum(restante) from public.creditos_lotes
    where user_id = p_user and restante > 0 and expira_em > now()), 0)::integer;
end; $$;

-- Quantas entregas uma cobrança paga. 1, salvo nas questões de um pedido do WhatsApp que está
-- sendo gerado agora ("wa-<id do pedido>-<nº da questão>"): o robô pode refazer o pedido
-- inteiro até 3 vezes (operario.ts, MAX_TENTATIVAS_TRABALHO) sem cobrar de novo.
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

-- Cobra 1 crédito pelo pedido p_cobranca. Respostas:
--   {ok:true,  cobrado:true,  saldo}             cobrou agora
--   {ok:true,  cobrado:false, saldo}             retentativa do mesmo pedido antes da entrega: não cobra
--   {ok:true,  cobrado:false, ilimitado:true}    conta sem limite
--   {ok:false, motivo:'sem_creditos', saldo:0}   sem crédito: não gera
-- Um pedido já entregue (entregas no limite) que chega de novo é uma questão nova: cobra.
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

-- O servidor avisa que a questão deste pedido foi entregue (resposta final com a questão).
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
     set estado = 'devolvido', devolvido_em = now(), motivo_devolucao = v_motivo
   where user_id = p_user and id = p_cobranca;
  return jsonb_build_object('ok', true, 'devolvido', true, 'saldo', public.creditos_saldo(p_user));
end; $$;

-- Cobra de novo uma questão que tinha sido devolvida e acabou entregue depois
-- (ex.: a imagem falhou, o crédito voltou, e o professor clicou em "Tentar novamente"
-- na imagem). Só age sobre um pedido que já existe:
--   {ok:true, cobrado:false, sem_registro:true}   pedido desconhecido: nada a fazer
--   {ok:true, cobrado:false, saldo}               já estava cobrado
--   o mesmo retorno de creditos_cobrar             estava devolvido: cobra de novo
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

-- Adiciona créditos (Etapa 3: pagamento confirmado; ou cortesia/ajuste feito pelo dono).
-- Com origem 'compra' e uma referência já usada, não cria outro lote (aviso de pagamento repetido).
create or replace function public.creditos_adicionar(p_user uuid, p_quantidade integer, p_origem text default 'cortesia', p_referencia text default null, p_validade interval default interval '12 months')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_id bigint;
begin
  perform public.creditos_exige_servidor();
  if p_user is null or p_quantidade is null or p_quantidade <= 0 or p_origem not in ('compra', 'cortesia', 'ajuste') then
    raise exception 'creditos_adicionar: parâmetros inválidos';
  end if;
  insert into public.creditos_lotes (user_id, quantidade, restante, origem, referencia, expira_em)
  values (p_user, p_quantidade, p_quantidade, p_origem, p_referencia, now() + p_validade)
  on conflict (referencia) where origem = 'compra' and referencia is not null do nothing
  returning id into v_id;
  return jsonb_build_object('ok', true, 'lote', v_id, 'repetido', v_id is null, 'saldo', public.creditos_saldo(p_user));
end; $$;

-- ----------------------------------------------------------------------------
-- 4. Para o navegador: o próprio saldo
-- ----------------------------------------------------------------------------
create or replace function public.creditos_meu_saldo() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_login');
  end if;
  -- (as contas são feitas aqui mesmo: creditos_ilimitado e creditos_saldo recusam o navegador)
  return jsonb_build_object(
    'ok', true,
    'ilimitado', coalesce((select ilimitado from public.perfis where user_id = v_user), false),
    'saldo', coalesce((select sum(restante) from public.creditos_lotes where user_id = v_user and restante > 0 and expira_em > now()), 0)::integer,
    'proxima_validade', (select min(expira_em) from public.creditos_lotes where user_id = v_user and restante > 0 and expira_em > now())
  );
end; $$;

-- ----------------------------------------------------------------------------
-- 5. Permissões: só o servidor cobra, devolve e adiciona; o navegador só vê o saldo
-- ----------------------------------------------------------------------------
-- A recusa ao navegador está dentro das funções (creditos_exige_servidor). Aqui só se
-- garante que o servidor tem acesso, e que quem está logado pode ver o próprio saldo.
grant execute on function public.creditos_exige_servidor() to service_role;
grant execute on function public.creditos_ilimitado(uuid) to service_role;
grant execute on function public.creditos_saldo(uuid) to service_role;
grant execute on function public.creditos_entregas_por_cobranca(uuid, text) to service_role;
grant execute on function public.creditos_cobrar(uuid, text, text) to service_role;
grant execute on function public.creditos_entregue(uuid, text) to service_role;
grant execute on function public.creditos_devolver(uuid, text, text, interval) to service_role;
grant execute on function public.creditos_reconfirmar(uuid, text) to service_role;
grant execute on function public.creditos_adicionar(uuid, integer, text, text, interval) to service_role;
grant execute on function public.creditos_meu_saldo() to authenticated, service_role;
grant select on public.creditos_lotes, public.creditos_cobrancas to authenticated;
grant all on public.creditos_lotes, public.creditos_cobrancas to service_role;

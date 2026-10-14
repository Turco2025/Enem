#!/usr/bin/env bash
# v18.50: trava da cobrança em andamento (2026-10-14_trava_cobranca.sql) e permissões do banco
# (2026-10-14_permissoes_banco.sql), num Postgres LOCAL. Nunca toca no banco do site.
# 1) Aplica TODAS as migrações de créditos (pareamento, etapa 2, cotas, trava, permissões) e roda
#    tests/verify_trava_cobranca_v1850.sql.
# 2) Roda de novo os testes da Etapa 2 (verify_creditos_banco_v1846.sql) e das cotas
#    (verify_cotas_banco_v1849.sql), cada um num banco novo com todas as migrações.
# 3) Corridas: 10 pedidos ao mesmo tempo com o mesmo identificador e 1 crédito → só 1 gera;
#    10 retentativas ao mesmo tempo do mesmo pedido já cobrado → só 1 passa.
# 4) As migrações podem rodar duas vezes; as reversões voltam ao estado anterior.
#
# Uso: PGHOST=/tmp PGPORT=5499 PGUSER=postgres bash tests/verify_trava_cobranca_v1850.sh
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
P="psql -v ON_ERROR_STOP=1 -q -X"
TMP="$(mktemp -d)"
BANCOS=""
trap 'for b in $BANCOS; do $P -d postgres -c "drop database if exists $b" >/dev/null 2>&1 || true; done; rm -rf "$TMP"' EXIT
MIGRACOES="2026-09-13_a1_whatsapp_pareamento 2026-10-13_etapa2_creditos 2026-10-14_cotas_uso_gratis 2026-10-14_trava_cobranca 2026-10-14_permissoes_banco"

prepara(){
  BANCOS="$BANCOS $1"
  $P -d postgres -c "create database $1" >/dev/null
  $P -d "$1" >/dev/null <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
-- o que existe no site fora das migrações do repositório (versão mínima para o teste)
create table public.image_generation_log (id bigint generated always as identity primary key, prompt text, created_at timestamptz default now(),
  segundos integer, tokens_entrada integer, tokens_saida integer, custo_usd numeric, modelo text);
create domain public.vector as double precision[];   -- no lugar da extensão pgvector, que não há aqui
create table public.math_reference_chunks (id bigint, livro text, arquivo text, chunk_index integer, pagina_aprox integer, conteudo text, embedding public.vector);
create function public.match_math_reference_chunks(query_embedding vector, match_count integer default 6, match_threshold double precision default 0.0)
  returns table(id bigint, livro text, arquivo text, chunk_index integer, pagina_aprox integer, conteudo text, similarity double precision)
  language sql stable as $f$ select c.id, c.livro, c.arquivo, c.chunk_index, c.pagina_aprox, c.conteudo, 0::double precision from public.math_reference_chunks c limit match_count $f$;
-- o usuário 1 é o dono: a migração de pareamento marca perfis.ilimitado pelo e-mail
insert into auth.users select ('00000000-0000-0000-0000-00000000000' || i)::uuid, case when i = 1 then 'maziadh@gmail.com' else 'u' || i || '@exemplo.com' end from generate_series(1, 9) i;
SQL
  for m in $MIGRACOES; do
    $P -d "$1" -f "$RAIZ/supabase/migrations/$m.sql" >/dev/null 2>"$TMP/err_$m" || { echo "FAIL migração $m em $1"; cat "$TMP/err_$m"; exit 1; }
  done
}

DB="trava_$$"; DB2="trava_etapa2_$$"; DB3="trava_cotas_$$"; DB4="trava_reversao_$$"
prepara "$DB"; prepara "$DB2"; prepara "$DB3"; prepara "$DB4"

# as duas migrações novas podem rodar de novo sem erro
R0="PASS R0 as migrações da trava e das permissões podem rodar duas vezes"
for m in 2026-10-14_trava_cobranca 2026-10-14_permissoes_banco; do
  $P -d "$DB4" -f "$RAIZ/supabase/migrations/$m.sql" >/dev/null 2>&1 || R0="FAIL R0 $m falhou na segunda vez"
done
# reversão: volta às funções da etapa 2 e ao estado anterior das permissões
$P -d "$DB4" -f "$RAIZ/supabase/migrations/2026-10-14_permissoes_banco_rollback.sql" >/dev/null
$P -d "$DB4" -f "$RAIZ/supabase/migrations/2026-10-14_trava_cobranca_rollback.sql" >/dev/null
REV=$($P -d "$DB4" -tA -c "select (select count(*) from information_schema.columns where table_name='creditos_cobrancas' and column_name='em_andamento_ate') || '/' || (to_regprocedure('public.creditos_liberar(uuid,text)') is null)::text || '/' || (position('em_andamento' in pg_get_functiondef('public.creditos_cobrar(uuid,text,text)'::regprocedure)) = 0)::text || '/' || has_function_privilege('anon','public.creditos_meu_saldo()','EXECUTE')::text")
[ "$REV" = "0/true/true/true" ] && R1="PASS R1 as reversões voltam ao estado anterior (sem coluna, sem creditos_liberar, cobrança antiga, permissões padrão)" || R1="FAIL R1 reversão: $REV"

NOVOS="$($P -d "$DB" -f "$RAIZ/tests/verify_trava_cobranca_v1850.sql")"
ANTIGOS="$($P -d "$DB2" -f "$RAIZ/tests/verify_creditos_banco_v1846.sql")"
COTAS="$($P -d "$DB3" -f "$RAIZ/tests/verify_cotas_banco_v1849.sql")"

# G1: 10 pedidos ao mesmo tempo, mesmo identificador, 1 crédito
$P -d "$DB" -c "select creditos_adicionar('00000000-0000-0000-0000-000000000008', 1)" >/dev/null
for i in $(seq 1 10); do
  $P -d "$DB" -tA -c "select creditos_cobrar('00000000-0000-0000-0000-000000000008', 'q-corrida-001')" > "$TMP/g1_$i" &
done
wait
OK1=$(grep -h '"ok": true' "$TMP"/g1_* | wc -l); AND1=$(grep -h 'em_andamento' "$TMP"/g1_* | wc -l)
S1=$($P -d "$DB" -tA -c "select creditos_saldo('00000000-0000-0000-0000-000000000008')")
[ "$OK1" = "1" ] && [ "$AND1" = "9" ] && [ "$S1" = "0" ] && G1="PASS G1 10 pedidos ao mesmo tempo com o mesmo identificador: só 1 gera, 9 em_andamento, 1 crédito gasto" || G1="FAIL G1 corrida: ok=$OK1 em_andamento=$AND1 saldo=$S1"

# G2: pedido já cobrado e liberado (retentativa grátis): 10 retentativas ao mesmo tempo → só 1 passa
$P -d "$DB" -c "select creditos_adicionar('00000000-0000-0000-0000-000000000009', 1); select creditos_cobrar('00000000-0000-0000-0000-000000000009', 'q-corrida-002'); select creditos_liberar('00000000-0000-0000-0000-000000000009', 'q-corrida-002')" >/dev/null
for i in $(seq 1 10); do
  $P -d "$DB" -tA -c "select creditos_cobrar('00000000-0000-0000-0000-000000000009', 'q-corrida-002')" > "$TMP/g2_$i" &
done
wait
OK2=$(grep -h '"ok": true' "$TMP"/g2_* | wc -l); AND2=$(grep -h 'em_andamento' "$TMP"/g2_* | wc -l)
[ "$OK2" = "1" ] && [ "$AND2" = "9" ] && G2="PASS G2 10 retentativas ao mesmo tempo do mesmo pedido: só 1 passa, 9 em_andamento" || G2="FAIL G2 corrida: ok=$OK2 em_andamento=$AND2"

echo "== migrações"; echo "$R0"; echo "$R1"
echo "== trava, wa- e permissões (novos)"; echo "$NOVOS" | grep -E '^(PASS|FAIL)'; echo "$G1"; echo "$G2"
echo "== Etapa 2 (testes antigos, com todas as migrações)"; echo "$ANTIGOS" | grep -E '^(PASS|FAIL)'
echo "== cotas v18.49 (com todas as migrações)"; echo "$COTAS" | grep -E '^(PASS|FAIL)'
TODOS="$(printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$R0" "$R1" "$NOVOS" "$G1" "$G2" "$ANTIGOS" "$COTAS")"
PASSOU=$(echo "$TODOS" | grep -c '^PASS' || true); FALHOU=$(echo "$TODOS" | grep -c '^FAIL' || true)
echo; echo "$PASSOU verificações passaram, $FALHOU falharam"
[ "$FALHOU" = "0" ]

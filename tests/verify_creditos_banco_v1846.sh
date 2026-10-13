#!/usr/bin/env bash
# v18.46 — Etapa 2 (créditos): testa as tabelas e funções do banco num Postgres LOCAL.
# Cria um banco temporário, simula o mínimo do Supabase, aplica as migrações e roda
# tests/verify_creditos_banco_v1846.sql. Também testa duas cobranças ao mesmo tempo
# com 1 crédito só (só uma pode passar). Nunca toca no banco do site.
#
# Uso: PGHOST=/tmp PGPORT=5499 PGUSER=postgres bash tests/verify_creditos_banco_v1846.sh
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
DB="creditos_teste_$$"
P="psql -v ON_ERROR_STOP=1 -q -X"
$P -d postgres -c "create database $DB" >/dev/null
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
$P -d "$DB" >/dev/null <<'SQL'
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
-- como no Supabase: tudo o que é criado em public já nasce liberado para os três papéis da API
-- (a proteção dos créditos não depende de permissões retiradas; ela está nas funções e na RLS)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
insert into auth.users values
 ('00000000-0000-0000-0000-000000000001', 'maziadh@gmail.com'),
 ('00000000-0000-0000-0000-000000000002', 'aluno@exemplo.com'),
 ('00000000-0000-0000-0000-000000000003', 'outro@exemplo.com'),
 ('00000000-0000-0000-0000-000000000004', 'corrida@exemplo.com'),
 ('00000000-0000-0000-0000-000000000005', 'quinto@exemplo.com'),
 ('00000000-0000-0000-0000-000000000006', 'sexto@exemplo.com'),
 ('00000000-0000-0000-0000-000000000007', 'setimo@exemplo.com');
SQL
$P -d "$DB" -f "$RAIZ/supabase/migrations/2026-09-13_a1_whatsapp_pareamento.sql" >/dev/null 2>&1
$P -d "$DB" -f "$RAIZ/supabase/migrations/2026-10-13_etapa2_creditos.sql" >/dev/null 2>&1
SAIDA="$($P -d "$DB" -f "$RAIZ/tests/verify_creditos_banco_v1846.sql")"

# G. corrida: 1 crédito e 10 cobranças diferentes ao mesmo tempo → só 1 cobra
$P -d "$DB" -c "select creditos_adicionar('00000000-0000-0000-0000-000000000004', 1)" >/dev/null
for i in $(seq 1 10); do
  $P -d "$DB" -tA -c "select creditos_cobrar('00000000-0000-0000-0000-000000000004', 'corrida-000$i')->>'cobrado'" > "/tmp/corrida_$$_$i" &
done
wait
COBRADAS=$(cat /tmp/corrida_$$_* | grep -c true || true); rm -f /tmp/corrida_$$_*
RESTANTE=$($P -d "$DB" -tA -c "select creditos_saldo('00000000-0000-0000-0000-000000000004')")
if [ "$COBRADAS" = "1" ] && [ "$RESTANTE" = "0" ]; then G="PASS G 10 cobranças ao mesmo tempo com 1 crédito: só 1 passa, saldo 0"; else G="FAIL G corrida: $COBRADAS cobradas, saldo $RESTANTE"; fi

echo "$SAIDA" | grep -E '^(PASS|FAIL)'
echo "$G"
PASSOU=$(echo "$SAIDA" | grep -c '^PASS' || true); FALHOU=$(echo "$SAIDA" | grep -c '^FAIL' || true)
case "$G" in PASS*) PASSOU=$((PASSOU+1));; *) FALHOU=$((FALHOU+1));; esac
echo; echo "$PASSOU verificações passaram, $FALHOU falharam"
[ "$FALHOU" = "0" ]

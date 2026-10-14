#!/usr/bin/env bash
# v18.49: Cotas do uso grátis: testa a migração 2026-10-14_cotas_uso_gratis.sql num Postgres LOCAL.
# 1) Aplica as migrações (pareamento, créditos e cotas) e roda tests/verify_cotas_banco_v1849.sql.
# 2) Roda de novo TODOS os testes da Etapa 2 (verify_creditos_banco_v1846.sql) com a migração
#    nova aplicada: nada do que já funcionava pode mudar.
# 3) Corridas: 30 pedidos de imagem ao mesmo tempo na mesma questão → só 12 passam; 40 pedidos
#    ao mesmo tempo na cota do dia → só 20 passam.
# Nunca toca no banco do site.
#
# Uso: PGHOST=/tmp PGPORT=5499 PGUSER=postgres bash tests/verify_cotas_banco_v1849.sh
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
DB="cotas_teste_$$"
DB2="cotas_antigos_$$"
P="psql -v ON_ERROR_STOP=1 -q -X"
TMP="$(mktemp -d)"
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; $P -d postgres -c "drop database if exists $DB2" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

# Monta um banco de teste: simulação mínima do Supabase + as três migrações.
prepara(){
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
-- como no Supabase: tudo o que é criado em public já nasce liberado para os três papéis da API
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
-- a tabela de log de imagens existe no site (fora das migrações do repositório)
create table public.image_generation_log (id bigint generated always as identity primary key, prompt text, created_at timestamptz default now(),
  segundos integer, tokens_entrada integer, tokens_saida integer, custo_usd numeric, modelo text);
insert into auth.users values
 ('00000000-0000-0000-0000-000000000001', 'maziadh@gmail.com'),
 ('00000000-0000-0000-0000-000000000002', 'aluno@exemplo.com'),
 ('00000000-0000-0000-0000-000000000003', 'outro@exemplo.com'),
 ('00000000-0000-0000-0000-000000000004', 'corrida@exemplo.com'),
 ('00000000-0000-0000-0000-000000000005', 'quinto@exemplo.com'),
 ('00000000-0000-0000-0000-000000000006', 'sexto@exemplo.com'),
 ('00000000-0000-0000-0000-000000000007', 'setimo@exemplo.com'),
 ('00000000-0000-0000-0000-000000000008', 'oitavo@exemplo.com'),
 ('00000000-0000-0000-0000-000000000009', 'nono@exemplo.com');
SQL
  $P -d "$1" -f "$RAIZ/supabase/migrations/2026-09-13_a1_whatsapp_pareamento.sql" >/dev/null 2>&1
  $P -d "$1" -f "$RAIZ/supabase/migrations/2026-10-13_etapa2_creditos.sql" >/dev/null 2>&1
  $P -d "$1" -f "$RAIZ/supabase/migrations/2026-10-14_cotas_uso_gratis.sql" >/dev/null
}
prepara "$DB"
prepara "$DB2"
# a migração pode rodar duas vezes sem erro (if not exists / or replace)
$P -d "$DB" -f "$RAIZ/supabase/migrations/2026-10-14_cotas_uso_gratis.sql" >/dev/null && R0="PASS R0 a migração pode ser aplicada duas vezes sem erro" || R0="FAIL R0 a migração falhou na segunda vez"
COL=$($P -d "$DB" -tA -c "select count(*) from information_schema.columns where table_schema='public' and table_name='image_generation_log' and column_name='user_id'")
[ "$COL" = "1" ] && R1="PASS R1 image_generation_log ganhou a coluna user_id" || R1="FAIL R1 image_generation_log sem user_id"

NOVOS="$($P -d "$DB" -f "$RAIZ/tests/verify_cotas_banco_v1849.sql")"
ANTIGOS="$($P -d "$DB2" -f "$RAIZ/tests/verify_creditos_banco_v1846.sql")"

# corrida 1: 30 imagens ao mesmo tempo na mesma questão cobrada (conta sem saldo depois da cobrança)
$P -d "$DB" -c "select creditos_adicionar('00000000-0000-0000-0000-000000000008', 1); select creditos_cobrar('00000000-0000-0000-0000-000000000008', 'q-corrida-01')" >/dev/null
for i in $(seq 1 30); do
  $P -d "$DB" -tA -c "select creditos_uso_gratis('00000000-0000-0000-0000-000000000008', 'imagem', 'q-corrida-01')->>'ok'" > "$TMP/a_$i" &
done
wait
OK1=$(cat "$TMP"/a_* | grep -c true || true)
CONT1=$($P -d "$DB" -tA -c "select imagens from creditos_cobrancas where user_id = '00000000-0000-0000-0000-000000000008' and id = 'q-corrida-01'")
[ "$OK1" = "12" ] && [ "$CONT1" = "12" ] && G1="PASS G1 30 imagens ao mesmo tempo na mesma questão: só 12 passam (contador 12)" || G1="FAIL G1 corrida da questão: $OK1 passaram, contador $CONT1"

# corrida 2: 40 imagens ao mesmo tempo na cota do dia (conta com saldo, sem questão)
$P -d "$DB" -c "select creditos_adicionar('00000000-0000-0000-0000-000000000009', 5)" >/dev/null
for i in $(seq 1 40); do
  $P -d "$DB" -tA -c "select creditos_uso_gratis('00000000-0000-0000-0000-000000000009', 'imagem')->>'ok'" > "$TMP/b_$i" &
done
wait
OK2=$(cat "$TMP"/b_* | grep -c true || true)
CONT2=$($P -d "$DB" -tA -c "select usos from creditos_uso_diario where user_id = '00000000-0000-0000-0000-000000000009' and tipo = 'imagem'")
[ "$OK2" = "20" ] && [ "$CONT2" = "20" ] && G2="PASS G2 40 imagens ao mesmo tempo na cota do dia: só 20 passam (contador 20)" || G2="FAIL G2 corrida do dia: $OK2 passaram, contador $CONT2"

echo "== migração"; echo "$R0"; echo "$R1"
echo "== cotas (novos)"; echo "$NOVOS" | grep -E '^(PASS|FAIL)'
echo "$G1"; echo "$G2"
echo "== créditos da Etapa 2 (todos os testes antigos, com a migração nova aplicada)"; echo "$ANTIGOS" | grep -E '^(PASS|FAIL)'
TODOS="$(printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$R0" "$R1" "$NOVOS" "$G1" "$G2" "$ANTIGOS")"
PASSOU=$(echo "$TODOS" | grep -c '^PASS' || true); FALHOU=$(echo "$TODOS" | grep -c '^FAIL' || true)
echo; echo "$PASSOU verificações passaram, $FALHOU falharam"
[ "$FALHOU" = "0" ]

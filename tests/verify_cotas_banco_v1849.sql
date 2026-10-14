-- v18.49: Cotas do uso grátis (verificação de segurança de 13/10/2026): testes do banco.
-- Roda num Postgres LOCAL (nunca no banco do site), depois da simulação mínima do Supabase e
-- das migrações 2026-09-13_a1_whatsapp_pareamento.sql, 2026-10-13_etapa2_creditos.sql e
-- 2026-10-14_cotas_uso_gratis.sql. Ver tests/verify_cotas_banco_v1849.sh.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned

create temp table r(n serial, ok boolean, msg text);
grant all on r to public; grant all on sequence r_n_seq to public;
create or replace function pg_temp.chk(c boolean, m text) returns void language sql as $$ insert into r(ok, msg) values (coalesce(c, false), m) $$;

-- 1 = dono (ilimitado), 2 = sem créditos, 3 = 1 crédito, 5 = outra conta, 6 = com saldo (cota do dia)
\set dono '''00000000-0000-0000-0000-000000000001'''
\set zero '''00000000-0000-0000-0000-000000000002'''
\set um '''00000000-0000-0000-0000-000000000003'''
\set outro '''00000000-0000-0000-0000-000000000005'''
\set rico '''00000000-0000-0000-0000-000000000006'''

-- A. dono e conta sem créditos
select creditos_uso_gratis(:dono, 'imagem') as r1, creditos_uso_gratis(:dono, 'planejar') as r2 \gset a1_
select pg_temp.chk(:'a1_r1'::jsonb @> '{"ok":true,"ilimitado":true}'
  and :'a1_r2'::jsonb @> '{"ok":true,"ilimitado":true}'
  and not exists (select 1 from creditos_uso_diario where user_id = :dono), 'A1 dono: sempre pode, sem contar nada');
select creditos_uso_gratis(:zero, 'imagem') as r1, creditos_uso_gratis(:zero, 'visual') as r2, creditos_uso_gratis(:zero, 'planejar') as r3 \gset a2_
select pg_temp.chk(:'a2_r1'::jsonb @> '{"ok":false,"motivo":"sem_creditos","limite_questao":false}'
  and :'a2_r2'::jsonb @> '{"ok":false,"motivo":"sem_creditos"}'
  and :'a2_r3'::jsonb @> '{"ok":false,"motivo":"sem_creditos"}'
  and not exists (select 1 from creditos_uso_diario where user_id = :zero), 'A2 conta sem créditos e sem questão cobrada: recusa imagem, refazer e planejar (o ataque da verificação)');
select pg_temp.chk(creditos_uso_gratis(:zero, 'imagem', 'q-inventado-01') @> '{"ok":false,"motivo":"sem_creditos"}', 'A3 identificador inventado não abre a cota');

-- B. questão cobrada: cota da própria questão
select creditos_adicionar(:um, 1);
select pg_temp.chk(creditos_cobrar(:um, 'q-cota-0001') @> '{"cobrado":true,"saldo":0}', 'B0 a questão é cobrada e o saldo zera');
do $$ declare i int; ok int := 0; begin
  for i in 1..12 loop if (creditos_uso_gratis('00000000-0000-0000-0000-000000000003', 'imagem', 'q-cota-0001') @> '{"ok":true,"por":"questao"}') then ok := ok + 1; end if; end loop;
  insert into r(ok, msg) values (ok = 12, 'B1 até 12 imagens pela questão cobrada, mesmo com saldo zero (' || ok || ')');
end $$;
select pg_temp.chk(creditos_uso_gratis(:um, 'imagem', 'q-cota-0001') @> '{"ok":false,"motivo":"sem_creditos","limite_questao":true}', 'B2 a 13ª imagem da mesma questão é recusada (sem saldo para a cota do dia)');
do $$ declare i int; ok int := 0; begin
  for i in 1..8 loop if (creditos_uso_gratis('00000000-0000-0000-0000-000000000003', 'visual', 'q-cota-0001') @> '{"ok":true,"por":"questao"}') then ok := ok + 1; end if; end loop;
  insert into r(ok, msg) values (ok = 8, 'B3 até 8 "refazer" pela questão cobrada, contados à parte das imagens (' || ok || ')');
end $$;
select pg_temp.chk(creditos_uso_gratis(:um, 'visual', 'q-cota-0001') @> '{"ok":false}', 'B4 o 9º "refazer" da mesma questão é recusado');
select pg_temp.chk(creditos_uso_gratis(:um, 'planejar', 'q-cota-0001') @> '{"ok":false,"motivo":"sem_creditos"}', 'B5 planejar recortes nunca usa a cota da questão');
select pg_temp.chk((select usos_vez || '/' || imagens || '/' || visuais from creditos_cobrancas where user_id = :um and id = 'q-cota-0001') = '1/12/8', 'B6 contadores gravados na cobrança (vez 1, 12 imagens, 8 refazer)');

-- C. cobrança de outra conta, devolvida, antiga, e cobrada de novo
select creditos_adicionar(:outro, 3);
select creditos_cobrar(:outro, 'q-outra-0001');
select creditos_uso_gratis(:zero, 'imagem', 'q-outra-0001') as res \gset c1_
select pg_temp.chk(:'c1_res'::jsonb @> '{"ok":false,"motivo":"sem_creditos"}'
  and (select imagens from creditos_cobrancas where user_id = :outro and id = 'q-outra-0001') = 0, 'C1 a cobrança de outra conta não serve (e não é tocada)');
select creditos_devolver(:um, 'q-cota-0001', 'imagem falhou');
select creditos_uso_gratis(:um, 'imagem', 'q-cota-0001') as res \gset c2_
select pg_temp.chk(not (:'c2_res'::jsonb @> '{"por":"questao"}')
  and (select imagens from creditos_cobrancas where user_id = :um and id = 'q-cota-0001') = 12, 'C2 questão devolvida não dá cota da questão (com o crédito de volta no saldo, conta na cota do dia)');
select creditos_adicionar(:um, 1);
select creditos_reconfirmar(:um, 'q-cota-0001') as res \gset c3_
select pg_temp.chk(:'c3_res'::jsonb @> '{"ok":true,"cobrado":true}'
  and (select vezes from creditos_cobrancas where user_id = :um and id = 'q-cota-0001') = 2, 'C3 "Tentar novamente": a questão é cobrada de novo (vezes 2)');
select creditos_uso_gratis(:um, 'imagem', 'q-cota-0001') as res \gset c4_
select pg_temp.chk(:'c4_res'::jsonb @> '{"ok":true,"por":"questao"}'
  and (select usos_vez || '/' || imagens || '/' || visuais from creditos_cobrancas where user_id = :um and id = 'q-cota-0001') = '2/1/0', 'C4 a cota recomeça na nova cobrança (vez 2: 1 imagem, 0 refazer)');
select creditos_cobrar(:outro, 'q-outra-0002');
update creditos_cobrancas set cobrado_em = now() - interval '31 days' where user_id = :outro and id = 'q-outra-0002';
select creditos_uso_gratis(:outro, 'imagem', 'q-outra-0002') as res \gset c5_
select pg_temp.chk(:'c5_res'::jsonb @> '{"ok":true,"por":"dia"}'
  and (select imagens from creditos_cobrancas where user_id = :outro and id = 'q-outra-0002') = 0, 'C5 cobrança de mais de 30 dias não conta; com saldo, vai para a cota do dia');

-- D. cota do dia (conta com saldo, sem questão cobrada: simulado antigo, planejar recortes)
select creditos_adicionar(:rico, 50, 'compra', 'pg-teste-1');
do $$ declare i int; ok int := 0; begin
  for i in 1..20 loop if (creditos_uso_gratis('00000000-0000-0000-0000-000000000006', 'imagem') @> '{"ok":true,"por":"dia"}') then ok := ok + 1; end if; end loop;
  insert into r(ok, msg) values (ok = 20, 'D1 com saldo: 20 imagens por dia sem questão cobrada (' || ok || ')');
end $$;
select pg_temp.chk(creditos_uso_gratis(:rico, 'imagem') @> '{"ok":false,"motivo":"limite_diario","limite":20}', 'D2 a 21ª imagem do dia é recusada (limite_diario)');
do $$ declare i int; ok int := 0; begin
  for i in 1..30 loop if (creditos_uso_gratis('00000000-0000-0000-0000-000000000006', 'planejar') @> '{"ok":true}') then ok := ok + 1; end if; end loop;
  insert into r(ok, msg) values (ok = 30 and (creditos_uso_gratis('00000000-0000-0000-0000-000000000006', 'planejar') @> '{"ok":false,"motivo":"limite_diario"}'), 'D3 planejar recortes: 30 por dia, o 31º é recusado');
end $$;
select pg_temp.chk(creditos_uso_gratis(:rico, 'visual') @> '{"ok":true,"por":"dia","usos":1}', 'D4 cada tipo tem a sua cota do dia');
select pg_temp.chk(creditos_saldo(:rico) = 50, 'D5 o uso grátis não gasta crédito');
update creditos_uso_diario set dia = dia - 1 where user_id = :rico;
select pg_temp.chk(creditos_uso_gratis(:rico, 'imagem') @> '{"ok":true,"por":"dia","usos":1}', 'D6 no dia seguinte a cota recomeça');

-- E. parâmetros
do $$ begin perform creditos_uso_gratis('00000000-0000-0000-0000-000000000006', 'video'); raise exception 'devia falhar'; exception when others then
  if sqlerrm = 'devia falhar' then raise; end if; insert into r(ok, msg) values (true, 'E1 tipo desconhecido é recusado'); end $$;
do $$ begin perform creditos_uso_gratis(null, 'imagem'); raise exception 'devia falhar'; exception when others then
  if sqlerrm = 'devia falhar' then raise; end if; insert into r(ok, msg) values (true, 'E2 sem usuário é recusado'); end $$;

-- F. o navegador (logado ou visitante) não chama a função nem vê a tabela
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
set role authenticated;
do $$ begin perform creditos_uso_gratis('00000000-0000-0000-0000-000000000006', 'imagem'); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'F1 logado não chama creditos_uso_gratis pelo banco'); end $$;
do $$ begin perform 1 from creditos_uso_diario; raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'F2 logado não lê creditos_uso_diario'); end $$;
do $$ begin insert into creditos_uso_diario values ('00000000-0000-0000-0000-000000000006', current_date, 'imagem', 0); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'F3 logado não grava creditos_uso_diario'); end $$;
do $$ declare n int; begin update creditos_cobrancas set imagens = 0, visuais = 0; get diagnostics n = row_count; insert into r(ok, msg) values (n = 0, 'F4 logado não zera os contadores da cobrança'); end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$ begin perform creditos_uso_gratis('00000000-0000-0000-0000-000000000006', 'imagem'); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'F5 visitante não chama creditos_uso_gratis'); end $$;
reset role;
set role service_role;
select pg_temp.chk(creditos_uso_gratis('00000000-0000-0000-0000-000000000006', 'visual') @> '{"ok":true}', 'F6 o servidor (service_role) chama');
reset role;

select (case when ok then 'PASS ' else 'FAIL ' end) || msg from r order by n;
select '' ;
select count(*) filter (where ok) || ' verificações passaram, ' || count(*) filter (where not ok) || ' falharam' from r;

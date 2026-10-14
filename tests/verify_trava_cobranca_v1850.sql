-- v18.50: trava da cobrança em andamento, entrega grátis do wa- e permissões (testes do banco).
-- Roda num Postgres LOCAL (nunca no banco do site), com todas as migrações aplicadas.
-- Ver tests/verify_trava_cobranca_v1850.sh.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned

create temp table r(n serial, ok boolean, msg text);
grant all on r to public; grant all on sequence r_n_seq to public;
create or replace function pg_temp.chk(c boolean, m text) returns void language sql as $$ insert into r(ok, msg) values (coalesce(c, false), m) $$;

\set dono '''00000000-0000-0000-0000-000000000001'''
\set um '''00000000-0000-0000-0000-000000000002'''
\set prof '''00000000-0000-0000-0000-000000000003'''
\set wa '''00000000-0000-0000-0000-000000000005'''
\set outro '''00000000-0000-0000-0000-000000000006'''

-- T. trava da cobrança em andamento
select creditos_adicionar(:um, 1);
select creditos_cobrar(:um, 'q-trava-0001') as res \gset t1_
select pg_temp.chk(:'t1_res'::jsonb @> '{"ok":true,"cobrado":true,"saldo":0}'
  and (select em_andamento_ate > now() + interval '140 seconds' and em_andamento_ate <= now() + interval '150 seconds' from creditos_cobrancas where user_id = :um and id = 'q-trava-0001'),
  'T1 a cobrança fica "em andamento" por 150 segundos');
select creditos_cobrar(:um, 'q-trava-0001') as res \gset t2_
select pg_temp.chk(:'t2_res'::jsonb @> '{"ok":false,"motivo":"em_andamento"}' and creditos_saldo(:um) = 0
  and (select entregas from creditos_cobrancas where user_id = :um and id = 'q-trava-0001') = 0,
  'T2 o mesmo identificador durante a geração: recusado (em_andamento), sem cobrar e sem gerar');
select creditos_entregue(:um, 'q-trava-0001');
select pg_temp.chk((select em_andamento_ate is null and entregas = 1 from creditos_cobrancas where user_id = :um and id = 'q-trava-0001'),
  'T3 a entrega libera a trava');
select pg_temp.chk(creditos_cobrar(:um, 'q-trava-0001') @> '{"ok":false,"motivo":"sem_creditos"}',
  'T4 depois da entrega, o mesmo identificador é questão nova (sem saldo: recusado)');

select creditos_adicionar(:prof, 5);
select creditos_cobrar(:prof, 'q-trava-0002');
select creditos_devolver(:prof, 'q-trava-0002', 'servidor: HTTP 502');
select pg_temp.chk((select em_andamento_ate is null and estado = 'devolvido' from creditos_cobrancas where user_id = :prof and id = 'q-trava-0002'),
  'T5 a devolução libera a trava');
select creditos_reconfirmar(:prof, 'q-trava-0002') as res \gset t6_
select pg_temp.chk(:'t6_res'::jsonb @> '{"ok":true,"cobrado":true}'
  and (select em_andamento_ate is null and entregas = 1 and vezes = 2 from creditos_cobrancas where user_id = :prof and id = 'q-trava-0002'),
  'T6 "Tentar novamente" na imagem cobra de novo e não deixa trava (nenhuma geração vem depois)');

select creditos_cobrar(:prof, 'q-trava-0003');
select creditos_liberar(:prof, 'q-trava-0003');
select creditos_cobrar(:prof, 'q-trava-0003') as res \gset t7_
select pg_temp.chk(:'t7_res'::jsonb @> '{"ok":true,"cobrado":false}'
  and (select em_andamento_ate is not null and vezes = 1 from creditos_cobrancas where user_id = :prof and id = 'q-trava-0003'),
  'T7 retentativa depois da liberação: não cobra de novo e volta a travar');
update creditos_cobrancas set em_andamento_ate = now() - interval '1 second' where user_id = :prof and id = 'q-trava-0003';
select pg_temp.chk(creditos_cobrar(:prof, 'q-trava-0003') @> '{"ok":true,"cobrado":false}',
  'T8 trava vencida (worker encerrado no meio): a retentativa passa sem cobrar');
select pg_temp.chk(creditos_cobrar(:dono, 'q-trava-0004') @> '{"ok":true,"ilimitado":true}'
  and creditos_cobrar(:dono, 'q-trava-0004') @> '{"ok":true,"ilimitado":true}',
  'T9 conta do dono: sem trava e sem cobrança');

-- W. entrega grátis do wa- ligada às tentativas do robô
select creditos_adicionar(:wa, 10);
insert into wa_trabalhos (id, user_id, telefone, parametros, status, progresso) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', :wa, '5500000000009', '{"quantidade": 5}', 'gerando', '{"tentativas": 1}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', :wa, '5500000000009', '{"quantidade": 5}', 'gerando', '{"tentativas": 2}'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', :wa, '5500000000009', '{"quantidade": 5}', 'gerando', '{"tentativas": 7}'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', :wa, '5500000000009', '{"quantidade": 5}', 'gerando', '{}'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', :wa, '5500000000009', '{"quantidade": 5}', 'gerando', '{"tentativas": "x"}');
select pg_temp.chk(creditos_entregas_por_cobranca(:wa, 'wa-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-1') = 1
  and creditos_entregas_por_cobranca(:wa, 'wa-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb-1') = 2
  and creditos_entregas_por_cobranca(:wa, 'wa-cccccccc-cccc-4ccc-8ccc-cccccccccccc-1') = 3
  and creditos_entregas_por_cobranca(:wa, 'wa-dddddddd-dddd-4ddd-8ddd-dddddddddddd-1') = 1
  and creditos_entregas_por_cobranca(:wa, 'wa-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee-1') = 1,
  'W1 entregas grátis = tentativas do robô (1, 2, máx. 3; sem número = 1)');
select pg_temp.chk(creditos_entregas_por_cobranca(:outro, 'wa-cccccccc-cccc-4ccc-8ccc-cccccccccccc-1') = 1,
  'W2 pedido de outra conta: 1 entrega');
-- o ataque da auditoria: na 1ª tentativa do robô, o professor pede 3 vezes o mesmo wa- pelo app
do $$ declare i int; begin
  for i in 1..3 loop
    perform creditos_cobrar('00000000-0000-0000-0000-000000000005', 'wa-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-2');
    perform creditos_entregue('00000000-0000-0000-0000-000000000005', 'wa-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-2');
  end loop;
end $$;
select pg_temp.chk(creditos_saldo(:wa) = 7, 'W3 na 1ª tentativa do robô, 3 questões com o mesmo wa- custam 3 créditos (antes: 1)');
-- o robô de verdade: 2ª tentativa refaz a questão sem cobrar de novo
select creditos_cobrar(:wa, 'wa-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb-1');
select creditos_entregue(:wa, 'wa-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb-1');
select creditos_cobrar(:wa, 'wa-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb-1') as res \gset w4_
select pg_temp.chk(:'w4_res'::jsonb @> '{"ok":true,"cobrado":false}' and creditos_saldo(:wa) = 6,
  'W4 robô na 2ª tentativa: refazer a questão não cobra de novo');

-- P. permissões (navegador)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
set role authenticated;
do $$ begin perform creditos_liberar('00000000-0000-0000-0000-000000000003', 'q-trava-0003'); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'P1 logado não chama creditos_liberar'); end $$;
do $$ begin perform creditos_cobrar('00000000-0000-0000-0000-000000000003', 'q-trava-0009'); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'P2 logado não chama creditos_cobrar (permissão retirada)'); end $$;
select pg_temp.chk(creditos_meu_saldo() @> '{"ok":true}', 'P3 logado continua vendo o próprio saldo');
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$ begin perform creditos_meu_saldo(); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'P4 visitante não chama creditos_meu_saldo'); end $$;
do $$ begin perform creditos_adicionar('00000000-0000-0000-0000-000000000003', 100); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'P5 visitante não se dá créditos'); end $$;
reset role;
select pg_temp.chk(not has_function_privilege('anon', 'public.creditos_cobrar(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.creditos_adicionar(uuid,integer,text,text,interval)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.creditos_cobrar(uuid,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.creditos_liberar(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.match_math_reference_chunks(vector,integer,double precision)', 'EXECUTE')
  and (select proconfig::text from pg_proc where oid = 'public.match_math_reference_chunks(vector,integer,double precision)'::regprocedure) like '%search_path=public, pg_temp%',
  'P6 permissões: só o servidor chama as funções de crédito; busca do revisor com search_path fixo');
set role service_role;
select pg_temp.chk(creditos_cobrar('00000000-0000-0000-0000-000000000003', 'srv-trava-001') @> '{"ok":true}'
  and creditos_liberar('00000000-0000-0000-0000-000000000003', 'srv-trava-001') @> '{"ok":true}', 'P7 o servidor (service_role) cobra e libera');
reset role;

select (case when ok then 'PASS ' else 'FAIL ' end) || msg from r order by n;
select '' ;
select count(*) filter (where ok) || ' verificações passaram, ' || count(*) filter (where not ok) || ' falharam' from r;

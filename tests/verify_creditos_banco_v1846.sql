-- v18.46 — Etapa 2 (créditos): testes das tabelas e funções do banco.
-- Roda num Postgres LOCAL (nunca no banco do site), depois de criar uma simulação
-- mínima do Supabase (papéis anon/authenticated/service_role, auth.users e auth.uid())
-- e aplicar as migrações 2026-09-13_a1_whatsapp_pareamento.sql e
-- 2026-10-13_etapa2_creditos.sql. Ver tests/verify_creditos_banco_v1846.sh.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned

create temp table r(n serial, ok boolean, msg text);
grant all on r to public; grant all on sequence r_n_seq to public;
create or replace function pg_temp.chk(c boolean, m text) returns void language sql as $$ insert into r(ok, msg) values (coalesce(c, false), m) $$;

-- usuários da simulação: 1 = dono (ilimitado), 2 = aluno, 3 = outro, 5 a 7 (4 fica para a corrida, no .sh)
\set dono '''00000000-0000-0000-0000-000000000001'''
\set aluno '''00000000-0000-0000-0000-000000000002'''
\set outro '''00000000-0000-0000-0000-000000000003'''
\set quinto '''00000000-0000-0000-0000-000000000005'''
\set sexto '''00000000-0000-0000-0000-000000000006'''
\set setimo '''00000000-0000-0000-0000-000000000007'''

-- A. conta sem limite e conta sem créditos
select pg_temp.chk((creditos_cobrar(:dono, 'dono-0000001')->>'ilimitado')::boolean
  and not exists (select 1 from creditos_cobrancas where user_id = :dono), 'A1 dono: gera sem gastar crédito e sem registro de cobrança');
select pg_temp.chk((creditos_cobrar(:aluno, 'q-00000001')->>'ok')::boolean = false
  and creditos_cobrar(:aluno, 'q-00000001')->>'motivo' = 'sem_creditos'
  and not exists (select 1 from creditos_cobrancas where user_id = :aluno), 'A2 sem créditos: recusa e não registra cobrança');

-- B. cobrança, retentativa, devolução
select pg_temp.chk((creditos_adicionar(:aluno, 2, 'cortesia')->>'saldo')::int = 2, 'B1 adicionar 2 créditos: saldo 2');
select pg_temp.chk(creditos_cobrar(:aluno, 'q-00000001') @> '{"ok":true,"cobrado":true,"saldo":1}', 'B2 primeira questão: cobra 1, saldo 1');
select pg_temp.chk(creditos_cobrar(:aluno, 'q-00000001') @> '{"ok":true,"cobrado":false,"saldo":1}', 'B3 retentativa do mesmo pedido: não cobra de novo');
select pg_temp.chk(creditos_devolver(:aluno, 'q-00000001', 'erro_servidor') @> '{"devolvido":true,"saldo":2}', 'B4 erro: devolve, saldo 2');
select pg_temp.chk(creditos_devolver(:aluno, 'q-00000001', 'erro_servidor') @> '{"devolvido":false,"saldo":2}', 'B5 devolver de novo não dá crédito a mais');
select creditos_cobrar(:aluno, 'q-00000001', 'refazer') as res \gset b6_
select pg_temp.chk(:'b6_res'::jsonb @> '{"cobrado":true,"saldo":1}'
  and (select vezes from creditos_cobrancas where user_id = :aluno and id = 'q-00000001') = 2, 'B6 pedido devolvido e pedido de novo: cobra outra vez (vezes = 2)');
select pg_temp.chk(creditos_cobrar(:aluno, 'q-00000002', 'refazer') @> '{"cobrado":true,"saldo":0}', 'B7 refazer: cobra 1');
select pg_temp.chk(creditos_cobrar(:aluno, 'q-00000003') @> '{"ok":false,"motivo":"sem_creditos","saldo":0}', 'B8 saldo zero: recusa');
select pg_temp.chk((select motivo from creditos_cobrancas where user_id = :aluno and id = 'q-00000002') = 'refazer', 'B9 motivo "refazer" registrado');

-- C. validade e ordem dos lotes
select pg_temp.chk((creditos_adicionar(:aluno, 5, 'cortesia', null, interval '-1 day')->>'saldo')::int = 0, 'C1 lote vencido não entra no saldo');
select creditos_adicionar(:aluno, 3, 'cortesia', 'lote-longo', interval '12 months');
select creditos_adicionar(:aluno, 1, 'cortesia', 'lote-curto', interval '1 month');
select creditos_cobrar(:aluno, 'q-00000004') as res \gset c2_
select pg_temp.chk(:'c2_res'::jsonb @> '{"cobrado":true,"saldo":3}'
  and (select l.referencia from creditos_cobrancas c join creditos_lotes l on l.id = c.lote_id where c.user_id = :aluno and c.id = 'q-00000004') = 'lote-curto',
  'C2 usa primeiro o lote que vence antes');
select pg_temp.chk(creditos_cobrar(:aluno, 'q-00000005') @> '{"cobrado":true,"saldo":2}', 'C3 depois passa para o lote seguinte');
select creditos_devolver(:aluno, 'q-00000004', 'teste') as res \gset c4_
select pg_temp.chk(:'c4_res'::jsonb @> '{"devolvido":true,"saldo":3}'
  and (select restante from creditos_lotes where referencia = 'lote-curto') = 1, 'C4 a devolução volta para o mesmo lote');

-- D. prazo da devolução pedida pelo app
update creditos_cobrancas set cobrado_em = now() - interval '3 hours' where user_id = :aluno and id = 'q-00000005';
select pg_temp.chk(creditos_devolver(:aluno, 'q-00000005', 'app', interval '2 hours') @> '{"ok":false,"motivo":"fora_do_prazo"}', 'D1 devolução pelo app só até 2 horas depois');
select pg_temp.chk(creditos_devolver(:aluno, 'q-00000005', 'servidor') @> '{"devolvido":true}', 'D2 o servidor (sem prazo) ainda pode devolver');

-- E. compra repetida (Etapa 3) e contas separadas
select pg_temp.chk(creditos_adicionar(:outro, 50, 'compra', 'pagamento-123') @> '{"repetido":false,"saldo":50}', 'E1 compra: lote de 50');
select pg_temp.chk(creditos_adicionar(:outro, 50, 'compra', 'pagamento-123') @> '{"repetido":true,"saldo":50}', 'E2 o mesmo pagamento avisado duas vezes não vira dois lotes');
select creditos_cobrar(:outro, 'q-00000001') as res \gset e3_
select pg_temp.chk(:'e3_res'::jsonb @> '{"cobrado":true,"saldo":49}'
  and (select estado from creditos_cobrancas where user_id = :aluno and id = 'q-00000001') = 'cobrado', 'E3 o mesmo identificador em outra conta é outra cobrança');
do $$ begin perform creditos_adicionar('00000000-0000-0000-0000-000000000002', 0); raise exception 'devia falhar'; exception when others then
  if sqlerrm = 'devia falhar' then raise; end if; insert into r(ok, msg) values (true, 'E4 quantidade zero é recusada'); end $$;

-- H. cobrar de novo a questão devolvida que acabou entregue (ex.: imagem refeita depois)
select pg_temp.chk(creditos_reconfirmar(:outro, 'nunca-existiu-1') @> '{"ok":true,"cobrado":false,"sem_registro":true}', 'H1 pedido desconhecido: não cobra nada');
select pg_temp.chk(creditos_reconfirmar(:outro, 'q-00000001') @> '{"ok":true,"cobrado":false,"saldo":49}', 'H2 pedido ainda cobrado: não cobra de novo');
select creditos_devolver(:outro, 'q-00000001', 'imagem falhou') as res \gset h3a_
select creditos_reconfirmar(:outro, 'q-00000001') as res \gset h3b_
select pg_temp.chk(:'h3a_res'::jsonb @> '{"devolvido":true,"saldo":50}' and :'h3b_res'::jsonb @> '{"ok":true,"cobrado":true,"saldo":49}'
  and (select vezes from creditos_cobrancas where user_id = :outro and id = 'q-00000001') = 2
  and (select entregas from creditos_cobrancas where user_id = :outro and id = 'q-00000001') = 1, 'H3 devolvido e depois entregue: cobra de novo (vezes = 2) e fica marcado como entregue');
select pg_temp.chk(creditos_reconfirmar(:dono, 'dono-0000001') @> '{"ok":true,"ilimitado":true}', 'H4 dono: nunca cobra');
select creditos_adicionar(:quinto, 1);
select creditos_cobrar(:quinto, 'h-00000001');
select creditos_devolver(:quinto, 'h-00000001', 'imagem falhou');
select creditos_cobrar(:quinto, 'h-00000002');
select pg_temp.chk(creditos_reconfirmar(:quinto, 'h-00000001') @> '{"ok":false,"motivo":"sem_creditos"}'
  and (select estado from creditos_cobrancas where user_id = :quinto and id = 'h-00000001') = 'devolvido', 'H5 sem saldo: recusa e o pedido continua devolvido');

-- I. um crédito paga UMA entrega: o mesmo identificador reaproveitado depois da entrega cobra de novo
select creditos_adicionar(:sexto, 20);
select creditos_cobrar(:sexto, 'i-00000001');
select pg_temp.chk(creditos_cobrar(:sexto, 'i-00000001') @> '{"cobrado":false,"saldo":19}', 'I1 retentativa antes da entrega: não cobra');
select pg_temp.chk(creditos_entregue(:sexto, 'i-00000001') @> '{"entregas":1}', 'I2 servidor marca a entrega');
select creditos_cobrar(:sexto, 'i-00000001') as res \gset i3_
select pg_temp.chk(:'i3_res'::jsonb @> '{"cobrado":true,"saldo":18}'
  and (select vezes || '/' || entregas from creditos_cobrancas where user_id = :sexto and id = 'i-00000001') = '2/0', 'I3 o mesmo identificador depois da entrega é questão nova: cobra (vezes 2, entregas 0)');
select pg_temp.chk(creditos_entregue(:sexto, 'nao-existe-01') @> '{"ok":true}' and creditos_entregue(:sexto, 'nao-existe-01')->'entregas' = 'null'::jsonb, 'I4 marcar entrega de pedido desconhecido não faz nada');
-- pedidos do WhatsApp: o robô pode refazer o pedido inteiro (até 3 vezes) sem cobrar de novo
insert into wa_trabalhos (id, user_id, telefone, parametros, status) values
  ('11111111-1111-4111-8111-111111111111', :sexto, '5500000000000', '{"quantidade": 5}', 'gerando'),
  ('22222222-2222-4222-8222-222222222222', :sexto, '5500000000000', '{"quantidade": 5}', 'enviado'),
  ('33333333-3333-4333-8333-333333333333', :setimo, '5500000000001', '{"quantidade": 5}', 'gerando'),
  ('44444444-4444-4444-8444-444444444444', :sexto, '5500000000000', '{"quantidade": "cinco"}', 'gerando');
select pg_temp.chk(creditos_entregas_por_cobranca(:sexto, 'wa-11111111-1111-4111-8111-111111111111-2') = 3, 'I5 questão de pedido do WhatsApp em geração: até 3 entregas por crédito');
select pg_temp.chk(creditos_entregas_por_cobranca(:sexto, 'wa-11111111-1111-4111-8111-111111111111-6') = 1
  and creditos_entregas_por_cobranca(:sexto, 'wa-11111111-1111-4111-8111-111111111111-0') = 1, 'I6 número da questão fora do pedido: 1 entrega');
select pg_temp.chk(creditos_entregas_por_cobranca(:sexto, 'wa-22222222-2222-4222-8222-222222222222-1') = 1, 'I7 pedido que não está em geração: 1 entrega');
select pg_temp.chk(creditos_entregas_por_cobranca(:sexto, 'wa-33333333-3333-4333-8333-333333333333-1') = 1, 'I8 pedido de outra conta: 1 entrega');
select pg_temp.chk(creditos_entregas_por_cobranca(:sexto, 'wa-44444444-4444-4444-8444-444444444444-1') = 1
  and creditos_entregas_por_cobranca(:sexto, 'wa-zzzzzzzz-1111-4111-8111-111111111111-1') = 1
  and creditos_entregas_por_cobranca(:sexto, 'wa-11111111-1111-4111-8111-111111111111-1x') = 1, 'I9 formatos estranhos não dão erro: 1 entrega');
select creditos_cobrar(:sexto, 'wa-11111111-1111-4111-8111-111111111111-2') as res \gset i10a_
select creditos_entregue(:sexto, 'wa-11111111-1111-4111-8111-111111111111-2');
select creditos_cobrar(:sexto, 'wa-11111111-1111-4111-8111-111111111111-2') as res \gset i10b_
select creditos_entregue(:sexto, 'wa-11111111-1111-4111-8111-111111111111-2');
select creditos_cobrar(:sexto, 'wa-11111111-1111-4111-8111-111111111111-2') as res \gset i10c_
select creditos_entregue(:sexto, 'wa-11111111-1111-4111-8111-111111111111-2');
select creditos_cobrar(:sexto, 'wa-11111111-1111-4111-8111-111111111111-2') as res \gset i10d_
select pg_temp.chk(:'i10a_res'::jsonb @> '{"cobrado":true,"saldo":17}' and :'i10b_res'::jsonb @> '{"cobrado":false,"saldo":17}'
  and :'i10c_res'::jsonb @> '{"cobrado":false,"saldo":17}' and :'i10d_res'::jsonb @> '{"cobrado":true,"saldo":16}',
  'I10 robô refaz o pedido 3 vezes: cobra 1 só; a 4ª entrega cobra outra vez');

-- J. devolução pedida pelo app: no máximo 30 por dia (o servidor não tem esse limite)
select creditos_adicionar(:setimo, 40);
do $$ declare i int; begin
  for i in 1..31 loop perform creditos_cobrar('00000000-0000-0000-0000-000000000007', 'j-' || lpad(i::text, 8, '0')); end loop;
  for i in 1..30 loop perform creditos_devolver('00000000-0000-0000-0000-000000000007', 'j-' || lpad(i::text, 8, '0'), 'imagem', interval '2 hours'); end loop;
end $$;
select pg_temp.chk(creditos_saldo(:setimo) = 39 and (select count(*) from creditos_cobrancas where user_id = :setimo and motivo_devolucao like 'app: %') = 30, 'J1 30 devoluções pedidas pelo app no dia: todas valem (motivo marcado "app:")');
select pg_temp.chk(creditos_devolver(:setimo, 'j-00000031', 'imagem', interval '2 hours') @> '{"ok":false,"devolvido":false,"motivo":"limite_diario"}', 'J2 a 31ª devolução pedida pelo app no mesmo dia é recusada');
select pg_temp.chk(creditos_devolver(:setimo, 'j-00000031', 'servidor: HTTP 502') @> '{"devolvido":true,"saldo":40}', 'J3 a devolução feita pelo servidor continua valendo');

-- F. o que o navegador pode fazer (papel authenticated, logado como o aluno)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.chk((select count(*) from creditos_lotes) = (select count(*) from creditos_lotes where user_id = '00000000-0000-0000-0000-000000000002'), 'F1 vê só os próprios lotes');
select pg_temp.chk(creditos_meu_saldo() @> '{"ok":true,"ilimitado":false,"saldo":4}', 'F2 creditos_meu_saldo mostra o próprio saldo (4)');
do $$ begin perform creditos_cobrar('00000000-0000-0000-0000-000000000002', 'x-00000001'); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'F3 não consegue cobrar pelo navegador'); end $$;
do $$ begin perform creditos_adicionar('00000000-0000-0000-0000-000000000002', 1000); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'F4 não consegue se dar créditos'); end $$;
do $$ begin perform creditos_devolver('00000000-0000-0000-0000-000000000002', 'q-00000002'); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'F5 não consegue devolver direto pelo banco'); end $$;
do $$ begin perform creditos_reconfirmar('00000000-0000-0000-0000-000000000002', 'q-00000002'); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'F5b não consegue chamar a recobrança direto pelo banco'); end $$;
do $$ begin perform creditos_entregue('00000000-0000-0000-0000-000000000002', 'q-00000002'); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'F5c não consegue marcar entrega direto pelo banco'); end $$;
do $$ begin insert into creditos_lotes (user_id, quantidade, restante, origem) values ('00000000-0000-0000-0000-000000000002', 9, 9, 'compra'); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'F6 não consegue inserir lote'); end $$;
do $$ declare n int; begin update creditos_lotes set restante = 999; get diagnostics n = row_count; insert into r(ok, msg) values (n = 0, 'F7 não consegue alterar lote (nenhuma linha muda)'); end $$;
do $$ declare n int; begin delete from creditos_cobrancas; get diagnostics n = row_count; insert into r(ok, msg) values (n = 0, 'F7b não consegue apagar cobranças (nenhuma linha some)'); end $$;
do $$ begin perform creditos_saldo('00000000-0000-0000-0000-000000000003'); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'F7c não consegue ver o saldo de outra conta'); end $$;
do $$ begin perform creditos_entregas_por_cobranca('00000000-0000-0000-0000-000000000002', 'q-00000001'); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'F7d não consegue chamar as funções internas'); end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);   -- visitante: sem usuário
set role anon;
select pg_temp.chk(creditos_meu_saldo() @> '{"ok":false,"motivo":"sem_login"}', 'F8 sem login, o saldo não aparece (sem_login)');
do $$ begin perform creditos_adicionar('00000000-0000-0000-0000-000000000002', 1000); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'F8b visitante não consegue se dar créditos'); end $$;
do $$ begin perform creditos_cobrar('00000000-0000-0000-0000-000000000002', 'x-00000002'); raise exception 'devia falhar'; exception when insufficient_privilege then insert into r(ok, msg) values (true, 'F8c visitante não consegue cobrar'); end $$;
select pg_temp.chk((select count(*) from creditos_lotes) = 0 and (select count(*) from creditos_cobrancas) = 0, 'F8d visitante não vê nenhum lote nem cobrança');
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
select pg_temp.chk(creditos_cobrar('00000000-0000-0000-0000-000000000002', 'srv-0000001') @> '{"cobrado":true}', 'F9 o servidor (service_role) cobra');
reset role;

select (case when ok then 'PASS ' else 'FAIL ' end) || msg from r order by n;
select '' ;
select count(*) filter (where ok) || ' verificações passaram, ' || count(*) filter (where not ok) || ' falharam' from r;

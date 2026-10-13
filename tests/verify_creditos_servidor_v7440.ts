/* v74.40 — ETAPA 2 (CRÉDITOS) no generate-question, SEM CHAMAR A ANTHROPIC NEM O BANCO DO SITE.

   Roda o handler de verdade (Deno.serve capturado) com:
     · o banco: um Postgres LOCAL com as migrações aplicadas (as funções creditos_* de verdade),
       ligado no lugar da API REST do Supabase (rpc → SQL);
     · o login: tokens de teste ("tok-aluno", "tok-dono", "tok-outro") no lugar do Auth;
     · a Anthropic: simulada, sempre recusando (HTTP 400), para provar que a cobrança acontece
       antes do trabalho caro e que o crédito volta quando a questão não sai.
   A parte B testa fechaCobranca com uma resposta de sucesso (questão entregue).

   Uso (Postgres local já preparado por tests/verify_creditos_banco_v1846.sh ou equivalente):
     PGHOST=/tmp PGPORT=5499 PGUSER=postgres deno run -A --config <deno.json com jsr→npm> \
       tests/verify_creditos_servidor_v7440.ts supabase/functions/generate-question/index.ts */
import pg from "npm:pg@8";

const alvo = Deno.args[0] || "supabase/functions/generate-question/index.ts";
const fonte = await Deno.readTextFile(alvo);
let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };

/* ---------- banco local com as migrações ---------- */
const BANCO = `gq_creditos_${Date.now()}`;
const adm = new pg.Client({ host: Deno.env.get("PGHOST") || "/tmp", port: Number(Deno.env.get("PGPORT") || 5499), user: Deno.env.get("PGUSER") || "postgres", database: "postgres" });
await adm.connect();
await adm.query(`create database ${BANCO}`);
const db = new pg.Client({ host: Deno.env.get("PGHOST") || "/tmp", port: Number(Deno.env.get("PGPORT") || 5499), user: Deno.env.get("PGUSER") || "postgres", database: BANCO });
await db.connect();
const raiz = new URL("../", import.meta.url).pathname;
await db.query(`
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- como no Supabase: tudo o que é criado em public já nasce liberado para os três papéis da API
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
insert into auth.users values ('00000000-0000-0000-0000-000000000001', 'maziadh@gmail.com'),
  ('00000000-0000-0000-0000-000000000002', 'aluno@exemplo.com'), ('00000000-0000-0000-0000-000000000003', 'outro@exemplo.com');`);
await db.query(await Deno.readTextFile(`${raiz}supabase/migrations/2026-09-13_a1_whatsapp_pareamento.sql`));
await db.query(await Deno.readTextFile(`${raiz}supabase/migrations/2026-10-13_etapa2_creditos.sql`));
const ALUNO = "00000000-0000-0000-0000-000000000002", DONO = "00000000-0000-0000-0000-000000000001", OUTRO = "00000000-0000-0000-0000-000000000003";
const TOKENS: Record<string, string> = { "tok-aluno": ALUNO, "tok-dono": DONO, "tok-outro": OUTRO };
const saldo = async (u: string) => Number((await db.query("select creditos_saldo($1) s", [u])).rows[0].s);

/* ---------- fetch simulado: Auth, REST (rpc → SQL), Anthropic ---------- */
const URL_SB = "http://supabase.teste";
Deno.env.set("SUPABASE_URL", URL_SB);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "chave-de-servico-de-teste");
Deno.env.set("ANTHROPIC_API_KEY", "chave-anthropic-de-teste");
let chamadasAnthropic = 0, bancoFora = false;
const RPC_PERMITIDAS = new Set(["creditos_cobrar", "creditos_devolver", "creditos_reconfirmar", "creditos_entregue"]);
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = (async (entrada: any, init?: any) => {
  const req = entrada instanceof Request ? entrada : new Request(String(entrada), init);
  const url = new URL(req.url);
  if (url.hostname === "api.anthropic.com") { chamadasAnthropic++; return json({ type: "error", error: { type: "invalid_request_error", message: "simulado: recusado" } }, 400); }
  if (url.origin === URL_SB && url.pathname === "/auth/v1/user") {
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const id = TOKENS[tok];
    return id ? json({ id, aud: "authenticated", role: "authenticated", email: "x@y" }) : json({ code: 401, msg: "invalid JWT" }, 401);
  }
  if (url.origin === URL_SB && url.pathname.startsWith("/rest/v1/rpc/")) {
    const fn = url.pathname.slice("/rest/v1/rpc/".length);
    if (!RPC_PERMITIDAS.has(fn)) return json({ message: `rpc ${fn} não simulada` }, 404);
    if (bancoFora) return json({ message: "banco fora do ar (simulado)" }, 503);
    const args = await req.json();
    const nomes = Object.keys(args);
    const sql = `select public.${fn}(${nomes.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
    // como a API do Supabase com a chave de serviço: a chamada roda no papel service_role
    await db.query("begin");
    try {
      await db.query("set local role service_role");
      const r = await db.query(sql, nomes.map((k) => args[k]));
      await db.query("commit");
      return json(r.rows[0].r);
    } catch (e) { await db.query("rollback"); return json({ message: String((e as any)?.message || e) }, 400); }
  }
  if (url.origin === URL_SB && url.pathname.startsWith("/rest/v1/")) return new Response(null, { status: 201 });   // logs
  return json({ message: `fetch não simulado: ${url}` }, 599);
}) as typeof fetch;

/* ---------- captura o handler ---------- */
let handler: (r: Request) => Promise<Response>;
Object.defineProperty(Deno, "serve", { value: (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown() {} }; }, configurable: true, writable: true });
await import(`file://${await Deno.realPath(alvo)}`);
const post = (corpo: unknown, token?: string) => handler(new Request("http://f/generate-question", {
  method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(corpo) }));
const pedido = (extra: Record<string, unknown> = {}) => ({ area: "natureza", disciplina: "Biologia", tema: "Sistema urinário", dificuldade: "Médio", recurso: "nenhum", ...extra });
const corpo = async (r: Response) => { try { return await r.json(); } catch { return null; } };

/* ---------- A. o handler ---------- */
let a0 = chamadasAnthropic;
let r = await post(pedido({ cobrancaId: "q-teste-0001" }));
let b = await corpo(r);
t("A1 sem login: 401 com code sem_login, nada chamado na Anthropic", r.status === 401 && b?.code === "sem_login" && chamadasAnthropic === a0, JSON.stringify([r.status, b]));
r = await post(pedido({ cobrancaId: "q-teste-0001" }), "tok-invalido"); b = await corpo(r);
t("A2 token inválido: 401", r.status === 401 && b?.code === "sem_login");

a0 = chamadasAnthropic;
r = await post(pedido({ cobrancaId: "q-teste-0001" }), "tok-aluno"); b = await corpo(r);
const semRegistro = Number((await db.query("select count(*) c from creditos_cobrancas where user_id = $1", [ALUNO])).rows[0].c) === 0;
t("A3 sem créditos: 402 sem_creditos com saldo 0, ANTES de chamar a Anthropic, sem registrar cobrança",
  r.status === 402 && b?.code === "sem_creditos" && b?.creditos?.saldo === 0 && chamadasAnthropic === a0 && semRegistro, JSON.stringify([r.status, b, chamadasAnthropic - a0]));

await db.query("select creditos_adicionar($1, 2, 'cortesia')", [ALUNO]);
a0 = chamadasAnthropic;
r = await post(pedido({ cobrancaId: "q-teste-0002" }), "tok-aluno"); b = await corpo(r);
let est = (await db.query("select estado, motivo from creditos_cobrancas where user_id = $1 and id = 'q-teste-0002'", [ALUNO])).rows[0];
t("A4 com crédito e geração que falha: houve trabalho (Anthropic chamada), a resposta não é 200 e o crédito VOLTOU (saldo 2, cobrança devolvida)",
  r.status !== 200 && chamadasAnthropic > a0 && b?.creditos?.devolvido === true && b?.creditos?.saldo === 2 && await saldo(ALUNO) === 2 && est?.estado === "devolvido" && est?.motivo === "questao",
  JSON.stringify([r.status, b?.creditos, est, b?.error]));

r = await post(pedido({ cobrancaId: "q-teste-0003", motivoCredito: "refazer" }), "tok-aluno"); b = await corpo(r);
est = (await db.query("select estado, motivo from creditos_cobrancas where user_id = $1 and id = 'q-teste-0003'", [ALUNO])).rows[0];
t("A5 refazer: registrado com motivo 'refazer' (e devolvido, porque a geração simulada falha)", est?.motivo === "refazer" && est?.estado === "devolvido" && await saldo(ALUNO) === 2, JSON.stringify(est));

a0 = chamadasAnthropic;
r = await post(pedido({ cobrancaId: "q-teste-0004" }), "tok-dono"); b = await corpo(r);
t("A6 conta sem limite: passa da cobrança (gera), resposta com creditos.ilimitado, sem registro de cobrança",
  chamadasAnthropic > a0 && b?.creditos?.ilimitado === true && Number((await db.query("select count(*) c from creditos_cobrancas where user_id = $1", [DONO])).rows[0].c) === 0, JSON.stringify(b?.creditos));

r = await post(pedido({ cobrancaId: "x" }), "tok-aluno"); b = await corpo(r);
t("A7 cobrancaId inválido: o servidor cria um (srv-…) e a cobrança acontece mesmo assim",
  typeof b?.creditos?.cobranca === "string" && b.creditos.cobranca.startsWith("srv-") && Number((await db.query("select count(*) c from creditos_cobrancas where user_id = $1 and id like 'srv-%'", [ALUNO])).rows[0].c) === 1, JSON.stringify(b?.creditos));

const s0 = await saldo(ALUNO);
r = await post(pedido({ planejarRecortes: true, quantidade: 3, cobrancaId: "q-teste-0005" }), "tok-aluno");
const s1 = await saldo(ALUNO);
r = await post(pedido({ regenerarVisual: true, recurso: "grafico", textoBase: "t", comando: "c", cobrancaId: "q-teste-0006" }), "tok-aluno");
const s2 = await saldo(ALUNO);
t("A8 planejar recortes e refazer recurso visual não custam crédito", s0 === s1 && s1 === s2 && Number((await db.query("select count(*) c from creditos_cobrancas where id in ('q-teste-0005','q-teste-0006')")).rows[0].c) === 0, JSON.stringify([s0, s1, s2]));
r = await post(pedido({ planejarRecortes: true, quantidade: 3 }));
t("A9 planejar recortes sem login também é recusado (401)", r.status === 401);

/* devolução pedida pelo app */
await db.query("select creditos_cobrar($1, 'app-teste-0001')", [ALUNO]);
const antes = await saldo(ALUNO);
r = await post({ devolverCredito: true, cobrancaId: "app-teste-0001", motivo: "conferência do gabarito" }, "tok-aluno"); b = await corpo(r);
t("A10 devolução pedida pelo app: devolve e informa o saldo", r.status === 200 && b?.creditos?.devolvido === true && b?.creditos?.saldo === antes + 1 && await saldo(ALUNO) === antes + 1, JSON.stringify(b));
r = await post({ devolverCredito: true, cobrancaId: "app-teste-0001" }, "tok-aluno"); b = await corpo(r);
t("A11 pedir a mesma devolução de novo não dá crédito a mais", b?.creditos?.devolvido === false && await saldo(ALUNO) === antes + 1);
await db.query("select creditos_adicionar($1, 3, 'cortesia')", [OUTRO]);
await db.query("select creditos_cobrar($1, 'app-teste-0002')", [OUTRO]);
r = await post({ devolverCredito: true, cobrancaId: "app-teste-0002" }, "tok-aluno"); b = await corpo(r);
t("A12 não dá para devolver a cobrança de outra conta", b?.creditos?.devolvido === false && await saldo(OUTRO) === 2, JSON.stringify(b));
await db.query("select creditos_cobrar($1, 'app-teste-0003')", [ALUNO]);
await db.query("update creditos_cobrancas set cobrado_em = now() - interval '3 hours' where id = 'app-teste-0003'");
r = await post({ devolverCredito: true, cobrancaId: "app-teste-0003" }, "tok-aluno"); b = await corpo(r);
t("A13 devolução pelo app só até 2 horas depois da cobrança", b?.creditos?.devolvido === false && b?.creditos?.motivo === "fora_do_prazo", JSON.stringify(b));
r = await post({ devolverCredito: true, cobrancaId: "x" }, "tok-aluno");
t("A14 devolução com identificador inválido: 400", r.status === 400);
r = await post({ devolverCredito: true, cobrancaId: "app-teste-0001" });
t("A15 devolução sem login: 401", r.status === 401);

/* cobrar de novo a questão devolvida que acabou entregue (imagem pedida outra vez) */
await db.query("select creditos_cobrar($1, 'img-teste-0001')", [ALUNO]);
await db.query("select creditos_devolver($1, 'img-teste-0001', 'imagem falhou')", [ALUNO]);
let sAntes = await saldo(ALUNO);
r = await post({ confirmarCredito: true, cobrancaId: "img-teste-0001" }, "tok-aluno"); b = await corpo(r);
est = (await db.query("select estado, vezes from creditos_cobrancas where user_id = $1 and id = 'img-teste-0001'", [ALUNO])).rows[0];
t("A17 confirmar crédito de questão devolvida: cobra de novo (vezes 2) e informa o saldo", r.status === 200 && b?.creditos?.cobrado === true && b?.creditos?.saldo === sAntes - 1 && await saldo(ALUNO) === sAntes - 1 && est?.estado === "cobrado" && est?.vezes === 2, JSON.stringify([r.status, b, est]));
r = await post({ confirmarCredito: true, cobrancaId: "img-teste-0001" }, "tok-aluno"); b = await corpo(r);
t("A18 confirmar de novo não cobra outra vez", r.status === 200 && b?.creditos?.cobrado === false && await saldo(ALUNO) === sAntes - 1, JSON.stringify(b));
r = await post({ confirmarCredito: true, cobrancaId: "nunca-existiu-01" }, "tok-aluno"); b = await corpo(r);
t("A19 confirmar pedido desconhecido não cria cobrança", r.status === 200 && b?.creditos?.sem_registro === true && Number((await db.query("select count(*) c from creditos_cobrancas where id = 'nunca-existiu-01'")).rows[0].c) === 0, JSON.stringify(b));
await db.query("select creditos_cobrar($1, 'img-teste-0002')", [OUTRO]);
await db.query("select creditos_devolver($1, 'img-teste-0002', 'imagem falhou')", [OUTRO]);
await db.query("select creditos_cobrar($1, 'gasta-0000001'), creditos_cobrar($1, 'gasta-0000002')", [OUTRO]);
const sOutro = await saldo(OUTRO);
r = await post({ confirmarCredito: true, cobrancaId: "img-teste-0002" }, "tok-outro"); b = await corpo(r);
t("A20 confirmar sem saldo: 402 sem_creditos e a cobrança continua devolvida", sOutro === 0 && r.status === 402 && b?.code === "sem_creditos" && (await db.query("select estado from creditos_cobrancas where user_id = $1 and id = 'img-teste-0002'", [OUTRO])).rows[0].estado === "devolvido", JSON.stringify([sOutro, r.status, b]));
const r21a = await post({ confirmarCredito: true, cobrancaId: "x" }, "tok-aluno");
const r21b = await post({ confirmarCredito: true, cobrancaId: "img-teste-0001" });
r = await post({ confirmarCredito: true, cobrancaId: "img-teste-0003" }, "tok-dono"); b = await corpo(r);
t("A21 confirmar: identificador inválido 400, sem login 401, dono nunca cobra", r21a.status === 400 && r21b.status === 401 && b?.creditos?.ilimitado === true, JSON.stringify(b));

bancoFora = true; a0 = chamadasAnthropic;
r = await post(pedido({ cobrancaId: "q-teste-0007" }), "tok-aluno"); b = await corpo(r);
bancoFora = false;
t("A16 banco de créditos fora do ar: 503 creditos_indisponivel e nada é gerado", r.status === 503 && b?.code === "creditos_indisponivel" && chamadasAnthropic === a0, JSON.stringify([r.status, b]));

/* ---------- B. fechaCobranca com questão entregue (recortada do arquivo) ---------- */
function recorta(nome: string, prefixo = "async function "): string {
  const ini = fonte.indexOf(`\n${prefixo}${nome}(`);
  if (ini < 0) throw new Error(`não achei ${nome}`);
  return fonte.slice(ini, fonte.indexOf("\n}\n", ini) + 3);
}
const linhaConst = fonte.split("\n").find((l) => l.startsWith("const CREDITOS_TENTATIVAS_FONTE_APP")) || "";
const modulo = `
const CORS_HEADERS = {};
${recorta("jsonResponse", "function ")}
${linhaConst}
const chamadas: any[] = [];
const supabase = { rpc: async (fn: string, args: any) => { chamadas.push({ fn, ...args }); return { data: fn === "creditos_devolver" ? { ok: true, devolvido: true, saldo: 9 } : { ok: true, entregas: 1 }, error: null }; } };
const console = { error() {} };
${recorta("devolverCredito")}${recorta("fechaCobranca")}
export { fechaCobranca, chamadas, jsonResponse };`;
const tmp = await Deno.makeTempDir();
await Deno.writeTextFile(`${tmp}/fecha.ts`, modulo);
const F: any = await import(`file://${tmp}/fecha.ts`);
const de = (fn: string) => F.chamadas.filter((c: any) => c.fn === fn);
let rf = await F.fechaCobranca(F.jsonResponse({ question: { textoBase: "t" }, uso: {} }, 200), ALUNO, "q-ok-00001", { ok: true, cobrado: true, saldo: 7 }, 1);
let bf = await rf.json();
t("B1 questão entregue: mantém a cobrança, registra a entrega, e a resposta leva creditos {cobrado, saldo}", rf.status === 200 && bf.question && bf.creditos?.cobrado === true && bf.creditos?.saldo === 7 && de("creditos_devolver").length === 0 && de("creditos_entregue").length === 1 && de("creditos_entregue")[0].p_cobranca === "q-ok-00001", JSON.stringify([bf.creditos, F.chamadas]));
rf = await F.fechaCobranca(F.jsonResponse({ error: "x" }, 422), ALUNO, "q-er-00001", { ok: true, cobrado: true, saldo: 7 }, 1); bf = await rf.json();
t("B2 resposta 422 (sem questão): devolve o crédito desta cobrança e não registra entrega", rf.status === 422 && bf.creditos?.devolvido === true && de("creditos_devolver").length === 1 && de("creditos_devolver")[0].p_cobranca === "q-er-00001" && de("creditos_entregue").length === 1);
rf = await F.fechaCobranca(F.jsonResponse({ error: "x" }, 502), ALUNO, "q-er-00002", { ok: true, cobrado: false, saldo: 7 }, 2); bf = await rf.json();
t("B3 retentativa que falha (cobrança feita num pedido anterior): o servidor não devolve; quem decide é o app no fim", de("creditos_devolver").length === 1 && bf.creditos?.devolvido === undefined);
const reprovada = { question: { textoBase: "t", fonteNaoVerificada: { motivo: "m" } }, fontesDiag: {} };
rf = await F.fechaCobranca(F.jsonResponse(reprovada, 200), ALUNO, "q-au-00001", { ok: true, cobrado: true, saldo: 7 }, 1);
t("B4 questão reprovada pelo auditor que o app vai pedir de novo (tentativa 1 de 3): não conta como entrega", de("creditos_entregue").length === 1 && de("creditos_devolver").length === 1);
rf = await F.fechaCobranca(F.jsonResponse(reprovada, 200), ALUNO, "q-au-00001", { ok: true, cobrado: false, saldo: 7 }, 3);
t("B5 na última tentativa (3 de 3) a questão é entregue mesmo assim: conta como entrega", de("creditos_entregue").length === 2);
rf = await F.fechaCobranca(F.jsonResponse({ question: { textoBase: "t", fonteNaoVerificada: { motivo: "m" } }, fontesDiag: { ultimoRecurso: { tipo: "x" } } }, 200), ALUNO, "q-au-00002", { ok: true, cobrado: true, saldo: 7 }, 1);
t("B6 último recurso (texto próprio) é entrega", de("creditos_entregue").length === 3);
rf = await F.fechaCobranca(F.jsonResponse({ question: { textoBase: "t" } }, 200), DONO, "q-dono-0001", { ok: true, cobrado: false, ilimitado: true }, 1); bf = await rf.json();
t("B7 conta sem limite: não registra entrega nem devolução", de("creditos_entregue").length === 3 && de("creditos_devolver").length === 1 && bf.creditos?.ilimitado === true);

/* ---------- C. no arquivo ---------- */
const h = fonte.slice(fonte.indexOf("Deno.serve("));
t("C0 o pedido passa a tentativa para fechaCobranca", h.includes("return await fechaCobranca(respostaPadrao, usuario.id, cobrancaId, cobranca, Number(body.tentativa) || 0);"));
t("C1 a cobrança vem antes da geração e a geração inteira roda dentro de gerarQuestaoPadrao",
  h.indexOf("cobranca = await cobrarCredito(usuario.id, cobrancaId, motivoCredito);") > 0
  && h.indexOf("cobranca = await cobrarCredito(") < h.indexOf("async function gerarQuestaoPadrao(): Promise<Response> {")
  && h.indexOf("async function gerarQuestaoPadrao(): Promise<Response> {") < h.indexOf('const recurso = ["nenhum", "imagem", "grafico", "tabela"]'));
t("C2 o login é conferido antes de planejar recortes e de refazer o recurso visual",
  h.indexOf("const usuario = await usuarioDoPedido(req);") < h.indexOf("if (body.planejarRecortes === true) {") && h.indexOf("const usuario = await usuarioDoPedido(req);") < h.indexOf("if (body.regenerarVisual === true) {"));

await db.end();
await adm.query(`drop database ${BANCO} with (force)`);
await adm.end();
console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
Deno.exit(bad ? 1 : 0);

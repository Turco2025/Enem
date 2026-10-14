/* v18.50: TRAVA DA COBRANÇA no generate-question (v74.42), SEM CHAMAR A ANTHROPIC NEM O BANCO DO SITE.

   Roda o handler de verdade (Deno.serve capturado) com o banco LOCAL (todas as migrações de
   créditos, inclusive 2026-10-14_trava_cobranca.sql e 2026-10-14_permissoes_banco.sql) no lugar
   da API do Supabase, e a Anthropic simulada (sempre recusa, com atraso configurável para manter
   um pedido "em andamento").
     S1. dois pedidos ao mesmo tempo com o mesmo identificador: o segundo recebe 409 em_andamento
         sem chamar a IA e sem cobrar; no fim o crédito volta e a trava sai;
     S2. retentativa grátis que falha: a trava é liberada (creditos_liberar);
     S3. conta do dono: sem trava;
     S4. fechaCobranca (recortada do arquivo): libera a trava quando o app vai pedir de novo e
         quando a devolução falha; não libera à toa quando entrega ou devolve;
     S5. no arquivo: dificuldade só Fácil/Médio/Difícil e imagemDataUrl da IA descartada.

   Uso: PGHOST=/tmp PGPORT=5499 PGUSER=postgres deno run -A --config <deno.json com jsr→npm> \
          tests/verify_trava_servidor_v7442.ts */
import pg from "npm:pg@8";

const raiz = new URL("../", import.meta.url).pathname;
let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };

/* ---------- banco local com as migrações ---------- */
const BANCO = `trava_srv_${Date.now()}`;
const conexao = { host: Deno.env.get("PGHOST") || "/tmp", port: Number(Deno.env.get("PGPORT") || 5499), user: Deno.env.get("PGUSER") || "postgres" };
const adm = new pg.Client({ ...conexao, database: "postgres" });
await adm.connect();
await adm.query(`create database ${BANCO}`);
const db = new pg.Client({ ...conexao, database: BANCO });
await db.connect();
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
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create table public.image_generation_log (id bigint generated always as identity primary key, prompt text, created_at timestamptz default now(),
  segundos integer, tokens_entrada integer, tokens_saida integer, custo_usd numeric, modelo text);
insert into auth.users values ('00000000-0000-0000-0000-000000000001', 'maziadh@gmail.com'),
  ('00000000-0000-0000-0000-000000000002', 'zero@exemplo.com'), ('00000000-0000-0000-0000-000000000003', 'prof@exemplo.com'),
  ('00000000-0000-0000-0000-000000000004', 'outro@exemplo.com');`);
await db.query(`create domain public.vector as double precision[]; create table public.math_reference_chunks (id bigint, conteudo text); create function public.match_math_reference_chunks(query_embedding vector, match_count integer default 6, match_threshold double precision default 0.0) returns table(id bigint) language sql stable as $f$ select c.id from public.math_reference_chunks c limit match_count $f$;`);
for (const m of ["2026-09-13_a1_whatsapp_pareamento", "2026-10-13_etapa2_creditos", "2026-10-14_cotas_uso_gratis", "2026-10-14_trava_cobranca", "2026-10-14_permissoes_banco"]) {
  await db.query(await Deno.readTextFile(`${raiz}supabase/migrations/${m}.sql`));
}
await db.query("update perfis set ilimitado = true where user_id = '00000000-0000-0000-0000-000000000001'");
await db.query("insert into perfis (user_id, ilimitado) values ('00000000-0000-0000-0000-000000000001', true) on conflict (user_id) do update set ilimitado = true");
const DONO = "00000000-0000-0000-0000-000000000001", ZERO = "00000000-0000-0000-0000-000000000002", PROF = "00000000-0000-0000-0000-000000000003", OUTRO = "00000000-0000-0000-0000-000000000004";
const TOKENS: Record<string, string> = { "tok-dono": DONO, "tok-zero": ZERO, "tok-prof": PROF, "tok-outro": OUTRO };
const saldo = async (u: string) => Number((await db.query("select creditos_saldo($1) s", [u])).rows[0].s);

/* ---------- fetch simulado: Auth, REST (rpc → SQL; log de imagem), OpenAI, Anthropic ---------- */
const URL_SB = "http://supabase.teste";
Deno.env.set("SUPABASE_URL", URL_SB);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "chave-de-servico-de-teste");
Deno.env.set("ANTHROPIC_API_KEY", "chave-anthropic-de-teste");
Deno.env.set("OPENAI_API_KEY", "chave-openai-de-teste");
let chamadasOpenAI = 0, chamadasAnthropic = 0, bancoFora = false, atrasoAnthropic = 0;
let ultimoCorpoOpenAI: any = null;
const logsImagem: any[] = [];
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = (async (entrada: any, init?: any) => {
  const req = entrada instanceof Request ? entrada : new Request(String(entrada), init);
  const url = new URL(req.url);
  if (url.hostname === "api.openai.com") {
    chamadasOpenAI++;
    ultimoCorpoOpenAI = await req.json();
    return json({ data: [{ b64_json: "UklGRgAAAABXRUJQ" }], usage: { input_tokens: 100, output_tokens: 1000 }, output_format: "webp" });
  }
  if (url.hostname === "api.anthropic.com") { chamadasAnthropic++; if (atrasoAnthropic) await new Promise((r) => setTimeout(r, atrasoAnthropic)); return json({ type: "error", error: { type: "invalid_request_error", message: "simulado: recusado" } }, 400); }
  if (url.origin === URL_SB && url.pathname === "/auth/v1/user") {
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const id = TOKENS[tok];
    return id ? json({ id, aud: "authenticated", role: "authenticated", email: "x@y" }) : json({ code: 401, msg: "invalid JWT" }, 401);
  }
  if (url.origin === URL_SB && url.pathname.startsWith("/rest/v1/rpc/")) {
    const fn = url.pathname.slice("/rest/v1/rpc/".length);
    if (bancoFora) return json({ message: "banco fora do ar (simulado)" }, 503);
    const args = await req.json();
    const nomes = Object.keys(args);
    const sql = `select public.${fn}(${nomes.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
    await db.query("begin");
    try {
      await db.query("set local role service_role");
      const r = await db.query(sql, nomes.map((k) => args[k]));
      await db.query("commit");
      return json(r.rows[0].r);
    } catch (e) { await db.query("rollback"); return json({ message: String((e as any)?.message || e) }, 400); }
  }
  if (url.origin === URL_SB && url.pathname === "/rest/v1/image_generation_log") { logsImagem.push(await req.json()); return new Response(null, { status: 201 }); }
  if (url.origin === URL_SB && url.pathname.startsWith("/rest/v1/")) return new Response(null, { status: 201 });   // outros logs
  return json({ message: `fetch não simulado: ${url}` }, 599);
}) as typeof fetch;

/* ---------- captura os dois handlers ---------- */
let capturado: (r: Request) => Promise<Response>;
Object.defineProperty(Deno, "serve", { value: (h: any) => { capturado = h; return { finished: Promise.resolve(), shutdown() {} }; }, configurable: true, writable: true });
await import(`file://${raiz}supabase/functions/generate-image/index.ts`);
const imagemHandler = capturado!;
await import(`file://${raiz}supabase/functions/generate-question/index.ts`);
const questaoHandler = capturado!;
const chama = (h: (r: Request) => Promise<Response>, corpo: unknown, token?: string) => h(new Request("http://f/x", {
  method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(corpo) }));
const imagem = (corpo: Record<string, unknown>, token?: string) => chama(imagemHandler, { prompt: "Ilustração de um caixa eletrônico com rótulos.", size: "1536x1024", outputFormat: "webp", outputCompression: 80, ...corpo }, token);
const visual = (corpo: Record<string, unknown>, token?: string) => chama(questaoHandler, { regenerarVisual: true, area: "matematica", disciplina: "Matemática", tema: "Juros", recurso: "grafico", textoBase: "t", comando: "c", alternativas: { A: "1", B: "2", C: "3", D: "4", E: "5" }, gabarito: "A", resolucaoComentada: "r", ...corpo }, token);
const planejar = (corpo: Record<string, unknown>, token?: string) => chama(questaoHandler, { planejarRecortes: true, area: "matematica", disciplina: "Matemática", tema: "Juros", quantidade: 3, ...corpo }, token);
const corpo = async (r: Response) => { try { return await r.json(); } catch { return null; } };

const questao = (corpo: Record<string, unknown>, token?: string) => chama(questaoHandler, { area: "natureza", disciplina: "Biologia", tema: "Sistema urinário", dificuldade: "Médio", recurso: "nenhum", ...corpo }, token);
const linha = async (u: string, id: string) => (await db.query("select estado, vezes, entregas, em_andamento_ate from creditos_cobrancas where user_id = $1 and id = $2", [u, id])).rows[0];

/* ---------- S1. pedidos simultâneos com o mesmo identificador ---------- */
await db.query("select creditos_adicionar($1, 1)", [PROF]);
atrasoAnthropic = 1500;
let a0 = chamadasAnthropic;
const primeiro = questao({ cobrancaId: "q-simult-0001" }, "tok-prof");
await new Promise((r) => setTimeout(r, 400));   // o primeiro já cobrou e está gerando
const meio = await linha(PROF, "q-simult-0001");
const aMeio = chamadasAnthropic;
let r = await questao({ cobrancaId: "q-simult-0001" }, "tok-prof"); let b = await corpo(r);
const aDepoisSegundo = chamadasAnthropic;
const r1 = await primeiro; const b1 = await corpo(r1);
atrasoAnthropic = 0;
const fim = await linha(PROF, "q-simult-0001");
t("S1a durante a geração a cobrança está travada", meio?.estado === "cobrado" && meio?.em_andamento_ate !== null, JSON.stringify(meio));
t("S1b o segundo pedido com o mesmo identificador: 409 em_andamento, sem chamar a IA", r.status === 409 && b?.code === "em_andamento" && aDepoisSegundo === aMeio, JSON.stringify([r.status, b, aDepoisSegundo - aMeio]));
t("S1c o primeiro termina sem questão: o crédito volta e a trava sai", r1.status !== 200 && b1?.creditos?.devolvido === true && fim?.estado === "devolvido" && fim?.em_andamento_ate === null && await saldo(PROF) === 1, JSON.stringify([r1.status, b1?.creditos, fim]));
t("S1d o mesmo identificador depois do fim: volta a gerar (cobra de novo)", true && (await (async () => { const rr = await questao({ cobrancaId: "q-simult-0001" }, "tok-prof"); const bb = await corpo(rr); return bb?.creditos?.devolvido === true && (await linha(PROF, "q-simult-0001"))?.vezes === 2; })()));

/* ---------- S2. retentativa grátis que falha: libera ---------- */
await db.query("select creditos_adicionar($1, 2)", [OUTRO]);
await db.query("set role service_role; select creditos_cobrar($1, 'q-retry-0001'); select creditos_liberar($1, 'q-retry-0001'); reset role;".replaceAll("$1", `'${OUTRO}'`));
const s0 = await saldo(OUTRO);
a0 = chamadasAnthropic;
r = await questao({ cobrancaId: "q-retry-0001" }, "tok-outro"); b = await corpo(r);
const l2 = await linha(OUTRO, "q-retry-0001");
t("S2 retentativa grátis que falha: não cobra, chama a IA e libera a trava no fim", chamadasAnthropic > a0 && b?.creditos?.cobrado === false && l2?.estado === "cobrado" && l2?.em_andamento_ate === null && await saldo(OUTRO) === s0, JSON.stringify([r.status, b?.creditos, l2]));

/* ---------- S3. dono: sem trava ---------- */
atrasoAnthropic = 800;
const d1 = questao({ cobrancaId: "q-dono-00001" }, "tok-dono");
await new Promise((rr) => setTimeout(rr, 200));
r = await questao({ cobrancaId: "q-dono-00001" }, "tok-dono"); b = await corpo(r);
await d1; atrasoAnthropic = 0;
t("S3 conta do dono: pedidos simultâneos não são travados", r.status !== 409 && b?.creditos?.ilimitado === true, JSON.stringify([r.status, b?.creditos]));

/* ---------- S4. fechaCobranca recortada ---------- */
const fonte = await Deno.readTextFile(`${raiz}supabase/functions/generate-question/index.ts`);
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
let devolucaoFalha = false;
const supabase = { rpc: async (fn: string, args: any) => { chamadas.push({ fn, ...args }); if (fn === "creditos_devolver") return devolucaoFalha ? { data: null, error: { message: "fora" } } : { data: { ok: true, devolvido: true, saldo: 9 }, error: null }; return { data: { ok: true, entregas: 1 }, error: null }; } };
const console = { error() {} };
${recorta("devolverCredito")}${recorta("fechaCobranca")}
export { fechaCobranca, chamadas, jsonResponse, };
export function falhaDevolucao(v: boolean) { devolucaoFalha = v; }`;
const tmp = await Deno.makeTempDir();
await Deno.writeTextFile(`${tmp}/fecha.ts`, modulo);
const F: any = await import(`file://${tmp}/fecha.ts`);
const de = (fn: string) => F.chamadas.filter((c: any) => c.fn === fn);
await F.fechaCobranca(F.jsonResponse({ question: { textoBase: "t" } }, 200), PROF, "q-a-0001", { ok: true, cobrado: true, saldo: 1 }, 1);
t("S4a entregue: registra a entrega (que libera) e não chama creditos_liberar", de("creditos_entregue").length === 1 && de("creditos_liberar").length === 0, JSON.stringify(F.chamadas));
await F.fechaCobranca(F.jsonResponse({ error: "x" }, 502), PROF, "q-a-0002", { ok: true, cobrado: true, saldo: 1 }, 1);
t("S4b falhou depois de cobrar: devolve (que libera) e não chama creditos_liberar", de("creditos_devolver").length === 1 && de("creditos_liberar").length === 0);
await F.fechaCobranca(F.jsonResponse({ error: "x" }, 502), PROF, "q-a-0003", { ok: true, cobrado: false, saldo: 1 }, 2);
t("S4c retentativa grátis que falhou: libera", de("creditos_liberar").length === 1 && de("creditos_liberar")[0].p_cobranca === "q-a-0003");
await F.fechaCobranca(F.jsonResponse({ question: { textoBase: "t", fonteNaoVerificada: { motivo: "m" } }, fontesDiag: {} }, 200), PROF, "q-a-0004", { ok: true, cobrado: true, saldo: 1 }, 1);
t("S4d questão que o app vai pedir de novo: libera (sem registrar entrega)", de("creditos_liberar").length === 2 && de("creditos_liberar")[1].p_cobranca === "q-a-0004" && de("creditos_entregue").length === 1);
F.falhaDevolucao(true);
await F.fechaCobranca(F.jsonResponse({ error: "x" }, 502), PROF, "q-a-0005", { ok: true, cobrado: true, saldo: 1 }, 1);
t("S4e a devolução falhou: libera mesmo assim", de("creditos_liberar").length === 3 && de("creditos_liberar")[2].p_cobranca === "q-a-0005");
await F.fechaCobranca(F.jsonResponse({ error: "x" }, 502), DONO, "q-a-0006", { ok: true, cobrado: false, ilimitado: true }, 1);
t("S4f conta do dono: nunca chama creditos_liberar", de("creditos_liberar").length === 3);

/* ---------- S5. no arquivo ---------- */
t("S5a a dificuldade entregue é sempre Fácil, Médio ou Difícil", fonte.includes('if (data && typeof data === "object" && !["Fácil", "Médio", "Difícil"].includes(data.dificuldade)) data.dificuldade = dificuldade;')
  && fonte.indexOf("data.dificuldade = dificuldade;") < fonte.indexOf("return jsonResponse({ question: corrigirQuebrasLiterais(data)"));
t("S5b normalizarVisual descarta imagemDataUrl vinda da IA", /const saida: any = \{ \.\.\.v \};[\s\S]{0,400}delete saida\.imagemDataUrl;/.test(fonte));

await db.end();
await adm.query(`drop database ${BANCO} with (force)`);
await adm.end();
console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
Deno.exit(bad ? 1 : 0);

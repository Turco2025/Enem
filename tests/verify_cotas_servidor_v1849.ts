/* v18.49: COTA DO USO GRÁTIS no generate-image (v34) e no generate-question (v74.41),
   SEM CHAMAR A OPENAI, A ANTHROPIC NEM O BANCO DO SITE.

   Roda os dois handlers de verdade (Deno.serve capturado) com:
     · o banco: um Postgres LOCAL com as migrações aplicadas (creditos_* e creditos_uso_gratis
       de verdade), ligado no lugar da API REST do Supabase (rpc → SQL, no papel service_role);
     · o login: tokens de teste no lugar do Auth;
     · a OpenAI: simulada, sempre entregando uma imagem (e contando as chamadas);
     · a Anthropic: simulada, sempre recusando (HTTP 400) e contando as chamadas; o que se
       testa é se a chamada paga acontece ou não, não o conteúdo.
   Reproduz o ataque da verificação de segurança (conta sem crédito chamando as rotas grátis
   direto) e confere que o uso normal do app continua funcionando.

   Uso (Postgres local em PGHOST/PGPORT):
     PGHOST=/tmp PGPORT=5499 PGUSER=postgres deno run -A --config <deno.json com jsr→npm> \
       tests/verify_cotas_servidor_v1849.ts */
import pg from "npm:pg@8";

const raiz = new URL("../", import.meta.url).pathname;
let ok = 0, bad = 0;
const t = (n: string, c: boolean, extra = "") => { if (c) { ok++; console.log("PASS " + n); } else { bad++; console.log("FAIL " + n + (extra ? "\n     " + extra : "")); } };

/* ---------- banco local com as migrações ---------- */
const BANCO = `cotas_srv_${Date.now()}`;
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
for (const m of ["2026-09-13_a1_whatsapp_pareamento", "2026-10-13_etapa2_creditos", "2026-10-14_cotas_uso_gratis"]) {
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
let chamadasOpenAI = 0, chamadasAnthropic = 0, bancoFora = false;
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
  if (url.hostname === "api.anthropic.com") { chamadasAnthropic++; return json({ type: "error", error: { type: "invalid_request_error", message: "simulado: recusado" } }, 400); }
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

/* ---------- A. o ataque da verificação: conta sem nenhum crédito ---------- */
let o0 = chamadasOpenAI, a0 = chamadasAnthropic;
let r = await imagem({}, "tok-zero"); let b = await corpo(r);
t("A1 imagem, conta sem créditos e sem questão: 402 sem_creditos, OpenAI NÃO chamada", r.status === 402 && b?.code === "sem_creditos" && chamadasOpenAI === o0, JSON.stringify([r.status, b]));
const lote = await Promise.all(Array.from({ length: 10 }, () => imagem({}, "tok-zero")));
t("A2 10 imagens ao mesmo tempo, conta sem créditos: todas 402, OpenAI NÃO chamada", lote.every((x) => x.status === 402) && chamadasOpenAI === o0);
r = await imagem({ cobrancaId: "q-inventada-0001" }, "tok-zero"); b = await corpo(r);
t("A3 imagem com identificador inventado: 402, OpenAI NÃO chamada", r.status === 402 && chamadasOpenAI === o0);
r = await visual({}, "tok-zero"); b = await corpo(r);
t("A4 refazer recurso visual, conta sem créditos: 402 sem_creditos, Claude NÃO chamado", r.status === 402 && b?.code === "sem_creditos" && chamadasAnthropic === a0, JSON.stringify([r.status, b]));
r = await planejar({}, "tok-zero"); b = await corpo(r);
t("A5 planejar recortes, conta sem créditos: 402 sem_creditos, Claude NÃO chamado", r.status === 402 && b?.code === "sem_creditos" && chamadasAnthropic === a0, JSON.stringify([r.status, b]));
r = await imagem({}); const r6 = await visual({}); const r6b = await imagem({}, "tok-forjado");
t("A6 sem login ou com token falso: 401 nas duas funções, nada pago", r.status === 401 && r6.status === 401 && r6b.status === 401 && chamadasOpenAI === o0 && chamadasAnthropic === a0);

/* ---------- B. uso normal: questão cobrada da própria conta ---------- */
await db.query("select creditos_adicionar($1, 1)", [PROF]);
await db.query("select creditos_cobrar($1, 'q-prof-000001')", [PROF]);
o0 = chamadasOpenAI;
r = await imagem({ cobrancaId: "q-prof-000001" }, "tok-prof"); b = await corpo(r);
t("B1 imagem da questão cobrada (saldo agora 0): 200 com a imagem, 1 chamada à OpenAI", r.status === 200 && typeof b?.imageDataUrl === "string" && b.imageDataUrl.startsWith("data:image/webp;base64,") && chamadasOpenAI === o0 + 1 && await saldo(PROF) === 0, JSON.stringify([r.status, b?.error]));
t("B2 o log da imagem guarda quem gerou (user_id)", logsImagem.length > 0 && logsImagem[logsImagem.length - 1].user_id === PROF, JSON.stringify(logsImagem[logsImagem.length - 1]));
const loteB = await Promise.all(Array.from({ length: 15 }, () => imagem({ cobrancaId: "q-prof-000001" }, "tok-prof")));
const okB = loteB.filter((x) => x.status === 200).length;
t("B3 mais 15 imagens ao mesmo tempo na mesma questão: só 11 passam (12 no total), o resto 402", okB === 11 && loteB.filter((x) => x.status === 402).length === 4 && chamadasOpenAI === o0 + 12, `${okB} passaram, OpenAI ${chamadasOpenAI - o0}`);
a0 = chamadasAnthropic;
r = await visual({ cobrancaId: "q-prof-000001" }, "tok-prof");
t("B4 refazer recurso visual da questão cobrada: passa da cota e chama o Claude (a resposta simulada falha depois)", r.status !== 402 && r.status !== 429 && chamadasAnthropic > a0, JSON.stringify([r.status, await corpo(r)]));
r = await visual({ cobrancaId: "q-prof-000001" }, "tok-outro"); b = await corpo(r);
t("B5 a questão cobrada de OUTRA conta não serve: 402", r.status === 402 && b?.code === "sem_creditos");

/* ---------- C. conta com saldo, sem questão (simulado antigo, planejar) ---------- */
await db.query("select creditos_adicionar($1, 10)", [OUTRO]);
o0 = chamadasOpenAI; a0 = chamadasAnthropic;
r = await imagem({}, "tok-outro");
const rPl = await planejar({}, "tok-outro");
t("C1 com saldo e sem questão: imagem 200 e planejar chega ao Claude (cota do dia), sem gastar crédito",
  r.status === 200 && chamadasOpenAI === o0 + 1 && rPl.status !== 402 && rPl.status !== 429 && chamadasAnthropic > a0 && await saldo(OUTRO) === 10, JSON.stringify([r.status, rPl.status]));
await db.query("update creditos_uso_diario set usos = 30 where user_id = $1 and tipo = 'planejar'", [OUTRO]);
a0 = chamadasAnthropic;
r = await planejar({}, "tok-outro"); b = await corpo(r);
t("C2 planejar além do limite do dia: 429 limite_diario, Claude NÃO chamado", r.status === 429 && b?.code === "limite_diario" && chamadasAnthropic === a0, JSON.stringify([r.status, b]));

/* ---------- D. dono, entradas e falhas ---------- */
o0 = chamadasOpenAI;
r = await imagem({}, "tok-dono");
t("D1 conta do dono: imagem sem limite e sem questão", r.status === 200 && chamadasOpenAI === o0 + 1);
r = await imagem({ size: "3840x2160" }, "tok-dono");
t("D2 tamanho fora da lista vira 1536x1024 antes de ir à OpenAI", r.status === 200 && ultimoCorpoOpenAI?.size === "1536x1024" && ultimoCorpoOpenAI?.quality === "low", JSON.stringify(ultimoCorpoOpenAI && { size: ultimoCorpoOpenAI.size, quality: ultimoCorpoOpenAI.quality }));
o0 = chamadasOpenAI;
r = await imagem({ prompt: "p".repeat(20001) }, "tok-dono"); b = await corpo(r);
t("D3 especificação acima de 20.000 caracteres: 400 antes da OpenAI", r.status === 400 && b?.code === "prompt_longo" && chamadasOpenAI === o0);
r = await imagem({ prompt: "p".repeat(20000) }, "tok-dono");
t("D4 especificação de 20.000 caracteres ainda passa", r.status === 200);
bancoFora = true; o0 = chamadasOpenAI; a0 = chamadasAnthropic;
r = await imagem({ cobrancaId: "q-prof-000001" }, "tok-prof"); b = await corpo(r);
const rv = await visual({ cobrancaId: "q-prof-000001" }, "tok-prof"); const bv = await corpo(rv);
bancoFora = false;
t("D5 banco fora do ar: 503 creditos_indisponivel e nada é pago (falha fechada)", r.status === 503 && b?.code === "creditos_indisponivel" && rv.status === 503 && bv?.code === "creditos_indisponivel" && chamadasOpenAI === o0 && chamadasAnthropic === a0);

/* ---------- E. tamanho dos textos que vão ao prompt (refazer visual) ---------- */
let ultimoPrompt = "";
const fetchAnterior = globalThis.fetch;
globalThis.fetch = (async (entrada: any, init?: any) => {
  const req = entrada instanceof Request ? entrada : new Request(String(entrada), init);
  if (new URL(req.url).hostname === "api.anthropic.com") { const c = await req.clone().json(); ultimoPrompt = JSON.stringify(c.messages || c); }
  return fetchAnterior(req);
}) as typeof fetch;
await visual({ textoBase: "T".repeat(2_000_000), resolucaoComentada: "R".repeat(500_000), alternativas: { A: "a".repeat(100_000) } }, "tok-dono");
globalThis.fetch = fetchAnterior;
t("E1 textos enormes no refazer: cortados (12.000 / 12.000 / 2.000) antes do Claude", ultimoPrompt.length > 0 && ultimoPrompt.length < 60_000 && !ultimoPrompt.includes("T".repeat(12_001)) && ultimoPrompt.includes("T".repeat(12_000)), `prompt ${ultimoPrompt.length} caracteres`);

await db.end();
await adm.query(`drop database ${BANCO} with (force)`);
await adm.end();
console.log(`\n${ok} verificações passaram, ${bad} falharam.`);
Deno.exit(bad ? 1 : 0);

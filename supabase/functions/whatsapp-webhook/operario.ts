// operario.ts — etapa C (lado do servidor): o que o webhook faz pelo robô que gera os simulados.
//
// O robô (robo/operario.mjs, GitHub Actions) chama o webhook em POST ?operario=1 com um
// token OIDC emitido pelo próprio GitHub para a execução (sem segredo compartilhado):
//   pegar      → reivindica um pedido da fila (pendente → gerando) e recebe os parâmetros e uma
//                sessão do professor (tokens emitidos aqui, com a chave de serviço; sem senha)
//   progresso  → grava o andamento (prontas/total) para o STATUS do WhatsApp
//   entregar   → recebe um arquivo (multipart) e o sobe para a Meta (id de mídia, válido 30 dias)
//   concluir   → envia os documentos e o resumo ao professor; status enviado (ou "pronto", se a
//                janela de 24 h estiver fechada — a entrega acontece na próxima mensagem dele)
//   falhou     → status falhou e aviso ao professor
// Aqui ficam as peças puras (JWT/OIDC, sessão, fila, mídia); a orquestração e os textos ficam em logica.ts.

// --- subconjunto do Env usado aqui (o Env completo está em logica.ts) ---
export interface EnvOperario {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WHATSAPP_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  GRAPH_VERSAO?: string;
  WA_OPERARIO_REPO?: string;     // "dono/repositorio" cujas execuções podem operar (padrão Turco2025/Enem)
  WA_OPERARIO_REPO_ID?: string;  // id numérico do repositório (padrão o do Turco2025/Enem) — protege contra renomeação/recriação do nome
  WA_OPERARIO_TOKEN?: string;    // opcional: segredo compartilhado aceito no lugar do OIDC (execuções manuais)
  WA_GITHUB_TOKEN?: string;      // opcional: token fino do GitHub para disparar a execução na hora (repository_dispatch)
}

export const REPO_PADRAO = "Turco2025/Enem";
export const REPO_ID_PADRAO = "1334234286";
export const WORKFLOW_OPERARIO = ".github/workflows/wa-operario.yml";
export const AUDIENCIA_OIDC = "gerador-enem-operario";
export const EMISSOR_GITHUB = "https://token.actions.githubusercontent.com";
export const JWKS_GITHUB = `${EMISSOR_GITHUB}/.well-known/jwks`;
export const EVENTOS_PERMITIDOS = new Set(["repository_dispatch", "schedule", "workflow_dispatch"]);
// "gerando" sem sinal de vida (progresso.atualizado_em, que o robô renova a cada 60 s) há mais de
// 15 min: a execução morreu; outro robô pode assumir. Não depende do tempo total da geração.
export const TRABALHO_TRAVADO_MS = 15 * 60 * 1000;
export const ENTREGANDO_TRAVADO_MS = 5 * 60 * 1000;    // "entregando" parado há > 5 min: a função morreu no meio do envio → volta a "pronto"
export const ESPERA_REFILA_MS = 10 * 60 * 1000;        // depois de uma falha, o pedido só volta a ser pego após 10 min (outra varredura)
export const MAX_TENTATIVAS_TRABALHO = 3;
export const STATUS = { pendente: "pendente", gerando: "gerando", pronto: "pronto", entregando: "entregando", enviado: "enviado", falhou: "falhou", cancelado: "cancelado" } as const;
export const ROTULOS_ARQUIVO = ["pdf_aluno", "pdf_professor", "docx_aluno", "docx_professor"] as const;
export type RotuloArquivo = typeof ROTULOS_ARQUIVO[number];
export const MIMES_ACEITOS: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export const TAMANHO_MAX_ARQUIVO = 95 * 1024 * 1024;   // limite da Cloud API para documentos é 100 MB

export function igualSeguroBytes(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---------------------------------------------------------------------------
// JWT / OIDC do GitHub Actions
// ---------------------------------------------------------------------------
export function base64UrlParaBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesParaBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
const dec = new TextDecoder();

export interface JwtDecodificado { cabecalho: Record<string, unknown>; claims: Record<string, unknown>; assinatura: Uint8Array<ArrayBuffer>; dadosAssinados: Uint8Array<ArrayBuffer> }
export function decodificarJwt(token: string): JwtDecodificado | null {
  const partes = String(token || "").split(".");
  if (partes.length !== 3 || !partes.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return null;
  try {
    const cabecalho = JSON.parse(dec.decode(base64UrlParaBytes(partes[0])));
    const claims = JSON.parse(dec.decode(base64UrlParaBytes(partes[1])));
    if (!cabecalho || typeof cabecalho !== "object" || !claims || typeof claims !== "object") return null;
    return { cabecalho, claims, assinatura: base64UrlParaBytes(partes[2]), dadosAssinados: new TextEncoder().encode(`${partes[0]}.${partes[1]}`) as Uint8Array<ArrayBuffer> };
  } catch { return null; }
}
export function pareceJwt(token: string): boolean {
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(token || ""));
}

export type Jwk = { kid?: string; kty: string; n?: string; e?: string; alg?: string; use?: string };
let jwksCache: { chaves: Jwk[]; em: number } | null = null;
let jwksUltimaForcada = 0;
export const JWKS_CACHE_MS = 60 * 60 * 1000;
export const JWKS_REFETCH_MIN_MS = 5 * 60 * 1000;   // kid desconhecido só força nova busca a cada 5 min (contra abuso)
export function limparCacheJwks() { jwksCache = null; jwksUltimaForcada = 0; }

async function obterJwks(forcar = false): Promise<Jwk[]> {
  if (forcar) {
    if (Date.now() - jwksUltimaForcada < JWKS_REFETCH_MIN_MS && jwksCache) return jwksCache.chaves;
    jwksUltimaForcada = Date.now();
  } else if (jwksCache && Date.now() - jwksCache.em < JWKS_CACHE_MS) return jwksCache.chaves;
  const r = await fetch(JWKS_GITHUB, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`jwks do GitHub ${r.status}`);
  const j = (await r.json()) as { keys?: Jwk[] };
  const chaves = Array.isArray(j?.keys) ? j.keys : [];
  jwksCache = { chaves, em: Date.now() };
  return chaves;
}

export type ResultadoOidc = { ok: true; claims: Record<string, unknown> } | { ok: false; motivo: string };

// Verifica um token OIDC do GitHub Actions: assinatura RS256 contra o JWKS público do GitHub,
// emissor, audiência, validade, repositório (nome E id), branch, workflow e tipo de evento.
export async function verificarOidcGitHub(token: string, repo: string, agora = Date.now(), repoId: string | null = REPO_ID_PADRAO, workflow = WORKFLOW_OPERARIO): Promise<ResultadoOidc> {
  const jwt = decodificarJwt(token);
  if (!jwt) return { ok: false, motivo: "token malformado" };
  if (jwt.cabecalho.alg !== "RS256") return { ok: false, motivo: `alg ${String(jwt.cabecalho.alg)} não aceito` };
  const kid = String(jwt.cabecalho.kid ?? "");
  if (!kid) return { ok: false, motivo: "token sem kid" };
  let chaves = await obterJwks();
  let jwk = chaves.find((k) => k.kid === kid);
  if (!jwk) { chaves = await obterJwks(true); jwk = chaves.find((k) => k.kid === kid); }   // rotação de chave do GitHub
  if (!jwk || jwk.kty !== "RSA" || !jwk.n || !jwk.e) return { ok: false, motivo: "chave do token desconhecida" };
  const chave = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valida = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", chave, jwt.assinatura, jwt.dadosAssinados);
  if (!valida) return { ok: false, motivo: "assinatura inválida" };
  const c = jwt.claims;
  const seg = Math.floor(agora / 1000);
  if (c.iss !== EMISSOR_GITHUB) return { ok: false, motivo: "emissor inesperado" };
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(AUDIENCIA_OIDC)) return { ok: false, motivo: "audiência inesperada" };
  if (typeof c.exp !== "number" || c.exp <= seg) return { ok: false, motivo: "token expirado" };
  if (typeof c.nbf === "number" && c.nbf > seg + 60) return { ok: false, motivo: "token ainda não válido" };
  if (c.repository !== repo) return { ok: false, motivo: "repositório não autorizado" };
  if (repoId && String(c.repository_id ?? "") !== repoId) return { ok: false, motivo: "id do repositório não confere" };
  if (c.ref !== "refs/heads/main") return { ok: false, motivo: "só a branch main pode operar" };
  if (workflow && c.workflow_ref !== `${repo}/${workflow}@refs/heads/main`) return { ok: false, motivo: "só o workflow do operário pode operar" };
  if (!EVENTOS_PERMITIDOS.has(String(c.event_name))) return { ok: false, motivo: `evento ${String(c.event_name)} não permitido` };
  return { ok: true, claims: c };
}

export type Autorizacao = { ok: true; modo: "oidc" | "token"; claims?: Record<string, unknown> } | { ok: false; motivo: string; indisponivel?: boolean };
// Authorization: Bearer <token OIDC do GitHub>  ou  Bearer <WA_OPERARIO_TOKEN> (se configurado).
export async function autorizarOperario(env: EnvOperario, cabecalho: string | null): Promise<Autorizacao> {
  const m = /^Bearer\s+(\S+)$/i.exec(String(cabecalho || "").trim());
  if (!m) return { ok: false, motivo: "sem credencial" };
  const token = m[1];
  if (pareceJwt(token)) {
    try {
      const r = await verificarOidcGitHub(token, env.WA_OPERARIO_REPO || REPO_PADRAO, Date.now(), env.WA_OPERARIO_REPO_ID === "" ? null : (env.WA_OPERARIO_REPO_ID || REPO_ID_PADRAO));
      return r.ok ? { ok: true, modo: "oidc", claims: r.claims } : r;
    } catch (e) { return { ok: false, motivo: "verificação OIDC indisponível: " + String(e).slice(0, 120), indisponivel: true }; }   // JWKS fora do ar → 503 (o robô tenta de novo), não 401
  }
  if (env.WA_OPERARIO_TOKEN && env.WA_OPERARIO_TOKEN.length >= 24 && igualSeguroBytes(token, env.WA_OPERARIO_TOKEN)) return { ok: true, modo: "token" };
  return { ok: false, motivo: "credencial recusada" };
}

// ---------------------------------------------------------------------------
// Sessão do professor (Auth admin, chave de serviço) — sem senha em lugar nenhum
// ---------------------------------------------------------------------------
function cabecalhosAuth(env: EnvOperario, extra: Record<string, string> = {}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", ...extra };
}
export interface SessaoProfessor { access_token: string; refresh_token: string; expires_in: number; email: string }

export async function emailDoUsuario(env: EnvOperario, userId: string): Promise<string> {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers: cabecalhosAuth(env), signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`auth admin user ${r.status}`);
  const u = (await r.json()) as { email?: string };
  if (!u?.email) throw new Error("usuário sem e-mail");
  return u.email;
}

// generate_link (magiclink) devolve o hashed_token SEM enviar e-mail; verify troca o hash por uma
// sessão completa (access + refresh). O robô entra no app com setSession() — como um login normal.
export async function sessaoDoUsuario(env: EnvOperario, userId: string): Promise<SessaoProfessor> {
  const email = await emailDoUsuario(env, userId);
  const r1 = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST", headers: cabecalhosAuth(env), body: JSON.stringify({ type: "magiclink", email }), signal: AbortSignal.timeout(15_000),
  });
  if (!r1.ok) throw new Error(`generate_link ${r1.status}: ${(await r1.text()).slice(0, 160)}`);
  const link = (await r1.json()) as { hashed_token?: string };
  if (!link?.hashed_token) throw new Error("generate_link sem hashed_token");
  const r2 = await fetch(`${env.SUPABASE_URL}/auth/v1/verify`, {
    method: "POST", headers: cabecalhosAuth(env), body: JSON.stringify({ type: "magiclink", token_hash: link.hashed_token }), signal: AbortSignal.timeout(15_000),
  });
  if (!r2.ok) throw new Error(`verify ${r2.status}: ${(await r2.text()).slice(0, 160)}`);
  const s = (await r2.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!s?.access_token || !s?.refresh_token) throw new Error("verify sem sessão");
  return { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: Number(s.expires_in) || 3600, email };
}

// ---------------------------------------------------------------------------
// Fila (wa_trabalhos)
// ---------------------------------------------------------------------------
function cabecalhosDb(env: EnvOperario, extra: Record<string, string> = {}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", ...extra };
}
export interface Trabalho {
  id: string; user_id: string; telefone: string; status: string; parametros: Record<string, unknown>;
  progresso: Record<string, unknown> | null; documentos: Documento[] | null; erro: string | null;
  criado_em: string; iniciado_em: string | null; concluido_em: string | null; simulado_id: string | null;
}
export interface Documento { rotulo: string; media_id: string; nome: string; mime: string; bytes: number; em: string }
const COLUNAS = "id,user_id,telefone,status,parametros,progresso,documentos,erro,criado_em,iniciado_em,concluido_em,simulado_id";
const uuidOk = (s: unknown) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export async function trabalhoPorId(env: EnvOperario, id: string): Promise<Trabalho | null> {
  if (!uuidOk(id)) return null;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_trabalhos?select=${COLUNAS}&id=eq.${encodeURIComponent(id)}&limit=1`, { headers: cabecalhosDb(env) });
  if (!r.ok) throw new Error(`wa_trabalhos select ${r.status}`);
  return ((await r.json()) as Trabalho[])[0] ?? null;
}

async function patchTrabalho(env: EnvOperario, filtro: string, campos: Record<string, unknown>): Promise<Trabalho[]> {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_trabalhos?${filtro}`, {
    method: "PATCH", headers: cabecalhosDb(env, { prefer: "return=representation" }), body: JSON.stringify(campos),
  });
  if (!r.ok) throw new Error(`wa_trabalhos patch ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as Trabalho[];
}

// Tenta reivindicar UM trabalho (compare-and-swap via PostgREST): só quem mudar a linha a partir do
// estado esperado leva o trabalho. O "dono" (uuid sorteado aqui) identifica a execução que pegou o
// pedido: progresso/entregar/concluir/falhou só valem para quem o apresentar. Devolve a linha em "gerando" ou null.
async function reivindicar(env: EnvOperario, t: Trabalho, condicao: string, tentativasAntes: number, agora: Date): Promise<Trabalho | null> {
  const anterior = (t.progresso && typeof t.progresso === "object" ? t.progresso : {}) as Record<string, unknown>;
  const linhas = await patchTrabalho(env, `id=eq.${encodeURIComponent(t.id)}&${condicao}`, {
    status: STATUS.gerando, iniciado_em: agora.toISOString(), erro: null,
    // preserva o histórico (falhas_sessao, ultimo_erro…); só a tentativa, o dono e o sinal de vida mudam
    progresso: { ...anterior, fase: "iniciando", tentativas: tentativasAntes + 1, dono: crypto.randomUUID(), tentar_apos: null, atualizado_em: agora.toISOString() },
  });
  return linhas.length === 1 ? linhas[0] : null;
}
export function donoDe(t: Trabalho | null | undefined): string {
  return String((t?.progresso as Record<string, unknown> | null)?.dono ?? "");
}
const semSinalDesde = (agora: Date) => new Date(agora.getTime() - TRABALHO_TRAVADO_MS).toISOString();
// Filtros PostgREST do que é ACIONÁVEL agora (mesma definição para pegar e para contar):
export const filtroPendentesAcionaveis = (agora: Date) => `status=eq.pendente&or=(progresso->>tentar_apos.is.null,progresso->>tentar_apos.lt.${encodeURIComponent(agora.toISOString())})`;
export const filtroTravados = (agora: Date) => `status=eq.gerando&or=(progresso->>atualizado_em.is.null,progresso->>atualizado_em.lt.${encodeURIComponent(semSinalDesde(agora))})`;
export const filtroProntosAcionaveis = () => `status=eq.pronto&or=(progresso->>entrega_codigo.is.null,progresso->>entrega_codigo.not.in.(${[...CODIGOS_JANELA_FECHADA].join(",")}))`;
export const filtroEntregandoTravados = (agora: Date) => `status=eq.entregando&progresso->>entregando_em=lt.${encodeURIComponent(new Date(agora.getTime() - ENTREGANDO_TRAVADO_MS).toISOString())}`;
export const filtroDesistenciasSemAviso = (agora: Date) => `status=eq.falhou&erro=like.desistiu*&or=(progresso->>avisado.is.null,and(progresso->>avisado.eq.falhou_envio,progresso->>avisado_em.lt.${encodeURIComponent(new Date(agora.getTime() - 10 * 60 * 1000).toISOString())}))`;
// "gerando" sem sinal de vida (robô morreu). O sinal é progresso.atualizado_em, sempre gravado em ISO "Z" pelo JS.
function travado(t: Trabalho, agora: Date): boolean {
  if (t.status !== STATUS.gerando) return false;
  const sinal = String((t.progresso as Record<string, unknown> | null)?.atualizado_em ?? t.iniciado_em ?? "");
  const ms = Date.parse(sinal);
  return Number.isFinite(ms) ? ms < agora.getTime() - TRABALHO_TRAVADO_MS : true;
}
function aguardandoRefila(t: Trabalho, agora: Date): boolean {
  const ms = Date.parse(String((t.progresso as Record<string, unknown> | null)?.tentar_apos ?? ""));
  return Number.isFinite(ms) && ms > agora.getTime();
}

export type Reivindicacao = { trabalho: Trabalho | null; motivo?: string };
// Pega o pedido indicado (se ainda estiver na fila ou travado) ou, na varredura, o pendente mais antigo
// — pulando os que acabaram de falhar (tentar_apos) — e depois os "gerando" sem sinal de vida.
// Quem passou de MAX_TENTATIVAS_TRABALHO vira "falhou" (o aviso ao professor fica para logica.ts).
export async function reivindicarTrabalho(env: EnvOperario, idPedido: string | null, agora = new Date()): Promise<Reivindicacao> {
  const candidatos: Trabalho[] = [];
  if (idPedido) {
    const t = await trabalhoPorId(env, idPedido);
    if (!t) return { trabalho: null, motivo: "pedido não encontrado" };
    if (t.status !== STATUS.pendente && !travado(t, agora)) return { trabalho: null, motivo: `pedido está "${t.status}"` };
    candidatos.push(t);
  } else {
    const r1 = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_trabalhos?select=${COLUNAS}&${filtroPendentesAcionaveis(agora)}&order=criado_em.asc&limit=5`, { headers: cabecalhosDb(env) });
    if (!r1.ok) throw new Error(`wa_trabalhos fila ${r1.status}`);
    candidatos.push(...((await r1.json()) as Trabalho[]).filter((t) => !aguardandoRefila(t, agora)));
    const r2 = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_trabalhos?select=${COLUNAS}&${filtroTravados(agora)}&order=criado_em.asc&limit=5`, { headers: cabecalhosDb(env) });
    if (!r2.ok) throw new Error(`wa_trabalhos travados ${r2.status}`);
    candidatos.push(...((await r2.json()) as Trabalho[]));
  }
  let desistiu = 0;
  for (const t of candidatos) {
    const tentativas = Number((t.progresso as Record<string, unknown> | null)?.tentativas) || 0;
    if (tentativas >= MAX_TENTATIVAS_TRABALHO) {
      await patchTrabalho(env, `id=eq.${encodeURIComponent(t.id)}&status=in.(pendente,gerando)`, { status: STATUS.falhou, erro: `desistiu após ${tentativas} tentativas de geração`, concluido_em: agora.toISOString() });
      desistiu++;
      continue;
    }
    const condicao = t.status === STATUS.pendente ? "status=eq.pendente" : filtroTravados(agora);
    const ganho = await reivindicar(env, t, condicao, tentativas, agora);
    if (ganho) return { trabalho: ganho };
  }
  if (idPedido) return { trabalho: null, motivo: desistiu ? "pedido esgotou as tentativas e foi marcado como falhou" : "outro robô já pegou este pedido" };
  return { trabalho: null, motivo: "fila vazia" };
}

const filtroDono = (dono: string) => `&progresso->>dono=eq.${encodeURIComponent(dono)}`;
export async function gravarProgresso(env: EnvOperario, id: string, dono: string, estado: Record<string, unknown>, agora = new Date()): Promise<Trabalho | null> {
  const atual = await trabalhoPorId(env, id);
  if (!atual || atual.status !== STATUS.gerando || donoDe(atual) !== dono) return null;
  const progresso = { ...(atual.progresso || {}), ...sanitizaProgresso(estado), atualizado_em: agora.toISOString() };
  const linhas = await patchTrabalho(env, `id=eq.${encodeURIComponent(id)}&status=eq.gerando${filtroDono(dono)}`, { progresso });
  return linhas[0] ?? null;
}
// Só números e textos curtos entram no progresso (vem do robô, mas nunca se confia no formato).
export function sanitizaProgresso(e: unknown): Record<string, unknown> {
  const x = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : undefined);
  const saida: Record<string, unknown> = {};
  for (const k of ["total", "prontas", "gerando", "erros", "imagensPendentes"]) { const v = num(x[k]); if (v !== undefined) saida[k] = v; }
  if (typeof x.fase === "string") saida.fase = x.fase.slice(0, 40);
  return saida;
}

export async function anexarDocumento(env: EnvOperario, id: string, dono: string, doc: Documento, agora = new Date()): Promise<Trabalho | null> {
  const atual = await trabalhoPorId(env, id);
  if (!atual || atual.status !== STATUS.gerando || donoDe(atual) !== dono) return null;
  const lista = (Array.isArray(atual.documentos) ? atual.documentos : []).filter((d) => d.rotulo !== doc.rotulo);
  lista.push(doc);
  const linhas = await patchTrabalho(env, `id=eq.${encodeURIComponent(id)}&status=eq.gerando${filtroDono(dono)}`, { documentos: lista, progresso: { ...(atual.progresso || {}), atualizado_em: agora.toISOString() } });
  return linhas[0] ?? null;
}

// Muda o status a partir de um conjunto esperado (compare-and-swap); com `dono`, só para a execução dona.
export async function marcarTrabalho(env: EnvOperario, id: string, deStatus: string[], campos: Record<string, unknown>, dono: string | null = null): Promise<Trabalho | null> {
  const linhas = await patchTrabalho(env, `id=eq.${encodeURIComponent(id)}&status=in.(${deStatus.join(",")})${dono ? filtroDono(dono) : ""}`, campos);
  return linhas[0] ?? null;
}

// Para a varredura decidir, sem instalar nada, se vale a pena abrir o Chromium.
export interface Fila { pendentes: number; travados: number; prontos: number; entregando: number; avisos: number }
export async function contarFila(env: EnvOperario, agora = new Date()): Promise<Fila> {
  const conta = async (filtro: string) => {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_trabalhos?select=id&${filtro}`, { method: "HEAD", headers: cabecalhosDb(env, { prefer: "count=exact" }) });
    if (!r.ok) throw new Error(`wa_trabalhos contagem ${r.status}`);
    return Number((r.headers.get("content-range") || "").split("/")[1]) || 0;
  };
  return {   // só o que uma varredura faria agora (pronto em janela fechada e pendente em espera não contam)
    pendentes: await conta(filtroPendentesAcionaveis(agora)),
    travados: await conta(filtroTravados(agora)),
    prontos: await conta(filtroProntosAcionaveis()),
    entregando: await conta(filtroEntregandoTravados(agora)),
    avisos: await conta(filtroDesistenciasSemAviso(agora)),
  };
}

// Pedidos "entregando" há mais de 5 min: a função morreu no meio do envio; voltam a "pronto" para a próxima tentativa.
export async function destravarEntregas(env: EnvOperario, agora = new Date()): Promise<number> {
  const linhas = await patchTrabalho(env, filtroEntregandoTravados(agora), { status: STATUS.pronto });
  return linhas.length;
}
export const MAX_REENTREGAS = 3;   // depois disso o pedido vira "falhou" (o simulado continua em "Meus Simulados")
export const MAX_FALHAS_SESSAO = 3;

// Pedidos prontos (gerados, com documentos) ainda não entregues a este usuário.
export async function trabalhosProntos(env: EnvOperario, userId: string): Promise<Trabalho[]> {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_trabalhos?select=${COLUNAS}&user_id=eq.${encodeURIComponent(userId)}&status=eq.pronto&order=criado_em.asc&limit=3`, { headers: cabecalhosDb(env) });
  if (!r.ok) throw new Error(`wa_trabalhos prontos ${r.status}`);
  return (await r.json()) as Trabalho[];
}

// ---------------------------------------------------------------------------
// Mídia da Cloud API
// ---------------------------------------------------------------------------
export const TIMEOUT_MIDIA_MS = 60_000;
export async function subirMidia(env: EnvOperario, bytes: Uint8Array<ArrayBuffer>, mime: string, nome: string): Promise<{ ok: true; id: string } | { ok: false; status: number; detalhe: string }> {
  const fd = new FormData();
  fd.append("messaging_product", "whatsapp");
  fd.append("type", mime);
  fd.append("file", new Blob([bytes], { type: mime }), nome);
  const r = await fetch(`https://graph.facebook.com/${env.GRAPH_VERSAO || "v25.0"}/${env.WHATSAPP_PHONE_NUMBER_ID}/media`, {
    method: "POST", headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}` }, body: fd, signal: AbortSignal.timeout(TIMEOUT_MIDIA_MS),
  });
  const corpo = await r.text();
  if (!r.ok) return { ok: false, status: r.status, detalhe: corpo.slice(0, 300) };
  try {
    const id = String(JSON.parse(corpo)?.id || "");
    return id ? { ok: true, id } : { ok: false, status: r.status, detalhe: "resposta sem id: " + corpo.slice(0, 200) };
  } catch { return { ok: false, status: r.status, detalhe: "resposta inválida: " + corpo.slice(0, 200) }; }
}

export function objetoDocumento(mediaId: string, nome: string, legenda: string): Record<string, unknown> {
  return { type: "document", document: { id: mediaId, filename: nome.slice(0, 240), caption: legenda.slice(0, 1024) } };
}

// Nome de arquivo seguro para a Meta e para o Windows (sem caminho, sem caracteres proibidos).
export function nomeArquivoSeguro(nome: string, extensao: string): string {
  const base = String(nome || "").split(/[\\/]/).pop()!.replace(/[<>:"|?*]/g, "").replace(/\p{Cc}/gu, "").replace(/\s+/g, " ").trim().replace(new RegExp(`\\.${extensao}$`, "i"), "").slice(0, 120);
  return (base || "Simulado_ENEM") + "." + extensao;
}

// Ordem de entrega e rótulos legíveis.
export const ORDEM_ENTREGA: RotuloArquivo[] = ["pdf_aluno", "pdf_professor", "docx_aluno", "docx_professor"];
export function descricaoRotulo(rotulo: string): string {
  const m: Record<string, string> = { pdf_aluno: "PDF · versão do aluno", pdf_professor: "PDF · versão do professor (gabarito e resoluções)", docx_aluno: "Word · versão do aluno", docx_professor: "Word · versão do professor (gabarito e resoluções)" };
  return m[rotulo] || rotulo;
}

// Códigos da Cloud API que significam "a janela de 24 h fechou": guardamos e entregamos depois.
export const CODIGOS_JANELA_FECHADA = new Set([131047, 131026]);

// ---------------------------------------------------------------------------
// Disparo imediato da execução no GitHub (opcional — sem token, a varredura do cron pega a fila)
// ---------------------------------------------------------------------------
export const TIMEOUT_GITHUB_MS = 8_000;
export async function dispararExecucao(env: EnvOperario, trabalhoId: string): Promise<boolean> {
  if (!env.WA_GITHUB_TOKEN) return false;
  try {
    const r = await fetch(`https://api.github.com/repos/${env.WA_OPERARIO_REPO || REPO_PADRAO}/dispatches`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.WA_GITHUB_TOKEN}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "gerador-enem-webhook", "content-type": "application/json" },
      body: JSON.stringify({ event_type: "wa-pedido", client_payload: { trabalho_id: trabalhoId } }),
      signal: AbortSignal.timeout(TIMEOUT_GITHUB_MS),
    });
    if (r.status !== 204) console.error(`[wa] dispatch GitHub respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.status === 204;
  } catch (e) { console.error("[wa] dispatch GitHub falhou", e); return false; }
}

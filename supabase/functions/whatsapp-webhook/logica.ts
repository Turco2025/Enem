// whatsapp-webhook — lógica (etapas A1, B1 e C). Separada do index.ts para poder ser
// testada localmente sem abrir servidor.
//
// O que faz:
//  GET  ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...  → verificação do webhook (Meta)
//  GET  ?selftest=1&t=<verify token>[&meta=1]                      → diagnóstico (só nomes de secrets presentes, nunca valores)
//  POST (assinado com X-Hub-Signature-256)                         → mensagens recebidas:
//        "Vincular conta 123456" → conclui o pareamento telefone ↔ conta do app
//        número vinculado, qualquer mensagem → FORMULÁRIO POR PERGUNTAS (listas e botões): área,
//          disciplina, quantidade, temas, recurso visual, dificuldade → resumo → "Sim" grava em
//          wa_trabalhos (fila da etapa C). Estado da conversa em wa_conversas (expira em 1 h).
//        CANCELAR / STATUS / AJUDA → comandos
//        (mensagens repetidas pela Meta: 200 se já concluída, 500 se outra execução está
//         processando agora ou se a anterior falhou — aí a Meta reentrega e processamos de novo)
//        número não vinculado → instrução de como vincular
//  POST ?operario=1 (Authorization: Bearer <token OIDC do GitHub Actions>) → etapa C, o robô que
//        gera o simulado: pegar / progresso / entregar / concluir / falhou / entregas_pendentes
//        (ver operario.ts e robo/operario.mjs). O pedido sai da fila, o app é operado num Chromium
//        sem tela com uma sessão do professor emitida aqui, e os PDFs/DOCX voltam como documentos
//        nesta conversa. Sem token do GitHub configurado (WA_GITHUB_TOKEN), a varredura do cron
//        (a cada 10 min) pega a fila; com ele, a execução é disparada na hora do "Sim".
//
// Segurança: toda chamada POST da Meta precisa da assinatura HMAC-SHA256 feita com o
// App Secret; sem ela, 401 e nada é processado. Cada mensagem é registrada em
// wa_mensagens pelo id da Meta (chave primária) — repetições são ignoradas. As chamadas
// do robô exigem um token OIDC válido do repositório/branch configurados (ou o segredo
// compartilhado opcional WA_OPERARIO_TOKEN).

export const VERSAO = "B2.3";

import * as P from "./pedido.ts";
import * as O from "./operario.ts";

// App da Meta ("Gerador Enem") — usado só para conferir a assinatura da WABA ao app.
export const META_APP_ID = "1708104537155293";

export interface Env {
  WHATSAPP_TOKEN: string;
  WHATSAPP_APP_SECRET: string;
  WHATSAPP_VERIFY_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_WABA_ID?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GRAPH_VERSAO?: string;
  WA_OPERARIO_REPO?: string;     // etapa C: repositório cujas execuções do GitHub Actions podem operar (padrão Turco2025/Enem)
  WA_OPERARIO_REPO_ID?: string;  // etapa C: id numérico do repositório (padrão o do Turco2025/Enem; "" desliga a conferência)
  WA_OPERARIO_TOKEN?: string;    // etapa C (opcional): segredo compartilhado aceito no lugar do OIDC
  WA_GITHUB_TOKEN?: string;      // etapa C (opcional): token fino do GitHub para disparar a execução na hora do pedido
}

export function lerEnv(): Env {
  // .trim(): um espaço ou quebra de linha colado junto com o secret faria TODAS as
  // assinaturas falharem (401) sem nenhuma pista — o selftest também avisa disso.
  const g = (k: string) => (Deno.env.get(k) ?? "").trim();
  return {
    WHATSAPP_TOKEN: g("WHATSAPP_TOKEN"),
    WHATSAPP_APP_SECRET: g("WHATSAPP_APP_SECRET"),
    WHATSAPP_VERIFY_TOKEN: g("WHATSAPP_VERIFY_TOKEN"),
    WHATSAPP_PHONE_NUMBER_ID: g("WHATSAPP_PHONE_NUMBER_ID"),
    WHATSAPP_WABA_ID: g("WHATSAPP_WABA_ID"),
    SUPABASE_URL: g("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: g("SUPABASE_SERVICE_ROLE_KEY"),
    GRAPH_VERSAO: g("WHATSAPP_GRAPH_VERSAO") || "v25.0",
    WA_OPERARIO_REPO: g("WA_OPERARIO_REPO") || O.REPO_PADRAO,
    WA_OPERARIO_REPO_ID: Deno.env.get("WA_OPERARIO_REPO_ID") === undefined ? O.REPO_ID_PADRAO : g("WA_OPERARIO_REPO_ID"),
    WA_OPERARIO_TOKEN: g("WA_OPERARIO_TOKEN"),
    WA_GITHUB_TOKEN: g("WA_GITHUB_TOKEN"),
  };
}

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

export function igualSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function assinaturaHmacSha256(segredo: string, corpo: string): Promise<string> {
  const enc = new TextEncoder();
  const chave = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", chave, enc.encode(corpo));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function assinaturaValida(env: Env, cabecalho: string | null, corpo: string): Promise<boolean> {
  if (!cabecalho || !cabecalho.startsWith("sha256=")) return false;
  const esperado = await assinaturaHmacSha256(env.WHATSAPP_APP_SECRET, corpo);
  return igualSeguro(cabecalho.slice(7).toLowerCase(), esperado);
}

// NBSP, espaços U+2000–U+200B e BOM: montados por código (ver P.ACENTOS) para o fonte não ter \uXXXX.
const ESPACOS_RAROS = new RegExp("[" + String.fromCharCode(0xa0) + String.fromCharCode(0x2000) + "-" + String.fromCharCode(0x200b) + String.fromCharCode(0xfeff) + "]", "g");
// "Vincular conta 123456", "vincular 123456", "VINCULAR CONTA: 123456" → "123456"
export function extrairCodigoVinculo(texto: string): string | null {
  // normaliza espaços "especiais" que teclados de celular inserem (NBSP, zero-width) e acentos ("víncular")
  const t = String(texto || "").replace(ESPACOS_RAROS, " ").normalize("NFD").replace(P.ACENTOS, "");
  // não exige que a mensagem seja SÓ o comando: "Oi, vincular conta 482134 por favor" também vale
  const m = /(?:^|[^a-z])vincular\s*(?:a\s+)?(?:minha\s+)?(?:conta)?\s*[:\-]?\s*(?<!\d)(\d{6})(?!\d)/i.exec(t);
  return m ? m[1] : null;
}

// Limite de tentativas de código por telefone (janela de 15 min).
export const MAX_TENTATIVAS_CODIGO = 5;

// "maziadh@gmail.com" → "ma…h@gmail.com" (nunca mandamos o e-mail inteiro pelo WhatsApp)
export function mascararEmail(email: string): string {
  const [u, d] = String(email || "").split("@");
  if (!u || !d) return "";
  const ini = u.slice(0, 2), fim = u.length > 3 ? u.slice(-1) : "";
  return `${ini}…${fim}@${d}`;
}

// ---------------------------------------------------------------------------
// Supabase (PostgREST com a chave de serviço)
// ---------------------------------------------------------------------------
function cabecalhosDb(env: Env, extra: Record<string, string> = {}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", ...extra };
}

// Janelas do reprocessamento de reentregas da Meta.
export const TRAVADA_APOS_MS = 3 * 60 * 1000;        // linha reservada há > 3 min sem "acao": a execução anterior morreu (limite da função é 150 s)
export const REPROCESSAR_ATE_MS = 24 * 60 * 60 * 1000; // depois de 24 h não vale mais responder (janela de resposta do WhatsApp)

export type Anterior = { acao: string | null; recebido_em: string; reservado_em: string | null };
export type Decisao = "reprocessar" | "duplicada" | "em_andamento";

// Decide o que fazer com uma reentrega de mensagem já registrada.
//  reprocessar  → tentativa anterior falhou (erro / envio falhou) ou ficou travada
//  em_andamento → outra execução está processando agora (responder 500: a Meta tenta depois)
//  duplicada    → já concluída (ou velha demais): responder 200 e não fazer nada
export function decidirReentrega(ant: Anterior | undefined, agora = Date.now()): Decisao {
  if (!ant) return "duplicada";
  const idadeMsg = agora - new Date(ant.recebido_em).getTime();
  if (idadeMsg >= REPROCESSAR_ATE_MS) return "duplicada";
  if (ant.acao === null) {
    const desdeReserva = agora - new Date(ant.reservado_em ?? ant.recebido_em).getTime();
    return desdeReserva > TRAVADA_APOS_MS ? "reprocessar" : "em_andamento";   // relógio adiantado → idade negativa → em_andamento (seguro)
  }
  return ant.acao === "erro" || ant.acao.endsWith("_envio_falhou") ? "reprocessar" : "duplicada";
}

// Registra a mensagem; devolve "nova" se inseriu agora, ou a decisão sobre a reentrega.
// A "reserva" para reprocessar é um UPDATE condicional (compare-and-swap via PostgREST):
// só quem conseguir mudar a linha a partir do estado que leu segue em frente — duas
// execuções simultâneas nunca respondem as duas.
async function registrarMensagem(env: Env, m: { wamid: string; telefone: string; tipo: string; texto: string | null; payload: unknown }): Promise<"nova" | Decisao> {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_mensagens?on_conflict=wamid`, {
    method: "POST",
    headers: cabecalhosDb(env, { prefer: "resolution=ignore-duplicates,return=representation" }),
    body: JSON.stringify(m),
  });
  if (!resp.ok) throw new Error(`wa_mensagens insert ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const linhas = (await resp.json()) as unknown[];
  if (linhas.length > 0) return "nova";
  const r2 = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_mensagens?select=acao,recebido_em,reservado_em&wamid=eq.${encodeURIComponent(m.wamid)}`, { headers: cabecalhosDb(env) });
  if (!r2.ok) throw new Error(`wa_mensagens select ${r2.status}`);
  const ant = ((await r2.json()) as Anterior[])[0];
  const decisao = decidirReentrega(ant);
  if (decisao !== "reprocessar") return decisao;
  // reserva condicional: a linha precisa estar exatamente como foi lida
  const condicao = ant.acao === null
    ? `acao=is.null&reservado_em=lt.${encodeURIComponent(new Date(Date.now() - TRAVADA_APOS_MS).toISOString())}`
    : `acao=eq.${encodeURIComponent(ant.acao)}`;
  const r3 = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_mensagens?wamid=eq.${encodeURIComponent(m.wamid)}&${condicao}`, {
    method: "PATCH", headers: cabecalhosDb(env, { prefer: "return=representation" }),
    body: JSON.stringify({ acao: null, resposta: null, processado_em: null, reservado_em: new Date().toISOString() }),
  });
  if (!r3.ok) throw new Error(`wa_mensagens reserva ${r3.status}`);
  const reservadas = (await r3.json()) as unknown[];
  return reservadas.length === 1 ? "reprocessar" : "em_andamento";   // outra execução reservou antes
}

// Quantas tentativas de código inválido este telefone fez nos últimos 15 min.
async function tentativasRecentes(env: Env, telefone: string): Promise<number> {
  const desde = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  // conta vinculo_invalido, vinculo_invalido_envio_falhou, vinculo_invalido_envio_recusado;
  // NÃO conta vinculo_bloqueado (senão quem insiste nunca sai do bloqueio)
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_mensagens?select=wamid&telefone=eq.${encodeURIComponent(telefone)}&acao=like.vinculo_invalido*&recebido_em=gte.${encodeURIComponent(desde)}`, {
    method: "HEAD", headers: cabecalhosDb(env, { prefer: "count=exact" }),
  });
  // falha FECHADO: sem contagem confiável, não se testa código (vira "erro" → 500 → Meta reentrega)
  if (!resp.ok) throw new Error(`wa_mensagens contagem ${resp.status}`);
  const total = (resp.headers.get("content-range") || "").split("/")[1];
  if (total === undefined || total === "*" || !/^\d+$/.test(total)) throw new Error(`wa_mensagens contagem sem content-range (${resp.headers.get("content-range")})`);
  return Number(total);
}

// Grava o resultado. Tenta 3 vezes: se ficar sem gravar, a linha fica "em processamento"
// e uma reentrega tardia poderia responder de novo — por isso insiste.
async function atualizarMensagem(env: Env, wamid: string, campos: Record<string, unknown>): Promise<boolean> {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_mensagens?wamid=eq.${encodeURIComponent(wamid)}`, {
        method: "PATCH",
        headers: cabecalhosDb(env, { prefer: "return=minimal" }),
        body: JSON.stringify({ ...campos, processado_em: new Date().toISOString() }),
      });
      if (resp.ok) return true;
      console.error(`[wa] atualizar ${wamid} (tentativa ${tentativa}): ${resp.status}`);
    } catch (e) { console.error(`[wa] atualizar ${wamid} (tentativa ${tentativa}):`, e); }
    await new Promise((r) => setTimeout(r, 300 * tentativa));
  }
  return false;
}

export type Perfil = { user_id: string; whatsapp_nome: string | null; ilimitado: boolean; limite_diario_wa?: number | null };
async function perfilPorTelefone(env: Env, telefone: string): Promise<Perfil | null> {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/perfis?select=user_id,whatsapp_nome,ilimitado,limite_diario_wa&whatsapp=eq.${encodeURIComponent(telefone)}&limit=1`, { headers: cabecalhosDb(env) });
  if (!resp.ok) throw new Error(`perfis ${resp.status}`);
  const arr = (await resp.json()) as Perfil[];
  return arr[0] ?? null;
}

async function concluirVinculo(env: Env, codigo: string, telefone: string, nome: string): Promise<{ vinculado_user_id: string; vinculado_email: string } | null> {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/wa_concluir_vinculo`, {
    method: "POST",
    headers: cabecalhosDb(env),
    body: JSON.stringify({ p_codigo: codigo, p_telefone: telefone, p_nome: nome }),
  });
  if (!resp.ok) throw new Error(`wa_concluir_vinculo ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const arr = (await resp.json()) as { vinculado_user_id: string; vinculado_email: string }[];
  return arr[0] ?? null;
}

// ---------------------------------------------------------------------------
// WhatsApp (Graph API)
// ---------------------------------------------------------------------------
// Tempo máximo de espera por uma resposta da Graph API (a função inteira tem 150 s).
export const TIMEOUT_GRAPH_MS = 20_000;

// Erros da Graph que valem nova tentativa (a Meta reentrega o webhook se respondermos 500).
// Qualquer outro 4xx é permanente (número fora da lista de testes, janela de 24 h fechada,
// token inválido...): repetir não resolve e um laço de reentregas pode fazer a Meta
// desativar o webhook. Fonte: códigos de erro da Cloud API.
const CODIGOS_GRAPH_TRANSITORIOS = new Set([1, 2, 4, 17, 32, 613, 80007, 130429, 131000, 131016, 131056]);
// Lê o código de erro da Graph a partir do corpo COMPLETO (o corpo de erro costuma passar
// de 300 caracteres; se fosse cortado antes, o JSON não parsearia e o código viria 0).
export function codigoErroGraph(corpoCompleto: string): number {
  try { return Number(JSON.parse(corpoCompleto)?.error?.code) || 0; } catch { return 0; }
}
export function envioTransitorio(status: number, corpoCompleto: string): boolean {
  if (status === 429 || status >= 500) return true;
  return CODIGOS_GRAPH_TRANSITORIOS.has(codigoErroGraph(corpoCompleto));
}

// Nono dígito (Brasil): o WhatsApp identifica contas antigas como 55+DDD+8 dígitos, mas
// a lista de destinatários do número de TESTE da Meta guarda o número como foi digitado
// (normalmente com o 9). Se a Meta recusar com #131030 ("não está na lista de permissões"),
// tentamos a outra forma do mesmo número. Devolve null se não houver forma alternativa.
export function formaAlternativaBr(telefone: string): string | null {
  let m = /^55(\d{2})(\d{8})$/.exec(telefone);            // 12 dígitos → insere o 9
  if (m) return `55${m[1]}9${m[2]}`;
  m = /^55(\d{2})9(\d{8})$/.exec(telefone);               // 13 dígitos com 9 → remove o 9
  if (m) return `55${m[1]}${m[2]}`;
  return null;
}
const CODIGO_FORA_DA_LISTA = 131030;

// Envia um objeto de mensagem da Cloud API (texto, interativa, flow...). `objeto.to` é definido aqui.
async function postarObjeto(env: Env, para: string, objeto: Record<string, unknown>): Promise<{ status: number; detalhe: string; codigo: number; transitorio: boolean; idMensagem: string }> {
  const url = `https://graph.facebook.com/${env.GRAPH_VERSAO}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...objeto, to: para }),
    signal: AbortSignal.timeout(TIMEOUT_GRAPH_MS),   // estoura → exceção → acao "erro" → 500 → Meta reentrega
  });
  const completo = await resp.text();
  let idMensagem = "";
  if (resp.ok) { try { idMensagem = String(JSON.parse(completo)?.messages?.[0]?.id ?? ""); } catch { /* sem id */ } }
  return { status: resp.status, detalhe: completo.slice(0, 300), codigo: resp.ok ? 0 : codigoErroGraph(completo), transitorio: !resp.ok && envioTransitorio(resp.status, completo), idMensagem };
}

export interface Envio { ok: boolean; transitorio: boolean; detalhe: string; paraUsado: string; codigo: number; idMensagem: string }
export async function enviarObjeto(env: Env, para: string, objeto: Record<string, unknown>): Promise<Envio> {
  let r = await postarObjeto(env, para, objeto);
  let paraUsado = para;
  if (r.codigo === CODIGO_FORA_DA_LISTA) {
    const alt = formaAlternativaBr(para);
    if (alt) {
      console.log(`[wa] ${para} fora da lista de testes (#131030); tentando ${alt}`);
      const r2 = await postarObjeto(env, alt, objeto);
      if (r2.status < 400 || r2.status >= 500) { r = r2; paraUsado = alt; }
      else console.log(`[wa] ${alt} também recusado: ${r2.status} código ${r2.codigo}`);
    }
  }
  const ok = r.status >= 200 && r.status < 300;
  if (!ok) console.error(`[wa] envio para ${paraUsado} falhou ${r.status} (código ${r.codigo}): ${r.detalhe}`);
  return { ok, transitorio: r.transitorio, detalhe: r.detalhe, paraUsado, codigo: r.codigo, idMensagem: r.idMensagem };
}

export function objetoTexto(corpo: string): Record<string, unknown> {
  return { type: "text", text: { preview_url: false, body: corpo } };
}
export async function enviarTexto(env: Env, para: string, corpo: string): Promise<Envio> {
  return await enviarObjeto(env, para, objetoTexto(corpo));
}

// Várias mensagens em sequência (ex.: aviso + pergunta). Para no primeiro envio que falhar;
// devolve quantas saíram e os ids da Meta (para casar com os eventos de status depois).
export interface EnvioSequencia extends Envio { enviadas: number; ids: string[] }
async function enviarSequencia(env: Env, para: string, objetos: Record<string, unknown>[], desde = 0): Promise<EnvioSequencia> {
  let ultimo: Envio = { ok: true, transitorio: false, detalhe: "", paraUsado: para, codigo: 0, idMensagem: "" };
  const ids: string[] = [];
  let enviadas = desde;
  for (const o of objetos.slice(desde)) {
    ultimo = await enviarObjeto(env, para, o);
    if (!ultimo.ok) break;
    enviadas++; ids.push(ultimo.idMensagem);
  }
  return { ...ultimo, enviadas, ids };
}

async function marcarLida(env: Env, wamid: string) {
  try {
    await fetch(`https://graph.facebook.com/${env.GRAPH_VERSAO}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: wamid }),
      signal: AbortSignal.timeout(TIMEOUT_GRAPH_MS),
    });
  } catch (_e) { /* cosmético */ }
}

// ---------------------------------------------------------------------------
// Etapa B1 — banco: configuração, conversa guiada e fila de pedidos
// ---------------------------------------------------------------------------
async function lerConversa(env: Env, telefone: string): Promise<{ estado: Record<string, unknown>; user_id: string | null } | null> {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_conversas?select=estado,user_id&telefone=eq.${encodeURIComponent(telefone)}&limit=1`, { headers: cabecalhosDb(env) });
  if (!r.ok) throw new Error(`wa_conversas select ${r.status}`);
  const arr = (await r.json()) as { estado: Record<string, unknown>; user_id: string | null }[];
  return arr[0] ?? null;
}
async function gravarConversa(env: Env, telefone: string, userId: string | null, estado: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_conversas?on_conflict=telefone`, {
    method: "POST", headers: cabecalhosDb(env, { prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ telefone, user_id: userId, estado, atualizado_em: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`wa_conversas upsert ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

export interface TrabalhoResumo { id: string; status: string; criado_em: string; parametros: Record<string, unknown>; erro?: string | null; concluido_em?: string | null; progresso?: Record<string, unknown> | null }
// Idempotente por mensagem: uma reentrega da Meta (depois de falha no envio) encontra o
// trabalho já criado para o mesmo wamid e não cria outro.
async function trabalhoDoWamid(env: Env, wamid: string): Promise<{ id: string; status: string; parametros: Record<string, unknown> } | null> {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_trabalhos?select=id,status,parametros&parametros->>wamid_pedido=eq.${encodeURIComponent(wamid)}&limit=1`, { headers: cabecalhosDb(env) });
  if (!r.ok) throw new Error(`wa_trabalhos por wamid ${r.status}`);
  const arr = (await r.json()) as { id: string; status: string; parametros: Record<string, unknown> }[];
  return arr[0] ?? null;
}
async function criarTrabalho(env: Env, userId: string, telefone: string, pedido: P.Pedido, wamid: string): Promise<string> {
  const existente = await trabalhoDoWamid(env, wamid);
  if (existente) return existente.id;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_trabalhos`, {
    method: "POST", headers: cabecalhosDb(env, { prefer: "return=representation" }),
    body: JSON.stringify({ user_id: userId, telefone, parametros: { ...pedido, wamid_pedido: wamid }, status: "pendente" }),
  });
  if (!r.ok) throw new Error(`wa_trabalhos insert ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const arr = (await r.json()) as { id: string }[];
  if (!arr[0]?.id) throw new Error("wa_trabalhos insert sem id");
  return arr[0].id;
}
async function trabalhosDoUsuario(env: Env, userId: string, desdeIso: string | null, limite = 50): Promise<TrabalhoResumo[]> {
  const desde = desdeIso ? `&criado_em=gte.${encodeURIComponent(desdeIso)}` : "";
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_trabalhos?select=id,status,criado_em,parametros,erro,concluido_em,progresso&user_id=eq.${encodeURIComponent(userId)}${desde}&order=criado_em.desc&limit=${limite}`, { headers: cabecalhosDb(env) });
  if (!r.ok) throw new Error(`wa_trabalhos select ${r.status}`);
  return (await r.json()) as TrabalhoResumo[];
}
// Cancela os pedidos ainda pendentes do usuário; devolve quantos foram cancelados.
async function cancelarPendentes(env: Env, userId: string): Promise<number> {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_trabalhos?user_id=eq.${encodeURIComponent(userId)}&status=eq.pendente`, {
    method: "PATCH", headers: cabecalhosDb(env, { prefer: "return=representation" }),
    body: JSON.stringify({ status: "cancelado", concluido_em: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`wa_trabalhos cancelar ${r.status}`);
  return ((await r.json()) as unknown[]).length;
}
// Questões já pedidas hoje (fuso de Brasília), sem contar canceladas e falhas.
export function inicioDoDiaBrasilia(agora = new Date()): string {
  const brt = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  const ymd = brt.toISOString().slice(0, 10);
  return `${ymd}T03:00:00.000Z`;      // 00:00 em Brasília (UTC-3, sem horário de verão)
}
async function questoesPedidasHoje(env: Env, userId: string): Promise<number> {
  const lista = await trabalhosDoUsuario(env, userId, inicioDoDiaBrasilia(), 200);
  return lista.filter((t) => t.status !== "cancelado" && t.status !== "falhou").reduce((n, t) => n + (Number(t.parametros?.quantidade) || 0), 0);
}
// Etapa C: dispara a execução do robô no GitHub na hora (repository_dispatch). Sem token
// configurado, não faz nada — o pedido fica "pendente" e a varredura do cron (a cada 10 min)
// o pega. Falha aqui NÃO derruba o pedido: fica registrada e a varredura cobre.
async function acionarOperario(env: Env, trabalhoId: string): Promise<boolean> {
  return await O.dispararExecucao(env, trabalhoId);
}
// Quando um pedido confirmado de fato começa: "agora" (disparo imediato) ou "em até 10 min" (varredura).
const disparoImediato = (env: Env) => !!env.WA_GITHUB_TOKEN;

// ---------------------------------------------------------------------------
// textos das respostas (etapa A1)
// ---------------------------------------------------------------------------
export const TEXTOS = {
  vinculoOk: (nome: string, emailMascarado: string) =>
    `Pronto${nome ? ", " + nome : ""}! Este número ficou vinculado à sua conta do Gerador ENEM${emailMascarado ? ` (${emailMascarado})` : ""}.\n\n` +
    `Para pedir um simulado, é só mandar qualquer mensagem (por exemplo "oi"): eu faço 6 perguntas rápidas — área, disciplina, quantidade, temas, recurso visual e nível — e você confirma.`,
  vinculoInvalido:
    `Não encontrei um código válido nessa mensagem. Os códigos valem 15 minutos.\n\n` +
    `No Gerador ENEM, entre na sua conta, vá em "Solicitar simulados pelo WhatsApp" → "Vincular meu WhatsApp" e envie o novo código, assim: Vincular conta 123456`,
  vinculoBloqueado:
    `Muitas tentativas de código em pouco tempo. Por segurança, aguarde 15 minutos, gere um novo código no Gerador ENEM e tente de novo.`,
  naoVinculado:
    `Olá! Este número ainda não está ligado a uma conta do Gerador ENEM.\n\n` +
    `Para vincular: no site, entre na sua conta, vá em "Solicitar simulados pelo WhatsApp" → "Vincular meu WhatsApp" e envie aqui o código que aparecer, assim: Vincular conta 123456`,
  soTexto: `Por enquanto só entendo mensagens de texto e as opções das listas e botões.`,
  // etapa B1 — formulário por perguntas
  descartado: `Pedido descartado. Quando quiser outro simulado, é só mandar uma mensagem.`,
  jaRegistrando: `Já estou registrando esse pedido — aguarde a confirmação.`,
  pedidoNaFila: (numero: string, minutos: number, imediato: boolean) =>
    (imediato
      ? `⏳ Pedido nº ${numero} confirmado! A geração começa agora e leva cerca de ${minutos} min. Aviso aqui quando terminar — o simulado chega nesta conversa em PDF e Word (versões do aluno e do professor). Enquanto a geração não começar, CANCELAR desfaz o pedido.`
      : `⏳ Pedido nº ${numero} confirmado e na fila. A geração começa em até 10 min (verificação automática) e leva cerca de ${minutos} min. Aviso aqui quando terminar — o simulado chega nesta conversa em PDF e Word (versões do aluno e do professor). Enquanto a geração não começar, CANCELAR desfaz o pedido.`),
  // etapa C — operário
  gerando: (p: P.Pedido, minutos: number) =>
    `🛠️ Comecei a gerar seu simulado de ${p.disciplina} (${p.quantidade} ${p.quantidade === 1 ? "questão" : "questões"}${p.temas_texto ? ` · ${p.temas_texto.slice(0, 120)}` : ""}). Leva cerca de ${minutos} min; aviso aqui quando terminar.`,
  legendaDocumento: (rotulo: string, p: P.Pedido) => `${O.descricaoRotulo(rotulo)} — ${p.disciplina}, ${p.quantidade} ${p.quantidade === 1 ? "questão" : "questões"}`,
  // O custo de IA fica só em progresso.resumo (uso interno do administrador); o professor não vê valores.
  pronto: (p: P.Pedido, r: ResumoGeracao, documentos = 4) => {
    const arquivos = documentos >= 4 ? "PDF e Word, nas versões do aluno e do professor" : `${documentos} ${documentos === 1 ? "arquivo" : "arquivos"}`;
    const arquivado = r.simuladoId ? ` O simulado também está em "Meus Simulados" no app.` : "";
    const falhas = r.falhas.length
      ? `\n\n⚠️ ${r.falhas.length === 1 ? "1 questão não ficou pronta" : `${r.falhas.length} questões não ficaram prontas`} (nº ${r.falhas.map((f) => f.numero).join(", ")}): ${r.falhas[0].motivo.slice(0, 160)}. Abra o simulado no app e use "Regenerar".`
      : "";
    return `✅ Simulado pronto: ${r.prontas} de ${r.total} ${r.total === 1 ? "questão" : "questões"} de ${p.disciplina}${p.temas_texto ? ` · ${p.temas_texto.slice(0, 120)}` : ""}. Seguem os arquivos acima: ${arquivos}.${arquivado}${falhas}`;
  },
  entregaAtrasada: (p: P.Pedido) => `📎 Seu simulado de ${p.disciplina} ficou pronto, mas não consegui entregar na hora. Seguem os arquivos:`,
  entregaFalhouDefinitivo: (p: P.Pedido) => `❌ Não consegui entregar por aqui os arquivos do simulado de ${p.disciplina}, mesmo depois de várias tentativas. Ele está salvo em "Meus Simulados" no app — abra lá e use "Exportar PDF" ou "Exportar DOCX".`,
  falhou: (p: P.Pedido, motivo: string) => `❌ Não consegui gerar o simulado de ${p.disciplina} (${p.quantidade} ${p.quantidade === 1 ? "questão" : "questões"}): ${motivo.slice(0, 200)}. Mande "oi" para pedir de novo.`,
  limiteDiario: (pedidasHoje: number, limite: number) => limite <= 0
    ? `Sua conta está sem cota para pedidos pelo WhatsApp (limite diário 0). Fale com o administrador do Gerador ENEM.`
    : `Hoje você já pediu ${pedidasHoje} questões pelo WhatsApp e o limite diário é ${limite}. Peça menos questões ou volte amanhã.`,
  cancelado: (n: number) => n > 0 ? `Cancelei ${n === 1 ? "o pedido que estava na fila" : n + " pedidos que estavam na fila"}. Quando quiser outro, é só mandar uma mensagem.` : `Não havia pedido na fila para cancelar (pedidos já em geração não podem ser desfeitos). Quando quiser um simulado, é só mandar uma mensagem.`,
  semPedidos: `Você ainda não fez nenhum pedido por aqui. Mande qualquer mensagem e eu faço as perguntas do simulado.`,
  status: (t: TrabalhoResumo) => {
    const p = t.parametros as unknown as P.Pedido;
    const pr = (t.progresso || {}) as Record<string, unknown>;
    const andamento = t.status === "gerando" && typeof pr.total === "number" ? ` (${Number(pr.prontas) || 0} de ${pr.total} prontas)` : "";
    const rot: Record<string, string> = { pendente: "na fila, aguardando o gerador", gerando: "gerando agora" + andamento, pronto: "pronto — os arquivos chegam nesta conversa", entregando: "pronto — enviando os arquivos", enviado: "enviado ✅", falhou: "falhou ❌", cancelado: "cancelado" };
    const motivo = t.status === "falhou" && t.erro ? `\nMotivo: ${motivoAmigavel(String(t.erro))}` : "";
    return `Último pedido (${new Date(t.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}): ${p?.quantidade ?? "?"} questões de ${p?.disciplina ?? "?"} — ${rot[t.status] ?? t.status}${motivo}`;
  },
  ajuda: `Para pedir um simulado, mande qualquer mensagem: eu faço 6 perguntas (área, disciplina, quantidade, temas, recurso visual e nível) e você confirma. O simulado chega aqui em PDF e Word. Comandos: STATUS mostra o último pedido · CANCELAR descarta o formulário em andamento ou desfaz um pedido que ainda está na fila.`,
};

// Resumo que o robô manda ao concluir (sanitizado em resumoDaGeracao).
export interface ResumoGeracao { total: number; prontas: number; falhas: { numero: number; motivo: string }[]; custoUSD: number; simuladoId: string | null }
export function resumoDaGeracao(bruto: unknown): ResumoGeracao {
  const x = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const n = (v: unknown, max = 1000) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);
  const falhas = (Array.isArray(x.falhas) ? x.falhas : []).slice(0, 20).map((f) => {
    const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    return { numero: n(o.numero, 99), motivo: String(o.motivo ?? "").slice(0, 300) };
  }).filter((f) => f.numero > 0);
  // aceita o formato do robô ({ custo: { textoUSD, imagensUSD } }) e o já sanitizado ({ custoUSD }), gravado em progresso.resumo
  const custo = (x.custo && typeof x.custo === "object" ? x.custo : {}) as Record<string, unknown>;
  const custoUSD = typeof x.custoUSD === "number" ? x.custoUSD : (Number(custo.textoUSD) || 0) + (Number(custo.imagensUSD) || 0);
  const simuladoId = typeof x.simuladoId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x.simuladoId) ? x.simuladoId : null;
  return { total: n(x.total, 99), prontas: n(x.prontas, 99), falhas, custoUSD: Number.isFinite(custoUSD) && custoUSD > 0 ? Math.round(custoUSD * 100) / 100 : 0, simuladoId };
}

// ---------------------------------------------------------------------------
// processamento de uma mensagem recebida
// ---------------------------------------------------------------------------
interface MsgMeta { from: string; id: string; type: string; text?: { body?: string }; timestamp?: string; interactive?: { type?: string; nfm_reply?: { response_json?: string; name?: string }; list_reply?: { id?: string; title?: string }; button_reply?: { id?: string; title?: string } } }

// Comandos de texto do professor (número vinculado).
export function comandoDe(texto: string | null): "cancelar" | "status" | "ajuda" | null {
  const t = String(texto ?? "").trim().normalize("NFD").replace(P.ACENTOS, "").toLowerCase().replace(/[!.\s]+$/, "");
  if (/^(cancelar|cancela|desistir|parar)$/.test(t)) return "cancelar";
  if (/^(status|andamento|situacao|como esta)$/.test(t)) return "status";
  if (/^(ajuda|help|comandos|\?)$/.test(t)) return "ajuda";
  return null;
}

// Resultado da etapa B1 para uma mensagem de número vinculado: o que responder e como registrar.
type Saida = { acao: string; mensagens: Record<string, unknown>[]; resumo: string };

function estadoAtivo(e: unknown): e is P.EstadoGuiado {
  const x = e as P.EstadoGuiado | null;
  return !!x && typeof x.passo === "string" && !P.estadoExpirado(x);
}
// Guarda o estado da conversa junto com a última resposta: uma reentrega da Meta da mesma mensagem
// (depois de falha no envio) repete a resposta em vez de avançar o formulário de novo.
async function salvarEstado(env: Env, telefone: string, userId: string, estado: P.EstadoGuiado | null, wamid: string, mensagens: Record<string, unknown>[]): Promise<void> {
  if (!estado) { await gravarConversa(env, telefone, userId, {}); return; }
  await gravarConversa(env, telefone, userId, { ...estado, atualizado_em: new Date().toISOString(), ultimo_wamid: wamid, ultima_resposta: mensagens } as unknown as Record<string, unknown>);
}
// Encerra o formulário (depois do Sim, de um cancelamento...) guardando só a última resposta: uma
// reentrega tardia da mesma mensagem repete a resposta em vez de cancelar a fila ou abrir outro formulário.
async function encerrarConversa(env: Env, telefone: string, userId: string, wamid: string, mensagens: Record<string, unknown>[]): Promise<void> {
  await gravarConversa(env, telefone, userId, { encerrado_em: new Date().toISOString(), ultimo_wamid: wamid, ultima_resposta: mensagens });
}
// Reserva o "Sim": só quem conseguir mudar o estado de "confirmar" para "registrando" grava o pedido
// (dois "Sim" simultâneos → um só trabalho). Devolve false se outra execução já reservou.
async function reservarConfirmacao(env: Env, telefone: string, estado: P.EstadoGuiado, wamid: string): Promise<boolean> {
  const agora = new Date().toISOString();
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_conversas?telefone=eq.${encodeURIComponent(telefone)}&estado->>passo=eq.confirmar`, {
    method: "PATCH", headers: cabecalhosDb(env, { prefer: "return=representation" }),
    body: JSON.stringify({ estado: { ...estado, passo: "registrando", ultimo_wamid: wamid, atualizado_em: agora }, atualizado_em: agora }),
  });
  if (!r.ok) throw new Error(`wa_conversas reservar ${r.status}`);
  return ((await r.json()) as unknown[]).length === 1;
}

async function tratarPedido(env: Env, msg: MsgMeta, telefone: string, texto: string | null, perfil: Perfil, pre: PreCarga = {}): Promise<Saida> {
  const userId = perfil.user_id;
  const conversa = pre.conversa !== undefined ? pre.conversa : await lerConversa(env, telefone);
  // o estado só vale para a conta dona dele (o telefone pode ter sido vinculado a outra conta no meio)
  const bruto = conversa && (!conversa.user_id || conversa.user_id === userId) ? conversa.estado : null;
  const estado = estadoAtivo(bruto) ? bruto : null;

  // 0) reentrega da MESMA mensagem já respondida (formulário encerrado ou em andamento): repete a resposta
  const memoria = bruto as { ultimo_wamid?: string; ultima_resposta?: Record<string, unknown>[]; passo?: string } | null;
  if (memoria?.ultimo_wamid === msg.id && Array.isArray(memoria.ultima_resposta) && memoria.ultima_resposta.length && memoria.passo !== "registrando") {
    return { acao: `reentrega_${memoria.passo ?? "encerrado"}`, mensagens: memoria.ultima_resposta, resumo: "reentrega: repete a última resposta" };
  }

  // 1) comandos
  const cmd = msg.type === "text" ? comandoDe(texto) : null;
  if (cmd === "cancelar") {
    if (estado) {   // formulário em andamento: CANCELAR descarta só o rascunho (os pedidos da fila ficam)
      const msgs = [objetoTexto(TEXTOS.descartado)];
      await encerrarConversa(env, telefone, userId, msg.id, msgs);
      return { acao: "pedido_descartado", mensagens: msgs, resumo: TEXTOS.descartado };
    }
    const n = await cancelarPendentes(env, userId);
    const msgs = [objetoTexto(TEXTOS.cancelado(n))];
    await encerrarConversa(env, telefone, userId, msg.id, msgs);
    return { acao: n > 0 ? "pedido_cancelado" : "cancelar_sem_pedido", mensagens: msgs, resumo: TEXTOS.cancelado(n) };
  }
  if (cmd === "status") {
    const lista = await trabalhosDoUsuario(env, userId, null, 1);
    const t = lista[0] ? TEXTOS.status(lista[0]) : TEXTOS.semPedidos;
    return { acao: "status", mensagens: [objetoTexto(t)], resumo: t };
  }
  if (cmd === "ajuda") return { acao: "ajuda", mensagens: [objetoTexto(TEXTOS.ajuda)], resumo: TEXTOS.ajuda };

  const resposta = P.respostaDoProfessor(msg);
  if (resposta === null) return { acao: "so_texto", mensagens: [objetoTexto(TEXTOS.soTexto)], resumo: TEXTOS.soTexto };

  // 2) reentrega de um "Sim" que já virou pedido (o envio da confirmação falhou): repete a confirmação,
  //    limpa o rascunho e, se o operário ainda não foi avisado, avisa de novo
  const jaCriado = pre.jaCriado !== undefined ? pre.jaCriado : await trabalhoDoWamid(env, msg.id);
  if (jaCriado) {
    const pedido = jaCriado.parametros as unknown as P.Pedido;
    const acionado = jaCriado.status === "pendente" ? await acionarOperario(env, jaCriado.id) : disparoImediato(env);
    const t = TEXTOS.pedidoNaFila(jaCriado.id.slice(0, 8), P.minutosEstimados(pedido), acionado);
    const msgs = [objetoTexto(t)];
    await encerrarConversa(env, telefone, userId, msg.id, msgs);
    return { acao: acionado ? "pedido_criado" : "pedido_na_fila", mensagens: msgs, resumo: t };
  }

  // 3) "registrando": um Sim está sendo (ou foi) gravado por outra execução
  if (estado?.passo === "registrando") {
    const mesmoSim = estado.ultimo_wamid === msg.id;   // reentrega do próprio Sim depois de um erro no meio da gravação
    const travado = Date.now() - new Date(estado.atualizado_em ?? estado.iniciado_em).getTime() > TRAVADA_APOS_MS;
    if (!mesmoSim && !travado) return { acao: "pedido_em_registro", mensagens: [objetoTexto(TEXTOS.jaRegistrando)], resumo: TEXTOS.jaRegistrando };
    if (estado.ultimo_wamid && estado.ultimo_wamid !== msg.id) {
      const feito = await trabalhoDoWamid(env, estado.ultimo_wamid);
      if (feito) { const t = TEXTOS.pedidoNaFila(feito.id.slice(0, 8), P.minutosEstimados(feito.parametros as unknown as P.Pedido), feito.status !== "pendente" || disparoImediato(env)); const msgs = [objetoTexto(t)]; await encerrarConversa(env, telefone, userId, msg.id, msgs); return { acao: "pedido_na_fila", mensagens: msgs, resumo: t }; }
    }
    if (mesmoSim) {   // a reserva é nossa: grava direto, sem reservar de novo
      const v = P.validarPedido(P.camposDoGuiado(estado.dados));
      if (v.ok) return await gravarEResponder(env, msg, telefone, perfil, estado, v.pedido);
    }
    estado.passo = "confirmar";   // execução anterior morreu: volta a aceitar o Sim
    await gravarConversa(env, telefone, userId, estado as unknown as Record<string, unknown>);
  }

  // 4) formulário em andamento
  if (estado) {
    if (estado.passo === "confirmar" && P.ehSim(resposta)) {
      const v = P.validarPedido(P.camposDoGuiado(estado.dados));
      if (v.ok) {
        if (!(await reservarConfirmacao(env, telefone, estado, msg.id))) {   // outro "Sim" chegou junto e já está gravando
          return { acao: "pedido_em_registro", mensagens: [objetoTexto(TEXTOS.jaRegistrando)], resumo: TEXTOS.jaRegistrando };
        }
        return await gravarEResponder(env, msg, telefone, perfil, estado, v.pedido);
      }
    }
    const tr = P.avancarGuiado(estado, resposta);
    if (tr.tipo === "cancelado") { const msgs = [objetoTexto(TEXTOS.descartado)]; await encerrarConversa(env, telefone, userId, msg.id, msgs); return { acao: "pedido_descartado", mensagens: msgs, resumo: TEXTOS.descartado }; }
    if (tr.tipo === "confirmado") {   // só acontece se a validação acima falhou e a máquina refez; por segurança, recomeça
      const ini = P.iniciarGuiado(); await salvarEstado(env, telefone, userId, ini.estado, msg.id, [ini.mensagem]);
      return { acao: "guiado_area", mensagens: [ini.mensagem], resumo: "formulário reiniciado" };
    }
    const msgs = tr.tipo === "repetir" ? [objetoTexto(tr.aviso), tr.mensagem] : [tr.mensagem];
    await salvarEstado(env, telefone, userId, tr.estado, msg.id, msgs);
    return { acao: `guiado_${tr.estado.passo}`, mensagens: msgs, resumo: `formulário: ${tr.estado.passo}` };
  }

  // 5) mensagem nova (qualquer coisa): começa o formulário
  const ini = P.iniciarGuiado();
  await salvarEstado(env, telefone, userId, ini.estado, msg.id, [ini.mensagem]);
  return { acao: "guiado_iniciado", mensagens: [ini.mensagem], resumo: "formulário iniciado (1/6)" };
}

// Com a reserva em mãos: grava o pedido e encerra o formulário; no limite diário, volta à confirmação com os botões.
async function gravarEResponder(env: Env, msg: MsgMeta, telefone: string, perfil: Perfil, estado: P.EstadoGuiado, pedido: P.Pedido): Promise<Saida> {
  const saida = await registrarPedido(env, msg, telefone, perfil, pedido);
  if (saida.acao === "limite_diario") {
    const msgs = [...saida.mensagens, P.perguntaDoPasso("confirmar", estado.dados)];
    await salvarEstado(env, telefone, perfil.user_id, { ...estado, passo: "confirmar" }, msg.id, msgs);
    return { ...saida, mensagens: msgs };
  }
  await encerrarConversa(env, telefone, perfil.user_id, msg.id, saida.mensagens);
  return saida;
}

async function registrarPedido(env: Env, msg: MsgMeta, telefone: string, perfil: Perfil, pedido: P.Pedido): Promise<Saida> {
  if (!perfil.ilimitado) {
    const limite = perfil.limite_diario_wa == null ? 30 : Math.max(0, Number(perfil.limite_diario_wa) || 0);   // 0 = bloqueado
    const hoje = await questoesPedidasHoje(env, perfil.user_id);
    if (hoje + pedido.quantidade > limite) {
      const t = TEXTOS.limiteDiario(hoje, limite);
      return { acao: "limite_diario", mensagens: [objetoTexto(t)], resumo: t };
    }
  }
  const id = await criarTrabalho(env, perfil.user_id, telefone, pedido, msg.id);
  const acionado = await acionarOperario(env, id);
  const texto = TEXTOS.pedidoNaFila(id.slice(0, 8), P.minutosEstimados(pedido), acionado);
  return { acao: acionado ? "pedido_criado" : "pedido_na_fila", mensagens: [objetoTexto(texto)], resumo: texto };
}

// ---------------------------------------------------------------------------
// Etapa C — entrega dos documentos e atendimento ao robô (operário)
// ---------------------------------------------------------------------------
function pedidoDe(t: O.Trabalho): P.Pedido {
  const p = (t.parametros || {}) as Record<string, unknown>;
  return { ...(p as unknown as P.Pedido), disciplina: String(p.disciplina ?? "?"), quantidade: Number(p.quantidade) || 0, temas_texto: String(p.temas_texto ?? ""), recurso: (p.recurso as P.Recurso) || "nenhum" };
}
const progressoDe = (t: O.Trabalho) => (t.progresso || {}) as Record<string, unknown>;
// Mensagens da entrega, em ordem fixa: documentos (PDF aluno, PDF professor, Word aluno, Word professor) + resumo.
// A lista é determinística para que uma entrega interrompida continue de onde parou (progresso.entregues).
export function mensagensDaEntrega(t: O.Trabalho): Record<string, unknown>[] {
  const p = pedidoDe(t);
  const docs = Array.isArray(t.documentos) ? t.documentos : [];
  const ordenados = O.ORDEM_ENTREGA.map((r) => docs.find((d) => d.rotulo === r)).filter((d): d is O.Documento => !!d);
  const resumo = resumoDaGeracao(progressoDe(t).resumo);
  const msgs: Record<string, unknown>[] = [];
  for (const d of ordenados) msgs.push(O.objetoDocumento(d.media_id, d.nome, TEXTOS.legendaDocumento(d.rotulo, p)));
  msgs.push(objetoTexto(TEXTOS.pronto(p, resumo, ordenados.length)));
  return msgs;
}
// Motivo técnico → frase curta para o professor (sem JSON, sem códigos HTTP).
export function motivoAmigavel(motivo: string): string {
  const m = String(motivo || "").split("\n")[0].replace(/\s+at\s+\S.*$/, "").replace(/\s+/g, " ").trim();   // sem pilha ("at Object.x (http://…)")
  if (/sessão do professor indisponível|não consegui acessar sua conta/i.test(m)) return "não consegui acessar sua conta do Gerador ENEM para gerar";
  if (/tempo esgotado/i.test(m)) return "a geração demorou demais e foi interrompida";
  if (/nenhuma questão ficou pronta/i.test(m)) return "nenhuma questão ficou pronta (" + m.replace(/^nenhuma questão ficou pronta:?\s*/i, "").replace(/[{}\[\]"]/g, "").slice(0, 120).trim() + ")";
  if (/^(área|disciplina|quantidade) inválida|parâmetros ausentes/i.test(m)) return "os parâmetros do pedido não foram aceitos pelo aplicativo";
  if (/arquivo grande demais/i.test(m)) return "os arquivos ficaram grandes demais para o WhatsApp";
  if (/HTTP \d{3}|recusou a mídia|\{/.test(m)) return "houve uma falha técnica na entrega dos arquivos";
  return m.replace(/[{}\[\]"]/g, "").slice(0, 140);
}
export type ResultadoEntrega = "enviado" | "pronto" | "falhou" | "ocupado";
// Índices (0..n-1) das mensagens da entrega que ainda faltam: tudo, ou o que progresso.entrega_faltam disser.
function faltamDe(pr: Record<string, unknown>, total: number): number[] {
  const bruto = Array.isArray(pr.entrega_faltam) ? pr.entrega_faltam : null;
  const lista = bruto ? bruto.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x >= 0 && x < total) : Array.from({ length: total }, (_, i) => i);
  return [...new Set(lista)].sort((a, b) => a - b);
}
// Envia a entrega com trava (gerando|pronto → entregando → enviado). Só as mensagens que faltam saem;
// cada id devolvido pela Meta é gravado na hora (para casar com o status "failed" assíncrono).
// Falha transitória ou janela de 24 h fechada → "pronto" (a próxima mensagem do professor, ou a
// varredura, tenta de novo — até MAX_REENTREGAS); recusa permanente → "falhou"; outra execução
// entregando → "ocupado".
async function entregarTrabalho(env: Env, t0: O.Trabalho, atrasada: boolean, dono: string | null = null): Promise<ResultadoEntrega> {
  const agora = new Date().toISOString();
  const pr0 = progressoDe(t0);
  const primeira = !pr0.entrega_falhou_em && !(Array.isArray(pr0.entrega_ids) && pr0.entrega_ids.length);
  const reentregas = (Number(pr0.reentregas) || 0) + (primeira ? 0 : 1);
  const t = await O.marcarTrabalho(env, t0.id, [O.STATUS.gerando, O.STATUS.pronto], { status: O.STATUS.entregando, progresso: { ...pr0, fase: "entregando", entregando_em: agora, reentregas } }, dono);
  if (!t) return "ocupado";
  const p = pedidoDe(t);
  let pr = progressoDe(t);
  const mensagens = mensagensDaEntrega(t);
  const faltam = faltamDe(pr, mensagens.length);
  const ids: string[] = Array.isArray(pr.entrega_ids) ? [...(pr.entrega_ids as string[])] : [];
  const mapa: Record<string, number> = { ...((pr.entrega_mapa as Record<string, number> | undefined) || {}) };
  const fecha = async (status: string, extra: Record<string, unknown>) => {
    const fim = new Date().toISOString();
    pr = { ...pr, entrega_faltam: faltam, entrega_ids: ids, entrega_mapa: mapa, atualizado_em: fim, ...extra };
    await O.marcarTrabalho(env, t.id, [O.STATUS.entregando], { status, progresso: pr, ...(status === O.STATUS.enviado ? { concluido_em: fim, erro: null } : {}), ...(status === O.STATUS.falhou ? { concluido_em: fim } : {}) });
  };
  if (reentregas > O.MAX_REENTREGAS) {
    await fecha(O.STATUS.falhou, { fase: "falhou", erro_entrega: "excedeu as reentregas" });
    await O.marcarTrabalho(env, t.id, [O.STATUS.falhou], { erro: `entrega não concluída após ${reentregas - 1} reentregas` });
    try { await enviarTexto(env, t.telefone, TEXTOS.entregaFalhouDefinitivo(p)); } catch (e) { console.error("[wa] aviso de entrega falhou", e); }
    return "falhou";
  }
  let falha: Envio | null = null;
  try {
    if (atrasada && ids.length === 0) {
      const aviso = await enviarTexto(env, t.telefone, TEXTOS.entregaAtrasada(p));
      if (!aviso.ok) falha = aviso;
    }
    while (!falha && faltam.length) {
      const i = faltam[0];
      const r = await enviarObjeto(env, t.telefone, mensagens[i]);
      if (!r.ok) { falha = r; break; }
      faltam.shift(); if (r.idMensagem) { ids.push(r.idMensagem); mapa[r.idMensagem] = i; }
      // grava o id na hora: um status "failed" pode chegar antes de a entrega terminar
      await O.marcarTrabalho(env, t.id, [O.STATUS.entregando], { progresso: { ...pr, entrega_faltam: faltam, entrega_ids: ids, entrega_mapa: mapa, atualizado_em: new Date().toISOString() } });
    }
  } catch (e) {   // timeout/rede ao falar com a Graph: transitório
    falha = { ok: false, transitorio: true, detalhe: String(e).slice(0, 200), paraUsado: t.telefone, codigo: 0, idMensagem: "" };
  }
  if (!falha && !faltam.length) { await fecha(O.STATUS.enviado, { fase: "enviado" }); return "enviado"; }
  const f = falha as Envio;
  if (O.CODIGOS_JANELA_FECHADA.has(f.codigo) || f.transitorio) {
    await fecha(O.STATUS.pronto, { fase: "pronto", entrega_falhou_em: new Date().toISOString(), entrega_codigo: f.codigo, entrega_detalhe: f.detalhe.slice(0, 200) });
    return "pronto";
  }
  await fecha(O.STATUS.falhou, { fase: "falhou", entrega_codigo: f.codigo, entrega_detalhe: f.detalhe.slice(0, 200) });
  await O.marcarTrabalho(env, t.id, [O.STATUS.falhou], { erro: `entrega recusada pela Meta (código ${f.codigo}): ${f.detalhe.slice(0, 160)}` });
  try { await enviarTexto(env, t.telefone, TEXTOS.entregaFalhouDefinitivo(p)); } catch (e) { console.error("[wa] aviso de entrega falhou", e); }
  return "falhou";
}
// Pedidos "pronto" do usuário (gerados, não entregues): tenta entregar agora. Chamado quando
// chega QUALQUER mensagem do número vinculado — a mensagem reabre a janela de 24 h.
async function entregarPendentes(env: Env, userId: string, prontosPre?: O.Trabalho[]): Promise<number> {
  let n = 0;
  // B2.3: a lista pode vir pré-carregada (lida pelo telefone, em paralelo); só valem os pedidos desta conta
  const prontos = prontosPre ? prontosPre.filter((t) => t.user_id === userId) : await O.trabalhosProntos(env, userId);
  for (const t of prontos) {
    try { if ((await entregarTrabalho(env, t, true)) === "enviado") n++; } catch (e) { console.error("[wa] entrega pendente", t.id, e); }
  }
  return n;
}
// A Meta pode aceitar o envio (200) e só depois avisar, pelo webhook de status, que a mensagem
// falhou (ex.: #131047, janela de 24 h). Se a mensagem era de uma entrega, só ELA volta para a
// lista do que falta e o pedido fica "pronto" — a próxima mensagem do professor (ou a varredura)
// reenvia o que faltou. Entrega ainda em andamento → "em_andamento" (o handler responde 500 e a
// Meta reentrega o status mais tarde).
export type FalhaEntrega = "reaberta" | "em_andamento" | "ignorada";
async function registrarFalhaDeEntrega(env: Env, idMensagem: string, codigo: number): Promise<FalhaEntrega> {
  if (!idMensagem) return "ignorada";
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_trabalhos?select=id,status,progresso&status=in.(entregando,enviado,pronto)&progresso->entrega_ids=cs.${encodeURIComponent(JSON.stringify([idMensagem]))}&limit=1`, { headers: cabecalhosDb(env) });
  if (!r.ok) throw new Error(`wa_trabalhos por mensagem ${r.status}`);
  const t = ((await r.json()) as O.Trabalho[])[0];
  if (!t) return "ignorada";
  if (t.status === O.STATUS.entregando) return "em_andamento";
  const pr = progressoDe(t);
  const indice = Number((pr.entrega_mapa as Record<string, number> | undefined)?.[idMensagem]);
  if (!Number.isInteger(indice)) return "ignorada";
  const faltam = [...new Set([...faltamDe(pr, Number.MAX_SAFE_INTEGER), indice])].sort((a, b) => a - b);
  const agora = new Date().toISOString();
  const ok = await O.marcarTrabalho(env, t.id, [O.STATUS.enviado, O.STATUS.pronto], { status: O.STATUS.pronto, concluido_em: null, progresso: { ...pr, fase: "pronto", entrega_faltam: faltam, entrega_falhou_em: agora, entrega_codigo: codigo, entrega_detalhe: `status "failed" da Meta na mensagem ${indice + 1} da entrega`, atualizado_em: agora } });
  if (ok) console.log(`[wa] entrega do pedido ${t.id.slice(0, 8)}: mensagem ${indice + 1} falhou depois do envio (código ${codigo}); voltou a "pronto"`);
  return ok ? "reaberta" : "ignorada";
}
// Pedidos que a fila marcou "falhou" por excesso de tentativas e ainda não avisados (um por vez;
// a reserva do aviso é um PATCH condicional, para dois robôs não avisarem em dobro; um aviso cujo
// envio falhou é tentado de novo depois de 10 min).
async function avisarFalhasSemAviso(env: Env): Promise<number> {
  const agora = new Date();
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_trabalhos?select=id,telefone,parametros,erro,progresso&${O.filtroDesistenciasSemAviso(agora)}&order=criado_em.asc&limit=1`, { headers: cabecalhosDb(env) });
  if (!r.ok) return 0;
  let n = 0;
  for (const t of (await r.json()) as O.Trabalho[]) {
    const reservado = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_trabalhos?id=eq.${encodeURIComponent(t.id)}&status=eq.falhou&or=(progresso->>avisado.is.null,progresso->>avisado.eq.falhou_envio)`, {
      method: "PATCH", headers: cabecalhosDb(env, { prefer: "return=representation" }), body: JSON.stringify({ progresso: { ...progressoDe(t), avisado: "sim", avisado_em: agora.toISOString() } }),
    });
    if (!reservado.ok || ((await reservado.json()) as unknown[]).length !== 1) continue;
    let envio: Envio | null = null;
    try { envio = await enviarTexto(env, t.telefone, TEXTOS.falhou(pedidoDe(t), motivoAmigavel(String(t.erro || "a geração foi interrompida repetidas vezes")))); } catch { envio = null; }
    if (envio?.ok) n++;
    else await O.marcarTrabalho(env, t.id, [O.STATUS.falhou], { progresso: { ...progressoDe(t), avisado: "falhou_envio", avisado_em: agora.toISOString() } });
  }
  return n;
}

const uuidValido = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const LIMITE_CORPO_OPERARIO = 100 * 1024 * 1024;

// POST ?operario=1 — Authorization: Bearer <OIDC do GitHub Actions> (ou WA_OPERARIO_TOKEN).
// JSON: { acao, trabalho_id?, dono?, estado?, resumo?, motivo?, definitivo? } · multipart (acao=entregar): trabalho_id, dono, rotulo, nome, arquivo.
// `dono` é o uuid devolvido no "pegar": só a execução que pegou o pedido pode mexer nele.
export async function tratarOperario(req: Request, env: Env): Promise<Response> {
  const auth = await O.autorizarOperario(env, req.headers.get("authorization"));
  if (!auth.ok) {
    console.warn(`[wa] operário recusado: ${auth.motivo}`);
    return json({ erro: auth.indisponivel ? "verificação indisponível, tente de novo" : "não autorizado", motivo: auth.motivo }, auth.indisponivel ? 503 : 401);
  }

  const tipo = (req.headers.get("content-type") || "").toLowerCase();
  const tamanho = Number(req.headers.get("content-length") || 0);
  if (tamanho > LIMITE_CORPO_OPERARIO) return json({ erro: "arquivo grande demais" }, 413);
  let acao = "", trabalhoId: string | null = null, dono = "", corpo: Record<string, unknown> = {};
  let arquivo: { rotulo: string; nome: string; bytes: Uint8Array<ArrayBuffer> } | null = null;
  if (tipo.startsWith("multipart/form-data")) {
    let fd: FormData;
    try { fd = await req.formData(); } catch { return json({ erro: "multipart inválido" }, 400); }
    acao = String(fd.get("acao") ?? "");
    const tid = fd.get("trabalho_id");
    trabalhoId = uuidValido(tid) ? tid : null;
    dono = uuidValido(fd.get("dono")) ? String(fd.get("dono")) : "";
    const f = fd.get("arquivo");
    if (f instanceof File) {
      if (f.size > O.TAMANHO_MAX_ARQUIVO) return json({ erro: "arquivo grande demais" }, 413);
      arquivo = { rotulo: String(fd.get("rotulo") ?? ""), nome: String(fd.get("nome") ?? f.name ?? ""), bytes: new Uint8Array(await f.arrayBuffer()) as Uint8Array<ArrayBuffer> };
    }
  } else {
    try { const j = JSON.parse(await req.text()); corpo = j && typeof j === "object" && !Array.isArray(j) ? j as Record<string, unknown> : {}; } catch { return json({ erro: "JSON inválido" }, 400); }
    acao = String(corpo.acao ?? "");
    trabalhoId = uuidValido(corpo.trabalho_id) ? corpo.trabalho_id : null;
    dono = uuidValido(corpo.dono) ? corpo.dono : "";
  }

  try {
    if (acao === "fila") return json({ ok: true, ...(await O.contarFila(env)) });

    if (acao === "pegar") {
      if (corpo.trabalho_id !== undefined && corpo.trabalho_id !== null && corpo.trabalho_id !== "" && !trabalhoId) return json({ erro: "trabalho_id inválido" }, 400);
      let avisadas = await avisarFalhasSemAviso(env).catch(() => 0);
      const r = await O.reivindicarTrabalho(env, trabalhoId);
      if (/esgotou/.test(r.motivo || "") || !r.trabalho) avisadas += await avisarFalhasSemAviso(env).catch(() => 0);   // a própria reivindicação pode ter marcado uma desistência
      if (!r.trabalho) return json({ trabalho: null, motivo: r.motivo, falhasAvisadas: avisadas });
      const t = r.trabalho;
      const meuDono = O.donoDe(t);
      const p = pedidoDe(t);
      const tentativas = Number(progressoDe(t).tentativas) || 1;
      let sessao: O.SessaoProfessor;
      try { sessao = await O.sessaoDoUsuario(env, t.user_id); } catch (e) {
        // sem sessão não há como gerar. Volta à fila SEM contar a tentativa de geração, com espera de 10 min;
        // na 3ª vez seguida, desiste e avisa (conta banida, sem e-mail, Auth recusando...).
        const falhasSessao = (Number(progressoDe(t).falhas_sessao) || 0) + 1;
        const agora = new Date();
        const motivo = `sessão do professor indisponível: ${String(e).slice(0, 120)}`;
        if (falhasSessao >= O.MAX_FALHAS_SESSAO) {
          await O.marcarTrabalho(env, t.id, [O.STATUS.gerando], { status: O.STATUS.falhou, erro: motivo, concluido_em: agora.toISOString(), progresso: { ...progressoDe(t), fase: "falhou", falhas_sessao: falhasSessao, avisado: "sim", atualizado_em: agora.toISOString() } }, meuDono);
          try { await enviarTexto(env, t.telefone, TEXTOS.falhou(p, motivoAmigavel(motivo))); } catch (e2) { console.error("[wa] aviso de falha de sessão", e2); }
          return json({ trabalho: null, motivo: "sessão do professor indisponível 3 vezes; pedido marcado como falhou", falhasAvisadas: avisadas });
        }
        await O.marcarTrabalho(env, t.id, [O.STATUS.gerando], { status: O.STATUS.pendente, iniciado_em: null, erro: motivo, progresso: { ...progressoDe(t), tentativas: tentativas - 1, falhas_sessao: falhasSessao, dono: null, fase: "refila", tentar_apos: new Date(agora.getTime() + O.ESPERA_REFILA_MS).toISOString(), atualizado_em: agora.toISOString() } }, meuDono);
        return json({ erro: "sessão do professor indisponível", detalhe: String(e).slice(0, 200) }, 503);
      }
      if (tentativas === 1) {   // avisa uma vez só; reexecuções são silenciosas. Falha no aviso não derruba o pegar.
        try { await enviarTexto(env, t.telefone, TEXTOS.gerando(p, P.minutosEstimados(p))); } catch (e) { console.error("[wa] aviso 'gerando' falhou", e); }
      }
      return json({ trabalho: { id: t.id, parametros: t.parametros, tentativa: tentativas }, dono: meuDono, sessao: { access_token: sessao.access_token, refresh_token: sessao.refresh_token, expires_in: sessao.expires_in }, falhasAvisadas: avisadas });
    }

    if (acao === "entregas_pendentes") {
      // varredura: destrava entregas abandonadas e tenta entregar os "pronto" cuja falha anterior não foi
      // janela fechada (essa, só a mensagem do professor reabre)
      const destravados = await O.destravarEntregas(env).catch(() => 0);
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_trabalhos?select=id,user_id,telefone,status,parametros,progresso,documentos,erro,criado_em,iniciado_em,concluido_em,simulado_id&${O.filtroProntosAcionaveis()}&order=criado_em.asc&limit=5`, { headers: cabecalhosDb(env) });
      if (!r.ok) throw new Error(`wa_trabalhos pronto ${r.status}`);
      let entregues = 0;
      for (const t of (await r.json()) as O.Trabalho[]) {
        try { if ((await entregarTrabalho(env, t, true)) === "enviado") entregues++; } catch (e) { console.error("[wa] varredura de entregas", t.id, e); }
      }
      const avisadas = await avisarFalhasSemAviso(env).catch(() => 0);
      return json({ ok: true, entregues, destravados, falhasAvisadas: avisadas });
    }

    if (!trabalhoId) return json({ erro: "trabalho_id obrigatório" }, 400);
    if (!dono) return json({ erro: "dono obrigatório (devolvido no pegar)" }, 400);

    if (acao === "progresso") {
      const t = await O.gravarProgresso(env, trabalhoId, dono, O.sanitizaProgresso(corpo.estado));
      return t ? json({ ok: true, status: t.status }) : json({ erro: "pedido não está em geração por esta execução" }, 409);
    }
    if (acao === "entregar") {
      if (!arquivo) return json({ erro: "arquivo ausente" }, 400);
      if (!(O.ROTULOS_ARQUIVO as readonly string[]).includes(arquivo.rotulo)) return json({ erro: "rótulo inválido" }, 400);
      if (!arquivo.bytes.length) return json({ erro: "arquivo vazio" }, 400);
      const t = await O.trabalhoPorId(env, trabalhoId);
      if (!t || t.status !== O.STATUS.gerando || O.donoDe(t) !== dono) return json({ erro: "pedido não está em geração por esta execução" }, 409);
      const ext = arquivo.rotulo.startsWith("pdf") ? "pdf" : "docx";
      const mime = O.MIMES_ACEITOS[ext];
      const nome = O.nomeArquivoSeguro(arquivo.nome, ext);
      const up = await O.subirMidia(env, arquivo.bytes, mime, nome);
      if (!up.ok) return json({ erro: "a Meta recusou a mídia", status: up.status, detalhe: up.detalhe }, up.status >= 500 || up.status === 429 ? 503 : 502);
      const doc: O.Documento = { rotulo: arquivo.rotulo, media_id: up.id, nome, mime, bytes: arquivo.bytes.length, em: new Date().toISOString() };
      const t2 = await O.anexarDocumento(env, trabalhoId, dono, doc);
      return t2 ? json({ ok: true, media_id: up.id, documentos: (t2.documentos || []).length }) : json({ erro: "pedido não está em geração por esta execução" }, 409);
    }
    if (acao === "concluir") {
      const t = await O.trabalhoPorId(env, trabalhoId);
      if (!t || t.status !== O.STATUS.gerando || O.donoDe(t) !== dono) return json({ erro: "pedido não está em geração por esta execução" }, 409);
      const docs = Array.isArray(t.documentos) ? t.documentos : [];
      if (!docs.length) return json({ erro: "nenhum documento entregue antes de concluir" }, 400);
      const resumo = resumoDaGeracao(corpo.resumo);
      const agora = new Date().toISOString();
      const t2 = await O.marcarTrabalho(env, trabalhoId, [O.STATUS.gerando], { simulado_id: resumo.simuladoId, progresso: { ...progressoDe(t), fase: "concluido", resumo, total: resumo.total, prontas: resumo.prontas, atualizado_em: agora } }, dono);
      if (!t2) return json({ erro: "pedido não está em geração por esta execução" }, 409);
      const resultado = await entregarTrabalho(env, t2, false, dono);
      return json({ ok: resultado !== "falhou", status: resultado });
    }
    if (acao === "falhou") {
      const t = await O.trabalhoPorId(env, trabalhoId);
      if (!t || t.status !== O.STATUS.gerando || O.donoDe(t) !== dono) return json({ erro: "pedido não está em geração por esta execução" }, 409);
      const motivo = String(corpo.motivo ?? "erro desconhecido").replace(/\s+/g, " ").slice(0, 300);
      const tentativas = Number(progressoDe(t).tentativas) || 1;
      const agora = new Date();
      if (tentativas < O.MAX_TENTATIVAS_TRABALHO && corpo.definitivo !== true) {
        // volta à fila para OUTRA varredura (daqui a 10 min) tentar de novo; conta a tentativa; o professor não é incomodado ainda
        await O.marcarTrabalho(env, trabalhoId, [O.STATUS.gerando], { status: O.STATUS.pendente, iniciado_em: null, erro: motivo, progresso: { ...progressoDe(t), fase: "refila", dono: null, ultimo_erro: motivo, tentar_apos: new Date(agora.getTime() + O.ESPERA_REFILA_MS).toISOString(), atualizado_em: agora.toISOString() } }, dono);
        return json({ ok: true, status: "pendente", tentativas });
      }
      await O.marcarTrabalho(env, trabalhoId, [O.STATUS.gerando], { status: O.STATUS.falhou, erro: motivo, concluido_em: agora.toISOString(), progresso: { ...progressoDe(t), fase: "falhou", avisado: "sim", atualizado_em: agora.toISOString() } }, dono);
      try { await enviarTexto(env, t.telefone, TEXTOS.falhou(pedidoDe(t), motivoAmigavel(motivo))); } catch (e) { console.error("[wa] aviso de falha", e); }
      return json({ ok: true, status: "falhou" });
    }
    return json({ erro: `ação desconhecida: ${acao.slice(0, 40)}` }, 400);
  } catch (e) {
    console.error("[wa] operário:", acao, e);
    return json({ erro: "falha interna", detalhe: String(e).slice(0, 200) }, 500);
  }
}

// B2.3 — PRÉ-CARGA. A função roda perto da Meta (EUA) e o banco fica em São Paulo: cada ida e
// volta custa ~0,6 s. As leituras que não dependem umas das outras (perfil, estado da conversa,
// pedido já criado para este wamid, simulados prontos) saem em paralelo com o registro da
// mensagem — cinco idas e voltas viram uma. `undefined` = não pré-carregado (a leitura falhou):
// quem usa lê na hora, como antes, e o erro aparece no mesmo lugar de sempre.
interface PreCarga {
  conversa?: Awaited<ReturnType<typeof lerConversa>>;
  jaCriado?: Awaited<ReturnType<typeof trabalhoDoWamid>>;
  prontos?: O.Trabalho[];
}
const valorOuNada = <T>(r: PromiseSettledResult<T>): T | undefined => (r.status === "fulfilled" ? r.value : undefined);

// Trabalho que não precisa segurar a resposta à Meta: no Edge Runtime do Supabase segue em segundo
// plano (waitUntil); fora dele (testes), devolve a promessa para ser aguardada.
function emSegundoPlano(p: Promise<unknown>): Promise<unknown> | undefined {
  const seguro = p.catch((e) => console.error("[wa] segundo plano", e));
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) { rt.waitUntil(seguro); return undefined; }
  return seguro;
}

export async function processarMensagem(env: Env, msg: MsgMeta, nomePerfil: string, payload: unknown): Promise<string> {
  const telefone = String(msg.from || "").replace(/\D/g, "");
  const texto = msg.type === "text" ? String(msg.text?.body ?? "") : null;
  if (!telefone || !msg.id) return "ignorado_sem_origem";

  // no registro, respostas interativas (formulário, listas, botões) ficam legíveis em wa_mensagens.texto
  const textoRegistro = texto ?? (msg.type === "interactive" ? JSON.stringify(msg.interactive ?? {}).slice(0, 2000) : null);
  const [registroR, perfilR, conversaR, jaCriadoR, prontosR] = await Promise.allSettled([
    registrarMensagem(env, { wamid: msg.id, telefone, tipo: msg.type, texto: textoRegistro, payload }),
    perfilPorTelefone(env, telefone),
    lerConversa(env, telefone),
    trabalhoDoWamid(env, msg.id),
    O.trabalhosProntosDoTelefone(env, telefone),
  ]);
  if (registroR.status === "rejected") throw registroR.reason;   // sem registro não se responde (mesma regra de antes)
  const registro = registroR.value;
  if (registro === "duplicada") return "duplicada";
  if (registro === "em_andamento") return "duplicada_em_andamento";   // outra execução cuida; handler devolve 500 para a Meta tentar depois
  const pre: PreCarga = { conversa: valorOuNada(conversaR), jaCriado: valorOuNada(jaCriadoR), prontos: valorOuNada(prontosR) };

  const lida = marcarLida(env, msg.id);
  (globalThis as any).EdgeRuntime?.waitUntil?.(lida); // termina em segundo plano, se o runtime oferecer

  let acao = "ignorado";
  let resposta = "";
  let mensagens: Record<string, unknown>[] = [];
  let userId: string | null = null;
  try {
    const perfil = perfilR.status === "fulfilled" ? perfilR.value : await perfilPorTelefone(env, telefone);
    userId = perfil?.user_id ?? null;

    const codigo = texto !== null ? extrairCodigoVinculo(texto) : null;
    if (codigo) {
      if (await tentativasRecentes(env, telefone) >= MAX_TENTATIVAS_CODIGO) {
        acao = "vinculo_bloqueado"; resposta = TEXTOS.vinculoBloqueado;
      } else {
        const r = await concluirVinculo(env, codigo, telefone, nomePerfil);
        if (r) { acao = "vinculo_ok"; userId = r.vinculado_user_id; resposta = TEXTOS.vinculoOk(nomePerfil, mascararEmail(r.vinculado_email)); }
        else { acao = "vinculo_invalido"; resposta = TEXTOS.vinculoInvalido; }
      }
      mensagens = [objetoTexto(resposta)];
    } else if (!perfil) {
      acao = "nao_vinculado"; resposta = TEXTOS.naoVinculado; mensagens = [objetoTexto(resposta)];
    } else {
      // etapa C: simulados prontos que não puderam ser entregues (janela de 24 h fechada) saem agora —
      // esta mensagem do professor reabriu a janela. Independente da resposta abaixo.
      const entregues = await entregarPendentes(env, perfil.user_id, pre.prontos).catch((e) => { console.error("[wa] entregas pendentes", e); return 0; });
      // etapa B1: número vinculado → formulário por perguntas, confirmação, fila, comandos
      const saida = await tratarPedido(env, msg, telefone, texto, { ...perfil, whatsapp_nome: perfil.whatsapp_nome || nomePerfil || null }, pre);
      acao = saida.acao; resposta = (entregues ? `[entregou ${entregues} simulado(s) pronto(s)] ` : "") + saida.resumo; mensagens = saida.mensagens;
    }
    const envio = await enviarSequencia(env, telefone, mensagens);
    if (!envio.ok) acao += envio.transitorio ? "_envio_falhou" : "_envio_recusado";   // falhou → 500 e reentrega; recusado → fica registrado, sem reentrega
    const marcacao = atualizarMensagem(env, msg.id, { acao, resposta: envio.ok ? resposta : `${resposta}\n\n[envio: ${envio.detalhe.slice(0, 200)}]`, user_id: userId });
    // B2.3: com a resposta já enviada, a marcação "processada" não precisa segurar o 200 para a Meta.
    // Quando o envio falhou, a marcação fica síncrona: é ela que faz a reentrega da Meta reprocessar.
    if (envio.ok) { const fim = emSegundoPlano(marcacao); if (fim) await fim; } else await marcacao;
  } catch (e) {
    console.error("[wa] erro ao processar", msg.id, e);
    await atualizarMensagem(env, msg.id, { acao: "erro", resposta: String(e).slice(0, 500), user_id: userId });
    acao = "erro";
  }
  return acao;
}

// ---------------------------------------------------------------------------
// Assinatura da WABA ao app (camada que faz a Meta ENCAMINHAR mensagens reais).
// Sem ela, a URL do webhook fica configurada mas nada chega. GET lista; se o app
// não estiver na lista, POST assina. Só roda pelo selftest (frase secreta).
// ---------------------------------------------------------------------------
async function garantirAssinaturaWaba(env: Env): Promise<Record<string, unknown>> {
  if (!env.WHATSAPP_WABA_ID) return { erro: "WHATSAPP_WABA_ID não configurado" };
  const url = `https://graph.facebook.com/${env.GRAPH_VERSAO}/${env.WHATSAPP_WABA_ID}/subscribed_apps`;
  const cab = { authorization: `Bearer ${env.WHATSAPP_TOKEN}` };
  const listar = async () => {
    const r = await fetch(url, { headers: cab, signal: AbortSignal.timeout(TIMEOUT_GRAPH_MS) });
    const j = await r.json().catch(() => ({}));
    const apps = ((j?.data ?? []) as any[]).map((a) => ({ id: String(a?.whatsapp_business_api_data?.id ?? ""), nome: String(a?.whatsapp_business_api_data?.name ?? "") }));
    return { http: r.status, apps, erro: j?.error?.message };
  };
  const antes = await listar();
  const jaAssinado = antes.apps.some((a) => a.id === META_APP_ID);
  if (jaAssinado) return { wabaId: env.WHATSAPP_WABA_ID, appEsperado: META_APP_ID, antes, acao: "já estava assinado" };
  const r = await fetch(url, { method: "POST", headers: cab, signal: AbortSignal.timeout(TIMEOUT_GRAPH_MS) });
  const jr = await r.json().catch(() => ({}));
  const depois = await listar();
  return { wabaId: env.WHATSAPP_WABA_ID, appEsperado: META_APP_ID, antes, acao: "assinatura solicitada", respostaPost: { http: r.status, ...jr }, depois, assinadoAgora: depois.apps.some((a) => a.id === META_APP_ID) };
}

// ---------------------------------------------------------------------------
// selftest: presença dos secrets (só true/false) e acesso às tabelas
// ---------------------------------------------------------------------------
async function selftest(env: Env, meta = false): Promise<Response> {
  const presentes: Record<string, boolean> = {};
  const brutosComEspacos: string[] = [];
  for (const k of ["WHATSAPP_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_WABA_ID", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as (keyof Env)[]) {
    presentes[k] = !!env[k];
    const bruto = Deno.env.get(k);                       // valor como foi colado (lerEnv já limpa)
    if (bruto !== undefined && bruto !== bruto.trim()) brutosComEspacos.push(k);
  }
  const formatoOk = {
    WHATSAPP_APP_SECRET_hex32: /^[0-9a-f]{32}$/i.test(env.WHATSAPP_APP_SECRET),   // App Secret da Meta: 32 hexadecimais
    WHATSAPP_PHONE_NUMBER_ID_numerico: /^\d{10,20}$/.test(env.WHATSAPP_PHONE_NUMBER_ID),
    WHATSAPP_TOKEN_tamanho_plausivel: env.WHATSAPP_TOKEN.length >= 100,
  };
  const tabelas: Record<string, string> = {};
  for (const t of ["perfis", "wa_vinculos", "wa_mensagens", "wa_conversas", "wa_trabalhos"]) {
    try {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${t}?select=*&limit=0`, { method: "HEAD", headers: cabecalhosDb(env, { prefer: "count=exact" }) });
      tabelas[t] = r.ok ? `ok (${(r.headers.get("content-range") || "").split("/")[1] ?? "?"} linhas)` : `HTTP ${r.status}`;
    } catch (e) { tabelas[t] = "erro: " + String(e).slice(0, 80); }
  }
  const assinaturaWaba = meta ? await garantirAssinaturaWaba(env) : undefined;
  const operario = {
    repositorio: env.WA_OPERARIO_REPO || O.REPO_PADRAO,
    repositorioId: env.WA_OPERARIO_REPO_ID === undefined ? O.REPO_ID_PADRAO : (env.WA_OPERARIO_REPO_ID || "(conferência desligada)"),
    workflow: O.WORKFLOW_OPERARIO,
    disparoImediato: !!env.WA_GITHUB_TOKEN,              // sem isso, a varredura do cron (10 min) pega a fila
    segredoCompartilhado: !!env.WA_OPERARIO_TOKEN,       // opcional; o caminho normal é o OIDC do GitHub
    audienciaOidc: O.AUDIENCIA_OIDC,
  };
  return json({ funcao: "whatsapp-webhook", versao: VERSAO, phoneNumberIdConfigurado: env.WHATSAPP_PHONE_NUMBER_ID, graph: env.GRAPH_VERSAO, secretsPresentes: presentes, secretsComEspacosNasPontas: brutosComEspacos, formatoOk, tabelas, assinaturaWaba, operario });
}

// ---------------------------------------------------------------------------
// handler HTTP
// ---------------------------------------------------------------------------
export async function handler(req: Request, env: Env = lerEnv()): Promise<Response> {
  const u = new URL(req.url);

  if (req.method === "GET") {
    if (u.searchParams.get("selftest") === "1") {
      // diagnóstico só com a mesma frase secreta usada na verificação da Meta
      const t = u.searchParams.get("t") || "";
      if (!env.WHATSAPP_VERIFY_TOKEN || !igualSeguro(t, env.WHATSAPP_VERIFY_TOKEN)) return json({ erro: "não autorizado" }, 401);
      return await selftest(env, u.searchParams.get("meta") === "1");
    }
    // Verificação do webhook pela Meta
    const modo = u.searchParams.get("hub.mode");
    const token = u.searchParams.get("hub.verify_token") || "";
    const desafio = u.searchParams.get("hub.challenge") || "";
    if (modo === "subscribe" && env.WHATSAPP_VERIFY_TOKEN && igualSeguro(token, env.WHATSAPP_VERIFY_TOKEN)) {
      return new Response(desafio, { status: 200, headers: { "content-type": "text/plain" } });
    }
    return json({ erro: "verificação recusada" }, 403);
  }

  if (req.method !== "POST") return json({ erro: "método não suportado" }, 405);

  // Etapa C: chamadas do robô (autenticadas por OIDC do GitHub, não pela assinatura da Meta)
  if (u.searchParams.get("operario") === "1") return await tratarOperario(req, env);

  const corpo = await req.text();
  if (!env.WHATSAPP_APP_SECRET || !(await assinaturaValida(env, req.headers.get("x-hub-signature-256"), corpo))) {
    console.warn("[wa] POST com assinatura inválida ou ausente");
    return json({ erro: "assinatura inválida" }, 401);
  }

  let dados: any;
  try { dados = JSON.parse(corpo); } catch { return json({ erro: "JSON inválido" }, 400); }
  if (dados?.object !== "whatsapp_business_account") return json({ ok: true, ignorado: "objeto desconhecido" });

  const resultados: string[] = [];
  for (const entry of dados.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "messages") continue;
      const v = ch.value ?? {};
      // eventos de status (enviada/entregue/lida/FALHOU) não geram ação, mas ficam no log:
      // uma falha de entrega (ex.: destinatário não é conta de WhatsApp) só aparece aqui
      for (const st of v.statuses ?? []) {
        const erros = (st?.errors ?? []).map((e: any) => `${e?.code} ${e?.title ?? ""} ${e?.error_data?.details ?? ""}`.trim());
        console.log(`[wa] status ${st?.status} para ${st?.recipient_id} (msg ${String(st?.id ?? "").slice(-12)})${erros.length ? " ERROS: " + erros.join(" | ") : ""}`);
        if (erros.length) {
          resultados.push("status_falhou");
          // etapa C: se a mensagem que falhou era de uma entrega de simulado, o pedido volta a "pronto"
          try {
            const fe = await registrarFalhaDeEntrega(env, String(st?.id ?? ""), Number(st?.errors?.[0]?.code) || 0);
            if (fe === "reaberta") resultados.push("entrega_reaberta");
            if (fe === "em_andamento") resultados.push("entrega_em_andamento");   // → 500: a Meta reentrega o status quando a entrega já tiver terminado
          } catch (e) { console.error("[wa] status failed → entrega", e); }
        }
      }
      const nomes: Record<string, string> = {};
      for (const c of v.contacts ?? []) if (c?.wa_id) nomes[String(c.wa_id)] = String(c.profile?.name ?? "");
      const unicoContato = (v.contacts?.length === 1 ? String(v.contacts[0]?.profile?.name ?? "") : "");
      for (const m of v.messages ?? []) {
        // no Brasil o wa_id do contato pode vir sem o 9º dígito e não bater com "from": usa o único contato do lote
        const nome = nomes[String(m.from)] ?? unicoContato;
        resultados.push(await processarMensagem(env, m, nome, { entryId: entry.id, value: { metadata: v.metadata, contacts: v.contacts, message: m } }));
      }
    }
  }
  console.log(`[wa] POST processado: ${resultados.join(", ") || "sem mensagens"}`);
  // "status_falhou" é só informativo (não pede reentrega)
  const houveFalha = resultados.some((r) => r === "erro" || r === "duplicada_em_andamento" || r === "entrega_em_andamento" || r.endsWith("_envio_falhou"));
  // Com falha, devolve 500: a Meta reentrega mais tarde e a mensagem é reprocessada
  // (registrarMensagem aceita reentrega de linhas com acao "erro"/"*_envio_falhou" ou travadas).
  // "*_envio_recusado" (erro permanente da Graph) NÃO pede reentrega: repetir não resolveria.
  return json({ ok: !houveFalha, resultados }, houveFalha ? 500 : 200);
}

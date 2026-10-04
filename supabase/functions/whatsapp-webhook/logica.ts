// whatsapp-webhook — lógica (etapas A1 e B1). Separada do index.ts para poder ser
// testada localmente sem abrir servidor.
//
// O que faz:
//  GET  ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...  → verificação do webhook (Meta)
//  GET  ?selftest=1&t=<verify token>[&meta=1]                      → diagnóstico (só nomes de secrets presentes, nunca valores)
//  POST (assinado com X-Hub-Signature-256)                         → mensagens recebidas:
//        "Vincular conta 123456" → conclui o pareamento telefone ↔ conta do app
//        número vinculado, qualquer mensagem → FORMULÁRIO POR PERGUNTAS (listas e botões): área,
//          disciplina, temas, quantidade, dificuldade, recurso visual → resumo → "Sim" grava em
//          wa_trabalhos (fila da etapa C). Estado da conversa em wa_conversas (expira em 1 h).
//        CANCELAR / STATUS / AJUDA → comandos
//        (mensagens repetidas pela Meta: 200 se já concluída, 500 se outra execução está
//         processando agora ou se a anterior falhou — aí a Meta reentrega e processamos de novo)
//        número não vinculado → instrução de como vincular
//
// Segurança: toda chamada POST precisa da assinatura HMAC-SHA256 feita com o
// App Secret; sem ela, 401 e nada é processado. Cada mensagem é registrada em
// wa_mensagens pelo id da Meta (chave primária) — repetições são ignoradas.

export const VERSAO = "B1.0";

import * as P from "./pedido.ts";

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
  WA_OPERARIO_URL?: string;      // etapa C: para onde avisar que há um pedido novo (vazio = fila apenas)
  WA_OPERARIO_TOKEN?: string;    // etapa C: segredo enviado ao operário
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
    WA_OPERARIO_URL: g("WA_OPERARIO_URL"),
    WA_OPERARIO_TOKEN: g("WA_OPERARIO_TOKEN"),
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

// "Vincular conta 123456", "vincular 123456", "VINCULAR CONTA: 123456" → "123456"
export function extrairCodigoVinculo(texto: string): string | null {
  // normaliza espaços "especiais" que teclados de celular inserem (NBSP, zero-width) e acentos ("víncular")
  const t = String(texto || "").replace(/[\u00a0\u2000-\u200b\ufeff]/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
async function postarObjeto(env: Env, para: string, objeto: Record<string, unknown>): Promise<{ status: number; detalhe: string; codigo: number; transitorio: boolean }> {
  const url = `https://graph.facebook.com/${env.GRAPH_VERSAO}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...objeto, to: para }),
    signal: AbortSignal.timeout(TIMEOUT_GRAPH_MS),   // estoura → exceção → acao "erro" → 500 → Meta reentrega
  });
  const completo = await resp.text();
  return { status: resp.status, detalhe: completo.slice(0, 300), codigo: resp.ok ? 0 : codigoErroGraph(completo), transitorio: !resp.ok && envioTransitorio(resp.status, completo) };
}

export async function enviarObjeto(env: Env, para: string, objeto: Record<string, unknown>): Promise<{ ok: boolean; transitorio: boolean; detalhe: string; paraUsado: string }> {
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
  return { ok, transitorio: r.transitorio, detalhe: r.detalhe, paraUsado };
}

export function objetoTexto(corpo: string): Record<string, unknown> {
  return { type: "text", text: { preview_url: false, body: corpo } };
}
export async function enviarTexto(env: Env, para: string, corpo: string): Promise<{ ok: boolean; transitorio: boolean; detalhe: string; paraUsado: string }> {
  return await enviarObjeto(env, para, objetoTexto(corpo));
}

// Várias mensagens em sequência (ex.: aviso + pergunta). Para no primeiro envio que falhar.
async function enviarSequencia(env: Env, para: string, objetos: Record<string, unknown>[]): Promise<{ ok: boolean; transitorio: boolean; detalhe: string; paraUsado: string }> {
  let ultimo = { ok: true, transitorio: false, detalhe: "", paraUsado: para };
  for (const o of objetos) {
    ultimo = await enviarObjeto(env, para, o);
    if (!ultimo.ok) break;
  }
  return ultimo;
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

export interface TrabalhoResumo { id: string; status: string; criado_em: string; parametros: Record<string, unknown>; erro?: string | null; concluido_em?: string | null }
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
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/wa_trabalhos?select=id,status,criado_em,parametros,erro,concluido_em&user_id=eq.${encodeURIComponent(userId)}${desde}&order=criado_em.desc&limit=${limite}`, { headers: cabecalhosDb(env) });
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
// Etapa C: avisa o operário que há pedido novo. Sem URL configurada, não faz nada
// (o pedido fica "pendente" na fila). Falha aqui NÃO derruba o pedido: fica registrada.
export const TIMEOUT_OPERARIO_MS = 8_000;
async function acionarOperario(env: Env, trabalhoId: string): Promise<boolean> {
  if (!env.WA_OPERARIO_URL) return false;
  try {
    const r = await fetch(env.WA_OPERARIO_URL, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.WA_OPERARIO_TOKEN ?? ""}` },
      body: JSON.stringify({ trabalho_id: trabalhoId }), signal: AbortSignal.timeout(TIMEOUT_OPERARIO_MS),
    });
    if (!r.ok) console.error(`[wa] operário respondeu ${r.status}`);
    return r.ok;
  } catch (e) { console.error("[wa] operário inacessível", e); return false; }
}

// ---------------------------------------------------------------------------
// textos das respostas (etapa A1)
// ---------------------------------------------------------------------------
export const TEXTOS = {
  vinculoOk: (nome: string, emailMascarado: string) =>
    `Pronto${nome ? ", " + nome : ""}! Este número ficou vinculado à sua conta do Gerador ENEM${emailMascarado ? ` (${emailMascarado})` : ""}.\n\n` +
    `Para pedir um simulado, é só mandar qualquer mensagem (por exemplo "oi"): eu faço 6 perguntas rápidas — área, disciplina, temas, quantidade, nível e recurso visual — e você confirma.`,
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
  pedidoNaFila: (numero: string, minutos: number, operarioAtivo: boolean) =>
    (operarioAtivo
      ? `⏳ Pedido confirmado e na fila de geração. Tempo estimado: cerca de ${minutos} min; o PDF chega nesta conversa. Enquanto a geração não começar, CANCELAR desfaz o pedido.`
      : `✅ Pedido confirmado e registrado na fila (nº ${numero}). A geração automática ainda está sendo ligada; assim que estiver ativa, o PDF chega nesta conversa. Enquanto estiver na fila, CANCELAR desfaz o pedido.`),
  limiteDiario: (pedidasHoje: number, limite: number) => limite <= 0
    ? `Sua conta está sem cota para pedidos pelo WhatsApp (limite diário 0). Fale com o administrador do Gerador ENEM.`
    : `Hoje você já pediu ${pedidasHoje} questões pelo WhatsApp e o limite diário é ${limite}. Peça menos questões ou volte amanhã.`,
  cancelado: (n: number) => n > 0 ? `Cancelei ${n === 1 ? "o pedido que estava na fila" : n + " pedidos que estavam na fila"}. Quando quiser outro, é só mandar uma mensagem.` : `Não havia pedido na fila para cancelar (pedidos já em geração não podem ser desfeitos). Quando quiser um simulado, é só mandar uma mensagem.`,
  semPedidos: `Você ainda não fez nenhum pedido por aqui. Mande qualquer mensagem e eu faço as perguntas do simulado.`,
  status: (t: TrabalhoResumo) => {
    const p = t.parametros as unknown as P.Pedido;
    const rot: Record<string, string> = { pendente: "na fila, aguardando o gerador", gerando: "gerando agora", enviado: "enviado ✅", falhou: "falhou ❌", cancelado: "cancelado" };
    return `Último pedido (${new Date(t.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}): ${p?.quantidade ?? "?"} questões de ${p?.disciplina ?? "?"} — ${rot[t.status] ?? t.status}${t.erro ? `\nMotivo: ${String(t.erro).slice(0, 200)}` : ""}`;
  },
  ajuda: `Para pedir um simulado, mande qualquer mensagem: eu faço 6 perguntas (área, disciplina, temas, quantidade, nível e recurso visual) e você confirma. Comandos: STATUS mostra o último pedido · CANCELAR descarta o formulário em andamento ou desfaz um pedido que ainda está na fila.`,
};

// ---------------------------------------------------------------------------
// processamento de uma mensagem recebida
// ---------------------------------------------------------------------------
interface MsgMeta { from: string; id: string; type: string; text?: { body?: string }; timestamp?: string; interactive?: { type?: string; nfm_reply?: { response_json?: string; name?: string }; list_reply?: { id?: string; title?: string }; button_reply?: { id?: string; title?: string } } }

// Comandos de texto do professor (número vinculado).
export function comandoDe(texto: string | null): "cancelar" | "status" | "ajuda" | null {
  const t = String(texto ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[!.\s]+$/, "");
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

async function tratarPedido(env: Env, msg: MsgMeta, telefone: string, texto: string | null, perfil: Perfil): Promise<Saida> {
  const userId = perfil.user_id;
  const conversa = await lerConversa(env, telefone);
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
  const jaCriado = await trabalhoDoWamid(env, msg.id);
  if (jaCriado) {
    const pedido = jaCriado.parametros as unknown as P.Pedido;
    const acionado = jaCriado.status === "pendente" ? await acionarOperario(env, jaCriado.id) : true;
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
      if (feito) { const t = TEXTOS.pedidoNaFila(feito.id.slice(0, 8), P.minutosEstimados(feito.parametros as unknown as P.Pedido), feito.status !== "pendente" || !!env.WA_OPERARIO_URL); const msgs = [objetoTexto(t)]; await encerrarConversa(env, telefone, userId, msg.id, msgs); return { acao: "pedido_na_fila", mensagens: msgs, resumo: t }; }
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

export async function processarMensagem(env: Env, msg: MsgMeta, nomePerfil: string, payload: unknown): Promise<string> {
  const telefone = String(msg.from || "").replace(/\D/g, "");
  const texto = msg.type === "text" ? String(msg.text?.body ?? "") : null;
  if (!telefone || !msg.id) return "ignorado_sem_origem";

  // no registro, respostas interativas (formulário, listas, botões) ficam legíveis em wa_mensagens.texto
  const textoRegistro = texto ?? (msg.type === "interactive" ? JSON.stringify(msg.interactive ?? {}).slice(0, 2000) : null);
  const registro = await registrarMensagem(env, { wamid: msg.id, telefone, tipo: msg.type, texto: textoRegistro, payload });
  if (registro === "duplicada") return "duplicada";
  if (registro === "em_andamento") return "duplicada_em_andamento";   // outra execução cuida; handler devolve 500 para a Meta tentar depois

  const lida = marcarLida(env, msg.id);
  (globalThis as any).EdgeRuntime?.waitUntil?.(lida); // termina em segundo plano, se o runtime oferecer

  let acao = "ignorado";
  let resposta = "";
  let mensagens: Record<string, unknown>[] = [];
  let userId: string | null = null;
  try {
    const perfil = await perfilPorTelefone(env, telefone);
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
      // etapa B1: número vinculado → formulário por perguntas, confirmação, fila, comandos
      const saida = await tratarPedido(env, msg, telefone, texto, { ...perfil, whatsapp_nome: perfil.whatsapp_nome || nomePerfil || null });
      acao = saida.acao; resposta = saida.resumo; mensagens = saida.mensagens;
    }
    const envio = await enviarSequencia(env, telefone, mensagens);
    if (!envio.ok) acao += envio.transitorio ? "_envio_falhou" : "_envio_recusado";   // falhou → 500 e reentrega; recusado → fica registrado, sem reentrega
    await atualizarMensagem(env, msg.id, { acao, resposta: envio.ok ? resposta : `${resposta}\n\n[envio: ${envio.detalhe.slice(0, 200)}]`, user_id: userId });
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
  return json({ funcao: "whatsapp-webhook", versao: VERSAO, phoneNumberIdConfigurado: env.WHATSAPP_PHONE_NUMBER_ID, graph: env.GRAPH_VERSAO, secretsPresentes: presentes, secretsComEspacosNasPontas: brutosComEspacos, formatoOk, tabelas, assinaturaWaba, operarioConfigurado: !!env.WA_OPERARIO_URL });
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
        if (erros.length) resultados.push("status_falhou");
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
  const houveFalha = resultados.some((r) => r === "erro" || r === "duplicada_em_andamento" || r.endsWith("_envio_falhou"));
  // Com falha, devolve 500: a Meta reentrega mais tarde e a mensagem é reprocessada
  // (registrarMensagem aceita reentrega de linhas com acao "erro"/"*_envio_falhou" ou travadas).
  // "*_envio_recusado" (erro permanente da Graph) NÃO pede reentrega: repetir não resolveria.
  return json({ ok: !houveFalha, resultados }, houveFalha ? 500 : 200);
}

// Testes locais da lógica do webhook (sem rede): assinatura, verificação,
// dedupe, pareamento, bloqueio, reprocessamento, respostas; na etapa B1, o formulário
// por perguntas, confirmação, fila e comandos; na etapa C, o atendimento ao robô
// (OIDC do GitHub falso, sessão do professor, fila, mídia, entrega, janela de 24 h).
// Roda com: deno test -A --no-check teste_logica.ts
import {
  handler, assinaturaHmacSha256, extrairCodigoVinculo, mascararEmail, decidirReentrega, envioTransitorio, formaAlternativaBr,
  TEXTOS, MAX_TENTATIVAS_CODIGO, TRAVADA_APOS_MS, REPROCESSAR_ATE_MS, comandoDe, inicioDoDiaBrasilia, resumoDaGeracao, motivoAmigavel, type Env,
} from "./logica.ts";
import * as P from "./pedido.ts";
import * as O from "./operario.ts";

const env: Env = {
  WHATSAPP_TOKEN: "TOKEN_TESTE",
  WHATSAPP_APP_SECRET: "segredo-de-teste-123",
  WHATSAPP_VERIFY_TOKEN: "fraseVerificacaoTeste2026",
  WHATSAPP_PHONE_NUMBER_ID: "1382046324982726",
  WHATSAPP_WABA_ID: "935766732459650",
  SUPABASE_URL: "https://db.teste",
  SUPABASE_SERVICE_ROLE_KEY: "service-teste",
  GRAPH_VERSAO: "v25.0",
};
const DONO = "52e6a6ea-b394-4958-8294-06ff2f5091de";


// ---- banco falso em memória + registro das chamadas ------------------------
const banco = { mensagens: new Map<string, any>(), perfis: new Map<string, any>(), vinculos: [] as any[], conversas: new Map<string, any>(), trabalhos: [] as any[] };
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const enviosWa: any[] = [];
let graphFalha: false | "permanente" | "transitorio" = false;   // simula Graph API recusando o envio
let contagemFora = false;        // simula PostgREST falhando na contagem de tentativas
let graphDemoraMs = 0;           // simula Graph API lenta (para testar simultaneidade)
let dbDemoraMs = 0;              // simula banco lento na reserva do "Sim"
let wabaAssinada = false;        // simula a assinatura WABA→app na Meta
let listaTestes: string[] | null = null;   // se definida, só esses números são aceitos pela Graph (#131030 para os demais)
let graphJanelaFechada = false;  // etapa C: simula #131047 (janela de 24 h fechada) no envio de mensagens
let midiasSubidas: { nome: string; tipo: string; bytes: number }[] = [];   // etapa C: uploads em /media
let dispatches: any[] = [];      // etapa C: chamadas a api.github.com/.../dispatches
let authFalha = false;           // etapa C: simula Auth admin indisponível
let jwksFora = false;            // etapa C: simula o JWKS do GitHub indisponível
let graphFalhaApos: number | null = null;   // etapa C: a Graph aceita N envios e recusa (transitório) o seguinte
let enviosOkSeguidos = 0;

function resetar() { banco.mensagens.clear(); banco.perfis.clear(); banco.vinculos.length = 0; banco.conversas.clear(); banco.trabalhos.length = 0; chamadas.length = 0; enviosWa.length = 0; graphFalha = false; contagemFora = false; graphDemoraMs = 0; listaTestes = null; dbDemoraMs = 0; graphJanelaFechada = false; midiasSubidas = []; dispatches = []; authFalha = false; jwksFora = false; graphFalhaApos = null; enviosOkSeguidos = 0; O.limparCacheJwks(); }
const param = (url: string, k: string) => { const v = new URL(url).searchParams.get(k); return v === null ? null : decodeURIComponent(v); };

// ---- OIDC do GitHub falso: par de chaves RSA gerado aqui; o JWKS "público" sai pelo fetch falso ----
const parChaves = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwkPublica = await crypto.subtle.exportKey("jwk", parChaves.publicKey);
const chavesJwks = [{ kty: "RSA", kid: "kid-teste", use: "sig", alg: "RS256", n: jwkPublica.n, e: jwkPublica.e }];
const parChavesIntruso = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
async function tokenOidc(sobrescreve: Record<string, unknown> = {}, chave: CryptoKey = parChaves.privateKey, kid = "kid-teste"): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  const claims = { iss: O.EMISSOR_GITHUB, aud: O.AUDIENCIA_OIDC, exp: agora + 300, iat: agora, nbf: agora - 10, sub: "repo:Turco2025/Enem:ref:refs/heads/main", repository: "Turco2025/Enem", repository_id: O.REPO_ID_PADRAO, repository_owner: "Turco2025", ref: "refs/heads/main", event_name: "repository_dispatch", workflow_ref: "Turco2025/Enem/.github/workflows/wa-operario.yml@refs/heads/main", ...sobrescreve };
  const enc = (o: unknown) => O.bytesParaBase64Url(new TextEncoder().encode(JSON.stringify(o)));
  const cab = enc({ alg: "RS256", typ: "JWT", kid });
  const dados = `${cab}.${enc(claims)}`;
  const ass = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chave, new TextEncoder().encode(dados));
  return `${dados}.${O.bytesParaBase64Url(new Uint8Array(ass))}`;
}

globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
  const metodo = init?.method ?? "GET";
  const corpo: any = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  chamadas.push({ url, metodo, corpo });
  const j = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });

  // etapa C — JWKS do GitHub, Auth admin do Supabase, dispatch do GitHub
  if (url === O.JWKS_GITHUB) return jwksFora ? new Response("indisponível", { status: 503 }) : j({ keys: chavesJwks });
  if (url.startsWith("https://api.github.com/repos/")) { dispatches.push({ url, corpo, auth: (init?.headers as any)?.authorization }); return new Response(null, { status: 204 }); }
  if (url.startsWith(env.SUPABASE_URL + "/auth/v1/")) {
    if (!(init?.headers as any)?.authorization?.includes("service-teste")) return j({ msg: "sem chave de serviço" }, 401);
    if (authFalha) return j({ msg: "indisponível" }, 503);
    if (/\/auth\/v1\/admin\/users\//.test(url)) return j({ id: url.split("/").pop(), email: "professor.turco@gmail.com" });
    if (url.endsWith("/auth/v1/admin/generate_link")) return corpo?.type === "magiclink" && corpo?.email ? j({ hashed_token: "hash-teste-" + corpo.email, verification_type: "magiclink" }) : j({ msg: "pedido inválido" }, 400);
    if (url.endsWith("/auth/v1/verify")) return corpo?.type === "magiclink" && String(corpo?.token_hash).startsWith("hash-teste-") ? j({ access_token: "ACESSO_TESTE", refresh_token: "REFRESH_TESTE", expires_in: 3600, user: { id: "u1" } }) : j({ msg: "token inválido" }, 401);
  }

  if (url.startsWith("https://graph.facebook.com/")) {
    if (!(init?.headers as any)?.authorization?.includes("TOKEN_TESTE")) return j({ error: "sem token" }, 401);
    if (url.endsWith("/935766732459650/subscribed_apps")) {
      if (metodo === "POST") { wabaAssinada = true; return j({ success: true }); }
      return j({ data: wabaAssinada ? [{ whatsapp_business_api_data: { id: "1708104537155293", name: "Gerador Enem" } }] : [] });
    }
    if (url.endsWith("/media") && init?.body instanceof FormData) {
      const f = init.body.get("file") as File | null;
      if (!f || !f.size) return j({ error: { message: "arquivo ausente", code: 100 } }, 400);
      midiasSubidas.push({ nome: f.name, tipo: String(init.body.get("type")), bytes: f.size });
      return j({ id: "media." + midiasSubidas.length });
    }
    if (corpo?.status === "read") return j({ success: true });   // confirmação de leitura: não conta como resposta
    if (graphDemoraMs) await new Promise((r) => setTimeout(r, graphDemoraMs));
    if (graphJanelaFechada) return j({ error: { message: "(#131047) Re-engagement message", code: 131047 } }, 400);
    if (graphFalha === "permanente") return j({ error: { message: "(#131030) Recipient phone number not in allowed list", code: 131030 } }, 400);
    if (graphFalha === "transitorio") return j({ error: { message: "(#130429) Rate limit hit", code: 130429 } }, 400);
    if (listaTestes && !listaTestes.includes(corpo?.to)) return j({ error: { message: "(#131030) Recipient phone number not in allowed list", type: "OAuthException", code: 131030, error_data: { messaging_product: "whatsapp", details: "O número de telemóvel do destinatário não está na lista de permissões: Adiciona o número de telemóvel do destinatário à lista de destinatários no painel de aplicações da Meta e tenta novamente. Consulta https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages para mais informações." }, fbtrace_id: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789" } }, 400);
    if (graphFalhaApos !== null && enviosOkSeguidos >= graphFalhaApos) return j({ error: { message: "(#130429) Rate limit hit", code: 130429 } }, 400);
    enviosOkSeguidos++;
    enviosWa.push(corpo);
    return j({ messages: [{ id: "wamid.resp" + enviosWa.length }] });
  }
  if (url.startsWith(env.SUPABASE_URL + "/rest/v1/wa_mensagens")) {
    if (metodo === "POST") {
      if (banco.mensagens.has(corpo.wamid)) return j([]);
      const agora = new Date().toISOString();
      banco.mensagens.set(corpo.wamid, { ...corpo, acao: null, recebido_em: agora, reservado_em: agora }); return j([corpo], 201);
    }
    if (metodo === "PATCH") {
      // respeita os filtros (compare-and-swap): wamid=eq, acao=is.null | acao=eq.X, reservado_em=lt.T
      const id = param(url, "wamid")!.replace("eq.", "");
      const m = banco.mensagens.get(id);
      const fAcao = param(url, "acao"); const fRes = param(url, "reservado_em");
      let casa = !!m;
      if (m && fAcao === "is.null" && m.acao !== null) casa = false;
      if (m && fAcao && fAcao.startsWith("eq.") && m.acao !== fAcao.slice(3)) casa = false;
      if (m && fRes && !(m.reservado_em < fRes.replace("lt.", ""))) casa = false;
      if (casa) Object.assign(m, corpo);
      const rep = (init?.headers as any)?.prefer?.includes("return=representation");
      return rep ? j(casa ? [m] : []) : new Response(null, { status: 204 });
    }
    if (metodo === "GET") {
      const id = param(url, "wamid")!.replace("eq.", "");
      const m = banco.mensagens.get(id); return j(m ? [{ acao: m.acao, recebido_em: m.recebido_em, reservado_em: m.reservado_em }] : []);
    }
    if (metodo === "HEAD") {
      if (contagemFora) return new Response(null, { status: 503 });
      // contagem filtrada (tentativas recentes): telefone=eq.X & acao=like.prefixo* & recebido_em=gte.T
      const tel = param(url, "telefone")?.replace("eq.", "");
      const like = (param(url, "acao") || "").replace(/^like\./, "").replace(/\*$/, "");
      const desde = (param(url, "recebido_em") || "").replace("gte.", "");
      let n = 0;
      for (const m of banco.mensagens.values()) {
        if (tel && m.telefone !== tel) continue;
        if (like && !(typeof m.acao === "string" && m.acao.startsWith(like))) continue;
        if (desde && m.recebido_em < desde) continue;
        n++;
      }
      return new Response(null, { status: 200, headers: { "content-range": `0-0/${n}` } });
    }
  }
  if (url.startsWith(env.SUPABASE_URL + "/rest/v1/perfis")) {
    if (metodo === "HEAD") return new Response(null, { status: 200, headers: { "content-range": `0-0/${banco.perfis.size}` } });
    const tel = param(url, "whatsapp")!.replace("eq.", "");
    const p = banco.perfis.get(tel); return j(p ? [p] : []);
  }
  if (url.startsWith(env.SUPABASE_URL + "/rest/v1/rpc/wa_concluir_vinculo")) {
    if (!(init?.headers as any)?.authorization?.includes("service-teste")) return j({ message: "permission denied" }, 401);
    const v = banco.vinculos.find((x) => x.codigo === corpo.p_codigo && !x.usado && x.expira > Date.now())
      ?? banco.vinculos.find((x) => x.codigo === corpo.p_codigo && x.usado && x.telefone === corpo.p_telefone && x.usadoEm > Date.now() - 30 * 60000);
    if (!v) return j([]);
    if (!v.usado) {
      v.usado = true; v.telefone = corpo.p_telefone; v.usadoEm = Date.now();
      banco.perfis.set(corpo.p_telefone, { user_id: v.user_id, whatsapp_nome: corpo.p_nome, ilimitado: false });
    }
    return j([{ vinculado_user_id: v.user_id, vinculado_email: "professor.turco@gmail.com" }]);
  }
  if (/\/rest\/v1\/(wa_vinculos|wa_conversas)/.test(url) && metodo === "HEAD") return new Response(null, { status: 200, headers: { "content-range": "0-0/0" } });
  if (url.startsWith(env.SUPABASE_URL + "/rest/v1/wa_conversas")) {
    if (metodo === "POST") { banco.conversas.set(corpo.telefone, corpo); return new Response(null, { status: 201 }); }
    const t = param(url, "telefone")!.replace("eq.", "");
    if (metodo === "PATCH") {   // reserva condicional: estado->>passo=eq.confirmar
      const passo = param(url, "estado->>passo")?.replace("eq.", "");
      const c = banco.conversas.get(t);
      if (dbDemoraMs) await new Promise((r) => setTimeout(r, dbDemoraMs));
      if (!c || (passo && c.estado?.passo !== passo)) return j([]);
      Object.assign(c, corpo); return j([c]);
    }
    const c = banco.conversas.get(t); return j(c ? [{ estado: c.estado, user_id: c.user_id ?? null }] : []);
  }
  if (url.startsWith(env.SUPABASE_URL + "/rest/v1/wa_trabalhos")) {
    if (metodo === "POST") { const t = { id: crypto.randomUUID(), criado_em: new Date().toISOString(), erro: null, concluido_em: null, iniciado_em: null, progresso: {}, documentos: null, simulado_id: null, ...corpo }; banco.trabalhos.push(t); return j([t], 201); }
    // filtros PostgREST usados pelo código: col=eq.|in.()|lt.|gte.|like.|is.null, caminhos json (a->>b) e or=(x,and(y,z))
    const sp = new URL(url).searchParams;
    const valor = (t: any, col: string) => { const m = /^(\w+)->>?(\w+)$/.exec(col); return m ? (t[m[1]] ?? {})[m[2]] : t[col]; };
    const testa = (t: any, col: string, op: string, v: string): boolean => {
      if (op === "not") { const i = v.indexOf("."); return !testa(t, col, v.slice(0, i), v.slice(i + 1)); }
      const x = valor(t, col);
      if (op === "cs") { const alvo = JSON.parse(v); return Array.isArray(x) && (Array.isArray(alvo) ? alvo : [alvo]).every((a) => x.includes(a)); }
      if (op === "eq") return x != null && String(x) === v;
      if (op === "in") return v.replace(/^\(|\)$/g, "").split(",").includes(String(x));
      if (op === "lt") return x != null && String(x) < v;
      if (op === "gte") return x != null && String(x) >= v;
      if (op === "like") return typeof x === "string" && x.startsWith(v.replace(/\*$/, ""));
      if (op === "is") return v === "null" ? x == null : String(x) === v;
      throw new Error("operador não simulado: " + op);
    };
    const casaOr = (t: any, expr: string): boolean => {   // "(a.eq.1,and(b.eq.2,c.lt.3))"
      const dentro = expr.replace(/^\(|\)$/g, "");
      const partes: string[] = []; let nivel = 0, atual = "";
      for (const ch of dentro) { if (ch === "(") nivel++; if (ch === ")") nivel--; if (ch === "," && nivel === 0) { partes.push(atual); atual = ""; } else atual += ch; }
      partes.push(atual);
      return partes.some((p) => {
        if (p.startsWith("and(")) return p.slice(4, -1).split(",").every((c) => { const [col, op, ...v] = c.split("."); return testa(t, col, op, v.join(".")); });
        const [col, op, ...v] = p.split("."); return testa(t, col, op, v.join("."));
      });
    };
    const casa = (t: any) => {
      for (const [k, raw] of sp.entries()) {
        if (["select", "order", "limit"].includes(k)) continue;
        const v = decodeURIComponent(raw);
        if (k === "or") { if (!casaOr(t, v)) return false; continue; }
        const i = v.indexOf("."); const op = v.slice(0, i), val = v.slice(i + 1);
        if (!testa(t, k, op, val)) return false;
      }
      return true;
    };
    const ordem = sp.get("order") || "criado_em.desc";
    const [ocol, odir] = ordem.split(".");
    const lim = Number(sp.get("limit") || 50);
    const alvo = banco.trabalhos.filter(casa).sort((a, b) => (a[ocol] < b[ocol] ? -1 : a[ocol] > b[ocol] ? 1 : 0) * (odir === "desc" ? -1 : 1));
    if (metodo === "HEAD") return new Response(null, { status: 200, headers: { "content-range": `0-0/${alvo.length}` } });
    if (metodo === "PATCH") { alvo.forEach((t) => Object.assign(t, corpo)); return j(alvo); }
    const sel = (sp.get("select") || "*").split(",");
    const proj = (t: any) => sel.includes("*") ? t : Object.fromEntries(sel.map((c) => [c, t[c]]));
    return j(alvo.slice(0, lim).map(proj));
  }
  return j({ erro: "rota não simulada: " + url }, 500);
}) as typeof fetch;

// ---- payload no formato real capturado na tela da Meta ---------------------
function payloadMeta(texto: string, wamid: string, from = "556296116652", nome = "Maziad-Turco", type = "text", waId = from, interactive: any = null) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "935766732459650", changes: [{ value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "15556169670", phone_number_id: "1382046324982726" },
      contacts: [{ profile: { name: nome }, wa_id: waId }],
      messages: [{ from, id: wamid, timestamp: "1789264717", type, ...(type === "text" ? { text: { body: texto } } : type === "interactive" ? { interactive } : { image: { id: "x" } }) }],
    }, field: "messages" }] }],
  };
}
async function postAssinado(obj: unknown, segredo = env.WHATSAPP_APP_SECRET, ambiente: Env = env) {
  const corpo = JSON.stringify(obj);
  const sig = "sha256=" + await assinaturaHmacSha256(segredo, corpo);
  return handler(new Request("https://x/functions/v1/whatsapp-webhook", { method: "POST", headers: { "x-hub-signature-256": sig, "content-type": "application/json" }, body: corpo }), ambiente);
}
const botao = (id: string) => ({ type: "button_reply", button_reply: { id, title: id } });
const vincula = (uid = "u1", nome = "Maziad", extra: Record<string, unknown> = { ilimitado: true }) => banco.perfis.set("556296116652", { user_id: uid, whatsapp_nome: nome, ...extra });
let total = 0;
const ok = (c: boolean, m: string) => { if (!c) throw new Error("FALHOU: " + m); total++; console.log("PASS " + m); };

Deno.test("verificação do webhook (GET) aceita o verify token certo e recusa o errado", async () => {
  const r1 = await handler(new Request("https://x/w?hub.mode=subscribe&hub.verify_token=fraseVerificacaoTeste2026&hub.challenge=987654"), env);
  ok(r1.status === 200 && await r1.text() === "987654", "GET com token certo devolve o challenge");
  const r2 = await handler(new Request("https://x/w?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=987654"), env);
  ok(r2.status === 403, "GET com token errado → 403");
  const r3 = await handler(new Request("https://x/w?hub.mode=subscribe&hub.challenge=1"), { ...env, WHATSAPP_VERIFY_TOKEN: "" });
  ok(r3.status === 403, "sem verify token configurado nunca aceita");
  const r4 = await handler(new Request("https://x/w", { method: "PUT" }), env);
  ok(r4.status === 405, "método PUT → 405");
});

Deno.test("POST sem assinatura ou com segredo errado é recusado e nada é gravado", async () => {
  resetar();
  const corpo = JSON.stringify(payloadMeta("Oi", "wamid.1"));
  const r1 = await handler(new Request("https://x/w", { method: "POST", body: corpo }), env);
  ok(r1.status === 401 && banco.mensagens.size === 0, "sem cabeçalho → 401, nada gravado");
  const r2 = await postAssinado(payloadMeta("Oi", "wamid.1"), "outro-segredo");
  ok(r2.status === 401 && banco.mensagens.size === 0 && enviosWa.length === 0, "assinatura com segredo errado → 401, nenhuma resposta enviada");
  const r3 = await postAssinado(payloadMeta("Oi", "wamid.1"), env.WHATSAPP_APP_SECRET).then(async (r) => r);
  ok(r3.status === 200, "mesma mensagem com o segredo certo → 200");
  const corpoAlterado = corpo.replace("Oi", "Ei");
  const sig = "sha256=" + await assinaturaHmacSha256(env.WHATSAPP_APP_SECRET, corpo);
  const r4 = await handler(new Request("https://x/w", { method: "POST", headers: { "x-hub-signature-256": sig }, body: corpoAlterado }), env);
  ok(r4.status === 401, "corpo alterado depois de assinado → 401");
  const r5 = await handler(new Request("https://x/w", { method: "POST", headers: { "x-hub-signature-256": "sha256=abc" }, body: corpo }), { ...env, WHATSAPP_APP_SECRET: "" });
  ok(r5.status === 401, "sem App Secret configurado nunca aceita POST");
});

Deno.test("número não vinculado recebe instrução de vincular", async () => {
  resetar();
  const r = await postAssinado(payloadMeta("Oi", "wamid.2"));
  ok(r.status === 200, "POST válido → 200");
  ok(enviosWa.length === 1 && enviosWa[0].to === "556296116652" && enviosWa[0].text.body === TEXTOS.naoVinculado, "resposta = instrução de vincular, para o remetente");
  ok(banco.mensagens.get("wamid.2").acao === "nao_vinculado" && banco.mensagens.get("wamid.2").texto === "Oi", "mensagem registrada com ação e texto");
  ok(TEXTOS.naoVinculado.includes("Vincular conta 123456") && TEXTOS.vinculoInvalido.includes("Vincular conta 123456"), "textos ensinam o formato de 6 dígitos");
  const lida = chamadas.filter((c) => c.url.startsWith("https://graph.facebook.com/") && c.corpo?.status === "read");
  ok(lida.length === 1 && lida[0].corpo.message_id === "wamid.2", "confirmação de leitura enviada para a mensagem certa");
});

Deno.test("pareamento: código válido vincula; inválido/expirado/usado não", async () => {
  resetar();
  banco.vinculos.push({ codigo: "482134", user_id: DONO, usado: false, expira: Date.now() + 60000 });
  banco.vinculos.push({ codigo: "999999", user_id: "u2", usado: false, expira: Date.now() - 1 });
  let r = await postAssinado(payloadMeta("Vincular conta 482134", "wamid.3"));
  ok(r.status === 200 && banco.mensagens.get("wamid.3").acao === "vinculo_ok", "código válido → vinculo_ok");
  const txt = enviosWa[0].text.body as string;
  ok(txt.startsWith("Pronto, Maziad-Turco!") && txt.includes("pr…o@gmail.com") && !txt.includes("professor.turco@"), "resposta usa o nome do perfil e o e-mail MASCARADO");
  ok(banco.perfis.get("556296116652")?.user_id === DONO, "perfil passou a ter o telefone");
  ok(banco.mensagens.get("wamid.3").user_id === DONO, "mensagem ligada ao usuário");
  r = await postAssinado(payloadMeta("vincular 999999", "wamid.4"));
  ok(banco.mensagens.get("wamid.4").acao === "vinculo_invalido" && enviosWa[1].text.body === TEXTOS.vinculoInvalido, "código expirado → vinculo_invalido");
  r = await postAssinado(payloadMeta("Vincular conta 482134", "wamid.5"));
  ok(banco.mensagens.get("wamid.5").acao === "vinculo_ok" && banco.perfis.get("556296116652")?.user_id === DONO, "mesmo telefone repetindo o código em < 30 min: 'vinculado' de novo (idempotente), sem mudar nada");
  r = await postAssinado(payloadMeta("Vincular conta 482134", "wamid.5b", "5511999990000", "Outro"));
  ok(banco.mensagens.get("wamid.5b").acao === "vinculo_invalido" && !banco.perfis.has("5511999990000"), "código já usado não vincula OUTRO telefone");
  const rpc = chamadas.filter((c) => c.url.includes("/rpc/wa_concluir_vinculo"));
  ok(rpc.length === 4 && rpc.slice(0, 3).every((c) => c.corpo.p_telefone === "556296116652" && c.corpo.p_nome === "Maziad-Turco") && rpc[3].corpo.p_telefone === "5511999990000", "RPC recebe telefone e nome do perfil de cada remetente");
});

Deno.test("bloqueio: depois de 5 códigos inválidos em 15 min, o 6º nem é testado", async () => {
  resetar();
  banco.vinculos.push({ codigo: "482134", user_id: DONO, usado: false, expira: Date.now() + 60000 });
  for (let i = 1; i <= MAX_TENTATIVAS_CODIGO; i++) {
    await postAssinado(payloadMeta(`Vincular conta 11111${i}`, `wamid.b${i}`));
    ok(banco.mensagens.get(`wamid.b${i}`).acao === "vinculo_invalido", `tentativa ${i} → vinculo_invalido`);
  }
  const antes = chamadas.filter((c) => c.url.includes("/rpc/wa_concluir_vinculo")).length;
  const r = await postAssinado(payloadMeta("Vincular conta 482134", "wamid.b6"));
  const depois = chamadas.filter((c) => c.url.includes("/rpc/wa_concluir_vinculo")).length;
  ok(r.status === 200 && banco.mensagens.get("wamid.b6").acao === "vinculo_bloqueado", "6ª tentativa → vinculo_bloqueado (mesmo com o código certo)");
  ok(depois === antes && enviosWa.at(-1).text.body === TEXTOS.vinculoBloqueado, "código não foi testado no banco; resposta de bloqueio");
  ok(!banco.perfis.has("556296116652"), "telefone continua sem vínculo");
  // outro telefone não é afetado pelo bloqueio deste
  await postAssinado(payloadMeta("Vincular conta 482134", "wamid.b7", "5511999990000", "Outra Pessoa"));
  ok(banco.mensagens.get("wamid.b7").acao === "vinculo_ok" && banco.perfis.get("5511999990000")?.user_id === DONO, "bloqueio é por telefone: outro número vincula normalmente");
});

Deno.test("mensagem repetida pela Meta é ignorada (uma resposta só)", async () => {
  resetar();
  await postAssinado(payloadMeta("Oi", "wamid.8"));
  const r = await postAssinado(payloadMeta("Oi", "wamid.8"));
  const res = await r.json();
  ok(r.status === 200 && res.resultados[0] === "duplicada" && enviosWa.length === 1, "segunda entrega do mesmo wamid não responde de novo");
});

Deno.test("falha no envio → 500 (Meta reentrega) e a reentrega é processada de novo", async () => {
  resetar();
  graphFalha = "transitorio";
  const r1 = await postAssinado(payloadMeta("Oi", "wamid.9"));
  const j1 = await r1.json();
  ok(r1.status === 500 && j1.ok === false && j1.resultados[0] === "nao_vinculado_envio_falhou", "erro transitório da Graph (130429) → 500 + acao *_envio_falhou");
  ok(banco.mensagens.get("wamid.9").acao === "nao_vinculado_envio_falhou", "linha guarda a falha");
  graphFalha = false;
  const r2 = await postAssinado(payloadMeta("Oi", "wamid.9"));
  const j2 = await r2.json();
  ok(r2.status === 200 && j2.resultados[0] === "nao_vinculado" && enviosWa.length === 1, "reentrega da Meta reprocessa e responde uma vez");
  ok(banco.mensagens.get("wamid.9").acao === "nao_vinculado", "linha atualizada para sucesso");
  // linha 'travada' (acao nula, reservada há mais de 3 min) também é reprocessada
  const h10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  banco.mensagens.set("wamid.10", { wamid: "wamid.10", telefone: "556296116652", acao: null, recebido_em: h10, reservado_em: h10 });
  const r3 = await postAssinado(payloadMeta("Oi", "wamid.10"));
  ok(r3.status === 200 && (await r3.json()).resultados[0] === "nao_vinculado" && enviosWa.length === 2, "linha travada há 10 min é reprocessada");
  // linha em processamento agora (acao nula, reservada há pouco) → 500 (Meta tenta depois), sem resposta
  const h1 = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  banco.mensagens.set("wamid.11", { wamid: "wamid.11", telefone: "556296116652", acao: null, recebido_em: h1, reservado_em: new Date().toISOString() });
  const r4 = await postAssinado(payloadMeta("Oi", "wamid.11"));
  ok(r4.status === 500 && (await r4.json()).resultados[0] === "duplicada_em_andamento" && enviosWa.length === 2, "reservada há 0 s (mesmo com mensagem de 1 h) → em andamento → 500, nada enviado");
  // falha antiga demais (> 24 h) não é reprocessada
  banco.mensagens.set("wamid.12", { wamid: "wamid.12", telefone: "556296116652", acao: "erro", recebido_em: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), reservado_em: new Date(Date.now() - 25 * 3600 * 1000).toISOString() });
  const r5 = await postAssinado(payloadMeta("Oi", "wamid.12"));
  ok(r5.status === 200 && (await r5.json()).resultados[0] === "duplicada" && enviosWa.length === 2, "falha com mais de 24 h → duplicata (Meta para de reentregar)");
});

Deno.test("decidirReentrega: tabela de casos", () => {
  const agora = Date.now();
  const em = (ms: number) => new Date(agora - ms).toISOString();
  const d = (acao: string | null, recebidoMs: number, reservadoMs = recebidoMs) => decidirReentrega({ acao, recebido_em: em(recebidoMs), reservado_em: em(reservadoMs) }, agora);
  ok(decidirReentrega(undefined, agora) === "duplicada", "sem linha → duplicada");
  ok(d(null, 1000) === "em_andamento", "acao nula, reservada há 1 s → em andamento");
  ok(d(null, TRAVADA_APOS_MS + 1000) === "reprocessar", "acao nula, reservada há > 3 min → reprocessar");
  ok(d(null, 60 * 60 * 1000, 1000) === "em_andamento", "mensagem de 1 h mas RE-reservada há 1 s → em andamento (usa reservado_em)");
  ok(d(null, -5000) === "em_andamento", "relógio adiantado (idade negativa) → em andamento, nunca perde a mensagem");
  ok(d("erro", 1000) === "reprocessar", "erro → reprocessar");
  ok(d("vinculo_ok_envio_falhou", 1000) === "reprocessar", "*_envio_falhou → reprocessar");
  ok(d("vinculo_ok_envio_recusado", 1000) === "duplicada", "*_envio_recusado (erro permanente) → duplicada, sem laço de reentregas");
  ok(d("vinculo_ok", 1000) === "duplicada", "sucesso → duplicada");
  ok(d("erro", REPROCESSAR_ATE_MS + 1000) === "duplicada", "erro com > 24 h → duplicada");
});

Deno.test("envioTransitorio classifica erros da Graph", () => {
  ok(envioTransitorio(500, "") && envioTransitorio(429, "") && envioTransitorio(503, "x"), "5xx/429 → transitório");
  ok(envioTransitorio(400, JSON.stringify({ error: { code: 130429 } })) && envioTransitorio(400, JSON.stringify({ error: { code: 80007 } })), "400 com código de limite → transitório");
  ok(!envioTransitorio(400, JSON.stringify({ error: { code: 131030 } })) && !envioTransitorio(401, JSON.stringify({ error: { code: 190 } })) && !envioTransitorio(400, "lixo"), "131030 (fora da lista), 190 (token) → permanente");
});

Deno.test("PAREAMENTO reentregue após falha de envio continua 'vinculado' (não vira 'código inválido')", async () => {
  resetar();
  banco.vinculos.push({ codigo: "482134", user_id: DONO, usado: false, expira: Date.now() + 60000 });
  graphFalha = "transitorio";
  const r1 = await postAssinado(payloadMeta("Vincular conta 482134", "wamid.p1"));
  ok(r1.status === 500 && banco.mensagens.get("wamid.p1").acao === "vinculo_ok_envio_falhou" && banco.perfis.get("556296116652")?.user_id === DONO, "vínculo feito no banco, envio falhou → 500");
  graphFalha = false;
  const r2 = await postAssinado(payloadMeta("Vincular conta 482134", "wamid.p1"));
  ok(r2.status === 200 && banco.mensagens.get("wamid.p1").acao === "vinculo_ok", "reentrega → vinculo_ok (RPC idempotente para o mesmo telefone)");
  ok(enviosWa.length === 1 && enviosWa[0].text.body.startsWith("Pronto, Maziad-Turco!"), "professor recebe a confirmação, uma vez");
  ok(banco.mensagens.get("wamid.p1").user_id === DONO, "linha ligada ao usuário");
  // outro telefone com o mesmo código já usado: inválido (idempotência é só para o mesmo telefone)
  await postAssinado(payloadMeta("Vincular conta 482134", "wamid.p2", "5511999990000", "Outro"));
  ok(banco.mensagens.get("wamid.p2").acao === "vinculo_invalido", "código usado por outro telefone → inválido");
});

Deno.test("erro PERMANENTE da Graph (#131030): registra, responde 200, não entra em laço", async () => {
  resetar();
  graphFalha = "permanente";
  const r1 = await postAssinado(payloadMeta("Oi", "wamid.q1"));
  const j1 = await r1.json();
  ok(r1.status === 200 && j1.resultados[0] === "nao_vinculado_envio_recusado", "→ 200 com *_envio_recusado");
  ok(banco.mensagens.get("wamid.q1").acao === "nao_vinculado_envio_recusado" && banco.mensagens.get("wamid.q1").resposta.includes("131030"), "motivo guardado na linha");
  graphFalha = false;
  const r2 = await postAssinado(payloadMeta("Oi", "wamid.q1"));
  ok((await r2.json()).resultados[0] === "duplicada" && enviosWa.length === 0, "reentrega não reprocessa erro permanente");
});

Deno.test("duas entregas SIMULTÂNEAS do mesmo wamid: uma responde, a outra devolve 500 sem enviar", async () => {
  resetar();
  graphDemoraMs = 40;   // a 1ª execução ainda está esperando a Graph quando a 2ª entrega chega
  const [a, b] = await Promise.all([postAssinado(payloadMeta("Oi", "wamid.c1")), postAssinado(payloadMeta("Oi", "wamid.c1"))]);
  graphDemoraMs = 0;
  const ra = (await a.json()).resultados[0], rb = (await b.json()).resultados[0];
  const status = [a.status, b.status].sort().join(",");
  ok(enviosWa.length === 1, "exatamente uma resposta enviada");
  ok([ra, rb].sort().join(",") === "duplicada_em_andamento,nao_vinculado" && status === "200,500", `uma processa (200), a outra em andamento (500): ${ra}/${rb}`);
  // a Meta tenta de novo mais tarde: agora já concluída → duplicada → 200
  const c = await postAssinado(payloadMeta("Oi", "wamid.c1"));
  ok(c.status === 200 && (await c.json()).resultados[0] === "duplicada" && enviosWa.length === 1, "tentativa posterior → duplicada, 200, sem 2ª resposta");
});

Deno.test("contagem de tentativas indisponível → falha FECHADO (não testa o código)", async () => {
  resetar();
  banco.vinculos.push({ codigo: "482134", user_id: DONO, usado: false, expira: Date.now() + 60000 });
  contagemFora = true;
  const r = await postAssinado(payloadMeta("Vincular conta 482134", "wamid.f1"));
  ok(r.status === 500 && banco.mensagens.get("wamid.f1").acao === "erro" && !banco.perfis.has("556296116652") && enviosWa.length === 0, "→ erro/500, código não testado, nada enviado");
  contagemFora = false;
  const r2 = await postAssinado(payloadMeta("Vincular conta 482134", "wamid.f1"));
  ok(r2.status === 200 && banco.mensagens.get("wamid.f1").acao === "vinculo_ok", "reentrega com o banco de volta → vincula");
});

Deno.test("bloqueio conta tentativas inválidas mesmo com envio falho, e não se auto-alimenta", async () => {
  resetar();
  graphFalha = "permanente";   // respostas recusadas: as tentativas ainda precisam contar
  for (let i = 1; i <= MAX_TENTATIVAS_CODIGO; i++) await postAssinado(payloadMeta(`Vincular conta 22222${i}`, `wamid.g${i}`));
  ok(banco.mensagens.get("wamid.g1").acao === "vinculo_invalido_envio_recusado", "tentativas gravadas com sufixo de envio");
  graphFalha = false;
  await postAssinado(payloadMeta("Vincular conta 333333", "wamid.g6"));
  ok(banco.mensagens.get("wamid.g6").acao === "vinculo_bloqueado", "6ª tentativa bloqueada apesar das 5 anteriores terem envio recusado");
  // simula passagem de 15 min: as inválidas ficam velhas; as 'bloqueado' recentes NÃO contam
  for (let i = 1; i <= MAX_TENTATIVAS_CODIGO; i++) banco.mensagens.get(`wamid.g${i}`).recebido_em = new Date(Date.now() - 16 * 60000).toISOString();
  banco.vinculos.push({ codigo: "482134", user_id: DONO, usado: false, expira: Date.now() + 60000 });
  await postAssinado(payloadMeta("Vincular conta 482134", "wamid.g7"));
  ok(banco.mensagens.get("wamid.g7").acao === "vinculo_ok", "após 15 min o bloqueio cai mesmo tendo uma 'bloqueado' recente");
});

Deno.test("wa_id do contato diferente de 'from' (9º dígito): nome ainda é usado; telefone gravado é o 'from'", async () => {
  resetar();
  banco.vinculos.push({ codigo: "482134", user_id: DONO, usado: false, expira: Date.now() + 60000 });
  await postAssinado(payloadMeta("Vincular conta 482134", "wamid.n1", "5562996116652", "Maziad-Turco", "text", "556296116652"));
  ok(enviosWa[0].to === "5562996116652" && enviosWa[0].text.body.startsWith("Pronto, Maziad-Turco!"), "responde ao 'from' e usa o nome do único contato");
  ok(banco.perfis.get("5562996116652")?.whatsapp_nome === "Maziad-Turco", "perfil gravado com o telefone 'from' e o nome");
});

Deno.test("erro interno (banco fora) → acao erro, 500, nenhuma resposta enviada", async () => {
  resetar();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (e: any, i?: any) => {
    const url = typeof e === "string" ? e : e.url ?? e.toString();
    if (url.includes("/rest/v1/perfis")) return new Response("boom", { status: 503 });
    return fetchOriginal(e, i);
  }) as typeof fetch;
  try {
    const r = await postAssinado(payloadMeta("Oi", "wamid.13"));
    ok(r.status === 500 && (await r.json()).resultados[0] === "erro", "→ 500 com resultado 'erro'");
    ok(banco.mensagens.get("wamid.13").acao === "erro" && enviosWa.length === 0, "linha marcada como erro; nada enviado ao WhatsApp");
  } finally { globalThis.fetch = fetchOriginal; }
});

Deno.test("eventos de status e objetos estranhos não fazem nada", async () => {
  resetar();
  const status = { object: "whatsapp_business_account", entry: [{ id: "935766732459650", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: {}, statuses: [{ id: "wamid.x", status: "delivered" }] } }] }] };
  const r1 = await postAssinado(status);
  ok(r1.status === 200 && enviosWa.length === 0 && banco.mensagens.size === 0, "status 'delivered' → 200 sem ação");
  const falhou = { object: "whatsapp_business_account", entry: [{ id: "935766732459650", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: {}, statuses: [{ id: "wamid.y", status: "failed", recipient_id: "5562996116652", errors: [{ code: 131026, title: "Message undeliverable" }] }] } }] }] };
  const r1b = await postAssinado(falhou);
  ok(r1b.status === 200 && (await r1b.json()).resultados[0] === "status_falhou" && enviosWa.length === 0, "status 'failed' → 200, registrado como status_falhou, sem ação");
  const r2 = await postAssinado({ object: "page", entry: [] });
  ok(r2.status === 200 && (await r2.json()).ignorado, "objeto desconhecido → ignorado");
  const r3 = await postAssinado({ object: "whatsapp_business_account", entry: [{ id: "x", changes: [{ field: "account_update", value: {} }] }] });
  ok(r3.status === 200 && enviosWa.length === 0, "campo que não é 'messages' → ignorado");
  const sig = "sha256=" + await assinaturaHmacSha256(env.WHATSAPP_APP_SECRET, "{nao é json");
  const r4 = await handler(new Request("https://x/w", { method: "POST", headers: { "x-hub-signature-256": sig }, body: "{nao é json" }), env);
  ok(r4.status === 400, "JSON inválido (mas assinado) → 400");
});

Deno.test("duas mensagens no mesmo POST são processadas na ordem", async () => {
  resetar();
  const p = payloadMeta("Oi", "wamid.14");
  p.entry[0].changes[0].value.messages.push({ from: "556296116652", id: "wamid.15", timestamp: "1", type: "text", text: { body: "Oi de novo" } } as any);
  const r = await postAssinado(p);
  const j = await r.json();
  ok(r.status === 200 && j.resultados.length === 2 && enviosWa.length === 2, "2 mensagens → 2 resultados, 2 respostas");
});

Deno.test("extrairCodigoVinculo aceita variações e recusa o resto", () => {
  for (const [t, e] of [["Vincular conta 482134", "482134"], ["vincular 482134", "482134"], ["VINCULAR CONTA: 482134", "482134"], ["Vincular minha conta 482134.", "482134"], ["  vincular conta 482134 ", "482134"], ["Vincular a conta 482134!", "482134"], ["Vincular\u00a0conta\u00a0482134", "482134"], ["Víncular conta 482134", "482134"], ["vincular conta 482134\u200b", "482134"],
    ["Oi, vincular conta 482134 por favor", "482134"], ["Vincular conta 482134\nObrigado", "482134"], ["quero vincular: 482134", "482134"],
    ["Vincular conta 4821", null], ["Vincular conta 4821345", null], ["conta 482134", null], ["Oi 482134", null], ["482134", null], ["vincular conta", null], ["revincular conta 482134", null], ["Vincular conta 48213 4", null]] as [string, string | null][]) {
    ok(extrairCodigoVinculo(t) === e, `"${t}" → ${e}`);
  }
});

Deno.test("mascararEmail nunca devolve o e-mail inteiro", () => {
  ok(mascararEmail("maziadh@gmail.com") === "ma…h@gmail.com", "maziadh@gmail.com → ma…h@gmail.com");
  ok(mascararEmail("professor.turco@gmail.com") === "pr…o@gmail.com", "professor.turco → pr…o");
  ok(mascararEmail("ab@x.com") === "ab…@x.com", "usuário curto");
  ok(mascararEmail("semarroba") === "" && mascararEmail("") === "", "inválido → vazio");
});

Deno.test("selftest exige a frase de verificação e só expõe presença dos secrets", async () => {
  resetar();
  const r0 = await handler(new Request("https://x/w?selftest=1"), env);
  ok(r0.status === 401, "selftest sem ?t= → 401");
  const r1 = await handler(new Request("https://x/w?selftest=1&t=errada"), env);
  ok(r1.status === 401, "selftest com t errado → 401");
  const r = await handler(new Request("https://x/w?selftest=1&t=fraseVerificacaoTeste2026"), env);
  const j = await r.json();
  const s = JSON.stringify(j);
  ok(r.status === 200 && j.versao === "B2.0" && j.secretsPresentes.WHATSAPP_TOKEN === true && j.secretsPresentes.WHATSAPP_APP_SECRET === true, "selftest com t certo → 200 com presença dos secrets");
  ok(s.indexOf("TOKEN_TESTE") < 0 && s.indexOf("segredo-de-teste") < 0 && s.indexOf("service-teste") < 0 && s.indexOf("fraseVerificacao") < 0, "nenhum valor de secret aparece na saída");
  ok(j.tabelas.perfis.startsWith("ok") && j.tabelas.wa_mensagens.startsWith("ok") && j.tabelas.wa_conversas.startsWith("ok") && j.tabelas.wa_trabalhos.startsWith("ok") && j.operario && j.operario.disparoImediato === false && j.operario.repositorio === "Turco2025/Enem", "tabelas consultadas; operário sem disparo imediato (varredura)");
  ok(Array.isArray(j.secretsComEspacosNasPontas) && j.formatoOk.WHATSAPP_PHONE_NUMBER_ID_numerico === true && j.formatoOk.WHATSAPP_APP_SECRET_hex32 === false, "selftest aponta formato dos secrets (segredo de teste não é hex32)");
});

Deno.test("selftest com meta=1 assina a WABA ao app quando falta, e não repete quando já está", async () => {
  resetar(); wabaAssinada = false;
  const r = await handler(new Request("https://x/w?selftest=1&t=fraseVerificacaoTeste2026&meta=1"), env);
  const j = await r.json();
  ok(j.assinaturaWaba.acao === "assinatura solicitada" && j.assinaturaWaba.assinadoAgora === true && j.assinaturaWaba.antes.apps.length === 0, "WABA sem app → POST subscribed_apps → assinado");
  const posts = chamadas.filter((c) => c.url.endsWith("/subscribed_apps") && c.metodo === "POST").length;
  const r2 = await handler(new Request("https://x/w?selftest=1&t=fraseVerificacaoTeste2026&meta=1"), env);
  const j2 = await r2.json();
  ok(j2.assinaturaWaba.acao === "já estava assinado" && chamadas.filter((c) => c.url.endsWith("/subscribed_apps") && c.metodo === "POST").length === posts, "já assinado → não faz POST de novo");
  const r3 = await handler(new Request("https://x/w?selftest=1&t=fraseVerificacaoTeste2026"), env);
  ok((await r3.json()).assinaturaWaba === undefined && chamadas.filter((c) => c.url.endsWith("/subscribed_apps")).length === 4, "sem meta=1 não toca na Graph");
  ok(!JSON.stringify(j).includes("TOKEN_TESTE"), "token não aparece na saída");
});

Deno.test("nono dígito: Meta recusa 556296116652 (#131030) → reenvia para 5562996116652 e registra sucesso", async () => {
  resetar();
  listaTestes = ["5562996116652"];    // como o número foi cadastrado na lista de testes da Meta
  banco.vinculos.push({ codigo: "482134", user_id: DONO, usado: false, expira: Date.now() + 60000 });
  const r = await postAssinado(payloadMeta("Vincular conta 482134", "wamid.nd1"));   // from = 556296116652
  ok(r.status === 200 && banco.mensagens.get("wamid.nd1").acao === "vinculo_ok", "acao vinculo_ok (não 'recusado')");
  ok(enviosWa.length === 1 && enviosWa[0].to === "5562996116652", "resposta foi para a forma com 9");
  ok(banco.perfis.get("556296116652")?.user_id === DONO, "perfil guarda o telefone como a Meta identifica (sem 9)");
  const tentativas = chamadas.filter((c) => c.url.endsWith("/messages") && c.corpo?.type === "text");
  ok(tentativas.length === 2 && tentativas[0].corpo.to === "556296116652", "1ª tentativa na forma original, 2ª na alternativa");
  // se NENHUMA forma estiver na lista, continua 'recusado' (permanente, sem laço)
  listaTestes = ["5511000000000"];
  await postAssinado(payloadMeta("Oi", "wamid.nd2", "5562996116652"));
  ok(banco.mensagens.get("wamid.nd2").acao === "nao_vinculado_envio_recusado" && enviosWa.length === 1, "ambas recusadas → *_envio_recusado");
});

Deno.test("código de erro é lido do corpo completo mesmo quando passa de 300 caracteres", () => {
  const longo = JSON.stringify({ error: { message: "x".repeat(400), code: 131030 } });
  ok(longo.length > 300 && envioTransitorio(400, longo) === false, "131030 em corpo longo → permanente (parse funcionou)");
  const longoTransitorio = JSON.stringify({ error: { message: "y".repeat(400), code: 130429 } });
  ok(envioTransitorio(400, longoTransitorio) === true, "130429 em corpo longo → transitório");
});

Deno.test("formaAlternativaBr", () => {
  ok(formaAlternativaBr("556296116652") === "5562996116652", "12 → 13 (insere 9)");
  ok(formaAlternativaBr("5562996116652") === "556296116652", "13 com 9 → 12 (remove 9)");
  ok(formaAlternativaBr("15556169670") === null && formaAlternativaBr("5562896116652") === null, "não brasileiro / 13 sem 9 → sem alternativa");
});




// ============================================================================
// Etapa B1 — formulário por perguntas
// ============================================================================
const lr = (id: string) => ({ type: "list_reply", list_reply: { id, title: id } });
const envia = (wamid: string, texto: string) => postAssinado(payloadMeta(texto, wamid));
const toca = (wamid: string, inter: any) => postAssinado(payloadMeta("", wamid, "556296116652", "Maziad", "interactive", "556296116652", inter));
const ultimo = () => enviosWa[enviosWa.length - 1];

Deno.test("formulário completo: 'oi' → 1/6 … 6/6 → resumo com botões → Sim → pedido na fila", async () => {
  resetar(); vincula();
  await envia("wamid.a0", "oi");
  ok(banco.mensagens.get("wamid.a0").acao === "guiado_iniciado" && ultimo().interactive.type === "list" && ultimo().interactive.body.text.includes("1/6") && ultimo().interactive.action.sections[0].rows.length === 4, "qualquer mensagem → lista das 4 áreas (1/6)");
  ok(ultimo().interactive.action.sections[0].rows.every((r: any) => r.title.length <= 24 && (r.description ?? "").length <= 72) && ultimo().interactive.action.button.length <= 20, "limites da lista respeitados");
  await toca("wamid.a1", lr("area:natureza"));
  ok(ultimo().interactive.body.text.includes("2/6") && ultimo().interactive.action.sections[0].rows.map((r: any) => r.title).join() === "Biologia,Física,Química", "2/6 disciplinas da área");
  await toca("wamid.a2", lr("disc:biologia"));
  ok(ultimo().type === "text" && ultimo().text.body.includes("3/6"), "3/6 pede os temas");
  await envia("wamid.a3", "fotossíntese, respiração celular, ciclo do carbono");
  ok(ultimo().text.body.includes("4/6"), "4/6 pede a quantidade");
  await envia("wamid.a4", "vinte e cinco");
  ok(enviosWa[enviosWa.length - 2].text.body.includes("Responda só um número") && ultimo().text.body.includes("4/6"), "quantidade inválida → aviso + repete 4/6");
  await envia("wamid.a5", "10");
  ok(ultimo().interactive.body.text.includes("5/6"), "5/6 dificuldade");
  await toca("wamid.a6", lr("dif:mista"));
  ok(ultimo().interactive.body.text.includes("6/6"), "6/6 recurso");
  await toca("wamid.a7", lr("rec:imagem"));
  const conf = ultimo();
  ok(conf.interactive.type === "button" && conf.interactive.action.buttons.map((b: any) => b.reply.id).join() === "conf:sim,conf:refazer,conf:cancelar", "confirmação com 3 botões");
  const corpo = conf.interactive.body.text as string;
  ok(corpo.includes("10 questões de *Biologia*") && corpo.includes("Temas (3, em rodízio): fotossíntese; respiração celular; ciclo do carbono") && corpo.includes("4 fáceis, 3 médias, 3 difíceis") && corpo.includes("Com imagem") && corpo.endsWith("Posso gerar?"), "resumo: disciplina, 3 temas, mista 4/3/3, imagem");
  ok(banco.conversas.get("556296116652").estado.passo === "confirmar" && banco.trabalhos.length === 0, "estado 'confirmar', nada na fila ainda");
  await toca("wamid.a8", botao("conf:sim"));
  ok(banco.mensagens.get("wamid.a8").acao === "pedido_na_fila" && banco.trabalhos.length === 1, "Sim → 1 pedido pendente");
  const p = banco.trabalhos[0].parametros;
  ok(p.area === "natureza" && p.disciplina === "Biologia" && p.quantidade === 10 && p.nivel === "Mista" && p.contagem["Fácil"] === 4 && p.contagem["Médio"] === 3 && p.recurso === "imagem" && p.origem === "guiado" && p.temas.length === 3 && p.temas_texto === "fotossíntese, respiração celular, ciclo do carbono" && p.wamid_pedido === "wamid.a8", "parâmetros = os do painel de lote do app");
  ok(ultimo().text.body.includes("na fila") && ultimo().text.body.includes("em até 10 min") && !ultimo().text.body.includes("começa agora") && dispatches.length === 0, "sem token do GitHub: avisa a varredura de 10 min, não dispara nada");
  ok(!banco.conversas.get("556296116652").estado.passo && banco.conversas.get("556296116652").estado.encerrado_em, "formulário encerrado depois do Sim");
  await envia("wamid.a9", "quero outro");
  ok(ultimo().interactive.body.text.includes("1/6"), "nova mensagem → começa outro formulário");
});

Deno.test("Refazer volta ao 1/6; Cancelar (botão ou texto) descarta sem gravar; 'sim' digitado confirma; nível único", async () => {
  resetar(); vincula();
  const ate6 = async (pref: string) => { await envia(pref + "0", "oi"); await toca(pref + "1", lr("area:humanas")); await toca(pref + "2", lr("disc:historia")); await envia(pref + "3", "Era Vargas"); await envia(pref + "4", "5"); await toca(pref + "5", lr("dif:dificil")); await toca(pref + "6", lr("rec:tabela")); };
  await ate6("wamid.r");
  ok(ultimo().interactive.body.text.includes("5 questões de *História*") && ultimo().interactive.body.text.includes("Tema: Era Vargas") && ultimo().interactive.body.text.includes("difícil") && ultimo().interactive.body.text.includes("Com tabela"), "resumo com tema único e nível difícil");
  await toca("wamid.r7", botao("conf:refazer"));
  ok(ultimo().interactive.body.text.includes("1/6") && banco.conversas.get("556296116652").estado.passo === "area", "Refazer → 1/6");
  await envia("wamid.r8", "cancelar");
  ok(banco.mensagens.get("wamid.r8").acao === "pedido_descartado" && ultimo().text.body === TEXTOS.descartado && !banco.conversas.get("556296116652").estado.passo, "CANCELAR no meio descarta só o rascunho");
  await ate6("wamid.s");
  await toca("wamid.s7", botao("conf:cancelar"));
  ok(banco.mensagens.get("wamid.s7").acao === "pedido_descartado" && banco.trabalhos.length === 0, "botão Cancelar na confirmação descarta");
  await ate6("wamid.t");
  await envia("wamid.t7", "Sim, gerar");
  ok(banco.mensagens.get("wamid.t7").acao === "pedido_na_fila" && banco.trabalhos.length === 1 && banco.trabalhos[0].parametros.contagem["Difícil"] === 5 && banco.trabalhos[0].parametros.contagem["Fácil"] === 0, "'Sim, gerar' digitado confirma; 5 difíceis");
  await ate6("wamid.u");
  await envia("wamid.u7", "talvez");
  ok(ultimo().interactive.type === "button" && enviosWa[enviosWa.length - 2].text.body.includes("Toque em um dos botões"), "resposta estranha na confirmação → aviso + botões de novo");
});

Deno.test("respostas inválidas repetem a pergunta; 'constructor' como área não derruba; botão antigo sem estado começa formulário", async () => {
  resetar(); vincula();
  await envia("wamid.v0", "oi");
  await toca("wamid.v1", lr("area:constructor"));
  ok(banco.mensagens.get("wamid.v1").acao === "guiado_area" && ultimo().interactive.body.text.includes("1/6"), "área inválida → repete 1/6, sem erro");
  await toca("wamid.v2", lr("area:matematica"));
  await toca("wamid.v3", lr("disc:biologia"));
  ok(ultimo().interactive.body.text.includes("2/6") && enviosWa[enviosWa.length - 2].text.body.includes("Escolha uma disciplina da lista"), "disciplina de outra área → repete 2/6");
  await toca("wamid.v4", lr("disc:matematica"));
  await envia("wamid.v5", "x");
  ok(ultimo().text.body.includes("3/6") && enviosWa[enviosWa.length - 2].text.body.includes("pelo menos um tema"), "tema de 1 letra → repete 3/6");
  resetar(); vincula();
  await toca("wamid.v6", botao("conf:sim"));
  ok(banco.mensagens.get("wamid.v6").acao === "guiado_iniciado" && banco.trabalhos.length === 0, "Sim sem formulário em andamento não grava nada; começa o formulário");
  await postAssinado(payloadMeta("", "wamid.v7", "556296116652", "Maziad", "image"));
  ok(banco.mensagens.get("wamid.v7").acao === "so_texto", "imagem → 'só texto'");
});

Deno.test("comandos: CANCELAR sem rascunho cancela só os pendentes da fila; STATUS mostra o último; AJUDA", async () => {
  resetar(); vincula();
  banco.trabalhos.push({ id: "t-a", user_id: "u1", telefone: "556296116652", status: "enviado", criado_em: "2026-10-01T10:00:00.000Z", parametros: { quantidade: 5, disciplina: "Física" }, erro: null });
  banco.trabalhos.push({ id: "t-b", user_id: "u1", telefone: "556296116652", status: "pendente", criado_em: "2026-10-04T10:00:00.000Z", parametros: { quantidade: 8, disciplina: "Química" }, erro: null });
  await envia("wamid.f1", "Status");
  ok(banco.mensagens.get("wamid.f1").acao === "status" && ultimo().text.body.includes("8 questões de Química") && ultimo().text.body.includes("na fila"), "STATUS mostra o último pedido e a situação");
  await envia("wamid.f2", "cancelar!");
  ok(banco.mensagens.get("wamid.f2").acao === "pedido_cancelado" && banco.trabalhos.find((t) => t.id === "t-b").status === "cancelado" && banco.trabalhos.find((t) => t.id === "t-a").status === "enviado", "CANCELAR cancela o pendente e não mexe no enviado");
  await envia("wamid.f3", "CANCELAR");
  ok(banco.mensagens.get("wamid.f3").acao === "cancelar_sem_pedido" && ultimo().text.body.includes("Não havia pedido na fila"), "CANCELAR sem pendente avisa");
  await envia("wamid.f4", "ajuda");
  ok(banco.mensagens.get("wamid.f4").acao === "ajuda" && ultimo().text.body === TEXTOS.ajuda, "AJUDA");
  ok(comandoDe("  Cancelar. ") === "cancelar" && comandoDe("Situação") === "status" && comandoDe("?") === "ajuda" && comandoDe("10 questões") === null, "comandoDe reconhece variações");
});

Deno.test("limite diário: conta comum é barrada quando estoura (cancelada não conta) e pode ajustar; limite 0 bloqueia", async () => {
  resetar(); vincula("u2", "Prof", { ilimitado: false, limite_diario_wa: 12 });
  banco.trabalhos.push({ id: "t-h", user_id: "u2", telefone: "556296116652", status: "enviado", criado_em: new Date().toISOString(), parametros: { quantidade: 8, disciplina: "Física" }, erro: null });
  banco.trabalhos.push({ id: "t-c", user_id: "u2", telefone: "556296116652", status: "cancelado", criado_em: new Date().toISOString(), parametros: { quantidade: 20, disciplina: "Física" }, erro: null });
  await envia("wamid.l0", "oi"); await toca("wamid.l1", lr("area:natureza")); await toca("wamid.l2", lr("disc:fisica")); await envia("wamid.l3", "cinemática"); await envia("wamid.l4", "5"); await toca("wamid.l5", lr("dif:facil")); await toca("wamid.l6", lr("rec:nenhum"));
  await toca("wamid.l7", botao("conf:sim"));
  const avisoLimite = enviosWa[enviosWa.length - 2];
  ok(banco.mensagens.get("wamid.l7").acao === "limite_diario" && banco.trabalhos.length === 2 && avisoLimite.text.body.includes("já pediu 8 questões") && avisoLimite.text.body.includes("limite diário é 12"), "8 + 5 > 12 → barrado, nada gravado");
  ok(banco.conversas.get("556296116652").estado.passo === "confirmar" && ultimo().interactive?.type === "button", "volta para a confirmação com os botões (dá para Refazer)");
  await toca("wamid.l8", botao("conf:refazer"));
  await toca("wamid.l9", lr("area:natureza")); await toca("wamid.l10", lr("disc:fisica")); await envia("wamid.l11", "cinemática"); await envia("wamid.l12", "4"); await toca("wamid.l13", lr("dif:facil")); await toca("wamid.l14", lr("rec:nenhum"));
  await toca("wamid.l15", botao("conf:sim"));
  ok(banco.mensagens.get("wamid.l15").acao === "pedido_na_fila" && banco.trabalhos.length === 3, "8 + 4 = 12 cabe");
  resetar(); vincula("u3", "Bloq", { ilimitado: false, limite_diario_wa: 0 });
  await envia("wamid.z0", "oi"); await toca("wamid.z1", lr("area:natureza")); await toca("wamid.z2", lr("disc:fisica")); await envia("wamid.z3", "ondas"); await envia("wamid.z4", "1"); await toca("wamid.z5", lr("dif:facil")); await toca("wamid.z6", lr("rec:nenhum"));
  await toca("wamid.z7", botao("conf:sim"));
  ok(banco.mensagens.get("wamid.z7").acao === "limite_diario" && banco.trabalhos.length === 0 && enviosWa[enviosWa.length - 2].text.body.includes("limite diário 0"), "limite 0 bloqueia (não vira 30)");
  ok(inicioDoDiaBrasilia(new Date("2026-10-04T02:30:00.000Z")) === "2026-10-03T03:00:00.000Z" && inicioDoDiaBrasilia(new Date("2026-10-04T03:00:00.000Z")) === "2026-10-04T03:00:00.000Z", "início do dia em Brasília (UTC-3)");
});

Deno.test("reentregas da Meta: mesma mensagem repete a resposta (não avança); Sim reentregue não duplica; dois Sim simultâneos → um pedido", async () => {
  resetar(); vincula();
  await envia("wamid.g0", "oi");
  graphFalha = "transitorio";
  const r1 = await toca("wamid.g1", lr("area:natureza"));
  ok(r1.status === 500 && banco.conversas.get("556296116652").estado.passo === "disciplina" && banco.conversas.get("556296116652").estado.ultimo_wamid === "wamid.g1", "envio falhou → 500; estado avançou e guardou o wamid");
  graphFalha = false;
  await toca("wamid.g1", lr("area:natureza"));
  const e = banco.conversas.get("556296116652").estado;
  ok(banco.mensagens.get("wamid.g1").acao === "reentrega_disciplina" && e.passo === "disciplina" && !e.dados.disciplina && ultimo().interactive.body.text.includes("2/6"), "reentrega só repete a 2/6, não aplica a área como disciplina");
  await toca("wamid.g2", lr("disc:quimica")); await envia("wamid.g3", "ligações"); await envia("wamid.g4", "6"); await toca("wamid.g5", lr("dif:medio")); await toca("wamid.g6", lr("rec:grafico"));
  graphFalha = "transitorio";
  await toca("wamid.g7", botao("conf:sim"));
  ok(banco.trabalhos.length === 1 && banco.mensagens.get("wamid.g7").acao === "pedido_na_fila_envio_falhou", "Sim gravou o pedido; envio falhou");
  graphFalha = false;
  await toca("wamid.g7", botao("conf:sim"));
  ok(banco.trabalhos.length === 1 && banco.mensagens.get("wamid.g7").acao === "reentrega_encerrado" && ultimo().text.body.includes("confirmado e na fila") && !banco.conversas.get("556296116652").estado.passo, "reentrega do Sim repete a confirmação, sem segundo trabalho");
  // dois Sim ao mesmo tempo
  resetar(); vincula();
  await envia("wamid.h0", "oi"); await toca("wamid.h1", lr("area:natureza")); await toca("wamid.h2", lr("disc:quimica")); await envia("wamid.h3", "ácidos"); await envia("wamid.h4", "3"); await toca("wamid.h5", lr("dif:facil")); await toca("wamid.h6", lr("rec:nenhum"));
  dbDemoraMs = 30;
  const [ra, rb] = await Promise.all([toca("wamid.h7", botao("conf:sim")), toca("wamid.h8", botao("conf:sim"))]);
  dbDemoraMs = 0;
  const acoes = [banco.mensagens.get("wamid.h7").acao, banco.mensagens.get("wamid.h8").acao].sort();
  ok(ra.status === 200 && rb.status === 200 && banco.trabalhos.length === 1 && acoes.join() === "pedido_em_registro,pedido_na_fila", "um grava, o outro recebe 'já estou registrando'");
});

Deno.test("estado parado há mais de 1 h expira e a mensagem começa um formulário novo; 'registrando' órfão volta a aceitar o Sim", async () => {
  resetar(); vincula();
  banco.conversas.set("556296116652", { telefone: "556296116652", estado: { passo: "confirmar", dados: { area: "natureza", disciplina: "Física", temas: "ondas", quantidade: "3", dificuldade: "Fácil", recurso: "nenhum" }, iniciado_em: new Date(Date.now() - 5 * 3600_000).toISOString(), atualizado_em: new Date(Date.now() - 2 * 3600_000).toISOString() } });
  await toca("wamid.x1", botao("conf:sim"));
  ok(banco.trabalhos.length === 0 && banco.mensagens.get("wamid.x1").acao === "guiado_iniciado", "Sim sobre estado de 2 h atrás não grava: começa do 1/6");
  resetar(); vincula();
  banco.conversas.set("556296116652", { telefone: "556296116652", estado: { passo: "registrando", ultimo_wamid: "wamid.morto", dados: { area: "natureza", disciplina: "Física", temas: "ondas", quantidade: "3", dificuldade: "Fácil", recurso: "nenhum" }, iniciado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() } });
  await toca("wamid.x2", botao("conf:sim"));
  ok(banco.trabalhos.length === 0 && banco.mensagens.get("wamid.x2").acao === "pedido_em_registro", "'registrando' recente (outro Sim em andamento) → 'já estou registrando', sem duplicar");
  banco.conversas.get("556296116652").estado.atualizado_em = new Date(Date.now() - 4 * 60_000).toISOString();
  await toca("wamid.x3", botao("conf:sim"));
  ok(banco.trabalhos.length === 1 && banco.mensagens.get("wamid.x3").acao === "pedido_na_fila", "'registrando' travado há 4 min sem trabalho → o novo Sim grava");
});


Deno.test("reentregas: CANCELAR repetido não cancela a fila de novo; Sim reentregue após erro na gravação completa o pedido; botão antigo no passo temas", async () => {
  resetar(); vincula();
  await envia("wamid.m0", "oi");
  await envia("wamid.m1", "cancelar");
  banco.trabalhos.push({ id: "t-n", user_id: "u1", telefone: "556296116652", status: "pendente", criado_em: new Date().toISOString(), parametros: { quantidade: 2, disciplina: "Física" }, erro: null });
  await envia("wamid.m1", "cancelar");   // reentrega tardia do CANCELAR que descartou o rascunho
  ok(banco.trabalhos[0].status === "pendente" && ultimo().text.body === TEXTOS.descartado, "reentrega do CANCELAR repete 'descartado' e não cancela a fila");
  // Sim reentregue depois de erro no meio da gravação (banco falhou no insert)
  resetar(); vincula();
  await envia("wamid.n0", "oi"); await toca("wamid.n1", lr("area:natureza")); await toca("wamid.n2", lr("disc:fisica")); await envia("wamid.n3", "ondas"); await envia("wamid.n4", "2"); await toca("wamid.n5", lr("dif:facil")); await toca("wamid.n6", lr("rec:nenhum"));
  const fetchReal = globalThis.fetch;
  globalThis.fetch = (async (entrada: any, init?: RequestInit) => {
    const url = typeof entrada === "string" ? entrada : entrada.url;
    if (url.includes("/rest/v1/wa_trabalhos") && init?.method === "POST") return new Response("{}", { status: 503 });
    return fetchReal(entrada, init);
  }) as typeof fetch;
  const r1 = await toca("wamid.n7", botao("conf:sim"));
  globalThis.fetch = fetchReal;
  ok(r1.status === 500 && banco.trabalhos.length === 0 && banco.conversas.get("556296116652").estado.passo === "registrando", "insert falhou → 500, estado ficou em 'registrando'");
  await toca("wamid.n7", botao("conf:sim"));
  ok(banco.trabalhos.length === 1 && banco.mensagens.get("wamid.n7").acao === "pedido_na_fila", "reentrega do mesmo Sim grava o pedido (sem recomeçar o formulário)");
  // toque antigo no passo temas
  resetar(); vincula();
  await envia("wamid.o0", "oi"); await toca("wamid.o1", lr("area:natureza")); await toca("wamid.o2", lr("disc:fisica"));
  await toca("wamid.o3", botao("conf:sim"));
  ok(banco.conversas.get("556296116652").estado.passo === "temas" && ultimo().text.body.includes("3/6"), "botão antigo no passo temas não vira tema");
});

Deno.test("estado de outra conta no mesmo telefone é ignorado", async () => {
  resetar(); vincula("uB", "Nova conta");
  banco.conversas.set("556296116652", { telefone: "556296116652", user_id: "uA", estado: { passo: "confirmar", dados: { area: "natureza", disciplina: "Física", temas: "ondas", quantidade: "3", dificuldade: "Fácil", recurso: "nenhum" }, iniciado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() } });
  await toca("wamid.q1", botao("conf:sim"));
  ok(banco.trabalhos.length === 0 && banco.mensagens.get("wamid.q1").acao === "guiado_iniciado", "Sim da conta B não grava o rascunho da conta A");
});

Deno.test("pedido.ts: validação, temas, apelidos de disciplina, Mista e resumo", () => {
  ok(P.disciplinaPorNome("fisica") === "Física" && P.disciplinaPorNome("Lingua Portuguesa") === "Língua Portuguesa" && P.disciplinaPorNome("portugues") === "Língua Portuguesa" && P.disciplinaPorNome("educacao fisica") === "Práticas Corporais" && P.disciplinaPorNome("latim") === null, "disciplinaPorNome");
  ok(JSON.stringify(P.itensDosTemas("ab, b (c, d), 3,5 por cento, e os outros.")) === JSON.stringify(["ab", "b (c, d)", "3,5 por cento", "os outros"]), "não quebra dentro de parênteses nem em decimais; tira 'e' inicial e ponto final");
  ok(JSON.stringify(P.itensDosTemas("um\ndois\n- três")) === JSON.stringify(["um", "dois", "três"]), "quebra por linhas e tira marcadores");
  ok(P.itensDosTemas(Array.from({ length: 50 }, (_, i) => "tema " + i).join(", ")).length === P.MAX_TEMAS, "no máximo 40 temas");
  ok(JSON.stringify(P.distribuiTemas(["a", "b"], 5)) === JSON.stringify(["a", "b", "a", "b", "a"]), "rodízio de temas");
  ok(JSON.stringify(P.contagemIgual(10)) === JSON.stringify({ "Fácil": 4, "Médio": 3, "Difícil": 3 }) && JSON.stringify(P.contagemIgual(4)) === JSON.stringify({ "Fácil": 2, "Médio": 1, "Difícil": 1 }), "contagemIgual = app");
  const v = P.validarPedido({ disciplina: "Matemática", temas: "funções", quantidade: "7", dificuldade: "Médio", recurso: "grafico" });
  ok(v.ok && v.pedido.contagem["Médio"] === 7 && v.pedido.contagem["Fácil"] === 0 && v.pedido.area === "matematica", "nível único → toda a contagem nesse nível");
  const v2 = P.validarPedido({ disciplina: "Marciano", temas: "x", quantidade: "0", dificuldade: "insana", recurso: "video" });
  ok(!v2.ok && v2.erros.length === 4 && v2.faltam.includes("temas"), "erros explicados e tema curto apontado como faltante");
  ok(!P.validarPedido({ disciplina: "Física", temas: "ondas", quantidade: "1.5", dificuldade: "facil", recurso: "nenhum" }).ok && !P.validarPedido({ disciplina: "Física", temas: "ondas", quantidade: "-4", dificuldade: "facil", recurso: "nenhum" }).ok, "quantidade só com dígitos");
  const r = P.resumoPedido((P.validarPedido({ disciplina: "Física", temas: "a1, b2, c3", quantidade: "2", dificuldade: "facil", recurso: "nenhum" }) as any).pedido);
  ok(r.includes("só os 2 primeiros entram"), "mais temas que questões → aviso de sobras");
  ok(P.minutosEstimados((P.validarPedido({ disciplina: "Biologia", temas: "fotossíntese", quantidade: "10", dificuldade: "mista", recurso: "imagem" }) as any).pedido) === 17, "estimativa: 10 com imagem → 17 min");
  const conf: any = P.perguntaDoPasso("confirmar", { area: "natureza", disciplina: "Biologia", temas: Array.from({ length: 40 }, (_, i) => "tema bem comprido número " + i).join(", "), quantidade: "20", dificuldade: "Mista", recurso: "imagem" });
  ok(conf.interactive.body.text.length <= 1024, "corpo da confirmação nunca passa de 1024 caracteres");
});


// ============================================================================
// Etapa C — operário (robô): OIDC, fila, sessão, entrega
// ============================================================================
const URL_OP = "https://x/functions/v1/whatsapp-webhook?operario=1";
async function operario(acao: string, corpo: Record<string, unknown> = {}, token?: string, ambiente: Env = env) {
  const t = token ?? await tokenOidc();
  const r = await handler(new Request(URL_OP, { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ acao, ...corpo }) }), ambiente);
  return { status: r.status, json: await r.json() };
}
async function entregarArquivo(trabalhoId: string, dono: string, rotulo: string, nome: string, bytes = 1200, token?: string) {
  const fd = new FormData();
  fd.append("acao", "entregar"); fd.append("trabalho_id", trabalhoId); fd.append("dono", dono); fd.append("rotulo", rotulo); fd.append("nome", nome);
  fd.append("arquivo", new Blob([new Uint8Array(bytes).fill(65)], { type: "application/octet-stream" }), nome);
  const r = await handler(new Request(URL_OP, { method: "POST", headers: { authorization: `Bearer ${token ?? await tokenOidc()}` }, body: fd }), env);
  return { status: r.status, json: await r.json() };
}
// Pedido na fila pelo caminho real (formulário + Sim), 5 questões de Biologia com imagem.
async function pedidoNaFila(sufixo = "a") {
  await envia(`wamid.${sufixo}1`, "oi"); await toca(`wamid.${sufixo}2`, lr("area:natureza")); await toca(`wamid.${sufixo}3`, lr("disc:biologia"));
  await envia(`wamid.${sufixo}4`, "fotossíntese, respiração celular"); await envia(`wamid.${sufixo}5`, "5"); await toca(`wamid.${sufixo}6`, lr("dif:mista")); await toca(`wamid.${sufixo}7`, lr("rec:imagem"));
  await toca(`wamid.${sufixo}8`, botao("conf:sim"));
  return banco.trabalhos[banco.trabalhos.length - 1];
}
// pega + 4 arquivos; devolve o dono
async function pegaEEntregaTudo(t: any, nomes = ["a.pdf", "p.pdf", "a.docx", "p.docx"]) {
  const r = await operario("pegar", { trabalho_id: t.id });
  const dono = r.json.dono as string;
  for (const [i, rot] of ["pdf_aluno", "pdf_professor", "docx_aluno", "docx_professor"].entries()) await entregarArquivo(t.id, dono, rot, nomes[i]);
  return dono;
}
const docsEnviados = () => enviosWa.filter((m) => m.type === "document");
const envelhece = (t: any, ms: number) => { t.progresso.atualizado_em = new Date(Date.now() - ms).toISOString(); };

Deno.test("operário: só entra com token OIDC válido do repositório/branch/workflow (ou segredo compartilhado longo)", async () => {
  resetar(); vincula();
  ok((await handler(new Request(URL_OP, { method: "POST", body: "{}" }), env)).status === 401, "sem Authorization → 401");
  ok((await operario("pegar", {}, "abc.def")).status === 401, "token que não é JWT nem segredo → 401");
  ok((await operario("pegar", {}, await tokenOidc({ repository: "outro/Repo", sub: "repo:outro/Repo:ref:refs/heads/main" }))).status === 401, "OIDC de outro repositório → 401");
  ok((await operario("pegar", {}, await tokenOidc({ repository_id: "999" }))).status === 401, "mesmo nome, id de repositório diferente (renomeado/recriado) → 401");
  ok((await operario("pegar", {}, await tokenOidc({ ref: "refs/heads/teste" }))).status === 401, "OIDC de outra branch → 401");
  ok((await operario("pegar", {}, await tokenOidc({ workflow_ref: "Turco2025/Enem/.github/workflows/outro.yml@refs/heads/main" }))).status === 401, "outro workflow do mesmo repositório → 401");
  ok((await operario("pegar", {}, await tokenOidc({ event_name: "pull_request" }))).status === 401, "evento pull_request → 401");
  ok((await operario("pegar", {}, await tokenOidc({ aud: "outra-audiencia" }))).status === 401, "audiência errada → 401");
  ok((await operario("pegar", {}, await tokenOidc({ exp: Math.floor(Date.now() / 1000) - 5 }))).status === 401, "token expirado → 401");
  ok((await operario("pegar", {}, await tokenOidc({}, parChavesIntruso.privateKey))).status === 401, "assinatura de outra chave (mesmo kid) → 401");
  ok((await operario("pegar", {}, await tokenOidc({}, parChaves.privateKey, "kid-desconhecido"))).status === 401, "kid desconhecido no JWKS → 401");
  const okVazio = await operario("pegar");
  ok(okVazio.status === 200 && okVazio.json.trabalho === null && okVazio.json.motivo === "fila vazia", "token válido com fila vazia → trabalho null");
  ok((await operario("pegar", {}, await tokenOidc({ aud: [O.AUDIENCIA_OIDC, "x"] }))).status === 200, "aud em lista também vale");
  jwksFora = true; O.limparCacheJwks();
  ok((await operario("pegar")).status === 503, "JWKS do GitHub fora do ar → 503 (robô tenta de novo), não 401");
  jwksFora = false;
  const envTok: Env = { ...env, WA_OPERARIO_TOKEN: "segredo-compartilhado-bem-longo-123456" };
  ok((await operario("pegar", {}, "segredo-compartilhado-bem-longo-123456", envTok)).status === 200, "segredo compartilhado configurado é aceito");
  ok((await operario("pegar", {}, "segredo-compartilhado-bem-longo-123456")).status === 401, "mesmo segredo sem estar configurado → 401");
  const envCurto: Env = { ...env, WA_OPERARIO_TOKEN: "curto" };
  ok((await operario("pegar", {}, "curto", envCurto)).status === 401, "segredo curto demais nunca é aceito");
  ok((await operario("acao_inventada", { trabalho_id: crypto.randomUUID(), dono: crypto.randomUUID() })).status === 400, "ação desconhecida → 400");
  ok((await operario("progresso", { trabalho_id: "nao-e-uuid" })).status === 400, "trabalho_id inválido → 400");
  ok((await operario("progresso", { trabalho_id: crypto.randomUUID() })).status === 400, "sem dono → 400");
  const nulo = await handler(new Request(URL_OP, { method: "POST", headers: { authorization: `Bearer ${await tokenOidc()}`, "content-type": "application/json" }, body: "null" }), env);
  ok(nulo.status === 400, "corpo JSON nulo → 400 (não derruba a função)");
  const f = await operario("fila");
  ok(f.status === 200 && f.json.pendentes === 0 && f.json.prontos === 0 && f.json.avisos === 0, "fila: contagens (vazia)");
});

Deno.test("operário: fluxo completo — pegar (sessão + dono + aviso) → progresso → entregar ×4 → concluir (documentos + resumo) → enviado", async () => {
  resetar(); vincula();
  const t = await pedidoNaFila();
  ok(t.status === "pendente" && enviosWa.length >= 8, "pedido pendente depois do Sim");
  ok((await operario("fila")).json.pendentes === 1, "fila: 1 pendente");
  const antes = enviosWa.length;
  const r = await operario("pegar");
  const dono = r.json.dono;
  ok(r.status === 200 && r.json.trabalho?.id === t.id && r.json.trabalho.tentativa === 1 && r.json.trabalho.parametros.quantidade === 5 && r.json.sessao?.access_token === "ACESSO_TESTE" && r.json.sessao.refresh_token === "REFRESH_TESTE" && /^[0-9a-f-]{36}$/.test(dono), "pegar devolve o pedido, a tentativa, o dono e a sessão do professor");
  ok(t.status === "gerando" && t.iniciado_em && t.progresso.tentativas === 1 && t.progresso.dono === dono && t.progresso.atualizado_em, "pedido passou a gerando com dono e sinal de vida");
  const authChamadas = chamadas.filter((c) => c.url.includes("/auth/v1/")).map((c) => c.url.split("/auth/v1/")[1].split("?")[0]);
  ok(authChamadas[0].startsWith("admin/users/u1") && authChamadas[1] === "admin/generate_link" && authChamadas[2] === "verify", "sessão: e-mail do usuário → generate_link (magiclink) → verify (token_hash)");
  ok(!JSON.stringify(r.json).includes("professor.turco"), "nenhum e-mail sai na resposta ao robô");
  ok(enviosWa.length === antes + 1 && ultimo().text.body.startsWith("🛠️ Comecei a gerar seu simulado de Biologia (5 questões") && ultimo().text.body.includes("fotossíntese"), "professor avisado: começou a gerar");
  // outro robô tentando o mesmo pedido / fila vazia
  const r2 = await operario("pegar", { trabalho_id: t.id });
  ok(r2.status === 200 && r2.json.trabalho === null && /gerando/.test(r2.json.motivo), "mesmo pedido de novo → null (já está gerando)");
  ok((await operario("pegar")).json.trabalho === null, "fila vazia para o segundo robô");
  // progresso: só o dono
  const outro = crypto.randomUUID();
  ok((await operario("progresso", { trabalho_id: t.id, dono: outro, estado: { prontas: 9 } })).status === 409 && t.progresso.prontas === undefined, "progresso com outro dono → 409, nada gravado");
  const pr = await operario("progresso", { trabalho_id: t.id, dono, estado: { fase: "gerando", total: 5, prontas: 2, gerando: 3, erros: 0, imagensPendentes: 1, lixo: "x".repeat(500), outro: { a: 1 } } });
  ok(pr.status === 200 && t.progresso.total === 5 && t.progresso.prontas === 2 && t.progresso.lixo === undefined && t.progresso.outro === undefined && t.progresso.dono === dono, "progresso gravado só com os campos conhecidos (dono preservado)");
  await envia("wamid.s1", "status");
  ok(ultimo().text.body.includes("gerando agora (2 de 5 prontas)"), "STATUS mostra o andamento");
  // entrega dos 4 arquivos
  ok((await entregarArquivo(t.id, outro, "pdf_aluno", "x.pdf")).status === 409 && midiasSubidas.length === 0, "entregar com outro dono → 409 e nada sobe para a Meta");
  const e1 = await entregarArquivo(t.id, dono, "pdf_aluno", "Simulado_ENEM_Biologia_fotossintese_aluno.pdf", 3000);
  ok(e1.status === 200 && e1.json.media_id === "media.1" && midiasSubidas[0].tipo === "application/pdf" && midiasSubidas[0].nome.endsWith("_aluno.pdf") && midiasSubidas[0].bytes === 3000, "PDF do aluno subiu para a Meta como application/pdf");
  const e2 = await entregarArquivo(t.id, dono, "pdf_professor", "../..\\Simulado:ENEM?professor.pdf");
  ok(e2.status === 200 && (midiasSubidas[1].nome === "Simulado ENEM professor.pdf" || midiasSubidas[1].nome === "SimuladoENEMprofessor.pdf"), "nome do arquivo saneado (sem caminho nem caracteres proibidos)");
  const e3 = await entregarArquivo(t.id, dono, "docx_aluno", "Simulado_ENEM_Biologia_aluno.docx");
  const e4 = await entregarArquivo(t.id, dono, "docx_professor", "Simulado_ENEM_Biologia_professor.docx");
  ok(e3.status === 200 && e4.status === 200 && midiasSubidas[2].tipo === O.MIMES_ACEITOS.docx && t.documentos.length === 4, "DOCX subiram com o MIME do Word; 4 documentos anexados ao pedido");
  ok((await entregarArquivo(t.id, dono, "pdf_aluno", "de-novo.pdf")).status === 200 && t.documentos.length === 4 && t.documentos.find((d: any) => d.rotulo === "pdf_aluno").media_id === "media.5", "reentrega do mesmo rótulo substitui, não duplica");
  ok((await entregarArquivo(t.id, dono, "zip_tudo", "x.zip")).status === 400, "rótulo desconhecido → 400");
  ok((await entregarArquivo(t.id, dono, "pdf_aluno", "vazio.pdf", 0)).status === 400, "arquivo vazio → 400");
  // concluir
  ok((await operario("concluir", { trabalho_id: t.id, dono: outro, resumo: {} })).status === 409, "concluir com outro dono → 409");
  const antesDocs = enviosWa.length;
  const c = await operario("concluir", { trabalho_id: t.id, dono, resumo: { total: 5, prontas: 4, falhas: [{ numero: 3, motivo: "imagem obrigatória não gerada" }], custo: { textoUSD: 0.371, imagensUSD: 0.052 }, simuladoId: "b7b74277-d554-461b-97cb-96e7dfc24562" } });
  ok(c.status === 200 && c.json.status === "enviado" && t.status === "enviado" && t.concluido_em && t.simulado_id === "b7b74277-d554-461b-97cb-96e7dfc24562", "concluir → enviado, com simulado_id");
  const novos = enviosWa.slice(antesDocs);
  ok(novos.length === 5 && novos.slice(0, 4).every((m) => m.type === "document") && novos[4].type === "text", "4 documentos e depois o resumo");
  ok(novos.slice(0, 4).map((m) => m.document.id).join(",") === "media.5,media.2,media.3,media.4" && novos[0].document.filename === "de-novo.pdf" && novos[1].document.caption.includes("professor") && novos[2].document.caption.startsWith("Word · versão do aluno"), "ordem fixa: PDF aluno, PDF professor, Word aluno, Word professor — com legendas");
  const fim = novos[4].text.body;
  ok(fim.startsWith("✅ Simulado pronto: 4 de 5 questões de Biologia") && fim.includes("Meus Simulados") && fim.includes("US$ 0.42") && fim.includes("1 questão não ficou pronta (nº 3): imagem obrigatória não gerada"), "resumo com custo e a questão que faltou");
  ok(t.progresso.entrega_faltam.length === 0 && Array.isArray(t.progresso.entrega_ids) && t.progresso.entrega_ids.length === 5 && t.progresso.entrega_ids.every((x: string) => x.startsWith("wamid.resp")) && Object.keys(t.progresso.entrega_mapa).length === 5 && t.progresso.reentregas === 0, "ids das 5 mensagens da entrega guardados, nada faltando, zero reentregas");
  ok((await operario("concluir", { trabalho_id: t.id, dono, resumo: {} })).status === 409 && enviosWa.length === antesDocs + 5, "concluir de novo → 409, nada reenviado");
  await envia("wamid.s2", "status");
  ok(ultimo().text.body.includes("enviado ✅"), "STATUS: enviado");
});

Deno.test("operário: janela de 24 h fechada → 'pronto' e a próxima mensagem do professor entrega (retomando de onde parou); falha transitória → varredura entrega; status 'failed' assíncrono reabre", async () => {
  resetar(); vincula();
  const t = await pedidoNaFila("b");
  const dono = await pegaEEntregaTudo(t);
  graphJanelaFechada = true;
  const c = await operario("concluir", { trabalho_id: t.id, dono, resumo: { total: 5, prontas: 5, falhas: [], custo: { textoUSD: 0.4 } } });
  ok(c.status === 200 && c.json.status === "pronto" && t.status === "pronto" && t.progresso.entrega_codigo === 131047 && t.progresso.entrega_faltam.length === 5 && t.progresso.entrega_ids.length === 0, "janela fechada → pedido fica 'pronto' com o código da Meta, as 5 mensagens ainda faltando");
  const vj = await operario("entregas_pendentes");
  ok(vj.status === 200 && vj.json.entregues === 0 && t.status === "pronto" && (await operario("fila")).json.prontos === 0, "a varredura NÃO insiste em janela fechada (só o professor reabre) e a fila não conta esse pronto como trabalho");
  graphJanelaFechada = false;
  const antes = enviosWa.length;
  await envia("wamid.b9", "oi");
  const novos = enviosWa.slice(antes);
  ok(t.status === "enviado" && novos[0].type === "text" && novos[0].text.body.startsWith("📎 Seu simulado de Biologia ficou pronto") && novos.slice(1, 5).every((m) => m.type === "document") && novos[5].text.body.startsWith("✅ Simulado pronto: 5 de 5") && !novos[5].text.body.includes("Meus Simulados"), "mensagem do professor → aviso + 4 documentos + resumo (sem 'Meus Simulados', pois não houve simuladoId); status enviado");
  ok(novos[6]?.interactive?.body?.text?.includes("1/6") && banco.mensagens.get("wamid.b9").acao === "guiado_iniciado" && banco.mensagens.get("wamid.b9").resposta.startsWith("[entregou 1 simulado(s) pronto(s)]"), "e o 'oi' ainda começa o formulário normalmente");
  // falha transitória na 3ª mensagem → pronto com 2 entregues; a varredura retoma da 3ª (sem repetir as 2 primeiras)
  resetar(); vincula();
  const t2 = await pedidoNaFila("c");
  const dono2 = await pegaEEntregaTudo(t2);
  enviosOkSeguidos = 0; graphFalhaApos = 2;
  const c2 = await operario("concluir", { trabalho_id: t2.id, dono: dono2, resumo: { total: 5, prontas: 5, falhas: [], simuladoId: "b7b74277-d554-461b-97cb-96e7dfc24562" } });
  ok(c2.json.status === "pronto" && t2.status === "pronto" && JSON.stringify(t2.progresso.entrega_faltam) === "[2,3,4]" && t2.progresso.entrega_ids.length === 2, "falha transitória na 3ª mensagem → pronto, faltam as mensagens 3 a 5, ids das 2 primeiras gravados");
  graphFalhaApos = null;
  ok((await operario("fila")).json.prontos === 1, "fila conta esse pronto (falha transitória é acionável)");
  const antes2 = docsEnviados().length;
  const v = await operario("entregas_pendentes");
  ok(v.json.entregues === 1 && t2.status === "enviado" && docsEnviados().length === antes2 + 2 && t2.progresso.entrega_faltam.length === 0 && t2.progresso.entrega_ids.length === 5 && t2.progresso.reentregas === 1 && !enviosWa.slice(-3)[0].text, "varredura retoma da 3ª mensagem: 2 documentos + resumo, sem reenviar os 2 primeiros nem aviso de atraso no meio; 1 reentrega contada");
  // status "failed" assíncrono da Meta para a 4ª mensagem → volta a pronto a partir dela
  const idFalhou = t2.progresso.entrega_ids[3];
  await postAssinado({ object: "whatsapp_business_account", entry: [{ id: "935766732459650", changes: [{ value: { messaging_product: "whatsapp", metadata: {}, statuses: [{ id: idFalhou, status: "failed", recipient_id: "556296116652", errors: [{ code: 131047, title: "Re-engagement message" }] }] }, field: "messages" }] }] });
  ok(t2.status === "pronto" && JSON.stringify(t2.progresso.entrega_faltam) === "[3]" && t2.progresso.entrega_codigo === 131047, "status failed → pedido volta a 'pronto' só com a 4ª mensagem faltando");
  // status failed de uma mensagem anterior chegando fora de ordem também entra na lista
  const idFalhou2 = t2.progresso.entrega_ids[0];
  await postAssinado({ object: "whatsapp_business_account", entry: [{ id: "935766732459650", changes: [{ value: { messaging_product: "whatsapp", metadata: {}, statuses: [{ id: idFalhou2, status: "failed", recipient_id: "556296116652", errors: [{ code: 131047, title: "Re-engagement message" }] }] }, field: "messages" }] }] });
  ok(JSON.stringify(t2.progresso.entrega_faltam) === "[0,3]", "segundo status failed (fora de ordem) → faltam a 1ª e a 4ª");
  const antes3 = enviosWa.length;
  await envia("wamid.c9", "status");
  ok(t2.status === "enviado" && enviosWa.slice(antes3, antes3 + 3).map((m) => m.type).join(",") === "document,document,text" && enviosWa[antes3].document.id === t2.documentos.find((d: any) => d.rotulo === "pdf_aluno").media_id && enviosWa[antes3 + 1].document.id === t2.documentos.find((d: any) => d.rotulo === "docx_professor").media_id && enviosWa[antes3 + 2].text.body.includes("enviado ✅"), "próxima mensagem do professor: só a 1ª e a 4ª (documentos), sem repetir o resumo nem aviso de atraso; depois a resposta ao STATUS");
  // status failed DURANTE a entrega (pedido 'entregando') → 500 para a Meta reentregar depois
  t2.status = "entregando";
  const rst = await postAssinado({ object: "whatsapp_business_account", entry: [{ id: "935766732459650", changes: [{ value: { messaging_product: "whatsapp", metadata: {}, statuses: [{ id: t2.progresso.entrega_ids[1], status: "failed", recipient_id: "556296116652", errors: [{ code: 131047, title: "x" }] }] }, field: "messages" }] }] });
  ok(rst.status === 500 && t2.status === "entregando", "status failed com a entrega em andamento → 500 (a Meta reentrega o status mais tarde)");
  t2.status = "enviado";
  // reentregas em excesso → falhou com aviso para exportar pelo app
  resetar(); vincula();
  const t4 = await pedidoNaFila("i");
  const dono4 = await pegaEEntregaTudo(t4);
  enviosOkSeguidos = 0; graphFalhaApos = 0;
  await operario("concluir", { trabalho_id: t4.id, dono: dono4, resumo: { total: 5, prontas: 5, falhas: [] } });
  for (let k = 0; k < 3; k++) await operario("entregas_pendentes");
  ok(t4.status === "pronto" && t4.progresso.reentregas === 3, "3 reentregas sem sucesso: ainda pronto");
  graphFalhaApos = null;
  const antes4 = enviosWa.length;
  await operario("entregas_pendentes");
  ok(t4.status === "falhou" && t4.erro.startsWith("entrega não concluída após 3 reentregas") && enviosWa.length === antes4 + 1 && ultimo().text.body.includes("Meus Simulados"), "4ª reentrega excede o limite → falhou e avisa para exportar pelo app");
  // entregando travado (função morreu) → varredura destrava e entrega
  resetar(); vincula();
  const t3 = await pedidoNaFila("d");
  const dono3 = await pegaEEntregaTudo(t3);
  await operario("concluir", { trabalho_id: t3.id, dono: dono3, resumo: { total: 5, prontas: 5, falhas: [] } });
  t3.status = "entregando"; t3.progresso.entregando_em = new Date(Date.now() - O.ENTREGANDO_TRAVADO_MS - 1000).toISOString(); t3.progresso.entregues = 0; t3.progresso.entrega_ids = [];
  const v3 = await operario("entregas_pendentes");
  ok(v3.json.destravados === 1 && v3.json.entregues === 1 && t3.status === "enviado", "'entregando' parado há > 5 min volta a pronto e é entregue pela varredura");
});

Deno.test("operário: falha → volta à fila (só depois de 10 min) até 3 tentativas, depois 'falhou' com aviso amigável; definitivo falha na hora; sem sinal de vida é retomado", async () => {
  resetar(); vincula();
  const t = await pedidoNaFila("d");
  const r1 = await operario("pegar");
  const antes = enviosWa.length;
  ok((await operario("falhou", { trabalho_id: t.id, dono: crypto.randomUUID(), motivo: "x" })).status === 409, "falhou com outro dono → 409");
  const f1 = await operario("falhou", { trabalho_id: t.id, dono: r1.json.dono, motivo: "Chromium caiu   no meio\n da geração" });
  ok(f1.json.status === "pendente" && t.status === "pendente" && t.iniciado_em === null && t.erro === "Chromium caiu no meio da geração" && t.progresso.dono === null && t.progresso.tentar_apos && enviosWa.length === antes, "1ª falha: volta à fila com espera, erro guardado, dono limpo, professor não avisado");
  ok((await operario("pegar")).json.trabalho === null, "varredura logo em seguida NÃO repega o pedido que acabou de falhar");
  t.progresso.tentar_apos = new Date(Date.now() - 1000).toISOString();
  const p2 = await operario("pegar");
  ok(p2.json.trabalho?.id === t.id && p2.json.trabalho.tentativa === 2 && enviosWa.length === antes, "passada a espera: 2ª tentativa, sem repetir o 'Comecei a gerar'");
  await operario("falhou", { trabalho_id: t.id, dono: p2.json.dono, motivo: "erro 2" });
  t.progresso.tentar_apos = new Date(Date.now() - 1000).toISOString();
  const p3 = await operario("pegar");
  ok(p3.json.trabalho.tentativa === 3, "3ª tentativa");
  const f3 = await operario("falhou", { trabalho_id: t.id, dono: p3.json.dono, motivo: "tempo esgotado após 40 min (gerando 3/5)" });
  ok(f3.json.status === "falhou" && t.status === "falhou" && ultimo().text.body.startsWith("❌ Não consegui gerar o simulado de Biologia (5 questões): a geração demorou demais e foi interrompida") && ultimo().text.body.includes('Mande "oi"'), "3ª falha: falhou + aviso em linguagem de gente");
  ok((await operario("falhou", { trabalho_id: t.id, dono: p3.json.dono, motivo: "x" })).status === 409, "falhou de novo → 409");
  await envia("wamid.st", "status");
  ok(ultimo().text.body.includes("falhou ❌") && ultimo().text.body.includes("Motivo: a geração demorou demais"), "STATUS mostra o motivo amigável");
  // definitivo na primeira
  const t2 = await pedidoNaFila("e");
  const pe = await operario("pegar");
  const fd = await operario("falhou", { trabalho_id: t2.id, dono: pe.json.dono, motivo: "área inválida: quimica", definitivo: true });
  ok(fd.json.status === "falhou" && t2.status === "falhou" && ultimo().text.body.includes("os parâmetros do pedido não foram aceitos"), "definitivo: falha e avisa na hora, sem jargão");
  // sem sinal de vida: gerando há > 15 min sem progresso → outro robô retoma; na 3ª vez desiste e avisa
  const t3 = await pedidoNaFila("f");
  const p31 = await operario("pegar");
  ok((await operario("pegar", { trabalho_id: t3.id })).json.trabalho === null, "gerando com sinal recente não é retomado");
  envelhece(t3, O.TRABALHO_TRAVADO_MS + 60_000);
  ok((await operario("progresso", { trabalho_id: t3.id, dono: p31.json.dono, estado: { prontas: 1 } })).status === 200, "o dono original ainda renova o sinal se voltar antes de alguém retomar");
  envelhece(t3, O.TRABALHO_TRAVADO_MS + 60_000);
  const re = await operario("pegar", { trabalho_id: t3.id });
  ok(re.json.trabalho?.id === t3.id && re.json.trabalho.tentativa === 2 && t3.status === "gerando" && re.json.dono !== p31.json.dono, "sem sinal há > 15 min → retomado por outro dono (tentativa 2)");
  ok((await operario("progresso", { trabalho_id: t3.id, dono: p31.json.dono, estado: { prontas: 2 } })).status === 409 && (await operario("falhou", { trabalho_id: t3.id, dono: p31.json.dono, motivo: "x" })).status === 409, "o robô antigo perdeu o pedido: progresso e falhou → 409 (não derruba o novo dono)");
  envelhece(t3, O.TRABALHO_TRAVADO_MS + 60_000); t3.progresso.tentativas = 3;
  const antes3 = enviosWa.length;
  const re3 = await operario("pegar", { trabalho_id: t3.id });
  ok(re3.json.trabalho === null && /esgotou/.test(re3.json.motivo) && t3.status === "falhou" && t3.erro.startsWith("desistiu após 3 tentativas"), "3 tentativas esgotadas → falhou");
  ok(re3.json.falhasAvisadas === 1 && enviosWa.length === antes3 + 1 && ultimo().text.body.startsWith("❌ Não consegui gerar") && t3.progresso.avisado === "sim", "o mesmo pegar já avisa o professor da desistência");
  ok((await operario("pegar")).json.falhasAvisadas === 0, "não avisa de novo");
  // aviso cujo envio falhou é repetido depois de 10 min; a fila conta avisos pendentes
  t3.progresso.avisado = "falhou_envio"; t3.progresso.avisado_em = new Date(Date.now() - 11 * 60_000).toISOString();
  ok((await operario("fila")).json.avisos === 1, "fila conta a desistência ainda não avisada");
  ok((await operario("pegar")).json.falhasAvisadas === 1 && t3.progresso.avisado === "sim", "aviso repetido depois de 10 min");
  // Auth indisponível: devolve o pedido à fila sem gastar tentativa, com espera; na 3ª vez desiste e avisa
  const t4 = await pedidoNaFila("g");
  authFalha = true;
  const pa = await operario("pegar");
  ok(pa.status === 503 && t4.status === "pendente" && t4.progresso.tentativas === 0 && t4.progresso.falhas_sessao === 1 && t4.progresso.dono === null && t4.progresso.tentar_apos && t4.erro.startsWith("sessão do professor indisponível"), "sem sessão → 503, pedido volta à fila com espera e a tentativa de geração não conta");
  ok((await operario("pegar")).json.trabalho === null && (await operario("fila")).json.pendentes === 0, "em espera, o pedido não trava a fila (não é repegado nem contado)");
  t4.progresso.tentar_apos = new Date(Date.now() - 1000).toISOString();
  authFalha = false;
  const pb = await operario("pegar");
  ok(pb.json.trabalho?.id === t4.id && pb.json.trabalho.tentativa === 1 && ultimo().text.body.startsWith("🛠️ Comecei"), "passada a espera, pega normalmente como 1ª tentativa, com o aviso");
  await operario("falhou", { trabalho_id: t4.id, dono: pb.json.dono, motivo: "x", definitivo: true });
  const t6 = await pedidoNaFila("j");
  authFalha = true;
  for (let k = 0; k < 2; k++) { await operario("pegar"); t6.progresso.tentar_apos = new Date(Date.now() - 1000).toISOString(); }
  const antes6 = enviosWa.length;
  const pz = await operario("pegar");
  ok(pz.status === 200 && pz.json.trabalho === null && t6.status === "falhou" && t6.progresso.falhas_sessao === 3 && enviosWa.length === antes6 + 1 && ultimo().text.body.includes("não consegui acessar sua conta"), "3ª falha de sessão seguida → falhou com aviso compreensível");
  authFalha = false;
  // aviso "Comecei" falhando (Graph fora) não derruba o pegar
  const t5 = await pedidoNaFila("h");
  graphFalha = "transitorio";
  const pc = await operario("pegar");
  graphFalha = false;
  ok(pc.status === 200 && pc.json.trabalho?.id === t5.id && t5.status === "gerando", "aviso inicial recusado pela Meta não impede o pegar");
});

Deno.test("operário: com WA_GITHUB_TOKEN o Sim dispara a execução na hora (repository_dispatch) e o texto diz 'começa agora'", async () => {
  resetar(); vincula();
  const envGh: Env = { ...env, WA_GITHUB_TOKEN: "github_pat_teste" };
  const sg = (texto: string, w: string) => postAssinado(payloadMeta(texto, w), env.WHATSAPP_APP_SECRET, envGh);
  const tg = (w: string, inter: any) => postAssinado(payloadMeta("", w, "556296116652", "Maziad", "interactive", "556296116652", inter), env.WHATSAPP_APP_SECRET, envGh);
  await sg("oi", "wamid.h1"); await tg("wamid.h2", lr("area:matematica")); await tg("wamid.h3", lr("disc:matematica")); await sg("funções", "wamid.h4"); await sg("3", "wamid.h5"); await tg("wamid.h6", lr("dif:facil")); await tg("wamid.h7", lr("rec:nenhum")); await tg("wamid.h8", botao("conf:sim"));
  const t = banco.trabalhos[0];
  ok(dispatches.length === 1 && dispatches[0].url === "https://api.github.com/repos/Turco2025/Enem/dispatches" && dispatches[0].corpo.event_type === "wa-pedido" && dispatches[0].corpo.client_payload.trabalho_id === t.id && dispatches[0].auth === "Bearer github_pat_teste", "repository_dispatch com o id do pedido");
  ok(banco.mensagens.get("wamid.h8").acao === "pedido_criado" && ultimo().text.body.includes("começa agora") && ultimo().text.body.includes("PDF e Word"), "texto: começa agora");
  const s = await handler(new Request("https://x/w?selftest=1&t=fraseVerificacaoTeste2026"), envGh);
  ok((await s.json()).operario.disparoImediato === true, "selftest: disparo imediato ligado");
});

Deno.test("operario.ts/logica.ts: sanitização de progresso e resumo, motivo amigável, nome de arquivo, rótulos", () => {
  const r = resumoDaGeracao({ total: 5, prontas: 7, falhas: [{ numero: 2, motivo: "m".repeat(400) }, { numero: 0, motivo: "x" }, "lixo"], custo: { textoUSD: "0.10", imagensUSD: 0.2 }, simuladoId: "------------------------------------" });
  ok(r.total === 5 && r.prontas === 7 && r.falhas.length === 1 && r.falhas[0].motivo.length === 300 && r.custoUSD === 0.3 && r.simuladoId === null, "resumoDaGeracao limita e descarta o que não serve (36 hífens não é uuid)");
  ok(resumoDaGeracao(r).custoUSD === 0.3 && resumoDaGeracao(r).falhas.length === 1, "resumoDaGeracao é idempotente sobre o formato gravado");
  ok(JSON.stringify(O.sanitizaProgresso({ total: 3.7, prontas: -1, fase: "f".repeat(80), x: 1 })) === JSON.stringify({ total: 3, prontas: 0, fase: "f".repeat(40) }), "sanitizaProgresso");
  ok(O.nomeArquivoSeguro("C:\\\\pasta\\\\Simulado_ENEM_Biologia_aluno.PDF", "pdf") === "Simulado_ENEM_Biologia_aluno.pdf" && O.nomeArquivoSeguro("", "docx") === "Simulado_ENEM.docx", "nomeArquivoSeguro");
  ok(O.descricaoRotulo("docx_professor").startsWith("Word · versão do professor") && O.ORDEM_ENTREGA.length === 4, "rótulos");
  ok(O.pareceJwt("eyJa.bbb.ccc") && !O.pareceJwt("segredo") && O.decodificarJwt("a.b") === null, "pareceJwt/decodificarJwt");
  ok(O.bytesParaBase64Url(O.base64UrlParaBytes("SGVsbG8_d29ybGQ")) === "SGVsbG8_d29ybGQ", "base64url ida e volta");
  ok(motivoAmigavel('entregar pdf_aluno: HTTP 502 a Meta recusou a mídia {"error":1}') === "houve uma falha técnica na entrega dos arquivos" && motivoAmigavel("nenhuma questão ficou pronta: Erro HTTP 546 ao gerar a questão.") === "nenhuma questão ficou pronta (Erro HTTP 546 ao gerar a questão.)" && motivoAmigavel("quantidade inválida: 0") === "os parâmetros do pedido não foram aceitos pelo aplicativo", "motivoAmigavel");
});

Deno.test("resumo", () => { console.log(`\n>>> ${total} verificações passaram`); });

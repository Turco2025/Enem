// Testes locais da lógica do webhook (sem rede): assinatura, verificação,
// dedupe, pareamento, bloqueio, reprocessamento, respostas e, na etapa B1, o pedido
// por frase livre (regras + Claude falso), confirmação, correção, fila e comandos.
// Roda com: deno test -A --no-check teste_logica.ts
import {
  handler, assinaturaHmacSha256, extrairCodigoVinculo, mascararEmail, decidirReentrega, envioTransitorio, formaAlternativaBr,
  TEXTOS, MAX_TENTATIVAS_CODIGO, TRAVADA_APOS_MS, REPROCESSAR_ATE_MS, comandoDe, inicioDoDiaBrasilia, type Env,
} from "./logica.ts";
import * as P from "./pedido.ts";

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

function resetar() { banco.mensagens.clear(); banco.perfis.clear(); banco.vinculos.length = 0; banco.conversas.clear(); banco.trabalhos.length = 0; chamadas.length = 0; enviosWa.length = 0; graphFalha = false; contagemFora = false; graphDemoraMs = 0; listaTestes = null; dbDemoraMs = 0; }
const param = (url: string, k: string) => { const v = new URL(url).searchParams.get(k); return v === null ? null : decodeURIComponent(v); };

globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
  const metodo = init?.method ?? "GET";
  const corpo: any = init?.body ? JSON.parse(String(init.body)) : null;
  chamadas.push({ url, metodo, corpo });
  const j = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });

  if (url.startsWith("https://graph.facebook.com/")) {
    if (!(init?.headers as any)?.authorization?.includes("TOKEN_TESTE")) return j({ error: "sem token" }, 401);
    if (url.endsWith("/935766732459650/subscribed_apps")) {
      if (metodo === "POST") { wabaAssinada = true; return j({ success: true }); }
      return j({ data: wabaAssinada ? [{ whatsapp_business_api_data: { id: "1708104537155293", name: "Gerador Enem" } }] : [] });
    }
    if (corpo?.status === "read") return j({ success: true });   // confirmação de leitura: não conta como resposta
    if (graphDemoraMs) await new Promise((r) => setTimeout(r, graphDemoraMs));
    if (graphFalha === "permanente") return j({ error: { message: "(#131030) Recipient phone number not in allowed list", code: 131030 } }, 400);
    if (graphFalha === "transitorio") return j({ error: { message: "(#130429) Rate limit hit", code: 130429 } }, 400);
    if (listaTestes && !listaTestes.includes(corpo?.to)) return j({ error: { message: "(#131030) Recipient phone number not in allowed list", type: "OAuthException", code: 131030, error_data: { messaging_product: "whatsapp", details: "O número de telemóvel do destinatário não está na lista de permissões: Adiciona o número de telemóvel do destinatário à lista de destinatários no painel de aplicações da Meta e tenta novamente. Consulta https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages para mais informações." }, fbtrace_id: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789" } }, 400);
    enviosWa.push(corpo);
    return j({ messages: [{ id: "wamid.resposta" }] });
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
  if (/\/rest\/v1\/(wa_vinculos|wa_conversas|wa_trabalhos)/.test(url) && metodo === "HEAD") return new Response(null, { status: 200, headers: { "content-range": "0-0/0" } });
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
    if (metodo === "POST") { const t = { id: crypto.randomUUID(), criado_em: new Date().toISOString(), erro: null, concluido_em: null, ...corpo }; banco.trabalhos.push(t); return j([t], 201); }
    const uid = param(url, "user_id")?.replace("eq.", "");
    if (metodo === "PATCH") {
      const st = param(url, "status")?.replace("eq.", "");
      const alvo = banco.trabalhos.filter((t) => t.user_id === uid && (!st || t.status === st));
      alvo.forEach((t) => Object.assign(t, corpo)); return j(alvo);
    }
    const desde = param(url, "criado_em")?.replace("gte.", "");
    const wamid = param(url, "parametros->>wamid_pedido")?.replace("eq.", "");
    const lim = Number(param(url, "limit") || 50);
    const lista = banco.trabalhos.filter((t) => (wamid ? t.parametros?.wamid_pedido === wamid : t.user_id === uid) && (!desde || t.criado_em >= desde)).sort((a, b) => b.criado_em < a.criado_em ? -1 : 1).slice(0, lim);
    return j(wamid ? lista.map((t) => ({ id: t.id, status: t.status, parametros: t.parametros })) : lista);
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
  ok(r.status === 200 && j.versao === "B1.0" && j.secretsPresentes.WHATSAPP_TOKEN === true && j.secretsPresentes.WHATSAPP_APP_SECRET === true, "selftest com t certo → 200 com presença dos secrets");
  ok(s.indexOf("TOKEN_TESTE") < 0 && s.indexOf("segredo-de-teste") < 0 && s.indexOf("service-teste") < 0 && s.indexOf("fraseVerificacao") < 0, "nenhum valor de secret aparece na saída");
  ok(j.tabelas.perfis.startsWith("ok") && j.tabelas.wa_mensagens.startsWith("ok") && j.tabelas.wa_conversas.startsWith("ok") && j.tabelas.wa_trabalhos.startsWith("ok") && j.operarioConfigurado === false, "tabelas consultadas; operário não configurado");
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
  ok(ultimo().text.body.includes("registrado na fila") && !ultimo().text.body.includes("Tempo estimado"), "sem operário: avisa fila, não promete geração");
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
  ok(banco.trabalhos.length === 1 && banco.mensagens.get("wamid.g7").acao === "reentrega_encerrado" && ultimo().text.body.includes("registrado na fila") && !banco.conversas.get("556296116652").estado.passo, "reentrega do Sim repete a confirmação, sem segundo trabalho");
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

Deno.test("resumo", () => { console.log(`\n>>> ${total} verificações passaram`); });

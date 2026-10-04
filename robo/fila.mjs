// robo/fila.mjs — pergunta ao webhook se há trabalho antes de instalar o Chromium.
//
// Roda primeiro na varredura do cron (a cada 10 min): sem dependências, só um fetch. Se a fila
// estiver vazia, o workflow pula a instalação e termina em segundos. Com um pedido indicado
// (TRABALHO_ID, disparo imediato) nunca pula. Falha na consulta → segue (quem decide é o operário).
// Saída para o GitHub Actions: `vazia=true|false` em $GITHUB_OUTPUT.

import { appendFile } from "node:fs/promises";
import { obterCredencial, log } from "./comum.mjs";

const WEBHOOK_URL = (process.env.WEBHOOK_URL || "https://gkceyrkdmnhgqimmrsre.supabase.co/functions/v1/whatsapp-webhook").replace(/\/+$/, "");
const TRABALHO_ID = (process.env.TRABALHO_ID || "").trim();

async function saida(vazia) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `vazia=${vazia ? "true" : "false"}\n`);
  log(vazia ? "fila vazia: nada a fazer nesta varredura" : "há trabalho: seguindo para a instalação do Chromium");
}

if (TRABALHO_ID) { await saida(false); }
else {
  try {
    const r = await fetch(`${WEBHOOK_URL}?operario=1`, {
      method: "POST", headers: { authorization: `Bearer ${await obterCredencial()}`, "content-type": "application/json" },
      body: JSON.stringify({ acao: "fila" }), signal: AbortSignal.timeout(60_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { log(`fila: HTTP ${r.status} ${String(j.erro || "").slice(0, 120)} — seguindo mesmo assim`); await saida(false); }
    else {
      log(`fila: ${j.pendentes} pendente(s), ${j.travados} travado(s), ${j.prontos} pronto(s), ${j.entregando} entregando`);
      await saida((j.pendentes | 0) + (j.travados | 0) + (j.prontos | 0) + (j.entregando | 0) === 0);
    }
  } catch (e) { log("fila: consulta falhou —", String(e && e.message || e).slice(0, 120), "— seguindo mesmo assim"); await saida(false); }
}

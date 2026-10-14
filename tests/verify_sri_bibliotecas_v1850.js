// v18.50 — versão exata e impressão digital (SRI) das bibliotecas externas.
// Abre o index.html DE VERDADE (com integrity) e as três páginas num Chromium real, servindo as
// bibliotecas a partir de robo/libs_locais (bytes iguais aos dos CDNs, conferidos em 14/10/2026),
// SEM rede, e prova:
//   S1  cada integrity (HTML do app, CDN_SRI do app, páginas) é o sha384 do arquivo local certo
//       e nenhuma biblioteca usa versão "solta" (como o antigo supabase-js@2);
//   S2  com os bytes certos, as quatro bibliotecas carregam (supabase, Chart, jsPDF e docx) e
//       o console não acusa integrity;
//   S3  com UM byte a mais (CDN adulterado), o navegador bloqueia o supabase-js e o Chart.js, e
//       a exportação recusa o jsPDF e o docx (loadScriptOnce falha, como numa queda do CDN);
//   S4  os mapas de bibliotecas do robô (operario.mjs e teste_local.mjs) usam exatamente as
//       mesmas URLs do app, e cada arquivo local bate com o integrity da sua URL;
//   S5  as três páginas (/, /professor/, /aluno/) carregam o supabase-js com o integrity;
//   S6  a cópia sem integrity (tests/sem_sri.js, para os testes com supabase-js falso) só difere
//       do index.html nos atributos e nas impressões digitais.
//
// Uso: node tests/verify_sri_bibliotecas_v1850.js
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto');
const { semSri, semSriNaPasta } = require('./sem_sri');

const RAIZ = path.resolve(__dirname, '..');
const LIBS = path.join(RAIZ, 'robo', 'libs_locais');
const INDEX = path.join(RAIZ, 'index.html');
const html = fs.readFileSync(INDEX, 'utf8');
const sha384 = (buf) => 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');

const resultados = [];
const chk = (ok, msg) => { resultados.push([!!ok, msg]); };

// ---------------------------------------------------------------- S1 e S4 (estático)
const tags = [...html.matchAll(/<script src="(https:[^"]+)"([^>]*)><\/script>/g)].map(m => ({ url: m[1], resto: m[2] }));
const integrityDe = (resto) => (resto.match(/integrity="([^"]+)"/) || [])[1];
const cdnUrls = {
  jspdf: (html.match(/jspdf:\s*"([^"]+)"/) || [])[1],
  docx: (html.match(/docx:\s*"([^"]+)"/) || [])[1],
};
const cdnSri = {
  jspdf: (html.match(/\[CDN_URLS\.jspdf\]:\s*"([^"]+)"/) || [])[1],
  docx: (html.match(/\[CDN_URLS\.docx\]:\s*"([^"]+)"/) || [])[1],
};
const ARQUIVO_DA_URL = (u) => /supabase-js/.test(u) ? 'supabase.js' : /Chart\.js/.test(u) ? 'chart.umd.js' : /jspdf/.test(u) ? 'jspdf.umd.min.js' : /docx@/.test(u) ? 'docx.umd.js' : null;
const esperado = {};   // url → integrity
for (const t of tags) esperado[t.url] = integrityDe(t.resto);
esperado[cdnUrls.jspdf] = cdnSri.jspdf;
esperado[cdnUrls.docx] = cdnSri.docx;

const urls = Object.keys(esperado);
chk(urls.length === 4 && tags.length === 2 && tags.every(t => / crossorigin="anonymous"/.test(t.resto)),
  `S1a o app pede 4 bibliotecas externas, as 2 do <head> com integrity e crossorigin (achadas: ${urls.length})`);
chk(urls.every(u => /@\d+\.\d+\.\d+\/|\/\d+\.\d+\.\d+\//.test(u)) && !/supabase-js@2\//.test(html),
  'S1b todas com versão exata (nada de "@2" solto)');
chk(urls.every(u => esperado[u] && esperado[u] === sha384(fs.readFileSync(path.join(LIBS, ARQUIVO_DA_URL(u))))),
  'S1c cada integrity é o sha384 do arquivo local da mesma biblioteca');
chk(/if\(CDN_SRI\[url\]\)\{ s\.integrity = CDN_SRI\[url\]; s\.crossOrigin = "anonymous"; \}/.test(html),
  'S1d loadScriptOnce aplica o integrity e o crossorigin no jsPDF e no docx');
const paginas = ['pagina/index.html', 'pagina/professor/index.html', 'pagina/aluno/index.html'];
const supabaseTag = tags.find(t => /supabase-js/.test(t.url));
chk(paginas.every(p => fs.readFileSync(path.join(RAIZ, p), 'utf8').includes(`<script src="${supabaseTag.url}"${supabaseTag.resto}></script>`)),
  'S1e as três páginas usam a mesma tag do supabase-js do app (versão e integrity)');

async function mapaDoRobo(arquivo, nome) {
  const s = fs.readFileSync(path.join(RAIZ, 'robo', arquivo), 'utf8');
  const bloco = s.match(new RegExp(nome + ' = \\{([\\s\\S]*?)\\};'))[1];
  return Object.fromEntries([...bloco.matchAll(/"(https:[^"]+)":\s*"([^"]+)"/g)].map(m => [m[1], m[2]]));
}

// ---------------------------------------------------------------- S2, S3, S5 (navegador)
(async () => {
  for (const [arquivo, nome] of [['operario.mjs', 'LIBS_CDN'], ['teste_local.mjs', 'LIB_URLS']]) {
    const mapa = await mapaDoRobo(arquivo, nome);
    const ok = Object.keys(mapa).length === 4 && urls.every(u => mapa[u]) &&
      urls.every(u => sha384(fs.readFileSync(path.join(LIBS, mapa[u]))) === esperado[u]);
    chk(ok, `S4 robo/${arquivo}: as mesmas 4 URLs do app e cada cópia local passa no integrity`);
  }

  const browser = await chromium.launch();
  async function abrir(adulterar) {
    const ctx = await browser.newContext();
    const avisos = [];
    await ctx.route('**/*', (r) => {
      const u = r.request().url();
      if (u.startsWith('file://') || u.startsWith('http://127.0.0.1')) return r.continue();
      const arq = esperado[u] !== undefined ? ARQUIVO_DA_URL(u) : null;
      if (arq) {
        let corpo = fs.readFileSync(path.join(LIBS, arq));
        if (adulterar && adulterar.test(u)) corpo = Buffer.concat([corpo, Buffer.from('\n')]);
        return r.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: corpo });
      }
      if (/supabase\.co\//.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
      return r.fulfill({ status: 404, body: '' });
    });
    const p = await ctx.newPage();
    p.on('console', (m) => { if (/integrity/i.test(m.text())) avisos.push(m.text()); });
    return { ctx, p, avisos };
  }
  const exportar = (p) => p.evaluate(async () => {
    const r = {};
    for (const k of ['jspdf', 'docx']) {
      try { await loadScriptOnce(CDN_URLS[k]); r[k] = !!window[k]; } catch (e) { r[k] = 'recusado'; }
    }
    return r;
  });

  // S2: bytes certos
  {
    const { ctx, p, avisos } = await abrir(null);
    await p.goto('file://' + INDEX); await p.waitForTimeout(1500);
    const base = await p.evaluate(() => ({ supabase: typeof window.supabase?.createClient === 'function', chart: typeof window.Chart === 'function' }));
    const exp = await exportar(p);
    chk(base.supabase && base.chart, `S2a com os bytes certos, supabase-js e Chart.js carregam (${JSON.stringify(base)})`);
    chk(exp.jspdf === true && exp.docx === true, `S2b a exportação carrega jsPDF e docx com integrity (${JSON.stringify(exp)})`);
    chk(avisos.length === 0, `S2c nenhum aviso de integrity no console (${avisos.length})`);
    await ctx.close();
  }
  // S3: um byte a mais em cada biblioteca
  {
    const { ctx, p, avisos } = await abrir(/./);
    await p.goto('file://' + INDEX); await p.waitForTimeout(1500);
    const base = await p.evaluate(() => ({ supabase: typeof window.supabase, chart: typeof window.Chart }));
    const exp = await exportar(p);
    chk(base.supabase === 'undefined' && base.chart === 'undefined', `S3a arquivo adulterado: o navegador bloqueia supabase-js e Chart.js (${JSON.stringify(base)})`);
    chk(exp.jspdf === 'recusado' && exp.docx === 'recusado', `S3b arquivo adulterado: jsPDF e docx são recusados (${JSON.stringify(exp)})`);
    chk(avisos.length >= 4, `S3c o console acusa o integrity das 4 bibliotecas (${avisos.length} avisos)`);
    await ctx.close();
  }
  // S5: as páginas, servidas como no Netlify
  {
    const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-sri-'));
    fs.cpSync(path.join(RAIZ, 'pagina'), DIST, { recursive: true, dereference: true });
    const servidor = http.createServer((req, res) => {
      let f = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (f.endsWith('/')) f += 'index.html';
      f = path.join(DIST, f);
      if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    const BASE = 'http://127.0.0.1:' + servidor.address().port;
    const res = {};
    for (const caminho of ['/', '/professor/', '/aluno/']) {
      const { ctx, p, avisos } = await abrir(null);
      await p.goto(BASE + caminho); await p.waitForTimeout(800);
      res[caminho] = (await p.evaluate(() => typeof window.supabase?.createClient === 'function')) && avisos.length === 0;
      await ctx.close();
    }
    servidor.close();
    chk(Object.values(res).every(Boolean), `S5 as três páginas carregam o supabase-js com integrity (${JSON.stringify(res)})`);
    // S6: a cópia sem integrity
    const copia = semSri(html);
    const DIST2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-sem-sri-'));
    fs.cpSync(path.join(RAIZ, 'pagina'), DIST2, { recursive: true, dereference: true });
    semSriNaPasta(DIST2);
    chk(!/integrity=|sha384-/.test(copia) && copia.length < html.length &&
        copia === html.replace(/ integrity="sha384-[^"]+" crossorigin="anonymous"/g, '').replace(/"sha384-[^"]+"/g, '""') &&
        !/integrity=/.test(fs.readFileSync(path.join(DIST2, 'index.html'), 'utf8')),
      'S6 a cópia para os testes com supabase-js falso só perde os atributos e as impressões digitais');
  }
  await browser.close();

  for (const [ok, msg] of resultados) console.log((ok ? 'PASS ' : 'FAIL ') + msg);
  const falhas = resultados.filter(r => !r[0]).length;
  console.log(`\n${resultados.length - falhas} verificações passaram, ${falhas} falharam`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

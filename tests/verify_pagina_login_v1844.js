// v18.44 — página inicial e app no mesmo endereço: login e cadastro na página inicial.
// v18.45 — a raiz virou a tela de escolha (Aluno ou Professor), com o mesmo Entrar e Cadastrar.
// Monta, numa pasta temporária, o mesmo que o netlify.toml publica (pagina/ na raiz e o
// index.html do app em /app/), serve em localhost e percorre o fluxo com um supabase-js
// falso (sessão no localStorage, como o real). SEM rede.
//
// Uso: node tests/verify_pagina_login_v1844.js
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

const RAIZ = path.resolve(__dirname, '..');
const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
fs.cpSync(path.join(RAIZ, 'pagina'), DIST, { recursive: true });
fs.mkdirSync(path.join(DIST, 'app'));
fs.copyFileSync(path.join(RAIZ, 'index.html'), path.join(DIST, 'app', 'index.html'));

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const servidor = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TIPOS[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

const STUB = `(function(){
  const K = 'fake-sb-session';
  const ler = () => { try { return JSON.parse(localStorage.getItem(K)); } catch(e){ return null; } };
  const gravar = s => { if (s) localStorage.setItem(K, JSON.stringify(s)); else localStorage.removeItem(K); };
  window.__log = window.__log || [];
  window.supabase = { createClient(){
    const ouvintes = []; const emite = (ev, s) => ouvintes.forEach(f => f(ev, s));
    if (/access_token=/.test(location.hash)) { gravar({ access_token: 'tok-g', user: { id: 'u1', email: 'prof@gmail.com' } }); history.replaceState(null, '', location.pathname + location.search); }
    return {
      auth: {
        onAuthStateChange(f){ ouvintes.push(f); setTimeout(() => f('INITIAL_SESSION', ler()), 0); return { data: { subscription: { unsubscribe(){} } } }; },
        async getSession(){ await new Promise(r => setTimeout(r, 20)); return { data: { session: ler() } }; },
        async signInWithPassword({ email, password }){ if (password !== 'certa') return { error: new Error('Invalid login credentials') }; const s = { access_token: 't', user: { id: 'u1', email } }; gravar(s); emite('SIGNED_IN', s); return { data: { session: s }, error: null }; },
        async signUp({ email, options }){ window.__log.push(['signup', email, options && options.emailRedirectTo]); return { data: { session: null }, error: null }; },
        async signInWithOAuth({ provider, options }){ window.__log.push(['oauth', provider, options && options.redirectTo]); return { error: null }; },
        async signOut(){ gravar(null); emite('SIGNED_OUT', null); return { error: null }; },
      },
      async rpc(){ return { data: [], error: null }; },
      from(){ const q = { select(){return q;}, order(){return q;}, eq(){return q;}, insert(){return q;}, update(){return q;}, single(){return q;}, then(r){ r({ data: [], error: null }); } }; return q; },
    };
  } };
})();`;

let total = 0, falhas = 0;
const ok = (c, m, x) => { if (c) { total++; console.log('PASS ' + m); } else { falhas++; console.log('FAIL ' + m + (x === undefined ? '' : ' ' + JSON.stringify(x))); } };

(async () => {
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + servidor.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const erros = [];
  async function contexto(vp){
    const ctx = await browser.newContext({ viewport: vp || { width: 1366, height: 860 } });
    await ctx.route('**/*', rt => {
      const u = rt.request().url();
      if (u.startsWith(BASE) || u.startsWith('data:')) return rt.continue();
      if (/supabase-js/.test(u)) return rt.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
      if (rt.request().resourceType() === 'script') return rt.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return rt.fulfill({ status: 200, body: '' });
    });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => erros.push(e.message));
    return { ctx, pg };
  }
  let { ctx, pg } = await contexto();
  await pg.goto(BASE + '/'); await pg.waitForTimeout(700);
  ok(await pg.isVisible('.nav__entrar') && await pg.isVisible('.nav__cadastrar') && await pg.isHidden('.nav__app'), 'A1 deslogado: menu com Entrar e Cadastrar');
  await pg.click('.nav__cadastrar'); await pg.waitForTimeout(200);
  ok(await pg.isVisible('#formCadastro') && await pg.isHidden('#formLogin'), 'A2 Cadastrar abre a janela na aba Cadastrar');
  ok(await pg.isVisible('#authGoogle'), 'A3 a janela tem "Continuar com Google"');
  await pg.fill('#cadastroEmail', 'novo@exemplo.com'); await pg.fill('#cadastroSenha', '123456'); await pg.click('#formCadastro button[type=submit]'); await pg.waitForTimeout(200);
  ok(/Conta criada/.test(await pg.textContent('#authMsg')), 'A4 cadastro com confirmação por e-mail avisa para conferir o e-mail');
  ok((await pg.evaluate(() => window.__log)).some(l => l[0] === 'signup' && l[2] === BASE + '/'), 'A5 o link do e-mail volta para a página inicial');
  await pg.click('#formCadastro [data-aba="login"]');
  await pg.fill('#loginEmail', 'prof@exemplo.com'); await pg.fill('#loginSenha', 'errada'); await pg.click('#formLogin button[type=submit]'); await pg.waitForTimeout(200);
  ok(/incorretos/.test(await pg.textContent('#authMsg')), 'B1 senha errada: "E-mail ou senha incorretos."');
  await pg.fill('#loginSenha', 'certa');
  await Promise.all([pg.waitForURL(BASE + '/app/'), pg.click('#formLogin button[type=submit]')]); await pg.waitForTimeout(700);
  ok(await pg.isVisible('#btnSair'), 'B2 login certo leva para /app/ já logado');
  await pg.goto(BASE + '/'); await pg.waitForTimeout(500);
  ok(await pg.isVisible('.nav__app') && await pg.isHidden('.nav__entrar'), 'B3 logado: a página inicial mostra "Abrir o app"');
  await pg.goto(BASE + '/app/'); await pg.waitForTimeout(500);
  await Promise.all([pg.waitForURL(BASE + '/'), pg.click('#btnSair')]);
  ok(pg.url() === BASE + '/', 'C1 Sair no app volta para a página inicial');
  await pg.goto(BASE + '/app/'); await pg.waitForURL(BASE + '/?entrar'); await pg.waitForTimeout(400);
  ok(await pg.isVisible('#formLogin'), 'C2 /app/ sem login vai para a página inicial com a janela de login aberta');
  await pg.click('#authGoogle'); await pg.waitForTimeout(100);
  ok((await pg.evaluate(() => window.__log)).some(l => l[0] === 'oauth' && l[1] === 'google' && l[2] === BASE + '/'), 'D1 Google volta para a página inicial');
  await Promise.all([pg.waitForURL(BASE + '/app/'), pg.goto(BASE + '/#access_token=a&refresh_token=b')]); await pg.waitForTimeout(500);
  ok(await pg.isVisible('#btnSair'), 'D2 de volta do Google, a página segue para o app logado');
  await ctx.close();
  // v18.45: o menu com logo fica nas páginas do professor (/professor/) e do aluno (/aluno/); a raiz é a tela de escolha
  for (const w of [1366, 1024, 901, 390]) {
    ({ ctx, pg } = await contexto({ width: w, height: 800 }));
    for (const pag of ['/professor/', '/aluno/']) {
      await pg.goto(BASE + pag); await pg.waitForTimeout(300);
      const m = await pg.evaluate(() => ({ estouro: document.documentElement.scrollWidth - innerWidth, alt: Math.round(document.querySelector('.nav__in').getBoundingClientRect().height) }));
      ok(m.estouro === 0 && m.alt < 140, `E ${w}px ${pag}: menu numa linha, sem rolagem lateral`, m);
    }
    await ctx.close();
  }
  ok(erros.length === 0, 'F sem erros de JavaScript', erros.slice(0, 3));
  await browser.close(); servidor.close(); fs.rmSync(DIST, { recursive: true, force: true });
  console.log(`\n${total} verificações passaram, ${falhas} falharam`);
  process.exit(falhas ? 1 : 0);
})();

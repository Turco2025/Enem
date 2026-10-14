// v18.45 — três páginas no mesmo endereço: a raiz é a tela de escolha (Aluno ou Professor),
// /professor/ é a página do professor e /aluno/ a do aluno. Monta, numa pasta temporária, o mesmo
// que o netlify.toml publica (pagina/ na raiz e o app em /app/), serve em localhost e percorre:
// escolha, links entre as páginas, links antigos (/#planos), login a partir da raiz e do aluno,
// arquivos sem 404, a conta do aluno, celular e computador. supabase-js falso, SEM rede.
//
// Uso: node tests/verify_paginas_v1845.js
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

const RAIZ = path.resolve(__dirname, '..');
const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
fs.cpSync(path.join(RAIZ, 'pagina'), DIST, { recursive: true, dereference: true });
fs.mkdirSync(path.join(DIST, 'app'));
fs.copyFileSync(path.join(RAIZ, 'index.html'), path.join(DIST, 'app', 'index.html'));
require('./sem_sri').semSriNaPasta(DIST);   // v18.50: o supabase-js falso não passaria no integrity (ver tests/sem_sri.js)

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const servidor = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
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
    if (/access_token=/.test(location.hash)) { gravar({ access_token: 'tok-g', user: { id: 'u1', email: 'aluno@gmail.com' } }); history.replaceState(null, '', location.pathname + location.search); }
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
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const erros = [], faltando = new Set();
  async function contexto(vp, celular) {
    const ctx = await browser.newContext({ viewport: vp || { width: 1366, height: 860 }, ...(celular ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    await ctx.route('**/*', rt => {
      const u = rt.request().url();
      if (u.startsWith(BASE) || u.startsWith('data:')) return rt.continue();
      if (/supabase-js/.test(u)) return rt.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
      if (rt.request().resourceType() === 'script') return rt.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return rt.fulfill({ status: 200, body: '' });
    });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => erros.push(e.message));
    pg.on('response', r => { if (r.status() === 404 && r.url().startsWith(BASE)) faltando.add(r.url().slice(BASE.length)); });
    return { ctx, pg };
  }
  const texto = (pg, s) => pg.evaluate(q => (document.querySelector(q) || {}).textContent || '', s);

  // ---------- A. tela de escolha e links entre as páginas ----------
  let { ctx, pg } = await contexto();
  await pg.goto(BASE + '/'); await pg.waitForTimeout(500);
  const hrefs = await pg.$$eval('.opcao', as => as.map(a => a.getAttribute('href')));
  ok(hrefs.join() === '/aluno/,/professor/', 'A1 a raiz mostra as alternativas A (aluno) e B (professor)', hrefs);
  ok(await pg.isVisible('.nav__entrar') && await pg.isVisible('.nav__cadastrar') && await pg.isHidden('.nav__app'), 'A2 a tela de escolha tem Entrar e Cadastrar');
  await Promise.all([pg.waitForURL(BASE + '/aluno/'), pg.click('.opcao[href="/aluno/"]')]); await pg.waitForTimeout(600);
  ok(await pg.title() === 'Gera Enem para estudantes' && await pg.evaluate(() => document.documentElement.dataset.pagina) === 'aluno', 'A3 "Sou aluno" abre /aluno/');
  await Promise.all([pg.waitForURL(BASE + '/professor/'), pg.click('.nav__troca')]); await pg.waitForTimeout(600);
  ok(await pg.title() === 'Gera Enem para professores', 'A4 "Sou professor" no menu do aluno abre /professor/');
  await Promise.all([pg.waitForURL(BASE + '/aluno/'), pg.click('.foot__troca a')]); await pg.waitForTimeout(400);
  ok(pg.url() === BASE + '/aluno/', 'A5 "Veja a página para estudantes" no rodapé do professor abre /aluno/');
  await pg.goto(BASE + '/'); await pg.waitForTimeout(300);
  await Promise.all([pg.waitForURL(BASE + '/professor/'), pg.click('.opcao[href="/professor/"]')]);
  ok(true, 'A6 "Sou professor" na tela de escolha abre /professor/');
  await pg.goto(BASE + '/#planos'); await pg.waitForURL(BASE + '/professor/#planos'); await pg.waitForTimeout(800);
  ok(await pg.evaluate(() => { const r = document.querySelector('#planos').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), 'A7 link antigo /#planos abre os Planos do professor');
  // as duas páginas têm o mesmo conteúdo do site, com os textos de cada público
  await pg.goto(BASE + '/professor/'); await pg.waitForTimeout(400);
  const prof = { k: await texto(pg, '.band--4 .kicker--q span'), conta: await texto(pg, '#hMes'), cartao: await pg.$$eval('#sheetnav span', s => s.map(x => x.textContent)[7]) };
  ok(prof.k === 'Para professores' && prof.conta === '37' && prof.cartao === 'Professor e aluno', 'A8 professor: textos, conta e cartão-resposta como antes', prof);
  await pg.goto(BASE + '/aluno/'); await pg.waitForTimeout(400);
  const alu = { k: await texto(pg, '.band--4 .kicker--q span'), conta: [await texto(pg, '#hMes'), await texto(pg, '#hAno'), await texto(pg, '#hTempo')].join(' | '), cartao: await pg.$$eval('#sheetnav span', s => s.map(x => x.textContent)[7]) };
  ok(alu.k === 'Para estudantes' && alu.conta === '480 | 2,7 provas | 24 horas' && alu.cartao === 'Do seu jeito', 'A9 aluno: textos, conta do treino e cartão-resposta próprios', alu);
  await ctx.close();

  // ---------- B. login na tela de escolha (o Google e o e-mail voltam para a raiz) ----------
  ({ ctx, pg } = await contexto());
  await pg.goto(BASE + '/'); await pg.waitForTimeout(400);
  await pg.click('.nav__cadastrar'); await pg.waitForTimeout(200);
  ok(await pg.isVisible('#formCadastro') && await pg.isVisible('#authGoogle'), 'B1 Cadastrar abre a janela com Google e e-mail');
  await pg.fill('#cadastroEmail', 'novo@exemplo.com'); await pg.fill('#cadastroSenha', '123456'); await pg.click('#formCadastro button[type=submit]'); await pg.waitForTimeout(200);
  ok((await pg.evaluate(() => window.__log)).some(l => l[0] === 'signup' && l[2] === BASE + '/'), 'B2 o link do e-mail de confirmação volta para a raiz');
  await pg.click('#formCadastro [data-aba="login"]');
  await pg.fill('#loginEmail', 'aluno@exemplo.com'); await pg.fill('#loginSenha', 'certa');
  await Promise.all([pg.waitForURL(BASE + '/app/'), pg.click('#formLogin button[type=submit]')]); await pg.waitForTimeout(700);
  ok(await pg.isVisible('#btnSair'), 'B3 login na tela de escolha leva para /app/');
  await pg.goto(BASE + '/'); await pg.waitForTimeout(400);
  ok(await pg.isVisible('.nav__app') && await pg.isHidden('.nav__entrar'), 'B4 logado: a tela de escolha mostra "Abrir o app"');
  await pg.goto(BASE + '/app/'); await pg.waitForTimeout(500);
  await Promise.all([pg.waitForURL(BASE + '/'), pg.click('#btnSair')]);
  ok(await pg.isVisible('.opcao'), 'B5 "Sair" no app volta para a tela de escolha');
  await pg.goto(BASE + '/app/'); await pg.waitForURL(BASE + '/?entrar'); await pg.waitForTimeout(400);
  ok(await pg.isVisible('#formLogin'), 'B6 /app/ sem login abre a tela de escolha com a janela de login');
  await pg.click('#authGoogle'); await pg.waitForTimeout(100);
  ok((await pg.evaluate(() => window.__log)).some(l => l[0] === 'oauth' && l[2] === BASE + '/'), 'B7 Google pede para voltar à raiz');
  await Promise.all([pg.waitForURL(BASE + '/app/'), pg.goto(BASE + '/#access_token=a&refresh_token=b')]); await pg.waitForTimeout(500);
  ok(await pg.isVisible('#btnSair'), 'B8 de volta do Google na raiz, segue para o app logado');
  await ctx.close();

  // ---------- C. login a partir da página do aluno ----------
  ({ ctx, pg } = await contexto());
  await pg.goto(BASE + '/aluno/'); await pg.waitForTimeout(400);
  await pg.click('.nav__entrar'); await pg.waitForTimeout(200);
  await pg.click('#authGoogle'); await pg.waitForTimeout(100);
  ok((await pg.evaluate(() => window.__log)).some(l => l[0] === 'oauth' && l[2] === BASE + '/'), 'C1 Google na página do aluno também volta à raiz');
  await pg.fill('#loginEmail', 'aluno@exemplo.com'); await pg.fill('#loginSenha', 'certa');
  await Promise.all([pg.waitForURL(BASE + '/app/'), pg.click('#formLogin button[type=submit]')]);
  ok(true, 'C2 login na página do aluno leva para /app/');
  await ctx.close();

  // ---------- D. tamanhos de tela, arquivos e erros ----------
  for (const [w, h, cel] of [[1440, 900], [1366, 768], [1024, 768], [390, 844, true]]) {
    ({ ctx, pg } = await contexto({ width: w, height: h }, cel));
    for (const pag of ['/', '/aluno/', '/professor/']) {
      await pg.goto(BASE + pag); await pg.waitForTimeout(pag === '/' ? 300 : 1200);
      const m = await pg.evaluate(() => ({ estouro: document.documentElement.scrollWidth - innerWidth, cartoes: (() => { const o = document.querySelector('.opcoes'); return o ? Math.round(o.getBoundingClientRect().bottom) : 0; })() }));
      ok(m.estouro === 0, `D ${w}px ${pag}: sem rolagem lateral`, m);
      if (pag === '/' && !cel) ok(m.cartoes <= h, `D ${w}x${h} /: as duas alternativas cabem na primeira tela`, m);
    }
    await ctx.close();
  }
  ok(faltando.size === 0, 'E nenhum arquivo faltando (404) nas três páginas', [...faltando].slice(0, 5));
  ok(erros.length === 0, 'F sem erros de JavaScript', erros.slice(0, 3));
  await browser.close(); servidor.close(); fs.rmSync(DIST, { recursive: true, force: true });
  console.log(`\n${total} verificações passaram, ${falhas} falharam`);
  process.exit(falhas ? 1 : 0);
})();

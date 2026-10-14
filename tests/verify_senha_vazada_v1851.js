// v18.51 — proteção contra senhas vazadas (Supabase Auth, plano Pro).
// Com a proteção ligada, o Supabase recusa no cadastro uma senha que já apareceu em vazamentos
// (HaveIBeenPwned) com o erro weak_password, motivo "pwned". Este teste usa o supabase-js DE
// VERDADE (robo/libs_locais, com o integrity) e simula só as respostas do Supabase Auth, SEM rede:
//   V1  cadastro com senha vazada: a página mostra a mensagem em português (antes saía em inglês);
//   V2  quem já tem conta com senha vazada continua entrando (o Supabase só avisa) e vai para /app/;
//   V3  o app traduz o mesmo erro (e os motivos "fraca" e "curta") e não mexe nas outras mensagens;
//   V4  sem erros de JavaScript.
//
// Uso: node tests/verify_senha_vazada_v1851.js
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

const RAIZ = path.resolve(__dirname, '..');
const LIBS = path.join(RAIZ, 'robo', 'libs_locais');
const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-senha-'));
fs.cpSync(path.join(RAIZ, 'pagina'), DIST, { recursive: true, dereference: true });
fs.mkdirSync(path.join(DIST, 'app'));
fs.copyFileSync(path.join(RAIZ, 'index.html'), path.join(DIST, 'app', 'index.html'));
const servidor = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

const resultados = [];
const chk = (ok, msg) => resultados.push([!!ok, msg]);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const agora = () => Math.floor(Date.now() / 1000);
const USER = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'prof@exemplo.local', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const token = () => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, aud: 'authenticated', role: 'authenticated', exp: agora() + 3600 })}.x`;
const MSG_EN = 'Password is known to be weak and easy to guess, please choose a different one.';

(async () => {
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + servidor.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const erros = [];
  await ctx.route('**/*', async (r) => {
    const u = r.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:')) return r.continue();
    const lib = /supabase-js/.test(u) ? 'supabase.js' : /Chart\.js/.test(u) ? 'chart.umd.js' : /jspdf/.test(u) ? 'jspdf.umd.min.js' : /docx@/.test(u) ? 'docx.umd.js' : null;
    if (lib) return r.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(LIBS, lib)) });
    if (/supabase\.co\//.test(u)) {
      const cab = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cab });
      const json = (status, o) => r.fulfill({ status, contentType: 'application/json', headers: cab, body: JSON.stringify(o) });
      const p = new URL(u).pathname;
      // o mesmo formato de erro do Supabase Auth com a proteção ligada
      if (p === '/auth/v1/signup') return json(422, { code: 422, error_code: 'weak_password', msg: MSG_EN, weak_password: { reasons: ['pwned'] } });
      // login de quem já tem conta com senha vazada: entra, com o aviso weak_password
      if (p === '/auth/v1/token') return json(200, { access_token: token(), refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: agora() + 3600, user: USER, weak_password: { reasons: ['pwned'] } });
      if (p === '/auth/v1/user') return json(200, USER);
      if (p.startsWith('/rest/v1/')) return json(200, []);
      return json(200, {});
    }
    return r.fulfill({ status: 404, body: '' });
  });

  // V1: cadastro com senha vazada
  const p = await ctx.newPage();
  p.on('pageerror', e => erros.push(e.message));
  await p.goto(BASE + '/?cadastrar'); await p.waitForTimeout(800);
  await p.fill('#cadastroEmail', 'novo@exemplo.local');
  await p.fill('#cadastroSenha', 'senha123');
  await p.click('#formCadastro button[type="submit"]');
  await p.waitForTimeout(800);
  const msg1 = await p.textContent('#authMsg');
  chk(/vazamentos de dados/.test(msg1) && !/weak|guess/i.test(msg1), `V1 cadastro com senha vazada: mensagem em português ("${msg1}")`);

  // V2: login de quem já tem conta com senha vazada
  await p.click('#abaLogin');
  await p.fill('#loginEmail', 'prof@exemplo.local');
  await p.fill('#loginSenha', 'senha123');
  await Promise.all([p.waitForURL(/\/app\/$/, { timeout: 10000 }).catch(() => {}), p.click('#formLogin button[type="submit"]')]);
  await p.waitForTimeout(1500);
  chk(new URL(p.url()).pathname === '/app/', `V2 quem já tem conta com senha vazada continua entrando (foi para ${new URL(p.url()).pathname})`);

  // V3: a tradução do app (a mesma classe de erro do supabase-js)
  const t = await p.evaluate(() => {
    const E = window.supabase.AuthWeakPasswordError;
    return {
      pwned: traduzErroAuth(new E('Password is known to be weak and easy to guess, please choose a different one.', 422, ['pwned'])),
      fraca: traduzErroAuth(new E('Password should contain at least one character of each: abc', 422, ['characters'])),
      curta: traduzErroAuth(new E('Password should be at least 6 characters.', 422, ['length'])),
      credenciais: traduzErroAuth(new Error('Invalid login credentials')),
      outra: traduzErroAuth(new Error('Algo inesperado')),
    };
  });
  chk(/vazamentos de dados/.test(t.pwned) && /senha é fraca/.test(t.fraca) && t.curta === 'A senha precisa ter pelo menos 6 caracteres.' &&
      t.credenciais === 'E-mail ou senha incorretos.' && t.outra === 'Algo inesperado', 'V3 o app traduz senha vazada, fraca e curta, e as outras mensagens não mudam ' + JSON.stringify(t));
  chk(erros.length === 0, 'V4 sem erros de JavaScript' + (erros.length ? ': ' + erros.slice(0, 2).join(' | ') : ''));

  await browser.close(); servidor.close();
  for (const [ok, m] of resultados) console.log((ok ? 'PASS ' : 'FAIL ') + m);
  const falhas = resultados.filter(r => !r[0]).length;
  console.log(`\n${resultados.length - falhas} verificações passaram, ${falhas} falharam`);
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

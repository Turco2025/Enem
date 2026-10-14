// v18.52 — o nome da disciplina no cabeçalho do cartão da questão passa por escapeHtml.
// A disciplina pode vir de um simulado salvo (abrirSimuladoSalvo). Só a própria conta grava os seus
// simulados, então não havia como atingir outra pessoa; é um reforço.
// Abre o index.html num Chromium real (bibliotecas de robo/libs_locais, com o integrity), SEM rede:
//   D1  disciplina com marcação: nenhum script roda e o texto aparece como texto no cabeçalho;
//   D2  disciplina comum: o cabeçalho continua igual ("Biologia");
//   D3  controle: na versão anterior (8802cdc), a mesma marcação vira código (o teste enxerga a diferença).
//
// Uso: node tests/verify_disciplina_cartao_v1852.js
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const LIBS = path.join(RAIZ, 'robo', 'libs_locais');
const QUESTAO = JSON.parse(fs.readFileSync(path.join(RAIZ, 'tests', 'fixtures', 'wa_operario', 'questoes_exemplo.json'), 'utf8')).sem_imagem.data;
const MALICIOSA = 'Biologia<img src=x onerror="window.__xss=(window.__xss||0)+1">';
const resultados = [];
const chk = (ok, msg) => resultados.push([!!ok, msg]);

async function cabecalho(browser, index, disciplina) {
  const ctx = await browser.newContext();
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith('file://') || u.startsWith('data:')) return r.continue();
    const lib = /supabase-js/.test(u) ? 'supabase.js' : /Chart\.js/.test(u) ? 'chart.umd.js' : /jspdf/.test(u) ? 'jspdf.umd.min.js' : /docx@/.test(u) ? 'docx.umd.js' : null;
    if (lib) return r.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(LIBS, lib)) });
    return r.fulfill({ status: 404, body: '' });
  });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(e.message));
  await p.goto('file://' + index); await p.waitForTimeout(1200);
  const r = await p.evaluate(async ({ disciplina, dados }) => {
    window.__xss = 0;
    state.area = 'natureza';
    state.disciplina = disciplina;
    const q = { id: 'q-teste', status: 'done', tema: 'Sistema urinário', dificuldade: 'Difícil', recurso: 'nenhum', data: dados };
    const el = renderQuestionCard(q, 0);
    document.body.appendChild(el);
    await new Promise((res) => setTimeout(res, 400));
    const meta = el.querySelector('.qcard-meta');
    return { xss: window.__xss, texto: meta ? meta.textContent.trim() : null, imgs: meta ? meta.querySelectorAll('img').length : -1 };
  }, { disciplina, dados: QUESTAO });
  await ctx.close();
  return { ...r, erros };
}

(async () => {
  const browser = await chromium.launch();
  const novo = await cabecalho(browser, path.join(RAIZ, 'index.html'), MALICIOSA);
  chk(novo.xss === 0 && novo.imgs === 0 && novo.texto && novo.texto.startsWith(MALICIOSA), `D1 disciplina com marcação: nada roda e aparece como texto (${JSON.stringify({ xss: novo.xss, imgs: novo.imgs })})`);
  const comum = await cabecalho(browser, path.join(RAIZ, 'index.html'), 'Biologia');
  chk(comum.texto === 'Biologia' && comum.erros.length === 0, `D2 disciplina comum: cabeçalho igual ("${comum.texto}")`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cartao-antes-'));
  fs.writeFileSync(path.join(dir, 'index.html'), execFileSync('git', ['-C', RAIZ, 'show', '8802cdc:index.html'], { maxBuffer: 64 * 1024 * 1024 }));
  const antes = await cabecalho(browser, path.join(dir, 'index.html'), MALICIOSA);
  chk(antes.xss >= 1 && antes.imgs === 1, `D3 controle: na versão anterior a marcação vira código (${JSON.stringify({ xss: antes.xss, imgs: antes.imgs })})`);
  await browser.close();
  for (const [ok, msg] of resultados) console.log((ok ? 'PASS ' : 'FAIL ') + msg);
  const falhas = resultados.filter((r) => !r[0]).length;
  console.log(`\n${resultados.length - falhas} verificações passaram, ${falhas} falharam`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

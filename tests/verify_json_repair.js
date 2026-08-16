const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

  // Build a JSON payload, then deliberately corrupt it the way a real LLM
  // sometimes does: raw (unescaped) newline inside a long string value, plus
  // a trailing comma — both invalid per strict JSON but common LLM mistakes.
  const draft = {
    area: 'natureza', disciplina: 'Física', tema: 'Força de atrito',
    dificuldade: 'Difícil',
    competencia: { numero: 5, texto: 'Competência de teste.' },
    habilidade: { codigo: 'H20', texto: 'Habilidade de teste.' },
    recurso: 'nenhum', visual: null,
    textoBase: 'Texto-suporte de teste.',
    comando: 'Com base no exposto, é correto afirmar que:',
    alternativas: { A: 'A', B: 'B', C: 'C (correta)', D: 'D', E: 'E' },
    gabarito: 'C',
    resolucaoComentada: 'LINHA_UM___LINHA_DOIS',
    analiseAlternativas: {
      A: { status: 'incorreta', comentario: 'x' },
      B: { status: 'incorreta', comentario: 'x' },
      C: { status: 'correta', comentario: 'x' },
      D: { status: 'incorreta', comentario: 'x' },
      E: { status: 'incorreta', comentario: 'x', },
    }
  };
  let jsonText = JSON.stringify(draft, null, 2);
  // Inject a raw newline inside the resolucaoComentada string value (invalid JSON).
  jsonText = jsonText.replace('LINHA_UM___LINHA_DOIS', 'LINHA_UM\nLINHA_DOIS');

  let callCount = 0;
  await page.route('**/v1/messages', async route => {
    callCount++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: jsonText }], stop_reason: 'end_turn' })
    });
  });

  const filePath = 'file://' + path.resolve('/home/claude/enem/deliverables/Gerador_Simulados_ENEM.html');
  await page.goto(filePath);

  await page.click('.area-tile[data-area="natureza"]');
  await page.waitForTimeout(200);
  await page.click('.chip:has-text("Física")');

  await page.evaluate(() => openModal('settingsModal'));
  await page.fill('#apiKeyInput', 'sk-ant-test-fake-key');
  await page.click('#btnSaveSettings');

  for (let i = 0; i < 6; i++) { await page.click('#qtyMinus'); }
  await page.waitForTimeout(100);

  await page.click('#btnGenerate');
  await page.waitForTimeout(5000);

  const results = {};
  results.totalApiCalls = callCount;
  results.hasErrorMessage = await page.evaluate(() => {
    const el = document.querySelector('.qcard');
    return el ? el.textContent.includes('Erro ao gerar') : null;
  });
  results.errorText = await page.evaluate(() => {
    const el = document.querySelector('.qcard .status-line');
    return el ? el.textContent : null;
  });
  results.resolucaoRendered = await page.evaluate(() => {
    const el = document.querySelector('.resolucao');
    return el ? el.textContent : null;
  });
  results.consoleErrors = consoleErrors;

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();

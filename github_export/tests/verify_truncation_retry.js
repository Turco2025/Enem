const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

  const fullDraft = {
    area: 'natureza', disciplina: 'Física', tema: 'Força de atrito',
    dificuldade: 'Difícil',
    competencia: { numero: 5, texto: 'Competência de teste.' },
    habilidade: { codigo: 'H20', texto: 'Habilidade de teste.' },
    recurso: 'nenhum', visual: null,
    textoBase: 'Texto-suporte de teste sobre força de atrito.',
    comando: 'Com base no exposto, é correto afirmar que:',
    alternativas: { A: 'A', B: 'B', C: 'C (correta)', D: 'D', E: 'E' },
    gabarito: 'C',
    resolucaoComentada: 'Resolução comentada completa de teste.',
    analiseAlternativas: {
      A: { status: 'incorreta', comentario: 'x' },
      B: { status: 'incorreta', comentario: 'x' },
      C: { status: 'correta', comentario: 'x' },
      D: { status: 'incorreta', comentario: 'x' },
      E: { status: 'incorreta', comentario: 'x' },
    }
  };
  const fullJsonText = JSON.stringify(fullDraft);
  // Simulate a response cut off mid-JSON (as if max_tokens was hit).
  const truncatedText = fullJsonText.slice(0, Math.floor(fullJsonText.length * 0.6));

  let callCount = 0;
  await page.route('**/v1/messages', async route => {
    callCount++;
    if (callCount === 1) {
      // First call: truncated / incomplete JSON, stop_reason max_tokens.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: [{ type: 'text', text: truncatedText }], stop_reason: 'max_tokens' })
      });
    } else {
      // Retry (and validation pass): full valid JSON.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: [{ type: 'text', text: fullJsonText }], stop_reason: 'end_turn' })
      });
    }
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
  await page.waitForTimeout(6000);

  const results = {};
  results.totalApiCalls = callCount;
  results.finalStatusIsDone = await page.evaluate(() => document.querySelector('.qcard .status-line') === null);
  results.hasErrorMessage = await page.evaluate(() => {
    const el = document.querySelector('.qcard');
    return el ? el.textContent.includes('Erro ao gerar') : null;
  });
  results.questionTitleVisible = await page.evaluate(() => {
    const h3 = document.querySelector('.qcard h3');
    return h3 ? h3.textContent : null;
  });
  results.consoleErrors = consoleErrors;

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();

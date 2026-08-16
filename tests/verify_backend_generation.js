const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

  let backendCalls = 0;
  let capturedBody = null;
  let anthropicDirectCalls = 0;

  // The app must NEVER call api.anthropic.com directly from the browser anymore.
  await page.route('**/v1/messages', async route => {
    anthropicDirectCalls++;
    await route.abort();
  });

  await page.route('**/functions/v1/generate-question', async route => {
    backendCalls++;
    capturedBody = route.request().postDataJSON();
    const draft = {
      area: 'natureza', disciplina: 'Física', tema: 'Óptica', dificuldade: 'Médio',
      competencia: { numero: 6, texto: 'Competência de teste.' },
      habilidade: { codigo: 'H21', texto: 'Habilidade de teste.' },
      recurso: 'nenhum', visual: null,
      textoBase: 'Texto-suporte de teste.',
      comando: 'Considerando o texto, é correto afirmar que:',
      alternativas: { A: 'Alt A', B: 'Alt B', C: 'Alt C (correta)', D: 'Alt D', E: 'Alt E' },
      gabarito: 'C',
      resolucaoComentada: 'Resolução de teste.',
      analiseAlternativas: {
        A: { status: 'incorreta', comentario: 'Erro tipo leitura parcial.' },
        B: { status: 'incorreta', comentario: 'Erro tipo senso comum.' },
        C: { status: 'correta', comentario: 'Correta pois...' },
        D: { status: 'incorreta', comentario: 'Erro de inversão de causa/efeito.' },
        E: { status: 'incorreta', comentario: 'Erro de excesso de escopo.' },
      }
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ question: draft }) });
  });

  const filePath = 'file://' + path.resolve('/home/claude/enem/deliverables/Gerador_Simulados_ENEM.html');
  await page.goto(filePath);

  const results = {};

  // 1) The API-key settings button should stay hidden, and Generate should NOT
  //    require a key or open the settings modal at all.
  results.btnSettingsVisible = await page.isVisible('#btnSettings').catch(() => false);

  await page.click('.area-tile[data-area="natureza"]');
  await page.waitForTimeout(150);
  await page.click('.chip:has-text("Física")');
  for (let i = 0; i < 4; i++) { await page.click('#qtyMinus'); }
  await page.waitForTimeout(100);

  await page.click('#btnGenerate');
  await page.waitForSelector('.qcard', { timeout: 15000 });
  await page.waitForTimeout(1000);

  results.settingsModalOpenedAfterGenerate = await page.isVisible('#settingsModal .modal-box').catch(() => false);
  results.backendCalls = backendCalls;
  results.anthropicDirectCalls = anthropicDirectCalls;
  results.capturedBodyFields = capturedBody ? Object.keys(capturedBody).sort() : null;
  results.capturedBody = capturedBody;

  const status = await page.evaluate(() => state.questions[0] && state.questions[0].status);
  results.questionStatus = status;
  results.questionTitleVisible = await page.locator('.qcard').first().innerText().then(t => t.includes('Óptica'));

  results.consoleErrors = consoleErrors;
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();

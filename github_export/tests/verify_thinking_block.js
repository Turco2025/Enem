const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

  const draft = {
    area: 'natureza', disciplina: 'Física', tema: 'Atrito',
    dificuldade: 'Médio',
    competencia: { numero: 5, texto: 'x' },
    habilidade: { codigo: 'H20', texto: 'x' },
    recurso: 'nenhum', visual: null,
    textoBase: 'Texto de teste.',
    comando: 'x?',
    alternativas: { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E' },
    gabarito: 'C',
    resolucaoComentada: 'x',
    analiseAlternativas: {
      A: { status: 'incorreta', comentario: 'x' }, B: { status: 'incorreta', comentario: 'x' },
      C: { status: 'correta', comentario: 'x' }, D: { status: 'incorreta', comentario: 'x' },
      E: { status: 'incorreta', comentario: 'x' },
    }
  };

  // Simulate a response where content[0] is a "thinking" block, and the real
  // text is content[1] — exactly what newer models with adaptive thinking do.
  let requestBodies = [];
  await page.route('**/v1/messages', async route => {
    try{ requestBodies.push(JSON.parse(route.request().postData())); }catch(e){}
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        content: [
          { type: 'thinking', thinking: 'Deixa eu pensar sobre isso...' },
          { type: 'text', text: JSON.stringify(draft) }
        ],
        stop_reason: 'end_turn'
      })
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
  await page.waitForTimeout(4000);

  const results = {};
  results.hasErrorMessage = await page.evaluate(() => {
    const el = document.querySelector('.qcard');
    return el ? el.textContent.includes('Erro ao gerar') : null;
  });
  results.questionTitleVisible = await page.evaluate(() => {
    const h3 = document.querySelector('.qcard h3');
    return h3 ? h3.textContent : null;
  });
  results.requestIncludesThinkingDisabled = requestBodies.length > 0 && requestBodies.every(b => b.thinking && b.thinking.type === 'disabled');
  results.totalRequests = requestBodies.length;
  results.consoleErrors = consoleErrors;

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();

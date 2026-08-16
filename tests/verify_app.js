const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

  // Mock the backend Edge Function (generate-question) so we can exercise the full
  // generation pipeline without a real network call — the app no longer talks to the
  // Anthropic API directly from the browser at all.
  let callCount = 0;
  await page.route('**/functions/v1/generate-question', async route => {
    callCount++;
    const draft = {
      area: 'natureza', disciplina: 'Biologia', tema: 'Sistema circulatório',
      dificuldade: 'Médio',
      competencia: { numero: 3, texto: 'Competência de área de teste.' },
      habilidade: { codigo: 'H12', texto: 'Habilidade de teste.' },
      recurso: 'nenhum', visual: null,
      textoBase: 'Texto-suporte de teste sobre o sistema circulatório humano, com dados fictícios para fins de verificação automatizada.',
      comando: 'Considerando o texto, é correto afirmar que:',
      alternativas: { A: 'Alternativa A', B: 'Alternativa B', C: 'Alternativa C (correta)', D: 'Alternativa D', E: 'Alternativa E' },
      gabarito: 'C',
      resolucaoComentada: 'Resolução comentada de teste.',
      analiseAlternativas: {
        A: { status: 'incorreta', comentario: 'Erro tipo leitura parcial.' },
        B: { status: 'incorreta', comentario: 'Erro tipo senso comum.' },
        C: { status: 'correta', comentario: 'Correta pois...' },
        D: { status: 'incorreta', comentario: 'Erro de inversão de causa/efeito.' },
        E: { status: 'incorreta', comentario: 'Erro de excesso de escopo.' },
      }
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ question: draft })
    });
  });

  const filePath = 'file://' + path.resolve('/home/claude/enem/deliverables/Gerador_Simulados_ENEM.html');
  await page.goto(filePath);

  // Select área -> disciplina
  await page.click('.area-tile[data-area="natureza"]');
  await page.waitForTimeout(200);
  await page.click('.chip:has-text("Biologia")');

  // set qty to 1 for a fast single-question run (no API key setup needed anymore —
  // the app never asks for one now)
  for (let i = 0; i < 6; i++) { await page.click('#qtyMinus'); }
  await page.waitForTimeout(100);

  await page.click('#btnGenerate');
  await page.waitForSelector('.qcard', { timeout: 15000 });
  await page.waitForTimeout(1500);

  const results = {};
  results.apiCalls = callCount;
  results.consoleErrors = consoleErrors;

  // Default view mode should be "professor"
  results.defaultBodyClass = await page.evaluate(() => document.body.className);
  results.viewProfessorActive = await page.evaluate(() => document.getElementById('viewProfessor').classList.contains('active'));

  // Competência / Habilidade should be visible (not display:none) by default
  const pedagogVisible = await page.evaluate(() => {
    const items = document.querySelectorAll('.pedagog-item .lab');
    let compTxt = '', habTxt = '';
    document.querySelectorAll('.pedagog-item').forEach(item => {
      const lab = item.querySelector('.lab');
      const val = item.querySelector('.val');
      if (lab && lab.textContent.trim() === 'Competência') compTxt = val ? val.textContent : '';
      if (lab && lab.textContent.trim() === 'Habilidade') habTxt = val ? val.textContent : '';
    });
    const pedagogEl = document.querySelector('.pedagog');
    const style = pedagogEl ? getComputedStyle(pedagogEl) : null;
    return { compTxt, habTxt, display: style ? style.display : 'NO_EL' };
  });
  results.pedagogVisible = pedagogVisible;

  // Buttons exist
  results.hasBtnPrint = await page.evaluate(() => !!document.getElementById('btnPrint'));
  results.hasBtnExport = await page.evaluate(() => !!document.getElementById('btnExport'));

  // Trigger export and capture the download
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#btnExport'),
  ]);
  const downloadPath = await download.path();
  const fs = require('fs');
  const exportedContent = downloadPath ? fs.readFileSync(downloadPath, 'utf-8') : null;
  results.exportSuggestedFilename = download.suggestedFilename();
  results.exportFileSize = exportedContent ? exportedContent.length : 0;
  results.exportContainsCompetencia = exportedContent ? exportedContent.includes('Competência') : false;
  results.exportContainsHabilidade = exportedContent ? exportedContent.includes('Habilidade') : false;

  // Click print and just confirm no exception is thrown (mocked print won't open real dialog in headless anyway)
  let printError = null;
  page.on('dialog', d => d.dismiss());
  try {
    await page.evaluate(() => { window.print = () => { window.__printCalled = true; }; });
    await page.click('#btnPrint');
    results.printCalled = await page.evaluate(() => window.__printCalled === true);
  } catch (e) { printError = e.message; }
  results.printError = printError;

  console.log(JSON.stringify(results, null, 2));

  await browser.close();
})();

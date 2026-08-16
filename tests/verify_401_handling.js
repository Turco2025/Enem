const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

  // Simulate a 401 with an EMPTY body — the exact scenario that used to produce
  // the confusing "não foi possível interpretar como JSON" message.
  await page.route('**/v1/messages', async route => {
    await route.fulfill({ status: 401, contentType: 'application/json', body: '' });
  });

  const filePath = 'file://' + path.resolve('/home/claude/enem/deliverables/Gerador_Simulados_ENEM.html');
  await page.goto(filePath);

  await page.click('.area-tile[data-area="natureza"]');
  await page.waitForTimeout(200);
  await page.click('.chip:has-text("Física")');

  await page.evaluate(() => openModal('settingsModal'));
  await page.fill('#apiKeyInput', 'sk-ant-invalid-key');
  await page.click('#btnSaveSettings');

  for (let i = 0; i < 6; i++) { await page.click('#qtyMinus'); }
  await page.waitForTimeout(100);

  await page.click('#btnGenerate');
  await page.waitForTimeout(3000);

  const results = {};
  results.errorText = await page.evaluate(() => {
    const el = document.querySelector('.qcard .status-line');
    return el ? el.textContent : null;
  });
  results.mentions401 = results.errorText ? results.errorText.includes('401') : false;
  results.noLongerConfusingJsonMsg = results.errorText ? !results.errorText.includes('não foi possível interpretar') : null;
  results.consoleErrors = consoleErrors;

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();

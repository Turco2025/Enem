const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const filePath = 'file://' + path.resolve('/home/claude/enem/deliverables/Gerador_Simulados_ENEM.html');
  const results = {};

  // --- Case 1: normal localStorage available — key should persist across reload ---
  {
    const page = await browser.newPage();
    await page.goto(filePath);
    await page.evaluate(() => openModal('settingsModal'));
    await page.fill('#apiKeyInput', 'sk-ant-persisted-key-123');
    await page.click('#btnSaveSettings');
    await page.waitForTimeout(200);

    await page.reload();
    await page.waitForTimeout(300);
    results.keyPrefilledAfterReload = await page.evaluate(() => document.getElementById('apiKeyInput').value);
    results.stateApiKeyAfterReload = await page.evaluate(() => typeof state !== 'undefined' ? state.apiKey : null);

    // Forget key
    await page.evaluate(() => openModal('settingsModal'));
    await page.click('#btnForgetKey');
    await page.waitForTimeout(200);
    await page.reload();
    await page.waitForTimeout(300);
    results.keyEmptyAfterForget = await page.evaluate(() => document.getElementById('apiKeyInput').value);
    await page.close();
  }

  // --- Case 2: localStorage throws (simulates a restricted preview/artifact sandbox) ---
  {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

    await page.addInitScript(() => {
      const throwFn = () => { throw new DOMException('blocked', 'SecurityError'); };
      Object.defineProperty(window, 'localStorage', {
        get() { throwFn(); }
      });
    });
    await page.goto(filePath);
    await page.evaluate(() => openModal('settingsModal'));
    await page.fill('#apiKeyInput', 'sk-ant-should-not-crash');
    await page.click('#btnSaveSettings');
    await page.waitForTimeout(300);

    results.noCrashWithBlockedStorage = await page.evaluate(() => typeof state !== 'undefined' && state.apiKey === 'sk-ant-should-not-crash');
    results.toastShownWithBlockedStorage = await page.evaluate(() => !!document.querySelector('.toast'));
    results.consoleErrorsWithBlockedStorage = consoleErrors.filter(e => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
    await page.close();
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();

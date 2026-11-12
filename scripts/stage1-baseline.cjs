const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.resolve(__dirname, '../packages/frontend/package.json'));
const { chromium } = req('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000']
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  const consoleLogs = [];
  const networkFailures = [];

  page.on('console', msg => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });

  page.on('pageerror', err => {
    consoleLogs.push({ type: 'pageerror', text: err.message });
  });

  page.on('requestfailed', req => {
    networkFailures.push({ url: req.url(), failure: req.failure()?.errorText });
  });

  console.log('Navigating to http://localhost:3000 ...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });

  const title = await page.title();
  console.log('Page Title:', title);

  const screenshotPath1 = path.resolve('test-artifacts/screenshots/01-initial-wizard.png');
  const screenshotPath2 = path.resolve('docs/screenshots/01-initial-wizard.png');
  await page.screenshot({ path: screenshotPath1, fullPage: true });
  fs.copyFileSync(screenshotPath1, screenshotPath2);
  console.log('Screenshot saved to:', screenshotPath1);

  console.log('--- Console Logs Summary ---');
  console.log('Total console events:', consoleLogs.length);
  const errors = consoleLogs.filter(l => l.type === 'error' || l.type === 'pageerror');
  console.log('Console errors:', errors.length);
  errors.forEach(e => console.log('  [' + e.type + '] ' + e.text));

  const warnings = consoleLogs.filter(l => l.type === 'warning');
  console.log('Console warnings:', warnings.length);
  warnings.slice(0, 5).forEach(w => console.log('  [warning] ' + w.text));

  console.log('--- Network Failures Summary ---');
  console.log('Failed requests count:', networkFailures.length);
  networkFailures.forEach(nf => console.log('  [FAILED] ' + nf.url + ': ' + nf.failure));

  const bodyText = await page.textContent('body');
  console.log('Page body contains "Setup Wizard":', bodyText.includes('Setup Wizard'));
  console.log('Page body contains "Plot & Road":', bodyText.includes('Plot & Road'));

  // Collect visible buttons on initial page
  const buttons = await page.$$eval('button', els => els.map(e => ({
    text: (e.textContent || '').trim().replace(/\s+/g, ' '),
    disabled: e.disabled
  })));
  console.log('Found buttons on initial page:', buttons.length);
  buttons.forEach((b, idx) => console.log(`  Button ${idx + 1}: "${b.text}" (disabled: ${b.disabled})`));

  await browser.close();
  console.log('Stage 1 verification script finished successfully.');
})().catch(err => {
  console.error('Fatal in Stage 1 verification:', err);
  process.exit(1);
});

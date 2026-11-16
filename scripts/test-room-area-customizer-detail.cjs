const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.resolve(__dirname, '../packages/frontend/package.json'));
const { chromium } = req('playwright');
const fs = require('fs');

const screenshotDir = path.resolve('docs/screenshots/uat/journeys');

(async () => {
  console.log('--- Inspecting Room Area Customizer in Sidebar ---');
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1050']
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1050 }
  });
  const page = await context.newPage();

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Switch to 02 CAD Studio
  await page.locator('button:has-text("02 • 2D CAD Studio")').click();
  await page.waitForTimeout(600);

  // Click Master Bedroom
  const bedBtn = page.locator('div[aria-label="Room refinement selection"] button:has-text("Master Bedroom")').first();
  await bedBtn.click();
  await page.waitForTimeout(400);

  // Scroll sidebar down
  await page.evaluate(() => {
    const aside = document.querySelector('aside');
    if (aside) aside.scrollTop = aside.scrollHeight;
  });
  await page.waitForTimeout(400);

  await page.screenshot({ path: path.join(screenshotDir, '15-room-area-customizer-scrolled.png') });
  console.log('Saved 15-room-area-customizer-scrolled.png');

  // Let's also test typing 18 in the desired area input and clicking regenerate!
  const areaInput = page.locator('input[type="number"][placeholder*="e.g."]').first();
  console.log('Area input found:', await areaInput.isVisible());
  if (await areaInput.isVisible()) {
    await areaInput.fill('18.00');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(screenshotDir, '16-room-area-input-18sqm.png') });
    console.log('Saved 16-room-area-input-18sqm.png');

    const regenBtn = page.locator('button:has-text("Regenerate Selected Room")').first();
    console.log('Regenerate button visible:', await regenBtn.isVisible());
    if (await regenBtn.isVisible()) {
      await regenBtn.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(screenshotDir, '17-room-area-regenerated-alternatives.png') });
      console.log('Saved 17-room-area-regenerated-alternatives.png');
    }
  }

  await browser.close();
  console.log('Done!');
})().catch(err => {
  console.error(err);
  process.exit(1);
});

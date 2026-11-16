const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.resolve(__dirname, '../packages/frontend/package.json'));
const { chromium } = req('playwright');
const fs = require('fs');

const screenshotDir = path.resolve('docs/screenshots/uat/journeys');

(async () => {
  console.log('--- Testing Room Selection via Refinement Panel Picker ---');
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1050']
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1050 },
    acceptDownloads: true
  });
  const page = await context.newPage();

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Switch to 02 CAD Studio
  await page.locator('button:has-text("02 • 2D CAD Studio")').click();
  await page.waitForTimeout(800);

  // Click Master Bedroom button in room picker
  console.log('Clicking Master Bedroom button in RefinementPanel...');
  const bedBtn = page.locator('div[aria-label="Room refinement selection"] button:has-text("Master Bedroom")').first();
  if (await bedBtn.isVisible()) {
    await bedBtn.click();
    await page.waitForTimeout(600);
    console.log('Clicked Master Bedroom button!');
  } else {
    console.log('Master Bedroom button not found, clicking any room button in picker...');
    const anyRoom = page.locator('div[aria-label="Room refinement selection"] button').first();
    await anyRoom.click();
    await page.waitForTimeout(600);
  }

  // Check if Desired Area is now visible
  const desiredArea = page.locator('text="Desired Area"').first();
  const visible = await desiredArea.isVisible().catch(() => false);
  console.log('Desired Area / RoomAreaCustomizerPanel visible:', visible);

  await page.screenshot({ path: path.join(screenshotDir, '14-room-area-customizer-active.png') });
  console.log('Saved 14-room-area-customizer-active.png');

  await browser.close();
  console.log('Done!');
})().catch(err => {
  console.error(err);
  process.exit(1);
});


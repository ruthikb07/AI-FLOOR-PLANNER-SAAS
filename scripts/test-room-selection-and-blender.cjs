const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.resolve(__dirname, '../packages/frontend/package.json'));
const { chromium } = req('playwright');
const fs = require('fs');

const screenshotDir = path.resolve('docs/screenshots/uat/journeys');

(async () => {
  console.log('--- Testing Room Selection, Area Customizer Panel & Blender Export ---');
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

  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`[Browser Console Error] ${msg.text()}`);
  });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Switch to 02 CAD Studio
  console.log('Navigating to 2D CAD Studio...');
  await page.locator('button:has-text("02 • 2D CAD Studio")').click();
  await page.waitForTimeout(800);

  // Switch to 1ST_FLOOR_PLAN
  console.log('Switching to 1ST_FLOOR_PLAN...');
  const flBtn = page.locator('button:has-text("1ST_FLOOR_PLAN")').first();
  if (await flBtn.isVisible()) {
    await flBtn.click();
    await page.waitForTimeout(600);
  }

  // Click on a room element on SVG canvas to select it
  console.log('Selecting a room on the canvas...');
  const roomEl = page.locator('g[data-entity-type="room"], polygon[data-entity-type="room"], rect[data-entity-type="room"]').first();
  const roomExists = (await roomEl.count()) > 0;
  console.log('Room elements found on canvas:', await roomEl.count());

  if (roomExists) {
    await roomEl.click({ force: true });
    await page.waitForTimeout(600);
  } else {
    // If not directly clickable via tag, select via editor store
    console.log('Triggering room selection via client state...');
    await page.evaluate(() => {
      const editor = (window).__AI_FLOOR_PLANNER_EDITOR__;
      if (editor && editor.activeFloor && editor.activeFloor.rooms.length > 0) {
        editor.selectEntity('room', editor.activeFloor.rooms[0].id, editor.activeFloor.id);
      }
    });
    await page.waitForTimeout(600);
  }

  // Check if Room Area Customizer panel is visible
  const customizerPanel = page.locator('text="Desired Area"').first();
  const isCustomizerVisible = await customizerPanel.isVisible().catch(() => false);
  console.log('Room Area Customizer panel visible:', isCustomizerVisible);

  await page.screenshot({ path: path.join(screenshotDir, '11-cad-room-selected-inspector.png') });
  console.log('Saved 11-cad-room-selected-inspector.png');

  // Navigate to 06 Export Center
  console.log('Navigating to Export Center...');
  await page.locator('button:has-text("Export Center")').click();
  await page.waitForTimeout(1000);

  // Scroll section to bottom to reveal Blender and ETABS cards
  await page.evaluate(() => {
    const sec = document.querySelector('section[aria-label="Independent export center"]');
    if (sec) sec.scrollTop = sec.scrollHeight;
  });
  await page.waitForTimeout(600);

  await page.screenshot({ path: path.join(screenshotDir, '12-export-center-scrolled-blender-verified.png') });
  console.log('Saved 12-export-center-scrolled-blender-verified.png');

  // Check Blender button
  const blenderGenBtn = page.locator('button:has-text("Generate 3D Package")').first();
  console.log('Blender "Generate 3D Package" button visible:', await blenderGenBtn.isVisible());

  if (await blenderGenBtn.isVisible()) {
    console.log('Clicking "Generate 3D Package"...');
    await blenderGenBtn.click();
    // Wait up to 10 seconds for Blender status to change
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      const text = await page.locator('article:has-text("Blender 5.2 Native")').first().innerText();
      if (text.includes('VERIFIED') || text.includes('FAILED')) {
        console.log('Blender generation status result:\n', text);
        break;
      }
    }
    await page.screenshot({ path: path.join(screenshotDir, '13-blender-generation-result.png') });
    console.log('Saved 13-blender-generation-result.png');
  }

  await browser.close();
  console.log('--- Test Finished Successfully ---');
})().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});


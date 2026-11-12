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

  page.on('console', msg => console.log(`[Browser ${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.log(`[Browser PageError] ${err.message}`));

  console.log('Step 1: Navigating to http://localhost:3000 ...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  // Clear any existing localStorage wizard state to start fresh
  await page.evaluate(() => {
    localStorage.removeItem('argon_studio_store_wizard_v1');
    localStorage.removeItem('ai_floor_planner_active_project');
  });
  await page.reload({ waitUntil: 'networkidle' });

  console.log('Step 2: Configuring Stage 1 Plot and Road (18m x 25m) ...');
  // Fill Project Title
  const titleInput = page.locator('input[placeholder*="ARGON Heights"]').or(page.locator('input').first());
  await titleInput.fill('ARGON 18x25 Residential');

  // Fill Width = 18, Depth = 25
  const widthInput = page.locator('input[type="number"]').nth(0);
  await widthInput.fill('18');

  const depthInput = page.locator('input[type="number"]').nth(1);
  await depthInput.fill('25');

  // Setbacks: let's adjust setbacks if needed so buildable fits
  // Front = 3.0, Rear = 1.5, Side = 1.5
  const numberInputs = await page.locator('input[type="number"]').all();
  console.log(`Found ${numberInputs.length} number inputs on Stage 1.`);
  for (let i = 0; i < numberInputs.length; i++) {
    const val = await numberInputs[i].inputValue();
    console.log(`  Input ${i}: val=${val}`);
  }

  // Setback inputs on Stage 1 are frontSetbackM, rearSetbackM, sideSetbackM
  // Let's check inputs 3, 4, 5
  if (numberInputs.length >= 6) {
    // input 0: width (18), input 1: depth (25), input 2: roadWidth (12)
    // input 3: frontSetback, input 4: rearSetback, input 5: sideSetback
    await numberInputs[3].fill('3.0');
    await numberInputs[4].fill('1.5');
    await numberInputs[5].fill('1.5');
  }

  await page.screenshot({ path: path.resolve('test-artifacts/screenshots/02-stage1-filled.png') });

  // Click "Continue to Step 02"
  console.log('Clicking Continue to Step 02 ...');
  const continueBtn = page.locator('button:has-text("Continue to Step 02")');
  await continueBtn.click();
  await page.waitForTimeout(600);

  console.log('Step 3: Configuring Stage 2 (3 floors + Stilt) ...');
  // Number of Floors = 3
  const floorCountInput = page.locator('input[type="number"]').first();
  await floorCountInput.fill('3');

  // Verify Stilt parking checkbox is checked
  const stiltCheckbox = page.locator('input[type="checkbox"]').first();
  const isStiltChecked = await stiltCheckbox.isChecked();
  console.log('Stilt parking checked:', isStiltChecked);
  if (!isStiltChecked) {
    await stiltCheckbox.check();
  }

  await page.screenshot({ path: path.resolve('test-artifacts/screenshots/03-stage2-filled.png') });

  console.log('Clicking Continue to Step 03 ...');
  const step3Btn = page.locator('button:has-text("Continue to Step 03")');
  await step3Btn.click();
  await page.waitForTimeout(600);

  console.log('Step 4: Configuring Stage 3 (2 flats per floor, 2x 2BHK) ...');
  // Click 2 Flats per floor button
  const twoFlatsBtn = page.locator('button:has-text("2 Flats")');
  if (await twoFlatsBtn.count() > 0) {
    await twoFlatsBtn.click();
    console.log('Selected 2 Flats per floor');
  }

  // Adjust BHK mix: 2x 2BHK
  // In useStudioStore: default is 2BHK: 2, 3BHK: 2. With 2 flats per floor, total must be 2!
  // Let's find inputs for 2BHK count and 3BHK count
  const allInputs = await page.locator('input[type="number"]').all();
  console.log(`Found ${allInputs.length} number inputs on Stage 3.`);

  // Let's inspect buttons/inputs for BHK mix
  const bhkButtons = await page.$$eval('button', btns => btns.map(b => b.textContent.trim()));
  console.log('Buttons on Stage 3:', bhkButtons.filter(b => b.includes('BHK') || b.includes('+') || b.includes('-')));

  await page.screenshot({ path: path.resolve('test-artifacts/screenshots/04-stage3-filled.png') });

  console.log('Clicking Continue to Step 04 ...');
  const step4Btn = page.locator('button:has-text("Continue to Step 04")');
  await step4Btn.click();
  await page.waitForTimeout(600);

  console.log('Step 5: Stage 4 AI Intent ...');
  await page.screenshot({ path: path.resolve('test-artifacts/screenshots/05-stage4-filled.png') });

  // Find Generate button
  const genBtn = page.locator('button:has-text("Generate Multi-Story Building")').or(page.locator('button:has-text("Generate")'));
  console.log('Generate button visible:', await genBtn.isVisible());
  console.log('Generate button disabled:', await genBtn.isDisabled());

  if (await genBtn.isDisabled()) {
    console.log('Generate button is disabled! Checking validation message...');
    const body = await page.textContent('body');
    console.log('Page snippet:', body.slice(0, 500));
  } else {
    console.log('Triggering generation!');
    await genBtn.click();

    // Wait for generation modal
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.resolve('test-artifacts/screenshots/06-generating-modal.png') });

    // Wait for generation completion or error up to 60s
    console.log('Waiting for generation to finish ...');
    let finished = false;
    for (let sec = 0; sec < 60; sec++) {
      await page.waitForTimeout(1000);
      const isGenerating = await page.evaluate(() => {
        const modal = document.querySelector('.animate-fadeIn');
        return document.body.textContent.includes('Generating') || document.body.textContent.includes('Solving');
      });
      const errorMsg = await page.evaluate(() => {
        const el = document.querySelector('[role="alert"], .text-red-500, .bg-red-50');
        return el ? el.textContent : null;
      });
      if (errorMsg) {
        console.log(`Generation failed with message: ${errorMsg}`);
        finished = true;
        break;
      }
      const inCadStudio = await page.evaluate(() => {
        return document.body.textContent.includes('2D CAD') || document.body.textContent.includes('SHEET 1') || document.body.textContent.includes('Stilt');
      });
      if (!isGenerating && inCadStudio) {
        console.log(`Generation succeeded! Reached 2D CAD Studio at sec ${sec}`);
        finished = true;
        break;
      }
    }

    await page.screenshot({ path: path.resolve('test-artifacts/screenshots/07-after-generation.png') });
  }

  await browser.close();
  console.log('Stage 3 test script complete.');
})().catch(err => {
  console.error('Fatal in Stage 3 script:', err);
  process.exit(1);
});


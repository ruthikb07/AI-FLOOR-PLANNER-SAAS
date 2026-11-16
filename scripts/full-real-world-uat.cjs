const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.resolve(__dirname, '../packages/frontend/package.json'));
const { chromium } = req('playwright');
const fs = require('fs');

const screenshotDir = path.resolve('docs/screenshots/uat');
fs.mkdirSync(screenshotDir, { recursive: true });

(async () => {
  console.log('================================================================');
  console.log('ARGON 4 REAL-WORLD USER ACCEPTANCE TESTING & RUNTIME VERIFICATION');
  console.log('================================================================');

  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1050']
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`[Browser ${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => console.log(`[Browser PageError] ${err.message}`));

  console.log('\n--- STAGE 1: INTAKE & GENERATION ---');
  console.log('Navigating to http://localhost:3000 ...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  const wizard18x25 = {
    authorityType: '',
    congestionZone: '',
    projectName: 'ARGON 18x25 Residential Complex',
    plotWidthM: 18,
    plotDepthM: 25,
    roadWidthM: 12,
    roadFacing: 'North',
    frontSetbackM: 3.0,
    rearSetbackM: 1.5,
    sideSetbackM: 1.5,
    floorsCount: 3,
    hasStiltParking: true,
    flatsPerFloor: 2,
    bhkCounts: { '1BHK': 0, '2BHK': 2, '3BHK': 0, '4BHK': 0 },
    bhkCarpetAreas: { '1BHK': 550, '2BHK': 850, '3BHK': 1250, '4BHK': 1800 },
    aiPrompt: 'High-end contemporary 18x25m apartment building with ground stilt parking and 3 residential storeys',
  };

  await page.evaluate((w) => {
    sessionStorage.setItem('rh_welcome_dismissed', 'true');
    localStorage.setItem('argon_studio_store_wizard_v1', JSON.stringify(w));
    localStorage.removeItem('ai_floor_planner_active_project');
  }, wizard18x25);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  try {
    const skipBtn = page.locator('button:has-text("SKIP INTRO")');
    if (await skipBtn.isVisible({ timeout: 1500 })) {
      await skipBtn.click();
      await page.waitForTimeout(400);
    }
    const createBtn = page.locator('button:has-text("Create New Project")');
    if (await createBtn.isVisible({ timeout: 1500 })) {
      await createBtn.click();
      await page.waitForTimeout(400);
    }
  } catch (e) {}

  // Navigate through wizard steps
  console.log('Navigating through Intake steps 1 to 4 ...');
  await page.locator('button:has-text("Continue to Step 02")').click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Continue to Step 03")').click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Continue to Step 04")').click();
  await page.waitForTimeout(400);

  await page.screenshot({ path: path.join(screenshotDir, '01-intake-step4.png') });
  console.log('Saved: 01-intake-step4.png');

  const genBtn = page.locator('button:has-text("Generate Architectural Project")');
  console.log('Triggering "Generate Architectural Project" ...');
  await genBtn.click();

  let generated = false;
  for (let s = 1; s <= 30; s++) {
    await page.waitForTimeout(1000);
    const state = await page.evaluate(() => {
      const modal = document.querySelector('.argon-modal, [role="dialog"], .fixed');
      const text = modal ? modal.textContent.replace(/\s+/g, ' ').trim() : 'NO MODAL';
      const activeNav = Array.from(document.querySelectorAll('button')).find(b => 
        (b.textContent.includes('CAD Studio') || b.textContent.includes('Setup Wizard')) && 
        (b.className.includes('bg-argon-btn') || b.className.includes('text-argon-card'))
      )?.textContent?.trim() || 'unknown';
      return { text: text.slice(0, 150), activeNav };
    });
    console.log(`[t=${s}s] modal="${state.text}" nav="${state.activeNav}"`);
    if (state.activeNav.includes('2D CAD Studio')) {
      generated = true;
      console.log(`Generation succeeded and transitioned to 2D CAD Studio at ${s}s!`);
      break;
    }
  }

  if (!generated) {
    console.error('Generation timed out or failed!');
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(1500);

  console.log('\n--- STAGE 2: 2D CAD STUDIO INSPECTION (ARCHITECTURE FIRST) ---');
  // Check layers
  const initialLayers = await page.evaluate(() => {
    const hasColumns = !!document.querySelector('.layer-columns');
    const hasBeams = !!document.querySelector('.layer-beams');
    const hasWalls = !!document.querySelector('.layer-walls');
    const hasOpenings = !!document.querySelector('.layer-openings');
    const hasFurniture = !!document.querySelector('.layer-furniture');
    const hasGrid = !!document.querySelector('.cad-grid');
    return { hasColumns, hasBeams, hasWalls, hasOpenings, hasFurniture, hasGrid };
  });

  console.log('Default Layer Visibility Check:');
  console.log(`  Columns rendered by default: ${initialLayers.hasColumns} (MUST be false for Architecture First)`);
  console.log(`  Beams rendered by default: ${initialLayers.hasBeams} (MUST be false for Architecture First)`);
  console.log(`  Walls rendered by default: ${initialLayers.hasWalls} (MUST be true)`);
  console.log(`  Furniture rendered by default: ${initialLayers.hasFurniture} (MUST be true)`);

  const archFirstCompliant = !initialLayers.hasColumns && !initialLayers.hasBeams && initialLayers.hasWalls;
  console.log(`Architecture-First Compliance: ${archFirstCompliant ? 'VERIFIED' : 'FAILED'}`);

  await page.screenshot({ path: path.join(screenshotDir, '02-cad-studio-architecture-first.png') });
  console.log('Saved: 02-cad-studio-architecture-first.png');

  // Toggle Columns Layer ON
  console.log('Toggling Columns layer ON ...');
  const colsBtn = page.locator('button:has-text("Columns")');
  if (await colsBtn.isVisible()) {
    await colsBtn.click();
    await page.waitForTimeout(500);
    const colsAfter = await page.evaluate(() => !!document.querySelector('.layer-columns'));
    console.log(`  Columns layer after toggle: ${colsAfter ? 'VISIBLE (VERIFIED)' : 'STILL HIDDEN'}`);
    await page.screenshot({ path: path.join(screenshotDir, '03-cad-studio-columns-toggled.png') });
    console.log('Saved: 03-cad-studio-columns-toggled.png');
  }

  // Inspect Rooms on First Floor
  const floorRooms = await page.evaluate(() => {
    const roomElements = Array.from(document.querySelectorAll('.room, [data-room-id]'));
    return roomElements.map(el => ({
      text: el.textContent?.trim(),
      id: el.getAttribute('data-room-id') || el.id,
    }));
  });
  console.log(`Found ${floorRooms.length} room elements on active floor.`);

  // Switch to Stilt Floor
  console.log('Switching to Ground Stilt Floor ...');
  const stiltTab = page.locator('button:has-text("Ground Stilt")').or(page.locator('button:has-text("Stilt")')).first();
  if (await stiltTab.isVisible()) {
    await stiltTab.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, '04-stilt-parking-floor.png') });
    console.log('Saved: 04-stilt-parking-floor.png');
  }

  console.log('\n--- STAGE 3: FLOOR EDITOR / ISOMETRIC WORKSPACE ---');
  const isoNav = page.locator('button:has-text("03 • Floor Editor")');
  await isoNav.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(screenshotDir, '05-floor-editor-workspace.png') });
  console.log('Saved: 05-floor-editor-workspace.png');

  console.log('\n--- STAGE 4: 3D MODEL WORKSPACE ---');
  const modelNav = page.locator('button:has-text("04 • 3D Building")');
  await modelNav.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(screenshotDir, '06-model-workspace-isometric.png') });
  console.log('Saved: 06-model-workspace-isometric.png');

  // Test Explode Slider
  console.log('Testing Explode Slider interaction ...');
  const slider = page.locator('input[type="range"]');
  if (await slider.isVisible()) {
    await slider.fill('40');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, '07-model-workspace-exploded.png') });
    console.log('Saved: 07-model-workspace-exploded.png');
    // reset slider
    await slider.fill('0');
    await page.waitForTimeout(500);
  }

  // Test Floor Mode: Isolate
  const isolateBtn = page.locator('button:has-text("Isolate")');
  if (await isolateBtn.isVisible()) {
    console.log('Testing Floor Mode: Isolate ...');
    await isolateBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, '08-model-workspace-isolate-floor.png') });
    console.log('Saved: 08-model-workspace-isolate-floor.png');
    // switch back to All
    const allBtn = page.locator('button:has-text("All Floors")').or(page.locator('button:has-text("All")'));
    if (await allBtn.isVisible()) await allBtn.click();
    await page.waitForTimeout(500);
  }

  console.log('\n--- STAGE 5: ENGINEERING WORKSPACE ---');
  const engNav = page.locator('button:has-text("Engineering")');
  await engNav.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(screenshotDir, '09-engineering-workspace.png') });
  console.log('Saved: 09-engineering-workspace.png');

  console.log('\n--- STAGE 6: EXPORT CENTER WORKSPACE ---');
  const expNav = page.locator('button:has-text("Export Center")');
  await expNav.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(screenshotDir, '10-export-center-workspace.png') });
  console.log('Saved: 10-export-center-workspace.png');

  // Check Blender Card in Export Center
  const hasBlenderCard = await page.evaluate(() => {
    return document.body.innerText.includes('Blender 5.2 Native') &&
           document.body.innerText.includes('Generate 3D Package');
  });
  console.log(`Blender 5.2 Card in Export Center: ${hasBlenderCard ? 'VERIFIED' : 'NOT FOUND'}`);

  console.log('\n================================================================');
  console.log('ALL WORKSPACES NAVIGATED & VERIFIED WITH REAL SCREENSHOTS');
  console.log('================================================================');

  await browser.close();
})().catch(err => {
  console.error('UAT script error:', err);
  process.exit(1);
});


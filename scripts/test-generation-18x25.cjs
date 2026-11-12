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

  console.log('Navigating to http://localhost:3000 ...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  const wizard18x25 = {
    authorityType: '',
    congestionZone: '',
    projectName: 'ARGON 18x25 Residential',
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
    bhkCounts: {
      '1BHK': 0,
      '2BHK': 2,
      '3BHK': 0,
      '4BHK': 0,
    },
    bhkCarpetAreas: {
      '1BHK': 550,
      '2BHK': 850,
      '3BHK': 1250,
      '4BHK': 1800,
    },
    aiPrompt: 'Modern 18x25m apartment with stilt parking and 3 residential floors',
  };

  await page.evaluate((w) => {
    localStorage.setItem('argon_studio_store_wizard_v1', JSON.stringify(w));
    localStorage.removeItem('ai_floor_planner_active_project');
  }, wizard18x25);

  console.log('Reloading with 18x25 configuration ...');
  await page.reload({ waitUntil: 'networkidle' });

  // Navigate step-by-step through Continue buttons
  console.log('Navigating through wizard steps ...');
  await page.waitForTimeout(600);
  await page.locator('button:has-text("Continue to Step 02")').click();
  await page.waitForTimeout(600);
  await page.locator('button:has-text("Continue to Step 03")').click();
  await page.waitForTimeout(600);
  await page.locator('button:has-text("Continue to Step 04")').click();
  await page.waitForTimeout(600);

  await page.screenshot({ path: path.resolve('test-artifacts/screenshots/stage3-step4.png') });

  const genBtn = page.locator('button:has-text("Generate Architectural Project")');
  console.log('Generate button visible:', await genBtn.isVisible());
  console.log('Generate button disabled:', await genBtn.isDisabled());

  if (await genBtn.isDisabled()) {
    console.log('Button is disabled! Checking body text:');
    console.log(await page.textContent('body'));
    await browser.close();
    process.exit(1);
  }

  console.log('Clicking Generate Architectural Project ...');
  await genBtn.click();

  // Monitor generation
  let finished = false;
  for (let s = 1; s <= 30; s++) {
    await page.waitForTimeout(1000);
    const info = await page.evaluate(() => {
      const modal = document.querySelector('.argon-modal, [role="dialog"], .fixed');
      const modalText = modal ? modal.textContent.replace(/\s+/g, ' ').trim() : 'NO MODAL';
      const activeNav = Array.from(document.querySelectorAll('button')).find(b => 
        (b.textContent.includes('CAD Studio') || b.textContent.includes('Setup Wizard')) && 
        (b.className.includes('bg-argon-btn') || b.className.includes('text-argon-card'))
      )?.textContent?.trim() || 'unknown';
      const activeProjectName = document.body.innerText.match(/ACTIVE PROJECT\s*([^\n]+)/)?.[1] || '';
      return { modalText: modalText.slice(0, 200), activeNav, activeProjectName };
    });

    console.log(`[t=${s}s] modal="${info.modalText}" nav="${info.activeNav}" project="${info.activeProjectName}"`);

    if (info.modalText.includes('failed') || info.modalText.includes('Error')) {
      console.log(`GENERATION FAILED: ${info.modalText}`);
      break;
    }
    if (info.activeNav.includes('2D CAD Studio') || info.activeProjectName.includes('18x25')) {
      console.log(`GENERATION SUCCEEDED at second ${s}!`);
      break;
    }
  }

  await page.screenshot({ path: path.resolve('test-artifacts/screenshots/stage3-after-gen.png'), fullPage: true });

  // Extract building information if in CAD studio
  const buildingSummary = await page.evaluate(() => {
    // Check if active project in localStorage
    const raw = localStorage.getItem('ai_floor_planner_active_project');
    if (!raw) return null;
    try {
      const b = JSON.parse(raw);
      return {
        id: b.id,
        name: b.name,
        floorsCount: b.floors?.length,
        floors: b.floors?.map(f => ({
          id: f.id,
          name: f.name,
          level: f.level,
          roomsCount: f.rooms?.length,
          doorsCount: f.doors?.length,
          windowsCount: f.windows?.length,
          columnsCount: f.columns?.length,
          rooms: f.rooms?.map(r => ({
            id: r.id,
            name: r.name,
            type: r.type,
            width: r.width,
            height: r.height,
            areaM2: ((r.width * r.height) / 1000000).toFixed(2)
          }))
        }))
      };
    } catch (e) {
      return { parseError: e.message };
    }
  });

  if (buildingSummary) {
    console.log('=== GENERATED BUILDING SUMMARY ===');
    console.log(`Name: ${buildingSummary.name}, Floors: ${buildingSummary.floorsCount}`);
    for (const f of buildingSummary.floors || []) {
      console.log(`\nFloor: ${f.name} (level ${f.level}) - ${f.roomsCount} rooms, ${f.doorsCount} doors, ${f.windowsCount} windows, ${f.columnsCount} columns`);
      for (const r of f.rooms || []) {
        console.log(`  Room: ${r.name} (${r.type}) -> ${r.width}x${r.height}mm = ${r.areaM2} m²`);
      }
    }
    fs.writeFileSync(
      path.resolve('test-artifacts/stage3-generated-building.json'),
      JSON.stringify(buildingSummary, null, 2)
    );
  }

  await browser.close();
  console.log('Script execution complete.');
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

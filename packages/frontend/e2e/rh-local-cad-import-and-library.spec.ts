import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const base = process.env.RH_CINEMATIC_URL ?? 'http://127.0.0.1:4177';
const chrome = process.env.RH_CINEMATIC_CHROME;
test.use({
  launchOptions: chrome
    ? { executablePath: chrome, args: ['--use-angle=d3d11'] }
    : { args: ['--enable-unsafe-swiftshader'] },
});

const SAMPLE_FLOOR_PLAN_DXF = [
  '0', 'SECTION', '2', 'HEADER',
  '9', '$INSUNITS', '70', '4',
  '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES',
  '0', 'LINE', '8', 'A-WALL', '10', '0', '20', '0', '11', '14000', '21', '0',
  '0', 'LINE', '8', 'A-WALL', '10', '14000', '20', '0', '11', '14000', '21', '10000',
  '0', 'LINE', '8', 'A-WALL', '10', '14000', '20', '10000', '11', '0', '21', '10000',
  '0', 'LINE', '8', 'A-WALL', '10', '0', '20', '10000', '11', '0', '21', '0',
  '0', 'LINE', '8', 'A-WALL', '10', '6000', '20', '0', '11', '6000', '21', '10000',
  '0', 'LINE', '8', 'A-WALL', '10', '10000', '20', '0', '11', '10000', '21', '10000',
  '0', 'LINE', '8', 'A-WALL', '10', '0', '20', '5000', '11', '14000', '21', '5000',
  '0', 'LINE', '8', 'A-DOOR', '10', '6000', '20', '2100', '11', '6000', '21', '3000',
  '0', 'LINE', '8', 'A-WIND', '10', '2200', '20', '0', '11', '3800', '21', '0',
  '0', 'LWPOLYLINE', '8', 'A-FURN', '90', '4', '70', '1',
  '10', '600', '20', '600', '10', '2000', '20', '600', '10', '2000', '20', '1600', '10', '600', '20', '1600',
  '0', 'TEXT', '8', 'A-TEXT', '10', '3000', '20', '7500', '40', '250', '1', 'Flat 101 Living Room',
  '0', 'TEXT', '8', 'A-TEXT', '10', '3000', '20', '2500', '40', '250', '1', 'Flat 101 Dining Hall',
  '0', 'TEXT', '8', 'A-TEXT', '10', '8000', '20', '7500', '40', '250', '1', 'Flat 101 Kitchen',
  '0', 'TEXT', '8', 'A-TEXT', '10', '8000', '20', '2500', '40', '250', '1', 'Flat 101 Master Bedroom',
  '0', 'TEXT', '8', 'A-TEXT', '10', '12000', '20', '7500', '40', '250', '1', 'Flat 101 Toilet',
  '0', 'TEXT', '8', 'A-TEXT', '10', '12000', '20', '2500', '40', '250', '1', 'Flat 101 Bedroom 02',
  '0', 'ENDSEC',
  '0', 'EOF',
  '',
].join('\n');

test('local CAD .DXF upload -> layer calibration -> 2D CAD -> 3D views -> Structural CAD -> Save -> reload from Library with 0 errors', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const dxfPath = info.outputPath('e2e-imported-plan.dxf');
  await writeFile(dxfPath, SAMPLE_FLOOR_PLAN_DXF, 'utf8');

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    sessionStorage.setItem('rh_welcome_dismissed', 'true');
  });

  await page.goto(base);

  // 1. Open Import CAD Modal from Top Bar
  await page.getByTestId('topbar-import-cad').click();
  await expect(page.getByTestId('cad-import-modal')).toBeVisible();

  // 2. Upload local .DXF file and inspect calibration preview & layers
  await page.getByTestId('cad-file-input').setInputFiles(dxfPath);
  await expect(page.getByTestId('cad-preview-svg')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('cad-preview-dimensions')).toContainText('14.00 m × 10.00 m');
  await expect(page.getByTestId('cad-layer-list')).toContainText('A-WALL');
  await expect(page.getByTestId('cad-layer-list')).toContainText('A-FURN');

  const projectName = `E2E Imported CAD ${Date.now().toString().slice(-5)}`;
  await page.getByTestId('cad-project-name').fill(projectName);
  await page.screenshot({ path: info.outputPath('cad-import-preview.png') });

  // 3. Load into Studio -> opens 2D CAD with CAD Underlay toggle
  await page.getByTestId('cad-load-into-studio').click();
  await expect(page.getByTestId('cad-import-modal')).toBeHidden({ timeout: 25_000 });
  await expect(page.getByTestId('toggle-cad-underlay')).toBeVisible();
  await page.getByTestId('toggle-cad-underlay').click();
  await expect(page.getByTestId('cad-underlay-overlay')).toBeVisible();

  // 4. Open Floor 3D, Tower 3D, and Structural CAD
  await page.getByTestId('nav-isometric').click();
  await page.getByTestId('toggle-view-3d').click();
  await expect(page.getByTestId('isometric-3d-viewport').locator('canvas')).toBeVisible({ timeout: 45_000 });

  await page.getByTestId('nav-building_3d').click();
  await expect(page.locator('.three-building-scene canvas')).toBeVisible({ timeout: 45_000 });

  await page.getByTestId('nav-structural_cad').click();
  await expect(page.getByText(/^[1-9]\d* corner-locked columns$/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^[1-9]\d* beams$/)).toBeVisible();
  await expect(page.getByText('150 mm', { exact: true })).toBeVisible();

  // 5. Save active revision to local disk library
  await page.getByTestId('topbar-save-local').click();
  await expect(page.getByTestId('local-save-toast')).toContainText('to local disk', { timeout: 15_000 });

  // 6. Open Library and reload saved project from local disk
  await page.getByTestId('nav-library').click();
  await expect(page.getByTestId('project-library-view')).toBeVisible();
  const card = page.locator('article', { hasText: projectName }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('IMPORTED CAD LAYOUT');

  // Capture projectId from card's data-testid for post-test cleanup
  const testId = await card.getAttribute('data-testid');
  const savedProjectId = testId?.replace('disk-project-card-', '');

  await card.getByRole('button', { name: /Open from Disk/i }).click();
  await expect(page.getByTestId('toggle-cad-underlay')).toBeVisible({ timeout: 15_000 });

  // Verify reloaded project renders cleanly in Tower 3D and Structural CAD
  await page.getByTestId('nav-building_3d').click();
  await expect(page.locator('.three-building-scene canvas')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('nav-structural_cad').click();
  await expect(page.getByText(/^[1-9]\d* corner-locked columns$/)).toBeVisible();
  await expect(page.getByText(/^[1-9]\d* beams$/)).toBeVisible();

  // Verify responsive desktop (1440x900) and mobile (390x844) studio header never overflows horizontally
  const desktopTopbarOverflow = await page.locator('header.rh-obsidian-topbar').evaluate(el => el.scrollWidth - el.clientWidth);
  expect(desktopTopbarOverflow).toBeLessThanOrEqual(2);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileTopbarOverflow = await page.locator('header.rh-obsidian-topbar').evaluate(el => el.scrollWidth - el.clientWidth);
  expect(mobileTopbarOverflow).toBeLessThanOrEqual(2);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Clean up test disk project
  if (savedProjectId) {
    await request.delete(`${base}/api/v1/local-projects/${encodeURIComponent(savedProjectId)}`);
  }

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

const SAMPLE_PLOT_BOUNDARY_DXF = [
  '0', 'SECTION', '2', 'HEADER',
  '9', '$INSUNITS', '70', '6',
  '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES',
  '0', 'LWPOLYLINE', '8', 'SITE-BOUNDARY', '90', '4', '70', '1',
  '10', '0', '20', '0',
  '10', '44', '20', '2',
  '10', '42', '20', '36',
  '10', '1', '20', '35',
  '0', 'ENDSEC',
  '0', 'EOF',
  '',
].join('\n');

test('a plot DXF is measured but rejected when the generated plan fails mandatory checks', async ({ page }, info) => {
  test.setTimeout(180_000);
  const dxfPath = info.outputPath('e2e-irregular-plot.dxf');
  await writeFile(dxfPath, SAMPLE_PLOT_BOUNDARY_DXF, 'utf8');

  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));


  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    sessionStorage.setItem('rh_welcome_dismissed', 'true');
  });

  await page.goto(base);
  await page.getByTestId('topbar-import-cad').click();
  await expect(page.getByTestId('cad-import-modal')).toBeVisible();

  await page.getByTestId('cad-file-input').setInputFiles(dxfPath);
  await expect(page.getByTestId('cad-preview-svg')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('cad-preview-dimensions')).toContainText('44.00 m × 36.00 m');
  await expect(page.getByTestId('cad-preview-dimensions')).toContainText('M');

  const activeId = await page.evaluate(() => localStorage.getItem('ai_floor_planner_active_id'));
  await page.getByTestId('cad-mode-plot-boundary').click();
  const response = page.waitForResponse(answer => answer.url().endsWith('/api/v1/import/cad-layout')
    && answer.request().postDataJSON()?.action === 'import_plot');
  await page.getByTestId('cad-load-into-studio').click();
  const rejected = await response;
  expect(rejected.status()).toBe(422);
  expect(await rejected.json()).toMatchObject({ error: { code: 'GENERATION_CHECKS_FAILED' } });
  const dialog = page.getByTestId('cad-import-modal');
  await expect(dialog.getByRole('alert')).toContainText('the generated design failed checks');
  expect(await page.evaluate(() => localStorage.getItem('ai_floor_planner_active_id'))).toBe(activeId);
  expect(pageErrors).toEqual([]);
});

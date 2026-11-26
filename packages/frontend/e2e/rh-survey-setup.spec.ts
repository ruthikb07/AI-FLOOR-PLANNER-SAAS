import { expect, test, type Page } from '@playwright/test';
import type { Building } from '@ai-floor-planner/core';
import { writeFile } from 'node:fs/promises';

const url = process.env.RH_CINEMATIC_URL ?? 'http://127.0.0.1:4177';
const chrome = process.env.RH_CINEMATIC_CHROME;
test.use({ launchOptions: chrome
  ? { executablePath: chrome, args: ['--use-angle=d3d11'] }
  : { args: ['--enable-unsafe-swiftshader'] } });

async function openSite(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem('rh_welcome_dismissed', 'true'));
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Rectangular site', exact: true })).toHaveAttribute('aria-pressed', 'true');
}

test('desktop survey editing, exact arcs, closure, history and generation guard', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openSite(page);
  await page.screenshot({ path: info.outputPath('setup-rectangular.png') });
  await page.getByRole('button', { name: 'Surveyed boundary' }).click();
  const outline = page.getByTestId('survey-outline');
  const exportDxf = page.getByRole('button', { name: 'Download boundary DXF' });
  await expect(outline).toHaveCount(0);
  await expect(exportDxf).toBeDisabled();
  await page.getByLabel('Starting outline').selectOption('curve');
  await expect(page.getByTestId('survey-arc')).toHaveAttribute('d', / A /);
  await page.getByLabel('Signed sweep (°)').fill('90');
  await page.getByLabel('Signed sweep (°)').press('Tab');
  await expect(page.getByTestId('survey-arc')).toBeVisible();
  await page.screenshot({ path: info.outputPath('survey-desktop-curved.png') });
  const curvedOutline = await outline.getAttribute('d');
  const downloadEvent = page.waitForEvent('download');
  await exportDxf.click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('survey-boundary.dxf');
  const exportPath = info.outputPath(download.suggestedFilename());
  await download.saveAs(exportPath);
  await page.getByLabel('Starting outline').selectOption('custom');
  await page.getByText('Import a surveyed boundary', { exact: true }).click();
  await page.getByLabel('Survey boundary DXF').setInputFiles(exportPath);
  await expect(page.getByLabel('Road-facing edge')).toHaveValue('0');
  await expect(outline).toHaveAttribute('d', curvedOutline!);

  await page.getByLabel('Starting outline').selectOption('chamfer');
  const startOutline = await outline.getAttribute('d');
  const handle = page.getByTestId('survey-vertex-2').locator('.rh-survey-hit');
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 13, { steps: 5 });
  await page.mouse.up();
  await expect(outline).not.toHaveAttribute('d', startOutline!);
  await page.getByRole('button', { name: 'Undo survey edit' }).click();
  await expect(outline).toHaveAttribute('d', startOutline!);
  await page.getByRole('button', { name: 'Redo survey edit' }).click();
  await expect(outline).not.toHaveAttribute('d', startOutline!);
  const editedOutline = await outline.getAttribute('d');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(outline).not.toHaveAttribute('d', editedOutline!);
  const zoomedOutline = await outline.getAttribute('d');
  await page.getByRole('button', { name: 'Pan drawing' }).click();
  const map = page.getByRole('group', { name: 'Survey boundary drawing' });
  const canvas = (await map.boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width / 2 + 17, canvas.y + canvas.height / 2 + 12);
  await page.mouse.up();
  await expect(outline).not.toHaveAttribute('d', zoomedOutline!);
  await page.getByRole('button', { name: 'Fit boundary' }).click();
  await expect(outline).toHaveAttribute('d', editedOutline!);

  await page.getByLabel('Survey input').selectOption('angles');
  await page.getByRole('button', { name: 'Select vertex A', exact: true }).click();
  await page.getByLabel('Interior angle A (°)').fill('89');
  await page.getByLabel('Interior angle A (°)').press('Tab');
  await expect(page.getByText(/corner angles differ/)).toBeVisible();
  await page.getByRole('button', { name: 'Undo survey edit' }).click();
  await expect(outline).toBeVisible();
  await page.getByLabel('Survey input').selectOption('bearings');
  await page.getByLabel('Length A–B (m)').fill('22');
  await page.getByLabel('Length A–B (m)').press('Tab');
  await expect(page.getByText(/Traverse closure error/)).toBeVisible();
  await expect(outline).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('survey-desktop-open-traverse.png') });
  await page.getByRole('button', { name: 'Undo survey edit' }).click();
  await expect(outline).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Surveyed boundary' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Survey input')).toHaveValue('bearings');
  await page.getByLabel('Length A–B (m)').fill('22');
  await page.getByLabel('Length A–B (m)').press('Tab');
  await page.getByRole('button', { name: 'Reference Upload', exact: true }).click();
  const generate = page.getByRole('button', { name: 'Generate Architectural Project' });
  await expect(generate).toBeDisabled();
  await expect(page.getByTestId('survey-generation-block')).toContainText('Traverse closure error');
  expect(errors).toEqual([]);
});

test('mobile surveyed DXF import, fractional input and manual drawing', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSite(page);
  await page.getByRole('button', { name: 'Surveyed boundary' }).click();
  await page.getByText('Import a surveyed boundary', { exact: true }).click();
  await page.getByLabel('DXF source units').selectOption('m');
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '90', '4', '70', '1',
    '10', '0', '20', '0', '42', '-0.5', '10', '24', '20', '0',
    '10', '22', '20', '-34', '10', '0', '20', '-40', '0', 'ENDSEC', '0', 'EOF',
  ].join('\n');
  await page.getByLabel('Survey boundary DXF').setInputFiles({ name: 'curved-survey.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) });
  await expect(page.getByText('Source · curved-survey.dxf')).toBeVisible();
  await expect(page.getByTestId('survey-arc')).toHaveCount(1);
  await page.getByLabel('Display units').selectOption('ft');
  await page.getByLabel('East A (ft)').fill('2 1/2');
  await page.getByLabel('East A (ft)').press('Tab');
  await expect(page.getByLabel('East A (ft)')).toHaveValue('2.5');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByTestId('survey-drawing').screenshot({ path: info.outputPath('survey-mobile-dxf.png') });
  await page.getByLabel('Starting outline').selectOption('custom');
  await page.getByRole('button', { name: 'Draw vertices' }).click();
  const drawing = page.getByRole('group', { name: 'Survey boundary drawing' });
  for (const position of [{ x: 90, y: 70 }, { x: 250, y: 85 }, { x: 190, y: 190 }]) {
    await drawing.click({ position });
  }
  await expect(page.getByTestId('survey-outline')).toBeVisible();
  await page.getByRole('button', { name: 'Remove vertex C' }).click();
  await expect(page.getByTestId('survey-outline')).toHaveCount(0);
});

test('rectangular setup still generates a real concept after visiting the survey editor', async ({ page }, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('argon_studio_store_wizard_v1', JSON.stringify({
      plotWidthM: 32, plotDepthM: 36, floorsCount: 2, hasStiltParking: false, roadFacing: 'South',
      authorityType: 'MUNICIPAL_CORPORATION', congestionZone: 'NON_CONGESTED',
      bhkCounts: { '1BHK': 0, '2BHK': 4, '3BHK': 0, '4BHK': 0 },
      buildingMassingShape: 'COMPACT_DOUBLE_LOADED',
    }));
  });
  await openSite(page);
  await page.getByRole('button', { name: 'Surveyed boundary' }).click();
  await page.getByLabel('Starting outline').selectOption('trapezoid');
  await page.getByRole('button', { name: 'Rectangular site', exact: true }).click();
  await page.getByRole('button', { name: 'Reference Upload', exact: true }).click();
  const request = page.waitForRequest(candidate => candidate.url().endsWith('/api/v1/projects/generate'));
  await page.getByRole('button', { name: 'Generate Architectural Project' }).click();
  expect((await request).postDataJSON().config.plotWidthMm).toBe(32_000);
  const gallery = page.getByRole('region', { name: 'Massing studies gallery' });
  await expect(gallery.getByRole('img', { name: /Plan preview/ }).first()).toBeVisible({ timeout: 100_000 });
  await page.screenshot({ path: info.outputPath('rectangular-generated-concept.png') });
  await gallery.getByRole('button', { name: 'Open in CAD' }).click();
  await page.getByTestId('nav-building_3d').click();
  const model = page.locator('.three-building-scene canvas');
  await expect(model).toHaveAttribute('data-projection', 'perspective', { timeout: 40_000 });
  await page.getByRole('button', { name: 'Orthographic' }).click();
  await expect(model).toHaveAttribute('data-projection', 'orthographic');
  await page.getByRole('button', { name: 'Section cut' }).click();
  await expect(model).toHaveAttribute('data-section', 'on');
  expect(errors).toEqual([]);
});


test('the wizard generates and saves a canonical oblique survey', async ({ page, request }, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('argon_studio_store_wizard_v1', JSON.stringify({
    plotWidthM: 39, plotDepthM: 34, floorsCount: 1, hasStiltParking: false,
    authorityType: 'MUNICIPAL_CORPORATION', congestionZone: 'NON_CONGESTED',
    flatsPerFloor: 2, bhkCounts: { '1BHK': 0, '2BHK': 2, '3BHK': 0, '4BHK': 0 },
    buildingMassingShape: 'COMPACT_DOUBLE_LOADED',
  })));
  await openSite(page);
  await page.getByRole('button', { name: 'Surveyed boundary' }).click();
  await page.getByLabel('Starting outline').selectOption('trapezoid');
  await page.getByLabel('East A (m)').fill('-0.125');
  await page.getByLabel('East A (m)').press('Tab');
  await page.getByLabel('Road-facing edge').selectOption('2');
  await page.getByRole('button', { name: 'Reference Upload', exact: true }).click();
  const reply = page.waitForResponse(response => response.url().endsWith('/api/v1/projects/generate'));
  await page.getByRole('button', { name: 'Generate Architectural Project' }).click();
  const generation = await reply;
  const sent = generation.request().postDataJSON().config.surveyBoundary;
  const payload = await generation.json() as { building: Building; error?: unknown };
  expect(generation.status(), JSON.stringify(payload.error)).toBe(200);
  expect(sent.points[0]).toEqual({ x: -125, y: 0 });
  expect(payload.building.site.plotBoundary.points).toEqual(sent.points);
  expect(payload.building.metadata.irregularPlotBoundary?.roadEdgeIndex).toBe(2);
  expect(payload.building.metadata.irregularPlotBoundary?.buildablePolygon?.points.length).toBeGreaterThanOrEqual(3);

  const gallery = page.getByRole('region', { name: 'Massing studies gallery' });
  await expect(gallery.getByRole('img', { name: /Plan preview/ }).first()).toBeVisible({ timeout: 45_000 });
  const study = gallery.getByRole('button', { name: /Study 1/ });
  await expect(study).toHaveCSS('background-color', 'rgba(10, 14, 21, 0.92)');
  const theme = page.getByTestId('studio-surface-theme-toggle');
  await theme.click();
  await expect(study).toHaveCSS('background-color', 'rgba(245, 239, 230, 0.96)');
  await expect(study).toHaveCSS('color', 'rgb(34, 29, 24)');
  await theme.click();
  await page.screenshot({ path: info.outputPath('survey-generated-plan.png') });
  await gallery.getByRole('button', { name: 'Open in CAD' }).click();
  const diskSave = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/v1/local-projects'));
  await page.getByTestId('topbar-save-local').click();
  expect((await diskSave).status()).toBe(200);
  await expect(page.getByTestId('local-save-toast')).toContainText('to local disk');
  const restored = await request.get('/api/v1/local-projects/' + payload.building.projectId);
  expect(restored.ok()).toBe(true);
  const persisted = await restored.json() as { building: Building };
  expect(persisted.building.site.plotBoundary.points).toEqual(sent.points);
  await page.reload();
  await expect(page.getByTestId('project-switcher-trigger')).toContainText(payload.building.name);
  expect(errors).toEqual([]);
});


test('the wizard refuses a carpet program larger than the entire site', async ({ page, request }, info) => {
  const start = Date.now();
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('argon_studio_store_wizard_v1', JSON.stringify({
    plotWidthM: 18, plotDepthM: 20, floorsCount: 1, hasStiltParking: false,
    flatsPerFloor: 6, bhkCounts: { '1BHK': 0, '2BHK': 0, '3BHK': 0, '4BHK': 6 },
    bhkCarpetAreas: { '4BHK': 2200 },
  })));
  await openSite(page);
  await page.getByRole('button', { name: 'Continue to Step 02' }).click();
  await page.getByRole('button', { name: 'Continue to Step 03' }).click();
  await page.getByRole('checkbox', { name: 'Require carpet targets' }).check();
  await page.getByRole('spinbutton', { name: 'Carpet area tolerance (%)' }).fill('3');
  await page.getByRole('button', { name: 'Continue to Step 04' }).click();
  const response = page.waitForResponse(candidate => candidate.url().endsWith('/api/v1/projects/generate'));
  await page.getByRole('button', { name: 'Generate Architectural Project' }).click();
  const result = await response;
  expect(result.status()).toBe(422);
  const sent = result.request().postDataJSON();
  expect(sent.config).toMatchObject({ requireAreaTargets: true, areaAcceptanceTolerancePercent: 3 });
  // Chromium can discard the response body when the wizard cancels fetch cleanup.
  const replay = await request.post('/api/v1/projects/generate', { data: sent });
  expect(replay.status()).toBe(422);
  const payload = await replay.json();
  expect(payload).not.toHaveProperty('building');
  expect(payload.error.code).toBe('CARPET_TARGETS_EXCEED_ENVELOPE');
  await expect(page.getByRole('dialog', { name: 'Generation needs attention' })).toContainText(/exceeds the entire/i);
  await expect(page.getByRole('region', { name: 'Massing studies gallery' })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
  await writeFile(info.outputPath('acceptance.json'), JSON.stringify({
    id: 9, name: 'Infeasible requirements', status: 'verified_refusal', wizardInput: 'pass',
    httpStatus: result.status(), refusal: payload.error, requestedCarpetSqFt: sent.config.units.map((unit: { targetCarpetSqFt: number }) => unit.targetCarpetSqFt),
    tolerancePercent: sent.config.areaAcceptanceTolerancePercent, publishedBuilding: false, browserErrors,
    processingMs: { total: Date.now() - start },
  }, null, 2));
});

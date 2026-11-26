import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Building, IfcExchangeManifest } from '@ai-floor-planner/core';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

test('production BIM revision, quantities, IFC4 download, reference alignment and CAD selection', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('cta-new-construction').click();
  await page.getByLabel('Project Title / Estate', { exact: false }).fill('Phase 4B BIM verification');
  for (const step of [2, 3, 4]) await page.getByRole('button', { name: 'Continue to Step 0' + step }).click();
  const generation = page.waitForResponse(res => res.url().endsWith('/api/v1/projects/generate'), { timeout: 60_000 });
  await page.getByRole('button', { name: 'Generate Architectural Project' }).click();
  const generationResponse = await generation;
  expect(generationResponse.status()).toBe(200);
  const { building } = await generationResponse.json() as { building: Building };
  const gallery = page.getByRole('region', { name: 'Massing studies gallery' });
  await expect(gallery.getByRole('heading', { name: 'Massing Studies' })).toBeVisible({ timeout: 30_000 });
  await gallery.getByRole('button', { name: 'Open in CAD' }).click();
  const start = Date.now();
  await page.getByTestId('nav-bim').click();
  const bim = page.getByRole('region', { name: 'RH Planner — BIM Studio' });
  const floor = building.floors.find(candidate => candidate.floorUse === 'RESIDENTIAL')!;
  expect(floor.windows.length).toBeGreaterThan(1);
  await bim.getByRole('combobox', { name: 'BIM storey' }).selectOption(floor.id);
  const startupMs = Date.now() - start;
  const filter = bim.getByRole('combobox', { name: 'BIM schedule' });
  await filter.selectOption('window');
  const table = bim.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(floor.windows.length + 1);
  await table.getByRole('button').first().click();
  const inspector = bim.getByRole('region', { name: 'BIM property inspector' });
  const window = floor.windows[0]!;
  await expect(inspector).toContainText(window.id);
  await expect(inspector).toContainText(window.wallId);
  await expect(inspector).toContainText(window.width + ' mm');
  await bim.getByLabel('Model query').fill('Total window area');
  await bim.getByRole('button', { name: 'Run query' }).click();
  const area = floor.windows.reduce((sum, entry) => sum + entry.width * entry.height, 0) / 1e6;
  await expect(inspector).toContainText(area.toFixed(3) + ' m² of window openings');

  const exportStart = Date.now();
  const ifcDownload = page.waitForEvent('download');
  const exportResponse = page.waitForResponse(res => res.url().endsWith('/api/v1/export/ifc'));
  await bim.getByRole('button', { name: 'Export IFC4' }).click();
  const [file, response] = await Promise.all([ifcDownload, exportResponse]);
  expect(response.status()).toBe(200);
  const returned = await response.json() as { manifest: IfcExchangeManifest };
  const posted = response.request().postDataJSON() as { building: Building; source: IfcExchangeManifest['source'] };
  expect(returned.manifest.source).toEqual(posted.source);
  expect(posted.building.id).toBe(building.id);
  const bytes = await readFile((await file.path())!);
  const exportMs = Date.now() - exportStart;
  await file.saveAs(info.outputPath('authored-model.ifc'));
  expect(bytes.subarray(0, 13).toString()).toBe('ISO-10303-21;');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(returned.manifest.artifactSha256);
  const mapped = returned.manifest.elements.find(entry => entry.canonicalId === window.id && entry.floorId === floor.id);
  expect(mapped?.hostWallId).toBe(window.wallId);
  await expect(inspector).toContainText(mapped!.externalId);

  const stale = await request.post('/api/v1/export/ifc', {
    data: { ...posted, source: { ...posted.source, revision: posted.source.revision + 1 } },
  });
  expect(stale.status()).toBe(409);

  const upload = bim.getByLabel('Import IFC reference');
  await upload.setInputFiles({ name: 'invalid.ifc', mimeType: 'application/x-step', buffer: Buffer.from('invalid data') });
  await expect(bim.getByRole('alert')).toContainText('IFC_INVALID_STEP_ENVELOPE');
  const importStart = Date.now();
  await upload.setInputFiles({ name: 'authored-reference.ifc', mimeType: 'application/x-step', buffer: bytes });
  const reference = bim.getByRole('region', { name: 'Read-only IFC references' });
  await expect(reference).toContainText(returned.manifest.artifactSha256);
  const importMs = Date.now() - importStart;
  await reference.getByRole('button', { name: 'Apply alignment' }).click();
  await expect(reference.getByRole('img', { name: 'Aligned reference floor outline' }).locator('polygon')).not.toHaveCount(1);
  await reference.getByRole('button', { name: 'Check wall clashes' }).click();
  const clashes = reference.getByRole('region', { name: 'Wall clash results' });
  await expect(clashes).toContainText('confirmed intersections');
  await expect(bim).toContainText('Canonical revision ' + posted.source.revision);

  await bim.getByRole('button', { name: 'Show 3D model' }).click();
  const canvas = page.getByTestId('bim-model').locator('canvas');
  await expect(canvas).toHaveAttribute('data-draw-calls', /^[1-9]\d*$/, { timeout: 45_000 });
  const drawCalls = await canvas.getAttribute('data-draw-calls');
  const geometries = await canvas.getAttribute('data-geometries');
  await bim.getByRole('button', { name: 'Precision CAD' }).click();
  await expect(page.getByTestId('precision-cad-workbench')).toContainText(window.id);
  await expect(canvas).toHaveCount(0);
  console.log('RH_BIM_BROWSER', { startupMs, exportMs, importMs, ifcBytes: bytes.length, drawCalls, geometries });
  expect(errors).toEqual([]);
});

test('mobile BIM schedule opens and exports CSV for a generated project', async ({ page, request }) => {
  const fixture = JSON.parse(await readFile(new URL('../../../test-artifacts/phase1-generated/four-flat-production-building.json', import.meta.url), 'utf8')) as Building;
  const id = 'phase4b-bim-mobile';
  const saved = await request.post('/api/v1/local-projects', { data: { projectId: id, name: 'Mobile BIM verification',
    building: { ...fixture, projectId: id } } });
  expect(saved.status()).toBe(200);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('cta-open-existing').click();
  await page.getByTestId('disk-project-card-' + id).getByRole('button', { name: 'Open from Disk' }).click();
  await page.getByTestId('nav-bim').click();
  const bim = page.getByRole('region', { name: 'RH Planner — BIM Studio' });
  await bim.getByRole('combobox', { name: 'BIM storey' }).selectOption(fixture.floors.find(floor => floor.floorUse === 'RESIDENTIAL')!.id);
  await bim.getByRole('combobox', { name: 'BIM schedule' }).selectOption('room');
  const download = page.waitForEvent('download');
  await bim.getByRole('button', { name: 'Download CSV' }).click();
  const csv = await readFile((await (await download).path())!, 'utf8');
  expect(csv).toContain('Kind,Canonical ID,Name,IFC class');
  expect(csv).toContain('IfcSpace');
  expect(await page.locator('body').evaluate(body => body.scrollWidth)).toBeLessThanOrEqual(392);
});

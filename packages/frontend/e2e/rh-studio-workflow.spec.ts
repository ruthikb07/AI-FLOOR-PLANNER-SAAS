import { expect, test } from '@playwright/test';
import type { Building } from '@ai-floor-planner/core';
import { readFile } from 'node:fs/promises';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

test('current studio workflow through reference, massing and export', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Architectural precision. Photorealistic clarity.' })).toBeVisible();
  await page.getByTestId('cta-new-construction').click();
  await page.getByLabel('Project Title / Estate', { exact: false }).fill('Phase 3 live workflow');
  for (const step of [2, 3, 4]) await page.getByRole('button', { name: 'Continue to Step 0' + step }).click();
  await page.getByPlaceholder('Describe room layout preferences', { exact: false })
    .fill('Prioritize natural light in the living rooms and separate private bedrooms from entry circulation.');
  const upload = page.getByTestId('reference-workflow-card').locator('input[type=file]').first();
  await upload.setInputFiles({ name: 'brief-reference.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a83sAAAAASUVORK5CYII=', 'base64') });
  const generationResponse = () => page.waitForResponse(
    response => response.url().endsWith('/api/v1/projects/generate'),
    { timeout: 60_000 },
  );
  const firstRequest = generationResponse();
  await page.getByRole('button', { name: 'Generate Architectural Project' }).click();
  const first = await firstRequest;
  expect(first.status()).toBe(200);
  expect(first.request().postDataJSON().config.referenceImage?.name).toBe('brief-reference.png');
  const original = await first.json() as { building: Building; telemetry: { interpretationSource: string } };
  expect(original.telemetry.interpretationSource).toBe('DETERMINISTIC');
  const gallery = page.getByRole('region', { name: 'Massing studies gallery' });
  // HTTP acceptance precedes the browser worker's audit and projection.
  const galleryReady = gallery.getByRole('heading', { name: 'Massing Studies' });
  const generationFailed = page.getByRole('dialog', { name: 'Generation needs attention' });
  await expect(galleryReady.or(generationFailed)).toBeVisible({ timeout: 25_000 });
  await expect(generationFailed).toBeHidden();
  await expect(galleryReady).toBeVisible();
  await gallery.getByRole('button', { name: 'Building', exact: true }).click();
  await expect(gallery.locator('canvas')).toBeVisible({ timeout: 25_000 });
  await gallery.getByRole('button', { name: 'Plan', exact: true }).click();
  const secondRequest = generationResponse();
  await gallery.getByRole('button', { name: 'Generate Massing Alternative' }).click();
  const second = await secondRequest;
  expect(second.status(), JSON.stringify((await second.json()).error ?? {})).toBe(200);
  const alternate = (await second.json()).building as Building;
  expect(alternate.metadata.generationBrief?.physicalLayoutHash).toBeTruthy();
  expect(alternate.metadata.generationBrief?.physicalLayoutHash).not.toBe(original.building.metadata.generationBrief?.physicalLayoutHash);
  await gallery.getByRole('button', { name: /Study 2/ }).click();
  await gallery.getByRole('button', { name: 'Open in CAD' }).click();
  await page.getByTestId('nav-edit_plan').click();
  await expect(page.getByRole('region', { name: 'Interactive Plan Editor Studio' })).toBeVisible();
  await page.getByTestId('nav-isometric').click();
  await page.getByTestId('toggle-view-3d').click();
  await expect(page.getByTestId('isometric-3d-viewport').locator('canvas')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('nav-building_3d').click();
  const tower = page.locator('.three-building-scene canvas').first();
  // The real renderer writes these stats only after it submits a frame.
  await expect(tower).toHaveAttribute('data-draw-calls', /^[1-9]\d*$/, { timeout: 45_000 });
  await expect(tower).toBeVisible();
  await tower.evaluate(element => {
    const metrics = { renders: 0, maxPerFrame: 0 };
    let frameWrites = 0;
    let sampleFrames = 0;
    const observer = new MutationObserver(records => {
      metrics.renders += records.length;
      frameWrites += records.length;
    });
    observer.observe(element, { attributeFilter: ['data-draw-calls'] });
    const frame = () => {
      metrics.maxPerFrame = Math.max(metrics.maxPerFrame, frameWrites);
      frameWrites = 0;
      if (sampleFrames++ < 120 && element.isConnected) requestAnimationFrame(frame);
      else observer.disconnect();
    };
    requestAnimationFrame(frame);
    (window as Window & { towerMetrics?: typeof metrics }).towerMetrics = metrics;
  });
  const box = (await tower.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.53, box.y + box.height * 0.5, { steps: 12 });
  await page.mouse.up();
  const stats = () => page.evaluate(() => (window as Window & { towerMetrics?: { renders: number; maxPerFrame: number } }).towerMetrics!);
  await expect.poll(async () => (await stats()).renders).toBeGreaterThan(8);
  const atOrbit = await stats();
  await page.waitForTimeout(1_250);
  const afterOrbit = await stats();
  expect(afterOrbit.maxPerFrame).toBe(1);
  console.log('RH_TOWER_OBSERVED', { atOrbit, afterOrbit, drawCalls: await tower.getAttribute('data-draw-calls'), triangles: await tower.getAttribute('data-triangles') });
  await page.getByTestId('nav-structural_cad').click();
  const structural = page.getByTestId('structural-cad-workspace');
  await expect(structural).toBeVisible();
  await expect(structural.getByText(/Licensed structural engineer review/)).toBeVisible();
  await page.getByTestId('nav-export').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download building GLB' }).click();
  const file = await download;
  expect((await readFile((await file.path())!)).subarray(0, 4).toString()).toBe('glTF');
  await page.getByTestId('topbar-save-local').click();
  await expect(page.getByTestId('local-save-toast')).toContainText('to local disk');
  await page.reload();
  await expect(page.getByTestId('project-switcher-trigger')).toContainText('Phase 3 live workflow');
  expect(errors).toEqual([]);
});

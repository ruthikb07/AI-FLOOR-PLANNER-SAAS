import { expect, test } from '@playwright/test';
import type { Building } from '@ai-floor-planner/core';
import { readFile } from 'node:fs/promises';

test.use({
  launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  // Continuous screenshots force pixel readbacks during software WebGL orbit.
  trace: { mode: 'retain-on-failure', screenshots: false },
});

test('leaves the welcome scene while shaders are still pending', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const proto = WebGL2RenderingContext.prototype;
    const completionStatus = 0x91b1;
    const getExtension = proto.getExtension;
    proto.getExtension = function (name: string) {
      return name === 'KHR_parallel_shader_compile'
        ? { COMPLETION_STATUS_KHR: completionStatus }
        : getExtension.call(this, name);
    };
    const getProgramParameter = proto.getProgramParameter;
    proto.getProgramParameter = function (program, parameter) {
      if (parameter === completionStatus) return false;
      return getProgramParameter.call(this, program, parameter);
    };
  });

  await page.goto('/');
  const scene = page.getByTestId('residence-showcase');
  await expect(scene).toHaveAttribute('data-component-count', /^[1-9]\d*$/, { timeout: 45_000 });
  await page.getByTestId('cta-new-construction').click();
  await expect(scene).toHaveCount(0);
  await expect(page.getByLabel('Project Title / Estate', { exact: false })).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  expect(errors).toEqual([]);
});

test('current studio workflow through reference, massing and export', async ({ page }) => {
  test.setTimeout(300_000);
  const t0 = Date.now();
  const stageMs: Record<string, number> = {};
  const markStage = (name: string) => {
    stageMs[name] = Date.now() - t0;
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Architectural precision. Photorealistic clarity.' })).toBeVisible();
  markStage('startup');
  await page.getByTestId('cta-new-construction').click();
  await page.getByLabel('Project Title / Estate', { exact: false }).fill('Phase 3 live workflow');
  for (const step of [2, 3, 4]) await page.getByRole('button', { name: 'Continue to Step 0' + step }).click();
  await page.getByPlaceholder('Describe room layout preferences', { exact: false })
    .fill('Prioritize natural light in the living rooms and separate private bedrooms from entry circulation.');
  const upload = page.getByTestId('reference-workflow-card').locator('input[type=file]').first();
  await upload.setInputFiles({ name: 'brief-reference.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a83sAAAAASUVORK5CYII=', 'base64') });
  markStage('setup');
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
  markStage('generate');
  await gallery.getByRole('button', { name: 'Building', exact: true }).click();
  await expect(gallery.locator('canvas')).toBeVisible({ timeout: 25_000 });
  markStage('concept_3d');
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
  markStage('alternative');
  await page.getByTestId('nav-edit_plan').click();
  await expect(page.getByRole('region', { name: 'Interactive Plan Editor Studio' })).toBeVisible();
  await page.getByTestId('nav-isometric').click();
  await page.getByTestId('toggle-view-3d').click();
  await expect(page.getByTestId('isometric-3d-viewport').locator('canvas')).toBeVisible({ timeout: 25_000 });
  markStage('floor_3d');
  await page.getByTestId('nav-building_3d').click();
  const tower = page.locator('.three-building-scene canvas').first();
  // The real renderer writes these stats only after it submits a frame.
  await expect(tower).toHaveAttribute('data-draw-calls', /^[1-9]\d*$/, { timeout: 45_000 });
  await expect(tower).toBeVisible();
  const rendering = await tower.evaluate(canvas => {
    const { width, height, dataset } = canvas as HTMLCanvasElement;
    return { width, height, softwareRasterizer: dataset.softwareRasterizer === 'true' };
  });
  if (rendering.softwareRasterizer) expect(rendering.width * rendering.height).toBeLessThanOrEqual(500_000);
  markStage('tower_3d_first_frame');
  const box = (await tower.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
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
      if (sampleFrames++ < 360 && element.isConnected) requestAnimationFrame(frame);
      else observer.disconnect();
    };
    requestAnimationFrame(frame);
    (window as Window & { towerMetrics?: typeof metrics }).towerMetrics = metrics;
  });
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.53, box.y + box.height * 0.5, { steps: 12 });
  await page.mouse.up();
  const stats = () => page.evaluate(() => (window as Window & { towerMetrics?: { renders: number; maxPerFrame: number } }).towerMetrics!);
  await expect.poll(async () => (await stats()).renders, { timeout: 25_000 }).toBeGreaterThan(8);
  const atOrbit = await stats();
  await page.waitForTimeout(1_250);
  const afterOrbit = await stats();
  expect(afterOrbit.maxPerFrame).toBe(1);
  markStage('tower_3d_orbit');
  console.log('RH_TOWER_OBSERVED', {
    atOrbit,
    afterOrbit,
    drawCalls: await tower.getAttribute('data-draw-calls'),
    triangles: await tower.getAttribute('data-triangles'),
    geometries: await tower.getAttribute('data-geometries'),
    textures: await tower.getAttribute('data-textures'),
    ...rendering,
    stageMs,
  });
  await page.getByTestId('nav-structural_cad').click();
  const structural = page.getByTestId('structural-cad-workspace');
  await expect(structural).toBeVisible();
  await expect(structural.getByText(/Licensed structural engineer review/)).toBeVisible();
  await page.getByTestId('nav-export').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download building GLB' }).click();
  const file = await download;
  expect((await readFile((await file.path())!)).subarray(0, 4).toString()).toBe('glTF');
  markStage('glb_export');
  await page.getByTestId('topbar-save-local').click();
  await expect(page.getByTestId('local-save-toast')).toContainText('to local disk');
  await page.reload();
  await expect(page.getByTestId('project-switcher-trigger')).toContainText('Phase 3 live workflow');
  markStage('save_reload');
  console.log('RH_STUDIO_STAGE_TIMESTAMPS', stageMs);
  expect(errors).toEqual([]);
});

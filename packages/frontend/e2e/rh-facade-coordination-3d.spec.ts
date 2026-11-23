import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Building } from '@ai-floor-planner/core';

const base = process.env.RH_CINEMATIC_URL ?? 'http://127.0.0.1:4177';
const chrome = process.env.RH_CINEMATIC_CHROME;
const screenshotsDir = path.resolve(process.cwd(), 'e2e/screenshots');

test.use({
  launchOptions: chrome
    ? { executablePath: chrome, args: ['--use-angle=d3d11'] }
    : { args: ['--enable-unsafe-swiftshader'] },
});

async function waitForWebGLFrames(page: import('@playwright/test').Page, frames = 8): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let count = 0;
        const step = () => {
          count += 1;
          if (count >= n) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    frames,
  );
}

test('4x 2BHK coordinated facade, 2D F1/F2 stagger, Floor 3D, Tower 3D Daylight & Night glow with 0 errors', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await mkdir(screenshotsDir, { recursive: true });

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const webglErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') consoleErrors.push(text);
    if (
      /webgl|shader|gl_invalid|context lost/i.test(text) &&
      msg.type() !== 'log' &&
      !/GPU stall due to ReadPixels/i.test(text)
    ) {
      webglErrors.push(text);
    }
  });

  // 1. Generate a 4x 2BHK multi-storey residential tower (Stilt + 4 Floors) with DOUBLE_HEIGHT_STAGGER
  const response = await request.post(`${base}/api/v1/projects/generate`, {
    timeout: 180_000,
    data: {
      config: {
        projectId: 'rh-coordinated-4x2bhk-e2e',
        projectName: 'RH Architectural Coordination Tower',
        structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
        galleryCoordinationMode: 'DOUBLE_HEIGHT_STAGGER',
        plotWidthMm: 42_000,
        plotDepthMm: 34_000,
        roadWidthMm: 12_000,
        roadAccessSides: ['south'],
        jurisdiction: 'pune_pmc',
        lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
        verticalStackType: 'STILT_PLUS_N',
        numTypicalFloors: 4,
        floorToFloorHeightMm: 3150,
        stiltHeightMm: 3150,
        flatsPerFloor: 4,
        units: Array.from({ length: 4 }, (_, i) => ({
          unitIndex: i + 1,
          bhkType: '2BHK',
          hasUtilityBalcony: true,
        })),
        setbacksMm: { front: 4500, rear: 3000, left: 3000, right: 3500 },
        parkingMode: 'STILT_AND_SURFACE',
        generationSeed: 1,
      },
    },
  });
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { building: Building };
  const building = payload.building;

  // Verify Workstream 1 & 2 metadata invariants from live backend response
  expect(building.complianceRating?.score ?? 0).toBeGreaterThanOrEqual(85);
  const fc = building.metadata.facadeCoordination;
  expect(fc).toBeDefined();
  expect(fc?.lintelDatumMm).toBe(2100);
  expect(fc?.coreAlignmentDriftMaxMm ?? 999).toBeLessThanOrEqual(5);
  expect(fc?.galleryCoordinationMode).toBe('DOUBLE_HEIGHT_STAGGER');
  expect((fc?.chajjaBands.length ?? 0)).toBeGreaterThan(0);
  expect((fc?.otsLouverScreens.length ?? 0)).toBeGreaterThan(0);

  const exposures = fc?.flatExposures ?? [];
  expect(exposures.length).toBeGreaterThanOrEqual(4);
  for (const exp of exposures) {
    expect(exp.livingExposureTier).toBeLessThanOrEqual(2);
  }

  // Verify F1 vs F2 true gallery bay stagger under DOUBLE_HEIGHT_STAGGER
  const resFloors = building.floors.filter((f) => f.floorUse === 'RESIDENTIAL');
  expect(resFloors.length).toBe(4);
  const balcSig = (fl: (typeof resFloors)[number]) =>
    fl.rooms
      .filter((r) => r.type === 'balcony')
      .map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`)
      .sort()
      .join('|');
  expect(balcSig(resFloors[0]!)).not.toBe(balcSig(resFloors[1]!));

  // 2. Load generated building into the live Studio UI
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(({ b }) => {
    sessionStorage.setItem('rh_welcome_dismissed', 'true');
    localStorage.setItem('ai_floor_planner_active_id', b.projectId);
    localStorage.setItem(
      `ai_floor_planner_proj_${b.projectId}`,
      JSON.stringify({
        schemaVersion: 9,
        projectId: b.projectId,
        name: b.name,
        building: b,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        status: 'CONCEPT',
        category: 'residential',
      }),
    );
  }, { b: building });

  await page.goto(base);

  // 3. Inspect 2D CAD -> 1ST FLOOR PLAN & 2ND FLOOR PLAN
  await page.getByTestId('nav-cad_2d').click();
  const floorBar = page.locator('[aria-label="Model floors"]');
  await expect(floorBar).toBeVisible({ timeout: 20_000 });

  const floor1Btn = floorBar.getByRole('button', { name: /1ST[_ ]FLOOR/i }).first();
  const floor2Btn = floorBar.getByRole('button', { name: /2ND[_ ]FLOOR/i }).first();
  await expect(floor1Btn).toBeVisible();
  await expect(floor2Btn).toBeVisible();

  await floor1Btn.click();
  await page.waitForTimeout(600);
  await expect(page.locator('svg .window-chajja').first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({
    path: path.join(screenshotsDir, 'coordinated-2d-f1.png'),
  });

  await floor2Btn.click();
  await page.waitForTimeout(600);
  await expect(page.locator('svg .window-chajja').first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({
    path: path.join(screenshotsDir, 'coordinated-2d-f2.png'),
  });

  // 4. Inspect Floor Cutaway 3D
  await page.getByTestId('nav-isometric').click();
  await page.getByTestId('toggle-view-3d').click();
  await expect(page.getByTestId('isometric-3d-viewport').locator('canvas')).toBeVisible({
    timeout: 45_000,
  });
  await waitForWebGLFrames(page, 10);

  // 5. Inspect Tower 3D -> Golden Hour Daylight, Bright Daylight, Night Architectural Glow, and Gallery Rhythm toggle
  await page.getByTestId('nav-building_3d').click();
  const towerCanvas = page.locator('.three-building-scene canvas');
  await expect(towerCanvas).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('btn-lighting-golden')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tower-gallery-stagger')).toHaveAttribute('aria-pressed', 'true');

  // Allow textures, sky dome, and PCFSoftShadowMap pass to settle in Golden Hour Daylight
  await waitForWebGLFrames(page, 18);
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(screenshotsDir, 'coordinated-3d-daylight.png'),
  });

  // Switch to Bright Daylight and verify clean render
  await page.getByTestId('btn-lighting-day').click();
  await expect(page.getByTestId('btn-lighting-day')).toHaveAttribute('aria-pressed', 'true');
  await waitForWebGLFrames(page, 10);

  // Switch to Night Architectural Glow and capture verification screenshot
  await page.getByTestId('btn-lighting-night').click();
  await expect(page.getByTestId('btn-lighting-night')).toHaveAttribute('aria-pressed', 'true');
  await waitForWebGLFrames(page, 18);
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(screenshotsDir, 'coordinated-3d-night.png'),
  });

  // Switch back to Golden Hour Daylight and verify live Gallery Rhythm toggle (Stacked Ribbon <-> Double-Height Stagger)
  await page.getByTestId('btn-lighting-golden').click();
  await page.getByTestId('tower-gallery-stacked').click();
  await expect(page.getByTestId('tower-gallery-stacked')).toHaveAttribute('aria-pressed', 'true', {
    timeout: 15_000,
  });
  await waitForWebGLFrames(page, 10);

  await page.getByTestId('tower-gallery-stagger').click();
  await expect(page.getByTestId('tower-gallery-stagger')).toHaveAttribute('aria-pressed', 'true', {
    timeout: 15_000,
  });
  await waitForWebGLFrames(page, 10);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(webglErrors).toEqual([]);
});

test('irregular angled plot adaptive flat orientation renders in 2D CAD & Tower 3D with 0 errors', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const response = await request.post(`${base}/api/v1/projects/generate`, {
    timeout: 150_000,
    data: {
      config: {
        projectId: 'rh-irregular-adaptive-e2e',
        projectName: 'Irregular Plot Adaptive Flats',
        buildingMassingShape: 'IRREGULAR_ANGLED_PLOT',
        structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
        galleryCoordinationMode: 'DOUBLE_HEIGHT_STAGGER',
        plotWidthMm: 34_000,
        plotDepthMm: 28_000,
        roadWidthMm: 12_000,
        roadAccessSides: ['south', 'east'],
        jurisdiction: 'pune_pmc',
        lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
        verticalStackType: 'STILT_PLUS_N',
        numTypicalFloors: 2,
        floorToFloorHeightMm: 3150,
        stiltHeightMm: 3150,
        flatsPerFloor: 4,
        units: Array.from({ length: 4 }, (_, i) => ({
          unitIndex: i + 1,
          bhkType: '2BHK',
          hasUtilityBalcony: true,
        })),
        setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
        irregularPlotBoundary: {
          polygon: {
            points: [
              { x: 0, y: 0 },
              { x: 34_000, y: 1200 },
              { x: 31_500, y: 27_500 },
              { x: 1800, y: 26_000 },
            ],
          },
          areaMm2: 806_000_000,
          perimeterMm: 116_800,
          roadEdgeIndex: 0,
          edgeSetbacksMm: [3000, 2000, 2000, 2000],
          sourceFormat: 'survey',
        },
        parkingMode: 'STILT_AND_SURFACE',
        generationSeed: 1,
      },
    },
  });
  expect(response.ok()).toBe(true);
  const { building } = (await response.json()) as { building: Building };

  expect(building.metadata.facadeCoordination?.lintelDatumMm).toBe(2100);
  expect(building.metadata.facadeCoordination?.coreAlignmentDriftMaxMm ?? 999).toBeLessThanOrEqual(5);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(({ b }) => {
    sessionStorage.setItem('rh_welcome_dismissed', 'true');
    localStorage.setItem('ai_floor_planner_active_id', b.projectId);
    localStorage.setItem(
      `ai_floor_planner_proj_${b.projectId}`,
      JSON.stringify({
        schemaVersion: 9,
        projectId: b.projectId,
        name: b.name,
        building: b,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        status: 'CONCEPT',
        category: 'residential',
      }),
    );
  }, { b: building });

  await page.goto(base);
  await page.getByTestId('nav-cad_2d').click();
  await expect(page.locator('[aria-label="Model floors"]')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('nav-building_3d').click();
  await expect(page.locator('.three-building-scene canvas')).toBeVisible({ timeout: 45_000 });
  await waitForWebGLFrames(page, 12);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

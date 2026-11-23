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

test('Gate 1 Live Verification — Study toggle default OFF, 30x40m 4x2BHK 2D CAD screenshot & 0 errors', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await mkdir(screenshotsDir, { recursive: true });

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // 1. Generate canonical 30m x 40m 4x 2BHK via local backend API
  const projectId = 'rh-gate1-live-30x40';
  const projectName = 'Gate 1 Repaired 30x40m 4x2BHK';
  const response = await request.post(`${base}/api/v1/projects/generate`, {
    timeout: 90_000,
    data: {
      config: {
        projectId,
        projectName,
        structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
        galleryCoordinationMode: 'DOUBLE_HEIGHT_STAGGER',
        plotWidthMm: 30_000,
        plotDepthMm: 40_000,
        roadWidthMm: 12_000,
        roadAccessSides: ['south'],
        jurisdiction: 'pune_pmc',
        lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
        verticalStackType: 'STILT_PLUS_N',
        numTypicalFloors: 4,
        floorToFloorHeightMm: 3150,
        stiltHeightMm: 3150,
        flatsPerFloor: 4,
        includeStudyRoom: false,
        units: [1, 2, 3, 4].map((i) => ({
          unitIndex: i,
          bhkType: '2BHK',
          hasUtilityBalcony: true,
        })),
        setbacksMm: { front: 4500, rear: 3000, left: 3000, right: 3000 },
        parkingMode: 'STILT_AND_SURFACE',
        generationSeed: 1,
      },
    },
  });
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { building: Building };
  const building = payload.building;
  expect(building.complianceRating?.score ?? 0).toBeGreaterThanOrEqual(85);
  expect(building.metadata?.generationBrief?.buildingMassingShape).toBe('COMPACT_DOUBLE_LOADED');

  const typFloor = building.floors.find((f) => f.floorUse === 'RESIDENTIAL');
  expect(typFloor).toBeDefined();
  const studyCount = (typFloor?.rooms ?? []).filter(
    (r) => r.type === 'study' || /study|home\s*office/i.test(r.name),
  ).length;
  expect(studyCount).toBe(0);

  // Save directly to local disk library (bypasses browser localStorage 5MB limit)
  const saveRes = await request.post(`${base}/api/v1/local-projects`, {
    data: { projectId, name: projectName, building },
  });
  expect(saveRes.ok()).toBe(true);

  // 2. Open live Studio UI & verify Brief Step 2 "Include Study / Home Office" defaults to OFF
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    sessionStorage.setItem('rh_welcome_dismissed', 'true');
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  await page.getByTestId('nav-setup').click({ timeout: 15_000 });
  await page.getByRole('button', { name: /Continue to Step 02/i }).first().click({ timeout: 15_000 });
  const studyToggle = page.getByTestId('brief-include-study-toggle');
  await expect(studyToggle).toBeVisible({ timeout: 15_000 });
  await expect(studyToggle).not.toBeChecked();

  // 3. Open saved Gate 1 project from Local Disk Library -> 2D CAD -> 1ST_FLOOR_PLAN
  await page.getByTestId('nav-library').click({ timeout: 15_000 });
  const openBtn = page.getByTestId(`open-disk-project-${projectId}`).first();
  await expect(openBtn).toBeVisible({ timeout: 15_000 });
  await openBtn.click();

  const floorBar = page.locator('[aria-label="Model floors"]');
  await expect(floorBar).toBeVisible({ timeout: 20_000 });
  const floor1Btn = floorBar.getByRole('button', { name: /1ST[_ ]FLOOR/i }).first();
  await expect(floor1Btn).toBeVisible({ timeout: 15_000 });
  await floor1Btn.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(screenshotsDir, 'repaired-2d-cad.png') });

  // Clean up test disk project after screenshot
  await request.delete(`${base}/api/v1/local-projects/${encodeURIComponent(projectId)}`);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

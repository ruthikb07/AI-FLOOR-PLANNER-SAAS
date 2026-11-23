import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Building } from '@ai-floor-planner/core';

const base = process.env.RH_CINEMATIC_URL ?? 'http://127.0.0.1:4177';
const chrome = process.env.RH_CINEMATIC_CHROME;
test.use({ launchOptions: chrome
  ? { executablePath: chrome, args: ['--use-angle=d3d11'] }
  : { args: ['--enable-unsafe-swiftshader'] } });

test('rotational pinwheel survives CAD, both 3D views, framing and verified PDF download', async ({ page, request }, info) => {
  test.setTimeout(240_000);
  const fixture = process.env.RH_HOTFIX_BUILDING;
  let building: Building;
  if (fixture) building = JSON.parse(await readFile(fixture, 'utf8')) as Building;
  else {
    const response = await request.post(`${base}/api/v1/projects/generate`, {
      timeout: 180_000,
      data: { config: {
        projectId: 'rh-hotfix-pinwheel', projectName: 'Pinwheel verification', buildingMassingShape: 'PINWHEEL_CLUSTER',
        structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE', plotWidthMm: 42_000, plotDepthMm: 34_000,
        roadWidthMm: 12_000, roadAccessSides: ['south'], jurisdiction: 'pune_pmc', lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
        verticalStackType: 'STILT_PLUS_N', numTypicalFloors: 1, floorToFloorHeightMm: 3150, stiltHeightMm: 3150,
        flatsPerFloor: 4, units: Array.from({ length: 4 }, (_, i) => ({ unitIndex: i + 1, bhkType: '2BHK', hasUtilityBalcony: true })),
        setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 }, parkingMode: 'STILT_AND_SURFACE', generationSeed: 1,
      } },
    });
    expect(response.ok()).toBe(true);
    building = (await response.json()).building as Building;
  }
  expect(building.metadata.generationBrief?.buildingMassingShape).toBe('PINWHEEL_CLUSTER');
  const typical = building.floors.find(floor => floor.floorUse === 'RESIDENTIAL')!;
  const ducts = typical.rooms.filter(room => room.architecturalRole === 'OPEN_TO_SKY_VOID' && room.tags.includes('shaft:interflat'));
  expect(ducts).toHaveLength(4);
  for (const duct of ducts) {
    expect([Math.min(duct.width, duct.height), Math.max(duct.width, duct.height)]).toEqual([1600, 4000]);
    const walls = new Set(typical.walls.filter(wall => wall.roomIds.includes(duct.id)).map(wall => wall.id));
    const units = new Set(typical.windows.filter(window => walls.has(window.wallId)).flatMap(window => {
      const unit = typical.rooms.find(room => room.id === window.roomId)?.unitId;
      return unit ? [unit] : [];
    }));
    expect(units.size).toBe(2);
  }
  const testWindow = typical.windows.find(window => window.openingGeometryVersion === 1)!;
  expect(testWindow).toBeDefined();
  const testWall = typical.walls.find(wall => wall.id === testWindow.wallId)!;
  building = { ...building, floors: building.floors.map(floor => floor.id === typical.id
    ? { ...floor, windows: floor.windows.map(window => window.id === testWindow.id ? { ...window, position: testWall.startPoint } : window) }
    : floor) };
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ building }) => {
    sessionStorage.setItem('rh_welcome_dismissed', 'true');
    localStorage.setItem('ai_floor_planner_active_id', building.projectId);
    localStorage.setItem(`ai_floor_planner_proj_${building.projectId}`, JSON.stringify({
      schemaVersion: 9, projectId: building.projectId, name: building.name, building,
      createdAt: building.createdAt, updatedAt: building.updatedAt, status: 'CONCEPT', category: 'residential',
    }));
  }, { building });
  await page.goto(base);
  await page.getByTestId('nav-concepts').click();
  await expect(page.getByRole('heading', { name: 'PINWHEEL CLUSTER', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('pinwheel-massing.png') });
  await page.getByRole('button', { name: 'Open in CAD' }).click();
  const pill = page.getByRole('button', { name: /^Layout score \d+ \/ 100$/ });
  await expect(pill).toBeVisible();
  await expect(pill).not.toHaveText('Layout score 100 / 100');
  await pill.click();
  await expect(page.getByRole('complementary', { name: 'Score Breakdown' })).toContainText('Requested massing15/15');
  await page.screenshot({ path: info.outputPath('layout-score.png') });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('nav-isometric').click();
  await page.getByTestId('toggle-view-3d').click();
  await expect(page.getByTestId('isometric-3d-viewport').locator('canvas')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('nav-building_3d').click();
  await expect(page.locator('.three-building-scene canvas')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('nav-structural_cad').click();
  await expect(page.getByText(/[1-9]\d* columns · [1-9]\d* beams/)).toBeVisible();
  await expect(page.getByText('150 mm', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('preliminary-framing.png') });
  await page.getByTestId('nav-engineering').click();
  await page.getByRole('button', { name: 'Auto-Fix All Violations & Regenerate' }).click();
  await expect(page.getByText(/^Applied improved revision\./)).toBeVisible();
  await expect(page.getByText(`${building.name} · Revision ${building.version + 1}`, { exact: true })).toBeVisible();
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Violation & Fix Guide (PDF)' }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe('Compliance_Audit_and_Fix_Plan.pdf');
  const pdfPath = info.outputPath(download.suggestedFilename());
  await download.saveAs(pdfPath);
  const pdf = await readFile(pdfPath);
  expect(pdf.subarray(0, 8).toString()).toBe('%PDF-1.4');
  expect(pdf.toString('ascii')).toContain('COMPLIANCE AUDIT AND FIX PLAN');
  expect(errors).toEqual([]);
});

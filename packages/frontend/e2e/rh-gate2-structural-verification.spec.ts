import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Building } from '@ai-floor-planner/core';

const base = process.env.RH_CINEMATIC_URL ?? 'http://127.0.0.1:4177';
const chrome = process.env.RH_CINEMATIC_CHROME;
const screenshotsDir = process.env.RH_STRUCTURAL_EVIDENCE_DIR;

test.use({
  launchOptions: chrome
    ? { executablePath: chrome, args: ['--use-angle=d3d11'] }
    : { args: ['--enable-unsafe-swiftshader'] },
});

test('Gate 2 Live Verification — Corner-Locked Columns/Beams, High-Contrast Sidebar & Built-In IS 456 Structural Analysis', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  if (screenshotsDir) await mkdir(screenshotsDir, { recursive: true });

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // 1. Generate canonical 30m x 40m 4x 2BHK with structural framing
  const projectId = 'rh-gate2-live-struct';
  const projectName = 'Gate 2 Structural Framing 30x40m';
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

  const typFloor = building.floors.find((f) => f.floorUse === 'RESIDENTIAL');
  expect(typFloor).toBeDefined();
  expect(typFloor?.columns.length ?? 0).toBeGreaterThanOrEqual(40);
  expect(typFloor?.beams?.length ?? 0).toBeGreaterThanOrEqual(120);

  // Verify live CSI ETABS .e2k export endpoint succeeds cleanly with dense framing
  const e2kRes = await request.post(`${base}/api/v1/export/etabs/e2k`, {
    data: { building },
  });
  expect(e2kRes.ok()).toBe(true);
  const e2kText = await e2kRes.text();
  expect(e2kText).toContain('$ STORIES');
  expect(e2kText).toContain('$ LINE CONNECTIVITIES');

  const saveRes = await request.post(`${base}/api/v1/local-projects`, {
    data: { projectId, name: projectName, building },
  });
  expect(saveRes.ok()).toBe(true);

  // 2. Open project in live Studio UI -> Structural CAD Workspace
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    sessionStorage.setItem('rh_welcome_dismissed', 'true');
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  await page.getByTestId('nav-library').click({ timeout: 15_000 });
  const openBtn = page.getByTestId(`open-disk-project-${projectId}`).first();
  await expect(openBtn).toBeVisible({ timeout: 15_000 });
  await openBtn.click();
  await page.waitForTimeout(500);

  await page.getByTestId('nav-structural_cad').click({ timeout: 15_000 });
  await expect(page.getByTestId('structural-cad-workspace')).toBeVisible({ timeout: 15_000 });

  const colCountText = await page.getByTestId('struct-sidebar-col-count').textContent();
  const beamCountText = await page.getByTestId('struct-sidebar-beam-count').textContent();
  expect(Number(colCountText?.trim())).toBeGreaterThanOrEqual(40);
  expect(Number(beamCountText?.trim())).toBeGreaterThanOrEqual(120);

  // Verify sidebar has high-contrast dark obsidian background (not light cream)
  const sidebarBg = await page.getByTestId('structural-sidebar').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(sidebarBg).not.toContain('246, 242');

  // Switch to Beam Framing + Columns combined visual and capture repaired-structural-cad.png
  await page.getByTestId('struct-tab-beams').click();
  if (screenshotsDir) await page.screenshot({ path: path.join(screenshotsDir, 'repaired-structural-cad.png') });

  // 3. Switch to built-in Structural Analysis tab & verify live IS 456 / IS 1893 interactivity
  const initialAnalysis = page.waitForResponse((result) => result.url().endsWith('/api/v1/structural/analyze'), { timeout: 70_000 });
  await page.getByTestId('struct-tab-analysis').click();
  const initialResult = await initialAnalysis;
  expect(initialResult.ok(), 'Initial analysis status ' + initialResult.status()).toBe(true);
  await expect(page.getByTestId('structural-analysis-panel')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('struct-column-schedule-table')).toBeVisible();

  await expect(page.getByTestId('struct-solver-backend-badge')).toContainText(/AWATIF_CPP_WASM|TYPESCRIPT_SPARSE_LU/, { timeout: 50_000 });
  await expect(page.getByTestId('struct-lifecycle-badge')).toContainText('GEOTECHNICAL');
  const baseShear = page.getByTestId('struct-base-shear-value');
  const shearNumber = async () => parseFloat((await baseShear.textContent() ?? '').replace(/[^0-9.]/g, ''));
  const originalShear = await shearNumber();
  expect(originalShear).toBeGreaterThan(0);
  await page.getByTestId('struct-seismic-zone').selectOption('V');
  await expect.poll(shearNumber, { timeout: 50_000 }).toBeGreaterThan(originalShear);

  await page.getByTestId('struct-subtab-beams_slabs').click();
  await expect(page.getByTestId('struct-beam-checks-table')).toBeVisible();

  await page.getByTestId('struct-subtab-footings').click();
  await expect(page.getByTestId('struct-sbc-input')).toHaveValue('');
  await page.getByTestId('struct-sbc-input').fill('100');
  await expect(page.getByTestId('struct-lifecycle-badge')).toContainText('GEOTECHNICAL');
  await page.getByTestId('struct-foundation-depth-input').fill('1.8');
  await page.getByTestId('struct-soil-unit-weight').fill('18.5');
  await page.getByTestId('struct-settlement-limit').fill('40');
  const analysisResponse = page.waitForResponse((result) => result.url().endsWith('/api/v1/structural/analyze'), { timeout: 60_000 });
  await page.getByTestId('struct-geotech-reference').fill('PLAYWRIGHT-GEOTECH-FIXTURE');
  const analyzed = await analysisResponse;
  expect(analyzed.ok(), `Analysis status ${analyzed.status()}`).toBe(true);
  const evaluationId = await analyzed.headerValue('x-structural-evaluation-id');
  expect(evaluationId).toBeTruthy();
  const result = await request.post(base + '/api/v1/structural/evaluation', { data: { evaluationId }, timeout: 60_000 });
  expect(result.ok()).toBe(true);
  const { snapshot } = await result.json();
  expect(snapshot.foundationDesign.status).not.toBe('MISSING_GEOTECHNICAL_INPUT');
  expect(snapshot.foundationDesign.footings.length).toBeGreaterThan(0);
  expect(snapshot.system.sourceArchitecturalRevision).toBe(building.version);
  await expect(page.getByTestId('struct-footing-schedule-table')).toBeVisible();
  expect(Object.keys(snapshot.solveEnvelope.combinationResults).length).toBeGreaterThan(1);

  await page.getByTestId('struct-subtab-diagrams').click();
  await expect(page.getByTestId('struct-fea-diagram-canvas')).toBeVisible({ timeout: 25_000 });
  const caseSelector = page.getByTestId('struct-combo-selector');
  await caseSelector.selectOption({ index: 1 });
  await expect(page.getByTestId('struct-fea-diagram-canvas')).toBeVisible({ timeout: 25_000 });
  if (screenshotsDir) await page.screenshot({ path: path.join(screenshotsDir, 'structural-studio-analysis.png') });

  for (const [format, signature] of [['dxf', 'SECTION'], ['ifc', 'ISO-10303-21'], ['pdf', '%PDF-']] as const) {
    const result = await request.post(base + '/api/v1/structural/drawings', { data: { evaluationId, format } });
    expect(result.ok(), `Failed to generate ${format}: ${result.status()}`).toBe(true);
    expect(result.headers()['x-structural-source-revision']).toBe(snapshot.system.sourceArchitecturalSha256);
    const bytes = await result.body();
    expect(bytes.subarray(0, 40).toString()).toContain(signature);
    if (screenshotsDir) await writeFile(path.join(screenshotsDir, 'structural-studio.' + format), bytes);
  }
  if (screenshotsDir) await writeFile(path.join(screenshotsDir, 'structural-studio.snapshot.json'), JSON.stringify(snapshot));

  await page.getByTestId('struct-subtab-ai_assistant').click();
  await page.getByTestId('struct-assistant-send').click();
  await expect(page.getByTestId('struct-assistant-answer')).toContainText('DETERMINISTIC_AWATIF_FEA');

  const badBuilding = await request.post(base + '/api/v1/structural/analyze', { data: { building: { floors: [] }, reviewedInputs: {} } });
  expect(badBuilding.status()).toBe(400);
  const fakeGeotech = await request.post(base + '/api/v1/structural/analyze', {
    data: { building, reviewedInputs: { geotechnical: { safeBearingCapacityKPa: 200 } } },
  });
  expect(fakeGeotech.status()).toBe(400);
  const expired = await request.post(base + '/api/v1/structural/drawings', { data: { evaluationId: 'expired', format: 'ifc' } });
  expect(expired.status()).toBe(409);

  // 4. Verify Engineering -> ETABS Structural Analysis tab shows live IS 456 analysis (NOT dead unavailable text)
  await page.getByTestId('nav-engineering').click({ timeout: 15_000 });
  await page.getByRole('tab', { name: /ETABS Structural Analysis/i }).click({ timeout: 10_000 });
  await expect(page.getByTestId('structural-analysis-panel')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Verified analysis results are unavailable/i)).toHaveCount(0);

  await request.delete(`${base}/api/v1/local-projects/${encodeURIComponent(projectId)}`);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

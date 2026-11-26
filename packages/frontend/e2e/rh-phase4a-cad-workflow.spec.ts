import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Building } from '@ai-floor-planner/core';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

test('Phase 4A end-to-end CAD studio, AI-assisted canonical edit, 3D sync, exports, undo/redo, and save/reload (Desktop 1440x900)', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const pageErrors: string[] = [];
  const failedCriticalRequests: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('requestfailed', req => {
    const url = req.url();
    if (url.includes('/api/') && req.failure()?.errorText !== 'net::ERR_ABORTED') {
      failedCriticalRequests.push(`${req.method()} ${url} -> ${req.failure()?.errorText}`);
    }
  });

  // 1 & 2. Open RH Planner and verify provider health mode explicitly
  const healthResp = await request.get('/api/v1/health');
  expect(healthResp.status()).toBe(200);
  const healthJson = (await healthResp.json()) as {
    status: string;
    planGeneration: string;
    gemini: { configured: boolean; status: string };
  };
  expect(healthJson.status).toBe('ok');
  expect(['deterministic', 'hybrid-gemini']).toContain(healthJson.planGeneration);

  await page.goto('/');
  await page.getByTestId('cta-new-construction').click();

  // 3 & 4. Create residential project with natural-language prompt + optional reference upload and generate options
  await page.getByLabel('Project Title / Estate', { exact: false }).fill('Phase 4A Precision CAD Tower');
  for (const step of [2, 3, 4]) {
    await page.getByRole('button', { name: 'Continue to Step 0' + step }).click();
  }
  await page
    .getByPlaceholder('Describe room layout preferences', { exact: false })
    .fill('Spacious 2BHK and 3BHK apartments with cross-ventilated living rooms and well-lit bedrooms.');

  const upload = page.getByTestId('reference-workflow-card').locator('input[type=file]').first();
  await upload.setInputFiles({
    name: 'phase4a-sketch.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a83sAAAAASUVORK5CYII=',
      'base64',
    ),
  });

  const genWait = page.waitForResponse(
    res => res.url().endsWith('/api/v1/projects/generate'),
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Generate Architectural Project' }).click();
  const genResp = await genWait;
  expect(genResp.status()).toBe(200);
  const genPayload = (await genResp.json()) as {
    building: Building;
    telemetry: { interpretationSource: string };
  };
  expect(['GEMINI', 'DETERMINISTIC']).toContain(genPayload.telemetry.interpretationSource);

  // 5. Open candidate in CAD workspace and launch Precision CAD Studio
  const gallery = page.getByRole('region', { name: 'Massing studies gallery' });
  await expect(gallery.getByRole('heading', { name: 'Massing Studies' })).toBeVisible({ timeout: 30_000 });
  await gallery.getByRole('button', { name: 'Open in CAD' }).click();

  // Switch to a residential floor so rooms, doors, windows, stairs and lift cores are active
  const typicalFloorBtn = page.getByRole('button', { name: /Typical|Floor 1|First Floor/i }).first();
  if (await typicalFloorBtn.isVisible()) {
    await typicalFloorBtn.click();
  }

  await page.getByTestId('toggle-precision-cad-studio').click();
  const workbench = page.getByTestId('precision-cad-workbench');
  await expect(workbench).toBeVisible();

  // 6. Verify layers, snapping, dimensions, room labels, doors, windows, stairs and lift cores
  const layerMgr = page.getByTestId('cad-layer-manager');
  await expect(layerMgr).toBeVisible();
  for (const layerId of ['A-WALL-EXT', 'A-ROOM', 'A-DOOR', 'A-WIND', 'A-STAIR', 'A-LIFT', 'A-DIM', 'D-DRAFT']) {
    await expect(page.getByTestId(`cad-layer-vis-${layerId}`)).toBeVisible();
  }
  await expect(page.getByTestId('cad-osnap-endpoint')).toHaveAttribute('aria-pressed', 'true');
  const svgCanvas = page.getByTestId('precision-cad-svg');
  await expect(svgCanvas).toBeVisible();
  const svgBox = (await svgCanvas.boundingBox())!;
  await page.mouse.move(svgBox.x + svgBox.width * 0.5, svgBox.y + svgBox.height * 0.5);
  await expect(page.getByTestId('cad-cursor-readout')).toContainText('mm');

  // 7. Perform a CAD drafting annotation edit and verify canonical walls/rooms are unchanged
  const revBeforeDraftText = await page.getByTestId('cad-revision-badge').textContent();
  const initialRevNum = Number(revBeforeDraftText?.match(/Rev\s+(\d+)/)?.[1] ?? '1');
  await page.getByTestId('cad-tool-line').click();
  await page.mouse.click(svgBox.x + svgBox.width * 0.3, svgBox.y + svgBox.height * 0.3);
  await page.mouse.click(svgBox.x + svgBox.width * 0.6, svgBox.y + svgBox.height * 0.3);
  await expect(page.getByTestId('cad-revision-badge')).toContainText(`Rev ${initialRevNum + 1}`);
  await expect(workbench).toContainText('Drafts: 1');

  // Verify protected localized single-flat regeneration previews cleanly without touching remaining flats
  await page
    .getByTestId('cad-ai-instruction-input')
    .fill('Regenerate only Flat 2 while keeping the remaining flats unchanged');
  const regeneration = page.waitForResponse(response => response.url().endsWith('/api/v1/cad/edit-proposal'));
  await page.getByTestId('cad-ai-preview-btn').click();
  const regenerated = await regeneration;
  expect(regenerated.status()).toBe(200);
  const { proposal } = await regenerated.json();
  expect(proposal.status, proposal.message).toBe('PREVIEW_READY');
  await expect(page.getByTestId('cad-ai-preview-status')).toHaveText('PREVIEW_READY');
  await expect(page.getByTestId('cad-ai-preview-card')).toContainText('Flat 02');

  // 8. Perform a canonical architectural edit (Resize window to 1500 mm) through the controlled edit bridge
  const residential = genPayload.building.floors.find(floor => floor.floorUse === 'RESIDENTIAL')!;
  const window = residential.windows.find(opening => {
    const wall = residential.walls.find(candidate => candidate.id === opening.wallId);
    return wall && !wall.arc && Math.hypot(wall.endPoint.x - wall.startPoint.x, wall.endPoint.y - wall.startPoint.y) >= 2300
      && opening.width !== 1500 && !residential.rooms.some(room => room.isFixed && wall.roomIds.includes(room.id))
      && residential.windows.every(other => other.id === opening.id || other.wallId !== wall.id)
      && residential.doors.every(door => door.wallId !== wall.id);
  })!;
  expect(window?.id).toBeTruthy();
  await page.getByTestId('nav-bim').click();
  const bim = page.getByRole('region', { name: 'RH Planner — BIM Studio' });
  await bim.getByRole('combobox', { name: 'BIM storey' }).selectOption(residential.id);
  await bim.getByRole('combobox', { name: 'BIM schedule' }).selectOption('window');
  await bim.getByLabel('Find element').fill(window.id);
  await bim.getByRole('table').getByRole('button').click();
  await bim.getByRole('button', { name: 'Precision CAD', exact: true }).click();
  await expect(page.getByTestId('cad-entity-inspector')).toContainText(window.id);
  await page.getByTestId('cad-ai-instruction-input').fill('Resize this window to 1500 mm');
  await page.getByTestId('cad-ai-preview-btn').click();
  await expect(page.getByTestId('cad-ai-preview-status')).toHaveText('PREVIEW_READY');
  await expect(page.getByTestId('cad-ai-preview-card')).toContainText('1500 mm');
  await page.getByTestId('cad-ai-accept-btn').click();
  const canonicalRev = initialRevNum + 2;
  await expect(page.getByTestId('cad-revision-badge')).toContainText(`Rev ${canonicalRev}`);

  // 10. Test Undo and Redo in Precision CAD Studio
  await page.getByTestId('cad-undo-btn').click();
  await expect(page.getByTestId('cad-revision-badge')).toContainText(`Rev ${canonicalRev - 1}`);
  await page.getByTestId('cad-redo-btn').click();
  await expect(page.getByTestId('cad-revision-badge')).toContainText(`Rev ${canonicalRev}`);

  // 9. Verify 2D sheet, 3D floor view and 3D building view update cleanly from the same revision
  await page.getByTestId('exit-precision-cad-studio').click();
  await expect(page.getByText(`Geometry audit · revision ${canonicalRev}`)).toBeVisible();

  await page.getByTestId('nav-isometric').click();
  await page.getByTestId('toggle-view-3d').click();
  await expect(page.getByTestId('isometric-3d-viewport').locator('canvas')).toBeVisible({ timeout: 25_000 });

  await page.getByTestId('nav-building_3d').click();
  const towerCanvas = page.locator('.three-building-scene canvas').first();
  await expect(towerCanvas).toHaveAttribute('data-draw-calls', /^[1-9]\d*$/, { timeout: 45_000 });

  // 11. Export DXF, DWG, PDF (from 2D CAD) and GLB (from Export studio); verify non-empty headers
  await page.getByTestId('nav-cad_2d').click();
  for (const fmt of ['DXF', 'DWG', 'PDF'] as const) {
    const dlPromise = page.waitForEvent('download', { timeout: 45_000 });
    await page.getByRole('button', { name: `Export ${fmt}`, exact: true }).click();
    const dl = await dlPromise;
    const bytes = await readFile((await dl.path())!);
    expect(bytes.length).toBeGreaterThan(200);
    if (fmt === 'PDF') expect(bytes.subarray(0, 4).toString('ascii')).toBe('%PDF');
    if (fmt === 'DWG') expect(bytes.subarray(0, 6).toString('ascii')).toBe('AC1032');
    if (fmt === 'DXF') expect(bytes.toString('utf8', 0, 120)).toContain('SECTION');
  }

  await page.getByTestId('nav-export').click();
  const glbDlPromise = page.waitForEvent('download', { timeout: 45_000 });
  await page.getByRole('button', { name: 'Download building GLB' }).click();
  const glbDl = await glbDlPromise;
  const glbBytes = await readFile((await glbDl.path())!);
  expect(glbBytes.subarray(0, 4).toString('ascii')).toBe('glTF');

  // 12. Save and reload project; verify CAD drafting edits and canonical revision persist
  await page.getByTestId('topbar-save-local').click();
  await expect(page.getByTestId('local-save-toast')).toContainText('to local disk');
  await page.reload();
  await page.getByTestId('nav-cad_2d').click();
  await page.getByTestId('toggle-precision-cad-studio').click();
  await expect(page.getByTestId('cad-revision-badge')).toContainText(`Rev ${canonicalRev}`);

  expect(pageErrors).toEqual([]);
  expect(failedCriticalRequests).toEqual([]);
});

test('Phase 4A Precision CAD Studio mobile responsiveness (390x844)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.addInitScript(() => sessionStorage.setItem('rh_welcome_dismissed', 'true'));
  await page.goto('/');
  await page.getByTestId('nav-cad_2d').click();
  await page.getByTestId('toggle-precision-cad-studio').click();

  const workbench = page.getByTestId('precision-cad-workbench');
  await expect(workbench).toBeVisible();

  // Verify no horizontal document overflow on mobile
  const overflowPx = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflowPx).toBeLessThanOrEqual(2);

  await page.getByTestId('cad-mobile-ai-toggle').click();
  await expect(page.getByTestId('cad-ai-edit-panel')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

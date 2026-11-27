import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createGenerationControlState, EXACT_SQMM_PER_SQFT, RoomType, rectToPolygon, type Building, type IfcExchangeManifest, type MultiSheetApartmentConfig } from '@ai-floor-planner/core';
import { isDoorSwingClear, openingFitsApartmentWall, polygonBoundingBox, rotatePoint } from '@ai-floor-planner/geometry-engine';
import { auditFloorFunctionalQuality, compareCanonicalBuildingAlternatives, editFurniturePlacement } from '@ai-floor-planner/planning-engine';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

const fixtures = [
  { id: 1, name: 'Residential bungalow', width: 28, depth: 24, floors: 2, mix: [0, 0, 0, 1], bungalow: true },
  { id: 2, name: 'Compact apartment', width: 18.5, depth: 25, floors: 1, mix: [0, 2, 0, 0] },
  { id: 3, name: 'Exact oblique survey', width: 39, depth: 34, floors: 1, mix: [0, 2, 0, 0], survey: true },
  { id: 4, name: 'Four-flat mixed BHK', width: 38, depth: 32, floors: 1, mix: [0, 2, 2, 0], stilt: true },
  { id: 5, name: 'Strict unequal targets', width: 42, depth: 34, floors: 1, mix: [0, 2, 2, 0], stilt: true, strict: true },
  { id: 6, name: 'Six-flat high density', width: 50, depth: 40, floors: 1, mix: [0, 6, 0, 0], stilt: true },
  { id: 7, name: 'Multi-storey open stilt', width: 38, depth: 32, floors: 4, mix: [0, 4, 0, 0], stilt: true },
  { id: 8, name: 'Reference attachment', width: 38, depth: 32, floors: 1, mix: [0, 4, 0, 0], stilt: true, reference: true },
] as const;

for (const fixture of fixtures) {
  test(`project ${fixture.id}: ${fixture.name}`, async ({ page, request }, info) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    const times: Record<string, number> = {};
    const row: Record<string, unknown> = { id: fixture.id, name: fixture.name, browserErrors: errors, processingMs: times,
      surveyPreservation: 'not_applicable',
      protectedRegeneration: 'not_run', cadEditing: 'not_run', visualReview: 'pending_review',
    };
    const start = Date.now();
    const mark = (key: string) => { times[key] = Date.now() - start; };
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      const flats = Array.from(fixture.mix, Number).reduce((sum, count) => sum + count, 0);
      await page.addInitScript(draft => {
        if (!localStorage.getItem('argon_studio_store_wizard_v1')) {
          localStorage.setItem('argon_studio_store_wizard_v1', JSON.stringify(draft));
        }
      }, {
        plotWidthM: fixture.width, plotDepthM: fixture.depth, floorsCount: fixture.floors,
        flatsPerFloor: flats, hasStiltParking: 'stilt' in fixture, roadFacing: 'South',
        authorityType: 'MUNICIPAL_CORPORATION', congestionZone: 'NON_CONGESTED',
        planCategory: 'bungalow' in fixture ? 'LUXURY_VILLA_BUNGALOW' : 'HIGH_RISE_APARTMENT',
        buildingMassingShape: 'survey' in fixture ? 'COMPACT_DOUBLE_LOADED' : 'AUTO',
        bhkCounts: { '1BHK': fixture.mix[0], '2BHK': fixture.mix[1], '3BHK': fixture.mix[2], '4BHK': fixture.mix[3] },
        aiPrompt: '',
      });
      await page.goto('/');
      await page.getByTestId('cta-new-construction').click();
      await page.getByLabel('Project Title / Estate', { exact: false }).fill(fixture.name);
      if ('survey' in fixture) {
        await page.getByRole('button', { name: 'Surveyed boundary' }).click();
        await page.getByLabel('Starting outline').selectOption('trapezoid');
        await page.getByLabel('East A (m)').fill('-0.125');
        await page.getByLabel('East A (m)').press('Tab');
        await page.getByLabel('Road-facing edge').selectOption('2');
      }
      for (const step of [2, 3]) await page.getByRole('button', { name: 'Continue to Step 0' + step }).click();
      const strict = 'strict' in fixture;
      const strictTargets = [720, 1050, 1420, 1750];
      if (strict) {
        await page.getByRole('checkbox', { name: 'Require carpet targets' }).check();
        await page.getByLabel('Carpet area tolerance (%)').fill('3');
        for (const [index, label] of ['2BHK flat 1', '2BHK flat 2', '3BHK flat 1', '3BHK flat 2'].entries()) {
          await page.getByLabel(label + ' target (sq ft)').fill(String(strictTargets[index]));
        }
      }
      await page.getByRole('button', { name: 'Continue to Step 04' }).click();
      if ('reference' in fixture) {
        const image = await readFile(new URL('../../../docs/phase2/evidence/floor_typical.png', import.meta.url));
        await page.getByTestId('reference-workflow-card').locator('input[type=file]').first()
          .setInputFiles({ name: 'floor_typical.png', mimeType: 'image/png', buffer: image });
        row.liveReferenceInfluence = 'pending_authorized_runtime';
      }
      const generation = page.waitForResponse(response => response.url().endsWith('/api/v1/projects/generate'), { timeout: 100_000 });
      await page.getByRole('button', { name: 'Generate Architectural Project' }).click();
      const response = await generation;
      const { config } = response.request().postDataJSON() as { config: MultiSheetApartmentConfig };
      await writeFile(info.outputPath('generation-request.json'), JSON.stringify(config, null, 2));
      expect(config).toMatchObject({ projectName: fixture.name, numTypicalFloors: fixture.floors, flatsPerFloor: flats });
      if ('survey' in fixture) {
        expect(config.surveyBoundary).toMatchObject({ points: expect.any(Array), roadEdge: 2 });
        expect(config.surveyBoundary?.points[0]).toEqual({ x: -125, y: 0 });
      } else {
        expect(config).toMatchObject({ plotWidthMm: fixture.width * 1000, plotDepthMm: fixture.depth * 1000 });
      }
      if (strict) expect(config.units?.map(unit => unit.targetCarpetSqFt)).toEqual(strictTargets);
      row.wizardInput = 'pass';
      row.requestedCarpetSqFt = config.units?.map(unit => unit.targetCarpetSqFt);
      row.httpStatus = response.status();
      const failure = page.getByRole('dialog', { name: 'Generation needs attention' });
      if (!response.ok()) {
        await expect(failure).toBeVisible();
        row.generation = await failure.getByRole('alert').innerText();
        throw new Error(String(row.generation));
      }
      const generated = await response.json() as { building: Building; validationReport: { isValid: boolean }; telemetry: { solverLatencyMs: number } };
      const { building } = generated;
      expect(generated.validationReport.isValid).toBe(true);
      if ('survey' in fixture) {
        expect(building.site.plotBoundary.points).toEqual(config.surveyBoundary?.points);
        row.surveyPreservation = 'exact_signed_vertices';
      }
      const floor = building.floors.find(candidate => candidate.apartmentUnits?.length)!;
      expect(floor.apartmentUnits).toHaveLength(flats);
      if ('stilt' in fixture) expect(building.floors.some(candidate => candidate.floorUse === 'STILT_PARKING')).toBe(true);
      row.mandatoryConstraints = 'pass';
      row.generation = 'pass';
      times.solver = generated.telemetry.solverLatencyMs;
      const area = building.metadata.generationReport?.floorAreas?.find(candidate => candidate.floorId === floor.id);
      row.achievedCarpetSqFt = area?.units.map(unit => unit.target?.achievedAreaSqFt ?? unit.carpetMm2 / EXACT_SQMM_PER_SQFT);
      if (strict || fixture.id === 4) expect(area?.units.map(unit => unit.target?.status)).toEqual(Array(flats).fill('ACHIEVED'));
      if (fixture.id === 4) {
        const setbacks = config.setbacksMm!;
        const capacity = (config.plotWidthMm - setbacks.left - setbacks.right)
          * (config.plotDepthMm - setbacks.front - setbacks.rear);
        row.grossFloorM2 = area!.grossMm2 / 1e6;
        expect(area!.grossMm2).toBeLessThan(capacity);
        expect(area!.grossMm2).toBeLessThan(894_540_000);
        expect(area!.voidMm2).toBeLessThan(164_010_550);
      }
      const functional = auditFloorFunctionalQuality(floor);
      row.roomAccessAndCirculation = functional;
      expect(functional.passed, JSON.stringify(functional.findings)).toBe(true);
      row.corridorBoundingBoxSpansMm = floor.rooms.filter(room => room.type === RoomType.Corridor).map(room => {
        const bounds = polygonBoundingBox(room.boundary);
        return { id: room.id, unitId: room.unitId, minimumBoxSpanMm: Math.min(bounds.width, bounds.height) };
      });
      const wallById = new Map(floor.walls.map(wall => [wall.id, wall]));
      const poorFit = [...floor.doors, ...floor.windows].filter(opening => {
        const host = wallById.get(opening.wallId);
        return !host || !openingFitsApartmentWall(host, opening.position, opening.width);
      });
      const furniture = (floor.furniture ?? []).map(item => {
        const origin = { x: item.xMm + item.widthMm / 2, y: item.yMm + item.depthMm / 2 };
        const bounds = rectToPolygon(item.xMm, item.yMm, item.widthMm, item.depthMm);
        return { roomId: item.roomId, boundary: { points: bounds.points.map(point => rotatePoint(point, item.rotationDeg, origin)) } };
      });
      const furnitureDoorIntersections = floor.doors.filter(door => {
        const host = wallById.get(door.wallId);
        const obstacles = furniture.filter(item => door.connectsRooms.includes(item.roomId)).map(item => item.boundary);
        return host && !isDoorSwingClear(door, host, obstacles);
      }).map(door => door.id);
      row.openingClearance = { checkedHostFits: floor.doors.length + floor.windows.length, failedHostFits: poorFit.map(opening => opening.id) };
      row.furnitureInterference = { furnitureCount: furniture.length, doorsWithModeledSwingIntersection: furnitureDoorIntersections };
      expect(poorFit).toEqual([]);
      mark('generation');

      const gallery = page.getByRole('region', { name: 'Massing studies gallery' });
      const preview = gallery.getByRole('img', { name: /Plan preview/ }).first();
      await expect(preview).toBeVisible({ timeout: 45_000 });
      await preview.screenshot({ path: info.outputPath('plan.png') });
      row.visualReview = 'plan_captured';
      {
        const alternative = page.waitForResponse(candidate => candidate.url().endsWith('/api/v1/projects/generate'), { timeout: 100_000 });
        await gallery.getByRole('button', { name: 'Generate Massing Alternative' }).click();
        const alternativeResponse = await alternative;
        row.alternativeHttpStatus = alternativeResponse.status();
        if (alternativeResponse.ok()) {
          const next = (await alternativeResponse.json()).building as Building;
          // The HTTP receipt arrives before the browser worker finishes verification and projection.
          await expect(page.getByRole('dialog', { name: 'Generating your building' })).toBeHidden({ timeout: 45_000 });
          await expect(failure).toBeHidden();
          if (strict) {
            expect(next.metadata.generationReport?.floorAreas?.every(nextFloor => nextFloor.units.length === flats &&
              nextFloor.units.every(unit => unit.target?.status === 'ACHIEVED' && unit.target.tolerancePercent === 3))).toBe(true);
          }
          const comparison = compareCanonicalBuildingAlternatives(building, next);
          row.topologyDiversity = comparison;
          if (comparison.meaningful) {
            await expect(gallery.getByRole('button', { name: /Study 2/ })).toBeVisible();
          } else {
            await expect(gallery.getByRole('status')).toBeVisible();
            await expect(gallery.getByRole('button', { name: /Study 2/ })).toHaveCount(0);
          }
        } else {
          expect(alternativeResponse.status()).toBe(422);
          await expect(failure).toBeVisible();
          row.topologyDiversity = await failure.getByRole('alert').innerText();
          await failure.getByRole('button', { name: 'Close' }).click();
        }
        await gallery.getByRole('button', { name: /Study 1/ }).click();
      }
      await gallery.getByRole('button', { name: 'Open in CAD' }).click();
      row.candidateSelection = 'pass';
      await page.getByRole('button', { name: floor.name, exact: true }).first().click();
      if (fixture.id === 4 || fixture.id === 7) {
        await page.getByTestId('toggle-precision-cad-studio').click();
        const command = page.getByTestId('cad-ai-instruction-input');
        await command.fill('Regenerate only Flat 2 while keeping the remaining flats unchanged');
        const proposalResponse = page.waitForResponse(candidate => candidate.url().endsWith('/api/v1/cad/edit-proposal'));
        await page.getByTestId('cad-ai-preview-btn').click();
        const proposal = (await (await proposalResponse).json()).proposal;
        row.protectedRegeneration = proposal.status;
        expect(proposal.status).toBe('PREVIEW_READY');
        expect(proposal.invarianceProof.passed).toBe(true);
        expect(proposal.invarianceProof.beforeProtectedDigest).toBe(proposal.invarianceProof.afterProtectedDigest);
        row.protectedEntityEquality = true;
        await page.getByTestId('cad-ai-accept-btn').click();
        await expect(page.getByTestId('cad-revision-badge')).toContainText(`Rev ${building.version + 1}`);
        row.cadEditing = 'protected_edit_accepted';
      }
      await page.getByTestId('nav-bim').click();
      const bim = page.getByRole('region', { name: 'RH Planner — BIM Studio' });
      await bim.getByRole('combobox', { name: 'BIM storey' }).selectOption(floor.id);
      await bim.getByRole('combobox', { name: 'BIM schedule' }).selectOption('window');
      await expect(bim.getByRole('table').getByRole('row').nth(1)).toBeVisible();
      await bim.getByRole('table').getByRole('button').first().click();
      await expect(bim.getByRole('region', { name: 'BIM property inspector' })).toBeVisible();
      row.bimSchedule = 'pass';
      mark('bimSchedule');
      const download = page.waitForEvent('download');
      const exportResponse = page.waitForResponse(candidate => candidate.url().endsWith('/api/v1/export/ifc'));
      await bim.getByRole('button', { name: 'Export IFC4' }).click();
      const [file, ifcResponse] = await Promise.all([download, exportResponse]);
      expect(ifcResponse.status()).toBe(200);
      const { manifest } = await ifcResponse.json() as { manifest: IfcExchangeManifest };
      expect(manifest.source).toEqual(ifcResponse.request().postDataJSON().source);
      const bytes = await readFile((await file.path())!);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.artifactSha256);
      row.export = { format: 'IFC4', source: manifest.source, digest: manifest.artifactSha256 };
      mark('ifc');

      await page.getByTestId('nav-isometric').click();
      await page.getByTestId('toggle-view-3d').click();
      await expect(page.getByTestId('isometric-3d-viewport').locator('canvas')).toBeVisible();
      row.floor3d = 'pass';
      mark('floor3d');
      await page.getByTestId('nav-building_3d').click();
      const tower = page.locator('.three-building-scene canvas').first();
      await expect(tower).toHaveAttribute('data-draw-calls', /^[1-9]\d*$/, { timeout: 45_000 });
      row.tower3d = 'pass';
      mark('tower3d');
      const saving = page.waitForResponse(candidate => candidate.request().method() === 'POST' &&
        candidate.url().endsWith('/api/v1/local-projects'));
      await page.getByTestId('topbar-save-local').click();
      expect((await saving).status()).toBe(200);
      await expect(page.getByTestId('local-save-toast')).toContainText('to local disk');
      const restored = await request.get('/api/v1/local-projects/' + building.projectId);
      expect(restored.ok()).toBe(true);
      const saved = await restored.json() as { digest: string; building: Building };
      expect(saved.digest).toBe(manifest.source.sha256);
      expect(saved.building.version).toBe(manifest.source.revision);
      if ('survey' in fixture) expect(saved.building.site.plotBoundary.points).toEqual(config.surveyBoundary?.points);
      await page.reload();
      await expect(page.getByTestId('project-switcher-trigger')).toContainText(fixture.name);
      row.saveReloadAndRevision = 'pass';
      mark('saveReload');
      expect(errors).toEqual([]);
      row.status = 'verified_for_exercised_controls';
    } catch (error) {
      row.status = 'failed';
      row.failure = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      await writeFile(info.outputPath('acceptance.json'), JSON.stringify(row, null, 2));
    }
  });
}

test('enables facade-oriented layout with wet-wall risers in the wizard', async ({ page }, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('argon_studio_store_wizard_v1', JSON.stringify({
    plotWidthM: 38, plotDepthM: 32, floorsCount: 2, hasStiltParking: true, roadFacing: 'South',
    authorityType: 'MUNICIPAL_CORPORATION', congestionZone: 'NON_CONGESTED',
    flatsPerFloor: 4, bhkCounts: { '1BHK': 0, '2BHK': 4, '3BHK': 0, '4BHK': 0 }, aiPrompt: '',
  })));
  await page.goto('/');
  await page.getByTestId('cta-new-construction').click();
  await page.getByLabel('Project Title / Estate', { exact: false }).fill('Wet-wall coordination study');
  for (const step of [2, 3]) await page.getByRole('button', { name: 'Continue to Step 0' + step }).click();
  await page.getByLabel('Core arrangement').selectOption('SPLIT_COURTYARD');
  await page.getByLabel('Number of stairs').selectOption('2');
  await page.getByLabel('Number of lifts').selectOption('2');
  await page.getByLabel('Internal open-to-sky space').selectOption('REQUIRED');
  await page.getByRole('checkbox', { name: 'Prefer exterior living' }).check();
  await page.getByRole('checkbox', { name: 'Reserve shared plumbing shafts outside bathrooms' }).check();
  await page.getByRole('button', { name: 'Continue to Step 04' }).click();
  const request = page.waitForResponse(response => response.url().endsWith('/api/v1/projects/generate'), { timeout: 90_000 });
  await page.getByRole('button', { name: 'Generate Architectural Project' }).click();
  const response = await request;
  expect(response.request().postDataJSON().config.architectureOptions).toMatchObject({ coreArrangement: 'SPLIT_COURTYARD',
    stairCount: 2, liftCount: 2, openToSky: 'REQUIRED', preferExteriorLiving: true, coordinatedWetWallLayout: true });
  expect(response.status()).toBe(200);
  const { building } = await response.json() as { building: Building };
  expect(building.metadata.generationBrief?.coordinatedWetWallLayout).toBe(true);
  expect(building.metadata.generationReport?.selectedVariant).toBe('courtyard:opposed-stair-lift-pairs');
  const floor = building.floors.find(candidate => candidate.apartmentUnits?.length)!;
  expect(floor.rooms.find(room => room.tags.includes('shaft:central-court'))?.openToSky).toBe(true);
  expect(floor.canonicalStaircases).toHaveLength(2);
  const risers = floor.rooms.filter(room => room.tags.includes('plumbing:shared-riser'));
  expect(risers).toHaveLength(2);
  expect(risers.every(riser => !riser.unitId)).toBe(true);
  expect(risers.flatMap(riser => riser.tags.filter(tag => tag.startsWith('plumbing:serves:')))).toHaveLength(8);
  const gallery = page.getByRole('region', { name: 'Massing studies gallery' });
  await expect(gallery.getByRole('img', { name: /Plan preview/ }).first()).toBeVisible({ timeout: 45_000 });
  await gallery.getByRole('img', { name: /Plan preview/ }).first().screenshot({ path: info.outputPath('coordinated-wet-wall-plan.png') });
  await gallery.getByRole('button', { name: 'Open in CAD' }).click();
  await page.getByRole('button', { name: floor.name, exact: true }).first().click();
  await page.getByTestId('toggle-precision-cad-studio').click();
  await page.getByTestId('cad-ai-instruction-input').fill('Regenerate only Flat 2 while keeping the remaining flats unchanged');
  const proposalResponse = page.waitForResponse(candidate => candidate.url().endsWith('/api/v1/cad/edit-proposal'));
  await page.getByTestId('cad-ai-preview-btn').click();
  const proposal = (await (await proposalResponse).json()).proposal;
  expect(proposal.status).toBe('PREVIEW_READY');
  expect(proposal.invarianceProof.passed).toBe(true);
  expect(proposal.invarianceProof.beforeProtectedDigest).toBe(proposal.invarianceProof.afterProtectedDigest);

  await page.getByTestId('nav-bim').click();
  const bim = page.getByRole('region', { name: 'RH Planner — BIM Studio' });
  const ifcResponse = page.waitForResponse(candidate => candidate.url().endsWith('/api/v1/export/ifc'));
  const download = page.waitForEvent('download');
  await bim.getByRole('button', { name: 'Export IFC4' }).click();
  const [ifc, file] = await Promise.all([ifcResponse, download]);
  expect(ifc.status()).toBe(200);
  const { manifest } = await ifc.json() as { manifest: IfcExchangeManifest };
  const exportedRequest = ifc.request().postDataJSON() as { building: Building; source: IfcExchangeManifest['source'] };
  expect(manifest.source).toEqual(exportedRequest.source);
  const ifcBytes = await readFile((await file.path())!);
  expect(createHash('sha256').update(ifcBytes).digest('hex')).toBe(manifest.artifactSha256);
  await Promise.all([
    writeFile(info.outputPath('courtyard.ifc'), ifcBytes),
    writeFile(info.outputPath('courtyard.manifest.json'), JSON.stringify(manifest)),
    writeFile(info.outputPath('courtyard.building.json'), JSON.stringify(exportedRequest.building)),
  ]);
  const riserIds = floor.rooms.filter(room => room.tags.some(tag => tag.startsWith('plumbing:serves:'))).map(room => room.id);
  expect(riserIds.every(id => manifest.elements.some(element => element.canonicalId === id))).toBe(true);
  await bim.getByRole('button', { name: 'Show 3D model' }).click();
  const bimCanvas = bim.getByTestId('bim-model').locator('canvas');
  await expect(bimCanvas).toHaveAttribute('data-visible-floor-count', '1');
  await bim.getByRole('button', { name: 'Explode', exact: true }).click();
  await expect(bimCanvas).toHaveAttribute('data-visible-floor-count', String(building.floors.length));
  await expect(bimCanvas).toHaveAttribute('data-floor-separation-m', /^(?:[1-9]\d*\.\d+|0\.(?!000)\d{3})$/);

  await page.getByTestId('nav-building_3d').click();
  const tower = page.locator('.three-building-scene canvas').first();
  await expect(tower).toHaveAttribute('data-draw-calls', /^[1-9]\d*$/, { timeout: 45_000 });
  await page.getByTestId('tab-furniture').click();
  const cutaway = page.getByTestId('btn-toggle-furniture-cutaway');
  if (await cutaway.getAttribute('aria-pressed') !== 'true') await cutaway.click();
  const dining = page.getByTestId('furniture-opt-dining_set');
  if (await dining.getAttribute('aria-pressed') !== 'true') await dining.click();
  await expect(tower).toHaveAttribute('data-visible-furniture-categories', /dining_set/);
  await dining.click();
  await expect(tower).not.toHaveAttribute('data-visible-furniture-categories', /dining_set/);

  const controls = createGenerationControlState();
  const furniture = floor.furniture ?? [];
  let movement: { item: typeof furniture[number]; expected: typeof furniture[number] } | undefined;
  for (const item of furniture) {
    try {
      const moved = editFurniturePlacement(building, controls, floor.id, item.id, { dxMm: 100 });
      const rotated = editFurniturePlacement(moved, controls, floor.id, item.id, { rotateQuarterTurn: true });
      const expected = rotated.floors.find(candidate => candidate.id === floor.id)?.furniture?.find(candidate => candidate.id === item.id);
      if (expected) {
        movement = { item, expected };
        break;
      }
    } catch { /* Try a piece with sufficient clearance. */ }
  }
  if (!movement) throw new Error('The fixture has no furniture with clearance for the requested move and rotation.');
  const { item: movable, expected } = movement;
  const placement = page.getByRole('region', { name: 'Furniture placement' });
  await placement.getByLabel('Furniture on this floor').selectOption(movable.id);
  await placement.getByRole('button', { name: 'East 100 mm' }).click();
  await expect(placement.getByText(`${Math.round(movable.xMm + 100)} mm east`, { exact: false })).toBeVisible();
  await placement.getByRole('button', { name: 'Rotate 90°' }).click();
  const readback = `${Math.round(expected.xMm)} mm east · ${Math.round(expected.yMm)} mm south · ${expected.rotationDeg}°`;
  await expect(placement.getByText(readback, { exact: true })).toBeVisible();
  await expect(placement.getByRole('status')).toHaveText('Placement applied.');
});

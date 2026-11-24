import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { digestOf } from '../src/services/durable-project-store';
import {
  createGenerationControlState, DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES,
  type Building,
} from '@ai-floor-planner/core';
import { moveApartmentPartition } from '@ai-floor-planner/planning-engine';

async function openCad(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem('rh_welcome_dismissed', 'true'));
  await page.goto('/');
  await page.getByTestId('nav-cad_2d').click();
}

test('a planning worker startup failure clears loading and offers retry', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(...args: Parameters<Worker['postMessage']>) {
        if (Array.isArray(args[0]?.config?.units ?? args[0]?.units)) throw new DOMException('Unable to send planning input', 'DataCloneError');
        super.postMessage(...args);
      }
    };
  });
  await openCad(page);
  await page.getByRole('button', { name: /Generate Massing Variant/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Generation needs attention' });
  await expect(dialog.getByRole('alert')).toContainText('Unable to send planning input');
  await expect(dialog.getByRole('button', { name: 'Retry Generation' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Generate Massing Variant/ })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('regeneration sends the active project identity and a distinct run identifier', async ({ page, context }) => {
  await openCad(page);
  const projectId = await page.evaluate(() => localStorage.getItem('ai_floor_planner_active_id'));
  expect(projectId).toBeTruthy();
  const sending = context.waitForEvent('request', req => req.url().endsWith('/api/v1/projects/generate'));
  await page.getByRole('button', { name: /Generate Massing Variant/ }).click();
  const body = (await sending).postDataJSON();
  expect(body.config.projectId).toBe(projectId);
  expect(body.generationRunId).toMatch(/^[0-9a-f-]{36}$/);
  expect(body.generationRunId).not.toBe(projectId);
});

async function durableProject(page: Page) {
  return page.evaluate(async () => {
    const projectId = localStorage.getItem('ai_floor_planner_active_id');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('rh_planner_projects');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const stored = await new Promise<{ payload: string } | undefined>((resolve, reject) => {
        const read = db.transaction('projects').objectStore('projects').get(projectId ?? '');
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
      return stored && JSON.parse(stored.payload);
    } finally {
      db.close();
    }
  });
}

test('a real IndexedDB abort leaves work open and a manual retry persists it', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    const state = window as Window & { abortNextProjectWrite?: boolean };
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      const request = put.apply(this, args);
      if (this.name === 'projects' && state.abortNextProjectWrite) {
        state.abortNextProjectWrite = false;
        this.transaction.abort();
      }
      return request;
    };
  });
  await openCad(page);
  await expect.poll(() => durableProject(page)).toBeTruthy();
  const original = await durableProject(page);
  await page.evaluate(() => { (window as Window & { abortNextProjectWrite?: boolean }).abortNextProjectWrite = true; });
  await page.getByTestId('project-switcher-trigger').click();
  await page.getByRole('button', { name: 'Save Revision' }).click();
  await expect(page.getByText(/Browser save failed/)).toBeVisible({ timeout: 5000 });
  expect(await durableProject(page)).toEqual(original);
  await page.getByRole('button', { name: 'Retry browser save' }).click();
  await expect(page.getByText(/Browser save failed/)).toBeHidden();
  await expect.poll(async () => (await durableProject(page)).updatedAt).not.toBe(original.updatedAt);
  await page.reload();
  expect((await durableProject(page)).building).toEqual(original.building);
});

async function seedWizard(page: Page, width: number, depth: number, floors: number, hasStiltParking = true, aiPrompt?: string) {
  await page.addInitScript(({ width, depth, floors, hasStiltParking, aiPrompt }) => {
    localStorage.setItem('argon_studio_store_wizard_v1', JSON.stringify({
      plotWidthM: width, plotDepthM: depth, floorsCount: floors, hasStiltParking, roadFacing: 'South',
      ...(aiPrompt ? { aiPrompt } : {}),
      authorityType: 'MUNICIPAL_CORPORATION', congestionZone: 'NON_CONGESTED',
      bhkCounts: { '1BHK': 0, '2BHK': 4, '3BHK': 0, '4BHK': 0 },
    }));
  }, { width, depth, floors, hasStiltParking, aiPrompt });
}

test('a verified generated revision keeps project identity and archives the previous IndexedDB data', async ({ page, context }) => {
  await seedWizard(page, 32, 36, 2, false);
  await openCad(page);
  await expect.poll(() => durableProject(page)).toBeTruthy();
  const before = await durableProject(page);
  const response = context.waitForEvent('response', answer => answer.url().endsWith('/api/v1/projects/generate'));
  await page.getByTestId('cad-variant-COMPACT_DOUBLE_LOADED').click();
  const generated = await response;
  expect(generated.status(), 'production planner must accept the fixture').toBe(200);
  await expect.poll(async () => (await durableProject(page)).building.metadata.generationRunId, {
    timeout: 45_000,
  }).toMatch(/^[0-9a-f-]{36}$/);
  const after = await durableProject(page);
  expect(after.projectId).toBe(before.projectId);
  expect(after.building.id).toBe(before.building.id);
  expect(after.building.floors.every((floor: { buildingId: string }) => floor.buildingId === before.building.id)).toBe(true);
  expect(after.building.version).toBe(before.building.version + 1);
  await page.reload();
  await page.getByTestId('nav-library').click();
  const library = page.getByTestId('project-library-view');
  await library.getByText('Archived browser revisions').click();
  const downloaded = page.waitForEvent('download');
  await library.getByRole('button', { name: `Export revision ${before.building.version}`, exact: true }).click();
  const archive = await downloaded;
  const recovered = JSON.parse(await readFile((await archive.path())!, 'utf8'));
  expect(recovered.building).toEqual(before.building);
  expect((await durableProject(page)).building).toEqual(after.building);
});

test('edits a hosted window, enforces its floor lock and saves the exact undoable revision', async ({ page }) => {
  await seedWizard(page, 32, 36, 2, false);
  await openCad(page);
  const response = page.waitForResponse(answer => answer.url().endsWith('/api/v1/projects/generate'));
  await page.getByTestId('cad-variant-COMPACT_DOUBLE_LOADED').click();
  expect((await response).status()).toBe(200);
  await expect.poll(async () => (await durableProject(page))?.building.metadata.generationRunId,
    { timeout: 45_000 }).toMatch(/^[0-9a-f-]{36}$/);
  const original = (await durableProject(page)).building as import('@ai-floor-planner/core').Building;
  const floor = original.floors.find(item => item.apartmentUnits?.length)!;
  const window = floor.windows.find(opening => opening.width >= 1100 && floor.rooms.some(room =>
    room.id === opening.roomId && room.unitId && !room.isFixed) &&
    floor.walls.some(wall => wall.id === opening.wallId && !wall.arc && wall.roomIds.length === 1))!;

  await page.getByTestId('nav-edit_plan').click();
  await page.getByLabel('Edit Plan Floors').getByRole('button', { name: floor.name, exact: true }).click();
  await page.getByText('Doors and windows', { exact: true }).click();
  await page.getByLabel('Opening', { exact: true }).selectOption(window.id);
  await page.getByLabel('Opening width (mm)').fill(String(window.width - 40));
  await page.getByRole('button', { name: 'Lock floor', exact: true }).click();
  await page.getByRole('button', { name: 'Preview opening' }).click();
  await expect(page.getByRole('alert')).toContainText('Unlock the floor');
  await page.getByRole('button', { name: 'Unlock floor', exact: true }).click();
  await page.getByRole('button', { name: 'Preview opening' }).click();
  await expect(page.getByRole('region', { name: 'Preview local regeneration' })).toContainText('1 openings affected');
  const editedUnit = floor.rooms.find(room => room.id === window.roomId)?.unitId;
  const areaTarget = original.metadata.generationReport?.floorAreas?.find(area => area.floorId === floor.id)
    ?.units.find(unit => unit.unitId === editedUnit)?.target;
  expect(areaTarget?.status).toBe('TARGET_NOT_MET');
  await expect(page.getByRole('list', { name: 'Area advisories' })).toContainText('requested 850 sq ft');
  expect((await durableProject(page)).building).toEqual(original);
  await page.getByRole('button', { name: 'Lock floor', exact: true }).click();
  await page.getByRole('button', { name: 'Accept preview' }).click();
  await expect(page.getByRole('alert')).toContainText('Plan or constraints changed');
  expect((await durableProject(page)).building).toEqual(original);
  await page.getByRole('button', { name: 'Unlock floor', exact: true }).click();
  await page.getByRole('button', { name: 'Preview opening' }).click();
  await page.getByRole('button', { name: 'Accept preview' }).click();
  await expect(page.getByText('Edit hosted opening applied.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await durableProject(page)).building.version).toBe(original.version + 1);
  const edited = (await durableProject(page)).building as import('@ai-floor-planner/core').Building;
  expect(edited.floors.find(item => item.id === floor.id)?.windows.find(item => item.id === window.id)?.width).toBe(window.width - 40);
  expect(edited.floors.filter(item => item.id !== floor.id)).toEqual(original.floors.filter(item => item.id !== floor.id));

  await page.getByTestId('edit-plan-undo').click();
  await expect.poll(async () => (await durableProject(page)).building).toEqual(original);
  await page.getByTestId('edit-plan-redo').click();
  await expect.poll(async () => (await durableProject(page)).building).toEqual(edited);

  await page.getByTestId('nav-export').click();
  const glb = page.waitForResponse(answer => answer.url().endsWith('/api/v1/export/glb'));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download building GLB' }).click();
  const exported = await glb;
  expect(exported.status()).toBe(200);
  expect(exported.request().postDataJSON().building).toEqual(edited);
  expect(exported.headers()['x-building-revision']).toBe(String(edited.version));
  const artifact = await download;
  const bytes = await readFile((await artifact.path())!);
  expect(artifact.suggestedFilename()).toMatch(/\.glb$/);
  expect(bytes.subarray(0, 4).toString()).toBe('glTF');
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  await page.reload();
  expect((await durableProject(page)).building).toEqual(edited);

});

test('moves a supported apartment partition by exactly 50 mm in the production editor', async ({ page }) => {
  const projectId = 'browser-partition-edit';
  const generation = await page.request.post('/api/v1/projects/generate', { data: { config: {
    projectId, projectName: 'Partition edit fixture', structuralLayoutMode: 'DEFERRED',
    plotWidthMm: 42000, plotDepthMm: 34000, roadWidthMm: 12000, roadAccessSides: ['south'],
    jurisdiction: 'pune_pmc', lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    verticalStackType: 'STILT_PLUS_N', numTypicalFloors: 1, floorToFloorHeightMm: 3150, stiltHeightMm: 3150,
    flatsPerFloor: 4, units: Array.from({ length: 4 }, (_, index) => ({
      unitIndex: index + 1, bhkType: '2BHK', hasUtilityBalcony: true,
    })),
    setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
    parkingMode: 'STILT_AND_SURFACE', siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES, terraceAmenities: DEFAULT_TERRACE_AMENITIES,
  } } });
  expect(generation.status()).toBe(200);
  const { building: initial } = await generation.json() as { building: Building };
  const saved = await page.request.post('/api/v1/local-projects', {
    data: { projectId, name: initial.name, building: initial },
  });
  expect(saved.ok()).toBe(true);
  await openCad(page);
  await page.getByTestId('nav-library').click();
  await page.getByTestId('open-disk-project-' + projectId).click();
  await expect.poll(async () => (await durableProject(page))?.projectId).toBe(projectId);
  const before = (await durableProject(page)).building as Building;
  const floor = before.floors.find(item => item.apartmentUnits?.length)!;
  const refusals = new Set<string>();
  const movable = floor.walls.find(wall => {
    if (wall.wallUse !== 'INTERNAL_PARTITION' || wall.roomIds.length !== 2) return false;
    try {
      moveApartmentPartition(before, createGenerationControlState(), floor.id, wall.id, 50);
      return true;
    } catch (error) {
      refusals.add(error instanceof Error ? error.message : String(error));
      return false;
    }
  });
  expect(movable, [...refusals].join('\n')).toBeDefined();
  await page.getByTestId('nav-edit_plan').click();
  await page.getByLabel('Edit Plan Floors').getByRole('button', { name: floor.name, exact: true }).click();
  await page.getByText('Move partition', { exact: true }).click();
  await page.getByLabel('Interior partition', { exact: true }).selectOption(movable!.id);
  await page.getByLabel('Partition offset (mm)', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Preview partition move' }).click();
  const preview = page.getByRole('region', { name: 'Preview local regeneration' });
  await expect(preview.getByRole('img')).toBeVisible();
  await expect(preview).toContainText('room boundary');
  expect((await durableProject(page)).building).toEqual(before);
  await preview.getByRole('button', { name: 'Discard preview' }).click();
  await expect(preview).toBeHidden();
  await page.getByRole('button', { name: 'Preview partition move' }).click();
  await page.getByRole('button', { name: 'Accept preview' }).click();
  await expect(page.getByText('Partition moved.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await durableProject(page)).building.version).toBe(before.version + 1);
  const revision = (await durableProject(page)).building as Building;
  const moved = revision.floors.find(item => item.id === floor.id)?.walls.find(wall => wall.id === movable!.id)!;
  const axis = movable!.startPoint.x === movable!.endPoint.x ? 'x' : 'y';
  expect(moved.startPoint[axis] - movable!.startPoint[axis]).toBe(50);
  expect(revision.floors.filter(item => item.id !== floor.id)).toEqual(before.floors.filter(item => item.id !== floor.id));
});

test('the production studio surfaces mandatory circulation rejection without replacing the current design', async ({ page }) => {
  await seedWizard(page, 42, 34, 1, true, 'Provide three stairs.');
  await openCad(page);
  await expect.poll(() => durableProject(page)).toBeTruthy();
  const before = await durableProject(page);
  await page.getByRole('button', { name: /Generate Massing Variant/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Generation needs attention' });
  await expect(dialog.getByRole('alert')).toContainText('Required design checks failed', { timeout: 45_000 });
  expect(await durableProject(page)).toEqual(before);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: /Generate Massing Variant/ })).toBeEnabled();
});

test('upgrades an existing v1 IndexedDB project without altering its payload', async ({ page }) => {
  await openCad(page);
  await expect.poll(() => durableProject(page)).toBeTruthy();
  const original = await durableProject(page);
  const legacy = { ...original, name: 'Preserve this legacy project' };
  const payload = JSON.stringify(legacy);
  await page.route('**/repair-seed', route => route.fulfill({ contentType: 'text/html', body: '<title>IndexedDB seed</title>' }));
  await page.goto('/repair-seed');
  await page.evaluate(async ({ projectId, payload, digest }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('rh_planner_projects');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Test database is still open'));
    });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('rh_planner_projects', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('projects', { keyPath: 'projectId' });
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite');
      tx.objectStore('projects').put({ projectId, payload, digest, updatedAt: new Date().toISOString(), byteLength: payload.length });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, { projectId: legacy.projectId, payload, digest: digestOf(payload) });
  await page.goto('/');
  await expect(page.getByTestId('project-switcher-trigger')).toContainText(legacy.name);
  expect(await durableProject(page)).toEqual(legacy);
  const stores = await page.evaluate(() => new Promise<{ version: number; stores: string[] }>((resolve, reject) => {
    const open = indexedDB.open('rh_planner_projects');
    open.onsuccess = () => {
      const db = open.result;
      resolve({ version: db.version, stores: [...db.objectStoreNames] });
      db.close();
    };
    open.onerror = () => reject(open.error);
  }));
  expect(stores).toEqual({ version: 2, stores: ['projectRevisions', 'projects'] });
});

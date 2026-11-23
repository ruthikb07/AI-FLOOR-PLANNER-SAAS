import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { digestOf } from '../src/services/durable-project-store';

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

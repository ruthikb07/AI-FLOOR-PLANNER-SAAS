import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { canonicalBuildingHash, createBuilding } from '@ai-floor-planner/core';
import type { LoadedLocalProject } from '../services/local-project-store.js';
import { createBackendServer } from '../server.js';

const server = createBackendServer({ gemini: null, briefInterpreterKind: 'local-stub' });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-compare-save-'));
let endpoint: string;

beforeAll(async () => {
  vi.stubEnv('RH_LOCAL_PROJECTS_DIR', root);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/local-projects`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

function save(payload: object) {
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

const receiptJson = async (response: Response) => await response.json() as LoadedLocalProject;

const building = createBuilding({
  projectId: 'compare-save',
  name: 'Original',
  site: { plotWidth: 12000, plotDepth: 14000 },
  floors: [{ buildingId: '', level: 0, name: 'Ground' }],
});

it('keeps canonical identity, rejects stale writers and replays an identical request without a duplicate revision', async () => {
  const first = await save({ building });
  expect(first.status).toBe(200);
  const base = await receiptJson(first);
  const expected = { revision: base.revision, digest: canonicalBuildingHash(base.building) };
  const edit = { building: { ...building, name: 'Accepted', version: building.version + 1 }, expected };
  const competing = { building: { ...edit.building, name: 'Stale' }, expected };
  const replies = await Promise.all([save(edit), save(competing)]);
  expect(replies.map(response => response.status).sort()).toEqual([200, 409]);
  const receipt = await receiptJson(replies.find(response => response.ok)!);
  const accepted = receipt.building.name === edit.building.name ? edit : competing;
  expect(receipt.building).toEqual(accepted.building);
  expect(receipt.digest).toBe(canonicalBuildingHash(accepted.building));

  const replayResponse = await save(accepted);
  expect(replayResponse.status).toBe(200);
  expect((await receiptJson(replayResponse)).revision).toBe(receipt.revision);
  expect((await save({ building: { ...building, name: 'Unconditional overwrite' } })).status).toBe(409);
  expect((await save({ building: competing.building, expected: { ...expected, digest: 'invalid' } })).status).toBe(400);
  const archived = await receiptJson(await fetch(`${endpoint}/${building.projectId}?revision=${base.revision}`));
  expect(archived.building).toEqual(building);
});

it('recovers from a revision write interrupted before manifest publication', async () => {
  const initial = { ...building, projectId: 'interrupted' };
  const first = await receiptJson(await save({ building: initial }));
  const expected = { revision: first.revision, digest: canonicalBuildingHash(first.building) };
  const revisionPath = path.join(root, initial.projectId, 'revisions', `rev-${first.revision + 1}.json`);
  fs.writeFileSync(revisionPath, JSON.stringify({ ...initial, name: 'Interrupted candidate' }));
  const url = `${endpoint}/${initial.projectId}`;
  expect((await fetch(`${url}?revision=${first.revision + 1}`)).status).toBe(404);
  expect((await receiptJson(await fetch(url))).building).toEqual(first.building);
  const retry = { ...initial, version: initial.version + 1, name: 'Recovered candidate' };
  const response = await save({ building: retry, expected });
  expect(response.status).toBe(200);
  expect((await receiptJson(await fetch(url))).building).toEqual(retry);
});

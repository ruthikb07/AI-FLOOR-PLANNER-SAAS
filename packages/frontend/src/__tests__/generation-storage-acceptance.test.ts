/**
 * ACCEPTANCE — generation storage, end to end.
 *
 * Exercises the seven acceptance criteria for the storage repair against a
 * REAL generated building from the production planning pipeline, not a fixture:
 *
 *   1. the floor plan generates;
 *   2. the canonical manifest is persisted;
 *   3. the project survives a page reload;
 *   4. the geometry is identical after reopening;
 *   5. CAD and 3D export can reach the correct revision;
 *   6. several new projects do not trigger a quota error;
 *   7. error recovery does not delete prior projects.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  Direction,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  serializeBuilding,
  type Building,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { solveMultiSheetApartmentProject } from '@ai-floor-planner/planning-engine';
import {
  LocalStorageProjectStorage,
  hydrateProjectStorage,
  CURRENT_PROJECT_SCHEMA_VERSION,
  type ProjectEnvelope,
} from '../services/storage';
import { projectStore, setIdbFactoryForTests } from '../services/durable-project-store';
import { FakeIdb } from './helpers/fake-indexeddb';

function installLocalStorage(quotaBytes = 5 * 1024 * 1024): Record<string, string> {
  const store: Record<string, string> = {};
  const used = () => Object.values(store).reduce((sum, v) => sum + v.length, 0);
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      if (used() - (store[key]?.length ?? 0) + value.length > quotaBytes) {
        const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error;
      }
      store[key] = value;
    },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    length: 0,
  } as unknown as Storage;
  Object.defineProperty(globalThis.localStorage, 'length', {
    get: () => Object.keys(store).length, configurable: true,
  });
  return store;
}

/** The reference brief: G+4, four 2BHK flats on 40 x 50 m. */
function config(projectId: string, floors = 4): MultiSheetApartmentConfig {
  return {
    projectId,
    projectName: `Acceptance ${projectId}`,
    aiPrompt: 'Four 2BHK flats with a central circulation core, bedroom balconies and bathroom ventilation.',
    structuralLayoutMode: 'DEFERRED',
    plotWidthMm: 40000,
    plotDepthMm: 50000,
    roadWidthMm: 12000,
    roadAccessSides: [Direction.North],
    setbacksMm: { front: 4500, rear: 3000, left: 3000, right: 3000 },
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'generic_maharashtra',
    verticalStackType: 'G_PLUS_N',
    numTypicalFloors: floors,
    flatsPerFloor: 4,
    units: [1, 2, 3, 4].map(n => ({ unitIndex: n, bhkType: '2BHK' as const, hasUtilityBalcony: true })),
    floorToFloorHeightMm: 3150,
    stiltHeightMm: 3150,
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
  };
}

function envelopeFor(building: Building, name: string): ProjectEnvelope {
  return {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    projectId: building.projectId,
    name,
    createdAt: building.createdAt,
    updatedAt: new Date().toISOString(),
    building,
    requiredRoomCounts: {},
    category: 'residential',
    status: 'GENERATED',
  };
}

describe('ACCEPTANCE: a generated plan is saved, reloaded and exportable', () => {
  beforeEach(() => {
    installLocalStorage();
    projectStore.reset();
  });

  afterEach(() => {
    setIdbFactoryForTests(undefined);
    projectStore.reset();
  });

  it('generates, persists, reloads and preserves the plan exactly', async () => {
    const idb = new FakeIdb();
    setIdbFactoryForTests(idb);
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();

    // 1. The floor plan generates.
    const solved = solveMultiSheetApartmentProject(config('accept-reference'));
    expect(solved.building.floors.length).toBeGreaterThan(0);
    const residential = solved.building.floors.filter(f => f.apartmentUnits?.length);
    expect(residential.length).toBe(4);

    const serializedSize = serializeBuilding(solved.building).length;
    // The real payload is far beyond what localStorage could hold alongside
    // another project, which is the defect this repair addresses.
    expect(serializedSize).toBeGreaterThan(500_000);

    // 2. The canonical manifest is persisted durably.
    const outcome = storage.save(envelopeFor(solved.building, 'Reference project'));
    const result = await outcome.durable;
    expect(result.state).toBe('SAVED');
    expect(await storage.verify('accept-reference')).toEqual({ ok: true });

    const beforeReload = serializeBuilding(storage.load('accept-reference')!.building);

    // 3. The project survives a page reload: the mirror is discarded and
    //    rehydrated from the same durable database.
    projectStore.reset();
    setIdbFactoryForTests(idb);
    await hydrateProjectStorage();

    const reopened = new LocalStorageProjectStorage().load('accept-reference');
    expect(reopened).not.toBeNull();
    expect(reopened!.name).toBe('Reference project');

    // 4. The geometry is byte-identical after reopening.
    expect(serializeBuilding(reopened!.building)).toBe(beforeReload);
    expect(reopened!.building.floors.filter(f => f.apartmentUnits?.length)).toHaveLength(4);

    // 5. Export consumers can reach the correct revision: the identity and
    //    version a CAD or 3D export binds to round-trip unchanged.
    expect(reopened!.building.id).toBe(solved.building.id);
    expect(reopened!.building.projectId).toBe(solved.building.projectId);
    expect(reopened!.building.version).toBe(solved.building.version);
    expect(reopened!.building.metadata.projectId).toBe(solved.building.metadata.projectId);
    // Bedroom balcony schedule is metadata the export pipeline reads.
    expect(reopened!.building.metadata.bedroomBalconySchedule?.length)
      .toBe(solved.building.metadata.bedroomBalconySchedule?.length);
  }, 300_000);

  it('stores several generated projects without a quota error', async () => {
    setIdbFactoryForTests(new FakeIdb());
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();

    // 6. Two G+4 projects used to exhaust the 5 MB budget. Four must succeed.
    for (let i = 0; i < 4; i++) {
      const solved = solveMultiSheetApartmentProject(config(`accept-multi-${i}`, 4));
      const result = await storage.save(envelopeFor(solved.building, `Project ${i}`)).durable;
      expect(result.state, `project ${i}`).toBe('SAVED');
    }

    expect(storage.list()).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(storage.load(`accept-multi-${i}`)?.name).toBe(`Project ${i}`);
    }
  }, 600_000);

  it('does not delete prior projects when a later save fails', async () => {
    const idb = new FakeIdb();
    setIdbFactoryForTests(idb);
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();

    const first = solveMultiSheetApartmentProject(config('accept-keep', 2));
    await storage.save(envelopeFor(first.building, 'Keep me')).durable;
    const keptGeometry = serializeBuilding(storage.load('accept-keep')!.building);

    // 7. The next save fails. Recovery must leave existing work untouched.
    (idb as unknown as { options: { failNextWrite?: boolean } }).options.failNextWrite = true;
    const second = solveMultiSheetApartmentProject(config('accept-fails', 2));
    const failure = await storage.save(envelopeFor(second.building, 'Doomed')).durable;
    expect(failure.state).toBe('FAILED');

    expect(storage.load('accept-keep')?.name).toBe('Keep me');
    expect(serializeBuilding(storage.load('accept-keep')!.building)).toBe(keptGeometry);
    // And the failed project is still usable in this session, not discarded.
    expect(failure.inMemory).toBe(true);
    expect(storage.load('accept-fails')?.name).toBe('Doomed');
  }, 300_000);
});

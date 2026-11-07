import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocalStorageProjectStorage,
  createCanonical30x50_2BHK,
  createEmptyPlot,
  parseAndValidateProjectJson,
} from '../services/storage';
import { createGenerationControlState, serializeBuilding, updateGenerationControl, type CandidatePlan } from '@ai-floor-planner/core';
import { diagnosticsToValidation } from '@ai-floor-planner/planning-engine';

describe('Frontend Persistence & Storage Service', () => {
  let storage: LocalStorageProjectStorage;

  // Simple in-memory mock for localStorage in testing environment
  const mockStore: Record<string, string> = {};
  beforeEach(() => {
    storage = new LocalStorageProjectStorage();
    for (const key of Object.keys(mockStore)) delete mockStore[key];

    globalThis.localStorage = {
      getItem: (key: string) => mockStore[key] ?? null,
      setItem: (key: string, val: string) => { mockStore[key] = val; },
      removeItem: (key: string) => { delete mockStore[key]; },
      clear: () => { for (const key of Object.keys(mockStore)) delete mockStore[key]; },
      key: (i: number) => Object.keys(mockStore)[i] ?? null,
      length: 0,
    } as any;
    Object.defineProperty(globalThis.localStorage, 'length', {
      get: () => Object.keys(mockStore).length,
    });
  });

  it('creates and saves canonical 30x50 2BHK plan', () => {
    const building = createCanonical30x50_2BHK();
    expect(building.floors[0]!.rooms.length).toBe(6);
    expect(building.site.plotWidth).toBe(9144);
    expect(building.site.plotDepth).toBe(15240);
    const validation = diagnosticsToValidation(building, {
      requiredRoomCounts: {
        living: 1,
        dining: 1,
        kitchen: 1,
        bedroom: 2,
        bathroom: 1,
      },
    });
    expect(validation.isValid).toBe(true);
    expect(validation.failed).toBe(0);

    storage.save({
      schemaVersion: 1,
      projectId: building.projectId,
      name: building.name,
      createdAt: building.createdAt,
      updatedAt: building.updatedAt,
      building,
    });

    const loaded = storage.load(building.projectId);
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('Canonical 30×50 2BHK');
    expect(loaded?.building.floors[0]!.rooms.length).toBe(6);
    expect(loaded?.category).toBe('residential');
    expect(loaded?.status).toBe('CONCEPT');
  });

  it('lists honest project-shell metadata and activates only stored projects', () => {
    const building = createCanonical30x50_2BHK('Project Shell Test', 'project-shell-test');
    storage.save({
      schemaVersion: 3,
      projectId: building.projectId,
      name: building.name,
      createdAt: building.createdAt,
      updatedAt: '2026-08-30T00:00:00.000Z',
      building,
      category: 'educational',
      status: 'CONCEPT',
    });

    expect(storage.list()).toEqual([expect.objectContaining({
      id: 'project-shell-test',
      category: 'educational',
      status: 'CONCEPT',
      floorCount: 1,
      roomCount: 6,
      plotWidth: 9144,
      plotDepth: 15240,
    })]);
    expect(storage.setActiveProjectId('project-shell-test')).toBe(true);
    expect(storage.setActiveProjectId('missing-project')).toBe(false);
  });

  it('creates unique canonical projects unless an explicit id is supplied', () => {
    const first = createCanonical30x50_2BHK('First', 'first-project');
    const second = createCanonical30x50_2BHK('Second', 'second-project');
    expect(first.projectId).toBe('first-project');
    expect(second.projectId).toBe('second-project');
    expect(first.projectId).not.toBe(second.projectId);
  });

  it('creates empty plot building', () => {
    const custom = createEmptyPlot(12000, 18000, 'Custom Villa');
    expect(custom.site.plotWidth).toBe(12000);
    expect(custom.site.plotDepth).toBe(18000);
    expect(custom.floors[0]!.rooms.length).toBe(0);
  });

  it('validates and parses valid project JSON', () => {
    const building = createCanonical30x50_2BHK();
    const jsonStr = JSON.stringify({
      schemaVersion: 1,
      projectId: 'p123',
      name: 'Import Test',
      building: JSON.parse(serializeBuilding(building)),
    });

    const envelope = parseAndValidateProjectJson(jsonStr);
    expect(envelope.name).toBe('Import Test');
    expect(envelope.building.floors[0]!.rooms.length).toBe(6);
  });

  it('rejects malformed or invalid JSON safely', () => {
    expect(() => parseAndValidateProjectJson('invalid json string')).toThrow('Invalid JSON file format.');
    expect(() => parseAndValidateProjectJson('{}')).toThrow();
  });

  it('migrates legacy residential projects to a reviewable derived space program', () => {
    const building = createCanonical30x50_2BHK('Legacy', 'legacy-program');
    localStorage.setItem('ai_floor_planner_proj_legacy-program', JSON.stringify({
      schemaVersion: 4,
      projectId: building.projectId,
      name: building.name,
      createdAt: building.createdAt,
      updatedAt: building.updatedAt,
      category: 'residential',
      building,
    }));

    const loaded = storage.load('legacy-program');
    expect(loaded?.schemaVersion).toBe(9);
    expect(loaded?.spaceProgram?.provenance).toBe('DERIVED_FROM_EXISTING_DESIGN');
    expect(loaded?.spaceProgram?.items.length).toBeGreaterThan(0);
  });

  it('persists explicit space programs and preserves them during editor-only saves', () => {
    const building = createEmptyPlot(12_000, 18_000, 'Program persistence');
    const spaceProgram = {
      schemaVersion: 1 as const,
      category: 'commercial' as const,
      provenance: 'USER_DEFINED' as const,
      updatedAt: '2026-08-31T00:00:00.000Z',
      items: [],
    };
    const base = {
      schemaVersion: 7,
      projectId: building.projectId,
      name: building.name,
      createdAt: building.createdAt,
      updatedAt: building.updatedAt,
      category: 'commercial' as const,
      building,
      spaceProgram,
    };
    storage.save(base);
    storage.save({ ...base, name: 'Editor changed name', spaceProgram: undefined });

    expect(storage.load(building.projectId)?.spaceProgram).toEqual(spaceProgram);
  });

  it('migrates existing floor boundaries to a limited custom footprint without changing geometry', () => {
    const building = createCanonical30x50_2BHK('Legacy footprint', 'legacy-footprint');
    const originalBoundary = building.floors[0]!.boundary;
    localStorage.setItem('ai_floor_planner_proj_legacy-footprint', JSON.stringify({
      schemaVersion: 5, projectId: building.projectId, name: building.name,
      createdAt: building.createdAt, updatedAt: building.updatedAt,
      category: 'residential', building,
    }));
    const loaded = storage.load('legacy-footprint');
    expect(loaded?.footprintIntent?.shape).toBe('custom');
    expect(loaded?.footprintIntent?.provenance).toBe('DERIVED_FROM_EXISTING_FLOOR');
    expect(loaded?.building.floors[0]!.boundary).toEqual(originalBoundary);
  });

  it('preserves a committed footprint through saves that omit Footprint intent', () => {
    const building = createEmptyPlot(12_000, 18_000, 'Footprint persistence');
    const base = { schemaVersion: 7, projectId: building.projectId, name: building.name, createdAt: building.createdAt, updatedAt: building.updatedAt, category: 'commercial' as const, building };
    storage.save(base);
    const intent = storage.load(building.projectId)!.footprintIntent!;
    storage.save({ ...base, footprintIntent: intent });
    storage.save({ ...base, name: 'Editor update', footprintIntent: undefined });
    expect(storage.load(building.projectId)?.footprintIntent).toEqual(intent);
  });

  it('persists generated alternatives and preserves them during editor saves', () => {
    const building = createEmptyPlot(12_000, 18_000, 'Generation persistence');
    const candidate = { id: 'candidate-a', name: 'Option A', building } as unknown as CandidatePlan;
    const base = { schemaVersion: 7, projectId: building.projectId, name: building.name, createdAt: building.createdAt, updatedAt: building.updatedAt, category: 'residential' as const, building };
    storage.save({ ...base, generationSession: { schemaVersion: 1, generatedAt: '2026-09-01T00:00:00.000Z', selectedCandidateId: candidate.id, candidates: [candidate] } });
    storage.save({ ...base, name: 'Editor save', generationSession: undefined });
    const loaded = storage.load(building.projectId)?.generationSession;
    expect(loaded?.selectedCandidateId).toBe('candidate-a');
    expect(loaded?.candidates[0]?.building.projectId).toBe(building.projectId);
  });

  it('clears stale alternatives when an upstream workflow save uses the invalidation tombstone', () => {
    const building = createEmptyPlot(12_000, 18_000, 'Generation invalidation');
    const candidate = { id: 'candidate-a', name: 'Option A', building } as unknown as CandidatePlan;
    const base = { schemaVersion: 7, projectId: building.projectId, name: building.name, createdAt: building.createdAt, updatedAt: building.updatedAt, category: 'residential' as const, building };
    storage.save({ ...base, generationSession: { schemaVersion: 1, generatedAt: '2026-09-01T00:00:00.000Z', candidates: [candidate] } });
    storage.save({ ...base, generationSession: null });
    expect(storage.load(building.projectId)?.generationSession).toBeUndefined();
  });

  it('persists professional room and floor locks across save and reload', () => {
    const building = createCanonical30x50_2BHK('Locked plan', 'locked-plan');
    const floor = building.floors[0]!; const room = floor.rooms[0]!;
    const generationControl = updateGenerationControl(createGenerationControlState('2026-09-01T00:00:00.000Z'), { lockedEntityIds: [room.id], lockedFloorIds: [floor.id] }, '2026-09-01T00:00:01.000Z');
    storage.save({ schemaVersion: 8, projectId: building.projectId, name: building.name, createdAt: building.createdAt, updatedAt: building.updatedAt, building, generationControl });
    expect(storage.load(building.projectId)?.generationControl).toMatchObject({ lockedEntityIds: [room.id], lockedFloorIds: [floor.id], footprintLocked: true });
  });

  it('cleans orphan lock references on load without rejecting the project', () => {
    const building = createCanonical30x50_2BHK('Orphan locks', 'orphan-locks');
    localStorage.setItem('ai_floor_planner_proj_orphan-locks', JSON.stringify({
      schemaVersion: 8, projectId: building.projectId, name: building.name,
      createdAt: building.createdAt, updatedAt: building.updatedAt, building,
      generationControl: updateGenerationControl(createGenerationControlState(), { lockedEntityIds: ['deleted-room'], lockedFloorIds: ['deleted-floor'], protectedCoreIds: ['deleted-core'] }),
    }));
    expect(storage.load(building.projectId)?.generationControl).toMatchObject({ lockedEntityIds: [], lockedFloorIds: [], protectedCoreIds: [] });
  });
});

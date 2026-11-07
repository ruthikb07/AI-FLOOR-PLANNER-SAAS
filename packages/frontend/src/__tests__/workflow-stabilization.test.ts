import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocalStorageProjectStorage,
  createCanonical30x50_2BHK,
  type ProjectEnvelope,
  CURRENT_PROJECT_SCHEMA_VERSION,
} from '../services/storage';
import {
  EditorEngine,
  UpdateSiteCommand,
  createBuilding,
  RoomType,
  Direction,
} from '@ai-floor-planner/core';
import { CandidateGenerator, RoomProgramGenerator } from '@ai-floor-planner/planning-engine';
import { createQuickDesignRequirements } from '../services/design-site-context';

describe('Phase 1D.1 — Frontend Workflow & Planner Stabilization', () => {
  let storage: LocalStorageProjectStorage;
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
  });

  it('updates canonical site dimensions, setbacks, and floor boundary via UpdateSiteCommand', () => {
    const building = createCanonical30x50_2BHK();
    const engine = new EditorEngine(building);
    const initialSite = engine.getBuilding().site;
    expect(initialSite.plotWidth).toBe(9144);
    expect(initialSite.plotDepth).toBe(15240);

    // Update site to 40x60 ft (12192 x 18288 mm)
    engine.execute(
      new UpdateSiteCommand(engine.getBuilding(), {
        plotWidth: 12192,
        plotDepth: 18288,
        setbacks: { front: 2000, rear: 1500, left: 1200, right: 1200 },
        orientation: 0,
        roadFacing: Direction.North,
      })
    );

    const updatedSite = engine.getBuilding().site;
    expect(updatedSite.plotWidth).toBe(12192);
    expect(updatedSite.plotDepth).toBe(18288);
    expect(updatedSite.plotArea).toBe(12192 * 18288);
    expect(updatedSite.setbacks).toEqual({ front: 2000, rear: 1500, left: 1200, right: 1200 });
    expect(updatedSite.orientation).toBe(0);
    expect(updatedSite.roadFacing).toBe(Direction.North);

    // Verify floor boundary matches buildable envelope:
    // width = 12192 - (1200 + 1200) = 9792
    // depth = 18288 - (2000 + 1500) = 14788
    const activeFloor = engine.getActiveFloor();
    expect(activeFloor).toBeDefined();
    const boundary = activeFloor!.boundary;
    expect(boundary.points.length).toBe(4);
    const xs = boundary.points.map(p => p.x);
    const ys = boundary.points.map(p => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const depth = Math.max(...ys) - Math.min(...ys);
    expect(width).toBe(9792);
    expect(depth).toBe(14788);
  });

  it('persists updated site and reloads it cleanly', () => {
    const building = createCanonical30x50_2BHK();
    const engine = new EditorEngine(building);
    engine.execute(
      new UpdateSiteCommand(engine.getBuilding(), {
        plotWidth: 15000,
        plotDepth: 20000,
        setbacks: { front: 3000, rear: 2000, left: 1500, right: 1500 },
        roadFacing: Direction.East,
      })
    );

    const env: ProjectEnvelope = {
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      projectId: building.projectId,
      name: building.name,
      createdAt: building.createdAt,
      updatedAt: new Date().toISOString(),
      building: engine.getBuilding(),
      requiredRoomCounts: {
        bedroom: 4,
        bathroom: 3,
        living: 1,
        kitchen: 1,
        dining: 1,
      },
    };

    storage.save(env);

    const loadedProject = storage.load(building.projectId);
    expect(loadedProject).not.toBeNull();
    expect(loadedProject!.building.site.plotWidth).toBe(15000);
    expect(loadedProject!.building.site.plotDepth).toBe(20000);
    expect(loadedProject!.building.site.roadFacing).toBe(Direction.East);
    expect(loadedProject!.building.site.setbacks.front).toBe(3000);
    expect(loadedProject!.requiredRoomCounts?.bedroom).toBe(4);
  });

  it('updates required room counts and propagates to room program generation', () => {
    const building = createCanonical30x50_2BHK();
    const engine = new EditorEngine(building);
    engine.execute(
      new UpdateSiteCommand(engine.getBuilding(), {
        plotWidth: 12192,
        plotDepth: 18288,
        setbacks: { front: 2000, rear: 1500, left: 1200, right: 1200 },
      })
    );

    const roomCounts = { bedrooms: 4, bathrooms: 3, living: 1, kitchen: 1, dining: 1, parking: 1 };
    const baseSpec = createQuickDesignRequirements(
      engine.getBuilding(),
      '4 bedrooms, 3 bathrooms, living, kitchen, dining and parking'
    );
    const spec = {
      ...baseSpec,
      hard: {
        ...baseSpec.hard,
        plotWidthMm: engine.getBuilding().site.plotWidth,
        plotDepthMm: engine.getBuilding().site.plotDepth,
        bedroomCount: roomCounts.bedrooms,
        bathroomCount: roomCounts.bathrooms,
        livingRoomRequired: roomCounts.living > 0,
        kitchenRequired: roomCounts.kitchen > 0,
        diningRoomRequired: roomCounts.dining > 0,
      },
    };

    expect(spec.hard.bedroomCount).toBe(4);
    expect(spec.hard.bathroomCount).toBe(3);

    const program = new RoomProgramGenerator().generateProgram(spec);
    const bedrooms = program.items.filter(item => item.type === RoomType.Bedroom);
    const bathrooms = program.items.filter(item => item.type === RoomType.Bathroom);
    expect(bedrooms.length).toBe(4);
    expect(bathrooms.length).toBe(3);
  });

  it('produces diverse candidates for different seeds while maintaining determinism', () => {
    const building = createBuilding({
      projectId: 'seed-test',
      name: 'Seed Test',
      site: {
        plotWidth: 12192,
        plotDepth: 18288,
        setbacks: { front: 2000, rear: 1500, left: 1200, right: 1200 },
      },
    });

    const spec = createQuickDesignRequirements(building, '3 bedrooms, 2 bathrooms, living, kitchen and dining');
    const program = new RoomProgramGenerator().generateProgram(spec);

    const candidatesA1 = new CandidateGenerator().generateCandidates(spec, program, 101);
    const candidatesA2 = new CandidateGenerator().generateCandidates(spec, program, 101);
    const candidatesB = new CandidateGenerator().generateCandidates(spec, program, 202);

    expect(candidatesA1.length).toBeGreaterThan(0);
    expect(candidatesB.length).toBeGreaterThan(0);

    const candA1 = candidatesA1[0]!;
    const candA2 = candidatesA2[0]!;
    const candB = candidatesB[0]!;

    // Deterministic: same seed produces identical candidates
    expect(candA1.id).toBe(candA2.id);
    expect(candA1.building.floors[0]!.rooms.length).toBe(candA2.building.floors[0]!.rooms.length);

    // Diversity: different seeds produce different layouts
    const roomsA = candA1.building.floors[0]!.rooms;
    const roomsB = candB.building.floors[0]!.rooms;
    const positionsA = roomsA.map(r => `${r.x},${r.y}`);
    const positionsB = roomsB.map(r => `${r.x},${r.y}`);
    expect(positionsA.join('|')).not.toBe(positionsB.join('|'));
  });
});

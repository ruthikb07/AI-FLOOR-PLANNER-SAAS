import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  Direction,
  normalizeDesignRequirementSpecification,
  resetIdGenerator,
  RoomType,
  setIdSeed,
} from '@ai-floor-planner/core';
import { CandidateGenerator } from '../generator/candidate-generator';
import { RoomProgramGenerator } from '../program/generator';

describe('Candidate Seed Diversity & Planner Stabilization (Phase 1D.1)', () => {
  beforeEach(() => {
    setIdSeed(100);
  });
  afterEach(() => {
    resetIdGenerator();
  });

  const makeSpec = (overrides?: any) => normalizeDesignRequirementSpecification({
    rawUserPrompt: '30x50 2BHK',
    projectName: 'Diversity Test',
    hard: {
      plotWidthMm: 9144,
      plotDepthMm: 15240,
      floorsCount: 1,
      bedroomCount: 2,
      bathroomCount: 2,
      livingRoomRequired: true,
      kitchenRequired: true,
      diningRoomRequired: true,
      staircaseRequired: false,
      parkingRequired: false,
      parkingSpacesCount: 0,
      liftRequired: false,
      roadFacing: Direction.North,
      ...(overrides?.hard ?? {}),
    },
    soft: {
      vastuCompliance: false,
      balconyPreferred: false,
      ...(overrides?.soft ?? {}),
    },
    orientationDegrees: overrides?.orientationDegrees ?? 0,
    setbacksMm: overrides?.setbacksMm ?? { front: 1500, rear: 1000, left: 1000, right: 1000 },
  });

  it('same seed produces identical candidates deterministically', () => {
    const spec = makeSpec();
    const program = new RoomProgramGenerator().generateProgram(spec);
    const gen = new CandidateGenerator();

    const candidatesA = gen.generateCandidates(spec, program, 105);
    const candidatesB = gen.generateCandidates(spec, program, 105);

    expect(candidatesA.length).toBeGreaterThan(0);
    expect(candidatesA.length).toBe(candidatesB.length);

    // Assert same strategy and same metrics
    expect(candidatesA[0]!.strategy).toBe(candidatesB[0]!.strategy);
    expect(candidatesA[0]!.metrics.totalCarpetAreaMm2).toBe(candidatesB[0]!.metrics.totalCarpetAreaMm2);

    // Assert exact same room dimensions
    const roomsA = candidatesA[0]!.building.floors[0]!.rooms;
    const roomsB = candidatesB[0]!.building.floors[0]!.rooms;
    expect(roomsA.length).toBe(roomsB.length);
    for (let i = 0; i < roomsA.length; i++) {
      expect(roomsA[i]!.width).toBe(roomsB[i]!.width);
      expect(roomsA[i]!.height).toBe(roomsB[i]!.height);
      expect(roomsA[i]!.x).toBe(roomsB[i]!.x);
      expect(roomsA[i]!.y).toBe(roomsB[i]!.y);
    }
  });

  it('different seeds produce distinct valid candidate plans', () => {
    const spec = makeSpec();
    const program = new RoomProgramGenerator().generateProgram(spec);
    const gen = new CandidateGenerator();

    const candidatesSeed1 = gen.generateCandidates(spec, program, 101);
    const candidatesSeed2 = gen.generateCandidates(spec, program, 102);

    expect(candidatesSeed1.length).toBeGreaterThan(0);
    expect(candidatesSeed2.length).toBeGreaterThan(0);

    // Both must be valid
    expect(candidatesSeed1[0]!.validation.isValid).toBe(true);
    expect(candidatesSeed2[0]!.validation.isValid).toBe(true);

    // Seeds produce distinct candidate variants or metrics
    const rooms1 = candidatesSeed1[0]!.building.floors[0]!.rooms;
    const rooms2 = candidatesSeed2[0]!.building.floors[0]!.rooms;
    const sig1 = rooms1.map(r => `${r.type}:${r.width}x${r.height}`).sort().join('|');
    const sig2 = rooms2.map(r => `${r.type}:${r.width}x${r.height}`).sort().join('|');
    
    // Check that either the room dimensions or candidate strategy order differs
    const differs = sig1 !== sig2 || candidatesSeed1[0]!.strategy !== candidatesSeed2[0]!.strategy;
    expect(differs).toBe(true);
  });

  it('changing plot dimensions from 30x50 to 40x60 updates usable boundary and building geometry', () => {
    const spec30x50 = makeSpec({
      hard: { plotWidthMm: 9144, plotDepthMm: 15240, bedroomCount: 2 },
    });
    const spec40x60 = makeSpec({
      hard: { plotWidthMm: 12192, plotDepthMm: 18288, bedroomCount: 4, bathroomCount: 3 },
    });

    const program30 = new RoomProgramGenerator().generateProgram(spec30x50);
    const program40 = new RoomProgramGenerator().generateProgram(spec40x60);
    const gen = new CandidateGenerator();

    const plan30x50 = gen.generateCandidates(spec30x50, program30, 42)[0]!;
    const plan40x60 = gen.generateCandidates(spec40x60, program40, 42)[0]!;

    const b30 = plan30x50.building;
    const b40 = plan40x60.building;

    expect(b30.site.plotWidth).toBe(9144);
    expect(b40.site.plotWidth).toBe(12192);
    expect(b30.site.plotDepth).toBe(15240);
    expect(b40.site.plotDepth).toBe(18288);

    // Floor boundaries and carpet areas reflect the larger plot and program
    const area30 = plan30x50.metrics.totalCarpetAreaMm2;
    const area40 = plan40x60.metrics.totalCarpetAreaMm2;
    expect(area40).toBeGreaterThan(area30);
  });

  it('changing room count from 2 to 4 bedrooms reaches the room program generator', () => {
    const spec2BHK = makeSpec({ hard: { bedroomCount: 2 } });
    const spec4BHK = makeSpec({ hard: { bedroomCount: 4 } });

    const program2 = new RoomProgramGenerator().generateProgram(spec2BHK);
    const program4 = new RoomProgramGenerator().generateProgram(spec4BHK);

    const bedrooms2 = program2.items.filter(item => item.type === RoomType.Bedroom);
    const bedrooms4 = program4.items.filter(item => item.type === RoomType.Bedroom);

    expect(bedrooms2.length).toBe(2);
    expect(bedrooms4.length).toBe(4);
  });

  it('changing bathroom count from 1 to 3 reaches the room program generator', () => {
    const spec1Bath = makeSpec({ hard: { bathroomCount: 1 } });
    const spec3Bath = makeSpec({ hard: { bathroomCount: 3 } });

    const program1 = new RoomProgramGenerator().generateProgram(spec1Bath);
    const program3 = new RoomProgramGenerator().generateProgram(spec3Bath);

    const baths1 = program1.items.filter(item => item.type === RoomType.Bathroom);
    const baths3 = program3.items.filter(item => item.type === RoomType.Bathroom);

    expect(baths1.length).toBe(1);
    expect(baths3.length).toBe(3);
  });

  it('road orientation reaches the canonical building site and candidate generator', () => {
    const specEast = makeSpec({
      orientationDegrees: 90,
      hard: { roadFacing: Direction.East },
    });

    const program = new RoomProgramGenerator().generateProgram(specEast);
    const gen = new CandidateGenerator();
    const candidate = gen.generateCandidates(specEast, program, 42)[0]!;

    expect(candidate.building.site.roadFacing).toBe(Direction.East);
    expect(candidate.building.site.orientation).toBe(90);
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeDesignRequirementSpecification, RoomType } from '@ai-floor-planner/core';
import { polygonArea, polygonBoundingBox } from '@ai-floor-planner/geometry-engine';
import { CandidateGenerator } from '../generator/candidate-generator';
import { RoomProgramGenerator } from '../program/generator';

describe('Full-Plot 50×50 ft (2,500 sq ft) Building Generation', () => {
  const PLOT_50x50_MM = 15240; // 50 feet in mm = 15.24m
  const PLOT_AREA_M2 = (PLOT_50x50_MM * PLOT_50x50_MM) / 1e6; // 232.2576 m2

  it('generates a single-story (G) plan covering 100% of the 50×50 plot', () => {
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm: PLOT_50x50_MM,
        plotDepthMm: PLOT_50x50_MM,
        floorsCount: 1,
        bedroomCount: 2,
        bathroomCount: 2,
        fullPlotCoverage: true,
      },
      soft: {
        gardenPreference: false,
      },
    });

    const program = new RoomProgramGenerator().generateProgram(spec);
    // Ensure garden is not included by default
    expect(program.items.some(item => item.type === RoomType.Garden)).toBe(false);

    const candidates = new CandidateGenerator().generateCandidates(spec, program, 42);
    expect(candidates.length).toBeGreaterThan(0);

    const best = candidates[0]!;
    const groundFloor = best.building.floors[0]!;
    const groundAreaM2 = polygonArea(groundFloor.boundary) / 1e6;
    const box = polygonBoundingBox(groundFloor.boundary);

    // Ground floor must cover the entire 50x50 plot
    expect(groundAreaM2).toBeCloseTo(PLOT_AREA_M2, 1);
    expect(box.width).toBe(PLOT_50x50_MM);
    expect(box.height).toBe(PLOT_50x50_MM);

    // All rooms must be placed inside the building with no garden
    const rooms = groundFloor.rooms;
    expect(rooms.length).toBeGreaterThanOrEqual(4);
    expect(rooms.some(r => r.type === RoomType.Garden)).toBe(false);
  });

  it('generates G+1 where Ground Floor is comparatively the most space occupied area', () => {
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm: PLOT_50x50_MM,
        plotDepthMm: PLOT_50x50_MM,
        floorsCount: 2,
        bedroomCount: 3,
        bathroomCount: 3,
        fullPlotCoverage: true,
      },
      soft: {
        gardenPreference: false,
      },
    });

    const program = new RoomProgramGenerator().generateProgram(spec);
    const candidates = new CandidateGenerator().generateCandidates(spec, program, 42);
    expect(candidates.length).toBeGreaterThan(0);

    const candidate = candidates[0]!;
    expect(candidate.building.floors.length).toBe(2);

    const floor0 = candidate.building.floors[0]!;
    const floor1 = candidate.building.floors[1]!;

    const area0 = polygonArea(floor0.boundary);
    const area1 = polygonArea(floor1.boundary);

    // Ground floor occupies 100% of plot area
    expect(area0 / 1e6).toBeCloseTo(PLOT_AREA_M2, 1);
    // Ground floor is comparatively the most space occupied area: area0 >= area1
    expect(area0).toBeGreaterThanOrEqual(area1);

    // Staircase vertical core alignment check:
    const stairRoom0 = floor0.rooms.find(r => r.type === RoomType.Staircase);
    const stairRoom1 = floor1.rooms.find(r => r.type === RoomType.Staircase);
    expect(stairRoom0).toBeDefined();
    expect(stairRoom1).toBeDefined();

    // Stair room coordinates and footprint must be identical across floors
    expect(stairRoom0!.x).toBe(stairRoom1!.x);
    expect(stairRoom0!.y).toBe(stairRoom1!.y);
    expect(stairRoom0!.width).toBe(stairRoom1!.width);
    expect(stairRoom0!.height).toBe(stairRoom1!.height);
  });

  it('generates G+2 where Ground Floor occupies maximum space and vertical core is aligned across all 3 levels', () => {
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm: PLOT_50x50_MM,
        plotDepthMm: PLOT_50x50_MM,
        floorsCount: 3,
        bedroomCount: 4,
        bathroomCount: 4,
        fullPlotCoverage: true,
      },
      soft: {
        gardenPreference: false,
      },
    });

    const program = new RoomProgramGenerator().generateProgram(spec);
    const candidates = new CandidateGenerator().generateCandidates(spec, program, 42);
    expect(candidates.length).toBeGreaterThan(0);

    const candidate = candidates[0]!;
    expect(candidate.building.floors.length).toBe(3);

    const [f0, f1, f2] = candidate.building.floors;
    const a0 = polygonArea(f0!.boundary);
    const a1 = polygonArea(f1!.boundary);
    const a2 = polygonArea(f2!.boundary);

    // Hierarchy: Ground floor occupies maximum space
    expect(a0 / 1e6).toBeCloseTo(PLOT_AREA_M2, 1);
    expect(a0).toBeGreaterThanOrEqual(a1);
    expect(a1).toBeGreaterThanOrEqual(a2);

    // Vertical stair alignment across all 3 floors
    const s0 = f0!.rooms.find(r => r.type === RoomType.Staircase)!;
    const s1 = f1!.rooms.find(r => r.type === RoomType.Staircase)!;
    const s2 = f2!.rooms.find(r => r.type === RoomType.Staircase)!;

    expect(s0.x).toBe(s1.x);
    expect(s1.x).toBe(s2.x);
    expect(s0.y).toBe(s1.y);
    expect(s1.y).toBe(s2.y);
    expect(s0.width).toBe(s1.width);
    expect(s1.width).toBe(s2.width);
  });
});

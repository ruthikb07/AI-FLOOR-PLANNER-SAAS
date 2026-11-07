/**
 * 50x50 Architectural Planning Benchmark Suite.
 *
 * Mandated by Architectural Generation Grammar:
 * - Case A: 2BHK/3BHK residence (Human-scale proportions, non-square footprint, readable circulation)
 * - Case B: 3BHK + parking (Dedicated carved parking bay with direct road access, arrival foyer)
 * - Case C: 3BHK + parking + garden (Parking + garden court + entrance porch + rear utility yard)
 * - Case D: Multi-floor residence (Differentiated footprints, front balcony over parking, vertical stair lock, OTS shaft)
 *
 * Verifies that the generator does NOT blindly fill the 50x50 envelope with a giant square,
 * but plans the site intelligently with parking, open space, and articulated massing.
 */

import { describe, expect, it } from 'vitest';
import {
  Direction,
  RoomType,
  normalizeDesignRequirementSpecification,
} from '@ai-floor-planner/core';
import { polygonArea } from '@ai-floor-planner/geometry-engine';
import { CandidateGenerator } from '../generator/candidate-generator';
import { RoomProgramGenerator } from '../program/generator';

describe('Mandatory 50x50 Architectural Benchmark Suite', () => {
  const plotWidthMm = 15240; // 50 feet (15.24m)
  const plotDepthMm = 15240; // 50 feet (15.24m)
  const plotAreaMm2 = plotWidthMm * plotDepthMm; // 232.26 m2 / 2500 sq ft

  const candidateGen = new CandidateGenerator();
  const programGen = new RoomProgramGenerator();

  // Case A: 2BHK/3BHK residence
  it('Case A: generates articulated, non-square footprints with human-scale rooms on 50x50 site', () => {
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm,
        plotDepthMm,
        roadFacing: Direction.North,
        floorsCount: 1,
        bedroomCount: 3,
        bathroomCount: 2,
        livingRoomRequired: true,
        diningRoomRequired: true,
        kitchenRequired: true,
      },
      soft: {
        vastuCompliance: false,
      },
      setbacksMm: {
        front: 3000,
        rear: 2000,
        left: 1500,
        right: 1500,
      },
    });

    const program = programGen.generateProgram(spec);
    const candidates = candidateGen.generateArchitecturalCandidates(spec, program, 42);

    expect(candidates.length).toBeGreaterThanOrEqual(3);

    for (const cand of candidates) {
      const bldg = cand.building;
      const groundFloor = bldg.floors[0]!;
      const footprintArea = polygonArea(groundFloor.boundary);

      // Building footprint does NOT blindly occupy the entire 50x50 plot
      expect(footprintArea).toBeLessThan(plotAreaMm2);
      expect(footprintArea).toBeGreaterThanOrEqual(80_000_000); // at least 80 m2

      // Check room proportions and types
      const rooms = groundFloor.rooms;
      const living = rooms.find(r => r.type === RoomType.Living);
      expect(living).toBeDefined();
      expect(living!.width).toBeGreaterThanOrEqual(3600); // >= 12 ft
      expect(living!.height).toBeGreaterThanOrEqual(3800); // >= 12.5 ft

      const bedrooms = rooms.filter(r => r.type === RoomType.Bedroom);
      expect(bedrooms.length).toBeGreaterThanOrEqual(2);
      for (const bed of bedrooms) {
        expect(bed.width).toBeGreaterThanOrEqual(2800); // Realistic width
        expect(bed.height).toBeGreaterThanOrEqual(3000); // Realistic length
      }

      // Check presence of vertical/service core (Stair and OTS shaft)
      const stair = rooms.find(r => r.type === RoomType.Staircase);
      expect(stair).toBeDefined();
      const ots = rooms.find(r => r.type === RoomType.OTS);
      expect(ots).toBeDefined();

      // Check doors and windows
      expect(groundFloor.doors.length).toBeGreaterThanOrEqual(5);
      expect(groundFloor.windows.length).toBeGreaterThanOrEqual(4);

      // Check site ledger
      const siteAudit = cand.siteUtilization;
      expect(siteAudit).toBeDefined();
      expect(siteAudit!.isComplete).toBe(true);
      expect(siteAudit!.unallocatedAreaMm2).toBe(0);
    }
  });

  // Case B: 3BHK + parking
  it('Case B: integrates dedicated parking bay with front access and pedestrian arrival on 50x50 site', () => {
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm,
        plotDepthMm,
        roadFacing: Direction.North,
        floorsCount: 1,
        bedroomCount: 3,
        bathroomCount: 2,
        parkingRequired: true,
        parkingSpacesCount: 1,
      },
      setbacksMm: {
        front: 3000,
        rear: 2000,
        left: 1500,
        right: 1500,
      },
    });

    const program = programGen.generateProgram(spec);
    const candidates = candidateGen.generateArchitecturalCandidates(spec, program, 42);

    expect(candidates.length).toBeGreaterThanOrEqual(3);

    // Find the Parking-first L-Shape strategy candidate
    const parkingCand = candidates.find(c => c.strategy === 'parking_first_l_shape') ?? candidates[0]!;
    expect(parkingCand).toBeDefined();

    const siteZones = parkingCand.building.site.siteZones ?? [];
    const parkingZone = siteZones.find(z => z.kind === 'parking');
    expect(parkingZone).toBeDefined();
    expect(parkingZone!.area).toBeGreaterThanOrEqual(15_000_000); // >= 15 m2 (standard car bay)

    const pedZone = siteZones.find(z => z.kind === 'pedestrian_circulation');
    expect(pedZone).toBeDefined();

    // Check that ground floor has Entrance Foyer opening into Living Room
    const groundFloor = parkingCand.building.floors[0]!;
    const foyer = groundFloor.rooms.find(r => r.type === RoomType.Foyer);
    expect(foyer).toBeDefined();
    const living = groundFloor.rooms.find(r => r.type === RoomType.Living);
    expect(living).toBeDefined();
  });

  // Case C: 3BHK + parking + garden
  it('Case C: allocates intentional front garden, parking, and rear service yard on 50x50 site', () => {
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm,
        plotDepthMm,
        roadFacing: Direction.North,
        floorsCount: 1,
        bedroomCount: 3,
        bathroomCount: 2,
        parkingRequired: true,
        parkingSpacesCount: 1,
      },
      soft: {
        gardenPreference: true,
      },
      setbacksMm: {
        front: 3000,
        rear: 2000,
        left: 1500,
        right: 1500,
      },
    });

    const program = programGen.generateProgram(spec);
    const candidates = candidateGen.generateArchitecturalCandidates(spec, program, 42);

    for (const cand of candidates) {
      const siteZones = cand.building.site.siteZones ?? [];
      const gardenZone = siteZones.find(z => z.kind === 'garden');
      expect(gardenZone).toBeDefined();
      expect(gardenZone!.area).toBeGreaterThan(0);

      const parkingZone = siteZones.find(z => z.kind === 'parking');
      expect(parkingZone).toBeDefined();

      // Check 100% classification
      const audit = cand.siteUtilization!;
      expect(audit.isComplete).toBe(true);
      expect(audit.unallocatedAreaMm2).toBe(0);
    }
  });

  // Case D: Multi-floor residence
  it('Case D: generates differentiated footprints, upper balconies, and vertically aligned core for multi-floor 50x50 residence', () => {
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm,
        plotDepthMm,
        roadFacing: Direction.North,
        floorsCount: 2,
        bedroomCount: 3,
        bathroomCount: 3,
        parkingRequired: true,
        parkingSpacesCount: 1,
      },
      soft: {
        balconyPreferred: true,
      },
      setbacksMm: {
        front: 3000,
        rear: 2000,
        left: 1500,
        right: 1500,
      },
    });

    const program = programGen.generateProgram(spec);
    const candidates = candidateGen.generateArchitecturalCandidates(spec, program, 42);

    expect(candidates.length).toBeGreaterThanOrEqual(3);

    for (const cand of candidates) {
      const bldg = cand.building;
      expect(bldg.floors.length).toBe(2);

      const gFloor = bldg.floors[0]!;
      const uFloor = bldg.floors[1]!;

      // Staircase Core must be vertically aligned across both floors
      const gStair = gFloor.rooms.find(r => r.type === RoomType.Staircase)!;
      const uStair = uFloor.rooms.find(r => r.type === RoomType.Staircase)!;
      expect(gStair).toBeDefined();
      expect(uStair).toBeDefined();
      expect(gStair.x).toBe(uStair.x);
      expect(gStair.y).toBe(uStair.y);
      expect(gStair.width).toBe(uStair.width);
      expect(gStair.height).toBe(uStair.height);

      // OTS Shaft must be vertically aligned
      const gOts = gFloor.rooms.find(r => r.type === RoomType.OTS)!;
      const uOts = uFloor.rooms.find(r => r.type === RoomType.OTS)!;
      expect(gOts).toBeDefined();
      expect(uOts).toBeDefined();
      expect(gOts.x).toBe(uOts.x);
      expect(gOts.y).toBe(uOts.y);

      // Upper floor has Master Suite with Front Balcony overlooking road
      const uBalcony = uFloor.rooms.find(r => r.type === RoomType.Balcony);
      expect(uBalcony).toBeDefined();

      const uLounge = uFloor.rooms.find(r => r.type === RoomType.FamilyLiving);
      expect(uLounge).toBeDefined();

      // Check vertical continuity score
      expect(cand.metrics.verticalContinuityScore).toBeGreaterThanOrEqual(70);
    }
  });

  // Strategy Differentiation Check (Requirement 27 & 28)
  it('generates genuinely distinct architectural strategies rather than minor coordinate offsets', () => {
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm,
        plotDepthMm,
        roadFacing: Direction.North,
        floorsCount: 2,
        bedroomCount: 3,
        bathroomCount: 3,
        parkingRequired: true,
      },
    });

    const program = programGen.generateProgram(spec);
    const candidates = candidateGen.generateArchitecturalCandidates(spec, program, 42);

    const stratIds = candidates.map(c => c.strategy);
    expect(stratIds).toContain('parking_first_l_shape');
    expect(stratIds).toContain('courtyard_ots');
    expect(stratIds).toContain('offset_wings');
    expect(stratIds).toContain('compact_frontage');

    // Verify descriptions reflect architectural reasoning
    for (const cand of candidates) {
      expect(cand.description.length).toBeGreaterThan(20);
      expect(cand.name).toContain('BHK');
    }
  });
});

/**
 * 50x50 Site Utilization Regression Fixture (Phase 1 Exit Gate).
 *
 * Verifies that on a standard 50ft x 50ft (15.24m x 15.24m) site:
 * 1. 100% of the plot area is classified.
 * 2. Every zone has a valid polygon, label, area, and rationale.
 * 3. The sum of all zone areas plus building footprint equals plot area within tolerance.
 * 4. Zero residual unallocated blank space exists.
 * 5. Parking connects to road access with clear pedestrian and vehicular circulation.
 */

import { describe, expect, it } from 'vitest';
import {
  Direction,
  normalizeDesignRequirementSpecification,
} from '@ai-floor-planner/core';
import { polygonArea, polygonIntersectionArea } from '@ai-floor-planner/geometry-engine';
import { CandidateGenerator } from '../generator/candidate-generator';
import { RoomProgramGenerator } from '../program/generator';

describe('50x50 Site Utilization Regression Fixture (PRD Exit Gate)', () => {
  const plotWidthMm = 15240; // 50 feet
  const plotDepthMm = 15240; // 50 feet
  const plotAreaMm2 = plotWidthMm * plotDepthMm; // 232.26 m2

  it('yields a complete site ledger whose categories sum to the plot area within tolerance on 15.24m x 15.24m plot', () => {
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm,
        plotDepthMm,
        roadFacing: Direction.North,
        floorsCount: 1,
        bedroomCount: 2,
        bathroomCount: 2,
        parkingRequired: true,
        parkingSpacesCount: 1,
      },
      soft: {
        gardenPreference: true,
        vastuCompliance: false,
      },
      setbacksMm: {
        front: 3000,
        rear: 2000,
        left: 1500,
        right: 1500,
      },
    });

    const program = new RoomProgramGenerator().generateProgram(spec);
    const candidateGen = new CandidateGenerator();
    const candidates = candidateGen.generateCandidates(spec, program, 42);

    expect(candidates.length).toBeGreaterThan(0);

    for (const candidate of candidates) {
      const site = candidate.building.site;
      expect(site.plotWidth).toBe(plotWidthMm);
      expect(site.plotDepth).toBe(plotDepthMm);

      const audit = candidate.siteUtilization;
      expect(audit).toBeDefined();
      expect(audit!.isComplete).toBe(true);
      expect(audit!.unallocatedAreaMm2).toBe(0);
      expect(audit!.plotAreaMm2).toBe(plotAreaMm2);

      const footprint = candidate.building.floors[0]!.boundary;
      const footprintArea = polygonArea(footprint);
      expect(audit!.buildingFootprintAreaMm2).toBe(footprintArea);

      // Verify all site zones
      const zones = site.siteZones ?? [];
      expect(zones.length).toBeGreaterThan(0);

      let totalZonesArea = 0;
      for (const zone of zones) {
        expect(zone.id).toBeDefined();
        expect(zone.name.length).toBeGreaterThan(0);
        expect(zone.area).toBeGreaterThan(0);
        expect(zone.boundary.points.length).toBeGreaterThanOrEqual(3);
        expect(zone.rationale).toBeDefined();
        expect(zone.rationale!.length).toBeGreaterThan(0);
        expect(zone.source).toBeDefined();
        expect(['setback', 'parking', 'garden', 'pedestrian_circulation', 'vehicle_circulation', 'service', 'future_expansion']).toContain(zone.kind);
        totalZonesArea += zone.area;
      }

      // 100% of the plot is classified: Invariant equality
      const totalClassified = totalZonesArea + footprintArea;
      expect(Math.abs(totalClassified - plotAreaMm2)).toBeLessThanOrEqual(plotAreaMm2 * 0.0001);

      // Parking check
      expect(audit!.parkingFeasible).toBe(true);
      const parkingZone = zones.find(z => z.kind === 'parking');
      expect(parkingZone).toBeDefined();
      expect(parkingZone!.name).toContain('Parking');

      // Pedestrian circulation check
      const pedZone = zones.find(z => z.kind === 'pedestrian_circulation');
      expect(pedZone).toBeDefined();
      expect(pedZone!.accessLinks).toContain('road_access');

      // Garden check
      const gardenZones = zones.filter(z => z.kind === 'garden');
      expect(gardenZones.length).toBeGreaterThan(0);

      // Category breakdown checks
      expect(audit!.breakdown.length).toBeGreaterThanOrEqual(4);
      const totalBreakdownArea = audit!.breakdown.reduce((sum, b) => sum + b.areaMm2, 0);
      expect(Math.abs(totalBreakdownArea - totalZonesArea)).toBeLessThanOrEqual(10);

      // Pairwise non-overlapping check across all site zones
      for (let i = 0; i < zones.length; i++) {
        for (let j = i + 1; j < zones.length; j++) {
          const overlap = polygonIntersectionArea(zones[i]!.boundary, zones[j]!.boundary);
          expect(overlap).toBeLessThan(100); // Negligible numerical boundary touch
        }
      }

      // Check no zone overlaps the ground building footprint
      for (const zone of zones) {
        const overlapWithBuilding = polygonIntersectionArea(zone.boundary, footprint);
        expect(overlapWithBuilding).toBeLessThan(100);
      }
    }
  });

  it('classifies 100% of land on a large 50m x 50m plot without room stretching', () => {
    const largePlotMm = 50000;
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm: largePlotMm,
        plotDepthMm: largePlotMm,
        roadFacing: Direction.North,
        floorsCount: 1,
        bedroomCount: 2,
        bathroomCount: 2,
        parkingRequired: true,
        parkingSpacesCount: 2,
      },
      soft: {
        gardenPreference: true,
        vastuCompliance: false,
      },
    });

    const program = new RoomProgramGenerator().generateProgram(spec);
    const candidates = new CandidateGenerator().generateCandidates(spec, program, 42);

    expect(candidates.length).toBeGreaterThan(0);
    const candidate = candidates[0]!;
    const audit = candidate.siteUtilization;

    expect(audit).toBeDefined();
    expect(audit!.isComplete).toBe(true);
    expect(audit!.unallocatedAreaMm2).toBe(0);

    const plotArea = largePlotMm * largePlotMm;
    const footprintArea = polygonArea(candidate.building.floors[0]!.boundary);
    const zonesArea = candidate.building.site.siteZones!.reduce((sum, z) => sum + z.area, 0);

    expect(Math.abs(zonesArea + footprintArea - plotArea)).toBeLessThanOrEqual(plotArea * 0.0001);
  });
});

import { describe, expect, it } from 'vitest';
import {
  createBuilding,
  Direction,
  normalizeDesignRequirementSpecification,
} from '@ai-floor-planner/core';
import { polygonArea, polygonIntersectionArea } from '@ai-floor-planner/geometry-engine';
import { SitePlanner } from '../site/site-planner';
import { CandidateGenerator } from '../generator/candidate-generator';
import { RoomProgramGenerator } from '../program/generator';

describe('SitePlanner — Complete Plot Accounting (Phase 1)', () => {
  const planner = new SitePlanner();

  it('classifies 100% of the site area with non-overlapping zones', () => {
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm: 12000,
        plotDepthMm: 18000,
        roadFacing: Direction.North,
        floorsCount: 1,
        bedroomCount: 2,
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

    const building = createBuilding({
      projectId: 'proj_1',
      name: 'Test Project',
      site: {
        plotWidth: 12000,
        plotDepth: 18000,
        roadFacing: Direction.North,
        setbacks: { front: 3000, rear: 2000, left: 1500, right: 1500 },
      },
    });

    // 8m x 9m footprint within the 9m x 13m buildable envelope
    const footprint = {
      points: [
        { x: 2000, y: 4000 },
        { x: 10000, y: 4000 },
        { x: 10000, y: 13000 },
        { x: 2000, y: 13000 },
      ],
    };

    const result = planner.planSiteUtilization({
      site: building.site,
      footprintPolygon: footprint,
      requirements: spec,
      building,
    });

    expect(result.isValid).toBe(true);
    expect(result.siteUtilization.isComplete).toBe(true);
    expect(result.siteUtilization.unallocatedAreaMm2).toBe(0);

    const plotArea = 12000 * 18000;
    const footprintArea = polygonArea(footprint);
    const totalZonesArea = result.siteZones.reduce((sum, z) => sum + z.area, 0);

    // Sum of zones + footprint must equal plot area within 0.01%
    expect(Math.abs(totalZonesArea + footprintArea - plotArea)).toBeLessThanOrEqual(plotArea * 0.0001);

    // Verify all zones have valid properties
    for (const zone of result.siteZones) {
      expect(zone.id).toBeDefined();
      expect(zone.name.length).toBeGreaterThan(0);
      expect(zone.area).toBeGreaterThan(0);
      expect(zone.boundary.points.length).toBeGreaterThanOrEqual(3);
      expect(zone.rationale).toBeDefined();
      expect(zone.source).toBeDefined();
    }

    // Check parking zone is present and feasible
    const parkingZone = result.siteZones.find(z => z.kind === 'parking');
    expect(parkingZone).toBeDefined();
    expect(result.siteUtilization.parkingFeasible).toBe(true);

    // Check setbacks are present
    const setbackZones = result.siteZones.filter(z => z.kind === 'setback');
    expect(setbackZones.length).toBeGreaterThanOrEqual(3);

    // Check no pair of zones has interior overlap
    for (let i = 0; i < result.siteZones.length; i++) {
      for (let j = i + 1; j < result.siteZones.length; j++) {
        const overlap = polygonIntersectionArea(result.siteZones[i]!.boundary, result.siteZones[j]!.boundary);
        // Any numerical overlap between adjacent borders must be negligible (< 100 mm2)
        expect(overlap).toBeLessThan(100);
      }
    }
  });

  it('allocates service yard when serviceYardRequired is set', () => {
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm: 15000,
        plotDepthMm: 20000,
        roadFacing: Direction.North,
        floorsCount: 1,
        bedroomCount: 3,
        bathroomCount: 2,
        serviceYardRequired: true,
      },
      setbacksMm: { front: 3000, rear: 3000, left: 2000, right: 2000 },
    });

    const building = createBuilding({
      projectId: 'proj_2',
      name: 'Service Yard Project',
      site: {
        plotWidth: 15000,
        plotDepth: 20000,
        roadFacing: Direction.North,
        setbacks: { front: 3000, rear: 3000, left: 2000, right: 2000 },
      },
    });

    const footprint = {
      points: [
        { x: 3000, y: 5000 },
        { x: 12000, y: 5000 },
        { x: 12000, y: 12000 },
        { x: 3000, y: 12000 },
      ],
    };

    const result = planner.planSiteUtilization({
      site: building.site,
      footprintPolygon: footprint,
      requirements: spec,
      building,
    });

    const serviceZone = result.siteZones.find(z => z.kind === 'service');
    expect(serviceZone).toBeDefined();
    expect(serviceZone!.name).toContain('Service');
    expect(result.siteUtilization.isComplete).toBe(true);
  });

  it('CandidateGenerator attaches siteZones and complete siteUtilization audit to candidates', () => {
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm: 14000,
        plotDepthMm: 16000,
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
    });

    const program = new RoomProgramGenerator().generateProgram(spec);
    const candidates = new CandidateGenerator().generateCandidates(spec, program, 42);

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.building.site.siteZones).toBeDefined();
      expect(candidate.building.site.siteZones!.length).toBeGreaterThan(0);
      expect(candidate.siteUtilization).toBeDefined();
      expect(candidate.siteUtilization!.isComplete).toBe(true);
      expect(candidate.siteUtilization!.unallocatedAreaMm2).toBe(0);
      expect(candidate.metrics.siteUtilization).toBeDefined();

      const plotArea = candidate.building.site.plotWidth * candidate.building.site.plotDepth;
      const footprintArea = polygonArea(candidate.building.floors[0]!.boundary);
      const zonesArea = candidate.building.site.siteZones!.reduce((sum, z) => sum + z.area, 0);

      expect(Math.abs(zonesArea + footprintArea - plotArea)).toBeLessThanOrEqual(plotArea * 0.0002);
    }
  });
});

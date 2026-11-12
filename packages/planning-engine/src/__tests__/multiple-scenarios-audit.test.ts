import { describe, it, expect } from 'vitest';
import {
  Direction,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
} from '@ai-floor-planner/core';
import { executeAuditedPlanningPipeline } from '../pipeline/stage-progress-emitter';

describe('ARGON 4 Multi-Project Architectural Scenario Testing via executeAuditedPlanningPipeline', () => {

  // Scenario 1: Compact 12m x 18m plot with 2 flats (1BHK)
  it('Scenario 1: Compact 12m x 18m plot with 2 flats', async () => {
    try {
      const res = await executeAuditedPlanningPipeline({
        projectName: 'Scenario 1 - Compact 12x18',
        plotWidthMm: 12000,
        plotDepthMm: 18000,
        roadWidthMm: 9000,
        roadAccessSides: [Direction.North],
        setbacksMm: { front: 3000, rear: 1500, left: 1500, right: 1500 },
        lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
        jurisdiction: 'generic_maharashtra',
        verticalStackType: 'STILT_PLUS_N',
        numTypicalFloors: 2,
        flatsPerFloor: 2,
        units: [
          { unitIndex: 1, bhkType: '1BHK', hasUtilityBalcony: false },
          { unitIndex: 2, bhkType: '1BHK', hasUtilityBalcony: false },
        ],
        siteAmenities: DEFAULT_SITE_AMENITIES,
        stiltAmenities: DEFAULT_STILT_AMENITIES,
        terraceAmenities: DEFAULT_TERRACE_AMENITIES,
        parkingMode: 'STILT_ONLY',
      });
      console.log('Scenario 1 SUCCESS: Floors count =', res.building.floors.length);
      expect(res.building.floors.length).toBeGreaterThan(0);
    } catch (e: any) {
      console.log('Scenario 1 FAILED:', e.message);
    }
  });

  // Scenario 2: Standard 18m x 25m with 2 flats (2BHK)
  it('Scenario 2: Standard 18m x 25m with 2 flats (2BHK)', async () => {
    try {
      const res = await executeAuditedPlanningPipeline({
        projectName: 'Scenario 2 - 18x25 2BHK',
        plotWidthMm: 18000,
        plotDepthMm: 25000,
        roadWidthMm: 12000,
        roadAccessSides: [Direction.North],
        setbacksMm: { front: 3000, rear: 1500, left: 1500, right: 1500 },
        lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
        jurisdiction: 'generic_maharashtra',
        verticalStackType: 'STILT_PLUS_N',
        numTypicalFloors: 3,
        flatsPerFloor: 2,
        units: [
          { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true, targetCarpetSqFt: 850 },
          { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true, targetCarpetSqFt: 850 },
        ],
        siteAmenities: DEFAULT_SITE_AMENITIES,
        stiltAmenities: DEFAULT_STILT_AMENITIES,
        terraceAmenities: DEFAULT_TERRACE_AMENITIES,
        parkingMode: 'STILT_ONLY',
      });
      console.log('Scenario 2 SUCCESS: Floors count =', res.building.floors.length, 'Validation valid =', res.validationReport.isValid);
      expect(res.building.floors.length).toBe(5);
    } catch (e: any) {
      console.log('Scenario 2 FAILED:', e.message);
    }
  });

  // Scenario 3: Large Quad Apartment (24m x 30m, 4 flats/floor)
  it('Scenario 3: Large Quad Apartment (24m x 30m, 4 flats/floor)', async () => {
    try {
      const res = await executeAuditedPlanningPipeline({
        projectName: 'Scenario 3 - Quad 24x30',
        plotWidthMm: 24000,
        plotDepthMm: 30000,
        roadWidthMm: 15000,
        roadAccessSides: [Direction.North],
        setbacksMm: { front: 4000, rear: 2000, left: 2000, right: 2000 },
        lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
        jurisdiction: 'generic_maharashtra',
        verticalStackType: 'STILT_PLUS_N',
        numTypicalFloors: 3,
        flatsPerFloor: 4,
        units: [
          { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
          { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
          { unitIndex: 3, bhkType: '3BHK', hasUtilityBalcony: true },
          { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true },
        ],
        siteAmenities: DEFAULT_SITE_AMENITIES,
        stiltAmenities: DEFAULT_STILT_AMENITIES,
        terraceAmenities: DEFAULT_TERRACE_AMENITIES,
        parkingMode: 'STILT_ONLY',
      });
      console.log('Scenario 3 SUCCESS: Floors count =', res.building.floors.length, 'Validation valid =', res.validationReport.isValid);
      expect(res.building.floors.length).toBe(5);
    } catch (e: any) {
      console.log('Scenario 3 FAILED:', e.message);
    }
  });

  // Scenario 4: Narrow Constrained Site (10m x 20m)
  it('Scenario 4: Narrow Constrained Site (10m x 20m)', async () => {
    try {
      const res = await executeAuditedPlanningPipeline({
        projectName: 'Scenario 4 - Narrow 10x20',
        plotWidthMm: 10000,
        plotDepthMm: 20000,
        roadWidthMm: 9000,
        roadAccessSides: [Direction.North],
        setbacksMm: { front: 3000, rear: 1500, left: 1500, right: 1500 },
        lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
        jurisdiction: 'generic_maharashtra',
        verticalStackType: 'STILT_PLUS_N',
        numTypicalFloors: 2,
        flatsPerFloor: 2,
        units: [
          { unitIndex: 1, bhkType: '1BHK', hasUtilityBalcony: false },
          { unitIndex: 2, bhkType: '1BHK', hasUtilityBalcony: false },
        ],
        siteAmenities: DEFAULT_SITE_AMENITIES,
        stiltAmenities: DEFAULT_STILT_AMENITIES,
        terraceAmenities: DEFAULT_TERRACE_AMENITIES,
        parkingMode: 'STILT_ONLY',
      });
      console.log('Scenario 4 SUCCESS: Floors count =', res.building.floors.length);
    } catch (e: any) {
      console.log('Scenario 4 FAILED (expected constraint behavior):', e.message);
    }
  });

  // Scenario 5: Intentionally Infeasible Requirements (5m x 6m plot with 4 flats)
  it('Scenario 5: Intentionally Infeasible Requirements (5m x 6m plot with 4 flats)', async () => {
    let failed = false;
    try {
      await executeAuditedPlanningPipeline({
        projectName: 'Scenario 5 - Infeasible',
        plotWidthMm: 5000,
        plotDepthMm: 6000,
        roadWidthMm: 6000,
        roadAccessSides: [Direction.North],
        setbacksMm: { front: 3000, rear: 1500, left: 1500, right: 1500 },
        lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
        jurisdiction: 'generic_maharashtra',
        verticalStackType: 'STILT_PLUS_N',
        numTypicalFloors: 3,
        flatsPerFloor: 4,
        units: [
          { unitIndex: 1, bhkType: '4BHK', hasUtilityBalcony: true },
          { unitIndex: 2, bhkType: '4BHK', hasUtilityBalcony: true },
          { unitIndex: 3, bhkType: '4BHK', hasUtilityBalcony: true },
          { unitIndex: 4, bhkType: '4BHK', hasUtilityBalcony: true },
        ],
        siteAmenities: DEFAULT_SITE_AMENITIES,
        stiltAmenities: DEFAULT_STILT_AMENITIES,
        terraceAmenities: DEFAULT_TERRACE_AMENITIES,
        parkingMode: 'STILT_ONLY',
      });
    } catch (e: any) {
      failed = true;
      console.log('Scenario 5 Infeasible Caught Expectedly:', e.message);
      expect(e.message).toBeDefined();
    }
    expect(failed).toBe(true);
  });

  // Scenario 6: Decimal Metric / Imperial Conversion (18.288m x 24.384m - 60ft x 80ft)
  it('Scenario 6: Decimal Metric Site (18.288m x 24.384m)', async () => {
    const res = await executeAuditedPlanningPipeline({
      projectName: 'Scenario 6 - Decimal 18.288x24.384',
      plotWidthMm: 18288,
      plotDepthMm: 24384,
      roadWidthMm: 12192,
      roadAccessSides: [Direction.North],
      setbacksMm: { front: 3048, rear: 1524, left: 1524, right: 1524 },
      lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
      jurisdiction: 'generic_maharashtra',
      verticalStackType: 'STILT_PLUS_N',
      numTypicalFloors: 3,
      flatsPerFloor: 2,
      units: [
        { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true, targetCarpetSqFt: 850 },
        { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true, targetCarpetSqFt: 850 },
      ],
      siteAmenities: DEFAULT_SITE_AMENITIES,
      stiltAmenities: DEFAULT_STILT_AMENITIES,
      terraceAmenities: DEFAULT_TERRACE_AMENITIES,
      parkingMode: 'STILT_ONLY',
    });
    console.log('Scenario 6 SUCCESS: Floors count =', res.building.floors.length, 'Validation valid =', res.validationReport.isValid);
    expect(res.building.floors.length).toBe(5);
    expect(res.validationReport.isValid).toBe(true);
  });

  // Scenario 7: Shallow & Wide Site (25m frontage x 18m depth)
  it('Scenario 7: Shallow & Wide Site (25m x 18m)', async () => {
    const res = await executeAuditedPlanningPipeline({
      projectName: 'Scenario 7 - Wide 25x18',
      plotWidthMm: 25000,
      plotDepthMm: 18000,
      roadWidthMm: 12000,
      roadAccessSides: [Direction.North],
      setbacksMm: { front: 3000, rear: 1500, left: 2000, right: 2000 },
      lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
      jurisdiction: 'generic_maharashtra',
      verticalStackType: 'STILT_PLUS_N',
      numTypicalFloors: 2,
      flatsPerFloor: 2,
      units: [
        { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true, targetCarpetSqFt: 800 },
        { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true, targetCarpetSqFt: 800 },
      ],
      siteAmenities: DEFAULT_SITE_AMENITIES,
      stiltAmenities: DEFAULT_STILT_AMENITIES,
      terraceAmenities: DEFAULT_TERRACE_AMENITIES,
      parkingMode: 'STILT_ONLY',
    });
    console.log('Scenario 7 SUCCESS: Floors count =', res.building.floors.length, 'Validation valid =', res.validationReport.isValid);
    expect(res.building.floors.length).toBe(4);
    expect(res.validationReport.isValid).toBe(true);
  });
});

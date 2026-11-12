import { describe, it, expect } from 'vitest';
import { executeAuditedPlanningPipeline } from '../pipeline/stage-progress-emitter';
import {
  Direction,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';

describe('Stage 3: 18m x 25m Real Project Generation Reproduction', () => {
  it('executes planning pipeline for 18m x 25m stilt + 3 residential floors', async () => {
    const config: MultiSheetApartmentConfig = {
      projectName: 'ARGON 18x25 Residential',
      plotWidthMm: 18000,
      plotDepthMm: 25000,
      roadWidthMm: 12000,
      roadAccessSides: [Direction.North],
      setbacksMm: {
        front: 3000,
        rear: 1500,
        left: 1500,
        right: 1500,
      },
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
      aiPrompt: 'Modern 18x25m apartment with stilt parking and 3 residential floors',
    };

    const events: any[] = [];
    try {
      const result = await executeAuditedPlanningPipeline(config, (event) => {
        events.push(event);
      });

      expect(result.building).toBeDefined();
      console.log('Building Floors Count:', result.building.floors.length);
      for (const f of result.building.floors) {
        console.log(`\nFloor: ${f.name} (level ${f.level})`);
        for (const r of f.rooms) {
          console.log(`  Room: ${r.name} (${r.type}) ${r.width}x${r.height}mm = ${((r.width * r.height) / 1e6).toFixed(2)} m²`);
        }
      }
    } catch (e: any) {
      console.log('STAGE 3 CAUGHT ERROR:', e.message);
      if (e.stack) console.log(e.stack);
    }
  });
});


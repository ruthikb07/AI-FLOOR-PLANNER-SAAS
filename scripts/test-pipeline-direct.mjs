import { executeAuditedPlanningPipeline } from './packages/planning-engine/src/pipeline/stage-progress-emitter.ts';
import { Direction, DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES } from './packages/core/src/index.ts';

const config = {
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
    { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true, carpetAreaSqFt: 850 },
    { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true, carpetAreaSqFt: 850 },
  ],
  siteAmenities: DEFAULT_SITE_AMENITIES,
  stiltAmenities: DEFAULT_STILT_AMENITIES,
  terraceAmenities: DEFAULT_TERRACE_AMENITIES,
  parkingMode: 'STILT_ONLY',
  aiPrompt: 'Modern 18x25m apartment with stilt parking and 3 residential floors',
};

console.log('Starting executeAuditedPlanningPipeline direct run...');
try {
  const result = await executeAuditedPlanningPipeline(config, (event) => {
    console.log(`[Event] stage=${event.stage} status=${event.status} progress=${event.progressPercent}% duration=${event.currentStageDurationMs}ms`);
  });
  console.log('SUCCESS! Building generated:');
  console.log(`Building ID: ${result.building.id}`);
  console.log(`Floors count: ${result.building.floors.length}`);
  for (const f of result.building.floors) {
    console.log(`  Floor: ${f.name} (level ${f.level}) - ${f.rooms.length} rooms`);
    for (const r of f.rooms) {
      console.log(`    Room: ${r.name} (${r.type}) ${r.width}x${r.height}mm (${((r.width * r.height) / 1e6).toFixed(2)} m²)`);
    }
  }
} catch (error) {
  console.error('ERROR in executeAuditedPlanningPipeline:', error);
}


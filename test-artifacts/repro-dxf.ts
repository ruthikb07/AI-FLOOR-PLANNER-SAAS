import { CadExportService } from '../packages/backend/src/services/cad-export-service.ts';
import { generateHardenedResidential } from '../packages/planning-engine/src/structural/hardened-residential-generation.ts';
import { Direction } from '../packages/core/src/types/enums.ts';
import { DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES } from '../packages/core/src/types/multi-sheet-apartment.ts';

const genResult = generateHardenedResidential({
  projectId: 'test-proj',
  plotWidthMm: 18000,
  plotDepthMm: 25000,
  roadWidthMm: 12000,
  roadAccessSides: [Direction.North],
  lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
  jurisdiction: 'generic_maharashtra',
  verticalStackType: 'STILT_PLUS_N',
  numTypicalFloors: 3,
  flatsPerFloor: 2,
  units: [
    { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
    { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
  ],
  siteAmenities: DEFAULT_SITE_AMENITIES,
  stiltAmenities: DEFAULT_STILT_AMENITIES,
  terraceAmenities: DEFAULT_TERRACE_AMENITIES,
  parkingMode: 'STILT_ONLY',
});

const service = new CadExportService();
try {
  const result = service.exportCad(genResult.building, 'dxf');
  console.log('DXF Export succeeded! Length:', result.data.length);
} catch (e) {
  console.error('DXF Export threw error:', e);
}


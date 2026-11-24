import { describe, expect, it } from 'vitest';
import * as acad from '@node-projects/acad-ts';
import {
  CanonicalDxfExchangeAdapter,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  exchangeRevision,
  projectBuildingToCanonicalCad,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { executeAuditedPlanningPipeline } from '@ai-floor-planner/planning-engine';
import { CadExportService } from '../services/cad-export-service.js';
import { parseUploadedCadFile } from '../services/cad-layout-importer.js';

describe('Phase 4A Gate D — Real Building CAD Adapter, DXF/DWG Exchange & Round-Trip Verification', () => {
  it('verifies canonical CAD adapter + independent DXF readback + RH DWG/DXF exporter parity on straight & curved buildings', async () => {
    const baseConfig: MultiSheetApartmentConfig = {
      projectId: 'phase4a-cad-roundtrip',
      structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
      plotWidthMm: 32000,
      plotDepthMm: 36000,
      roadWidthMm: 12000,
      roadAccessSides: [Direction.South],
      jurisdiction: 'pune_pmc',
      lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
      verticalStackType: 'STILT_PLUS_N',
      numTypicalFloors: 2,
      floorToFloorHeightMm: 3150,
      stiltHeightMm: 3150,
      flatsPerFloor: 4,
      units: [1, 2, 3, 4].map(unitIndex => ({
        unitIndex,
        bhkType: '2BHK',
        targetCarpetSqFt: 850,
        hasUtilityBalcony: true,
      })),
      setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
      parkingMode: 'STILT_AND_SURFACE',
      siteAmenities: DEFAULT_SITE_AMENITIES,
      stiltAmenities: DEFAULT_STILT_AMENITIES,
      terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    };

    const { building } = await executeAuditedPlanningPipeline(baseConfig);
    const rev = exchangeRevision(building);

    // 1. Canonical CAD Adapter projection + ExchangeArtifact verification
    const cadDoc = projectBuildingToCanonicalCad(building);
    expect(cadDoc.expectedRevision).toBe(building.version);
    expect(cadDoc.sheets.length).toBe(building.floors.length);
    // Architecture-first: preliminary framing omitted by default and documented in conversionNotes
    expect(cadDoc.conversionNotes).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PROVISIONAL_FRAMING_EXCLUDED_BY_DEFAULT' })]),
    );

    const adapter = new CanonicalDxfExchangeAdapter();
    const artifact = await adapter.export(building, rev);
    const readback = await adapter.readback(artifact, rev, building);

    expect(readback.lostCanonicalIds).toEqual([]);
    expect(readback.changedHostIds).toEqual([]);
    expect(readback.maximumPositionErrorMm).toBeLessThanOrEqual(0.5);
    expect(readback.maximumArcDeviationMm).toBeLessThanOrEqual(1.0);
    expect(readback.maximumAreaErrorMm2).toBeLessThanOrEqual(10_000); // <= 0.01 m2 = 10,000 mm2

    // 2. Independent CAD Layout Importer readback of the Exchange DXF bytes
    const dxfBase64 = Buffer.from(artifact.bytes).toString('base64');
    const independentParsed = await parseUploadedCadFile({
      fileName: 'canonical-exchange.dxf',
      contentBase64: dxfBase64,
    });
    expect(independentParsed.format).toBe('dxf');
    expect(independentParsed.detectedUnit).toBe('mm');
    expect(independentParsed.layers.map(l => l.name)).toEqual(
      expect.arrayContaining(['A-SLAB', 'A-WALL-EXT', 'A-WALL-INT', 'A-ROOM', 'A-DOOR', 'A-WIND']),
    );
    expect(independentParsed.polylines.length).toBeGreaterThan(20);

    // 3. Compare with RH Planner's production AC1032 DWG & DXF exporters + independent ACadSharp DWG readback
    const exporter = new CadExportService();
    const residentialFloor = building.floors.find(f => f.apartmentUnits?.length)!;
    const rhDxf = exporter.exportCad(building, 'dxf', { floorId: residentialFloor.id, includeStructural: false });
    const rhDwg = exporter.exportCad(building, 'dwg', { floorId: residentialFloor.id, includeStructural: false });

    expect(rhDxf.validation.isValid).toBe(true);
    expect(rhDxf.validation.units).toBe('Millimeters');
    expect(rhDwg.validation.isValid).toBe(true);
    expect(rhDwg.data.byteLength).toBeGreaterThan(1000);

    // Independent binary DWG readback using @node-projects/acad-ts (same ACadSharp engine used by Cota)
    const reopenedDwg = new acad.DwgReader(rhDwg.data).read();
    expect(reopenedDwg.header?.insUnits).toBe(acad.UnitsType.Millimeters);
    expect([...(reopenedDwg.entities ?? [])].length).toBeGreaterThan(20);

    // 4. Curved massing (`ROTUNDA_COURTYARD` on compact plot) round-trip check
    const curvedResult = await executeAuditedPlanningPipeline({
      ...baseConfig,
      plotWidthMm: 18500,
      plotDepthMm: 25000,
      flatsPerFloor: 2,
      generationSeed: 3,
      units: [1, 2].map(unitIndex => ({ unitIndex, bhkType: '2BHK', hasUtilityBalcony: true })),
    });
    const curvedRev = exchangeRevision(curvedResult.building);
    const curvedArtifact = await adapter.export(curvedResult.building, curvedRev);
    const curvedReadback = await adapter.readback(curvedArtifact, curvedRev, curvedResult.building);
    expect(curvedReadback.lostCanonicalIds).toEqual([]);
    expect(curvedReadback.changedHostIds).toEqual([]);
    expect(curvedReadback.maximumPositionErrorMm).toBeLessThanOrEqual(0.5);
    expect(curvedReadback.maximumArcDeviationMm).toBeLessThanOrEqual(1.0);
  }, 60_000);
});

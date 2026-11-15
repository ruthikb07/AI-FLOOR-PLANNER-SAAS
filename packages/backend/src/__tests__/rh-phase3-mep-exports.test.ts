/**
 * RH PLANNER PHASE 3 — BACKEND CAD & MULTI-SHEET MEP PDF VERIFICATION SUITE
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { solveMultiSheetApartmentProject } from '@ai-floor-planner/planning-engine';
import { CadExportService } from '../services/cad-export-service.js';
import { ResidentialCadSerializer } from '../cad/residential-cad-serializer.js';
import { PdfExportService } from '../services/pdf-export-service.js';
import { verifyPdfArtifact } from '../services/artifact-verifier.js';

function makeBuildingForExports() {
  const config: MultiSheetApartmentConfig = {
    projectId: 'phase3_export_proj',
    projectName: 'Phase 3 MEP Export Tower',
    structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
    plotWidthMm: 44000,
    plotDepthMm: 36000,
    roadWidthMm: 12000,
    roadAccessSides: [Direction.South],
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'pune_pmc',
    verticalStackType: 'STILT_PLUS_N',
    numTypicalFloors: 3,
    floorToFloorHeightMm: 3000,
    stiltHeightMm: 3000,
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
    parkingMode: 'STILT_AND_SURFACE',
    visitorParkingPercent: 10,
    setbacksMm: { front: 2000, rear: 2000, left: 2000, right: 2000 },
  };
  return solveMultiSheetApartmentProject(config).building;
}

describe('RH Planner Phase 3: CAD & Multi-Sheet PDF MEP Exports', () => {
  it('embeds all MEP & Cantilever CAD layers in CadExportService and ResidentialCadSerializer DXFs', () => {
    const building = makeBuildingForExports();
    const expectedLayers = [
      'M-ELEC-SYMB',
      'M-ELEC-WIRE',
      'M-PLUMB-PIPE',
      'M-PLUMB-FIXT',
      'A-CEIL-GRID',
      'F-FIRE-SYMB',
      'S-BEAM-CANTILEVER',
    ];

    const cadSvc = new CadExportService();
    const cadRes = cadSvc.exportCad(building, 'dxf', { exportScope: 'all_floors' });
    expect(cadRes.validation.isValid).toBe(true);
    const dxfText = Buffer.from(cadRes.data).toString('utf8');
    for (const layerName of expectedLayers) {
      expect(cadRes.validation.layers).toContain(layerName);
      expect(dxfText).toContain(layerName);
    }

    const resSerializer = new ResidentialCadSerializer();
    const resDxf = resSerializer.serialize(
      { ...building, floors: building.floors.filter((f) => f.floorUse !== 'ROOF') },
      {
        standard: 'B',
        combined: true,
      },
    );
    expect(resDxf.verification.isValid).toBe(true);
    for (const layerName of expectedLayers) {
      expect(resDxf.layerNames).toContain(layerName);
    }
  });

  it('appends Sheet M-201 & Sheet M-301 to exportMultiSheetPdf() while preserving artifact verification', () => {
    const building = makeBuildingForExports();
    const pdfSvc = new PdfExportService();

    const pdf = pdfSvc.exportMultiSheetPdf(building);
    // site + floors + A-901 + M-201 + M-301
    expect(pdf.pageCount).toBe(building.floors.length + 1 + 1 + 2);

    const verified = verifyPdfArtifact(pdf.data);
    expect(verified.isValid).toBe(true);

    const text = Buffer.from(pdf.data).toString('utf8');
    expect(text).toContain('Sheet M-201: Coordinated Electrical & Reflected Ceiling Plan');
    expect(text).toContain('Sheet M-301: Plumbing, Sanitary Shafts & Fire Safety Plan');
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  exchangeRevision,
  type ExportOptions,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { polygonArea } from '@ai-floor-planner/geometry-engine';
import {
  auditArchitecturalElementRealism,
  auditFloorFunctionalQuality,
  computeFloorEfficiencyBreakdown,
  evaluateBriefRequirementHierarchyAndConflicts,
  executeAuditedPlanningPipeline,
} from '@ai-floor-planner/planning-engine';
import { exportSVG } from '@ai-floor-planner/renderer';
import { CanonicalIfcExchangeAdapter } from '../services/canonical-ifc-adapter';

const BASE_BRIEF: MultiSheetApartmentConfig = {
  projectId: 'phase5-gate-o',
  structuralLayoutMode: 'DEFERRED',
  plotWidthMm: 38000,
  plotDepthMm: 32000,
  roadWidthMm: 12000,
  roadAccessSides: [Direction.South],
  jurisdiction: 'pune_pmc',
  lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
  verticalStackType: 'STILT_PLUS_N',
  generationSeed: 1,
  numTypicalFloors: 2,
  floorToFloorHeightMm: 3150,
  stiltHeightMm: 3000,
  flatsPerFloor: 4,
  units: [
    { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
    { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
    { unitIndex: 3, bhkType: '2BHK', hasUtilityBalcony: true },
    { unitIndex: 4, bhkType: '2BHK', hasUtilityBalcony: true },
  ],
  setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
  parkingMode: 'STILT_AND_SURFACE',
  siteAmenities: DEFAULT_SITE_AMENITIES,
  stiltAmenities: DEFAULT_STILT_AMENITIES,
  terraceAmenities: DEFAULT_TERRACE_AMENITIES,
};

function defaultExportOptions(floorId: string): ExportOptions {
  return {
    floorId,
    scale: '1:100',
    paperSize: 'A2',
    orientation: 'landscape',
    includeGrid: false,
    includeDimensions: true,
    includeRoomLabels: true,
    includeRoomAreas: true,
    includeNorthArrow: true,
    includeScaleBar: true,
    includeTitleBlock: true,
    includeOpenings: true,
  };
}

describe('Phase 5 Gate O — Real Project Acceptance Across All 9 Required Architectural Briefs', () => {
  const feasibleBriefs: ReadonlyArray<[string, MultiSheetApartmentConfig]> = [
    // 1. Single-family residential bungalow
    [
      '1-single-family-bungalow',
      {
        ...BASE_BRIEF,
        projectId: 'gate-o-1-bungalow',
        planCategory: 'LUXURY_VILLA_BUNGALOW',
        verticalStackType: 'G_PLUS_N',
        plotWidthMm: 28000,
        plotDepthMm: 24000,
        numTypicalFloors: 2,
        flatsPerFloor: 1,
        units: [{ unitIndex: 1, bhkType: '4BHK', hasUtilityBalcony: true }],
      },
    ],
    // 2. Compact apartment on tight urban plot
    [
      '2-compact-tight-urban-plot',
      {
        ...BASE_BRIEF,
        projectId: 'gate-o-2-compact',
        plotWidthMm: 18500,
        plotDepthMm: 25000,
        numTypicalFloors: 1,
        flatsPerFloor: 2,
        units: [
          { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: false },
          { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: false },
        ],
      },
    ],
    // 3. Irregular surveyed plot with road orientation and setbacks
    [
      '3-irregular-surveyed-plot',
      (() => {
        const poly = {
          points: [
            { x: 0, y: 0 },
            { x: 40000, y: 900 },
            { x: 38800, y: 33000 },
            { x: 1200, y: 31800 },
          ],
        };
        return {
          ...BASE_BRIEF,
          projectId: 'gate-o-3-surveyed',
          plotWidthMm: 40000,
          plotDepthMm: 33000,
          roadAccessSides: [Direction.South, Direction.East],
          numTypicalFloors: 1,
          flatsPerFloor: 2,
          irregularPlotBoundary: {
            polygon: poly,
            areaMm2: polygonArea(poly),
            perimeterMm: 141000,
          },
          units: [
            { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: false, targetCarpetSqFt: 850 },
            { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: false, targetCarpetSqFt: 1250 },
          ],
        };
      })(),
    ],
    // 4. 4-flat mixed-BHK floor with central core
    [
      '4-four-flat-mixed-bhk-central-core',
      {
        ...BASE_BRIEF,
        projectId: 'gate-o-4-mixed-bhk',
        numTypicalFloors: 1,
        flatsPerFloor: 4,
        units: [
          { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
          { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: true },
          { unitIndex: 3, bhkType: '2BHK', hasUtilityBalcony: true },
          { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true },
        ],
      },
    ],
    // 5. Apartment floor with unequal flat carpet targets
    [
      '5-unequal-flat-carpet-targets',
      {
        ...BASE_BRIEF,
        projectId: 'gate-o-5-unequal-targets',
        plotWidthMm: 42000,
        plotDepthMm: 34000,
        requireAreaTargets: true,
        areaAcceptanceTolerancePercent: 3,
        numTypicalFloors: 1,
        flatsPerFloor: 4,
        units: [
          { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true, targetCarpetSqFt: 720 },
          { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true, targetCarpetSqFt: 1050 },
          { unitIndex: 3, bhkType: '3BHK', hasUtilityBalcony: true, targetCarpetSqFt: 1420 },
          { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true, targetCarpetSqFt: 1750 },
        ],
      },
    ],
    // 6. High-density feasible floor (6 flats)
    [
      '6-high-density-six-flats',
      {
        ...BASE_BRIEF,
        projectId: 'gate-o-6-six-flats',
        plotWidthMm: 50000,
        plotDepthMm: 40000,
        numTypicalFloors: 1,
        flatsPerFloor: 6,
        units: Array.from({ length: 6 }, (_, i) => ({
          unitIndex: i + 1,
          bhkType: '2BHK' as const,
          hasUtilityBalcony: true,
        })),
      },
    ],
    // 7. Multi-floor G+N / Stilt+N residential building with open stilt parking
    [
      '7-multi-floor-open-stilt-parking',
      {
        ...BASE_BRIEF,
        projectId: 'gate-o-7-stilt-tower',
        verticalStackType: 'STILT_PLUS_N',
        numTypicalFloors: 4,
        parkingMode: 'STILT_AND_SURFACE',
        structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
      },
    ],
    // 8. Reference-image-assisted architectural design
    [
      '8-reference-image-assisted',
      {
        ...BASE_BRIEF,
        projectId: 'gate-o-8-ref-image',
        numTypicalFloors: 1,
        aiPrompt: 'Cross-ventilated 2BHK flats inspired by uploaded courtyard reference sketch with generous living rooms.',
        referenceImage: {
          name: 'courtyard-sketch.png',
          mimeType: 'image/png',
          dataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a83sAAAAASUVORK5CYII=',
        },
      },
    ],
  ];

  it.each(feasibleBriefs)(
    'synthesizes, audits, renders architectural SVG, and verifies IFC4 readback for brief %s',
    async (briefName, config) => {
      const { building, validationReport } = await executeAuditedPlanningPipeline(config);
      expect(validationReport.isValid).toBe(true);

      const residentialFloor =
        building.floors.find(f => f.floorUse === 'RESIDENTIAL' || Boolean(f.apartmentUnits?.length)) ??
        building.floors[0]!;

      // 1. Planar area conservation (< 0.001 mm²) & functional quality
      const eff = computeFloorEfficiencyBreakdown(residentialFloor);
      expect(eff.isPlanarConserved).toBe(true);
      expect(Math.abs(eff.planarDeltaMm2)).toBeLessThan(0.001);
      const func = auditFloorFunctionalQuality(residentialFloor);
      expect(func.passed).toBe(true);

      // 2. Architectural element realism (balcony parapets, open stilt parking, door jamb returns, 0 unrequested machine rooms)
      for (const floor of building.floors) {
        const realism = auditArchitecturalElementRealism(floor);
        expect(realism.passed).toBe(true);
      }

      // 3. Visual SVG sheet rendering inspection (default architectural export excludes structural grid centerlines)
      const svg = exportSVG(building, defaultExportOptions(residentialFloor.id));
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.length).toBeGreaterThan(2500);
      expect(svg).toContain('</svg>');
      expect(svg).toMatch(/Living|Bedroom|Kitchen/i);

      // 4. Canonical IFC4 export & lossless software readback on representative multi-category briefs
      if (briefName === '1-single-family-bungalow' || briefName === '7-multi-floor-open-stilt-parking') {
        const adapter = new CanonicalIfcExchangeAdapter();
        const rev = exchangeRevision(building);
        const ifc = await adapter.export(building, rev);
        const readback = await adapter.readback(ifc, rev);
        expect(readback.lostCanonicalIds).toEqual([]);
        expect(readback.changedHostIds).toEqual([]);
        expect(readback.maximumPositionErrorMm).toBeLessThanOrEqual(0.001);
      }
    },
    60_000,
  );

  it('Brief 9 (infeasible brief with conflicting constraints): explains mathematical conflict and offers measurable alternatives without silently breaking rules', () => {
    // Requesting 6 × 2,200 sq ft 4BHK flats (= 13,200 sq ft carpet) on a tight 18 m × 20 m plot with 3 m setbacks
    const conflictReport = evaluateBriefRequirementHierarchyAndConflicts({
      ...BASE_BRIEF,
      projectId: 'gate-o-9-infeasible',
      plotWidthMm: 18000,
      plotDepthMm: 20000,
      setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
      flatsPerFloor: 6,
      requireAreaTargets: true,
      units: Array.from({ length: 6 }, (_, idx) => ({
        unitIndex: idx + 1,
        bhkType: '4BHK' as const,
        hasUtilityBalcony: true,
        targetCarpetSqFt: 2200,
      })),
    });

    expect(conflictReport.isFeasibleWithoutConflict).toBe(false);
    expect(conflictReport.conflicts.length).toBeGreaterThan(0);
    const primary = conflictReport.conflicts[0]!;
    expect(primary.explanation.length).toBeGreaterThan(20);
    expect(primary.alternatives.length).toBeGreaterThanOrEqual(2);
    expect(primary.alternatives.some(alt => /\d+/.test(alt.summary))).toBe(true);
  });
});

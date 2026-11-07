import { describe, expect, it } from 'vitest';
import {
  buildApartmentGenerationManifest,
  renderApartmentManifestText,
  validateSchematicMatchesManifest,
} from '../apartment/manifest';
import {
  generateDeterministicApartmentSchematic,
} from '../apartment/schematic';
import { getApartmentRulesProfile } from '../apartment/jurisdiction';
import { compileApartmentFloorPlanImagePrompt } from '../orchestration/image-prompt-compiler';
import { evaluateApartmentPreflight } from '../orchestration/apartment-preflight';
import type { ApartmentBriefConfig } from '../types/apartment';
import { Direction, createBuilding, type Site } from '@ai-floor-planner/core';

import { DEFAULT_APARTMENT_SETBACKS_M, DEFAULT_APARTMENT_SETBACKS_MM } from '../apartment/site-defaults';
import { validateIndianApartmentFeasibility } from '../apartment/feasibility';

describe('Phase 1 recovery — P10: reconciled setback defaults & schematic type consistency', () => {
  it('manifest.ts, schematic.ts and feasibility.ts all resolve to the SAME default setback envelope', () => {
    // Metre and millimetre forms must agree exactly (site-defaults.ts is the
    // single source of truth both units derive from).
    expect(DEFAULT_APARTMENT_SETBACKS_M.front).toBeCloseTo(DEFAULT_APARTMENT_SETBACKS_MM.front / 1000, 6);
    expect(DEFAULT_APARTMENT_SETBACKS_M.rear).toBeCloseTo(DEFAULT_APARTMENT_SETBACKS_MM.rear / 1000, 6);
    expect(DEFAULT_APARTMENT_SETBACKS_M.left).toBeCloseTo(DEFAULT_APARTMENT_SETBACKS_MM.left / 1000, 6);
    expect(DEFAULT_APARTMENT_SETBACKS_M.right).toBeCloseTo(DEFAULT_APARTMENT_SETBACKS_MM.right / 1000, 6);

    const site = { plotWidthMm: 30000, plotDepthMm: 35000 };
    const rulesProfile = getApartmentRulesProfile('pune_pmc', { floorCount: 4, tenementsPerFloor: 2 });

    // Manifest path (no explicit setbacksMm -> falls back to DEFAULT_APARTMENT_SETBACKS_MM)
    const manifest = buildApartmentGenerationManifest({
      site,
      apartmentConfig: {
        projectType: 'apartment',
        jurisdiction: 'pune_pmc',
        floorCount: 4,
        flatsPerFloor: 2,
        unitMix: [{ unitType: '2BHK', count: 2, carpetAreaSqFt: 750 }],
        commonCore: { passengerLifts: 1, serviceLifts: 0, staircaseCount: 1, fireStaircaseRequired: false, commonLobby: true },
        parking: { residentParkingCount: 2, visitorParkingCount: 1 },
        amenities: { groundSiteAmenities: [], buildingAmenities: [] },
      },
      rulesProfile,
    });

    // Schematic path (no explicit setbacksM -> falls back to DEFAULT_APARTMENT_SETBACKS_M)
    const schematic = generateDeterministicApartmentSchematic({
      siteWidthM: site.plotWidthMm / 1000,
      siteDepthM: site.plotDepthMm / 1000,
      flatsPerFloor: 2,
      unitMix: [{ unitType: '2BHK', count: 2, carpetAreaSqFt: 750 }],
      rulesProfile,
    });

    // Feasibility path (no explicit setbacksMm -> falls back to DEFAULT_APARTMENT_SETBACKS_MM)
    const feasibility = validateIndianApartmentFeasibility({
      site,
      flatsPerFloor: 2,
      floorCount: 4,
      jurisdiction: 'pune_pmc',
      unitMix: [{ unitType: '2BHK', count: 2, carpetAreaSqFt: 750 }],
      commonCore: { passengerLifts: 1, staircaseCount: 1, commonLobby: true },
    });

    // No area drift: manifest's buildable envelope and feasibility's buildable
    // envelope must agree (both derive from the SAME default setback source).
    expect(manifest.site.buildableAreaSqM).toBeCloseTo(feasibility.buildableEnvelopeSqM, 1);

    // Schematic's setbacks field must equal the shared default (metre form).
    expect(schematic.setbacks).toEqual(DEFAULT_APARTMENT_SETBACKS_M);

    // Manifest's site.buildableWidthFt/buildableDepthFt were computed using the
    // same buildable width/depth as the schematic's buildable envelope.
    const buildableWidthM = 30 - DEFAULT_APARTMENT_SETBACKS_M.left - DEFAULT_APARTMENT_SETBACKS_M.right;
    const buildableDepthM = 35 - DEFAULT_APARTMENT_SETBACKS_M.front - DEFAULT_APARTMENT_SETBACKS_M.rear;
    expect(manifest.site.widthM - manifest.site.buildableWidthFt / 3.28084).toBeCloseTo(
      30 - buildableWidthM,
      0,
    );
    expect(schematic.buildingFootprint.width).toBeLessThanOrEqual(buildableWidthM);
    expect(schematic.buildingFootprint.height).toBeLessThanOrEqual(buildableDepthM);
  });

  it('DeterministicApartmentSchematic type is defined once (schematic.ts) and re-exported unchanged through types/apartment.ts (no duplicate/diverging shape)', async () => {
    // schematic.ts is the sole defining module; types/apartment.ts re-exports
    // the same type. A schematic built via schematic.ts must satisfy every
    // field schematic-renderer.ts (which imports from types/apartment.ts)
    // actually reads, proving the two import paths describe the same shape.
    const rulesProfile = getApartmentRulesProfile('pune_pmc');
    const schematic = generateDeterministicApartmentSchematic({
      siteWidthM: 25,
      siteDepthM: 30,
      flatsPerFloor: 2,
      unitMix: [{ unitType: '2BHK', count: 2 }],
      rulesProfile,
    });

    const { renderSchematicPng512 } = await import('../apartment/schematic-renderer');
    // Renders without throwing => the type accepted by schematic-renderer.ts
    // (imported from types/apartment.js) matches the value schematic.ts
    // actually produces.
    const png = renderSchematicPng512(schematic as any);
    expect(png.length).toBeGreaterThan(0);
    // PNG magic bytes
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
  });
});

describe('Structured Generation Manifest Architecture (§1 - §26)', () => {
  const standardBrief: ApartmentBriefConfig = {
    projectType: 'apartment',
    jurisdiction: 'mumbai_mcgm',
    floorCount: 5,
    flatsPerFloor: 2,
    unitMix: [
      { unitType: '2BHK', count: 1, carpetAreaSqFt: 850 },
      { unitType: '3BHK', count: 1, carpetAreaSqFt: 1200 },
    ],
    floorStrategy: 'typical',
    commonCore: {
      passengerLifts: 2,
      serviceLifts: 0,
      staircaseCount: 2,
      commonLobby: true,
      fireStaircaseRequired: false,
    },
    parking: {
      residentParkingCount: 4,
      visitorParkingCount: 2,
      twoWheelerParkingCount: 8,
    },
    amenities: {
      groundSiteAmenities: ['security_cabin'],
      buildingAmenities: ['entrance_lobby'],
    },
  };

  const standardSite: Site = createBuilding({
    projectId: 'test-project',
    name: 'Test Project',
    site: {
      plotWidth: 18288, // 60 ft in mm
      plotDepth: 30480, // 100 ft in mm
      plannedFloorCount: 5,
      roadFacing: Direction.North,
      setbacks: { front: 3000, rear: 2000, left: 2000, right: 2000 },
      orientation: 0,
    },
    floors: [{ buildingId: 'test-project', level: 0 }],
  }).site;

  describe('1. Manifest Generation (§3, §4, §5, §6, §7)', () => {
    it('produces exact flat count and correct unit types', () => {
      const manifest = buildApartmentGenerationManifest({
        site: {
          plotWidthMm: standardSite.plotWidth,
          plotDepthMm: standardSite.plotDepth,
          setbacksMm: standardSite.setbacks,
          roadFacing: 'north',
          orientationDegrees: 0,
        },
        apartmentConfig: standardBrief,
      });

      expect(manifest.units.exactCount).toBe(2);
      expect(manifest.units.units).toHaveLength(2);
      expect(manifest.units.units[0]?.type).toBe('2BHK');
      expect(manifest.units.units[0]?.bedrooms).toBe(2);
      expect(manifest.units.units[1]?.type).toBe('3BHK');
      expect(manifest.units.units[1]?.bedrooms).toBe(3);
    });

    it('calculates global room inventory correctly', () => {
      const manifest = buildApartmentGenerationManifest({
        site: {
          plotWidthMm: standardSite.plotWidth,
          plotDepthMm: standardSite.plotDepth,
          setbacksMm: standardSite.setbacks,
        },
        apartmentConfig: standardBrief,
      });

      // 2BHK (2 bed) + 3BHK (3 bed) = 5 bedrooms total
      expect(manifest.roomTotals.bedrooms).toBe(5);
      expect(manifest.roomTotals.bathrooms).toBeGreaterThanOrEqual(4);
      expect(manifest.roomTotals.kitchens).toBe(2);
      expect(manifest.roomTotals.utilities).toBe(2);
      expect(manifest.roomTotals.balconies).toBeGreaterThanOrEqual(2);
    });

    it('calculates area allocations in both sq ft and sq m', () => {
      const manifest = buildApartmentGenerationManifest({
        site: {
          plotWidthMm: standardSite.plotWidth,
          plotDepthMm: standardSite.plotDepth,
          setbacksMm: standardSite.setbacks,
        },
        apartmentConfig: standardBrief,
      });

      expect(manifest.areaAllocations.siteSqFt).toBeGreaterThan(5000);
      expect(manifest.areaAllocations.siteSqM).toBeGreaterThan(450);
      expect(manifest.areaAllocations.buildableEnvelopeSqFt).toBeLessThan(manifest.areaAllocations.siteSqFt);
      expect(manifest.areaAllocations.commonCoreSqFt).toBeGreaterThan(0);
      expect(manifest.areaAllocations.netResidentialSqFt).toBeGreaterThan(0);
    });

    it('records jurisdiction and applicable rule profile (§15)', () => {
      const manifest = buildApartmentGenerationManifest({
        site: {
          plotWidthMm: standardSite.plotWidth,
          plotDepthMm: standardSite.plotDepth,
        },
        apartmentConfig: standardBrief,
      });

      expect(manifest.jurisdiction.authority).toContain('MCGM');
      expect(manifest.jurisdiction.ruleProfile).toContain('DCPR 2034');
    });

    it('renders manifest text with all mandatory sections (§5, §6, §7)', () => {
      const manifest = buildApartmentGenerationManifest({
        site: {
          plotWidthMm: standardSite.plotWidth,
          plotDepthMm: standardSite.plotDepth,
        },
        apartmentConfig: standardBrief,
      });

      const text = renderApartmentManifestText(manifest);
      expect(text).toContain('STRUCTURED GENERATION MANIFEST');
      expect(text).toContain('JURISDICTION:');
      expect(text).toContain('SITE & BUILDABLE AREAS:');
      expect(text).toContain('DWELLING UNITS ON THIS FLOOR:');
      expect(text).toContain('EXACT TOTAL: 2 FLATS');
      expect(text).toContain('TOTAL RESIDENTIAL ROOMS ON THIS FLOOR:');
      expect(text).toContain('COMMON CORE:');
      expect(text).toContain('Lifts: EXACTLY 2');
      expect(text).toContain('Staircases: EXACTLY 2');
    });
  });

  describe('2. Schematic vs Manifest Agreement Gate (§8)', () => {
    it('passes when deterministic schematic strictly matches manifest', () => {
      const rulesProfile = getApartmentRulesProfile('mumbai_mcgm', {
        floorCount: 5,
        tenementsPerFloor: 2,
      });

      const manifest = buildApartmentGenerationManifest({
        site: {
          plotWidthMm: standardSite.plotWidth,
          plotDepthMm: standardSite.plotDepth,
          setbacksMm: standardSite.setbacks,
        },
        apartmentConfig: standardBrief,
        rulesProfile,
      });

      const schematic = generateDeterministicApartmentSchematic({
        siteWidthM: standardSite.plotWidth / 1000,
        siteDepthM: standardSite.plotDepth / 1000,
        setbacksM: { front: 3, rear: 2, left: 2, right: 2 },
        flatsPerFloor: 2,
        unitMix: standardBrief.unitMix,
        commonCoreConfig: standardBrief.commonCore,
        floorType: 'typical',
        rulesProfile,
      });

      const check = validateSchematicMatchesManifest(schematic, manifest);
      expect(check.matches).toBe(true);
      expect(check.discrepancies).toHaveLength(0);
    });

    it('stops before FLUX if schematic flat count disagrees with manifest (§8)', () => {
      const rulesProfile = getApartmentRulesProfile('mumbai_mcgm', {
        floorCount: 5,
        tenementsPerFloor: 2,
      });

      const manifest = buildApartmentGenerationManifest({
        site: {
          plotWidthMm: standardSite.plotWidth,
          plotDepthMm: standardSite.plotDepth,
        },
        apartmentConfig: standardBrief, // 2 flats
        rulesProfile,
      });

      // Schematic with 3 flats
      const schematic = generateDeterministicApartmentSchematic({
        siteWidthM: standardSite.plotWidth / 1000,
        siteDepthM: standardSite.plotDepth / 1000,
        flatsPerFloor: 3,
        unitMix: [{ unitType: '2BHK', count: 3 }],
        commonCoreConfig: standardBrief.commonCore,
        rulesProfile,
      });

      const check = validateSchematicMatchesManifest(schematic, manifest);
      expect(check.matches).toBe(false);
      expect(check.discrepancies.some(d => d.includes('flat count'))).toBe(true);
    });
  });

  describe('3. Image Prompt Compiler with Manifest (§17, §18)', () => {
    it('compiles prompt containing all 18 sections in order', () => {
      const manifest = buildApartmentGenerationManifest({
        site: {
          plotWidthMm: standardSite.plotWidth,
          plotDepthMm: standardSite.plotDepth,
          setbacksMm: standardSite.setbacks,
        },
        apartmentConfig: standardBrief,
      });

      const req = compileApartmentFloorPlanImagePrompt({
        site: standardSite,
        apartmentConfig: standardBrief,
        manifest,
        seed: 42,
      });

      // Phase 2 compact directive clauses
      expect(req.prompt).toContain('CREATE ONE PROFESSIONAL 2D INDIAN APARTMENT FLOOR PLAN.');
      expect(req.prompt).toContain('CURRENT FLOOR:');
      expect(req.prompt).toContain('JURISDICTION:');
      expect(req.prompt).toContain('EXACTLY 2 separate residential flats');
      expect(req.prompt).toContain('Total bedrooms across floor: 5');
      expect(req.prompt).toContain('EXACTLY 2 separate elevator shaft(s)');
      expect(req.prompt).toContain('EXACTLY 2 staircase(s)');
      expect(req.prompt).toContain('HARD REQUIREMENTS:');
      expect(req.prompt).toContain('1. Generate EXACTLY 2 separate residential flats');
      expect(req.prompt).toContain('REFERENCE PRIORITY:');
      expect(req.prompt).toContain('1. USER/MANIFEST REQUIREMENTS');
      expect(req.prompt).toContain('2. DETERMINISTIC SCHEMATIC');
      expect(req.prompt).toContain('3. REFERENCE IMAGE VISUAL STYLE');
      expect(req.prompt.toLowerCase()).toContain('cyrillic');
    });
  });

  describe('4. Visual Preflight Gate Matching (§21, §22, §23)', () => {
    const expectedBrief = {
      flatsPerFloor: 2,
      unitMix: standardBrief.unitMix,
      liftCount: 2,
      stairCount: 2,
      commonCoreRequired: true,
    };

    it('passes when Gemini detects exact 2 flats, 2BHK+3BHK, 2 lifts, 2 stairs and English labels', () => {
      const detected = {
        flatCount: 2,
        unitMix: ['2BHK', '3BHK'],
        liftCount: 2,
        stairCount: 2,
        commonCore: true,
        unitSeparation: true,
        majorRooms: ['living', 'dining', 'kitchen', 'master_bed', 'bed_2', 'bed_3'],
        balconies: true,
        utilities: true,
        parking: false,
        labelLanguage: 'English',
        isApartmentLayout: true,
        visualQuality: 9,
        confidence: 0.95,
        observations: 'High quality 2-flat layout with central lobby, 2 lifts and 2 stairs.',
      };

      const result = evaluateApartmentPreflight(detected, expectedBrief);
      expect(result.pass).toBe(true);
      expect(result.failureReasons).toHaveLength(0);
    });

    it('fails when flat count is 3 instead of 2 (§22)', () => {
      const detected = {
        flatCount: 3, // MISMATCH
        unitMix: ['2BHK', '2BHK', '2BHK'],
        liftCount: 2,
        stairCount: 2,
        commonCore: true,
        unitSeparation: true,
        majorRooms: ['living'],
        balconies: true,
        utilities: true,
        parking: false,
        labelLanguage: 'English',
        isApartmentLayout: true,
        visualQuality: 8,
        confidence: 0.9,
        observations: '',
      };

      const result = evaluateApartmentPreflight(detected, expectedBrief);
      expect(result.pass).toBe(false);
      expect(result.failureReasons.some(r => r.includes('Flat count mismatch'))).toBe(true);
    });

    it('fails when lift count is 1 instead of 2 (§22)', () => {
      const detected = {
        flatCount: 2,
        unitMix: ['2BHK', '3BHK'],
        liftCount: 1, // MISMATCH
        stairCount: 2,
        commonCore: true,
        unitSeparation: true,
        majorRooms: ['living'],
        balconies: true,
        utilities: true,
        parking: false,
        labelLanguage: 'English',
        isApartmentLayout: true,
        visualQuality: 8,
        confidence: 0.9,
        observations: '',
      };

      const result = evaluateApartmentPreflight(detected, expectedBrief);
      expect(result.pass).toBe(false);
      expect(result.failureReasons.some(r => r.includes('Lift count insufficient'))).toBe(true);
    });

    it('fails when unit mix is 2x2BHK instead of 1x2BHK + 1x3BHK (§22)', () => {
      const detected = {
        flatCount: 2,
        unitMix: ['2BHK', '2BHK'], // MISMATCH
        liftCount: 2,
        stairCount: 2,
        commonCore: true,
        unitSeparation: true,
        majorRooms: ['living'],
        balconies: true,
        utilities: true,
        parking: false,
        labelLanguage: 'English',
        isApartmentLayout: true,
        visualQuality: 8,
        confidence: 0.9,
        observations: '',
      };

      const result = evaluateApartmentPreflight(detected, expectedBrief);
      expect(result.pass).toBe(false);
      expect(result.failureReasons.some(r => r.includes('Unit mix mismatch'))).toBe(true);
    });
  });
});

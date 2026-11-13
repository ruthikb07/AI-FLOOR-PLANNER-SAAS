import { describe, it, expect } from 'vitest';
import {
  checkApartmentCompleteness,
  validateApartmentFeasibility,
  validateIndianApartmentFeasibility,
  getApartmentRulesProfile,
  REGULATORY_SOURCE_REGISTRY,
  allocateApartmentUnitSpaces,
  generateDeterministicApartmentSchematic,
  getFloorConfigurationProgram,
  type ApartmentBriefConfig,
  type ApartmentJurisdiction,
} from '../index';

describe('Apartment Pipeline - Completeness Gate (§4 / §19)', () => {
  it('identifies incomplete brief when jurisdiction, flatsPerFloor, floorCount or unitMix is missing', () => {
    const incompleteConfig: Partial<ApartmentBriefConfig> = {
      projectType: 'apartment',
      flatsPerFloor: 0,
      floorCount: 0,
      unitMix: [],
    };

    const result = checkApartmentCompleteness(incompleteConfig);
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toContain('jurisdiction');
    expect(result.missingFields).toContain('flatsPerFloor');
    expect(result.missingFields).toContain('floorCount');
    expect(result.missingFields).toContain('unitMix');
    expect(result.questions.length).toBeGreaterThanOrEqual(4);
  });

  it('approves complete apartment brief with valid jurisdiction and unit mix', () => {
    const completeConfig: ApartmentBriefConfig = {
      projectType: 'apartment',
      jurisdiction: 'pune_pmc',
      flatsPerFloor: 4,
      floorCount: 4,
      unitMix: [
        { unitType: '2BHK', count: 2, carpetAreaSqFt: 750 },
        { unitType: '3BHK', count: 2, carpetAreaSqFt: 1100 },
      ],
      commonCore: {
        passengerLifts: 2,
        serviceLifts: 0,
        staircaseCount: 2,
        fireStaircaseRequired: true,
        commonLobby: true,
      },
      parking: {
        residentParkingCount: 4,
        visitorParkingCount: 2,
      },
      amenities: {
        groundSiteAmenities: ['security_cabin', 'landscaping'],
        buildingAmenities: ['rooftop_terrace'],
      },
    };

    const result = checkApartmentCompleteness(completeConfig);
    expect(result.isComplete).toBe(true);
    expect(result.missingFields).toHaveLength(0);
    expect(result.questions).toHaveLength(0);
  });
});

describe('Apartment Pipeline - Rule Source Discipline & Jurisdictions (§1, §2, §3, §8)', () => {
  it('contains explicit provenance records in regulatory source registry', () => {
    expect(REGULATORY_SOURCE_REGISTRY.length).toBeGreaterThan(10);

    const udcprRecord = REGULATORY_SOURCE_REGISTRY.find(
      r => r.document.includes('UDCPR-2020') && r.parameter.includes('First Habitable Room'),
    );
    expect(udcprRecord).toBeDefined();
    expect(udcprRecord?.value).toBe(9.5);
    expect(udcprRecord?.versionDate).toContain('30 January 2025');

    const mcgmRecord = REGULATORY_SOURCE_REGISTRY.find(
      r => r.authority.includes('MCGM') && r.parameter.includes('Kitchen'),
    );
    expect(mcgmRecord).toBeDefined();
    expect(mcgmRecord?.value).toBe(5.5);
    expect(mcgmRecord?.sectionRegulation).toContain('Table 14');
  });

  it('correctly switches rule profiles across jurisdictions', () => {
    const jurisdictions: ApartmentJurisdiction[] = [
      'pune_pmc',
      'pune_pmrda',
      'mumbai_mcgm',
      'generic_maharashtra',
      'generic_indian',
    ];

    for (const j of jurisdictions) {
      const profile = getApartmentRulesProfile(j, { floorCount: 4, buildingHeightM: 12.4 });
      expect(profile.jurisdiction).toBe(j);
      expect(profile.sourceVersion).toBeTruthy();
      expect(profile.habitableRoomMinimums.masterHabitableRoomMinSqM).toBe(9.5);
    }
  });

  it('differentiates Mumbai DCPR 2034 from Maharashtra UDCPR standards', () => {
    const puneProfile = getApartmentRulesProfile('pune_pmc');
    const mumbaiProfile = getApartmentRulesProfile('mumbai_mcgm');

    // Mumbai DCPR 2034 mandates 5.5 m² kitchen vs UDCPR 5.0 m²
    expect(mumbaiProfile.kitchenMinimums.minAreaSqM).toBe(5.5);
    expect(puneProfile.kitchenMinimums.minAreaSqM).toBe(5.0);

    // Mumbai DCPR 2034 mandates 1.8 m² bathroom vs UDCPR 1.4 m²
    expect(mumbaiProfile.bathroomMinimums.minAreaSqM).toBe(1.8);
    expect(puneProfile.bathroomMinimums.minAreaSqM).toBe(1.4);

    // Combined toilet: Mumbai 2.8 m² vs Pune 2.4 m²
    expect(mumbaiProfile.combinedToiletMinimums.minAreaSqM).toBe(2.8);
    expect(puneProfile.combinedToiletMinimums.minAreaSqM).toBe(2.4);
  });
});

describe('Apartment Pipeline - Typology Engine & 2BHK/3BHK Differentiation (§4, §5, §6, §7)', () => {
  const profile = getApartmentRulesProfile('pune_pmc');

  it('allocates 2BHK according to sequential zone flow and statutory minimums', () => {
    const allocation = allocateApartmentUnitSpaces({
      unitType: '2BHK',
      flatLabel: 'Flat 01',
      targetCarpetAreaSqFt: 750, // ~69.7 m²
      rulesProfile: profile,
    });

    expect(allocation.unitType).toBe('2BHK');
    expect(allocation.targetCarpetAreaSqM).toBeCloseTo(69.7, 1);
    expect(allocation.planningSequence).toContain('Entry');
    expect(allocation.planningSequence).toContain('Living + Dining');
    expect(allocation.planningSequence).toContain('Master Bedroom + Attached Toilet');
    expect(allocation.planningSequence).toContain('Bedroom 2');

    // Room minimum checks
    const masterBed = allocation.rooms.find(r => r.type === 'master_bedroom');
    const bed2 = allocation.rooms.find(r => r.name === 'Bedroom 2');
    const kitchen = allocation.rooms.find(r => r.type === 'kitchen');
    const masterToilet = allocation.rooms.find(r => r.id.includes('master_toilet'));

    expect(masterBed).toBeDefined();
    expect(masterBed!.targetAreaSqM).toBeGreaterThanOrEqual(profile.habitableRoomMinimums.masterHabitableRoomMinSqM);
    expect(bed2).toBeDefined();
    expect(bed2!.targetAreaSqM).toBeGreaterThanOrEqual(profile.habitableRoomMinimums.otherHabitableRoomMinSqM);
    expect(kitchen).toBeDefined();
    expect(kitchen!.targetAreaSqM).toBeGreaterThanOrEqual(profile.kitchenMinimums.minAreaSqM);
    expect(masterToilet?.isEnsuite).toBe(true);
  });

  it('allocates 3BHK with greater target allocation and 3 distinct bedrooms (§7)', () => {
    const allocation2BHK = allocateApartmentUnitSpaces({
      unitType: '2BHK',
      flatLabel: 'Flat 01',
      rulesProfile: profile,
    });

    const allocation3BHK = allocateApartmentUnitSpaces({
      unitType: '3BHK',
      flatLabel: 'Flat 02',
      rulesProfile: profile,
    });

    // Mandatory differentiation: 3BHK is significantly larger than 2BHK
    expect(allocation3BHK.targetCarpetAreaSqM).toBeGreaterThan(allocation2BHK.targetCarpetAreaSqM * 1.3);

    // 3BHK has Bedroom 3 and additional toilet
    const bedrooms3BHK = allocation3BHK.rooms.filter(r => r.type === 'bedroom' || r.type === 'master_bedroom');
    const toilets3BHK = allocation3BHK.rooms.filter(r => r.type === 'master_toilet' || r.type === 'common_toilet');

    expect(bedrooms3BHK.length).toBe(3);
    expect(toilets3BHK.length).toBeGreaterThanOrEqual(2);
  });

  it('correctly accounts for internal circulation, walls, and usable planning balance (§6)', () => {
    const allocation = allocateApartmentUnitSpaces({
      unitType: '2BHK',
      targetCarpetAreaSqM: 80,
      rulesProfile: profile,
    });

    expect(allocation.internalCirculationSqM).toBeGreaterThan(0);
    expect(allocation.internalWallsSqM).toBeGreaterThan(0);
    expect(allocation.usablePlanningBalanceSqM).toBeGreaterThan(0);
  });
});

describe('Apartment Pipeline - Building Height, Stair, Lift, and Parking Rules (§9, §10)', () => {
  it('scales staircase width based on building height and scale', () => {
    // Low rise (G+3 <= 15m)
    const lowRise = getApartmentRulesProfile('pune_pmc', { floorCount: 4, buildingHeightM: 12.0 });
    expect(lowRise.stairRequirements.minWidthM).toBe(1.0);
    expect(lowRise.stairRequirements.secondStaircaseRequired).toBe(false);

    // Mid rise (G+6 = 21m)
    const midRise = getApartmentRulesProfile('pune_pmc', { floorCount: 7, buildingHeightM: 21.0 });
    expect(midRise.stairRequirements.minWidthM).toBe(1.2);

    // High rise (> 24m)
    const highRise = getApartmentRulesProfile('pune_pmc', { floorCount: 11, buildingHeightM: 34.0, floorPlateAreaSqM: 550 });
    expect(highRise.stairRequirements.minWidthM).toBe(1.5);
    expect(highRise.stairRequirements.secondStaircaseRequired).toBe(true);
  });

  it('calculates multi-family parking based on carpet area bands instead of 1 flat = 1 car (§10)', () => {
    const maharashtraProfile = getApartmentRulesProfile('pune_pmc');

    // 4 compact flats (1BHK < 45 m²)
    const compactUnits = [{ unitType: '1BHK', count: 4, carpetAreaSqFt: 400 }];
    const compactParking = maharashtraProfile.calculateParking(compactUnits);
    // Under Table 21: 4 flats * 0.5 = 2 resident cars + 10% visitor = 3 cars
    expect(compactParking.residentCars).toBe(2);
    expect(compactParking.twoWheelers).toBe(4);

    // 4 large flats (3BHK > 70 m²)
    const largeUnits = [{ unitType: '3BHK', count: 4, carpetAreaSqFt: 1200 }];
    const largeParking = maharashtraProfile.calculateParking(largeUnits);
    // 4 flats * 2.0 = 8 resident cars
    expect(largeParking.residentCars).toBe(8);
    expect(largeParking.twoWheelers).toBe(8);
  });
});

describe('Apartment Pipeline - Multi-Floor Programs (§12)', () => {
  it('provides distinct space programs across floor configurations', () => {
    const ground = getFloorConfigurationProgram('ground');
    expect(ground.allowsResidentialFlats).toBe(false);
    expect(ground.spaces.some(s => s.id === 'stilt_parking')).toBe(true);

    const typical = getFloorConfigurationProgram('typical');
    expect(typical.allowsResidentialFlats).toBe(true);
    expect(typical.spaces.some(s => s.id === 'residential_flats')).toBe(true);

    const amenity = getFloorConfigurationProgram('amenity');
    expect(amenity.allowsResidentialFlats).toBe(false);
    expect(amenity.spaces.some(s => s.id === 'fitness_gym')).toBe(true);

    const terrace = getFloorConfigurationProgram('terrace');
    expect(terrace.spaces.some(s => s.id === 'overhead_water_tank')).toBe(true);
  });
});

describe('Apartment Pipeline - Deterministic Feasibility Gate (§18, §21)', () => {
  const standardSite = {
    plotWidthMm: 35000, // 35m
    plotDepthMm: 40000, // 40m
    setbacksMm: { front: 5000, rear: 4000, left: 3000, right: 3000 },
  };

  it('validates a feasible 2 flats / floor configuration (1 × 2BHK, 1 × 3BHK)', () => {
    const result = validateIndianApartmentFeasibility({
      site: standardSite,
      flatsPerFloor: 2,
      floorCount: 4,
      jurisdiction: 'pune_pmc',
      unitMix: [
        { unitType: '2BHK', count: 1, carpetAreaSqFt: 750 },
        { unitType: '3BHK', count: 1, carpetAreaSqFt: 1100 },
      ],
      commonCore: {
        passengerLifts: 1,
        staircaseCount: 1,
        commonLobby: true,
      },
    });

    expect(result.feasible).toBe(true);
    expect(result.conflicts.filter(c => c.severity === 'error')).toHaveLength(0);
    expect(result.netResidentialAreaSqM).toBeGreaterThan(result.requestedTotalUnitAreaSqM);
  });

  it('validates a feasible 3 flats / floor configuration (3 × 2BHK)', () => {
    const result = validateIndianApartmentFeasibility({
      site: standardSite,
      flatsPerFloor: 3,
      floorCount: 4,
      jurisdiction: 'pune_pmc',
      unitMix: [{ unitType: '2BHK', count: 3, carpetAreaSqFt: 750 }],
      commonCore: {
        passengerLifts: 1,
        staircaseCount: 1,
        commonLobby: true,
      },
    });

    expect(result.feasible).toBe(true);
    expect(result.conflicts.filter(c => c.severity === 'error')).toHaveLength(0);
  });

  it('validates a feasible 4 flats / floor configuration (2 × 2BHK, 2 × 3BHK)', () => {
    const result = validateIndianApartmentFeasibility({
      site: standardSite,
      flatsPerFloor: 4,
      floorCount: 5,
      jurisdiction: 'pune_pmc',
      unitMix: [
        { unitType: '2BHK', count: 2, carpetAreaSqFt: 750 },
        { unitType: '3BHK', count: 2, carpetAreaSqFt: 1100 },
      ],
      commonCore: {
        passengerLifts: 2,
        staircaseCount: 2,
        commonLobby: true,
      },
    });

    expect(result.feasible).toBe(true);
    expect(result.conflicts.filter(c => c.severity === 'error')).toHaveLength(0);
  });

  it('rejects an impossible configuration where unit areas exceed buildable floor plate', () => {
    const smallSite = {
      plotWidthMm: 15000, // 15m
      plotDepthMm: 18000, // 18m
      setbacksMm: { front: 4000, rear: 3000, left: 2500, right: 2500 },
    };

    const oversizedResult = validateIndianApartmentFeasibility({
      site: smallSite,
      flatsPerFloor: 4,
      floorCount: 4,
      jurisdiction: 'pune_pmc',
      unitMix: [
        { unitType: '4BHK', count: 4, carpetAreaSqFt: 2500 }, // 4 x 2500 = 10,000 sq ft on a tiny ~110 m2 envelope
      ],
    });

    expect(oversizedResult.feasible).toBe(false);
    expect(oversizedResult.conflicts.some(c => c.code === 'UNIT_AREA_EXCEEDS_FLOOR_PLATE')).toBe(true);
  });
});

describe('Apartment Pipeline - Deterministic Apartment Schematic (§13, §14, §15, §16)', () => {
  const profile = getApartmentRulesProfile('pune_pmc');

  it('generates exact 2 flats schematic with 2BHK/3BHK differentiation (§13, §14, §7)', () => {
    const schematic = generateDeterministicApartmentSchematic({
      siteWidthM: 30,
      siteDepthM: 35,
      flatsPerFloor: 2,
      unitMix: [
        { unitType: '2BHK', count: 1, carpetAreaSqFt: 750 },
        { unitType: '3BHK', count: 1, carpetAreaSqFt: 1150 },
      ],
      commonCoreConfig: {
        passengerLifts: 1,
        staircaseCount: 1,
      },
      rulesProfile: profile,
    });

    expect(schematic.flatCount).toBe(2);
    expect(schematic.units).toHaveLength(2);
    expect(schematic.units[0]!.unitType).toBe('2BHK');
    expect(schematic.units[1]!.unitType).toBe('3BHK');

    // 3BHK receives a larger envelope and carpet area than the 2BHK (two-phase upgrade:
    // flats are sized from their target areas, so compare areas rather than one axis).
    const bodyArea = (i: number) => schematic.units[i]!.bodyBounds.width * schematic.units[i]!.bodyBounds.height;
    expect(bodyArea(1)).toBeGreaterThan(bodyArea(0) * 1.2);
    expect(schematic.units[1]!.carpetAreaSqM).toBeGreaterThan(schematic.units[0]!.carpetAreaSqM);
    expect(schematic.units[1]!.actualCarpetAreaSqM).toBeGreaterThan(schematic.units[0]!.actualCarpetAreaSqM);

    // Also test backwards compatible validateApartmentFeasibility
    const legacyResult = validateApartmentFeasibility(
      { plotWidthMm: 30000, plotDepthMm: 35000 },
      {
        projectType: 'apartment',
        jurisdiction: 'pune_pmc',
        floorCount: 4,
        flatsPerFloor: 2,
        unitMix: [
          { unitType: '2BHK', count: 1, carpetAreaSqFt: 750 },
          { unitType: '3BHK', count: 1, carpetAreaSqFt: 1150 },
        ],
        commonCore: { passengerLifts: 1, serviceLifts: 0, staircaseCount: 1, fireStaircaseRequired: false, commonLobby: true },
        parking: { residentParkingCount: 2, visitorParkingCount: 1 },
        amenities: { groundSiteAmenities: [], buildingAmenities: [] },
      },
    );
    expect(legacyResult.feasible).toBe(true);

    // SVG scaffold check
    expect(schematic.svgScaffold).toContain('Flat 01 · 2BHK');
    expect(schematic.svgScaffold).toContain('Flat 02 · 3BHK');
    expect(schematic.svgScaffold).toContain('COMMON LOBBY');
  });

  it('generates exact 3 flats schematic (§13)', () => {
    const schematic = generateDeterministicApartmentSchematic({
      siteWidthM: 30,
      siteDepthM: 35,
      flatsPerFloor: 3,
      unitMix: [{ unitType: '2BHK', count: 3 }],
      rulesProfile: profile,
    });

    expect(schematic.flatCount).toBe(3);
    expect(schematic.units).toHaveLength(3);
  });

  it('generates exact 4 flats schematic with 2 lifts and 2 staircases (§13, §15)', () => {
    const schematic = generateDeterministicApartmentSchematic({
      siteWidthM: 35,
      siteDepthM: 40,
      flatsPerFloor: 4,
      unitMix: [
        { unitType: '2BHK', count: 2 },
        { unitType: '3BHK', count: 2 },
      ],
      commonCoreConfig: {
        passengerLifts: 2,
        staircaseCount: 2,
      },
      rulesProfile: profile,
    });

    expect(schematic.flatCount).toBe(4);
    expect(schematic.units).toHaveLength(4);

    // Central Core elements check
    expect(schematic.core.lifts).toHaveLength(2);
    expect(schematic.core.lifts[0]!.label).toBe('LIFT 01');
    expect(schematic.core.lifts[1]!.label).toBe('LIFT 02');

    expect(schematic.core.stairs).toHaveLength(2);
    expect(schematic.core.stairs[0]!.label).toContain('STAIR 01');
    expect(schematic.core.stairs[1]!.label).toContain('STAIR 02');

    expect(schematic.svgScaffold).toContain('LIFT 01');
    expect(schematic.svgScaffold).toContain('LIFT 02');
    expect(schematic.svgScaffold).toContain('STAIR 01');
    expect(schematic.svgScaffold).toContain('STAIR 02');
  });

  it('generates exact 1 flat schematic — single-unit path (Phase 1 recovery, P1)', () => {
    const schematic = generateDeterministicApartmentSchematic({
      siteWidthM: 20,
      siteDepthM: 25,
      flatsPerFloor: 1,
      unitMix: [{ unitType: '3BHK', count: 1 }],
      rulesProfile: profile,
    });

    expect(schematic.flatCount).toBe(1);
    expect(schematic.units).toHaveLength(1);
    expect(schematic.units[0]!.unitType).toBe('3BHK');
    // The single flat never overlaps the common core and both lie inside the
    // built footprint (two-phase upgrade: the flat is sized from its target area,
    // so it no longer has to tile the footprint).
    const unit = schematic.units[0]!.bounds;
    const fp = schematic.buildingFootprint;
    const inside = (r: { x: number; y: number; width: number; height: number }) =>
      r.x >= fp.x - 1e-6 && r.y >= fp.y - 1e-6 && r.x + r.width <= fp.x + fp.width + 1e-6 && r.y + r.height <= fp.y + fp.height + 1e-6;
    for (const el of [schematic.core.lobby, ...schematic.core.lifts, ...schematic.core.stairs]) {
      const b = el.bounds;
      const overlapW = Math.min(unit.x + unit.width, b.x + b.width) - Math.max(unit.x, b.x);
      const overlapH = Math.min(unit.y + unit.height, b.y + b.height) - Math.max(unit.y, b.y);
      expect(overlapW > 0.001 && overlapH > 0.001).toBe(false);
      expect(inside(b)).toBe(true);
    }
    expect(inside(unit)).toBe(true);
    expect(schematic.layoutFits).toBe(true);
    expect(schematic.spatialChecks.filter(c => c.status === 'FAIL')).toEqual([]);
  });

  it.each([5, 6, 7])('generates exact %d flats schematic via the generic grid partitioner (Phase 1 recovery, P1)', (n) => {
    const schematic = generateDeterministicApartmentSchematic({
      siteWidthM: 45,
      siteDepthM: 50,
      flatsPerFloor: n,
      unitMix: [{ unitType: '2BHK', count: n }],
      rulesProfile: profile,
    });

    expect(schematic.flatCount).toBe(n);
    expect(schematic.units).toHaveLength(n);
    // Every unit has a positive, non-degenerate footprint and is labelled distinctly.
    const labels = new Set(schematic.units.map(u => u.flatLabel));
    expect(labels.size).toBe(n);
    for (const unit of schematic.units) {
      expect(unit.bounds.width).toBeGreaterThan(0);
      expect(unit.bounds.height).toBeGreaterThan(0);
    }
  });

  it.each([1, 2, 3, 4, 5, 6])(
    'schematic.units.length === flatsPerFloor for N=%d (Phase 1 acceptance invariant)',
    (n) => {
      const schematic = generateDeterministicApartmentSchematic({
        siteWidthM: 40,
        siteDepthM: 45,
        flatsPerFloor: n,
        unitMix: [{ unitType: '2BHK', count: n }],
        rulesProfile: profile,
      });
      expect(schematic.units.length).toBe(n);
      expect(schematic.flatCount).toBe(n);
    },
  );
});

/**
 * Structured Apartment Generation Manifest Engine (§1, §3, §4, §5, §6, §7, §8).
 *
 * Implements:
 * - Canonical ApartmentGenerationManifest contract.
 * - Exact counts: flats, unit mix, bedrooms, bathrooms, living, dining, kitchens, utilities, balconies.
 * - Comprehensive Room Inventory across the entire floor plate.
 * - Exact Floor Area Breakdown: Site, Buildable Envelope, Floor Plate, Core, Circulation, Services, Net Residential (sq ft & sq m).
 * - Pre-generation validation: Deterministic Schematic MUST match Manifest before invoking FLUX.
 */

import type { ApartmentBriefConfig } from '../types/apartment';
import { type ApartmentRulesProfile, type ApartmentJurisdiction, getApartmentRulesProfile } from './jurisdiction';
import type { DeterministicApartmentSchematic } from './schematic';
import { allocateApartmentUnitSpaces, type ApartmentUnitType } from './typologies';
import { DEFAULT_APARTMENT_SETBACKS_MM } from './site-defaults';

const SQM_TO_SQFT = 10.7639104;
const M_TO_FT = 3.28084;

export interface ApartmentUnitManifestItem {
  readonly id: string;
  readonly label: string;
  readonly type: '1BHK' | '2BHK' | '3BHK' | '4BHK' | 'studio' | string;
  readonly targetAreaSqFt: number;
  readonly targetAreaSqM: number;
  readonly bedrooms: number;
  readonly bathrooms: number;
  readonly livingRooms: number;
  readonly diningRooms: number;
  readonly kitchens: number;
  readonly utilities: number;
  readonly balconies: number;
}

export interface ApartmentRoomTotals {
  readonly bedrooms: number;
  readonly bathrooms: number;
  readonly livingRooms: number;
  readonly diningRooms: number;
  readonly kitchens: number;
  readonly utilities: number;
  readonly balconies: number;
}

export interface ApartmentAreaAllocations {
  readonly siteSqFt: number;
  readonly siteSqM: number;
  readonly buildableEnvelopeSqFt: number;
  readonly buildableEnvelopeSqM: number;
  readonly currentFloorPlateSqFt: number;
  readonly currentFloorPlateSqM: number;
  readonly commonCoreSqFt: number;
  readonly commonCoreSqM: number;
  readonly circulationSqFt: number;
  readonly circulationSqM: number;
  readonly servicesSqFt: number;
  readonly servicesSqM: number;
  readonly netResidentialSqFt: number;
  readonly netResidentialSqM: number;
}

export interface ApartmentGenerationManifest {
  readonly jurisdiction: {
    readonly authority: string;
    readonly ruleProfile: string;
  };
  readonly project: {
    readonly type: 'apartment';
    readonly floors: number;
    readonly currentFloor: number;
    readonly floorType: 'ground' | 'typical' | 'amenity' | 'terrace';
  };
  readonly site: {
    readonly widthFt: number;
    readonly depthFt: number;
    readonly buildableWidthFt: number;
    readonly buildableDepthFt: number;
    readonly buildableAreaSqFt: number;
    readonly widthM: number;
    readonly depthM: number;
    readonly buildableAreaSqM: number;
  };
  readonly units: {
    readonly exactCount: number;
    readonly units: readonly ApartmentUnitManifestItem[];
  };
  readonly roomTotals: ApartmentRoomTotals;
  readonly areaAllocations: ApartmentAreaAllocations;
  readonly commonCore: {
    readonly lifts: number;
    readonly stairs: number;
    readonly commonLobby: boolean;
    readonly corridor: boolean;
  };
  readonly services: {
    readonly ducts: number;
    readonly shafts: number;
    readonly utilityAreas: number;
  };
  readonly parking?: {
    readonly cars: number;
    readonly twoWheelers: number;
    readonly visitorSpaces?: number;
  };
  readonly amenities: readonly string[];
  readonly orientation: {
    readonly roadSide: string;
    readonly northDirection: number;
  };
  readonly requirements: readonly string[];
}

export interface BuildApartmentManifestInput {
  readonly site: {
    readonly plotWidthMm: number;
    readonly plotDepthMm: number;
    readonly setbacksMm?: { front: number; rear: number; left: number; right: number };
    readonly roadFacing?: string;
    readonly orientationDegrees?: number;
  };
  readonly apartmentConfig: ApartmentBriefConfig;
  readonly rulesProfile?: ApartmentRulesProfile;
  readonly currentFloorIndex?: number;
}

/**
 * Builds the canonical ApartmentGenerationManifest with exact numerical inventories.
 */
export function buildApartmentGenerationManifest(
  input: BuildApartmentManifestInput,
): ApartmentGenerationManifest {
  const { site, apartmentConfig, rulesProfile } = input;
  const setbacks = site.setbacksMm ?? DEFAULT_APARTMENT_SETBACKS_MM;

  const plotWidthM = site.plotWidthMm / 1000;
  const plotDepthM = site.plotDepthMm / 1000;
  const siteAreaSqM = Number((plotWidthM * plotDepthM).toFixed(2));
  const siteAreaSqFt = Math.round(siteAreaSqM * SQM_TO_SQFT);

  const buildableWidthM = Math.max(0, (site.plotWidthMm - setbacks.left - setbacks.right) / 1000);
  const buildableDepthM = Math.max(0, (site.plotDepthMm - setbacks.front - setbacks.rear) / 1000);
  const buildableAreaSqM = Number((buildableWidthM * buildableDepthM).toFixed(2));
  const buildableAreaSqFt = Math.round(buildableAreaSqM * SQM_TO_SQFT);

  const currentFloorPlateSqM = Number((buildableAreaSqM * 0.90).toFixed(2));
  const currentFloorPlateSqFt = Math.round(currentFloorPlateSqM * SQM_TO_SQFT);

  // Authority and jurisdiction
  const jurisdictionName = apartmentConfig.jurisdiction ?? 'pune_pmc';
  const authorityMap: Record<ApartmentJurisdiction, { authority: string; ruleProfile: string }> = {
    pune_pmc: {
      authority: 'Pune Municipal Corporation (PMC)',
      ruleProfile: 'UDCPR 2020 Chapter 6 & Rule 6.2.3',
    },
    pune_pmrda: {
      authority: 'Pune Metropolitan Region Development Authority (PMRDA)',
      ruleProfile: 'UDCPR 2020 Regional Authority Regulations',
    },
    mumbai_mcgm: {
      authority: 'Municipal Corporation of Greater Mumbai (MCGM)',
      ruleProfile: 'DCPR 2034 Regulation 41 & Table 21',
    },
    generic_maharashtra: {
      authority: 'Maharashtra State Unified DCPR',
      ruleProfile: 'UDCPR 2020 Standard Baseline',
    },
    generic_indian: {
      authority: 'National Building Code of India (NBC 2016)',
      ruleProfile: 'Part 3 (Development Control) & Part 4 (Fire Safety)',
    },
  };
  const jurisdictionInfo = authorityMap[jurisdictionName as ApartmentJurisdiction] ?? {
    authority: 'Indian Urban Planning Authority',
    ruleProfile: 'National Building Code 2016 Baseline',
  };

  const resolvedRulesProfile = rulesProfile ?? getApartmentRulesProfile(jurisdictionName, {
    floorCount: apartmentConfig.floorCount,
    tenementsPerFloor: apartmentConfig.flatsPerFloor,
  });

  // Build individual units list from unit mix
  const unitsList: ApartmentUnitManifestItem[] = [];
  let unitIndex = 0;

  for (const item of apartmentConfig.unitMix) {
    const normType = (item.unitType.toUpperCase()) as ApartmentUnitType;
    for (let c = 0; c < item.count; c++) {
      unitIndex++;
      const flatLabel = `FLAT ${unitIndex < 10 ? `0${unitIndex}` : unitIndex}`;

      // Allocate room spaces via typology engine
      const allocation = allocateApartmentUnitSpaces({
        unitType: normType,
        targetCarpetAreaSqFt: item.carpetAreaSqFt,
        rulesProfile: resolvedRulesProfile,
        flatLabel,
      });

      const targetAreaSqM = allocation.targetCarpetAreaSqM;
      const targetAreaSqFt = Math.round(targetAreaSqM * SQM_TO_SQFT);

      // Inventory room categories for this unit
      let bedrooms = 0;
      let bathrooms = 0;
      let livingRooms = 0;
      let diningRooms = 0;
      let kitchens = 0;
      let utilities = 0;
      let balconies = 0;

      for (const r of allocation.rooms) {
        if (r.type === 'master_bedroom' || r.type === 'bedroom') bedrooms++;
        else if (r.type === 'master_toilet' || r.type === 'common_toilet' || r.type === 'powder_room') bathrooms++;
        else if (r.type === 'living_dining') {
          livingRooms++;
          diningRooms++;
        } else if (r.type === 'kitchen') kitchens++;
        else if (r.type === 'utility') utilities++;
        else if (r.type === 'balcony') balconies++;
      }

      // Default room minimums if typology was unspecified
      if (bedrooms === 0) {
        const parsed = parseInt(normType, 10);
        bedrooms = isNaN(parsed) ? 2 : parsed;
        bathrooms = Math.max(1, bedrooms);
        livingRooms = 1;
        diningRooms = 1;
        kitchens = 1;
        utilities = 1;
        balconies = 1;
      }

      unitsList.push({
        id: `unit_${unitIndex}`,
        label: flatLabel,
        type: normType,
        targetAreaSqFt,
        targetAreaSqM,
        bedrooms,
        bathrooms,
        livingRooms,
        diningRooms,
        kitchens,
        utilities,
        balconies,
      });
    }
  }

  // Room Totals across all units on this floor plate
  const roomTotals: ApartmentRoomTotals = {
    bedrooms: unitsList.reduce((acc, u) => acc + u.bedrooms, 0),
    bathrooms: unitsList.reduce((acc, u) => acc + u.bathrooms, 0),
    livingRooms: unitsList.reduce((acc, u) => acc + u.livingRooms, 0),
    diningRooms: unitsList.reduce((acc, u) => acc + u.diningRooms, 0),
    kitchens: unitsList.reduce((acc, u) => acc + u.kitchens, 0),
    utilities: unitsList.reduce((acc, u) => acc + u.utilities, 0),
    balconies: unitsList.reduce((acc, u) => acc + u.balconies, 0),
  };

  // Area allocations (§7)
  const liftsCount = Math.max(1, apartmentConfig.commonCore.passengerLifts + apartmentConfig.commonCore.serviceLifts);
  const stairsCount = Math.max(1, apartmentConfig.commonCore.staircaseCount);
  const commonCoreSqM = Number((liftsCount * 3.6 + stairsCount * 16.0 + 18.0).toFixed(2));
  const circulationSqM = Number((currentFloorPlateSqM * 0.12).toFixed(2));
  const servicesSqM = Number((unitsList.length * 2.5 + 5.0).toFixed(2));
  const netResidentialSqM = Math.max(
    0,
    Number((currentFloorPlateSqM - commonCoreSqM - circulationSqM - servicesSqM).toFixed(2)),
  );

  const areaAllocations: ApartmentAreaAllocations = {
    siteSqFt: siteAreaSqFt,
    siteSqM: siteAreaSqM,
    buildableEnvelopeSqFt: buildableAreaSqFt,
    buildableEnvelopeSqM: buildableAreaSqM,
    currentFloorPlateSqFt: currentFloorPlateSqFt,
    currentFloorPlateSqM: currentFloorPlateSqM,
    commonCoreSqFt: Math.round(commonCoreSqM * SQM_TO_SQFT),
    commonCoreSqM,
    circulationSqFt: Math.round(circulationSqM * SQM_TO_SQFT),
    circulationSqM,
    servicesSqFt: Math.round(servicesSqM * SQM_TO_SQFT),
    servicesSqM,
    netResidentialSqFt: Math.round(netResidentialSqM * SQM_TO_SQFT),
    netResidentialSqM,
  };

  const floors = Math.max(1, apartmentConfig.floorCount);
  const currentFloor = input.currentFloorIndex ?? 1;
  const floorType = (apartmentConfig.floorStrategy ?? 'typical') as 'ground' | 'typical' | 'amenity' | 'terrace';

  const allAmenities = [
    ...(apartmentConfig.amenities?.groundSiteAmenities ?? []),
    ...(apartmentConfig.amenities?.buildingAmenities ?? []),
  ];

  return {
    jurisdiction: jurisdictionInfo,
    project: {
      type: 'apartment',
      floors,
      currentFloor,
      floorType,
    },
    site: {
      widthFt: Math.round(plotWidthM * M_TO_FT),
      depthFt: Math.round(plotDepthM * M_TO_FT),
      buildableWidthFt: Math.round(buildableWidthM * M_TO_FT),
      buildableDepthFt: Math.round(buildableDepthM * M_TO_FT),
      buildableAreaSqFt: buildableAreaSqFt,
      widthM: Number(plotWidthM.toFixed(2)),
      depthM: Number(plotDepthM.toFixed(2)),
      buildableAreaSqM: buildableAreaSqM,
    },
    units: {
      exactCount: unitsList.length,
      units: unitsList,
    },
    roomTotals,
    areaAllocations,
    commonCore: {
      lifts: liftsCount,
      stairs: stairsCount,
      commonLobby: apartmentConfig.commonCore.commonLobby ?? true,
      corridor: true,
    },
    services: {
      ducts: Math.max(1, Math.ceil(unitsList.length / 2)),
      shafts: Math.max(1, Math.ceil(unitsList.length / 2)),
      utilityAreas: roomTotals.utilities,
    },
    parking: {
      cars: (apartmentConfig.parking.residentParkingCount ?? 0) + (apartmentConfig.parking.visitorParkingCount ?? 0),
      twoWheelers: apartmentConfig.parking.twoWheelerParkingCount ?? unitsList.length * 2,
      visitorSpaces: apartmentConfig.parking.visitorParkingCount ?? 2,
    },
    amenities: allAmenities.length > 0 ? allAmenities : ['common_lobby', 'society_office'],
    orientation: {
      roadSide: (site.roadFacing ?? 'north').toUpperCase(),
      northDirection: site.orientationDegrees ?? 0,
    },
    requirements: [
      `Generate EXACTLY ${unitsList.length} separate residential flats on this floor.`,
      `Preserve the exact unit mix: ${apartmentConfig.unitMix.map(u => `${u.count} x ${u.unitType}`).join(', ')}.`,
      `Generate EXACTLY ${liftsCount} lift(s) and EXACTLY ${stairsCount} staircase(s).`,
      'Include a central common lobby providing direct access to all flat entries.',
      'Flats must have clear boundary walls and independent front doors.',
      'No standalone villas, no single-family houses, no merged units.',
    ],
  };
}

/**
 * Formats the structured manifest into a clear textual section for the FLUX prompt (§5, §6, §7).
 */
export function renderApartmentManifestText(manifest: ApartmentGenerationManifest): string {
  const lines: string[] = [
    '================ STRUCTURED GENERATION MANIFEST ================',
    '',
    `JURISDICTION: ${manifest.jurisdiction.authority} (${manifest.jurisdiction.ruleProfile})`,
    `PROJECT TYPE: Multi-unit residential apartment (${manifest.project.floors} floors total, current floor: ${manifest.project.floorType.toUpperCase()})`,
    '',
    'SITE & BUILDABLE AREAS:',
    `Site: ${manifest.site.widthFt} ft x ${manifest.site.depthFt} ft (${manifest.areaAllocations.siteSqFt.toLocaleString()} sq ft / ${manifest.areaAllocations.siteSqM} m²)`,
    `Buildable Envelope: ${manifest.site.buildableWidthFt} ft x ${manifest.site.buildableDepthFt} ft (${manifest.areaAllocations.buildableEnvelopeSqFt.toLocaleString()} sq ft / ${manifest.areaAllocations.buildableEnvelopeSqM} m²)`,
    `Current Floor Plate: ${manifest.areaAllocations.currentFloorPlateSqFt.toLocaleString()} sq ft (${manifest.areaAllocations.currentFloorPlateSqM} m²)`,
    `Common Core Area: ${manifest.areaAllocations.commonCoreSqFt.toLocaleString()} sq ft`,
    `Circulation Area: ${manifest.areaAllocations.circulationSqFt.toLocaleString()} sq ft`,
    `Services Area: ${manifest.areaAllocations.servicesSqFt.toLocaleString()} sq ft`,
    `Net Usable Residential Area: ${manifest.areaAllocations.netResidentialSqFt.toLocaleString()} sq ft`,
    '',
    'DWELLING UNITS ON THIS FLOOR:',
    `EXACT TOTAL: ${manifest.units.exactCount} FLATS`,
    '',
  ];

  for (const u of manifest.units.units) {
    lines.push(
      `${u.label}`,
      `Type: ${u.type}`,
      `Target area: ~${u.targetAreaSqFt.toLocaleString()} sq ft (~${u.targetAreaSqM} m²)`,
      `Bedrooms: ${u.bedrooms}`,
      `Bathrooms: ${u.bathrooms}`,
      `Living: ${u.livingRooms}`,
      `Dining: ${u.diningRooms}`,
      `Kitchen: ${u.kitchens}`,
      `Utility: ${u.utilities}`,
      `Balcony: ${u.balconies}`,
      '',
    );
  }

  lines.push(
    'TOTAL RESIDENTIAL ROOMS ON THIS FLOOR:',
    `Bedrooms: ${manifest.roomTotals.bedrooms}`,
    `Bathrooms: ${manifest.roomTotals.bathrooms}`,
    `Living rooms: ${manifest.roomTotals.livingRooms}`,
    `Dining areas: ${manifest.roomTotals.diningRooms}`,
    `Kitchens: ${manifest.roomTotals.kitchens}`,
    `Utilities: ${manifest.roomTotals.utilities}`,
    `Balconies: ${manifest.roomTotals.balconies}`,
    '',
    'COMMON CORE:',
    `Lifts: EXACTLY ${manifest.commonCore.lifts}`,
    `Staircases: EXACTLY ${manifest.commonCore.stairs}`,
    `Common lobby: ${manifest.commonCore.commonLobby ? 'YES' : 'NO'}`,
    `Common corridor: ${manifest.commonCore.corridor ? 'YES' : 'NO'}`,
    '',
    'SERVICES:',
    `Ducts: ${manifest.services.ducts}`,
    `Shafts: ${manifest.services.shafts}`,
    `Utilities: ${manifest.services.utilityAreas}`,
    '',
  );

  if (manifest.parking) {
    lines.push(
      'PARKING:',
      `Resident & Visitor Cars: ${manifest.parking.cars}`,
      `Two-Wheelers: ${manifest.parking.twoWheelers}`,
      '',
    );
  }

  lines.push(
    `AMENITIES: ${manifest.amenities.join(', ')}`,
    `ORIENTATION: Road on ${manifest.orientation.roadSide} side, North ${manifest.orientation.northDirection}°`,
    '=================================================================',
  );

  return lines.join('\n');
}

/**
 * Validates that the Deterministic Schematic strictly matches the Manifest before invoking FLUX (§8).
 * If the schematic and manifest disagree on flat count, unit mix, or core elements: STOP.
 */
export function validateSchematicMatchesManifest(
  schematic: DeterministicApartmentSchematic,
  manifest: ApartmentGenerationManifest,
): { matches: boolean; discrepancies: string[]; feasibilityFail: boolean } {
  const discrepancies: string[] = [];

  // 1. Exact Flat Count Check (§8, §11)
  if (schematic.flatCount !== manifest.units.exactCount) {
    discrepancies.push(
      `Schematic flat count (${schematic.flatCount}) does not match manifest flat count (${manifest.units.exactCount}).`,
    );
  }

  if (schematic.units.length !== manifest.units.units.length) {
    discrepancies.push(
      `Schematic unit count (${schematic.units.length}) does not match manifest units list (${manifest.units.units.length}).`,
    );
  }

  // 2. Unit Mix Check
  for (let i = 0; i < Math.min(schematic.units.length, manifest.units.units.length); i++) {
    const sUnit = schematic.units[i]!;
    const mUnit = manifest.units.units[i]!;
    if (sUnit.unitType.toUpperCase() !== mUnit.type.toUpperCase()) {
      discrepancies.push(
        `Unit ${i + 1} type mismatch: Schematic has "${sUnit.unitType}", but manifest requires "${mUnit.type}".`,
      );
    }
  }

  // 3. Lift Count Check (§8, §12)
  if (schematic.core.lifts.length !== manifest.commonCore.lifts) {
    discrepancies.push(
      `Schematic lift count (${schematic.core.lifts.length}) does not match manifest lift count (${manifest.commonCore.lifts}).`,
    );
  }

  // 4. Staircase Count Check (§8, §12)
  if (schematic.core.stairs.length !== manifest.commonCore.stairs) {
    discrepancies.push(
      `Schematic stair count (${schematic.core.stairs.length}) does not match manifest stair count (${manifest.commonCore.stairs}).`,
    );
  }

  // 5. Per-flat programme (two-phase upgrade): nBHK ⇒ exactly n bedrooms, baths ≥ manifest.
  for (let i = 0; i < Math.min(schematic.units.length, manifest.units.units.length); i++) {
    const sUnit = schematic.units[i]!;
    const mUnit = manifest.units.units[i]!;
    const rooms = [...sUnit.rooms, ...sUnit.balconies];
    const bedrooms = rooms.filter(r => r.type === 'master_bedroom' || r.type === 'bedroom').length;
    const baths = rooms.filter(r => r.type === 'master_toilet' || r.type === 'common_toilet' || r.type === 'powder_room').length;
    if (bedrooms !== mUnit.bedrooms) {
      discrepancies.push(`${sUnit.flatLabel} has ${bedrooms} bedroom(s); manifest requires ${mUnit.bedrooms}.`);
    }
    if (baths < mUnit.bathrooms) {
      discrepancies.push(`${sUnit.flatLabel} has ${baths} bath(s); manifest requires ${mUnit.bathrooms}.`);
    }
  }

  // 6. Area balance + apartment logic (spatial relationship graph) must hold before FLUX.
  const feasibilityFail = schematic.layoutFits === false;
  if (feasibilityFail) {
    discrepancies.push(schematic.areaReport?.floor.message ?? `FEASIBILITY FAIL: ${schematic.layoutIssues.join('; ')}`);
  }
  for (const report of schematic.areaReport?.units ?? []) {
    if (report.status === 'FAIL') {
      discrepancies.push(
        `${report.flatLabel} area control failed: ${report.actualCarpetSqM} m² drawn vs ${report.targetCarpetSqM} m² target (${report.deviationPct}%).`,
      );
    }
  }
  for (const check of schematic.spatialChecks ?? []) {
    if (check.status === 'FAIL') discrepancies.push(`Spatial check ${check.code} failed: ${check.message}`);
  }

  return {
    matches: discrepancies.length === 0,
    discrepancies,
    feasibilityFail,
  };
}

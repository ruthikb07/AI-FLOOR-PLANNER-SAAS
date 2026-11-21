import { interpretArchitecturalPlacement } from '../interpretation/architectural-placement.js';
import { coordinateArchitecturalStairs } from '../pipeline/architectural-connections.js';
import { withMepEngineering } from '../mep/mep-synthesizer.js';
import { bedroomBalconySchedule } from './bedroom-balcony-audit.js';
import { createGenerationReport } from './generation-report';
import type { GenerateConceptsResult } from '../topology/generative-topology-engine';
import { architecturalSpaceRole, withArchitecturalElements, parseMixedUnitProgram, mixedUnitSpecs } from '@ai-floor-planner/core';
import type { BuildingMassingShape } from '@ai-floor-planner/core';
/**
 * Multi-Sheet Apartment Project Engine (Phase 1C).
 *
 * Generates all 6 coordinated 2D Architectural Plan Sheets for an Indian Residential
 * Apartment project (G+N, S+N, B+S+N):
 * - Sheet 1: SITE_PLAN (100% Plot Allotment with Site Amenities, Delta = 0.000 mm²)
 * - Sheet 2: STILT_PARKING_PLAN (Stilt Parking, Locked Core & Amenities, Delta = 0.000 mm²)
 * - Sheet 3: TYPICAL_FLOOR_PLAN (space-filling-snapper.ts, Delta = 0.000 mm²)
 * - Sheet 4: REFUGE_FLOOR_PLAN (Statutory Fire Refuge Terrace when height > 24m, Delta = 0.000 mm²)
 * - Sheet 5: TERRACE_PLAN (100% Rooftop Services & Amenity Allotment, Delta = 0.000 mm²)
 * - Sheet 6: AREA_SCHEDULE_SHEET (UDCPR / NBC FSI, RERA Carpet & Parking Schedule)
 *
 * Core Invariant: Every geometric sheet satisfies Planar Conservation:
 *   Delta = |Gross Envelope/Plot Area - Sum(Accounted Component Polygons)| = 0.000 mm²
 */

import { interpretArchitecturalIntent } from '../topology/architectural-intent';
import {
  type MultiSheetApartmentConfig,
  type MultiSheetApartmentResult,
  type CoordinatedApartmentSheet,
  type ApartmentProjectSchedule,
  type AreaTargetDiagnostic,
  type AreaTargetScope,
  type SheetLedgerAudit,
  type FlatScheduleItem,
  type ParkingSchedule,
  type Building,
  type Floor,
  type Room,
  type Wall,
  type Door,
  type Window,
  type Column,
  type Site,
  type SiteZone,
  type Polygon,
  type Point,
  type ApartmentBhkType,
  RoomType,
  DoorType,
  SwingDirection,
  WindowType,
  ColumnShape,
  Direction,
  PlotShape,
  createDynamicApartmentManifest,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
} from '@ai-floor-planner/core';
import { repairApartmentPlan, healFloorGeometryForCompliance } from '../repair/apartment-error-repair';
import { populateCanonicalFurniture } from '../plancraft/auto-furnish-apartment.js';
import {
  generateApartmentWalls,
  openingFitsApartmentWall,
  fitFloorOpeningsInsideWalls,
  polygonBoundingBox,
  measureApartmentAreaLedger,
  polygonArea,
  columnFootprint,
  wallToPolygon,
  uncoveredResidentialOverlap,
} from '@ai-floor-planner/geometry-engine';
import {
  solveOrthogonalSpaceFillingApartment,
  partitionMacroFootprint,
  createConnectingDoor,
  snap10,
  macroCorridorBoxes,
  macroLobbyBoxes,
  type Box2D,
  type MacroPartition,
  type RoomSlicingArchetypeId,
} from '../interpretation/space-filling-snapper';
import { selectProductionTopology, type SelectedTopology } from '../topology/production-bridge';
import { assembleStructureFromPartition } from '../topology/plan-assembler';
import type { ApartmentPlanStructure } from '../interpretation/apartment-plan';
import { GeometryValidator, validateAndRepairBuildingGeometry } from '../validator/geometry-validator';
import {
  evaluateArchitecturalComplianceScore,
  type ArchitecturalComplianceReport,
} from '../compliance/architectural-compliance-score';
import {
  getPlanCategoryEntry,
  inferPlanCategoryFromPrompt,
  inferShapeIdFromPrompt,
  pickNextNonRepeatingShape,
} from '../catalog/shape-catalog';
import { applyParametricShapeToFloor } from '../catalog/shape-geometry-synthesizer';

// ─── Stack Parameters & Height Solver ────────────────────────────────────────

export interface BuildingStackParameters {
  readonly floorToFloorHeightMm: number;
  readonly stiltHeightMm: number;
  readonly basementHeightMm: number;
  readonly totalBuildingHeightMm: number;
  readonly hasStilt: boolean;
  readonly hasBasement: boolean;
  readonly minStaircases: number;
  readonly minLifts: number;
  readonly isHighRiseFireRegulated: boolean; // > 15m (NBC / Fire Act)
  readonly requiresRefugeFloor: boolean; // > 24m (NBC 2016 Part 4 / UDCPR)
  readonly refugeFloorLevels: readonly number[];
}

export function computeBuildingStackParameters(config: MultiSheetApartmentConfig): BuildingStackParameters {
  const floorToFloorHeightMm = config.floorToFloorHeightMm ?? 3000;
  const isStack = config.parkingMode === 'MECHANICAL_STACK';
  const stiltHeightMm = config.stiltHeightMm ?? (isStack ? 4500 : 3000);
  const basementHeightMm = config.basementHeightMm ?? 3300;

  const hasStilt = config.verticalStackType === 'STILT_PLUS_N' || config.verticalStackType === 'BASEMENT_STILT_PLUS_N';
  const hasBasement = config.verticalStackType === 'BASEMENT_STILT_PLUS_N';

  const baseHeight = hasStilt ? stiltHeightMm : 0;
  const totalBuildingHeightMm = baseHeight + config.numTypicalFloors * floorToFloorHeightMm;

  // Height-based NBC & Fire Rules:
  // <= 15m: min 1 stair (1000-1200mm flight) + 1 lift
  // > 15m: mandatory 2 stairs (Main + Fire Escape) + 2 lifts (Passenger + Fire/Stretcher)
  // > 24m: mandatory Refuge Floor at first floor above 24m and every 7th floor thereafter
  const isHighRiseFireRegulated = totalBuildingHeightMm > 15000;
  const minStaircases = isHighRiseFireRegulated ? 2 : 1;
  const minLifts = isHighRiseFireRegulated ? 2 : 1;

  const requiresRefugeFloor = totalBuildingHeightMm > 24000;
  const refugeFloorLevels: number[] = [];
  if (requiresRefugeFloor) {
    // Find first typical floor slab above 24000 mm
    for (let fl = 1; fl <= config.numTypicalFloors; fl++) {
      const slabHeight = baseHeight + fl * floorToFloorHeightMm;
      if (slabHeight > 24000) {
        if (refugeFloorLevels.length === 0) {
          refugeFloorLevels.push(fl);
        } else {
          const last = refugeFloorLevels[refugeFloorLevels.length - 1]!;
          if (fl - last === 7) {
            refugeFloorLevels.push(fl);
          }
        }
      }
    }
  }

  return {
    floorToFloorHeightMm,
    stiltHeightMm,
    basementHeightMm,
    totalBuildingHeightMm,
    hasStilt,
    hasBasement,
    minStaircases,
    minLifts,
    isHighRiseFireRegulated,
    requiresRefugeFloor,
    refugeFloorLevels,
  };
}

// ─── Helper: Create Canonical Room from Rectangular Box ──────────────────────

function unionOrthogonalBoxes(a: Box2D, b: Box2D): Point[] | null {
  const eps = 2;
  // Same vertical alignment (share horizontal edge at b bottom == a top, or a bottom == b top)
  if (Math.abs((b.y + b.h) - a.y) <= eps && b.x >= a.x - eps && b.x + b.w <= a.x + a.w + eps) {
    if (Math.abs(b.x - a.x) <= eps && Math.abs((b.x + b.w) - (a.x + a.w)) <= eps) {
      return [
        { x: a.x, y: b.y },
        { x: a.x + a.w, y: b.y },
        { x: a.x + a.w, y: a.y + a.h },
        { x: a.x, y: a.y + a.h },
      ];
    }
    if (Math.abs(b.x - a.x) <= eps) {
      return [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x + b.w, y: a.y },
        { x: a.x + a.w, y: a.y },
        { x: a.x + a.w, y: a.y + a.h },
        { x: a.x, y: a.y + a.h },
      ];
    }
    if (Math.abs((b.x + b.w) - (a.x + a.w)) <= eps) {
      return [
        { x: a.x, y: a.y },
        { x: b.x, y: a.y },
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: a.x + a.w, y: a.y + a.h },
        { x: a.x, y: a.y + a.h },
      ];
    }
  }
  if (Math.abs((a.y + a.h) - b.y) <= eps && b.x >= a.x - eps && b.x + b.w <= a.x + a.w + eps) {
    if (Math.abs(b.x - a.x) <= eps && Math.abs((b.x + b.w) - (a.x + a.w)) <= eps) {
      return [
        { x: a.x, y: a.y },
        { x: a.x + a.w, y: a.y },
        { x: a.x + a.w, y: b.y + b.h },
        { x: a.x, y: b.y + b.h },
      ];
    }
    if (Math.abs(b.x - a.x) <= eps) {
      return [
        { x: a.x, y: a.y },
        { x: a.x + a.w, y: a.y },
        { x: a.x + a.w, y: a.y + a.h },
        { x: b.x + b.w, y: a.y + a.h },
        { x: b.x + b.w, y: b.y + b.h },
        { x: a.x, y: b.y + b.h },
      ];
    }
    if (Math.abs((b.x + b.w) - (a.x + a.w)) <= eps) {
      return [
        { x: a.x, y: a.y },
        { x: a.x + a.w, y: a.y },
        { x: a.x + a.w, y: b.y + b.h },
        { x: b.x, y: b.y + b.h },
        { x: b.x, y: a.y + a.h },
        { x: a.x, y: a.y + a.h },
      ];
    }
  }
  // Rotated 90 deg (share vertical edge)
  if (Math.abs((b.x + b.w) - a.x) <= eps && b.y >= a.y - eps && b.y + b.h <= a.y + a.h + eps) {
    if (Math.abs(b.y - a.y) <= eps && Math.abs((b.y + b.h) - (a.y + a.h)) <= eps) {
      return [
        { x: b.x, y: a.y },
        { x: a.x + a.w, y: a.y },
        { x: a.x + a.w, y: a.y + a.h },
        { x: b.x, y: a.y + a.h },
      ];
    }
    if (Math.abs(b.y - a.y) <= eps) {
      return [
        { x: b.x, y: b.y },
        { x: a.x + a.w, y: a.y },
        { x: a.x + a.w, y: a.y + a.h },
        { x: a.x, y: a.y + a.h },
        { x: a.x, y: b.y + b.h },
        { x: b.x, y: b.y + b.h },
      ];
    }
    if (Math.abs((b.y + b.h) - (a.y + a.h)) <= eps) {
      return [
        { x: a.x, y: a.y },
        { x: a.x + a.w, y: a.y },
        { x: a.x + a.w, y: a.y + a.h },
        { x: b.x, y: b.y + b.h },
        { x: b.x, y: b.y },
        { x: a.x, y: b.y },
      ];
    }
  }
  if (Math.abs((a.x + a.w) - b.x) <= eps && b.y >= a.y - eps && b.y + b.h <= a.y + a.h + eps) {
    if (Math.abs(b.y - a.y) <= eps && Math.abs((b.y + b.h) - (a.y + a.h)) <= eps) {
      return [
        { x: a.x, y: a.y },
        { x: b.x + b.w, y: a.y },
        { x: b.x + b.w, y: a.y + a.h },
        { x: a.x, y: a.y + a.h },
      ];
    }
    if (Math.abs(b.y - a.y) <= eps) {
      return [
        { x: a.x, y: a.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
        { x: b.x, y: b.y + b.h },
        { x: b.x, y: a.y + a.h },
        { x: a.x, y: a.y + a.h },
      ];
    }
    if (Math.abs((b.y + b.h) - (a.y + a.h)) <= eps) {
      return [
        { x: a.x, y: a.y },
        { x: b.x, y: a.y },
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
        { x: a.x, y: a.y + a.h },
      ];
    }
  }
  return null;
}

function createBoxRoom(params: {
  id: string;
  name: string;
  type: RoomType;
  box: Box2D;
  polygonPoints?: readonly Point[];
  floorId: string;
  spaceUse?: 'UNIT' | 'COMMON' | 'CORE' | 'SERVICE' | 'OUTDOOR' | 'VOID';
  planningZone?: 'PUBLIC' | 'PRIVATE' | 'SERVICE' | 'OUTDOOR';
  unitId?: string;
  tags?: string[];
  architecturalRole?: Room['architecturalRole'];
}): Room {
  const boundary: Polygon = {
    points: params.polygonPoints && params.polygonPoints.length >= 4
      ? [...params.polygonPoints]
      : [
        { x: params.box.x, y: params.box.y },
        { x: params.box.x + params.box.w, y: params.box.y },
        { x: params.box.x + params.box.w, y: params.box.y + params.box.h },
        { x: params.box.x, y: params.box.y + params.box.h },
      ],
  };

  const pts = boundary.points;
  const minX = Math.min(...pts.map(p => p.x));
  const maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  const maxY = Math.max(...pts.map(p => p.y));
  let shoelaceArea = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % pts.length]!;
    shoelaceArea += p1.x * p2.y - p2.x * p1.y;
  }

  const result: Room = {
    id: params.id,
    name: params.name,
    type: params.type,
    floorId: params.floorId,
    boundary,
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    rotation: 0,
    area: params.polygonPoints ? Math.abs(shoelaceArea) / 2 : params.box.w * params.box.h,
    priority: 1,
    tags: params.tags ?? [],
    adjacencyRequirements: [],
    daylightRequirement: 'medium' as never,
    privacyRequirement: 'medium' as never,
    ventilationRequired: true,
    isFixed: !params.unitId,
    spaceUse: params.spaceUse,
    planningZone: params.planningZone,
    unitId: params.unitId,
  };
  const role = params.architecturalRole ?? architecturalSpaceRole(result);
  return { ...result, architecturalRole: role, ...(role === 'OPEN_TO_SKY_VOID' ? { openToSky: true, spaceUse: 'VOID' as const } : {}) };
}

const roomToBox = (r: Room) => ({ id: r.id, rect: { x: r.x, y: r.y, width: r.width, height: r.height } });

function rectPolygon(x: number, y: number, w: number, h: number): Polygon {
  return {
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  };
}

// ─── Sheet 1 Solver: SITE_PLAN (100% Plot Allotment) ─────────────────────────

export interface SitePlanSheetResult {
  readonly site: Site;
  readonly siteZones: readonly SiteZone[];
  readonly audit: SheetLedgerAudit;
}

export function solveSitePlanSheet(
  config: MultiSheetApartmentConfig,
  envelope: Box2D,
): SitePlanSheetResult {
  const plotW = config.plotWidthMm;
  const plotD = config.plotDepthMm;
  const plotArea = plotW * plotD;

  const siteZones: SiteZone[] = [];

  if (config.lotAllotmentMode === 'FULL_LOT_100_PERCENT') {
    // 100% Full Lot Mode: Building plinth occupies the entire plot
    siteZones.push({
      id: 'site_zone_bldg_plinth',
      kind: 'future_expansion',
      name: 'Building Plinth Footprint (100% Lot)',
      boundary: rectPolygon(0, 0, plotW, plotD),
      area: plotArea,
      accessLinks: ['road_main'],
      source: 'GENERATED',
      reviewStatus: 'REVIEWED',
    });
  } else {
    // STATUTORY_SETBACK_100_PERCENT Mode:
    // Partition plot into Plinth + 4 marginal setback bands that sum identically to plotArea:
    // 1. Rear Yard: [0, 0, plotW, envelope.y]
    // 2. Front Yard: [0, envelope.y + envelope.h, plotW, plotD - (envelope.y + envelope.h)]
    // 3. Left Side Yard: [0, envelope.y, envelope.x, envelope.h]
    // 4. Right Side Yard: [envelope.x + envelope.w, envelope.y, plotW - (envelope.x + envelope.w), envelope.h]
    // 5. Plinth: [envelope.x, envelope.y, envelope.w, envelope.h]

    const bldgX = envelope.x;
    const bldgY = envelope.y;
    const bldgW = envelope.w;
    const bldgH = envelope.h;

    const rearH = bldgY;
    const frontH = plotD - (bldgY + bldgH);
    const leftW = bldgX;
    const rightW = plotW - (bldgX + bldgW);

    // 1. Building Plinth
    siteZones.push({
      id: 'site_zone_bldg_plinth',
      kind: 'future_expansion',
      name: 'Residential Apartment Tower Footprint',
      boundary: rectPolygon(bldgX, bldgY, bldgW, bldgH),
      area: bldgW * bldgH,
      accessLinks: ['driveway_fire_tender'],
      source: 'GENERATED',
      reviewStatus: 'REVIEWED',
    });

    // 2. Front Yard Band: [0, bldgY + bldgH, plotW, frontH]
    // Vehicular Roadway Network:
    // Security Cabin (2400 x 2400 mm) + MAIN ENTRY GATE (IN - 4500 mm) + Continuous 6000mm Driveway
    // Surface Visitor Parking & EV Charging + MAIN EXIT GATE (OUT - 4500 mm)
    const frontY = bldgY + bldgH;
    let curX = 0;

    // Security Cabin (2400 x 2400 mm) at road entrance edge
    const secW = 2400;
    const secH = Math.min(2400, frontH);
    siteZones.push({
      id: 'site_zone_sec_cabin',
      kind: 'service',
      name: 'SECURITY CABIN (2400 x 2400 mm)',
      boundary: rectPolygon(curX, frontY, secW, secH),
      area: secW * secH,
      accessLinks: ['road_main'],
      source: 'GENERATED',
      reviewStatus: 'REVIEWED',
    });
    if (frontH > secH) {
      siteZones.push({
        id: 'site_zone_sec_apron',
        kind: 'pedestrian_circulation',
        name: 'Security Gate Paved Apron',
        boundary: rectPolygon(curX, frontY + secH, secW, frontH - secH),
        area: secW * (frontH - secH),
        accessLinks: ['road_main'],
        source: 'GENERATED',
        reviewStatus: 'REVIEWED',
      });
    }
    curX += secW;

    // MAIN ENTRY GATE (IN - 4500 mm)
    const entryGateW = 4500;
    siteZones.push({
      id: 'site_zone_main_entry_gate',
      kind: 'vehicle_circulation',
      name: 'MAIN ENTRY GATE (IN - 4500 mm)',
      boundary: rectPolygon(curX, frontY, entryGateW, frontH),
      area: entryGateW * frontH,
      accessLinks: ['road_main'],
      source: 'GENERATED',
      reviewStatus: 'REVIEWED',
    });
    curX += entryGateW;

    // Ingress Driveway Paved Apron to complete 6000mm Ingress Corridor
    const ingressApronW = 1500;
    siteZones.push({
      id: 'site_zone_ingress_driveway',
      kind: 'vehicle_circulation',
      name: '6000mm Two-Way Paved Ingress Driveway to Stilt Parking',
      boundary: rectPolygon(curX, frontY, ingressApronW, frontH),
      area: ingressApronW * frontH,
      accessLinks: ['driveway_fire_tender'],
      source: 'GENERATED',
      reviewStatus: 'REVIEWED',
    });
    curX += ingressApronW;

    // Egress corridor total width: 1500mm transition + 4500mm exit gate = 6000mm
    const exitGateW = 4500;
    const egressApronW = 1500;
    const egressTotalW = exitGateW + egressApronW;
    const remainingMiddleW = Math.max(0, plotW - curX - egressTotalW);

    // Surface Visitor Parking in middle
    if (remainingMiddleW > 0) {
      const carBayW = 2500;
      const carBayCount = Math.min(3, Math.floor(remainingMiddleW / carBayW));
      const totalCarW = carBayCount * carBayW;
      for (let c = 0; c < carBayCount; c++) {
        siteZones.push({
          id: `site_zone_vis_car_${c + 1}`,
          kind: 'parking',
          name: `Surface Visitor Car Bay V-0${c + 1} (2.5x5.0m)`,
          boundary: rectPolygon(curX + c * carBayW, frontY, carBayW, frontH),
          area: carBayW * frontH,
          accessLinks: ['driveway_fire_tender'],
          source: 'GENERATED',
          reviewStatus: 'REVIEWED',
        });
      }
      const remAfterCars = remainingMiddleW - totalCarW;
      if (remAfterCars > 0) {
        siteZones.push({
          id: 'site_zone_ev_charging',
          kind: 'parking',
          name: 'Dedicated EV Charging Bay & Paved Forecourt',
          boundary: rectPolygon(curX + totalCarW, frontY, remAfterCars, frontH),
          area: remAfterCars * frontH,
          accessLinks: ['driveway_fire_tender'],
          source: 'GENERATED',
          reviewStatus: 'REVIEWED',
        });
      }
      curX += remainingMiddleW;
    }

    // Egress Driveway Paved Apron
    siteZones.push({
      id: 'site_zone_egress_driveway',
      kind: 'vehicle_circulation',
      name: '6000mm Two-Way Paved Egress Driveway from Stilt Parking',
      boundary: rectPolygon(curX, frontY, egressApronW, frontH),
      area: egressApronW * frontH,
      accessLinks: ['driveway_fire_tender'],
      source: 'GENERATED',
      reviewStatus: 'REVIEWED',
    });
    curX += egressApronW;

    // MAIN EXIT GATE (OUT - 4500 mm)
    const finalExitW = plotW - curX;
    siteZones.push({
      id: 'site_zone_main_exit_gate',
      kind: 'vehicle_circulation',
      name: 'MAIN EXIT GATE (OUT - 4500 mm)',
      boundary: rectPolygon(curX, frontY, finalExitW, frontH),
      area: finalExitW * frontH,
      accessLinks: ['road_main'],
      source: 'GENERATED',
      reviewStatus: 'REVIEWED',
    });

    // 3. Rear Yard Band: [0, 0, plotW, rearH]
    // Sliced orthogonally into Site MEP Services & Continuous Rear Driveway Loop
    let rearX = 0;
    const dgW = 5000;
    siteZones.push({
      id: 'site_zone_dg_yard',
      kind: 'service',
      name: 'Acoustic Transformer & DG Yard (5x3m)',
      boundary: rectPolygon(rearX, 0, dgW, rearH),
      area: dgW * rearH,
      accessLinks: ['driveway_service'],
      source: 'GENERATED',
      reviewStatus: 'REVIEWED',
    });
    rearX += dgW;

    const ugwtW = 4000;
    siteZones.push({
      id: 'site_zone_ugwt_pump',
      kind: 'service',
      name: 'Underground Water Tank & Pump Room (UGWT)',
      boundary: rectPolygon(rearX, 0, ugwtW, rearH),
      area: ugwtW * rearH,
      accessLinks: ['driveway_service'],
      source: 'GENERATED',
      reviewStatus: 'REVIEWED',
    });
    rearX += ugwtW;

    const stpW = 4000;
    siteZones.push({
      id: 'site_zone_stp_plant',
      kind: 'service',
      name: 'Sewage Treatment Plant (STP)',
      boundary: rectPolygon(rearX, 0, stpW, rearH),
      area: stpW * rearH,
      accessLinks: ['driveway_service'],
      source: 'GENERATED',
      reviewStatus: 'REVIEWED',
    });
    rearX += stpW;

    const owcW = 3000;
    siteZones.push({
      id: 'site_zone_owc_waste',
      kind: 'service',
      name: 'Organic Waste Composter Yard (OWC)',
      boundary: rectPolygon(rearX, 0, owcW, rearH),
      area: owcW * rearH,
      accessLinks: ['driveway_service'],
      source: 'GENERATED',
      reviewStatus: 'REVIEWED',
    });
    rearX += owcW;

    const rwhW = 3000;
    siteZones.push({
      id: 'site_zone_rwh_pits',
      kind: 'service',
      name: 'Rainwater Harvesting Recharge Pits',
      boundary: rectPolygon(rearX, 0, rwhW, rearH),
      area: rwhW * rearH,
      accessLinks: ['driveway_service'],
      source: 'GENERATED',
      reviewStatus: 'REVIEWED',
    });
    rearX += rwhW;

    const remRearW = plotW - rearX;
    siteZones.push({
      id: 'site_zone_rear_service_road',
      kind: 'vehicle_circulation',
      name: 'Rear Service Driveway & Manifold Access Loop',
      boundary: rectPolygon(rearX, 0, remRearW, rearH),
      area: remRearW * rearH,
      accessLinks: ['driveway_service'],
      source: 'GENERATED',
      reviewStatus: 'REVIEWED',
    });

    // 4. Right Side Yard Band: [bldgX + bldgW, bldgY, rightW, bldgH]
    // 10% Statutory ROS Landscaped Garden as a single consolidated park zone on ONE side (East side)
    const rightX = bldgX + bldgW;
    siteZones.push({
      id: 'site_zone_statutory_ros_garden',
      kind: 'garden',
      name: '10% Statutory ROS Landscaped Garden & Central Park (A-SITE-LAND)',
      boundary: rectPolygon(rightX, bldgY, rightW, bldgH),
      area: rightW * bldgH,
      accessLinks: ['walkway_pedestrian'],
      source: 'GENERATED',
      reviewStatus: 'REVIEWED',
    });

    // 5. Left Side Yard Band: [0, bldgY, leftW, bldgH]
    // Continuous 6000mm Two-Way Paved Vehicular Driveway Loop into Under-Building Ground Stilt Parking
    siteZones.push({
      id: 'site_zone_west_fire_driveway',
      kind: 'vehicle_circulation',
      name: 'Continuous 6000mm Two-Way Paved Vehicular Driveway Loop into Ground Stilt Parking',
      boundary: rectPolygon(0, bldgY, leftW, bldgH),
      area: leftW * bldgH,
      accessLinks: ['road_main'],
      source: 'GENERATED',
      reviewStatus: 'REVIEWED',
    });
  }

  // Exact Planar Conservation Ledger Check for Site Plan
  const accountedArea = siteZones.reduce((sum, z) => sum + z.area, 0);
  const delta = plotArea - accountedArea;

  const audit: SheetLedgerAudit = {
    sheetId: 'sheet_01_site_plan',
    sheetName: 'Sheet 01: Site Layout & Landscape Plan',
    grossAreaMm2: plotArea,
    accountedAreaMm2: accountedArea,
    deltaMm2: delta,
    unassignedMm2: 0,
    isPlanarConserved: Math.abs(delta) < 0.001,
  };

  const roadFacingSide = config.roadAccessSides?.[0] ?? Direction.South;
  const site: Site = {
    id: 'project_site',
    plotBoundary: rectPolygon(0, 0, plotW, plotD),
    plotWidth: plotW,
    plotDepth: plotD,
    plotArea,
    plotShape: PlotShape.Rectangular,
    orientation: 0,
    setbacks: {
      front: config.lotAllotmentMode === 'FULL_LOT_100_PERCENT' ? 0 : plotD - (envelope.y + envelope.h),
      rear: config.lotAllotmentMode === 'FULL_LOT_100_PERCENT' ? 0 : envelope.y,
      left: config.lotAllotmentMode === 'FULL_LOT_100_PERCENT' ? 0 : envelope.x,
      right: config.lotAllotmentMode === 'FULL_LOT_100_PERCENT' ? 0 : plotW - (envelope.x + envelope.w),
    },
    accessPoints: [
      {
        id: 'acc_main_entry_gate',
        position: { x: 2400 + 2250, y: plotD },
        width: 4500,
        direction: roadFacingSide,
      },
      {
        id: 'acc_main_exit_gate',
        position: { x: plotW - 2250, y: plotD },
        width: 4500,
        direction: roadFacingSide,
      },
      {
        id: 'acc_sec_cabin',
        position: { x: 1200, y: plotD - 1200 },
        width: 2400,
        direction: roadFacingSide,
      },
    ],
    roadFacing: roadFacingSide,
    roadWidth: config.roadWidthMm,
    siteZones,
  };

  return { site, siteZones, audit };
}

// ─── Canonical Structural Column Solver ──────────────────────────────────────

/**
 * Derives canonical structural columns on the load-bearing grid, strictly
 * excluding any outer corners of cantilevered balconies, deduplicating
 * centers closer than 500 mm, and sequentially numbering C1..CN.
 */
export function deriveCleanStructuralColumns(
  floor: Floor,
  envelope: Box2D,
): Column[] {
  const indoorRooms = floor.rooms.filter(
    r => r.type !== RoomType.Balcony && !/BALCONY|SIT-OUT|UTILITY/i.test(r.name),
  );
  const balconyRooms = floor.rooms.filter(
    r => r.type === RoomType.Balcony || /BALCONY|SIT-OUT|UTILITY/i.test(r.name),
  );

  const isPointNearIndoorRoom = (pt: { x: number; y: number }): boolean => {
    return indoorRooms.some(r => {
      const minX = r.x - 50;
      const maxX = r.x + r.width + 50;
      const minY = r.y - 50;
      const maxY = r.y + r.height + 50;
      return pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY;
    });
  };

  const isOuterBalconyCorner = (pt: { x: number; y: number }): boolean => {
    for (const b of balconyRooms) {
      const corners = [
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x, y: b.y + b.height },
        { x: b.x + b.width, y: b.y + b.height },
      ];
      for (const c of corners) {
        if (Math.hypot(pt.x - c.x, pt.y - c.y) < 300) {
          if (!isPointNearIndoorRoom(c)) {
            return true;
          }
        }
      }
    }
    return false;
  };

  const snap = (v: number) => Math.round(v / 50) * 50;
  const rawPoints: Array<{ x: number; y: number }> = [];

  // 1. Grid intersections across building envelope
  const colSpacingX = 5000;
  const colSpacingY = 5000;
  for (let cx = envelope.x; cx <= envelope.x + envelope.w; cx += colSpacingX) {
    for (let cy = envelope.y; cy <= envelope.y + envelope.h; cy += colSpacingY) {
      rawPoints.push({ x: snap(cx), y: snap(cy) });
    }
  }

  // 2. Wall intersections (external walls, unit separation party walls, core walls)
  for (const w of floor.walls) {
    if (
      w.wallUse === 'EXTERNAL' ||
      w.wallUse === 'UNIT_SEPARATION' ||
      w.wallUse === 'CORE' ||
      w.type === 'external'
    ) {
      rawPoints.push({ x: snap(w.startPoint.x), y: snap(w.startPoint.y) });
      rawPoints.push({ x: snap(w.endPoint.x), y: snap(w.endPoint.y) });
    }
  }

  // 3. Filter out points on outer balcony corners (cantilevered slab) or strictly inside/only-touching OPEN_TO_SKY_VOID cutouts
  const roomToBox = (r: Room) =>
    r.boundary?.points?.length
      ? {
        x: Math.min(...r.boundary.points.map(pt => pt.x)),
        y: Math.min(...r.boundary.points.map(pt => pt.y)),
        w: Math.max(...r.boundary.points.map(pt => pt.x)) - Math.min(...r.boundary.points.map(pt => pt.x)),
        h: Math.max(...r.boundary.points.map(pt => pt.y)) - Math.min(...r.boundary.points.map(pt => pt.y)),
      }
      : { x: r.x, y: r.y, w: r.width, h: r.height };
  const voidBoxes = floor.rooms
    .filter(r => r.architecturalRole === 'OPEN_TO_SKY_VOID' && r.tags?.includes('recess:perimeter'))
    .map(roomToBox);
  const builtBoxes = floor.rooms
    .filter(r => r.architecturalRole !== 'OPEN_TO_SKY_VOID')
    .map(roomToBox);
  const inVoidOnly = (pt: { x: number; y: number }): boolean => {
    if (!voidBoxes.length) return false;
    if (voidBoxes.some(b => pt.x > b.x + 150 && pt.x < b.x + b.w - 150 && pt.y > b.y + 150 && pt.y < b.y + b.h - 150)) {
      return true;
    }
    if (!builtBoxes.length) return false;
    return !builtBoxes.some(
      b => pt.x >= b.x - 150 && pt.x <= b.x + b.w + 150 && pt.y >= b.y - 150 && pt.y <= b.y + b.h + 150,
    );
  };
  // Phase 3: no column may stand inside a stilt drive aisle or across the
  // entry edge of a parking bay (the bay edge shared with an aisle).
  const aisleBoxes = floor.rooms.filter(r => r.architecturalRole === 'VEHICLE_AISLE').map(roomToBox);
  const blocksDriveAisle = (pt: { x: number; y: number }): boolean =>
    aisleBoxes.some(b => pt.x > b.x + 150 && pt.x < b.x + b.w - 150 && pt.y > b.y + 150 && pt.y < b.y + b.h - 150)
    || aisleBoxes.some(b => {
      const onHorizontalEdge = (Math.abs(pt.y - b.y) <= 150 || Math.abs(pt.y - (b.y + b.h)) <= 150) && pt.x > b.x + 150 && pt.x < b.x + b.w - 150;
      const onVerticalEdge = (Math.abs(pt.x - b.x) <= 150 || Math.abs(pt.x - (b.x + b.w)) <= 150) && pt.y > b.y + 150 && pt.y < b.y + b.h - 150;
      return onHorizontalEdge || onVerticalEdge;
    });
  const nonBalconyPoints = rawPoints.filter(p => !isOuterBalconyCorner(p) && !inVoidOnly(p) && !blocksDriveAisle(p));

  // 4. Deduplicate: merge any points closer than 500 mm
  const deduplicated: Array<{ x: number; y: number }> = [];
  for (const p of nonBalconyPoints) {
    if (!deduplicated.some(d => Math.hypot(d.x - p.x, d.y - p.y) < 500)) {
      deduplicated.push(p);
    }
  }

  // 5. Sort top-to-bottom (row Y within 300 mm tolerance), then left-to-right (X)
  deduplicated.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 300) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });

  return deduplicated.map((p, idx) => ({
    id: `col_${idx + 1}`,
    floorId: floor.id,
    position: p,
    width: 450,
    depth: 450,
    shape: ColumnShape.Rectangular,
    isStructural: true,
    gridReference: `C${idx + 1}`,
  }));
}

/**
 * The parts of `box` not covered by any of `blockers`, as axis-aligned pieces.
 *
 * Used where a region offered for packing may already be partly built on. Only
 * whole free rectangles are returned, so a caller can place content in them
 * without re-checking for overlap. The decomposition is not minimal; it is
 * exact, which is what matters for an area ledger.
 */
function subtractBoxes(box: Box2D, blockers: readonly Box2D[]): Box2D[] {
  let pieces: Box2D[] = [box];
  for (const blocker of blockers) {
    const next: Box2D[] = [];
    for (const piece of pieces) {
      const overlapsX = piece.x < blocker.x + blocker.w && blocker.x < piece.x + piece.w;
      const overlapsY = piece.y < blocker.y + blocker.h && blocker.y < piece.y + piece.h;
      if (!overlapsX || !overlapsY) {
        next.push(piece);
        continue;
      }
      // Up to four slabs around the blocker's intersection with this piece.
      const loX = Math.max(piece.x, blocker.x);
      const hiX = Math.min(piece.x + piece.w, blocker.x + blocker.w);
      const loY = Math.max(piece.y, blocker.y);
      const hiY = Math.min(piece.y + piece.h, blocker.y + blocker.h);

      if (loY > piece.y) next.push({ x: piece.x, y: piece.y, w: piece.w, h: loY - piece.y });
      if (hiY < piece.y + piece.h) next.push({ x: piece.x, y: hiY, w: piece.w, h: piece.y + piece.h - hiY });
      if (loX > piece.x) next.push({ x: piece.x, y: loY, w: loX - piece.x, h: hiY - loY });
      if (hiX < piece.x + piece.w) next.push({ x: hiX, y: loY, w: piece.x + piece.w - hiX, h: hiY - loY });
    }
    pieces = next.filter(p => p.w > 0 && p.h > 0);
  }
  return pieces;
}

// ─── Sheet 2 Solver: STILT_PARKING_PLAN (Delta = 0.000 mm²) ──────────────────

export interface StiltParkingSheetResult {
  readonly floor: Floor;
  readonly carBaysCount: number;
  readonly bikeBaysCount: number;
  readonly audit: SheetLedgerAudit;
}

export function solveStiltParkingSheet(
  config: MultiSheetApartmentConfig,
  envelope: Box2D,
  macro: MacroPartition,
  stackParams: BuildingStackParameters,
): StiltParkingSheetResult {
  const floorId = 'floor_stilt_00';
  const rooms: Room[] = [];
  const doors: Door[] = [];
  const columns: Column[] = [];

  // 1. Locked Vertical Core (Staircases, Lifts, Lobby, Shafts)
  // Must match typical floor coordinates exactly to the millimeter, and must
  // place EVERY element: a split-core organization has more than two stairs or
  // lifts, and a shaft that exists above but not here would have stilt slab
  // driven through it.
  const stair1 = createBoxRoom({
    id: 'stilt__stair_1',
    name: 'Staircase 01 (Main)',
    type: RoomType.Staircase,
    spaceUse: 'CORE',
    box: macro.stairBoxes[0]!,
    floorId,
    tags: ['core:stair'],
  });
  rooms.push(stair1);

  for (let i = 1; i < macro.stairBoxes.length; i++) {
    rooms.push(createBoxRoom({
      id: `stilt__stair_${i + 1}`,
      name: i === 1 ? 'Staircase 02 (Fire Escape)' : `Staircase 0${i + 1}`,
      type: RoomType.Staircase,
      spaceUse: 'CORE',
      box: macro.stairBoxes[i]!,
      floorId,
      tags: ['core:stair'],
    }));
  }

  const lift1 = createBoxRoom({
    id: 'stilt__lift_1',
    name: 'Passenger Lift 01',
    type: RoomType.Lift,
    spaceUse: 'CORE',
    box: macro.liftBoxes[0]!,
    floorId,
    tags: ['core:lift'],
  });
  rooms.push(lift1);

  for (let i = 1; i < macro.liftBoxes.length; i++) {
    rooms.push(createBoxRoom({
      id: `stilt__lift_${i + 1}`,
      name: i === 1 ? 'Stretcher / Fire Lift 02' : `Passenger Lift 0${i + 1}`,
      type: RoomType.Lift,
      spaceUse: 'CORE',
      box: macro.liftBoxes[i]!,
      floorId,
      tags: ['core:lift'],
    }));
  }

  // Every lobby and corridor of the chosen organization is repeated at stilt
  // level. Placing only the primary pair would leave the secondary circulation
  // of a courtyard or split-core plan as unassigned area, which fails the
  // planar area ledger, and would put stilt slab where a corridor runs above.
  // An organization may have no separate lift lobby, where the cars open
  // straight onto the corridor. Place a lobby room only for a real one.
  const stiltLobbyBoxes = macroLobbyBoxes(macro);
  for (let i = 0; i < stiltLobbyBoxes.length; i++) {
    rooms.push(createBoxRoom({
      id: i === 0 ? 'stilt__core_lobby' : `stilt__core_lobby_${i + 1}`,
      architecturalRole: 'LIFT_LOBBY',
      name: stiltLobbyBoxes.length > 1 ? `Stilt Lift Lobby 0${i + 1}` : 'Stilt Central Lift Lobby',
      type: RoomType.Corridor,
      spaceUse: 'CORE',
      box: stiltLobbyBoxes[i]!,
      floorId,
      tags: ['core:lobby'],
    }));
  }

  const stiltCorridorBoxes = macroCorridorBoxes(macro);
  for (let i = 0; i < stiltCorridorBoxes.length; i++) {
    rooms.push(createBoxRoom({
      id: i === 0 ? 'stilt__corridor_spine' : `stilt__corridor_spine_${i + 1}`,
      name: stiltCorridorBoxes.length > 1 ? `Stilt Circulation Spine 0${i + 1}` : 'Stilt Central Circulation Spine',
      type: RoomType.Corridor,
      spaceUse: 'CORE',
      box: stiltCorridorBoxes[i]!,
      floorId,
      tags: ['core:corridor'],
    }));
  }
  const stiltCorridor = rooms.find(r => r.id === 'stilt__corridor_spine')!;
  const stiltLobby = rooms.find(r => r.id === 'stilt__core_lobby') ?? stiltCorridor;

  for (let s = 0; s < macro.shaftBoxes.length; s++) {
    const shaft = createBoxRoom({
      id: `stilt__shaft_${s + 1}`,
      architecturalRole: macro.shaftRoles?.[s],
      name: macro.shaftRoles?.[s] === 'OPEN_TO_SKY_VOID' ? 'Open-to-sky courtyard at stilt' : `MEP Service Shaft 0${s + 1}`,
      type: RoomType.ServiceShaft,
      spaceUse: 'SERVICE',
      box: macro.shaftBoxes[s]!,
      floorId,
      tags: ['core:shaft', ...(macro.shaftTags?.[s] ?? [])],
    });
    rooms.push(shaft);
  }

  // 2. West Wing: Indoor Amenities + Parking Zone A
  // Sliced completely across macro.flatBoxes[0]
  const westBox = macro.flatBoxes[0]!;
  const amenityH = snap10(westBox.h * 0.42);
  const westParkH = westBox.h - amenityH;

  // Stilt Indoor Amenities: Grand Lobby, Society Office, Gym, Multipurpose Hall, Meter Room, Toilet
  const amenityBox: Box2D = { x: westBox.x, y: westBox.y, w: westBox.w, h: amenityH };
  const amLobbyW = snap10(amenityBox.w * 0.40);
  const amOfficeW = snap10(amenityBox.w * 0.25);
  const amGymW = amenityBox.w - (amLobbyW + amOfficeW);

  const grandLobby = createBoxRoom({
    id: 'stilt__grand_lobby',
    architecturalRole: 'ENCLOSED_HABITABLE',
    name: 'Grand Entrance Double-Height Lobby',
    type: RoomType.Foyer,
    spaceUse: 'COMMON',
    box: { x: amenityBox.x, y: amenityBox.y, w: amLobbyW, h: amenityBox.h },
    floorId,
  });
  rooms.push(grandLobby);

  const officeH = snap10(amenityBox.h * 0.65);
  const toiletH = amenityBox.h - officeH;

  const office = createBoxRoom({
    id: 'stilt__society_office',
    architecturalRole: config.stiltAmenities.societyOffice ? 'ENCLOSED_SERVICE' : 'OPEN_CIRCULATION',
    name: config.stiltAmenities.societyOffice ? 'Society Administrative Office' : 'Open stilt circulation',
    type: RoomType.Custom,
    spaceUse: 'COMMON',
    box: { x: amenityBox.x + amLobbyW, y: amenityBox.y, w: amOfficeW, h: officeH },
    floorId,
  });
  rooms.push(office);

  const staffToilet = createBoxRoom({
    id: 'stilt__staff_toilet',
    architecturalRole: config.stiltAmenities.driverStaffToilet ? 'ENCLOSED_SERVICE' : 'OPEN_CIRCULATION',
    name: config.stiltAmenities.driverStaffToilet ? 'Driver & Maintenance Staff Toilet' : 'Open stilt circulation',
    type: RoomType.Bathroom,
    spaceUse: 'SERVICE',
    box: { x: amenityBox.x + amLobbyW, y: amenityBox.y + officeH, w: amOfficeW, h: toiletH },
    floorId,
  });
  rooms.push(staffToilet);

  const gymH = snap10(amenityBox.h * 0.70);
  const meterH = amenityBox.h - gymH;

  const gym = createBoxRoom({
    id: 'stilt__gymnasium',
    architecturalRole: config.stiltAmenities.fitnessGymnasium ? 'ENCLOSED_SERVICE' : 'OPEN_CIRCULATION',
    name: config.stiltAmenities.fitnessGymnasium ? 'Fitness Center & Health Gymnasium' : 'Open stilt circulation',
    type: RoomType.Custom,
    spaceUse: 'COMMON',
    box: { x: amenityBox.x + amLobbyW + amOfficeW, y: amenityBox.y, w: amGymW, h: gymH },
    floorId,
  });
  rooms.push(gym);

  const meterRoom = createBoxRoom({
    id: 'stilt__meter_bms_room',
    architecturalRole: config.stiltAmenities.meterBmsRoom ? 'ENCLOSED_SERVICE' : 'OPEN_CIRCULATION',
    name: config.stiltAmenities.meterBmsRoom ? 'Electric Meter & BMS Control Room' : 'Open stilt circulation',
    type: RoomType.Custom,
    spaceUse: 'SERVICE',
    box: { x: amenityBox.x + amLobbyW + amOfficeW, y: amenityBox.y + gymH, w: amGymW, h: meterH },
    floorId,
  });
  rooms.push(meterRoom);

  // Stilt Parking Zone A (West South) & Zone B (East Wing): Car bays + 2W bays + Driveway
  let carBaysCount = 0;
  let bikeBaysCount = 0;

  const packBikeRemainder = (strip: Box2D, aisleSide: 'WEST' | 'EAST' | 'NORTH' | 'SOUTH', zoneKey: string) => {
    const vertical = aisleSide === 'WEST' || aisleSide === 'EAST';
    const approachSpan = vertical ? strip.h : strip.w;
    const depth = vertical ? strip.w : strip.h;
    const stallCount = Math.floor(approachSpan / 1000);
    const aisleAtHighEdge = aisleSide === 'EAST' || aisleSide === 'SOUTH';
    const fromAisle = (along: number, span: number, offset: number, run: number): Box2D => {
      const across = aisleAtHighEdge ? depth - offset - run : offset;
      return vertical
        ? { x: strip.x + across, y: strip.y + along, w: run, h: span }
        : { x: strip.x + along, y: strip.y + across, w: span, h: run };
    };
    const addCirculation = (box: Box2D) => {
      if (box.w <= 0 || box.h <= 0) return;
      rooms.push(createBoxRoom({
        id: `stilt__open_remainder_${zoneKey}_${rooms.length}`,
        name: 'Open parking remainder', type: RoomType.Foyer, spaceUse: 'COMMON', box, floorId,
      }));
    };
    if (depth < 2000 || stallCount === 0) {
      addCirculation(strip);
      return;
    }
    for (let index = 0; index < stallCount; index++) {
      const number = String(++bikeBaysCount).padStart(2, '0');
      rooms.push(createBoxRoom({
        id: `stilt__bike_bay_b${number}`, name: `Two-Wheeler Parking Bay B-${number}`,
        architecturalRole: 'PARKING_BAY', type: RoomType.Parking, spaceUse: 'COMMON',
        box: fromAisle(index * 1000, 1000, 0, 2000), floorId, tags: [`parking:B-${number}`],
      }));
    }
    addCirculation(fromAisle(stallCount * 1000, approachSpan - stallCount * 1000, 0, 2000));
    addCirculation(fromAisle(0, approachSpan, 2000, depth - 2000));
  };

  const packParkingBox = (box: Box2D, zoneKey: string) => {
    // Standard Indian car stall is 2,500 x 5,000 mm abutting a clear driveway aisle
    // (>= 3,600 mm one-way or >= 6,000 mm two-way). Never create an aisle narrower than 3,600 mm.
    const stallWidth = 2500;
    const stallDepth = 5000;
    const minOneWayAisle = 3600;
    const minTwoWayAisle = 6000;

    const horizFit = box.w >= stallWidth && box.h >= stallDepth + minOneWayAisle;
    const horizDouble = horizFit && box.h >= 2 * stallDepth + minTwoWayAisle;
    const horizCount = horizFit ? Math.floor(box.w / stallWidth) * (horizDouble ? 2 : 1) : 0;

    const vertFit = box.h >= stallWidth && box.w >= stallDepth + minOneWayAisle;
    const vertDouble = vertFit && box.w >= 2 * stallDepth + minTwoWayAisle;
    const vertCount = vertFit ? Math.floor(box.h / stallWidth) * (vertDouble ? 2 : 1) : 0;

    if (horizCount === 0 && vertCount === 0) {
      rooms.push(
        createBoxRoom({
          id: `stilt__driveway_${zoneKey}`,
          architecturalRole: Math.min(box.w, box.h) >= minOneWayAisle ? 'VEHICLE_AISLE' : 'OPEN_CIRCULATION',
          name: Math.min(box.w, box.h) >= minOneWayAisle
            ? `Stilt Vehicular Driveway & Maneuvering Aisle (${zoneKey})`
            : `Stilt Circulation Apron (${zoneKey})`,
          type: RoomType.Corridor,
          spaceUse: 'COMMON',
          box,
          floorId,
        }),
      );
      return;
    }

    if (vertCount > horizCount) {
      // Rotated layout: 5,000 mm deep (X) x 2,500 mm wide (Y) stalls abutting a clear vertical aisle.
      const numRows = Math.floor(box.h / stallWidth);
      const stallsH = numRows * stallWidth;
      const remH = box.h - stallsH;

      // West Column of Car Bays (5,000 x 2,500 mm, P-01..)
      for (let r = 0; r < numRows; r++) {
        carBaysCount++;
        const tag = `P-${String(carBaysCount).padStart(2, '0')}`;
        const bayId = `stilt__car_bay_p${String(carBaysCount).padStart(2, '0')}`;
        rooms.push(
          createBoxRoom({
            id: bayId,
            architecturalRole: 'PARKING_BAY',
            name: `Covered Car Parking Bay ${tag} (2.5x5.0m)`,
            type: RoomType.Parking,
            spaceUse: 'COMMON',
            box: { x: box.x, y: box.y + r * stallWidth, w: stallDepth, h: stallWidth },
            floorId,
            tags: [`parking:${tag}`],
          }),
        );
      }

      packBikeRemainder({ x: box.x, y: box.y + stallsH, w: stallDepth, h: remH }, 'EAST', zoneKey);

      if (vertDouble) {
        const eastX = box.x + box.w - stallDepth;
        for (let r = 0; r < numRows; r++) {
          carBaysCount++;
          const tag = `P-${String(carBaysCount).padStart(2, '0')}`;
          const bayId = `stilt__car_bay_p${String(carBaysCount).padStart(2, '0')}`;
          rooms.push(
            createBoxRoom({
              id: bayId,
              architecturalRole: 'PARKING_BAY',
              name: `Covered Car Parking Bay ${tag} (2.5x5.0m)`,
              type: RoomType.Parking,
              spaceUse: 'COMMON',
              box: { x: eastX, y: box.y + r * stallWidth, w: stallDepth, h: stallWidth },
              floorId,
              tags: [`parking:${tag}`],
            }),
          );
        }

        packBikeRemainder({ x: eastX, y: box.y + stallsH, w: stallDepth, h: remH }, 'WEST', zoneKey);

        const driveW = box.w - 2 * stallDepth;
        rooms.push(
          createBoxRoom({
            id: `stilt__driveway_${zoneKey}`,
            architecturalRole: 'VEHICLE_AISLE',
            name: `Two-Way Vehicular Driveway (${(driveW / 1000).toFixed(1)}m Clear)`,
            type: RoomType.Corridor,
            spaceUse: 'COMMON',
            box: { x: box.x + stallDepth, y: box.y, w: driveW, h: box.h },
            floorId,
            tags: ['driveway:two_way'],
          }),
        );
      } else {
        const driveW = box.w - stallDepth;
        rooms.push(
          createBoxRoom({
            id: `stilt__driveway_${zoneKey}`,
            architecturalRole: 'VEHICLE_AISLE',
            name: `${driveW >= minTwoWayAisle ? 'Two-Way' : 'One-Way'} Vehicular Driveway (${(driveW / 1000).toFixed(1)}m Clear)`,
            type: RoomType.Corridor,
            spaceUse: 'COMMON',
            box: { x: box.x + stallDepth, y: box.y, w: driveW, h: box.h },
            floorId,
            tags: [driveW >= minTwoWayAisle ? 'driveway:two_way' : 'driveway:one_way'],
          }),
        );
      }
      return;
    }

    const numStalls = Math.floor(box.w / stallWidth);
    const stallsW = numStalls * stallWidth;
    const remW = box.w - stallsW;
    // Double-loaded only when the remaining central driveway is >= 6,000 mm (two-way).
    const isDoubleLoaded = box.h >= 2 * stallDepth + minTwoWayAisle;

    // North Row of Car Bays (2,500 x 5,000 mm, P-01..)
    for (let s = 0; s < numStalls; s++) {
      carBaysCount++;
      const tag = `P-${String(carBaysCount).padStart(2, '0')}`;
      const bayId = `stilt__car_bay_p${String(carBaysCount).padStart(2, '0')}`;
      rooms.push(
        createBoxRoom({
          id: bayId,
          architecturalRole: 'PARKING_BAY',
          name: `Covered Car Parking Bay ${tag} (2.5x5.0m)`,
          type: RoomType.Parking,
          spaceUse: 'COMMON',
          box: { x: box.x + s * stallWidth, y: box.y, w: stallWidth, h: stallDepth },
          floorId,
          tags: [`parking:${tag}`],
        }),
      );
    }

    // North Remainder Two-Wheeler Bay
    packBikeRemainder({ x: box.x + stallsW, y: box.y, w: remW, h: stallDepth }, 'SOUTH', zoneKey);

    if (isDoubleLoaded) {
      // South Row of Car Bays (2,500 x 5,000 mm, P-01..)
      const southY = box.y + box.h - stallDepth;
      for (let s = 0; s < numStalls; s++) {
        carBaysCount++;
        const tag = `P-${String(carBaysCount).padStart(2, '0')}`;
        const bayId = `stilt__car_bay_p${String(carBaysCount).padStart(2, '0')}`;
        rooms.push(
          createBoxRoom({
            id: bayId,
            architecturalRole: 'PARKING_BAY',
            name: `Covered Car Parking Bay ${tag} (2.5x5.0m)`,
            type: RoomType.Parking,
            spaceUse: 'COMMON',
            box: { x: box.x + s * stallWidth, y: southY, w: stallWidth, h: stallDepth },
            floorId,
            tags: [`parking:${tag}`],
          }),
        );
      }

      // South Remainder Two-Wheeler Bay
      packBikeRemainder({ x: box.x + stallsW, y: southY, w: remW, h: stallDepth }, 'NORTH', zoneKey);

      // Central Two-Way Driveway Aisle (>= 6,000 mm)
      const driveH = box.h - 2 * stallDepth;
      rooms.push(
        createBoxRoom({
          id: `stilt__driveway_${zoneKey}`,
          architecturalRole: 'VEHICLE_AISLE',
          name: `Two-Way Vehicular Driveway (${(driveH / 1000).toFixed(1)}m Clear)`,
          type: RoomType.Corridor,
          spaceUse: 'COMMON',
          box: { x: box.x, y: box.y + stallDepth, w: box.w, h: driveH },
          floorId,
          tags: ['driveway:two_way'],
        }),
      );
    } else {
      // Single Row + One-Way Driveway Aisle (>= 3,600 mm)
      const driveH = box.h - stallDepth;
      rooms.push(
        createBoxRoom({
          id: `stilt__driveway_${zoneKey}`,
          architecturalRole: 'VEHICLE_AISLE',
          name: `${driveH >= minTwoWayAisle ? 'Two-Way' : 'One-Way'} Vehicular Driveway (${(driveH / 1000).toFixed(1)}m Clear)`,
          type: RoomType.Corridor,
          spaceUse: 'COMMON',
          box: { x: box.x, y: box.y + stallDepth, w: box.w, h: driveH },
          floorId,
          tags: [driveH >= minTwoWayAisle ? 'driveway:two_way' : 'driveway:one_way'],
        }),
      );
    }
  };

  // Parking is packed into the parts of each flat footprint that are genuinely
  // free. The core is placed first, and in some organizations a corridor runs
  // the full length of the plot and crosses the flat footprints above; packing
  // a footprint wholesale would then drive parking stalls through that
  // corridor. So every zone is clipped against what has already been placed.
  const occupied = rooms.map(r => ({ x: r.x, y: r.y, w: r.width, h: r.height }));

  const packFree = (box: Box2D, zoneKey: string) => {
    for (const free of subtractBoxes(box, occupied)) {
      if (free.w < 2500 || free.h < 2500) continue;
      // The free cells are measured to wall centre lines. Reserve the full
      // exterior half-thickness before laying out the clear stall markings.
      const wallFaceAllowance = 115;
      const clear = {
        x: free.x + wallFaceAllowance, y: free.y + wallFaceAllowance,
        w: free.w - 2 * wallFaceAllowance, h: free.h - 2 * wallFaceAllowance,
      };
      for (const strip of subtractBoxes(free, [clear])) {
        rooms.push(createBoxRoom({
          id: `stilt__parking_clearance_${zoneKey}_${rooms.length}`,
          name: 'Parking perimeter clearance', type: RoomType.Foyer,
          architecturalRole: 'OPEN_CIRCULATION', spaceUse: 'COMMON', box: strip, floorId,
        }));
      }
      packParkingBox(clear, zoneKey);
      occupied.push(free);
    }
  };

  // Zone A (West South)
  packFree({ x: westBox.x, y: westBox.y + amenityH, w: westBox.w, h: westParkH }, 'west');

  // Zone B (remaining flat footprints)
  for (let fb = 1; fb < macro.flatBoxes.length; fb++) {
    packFree(macro.flatBoxes[fb]!, `east_0${fb}`);
  }

  // Zone C: the open strips an organization leaves between its flats and the
  // plot edge become surface parking at stilt level. Earlier partitions had the
  // flats tile everything but the core, so this was empty; a topology that sets
  // its building in leaves real area here, and packing it is what keeps the
  // stilt floor's area ledger exact.
  //
  // Each strip is clipped against everything already placed, so a strip that
  // is partly occupied contributes only its free remainder and parking can
  // never land on a corridor, stair or shaft.
  const freeStrips = macro.shaftBoxes.filter((box, i) =>
    macro.shaftRoles?.[i] === 'OPEN_TO_SKY_VOID' && box.w >= 2500 && box.h >= 2500,
  );
  let openZone = 0;
  for (const strip of freeStrips) packFree(strip, `open_0${++openZone}`);

  // 4. Generate Stilt Floor Walls
  const stiltBoundary = rectPolygon(envelope.x, envelope.y, envelope.w, envelope.h);
  const walls = generateApartmentWalls(rooms, floorId, stiltBoundary, true, config.architectureOptions?.guardHeightMm);

  // Main Ground / Stilt Entrance Door on Grand Entrance Lobby exterior facade
  const lobbyExtWalls = walls
    .filter(w => w.wallUse === 'EXTERNAL' && w.roomIds.length === 1 && w.roomIds.includes(grandLobby.id) && w.boundaryRole === 'FULL_HEIGHT_WALL')
    .sort((a, b) => Math.hypot(b.endPoint.x - b.startPoint.x, b.endPoint.y - b.startPoint.y) - Math.hypot(a.endPoint.x - a.startPoint.x, a.endPoint.y - a.startPoint.y));
  const mainEntryWall = lobbyExtWalls[0];
  if (mainEntryWall) {
    const wallLen = Math.hypot(mainEntryWall.endPoint.x - mainEntryWall.startPoint.x, mainEntryWall.endPoint.y - mainEntryWall.startPoint.y);
    const entryDoorW = wallLen >= 1700 ? 1500 : wallLen >= 1250 ? 1050 : 0;
    const entryPos = {
      x: (mainEntryWall.startPoint.x + mainEntryWall.endPoint.x) / 2,
      y: (mainEntryWall.startPoint.y + mainEntryWall.endPoint.y) / 2,
    };
    if (entryDoorW > 0 && openingFitsApartmentWall(mainEntryWall, entryPos, entryDoorW)) {
      doors.push({
        id: 'door_stilt_grand_lobby_main_entrance',
        openingGeometryVersion: 1,
        positionReference: 'CENTER',
        floorId,
        wallId: mainEntryWall.id,
        position: entryPos,
        width: entryDoorW,
        height: 2100,
        type: entryDoorW >= 1500 ? DoorType.Double : DoorType.Single,
        swingDirection: SwingDirection.Inward,
        connectsRooms: [grandLobby.id, '__outside__'],
      });
      (mainEntryWall as { hasOpening: boolean }).hasOpening = true;
    }
  }

  // 5. Host-fitting Open Passage Walkthrough for Staircase 01 (Clean 1200mm, Zero Swinging Door)
  const dStair1 = createConnectingDoor('door_stilt_stair1', roomToBox(stiltLobby), roomToBox(stair1), 1200, { doorType: 'open_passage' });
  if (dStair1) {
    const hostWall = walls.find(w => w.roomIds.includes(stiltLobby.id) && w.roomIds.includes(stair1.id))
      ?? walls.find(w => openingFitsApartmentWall(w, { x: snap10(dStair1.rect.x + dStair1.rect.width / 2), y: snap10(dStair1.rect.y + dStair1.rect.height / 2) }, 1200));
    if (hostWall) {
      doors.push({
        id: dStair1.id,
        floorId,
        wallId: hostWall.id,
        position: { x: snap10(dStair1.rect.x + dStair1.rect.width / 2), y: snap10(dStair1.rect.y + dStair1.rect.height / 2) },
        width: 1200,
        height: 2100,
        type: DoorType.OpenPassage,
        swingDirection: SwingDirection.Inward,
        connectsRooms: [stiltLobby.id, stair1.id],
      });
      (hostWall as { hasOpening: boolean }).hasOpening = true;
    }
  }

  const dLobbyCorr = createConnectingDoor('door_stilt_lobby_corr', roomToBox(stiltLobby), roomToBox(stiltCorridor), 1500, { doorType: 'open_passage' });
  if (dLobbyCorr) {
    const hostWall = walls.find(w => w.roomIds.includes(stiltLobby.id) && w.roomIds.includes(stiltCorridor.id))
      ?? walls.find(w => openingFitsApartmentWall(w, { x: snap10(dLobbyCorr.rect.x + dLobbyCorr.rect.width / 2), y: snap10(dLobbyCorr.rect.y + dLobbyCorr.rect.height / 2) }, 1500));
    if (hostWall) {
      doors.push({
        id: dLobbyCorr.id,
        floorId,
        wallId: hostWall.id,
        position: { x: snap10(dLobbyCorr.rect.x + dLobbyCorr.rect.width / 2), y: snap10(dLobbyCorr.rect.y + dLobbyCorr.rect.height / 2) },
        width: 1500,
        height: 2100,
        type: DoorType.OpenPassage,
        swingDirection: SwingDirection.Inward,
        connectsRooms: [stiltLobby.id, stiltCorridor.id],
      });
      (hostWall as { hasOpening: boolean }).hasOpening = true;
    }
  }

  // 6. Structural RCC Columns (S-COLS): Deduplicated, sequentially numbered C1..CN, zero balcony outer corners
  const tempFloor: Floor = {
    id: floorId,
    buildingId: 'apartment_building',
    level: 0,
    name: 'STILT_PARKING_PLAN',
    floorHeight: stackParams.stiltHeightMm,
    boundary: stiltBoundary,
    rooms,
    walls,
    doors,
    windows: [],
    stairs: [],
    columns: [],
  };
  if (config.structuralLayoutMode === 'PROVISIONAL_EXISTING_PROFILE') columns.push(...deriveCleanStructuralColumns(tempFloor, envelope));

  const floor: Floor = {
    id: floorId,
    buildingId: 'apartment_building',
    level: 0,
    name: 'STILT_PARKING_PLAN',
    floorHeight: stackParams.stiltHeightMm,
    boundary: stiltBoundary,
    rooms,
    walls,
    doors,
    windows: [],
    stairs: [],
    columns,
  };

  const ledger = measureApartmentAreaLedger(floor);
  const audit: SheetLedgerAudit = {
    sheetId: 'sheet_02_stilt_plan',
    sheetName: 'Sheet 02: Stilt Floor Parking & Amenities Plan',
    grossAreaMm2: ledger.gross,
    accountedAreaMm2: ledger.accounted,
    deltaMm2: ledger.delta,
    unassignedMm2: ledger.unassigned,
    isPlanarConserved: Math.abs(ledger.delta) < 0.001 && ledger.unassigned === 0,
  };

  return { floor, carBaysCount, bikeBaysCount, audit };
}

// ─── Sheet 3 Solver: TYPICAL_FLOOR_PLAN (Delta = 0.000 mm²) ──────────────────

export interface TypicalFloorSheetResult {
  readonly floor: Floor;
  readonly structure: ApartmentPlanStructure;
  readonly audit: SheetLedgerAudit;
  readonly shapeId?: BuildingMassingShape;
}

export function solveTypicalFloorSheet(
  config: MultiSheetApartmentConfig,
  envelope: Box2D,
  floorLevel: number = 1,
  /**
   * The organization chosen by the generative topology engine. Supplied by
   * `solveMultiSheetApartmentProject` so every level of the stack repeats the
   * same core, corridors and shafts. Omitted only by legacy direct callers,
   * which then get the historical single central-core partition.
   */
  topology?: SelectedTopology,
  options?: { floorVariant?: 'ODD' | 'EVEN' },
): TypicalFloorSheetResult {
  const floorId = floorLevel === 1 ? 'floor_typical_01' : `floor_level_${String(floorLevel).padStart(2, '0')}`;
  const floorName = floorLevel === 0 ? 'GROUND_FLOOR_PLAN' : floorLevel === 1 ? '1ST_FLOOR_PLAN'
    : floorLevel === 2 ? '2ND_FLOOR_PLAN'
      : floorLevel === 3 ? '3RD_FLOOR_PLAN'
        : `${floorLevel}TH_FLOOR_PLAN`;

  const manifest = createDynamicApartmentManifest({
    plotWidthMm: config.plotWidthMm,
    plotDepthMm: config.plotDepthMm,
    flatsPerFloor: config.flatsPerFloor,
    units: config.units,
    jurisdiction: config.jurisdiction,
    lotAllotmentMode: config.lotAllotmentMode,
  });

  // The generative engine owns topology selection and room placement when a
  // concept was chosen. Without one, fall back to the historical partition so
  // a brief the previous engine could build does not start failing.
  const structure = topology
    ? assembleStructureFromPartition({
      partition: topology.chosen.partition,
      program: topology.result.program,
      manifest,
      unitTypes: (config.units ?? []).map(u => u.bhkType),
      archetype: topology.result.archetype ?? (config.preferredArchetype as RoomSlicingArchetypeId | undefined),
      staggeredBalconies: config.staggeredBalconies,
      floorVariant: options?.floorVariant,
    }).structure
    : solveOrthogonalSpaceFillingApartment({
      aiPrompt: config.aiPrompt,
      plan: { flats: [], rooms: [] } as never,
      site: {
        plotWidth: config.plotWidthMm,
        plotDepth: config.plotDepthMm,
        lotAllotmentMode: config.lotAllotmentMode,
        setbacks: {
          front: config.plotDepthMm - (envelope.y + envelope.h),
          rear: envelope.y,
          left: envelope.x,
          right: config.plotWidthMm - (envelope.x + envelope.w),
        },
      },
      frame: { width: 1000, height: 1000 },
      manifest,
      lotAllotmentMode: config.lotAllotmentMode,
    });

  const includeDiningHall = config.includeDiningHall ?? true;
  const diningToLivingRedirect = new Map<string, string>();
  const rooms: Room[] = [];
  const addRoom = (
    r: { id: string; name: string; architecturalRole?: Room['architecturalRole']; type?: string; rect: { x: number; y: number; width: number; height: number }; polygonPoints?: readonly Point[]; planningZone?: 'PUBLIC' | 'PRIVATE' | 'SERVICE' | 'OUTDOOR'; bathroomOwnerRoomId?: string; tags?: readonly string[] },
    defaultType: RoomType,
    unitId?: string,
  ) => {
    const rType = (r.type === 'common_toilet' ? RoomType.Bathroom : r.type ?? defaultType) as RoomType;
    rooms.push(
      createBoxRoom({
        id: `apt-room:${r.id}`,
        architecturalRole: r.architecturalRole,
        name: r.name,
        type: rType,
        spaceUse: rType === RoomType.Balcony ? 'OUTDOOR' : unitId ? 'UNIT' : rType === RoomType.ServiceShaft ? 'SERVICE' : (rType === RoomType.Lift || rType === RoomType.Staircase) ? 'CORE' : 'COMMON',
        planningZone: r.planningZone,
        box: { x: r.rect.x, y: r.rect.y, w: r.rect.width, h: r.rect.height },
        ...(r.polygonPoints ? { polygonPoints: r.polygonPoints } : {}),
        floorId,
        unitId,
        tags: [`apt-room:${r.id}`, ...(r.tags ?? [])],
      }),
    );
  };

  for (let fIdx = 0; fIdx < structure.flats.length; fIdx++) {
    const flat = structure.flats[fIdx]!;
    const flatNum = floorLevel * 100 + (fIdx + 1);
    const flatRenamed = flat.rooms.map(r => ({
      ...r,
      name: r.name.replace(/Flat\s*0?(\d+)/i, `Flat ${flatNum}`),
    }));

    let diningSkippedId: string | null = null;
    if (!includeDiningHall) {
      const diningR = flatRenamed.find(r => r.type === 'dining');
      const livingR = flatRenamed.find(r => r.type === 'living');
      if (diningR && livingR) {
        const lPts = unionOrthogonalBoxes(
          { x: livingR.rect.x, y: livingR.rect.y, w: livingR.rect.width, h: livingR.rect.height },
          { x: diningR.rect.x, y: diningR.rect.y, w: diningR.rect.width, h: diningR.rect.height },
        );
        if (lPts) {
          diningSkippedId = diningR.id;
          diningToLivingRedirect.set(diningR.id, livingR.id);
          addRoom({ ...livingR, polygonPoints: lPts }, RoomType.Living, flat.id);
        }
      }
    }

    for (const r of flatRenamed) {
      if (diningSkippedId && (r.id === diningSkippedId || r.id === diningToLivingRedirect.get(diningSkippedId))) {
        continue;
      }
      addRoom(r, RoomType.Custom, flat.id);
    }
  }
  for (const el of structure.lifts) addRoom(el, RoomType.Lift);
  for (const el of structure.stairs) addRoom(el, RoomType.Staircase);
  for (const el of structure.lobbies) addRoom({ ...el, tags: [...(el.tags ?? []), 'core:lobby'] }, RoomType.Corridor);
  for (const el of structure.corridors) addRoom({ ...el, tags: [...(el.tags ?? []), 'core:corridor'] }, RoomType.Corridor);
  for (const el of structure.shafts) addRoom(el, RoomType.ServiceShaft);

  const boundary = rectPolygon(envelope.x, envelope.y, envelope.w, envelope.h);
  const walls = generateApartmentWalls(rooms, floorId, boundary, true, config.architectureOptions?.guardHeightMm);
  const doors: Door[] = [];
  const windows: Window[] = [];

  for (const op of structure.openings) {
    const redirectedConnects = op.connects?.map(id => diningToLivingRedirect.get(id) ?? id);
    const hostWall = walls.find(w =>
      (!redirectedConnects || redirectedConnects.every(id => w.roomIds.includes(`apt-room:${id}`))) && openingFitsApartmentWall(
        w,
        { x: op.rect.x + op.rect.width / 2, y: op.rect.y + op.rect.height / 2 },
        Math.max(op.rect.width, op.rect.height),
      ),
    );
    if (hostWall) {
      doors.push({
        id: op.id,
        floorId,
        wallId: hostWall.id,
        position: { x: op.rect.x + op.rect.width / 2, y: op.rect.y + op.rect.height / 2 },
        width: Math.max(op.rect.width, op.rect.height),
        height: 2100,
        type: op.doorType === 'sliding' ? DoorType.Sliding : op.doorType === 'open_passage' ? DoorType.OpenPassage : DoorType.Single,
        swingDirection: SwingDirection.Inward,
        connectsRooms: [op.connects?.[0] ? `apt-room:${op.connects[0]}` : '', op.connects?.[1] ? `apt-room:${op.connects[1]}` : ''] as never,
      });
      (hostWall as { hasOpening: boolean }).hasOpening = true;
    }
  }

  // Windows along exterior envelope walls, outdoor balconies, and OTS shafts
  for (const r of rooms) {
    if (r.spaceUse === 'OUTDOOR' || r.type === RoomType.ServiceShaft) continue;
    const isBath = r.type === RoomType.Bathroom;
    const hasOtsShaftWall = (w: Wall) =>
      w.wallUse === 'SHAFT' &&
      w.roomIds.some(id => {
        const owner = rooms.find(room => room.id === id);
        return owner?.architecturalRole === 'OPEN_TO_SKY_VOID';
      });
    const hasOutdoorBalconyWall = (w: Wall) =>
      w.wallUse !== 'UNIT_SEPARATION' &&
      w.roomIds.some(id => {
        if (id === r.id) return false;
        const owner = rooms.find(room => room.id === id);
        if (!owner) return false;
        if (r.unitId && owner.unitId && owner.unitId !== r.unitId) return false;
        return (w.wallUse === 'BALCONY' && owner.spaceUse === 'OUTDOOR') ||
          (w.wallUse === 'INTERNAL_PARTITION' && r.type === RoomType.Kitchen && owner.type === RoomType.Utility);
      });
    const extWalls = walls.filter(w =>
      (w.wallUse === 'EXTERNAL' || (isBath && w.wallUse === 'SHAFT') || hasOtsShaftWall(w) || (!isBath && r.spaceUse === 'UNIT' && hasOutdoorBalconyWall(w))) &&
      w.boundaryRole !== 'OPEN_BOUNDARY' &&
      w.boundaryRole !== 'PARAPET' &&
      w.roomIds.includes(r.id),
    );
    const targetWindowArea = Math.max(1_250_000, polygonArea(r.boundary) * 0.12);
    const windowHeight = r.type === RoomType.Dining ? 1350 : 1500;
    const availableWindowArea = () => windows.reduce(
      (area, window) => window.roomId === r.id ? area + window.width * window.height : area, 0,
    );
    for (const hw of extWalls) {
      const remainingWindowArea = targetWindowArea - availableWindowArea();
      if (!isBath && remainingWindowArea <= 0) break;
      // Check if wall segment already has a door opening (e.g. balcony door)
      const doorIdx = doors.findIndex(d => d.wallId === hw.id);
      const len = Math.hypot(hw.endPoint.x - hw.startPoint.x, hw.endPoint.y - hw.startPoint.y);
      if (doorIdx >= 0) {
        const doorOnWall = doors[doorIdx]!;
        const alreadyHasWindow = windows.some(win => win.roomId === r.id);
        const effectiveDoorW =
          doorOnWall.width > 900 && len - doorOnWall.width < 680
            ? Math.max(900, Math.floor((len - 680) / 20) * 20)
            : doorOnWall.width;
        if (!alreadyHasWindow && !isBath && len >= effectiveDoorW + 680) {
          const ux = (hw.endPoint.x - hw.startPoint.x) / len;
          const uy = (hw.endPoint.y - hw.startPoint.y) / len;
          const sideWinW = Math.min(900, Math.max(400, Math.floor((len - effectiveDoorW - 280) / 20) * 20));
          // Respect 100 mm opening corner clearance so downstream repair retains both door and side window
          const shiftedDoorAlong = Math.ceil((100 + effectiveDoorW / 2) / 10) * 10;
          const winAlong = Math.floor((len - 100 - sideWinW / 2) / 10) * 10;
          const doorPos = {
            x: hw.startPoint.x + ux * shiftedDoorAlong,
            y: hw.startPoint.y + uy * shiftedDoorAlong,
          };
          const winPos = {
            x: hw.startPoint.x + ux * winAlong,
            y: hw.startPoint.y + uy * winAlong,
          };
          if (
            winAlong - sideWinW / 2 >= shiftedDoorAlong + effectiveDoorW / 2 + 80 &&
            openingFitsApartmentWall(hw, doorPos, effectiveDoorW) &&
            openingFitsApartmentWall(hw, winPos, sideWinW)
          ) {
            doors[doorIdx] = {
              ...doorOnWall,
              width: effectiveDoorW,
              type: effectiveDoorW < 1050 && doorOnWall.type === DoorType.Sliding ? DoorType.Single : doorOnWall.type,
              position: doorPos,
            };
            windows.push({
              id: `win_${r.id}_${hw.id}_side`,
              floorId,
              wallId: hw.id,
              position: winPos,
              width: sideWinW,
              height: windowHeight,
              sillHeight: 900,
              type: WindowType.Sliding,
              roomId: r.id,
            });
            (hw as { hasOpening: boolean }).hasOpening = true;
          }
        }
        continue;
      }
      if (len < 650) continue;
      const winW = isBath
        ? (len >= 800 ? 600 : Math.max(350, Math.round(len - 200)))
        : Math.min(Math.floor(len - 200), Math.max(450, Math.ceil(remainingWindowArea / windowHeight / 10) * 10));
      if (!isBath && winW < 450) continue;
      const winH = isBath ? 650 : windowHeight;
      const sillH = isBath ? 1500 : 900;
      const winPos = {
        x: (hw.startPoint.x + hw.endPoint.x) / 2,
        y: (hw.startPoint.y + hw.endPoint.y) / 2,
      };
      if (winW > 0 && openingFitsApartmentWall(hw, winPos, winW)) {
        windows.push({
          id: `win_${r.id}_${hw.id}`,
          floorId,
          wallId: hw.id,
          position: winPos,
          width: winW,
          height: winH,
          sillHeight: sillH,
          type: isBath ? WindowType.Ventilator : WindowType.Sliding,
          roomId: r.id,
        });
        (hw as { hasOpening: boolean }).hasOpening = true;
        if (isBath) break;
      }
    }
  }

  const floor: Floor = {
    id: floorId,
    buildingId: 'apartment_building',
    level: floorLevel,
    name: floorName,
    floorHeight: config.floorToFloorHeightMm ?? 3000,
    boundary,
    rooms,
    walls,
    doors,
    windows,
    stairs: [],
    columns: deriveCleanStructuralColumns(
      {
        id: floorId,
        buildingId: 'apartment_building',
        level: floorLevel,
        name: floorName,
        floorHeight: config.floorToFloorHeightMm ?? 3000,
        boundary,
        rooms,
        walls,
        doors,
        windows,
        stairs: [],
        columns: [],
      },
      envelope,
    ),
    apartmentUnits: structure.flats.map((f, idx) => ({
      id: f.id,
      boundary: rectPolygon(f.rect.x, f.rect.y, f.rect.width, f.rect.height),
      unitType: f.unitType,
      unitIndex: idx + 1,
    })),
  };

  const flOrdinal = floorLevel === 1 ? '1st' : floorLevel === 2 ? '2nd' : floorLevel === 3 ? '3rd' : `${floorLevel}th`;
  const repairManifest = topology
    ? createDynamicApartmentManifest({
      plotWidthMm: config.plotWidthMm,
      plotDepthMm: config.plotDepthMm,
      flatsPerFloor: config.flatsPerFloor,
      units: structure.flats.map((f, idx) => ({
        ...(config.units?.[idx] ?? { hasUtilityBalcony: true }),
        unitIndex: idx + 1,
        bhkType: f.unitType as ApartmentBhkType,
      })),
      jurisdiction: config.jurisdiction,
      lotAllotmentMode: config.lotAllotmentMode,
    })
    : manifest;
  const baseRepairedFloor = repairApartmentPlan({ id: 'typical', projectId: 'typical', name: floorName, site: { plotWidth: config.plotWidthMm, plotDepth: config.plotDepthMm } as Site, floors: [floor], metadata: { projectId: 'typical' }, version: 1, createdAt: '', updatedAt: '' }, repairManifest).building.floors[0]!;
  const orthogonalHealedFloor = healFloorGeometryForCompliance(baseRepairedFloor).floor;
  const activeShapeId = config.buildingMassingShape;
  const morphed = activeShapeId
    ? applyParametricShapeToFloor({
      floor: orthogonalHealedFloor,
      shapeId: activeShapeId,
      envelope,
      shapeParams: config.shapeParams,
      planCategory: config.planCategory,
    })
    : { floor: orthogonalHealedFloor, appliedShapeId: undefined };
  const repairedFloor = morphed.floor;
  const ledger = measureApartmentAreaLedger(repairedFloor);
  const audit: SheetLedgerAudit = {
    sheetId: floorLevel === 1 ? 'sheet_03_typical_plan' : `sheet_03_level_${floorLevel}_plan`,
    sheetName: `Sheet 03: ${flOrdinal} Residential Floor Plan`,
    grossAreaMm2: ledger.gross,
    accountedAreaMm2: ledger.accounted,
    deltaMm2: ledger.delta,
    unassignedMm2: ledger.unassigned,
    isPlanarConserved: Math.abs(ledger.delta) < 0.001 && ledger.unassigned === 0,
  };

  const shapeId = morphed.floor !== orthogonalHealedFloor
    ? morphed.appliedShapeId
    : topology?.chosen.partition.massingShape ?? 'COMPACT_DOUBLE_LOADED';
  return { floor: repairedFloor, structure, audit, shapeId };
}

// ─── Sheet 4 Solver: COLUMN_SCHEDULE_PLAN (Structural Grid & Schedule) ───────

export interface StructuralColumnScheduleResult {
  readonly floor: Floor;
  readonly columns: readonly Column[];
  readonly scheduleRows: ReadonlyArray<{
    columnNo: string;
    gridRef: string;
    sizeMm: string;
    orientation: string;
    loadLevel: string;
  }>;
  readonly audit: SheetLedgerAudit;
}

export function solveStructuralColumnScheduleSheet(
  typicalResult: TypicalFloorSheetResult,
  _envelope: Box2D,
): StructuralColumnScheduleResult {
  const columns = typicalResult.floor.columns;
  const scheduleRows = columns.map(c => ({
    columnNo: c.gridReference || c.id,
    gridRef: `Grid (${(c.position.x / 1000).toFixed(1)}m, ${(c.position.y / 1000).toFixed(1)}m)`,
    sizeMm: `${c.width} x ${c.depth} mm`,
    orientation: 'Vertical RCC Column',
    loadLevel: 'Ground / Stilt to Terrace Slab (All Levels)',
  }));

  const floor: Floor = {
    ...typicalResult.floor,
    id: 'floor_col_schedule_04',
    name: 'STRUCTURAL_COLUMN_SCHEDULE_PLAN',
    level: 1,
    rooms: [], // Pure structural sheet: no room fills cluttering the structural grid
    doors: [],
    windows: [],
    columns: [...columns],
  };

  const audit: SheetLedgerAudit = {
    sheetId: 'sheet_04_column_schedule',
    sheetName: 'Sheet 04: Structural Column Layout & Schedule Plan',
    grossAreaMm2: typicalResult.audit.grossAreaMm2,
    accountedAreaMm2: typicalResult.audit.accountedAreaMm2,
    deltaMm2: typicalResult.audit.deltaMm2,
    unassignedMm2: 0,
    isPlanarConserved: typicalResult.audit.isPlanarConserved,
  };

  return { floor, columns, scheduleRows, audit };
}

// ─── Sheet 4 Solver: REFUGE_FLOOR_PLAN (Delta = 0.000 mm²) ───────────────────

export interface RefugeFloorSheetResult {
  readonly floor: Floor;
  readonly refugeAreaM2: number;
  readonly audit: SheetLedgerAudit;
}

export function solveRefugeFloorSheet(
  typicalResult: TypicalFloorSheetResult,
  refugeLevel: number,
): RefugeFloorSheetResult {
  const floorId = `floor_refuge_${String(refugeLevel).padStart(2, '0')}`;
  const baseFloor = typicalResult.floor;
  const origBalcony = baseFloor.rooms.find(r => r.id === 'apt-room:flat_01__balcony' || r.id === 'flat_01__balcony' || (r.unitId === 'flat_01' && r.name.toLowerCase().includes('sit-out')));
  const origDining = baseFloor.rooms.find(r => r.unitId === 'flat_01' && (r.id.includes('dining') || r.type === RoomType.Dining));
  const origLiving = baseFloor.rooms.find(r => r.unitId === 'flat_01' && r.type === RoomType.Living);

  const targetBalcony = origBalcony ?? baseFloor.rooms.find(r => r.unitId === 'flat_01' && r.type === RoomType.Balcony);

  // On the refuge floor, Flat 01 sit-out balcony and dining merge into Statutory Fire Refuge Terrace (>= 15 m2)
  // Ensure exact planar bounding box union whether adjacent along X or Y
  const adjacentX = Boolean(targetBalcony && origDining &&
    Math.abs(targetBalcony.y - origDining.y) <= 1 &&
    Math.abs(targetBalcony.height - origDining.height) <= 1 &&
    (Math.abs(targetBalcony.x + targetBalcony.width - origDining.x) <= 1 ||
      Math.abs(origDining.x + origDining.width - targetBalcony.x) <= 1));

  const adjacentY = Boolean(targetBalcony && origDining &&
    Math.abs(targetBalcony.x - origDining.x) <= 1 &&
    Math.abs(targetBalcony.width - origDining.width) <= 1 &&
    (Math.abs(targetBalcony.y + targetBalcony.height - origDining.y) <= 1 ||
      Math.abs(origDining.y + origDining.height - targetBalcony.y) <= 1));

  const shouldMergeDining = adjacentX || adjacentY;
  const refBox = adjacentX ? {
    x: Math.min(targetBalcony!.x, origDining!.x),
    y: targetBalcony!.y,
    w: targetBalcony!.width + origDining!.width,
    h: targetBalcony!.height,
  } : adjacentY ? {
    x: targetBalcony!.x,
    y: Math.min(targetBalcony!.y, origDining!.y),
    w: targetBalcony!.width,
    h: targetBalcony!.height + origDining!.height,
  } : targetBalcony ? {
    x: targetBalcony.x,
    y: targetBalcony.y,
    w: targetBalcony.width,
    h: targetBalcony.height,
  } : null;

  // Clone rooms and convert exterior balcony of Flat 01 into Statutory Fire Refuge Terrace (>= 15 m²)
  const rooms: Room[] = [];
  for (const r of baseFloor.rooms) {
    if (targetBalcony && r.id === targetBalcony.id && refBox) {
      rooms.push(createBoxRoom({
        id: `refuge_terrace_${refugeLevel}`,
        name: 'Statutory Fire Refuge Terrace (>= 15 m²)',
        type: RoomType.Balcony,
        spaceUse: 'OUTDOOR',
        planningZone: 'OUTDOOR',
        box: refBox,
        floorId,
        unitId: 'flat_01',
        tags: ['refuge:terrace', 'fire_safety'],
      }));
      continue;
    }
    if (shouldMergeDining && origDining && r.id === origDining.id) {
      // Merged into refuge terrace
      continue;
    }
    rooms.push({ ...r, floorId });
  }

  const walls = generateApartmentWalls(rooms, floorId, baseFloor.boundary);
  const doors = baseFloor.doors.map(d => ({ ...d, floorId }));

  // Add 1050 mm Fire Exit Door connecting Flat 01 Living Room to Fire Refuge Terrace
  const refugeRoom = rooms.find(r => r.tags.includes('refuge:terrace'));
  const connectingRoom = rooms.find(r => r.id === origLiving?.id);
  if (refugeRoom && connectingRoom) {
    const dRefuge = createConnectingDoor(`door_refuge_${refugeLevel}`, roomToBox(connectingRoom), roomToBox(refugeRoom), 1050, { isFlatEntrance: true });
    if (dRefuge) {
      const hostWall = walls.find(w => w.roomIds.includes(connectingRoom.id) && w.roomIds.includes(refugeRoom.id))
        ?? walls.find(w => openingFitsApartmentWall(w, { x: snap10(dRefuge.rect.x + dRefuge.rect.width / 2), y: snap10(dRefuge.rect.y + dRefuge.rect.height / 2) }, 1050));
      if (hostWall) {
        doors.push({
          id: dRefuge.id,
          floorId,
          wallId: hostWall.id,
          position: { x: snap10(dRefuge.rect.x + dRefuge.rect.width / 2), y: snap10(dRefuge.rect.y + dRefuge.rect.height / 2) },
          width: 1050,
          height: 2100,
          type: DoorType.Single,
          swingDirection: SwingDirection.Inward,
          connectsRooms: [connectingRoom.id, refugeRoom.id],
        });
        (hostWall as { hasOpening: boolean }).hasOpening = true;
      }
    }
  }

  const floor: Floor = {
    ...baseFloor,
    id: floorId,
    level: refugeLevel,
    name: 'REFUGE_FLOOR_PLAN',
    rooms,
    walls,
    doors,
    windows: baseFloor.windows.map(w => ({ ...w, floorId })),
  };

  const ledger = measureApartmentAreaLedger(floor);
  const refugeAreaM2 = (refugeRoom?.area ?? 0) / 1e6;

  const audit: SheetLedgerAudit = {
    sheetId: 'sheet_04_refuge_plan',
    sheetName: `Sheet 04: Fire Refuge Floor Plan (Level ${refugeLevel})`,
    grossAreaMm2: ledger.gross,
    accountedAreaMm2: ledger.accounted,
    deltaMm2: ledger.delta,
    unassignedMm2: ledger.unassigned,
    isPlanarConserved: Math.abs(ledger.delta) < 0.001 && ledger.unassigned === 0,
  };

  return { floor, refugeAreaM2, audit };
}

// ─── Sheet 5 Solver: TERRACE_PLAN (Delta = 0.000 mm²) ────────────────────────

export interface TerraceSheetResult {
  readonly floor: Floor;
  readonly audit: SheetLedgerAudit;
}

export function solveTerraceSheet(
  config: MultiSheetApartmentConfig,
  envelope: Box2D,
  macro: MacroPartition,
  terraceLevel: number,
): TerraceSheetResult {
  const floorId = `floor_terrace_${String(terraceLevel).padStart(2, '0')}`;
  const rooms: Room[] = [];
  const doors: Door[] = [];

  // 1. Locked Vertical Core Headroom Extrusions
  // Mumty Headroom over Staircase 1 & Staircase 2
  const mumty1 = createBoxRoom({
    id: 'terrace__stair_mumty_1',
    name: 'Staircase 01 Mumty & Headroom',
    architecturalRole: 'STAIR_MUMTY',
    type: RoomType.Staircase,
    spaceUse: 'CORE',
    box: macro.stairBoxes[0]!,
    floorId,
    tags: ['terrace:core'],
  });
  rooms.push(mumty1);

  // A mumty over EVERY stair, not only the first two: a split-core
  // organization has more, and a stair without roof headroom would terminate
  // into slab.
  for (let i = 1; i < macro.stairBoxes.length; i++) {
    rooms.push(createBoxRoom({
      id: `terrace__stair_mumty_${i + 1}`,
      name: i === 1 ? 'Staircase 02 Mumty & Fire Escape Headroom' : `Staircase 0${i + 1} Mumty & Headroom`,
      architecturalRole: 'STAIR_MUMTY',
      type: RoomType.Staircase,
      spaceUse: 'CORE',
      box: macro.stairBoxes[i]!,
      floorId,
      tags: ['terrace:core'],
    }));
  }

  // Lift Machine Room (LMR) over Lifts
  const lmr1 = createBoxRoom({
    id: 'terrace__lift_machine_room_1',
    name: config.architectureOptions?.liftSystem === 'MACHINE_ROOM_REQUIRED' ? 'Lift equipment room 01' : 'Lift headroom reservation 01',
    architecturalRole: config.architectureOptions?.liftSystem === 'MACHINE_ROOM_REQUIRED' ? 'LIFT_EQUIPMENT' : 'ROOF_EQUIPMENT_ZONE',
    type: RoomType.Custom,
    spaceUse: 'CORE',
    box: macro.liftBoxes[0]!,
    floorId,
    tags: ['terrace:core'],
  });
  rooms.push(lmr1);

  for (let i = 1; i < macro.liftBoxes.length; i++) {
    const machineRoom = config.architectureOptions?.liftSystem === 'MACHINE_ROOM_REQUIRED';
    rooms.push(createBoxRoom({
      id: `terrace__lift_machine_room_${i + 1}`,
      name: machineRoom ? `Lift equipment room 0${i + 1}` : `Lift headroom reservation 0${i + 1}`,
      architecturalRole: machineRoom ? 'LIFT_EQUIPMENT' : 'ROOF_EQUIPMENT_ZONE',
      type: RoomType.Custom,
      spaceUse: 'CORE',
      box: macro.liftBoxes[i]!,
      floorId,
      tags: ['terrace:core'],
    }));
  }

  // Overhead Water Tank (OHWT) over the primary lobby; any further lobby of the
  // chosen organization becomes roof plant area, so the terrace tiles exactly.
  // The overhead water tank sits over a real lift lobby where the organization
  // has one; any further lobby becomes roof plant area. Where the lifts open
  // straight onto the corridor there is no lobby rectangle to build on, and
  // the tank goes over the first circulation run instead.
  const terraceLobbyBoxes = macroLobbyBoxes(macro);
  const terraceCorridorBoxes = macroCorridorBoxes(macro);
  const tankBox = terraceLobbyBoxes[0] ?? terraceCorridorBoxes[0]!;
  const tankTookCorridor = !terraceLobbyBoxes.length;

  rooms.push(createBoxRoom({
    id: 'terrace__ohwt_tank',
    architecturalRole: 'ROOF_EQUIPMENT_ZONE',
    name: 'Overhead Water Tank (OHWT — Domestic & Fire Reserve)',
    type: RoomType.Custom,
    spaceUse: 'SERVICE',
    box: tankBox,
    floorId,
    tags: ['terrace:core'],
  }));

  for (let i = 1; i < terraceLobbyBoxes.length; i++) {
    rooms.push(createBoxRoom({
      id: `terrace__roof_plant_${i + 1}`,
      architecturalRole: 'ROOF_EQUIPMENT_ZONE',
      name: `Roof Services Plant Zone 0${i + 1}`,
      type: RoomType.Custom,
      spaceUse: 'SERVICE',
      box: terraceLobbyBoxes[i]!,
      floorId,
      tags: ['terrace:core'],
    }));
  }

  // Terrace access vestibule over each remaining circulation run above, so the
  // roof tiles the same envelope exactly without doubling up on the tank.
  for (let i = tankTookCorridor ? 1 : 0; i < terraceCorridorBoxes.length; i++) {
    rooms.push(createBoxRoom({
      id: i === 0 ? 'terrace__corridor_vestibule' : `terrace__corridor_vestibule_${i + 1}`,
      name: terraceCorridorBoxes.length > 1 ? `Terrace Access Vestibule 0${i + 1}` : 'Terrace Access Vestibule',
      type: RoomType.Corridor,
      spaceUse: 'COMMON',
      box: terraceCorridorBoxes[i]!,
      floorId,
      tags: ['terrace:core'],
    }));
  }

  // Covered Weatherproof MEP Skylights over shafts
  for (let s = 0; s < macro.shaftBoxes.length; s++) {
    rooms.push(
      createBoxRoom({
        id: `terrace__shaft_head_${s + 1}`,
        architecturalRole: macro.shaftRoles?.[s] === 'OPEN_TO_SKY_VOID' ? 'OPEN_TO_SKY_VOID' : 'SERVICE_SHAFT',
        name: macro.shaftRoles?.[s] === 'OPEN_TO_SKY_VOID' ? 'Open-to-sky courtyard (no roof)' : `Service duct vent head 0${s + 1}`,
        type: RoomType.ServiceShaft,
        spaceUse: 'SERVICE',
        box: macro.shaftBoxes[s]!,
        floorId,
        tags: ['terrace:core', ...(macro.shaftTags?.[s] ?? [])],
      }),
    );
  }

  // 2. West Rooftop: Solar PV Array Zone
  const westBox = macro.flatBoxes[0]!;
  rooms.push(
    createBoxRoom({
      id: 'terrace__solar_pv_array',
      name: 'Rooftop Solar PV Array & Inverter Deck',
      type: RoomType.Terrace,
      spaceUse: 'OUTDOOR',
      box: westBox,
      floorId,
      tags: ['terrace:solar'],
    }),
  );

  // 3. East Rooftop: Terrace Yoga Sitout Deck & Open Waterproofed Terrace
  for (let fb = 1; fb < macro.flatBoxes.length; fb++) {
    const eastBox = macro.flatBoxes[fb]!;
    const yogaH = snap10(eastBox.h * 0.45);
    const openH = eastBox.h - yogaH;

    rooms.push(
      createBoxRoom({
        id: `terrace__yoga_deck_${fb}`,
        name: 'Terrace Gazebo, Yoga & Landscaped Sitout Deck',
        type: RoomType.Terrace,
        spaceUse: 'OUTDOOR',
        box: { x: eastBox.x, y: eastBox.y, w: eastBox.w, h: yogaH },
        floorId,
        tags: ['terrace:amenity'],
      }),
    );

    rooms.push(
      createBoxRoom({
        id: `terrace__open_waterproof_${fb}`,
        name: 'Open Waterproofed Rooftop Terrace',
        type: RoomType.Terrace,
        spaceUse: 'OUTDOOR',
        box: { x: eastBox.x, y: eastBox.y + yogaH, w: eastBox.w, h: openH },
        floorId,
        tags: ['terrace:open'],
      }),
    );
  }

  // 4. Parapet Walls & Perimeter
  const terraceBoundary = rectPolygon(envelope.x, envelope.y, envelope.w, envelope.h);
  const walls = generateApartmentWalls(rooms, floorId, terraceBoundary, true, config.architectureOptions?.guardHeightMm);

  // Explicit roof access: host every mumty exit on its real shared boundary.
  for (const mumty of rooms.filter(r => r.architecturalRole === 'STAIR_MUMTY')) {
    const hosts = walls.filter(w => w.roomIds.includes(mumty.id) && w.roomIds.some(id => rooms.some(r => r.id === id && ['OPEN_CIRCULATION', 'OPEN_TERRACE', 'ROOF_EQUIPMENT_ZONE'].includes(r.architecturalRole ?? ''))));
    const host = hosts.find(w => openingFitsApartmentWall(w, { x: (w.startPoint.x + w.endPoint.x) / 2, y: (w.startPoint.y + w.endPoint.y) / 2 }, 1050));
    if (!host) throw new Error(`ROOF_STAIR_ACCESS_UNAVAILABLE: ${mumty.id}`);
    const other = host.roomIds.find(id => id !== mumty.id)!;
    doors.push({
      id: `${mumty.id}:roof-access`, floorId, wallId: host.id,
      position: { x: (host.startPoint.x + host.endPoint.x) / 2, y: (host.startPoint.y + host.endPoint.y) / 2 },
      width: 1050, height: 2100, type: DoorType.Single, swingDirection: SwingDirection.Outward, connectsRooms: [mumty.id, other]
    });
  }

  const floor: Floor = {
    id: floorId,
    buildingId: 'apartment_building',
    level: terraceLevel,
    name: 'TERRACE_PLAN',
    floorHeight: 3000,
    boundary: terraceBoundary,
    rooms,
    walls,
    doors,
    windows: [],
    stairs: [],
    columns: [],
  };

  const ledger = measureApartmentAreaLedger(floor);
  const audit: SheetLedgerAudit = {
    sheetId: 'sheet_05_terrace_plan',
    sheetName: 'Sheet 05: Rooftop Services & Terrace Plan',
    grossAreaMm2: ledger.gross,
    accountedAreaMm2: ledger.accounted,
    deltaMm2: ledger.delta,
    unassignedMm2: ledger.unassigned,
    isPlanarConserved: Math.abs(ledger.delta) < 0.001 && ledger.unassigned === 0,
  };

  return { floor, audit };
}

// ─── Sheet 6 Solver: AREA_SCHEDULE_SHEET (UDCPR / NBC Statements) ─────────────

export function generateApartmentProjectSchedule(params: {
  config: MultiSheetApartmentConfig;
  siteSheet: SitePlanSheetResult;
  stiltSheet: StiltParkingSheetResult;
  typicalSheet: TypicalFloorSheetResult;
  refugeSheet?: RefugeFloorSheetResult;
  terraceSheet: TerraceSheetResult;
  stackParams: BuildingStackParameters;
}): ApartmentProjectSchedule {
  const { config, siteSheet, stiltSheet, typicalSheet, refugeSheet, terraceSheet } = params;

  const plotAreaM2 = (config.plotWidthMm * config.plotDepthMm) / 1e6;
  const plotAreaSqFt = plotAreaM2 * 10.7639;

  const typicalFloor = typicalSheet.floor;
  const groundCoverageM2 = polygonArea(typicalFloor.boundary) / 1e6;
  const groundCoveragePercent = (groundCoverageM2 / plotAreaM2) * 100;
  const setbackAreaM2 = Math.max(0, plotAreaM2 - groundCoverageM2);

  // ROS Landscape Garden area
  const rosZones = siteSheet.siteZones.filter(z => z.kind === 'garden');
  const rosLandscapeAreaM2 = rosZones.reduce((sum, z) => sum + z.area, 0) / 1e6;
  const rosLandscapePercent = (rosLandscapeAreaM2 / plotAreaM2) * 100;

  // Permissible FSI under UDCPR 2020 / Pune PMC rules based on road width
  const roadW = config.roadWidthMm;
  const permissibleFsi =
    roadW >= 24000 ? 3.0 :
      roadW >= 18000 ? 2.5 :
        roadW >= 12000 ? 2.0 :
          roadW >= 9000 ? 1.5 : 1.2;

  const floorBuiltUpM2 = groundCoverageM2;
  const totalBuiltUpAreaM2 = floorBuiltUpM2 * config.numTypicalFloors;
  const consumedFsi = totalBuiltUpAreaM2 / plotAreaM2;

  // Measure typical floor usable carpet per flat
  const typicalLedger = measureApartmentAreaLedger(typicalFloor);
  const flatSchedule: FlatScheduleItem[] = [];
  let totalTypicalCarpetM2 = 0;

  for (const flat of typicalSheet.structure.flats) {
    const flatRooms = typicalFloor.rooms.filter(r => r.unitId === flat.id);
    const carpetMm2 = flatRooms
      .filter(r => r.spaceUse === 'UNIT' && r.type !== RoomType.Balcony)
      .reduce((sum, r) => sum + (typicalLedger.roomUsable[r.id] ?? r.area), 0);
    const balconyMm2 = flatRooms
      .filter(r => r.spaceUse === 'OUTDOOR' || r.type === RoomType.Balcony)
      .reduce((sum, r) => sum + (typicalLedger.roomUsable[r.id] ?? r.area), 0);

    const carpetM2 = carpetMm2 / 1e6;
    const balconyM2 = balconyMm2 / 1e6;
    const totalUnitBuiltUpM2 = carpetM2 + balconyM2 + (carpetM2 + balconyM2) * 0.15; // +15% wall & pro-rata core

    totalTypicalCarpetM2 += carpetM2;

    flatSchedule.push({
      flatId: flat.id,
      flatNumber: flat.label,
      bhkType: flat.unitType as ApartmentBhkType,
      reraCarpetAreaM2: Math.round(carpetM2 * 100) / 100,
      reraCarpetAreaSqFt: Math.round(carpetM2 * 10.7639),
      balconyAreaM2: Math.round(balconyM2 * 100) / 100,
      balconyAreaSqFt: Math.round(balconyM2 * 10.7639),
      totalBuiltUpAreaM2: Math.round(totalUnitBuiltUpM2 * 100) / 100,
      totalBuiltUpAreaSqFt: Math.round(totalUnitBuiltUpM2 * 10.7639),
    });
  }

  const totalReraCarpetAreaM2 = totalTypicalCarpetM2 * config.numTypicalFloors;
  const floorPlateEfficiencyPercent = (totalTypicalCarpetM2 / floorBuiltUpM2) * 100;

  // Parking Ledger under UDCPR Table 13.1 / NBC 2016
  let reqCarStalls = 0;
  let req2WStalls = 0;
  for (const flat of typicalSheet.structure.flats) {
    if (flat.unitType === '2BHK') {
      reqCarStalls += 1;
      req2WStalls += 2;
    } else if (flat.unitType === '3BHK') {
      reqCarStalls += 1.5;
      req2WStalls += 2;
    } else if (flat.unitType === '4BHK') {
      reqCarStalls += 2;
      req2WStalls += 4;
    } else {
      reqCarStalls += 1;
      req2WStalls += 1;
    }
  }

  const visitorFactor = 1 + (config.visitorParkingPercent ?? 10) / 100;
  const totalReqCar = Math.ceil(reqCarStalls * config.numTypicalFloors * visitorFactor);
  const totalReq2W = Math.ceil(req2WStalls * config.numTypicalFloors * visitorFactor);

  const stackMult = config.parkingMode === 'MECHANICAL_STACK' ? 2 : 1;
  const stiltCar = stiltSheet.carBaysCount * stackMult;
  const surfaceCar = siteSheet.siteZones.filter(z => z.kind === 'parking' && z.name.includes('Car')).length;
  const providedCar = stiltCar + surfaceCar;

  const stilt2W = stiltSheet.bikeBaysCount;
  const surface2W = siteSheet.siteZones.filter(z => z.kind === 'parking' && z.name.includes('2-Wheeler')).length * 4;
  const provided2W = stilt2W + surface2W;

  const parking: ParkingSchedule = {
    requiredCarStalls: totalReqCar,
    providedCarStalls: providedCar,
    stiltCarStalls: stiltCar,
    surfaceCarStalls: surfaceCar,
    stackParkingMultiplier: stackMult,
    visitorCarStalls: Math.ceil(totalReqCar * 0.10),
    requiredTwoWheelerStalls: totalReq2W,
    providedTwoWheelerStalls: provided2W,
    visitorTwoWheelerStalls: Math.ceil(totalReq2W * 0.10),
  };

  const sheetAudits: SheetLedgerAudit[] = [
    siteSheet.audit,
    stiltSheet.audit,
    typicalSheet.audit,
    ...(refugeSheet ? [refugeSheet.audit] : []),
    terraceSheet.audit,
  ];

  const overallDeltaMm2 = sheetAudits.reduce((sum, a) => sum + Math.abs(a.deltaMm2), 0);

  let areaTargetDiagnostic: AreaTargetDiagnostic | undefined;
  const promptIntentForDiag = (() => {
    try {
      return interpretArchitecturalIntent({
        flatsPerFloor: config.flatsPerFloor,
        unitTypes: (config.units ?? []).map(u => u.bhkType),
        aiPrompt: config.aiPrompt,
      });
    } catch {
      return undefined;
    }
  })();
  const targetSqFt = config.targetAreaSqFt ?? promptIntentForDiag?.mandatory.targetAreaSqFt;
  if (targetSqFt !== undefined && targetSqFt > 0) {
    const scope: AreaTargetScope =
      config.areaTargetScope ?? promptIntentForDiag?.mandatory.areaTargetScope ?? 'PER_APARTMENT_CARPET';
    const requestedM2 = Math.round((targetSqFt / 10.7639) * 100) / 100;
    const achievedM2 =
      scope === 'GROSS_FLOOR_AREA'
        ? Math.round(groundCoverageM2 * 100) / 100
        : scope === 'FLOOR_TOTAL_CARPET'
          ? Math.round(totalTypicalCarpetM2 * 100) / 100
          : Math.round((totalTypicalCarpetM2 / Math.max(1, flatSchedule.length)) * 100) / 100;
    const achievedSqFt = Math.round(achievedM2 * 10.7639 * 10) / 10;
    const minHabitableGrossM2 = 310.08; // 20,400 x 15,200 mm minimum for 4 x 2BHK + 2 stairs + central lift
    const relErr = Math.abs(achievedM2 - requestedM2) / Math.max(1, requestedM2);
    let status: AreaTargetDiagnostic['status'];
    let explanation: string;
    if (scope === 'GROSS_FLOOR_AREA' && requestedM2 < minHabitableGrossM2) {
      status = 'INFEASIBLE_BELOW_MINIMUM_HABITABLE_FLOOR_PLATE';
      explanation =
        `Requested ${targetSqFt} sq. ft. (${requestedM2} m²) gross floor area is below the ${minHabitableGrossM2} m² ` +
        `(${Math.round(minHabitableGrossM2 * 10.7639)} sq. ft.) minimum habitable floor plate required for ${config.flatsPerFloor} ` +
        `units + 2 staircases + central lift under NBC 2016 / UDCPR minimums; clamped to minimum habitable floor plate.`;
    } else if (relErr <= 0.15) {
      status = 'ACHIEVED';
      explanation = `Achieved ${achievedSqFt} sq. ft. (${achievedM2} m²) for ${scope} against ${targetSqFt} sq. ft. (${requestedM2} m²) target.`;
    } else {
      status = 'CLAMPED_TO_ENVELOPE_MAX';
      explanation = `Target ${targetSqFt} sq. ft. (${requestedM2} m²) for ${scope} was bounded by the permissible plot envelope (${achievedSqFt} sq. ft. / ${achievedM2} m² achieved).`;
    }
    areaTargetDiagnostic = {
      scope,
      requestedAreaSqFt: targetSqFt,
      requestedAreaM2: requestedM2,
      achievedAreaSqFt: achievedSqFt,
      achievedAreaM2: achievedM2,
      minFeasibleGrossAreaM2: minHabitableGrossM2,
      minFeasibleGrossAreaSqFt: Math.round(minHabitableGrossM2 * 10.7639),
      requestedSqFt: targetSqFt,
      requestedM2,
      achievedSqFt,
      achievedM2,
      minimumFeasibleGrossM2: minHabitableGrossM2,
      status,
      explanation,
    };
  }

  return {
    plotAreaM2: Math.round(plotAreaM2 * 100) / 100,
    plotAreaSqFt: Math.round(plotAreaSqFt),
    setbackAreaM2: Math.round(setbackAreaM2 * 100) / 100,
    groundCoverageM2: Math.round(groundCoverageM2 * 100) / 100,
    groundCoveragePercent: Math.round(groundCoveragePercent * 10) / 10,
    rosLandscapeAreaM2: Math.round(rosLandscapeAreaM2 * 100) / 100,
    rosLandscapePercent: Math.round(rosLandscapePercent * 10) / 10,
    permissibleFsi,
    consumedFsi: Math.round(consumedFsi * 100) / 100,
    totalBuiltUpAreaM2: Math.round(totalBuiltUpAreaM2 * 100) / 100,
    totalReraCarpetAreaM2: Math.round(totalReraCarpetAreaM2 * 100) / 100,
    floorPlateEfficiencyPercent: Math.round(floorPlateEfficiencyPercent * 10) / 10,
    flatSchedule,
    parking,
    sheetAudits,
    overallDeltaMm2,
    ...(areaTargetDiagnostic ? { areaTargetDiagnostic } : {}),
  };
}

/** Derive a coordinated preliminary framing profile for a residential revision. */
export function synthesizeStructuralFraming(building: Building): Building {
  let placedStructure = building;
  // Phase 3 structural continuity: derive one deduplicated column grid from typical
  // residential walls, exclude stilt VEHICLE_AISLE drive lanes & bay entries as well as
  // cantilevered balcony corners, and project it identically down through Stilt + Typicals.
  const refRes = placedStructure.floors.find(f => f.floorUse === 'RESIDENTIAL');
  const stiltFl = placedStructure.floors.find(f => f.floorUse === 'STILT_PARKING');
  const aisleBoxes = (stiltFl?.rooms ?? [])
    .filter(r => r.architecturalRole === 'VEHICLE_AISLE')
    .map(r => r.boundary?.points?.length
      ? {
        x: Math.min(...r.boundary.points.map(p => p.x)),
        y: Math.min(...r.boundary.points.map(p => p.y)),
        w: Math.max(...r.boundary.points.map(p => p.x)) - Math.min(...r.boundary.points.map(p => p.x)),
        h: Math.max(...r.boundary.points.map(p => p.y)) - Math.min(...r.boundary.points.map(p => p.y)),
      }
      : { x: r.x, y: r.y, w: r.width, h: r.height });
  const blocksAisle = (pt: { x: number; y: number }) =>
    aisleBoxes.some(b => pt.x > b.x + 150 && pt.x < b.x + b.w - 150 && pt.y > b.y + 150 && pt.y < b.y + b.h - 150)
    || aisleBoxes.some(b =>
      ((Math.abs(pt.y - b.y) <= 150 || Math.abs(pt.y - (b.y + b.h)) <= 150) && pt.x > b.x + 150 && pt.x < b.x + b.w - 150)
      || ((Math.abs(pt.x - b.x) <= 150 || Math.abs(pt.x - (b.x + b.w)) <= 150) && pt.y > b.y + 150 && pt.y < b.y + b.h - 150));
  if (refRes) {
    const bounds = polygonBoundingBox(refRes.boundary);
    const refWallPolys = refRes.walls.map(wallToPolygon);
    const refOutdoorRooms = refRes.rooms.filter(r => ['balcony', 'utility'].includes(r.type));
    const continuous: Column[] = [];
    for (const col of deriveCleanStructuralColumns(refRes, { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height })) {
      if (blocksAisle(col.position)) continue;
      if (continuous.some(d => Math.hypot(d.position.x - col.position.x, d.position.y - col.position.y) < 500)) continue;
      let resolvedCol = col;
      const intrudes = (c: Column) =>
        refOutdoorRooms.some(r => uncoveredResidentialOverlap(columnFootprint(c), r.boundary, refWallPolys) >= 0.001);
      if (intrudes(resolvedCol)) {
        const flushCol: Column = { ...col, width: 200, depth: 200 };
        if (intrudes(flushCol)) continue;
        resolvedCol = flushCol;
      }
      const footingOverlaps = continuous.some(
        d =>
          Math.abs(d.position.x - resolvedCol.position.x) < (d.width + resolvedCol.width) * 1.5 + 10
          && Math.abs(d.position.y - resolvedCol.position.y) < (d.depth + resolvedCol.depth) * 1.5 + 10,
      );
      if (footingOverlaps) continue;
      continuous.push(resolvedCol);
    }
    placedStructure = {
      ...placedStructure,
      floors: placedStructure.floors.map(f => ({
        ...f,
        columns: continuous.map((c, idx) => ({
          ...c,
          id: `${f.id}::col_${idx + 1}`,
          floorId: f.id,
          gridReference: `C${idx + 1}`,
        })),
      })),
    };
  }
  const framedFloors = placedStructure.floors.map(floor => ({ ...floor, slabThicknessMm: floor.slabThicknessMm ?? 150 }));
  const coordinated = new GeometryValidator().auditAndFixColumnAndBeamGrid({ ...placedStructure, floors: framedFloors }, true).building;
  const gridKey = (column: Column) => `${column.position.x}:${column.position.y}:${column.width}:${column.depth}`;
  const gridByFloor = coordinated.floors.map(floor => new Set(floor.columns.map(gridKey)));
  const floors = coordinated.floors.map(floor => {
    const columns = floor.columns.filter(column => gridByFloor.every(grid => grid.has(gridKey(column))));
    const ids = new Set(columns.map(column => column.id));
    const beams = (floor.beams ?? []).filter(beam =>
      (!beam.startColumnId || ids.has(beam.startColumnId)) && (!beam.endColumnId || ids.has(beam.endColumnId))).map((beam, index) => ({
      ...beam, id: `${floor.id}::preliminary-beam_${index + 1}`,
    }));
    return { ...floor, columns, beams };
  });
  return {
    ...coordinated,
    floors,
    beams: floors.flatMap(floor => floor.beams ?? []),
    metadata: { ...coordinated.metadata, tags: [
      ...(coordinated.metadata.tags ?? []).filter(tag => tag !== 'STRUCTURAL_DESIGN_DEFERRED' && tag !== 'STRUCTURAL_FRAMING_PRELIMINARY'),
      'STRUCTURAL_FRAMING_PRELIMINARY',
    ] },
  };
}

/** Global entity identity is floor-scoped; all local references move together. */
function namespaceFloorEntities(floor: Floor): Floor {
  const ducts = new Set(floor.rooms.filter(room => room.tags.includes('shaft:interflat') && architecturalSpaceRole(room) === 'OPEN_TO_SKY_VOID').map(room => room.id));
  if (floor.apartmentUnits?.length && ducts.size) {
    const rooms = new Map(floor.rooms.map(room => [room.id, room]));
    const occupiedWalls = new Set([...floor.doors, ...floor.windows].map(opening => opening.wallId));
    const windows = [...floor.windows];
    for (const wall of floor.walls) {
      if (wall.wallUse !== 'SHAFT' || !wall.roomIds.some(roomId => ducts.has(roomId)) || occupiedWalls.has(wall.id)) continue;
      const room = wall.roomIds.map(roomId => rooms.get(roomId)).find(room => room?.unitId &&
        [RoomType.Living, RoomType.Dining, RoomType.Kitchen, RoomType.Bedroom, RoomType.Utility].includes(room.type) &&
        room.spaceUse !== 'OUTDOOR');
      if (!room) continue;
      const length = Math.hypot(wall.endPoint.x - wall.startPoint.x, wall.endPoint.y - wall.startPoint.y);
      if (length < 650) continue;
      const height = room.type === RoomType.Dining ? 1350 : 1500;
      const targetArea = Math.max(1_250_000, polygonArea(room.boundary) * 0.12);
      const existingArea = windows.reduce(
        (area, window) => window.roomId === room.id ? area + window.width * window.height : area, 0,
      );
      const deficit = targetArea - existingArea;
      windows.push({ id: `ots-window:${room.id}:${wall.id}`, floorId: floor.id, wallId: wall.id, roomId: room.id,
        position: { x: (wall.startPoint.x + wall.endPoint.x) / 2, y: (wall.startPoint.y + wall.endPoint.y) / 2 },
        width: Math.min(Math.floor(length - 200), Math.max(450, Math.ceil(deficit / height / 10) * 10)), height, sillHeight: 900, type: WindowType.Sliding,
        openingGeometryVersion: 1, positionReference: 'CENTER' });
    }
    floor = { ...floor, windows };
  }
  floor = fitFloorOpeningsInsideWalls(floor);
  const id = (value: string): string => value.startsWith(`${floor.id}::`) ? value : `${floor.id}::${value}`;
  const reference = (value: string | undefined): string | undefined => value ? id(value) : undefined;
  return {
    ...floor,
    rooms: floor.rooms.map(room => ({ ...room, id: id(room.id), floorId: floor.id, bathroomOwnerRoomId: reference(room.bathroomOwnerRoomId) })),
    walls: floor.walls.map(wall => ({ ...wall, id: id(wall.id), floorId: floor.id, roomIds: wall.roomIds.map(id), leftRoomId: reference(wall.leftRoomId), rightRoomId: reference(wall.rightRoomId) })),
    doors: floor.doors.map(door => ({ ...door, id: id(door.id), floorId: floor.id, wallId: id(door.wallId), connectsRooms: [id(door.connectsRooms[0]), door.connectsRooms[1].startsWith('__') ? door.connectsRooms[1] : id(door.connectsRooms[1])] as const })),
    windows: floor.windows.map(window => ({ ...window, id: id(window.id), floorId: floor.id, wallId: id(window.wallId), roomId: id(window.roomId) })),
    stairs: floor.stairs.map(stair => ({ ...stair, id: id(stair.id), floorId: floor.id })),
    columns: floor.columns.map(column => ({ ...column, id: id(column.id), floorId: floor.id })),
    beams: floor.beams?.map(beam => ({ ...beam, id: id(beam.id), floorId: floor.id, startColumnId: reference(beam.startColumnId), endColumnId: reference(beam.endColumnId) })),
    canonicalStaircases: floor.canonicalStaircases?.map(stair => ({ ...stair, id: id(stair.id), floorId: floor.id })),
    furniture: floor.furniture?.map(item => ({ ...item, id: id(item.id), roomId: id(item.roomId) })),
  };
}

// ─── Master Engine: solveMultiSheetApartmentProject ──────────────────────────

export function solveMultiSheetApartmentProject(
  rawConfig: MultiSheetApartmentConfig,
  onStage?: (stage: 'UNIT_SPATIAL_SLICING' | 'WALL_AND_OPENING_TOPOLOGY' | 'COLUMN_AND_BEAM_GRID') => void,
  recovery?: {
    readonly legacyOnly?: boolean;
    readonly skipComplianceGate?: boolean;
    readonly complianceAttempt?: number;
  },
): MultiSheetApartmentResult {
  const resolvedCategory = rawConfig.planCategory ?? inferPlanCategoryFromPrompt(rawConfig.aiPrompt);
  const explicitPromptShape = inferShapeIdFromPrompt(rawConfig.aiPrompt);
  const explicitOrAutoShape =
    rawConfig.autoExploreNovelShape || (rawConfig.rejectedShapeIds && rawConfig.rejectedShapeIds.length > 0 && !rawConfig.buildingMassingShape)
      ? pickNextNonRepeatingShape({
        requestedShape: rawConfig.buildingMassingShape ?? explicitPromptShape,
        usedShapeIds: rawConfig.rejectedShapeIds,
        planCategory: resolvedCategory,
        seed: rawConfig.generationSeed,
        autoExplore: Boolean(rawConfig.autoExploreNovelShape || (rawConfig.rejectedShapeIds?.length && !rawConfig.buildingMassingShape)),
        shapeParams: rawConfig.shapeParams,
      }).id
      : (rawConfig.buildingMassingShape ??
        explicitPromptShape ??
        (resolvedCategory && resolvedCategory !== 'HIGH_RISE_APARTMENT'
          ? getPlanCategoryEntry(resolvedCategory).defaultShapeId
          : undefined));

  const plotWidthMm = rawConfig.plotWidthMm ?? (rawConfig as any).siteWidthMm ?? 50000;
  const plotDepthMm = rawConfig.plotDepthMm ?? (rawConfig as any).siteDepthMm ?? 50000;
  const isVillaCategory = resolvedCategory === 'LUXURY_VILLA_BUNGALOW';
  const numTypicalFloors = rawConfig.numTypicalFloors ?? (rawConfig as any).floorCount ?? (isVillaCategory ? 2 : 4);
  const roadWidthMm = rawConfig.roadWidthMm ?? 12000;
  const roadAccessSides = rawConfig.roadAccessSides ?? [(rawConfig as any).roadFacing ?? Direction.South];
  const lotAllotmentMode = rawConfig.lotAllotmentMode ?? 'STATUTORY_SETBACK_100_PERCENT';
  const jurisdiction = rawConfig.jurisdiction ?? 'pune_pmc';
  const verticalStackType = rawConfig.verticalStackType ?? (isVillaCategory ? 'G_PLUS_N' : 'STILT_PLUS_N');
  const parsedMixed = parseMixedUnitProgram(rawConfig.aiPrompt);
  const existingTypes = (rawConfig.units ?? []).map(u => u.bhkType);
  const applyMixed = Boolean(
    parsedMixed &&
    parsedMixed.length >= 2 &&
    parsedMixed.length <= 6 &&
    (existingTypes.length !== parsedMixed.length || new Set(existingTypes).size <= 1),
  );
  const flatsPerFloor = (applyMixed
    ? parsedMixed!.length
    : rawConfig.flatsPerFloor ?? (isVillaCategory ? 1 : 4)) as 1 | 2 | 3 | 4 | 5 | 6;
  const resolvedUnits = applyMixed
    ? mixedUnitSpecs(parsedMixed!)
    : rawConfig.units ?? (flatsPerFloor === 1 ? [{ unitIndex: 1, bhkType: '4BHK' as const, hasUtilityBalcony: true }] : undefined);
  const siteAmenities = rawConfig.siteAmenities ?? DEFAULT_SITE_AMENITIES;
  const stiltAmenities = rawConfig.stiltAmenities ?? DEFAULT_STILT_AMENITIES;
  const terraceAmenities = rawConfig.terraceAmenities ?? DEFAULT_TERRACE_AMENITIES;
  const parkingMode = rawConfig.parkingMode ?? 'STILT_AND_SURFACE';

  const config: MultiSheetApartmentConfig = {
    ...rawConfig,
    ...(resolvedCategory ? { planCategory: resolvedCategory } : {}),
    ...(explicitOrAutoShape ? { buildingMassingShape: explicitOrAutoShape } : {}),
    plotWidthMm,
    plotDepthMm,
    numTypicalFloors,
    roadWidthMm,
    roadAccessSides,
    lotAllotmentMode,
    jurisdiction,
    verticalStackType,
    flatsPerFloor,
    ...(resolvedUnits ? { units: resolvedUnits } : {}),
    siteAmenities,
    stiltAmenities,
    terraceAmenities,
    parkingMode,
    includeDiningHall:
      rawConfig.includeDiningHall ??
      (/\b(?:no\s+dining|without\s+dining|open\s+living[\s-]only)\b/i.test(rawConfig.aiPrompt ?? '') ? false : true),
  };

  const stackParams = computeBuildingStackParameters(config);

  // 1. Calculate Plinth Envelope
  let permissibleEnvelope: Box2D;
  if (config.lotAllotmentMode === 'FULL_LOT_100_PERCENT') {
    permissibleEnvelope = {
      x: 0,
      y: 0,
      w: config.plotWidthMm,
      h: config.plotDepthMm,
    };
  } else {
    const { left, rear, right, front } = config.setbacksMm ?? { left: 3000, rear: 3000, right: 3000, front: 4500 };
    const exteriorWallNib = 115;
    permissibleEnvelope = {
      x: left + exteriorWallNib,
      y: rear + exteriorWallNib,
      w: config.plotWidthMm - left - right - 2 * exteriorWallNib,
      h: config.plotDepthMm - rear - front - 2 * exteriorWallNib,
    };
  }

  let envelope: Box2D = permissibleEnvelope;
  const promptIntent = (() => {
    try {
      return interpretArchitecturalIntent({
        flatsPerFloor: config.flatsPerFloor,
        unitTypes: (config.units ?? []).map(u => u.bhkType),
        aiPrompt: config.aiPrompt,
      });
    } catch {
      return undefined;
    }
  })();

  const effectiveTargetSqFt = config.targetAreaSqFt ?? promptIntent?.mandatory.targetAreaSqFt;
  const effectiveAreaScope: AreaTargetScope | undefined =
    config.areaTargetScope ??
    promptIntent?.mandatory.areaTargetScope ??
    (effectiveTargetSqFt !== undefined ? 'PER_APARTMENT_CARPET' : undefined);
  const shouldCenterBuilding = Boolean(
    config.centerBuildingInEnvelope ||
    promptIntent?.mandatory.centerBuilding ||
    effectiveTargetSqFt !== undefined,
  );

  if (effectiveTargetSqFt !== undefined && effectiveTargetSqFt > 0 && effectiveAreaScope) {
    const coreW = 7800;
    const minHabitableW = 20400;
    const minHabitableH = 15200;
    const targetM2 = effectiveTargetSqFt / 10.7639;
    let builtW = permissibleEnvelope.w;
    let builtH = permissibleEnvelope.h;

    if (effectiveAreaScope === 'GROSS_FLOOR_AREA') {
      const targetGrossMm2 = targetM2 * 1e6;
      if (targetGrossMm2 <= minHabitableW * minHabitableH) {
        builtW = Math.min(permissibleEnvelope.w, minHabitableW);
        builtH = Math.min(permissibleEnvelope.h, minHabitableH);
      } else {
        const aspect = permissibleEnvelope.w / Math.max(1, permissibleEnvelope.h);
        builtW = Math.min(permissibleEnvelope.w, Math.max(minHabitableW, snap10(Math.sqrt(targetGrossMm2 * aspect))));
        builtH = Math.min(permissibleEnvelope.h, Math.max(minHabitableH, snap10(targetGrossMm2 / Math.max(1, builtW))));
      }
    } else if (effectiveAreaScope === 'FLOOR_TOTAL_CARPET') {
      const targetCarpetPerFlatM2 = targetM2 / Math.max(1, config.flatsPerFloor);
      const wantsBedBalcs = Boolean(
        promptIntent?.preferences.bedroomBalconies && promptIntent.preferences.bedroomBalconies !== 'NONE_REQUESTED',
      );
      const netToGrossFloorRatio = wantsBedBalcs ? 0.69 : 0.80;
      const targetGrossPerFlatMm2 = (targetCarpetPerFlatM2 / netToGrossFloorRatio) * 1e6;
      const minWingW = wantsBedBalcs ? 7800 : 7200;
      const minFlatH = wantsBedBalcs ? 8550 : 7600;
      const wingW = Math.max(minWingW, snap10(Math.sqrt(targetGrossPerFlatMm2 * 0.91)));
      const flatH = Math.max(minFlatH, snap10(targetGrossPerFlatMm2 / Math.max(1, wingW)));
      const flatsPerWing = Math.max(1, Math.ceil(config.flatsPerFloor / 2));
      builtW = Math.min(permissibleEnvelope.w, Math.max(minHabitableW, 2 * wingW + coreW));
      builtH = Math.min(permissibleEnvelope.h, Math.max(minHabitableH, flatsPerWing * flatH));
    } else {
      // PER_APARTMENT_CARPET
      const targetCarpetPerFlatM2 = targetM2;
      const netToGrossRatio = targetCarpetPerFlatM2 >= 120 ? 0.78 : 0.73;
      const targetGrossPerFlatMm2 = (targetCarpetPerFlatM2 / netToGrossRatio) * 1e6;
      const wingW = Math.max(7600, snap10(Math.sqrt(targetGrossPerFlatMm2)));
      const flatH = Math.max(6800, snap10(targetGrossPerFlatMm2 / Math.max(1, wingW)));
      const flatsPerWing = Math.max(1, Math.ceil(config.flatsPerFloor / 2));
      builtW = Math.min(permissibleEnvelope.w, Math.max(minHabitableW, 2 * wingW + coreW));
      builtH = Math.min(permissibleEnvelope.h, Math.max(minHabitableH, flatsPerWing * flatH));
    }

    if (shouldCenterBuilding) {
      envelope = {
        x: permissibleEnvelope.x + snap10((permissibleEnvelope.w - builtW) / 2),
        y: permissibleEnvelope.y + snap10((permissibleEnvelope.h - builtH) / 2),
        w: builtW,
        h: builtH,
      };
    } else {
      envelope = { ...permissibleEnvelope, w: builtW, h: builtH };
    }
  } else if (shouldCenterBuilding) {
    envelope = {
      x: permissibleEnvelope.x,
      y: permissibleEnvelope.y,
      w: permissibleEnvelope.w,
      h: permissibleEnvelope.h,
    };
  }

  const minSpanReq = (config.flatsPerFloor as number) === 1 ? 7000 : 8500;
  const minRunReq = (config.flatsPerFloor as number) === 1 ? 7000 : 8500;
  if (envelope.w < minSpanReq || envelope.h < minRunReq) throw new Error('The requested setbacks leave too little buildable space for this apartment topology. Increase the plot or reduce the program.');

  onStage?.('UNIT_SPATIAL_SLICING');

  // 2. Select the architectural organization.
  //
  // The generative topology engine interprets the brief, builds every viable
  // organization for this envelope, validates each against mandatory access,
  // facade and ventilation requirements, scores them and returns the ranked
  // distinct concepts. The top-ranked concept drives the whole stack, so the
  // stilt, typical, refuge and terrace sheets all repeat one coherent core.
  //
  // If no organization is feasible, fall back to the historical central-core
  // partition rather than failing a brief the previous engine could build.
  const effectiveAiPrompt = (() => {
    let base = config.aiPrompt ?? '';
    if (effectiveTargetSqFt && !/\b\d+\s*(?:sq\.?\s*ft\.?|sqft)\b/i.test(base)) {
      const scopePhrase =
        effectiveAreaScope === 'GROSS_FLOOR_AREA'
          ? 'gross floor area'
          : effectiveAreaScope === 'FLOOR_TOTAL_CARPET'
            ? 'total carpet area per floor'
            : 'carpet area per apartment';
      base = `${base} ${effectiveTargetSqFt} sq. ft. ${scopePhrase}`.trim();
    }
    return base || undefined;
  })();

  let topologyEvidence: GenerateConceptsResult | undefined;
  const topology = recovery?.legacyOnly ? undefined : selectProductionTopology({
    allowBestEffort: !recovery?.legacyOnly,
    onEvaluated: result => { topologyEvidence = result; },
    envelope,
    flatsPerFloor: config.flatsPerFloor,
    unitTypes: (config.units ?? []).map(unit => unit.bhkType),
    aiPrompt: effectiveAiPrompt,
    seed: config.generationSeed,
    preferredArchetype: config.preferredArchetype as RoomSlicingArchetypeId | undefined,
    preferredMassingShape: config.buildingMassingShape,
    rejectedTopologyHashes: config.rejectedTopologyHashes,
  });

  const macro = topology
    ? topology.macro
    : partitionMacroFootprint(envelope, config.flatsPerFloor, interpretArchitecturalPlacement(config.aiPrompt));

  onStage?.('WALL_AND_OPENING_TOPOLOGY');
  // 3. Solve Sheet 1: SITE_PLAN
  const siteSheet = solveSitePlanSheet(config, envelope);

  // 4. Solve Sheet 2: STILT_PARKING_PLAN
  const stiltSheet = solveStiltParkingSheet(config, envelope, macro, stackParams);

  // 5. Solve Residential Floor Sheets (1st Floor to Nth Floor)
  const numFloors = Math.max(1, config.numTypicalFloors ?? 4);
  const residentialSheets: TypicalFloorSheetResult[] = [];
  for (let fl = 1; fl <= numFloors; fl++) {
    residentialSheets.push(
      solveTypicalFloorSheet(
        config,
        envelope,
        config.verticalStackType === 'G_PLUS_N' ? fl - 1 : fl,
        topology,
        { floorVariant: fl % 2 === 1 ? 'ODD' : 'EVEN' },
      ),
    );
  }
  const typicalSheet = residentialSheets[0]!;

  onStage?.('COLUMN_AND_BEAM_GRID');
  // 6. Solve Sheet 4: COLUMN_SCHEDULE_PLAN
  const columnScheduleSheet = solveStructuralColumnScheduleSheet(typicalSheet, envelope);

  // 7. Solve Sheet 5: REFUGE_FLOOR_PLAN (mandatory when height > 24m)
  let refugeSheet: RefugeFloorSheetResult | undefined;
  if (stackParams.requiresRefugeFloor && stackParams.refugeFloorLevels.length > 0) {
    const primaryRefugeLevel = stackParams.refugeFloorLevels[0]!;
    refugeSheet = solveRefugeFloorSheet(typicalSheet, primaryRefugeLevel);
  }

  // 8. Solve Sheet 6: TERRACE_PLAN
  const terraceLevel = config.numTypicalFloors + (config.verticalStackType === 'G_PLUS_N' ? 0 : 1);
  const terraceSheet = solveTerraceSheet(config, envelope, macro, terraceLevel);

  // 9. Solve Sheet 7: AREA_SCHEDULE_SHEET
  const schedule = generateApartmentProjectSchedule({
    config,
    siteSheet,
    stiltSheet,
    typicalSheet,
    refugeSheet,
    terraceSheet,
    stackParams,
  });

  // 10. Assemble Coordinated Sheets Package
  const sheetOffset = 103;
  const resSheetItems: CoordinatedApartmentSheet[] = residentialSheets.map((rs, idx) => {
    const fl = idx + 1;
    const flOrdinal = fl === 1 ? '1st' : fl === 2 ? '2nd' : fl === 3 ? '3rd' : `${fl}th`;
    const startFlat = fl * 100 + 1;
    const endFlat = fl * 100 + config.flatsPerFloor;
    return {
      sheetType: 'TYPICAL_FLOOR_PLAN' as const,
      sheetNumber: `A-${sheetOffset + idx}`,
      title: `Drawing 0${fl} — ${flOrdinal} Floor Plan (Flats ${startFlat} to ${endFlat})`,
      floor: rs.floor,
      audit: rs.audit,
    };
  });

  const nextSheetNum = sheetOffset + residentialSheets.length;

  const sheets: CoordinatedApartmentSheet[] = [
    {
      sheetType: 'SITE_PLAN',
      sheetNumber: 'A-101',
      title: 'Overall Site Layout & Landscape Master Plan',
      site: siteSheet.site,
      audit: siteSheet.audit,
    },
    {
      sheetType: 'STILT_PARKING_PLAN',
      sheetNumber: 'A-102',
      title: 'Stilt Floor Parking & Indoor Amenities Plan',
      floor: stiltSheet.floor,
      audit: stiltSheet.audit,
    },
    ...resSheetItems,
    {
      sheetType: 'COLUMN_SCHEDULE_PLAN',
      sheetNumber: `A-${nextSheetNum}`,
      title: 'Structural Column Grid Layout & Schedule Sheet',
      floor: columnScheduleSheet.floor,
      audit: columnScheduleSheet.audit,
    },
    ...(refugeSheet
      ? [
        {
          sheetType: 'REFUGE_FLOOR_PLAN' as const,
          sheetNumber: `A-${nextSheetNum + 1}`,
          title: `Fire Refuge Floor Plan (Level ${stackParams.refugeFloorLevels[0]})`,
          floor: refugeSheet.floor,
          audit: refugeSheet.audit,
        },
      ]
      : []),
    {
      sheetType: 'TERRACE_PLAN',
      sheetNumber: `A-${nextSheetNum + (refugeSheet ? 2 : 1)}`,
      title: 'Rooftop Services, Solar PV & Terrace Plan',
      floor: terraceSheet.floor,
      audit: terraceSheet.audit,
    },
    {
      sheetType: 'AREA_SCHEDULE_SHEET',
      sheetNumber: `A-${nextSheetNum + (refugeSheet ? 3 : 2)}`,
      title: 'UDCPR / NBC FSI, RERA Carpet & Parking Statement',
      schedule,
      audit: {
        sheetId: 'sheet_06_schedule',
        sheetName: 'Sheet 06: Statutory Area Schedule',
        grossAreaMm2: schedule.sheetAudits.reduce((sum, a) => sum + a.grossAreaMm2, 0),
        accountedAreaMm2: schedule.sheetAudits.reduce((sum, a) => sum + a.accountedAreaMm2, 0),
        deltaMm2: schedule.overallDeltaMm2,
        unassignedMm2: 0,
        isPlanarConserved: schedule.overallDeltaMm2 < 0.001,
      },
    },
  ];

  // 11. Assemble Complete Multi-Floor Canonical Building
  const buildingFloors: Floor[] = [
    ...(config.verticalStackType === 'G_PLUS_N' ? [] : [stiltSheet.floor]),
    ...residentialSheets.map(s => refugeSheet && s.floor.level === refugeSheet.floor.level ? refugeSheet.floor : s.floor),
    terraceSheet.floor,
  ];

  const rawBuilding: Building = {
    regulatoryContext: config.regulatoryContext,
    id: config.projectId ? `building:${config.projectId}` : 'multi_sheet_apartment_building',
    projectId: config.projectId ?? 'apartment_project',
    name: config.projectName ?? 'Coordinated Multi-Sheet Indian Residential Apartment',
    site: { ...siteSheet.site, roadFacing: config.roadAccessSides[0] ?? Direction.North, roadWidth: config.roadWidthMm },
    floors: buildingFloors.map(floor => ({
      ...floor,
      floorUse: floor.id === terraceSheet.floor.id ? 'ROOF' as const : floor.id === stiltSheet.floor.id ? 'STILT_PARKING' as const : 'RESIDENTIAL' as const,
      elevationMm: floor.id === stiltSheet.floor.id ? 0 : buildingFloors.filter(other => other.level < floor.level && other.id !== terraceSheet.floor.id).reduce((sum, other) => sum + other.floorHeight, 0),
      buildingId: config.projectId ? `building:${config.projectId}` : 'multi_sheet_apartment_building'
    })),
    metadata: {
      projectId: config.projectId ?? 'apartment_project',
      generationBrief: {
        source: config.aiTelemetryOverride?.geminiInvoked ? 'HYBRID' : 'DETERMINISTIC',
        aiPrompt: config.aiPrompt,
        referenceImage: config.referenceImage ? { name: config.referenceImage.name, mimeType: config.referenceImage.mimeType } : undefined,
        units: config.units ?? [],
        includeWindowChajjas: config.includeWindowChajjas ?? true,
        staggeredBalconies: config.staggeredBalconies ?? false,
        ...(config.generationSeed !== undefined ? { generationSeed: config.generationSeed } : {}),
        ...(topology?.chosen.fingerprint.digests.canonical ? { topologyHash: topology.chosen.fingerprint.digests.canonical } : {}),
        ...(topology?.result.archetype
          ? { archetype: topology.result.archetype }
          : config.preferredArchetype
            ? { archetype: config.preferredArchetype }
            : {}),
        buildingMassingShape: typicalSheet.shapeId,
        requestedMassingShape: rawConfig.buildingMassingShape ?? explicitPromptShape,
        ...(config.planCategory ? { planCategory: config.planCategory } : {}),
        usedShapeIds: [
          ...(config.rejectedShapeIds ?? []),
          ...(typicalSheet.shapeId ? [typicalSheet.shapeId] : []),
        ].filter((v, idx, arr) => arr.indexOf(v) === idx),
        ...(config.aiProposal ? { aiProposal: config.aiProposal } : {}),
        aiTelemetry: config.aiTelemetryOverride ?? {
          geminiInvoked: false,
          provider: 'deterministic-rule-engine',
          referenceImageUsedForGeometry: false,
        },
      },
      description: `Coordinated 6-Sheet Apartment Project (${config.flatsPerFloor} Flats/Floor, ${config.numTypicalFloors} Floors)`,
      tags: ['apartment', 'multi_sheet', 'udcpr', 'rera', 'canonical_model'],
    },
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const buildingWithFurniture = populateCanonicalFurniture(rawBuilding);

  // Use the coordinated preliminary framing profile unless the caller explicitly defers structure.
  const deferredStructure = config.structuralLayoutMode === 'DEFERRED';
  const architecturalBuilding = deferredStructure ? { ...buildingWithFurniture, floors: buildingWithFurniture.floors.map(f => ({ ...f, columns: [], beams: [] })), beams: [], metadata: { ...buildingWithFurniture.metadata, tags: [...(buildingWithFurniture.metadata.tags ?? []), 'STRUCTURAL_DESIGN_DEFERRED'] } } : buildingWithFurniture;
  const placedStructure = deferredStructure ? architecturalBuilding : synthesizeStructuralFraming(architecturalBuilding);
  const audit = validateAndRepairBuildingGeometry(placedStructure, { autoCorrect: false });
  const finalFloors = audit.building.floors.map(namespaceFloorEntities);
  const rawValidatedBuilding: Building = withArchitecturalElements(coordinateArchitecturalStairs({
    ...audit.building, floors: finalFloors,
    furniture: [...finalFloors.flatMap(floor => floor.furniture ?? []), ...(audit.building.furniture ?? []).filter(item => item.siteZoneId)],
  }));
  const filterFloorBeams = (fl: Floor, beams: Floor['beams']): NonNullable<Floor['beams']> => {
    if (!beams?.length) return [];
    const builtBoxes = fl.rooms
      .filter(r => !r.tags?.includes('recess:perimeter') && architecturalSpaceRole(r) !== 'OPEN_TO_SKY_VOID')
      .map(roomToBox);
    if (!builtBoxes.length) return [];
    const nearBuilt = (pt: { x: number; y: number }) =>
      builtBoxes.some(
        bx =>
          pt.x >= bx.rect.x - 160 &&
          pt.x <= bx.rect.x + bx.rect.width + 160 &&
          pt.y >= bx.rect.y - 160 &&
          pt.y <= bx.rect.y + bx.rect.height + 160,
      );
    return beams.filter(bm => {
      const mid = { x: (bm.startPoint.x + bm.endPoint.x) / 2, y: (bm.startPoint.y + bm.endPoint.y) / 2 };
      return nearBuilt(bm.startPoint) && nearBuilt(bm.endPoint) && nearBuilt(mid);
    });
  };
  const filteredFloors = rawValidatedBuilding.floors.map(f =>
    f.beams?.length ? { ...f, beams: filterFloorBeams(f, f.beams) } : f,
  );
  const filteredFloorMap = new Map(filteredFloors.map(f => [f.id, f]));
  const validatedBuilding: Building = {
    ...rawValidatedBuilding,
    floors: filteredFloors,
    ...(rawValidatedBuilding.beams?.length
      ? {
        beams: rawValidatedBuilding.beams.filter(bm => {
          const fl = filteredFloorMap.get(bm.floorId);
          return !fl || filterFloorBeams(fl, [bm]).length > 0;
        }),
      }
      : {}),
  };
  const finalAudit = validateAndRepairBuildingGeometry(validatedBuilding, { autoCorrect: false });
  const validationReport = {
    ...finalAudit.report, errors: finalAudit.report.errors.map(error => ({
      ...error,
      elementIds: error.elementIds.map(value => value === error.floorId || value.startsWith(`${error.floorId}::`) ? value : `${error.floorId}::${value}`),
    }))
  };
  const validatedFloorsById = new Map(validatedBuilding.floors.map(f => [f.id, f]));
  const updatedSheets = sheets.map(s => {
    if (s.floor) {
      const updatedFloor = validatedFloorsById.get(s.floor.id);
      return { ...s, floor: updatedFloor ?? namespaceFloorEntities(s.floor) };
    }
    return s;
  });

  const generationReport = createGenerationReport(validatedBuilding, validationReport, {
    strategy: !topology ? 'LEGACY_FALLBACK' : topology.chosen.score.feasible ? 'VALIDATED_TOPOLOGY' : 'BEST_EFFORT_TOPOLOGY',
    selectedFamily: topology?.chosen.familyId,
    selectedVariant: topology?.chosen.variantId,
    selectedShapeId: typicalSheet.shapeId,
    selectedPlanCategory: config.planCategory,
    rejectedCandidates: topologyEvidence?.rejected ?? [],
  }, !topology ? [{
    code: 'LEGACY_FALLBACK_USED', severity: 'WARNING', source: 'GENERATION', elementIds: [],
    description: recovery?.legacyOnly
      ? 'The legacy partition was evaluated as a bounded recovery option and requires review.'
      : 'No assembled topology candidate was available. The legacy partition was used and requires review.'
  }]
    : topology.chosen.score.hardConstraints.filter(c => !c.satisfied).map(c => ({
      code: c.id, severity: 'WARNING' as const, source: 'TOPOLOGY' as const, elementIds: [],
      description: `Pre-repair candidate finding: ${c.detail}. Final geometry and closure findings are reported separately.`,
    })));
  const result: MultiSheetApartmentResult = {
    generationReport,
    config,
    building: {
      ...validatedBuilding, metadata: {
        ...validatedBuilding.metadata,
        generationReport,
        bedroomBalconySchedule: bedroomBalconySchedule(validatedBuilding)
      }
    },
    sheets: updatedSheets,
    schedule,
    validationReport,
    totalBuildingHeightMm: stackParams.totalBuildingHeightMm,
    hasRefugeFloor: stackParams.requiresRefugeFloor,
    refugeFloorLevels: stackParams.refugeFloorLevels,
  };
  const attachCompliance = (
    res: MultiSheetApartmentResult,
    attemptNum: number,
  ): { result: MultiSheetApartmentResult; compliance: ArchitecturalComplianceReport } => {
    const compliance = evaluateArchitecturalComplianceScore(res.building, {
      config,
      permissibleEnvelopeMm: permissibleEnvelope,
      attemptCount: attemptNum,
    });
    const nextBuilding: Building = {
      ...res.building,
      complianceRating: compliance,
      metadata: {
        ...res.building.metadata,
        complianceScore: compliance.score,
        complianceReport: compliance,
        complianceRating: compliance,
      } as Building['metadata'],
    } as Building;
    return {
      result: { ...res, building: nextBuilding },
      compliance,
    };
  };

  let { result: finalResult, compliance: finalCompliance } = attachCompliance(
    result,
    (recovery?.complianceAttempt ?? 0) + 1,
  );

  const finalizeWithMep = (res: MultiSheetApartmentResult): MultiSheetApartmentResult => ({
    ...res,
    building: res.building.mepEngineering ? res.building : withMepEngineering(res.building),
  });

  // Bounded Auto-Regeneration Quality Gate Loop (up to 12 total attempts):
  // If complianceScore < 85 or redConflictCount > 0, automatically reject the candidate,
  // append its topology hash to rejectedTopologyHashes, mutate the seed, and regenerate.
  if (
    !finalCompliance.passed &&
    !recovery?.legacyOnly &&
    !recovery?.skipComplianceGate &&
    (recovery?.complianceAttempt ?? 0) === 0
  ) {
    const baseSeed = Math.max(1, Math.floor(Number(rawConfig.generationSeed ?? 1)));
    const rejectedHashes = new Set<string>(rawConfig.rejectedTopologyHashes ?? []);
    const initialHash = (finalResult.building.metadata as unknown as Record<string, unknown>)?.topologyHash;
    if (typeof initialHash === 'string' && initialHash.length > 0) {
      rejectedHashes.add(initialHash);
    }
    const initialVariant = finalResult.generationReport?.selectedVariant;
    if (typeof initialVariant === 'string' && initialVariant.length > 0) {
      rejectedHashes.add(initialVariant);
    }

    const lockedMassingShape =
      config.buildingMassingShape ??
      rawConfig.buildingMassingShape ??
      (!promptIntent?.preferences.requestsDifferentShape ? 'COMPACT_DOUBLE_LOADED' : undefined);
    const archetypeRotation: readonly (RoomSlicingArchetypeId | undefined)[] = [
      rawConfig.preferredArchetype as RoomSlicingArchetypeId | undefined,
      'CENTRAL_LIVING_SPLIT_BEDROOMS',
      'CORNER_L_LIVING_REAR_SLEEPING',
      'FRONT_BALCONY_OPEN_KITCHEN',
      'LINEAR_TANDEM_DEEP_PLATE',
      'MIRRORED_WET_CORE_STACK',
    ];
    for (let attempt = 1; attempt < 16; attempt++) {
      try {
        const altArchetype = attempt >= 4 ? archetypeRotation[attempt % archetypeRotation.length] : (rawConfig.preferredArchetype as RoomSlicingArchetypeId | undefined);
        const nextRaw = solveMultiSheetApartmentProject(
          {
            ...rawConfig,
            generationSeed: baseSeed + attempt,
            ...(lockedMassingShape ? { buildingMassingShape: lockedMassingShape } : {}),
            ...(resolvedCategory ? { planCategory: resolvedCategory } : {}),
            autoExploreNovelShape: false,
            ...(altArchetype ? { preferredArchetype: altArchetype } : {}),
            rejectedTopologyHashes: [...rejectedHashes],
          },
          undefined,
          {
            legacyOnly: false,
            skipComplianceGate: true,
            complianceAttempt: attempt,
          },
        );
        if (
          config.buildingMassingShape &&
          nextRaw.building.metadata.generationBrief?.buildingMassingShape !== config.buildingMassingShape
        ) {
          continue;
        }
        const { result: nextEvaluated, compliance: nextCompliance } = attachCompliance(nextRaw, attempt + 1);
        const nextHash = (nextEvaluated.building.metadata as unknown as Record<string, unknown>)?.topologyHash;
        if (typeof nextHash === 'string' && nextHash.length > 0) {
          rejectedHashes.add(nextHash);
        }
        const nextVariant = nextEvaluated.generationReport?.selectedVariant;
        if (typeof nextVariant === 'string' && nextVariant.length > 0) {
          rejectedHashes.add(nextVariant);
        }

        const isBetter =
          nextCompliance.score > finalCompliance.score ||
          (nextCompliance.score === finalCompliance.score &&
            nextCompliance.redConflictCount < finalCompliance.redConflictCount);
        if (isBetter) {
          finalResult = nextEvaluated;
          finalCompliance = nextCompliance;
        }
        if (nextCompliance.passed) {
          return finalizeWithMep(nextEvaluated);
        }
      } catch {
        // Continue trying remaining seeds
      }
    }
  }

  if (topology && !topology.chosen.score.feasible && !recovery?.legacyOnly &&
      finalResult.building.metadata.generationBrief?.buildingMassingShape !== 'PINWHEEL_CLUSTER') {
    // One bounded comparison after repair. Never replace a previously conserved
    // solution with an unassigned/overlapping candidate solely to avoid fallback.
    try {
      const legacy = solveMultiSheetApartmentProject(rawConfig, undefined, { legacyOnly: true, skipComplianceGate: true });
      const quality = (r: MultiSheetApartmentResult) => [
        r.sheets.filter(s => !s.audit.isPlanarConserved).length,
        r.generationReport?.violations.filter(v => v.severity === 'CRITICAL').length ?? 0,
        r.generationReport?.violations.filter(v => v.source !== 'TOPOLOGY' && v.source !== 'GENERATION').length ?? 0,
      ];
      const candidateQuality = quality(finalResult), legacyQuality = quality(legacy);
      const differing = candidateQuality.findIndex((v, i) => v !== legacyQuality[i]);
      const balconyRegression = finalResult.schedule.flatSchedule.some((flat, i) =>
        config.units?.[i]?.hasUtilityBalcony && flat.balconyAreaM2 < (legacy.schedule.flatSchedule[i]?.balconyAreaM2 ?? 0));
      const legacyCompliance = evaluateArchitecturalComplianceScore(legacy.building, { config: rawConfig });
      const legacyMeetsComplianceFloor =
        legacyCompliance.score >= 85 &&
        legacyCompliance.redConflictCount === 0 &&
        legacyCompliance.score >= finalCompliance.score &&
        legacyCompliance.redConflictCount <= finalCompliance.redConflictCount;
      const legacyPreservesShape = !config.buildingMassingShape ||
        legacy.building.metadata.generationBrief?.buildingMassingShape === config.buildingMassingShape;
      if (legacyPreservesShape && legacyMeetsComplianceFloor &&
          (balconyRegression || (differing >= 0 && legacyQuality[differing]! < candidateQuality[differing]!))) {
        const report = legacy.generationReport!;
        const updated = {
          ...report, violations: [...report.violations, {
            code: 'REPAIRED_CANDIDATE_OUTRANKED', severity: 'WARNING' as const, source: 'GENERATION' as const,
            description: `Repaired ${topology.chosen.familyId}/${topology.chosen.variantId} scored ${candidateQuality.join('/')} versus legacy ${legacyQuality.join('/')} (failed sheet ledgers / critical findings / final findings); requested balcony area regression=${balconyRegression}. Legacy retained.`,
            elementIds: [], rank: report.violations.length + 1,
          }]
        };
        const { result: legacyWithCompliance } = attachCompliance(
          { ...legacy, generationReport: updated, building: { ...legacy.building, metadata: { ...legacy.building.metadata, generationReport: updated } } },
          finalCompliance.attemptCount ?? 1,
        );
        return finalizeWithMep(legacyWithCompliance);
      }
    } catch { /* Keep the reviewable repaired candidate if the legacy attempt fails. */ }
  }
  return recovery?.skipComplianceGate ? finalResult : finalizeWithMep(finalResult);
}

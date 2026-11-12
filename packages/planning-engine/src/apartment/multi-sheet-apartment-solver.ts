import { interpretArchitecturalPlacement } from '../interpretation/architectural-placement.js';
import { coordinateArchitecturalStairs } from '../pipeline/architectural-connections.js';
import { bedroomBalconySchedule } from './bedroom-balcony-audit.js';
import { architecturalSpaceRole, withArchitecturalElements } from '@ai-floor-planner/core';
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

import {
  type MultiSheetApartmentConfig,
  type MultiSheetApartmentResult,
  type CoordinatedApartmentSheet,
  type ApartmentProjectSchedule,
  type SheetLedgerAudit,
  type FlatScheduleItem,
  type ParkingSchedule,
  type Building,
  type Floor,
  type Room,
  type Door,
  type Window,
  type Column,
  type Site,
  type SiteZone,
  type Polygon,
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
import { repairApartmentPlan } from '../repair/apartment-error-repair';
import { populateCanonicalFurniture } from '../plancraft/auto-furnish-apartment.js';
import {
  generateApartmentWalls,
  openingFitsApartmentWall,
  measureApartmentAreaLedger,
  polygonArea,
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
} from '../interpretation/space-filling-snapper';
import { selectProductionTopology, type SelectedTopology } from '../topology/production-bridge';
import { assembleStructureFromPartition } from '../topology/plan-assembler';
import type { ApartmentPlanStructure } from '../interpretation/apartment-plan';
import { GeometryValidator, validateAndRepairBuildingGeometry } from '../validator/geometry-validator';

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

function createBoxRoom(params: {
  id: string;
  name: string;
  type: RoomType;
  box: Box2D;
  floorId: string;
  spaceUse?: 'UNIT' | 'COMMON' | 'CORE' | 'SERVICE' | 'OUTDOOR' | 'VOID';
  planningZone?: 'PUBLIC' | 'PRIVATE' | 'SERVICE' | 'OUTDOOR';
  unitId?: string;
  tags?: string[];
  architecturalRole?: Room['architecturalRole'];
}): Room {
  const boundary: Polygon = {
    points: [
      { x: params.box.x, y: params.box.y },
      { x: params.box.x + params.box.w, y: params.box.y },
      { x: params.box.x + params.box.w, y: params.box.y + params.box.h },
      { x: params.box.x, y: params.box.y + params.box.h },
    ],
  };

  const result: Room = {
    id: params.id,
    name: params.name,
    type: params.type,
    floorId: params.floorId,
    boundary,
    x: params.box.x,
    y: params.box.y,
    width: params.box.w,
    height: params.box.h,
    rotation: 0,
    area: params.box.w * params.box.h,
    priority: 1,
    tags: params.tags ?? [],
    adjacencyRequirements: [],
    daylightRequirement: 'medium' as never,
    privacyRequirement: 'medium' as never,
    ventilationRequired: true,
    isFixed: true,
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

  // 3. Filter out any points on outer balcony corners (cantilevered slab)
  const nonBalconyPoints = rawPoints.filter(p => !isOuterBalconyCorner(p));

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
      tags: ['core:shaft'],
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

  const packParkingBox = (box: Box2D, zoneKey: string) => {
    // A bay is 5000 mm deep, but the region offered may be shallower once the
    // core and circulation have been clipped out of it. Packing a fixed depth
    // into a shallower region drives the stalls straight through whatever lies
    // beyond, so the depth is bounded by the region and a region too shallow
    // for a vehicle is left as open stilt area rather than mislabelled.
    const stallWidth = 2500;
    const stallDepth = Math.min(5000, Math.floor(box.h / 2) >= 5000 ? 5000 : box.h);
    if (stallDepth < 2500) return;
    const numStalls = Math.floor(box.w / stallWidth);
    const stallsW = numStalls * stallWidth;
    const remW = box.w - stallsW;
    // Two rows only fit when the region is deep enough for both plus an aisle.
    const isDoubleLoaded = box.h >= 2 * stallDepth + 3000;

    // North Row of Car Bays
    for (let s = 0; s < numStalls; s++) {
      carBaysCount++;
      const bayId = `stilt__car_bay_c${String(carBaysCount).padStart(2, '0')}`;
      rooms.push(
        createBoxRoom({
          id: bayId,
          name: `Covered Car Parking Stall C-${String(carBaysCount).padStart(2, '0')} (2.5x5.0m)`,
          type: RoomType.Parking,
          spaceUse: 'COMMON',
          box: { x: box.x + s * stallWidth, y: box.y, w: stallWidth, h: stallDepth },
          floorId,
        }),
      );
    }

    // North Remainder Two-Wheeler Bay
    if (remW > 0) {
      bikeBaysCount += remW >= 1000 ? 2 : 0;
      rooms.push(
        createBoxRoom({
          id: remW >= 1000 ? `stilt__bike_bay_b${String(bikeBaysCount).padStart(2, '0')}` : `stilt__open_remainder_${zoneKey}_${rooms.length}`,
          name: remW >= 1000 ? `Two-Wheeler Parking Bay B-${String(bikeBaysCount).padStart(2, '0')}` : 'Open parking remainder (not a vehicle bay)',
          type: remW >= 1000 ? RoomType.Parking : RoomType.Foyer,
          spaceUse: 'COMMON',
          box: { x: box.x + stallsW, y: box.y, w: remW, h: stallDepth },
          floorId,
        }),
      );
    }

    if (isDoubleLoaded) {
      // South Row of Car Bays
      const southY = box.y + box.h - stallDepth;
      for (let s = 0; s < numStalls; s++) {
        carBaysCount++;
        const bayId = `stilt__car_bay_c${String(carBaysCount).padStart(2, '0')}`;
        rooms.push(
          createBoxRoom({
            id: bayId,
            name: `Covered Car Parking Stall C-${String(carBaysCount).padStart(2, '0')} (2.5x5.0m)`,
            type: RoomType.Parking,
            spaceUse: 'COMMON',
            box: { x: box.x + s * stallWidth, y: southY, w: stallWidth, h: stallDepth },
            floorId,
          }),
        );
      }

      // South Remainder Two-Wheeler Bay
      if (remW > 0) {
        bikeBaysCount += remW >= 1000 ? 2 : 0;
        rooms.push(
          createBoxRoom({
            id: remW >= 1000 ? `stilt__bike_bay_b${String(bikeBaysCount).padStart(2, '0')}` : `stilt__open_remainder_${zoneKey}_${rooms.length}`,
            name: remW >= 1000 ? `Two-Wheeler Parking Bay B-${String(bikeBaysCount).padStart(2, '0')}` : 'Open parking remainder (not a vehicle bay)',
            type: remW >= 1000 ? RoomType.Parking : RoomType.Foyer,
            spaceUse: 'COMMON',
            box: { x: box.x + stallsW, y: southY, w: remW, h: stallDepth },
            floorId,
          }),
        );
      }

      // Central Driveway Aisle
      const driveH = box.h - 2 * stallDepth;
      rooms.push(
        createBoxRoom({
          id: `stilt__driveway_${zoneKey}`,
          architecturalRole: 'VEHICLE_AISLE',
          name: `Stilt Vehicular Driveway & Maneuvering Aisle (${zoneKey})`,
          type: RoomType.Corridor,
          spaceUse: 'COMMON',
          box: { x: box.x, y: box.y + stallDepth, w: box.w, h: driveH },
          floorId,
        }),
      );
    } else {
      // Single Row Driveway Aisle
      const driveH = box.h - stallDepth;
      rooms.push(
        createBoxRoom({
          id: `stilt__driveway_${zoneKey}`,
          architecturalRole: 'VEHICLE_AISLE',
          name: `Stilt Vehicular Driveway & Maneuvering Aisle (${zoneKey})`,
          type: RoomType.Corridor,
          spaceUse: 'COMMON',
          box: { x: box.x, y: box.y + stallDepth, w: box.w, h: driveH },
          floorId,
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
      packParkingBox(free, zoneKey);
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

  const rooms: Room[] = [];
  const addRoom = (
    r: { id: string; name: string; architecturalRole?: Room['architecturalRole']; type?: string; rect: { x: number; y: number; width: number; height: number }; planningZone?: 'PUBLIC' | 'PRIVATE' | 'SERVICE' | 'OUTDOOR'; bathroomOwnerRoomId?: string },
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
        floorId,
        unitId,
        tags: [`apt-room:${r.id}`],
      }),
    );
  };

  for (let fIdx = 0; fIdx < structure.flats.length; fIdx++) {
    const flat = structure.flats[fIdx]!;
    const flatNum = floorLevel * 100 + (fIdx + 1);
    for (const r of flat.rooms) {
      const renamed = {
        ...r,
        name: r.name.replace(/Flat\s*0?(\d+)/i, `Flat ${flatNum}`),
      };
      addRoom(renamed, RoomType.Custom, flat.id);
    }
  }
  for (const el of structure.lifts) addRoom(el, RoomType.Lift);
  for (const el of structure.stairs) addRoom(el, RoomType.Staircase);
  for (const el of structure.lobbies) addRoom(el, RoomType.Corridor);
  for (const el of structure.corridors) addRoom(el, RoomType.Corridor);
  for (const el of structure.shafts) addRoom(el, RoomType.ServiceShaft);

  const boundary = rectPolygon(envelope.x, envelope.y, envelope.w, envelope.h);
  const walls = generateApartmentWalls(rooms, floorId, boundary, true, config.architectureOptions?.guardHeightMm);
  const doors: Door[] = [];
  const windows: Window[] = [];

  for (const op of structure.openings) {
    const hostWall = walls.find(w =>
      (!op.connects || op.connects.every(id => w.roomIds.includes(`apt-room:${id}`))) && openingFitsApartmentWall(
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

  // Windows along exterior envelope walls and shafts (strictly no door overlap)
  for (const r of rooms) {
    if (r.spaceUse === 'OUTDOOR' || r.type === RoomType.ServiceShaft) continue;
    const isBath = r.type === RoomType.Bathroom;
    const extWalls = walls.filter(w =>
      (w.wallUse === 'EXTERNAL' || (isBath && w.wallUse === 'SHAFT')) &&
      w.boundaryRole !== 'OPEN_BOUNDARY' &&
      w.boundaryRole !== 'PARAPET' &&
      w.roomIds.includes(r.id),
    );
    for (const hw of extWalls) {
      // Check if wall segment already has a door opening (e.g. balcony door)
      const hasDoor = doors.some(d => d.wallId === hw.id);
      if (hasDoor) {
        // Balcony or exterior door already exists on this wall; never overlap door and window!
        continue;
      }
      const winW = isBath ? 600 : 1200;
      const winH = isBath ? 650 : 1200;
      const sillH = isBath ? 1500 : 900;
      const winPos = {
        x: snap10((hw.startPoint.x + hw.endPoint.x) / 2),
        y: snap10((hw.startPoint.y + hw.endPoint.y) / 2),
      };
      if (openingFitsApartmentWall(hw, winPos, winW)) {
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
  const repairedFloor = repairApartmentPlan({ id: 'typical', projectId: 'typical', name: floorName, site: { plotWidth: config.plotWidthMm, plotDepth: config.plotDepthMm } as Site, floors: [floor], metadata: { projectId: 'typical' }, version: 1, createdAt: '', updatedAt: '' }, manifest).building.floors[0]!;
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

  return { floor: repairedFloor, structure, audit };
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
  const isNorth = (targetBalcony && origDining) ? targetBalcony.y <= origDining.y : true;
  const refY = origDining ? (isNorth ? targetBalcony!.y : origDining.y) : targetBalcony!.y;
  const refH = origDining ? (targetBalcony!.height + origDining.height) : targetBalcony!.height;

  // Clone rooms and convert exterior balcony of Flat 01 into Statutory Fire Refuge Terrace (>= 15 m²)
  const rooms: Room[] = [];
  for (const r of baseFloor.rooms) {
    if (targetBalcony && r.id === targetBalcony.id) {
      rooms.push(createBoxRoom({
        id: `refuge_terrace_${refugeLevel}`,
        name: 'Statutory Fire Refuge Terrace (>= 15 m²)',
        type: RoomType.Balcony,
        spaceUse: 'OUTDOOR',
        planningZone: 'OUTDOOR',
        box: { x: targetBalcony.x, y: refY, w: targetBalcony.width, h: refH },
        floorId,
        unitId: 'flat_01',
        tags: ['refuge:terrace', 'fire_safety'],
      }));
      continue;
    }
    if (origDining && r.id === origDining.id) {
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
        tags: ['terrace:core'],
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
    doors.push({ id: `${mumty.id}:roof-access`, floorId, wallId: host.id,
      position: { x: (host.startPoint.x + host.endPoint.x) / 2, y: (host.startPoint.y + host.endPoint.y) / 2 },
      width: 1050, height: 2100, type: DoorType.Single, swingDirection: SwingDirection.Outward, connectsRooms: [mumty.id, other] });
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
  };
}

/** Global entity identity is floor-scoped; all local references move together. */
function namespaceFloorEntities(floor: Floor): Floor {
  const id = (value: string): string => value.startsWith(`${floor.id}::`) ? value : `${floor.id}::${value}`;
  const reference = (value: string | undefined): string | undefined => value ? id(value) : undefined;
  return { ...floor,
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
): MultiSheetApartmentResult {
  const plotWidthMm = rawConfig.plotWidthMm ?? (rawConfig as any).siteWidthMm ?? 50000;
  const plotDepthMm = rawConfig.plotDepthMm ?? (rawConfig as any).siteDepthMm ?? 50000;
  const numTypicalFloors = rawConfig.numTypicalFloors ?? (rawConfig as any).floorCount ?? 4;
  const roadWidthMm = rawConfig.roadWidthMm ?? 12000;
  const roadAccessSides = rawConfig.roadAccessSides ?? [(rawConfig as any).roadFacing ?? Direction.South];
  const lotAllotmentMode = rawConfig.lotAllotmentMode ?? 'STATUTORY_SETBACK_100_PERCENT';
  const jurisdiction = rawConfig.jurisdiction ?? 'pune_pmc';
  const verticalStackType = rawConfig.verticalStackType ?? 'STILT_PLUS_N';
  const flatsPerFloor = rawConfig.flatsPerFloor ?? 4;
  const siteAmenities = rawConfig.siteAmenities ?? DEFAULT_SITE_AMENITIES;
  const stiltAmenities = rawConfig.stiltAmenities ?? DEFAULT_STILT_AMENITIES;
  const terraceAmenities = rawConfig.terraceAmenities ?? DEFAULT_TERRACE_AMENITIES;
  const parkingMode = rawConfig.parkingMode ?? 'STILT_AND_SURFACE';

  const config: MultiSheetApartmentConfig = {
    ...rawConfig,
    plotWidthMm,
    plotDepthMm,
    numTypicalFloors,
    roadWidthMm,
    roadAccessSides,
    lotAllotmentMode,
    jurisdiction,
    verticalStackType,
    flatsPerFloor,
    siteAmenities,
    stiltAmenities,
    terraceAmenities,
    parkingMode,
  };

  const stackParams = computeBuildingStackParameters(config);

  // 1. Calculate Plinth Envelope
  let envelope: Box2D;
  if (config.lotAllotmentMode === 'FULL_LOT_100_PERCENT') {
    envelope = {
      x: 0,
      y: 0,
      w: config.plotWidthMm,
      h: config.plotDepthMm,
    };
  } else {
    const { left, rear, right, front } = config.setbacksMm ?? { left: 3000, rear: 3000, right: 3000, front: 4500 };
    envelope = {
      x: left,
      y: rear,
      w: config.plotWidthMm - left - right,
      h: config.plotDepthMm - rear - front,
    };
  }

  if (envelope.w < 11000 || envelope.h < 11000) throw new Error('The requested setbacks leave too little buildable space for this apartment topology. Increase the plot or reduce the program.');

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
  const topology = selectProductionTopology({
    envelope,
    flatsPerFloor: config.flatsPerFloor,
    unitTypes: (config.units ?? []).map(unit => unit.bhkType),
    aiPrompt: config.aiPrompt,
    seed: config.generationSeed,
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
    residentialSheets.push(solveTypicalFloorSheet(config, envelope, config.verticalStackType === 'G_PLUS_N' ? fl - 1 : fl, topology));
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
    floors: buildingFloors.map(floor => ({ ...floor,
      floorUse: floor.id === terraceSheet.floor.id ? 'ROOF' as const : floor.id === stiltSheet.floor.id ? 'STILT_PARKING' as const : 'RESIDENTIAL' as const,
      elevationMm: floor.id === stiltSheet.floor.id ? 0 : buildingFloors.filter(other => other.level < floor.level && other.id !== terraceSheet.floor.id).reduce((sum, other) => sum + other.floorHeight, 0),
      buildingId: config.projectId ? `building:${config.projectId}` : 'multi_sheet_apartment_building' })),
    metadata: {
      projectId: config.projectId ?? 'apartment_project',
      generationBrief: { source: 'DETERMINISTIC', aiPrompt: config.aiPrompt, referenceImage: config.referenceImage ? { name: config.referenceImage.name, mimeType: config.referenceImage.mimeType } : undefined, units: config.units ?? [] },
      description: `Coordinated 6-Sheet Apartment Project (${config.flatsPerFloor} Flats/Floor, ${config.numTypicalFloors} Floors)`,
      tags: ['apartment', 'multi_sheet', 'udcpr', 'rera', 'canonical_model'],
    },
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const buildingWithFurniture = populateCanonicalFurniture(rawBuilding);

  // Architectural generation defers structure. Only an explicit provisional structural
  // workflow may place the existing column/beam profile; neither profile is certified.
  const deferredStructure = config.structuralLayoutMode !== 'PROVISIONAL_EXISTING_PROFILE';
  const architecturalBuilding = deferredStructure ? { ...buildingWithFurniture, floors: buildingWithFurniture.floors.map(f => ({ ...f, columns: [], beams: [] })), beams: [], metadata: { ...buildingWithFurniture.metadata, tags: [...(buildingWithFurniture.metadata.tags ?? []), 'STRUCTURAL_DESIGN_DEFERRED'] } } : buildingWithFurniture;
  const placedStructure = deferredStructure ? architecturalBuilding : new GeometryValidator().auditAndFixColumnAndBeamGrid(architecturalBuilding, true).building;
  const audit = validateAndRepairBuildingGeometry(placedStructure, { autoCorrect: false });
  const finalFloors = audit.building.floors.map(namespaceFloorEntities);
  const validatedBuilding: Building = withArchitecturalElements(coordinateArchitecturalStairs({ ...audit.building, floors: finalFloors,
    furniture: [...finalFloors.flatMap(floor => floor.furniture ?? []), ...(audit.building.furniture ?? []).filter(item => item.siteZoneId)],
  }));
  const validationReport = { ...audit.report, errors: audit.report.errors.map(error => ({ ...error,
    elementIds: error.elementIds.map(value => value === error.floorId || value.startsWith(`${error.floorId}::`) ? value : `${error.floorId}::${value}`),
  })) };
  const validatedFloorsById = new Map(validatedBuilding.floors.map(f => [f.id, f]));
  const updatedSheets = sheets.map(s => {
    if (s.floor) {
      const updatedFloor = validatedFloorsById.get(s.floor.id);
      return { ...s, floor: updatedFloor ?? namespaceFloorEntities(s.floor) };
    }
    return s;
  });

  return {
    config,
    building: { ...validatedBuilding, metadata: { ...validatedBuilding.metadata,
      bedroomBalconySchedule: bedroomBalconySchedule(validatedBuilding) } },
    sheets: updatedSheets,
    schedule,
    validationReport,
    totalBuildingHeightMm: stackParams.totalBuildingHeightMm,
    hasRefugeFloor: stackParams.requiresRefugeFloor,
    refugeFloorLevels: stackParams.refugeFloorLevels,
  };
}

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
  type Box2D,
  type MacroPartition,
} from '../interpretation/space-filling-snapper';
import type { ApartmentPlanStructure } from '../interpretation/apartment-plan';

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
}): Room {
  const boundary: Polygon = {
    points: [
      { x: params.box.x, y: params.box.y },
      { x: params.box.x + params.box.w, y: params.box.y },
      { x: params.box.x + params.box.w, y: params.box.y + params.box.h },
      { x: params.box.x, y: params.box.y + params.box.h },
    ],
  };

  return {
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
    isPlanarConserved: Math.abs(delta) < 1,
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

// ─── Sheet 2 Solver: STILT_PARKING_PLAN (Delta = 0.000 mm²) ──────────────────

export interface StiltParkingSheetResult {
  readonly floor: Floor;
  readonly carBaysCount: number;
  readonly bikeBaysCount: number;
  readonly audit: SheetLedgerAudit;
}

export function solveStiltParkingSheet(
  _config: MultiSheetApartmentConfig,
  envelope: Box2D,
  macro: MacroPartition,
  stackParams: BuildingStackParameters,
): StiltParkingSheetResult {
  const floorId = 'floor_stilt_00';
  const rooms: Room[] = [];
  const doors: Door[] = [];
  const columns: Column[] = [];

  // 1. Locked Vertical Core (Staircases, Lifts, Lobby, Shafts)
  // Must match typical floor coordinates exactly to the millimeter!
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

  if (macro.stairBoxes[1]) {
    const stair2 = createBoxRoom({
      id: 'stilt__stair_2',
      name: 'Staircase 02 (Fire Escape)',
      type: RoomType.Staircase,
      spaceUse: 'CORE',
      box: macro.stairBoxes[1]!,
      floorId,
      tags: ['core:stair'],
    });
    rooms.push(stair2);
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

  if (macro.liftBoxes[1]) {
    const lift2 = createBoxRoom({
      id: 'stilt__lift_2',
      name: 'Stretcher / Fire Lift 02',
      type: RoomType.Lift,
      spaceUse: 'CORE',
      box: macro.liftBoxes[1]!,
      floorId,
      tags: ['core:lift'],
    });
    rooms.push(lift2);
  }

  const stiltLobby = createBoxRoom({
    id: 'stilt__core_lobby',
    name: 'Stilt Central Lift Lobby',
    type: RoomType.Corridor,
    spaceUse: 'CORE',
    box: macro.lobbyBox,
    floorId,
    tags: ['core:lobby'],
  });
  rooms.push(stiltLobby);

  const stiltCorridor = createBoxRoom({
    id: 'stilt__corridor_spine',
    name: 'Stilt Central Circulation Spine',
    type: RoomType.Corridor,
    spaceUse: 'CORE',
    box: macro.corridorBox,
    floorId,
    tags: ['core:corridor'],
  });
  rooms.push(stiltCorridor);

  for (let s = 0; s < macro.shaftBoxes.length; s++) {
    const shaft = createBoxRoom({
      id: `stilt__shaft_${s + 1}`,
      name: `MEP Service Shaft 0${s + 1}`,
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
    name: 'Society Administrative Office',
    type: RoomType.Custom,
    spaceUse: 'COMMON',
    box: { x: amenityBox.x + amLobbyW, y: amenityBox.y, w: amOfficeW, h: officeH },
    floorId,
  });
  rooms.push(office);

  const staffToilet = createBoxRoom({
    id: 'stilt__staff_toilet',
    name: 'Driver & Maintenance Staff Toilet',
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
    name: 'Fitness Center & Health Gymnasium',
    type: RoomType.Custom,
    spaceUse: 'COMMON',
    box: { x: amenityBox.x + amLobbyW + amOfficeW, y: amenityBox.y, w: amGymW, h: gymH },
    floorId,
  });
  rooms.push(gym);

  const meterRoom = createBoxRoom({
    id: 'stilt__meter_bms_room',
    name: 'Electric Meter & BMS Control Room',
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
    const stallDepth = 5000;
    const stallWidth = 2500;
    const numStalls = Math.floor(box.w / stallWidth);
    const stallsW = numStalls * stallWidth;
    const remW = box.w - stallsW;
    const isDoubleLoaded = box.h >= 13000;

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
      bikeBaysCount += 2;
      rooms.push(
        createBoxRoom({
          id: `stilt__bike_bay_b${String(bikeBaysCount).padStart(2, '0')}`,
          name: `Two-Wheeler Parking Bay B-${String(bikeBaysCount).padStart(2, '0')}`,
          type: RoomType.Parking,
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
        bikeBaysCount += 2;
        rooms.push(
          createBoxRoom({
            id: `stilt__bike_bay_b${String(bikeBaysCount).padStart(2, '0')}`,
            name: `Two-Wheeler Parking Bay B-${String(bikeBaysCount).padStart(2, '0')}`,
            type: RoomType.Parking,
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
          name: `Stilt Vehicular Driveway & Maneuvering Aisle (${zoneKey})`,
          type: RoomType.Corridor,
          spaceUse: 'COMMON',
          box: { x: box.x, y: box.y + stallDepth, w: box.w, h: driveH },
          floorId,
        }),
      );
    }
  };

  // Pack Zone A (West South)
  const parkBoxA: Box2D = { x: westBox.x, y: westBox.y + amenityH, w: westBox.w, h: westParkH };
  packParkingBox(parkBoxA, 'west');

  // Pack Zone B (East Wing flatBoxes)
  for (let fb = 1; fb < macro.flatBoxes.length; fb++) {
    const eastBox = macro.flatBoxes[fb]!;
    packParkingBox(eastBox, `east_0${fb}`);
  }

  // 4. Generate Stilt Floor Walls
  const stiltBoundary = rectPolygon(envelope.x, envelope.y, envelope.w, envelope.h);
  const walls = generateApartmentWalls(rooms, floorId, stiltBoundary);

  // 5. Host-fitting Open Passage Walkthrough for Staircase 01 (Clean 1200mm, Zero Swinging Door)
  const dStair1 = createConnectingDoor('door_stilt_stair1', roomToBox(stiltLobby), roomToBox(stair1), 1200, { doorType: 'open_passage' });
  if (dStair1) {
    doors.push({
      id: dStair1.id,
      floorId,
      wallId: `apt-wall:stair1`,
      position: { x: snap10(dStair1.rect.x + dStair1.rect.width / 2), y: snap10(dStair1.rect.y + dStair1.rect.height / 2) },
      width: 1200,
      height: 2100,
      type: DoorType.OpenPassage,
      swingDirection: SwingDirection.Inward,
      connectsRooms: [stiltLobby.id, stair1.id],
    });
  }

  const dLobbyCorr = createConnectingDoor('door_stilt_lobby_corr', roomToBox(stiltLobby), roomToBox(stiltCorridor), 1500, { doorType: 'open_passage' });
  if (dLobbyCorr) {
    doors.push({
      id: dLobbyCorr.id,
      floorId,
      wallId: `apt-wall:lobby_corr`,
      position: { x: snap10(dLobbyCorr.rect.x + dLobbyCorr.rect.width / 2), y: snap10(dLobbyCorr.rect.y + dLobbyCorr.rect.height / 2) },
      width: 1500,
      height: 2100,
      type: DoorType.OpenPassage,
      swingDirection: SwingDirection.Inward,
      connectsRooms: [stiltLobby.id, stiltCorridor.id],
    });
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
  columns.push(...deriveCleanStructuralColumns(tempFloor, envelope));

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
    isPlanarConserved: Math.abs(ledger.delta) < 1 && ledger.unassigned === 0,
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
): TypicalFloorSheetResult {
  const floorId = floorLevel === 1 ? 'floor_typical_01' : `floor_level_${String(floorLevel).padStart(2, '0')}`;
  const floorName = floorLevel === 1 ? '1ST_FLOOR_PLAN'
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

  const structure = solveOrthogonalSpaceFillingApartment({
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
    r: { id: string; name: string; type?: string; rect: { x: number; y: number; width: number; height: number }; planningZone?: 'PUBLIC' | 'PRIVATE' | 'SERVICE' | 'OUTDOOR' },
    defaultType: RoomType,
    unitId?: string,
  ) => {
    const rType = (r.type ?? defaultType) as RoomType;
    rooms.push(
      createBoxRoom({
        id: `apt-room:${r.id}`,
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
  const walls = generateApartmentWalls(rooms, floorId, boundary);
  const doors: Door[] = [];
  const windows: Window[] = [];

  for (const op of structure.openings) {
    const hostWall = walls.find(w =>
      openingFitsApartmentWall(
        w,
        { x: snap10(op.rect.x + op.rect.width / 2), y: snap10(op.rect.y + op.rect.height / 2) },
        Math.max(op.rect.width, op.rect.height),
      ),
    );
    if (hostWall) {
      doors.push({
        id: op.id,
        floorId,
        wallId: hostWall.id,
        position: { x: snap10(op.rect.x + op.rect.width / 2), y: snap10(op.rect.y + op.rect.height / 2) },
        width: Math.max(op.rect.width, op.rect.height),
        height: 2100,
        type: op.doorType === 'sliding' ? DoorType.Sliding : op.doorType === 'open_passage' ? DoorType.OpenPassage : DoorType.Single,
        swingDirection: SwingDirection.Inward,
        connectsRooms: [op.connects?.[0] ? `apt-room:${op.connects[0]}` : '', op.connects?.[1] ? `apt-room:${op.connects[1]}` : ''] as never,
      });
      (hostWall as { hasOpening: boolean }).hasOpening = true;
    }
  }

  // Windows along exterior envelope walls
  for (const r of rooms) {
    if (r.spaceUse === 'OUTDOOR' || r.type === RoomType.ServiceShaft) continue;
    const extWalls = walls.filter(w => w.wallUse === 'EXTERNAL' && w.roomIds.includes(r.id));
    if (extWalls.length > 0) {
      const hw = extWalls[0]!;
      const winW = 1200;
      const winPos = {
        x: snap10((hw.startPoint.x + hw.endPoint.x) / 2),
        y: snap10((hw.startPoint.y + hw.endPoint.y) / 2),
      };
      if (openingFitsApartmentWall(hw, winPos, winW)) {
        windows.push({
          id: `win_${r.id}`,
          floorId,
          wallId: hw.id,
          position: winPos,
          width: winW,
          height: 1200,
          sillHeight: 900,
          type: WindowType.Sliding,
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
  const ledger = measureApartmentAreaLedger(floor);
  const audit: SheetLedgerAudit = {
    sheetId: floorLevel === 1 ? 'sheet_03_typical_plan' : `sheet_03_level_${floorLevel}_plan`,
    sheetName: `Sheet 03: ${flOrdinal} Residential Floor Plan`,
    grossAreaMm2: ledger.gross,
    accountedAreaMm2: ledger.accounted,
    deltaMm2: ledger.delta,
    unassignedMm2: ledger.unassigned,
    isPlanarConserved: Math.abs(ledger.delta) < 1 && ledger.unassigned === 0,
  };

  return { floor, structure, audit };
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
  const origBalcony = baseFloor.rooms.find(r => r.id.includes('flat_01__balcony') || (r.spaceUse === 'OUTDOOR' && r.unitId === 'flat_01'));
  const origLiving = baseFloor.rooms.find(r => r.unitId === 'flat_01' && r.type === RoomType.Living);

  let deltaD = 0;
  if (origBalcony && origLiving && origBalcony.area < 15_000_000) {
    deltaD = snap10(Math.ceil((15_500_000 - origBalcony.area) / origBalcony.width));
  }

  // Clone rooms and convert exterior balcony of Flat 01 into Statutory Fire Refuge Terrace (>= 15 m²)
  const rooms: Room[] = baseFloor.rooms.map(r => {
    if (origBalcony && (r.id === origBalcony.id || r.id.includes('flat_01__balcony'))) {
      const isNorth = origLiving ? origBalcony.y <= origLiving.y : true;
      const refY = isNorth ? origBalcony.y : origBalcony.y - deltaD;
      const refH = origBalcony.height + deltaD;
      return createBoxRoom({
        id: `refuge_terrace_${refugeLevel}`,
        name: 'Statutory Fire Refuge Terrace (>= 15 m²)',
        type: RoomType.Balcony,
        spaceUse: 'OUTDOOR',
        planningZone: 'OUTDOOR',
        box: { x: origBalcony.x, y: refY, w: origBalcony.width, h: refH },
        floorId,
        unitId: 'flat_01',
        tags: ['refuge:terrace', 'fire_safety'],
      });
    }
    if (origLiving && r.id === origLiving.id && deltaD > 0) {
      const isNorth = origBalcony ? origBalcony.y <= origLiving.y : true;
      const livY = isNorth ? origLiving.y + deltaD : origLiving.y;
      const livH = origLiving.height - deltaD;
      return createBoxRoom({
        id: origLiving.id,
        name: origLiving.name,
        type: origLiving.type,
        spaceUse: origLiving.spaceUse,
        planningZone: origLiving.planningZone,
        box: { x: origLiving.x, y: livY, w: origLiving.width, h: livH },
        floorId,
        unitId: 'flat_01',
        tags: [...origLiving.tags],
      });
    }
    return { ...r, floorId };
  });

  const walls = generateApartmentWalls(rooms, floorId, baseFloor.boundary);
  const doors = baseFloor.doors.map(d => ({ ...d, floorId }));

  // Add 1050 mm Fire Exit Door connecting Flat 01 Living Room to Fire Refuge Terrace
  const refugeRoom = rooms.find(r => r.tags.includes('refuge:terrace'));
  if (refugeRoom) {
    const living = rooms.find(r => r.unitId === 'flat_01' && r.type === RoomType.Living);
    if (living) {
      const dRefuge = createConnectingDoor(`door_refuge_${refugeLevel}`, roomToBox(living), roomToBox(refugeRoom), 1050, { isFlatEntrance: true });
      if (dRefuge) {
        doors.push({
          id: dRefuge.id,
          floorId,
          wallId: `apt-wall:refuge`,
          position: { x: snap10(dRefuge.rect.x + dRefuge.rect.width / 2), y: snap10(dRefuge.rect.y + dRefuge.rect.height / 2) },
          width: 1050,
          height: 2100,
          type: DoorType.Single,
          swingDirection: SwingDirection.Outward,
          connectsRooms: [living.id, refugeRoom.id],
        });
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
    isPlanarConserved: Math.abs(ledger.delta) < 1 && ledger.unassigned === 0,
  };

  return { floor, refugeAreaM2, audit };
}

// ─── Sheet 5 Solver: TERRACE_PLAN (Delta = 0.000 mm²) ────────────────────────

export interface TerraceSheetResult {
  readonly floor: Floor;
  readonly audit: SheetLedgerAudit;
}

export function solveTerraceSheet(
  _config: MultiSheetApartmentConfig,
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
    type: RoomType.Staircase,
    spaceUse: 'CORE',
    box: macro.stairBoxes[0]!,
    floorId,
    tags: ['terrace:core'],
  });
  rooms.push(mumty1);

  if (macro.stairBoxes[1]) {
    const mumty2 = createBoxRoom({
      id: 'terrace__stair_mumty_2',
      name: 'Staircase 02 Mumty & Fire Escape Headroom',
      type: RoomType.Staircase,
      spaceUse: 'CORE',
      box: macro.stairBoxes[1]!,
      floorId,
      tags: ['terrace:core'],
    });
    rooms.push(mumty2);
  }

  // Lift Machine Room (LMR) over Lifts
  const lmr1 = createBoxRoom({
    id: 'terrace__lift_machine_room_1',
    name: 'Lift Machine Room 01 (LMR)',
    type: RoomType.Custom,
    spaceUse: 'CORE',
    box: macro.liftBoxes[0]!,
    floorId,
    tags: ['terrace:core'],
  });
  rooms.push(lmr1);

  if (macro.liftBoxes[1]) {
    const lmr2 = createBoxRoom({
      id: 'terrace__lift_machine_room_2',
      name: 'Lift Machine Room 02 (LMR)',
      type: RoomType.Custom,
      spaceUse: 'CORE',
      box: macro.liftBoxes[1]!,
      floorId,
      tags: ['terrace:core'],
    });
    rooms.push(lmr2);
  }

  // Overhead Water Tank (OHWT) over Central Lobby & Core
  const ohwt = createBoxRoom({
    id: 'terrace__ohwt_tank',
    name: 'Overhead Water Tank (OHWT — Domestic & Fire Reserve)',
    type: RoomType.Custom,
    spaceUse: 'SERVICE',
    box: macro.lobbyBox,
    floorId,
    tags: ['terrace:core'],
  });
  rooms.push(ohwt);

  // Central Roof Terrace Passage
  const roofCorr = createBoxRoom({
    id: 'terrace__corridor_vestibule',
    name: 'Terrace Access Vestibule',
    type: RoomType.Corridor,
    spaceUse: 'COMMON',
    box: macro.corridorBox,
    floorId,
    tags: ['terrace:core'],
  });
  rooms.push(roofCorr);

  // Covered Weatherproof MEP Skylights over shafts
  for (let s = 0; s < macro.shaftBoxes.length; s++) {
    rooms.push(
      createBoxRoom({
        id: `terrace__shaft_head_${s + 1}`,
        name: `Covered MEP Duct Vent Head 0${s + 1}`,
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
  const walls = generateApartmentWalls(rooms, floorId, terraceBoundary);

  // 5. Door from Stair Mumty to Open Terrace
  const dMumty = createConnectingDoor('door_terrace_mumty', roomToBox(mumty1), roomToBox(roofCorr), 1050);
  if (dMumty) {
    doors.push({
      id: dMumty.id,
      floorId,
      wallId: `apt-wall:mumty`,
      position: { x: snap10(dMumty.rect.x + dMumty.rect.width / 2), y: snap10(dMumty.rect.y + dMumty.rect.height / 2) },
      width: 1050,
      height: 2100,
      type: DoorType.Single,
      swingDirection: SwingDirection.Outward,
      connectsRooms: [mumty1.id, roofCorr.id],
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
    isPlanarConserved: Math.abs(ledger.delta) < 1 && ledger.unassigned === 0,
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

// ─── Master Engine: solveMultiSheetApartmentProject ──────────────────────────

export function solveMultiSheetApartmentProject(
  rawConfig: MultiSheetApartmentConfig,
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
    const left = 3000;
    const rear = 3000;
    const right = 3000;
    const front = 4500;
    envelope = {
      x: left,
      y: rear,
      w: Math.max(12000, config.plotWidthMm - left - right),
      h: Math.max(12000, config.plotDepthMm - rear - front),
    };
  }

  // 2. Resolve Macro Partitioning (Anchored directly onto space-filling-snapper)
  const macro = partitionMacroFootprint(envelope, config.flatsPerFloor);

  // 3. Solve Sheet 1: SITE_PLAN
  const siteSheet = solveSitePlanSheet(config, envelope);

  // 4. Solve Sheet 2: STILT_PARKING_PLAN
  const stiltSheet = solveStiltParkingSheet(config, envelope, macro, stackParams);

  // 5. Solve Residential Floor Sheets (1st Floor to Nth Floor)
  const numFloors = Math.max(1, config.numTypicalFloors ?? 4);
  const residentialSheets: TypicalFloorSheetResult[] = [];
  for (let fl = 1; fl <= numFloors; fl++) {
    residentialSheets.push(solveTypicalFloorSheet(config, envelope, fl));
  }
  const typicalSheet = residentialSheets[0]!;

  // 6. Solve Sheet 4: COLUMN_SCHEDULE_PLAN
  const columnScheduleSheet = solveStructuralColumnScheduleSheet(typicalSheet, envelope);

  // 7. Solve Sheet 5: REFUGE_FLOOR_PLAN (mandatory when height > 24m)
  let refugeSheet: RefugeFloorSheetResult | undefined;
  if (stackParams.requiresRefugeFloor && stackParams.refugeFloorLevels.length > 0) {
    const primaryRefugeLevel = stackParams.refugeFloorLevels[0]!;
    refugeSheet = solveRefugeFloorSheet(typicalSheet, primaryRefugeLevel);
  }

  // 8. Solve Sheet 6: TERRACE_PLAN
  const terraceLevel = config.numTypicalFloors + 1;
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
        isPlanarConserved: schedule.overallDeltaMm2 < 1,
      },
    },
  ];

  // 11. Assemble Complete Multi-Floor Canonical Building
  const buildingFloors: Floor[] = [
    stiltSheet.floor,
    ...residentialSheets.map(s => s.floor),
    columnScheduleSheet.floor,
    ...(refugeSheet ? [refugeSheet.floor] : []),
    terraceSheet.floor,
  ];

  const rawBuilding: Building = {
    id: 'multi_sheet_apartment_building',
    projectId: 'apartment_project',
    name: 'Coordinated Multi-Sheet Indian Residential Apartment',
    site: siteSheet.site,
    floors: buildingFloors,
    metadata: {
      projectId: 'apartment_project',
      description: `Coordinated 6-Sheet Apartment Project (${config.flatsPerFloor} Flats/Floor, ${config.numTypicalFloors} Floors)`,
      tags: ['apartment', 'multi_sheet', 'udcpr', 'rera', 'canonical_model'],
    },
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const building = populateCanonicalFurniture(rawBuilding);
  const furnishedFloorsById = new Map(building.floors.map(f => [f.id, f]));
  const updatedSheets = sheets.map(s => {
    if (s.floor) {
      const updatedFloor = furnishedFloorsById.get(s.floor.id);
      return updatedFloor ? { ...s, floor: updatedFloor } : s;
    }
    return s;
  });

  return {
    config,
    building,
    sheets: updatedSheets,
    schedule,
    totalBuildingHeightMm: stackParams.totalBuildingHeightMm,
    hasRefugeFloor: stackParams.requiresRefugeFloor,
    refugeFloorLevels: stackParams.refugeFloorLevels,
  };
}

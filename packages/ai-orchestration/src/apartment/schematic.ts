/**
 * Deterministic Apartment Schematic Engine (§13–§18).
 *
 * Implements:
 * - Deterministic mathematical schematic generated BEFORE FLUX is called.
 * - Generalized multi-unit layout (2–8 flats) for any unit mix (1BHK, 2BHK, 3BHK, 4BHK).
 * - Exact flat count (schematic.units.length === flatsPerFloor).
 * - Clear zoning (public / service / private), real door swings, and spatial relationship graph:
 *   LOBBY -> ENTRANCE -> FOYER -> LIVING/DINING -> PASSAGE -> BEDROOMS.
 * - Common core: lobby, passenger/service lifts, stairs, service shafts.
 * - Technical SVG scaffold with distinct flat colours, room tags, and dimension stamps.
 */

import { type ApartmentRulesProfile } from './jurisdiction';
import {
  type ApartmentUnitType,
  type UnitTypologyAllocationResult,
  allocateApartmentUnitSpaces,
} from './typologies';
import { type ApartmentFloorType } from './floor-configuration';
import { getUnitProgram } from './program-registry';
import { DEFAULT_APARTMENT_SETBACKS_M } from './site-defaults';
import { generateCoreConfigurations } from './core-optimizer.js';
import { solveApartmentEnvelopes, type SolvedFloorPlateAllocation } from './envelope-solver.js';
import { solveUnitTopology, type SolvedUnitRoom } from './unit-topology-solver.js';
import {
  type ApartmentLayoutStrategy,
  type FloorAreaBalance,
  type LayoutBand,
  type LayoutZone,
  type PlannedDoor,
  type PlannedRoom,
  type SpatialCheck,
  type SpatialGraphEdge,
  type SpatialGraphNode,
  type UnitAreaReport,
  planApartmentLayout,
} from './layout-planner';

export interface Rect2D {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SchematicRoomItem {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly bounds: Rect2D;
  /** Actual drawn area (m²). */
  readonly areaSqM: number;
  /** Typology target area (m²); 0 for planner-added passage/store/dressing. */
  readonly targetAreaSqM?: number;
  readonly isEnsuite?: boolean;
  readonly hasBalcony?: boolean;
  readonly zone?: LayoutZone;
  readonly band?: LayoutBand;
  readonly onFacade?: boolean;
  readonly ensuiteOf?: string;
  readonly hostRoomId?: string;
}

export interface SchematicApartmentUnit {
  readonly flatId: string;
  readonly flatLabel: string;
  readonly unitType: ApartmentUnitType;
  /** Target carpet area from the typology allocation (the requirement). */
  readonly carpetAreaSqM: number;
  /** Carpet area actually drawn (rooms + balconies). */
  readonly actualCarpetAreaSqM: number;
  readonly builtUpAreaSqM: number;
  /** Flat boundary including balcony projections. */
  readonly bounds: Rect2D;
  /** Enclosed flat body (excludes balcony projections). */
  readonly bodyBounds: Rect2D;
  readonly entrancePoint: { readonly x: number; readonly y: number };
  readonly entranceDoorId: string | null;
  readonly rooms: readonly SchematicRoomItem[];
  readonly balconies: readonly SchematicRoomItem[];
  readonly allocationDetails: UnitTypologyAllocationResult;
}

export interface SchematicLiftItem {
  readonly id: string;
  readonly label: string;
  readonly type: 'passenger' | 'service';
  readonly bounds: Rect2D;
  readonly capacityPersons: number;
}

export interface SchematicStairItem {
  readonly id: string;
  readonly label: string;
  readonly bounds: Rect2D;
  readonly widthM: number;
  readonly type: 'main' | 'fire_escape';
}

export interface SchematicCommonCore {
  readonly bounds: Rect2D;
  readonly lobby: { readonly bounds: Rect2D; readonly label: string };
  readonly corridors: ReadonlyArray<{ readonly bounds: Rect2D; readonly label: string }>;
  readonly lifts: readonly SchematicLiftItem[];
  readonly stairs: readonly SchematicStairItem[];
  readonly serviceShafts: ReadonlyArray<{ readonly bounds: Rect2D; readonly label: string }>;
  readonly totalCoreAreaSqM: number;
}

/** Door objects are canonical: type / width / swing are editable downstream. */
export type SchematicDoor = PlannedDoor;
export type SchematicSpatialCheck = SpatialCheck;

export interface DeterministicApartmentSchematic {
  readonly siteFootprint: Rect2D;
  /** Bounding box of the built plate (flats + balconies + core). */
  readonly buildingFootprint: Rect2D;
  readonly setbacks: {
    readonly front: number;
    readonly rear: number;
    readonly left: number;
    readonly right: number;
  };
  readonly floorType: ApartmentFloorType;
  readonly flatCount: number;
  readonly unitMixSummary: string;
  readonly core: SchematicCommonCore;
  readonly units: readonly SchematicApartmentUnit[];
  readonly totalFloorPlateSqM: number;
  readonly totalNetResidentialSqM: number;
  readonly svgScaffold: string;
  readonly schematicSvg?: string;
  /** Layout strategy this schematic was planned with. */
  readonly strategy: ApartmentLayoutStrategy;
  readonly doors: readonly SchematicDoor[];
  readonly spatialGraph: { readonly nodes: readonly SpatialGraphNode[]; readonly edges: readonly SpatialGraphEdge[] };
  readonly spatialChecks: readonly SchematicSpatialCheck[];
  readonly areaReport: { readonly units: readonly UnitAreaReport[]; readonly floor: FloorAreaBalance };
  /** false => FEASIBILITY FAIL: the programme does not fit the buildable envelope. */
  readonly layoutFits: boolean;
  readonly layoutIssues: readonly string[];
  /** Deterministic compaction applied to fit the envelope (requirements unchanged). */
  readonly layoutAdaptations: readonly string[];
}

export interface GenerateSchematicOptions {
  readonly siteWidthM: number;
  readonly siteDepthM: number;
  readonly setbacksM?: { front: number; rear: number; left: number; right: number };
  readonly flatsPerFloor: number;
  readonly unitMix: ReadonlyArray<{
    unitType: ApartmentUnitType | string;
    count: number;
    carpetAreaSqFt?: number;
    carpetAreaSqM?: number;
  }>;
  readonly commonCoreConfig?: {
    passengerLifts?: number;
    serviceLifts?: number;
    staircaseCount?: number;
    commonLobby?: boolean;
  };
  readonly floorType?: ApartmentFloorType;
  readonly rulesProfile: ApartmentRulesProfile;
  /** Controlled concept strategy (default: balanced). */
  readonly strategy?: ApartmentLayoutStrategy;
  readonly topologyFamily?: import('./topology-library.js').ApartmentTopologyFamily;
  readonly solverMode?: 'envelope_topology' | 'zoned_planner';
}

/**
 * Creates the deterministic apartment schematic for one layout strategy.
 */
export function generateDeterministicApartmentSchematic(
  options: GenerateSchematicOptions,
): DeterministicApartmentSchematic {
  const {
    siteWidthM,
    siteDepthM,
    flatsPerFloor,
    commonCoreConfig = {},
    floorType = 'typical',
    rulesProfile,
    strategy = 'balanced',
    topologyFamily,
    solverMode,
  } = options;

  const unitMix = options.unitMix.map(u => ({...u,unitType:u.unitType.toUpperCase()}));
  if(!Number.isFinite(siteWidthM)||!Number.isFinite(siteDepthM)||siteWidthM<=0||siteDepthM<=0)throw new Error('MISSING_REQUIRED_PROJECT_INPUT: valid site dimensions');
  if(!Number.isInteger(flatsPerFloor)||flatsPerFloor<1||unitMix.some(u=>!Number.isInteger(u.count)||u.count<=0)||unitMix.reduce((n,u)=>n+u.count,0)!==flatsPerFloor)throw new Error('UNIT_COUNT_MISMATCH: unit schedule must match flatsPerFloor');
  if(unitMix.some(u=>!['1BHK','2BHK','3BHK','4BHK'].includes(u.unitType)))throw new Error('UNSUPPORTED_UNIT_TYPE');
  const setbacks = options.setbacksM ?? DEFAULT_APARTMENT_SETBACKS_M;

  // 1. Buildable envelope (global metres; y measured from the rear boundary).
  const buildableWidthM = Math.max(0, siteWidthM - setbacks.left - setbacks.right);
  const buildableDepthM = Math.max(0, siteDepthM - setbacks.front - setbacks.rear);
  const buildable: Rect2D = { x: setbacks.left, y: setbacks.rear, width: buildableWidthM, height: buildableDepthM };

  // 2. Expand the unit mix into the exact flat list (§13, §14).
  const flattenedFlats: Array<{
    flatLabel: string;
    unitType: ApartmentUnitType;
    targetCarpetAreaSqM?: number;
    targetCarpetAreaSqFt?: number;
  }> = [];
  let flatIndex = 1;
  for (const mixItem of unitMix) {
    const count = mixItem.count;
    for (let c = 0; c < count; c++) {
      if (flattenedFlats.length < flatsPerFloor) {
        flattenedFlats.push({
          flatLabel: `Flat ${String(flatIndex).padStart(2, '0')}`,
          unitType: mixItem.unitType as ApartmentUnitType,
          targetCarpetAreaSqM: mixItem.carpetAreaSqM,
          targetCarpetAreaSqFt: mixItem.carpetAreaSqFt,
        });
        flatIndex++;
      }
    }
  }
  const finalFlats = flattenedFlats;

  // 3. Core counts
  const passengerLifts = commonCoreConfig.passengerLifts ?? rulesProfile.liftRequirements.minPassengerLifts;
  const liftCount = Math.max(1, passengerLifts + (commonCoreConfig.serviceLifts ?? 0));
  const stairCount = Math.max(1, commonCoreConfig.staircaseCount ?? (rulesProfile.stairRequirements.secondStaircaseRequired ? 2 : 1));

  // 3.5 Envelope Topology Solver Path (§4, §5, §18)
  const is3x3Bhk = finalFlats.length === 3 && finalFlats.every(f => f.unitType.toUpperCase() === '3BHK');
  const shouldUseEnvelopeSolver =
    solverMode === 'envelope_topology' ||
    topologyFamily !== undefined ||
    is3x3Bhk;

  if (shouldUseEnvelopeSolver && finalFlats.length >= 2 && finalFlats.length <= 8) {
    return buildApartmentSchematic({
      siteWidthM,
      siteDepthM,
      buildable,
      setbacks,
      floorType,
      flats: finalFlats,
      liftCount,
      stairCount,
      strategy,
      rulesProfile,
      topologyFamily,
    });
  }

  // 4. Fallback layout planner for single-unit or out-of-range configurations
  const plan = planApartmentLayout({
    buildable,
    flats: finalFlats.map(flat => ({
      flatId: flat.flatLabel.toLowerCase().replace(/\s+/g, '_'),
      flatLabel: flat.flatLabel,
      unitType: flat.unitType,
      allocation: allocateApartmentUnitSpaces({
        unitType: flat.unitType,
        flatLabel: flat.flatLabel,
        targetCarpetAreaSqM: flat.targetCarpetAreaSqM,
        targetCarpetAreaSqFt: flat.targetCarpetAreaSqFt,
        rulesProfile,
      }),
    })),
    liftCount,
    stairCount,
    strategy,
    rulesProfile,
  });

  const toRoomItem = (room: PlannedRoom): SchematicRoomItem => ({
    id: room.id,
    name: room.name,
    type: room.type,
    bounds: room.bounds,
    areaSqM: room.areaSqM,
    targetAreaSqM: room.targetAreaSqM,
    ...(room.isEnsuite !== undefined ? { isEnsuite: room.isEnsuite } : {}),
    ...(room.hasBalcony !== undefined ? { hasBalcony: room.hasBalcony } : {}),
    zone: room.zone,
    band: room.band,
    onFacade: room.onFacade,
    ...(room.ensuiteOf ? { ensuiteOf: room.ensuiteOf } : {}),
    ...(room.hostRoomId ? { hostRoomId: room.hostRoomId } : {}),
  });

  const units: SchematicApartmentUnit[] = plan.units.map(u => {
    const report = plan.areaReport.units.find(r => r.flatId === u.flatId);
    return {
      flatId: u.flatId,
      flatLabel: u.flatLabel,
      unitType: u.unitType,
      carpetAreaSqM: u.allocation.targetCarpetAreaSqM,
      actualCarpetAreaSqM: report?.actualCarpetSqM ?? 0,
      builtUpAreaSqM: u.allocation.targetBuiltUpAreaSqM,
      bounds: u.bounds,
      bodyBounds: u.body,
      entrancePoint: u.entrancePoint,
      entranceDoorId: u.entranceDoorId,
      rooms: u.rooms.map(toRoomItem),
      balconies: u.balconies.map(toRoomItem),
      allocationDetails: u.allocation,
    };
  });

  const lifts: SchematicLiftItem[] = plan.core.lifts.map((l, i) => ({
    id: l.id,
    label: l.label,
    type: i < passengerLifts ? 'passenger' : 'service',
    capacityPersons: 10,
    bounds: l.bounds,
  }));
  const stairs: SchematicStairItem[] = plan.core.stairs.map((s, i) => ({
    id: s.id,
    label: s.label,
    widthM: rulesProfile.stairRequirements.minWidthM,
    type: i === 0 ? 'main' : 'fire_escape',
    bounds: s.bounds,
  }));
  const serviceShafts = plan.core.shafts.map(s => ({ label: s.label, bounds: s.bounds }));
  const corridors: Array<{ bounds: Rect2D; label: string }> = [];
  const lobbyBounds = plan.core.lobby.bounds;
  const floor = plan.areaReport.floor;
  const totalCoreAreaSqM = Number((floor.coreSqM + floor.lobbySqM).toFixed(2));

  const totalNetResidentialSqM = Number(units.reduce((sum, u) => sum + u.carpetAreaSqM, 0).toFixed(2));
  const unitMixSummary = finalFlats.map(f => `${f.flatLabel} (${f.unitType})`).join(', ');

  const svgScaffold = generateSchematicSvg({
    siteWidthM,
    siteDepthM,
    buildingFootprint: plan.footprint,
    lifts,
    stairs,
    lobbyBounds,
    serviceShafts,
    units,
    doors: plan.doors,
    flatsPerFloor: finalFlats.length,
    unitMixSummary,
    strategy,
  });

  return {
    siteFootprint: { x: 0, y: 0, width: siteWidthM, height: siteDepthM },
    buildingFootprint: plan.footprint,
    setbacks,
    floorType,
    flatCount: finalFlats.length,
    unitMixSummary,
    core: {
      bounds: plan.core.bounds,
      lobby: { bounds: lobbyBounds, label: 'COMMON LOBBY' },
      corridors,
      lifts,
      stairs,
      serviceShafts,
      totalCoreAreaSqM,
    },
    units,
    totalFloorPlateSqM: Number((floor.unitsSqM + floor.coreSqM + floor.lobbySqM).toFixed(2)),
    totalNetResidentialSqM,
    svgScaffold,
    schematicSvg: svgScaffold,
    strategy,
    doors: plan.doors,
    spatialGraph: plan.graph,
    spatialChecks: plan.checks,
    areaReport: plan.areaReport,
    layoutFits: plan.fits,
    layoutIssues: plan.issues,
    layoutAdaptations: plan.adaptations,
  };
}

/**
 * Builds generalized schematic from envelope allocation for any flat count (2–8).
 */
export function buildApartmentSchematic(options: {
  siteWidthM: number;
  siteDepthM: number;
  buildable: Rect2D;
  setbacks: { front: number; rear: number; left: number; right: number };
  floorType: ApartmentFloorType;
  flats: Array<{ flatLabel: string; unitType: ApartmentUnitType; targetCarpetAreaSqM?: number; targetCarpetAreaSqFt?: number }>;
  liftCount: number;
  stairCount: number;
  strategy: ApartmentLayoutStrategy;
  rulesProfile: ApartmentRulesProfile;
  topologyFamily?: import('./topology-library.js').ApartmentTopologyFamily;
  allocation?: SolvedFloorPlateAllocation;
}): DeterministicApartmentSchematic {
  const {
    siteWidthM,
    siteDepthM,
    buildable,
    setbacks,
    floorType,
    flats,
    liftCount,
    stairCount,
    strategy,
    rulesProfile,
    topologyFamily,
  } = options;

  const centerPoint = {
    x: buildable.x + buildable.width / 2,
    y: buildable.y + buildable.height / 2,
  };

  const coreConfigs = generateCoreConfigurations(centerPoint, liftCount, stairCount);
  const initialCoreConfig = coreConfigs[0]!;

  const allocation = options.allocation ?? solveApartmentEnvelopes({
    buildableWidthM: buildable.width,
    buildableDepthM: buildable.height,
    buildableOriginM: {x:buildable.x,y:buildable.y},
    targetCarpetSqFtPerUnit: flats[0]?.targetCarpetAreaSqFt ?? 1100,
    strategy,
    coreConfig: initialCoreConfig,
    topologyFamily,
    units: flats.map((f, i) => ({
      unitId: `FLAT_${String(i + 1).padStart(2, '0')}`,
      unitType: f.unitType,
      targetBedrooms: getUnitProgram(f.unitType).targetBedrooms,
      targetBathrooms: getUnitProgram(f.unitType).targetBathrooms,
      targetCarpetAreaSqFt: f.targetCarpetAreaSqFt ?? (f.targetCarpetAreaSqM!==undefined?f.targetCarpetAreaSqM/0.092903:getUnitProgram(f.unitType).defaultCarpetAreaSqFt),
      targetCarpetAreaSqM: f.targetCarpetAreaSqM ?? getUnitProgram(f.unitType).defaultCarpetAreaSqM,
      mandatoryRooms: getUnitProgram(f.unitType).mandatoryRooms,
    })),
  });

  const coreConfig = allocation.core;
  const unitTopologies = allocation.envelopes.map(env => solveUnitTopology(env));

  const units: SchematicApartmentUnit[] = unitTopologies.map((u, i) => {
    const flatRef = flats[i]!;
    const alloc = allocateApartmentUnitSpaces({
      unitType: flatRef.unitType,
      flatLabel: flatRef.flatLabel,
      targetCarpetAreaSqM: flatRef.targetCarpetAreaSqM,
      targetCarpetAreaSqFt: flatRef.targetCarpetAreaSqFt,
      rulesProfile,
    });

    const toItem = (r: SolvedUnitRoom): SchematicRoomItem => ({
      id: r.id,
      name: r.name,
      type: r.type,
      bounds: r.bounds,
      areaSqM: r.areaSqM,
      targetAreaSqM: r.areaSqM,
      zone: r.zone,
      onFacade: r.onFacade,
      isEnsuite: r.isEnsuite,
      hasBalcony: r.hasBalcony,
      ensuiteOf: r.ensuiteOf,
      hostRoomId: r.hostRoomId,
    });

    return {
      flatId: u.unitId.toLowerCase(),
      flatLabel: u.label,
      unitType: u.unitType as ApartmentUnitType,
      carpetAreaSqM: alloc.targetCarpetAreaSqM,
      actualCarpetAreaSqM: u.actualCarpetAreaSqM,
      builtUpAreaSqM: u.actualBuiltUpAreaSqM,
      bounds: u.boundary,
      bodyBounds: u.boundary,
      entrancePoint: u.entrancePoint,
      entranceDoorId: u.doors.find(d => d.kind === 'flat_entrance')?.id ?? null,
      rooms: u.rooms.filter(r => r.zone !== 'OUTDOOR').map(toItem),
      balconies: u.rooms.filter(r => r.zone === 'OUTDOOR').map(toItem),
      allocationDetails: alloc,
    };
  });

  const lifts: SchematicLiftItem[] = coreConfig.liftBank.lifts.map((l, i) => ({
    id: l.id,
    label: l.label,
    type: i === 0 ? 'passenger' : 'service',
    capacityPersons: 10,
    bounds: l.bounds,
  }));

  const stairs: SchematicStairItem[] = coreConfig.stairs.map((s, i) => ({
    id: s.id,
    label: s.label,
    widthM: rulesProfile.stairRequirements.minWidthM,
    type: i === 0 ? 'main' : 'fire_escape',
    bounds: s.bounds,
  }));

  const serviceShafts = coreConfig.shafts.map(s => ({ label: 'SHAFT', bounds: s.bounds }));
  const lobbyBounds = coreConfig.lobbyBounds;

  const doorBounds = (center: { x: number; y: number }, widthM: number, wallAxis: 'x' | 'y'): Rect2D => {
    const t = 0.2;
    return wallAxis === 'x'
      ? { x: center.x - widthM / 2, y: center.y - t / 2, width: widthM, height: t }
      : { x: center.x - t / 2, y: center.y - widthM / 2, width: t, height: widthM };
  };

  const doors: SchematicDoor[] = [
    ...unitTopologies.flatMap(u =>
      u.doors.map(d => ({
        id: d.id,
        flatId: u.unitId.toLowerCase(),
        connects: [d.fromRoomId === 'common_lobby' ? 'core_lobby' : d.fromRoomId, d.toRoomId] as const,
        kind: d.kind === 'flat_entrance' ? ('flat_entrance' as const) : d.kind === 'balcony' ? ('balcony' as const) : ('internal' as const),
        doorType: d.doorType,
        swing: 'inward' as const,
        widthM: d.widthM,
        center: d.center,
        wallAxis: d.wallAxis,
        bounds: doorBounds(d.center, d.widthM, d.wallAxis),
      })),
    ),
    ...(() => {
      const common=[{id:'core_lobby',bounds:lobbyBounds},...(coreConfig.corridors??[]).map((bounds,i)=>({id:`corridor_${i+1}`,bounds}))];
      const result:SchematicDoor[]=[];
      const connect=(a:{id:string;bounds:Rect2D},b:{id:string;bounds:Rect2D})=>{
        const A=a.bounds,B=b.bounds,loX=Math.max(A.x,B.x),hiX=Math.min(A.x+A.width,B.x+B.width),loY=Math.max(A.y,B.y),hiY=Math.min(A.y+A.height,B.y+B.height);
        let center:{x:number;y:number}|undefined;let wallAxis:'x'|'y'='x';
        if((Math.abs(A.y+A.height-B.y)<1e-6||Math.abs(B.y+B.height-A.y)<1e-6)&&hiX-loX>=1.2)center={x:(loX+hiX)/2,y:Math.max(A.y,B.y)};
        else if((Math.abs(A.x+A.width-B.x)<1e-6||Math.abs(B.x+B.width-A.x)<1e-6)&&hiY-loY>=1.2){wallAxis='y';center={x:Math.max(A.x,B.x),y:(loY+hiY)/2};}
        if(center)result.push({id:`core_door_${a.id}_${b.id}`,flatId:null,connects:[a.id,b.id],kind:'core',doorType:'single',swing:'inward',widthM:1,center,wallAxis,bounds:doorBounds(center,1,wallAxis)});
      };
      for(const el of [...lifts,...stairs])for(const c of common)connect(c,el);
      for(let i=0;i<common.length;i++)for(let j=i+1;j<common.length;j++)connect(common[i]!,common[j]!);
      return result;
    })(),
  ];

  const solverErrors=[...allocation.hardErrors,...unitTopologies.flatMap(u=>u.hardErrors)];
  const spatialChecks:SchematicSpatialCheck[]=[{code:'SOLVER_GEOMETRY',flatId:null,status:solverErrors.length?'FAIL':'PASS',message:solverErrors.length?solverErrors.join('; '):'Envelope and unit solver checks passed; canonical closure checks are required.'}];

  const nodes: SpatialGraphNode[] = [
    { id: 'core_lobby', flatId: null, role: 'lobby', zone: 'PUBLIC', name: 'Common Lobby' },
    ...lifts.map(l => ({ id: l.id, flatId: null, role: 'lift', zone: 'SERVICE' as LayoutZone, name: l.label })),
    ...stairs.map(s => ({ id: s.id, flatId: null, role: 'stair', zone: 'SERVICE' as LayoutZone, name: s.label })),
    ...units.flatMap(u => u.rooms.map(r => ({ id: r.id, flatId: u.flatId, role: r.type, zone: r.zone ?? 'PRIVATE', name: r.name }))),
  ];

  const edges: SpatialGraphEdge[] = doors.map(d => ({
    a: d.connects[0],
    b: d.connects[1],
    relation: 'door',
    doorId: d.id,
  }));

  const unitMixSummary = flats.map(f => `${f.flatLabel} (${f.unitType})`).join(', ');

  const totalNetResidentialSqM = Number(units.reduce((s, u) => s + u.carpetAreaSqM, 0).toFixed(2));
  const totalFloorPlateSqM = Number(
    (units.reduce((s, u) => s + u.builtUpAreaSqM, 0) + coreConfig.totalCoreAreaSqM).toFixed(2),
  );

  const unitAreaReports:UnitAreaReport[]=units.map(u=>({flatId:u.flatId,flatLabel:u.flatLabel,unitType:u.unitType,targetCarpetSqM:u.carpetAreaSqM,actualCarpetSqM:u.actualCarpetAreaSqM,deviationPct:100*(u.actualCarpetAreaSqM-u.carpetAreaSqM)/u.carpetAreaSqM,status:Math.abs(u.actualCarpetAreaSqM-u.carpetAreaSqM)/u.carpetAreaSqM>0.1?'WARN':'OK',lines:[]}));

  const floorBalance: FloorAreaBalance = {
    buildableSqM: Number((buildable.width * buildable.height).toFixed(2)),
    footprintSqM: Number((allocation.floorPlateBounds.width * allocation.floorPlateBounds.height).toFixed(2)),
    unitsSqM: Number(units.reduce((s, u) => s + u.builtUpAreaSqM, 0).toFixed(2)),
    coreSqM: Number(coreConfig.totalCoreAreaSqM.toFixed(2)),
    lobbySqM: Number(coreConfig.lobbyAreaSqM.toFixed(2)),
    openSqM: Number(
      Math.max(
        0,
        allocation.floorPlateBounds.width * allocation.floorPlateBounds.height -
          units.reduce((s, u) => s + u.builtUpAreaSqM, 0) -
          coreConfig.totalCoreAreaSqM,
      ).toFixed(2),
    ),
    fits: allocation.fitsBuildable && solverErrors.length===0,
    message: `${strategy}: Measured ${flats.length} flats (${units.reduce((s, u) => s + u.builtUpAreaSqM, 0).toFixed(1)} m²) + core ${coreConfig.totalCoreAreaSqM} m². Solver errors: ${solverErrors.length}. Canonical validation required.`,
  };

  const svgScaffold = generateSchematicSvg({
    siteWidthM,
    siteDepthM,
    buildingFootprint: allocation.floorPlateBounds,
    lifts,
    stairs,
    lobbyBounds,
    serviceShafts,
    units,
    doors,
    flatsPerFloor: flats.length,
    unitMixSummary,
    strategy,
  });

  return {
    siteFootprint: { x: 0, y: 0, width: siteWidthM, height: siteDepthM },
    buildingFootprint: allocation.floorPlateBounds,
    setbacks,
    floorType,
    flatCount: flats.length,
    unitMixSummary,
    core: {
      bounds: coreConfig.bounds,
      lobby: { bounds: lobbyBounds, label: 'COMMON LOBBY' },
      corridors: (coreConfig.corridors??[]).map(bounds=>({bounds,label:'COMMON ACCESS SPINE'})),
      lifts,
      stairs,
      serviceShafts,
      totalCoreAreaSqM: coreConfig.totalCoreAreaSqM,
    },
    units,
    totalFloorPlateSqM,
    totalNetResidentialSqM,
    svgScaffold,
    schematicSvg: svgScaffold,
    strategy,
    doors,
    spatialGraph: { nodes, edges },
    spatialChecks,
    areaReport: { units: unitAreaReports, floor: floorBalance },
    layoutFits: allocation.fitsBuildable && unitTopologies.every(u=>u.hardErrors.length===0),
    layoutIssues: [...allocation.hardErrors,...unitTopologies.flatMap(u=>u.hardErrors)],
    layoutAdaptations: [],
  };
}

/** Backward-compatible alias for 3x3BHK schematic generation */
export const build3x3BhkSchematic = buildApartmentSchematic;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Clean technical SVG of the deterministic plan (structural ground truth).
 */
function generateSchematicSvg(data: {
  siteWidthM: number;
  siteDepthM: number;
  buildingFootprint: Rect2D;
  lifts: readonly SchematicLiftItem[];
  stairs: readonly SchematicStairItem[];
  lobbyBounds: Rect2D;
  serviceShafts: ReadonlyArray<{ bounds: Rect2D; label: string }>;
  units: readonly SchematicApartmentUnit[];
  doors: readonly SchematicDoor[];
  flatsPerFloor: number;
  unitMixSummary: string;
  strategy: ApartmentLayoutStrategy;
}): string {
  const scale = 22;
  const svgWidth = Math.ceil(data.siteWidthM * scale);
  const svgHeight = Math.ceil(data.siteDepthM * scale);
  const flatColors = ['#EBF5FB', '#FEF9E7', '#EAFAF1', '#F4ECF7', '#FDEBD0', '#E8F8F5', '#FEF5E7', '#F5EEF8'];
  const R = (r: Rect2D) => `x="${(r.x * scale).toFixed(1)}" y="${(r.y * scale).toFixed(1)}" width="${(r.width * scale).toFixed(1)}" height="${(r.height * scale).toFixed(1)}"`;
  const centre = (r: Rect2D) => ({ x: (r.x + r.width / 2) * scale, y: (r.y + r.height / 2) * scale });

  const unitsSvg = data.units
    .map((unit, idx) => {
      const color = flatColors[idx % flatColors.length];
      const b = unit.bodyBounds;
      const rooms = [...unit.rooms, ...unit.balconies]
        .map(room => {
          const c = centre(room.bounds);
          const dashed = room.type === 'balcony' ? ' stroke-dasharray="3,2"' : '';
          return `
        <rect ${R(room.bounds)} fill="none" stroke="#64748B" stroke-width="0.9"${dashed}/>
        <text x="${c.x.toFixed(1)}" y="${(c.y + 3).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#334155">${esc(room.name)}</text>`;
        })
        .join('');
      return `
    <g id="${unit.flatId}">
      <rect ${R(b)} fill="${color}" stroke="#0F172A" stroke-width="2.2" />
      ${rooms}
      <text x="${(b.x * scale + 6).toFixed(1)}" y="${(b.y * scale + 14).toFixed(1)}" font-size="11" font-weight="700" fill="#1E293B">${esc(unit.flatLabel)} · ${unit.unitType}</text>
      <text x="${(b.x * scale + 6).toFixed(1)}" y="${(b.y * scale + 26).toFixed(1)}" font-size="9" fill="#64748B">Carpet: ${unit.actualCarpetAreaSqM} m² (target ${unit.carpetAreaSqM} m²)</text>
    </g>`;
    })
    .join('');

  const doorsSvg = data.doors
    .map(d => `<rect ${R(d.bounds)} fill="#FFFFFF" stroke="${d.kind === 'flat_entrance' ? '#DC2626' : '#0EA5E9'}" stroke-width="1"/>`)
    .join('');

  const coreSvg = `
  <rect ${R(data.lobbyBounds)} fill="#F8FAFC" stroke="#334155" stroke-width="1.5" />
  <text x="${centre(data.lobbyBounds).x.toFixed(1)}" y="${(centre(data.lobbyBounds).y + 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#334155">COMMON LOBBY</text>
  ${data.lifts
    .map(lift => {
      const b = lift.bounds;
      const x0 = b.x * scale;
      const y0 = b.y * scale;
      const x1 = (b.x + b.width) * scale;
      const y1 = (b.y + b.height) * scale;
      const c = centre(b);
      return `
    <rect ${R(b)} fill="#E0F2FE" stroke="#0284C7" stroke-width="1.5" />
    <line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#0284C7" stroke-width="0.8" />
    <line x1="${x1}" y1="${y0}" x2="${x0}" y2="${y1}" stroke="#0284C7" stroke-width="0.8" />
    <text x="${c.x.toFixed(1)}" y="${(c.y + 3).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="#0369A1">${lift.label}</text>`;
    })
    .join('')}
  ${data.stairs
    .map(stair => {
      const c = centre(stair.bounds);
      return `
    <rect ${R(stair.bounds)} fill="url(#stairLines)" stroke="#D97706" stroke-width="1.5" />
    <text x="${c.x.toFixed(1)}" y="${(c.y + 3).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#92400E">${stair.label}</text>`;
    })
    .join('')}
  ${data.serviceShafts.map(s => `<rect ${R(s.bounds)} fill="#F1F5F9" stroke="#475569" stroke-width="1" />`).join('')}`;

  const fp = data.buildingFootprint;
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}" style="background:#F8F9FA; font-family: Inter, Roboto, sans-serif;">
  <defs>
    <pattern id="grid" width="${scale}" height="${scale}" patternUnits="userSpaceOnUse">
      <path d="M ${scale} 0 L 0 0 0 ${scale}" fill="none" stroke="#E2E8F0" stroke-width="0.5"/>
    </pattern>
    <pattern id="stairLines" width="6" height="6" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="6" stroke="#94A3B8" stroke-width="1.5" />
    </pattern>
  </defs>
  <rect width="${svgWidth}" height="${svgHeight}" fill="url(#grid)" />
  <rect x="2" y="2" width="${svgWidth - 4}" height="${svgHeight - 4}" fill="none" stroke="#64748B" stroke-width="2" stroke-dasharray="4,4" />
  <text x="10" y="20" font-size="11" font-weight="600" fill="#475569">SITE BOUNDARY (${data.siteWidthM}m × ${data.siteDepthM}m)</text>
  <rect ${R(fp)} fill="none" stroke="#94A3B8" stroke-width="1" stroke-dasharray="6,3" />
  ${unitsSvg}
  ${coreSvg}
  ${doorsSvg}
  <rect x="10" y="${svgHeight - 34}" width="${svgWidth - 20}" height="24" fill="#0F172A" rx="4" />
  <text x="20" y="${svgHeight - 18}" font-size="10" font-weight="600" fill="#F8FAFC">SCHEMATIC APARTMENT PLAN · ${data.strategy.toUpperCase()} · ${data.flatsPerFloor} FLATS/FLOOR · ${esc(data.unitMixSummary)}</text>
</svg>
`.trim();
}

import { isPhysicalBoundary } from '../models/architectural-semantics';
import type { Building, Floor, Wall } from '../types/building';
import type { Point, Polygon, WallArcSpec } from '../types/geometry';

function polygonAreaMm2(polygon: Polygon): number {
  const pts = polygon.points;
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) * 0.5;
}

function polygonCentroidMm(polygon: Polygon): Point {
  const pts = polygon.points;
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length < 3) {
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
  }
  let signed2A = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const cross = a.x * b.y - b.x * a.y;
    signed2A += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(signed2A) < 1e-6) {
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
  }
  return { x: cx / (3 * signed2A), y: cy / (3 * signed2A) };
}
import {
  assertExchangeArtifact,
  EXCHANGE_FRAME,
  exchangeArtifactDigest,
  exchangeRevision,
  type CanonicalExchangeAdapter,
  type CanonicalExchangeRevision,
  type ExchangeArtifact,
  type ExchangeElementMapping,
  type ExchangeManifest,
  type ExchangeReadback,
} from './cad-bim-adapter-contract';
import {
  angleBulgeFromArc,
  type CadArcEntity,
  type CadDimensionEntity,
  type CadEntity,
  type CadLayer,
  type CadLineEntity,
  type CadPoint2D,
  type CadPolylineEntity,
  type CadTextEntity,
  normCadAngle,
  TAU,
} from './cota-cad-helpers';

export const CANONICAL_CAD_ADAPTER_VERSION = '1.0.0' as const;

export interface CadConversionNote {
  readonly code:
    | 'OPEN_BOUNDARY_OMITTED_FROM_PHYSICAL_WALLS'
    | 'FURNITURE_NOT_MAPPED_IN_EXCHANGE_V1'
    | 'PROVISIONAL_FRAMING_EXCLUDED_BY_DEFAULT'
    | 'CURVED_ROOM_BOUNDARY_TESSELLATED_POLYGON';
  readonly message: string;
  readonly count: number;
}

export interface CanonicalCadFloorSheet {
  readonly floorId: string;
  readonly floorName: string;
  readonly level: number;
  readonly elevationMm: number;
  readonly entities: readonly CadEntity[];
}

export interface CanonicalCadDocument {
  readonly adapterVersion: typeof CANONICAL_CAD_ADAPTER_VERSION;
  readonly projectId: string;
  readonly buildingId: string;
  readonly buildingName: string;
  readonly expectedRevision: number;
  readonly canonicalDigest: string;
  readonly unit: 'mm';
  readonly frame: typeof EXCHANGE_FRAME;
  readonly originMm: { readonly x: 0; readonly y: 0; readonly z: 0 };
  readonly layers: readonly CadLayer[];
  readonly sheets: readonly CanonicalCadFloorSheet[];
  readonly mappings: readonly ExchangeElementMapping[];
  readonly conversionNotes: readonly CadConversionNote[];
}

/**
 * RH plan coordinates use millimetres with X right and Y down.
 * Exchange coordinates use millimetres in a building-local right-handed frame with Z up: `(x, -y, floorElevationMm)`.
 */
export function planPointToCad(point: Point): CadPoint2D {
  return { x: point.x, y: -point.y };
}

export function cadPointToPlan(point: CadPoint2D): Point {
  return { x: point.x, y: -point.y };
}

export const ARCHITECTURAL_CAD_LAYERS: readonly CadLayer[] = [
  { id: 'A-SLAB', name: 'A-SLAB', color: '#8B6843', lineWeightMm: 0.35, lineType: 'CONTINUOUS', visible: true, locked: true, origin: 'CANONICAL_ARCHITECTURAL' },
  { id: 'A-VOID', name: 'A-VOID', color: '#B45309', lineWeightMm: 0.25, lineType: 'DASHED', visible: true, locked: true, origin: 'CANONICAL_ARCHITECTURAL' },
  { id: 'A-WALL-EXT', name: 'A-WALL-EXT', color: '#1F2937', lineWeightMm: 0.50, lineType: 'CONTINUOUS', visible: true, locked: false, origin: 'CANONICAL_ARCHITECTURAL' },
  { id: 'A-WALL-INT', name: 'A-WALL-INT', color: '#374151', lineWeightMm: 0.35, lineType: 'CONTINUOUS', visible: true, locked: false, origin: 'CANONICAL_ARCHITECTURAL' },
  { id: 'A-ROOM', name: 'A-ROOM', color: '#6B7280', lineWeightMm: 0.18, lineType: 'CONTINUOUS', visible: true, locked: false, origin: 'CANONICAL_ARCHITECTURAL' },
  { id: 'A-DOOR', name: 'A-DOOR', color: '#92400E', lineWeightMm: 0.25, lineType: 'CONTINUOUS', visible: true, locked: false, origin: 'CANONICAL_ARCHITECTURAL' },
  { id: 'A-WIND', name: 'A-WIND', color: '#0369A1', lineWeightMm: 0.25, lineType: 'CONTINUOUS', visible: true, locked: false, origin: 'CANONICAL_ARCHITECTURAL' },
  { id: 'A-STAIR', name: 'A-STAIR', color: '#4B5563', lineWeightMm: 0.25, lineType: 'CONTINUOUS', visible: true, locked: true, origin: 'CANONICAL_ARCHITECTURAL' },
  { id: 'A-LIFT', name: 'A-LIFT', color: '#4338CA', lineWeightMm: 0.30, lineType: 'CONTINUOUS', visible: true, locked: true, origin: 'CANONICAL_ARCHITECTURAL' },
  { id: 'A-DIM', name: 'A-DIM', color: '#78716C', lineWeightMm: 0.18, lineType: 'CONTINUOUS', visible: true, locked: true, origin: 'CANONICAL_ARCHITECTURAL' },
  { id: 'A-ANNO', name: 'A-ANNO', color: '#292524', lineWeightMm: 0.18, lineType: 'CONTINUOUS', visible: true, locked: true, origin: 'CANONICAL_ARCHITECTURAL' },
  { id: 'D-DRAFT', name: 'D-DRAFT', color: '#0F766E', lineWeightMm: 0.25, lineType: 'CONTINUOUS', visible: true, locked: false, origin: 'DRAFTING_ANNOTATION' },
  { id: 'D-DIM', name: 'D-DIM', color: '#0E7490', lineWeightMm: 0.18, lineType: 'CONTINUOUS', visible: true, locked: false, origin: 'DRAFTING_ANNOTATION' },
  { id: 'D-ANNO', name: 'D-ANNO', color: '#1D4ED8', lineWeightMm: 0.18, lineType: 'CONTINUOUS', visible: true, locked: false, origin: 'DRAFTING_ANNOTATION' },
];

/** Deterministic uppercase hex DXF handle derived from `(floorId, kind, canonicalId)`. */
export function deterministicDxfHandle(floorId: string, kind: string, canonicalId: string, seqFallback: number): string {
  const raw = `${floorId}::${kind}::${canonicalId}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (ch + i), 0x85ebca6b) >>> 0;
  }
  const combined = ((BigInt(h1 || 1) << 24n) ^ BigInt(h2 || seqFallback)) & 0xffffffffffffn;
  return (combined === 0n ? BigInt(seqFallback + 0x100) : combined).toString(16).toUpperCase();
}

function mapWallArcToCad(wall: Wall, handle: string, layer: string, locked: boolean): CadArcEntity | null {
  const arc: WallArcSpec | undefined = wall.arc;
  if (!arc || !(arc.radiusMm > 0)) return null;
  const center = planPointToCad(arc.center);
  const sPt = planPointToCad(wall.startPoint);
  const ePt = planPointToCad(wall.endPoint);
  const angS = normCadAngle(Math.atan2(sPt.y - center.y, sPt.x - center.x));
  const angE = normCadAngle(Math.atan2(ePt.y - center.y, ePt.x - center.x));
  // Plan (x, y-down) reflection into CAD (x, y-up) reverses clockwise <-> counter-clockwise orientation
  const ccwInCad = !arc.anticlockwise;
  return {
    id: `cad:wall:${wall.id}`,
    handle,
    type: 'ARC',
    layer,
    origin: 'CANONICAL_ARCHITECTURAL',
    canonicalId: wall.id,
    canonicalKind: 'wall',
    locked,
    center,
    radius: arc.radiusMm,
    startAngle: ccwInCad ? angS : angE,
    endAngle: ccwInCad ? angE : angS,
  };
}

export interface ProjectBuildingToCadOptions {
  readonly floorId?: string;
  readonly lockedFloorIds?: readonly string[];
  readonly lockedEntityIds?: readonly string[];
  readonly includeDraftingEntities?: Readonly<Record<string, readonly CadEntity[]>>;
}

export function projectBuildingToCanonicalCad(
  building: Building,
  options: ProjectBuildingToCadOptions = {},
): CanonicalCadDocument {
  const rev = exchangeRevision(building);
  const lockedFloors = new Set(options.lockedFloorIds ?? []);
  const lockedEntities = new Set(options.lockedEntityIds ?? []);
  const mappings: ExchangeElementMapping[] = [];
  const sheets: CanonicalCadFloorSheet[] = [];
  const usedHandles = new Set<string>();
  let seq = 256;

  const allocHandle = (floorId: string, kind: string, id: string): string => {
    let candidate = deterministicDxfHandle(floorId, kind, id, seq++);
    while (usedHandles.has(candidate)) {
      candidate = (BigInt(`0x${candidate}`) + 1n).toString(16).toUpperCase();
    }
    usedHandles.add(candidate);
    return candidate;
  };

  let openBoundaryWalls = 0;
  let furnitureCount = 0;
  let provisionalFramingOmitted = 0;
  let curvedRoomCount = 0;

  const targetFloors = options.floorId
    ? building.floors.filter(f => f.id === options.floorId)
    : building.floors;

  for (const floor of targetFloors) {
    const floorLocked = lockedFloors.has(floor.id);
    const elevationMm = floor.elevationMm ?? floor.level * (floor.floorHeight || 3150);
    const entities: CadEntity[] = [];

    const floorHandle = allocHandle(floor.id, 'floor', floor.id);
    mappings.push({
      kind: 'floor',
      floorId: floor.id,
      canonicalId: floor.id,
      externalId: floorHandle,
    });

    if (floor.boundary.points.length >= 3) {
      entities.push({
        id: `cad:floor:${floor.id}`,
        handle: floorHandle,
        type: 'POLYLINE',
        layer: 'A-SLAB',
        origin: 'CANONICAL_ARCHITECTURAL',
        canonicalId: floor.id,
        canonicalKind: 'floor',
        locked: true,
        vertices: floor.boundary.points.map(planPointToCad),
        closed: true,
      });
    }

    for (const [vIdx, voidPoly] of (floor.voidBoundaries ?? []).entries()) {
      if (voidPoly.points.length >= 3) {
        entities.push({
          id: `cad:void:${floor.id}:${vIdx}`,
          handle: allocHandle(floor.id, 'void', `${floor.id}:${vIdx}`),
          type: 'POLYLINE',
          layer: 'A-VOID',
          origin: 'CANONICAL_ARCHITECTURAL',
          locked: true,
          vertices: voidPoly.points.map(planPointToCad),
          closed: true,
        });
      }
    }

    for (const wall of floor.walls) {
      const wallHandle = allocHandle(floor.id, 'wall', wall.id);
      mappings.push({
        kind: 'wall',
        floorId: floor.id,
        canonicalId: wall.id,
        externalId: wallHandle,
      });
      if (!isPhysicalBoundary(wall)) {
        openBoundaryWalls++;
      }
      const isExt = wall.wallUse === 'EXTERNAL' || wall.type === 'external';
      const layer = isExt ? 'A-WALL-EXT' : 'A-WALL-INT';
      const locked = floorLocked || lockedEntities.has(wall.id) || wall.loadBearing;
      const arcEntity = mapWallArcToCad(wall, wallHandle, layer, locked);
      if (arcEntity) {
        entities.push(arcEntity);
      } else {
        entities.push({
          id: `cad:wall:${wall.id}`,
          handle: wallHandle,
          type: 'LINE',
          layer,
          origin: 'CANONICAL_ARCHITECTURAL',
          canonicalId: wall.id,
          canonicalKind: 'wall',
          locked,
          start: planPointToCad(wall.startPoint),
          end: planPointToCad(wall.endPoint),
        });
      }
    }

    for (const room of floor.rooms) {
      const roomHandle = allocHandle(floor.id, 'room', room.id);
      mappings.push({
        kind: 'room',
        floorId: floor.id,
        canonicalId: room.id,
        externalId: roomHandle,
      });
      if (room.curvedEdges && room.curvedEdges.length > 0) curvedRoomCount++;
      const isLift = room.type === 'lift';
      const layer = isLift ? 'A-LIFT' : 'A-ROOM';
      const pts = room.boundary.points.length >= 3
        ? room.boundary.points.map(planPointToCad)
        : [
            planPointToCad({ x: room.x, y: room.y }),
            planPointToCad({ x: room.x + room.width, y: room.y }),
            planPointToCad({ x: room.x + room.width, y: room.y + room.height }),
            planPointToCad({ x: room.x, y: room.y + room.height }),
          ];
      entities.push({
        id: `cad:room:${room.id}`,
        handle: roomHandle,
        type: 'POLYLINE',
        layer,
        origin: 'CANONICAL_ARCHITECTURAL',
        canonicalId: room.id,
        canonicalKind: 'room',
        locked: floorLocked || lockedEntities.has(room.id) || room.isFixed,
        vertices: pts,
        closed: true,
      });

      // Room label annotation
      const centerPlan = room.boundary.points.length >= 3
        ? polygonCentroidMm(room.boundary)
        : { x: room.x + room.width / 2, y: room.y + room.height / 2 };
      const areaSqm = (room.boundary.points.length >= 3 ? polygonAreaMm2(room.boundary) : room.area) / 1_000_000;
      entities.push({
        id: `cad:anno:room:${room.id}`,
        handle: allocHandle(floor.id, 'anno', room.id),
        type: 'TEXT',
        layer: 'A-ANNO',
        origin: 'CANONICAL_ARCHITECTURAL',
        canonicalId: room.id,
        canonicalKind: 'room',
        locked: true,
        position: planPointToCad(centerPlan),
        text: `${room.name} (${areaSqm.toFixed(1)} m2)`,
        heightMm: 180,
        rotationRad: 0,
        justify: 'center',
      });
    }

    const wallById = new Map(floor.walls.map(w => [w.id, w]));

    for (const door of floor.doors) {
      const doorHandle = allocHandle(floor.id, 'door', door.id);
      mappings.push({
        kind: 'door',
        floorId: floor.id,
        canonicalId: door.id,
        externalId: doorHandle,
        hostWallId: door.wallId,
      });
      const host = wallById.get(door.wallId);
      const center = planPointToCad(door.position);
      const half = door.width / 2;
      let ux = 1;
      let uy = 0;
      if (host) {
        const hs = planPointToCad(host.startPoint);
        const he = planPointToCad(host.endPoint);
        const l = Math.hypot(he.x - hs.x, he.y - hs.y) || 1;
        ux = (he.x - hs.x) / l;
        uy = (he.y - hs.y) / l;
      }
      entities.push({
        id: `cad:door:${door.id}`,
        handle: doorHandle,
        type: 'LINE',
        layer: 'A-DOOR',
        origin: 'CANONICAL_ARCHITECTURAL',
        canonicalId: door.id,
        canonicalKind: 'door',
        hostWallId: door.wallId,
        locked: floorLocked || lockedEntities.has(door.id),
        start: { x: center.x - ux * half, y: center.y - uy * half },
        end: { x: center.x + ux * half, y: center.y + uy * half },
      });
    }

    for (const win of floor.windows) {
      const winHandle = allocHandle(floor.id, 'window', win.id);
      mappings.push({
        kind: 'window',
        floorId: floor.id,
        canonicalId: win.id,
        externalId: winHandle,
        hostWallId: win.wallId,
      });
      const host = wallById.get(win.wallId);
      const center = planPointToCad(win.position);
      const half = win.width / 2;
      let ux = 1;
      let uy = 0;
      if (host) {
        const hs = planPointToCad(host.startPoint);
        const he = planPointToCad(host.endPoint);
        const l = Math.hypot(he.x - hs.x, he.y - hs.y) || 1;
        ux = (he.x - hs.x) / l;
        uy = (he.y - hs.y) / l;
      }
      entities.push({
        id: `cad:window:${win.id}`,
        handle: winHandle,
        type: 'LINE',
        layer: 'A-WIND',
        origin: 'CANONICAL_ARCHITECTURAL',
        canonicalId: win.id,
        canonicalKind: 'window',
        hostWallId: win.wallId,
        locked: floorLocked || lockedEntities.has(win.id),
        start: { x: center.x - ux * half, y: center.y - uy * half },
        end: { x: center.x + ux * half, y: center.y + uy * half },
      });
    }

    for (const stair of floor.stairs) {
      if (stair.boundary.points.length >= 3) {
        entities.push({
          id: `cad:stair:${stair.id}`,
          handle: allocHandle(floor.id, 'stair', stair.id),
          type: 'POLYLINE',
          layer: 'A-STAIR',
          origin: 'CANONICAL_ARCHITECTURAL',
          canonicalId: stair.id,
          canonicalKind: 'stair',
          locked: true,
          vertices: stair.boundary.points.map(planPointToCad),
          closed: true,
        });
      }
    }

    // Overall floor envelope linear dimensions (architecture-first: no structural grids by default)
    if (floor.boundary.points.length >= 3) {
      const cadPts = floor.boundary.points.map(planPointToCad);
      const xs = cadPts.map(p => p.x);
      const ys = cadPts.map(p => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      if (maxX > minX && maxY > minY) {
        entities.push(
          {
            id: `cad:dim:w:${floor.id}`,
            handle: allocHandle(floor.id, 'dim', `${floor.id}:width`),
            type: 'DIMENSION',
            layer: 'A-DIM',
            origin: 'CANONICAL_ARCHITECTURAL',
            locked: true,
            dimKind: 'LINEAR',
            p1: { x: minX, y: maxY },
            p2: { x: maxX, y: maxY },
            textPosition: { x: (minX + maxX) / 2, y: maxY + 1200 },
            measuredMm: maxX - minX,
          },
          {
            id: `cad:dim:d:${floor.id}`,
            handle: allocHandle(floor.id, 'dim', `${floor.id}:depth`),
            type: 'DIMENSION',
            layer: 'A-DIM',
            origin: 'CANONICAL_ARCHITECTURAL',
            locked: true,
            dimKind: 'LINEAR',
            p1: { x: minX, y: minY },
            p2: { x: minX, y: maxY },
            textPosition: { x: minX - 1200, y: (minY + maxY) / 2 },
            measuredMm: maxY - minY,
          },
        );
      }
    }

    const extraDrafting = options.includeDraftingEntities?.[floor.id] ?? [];
    for (const draft of extraDrafting) {
      entities.push(draft);
    }

    furnitureCount += floor.furniture?.length ?? 0;
    provisionalFramingOmitted += floor.columns.length + (floor.beams?.length ?? 0);

    sheets.push({
      floorId: floor.id,
      floorName: floor.name,
      level: floor.level,
      elevationMm,
      entities,
    });
  }

  const conversionNotes: CadConversionNote[] = [];
  if (openBoundaryWalls > 0) {
    conversionNotes.push({
      code: 'OPEN_BOUNDARY_OMITTED_FROM_PHYSICAL_WALLS',
      message: 'Virtual open-boundary room dividers are preserved in the canonical manifest with wall handles for host integrity.',
      count: openBoundaryWalls,
    });
  }
  if (furnitureCount > 0) {
    conversionNotes.push({
      code: 'FURNITURE_NOT_MAPPED_IN_EXCHANGE_V1',
      message: 'Furniture items remain in canonical Floor.furniture and are omitted from Exchange V1 structural/architectural CAD primitives.',
      count: furnitureCount,
    });
  }
  if (provisionalFramingOmitted > 0) {
    conversionNotes.push({
      code: 'PROVISIONAL_FRAMING_EXCLUDED_BY_DEFAULT',
      message: 'Architecture-first CAD projection omits preliminary columns and beams by default; use the Structural Framing workflow for S-COLS/S-BEAM.',
      count: provisionalFramingOmitted,
    });
  }
  if (curvedRoomCount > 0) {
    conversionNotes.push({
      code: 'CURVED_ROOM_BOUNDARY_TESSELLATED_POLYGON',
      message: 'Curved walls export as analytic DXF ARC entities while room area boundaries preserve canonical polygon vertices.',
      count: curvedRoomCount,
    });
  }

  return {
    adapterVersion: CANONICAL_CAD_ADAPTER_VERSION,
    projectId: building.projectId,
    buildingId: building.id,
    buildingName: building.name,
    expectedRevision: building.version,
    canonicalDigest: rev.sha256,
    unit: 'mm',
    frame: EXCHANGE_FRAME,
    originMm: { x: 0, y: 0, z: 0 },
    layers: ARCHITECTURAL_CAD_LAYERS,
    sheets,
    mappings,
    conversionNotes,
  };
}

function dxfPair(code: number, value: string | number): string {
  return `${code}\n${value}\n`;
}

/** Serializes a `CanonicalCadDocument` to ASCII DXF (`AC1015`, `$INSUNITS = 4` mm, `XDATA` canonical provenance). */
export function serializeCanonicalCadToDxf(doc: CanonicalCadDocument): string {
  let out = '';
  out += dxfPair(0, 'SECTION') + dxfPair(2, 'HEADER');
  out += dxfPair(9, '$ACADVER') + dxfPair(1, 'AC1015');
  out += dxfPair(9, '$INSUNITS') + dxfPair(70, 4); // 4 = Millimeters
  out += dxfPair(9, '$MEASUREMENT') + dxfPair(70, 1); // Metric
  out += dxfPair(0, 'ENDSEC');

  out += dxfPair(0, 'SECTION') + dxfPair(2, 'TABLES');
  out += dxfPair(0, 'TABLE') + dxfPair(2, 'APPID') + dxfPair(70, 1);
  out += dxfPair(0, 'APPID') + dxfPair(2, 'RH_CANONICAL') + dxfPair(70, 0);
  out += dxfPair(0, 'ENDTAB');

  out += dxfPair(0, 'TABLE') + dxfPair(2, 'LAYER') + dxfPair(70, doc.layers.length);
  for (const layer of doc.layers) {
    out += dxfPair(0, 'LAYER')
      + dxfPair(2, layer.name)
      + dxfPair(70, layer.locked ? 4 : 0)
      + dxfPair(62, layer.visible ? 7 : -7)
      + dxfPair(6, 'CONTINUOUS');
  }
  out += dxfPair(0, 'ENDTAB') + dxfPair(0, 'ENDSEC');

  out += dxfPair(0, 'SECTION') + dxfPair(2, 'ENTITIES');

  for (const sheet of doc.sheets) {
    const z = sheet.elevationMm;
    // Emit a POINT marker per floor sheet carrying canonical floor handle and elevation
    const floorMapping = doc.mappings.find(m => m.kind === 'floor' && m.floorId === sheet.floorId);
    if (floorMapping) {
      out += dxfPair(0, 'POINT')
        + dxfPair(5, floorMapping.externalId)
        + dxfPair(8, 'A-SLAB')
        + dxfPair(10, 0) + dxfPair(20, 0) + dxfPair(30, z)
        + dxfPair(1001, 'RH_CANONICAL')
        + dxfPair(1000, `floor|${sheet.floorId}|${sheet.floorId}|`);
    }

    for (const entity of sheet.entities) {
      // Skip floor boundary duplicate handle since floor handle was used on POINT marker if identical; use subhandle for slab polyline
      const entityHandle = entity.canonicalKind === 'floor' ? `${entity.handle}F` : entity.handle;
      const xdata = entity.canonicalId && entity.canonicalKind && entity.canonicalKind !== 'floor'
        ? dxfPair(1001, 'RH_CANONICAL')
          + dxfPair(1000, `${entity.canonicalKind}|${sheet.floorId}|${entity.canonicalId}|${entity.hostWallId ?? ''}`)
        : '';

      switch (entity.type) {
        case 'LINE':
          out += dxfPair(0, 'LINE')
            + dxfPair(5, entityHandle)
            + dxfPair(8, entity.layer)
            + dxfPair(10, entity.start.x) + dxfPair(20, entity.start.y) + dxfPair(30, z)
            + dxfPair(11, entity.end.x) + dxfPair(21, entity.end.y) + dxfPair(31, z)
            + xdata;
          break;
        case 'ARC': {
          const sDeg = ((entity.startAngle * 180) / Math.PI + 360) % 360;
          const eDeg = ((entity.endAngle * 180) / Math.PI + 360) % 360;
          out += dxfPair(0, 'ARC')
            + dxfPair(5, entityHandle)
            + dxfPair(8, entity.layer)
            + dxfPair(10, entity.center.x) + dxfPair(20, entity.center.y) + dxfPair(30, z)
            + dxfPair(40, entity.radius)
            + dxfPair(50, sDeg) + dxfPair(51, eDeg)
            + xdata;
          break;
        }
        case 'POLYLINE': {
          out += dxfPair(0, 'LWPOLYLINE')
            + dxfPair(5, entityHandle)
            + dxfPair(8, entity.layer)
            + dxfPair(90, entity.vertices.length)
            + dxfPair(70, entity.closed ? 1 : 0)
            + dxfPair(38, z);
          entity.vertices.forEach((v, idx) => {
            out += dxfPair(10, v.x) + dxfPair(20, v.y);
            const b = entity.bulges?.[idx];
            if (b && Math.abs(b) > 1e-9) out += dxfPair(42, b);
          });
          out += xdata;
          break;
        }
        case 'TEXT':
          out += dxfPair(0, 'TEXT')
            + dxfPair(5, entityHandle)
            + dxfPair(8, entity.layer)
            + dxfPair(10, entity.position.x) + dxfPair(20, entity.position.y) + dxfPair(30, z)
            + dxfPair(40, entity.heightMm)
            + dxfPair(50, (entity.rotationRad * 180) / Math.PI)
            + dxfPair(1, entity.text.replace(/\r?\n/g, ' '))
            + (entity.canonicalKind === 'room' ? '' : xdata);
          break;
        case 'DIMENSION':
          out += dxfPair(0, 'LINE')
            + dxfPair(5, entityHandle)
            + dxfPair(8, entity.layer)
            + dxfPair(10, entity.p1.x) + dxfPair(20, entity.p1.y) + dxfPair(30, z)
            + dxfPair(11, entity.p2.x) + dxfPair(21, entity.p2.y) + dxfPair(31, z)
            + dxfPair(0, 'TEXT')
            + dxfPair(5, `${entityHandle}T`)
            + dxfPair(8, entity.layer)
            + dxfPair(10, entity.textPosition.x) + dxfPair(20, entity.textPosition.y) + dxfPair(30, z)
            + dxfPair(40, 180)
            + dxfPair(1, entity.textOverride ?? `${Math.round(entity.measuredMm)}`);
          break;
        case 'CIRCLE':
          out += dxfPair(0, 'CIRCLE')
            + dxfPair(5, entityHandle)
            + dxfPair(8, entity.layer)
            + dxfPair(10, entity.center.x) + dxfPair(20, entity.center.y) + dxfPair(30, z)
            + dxfPair(40, entity.radius);
          break;
        case 'RECTANGLE': {
          const { x, y } = entity.corner;
          const verts = [
            { x, y },
            { x: x + entity.width, y },
            { x: x + entity.width, y: y + entity.height },
            { x, y: y + entity.height },
          ];
          out += dxfPair(0, 'LWPOLYLINE')
            + dxfPair(5, entityHandle)
            + dxfPair(8, entity.layer)
            + dxfPair(90, 4)
            + dxfPair(70, 1)
            + dxfPair(38, z);
          for (const v of verts) out += dxfPair(10, v.x) + dxfPair(20, v.y);
          break;
        }
      }
    }
  }

  out += dxfPair(0, 'ENDSEC') + dxfPair(0, 'EOF');
  return out;
}

export interface ParsedExchangeDxfRecord {
  readonly entityType: string;
  readonly handle: string;
  readonly layer: string;
  readonly xdataTag?: string;
  readonly points: readonly CadPoint2D[];
  readonly center?: CadPoint2D;
  readonly radius?: number;
  readonly startAngleDeg?: number;
  readonly endAngleDeg?: number;
  readonly elevationZ?: number;
}

export function parseExchangeDxfEntities(dxfText: string): {
  insunits: number | null;
  entities: readonly ParsedExchangeDxfRecord[];
} {
  const lines = dxfText.split(/\r?\n/);
  let insunits: number | null = null;
  let inEntities = false;
  const entities: ParsedExchangeDxfRecord[] = [];

  let curType = '';
  let curHandle = '';
  let curLayer = '';
  let curXdata: string | undefined;
  let curPoints: CadPoint2D[] = [];
  let pendingX: number | null = null;
  let x10: number | undefined;
  let y20: number | undefined;
  let x11: number | undefined;
  let y21: number | undefined;
  let radius: number | undefined;
  let startAngleDeg: number | undefined;
  let endAngleDeg: number | undefined;
  let elevationZ: number | undefined;

  const flush = () => {
    if (!curType) return;
    const pts = [...curPoints];
    if (curType === 'LINE' && x10 !== undefined && y20 !== undefined && x11 !== undefined && y21 !== undefined) {
      pts.push({ x: x10, y: y20 }, { x: x11, y: y21 });
    }
    entities.push({
      entityType: curType,
      handle: curHandle,
      layer: curLayer,
      xdataTag: curXdata,
      points: pts,
      ...(curType === 'ARC' || curType === 'CIRCLE'
        ? { center: x10 !== undefined && y20 !== undefined ? { x: x10, y: y20 } : undefined, radius, startAngleDeg, endAngleDeg }
        : {}),
      elevationZ,
    });
    curType = '';
    curHandle = '';
    curLayer = '';
    curXdata = undefined;
    curPoints = [];
    pendingX = null;
    x10 = undefined;
    y20 = undefined;
    x11 = undefined;
    y21 = undefined;
    radius = undefined;
    startAngleDeg = undefined;
    endAngleDeg = undefined;
    elevationZ = undefined;
  };

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i]!.trim(), 10);
    const val = lines[i + 1]!.trim();
    if (code === 9 && val === '$INSUNITS' && i + 3 < lines.length) {
      insunits = Number.parseInt(lines[i + 3]!.trim(), 10);
    }
    if (code === 2 && val === 'ENTITIES') {
      inEntities = true;
      continue;
    }
    if (inEntities && code === 0 && val === 'ENDSEC') {
      flush();
      inEntities = false;
      continue;
    }
    if (!inEntities) continue;
    if (code === 0) {
      flush();
      curType = val;
      continue;
    }
    if (code === 5 && !curHandle) curHandle = val;
    else if (code === 8) curLayer = val;
    else if (code === 30 || code === 38) elevationZ = Number(val);
    else if (code === 40) radius = Number(val);
    else if (code === 50) startAngleDeg = Number(val);
    else if (code === 51) endAngleDeg = Number(val);
    else if (code === 1000 && val.includes('|')) curXdata = val;
    else if (code === 10) {
      if (curType === 'LWPOLYLINE') pendingX = Number(val);
      else x10 = Number(val);
    } else if (code === 20) {
      if (curType === 'LWPOLYLINE' && pendingX !== null) {
        curPoints.push({ x: pendingX, y: Number(val) });
        pendingX = null;
      } else {
        y20 = Number(val);
      }
    } else if (code === 11) x11 = Number(val);
    else if (code === 21) y21 = Number(val);
  }
  flush();
  return { insunits, entities };
}

/**
 * Concrete implementation of `@ai-floor-planner/core`'s `CanonicalExchangeAdapter` (`format: 'DXF'`),
 * binding canonical `Building` revisions to DXF bytes and verifying geometric & host fidelity via independent readback.
 */
export class CanonicalDxfExchangeAdapter implements CanonicalExchangeAdapter {
  readonly format = 'DXF' as const;

  constructor(private readonly sourceBuildingResolver?: (buildingId: string) => Building | undefined) {}

  async export(building: Building, revision: CanonicalExchangeRevision): Promise<ExchangeArtifact> {
    const actual = exchangeRevision(building);
    if (
      revision.buildingId !== actual.buildingId ||
      revision.projectId !== actual.projectId ||
      revision.revision !== actual.revision ||
      revision.sha256 !== actual.sha256
    ) {
      throw new Error('Requested revision does not match the canonical Building state.');
    }
    const doc = projectBuildingToCanonicalCad(building);
    const dxfString = serializeCanonicalCadToDxf(doc);
    const bytes = new TextEncoder().encode(dxfString);
    const manifest: ExchangeManifest = {
      contractVersion: 1,
      format: 'DXF',
      unit: 'mm',
      frame: EXCHANGE_FRAME,
      source: actual,
      artifactSha256: exchangeArtifactDigest(bytes),
      elements: doc.mappings,
    };
    const artifact: ExchangeArtifact = { manifest, bytes };
    assertExchangeArtifact(artifact, building);
    return artifact;
  }

  async readback(
    artifact: ExchangeArtifact,
    expected: CanonicalExchangeRevision,
    referenceBuilding?: Building,
  ): Promise<ExchangeReadback> {
    const { manifest, bytes } = artifact;
    if (
      manifest.source.buildingId !== expected.buildingId ||
      manifest.source.projectId !== expected.projectId ||
      manifest.source.revision !== expected.revision ||
      manifest.source.sha256 !== expected.sha256
    ) {
      throw new Error('Readback expected revision does not match artifact manifest.');
    }
    if (manifest.artifactSha256 !== exchangeArtifactDigest(bytes)) {
      throw new Error('Readback artifact SHA-256 digest mismatch.');
    }
    const dxfText = new TextDecoder('utf-8').decode(bytes);
    const parsed = parseExchangeDxfEntities(dxfText);
    if (parsed.insunits !== 4) {
      throw new Error(`DXF unit header mismatch: expected $INSUNITS=4 (mm), received ${String(parsed.insunits)}.`);
    }

    const byHandle = new Map(parsed.entities.map(e => [e.handle, e]));
    const lostCanonicalIds: string[] = [];
    const changedHostIds: string[] = [];
    let maximumPositionErrorMm = 0;
    let maximumArcDeviationMm = 0;
    let maximumAreaErrorMm2 = 0;

    const refBuilding = referenceBuilding ?? this.sourceBuildingResolver?.(expected.buildingId);
    const floorMap = new Map<string, Floor>((refBuilding?.floors ?? []).map(f => [f.id, f]));

    for (const mapping of manifest.elements) {
      const record = byHandle.get(mapping.externalId);
      if (!record) {
        lostCanonicalIds.push(mapping.canonicalId);
        continue;
      }
      if (record.xdataTag) {
        const [, , xCanId, xHostId] = record.xdataTag.split('|');
        if (xCanId !== mapping.canonicalId) {
          lostCanonicalIds.push(mapping.canonicalId);
          continue;
        }
        if ((mapping.hostWallId ?? '') !== (xHostId ?? '')) {
          changedHostIds.push(mapping.canonicalId);
        }
      }

      const floor = floorMap.get(mapping.floorId);
      if (!floor) continue;

      if (mapping.kind === 'wall') {
        const wall = floor.walls.find(w => w.id === mapping.canonicalId);
        if (!wall) continue;
        if (wall.arc && record.entityType === 'ARC' && record.center && record.radius !== undefined) {
          const expectedCenter = planPointToCad(wall.arc.center);
          const centerErr = Math.hypot(record.center.x - expectedCenter.x, record.center.y - expectedCenter.y);
          const radErr = Math.abs(record.radius - wall.arc.radiusMm);
          maximumArcDeviationMm = Math.max(maximumArcDeviationMm, centerErr + radErr);
        } else if (record.points.length >= 2) {
          const es = planPointToCad(wall.startPoint);
          const ee = planPointToCad(wall.endPoint);
          const err = Math.max(
            Math.hypot(record.points[0]!.x - es.x, record.points[0]!.y - es.y),
            Math.hypot(record.points[1]!.x - ee.x, record.points[1]!.y - ee.y),
          );
          maximumPositionErrorMm = Math.max(maximumPositionErrorMm, err);
        }
      } else if (mapping.kind === 'room') {
        const room = floor.rooms.find(r => r.id === mapping.canonicalId);
        if (room && record.points.length >= 3) {
          const readbackPlanPts = record.points.map(cadPointToPlan);
          const expectedArea = room.boundary.points.length >= 3 ? polygonAreaMm2(room.boundary) : room.area;
          const actualArea = polygonAreaMm2({ points: readbackPlanPts });
          maximumAreaErrorMm2 = Math.max(maximumAreaErrorMm2, Math.abs(actualArea - expectedArea));
        }
      } else if (mapping.kind === 'door' || mapping.kind === 'window') {
        const opening = mapping.kind === 'door'
          ? floor.doors.find(d => d.id === mapping.canonicalId)
          : floor.windows.find(w => w.id === mapping.canonicalId);
        if (opening && record.points.length >= 2) {
          const mid = {
            x: (record.points[0]!.x + record.points[1]!.x) / 2,
            y: (record.points[0]!.y + record.points[1]!.y) / 2,
          };
          const exp = planPointToCad(opening.position);
          maximumPositionErrorMm = Math.max(maximumPositionErrorMm, Math.hypot(mid.x - exp.x, mid.y - exp.y));
        }
      }
    }

    return {
      maximumPositionErrorMm,
      maximumArcDeviationMm,
      maximumAreaErrorMm2,
      lostCanonicalIds,
      changedHostIds,
    };
  }
}

export { angleBulgeFromArc, TAU, type CadArcEntity, type CadDimensionEntity, type CadEntity, type CadLayer, type CadLineEntity, type CadPoint2D, type CadPolylineEntity, type CadTextEntity };

/**
 * Typed Bidirectional Adapter between RH Planner's Canonical `Building` Model (`mm`)
 * and Cota's Parametric `DocumentModel` (`mm`, right-handed Z-up).
 *
 * Coordinate Convention (Applied Exactly Once):
 *   Canonical Plan `(x, y, z)`: `x` = right (east), `y` = down (south), `z` = elevation up (`mm`)
 *   Cota World `(X, Y, Z)`:     `X = x`, `Y = -y`, `Z = z` (`mm`)
 *
 * Architectural Integrity Rules:
 *   1. Canonical `Building` remains the sole authoritative source of building geometry.
 *   2. Projected architectural entities carry explicit `CotaCanonicalEntityLink` mappings.
 *   3. Free-form CAD lines on `0` / `C-DRAFT` are NEVER automatically converted into walls;
 *      conversion requires an explicit `promoteCadLineToPartition` proposal validated
 *      through `@ai-floor-planner/constraint-engine`.
 */
import {
  DoorType,
  WallType,
  canonicalBuildingHash,
  exchangeRevision,
  validateBuildingSchema,
  type Building,
  type CanonicalExchangeRevision,
  type Door,
  type Floor,
  type Point,
  type Wall,
  type Window,
} from '@ai-floor-planner/core';
import { generationBlockingFindings, validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { fitFloorOpeningsInsideWalls, polygonArea } from '@ai-floor-planner/geometry-engine';
import { DocumentModel, MODEL_TAB } from '../core/document/DocumentModel';
import type { DocumentData, Entity, EntityInput, Layer } from '../core/document/types';
import { defaultPageSetup } from '../core/layout/paper';
import type { Vec3 } from '../core/math';

export type MappedCanonicalKind =
  | 'boundary'
  | 'wall'
  | 'room'
  | 'door'
  | 'window'
  | 'slab'
  | 'column'
  | 'beam'
  | 'grid'
  | 'stair'
  | 'dimension'
  | 'annotation';

export interface CotaCanonicalEntityLink {
  readonly cotaEntityId: string;
  readonly canonicalKind: MappedCanonicalKind;
  readonly canonicalId: string;
  readonly floorId: string;
  readonly hostWallId?: string;
  readonly sourceRevision: number;
  readonly sourceSha256: string;
}

export interface CotaProjectDrawingRecord {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly buildingId: string;
  readonly drawingId: string;
  readonly floorId: string;
  readonly name: string;
  readonly source: CanonicalExchangeRevision;
  readonly units: 'mm';
  readonly documentData: DocumentData;
  readonly entityLinks: readonly CotaCanonicalEntityLink[];
  readonly importWarnings: readonly string[];
  readonly sourceReferenceFileName?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CanonicalWritebackChange {
  readonly cotaEntityId: string;
  readonly canonicalKind: MappedCanonicalKind;
  readonly canonicalId: string;
  readonly operation: 'reposition_opening' | 'resize_opening' | 'move_interior_wall' | 'promote_cad_partition';
  readonly summary: string;
}

export interface CanonicalWritebackPreview {
  readonly ok: boolean;
  readonly staleRevision: boolean;
  readonly sourceRevision: number;
  readonly nextRevision: number;
  readonly changes: readonly CanonicalWritebackChange[];
  readonly blockingFindings: readonly string[];
  readonly warnings: readonly string[];
  readonly candidateBuilding?: Building;
}

/** Forward transform: Canonical `(x, y, z)` mm -> Cota `[X, Y, Z]` mm (applied once). */
export function canonicalToCotaVec3(xMm: number, yMm: number, zMm = 0): Vec3 {
  return [xMm, -yMm, zMm];
}

/** Inverse transform: Cota `[X, Y, Z]` mm -> Canonical `{ x, y, z }` mm (applied once). */
export function cotaVec3ToCanonical(pt: Vec3): { x: number; y: number; z: number } {
  return { x: pt[0], y: -pt[1], z: pt[2] };
}

export function createArchitecturalCotaLayers(): Layer[] {
  return [
    { id: '0', name: '0', color: '#e2e8f0', lineWeight: 0.25, lineType: 'CONTINUOUS', locked: false, visible: true, printable: true },
    { id: 'A-BOUNDARY', name: 'A-BOUNDARY', color: '#64748b', lineWeight: 0.35, lineType: 'DASHED', locked: true, visible: true, printable: true },
    { id: 'A-SLAB', name: 'A-SLAB', color: '#475569', lineWeight: 0.25, lineType: 'CONTINUOUS', locked: true, visible: true, printable: true },
    { id: 'A-WALL', name: 'A-WALL', color: '#f8fafc', lineWeight: 0.5, lineType: 'CONTINUOUS', locked: false, visible: true, printable: true },
    { id: 'A-DOOR', name: 'A-DOOR', color: '#fbbf24', lineWeight: 0.3, lineType: 'CONTINUOUS', locked: false, visible: true, printable: true },
    { id: 'A-GLAZ', name: 'A-GLAZ', color: '#38bdf8', lineWeight: 0.25, lineType: 'CONTINUOUS', locked: false, visible: true, printable: true },
    { id: 'A-ROOM', name: 'A-ROOM', color: '#34d399', lineWeight: 0.18, lineType: 'DASHED', locked: true, visible: true, printable: true },
    { id: 'A-STAIR', name: 'A-STAIR', color: '#c084fc', lineWeight: 0.25, lineType: 'CONTINUOUS', locked: true, visible: true, printable: true },
    { id: 'S-COLS', name: 'S-COLS', color: '#f87171', lineWeight: 0.4, lineType: 'CONTINUOUS', locked: true, visible: true, printable: true },
    { id: 'S-BEAM', name: 'S-BEAM', color: '#fb923c', lineWeight: 0.3, lineType: 'DASHED', locked: true, visible: true, printable: true },
    { id: 'S-GRID', name: 'S-GRID', color: '#94a3b8', lineWeight: 0.15, lineType: 'CENTER', locked: true, visible: true, printable: true },
    { id: 'A-DIMS', name: 'A-DIMS', color: '#a3e635', lineWeight: 0.18, lineType: 'CONTINUOUS', locked: false, visible: true, printable: true },
    { id: 'A-ANNO', name: 'A-ANNO', color: '#cbd5e1', lineWeight: 0.18, lineType: 'CONTINUOUS', locked: false, visible: true, printable: true },
    { id: 'A-3D-SOLID', name: 'A-3D-SOLID', color: '#93c5fd', lineWeight: 0.25, lineType: 'CONTINUOUS', locked: false, visible: false, printable: false },
    { id: 'C-DRAFT', name: 'C-DRAFT', color: '#22d3ee', lineWeight: 0.25, lineType: 'CONTINUOUS', locked: false, visible: true, printable: true },
    { id: 'C-SOLID', name: 'C-SOLID', color: '#818cf8', lineWeight: 0.35, lineType: 'CONTINUOUS', locked: false, visible: true, printable: true },
    { id: 'C-HATCH', name: 'C-HATCH', color: '#a78bfa', lineWeight: 0.15, lineType: 'CONTINUOUS', locked: false, visible: true, printable: true },
    { id: 'C-DIM', name: 'C-DIM', color: '#fde047', lineWeight: 0.18, lineType: 'CONTINUOUS', locked: false, visible: true, printable: true },
  ];
}

function polygonCentroid(pts: readonly Point[]): Point {
  if (pts.length === 0) return { x: 0, y: 0 };
  const sx = pts.reduce((s, p) => s + p.x, 0);
  const sy = pts.reduce((s, p) => s + p.y, 0);
  return { x: sx / pts.length, y: sy / pts.length };
}

export interface ProjectCanonicalToCotaOptions {
  readonly floorId?: string;
  readonly include3DSolids?: boolean;
  readonly preserveNonCanonicalFrom?: DocumentModel;
}

export function projectCanonicalBuildingToCotaDoc(
  building: Building,
  options: ProjectCanonicalToCotaOptions = {},
): { doc: DocumentModel; links: CotaCanonicalEntityLink[]; floor: Floor; source: CanonicalExchangeRevision } {
  const source = exchangeRevision(building);
  const floor =
    building.floors.find(f => f.id === options.floorId) ??
    building.floors.find(f => f.apartmentUnits && f.apartmentUnits.length > 0) ??
    building.floors[0]!;

  const baseData: DocumentData = {
    schemaVersion: 1,
    id: `${building.id}-${floor.id}`,
    name: `${building.name} — ${floor.name}`,
    units: 'mm',
    layers: createArchitecturalCotaLayers(),
    ucs: [{ id: 'world', name: 'World', origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] }],
    entities: [],
    blocks: [],
    layouts: [
      {
        id: 'L1',
        name: 'A3 Architectural Sheet',
        pageSetup: { ...defaultPageSetup(), paper: 'A3', orientation: 'landscape' },
        entities: [],
        initialized: true,
      },
    ],
    meta: {
      created: new Date().toISOString(),
      title: `${building.name} — ${floor.name}`,
      subject: `Canonical Rev ${source.revision} (${source.sha256.slice(0, 12)})`,
      author: 'RH Planner Studio',
      keywords: 'architecture,cad,bim,rh-planner',
      custom: {
        PROJECT_ID: building.projectId,
        BUILDING_ID: building.id,
        CANONICAL_REVISION: String(source.revision),
        CANONICAL_SHA256: source.sha256,
      },
    },
  };

  const doc = new DocumentModel(baseData);
  doc.loadLinetype('DASHED');
  doc.loadLinetype('CENTER');

  const links: CotaCanonicalEntityLink[] = [];
  const addMapped = (
    input: EntityInput,
    canonicalKind: MappedCanonicalKind,
    canonicalId: string,
    hostWallId?: string,
  ): Entity => {
    const ent = doc.addEntity(input);
    links.push({
      cotaEntityId: ent.id,
      canonicalKind,
      canonicalId,
      floorId: floor.id,
      ...(hostWallId ? { hostWallId } : {}),
      sourceRevision: source.revision,
      sourceSha256: source.sha256,
    });
    return ent;
  };

  // 1. Site Plot Boundary (`A-BOUNDARY`)
  if (building.site?.plotBoundary?.points?.length >= 3) {
    addMapped(
      {
        type: 'POLYLINE',
        layer: 'A-BOUNDARY',
        props: {
          vertices: building.site.plotBoundary.points.map(p => canonicalToCotaVec3(p.x, p.y, 0)),
          closed: true,
        },
      },
      'boundary',
      `${building.id}::site_boundary`,
    );
  }

  // 2. Floor Slab Outline (`A-SLAB`)
  if (floor.boundary?.points?.length >= 3) {
    const slabVertices = floor.boundary.points.map(p => canonicalToCotaVec3(p.x, p.y, 0));
    addMapped(
      {
        type: 'POLYLINE',
        layer: 'A-SLAB',
        props: { vertices: slabVertices, closed: true },
      },
      'slab',
      `${floor.id}::slab`,
    );
    if (options.include3DSolids) {
      doc.addEntity({
        type: 'SOLID3D',
        layer: 'A-3D-SOLID',
        props: { op: 'EXTRUDE', profile: slabVertices, height: -(floor.slabThicknessMm ?? 150), axis: [0, 0, 1] },
      });
    }
  }

  // 3. Rooms & Room Labels (`A-ROOM` / `A-ANNO`)
  for (const room of floor.rooms) {
    if (room.boundary?.points?.length >= 3) {
      addMapped(
        {
          type: 'POLYLINE',
          layer: 'A-ROOM',
          props: {
            vertices: room.boundary.points.map(p => canonicalToCotaVec3(p.x, p.y, 0)),
            closed: true,
          },
        },
        'room',
        room.id,
      );
      const c = polygonCentroid(room.boundary.points);
      const areaSqm = (Math.max(room.area || 0, polygonArea(room.boundary)) / 1e6).toFixed(1);
      addMapped(
        {
          type: 'TEXT',
          layer: 'A-ANNO',
          props: {
            position: canonicalToCotaVec3(c.x, c.y, 0),
            text: `${room.name}\n${areaSqm} m²`,
            height: 180,
            rotation: 0,
            justify: 'center',
            normal: [0, 0, 1],
            kind: 'mtext',
          },
        },
        'annotation',
        `${room.id}::label`,
      );
    }
  }

  // 4. Walls (`A-WALL` + optional 3D extruded wall solids)
  const wallById = new Map<string, Wall>();
  for (const wall of floor.walls) {
    wallById.set(wall.id, wall);
    const s = canonicalToCotaVec3(wall.startPoint.x, wall.startPoint.y, 0);
    const e = canonicalToCotaVec3(wall.endPoint.x, wall.endPoint.y, 0);
    if (wall.arc && wall.arc.radiusMm > 1) {
      const center = canonicalToCotaVec3(wall.arc.center.x, wall.arc.center.y, 0);
      const aStart = Math.atan2(s[1] - center[1], s[0] - center[0]);
      const aEnd = Math.atan2(e[1] - center[1], e[0] - center[0]);
      const cw = wall.arc.anticlockwise === false;
      addMapped(
        {
          type: 'ARC',
          layer: 'A-WALL',
          props: {
            center,
            radius: wall.arc.radiusMm,
            startAngle: cw ? aEnd : aStart,
            endAngle: cw ? aStart : aEnd,
            normal: [0, 0, 1],
          },
        },
        'wall',
        wall.id,
      );
    } else {
      addMapped(
        {
          type: 'LINE',
          layer: 'A-WALL',
          props: { start: s, end: e },
        },
        'wall',
        wall.id,
      );
      if (options.include3DSolids) {
        const dx = e[0] - s[0];
        const dy = e[1] - s[1];
        const len = Math.hypot(dx, dy);
        if (len > 10) {
          const halfT = (wall.thickness || 230) / 2;
          const nx = (-dy / len) * halfT;
          const ny = (dx / len) * halfT;
          const profile: Vec3[] = [
            [s[0] + nx, s[1] + ny, 0],
            [e[0] + nx, e[1] + ny, 0],
            [e[0] - nx, e[1] - ny, 0],
            [s[0] - nx, s[1] - ny, 0],
          ];
          doc.addEntity({
            type: 'SOLID3D',
            layer: 'A-3D-SOLID',
            props: { op: 'EXTRUDE', profile, height: wall.heightMm || floor.floorHeight || 3000, axis: [0, 0, 1] },
          });
        }
      }
    }
  }

  // 5. Doors (`A-DOOR`)
  for (const door of floor.doors) {
    if (door.type === DoorType.OpenPassage) continue;
    const host = wallById.get(door.wallId);
    const angle = host
      ? Math.atan2(-(host.endPoint.y - host.startPoint.y), host.endPoint.x - host.startPoint.x)
      : 0;
    const half = door.width / 2;
    const pos = canonicalToCotaVec3(door.position.x, door.position.y, 0);
    const p1: Vec3 = [pos[0] - Math.cos(angle) * half, pos[1] - Math.sin(angle) * half, 0];
    const p2: Vec3 = [pos[0] + Math.cos(angle) * half, pos[1] + Math.sin(angle) * half, 0];
    addMapped(
      {
        type: 'LINE',
        layer: 'A-DOOR',
        props: { start: p1, end: p2 },
      },
      'door',
      door.id,
      door.wallId,
    );
    doc.addEntity({
      type: 'ARC',
      layer: 'A-DOOR',
      props: {
        center: p1,
        radius: door.width,
        startAngle: angle,
        endAngle: angle + Math.PI / 2,
        normal: [0, 0, 1],
      },
    });
  }

  // 6. Windows (`A-GLAZ`)
  for (const win of floor.windows) {
    const host = wallById.get(win.wallId);
    const angle = host
      ? Math.atan2(-(host.endPoint.y - host.startPoint.y), host.endPoint.x - host.startPoint.x)
      : 0;
    const half = win.width / 2;
    const pos = canonicalToCotaVec3(win.position.x, win.position.y, 0);
    const p1: Vec3 = [pos[0] - Math.cos(angle) * half, pos[1] - Math.sin(angle) * half, 0];
    const p2: Vec3 = [pos[0] + Math.cos(angle) * half, pos[1] + Math.sin(angle) * half, 0];
    addMapped(
      {
        type: 'LINE',
        layer: 'A-GLAZ',
        props: { start: p1, end: p2 },
      },
      'window',
      win.id,
      win.wallId,
    );
  }

  // 7. Columns (`S-COLS`) & Beams (`S-BEAM`) & Structural Grids (`S-GRID`)
  const colXs = new Set<number>();
  const colYs = new Set<number>();
  for (const col of floor.columns ?? []) {
    const w = col.width ?? 300;
    const d = col.depth ?? 450;
    const c = canonicalToCotaVec3(col.position.x, col.position.y, 0);
    colXs.add(Math.round(col.position.x));
    colYs.add(Math.round(col.position.y));
    addMapped(
      {
        type: 'RECTANGLE',
        layer: 'S-COLS',
        props: { corner: [c[0] - w / 2, c[1] - d / 2, 0], width: w, height: d },
      },
      'column',
      col.id,
    );
  }
  for (const beam of floor.beams ?? []) {
    addMapped(
      {
        type: 'LINE',
        layer: 'S-BEAM',
        props: {
          start: canonicalToCotaVec3(beam.startPoint.x, beam.startPoint.y, 0),
          end: canonicalToCotaVec3(beam.endPoint.x, beam.endPoint.y, 0),
        },
      },
      'beam',
      beam.id,
    );
  }

  const bPts = floor.boundary.points;
  if (bPts.length >= 3 && colXs.size >= 2 && colYs.size >= 2) {
    const minX = Math.min(...bPts.map(p => p.x)) - 1200;
    const maxX = Math.max(...bPts.map(p => p.x)) + 1200;
    const minY = Math.min(...bPts.map(p => p.y)) - 1200;
    const maxY = Math.max(...bPts.map(p => p.y)) + 1200;
    [...colXs].sort((a, b) => a - b).slice(0, 12).forEach((gx, idx) => {
      addMapped(
        {
          type: 'LINE',
          layer: 'S-GRID',
          props: { start: canonicalToCotaVec3(gx, minY, 0), end: canonicalToCotaVec3(gx, maxY, 0) },
        },
        'grid',
        `${floor.id}::grid_x_${idx + 1}`,
      );
    });
    [...colYs].sort((a, b) => a - b).slice(0, 12).forEach((gy, idx) => {
      addMapped(
        {
          type: 'LINE',
          layer: 'S-GRID',
          props: { start: canonicalToCotaVec3(minX, gy, 0), end: canonicalToCotaVec3(maxX, gy, 0) },
        },
        'grid',
        `${floor.id}::grid_y_${idx + 1}`,
      );
    });
  }

  // 8. Overall Envelope Linear Dimensions (`A-DIMS`)
  if (bPts.length >= 3) {
    const minX = Math.min(...bPts.map(p => p.x));
    const maxX = Math.max(...bPts.map(p => p.x));
    const minY = Math.min(...bPts.map(p => p.y));
    const maxY = Math.max(...bPts.map(p => p.y));
    const dimStyle = doc.newDimStyleProps();
    addMapped(
      {
        type: 'DIMENSION',
        layer: 'A-DIMS',
        props: {
          dimType: 'LINEAR',
          points: [canonicalToCotaVec3(minX, minY, 0), canonicalToCotaVec3(maxX, minY, 0)],
          textPos: canonicalToCotaVec3((minX + maxX) / 2, minY - 1100, 0),
          ...dimStyle,
        },
      },
      'dimension',
      `${floor.id}::dim_overall_width`,
    );
    addMapped(
      {
        type: 'DIMENSION',
        layer: 'A-DIMS',
        props: {
          dimType: 'LINEAR',
          points: [canonicalToCotaVec3(minX, minY, 0), canonicalToCotaVec3(minX, maxY, 0)],
          textPos: canonicalToCotaVec3(minX - 1100, (minY + maxY) / 2, 0),
          rotation: 90,
          ...dimStyle,
        },
      },
      'dimension',
      `${floor.id}::dim_overall_depth`,
    );
  }

  // 9. Preserve user-authored non-canonical CAD entities (`0`, `C-*` layers) across model syncs
  if (options.preserveNonCanonicalFrom) {
    const mappedLayers = new Set([
      'A-BOUNDARY', 'A-SLAB', 'A-WALL', 'A-DOOR', 'A-GLAZ', 'A-ROOM', 'A-STAIR',
      'S-COLS', 'S-BEAM', 'S-GRID', 'A-DIMS', 'A-ANNO', 'A-3D-SOLID',
    ]);
    for (const existing of options.preserveNonCanonicalFrom.modelEntities) {
      if (!mappedLayers.has(existing.layer)) {
        doc.addEntity({
          type: existing.type,
          layer: existing.layer,
          color: existing.color,
          lineWeight: existing.lineWeight,
          lineType: existing.lineType,
          ltScale: existing.ltScale,
          props: structuredClone(existing.props),
        } as EntityInput);
      }
    }
  }

  // 10. Populate Paper-Space Layout1 (`A3` sheet frame + titleblock + scaled model viewport)
  const layout = doc.getLayout('L1');
  if (layout && layout.entities.length === 0) {
    const extPts = bPts.length >= 3 ? bPts : [{ x: 0, y: 0 }, { x: 20000, y: 20000 }];
    const cx = (Math.min(...extPts.map(p => p.x)) + Math.max(...extPts.map(p => p.x))) / 2;
    const cy = (Math.min(...extPts.map(p => p.y)) + Math.max(...extPts.map(p => p.y))) / 2;
    const spanX = Math.max(4000, Math.max(...extPts.map(p => p.x)) - Math.min(...extPts.map(p => p.x)) + 4000);
    const spanY = Math.max(4000, Math.max(...extPts.map(p => p.y)) - Math.min(...extPts.map(p => p.y)) + 4000);
    const vpW = 310;
    const vpH = 235;
    const scale = Math.min(vpW / spanX, vpH / spanY);
    doc.setActiveTab('L1');
    doc.addEntity({
      type: 'RECTANGLE',
      layer: '0',
      props: { corner: [10, 10, 0], width: 400, height: 277 },
    });
    doc.addEntity({
      type: 'VIEWPORT',
      layer: '0',
      props: {
        center: [175, 152, 0],
        width: vpW,
        height: vpH,
        target: canonicalToCotaVec3(cx, cy, 0),
        az: 0,
        el: Math.PI / 2,
        scale,
        locked: false,
        on: true,
        visualStyle: '2dwireframe',
        shadePlot: 'asDisplayed',
        frozenLayers: ['A-3D-SOLID'],
      },
    });
    doc.addEntity({
      type: 'TEXT',
      layer: '0',
      props: {
        position: [340, 42, 0],
        text: `${building.name}\n${floor.name} · Rev ${source.revision}\nPRELIMINARY — PROFESSIONAL REVIEW REQUIRED`,
        height: 3.5,
        rotation: 0,
        justify: 'left',
        normal: [0, 0, 1],
        kind: 'mtext',
        fitWidth: 66,
      },
    });
    doc.setActiveTab(MODEL_TAB);
  }

  return { doc, links, floor, source };
}

function projectPointOntoWallSegment(pt: Point, wall: Wall): Point {
  const dx = wall.endPoint.x - wall.startPoint.x;
  const dy = wall.endPoint.y - wall.startPoint.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return { ...wall.startPoint };
  const t = Math.max(0.05, Math.min(0.95, ((pt.x - wall.startPoint.x) * dx + (pt.y - wall.startPoint.y) * dy) / len2));
  return {
    x: Math.round(wall.startPoint.x + dx * t),
    y: Math.round(wall.startPoint.y + dy * t),
  };
}

/**
 * Computes a validated preview of canonical architectural changes from Cota CAD edits
 * (plus any explicitly user-selected CAD `LINE` entity IDs requested for wall promotion).
 */
export function buildCanonicalWritebackPreview(params: {
  readonly currentBuilding: Building;
  readonly expectedSource: CanonicalExchangeRevision;
  readonly doc: DocumentModel;
  readonly links: readonly CotaCanonicalEntityLink[];
  readonly floorId: string;
  readonly explicitPromoteLineIds?: readonly string[];
}): CanonicalWritebackPreview {
  const { currentBuilding, expectedSource, doc, links, floorId, explicitPromoteLineIds = [] } = params;
  const actualHash = canonicalBuildingHash(currentBuilding);
  if (
    currentBuilding.version !== expectedSource.revision ||
    actualHash !== expectedSource.sha256 ||
    currentBuilding.id !== expectedSource.buildingId
  ) {
    return {
      ok: false,
      staleRevision: true,
      sourceRevision: expectedSource.revision,
      nextRevision: currentBuilding.version,
      changes: [],
      blockingFindings: [
        `Stale CAD session: expected Building revision ${expectedSource.revision} (${expectedSource.sha256.slice(0, 8)}), but authoritative model is revision ${currentBuilding.version} (${actualHash.slice(0, 8)}). Reload canonical projection first.`,
      ],
      warnings: [],
    };
  }

  const floorIndex = currentBuilding.floors.findIndex(f => f.id === floorId);
  if (floorIndex < 0) {
    return {
      ok: false,
      staleRevision: false,
      sourceRevision: currentBuilding.version,
      nextRevision: currentBuilding.version,
      changes: [],
      blockingFindings: [`Active floor "${floorId}" no longer exists in the canonical Building.`],
      warnings: [],
    };
  }

  const sourceFloor = currentBuilding.floors[floorIndex]!;
  const doors: Door[] = [...sourceFloor.doors];
  const windows: Window[] = [...sourceFloor.windows];
  const walls: Wall[] = [...sourceFloor.walls];

  const entityById = new Map(doc.modelEntities.map(e => [e.id, e]));
  const changes: CanonicalWritebackChange[] = [];
  const warnings: string[] = [];

  for (const link of links) {
    if (link.floorId !== floorId) continue;
    const cadEnt = entityById.get(link.cotaEntityId);
    if (!cadEnt) continue;

    if ((link.canonicalKind === 'door' || link.canonicalKind === 'window') && cadEnt.type === 'LINE') {
      const p1 = cotaVec3ToCanonical(cadEnt.props.start);
      const p2 = cotaVec3ToCanonical(cadEnt.props.end);
      const mid: Point = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const newWidth = Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y));
      if (link.canonicalKind === 'door') {
        const doorIdx = doors.findIndex(d => d.id === link.canonicalId);
        const door = doorIdx >= 0 ? doors[doorIdx] : undefined;
        const host = door ? walls.find(w => w.id === door.wallId) : undefined;
        if (door && host) {
          const snappedMid = projectPointOntoWallSegment(mid, host);
          const posMoved = Math.hypot(snappedMid.x - door.position.x, snappedMid.y - door.position.y) >= 5;
          const widthChanged = Math.abs(newWidth - door.width) >= 5 && newWidth >= 600 && newWidth <= 2400;
          if (posMoved || widthChanged) {
            doors[doorIdx] = {
              ...door,
              position: posMoved ? snappedMid : door.position,
              width: widthChanged ? newWidth : door.width,
            };
            changes.push({
              cotaEntityId: cadEnt.id,
              canonicalKind: 'door',
              canonicalId: door.id,
              operation: widthChanged ? 'resize_opening' : 'reposition_opening',
              summary: `Updated door ${door.id} (${widthChanged ? `width ${door.width} -> ${newWidth} mm` : `moved along host wall ${host.id}`})`,
            });
          }
        }
      } else {
        const winIdx = windows.findIndex(w => w.id === link.canonicalId);
        const win = winIdx >= 0 ? windows[winIdx] : undefined;
        const host = win ? walls.find(w => w.id === win.wallId) : undefined;
        if (win && host) {
          const snappedMid = projectPointOntoWallSegment(mid, host);
          const posMoved = Math.hypot(snappedMid.x - win.position.x, snappedMid.y - win.position.y) >= 5;
          const widthChanged = Math.abs(newWidth - win.width) >= 5 && newWidth >= 450 && newWidth <= 3600;
          if (posMoved || widthChanged) {
            windows[winIdx] = {
              ...win,
              position: posMoved ? snappedMid : win.position,
              width: widthChanged ? newWidth : win.width,
            };
            changes.push({
              cotaEntityId: cadEnt.id,
              canonicalKind: 'window',
              canonicalId: win.id,
              operation: widthChanged ? 'resize_opening' : 'reposition_opening',
              summary: `Updated window ${win.id} (${widthChanged ? `width ${win.width} -> ${newWidth} mm` : `moved along host wall ${host.id}`})`,
            });
          }
        }
      }
    }
  }

  // Explicit user-requested CAD line -> interior partition promotion (NEVER automatic!)
  const linkedIds = new Set(links.map(l => l.cotaEntityId));
  for (const lineId of explicitPromoteLineIds) {
    if (linkedIds.has(lineId)) {
      warnings.push(`Entity ${lineId} is already mapped to canonical geometry.`);
      continue;
    }
    const cadEnt = entityById.get(lineId);
    if (!cadEnt || cadEnt.type !== 'LINE') {
      warnings.push(`Entity ${lineId} is not a 2D CAD LINE; only explicit LINE segments can be promoted to partitions.`);
      continue;
    }
    const start = cotaVec3ToCanonical(cadEnt.props.start);
    const end = cotaVec3ToCanonical(cadEnt.props.end);
    const lenMm = Math.hypot(end.x - start.x, end.y - start.y);
    if (lenMm < 600) {
      warnings.push(`CAD line ${lineId} is ${Math.round(lenMm)} mm (< 600 mm minimum architectural partition length).`);
      continue;
    }
    const newWallId = `${floorId}::cota_wall_${lineId}`;
    walls.push({
      id: newWallId,
      floorId,
      type: walls.find(w => w.wallUse === 'INTERNAL_PARTITION')?.type ?? WallType.Partition,
      wallUse: 'INTERNAL_PARTITION',
      provenance: 'USER_PROVIDED',
      startPoint: { x: Math.round(start.x), y: Math.round(start.y) },
      endPoint: { x: Math.round(end.x), y: Math.round(end.y) },
      thickness: 115,
      heightMm: sourceFloor.floorHeight || 3000,
      roomIds: [],
      hasOpening: false,
      loadBearing: false,
    });
    changes.push({
      cotaEntityId: lineId,
      canonicalKind: 'wall',
      canonicalId: newWallId,
      operation: 'promote_cad_partition',
      summary: `Promoted CAD line ${lineId} (${Math.round(lenMm)} mm) to 115 mm interior partition ${newWallId}`,
    });
  }

  if (changes.length === 0) {
    return {
      ok: false,
      staleRevision: false,
      sourceRevision: currentBuilding.version,
      nextRevision: currentBuilding.version,
      changes: [],
      blockingFindings: ['No mapped canonical opening edits or explicitly promoted CAD partition lines were detected.'],
      warnings,
    };
  }

  const fittedFloor = fitFloorOpeningsInsideWalls({
    ...sourceFloor,
    walls,
    doors,
    windows,
  });
  const nextBuilding: Building = {
    ...currentBuilding,
    floors: currentBuilding.floors.map((f, idx) => (idx === floorIndex ? fittedFloor : f)),
    version: currentBuilding.version + 1,
    updatedAt: new Date().toISOString(),
  };

  const schemaErrors: string[] = [];
  try {
    const schemaCheck = validateBuildingSchema(nextBuilding);
    for (const err of schemaCheck) {
      schemaErrors.push(`${err.path}: ${err.message}`);
    }
  } catch (err) {
    schemaErrors.push(err instanceof Error ? err.message : String(err));
  }

  const baselineBlockers = new Set<string>([
    ...validateApartmentClosure(currentBuilding).issues
      .filter(i => i.severity === 'error')
      .map(i => `${i.code}: ${i.message}`),
    ...generationBlockingFindings(currentBuilding).map(f => `${f.code}: ${f.message}`),
  ]);

  const closure = validateApartmentClosure(nextBuilding);
  const closureBlockers = closure.issues
    .filter(i => i.severity === 'error')
    .map(i => `${i.code}: ${i.message}`);
  const genBlockers = generationBlockingFindings(nextBuilding).map(f => `${f.code}: ${f.message}`);

  const newlyIntroducedBlockers = [...closureBlockers, ...genBlockers].filter(b => !baselineBlockers.has(b));
  const preExistingAdvisories = [...closureBlockers, ...genBlockers].filter(b => baselineBlockers.has(b));
  for (const adv of preExistingAdvisories) {
    warnings.push(`Pre-existing model advisory preserved: ${adv}`);
  }

  const blockingFindings = [...schemaErrors, ...newlyIntroducedBlockers];
  return {
    ok: blockingFindings.length === 0,
    staleRevision: false,
    sourceRevision: currentBuilding.version,
    nextRevision: nextBuilding.version,
    changes,
    blockingFindings,
    warnings,
    ...(blockingFindings.length === 0 ? { candidateBuilding: nextBuilding } : {}),
  };
}

import { DoorType, isPhysicalBoundary, type Door, type Floor, type Window } from '@ai-floor-planner/core';
import {
  canonicalCurvedOpeningGeometry,
  canonicalOpeningGeometry,
  measureApartmentAreaLedger,
  polygonArea,
  roomSpaceUse,
} from '@ai-floor-planner/geometry-engine';
import type { FloorPlate3D, Wall3D } from '@ai-floor-planner/projection-3d';

export type BimKind = 'room' | 'flat' | 'wall' | 'door' | 'window' | 'slab' | 'stair';
export interface BimQuantityRow {
  readonly kind: BimKind;
  readonly id: string;
  readonly name: string;
  readonly ifcClass?: string;
  readonly modeledAreaMm2?: number;
  readonly areaMm2?: number;
  readonly volumeMm3?: number;
  readonly lengthMm?: number;
  readonly widthMm?: number;
  readonly heightMm?: number;
  readonly material?: string;
  readonly hostWallId?: string;
  readonly riserCount?: number;
}

interface OpeningRectangle { start: number; end: number; bottom: number; top: number }

/** Union the cut-outs of a wall's elevation before computing its component volume. */
function openingUnion(rectangles: readonly OpeningRectangle[]) {
  const edges = [...new Set(rectangles.flatMap(r => [r.start, r.end]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < edges.length; i++) {
    const left = edges[i - 1]!;
    const right = edges[i]!;
    const ranges = rectangles.filter(r => r.start < right && r.end > left).sort((a, b) => a.bottom - b.bottom);
    let top = 0;
    for (const range of ranges) {
      area += Math.max(0, range.top - Math.max(top, range.bottom)) * (right - left);
      top = Math.max(top, range.top);
    }
  }
  return area;
}

export function calculateBimSchedule(floor: Floor, projectedWalls: readonly Wall3D[], plate?: FloorPlate3D) {
  const ledger = measureApartmentAreaLedger(floor);
  const portalRows: BimQuantityRow[] = [];
  const openingsByWall = new Map<string, Array<Door | Window>>();
  for (const [kind, entries] of [['door', floor.doors], ['window', floor.windows]] as const) {
    for (const opening of entries) {
      const hosted = openingsByWall.get(opening.wallId) ?? [];
      hosted.push(opening);
      openingsByWall.set(opening.wallId, hosted);
      portalRows.push({
        kind, id: opening.id, name: opening.type, hostWallId: opening.wallId,
        ifcClass: opening.type === DoorType.OpenPassage ? 'IfcOpeningElement' : kind === 'door' ? 'IfcDoor' : 'IfcWindow',
        widthMm: opening.width, heightMm: opening.height, material: opening.materialId,
        areaMm2: opening.width * opening.height,
      });
    }
  }
  const projected = new Map(projectedWalls.map(w => [w.sourceEntityId, w]));
  const walls: BimQuantityRow[] = floor.walls.filter(isPhysicalBoundary).map(wall => {
    const view = projected.get(wall.id);
    const lengthMm = wall.arc
      ? wall.arc.radiusMm * Math.abs(wall.arc.endAngleRad - wall.arc.startAngleRad)
      : Math.hypot(wall.endPoint.x - wall.startPoint.x, wall.endPoint.y - wall.startPoint.y);
    // The canonical height comes from the same projection used by IFC. Derived display defaults do not establish a quantity.
    const heightMm = wall.heightMm ?? (floor.architecture && floor.slabThicknessMm !== undefined ? view?.height : undefined);
    const hosted = openingsByWall.get(wall.id) ?? [];
    let areaMm2: number | undefined;
    if (heightMm !== undefined && heightMm > 0) {
      const rectangles: OpeningRectangle[] = [];
      for (const opening of hosted) {
        try {
          const { start, end } = wall.arc
            ? canonicalCurvedOpeningGeometry(opening, wall)
            : canonicalOpeningGeometry(opening, wall);
          const bottom = 'sillHeight' in opening ? opening.sillHeight : 0;
          if (bottom < 0 || bottom + opening.height > heightMm) break;
          rectangles.push({ start, end, bottom, top: bottom + opening.height });
        } catch { break; }
      }
      if (rectangles.length === hosted.length) areaMm2 = lengthMm * heightMm - openingUnion(rectangles);
    }
    return { kind: 'wall', id: wall.id, name: wall.wallUse ?? 'Wall', ifcClass: wall.boundaryRole === 'GUARDRAIL' ? 'IfcRailing' : 'IfcWall',
      lengthMm, widthMm: wall.thickness, heightMm, material: wall.material, areaMm2,
      volumeMm3: areaMm2 === undefined ? undefined : areaMm2 * wall.thickness };
  });
  const rooms: BimQuantityRow[] = floor.rooms.map(room => ({
    kind: 'room', id: room.id, name: room.name, ifcClass: room.openToSky || room.spaceUse === 'VOID' ? undefined : 'IfcSpace',
    areaMm2: polygonArea(room.boundary), modeledAreaMm2: ledger.supported ? ledger.roomUsable[room.id] ?? 0 : undefined,
  }));
  const netByUnit = new Map<string, number>();
  for (const room of floor.rooms) {
    if (!room.unitId || (room.spaceUse ?? roomSpaceUse(room)) !== 'UNIT') continue;
    netByUnit.set(room.unitId, (netByUnit.get(room.unitId) ?? 0) + (ledger.roomUsable[room.id] ?? 0));
  }
  const flats: BimQuantityRow[] = (floor.apartmentUnits ?? []).map(unit => ({
    kind: 'flat', id: unit.id, name: unit.unitType, areaMm2: polygonArea(unit.boundary),
    modeledAreaMm2: ledger.supported ? netByUnit.get(unit.id) ?? 0 : undefined,
  }));
  const stairs: BimQuantityRow[] = floor.stairs.map(stair => ({
    kind: 'stair', id: stair.id, name: stair.type, riserCount: stair.riserCount, areaMm2: polygonArea(stair.boundary),
  }));
  const slabAreaMm2 = plate && polygonArea(plate.boundary) - plate.cutouts.reduce((sum, hole, i, all) => {
    const key = JSON.stringify([...hole.points].map(p => [p.x, p.y]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!));
    const first = all.findIndex(other =>
      JSON.stringify([...other.points].map(p => [p.x, p.y]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!)) === key);
    return sum + (first === i ? polygonArea(hole) : 0);
  }, 0);
  const slab: BimQuantityRow[] = slabAreaMm2 === undefined ? [] : [{ kind: 'slab', id: floor.id,
    name: floor.name + ' slab', ifcClass: floor.slabThicknessMm ? 'IfcSlab' : undefined, areaMm2: slabAreaMm2,
    heightMm: floor.slabThicknessMm, volumeMm3: floor.slabThicknessMm === undefined ? undefined : slabAreaMm2 * floor.slabThicknessMm }];
  return {
    rows: [...rooms, ...flats, ...walls, ...portalRows, ...slab, ...stairs],
    grossAreaMm2: ledger.gross,
    slabAreaMm2,
    modeledCarpetMm2: ledger.supported ? ledger.unitUsable : undefined,
    balconyMm2: ledger.supported ? ledger.balconies.filter(balcony =>
      floor.rooms.some(room => room.id === balcony.id && room.type === 'balcony')).reduce((sum, balcony) => sum + balcony.area, 0) : undefined,
    commonMm2: ledger.supported ? ledger.common : undefined,
    areaLedgerSupported: ledger.supported,
  };
}

export function scheduleCsv(rows: readonly BimQuantityRow[]) {
  const cell = (value?: string | number) => {
    if (value === undefined) return '';
    if (typeof value === 'number') return String(value);
    const safe = /^[\s]*[=+@\-\t\r\n]/.test(value) ? "'" + value : value;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  return ['Kind,Canonical ID,Name,IFC class,Geometric area (mm2),Modeled usable area (mm2),Volume (mm3),Length (mm),Width (mm),Height (mm),Material,Host wall,Risers',
    ...rows.map(r => [r.kind, r.id, r.name, r.ifcClass, r.areaMm2, r.modeledAreaMm2, r.volumeMm3,
      r.lengthMm, r.widthMm, r.heightMm, r.material, r.hostWallId, r.riserCount].map(cell).join(',')),
  ].join('\r\n');
}

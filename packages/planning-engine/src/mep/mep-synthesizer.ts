/**
 * Phase 3 — deterministic coordinated MEP synthesis.
 *
 * Produces a drafting-level `CoordinatedMepEngineeringPlan` for a generated
 * building: electrical (M-ELEC), plumbing & vertical stacks (M-PLUMB),
 * reflected ceiling (A-CEIL), fire safety (F-FIRE) and cantilever balcony
 * framing (S-BEAM-CANTILEVER). It reads canonical geometry only and never
 * mutates it, so planar area conservation is untouched.
 *
 * Every element is a coordination proposal for professional review, not a
 * certified engineering design.
 */
import {
  RoomType,
  DoorType,
  PLUMBING_RISER_TAG,
  SHARED_PLUMBING_RISER_TAG,
  type Building,
  type CantileverBeam,
  type CeilingZone,
  type CoordinatedMepEngineeringPlan,
  type Door,
  type Floor,
  type FloorMepEngineeringPlan,
  type MepRun,
  type MepSymbol,
  type MepSymbolKind,
  type Point,
  type Polygon,
  type Room,
  type Wall,
} from '@ai-floor-planner/core';
import { pointInPolygon, polygonIntersectionArea } from '@ai-floor-planner/geometry-engine';
import { PLUMB_SHAFT_MIN } from './wet-wall-risers';

interface Box { x: number; y: number; w: number; h: number }

const ELECTRICAL_KINDS = new Set<MepSymbolKind>(['DB', 'FAN', 'DL', 'SB', 'SB_2WAY', 'SOCKET_16A', 'GY', 'AC_IDU', 'AC_ODU']);
const PLUMBING_KINDS = new Set<MepSymbolKind>(['PLUMB_SHAFT', 'FT', 'NT']);

const LABELS: Readonly<Record<MepSymbolKind, string>> = {
  DB: 'DB', FAN: 'FAN', DL: 'DL', SB: 'SB', SB_2WAY: '2W-SB', SOCKET_16A: '16A', GY: 'GY',
  AC_IDU: 'AC-IDU', AC_ODU: 'AC-ODU', PLUMB_SHAFT: 'PLUMB SHAFT', FT: 'FT', NT: 'NT',
  FHR: 'FHR', FHR_HR: 'FHR-HR', FACP: 'FACP', SD: 'SD', HD: 'HD', EXIT_SIGN: 'EXIT', SPRINKLER: 'SPK',
};

export { PLUMB_SHAFT_MIN };
export const COVE_INSET_MM = 450;
export const CEILING_GRID_MM = 600;
export const SPRINKLER_SPACING_MM = 3000;
export const SWITCH_OFFSET_FROM_FRAME_MM = 150;

const r10 = (v: number) => Math.round(v / 10) * 10;

export function roomBox(room: Room): Box {
  const pts = room.boundary?.points ?? [];
  if (!pts.length) return { x: room.x, y: room.y, w: room.width, h: room.height };
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const center = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const inside = (b: Box, p: Point, tol = 0) => p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
const rectOutline = (b: Box): Point[] => [
  { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h },
];

const isLivingLike = (r: Room) => [RoomType.Living, RoomType.Dining, RoomType.FamilyLiving, RoomType.Drawing].includes(r.type);
const isBedroom = (r: Room) => r.type === RoomType.Bedroom;
const isBath = (r: Room) => r.type === RoomType.Bathroom;
const isKitchen = (r: Room) => r.type === RoomType.Kitchen;
const isWetTrapRoom = (r: Room) => isBath(r) || r.type === RoomType.Utility || r.type === RoomType.Balcony;
const isCommonCirculation = (r: Room) =>
  !r.unitId && (r.type === RoomType.Corridor || r.type === RoomType.Foyer || r.architecturalRole === 'LIFT_LOBBY')
  && r.architecturalRole !== 'VEHICLE_AISLE';
const isStilt = (f: Floor) => f.floorUse === 'STILT_PARKING' || /STILT/i.test(f.name);
const isRoof = (f: Floor) => f.floorUse === 'ROOF' || /TERRACE|ROOF/i.test(f.name);
const isResidential = (f: Floor) => !isStilt(f) && !isRoof(f) && f.rooms.some(r => r.unitId);

function wallDir(w: Wall): Point {
  const dx = w.endPoint.x - w.startPoint.x, dy = w.endPoint.y - w.startPoint.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** Unit normal of a wall pointing into the given room box. */
function inwardNormal(w: Wall, b: Box): Point {
  const d = wallDir(w);
  const n = { x: -d.y, y: d.x };
  const mid = { x: (w.startPoint.x + w.endPoint.x) / 2, y: (w.startPoint.y + w.endPoint.y) / 2 };
  const c = center(b);
  return (c.x - mid.x) * n.x + (c.y - mid.y) * n.y >= 0 ? n : { x: -n.x, y: -n.y };
}

const wallRoomIds = (w: Wall): readonly string[] => (w as unknown as { roomIds?: readonly string[] }).roomIds ?? [];

function exteriorWalls(floor: Floor, room: Room): Wall[] {
  return floor.walls.filter(w => {
    const ids = wallRoomIds(w);
    return ids.includes(room.id) && (w.wallUse === 'EXTERNAL' || ids.length === 1) && Math.hypot(w.endPoint.x - w.startPoint.x, w.endPoint.y - w.startPoint.y) >= 1200;
  });
}

class FloorBuilder {
  readonly symbols: MepSymbol[] = [];
  readonly runs: MepRun[] = [];
  readonly ceilings: CeilingZone[] = [];
  readonly cantileverBeams: CantileverBeam[] = [];
  private n = 0;
  constructor(readonly floor: Floor) {}
  id(prefix: string) { return `${this.floor.id}::mep_${prefix}_${++this.n}`; }
  sym(kind: MepSymbolKind, position: Point, extra: Partial<MepSymbol> = {}): MepSymbol {
    const discipline = ELECTRICAL_KINDS.has(kind) ? 'ELECTRICAL' : PLUMBING_KINDS.has(kind) ? 'PLUMBING' : 'FIRE';
    const layer = discipline === 'ELECTRICAL' ? 'M-ELEC-SYMB' : discipline === 'PLUMBING' ? 'M-PLUMB-FIXT' : 'F-FIRE-SYMB';
    const s: MepSymbol = {
      id: this.id(kind.toLowerCase()), kind, discipline, layer,
      position: { x: r10(position.x), y: r10(position.y) }, label: LABELS[kind], ...extra,
    };
    this.symbols.push(s);
    return s;
  }
  run(kind: MepRun['kind'], points: Point[], extra: Partial<MepRun> = {}): void {
    const distinct = points.filter((p, idx, arr) => idx === 0 || p.x !== arr[idx - 1]!.x || p.y !== arr[idx - 1]!.y);
    if (distinct.length < 2) return;
    const electrical = kind === 'WIRING_LOOP';
    const defaultSlope = kind === 'SP' ? '1:60' : kind === 'WP' ? '1:50' : undefined;
    this.runs.push({
      id: this.id(kind.toLowerCase()), kind,
      discipline: electrical ? 'ELECTRICAL' : 'PLUMBING',
      layer: electrical ? 'M-ELEC-WIRE' : 'M-PLUMB-PIPE',
      points: distinct,
      lengthMm: polylineLengthMm(distinct),
      ...(kind === 'SP' ? { diameterMm: 110 } : kind === 'WP' ? { diameterMm: 75 } : kind === 'CWS' || kind === 'HWS' ? { diameterMm: 20 } : {}),
      ...(defaultSlope ? { slopeRatio: defaultSlope } : {}),
      ...extra,
    });
  }
  build(): FloorMepEngineeringPlan {
    return { floorId: this.floor.id, floorLevel: this.floor.level, symbols: this.symbols, runs: this.runs, ceilings: this.ceilings, cantileverBeams: this.cantileverBeams };
  }
}

/** Switchboard 150 mm beyond the door frame on the handle side, inside the room. */
function switchboardForDoor(floor: Floor, door: Door, room: Room): Point | null {
  const wall = floor.walls.find(w => w.id === door.wallId);
  if (!wall) return null;
  const b = roomBox(room);
  const d = wallDir(wall);
  const n = inwardNormal(wall, b);
  const along = door.width / 2 + SWITCH_OFFSET_FROM_FRAME_MM;
  for (const sgn of [1, -1]) {
    const p = { x: door.position.x + d.x * along * sgn + n.x * 100, y: door.position.y + d.y * along * sgn + n.y * 100 };
    if (inside(b, p)) return p;
  }
  return null;
}

/** A stack requires a physical reservation linked to the bathroom. */
function shaftForBath(floor: Floor, bath: Room): Box | undefined {
  const reserved = floor.rooms.find(room => room.type === RoomType.ServiceShaft && room.tags.some(tag =>
    tag.startsWith(PLUMBING_RISER_TAG) && bath.tags.includes('apt-room:' + tag.slice(PLUMBING_RISER_TAG.length))));
  return reserved ? roomBox(reserved) : undefined;
}

function synthesizeUnitElectrical(fb: FloorBuilder, floor: Floor, unitRooms: Room[], unitId: string): void {
  const roomIds = new Set(unitRooms.map(r => r.id));
  const entrance = floor.doors.find(d => {
    const [a, b] = d.connectsRooms;
    return (roomIds.has(a) && !roomIds.has(b)) || (roomIds.has(b) && !roomIds.has(a));
  });
  const entryRoom = entrance ? unitRooms.find(r => entrance.connectsRooms.includes(r.id)) : unitRooms.find(isLivingLike);
  let db: MepSymbol | undefined;
  if (entryRoom) {
    const b = roomBox(entryRoom);
    const sb = entrance ? switchboardForDoor(floor, entrance, entryRoom) : null;
    const base = sb ?? { x: b.x + 300, y: b.y + 300 };
    const c = center(b);
    const len = Math.hypot(c.x - base.x, c.y - base.y) || 1;
    const p = { x: base.x + ((c.x - base.x) / len) * 250, y: base.y + ((c.y - base.y) / len) * 250 };
    db = fb.sym('DB', inside(b, p) ? p : c, { roomId: entryRoom.id, unitId, label: 'DB (MAIN)' });
  }
  const fans: Point[] = [];
  const bedrooms = unitRooms.filter(isBedroom);
  const master = bedrooms.find(r => /master/i.test(r.name)) ?? [...bedrooms].sort((a, b) => b.area - a.area)[0];
  for (const room of unitRooms) {
    const b = roomBox(room);
    const c = center(b);
    if (isLivingLike(room) || isBedroom(room)) {
      fb.sym('FAN', c, { roomId: room.id, unitId });
      fans.push(c);
      const off = Math.max(b.w, b.h) / 4;
      const horizontal = b.w >= b.h;
      fb.sym('DL', horizontal ? { x: c.x - off, y: c.y } : { x: c.x, y: c.y - off }, { roomId: room.id, unitId });
      fb.sym('DL', horizontal ? { x: c.x + off, y: c.y } : { x: c.x, y: c.y + off }, { roomId: room.id, unitId });
      for (const wall of exteriorWalls(floor, room).slice(0, 1)) {
        const mid = { x: (wall.startPoint.x + wall.endPoint.x) / 2, y: (wall.startPoint.y + wall.endPoint.y) / 2 };
        const n = inwardNormal(wall, b);
        fb.sym('AC_IDU', { x: mid.x + n.x * 200, y: mid.y + n.y * 200 }, { roomId: room.id, unitId, widthMm: 900, depthMm: 250 });
        fb.sym('AC_ODU', { x: mid.x - n.x * 450, y: mid.y - n.y * 450 }, { roomId: room.id, unitId, widthMm: 850, depthMm: 350 });
      }
    }
    if (room === master) {
      const side = b.w >= b.h ? { x: 0, y: 1 } : { x: 1, y: 0 };
      const spread = Math.min(b.w, b.h) * 0.3;
      fb.sym('SB_2WAY', { x: c.x - side.x * spread, y: c.y - side.y * spread }, { roomId: room.id, unitId, label: '2W-SB L' });
      fb.sym('SB_2WAY', { x: c.x + side.x * spread, y: c.y + side.y * spread }, { roomId: room.id, unitId, label: '2W-SB R' });
    }
    if (isKitchen(room)) {
      const labels = ['16A FRIDGE', '16A MICROWAVE', '16A HOB/CHIMNEY'];
      labels.forEach((label, i) => {
        const t = (i + 1) / (labels.length + 1);
        fb.sym('SOCKET_16A', b.w >= b.h ? { x: b.x + b.w * t, y: b.y + 150 } : { x: b.x + 150, y: b.y + b.h * t }, { roomId: room.id, unitId, label });
      });
    }
    if (isBath(room)) {
      fb.sym('GY', { x: b.x + b.w - 300, y: b.y + 300 }, { roomId: room.id, unitId, label: 'GY 16A' });
    }
    // Switchboards beside every hinged room entry door.
    for (const door of floor.doors.filter(d => d.connectsRooms.includes(room.id) && d.type !== DoorType.OpenPassage)) {
      if (isBalconyLike(room)) continue;
      const p = switchboardForDoor(floor, door, room);
      if (p) fb.sym('SB', p, { roomId: room.id, unitId, label: 'SB 6A' });
    }
  }
  if (db && fans.length) fb.run('WIRING_LOOP', [db.position, ...fans], { roomId: db.roomId });
}

const isBalconyLike = (r: Room) => r.type === RoomType.Balcony;

function polylineLengthMm(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    sum += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return sum;
}

function clampPointToBox(target: Point, box: Box, insetMm = 100): Point {
  const ix = Math.min(insetMm, box.w / 2);
  const iy = Math.min(insetMm, box.h / 2);
  return {
    x: Math.max(box.x + ix, Math.min(box.x + box.w - ix, target.x)),
    y: Math.max(box.y + iy, Math.min(box.y + box.h - iy, target.y)),
  };
}

function segmentCrossesBoxInterior(a: Point, b: Point, box: Box, margin = 0.001): boolean {
  const minX = box.x + margin;
  const maxX = box.x + box.w - margin;
  const minY = box.y + margin;
  const maxY = box.y + box.h - margin;
  if (minX >= maxX || minY >= maxY) return false;
  if (Math.abs(a.x - b.x) < 1) {
    if (a.x <= minX || a.x >= maxX) return false;
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    return Math.min(y1, maxY) > Math.max(y0, minY);
  }
  if (Math.abs(a.y - b.y) < 1) {
    if (a.y <= minY || a.y >= maxY) return false;
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    return Math.min(x1, maxX) > Math.max(x0, minX);
  }
  return false;
}

function routeIsClear(pts: readonly Point[], obstacles: readonly Box[], domain: Polygon): boolean {
  if (!pts.every(point => pointInPolygon(point, domain))) return false;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    if (a.x === b.x && a.y === b.y) continue;
    if (a.x !== b.x && a.y !== b.y) return false;
    if (obstacles.some(obs => segmentCrossesBoxInterior(a, b, obs))) return false;
    // A segment can enter a concave outdoor notch even when its endpoints are inside.
    const horizontal = a.y === b.y;
    const from = horizontal ? a.x : a.y;
    const to = horizontal ? b.x : b.y;
    const fixed = horizontal ? a.y : a.x;
    const cuts = [0, 1];
    for (const [index, p] of domain.points.entries()) {
      const q = domain.points[(index + 1) % domain.points.length]!;
      const pFixed = horizontal ? p.y : p.x, qFixed = horizontal ? q.y : q.x;
      if (pFixed === qFixed || fixed < Math.min(pFixed, qFixed) || fixed > Math.max(pFixed, qFixed)) continue;
      const pAlong = horizontal ? p.x : p.y, qAlong = horizontal ? q.x : q.y;
      const t = (pAlong + (fixed - pFixed) / (qFixed - pFixed) * (qAlong - pAlong) - from) / (to - from);
      if (t > 0 && t < 1) cuts.push(t);
    }
    cuts.sort((x, y) => x - y);
    for (let j = 1; j < cuts.length; j++) {
      const t = (cuts[j - 1]! + cuts[j]!) / 2;
      if (!pointInPolygon({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }, domain)) return false;
    }
  }
  return true;
}

function floorPipeObstacles(floor: Floor): Box[] {
  return floor.rooms
    .filter(room =>
      (room.type === RoomType.Staircase ||
        room.type === RoomType.Lift ||
        room.openToSky === true ||
        room.architecturalRole === 'OPEN_TO_SKY_VOID' ||
        room.architecturalRole === 'VEHICLE_AISLE') &&
      !room.tags.includes(SHARED_PLUMBING_RISER_TAG) &&
      !room.tags.some(tag => tag.startsWith(PLUMBING_RISER_TAG)),
    )
    .map(roomBox);
}

/**
 * Selects an economical single-elbow (or perimeter-skirted) orthogonal route
 * avoiding staircases, lift shafts, and open-to-sky courtyards.
 */
function chooseEconomicalDrainRoute(from: Point, to: Point, obstacles: readonly Box[], domain: Polygon): Point[] | undefined {
  const elbows: Point[][] = [[from, { x: to.x, y: from.y }, to], [from, { x: from.x, y: to.y }, to]];
  const direct = elbows.find(route => routeIsClear(route, obstacles, domain));
  if (direct) return direct;
  return obstacles.flatMap(obs => [
      [from, { x: obs.x - 150, y: from.y }, { x: obs.x - 150, y: to.y }, to],
      [from, { x: obs.x + obs.w + 150, y: from.y }, { x: obs.x + obs.w + 150, y: to.y }, to],
      [from, { x: from.x, y: obs.y - 150 }, { x: to.x, y: obs.y - 150 }, to],
      [from, { x: from.x, y: obs.y + obs.h + 150 }, { x: to.x, y: obs.y + obs.h + 150 }, to],
    ]).filter(route => routeIsClear(route, obstacles, domain))
    .sort((a, b) => polylineLengthMm(a) - polylineLengthMm(b))[0];
}

function synthesizeUnitPlumbing(
  fb: FloorBuilder,
  unitRooms: Room[],
  unitId: string,
  shafts: Map<string, Box>,
  sharedChases: boolean,
  obstacles: readonly Box[],
): void {
  for (const room of unitRooms) {
    const b = roomBox(room);
    if (isWetTrapRoom(room)) fb.sym('FT', { x: b.x + b.w / 2, y: b.y + b.h / 2 }, { roomId: room.id, unitId });
    if (!isBath(room) && !isKitchen(room)) continue;
    const shaft = shafts.get(room.id);
    if (!shaft) continue;
    if (sharedChases) {
      const route = (from: Point, to: Point) => chooseEconomicalDrainRoute(from, to, obstacles, fb.floor.boundary);
      if (isBath(room)) {
        const nt = fb.sym('NT', { x: b.x + b.w * 0.7, y: b.y + b.h * 0.7 }, { roomId: room.id, unitId, label: 'NT (SHOWER)' });
        const wc = { x: b.x + b.w * 0.25, y: b.y + b.h - 450 };
        const basin = { x: b.x + b.w * 0.75, y: b.y + 350 };
        const soilTarget = clampPointToBox(wc, shaft, 120);
        const wasteTarget = clampPointToBox(nt.position, shaft, 120);
        const soil = route(wc, soilTarget);
        const waste = route(nt.position, wasteTarget);
        const basinBranch = route(basin, nt.position);
        if (soil) fb.run('SP', soil, { roomId: room.id });
        if (waste && basinBranch) fb.run('WP', [...basinBranch, ...waste], { roomId: room.id });
        if (soil) fb.run('CWS', [...soil].reverse(), { roomId: room.id });
      } else {
        const sink = { x: b.x + b.w / 2, y: b.y + 350 };
        const sinkTarget = clampPointToBox(sink, shaft, 120);
        const waste = route(sink, sinkTarget);
        if (waste) {
          fb.run('WP', waste, { roomId: room.id });
          fb.run('CWS', [...waste].reverse(), { roomId: room.id });
        }
      }
      continue;
    }
    const sc = center(shaft);
    if (isBath(room)) {
      const nt = fb.sym('NT', { x: b.x + b.w * 0.7, y: b.y + b.h * 0.7 }, { roomId: room.id, unitId, label: 'NT (SHOWER)' });
      const wc = { x: b.x + b.w * 0.25, y: b.y + b.h - 450 };
      const basin = { x: b.x + b.w * 0.75, y: b.y + 350 };
      fb.run('SP', [wc, { x: wc.x, y: sc.y }, sc], { roomId: room.id, slopeRatio: '1:60' });
      fb.run('WP', [basin, { x: basin.x, y: sc.y }, sc], { roomId: room.id, slopeRatio: '1:50' });
      fb.run('WP', [nt.position, { x: nt.position.x, y: sc.y }, sc], { roomId: room.id, slopeRatio: '1:50' });
      fb.run('CWS', [sc, { x: sc.x + 120, y: wc.y }, wc], { roomId: room.id });
      fb.run('HWS', [sc, { x: sc.x - 120, y: basin.y }, basin], { roomId: room.id });
    } else {
      const sink = { x: b.x + b.w / 2, y: b.y + 350 };
      fb.run('WP', [sink, { x: sink.x, y: sc.y }, sc], { roomId: room.id, slopeRatio: '1:50' });
      fb.run('CWS', [sc, { x: sc.x, y: sink.y }, sink], { roomId: room.id });
    }
  }
}

function synthesizeCeilings(fb: FloorBuilder, floor: Floor, rooms: Room[]): void {
  const unitMaster = new Map<string, Room>();
  for (const r of rooms.filter(isBedroom)) {
    const key = r.unitId ?? 'common';
    const cur = unitMaster.get(key);
    if (/master/i.test(r.name) || !cur || (!/master/i.test(cur.name) && r.area > cur.area)) unitMaster.set(key, r);
  }
  const masters = new Set([...unitMaster.values()].map(r => r.id));
  for (const room of rooms) {
    const b = roomBox(room);
    if ((isLivingLike(room) || masters.has(room.id)) && b.w > 2 * COVE_INSET_MM + 600 && b.h > 2 * COVE_INSET_MM + 600) {
      fb.ceilings.push({
        id: fb.id('cove'), kind: 'COVE_GYPSUM', roomId: room.id, insetMm: COVE_INSET_MM,
        outline: rectOutline({ x: b.x + COVE_INSET_MM, y: b.y + COVE_INSET_MM, w: b.w - 2 * COVE_INSET_MM, h: b.h - 2 * COVE_INSET_MM }),
      });
    }
    if (isBath(room) || room.type === RoomType.Corridor && room.architecturalRole !== 'VEHICLE_AISLE') {
      const gridLines: [Point, Point][] = [];
      for (let x = b.x + CEILING_GRID_MM; x < b.x + b.w; x += CEILING_GRID_MM) gridLines.push([{ x, y: b.y }, { x, y: b.y + b.h }]);
      for (let y = b.y + CEILING_GRID_MM; y < b.y + b.h; y += CEILING_GRID_MM) gridLines.push([{ x: b.x, y }, { x: b.x + b.w, y }]);
      fb.ceilings.push({ id: fb.id('grid'), kind: 'GRID_600', roomId: room.id, outline: rectOutline(b), gridLines });
    }
    if (isLivingLike(room) || isBedroom(room)) {
      const openings = [
        ...floor.windows.filter(w => floor.walls.some(wl => wl.id === w.wallId && wallRoomIds(wl).includes(room.id))),
        ...floor.doors.filter(d => d.connectsRooms.includes(room.id) && rooms.some(o => o.type === RoomType.Balcony && d.connectsRooms.includes(o.id))),
      ];
      for (const op of openings) {
        const wall = floor.walls.find(w => w.id === op.wallId);
        if (!wall) continue;
        const d = wallDir(wall), n = inwardNormal(wall, b);
        const half = op.width / 2 + 150;
        const a = { x: op.position.x - d.x * half, y: op.position.y - d.y * half };
        const c = { x: op.position.x + d.x * half, y: op.position.y + d.y * half };
        fb.ceilings.push({
          id: fb.id('pelmet'), kind: 'PELMET', roomId: room.id,
          outline: [a, c, { x: c.x + n.x * 150, y: c.y + n.y * 150 }, { x: a.x + n.x * 150, y: a.y + n.y * 150 }].map(p => ({ x: r10(p.x), y: r10(p.y) })),
        });
      }
    }
  }
}

function synthesizeFire(fb: FloorBuilder, floor: Floor, stilt: boolean): void {
  const stair = floor.rooms.find(r => r.type === RoomType.Staircase);
  if (stair) {
    const sbx = roomBox(stair);
    const lobby = floor.rooms.find(r => isCommonCirculation(r) && sharesEdge(roomBox(r), sbx));
    const host = lobby ? roomBox(lobby) : sbx;
    const anchor = { x: Math.max(host.x + 300, Math.min(host.x + host.w - 300, sbx.x + sbx.w / 2)), y: Math.max(host.y + 300, Math.min(host.y + host.h - 300, sbx.y + sbx.h / 2)) };
    fb.sym('FHR', anchor, { roomId: lobby?.id ?? stair.id, label: 'FHR (WET RISER)' });
    fb.sym('FHR_HR', { x: anchor.x + (host.w > host.h ? 500 : 0), y: anchor.y + (host.w > host.h ? 0 : 500) }, { roomId: lobby?.id ?? stair.id, label: 'FHR-HR (HOSE REEL)' });
    fb.sym('FACP', { x: anchor.x - (host.w > host.h ? 500 : 0), y: anchor.y - (host.w > host.h ? 0 : 500) }, { roomId: lobby?.id ?? stair.id });
  }
  for (const stairRoom of floor.rooms.filter(r => r.type === RoomType.Staircase)) {
    for (const door of floor.doors.filter(d => d.connectsRooms.includes(stairRoom.id))) {
      fb.sym('EXIT_SIGN', door.position, { roomId: stairRoom.id, label: 'EXIT' });
    }
  }
  for (const room of floor.rooms.filter(isCommonCirculation)) {
    const b = roomBox(room);
    const long = Math.max(b.w, b.h);
    const count = Math.max(1, Math.ceil(long / 7000));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      fb.sym('SD', b.w >= b.h ? { x: b.x + b.w * t, y: b.y + b.h / 2 } : { x: b.x + b.w / 2, y: b.y + b.h * t }, { roomId: room.id });
    }
  }
  for (const k of floor.rooms.filter(isKitchen)) fb.sym('HD', center(roomBox(k)), { roomId: k.id, unitId: k.unitId });
  if (stilt) {
    for (const room of floor.rooms.filter(r => r.type === RoomType.Parking || r.architecturalRole === 'VEHICLE_AISLE' || r.architecturalRole === 'PARKING_BAY')) {
      const b = roomBox(room);
      for (let x = b.x + SPRINKLER_SPACING_MM / 2; x < b.x + b.w; x += SPRINKLER_SPACING_MM)
        for (let y = b.y + SPRINKLER_SPACING_MM / 2; y < b.y + b.h; y += SPRINKLER_SPACING_MM)
          fb.sym('SPRINKLER', { x, y }, { roomId: room.id });
    }
  }
}

function sharesEdge(a: Box, b: Box): boolean {
  const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return (xOverlap > 0 && (Math.abs(a.y + a.h - b.y) < 1 || Math.abs(b.y + b.h - a.y) < 1))
    || (yOverlap > 0 && (Math.abs(a.x + a.w - b.x) < 1 || Math.abs(b.x + b.w - a.x) < 1));
}

/** Cantilever beams: two per balcony, projecting from the host structural line to the outer edge. */
function synthesizeCantilevers(fb: FloorBuilder, floor: Floor): void {
  const indoor = floor.rooms.filter(r => r.type !== RoomType.Balcony && r.architecturalRole !== 'OPEN_TO_SKY_VOID');
  for (const bal of floor.rooms.filter(r => r.type === RoomType.Balcony)) {
    const b = roomBox(bal);
    const host = indoor.map(roomBox).find(o => sharesEdge(o, b));
    if (!host) continue;
    const hostAbove = Math.abs(host.y + host.h - b.y) < 1;
    const hostBelow = Math.abs(b.y + b.h - host.y) < 1;
    const hostLeft = Math.abs(host.x + host.w - b.x) < 1;
    const beams: [Point, Point, number][] = [];
    if (hostAbove || hostBelow) {
      const y0 = hostAbove ? b.y : b.y + b.h, y1 = hostAbove ? b.y + b.h : b.y;
      for (const x of [b.x + 150, b.x + b.w - 150]) beams.push([{ x, y: y0 }, { x, y: y1 }, b.h]);
    } else {
      const x0 = hostLeft ? b.x : b.x + b.w, x1 = hostLeft ? b.x + b.w : b.x;
      for (const y of [b.y + 150, b.y + b.h - 150]) beams.push([{ x: x0, y }, { x: x1, y }, b.w]);
    }
    for (const [start, end, projection] of beams) {
      fb.cantileverBeams.push({
        id: fb.id('cantilever'), balconyRoomId: bal.id,
        start: { x: r10(start.x), y: r10(start.y) }, end: { x: r10(end.x), y: r10(end.y) },
        projectionMm: r10(projection), widthMm: 230, depthMm: 450,
      });
    }
  }
}

export function synthesizeMepEngineering(building: Building): CoordinatedMepEngineeringPlan {
  const floors = [...building.floors].sort((a, b) => a.level - b.level);
  const residential = floors.filter(isResidential);
  const reference = residential[0];
  const sharedChases = reference?.rooms.some(room => room.tags.includes(SHARED_PLUMBING_RISER_TAG)) ?? false;

  // Vertical stacks are fixed from the first typical floor and repeated on every
  // residential floor, so wet cores stack and drop to the stilt collector line.
  const stackBoxes = new Map<string, Box>();
  const stackByKey = new Map<string, { box: Box; floorIds: string[] }>();
  if (reference) {
    for (const bath of reference.rooms.filter(isBath)) {
      const box = shaftForBath(reference, bath);
      if (!box) continue;
      const key = `${box.x}|${box.y}`;
      stackByKey.set(key, { box, floorIds: [] });
    }
  }
  const collectedStacks = new Set<string>();
  const protectedOutlets = new Map<string, { floorId: string; roomId: string; roomName: string }>();
  const stiltFloor = floors.find(isStilt);
  const plans: FloorMepEngineeringPlan[] = [];
  for (const floor of floors) {
    const fb = new FloorBuilder(floor);
    if (isResidential(floor)) {
      stackBoxes.clear();
      const bathRooms = floor.rooms.filter(isBath);
      const activeStackKeys = new Set<string>();
      for (const bath of bathRooms) {
        const own = shaftForBath(floor, bath);
        if (!own) continue;
        const key = `${own.x}|${own.y}`;
        const stack = stackByKey.get(key);
        if (!stack) continue;
        activeStackKeys.add(key);
        stackBoxes.set(bath.id, stack.box);
      }
      for (const [key, stack] of stackByKey) {
        if (!activeStackKeys.has(key)) continue;
        stack.floorIds.push(floor.id);
        fb.sym('PLUMB_SHAFT', center(stack.box), { widthMm: stack.box.w, depthMm: stack.box.h, label: `PLUMB SHAFT ${stack.box.w}x${stack.box.h}` });
      }
      for (const k of floor.rooms.filter(isKitchen)) {
        const options = bathRooms.filter(room => room.unitId === k.unitId).flatMap(room => stackBoxes.get(room.id) ?? []);
        const kitchenCenter = center(roomBox(k));
        const nearest = options.sort((a, b) => dist(center(a), kitchenCenter) - dist(center(b), kitchenCenter))[0];
        if (nearest) stackBoxes.set(k.id, nearest);
      }
      const obstacles = floorPipeObstacles(floor);
      const byUnit = new Map<string, Room[]>();
      for (const r of floor.rooms.filter(x => x.unitId)) byUnit.set(r.unitId!, [...(byUnit.get(r.unitId!) ?? []), r]);
      for (const [unitId, unitRooms] of byUnit) {
        synthesizeUnitElectrical(fb, floor, unitRooms, unitId);
        const unrelatedRooms = sharedChases ? floor.rooms.filter(room => room.unitId && room.unitId !== unitId).map(roomBox) : [];
        synthesizeUnitPlumbing(fb, unitRooms, unitId, stackBoxes, sharedChases, [...obstacles, ...unrelatedRooms]);
      }
      synthesizeCeilings(fb, floor, [...floor.rooms]);
      synthesizeCantilevers(fb, floor);
      synthesizeFire(fb, floor, false);
    } else if (isStilt(floor)) {
      synthesizeFire(fb, floor, true);
      const stacks = [...stackByKey.entries()];
      if (stacks.length >= 1) {
        const bPts = building.site.plotBoundary.points;
        const minX = Math.min(...bPts.map(p => p.x));
        const maxX = Math.max(...bPts.map(p => p.x));
        const minY = Math.min(...bPts.map(p => p.y));
        const maxY = Math.max(...bPts.map(p => p.y));
        const facing = building.site.roadFacing.toUpperCase();
        const stiltObstacles = floorPipeObstacles(floor);
        const vertical = facing === 'EAST' || facing === 'WEST';
        const along = (point: Point) => vertical ? point.y : point.x;
        const lo = vertical ? minY : minX;
        const hi = vertical ? maxY : maxX;
        const projectToCollector = (coordinate: number) => vertical
          ? { x: facing === 'EAST' ? maxX - 250 : minX + 250, y: coordinate }
          : { x: coordinate, y: facing === 'NORTH' ? minY + 250 : maxY - 250 };
        const connections = stacks.flatMap(([key, stack]) => {
          const p = center(stack.box);
          const chase = { points: rectOutline(stack.box) };
          const courtyard = floor.rooms.find(room =>
            (room.openToSky || room.architecturalRole === 'OPEN_TO_SKY_VOID') &&
            polygonIntersectionArea(chase, room.boundary) > 0,
          );
          if (courtyard) {
            protectedOutlets.set(key, { floorId: floor.id, roomId: courtyard.id, roomName: courtyard.name });
            return [];
          }
          const junction = projectToCollector(Math.max(lo + 250, Math.min(hi - 250, along(p))));
          const route = chooseEconomicalDrainRoute(p, junction, stiltObstacles, building.site.plotBoundary);
          return route ? [{ key, stack, junction, route }] : [];
        }).sort((a, b) => along(a.junction) - along(b.junction));
        if (connections.length) {
          const junctions = connections.map(item => item.junction);
          const end = along(junctions[junctions.length - 1]!);
          const approach = Math.min(hi - 50, end + 1000);
          const trunk = [...junctions, projectToCollector(approach)];
          if (polylineLengthMm(trunk) > 0 && routeIsClear(trunk, stiltObstacles, building.site.plotBoundary)) {
            fb.run('SP', trunk, { diameterMm: 160, slopeRatio: '1:80' });
            for (const { key, stack, route } of connections) {
              collectedStacks.add(key);
              stack.floorIds.push(floor.id);
              fb.run('SP', route, { diameterMm: 110 });
              fb.sym('PLUMB_SHAFT', center(stack.box), { widthMm: stack.box.w, depthMm: stack.box.h, label: 'STACK TO PROPOSED COLLECTOR' });
            }
          }
        }
      }
    }
    plans.push(fb.build());
  }

  const all = plans.flatMap(p => p.symbols);
  const count = (k: MepSymbolKind) => all.filter(s => s.kind === k).length;
  const drainageRuns = plans.flatMap(p => p.runs.filter(r => r.kind === 'SP' || r.kind === 'WP'));
  const residentialDrainageRuns = plans
    .filter(p => residential.some(rf => rf.id === p.floorId))
    .flatMap(p => p.runs.filter(r => r.kind === 'SP' || r.kind === 'WP'));
  const soilRooms = new Set(residentialDrainageRuns.filter(r => r.kind === 'SP').map(r => r.roomId));
  const wasteRooms = new Set(residentialDrainageRuns.filter(r => r.kind === 'WP').map(r => r.roomId));
  const servedWetRoomCount = residential.reduce((sum, floor) => sum + floor.rooms.filter(room =>
    wasteRooms.has(room.id) && (isKitchen(room) || (isBath(room) && soilRooms.has(room.id)))).length, 0);
  const sharedShaftCount = reference
    ? reference.rooms.filter(r => r.tags.includes(SHARED_PLUMBING_RISER_TAG)).length
    : 0;

  return {
    schemaVersion: 'RH-MEP-3.0',
    status: 'COORDINATION_PROPOSAL_NOT_CERTIFIED',
    floors: plans,
    verticalStacks: [...stackByKey.entries()].map(([key, s], i) => {
      const outlet = protectedOutlets.get(key);
      const connected = collectedStacks.has(key);
      const diagnostic = outlet ? {
        status: 'INFEASIBLE' as const,
        code: 'PROTECTED_OPEN_TO_SKY' as const,
        floorId: outlet.floorId,
        protectedRoomId: outlet.roomId,
        message: `The projected service chase intersects the protected stilt void "${outlet.roomName}". A continuous reserved chase outside this void is required.`,
      } : {
        status: 'INFEASIBLE' as const,
        code: stiltFloor ? 'NO_CLEAR_COLLECTOR_ROUTE' as const : 'NO_STILT_FLOOR' as const,
        floorId: stiltFloor?.id,
        message: stiltFloor
          ? 'No clear schematic path from this stack to the road-side stilt collector was found.'
          : 'There is no stilt floor for the proposed collector connection.',
      };
      return {
      id: `stack_${i + 1}_${key.replace('|', '_')}`,
      position: center(s.box), widthMm: s.box.w, depthMm: s.box.h,
      floorIds: s.floorIds,
      terminatesAtStiltCollector: connected,
      ...(connected ? {} : { stiltConnectionDiagnostic: diagnostic }),
      };
    }),
    ...(stackByKey.size > 0
      ? {
          drainageEconomy: {
            routingStatus: 'SCHEMATIC_UNSIZED',
            sharedShaftCount,
            servedWetRoomCount,
            consolidatedBranchRuns: residentialDrainageRuns.length,
            totalDrainagePipeLengthMm: drainageRuns.reduce((sum, r) => sum + (r.lengthMm ?? 0), 0),
            ...(collectedStacks.size > 0 ? { collectorSlopeRatio: '1:80' } : {}),
            collectorTerminatesTowardsRoad: collectedStacks.size > 0,
            unconnectedRiserCount: stackByKey.size - collectedStacks.size,
          },
        }
      : {}),
    summary: {
      distributionBoards: count('DB'), fans: count('FAN'), downlights: count('DL'), switchboards: count('SB') + count('SB_2WAY'),
      sockets16A: count('SOCKET_16A'), geysers: count('GY'), acIndoorUnits: count('AC_IDU'),
      plumbingShafts: count('PLUMB_SHAFT'), floorTraps: count('FT') + count('NT'),
      fireRisers: count('FHR'), smokeDetectors: count('SD'), heatDetectors: count('HD'), exitSigns: count('EXIT_SIGN'),
      sprinklers: count('SPRINKLER'),
      pipeRuns: plans.reduce((s, p) => s + p.runs.length, 0),
      ceilingZones: plans.reduce((s, p) => s + p.ceilings.length, 0),
      cantileverBeams: plans.reduce((s, p) => s + p.cantileverBeams.length, 0),
    },
  };
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Attaches a freshly synthesized plan; pure (returns a new building). */
export function withMepEngineering(building: Building): Building {
  return { ...building, mepEngineering: synthesizeMepEngineering(building) };
}

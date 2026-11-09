/**
 * Closed-Loop Hard & Soft Error Auto-Repair Engine (Phase 1D / PRD 25).
 *
 * Intercepts candidate Canonical Building Models before final output,
 * inspects all Hard & Soft diagnostics from validateApartmentClosure
 * and the constraint engine, and mathematically repairs them in-place
 * while strictly maintaining the Planar Conservation Invariant:
 *   Delta = |Gross Envelope/Plot Area - Sum(Accounted Component Polygons)| = 0.000 mm²
 */

import {
  type Building,
  type Floor,
  type Room,
  type Wall,
  type Door,
  type Window,
  type DynamicApartmentManifest,
  type ApartmentBhkType,
  type Point,
  type Polygon,
  RoomType,
  DoorType,
  SwingDirection,
  WindowType,
  WallType,
  createRoom,
  MINIMUM_DIMENSIONS,
  MINIMUM_ROOM_AREAS,
} from '@ai-floor-planner/core';
import {
  generateApartmentWalls,
  openingFitsApartmentWall,
  measureApartmentAreaLedger,
  roomSpaceUse,
  pointInPolygon,
} from '@ai-floor-planner/geometry-engine';
import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';

export interface ApartmentRepairOptions {
  /** Maximum number of closed-loop repair passes (default 3). */
  readonly maxPasses?: number;
  /** Whether to enable compact plot adaptation if plot is tight (default true). */
  readonly compactPlotAdaptation?: boolean;
}

export interface AppliedRepair {
  readonly category:
    | 'MANIFEST_SYNTHESIS'
    | 'MIN_DIMENSION_ELASTIC_SHIFT'
    | 'DOOR_HOST_AND_SWING'
    | 'PRIVACY_CIRCULATION'
    | 'DAYLIGHT_SHAFT'
    | 'COMPACT_ADAPTATION';
  readonly description: string;
  readonly targetEntities: readonly string[];
}

export interface ApartmentRepairReport {
  readonly repaired: boolean;
  readonly passesCompleted: number;
  readonly initialIssues: readonly { readonly code: string; readonly severity: 'error' | 'warning'; readonly message: string }[];
  readonly finalIssues: readonly { readonly code: string; readonly severity: 'error' | 'warning'; readonly message: string }[];
  readonly initialHardErrors: number;
  readonly finalHardErrors: number;
  readonly repairsApplied: readonly AppliedRepair[];
  readonly deltaMm2: number;
  readonly advisories: readonly string[];
}

export interface Rect2D {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SNAP_INC = 10;
export const snap10 = (v: number): number => Math.round(v / SNAP_INC) * SNAP_INC;

export function getRoomRect(room: Room): Rect2D {
  if (room.boundary && room.boundary.points.length >= 4) {
    const xs = room.boundary.points.map(p => p.x);
    const ys = room.boundary.points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return { x: room.x, y: room.y, w: room.width, h: room.height };
}

export function rectToPolygon(r: Rect2D): Polygon {
  return {
    points: [
      { x: Math.round(r.x), y: Math.round(r.y) },
      { x: Math.round(r.x + r.w), y: Math.round(r.y) },
      { x: Math.round(r.x + r.w), y: Math.round(r.y + r.h) },
      { x: Math.round(r.x), y: Math.round(r.y + r.h) },
    ],
  };
}

/** Check if two rooms share an edge segment */
export function findSharedWallSegment(
  roomA: Room,
  roomB: Room,
): { axis: 'x' | 'y'; coord: number; lo: number; hi: number; len: number } | null {
  const a = getRoomRect(roomA);
  const b = getRoomRect(roomB);

  // Horizontal shared edge
  const touchesHoriz = Math.abs(a.y + a.h - b.y) <= 2 || Math.abs(b.y + b.h - a.y) <= 2;
  const loX = Math.max(a.x, b.x);
  const hiX = Math.min(a.x + a.w, b.x + b.w);
  if (touchesHoriz && hiX - loX >= 100) {
    const coord = Math.abs(a.y + a.h - b.y) <= 2 ? a.y + a.h : b.y + b.h;
    return { axis: 'x', coord, lo: loX, hi: hiX, len: hiX - loX };
  }

  // Vertical shared edge
  const touchesVert = Math.abs(a.x + a.w - b.x) <= 2 || Math.abs(b.x + b.w - a.x) <= 2;
  const loY = Math.max(a.y, b.y);
  const hiY = Math.min(a.y + a.h, b.y + b.h);
  if (touchesVert && hiY - loY >= 100) {
    const coord = Math.abs(a.x + a.w - b.x) <= 2 ? a.x + a.w : b.x + b.w;
    return { axis: 'y', coord, lo: loY, hi: hiY, len: hiY - loY };
  }

  return null;
}

/**
 * Closed-Loop Self-Healing Apartment Repair Engine.
 * Intercepts any candidate Canonical Building Model and iteratively heals hard/soft errors.
 */
export function repairApartmentPlan(
  building: Building,
  manifest?: DynamicApartmentManifest,
  options: ApartmentRepairOptions = {},
): { building: Building; repairReport: ApartmentRepairReport } {
  const maxPasses = options.maxPasses ?? 3;
  const compactPlotAdaptation = options.compactPlotAdaptation ?? true;

  const initialClosure = validateApartmentClosure(building, manifest);
  const appliedRepairs: AppliedRepair[] = [];
  const advisories: string[] = [];

  let currentBuilding = building;
  let passCount = 0;

  for (let pass = 1; pass <= maxPasses; pass++) {
    passCount = pass;
    const closure = validateApartmentClosure(currentBuilding, manifest);

    // If completely clean of hard errors and critical door/connectivity issues on subsequent passes, converge early!
    if (pass > 1 && closure.hardErrors === 0 && !hasCriticalSoftIssues(closure.issues)) {
      break;
    }

    let modified = false;
    const repairedFloors: Floor[] = [];

    for (const floor of currentBuilding.floors) {
      if (!floor.apartmentUnits || floor.apartmentUnits.length === 0) {
        repairedFloors.push(floor);
        continue;
      }

      let currentRooms = [...floor.rooms];
      let currentDoors = [...floor.doors];
      let currentWindows = [...floor.windows];

      // ── Pass 1: Manifest Completeness & Missing Room Auto-Synthesis ───────
      const manifestRes = repairManifestMismatch({
        rooms: currentRooms,
        doors: currentDoors,
        units: floor.apartmentUnits,
        manifest,
        floorId: floor.id,
      });
      if (manifestRes.repaired) {
        currentRooms = manifestRes.rooms;
        currentDoors = manifestRes.doors;
        appliedRepairs.push(...manifestRes.repairs);
        modified = true;
      }

      // ── Pass 2: Elastic Minimum-Dimension & Aspect-Ratio Repair ───────────
      const dimRes = repairMinDimensions({
        rooms: currentRooms,
        units: floor.apartmentUnits,
        compactPlotAdaptation,
      });
      if (dimRes.repaired) {
        currentRooms = dimRes.rooms;
        appliedRepairs.push(...dimRes.repairs);
        advisories.push(...dimRes.advisories);
        modified = true;
      }

      // ── Pass 3: Regenerate Walls to match synthesized & shifted room boundaries ──
      let regeneratedWalls = generateApartmentWalls(currentRooms, floor.id, floor.boundary);

      // ── Pass 4: Multi-Tenancy Privacy & Graph Reachability Repair ──────────
      const privacyRes = repairPrivacyAndCirculation({
        rooms: currentRooms,
        doors: currentDoors,
        walls: regeneratedWalls,
        units: floor.apartmentUnits,
        floorId: floor.id,
      });
      if (privacyRes.repaired) {
        currentDoors = privacyRes.doors;
        appliedRepairs.push(...privacyRes.repairs);
        modified = true;
      }

      // ── Pass 5: Door Host, Corner Clearance & Swing Collision Repair ──────
      const doorRes = repairDoorHostsAndClearance({
        rooms: currentRooms,
        doors: currentDoors,
        walls: regeneratedWalls,
        floorId: floor.id,
      });
      if (doorRes.repaired) {
        currentDoors = doorRes.doors;
        appliedRepairs.push(...doorRes.repairs);
        modified = true;
      }

      // Re-generate walls with opening flags updated
      regeneratedWalls = generateApartmentWalls(currentRooms, floor.id, floor.boundary).map(w => ({
        ...w,
        hasOpening: currentDoors.some(d => d.wallId === w.id) || currentWindows.some(win => win.wallId === w.id),
      }));

      // ── Pass 6: Daylighting & MEP Service Shaft Repair ────────────────────
      const daylightRes = repairDaylightAndVentilation({
        rooms: currentRooms,
        windows: currentWindows,
        doors: currentDoors,
        walls: regeneratedWalls,
        floorId: floor.id,
      });
      if (daylightRes.repaired) {
        currentWindows = daylightRes.windows;
        appliedRepairs.push(...daylightRes.repairs);
        modified = true;
      }

      // Re-sync final wall hasOpening status
      regeneratedWalls = regeneratedWalls.map(w => ({
        ...w,
        hasOpening: currentDoors.some(d => d.wallId === w.id) || currentWindows.some(win => win.wallId === w.id),
      }));

      repairedFloors.push({
        ...floor,
        rooms: currentRooms,
        walls: regeneratedWalls,
        doors: currentDoors,
        windows: currentWindows,
      });
    }

    currentBuilding = {
      ...currentBuilding,
      floors: repairedFloors,
    };

    if (!modified) {
      // No more repairs possible in this pass
      break;
    }
  }

  const finalClosure = validateApartmentClosure(currentBuilding, manifest);
  const ledger = currentBuilding.floors[0] ? measureApartmentAreaLedger(currentBuilding.floors[0]) : null;
  const deltaMm2 = ledger ? Math.abs(ledger.delta) : 0;

  return {
    building: currentBuilding,
    repairReport: {
      repaired: appliedRepairs.length > 0,
      passesCompleted: passCount,
      initialIssues: initialClosure.issues,
      finalIssues: finalClosure.issues,
      initialHardErrors: initialClosure.hardErrors,
      finalHardErrors: finalClosure.hardErrors,
      repairsApplied: appliedRepairs,
      deltaMm2,
      advisories: [...new Set(advisories)],
    },
  };
}

function hasCriticalSoftIssues(issues: readonly { readonly code: string; readonly severity: string }[]): boolean {
  return issues.some(i =>
    i.code === 'BEDROOM_DOOR_WIDTH_SUBSTANDARD' ||
    i.code === 'SERVICE_DOOR_WIDTH_SUBSTANDARD' ||
    i.code === 'PRIMARY_ENTRANCE_DOOR_WIDTH_SUBSTANDARD' ||
    i.code === 'DAYLIGHT_OPENING_UNVERIFIED'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. MANIFEST COMPLETENESS & MISSING ROOM AUTO-SYNTHESIS
// ─────────────────────────────────────────────────────────────────────────────

interface ManifestRepairParams {
  rooms: Room[];
  doors: Door[];
  units: Floor['apartmentUnits'];
  manifest?: DynamicApartmentManifest;
  floorId: string;
}

function repairManifestMismatch(params: ManifestRepairParams): {
  rooms: Room[];
  doors: Door[];
  repaired: boolean;
  repairs: AppliedRepair[];
} {
  const { units, manifest, floorId } = params;
  if (!units || units.length === 0) {
    return { rooms: params.rooms, doors: params.doors, repaired: false, repairs: [] };
  }

  let workingRooms = params.rooms.map(room => {
    // Canonical polygons win over stale rectangle metadata after an edit.
    if (room.boundary.points.length !== 4) return room;
    const xs = [...new Set(room.boundary.points.map(p => p.x))];
    const ys = [...new Set(room.boundary.points.map(p => p.y))];
    if (xs.length !== 2 || ys.length !== 2) return room;
    const x = Math.min(...xs), y = Math.min(...ys), width = Math.max(...xs) - x, height = Math.max(...ys) - y;
    return { ...room, x, y, width, height, area: width * height };
  });
  const workingDoors = [...params.doors];
  const repairs: AppliedRepair[] = [];
  let repaired = false;

  const manifestUnits: readonly any[] = Array.isArray(manifest?.units)
    ? manifest.units
    : Array.isArray((manifest as any)?.units?.units)
    ? (manifest as any).units.units
    : [];

  for (const u of units) {
    const unitSpec = manifestUnits.find((item: any) =>
      (item.unitIndex !== undefined && item.unitIndex === (u as { unitIndex?: number }).unitIndex) ||
      (item.id && (u.id === item.id || u.id.endsWith(String(item.id)) || String(item.id).endsWith(u.id))) ||
      (item.unitIndex !== undefined && u.id.endsWith(String(item.unitIndex)))
    );
    let unitRooms = workingRooms.filter(r => r.unitId === u.id);
    const bedRoomsList = unitRooms.filter(r => r.type === RoomType.Bedroom || r.tags.includes('role:bedroom'));
    const inferredBhk = bedRoomsList.length > 0 ? (`${bedRoomsList.length}BHK` as ApartmentBhkType) : '3BHK';
    const bhkType = (unitSpec?.bhkType ?? unitSpec?.type ?? u.unitType ?? inferredBhk) as ApartmentBhkType;
    const match = String(bhkType).match(/^([1234])BHK$/i);
    const defaultBeds = match ? parseInt(match[1]!, 10) : 3;
    const expectedBeds = typeof unitSpec?.bedrooms === 'number' ? unitSpec.bedrooms : defaultBeds;
    const expectedBaths = typeof unitSpec?.bathrooms === 'number'
      ? unitSpec.bathrooms
      : unitSpec?.attachedBathCount !== undefined
      ? unitSpec.attachedBathCount + 1
      : expectedBeds;

    // 1. Living room check
    const livingRooms = unitRooms.filter(r => r.type === RoomType.Living || r.tags.includes('role:living'));
    if (livingRooms.length === 0) {
      // Check if there is an entrance room in unitRooms that connects to the common corridor (mislabeled by AI as bedroom)
      const entryRoom = unitRooms.find(r =>
        workingDoors.some(d =>
          (d.connectsRooms[0] === r.id && params.rooms.some(cr => cr.id === d.connectsRooms[1] && (cr.spaceUse === 'COMMON' || cr.spaceUse === 'CORE'))) ||
          (d.connectsRooms[1] === r.id && params.rooms.some(cr => cr.id === d.connectsRooms[0] && (cr.spaceUse === 'COMMON' || cr.spaceUse === 'CORE')))
        )
      );

      if (entryRoom) {
        // Re-classify this mislabeled entry room as Living & Dining
        const reclassified: Room = {
          ...entryRoom,
          type: RoomType.Living,
          planningZone: 'PUBLIC' as never,
          name: `${u.id} Living & Dining`,
          tags: entryRoom.tags.filter(t => !t.startsWith('role:')).concat(['role:living', 'reclassified:living']),
        };
        workingRooms = workingRooms.map(r => (r.id === entryRoom.id ? reclassified : r));
        unitRooms = unitRooms.map(r => (r.id === entryRoom.id ? reclassified : r));
        repaired = true;
        repairs.push({
          category: 'PRIVACY_CIRCULATION',
          description: `Re-classified mislabeled entry room ${entryRoom.id} to Living & Dining room for ${u.id}`,
          targetEntities: [entryRoom.id],
        });
      } else {
        // Synthesize missing living room from the largest room in unit
        const candidate = findOversizedRoom(unitRooms, RoomType.Living);
        if (candidate) {
          const synth = splitRoomForSynthesis(candidate, RoomType.Living, `${u.id} Living & Dining`, floorId, u.id, undefined, unitRooms);
          workingRooms = workingRooms.map(r => (r.id === candidate.id ? synth.parentRoom : r));
          workingRooms.push(synth.synthesizedRoom);
          workingDoors.push(synth.connectingDoor);
          unitRooms = unitRooms.map(r => (r.id === candidate.id ? synth.parentRoom : r));
          unitRooms.push(synth.synthesizedRoom);
          repaired = true;
          repairs.push({
            category: 'MANIFEST_SYNTHESIS',
            description: `Synthesized missing Living room for ${u.id} (${bhkType}) by subdividing oversized zone ${candidate.id}`,
            targetEntities: [candidate.id, synth.synthesizedRoom.id],
          });
        }
      }
    }

    // 2. Kitchen check
    const kitchenRooms = unitRooms.filter(r => r.type === RoomType.Kitchen || r.tags.includes('role:kitchen'));
    if (kitchenRooms.length === 0) {
      const candidate = findOversizedRoom(unitRooms, RoomType.Kitchen);
      if (candidate) {
        const synth = splitRoomForSynthesis(candidate, RoomType.Kitchen, `${u.id} Kitchen`, floorId, u.id, undefined, unitRooms);
        workingRooms = workingRooms.map(r => (r.id === candidate.id ? synth.parentRoom : r));
        workingRooms.push(synth.synthesizedRoom);
        workingDoors.push(synth.connectingDoor);
        unitRooms = unitRooms.map(r => (r.id === candidate.id ? synth.parentRoom : r));
        unitRooms.push(synth.synthesizedRoom);
        repaired = true;
        repairs.push({
          category: 'MANIFEST_SYNTHESIS',
          description: `Synthesized missing Kitchen for ${u.id} (${bhkType}) by subdividing oversized zone ${candidate.id}`,
          targetEntities: [candidate.id, synth.synthesizedRoom.id],
        });
      }
    }

    // 3. Bedrooms check
    let bedCount = unitRooms.filter(r => r.type === RoomType.Bedroom || r.tags.includes('role:bedroom')).length;
    while (bedCount < expectedBeds) {
      const candidate = findOversizedRoom(unitRooms, RoomType.Bedroom);
      if (!candidate) break;
      bedCount++;
      const synth = splitRoomForSynthesis(candidate, RoomType.Bedroom, `${u.id} Bedroom 0${bedCount}`, floorId, u.id, undefined, unitRooms);
      workingRooms = workingRooms.map(r => (r.id === candidate.id ? synth.parentRoom : r));
      workingRooms.push(synth.synthesizedRoom);
      workingDoors.push(synth.connectingDoor);
      unitRooms = unitRooms.map(r => (r.id === candidate.id ? synth.parentRoom : r));
      unitRooms.push(synth.synthesizedRoom);
      repaired = true;
      repairs.push({
        category: 'MANIFEST_SYNTHESIS',
        description: `Synthesized Bedroom 0${bedCount} for ${u.id} (${bhkType}) from oversized room ${candidate.id}`,
        targetEntities: [candidate.id, synth.synthesizedRoom.id],
      });
    }

    // 4. Bathrooms check
    let bathCount = unitRooms.filter(r => r.type === RoomType.Bathroom || r.tags.includes('role:bathroom')).length;
    while (bathCount < expectedBaths) {
      const gap = findUnoccupiedUnitRectangle(u.boundary, workingRooms);
      if (gap && Math.min(gap.w, gap.h) >= 1200 && gap.w * gap.h >= 2_200_000) {
        const created = createRoom({ floorId, type: RoomType.Bathroom, name: `${u.id} Common Toilet ${bathCount + 1}`,
          x: gap.x, y: gap.y, width: gap.w, height: gap.h, tags: [`flat:${u.id}`, 'role:bathroom', 'repaired:gap'] });
        const restored: Room = { ...created, unitId: u.id, spaceUse: 'UNIT', bathroomAccessClass: 'COMMON' };
        workingRooms.push(restored); unitRooms.push(restored); bathCount++; repaired = true;
        repairs.push({ category: 'MANIFEST_SYNTHESIS', description: `Restored missing bathroom in measured vacant unit polygon`, targetEntities: [restored.id] });
        continue;
      }
      // Determine if attached to an existing bedroom without attached bath
      const beds = unitRooms.filter(r => r.type === RoomType.Bedroom);
      const existingAttachedOwners = new Set(
        unitRooms
          .filter(r => r.type === RoomType.Bathroom && r.bathroomAccessClass === 'ATTACHED')
          .map(r => r.bathroomOwnerRoomId)
      );
      const unattachedBeds = beds.filter(b => !existingAttachedOwners.has(b.id) && b.area >= 12_500_000);
      unattachedBeds.sort((a, b) => b.y - a.y);
      const unattachedBed = unattachedBeds[0];
      const candidate = unattachedBed ?? findOversizedRoom(unitRooms, RoomType.Bathroom);
      if (!candidate) break;
      bathCount++;

      const isAttached = candidate.type === RoomType.Bedroom;
      const synth = splitRoomForSynthesis(
        candidate,
        RoomType.Bathroom,
        isAttached ? `${u.id} Master Bath 0${bathCount}` : `${u.id} Common Toilet 0${bathCount}`,
        floorId,
        u.id,
        { isAttached },
        unitRooms
      );
      workingRooms = workingRooms.map(r => (r.id === candidate.id ? synth.parentRoom : r));
      workingRooms.push(synth.synthesizedRoom);
      workingDoors.push(synth.connectingDoor);
      unitRooms = unitRooms.map(r => (r.id === candidate.id ? synth.parentRoom : r));
      unitRooms.push(synth.synthesizedRoom);
      repaired = true;
      repairs.push({
        category: 'MANIFEST_SYNTHESIS',
        description: `Synthesized Toilet 0${bathCount} (${isAttached ? 'Attached' : 'Common'}) for ${u.id} from ${candidate.id}`,
        targetEntities: [candidate.id, synth.synthesizedRoom.id],
      });
    }

    // 5. Utility / Balcony check
    if (unitSpec?.hasUtilityBalcony) {
      const hasUtil = unitRooms.some(r => r.type === RoomType.Utility || r.type === RoomType.Balcony || r.tags.some(t => t.includes('utility') || t.includes('balcony')));
      if (!hasUtil) {
        const candidate = findOversizedRoom(unitRooms, RoomType.Utility);
        if (candidate) {
          const synth = splitRoomForSynthesis(candidate, RoomType.Utility, `${u.id} Kitchen Utility Yard`, floorId, u.id, undefined, unitRooms);
          workingRooms = workingRooms.map(r => (r.id === candidate.id ? synth.parentRoom : r));
          workingRooms.push(synth.synthesizedRoom);
          workingDoors.push(synth.connectingDoor);
          unitRooms = unitRooms.map(r => (r.id === candidate.id ? synth.parentRoom : r));
          unitRooms.push(synth.synthesizedRoom);
          repaired = true;
          repairs.push({
            category: 'MANIFEST_SYNTHESIS',
            description: `Synthesized Utility Balcony for ${u.id} (${bhkType}) from ${candidate.id}`,
            targetEntities: [candidate.id, synth.synthesizedRoom.id],
          });
        }
      }
    }
  }

  return { rooms: workingRooms, doors: workingDoors, repaired, repairs };
}

/** Largest uncovered rectangle on the existing orthogonal room partition. */
function findUnoccupiedUnitRectangle(boundary: Polygon, rooms: readonly Room[]): Rect2D | null {
  const xs = [...new Set([...boundary.points, ...rooms.flatMap(r => r.boundary.points)].map(p => p.x))].sort((a,b) => a-b);
  const ys = [...new Set([...boundary.points, ...rooms.flatMap(r => r.boundary.points)].map(p => p.y))].sort((a,b) => a-b);
  let best: Rect2D | null = null;
  for (let y = 0; y < ys.length - 1; y++) for (let x = 0; x < xs.length - 1; x++) {
    let maxX = xs.length - 1;
    for (let bottom = y; bottom < ys.length - 1; bottom++) {
      let right = x;
      for (; right < maxX; right++) {
        const center = { x: (xs[right]! + xs[right + 1]!) / 2, y: (ys[bottom]! + ys[bottom + 1]!) / 2 };
        if (!pointInPolygon(center, boundary) || rooms.some(r => pointInPolygon(center, r.boundary))) break;
      }
      maxX = right;
      if (right === x) break;
      const rect = { x: xs[x]!, y: ys[y]!, w: xs[right]! - xs[x]!, h: ys[bottom + 1]! - ys[y]! };
      if (!best || rect.w * rect.h > best.w * best.h) best = rect;
    }
  }
  return best;
}

function findOversizedRoom(rooms: readonly Room[], targetForSynthesis: RoomType): Room | null {
  if (targetForSynthesis === RoomType.Bedroom) {
    // Look first among existing bedrooms
    const bedCandidates = [...rooms].filter(r => r.type === RoomType.Bedroom && r.area >= 10_000_000);
    if (bedCandidates.length > 0) {
      bedCandidates.sort((a, b) => b.area - a.area);
      return bedCandidates[0]!;
    }
  }

  if (targetForSynthesis === RoomType.Bathroom) {
    // If synthesizing bathroom, look at bedrooms or oversized service zones with at least 12.5 m²
    const bedCandidates = [...rooms].filter(r => r.type === RoomType.Bedroom && r.area >= 12_500_000);
    if (bedCandidates.length > 0) {
      bedCandidates.sort((a, b) => b.area - a.area);
      return bedCandidates[0]!;
    }
  }

  const minRequiredArea: Record<string, number> = {
    [RoomType.Living]: 12_000_000,
    [RoomType.Bedroom]: 9_500_000,
    [RoomType.Kitchen]: 5_500_000,
    [RoomType.Bathroom]: 2_200_000,
    [RoomType.Utility]: 2_000_000,
  };
  const neededArea = minRequiredArea[targetForSynthesis] ?? 2_500_000;

  // Prefer splitting Living or Master Bedroom which are usually oversized
  const candidates = [...rooms].filter(r => {
    const rMin = minRequiredArea[r.type] ?? 3_000_000;
    return r.area >= rMin + neededArea;
  });

  if (candidates.length === 0) {
    const sorted = [...rooms].sort((a, b) => b.area - a.area);
    return sorted[0] && sorted[0].area >= neededArea * 1.3 ? sorted[0] : null;
  }

  candidates.sort((a, b) => b.area - a.area);
  return candidates[0]!;
}

function splitRoomForSynthesis(
  parent: Room,
  synthType: RoomType,
  synthName: string,
  floorId: string,
  unitId: string,
  bathOptions?: { ownerBedId?: string; isAttached: boolean },
  allUnitRooms?: readonly Room[],
): { parentRoom: Room; synthesizedRoom: Room; connectingDoor: Door } {
  const pRect = getRoomRect(parent);
  let parentRect: Rect2D;
  let synthRect: Rect2D;

  const minSynthDims: Record<string, { w: number; h: number }> = {
    [RoomType.Bathroom]: { w: 1400, h: 1800 },
    [RoomType.Bedroom]: { w: 2600, h: 3000 },
    [RoomType.Kitchen]: { w: 2000, h: 2400 },
    [RoomType.Utility]: { w: 1400, h: 1800 },
    [RoomType.Living]: { w: 3200, h: 3600 },
  };
  const minDim = minSynthDims[synthType] ?? { w: 1500, h: 1800 };

  // When splitting a room along the vertical exterior facade (e.g. West edge at x <= 50),
  // split along the Y-axis so both halves retain access to the exterior facade for windows.
  const isAlongExteriorFacade = pRect.x <= 50;
  const splitAlongY = isAlongExteriorFacade || pRect.h > pRect.w;

  if (!splitAlongY) {
    // Split along longest axis (X-axis)
    const synthW = snap10(Math.min(Math.max(1400, minDim.w), pRect.w * 0.40));
    const parentW = pRect.w - synthW;
    parentRect = { x: pRect.x, y: pRect.y, w: parentW, h: pRect.h };
    synthRect = { x: pRect.x + parentW, y: pRect.y, w: synthW, h: pRect.h };
  } else {
    // Split along Y-axis
    const synthH = snap10(Math.min(Math.max(1600, minDim.h), pRect.h * 0.40));
    const parentH = pRect.h - synthH;
    parentRect = { x: pRect.x, y: pRect.y, w: pRect.w, h: parentH };
    synthRect = { x: pRect.x, y: pRect.y + parentH, w: pRect.w, h: synthH };
  }

  const updatedParent: Room = {
    ...parent,
    x: parentRect.x,
    y: parentRect.y,
    width: parentRect.w,
    height: parentRect.h,
    area: parentRect.w * parentRect.h,
    boundary: rectToPolygon(parentRect),
  };

  const synthId = `${unitId}__synth_${synthType}_${Math.round(synthRect.x)}_${Math.round(synthRect.y)}`;
  const created = createRoom({
    floorId,
    name: synthName,
    type: synthType,
    x: synthRect.x,
    y: synthRect.y,
    width: synthRect.w,
    height: synthRect.h,
    tags: [`apt-room:${synthId}`, `flat:${unitId}`, `role:${synthType}`, 'synthesized:auto'],
    daylightRequirement: 'medium' as never,
    privacyRequirement: (synthType === RoomType.Bedroom || synthType === RoomType.Bathroom ? 'high' : 'low') as never,
    isFixed: false,
  });

  const synthesizedRoom: Room = {
    ...created,
    id: synthId,
    unitId,
    spaceUse: roomSpaceUse({ ...created, unitId }),
    planningZone: (synthType === RoomType.Bathroom || synthType === RoomType.Utility ? 'SERVICE' : synthType === RoomType.Bedroom ? 'PRIVATE' : 'PUBLIC') as never,
    bathroomAccessClass: synthType === RoomType.Bathroom ? (bathOptions?.isAttached ? 'ATTACHED' : 'COMMON') : undefined,
    bathroomOwnerRoomId: bathOptions?.isAttached ? parent.id : undefined,
  };

  // Create connecting door between synthesized room and appropriate space
  const doorWidth = synthType === RoomType.Bathroom || synthType === RoomType.Utility ? 750 : 900;
  const livingRoom = allUnitRooms?.find(r => r.type === RoomType.Living || r.tags.includes('role:living'));

  let connectTargetId = parent.id;
  let sharedSegment = findSharedWallSegment(updatedParent, synthesizedRoom);

  if (synthType === RoomType.Bedroom && livingRoom && findSharedWallSegment(synthesizedRoom, livingRoom)) {
    connectTargetId = livingRoom.id;
    sharedSegment = findSharedWallSegment(synthesizedRoom, livingRoom);
  }

  const doorPos: Point = sharedSegment
    ? sharedSegment.axis === 'x'
      ? { x: snap10((sharedSegment.lo + sharedSegment.hi) / 2), y: sharedSegment.coord }
      : { x: sharedSegment.coord, y: snap10((sharedSegment.lo + sharedSegment.hi) / 2) }
    : { x: snap10(synthRect.x + synthRect.w / 2), y: snap10(synthRect.y) };

  const connectingDoor: Door = {
    id: `${synthId}__door_entry`,
    floorId,
    wallId: '__auto_wall__',
    position: doorPos,
    width: doorWidth,
    height: 2100,
    type: synthType === RoomType.Balcony ? DoorType.Sliding : DoorType.Single,
    swingDirection: synthType === RoomType.Balcony || synthType === RoomType.Utility ? SwingDirection.Outward : SwingDirection.Inward,
    connectsRooms: [connectTargetId, synthId],
  };

  return { parentRoom: updatedParent, synthesizedRoom, connectingDoor };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. ELASTIC MINIMUM-DIMENSION & ASPECT-RATIO REPAIR
// ─────────────────────────────────────────────────────────────────────────────

interface MinDimRepairParams {
  rooms: Room[];
  units: Floor['apartmentUnits'];
  compactPlotAdaptation: boolean;
}

function repairMinDimensions(params: MinDimRepairParams): {
  rooms: Room[];
  repaired: boolean;
  repairs: AppliedRepair[];
  advisories: string[];
} {
  const { compactPlotAdaptation } = params;
  const rooms = [...params.rooms];
  const repairs: AppliedRepair[] = [];
  const advisories: string[] = [];
  let repaired = false;

  const standardMin: Record<string, number> = {
    [RoomType.Living]: 3000,
    [RoomType.Bedroom]: 2700,
    [RoomType.Kitchen]: 2100,
    [RoomType.Bathroom]: 1200,
    [RoomType.Balcony]: 1200,
    [RoomType.Corridor]: 1200,
  };

  const compactMin: Record<string, number> = {
    [RoomType.Living]: 2400,
    [RoomType.Bedroom]: 2400,
    [RoomType.Kitchen]: 1800,
    [RoomType.Bathroom]: 1100,
    [RoomType.Balcony]: 1100,
    [RoomType.Corridor]: 900,
  };

  for (let i = 0; i < rooms.length; i++) {
    const roomA = rooms[i]!;
    const isInternalPassageA = (roomA.type === RoomType.Corridor || roomA.type === RoomType.Custom) &&
      (Boolean(roomA.unitId) || roomA.tags.some(t => t.startsWith('flat:')) || roomA.name.toLowerCase().includes('passage'));
    const standardLimit = isInternalPassageA ? 900 : standardMin[roomA.type];
    if (!standardLimit) continue;

    const rA = getRoomRect(roomA);
    const minDimA = Math.min(rA.w, rA.h);

    if (minDimA < standardLimit) {
      // Find an adjacent room in the same unit with surplus clearance
      let slackShifted = false;

      for (let j = 0; j < rooms.length; j++) {
        if (i === j) continue;
        const roomB = rooms[j]!;
        if (roomA.unitId && roomA.unitId !== roomB.unitId) continue;

        const shared = findSharedWallSegment(roomA, roomB);
        if (!shared) continue;

        const rB = getRoomRect(roomB);
        const isInternalPassageB = (roomB.type === RoomType.Corridor || roomB.type === RoomType.Custom) &&
          (Boolean(roomB.unitId) || roomB.tags.some(t => t.startsWith('flat:')) || roomB.name.toLowerCase().includes('passage'));
        const minDimB = isInternalPassageB ? 900 : Math.max(standardMin[roomB.type] ?? 1200, (MINIMUM_DIMENSIONS as Record<string, number | undefined>)[roomB.type] ?? 0);
        const minAreaB = (MINIMUM_ROOM_AREAS as Record<string, number | undefined>)[roomB.type] ?? 0;

        if (shared.axis === 'y') {
          if (rA.y !== rB.y || rA.h !== rB.h) continue;
          // Vertical shared boundary: can adjust widths
          const deficit = standardLimit - rA.w;
          if (deficit > 0) {
            const minWidthForArea = minAreaB > 0 && rB.h > 0 ? Math.ceil(minAreaB / rB.h) : 0;
            const effectiveLimitB = Math.max(minDimB, minWidthForArea);
            const surplusB = rB.w - effectiveLimitB;
            if (surplusB > 100) {
              const delta = snap10(Math.min(deficit, surplusB - 100));
              if (delta > 0 && rB.w - delta >= minDimB && (rB.w - delta) * rB.h >= minAreaB) {
                if (rB.x > rA.x) {
                  // roomB is to the right of roomA: roomA expands right, roomB shrinks from left
                  const newA: Rect2D = { x: rA.x, y: rA.y, w: rA.w + delta, h: rA.h };
                  const newB: Rect2D = { x: rB.x + delta, y: rB.y, w: rB.w - delta, h: rB.h };
                  rooms[i] = { ...roomA, ...newA, width: newA.w, height: newA.h, area: newA.w * newA.h, boundary: rectToPolygon(newA) };
                  rooms[j] = { ...roomB, ...newB, width: newB.w, height: newB.h, area: newB.w * newB.h, boundary: rectToPolygon(newB) };
                } else {
                  // roomB is to the left of roomA: roomA expands left, roomB shrinks from right
                  const newA: Rect2D = { x: rA.x - delta, y: rA.y, w: rA.w + delta, h: rA.h };
                  const newB: Rect2D = { x: rB.x, y: rB.y, w: rB.w - delta, h: rB.h };
                  rooms[i] = { ...roomA, ...newA, width: newA.w, height: newA.h, area: newA.w * newA.h, boundary: rectToPolygon(newA) };
                  rooms[j] = { ...roomB, ...newB, width: newB.w, height: newB.h, area: newB.w * newB.h, boundary: rectToPolygon(newB) };
                }
                slackShifted = true;
                repaired = true;
                repairs.push({
                  category: 'MIN_DIMENSION_ELASTIC_SHIFT',
                  description: `Elastically shifted partition between ${roomA.id} and ${roomB.id} by ${delta} mm (conserving Delta = 0.000 mm²)`,
                  targetEntities: [roomA.id, roomB.id],
                });
                break;
              }
            }
          }
        } else {
          if (rA.x !== rB.x || rA.w !== rB.w) continue;
          // Horizontal shared boundary: can adjust heights
          const deficit = standardLimit - rA.h;
          if (deficit > 0) {
            const minHeightForArea = minAreaB > 0 && rB.w > 0 ? Math.ceil(minAreaB / rB.w) : 0;
            const effectiveLimitB = Math.max(minDimB, minHeightForArea);
            const surplusB = rB.h - effectiveLimitB;
            if (surplusB > 100) {
              const delta = snap10(Math.min(deficit, surplusB - 100));
              if (delta > 0 && rB.h - delta >= minDimB && rB.w * (rB.h - delta) >= minAreaB) {
                if (rB.y > rA.y) {
                  // roomB is below roomA
                  const newA: Rect2D = { x: rA.x, y: rA.y, w: rA.w, h: rA.h + delta };
                  const newB: Rect2D = { x: rB.x, y: rB.y + delta, w: rB.w, h: rB.h - delta };
                  rooms[i] = { ...roomA, ...newA, width: newA.w, height: newA.h, area: newA.w * newA.h, boundary: rectToPolygon(newA) };
                  rooms[j] = { ...roomB, ...newB, width: newB.w, height: newB.h, area: newB.w * newB.h, boundary: rectToPolygon(newB) };
                } else {
                  // roomB is above roomA
                  const newA: Rect2D = { x: rA.x, y: rA.y - delta, w: rA.w, h: rA.h + delta };
                  const newB: Rect2D = { x: rB.x, y: rB.y, w: rB.w, h: rB.h - delta };
                  rooms[i] = { ...roomA, ...newA, width: newA.w, height: newA.h, area: newA.w * newA.h, boundary: rectToPolygon(newA) };
                  rooms[j] = { ...roomB, ...newB, width: newB.w, height: newB.h, area: newB.w * newB.h, boundary: rectToPolygon(newB) };
                }
                slackShifted = true;
                repaired = true;
                repairs.push({
                  category: 'MIN_DIMENSION_ELASTIC_SHIFT',
                  description: `Elastically shifted horizontal partition between ${roomA.id} and ${roomB.id} by ${delta} mm (conserving Delta = 0.000 mm²)`,
                  targetEntities: [roomA.id, roomB.id],
                });
                break;
              }
            }
          }
        }
      }

      if (!slackShifted && compactPlotAdaptation) {
        // Room cannot borrow slack; check if it meets compact plot threshold
        const cLimit = compactMin[roomA.type] ?? 1100;
        if (minDimA >= cLimit) {
          advisories.push(
            `COMPACT_PLOT_ADAPTATION: ${roomA.name} clear dimension ${minDimA} mm meets compact plot standard (>= ${cLimit} mm).`
          );
        }
      }
    }
  }

  return { rooms, repaired, repairs, advisories };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MULTI-TENANCY PRIVACY & GRAPH REACHABILITY REPAIR
// ─────────────────────────────────────────────────────────────────────────────

interface PrivacyRepairParams {
  rooms: Room[];
  doors: Door[];
  walls: Wall[];
  units: Floor['apartmentUnits'];
  floorId: string;
}

function repairPrivacyAndCirculation(params: PrivacyRepairParams): {
  doors: Door[];
  repaired: boolean;
  repairs: AppliedRepair[];
} {
  const { rooms, walls, units, floorId } = params;
  let doors = [...params.doors];
  const repairs: AppliedRepair[] = [];
  let repaired = false;

  // A. PRIVACY FIX: Eliminate direct doors between Common Corridor and Private Rooms
  const privateTypes = new Set([RoomType.Bedroom, RoomType.Bathroom, RoomType.Kitchen]);
  const preservedDoors: Door[] = [];

  for (const door of doors) {
    const [rAId, rBId] = door.connectsRooms;
    const roomA = rooms.find(r => r.id === rAId);
    const roomB = rooms.find(r => r.id === rBId);

    const isACommon = roomA && (roomA.spaceUse === 'COMMON' || roomA.spaceUse === 'CORE');
    const isBCommon = roomB && (roomB.spaceUse === 'COMMON' || roomB.spaceUse === 'CORE');

    const isAPrivate = roomA && roomA.unitId && privateTypes.has(roomA.type);
    const isBPrivate = roomB && roomB.unitId && privateTypes.has(roomB.type);

    if ((isACommon && isBPrivate) || (isBCommon && isAPrivate)) {
      // Direct corridor-to-private room door! Delete it for privacy.
      repaired = true;
      repairs.push({
        category: 'PRIVACY_CIRCULATION',
        description: `Eliminated privacy violation door ${door.id} connecting Common Corridor directly to private room`,
        targetEntities: [door.id],
      });
      continue;
    }

    // Door crossing between two different apartment units! Delete it.
    if (roomA?.unitId && roomB?.unitId && roomA.unitId !== roomB.unitId) {
      repaired = true;
      repairs.push({
        category: 'PRIVACY_CIRCULATION',
        description: `Eliminated cross-tenancy breach door ${door.id} connecting unit ${roomA.unitId} to unit ${roomB.unitId}`,
        targetEntities: [door.id],
      });
      continue;
    }

    preservedDoors.push(door);
  }
  doors = preservedDoors;

  // B. ENSURE EXACTLY 1 PRIMARY ENTRANCE DOOR PER UNIT (1050 mm or 1000 mm)
  if (units) {
    for (const u of units) {
      const unitRooms = rooms.filter(r => r.unitId === u.id);
      const livingRoom = unitRooms.find(r => r.type === RoomType.Living || r.tags.includes('role:living')) ?? unitRooms[0];
      const commonCorridor = rooms.find(r => r.spaceUse === 'COMMON' || r.type === RoomType.Corridor);

      if (!livingRoom || !commonCorridor) continue;

      const unitEntrances = doors.filter(d => {
        const [a, b] = d.connectsRooms;
        const hasUnit = unitRooms.some(r => r.id === a || r.id === b);
        const hasCommon = rooms.some(r => (r.id === a || r.id === b) && (r.spaceUse === 'COMMON' || r.spaceUse === 'CORE'));
        return hasUnit && hasCommon;
      });

      if (unitEntrances.length === 0) {
        // Synthesize primary entrance door from Common Corridor into Living Room
        const shared = findSharedWallSegment(commonCorridor, livingRoom);
        if (shared) {
          const width = shared.len >= 1250 ? 1050 : 1000;
          const hostWall = walls.find(w => w.roomIds.includes(commonCorridor.id) && w.roomIds.includes(livingRoom.id));
          const pos: Point = shared.axis === 'x'
            ? { x: snap10((shared.lo + shared.hi) / 2), y: shared.coord }
            : { x: shared.coord, y: snap10((shared.lo + shared.hi) / 2) };

          const newDoor: Door = {
            id: `${u.id}__door_primary_entrance`,
            floorId,
            wallId: hostWall?.id ?? '__auto_wall__',
            position: pos,
            width,
            height: 2100,
            type: DoorType.Single,
            swingDirection: SwingDirection.Inward,
            connectsRooms: [commonCorridor.id, livingRoom.id],
          };
          doors.push(newDoor);
          repaired = true;
          repairs.push({
            category: 'PRIVACY_CIRCULATION',
            description: `Synthesized missing Primary Entrance Door (${width} mm) for unit ${u.id}`,
            targetEntities: [newDoor.id, livingRoom.id],
          });
        }
      } else if (unitEntrances.length > 1) {
        // Keep the one connecting to Living and delete superfluous entrances
        const bestEntrance = unitEntrances.find(d => d.connectsRooms.includes(livingRoom.id)) ?? unitEntrances[0]!;
        for (const extra of unitEntrances) {
          if (extra.id !== bestEntrance.id) {
            doors = doors.filter(d => d.id !== extra.id);
            repaired = true;
            repairs.push({
              category: 'PRIVACY_CIRCULATION',
              description: `Removed secondary/redundant entrance door ${extra.id} for unit ${u.id}`,
              targetEntities: [extra.id],
            });
          }
        }
      }
    }
  }

  // C. BFS GRAPH REACHABILITY: Heal Orphan / Disconnected Rooms
  const graph = new Map<string, Set<string>>(rooms.map(r => [r.id, new Set<string>()]));
  for (const d of doors) {
    const [a, b] = d.connectsRooms;
    if (graph.has(a) && graph.has(b)) {
      graph.get(a)!.add(b);
      graph.get(b)!.add(a);
    }
  }

  if (units) {
    for (const u of units) {
      const unitRooms = rooms.filter(r => r.unitId === u.id);
      const livingRoom = unitRooms.find(r => r.type === RoomType.Living || r.tags.includes('role:living')) ?? unitRooms[0];
      if (!livingRoom) continue;

      // Run BFS inside this unit from Living
      const visited = new Set<string>([livingRoom.id]);
      const queue = [livingRoom.id];
      while (queue.length > 0) {
        const curr = queue.shift()!;
        for (const neighbor of graph.get(curr) ?? []) {
          const nRoom = rooms.find(r => r.id === neighbor);
          if (nRoom?.unitId === u.id && !visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      // Check for orphan rooms inside this unit
      const unreachable = unitRooms.filter(r => !visited.has(r.id));
      for (const orphan of unreachable) {
        if (visited.has(orphan.id)) continue;
        // Connect orphan to a reachable room sharing a wall segment
        let targetReachable: Room | null = null;

        // If orphan is an attached bathroom, try its owner bedroom first
        if (orphan.type === RoomType.Bathroom && orphan.bathroomOwnerRoomId) {
          const owner = unitRooms.find(r => r.id === orphan.bathroomOwnerRoomId);
          if (owner && visited.has(owner.id) && findSharedWallSegment(orphan, owner)) {
            targetReachable = owner;
          }
        }

        // If orphan is a utility, try kitchen
        if (!targetReachable && (orphan.type === RoomType.Utility || orphan.name.toLowerCase().includes('utility'))) {
          const kitchen = unitRooms.find(r => r.type === RoomType.Kitchen && visited.has(r.id));
          if (kitchen && findSharedWallSegment(orphan, kitchen)) {
            targetReachable = kitchen;
          }
        }

        // Otherwise find any reachable room sharing longest boundary (never route through a bathroom)
        if (!targetReachable && !orphan.bathroomOwnerRoomId) {
          const candidates = unitRooms.filter(r => visited.has(r.id) && !r.bathroomOwnerRoomId && r.type !== RoomType.Bathroom && findSharedWallSegment(orphan, r));
          if (candidates.length > 0) {
            candidates.sort((a, b) => {
              const lenA = findSharedWallSegment(orphan, a)?.len ?? 0;
              const lenB = findSharedWallSegment(orphan, b)?.len ?? 0;
              return lenB - lenA;
            });
            targetReachable = candidates[0]!;
          }
        }

        if (targetReachable) {
          const shared = findSharedWallSegment(orphan, targetReachable)!;
          const isBath = orphan.type === RoomType.Bathroom;
          const isBalc = orphan.type === RoomType.Balcony;
          const isUtil = orphan.type === RoomType.Utility;

          const width = isBalc ? (shared.len >= 1700 ? 1500 : 900) : isBath || isUtil ? (shared.len >= 950 ? 750 : 700) : (shared.len >= 1100 ? 900 : 800);
          const pos: Point = shared.axis === 'x'
            ? { x: snap10((shared.lo + shared.hi) / 2), y: shared.coord }
            : { x: shared.coord, y: snap10((shared.lo + shared.hi) / 2) };

          const hostWall = walls.find(w => w.roomIds.includes(orphan.id) && w.roomIds.includes(targetReachable!.id));

          const newDoor: Door = {
            id: `${orphan.id}__door_reachability`,
            floorId,
            wallId: hostWall?.id ?? '__auto_wall__',
            position: pos,
            width,
            height: 2100,
            type: isBalc ? DoorType.Sliding : DoorType.Single,
            swingDirection: isBalc || isUtil ? SwingDirection.Outward : SwingDirection.Inward,
            connectsRooms: [targetReachable.id, orphan.id],
          };
          doors.push(newDoor);
          visited.add(orphan.id);
          graph.get(orphan.id)!.add(targetReachable.id);
          graph.get(targetReachable.id)!.add(orphan.id);
          // Connecting a component reaches its existing attached bathrooms too.
          const pending = [orphan.id];
          for (let i = 0; i < pending.length; i++) for (const id of graph.get(pending[i]!) ?? []) {
            if (!visited.has(id) && unitRooms.some(r => r.id === id)) { visited.add(id); pending.push(id); }
          }
          repaired = true;
          repairs.push({
            category: 'PRIVACY_CIRCULATION',
            description: `Healed orphan space ${orphan.id} (${orphan.name}) by creating connecting door to ${targetReachable.id}`,
            targetEntities: [newDoor.id, orphan.id, targetReachable.id],
          });
        }
      }
    }
  }

  return { doors, repaired, repairs };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. DOOR HOST, CORNER CLEARANCE & SWING COLLISION REPAIR
// ─────────────────────────────────────────────────────────────────────────────

interface DoorRepairParams {
  rooms: Room[];
  doors: Door[];
  walls: Wall[];
  floorId: string;
}

function repairDoorHostsAndClearance(params: DoorRepairParams): {
  doors: Door[];
  repaired: boolean;
  repairs: AppliedRepair[];
} {
  const { rooms, walls, floorId } = params;
  const repairedDoors: Door[] = [];
  const repairs: AppliedRepair[] = [];
  let repaired = false;

  for (const door of params.doors) {
    const [rAId, rBId] = door.connectsRooms;
    const roomA = rooms.find(r => r.id === rAId);
    const roomB = rooms.find(r => r.id === rBId);

    if (!roomA || !roomB) {
      // Dangling room reference: skip
      continue;
    }

    // Find the actual wall hosting this door between Room A and Room B
    const matchingWall = walls.find(w => w.roomIds.includes(roomA.id) && w.roomIds.includes(roomB.id));
    if (!matchingWall) {
      // Rooms do not share a wall in geometry; cannot host a valid door
      continue;
    }

    const wallLen = Math.hypot(
      matchingWall.endPoint.x - matchingWall.startPoint.x,
      matchingWall.endPoint.y - matchingWall.startPoint.y
    );

    // 1. Check door width against wall length with 100 mm nib clearance on each side
    let doorWidth = door.width;
    const isEntrance = (roomA.spaceUse === 'COMMON' || roomA.spaceUse === 'CORE') && roomB.unitId ||
                       (roomB.spaceUse === 'COMMON' || roomB.spaceUse === 'CORE') && roomA.unitId;
    const isBedroom = roomA.type === RoomType.Bedroom || roomB.type === RoomType.Bedroom;
    const isKitchen = roomA.type === RoomType.Kitchen || roomB.type === RoomType.Kitchen;
    const isService = roomA.type === RoomType.Bathroom || roomB.type === RoomType.Bathroom ||
                      roomA.type === RoomType.Utility || roomB.type === RoomType.Utility;

    const maxStatutoryWidth = isEntrance ? 1050 : (isBedroom || isKitchen) ? 900 : isService ? 750 : 1500;
    if (doorWidth > maxStatutoryWidth) {
      doorWidth = maxStatutoryWidth;
    }

    // Statutory step-down if wall segment is tight
    if (wallLen < doorWidth + 200) {
      if (isEntrance && wallLen >= 1200) doorWidth = 1000;
      else if (isBedroom && wallLen >= 1000) doorWidth = 800;
      else if (isService && wallLen >= 900) doorWidth = 700;
      else doorWidth = Math.max(650, Math.floor(wallLen - 200));
    }

    if (wallLen < doorWidth + 200) {
      // Wall segment is fundamentally shorter than minimum statutory door clearance
      continue;
    }

    // 2. Position door strictly centered on host wall to guarantee >= 100mm corner clearance
    const horizontal = Math.abs(matchingWall.startPoint.y - matchingWall.endPoint.y) <= 1;
    let centerPos: Point;
    if (horizontal) {
      const minX = Math.min(matchingWall.startPoint.x, matchingWall.endPoint.x);
      const maxX = Math.max(matchingWall.startPoint.x, matchingWall.endPoint.x);
      const exactX = (minX + maxX) / 2;
      const minValidX = minX + 100 + doorWidth / 2;
      const maxValidX = maxX - 100 - doorWidth / 2;
      const x = Math.min(maxValidX, Math.max(minValidX, Math.round(exactX)));
      centerPos = { x, y: matchingWall.startPoint.y };
    } else {
      const minY = Math.min(matchingWall.startPoint.y, matchingWall.endPoint.y);
      const maxY = Math.max(matchingWall.startPoint.y, matchingWall.endPoint.y);
      const exactY = (minY + maxY) / 2;
      const minValidY = minY + 100 + doorWidth / 2;
      const maxValidY = maxY - 100 - doorWidth / 2;
      const y = Math.min(maxValidY, Math.max(minValidY, Math.round(exactY)));
      centerPos = { x: matchingWall.startPoint.x, y };
    }

    // 3. Swing collision & clearance:
    // Balcony & service shaft doors swing outward/sliding; entrance doors swing inward into flat.
    let swingDirection = door.swingDirection;
    let doorType = door.type;

    if (roomA.type === RoomType.Balcony || roomB.type === RoomType.Balcony) {
      doorType = DoorType.Sliding;
    } else if (isEntrance) {
      swingDirection = SwingDirection.Inward;
    }

    const updatedDoor: Door = {
      ...door,
      floorId,
      wallId: matchingWall.id,
      position: centerPos,
      width: doorWidth,
      type: doorType,
      swingDirection,
    };

    if (
      door.wallId !== matchingWall.id ||
      door.width !== doorWidth ||
      Math.abs(door.position.x - centerPos.x) > 2 ||
      Math.abs(door.position.y - centerPos.y) > 2
    ) {
      repaired = true;
      repairs.push({
        category: 'DOOR_HOST_AND_SWING',
        description: `Centered door ${door.id} on host wall ${matchingWall.id} with ${doorWidth} mm width (>= 100mm corner clearance)`,
        targetEntities: [door.id, matchingWall.id],
      });
    }

    repairedDoors.push(updatedDoor);
  }

  // 4. Overlapping Door Resolution
  const nonOverlappingDoors: Door[] = [];
  for (let i = 0; i < repairedDoors.length; i++) {
    const d1 = repairedDoors[i]!;
    let overlap = false;

    for (let j = 0; j < nonOverlappingDoors.length; j++) {
      const d2 = nonOverlappingDoors[j]!;
      if (d1.wallId === d2.wallId) {
        const dist = Math.hypot(d1.position.x - d2.position.x, d1.position.y - d2.position.y);
        if (dist < (d1.width + d2.width) / 2) {
          overlap = true;
          break;
        }
      }
    }

    if (!overlap) {
      nonOverlappingDoors.push(d1);
    } else {
      repaired = true;
      repairs.push({
        category: 'DOOR_HOST_AND_SWING',
        description: `Resolved opening overlap by deduplicating coincident door ${d1.id} on wall ${d1.wallId}`,
        targetEntities: [d1.id],
      });
    }
  }

  return { doors: nonOverlappingDoors, repaired, repairs };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. DAYLIGHTING & MEP SERVICE SHAFT REPAIR
// ─────────────────────────────────────────────────────────────────────────────

interface DaylightRepairParams {
  rooms: Room[];
  windows: Window[];
  doors: Door[];
  walls: Wall[];
  floorId: string;
}

function repairDaylightAndVentilation(params: DaylightRepairParams): {
  windows: Window[];
  repaired: boolean;
  repairs: AppliedRepair[];
} {
  const { rooms, doors, walls, floorId } = params;
  let repaired = false;
  const repairs: AppliedRepair[] = [];

  // Filter out any stale windows that no longer fit their host wall or room
  const windows = params.windows.filter(w => {
    const host = walls.find(wall => wall.id === w.wallId);
    const room = rooms.find(r => r.id === w.roomId);
    if (!host || !room) return false;
    return openingFitsApartmentWall(host, w.position, w.width) && host.roomIds.includes(w.roomId);
  });
  if (windows.length !== params.windows.length) {
    repaired = true;
  }

  for (const r of rooms) {
    if (!r.unitId) continue;

    // A. Habitable rooms: Living, Bedroom, Kitchen
    if (['living', 'bedroom', 'kitchen'].includes(r.type)) {
      const hasWindow = windows.some(w => w.roomId === r.id);
      const hasBalconyOrUtilityDoor = doors.some(d => {
        const otherId = d.connectsRooms[0] === r.id ? d.connectsRooms[1] : d.connectsRooms[0];
        const other = rooms.find(o => o.id === otherId);
        return other && (other.type === RoomType.Balcony || other.type === RoomType.Utility);
      });

      if (!hasWindow && !hasBalconyOrUtilityDoor) {
        // Find exterior wall of this room
        const candWalls = walls.filter(w =>
          w.roomIds.includes(r.id) &&
          (w.wallUse === 'EXTERNAL' || (w.roomIds.length === 1 && w.type === WallType.External))
        );

        for (const hostWall of candWalls) {
          const len = Math.hypot(hostWall.endPoint.x - hostWall.startPoint.x, hostWall.endPoint.y - hostWall.startPoint.y);
          if (len < 900) continue;

          const winWidth = Math.min(1500, Math.max(700, Math.min(len - 200, Math.round(len * 0.40))));
          const pos: Point = {
            x: snap10((hostWall.startPoint.x + hostWall.endPoint.x) / 2),
            y: snap10((hostWall.startPoint.y + hostWall.endPoint.y) / 2),
          };

          if (openingFitsApartmentWall(hostWall, pos, winWidth)) {
            const newWin: Window = {
              id: `${r.id}__auto_window`,
              floorId,
              wallId: hostWall.id,
              position: pos,
              width: winWidth,
              height: 1200,
              sillHeight: 900,
              type: WindowType.Sliding,
              roomId: r.id,
            };
            windows.push(newWin);
            repaired = true;
            repairs.push({
              category: 'DAYLIGHT_SHAFT',
              description: `Added ${winWidth} mm exterior daylight window for ${r.name} (${r.type})`,
              targetEntities: [newWin.id, r.id],
            });
            break;
          }
        }
      }
    }

    // B. Bathrooms: Exterior window or Service Shaft ventilation
    if (r.type === RoomType.Bathroom) {
      const hasVent = windows.some(w => w.roomId === r.id);
      const touchesShaft = walls.some(w => w.roomIds.includes(r.id) && w.wallUse === 'SHAFT');

      if (!hasVent && !touchesShaft) {
        const extWall = walls.find(w => w.roomIds.includes(r.id) && (w.wallUse === 'EXTERNAL' || w.roomIds.length === 1));
        if (extWall) {
          const len = Math.hypot(extWall.endPoint.x - extWall.startPoint.x, extWall.endPoint.y - extWall.startPoint.y);
          if (len >= 800) {
            const ventWidth = 600;
            const pos: Point = {
              x: snap10((extWall.startPoint.x + extWall.endPoint.x) / 2),
              y: snap10((extWall.startPoint.y + extWall.endPoint.y) / 2),
            };
            if (openingFitsApartmentWall(extWall, pos, ventWidth)) {
              const newVent: Window = {
                id: `${r.id}__auto_ventilator`,
                floorId,
                wallId: extWall.id,
                position: pos,
                width: ventWidth,
                height: 600,
                sillHeight: 1800,
                type: WindowType.Ventilator,
                roomId: r.id,
              };
              windows.push(newVent);
              repaired = true;
              repairs.push({
                category: 'DAYLIGHT_SHAFT',
                description: `Added 600 mm ventilator window on exterior wall for bathroom ${r.id}`,
                targetEntities: [newVent.id, r.id],
              });
            }
          }
        }
      }
    }
  }

  return { windows, repaired, repairs };
}

import {
  DoorType,
  RoomType,
  WallType,
  WindowType,
  architecturalSpaceRole,
  type Building,
  type Column,
  type CoordinatedChajjaBand,
  type Door,
  type FacadeCoordinationMetadata,
  type FlatExposureProfile,
  type Floor,
  type GalleryBayCoordination,
  type GalleryCoordinationMode,
  type OtsLouverScreen,
  type Point,
  type Room,
  type Wall,
  type Window,
} from '@ai-floor-planner/core';
import {
  openingFitsApartmentWall,
  pointInPolygon,
  polygonBoundingBox,
  polygonIntersectionArea,
} from '@ai-floor-planner/geometry-engine';

export const FACADE_LINTEL_DATUM_MM = 2100;
export const CHAJJA_PROJECTION_MM = 600;
export const CHAJJA_FASCIA_MM = 100;
export const CHAJJA_MERGE_GAP_MM = 1500;
export const VERTICAL_BAY_CLUSTER_MM = 350;

export interface FacadeCoordinationOptions {
  readonly galleryCoordinationMode?: GalleryCoordinationMode;
  readonly flatExposures?: readonly FlatExposureProfile[];
  readonly includeWindowChajjas?: boolean;
}

function standardizedWindowVerticals(room: Room | undefined, win: Window): {
  readonly sillHeight: number;
  readonly height: number;
} {
  if (room?.type === RoomType.Bathroom || win.type === WindowType.Ventilator) {
    return { sillHeight: 1500, height: 600 }; // 1500 + 600 = 2100 mm lintel (>= 0.39 m² @ 650w)
  }
  if (room?.type === RoomType.Kitchen) {
    return { sillHeight: 1100, height: 1000 }; // 1100 + 1000 = 2100 mm lintel
  }
  return { sillHeight: 900, height: 1200 }; // 900 + 1200 = 2100 mm lintel
}

function isBuiltSolidRoom(room: Room): boolean {
  return (
    architecturalSpaceRole(room) !== 'OPEN_TO_SKY_VOID' &&
    !room.tags?.includes('recess:perimeter') &&
    !room.openToSky
  );
}

function cleanZero(v: number): number {
  return Object.is(v, -0) || Math.abs(v) < 1e-12 ? 0 : v;
}

function computeWallOutwardNormal(wall: Wall, floor: Floor): Point | null {
  const dx = wall.endPoint.x - wall.startPoint.x;
  const dy = wall.endPoint.y - wall.startPoint.y;
  const len = Math.hypot(dx, dy);
  if (len < 10) return null;
  const ux = dx / len;
  const uy = dy / len;
  const nA: Point = { x: cleanZero(-uy), y: cleanZero(ux) };
  const nB: Point = { x: cleanZero(uy), y: cleanZero(-ux) };
  const mid: Point = {
    x: (wall.startPoint.x + wall.endPoint.x) / 2,
    y: (wall.startPoint.y + wall.endPoint.y) / 2,
  };
  const probeDist = (wall.thickness || 150) / 2 + 160;
  const probeA: Point = { x: mid.x + nA.x * probeDist, y: mid.y + nA.y * probeDist };
  const probeB: Point = { x: mid.x + nB.x * probeDist, y: mid.y + nB.y * probeDist };

  const builtRooms = floor.rooms.filter(isBuiltSolidRoom);
  const insideBuilt = (pt: Point) => builtRooms.some(r => pointInPolygon(pt, r.boundary));

  const aOutBoundary = !pointInPolygon(probeA, floor.boundary);
  const bOutBoundary = !pointInPolygon(probeB, floor.boundary);
  if (aOutBoundary && !bOutBoundary) return nA;
  if (bOutBoundary && !aOutBoundary) return nB;

  const aOutBuilt = !insideBuilt(probeA);
  const bOutBuilt = !insideBuilt(probeB);
  if (aOutBuilt && !bOutBuilt) return nA;
  if (bOutBuilt && !aOutBuilt) return nB;

  return aOutBoundary ? nA : bOutBoundary ? nB : null;
}

function facadeSideFromNormal(normal: Point): 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' | null {
  if (Math.abs(normal.y) >= 0.85) {
    return normal.y < 0 ? 'NORTH' : 'SOUTH';
  }
  if (Math.abs(normal.x) >= 0.85) {
    return normal.x < 0 ? 'WEST' : 'EAST';
  }
  return null;
}

function isExteriorOrOpenShaftWall(wall: Wall): boolean {
  return (
    wall.wallUse === 'EXTERNAL' ||
    wall.type === WallType.External ||
    wall.roomIds.length <= 1
  );
}

function measurePointSetDrift(refPts: readonly Point[], targetPts: readonly Point[]): number {
  if (refPts.length === 0 || targetPts.length === 0) return 0;
  let maxDrift = 0;
  for (const p of targetPts) {
    let best = Infinity;
    for (const q of refPts) {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < best) best = d;
    }
    if (Number.isFinite(best) && best > maxDrift) maxDrift = best;
  }
  return maxDrift;
}

function roomCenters(floor: Floor, predicate: (room: Room) => boolean): Point[] {
  return floor.rooms.filter(predicate).map(r => {
    const b = polygonBoundingBox(r.boundary);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
}

function columnFootprintPoly(col: Column): { points: Point[] } {
  const hw = (col.width || 300) / 2;
  const hd = (col.depth || 300) / 2;
  return {
    points: [
      { x: col.position.x - hw, y: col.position.y - hd },
      { x: col.position.x + hw, y: col.position.y - hd },
      { x: col.position.x + hw, y: col.position.y + hd },
      { x: col.position.x - hw, y: col.position.y + hd },
    ],
  };
}

function lockResidentialColumnsToReference(floors: readonly Floor[]): {
  readonly floors: Floor[];
  readonly coreAlignmentDriftMaxMm: number;
} {
  const resIndices: number[] = [];
  floors.forEach((f, idx) => {
    if (f.floorUse === 'RESIDENTIAL' || (f.apartmentUnits?.length ?? 0) > 0) {
      resIndices.push(idx);
    }
  });
  if (resIndices.length <= 1) {
    return { floors: [...floors], coreAlignmentDriftMaxMm: 0 };
  }

  const refFloor = floors[resIndices[0]!]!;
  const updatedFloors = [...floors];

  // Lock primary RCC column grid across ALL storeys (stilt, residential, roof)
  // to a single continuous structural grid that never punches through an
  // alternating staggered cantilevered balcony on ANY residential floor.
  if (refFloor.columns.length > 0) {
    const allBalconies = floors.flatMap(fl =>
      fl.rooms.filter(
        r => r.type === RoomType.Balcony || r.type === RoomType.Utility,
      ),
    );
    const seenCoords = new Set<string>();
    const dedupedRefCols = refFloor.columns.filter(col => {
      const key = `${col.position.x}:${col.position.y}`;
      if (seenCoords.has(key)) return false;
      seenCoords.add(key);
      return true;
    });
    const sharedSafeColumns = dedupedRefCols.filter(col => {
      const colPoly = columnFootprintPoly(col);
      return !allBalconies.some(
        balc => polygonIntersectionArea(colPoly, balc.boundary) >= 0.001,
      );
    });
    const canonicalGrid = sharedSafeColumns.length > 0 ? sharedSafeColumns : dedupedRefCols;

    for (let floorIdx = 0; floorIdx < updatedFloors.length; floorIdx++) {
      const fl = updatedFloors[floorIdx]!;
      if (fl.columns.length === 0) continue;
      const lockedCols: Column[] = canonicalGrid.map((col, cIdx) => ({
        ...col,
        id: `${fl.id}::col_locked_${cIdx + 1}`,
        floorId: fl.id,
        position: { x: col.position.x, y: col.position.y },
      }));
      updatedFloors[floorIdx] = { ...fl, columns: lockedCols };
    }
  }

  const refLifts = roomCenters(refFloor, r => r.type === RoomType.Lift);
  const refStairs = roomCenters(refFloor, r => r.type === RoomType.Staircase);
  const refOts = roomCenters(
    refFloor,
    r => architecturalSpaceRole(r) === 'OPEN_TO_SKY_VOID' && !r.tags?.includes('recess:perimeter'),
  );
  const refShafts = roomCenters(
    refFloor,
    r => r.type === RoomType.ServiceShaft && architecturalSpaceRole(r) !== 'OPEN_TO_SKY_VOID',
  );
  const refCols = updatedFloors[resIndices[0]!]!.columns.map(c => c.position);

  let maxDrift = 0;
  for (let k = 1; k < resIndices.length; k++) {
    const fl = updatedFloors[resIndices[k]!]!;
    maxDrift = Math.max(
      maxDrift,
      measurePointSetDrift(refLifts, roomCenters(fl, r => r.type === RoomType.Lift)),
      measurePointSetDrift(refStairs, roomCenters(fl, r => r.type === RoomType.Staircase)),
      measurePointSetDrift(
        refOts,
        roomCenters(fl, r => architecturalSpaceRole(r) === 'OPEN_TO_SKY_VOID' && !r.tags?.includes('recess:perimeter')),
      ),
      measurePointSetDrift(
        refShafts,
        roomCenters(fl, r => r.type === RoomType.ServiceShaft && architecturalSpaceRole(r) !== 'OPEN_TO_SKY_VOID'),
      ),
      measurePointSetDrift(refCols, fl.columns.map(c => c.position)),
    );
  }

  return {
    floors: updatedFloors,
    coreAlignmentDriftMaxMm: Math.round(maxDrift * 100) / 100,
  };
}

function openingAlongWall(wall: Wall, pos: Point): number {
  const dx = wall.endPoint.x - wall.startPoint.x;
  const dy = wall.endPoint.y - wall.startPoint.y;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-6) return 0;
  return ((pos.x - wall.startPoint.x) * dx + (pos.y - wall.startPoint.y) * dy) / len;
}

function noOpeningCollisionOnWall(
  wall: Wall,
  candidateCenterAlong: number,
  candidateWidth: number,
  candidateId: string,
  floor: Floor,
): boolean {
  const c0 = candidateCenterAlong - candidateWidth / 2;
  const c1 = candidateCenterAlong + candidateWidth / 2;
  const minGap = 60;
  for (const d of floor.doors) {
    if (d.wallId !== wall.id) continue;
    const t = openingAlongWall(wall, d.position);
    if (c0 < t + d.width / 2 + minGap && c1 > t - d.width / 2 - minGap) return false;
  }
  for (const w of floor.windows) {
    if (w.wallId !== wall.id || w.id === candidateId) continue;
    const t = openingAlongWall(wall, w.position);
    if (c0 < t + w.width / 2 + minGap && c1 > t - w.width / 2 - minGap) return false;
  }
  return true;
}

/**
 * Standardizes lintel datum (2,100 mm), sill heights by room type, full-height
 * sliding gallery doors, and snaps exterior window bays across residential floors
 * to a shared vertical bay datum while preserving >= 100 mm corner nibs.
 */
function coordinateVerticalWindowDatum(floors: readonly Floor[]): {
  readonly floors: Floor[];
  readonly verticalJambDriftMaxMm: number;
} {
  const nextFloors: Floor[] = floors.map(floor => {
    const isRes = floor.floorUse === 'RESIDENTIAL' || (floor.apartmentUnits?.length ?? 0) > 0;
    if (!isRes) return floor;

    const roomById = new Map(floor.rooms.map(r => [r.id, r]));
    const nextWindows: Window[] = floor.windows.map(win => {
      const room = roomById.get(win.roomId);
      const { sillHeight, height } = standardizedWindowVerticals(room, win);
      return {
        ...win,
        sillHeight,
        height,
        sillHeightMm: sillHeight,
        heightMm: height,
        widthMm: win.width,
      };
    });

    const nextDoors: Door[] = floor.doors.map(door => {
      const connectsBalcony = door.connectsRooms.some(
        id => roomById.get(id)?.type === RoomType.Balcony,
      );
      if (door.type === DoorType.Sliding && connectsBalcony) {
        return {
          ...door,
          height: FACADE_LINTEL_DATUM_MM,
          heightMm: FACADE_LINTEL_DATUM_MM,
          sillHeightMm: 0,
        };
      }
      return door;
    });

    return { ...floor, windows: nextWindows, doors: nextDoors };
  });

  // Collect exterior straight windows across residential floors grouped by facade plane.
  interface ExtWinRef {
    floorIdx: number;
    winIdx: number;
    wall: Wall;
    side: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';
    planeKey: string;
    axisCoord: number;
    width: number;
  }

  const extWins: ExtWinRef[] = [];
  nextFloors.forEach((floor, floorIdx) => {
    const isRes = floor.floorUse === 'RESIDENTIAL' || (floor.apartmentUnits?.length ?? 0) > 0;
    if (!isRes) return;
    const wallById = new Map(floor.walls.map(w => [w.id, w]));
    floor.windows.forEach((win, winIdx) => {
      const wall = wallById.get(win.wallId);
      if (!wall || wall.arc || !isExteriorOrOpenShaftWall(wall)) return;
      const outN = computeWallOutwardNormal(wall, floor);
      if (!outN) return;
      const side = facadeSideFromNormal(outN);
      if (!side) return;
      const isHoriz = side === 'NORTH' || side === 'SOUTH';
      const planeCoord = isHoriz
        ? (wall.startPoint.y + wall.endPoint.y) / 2
        : (wall.startPoint.x + wall.endPoint.x) / 2;
      const planeBucket = Math.round(planeCoord / 150) * 150;
      const axisCoord = isHoriz ? win.position.x : win.position.y;
      extWins.push({
        floorIdx,
        winIdx,
        wall,
        side,
        planeKey: `${side}:${planeBucket}`,
        axisCoord,
        width: win.width,
      });
    });
  });

  // Cluster by planeKey and snap corresponding multi-floor window centerlines to Floor-1 bay datum.
  const byPlane = new Map<string, ExtWinRef[]>();
  for (const item of extWins) {
    const arr = byPlane.get(item.planeKey) ?? [];
    arr.push(item);
    byPlane.set(item.planeKey, arr);
  }

  let maxJambDrift = 0;

  for (const items of byPlane.values()) {
    // Sort by floorIdx ascending so lower/reference floor establishes canonical bay datums.
    items.sort((a, b) => a.floorIdx - b.floorIdx || a.axisCoord - b.axisCoord);
    const clusters: Array<{ datum: number; members: ExtWinRef[] }> = [];
    for (const item of items) {
      const match = clusters.find(c => Math.abs(c.datum - item.axisCoord) <= VERTICAL_BAY_CLUSTER_MM);
      if (match) {
        match.members.push(item);
      } else {
        clusters.push({ datum: item.axisCoord, members: [item] });
      }
    }

    for (const cluster of clusters) {
      if (cluster.members.length < 2) continue;
      const datum = Math.round(cluster.datum);
      for (const m of cluster.members) {
        const fl = nextFloors[m.floorIdx]!;
        const win = fl.windows[m.winIdx]!;
        const isHoriz = m.side === 'NORTH' || m.side === 'SOUTH';
        const wall = m.wall;
        const dx = wall.endPoint.x - wall.startPoint.x;
        const dy = wall.endPoint.y - wall.startPoint.y;
        const wallLen = Math.hypot(dx, dy);
        if (wallLen < 400) continue;

        const targetPos: Point = isHoriz
          ? { x: datum, y: win.position.y }
          : { x: win.position.x, y: datum };
        const along = openingAlongWall(wall, targetPos);
        const clampedPos: Point = {
          x: wall.startPoint.x + (dx / wallLen) * along,
          y: wall.startPoint.y + (dy / wallLen) * along,
        };

        if (
          Math.abs(along - openingAlongWall(wall, win.position)) > 0.5 &&
          openingFitsApartmentWall(wall, clampedPos, win.width) &&
          noOpeningCollisionOnWall(wall, along, win.width, win.id, fl)
        ) {
          const updatedWins = [...fl.windows];
          updatedWins[m.winIdx] = { ...win, position: clampedPos };
          nextFloors[m.floorIdx] = { ...fl, windows: updatedWins };
          m.axisCoord = isHoriz ? clampedPos.x : clampedPos.y;
        }
      }

      // Measure residual drift across all members of this vertical bay cluster
      const coords = cluster.members.map(m => m.axisCoord);
      const bayDrift = Math.max(...coords) - Math.min(...coords);
      if (bayDrift > maxJambDrift) maxJambDrift = bayDrift;
    }
  }

  return {
    floors: nextFloors,
    verticalJambDriftMaxMm: Math.round(maxJambDrift * 100) / 100,
  };
}

/**
 * Synthesizes 600 mm projecting concrete chajja bands aligned to the 2,100 mm
 * lintel datum, merging adjacent windows on the same exterior facade face
 * within 1,500 mm into one continuous band with crisp 100 mm fascia edge.
 */
export function synthesizeCoordinatedChajjaBands(
  floors: readonly Floor[],
): CoordinatedChajjaBand[] {
  const bands: CoordinatedChajjaBand[] = [];
  let bandSeq = 1;

  for (const floor of floors) {
    const isRes = floor.floorUse === 'RESIDENTIAL' || (floor.apartmentUnits?.length ?? 0) > 0;
    if (!isRes) continue;
    const wallById = new Map(floor.walls.map(w => [w.id, w]));

    interface StraightWinItem {
      win: Window;
      wall: Wall;
      side: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';
      outN: Point;
      planeCoord: number;
      t0: number;
      t1: number;
    }

    const straightGroups = new Map<string, StraightWinItem[]>();

    const narrowOtsVoids = floor.rooms.filter(
      r =>
        architecturalSpaceRole(r) === 'OPEN_TO_SKY_VOID' &&
        !r.tags?.includes('recess:perimeter') &&
        Math.min(r.width, r.height) < 2400,
    );

    for (const win of floor.windows) {
      const wall = wallById.get(win.wallId);
      if (!wall) continue;
      if (wall.wallUse === 'BALCONY' || wall.wallUse === 'SHAFT') continue; // Balcony slab overhead or narrow shaft
      const isExt = isExteriorOrOpenShaftWall(wall);
      if (!isExt) continue;
      const outN = computeWallOutwardNormal(wall, floor);
      if (!outN) continue;
      // Disable opposing 600 mm chajjas inside narrow OTS ventilation ducts (< 2,400 mm span)
      const outProbe: Point = {
        x: win.position.x + outN.x * 350,
        y: win.position.y + outN.y * 350,
      };
      if (narrowOtsVoids.some(v => pointInPolygon(outProbe, v.boundary))) {
        continue;
      }

      if (wall.arc && wall.arc.radiusMm > 0) {
        const dx = wall.endPoint.x - wall.startPoint.x;
        const dy = wall.endPoint.y - wall.startPoint.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const halfSpan = win.width / 2 + 150;
        bands.push({
          id: `chajja_band_${floor.id}_${bandSeq++}`,
          floorId: floor.id,
          facadeSide: 'CURVED',
          wallIds: [wall.id],
          windowIds: [win.id],
          startPoint: { x: win.position.x - ux * halfSpan, y: win.position.y - uy * halfSpan },
          endPoint: { x: win.position.x + ux * halfSpan, y: win.position.y + uy * halfSpan },
          outwardNormal: outN,
          projectionMm: CHAJJA_PROJECTION_MM,
          lintelHeightMm: FACADE_LINTEL_DATUM_MM,
          fasciaThicknessMm: CHAJJA_FASCIA_MM,
          mergedWindowCount: 1,
          arc: wall.arc,
        });
        continue;
      }

      const side = facadeSideFromNormal(outN);
      if (!side) {
        // Angled straight wall (e.g. polygonal/irregular building edge): emit individual crisp chajja
        const dx = wall.endPoint.x - wall.startPoint.x;
        const dy = wall.endPoint.y - wall.startPoint.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const halfSpan = win.width / 2 + 150;
        bands.push({
          id: `chajja_band_${floor.id}_${bandSeq++}`,
          floorId: floor.id,
          facadeSide: Math.abs(outN.y) >= Math.abs(outN.x)
            ? (outN.y < 0 ? 'NORTH' : 'SOUTH')
            : (outN.x < 0 ? 'WEST' : 'EAST'),
          wallIds: [wall.id],
          windowIds: [win.id],
          startPoint: { x: win.position.x - ux * halfSpan, y: win.position.y - uy * halfSpan },
          endPoint: { x: win.position.x + ux * halfSpan, y: win.position.y + uy * halfSpan },
          outwardNormal: outN,
          projectionMm: CHAJJA_PROJECTION_MM,
          lintelHeightMm: FACADE_LINTEL_DATUM_MM,
          fasciaThicknessMm: CHAJJA_FASCIA_MM,
          mergedWindowCount: 1,
        });
        continue;
      }

      const isHoriz = side === 'NORTH' || side === 'SOUTH';
      const planeCoord = isHoriz
        ? (wall.startPoint.y + wall.endPoint.y) / 2
        : (wall.startPoint.x + wall.endPoint.x) / 2;
      const planeBucket = Math.round(planeCoord / 120) * 120;
      const center = isHoriz ? win.position.x : win.position.y;
      const key = `${side}:${planeBucket}`;
      const list = straightGroups.get(key) ?? [];
      list.push({
        win,
        wall,
        side,
        outN,
        planeCoord,
        t0: center - win.width / 2,
        t1: center + win.width / 2,
      });
      straightGroups.set(key, list);
    }

    for (const group of straightGroups.values()) {
      group.sort((a, b) => a.t0 - b.t0);
      const mergedRuns: StraightWinItem[][] = [];
      for (const item of group) {
        const current = mergedRuns.at(-1);
        if (!current) {
          mergedRuns.push([item]);
          continue;
        }
        const prevMaxT1 = Math.max(...current.map(c => c.t1));
        if (item.t0 - prevMaxT1 <= CHAJJA_MERGE_GAP_MM) {
          current.push(item);
        } else {
          mergedRuns.push([item]);
        }
      }

      for (const run of mergedRuns) {
        const first = run[0]!;
        const isHoriz = first.side === 'NORTH' || first.side === 'SOUTH';
        const planeAvg = run.reduce((s, r) => s + r.planeCoord, 0) / run.length;
        const wallHalfThick = Math.max(...run.map(r => (r.wall.thickness || 230) / 2));
        const faceOffset = wallHalfThick;
        const startT = Math.min(...run.map(r => r.t0)) - 150;
        const endT = Math.max(...run.map(r => r.t1)) + 150;
        const startPoint: Point = isHoriz
          ? { x: startT, y: planeAvg + first.outN.y * faceOffset }
          : { x: planeAvg + first.outN.x * faceOffset, y: startT };
        const endPoint: Point = isHoriz
          ? { x: endT, y: planeAvg + first.outN.y * faceOffset }
          : { x: planeAvg + first.outN.x * faceOffset, y: endT };

        bands.push({
          id: `chajja_band_${floor.id}_${bandSeq++}`,
          floorId: floor.id,
          facadeSide: first.side,
          wallIds: [...new Set(run.map(r => r.wall.id))],
          windowIds: run.map(r => r.win.id),
          startPoint,
          endPoint,
          outwardNormal: first.outN,
          projectionMm: CHAJJA_PROJECTION_MM,
          lintelHeightMm: FACADE_LINTEL_DATUM_MM,
          fasciaThicknessMm: CHAJJA_FASCIA_MM,
          mergedWindowCount: run.length,
        });
      }
    }
  }

  return bands;
}

/**
 * Emits vertical aluminum louver fin screens covering every exterior OTS
 * ventilation duct slot and kitchen utility balcony opening across storeys.
 */
export function synthesizeOtsLouverScreens(floors: readonly Floor[]): OtsLouverScreen[] {
  const screens: OtsLouverScreen[] = [];
  let seq = 1;

  for (const floor of floors) {
    const isRes = floor.floorUse === 'RESIDENTIAL' || (floor.apartmentUnits?.length ?? 0) > 0;
    if (!isRes) continue;
    const fBox = polygonBoundingBox(floor.boundary);
    const tol = 25;
    const clearH = Math.max(2100, floor.floorHeight - (floor.slabThicknessMm ?? 150));

    for (const room of floor.rooms) {
      const isOts =
        architecturalSpaceRole(room) === 'OPEN_TO_SKY_VOID' &&
        !room.tags?.includes('recess:perimeter');
      const isUtility = room.type === RoomType.Utility;
      if (!isOts && !isUtility) continue;

      const rBox = polygonBoundingBox(room.boundary);
      const edges: Array<{ start: Point; end: Point; normal: Point; onOuter: boolean }> = [
        {
          start: { x: rBox.x, y: rBox.y },
          end: { x: rBox.x + rBox.width, y: rBox.y },
          normal: { x: 0, y: -1 },
          onOuter: Math.abs(rBox.y - fBox.y) <= tol,
        },
        {
          start: { x: rBox.x, y: rBox.y + rBox.height },
          end: { x: rBox.x + rBox.width, y: rBox.y + rBox.height },
          normal: { x: 0, y: 1 },
          onOuter: Math.abs(rBox.y + rBox.height - (fBox.y + fBox.height)) <= tol,
        },
        {
          start: { x: rBox.x, y: rBox.y },
          end: { x: rBox.x, y: rBox.y + rBox.height },
          normal: { x: -1, y: 0 },
          onOuter: Math.abs(rBox.x - fBox.x) <= tol,
        },
        {
          start: { x: rBox.x + rBox.width, y: rBox.y },
          end: { x: rBox.x + rBox.width, y: rBox.y + rBox.height },
          normal: { x: 1, y: 0 },
          onOuter: Math.abs(rBox.x + rBox.width - (fBox.x + fBox.width)) <= tol,
        },
      ];

      for (const e of edges) {
        if (!e.onOuter) continue;
        const span = Math.hypot(e.end.x - e.start.x, e.end.y - e.start.y);
        if (span < 600) continue;
        screens.push({
          id: `louver_${floor.id}_${seq++}`,
          floorId: floor.id,
          roomId: room.id,
          kind: isUtility ? 'UTILITY_BALCONY' : 'OTS_DUCT',
          startPoint: e.start,
          endPoint: e.end,
          outwardNormal: e.normal,
          bottomMm: isUtility ? 1050 : 0,
          topMm: clearH,
          slatPitchMm: 120,
        });
      }
    }
  }

  return screens;
}

function synthesizeGalleryBays(
  floors: readonly Floor[],
  mode: GalleryCoordinationMode,
): GalleryBayCoordination[] {
  const resFloors = floors
    .filter(f => f.floorUse === 'RESIDENTIAL' || (f.apartmentUnits?.length ?? 0) > 0)
    .sort((a, b) => a.level - b.level);

  const isPrimaryGallery = (room: Room): boolean =>
    room.type === RoomType.Balcony &&
    (/sit-?out/i.test(room.name) || (room.id.endsWith('__balcony') && !/__bed|master_bed/i.test(room.id)));

  return resFloors.map((floor, idx) => {
    const variant: 'ODD' | 'EVEN' = idx % 2 === 0 ? 'ODD' : 'EVEN';
    const galleries = floor.rooms.filter(r => r.type === RoomType.Balcony);
    const primaryGalleries = galleries.filter(isPrimaryGallery);
    const upperFloor = resFloors[idx + 1];
    const upperPrimary = upperFloor ? upperFloor.rooms.filter(isPrimaryGallery) : [];

    const doubleHeightRoomIds: string[] = [];
    if (mode === 'DOUBLE_HEIGHT_STAGGER') {
      for (const gal of primaryGalleries) {
        const coveredDirectlyAbove = upperPrimary.some(
          up => polygonIntersectionArea(gal.boundary, up.boundary) > Math.max(100_000, gal.area * 0.35),
        );
        if (!coveredDirectlyAbove) {
          doubleHeightRoomIds.push(gal.id);
        }
      }
    }

    return {
      floorId: floor.id,
      level: floor.level,
      variant,
      mode,
      galleryRoomIds: galleries.map(g => g.id),
      doubleHeightRoomIds,
    };
  });
}

/**
 * Coordinates a multi-storey canonical Building across all residential floors:
 * 1. Locks structural RCC columns, lifts, stairs, OTS ducts, and service shafts.
 * 2. Enforces unified 2,100 mm lintel datum, room-type sill heights, and vertical window bay alignment.
 * 3. Merges adjacent exterior windows (<= 1,500 mm gap) into continuous 600 mm chajja bands.
 * 4. Emits OTS/utility louver screen geometry & double-height vs stacked gallery bay metadata.
 */
export function coordinateBuildingFacade(
  building: Building,
  options?: FacadeCoordinationOptions,
): Building {
  const galleryCoordinationMode: GalleryCoordinationMode =
    options?.galleryCoordinationMode ??
    building.metadata.generationBrief?.galleryCoordinationMode ??
    (building.metadata.generationBrief?.staggeredBalconies === true
      ? 'DOUBLE_HEIGHT_STAGGER'
      : 'STACKED_RIBBON');

  const { floors: lockedFloors, coreAlignmentDriftMaxMm } = lockResidentialColumnsToReference(
    building.floors,
  );
  const { floors: coordinatedFloors, verticalJambDriftMaxMm } =
    coordinateVerticalWindowDatum(lockedFloors);

  const includeChajjas =
    options?.includeWindowChajjas ??
    building.metadata.generationBrief?.includeWindowChajjas ??
    true;
  const chajjaBands = includeChajjas
    ? synthesizeCoordinatedChajjaBands(coordinatedFloors)
    : [];
  const otsLouverScreens = synthesizeOtsLouverScreens(coordinatedFloors);
  const galleryBays = synthesizeGalleryBays(coordinatedFloors, galleryCoordinationMode);
  const flatExposures =
    options?.flatExposures ?? building.metadata.facadeCoordination?.flatExposures ?? [];

  const facadeCoordination: FacadeCoordinationMetadata = {
    galleryCoordinationMode,
    lintelDatumMm: FACADE_LINTEL_DATUM_MM,
    verticalJambDriftMaxMm,
    coreAlignmentDriftMaxMm,
    chajjaBands,
    otsLouverScreens,
    galleryBays,
    flatExposures,
  };

  return {
    ...building,
    floors: coordinatedFloors,
    metadata: {
      ...building.metadata,
      facadeCoordination,
      ...(building.metadata.generationBrief
        ? {
            generationBrief: {
              ...building.metadata.generationBrief,
              galleryCoordinationMode,
              staggeredBalconies: galleryCoordinationMode === 'DOUBLE_HEIGHT_STAGGER',
            },
          }
        : {}),
    },
  };
}

export class FacadeCoordinationEngine {
  static coordinate(building: Building, options?: FacadeCoordinationOptions): Building {
    return coordinateBuildingFacade(building, options);
  }

  static synthesizeChajjaBands(floors: readonly Floor[]): CoordinatedChajjaBand[] {
    return synthesizeCoordinatedChajjaBands(floors);
  }

  static synthesizeLouverScreens(floors: readonly Floor[]): OtsLouverScreen[] {
    return synthesizeOtsLouverScreens(floors);
  }
}

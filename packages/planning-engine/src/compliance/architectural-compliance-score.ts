import {
  RoomType,
  isPhysicalBoundary,
  type Building,
  type Floor,
  type MultiSheetApartmentConfig,
  type Room,
} from '@ai-floor-planner/core';
import { polygonIntersectionArea } from '@ai-floor-planner/geometry-engine';
import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';

export interface ComplianceViolationItem {
  readonly category:
    | 'RED_CONFLICT'
    | 'BEDROOM_PROPORTION'
    | 'CIRCULATION_HIERARCHY'
    | 'BALCONY_PARTITION'
    | 'ENVELOPE_UTILIZATION'
    | 'GROUND_AND_STAIR_COMPLETENESS';
  readonly penalty: number;
  readonly hardReject: boolean;
  readonly roomId?: string;
  readonly unitId?: string;
  readonly message: string;
}

export interface ArchitecturalComplianceReport {
  readonly score: number;
  readonly passed: boolean;
  readonly redConflictCount: number;
  readonly hardRejected: boolean;
  readonly attemptCount?: number;
  readonly violations: readonly ComplianceViolationItem[];
  readonly categoryBreakdown: {
    readonly redConflicts: number;
    readonly bedroomProportions: number;
    readonly circulationHierarchy: number;
    readonly balconyPartitioning: number;
    readonly envelopeUtilization: number;
    readonly groundAndStairCompleteness: number;
  };
}

export interface EvaluateComplianceOptions {
  readonly config?: MultiSheetApartmentConfig;
  readonly permissibleEnvelopeMm?: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
  readonly requireFullEnvelopeUtilization?: boolean;
  readonly attemptCount?: number;
}

function sharesOrthogonalEdge(a: Room, b: Room, minOverlapMm = 100): boolean {
  const ax1 = a.x;
  const ay1 = a.y;
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx1 = b.x;
  const by1 = b.y;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;

  const touchesVertical = Math.abs(ax2 - bx1) <= 5 || Math.abs(bx2 - ax1) <= 5;
  if (touchesVertical) {
    const overlapY = Math.min(ay2, by2) - Math.max(ay1, by1);
    if (overlapY >= minOverlapMm) return true;
  }
  const touchesHorizontal = Math.abs(ay2 - by1) <= 5 || Math.abs(by2 - ay1) <= 5;
  if (touchesHorizontal) {
    const overlapX = Math.min(ax2, bx2) - Math.max(ax1, bx1);
    if (overlapX >= minOverlapMm) return true;
  }
  return false;
}

/**
 * Evaluates a generated Building on a 0..100 scale against all 6 Phase 2
 * architectural & code compliance categories.
 *
 * Every plan displayed to the user must achieve `score >= 85` with
 * `redConflictCount === 0` and `hardRejected === false`.
 */
export function evaluateArchitecturalComplianceScore(
  building: Building,
  options?: EvaluateComplianceOptions,
): ArchitecturalComplianceReport {
  const violations: ComplianceViolationItem[] = [];
  let redConflictCount = 0;
  let hardRejected = false;

  const typicalFloor: Floor | undefined =
    building.floors.find(f => f.floorUse === 'RESIDENTIAL' && (f.apartmentUnits?.length ?? 0) > 0) ??
    building.floors.find(f => (f.apartmentUnits?.length ?? 0) > 0) ??
    building.floors[1] ??
    building.floors[0];

  const groundFloor: Floor | undefined = building.floors[0];

  if (!typicalFloor) {
    return {
      score: 0,
      passed: false,
      redConflictCount: 1,
      hardRejected: true,
      attemptCount: options?.attemptCount,
      violations: [
        {
          category: 'RED_CONFLICT',
          penalty: 100,
          hardReject: true,
          message: 'Building has no residential floor to evaluate.',
        },
      ],
      categoryBreakdown: {
        redConflicts: 100,
        bedroomProportions: 0,
        circulationHierarchy: 0,
        balconyPartitioning: 0,
        envelopeUtilization: 0,
        groundAndStairCompleteness: 0,
      },
    };
  }

  // ─── 1. Zero Red Violations (-25 pts per red conflict) ────────────────────
  const closure = validateApartmentClosure({ ...building, floors: [typicalFloor] });
  const closureErrors = closure.issues.filter(i => i.severity === 'error');
  for (const err of closureErrors) {
    redConflictCount++;
    violations.push({
      category: 'RED_CONFLICT',
      penalty: 25,
      hardReject: true,
      message: `${err.code}: ${err.message}`,
    });
  }

  // Check pairwise room overlaps on typical floor if not already caught
  if (closureErrors.every(e => e.code !== 'ROOM_OVERLAP')) {
    for (let i = 0; i < typicalFloor.rooms.length; i++) {
      for (let j = i + 1; j < typicalFloor.rooms.length; j++) {
        const rA = typicalFloor.rooms[i]!;
        const rB = typicalFloor.rooms[j]!;
        if (polygonIntersectionArea(rA.boundary, rB.boundary) > 1) {
          redConflictCount++;
          violations.push({
            category: 'RED_CONFLICT',
            penalty: 25,
            hardReject: true,
            roomId: rA.id,
            message: `Room overlap between ${rA.name} and ${rB.name}.`,
          });
        }
      }
    }
  }

  // Unventilated wet core check
  const shaftRooms = typicalFloor.rooms.filter(
    r => r.type === RoomType.ServiceShaft || r.type === RoomType.OTS || r.spaceUse === 'VOID' || r.openToSky,
  );
  const fPts = typicalFloor.boundary.points;
  const fMinX = Math.min(...fPts.map(p => p.x));
  const fMaxX = Math.max(...fPts.map(p => p.x));
  const fMinY = Math.min(...fPts.map(p => p.y));
  const fMaxY = Math.max(...fPts.map(p => p.y));

  for (const bath of typicalFloor.rooms.filter(r => r.type === RoomType.Bathroom && r.unitId)) {
    const onExterior =
      Math.abs(bath.x - fMinX) <= 5 ||
      Math.abs(bath.x + bath.width - fMaxX) <= 5 ||
      Math.abs(bath.y - fMinY) <= 5 ||
      Math.abs(bath.y + bath.height - fMaxY) <= 5;
    const touchesShaft = shaftRooms.some(s => sharesOrthogonalEdge(bath, s, 500));
    const hasWindow = typicalFloor.windows.some(w => w.roomId === bath.id);
    if (!onExterior && !touchesShaft && !hasWindow) {
      redConflictCount++;
      violations.push({
        category: 'RED_CONFLICT',
        penalty: 25,
        hardReject: true,
        roomId: bath.id,
        unitId: bath.unitId,
        message: `Unventilated wet core: ${bath.name} has neither exterior wall nor ventilation shaft.`,
      });
    }
  }

  // ─── 2. Habitable Bedroom Proportions (-20 pts per violation) ─────────────
  const bedrooms = typicalFloor.rooms.filter(
    r =>
      r.type === RoomType.Bedroom &&
      r.unitId &&
      !/PASSAGE|CORRIDOR|BALCONY|TOILET|BATH/i.test(r.name),
  );
  for (const bed of bedrooms) {
    const shortDim = Math.min(bed.width, bed.height);
    const longDim = Math.max(bed.width, bed.height);
    const aspectRatio = shortDim > 0 ? longDim / shortDim : 99;

    if (shortDim < 2850 || aspectRatio > 2.4) {
      hardRejected = true;
      redConflictCount++;
      violations.push({
        category: 'BEDROOM_PROPORTION',
        penalty: 20,
        hardReject: true,
        roomId: bed.id,
        unitId: bed.unitId,
        message: `${bed.name} (${bed.width}x${bed.height} mm, ratio ${aspectRatio.toFixed(2)}:1) violates hard bedroom limits (min width >= 2,850 mm, max aspect ratio <= 2.4).`,
      });
    } else if (shortDim < 3000 || aspectRatio > 2.2) {
      violations.push({
        category: 'BEDROOM_PROPORTION',
        penalty: 20,
        hardReject: false,
        roomId: bed.id,
        unitId: bed.unitId,
        message: `${bed.name} (${bed.width}x${bed.height} mm, ratio ${aspectRatio.toFixed(2)}:1) is below target bedroom proportion (clear width >= 3,000 mm, aspect ratio <= 2.2).`,
      });
    }
  }

  // ─── 3. Private Circulation Hierarchy (-20 pts per violation) ─────────────
  for (const unit of typicalFloor.apartmentUnits ?? []) {
    const unitRooms = typicalFloor.rooms.filter(r => r.unitId === unit.id);
    const unitRoomMap = new Map(unitRooms.map(r => [r.id, r]));

    // Main entrance check
    const entranceDoors = typicalFloor.doors.filter(
      d =>
        d.connectsRooms.some(id => unitRoomMap.has(id)) &&
        d.connectsRooms.some(id => {
          const other = typicalFloor.rooms.find(r => r.id === id);
          return other && !other.unitId;
        }),
    );

    for (const entryDoor of entranceDoors) {
      const insideId = entryDoor.connectsRooms.find(id => unitRoomMap.has(id));
      const insideRoom = insideId ? unitRoomMap.get(insideId) : undefined;
      if (!insideRoom) continue;

      if (insideRoom.type === RoomType.Foyer) {
        const foyerAreaSqM = (insideRoom.width * insideRoom.height) / 1_000_000;
        if (foyerAreaSqM > 12.05) {
          violations.push({
            category: 'CIRCULATION_HIERARCHY',
            penalty: 20,
            hardReject: false,
            roomId: insideRoom.id,
            unitId: unit.id,
            message: `${insideRoom.name} (${foyerAreaSqM.toFixed(1)} sq m) exceeds maximum 12.0 sq m compact vestibule limit.`,
          });
        }
        // Foyer must open internally ONLY to Living or Dining, never directly to a Bedroom or Bedroom Passage
        const internalFoyerDoors = typicalFloor.doors.filter(
          d =>
            d.id !== entryDoor.id &&
            d.connectsRooms.includes(insideRoom.id) &&
            d.connectsRooms.some(id => id !== insideRoom.id && unitRoomMap.has(id)),
        );
        for (const fd of internalFoyerDoors) {
          const targetId = fd.connectsRooms.find(id => id !== insideRoom.id);
          const targetRoom = targetId ? unitRoomMap.get(targetId) : undefined;
          if (targetRoom && targetRoom.type !== RoomType.Living && targetRoom.type !== RoomType.Dining) {
            violations.push({
              category: 'CIRCULATION_HIERARCHY',
              penalty: 20,
              hardReject: true,
              roomId: targetRoom.id,
              unitId: unit.id,
              message: `${targetRoom.name} connects directly to ${insideRoom.name}; private rooms/passages must branch from Living/Dining.`,
            });
            hardRejected = true;
          }
        }
      } else if (insideRoom.type !== RoomType.Living && insideRoom.type !== RoomType.Dining) {
        violations.push({
          category: 'CIRCULATION_HIERARCHY',
          penalty: 20,
          hardReject: true,
          roomId: insideRoom.id,
          unitId: unit.id,
          message: `Main entrance of ${unit.name} opens into ${insideRoom.name} (${insideRoom.type}) instead of Living/Dining or Foyer.`,
        });
        hardRejected = true;
      }
    }

    // Ensure no bedroom or internal passage connects only through Kitchen
    for (const priv of unitRooms.filter(r => r.type === RoomType.Bedroom || r.type === RoomType.Corridor)) {
      const connectedRooms = typicalFloor.doors
        .filter(d => d.connectsRooms.includes(priv.id))
        .map(d => d.connectsRooms.find(id => id !== priv.id))
        .map(id => (id ? unitRoomMap.get(id) : undefined))
        .filter((r): r is Room => Boolean(r));
      const connectsToPublicOrPassage = connectedRooms.some(
        r =>
          r.type === RoomType.Living ||
          r.type === RoomType.Dining ||
          r.type === RoomType.Corridor ||
          r.type === RoomType.Bedroom,
      );
      if (!connectsToPublicOrPassage) {
        violations.push({
          category: 'CIRCULATION_HIERARCHY',
          penalty: 20,
          hardReject: true,
          roomId: priv.id,
          unitId: unit.id,
          message: `${priv.name} has no valid internal circulation connection from Living/Dining or Internal Passage.`,
        });
        hardRejected = true;
      }
    }
  }

  // Ban bedroom furniture inside corridors/passages
  for (const passage of typicalFloor.rooms.filter(
    r => r.type === RoomType.Corridor || /PASSAGE|CORRIDOR/i.test(r.name),
  )) {
    const badFurn = (typicalFloor.furniture ?? []).filter(f => f.roomId === passage.id);
    if (badFurn.length > 0) {
      violations.push({
        category: 'CIRCULATION_HIERARCHY',
        penalty: 20,
        hardReject: true,
        roomId: passage.id,
        unitId: passage.unitId,
        message: `${passage.name} contains ${badFurn.length} furniture item(s); circulation passages must remain unobstructed.`,
      });
      hardRejected = true;
    }
  }

  // ─── 4. Balcony Privacy Partitioning (-15 pts per violation) ──────────────
  const unitBalconies = typicalFloor.rooms.filter(
    r => (r.type === RoomType.Balcony || r.type === RoomType.Utility) && r.unitId,
  );
  for (let i = 0; i < unitBalconies.length; i++) {
    for (let j = i + 1; j < unitBalconies.length; j++) {
      const b1 = unitBalconies[i]!;
      const b2 = unitBalconies[j]!;
      if (b1.unitId === b2.unitId) continue;
      if (sharesOrthogonalEdge(b1, b2, 100)) {
        const partyWall = typicalFloor.walls.find(
          w =>
            w.roomIds.includes(b1.id) &&
            w.roomIds.includes(b2.id) &&
            isPhysicalBoundary(w) &&
            w.boundaryRole === 'FULL_HEIGHT_WALL' &&
            w.thickness >= 200,
        );
        if (!partyWall) {
          violations.push({
            category: 'BALCONY_PARTITION',
            penalty: 15,
            hardReject: true,
            roomId: b1.id,
            unitId: b1.unitId,
            message: `Adjacent balconies ${b1.name} and ${b2.name} lack a full-height >= 200 mm inter-flat party wall.`,
          });
          hardRejected = true;
        }
      }
    }
  }

  // ─── 5. Envelope Utilization & Setback Accuracy (-15 pts per violation) ───
  const promptText = options?.config?.aiPrompt ?? '';
  const explicitShapeRequested = /\b(h[- ]?shape|u[- ]?shape|l[- ]?shape|courtyard|cruciform|pinwheel|stepped)\b/i.test(promptText);
  const fullUtilRequested =
    options?.requireFullEnvelopeUtilization ??
    (/\b(utili[sz]e\s+(the\s+)?(full|entire|maximum)\s+(plot|floor|setback|envelope)|proper\s+space\s+utili[sz]ation)\b/i.test(
      promptText,
    ) &&
      !explicitShapeRequested);

  if (fullUtilRequested && options?.permissibleEnvelopeMm) {
    const permArea = options.permissibleEnvelopeMm.w * options.permissibleEnvelopeMm.h;
    if (permArea > 0) {
      const builtRoomsArea = typicalFloor.rooms
        .filter(r => !(r.tags?.includes('recess:perimeter') && r.openToSky))
        .reduce((sum, r) => sum + r.width * r.height, 0);
      const utilization = builtRoomsArea / permArea;
      if (utilization < 0.82) {
        violations.push({
          category: 'ENVELOPE_UTILIZATION',
          penalty: 15,
          hardReject: false,
          message: `Built footprint utilizes ${(utilization * 100).toFixed(1)}% of permissible setback envelope (< 82.0% target).`,
        });
      }
    }
  }

  // ─── 6. Ground/Entrance Enclosure & Stair/Lift Completeness (-15 pts) ─────
  if (groundFloor) {
    const groundLobbies = groundFloor.rooms.filter(
      r =>
        r.id === 'stilt__grand_lobby' ||
        r.type === RoomType.Foyer ||
        r.tags?.includes('core:lobby'),
    );
    for (const lobby of groundLobbies) {
      const openExtWall = groundFloor.walls.find(
        w => w.roomIds.length === 1 && w.roomIds.includes(lobby.id) && w.boundaryRole === 'OPEN_BOUNDARY',
      );
      if (openExtWall) {
        violations.push({
          category: 'GROUND_AND_STAIR_COMPLETENESS',
          penalty: 15,
          hardReject: false,
          roomId: lobby.id,
          message: `Ground/entrance lobby (${lobby.name}) has an unenclosed exterior wall (${openExtWall.id}).`,
        });
      }
    }
  }

  const stairRooms = typicalFloor.rooms.filter(r => r.type === RoomType.Staircase);
  if (stairRooms.length === 0) {
    violations.push({
      category: 'GROUND_AND_STAIR_COMPLETENESS',
      penalty: 15,
      hardReject: true,
      message: 'Typical residential floor has no staircase core.',
    });
    hardRejected = true;
  } else {
    for (const stairRoom of stairRooms) {
      const hasCanonicalStair = (typicalFloor.canonicalStaircases ?? []).some(
        s => s.roomId === stairRoom.id || polygonIntersectionArea(s.polygon, stairRoom.boundary) > 100_000,
      );
      const hasFloorStair = (typicalFloor.stairs ?? []).length >= stairRooms.length;
      if (!hasCanonicalStair && !hasFloorStair) {
        violations.push({
          category: 'GROUND_AND_STAIR_COMPLETENESS',
          penalty: 15,
          hardReject: false,
          roomId: stairRoom.id,
          message: `Staircase ${stairRoom.name} is missing canonical tread/flight geometry.`,
        });
      }
    }
  }

  const sumPenalty = (cat: ComplianceViolationItem['category']) =>
    violations.filter(v => v.category === cat).reduce((s, v) => s + v.penalty, 0);

  const categoryBreakdown = {
    redConflicts: sumPenalty('RED_CONFLICT'),
    bedroomProportions: sumPenalty('BEDROOM_PROPORTION'),
    circulationHierarchy: sumPenalty('CIRCULATION_HIERARCHY'),
    balconyPartitioning: sumPenalty('BALCONY_PARTITION'),
    envelopeUtilization: sumPenalty('ENVELOPE_UTILIZATION'),
    groundAndStairCompleteness: sumPenalty('GROUND_AND_STAIR_COMPLETENESS'),
  };

  const totalPenalty = Object.values(categoryBreakdown).reduce((a, b) => a + b, 0);
  const rawScore = Math.max(0, 100 - totalPenalty);
  const score = hardRejected ? Math.min(rawScore, 79) : rawScore;
  const passed = score >= 85 && redConflictCount === 0 && !hardRejected;

  return {
    score,
    passed,
    redConflictCount,
    hardRejected,
    attemptCount: options?.attemptCount,
    violations,
    categoryBreakdown,
  };
}

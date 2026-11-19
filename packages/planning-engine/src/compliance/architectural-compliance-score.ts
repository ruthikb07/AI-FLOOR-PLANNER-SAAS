import {
  DoorType,
  RoomType,
  WindowType,
  architecturalSpaceRole,
  isPhysicalBoundary,
  type Building,
  type Floor,
  type MultiSheetApartmentConfig,
  type Room,
} from '@ai-floor-planner/core';
import { architecturalSlabCutouts, containsPolygon, openingFitsApartmentWall, polygonBoundingBox, polygonIntersectionArea } from '@ai-floor-planner/geometry-engine';
import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { evaluateUDCPRCompliance } from '../validator/udcpr-engine';

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

export interface LayoutScoreFinding {
  readonly id: string;
  readonly elementIds: readonly string[];
  readonly actual: string;
  readonly required: string;
  readonly action: string;
}

export function evaluateStudioLayoutScore(building: Building, regulatory = evaluateUDCPRCompliance(building)) {
  const geometry: LayoutScoreFinding[] = [];
  const ventilation: LayoutScoreFinding[] = [];
  const clearance: LayoutScoreFinding[] = [];
  const massing: LayoutScoreFinding[] = [];
  for (const issue of validateApartmentClosure(building).issues) {
    if (issue.severity !== 'error') continue;
    if (/DOOR_WIDTH/.test(issue.code)) {
      clearance.push({ id: issue.code, elementIds: [], actual: issue.message, required: 'Applicable clear door width',
        action: 'Locate the referenced door, extend its host wall where needed, and verify the clear width and swing.' });
    } else if (/GEOMETRY|OPENING|OVERLAP|AREA_|BOUNDARY|OUTSIDE|INVALID/.test(issue.code)) {
      geometry.push({ id: issue.code, elementIds: [], actual: issue.message, required: 'Valid, conserved canonical geometry',
        action: 'Locate the referenced entities in CAD, correct their boundaries or openings, and rerun the geometry audit.' });
    }
  }
  for (const floor of building.floors) {
    const rooms = new Map(floor.rooms.map(room => [room.id, room]));
    const walls = new Map(floor.walls.map(wall => [wall.id, wall]));
    const validWindows = new Set<string>();
    for (const opening of [...floor.doors, ...floor.windows]) {
      const wall = walls.get(opening.wallId);
      if (!wall || !openingFitsApartmentWall(wall, opening.position, opening.width)) {
        geometry.push({ id: 'OPENING_INTERVAL', elementIds: [opening.id, opening.wallId], actual: `${opening.width} mm opening at (${opening.position.x}, ${opening.position.y})`,
          required: 'Valid host with 100 mm clear at both ends', action: 'Select the host wall and move or resize the opening. Verify its clearance and adjacent openings.' });
      } else if ('roomId' in opening && opening.type !== WindowType.Fixed && opening.type !== WindowType.Ventilator && wall.roomIds.includes(opening.roomId)) {
        validWindows.add(opening.roomId);
      }
    }
    const pairs = (owners: readonly string[]) => [...new Set(owners.map(id => rooms.get(id)?.unitId).filter((id): id is string => Boolean(id)))].sort();
    const served = new Set<string>();
    for (const room of floor.rooms) {
      if (architecturalSpaceRole(room) !== 'OPEN_TO_SKY_VOID') continue;
      const bounds = polygonBoundingBox(room.boundary);
      const width = Math.min(bounds.width, bounds.height), depth = Math.max(bounds.width, bounds.height);
      if (width < 1525 || width > 1830 || depth < 3000 || depth > 4500) continue;
      if (building.floors.some(upper => upper.level > floor.level &&
        polygonIntersectionArea(upper.boundary, room.boundary) > 0.001 &&
        !architecturalSlabCutouts(upper).some(cutout => containsPolygon(cutout, room.boundary)))) continue;
      const units = pairs(floor.walls.filter(wall => wall.roomIds.includes(room.id)).flatMap(wall => wall.roomIds));
      for (const [index, unit] of units.entries()) for (const other of units.slice(index + 1)) served.add(`${unit}|${other}`);
    }
    const flaggedPairs = new Set<string>();
    for (const wall of floor.walls) {
      const units = pairs(wall.roomIds);
      if (units.length !== 2) continue;
      const key = units.join('|');
      if (served.has(key) || flaggedPairs.has(key)) continue;
      flaggedPairs.add(key);
      ventilation.push({ id: 'INTER_FLAT_OTS', elementIds: [wall.id, ...wall.roomIds], actual: `${units.join(' / ')} has no qualifying shared duct`,
        required: '1525–1830 mm wide × 3000–4500 mm deep, continuous to open sky',
        action: 'Reserve the duct at the shared wall, carry it through the floor stack, and host operable windows on the rooms facing it.' });
    }
    for (const room of floor.rooms) {
      if (!room.unitId || ![RoomType.Living, RoomType.Dining, RoomType.Kitchen, RoomType.Bedroom].includes(room.type) || validWindows.has(room.id)) continue;
      ventilation.push({ id: 'HABITABLE_WINDOW', elementIds: [room.id], actual: '0 operable hosted windows', required: 'At least one operable window',
        action: 'Place the room against an exterior wall or qualifying OTS duct. Add a hosted operable window and recheck ventilation area.' });
    }
  }
  const clearanceRules = regulatory.rulesChecked.filter(rule => /^(setback\.|stairs\..*\.(?:missing|brief|width)$|doors?\.)/.test(rule.id));
  for (const rule of clearanceRules.filter(rule => rule.status === 'VIOLATION')) {
    const unit = rule.unit ? ` ${rule.unit}` : '';
    clearance.push({ id: rule.id, elementIds: rule.elementIds, actual: `${rule.actual ?? 'Unverified'}${unit}`,
      required: `${rule.required ?? 'Review applicability'}${unit}`, action: rule.remediation });
  }
  const brief = building.metadata.generationBrief;
  if (brief?.requestedMassingShape && brief.requestedMassingShape !== brief.buildingMassingShape) {
    massing.push({ id: 'MASSING_MISMATCH', elementIds: [], actual: brief.buildingMassingShape ?? 'Unverified', required: brief.requestedMassingShape,
      action: 'Review plot and unit-count constraints, then generate and inspect a candidate with the requested massing.' });
  }
  const criteria = [
    { label: 'Canonical geometry and openings', points: 25, findings: geometry, unresolved: !building.floors.length },
    { label: 'Inter-flat OTS and operable windows', points: 20, findings: ventilation, unresolved: false },
    { label: 'Setbacks, stairs and door clearance', points: 15, findings: clearance,
      unresolved: !clearanceRules.length || clearanceRules.some(rule => rule.status === 'NOT_VERIFIED') },
    { label: 'Requested massing', points: 15, findings: massing, unresolved: false },
  ].map(criterion => ({ ...criterion, earned: criterion.findings.length || criterion.unresolved ? 0 : criterion.points }));
  return { score: 25 + criteria.reduce((sum, criterion) => sum + criterion.earned, 0), criteria,
    passed: criteria.every(criterion => criterion.earned === criterion.points), basePoints: 25 };
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
      Math.abs(bath.y + bath.height - fMaxY) <= 5 ||
      typicalFloor.walls.some(w => w.roomIds.includes(bath.id) && w.wallUse === 'EXTERNAL');
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

  // Habitable Room Daylight & Cross-Ventilation Check (-30 pts per unventilated Living/Dining/Kitchen/Bedroom)
  const habitableVentRooms = typicalFloor.rooms.filter(
    r =>
      r.unitId &&
      (r.type === RoomType.Living ||
        r.type === RoomType.Dining ||
        r.type === RoomType.Kitchen ||
        r.type === RoomType.Bedroom) &&
      !/PASSAGE|CORRIDOR|BALCONY|FOYER|LOBBY/i.test(r.name),
  );
  for (const hRoom of habitableVentRooms) {
    const onExterior =
      Math.abs(hRoom.x - fMinX) <= 5 ||
      Math.abs(hRoom.x + hRoom.width - fMaxX) <= 5 ||
      Math.abs(hRoom.y - fMinY) <= 5 ||
      Math.abs(hRoom.y + hRoom.height - fMaxY) <= 5 ||
      typicalFloor.walls.some(w => w.roomIds.includes(hRoom.id) && w.wallUse === 'EXTERNAL');
    const touchesOts = shaftRooms.some(s => sharesOrthogonalEdge(hRoom, s, 500));
    const hasWindow = typicalFloor.windows.some(w => w.roomId === hRoom.id);
    // Open-plan Living connected directly (>= 1000 mm OpenPassage arch) to a ventilated Dining half
    // in the same unit forms one continuous naturally lit Living-Dining hall (NBC / RERA open plan).
    const openPlanDiningDaylight =
      hRoom.type === RoomType.Living &&
      typicalFloor.doors.some(d => {
        if (d.type !== DoorType.OpenPassage || d.width < 1000 || !d.connectsRooms.includes(hRoom.id)) {
          return false;
        }
        const partnerId = d.connectsRooms.find(id => id !== hRoom.id);
        const partner = partnerId ? typicalFloor.rooms.find(rm => rm.id === partnerId) : undefined;
        if (!partner || partner.unitId !== hRoom.unitId || partner.type !== RoomType.Dining) {
          return false;
        }
        const partnerOnExterior =
          Math.abs(partner.x - fMinX) <= 5 ||
          Math.abs(partner.x + partner.width - fMaxX) <= 5 ||
          Math.abs(partner.y - fMinY) <= 5 ||
          Math.abs(partner.y + partner.height - fMaxY) <= 5;
        const partnerHasWin = typicalFloor.windows.some(w => w.roomId === partner.id);
        const partnerTouchesOts = shaftRooms.some(s => sharesOrthogonalEdge(partner, s, 500));
        return partnerHasWin || partnerOnExterior || partnerTouchesOts;
      });
    if (!onExterior && !touchesOts && !hasWindow && !openPlanDiningDaylight) {
      redConflictCount++;
      violations.push({
        category: 'RED_CONFLICT',
        penalty: 30,
        hardReject: true,
        roomId: hRoom.id,
        unitId: hRoom.unitId,
        message: `Unventilated habitable room: ${hRoom.name} has 0 exterior or OTS-duct windows.`,
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
    const isNonOrtho = bed.boundary.points.length > 4;
    const rawShort = Math.min(bed.width, bed.height);
    const longDim = Math.max(bed.width, bed.height);
    const shortDim = isNonOrtho && longDim > 0 ? Math.max(rawShort, bed.area / longDim) : rawShort;
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
          message: `Main entrance of ${unit.id} opens into ${insideRoom.name} (${insideRoom.type}) instead of Living/Dining or Foyer.`,
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
  const configMassing = options?.config?.buildingMassingShape;
  const explicitShapeRequested =
    (configMassing !== undefined && configMassing !== 'COMPACT_DOUBLE_LOADED') ||
    /\b(h[- ]?shape|u[- ]?shape|l[- ]?shape|t[- ]?shape|o[- ]?shape|y[- ]?shape|courtyard|cruciform|pinwheel|stepped|crescent|serpentine|rotunda|elliptical|lotus|bowfront|triangular|triskele|butterfly|hexagonal|trapezoid|zigzag)\b/i.test(promptText);
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
        (r.id.endsWith('stilt__grand_lobby') ||
          r.tags?.includes('core:lobby') ||
          (r.type === RoomType.Foyer &&
            !/open\s*parking|remainder/i.test(r.name) &&
            !r.id.includes('open_remainder'))) &&
        r.architecturalRole !== 'VEHICLE_AISLE' &&
        r.architecturalRole !== 'PARKING_BAY' &&
        r.architecturalRole !== 'PARKING_AREA',
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
        s => polygonIntersectionArea(s.polygon, stairRoom.boundary) > 100_000,
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

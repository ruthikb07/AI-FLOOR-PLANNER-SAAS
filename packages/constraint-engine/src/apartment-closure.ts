import type { Building, Room, DynamicApartmentManifest, ApartmentBhkType } from '@ai-floor-planner/core';
import { containsPolygon, polygonIntersectionArea, measureApartmentAreaLedger, openingFitsApartmentWall } from '@ai-floor-planner/geometry-engine';

function sharesBoundarySegment(
  polyA: { points: readonly { x: number; y: number }[] },
  polyB: { points: readonly { x: number; y: number }[] },
  minOverlap: number,
): boolean {
  const ptsA = polyA.points;
  const ptsB = polyB.points;
  for (let i = 0; i < ptsA.length; i++) {
    const a1 = ptsA[i]!;
    const a2 = ptsA[(i + 1) % ptsA.length]!;
    const isHorizA = Math.abs(a1.y - a2.y) <= 2;
    const isVertA = Math.abs(a1.x - a2.x) <= 2;
    if (!isHorizA && !isVertA) continue;

    for (let j = 0; j < ptsB.length; j++) {
      const b1 = ptsB[j]!;
      const b2 = ptsB[(j + 1) % ptsB.length]!;

      if (isHorizA && Math.abs(b1.y - b2.y) <= 2 && Math.abs(a1.y - b1.y) <= 5) {
        const overlap = Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x)) - Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x));
        if (overlap >= minOverlap - 2) return true;
      } else if (isVertA && Math.abs(b1.x - b2.x) <= 2 && Math.abs(a1.x - b1.x) <= 5) {
        const overlap = Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y)) - Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y));
        if (overlap >= minOverlap - 2) return true;
      }
    }
  }
  return false;
}

/** Always recalculate from canonical state. No cached PASS survives an edit. */
export function validateApartmentClosure(building: Building, manifest?: DynamicApartmentManifest) {
  const dynamicManifest = manifest ?? (building as unknown as { dynamicManifest?: DynamicApartmentManifest }).dynamicManifest ?? (building as unknown as { metadata?: { dynamicManifest?: DynamicApartmentManifest } }).metadata?.dynamicManifest;
  const issues: { code: string; severity: 'error' | 'warning'; message: string }[] = [];
  const add = (code: string, message: string, severity: 'error' | 'warning' = 'error') => issues.push({ code, severity, message });
  const ledgers = building.floors.map(floor => {
    const rooms = floor.rooms;
    const graph = new Map<string, Set<string>>(rooms.map(r => [r.id, new Set<string>()]));
    for (const r of rooms) {
      if (r.tags.some(t => t.startsWith('flat:')) && !r.unitId) add('ROOM_OWNERSHIP_MISSING', r.id);
      const unit = floor.apartmentUnits?.find(u => u.id === r.unitId);
      if (r.unitId) {
        if (!unit) {
          add('ROOM_OUTSIDE_UNIT', r.id);
        } else if (!containsPolygon(unit.boundary, r.boundary)) {
          // Cantilevered Balcony Containment Fix (§1.3)
          // Cantilevered balconies project outward from the exterior wall of a flat, or sit along the unit perimeter.
          // Valid if inside unit polygon OR shares continuous boundary segment >= 1200 mm or connecting door with parent unit's room
          const isBalcony = r.type === 'balcony' || r.type === 'utility' || r.spaceUse === 'OUTDOOR' || r.tags.some(t => t.includes('balcony') || t.includes('balc')) || r.name.toLowerCase().includes('balc');
          if (isBalcony) {
            const hasConnectingDoor = floor.doors.some(d =>
              d.connectsRooms.includes(r.id) &&
              d.connectsRooms.some(otherId => otherId !== r.id && rooms.some(other => other.id === otherId && other.unitId === r.unitId))
            );
            const sharesSegment = sharesBoundarySegment(r.boundary, unit.boundary, 1200) ||
              rooms.some(other => other.unitId === r.unitId && other.id !== r.id && sharesBoundarySegment(r.boundary, other.boundary, 1200));

            if (!hasConnectingDoor && !sharesSegment) {
              add('ROOM_OUTSIDE_UNIT', r.id);
            }
          } else {
            add('ROOM_OUTSIDE_UNIT', r.id);
          }
        }
      }
      if (floor.voidBoundaries?.some(p => polygonIntersectionArea(p, r.boundary) > 1)) add('ROOM_OVERLAPS_VOID', r.id);
      if (!containsPolygon(floor.boundary, r.boundary)) add('ROOM_OUTSIDE_FLOOR', r.id);
    }
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        if (polygonIntersectionArea(rooms[i]!.boundary, rooms[j]!.boundary) > 1) {
          add('ROOM_OVERLAP', `${rooms[i]!.id} / ${rooms[j]!.id}`);
        }
      }
    }
    const units = floor.apartmentUnits ?? [];
    const manifestUnits: readonly any[] = Array.isArray(dynamicManifest?.units)
      ? dynamicManifest.units
      : Array.isArray((dynamicManifest as any)?.units?.units)
      ? (dynamicManifest as any).units.units
      : [];
    const expectedFlats = typeof (dynamicManifest as any)?.flatsPerFloor === 'number'
      ? (dynamicManifest as any).flatsPerFloor
      : typeof (dynamicManifest as any)?.units?.exactCount === 'number'
      ? (dynamicManifest as any).units.exactCount
      : undefined;

    if (expectedFlats !== undefined && units.length !== expectedFlats) {
      add('UNIT_COUNT_MISMATCH', `expected ${expectedFlats} units, found ${units.length}`);
    }
    for (let i = 0; i < units.length; i++) {
      const u = units[i]!;
      if (!containsPolygon(floor.boundary, u.boundary)) add('UNIT_OUTSIDE_FLOOR', u.id);
      for (let j = i + 1; j < units.length; j++) {
        if (polygonIntersectionArea(u.boundary, units[j]!.boundary) > 1) {
          add('UNIT_OVERLAP', `${u.id}/${units[j]!.id}`);
        }
      }
      for (const r of rooms.filter(r => !r.unitId)) {
        if (polygonIntersectionArea(u.boundary, r.boundary) > 1) {
          add('UNIT_CORE_CONFLICT', `${u.id}/${r.id}`);
        }
      }
    }
    for (const wall of floor.walls) {
      if (wall.roomIds.length > 2 || wall.thickness <= 0 || !wall.wallUse) add('WALL_TOPOLOGY_INVALID', wall.id);
      const isPartyWall = (wall.unitIds && wall.unitIds.length > 1) || wall.wallUse === 'UNIT_SEPARATION';
      if (isPartyWall && wall.thickness < 230) {
        add('PARTY_WALL_THICKNESS_INSUFFICIENT', `${wall.id}: ${wall.thickness} mm (minimum 230 mm party wall required)`);
      }
      for (const id of wall.roomIds) {
        const room = rooms.find(r => r.id === id);
        const pts = room?.boundary.points ?? [];
        const onEdge = (p: { x: number; y: number }) => pts.some((a, i) => {
          const b = pts[(i + 1) % pts.length]!;
          const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
          return L > 0 && Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / L <= 1 && p.x >= Math.min(a.x, b.x) - 1 && p.x <= Math.max(a.x, b.x) + 1 && p.y >= Math.min(a.y, b.y) - 1 && p.y <= Math.max(a.y, b.y) + 1;
        });
        if (!onEdge(wall.startPoint) || !onEdge(wall.endPoint)) add('WALL_ROOM_BOUNDARY_MISMATCH', `${wall.id}/${id}`);
      }
    }
    const validDoors = new Set<string>();
    for (const door of floor.doors) {
      const host = floor.walls.find(w => w.id === door.wallId);
      const a = rooms.find(r => r.id === door.connectsRooms[0]), b = rooms.find(r => r.id === door.connectsRooms[1]);
      if (!host || !openingFitsApartmentWall(host, door.position, door.width) || !a || !b || !host.roomIds.includes(a.id) || !host.roomIds.includes(b.id)) {
        add('OPENING_HOST_INVALID', door.id);
        continue;
      }
      validDoors.add(door.id);
      graph.get(a.id)!.add(b.id);
      graph.get(b.id)!.add(a.id);
      if (a.unitId && b.unitId && a.unitId !== b.unitId) add('UNIT_ACCESS_CROSSES_OWNERSHIP', door.id);
      const inside = a.unitId ? a : b.unitId ? b : null;
      if (inside && a.unitId !== b.unitId && !['foyer', 'living'].includes(inside.type)) add('PRIMARY_ENTRANCE_PRIVATE_ROOM', door.id);

      // Entrance door dimensions (>= 1000 mm, target 1050 mm)
      const isEntrance = (a.spaceUse === 'COMMON' || a.spaceUse === 'CORE' || !a.unitId) && b.unitId ||
                         (b.spaceUse === 'COMMON' || b.spaceUse === 'CORE' || !b.unitId) && a.unitId;
      if (isEntrance && door.width < 1000) {
        add('PRIMARY_ENTRANCE_DOOR_WIDTH_SUBSTANDARD', `${door.id}: width ${door.width} mm < 1000 mm`);
      }

      // Bedroom entrance door dimensions (statutory minimum 800 mm, target 900 mm)
      const isBedroomEntrance = (a.type === 'bedroom' && (b.type === 'living' || b.type === 'dining' || b.type === 'corridor' || b.type === 'foyer')) ||
                                (b.type === 'bedroom' && (a.type === 'living' || a.type === 'dining' || a.type === 'corridor' || a.type === 'foyer'));
      if (a.unitId && a.unitId === b.unitId && isBedroomEntrance) {
        if (door.width < 800) {
          add('BEDROOM_DOOR_WIDTH_SUBSTANDARD', `${door.id}: width ${door.width} mm < 800 mm`);
        } else if (door.width < 900) {
          add('BEDROOM_DOOR_WIDTH_BELOW_TARGET', `${door.id}: width ${door.width} mm < 900 mm target`, 'warning');
        }
      }

      // Service door dimensions (statutory minimum 700 mm, target 750 mm)
      if (a.unitId && a.unitId === b.unitId && (a.type === 'bathroom' || b.type === 'bathroom' || a.type === 'utility' || b.type === 'utility')) {
        if (door.width < 700) {
          add('SERVICE_DOOR_WIDTH_SUBSTANDARD', `${door.id}: width ${door.width} mm < 700 mm`);
        } else if (door.width < 750) {
          add('SERVICE_DOOR_WIDTH_BELOW_TARGET', `${door.id}: width ${door.width} mm < 750 mm target`, 'warning');
        }
      }

      // A bedroom door to a real attached balcony is valid; opening-host
      // checks above establish the shared physical wall. Never infer outdoors
      // from a label or prohibit a legitimate bedroom balcony globally.

    }
    for (const window of floor.windows) {
      const host = floor.walls.find(w => w.id === window.wallId);
      if (!host || !openingFitsApartmentWall(host, window.position, window.width) || !host.roomIds.includes(window.roomId) || (host.wallUse !== 'EXTERNAL' && host.wallUse !== 'SHAFT')) add('WINDOW_HOST_INVALID', window.id);
    }
    const openings = [...floor.doors, ...floor.windows];
    for (let i = 0; i < openings.length; i++) {
      for (let j = i + 1; j < openings.length; j++) {
        const a = openings[i]!, b = openings[j]!;
        if (a.wallId === b.wallId && Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) < (a.width + b.width) / 2 - 1) {
          add('OPENING_OVERLAP', `${a.id}/${b.id}`);
        }
      }
    }
    const walk = (starts: string[], accept: (r: Room) => boolean) => {
      const visited = new Set(starts);
      const queue = [...starts];
      for (let i = 0; i < queue.length; i++) {
        for (const id of graph.get(queue[i]!) ?? []) {
          const r = rooms.find(r => r.id === id);
          if (r && accept(r) && !visited.has(id)) {
            visited.add(id);
            queue.push(id);
          }
        }
      }
      return visited;
    };
    const commonRooms = rooms.filter(r => r.spaceUse === 'COMMON');
    const commonReach = walk(commonRooms.slice(0, 1).map(r => r.id), r => r.spaceUse === 'COMMON' || r.spaceUse === 'CORE');
    for (const r of rooms.filter(r => r.spaceUse === 'COMMON' || r.spaceUse === 'CORE')) {
      if (!commonReach.has(r.id)) add('COMMON_CORE_ACCESS_DISCONNECTED', r.id);
    }
    for (let uIdx = 0; uIdx < units.length; uIdx++) {
      const u = units[uIdx]!;
      const unitRooms = rooms.filter(r => r.unitId === u.id);
      const entrances = floor.doors.filter(d => validDoors.has(d.id) && d.connectsRooms.some(id => unitRooms.some(r => r.id === id)) && d.connectsRooms.some(id => rooms.some(r => r.id === id && r.spaceUse === 'COMMON')));
      if (entrances.length !== 1) add('PRIMARY_ENTRANCE_MISSING', `${u.id}: ${entrances.length} entrances`);
      const entryIds = entrances.flatMap(d => d.connectsRooms.filter(id => unitRooms.some(r => r.id === id)));
      const reached = walk(entryIds, r => r.unitId === u.id);
      for (const r of unitRooms) if (!reached.has(r.id)) add('ROOM_ACCESS_DISCONNECTED', r.id);
      if (!entrances.some(d => d.connectsRooms.some(id => commonReach.has(id)))) add('UNIT_ACCESS_DISCONNECTED', u.id);

      // Manifest room completeness (§1A)
      const unitSpec = manifestUnits.find((item: any) =>
        (item.unitIndex !== undefined && item.unitIndex === (u as { unitIndex?: number }).unitIndex) ||
        (item.unitIndex !== undefined && item.unitIndex === uIdx + 1) ||
        (item.id && (u.id === item.id || u.id.endsWith(String(item.id)) || String(item.id).endsWith(u.id))) ||
        (item.unitIndex !== undefined && u.id.endsWith(String(item.unitIndex)))
      );
      const bedRoomsList = unitRooms.filter(r => r.type === 'bedroom' || r.tags.includes('role:bedroom'));
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

      const livingCount = unitRooms.filter(r => r.type === 'living' || r.tags.includes('role:living')).length;
      if (livingCount === 0) add('UNIT_ROOM_MANIFEST_INCOMPLETE', `${u.id}: missing living room for ${bhkType}`);

      const kitchenCount = unitRooms.filter(r => r.type === 'kitchen' || r.tags.includes('role:kitchen')).length;
      if (kitchenCount === 0) add('UNIT_ROOM_MANIFEST_INCOMPLETE', `${u.id}: missing kitchen for ${bhkType}`);

      const bedCount = bedRoomsList.length;
      if (bedCount !== expectedBeds) {
        add('UNIT_ROOM_MANIFEST_INCOMPLETE', `${u.id}: expected exactly ${expectedBeds} bedrooms for ${bhkType}, found ${bedCount}`);
      }

      const bathCount = unitRooms.filter(r => r.type === 'bathroom' || r.tags.includes('role:bathroom')).length;
      if (bathCount < expectedBaths) {
        add('UNIT_ROOM_MANIFEST_INCOMPLETE', `${u.id}: expected at least ${expectedBaths} bathrooms for ${bhkType}, found ${bathCount}`);
      }

      if (unitSpec?.hasUtilityBalcony || (typeof unitSpec?.utilities === 'number' && unitSpec.utilities > 0)) {
        const hasUtil = unitRooms.some(r => r.type === 'utility' || r.type === 'balcony' || r.tags.some(t => t.includes('utility') || t.includes('balcony')));
        if (!hasUtil) add('UNIT_ROOM_MANIFEST_INCOMPLETE', `${u.id}: missing utility balcony for ${bhkType}`);
      }
    }
    for (const r of rooms) {
      if (r.bathroomAccessClass === 'UNKNOWN') add('BATHROOM_OWNERSHIP_UNKNOWN', r.id, 'warning');
      if (r.bathroomOwnerRoomId) {
        const owner = rooms.find(o => o.id === r.bathroomOwnerRoomId);
        if (!owner || owner.unitId !== r.unitId || owner.type !== 'bedroom' || !graph.get(r.id)?.has(owner.id)) add('BATHROOM_OWNER_ACCESS_MISSING', r.id);
        if ([...graph.get(r.id) ?? []].some(id => id !== owner?.id)) add('ATTACHED_BATHROOM_NOT_PRIVATE', r.id);
      }
      const hasBalconyOrUtilityVentilation = (
        (r.type === 'living' && [...(graph.get(r.id) ?? [])].some(adjId => {
          const adj = rooms.find(o => o.id === adjId);
          return adj?.type === 'balcony' || adj?.spaceUse === 'OUTDOOR' || adj?.name.toLowerCase().includes('balcony');
        })) ||
        (r.type === 'kitchen' && [...(graph.get(r.id) ?? [])].some(adjId => {
          const adj = rooms.find(o => o.id === adjId);
          return adj?.type === 'utility' || adj?.type === 'service_shaft' || adj?.spaceUse === 'SERVICE' || adj?.spaceUse === 'OUTDOOR' || adj?.name.toLowerCase().includes('utility');
        }))
      );
      if (r.unitId && ['living', 'bedroom', 'kitchen'].includes(r.type) && !floor.windows.some(w => w.roomId === r.id) && !hasBalconyOrUtilityVentilation) add('DAYLIGHT_OPENING_UNVERIFIED', r.id, 'warning');
    }
    const ledger = measureApartmentAreaLedger(floor);
    if (!Number.isFinite(ledger.delta) || Math.abs(ledger.delta) >= 0.001) add('AREA_LEDGER_MISMATCH', `${floor.id}: ${ledger.delta} mm2`);
    if (!ledger.supported) add('AREA_LEDGER_UNSUPPORTED', floor.id);
    if (ledger.overlap >= 0.001) add('AREA_LEDGER_OVERLAP', `${floor.id}: ${ledger.overlap} mm2`);
    if (ledger.unassigned >= 0.001) add('AREA_UNASSIGNED', `${floor.id}: ${ledger.unassigned} mm2`);
    for (const balcony of ledger.balconies) {
      if (!balcony.unitId || !balcony.accessDoorIds.some(id => validDoors.has(id))) add('BALCONY_ACCESS_MISSING', balcony.id);
      if (!floor.walls.some(w => w.roomIds.length === 1 && w.roomIds.includes(balcony.id))) add('BALCONY_EXTERIOR_EDGE_MISSING', balcony.id);
      if (balcony.usableDepth < 1200) add('BALCONY_CLEAR_DEPTH_SUBSTANDARD', `${balcony.id}: clear depth ${balcony.usableDepth} mm < 1200 mm`);
      if (balcony.usableDepth < 1500 || balcony.usableWidth < 2800) add('BALCONY_TOO_SMALL', balcony.id, 'warning');
    }
    for (const u of units) {
      // Exclude utility balconies from fragmentation check (§2.2)
      const nonUtilityBalconies = ledger.balconies.filter(b => {
        if (b.unitId !== u.id) return false;
        const r = rooms.find(room => room.id === b.id);
        const isUtil = b.id.toLowerCase().includes('utility') || r?.type === 'utility' || r?.name.toLowerCase().includes('utility');
        return !isUtil;
      });
      if (nonUtilityBalconies.length > 1) add('BALCONY_FRAGMENTATION_HIGH', u.id, 'warning');
    }
    if (ledger.unassigned / ledger.gross > 0.15) add('UNASSIGNED_AREA_HIGH', floor.id, 'warning');
    return ledger;
  });
  return { buildingId: building.id, buildingRevision: building.version, issues, hardErrors: issues.filter(i => i.severity === 'error').length, warnings: issues.filter(i => i.severity === 'warning').length, ledgers, regulatoryStatus: 'NOT_VERIFIED', professionalReview: 'REQUIRED' };
}


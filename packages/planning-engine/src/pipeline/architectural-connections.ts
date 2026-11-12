import {
  Direction,
  DoorType,
  StairType,
  SwingDirection,
  type Building,
  type CanonicalStaircase,
  type Floor,
  type Room,
  type Wall,
} from "@ai-floor-planner/core";
import {
  proposeArchitecturalStair,
  projectOnSegment,
  computeDoorSwingPolygon,
  containsPolygon,
} from "@ai-floor-planner/geometry-engine";
const stairRoom = (r: Room) =>
  ["STAIR_ENCLOSURE", "PROTECTED_STAIR_ENCLOSURE", "STAIR_MUMTY"].includes(
    r.architecturalRole ?? "",
  );
const coreKey = (r: Room) =>
  r.boundary.points
    .map((p) => `${p.x},${p.y}`)
    .sort()
    .join(";");
const accessHosts = (f: Floor, r: Room) =>
  f.walls.filter(
    (w) =>
      w.roomIds.includes(r.id) &&
      Math.hypot(
        w.endPoint.x - w.startPoint.x,
        w.endPoint.y - w.startPoint.y,
      ) >= 1200 &&
      w.roomIds.some((id) =>
        f.rooms.some(
          (q) =>
            q.id === id &&
            [
              "OPEN_CIRCULATION",
              "LIFT_LOBBY",
              "OPEN_TERRACE",
              "VEHICLE_AISLE",
              "ROOF_EQUIPMENT_ZONE",
              "PARKING_AREA",
            ].includes(q.architecturalRole ?? ""),
        ),
      ),
  );
const hostFits = (w: Wall, p: { x: number; y: number }) => {
  const hit = projectOnSegment(p, w.startPoint, w.endPoint);
  return (
    !!hit &&
    hit.distance < 0.001 &&
    hit.along >= 600 - 0.001 &&
    hit.along <= hit.length - 600 + 0.001
  );
};
/** New-generation finalization only. Loading historical projects never invokes this. */
export function coordinateArchitecturalStairs(building: Building): Building {
  const ordered = [...building.floors].sort((a, b) => a.level - b.level);
  const elevations = new Map<string, number>();
  let z = 0;
  for (const f of ordered) {
    const at = f.elevationMm ?? z;
    elevations.set(f.id, at);
    z = at + f.floorHeight;
  }
  const templates = new Map<string, { x: number; y: number }>();
  // Solve a common access interval across every level before choosing any floor host.
  const groups = new Map<string, { room: Room; hosts: Wall[] }[]>();
  for (const f of ordered)
    for (const r of f.rooms.filter(stairRoom)) {
      const key = coreKey(r);
      groups.set(key, [
        ...(groups.get(key) ?? []),
        { room: r, hosts: accessHosts(f, r) },
      ]);
    }
  for (const [key, group] of groups) {
    const room = group[0]!.room,
      preferredHorizontal = room.width <= room.height;
    const seeds = group
      .flatMap((g) => g.hosts)
      .sort(
        (a, b) =>
          Number(
            Math.abs(b.startPoint.y - b.endPoint.y) < 0.001 ===
              preferredHorizontal,
          ) -
          Number(
            Math.abs(a.startPoint.y - a.endPoint.y) < 0.001 ===
              preferredHorizontal,
          ),
      );
    const candidates = seeds.flatMap((w) => {
      const hit = projectOnSegment(w.startPoint, w.startPoint, w.endPoint)!;
      return [
        hit.pointAt(hit.length / 2),
        hit.pointAt(600),
        hit.pointAt(hit.length - 600),
      ];
    });
    const point = candidates.find((p) =>
      group.every((g) => g.hosts.some((w) => hostFits(w, p))),
    );
    if (!point) throw new Error(`STAIR_ACCESS_NOT_ALIGNED: ${room.id}`);
    templates.set(key, point);
  }
  const floors = ordered.map((f, i) => {
    const lower = ordered[i - 1],
      upper = ordered[i + 1];
    const rise = upper
      ? elevations.get(upper.id)! - elevations.get(f.id)!
      : lower
        ? elevations.get(f.id)! - elevations.get(lower.id)!
        : f.floorHeight;
    let doors = [...f.doors];
    const canonicalStaircases: CanonicalStaircase[] = [];
    const stairs = f.rooms.filter(stairRoom).map((r, index) => {
      const key = coreKey(r),
        position = templates.get(key)!;
      const host = accessHosts(f, r).find((w) => hostFits(w, position));
      if (!host) throw new Error(`STAIR_ACCESS_HOST_MISSING: ${r.id}`);
      const existing = doors.find((d) => d.connectsRooms.includes(r.id));
      let door = {
        ...(existing ?? {}),
        id: existing?.id ?? `${r.id}:access`,
        floorId: f.id,
        wallId: host.id,
        position,
        openingGeometryVersion: 1 as const,
        positionReference: "CENTER" as const,
        width: existing?.width ?? 1200,
        height: existing?.height ?? 2100,
        type: existing?.type ?? DoorType.OpenPassage,
        swingDirection: existing?.swingDirection ?? SwingDirection.Inward,
        connectsRooms: [
          r.id,
          host.roomIds.find((id) => id !== r.id)!,
        ] as readonly [string, string],
      };
      if (
        ![DoorType.OpenPassage, DoorType.Sliding, DoorType.Folding].includes(
          door.type,
        )
      ) {
        const destination = f.rooms.find(
          (q) => q.id === door.connectsRooms[1],
        )!;
        const chosen = [SwingDirection.Inward, SwingDirection.Outward]
          .map((swingDirection) => ({ ...door, swingDirection }))
          .find((candidate) =>
            containsPolygon(
              destination.boundary,
              computeDoorSwingPolygon(candidate, host),
            ),
          );
        if (!chosen)
          throw new Error(`STAIR_DOOR_CLEARANCE_UNAVAILABLE: ${door.id}`);
        door = chosen;
      }
      doors = existing
        ? doors.map((d) => (d.id === existing.id ? door : d))
        : [...doors, door];
      const old = f.canonicalStaircases?.[index];
      const id = old?.id ?? `${r.id}:stair`;
      const canonical = proposeArchitecturalStair(
        r,
        host,
        rise,
        id,
        1200,
        175,
        position,
      );
      canonicalStaircases.push(canonical);
      const horizontal = Math.abs(host.startPoint.y - host.endPoint.y) < 0.001;
      return {
        id,
        floorId: f.id,
        type: StairType.UShaped,
        boundary: r.boundary,
        x: r.x,
        y: r.y,
        width: r.width,
        length: r.height,
        direction: horizontal ? Direction.North : Direction.East,
        riserCount: canonical.riserCount,
        riserHeight: rise / canonical.riserCount,
        treadDepth: canonical.treadWidthMm,
        landingWidth: canonical.clearWidthMm,
        connectsFloors: (upper
          ? [f.level, upper.level]
          : lower
            ? [lower.level, f.level]
            : [f.level, f.level + 1]) as readonly [number, number],
        verticalCoreId: `architectural-stair:${key}`,
      };
    });
    return {
      ...f,
      elevationMm: elevations.get(f.id),
      // Both generation producers and their bounded repair routines emit centres.
      // This annotation applies only to fresh generation, never saved-project loading.
      doors: doors.map(o => {
        const wall = f.walls.find(w => w.id === o.wallId);
        if (!wall) return o;
        return { ...o, openingGeometryVersion: 1 as const, positionReference: 'CENTER' as const };
      }),
      windows: f.windows.map(o => {
        const wall = f.walls.find(w => w.id === o.wallId);
        if (!wall) return o;
        return { ...o, openingGeometryVersion: 1 as const, positionReference: 'CENTER' as const };
      }),
      stairs,
      canonicalStaircases,
    };
  });
  return {
    ...building,
    floors,
    canonicalStaircases: floors.flatMap((f) => f.canonicalStaircases),
  };
}

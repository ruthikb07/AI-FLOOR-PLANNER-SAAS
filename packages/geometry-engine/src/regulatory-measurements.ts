import type {
  Building,
  Floor,
  Point,
  Polygon,
  Room,
} from "@ai-floor-planner/core";
import {
  polygonArea,
  polygonBoundingBox,
  polygonIntersectionArea,
  polygonSignedArea,
  isConvex,
  isValidPolygon,
} from "./polygon";
import { wallToPolygon } from "./walls";
import { measureApartmentAreaLedger } from "./apartment-ledger";

export function rectangularBounds(p: Polygon) {
  if (
    p.points.length !== 4 ||
    p.points.some(
      (v, i) =>
        !Number.isFinite(v.x) ||
        !Number.isFinite(v.y) ||
        (v.x !== p.points[(i + 1) % 4]!.x && v.y !== p.points[(i + 1) % 4]!.y),
    )
  )
    return null;
  const b = polygonBoundingBox(p);
  return b.width > 0 &&
    b.height > 0 &&
    Math.abs(polygonArea(p) - b.width * b.height) < 0.001
    ? { ...b, minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height }
    : null;
}
/** Axis-aligned canonical plots only. Unsupported layouts never become bbox passes. */
export function measurePlotMargins(building: Building) {
  const plot = rectangularBounds(building.site.plotBoundary);
  if (
    !plot ||
    building.site.orientation !== 0 ||
    building.site.cornerPlot ||
    !building.floors.length
  )
    return null;
  const envelopes = building.floors.flatMap((f) => [
    f.boundary,
    ...f.walls
      .filter((w) => w.type === "external" || w.wallUse === "EXTERNAL")
      .map(wallToPolygon),
  ]);
  if (envelopes.some((p) => !rectangularBounds(p))) return null;
  const pts = envelopes.flatMap((p) => p.points),
    minX = Math.min(...pts.map((p) => p.x)),
    maxX = Math.max(...pts.map((p) => p.x)),
    minY = Math.min(...pts.map((p) => p.y)),
    maxY = Math.max(...pts.map((p) => p.y));
  const n = minY - plot.minY,
    s = plot.maxY - maxY,
    w = minX - plot.minX,
    e = plot.maxX - maxX;
  switch (building.site.roadFacing) {
    case "north":
      return { front: n, rear: s, left: w, right: e };
    case "south":
      return { front: s, rear: n, left: e, right: w };
    case "east":
      return { front: e, rear: w, left: n, right: s };
    case "west":
      return { front: w, rear: e, left: s, right: n };
    default:
      return null;
  }
}
/** Rectangular clear interior after actual adjacent wall solids, never nominal room.width. */
export function measureClearRoom(floor: Floor, room: Room) {
  const b = rectangularBounds(room.boundary);
  if (!b) return null;
  let x0 = b.minX,
    y0 = b.minY,
    x1 = b.maxX,
    y1 = b.maxY;
  for (const wall of floor.walls) {
    const wb = rectangularBounds(wallToPolygon(wall));
    if (!wb) return null;
    if (
      wb.maxX <= b.minX ||
      wb.minX >= b.maxX ||
      wb.maxY <= b.minY ||
      wb.minY >= b.maxY
    )
      continue;
    if (wb.minX <= b.minX && wb.maxY >= b.maxY && wb.minY <= b.minY)
      x0 = Math.max(x0, wb.maxX);
    else if (wb.maxX >= b.maxX && wb.maxY >= b.maxY && wb.minY <= b.minY)
      x1 = Math.min(x1, wb.minX);
    else if (wb.minY <= b.minY && wb.maxX >= b.maxX && wb.minX <= b.minX)
      y0 = Math.max(y0, wb.maxY);
    else if (wb.maxY >= b.maxY && wb.maxX >= b.maxX && wb.minX <= b.minX)
      y1 = Math.min(y1, wb.minY);
    else return null; // non-rectangular subtraction
  }
  if (x1 <= x0 || y1 <= y0) return null;
  return {
    minX: x0,
    minY: y0,
    maxX: x1,
    maxY: y1,
    width: x1 - x0,
    height: y1 - y0,
  };
}
export function measureMarkedParking(building: Building) {
  const bays = [
    ...building.floors
      .filter((f) => f.floorUse === "STILT_PARKING" || f.level === 0)
      .flatMap((f) =>
        f.rooms
          .filter(
            (r) =>
              r.type === "parking" && !r.tags.includes("STILT_CIRCULATION"),
          )
          .map((r) => ({
            id: r.id,
            name: r.name,
            boundary: r.boundary,
            kind: /^C[- ]?\d+/i.test(r.name)
              ? "CAR_STALL"
              : /^B[- ]?\d+/i.test(r.name)
                ? "BIKE_STALL"
                : "UNKNOWN",
            floorId: f.id,
          })),
      ),
    ...(building.site.siteZones ?? [])
      .filter(
        (z) =>
          z.regulatoryUse === "CAR_STALL" || z.regulatoryUse === "BIKE_STALL",
      )
      .map((z) => ({
        id: z.id,
        name: z.name,
        boundary: z.boundary,
        kind: z.regulatoryUse!,
        floorId: "site",
      })),
  ];
  const invalid: string[] = [];
  const valid = bays.filter((b, i) => {
    const rect = rectangularBounds(b.boundary),
      small = rect ? Math.min(rect.width, rect.height) : 0,
      large = rect ? Math.max(rect.width, rect.height) : 0;
    const inside =
      isValidPolygon(building.site.plotBoundary) &&
      isConvex(building.site.plotBoundary) &&
      polygonIntersectionArea(
        b.boundary,
        polygonSignedArea(building.site.plotBoundary) < 0
          ? { points: [...building.site.plotBoundary.points].reverse() }
          : building.site.plotBoundary,
      ) >=
        polygonArea(b.boundary) - 0.001;
    const overlap = bays.some(
      (o, j) =>
        j !== i &&
        (o.floorId === b.floorId ||
          o.floorId === "site" ||
          b.floorId === "site") &&
        polygonIntersectionArea(b.boundary, o.boundary) >= 0.001,
    );
    const physicalFloor = building.floors.find((f) => f.id === b.floorId);
    const obstructed =
      physicalFloor?.walls.some((w) => {
        const solid = wallToPolygon(w);
        const clip =
          polygonSignedArea(solid) < 0
            ? { points: [...solid.points].reverse() }
            : solid;
        return polygonIntersectionArea(b.boundary, clip) >= 0.001;
      }) ||
      physicalFloor?.columns.some((c) => {
        const p = {
          points: [
            { x: c.position.x - c.width / 2, y: c.position.y - c.depth / 2 },
            { x: c.position.x + c.width / 2, y: c.position.y - c.depth / 2 },
            { x: c.position.x + c.width / 2, y: c.position.y + c.depth / 2 },
            { x: c.position.x - c.width / 2, y: c.position.y + c.depth / 2 },
          ],
        };
        return polygonIntersectionArea(b.boundary, p) >= 0.001;
      });
    const insideFloor =
      !physicalFloor ||
      polygonIntersectionArea(b.boundary, physicalFloor.boundary) >=
        polygonArea(b.boundary) - 0.001;
    const occupied = physicalFloor?.rooms.some(
      (r) =>
        r.type !== "parking" &&
        r.spaceUse !== "VOID" &&
        polygonIntersectionArea(b.boundary, r.boundary) >= 0.001,
    );
    const okay =
      !!inside &&
      insideFloor &&
      !occupied &&
      !overlap &&
      !obstructed &&
      (b.kind === "CAR_STALL"
        ? small >= 2500 && large >= 5000
        : b.kind === "BIKE_STALL"
          ? small >= 1000 && large >= 2000
          : false);
    if (!okay) invalid.push(b.id);
    return okay;
  });
  const drives = (building.site.siteZones ?? []).filter(
    (z) => z.regulatoryUse === "DRIVEWAY",
  );
  const widths = drives.map((z) => {
    const r = rectangularBounds(z.boundary);
    return r ? Math.min(r.width, r.height) : null;
  });
  const driveConflicts = drives.some((d) =>
    bays.some((b) => polygonIntersectionArea(d.boundary, b.boundary) >= 0.001),
  );
  return {
    cars: valid.filter((b) => b.kind === "CAR_STALL").length,
    bikes: valid.filter((b) => b.kind === "BIKE_STALL").length,
    invalid,
    bayIds: bays.map((b) => b.id),
    driveIds: drives.map((d) => d.id),
    driveConflicts,
    drivewayWidthMm:
      widths.length && widths.every((v) => v !== null)
        ? Math.min(...(widths as number[]))
        : null,
  };
}
export function measureRecreationalSpace(building: Building) {
  const zones = (building.site.siteZones ?? []).filter(
    (z) => z.regulatoryUse === "ROS",
  );
  const reasons: string[] = [];
  const valid = zones.filter((z, i) => {
    const b = rectangularBounds(z.boundary);
    const ok =
      b &&
      Math.min(b.width, b.height) >= 10000 &&
      (Math.min(b.width, b.height) >= 20000 ||
        Math.max(b.width, b.height) <= 2.5 * Math.min(b.width, b.height)) &&
      polygonIntersectionArea(z.boundary, building.site.plotBoundary) >=
        polygonArea(z.boundary) - 0.001 &&
      !zones.some(
        (o, j) =>
          j !== i && polygonIntersectionArea(z.boundary, o.boundary) >= 0.001,
      ) &&
      !building.floors.some(
        (f) => polygonIntersectionArea(z.boundary, f.boundary) >= 0.001,
      ) &&
      !(building.site.siteZones ?? []).some(
        (o) =>
          o.id !== z.id &&
          o.regulatoryUse !== "ROS" &&
          polygonIntersectionArea(z.boundary, o.boundary) >= 0.001,
      );
    if (!ok) reasons.push(z.id);
    return !!ok;
  });
  const siteZones = building.site.siteZones ?? [];
  const edgePoint = (p: Point, poly: Polygon) => {
    const b = rectangularBounds(poly);
    return (
      !!b &&
      (((Math.abs(p.x - b.minX) < 0.001 || Math.abs(p.x - b.maxX) < 0.001) &&
        p.y >= b.minY &&
        p.y <= b.maxY) ||
        ((Math.abs(p.y - b.minY) < 0.001 || Math.abs(p.y - b.maxY) < 0.001) &&
          p.x >= b.minX &&
          p.x <= b.maxX))
    );
  };
  const touches = (a: Polygon, b: Polygon) => {
    const x = rectangularBounds(a),
      y = rectangularBounds(b);
    if (!x || !y) return false;
    return (
      ((Math.abs(x.maxX - y.minX) < 0.001 ||
        Math.abs(y.maxX - x.minX) < 0.001) &&
        Math.min(x.maxY, y.maxY) - Math.max(x.minY, y.minY) > 0) ||
      ((Math.abs(x.maxY - y.minY) < 0.001 ||
        Math.abs(y.maxY - x.minY) < 0.001) &&
        Math.min(x.maxX, y.maxX) - Math.max(x.minX, y.minX) > 0)
    );
  };
  const accessible = (id: string, seen: Set<string>): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    const zone = siteZones.find((z) => z.id === id);
    if (!zone) return false;
    return zone.accessLinks.some((link) => {
      const access = building.site.accessPoints.find((a) => a.id === link);
      if (access)
        return (
          access.width > 0 &&
          edgePoint(access.position, zone.boundary) &&
          edgePoint(access.position, building.site.plotBoundary)
        );
      const next = siteZones.find((z) => z.id === link);
      return (
        !!next &&
        ["pedestrian_circulation", "vehicle_circulation"].includes(next.kind) &&
        touches(zone.boundary, next.boundary) &&
        accessible(next.id, new Set(seen))
      );
    });
  };
  return {
    areaMm2: valid.reduce((s, z) => s + polygonArea(z.boundary), 0),
    ids: zones.map((z) => z.id),
    invalidIds: reasons,
    reviewed:
      zones.length > 0 && zones.every((z) => z.reviewStatus !== "UNREVIEWED"),
    accessVerified:
      zones.length > 0 && zones.every((z) => accessible(z.id, new Set())),
  };
}
/** Measured clear room dimensions plus exact centreline-cell area ledger. */
export function measureRegulatoryFloors(building: Building) {
  return building.floors.map((f) => ({
    floor: f,
    ledger: measureApartmentAreaLedger(f),
    rooms: f.rooms.map((room) => ({ room, clear: measureClearRoom(f, room) })),
  }));
}

/** Visibility graph within rectangular clear rooms, actual door portals and OPEN_PASSAGE.
 * Foreign units, shafts and balconies cannot be circulation shortcuts. Unsupported clear
 * interiors/obstructions return NOT_VERIFIED, rather than a straight-line estimate.
 */
export function measureEgressTravel(floor: Floor): {
  distanceMm: number | null;
  status: "MEASURED" | "DISCONNECTED" | "NOT_VERIFIED";
  paths: Point[][];
  reason: string;
} {
  const stairs = floor.canonicalStaircases ?? [];
  if (!stairs.length)
    return {
      distanceMm: null,
      status: "DISCONNECTED",
      paths: [],
      reason: "No canonical staircase.",
    };
  const rooms = floor.rooms
    .filter(
      (r) => r.unitId || ["corridor", "foyer", "staircase"].includes(r.type),
    )
    .filter(
      (r) =>
        ![
          "balcony",
          "utility",
          "service_shaft",
          "ots",
          "lift",
          "parking",
        ].includes(r.type),
    );
  const rects = rooms.map((r) => measureClearRoom(floor, r));
  if (
    !rooms.length ||
    rects.some((r) => !r) ||
    (floor.furniture ?? []).some((item) =>
      rooms.some((r) => r.id === item.roomId),
    ) ||
    floor.columns.some((c) =>
      rects.some(
        (b) =>
          b &&
          c.position.x + c.width / 2 > b.minX &&
          c.position.x - c.width / 2 < b.maxX &&
          c.position.y + c.depth / 2 > b.minY &&
          c.position.y - c.depth / 2 < b.maxY,
      ),
    )
  )
    return {
      distanceMm: null,
      status: "NOT_VERIFIED",
      paths: [],
      reason:
        "Clear interior is unsupported or contains column/furniture obstacles; constrained navigation must be reviewed.",
    };
  type Node = { p: Point; room: number; target?: boolean };
  const nodes: Node[] = [],
    edges: Map<number, number>[] = [];
  const add = (p: Point, room: number, target = false) => {
    nodes.push({ p, room, target });
    edges.push(new Map());
    return nodes.length - 1;
  };
  const link = (a: number, b: number) => {
    const d = Math.hypot(
      nodes[a]!.p.x - nodes[b]!.p.x,
      nodes[a]!.p.y - nodes[b]!.p.y,
    );
    edges[a]!.set(b, d);
    edges[b]!.set(a, d);
  };
  const clamp = (p: Point, i: number) => {
    const b = rects[i]!;
    return {
      x: Math.max(b.minX, Math.min(b.maxX, p.x)),
      y: Math.max(b.minY, Math.min(b.maxY, p.y)),
    };
  };
  const corners: number[] = [];
  rooms.forEach((r, i) => {
    if (r.unitId) {
      const b = rects[i]!;
      for (const p of [
        { x: b.minX, y: b.minY },
        { x: b.maxX, y: b.minY },
        { x: b.maxX, y: b.maxY },
        { x: b.minX, y: b.maxY },
      ])
        corners.push(add(p, i));
    }
  });
  for (const d of floor.doors) {
    const a = rooms.findIndex((r) => r.id === d.connectsRooms[0]),
      b = rooms.findIndex((r) => r.id === d.connectsRooms[1]);
    const wall = floor.walls.find((w) => w.id === d.wallId);
    if (
      a < 0 ||
      b < 0 ||
      !wall ||
      d.width <= 0 ||
      !wall.roomIds.includes(rooms[a]!.id) ||
      !wall.roomIds.includes(rooms[b]!.id)
    )
      continue;
    const pa = clamp(d.position, a),
      pb = clamp(d.position, b);
    if (
      Math.hypot(pa.x - d.position.x, pa.y - d.position.y) >
        wall.thickness + 1 ||
      Math.hypot(pb.x - d.position.x, pb.y - d.position.y) > wall.thickness + 1
    )
      continue;
    link(add(pa, a), add(pb, b));
  }
  for (const s of stairs) {
    if (s.accessEdge.type !== "OPEN_PASSAGE") continue;
    const p = {
      x: (s.accessEdge.startPoint.x + s.accessEdge.endPoint.x) / 2,
      y: (s.accessEdge.startPoint.y + s.accessEdge.endPoint.y) / 2,
    };
    rooms.forEach((r, i) => {
      if (!r.unitId && ["corridor", "foyer"].includes(r.type)) {
        const q = clamp(p, i);
        if (Math.hypot(p.x - q.x, p.y - q.y) <= 300) add(q, i, true);
      }
    });
  }
  if (!corners.length || !nodes.some((n) => n.target))
    return {
      distanceMm: null,
      status: "NOT_VERIFIED",
      paths: [],
      reason:
        "No measured unit corners or common circulation touching OPEN_PASSAGE.",
    };
  nodes.forEach((a, i) =>
    nodes.forEach((b, j) => {
      if (i < j && a.room === b.room) link(i, j);
    }),
  );
  const paths: Point[][] = [];
  let max = 0;
  for (const start of corners) {
    const uid = rooms[nodes[start]!.room]!.unitId,
      dist = nodes.map(() => Infinity),
      prev = nodes.map(() => -1),
      done = new Set<number>();
    dist[start] = 0;
    let end = -1;
    while (done.size < nodes.length) {
      let u = -1;
      for (let i = 0; i < nodes.length; i++)
        if (
          !done.has(i) &&
          Number.isFinite(dist[i]) &&
          (u < 0 || dist[i]! < dist[u]!)
        )
          u = i;
      if (u < 0) break;
      if (nodes[u]!.target) {
        end = u;
        break;
      }
      done.add(u);
      for (const [v, d] of edges[u]!) {
        const foreign = rooms[nodes[v]!.room]!.unitId;
        if (foreign && foreign !== uid) continue;
        if (dist[u]! + d < dist[v]!) {
          dist[v] = dist[u]! + d;
          prev[v] = u;
        }
      }
    }
    if (end < 0)
      return {
        distanceMm: null,
        status: "DISCONNECTED",
        paths,
        reason: "A unit corner has no door/corridor route to OPEN_PASSAGE.",
      };
    max = Math.max(max, dist[end]!);
    const path: Point[] = [];
    for (let n = end; n >= 0; n = prev[n]!) path.unshift(nodes[n]!.p);
    paths.push(path);
  }
  return {
    distanceMm: max,
    status: "MEASURED",
    paths,
    reason:
      "Longest of shortest visible routes from every clear unit-room corner through actual door portals to common OPEN_PASSAGE; furniture clearance/enclosure review remains separate.",
  };
}

export function measureWindowAdjacency(floor: Floor, room: Room) {
  const inside = (p: Point, poly: Polygon) => {
    let b = false;
    const v = poly.points;
    for (let i = 0, j = v.length - 1; i < v.length; j = i++)
      if (
        v[i]!.y > p.y !== v[j]!.y > p.y &&
        p.x <
          ((v[j]!.x - v[i]!.x) * (p.y - v[i]!.y)) / (v[j]!.y - v[i]!.y) +
            v[i]!.x
      )
        b = !b;
    return b;
  };
  let areaMm2 = 0;
  const invalid: string[] = [],
    shaftIds = new Set<string>();
  const windows = floor.windows.filter((w) => w.roomId === room.id);
  for (const w of windows) {
    const wall = floor.walls.find((v) => v.id === w.wallId);
    if (
      w.type === "fixed" ||
      !wall ||
      !wall.roomIds.includes(room.id) ||
      !Number.isFinite(w.width) ||
      !Number.isFinite(w.height) ||
      w.width <= 0 ||
      w.height <= 0
    ) {
      invalid.push(w.id);
      continue;
    }
    const a = wall.startPoint,
      b = wall.endPoint,
      dx = b.x - a.x,
      dy = b.y - a.y,
      len = Math.hypot(dx, dy);
    if (!len) {
      invalid.push(w.id);
      continue;
    }
    const t =
      ((w.position.x - a.x) * dx + (w.position.y - a.y) * dy) / (len * len);
    const offset =
      Math.abs((w.position.x - a.x) * dy - (w.position.y - a.y) * dx) / len;
    if (t < 0 || t > 1 || offset > wall.thickness / 2 + 1 || w.width > len) {
      invalid.push(w.id);
      continue;
    }
    const d = wall.thickness / 2 + 1,
      samples = [1, -1].map((k) => ({
        x: w.position.x - ((k * dy) / len) * d,
        y: w.position.y + ((k * dx) / len) * d,
      }));
    const outdoor = samples.some((p) => !inside(p, floor.boundary));
    const adjacent = floor.rooms.filter(
      (r) =>
        r.id !== room.id &&
        ["balcony", "ots", "service_shaft"].includes(r.type) &&
        samples.some((p) => inside(p, r.boundary)),
    );
    if (outdoor || adjacent.length) {
      areaMm2 += w.width * w.height;
      adjacent
        .filter((r) => r.type === "service_shaft" || r.type === "ots")
        .forEach((r) => shaftIds.add(r.id));
    } else invalid.push(w.id);
  }
  return {
    areaMm2,
    windowIds: windows.map((w) => w.id),
    invalid,
    shaftIds: [...shaftIds],
  };
}

/** RERA 2(k) convention: usable interiors plus clipped internal partition union;
 * external/party/core/shaft wall solids and outdoor/service rooms are excluded.
 * Unknown wall classification blocks the parking-band conclusion.
 */
export function measureUnitCarpetAreas(
  floor: Floor,
  ledger = measureApartmentAreaLedger(floor),
) {
  const walls = floor.walls.map((w) => ({
    wall: w,
    polygon: wallToPolygon(w),
  }));
  const supported = ledger.supported && walls.every((w) => !!w.wall.wallUse);
  const inside = (p: Point, poly: Polygon) => {
    let b = false;
    for (
      let i = 0, j = poly.points.length - 1;
      i < poly.points.length;
      j = i++
    ) {
      const a = poly.points[i]!,
        c = poly.points[j]!;
      if (
        a.y > p.y !== c.y > p.y &&
        p.x < ((c.x - a.x) * (p.y - a.y)) / (c.y - a.y) + a.x
      )
        b = !b;
    }
    return b;
  };
  const units = (floor.apartmentUnits ?? []).map((u) => {
    const rooms = floor.rooms.filter(
      (r) =>
        r.unitId === u.id &&
        ![
          "balcony",
          "utility",
          "terrace",
          "ots",
          "service_shaft",
          "lift",
          "staircase",
        ].includes(r.type) &&
        r.spaceUse !== "OUTDOOR" &&
        r.spaceUse !== "SERVICE" &&
        r.spaceUse !== "VOID",
    );
    const usable = rooms.reduce(
      (sum, r) => sum + (ledger.roomUsable[r.id] ?? 0),
      0,
    );
    const owned = new Set(rooms.map((r) => r.id));
    const partitions = walls.filter(
      (w) =>
        w.wall.wallUse === "INTERNAL_PARTITION" &&
        w.wall.roomIds.length >= 2 &&
        w.wall.roomIds.every((id) => owned.has(id)),
    );
    let internalWallAreaMm2 = 0;
    const polys = [u.boundary, ...walls.map((w) => w.polygon)];
    const xs = [
        ...new Set(polys.flatMap((p) => p.points.map((q) => q.x))),
      ].sort((a, b) => a - b),
      ys = [...new Set(polys.flatMap((p) => p.points.map((q) => q.y)))].sort(
        (a, b) => a - b,
      );
    for (let x = 1; x < xs.length; x++)
      for (let y = 1; y < ys.length; y++) {
        const pt = {
          x: (xs[x]! + xs[x - 1]!) / 2,
          y: (ys[y]! + ys[y - 1]!) / 2,
        };
        if (
          !inside(pt, u.boundary) ||
          !partitions.some((w) => inside(pt, w.polygon))
        )
          continue;
        if (walls.some((w) => !partitions.includes(w) && inside(pt, w.polygon)))
          continue;
        internalWallAreaMm2 += (xs[x]! - xs[x - 1]!) * (ys[y]! - ys[y - 1]!);
      }
    return {
      unitId: u.id,
      areaMm2: usable + internalWallAreaMm2,
      usableAreaMm2: usable,
      internalWallAreaMm2,
      supported: supported && rooms.length > 0,
    };
  });
  return units;
}

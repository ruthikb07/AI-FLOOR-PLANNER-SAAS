import type {
  CanonicalStaircase,
  Polygon,
  Point,
  Floor,
  Room,
  Wall,
} from "@ai-floor-planner/core";
export interface ArchitecturalSolid {
  readonly sourceId: string;
  readonly kind: "stair-tread" | "stair-landing" | "mumty-cover";
  readonly boundary: Polygon;
  readonly bottom: number;
  readonly top: number;
}
/** Shared source-polygon stair projection, local Z in mm. No guessed flight bounding boxes. */
export function canonicalStairSolids(
  s: CanonicalStaircase,
  rise: number,
  thickness = 150,
): ArchitecturalSolid[] {
  const counts = s.flightRiserCounts ?? [
    Math.ceil(s.riserCount / 2),
    Math.floor(s.riserCount / 2),
  ];
  if (
    !Number.isFinite(rise) ||
    rise <= 0 ||
    !counts.every((n) => Number.isInteger(n) && n >= 2) ||
    counts[0] + counts[1] !== s.riserCount
  )
    throw new Error(`Invalid stair rise/counts: ${s.id}`);
  const solids: ArchitecturalSolid[] = [];
  if (s.floorLanding)
    solids.push({
      sourceId: s.id,
      kind: "stair-landing",
      boundary: s.floorLanding,
      bottom: -thickness,
      top: 0,
    });
  const step = rise / s.riserCount;
  solids.push({
    sourceId: s.id,
    kind: "stair-landing",
    boundary: s.midLanding,
    bottom: counts[0] * step - thickness,
    top: counts[0] * step,
  });
  const lc = s.midLanding.points.reduce(
    (a, p) => ({
      x: a.x + p.x / s.midLanding.points.length,
      y: a.y + p.y / s.midLanding.points.length,
    }),
    { x: 0, y: 0 },
  );
  for (const [flight, n, base, up] of [
    [s.flight1, counts[0], 0, true],
    [s.flight2, counts[1], counts[0], false],
  ] as const) {
    if (flight.points.length !== 4)
      throw new Error(`Unsupported flight polygon: ${s.id}`);
    const p = flight.points;
    let edge = 0,
      best = Infinity;
    for (let j = 0; j < 4; j++) {
      const a = p[j]!,
        b = p[(j + 1) % 4]!,
        d = Math.hypot((a.x + b.x) / 2 - lc.x, (a.y + b.y) / 2 - lc.y);
      if (d < best) {
        best = d;
        edge = j;
      }
    }
    let a = p[(edge + 3) % 4]!,
      b = p[(edge + 2) % 4]!,
      c = p[edge]!,
      d = p[(edge + 1) % 4]!;
    if (!up) {
      [a, c] = [c, a];
      [b, d] = [d, b];
    }
    const lerp = (u: Point, v: Point, t: number): Point => ({
      x: u.x + (v.x - u.x) * t,
      y: u.y + (v.y - u.y) * t,
    });
    for (let k = 0; k < n - 1; k++) {
      const t = k / (n - 1),
        u = (k + 1) / (n - 1);
      solids.push({
        sourceId: s.id,
        kind: "stair-tread",
        boundary: {
          points: [lerp(a, c, t), lerp(b, d, t), lerp(b, d, u), lerp(a, c, u)],
        },
        bottom: (base + k) * step - thickness,
        top: (base + k + 1) * step,
      });
    }
  }
  return solids;
}
export function mumtyCoverSolids(f: Floor): ArchitecturalSolid[] {
  if (f.floorUse !== "ROOF") return [];
  return f.rooms
    .filter((r) => r.architecturalRole === "STAIR_MUMTY")
    .map((r) => ({
      sourceId: r.id,
      kind: "mumty-cover",
      boundary: r.boundary,
      bottom: f.floorHeight - (f.slabThicknessMm ?? 150),
      top: f.floorHeight,
    }));
}

/** New architectural proposal from a rectangular enclosure and an actual access host.
 * 1200mm flight and 175mm riser targets are design inputs, never a compliance result. */
export function proposeArchitecturalStair(
  room: Room,
  host: Wall,
  rise: number,
  id: string,
  targetFlightWidth = 1200,
  targetRiser = 175,
  accessCenter?: Point,
): CanonicalStaircase {
  const points = room.boundary.points;
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  const w = Math.max(...points.map((p) => p.x)) - x,
    h = Math.max(...points.map((p) => p.y)) - y;
  if (
    points.length !== 4 ||
    points.some((p) => ![x, x + w].includes(p.x) || ![y, y + h].includes(p.y))
  )
    throw new Error(`Unsupported stair enclosure: ${room.id}`);
  const horizontal = Math.abs(host.startPoint.y - host.endPoint.y) < 0.001;
  const inset = host.thickness / 2,
    width = (horizontal ? w : h) - 2 * inset,
    depth = (horizontal ? h : w) - 2 * inset;
  const far = horizontal
    ? Math.abs(host.startPoint.y - (y + h)) < 0.001
    : Math.abs(host.startPoint.x - (x + w)) < 0.001;
  const point = (u: number, v: number): Point =>
    horizontal
      ? { x: x + inset + u, y: far ? y + h - inset - v : y + inset + v }
      : { x: far ? x + w - inset - v : x + inset + v, y: y + inset + u };
  const poly = (u: number, v: number, a: number, b: number): Polygon => ({
    points: [
      point(u, v),
      point(u + a, v),
      point(u + a, v + b),
      point(u, v + b),
    ],
  });
  const flightWidth = Math.min(targetFlightWidth, width / 2),
    landing = flightWidth;
  const riserCount = 2 * Math.ceil(rise / (2 * targetRiser)),
    count = riserCount / 2,
    run = depth - 2 * landing;
  if (!(run > 0 && count >= 2 && flightWidth > 0))
    throw new Error(`Stair flights and landings do not fit: ${room.id}`);
  const center = accessCenter ?? {
    x: (host.startPoint.x + host.endPoint.x) / 2,
    y: (host.startPoint.y + host.endPoint.y) / 2,
  };
  const len = Math.hypot(
      host.endPoint.x - host.startPoint.x,
      host.endPoint.y - host.startPoint.y,
    ),
    ux = (host.endPoint.x - host.startPoint.x) / len,
    uy = (host.endPoint.y - host.startPoint.y) / len;
  return {
    id,
    floorId: room.floorId,
    polygon: room.boundary,
    flight1: poly(0, landing, flightWidth, run),
    flight2: poly(width - flightWidth, landing, flightWidth, run),
    midLanding: poly(0, depth - landing, width, landing),
    floorLanding: poly(0, -inset, width, landing + inset),
    riserCount,
    flightRiserCounts: [count, count],
    treadWidthMm: run / (count - 1),
    clearWidthMm: flightWidth,
    accessEdge: {
      type: "OPEN_PASSAGE",
      startPoint: { x: center.x - ux * 600, y: center.y - uy * 600 },
      endPoint: { x: center.x + ux * 600, y: center.y + uy * 600 },
    },
  };
}
/** Same canonical holes for interactive and export 3D consumers. */
export function architecturalSlabCutouts(f: Floor): Polygon[] {
  const polygons = [
    ...(f.voidBoundaries ?? []),
    ...f.rooms
      .filter(
        (r) =>
          r.openToSky ||
          [
            "LIFT_SHAFT",
            "SERVICE_SHAFT",
            "OPEN_TO_SKY_VOID",
            "STAIR_ENCLOSURE",
            "PROTECTED_STAIR_ENCLOSURE",
            "STAIR_MUMTY",
          ].includes(r.architecturalRole ?? ""),
      )
      .map((r) => r.boundary),
  ];
  return [
    ...new Map(
      polygons.map((p) => [
        p.points
          .map((q) => `${q.x},${q.y}`)
          .sort()
          .join(";"),
        p,
      ]),
    ).values(),
  ];
}

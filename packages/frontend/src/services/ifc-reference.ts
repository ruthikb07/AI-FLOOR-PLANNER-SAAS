import { exchangeArtifactDigest, readIfc4Step, stepArgs, stepNumber, stepText, type Point } from '@ai-floor-planner/core';
import { polygonArea } from '@ai-floor-planner/geometry-engine';

export interface ReferencePrism {
  readonly globalId: string;
  readonly ifcClass: string;
  readonly name: string;
  readonly boundary: readonly Point[];
  readonly holes?: readonly (readonly Point[])[];
  readonly bottomMm: number;
  readonly topMm: number;
}

export interface IfcReferenceModel {
  readonly sha256: string;
  readonly schema: 'IFC4';
  readonly unit: 'mm' | 'cm' | 'm';
  readonly globalId: string;
  readonly name: string;
  readonly storeys: readonly { readonly globalId: string; readonly name: string; readonly elevationMm: number }[];
  readonly elements: readonly RefEntity[];
  readonly unsupported: Readonly<Record<string, number>>;
}

interface RefEntity {
  readonly globalId: string;
  readonly ifcClass: string;
  readonly name: string;
  readonly prisms: readonly ReferencePrism[];
}

// Rotations are planar and all transformed quantities remain right-handed millimetres.
interface Transform { readonly x: number; readonly y: number; readonly z: number; readonly angle: number }
const identity: Transform = { x: 0, y: 0, z: 0, angle: 0 };
export type ReferenceAlignment = Transform;

function transformPoint(p: Point, t: Transform): Point {
  const cos = Math.cos(t.angle), sin = Math.sin(t.angle);
  return { x: t.x + p.x * cos - p.y * sin, y: t.y + p.x * sin + p.y * cos };
}

function compose(parent: Transform, local: Transform): Transform {
  return { ...transformPoint(local, parent), z: parent.z + local.z, angle: parent.angle + local.angle };
}

export function alignedPlanPrism(prism: ReferencePrism, transform: ReferenceAlignment): ReferencePrism {
  const mapPt = (p: Point): Point => {
    const point = transformPoint(p, transform);
    return { x: point.x, y: -point.y };
  };
  return {
    ...prism,
    boundary: prism.boundary.map(mapPt),
    ...(prism.holes ? { holes: prism.holes.map(ring => ring.map(mapPt)) } : {}),
    bottomMm: prism.bottomMm + transform.z,
    topMm: prism.topMm + transform.z,
  };
}

function convexHull2D(points: readonly Point[]): Point[] {
  if (points.length <= 2) return [...points];
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const deduped: Point[] = [];
  for (const p of sorted) {
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-4) deduped.push(p);
  }
  if (deduped.length < 3) return deduped;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of deduped) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = deduped.length - 1; i >= 0; i--) {
    const p = deduped[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

const physicalClasses = new Set([
  'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCSLAB', 'IFCROOF', 'IFCBEAM', 'IFCCOLUMN', 'IFCMEMBER', 'IFCPLATE',
  'IFCDUCTSEGMENT', 'IFCPIPESEGMENT', 'IFCCABLECARRIERSEGMENT', 'IFCCABLESEGMENT', 'IFCFLOWSEGMENT', 'IFCFLOWTERMINAL',
  'IFCBUILDINGELEMENTPROXY', 'IFCSTAIR', 'IFCSTAIRFLIGHT', 'IFCRAILING', 'IFCDOOR', 'IFCWINDOW', 'IFCFOOTING',
]);

export function readIfcReference(bytes: Uint8Array): IfcReferenceModel {
  const doc = readIfc4Step(bytes);
  const projects = [...doc.roots.entries()].filter(([, item]) => item.type === 'IFCPROJECT');
  if (projects.length !== 1) throw new Error('IFC_REFERENCE_REQUIRES_ONE_PROJECT');
  const [globalId, project] = projects[0]!;
  const units = stepArgs(doc.entity(project.args[8], 'IFCUNITASSIGNMENT').args[0]!);
  const lengthUnits = units.map(id => doc.entity(id)).filter(item =>
    item.type === 'IFCSIUNIT' && item.args[1] === '.LENGTHUNIT.' && item.args[3] === '.METRE.');
  if (lengthUnits.length !== 1) throw new Error('IFC_REFERENCE_LENGTH_UNITS_UNSUPPORTED');
  const prefix = lengthUnits[0]!.args[2];
  const unit = prefix === '$' ? 'm' : prefix === '.MILLI.' ? 'mm' : prefix === '.CENTI.' ? 'cm' : undefined;
  if (!unit) throw new Error('IFC_REFERENCE_LENGTH_UNITS_UNSUPPORTED');
  const factor = { mm: 1, cm: 10, m: 1000 }[unit];
  const limit = (v: number) => {
    if (!Number.isFinite(v) || Math.abs(v) > 1e9) throw new Error('IFC_REFERENCE_COORDINATE_LIMIT');
    return v;
  };

  for (const entity of doc.entities.values()) {
    if (entity.type === 'IFCCARTESIANPOINT') doc.point(entity.id).forEach(n => limit(n * factor));
  }

  const directions = (ref: string | undefined, fallback: readonly number[]) =>
    ref && ref !== '$' ? stepArgs(doc.entity(ref, 'IFCDIRECTION').args[0]!).map(stepNumber) : fallback;
  const checkVertical = (ref: string | undefined) => {
    const direction = directions(ref, [0, 0, 1]);
    if (direction.length !== 3 || Math.hypot(direction[0]!, direction[1]!) > 1e-8 || direction[2]! <= 0) {
      throw new Error('IFC_NON_VERTICAL_GEOMETRY_UNSUPPORTED');
    }
  };
  const axis = (ref: string | undefined): Transform => {
    if (!ref || ref === '$') return identity;
    const item = doc.entity(ref);
    if (item.type !== 'IFCAXIS2PLACEMENT2D' && item.type !== 'IFCAXIS2PLACEMENT3D') throw new Error('IFC_PLACEMENT_UNSUPPORTED');
    const flat = item.type === 'IFCAXIS2PLACEMENT2D';
    if (!flat) checkVertical(item.args[1]);
    const [x, y, z = 0] = doc.point(item.args[0]);
    const dir = directions(item.args[flat ? 1 : 2], [1, 0, 0]);
    if (Math.abs(dir[2] ?? 0) > 1e-8 || Math.hypot(dir[0]!, dir[1]!) <= 1e-8) throw new Error('IFC_PLACEMENT_AXIS_UNSUPPORTED');
    return { x: x! * factor, y: y! * factor, z: z * factor, angle: Math.atan2(dir[1]!, dir[0]!) };
  };
  const placements = new Map<string, Transform>();
  const placement = (ref: string | undefined, path: readonly string[] = []): Transform => {
    if (!ref || ref === '$') return identity;
    if (path.length > 32 || path.includes(ref)) throw new Error('IFC_REFERENCE_PLACEMENT_DEPTH');
    const cached = placements.get(ref);
    if (cached) return cached;
    const item = doc.entity(ref, 'IFCLOCALPLACEMENT');
    const value = compose(placement(item.args[0], [...path, ref]), axis(item.args[1]));
    [value.x, value.y, value.z].forEach(limit);
    placements.set(ref, value);
    return value;
  };

  const storeys = [...doc.roots].filter(([, row]) => row.type === 'IFCBUILDINGSTOREY').map(([id, row]) => ({
    globalId: id, name: stepText(row.args[2]), elevationMm: placement(row.args[5]).z,
  }));
  const hostsWithVoids = new Set([...doc.entities.values()]
    .filter(item => item.type === 'IFCRELVOIDSELEMENT').map(item => item.args[4]));
  const unsupported: Record<string, number> = Object.create(null);
  let vertexBudget = 100_000;
  const elements: RefEntity[] = [];
  for (const [id, entity] of doc.roots) {
    if (!physicalClasses.has(entity.type)) continue;
    if (elements.length >= 12_000) throw new Error('IFC_REFERENCE_PRODUCT_LIMIT');
    const ifcClass = entity.type;
    const name = stepText(entity.args[2]).slice(0, 512);
    let prisms: ReferencePrism[] = [];
    try {
      if (!entity.args[6] || entity.args[6] === '$' || hostsWithVoids.has(entity.id)) throw new Error('IFC_REFERENCE_BODY_UNSUPPORTED');
      const product = doc.entity(entity.args[6], 'IFCPRODUCTDEFINITIONSHAPE');
      const representation = stepArgs(product.args[2]!).map(ref => doc.entity(ref))
        .find(item => stepText(item.args[1]) === 'Body');
      if (!representation) throw new Error('IFC_REFERENCE_BODY_UNSUPPORTED');
      const bodies = stepArgs(representation.args[3]!);
      if (!bodies.length || bodies.length > 256) throw new Error('IFC_REFERENCE_BODY_COMPLEXITY');
      const entityPlacement = placement(entity.args[5]);
      prisms = bodies.map(ref => {
        const body = doc.entity(ref);
        if (body.type === 'IFCEXTRUDEDAREASOLID') {
          checkVertical(body.args[2]);
          const bodyPose = compose(entityPlacement, axis(body.args[1]));
          const profile = doc.entity(body.args[0]);
          let points: readonly Point[];
          let rawHoles: (readonly Point[])[] | undefined;
          let pose = bodyPose;
          if (profile.type === 'IFCRECTANGLEPROFILEDEF') {
            const w = stepNumber(profile.args[3]) * factor / 2, d = stepNumber(profile.args[4]) * factor / 2;
            if (w <= 0 || d <= 0) throw new Error('IFC_REFERENCE_DEGENERATE_RECTANGLE');
            pose = compose(pose, axis(profile.args[2]));
            points = [{ x: -w, y: -d }, { x: w, y: -d }, { x: w, y: d }, { x: -w, y: d }];
          } else if (profile.type === 'IFCCIRCLEPROFILEDEF') {
            const radius = stepNumber(profile.args[3]) * factor;
            if (radius <= 0) throw new Error('IFC_REFERENCE_DEGENERATE_CIRCLE');
            pose = compose(pose, axis(profile.args[2]));
            const segs = 24;
            points = Array.from({ length: segs }, (_, idx) => {
              const ang = (idx * Math.PI * 2) / segs;
              return { x: radius * Math.cos(ang), y: radius * Math.sin(ang) };
            });
          } else if (profile.type === 'IFCARBITRARYCLOSEDPROFILEDEF') {
            const ring = doc.ring(profile.args[2]);
            if (ring.length < 4 || ring[0]!.x !== ring.at(-1)!.x || ring[0]!.y !== ring.at(-1)!.y) {
              throw new Error('IFC_REFERENCE_OPEN_PROFILE');
            }
            points = ring.slice(0, -1).map(p => ({ x: p.x * factor, y: p.y * factor }));
          } else if (profile.type === 'IFCARBITRARYPROFILEDEFWITHVOIDS') {
            const ring = doc.ring(profile.args[2]);
            if (ring.length < 4 || ring[0]!.x !== ring.at(-1)!.x || ring[0]!.y !== ring.at(-1)!.y) {
              throw new Error('IFC_REFERENCE_OPEN_PROFILE');
            }
            points = ring.slice(0, -1).map(p => ({ x: p.x * factor, y: p.y * factor }));
            rawHoles = stepArgs(profile.args[3]!).map(holeRef => {
              const hr = doc.ring(holeRef);
              if (hr.length < 4) throw new Error('IFC_REFERENCE_OPEN_HOLE');
              return hr.slice(0, -1).map(p => ({ x: p.x * factor, y: p.y * factor }));
            });
          } else {
            throw new Error('IFC_REFERENCE_PROFILE_UNSUPPORTED');
          }
          if (points.length > 4096 || polygonArea({ points }) < 0.001) throw new Error('IFC_REFERENCE_PROFILE_LIMIT');
          vertexBudget -= points.length + (rawHoles?.reduce((s, h) => s + h.length, 0) ?? 0);
          if (vertexBudget < 0) throw new Error('IFC_REFERENCE_VERTEX_BUDGET');
          const boundary = points.map(p => {
            const q = transformPoint(p, pose);
            return { x: limit(q.x), y: limit(q.y) };
          });
          const holes = rawHoles?.map(hr =>
            hr.map(p => {
              const q = transformPoint(p, pose);
              return { x: limit(q.x), y: limit(q.y) };
            }),
          );
          const height = stepNumber(body.args[3]) * factor;
          if (height <= 0) throw new Error('IFC_REFERENCE_DEPTH_INVALID');
          return {
            globalId: id,
            ifcClass,
            name,
            boundary,
            ...(holes?.length ? { holes } : {}),
            bottomMm: limit(pose.z),
            topMm: limit(pose.z + height),
          };
        }

        if (body.type === 'IFCFACETEDBREP') {
          const shell = doc.entity(body.args[0], 'IFCCLOSEDSHELL');
          const faces = stepArgs(shell.args[0]!);
          if (!faces.length || faces.length > 2048) throw new Error('IFC_REFERENCE_BREP_LIMIT');
          const pts2d: Point[] = [];
          let minZ = Infinity;
          let maxZ = -Infinity;
          for (const fRef of faces) {
            const face = doc.entity(fRef, 'IFCFACE');
            for (const bRef of stepArgs(face.args[0]!)) {
              const bound = doc.entity(bRef);
              if (bound.type !== 'IFCFACEOUTERBOUND' && bound.type !== 'IFCFACEBOUND') continue;
              const loop = doc.entity(bound.args[0], 'IFCPOLYLOOP');
              const loopRefs = stepArgs(loop.args[0]!);
              vertexBudget -= loopRefs.length;
              if (vertexBudget < 0) throw new Error('IFC_REFERENCE_VERTEX_BUDGET');
              for (const ptRef of loopRefs) {
                const coords = doc.point(ptRef);
                const tp = transformPoint({ x: coords[0]! * factor, y: coords[1]! * factor }, entityPlacement);
                const tz = entityPlacement.z + (coords[2] ?? 0) * factor;
                pts2d.push({ x: limit(tp.x), y: limit(tp.y) });
                minZ = Math.min(minZ, limit(tz));
                maxZ = Math.max(maxZ, limit(tz));
              }
            }
          }
          const hull = convexHull2D(pts2d);
          if (hull.length < 3 || polygonArea({ points: hull }) < 0.001 || !(maxZ > minZ)) {
            throw new Error('IFC_REFERENCE_DEGENERATE_BREP');
          }
          return { globalId: id, ifcClass, name, boundary: hull, bottomMm: minZ, topMm: maxZ };
        }

        if (body.type === 'IFCTRIANGULATEDFACESET' || body.type === 'IFCPOLYGONALFACESET') {
          const coordEntity = doc.entity(body.args[0], 'IFCCARTESIANPOINTLIST3D');
          const triples = stepArgs(coordEntity.args[0]!);
          if (triples.length < 4 || triples.length > 16_384) throw new Error('IFC_REFERENCE_FACESET_LIMIT');
          vertexBudget -= triples.length;
          if (vertexBudget < 0) throw new Error('IFC_REFERENCE_VERTEX_BUDGET');
          const pts2d: Point[] = [];
          let minZ = Infinity;
          let maxZ = -Infinity;
          for (const tripleText of triples) {
            const nums = stepArgs(tripleText).map(stepNumber);
            if (nums.length < 3) throw new Error('IFC_REFERENCE_INVALID_COORD_TRIPLE');
            const tp = transformPoint({ x: nums[0]! * factor, y: nums[1]! * factor }, entityPlacement);
            const tz = entityPlacement.z + nums[2]! * factor;
            pts2d.push({ x: limit(tp.x), y: limit(tp.y) });
            minZ = Math.min(minZ, limit(tz));
            maxZ = Math.max(maxZ, limit(tz));
          }
          const hull = convexHull2D(pts2d);
          if (hull.length < 3 || polygonArea({ points: hull }) < 0.001 || !(maxZ > minZ)) {
            throw new Error('IFC_REFERENCE_DEGENERATE_FACESET');
          }
          return { globalId: id, ifcClass, name, boundary: hull, bottomMm: minZ, topMm: maxZ };
        }

        throw new Error('IFC_REFERENCE_BODY_UNSUPPORTED');
      });
    } catch (error) {
      if (error instanceof Error && ['IFC_REFERENCE_VERTEX_BUDGET', 'IFC_REFERENCE_COORDINATE_LIMIT', 'IFC_REFERENCE_PLACEMENT_DEPTH'].includes(error.message)) throw error;
      unsupported[ifcClass] = (unsupported[ifcClass] ?? 0) + 1;
    }
    elements.push({ globalId: id, ifcClass, name, prisms });
  }
  return { sha256: exchangeArtifactDigest(bytes), schema: 'IFC4', unit,
    globalId, name: stepText(project.args[2]).slice(0, 512), storeys, elements, unsupported };
}

import { exchangeArtifactDigest, readIfc4Step, stepArgs, stepNumber, stepText, type Point } from '@ai-floor-planner/core';
import { polygonArea } from '@ai-floor-planner/geometry-engine';

export interface ReferencePrism {
  readonly globalId: string;
  readonly ifcClass: string;
  readonly name: string;
  readonly boundary: readonly Point[];
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
  return { ...prism, boundary: prism.boundary.map(p => {
    const point = transformPoint(p, transform);
    return { x: point.x, y: -point.y };
  }), bottomMm: prism.bottomMm + transform.z, topMm: prism.topMm + transform.z };
}

const physicalClasses = new Set([
  'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCSLAB', 'IFCROOF', 'IFCBEAM', 'IFCCOLUMN', 'IFCMEMBER', 'IFCPLATE',
  'IFCDUCTSEGMENT', 'IFCPIPESEGMENT', 'IFCBUILDINGELEMENTPROXY', 'IFCSTAIR', 'IFCSTAIRFLIGHT', 'IFCRAILING', 'IFCDOOR', 'IFCWINDOW',
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
      prisms = bodies.map(ref => {
        const body = doc.entity(ref, 'IFCEXTRUDEDAREASOLID');
        checkVertical(body.args[2]);
        const bodyPose = compose(placement(entity.args[5]), axis(body.args[1]));
        const profile = doc.entity(body.args[0]);
        let points: readonly Point[];
        let pose = bodyPose;
        if (profile.type === 'IFCRECTANGLEPROFILEDEF') {
          const w = stepNumber(profile.args[3]) * factor / 2, d = stepNumber(profile.args[4]) * factor / 2;
          if (w <= 0 || d <= 0) throw new Error('IFC_REFERENCE_DEGENERATE_RECTANGLE');
          pose = compose(pose, axis(profile.args[2]));
          points = [{x:-w,y:-d},{x:w,y:-d},{x:w,y:d},{x:-w,y:d}];
        } else if (profile.type === 'IFCARBITRARYCLOSEDPROFILEDEF') {
          const ring = doc.ring(profile.args[2]);
          if (ring.length < 4 || ring[0]!.x !== ring.at(-1)!.x || ring[0]!.y !== ring.at(-1)!.y) {
            throw new Error('IFC_REFERENCE_OPEN_PROFILE');
          }
          points = ring.slice(0, -1).map(p => ({ x: p.x * factor, y: p.y * factor }));
        } else throw new Error('IFC_REFERENCE_PROFILE_UNSUPPORTED');
        if (points.length > 4096 || polygonArea({ points }) < 0.001) throw new Error('IFC_REFERENCE_PROFILE_LIMIT');
        vertexBudget -= points.length;
        if (vertexBudget < 0) throw new Error('IFC_REFERENCE_VERTEX_BUDGET');
        const boundary = points.map(p => {
          const q = transformPoint(p, pose);
          return { x: limit(q.x), y: limit(q.y) };
        });
        const height = stepNumber(body.args[3]) * factor;
        if (height <= 0) throw new Error('IFC_REFERENCE_DEPTH_INVALID');
        return { globalId: id, ifcClass, name, boundary, bottomMm: limit(pose.z), topMm: limit(pose.z + height) };
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

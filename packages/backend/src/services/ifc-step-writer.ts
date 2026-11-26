import type { Point, Polygon } from '@ai-floor-planner/core';

export type StepId = `#${number}`;

export function stepString(value: string): string {
  let result = "'";
  for (const unit of value.slice(0, 2048).split('')) {
    const code = unit.charCodeAt(0);
    if (unit === "'") result += "''";
    else if (code >= 32 && code <= 126 && unit !== '\\') result += unit;
    else result += '\\X2\\' + code.toString(16).padStart(4, '0').toUpperCase() + '\\X0\\';
  }
  return result + "'";
}

export function stepReal(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) > 1e15) throw new Error('IFC_REAL_OUT_OF_RANGE');
  const numeric = Number(value.toFixed(8)).toString().toUpperCase();
  if (numeric.includes('.')) return numeric;
  const [mantissa, exponent] = numeric.split('E');
  return mantissa + '.' + (exponent === undefined ? '' : 'E' + exponent);
}

export const stepList = (items: readonly (string | number)[]) => '(' + items.join(',') + ')';

function signedArea(points: readonly Point[]) {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length]!;
    return sum + p.x * q.y - q.x * p.y;
  }, 0) / 2;
}

export function exchangeRing(polygon: Polygon, hole = false): readonly Point[] {
  const points: Point[] = [];
  for (const p of polygon.points) {
    if (![p.x, p.y].every(v => Number.isFinite(v) && Math.abs(v) <= 1e9)) throw new Error('IFC_COORDINATE_OUT_OF_RANGE');
    const previous = points.at(-1);
    if (!previous || previous.x !== p.x || previous.y !== -p.y) points.push({ x: p.x, y: -p.y });
  }
  if (points[0]?.x === points.at(-1)?.x && points[0]?.y === points.at(-1)?.y) points.pop();
  const area = signedArea(points);
  if (points.length < 3 || Math.abs(area) < 0.001) throw new Error('IFC_DEGENERATE_PROFILE');
  return (area > 0) === hole ? points.reverse() : points;
}

export class IfcStepWriter {
  private readonly rows: string[] = [];
  private readonly points = new Map<string, StepId>();

  add(type: string, ...args: string[]): StepId {
    if (this.rows.length >= 150_000) throw new Error('IFC_ENTITY_LIMIT');
    const id = ('#' + (this.rows.length + 1)) as StepId;
    this.rows.push(id + '=' + type + stepList(args) + ';');
    return id;
  }

  point(...coordinates: number[]): StepId {
    const key = stepList(coordinates.map(stepReal));
    const cached = this.points.get(key);
    if (cached) return cached;
    const result = this.add('IFCCARTESIANPOINT', key);
    this.points.set(key, result);
    return result;
  }

  polyline(points: readonly Point[], closed = true): StepId {
    const refs = points.map(p => this.point(p.x, p.y));
    if (closed) refs.push(refs[0]!);
    return this.add('IFCPOLYLINE', stepList(refs));
  }

  placement(z: number, parent: StepId | '$' = '$'): StepId {
    return this.add('IFCLOCALPLACEMENT', parent, this.add('IFCAXIS2PLACEMENT3D', this.point(0, 0, z), '$', '$'));
  }

  encode(): Uint8Array {
    return new TextEncoder().encode([
      'ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('RH Planner IFC4 architectural exchange'),'2;1');",
      "FILE_NAME('rh-planner.ifc','2000-01-01T00:00:00',('RH Planner'),('RH Planner'),'RH Planner','RH Planner','');",
      "FILE_SCHEMA(('IFC4'));", 'ENDSEC;', 'DATA;', ...this.rows, 'ENDSEC;', 'END-ISO-10303-21;', '',
    ].join('\n'));
  }
}

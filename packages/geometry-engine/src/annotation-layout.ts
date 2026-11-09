import type { Point, Polygon, Room } from '@ai-floor-planner/core';

export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}
export function textBoxesOverlap(a: TextBox, b: TextBox): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.width + b.width && Math.abs(a.y - b.y) * 2 < a.height + b.height
  );
}

/** Conservative monospaced envelope; shared by CAD, SVG and PDF. No random jitter. */
export class AnnotationLayout {
  readonly placedTextBoxes: TextBox[] = [];
  place(
    text: string,
    x: number,
    y: number,
    height: number,
    limits?: { width: number; height: number },
    rotated = false,
  ): TextBox {
    const width = rotated ? height * 1.2 : Math.max(1, text.length) * height * 0.7;
    const boxHeight = rotated ? Math.max(1, text.length) * height * 0.7 : height * 1.2;
    const step = Math.max(height * 1.3, boxHeight * 1.1);
    for (let i = 0; i < 10000; i++) {
      const dy = i === 0 ? 0 : Math.ceil(i / 2) * step * (i % 2 ? 1 : -1);
      if (limits && (Math.abs(dy) + height * 0.6 > limits.height / 2 || width > limits.width))
        continue;
      const box = { text, x, y: y + dy, width, height: boxHeight };
      if (!this.placedTextBoxes.some((previous) => textBoxesOverlap(box, previous))) {
        this.placedTextBoxes.push(box);
        return box;
      }
    }
    throw new Error('ANNOTATION_LAYOUT_EXHAUSTED: no collision-free placement');
  }
}

export function polygonCentroid(polygon: Polygon): Point {
  let a = 0,
    x = 0,
    y = 0;
  polygon.points.forEach((p, i) => {
    const q = polygon.points[(i + 1) % polygon.points.length]!;
    const c = p.x * q.y - q.x * p.y;
    a += c;
    x += (p.x + q.x) * c;
    y += (p.y + q.y) * c;
  });
  if (Math.abs(a) < 1e-9) throw new Error('EMPTY_GEOMETRY: polygon has no area');
  return { x: x / (3 * a), y: y / (3 * a) };
}

export function roomAnnotation(room: Room): { lines: string[]; height: number; center: Point } {
  const clearW = Math.max(1, room.width - 230),
    clearD = Math.max(1, room.height - 230);
  let name = room.name
    .replace(/^FLAT_\d+.*?\) /, '')
    .replace(/_/g, ' ')
    .trim()
    .toUpperCase()
    .replace(/^FLAT[ -]*\d+(?:\s*\([^)]*\))?[ -]*/, '');
  const parking = room.type === 'parking' || /car.bay|bike.bay|stall/i.test(room.name);
  if (clearW < 2600 && /utility|balcony/i.test(name))
    name = /utility/i.test(name) ? 'UTILITY' : 'BALCONY';
  const match = room.name.match(/([CB])-?(\d+)/i);
  const lines = parking
    ? [
        `${/bike/i.test(room.name) ? 'B' : (match?.[1]?.toUpperCase() ?? 'C')}-${(match?.[2] ?? '1').padStart(2, '0')}`,
        `${(room.width / 1000).toFixed(1)} x ${(room.height / 1000).toFixed(1)}m`,
      ]
    : [
        name,
        `${Math.round(room.width)} x ${Math.round(room.height)} mm`,
        `${(room.area / 1e6).toFixed(1)} sq m`,
      ];
  const height = Math.min(
    parking ? 80 : 250,
    (clearW * 0.75) / (Math.max(...lines.map((l) => l.length)) * 0.7),
    clearD / 6,
  );
  return { lines, height, center: polygonCentroid(room.boundary) };
}

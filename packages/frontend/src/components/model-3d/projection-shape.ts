import { Shape, Path } from 'three';
import type { Polygon } from '@ai-floor-planner/core';

/** Render-only triangulation input. Canonical polygons stay in millimetres. */
export function makeProjectionShape(boundary: Polygon, cutouts: readonly Polygon[] = []): Shape {
  const shape = new Shape();
  const trace = (path: Path, polygon: Polygon) => {
    polygon.points.forEach((point, index) => {
      if (index === 0) path.moveTo(point.x / 1000, -point.y / 1000);
      else path.lineTo(point.x / 1000, -point.y / 1000);
    });
    path.closePath();
  };
  trace(shape, boundary);
  cutouts.forEach(polygon => {
    const hole = new Path();
    trace(hole, polygon);
    shape.holes.push(hole);
  });
  return shape;
}

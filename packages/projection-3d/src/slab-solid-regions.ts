import type { Polygon } from '@ai-floor-planner/core';
import { polygonArea } from '@ai-floor-planner/geometry-engine';
import polygonClipping, { type MultiPolygon, type Ring } from 'polygon-clipping';

const toRing = (polygon: Polygon): Ring => polygon.points.map(({ x, y }) => [x, y]);
const fromRing = (ring: Ring): Polygon => {
  const first = ring[0];
  const last = ring.at(-1);
  const points = first && last && first[0] === last[0] && first[1] === last[1]
    ? ring.slice(0, -1) : ring;
  return { points: points.map(([x, y]) => ({ x, y })) };
};

export function subtractPlanCutouts(boundary: Polygon, cutouts: readonly Polygon[]): MultiPolygon {
  return cutouts.length
    ? polygonClipping.difference([toRing(boundary)], ...cutouts.map(cutout => [toRing(cutout)]))
    : [[toRing(boundary)]];
}

/** All consumers use the solid regions after clipping and subtracting the cutout union. */
export function slabSolidRegions(boundary: Polygon, cutouts: readonly Polygon[]) {
  return subtractPlanCutouts(boundary, cutouts).map(([outer, ...inner]) => {
    const polygon = fromRing(outer!);
    const holes = inner.map(fromRing);
    const areaMm2 = polygonArea(polygon) - holes.reduce((sum, hole) => sum + polygonArea(hole), 0);
    return { polygon, holes, areaMm2 };
  });
}

export function cutoutOverlapsSlab(boundary: Polygon, cutout: Polygon): boolean {
  return polygonClipping.intersection([toRing(boundary)], [toRing(cutout)]).length > 0;
}

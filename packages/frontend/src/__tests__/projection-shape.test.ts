import { describe, expect, it } from 'vitest';
import { ShapeGeometry } from 'three';
import { rectToPolygon } from '@ai-floor-planner/core';
import { makeProjectionShape } from '../components/model-3d/projection-shape';

describe('architectural floor-plate void triangulation', () => {
  it.each([
    ['internal court', rectToPolygon(2000, 2000, 3500, 2000)],
    ['edge court', rectToPolygon(8500, 3000, 3500, 2000)],
    ['corner court in reduced upper floor', rectToPolygon(8500, 7000, 3500, 2000)],
  ])('does not cap the %s or the aligned stair opening', (_label, court) => {
    const stair = rectToPolygon(5900, 200, 2400, 3800);
    const geometry = new ShapeGeometry(makeProjectionShape(rectToPolygon(0, 0, 12000, 9000), [court, stair]));
    const positions = geometry.getAttribute('position');
    const indices = geometry.getIndex()!;
    let area = 0;
    for (let i = 0; i < indices.count; i += 3) {
      const a = indices.getX(i), b = indices.getX(i + 1), c = indices.getX(i + 2);
      area += Math.abs((positions.getX(b) - positions.getX(a)) * (positions.getY(c) - positions.getY(a))
        - (positions.getX(c) - positions.getX(a)) * (positions.getY(b) - positions.getY(a))) / 2;
    }
    expect(area).toBeCloseTo(108 - 7 - 9.12, 4);
    geometry.dispose();
  });
});

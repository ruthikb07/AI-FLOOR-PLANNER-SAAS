import { describe, expect, it } from 'vitest';
import { createStair, Direction, StairType, rectToPolygon } from '@ai-floor-planner/core';
import { computeStairSolids } from '../stairs';
import { containsPolygon } from '../polygon';

const stair = () => ({ ...createStair({ floorId: 'f', x: 100, y: 100, width: 2000, length: 3000,
  type: StairType.UShaped, riserCount: 18, riserHeight: 3000 / 18, treadDepth: 250, connectsFloors: [0, 1] }), landingWidth: 1000 });

describe('derived architectural stair flights', () => {
  it.each(Object.values(Direction))('fits actual treads and a turn within a %s envelope', direction => {
    const sideways = [Direction.East, Direction.West].includes(direction);
    const value = { ...stair(), direction, ...(sideways ? { width: 3000, length: 2000, boundary: rectToPolygon(100, 100, 3000, 2000) } : {}) };
    const result = computeStairSolids(value, 3000);
    expect(result.issues).toEqual([]);
    expect(result.solids.filter(part => part.kind === 'tread')).toHaveLength(16);
    expect(result.solids.filter(part => part.kind === 'landing')).toHaveLength(1);
    expect(result.solids.every(part => part.bottom < part.top && part.top < 3000)).toBe(true);
    const bounds = { points: [{ x:100,y:100 }, { x:100+value.width,y:100 }, { x:100+value.width,y:100+value.length }, { x:100,y:100+value.length }] };
    expect(result.solids.every(part => containsPolygon(bounds, part.boundary))).toBe(true);
    expect(Math.max(...result.solids.map(part => part.top))).toBeCloseTo(3000 - 3000 / 18);
  });
  it('refuses to squeeze flights into a too-short box', () => {
    const result = computeStairSolids({ ...stair(), length: 2000 }, 3000);
    expect(result.solids).toEqual([]);
    expect(result.issues.join(' ')).toContain('do not fit');
  });
  it('does not stretch risers to silently meet a different floor height', () => {
    expect(computeStairSolids(stair(), 3500).issues.join(' ')).toContain('rise');
  });
  it('does not fabricate spiral stairs or invalid numeric meshes', () => {
    expect(computeStairSolids({ ...stair(), type: StairType.Spiral }).solids).toEqual([]);
    expect(computeStairSolids({ ...stair(), riserCount: Infinity }).solids).toEqual([]);
  });
  it('refuses contradictory canonical boundaries instead of rendering outside them', () => {
    const result = computeStairSolids({ ...stair(), boundary: rectToPolygon(100, 100, 1000, 2000) });
    expect(result.solids).toEqual([]);
    expect(result.issues.join(' ')).toContain('boundary');
  });
});

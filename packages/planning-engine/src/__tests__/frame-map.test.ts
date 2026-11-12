import { describe, it, expect } from 'vitest';
import { frameFor, localEastLandsOn } from '../topology/rect-frame';

describe('frame map round trip', () => {
  it('toLocal and toWorld are exact inverses for all four edges', () => {
    const target = { x: 1000, y: 2000, w: 8000, h: 12000 };
    const probes = [
      { x: 1000, y: 2000, w: 3000, h: 4000 },
      { x: 5000, y: 9000, w: 4000, h: 5000 },
      { x: 1000, y: 2000, w: 8000, h: 12000 },
    ];
    for (const edge of ['EAST', 'WEST', 'NORTH', 'SOUTH'] as const) {
      const f = frameFor(target, edge);
      for (const p of probes) {
        expect(f.toWorld(f.toLocal(p)), `${edge} world->local->world`).toEqual(p);
      }
    }
  });

  /**
   * The slicer assumes the occupant enters from the LOCAL east. If a frame map
   * sends local east to the wrong world edge, a north-entered flat silently
   * receives a south-entered layout: its entrance lands on a party wall and no
   * area or overlap check catches it. This asserts the invariant directly.
   */
  it('maps the local east edge onto the requested world access edge', () => {
    for (const target of [
      { x: 1000, y: 2000, w: 8000, h: 12000 },
      { x: 0, y: 0, w: 15000, h: 6000 },
    ]) {
      for (const edge of ['EAST', 'WEST', 'NORTH', 'SOUTH'] as const) {
        expect(localEastLandsOn(target, edge), `${edge} on ${target.w}x${target.h}`).toBe(edge);
      }
    }
  });

  it('local frame fully covers the target', () => {
    const target = { x: 1000, y: 2000, w: 8000, h: 12000 };
    for (const edge of ['EAST', 'WEST', 'NORTH', 'SOUTH'] as const) {
      const f = frameFor(target, edge);
      expect(f.toWorld({ x: 0, y: 0, w: f.localW, h: f.localH }), `${edge} full-frame cover`).toEqual(target);
    }
  });
});

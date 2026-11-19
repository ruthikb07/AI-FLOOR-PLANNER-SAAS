import { describe, expect, it } from 'vitest';
import { polygonArea } from '../polygon';
import { resolveSurveyBoundary, resolveSurveyTraverse, surveySetbackEnvelope } from '../survey-boundary';

const square = [{ x: 0, y: 0 }, { x: 10_000, y: 0 }, { x: 10_000, y: 10_000 }, { x: 0, y: 10_000 }];
const trapezoid = [{ x: 0, y: 0 }, { x: 12_000, y: 0 }, { x: 10_000, y: 8_000 }, { x: 2_000, y: 8_000 }];
const elbow = [...square.slice(0, 2), { x: 10_000, y: 4_000 }, { x: 4_000, y: 4_000 }, { x: 4_000, y: 10_000 }, square[3]!];

describe('surveyed plot geometry', () => {
  it('preserves polygon and circular metrics through changes in rotation and orientation', () => {
    const expected = 1e8 + Math.PI * 5000 ** 2 / 2;
    for (let angle = 0; angle < Math.PI * 2; angle += .137) {
      const points = square.map(point => ({
        x: 1_000_000 + point.x * Math.cos(angle) - point.y * Math.sin(angle),
        y: 500_000 + point.x * Math.sin(angle) + point.y * Math.cos(angle),
      }));
      const normal = resolveSurveyBoundary(points, [180]);
      const reversed = resolveSurveyBoundary([...points].reverse(), [0, 0, -180]);
      for (const boundary of [normal, reversed]) {
        expect(boundary.issues).toEqual([]);
        expect(boundary.metrics!.areaMm2).toBeCloseTo(expected, 4);
        expect(boundary.metrics!.perimeterMm).toBeCloseTo(30_000 + Math.PI * 5000, 6);
      }
      expect(reversed.metrics!.clockwise).toBe(false);
      expect(reversed.metrics!.centroid.x).toBeCloseTo(normal.metrics!.centroid.x, 6);
      expect(reversed.metrics!.centroid.y).toBeCloseTo(normal.metrics!.centroid.y, 6);
    }
  });

  it('uses curve extrema and integrates the centroid of a mixed boundary', () => {
    const result = resolveSurveyBoundary(square, [180]);
    const metrics = result.metrics!;
    const halfDisc = Math.PI * 5000 ** 2 / 2;
    expect(metrics.bounds).toEqual({ x: 0, y: -5000, width: 10_000, height: 15_000 });
    expect(metrics.centroid.x).toBeCloseTo(5000, 9);
    expect(metrics.centroid.y).toBeCloseTo((1e8 * 5000 - halfDisc * 4 * 5000 / (3 * Math.PI)) / (1e8 + halfDisc), 9);
    expect(metrics.chordAnglesDeg[0]).toBeCloseTo(90);
    expect(metrics.cornerAnglesDeg[0]).toBeCloseTo(180);
  });

  it('rejects crossing straight edges, overlapping edges, circular intersections and nearly duplicate vertices', () => {
    const bowTie = [square[0]!, square[2]!, square[1]!, square[3]!];
    expect(resolveSurveyBoundary(bowTie, []).issues).toContainEqual({ code: 'INTERSECTION', index: 0, other: 2 });
    const low = square.map(point => ({ ...point, y: point.y * .3 }));
    expect(resolveSurveyBoundary(low, [-180]).issues.some(issue => issue.code === 'INTERSECTION')).toBe(true);
    expect(resolveSurveyBoundary([square[0]!, { x: 0, y: 0.00001 }, ...square.slice(1)], []).issues[0]?.code).toBe('INVALID_LENGTH');
    expect(resolveSurveyBoundary(square, [360]).issues).toContainEqual({ code: 'INVALID_ARC', index: 0 });
    const doublesBack = [square[0]!, square[1]!, { x: 1000, y: 0 }, square[3]!];
    expect(resolveSurveyBoundary(doublesBack, []).issues).toContainEqual({ code: 'INTERSECTION', index: 0, other: 1 });
  });

  it('solves measured unequal traverses and exposes real closure error', () => {
    const original = resolveSurveyBoundary(trapezoid, []);
    const lengthsMm = original.edges.map(edge => edge.chordMm);
    const bearingsDeg = original.edges.map(edge => edge.bearingDeg);
    const byBearing = resolveSurveyTraverse({ mode: 'bearings', lengthsMm, bearingsDeg }, []);
    const byAngle = resolveSurveyTraverse({ mode: 'angles', lengthsMm, startingBearingDeg: bearingsDeg[0]!,
      clockwise: true, anglesDeg: original.metrics!.chordAnglesDeg }, []);
    expect(byBearing.metrics!.areaMm2).toBeCloseTo(80e6);
    expect(byAngle.metrics!.areaMm2).toBeCloseTo(80e6);

    const open = resolveSurveyTraverse({ mode: 'bearings', lengthsMm: [lengthsMm[0]! + 123, ...lengthsMm.slice(1)], bearingsDeg }, []);
    expect(open.metrics).toBeUndefined();
    expect(open.closingPoint!.x).toBeCloseTo(123);
    expect(open.issues[0]?.code).toBe('OPEN_TRAVERSE');
    const missing = resolveSurveyTraverse({ mode: 'bearings', lengthsMm, bearingsDeg: [90, null, 270, 0] }, []);
    expect(missing.issues).toContainEqual({ code: 'MISSING_BEARING', index: 1 });
    const inconsistent = resolveSurveyTraverse({ mode: 'angles', lengthsMm, startingBearingDeg: 90,
      clockwise: true, anglesDeg: [91, 90, 90, 90] }, []);
    expect(inconsistent.issues).toContainEqual({ code: 'ANGLE_SUM', degrees: 1 });
  });

  it('clips nonuniform convex setbacks and reports when offsets leave no area', () => {
    const result = resolveSurveyBoundary(square, []);
    expect(polygonArea(surveySetbackEnvelope(result, [1000, 2000, 3000, 500])!)).toBeCloseTo(45e6);
    expect(surveySetbackEnvelope(result, [0, 5001, 0, 5000])!.points).toEqual([]);
    expect(surveySetbackEnvelope(resolveSurveyBoundary(trapezoid, []), [0, 0, 0, 0])).toBeDefined();
    const concave = resolveSurveyBoundary(elbow, []);
    expect(concave.metrics!.areaMm2).toBeCloseTo(64e6);
    expect(concave.metrics!.chordAnglesDeg[3]).toBeCloseTo(270);
    expect(surveySetbackEnvelope(concave, [0, 0, 0, 0, 0, 0])).toBeUndefined();
    expect(surveySetbackEnvelope(resolveSurveyBoundary(square, [180]), [0, 0, 0, 0])).toBeUndefined();
  });
});

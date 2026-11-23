import * as acad from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { serializeSurveyDxf } from '../cad/survey-dxf.js';
import { handleProjectGeneration } from '../api/generation-routes.js';

const survey = {
  points: [{ x: 123.45, y: -678.9 }, { x: 10_123.45, y: -678.9 },
    { x: 10_123.45, y: 9321.1 }, { x: 123.45, y: 9321.1 }],
  sweepsDeg: [180, 0, 0, -45],
  roadEdge: 3,
};

describe('survey boundary CAD export', () => {
  it('writes ordered model-space vertices, signed arcs and the curved closing frontage', () => {
    const doc = new acad.DxfReader(serializeSurveyDxf(survey)).read();
    expect(doc.header?.insUnits).toBe(acad.UnitsType.Millimeters);
    expect(doc.header?.tileModeEnabled).toBe(true);
    const polylines = [...doc.entities!].filter(entity => entity instanceof acad.LwPolyline);
    expect(polylines).toHaveLength(2);
    const [boundary, road] = polylines;
    expect(boundary?.isClosed).toBe(true);
    expect(boundary?.vertices.map(v => [v.location.x, v.location.y])).toEqual(survey.points.map(p => [p.x, -p.y]));
    expect(boundary?.vertices[0]?.bulge).toBeCloseTo(-1, 12);
    expect(boundary?.vertices[3]?.bulge).toBeCloseTo(Math.tan(Math.PI / 16), 12);
    expect(road?.isClosed).toBe(false);
    expect(road?.layer.name).toBe('SITE-ROAD-FRONTAGE');
    expect(road?.vertices.map(v => [v.location.x, v.location.y])).toEqual([[123.45, -9321.1], [123.45, 678.9]]);
    expect(road?.vertices[0]?.bulge).toBe(boundary?.vertices[3]?.bulge);
  });

  it('rejects an intersecting boundary or invalid frontage before writing a drawing', () => {
    const [a, b, c, d] = survey.points;
    expect(() => serializeSurveyDxf({ points: [a, c, b, d], sweepsDeg: [0, 0, 0, 0] })).toThrow(/valid closed/);
    expect(() => serializeSurveyDxf({ ...survey, roadEdge: 4 })).toThrow(/road-facing edge/);
    expect(() => serializeSurveyDxf({ ...survey, sweepsDeg: [null, 0, 0, 0] })).toThrow(/coordinates and signed arc sweeps/);
  });

  it('rejects surveyed sites at the rectangular generation endpoint before calling the planner', async () => {
    const rectangle = { plotWidthMm: 30_000, plotDepthMm: 40_000, flatsPerFloor: 4 };
    const deps = { gemini: null };
    for (const request of [
      { ...rectangle, siteGeometryMode: 'survey' },
      { config: { ...rectangle, plotBoundary: { points: survey.points } } },
      { config: rectangle, surveyBoundary: survey },
    ]) {
      const result = await handleProjectGeneration(request, deps);
      expect(result.status).toBe(422);
      expect(result.json).toMatchObject({ error: { code: 'SURVEY_GENERATION_UNSUPPORTED' } });
    }
  });
});

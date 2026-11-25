import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Direction, exchangeRevision, type Building } from '@ai-floor-planner/core';
import * as acad from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { serializeSurveyDxf } from '../cad/survey-dxf.js';
import { containsSurveyFootprint } from '@ai-floor-planner/geometry-engine';
import { handleProjectGeneration } from '../api/generation-routes.js';
import { CanonicalIfcExchangeAdapter } from '../services/canonical-ifc-adapter.js';

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
      { config: { ...rectangle, irregularPlotBoundary: { sourceFormat: 'survey', polygon: survey } } },
    ]) {
      const result = await handleProjectGeneration(request, deps);
      expect(result.status).toBe(422);
      expect(result.json).toMatchObject({ error: { code: 'SURVEY_GENERATION_UNSUPPORTED' } });
    }
  });
});


const measured = {
  points: [{ x: -250.25, y: 312.75 }, { x: 39749.75, y: 1512.75 },
    { x: 38449.75, y: 34312.75 }, { x: 549.75, y: 33312.75 }],
  sweepsDeg: [0, 0, 0, 0],
  roadEdge: 2,
  edgeSetbacksMm: [1900, 2200, 3200, 2050],
};

const projectConfig = {
  projectId: 'survey-generation-oblique',
  plotWidthMm: 40000, plotDepthMm: 34000, roadWidthMm: 12000,
  floorToFloorHeightMm: 3150, stiltHeightMm: 3150,
  structuralLayoutMode: 'DEFERRED',
  numTypicalFloors: 1, flatsPerFloor: 2, roadAccessSides: [Direction.North],
  units: [1, 2].map(unitIndex => ({ unitIndex, bhkType: '2BHK', hasUtilityBalcony: false })),
};

const concave = {
  points: [{ x: 0, y: 0 }, { x: 37000, y: 0 }, { x: 37000, y: 14500 },
    { x: 30000, y: 14500 }, { x: 30000, y: 34000 }, { x: 0, y: 34000 }],
  sweepsDeg: [0, 0, 0, 0, 0, 0], roadEdge: 4, edgeSetbacksMm: [0, 0, 0, 0, 0, 0],
};

it.each([['oblique', measured], ['concave zero-setback', concave]])(
  'generates from a closed %s survey without substituting its coordinates or frontage', async (profile, geometry) => {
    const result = await handleProjectGeneration({ config: {
      ...projectConfig, plotWidthMm: undefined, plotDepthMm: undefined, surveyBoundary: geometry,
    } }, { gemini: null });
    const payload = result.json as { building: Building; error?: unknown };
    expect(result.status, JSON.stringify(payload.error)).toBe(200);
    const edge = geometry.roadEdge;
    const from = geometry.points[edge]!;
    const to = geometry.points[(edge + 1) % geometry.points.length]!;
    expect(payload.building).toMatchObject({
      site: { plotBoundary: { points: geometry.points }, roadFacing: Direction.South,
        accessPoints: [{ position: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } }] },
      metadata: { irregularPlotBoundary: { roadEdgeIndex: edge, edgeSetbacksMm: geometry.edgeSetbacksMm, sourceFormat: 'survey' } },
    });
    const envelope = payload.building.metadata.irregularPlotBoundary!.buildablePolygon!;
    expect(payload.building.floors.length).toBeGreaterThan(1);
    expect(payload.building.floors.every(floor => containsSurveyFootprint(envelope, floor.boundary))).toBe(true);
    expect(payload.building.site.siteZones?.every(zone => containsSurveyFootprint(payload.building.site.plotBoundary, zone.boundary))).toBe(true);
    const directory = process.env.RH_SURVEY_IFC_EVIDENCE_DIR;
    if (directory) {
      await mkdir(directory, { recursive: true });
      const stem = join(directory, 'survey-' + profile.replaceAll(' ', '-'));
      const artifact = await new CanonicalIfcExchangeAdapter().export(payload.building, exchangeRevision(payload.building));
      await Promise.all([
        writeFile(stem + '.ifc', artifact.bytes),
        writeFile(stem + '.manifest.json', JSON.stringify(artifact.manifest)),
        writeFile(stem + '.building.json', JSON.stringify(payload.building)),
      ]);
    }
  }, 30_000,
);

it.each([
  [{ ...measured, points: [measured.points[0], measured.points[2], measured.points[1], measured.points[3]] }, 'INVALID_SURVEY_BOUNDARY'],
  [{ ...measured, points: [measured.points[0], measured.points[0], measured.points[2], measured.points[3]] }, 'INVALID_SURVEY_BOUNDARY'],
  [{ ...measured, points: [{ x: 1e12, y: 0 }, ...measured.points.slice(1)] }, 'INVALID_SURVEY_BOUNDARY'],
  [{ ...measured, roadEdge: -1 }, 'INVALID_SURVEY_BOUNDARY'],
  [{ ...measured, edgeSetbacksMm: [30000, 30000, 30000, 30000] }, 'SURVEY_ENVELOPE_EMPTY'],
  [{ ...measured, sweepsDeg: [5, 0, 0, 0] }, 'SURVEY_GENERATION_UNSUPPORTED'],
  [{ ...concave, edgeSetbacksMm: [100, 0, 0, 0, 0, 0] }, 'SURVEY_GENERATION_UNSUPPORTED'],
])('explicitly refuses invalid or unsupported measured geometry with %s', async (geometry, code) => {
  const result = await handleProjectGeneration({ config: { ...projectConfig, surveyBoundary: geometry } }, { gemini: null });
  expect(result).toMatchObject({ status: code === 'INVALID_SURVEY_BOUNDARY' ? 400 : 422, json: { error: { code } } });
  expect(result.json).not.toHaveProperty('building');
});

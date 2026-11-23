import * as acad from '@node-projects/acad-ts';
import type { Point } from '@ai-floor-planner/core';
import { resolveSurveyBoundary, type SurveyEdge } from '@ai-floor-planner/geometry-engine';
import { ExportError } from '../services/export-selection.js';

function isPoint(value: unknown): value is Point {
  return !!value && typeof value === 'object' && 'x' in value && 'y' in value &&
    Number.isFinite(value.x) && Number.isFinite(value.y);
}

export function serializeSurveyDxf(body: unknown): Buffer {
  if (!body || typeof body !== 'object' || !('points' in body) || !('sweepsDeg' in body) ||
      !Array.isArray(body.points) || !Array.isArray(body.sweepsDeg) ||
      body.points.length !== body.sweepsDeg.length ||
      !body.points.every(isPoint) || !body.sweepsDeg.every(Number.isFinite)) {
    throw new ExportError('INVALID_SURVEY', 'Provide matching survey coordinates and signed arc sweeps.', 400);
  }
  // The exact intersection audit compares edge pairs. Bound the work done by one HTTP request.
  if (body.points.length > 4096) {
    throw new ExportError('SURVEY_TOO_LARGE', 'A boundary DXF export supports up to 4,096 surveyed edges.', 413);
  }
  const roadIndex = 'roadEdge' in body ? body.roadEdge : null;
  if (roadIndex !== null && (typeof roadIndex !== 'number' || !Number.isInteger(roadIndex) ||
      roadIndex < 0 || roadIndex >= body.points.length)) {
    throw new ExportError('INVALID_SURVEY_FRONTAGE', 'Select a road-facing edge on the survey boundary.', 400);
  }
  const boundary = resolveSurveyBoundary(body.points, body.sweepsDeg);
  if (!boundary.metrics || boundary.issues.length) {
    throw new ExportError('INVALID_SURVEY', 'A valid closed survey boundary is required.', 422);
  }
  const doc = new acad.CadDocument(acad.ACadVersion.AC1032);
  doc.header!.insUnits = acad.UnitsType.Millimeters;
  doc.header!.measurementUnits = acad.MeasurementUnits.Metric;
  doc.header!.tileModeEnabled = true;

  const addPolyline = (edges: readonly SurveyEdge[], closed: boolean, layer?: acad.Layer) => {
    const polyline = new acad.LwPolyline();
    polyline.isClosed = closed;
    if (layer) polyline.layer = layer;
    for (const edge of edges) {
      // CAD Y increases northward, reversing both the survey Y coordinate and the arc direction.
      const vertex = new acad.LwPolylineVertex(new acad.XY(edge.start.x, -edge.start.y));
      if (edge.arc) vertex.bulge = Math.tan(-edge.arc.sweepRad / 4);
      polyline.vertices.push(vertex);
    }
    if (!closed) {
      const { end } = edges.at(-1)!;
      polyline.vertices.push(new acad.LwPolylineVertex(new acad.XY(end.x, -end.y)));
    }
    doc.entities!.add(polyline);
  };

  addPolyline(boundary.edges, true);
  if (roadIndex !== null) {
    const frontage = new acad.Layer('SITE-ROAD-FRONTAGE');
    frontage.color = new acad.Color(32);
    doc.layers!.add(frontage);
    addPolyline([boundary.edges[roadIndex]!], false, frontage);
  }

  const chunks: string[] = [];
  const writer = new acad.DxfWriter({ write: (chunk: string) => { chunks.push(chunk); } }, doc, false);
  writer.configuration.writeOptionalValues = true;
  writer.write();
  return Buffer.from(chunks.join(''), 'utf8');
}

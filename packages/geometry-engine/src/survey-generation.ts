import type { IrregularPlotBoundary, Point, Polygon, Setbacks, SurveyGenerationInput } from '@ai-floor-planner/core';
import { Direction } from '@ai-floor-planner/core';
import polygonClipping, { type Ring } from 'polygon-clipping';
import { isConvex, polygonArea } from './polygon';
import { resolveSurveyBoundary, surveySetbackEnvelope } from './survey-boundary';

const toRing = (polygon: Polygon): Ring => polygon.points.map(({ x, y }) => [x, y]);

export function containsSurveyFootprint(envelope: Polygon, footprint: Polygon): boolean {
  if (envelope.points.length < 3 || footprint.points.length < 3) return false;
  return polygonClipping.difference([toRing(footprint)], [toRing(envelope)]).length === 0;
}

/** Returns disjoint closed regions of a measured site in a rectangular strip. */
export function intersectSurveyStrip(site: Polygon, strip: Polygon): Polygon[] {
  return polygonClipping.intersection([toRing(site)], [toRing(strip)]).map(([outer]) => ({
    points: outer!.slice(0, -1).map(([x, y]) => ({ x, y })),
  }));
}

export class SurveyGenerationError extends Error {
  constructor(readonly code: 'INVALID_SURVEY_BOUNDARY' | 'SURVEY_GENERATION_UNSUPPORTED' | 'SURVEY_ENVELOPE_EMPTY', message: string) {
    super(message);
  }
}

function cardinal(x: number, y: number): Direction {
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? Direction.East : Direction.West)
    : (y > 0 ? Direction.South : Direction.North);
}

export function prepareSurveyGeneration(value: unknown, setbacks?: Setbacks) {
  const input = value as Partial<SurveyGenerationInput> | null;
  const fail = (message: string): never => { throw new SurveyGenerationError('INVALID_SURVEY_BOUNDARY', message); };
  const setbackValid = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10_000_000;
  if (!input || !Array.isArray(input.points) || input.points.length < 3 || input.points.length > 64 ||
    !input.points.every((point: Point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)
      && Math.abs(point.x) <= 10_000_000 && Math.abs(point.y) <= 10_000_000)) {
    return fail('Provide 3 to 64 ordered survey vertices with finite millimetre coordinates in the project coordinate range.');
  }
  const { points, sweepsDeg, roadEdge, edgeSetbacksMm, sourceFileName } = input;
  if (!Number.isInteger(roadEdge) || roadEdge! < 0 || roadEdge! >= points.length) {
    return fail('Select the measured edge that fronts the road.');
  }
  if (!Array.isArray(sweepsDeg) || sweepsDeg.length !== points.length ||
    !sweepsDeg.every(sweep => Number.isFinite(sweep))) return fail('Supply one finite sweep per survey edge.');
  if (!Array.isArray(edgeSetbacksMm) || edgeSetbacksMm.length !== points.length ||
    !edgeSetbacksMm.every(setback => setback === null || setbackValid(setback))) {
    return fail('Supply a nonnegative setback or an explicit default for each edge.');
  }
  if (sourceFileName !== undefined && (typeof sourceFileName !== 'string' || sourceFileName.length > 256)) {
    return fail('The survey source name is invalid.');
  }
  const measured = resolveSurveyBoundary(points, sweepsDeg);
  if (!measured.metrics) return fail('The survey must form a closed, simple polygon with distinct vertices and nondegenerate edges.');
  if (measured.edges.some(edge => edge.arc)) {
    throw new SurveyGenerationError('SURVEY_GENERATION_UNSUPPORTED', 'Architectural generation currently requires straight survey edges. Curved surveys remain available for survey editing and DXF export.');
  }

  const { metrics, edges } = measured;
  const frontage = edges[roadEdge!]!;
  const tangent = (edge: typeof frontage) => ({
    x: (edge.end.x - edge.start.x) / edge.chordMm,
    y: (edge.end.y - edge.start.y) / edge.chordMm,
  });
  const front = tangent(frontage);
  const winding = metrics.clockwise ? 1 : -1;
  const roadFacing = cardinal(winding * front.y, -winding * front.x);
  const offsets = edges.map((edge, index) => {
    const explicit = edgeSetbacksMm[index];
    if (explicit != null) return explicit;
    if (!setbacks) return fail('Enter every edge setback or supply front, rear and side setbacks for the measured site.');
    const direction = tangent(edge);
    const parallel = direction.x * front.x + direction.y * front.y;
    const transverse = direction.x * front.y - direction.y * front.x;
    const fallback = index === roadEdge ? setbacks.front
      : Math.abs(parallel) >= Math.abs(transverse) ? (parallel < 0 ? setbacks.rear : setbacks.front)
        : (transverse * winding > 0 ? setbacks.left : setbacks.right);
    return setbackValid(fallback) ? fallback : fail('Default setbacks must be finite and nonnegative.');
  });
  const polygon = { points: measured.points };
  const convex = isConvex(polygon);
  if (!convex && offsets.some(offset => offset !== 0)) {
    throw new SurveyGenerationError('SURVEY_GENERATION_UNSUPPORTED', 'Concave surveyed sites currently require explicit zero setbacks on all edges. Concave inset envelopes are unsupported.');
  }
  const buildablePolygon = convex ? surveySetbackEnvelope(measured, offsets) : polygon;
  if (!buildablePolygon?.points.length || polygonArea(buildablePolygon) <= 0) {
    throw new SurveyGenerationError('SURVEY_ENVELOPE_EMPTY', 'The measured setbacks leave no buildable site envelope.');
  }
  const boundary: IrregularPlotBoundary = {
    polygon, buildablePolygon, roadEdgeIndex: roadEdge!, edgeSetbacksMm: offsets,
    areaMm2: metrics.areaMm2, perimeterMm: metrics.perimeterMm, sourceFormat: 'survey',
    edgeLengthsMm: edges.map(edge => edge.lengthMm), cornerAnglesDeg: metrics.cornerAnglesDeg,
    ...(sourceFileName ? { sourceFileName } : {}),
  };
  return { boundary, roadFacing, bounds: metrics.bounds };
}

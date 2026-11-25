import type { Point, Setbacks } from '@ai-floor-planner/core';
import { prepareSurveyGeneration, SurveyGenerationError, resolveSurveyBoundary, resolveSurveyTraverse, type SurveyBoundaryResult, type SurveyIssue } from '@ai-floor-planner/geometry-engine';

export type SurveyUnit = 'm' | 'mm' | 'ft' | 'in';
export type SurveyMode = 'coordinates' | 'bearings' | 'angles';
const mmPerUnit = { m: 1000, mm: 1, ft: 304.8, in: 25.4 } satisfies Record<SurveyUnit, number>;

export interface SurveyRow {
  xMm: number | null;
  yMm: number | null;
  lengthMm: number | null;
  bearingDeg: number | null;
  angleDeg: number | null;
  sweepDeg: number | null;
  setbackMm: number | null;
}

export interface SurveyDraft {
  mode: SurveyMode;
  unit: SurveyUnit;
  clockwise: boolean;
  startingBearingDeg: number | null;
  roadEdge: number | null;
  sourceFile?: string;
  rows: readonly SurveyRow[];
}

const templates = {
  rectangle: { title: 'Rectangle / square', vertices: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  trapezoid: { title: 'Trapezoid', vertices: [[0, 0], [1, 0], [.82, 1], [.12, 1]] },
  triangle: { title: 'Triangle', vertices: [[0, 0], [1, 0], [.3, 1]] },
  quad: { title: 'Irregular quadrilateral', vertices: [[0, .12], [.9, 0], [1, .8], [.12, 1]] },
  polygon: { title: 'Irregular polygon', vertices: [[0, .18], [.76, 0], [1, .4], [.84, 1], [.19, .9]] },
  elbow: { title: 'L-shaped / concave', vertices: [[0, 0], [1, 0], [1, .42], [.46, .42], [.46, 1], [0, 1]] },
  chamfer: { title: 'Chamfered frontage', vertices: [[0, 0], [.78, 0], [1, .2], [1, 1], [0, 1]] },
  curve: { title: 'Curved frontage', vertices: [[0, .13], [1, .13], [1, 1], [0, 1]] },
  custom: { title: 'Draw from scratch', vertices: [] },
} as const;

export type SurveyTemplate = keyof typeof templates;
export const surveyTemplates = Object.entries(templates).map(([id, template]) =>
  ({ id: id as SurveyTemplate, title: template.title }));

const rowFromPoint = (point?: Point): SurveyRow => ({
  xMm: point?.x ?? null, yMm: point?.y ?? null, lengthMm: null, bearingDeg: null,
  angleDeg: null, sweepDeg: 0, setbackMm: null,
});

export function createSurveyDraft(template: SurveyTemplate, widthMm: number, depthMm: number, unit: SurveyUnit = 'm'): SurveyDraft {
  const rows = templates[template].vertices.map(([x, y], index) => ({
    ...rowFromPoint({ x: widthMm * x, y: depthMm * y }),
    sweepDeg: template === 'curve' && index === 0 ? 65 : 0,
  }));
  return { mode: 'coordinates', unit, clockwise: true, startingBearingDeg: null,
    roadEdge: template === 'chamfer' ? 1 : template === 'custom' ? null : 0, rows };
}

export function surveyLabel(index: number): string {
  const letter = String.fromCharCode(65 + index % 26);
  return index < 26 ? letter : surveyLabel(Math.floor(index / 26) - 1) + letter;
}

export function surveyEdgeLabel(index: number, count: number): string {
  return `${surveyLabel(index)}–${surveyLabel((index + 1) % count)}`;
}

export function showMeasure(mm: number, unit: SurveyUnit, precision = 3): string {
  return (mm / mmPerUnit[unit]).toLocaleString('en-IN', { maximumFractionDigits: precision });
}

export function inputMeasure(mm: number, unit: SurveyUnit): string {
  return String(Number((mm / mmPerUnit[unit]).toPrecision(15)));
}

export function parseSurveyMeasure(text: string, unit: SurveyUnit): number | null {
  const cleaned = text.trim().replace(/−/g, '-');
  if (!cleaned) return null;
  const fraction = /^([+-]?)(?:(\d+)[ -]+)?(\d+)\s*\/\s*(\d+)$/.exec(cleaned);
  if (fraction) {
    const denominator = Number(fraction[4]);
    const value = (Number(fraction[2] ?? 0) + Number(fraction[3]) / denominator)
      * (fraction[1] === '-' ? -1 : 1) * mmPerUnit[unit];
    return denominator > 0 && Number.isFinite(value) ? value : null;
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cleaned)) return null;
  const value = Number(cleaned) * mmPerUnit[unit];
  return Number.isFinite(value) ? value : null;
}

const rowPoint = (row: SurveyRow): Point | null =>
  row.xMm === null || row.yMm === null ? null : { x: row.xMm, y: row.yMm };

export function resolveSurveyDraft(draft: SurveyDraft): SurveyBoundaryResult {
  const sweeps = draft.rows.map(row => row.sweepDeg);
  const vertices = draft.rows.map(rowPoint);
  if (draft.mode === 'coordinates') {
    const boundary = resolveSurveyBoundary(vertices, sweeps);
    const gap = vertices.indexOf(null);
    return boundary.points.length ? boundary : { ...boundary, points: vertices.slice(0, gap === -1 ? vertices.length : gap) as Point[] };
  }
  const lengthsMm = draft.rows.map(row => row.lengthMm);
  return resolveSurveyTraverse(draft.mode === 'bearings'
    ? { mode: draft.mode, lengthsMm, bearingsDeg: draft.rows.map(row => row.bearingDeg) }
    : { mode: draft.mode, lengthsMm, anglesDeg: draft.rows.map(row => row.angleDeg),
        startingBearingDeg: draft.startingBearingDeg, clockwise: draft.clockwise }, sweeps, vertices[0] ?? undefined);
}

export function switchSurveyMode(draft: SurveyDraft, mode: SurveyMode, boundary: SurveyBoundaryResult): SurveyDraft {
  if (!draft.rows.length) return { ...draft, mode };
  if (!boundary.metrics || mode === draft.mode) return draft;
  return {
    ...draft, mode,
    startingBearingDeg: boundary.edges[0]!.bearingDeg,
    clockwise: boundary.metrics.clockwise,
    rows: draft.rows.map((row, index) => ({
      ...row, xMm: boundary.points[index]!.x, yMm: boundary.points[index]!.y,
      lengthMm: boundary.edges[index]!.chordMm,
      bearingDeg: boundary.edges[index]!.bearingDeg,
      angleDeg: boundary.metrics!.chordAnglesDeg[index]!,
    })),
  };
}

export function addSurveyVertex(draft: SurveyDraft, point?: Point): SurveyDraft {
  const closing = draft.rows.at(-1);
  const rows = closing ? [...draft.rows.slice(0, -1), {
    ...closing, sweepDeg: 0, setbackMm: null, lengthMm: null, bearingDeg: null,
  }] : [];
  return { ...draft, rows: [...rows, rowFromPoint(point)],
    roadEdge: draft.roadEdge === draft.rows.length - 1 ? null : draft.roadEdge };
}

export function removeSurveyVertex(draft: SurveyDraft, index: number): SurveyDraft {
  const previous = (index + draft.rows.length - 1) % draft.rows.length;
  const road = draft.roadEdge;
  return {
    ...draft,
    roadEdge: road === null || road === index || road === previous ? null : road > index ? road - 1 : road,
    rows: draft.rows.flatMap((row, rowIndex) => rowIndex === index ? [] : [rowIndex === previous ?
      { ...row, sweepDeg: 0, lengthMm: null, setbackMm: null, bearingDeg: null } : row]),
  };
}

export function surveyIssueText(issue: SurveyIssue, draft: SurveyDraft): string {
  const edge = (index: number) => surveyEdgeLabel(index, draft.rows.length);
  switch (issue.code) {
    case 'DEGENERATE': return 'Enter at least three distinct vertices enclosing an area.';
    case 'MISSING_VERTEX': return `Enter both coordinates for vertex ${surveyLabel(issue.index)}.`;
    case 'INTERSECTION': return `Edges ${edge(issue.index)} and ${edge(issue.other)} intersect or overlap.`;
    case 'INVALID_LENGTH': return `Edge ${edge(issue.index)} must exceed 0.001 mm.`;
    case 'INVALID_ARC': return `Edge ${edge(issue.index)} needs a signed sweep between 0.01° and under 360° in magnitude.`;
    case 'INVALID_ANGLE': return `Corner ${surveyLabel(issue.index)} needs an interior angle between 0° and 360°.`;
    case 'MISSING_BEARING': return `Enter a bearing for edge ${edge(issue.index)}.`;
    case 'ANGLE_SUM': return `The corner angles differ from the required sum by ${Math.abs(issue.degrees).toFixed(4)}°.`;
    case 'OPEN_TRAVERSE': return `Traverse closure error ${showMeasure(issue.errorMm, draft.unit, 6)} ${draft.unit} (${showMeasure(issue.errorMm, 'mm')} mm). Check the entered lengths and directions.`;
  }
}

export function prepareSurveyDraftGeneration(draft: SurveyDraft | undefined, setbacks: Setbacks) {
  if (!draft) throw new SurveyGenerationError('INVALID_SURVEY_BOUNDARY', 'Enter the exact site boundary in Plot & Type.');
  const resolved = resolveSurveyDraft(draft);
  if (!resolved.metrics) {
    const issue = resolved.issues[0];
    throw new SurveyGenerationError('INVALID_SURVEY_BOUNDARY',
      issue ? surveyIssueText(issue, draft) : 'Enter the exact site boundary in Plot & Type.');
  }
  const input = {
    points: resolved.points,
    sweepsDeg: draft.rows.map(row => row.sweepDeg ?? 0),
    roadEdge: draft.roadEdge ?? -1,
    edgeSetbacksMm: draft.rows.map(row => row.setbackMm),
    ...(draft.sourceFile ? { sourceFileName: draft.sourceFile } : {}),
  };
  return { input, ...prepareSurveyGeneration(input, setbacks) };
}

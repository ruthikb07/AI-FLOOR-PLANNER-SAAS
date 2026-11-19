import { createSurveyDraft, parseSurveyMeasure, type SurveyDraft, type SurveyUnit } from './survey-draft';

const roadLayer = 'SITE-ROAD-FRONTAGE';
const drawingUnits: Partial<Record<number, SurveyUnit>> = { 1: 'in', 2: 'ft', 4: 'mm', 6: 'm' };
type DxfPair = { code: number; value: string };

function polylineVertices(entity: readonly DxfPair[]) {
  const raw: Array<{ x: string; y?: string; bulge?: string }> = [];
  for (const pair of entity) {
    if (pair.code === 10) raw.push({ x: pair.value });
    const vertex = raw.at(-1);
    if (vertex && pair.code === 20) vertex.y = pair.value;
    if (vertex && pair.code === 42) vertex.bulge = pair.value;
  }
  return raw;
}

/** Import a single unambiguous 2D model-space boundary. DXF uses a north-up Y axis. */
export function readSurveyDxf(text: string, sourceUnit: SurveyUnit | undefined, displayUnit: SurveyUnit, sourceFile: string): SurveyDraft {
  const lines = text.trimEnd().split(/\r?\n/);
  const entries: DxfPair[] = [];
  for (let index = 0; index < lines.length; index += 2) {
    const code = lines[index]!.trim();
    const value = lines[index + 1];
    if (!/^\d+$/.test(code) || value === undefined) throw new Error('Use a valid ASCII DXF file.');
    entries.push({ code: Number(code), value: value.trim() });
  }
  const candidates: DxfPair[][] = [];
  const frontage: DxfPair[][] = [];
  let section = '';
  let declaredUnit: SurveyUnit | undefined;
  entries.forEach((entry, index) => {
    if (section === 'HEADER' && entry.code === 9 && entry.value === '$INSUNITS') {
      const unit = entries[index + 1];
      if (unit?.code === 70) declaredUnit = drawingUnits[Number(unit.value)];
    }
    if (entry.code !== 0) return;
    if (entry.value === 'SECTION') section = entries[index + 1]?.value ?? '';
    if (entry.value === 'ENDSEC') section = '';
    if (section !== 'ENTITIES' || entry.value !== 'LWPOLYLINE') return;
    const entity: typeof entries = [];
    for (let i = index + 1; entries[i] && entries[i]!.code !== 0; i++) entity.push(entries[i]!);
    const get = (code: number) => entity.find(pair => pair.code === code)?.value;
    if (Number(get(67) ?? 0) !== 0 || (get(410) !== undefined && get(410) !== 'Model')) return;
    if ((Number(get(70) ?? 0) & 1) !== 0) candidates.push(entity);
    else if (get(8) === roadLayer && Number(get(210) ?? 0) === 0 &&
        Number(get(220) ?? 0) === 0 && Number(get(230) ?? 1) === 1) frontage.push(entity);
  });
  if (candidates.length !== 1) throw new Error('The DXF must contain exactly one closed LWPOLYLINE in model space.');

  const entity = candidates[0]!;
  const get = (code: number) => entity.find(pair => pair.code === code)?.value;
  if (Number(get(210) ?? 0) !== 0 || Number(get(220) ?? 0) !== 0 || Number(get(230) ?? 1) !== 1) {
    throw new Error('Use a DXF boundary in the standard XY drawing plane.');
  }

  const raw = polylineVertices(entity);
  if (raw.length < 3 || (get(90) !== undefined && Number(get(90)) !== raw.length)) {
    throw new Error('The closed DXF boundary has an invalid vertex count.');
  }

  const unit = sourceUnit ?? declaredUnit;
  if (!unit) throw new Error('The drawing has no supported unit declaration. Choose its source units and import it again.');
  const rows = raw.map(({ x, y, bulge }) => {
    const xMm = parseSurveyMeasure(x, unit);
    const yMm = parseSurveyMeasure(y ?? '', unit);
    const b = parseSurveyMeasure(bulge ?? '0', 'mm');
    if (xMm === null || yMm === null || b === null) throw new Error('The DXF boundary contains an invalid coordinate or bulge.');
    return { xMm, yMm: -yMm, sweepDeg: -4 * Math.atan(b) * 180 / Math.PI, lengthMm: null,
      bearingDeg: null, angleDeg: null, setbackMm: null };
  });
  const [start, end, extra] = frontage.length === 1 ? polylineVertices(frontage[0]!) : [];
  let roadEdge = -1;
  if (start && end && !extra) {
    const matches = (a: typeof start, b: typeof start) => a.y !== undefined && b.y !== undefined &&
      Number(a.x) === Number(b.x) && Number(a.y) === Number(b.y);
    roadEdge = raw.findIndex((vertex, index) => matches(start, vertex) && matches(end, raw[(index + 1) % raw.length]!) &&
      Number(start.bulge ?? 0) === Number(vertex.bulge ?? 0));
  }
  return { ...createSurveyDraft('custom', 0, 0, displayUnit), rows, sourceFile, roadEdge: roadEdge < 0 ? null : roadEdge };
}

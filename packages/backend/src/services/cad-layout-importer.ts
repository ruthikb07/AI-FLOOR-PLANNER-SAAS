import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  DaylightLevel,
  Direction,
  DoorType,
  PlotShape,
  PrivacyLevel,
  RoomType,
  SwingDirection,
  WindowType,
  type Building,
  type BuildingMassingShape,
  type Door,
  type Floor,
  type IrregularPlotBoundary,
  type MultiSheetApartmentConfig,
  type Point,
  type Polygon,
  type Room,
  type Setbacks,
  type SourceCadUnderlay,
  type Wall,
  type Window,
} from '@ai-floor-planner/core';
import {
  apartmentFloorOutline,
  fitFloorOpeningsInsideWalls,
  generateApartmentWalls,
  pointInPolygon,
  polygonArea,
  polygonBoundingBox,
  polygonCentroid,
  polygonIntersectionArea,
  polygonSignedArea,
} from '@ai-floor-planner/geometry-engine';
import {
  computeIrregularPlotInscribedEnvelope,
  evaluateArchitecturalComplianceScore,
  solveMultiSheetApartmentProject,
  synthesizeStructuralFraming,
} from '@ai-floor-planner/planning-engine';
import { DEFAULT_ACCORECONSOLE, resolveAccoreConsole } from '../cad/accoreconsole-runner.js';

export type CadUnitCode = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type CadUnitOverride = 'auto' | CadUnitCode;

export class CadImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = 'CadImportError';
  }
}

export interface ParsedCadPolyline {
  readonly layer: string;
  readonly closed: boolean;
  readonly points: readonly Point[];
  readonly isArc?: boolean;
}

export interface ParsedCadText {
  readonly layer: string;
  readonly text: string;
  readonly position: Point;
}

export interface ParsedCadInsert {
  readonly layer: string;
  readonly blockName: string;
  readonly position: Point;
  readonly widthHintMm?: number;
}

export interface CadLayerSummary {
  readonly name: string;
  readonly entityCount: number;
  readonly polylineCount: number;
  readonly textCount: number;
  readonly insertCount: number;
  readonly suggestedRole: 'boundary' | 'wall' | 'door' | 'window' | 'text' | 'ignore' | 'other';
  readonly defaultSelected: boolean;
}

export interface ParsedCadDocument {
  readonly fileName: string;
  readonly format: 'dxf' | 'dwg' | 'pdf';
  readonly detectedUnit: CadUnitCode;
  readonly appliedUnit: CadUnitCode;
  readonly scaleToMm: number;
  readonly boundsMm: { readonly width: number; readonly height: number };
  readonly layers: readonly CadLayerSummary[];
  readonly polylines: readonly ParsedCadPolyline[];
  readonly texts: readonly ParsedCadText[];
  readonly inserts: readonly ParsedCadInsert[];
  readonly warnings: readonly string[];
  readonly pdfDataUrl?: string;
  readonly mmPerPixel?: number;
}

export interface CadImportRequest {
  readonly action: 'preview' | 'import_plot' | 'import_floor_plan';
  readonly fileName: string;
  /** UTF-8 DXF text or base64-encoded bytes (.dxf / .dwg / .pdf) */
  readonly contentBase64?: string;
  readonly contentText?: string;
  readonly unitOverride?: CadUnitOverride;
  readonly selectedLayers?: readonly string[];
  readonly projectName?: string;
  readonly setbacksMm?: Setbacks;
  readonly edgeSetbacksMm?: readonly number[];
  readonly roadEdgeIndex?: number;
  readonly roadWidthMm?: number;
  readonly numTypicalFloors?: number;
  readonly verticalStackType?: 'G_PLUS_N' | 'STILT_PLUS_N';
  readonly floorToFloorHeightMm?: number;
  readonly flatsPerFloor?: 1 | 2 | 3 | 4 | 5 | 6;
  readonly buildingMassingShape?: BuildingMassingShape;
  readonly redevelopmentBase?: boolean;
  readonly generateBuilding?: boolean;
  readonly pdfCalibration?: {
    readonly pointA: Point;
    readonly pointB: Point;
    readonly knownLengthMm: number;
    readonly imageWidthPx?: number;
    readonly imageHeightPx?: number;
    readonly tracedPolygonPx?: readonly Point[];
  };
}

const UNIT_TO_MM: Record<CadUnitCode, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

const INSUNITS_MAP: Record<number, CadUnitCode> = {
  1: 'in',
  2: 'ft',
  4: 'mm',
  5: 'cm',
  6: 'm',
};

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function stripMtextFormatting(raw: string): string {
  return raw
    .replace(/\\P/gi, ' ')
    .replace(/\\~|\\L|\\l|\\O|\\o/g, ' ')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyLayerRole(layer: string): { role: CadLayerSummary['suggestedRole']; defaultSelected: boolean } {
  const n = layer.toLowerCase();
  if (/plot|site|bound|survey|parcel|lot|prop/i.test(n)) return { role: 'boundary', defaultSelected: true };
  if (/wall|struc|col|beam|arch|slab|room|space|floor|part/i.test(n)) return { role: 'wall', defaultSelected: true };
  if (/door|dr\b|opening/i.test(n)) return { role: 'door', defaultSelected: true };
  if (/wind|glaz|fenest|vent|ots|duct|shaft/i.test(n)) return { role: 'window', defaultSelected: true };
  if (/text|label|anno|name|rmname|tag/i.test(n)) return { role: 'text', defaultSelected: true };
  if (/furn|hatch|dim|defpoints|title|border|frame|tree|land|car|veh|grid|center|note/i.test(n)) {
    return { role: 'ignore', defaultSelected: false };
  }
  return { role: 'other', defaultSelected: true };
}

/** Discretize a DXF bulge segment between p1 and p2 into smooth chords. */
function tessellateBulge(p1: Point, p2: Point, bulge: number): Point[] {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-4) return [p2];
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-6) return [p2];
  const sweep = 4 * Math.atan(bulge);
  const radius = Math.abs(chord / (2 * Math.sin(sweep / 2)));
  const sagitta = Math.abs(bulge * chord * 0.5);
  const distToCenter = radius - sagitta;
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  // Perpendicular to chord: left if bulge > 0, right if bulge < 0
  const sign = bulge > 0 ? 1 : -1;
  const dir = Math.abs(sweep) > Math.PI ? -sign : sign;
  const nx = (-dy / chord) * dir;
  const ny = (dx / chord) * dir;
  const cx = mx + nx * distToCenter;
  const cy = my + ny * distToCenter;
  const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
  const steps = Math.max(4, Math.min(20, Math.ceil(Math.abs(sweep) / (Math.PI / 12))));
  const out: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const a = startAngle + (sweep * i) / steps;
    out.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
  }
  out[out.length - 1] = p2;
  return out;
}

function tessellateArc(cx: number, cy: number, radius: number, startDeg: number, endDeg: number): Point[] {
  let sweepDeg = endDeg - startDeg;
  if (sweepDeg <= 0) sweepDeg += 360;
  const steps = Math.max(6, Math.min(36, Math.ceil(sweepDeg / 15)));
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const rad = ((startDeg + (sweepDeg * i) / steps) * Math.PI) / 180;
    pts.push({ x: cx + Math.cos(rad) * radius, y: cy + Math.sin(rad) * radius });
  }
  return pts;
}

/** Resolve local Windows AutoCAD accoreconsole.exe across AutoCAD 2018-2026 installs. */
export function resolveLocalAutoCadConsole(): string | undefined {
  const existing = resolveAccoreConsole();
  if (existing) return existing;
  if (process.platform !== 'win32') return undefined;
  const autodeskDir = path.win32.join('C:\\', 'Program Files', 'Autodesk');
  try {
    if (fs.existsSync(autodeskDir)) {
      const entries = fs.readdirSync(autodeskDir).filter(e => /^AutoCAD/i.test(e)).sort().reverse();
      for (const entry of entries) {
        const candidate = path.win32.join(autodeskDir, entry, 'accoreconsole.exe');
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      }
    }
  } catch {
    // Ignore permission errors scanning Program Files
  }
  return fs.existsSync(DEFAULT_ACCORECONSOLE) ? DEFAULT_ACCORECONSOLE : undefined;
}

/**
 * Convert a local .DWG file to ASCII 2018 .DXF via headless AutoCAD accoreconsole.exe.
 */
export async function convertDwgBufferToDxf(dwgBytes: Buffer, fileName: string): Promise<string> {
  const binary = resolveLocalAutoCadConsole();
  if (!binary) {
    throw new CadImportError(
      'AUTOCAD_NOT_INSTALLED',
      'Local AutoCAD Core Console (accoreconsole.exe) was not found on this machine. Please save or export your drawing as AutoCAD 2018 ASCII .DXF (in AutoCAD, LibreCAD, or QCAD) and upload the .DXF file.',
      422,
    );
  }
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-dwg-import-'));
  const inputDwg = path.join(jobDir, 'input.dwg');
  const outputDxf = path.join(jobDir, 'output.dxf');
  const scriptFile = path.join(jobDir, 'dxfout.scr');
  try {
    fs.writeFileSync(inputDwg, dwgBytes);
    const outEsc = outputDxf.replace(/\\/g, '/');
    const scr = [
      '_FILEDIA',
      '0',
      '_CMDECHO',
      '0',
      '_DXFOUT',
      `"${outEsc}"`,
      'V',
      '2018',
      '16',
      '_QUIT',
      '_Y',
      '',
    ].join('\r\n');
    fs.writeFileSync(scriptFile, scr, 'ascii');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, ['/i', inputDwg, '/s', scriptFile, '/l', 'en-US'], {
        cwd: jobDir,
        windowsHide: true,
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new CadImportError('DWG_CONVERSION_TIMEOUT', `AutoCAD Core Console timed out converting ${fileName}.`, 504));
      }, 90_000);
      child.on('error', err => {
        clearTimeout(timer);
        reject(new CadImportError('DWG_CONVERSION_FAILED', `Failed to launch accoreconsole.exe: ${err.message}`, 500));
      });
      child.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (!fs.existsSync(outputDxf)) {
      throw new CadImportError(
        'DWG_CONVERSION_FAILED',
        `AutoCAD Core Console ran on ${fileName} but did not emit a .DXF file. Please save the file as ASCII .DXF and re-upload.`,
        422,
      );
    }
    return fs.readFileSync(outputDxf, 'utf8');
  } finally {
    try {
      fs.rmSync(jobDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Pure TypeScript ASCII DXF parser supporting HEADER ($INSUNITS) and ENTITIES
 * (LINE, LWPOLYLINE with bulge arcs, POLYLINE/VERTEX, ARC, CIRCLE, INSERT, TEXT, MTEXT).
 */
export function parseDxfContent(
  dxfText: string,
  fileName: string,
  unitOverride: CadUnitOverride = 'auto',
  format: 'dxf' | 'dwg' = 'dxf',
): ParsedCadDocument {
  const lines = dxfText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const pairs: Array<{ code: number; value: string }> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i]!.trim(), 10);
    if (!Number.isFinite(code)) continue;
    pairs.push({ code, value: lines[i + 1]!.trim() });
  }
  if (pairs.length < 4) {
    throw new CadImportError('INVALID_DXF', `File "${fileName}" does not contain valid ASCII DXF group-code pairs.`, 400);
  }

  let insUnitsCode = 0;
  let section = '';
  const rawPolylines: Array<{ layer: string; closed: boolean; points: Point[]; isArc?: boolean }> = [];
  const rawTexts: Array<{ layer: string; text: string; position: Point }> = [];
  const rawInserts: Array<{ layer: string; blockName: string; position: Point; widthHint?: number }> = [];
  const warnings: string[] = [];

  let i = 0;
  while (i < pairs.length) {
    const p = pairs[i]!;
    if (p.code === 0 && p.value === 'SECTION' && i + 1 < pairs.length && pairs[i + 1]!.code === 2) {
      section = pairs[i + 1]!.value.toUpperCase();
      i += 2;
      continue;
    }
    if (p.code === 0 && p.value === 'ENDSEC') {
      section = '';
      i++;
      continue;
    }

    if (section === 'HEADER') {
      if (p.code === 9 && p.value === '$INSUNITS') {
        for (let j = i + 1; j < Math.min(pairs.length, i + 4); j++) {
          if (pairs[j]!.code === 70) {
            insUnitsCode = Number.parseInt(pairs[j]!.value, 10) || 0;
            break;
          }
          if (pairs[j]!.code === 9 || pairs[j]!.code === 0) break;
        }
      }
      i++;
      continue;
    }

    if (section === 'ENTITIES' && p.code === 0) {
      const entityType = p.value.toUpperCase();
      const body: Array<{ code: number; value: string }> = [];
      i++;
      while (i < pairs.length && pairs[i]!.code !== 0) {
        body.push(pairs[i]!);
        i++;
      }
      const getStr = (code: number, fallback = '') => body.find(b => b.code === code)?.value ?? fallback;
      const getNum = (code: number, fallback = 0) => {
        const v = body.find(b => b.code === code)?.value;
        const n = v !== undefined ? Number.parseFloat(v) : Number.NaN;
        return Number.isFinite(n) ? n : fallback;
      };
      const layer = getStr(8, '0') || '0';

      if (entityType === 'LINE') {
        const x1 = getNum(10, Number.NaN);
        const y1 = getNum(20, Number.NaN);
        const x2 = getNum(11, Number.NaN);
        const y2 = getNum(21, Number.NaN);
        if ([x1, y1, x2, y2].every(Number.isFinite) && Math.hypot(x2 - x1, y2 - y1) > 1e-6) {
          rawPolylines.push({ layer, closed: false, points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] });
        }
      } else if (entityType === 'LWPOLYLINE') {
        const flags = Math.trunc(getNum(70, 0));
        const closed = (flags & 1) === 1;
        const verts: Array<{ x: number; y: number; bulge: number }> = [];
        for (const item of body) {
          if (item.code === 10) {
            verts.push({ x: Number.parseFloat(item.value), y: 0, bulge: 0 });
          } else if (item.code === 20 && verts.length > 0) {
            verts[verts.length - 1]!.y = Number.parseFloat(item.value);
          } else if (item.code === 42 && verts.length > 0) {
            verts[verts.length - 1]!.bulge = Number.parseFloat(item.value) || 0;
          }
        }
        const valid = verts.filter(v => Number.isFinite(v.x) && Number.isFinite(v.y));
        if (valid.length >= 2) {
          const pts: Point[] = [{ x: valid[0]!.x, y: valid[0]!.y }];
          let hasArc = false;
          const segCount = closed ? valid.length : valid.length - 1;
          for (let s = 0; s < segCount; s++) {
            const a = valid[s]!;
            const b = valid[(s + 1) % valid.length]!;
            if (Math.abs(a.bulge) > 1e-4) hasArc = true;
            const segPts = tessellateBulge(a, b, a.bulge);
            for (const sp of segPts) pts.push(sp);
          }
          if (closed && pts.length > 2) {
            const first = pts[0]!;
            const last = pts[pts.length - 1]!;
            if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-4) pts.pop();
          }
          rawPolylines.push({ layer, closed, points: pts, isArc: hasArc });
        }
      } else if (entityType === 'POLYLINE') {
        const flags = Math.trunc(getNum(70, 0));
        const closed = (flags & 1) === 1;
        const verts: Array<{ x: number; y: number; bulge: number }> = [];
        while (i < pairs.length) {
          if (pairs[i]!.code === 0 && pairs[i]!.value.toUpperCase() === 'SEQEND') {
            i++;
            break;
          }
          if (pairs[i]!.code === 0 && pairs[i]!.value.toUpperCase() === 'VERTEX') {
            i++;
            let vx = Number.NaN;
            let vy = Number.NaN;
            let bulge = 0;
            while (i < pairs.length && pairs[i]!.code !== 0) {
              if (pairs[i]!.code === 10) vx = Number.parseFloat(pairs[i]!.value);
              else if (pairs[i]!.code === 20) vy = Number.parseFloat(pairs[i]!.value);
              else if (pairs[i]!.code === 42) bulge = Number.parseFloat(pairs[i]!.value) || 0;
              i++;
            }
            if (Number.isFinite(vx) && Number.isFinite(vy)) verts.push({ x: vx, y: vy, bulge });
          } else {
            i++;
          }
        }
        if (verts.length >= 2) {
          const pts: Point[] = [{ x: verts[0]!.x, y: verts[0]!.y }];
          const segCount = closed ? verts.length : verts.length - 1;
          for (let s = 0; s < segCount; s++) {
            const a = verts[s]!;
            const b = verts[(s + 1) % verts.length]!;
            for (const sp of tessellateBulge(a, b, a.bulge)) pts.push(sp);
          }
          if (closed && pts.length > 2) {
            const first = pts[0]!;
            const last = pts[pts.length - 1]!;
            if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-4) pts.pop();
          }
          rawPolylines.push({ layer, closed, points: pts });
        }
      } else if (entityType === 'ARC') {
        const cx = getNum(10, Number.NaN);
        const cy = getNum(20, Number.NaN);
        const r = getNum(40, Number.NaN);
        const a0 = getNum(50, 0);
        const a1 = getNum(51, 90);
        if ([cx, cy, r].every(Number.isFinite) && r > 1e-6) {
          rawPolylines.push({ layer, closed: false, points: tessellateArc(cx, cy, r, a0, a1), isArc: true });
        }
      } else if (entityType === 'CIRCLE') {
        const cx = getNum(10, Number.NaN);
        const cy = getNum(20, Number.NaN);
        const r = getNum(40, Number.NaN);
        if ([cx, cy, r].every(Number.isFinite) && r > 1e-6) {
          const pts = tessellateArc(cx, cy, r, 0, 360);
          pts.pop();
          rawPolylines.push({ layer, closed: true, points: pts, isArc: true });
        }
      } else if (entityType === 'TEXT' || entityType === 'MTEXT') {
        const x = getNum(10, Number.NaN);
        const y = getNum(20, Number.NaN);
        const textChunks = body.filter(b => b.code === 3 || b.code === 1).map(b => b.value);
        const cleaned = stripMtextFormatting(textChunks.join(''));
        if (Number.isFinite(x) && Number.isFinite(y) && cleaned.length > 0) {
          rawTexts.push({ layer, text: cleaned, position: { x, y } });
        }
      } else if (entityType === 'INSERT') {
        const x = getNum(10, Number.NaN);
        const y = getNum(20, Number.NaN);
        const blockName = getStr(2, '');
        const sx = Math.abs(getNum(41, 1));
        if (Number.isFinite(x) && Number.isFinite(y) && blockName) {
          rawInserts.push({ layer, blockName, position: { x, y }, widthHint: sx > 10 ? sx : undefined });
        }
      }
      continue;
    }

    i++;
  }

  if (rawPolylines.length === 0) {
    throw new CadImportError('EMPTY_CAD', `No geometric entities (LINE, LWPOLYLINE, ARC, CIRCLE) were found in "${fileName}".`, 400);
  }

  // Raw extents for unit auto-detection & Y-flip normalization
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const pl of rawPolylines) {
    for (const pt of pl.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  const rawSpan = Math.max(maxX - minX, maxY - minY);
  const headerUnit = INSUNITS_MAP[insUnitsCode];
  let detectedUnit: CadUnitCode;
  if (headerUnit) {
    detectedUnit = headerUnit;
  } else if (rawSpan > 0 && rawSpan < 140) {
    detectedUnit = 'm';
    warnings.push('$INSUNITS not set; inferred Meters from drawing extents.');
  } else if (rawSpan >= 140 && rawSpan < 500) {
    detectedUnit = 'ft';
    warnings.push('$INSUNITS not set; inferred Feet from drawing extents.');
  } else {
    detectedUnit = 'mm';
  }

  const appliedUnit: CadUnitCode = unitOverride !== 'auto' ? unitOverride : detectedUnit;
  const scaleToMm = UNIT_TO_MM[appliedUnit];

  // Normalize to (0, 0) top-left in mm (flipping AutoCAD Y-up -> RH Planner Y-down)
  const normPt = (pt: Point): Point => ({
    x: round2((pt.x - minX) * scaleToMm),
    y: round2((maxY - pt.y) * scaleToMm),
  });

  const polylines: ParsedCadPolyline[] = rawPolylines.map(pl => ({
    layer: pl.layer,
    closed: pl.closed,
    isArc: pl.isArc,
    points: pl.points.map(normPt),
  }));
  const texts: ParsedCadText[] = rawTexts.map(t => ({
    layer: t.layer,
    text: t.text,
    position: normPt(t.position),
  }));
  const inserts: ParsedCadInsert[] = rawInserts.map(ins => ({
    layer: ins.layer,
    blockName: ins.blockName,
    position: normPt(ins.position),
    widthHintMm: ins.widthHint ? round2(ins.widthHint * scaleToMm) : undefined,
  }));

  // Summarize layers
  const layerStats = new Map<string, { pl: number; tx: number; ins: number }>();
  const touch = (name: string) => {
    let s = layerStats.get(name);
    if (!s) {
      s = { pl: 0, tx: 0, ins: 0 };
      layerStats.set(name, s);
    }
    return s;
  };
  for (const pl of polylines) touch(pl.layer).pl++;
  for (const tx of texts) touch(tx.layer).tx++;
  for (const ins of inserts) touch(ins.layer).ins++;

  const layers: CadLayerSummary[] = [...layerStats.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, s]) => {
      const { role, defaultSelected } = classifyLayerRole(name);
      return {
        name,
        entityCount: s.pl + s.tx + s.ins,
        polylineCount: s.pl,
        textCount: s.tx,
        insertCount: s.ins,
        suggestedRole: role,
        defaultSelected,
      };
    });

  return {
    fileName,
    format,
    detectedUnit,
    appliedUnit,
    scaleToMm,
    boundsMm: {
      width: round2((maxX - minX) * scaleToMm),
      height: round2((maxY - minY) * scaleToMm),
    },
    layers,
    polylines,
    texts,
    inserts,
    warnings,
  };
}

export async function parseUploadedCadFile(req: CadImportRequest): Promise<ParsedCadDocument> {
  const ext = path.extname(req.fileName || '').toLowerCase();
  const format: 'dxf' | 'dwg' | 'pdf' = ext === '.dwg' ? 'dwg' : ext === '.pdf' ? 'pdf' : 'dxf';

  if (format === 'pdf') {
    const cal = req.pdfCalibration;
    const dxPx = cal ? cal.pointB.x - cal.pointA.x : 1000;
    const dyPx = cal ? cal.pointB.y - cal.pointA.y : 0;
    const distPx = Math.max(1, Math.hypot(dxPx, dyPx));
    const mmPerPixel = cal && cal.knownLengthMm > 0 ? cal.knownLengthMm / distPx : 25;
    const widthMm = round2((cal?.imageWidthPx ?? 1400) * mmPerPixel);
    const heightMm = round2((cal?.imageHeightPx ?? 1000) * mmPerPixel);
    const pts: Point[] =
      cal?.tracedPolygonPx && cal.tracedPolygonPx.length >= 3
        ? cal.tracedPolygonPx.map(p => ({ x: round2(p.x * mmPerPixel), y: round2(p.y * mmPerPixel) }))
        : [
            { x: 0, y: 0 },
            { x: widthMm, y: 0 },
            { x: widthMm, y: heightMm },
            { x: 0, y: heightMm },
          ];
    const minX = Math.min(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y));
    const normPts = pts.map(p => ({ x: round2(p.x - minX), y: round2(p.y - minY) }));
    const bbox = polygonBoundingBox({ points: normPts });
    const pdfDataUrl = req.contentBase64 ? `data:application/pdf;base64,${req.contentBase64}` : undefined;
    return {
      fileName: req.fileName,
      format: 'pdf',
      detectedUnit: 'mm',
      appliedUnit: 'mm',
      scaleToMm: 1,
      boundsMm: { width: round2(bbox.width), height: round2(bbox.height) },
      layers: [
        {
          name: 'PDF-BOUNDARY',
          entityCount: 1,
          polylineCount: 1,
          textCount: 0,
          insertCount: 0,
          suggestedRole: 'boundary',
          defaultSelected: true,
        },
      ],
      polylines: [{ layer: 'PDF-BOUNDARY', closed: true, points: normPts }],
      texts: [],
      inserts: [],
      warnings: cal
        ? []
        : ['PDF loaded with default 25 mm/px scale. Use 2-point scale calibration to set an exact known wall length.'],
      pdfDataUrl,
      mmPerPixel,
    };
  }

  let dxfText: string;
  if (format === 'dwg') {
    if (!req.contentBase64) {
      throw new CadImportError('MISSING_CONTENT', 'Binary .DWG upload requires base64 content.', 400);
    }
    const dwgBytes = Buffer.from(req.contentBase64, 'base64');
    dxfText = await convertDwgBufferToDxf(dwgBytes, req.fileName);
  } else {
    dxfText =
      req.contentText ??
      (req.contentBase64 ? Buffer.from(req.contentBase64, 'base64').toString('utf8') : '');
    if (!dxfText.trim()) {
      throw new CadImportError('MISSING_CONTENT', 'DXF file content is empty.', 400);
    }
  }

  return parseDxfContent(dxfText, req.fileName, req.unitOverride ?? 'auto', format);
}

// ─── Planar Geometry Reconstruction Helpers ──────────────────────────────────

interface Seg2D {
  readonly a: Point;
  readonly b: Point;
}

function polylinesToSegments(polylines: readonly ParsedCadPolyline[]): Seg2D[] {
  const segs: Seg2D[] = [];
  for (const pl of polylines) {
    const n = pl.points.length;
    if (n < 2) continue;
    const count = pl.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = pl.points[i]!;
      const b = pl.points[(i + 1) % n]!;
      if (Math.hypot(b.x - a.x, b.y - a.y) > 5) {
        segs.push({ a, b });
      }
    }
  }
  return segs;
}

/**
 * Snap endpoints within `snapTolMm` (default 15 mm), split intersecting / T-junction
 * wall segments, and extract all minimal bounded interior faces via DCEL half-edge traversal.
 */
export function extractPlanarRoomPolygons(
  polylines: readonly ParsedCadPolyline[],
  snapTolMm = 15,
): Polygon[] {
  const rawSegs = polylinesToSegments(polylines);
  if (rawSegs.length < 3) return [];

  // 1. Cluster/snap vertices within snapTolMm
  const nodes: Point[] = [];
  const snapNode = (pt: Point): number => {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i]!.x - pt.x, nodes[i]!.y - pt.y) <= snapTolMm) {
        return i;
      }
    }
    nodes.push({ x: round2(pt.x), y: round2(pt.y) });
    return nodes.length - 1;
  };

  const snappedSegs: Array<{ u: number; v: number }> = [];
  for (const seg of rawSegs) {
    const u = snapNode(seg.a);
    const v = snapNode(seg.b);
    if (u !== v) snappedSegs.push({ u, v });
  }

  // 2. Find all proper crossings and T-junctions and collect split parameters per segment
  const splits = new Map<number, number[]>();
  for (let i = 0; i < snappedSegs.length; i++) splits.set(i, [0, 1]);

  for (let i = 0; i < snappedSegs.length; i++) {
    const s1 = snappedSegs[i]!;
    const a1 = nodes[s1.u]!;
    const b1 = nodes[s1.v]!;
    const d1x = b1.x - a1.x;
    const d1y = b1.y - a1.y;
    const len1 = Math.hypot(d1x, d1y);
    if (len1 < 1) continue;

    // T-junction snap: any node lying within snapTolMm of segment interior
    for (let nIdx = 0; nIdx < nodes.length; nIdx++) {
      if (nIdx === s1.u || nIdx === s1.v) continue;
      const p = nodes[nIdx]!;
      const t = ((p.x - a1.x) * d1x + (p.y - a1.y) * d1y) / (len1 * len1);
      if (t > 1e-4 && t < 1 - 1e-4) {
        const px = a1.x + d1x * t;
        const py = a1.y + d1y * t;
        if (Math.hypot(p.x - px, p.y - py) <= snapTolMm) {
          splits.get(i)!.push(t);
        }
      }
    }

    // Proper crossings with later segments
    for (let j = i + 1; j < snappedSegs.length; j++) {
      const s2 = snappedSegs[j]!;
      if (s1.u === s2.u || s1.u === s2.v || s1.v === s2.u || s1.v === s2.v) continue;
      const a2 = nodes[s2.u]!;
      const b2 = nodes[s2.v]!;
      const d2x = b2.x - a2.x;
      const d2y = b2.y - a2.y;
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-6) continue;
      const qx = a2.x - a1.x;
      const qy = a2.y - a1.y;
      const t = (qx * d2y - qy * d2x) / den;
      const u = (qx * d1y - qy * d1x) / den;
      if (t >= -1e-4 && t <= 1 + 1e-4 && u >= -1e-4 && u <= 1 + 1e-4) {
        const ix = a1.x + d1x * t;
        const iy = a1.y + d1y * t;
        snapNode({ x: ix, y: iy });
        if (t > 1e-4 && t < 1 - 1e-4) splits.get(i)!.push(t);
        if (u > 1e-4 && u < 1 - 1e-4) splits.get(j)!.push(u);
      }
    }
  }

  // 3. Build deduplicated undirected planar graph edges
  const edgeSet = new Set<string>();
  const adj = new Map<number, number[]>();
  const addEdge = (u: number, v: number) => {
    if (u === v) return;
    const k = u < v ? `${u}:${v}` : `${v}:${u}`;
    if (edgeSet.has(k)) return;
    edgeSet.add(k);
    if (!adj.has(u)) adj.set(u, []);
    if (!adj.has(v)) adj.set(v, []);
    adj.get(u)!.push(v);
    adj.get(v)!.push(u);
  };

  for (let i = 0; i < snappedSegs.length; i++) {
    const s = snappedSegs[i]!;
    const a = nodes[s.u]!;
    const b = nodes[s.v]!;
    const ts = [...splits.get(i)!].sort((x, y) => x - y);
    const dedupTs: number[] = [];
    for (const t of ts) {
      if (!dedupTs.length || t - dedupTs[dedupTs.length - 1]! > 1e-4) dedupTs.push(t);
    }
    for (let k = 0; k + 1 < dedupTs.length; k++) {
      const t0 = dedupTs[k]!;
      const t1 = dedupTs[k + 1]!;
      const u = t0 === 0 ? s.u : snapNode({ x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 });
      const v = t1 === 1 ? s.v : snapNode({ x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 });
      addEdge(u, v);
    }
  }

  // 4. Sort neighbor lists by outgoing angle for minimal-face half-edge traversal
  const sortedAdj = new Map<number, number[]>();
  for (const [u, nbrs] of adj.entries()) {
    const pu = nodes[u]!;
    const sorted = [...nbrs].sort((a, b) => {
      const pa = nodes[a]!;
      const pb = nodes[b]!;
      return Math.atan2(pa.y - pu.y, pa.x - pu.x) - Math.atan2(pb.y - pu.y, pb.x - pu.x);
    });
    sortedAdj.set(u, sorted);
  }

  const visitedHalf = new Set<string>();
  const faces: Polygon[] = [];

  for (const [u, nbrs] of sortedAdj.entries()) {
    for (const v of nbrs) {
      const startKey = `${u}->${v}`;
      if (visitedHalf.has(startKey)) continue;
      const ring: number[] = [u];
      let currU = u;
      let currV = v;
      let guard = 0;
      let closedLoop = false;
      while (guard < 500) {
        guard++;
        visitedHalf.add(`${currU}->${currV}`);
        if (currV === u) {
          closedLoop = true;
          break;
        }
        ring.push(currV);
        const list = sortedAdj.get(currV);
        if (!list || list.length === 0) break;
        const backIdx = list.indexOf(currU);
        if (backIdx < 0) break;
        // Turn strictly clockwise (next index - 1) to trace minimal positive-area interior faces
        const nextIdx = (backIdx - 1 + list.length) % list.length;
        currU = currV;
        currV = list[nextIdx]!;
      }
      if (!closedLoop || ring.length < 3) continue;
      const poly: Polygon = { points: ring.map(idx => nodes[idx]!) };
      const signed = polygonSignedArea(poly);
      // In Y-down coordinates, positive signed area = minimal interior face; negative = outer unbounded face
      if (signed > 1_200_000) {
        faces.push(poly);
      }
    }
  }

  // Deduplicate and filter out any enclosing outer face if sub-faces exist
  const cleaned: Polygon[] = [];
  const sortedFaces = [...faces].sort((a, b) => polygonArea(a) - polygonArea(b));
  for (const f of sortedFaces) {
    const fArea = polygonArea(f);
    const enclosedOther = cleaned.some(
      other => polygonIntersectionArea(f, other) > polygonArea(other) * 0.85 && fArea > polygonArea(other) * 1.15,
    );
    if (!enclosedOther) cleaned.push(f);
  }
  return cleaned;
}

/** Extract closed outer site boundary polygon and its pre-normalization origin offset. */
function extractOuterPlotPolygonWithOffset(
  doc: ParsedCadDocument,
  selectedLayers?: readonly string[],
): { polygon: Polygon; offset: Point } {
  const allowed = selectedLayers && selectedLayers.length > 0 ? new Set(selectedLayers) : null;
  const filtered = doc.polylines.filter(pl => !allowed || allowed.has(pl.layer));
  if (filtered.length === 0) {
    throw new CadImportError('NO_SELECTED_GEOMETRY', 'No entities remain after layer filtering.', 400);
  }

  // Prefer layers explicitly named PLOT / SITE / BOUNDARY / SURVEY
  const boundaryLayerPolys = filtered.filter(pl => /plot|site|bound|survey|parcel|lot|prop/i.test(pl.layer));
  const pool = boundaryLayerPolys.length > 0 ? boundaryLayerPolys : filtered;

  let bestPoly: Polygon | null = null;
  let bestArea = 0;

  // 1. Direct closed polylines
  for (const pl of pool) {
    if (pl.closed && pl.points.length >= 3) {
      const poly: Polygon = { points: pl.points };
      const a = polygonArea(poly);
      if (a > bestArea) {
        bestArea = a;
        bestPoly = poly;
      }
    }
  }

  // 2. Also check planar faces reconstructed from open line segments (e.g. 4 separate LINE entities)
  const faces = extractPlanarRoomPolygons(pool, 25);
  for (const face of faces) {
    const a = polygonArea(face);
    if (a > bestArea) {
      bestArea = a;
      bestPoly = face;
    }
  }

  // 3. Fallback: outer union loop from snapping all open segments if they form a single polygon
  if (!bestPoly) {
    const allFaces = extractPlanarRoomPolygons(filtered, 25);
    for (const face of allFaces) {
      const a = polygonArea(face);
      if (a > bestArea) {
        bestArea = a;
        bestPoly = face;
      }
    }
  }

  if (!bestPoly || bestArea < 25_000_000) {
    throw new CadImportError(
      'NO_CLOSED_PLOT_BOUNDARY',
      'Could not locate a closed site boundary polygon (>= 25 m²) in the selected CAD layers. Verify units (mm/m/ft) or select the site boundary layer.',
      400,
    );
  }

  // Ensure positive signed area (CCW in Y-down) and origin at (0, 0)
  const pts = polygonSignedArea(bestPoly) < 0 ? [...bestPoly.points].reverse() : [...bestPoly.points];
  const minX = Math.min(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  return {
    polygon: {
      points: pts.map(p => ({ x: round2(p.x - minX), y: round2(p.y - minY) })),
    },
    offset: { x: minX, y: minY },
  };
}

/** Extract closed outer site boundary polygon from DXF polylines (closed or snapped open lines). */
export function extractOuterPlotPolygon(doc: ParsedCadDocument, selectedLayers?: readonly string[]): Polygon {
  return extractOuterPlotPolygonWithOffset(doc, selectedLayers).polygon;
}

function buildSourceCadUnderlay(
  doc: ParsedCadDocument,
  importMode: 'plot_boundary' | 'floor_plan',
  selectedLayers?: readonly string[],
  offset?: Point,
): SourceCadUnderlay {
  const allowed = selectedLayers && selectedLayers.length > 0 ? new Set(selectedLayers) : null;
  const dx = offset?.x ?? 0;
  const dy = offset?.y ?? 0;
  const kept = doc.polylines
    .filter(pl => !allowed || allowed.has(pl.layer))
    .slice(0, 600)
    .map(pl => ({
      layer: pl.layer,
      closed: pl.closed,
      points: pl.points.map(p => ({ x: round2(p.x - dx), y: round2(p.y - dy) })),
    }));
  return {
    fileName: doc.fileName,
    format: doc.format,
    detectedUnit: doc.appliedUnit,
    importMode,
    layers: [...new Set(kept.map(k => k.layer))],
    polylines: kept,
    ...(doc.pdfDataUrl ? { pdfDataUrl: doc.pdfDataUrl } : {}),
    ...(doc.mmPerPixel ? { mmPerPixel: doc.mmPerPixel } : {}),
  };
}

// ─── Mode A: Import Plot Boundary from CAD ───────────────────────────────────

export interface PlotImportResult {
  readonly mode: 'plot_boundary';
  readonly plotBoundary: IrregularPlotBoundary;
  readonly areaM2: number;
  readonly areaSqFt: number;
  readonly perimeterM: number;
  readonly sourceCadUnderlay: SourceCadUnderlay;
  readonly building?: Building;
}

export function importPlotBoundaryFromCad(doc: ParsedCadDocument, req: CadImportRequest): PlotImportResult {
  const { polygon: poly, offset: offsetPt } = extractOuterPlotPolygonWithOffset(doc, req.selectedLayers);
  const pts = poly.points;
  const areaMm2 = round2(polygonArea(poly));
  let perimeterMm = 0;
  const edgeLengthsMm: number[] = [];
  const cornerAnglesDeg: number[] = [];

  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length]!;
    const curr = pts[i]!;
    const next = pts[(i + 1) % pts.length]!;
    const len = Math.hypot(next.x - curr.x, next.y - curr.y);
    edgeLengthsMm.push(round2(len));
    perimeterMm += len;
    const v1x = prev.x - curr.x;
    const v1y = prev.y - curr.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const dot = v1x * v2x + v1y * v2y;
    const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    const angle = m > 1e-6 ? (Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180) / Math.PI : 90;
    cornerAnglesDeg.push(round2(angle));
  }

  const setbacks = req.setbacksMm ?? { front: 4500, rear: 3000, left: 3000, right: 3000 };
  const { buildablePolygon, inscribedEnvelope } = computeIrregularPlotInscribedEnvelope(
    poly,
    req.edgeSetbacksMm,
    setbacks,
    req.roadEdgeIndex,
  );

  const bbox = polygonBoundingBox(poly);
  const plotBoundary: IrregularPlotBoundary = {
    polygon: poly,
    areaMm2,
    perimeterMm: round2(perimeterMm),
    roadEdgeIndex: req.roadEdgeIndex ?? 0,
    edgeSetbacksMm: req.edgeSetbacksMm,
    edgeLengthsMm,
    cornerAnglesDeg,
    buildablePolygon,
    inscribedEnvelopeMm: inscribedEnvelope,
    sourceFileName: doc.fileName,
    sourceFormat: doc.format,
  };

  const sourceCadUnderlay = buildSourceCadUnderlay(doc, 'plot_boundary', req.selectedLayers, offsetPt);

  let building: Building | undefined;
  if (req.generateBuilding !== false) {
    const flatsPerFloor = req.flatsPerFloor ?? (inscribedEnvelope.w >= 20_000 && inscribedEnvelope.h >= 16_000 ? 4 : 2);
    const requestedShape: BuildingMassingShape = req.buildingMassingShape ?? 'IRREGULAR_ANGLED_PLOT';
    const config: MultiSheetApartmentConfig = {
      projectId: `cad-plot-${randomUUID().slice(0, 8)}`,
      projectName: req.projectName || `CAD Site — ${path.parse(doc.fileName).name}`,
      buildingMassingShape: requestedShape,
      lockedMassingShape: req.buildingMassingShape,
      planCategory: 'IRREGULAR_PLOT_CUSTOM',
      structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
      irregularPlotBoundary: plotBoundary,
      plotWidthMm: Math.round(bbox.width),
      plotDepthMm: Math.round(bbox.height),
      roadWidthMm: req.roadWidthMm ?? 12_000,
      roadAccessSides: [Direction.South],
      lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
      jurisdiction: 'pune_pmc',
      verticalStackType: req.verticalStackType ?? 'STILT_PLUS_N',
      numTypicalFloors: Math.max(1, Math.min(20, req.numTypicalFloors ?? 4)),
      floorToFloorHeightMm: req.floorToFloorHeightMm ?? 3150,
      stiltHeightMm: 3150,
      flatsPerFloor,
      units: Array.from({ length: flatsPerFloor }, (_, idx) => ({
        unitIndex: idx + 1,
        bhkType: '2BHK' as const,
        hasUtilityBalcony: true,
      })),
      setbacksMm: setbacks,
      siteAmenities: {
        securityCabin: true,
        landscapeGardenRos: true,
        childrenPlayTotLot: true,
        seniorCitizenSitout: false,
        transformerDgYard: true,
        ugwtPumpRoom: true,
        stpPlant: false,
        owcWasteYard: false,
        rainwaterHarvestingPits: true,
        evChargingBays: true,
      },
      stiltAmenities: {
        grandEntranceLobby: true,
        societyOffice: false,
        fitnessGymnasium: false,
        multipurposeHall: false,
        meterBmsRoom: true,
        driverStaffToilet: true,
      },
      terraceAmenities: {
        stairMumtyHeadroom: true,
        liftMachineRoom: true,
        overheadWaterTank: true,
        solarPvArray: true,
        terraceYogaDeck: false,
      },
      parkingMode: 'STILT_AND_SURFACE',
    };
    const solved = solveMultiSheetApartmentProject(config);
    building = {
      ...solved.building,
      metadata: {
        ...solved.building.metadata,
        irregularPlotBoundary: plotBoundary,
        sourceCadUnderlay,
      },
    };
  }

  return {
    mode: 'plot_boundary',
    plotBoundary,
    areaM2: round2(areaMm2 / 1_000_000),
    areaSqFt: round2((areaMm2 / 1_000_000) * 10.7639),
    perimeterM: round2(perimeterMm / 1000),
    sourceCadUnderlay,
    building,
  };
}

// ─── Mode B: Import Existing Floor Plan Layout from CAD ──────────────────────

function inferRoomTypeFromLabel(label: string): {
  type: RoomType;
  spaceUse: Room['spaceUse'];
  architecturalRole?: Room['architecturalRole'];
  openToSky?: boolean;
} {
  const s = label.toLowerCase();
  if (/\bots\b|duct|open\s*to\s*sky|light\s*well|void/i.test(s)) {
    return { type: RoomType.OTS, spaceUse: 'VOID', architecturalRole: 'OPEN_TO_SKY_VOID', openToSky: true };
  }
  if (/shaft|plumb|elec/i.test(s)) {
    return { type: RoomType.ServiceShaft, spaceUse: 'SERVICE', architecturalRole: 'SERVICE_SHAFT' };
  }
  if (/stair|st\.?\s*case|steps/i.test(s)) {
    return { type: RoomType.Staircase, spaceUse: 'CORE', architecturalRole: 'STAIR_ENCLOSURE' };
  }
  if (/lift|elev/i.test(s)) {
    return { type: RoomType.Lift, spaceUse: 'CORE', architecturalRole: 'LIFT_SHAFT' };
  }
  if (/corridor|lobby|passage|hallway/i.test(s)) {
    return { type: RoomType.Corridor, spaceUse: /common|lobby/i.test(s) ? 'COMMON' : 'UNIT', architecturalRole: 'OPEN_CIRCULATION' };
  }
  if (/foyer|entry|vestibule/i.test(s)) {
    return { type: RoomType.Foyer, spaceUse: 'UNIT', architecturalRole: 'OPEN_CIRCULATION' };
  }
  if (/balc|terrace|sitout|deck|verand/i.test(s)) {
    return { type: RoomType.Balcony, spaceUse: 'OUTDOOR', architecturalRole: 'BALCONY_SLAB' };
  }
  if (/util|dry\s*balc|wash/i.test(s)) {
    return { type: RoomType.Utility, spaceUse: 'UNIT', architecturalRole: 'ENCLOSED_SERVICE' };
  }
  if (/toilet|bath|wc|w\.c\.|powder|lav/i.test(s)) {
    return { type: RoomType.Bathroom, spaceUse: 'UNIT', architecturalRole: 'ENCLOSED_SERVICE' };
  }
  if (/kitchen|kitch|pantry/i.test(s)) {
    return { type: RoomType.Kitchen, spaceUse: 'UNIT', architecturalRole: 'ENCLOSED_SERVICE' };
  }
  if (/dining|din\b/i.test(s)) {
    return { type: RoomType.Dining, spaceUse: 'UNIT', architecturalRole: 'ENCLOSED_HABITABLE' };
  }
  if (/living|hall|lounge|drawing/i.test(s)) {
    return { type: RoomType.Living, spaceUse: 'UNIT', architecturalRole: 'ENCLOSED_HABITABLE' };
  }
  if (/bed|master|m\.?\s*bed|guest|study|kids/i.test(s)) {
    return { type: RoomType.Bedroom, spaceUse: 'UNIT', architecturalRole: 'ENCLOSED_HABITABLE' };
  }
  return { type: RoomType.Bedroom, spaceUse: 'UNIT', architecturalRole: 'ENCLOSED_HABITABLE' };
}

function inferRoomTypeFromGeometry(areaM2: number, aspect: number, idx: number): {
  name: string;
  type: RoomType;
  spaceUse: Room['spaceUse'];
  architecturalRole: Room['architecturalRole'];
} {
  if (areaM2 < 4.5) {
    return { name: `Bathroom ${idx + 1}`, type: RoomType.Bathroom, spaceUse: 'UNIT', architecturalRole: 'ENCLOSED_SERVICE' };
  }
  if (aspect > 2.6 && areaM2 < 10) {
    return { name: `Passage ${idx + 1}`, type: RoomType.Corridor, spaceUse: 'UNIT', architecturalRole: 'OPEN_CIRCULATION' };
  }
  if (areaM2 >= 18) {
    return { name: `Living Hall ${idx + 1}`, type: RoomType.Living, spaceUse: 'UNIT', architecturalRole: 'ENCLOSED_HABITABLE' };
  }
  if (areaM2 < 9.5) {
    return { name: `Kitchen ${idx + 1}`, type: RoomType.Kitchen, spaceUse: 'UNIT', architecturalRole: 'ENCLOSED_SERVICE' };
  }
  return { name: `Bedroom ${idx + 1}`, type: RoomType.Bedroom, spaceUse: 'UNIT', architecturalRole: 'ENCLOSED_HABITABLE' };
}

function pointToSegmentDist(p: Point, a: Point, b: Point): { dist: number; along: number; len: number; closest: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-6) return { dist: Math.hypot(p.x - a.x, p.y - a.y), along: 0, len: 0, closest: a };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len)));
  const closest = { x: a.x + dx * t, y: a.y + dy * t };
  return { dist: Math.hypot(p.x - closest.x, p.y - closest.y), along: t * len, len, closest };
}

export interface FloorPlanImportResult {
  readonly mode: 'floor_plan';
  readonly building: Building;
  readonly extractedRoomCount: number;
  readonly extractedWallCount: number;
  readonly extractedDoorCount: number;
  readonly extractedWindowCount: number;
  readonly structuralColumnsCount: number;
  readonly structuralBeamsCount: number;
  readonly complianceScore: number;
  readonly sourceCadUnderlay: SourceCadUnderlay;
}

export function importFloorPlanLayoutFromCad(doc: ParsedCadDocument, req: CadImportRequest): FloorPlanImportResult {
  const allowed =
    req.selectedLayers && req.selectedLayers.length > 0
      ? new Set(req.selectedLayers)
      : new Set(doc.layers.filter(l => l.defaultSelected).map(l => l.name));

  // Separate wall geometry vs door/window markers
  const wallPolys = doc.polylines.filter(pl => {
    if (!allowed.has(pl.layer)) return false;
    if (/door|wind|glaz|furn|hatch|dim|text|anno/i.test(pl.layer)) return false;
    return true;
  });
  const effectiveWallPolys = wallPolys.length > 0 ? wallPolys : doc.polylines.filter(pl => allowed.has(pl.layer));

  const doorMarkers: Array<{ pos: Point; widthMm: number }> = [];
  const windowMarkers: Array<{ pos: Point; widthMm: number }> = [];

  for (const pl of doc.polylines) {
    if (!allowed.has(pl.layer)) continue;
    const isDoorLayer = /door|dr\b/i.test(pl.layer);
    const isWinLayer = /wind|glaz|vent/i.test(pl.layer);
    if (!isDoorLayer && !isWinLayer) continue;
    const bbox = polygonBoundingBox({ points: pl.points });
    const pos = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
    const span = Math.max(bbox.width, bbox.height);
    if (isDoorLayer) {
      doorMarkers.push({ pos, widthMm: Math.max(750, Math.min(1200, Math.round(span || 900))) });
    } else if (isWinLayer) {
      windowMarkers.push({ pos, widthMm: Math.max(600, Math.min(1800, Math.round(span || 1200))) });
    }
  }
  for (const ins of doc.inserts) {
    if (!allowed.has(ins.layer)) continue;
    const tag = `${ins.layer} ${ins.blockName}`;
    if (/door|dr\b|^d\d/i.test(tag)) {
      doorMarkers.push({ pos: ins.position, widthMm: Math.max(750, Math.min(1200, ins.widthHintMm ?? 900)) });
    } else if (/wind|glaz|^w\d/i.test(tag)) {
      windowMarkers.push({ pos: ins.position, widthMm: Math.max(600, Math.min(1800, ins.widthHintMm ?? 1200)) });
    }
  }

  // Extract room polygons via planar face extraction + closed room polylines
  let roomPolys = extractPlanarRoomPolygons(effectiveWallPolys, 15);
  if (roomPolys.length === 0) {
    // Fallback: direct closed polylines >= 1.2 m²
    const closedCandidates = effectiveWallPolys
      .filter(pl => pl.closed && pl.points.length >= 3)
      .map(pl => ({ points: polygonSignedArea({ points: pl.points }) < 0 ? [...pl.points].reverse() : [...pl.points] }))
      .filter(poly => polygonArea(poly) >= 1_200_000)
      .sort((a, b) => polygonArea(a) - polygonArea(b));
    for (const cand of closedCandidates) {
      const overlaps = roomPolys.some(other => polygonIntersectionArea(cand, other) > polygonArea(other) * 0.5);
      if (!overlaps) roomPolys.push(cand);
    }
  }

  if (roomPolys.length === 0) {
    throw new CadImportError(
      'NO_CLOSED_ROOMS',
      'No closed room loops (>= 1.2 m²) could be reconstructed from the selected CAD layers. Ensure wall segments meet within 15 mm and check drawing units (mm/m/ft).',
      400,
    );
  }

  // Normalize all room coordinates cleanly into positive setback space (3000 mm plot margin)
  const allPts = roomPolys.flatMap(p => p.points);
  const rMinX = Math.min(...allPts.map(p => p.x));
  const rMinY = Math.min(...allPts.map(p => p.y));
  const rMaxX = Math.max(...allPts.map(p => p.x));
  const rMaxY = Math.max(...allPts.map(p => p.y));
  const marginX = 3000;
  const marginY = 3000;
  const shiftPt = (p: Point): Point => ({
    x: round2(p.x - rMinX + marginX),
    y: round2(p.y - rMinY + marginY),
  });
  roomPolys = roomPolys.map(poly => ({ points: poly.points.map(shiftPt) }));

  const shiftedTexts = doc.texts.map(t => ({ ...t, position: shiftPt(t.position) }));
  const shiftedDoorMarkers = doorMarkers.map(m => ({ ...m, pos: shiftPt(m.pos) }));
  const shiftedWinMarkers = windowMarkers.map(m => ({ ...m, pos: shiftPt(m.pos) }));

  const projectId = `cad-plan-${randomUUID().slice(0, 8)}`;
  const buildingId = `bldg-${projectId}`;
  const projectName = req.projectName || `Imported CAD — ${path.parse(doc.fileName).name}`;
  const floorHeight = req.floorToFloorHeightMm ?? 3150;
  const numTypicalFloors = Math.max(1, Math.min(20, req.numTypicalFloors ?? 4));
  const stackType = req.verticalStackType ?? (req.redevelopmentBase ? 'STILT_PLUS_N' : 'G_PLUS_N');

  // Build template floor rooms from extracted polygons + matched TEXT/MTEXT labels
  const usedTextIdx = new Set<number>();
  const baseFloorId = stackType === 'STILT_PLUS_N' ? 'floor_typical_01' : 'floor_level_00';
  const unitSet = new Set<string>();

  const templateRooms: Room[] = roomPolys.map((poly, idx) => {
    const bbox = polygonBoundingBox(poly);
    const area = round2(polygonArea(poly));
    const areaM2 = area / 1_000_000;
    const aspect = Math.max(bbox.width, bbox.height) / Math.max(1, Math.min(bbox.width, bbox.height));
    const centroid = polygonCentroid(poly);

    // Find text inside polygon first, else nearest within 400 mm of centroid
    let matchIdx = shiftedTexts.findIndex((t, ti) => !usedTextIdx.has(ti) && pointInPolygon(t.position, poly));
    if (matchIdx < 0) {
      let bestDist = 400;
      shiftedTexts.forEach((t, ti) => {
        if (usedTextIdx.has(ti)) return;
        const d = Math.hypot(t.position.x - centroid.x, t.position.y - centroid.y);
        if (d < bestDist) {
          bestDist = d;
          matchIdx = ti;
        }
      });
    }

    let name: string;
    let type: RoomType;
    let spaceUse: Room['spaceUse'];
    let architecturalRole: Room['architecturalRole'];
    let openToSky = false;

    if (matchIdx >= 0) {
      usedTextIdx.add(matchIdx);
      const label = shiftedTexts[matchIdx]!.text;
      const inferred = inferRoomTypeFromLabel(label);
      name = label;
      type = inferred.type;
      spaceUse = inferred.spaceUse;
      architecturalRole = inferred.architecturalRole;
      openToSky = Boolean(inferred.openToSky);
    } else {
      const fallback = inferRoomTypeFromGeometry(areaM2, aspect, idx);
      name = fallback.name;
      type = fallback.type;
      spaceUse = fallback.spaceUse;
      architecturalRole = fallback.architecturalRole;
    }

    // Detect unitId from label (e.g. "Flat 102 Bedroom" -> flat_02) or default flat_01 for unit rooms
    let unitId: string | undefined;
    if (spaceUse === 'UNIT' || spaceUse === 'OUTDOOR') {
      const m = name.match(/(?:flat|unit|apt)[\s#-]*(\d+|[a-z])\b/i);
      if (m) {
        const raw = m[1]!;
        const num = Number.parseInt(raw, 10);
        const unitNum = Number.isFinite(num) ? (num >= 100 ? num % 100 : num) : raw.toLowerCase().charCodeAt(0) - 96;
        unitId = `flat_${String(Math.max(1, unitNum)).padStart(2, '0')}`;
      } else {
        unitId = 'flat_01';
      }
      unitSet.add(unitId);
    }

    const tags = ['imported:cad'];
    if (type === RoomType.OTS) tags.push('shaft:ots', 'shaft:interflat');
    if (type === RoomType.Staircase) tags.push('core:stair');
    if (type === RoomType.Lift) tags.push('core:lift');

    return {
      id: `${baseFloorId}::cad-room:${idx + 1}`,
      floorId: baseFloorId,
      type,
      name,
      x: round2(bbox.x),
      y: round2(bbox.y),
      width: round2(bbox.width),
      height: round2(bbox.height),
      rotation: 0,
      boundary: poly,
      area,
      priority: 1,
      adjacencyRequirements: [],
      daylightRequirement: DaylightLevel.Medium,
      privacyRequirement: type === RoomType.Bedroom || type === RoomType.Bathroom ? PrivacyLevel.High : PrivacyLevel.Low,
      ventilationRequired: type !== RoomType.Corridor && type !== RoomType.Foyer,
      isFixed: false,
      unitId,
      spaceUse,
      architecturalRole,
      openToSky,
      tags,
    };
  });

  // Compute outer boundary & canonical walls
  const provisionalBbox: Polygon = {
    points: [
      { x: marginX, y: marginY },
      { x: round2(rMaxX - rMinX + marginX), y: marginY },
      { x: round2(rMaxX - rMinX + marginX), y: round2(rMaxY - rMinY + marginY) },
      { x: marginX, y: round2(rMaxY - rMinY + marginY) },
    ],
  };
  const rawWalls = generateApartmentWalls(templateRooms, baseFloorId, provisionalBbox, true);
  let floorBoundary: Polygon;
  try {
    floorBoundary = apartmentFloorOutline(rawWalls);
  } catch {
    floorBoundary = provisionalBbox;
  }

  // Place doors from CAD markers + ensure internal room connectivity
  const doors: Door[] = [];
  const usedDoorWalls = new Set<string>();
  for (let mIdx = 0; mIdx < shiftedDoorMarkers.length; mIdx++) {
    const marker = shiftedDoorMarkers[mIdx]!;
    let bestWall: Wall | undefined;
    let bestHit: ReturnType<typeof pointToSegmentDist> | undefined;
    for (const w of rawWalls) {
      if (w.boundaryRole === 'PARAPET' || w.boundaryRole === 'OPEN_BOUNDARY') continue;
      const hit = pointToSegmentDist(marker.pos, w.startPoint, w.endPoint);
      if (hit.len >= 650 && hit.dist <= 450 && (!bestHit || hit.dist < bestHit.dist)) {
        bestWall = w;
        bestHit = hit;
      }
    }
    if (!bestWall || !bestHit || usedDoorWalls.has(bestWall.id)) continue;
    const width = Math.min(marker.widthMm, Math.floor(bestHit.len - 200));
    if (width < 650) continue;
    const connectsRooms: readonly [string, string] =
      bestWall.roomIds.length >= 2
        ? [bestWall.roomIds[0]!, bestWall.roomIds[1]!]
        : [bestWall.roomIds[0]!, '__outside__'];
    usedDoorWalls.add(bestWall.id);
    doors.push({
      id: `${baseFloorId}::cad-door:${mIdx + 1}`,
      floorId: baseFloorId,
      wallId: bestWall.id,
      position: bestHit.closest,
      width,
      height: 2100,
      type: DoorType.Single,
      swingDirection: SwingDirection.Inward,
      connectsRooms,
      openingGeometryVersion: 1,
      positionReference: 'CENTER',
    });
  }

  // Auto-connect adjacent rooms that don't yet have a door so circulation & 3D openings work cleanly
  const connectedPairs = new Set(doors.map(d => [...d.connectsRooms].sort().join('|')));
  for (const w of rawWalls) {
    if (w.roomIds.length !== 2 || usedDoorWalls.has(w.id)) continue;
    if (w.boundaryRole === 'PARAPET' || w.boundaryRole === 'OPEN_BOUNDARY') continue;
    const rA = templateRooms.find(r => r.id === w.roomIds[0]);
    const rB = templateRooms.find(r => r.id === w.roomIds[1]);
    if (!rA || !rB) continue;
    if (rA.openToSky || rB.openToSky || rA.type === RoomType.ServiceShaft || rB.type === RoomType.ServiceShaft) continue;
    if (rA.unitId && rB.unitId && rA.unitId !== rB.unitId) continue;
    const pairKey = [rA.id, rB.id].sort().join('|');
    if (connectedPairs.has(pairKey)) continue;
    const len = Math.hypot(w.endPoint.x - w.startPoint.x, w.endPoint.y - w.startPoint.y);
    if (len < 950) continue;
    const isBath = rA.type === RoomType.Bathroom || rB.type === RoomType.Bathroom || rA.type === RoomType.Utility || rB.type === RoomType.Utility;
    const isEntry = !rA.unitId || !rB.unitId;
    const doorW = Math.min(isEntry ? 1050 : isBath ? 750 : 900, Math.floor(len - 200));
    if (doorW < 700) continue;
    connectedPairs.add(pairKey);
    usedDoorWalls.add(w.id);
    doors.push({
      id: `${baseFloorId}::cad-auto-door:${doors.length + 1}`,
      floorId: baseFloorId,
      wallId: w.id,
      position: { x: (w.startPoint.x + w.endPoint.x) / 2, y: (w.startPoint.y + w.endPoint.y) / 2 },
      width: doorW,
      height: 2100,
      type: DoorType.Single,
      swingDirection: SwingDirection.Inward,
      connectsRooms: [rA.id, rB.id],
      openingGeometryVersion: 1,
      positionReference: 'CENTER',
    });
  }

  // Place windows from CAD markers + ensure exterior habitable rooms have operable windows
  const windows: Window[] = [];
  const roomsWithWindows = new Set<string>();
  const usedWinWalls = new Set<string>();

  for (let wIdx = 0; wIdx < shiftedWinMarkers.length; wIdx++) {
    const marker = shiftedWinMarkers[wIdx]!;
    let bestWall: Wall | undefined;
    let bestHit: ReturnType<typeof pointToSegmentDist> | undefined;
    for (const w of rawWalls) {
      if (w.wallUse !== 'EXTERNAL' && w.wallUse !== 'SHAFT') continue;
      if (w.boundaryRole === 'PARAPET' || w.boundaryRole === 'OPEN_BOUNDARY') continue;
      const hit = pointToSegmentDist(marker.pos, w.startPoint, w.endPoint);
      if (hit.len >= 650 && hit.dist <= 450 && (!bestHit || hit.dist < bestHit.dist)) {
        bestWall = w;
        bestHit = hit;
      }
    }
    if (!bestWall || !bestHit || usedDoorWalls.has(bestWall.id)) continue;
    const ownerRoom = templateRooms.find(r => bestWall!.roomIds.includes(r.id) && !r.openToSky);
    if (!ownerRoom) continue;
    const width = Math.min(marker.widthMm, Math.floor(bestHit.len - 200));
    if (width < 450) continue;
    usedWinWalls.add(bestWall.id);
    roomsWithWindows.add(ownerRoom.id);
    windows.push({
      id: `${baseFloorId}::cad-win:${wIdx + 1}`,
      floorId: baseFloorId,
      wallId: bestWall.id,
      roomId: ownerRoom.id,
      position: bestHit.closest,
      width,
      height: ownerRoom.type === RoomType.Bathroom ? 650 : 1500,
      sillHeight: ownerRoom.type === RoomType.Bathroom ? 1500 : 900,
      type: ownerRoom.type === RoomType.Bathroom ? WindowType.Ventilator : WindowType.Sliding,
      openingGeometryVersion: 1,
      positionReference: 'CENTER',
    });
  }

  for (const room of templateRooms) {
    if (roomsWithWindows.has(room.id) || room.openToSky || room.spaceUse === 'OUTDOOR' || room.type === RoomType.ServiceShaft) {
      continue;
    }
    const extWall = rawWalls
      .filter(
        w =>
          w.roomIds.includes(room.id) &&
          (w.wallUse === 'EXTERNAL' || w.wallUse === 'SHAFT') &&
          w.boundaryRole !== 'PARAPET' &&
          w.boundaryRole !== 'OPEN_BOUNDARY' &&
          !usedDoorWalls.has(w.id) &&
          !usedWinWalls.has(w.id),
      )
      .sort(
        (a, b) =>
          Math.hypot(b.endPoint.x - b.startPoint.x, b.endPoint.y - b.startPoint.y) -
          Math.hypot(a.endPoint.x - a.startPoint.x, a.endPoint.y - a.startPoint.y),
      )[0];
    if (!extWall) continue;
    const len = Math.hypot(extWall.endPoint.x - extWall.startPoint.x, extWall.endPoint.y - extWall.startPoint.y);
    if (len < 700) continue;
    const isBath = room.type === RoomType.Bathroom;
    const width = Math.min(isBath ? 600 : 1500, Math.floor(len - 200));
    if (width < 450) continue;
    usedWinWalls.add(extWall.id);
    roomsWithWindows.add(room.id);
    windows.push({
      id: `${baseFloorId}::cad-auto-win:${windows.length + 1}`,
      floorId: baseFloorId,
      wallId: extWall.id,
      roomId: room.id,
      position: { x: (extWall.startPoint.x + extWall.endPoint.x) / 2, y: (extWall.startPoint.y + extWall.endPoint.y) / 2 },
      width,
      height: isBath ? 650 : 1500,
      sillHeight: isBath ? 1500 : 900,
      type: isBath ? WindowType.Ventilator : WindowType.Sliding,
      openingGeometryVersion: 1,
      positionReference: 'CENTER',
    });
  }

  // Build apartment unit records
  const unitIds = [...unitSet].sort();
  const apartmentUnits = unitIds.map((uid, uIdx) => {
    const uRooms = templateRooms.filter(r => r.unitId === uid);
    const bedCount = uRooms.filter(r => r.type === RoomType.Bedroom).length;
    const bhkType = (bedCount >= 4 ? '4BHK' : bedCount === 3 ? '3BHK' : bedCount === 1 ? '1BHK' : '2BHK') as
      | '1BHK'
      | '2BHK'
      | '3BHK'
      | '4BHK';
    let uBoundary = floorBoundary;
    try {
      const uWalls = generateApartmentWalls(uRooms, baseFloorId, floorBoundary, true);
      uBoundary = apartmentFloorOutline(uWalls);
    } catch {
      uBoundary = floorBoundary;
    }
    return {
      id: uid,
      unitType: bhkType,
      unitIndex: uIdx + 1,
      flatNumber: `${101 + uIdx}`,
      bhkType,
      name: `Flat ${101 + uIdx}`,
      boundary: uBoundary,
    };
  });

  // Strict opening interval clamping guarantees ZERO INVALID_OPENING_INTERVAL crashes in 3D
  const baseFloor: Floor = fitFloorOpeningsInsideWalls({
    id: baseFloorId,
    buildingId,
    level: stackType === 'STILT_PLUS_N' ? 1 : 0,
    elevationMm: stackType === 'STILT_PLUS_N' ? floorHeight : 0,
    name: stackType === 'STILT_PLUS_N' ? '1st Floor Plan (Imported CAD)' : 'Ground Floor Plan (Imported CAD)',
    floorUse: 'RESIDENTIAL',
    floorHeight,
    boundary: floorBoundary,
    rooms: templateRooms,
    walls: rawWalls,
    doors,
    windows,
    stairs: [],
    columns: [],
    apartmentUnits: apartmentUnits.map(u => ({ id: u.id, boundary: u.boundary, unitType: u.unitType })),
  });

  // Clone template floor across G+1 .. G+N storeys (and optional Stilt parking base)
  const floors: Floor[] = [];
  if (stackType === 'STILT_PLUS_N') {
    const stiltId = 'floor_stilt_00';
    const stiltRoom: Room = {
      id: `${stiltId}::stilt_parking`,
      floorId: stiltId,
      type: RoomType.Parking,
      name: 'Stilt Parking & Entrance Lobby',
      x: marginX,
      y: marginY,
      width: round2(rMaxX - rMinX),
      height: round2(rMaxY - rMinY),
      rotation: 0,
      boundary: floorBoundary,
      area: round2(polygonArea(floorBoundary)),
      priority: 1,
      adjacencyRequirements: [],
      daylightRequirement: DaylightLevel.Low,
      privacyRequirement: PrivacyLevel.None,
      ventilationRequired: true,
      isFixed: false,
      spaceUse: 'COMMON',
      architecturalRole: 'PARKING_AREA',
      tags: ['stilt', 'imported:cad'],
    };
    const stiltWalls = generateApartmentWalls([stiltRoom], stiltId, floorBoundary, true);
    floors.push({
      id: stiltId,
      buildingId,
      level: 0,
      elevationMm: 0,
      name: 'Stilt Parking Level (Imported CAD Base)',
      floorUse: 'STILT_PARKING',
      floorHeight,
      boundary: floorBoundary,
      rooms: [stiltRoom],
      walls: stiltWalls,
      doors: [],
      windows: [],
      stairs: [],
      columns: [],
    });
  }

  for (let idx = 0; idx < numTypicalFloors; idx++) {
    const level = stackType === 'STILT_PLUS_N' ? idx + 1 : idx;
    const fId = stackType === 'STILT_PLUS_N' ? `floor_typical_${String(idx + 1).padStart(2, '0')}` : `floor_level_${String(idx).padStart(2, '0')}`;
    const remapId = (val: string) => val.replace(baseFloorId, fId);
    const ordinal = level === 0 ? 'Ground' : level === 1 ? '1st' : level === 2 ? '2nd' : level === 3 ? '3rd' : `${level}th`;
    const cloned: Floor = {
      ...baseFloor,
      id: fId,
      level,
      elevationMm: level * floorHeight,
      name: `${ordinal} Floor Plan (Imported CAD)`,
      rooms: baseFloor.rooms.map(r => ({ ...r, id: remapId(r.id), floorId: fId })),
      walls: baseFloor.walls.map(w => ({
        ...w,
        id: remapId(w.id),
        floorId: fId,
        roomIds: w.roomIds.map(remapId),
        leftRoomId: w.leftRoomId ? remapId(w.leftRoomId) : undefined,
        rightRoomId: w.rightRoomId ? remapId(w.rightRoomId) : undefined,
      })),
      doors: baseFloor.doors.map(d => ({
        ...d,
        id: remapId(d.id),
        floorId: fId,
        wallId: remapId(d.wallId),
        connectsRooms: [
          remapId(d.connectsRooms[0]),
          d.connectsRooms[1].startsWith('__') ? d.connectsRooms[1] : remapId(d.connectsRooms[1]),
        ] as const,
      })),
      windows: baseFloor.windows.map(w => ({
        ...w,
        id: remapId(w.id),
        floorId: fId,
        wallId: remapId(w.wallId),
        roomId: remapId(w.roomId),
      })),
      apartmentUnits: baseFloor.apartmentUnits?.map(u => ({ ...u })),
    };
    floors.push(fitFloorOpeningsInsideWalls(cloned));
  }

  const plotW = round2(rMaxX - rMinX + 2 * marginX);
  const plotD = round2(rMaxY - rMinY + 2 * marginY);
  const plotBoundary: Polygon = {
    points: [
      { x: 0, y: 0 },
      { x: plotW, y: 0 },
      { x: plotW, y: plotD },
      { x: 0, y: plotD },
    ],
  };

  const sourceCadUnderlay = buildSourceCadUnderlay(doc, 'floor_plan', req.selectedLayers, {
    x: rMinX - marginX,
    y: rMinY - marginY,
  });

  const now = new Date().toISOString();
  const rawBuilding: Building = {
    id: buildingId,
    projectId,
    name: projectName,
    site: {
      id: `${projectId}_site`,
      plotBoundary,
      plotWidth: plotW,
      plotDepth: plotD,
      plotArea: round2(plotW * plotD),
      plotShape: PlotShape.Rectangular,
      orientation: 0,
      setbacks: { front: marginY, rear: marginY, left: marginX, right: marginX },
      accessPoints: [{ id: 'acc_main', position: { x: plotW / 2, y: plotD }, width: 4500, direction: Direction.South }],
      roadFacing: Direction.South,
      roadWidth: req.roadWidthMm ?? 12_000,
    },
    floors,
    metadata: {
      projectId,
      description: `Imported directly from ${doc.fileName} (${doc.appliedUnit}, ${templateRooms.length} rooms × ${numTypicalFloors} residential floors).`,
      tags: ['apartment', 'imported_cad_layout', 'canonical_model', 'STRUCTURAL_FRAMING_PRELIMINARY'],
      sourceCadUnderlay,
      generationBrief: {
        source: 'DETERMINISTIC',
        units: apartmentUnits.map(u => ({ unitIndex: u.unitIndex, bhkType: u.bhkType })),
        buildingMassingShape: 'IMPORTED_CAD_LAYOUT',
        requestedMassingShape: 'IMPORTED_CAD_LAYOUT',
        planCategory: req.redevelopmentBase ? 'HIGH_RISE_APARTMENT' : 'IRREGULAR_PLOT_CUSTOM',
        includeWindowChajjas: true,
      },
    },
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  // Synthesize complete RCC column/beam/slab framing so Structural CAD is populated immediately
  const framedBuilding = synthesizeStructuralFraming(rawBuilding);
  const compliance = evaluateArchitecturalComplianceScore(framedBuilding);
  const finalBuilding: Building = {
    ...framedBuilding,
    complianceRating: compliance,
  };

  const repFloor = finalBuilding.floors.find(f => f.floorUse === 'RESIDENTIAL') ?? finalBuilding.floors[0]!;
  return {
    mode: 'floor_plan',
    building: finalBuilding,
    extractedRoomCount: repFloor.rooms.length,
    extractedWallCount: repFloor.walls.length,
    extractedDoorCount: repFloor.doors.length,
    extractedWindowCount: repFloor.windows.length,
    structuralColumnsCount: repFloor.columns.length,
    structuralBeamsCount: repFloor.beams?.length ?? finalBuilding.beams?.length ?? 0,
    complianceScore: compliance.score,
    sourceCadUnderlay,
  };
}

export type ReferenceWorkflowStage =
  | 'upload'
  | 'extraction'
  | 'calibration'
  | 'verification'
  | 'generation';

export type ReferenceFileKind = 'image' | 'pdf' | 'cad';
export type ReferenceProvenance = 'VERIFIED_FROM_SOURCE' | 'ASSERTED_FROM_BRIEF' | 'AMBIGUOUS';

export interface DxfExtractionSummary {
  readonly layers: readonly string[];
  readonly entityCount: number;
  readonly lineCount: number;
  readonly polylineCount: number;
  readonly textCount: number;
  readonly boundsSpanMeters?: { readonly widthM: number; readonly depthM: number };
}

export interface PdfExtractionSummary {
  readonly version: string;
  readonly estimatedPageCount: number;
  readonly mediaBoxPt?: readonly [number, number, number, number];
  readonly aspectRatio?: number;
  readonly direct3DConversionSupported: false;
}

export interface ReferenceWorkflowState {
  readonly stage: ReferenceWorkflowStage;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly fileKind: ReferenceFileKind;
  readonly imageDimensionsPx?: { readonly width: number; readonly height: number };
  readonly dxfSummary?: DxfExtractionSummary;
  readonly pdfSummary?: PdfExtractionSummary;
  readonly calibrationScaleLabel: string;
  readonly calibratedWidthM: number;
  readonly calibratedDepthM: number;
  readonly northRotationDeg: 0 | 90 | 180 | 270;
  readonly provenance: ReferenceProvenance;
  readonly userVerified: boolean;
  readonly extractionNotes: string;
}

export const REFERENCE_WORKFLOW_STAGES: ReadonlyArray<{
  readonly id: ReferenceWorkflowStage;
  readonly label: string;
  readonly summary: string;
}> = [
  { id: 'upload', label: '01 Upload', summary: 'PNG, JPG, PDF, or ASCII DXF' },
  { id: 'extraction', label: '02 Extraction', summary: 'Parse metadata, layers & extents' },
  { id: 'calibration', label: '03 Calibration', summary: 'Scale & north alignment' },
  { id: 'verification', label: '04 Verification', summary: 'Human provenance check' },
  { id: 'generation', label: '05 Model Gen', summary: 'Lock intent for solver' },
];

export function parseAsciiDxfSummary(text: string): DxfExtractionSummary {
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const layerSet = new Set<string>();
  let lineCount = 0;
  let polylineCount = 0;
  let textCount = 0;
  let entityCount = 0;

  let extMinX: number | null = null;
  let extMinY: number | null = null;
  let extMaxX: number | null = null;
  let extMaxY: number | null = null;

  for (let i = 0; i < lines.length - 1; i++) {
    const code = lines[i];
    const value = lines[i + 1] ?? '';

    if (code === '8' && value.length > 0 && value.length < 64) {
      layerSet.add(value);
    }
    if (code === '0') {
      if (value === 'LINE') {
        lineCount += 1;
        entityCount += 1;
      } else if (value === 'LWPOLYLINE' || value === 'POLYLINE') {
        polylineCount += 1;
        entityCount += 1;
      } else if (value === 'TEXT' || value === 'MTEXT') {
        textCount += 1;
        entityCount += 1;
      } else if (value === 'INSERT' || value === 'CIRCLE' || value === 'ARC') {
        entityCount += 1;
      }
    }
    if (code === '9' && value === '$EXTMIN') {
      for (let k = i + 2; k < Math.min(lines.length - 1, i + 10); k += 2) {
        if (lines[k] === '10') extMinX = Number(lines[k + 1]);
        if (lines[k] === '20') extMinY = Number(lines[k + 1]);
      }
    }
    if (code === '9' && value === '$EXTMAX') {
      for (let k = i + 2; k < Math.min(lines.length - 1, i + 10); k += 2) {
        if (lines[k] === '10') extMaxX = Number(lines[k + 1]);
        if (lines[k] === '20') extMaxY = Number(lines[k + 1]);
      }
    }
  }

  let boundsSpanMeters: { widthM: number; depthM: number } | undefined;
  if (
    extMinX !== null &&
    extMinY !== null &&
    extMaxX !== null &&
    extMaxY !== null &&
    Number.isFinite(extMaxX - extMinX) &&
    Number.isFinite(extMaxY - extMinY)
  ) {
    const rawW = Math.abs(extMaxX - extMinX);
    const rawD = Math.abs(extMaxY - extMinY);
    // Assume millimetres when span > 500
    const divisor = Math.max(rawW, rawD) > 500 ? 1000 : 1;
    if (rawW > 0 && rawD > 0) {
      boundsSpanMeters = {
        widthM: Math.round((rawW / divisor) * 100) / 100,
        depthM: Math.round((rawD / divisor) * 100) / 100,
      };
    }
  }

  return {
    layers: Array.from(layerSet).slice(0, 12),
    entityCount,
    lineCount,
    polylineCount,
    textCount,
    boundsSpanMeters,
  };
}

export function parsePdfMetadataSummary(rawAscii: string): PdfExtractionSummary {
  const versionMatch = rawAscii.match(/%PDF-(\d+\.\d+)/);
  const version = versionMatch?.[1] ?? 'unknown';
  const countMatches = [...rawAscii.matchAll(/\/Count\s+(\d+)/g)];
  const maxCount = countMatches.reduce((max, m) => Math.max(max, Number(m[1]) || 0), 0);
  const pageTags = (rawAscii.match(/\/Type\s*\/Page\b/g) ?? []).length;
  const estimatedPageCount = Math.max(1, maxCount || pageTags || 1);

  const mediaMatch = rawAscii.match(/\/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/);
  let mediaBoxPt: readonly [number, number, number, number] | undefined;
  let aspectRatio: number | undefined;
  if (mediaMatch) {
    const x1 = Number(mediaMatch[1]);
    const y1 = Number(mediaMatch[2]);
    const x2 = Number(mediaMatch[3]);
    const y2 = Number(mediaMatch[4]);
    if ([x1, y1, x2, y2].every(Number.isFinite)) {
      mediaBoxPt = [x1, y1, x2, y2];
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      if (h > 0) aspectRatio = Math.round((w / h) * 100) / 100;
    }
  }

  return {
    version,
    estimatedPageCount,
    mediaBoxPt,
    aspectRatio,
    direct3DConversionSupported: false,
  };
}

export function createSampleSiteDxfContent(plotWidthM = 30, plotDepthM = 40): string {
  const wMm = Math.round(plotWidthM * 1000);
  const dMm = Math.round(plotDepthM * 1000);
  return [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$EXTMIN', '10', '0', '20', '0',
    '9', '$EXTMAX', '10', String(wMm), '20', String(dMm),
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'LWPOLYLINE', '8', 'A-PLOT-BNDRY', '90', '4',
    '0', 'LINE', '8', 'A-ROAD-EDGE', '10', '0', '20', '0', '11', String(wMm), '21', '0',
    '0', 'TEXT', '8', 'A-ANNO-NOTE', '1', `${plotWidthM}m x ${plotDepthM}m Surveyed Parcel`,
    '0', 'ENDSEC',
    '0', 'EOF',
  ].join('\n');
}

export function createSampleConceptSvgDataUrl(plotWidthM = 30, plotDepthM = 40): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
    <rect width="800" height="600" fill="#faf6ee"/>
    <rect x="80" y="70" width="640" height="460" fill="#efe6d6" stroke="#8b6843" stroke-width="4" stroke-dasharray="10 6"/>
    <rect x="130" y="120" width="230" height="360" fill="#fffdf8" stroke="#302820" stroke-width="3"/>
    <rect x="440" y="120" width="230" height="360" fill="#fffdf8" stroke="#302820" stroke-width="3"/>
    <rect x="360" y="190" width="80" height="220" fill="#e2d6c3" stroke="#8b6843" stroke-width="2"/>
    <text x="400" y="52" text-anchor="middle" font-family="monospace" font-size="18" fill="#302820">H-WING CONCEPT SKETCH (${plotWidthM}m x ${plotDepthM}m)</text>
    <text x="245" y="300" text-anchor="middle" font-family="monospace" font-size="14" fill="#6a5d52">WEST WING FLATS</text>
    <text x="555" y="300" text-anchor="middle" font-family="monospace" font-size="14" fill="#6a5d52">EAST WING FLATS</text>
    <text x="400" y="305" text-anchor="middle" font-family="monospace" font-size="12" fill="#8b6843">CORE</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

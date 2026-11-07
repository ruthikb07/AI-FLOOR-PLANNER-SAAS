import type {
  Building,
  ExportOptions,
  Floor,
  PaperSize,
} from '@ai-floor-planner/core';
import { serializeBuilding } from '@ai-floor-planner/core';
import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { measureApartmentAreaLedger, getFloorContentBounds } from '@ai-floor-planner/geometry-engine';
import { exportSVG } from '@ai-floor-planner/renderer';
import { canonicalToPlancraft } from '@ai-floor-planner/planning-engine';

export type ExportFormat = 'svg' | 'pdf' | 'json' | 'dwg' | 'dxf' | 'pc' | 'pcf';
export type ExportScope = 'active_sheet' | 'complete_project' | 'all_floors' | 'site_plan' | 'current_floor';

export interface AdvancedExportSettings extends ExportOptions {
  readonly scaleMode?: "EXACT" | "FIT_TO_PAGE";
  readonly northOrientationKnown?: boolean;
  readonly buildingRevision?: number;
  readonly programRevision?: string;
  readonly validationRevision?: number;
  readonly format: ExportFormat;
  readonly exportScope?: ExportScope;
  readonly includeRoomAreas: boolean;
  readonly includeOpenings: boolean;
  readonly includeMetadata: boolean;
  readonly includeFurniture?: boolean;
  readonly drawnBy: string;
  readonly projectNumber: string;
  readonly revision: string;
}

export interface ExportArtifact<TContent extends string | Uint8Array = string | Uint8Array> {
  readonly filename: string;
  readonly mimeType: string;
  readonly extension: ExportFormat;
  readonly content: TContent;
  readonly byteSize: number;
  readonly validation?: any;
  readonly savedPaths?: string[];
  readonly downloadUrl?: string;
}

const PAPER_POINTS: Record<PaperSize, { width: number; height: number }> = {
  A4: { width: 595, height: 842 },
  A3: { width: 842, height: 1191 },
  A2: { width: 1191, height: 1684 },
  A1: { width: 1684, height: 2384 },
  A0: { width: 2384, height: 3370 },
  letter: { width: 612, height: 792 },
  tabloid: { width: 792, height: 1224 },
};

export const DEFAULT_ADVANCED_EXPORT_SETTINGS: AdvancedExportSettings = {
  format: 'pdf',
  paperSize: 'A3',
  orientation: 'landscape',
  floorId: undefined,
  scale: '1:100',
  drawnBy: 'FORMA AI Planner',
  projectNumber: 'FP-001',
  revision: '01',
  includeGrid: false,
  includeDimensions: true,
  includeRoomLabels: true,
  includeRoomAreas: true,
  includeOpenings: true,
  includeFurniture: true,
  includeNorthArrow: true,
  includeScaleBar: true,
  includeTitleBlock: true,
  includeMetadata: true,
};

function cleanFilename(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'floor_plan';
}

function ascii(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/([\\()])/g, '\\$1');
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function selectedFloor(building: Building, floorId?: string): Floor {
  if (floorId && floorId !== 'all' && floorId !== 'complete_project' && !building.floors.some(f => f.id === floorId)) {
    throw new Error('PDF_FLOOR_NOT_FOUND');
  }
  const floor = building.floors.find(candidate => candidate.id === floorId) ?? building.floors[0];
  if (!floor) throw new Error('The project has no floor to export.');
  return floor;
}

export function validateExportSettings(settings: AdvancedExportSettings): string[] {
  const errors: string[] = [];
  if (!/^1:\d{1,4}$/.test(settings.scale.trim())) {
    errors.push('Scale must use architectural ratio notation, for example 1:100.');
  }
  if (!settings.drawnBy.trim()) errors.push('Drawn by is required for the title block.');
  if (!settings.revision.trim()) errors.push('Revision is required.');
  return errors;
}

function makeSvg(building: Building, settings: AdvancedExportSettings): string {
  return exportSVG(building, settings);
}

function pdfColorForRoom(type: string): [number, number, number] {
  const colors: Record<string, [number, number, number]> = {
    bedroom: [0.9, 0.95, 0.99],
    bathroom: [0.91, 0.97, 0.92],
    kitchen: [1, 0.96, 0.9],
    living: [0.97, 0.93, 0.98],
    dining: [1, 0.99, 0.91],
  };
  return colors[type] ?? [0.96, 0.96, 0.96];
}

function makePdf(building: Building, settings: AdvancedExportSettings): string {
  const isMultiSheet = settings.floorId === 'all' || settings.exportScope === 'complete_project';
  const floorsToExport = isMultiSheet ? building.floors : [selectedFloor(building, settings.floorId)];

  const paper = PAPER_POINTS[settings.paperSize];
  const pageWidth = settings.orientation === 'landscape' ? paper.height : paper.width;
  const pageHeight = settings.orientation === 'landscape' ? paper.width : paper.height;
  const titleHeight = settings.includeTitleBlock ? 70 : 0;
  const margin = 38;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2 - titleHeight;

  if (!isMultiSheet) {
    const floor = floorsToExport[0]!;
    const bounds = getFloorContentBounds(floor);
    const modelWidth = Math.max(1, bounds.width);
    const modelHeight = Math.max(1, bounds.height);
    const denominator = Number(settings.scale.split(':')[1]);
    const exactScale = 72 / 25.4 / denominator;
    const fit = settings.scaleMode === 'FIT_TO_PAGE';
    if (!fit && (modelWidth * exactScale > usableWidth || modelHeight * exactScale > usableHeight)) {
      throw new Error('PDF_SCALE_DOES_NOT_FIT_SHEET: choose a larger sheet, smaller scale, or FIT_TO_PAGE');
    }
    const fitScale = fit ? Math.min(usableWidth / modelWidth, usableHeight / modelHeight) : exactScale;
    const scaleLabel = fit ? 'FIT TO PAGE - NOT TO SCALE' : settings.scale;
    const ledger = floor.apartmentUnits ? measureApartmentAreaLedger(floor) : undefined;
    const validation = floor.apartmentUnits ? validateApartmentClosure(building) : undefined;
    if (validation && validation.hardErrors > 0) throw new Error(`PDF_GEOMETRY_HARD_ERRORS: ${validation.hardErrors}`);
    if (settings.buildingRevision !== undefined && settings.buildingRevision !== building.version) throw new Error('PDF_STALE_BUILDING_REVISION');
    if (settings.validationRevision !== undefined && settings.validationRevision !== building.version) throw new Error('PDF_STALE_VALIDATION_REVISION');

    const originX = margin + (usableWidth - modelWidth * fitScale) / 2;
    const originY = margin + titleHeight + (usableHeight - modelHeight * fitScale) / 2;
    const commands: string[] = ['0 J', '0 j', `% CANONICAL ${ascii(building.id)} REV ${building.version} FLOOR ${ascii(floor.id)} ROOMS ${floor.rooms.length} WALLS ${floor.walls.length} DOORS ${floor.doors.length} WINDOWS ${floor.windows.length}`, `% POINTS_PER_MM ${fitScale.toFixed(9)} SCALE_MODE ${fit ? 'FIT_TO_PAGE' : 'EXACT'}`];
    const px = (x: number) => originX + (x - bounds.x) * fitScale;
    const py = (y: number) => pageHeight - (originY + (y - bounds.y) * fitScale);

    if (settings.includeGrid) {
      commands.push('0.92 0.94 0.96 RG', '0.3 w');
      for (let x = bounds.x; x <= bounds.x + modelWidth; x += 1000) {
        commands.push(`${px(x).toFixed(2)} ${py(bounds.y).toFixed(2)} m ${px(x).toFixed(2)} ${py(bounds.y + modelHeight).toFixed(2)} l S`);
      }
      for (let y = bounds.y; y <= bounds.y + modelHeight; y += 1000) {
        commands.push(`${px(bounds.x).toFixed(2)} ${py(y).toFixed(2)} m ${px(bounds.x + modelWidth).toFixed(2)} ${py(y).toFixed(2)} l S`);
      }
    }

    for (const room of floor.rooms) {
      const [r, g, b] = pdfColorForRoom(room.type);
      commands.push(`% ROOM ${ascii(room.id)}`);
      const x = px(room.x);
      const y = py(room.y + room.height);
      const width = room.width * fitScale;
      const height = room.height * fitScale;
      commands.push(`${r} ${g} ${b} rg`, room.boundary.points.map((p, i) => `${px(p.x).toFixed(2)} ${py(p.y).toFixed(2)} ${i ? 'l' : 'm'}`).join(' ') + ' h f');
      if (room.type === 'staircase') {
        commands.push('0.4 0.4 0.4 RG', '0.4 w');
        for (let i = 1; i < 12; i++) commands.push(`${x.toFixed(2)} ${(y + height * i / 12).toFixed(2)} m ${(x + width).toFixed(2)} ${(y + height * i / 12).toFixed(2)} l S`);
      }
      if (settings.includeRoomLabels) {
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const label = room.name.replace(/^FLAT_\d+.*?\) /, '');
        const font = Math.max(4, Math.min(8, (width - 8) / (label.length * 0.55)));
        commands.push('0.12 0.15 0.19 rg', `BT /F1 ${font.toFixed(2)} Tf ${(centerX - label.length * font * 0.26).toFixed(2)} ${centerY.toFixed(2)} Td (${ascii(label)}) Tj ET`);
        if (settings.includeRoomAreas) {
          commands.push('0.35 0.39 0.45 rg', `BT /F1 7 Tf ${(centerX - 17).toFixed(2)} ${(centerY - 9).toFixed(2)} Td (${((ledger?.roomUsable[room.id] ?? room.area) / 1_000_000).toFixed(1)} sq m) Tj ET`);
        }
      }
    }

    if (settings.includeFurniture !== false && floor.furniture && floor.furniture.length > 0) {
      commands.push('% LAYER A-FURN (Furniture & Fixtures)', '0.55 0.58 0.62 RG', '0.4 w');
      for (const item of floor.furniture) {
        const ix = px(item.xMm);
        const iy = py(item.yMm + item.depthMm);
        const iw = item.widthMm * fitScale;
        const ih = item.depthMm * fitScale;
        commands.push(`${ix.toFixed(2)} ${iy.toFixed(2)} ${iw.toFixed(2)} ${ih.toFixed(2)} re S`);
      }
    }

    commands.push('0.08 0.1 0.13 RG');
    for (const wall of floor.walls) {
      const dx = wall.endPoint.x - wall.startPoint.x, dy = wall.endPoint.y - wall.startPoint.y, len = Math.hypot(dx, dy);
      if (!len) continue;
      const openings = settings.includeOpenings ? [...floor.doors, ...floor.windows].filter(o => o.wallId === wall.id) : [];
      const cuts = openings.map(o => { const t = ((o.position.x - wall.startPoint.x) * dx + (o.position.y - wall.startPoint.y) * dy) / len; return [Math.max(0, t - o.width / 2), Math.min(len, t + o.width / 2)]; }).sort((a, b) => a[0]! - b[0]!);
      let cursor = 0; const segments: number[][] = [];
      for (const cut of cuts) { if (cut[0]! > cursor) segments.push([cursor, cut[0]!]); cursor = Math.max(cursor, cut[1]!); }
      if (cursor < len) segments.push([cursor, len]);
      commands.push(`% WALL ${ascii(wall.id)}`, `${(wall.thickness * fitScale).toFixed(3)} w`);
      for (const [a, b] of segments) commands.push(`${px(wall.startPoint.x + dx * a! / len).toFixed(2)} ${py(wall.startPoint.y + dy * a! / len).toFixed(2)} m ${px(wall.startPoint.x + dx * b! / len).toFixed(2)} ${py(wall.startPoint.y + dy * b! / len).toFixed(2)} l S`);
    }

    if (settings.includeOpenings) for (const opening of [...floor.doors, ...floor.windows]) {
      const wall = floor.walls.find(w => w.id === opening.wallId); if (!wall) continue;
      const dx = wall.endPoint.x - wall.startPoint.x, dy = wall.endPoint.y - wall.startPoint.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
      const ax = opening.position.x - ux * opening.width / 2, ay = opening.position.y - uy * opening.width / 2, bx = ax + ux * opening.width, by = ay + uy * opening.width;
      commands.push('0.08 0.45 0.7 RG', '0.6 w', `% OPENING ${ascii(opening.id)}`);
      if ('connectsRooms' in opening && opening.type === 'single') {
        const target = floor.rooms.find(r => r.id === opening.connectsRooms[0]);
        const inwardSide = target && (-uy * (target.x + target.width / 2 - opening.position.x) + ux * (target.y + target.height / 2 - opening.position.y)) < 0 ? -1 : 1;
        const side = opening.swingDirection === 'outward' ? -inwardSide : inwardSide;
        const leafX = ax - uy * opening.width * side, leafY = ay + ux * opening.width * side;
        commands.push(`${px(ax).toFixed(2)} ${py(ay).toFixed(2)} m ${px(leafX).toFixed(2)} ${py(leafY).toFixed(2)} l S`);
        const k = 0.55228475; const c1x = bx - uy * opening.width * k * side, c1y = by + ux * opening.width * k * side, c2x = leafX + ux * opening.width * k, c2y = leafY + uy * opening.width * k;
        commands.push(`${px(bx).toFixed(2)} ${py(by).toFixed(2)} m ${px(c1x).toFixed(2)} ${py(c1y).toFixed(2)} ${px(c2x).toFixed(2)} ${py(c2y).toFixed(2)} ${px(leafX).toFixed(2)} ${py(leafY).toFixed(2)} c S`);
      } else commands.push(`${px(ax).toFixed(2)} ${py(ay).toFixed(2)} m ${px(bx).toFixed(2)} ${py(by).toFixed(2)} l S`);
    }

    if (settings.includeDimensions) {
      commands.push('0.08 0.45 0.7 rg', `BT /F1 8 Tf ${originX.toFixed(2)} ${(pageHeight - originY + 15).toFixed(2)} Td (${(modelWidth / 1000).toFixed(1)}m wide x ${(modelHeight / 1000).toFixed(1)}m deep) Tj ET`);
    }

    if (settings.includeNorthArrow && settings.northOrientationKnown) {
      const nx = pageWidth - 58;
      const ny = pageHeight - 58;
      commands.push('0.08 0.1 0.13 rg', `${nx} ${ny - 18} m ${nx - 6} ${ny} l ${nx} ${ny - 5} l ${nx + 6} ${ny} l h f`, `BT /F1 10 Tf ${nx - 3} ${ny + 6} Td (N) Tj ET`);
    }

    if (settings.includeScaleBar) {
      commands.push('0.08 0.1 0.13 RG', '1.4 w', `${margin} ${margin + titleHeight + 8} m ${(margin + 5000 * fitScale).toFixed(2)} ${margin + titleHeight + 8} l S`, `BT /F1 7 Tf ${margin} ${margin + titleHeight - 3} Td (${ascii(scaleLabel)}) Tj ET`);
    }

    if (settings.includeTitleBlock) {
      commands.push('0.08 0.1 0.13 RG', '0.8 w', `${margin} ${margin} ${pageWidth - margin * 2} ${titleHeight - 8} re S`);
      commands.push('0.08 0.1 0.13 rg', `BT /F1 13 Tf ${margin + 10} ${margin + 29} Td (${ascii(building.name)}) Tj ET`);
      commands.push(`BT /F1 8 Tf ${margin + 10} ${margin + 14} Td (${ascii(floor.name)} | ${ascii(scaleLabel)} | Rev ${ascii(settings.revision)}) Tj ET`);
      commands.push(`BT /F1 8 Tf ${(pageWidth - 220).toFixed(2)} ${margin + 29} Td (Drawn by ${ascii(settings.drawnBy)}) Tj ET`);
      commands.push(`BT /F1 8 Tf ${(pageWidth - 220).toFixed(2)} ${margin + 14} Td (Project ${ascii(settings.projectNumber)}) Tj ET`);
      commands.push('0.75 0.12 0.12 rg', `BT /F1 8 Tf ${margin + 10} ${margin + 43} Td (CONCEPT / SCHEMATIC DESIGN - NOT FOR CONSTRUCTION) Tj ET`);
    }

    commands.push('0.15 0.15 0.15 rg', `BT /F1 8 Tf ${margin} 20 Td (Building ${ascii(building.id)} | Canonical revision ${building.version} | Regulatory NOT VERIFIED | Professional review REQUIRED) Tj ET`);
    if (ledger) commands.push(`BT /F1 8 Tf ${margin} ${pageHeight - 22} Td (Usable ${(ledger.unitUsable / 1e6).toFixed(2)} | Balcony ${(ledger.balcony / 1e6).toFixed(2)} | Core ${(ledger.core / 1e6).toFixed(2)} | Common ${(ledger.common / 1e6).toFixed(2)} | Walls ${(ledger.wall / 1e6).toFixed(2)} sq m | Hard errors ${validation!.hardErrors} | Warnings ${validation!.warnings}) Tj ET`);
    const stream = `${commands.join('\n')}\n`;
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${byteLength(stream)} >>\nstream\n${stream}endstream`,
      `<< /Title (${ascii(building.name)}) /Author (${ascii(settings.drawnBy)}) /Subject (Concept schematic floor plan - NOT FOR CONSTRUCTION) /Creator (FORMA AI Planner) /BuildingId (${ascii(building.id)}) /BuildingRevision (${building.version}) /ProgramRevision (${ascii(settings.programRevision ?? 'NOT_PROVIDED')}) /ValidationRevision (${settings.validationRevision ?? building.version}) /FloorId (${ascii(floor.id)}) /ScaleMode (${fit ? 'FIT_TO_PAGE' : 'EXACT'}) /Scale (${ascii(scaleLabel)}) /Sheet (${settings.paperSize}) >>`,
    ];
    let pdf = '%PDF-1.4\n%FORMA\n';
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(byteLength(pdf));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index <= objects.length; index += 1) {
      pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return pdf;
  }

  // Multi-sheet complete set PDF assembly
  const pageKids: string[] = [];
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '', // Will replace with Pages object after collecting kids
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', // Obj 3: Font
  ];

  for (let pIdx = 0; pIdx < floorsToExport.length; pIdx++) {
    const floor = floorsToExport[pIdx]!;
    const bounds = getFloorContentBounds(floor);
    const modelWidth = Math.max(1, bounds.width);
    const modelHeight = Math.max(1, bounds.height);
    const fitScale = Math.min(usableWidth / modelWidth, usableHeight / modelHeight);
    const originX = margin + (usableWidth - modelWidth * fitScale) / 2;
    const originY = margin + titleHeight + (usableHeight - modelHeight * fitScale) / 2;
    const px = (x: number) => originX + (x - bounds.x) * fitScale;
    const py = (y: number) => pageHeight - (originY + (y - bounds.y) * fitScale);

    const commands: string[] = ['0 J', '0 j'];

    for (const room of floor.rooms) {
      const [r, g, b] = pdfColorForRoom(room.type);
      const x = px(room.x);
      const y = py(room.y + room.height);
      const width = room.width * fitScale;
      const height = room.height * fitScale;
      commands.push(`${r} ${g} ${b} rg`, room.boundary.points.map((p, i) => `${px(p.x).toFixed(2)} ${py(p.y).toFixed(2)} ${i ? 'l' : 'm'}`).join(' ') + ' h f');
      if (room.type === 'staircase') {
        commands.push('0.4 0.4 0.4 RG', '0.4 w');
        for (let i = 1; i < 12; i++) commands.push(`${x.toFixed(2)} ${(y + height * i / 12).toFixed(2)} m ${(x + width).toFixed(2)} ${(y + height * i / 12).toFixed(2)} l S`);
      }
      if (settings.includeRoomLabels) {
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const label = room.name.replace(/^FLAT_\d+.*?\) /, '');
        const font = Math.max(4, Math.min(8, (width - 8) / (label.length * 0.55)));
        commands.push('0.12 0.15 0.19 rg', `BT /F1 ${font.toFixed(2)} Tf ${(centerX - label.length * font * 0.26).toFixed(2)} ${centerY.toFixed(2)} Td (${ascii(label)}) Tj ET`);
        if (settings.includeRoomAreas) {
          commands.push('0.35 0.39 0.45 rg', `BT /F1 7 Tf ${(centerX - 17).toFixed(2)} ${(centerY - 9).toFixed(2)} Td (${(room.area / 1_000_000).toFixed(1)} sq m) Tj ET`);
        }
      }
    }

    if (settings.includeFurniture !== false && floor.furniture && floor.furniture.length > 0) {
      commands.push('% LAYER A-FURN (Furniture & Fixtures)', '0.55 0.58 0.62 RG', '0.4 w');
      for (const item of floor.furniture) {
        const ix = px(item.xMm);
        const iy = py(item.yMm + item.depthMm);
        const iw = item.widthMm * fitScale;
        const ih = item.depthMm * fitScale;
        commands.push(`${ix.toFixed(2)} ${iy.toFixed(2)} ${iw.toFixed(2)} ${ih.toFixed(2)} re S`);
      }
    }

    commands.push('0.08 0.1 0.13 RG');
    for (const wall of floor.walls) {
      const dx = wall.endPoint.x - wall.startPoint.x, dy = wall.endPoint.y - wall.startPoint.y, len = Math.hypot(dx, dy);
      if (!len) continue;
      const openings = settings.includeOpenings ? [...floor.doors, ...floor.windows].filter(o => o.wallId === wall.id) : [];
      const cuts = openings.map(o => { const t = ((o.position.x - wall.startPoint.x) * dx + (o.position.y - wall.startPoint.y) * dy) / len; return [Math.max(0, t - o.width / 2), Math.min(len, t + o.width / 2)]; }).sort((a, b) => a[0]! - b[0]!);
      let cursor = 0; const segments: number[][] = [];
      for (const cut of cuts) { if (cut[0]! > cursor) segments.push([cursor, cut[0]!]); cursor = Math.max(cursor, cut[1]!); }
      if (cursor < len) segments.push([cursor, len]);
      commands.push(`${(wall.thickness * fitScale).toFixed(3)} w`);
      for (const [a, b] of segments) commands.push(`${px(wall.startPoint.x + dx * a! / len).toFixed(2)} ${py(wall.startPoint.y + dy * a! / len).toFixed(2)} m ${px(wall.startPoint.x + dx * b! / len).toFixed(2)} ${py(wall.startPoint.y + dy * b! / len).toFixed(2)} l S`);
    }

    if (settings.includeTitleBlock) {
      const sheetNum = `Sheet ${pIdx + 1} of ${floorsToExport.length}`;
      commands.push('0.08 0.1 0.13 RG', '0.8 w', `${margin} ${margin} ${pageWidth - margin * 2} ${titleHeight - 8} re S`);
      commands.push('0.08 0.1 0.13 rg', `BT /F1 13 Tf ${margin + 10} ${margin + 29} Td (${ascii(building.name)}) Tj ET`);
      commands.push(`BT /F1 8 Tf ${margin + 10} ${margin + 14} Td (${ascii(floor.name)} | ${sheetNum} | 1:100 ISO A3) Tj ET`);
      commands.push(`BT /F1 8 Tf ${(pageWidth - 220).toFixed(2)} ${margin + 29} Td (Drawn by ${ascii(settings.drawnBy)}) Tj ET`);
      commands.push(`BT /F1 8 Tf ${(pageWidth - 220).toFixed(2)} ${margin + 14} Td (Project ${ascii(settings.projectNumber)}) Tj ET`);
      commands.push('0.75 0.12 0.12 rg', `BT /F1 8 Tf ${margin + 10} ${margin + 43} Td (CONCEPT / SCHEMATIC DESIGN - NOT FOR CONSTRUCTION) Tj ET`);
    }

    const stream = `${commands.join('\n')}\n`;
    const pageObjNum = objects.length + 1;
    const contentObjNum = objects.length + 2;
    pageKids.push(`${pageObjNum} 0 R`);

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjNum} 0 R >>`,
    );
    objects.push(
      `<< /Length ${byteLength(stream)} >>\nstream\n${stream}endstream`,
    );
  }

  // Update Obj 2 (Pages catalog)
  objects[1] = `<< /Type /Pages /Kids [${pageKids.join(' ')}] /Count ${floorsToExport.length} >>`;

  const infoObjNum = objects.length + 1;
  objects.push(
    `<< /Title (${ascii(building.name)} - Complete Sheet Set) /Author (${ascii(settings.drawnBy)}) /Subject (Complete 5-Sheet Indian Residential Apartment Drawing Set) /Creator (FORMA AI Planner) /SheetCount (${floorsToExport.length}) >>`,
  );

  let pdf = '%PDF-1.4\n%FORMA\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoObjNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function makeJson(building: Building, settings: AdvancedExportSettings): string {
  return JSON.stringify({
    exportManifest: {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      generator: 'FORMA AI Planner',
      documentStatus: 'CONCEPT / SCHEMATIC DESIGN - NOT FOR CONSTRUCTION',
      floorId: settings.floorId,
      projectNumber: settings.projectNumber,
      revision: settings.revision,
      scale: settings.scale,
    },
    building: JSON.parse(serializeBuilding(building)),
  }, null, 2);
}

export function createExportArtifact(
  building: Building,
  settings: AdvancedExportSettings,
): ExportArtifact<string> {
  const errors = validateExportSettings(settings);
  if (errors.length > 0) throw new Error(errors.join(' '));
  selectedFloor(building, settings.floorId);

  const floor = selectedFloor(building, settings.floorId);
  const filename = `${cleanFilename(building.name)}_${cleanFilename(floor.name)}_r${cleanFilename(settings.revision)}.${settings.format}`;

  if (settings.format === 'dwg' || settings.format === 'dxf') {
    return {
      filename,
      mimeType: settings.format === 'dwg' ? 'application/x-dwg' : 'application/dxf',
      extension: settings.format,
      content: '',
      byteSize: 0,
    };
  }

  if (settings.format === 'pc' || settings.format === 'pcf') {
    let content = '';
    if (settings.format === 'pc') {
      content = floor.plancraftDsl?.pcText ?? building.plancraftDsl?.pcText ?? '';
      if (!content) {
        content = canonicalToPlancraft(building, floor.level).pcText;
      }
    } else {
      content = floor.plancraftDsl?.pcfText ?? building.plancraftDsl?.pcfText ?? '';
      if (!content) {
        content = canonicalToPlancraft(building, floor.level).pcfText;
      }
    }
    return {
      filename,
      mimeType: 'text/plain',
      extension: settings.format,
      content,
      byteSize: byteLength(content),
    };
  }

  const content = settings.format === 'svg'
    ? makeSvg(building, settings)
    : settings.format === 'pdf'
      ? makePdf(building, settings)
      : makeJson(building, settings);
  const mimeType = settings.format === 'svg'
    ? 'image/svg+xml'
    : settings.format === 'pdf'
      ? 'application/pdf'
      : 'application/json';

  return {
    filename,
    mimeType,
    extension: settings.format,
    content,
    byteSize: byteLength(content),
  };
}

export async function exportCadArtifact(
  building: Building,
  settings: AdvancedExportSettings,
  baseUrl = '/api/v1',
): Promise<ExportArtifact<Uint8Array>> {
  const format = settings.format === 'dwg' ? 'dwg' : 'dxf';

  const isMultiSheet =
    settings.floorId === 'complete_project' ||
    settings.floorId === 'all' ||
    settings.exportScope === 'complete_project' ||
    settings.exportScope === 'all_floors';

  const options = {
    floorId: settings.floorId,
    exportScope: isMultiSheet
      ? 'complete_project'
      : settings.floorId === 'site'
      ? 'site_plan'
      : settings.exportScope ?? 'current_floor',
    includeDimensions: settings.includeDimensions,
    includeRoomLabels: settings.includeRoomLabels,
    includeRoomAreas: settings.includeRoomAreas,
    includeOpenings: settings.includeOpenings,
    includeFurniture: settings.includeFurniture ?? true,
    includeSite: settings.includeNorthArrow || isMultiSheet || settings.floorId === 'site',
    includeTitleBlock: settings.includeTitleBlock,
    scale: settings.scale,
    drawnBy: settings.drawnBy,
    projectNumber: settings.projectNumber,
    revision: settings.revision,
  };

  const candidateUrls = [
    `${baseUrl}/export/${format}`,
    `http://127.0.0.1:4200/api/v1/export/${format}`,
  ];

  let response: Response | null = null;
  let lastError: Error | null = null;

  for (const targetUrl of candidateUrls) {
    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ building, options }),
      });
      if (res.ok) {
        response = res;
        break;
      }
      if (res.status === 400 || res.status === 500) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`CAD export failed (HTTP ${res.status}): ${errorText}`);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.startsWith('CAD export failed (HTTP 400)') || lastError.message.startsWith('CAD export failed (HTTP 500)')) {
        throw lastError;
      }
    }
  }

  if (!response) {
    throw new Error(
      lastError?.message?.includes('CAD export failed')
        ? lastError.message
        : `CAD export server is unreachable on port 4200. Please start the backend server via 'pnpm dev' or 'pnpm --filter @ai-floor-planner/backend start'.`
    );
  }

  const disposition = response.headers.get('content-disposition') || '';
  let filename = '';

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    try {
      filename = decodeURIComponent(utf8Match[1].trim());
    } catch {
      filename = utf8Match[1].trim();
    }
  } else {
    const quotedMatch = disposition.match(/filename="([^"]+)"/i);
    if (quotedMatch && quotedMatch[1]) {
      filename = quotedMatch[1].trim();
    } else {
      const unquotedMatch = disposition.match(/filename=([^; ]+)/i);
      if (unquotedMatch && unquotedMatch[1]) {
        filename = unquotedMatch[1].trim().replace(/^"+|"+$/g, '');
      }
    }
  }

  const floor = selectedFloor(building, settings.floorId);
  const rawBuilding = building.name && building.name.trim() !== '' ? building.name : 'AI_BUILDING_SAAS';
  const cleanBuilding = cleanFilename(rawBuilding) || 'AI_BUILDING_SAAS';
  const floorIdx = building.floors.findIndex(f => f.id === floor.id);
  const floorNum = floorIdx >= 0 ? floorIdx + 1 : (Math.abs(floor.level) === 0 ? 1 : Math.abs(floor.level));
  const padded = String(floorNum).padStart(2, '0');
  const levelPrefix = floor.level < 0 ? `Basement_${padded}` : `Floor_${padded}`;
  const cleanFloorName = cleanFilename(floor.name);
  const isDefaultOrAiBuilding =
    !building.name ||
    building.name.trim() === '' ||
    /^ai[ _-]?building[ _-]?saas$/i.test(cleanBuilding) ||
    /^my[ _-]?building[ _-]?project$/i.test(cleanBuilding) ||
    /^new[ _-]?project$/i.test(cleanBuilding) ||
    /^project$/i.test(cleanBuilding);

  let floorPart: string;
  if (isDefaultOrAiBuilding) {
    floorPart = `Floor_${padded}`;
  } else if (/^(floor|level)[_-]?\d+$/i.test(cleanFloorName)) {
    floorPart = `Floor_${padded}`;
  } else if (cleanFloorName.toLowerCase() === 'ground_floor' || cleanFloorName.toLowerCase() === 'ground') {
    floorPart = `Floor_${padded}`;
  } else if (cleanFloorName.length > 0) {
    floorPart = `${levelPrefix}_${cleanFloorName}`;
  } else {
    floorPart = levelPrefix;
  }
  const revSuffix = settings.revision && !isDefaultOrAiBuilding ? `_r${cleanFilename(settings.revision)}` : '';
  const fallbackFilename = isDefaultOrAiBuilding
    ? `AI_BUILDING_SAAS_${floorPart}.${format}`
    : `${cleanBuilding}_${floorPart}${revSuffix}.${format}`;

  if (!filename || isDefaultOrAiBuilding) {
    filename = isDefaultOrAiBuilding ? `AI_BUILDING_SAAS_${floorPart}.${format}` : fallbackFilename;
  }

  // Clean illegal filename characters and enforce matching CAD extension
  filename = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  if (!filename.toLowerCase().endsWith(`.${format}`)) {
    filename = `${filename.replace(/\.[^.]+$/, '')}.${format}`;
  }

  const mimeType = format === 'dwg' ? 'application/acad' : 'application/dxf';
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < 500) {
    throw new Error(`Exported CAD file is corrupt or empty (${buffer.byteLength} bytes)`);
  }
  const data = new Uint8Array(buffer);

  if (format === 'dwg') {
    const magic = String.fromCharCode(...data.subarray(0, 6));
    if (magic !== 'AC1032') {
      throw new Error(`Invalid DWG format: expected AC1032 magic header, found "${magic}"`);
    }
  }

  let validation: any = null;
  const validationHeader = response.headers.get('x-cad-validation');
  if (validationHeader) {
    try {
      validation = JSON.parse(validationHeader);
    } catch {
      // Ignored
    }
  }

  const diskPathHeader = response.headers.get('x-cad-disk-path');
  const savedPaths = diskPathHeader
    ? diskPathHeader.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const downloadUrlHeader = response.headers.get('x-cad-download-url');
  const downloadUrl = downloadUrlHeader || `/api/v1/export/download/${encodeURIComponent(filename)}`;

  return {
    filename,
    mimeType,
    extension: format,
    content: data,
    byteSize: data.byteLength,
    validation,
    savedPaths,
    downloadUrl,
  };
}

export async function persistArtifactToServer(
  filename: string,
  content: string,
  baseUrl = '/api/v1',
): Promise<{ savedPaths: string[]; downloadUrl: string } | null> {
  const candidateUrls = [
    `${baseUrl}/export/persist`,
    'http://127.0.0.1:4200/api/v1/export/persist',
  ];
  for (const targetUrl of candidateUrls) {
    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.savedPaths) {
          return { savedPaths: data.savedPaths, downloadUrl: data.downloadUrl };
        }
      }
    } catch {
      // Ignored
    }
  }
  return null;
}

/**
 * Minimal valid DXF for Phase 1 download-path proof.
 * Contains a single LINE entity from (0,0,0) to (100,100,0).
 */
export const MINIMAL_DXF =
  '0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n30\n0.0\n11\n100.0\n21\n100.0\n31\n0.0\n0\nENDSEC\n0\nEOF\n';

/**
 * Sanitize a filename to only letters, digits, underscore, hyphen and dot.
 */
function sanitizeDownloadFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.\-]/g, '_') || 'download';
}

/**
 * Download a text string as a file via the browser's normal download mechanism.
 *
 * Rules followed:
 * - Blob is created first, then anchor.click() is called synchronously.
 * - No await/setTimeout between user click and anchor.click().
 * - URL is revoked only after ~2000ms.
 * - A fallback link is shown for sandboxed browsers.
 */
export function downloadTextFile(filename: string, text: string, mimeType: string): void {
  const safeName = sanitizeDownloadFilename(filename);
  const blob = new Blob([text], { type: mimeType });

  console.log(`[downloadTextFile] filename=${safeName}, blob.size=${blob.size}, blob.type=${blob.type}`);

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Revoke only after 2000ms so the browser has time to start the download
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 2000);

  // Show an inline fallback message with a fresh Blob URL
  const fallbackBlob = new Blob([text], { type: mimeType });
  const fallbackUrl = URL.createObjectURL(fallbackBlob);

  const banner = document.createElement('div');
  banner.setAttribute('data-testid', 'download-started-banner');
  banner.style.cssText =
    'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
    'background:#1e293b;color:#e2e8f0;padding:12px 20px;border-radius:8px;' +
    'font-family:system-ui,sans-serif;font-size:14px;z-index:99999;' +
    'box-shadow:0 4px 24px rgba(0,0,0,0.4);display:flex;align-items:center;gap:12px;';

  const msgSpan = document.createElement('span');
  msgSpan.textContent = `Download started: ${safeName}`;
  banner.appendChild(msgSpan);

  const fallbackLink = document.createElement('a');
  fallbackLink.href = fallbackUrl;
  fallbackLink.download = safeName;
  fallbackLink.textContent = "Download didn't start? Click here";
  fallbackLink.style.cssText = 'color:#38bdf8;text-decoration:underline;white-space:nowrap;';
  banner.appendChild(fallbackLink);

  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = '✕';
  dismissBtn.style.cssText =
    'background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px;margin-left:8px;';
  dismissBtn.addEventListener('click', () => {
    URL.revokeObjectURL(fallbackUrl);
    banner.remove();
  });
  banner.appendChild(dismissBtn);

  document.body.appendChild(banner);

  // Auto-dismiss after 30 seconds
  setTimeout(() => {
    if (banner.parentNode) {
      URL.revokeObjectURL(fallbackUrl);
      banner.remove();
    }
  }, 30000);
}

export async function downloadExportArtifact(artifact: ExportArtifact): Promise<boolean> {
  let safeFilename = (artifact.filename || `AI_BUILDING_SAAS_Floor_01.${artifact.extension}`)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim();
  if (!safeFilename.toLowerCase().endsWith(`.${artifact.extension}`)) {
    safeFilename = `${safeFilename.replace(/\.[^.]+$/, '')}.${artifact.extension}`;
  }

  const mimeType = artifact.mimeType || (
    artifact.extension === 'dxf'
      ? 'application/dxf'
      : artifact.extension === 'dwg'
        ? 'application/acad'
        : 'application/octet-stream'
  );

  // 1. Direct Blob URL download - instantaneous, works in every browser, directly saves to default Downloads
  const blobParts: BlobPart[] = artifact.content
    ? [artifact.content instanceof Uint8Array ? artifact.content : String(artifact.content)]
    : [];
  const blob = new Blob(blobParts, { type: mimeType });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeFilename;
  anchor.setAttribute('download', safeFilename);
  anchor.rel = 'noopener';
  anchor.style.position = 'fixed';
  anchor.style.top = '-9999px';
  anchor.style.left = '-9999px';
  anchor.style.width = '1px';
  anchor.style.height = '1px';
  document.body.appendChild(anchor);

  try {
    anchor.click();
  } catch {
    const clickEvent = new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true,
    });
    anchor.dispatchEvent(clickEvent);
  }

  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 10_000);

  // 2. Also present the interactive download banner with fresh direct link for sandboxed/restricted browsers
  if (typeof document !== 'undefined') {
    const existing = document.querySelector('[data-testid="download-started-banner"]');
    if (existing) existing.remove();

    const fallbackBlob = new Blob(blobParts, { type: mimeType });
    const fallbackUrl = URL.createObjectURL(fallbackBlob);

    const banner = document.createElement('div');
    banner.setAttribute('data-testid', 'download-started-banner');
    banner.style.cssText =
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
      'background:#1e293b;color:#e2e8f0;padding:12px 20px;border-radius:8px;' +
      'font-family:system-ui,sans-serif;font-size:14px;z-index:99999;' +
      'box-shadow:0 4px 24px rgba(0,0,0,0.4);display:flex;align-items:center;gap:12px;';

    const msgSpan = document.createElement('span');
    msgSpan.textContent = `Download started: ${safeFilename}`;
    banner.appendChild(msgSpan);

    const fallbackLink = document.createElement('a');
    fallbackLink.href = fallbackUrl;
    fallbackLink.download = safeFilename;
    fallbackLink.textContent = "Download didn't start? Click here";
    fallbackLink.style.cssText = 'color:#38bdf8;text-decoration:underline;white-space:nowrap;font-weight:600;';
    banner.appendChild(fallbackLink);

    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = '✕';
    dismissBtn.style.cssText =
      'background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px;margin-left:8px;';
    dismissBtn.addEventListener('click', () => {
      URL.revokeObjectURL(fallbackUrl);
      banner.remove();
    });
    banner.appendChild(dismissBtn);

    document.body.appendChild(banner);

    setTimeout(() => {
      if (banner.parentNode) {
        URL.revokeObjectURL(fallbackUrl);
        banner.remove();
      }
    }, 30000);
  }

  return true;
}

export function formatExportSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

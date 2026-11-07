import type {
  Building,
  ExportOptions,
  Floor,
  PaperSize,
} from '@ai-floor-planner/core';
import { serializeBuilding } from '@ai-floor-planner/core';
import { getFloorContentBounds } from '@ai-floor-planner/geometry-engine';
import { exportSVG } from '@ai-floor-planner/renderer';

export type ExportFormat = 'svg' | 'pdf' | 'json';

export interface AdvancedExportSettings extends ExportOptions {
  readonly format: ExportFormat;
  readonly includeRoomAreas: boolean;
  readonly includeOpenings: boolean;
  readonly includeMetadata: boolean;
  readonly drawnBy: string;
  readonly projectNumber: string;
  readonly revision: string;
}

export interface ExportArtifact {
  readonly filename: string;
  readonly mimeType: string;
  readonly extension: ExportFormat;
  readonly content: string;
  readonly byteSize: number;
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
  const floor = building.floors.find(candidate => candidate.id === floorId)
    ?? building.floors[0];
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
  const floor = selectedFloor(building, settings.floorId);
  const paper = PAPER_POINTS[settings.paperSize];
  const pageWidth = settings.orientation === 'landscape' ? paper.height : paper.width;
  const pageHeight = settings.orientation === 'landscape' ? paper.width : paper.height;
  const titleHeight = settings.includeTitleBlock ? 70 : 0;
  const margin = 38;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2 - titleHeight;
  const bounds = getFloorContentBounds(floor);
  const modelWidth = Math.max(1, bounds.width);
  const modelHeight = Math.max(1, bounds.height);
  const fitScale = Math.min(usableWidth / modelWidth, usableHeight / modelHeight);
  const originX = margin + (usableWidth - modelWidth * fitScale) / 2;
  const originY = margin + titleHeight + (usableHeight - modelHeight * fitScale) / 2;
  const commands: string[] = ['1 J', '1 j'];
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
    const x = px(room.x);
    const y = py(room.y + room.height);
    const width = room.width * fitScale;
    const height = room.height * fitScale;
    commands.push(`${r} ${g} ${b} rg`, `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
    if (settings.includeRoomLabels) {
      const centerX = x + width / 2;
      const centerY = y + height / 2;
      commands.push('0.12 0.15 0.19 rg', `BT /F1 9 Tf ${centerX.toFixed(2)} ${centerY.toFixed(2)} Td (${ascii(room.name)}) Tj ET`);
      if (settings.includeRoomAreas) {
        commands.push('0.35 0.39 0.45 rg', `BT /F1 7 Tf ${centerX.toFixed(2)} ${(centerY - 11).toFixed(2)} Td (${(room.area / 1_000_000).toFixed(1)} sq m) Tj ET`);
      }
    }
  }

  commands.push('0.08 0.1 0.13 RG');
  for (const wall of floor.walls) {
    const lineWidth = wall.type === 'external' ? 2.2 : 1.25;
    commands.push(`${lineWidth} w`, `${px(wall.startPoint.x).toFixed(2)} ${py(wall.startPoint.y).toFixed(2)} m ${px(wall.endPoint.x).toFixed(2)} ${py(wall.endPoint.y).toFixed(2)} l S`);
  }

  if (settings.includeOpenings) {
    commands.push('0.08 0.45 0.7 RG', '1.2 w');
    for (const opening of [...floor.doors, ...floor.windows]) {
      const half = opening.width * fitScale / 2;
      commands.push(`${(px(opening.position.x) - half).toFixed(2)} ${py(opening.position.y).toFixed(2)} m ${(px(opening.position.x) + half).toFixed(2)} ${py(opening.position.y).toFixed(2)} l S`);
    }
  }

  if (settings.includeDimensions) {
    commands.push('0.08 0.45 0.7 rg', `BT /F1 8 Tf ${originX.toFixed(2)} ${(pageHeight - originY + 15).toFixed(2)} Td (${(modelWidth / 1000).toFixed(1)}m wide x ${(modelHeight / 1000).toFixed(1)}m deep) Tj ET`);
  }

  if (settings.includeNorthArrow) {
    const nx = pageWidth - 58;
    const ny = pageHeight - 58;
    commands.push('0.08 0.1 0.13 rg', `${nx} ${ny - 18} m ${nx - 6} ${ny} l ${nx} ${ny - 5} l ${nx + 6} ${ny} l h f`, `BT /F1 10 Tf ${nx - 3} ${ny + 6} Td (N) Tj ET`);
  }

  if (settings.includeScaleBar) {
    commands.push('0.08 0.1 0.13 RG', '1.4 w', `${margin} ${margin + titleHeight + 8} m ${margin + 90} ${margin + titleHeight + 8} l S`, `BT /F1 7 Tf ${margin} ${margin + titleHeight - 3} Td (${ascii(settings.scale)}) Tj ET`);
  }

  if (settings.includeTitleBlock) {
    commands.push('0.08 0.1 0.13 RG', '0.8 w', `${margin} ${margin} ${pageWidth - margin * 2} ${titleHeight - 8} re S`);
    commands.push('0.08 0.1 0.13 rg', `BT /F1 13 Tf ${margin + 10} ${margin + 29} Td (${ascii(building.name)}) Tj ET`);
    commands.push(`BT /F1 8 Tf ${margin + 10} ${margin + 14} Td (${ascii(floor.name)} | ${ascii(settings.scale)} | Rev ${ascii(settings.revision)}) Tj ET`);
    commands.push(`BT /F1 8 Tf ${(pageWidth - 220).toFixed(2)} ${margin + 29} Td (Drawn by ${ascii(settings.drawnBy)}) Tj ET`);
    commands.push(`BT /F1 8 Tf ${(pageWidth - 220).toFixed(2)} ${margin + 14} Td (Project ${ascii(settings.projectNumber)}) Tj ET`);
    commands.push('0.75 0.12 0.12 rg', `BT /F1 8 Tf ${margin + 10} ${margin + 43} Td (CONCEPT / SCHEMATIC DESIGN - NOT FOR CONSTRUCTION) Tj ET`);
  }

  const stream = `${commands.join('\n')}\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${byteLength(stream)} >>\nstream\n${stream}endstream`,
    `<< /Title (${ascii(building.name)}) /Author (${ascii(settings.drawnBy)}) /Subject (Concept schematic floor plan - NOT FOR CONSTRUCTION) /Creator (FORMA AI Planner) >>`,
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
): ExportArtifact {
  const errors = validateExportSettings(settings);
  if (errors.length > 0) throw new Error(errors.join(' '));
  selectedFloor(building, settings.floorId);

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
  const floor = selectedFloor(building, settings.floorId);
  const filename = `${cleanFilename(building.name)}_${cleanFilename(floor.name)}_r${cleanFilename(settings.revision)}.${settings.format}`;
  return {
    filename,
    mimeType,
    extension: settings.format,
    content,
    byteSize: byteLength(content),
  };
}

export function downloadExportArtifact(artifact: ExportArtifact): void {
  const blob = new Blob([artifact.content], { type: artifact.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function formatExportSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

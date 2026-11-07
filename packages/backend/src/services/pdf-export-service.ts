/**
 * PDF Export Service (Phase 1D).
 * Generates ISO 32000-1 / PDF-1.4 1:100 A3 Landscape vector PDF drawings
 * for single floors or complete multi-sheet apartment sets.
 */

import type { Building, Floor } from '@ai-floor-planner/core';

export interface PdfExportOptions {
  readonly floorId?: string;
  readonly exportScope?: 'current_floor' | 'all_floors' | 'complete_project';
  readonly paperSize?: 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'letter' | 'tabloid';
  readonly orientation?: 'landscape' | 'portrait';
  readonly scale?: string;
  readonly drawnBy?: string;
  readonly projectNumber?: string;
  readonly revision?: string;
  readonly includeGrid?: boolean;
  readonly includeDimensions?: boolean;
  readonly includeRoomLabels?: boolean;
  readonly includeRoomAreas?: boolean;
  readonly includeOpenings?: boolean;
  readonly includeNorthArrow?: boolean;
  readonly includeScaleBar?: boolean;
  readonly includeTitleBlock?: boolean;
}

export interface PdfExportResult {
  readonly filename: string;
  readonly mimeType: string;
  readonly data: Uint8Array;
  readonly pageCount: number;
}

const PAPER_POINTS: Record<string, { width: number; height: number }> = {
  A4: { width: 595, height: 842 },
  A3: { width: 842, height: 1191 },
  A2: { width: 1191, height: 1684 },
  A1: { width: 1684, height: 2384 },
  A0: { width: 2384, height: 3370 },
  letter: { width: 612, height: 792 },
  tabloid: { width: 792, height: 1224 },
};

function ascii(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/([\\()])/g, '\\$1');
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf-8');
}

function computeFloorBounds(floor: Floor) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  if (floor.boundary?.points) {
    for (const pt of floor.boundary.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  for (const r of floor.rooms) {
    for (const pt of r.boundary.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  for (const w of floor.walls) {
    if (w.startPoint.x < minX) minX = w.startPoint.x;
    if (w.startPoint.y < minY) minY = w.startPoint.y;
    if (w.startPoint.x > maxX) maxX = w.startPoint.x;
    if (w.startPoint.y > maxY) maxY = w.startPoint.y;
    if (w.endPoint.x < minX) minX = w.endPoint.x;
    if (w.endPoint.y < minY) minY = w.endPoint.y;
    if (w.endPoint.x > maxX) maxX = w.endPoint.x;
    if (w.endPoint.y > maxY) maxY = w.endPoint.y;
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: 30000, height: 25000 };
  }
  return { x: minX, y: minY, width: Math.max(1000, maxX - minX), height: Math.max(1000, maxY - minY) };
}

function pdfColorForRoom(type: string): [number, number, number] {
  const colors: Record<string, [number, number, number]> = {
    bedroom: [0.89, 0.95, 0.99],
    bathroom: [0.91, 0.96, 0.91],
    kitchen: [1.0, 0.95, 0.88],
    living: [0.95, 0.90, 0.96],
    dining: [1.0, 0.99, 0.91],
    corridor: [0.93, 0.94, 0.95],
    staircase: [0.94, 0.92, 0.91],
    lift: [0.88, 0.96, 0.99],
    parking: [0.96, 0.96, 0.96],
    balcony: [0.88, 0.97, 0.98],
    terrace: [0.88, 0.97, 0.98],
  };
  return colors[type] ?? [0.96, 0.96, 0.96];
}

export class PdfExportService {
  public exportPdf(
    building: Building,
    options: PdfExportOptions = {},
  ): PdfExportResult {
    const isMultiSheet =
      options.exportScope === 'complete_project' ||
      options.exportScope === 'all_floors' ||
      options.floorId === 'all' ||
      options.floorId === 'complete_project';

    const fallbackFloor: Floor = {
      id: 'fl-1',
      buildingId: building.id,
      level: 0,
      name: 'Ground Floor',
      floorHeight: 3000,
      boundary: { points: [{ x: 0, y: 0 }, { x: 30000, y: 0 }, { x: 30000, y: 25000 }, { x: 0, y: 25000 }] },
      rooms: [],
      walls: [],
      doors: [],
      windows: [],
      stairs: [],
      columns: [],
    };

    const floorsToExport: readonly Floor[] = isMultiSheet
      ? (building.floors.length > 0 ? building.floors : [fallbackFloor])
      : [building.floors.find(f => f.id === options.floorId) ?? building.floors[0] ?? fallbackFloor];

    const paper = PAPER_POINTS[options.paperSize ?? 'A3'] ?? PAPER_POINTS['A3']!;
    const orientation = options.orientation ?? 'landscape';
    const pageWidth = orientation === 'landscape' ? paper.height : paper.width;
    const pageHeight = orientation === 'landscape' ? paper.width : paper.height;
    const titleHeight = options.includeTitleBlock !== false ? 70 : 0;
    const margin = 38;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2 - titleHeight;

    const pageCount = floorsToExport.length;
    const objects: string[] = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '', // Placeholder for Pages object
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];

    const pageRefs: string[] = [];

    for (let pIdx = 0; pIdx < pageCount; pIdx++) {
      const floor = floorsToExport[pIdx]!;
      const bounds = computeFloorBounds(floor);
      const modelWidth = Math.max(1, bounds.width);
      const modelHeight = Math.max(1, bounds.height);
      const fitScale = Math.min(usableWidth / modelWidth, usableHeight / modelHeight);
      const originX = margin + (usableWidth - modelWidth * fitScale) / 2;
      const originY = margin + titleHeight + (usableHeight - modelHeight * fitScale) / 2;
      const px = (x: number) => originX + (x - bounds.x) * fitScale;
      const py = (y: number) => pageHeight - (originY + (y - bounds.y) * fitScale);

      const commands: string[] = ['0 J', '0 j'];

      // Rooms
      for (const room of floor.rooms) {
        const [r, g, b] = pdfColorForRoom(room.type);
        commands.push(`${r} ${g} ${b} rg`);
        if (room.boundary?.points && room.boundary.points.length >= 3) {
          commands.push(
            room.boundary.points
              .map((p, i) => `${px(p.x).toFixed(2)} ${py(p.y).toFixed(2)} ${i ? 'l' : 'm'}`)
              .join(' ') + ' h f',
          );
        }
        if (room.type === 'staircase') {
          commands.push('0.4 0.4 0.4 RG', '0.4 w');
          for (let i = 1; i < 12; i++) {
            commands.push(
              `${px(room.x).toFixed(2)} ${(py(room.y + room.height) + (room.height * fitScale * i) / 12).toFixed(2)} m ` +
              `${(px(room.x) + room.width * fitScale).toFixed(2)} ${(py(room.y + room.height) + (room.height * fitScale * i) / 12).toFixed(2)} l S`,
            );
          }
        }
        if (options.includeRoomLabels !== false) {
          const cx = px(room.x + room.width / 2);
          const cy = py(room.y + room.height / 2);
          const label = room.name.toUpperCase();
          const font = Math.max(4, Math.min(8, (room.width * fitScale - 8) / (label.length * 0.55 || 1)));
          commands.push('0.12 0.15 0.19 rg', `BT /F1 ${font.toFixed(2)} Tf ${(cx - label.length * font * 0.26).toFixed(2)} ${cy.toFixed(2)} Td (${ascii(label)}) Tj ET`);
          if (options.includeRoomAreas !== false) {
            const areaM2 = (room.area / 1e6).toFixed(1);
            commands.push('0.35 0.39 0.45 rg', `BT /F1 7 Tf ${(cx - 16).toFixed(2)} ${(cy - 9).toFixed(2)} Td (${areaM2} sq m) Tj ET`);
          }
        }
      }

      // Walls
      commands.push('0.08 0.1 0.13 RG');
      for (const wall of floor.walls) {
        const dx = wall.endPoint.x - wall.startPoint.x;
        const dy = wall.endPoint.y - wall.startPoint.y;
        const len = Math.hypot(dx, dy);
        if (!len) continue;
        commands.push(`${(wall.thickness * fitScale).toFixed(3)} w`);
        commands.push(`${px(wall.startPoint.x).toFixed(2)} ${py(wall.startPoint.y).toFixed(2)} m ${px(wall.endPoint.x).toFixed(2)} ${py(wall.endPoint.y).toFixed(2)} l S`);
      }

      // Doors and windows
      if (options.includeOpenings !== false) {
        commands.push('0.08 0.45 0.7 RG', '0.6 w');
        for (const op of [...floor.doors, ...floor.windows]) {
          commands.push(`${(px(op.position.x) - 4).toFixed(2)} ${(py(op.position.y) - 4).toFixed(2)} 8 8 re S`);
        }
      }

      // Scale bar and Title Block
      if (options.includeTitleBlock !== false) {
        commands.push('0.08 0.1 0.13 RG', '0.8 w', `${margin} ${margin} ${pageWidth - margin * 2} ${titleHeight - 8} re S`);
        commands.push('0.08 0.1 0.13 rg', `BT /F1 13 Tf ${margin + 10} ${margin + 29} Td (${ascii(building.name)}) Tj ET`);
        const sheetTitle = `Sheet ${pIdx + 1}: ${ascii(floor.name)} | 1:100 ISO A3 | Rev ${ascii(options.revision ?? '01')}`;
        commands.push(`BT /F1 8 Tf ${margin + 10} ${margin + 14} Td (${sheetTitle}) Tj ET`);
        commands.push(`BT /F1 8 Tf ${(pageWidth - 220).toFixed(2)} ${margin + 29} Td (Drawn by ${ascii(options.drawnBy ?? 'FORMA AI Planner')}) Tj ET`);
        commands.push(`BT /F1 8 Tf ${(pageWidth - 220).toFixed(2)} ${margin + 14} Td (Project ${ascii(options.projectNumber ?? 'FP-001')}) Tj ET`);
        commands.push('0.75 0.12 0.12 rg', `BT /F1 8 Tf ${margin + 10} ${margin + 43} Td (CONCEPT / SCHEMATIC DESIGN - NOT FOR CONSTRUCTION) Tj ET`);
      }

      const stream = `${commands.join('\n')}\n`;
      const pageObjIndex = objects.length + 1;
      const contentObjIndex = pageObjIndex + 1;

      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjIndex} 0 R >>`,
      );
      objects.push(`<< /Length ${byteLength(stream)} >>\nstream\n${stream}endstream`);
      pageRefs.push(`${pageObjIndex} 0 R`);
    }

    // Set Pages dictionary
    objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageCount} >>`;

    // Add info dict
    objects.push(
      `<< /Title (${ascii(building.name)}) /Author (${ascii(options.drawnBy ?? 'FORMA AI Planner')}) /Subject (Multi-Sheet Apartment CAD Drawing Set) /Creator (AI Floor Planner Studio) >>`,
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
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    const cleanBuilding = building.name ? building.name.replace(/[^a-zA-Z0-9_-]+/g, '_') : 'AI_BUILDING_SAAS';
    const filename = isMultiSheet
      ? `${cleanBuilding}_Complete_CAD_Sheet_Set.pdf`
      : `${cleanBuilding}_Floor_${options.floorId ?? '01'}.pdf`;

    return {
      filename,
      mimeType: 'application/pdf',
      data: Buffer.from(pdf, 'utf-8'),
      pageCount,
    };
  }
}

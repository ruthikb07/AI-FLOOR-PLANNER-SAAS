import { PDFDocument, rgb, StandardFonts, type PDFFont } from 'pdf-lib';
import type { Building } from '@ai-floor-planner/core';
import {
  MANDATORY_STRUCTURAL_DISCLAIMER,
  snapshotSolverBackends,
  type FullStructuralEvaluationSnapshot,
  type ReviewedStructuralInputs,
} from '@ai-floor-planner/structural-engine';
import { ExportError } from './export-selection.js';
import { StructuralAnalysisEngine } from './structural-analysis-engine.js';

function printableText(value: string, font: PDFFont): string {
  const supported = new Set(font.getCharacterSet());
  return Array.from(value, (char) => {
    const code = char.codePointAt(0)!;
    return supported.has(code) ? char : '[U+' + code.toString(16).toUpperCase() + ']';
  }).join('');
}

export class StructuralDrawingsService {
  /**
   * Preserves quarantine refusal when called without reviewed engineering inputs,
   * and generates a verified multi-sheet vector PDF structural drawing & BBS package when reviewed inputs are provided.
   */
  public async generateStructuralDrawingPackage(
    building: Building,
    reviewedInputs?: ReviewedStructuralInputs,
  ): Promise<{
    filename: string;
    mimeType: string;
    data: Uint8Array;
    pageCount: number;
  }> {
    if (!reviewedInputs) {
      throw new ExportError(
        'REVIEWED_STRUCTURAL_MODEL_REQUIRED',
        'NOT_VERIFIED: architectural geometry cannot supply approved structural sections, foundations or reinforcement.',
        409,
      );
    }
    const snapshot = await new StructuralAnalysisEngine().analyzeReviewedBuilding(
      building,
      reviewedInputs,
    );
    return this.generateReviewedStructuralDrawingPdf(snapshot, building.name || building.id);
  }

  public async generateReviewedStructuralDrawingPdf(
    snapshot: FullStructuralEvaluationSnapshot,
    projectName = 'RH Planner Structural Package',
  ): Promise<{
    filename: string;
    mimeType: string;
    data: Uint8Array;
    pageCount: number;
  }> {
    const pdfDoc = await PDFDocument.create();
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const pageW = 1190.55; // ISO A3 Landscape width (pt)
    const pageH = 841.89; // ISO A3 Landscape height (pt)

    const addHeaderAndBorder = (page: ReturnType<typeof pdfDoc.addPage>, sheetNo: string, title: string) => {
      page.drawRectangle({
        x: 24,
        y: 24,
        width: pageW - 48,
        height: pageH - 48,
        borderColor: rgb(0.15, 0.2, 0.28),
        borderWidth: 1.5,
      });
      page.drawText(`${sheetNo} — ${title}`, {
        x: 40,
        y: pageH - 52,
        size: 14,
        font: fontBold,
        color: rgb(0.08, 0.12, 0.2),
      });
      page.drawText(
        printableText(`Project: ${projectName} | Arch Rev: v${snapshot.system.sourceArchitecturalRevision} (${snapshot.system.sourceArchitecturalSha256.slice(0, 12)}) | Solver: ${snapshotSolverBackends(snapshot)}`, fontReg),
        {
          x: 40,
          y: pageH - 70,
          size: 8.5,
          font: fontReg,
          color: rgb(0.3, 0.35, 0.42),
        },
      );
      page.drawText(MANDATORY_STRUCTURAL_DISCLAIMER, {
        x: 40,
        y: 34,
        size: 7.5,
        font: fontBold,
        color: rgb(0.65, 0.15, 0.12),
      });
    };

    function plotLabeler(page: ReturnType<typeof pdfDoc.addPage>, font: PDFFont, size: number) {
      const occupied: { left: number; bottom: number; right: number; top: number }[] = [];
      let omitted = 0;
      return {
        label(text: string, x: number, y: number) {
          const value = printableText(text, font);
          const width = font.widthOfTextAtSize(value, size);
          const offsets = [
            [3, 4], [-width - 3, 4], [3, -9], [-width - 3, -9], [-width / 2, 11], [-width / 2, -15],
          ];
          for (const [dx, dy] of offsets) {
            const targetX = x + dx!;
            const targetY = y + dy!;
            const box = { left: targetX - 1, bottom: targetY - 1, right: targetX + width + 1, top: targetY + size + 1 };
            if (box.left < 36 || box.right > pageW - 36 || box.bottom < 52 || box.top > pageH - 100) continue;
            if (occupied.some((item) => box.left < item.right && item.left < box.right &&
              box.bottom < item.top && item.bottom < box.top)) continue;
            occupied.push(box);
            if (Math.abs(dy!) >= 9) {
              page.drawLine({
                start: { x, y },
                end: { x: targetX + width / 2, y: targetY + (dy! < 0 ? size : 0) },
                thickness: 0.4, color: rgb(0.55, 0.58, 0.62),
              });
            }
            page.drawText(value, { x: targetX, y: targetY, size, font, color: rgb(0.1, 0.15, 0.25) });
            return;
          }
          omitted++;
        },
        note(description: string) {
          if (omitted === 0) return;
          page.drawText(omitted + ' nearby labels omitted from plan. ' + description,
            { x: 650, y: pageH - 132, size: 8, font: fontReg });
        },
      };
    }

    // Sheet 1: Foundation Layout & Footing Schedule
    const p1 = pdfDoc.addPage([pageW, pageH]);
    addHeaderAndBorder(p1, 'S-101', 'FOUNDATION LAYOUT, COLUMN GRID & BEARING REVIEW');

    const stacks = Object.values(snapshot.system.baseColumnStackMap);
    const xs = stacks.map((s) => s.xMm);
    const ys = stacks.map((s) => s.yMm);
    const minX = Math.min(...xs, 0) - 1500;
    const maxX = Math.max(...xs, 6000) + 1500;
    const minY = Math.min(...ys, 0) - 1500;
    const maxY = Math.max(...ys, 6000) + 1500;
    const scale = Math.min(540 / Math.max(1000, maxX - minX), 620 / Math.max(1000, maxY - minY));
    const mapX = (xMm: number) => 60 + (xMm - minX) * scale;
    const mapY = (yMm: number) => 720 - (yMm - minY) * scale;

    for (const ft of snapshot.foundationDesign.footings) {
      const fw = ft.lengthXMm * scale;
      const fh = ft.widthYMm * scale;
      p1.drawRectangle({
        x: mapX(ft.centerXMm) - fw / 2,
        y: mapY(ft.centerYMm) - fh / 2,
        width: fw,
        height: fh,
        borderColor: ft.status === 'PASSED' ? rgb(0.08, 0.48, 0.32) : rgb(0.8, 0.15, 0.15),
        borderWidth: 1.2,
        color: rgb(0.93, 0.97, 0.95),
      });
      p1.drawText(`${ft.footingId} (${ft.lengthXMm}x${ft.widthYMm})`, {
        x: mapX(ft.centerXMm) - fw / 2 + 3,
        y: mapY(ft.centerYMm) - fh / 2 + 4,
        size: 6.5,
        font: fontReg,
        color: rgb(0.1, 0.3, 0.2),
      });
    }

    const stackLabels = plotLabeler(p1, fontBold, 7.5);
    for (const stk of stacks) {
      const cw = Math.max(6, stk.columnWidthMm * scale);
      const cd = Math.max(6, stk.columnDepthMm * scale);
      p1.drawRectangle({
        x: mapX(stk.xMm) - cw / 2,
        y: mapY(stk.yMm) - cd / 2,
        width: cw,
        height: cd,
        color: rgb(0.15, 0.22, 0.35),
      });
      stackLabels.label(stk.stackId, mapX(stk.xMm) + cw / 2, mapY(stk.yMm));
    }

    stackLabels.note('See the column reinforcement schedule for all member IDs.');
    p1.drawText(`FOUNDATION STATUS: ${snapshot.foundationDesign.status} (${snapshot.foundationDesign.selectedStrategy})`, {
      x: 650,
      y: pageH - 110,
      size: 9.5,
      font: fontBold,
      color: rgb(0.1, 0.15, 0.25),
    });
    function addSchedule(sheetNumber: string, title: string, rows: readonly string[], summary?: string) {
      const rowsPerPage = 50;
      const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage));
      for (let index = 0; index < pageCount; index++) {
        const page = pdfDoc.addPage([pageW, pageH]);
        addHeaderAndBorder(page, sheetNumber + '.' + (index + 1), title);
        if (summary) {
          page.drawText(printableText(summary, fontReg), { x: 40, y: pageH - 100, size: 8.5, font: fontReg });
        }
        const pageRows = rows.slice(index * rowsPerPage, (index + 1) * rowsPerPage);
        for (const [rowIndex, line] of pageRows.entries()) {
          page.drawText(printableText(line, fontReg), {
            x: 40, y: pageH - 125 - rowIndex * 13, size: 7.5, font: fontReg,
            maxWidth: pageW - 80,
          });
        }
      }
    }

    const { system, rccDesign, foundationDesign, detailingAndBoq } = snapshot;
    if (foundationDesign.footings.length) {
      addSchedule('S-101F', 'FOUNDATION SCHEDULE', foundationDesign.footings.map((footing) =>
        `${footing.footingId} [${footing.typology}] ${footing.lengthXMm}x${footing.widthYMm}x${footing.thicknessMm}mm | q=${footing.maxSoilPressureKPa}/${footing.allowableBearingPressureKPa} kPa | ${footing.bottomMeshXLabel} | ${footing.status}`));
    }

    const planLabels = new Map<string, string>();
    for (const [index, floor] of system.storeys.entries()) {
      const page = pdfDoc.addPage([pageW, pageH]);
      addHeaderAndBorder(page, 'S-102.' + (index + 1), printableText('FRAME PLAN - ' + (floor.name || floor.id), fontBold));
      const beamLabels = plotLabeler(page, fontReg, 7);
      const beams = rccDesign.beams.filter((item) => item.floorId === floor.id);
      for (const [beamIndex, beam] of beams.entries()) {
        const element = system.elements[beam.elementIndex]!;
        const start = system.nodes[element.startNodeIndex]!.positionM;
        const end = system.nodes[element.endNodeIndex]!.positionM;
        const a = { x: mapX(start[0] * 1000), y: mapY(-start[1] * 1000) };
        const b = { x: mapX(end[0] * 1000), y: mapY(-end[1] * 1000) };
        page.drawLine({ start: a, end: b, thickness: 1.25 });
        const label = 'B' + (beamIndex + 1);
        planLabels.set(beam.elementId, floor.id + ' ' + label);
        beamLabels.label(label, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      page.drawText('Beam keys are indexed by floor in the reinforcement schedule.', {
        x: 650, y: pageH - 110, size: 8, font: fontReg,
      });
      beamLabels.note('The schedule includes all beam keys.');
      for (const column of rccDesign.columns.filter((item) => item.floorId === floor.id)) {
        const element = system.elements[column.elementIndex]!;
        const end = system.nodes[element.endNodeIndex]!.positionM;
        const width = column.widthMm * scale;
        const depth = column.depthMm * scale;
        page.drawRectangle({ x: mapX(end[0] * 1000) - width / 2, y: mapY(-end[1] * 1000) - depth / 2, width, height: depth });
      }
    }

    addSchedule('S-103C', 'COLUMN REINFORCEMENT SCHEDULE', rccDesign.columns.map((column) =>
      `${column.elementId} (${column.widthMm}x${column.depthMm} mm, ${column.concreteGrade}) | Pu=${column.demandPuKn} kN | Main: ${column.longitudinalBars.label} | Ties: ${column.lateralTies.label} | Util=${column.maxUtilization} [${column.status}]`));
    addSchedule('S-103B', 'BEAM REINFORCEMENT SCHEDULE', rccDesign.beams.map((beam) =>
      `${planLabels.has(beam.elementId) ? planLabels.get(beam.elementId) + ' | ' : ''}${beam.elementId} (${beam.widthMm}x${beam.depthMm}, L=${beam.clearSpanMm} mm) | Top: ${beam.topBarsSupport.label} | Bottom: ${beam.bottomBarsMidspan.label} | ${beam.stirrups.label} | Util=${beam.maxUtilization} [${beam.status}]`));
    addSchedule('S-103S', 'SLAB REINFORCEMENT SCHEDULE', rccDesign.slabs.map((slab) =>
      `${slab.panelId} (${slab.roomName}, ${slab.thicknessMm} mm ${slab.panelType}) | Short: T${slab.shortSpanBottomDiaMm}@${slab.shortSpanBottomSpacingMm} | Long: T${slab.longSpanDiaMm}@${slab.longSpanSpacingMm} | Util=${slab.maxUtilization} [${slab.status}]`));
    if (rccDesign.stairs.length) {
      addSchedule('S-103T', 'STAIR WAIST REINFORCEMENT SCHEDULE', rccDesign.stairs.map((stair) =>
        `${stair.waistId} | Span ${stair.spanMm} mm | Waist ${stair.waistThicknessMm} mm | Main T${stair.mainBarDiaMm}@${stair.mainBarSpacingMm} | Distribution T${stair.distributionBarDiaMm}@${stair.distributionBarSpacingMm} | ${stair.status}`));
    }
    const boq = detailingAndBoq.quantities;
    addSchedule('S-104', 'BAR BENDING & MATERIAL QUANTITIES', detailingAndBoq.bbsEntries.map((row) =>
      `${row.barMark} | ${row.memberId} | ${row.memberCategory} | T${row.barDiaMm} | ${row.totalBars} bars | Cut ${row.cuttingLengthMm} mm | ${row.totalLengthM} m | ${row.totalWeightKg} kg | ${row.description}`),
    `Net concrete ${boq.netConcreteVolumeM3} m3 | Deduction ${boq.jointAndSlabIntersectionDeductionM3} m3 | Rebar ${boq.totalSteelWeightKg} kg | Formwork ${boq.formworkAreaM2} m2 | Excavation ${boq.excavationVolumeM3} m3`);

    const pdfBytes = await pdfDoc.save();
    const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
    return {
      filename: `${safeName}_structural_drawings_and_bbs.pdf`,
      mimeType: 'application/pdf',
      data: pdfBytes,
      pageCount: pdfDoc.getPageCount(),
    };
  }
}

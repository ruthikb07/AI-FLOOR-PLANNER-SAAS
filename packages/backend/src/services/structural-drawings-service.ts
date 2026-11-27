import { PDFDocument, rgb, StandardFonts, type PDFFont } from 'pdf-lib';
import type { Building } from '@ai-floor-planner/core';
import {
  MANDATORY_STRUCTURAL_DISCLAIMER,
  snapshotDrawingApprovalStatus,
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
    const approvalStatus = snapshotDrawingApprovalStatus(snapshot);
    const isDiagnosticOnly = approvalStatus === 'DIAGNOSTIC_NOT_FOR_CONSTRUCTION';

    const addHeaderAndBorder = (
      page: ReturnType<typeof pdfDoc.addPage>,
      sheetNo: string,
      title: string,
    ) => {
      page.drawRectangle({
        x: 24,
        y: 24,
        width: pageW - 48,
        height: pageH - 48,
        borderColor: isDiagnosticOnly ? rgb(0.75, 0.12, 0.12) : rgb(0.15, 0.2, 0.28),
        borderWidth: isDiagnosticOnly ? 2.2 : 1.5,
      });
      page.drawText(`${sheetNo} — ${title}`, {
        x: 40,
        y: pageH - 50,
        size: 13.5,
        font: fontBold,
        color: rgb(0.08, 0.12, 0.2),
      });
      page.drawText(
        printableText(
          `Project: ${projectName} | Arch Rev: v${snapshot.system.sourceArchitecturalRevision} (${snapshot.system.sourceArchitecturalSha256.slice(0, 12)}) | Struct Rev: r${snapshot.system.structuralRevision} | Solver: ${snapshotSolverBackends(snapshot)}`,
          fontReg,
        ),
        {
          x: 40,
          y: pageH - 67,
          size: 8.2,
          font: fontReg,
          color: rgb(0.3, 0.35, 0.42),
        },
      );
      if (isDiagnosticOnly) {
        page.drawRectangle({
          x: 40,
          y: pageH - 88,
          width: pageW - 80,
          height: 16,
          color: rgb(0.96, 0.88, 0.88),
          borderColor: rgb(0.8, 0.15, 0.15),
          borderWidth: 0.8,
        });
        page.drawText(
          printableText(
            `DIAGNOSTIC REPORT ONLY (${snapshot.designLifecycleStatus}) — FAILED / UNSUPPORTED / UNREVIEWED CHECKS PRESENT — NOT APPROVED FOR CONSTRUCTION`,
            fontBold,
          ),
          {
            x: 48,
            y: pageH - 83,
            size: 8,
            font: fontBold,
            color: rgb(0.72, 0.08, 0.08),
          },
        );
      }
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
            [3, 4],
            [-width - 3, 4],
            [3, -9],
            [-width - 3, -9],
            [-width / 2, 11],
            [-width / 2, -15],
          ];
          for (const [dx, dy] of offsets) {
            const targetX = x + dx!;
            const targetY = y + dy!;
            const box = {
              left: targetX - 1,
              bottom: targetY - 1,
              right: targetX + width + 1,
              top: targetY + size + 1,
            };
            if (box.left < 36 || box.right > pageW - 36 || box.bottom < 52 || box.top > pageH - 104) continue;
            if (
              occupied.some(
                (item) =>
                  box.left < item.right &&
                  item.left < box.right &&
                  box.bottom < item.top &&
                  item.bottom < box.top,
              )
            ) {
              continue;
            }
            occupied.push(box);
            if (Math.abs(dy!) >= 9) {
              page.drawLine({
                start: { x, y },
                end: { x: targetX + width / 2, y: targetY + (dy! < 0 ? size : 0) },
                thickness: 0.4,
                color: rgb(0.55, 0.58, 0.62),
              });
            }
            page.drawText(value, { x: targetX, y: targetY, size, font, color: rgb(0.1, 0.15, 0.25) });
            return;
          }
          omitted++;
        },
        note(description: string) {
          if (omitted === 0) return;
          page.drawText(omitted + ' nearby labels omitted from plan. ' + description, {
            x: 650,
            y: pageH - 138,
            size: 8,
            font: fontReg,
          });
        },
      };
    }

    // Sheet 1: Foundation Layout, Footing Section & Column Grid
    const p1 = pdfDoc.addPage([pageW, pageH]);
    addHeaderAndBorder(p1, 'S-101', 'FOUNDATION LAYOUT, SECTION DETAIL & COLUMN GRID');

    const stacks = Object.values(snapshot.system.baseColumnStackMap);
    const xs = stacks.map((s) => s.xMm);
    const ys = stacks.map((s) => s.yMm);
    const minX = Math.min(...xs, 0) - 1500;
    const maxX = Math.max(...xs, 6000) + 1500;
    const minY = Math.min(...ys, 0) - 1500;
    const maxY = Math.max(...ys, 6000) + 1500;
    const scale = Math.min(520 / Math.max(1000, maxX - minX), 600 / Math.max(1000, maxY - minY));
    const mapX = (xMm: number) => 55 + (xMm - minX) * scale;
    const mapY = (yMm: number) => 700 - (yMm - minY) * scale;

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
      p1.drawText(`${ft.footingId} [${ft.scheduleGroupMark}] (${ft.lengthXMm}x${ft.widthYMm})`, {
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
    stackLabels.note('See consolidated column schedule for all stack marks.');

    // Right side of S-101: Typical Foundation & Reinforcement Cross-Section Detail!
    p1.drawText(
      printableText(
        `FOUNDATION STATUS: ${snapshot.foundationDesign.status} (${snapshot.foundationDesign.selectedStrategy})`,
        fontBold,
      ),
      { x: 640, y: pageH - 115, size: 9.5, font: fontBold, color: rgb(0.1, 0.15, 0.25) },
    );
    const repFoot = snapshot.foundationDesign.footings[0];
    if (repFoot) {
      p1.drawText('TYPICAL FOUNDATION & STARTER DOWEL CROSS-SECTION', {
        x: 640,
        y: 520,
        size: 9,
        font: fontBold,
        color: rgb(0.12, 0.18, 0.3),
      });
      // PCC Blinding layer
      p1.drawRectangle({ x: 660, y: 310, width: 380, height: 14, color: rgb(0.86, 0.88, 0.9), borderColor: rgb(0.4, 0.45, 0.5), borderWidth: 0.8 });
      // RCC Footing / Raft pad
      p1.drawRectangle({ x: 675, y: 324, width: 350, height: 64, color: rgb(0.92, 0.95, 0.98), borderColor: rgb(0.15, 0.25, 0.4), borderWidth: 1.4 });
      // Bottom rebar mesh line + U-hooks
      p1.drawLine({ start: { x: 685, y: 334 }, end: { x: 1015, y: 334 }, thickness: 2, color: rgb(0.8, 0.2, 0.15) });
      p1.drawLine({ start: { x: 685, y: 334 }, end: { x: 685, y: 374 }, thickness: 2, color: rgb(0.8, 0.2, 0.15) });
      p1.drawLine({ start: { x: 1015, y: 334 }, end: { x: 1015, y: 374 }, thickness: 2, color: rgb(0.8, 0.2, 0.15) });
      // Column pedestal + L-bent starter dowels
      p1.drawRectangle({ x: 825, y: 388, width: 50, height: 110, color: rgb(0.88, 0.92, 0.96), borderColor: rgb(0.15, 0.25, 0.4), borderWidth: 1.3 });
      p1.drawLine({ start: { x: 834, y: 490 }, end: { x: 834, y: 340 }, thickness: 1.6, color: rgb(0.1, 0.45, 0.75) });
      p1.drawLine({ start: { x: 834, y: 340 }, end: { x: 795, y: 340 }, thickness: 1.6, color: rgb(0.1, 0.45, 0.75) });
      p1.drawLine({ start: { x: 866, y: 490 }, end: { x: 866, y: 340 }, thickness: 1.6, color: rgb(0.1, 0.45, 0.75) });
      p1.drawLine({ start: { x: 866, y: 340 }, end: { x: 905, y: 340 }, thickness: 1.6, color: rgb(0.1, 0.45, 0.75) });
      p1.drawText(
        printableText(
          `${repFoot.footingId}: ${repFoot.lengthXMm}x${repFoot.widthYMm}x${repFoot.thicknessMm} mm (${repFoot.concreteGrade}) + ${repFoot.pccThicknessMm}mm PCC`,
          fontReg,
        ),
        { x: 660, y: 292, size: 8, font: fontReg },
      );
      p1.drawText(
        printableText(
          `Bottom Mesh: ${repFoot.bottomMeshXLabel} | Dowel Ld=${repFoot.starterDowelEmbedmentMm}mm | q_net=${repFoot.maxSoilPressureKPa}/${repFoot.allowableBearingPressureKPa} kPa`,
          fontReg,
        ),
        { x: 660, y: 277, size: 8, font: fontReg },
      );
    }

    function addSchedule(
      sheetNumber: string,
      title: string,
      rows: readonly string[],
      summary?: string,
    ) {
      const rowsPerPage = 46;
      const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage));
      for (let index = 0; index < pageCount; index++) {
        const page = pdfDoc.addPage([pageW, pageH]);
        addHeaderAndBorder(page, sheetNumber + '.' + (index + 1), title);
        if (summary) {
          page.drawText(printableText(summary, fontReg), {
            x: 40,
            y: pageH - 106,
            size: 8.5,
            font: fontReg,
          });
        }
        const pageRows = rows.slice(index * rowsPerPage, (index + 1) * rowsPerPage);
        for (const [rowIndex, line] of pageRows.entries()) {
          page.drawText(printableText(line, fontReg), {
            x: 40,
            y: pageH - 128 - rowIndex * 13.5,
            size: 7.5,
            font: fontReg,
            maxWidth: pageW - 80,
          });
        }
      }
    }

    const { system, rccDesign, foundationDesign, detailingAndBoq } = snapshot;
    if (foundationDesign.footings.length) {
      addSchedule(
        'S-101F',
        'PHYSICAL FOUNDATION SCHEDULE',
        foundationDesign.footings.map(
          (f) =>
            `${f.footingId} [${f.scheduleGroupMark} | ${f.typology}] ${f.lengthXMm}x${f.widthYMm}x${f.thicknessMm}mm | q_net=${f.maxSoilPressureKPa}/${f.allowableBearingPressureKPa} kPa | s_i=${f.estimatedSettlementMm}/${f.allowableSettlementMm}mm | ${f.bottomMeshXLabel} | ${f.status}`,
        ),
      );
    }

    // Storey Physical Framing & Slab Reinforcement Plans (drawing full physical beam spans!)
    const planLabels = new Map<string, string>();
    for (const [index, floor] of system.storeys.entries()) {
      const page = pdfDoc.addPage([pageW, pageH]);
      addHeaderAndBorder(
        page,
        'S-102.' + (index + 1),
        printableText('PHYSICAL BEAM & SLAB FRAMING PLAN - ' + (floor.name || floor.id), fontBold),
      );
      const beamLabels = plotLabeler(page, fontReg, 7);
      const beams = rccDesign.beams.filter((item) => item.floorId === floor.id);
      for (const [beamIndex, beam] of beams.entries()) {
        const childIndices =
          beam.analyticalElementIndices && beam.analyticalElementIndices.length > 0
            ? beam.analyticalElementIndices
            : [beam.elementIndex];
        const firstEl = system.elements[childIndices[0]!]!;
        const lastEl = system.elements[childIndices[childIndices.length - 1]!]!;
        const start = system.nodes[firstEl.startNodeIndex]!.positionM;
        const end = system.nodes[lastEl.endNodeIndex]!.positionM;
        const a = { x: mapX(start[0] * 1000), y: mapY(-start[1] * 1000) };
        const b = { x: mapX(end[0] * 1000), y: mapY(-end[1] * 1000) };
        page.drawLine({
          start: a,
          end: b,
          thickness: beam.status === 'PASSED' ? 1.35 : 1.9,
          color: beam.status === 'PASSED' ? rgb(0.12, 0.25, 0.45) : rgb(0.8, 0.15, 0.15),
        });
        const label = `B${beamIndex + 1}[${beam.scheduleGroupMark}]`;
        planLabels.set(beam.physicalMemberId, `${floor.id} ${label}`);
        beamLabels.label(label, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      beamLabels.note('All physical beam callouts & group marks are listed in S-103B.');

      for (const column of rccDesign.columns.filter((item) => item.floorId === floor.id)) {
        const childIndices =
          column.analyticalElementIndices && column.analyticalElementIndices.length > 0
            ? column.analyticalElementIndices
            : [column.elementIndex];
        const lastEl = system.elements[childIndices[childIndices.length - 1]!]!;
        const end = system.nodes[lastEl.endNodeIndex]!.positionM;
        const width = Math.max(4, column.widthMm * scale);
        const depth = Math.max(4, column.depthMm * scale);
        page.drawRectangle({
          x: mapX(end[0] * 1000) - width / 2,
          y: mapY(-end[1] * 1000) - depth / 2,
          width,
          height: depth,
          color: column.status === 'PASSED' ? rgb(0.15, 0.22, 0.35) : rgb(0.8, 0.15, 0.15),
        });
      }

      // Typical Beam & Column Reinforcement Cross-Section Diagram on right side of Storey 1 Plan!
      if (index === 0) {
        const repBm = beams[0];
        const repCol = rccDesign.columns.find((c) => c.floorId === floor.id) ?? rccDesign.columns[0];
        if (repBm && repCol) {
          page.drawText('TYPICAL DUCTILE BEAM & COLUMN CROSS-SECTIONS (IS 13920:2016)', {
            x: 650,
            y: 540,
            size: 8.5,
            font: fontBold,
          });
          // Beam section box
          page.drawRectangle({ x: 660, y: 360, width: 120, height: 155, borderColor: rgb(0.15, 0.2, 0.3), borderWidth: 1.4, color: rgb(0.95, 0.97, 0.99) });
          page.drawRectangle({ x: 672, y: 372, width: 96, height: 131, borderColor: rgb(0.2, 0.5, 0.8), borderWidth: 1.0 });
          for (const bx of [682, 720, 758]) {
            page.drawCircle({ x: bx, y: 493, size: 4, color: rgb(0.8, 0.15, 0.15) });
            page.drawCircle({ x: bx, y: 382, size: 4, color: rgb(0.1, 0.45, 0.3) });
          }
          page.drawText(
            printableText(`${repBm.scheduleGroupMark}: ${repBm.widthMm}x${repBm.depthMm} | Top ${repBm.topBarsSupport.label}`, fontReg),
            { x: 650, y: 342, size: 7.5, font: fontReg },
          );
          page.drawText(
            printableText(`Bot ${repBm.bottomBarsMidspan.label} | ${repBm.stirrups.label}`, fontReg),
            { x: 650, y: 329, size: 7.5, font: fontReg },
          );

          // Column section box
          page.drawRectangle({ x: 870, y: 375, width: 130, height: 140, borderColor: rgb(0.15, 0.2, 0.3), borderWidth: 1.4, color: rgb(0.95, 0.97, 0.99) });
          page.drawRectangle({ x: 884, y: 389, width: 102, height: 112, borderColor: rgb(0.2, 0.5, 0.8), borderWidth: 1.0 });
          for (const [cx, cy] of [[892, 493], [935, 493], [978, 493], [892, 445], [978, 445], [892, 397], [935, 397], [978, 397]] as const) {
            page.drawCircle({ x: cx, y: cy, size: 4.2, color: rgb(0.8, 0.15, 0.15) });
          }
          page.drawText(
            printableText(`${repCol.scheduleGroupMark}: ${repCol.widthMm}x${repCol.depthMm} (${repCol.concreteGrade}) | ${repCol.longitudinalBars.label}`, fontReg),
            { x: 860, y: 356, size: 7.5, font: fontReg },
          );
          page.drawText(printableText(`Confining Hoops: ${repCol.lateralTies.label}`, fontReg), {
            x: 860,
            y: 343,
            size: 7.5,
            font: fontReg,
          });
        }
      }
    }

    // Consolidated Schedules (grouped by physical scheduleGroupMark!)
    const colGroups = new Map<string, { sample: (typeof rccDesign.columns)[number]; ids: string[]; maxUtil: number }>();
    for (const c of rccDesign.columns) {
      const g = colGroups.get(c.scheduleGroupMark);
      if (g) {
        g.ids.push(c.physicalMemberId);
        g.maxUtil = Math.max(g.maxUtil, c.maxUtilization);
      } else {
        colGroups.set(c.scheduleGroupMark, { sample: c, ids: [c.physicalMemberId], maxUtil: c.maxUtilization });
      }
    }
    addSchedule(
      'S-103C',
      'CONSOLIDATED PHYSICAL COLUMN REINFORCEMENT SCHEDULE',
      [...colGroups.entries()].map(
        ([grp, { sample: col, ids, maxUtil }]) =>
          `${grp} (${ids.length} lifts: ${ids.slice(0, 4).join(', ')}${ids.length > 4 ? '...' : ''}) | ${col.floorId} | ${col.widthMm}x${col.depthMm}mm (${col.concreteGrade}) | Main: ${col.longitudinalBars.label} | Hoops: ${col.lateralTies.label} | Peak Util=${maxUtil.toFixed(3)} [${col.status}]`,
      ),
      `Total Physical Column Lifts: ${rccDesign.columns.length} consolidated into ${colGroups.size} constructible column groups.`,
    );

    const bmGroups = new Map<string, { sample: (typeof rccDesign.beams)[number]; ids: string[]; maxUtil: number }>();
    for (const b of rccDesign.beams) {
      const g = bmGroups.get(b.scheduleGroupMark);
      if (g) {
        g.ids.push(b.physicalMemberId);
        g.maxUtil = Math.max(g.maxUtil, b.maxUtilization);
      } else {
        bmGroups.set(b.scheduleGroupMark, { sample: b, ids: [b.physicalMemberId], maxUtil: b.maxUtilization });
      }
    }
    addSchedule(
      'S-103B',
      'CONSOLIDATED PHYSICAL BEAM REINFORCEMENT SCHEDULE',
      [...bmGroups.entries()].map(
        ([grp, { sample: bm, ids, maxUtil }]) =>
          `${grp} (${ids.length} beams: ${ids.slice(0, 3).join(', ')}${ids.length > 3 ? '...' : ''}) | ${bm.floorId} | ${bm.widthMm}x${bm.depthMm}mm | Top: ${bm.topBarsSupport.label} | Bot: ${bm.bottomBarsMidspan.label} | ${bm.stirrups.label} | Peak Util=${maxUtil.toFixed(3)} [${bm.status}]`,
      ),
      `Total Physical Beams: ${rccDesign.beams.length} (Analytical FEA Segments: ${system.elements.filter((e) => e.category !== 'COLUMN').length}) consolidated into ${bmGroups.size} beam groups.`,
    );

    addSchedule(
      'S-103S',
      'PHYSICAL SLAB BAY REINFORCEMENT SCHEDULE',
      rccDesign.slabs.map(
        (slab) =>
          `${slab.panelId} [${slab.scheduleGroupMark}] (${slab.roomName}, ${slab.lxMm}x${slab.lyMm}x${slab.thicknessMm} mm ${slab.panelType}) | Short: T${slab.shortSpanBottomDiaMm}@${slab.shortSpanBottomSpacingMm} | Long: T${slab.longSpanDiaMm}@${slab.longSpanSpacingMm} | Util=${slab.maxUtilization} [${slab.status}]`,
      ),
    );

    if (rccDesign.stairs.length) {
      addSchedule(
        'S-103T',
        'STAIRCASE WAIST REINFORCEMENT SCHEDULE & DETAIL',
        rccDesign.stairs.map(
          (stair) =>
            `${stair.waistId} (${stair.floorId}) | Span ${stair.spanMm} mm | Waist ${stair.waistThicknessMm} mm | Main T${stair.mainBarDiaMm}@${stair.mainBarSpacingMm} mm c/c | Dist T${stair.distributionBarDiaMm}@${stair.distributionBarSpacingMm} mm c/c | Util=${stair.maxUtilization} [${stair.status}]`,
        ),
      );
    }

    const boq = detailingAndBoq.quantities;
    addSchedule(
      'S-104',
      'CONSOLIDATED BAR BENDING SCHEDULE (BBS) & DEDUPLICATED BOQ',
      detailingAndBoq.bbsEntries.map(
        (row) =>
          `${row.barMark} | ${row.memberId} | ${row.memberCategory} | T${row.barDiaMm} | ${row.memberCount}x${row.barsPerMember}=${row.totalBars} bars | Cut ${row.cuttingLengthMm} mm | ${row.totalLengthM} m | ${row.totalWeightKg} kg | ${row.description}`,
      ),
      `Net Concrete: ${boq.netConcreteVolumeM3} m3 (Joint Deduction: ${boq.jointAndSlabIntersectionDeductionM3} m3) | Total Rebar: ${boq.totalSteelWeightKg} kg (${boq.totalSteelTonnes} MT) | Formwork: ${boq.formworkAreaM2} m2 | Excavation: ${boq.excavationVolumeM3} m3`,
    );

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

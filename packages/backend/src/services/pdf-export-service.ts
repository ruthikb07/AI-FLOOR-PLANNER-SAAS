/**
 * PDF Export Service (Phase 1D).
 * Generates ISO 32000-1 / PDF-1.4 1:100 A3 Landscape vector PDF drawings
 * for single floors or complete multi-sheet apartment sets.
 */

import { createHash } from 'node:crypto';
import type { Building, Floor } from '@ai-floor-planner/core';
import { AnnotationLayout, roomAnnotation, polygonCentroid, getFloorContentBounds } from '@ai-floor-planner/geometry-engine';
import { selectExportFloors, resolveExportScope, ExportError } from './export-selection.js';
import { verifyPdfArtifact } from './artifact-verifier.js';
import { evaluateStudioLayoutScore } from '@ai-floor-planner/planning-engine';
import { complianceReport, complianceReportPdf } from './compliance-report-service.js';

export interface PdfExportOptions {
  readonly drawingKind?:'ARCHITECTURAL'|'STRUCTURAL';
  readonly floorId?: string;
  readonly exportScope?: 'current_floor' | 'all_floors' | 'complete_project' | 'site_plan';
  readonly paperSize?: 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'letter' | 'tabloid';
  readonly orientation?: 'landscape' | 'portrait';
  readonly scale?: string;
  readonly drawnBy?: string;
  readonly projectNumber?: string;
  readonly revision?: string;
  readonly includeFurniture?: boolean;
  readonly includeStructural?: boolean;
  readonly includeGrid?: boolean;
  readonly includeDimensions?: boolean;
  readonly includeRoomLabels?: boolean;
  readonly includeRoomAreas?: boolean;
  readonly includeOpenings?: boolean;
  readonly includeNorthArrow?: boolean;
  readonly includeScaleBar?: boolean;
  readonly includeTitleBlock?: boolean;
  readonly includeScheduleSheet?: boolean;
  readonly includeMepSheets?: boolean;
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
  public exportComplianceActionPlan(building: Building): Uint8Array {
    const regulatory = complianceReport(building);
    const layout = evaluateStudioLayoutScore(building, regulatory);
    const findings = [
      ...regulatory.rulesChecked.filter(rule => rule.status !== 'PASS').map(rule => ({
        heading: `${rule.status} | ${rule.id} | ${rule.description} | ${rule.clause}`,
        elementIds: rule.elementIds, actual: `${rule.actual ?? 'Unverified'} ${rule.unit ?? ''}`,
        required: `${rule.required ?? 'Verify applicability'} ${rule.unit ?? ''}`, action: rule.remediation,
      })),
      ...layout.criteria.flatMap(criterion => criterion.findings.map(finding => ({ ...finding, heading: `LAYOUT | ${finding.id}` }))),
    ];
    return complianceReportPdf(regulatory, [
      'COMPLIANCE AUDIT AND FIX PLAN',
      `Building ${building.id} | Revision ${building.version} | Layout score ${layout.score}/100`,
      `Canonical SHA-256: ${regulatory.canonicalHash}`,
      `Regulatory status ${regulatory.status}`,
      regulatory.disclaimer, '',
      ...layout.criteria.map(row => `${row.label}: ${row.earned}/${row.points}${row.unresolved ? ' (unverified inputs)' : ''}`), '',
      ...(findings.length ? findings.flatMap((finding, index) => [
        `${index + 1}. ${finding.heading}`, `Elements: ${finding.elementIds.join(', ') || 'See measured detail below'}`,
        `Current: ${finding.actual} | Required: ${finding.required}`,
        `Step 1. Locate the listed entities and review the measured values.`,
        `Step 2. ${finding.action}`,
        'Step 3. Regenerate or apply the edit, then rerun the checks on the new revision.', '',
      ]) : ['No failed or unresolved checks in this revision.']),
    ]);
  }

  public exportPdf(
    building: Building,
    options: PdfExportOptions = {},
  ): PdfExportResult {
    const selected = selectExportFloors(building,options);
    const scope=resolveExportScope(options);
    const siteView = { id:'site', name:'Site Plan', boundary:building.site.plotBoundary, rooms:[],walls:[],doors:[],windows:[],stairs:[],columns:[] } as unknown as Floor;
    const floorsToExport = scope==='site_plan' ? [siteView] : scope==='complete_project' ? [siteView,...selected] : selected;

    const paper = PAPER_POINTS[options.paperSize ?? 'A3'] ?? PAPER_POINTS['A3']!;
    const orientation = options.orientation ?? 'landscape';
    const pageWidth = orientation === 'landscape' ? paper.height : paper.width;
    const pageHeight = orientation === 'landscape' ? paper.width : paper.height;
    const titleHeight = options.includeTitleBlock !== false ? 70 : 0;
    const margin = 38;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2 - titleHeight;

    const totalFloorPages = floorsToExport.length;
    const includeScheduleSheet = options.includeScheduleSheet === true;
    const includeMepSheets = options.includeMepSheets === true;
    const pageCount = totalFloorPages + (includeScheduleSheet ? 1 : 0) + (includeMepSheets ? 2 : 0);
    const objects: string[] = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '', // Placeholder for Pages object
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];

    const pageRefs: string[] = [];

    for (let pIdx = 0; pIdx < totalFloorPages; pIdx++) {
      const canonicalFloor = floorsToExport[pIdx]!;
      const floor = options.drawingKind==='STRUCTURAL'?{...canonicalFloor,name:`${canonicalFloor.name} - Structural Layout`,rooms:[],walls:[],doors:[],windows:[],stairs:[],canonicalStaircases:[],furniture:[]}:canonicalFloor;
      const bounds = getFloorContentBounds(floor);
      const modelWidth = Math.max(1, bounds.width);
      const modelHeight = Math.max(1, bounds.height);
      const fitting=Math.min(usableWidth/modelWidth,usableHeight/modelHeight);
      const denominator=Number((options.scale??'FIT_TO_PAGE').split(':')[1]);
      const exact=72/25.4/denominator;
      const fit=!Number.isFinite(exact)||exact>fitting;
      const fitScale=fit?fitting:exact;
      const scaleMode=fit?'FIT_TO_PAGE_NOT_TO_SCALE':'EXACT_SCALE';
      const scaleLabel=fit?`FIT TO PAGE (NOT TO SCALE - APPROX 1:${Math.round(72/25.4/fitScale)})`:`1:${denominator}`;
      const annotationLayout=new AnnotationLayout();
      const originX = margin + (usableWidth - modelWidth * fitScale) / 2;
      const originY = margin + titleHeight + (usableHeight - modelHeight * fitScale) / 2;
      const px = (x: number) => originX + (x - bounds.x) * fitScale;
      const py = (y: number) => originY + (bounds.y + modelHeight - y) * fitScale;

      const commands: string[] = ['0 J', '0 j',`% SCALE_MODE ${scaleMode} PAPER ${options.paperSize??'A3'} POINTS_PER_MM ${fitScale.toFixed(9)}`];

      const polygon=(points:readonly {x:number;y:number}[],fill=false)=>commands.push(points.map((p,i)=>`${px(p.x).toFixed(4)} ${py(p.y).toFixed(4)} ${i?'l':'m'}`).join(' ')+(fill?' h f':' h S'));
      const line=(a:{x:number;y:number},b:{x:number;y:number})=>commands.push(`${px(a.x).toFixed(4)} ${py(a.y).toFixed(4)} m ${px(b.x).toFixed(4)} ${py(b.y).toFixed(4)} l S`);
      commands.push('0.3 0.3 0.3 RG','0.3 w');polygon(floor.boundary.points);
      if(floor.id==='site') for(const zone of building.site.siteZones??[]) {
        commands.push('0.8 0.9 0.9 rg');polygon(zone.boundary.points,true);
        commands.push('0.2 0.5 0.5 RG');polygon(zone.boundary.points);
        const center=polygonCentroid(zone.boundary),width=Math.max(...zone.boundary.points.map(p=>p.x))-Math.min(...zone.boundary.points.map(p=>p.x));
        const label=zone.name.replace(/6000 MM TWO.WAY PAVED ACCESS/i,'6.0M DRIVEWAY').replace(/MAIN ENTRY GATEWAY PAVED APRON/i,'MAIN ENTRY GATE');
        const font=Math.min(350,width*.75/(label.length*.7))*fitScale;
        const box=annotationLayout.place(label,px(center.x),py(center.y),font);
        commands.push('0.12 0.15 0.19 rg',`BT /F1 ${font.toFixed(4)} Tf ${(box.x-box.width/2).toFixed(4)} ${(box.y-font*.35).toFixed(4)} Td (${ascii(label)}) Tj ET`);
      }
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
        if (room.type === 'staircase' && !floor.canonicalStaircases?.length) {
          commands.push('0.4 0.4 0.4 RG', '0.4 w');
          for (let i = 1; i < 12; i++) {
            commands.push(
              `${px(room.x).toFixed(2)} ${(py(room.y + room.height) + (room.height * fitScale * i) / 12).toFixed(2)} m ` +
              `${(px(room.x) + room.width * fitScale).toFixed(2)} ${(py(room.y + room.height) + (room.height * fitScale * i) / 12).toFixed(2)} l S`,
            );
          }
        }
        if (options.includeRoomLabels !== false) {
          const annotation=roomAnnotation(room);
          annotation.lines.forEach((line,index)=>{
            if(index===2 && options.includeRoomAreas===false)return;
            const font=annotation.height*fitScale;
            const box=annotationLayout.place(line,px(annotation.center.x),py(annotation.center.y)+((annotation.lines.length-1)/2-index)*1.65*font,font);
            commands.push('0.12 0.15 0.19 rg',`BT /F1 ${font.toFixed(4)} Tf ${(box.x-box.width/2).toFixed(4)} ${(box.y-font*0.35).toFixed(4)} Td (${ascii(line)}) Tj ET`);
          });
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
        const openings=options.includeOpenings===false?[]:[...floor.doors,...floor.windows].filter(o=>o.wallId===wall.id);
        const cuts=openings.map(o=>{const distance=((o.position.x-wall.startPoint.x)*dx+(o.position.y-wall.startPoint.y)*dy)/len;return [Math.max(0,distance-o.width/2),Math.min(len,distance+o.width/2)];}).sort((a,b)=>a[0]!-b[0]!);
        let cursor=0;
        for(const [start,end] of [...cuts,[len,len]]) {if(start!>cursor)line({x:wall.startPoint.x+dx*cursor/len,y:wall.startPoint.y+dy*cursor/len},{x:wall.startPoint.x+dx*start!/len,y:wall.startPoint.y+dy*start!/len});cursor=Math.max(cursor,end!);}
      }

      // Doors and windows
      if (options.includeOpenings !== false) {
        commands.push('0.08 0.45 0.7 RG', '0.6 w');
        for (const op of [...floor.doors, ...floor.windows]) {
          const wall=floor.walls.find(w=>w.id===op.wallId);if(!wall)continue;
          const length=Math.hypot(wall.endPoint.x-wall.startPoint.x,wall.endPoint.y-wall.startPoint.y);if(!length)continue;
          const ux=(wall.endPoint.x-wall.startPoint.x)/length,uy=(wall.endPoint.y-wall.startPoint.y)/length;
          const a={x:op.position.x-ux*op.width/2,y:op.position.y-uy*op.width/2},b={x:op.position.x+ux*op.width/2,y:op.position.y+uy*op.width/2};
          line(a,b);
          if(floor.windows.includes(op as never))for(const side of [-1,1])line({x:a.x-uy*wall.thickness*.3*side,y:a.y+ux*wall.thickness*.3*side},{x:b.x-uy*wall.thickness*.3*side,y:b.y+ux*wall.thickness*.3*side});
          else line(a,{x:a.x-uy*op.width,y:a.y+ux*op.width});
        }
      }
      if(options.includeStructural!==false) {
        commands.push('0.7 0.2 0.2 RG','0.5 w');
        for(const col of floor.columns)polygon([{x:col.position.x-col.width/2,y:col.position.y-col.depth/2},{x:col.position.x+col.width/2,y:col.position.y-col.depth/2},{x:col.position.x+col.width/2,y:col.position.y+col.depth/2},{x:col.position.x-col.width/2,y:col.position.y+col.depth/2}]);
        for(const beam of floor.beams??[]) {commands.push(`${(beam.widthMm*fitScale).toFixed(4)} w`);line(beam.startPoint,beam.endPoint);}
      }
      commands.push('0.3 0.3 0.3 RG','0.3 w');
      for(const stair of floor.canonicalStaircases??[])for(const part of [stair.polygon,stair.flight1,stair.flight2,stair.midLanding])polygon(part.points);
      if(options.includeFurniture!==false)for(const item of floor.furniture??[]) {
        const room=floor.rooms.find(r=>r.id===item.roomId);
        if(room&&/utility|balcony/i.test(`${room.type} ${room.name}`)&&['stove','oven'].includes(item.type))continue;
        const angle=item.rotationDeg*Math.PI/180,cx=item.xMm+item.widthMm/2,cy=item.yMm+item.depthMm/2;
        polygon([[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>({x:cx+x!*item.widthMm/2*Math.cos(angle)-y!*item.depthMm/2*Math.sin(angle),y:cy+x!*item.widthMm/2*Math.sin(angle)+y!*item.depthMm/2*Math.cos(angle)})));
      }

      if(options.includeDimensions!==false) {
        const xs=floor.boundary.points.map(p=>p.x),ys=floor.boundary.points.map(p=>p.y);
        const left=px(Math.min(...xs)),right=px(Math.max(...xs)),bottom=py(Math.max(...ys)),top=py(Math.min(...ys));
        commands.push('0.1 0.35 0.6 RG','0.3 w',`${left.toFixed(4)} ${(top+10).toFixed(4)} m ${right.toFixed(4)} ${(top+10).toFixed(4)} l S`,`${(left-20).toFixed(4)} ${bottom.toFixed(4)} m ${(left-20).toFixed(4)} ${top.toFixed(4)} l S`);
        for(const [text,x,y] of [[`${Math.round(Math.max(...xs)-Math.min(...xs))} mm`,(left+right)/2,top+17],[`${Math.round(Math.max(...ys)-Math.min(...ys))} mm`,left-20,(bottom+top)/2]] as const) {
          const box=annotationLayout.place(text,x,y,6);
          commands.push('0.1 0.35 0.6 rg',`BT /F1 6 Tf ${(box.x-box.width/2).toFixed(4)} ${(box.y-2.1).toFixed(4)} Td (${text}) Tj ET`);
        }
      }
      if(options.drawingKind==='STRUCTURAL')floor.columns.forEach((col,index)=>{
        const text=`C${index+1}`,font=140*fitScale;
        const box=annotationLayout.place(text,px(col.position.x),py(col.position.y-col.depth/2)+font*2,font);
        commands.push('0.7 0.2 0.2 rg',`BT /F1 ${font.toFixed(4)} Tf ${(box.x-box.width/2).toFixed(4)} ${(box.y-font*.35).toFixed(4)} Td (${text}) Tj ET`);
      });
      // Scale bar and Title Block
      if (options.includeTitleBlock !== false) {
        commands.push('0.08 0.1 0.13 RG', '0.8 w', `${margin} ${margin} ${pageWidth - margin * 2} ${titleHeight - 8} re S`);
        commands.push('0.08 0.1 0.13 rg', `BT /F1 13 Tf ${margin + 10} ${margin + 29} Td (${ascii(building.name)}) Tj ET`);
        const sheetTitle = `Sheet ${pIdx + 1}: ${ascii(floor.name)} | ${ascii(scaleLabel)} ISO ${options.paperSize??'A3'} | Rev ${building.version}`;
        commands.push(`BT /F1 8 Tf ${margin + 10} ${margin + 14} Td (${sheetTitle}) Tj ET`);
        commands.push(`BT /F1 8 Tf ${(pageWidth - 220).toFixed(2)} ${margin + 29} Td (Drawn by ${ascii(options.drawnBy ?? 'FORMA AI Planner')}) Tj ET`);
        commands.push(`BT /F1 8 Tf ${(pageWidth - 220).toFixed(2)} ${margin + 3} Td (Project ${ascii(options.projectNumber ?? 'FP-001')}) Tj ET`);
        commands.push('0.75 0.12 0.12 rg', `BT /F1 8 Tf ${margin + 10} ${margin + 46} Td (CONCEPT / SCHEMATIC DESIGN - NOT FOR CONSTRUCTION - PROFESSIONAL REVIEW REQUIRED) Tj ET`);
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

    if (includeScheduleSheet) {
      const schedCommands: string[] = [
        '0.08 0.1 0.13 RG',
        '0.8 w',
        `${margin} ${margin} ${pageWidth - margin * 2} ${pageHeight - margin * 2} re S`,
        '0.08 0.1 0.13 rg',
        `BT /F1 15 Tf ${margin + 14} ${pageHeight - margin - 28} Td (Sheet A-901: RERA Carpet Area & Compliance Schedule - ${ascii(building.name)}) Tj ET`,
        `BT /F1 9 Tf ${margin + 14} ${pageHeight - margin - 46} Td (Plot: ${Math.round(building.site.plotWidth)} x ${Math.round(building.site.plotDepth)} mm | Rev ${building.version} | ISO ${options.paperSize ?? 'A3'} Landscape) Tj ET`,
      ];

      // Table Header
      const tableX = margin + 14;
      const tableW = pageWidth - margin * 2 - 28;
      let rowY = pageHeight - margin - 78;
      const rowH = 20;
      const cols = [0, 170, 320, 460, 590, 740, tableW];
      const drawRow = (cells: readonly string[], isHeader = false) => {
        if (isHeader) {
          schedCommands.push('0.91 0.93 0.96 rg', `${tableX} ${rowY} ${tableW} ${rowH} re f`);
        }
        schedCommands.push('0.45 0.5 0.55 RG', '0.5 w', `${tableX} ${rowY} ${tableW} ${rowH} re S`);
        for (let c = 1; c < cols.length - 1; c++) {
          const cx = tableX + cols[c]!;
          schedCommands.push(`${cx} ${rowY} m ${cx} ${rowY + rowH} l S`);
        }
        schedCommands.push('0.08 0.1 0.13 rg');
        cells.forEach((cell, idx) => {
          const cx = tableX + cols[idx]! + 6;
          schedCommands.push(`BT /F1 ${isHeader ? 9 : 8} Tf ${cx} ${rowY + 6} Td (${ascii(cell)}) Tj ET`);
        });
        rowY -= rowH;
      };

      drawRow(['Floor / Sheet', 'Unit / Program', 'RERA Carpet (sq.m)', 'Carpet (sq.ft)', 'Outdoor / Util (sq.m)', 'Gross Built (sq.m)'], true);

      let totalCarpetM2 = 0;
      let totalOutdoorM2 = 0;
      let totalGrossM2 = 0;

      for (const fl of building.floors) {
        if (rowY < margin + 95) break;
        const units = fl.apartmentUnits ?? [];
        if (units.length > 0) {
          for (const unit of units) {
            if (rowY < margin + 95) break;
            const unitRooms = fl.rooms.filter(
              (r) => r.unitId === unit.id || r.id.startsWith(`${unit.id}_`),
            );
            const outdoorM2 = unitRooms
              .filter((r) => r.type === 'balcony' || r.type === 'utility' || r.type === 'terrace')
              .reduce((acc, r) => acc + r.area / 1_000_000, 0);
            const roomSumM2 = unitRooms.reduce((acc, r) => acc + r.area / 1_000_000, 0);
            const reraM2 = Math.max(0, roomSumM2 - outdoorM2);
            const grossM2 = roomSumM2;
            totalCarpetM2 += reraM2;
            totalOutdoorM2 += outdoorM2;
            totalGrossM2 += grossM2;
            drawRow([
              fl.name.slice(0, 24),
              `${unit.id} (${unit.unitType})`,
              `${reraM2.toFixed(2)} sq.m`,
              `${(reraM2 * 10.7639).toFixed(1)} sq.ft`,
              `${outdoorM2.toFixed(2)} sq.m`,
              `${grossM2.toFixed(2)} sq.m`,
            ]);
          }
        } else {
          const flOutdoorM2 = fl.rooms
            .filter((r) => r.type === 'balcony' || r.type === 'utility' || r.type === 'terrace')
            .reduce((acc, r) => acc + r.area / 1_000_000, 0);
          const flRoomM2 = fl.rooms.reduce((acc, r) => acc + r.area / 1_000_000, 0);
          const flCarpetM2 = Math.max(0, flRoomM2 - flOutdoorM2);
          totalCarpetM2 += flCarpetM2;
          totalOutdoorM2 += flOutdoorM2;
          totalGrossM2 += flRoomM2;
          drawRow([
            fl.name.slice(0, 24),
            `${fl.rooms.length} Spaces`,
            `${flCarpetM2.toFixed(2)} sq.m`,
            `${(flCarpetM2 * 10.7639).toFixed(1)} sq.ft`,
            `${flOutdoorM2.toFixed(2)} sq.m`,
            `${flRoomM2.toFixed(2)} sq.m`,
          ]);
        }
      }

      drawRow([
        'PROJECT TOTAL',
        `${building.floors.length} Sheets`,
        `${totalCarpetM2.toFixed(2)} sq.m`,
        `${(totalCarpetM2 * 10.7639).toFixed(1)} sq.ft`,
        `${totalOutdoorM2.toFixed(2)} sq.m`,
        `${totalGrossM2.toFixed(2)} sq.m`,
      ], true);

      schedCommands.push(
        '0.08 0.1 0.13 rg',
        `BT /F1 8 Tf ${tableX} ${margin + 66} Td (Summary: ${building.floors.length} Sheets | Total RERA Carpet: ${totalCarpetM2.toFixed(2)} sq.m (${(totalCarpetM2 * 10.7639).toFixed(1)} sq.ft) | Total Built: ${totalGrossM2.toFixed(2)} sq.m) Tj ET`,
      );

      if (options.includeTitleBlock !== false) {
        schedCommands.push('0.08 0.1 0.13 RG', '0.8 w', `${margin} ${margin} ${pageWidth - margin * 2} ${titleHeight - 8} re S`);
        schedCommands.push('0.08 0.1 0.13 rg', `BT /F1 13 Tf ${margin + 10} ${margin + 29} Td (${ascii(building.name)}) Tj ET`);
        schedCommands.push(`BT /F1 8 Tf ${margin + 10} ${margin + 14} Td (Sheet A-901: Statutory RERA Carpet Area Schedule | ISO ${options.paperSize ?? 'A3'} | Rev ${building.version}) Tj ET`);
        schedCommands.push('0.75 0.12 0.12 rg', `BT /F1 8 Tf ${margin + 10} ${margin + 46} Td (CONCEPT / SCHEMATIC DESIGN - NOT FOR CONSTRUCTION - PROFESSIONAL REVIEW REQUIRED) Tj ET`);
      }

      const schedStream = `${schedCommands.join('\n')}\n`;
      const sPageObjIndex = objects.length + 1;
      const sContentObjIndex = sPageObjIndex + 1;
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${sContentObjIndex} 0 R >>`,
      );
      objects.push(`<< /Length ${byteLength(schedStream)} >>\nstream\n${schedStream}endstream`);
      pageRefs.push(`${sPageObjIndex} 0 R`);
    }

    if (includeMepSheets) {
      const targetFloor =
        building.floors.find((f) => f.floorUse !== 'STILT_PARKING' && f.id !== 'site') ??
        selected[0] ??
        floorsToExport[0]!;
      const stiltFloor = building.floors.find((f) => f.floorUse === 'STILT_PARKING');
      const appendMepPage = (
        sheetTitle: string,
        mode: 'ELEC_CEIL' | 'PLUMB_FIRE',
        floor: Floor,
      ) => {
        const bounds = getFloorContentBounds(floor);
        const modelWidth = Math.max(1, bounds.width);
        const modelHeight = Math.max(1, bounds.height);
        const fitScale = Math.min(usableWidth / modelWidth, usableHeight / modelHeight);
        const originX = margin + (usableWidth - modelWidth * fitScale) / 2;
        const originY = margin + titleHeight + (usableHeight - modelHeight * fitScale) / 2;
        const px = (x: number) => originX + (x - bounds.x) * fitScale;
        const py = (y: number) => originY + (bounds.y + modelHeight - y) * fitScale;
        const cmds: string[] = ['0 J', '0 j', `0.7 0.7 0.7 RG`, '0.35 w'];

        // Subtle architectural underlay
        cmds.push(
          floor.boundary.points
            .map((p, i) => `${px(p.x).toFixed(4)} ${py(p.y).toFixed(4)} ${i ? 'l' : 'm'}`)
            .join(' ') + ' h S',
        );
        for (const w of floor.walls) {
          cmds.push(
            `${px(w.startPoint.x).toFixed(4)} ${py(w.startPoint.y).toFixed(4)} m ${px(w.endPoint.x).toFixed(4)} ${py(w.endPoint.y).toFixed(4)} l S`,
          );
        }

        const floorMep = building.mepEngineering?.floors.find((m) => m.floorId === floor.id);
        if (floorMep) {
          if (mode === 'ELEC_CEIL') {
            // A-CEIL-GRID zones
            cmds.push('0.45 0.48 0.78 RG', '0.45 w', '[3 2] 0 d');
            for (const cz of floorMep.ceilings) {
              if (cz.outline.length >= 3) {
                cmds.push(
                  cz.outline
                    .map((p, i) => `${px(p.x).toFixed(4)} ${py(p.y).toFixed(4)} ${i ? 'l' : 'm'}`)
                    .join(' ') + ' h S',
                );
              }
              for (const [a, b] of cz.gridLines ?? []) {
                cmds.push(
                  `${px(a.x).toFixed(4)} ${py(a.y).toFixed(4)} m ${px(b.x).toFixed(4)} ${py(b.y).toFixed(4)} l S`,
                );
              }
            }
            // M-ELEC-WIRE runs
            cmds.push('0.85 0.47 0.02 RG', '0.6 w', '[4 2] 0 d');
            for (const run of floorMep.runs.filter((r) => r.discipline === 'ELECTRICAL')) {
              if (run.points.length >= 2) {
                cmds.push(
                  run.points
                    .map((p, i) => `${px(p.x).toFixed(4)} ${py(p.y).toFixed(4)} ${i ? 'l' : 'm'}`)
                    .join(' ') + ' S',
                );
              }
            }
            // M-ELEC-SYMB markers
            cmds.push('[] 0 d', '0.72 0.35 0.02 RG', '0.7 w');
            for (const sym of floorMep.symbols.filter((s) => s.discipline === 'ELECTRICAL')) {
              const sx = px(sym.position.x);
              const sy = py(sym.position.y);
              cmds.push(`${(sx - 3).toFixed(3)} ${(sy - 3).toFixed(3)} 6 6 re S`);
              if (sym.kind === 'DB' || sym.kind === 'FAN' || sym.kind === 'AC_IDU' || sym.kind === 'AC_ODU') {
                cmds.push(
                  '0.55 0.25 0.02 rg',
                  `BT /F1 5.5 Tf ${(sx - 4).toFixed(3)} ${(sy + 4.5).toFixed(3)} Td (${ascii(sym.kind)}) Tj ET`,
                );
              }
            }
          } else {
            // M-PLUMB-PIPE runs
            cmds.push('0.01 0.52 0.78 RG', '0.8 w', '[] 0 d');
            for (const run of floorMep.runs.filter((r) => r.discipline === 'PLUMBING')) {
              if (run.kind === 'HWS') cmds.push('0.91 0.35 0.05 RG', '[4 2] 0 d');
              else if (run.kind === 'SP') cmds.push('0.48 0.18 0.07 RG', '1.1 w', '[] 0 d');
              else if (run.kind === 'WP') cmds.push('0.05 0.58 0.53 RG', '[3 2] 0 d');
              else cmds.push('0.01 0.52 0.78 RG', '0.8 w', '[] 0 d');
              if (run.points.length >= 2) {
                cmds.push(
                  run.points
                    .map((p, i) => `${px(p.x).toFixed(4)} ${py(p.y).toFixed(4)} ${i ? 'l' : 'm'}`)
                    .join(' ') + ' S',
                );
              }
            }
            // M-PLUMB-FIXT + F-FIRE-SYMB
            cmds.push('[] 0 d', '0.82 0.12 0.12 RG', '0.75 w');
            for (const sym of floorMep.symbols.filter((s) => s.discipline === 'PLUMBING' || s.discipline === 'FIRE')) {
              const sx = px(sym.position.x);
              const sy = py(sym.position.y);
              if (sym.discipline === 'PLUMBING') {
                cmds.push('0.01 0.52 0.78 RG');
              } else {
                cmds.push('0.82 0.12 0.12 RG');
              }
              const hw = Math.max(3.5, ((sym.widthMm ?? 450) * fitScale) / 2);
              const hd = Math.max(3.5, ((sym.depthMm ?? 450) * fitScale) / 2);
              cmds.push(`${(sx - hw).toFixed(3)} ${(sy - hd).toFixed(3)} ${(hw * 2).toFixed(3)} ${(hd * 2).toFixed(3)} re S`);
              if (sym.kind === 'PLUMB_SHAFT') {
                cmds.push(`${(sx - hw).toFixed(3)} ${(sy - hd).toFixed(3)} m ${(sx + hw).toFixed(3)} ${(sy + hd).toFixed(3)} l S`);
                cmds.push(`${(sx + hw).toFixed(3)} ${(sy - hd).toFixed(3)} m ${(sx - hw).toFixed(3)} ${(sy + hd).toFixed(3)} l S`);
              }
              cmds.push(
                sym.discipline === 'PLUMBING' ? '0.01 0.42 0.65 rg' : '0.68 0.08 0.08 rg',
                `BT /F1 5.5 Tf ${(sx - 4).toFixed(3)} ${(sy + hd + 2).toFixed(3)} Td (${ascii(sym.kind)}) Tj ET`,
              );
            }
          }
        }

        // Header + summary bar
        cmds.push('0.08 0.1 0.13 rg');
        cmds.push(`BT /F1 12 Tf ${margin} ${pageHeight - margin + 6} Td (${ascii(sheetTitle)} - ${ascii(floor.name)}) Tj ET`);
        const stiltSprinklerCount = stiltFloor
          ? (building.mepEngineering?.floors.find((m) => m.floorId === stiltFloor.id)?.symbols.filter((s) => s.kind === 'SPRINKLER').length ?? 0)
          : 0;
        const stackCount = building.mepEngineering?.verticalStacks.length ?? 0;
        const summaryNote =
          mode === 'ELEC_CEIL'
            ? `Layers: M-ELEC-SYMB, M-ELEC-WIRE, A-CEIL-GRID | DB/FAN/DL/SB/16A/AC/GY + Cove & 600x600 RCP`
            : `Layers: M-PLUMB-PIPE, M-PLUMB-FIXT, F-FIRE-SYMB | Vertical Stacks: ${stackCount} | Stilt Sprinklers: ${stiltSprinklerCount}`;
        cmds.push(`BT /F1 8 Tf ${margin} ${margin + titleHeight + 4} Td (${ascii(summaryNote)}) Tj ET`);

        if (options.includeTitleBlock !== false) {
          cmds.push('0.08 0.1 0.13 RG', '0.8 w', `${margin} ${margin} ${pageWidth - margin * 2} ${titleHeight - 8} re S`);
          cmds.push('0.08 0.1 0.13 rg', `BT /F1 13 Tf ${margin + 10} ${margin + 29} Td (${ascii(building.name)}) Tj ET`);
          cmds.push(`BT /F1 8 Tf ${margin + 10} ${margin + 14} Td (${ascii(sheetTitle)} | ISO ${options.paperSize ?? 'A3'} | Rev ${building.version}) Tj ET`);
          cmds.push('0.75 0.12 0.12 rg', `BT /F1 8 Tf ${margin + 10} ${margin + 46} Td (CONCEPT / SCHEMATIC MEP COORDINATION - NOT FOR CONSTRUCTION) Tj ET`);
        }

        const stream = `${cmds.join('\n')}\n`;
        const mPageObjIndex = objects.length + 1;
        const mContentObjIndex = mPageObjIndex + 1;
        objects.push(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${mContentObjIndex} 0 R >>`,
        );
        objects.push(`<< /Length ${byteLength(stream)} >>\nstream\n${stream}endstream`);
        pageRefs.push(`${mPageObjIndex} 0 R`);
      };

      appendMepPage('Sheet M-201: Coordinated Electrical & Reflected Ceiling Plan', 'ELEC_CEIL', targetFloor);
      appendMepPage('Sheet M-301: Plumbing, Sanitary Shafts & Fire Safety Plan', 'PLUMB_FIRE', targetFloor);
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

    const data=Buffer.from(pdf,'utf8');
    const checksum=createHash('sha256').update(data).digest('hex');
    const filename=`${building.id.replace(/[^a-zA-Z0-9_-]/g,'_')}_r${building.version}_${options.exportScope??'current_floor'}_${(options.floorId??'all').replace(/[^a-zA-Z0-9_-]/g,'_')}_${checksum}.pdf`;
    const verified=verifyPdfArtifact(data);
    if(!verified.isValid)throw new ExportError('ARTIFACT_VERIFICATION_FAILED',verified.errors.join('; '));
    return {
      filename,
      mimeType: 'application/pdf',
      data,
      pageCount,
    };
  }

  public exportMultiSheetPdf(
    building: Building,
    options: Omit<PdfExportOptions, 'exportScope' | 'includeScheduleSheet'> = {},
  ): PdfExportResult {
    return this.exportPdf(building, {
      ...options,
      exportScope: 'complete_project',
      paperSize: options.paperSize ?? 'A3',
      orientation: options.orientation ?? 'landscape',
      includeScheduleSheet: true,
      includeMepSheets: options.includeMepSheets ?? true,
    });
  }
}

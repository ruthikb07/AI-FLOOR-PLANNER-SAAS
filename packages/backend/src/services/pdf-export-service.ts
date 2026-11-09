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

    const pageCount = floorsToExport.length;
    const objects: string[] = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '', // Placeholder for Pages object
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];

    const pageRefs: string[] = [];

    for (let pIdx = 0; pIdx < pageCount; pIdx++) {
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
}

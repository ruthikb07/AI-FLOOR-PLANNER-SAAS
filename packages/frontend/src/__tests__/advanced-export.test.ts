import { describe, expect, it } from 'vitest';
import { createCanonical30x50_2BHK } from '../services/storage';
import { mkdirSync,writeFileSync } from 'node:fs';
import {
  createExportArtifact,
  DEFAULT_ADVANCED_EXPORT_SETTINGS,
  validateExportSettings,
  type AdvancedExportSettings,
} from '../services/advanced-export';

function settings(overrides: Partial<AdvancedExportSettings> = {}): AdvancedExportSettings {
  return {
    ...DEFAULT_ADVANCED_EXPORT_SETTINGS,
    floorId: undefined,
    ...overrides,
  };
}

describe('Phase 11 advanced export', () => {
  it('creates a self-contained SVG with selected layers and title metadata', () => {
    const building = createCanonical30x50_2BHK();
    const artifact = createExportArtifact(building, settings({
      format: 'svg',
      includeGrid: false,
      includeDimensions: false,
      includeNorthArrow: false,
      includeTitleBlock: true,
      drawnBy: 'Architecture Team',
    }));

    expect(artifact.mimeType).toBe('image/svg+xml');
    expect(artifact.filename).toMatch(/\.svg$/);
    expect(artifact.content).toContain('<svg');
    expect(artifact.content).not.toContain('layer-grid');
    expect(artifact.content).not.toContain('layer-annotations');
    expect(artifact.content).not.toContain('north-arrow');
    expect(artifact.content).toContain('title-block');
    expect(artifact.content).toContain('Architecture Team');
  });

  it('creates a valid single-page PDF structure with vector drawing content', () => {
    const building = createCanonical30x50_2BHK();
    const artifact = createExportArtifact(building, settings({ format: 'pdf' }));

    expect(artifact.mimeType).toBe('application/pdf');
    expect(artifact.content.startsWith('%PDF-1.4')).toBe(true);
    expect(artifact.content).toContain('/Type /Page');
    expect(artifact.content).toContain('xref');
    expect(artifact.content).toContain('startxref');
    expect(artifact.content.endsWith('%%EOF')).toBe(true);
    expect(artifact.byteSize).toBeGreaterThan(1000);

    const xrefOffset = Number(artifact.content.match(/startxref\n(\d+)/)?.[1]);
    expect(artifact.content.slice(xrefOffset, xrefOffset + 4)).toBe('xref');
    const objectOffsets = artifact.content
      .split('xref\n')[1]!
      .split('trailer')[0]!
      .split('\n')
      .slice(2)
      .filter(line => line.endsWith(' n '))
      .map(line => Number(line.slice(0, 10)));
    objectOffsets.forEach((offset, index) => {
      expect(artifact.content.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj`));
    });
  });

  it('exports the canonical model with a revision manifest as JSON', () => {
    const building = createCanonical30x50_2BHK();
    const artifact = createExportArtifact(building, settings({
      format: 'json',
      revision: '07',
      projectNumber: 'HOUSE-2026',
    }));
    const parsed = JSON.parse(artifact.content);

    expect(parsed.exportManifest.revision).toBe('07');
    expect(parsed.exportManifest.projectNumber).toBe('HOUSE-2026');
    expect(parsed.building.id).toBe(building.id);
    expect(parsed.building.floors).toHaveLength(building.floors.length);
  });

  it('rejects malformed scale and incomplete title metadata', () => {
    expect(validateExportSettings(settings({ scale: 'large', drawnBy: '', revision: '' })))
      .toHaveLength(3);
  });
  it('measures a 10000mm wall at 1:100 as 100mm on the paper',()=>{
    const base=createCanonical30x50_2BHK();const floor=base.floors[0]!;
    const building={...base,floors:[{...floor,rooms:[],doors:[],windows:[],stairs:[],columns:[],boundary:{points:[{x:0,y:0},{x:10000,y:0},{x:10000,y:3000},{x:0,y:3000}]},walls:[{id:'scale-reference-10000',floorId:floor.id,startPoint:{x:0,y:0},endPoint:{x:10000,y:0},thickness:230,type:'external' as never,roomIds:[],loadBearing:false,hasOpening:false}]}]};
    const pdf=createExportArtifact(building,settings({includeScaleBar:false,includeGrid:false,includeDimensions:false,includeNorthArrow:false})).content;
    const segment=pdf.match(/% WALL scale-reference-10000\n[\d.]+ w\n([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S/)!;
    expect(segment).not.toBeNull();
    const paperMm=Math.hypot(Number(segment[3])-Number(segment[1]),Number(segment[4])-Number(segment[2]))*25.4/72;
    expect(Math.abs(paperMm-100)).toBeLessThan(0.01);
    const dir='output/apartment-geometry-closure/06-pdf';mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/scale-reference.pdf`,pdf,'ascii');writeFileSync(`${dir}/scale-measurement.json`,JSON.stringify({sourceLengthMm:10000,requestedScale:'1:100',expectedPaperMm:100,measuredPaperMm:paperMm,toleranceMm:0.01,passed:Math.abs(paperMm-100)<0.01},null,2));
    expect(()=>createExportArtifact(building,settings({scale:'1:10'}))).toThrow('PDF_SCALE_DOES_NOT_FIT_SHEET');
    expect(createExportArtifact(building,settings({scale:'1:10',scaleMode:'FIT_TO_PAGE'})).content).toContain('NOT TO SCALE');
    expect(()=>createExportArtifact(building,settings({buildingRevision:base.version+1}))).toThrow('PDF_STALE_BUILDING_REVISION');
    expect(()=>createExportArtifact(building,settings({floorId:'missing'}))).toThrow('PDF_FLOOR_NOT_FOUND');
  });

  it('formats DWG export artifact with correct extension and MIME type', () => {
    const building = createCanonical30x50_2BHK();
    const artifact = createExportArtifact(building, settings({ format: 'dwg' }));

    expect(artifact.extension).toBe('dwg');
    expect(artifact.filename).toMatch(/_r01\.dwg$/);
    expect(artifact.filename).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/); // No UUID in filename
    expect(artifact.mimeType).toBe('application/x-dwg');
  });

  it('formats DXF export artifact with correct extension and MIME type', () => {
    const building = createCanonical30x50_2BHK();
    const artifact = createExportArtifact(building, settings({ format: 'dxf' }));

    expect(artifact.extension).toBe('dxf');
    expect(artifact.filename).toMatch(/_r01\.dxf$/);
    expect(artifact.mimeType).toBe('application/dxf');
  });
});


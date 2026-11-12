import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as acad from '@node-projects/acad-ts';
import { PDFDocument } from 'pdf-lib';
import {
  Direction,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  type Building,
  type VerifiedArtifactOptions,
} from '@ai-floor-planner/core';
import { executeAuditedPlanningPipeline } from '@ai-floor-planner/planning-engine';
import { textBoxesOverlap, type TextBox } from '@ai-floor-planner/geometry-engine';
import { ArtifactRegistry, type ArtifactFormat } from '../services/artifact-registry.js';
import {
  verifyCadArtifact,
  verifyPdfArtifact,
  verifyReportArtifact,
} from '../services/artifact-verifier.js';
import { CadExportService } from '../services/cad-export-service.js';
import { PdfExportService } from '../services/pdf-export-service.js';
import { renderFloor } from '@ai-floor-planner/renderer';

describe('Phase 2 independent immutable artifacts', () => {
  let building: Building;
  const registry = new ArtifactRegistry(fs.mkdtempSync(path.join(os.tmpdir(), 'argon-phase2-')));
  beforeAll(async () => {
    building = (
      await executeAuditedPlanningPipeline({
        plotWidthMm: 50000,
        plotDepthMm: 50000,
        roadWidthMm: 12000,
        roadAccessSides: [Direction.North],
        lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
        jurisdiction: 'generic_maharashtra',
        verticalStackType: 'STILT_PLUS_N',
        numTypicalFloors: 2,
        flatsPerFloor: 2,
        units: [
          { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
          { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
        ],
        setbacksMm: { front: 3000, rear: 2500, left: 2500, right: 2500 },
        siteAmenities: DEFAULT_SITE_AMENITIES,
        stiltAmenities: DEFAULT_STILT_AMENITIES,
        terraceAmenities: DEFAULT_TERRACE_AMENITIES,
        parkingMode: 'STILT_ONLY',
        // This fixture explicitly verifies column/beam artifacts; architecture defaults to deferred structure.
        structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
      })
    ).building;
  });
  it('reopens every real floor, site and complete CAD/PDF, with source parity and immutable checksums', async () => {
    const original = JSON.stringify(building);
    for (const options of [
      ...building.floors.map((f) => ({ floorId: f.id })),
      { exportScope: 'site_plan' as const, floorId: 'site' },
      { exportScope: 'complete_project' as const },
      { exportScope: 'all_floors', drawingKind: 'STRUCTURAL' },
    ] as VerifiedArtifactOptions[]) {
      for (const format of ['dwg', 'dxf', 'pdf'] as const) {
        const result = await registry.generate(building, format, options);
        expect(result.descriptor.verification?.isValid).toBe(true);
        if (format !== 'pdf')
          expect(result.descriptor.verification?.checks.canonicalFloorBoundariesVerified).toBe(
            true,
          );
        expect(result.descriptor.sha256).toBe(
          createHash('sha256').update(result.data).digest('hex'),
        );
        expect(result.descriptor.fileName).toContain(`_r${building.version}_`);
        expect(result.descriptor.fileName).toContain(result.descriptor.sha256);
        expect(registry.read(result.descriptor.fileName).data).toEqual(Buffer.from(result.data));
        if (format === 'pdf') {
          expect((await PDFDocument.load(result.data)).getPageCount()).toBe(
            options.exportScope === 'complete_project'
              ? building.floors.length + 1
              : options.exportScope === 'all_floors'
                ? building.floors.length
                : 1,
          );
          const boxes: TextBox[] = [];
          const text = Buffer.from(result.data).toString();
          for (const page of text.split('/Type /Page /Parent').slice(1)) {
            boxes.length = 0;
            for (const m of page.matchAll(
              /BT \/F1 ([\d.]+) Tf ([-\d.]+) ([-\d.]+) Td \((.*)\) Tj ET/g,
            )) {
              const h = Number(m[1]),
                value = m[4]!.replace(/\\([\\()])/g, '$1');
              const box = {
                x: Number(m[2]) + value.length * h * 0.35,
                y: Number(m[3]) + h * 0.35,
                width: value.length * h * 0.7,
                height: h * 1.2,
                text: value,
              };
              expect(
                boxes.some((other) => textBoxesOverlap(box, other)),
                `PDF text collision: ${value} against ${boxes
                  .filter((other) => textBoxesOverlap(box, other))
                  .map((b) => b.text)
                  .join(' / ')}`,
              ).toBe(false);
              boxes.push(box);
            }
          }
        } else {
          const reopened = verifyCadArtifact(result.data, format);
          expect(reopened.errors).toEqual([]);
          const boxes: TextBox[] = [];
          for (const entity of reopened.document!.entities!)
            if (entity instanceof acad.TextEntity) {
              expect(entity.insertPoint.y).toBe(entity.alignmentPoint.y);
              const box = {
                x:
                  entity.insertPoint.x +
                  (entity.horizontalAlignment === 1
                    ? 0
                    : entity.value.length * entity.height * 0.35),
                y: entity.insertPoint.y + (entity.verticalAlignment === 2 ? 0 : entity.height / 2),
                width: entity.value.length * entity.height * 0.7,
                height: entity.height * 1.2,
                text: entity.value,
              };
              expect(
                boxes.some((other) => textBoxesOverlap(box, other)),
                `CAD text collision: ${entity.value}`,
              ).toBe(false);
              boxes.push(box);
            }
          const preview = registry.preview(result.descriptor.fileName);
          expect(verifyReportArtifact(preview, 'svg').isValid).toBe(true);
        }
      }
    }
    expect(JSON.stringify(building)).toBe(original);
  }, 60000);
  it('exports deterministic report provenance and raw per-floor ledgers in JSON and PDF', async () => {
    for (const format of ['geometry-json', 'geometry-pdf'] as const) {
      const result = await registry.generate(building, format, { exportScope: 'all_floors' });
      expect(result.descriptor.verification?.isValid).toBe(true);
      if (format === 'geometry-json') {
        const report = JSON.parse(Buffer.from(result.data).toString());
        expect(report.revisionHash).toBe(result.descriptor.revisionHash);
        expect(report.floors).toHaveLength(building.floors.length);
        expect(report.status).toMatch(/^INTERNAL ENGINEERING GATE/);
        expect(report.floors[0].ledger.convention).toBe(
          'CENTRELINE_CELLS_MINUS_CLIPPED_WALL_UNION',
        );
      } else expect((await PDFDocument.load(result.data)).getPageCount()).toBeGreaterThan(0);
    }
  });
  it('fails closed on corrupt bytes, missing floors, unsupported formats, changed disk files and empty geometry', async () => {
    for (const format of ['dwg', 'dxf'] as const)
      expect(verifyCadArtifact(Buffer.from('AC1032 SECTION corrupt'), format).isValid).toBe(false);
    expect(verifyPdfArtifact(Buffer.from('%PDF-1.4\n%%EOF')).isValid).toBe(false);
    expect(
      verifyReportArtifact(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'), 'svg')
        .isValid,
    ).toBe(false);
    expect(verifyReportArtifact(Buffer.from('{"status":"SUCCESS"}'), 'json').isValid).toBe(false);
    await expect(registry.generate(building, 'blend' as ArtifactFormat)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    });
    await expect(registry.generate(building, 'dwg', { floorId: 'missing' })).rejects.toMatchObject({
      code: 'UNKNOWN_FLOOR',
    });
    expect(() => new CadExportService().exportCad({ ...building, floors: [] }, 'dwg')).toThrow(
      'No canonical floors',
    );
    expect(() => new PdfExportService().exportPdf({ ...building, floors: [] })).toThrow(
      'No canonical floors',
    );
    const result = await registry.generate(building, 'geometry-json');
    fs.appendFileSync(result.destination, 'corrupt');
    expect(() => registry.read(result.descriptor.fileName)).toThrow(
      /changed after verification|provenance does not match/,
    );
  });
  it('honestly records fitting exact scales and large-plot fallback', () => {
    const service = new PdfExportService();
    const large = service.exportPdf(building, {
      floorId: building.floors[0]!.id,
      scale: '1:50',
      paperSize: 'A3',
    });
    expect(Buffer.from(large.data).toString()).toContain('FIT_TO_PAGE_NOT_TO_SCALE');
    expect(Buffer.from(large.data).toString()).toContain('APPROX 1:');
    const exact = service.exportPdf(building, {
      floorId: building.floors[0]!.id,
      scale: '1:200',
      paperSize: 'A1',
    });
    expect(Buffer.from(exact.data).toString()).toContain('EXACT_SCALE');
    expect(Buffer.from(exact.data).toString()).toContain('ISO A1');
  });

  it('preserves canonical utility sinks and rejects cooking fixtures without silently repairing source furniture', () => {
    const floor = building.floors.find((f) => f.rooms.some((r) => r.type === 'utility'))!;
    const utility = floor.rooms.find((r) => r.type === 'utility')!;
    const sink = {
      id: 'utility-sink',
      type: 'sink' as const,
      roomId: utility.id,
      xMm: utility.x + 250,
      yMm: utility.y + 250,
      widthMm: 600,
      depthMm: 500,
      rotationDeg: 0 as const,
      layer: 'A-FURN' as const,
    };
    const source = {
      ...building,
      floors: building.floors.map((f) => (f.id === floor.id ? { ...f, furniture: [sink] } : f)),
    };
    const before = JSON.stringify(source);
    const artifact = new CadExportService().exportCad(source, 'dxf', { floorId: floor.id });
    const parsed = verifyCadArtifact(artifact.data, 'dxf');
    expect((parsed.checks.layers as Record<string, number>)['A-FURN']).toBeGreaterThan(0);
    expect(JSON.stringify(source)).toBe(before);
    const invalid = {
      ...source,
      floors: source.floors.map((f) =>
        f.id === floor.id ? { ...f, furniture: [{ ...sink, type: 'stove' as const }] } : f,
      ),
    };
    expect(() => new CadExportService().exportCad(invalid, 'dwg', { floorId: floor.id })).toThrow(
      /correct the canonical model/,
    );
    expect(() => new PdfExportService().exportPdf(invalid, { floorId: floor.id })).toThrow(
      /correct the canonical model/,
    );
  });

  it('checks actual required layers, SVG annotation envelopes and corruption of valid CAD bytes', () => {
    const result = new CadExportService().exportCad(building, 'dxf', {
      exportScope: 'complete_project',
    });
    const verified = verifyCadArtifact(result.data, 'dxf');
    expect(verified.errors).toEqual([]);
    const counts = verified.checks.layers as Record<string, number>;
    for (const layer of [
      'A-WALL',
      'S-COLS',
      'S-BEAM',
      'A-DOOR',
      'A-WIND',
      'A-FURN',
      'A-ANNO-TEXT',
    ]) {
      expect(
        counts[layer] ?? 0,
        `${layer} must contain serialized entities: ${JSON.stringify(counts)}`,
      ).toBeGreaterThan(0);
    }
    const dxf = Buffer.from(result.data).toString();
    const changed = building.floors.map((f, i) =>
      i === 0
        ? {
            ...f,
            boundary: {
              points: f.boundary.points.map((p, j) => (j === 0 ? { ...p, x: p.x + 100 } : p)),
            },
          }
        : f,
    );
    expect(verifyCadArtifact(result.data, 'dxf', undefined, changed).isValid).toBe(false);
    expect(verified.document!.header!.splineType).toBe(6);
    for (const entity of verified.document!.entities!)
      if (entity instanceof acad.DimensionAligned) {
        expect(entity.block?.name).toMatch(/^\*D/);
        expect([...entity.block!.entities].length).toBeGreaterThan(0);
      }
    const badBlock = dxf.replace(/(\nDIMENSION[\s\S]*?\n  2\n)\*D\d+/, '$1');
    expect(badBlock).not.toBe(dxf);
    expect(verifyCadArtifact(Buffer.from(badBlock), 'dxf').isValid).toBe(false);
    const badSpline = dxf.replace(/(\$SPLINETYPE\s+70\s+)6\b/, '$10');
    expect(badSpline).not.toBe(dxf);
    expect(verifyCadArtifact(Buffer.from(badSpline), 'dxf').isValid).toBe(false);
    expect(
      verifyCadArtifact(Buffer.concat([Buffer.from([0xff]), result.data]), 'dxf').isValid,
    ).toBe(false);
    const wrongUnits = dxf.replace(/(\$INSUNITS\s+70\s+)4\b/, '$11');
    expect(wrongUnits).not.toBe(dxf);
    expect(verifyCadArtifact(Buffer.from(wrongUnits), 'dxf').isValid).toBe(false);
    expect(verifyCadArtifact(result.data.subarray(0, result.data.length / 2), 'dxf').isValid).toBe(
      false,
    );
    for (const floor of building.floors) {
      const svg = renderFloor(
        floor,
        building,
        { scale: 0.02, offsetX: 60, offsetY: 60 },
        1200,
        1200,
        { showNorthArrow: false, showScaleBar: false, showTitleBlock: false },
      );
      const boxes: TextBox[] = [];
      for (const match of svg.matchAll(/data-text-box="([^"]+)"/g)) {
        const [x, y, width, height] = match[1]!.split(',').map(Number);
        const box = { x: x!, y: y!, width: width!, height: height!, text: 'SVG' };
        expect(boxes.some((other) => textBoxesOverlap(box, other))).toBe(false);
        boxes.push(box);
      }
      expect(boxes.length).toBeGreaterThan(0);
    }
  });
});

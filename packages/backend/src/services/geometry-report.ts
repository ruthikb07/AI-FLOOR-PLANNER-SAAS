import { createHash } from 'node:crypto';
import { canonicalRevisionJson, type Building } from '@ai-floor-planner/core';
import { measureApartmentAreaLedger } from '@ai-floor-planner/geometry-engine';
import { GeometryValidator } from '@ai-floor-planner/planning-engine';
import { selectExportFloors } from './export-selection.js';

export function canonicalRevisionHash(building: Building): string {
  return createHash('sha256').update(canonicalRevisionJson(building)).digest('hex');
}
export function geometryReport(building: Building) {
  const floors = selectExportFloors(building, { exportScope: 'all_floors' });
  const audit = new GeometryValidator({ autoCorrect: false }).audit(building, false).report;
  return {
    schemaVersion: 1,
    buildingId: building.id,
    revision: building.version,
    revisionHash: canonicalRevisionHash(building),
    units: 'mm',
    areaUnits: 'mm2',
    status: audit.isValid ? 'INTERNAL ENGINEERING GATE PASSED' : 'INTERNAL ENGINEERING GATE FAILED',
    disclaimer:
      'Automated checks provide engineering design assistance and require verification by a licensed Architect/Engineer before municipal submission.',
    floors: floors.map((floor) => ({
      floorId: floor.id,
      name: floor.name,
      ledger: measureApartmentAreaLedger(floor),
      wallHierarchy: floor.walls.map((w) => {
        const expected = {
          EXTERNAL: 230,
          UNIT_SEPARATION: 230,
          COMMON_CORRIDOR: 150,
          INTERNAL_PARTITION: 115,
          SHAFT: 100,
          CORE: 150,
          BALCONY: w.type === 'external' ? 230 : 115,
          PARAPET: 230,
        }[w.wallUse ?? 'EXTERNAL'];
        return {
          id: w.id,
          type: w.type,
          wallUse: w.wallUse ?? 'UNKNOWN',
          thicknessMm: w.thickness,
          expectedMm: w.wallUse ? expected : null,
          status: w.wallUse
            ? Math.abs(w.thickness - expected) < 0.001
              ? 'PASSED'
              : 'FAILED'
            : 'NOT_VERIFIED',
        };
      }),
      openingChecks: [...floor.doors, ...floor.windows].map((o) => ({
        id: o.id,
        wallId: o.wallId,
        wallExists: floor.walls.some((w) => w.id === o.wallId),
        position: o.position,
        widthMm: o.width,
      })),
      staircases: { canonical: floor.canonicalStaircases ?? [], instances: floor.stairs },
      errors: audit.errors.filter((e) => JSON.stringify(e).includes(floor.id)),
    })),
    audit,
  };
}

/** Small deterministic text PDF writer; explicit page breaks keep report lines distinct. */
export function reportPdf(report: ReturnType<typeof geometryReport>): Uint8Array {
  const lines = [
    'GEOMETRY & AREA CLOSURE REPORT',
    report.status,
    `Building ${report.buildingId} revision ${report.revision}`,
    `Canonical SHA-256 ${report.revisionHash}`,
    'Units: mm / mm2; acceptance: absolute delta < 0.001 mm2',
    'PROFESSIONAL REVIEW REQUIRED',
    report.disclaimer,
    ...report.floors.flatMap((f) => [
      `FLOOR ${f.name} (${f.floorId})`,
      ...Object.entries(f.ledger)
        .filter(([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')
        .map(([k, v]) => `${k}: ${v}`),
      'WALL HIERARCHY (canonical millimeters)',
      ...f.wallHierarchy.map(
        (w) =>
          `${w.id} | ${w.wallUse} | actual ${w.thicknessMm} mm / expected ${w.expectedMm ?? 'UNKNOWN'} | ${w.status}`,
      ),
      'OPENING CHECKS',
      ...f.openingChecks.map(
        (o) =>
          `${o.id} | host ${o.wallId} | exists ${o.wallExists} | ${o.widthMm} mm @ ${o.position.x},${o.position.y}`,
      ),
      `STAIRCASES: ${f.staircases.canonical.length} canonical; ${f.staircases.instances.length} instances`,
      ...f.staircases.canonical.map((s) => JSON.stringify(s)),
    ]),
    'AUDIT FINDINGS',
    ...report.audit.errors.map((e) => `${e.code}: ${e.description}`),
  ].flatMap((line) => {
    const wrapped: string[] = [];
    while (line.length > 95) {
      let end = line.lastIndexOf(' ', 95);
      if (end <= 0) end = 95;
      wrapped.push(line.slice(0, end));
      line = line.slice(end).trimStart();
    }
    wrapped.push(line);
    return wrapped;
  });
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  const refs: string[] = [];
  for (let start = 0; start < lines.length; start += 48) {
    const page = objects.length + 1;
    refs.push(`${page} 0 R`);
    const stream =
      '% SCALE_MODE REPORT_NOT_TO_SCALE\n' +
      `BT /F1 8 Tf 32 824 Td (Geometry and Area Closure - revision ${report.revision} - page ${Math.floor(start / 48) + 1} of ${Math.ceil(lines.length / 48)}) Tj ET\n` +
      lines
        .slice(start, start + 48)
        .map(
          (line, i) =>
            `BT /F1 8 Tf 32 ${800 - i * 15} Td (${line.replace(/[^\x20-\x7e]/g, '').replace(/([\\()])/g, '\\$1')}) Tj ET`,
        )
        .join('\n') +
      '\n';
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${page + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${refs.join(' ')}] /Count ${refs.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => (pdf += `${String(offset).padStart(10, '0')} 00000 n \n`));
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

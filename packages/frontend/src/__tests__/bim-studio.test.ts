// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { compressGuid, readIfc4Step, type Building } from '@ai-floor-planner/core';
import { canonicalOpeningGeometry } from '@ai-floor-planner/geometry-engine';
import { projectBuildingTo3D } from '@ai-floor-planner/projection-3d';
import { calculateBimSchedule, scheduleCsv } from '../services/bim-quantities';
import { findBimClashes } from '../services/bim-clash';
import { queryBimSchedule } from '../services/bim-query';
import { alignedPlanPrism, readIfcReference } from '../services/ifc-reference';

const fixture = JSON.parse(await readFile(new URL('../../../../test-artifacts/phase1-generated/four-flat-production-building.json', import.meta.url), 'utf8')) as Building;
const floor = fixture.floors.find(candidate => candidate.floorUse === 'RESIDENTIAL')!;
const projection = projectBuildingTo3D(fixture);
const walls = projection.walls.filter(item => item.floorId === floor.id);
const plate = projection.floorPlates.find(item => item.floorId === floor.id);

it('measures current hosted opening dimensions and recomputes the schedule after a revision', () => {
  const first = floor.windows[0]!;
  const original = calculateBimSchedule(floor, walls, plate);
  const before = original.rows.find(row => row.kind === 'window' && row.id === first.id)!;
  expect(before.areaMm2).toBe(first.width * first.height);
  const edited = { ...floor, windows: floor.windows.map(window => window.id === first.id ? { ...window, width: window.width - 40 } : window) };
  const after = calculateBimSchedule(edited, walls, plate);
  expect(after.rows.find(row => row.id === first.id)?.areaMm2).toBe((first.width - 40) * first.height);
  expect(after.modeledCarpetMm2).toBe(original.modeledCarpetMm2);
  expect(original.rows.filter(row => row.kind === 'flat')).toHaveLength(floor.apartmentUnits!.length);
  expect(queryBimSchedule('Show all doors', after.rows).matches).toHaveLength(floor.doors.length);
  expect(queryBimSchedule('Total window area', after.rows).text).toMatch(/m² of window openings/);
  expect(queryBimSchedule('Upload the model elsewhere', after.rows).mode).toBe('UNSUPPORTED');
  expect(scheduleCsv([{ ...before, name: '=HYPERLINK("text")' }])).toContain("\"'=HYPERLINK(");
});

it('confirms exact prism overlap, excludes intentional opening volume and rejects mere face contact', () => {
  const door = floor.doors.find(opening => opening.openingGeometryVersion === 1 && walls.some(wall =>
    wall.sourceEntityId === opening.wallId && !wall.arc && wall.height > opening.height))!;
  expect(door).toBeTruthy();
  const host = floor.walls.find(wall => wall.id === door.wallId)!;
  const view = walls.find(wall => wall.sourceEntityId === host.id)!;
  const geometry = canonicalOpeningGeometry(door, host);
  const n = { x: -geometry.uy, y: geometry.ux };
  const p = geometry.pointAt(geometry.center - 40), q = geometry.pointAt(geometry.center + 40);
  const positions = (offset: number) => [[p, offset - 20], [q, offset - 20], [q, offset + 20], [p, offset + 20]]
    .map(([point, distance]) => {
      const vector = point as typeof p;
      return { x: vector.x + n.x * Number(distance), y: -(vector.y + n.y * Number(distance)) };
    });
  const sample = { globalId: 'reference-column', ifcClass: 'IFCCOLUMN', name: 'Column', boundary: positions(0),
    bottomMm: view.elevation + 10, topMm: view.elevation + 90 };
  const input = { floor, walls: [view], alignment: { x: 0, y: 0, z: 0, angle: 0 }, referenceSha256: 'ref',
    revisionSha256: 'rev', toleranceMm: 0.01 };
  expect(findBimClashes({ ...input, reference: [sample] }).results).toHaveLength(0);
  const top = view.elevation + door.height + 81;
  const inWall = { ...sample, bottomMm: top - 80, topMm: top };
  expect(findBimClashes({ ...input, reference: [inWall] }).results[0]?.volumeMm3).toBeCloseTo(80 * 40 * 80, 3);
  expect(findBimClashes({ ...input, reference: [{ ...inWall, boundary: positions(host.thickness / 2 + 20) }] }).results).toHaveLength(0);
});

it('refuses unsupported schema, dangling references, duplicate identities and oversized input', () => {
  const guid = compressGuid('12345678123456781234567812345678');
  const envelope = (data: string, schema = 'IFC4') => new TextEncoder().encode(
    "ISO-10303-21;HEADER;FILE_SCHEMA(('" + schema + "'));ENDSEC;DATA;" + data + 'ENDSEC;END-ISO-10303-21;',
  );
  expect(() => readIfc4Step(envelope('#1=IFCDIRECTION((0.,0.,1.));', 'IFC2X3'))).toThrow('IFC_SCHEMA_UNSUPPORTED');
  expect(() => readIfc4Step(envelope('#1=IFCLOCALPLACEMENT($,#42);'))).toThrow('IFC_DANGLING_REFERENCE');
  const root = "IFCWALL('" + guid + "',$,'Wall',$,$,$,$,$,.NOTDEFINED.);";
  expect(() => readIfc4Step(envelope('#1=' + root + '#2=' + root))).toThrow('IFC_INVALID_OR_DUPLICATE_GLOBAL_ID');
  expect(() => readIfc4Step(new Uint8Array(25 * 1024 * 1024 + 1))).toThrow('IFC_FILE_SIZE_LIMIT');
});

it('imports an independently authored metre IFC with nested storey and product placements', async () => {
  const bytes = await readFile(new URL('./fixtures/ifc4-metre-column.ifc', import.meta.url));
  const model = readIfcReference(bytes);
  expect(model.unit).toBe('m');
  expect(model.storeys[0]?.elevationMm).toBe(3200);
  expect(model.elements[0]?.globalId).toBe(compressGuid('00000000000000000000000000000008'));
  const source = model.elements[0]!.prisms[0]!;
  expect(source.bottomMm).toBe(3200);
  expect(source.topMm).toBe(6000);
  expect(Math.min(...source.boundary.map(point => point.x))).toBeCloseTo(2900);
  expect(Math.max(...source.boundary.map(point => point.y))).toBeCloseTo(4700);
  const aligned = alignedPlanPrism(source, { x: 400, y: 500, z: -200, angle: 0 });
  expect(Math.min(...aligned.boundary.map(point => point.x))).toBeCloseTo(3300);
  expect(Math.min(...aligned.boundary.map(point => point.y))).toBeCloseTo(-5200);
  expect(aligned.bottomMm).toBe(3000);
});

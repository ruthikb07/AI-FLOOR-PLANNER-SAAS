import { it, expect } from 'vitest';
import { createETABSSidecar, verifyETABSSidecar } from '../services/etabs-provenance';
import { structuralExportProjects } from './fixtures/structural-export-projects';

it('binds external revision provenance to exact EDB and source bytes, rejecting substitutions', () => {
  const project = structuralExportProjects()[0];
  const source = Buffer.from(JSON.stringify(project));
  const edb = Buffer.from('EXPLICIT MOCK EDB BYTES');
  const sidecar = createETABSSidecar(project, edb, source);
  expect(verifyETABSSidecar(sidecar, project, edb, source).RH_ARCHITECTURAL_REVISION).toBe(project.sourceArchitecturalRevisionId);
  expect(() => verifyETABSSidecar(sidecar, project, Buffer.from('changed'), source)).toThrow(/provenance/);
  expect(() => verifyETABSSidecar(sidecar, project, edb, Buffer.from('{}'))).toThrow(/provenance/);
  expect(() => verifyETABSSidecar({ ...sidecar, sourceArchitecturalRevisionId: 'stale' }, project, edb, source)).toThrow(/provenance/);
  expect(() => verifyETABSSidecar(sidecar, structuralExportProjects()[1], edb, source)).toThrow(/provenance/);
  expect(() => verifyETABSSidecar(sidecar, { ...project, nodes: [] }, edb, source)).toThrow(/provenance/);
});

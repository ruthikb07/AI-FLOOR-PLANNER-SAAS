import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteProjectEngineeringDocument,
  listProjectEngineeringDocuments,
  loadProjectEngineeringDocument,
  saveProjectEngineeringDocument,
} from '../services/local-project-store.js';

describe('Unified Project Engineering Document Storage', () => {
  let tempRoot = '';
  const prevEnv = process.env.RH_LOCAL_PROJECTS_DIR;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-unified-docs-'));
    process.env.RH_LOCAL_PROJECTS_DIR = tempRoot;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.RH_LOCAL_PROJECTS_DIR;
    else process.env.RH_LOCAL_PROJECTS_DIR = prevEnv;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('persists, lists, loads, and deletes Cota CAD and OpenBIM BCF documents scoped to a project', () => {
    const savedCad = saveProjectEngineeringDocument('proj-alpha-01', {
      docId: 'cota-floor-g',
      buildingId: 'bldg-alpha-01',
      floorId: 'floor-g',
      kind: 'cota_drawing',
      name: 'Ground Floor Precision CAD',
      fileName: 'proj-alpha-01-floor-g.cota',
      mimeType: 'application/json',
      canonicalRevision: 4,
      canonicalDigest: 'a'.repeat(64),
      provenance: 'authored_cota',
      contentText: JSON.stringify({ schemaVersion: 1, units: 'mm', entities: [] }),
    });
    expect(savedCad.projectId).toBe('proj-alpha-01');
    expect(savedCad.canonicalRevision).toBe(4);

    const bcfBytes = Buffer.from('PK-mock-bcf-archive');
    saveProjectEngineeringDocument('proj-alpha-01', {
      docId: 'bcf-coord-01',
      buildingId: 'bldg-alpha-01',
      kind: 'bcf_archive',
      name: 'MEP Clash Coordination',
      fileName: 'coord-r4.bcfzip',
      mimeType: 'application/zip',
      canonicalRevision: 4,
      provenance: 'authored_openbim',
      contentBase64: bcfBytes.toString('base64'),
    });

    const list = listProjectEngineeringDocuments('proj-alpha-01');
    expect(list.length).toBe(2);

    const loaded = loadProjectEngineeringDocument('proj-alpha-01', 'cota-floor-g');
    expect(loaded).not.toBeNull();
    expect(loaded!.bytes.toString('utf8')).toContain('"units":"mm"');

    expect(deleteProjectEngineeringDocument('proj-alpha-01', 'bcf-coord-01')).toBe(true);
    expect(listProjectEngineeringDocuments('proj-alpha-01').length).toBe(1);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as acad from '@node-projects/acad-ts';
import { createMockCanonicalBuilding } from '../__fixtures__/canonical-building.js';

import { createBackendServer } from '../server.js';
import { resolveServiceConfig } from '../env.js';
import type { Server } from 'node:http';
describe('Live CAD Export HTTP API (isolated server)', () => {
  const building = createMockCanonicalBuilding();
  let server:Server;let baseUrl='';let exportedFilename='';
  beforeAll(async()=>{
    const config=resolveServiceConfig();
    server=createBackendServer({gemini:null,briefInterpreterKind:'local-stub',config});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    baseUrl=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  });
  afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});

  it('exports genuine binary AutoCAD DWG with AC1032 magic, correct headers, and disk persistence', async () => {
    const res = await fetch(`${baseUrl}/api/v1/export/dwg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        building,
        options: {
          includeDimensions: true,
          includeRoomLabels: true,
          includeRoomAreas: true,
          includeOpenings: true,
          includeSite: true,
          includeTitleBlock: true,
          scale: '1:100',
          projectNumber: 'PROJ-LIVE-001',
          revision: '01',
        },
      }),
    });
    if (res.status !== 200) {
      const errText = await res.text();
      console.error('500 Error Body:', errText);
    }
    expect(['application/acad', 'application/x-dwg']).toContain(res.headers.get('content-type'));

    const disposition = res.headers.get('content-disposition');
    expect(disposition).toBeTruthy();
    expect(disposition).toContain('attachment;');
    expect(disposition).toMatch(/filename="[^"]+\.dwg"/);
    expect(disposition).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/); // No UUID in filename!

    const diskPaths = res.headers.get('x-cad-disk-path');
    expect(diskPaths).toBeTruthy();
    expect(diskPaths).toContain('cad-export');

    const downloadUrl = res.headers.get('x-cad-download-url');
    expect(downloadUrl).toBeTruthy();
    expect(downloadUrl).toContain('/api/v1/export/download/');

    const buffer = await res.arrayBuffer();
    const data = new Uint8Array(buffer);
    expect(data.length).toBeGreaterThan(5000);

    // Magic bytes verification
    const magic = Buffer.from(data.subarray(0, 6)).toString('ascii');
    expect(magic).toBe('AC1032'); // Genuine AutoCAD 2018-2025 DWG binary signature!

    // Parse with DwgReader
    const reader = new acad.DwgReader(data);
    const doc = reader.read();
    expect(doc).toBeDefined();
    expect(doc.header).toBeDefined();

    // Verify layers
    const layerNames = doc.layers ? [...doc.layers].map(l => l.name) : [];
    expect(layerNames).toContain('A-WALL-EXT');
    expect(layerNames).toContain('A-WALL-INT');
    expect(layerNames).toContain('A-DOOR');
    expect(layerNames).toContain('A-WIND');
    expect(layerNames).toContain('A-DIMS');
    expect(layerNames).toContain('A-ANNO');
    expect(layerNames).toContain('A-ROOM-NAME');
    expect(layerNames).toContain('A-ROOM-AREA');

    // Verify entities
    const entities = doc.entities ? [...doc.entities] : [];
    expect(entities.length).toBeGreaterThan(50);
  });

  it('exports genuine ASCII DXF with SECTION header, correct filename, and disk persistence', async () => {
    const res = await fetch(`${baseUrl}/api/v1/export/dxf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        building,
        options: { revision: '01' },
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/dxf');

    const disposition = res.headers.get('content-disposition');
    expect(disposition).toContain('.dxf');
    exportedFilename=JSON.parse(res.headers.get('x-artifact-descriptor')!).fileName;
    expect(disposition).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);

    const diskPaths = res.headers.get('x-cad-disk-path');
    expect(diskPaths).toBeTruthy();

    const buffer = await res.arrayBuffer();
    const text = Buffer.from(buffer).toString('ascii');
    expect(text).toContain('SECTION');
    expect(text).toContain('HEADER');
    expect(text).toContain('ENTITIES');
    expect(text).toContain('EOF');
  });

  it('serves previously exported CAD drawing directly via GET /api/v1/export/download/:filename', async () => {
    const filename = exportedFilename;
    const res = await fetch(`${baseUrl}/api/v1/export/download/${filename}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/dxf');
    expect(res.headers.get('content-disposition')).toContain(`attachment; filename="${filename}"`);

    const text = await res.text();
    expect(text).toContain('SECTION');
    expect(text).toContain('EOF');
  });

  it('rejects unverified arbitrary persistence via POST /api/v1/export/persist', async () => {
    const testFilename = 'test_canonical_export.json';
    const testContent = JSON.stringify({ test: true, time: Date.now() });

    const res = await fetch(`${baseUrl}/api/v1/export/persist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: testFilename,
        content: testContent,
      }),
    });

    expect(res.status).toBe(400);
    const json=await res.json() as {error:{code:string}};
    expect(json.error.code).toBe('INVALID_REQUEST');
  });

  it('gracefully handles missing building object with clear HTTP 400 JSON error', async () => {
    const res = await fetch(`${baseUrl}/api/v1/export/dwg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: {} }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INVALID_REQUEST');
  });
});

import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createETABSExportRoute } from '../api/etabs-export-routes';
import { ETABSStructuralExportService } from '../services/etabs-structural-export';
import { LocalETABSBridgeTransport, LocalETABSConnector } from '../services/etabs-connector';
import { compareETABSStructuralModel } from '../services/etabs-structural-comparison';
import { verifyETABSSidecar } from '../services/etabs-provenance';
import { structuralExportProjects } from './fixtures/structural-export-projects';
import { loadedStructuralFixtures } from './fixtures/etabs-loaded-projects';
import type { ETABSCommand, ETABSResponse, ETABSExportDescriptor } from '@ai-floor-planner/core';

it.skipIf(process.env.RH_ETABS_NATIVE_TEST !== '1')('downloads model-only and loaded native EDB over authenticated HTTP and reopens the downloaded bytes in ETABS 23.3.2', async () => {
  const root = path.resolve('output/etabs/download-acceptance-' + Date.now());
  const bridgeExecutable = process.env.ETABS_BRIDGE_EXE!;
  const installDirectory = process.env.ETABS_INSTALL_DIR!;
  const token = randomBytes(32).toString('hex');
  const service = new ETABSStructuralExportService({ artifactRoot: root, bridgeExecutable, installDirectory, allowVerificationFixtures: true });
  const route = createETABSExportRoute(() => service, () => ({ token, allowedOrigins: [] }));
  const server = createServer((req, res) => {
    void route(req, res, new URL(req.url!, 'http://localhost'), async request => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks).toString('utf8');
    }).catch(() => { res.statusCode = 500; res.end(); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const accepted = [];
  try {
    for (const project of [structuralExportProjects()[0]!, loadedStructuralFixtures()[1]!]) {
      project.grid = { name: 'Reviewed_Grid', originXMm: -125.5, originYMm: 212.25, rotationDeg: 0,
        xLineCount: 3, yLineCount: 4, spacingXMm: 3450.5, spacingYMm: 2500.25 };
      const response = await fetch(base + '/api/v1/export/etabs', { method: 'POST', headers, body: JSON.stringify({ project }) });
      const body = await response.json() as { artifact: ETABSExportDescriptor };
      expect(response.status, JSON.stringify(body)).toBe(201);
      const descriptor = body.artifact;
      expect((await fetch(base + descriptor.downloadUrl)).status).toBe(401);
      const download = await fetch(base + descriptor.downloadUrl, { headers });
      expect(download.status).toBe(200);
      const bytes = Buffer.from(await download.arrayBuffer());
      expect(bytes.length).toBe(descriptor.byteLength);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(descriptor.sha256);
      const directory = path.join(root, 'downloaded-' + descriptor.artifactId);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, descriptor.fileName), bytes, { flag: 'wx' });
      const source = await readFile(path.join(root, descriptor.artifactId, 'structural-project.json'));
      const sidecar = await readFile(path.join(root, descriptor.artifactId, 'provenance.json'));
      const provenance = verifyETABSSidecar(JSON.parse(sidecar.toString()), project, bytes, source);
      await writeFile(path.join(directory, 'structural-project.json'), source);
      await writeFile(path.join(directory, 'provenance.json'), sidecar);
      const connector = new LocalETABSConnector(new LocalETABSBridgeTransport({ bridgeExecutable, installDirectory, modelDirectory: directory, timeoutMs: 180000 }));
      const evidence: { command: ETABSCommand; result: ETABSResponse }[] = [];
      const call = async (command: ETABSCommand) => {
        const result = await connector.execute(command); evidence.push({ command, result });
        await writeFile(path.join(directory, 'native-reopen-progress.json'), JSON.stringify(evidence, null, 2));
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (!result.ok) throw new Error(result.error.message);
        expect(result.apiCalls?.length).toBeGreaterThan(0);
        expect(result.apiCalls?.every(c => c.code === 0)).toBe(true);
        return result.data;
      };
      try {
        const connected = await call({ operation: 'connect' });
        expect(connected.applicationVersion).toBe('23.3.2');
        await call({ operation: 'open', fileName: descriptor.fileName, sourceArchitecturalRevisionId: project.sourceArchitecturalRevisionId });
        const { snapshot } = await call({ operation: 'inspectStructural' });
        expect(snapshot).toBeDefined();
        expect(compareETABSStructuralModel(project, snapshot!, provenance)).toEqual([]);
        await call({ operation: 'disconnect' });
        expect(createHash('sha256').update(await readFile(path.join(directory, descriptor.fileName))).digest('hex')).toBe(descriptor.sha256);
        const record = { scope: 'SOFTWARE VERIFICATION — NOT FOR CONSTRUCTION', descriptor, httpDownloadVerified: true, downloadedFileReopened: true, snapshot, evidence };
        await writeFile(path.join(directory, 'download-verification.json'), JSON.stringify(record, null, 2));
        accepted.push({ directory, descriptor });
      } finally { await connector.execute({ operation: 'disconnect', discardUnsaved: true }); connector.close(); }
    }
    await writeFile(path.join(root, 'acceptance.json'), JSON.stringify(accepted, null, 2));
    console.info('HTTP download and native reopen acceptance:', root);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}, 720000);

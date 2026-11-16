import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Direction, DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES } from '@ai-floor-planner/core';
import { generateHardenedResidential } from '../../../planning-engine/src/structural/hardened-residential-generation';
import { buildPreliminaryStructuralProject } from '../services/preliminary-structural-project';
import { validateStructuralExportGeometry } from '../services/structural-export-geometry';
import { parseStructuralProjectForExport } from '@ai-floor-planner/core';
import { ETABSStructuralExportService } from '../services/etabs-structural-export';
import { createETABSExportRoute } from '../api/etabs-export-routes';
import { LocalETABSBridgeTransport, LocalETABSConnector } from '../services/etabs-connector';
import { compareETABSStructuralModel } from '../services/etabs-structural-comparison';
import { verifyETABSSidecar } from '../services/etabs-provenance';
import type { ETABSExportDescriptor, ETABSCommand, ETABSResponse } from '@ai-floor-planner/core';

describe('Preliminary StructuralProject Architecture-to-ETABS Pipeline', () => {
  const synthesisConfig = {
    projectId: 'arch-prelim-structural-001',
    plotWidthMm: 18000,
    plotDepthMm: 25000,
    roadWidthMm: 12000,
    roadAccessSides: [Direction.North],
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT' as const,
    jurisdiction: 'generic_maharashtra' as const,
    verticalStackType: 'STILT_PLUS_N' as const,
    numTypicalFloors: 3,
    flatsPerFloor: 2 as const,
    units: [
      { unitIndex: 1, bhkType: '2BHK' as const, hasUtilityBalcony: true },
      { unitIndex: 2, bhkType: '3BHK' as const, hasUtilityBalcony: true },
    ],
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_ONLY' as const,
  };

  it('generates a valid, verified preliminary StructuralProject from canonical residential building', () => {
    const synthesized = generateHardenedResidential(synthesisConfig);
    expect(synthesized.accepted).toBe(true);
    const building = synthesized.building;

    const project = buildPreliminaryStructuralProject(building, {
      reviewerId: 'PRELIM_CONSULTANT_TEST',
      preliminaryConcreteGrade: 'M25',
      preliminarySteelGrade: 'Fe500',
    });

    expect(project.schemaVersion).toBe(1);
    expect(project.reviewStatus).toBe('ENGINEER_REVIEWED_MODEL_ONLY');
    expect(project.exportReview!.status).toBe('ENGINEER_REVIEWED');
    expect(project.exportReview!.reviewerId).toBe('PRELIM_CONSULTANT_TEST');
    expect(project.exportReview!.inputSha256).toMatch(/^[0-9a-f]{64}$/);

    expect(project.levels[0]!.name).toBe('Base');
    expect(project.levels[0]!.elevationMm).toBe(0);
    expect(project.levels.length).toBe(building.floors.length + 1);

    expect(project.nodes.length).toBeGreaterThan(0);
    expect(project.columns.length).toBeGreaterThan(0);
    expect(project.beams.length).toBeGreaterThan(0);
    expect(project.slabs.length).toBeGreaterThan(0);
    expect(project.materials.length).toBe(2);
    expect(project.loadCases).toHaveLength(0);
    expect(project.loadCombinations).toHaveLength(0);

    // Validate geometry and boundary parsers with zero errors
    expect(() => validateStructuralExportGeometry(project)).not.toThrow();
    expect(() => parseStructuralProjectForExport(project)).not.toThrow();
  });

  it.skipIf(process.env.RH_ETABS_NATIVE_TEST !== '1')(
    'exports preliminary model to native ETABS 23.3.2, downloads over HTTP, and verifies zero readback mismatches',
    async () => {
      const synthesized = generateHardenedResidential(synthesisConfig);
      expect(synthesized.accepted).toBe(true);
      const building = synthesized.building;

      const project = buildPreliminaryStructuralProject(building, {
        reviewerId: 'PRELIM_STRUCTURAL_SE1',
        preliminaryConcreteGrade: 'M25',
        preliminarySteelGrade: 'Fe500',
      });

      const root = path.resolve('output/etabs/preliminary-acceptance-' + Date.now());
      const bridgeExecutable = process.env.ETABS_BRIDGE_EXE!;
      const installDirectory = process.env.ETABS_INSTALL_DIR!;
      const token = randomBytes(32).toString('hex');
      const service = new ETABSStructuralExportService({ artifactRoot: root, bridgeExecutable, installDirectory });
      const route = createETABSExportRoute(() => service, () => ({ token, allowedOrigins: [] }));

      const server = createServer((req, res) => {
        void route(req, res, new URL(req.url!, 'http://localhost'), async request => {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          return Buffer.concat(chunks).toString('utf8');
        }).catch(() => { res.statusCode = 500; res.end(); });
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address() as { port: number };
      const base = `http://127.0.0.1:${address.port}`;
      const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

      try {
        const response = await fetch(base + '/api/v1/export/etabs', { method: 'POST', headers, body: JSON.stringify({ project }) });
        const body = await response.json() as { artifact: ETABSExportDescriptor };
        expect(response.status, JSON.stringify(body)).toBe(201);
        const descriptor = body.artifact;

        expect(descriptor.exportMode).toBe('MODEL_ONLY');
        expect(descriptor.analysisStatus).toBe('NOT_ANALYZED');
        expect(descriptor.designStatus).toBe('NOT_VERIFIED');
        expect(descriptor.verification).toBe('NATIVE_REOPEN_MATCH');

        // Download over HTTP
        const download = await fetch(base + descriptor.downloadUrl, { headers });
        expect(download.status).toBe(200);
        const bytes = Buffer.from(await download.arrayBuffer());
        expect(bytes.length).toBe(descriptor.byteLength);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(descriptor.sha256);

        // Save downloaded bytes and reopen in ETABS 23.3.2
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
          const result = await connector.execute(command);
          evidence.push({ command, result });
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

          const mismatches = compareETABSStructuralModel(project, snapshot!, provenance);
          expect(mismatches).toEqual([]);

          await call({ operation: 'disconnect' });
          const record = {
            scope: 'PRELIMINARY MODEL — NOT ANALYZED — FOR STRUCTURAL ENGINEER REVIEW — NOT FOR CONSTRUCTION',
            descriptor,
            httpDownloadVerified: true,
            downloadedFileReopened: true,
            snapshot,
            evidence,
          };
          await writeFile(path.join(directory, 'preliminary-acceptance.json'), JSON.stringify(record, null, 2));
        } finally {
          await connector.execute({ operation: 'disconnect', discardUnsaved: true });
          connector.close();
        }
      } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    },
    720000,
  );
});

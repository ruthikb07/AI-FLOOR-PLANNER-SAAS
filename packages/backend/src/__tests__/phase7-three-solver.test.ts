import { createHash } from 'node:crypto';
import path from 'node:path';
import { expect, it } from 'vitest';
import { AwatifStructuralSolver, convertStructuralProjectToAnalyticalModel } from '@ai-floor-planner/structural-engine';
import { ETABSFixtureAnalysisService } from '../services/etabs-fixture-analysis';
import { loadedStructuralFixtures } from './fixtures/etabs-loaded-projects';

const externalId = (prefix: string, id: string) =>
  prefix + createHash('sha256').update(id).digest('hex').slice(0, 16).toUpperCase();

function frameOnlyFixtures() {
  return loadedStructuralFixtures().map(project => ({
    ...project,
    slabs: [],
    beams: project.beams.map(beam => ({ ...beam, localAxisAngleDeg: 0 })),
  }));
}

it('compares orthogonal asymmetric 3D frames with identical WASM and Sparse-LU inputs', async () => {
  const solver = new AwatifStructuralSolver();
  await solver.initialize();
  for (const fixture of frameOnlyFixtures()) {
    const model = convertStructuralProjectToAnalyticalModel(fixture);
    const wasm = await solver.analyze(model, { preferredBackend: 'AWATIF_CPP_WASM' });
    const reference = await solver.analyze(model, { preferredBackend: 'TYPESCRIPT_SPARSE_LU_REFERENCE' });
    for (const [id, a] of Object.entries({ ...wasm.loadCaseResults, ...wasm.combinationResults })) {
      const b = reference.loadCaseResults[id] ?? reference.combinationResults[id]!;
      expect(a.diagnostics.executionBackend).toBe('AWATIF_CPP_WASM');
      expect(b.diagnostics.executionBackend).toBe('TYPESCRIPT_SPARSE_LU_REFERENCE');
      expect(a.equilibrium.isEquilibrated && b.equilibrium.isEquilibrated).toBe(true);
      const close = (x: number, y: number) => expect(Math.abs(x - y)).toBeLessThanOrEqual(1e-8 + Math.abs(y) * 1e-8);
      a.displacements.forEach((x, i) => x.translationM.forEach((v, k) => close(v, b.displacements[i]!.translationM[k]!)));
      a.reactions.forEach((x, i) => x.reactionKnM.forEach((v, k) => close(v, b.reactions[i]!.reactionKnM[k]!)));
      a.memberForces.forEach((x, i) => {
        const member = b.memberForces[i]!;
        x.localEndActionsKnM.forEach((v, k) => close(v, member.localEndActionsKnM[k]!));
        expect(x.stations.length).toBe(member.stations.length);
        x.stations.forEach((station, k) => {
          const other = member.stations[k]!;
          for (const key of ['xM', 'axialTensionPositiveKn', 'shearVyKn', 'shearVzKn', 'momentMyKnM', 'momentMzKnM'] as const) {
            close(station[key], other[key]);
          }
        });
      });
    }
  }
}, 90_000);

it.skipIf(process.env.RH_ETABS_NATIVE_TEST !== '1')('reads native frame-only ETABS results and reports direct WASM differences', async () => {
  const service = new ETABSFixtureAnalysisService({
    artifactRoot: path.resolve('output/etabs', 'phase7-frames-' + Date.now()),
    bridgeExecutable: process.env.ETABS_BRIDGE_EXE!,
    installDirectory: process.env.ETABS_INSTALL_DIR!,
    allowVerificationFixtures: true,
  });
  const solver = new AwatifStructuralSolver();
  await solver.initialize();
  let gravityMaxN = 0;
  let gravityMaxMm = 0;
  for (const fixture of frameOnlyFixtures()) {
    const wasm = await solver.analyze(convertStructuralProjectToAnalyticalModel(fixture), { preferredBackend: 'AWATIF_CPP_WASM' });
    const { manifest, directory } = await service.run(fixture);
    console.info('Native frame evidence', directory);
    for (const { sourceId, result } of manifest.results) {
      const rh = wasm.loadCaseResults[sourceId] ?? wasm.combinationResults[sourceId]!;
      expect(rh.diagnostics.executionBackend).toBe('AWATIF_CPP_WASM');
      expect(rh.equilibrium.isEquilibrated).toBe(true);
      let mm = 0, reactionN = 0, columnAxialN = 0;
      fixture.nodes.forEach((node, i) => {
        const native = result.jointDisplacements?.find(row => row.object === externalId('RH_N_', node.id));
        expect(native, node.id).toBeDefined();
        rh.displacements[i]!.translationM.forEach((v, k) => {
          mm = Math.max(mm, Math.abs(native!.translationMm[k]! - v * 1000 * (k === 1 ? -1 : 1)));
        });
      });
      rh.reactions.forEach(row => {
        const native = result.supportReactions?.find(r => r.object === externalId('RH_N_', fixture.nodes[row.nodeIndex]!.id));
        expect(native, row.nodeId).toBeDefined();
        for (let k = 0; k < 3; k++) {
          reactionN = Math.max(reactionN, Math.abs(native!.forceN[k]! - row.reactionKnM[k]! * 1000 * (k === 1 ? -1 : 1)));
        }
      });
      for (const col of fixture.columns) {
        const native = result.frameForces?.find(f => f.object === externalId('RH_F_', col.id) && f.objectStationMm === 0);
        const member = rh.memberForces.find(f => f.elementId === col.id)!;
        expect(native, col.id).toBeDefined();
        columnAxialN = Math.max(columnAxialN, Math.abs(native!.axialN - member.stations[0]!.axialTensionPositiveKn * 1000));
      }
      console.info(JSON.stringify({ sourceId, backend: rh.diagnostics.executionBackend, mm, reactionN, columnAxialN }));
      if (sourceId.endsWith('-LC0') || sourceId.endsWith('-LC1')) {
        gravityMaxN = Math.max(gravityMaxN, reactionN, columnAxialN);
        gravityMaxMm = Math.max(gravityMaxMm, mm);
      }
    }
  }
  // Nodal gravity on the symmetric frames is almost entirely axial. Numerical tolerance
  // accounts for the different solvers and output precision at the N/mm transport boundary.
  expect(gravityMaxN).toBeLessThanOrEqual(0.01);
  expect(gravityMaxMm).toBeLessThanOrEqual(1e-5);
}, 900_000);


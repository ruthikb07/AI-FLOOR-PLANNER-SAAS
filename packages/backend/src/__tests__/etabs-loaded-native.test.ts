import { it, expect } from 'vitest';
import path from 'node:path';
import { ETABSFixtureAnalysisService } from '../services/etabs-fixture-analysis';
import { loadedStructuralFixtures } from './fixtures/etabs-loaded-projects';

it.skipIf(process.env.RH_ETABS_NATIVE_TEST !== '1')('verifies concrete, rebar, loads, combinations, forces, reactions and displacements in two native fixtures', async () => {
  const root = path.resolve('output/etabs', 'loaded-native-' + Date.now());
  const service = new ETABSFixtureAnalysisService({ artifactRoot: root, bridgeExecutable: process.env.ETABS_BRIDGE_EXE!,
    installDirectory: process.env.ETABS_INSTALL_DIR!, allowVerificationFixtures: true });
  for (const project of loadedStructuralFixtures()) {
    const { directory, manifest } = await service.run(project);
    expect(manifest.results.length).toBe(5);
    expect(manifest.results.every(r => r.result.jointDisplacements?.length === project.nodes.length)).toBe(true);
    expect(manifest.results.some(r => r.result.jointDisplacements?.some(d => d.translationMm.some(v => Math.abs(v) > 1e-6)))).toBe(true);
    expect(manifest.designStatus).toBe('NOT_VERIFIED');
    console.info('Loaded native evidence:', directory);
  }
}, 900000);

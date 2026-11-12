import { it, expect } from 'vitest';
import { parseStructuralProjectForExport } from '@ai-floor-planner/core';
import { loadedStructuralFixtures } from './fixtures/etabs-loaded-projects';

it('accepts explicit fixture properties but never treats them as approved residential inputs', () => {
  for (const p of loadedStructuralFixtures()) {
    expect(parseStructuralProjectForExport(p, { allowVerificationFixtures: true })).toEqual(p);
    expect(() => parseStructuralProjectForExport(p)).toThrow(/Engineer-reviewed/);
  }
});
it.each([
  ['unknown node', (p: any) => p.loadCases[0].nodalLoads[0].nodeId = 'missing'],
  ['nonfinite force', (p: any) => p.loadCases[0].nodalLoads[0].forceN[0] = Infinity],
  ['duplicate weight', (p: any) => { p.loadCases[0].selfWeightMultiplier = 1; p.loadCases[1].selfWeightMultiplier = 1; }],
  ['missing combination case', (p: any) => p.loadCombinations[0].terms[0].loadCaseId = 'missing'],
  ['missing strength', (p: any) => delete p.materials[0].concrete.compressiveStrength],
  ['rebar as frame material', (p: any) => p.columns[0].materialId = p.materials[2].id],
])('rejects %s', (_, change) => {
  const p = loadedStructuralFixtures()[0]!; change(p);
  expect(() => parseStructuralProjectForExport(p, { allowVerificationFixtures: true })).toThrow();
});

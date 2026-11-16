import { structuralExportProjects } from './structural-export-projects';
import type { StructuralProject } from '@ai-floor-planner/core';

/** Illustrative API inputs, NOT Indian-code material/occupancy specifications or approved designs. */
export function loadedStructuralFixtures(): StructuralProject[] {
  return structuralExportProjects().map((p, index) => {
    p.materials[0]!.analysisModel = 'CONCRETE_EXPLICIT';
    p.materials[0]!.name = 'Illustrative concrete test material';
    p.materials[0]!.concrete = { compressiveStrength: 30 + index * 5, lightweight: false, lightweightFactor: 0,
      stressStrainType: 1, hysteresisType: 2, strainAtStrength: 0.002, ultimateStrain: 0.005,
      finalSlope: 0.1, frictionAngle: 0, dilatationalAngle: 0 };
    const rebar = { ...p.materials[1]!, id: p.id + '-rebar', name: 'Illustrative reinforcement test material',
      analysisModel: 'REBAR_EXPLICIT' as const, reinforcement: { yieldStrength: 500, ultimateStrength: 600,
        expectedYieldStrength: 550, expectedUltimateStrength: 660, stressStrainType: 1, hysteresisType: 1,
        hardeningStrain: 0.01, ultimateStrain: 0.09, finalSlope: 0.01 } };
    const top = p.nodes.filter(n => n.levelId === p.levels[p.levels.length - 1]!.id);
    const loadCases = (['DEAD','LIVE','WIND','QUAKE'] as const).map((patternType, i) => ({
      id: `${p.id}-LC${i}`, sourceArchitecturalRevisionId: p.sourceArchitecturalRevisionId,
      name: `TEST ${patternType}`, analysisType: 'LINEAR_STATIC' as const, patternType, selfWeightMultiplier: 0,
      nodalLoads: top.map(n => ({ nodeId: n.id,
        forceN: (i === 0 ? [0,0,-10000] : i === 1 ? [0,0,-5000] : i === 2 ? [1000,0,0] : [0,1500,0]) as [number,number,number],
        momentNmm: [0,0,0] as [number,number,number] })),
    }));
    return { ...p, materials: [...p.materials, rebar], loadCases,
      loadCombinations: [{ id: p.id + '-COMBO', sourceArchitecturalRevisionId: p.sourceArchitecturalRevisionId,
        name: 'TEST additive combination', method: 'LINEAR_ADDITIVE', terms: loadCases.map(c => ({ loadCaseId: c.id, factor: 1 })) }] };
  });
}

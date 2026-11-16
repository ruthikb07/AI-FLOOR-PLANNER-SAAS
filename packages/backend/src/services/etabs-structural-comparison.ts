import { createHash } from 'node:crypto';
import type { ETABSStructuralSnapshot, StructuralProject } from '@ai-floor-planner/core';

export const etabsNativeId = (kind: string, id: string) => 'RH_' + kind + '_' + createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 16).toUpperCase();

/** Compare independent native readback, not cached importer inputs. Tolerances are in canonical units. */
export function compareETABSStructuralModel(p: StructuralProject, s: ETABSStructuralSnapshot, externalProvenance?: Record<string, string>): string[] {
  const errors: string[] = [];
  // Preserve the raw snapshot. Externally bound metadata must never mask conflicting native metadata.
  if (externalProvenance) {
    for (const [key, value] of Object.entries(s.projectInfo))
      if (key.startsWith('RH_') && externalProvenance[key] !== value) errors.push('Conflicting embedded provenance: ' + key);
    s = { ...s, projectInfo: { ...s.projectInfo, ...externalProvenance } };
  }
  const equal = (a: unknown, b: unknown, label: string) => { if (a !== b) errors.push(label + ': expected ' + String(a) + ', received ' + String(b)); };
  const near = (a: number, b: number, label: string, tolerance = 0.001) => { if (!Number.isFinite(b) || Math.abs(a - b) > tolerance) errors.push(label + ': expected ' + a + ', received ' + b); };
  equal('N_mm_C', s.units, 'units');
  if (p.grid) {
    const g=p.grid, actual=s.grids?.find(x=>x.name===g.name);
    equal(1,s.grids?.length,'grid system count');
    if(!actual)errors.push('Missing reviewed structural grid');
    else {
      near(g.originXMm,actual.originXMm,'grid origin X');near(g.originYMm,actual.originYMm,'grid origin Y');near(g.rotationDeg,actual.rotationDeg,'grid rotation');
      equal('Cartesian',actual.type,'grid type');equal(g.xLineCount,actual.xMm.length,'X grid count');equal(g.yLineCount,actual.yMm.length,'Y grid count');
      for(let i=0;i<g.xLineCount;i++)near(i*g.spacingXMm,actual.xMm[i]!,'X grid ordinate '+i);
      for(let i=0;i<g.yLineCount;i++)near(i*g.spacingYMm,actual.yMm[i]!,'Y grid ordinate '+i);
    }
  }
  equal(p.id, s.projectInfo.RH_PROJECT_ID, 'project ID');
  equal(p.architecturalBuildingId, s.projectInfo.RH_ARCHITECTURAL_BUILDING_ID, 'building ID');
  equal(p.sourceArchitecturalRevisionId, s.projectInfo.RH_ARCHITECTURAL_REVISION, 'revision');
  equal(p.loadCases.length ? (p.exportReview!.status === 'API_VERIFICATION_FIXTURE' ? 'LOADED_FIXTURE_NO_DESIGN' : 'ANALYSIS_READY_NOT_ANALYZED') : 'MODEL_ONLY_NO_DESIGN', s.projectInfo.RH_EXPORT_SCOPE, 'scope');
  equal(p.exportReview!.status, s.projectInfo.RH_REVIEW_SCOPE, 'review scope');
  equal(p.exportReview!.reviewerId, s.projectInfo.RH_REVIEWER_ID, 'reviewer ID');
  equal(p.exportReview!.reviewedAt, s.projectInfo.RH_REVIEWED_AT, 'review date');
  const levels = [...p.levels].sort((a, b) => a.elevationMm - b.elevationMm);
  near(levels[0]!.elevationMm, s.baseElevationMm, 'base datum');
  // Base datum is reported separately by GetStories_2.
  const stories = s.storeys.filter(x => x.name !== 'Base');
  equal(levels.length - 1, stories.length, 'storey count');
  for (let i = 1; i < levels.length; i++) {
    const l = levels[i]!, found = stories.find(x => x.name === l.name);
    if (!found) { errors.push('Missing storey ' + l.name); continue; }
    near(l.elevationMm, found.elevationMm, 'storey elevation ' + l.id);
    near(l.elevationMm - levels[i - 1]!.elevationMm, found.heightMm, 'storey height ' + l.id);
  }
  equal(p.nodes.length, s.nodes.length, 'node count');
  equal(p.columns.length + p.beams.length, s.frames.length, 'frame count');
  equal(p.slabs.length, s.slabs.length, 'slab count'); equal(p.materials.length, s.materials.length, 'material count');
  equal(p.loadCases.length, s.loadCases.length, 'load case count');
  if (!p.loadCases.length) {
    equal('RH_MODEL_ONLY', s.loadPatterns.join(','), 'model-only placeholder pattern');
    near(0, s.loadPatternSelfWeight?.RH_MODEL_ONLY ?? NaN, 'placeholder self-weight', 0);
  } else {
    equal(p.loadCases.length, s.loadPatterns.length, 'pattern count');
    equal(p.loadCases.length, s.staticCases?.length, 'static case count');
    equal(p.loadCases.reduce((n, c) => n + c.nodalLoads.length, 0), s.nodalLoads?.length, 'nodal load count');
    for (const c of p.loadCases) {
      const name = etabsNativeId('LC', c.id);
      equal(true, s.loadCases.includes(name), 'case identity'); equal(true, s.loadPatterns.includes(name), 'pattern identity');
      equal({ DEAD: 'Dead', LIVE: 'Live', WIND: 'Wind', QUAKE: 'Quake', OTHER: 'Other' }[c.patternType], s.loadPatternTypes?.[name], 'pattern type');
      near(c.selfWeightMultiplier, s.loadPatternSelfWeight[name] ?? NaN, 'self weight', 1e-10);
      const actual = s.staticCases?.find(x => x.name === name);
      equal(JSON.stringify(['Load']), JSON.stringify(actual?.loadTypes), 'static load type');
      equal(JSON.stringify([name]), JSON.stringify(actual?.patterns), 'static pattern');
      equal(JSON.stringify([1]), JSON.stringify(actual?.factors), 'static scale');
      for (const l of c.nodalLoads) {
        const a = s.nodalLoads?.find(x => x.node === etabsNativeId('N', l.nodeId) && x.pattern === name);
        if (!a) { errors.push('Missing nodal load ' + l.nodeId); continue; }
        equal('Global', a.coordinateSystem, 'load coordinate system');
        for (let i = 0; i < 3; i++) { near(l.forceN[i]!, a.forceN[i]!, 'force', 0.001); near(l.momentNmm[i]!, a.momentNmm[i]!, 'moment', 0.001); }
      }
    }
  }
  if (p.loadCombinations.length || s.combinations?.length) {
    equal(p.loadCombinations.length, s.combinations?.length, 'combination count');
    for (const c of p.loadCombinations) {
      const a = s.combinations?.find(x => x.name === etabsNativeId('CO', c.id));
      if (!a) { errors.push('Missing combination ' + c.id); continue; }
      equal(0, a.method, 'linear additive combination'); equal(c.terms.length, a.cases.length, 'combination term count');
      for (const term of c.terms) { const i = a.cases.indexOf(etabsNativeId('LC', term.loadCaseId)); equal('LoadCase', a.caseTypes[i], 'combination case type'); near(term.factor, a.factors[i]!, 'combination factor', 1e-10); }
    }
  }
  const expectedSourceKeys = new Set<string>();
  function source(kind: string, id: string) { const key = 'RH_SOURCE_' + etabsNativeId(kind, id); expectedSourceKeys.add(key); equal(id, s.projectInfo[key], 'source ID ' + id); }
  for (const l of levels) source('L', l.id);
  for (const n of p.nodes) {
    source('N', n.id); const a = s.nodes.find(x => x.name === etabsNativeId('N', n.id));
    if (!a) { errors.push('Missing node ' + n.id); continue; }
    near(n.xMm, a.xMm, 'node X ' + n.id); near(n.yMm, a.yMm, 'node Y ' + n.id); near(n.zMm, a.zMm, 'node Z ' + n.id);
    equal(JSON.stringify(n.restraints), JSON.stringify(a.restraints), 'restraints ' + n.id);
  }
  for (const f of [...p.columns, ...p.beams]) {
    source('F', f.id); const a = s.frames.find(x => x.name === etabsNativeId('F', f.id));
    if (!a) { errors.push('Missing member ' + f.id); continue; }
    equal(f.kind, s.projectInfo['RH_KIND_' + a.name], 'member role ' + f.id);
    equal(etabsNativeId('N', f.startNodeId), a.startNode, 'start node ' + f.id); equal(etabsNativeId('N', f.endNodeId), a.endNode, 'end node ' + f.id);
    equal(etabsNativeId('S', f.id), a.section, 'section ' + f.id); equal(etabsNativeId('M', f.materialId), a.material, 'material ' + f.id);
    near(f.section.widthMm, a.widthMm, 'width '+f.id); near(f.section.depthMm, a.depthMm, 'depth ' + f.id);
    near(0, ((a.angleDeg - f.localAxisAngleDeg + 540) % 360) - 180, 'local axes ' + f.id, 1e-6);
  }
  for (const slab of p.slabs) {
    source('A', slab.id); const a = s.slabs.find(x => x.name === etabsNativeId('A', slab.id));
    if (!a) { errors.push('Missing slab ' + slab.id); continue; }
    const expected = slab.boundaryNodeIds.map(id => etabsNativeId('N', id));
    // Native vertex start index may rotate; reversal is acceptable for this symmetric isotropic horizontal slab.
    const cyclic = (v: string[]) => v.some((_, i) => expected.every((x, j) => x === v[(i + j) % v.length]));
    if (a.nodeNames.length !== expected.length || (!cyclic(a.nodeNames) && !cyclic([...a.nodeNames].reverse()))) errors.push('Slab connectivity ' + slab.id);
    equal(etabsNativeId('P', slab.id), a.section, 'slab section'); equal(etabsNativeId('M', slab.materialId), a.material, 'slab material');
    near(slab.thicknessMm, a.thicknessMm, 'slab thickness');
    equal({ SHELL_THIN: 'ShellThin', SHELL_THICK: 'ShellThick', MEMBRANE: 'Membrane' }[slab.formulation], a.shellType, 'shell formulation');
  }
  for (const m of p.materials) {
    source('M', m.id); const a = s.materials.find(x => x.name === etabsNativeId('M', m.id));
    if (!a) { errors.push('Missing material ' + m.id); continue; }
    equal(m.analysisModel === 'CONCRETE_EXPLICIT' ? 'Concrete' : m.analysisModel === 'REBAR_EXPLICIT' ? 'Rebar' : 'NoDesign', a.designType, 'material design type');
    for (const key of ['concrete', 'reinforcement'] as const) if (m[key]) {
      for (const [property, value] of Object.entries(m[key]!)) {
        if (key === 'concrete' && property === 'lightweightFactor' && !m.concrete?.lightweight) continue;
        const actual = (a[key] as unknown as Record<string, unknown> | undefined)?.[property];
        if (typeof value === 'number') near(value, actual as number, 'material ' + property, Math.max(1e-10, Math.abs(value) * 1e-9));
        else equal(value, actual, 'material ' + property);
      }
    }
    near(m.elasticModulusNPerMm2, a.elasticModulusNPerMm2, 'elastic modulus', Math.max(1e-6, m.elasticModulusNPerMm2 * 1e-9));
    near(m.poissonRatio, a.poissonRatio, 'Poisson ratio', 1e-9);
    near(m.thermalExpansionPerC, a.thermalExpansionPerC, 'thermal coefficient', 1e-12);
    near(m.massDensityKgPerM3, a.massDensityKgPerM3, 'mass density kg/m3', 1e-6);
  }
  for (const k of Object.keys(s.projectInfo).filter(k => k.startsWith('RH_SOURCE_'))) if (!expectedSourceKeys.has(k)) errors.push('Unexpected prior-model source ID ' + k);
  return errors;
}

import type { StructuralProject } from '../types/structural-analysis';

export class StructuralExportValidationError extends Error {
  readonly code = 'INVALID_STRUCTURAL_PROJECT';
}
function fail(message: string): never { throw new StructuralExportValidationError(message); }
function keys(e:Record<string,unknown>, allowed:string[], label:string) {
  for(const key of Object.keys(e)) if(!allowed.includes(key)) fail('Unsupported '+label+' field: '+key);
}
function record(v: unknown, label: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(label + ' must be an object');
  return v as Record<string, unknown>;
}
function text(v: unknown, label: string): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_. -]{0,95}$/.test(v)) fail(label + ' must be a nonempty safe identifier (96 characters maximum)');
  return v;
}
function number(v: unknown, label: string, min = -1e8, max = 1e8): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(label + ' is missing or out of range');
  return v;
}
function list(v: unknown, label: string, min: number, max: number): unknown[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) fail(label + ' has an unsupported item count');
  return v;
}
/** Stable review payload excludes only the attestation itself. */
export function structuralProjectReviewJson(project: StructuralProject): string {
  function ordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, entry]) => [key, ordered(entry)]));
    return value;
  }
  const { exportReview: _attestation, ...inputs } = project;
  return JSON.stringify(ordered(inputs));
}
/** Runtime export schema. No architectural-to-structural inference, defaults or review fabrication. */
export function parseStructuralProjectForExport(input: unknown, options: { allowVerificationFixtures?: boolean } = {}): StructuralProject {
  const p = record(input, 'project');
  keys(p,['id','sourceArchitecturalRevisionId','schemaVersion','architecturalBuildingId','units','reviewStatus','exportReview','engineeringInputs','grid','levels','nodes','materials','columns','beams','slabs','loadCases','loadCombinations'],'project');
  if (p.schemaVersion !== 1) fail('schemaVersion must be 1');
  text(p.id, 'project.id'); text(p.architecturalBuildingId, 'architecturalBuildingId');
  const revision = text(p.sourceArchitecturalRevisionId, 'sourceArchitecturalRevisionId');
  if (p.grid !== undefined) {
    const g=record(p.grid,'grid');keys(g,['name','originXMm','originYMm','rotationDeg','xLineCount','yLineCount','spacingXMm','spacingYMm'],'grid');
    text(g.name,'grid name');number(g.originXMm,'grid origin X');number(g.originYMm,'grid origin Y');number(g.rotationDeg,'grid rotation',-360,360);
    for(const key of ['xLineCount','yLineCount'])if(!Number.isInteger(g[key])||number(g[key],key,2,100)<2)fail('Grid line counts must be integers');
    number(g.spacingXMm,'grid spacing X',1,1e6);number(g.spacingYMm,'grid spacing Y',1,1e6);
  }
  const units = record(p.units, 'units');
  keys(units,['length','force','temperature','mass'],'units');
  if (units.length !== 'mm' || units.force !== 'N' || units.temperature !== 'C' || units.mass !== 'kg') fail('Explicit mm/N/C/kg units required');
  const review = record(p.exportReview, 'exportReview');
  keys(review,['status','reviewerId','reviewedAt','inputSha256'],'exportReview');
  const fixture = options.allowVerificationFixtures === true && review.status === 'API_VERIFICATION_FIXTURE';
  if (!fixture && (review.status !== 'ENGINEER_REVIEWED' || !['ENGINEER_REVIEWED_MODEL_ONLY','ENGINEER_APPROVED_FOR_ANALYSIS'].includes(String(p.reviewStatus))))
    fail('Engineer-reviewed explicit structural input is required; architectural/provisional members are not exportable');
  text(review.reviewerId, 'exportReview.reviewerId');
  if (!fixture && (typeof review.inputSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(review.inputSha256))) fail('ENGINEERING_INPUTS_REQUIRED: current input SHA-256 review binding is required');
  if (typeof review.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(review.reviewedAt) || !Number.isFinite(Date.parse(review.reviewedAt))) fail('exportReview.reviewedAt must be an ISO timestamp');
  const ids = new Set<string>();
  function entities(key: string, min: number, max: number) {
    return list(p[key], key, min, max).map((v, i) => {
      const e = record(v, key + '[' + i + ']'), id = text(e.id, key + '.id');
      if (ids.has(id.toLowerCase())) fail('Duplicate ID: ' + id);
      ids.add(id.toLowerCase());
      if (e.sourceArchitecturalRevisionId !== revision) fail('Stale source revision on ' + id);
      return e;
    });
  }
  const levels = entities('levels', 2, 64), nodes = entities('nodes', 2, 500);
  const materials = entities('materials', 1, 128), columns = entities('columns', 1, 1000), beams = entities('beams', 0, 1000), slabs = entities('slabs', 0, 200);
  const levelMap = new Map(levels.map(e => [e.id, e])), nodeMap = new Map(nodes.map(e => [e.id, e]));
  const materialIds = new Set(materials.map(e => e.id));
  const names = new Set<string>(), elevations = new Set<number>();
  for (const l of levels) {
    keys(l,['id','sourceArchitecturalRevisionId','name','elevationMm'],'level');
    const name = text(l.name, 'level.name'), z = number(l.elevationMm, 'level.elevationMm');
    if (names.has(name.toLowerCase()) || elevations.has(z)) fail('Duplicate storey name/elevation');
    names.add(name.toLowerCase()); elevations.add(z);
  }
  const sorted = [...levels].sort((a, b) => Number(a.elevationMm) - Number(b.elevationMm));
  if (sorted[0]!.name !== 'Base') fail('Lowest level must be named Base (native ETABS base datum)');
  for (let i = 1; i < sorted.length; i++) if (Number(sorted[i]!.elevationMm) - Number(sorted[i-1]!.elevationMm) < 1) fail('Storeys must be separated by at least 1 mm');
  for (const n of nodes) {
    keys(n,['id','sourceArchitecturalRevisionId','levelId','xMm','yMm','zMm','restraints'],'node');
    number(n.xMm, 'node.xMm'); number(n.yMm, 'node.yMm'); number(n.zMm, 'node.zMm');
    if (!levelMap.has(n.levelId) || Math.abs(Number(levelMap.get(n.levelId)!.elevationMm) - Number(n.zMm)) > 1e-6) fail('Node must lie on its referenced storey: ' + n.id);
    if (!Array.isArray(n.restraints) || n.restraints.length !== 6 || !n.restraints.every(v => typeof v === 'boolean')) fail('Six explicit support DOFs required: ' + n.id);
  }
  for (const m of materials) {
    keys(m,['id','sourceArchitecturalRevisionId','name','analysisModel','elasticModulusNPerMm2','poissonRatio','massDensityKgPerM3','thermalExpansionPerC','provenance','concrete','reinforcement'],'material');
    text(m.name, 'material.name');
    if (!['ISOTROPIC_NO_DESIGN','CONCRETE_EXPLICIT','REBAR_EXPLICIT'].includes(String(m.analysisModel))) fail('Explicit supported material model required');
    if(m.analysisModel==='CONCRETE_EXPLICIT') {
      const c=record(m.concrete,'concrete');
      keys(c,['compressiveStrength','lightweight','lightweightFactor','stressStrainType','hysteresisType','strainAtStrength','ultimateStrain','finalSlope','frictionAngle','dilatationalAngle'],'concrete');
      for(const key of ['compressiveStrength','strainAtStrength','ultimateStrain'])number(c[key],key,1e-12,1e6);
      number(c.lightweightFactor,'lightweightFactor',0,1);
      if(c.lightweight===false&&c.lightweightFactor!==0)fail('Normal-weight fixture concrete requires inactive lightweightFactor=0 for native readback');
      if(c.lightweight===true&&c.lightweightFactor===0)fail('Lightweight concrete requires an explicit positive factor');
      for(const key of ['stressStrainType','hysteresisType'])if(!Number.isInteger(c[key])||number(c[key],key,0,10)<0)fail('Invalid material model');
      for(const key of ['finalSlope','frictionAngle','dilatationalAngle'])number(c[key],key,0,90);
      if(typeof c.lightweight!=='boolean'||Number(c.ultimateStrain)<Number(c.strainAtStrength))fail('Invalid concrete strain/lightweight properties');
      if(m.reinforcement!==undefined)fail('Concrete cannot carry rebar properties');
    } else if(m.analysisModel==='REBAR_EXPLICIT') {
      const c=record(m.reinforcement,'reinforcement');
      keys(c,['yieldStrength','ultimateStrength','expectedYieldStrength','expectedUltimateStrength','stressStrainType','hysteresisType','hardeningStrain','ultimateStrain','finalSlope'],'reinforcement');
      for(const key of ['yieldStrength','ultimateStrength','expectedYieldStrength','expectedUltimateStrength','hardeningStrain','ultimateStrain'])number(c[key],key,1e-12,1e6);
      for(const key of ['stressStrainType','hysteresisType'])if(!Number.isInteger(c[key])||number(c[key],key,0,10)<0)fail('Invalid rebar model');
      number(c.finalSlope,'finalSlope',0,1);
      if(Number(c.ultimateStrength)<Number(c.yieldStrength)||Number(c.expectedUltimateStrength)<Number(c.expectedYieldStrength)||Number(c.ultimateStrain)<Number(c.hardeningStrain)||m.concrete!==undefined)fail('Inconsistent rebar properties');
    } else if(m.concrete!==undefined||m.reinforcement!==undefined)fail('Unexpected design material properties');
    if (m.provenance !== (fixture ? 'API_VERIFICATION_FIXTURE' : 'ENGINEER_INPUT')) fail('Material provenance does not match project review scope');
    number(m.elasticModulusNPerMm2, 'material.E', 1e-9, 1e9);
    number(m.poissonRatio, 'material.poissonRatio', -0.999, 0.4999);
    number(m.massDensityKgPerM3, 'material.massDensityKgPerM3', 1e-9, 1e6);
    number(m.thermalExpansionPerC, 'material.thermalExpansionPerC', -1, 1);
  }
  const edges = new Set<string>();
  for (const [members, kind] of [[columns, 'COLUMN'], [beams, 'BEAM']] as const) for (const f of members) {
    keys(f,['id','sourceArchitecturalRevisionId','kind','startNodeId','endNodeId','materialId','section','localAxisAngleDeg'],'member');
    if (f.kind !== kind || !nodeMap.has(f.startNodeId) || !nodeMap.has(f.endNodeId) || f.startNodeId === f.endNodeId) fail('Invalid member connectivity: ' + f.id);
    const key = [String(f.startNodeId), String(f.endNodeId)].sort().join('|');
    if (edges.has(key)) fail('Duplicate member connectivity: ' + f.id);
    edges.add(key);
    if (!materialIds.has(f.materialId)) fail('Missing member material: ' + f.id);
    if(materials.find(m=>m.id===f.materialId)?.analysisModel==='REBAR_EXPLICIT')fail('Reinforcement cannot be a frame section material');
    const section = record(f.section, 'member.section');
    keys(section,['kind','widthMm','depthMm'],'section');
    if (section.kind !== 'RECTANGLE') fail('Only explicit rectangular sections are supported');
    number(section.widthMm, 'section.widthMm', 0.1, 100000); number(section.depthMm, 'section.depthMm', 0.1, 100000);
    number(f.localAxisAngleDeg, 'member.localAxisAngleDeg', -360, 360);
  }
  for (const s of slabs) {
    keys(s,['id','sourceArchitecturalRevisionId','levelId','boundaryNodeIds','openingNodeIds','materialId','thicknessMm','formulation'],'slab');
    if (!levelMap.has(s.levelId) || !materialIds.has(s.materialId)) fail('Invalid slab storey/material');
    const boundary = list(s.boundaryNodeIds, 'slab.boundaryNodeIds', 3, 4);
    if (new Set(boundary).size !== boundary.length || boundary.some(id => !nodeMap.has(id) || nodeMap.get(id)!.levelId !== s.levelId)) fail('Slab nodes must be distinct and on its storey');
    if (list(s.openingNodeIds, 'slab.openingNodeIds', 0, 200).length) fail('Slab openings are not supported in this milestone');
    number(s.thicknessMm, 'slab.thicknessMm', 0.1, 10000);
    if (!['SHELL_THIN', 'SHELL_THICK', 'MEMBRANE'].includes(String(s.formulation))) fail('Unsupported slab formulation');
  }
  const cases = entities('loadCases', 0, 64), combinations = entities('loadCombinations', 0, 64);
  if (!fixture && (cases.length || combinations.length)) {
    if(p.reviewStatus!=='ENGINEER_APPROVED_FOR_ANALYSIS')fail('ENGINEERING_INPUTS_REQUIRED: model-only review does not authorize load transfer');
    if (!cases.length || !combinations.length) fail('ENGINEERING_INPUTS_REQUIRED: analysis-ready export requires load cases and combinations');
    const e = record(p.engineeringInputs, 'ENGINEERING_INPUTS_REQUIRED: engineeringInputs');
    keys(e,['geometryReviewReference','materialReviewReference','supportReviewReference','deadLive','wind','seismic','foundation','standards'],'engineeringInputs');
    const reference = (v: unknown, label: string) => { if (typeof v !== 'string' || !v.trim() || v.length > 2000) fail('ENGINEERING_INPUTS_REQUIRED: ' + label); };
    for (const key of ['geometryReviewReference','materialReviewReference','supportReviewReference']) reference(e[key],key);
    const d=record(e.deadLive,'deadLive'); keys(d,['occupancyCategories','loadSourceReference','selfWeightReviewed'],'deadLive');
    for (const value of list(d.occupancyCategories,'occupancyCategories',1,64)) reference(value,'occupancy category');
    reference(d.loadSourceReference,'load source'); if(d.selfWeightReviewed!==true)fail('ENGINEERING_INPUTS_REQUIRED: self-weight review');
    const f=record(e.foundation,'foundation');keys(f,['geotechnicalReportReference','supportAssumptions','allowableBearingPressureKPa'],'foundation');
    reference(f.geotechnicalReportReference,'geotechnical report'); reference(f.supportAssumptions,'support assumptions'); number(f.allowableBearingPressureKPa,'bearing pressure kPa',0.001,1e7);
    for(const [domain,pattern,parameters] of [['wind','WIND',['basicWindSpeedMPerS','terrainCategory']],['seismic','QUAKE',['zoneFactor','soilClass','importanceFactor','responseReductionFactor']]] as const) {
      const v=record(e[domain],domain);keys(v,['applicability','basisReference',...parameters],domain);reference(v.basisReference,domain+' basis');
      if(!['INCLUDED_AS_REVIEWED_NODAL_LOADS','NOT_APPLICABLE'].includes(String(v.applicability)))fail('ENGINEERING_INPUTS_REQUIRED: '+domain+' applicability');
      const included=v.applicability==='INCLUDED_AS_REVIEWED_NODAL_LOADS';
      if(included!==cases.some(c=>c.patternType===pattern))fail('Reviewed '+domain+' applicability conflicts with supplied load patterns');
      for(const parameter of parameters) {
        if(included) { if(parameter==='terrainCategory'||parameter==='soilClass')reference(v[parameter],parameter);else number(v[parameter],parameter,0.000001,1000); }
        else if(v[parameter]!==undefined)fail('Nonapplicable '+domain+' must not contain assumed parameters');
      }
    }
    for(const value of list(e.standards,'standards',1,64)) { const s=record(value,'standard');keys(s,['standard','edition','sourceReference'],'standard');for(const key of ['standard','edition','sourceReference'])reference(s[key],key); }
  }
  const caseIds = new Set(cases.map(c => c.id));
  const loadNames = new Set<string>();
  let selfWeightCount = 0;
  for (const c of cases) {
    keys(c,['id','sourceArchitecturalRevisionId','name','analysisType','patternType','selfWeightMultiplier','nodalLoads'],'load case');
    const name = text(c.name, 'load case name').toLowerCase();
    if (loadNames.has(name)) fail('Duplicate load name'); loadNames.add(name);
    if (c.analysisType !== 'LINEAR_STATIC' || !['DEAD','LIVE','WIND','QUAKE','OTHER'].includes(String(c.patternType))) fail('Unsupported analysis/pattern type');
    if (number(c.selfWeightMultiplier, 'self weight', 0, 1) !== 0) selfWeightCount++;
    const loaded = new Set<string>();
    for (const raw of list(c.nodalLoads,'nodal loads',0,500)) {
      const load = record(raw,'nodal load'); keys(load,['nodeId','forceN','momentNmm'],'nodal load');
      if (!nodeMap.has(load.nodeId) || loaded.has(String(load.nodeId))) fail('Invalid or duplicate loaded node');
      loaded.add(String(load.nodeId));
      for (const key of ['forceN','momentNmm']) for (const v of list(load[key],key,3,3)) number(v,key,-1e12,1e12);
    }
  }
  if (selfWeightCount > 1) fail('Duplicate structural self-weight patterns');
  for (const c of combinations) {
    keys(c,['id','sourceArchitecturalRevisionId','name','method','terms'],'combination');
    const name = text(c.name,'combination name').toLowerCase();
    if (loadNames.has(name)) fail('Duplicate load name'); loadNames.add(name);
    if(c.method !== 'LINEAR_ADDITIVE') fail('Unsupported combination method');
    const used = new Set<string>();
    for(const raw of list(c.terms,'combination terms',1,64)) {
      const term=record(raw,'term'); keys(term,['loadCaseId','factor'],'term');
      if(!caseIds.has(term.loadCaseId)||used.has(String(term.loadCaseId))) fail('Invalid combination case');
      used.add(String(term.loadCaseId)); number(term.factor,'combination factor',-100,100);
    }
  }
  return JSON.parse(JSON.stringify(p)) as StructuralProject;
}

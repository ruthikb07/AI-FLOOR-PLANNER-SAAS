import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parseStructuralProjectForExport, structuralProjectReviewJson, type StructuralProject } from '@ai-floor-planner/core';
import { loadedStructuralFixtures } from './fixtures/etabs-loaded-projects';
import { ETABSStructuralExportService } from '../services/etabs-structural-export';
import { IndianCodeLoadingService } from '../services/indian-code-loading';
import { ETABSDesignCheckEngine } from '../services/etabs-design-checks';
import { verifyStructuralArtifact } from '../services/artifact-verifier';

// Boundary test data only. These labels do not represent a professional approval.
function mockReviewedInput(): StructuralProject {
  const p=loadedStructuralFixtures()[0]!;
  p.reviewStatus='ENGINEER_APPROVED_FOR_ANALYSIS';
  p.exportReview={status:'ENGINEER_REVIEWED',reviewerId:'MOCK_NOT_A_REAL_APPROVAL',reviewedAt:'2026-01-01T00:00:00Z'};
  p.materials.forEach(m=>{m.provenance='ENGINEER_INPUT';});
  p.engineeringInputs={geometryReviewReference:'MOCK geometry',materialReviewReference:'MOCK material',supportReviewReference:'MOCK support',
    deadLive:{occupancyCategories:['SOFTWARE_TEST_ONLY'],loadSourceReference:'MOCK loads',selfWeightReviewed:true},
    wind:{applicability:'INCLUDED_AS_REVIEWED_NODAL_LOADS',basisReference:'MOCK wind',basicWindSpeedMPerS:42,terrainCategory:'MOCK category'},
    seismic:{applicability:'INCLUDED_AS_REVIEWED_NODAL_LOADS',basisReference:'MOCK seismic',zoneFactor:0.1,soilClass:'MOCK soil',importanceFactor:1,responseReductionFactor:1},
    foundation:{geotechnicalReportReference:'MOCK report',supportAssumptions:'MOCK fixed nodes',allowableBearingPressureKPa:100},
    standards:[{standard:'MOCK STANDARD',edition:'TEST ONLY',sourceReference:'NOT A DESIGN STANDARD'}]};
  p.exportReview.inputSha256=createHash('sha256').update(structuralProjectReviewJson(p)).digest('hex');
  return p;
}
it('accepts fully explicit static input at the schema boundary without inferring material or site values',()=>{
  const p=mockReviewedInput();expect(parseStructuralProjectForExport(p)).toEqual(p);
});
it.each(['deadLive','wind','seismic','foundation','standards','geometryReviewReference','materialReviewReference','supportReviewReference'])('blocks a missing %s review domain',key=>{
  const p=mockReviewedInput();delete (p.engineeringInputs as any)[key];expect(()=>parseStructuralProjectForExport(p)).toThrow();
});
it('does not accept an approval ID in place of reviewed input values',()=>{
  expect(()=>new IndianCodeLoadingService().createLoadingConfig({} as any,{engineerApprovalId:'anything'})).toThrow(/ENGINEERING|Explicit reviewed/);
});
it('does not manufacture design capacity from architecture or supplied PASS labels',()=>{
  expect(()=>new ETABSDesignCheckEngine().verifyStructuralDesign({} as any,{} as any,{runId:'fake',modelSha256:'a'.repeat(64)})).toThrow(/NOT_VERIFIED/);
});
it('rejects changed input before creating any native process or artifact directory',async()=>{
  const p=mockReviewedInput();p.materials[0]!.elasticModulusNPerMm2+=1;
  const service=new ETABSStructuralExportService({artifactRoot:'NEVER_CREATED',bridgeExecutable:'NEVER_STARTED',installDirectory:'NEVER_USED',
    connectorFactory:()=>{throw new Error('Native process must not start');}});
  await expect(service.exportStructuralProjectToETABS(p)).rejects.toThrow(/changed after review/);
});
it('rejects mislabeled synthetic reports even when readable JSON has PASS and native-looking identifiers',async()=>{
  const result=await verifyStructuralArtifact(Buffer.from(JSON.stringify({projectId:'p',buildingId:'b',gridLines:[],columns:[],runId:'fake',modelSha256:'a'.repeat(64),summary:{overallStatus:'PASS'}})),'json');
  expect(result.isValid).toBe(false);
});

import { createHash } from 'node:crypto';
import type { Building, ResidentialStructuralReviewTemplate, EngineeringReviewDomain } from '@ai-floor-planner/core';
import { canonicalRevisionHash } from './geometry-report.js';

const domains: EngineeringReviewDomain[] = ['geometryAndSections','materials','deadAndLiveLoads','windAndSeismic','supportsAndFoundations','standards'];
export function createResidentialStructuralReviewTemplate(building: Building): ResidentialStructuralReviewTemplate {
  return { schemaVersion: 1, status: 'ENGINEERING_INPUTS_REQUIRED',
    source: { buildingId: building.id, architecturalRevision: building.version, architecturalSha256: canonicalRevisionHash(building) },
    architecturalReference: building.floors.map(f => ({ floorId: f.id, name: f.name, level: f.level,
      floorHeightMm: f.floorHeight, boundary: f.boundary.points.map(p => ({ ...p })),
      provisionalColumnReferences: (f.columns ?? []).map(c => ({ sourceId: c.id, xMm: c.position.x, yMm: c.position.y })) })),
    structuralProject: null, proposals: { grids: [], columns: [], beams: [], slabs: [], supports: [] },
    unapprovedMaterialCandidates: { concrete: ['M20','M25','M30','M35','M40'], reinforcement: ['Fe415','Fe500','Fe500D','Fe550D'], status: 'UNAPPROVED_CANDIDATES' },
    inputs: { geometryAndSections: null, materials: null, deadAndLiveLoads: null, windAndSeismic: null, supportsAndFoundations: null, standards: null },
    reviews: {}, missingInputChecklist: [
      'Engineer-selected continuous framing, grid coordinates, slab support layout and preliminary section dimensions',
      'Clash review for openings, stairs, lifts, circulation and parking; explicit transfer systems where needed',
      'Material strengths, stiffness, density, constitutive properties, exposure and source references',
      'Occupancy-specific dead/live loads, units, assignment locations, self-weight accounting and combinations',
      'Site-specific wind and seismic inputs, applicability, mass source and analysis method',
      'Geotechnical report, support assumptions and foundation interface; no assumed bearing pressure',
      'Applicable IS editions, amendments, clauses, authorized texts and ETABS support/external checks',
      'Reviewer identity, timestamp and source reference for every domain, bound to the current input hash',
    ] };
}
export function engineeringInputHash(template: ResidentialStructuralReviewTemplate): string {
  return createHash('sha256').update(JSON.stringify({ source: template.source, structuralProject: template.structuralProject,
    proposals: template.proposals, inputs: template.inputs })).digest('hex');
}
/** Review completeness only. Does not certify code compliance or authorize unsupported native features. */
export function assessEngineeringReview(template: ResidentialStructuralReviewTemplate, currentBuilding: Building) {
  const missing: string[] = [];
  if (template.source.buildingId !== currentBuilding.id || template.source.architecturalRevision !== currentBuilding.version
    || template.source.architecturalSha256 !== canonicalRevisionHash(currentBuilding)) missing.push('STALE_ARCHITECTURAL_REVISION');
  if (!template.structuralProject) missing.push('REVIEWED_STRUCTURAL_PROJECT');
  const hash = engineeringInputHash(template);
  for (const domain of domains) {
    const value = template.inputs[domain], review = template.reviews[domain];
    if (!value || typeof value !== 'object' || Object.keys(value).length === 0) missing.push(domain + ':INPUT_REQUIRED');
    if (!review || review.inputHash !== hash || !review.reviewerId.trim() || !review.sourceReference.trim()
      || !Number.isFinite(Date.parse(review.reviewedAt))) missing.push(domain + ':REVIEW_REQUIRED');
  }
  return { status: missing.length ? 'ENGINEERING_INPUTS_REQUIRED' : 'ENGINEERING_INPUTS_REVIEWED', inputHash: hash,
    missing, designStatus: 'NOT_VERIFIED', analysisStatus: 'NOT_ANALYZED', constructionApproval: 'NOT_PROVIDED' } as const;
}

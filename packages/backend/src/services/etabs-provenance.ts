import { createHash } from 'node:crypto';
import type { StructuralProject } from '@ai-floor-planner/core';
import { etabsNativeId } from './etabs-structural-comparison.js';
import { ExportError } from './export-selection.js';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** External provenance only: never represented as metadata read from ETABS. */
export function createETABSSidecar(project: StructuralProject, edb: Uint8Array, source: Uint8Array) {
  return { schemaVersion: 1, storage: 'HASH_BOUND_SIDECAR' as const,
    edbSha256: hash(edb), sourceSha256: hash(source), projectId: project.id,
    sourceArchitecturalRevisionId: project.sourceArchitecturalRevisionId };
}

export function verifyETABSSidecar(value: unknown, project: StructuralProject, edb: Uint8Array, source: Uint8Array): Record<string, string> {
  const expected = createETABSSidecar(project, edb, source);
  if (!value || typeof value !== 'object' || Object.entries(expected).some(([key, v]) => (value as Record<string, unknown>)[key] !== v)
    || JSON.stringify(JSON.parse(Buffer.from(source).toString('utf8'))) !== JSON.stringify(project))
    throw new ExportError('PROVENANCE_MISMATCH', 'EDB/source bytes do not match the external provenance sidecar.', 409);
  const info: Record<string, string> = { RH_PROJECT_ID: project.id, RH_ARCHITECTURAL_BUILDING_ID: project.architecturalBuildingId,
    RH_ARCHITECTURAL_REVISION: project.sourceArchitecturalRevisionId, RH_EXPORT_SCOPE: project.loadCases.length ? (project.exportReview!.status === 'API_VERIFICATION_FIXTURE' ? 'LOADED_FIXTURE_NO_DESIGN' : 'ANALYSIS_READY_NOT_ANALYZED') : 'MODEL_ONLY_NO_DESIGN',
    RH_REVIEW_SCOPE: project.exportReview!.status, RH_REVIEWER_ID: project.exportReview!.reviewerId, RH_REVIEWED_AT: project.exportReview!.reviewedAt };
  for (const [kind, entities] of [['L', project.levels], ['N', project.nodes], ['M', project.materials],
    ['F', [...project.columns, ...project.beams]], ['A', project.slabs]] as const)
    for (const entity of entities) info['RH_SOURCE_' + etabsNativeId(kind, entity.id)] = entity.id;
  for (const member of [...project.columns, ...project.beams]) info['RH_KIND_' + etabsNativeId('F', member.id)] = member.kind;
  return info;
}

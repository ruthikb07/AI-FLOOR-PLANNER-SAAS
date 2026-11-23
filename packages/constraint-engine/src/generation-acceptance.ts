import { validateBuildingSchema, type Building, type GeometryValidationReport } from '@ai-floor-planner/core';

export interface GenerationBlockingFinding {
  readonly code: string;
  readonly message: string;
}

export function generationBlockingFindings(
  building: Building,
  report?: GeometryValidationReport,
): readonly GenerationBlockingFinding[] {
  const schemaError = validateBuildingSchema(building)[0];
  if (schemaError || !building.metadata || !building.floors.length) {
    return [{ code: 'INVALID_BUILDING', message: schemaError
      ? `${schemaError.path}: ${schemaError.message}`
      : 'The generated building is missing metadata or physical floors.' }];
  }
  if (!report || !Array.isArray(report.errors) || !Number.isFinite(report.planarDeltaMm2)) {
    return [{ code: 'MISSING_GEOMETRY_AUDIT', message: 'The generated plan is missing a complete geometry audit.' }];
  }

  const findings: GenerationBlockingFinding[] = report.errors
    .filter(issue => issue?.severity === 'CRITICAL' && !issue.autoCorrected)
    .map(issue => ({ code: issue.code, message: issue.description }));
  const generationReport = building.metadata.generationReport;
  for (const issue of generationReport?.violations ?? []) {
    if (issue.severity === 'CRITICAL' && (['GEOMETRY', 'CLOSURE', 'OPENING'].includes(issue.source) || ['AREA_TARGET_UNMET', 'MANDATORY_BRIEF_UNMET'].includes(issue.code))) {
      findings.push({ code: issue.code, message: issue.description });
    }
  }
  if (report.isValid !== true && findings.length === 0) {
    findings.push({ code: 'GEOMETRY_NOT_VALID', message: 'The geometry audit did not pass.' });
  }
  return [...new Map(findings.map(finding => [`${finding.code}:${finding.message}`, finding])).values()];
}

export function requireAcceptedGeneration(result: { building: Building; validationReport?: GeometryValidationReport }): void {
  const first = generationBlockingFindings(result.building, result.validationReport)[0];
  if (first) throw new Error(`Required design checks failed. ${first.message} Try a different massing or adjust the brief.`);
}

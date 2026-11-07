import type { BuildingBudgetIntent, BudgetAssessment, BudgetIssue, ReviewedIntentContext } from '../types/building-budget';
import { calculateProgramCapacity, validateSpaceProgram } from './space-program';
import { calculateSiteMetrics } from './site-intelligence';

/** Deterministic content fingerprint; not a security/authentication primitive. */
export function intentSignature(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k, x]) => k !== 'updatedAt' && x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  const text = JSON.stringify(canonical(value));
  let a = 2166136261; let b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}
export function budgetSignature(budget: BuildingBudgetIntent): string {
  const { approvalState: _state, dependencySignature: _dependency, approvedBudgetSignature: _signature, ...intent } = budget;
  return intentSignature(intent);
}
export function reviewedDependencySignature(context: ReviewedIntentContext): string {
  const control = context.generationControl;
  const protectedIds = new Set([...(control?.lockedEntityIds ?? []), ...(control?.protectedCoreIds ?? [])]);
  const lockedFloors = new Set(control?.lockedFloorIds ?? []);
  const protectedGeometry = context.building.floors.map(floor => lockedFloors.has(floor.id) ? floor : {
    level: floor.level,
    entities: [...floor.rooms, ...floor.walls, ...floor.doors, ...floor.windows, ...floor.stairs, ...floor.columns].filter(entity => protectedIds.has(entity.id)),
  }).filter(floor => 'entities' in floor ? floor.entities.length > 0 : true);
  return intentSignature({ site: context.building.site, program: context.program, footprint: context.footprint,
    locks: { entities: [...protectedIds].sort(), floors: [...lockedFloors].sort() }, protectedGeometry });
}
export function createUnreviewedBudget(): BuildingBudgetIntent {
  return { schemaVersion: 1, mode: 'TOTAL_BUILT_UP', floorTargets: {}, acceptedTolerance: 0.05,
    footprintFreedom: 'APPROVAL_REQUIRED_FOR_CHANGE', provenance: 'LEGACY_UNREVIEWED', approvalState: 'UNREVIEWED' };
}
export function refreshBudgetApproval(context: ReviewedIntentContext, budget: BuildingBudgetIntent): BuildingBudgetIntent {
  if (budget.approvalState !== 'APPROVED') return budget;
  return budget.dependencySignature === reviewedDependencySignature(context) && budget.approvedBudgetSignature === budgetSignature(budget)
    ? budget : { ...budget, approvalState: 'STALE' };
}

export function assessBuildingBudget(context: ReviewedIntentContext, budget: BuildingBudgetIntent): BudgetAssessment {
  const { building, program } = context;
  const issues: BudgetIssue[] = [];
  const issue = (code: string, field: string, message: string) => issues.push({ code, field, message });
  const count = building.site.plannedFloorCount ?? building.floors.length;
  const site = calculateSiteMetrics(building);
  const capacity = calculateProgramCapacity(building, program);
  // Reuse existing reserve assumptions. Explicit circulation/core items satisfy,
  // rather than duplicate, the corresponding reserve. Open site spaces are separate.
  const grossBase = capacity.preliminaryGrossCapacityMm2;
  const ratios = grossBase > 0 ? [capacity.circulationReserveMm2, capacity.verticalCoreReserveMm2, capacity.wallServiceReserveMm2].map(x => x / grossBase) : [0, 0, 0];
  const enclosed = program.items.filter(item => item.group !== 'outdoor' && item.definitionId !== 'car_parking');
  const grossFor = (kind: 'minimumAreaMm2' | 'preferredAreaMm2' | 'maximumAreaMm2') => {
    let rooms = 0; let circulation = 0; let cores = 0;
    for (const item of enclosed) {
      const area = item[kind];
      if (area === undefined) return undefined;
      const demand = area * item.quantity;
      if (item.canonicalType === 'staircase' || item.canonicalType === 'lift') cores += demand;
      else if (item.group === 'circulation') circulation += demand;
      else rooms += demand;
    }
    let gross = rooms + circulation + cores;
    for (let n = 0; n < 80; n++) gross = (rooms + Math.max(circulation, gross * ratios[0]!) + Math.max(cores, gross * ratios[1]!)) / (1 - ratios[2]!);
    return gross;
  };
  const minimum = grossFor('minimumAreaMm2') ?? 0;
  const preferred = grossFor('preferredAreaMm2') ?? minimum;
  const maximum = grossFor('maximumAreaMm2');
  if (budget.schemaVersion !== 1 || !['GROUND_FOOTPRINT','TOTAL_BUILT_UP','FLOOR_WISE','COVERAGE'].includes(budget.mode)) issue('BUDGET_SCHEMA', 'mode', 'Choose a supported building budget mode.');
  if (!['FIXED_BOUNDARY','FLEXIBLE_WITHIN_ENVELOPE','APPROVAL_REQUIRED_FOR_CHANGE'].includes(budget.footprintFreedom)) issue('FOOTPRINT_POLICY', 'footprintFreedom', 'Choose how the building boundary may change.');
  if (!Number.isInteger(count) || count < 1 || count > 4 || grossBase <= 0) issue('SITE_CAPACITY', 'site', 'Provide a positive buildable envelope and 1–4 planned floors.');
  validateSpaceProgram(program, count).issues.filter(x => x.status === 'INVALID').forEach(x => issue('PROGRAM_INVALID', x.field, x.message));
  program.items.filter(item => item.generatorSupport !== 'supported' || item.isCustom || !item.canonicalType).forEach(item => issue('UNSUPPORTED_SPACE', item.id, `${item.name} has no complete planner mapping. Remove it explicitly or wait for supported synthesis.`));
  if (!Number.isFinite(budget.acceptedTolerance) || budget.acceptedTolerance < 0 || budget.acceptedTolerance > 0.05) issue('TOLERANCE', 'acceptedTolerance', 'Choose a planning tolerance between 0% and 5%.');
  const supplied = [budget.groundFootprintTarget, budget.totalGrossTarget, budget.coverageTarget, ...Object.values(budget.floorTargets ?? {})];
  if (supplied.some(x => x !== undefined && (!Number.isFinite(x) || x <= 0))) issue('POSITIVE_TARGET', 'targets', 'Every supplied area/coverage target must be finite and greater than zero.');
  if (budget.coverageTarget !== undefined && budget.coverageTarget > 1) issue('COVERAGE_RANGE', 'coverageTarget', 'Coverage cannot exceed 100% of the site.');
  const floors: Record<number, number> = { ...budget.floorTargets };
  const equal = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.max(a, b) * 1e-8);
  const reconcile = (a: number | undefined, b: number | undefined, field: string) => {
    if (a !== undefined && b !== undefined && !equal(a, b)) issue('CONFLICTING_TARGETS', field, 'Supplied ground, coverage, total and floor allocations disagree. Edit them; tolerance does not reconcile contradictory intent.');
  };
  const coverageArea = budget.coverageTarget === undefined ? undefined : budget.coverageTarget * site.plotArea;
  const maxCoverage = building.site.developmentControls?.maxCoveragePercent.value;
  if (maxCoverage !== undefined && (budget.groundFootprintTarget ?? coverageArea ?? floors[0] ?? (count === 1 ? budget.totalGrossTarget : undefined) ?? 0) > site.plotArea * maxCoverage / 100) issue('COVERAGE_LIMIT', 'groundFootprintTarget', 'Ground target exceeds the user-supplied coverage limit.');
  reconcile(budget.groundFootprintTarget, coverageArea, 'coverageTarget');
  const ground = budget.groundFootprintTarget ?? coverageArea;
  if (ground !== undefined) { reconcile(floors[0], ground, 'floorTargets.0'); floors[0] ??= ground; }
  if (count === 1 && budget.totalGrossTarget !== undefined) { reconcile(floors[0], budget.totalGrossTarget, 'totalGrossTarget'); floors[0] ??= budget.totalGrossTarget; }
  const required = budget.mode === 'GROUND_FOOTPRINT' ? budget.groundFootprintTarget : budget.mode === 'TOTAL_BUILT_UP' ? budget.totalGrossTarget : budget.mode === 'COVERAGE' ? budget.coverageTarget : Object.keys(floors).length;
  if (required === undefined || required === 0) issue('TARGET_REQUIRED', 'mode', 'Select an explicit target or accept a recommendation before generation.');
  for (let level = 0; level < count; level++) if (floors[level] === undefined) issue('FLOOR_ALLOCATION_REQUIRED', `floorTargets.${level}`, `Provide the target for ${level === 0 ? 'Ground' : `Floor ${level}`}; no floor split is assumed.`);
  if (Object.keys(floors).some(key => !/^\d+$/.test(key) || Number(key) >= count)) issue('INVALID_FLOOR', 'floorTargets', 'A target references a floor outside this project.');
  const total = Object.values(floors).reduce((sum, value) => sum + value, 0);
  if (Object.keys(floors).length === count) reconcile(total, budget.totalGrossTarget, 'totalGrossTarget');
  const selectedTotal = budget.totalGrossTarget ?? total;
  if (selectedTotal * (1 + budget.acceptedTolerance) < minimum) issue('PROGRAM_EXCEEDS_BUDGET', 'totalGrossTarget', 'The selected area cannot carry Program minima and the existing preliminary reserves.');
  if (maximum !== undefined && selectedTotal * (1 - budget.acceptedTolerance) > maximum) issue('BUDGET_EXCEEDS_PROGRAM', 'totalGrossTarget', 'The target exceeds the Program maxima and supported reserves. Add legitimate spaces or lower the target; rooms will not be inflated.');
  if (site.permissibleFloorArea !== undefined && selectedTotal > site.permissibleFloorArea) issue('TOTAL_LIMIT', 'totalGrossTarget', 'Target exceeds the supplied floor-area limit.');
  for (const [key, area] of Object.entries(floors)) {
    if (area > site.buildableEnvelopeArea) issue('ENVELOPE_EXCEEDED', `floorTargets.${key}`, 'Floor target exceeds the buildable envelope.');
    const assignedMin = enclosed.filter(item => (item.floorPreference.kind === 'ground_required' && key === '0') || (item.floorPreference.kind === 'specific' && item.floorPreference.specificFloor === Number(key)))
      .reduce((sum, item) => sum + item.quantity * item.minimumAreaMm2, 0);
    if (assignedMin > area * (1 + budget.acceptedTolerance) * (1 - ratios[2]!)) issue('FLOOR_PROGRAM_EXCEEDS_BUDGET', `floorTargets.${key}`, 'Required floor-specific spaces exceed this floor budget.');
  }
  return { issues, siteArea: site.plotArea, envelopeArea: site.buildableEnvelopeArea, recommendedRange: [minimum, preferred], maximumSupportedGross: maximum, totalGrossTarget: selectedTotal, floorTargets: floors };
}
export function approveBuildingBudget(context: ReviewedIntentContext, budget: BuildingBudgetIntent): BuildingBudgetIntent {
  const result = assessBuildingBudget(context, budget);
  if (result.issues.length) throw new Error(result.issues.map(issue => `${issue.code}: ${issue.message}`).join(' '));
  return { ...budget, approvalState: 'APPROVED', dependencySignature: reviewedDependencySignature(context), approvedBudgetSignature: budgetSignature(budget) };
}

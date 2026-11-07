import type { Building } from './building';
import type { FootprintIntent } from './footprint';
import type { GenerationControlState } from './generation-control';
import type { RoomProgram } from './design-intelligence';
import type { SpaceProgram, SpaceProgramItem } from './space-program';

export type BuildingBudgetMode = 'GROUND_FOOTPRINT' | 'TOTAL_BUILT_UP' | 'FLOOR_WISE' | 'COVERAGE';
export type FootprintFreedom = 'FIXED_BOUNDARY' | 'FLEXIBLE_WITHIN_ENVELOPE' | 'APPROVAL_REQUIRED_FOR_CHANGE';
/** Areas are mm², coverage and tolerance are fractions, never percentages. */
export interface BuildingBudgetIntent {
  readonly schemaVersion: 1;
  readonly mode: BuildingBudgetMode;
  readonly groundFootprintTarget?: number;
  readonly totalGrossTarget?: number;
  readonly floorTargets: Readonly<Record<number, number>>;
  readonly coverageTarget?: number;
  readonly acceptedTolerance: number;
  readonly footprintFreedom: FootprintFreedom;
  readonly provenance: 'USER_DEFINED' | 'RECOMMENDED' | 'LEGACY_UNREVIEWED';
  readonly approvalState: 'UNREVIEWED' | 'APPROVED' | 'STALE';
  readonly dependencySignature?: string;
  readonly approvedBudgetSignature?: string;
}
export interface ReviewedIntentContext {
  readonly building: Building;
  readonly program: SpaceProgram;
  readonly footprint: FootprintIntent;
  readonly generationControl?: GenerationControlState;
}
export interface BudgetIssue { readonly code: string; readonly field: string; readonly message: string }
export interface BudgetAssessment {
  readonly issues: readonly BudgetIssue[];
  readonly siteArea: number;
  readonly envelopeArea: number;
  readonly recommendedRange: readonly [number, number];
  readonly maximumSupportedGross?: number;
  readonly totalGrossTarget: number;
  readonly floorTargets: Readonly<Record<number, number>>;
}
export interface ReviewedGenerationRequest {
  readonly schemaVersion: 1;
  readonly engineVersion: 'reviewed-intent-v1';
  readonly siteSignature: string;
  readonly programSignature: string;
  readonly budgetSignature: string;
  readonly dependencySignature: string;
  readonly requestHash: string;
  readonly seed: number;
  readonly site: Building['site'];
  readonly program: SpaceProgram;
  readonly budget: BuildingBudgetIntent;
  readonly footprint: FootprintIntent;
  readonly floorTargets: Readonly<Record<number, number>>;
  readonly instances: readonly (SpaceProgramItem & { readonly sourceItemId: string; readonly instanceId: string; readonly ownerInstanceId?: string })[];
  readonly plannerProgram: RoomProgram;
  readonly relationshipIntent: readonly { readonly sourceItemId: string; readonly targetItemId: string; readonly strength: string; readonly reason: string }[];
  readonly anchors: { readonly coreAnchor?: FootprintIntent['coreAnchor'] };
  readonly locks?: GenerationControlState;
}

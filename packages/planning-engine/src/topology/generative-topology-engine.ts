/**
 * The generative topology engine's entry point.
 *
 * One deterministic call takes a brief and a buildable envelope and returns
 * ranked, genuinely distinct, validated design concepts:
 *
 *   brief + envelope
 *     -> architectural intent      (architectural-intent.ts)
 *     -> topology candidates       (topology-families.ts)
 *     -> assembled plan geometry   (plan-assembler.ts)
 *     -> hard constraints + scores (candidate-scoring.ts)
 *     -> Pareto ranking
 *     -> diversity filtering       (layout-fingerprint.ts)
 *     -> concepts
 *
 * Determinism: same envelope + same brief + same seed + same engine version
 * gives byte-identical geometry. The seed derives from the intent digest and
 * the caller's seed, and is used only to order exploration, never to decide
 * whether a constraint is met.
 *
 * Honesty: when only one organization is feasible, ONE concept is returned
 * together with the reasons the others were rejected. The engine never invents
 * an alternative, and never presents a mirror image as a second design.
 */

import type { ApartmentBhkType, DynamicApartmentManifest } from '@ai-floor-planner/core';
import type { ExtractedRoom } from '../interpretation/extraction';
import type { ApartmentPlanStructure } from '../interpretation/apartment-plan';
import { fnv1a, mulberry32, type Box2D } from './rect-frame';
import {
  interpretArchitecturalIntent,
  validateProgram,
  type ArchitecturalProgram,
} from './architectural-intent';
import {
  generateTopologyCandidates,
  type TopologyCandidate,
  type TopologyFamilyId,
  type TopologyPartition,
  type TopologyRejection,
} from './topology-families';
import { assembleStructureFromPartition } from './plan-assembler';
import {
  layoutFingerprint,
  selectDistinct,
  compareLayouts,
  type LayoutFingerprint,
} from './layout-fingerprint';
import {
  rankCandidates,
  scoreCandidate,
  explainRanking,
  type CandidateScore,
} from './candidate-scoring';

/** The engine version participates in the determinism contract. */
export const TOPOLOGY_ENGINE_VERSION = '1.0.0';

export interface DesignConcept {
  readonly conceptId: string;
  readonly familyId: TopologyFamilyId;
  readonly variantId: string;
  readonly label: string;
  /** Why this organization exists, in architectural terms. */
  readonly rationale: string;
  readonly partition: TopologyPartition;
  readonly structure: ApartmentPlanStructure;
  readonly score: CandidateScore;
  readonly fingerprint: LayoutFingerprint;
  /** Why this concept ranks where it does, relative to the one above it. */
  readonly rankingExplanation: string;
}

export interface GenerateConceptsInput {
  readonly envelope: Box2D;
  readonly flatsPerFloor: 1 | 2 | 3 | 4 | 5 | 6;
  readonly unitTypes: readonly ApartmentBhkType[];
  readonly aiPrompt?: string;
  readonly manifest?: DynamicApartmentManifest;
  readonly rawRooms?: readonly ExtractedRoom[];
  /** Deterministic seed; same seed gives the same geometry. Default 1. */
  readonly seed?: number;
  /** How many distinct concepts to return. Default 3. */
  readonly conceptLimit?: number;
  /** Stop exploring after this many assembled candidates. Default 24. */
  readonly maxCandidates?: number;
  /** Abort generation when it exceeds this budget, in ms. Default 20000. */
  readonly timeBudgetMs?: number;
}

export interface RejectedCandidate {
  readonly familyId: TopologyFamilyId;
  readonly variantId: string;
  readonly reasons: readonly string[];
  readonly stage: 'TOPOLOGY' | 'ASSEMBLY' | 'HARD_CONSTRAINT' | 'DIVERSITY' | 'BUDGET';
}

export interface GenerateConceptsResult {
  /** Review/repair candidate only. Never included among feasible concepts. */
  readonly bestEffort?: DesignConcept;
  readonly program: ArchitecturalProgram;
  readonly concepts: readonly DesignConcept[];
  readonly rejected: readonly RejectedCandidate[];
  /** Present when fewer concepts were produced than requested. */
  readonly shortfallExplanation?: string;
  readonly diagnostics: {
    readonly engineVersion: string;
    readonly seed: number;
    readonly topologyVariantsTried: number;
    readonly assembledCandidates: number;
    readonly feasibleCandidates: number;
    readonly elapsedMs: number;
    readonly timedOut: boolean;
  };
}

interface ScoredCandidate {
  readonly topology: TopologyCandidate;
  readonly partition: TopologyPartition;
  readonly structure: ApartmentPlanStructure;
  readonly score: CandidateScore;
  readonly fingerprint: LayoutFingerprint;
}

/**
 * Generates ranked, distinct, validated design concepts for one typical floor.
 *
 * Throws only when the brief itself is contradictory (via
 * `interpretArchitecturalIntent`) or structurally invalid. An envelope that
 * admits no valid organization returns zero concepts with reasons, not an
 * exception, so the caller can report honest infeasibility.
 */
export function generateDesignConcepts(input: GenerateConceptsInput): GenerateConceptsResult {
  const startedAt = Date.now();
  const conceptLimit = input.conceptLimit ?? 3;
  const maxCandidates = input.maxCandidates ?? 24;
  const timeBudgetMs = input.timeBudgetMs ?? 20_000;

  const program = interpretArchitecturalIntent({
    prompt: input.aiPrompt,
    flatsPerFloor: input.flatsPerFloor,
    unitTypes: input.unitTypes,
  });

  const validation = validateProgram(program);
  if (!validation.valid) {
    throw new Error(`INVALID_ARCHITECTURAL_PROGRAM: ${validation.issues.join('; ')}`);
  }

  // Seed combines the caller's seed with the interpreted intent, so a changed
  // brief explores in a different order while a repeated brief is reproducible.
  const seed = fnv1a(`${input.seed ?? 1}:${program.intentDigest}:${TOPOLOGY_ENGINE_VERSION}`);
  const random = mulberry32(seed);

  const { candidates: topologies, rejections } = generateTopologyCandidates({
    envelope: input.envelope,
    flatsPerFloor: input.flatsPerFloor,
    program,
  });

  const rejected: RejectedCandidate[] = rejections.map((r: TopologyRejection) => ({
    familyId: r.familyId,
    variantId: r.variantId,
    reasons: r.reasons,
    stage: 'TOPOLOGY' as const,
  }));

  // Explore in an order biased toward the brief's stated priority, with a
  // deterministic tiebreak. Ordering affects only exploration, never validity.
  const ordered = [...topologies]
    .map(t => ({ t, key: explorationKey(t, program, random()) }))
    .sort((a, b) => a.key - b.key)
    .map(x => x.t);

  const scored: ScoredCandidate[] = [];
  const failed: ScoredCandidate[] = [];
  let assembledCount = 0;
  let timedOut = false;

  for (const topology of ordered) {
    if (assembledCount >= maxCandidates) {
      rejected.push({
        familyId: topology.familyId,
        variantId: topology.variantId,
        reasons: [`candidate budget of ${maxCandidates} assembled layouts was reached before this variant was tried`],
        stage: 'BUDGET',
      });
      continue;
    }
    if (Date.now() - startedAt > timeBudgetMs) {
      timedOut = true;
      rejected.push({
        familyId: topology.familyId,
        variantId: topology.variantId,
        reasons: [`generation time budget of ${timeBudgetMs} ms was exhausted before this variant was tried`],
        stage: 'BUDGET',
      });
      continue;
    }

    assembledCount++;
    let assembled;
    try {
      assembled = assembleStructureFromPartition({
        partition: topology.partition,
        program,
        manifest: input.manifest,
        unitTypes: input.unitTypes,
        rawRooms: input.rawRooms,
      });
    } catch (error) {
      rejected.push({
        familyId: topology.familyId,
        variantId: topology.variantId,
        reasons: [`room planning failed: ${error instanceof Error ? error.message : String(error)}`],
        stage: 'ASSEMBLY',
      });
      continue;
    }

    const score = scoreCandidate({
      structure: assembled.structure,
      partition: topology.partition,
      program,
      flatsWithoutEntrance: assembled.flatsWithoutEntrance,
    });

    if (!score.feasible) {
      failed.push({ topology, partition: topology.partition, structure: assembled.structure,
        score, fingerprint: layoutFingerprint(assembled.structure, topology.partition) });
      rejected.push({
        familyId: topology.familyId,
        variantId: topology.variantId,
        reasons: score.hardConstraints.filter(c => !c.satisfied).map(c => `${c.id}: ${c.detail}`),
        stage: 'HARD_CONSTRAINT',
      });
      continue;
    }

    scored.push({
      topology,
      partition: topology.partition,
      structure: assembled.structure,
      score,
      fingerprint: layoutFingerprint(assembled.structure, topology.partition),
    });
  }

  // When the brief asks for bedroom balconies, a layout that can actually carry
  // them outranks one that cannot — regardless of how it scores elsewhere.
  //
  // This is not a scoring weight but a precedence rule, because the capability
  // is binary and geometric: only a bedroom on an envelope-edge wall can have a
  // balcony carved from it, so a layout with none cannot be improved into one
  // that has them. Ranking by weighted score alone would hand the user a plan
  // that silently drops a feature they asked for.
  const wantsBalconies = program.preferences.bedroomBalconies !== 'NONE_REQUESTED';
  const withBalconies = wantsBalconies
    ? scored.filter(c => countBedroomBalconies(c.structure) > 0)
    : [];

  const ranked = withBalconies.length
    ? [...rankCandidates(withBalconies), ...rankCandidates(scored.filter(c => !withBalconies.includes(c)))]
    : rankCandidates(scored);
  const { selected, suppressed } = selectDistinct(ranked, conceptLimit);

  for (const s of suppressed) {
    rejected.push({
      familyId: s.candidate.topology.familyId,
      variantId: s.candidate.topology.variantId,
      reasons: [s.reason],
      stage: 'DIVERSITY',
    });
  }

  const concepts: DesignConcept[] = selected.map((candidate, index) => ({
    conceptId: `concept_${String(index + 1).padStart(2, '0')}`,
    familyId: candidate.topology.familyId,
    variantId: candidate.topology.variantId,
    label: candidate.topology.label,
    rationale: candidate.topology.rationale,
    partition: candidate.partition,
    structure: candidate.structure,
    score: candidate.score,
    fingerprint: candidate.fingerprint,
    rankingExplanation: index === 0
      ? 'Ranked first on the priorities this brief emphasized; see the objective scores for the measurements behind it.'
      : explainRanking(selected[index - 1]!.score, candidate.score),
  }));

  const shortfallExplanation = concepts.length < conceptLimit
    ? describeShortfall(concepts.length, conceptLimit, rejected, timedOut)
    : undefined;

  // Failed candidates remain failed. Choose the fewest hard violations first,
  // then measured utility, with a stable identity tie-break for review/repair.
  const leastBad = [...failed].sort((a, b) =>
    a.score.hardConstraints.filter(c => !c.satisfied).length - b.score.hardConstraints.filter(c => !c.satisfied).length
    || b.score.weightedTotal - a.score.weightedTotal
    || a.topology.variantId.localeCompare(b.topology.variantId))[0];
  const bestEffort: DesignConcept | undefined = leastBad ? {
    conceptId: 'best_effort', familyId: leastBad.topology.familyId,
    variantId: leastBad.topology.variantId, label: leastBad.topology.label,
    rationale: leastBad.topology.rationale, partition: leastBad.partition,
    structure: leastBad.structure, score: leastBad.score, fingerprint: leastBad.fingerprint,
    rankingExplanation: 'Best assembled failed candidate: fewest hard violations, then measured utility. Requires repair and review.',
  } : undefined;
  return {
    bestEffort,
    program,
    concepts,
    rejected,
    shortfallExplanation,
    diagnostics: {
      engineVersion: TOPOLOGY_ENGINE_VERSION,
      seed,
      topologyVariantsTried: topologies.length + rejections.length,
      assembledCandidates: assembledCount,
      feasibleCandidates: scored.length,
      elapsedMs: Date.now() - startedAt,
      timedOut,
    },
  };
}

/**
 * Exploration order. Families matching the brief's priority are tried first so
 * the time budget is spent where it is most likely to pay off; the random term
 * only breaks ties and is seeded, so the order is reproducible.
 */
function explorationKey(candidate: TopologyCandidate, program: ArchitecturalProgram, jitter: number): number {
  const priority = program.preferences.priority;
  const family = candidate.familyId;

  let affinity = 0.5;
  if (priority === 'DAYLIGHT_VENTILATION') {
    affinity = family === 'CENTRAL_COURTYARD' ? 0 : family === 'PERIMETER_HABITABLE' ? 0.1 : family === 'DUAL_WING' ? 0.2 : 0.6;
  } else if (priority === 'COMPACT_EFFICIENCY') {
    affinity = family === 'CENTRAL_CORE_SPINE' ? 0 : family === 'SIDE_CORE' ? 0.1 : family === 'LINEAR_SINGLE_LOADED' ? 0.2 : 0.6;
  } else if (priority === 'PRIVACY_CIRCULATION') {
    affinity = family === 'PERIMETER_HABITABLE' ? 0 : family === 'SPLIT_CORE' ? 0.1 : family === 'SIDE_CORE' ? 0.2 : 0.6;
  } else if (priority === 'KITCHEN_DINING') {
    affinity = family === 'DUAL_WING' ? 0 : family === 'SIDE_CORE' ? 0.1 : 0.5;
  }

  // An explicitly required core side takes precedence over priority affinity.
  const requiredCore = program.mandatory.corePlacement ?? program.preferences.corePreference;
  let coreAffinity = 0.5;
  if (requiredCore === 'CENTRAL') coreAffinity = family === 'CENTRAL_CORE_SPINE' || family === 'DUAL_WING' ? 0 : 0.8;
  else if (requiredCore === 'SPLIT') coreAffinity = family === 'SPLIT_CORE' ? 0 : 0.8;
  else if (['EAST', 'WEST', 'NORTH', 'SOUTH'].includes(requiredCore)) {
    coreAffinity = family === 'SIDE_CORE' && candidate.variantId.includes(requiredCore.toLowerCase()) ? 0
      : family === 'SIDE_CORE' ? 0.4
      : family === 'LINEAR_SINGLE_LOADED' ? 0.5
      : 0.8;
  }

  return coreAffinity * 2 + affinity + jitter * 0.01;
}

function describeShortfall(
  produced: number,
  requested: number,
  rejected: readonly RejectedCandidate[],
  timedOut: boolean,
): string {
  const byStage = (stage: RejectedCandidate['stage']) => rejected.filter(r => r.stage === stage);
  const parts: string[] = [
    `${produced} genuinely distinct concept${produced === 1 ? '' : 's'} could be produced for this brief and plot, ` +
    `not the ${requested} requested.`,
  ];

  const topology = byStage('TOPOLOGY');
  if (topology.length) {
    parts.push(
      `${topology.length} organization(s) do not fit this envelope: ` +
      `${topology.slice(0, 4).map(r => `${r.familyId} (${r.reasons[0]})`).join('; ')}.`,
    );
  }
  const hard = byStage('HARD_CONSTRAINT');
  if (hard.length) {
    parts.push(
      `${hard.length} layout(s) reached geometry but failed a mandatory requirement: ` +
      `${hard.slice(0, 3).map(r => r.reasons[0]).join('; ')}.`,
    );
  }
  const diversity = byStage('DIVERSITY');
  if (diversity.length) {
    parts.push(
      `${diversity.length} valid layout(s) were suppressed as not genuinely different from a concept already ` +
      `shown, rather than presented as separate designs.`,
    );
  }
  if (timedOut) parts.push('Generation stopped at its time budget, so some variants were not tried.');

  parts.push('No alternative has been invented to reach the requested count.');
  return parts.join(' ');
}

/** How many bedrooms in this plan have an attached balcony. */
function countBedroomBalconies(structure: ApartmentPlanStructure): number {
  let count = 0;
  for (const flat of structure.flats) {
    for (const room of flat.rooms) {
      if (room.type !== 'bedroom') continue;
      if (flat.rooms.some(other => other.id === `${room.id}__balcony`)) count++;
    }
  }
  return count;
}

/** Re-exported for callers that need to compare two concepts directly. */
export { compareLayouts };

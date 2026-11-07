/**
 * Generalized Deterministic Candidate Search & Quality-Gate Engine (§15, §18, §19, §24, §25).
 *
 * Implements:
 * - Generates 20–40 cheap deterministic candidates across compatible topology families and strategies.
 * - Dynamic Zero Hard Errors Gate: checks exact contract flatCount, BHK types, bedroom counts, boundaries.
 * - Multi-criteria scoring:
 *   - Calibrated Cost Efficiency (0–100)
 *   - Architectural Quality (0–100)
 *   - Circulation Efficiency (0–100)
 *   - Daylight & Exterior Exposure (0–100)
 * - Quality Distribution & Fairness (§24, §25): tracks minQuality, avgQuality, qualityVariance, fairnessPenalty.
 * - Diversity Filter: selects top candidates representing distinct architectural strategies.
 */

import { generateCoreConfigurations, calculateCostEfficiencyMetrics, type CostEfficiencyMetrics } from './core-optimizer.js';
import { solveApartmentEnvelopes, type SolvedFloorPlateAllocation } from './envelope-solver.js';
import { solveUnitTopology, type SolvedUnitTopology } from './unit-topology-solver.js';
import { type ApartmentGenerationContract } from './contract.js';
import { findCompatibleTopologyFamilies } from './topology-library.js';

export interface UnitQualityFairness {
  readonly minUnitQuality: number;
  readonly avgUnitQuality: number;
  readonly qualityVariance: number;
  readonly fairnessPenalty: number;
}

export interface EvaluatedCandidateTopology {
  readonly candidateId: string;
  readonly candidateNumber: number;
  readonly strategy: 'balanced' | 'daylight' | 'privacy' | 'circulation';
  readonly coreId: string;
  readonly allocation: SolvedFloorPlateAllocation;
  readonly unitTopologies: readonly SolvedUnitTopology[];
  readonly costEfficiency: CostEfficiencyMetrics;
  readonly scores: {
    readonly architecturalQuality: number;
    readonly circulationEfficiency: number;
    readonly daylightExposure: number;
    readonly costEfficiency: number;
    readonly compositeScore: number;
  };
  readonly unitQuality?: UnitQualityFairness;
  readonly hardErrorsCount: number;
  readonly softWarningsCount: number;
  readonly isHardValid: boolean;
}

export interface CandidateSearchResult {
  readonly totalCandidatesEvaluated: number;
  readonly validCandidatesCount: number;
  readonly rejectedHardErrorCount: number;
  readonly searchDurationMs: number;
  readonly selectedTopCandidates: readonly EvaluatedCandidateTopology[];
}

/**
 * Searches deterministic apartment candidates across compatible topology families.
 */
export function searchDeterministicApartmentTopologies(
  contract: ApartmentGenerationContract,
): CandidateSearchResult {
  const startedAt = Date.now();
  const candidates: EvaluatedCandidateTopology[] = [];

  const strategies: readonly ('balanced' | 'daylight' | 'privacy' | 'circulation')[] = [
    'balanced',
    'daylight',
    'privacy',
    'circulation',
  ];

  const aspectTolerances = [1.0, 1.05, 0.95];

  let candidateIdx = 0;
  let rejectedHardErrorCount = 0;

  const centerPoint = {
    x: contract.site.buildableWidthM / 2,
    y: contract.site.buildableDepthM / 2,
  };

  const corePlacement = contract.core.corePlacement ?? 'CENTRAL';

  const coreConfigs = generateCoreConfigurations(
    centerPoint,
    contract.core.liftCount,
    contract.core.stairCount,
    corePlacement,
  );

  const siteAspect = contract.site.buildableWidthM / Math.max(1, contract.site.buildableDepthM);
  const compatibleFamilies = findCompatibleTopologyFamilies(
    contract.flatCount,
    siteAspect,
    corePlacement,
  );

  const familiesToUse = compatibleFamilies.length > 0
    ? compatibleFamilies.map(f => f.family)
    : (contract.flatCount === 3
        ? ['THREE_WING_CORE']
        : contract.flatCount === 4
          ? ['FOUR_CORNER_CORE']
          : ['COMPACT_RECTANGULAR'] as const);

  for (const family of familiesToUse) {
    for (const coreConfig of coreConfigs) {
      for (const strategy of strategies) {
        for (const aspectScale of aspectTolerances) {
          candidateIdx++;

          // 1. Solve floor plate allocation
          const allocation = solveApartmentEnvelopes({
            buildableWidthM: contract.site.buildableWidthM,
            buildableDepthM: contract.site.buildableDepthM,
            strategy,
            coreConfig,
            contract,
            topologyFamily: family,
          });

          // 2. Solve internal topology for each envelope
          const unitTopologies = allocation.envelopes.map(env => solveUnitTopology(env));

          // 3. Collect hard errors dynamically
          const allHardErrors: string[] = [
            ...allocation.hardErrors,
            ...unitTopologies.flatMap(u => u.hardErrors),
          ];

          // Dynamic contract verification (§19)
          if (allocation.envelopes.length !== contract.flatCount) {
            allHardErrors.push(
              `Expected ${contract.flatCount} apartment envelopes, found ${allocation.envelopes.length}.`,
            );
          }

          for (let i = 0; i < unitTopologies.length; i++) {
            const u = unitTopologies[i]!;
            const expectedFlat = contract.flats[i];
            if (expectedFlat) {
              if (u.bedroomsCount !== expectedFlat.targetBedrooms) {
                allHardErrors.push(
                  `${u.unitId} has ${u.bedroomsCount} bedrooms (expected ${expectedFlat.targetBedrooms}).`,
                );
              }
              if (u.unitType !== expectedFlat.unitType) {
                allHardErrors.push(
                  `${u.unitId} is ${u.unitType} (expected ${expectedFlat.unitType}).`,
                );
              }
            }
          }

          const isHardValid = allHardErrors.length === 0;

          if (!isHardValid) {
            rejectedHardErrorCount++;
            continue; // Discard invalid candidate!
          }

          // 4. Calculate relative cost efficiency metrics
          const totalAptArea = unitTopologies.reduce((s, u) => s + u.actualBuiltUpAreaSqM, 0);
          const grossArea = allocation.totalBuiltUpAreaSqM;
          const coreArea = coreConfig.totalCoreAreaSqM;
          const circArea = allocation.commonCirculation.totalAreaSqM;

          const costMetrics = calculateCostEfficiencyMetrics({
            grossFloorAreaSqM: grossArea,
            apartmentAreaSqM: totalAptArea,
            coreAreaSqM: coreArea,
            commonCirculationAreaSqM: circArea,
            wallAreaProxySqM: 14.5,
            externalPerimeterM:
              2 * (allocation.floorPlateBounds.width + allocation.floorPlateBounds.height),
            shaftCount: Math.max(2, contract.flatCount),
            sharedLiftBank: coreConfig.liftBank.isSharedBank,
            repeatedWetStacks: coreConfig.repeatedPlumbingWetStacks,
          });

          // 5. Individual unit quality and fairness calculation (§24, §25)
          const unitQualities = unitTopologies.map(u => {
            let q = 80;
            if (u.furnishabilityPassed) q += 10;
            const facadeRooms = u.rooms.filter(r => r.onFacade).length;
            if (facadeRooms >= 4) q += 8;
            return q;
          });

          const minUnitQuality = Math.min(...unitQualities);
          const avgUnitQuality = Number(
            (unitQualities.reduce((s, q) => s + q, 0) / unitQualities.length).toFixed(1),
          );
          const variance = Number(
            (
              unitQualities.reduce((s, q) => s + Math.pow(q - avgUnitQuality, 2), 0) /
              unitQualities.length
            ).toFixed(1),
          );

          // Fairness penalty if high variance (> 15)
          const fairnessPenalty = variance > 15 ? Math.min(10, Math.round(variance / 3)) : 0;

          // 6. Multi-criteria scoring
          let archScore = Math.round(avgUnitQuality - fairnessPenalty);
          if (unitTopologies.every(u => u.furnishabilityPassed)) archScore += 5;
          if (strategy === 'daylight') archScore += 3;

          let circScore = 80;
          if (allocation.commonCirculation.averageTravelDistanceM < 3.5) circScore += 10;
          if (strategy === 'circulation') circScore += 6;

          let daylightScore = 80;
          const totalFacadeRooms = unitTopologies.flatMap(u =>
            u.rooms.filter(r => r.onFacade),
          ).length;
          if (totalFacadeRooms >= contract.flatCount * 5) daylightScore += 10;

          const costScore = costMetrics.costEfficiencyScore;

          const compositeScore = Number(
            (
              0.30 * costScore +
              0.30 * archScore +
              0.20 * circScore +
              0.20 * daylightScore
            ).toFixed(1),
          );

          candidates.push({
            candidateId: `candidate_${family.toLowerCase()}_${candidateIdx}_${strategy}`,
            candidateNumber: 0,
            strategy,
            coreId: coreConfig.id,
            allocation,
            unitTopologies,
            costEfficiency: costMetrics,
            scores: {
              architecturalQuality: archScore,
              circulationEfficiency: circScore,
              daylightExposure: daylightScore,
              costEfficiency: costScore,
              compositeScore,
            },
            unitQuality: {
              minUnitQuality,
              avgUnitQuality,
              qualityVariance: variance,
              fairnessPenalty,
            },
            hardErrorsCount: allHardErrors.length,
            softWarningsCount: unitTopologies.flatMap(u =>
              u.rooms.flatMap(r => r.furnishabilityNotes),
            ).length,
            isHardValid: true,
          });
        }
      }
    }
  }

  // 7. Diversity Filter: select best valid candidates across distinct strategies
  const selected: EvaluatedCandidateTopology[] = [];
  const usedStrategies = new Set<string>();

  candidates.sort((a, b) => b.scores.compositeScore - a.scores.compositeScore);

  for (const cand of candidates) {
    if (!usedStrategies.has(cand.strategy)) {
      usedStrategies.add(cand.strategy);
      selected.push({
        ...cand,
        candidateNumber: selected.length + 1,
      });
      if (selected.length === 4) break;
    }
  }

  if (selected.length < 4) {
    for (const cand of candidates) {
      if (!selected.some(s => s.candidateId === cand.candidateId)) {
        selected.push({
          ...cand,
          candidateNumber: selected.length + 1,
        });
        if (selected.length === 4) break;
      }
    }
  }

  const durationMs = Date.now() - startedAt;

  return {
    totalCandidatesEvaluated: candidateIdx,
    validCandidatesCount: candidates.length,
    rejectedHardErrorCount,
    searchDurationMs: durationMs,
    selectedTopCandidates: selected,
  };
}

/**
 * Backward compatibility wrapper for searchDeterministic3x3BhkTopologies.
 */
export function searchDeterministic3x3BhkTopologies(
  contract: ApartmentGenerationContract,
): CandidateSearchResult {
  return searchDeterministicApartmentTopologies(contract);
}

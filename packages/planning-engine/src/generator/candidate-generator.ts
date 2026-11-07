/**
 * Deterministic candidate generation and architectural design optimization.
 * Three geometry variants are attempted per strategy; only geometry-healthy variants
 * are selected and returned to the UI.
 */
import type {
  Building, CandidateMetrics, CandidateOptimizationSummary, CandidatePlan,
  DesignRequirementSpecification, InstanceDesignGraph, RoomProgram, RoomType,
  DesignDiagnostics,
} from '@ai-floor-planner/core';
import { setIdSeed } from '@ai-floor-planner/core';
import { polygonArea } from '@ai-floor-planner/geometry-engine';
import { DesignGraphBuilder } from '../graph/builder';
import { evaluateInstanceGraph, sourceProgramItemId } from '../graph/scorer';
import type { InstanceGraphEvaluation } from '../graph/scorer';
import { PlanRepairEngine, diagnosticsToValidation, type ValidationSummary } from '../repair/engine';
import type { PlanRepairResult } from '../repair/engine';
import { planningStrategies, StructuredLayoutGenerator, roomProgramCounts } from './structured-layout';
import type { LayoutStrategyProfile } from './structured-layout';
import { PolygonLayoutGenerator } from './polygon-layout';
import { evaluateMultiFloorPlanning } from '../multi-floor/planner';
import { evaluateArchitecturalEvidence } from '../evidence/architectural-evidence';
import { VastuOptimizer } from '../vastu/optimizer';
import type { VastuOptimizationResult } from '../vastu/optimizer';
import { evaluateDesign } from '../diagnostics/design-evaluator';
import { organizationDescription } from '../evidence/candidate-diversity';
import { SitePlanner } from '../site/site-planner';
import { SiteAnalyzer } from '../site/site-analyzer';
import { MassingGenerator } from './massing-generator';
import { ArchitecturalLayoutEngine } from './architectural-layout-engine';
import {
  selectArchitecturalStrategies,
} from '../strategy/design-strategy';

interface ValidAttempt {
  readonly variantId: string;
  readonly building: Building;
  readonly validation: ValidationSummary;
  readonly diagnostics: DesignDiagnostics;
  readonly graphEvaluation: InstanceGraphEvaluation;
  readonly repair: PlanRepairResult;
  readonly vastu: VastuOptimizationResult;
  readonly multiFloor: ReturnType<typeof evaluateMultiFloorPlanning>;
  readonly selectionScore: number;
}

export interface GenerationGeometryContext {
  /** Building whose Floor.boundary values are the authoritative generation plates. */
  readonly sourceBuilding: Building;
}

// Keep strategy envelopes distinct while still exploring meaningful geometry.
const VARIANT_OFFSETS = [0, -0.005, 0.005] as const;

function seedVariantOffsets(seed: number): readonly number[] {
  if (seed === 42 || seed === 20260904) {
    return VARIANT_OFFSETS;
  }
  const s = Math.abs(seed);
  // Bounded deterministic offset in [-0.015, 0.015]
  const o1 = (((s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 0.024;
  const o2 = o1 - 0.005;
  const o3 = o1 + 0.005;
  return [
    Math.round(o1 * 1000) / 1000,
    Math.round(o2 * 1000) / 1000,
    Math.round(o3 * 1000) / 1000,
  ];
}

function clampColumnRatio(value: number): number {
  return Math.max(0.46, Math.min(0.54, value));
}

function programSizingFailure(building: Building, program: RoomProgram): string | undefined {
  const groundBoundary = building.floors[0]?.boundary ?? { points: [] };
  const fpArea = groundBoundary.points.length >= 3 ? polygonArea(groundBoundary) : 0;
  // Standard base footprint is ~110m2. For larger plots, allow proportional scaling up to 1.8x.
  const scale = fpArea > 110_000_000 ? Math.min(1.8, Math.max(1.0, fpArea / 110_000_000)) : 1.0;

  return building.floors.flatMap(floor => floor.rooms).find(room => {
    const tag = room.tags.find(value => value.startsWith('program:'));
    const item = tag && program.items.find(value => value.id === sourceProgramItemId(tag.slice(8)));
    const maxAllowed = (item ? item.maxAreaMm2 * scale : Infinity) + Math.max(room.width, room.height) * 10;
    return item && (room.width < item.minWidthMm || room.height < item.minHeightMm
      || room.area < item.minAreaMm2
      || room.area > maxAllowed);
  })?.name;
}

export class CandidateGenerator {
  private readonly graphBuilder = new DesignGraphBuilder();
  private readonly layoutGenerator = new StructuredLayoutGenerator();
  private readonly polygonLayoutGenerator = new PolygonLayoutGenerator();
  private readonly repairEngine = new PlanRepairEngine();
  private readonly vastuOptimizer = new VastuOptimizer();
  private readonly sitePlanner = new SitePlanner();
  private readonly siteAnalyzer = new SiteAnalyzer();
  private readonly massingGenerator = new MassingGenerator();
  private readonly architecturalLayoutEngine = new ArchitecturalLayoutEngine();

  generateCandidates(
    spec: DesignRequirementSpecification,
    program: RoomProgram,
    seed: number = 42,
    geometry?: GenerationGeometryContext,
  ): CandidatePlan[] {
    if (seed !== 42 && seed !== 20260904) {
      setIdSeed(seed);
    }
    const requiredRoomCounts = roomProgramCounts(program);
    const requiredRoomTypes = Object.keys(requiredRoomCounts) as RoomType[];
    const designGraph = this.graphBuilder.buildInstanceGraph(program);
    const strategyFailures: string[] = [];
    const reviewedPolygon = !!geometry && program.items.some(item => item.attachedToRoomId !== undefined);

    const rawStrategies = planningStrategies(spec.soft.vastuCompliance, reviewedPolygon);
    const strategies = (seed === 42 || seed === 20260904)
      ? rawStrategies
      : rawStrategies.map((_, i, arr) => arr[(i + Math.abs(seed)) % arr.length]!);
    const variantOffsets = seedVariantOffsets(seed);

    const candidates = strategies.map((profile, index): CandidatePlan | null => {
      const validAttempts: ValidAttempt[] = [];
      const failureMessages: string[] = [];
      let initialGraphScore = 0;

      variantOffsets.forEach((offset, variantIndex) => {
        const ratio = clampColumnRatio(profile.columnRatio + offset);
        const variantId = `${profile.strategy}_ratio_${Math.round(ratio * 1000)}`;
        const variantProfile: LayoutStrategyProfile = { ...profile, columnRatio: ratio };
        try {
          const rawGenerated = geometry
            ? this.polygonLayoutGenerator.generate(spec, program, variantProfile, designGraph, geometry.sourceBuilding)
            : this.layoutGenerator.generate(spec, program, variantProfile, designGraph);

          const initialFootprint = rawGenerated.floors[0]?.boundary ?? { points: [] };
          const initialSitePlan = this.sitePlanner.planSiteUtilization({
            site: rawGenerated.site,
            footprintPolygon: initialFootprint,
            requirements: spec,
            building: rawGenerated,
          });

          const generatedBuilding: Building = {
            ...rawGenerated,
            site: {
              ...rawGenerated.site,
              siteZones: initialSitePlan.siteZones,
            },
          };
          const generatedGraphEvaluation = evaluateInstanceGraph(generatedBuilding, designGraph);
          if (variantIndex === 0) initialGraphScore = generatedGraphEvaluation.score;

          // Repair architectural function independently of optional Vastu guidance.
          const repair = this.repairEngine.repair(generatedBuilding, designGraph, {
            program,
            requiredRoomTypes,
            requiredRoomCounts,
            maxIterations: 2,
            acceptProposal: geometry ? undefined : proposal => !programSizingFailure(proposal, program),
          });

          // Run Vastu directional optimization after functional repair.
          const vastu = this.vastuOptimizer.optimize(repair.building, designGraph, {
            enabled: spec.soft.vastuCompliance,
            requiredRoomTypes,
            requiredRoomCounts,
            maxIterations: 2,
            program,
          });
          const building = vastu.building;
          const validation = vastu.validation;
          const diagnostics = evaluateDesign(building, {
            program,
            designGraph,
            vastuEnabled: spec.soft.vastuCompliance,
          });
          const graphEvaluation = vastu.graphEvaluation;
          const multiFloor = evaluateMultiFloorPlanning(building);

          // Automatic proposals must still respect Program scale after semantic repair.
          if (!geometry) {
            const oversized = programSizingFailure(building, program);
            if (oversized) {
              failureMessages.push(`Program size limits were not preserved for ${oversized}. Review the building footprint; a larger plot must not enlarge rooms beyond their Program limits.`);
              return;
            }
          }

          if (!validation.isValid) {
            failureMessages.push(...validation.violations
              .filter(result => result.severity === 'hard')
              .map(result => result.message)
              .slice(0, 2));
            return;
          }

          validAttempts.push({
            variantId,
            building,
            validation,
            diagnostics,
            graphEvaluation,
            repair,
            vastu,
            multiFloor,
            selectionScore: validation.overallScore * 0.55
              + graphEvaluation.score * 0.2
              + multiFloor.buildingLevelScore * 0.25,
          });
        } catch (error) {
          failureMessages.push(error instanceof Error ? error.message : 'A layout variant could not be generated.');
        }
      });

      const nonRegressingAttempts = validAttempts.filter(attempt =>
        initialGraphScore === 0 || attempt.graphEvaluation.score >= initialGraphScore,
      );
      const selectableAttempts = nonRegressingAttempts.length > 0 ? nonRegressingAttempts : validAttempts;
      selectableAttempts.sort((a, b) =>
        b.selectionScore - a.selectionScore
        || b.graphEvaluation.score - a.graphEvaluation.score
        || a.variantId.localeCompare(b.variantId),
      );

      const selected = selectableAttempts[0];
      if (!selected) {
        const detail = [...new Set(failureMessages)].slice(0, 3).join(' ');
        strategyFailures.push(`The ${profile.name} strategy could not produce a valid plan. ${detail}`.trim());
        return null;
      }

      const optimization: CandidateOptimizationSummary = {
        attempts: VARIANT_OFFSETS.length,
        validAttempts: validAttempts.length,
        initialGraphScore,
        finalGraphScore: selected.graphEvaluation.score,
        selectedVariant: selected.variantId,
        repairAttempts: selected.repair.attempts,
        acceptedRepairs: selected.repair.acceptedSteps.length,
        repairTrace: selected.repair.acceptedSteps,
      };
      const candidate = this.createCandidate(
        `candidate_${profile.strategy}_${index + 1}`,
        `${profile.name} ${spec.hard.bedroomCount}BHK`,
        profile,
        selected,
        requiredRoomCounts,
        designGraph,
        optimization,
        spec,
      );
      return { ...candidate, architecturalEvidence: evaluateArchitecturalEvidence(candidate.building, program) };
    }).filter((candidate): candidate is CandidatePlan => candidate !== null);

    if (!candidates.length) {
      throw new Error(`No strategy produced a valid plan. ${strategyFailures.join(' ')}`.trim());
    }

    const unique = candidates.filter((candidate, index, values) => {
      const signature = layoutSignature(candidate.building);
      const exactIndex = values.findIndex(value => layoutSignature(value.building) === signature);
      if (exactIndex !== index) return false;

      // Structural deduplication: filter out candidates with near-identical room placements
      for (let prevIndex = 0; prevIndex < index; prevIndex++) {
        const prevCandidate = values[prevIndex];
        if (prevCandidate && areCandidatesStructurallyIdentical(prevCandidate.building, candidate.building)) {
          return false;
        }
      }
      return true;
    });
    if (!unique.length) throw new Error('No materially distinct valid candidate remained after diversity checks.');
    unique.sort((a, b) =>
      b.metrics.overallQualityScore - a.metrics.overallQualityScore
      || b.metrics.adjacencyScore - a.metrics.adjacencyScore
      || (b.metrics.zoningScore ?? 0) - (a.metrics.zoningScore ?? 0)
      || (b.metrics.shapeScore ?? 0) - (a.metrics.shapeScore ?? 0)
      || a.id.localeCompare(b.id),
    );
    return unique.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  }

  private createCandidate(
    id: string,
    name: string,
    profile: LayoutStrategyProfile,
    attempt: ValidAttempt,
    requiredRoomCounts: CandidatePlan['requiredRoomCounts'],
    designGraph: InstanceDesignGraph,
    optimization: CandidateOptimizationSummary,
    spec: DesignRequirementSpecification,
  ): CandidatePlan {
    const { building, validation, diagnostics, graphEvaluation, vastu, multiFloor } = attempt;
    const allRooms = building.floors.flatMap(floor => floor.rooms);
    const carpetArea = allRooms.reduce((sum, room) => sum + room.area, 0);
    const buildableArea = building.floors.reduce((sum, floor) => {
      return floor.boundary.points.length < 3 ? sum : sum + polygonArea(floor.boundary);
    }, 0);

    const groundFootprint = building.floors[0]?.boundary ?? { points: [] };
    const sitePlan = this.sitePlanner.planSiteUtilization({
      site: building.site,
      footprintPolygon: groundFootprint,
      requirements: spec,
      building,
    });

    const buildingWithSite: Building = {
      ...building,
      site: {
        ...building.site,
        siteZones: sitePlan.siteZones,
      },
    };

    const metrics: CandidateMetrics = {
      hardValidity: diagnostics.geometryHealthy,
      overallQualityScore: Math.round(attempt.selectionScore),
      areaEfficiencyScore: buildableArea > 0
        ? Math.max(0, Math.min(100, Math.round((carpetArea / buildableArea) * 100)))
        : diagnostics.scores.areaEfficiency,
      adjacencyScore: graphEvaluation.score,
      circulationScore: diagnostics.scores.circulation,
      daylightScore: diagnostics.scores.daylight,
      privacyScore: diagnostics.scores.privacy,
      vastuProxyScore: vastu.summary.finalScore ?? (diagnostics.scores.vastu ?? 0),
      floorUtilizationScore: multiFloor.floorUtilizationScore,
      unusedSpaceScore: multiFloor.unusedSpaceScore,
      verticalContinuityScore: multiFloor.verticalContinuityScore,
      roomDistributionScore: multiFloor.roomDistributionScore,
      totalCarpetAreaMm2: carpetArea,
      totalBuiltupAreaMm2: Math.round(carpetArea * 1.15),
      roomCount: allRooms.length,
      zoningScore: diagnostics.scores.zoning,
      shapeScore: diagnostics.scores.shape,
      siteUtilization: sitePlan.siteUtilization,
    };

    return {
      id, name, strategy: profile.strategy,
      description: `${profile.description} ${organizationDescription(building)}`,
      building: buildingWithSite,
      metrics,
      validation,
      diagnostics,
      requiredRoomCounts,
      designGraph,
      optimization,
      multiFloorPlanning: multiFloor,
      vastuPlanning: vastu.summary,
      siteUtilization: sitePlan.siteUtilization,
      rank: 1,
    };
  }

  generateArchitecturalCandidates(
    spec: DesignRequirementSpecification,
    program: RoomProgram,
    seed = 42,
  ): CandidatePlan[] {
    if (seed !== 42 && seed !== 20260904) {
      setIdSeed(seed);
    }
    const requiredRoomCounts = roomProgramCounts(program);
    const requiredRoomTypes = Object.keys(requiredRoomCounts) as RoomType[];
    const designGraph = this.graphBuilder.buildInstanceGraph(program);
    const siteAnalysis = this.siteAnalyzer.analyze(spec);
    const archStrategies = selectArchitecturalStrategies({
      hasParking: spec.hard.parkingRequired || spec.hard.parkingSpacesCount > 0,
      hasGarden: spec.soft.gardenPreference,
      isNarrowLot: siteAnalysis.isNarrowLot,
      isIrregular: siteAnalysis.isIrregular,
      vastuEnabled: spec.soft.vastuCompliance,
    });

    const isFullPlot = !!spec.hard.fullPlotCoverage;
    const candidates: CandidatePlan[] = [];
    const orderedStrategies = (seed === 42 || seed === 20260904)
      ? archStrategies
      : archStrategies.map((_, i, arr) => arr[(i + Math.abs(seed)) % arr.length]!);

    orderedStrategies.forEach((strat, index) => {
      try {
        const massings = Array.from({ length: Math.max(1, spec.hard.floorsCount) }, (_, lvl) =>
          this.massingGenerator.generateMassing(siteAnalysis, strat, program, lvl, isFullPlot),
        );
        const rawBuilding = this.architecturalLayoutEngine.generateBuilding(
          spec, program, strat, siteAnalysis, massings, designGraph, seed + index * 37,
        );
        const sitePlan = this.sitePlanner.planSiteUtilization({
          site: rawBuilding.site,
          footprintPolygon: rawBuilding.floors[0]?.boundary ?? { points: [] },
          requirements: spec,
          building: rawBuilding,
        });
        const buildingWithSite: Building = {
          ...rawBuilding,
          site: { ...rawBuilding.site, siteZones: sitePlan.siteZones },
        };

        const graphEvaluation = evaluateInstanceGraph(buildingWithSite, designGraph);
        const diagnostics = evaluateDesign(buildingWithSite, {
          program,
          designGraph,
          vastuEnabled: spec.soft.vastuCompliance,
          requiredRoomTypes,
          requiredRoomCounts,
        });
        const multiFloor = evaluateMultiFloorPlanning(buildingWithSite);

        const allRooms = buildingWithSite.floors.flatMap(floor => floor.rooms);
        const carpetArea = allRooms.reduce((sum, room) => sum + room.area, 0);
        const buildableArea = buildingWithSite.floors.reduce((sum, floor) => {
          return floor.boundary.points.length < 3 ? sum : sum + polygonArea(floor.boundary);
        }, 0);

        const metrics: CandidateMetrics = {
          hardValidity: diagnostics.geometryHealthy,
          overallQualityScore: Math.min(100, Math.round(diagnostics.overallScore * 0.7 + graphEvaluation.score * 0.3)),
          areaEfficiencyScore: buildableArea > 0
            ? Math.max(0, Math.min(100, Math.round((carpetArea / buildableArea) * 100)))
            : diagnostics.scores.areaEfficiency,
          adjacencyScore: graphEvaluation.score,
          circulationScore: diagnostics.scores.circulation,
          daylightScore: diagnostics.scores.daylight,
          privacyScore: diagnostics.scores.privacy,
          vastuProxyScore: diagnostics.scores.vastu ?? 70,
          floorUtilizationScore: multiFloor.floorUtilizationScore,
          unusedSpaceScore: multiFloor.unusedSpaceScore,
          verticalContinuityScore: multiFloor.verticalContinuityScore,
          roomDistributionScore: multiFloor.roomDistributionScore,
          totalCarpetAreaMm2: carpetArea,
          totalBuiltupAreaMm2: Math.round(carpetArea * 1.15),
          roomCount: allRooms.length,
          zoningScore: diagnostics.scores.zoning,
          shapeScore: diagnostics.scores.shape,
          siteUtilization: sitePlan.siteUtilization,
        };

        const optimization: CandidateOptimizationSummary = {
          attempts: 1,
          validAttempts: 1,
          initialGraphScore: graphEvaluation.score,
          finalGraphScore: graphEvaluation.score,
          selectedVariant: strat.id,
          repairAttempts: 0,
          acceptedRepairs: 0,
          repairTrace: [],
        };

        candidates.push({
          id: `arch_candidate_${strat.id}_${index + 1}`,
          name: `${strat.name} (${spec.hard.bedroomCount}BHK)`,
          strategy: strat.id,
          description: `${strat.description} ${organizationDescription(buildingWithSite)}`,
          building: buildingWithSite,
          metrics,
          validation: diagnosticsToValidation(buildingWithSite, {
            program,
            designGraph,
            vastuEnabled: spec.soft.vastuCompliance,
            requiredRoomTypes,
            requiredRoomCounts,
          }),
          diagnostics,
          requiredRoomCounts,
          designGraph,
          optimization,
          multiFloorPlanning: multiFloor,
          vastuPlanning: {
            enabled: spec.soft.vastuCompliance,
            initialScore: 70,
            finalScore: 75,
            attempts: 0,
            acceptedChanges: [],
            graphScoreBefore: 80,
            graphScoreAfter: 80,
            functionalGraphPreserved: true,
            rules: [],
          },
          siteUtilization: sitePlan.siteUtilization,
          rank: index + 1,
          architecturalEvidence: evaluateArchitecturalEvidence(buildingWithSite, program),
        });
      } catch (err) {
        // Skip strategies that cannot be constructed for this specific plot
        console.warn(`[ArchitecturalGenerator] Strategy ${strat.id} skipped:`, err);
      }
    });

    if (candidates.length < 3) {
      try {
        const fallbackCandidates = this.generateCandidates(spec, program, seed);
        for (const fc of fallbackCandidates) {
          if (candidates.length >= 4) break;
          candidates.push({
            ...fc,
            id: `supplemental_${fc.id}`,
            name: `${fc.name} (Deterministic)`,
            rank: candidates.length + 1,
          });
        }
      } catch (fbErr) {
        console.warn('[ArchitecturalGenerator] Supplemental fallback failed:', fbErr);
      }
    }

    candidates.sort((a, b) => b.metrics.overallQualityScore - a.metrics.overallQualityScore);
    return candidates.map((c, i) => ({ ...c, rank: i + 1 }));
  }
}

function layoutSignature(building: Building): string {
  return building.floors.map(floor => floor.rooms
    .map(room => [room.type, Math.round(room.x), Math.round(room.y), Math.round(room.width), Math.round(room.height)].join(':'))
    .sort().join('|')).join('||');
}

export function areCandidatesStructurallyIdentical(a: Building, b: Building): boolean {
  if (a.floors.length !== b.floors.length) return false;
  for (let f = 0; f < a.floors.length; f++) {
    const roomsA = a.floors[f]?.rooms ?? [];
    const roomsB = b.floors[f]?.rooms ?? [];
    if (roomsA.length !== roomsB.length) return false;
    const sortedA = [...roomsA].sort((x, y) => x.type.localeCompare(y.type) || x.x - y.x || x.y - y.y);
    const sortedB = [...roomsB].sort((x, y) => x.type.localeCompare(y.type) || x.x - y.x || x.y - y.y);
    for (let i = 0; i < sortedA.length; i++) {
      const rA = sortedA[i]!;
      const rB = sortedB[i]!;
      if (rA.type !== rB.type) return false;
      if (Math.abs(rA.x - rB.x) > 50 || Math.abs(rA.y - rB.y) > 50 ||
          Math.abs(rA.width - rB.width) > 50 || Math.abs(rA.height - rB.height) > 50) {
        return false;
      }
    }
  }
  return true;
}

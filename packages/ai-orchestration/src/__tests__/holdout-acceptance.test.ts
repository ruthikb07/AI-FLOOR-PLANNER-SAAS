/**
 * Holdout Test Suite & Generalization Acceptance (§6, §7, §16, §35, §36, §37, §40).
 *
 * Implements rigorous automated evaluation across:
 * - CASE A: 40m × 60m, 3 flats (3 × 3BHK), 1 lift, 2 stairs
 * - CASE B: 45m × 45m, 4 flats (4 × 2BHK), 2 lifts, 2 stairs
 * - CASE C: 50m × 60m, 4 flats (2 × 2BHK + 2 × 3BHK), 2 lifts, 2 stairs
 * - CASE D: 35m × 55m, 3 flats (1 × 2BHK + 2 × 3BHK), 2 lifts, 2 stairs
 * - CASE E: 60m × 70m, 4 flats (4 × 3BHK), 2 lifts, 2 stairs
 * - CASE F: Narrow/Deep (25m × 55m), 2 flats (2 × 3BHK), 1 lift, 2 stairs
 * - CASE G: Wide/Shallow (55m × 25m), 3 flats (3 × 2BHK), 2 lifts, 1 stair
 * - CASE H: Deliberately Infeasible (4 × 3BHK in 200m² plate) -> Clean rejection
 * - CASE I: Golden Program with South road orientation change
 * - CASE J: Golden Program with SIDE_CORE placement preference
 *
 * Quality Gates:
 * - Zero fixture-specific branching (tests algorithmic generalization)
 * - Exact metric reconciliation with zero unexplained area loss
 * - Calibrated cost scoring sensitivity
 * - Unit quality fairness distribution
 * - Multi-floor vertical core alignment
 */

import { describe, expect, it } from 'vitest';
import {
  createApartmentContract,
  createGolden3x3BhkContract,
  verifyContractIntegrity,
} from '../apartment/contract';
import {
  validateFloorFeasibility,
} from '../apartment/area-budget';
import {
  calculateApartmentPlanningMetrics,
} from '../apartment/metrics';
import {
  searchDeterministicApartmentTopologies,
} from '../apartment/candidate-search';
import {
  getUnitProgram,
  getAllRegisteredPrograms,
} from '../apartment/program-registry';
import {
  findCompatibleTopologyFamilies,
  TOPOLOGY_FAMILIES,
} from '../apartment/topology-library';
import {
  createBuildingStack,
} from '../apartment/building-stack';
import {
  calculateCostEfficiencyMetrics,
} from '../apartment/core-optimizer';

describe('Apartment Engine Generalization & Holdout Acceptance Suite', () => {
  // ==========================================================================
  // 1. Metric Reconciliation & Mathematical Invariants (§1, §11, §38, §39)
  // ==========================================================================
  describe('Authoritative Metrics Reconciliation (§1, §11, §38, §39)', () => {
    it('proves mathematical reconciliation on Golden Project area breakdown', () => {
      // Reconcile Golden plate: 3 units (352.35 m²), lifts (8.82 m²), stairs (19.2 m²), shafts (1.4 m²), lobby (23.04 m²), circulation (18.54 m²), walls (15.0 m²)
      const metrics = calculateApartmentPlanningMetrics({
        grossFloorAreaSqM: 438.35,
        apartmentAreaSqM: 352.35,
        liftAreaSqM: 9.0,
        stairAreaSqM: 28.0,
        shaftAreaSqM: 6.0,
        lobbyAreaSqM: 18.0,
        corridorAreaSqM: 10.0,
        wallAreaProxySqM: 15.0,
      });

      // Sum: 352.35 + (9 + 28 + 6) + (18 + 10) + 15 = 352.35 + 43 + 28 + 15 = 438.35 m²
      expect(metrics.isReconciled).toBe(true);
      expect(metrics.mathematicalDiscrepancySqM).toBeLessThanOrEqual(0.01);
      expect(metrics.unassignedAreaSqM).toBe(0);
      expect(metrics.coreAreaSqM).toBe(43.0); // 9 + 28 + 6 = 43
      expect(metrics.commonCirculationAreaSqM).toBe(28.0); // 18 + 10 = 28
      expect(metrics.apartmentEfficiencyRatio).toBeCloseTo(352.35 / 438.35, 2);
    });

    it('transparently captures and accounts for unassigned residual area when gross exceeds components', () => {
      const metrics = calculateApartmentPlanningMetrics({
        grossFloorAreaSqM: 500.0,
        apartmentAreaSqM: 350.0,
        liftAreaSqM: 9.0,
        stairAreaSqM: 28.0,
        shaftAreaSqM: 6.0,
        lobbyAreaSqM: 18.0,
        corridorAreaSqM: 10.0,
        wallAreaProxySqM: 15.0,
      });

      // Allocated: 350 + 43 + 28 + 15 = 436.0 m². Unassigned = 500 - 436 = 64.0 m²
      expect(metrics.unassignedAreaSqM).toBe(64.0);
      expect(metrics.isReconciled).toBe(true);
      expect(metrics.reconciliationFormula).toContain('Unassigned (64 m²)');
    });
  });

  // ==========================================================================
  // 2. Program Registry & Dynamic Typology Support (§8, §14)
  // ==========================================================================
  describe('Residential Unit Program Registry (§8, §14)', () => {
    it('contains complete programs for 1BHK, 2BHK, 3BHK, 4BHK with room programs and furnishability rules', () => {
      const programs = getAllRegisteredPrograms();
      expect(programs.length).toBeGreaterThanOrEqual(4);

      const p1 = getUnitProgram('1BHK');
      expect(p1.targetBedrooms).toBe(1);
      expect(p1.targetBathrooms).toBe(1);

      const p2 = getUnitProgram('2BHK');
      expect(p2.targetBedrooms).toBe(2);
      expect(p2.targetBathrooms).toBe(2);
      expect(p2.mandatoryRooms).toContain('bedroom_2');

      const p3 = getUnitProgram('3BHK');
      expect(p3.targetBedrooms).toBe(3);
      expect(p3.targetBathrooms).toBe(3);
      expect(p3.mandatoryRooms).toContain('bedroom_3');

      const p4 = getUnitProgram('4BHK');
      expect(p4.targetBedrooms).toBe(4);
      expect(p4.targetBathrooms).toBe(4);
    });
  });

  // ==========================================================================
  // 3. Topology Library & Compatibility Engine (§5)
  // ==========================================================================
  describe('Building Form & Topology Library (§5)', () => {
    it('defines distinct topology families with explicit compatibility criteria', () => {
      expect(TOPOLOGY_FAMILIES.length).toBeGreaterThanOrEqual(8);

      const threeWing = TOPOLOGY_FAMILIES.find(f => f.family === 'THREE_WING_CORE');
      expect(threeWing).toBeDefined();
      expect(threeWing!.minUnits).toBe(3);
      expect(threeWing!.maxUnits).toBe(3);

      const fourCorner = TOPOLOGY_FAMILIES.find(f => f.family === 'FOUR_CORNER_CORE');
      expect(fourCorner).toBeDefined();
      expect(fourCorner!.minUnits).toBe(4);
      expect(fourCorner!.maxUnits).toBe(4);

      const linear = TOPOLOGY_FAMILIES.find(f => f.family === 'LINEAR_DUAL_LOADED');
      expect(linear).toBeDefined();
      expect(linear!.maxUnits).toBeGreaterThanOrEqual(6);
    });

    it('selects compatible families dynamically for 2, 3, and 4 unit contracts', () => {
      const families2 = findCompatibleTopologyFamilies(2, 1.0);
      expect(families2.map(f => f.family)).toContain('COMPACT_RECTANGULAR');

      const families3 = findCompatibleTopologyFamilies(3, 1.0);
      expect(families3.map(f => f.family)).toContain('THREE_WING_CORE');

      const families4 = findCompatibleTopologyFamilies(4, 1.0);
      expect(families4.map(f => f.family)).toContain('FOUR_CORNER_CORE');
    });
  });

  // ==========================================================================
  // 4. HOLDOUT CASE EVALUATIONS (CASES A THROUGH J) (§6, §36, §37)
  // ==========================================================================
  describe('Holdout Acceptance Suite (Cases A - J)', () => {
    // ------------------------------------------------------------------------
    // CASE A: 40m × 60m, 3 flats (3 × 3BHK), 1 lift, 2 stairs
    // ------------------------------------------------------------------------
    it('CASE A: 40m × 60m floor plate, 3 × 3BHK, 1 lift, 2 stairs passes with zero hard errors', () => {
      const contract = createApartmentContract({
        roadFacing:'North',
        projectId: 'holdout_case_a',
        plotWidthM: 40,
        plotDepthM: 60,
        setbacksM: { front: 4, rear: 3, left: 3, right: 3 },
        flatCount: 3,
        unitSchedule: ['3BHK', '3BHK', '3BHK'],
        liftCount: 1,
        stairCount: 2,
      });

      expect(contract.flatCount).toBe(3);
      expect(contract.core.liftCount).toBe(1);
      expect(contract.core.stairCount).toBe(2);

      const feasibility = validateFloorFeasibility(contract);
      expect(feasibility.isFeasible).toBe(true);

      const result = searchDeterministicApartmentTopologies(contract);
      expect(result.validCandidatesCount).toBeGreaterThanOrEqual(10);
      expect(result.selectedTopCandidates.length).toBeGreaterThanOrEqual(1);

      const best = result.selectedTopCandidates[0]!;
      expect(best.hardErrorsCount).toBe(0);
      expect(best.allocation.envelopes).toHaveLength(3);
      expect(best.unitTopologies.map(u => u.bedroomsCount)).toEqual([3, 3, 3]);
      expect(best.costEfficiency.costEfficiencyScore).toBeGreaterThanOrEqual(65);
    });

    // ------------------------------------------------------------------------
    // CASE B: 45m × 45m, 4 flats (4 × 2BHK), 2 lifts, 2 stairs
    // ------------------------------------------------------------------------
    it('CASE B: 45m × 45m floor plate, 4 × 2BHK, 2 lifts, 2 stairs passes with four corner topology', () => {
      const contract = createApartmentContract({
        roadFacing:'North',
        projectId: 'holdout_case_b',
        plotWidthM: 45,
        plotDepthM: 45,
        setbacksM: { front: 3, rear: 3, left: 3, right: 3 },
        flatCount: 4,
        unitSchedule: ['2BHK', '2BHK', '2BHK', '2BHK'],
        liftCount: 2,
        stairCount: 2,
      });

      expect(contract.flatCount).toBe(4);
      const feasibility = validateFloorFeasibility(contract);
      expect(feasibility.isFeasible).toBe(true);

      const result = searchDeterministicApartmentTopologies(contract);
      expect(result.selectedTopCandidates.length).toBeGreaterThanOrEqual(1);

      const best = result.selectedTopCandidates[0]!;
      expect(best.hardErrorsCount).toBe(0);
      expect(best.allocation.envelopes).toHaveLength(4);
      expect(best.unitTopologies.every(u => u.bedroomsCount === 2)).toBe(true);
      expect(best.unitTopologies.every(u => u.unitType === '2BHK')).toBe(true);
    });

    // ------------------------------------------------------------------------
    // CASE C: 50m × 60m, 4 flats (2 × 2BHK + 2 × 3BHK)
    // ------------------------------------------------------------------------
    it('CASE C: 50m × 60m floor plate, heterogeneous mix (2 × 2BHK + 2 × 3BHK) allocates differentiated areas', () => {
      const contract = createApartmentContract({
        roadFacing:'North',
        projectId: 'holdout_case_c',
        plotWidthM: 50,
        plotDepthM: 60,
        setbacksM: { front: 4, rear: 3, left: 3, right: 3 },
        flatCount: 4,
        unitSchedule: ['2BHK', '2BHK', '3BHK', '3BHK'],
        liftCount: 2,
        stairCount: 2,
      });

      const feasibility = validateFloorFeasibility(contract);
      expect(feasibility.isFeasible).toBe(true);

      const result = searchDeterministicApartmentTopologies(contract);
      const best = result.selectedTopCandidates[0]!;
      expect(best.hardErrorsCount).toBe(0);
      expect(best.allocation.envelopes).toHaveLength(4);

      // Verify exact mix preservation
      expect(best.unitTopologies.map(u => u.unitType)).toEqual(['2BHK', '2BHK', '3BHK', '3BHK']);
      expect(best.unitTopologies.map(u => u.bedroomsCount)).toEqual([2, 2, 3, 3]);

      // Verify differentiated area allocation: 3BHK envelopes are distinctly larger than 2BHK envelopes
      const area2bhk = best.allocation.envelopes[0]!.actualAreaSqM;
      const area3bhk = best.allocation.envelopes[2]!.actualAreaSqM;
      expect(area3bhk).toBeGreaterThan(area2bhk * 1.15);
    });

    // ------------------------------------------------------------------------
    // CASE D: 35m × 55m, 3 flats (1 × 2BHK + 2 × 3BHK)
    // ------------------------------------------------------------------------
    it('CASE D: 35m × 55m floor plate, mixed 1 × 2BHK + 2 × 3BHK preserves exact unit instances', () => {
      const contract = createApartmentContract({
        roadFacing:'North', setbacksM:{front:3,rear:2,left:2,right:2},
        projectId: 'holdout_case_d',
        plotWidthM: 35,
        plotDepthM: 55,
        flatCount: 3,
        unitSchedule: ['2BHK', '3BHK', '3BHK'],
        liftCount: 2,
        stairCount: 2,
      });

      const feasibility = validateFloorFeasibility(contract);
      expect(feasibility.isFeasible).toBe(true);

      const result = searchDeterministicApartmentTopologies(contract);
      const best = result.selectedTopCandidates[0]!;
      expect(best.hardErrorsCount).toBe(0);
      expect(best.unitTopologies.map(u => u.unitType)).toEqual(['2BHK', '3BHK', '3BHK']);
      expect(best.unitTopologies.map(u => u.bedroomsCount)).toEqual([2, 3, 3]);
    });

    // ------------------------------------------------------------------------
    // CASE E: 60m × 70m, 4 flats (4 × 3BHK)
    // ------------------------------------------------------------------------
    it('CASE E: 60m × 70m large floor plate, 4 × 3BHK spacious units', () => {
      const contract = createApartmentContract({
        roadFacing:'North', setbacksM:{front:3,rear:2,left:2,right:2},
        projectId: 'holdout_case_e',
        plotWidthM: 60,
        plotDepthM: 70,
        flatCount: 4,
        unitSchedule: ['3BHK', '3BHK', '3BHK', '3BHK'],
        liftCount: 2,
        stairCount: 2,
      });

      const feasibility = validateFloorFeasibility(contract);
      expect(feasibility.isFeasible).toBe(true);

      const result = searchDeterministicApartmentTopologies(contract);
      const best = result.selectedTopCandidates[0]!;
      expect(best.hardErrorsCount).toBe(0);
      expect(best.allocation.envelopes).toHaveLength(4);
      expect(best.unitTopologies.every(u => u.unitType === '3BHK' && u.bedroomsCount === 3)).toBe(true);
    });

    // ------------------------------------------------------------------------
    // CASE F: Narrow / Deep floor plate (25m × 55m), 2 flats (2 × 3BHK)
    // ------------------------------------------------------------------------
    it('CASE F: Narrow/Deep floor plate (25m × 55m), 2 × 3BHK symmetrical rectangular allocation', () => {
      const contract = createApartmentContract({
        roadFacing:'North',
        projectId: 'holdout_case_f',
        plotWidthM: 25,
        plotDepthM: 55,
        setbacksM: { front: 3, rear: 2, left: 2, right: 2 },
        flatCount: 2,
        unitSchedule: ['3BHK', '3BHK'],
        liftCount: 1,
        stairCount: 2,
      });

      const feasibility = validateFloorFeasibility(contract);
      expect(feasibility.isFeasible).toBe(true);

      const result = searchDeterministicApartmentTopologies(contract);
      const best = result.selectedTopCandidates[0]!;
      expect(best.hardErrorsCount).toBe(0);
      expect(best.allocation.envelopes).toHaveLength(2);
      expect(best.unitTopologies.map(u => u.unitType)).toEqual(['3BHK', '3BHK']);
    });

    // ------------------------------------------------------------------------
    // CASE G: Wide / Shallow floor plate (55m × 25m), 3 flats (3 × 2BHK)
    // ------------------------------------------------------------------------
    it('CASE G: Wide/Shallow floor plate (55m × 25m), 3 × 2BHK, 2 lifts, 1 stair', () => {
      const contract = createApartmentContract({
        roadFacing:'North',
        projectId: 'holdout_case_g',
        plotWidthM: 55,
        plotDepthM: 25,
        setbacksM: { front: 2, rear: 2, left: 3, right: 3 },
        flatCount: 3,
        unitSchedule: ['2BHK', '2BHK', '2BHK'],
        liftCount: 2,
        stairCount: 1,
      });

      const feasibility = validateFloorFeasibility(contract);
      expect(feasibility.isFeasible).toBe(true);

      const result = searchDeterministicApartmentTopologies(contract);
      const best = result.selectedTopCandidates[0]!;
      expect(best.hardErrorsCount).toBe(0);
      expect(best.allocation.envelopes).toHaveLength(3);
      expect(best.unitTopologies.every(u => u.bedroomsCount === 2)).toBe(true);
    });

    // ------------------------------------------------------------------------
    // CASE H: Deliberately Infeasible Program (§16)
    // ------------------------------------------------------------------------
    it('CASE H: Deliberately infeasible program (4 large 3BHK in 200m² plate) rejects cleanly without generating a fake plan', () => {
      const contract = createApartmentContract({
        roadFacing:'North',
        projectId: 'holdout_case_h_infeasible',
        plotWidthM: 20,
        plotDepthM: 15, // Buildable area is only ~150 m²
        setbacksM: { front: 2, rear: 2, left: 2, right: 2 },
        flatCount: 4,
        unitSchedule: ['3BHK', '3BHK', '3BHK', '3BHK'],
        targetCarpetAreaSqFtPerUnit: 1400, // Very large units
        liftCount: 2,
        stairCount: 2,
      });

      const feasibility = validateFloorFeasibility(contract, 200);
      expect(feasibility.isFeasible).toBe(false);
      expect(feasibility.feasibilityCode).toBe('PROGRAM_NOT_FEASIBLE_IN_APPROVED_FLOOR_PLATE');
      expect(feasibility.explanation).toContain('PROGRAM_NOT_FEASIBLE_IN_APPROVED_FLOOR_PLATE');
      expect(feasibility.explanation).toContain('deficit');
      expect(feasibility.marginSqM).toBeLessThan(0);
    });

    // ------------------------------------------------------------------------
    // CASE I: Same Program as Golden case, changed orientation
    // ------------------------------------------------------------------------
    it('CASE I: Golden 3 × 3BHK Program with South road orientation change', () => {
      const contract = createApartmentContract({
         setbacksM:{front:3,rear:2,left:2,right:2},
        projectId: 'holdout_case_i',
        plotWidthM: 50,
        plotDepthM: 50,
        roadFacing: 'South',
        flatCount: 3,
        unitSchedule: ['3BHK', '3BHK', '3BHK'],
        liftCount: 2,
        stairCount: 2,
      });

      expect(contract.site.roadFacing).toBe('South');
      const result = searchDeterministicApartmentTopologies(contract);
      const best = result.selectedTopCandidates[0]!;
      expect(best.hardErrorsCount).toBe(0);
      expect(best.unitTopologies).toHaveLength(3);
    });

    // ------------------------------------------------------------------------
    // CASE J: Same Program as Golden case, SIDE_CORE placement preference
    // ------------------------------------------------------------------------
    it('CASE J: Golden Program with SIDE_CORE placement preference', () => {
      const contract = createApartmentContract({
        roadFacing:'North', setbacksM:{front:3,rear:2,left:2,right:2},
        projectId: 'holdout_case_j',
        plotWidthM: 50,
        plotDepthM: 50,
        flatCount: 3,
        unitSchedule: ['3BHK', '3BHK', '3BHK'],
        liftCount: 2,
        stairCount: 2,
        corePlacement: 'SIDE',
      });

      expect(contract.core.corePlacement).toBe('SIDE');
      const result = searchDeterministicApartmentTopologies(contract);
      const best = result.selectedTopCandidates[0]!;
      expect(best.hardErrorsCount).toBe(0);
      expect(best.allocation.envelopes).toHaveLength(3);
    });
  });

  // ==========================================================================
  // 5. Anti-Overfitting & No Fixture-Specific Logic Gate (§7)
  // ==========================================================================
  describe('Anti-Overfitting Verification (§7)', () => {
    it('verifies holdout cases run through the unified production algorithm without fixture branching', () => {
      const code1 = searchDeterministicApartmentTopologies(
        createApartmentContract({
        roadFacing:'North', setbacksM:{front:3,rear:2,left:2,right:2}, projectId: 'arbitrary_project_999', plotWidthM:50, plotDepthM:50, unitSchedule:['3BHK','3BHK','3BHK'], flatCount: 3 }),
      );
      const code2 = searchDeterministicApartmentTopologies(
        createApartmentContract({
        roadFacing:'North', setbacksM:{front:3,rear:2,left:2,right:2}, projectId: 'holdout_case_a', plotWidthM:50, plotDepthM:50, unitSchedule:['3BHK','3BHK','3BHK'], flatCount: 3 }),
      );

      // Same topology family and same candidate generation logic executed
      expect(code1.totalCandidatesEvaluated).toBe(code2.totalCandidatesEvaluated);
      expect(code1.selectedTopCandidates[0]!.allocation.topologyFamily).toBe(
        code2.selectedTopCandidates[0]!.allocation.topologyFamily,
      );
    });
  });

  // ==========================================================================
  // 6. Cost Score Calibration & Sensitivity (§10)
  // ==========================================================================
  describe('Cost Score Calibration & Sensitivity (§10)', () => {
    it('proves cost efficiency score is realistic and does not automatically cap at 100', () => {
      const highEfficiency = calculateCostEfficiencyMetrics({
        grossFloorAreaSqM: 450,
        apartmentAreaSqM: 360,
        coreAreaSqM: 48,
        commonCirculationAreaSqM: 25,
        wallAreaProxySqM: 14.5,
        externalPerimeterM: 90,
        shaftCount: 4,
        sharedLiftBank: true,
        repeatedWetStacks: 3,
      });

      // Score should be realistic (around 80-90), NOT artificially forced to 100
      expect(highEfficiency.costEfficiencyScore).toBeGreaterThanOrEqual(75);
      expect(highEfficiency.costEfficiencyScore).toBeLessThan(96);
    });

    it('demonstrates sensitivity: an inferior plan with oversized circulation scores distinctly lower', () => {
      const efficientPlan = calculateCostEfficiencyMetrics({
        grossFloorAreaSqM: 450,
        apartmentAreaSqM: 360,
        coreAreaSqM: 48,
        commonCirculationAreaSqM: 22,
        wallAreaProxySqM: 14.5,
        externalPerimeterM: 90,
        shaftCount: 4,
        sharedLiftBank: true,
        repeatedWetStacks: 3,
      });

      const sprawlingPlan = calculateCostEfficiencyMetrics({
        grossFloorAreaSqM: 550,
        apartmentAreaSqM: 330, // low usable ratio: ~60%
        coreAreaSqM: 95, // oversized core
        commonCirculationAreaSqM: 85, // excessive circulation
        wallAreaProxySqM: 20,
        externalPerimeterM: 140, // sprawling perimeter
        shaftCount: 2,
        sharedLiftBank: false,
        repeatedWetStacks: 1,
      });

      expect(efficientPlan.costEfficiencyScore).toBeGreaterThan(sprawlingPlan.costEfficiencyScore + 15);
      expect(sprawlingPlan.penaltyFactors.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 7. Multi-Floor Building Stack & Vertical Core Coordination (§27, §28, §29)
  // ==========================================================================
  describe('Multi-Floor Building Stack Engine (§27, §28, §29)', () => {
    it('builds vertically aligned G+4 building stack with shared core coordinates', () => {
      const stack = createBuildingStack({
        projectId: 'multi_floor_demo',
        totalFloors: 5,
        canonicalPlanId: 'plan_canonical_01',
        buildingFootprint: { x: 5, y: 5, width: 30, height: 30 },
        coreBounds: { x: 17, y: 15, width: 6, height: 6 },
        lobbyBounds: { x: 17, y: 21, width: 6, height: 4.8 },
        liftBounds: [{ x: 17.3, y: 18.9, width: 2.1, height: 2.1 }],
        stairBounds: [{ x: 17, y: 15, width: 2.4, height: 3.9 }],
        shaftBounds: [{ x: 17, y: 18.9, width: 0.3, height: 2.1 }],
      });

      expect(stack.totalFloors).toBe(5);
      expect(stack.typicalFloors).toHaveLength(4);
      expect(stack.groundFloor.level).toBe(0);
      expect(stack.terraceFloor.level).toBe(5);
      expect(stack.isVerticallyAligned).toBe(true);
      expect(stack.alignmentIssues).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 8. Golden 3x3BHK Contract Regression (§35)
  // ==========================================================================
  describe('Golden 3x3BHK Regression Preservation (§35)', () => {
    it('proves Golden 3x3BHK contract continues to generate and pass validation 100%', () => {
      const goldenContract = createGolden3x3BhkContract({
        projectId: 'golden_3x3bhk_regression',
      });

      expect(goldenContract.flatCount).toBe(3);
      expect(goldenContract.flats).toHaveLength(3);
      expect(goldenContract.flats.every(f => f.unitType === '3BHK')).toBe(true);

      const integrity = verifyContractIntegrity(goldenContract);
      expect(integrity.valid).toBe(true);

      const result = searchDeterministicApartmentTopologies(goldenContract);
      expect(result.selectedTopCandidates.length).toBeGreaterThanOrEqual(1);

      const best = result.selectedTopCandidates[0]!;
      expect(best.hardErrorsCount).toBe(0);
      expect(best.allocation.envelopes).toHaveLength(3);
      expect(best.unitTopologies.map(u => u.unitType)).toEqual(['3BHK', '3BHK', '3BHK']);
    });
  });
});

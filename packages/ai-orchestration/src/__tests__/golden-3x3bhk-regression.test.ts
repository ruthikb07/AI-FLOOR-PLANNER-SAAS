import { describe, expect, it } from 'vitest';
import {
  create3x3BhkApartmentContract,
  computeApartmentContractHash,
  verifyContractIntegrity,
} from '../apartment/contract';
import {
  validate3x3BhkFloorFeasibility,
} from '../apartment/area-budget';
import {
  generateCoreConfigurations,
  calculateCostEfficiencyMetrics,
} from '../apartment/core-optimizer';
import { solve3ApartmentEnvelopes } from '../apartment/envelope-solver';
import { solve3BhkUnitTopology } from '../apartment/unit-topology-solver';
import { searchDeterministic3x3BhkTopologies } from '../apartment/candidate-search';
import { generateDeterministicApartmentSchematic } from '../apartment/schematic';
import { getApartmentRulesProfile } from '../apartment/jurisdiction';

describe('Golden 3 × 3BHK Apartment Regression Suite (Section 43)', () => {
  const contract = create3x3BhkApartmentContract();
  const rulesProfile = getApartmentRulesProfile('pune_pmc');

  // 1. Contract & Invariants
  describe('Immutable Golden Contract', () => {
    it('3 requested flats -> exactly 3 envelopes and all units = 3BHK', () => {
      expect(contract.flatCount).toBe(3);
      expect(contract.flats).toHaveLength(3);
      expect(contract.flats.every(f => f.unitType === '3BHK')).toBe(true);
      expect(contract.flats.map(f => f.unitId)).toEqual(['FLAT_01', 'FLAT_02', 'FLAT_03']);
    });

    it('contract hash is stable across multiple computations', () => {
      const hash1 = computeApartmentContractHash(contract);
      const hash2 = computeApartmentContractHash(contract);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);

      const verification = verifyContractIntegrity(contract, hash1);
      expect(verification.valid).toBe(true);
      expect(verification.tamperIssues).toHaveLength(0);
    });

    it('detects tampering if flat count or unit type is altered', () => {
      const hash = computeApartmentContractHash(contract);
      const tampered = {
        ...contract,
        flatCount: 4 as never,
      };
      const verification = verifyContractIntegrity(tampered, hash);
      expect(verification.valid).toBe(false);
      expect(verification.tamperIssues.some((i: string) => i.includes('flatCount'))).toBe(true);
    });
  });

  // 2. Deterministic feasibility gate
  describe('Deterministic Feasibility Gate', () => {
    it('proves 3x3BHK fits a 50x50m site', () => {
      const feasibility = validate3x3BhkFloorFeasibility(contract);
      expect(feasibility.isFeasible).toBe(true);
      expect(feasibility.floorPlateAvailableSqM).toBeGreaterThanOrEqual(feasibility.totalFloorPlateRequiredSqM);
      expect(feasibility.marginSqM).toBeGreaterThan(0);
    });

    it('rejects an infeasible program with PROGRAM_NOT_FEASIBLE_IN_APPROVED_FLOOR_PLATE', () => {
      // Artificially tiny floor plate of 200 m² (needs ~485 m²)
      const feasibility = validate3x3BhkFloorFeasibility(contract, 200);
      expect(feasibility.isFeasible).toBe(false);
      expect(feasibility.errorCode).toBe('PROGRAM_NOT_FEASIBLE_IN_APPROVED_FLOOR_PLATE');
      expect(feasibility.marginSqM).toBeLessThan(0);
    });
  });

  // 3. Apartment Envelopes & Topology
  describe('Envelope Solver & Unit Topology', () => {
    const centerPoint = {
      x: contract.site.buildableWidthM / 2,
      y: contract.site.buildableDepthM / 2,
    };
    const cores = generateCoreConfigurations(centerPoint, 2, 2);
    const allocation = solve3ApartmentEnvelopes({
      buildableWidthM: contract.site.buildableWidthM,
      buildableDepthM: contract.site.buildableDepthM,
      targetCarpetSqFtPerUnit: 1100,
      strategy: 'balanced',
      coreConfig: cores[0]!,
    });

    it('allocates exactly 3 apartment envelopes without overlap', () => {
      expect(allocation.envelopes).toHaveLength(3);
      expect(allocation.envelopes.map(e => e.unitId)).toEqual(['FLAT_01', 'FLAT_02', 'FLAT_03']);
      expect(allocation.hardErrors).toHaveLength(0);

      // Overlap check
      for (let i = 0; i < allocation.envelopes.length; i++) {
        for (let j = i + 1; j < allocation.envelopes.length; j++) {
          const a = allocation.envelopes[i]!.boundary;
          const b = allocation.envelopes[j]!.boundary;
          const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const yOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          const isOverlapping = xOverlap > 0.05 && yOverlap > 0.05;
          expect(isOverlapping).toBe(false);
        }
      }
    });

    it('every envelope connects directly to common circulation', () => {
      for (const env of allocation.envelopes) {
        expect(Boolean(env.commonLobbyConnection)).toBe(true);
        expect(env.exteriorFacades.length).toBeGreaterThan(0);
      }
    });

    it('solves internal topology for each unit with exactly three bedrooms', () => {
      for (const env of allocation.envelopes) {
        const topo = solve3BhkUnitTopology(env);
        expect(topo.bedroomsCount).toBe(3);
        expect(topo.bathroomsCount).toBeGreaterThanOrEqual(2);
        expect(topo.rooms.every(r => r.parentUnitId === env.unitId)).toBe(true);
        expect(topo.hardErrors).toHaveLength(0);
      }
    });
  });

  // 4. Cost-Efficient Core
  describe('Cost-Efficient Core & Shared Lift Bank', () => {
    const centerPoint = { x: 23, y: 23 };
    const cores = generateCoreConfigurations(centerPoint, 2, 2);

    it('compact lift-bank behavior: two lifts share lobby where appropriate', () => {
      const coreA = cores.find(c => c.id === 'CORE_A_SHARED_LIFT_BANK');
      expect(coreA).toBeDefined();
      expect(coreA!.liftBank.isSharedBank).toBe(true);
      expect(coreA!.liftBank.lifts).toHaveLength(2);
      expect(coreA!.lobbyBounds.height).toBeGreaterThanOrEqual(3.0);
    });

    it('calculates deterministic relative cost metrics', () => {
      const metrics1 = calculateCostEfficiencyMetrics({
        grossFloorAreaSqM: 485,
        apartmentAreaSqM: 388,
        coreAreaSqM: 52.5,
        commonCirculationAreaSqM: 17.6,
        wallAreaProxySqM: 14.5,
        externalPerimeterM: 110,
        shaftCount: 4,
        sharedLiftBank: true,
        repeatedWetStacks: 3,
      });

      const metrics2 = calculateCostEfficiencyMetrics({
        grossFloorAreaSqM: 485,
        apartmentAreaSqM: 388,
        coreAreaSqM: 52.5,
        commonCirculationAreaSqM: 17.6,
        wallAreaProxySqM: 14.5,
        externalPerimeterM: 110,
        shaftCount: 4,
        sharedLiftBank: true,
        repeatedWetStacks: 3,
      });

      expect(metrics1.costEfficiencyScore).toBe(metrics2.costEfficiencyScore);
      expect(metrics1.apartmentEfficiencyRatio).toBe(metrics2.apartmentEfficiencyRatio);
      expect(metrics1.apartmentEfficiencyRatio).toBeGreaterThanOrEqual(0.70);
    });
  });

  // 5. Deterministic Candidate Search
  describe('Deterministic Candidate Search (Section 18, 19)', () => {
    it('evaluates 20-40 candidates deterministically and rejects any with hard errors', () => {
      const searchResult = searchDeterministic3x3BhkTopologies(contract);
      expect(searchResult.totalCandidatesEvaluated).toBeGreaterThanOrEqual(20);
      expect(searchResult.selectedTopCandidates.length).toBeGreaterThanOrEqual(1);
      expect(searchResult.selectedTopCandidates.every(c => c.hardErrorsCount === 0)).toBe(true);
      expect(searchResult.selectedTopCandidates.every(c => c.allocation.envelopes.length === 3)).toBe(true);
    });
  });

  // 6. Schematic Generation for 3x3BHK
  describe('Deterministic Schematic Generation', () => {
    it('produces exactly 3 flats, complete 3BHK program, and zero hard issues', () => {
      const schematic = generateDeterministicApartmentSchematic({
        siteWidthM: 50,
        siteDepthM: 50,
        flatsPerFloor: 3,
        unitMix: [
          { unitType: '3BHK', count: 3, carpetAreaSqM: 102 },
        ],
        commonCoreConfig: { passengerLifts: 2, staircaseCount: 2, commonLobby: true },
        rulesProfile,
        strategy: 'balanced',
      });

      expect(schematic.flatCount).toBe(3);
      expect(schematic.units).toHaveLength(3);
      expect(schematic.units.map(u => u.unitType)).toEqual(['3BHK', '3BHK', '3BHK']);
      expect(schematic.core.lifts).toHaveLength(2);
      expect(schematic.core.stairs).toHaveLength(2);
      expect(schematic.layoutFits).toBe(true);
      expect(schematic.layoutIssues).toHaveLength(0);
      expect(schematic.spatialChecks.every(c => c.status === 'PASS')).toBe(true);
    });
  });
});

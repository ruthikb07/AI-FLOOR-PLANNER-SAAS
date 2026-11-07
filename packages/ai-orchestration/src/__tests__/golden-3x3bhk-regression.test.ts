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
import {
  compileApartmentFloorPlanImagePrompt,
} from '../orchestration/image-prompt-compiler';
import {
  evaluateApartmentPreflight,
  type ExpectedApartmentBrief,
  type DetectedApartmentFeatures,
} from '../orchestration/apartment-preflight';
import { getApartmentRulesProfile } from '../apartment/jurisdiction';
import { Direction, createBuilding } from '@ai-floor-planner/core';

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

  // 2. Feasibility Before FLUX
  describe('Deterministic Feasibility before FLUX', () => {
    it('feasibility runs before FLUX and proves 3x3BHK fits 50x50m site', () => {
      const feasibility = validate3x3BhkFloorFeasibility(contract);
      expect(feasibility.isFeasible).toBe(true);
      expect(feasibility.floorPlateAvailableSqM).toBeGreaterThanOrEqual(feasibility.totalFloorPlateRequiredSqM);
      expect(feasibility.marginSqM).toBeGreaterThan(0);
    });

    it('infeasible program never reaches FLUX (returns PROGRAM_NOT_FEASIBLE_IN_APPROVED_FLOOR_PLATE)', () => {
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

  // 7. Prompt Compiler & Reference Priority
  describe('FLUX Prompt Compiler (Section 24, 25)', () => {
    const site = createBuilding({
      projectId: 'golden-3x3bhk',
      name: 'Golden 3x3BHK',
      site: {
        plotWidth: 50000,
        plotDepth: 50000,
        plannedFloorCount: 5,
        roadFacing: Direction.North,
        setbacks: { front: 5000, rear: 4000, left: 4000, right: 4000 },
      },
      floors: [{ buildingId: '', level: 0 }],
    }).site;

    const apartmentConfig = {
      projectType: 'apartment' as const,
      jurisdiction: 'pune_pmc' as const,
      floorCount: 5,
      flatsPerFloor: 3,
      unitMix: [{ unitType: '3bhk' as const, count: 3, targetCarpetAreaSqM: 102 }],
      commonCore: {
        passengerLifts: 2,
        serviceLifts: 0,
        staircaseCount: 2,
        fireStaircaseRequired: true,
        commonLobby: true,
      },
      parking: { residentParkingCount: 6, visitorParkingCount: 2, twoWheelerParkingCount: 6, fourWheelerParkingCount: 6 },
      amenities: { groundSiteAmenities: [], buildingAmenities: [] },
      floorStrategy: 'typical' as const,
    };

    it('prepends HARD ARCHITECTURAL CONTRACT header forbidding extra flats', () => {
      const promptReq = compileApartmentFloorPlanImagePrompt({
        site,
        apartmentConfig,
        seed: 7919,
        concept: {
          candidateNumber: 1,
          candidateCount: 4,
          label: 'Concept 01',
          intent: 'Balanced 3-wing typical floor',
        },
      });

      expect(promptReq.prompt).toContain('HARD ARCHITECTURAL CONTRACT');
      expect(promptReq.prompt).toContain('EXACTLY THREE AND ONLY THREE APARTMENTS');
      expect(promptReq.prompt).toContain('FLAT 01 = 3BHK');
      expect(promptReq.prompt).toContain('FLAT 02 = 3BHK');
      expect(promptReq.prompt).toContain('FLAT 03 = 3BHK');
      expect(promptReq.prompt).toContain('DO NOT CREATE:');
      expect(promptReq.prompt).toContain('FLAT 04');
    });

    it('reference images cannot alter apartment count or BHK type', () => {
      const promptReq = compileApartmentFloorPlanImagePrompt({
        site,
        apartmentConfig,
        seed: 7919,
        referenceImages: [
          { id: 'ref_6flat', name: '6-flat-tower.png', base64Data: 'iVBORw0KGgoAAAANSUhEUg==' },
        ],
        concept: { candidateNumber: 1, candidateCount: 4, label: 'Concept 01', intent: 'Balanced' },
      });

      // Contract demands exactly 3 flats despite reference image
      expect(promptReq.prompt).toContain('EXACTLY 3 flats');
      expect(promptReq.prompt).toContain('never copy their flat count');
      expect(promptReq.metadata.manifest).toBeDefined();
    });
  });

  // 8. Visual Preflight Engine (Section 26, 27)
  describe('Visual Preflight Engine (Section 26, 27)', () => {
    const expectedBrief: ExpectedApartmentBrief = {
      flatsPerFloor: 3,
      unitMix: [{ unitType: '3BHK', count: 3 }],
      liftCount: 2,
      stairCount: 2,
      commonCoreRequired: true,
    };

    it('passes when exactly 3 flats, all 3BHK, 2 lifts, 2 stairs detected', () => {
      const detected: Partial<DetectedApartmentFeatures> = {
        flatCount: 3,
        unitMix: ['3BHK', '3BHK', '3BHK'],
        liftCount: 2,
        stairCount: 2,
        commonCore: true,
        unitSeparation: true,
        visualQuality: 8,
        confidence: 0.9,
      };

      const result = evaluateApartmentPreflight(detected, expectedBrief);
      expect(result.pass).toBe(true);
      expect(result.failureReasons).toHaveLength(0);
      expect(result.imagePreflight.flatCount).toBe(3);
      expect(result.imagePreflight.detectedBedroomCountPerUnit).toEqual([3, 3, 3]);
    });

    it('FLUX detects 4 when expected 3 -> reject with FLAT_COUNT_MISMATCH and EXTRA_FLAT', () => {
      const detected: Partial<DetectedApartmentFeatures> = {
        flatCount: 4,
        unitMix: ['3BHK', '3BHK', '3BHK', '1BHK'],
        liftCount: 2,
        stairCount: 2,
        commonCore: true,
        unitSeparation: true,
      };

      const result = evaluateApartmentPreflight(detected, expectedBrief);
      expect(result.pass).toBe(false);
      expect(result.failureCodes).toContain('FLAT_COUNT_MISMATCH');
      expect(result.failureCodes).toContain('EXTRA_FLAT');
    });

    it('2BHK detected when expected 3BHK -> reject with BHK_COUNT_MISMATCH and BEDROOM_MISSING', () => {
      const detected: Partial<DetectedApartmentFeatures> = {
        flatCount: 3,
        unitMix: ['3BHK', '2BHK', '3BHK'],
        liftCount: 2,
        stairCount: 2,
        commonCore: true,
        unitSeparation: true,
      };

      const result = evaluateApartmentPreflight(detected, expectedBrief);
      expect(result.pass).toBe(false);
      expect(result.failureCodes).toContain('BHK_COUNT_MISMATCH');
      expect(result.failureCodes).toContain('BEDROOM_MISSING');
    });

    it('wrong lift count or stair count -> reject with LIFT_COUNT_MISMATCH / STAIR_COUNT_MISMATCH', () => {
      const detected: Partial<DetectedApartmentFeatures> = {
        flatCount: 3,
        unitMix: ['3BHK', '3BHK', '3BHK'],
        liftCount: 1, // expected 2
        stairCount: 1, // expected 2
        commonCore: true,
        unitSeparation: true,
      };

      const result = evaluateApartmentPreflight(detected, expectedBrief);
      expect(result.pass).toBe(false);
      expect(result.failureCodes).toContain('LIFT_COUNT_MISMATCH');
      expect(result.failureCodes).toContain('STAIR_COUNT_MISMATCH');
    });
  });
});

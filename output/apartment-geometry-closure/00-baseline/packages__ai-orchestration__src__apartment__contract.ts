/**
 * Generalized Apartment Contract Engine (§3, §4).
 *
 * Implements:
 * - Immutable ApartmentGenerationContract for typical residential floor plates.
 * - Supports arbitrary flatCount (2–8 units) and heterogeneous unit mix (e.g. 2x2BHK + 2x3BHK).
 * - Preserves exact unit instances downstream (no alteration of flat count or unit types).
 * - Deterministic SHA-256 contract hashing.
 * - Backwards-compatible Golden 3x3BHK contract creator.
 */

import { createHash } from 'node:crypto';
import { getUnitProgram, type ResidentialUnitType } from './program-registry.js';

export type ApartmentContractUnitType = ResidentialUnitType;

export interface ApartmentContractUnit {
  readonly unitId: string; // e.g. "FLAT_01", "FLAT_02", "FLAT_03"
  readonly unitType: ApartmentContractUnitType;
  readonly targetBedrooms: number;
  readonly targetBathrooms: number;
  readonly targetCarpetAreaSqFt: number;
  readonly targetCarpetAreaSqM: number;
  readonly mandatoryRooms: readonly string[];
}

export interface ApartmentContractCore {
  readonly liftCount: number;
  readonly stairCount: number;
  readonly commonLobby: boolean;
  readonly liftArrangement: 'COMPACT_SHARED_BANK' | 'DISTRIBUTED';
  readonly corePlacement?: 'CENTRAL' | 'SIDE';
}

export interface ApartmentContractSite {
  readonly plotWidthM: number;
  readonly plotDepthM: number;
  readonly setbacksM: {
    readonly front: number;
    readonly rear: number;
    readonly left: number;
    readonly right: number;
  };
  readonly buildableWidthM: number;
  readonly buildableDepthM: number;
  readonly buildableAreaSqM: number;
  readonly roadFacing: string;
}

export interface ApartmentGenerationContract {
  readonly schemaVersion: '1.0';
  readonly contractId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectType: 'MULTI_UNIT_RESIDENTIAL';
  readonly floorType: 'TYPICAL';
  readonly flatCount: number;
  readonly flats: readonly ApartmentContractUnit[];
  readonly core: ApartmentContractCore;
  readonly site: ApartmentContractSite;
  readonly contractHash: string; // SHA-256 digest
  readonly createdAt: string;
}

export interface CreateApartmentContractInput {
  readonly projectId: string;
  readonly projectName?: string;
  readonly flatCount?: number;
  readonly unitSchedule?: ReadonlyArray<ApartmentContractUnitType | {
    unitType: ApartmentContractUnitType;
    unitId?: string;
    targetCarpetAreaSqFt?: number;
  }>;
  readonly plotWidthM?: number;
  readonly plotDepthM?: number;
  readonly setbacksM?: { front: number; rear: number; left: number; right: number };
  readonly roadFacing?: string;
  readonly liftCount?: number;
  readonly stairCount?: number;
  readonly commonLobby?: boolean;
  readonly corePlacement?: 'CENTRAL' | 'SIDE';
  readonly targetCarpetAreaSqFtPerUnit?: number;
}

export type Create3x3BhkContractInput = CreateApartmentContractInput;

/**
 * Computes a deterministic SHA-256 hash from canonical representation of contract fields.
 */
export function computeApartmentContractHash(
  payload: Omit<ApartmentGenerationContract, 'contractHash'>,
): string {
  const canonicalData = {
    schemaVersion: payload.schemaVersion,
    contractId: payload.contractId,
    projectId: payload.projectId,
    projectType: payload.projectType,
    floorType: payload.floorType,
    flatCount: payload.flatCount,
    flats: payload.flats.map(f => ({
      unitId: f.unitId,
      unitType: f.unitType,
      targetBedrooms: f.targetBedrooms,
      targetBathrooms: f.targetBathrooms,
      targetCarpetAreaSqFt: f.targetCarpetAreaSqFt,
      mandatoryRooms: [...f.mandatoryRooms].sort(),
    })),
    core: {
      liftCount: payload.core.liftCount,
      stairCount: payload.core.stairCount,
      commonLobby: payload.core.commonLobby,
      liftArrangement: payload.core.liftArrangement,
      corePlacement: payload.core.corePlacement ?? 'CENTRAL',
    },
    site: {
      plotWidthM: payload.site.plotWidthM,
      plotDepthM: payload.site.plotDepthM,
      buildableWidthM: payload.site.buildableWidthM,
      buildableDepthM: payload.site.buildableDepthM,
      buildableAreaSqM: payload.site.buildableAreaSqM,
      roadFacing: payload.site.roadFacing,
    },
  };

  return createHash('sha256').update(JSON.stringify(canonicalData)).digest('hex');
}

/**
 * Mandatory 3BHK room set required by contract.
 */
export const MANDATORY_3BHK_ROOM_PROGRAM = [
  'foyer',
  'living_dining',
  'kitchen',
  'utility',
  'master_bedroom',
  'master_toilet',
  'bedroom_2',
  'toilet_2',
  'bedroom_3',
  'common_toilet',
] as const;

/**
 * Creates a Generalized Apartment Contract supporting arbitrary unit counts and schedules.
 */
export function createApartmentContract(
  input: CreateApartmentContractInput,
): ApartmentGenerationContract {
  const plotWidthM = input.plotWidthM ?? 50;
  const plotDepthM = input.plotDepthM ?? 50;
  const setbacksM = input.setbacksM ?? { front: 3, rear: 2, left: 2, right: 2 };
  const roadFacing = input.roadFacing ?? 'North';

  const buildableWidthM = Math.max(0, plotWidthM - setbacksM.left - setbacksM.right);
  const buildableDepthM = Math.max(0, plotDepthM - setbacksM.front - setbacksM.rear);
  const buildableAreaSqM = Number((buildableWidthM * buildableDepthM).toFixed(2));

  // Build exact unit instances
  let flats: ApartmentContractUnit[] = [];
  if (input.unitSchedule && input.unitSchedule.length > 0) {
    flats = input.unitSchedule.map((item, idx) => {
      const type: ApartmentContractUnitType = typeof item === 'string' ? item : item.unitType;
      const prog = getUnitProgram(type);
      const targetSqFt = typeof item === 'object' && item.targetCarpetAreaSqFt
        ? item.targetCarpetAreaSqFt
        : (input.targetCarpetAreaSqFtPerUnit ?? prog.defaultCarpetAreaSqFt);
      const targetSqM = Number((targetSqFt * 0.092903).toFixed(2));
      const unitId = typeof item === 'object' && item.unitId
        ? item.unitId
        : `FLAT_${String(idx + 1).padStart(2, '0')}`;

      return {
        unitId,
        unitType: type,
        targetBedrooms: prog.targetBedrooms,
        targetBathrooms: prog.targetBathrooms,
        targetCarpetAreaSqFt: targetSqFt,
        targetCarpetAreaSqM: targetSqM,
        mandatoryRooms: [...prog.mandatoryRooms],
      };
    });
  } else {
    const count = input.flatCount ?? 3;
    const defaultType: ApartmentContractUnitType = '3BHK';
    const prog = getUnitProgram(defaultType);
    const targetSqFt = input.targetCarpetAreaSqFtPerUnit ?? prog.defaultCarpetAreaSqFt;
    const targetSqM = Number((targetSqFt * 0.092903).toFixed(2));

    flats = Array.from({ length: count }, (_, idx) => ({
      unitId: `FLAT_${String(idx + 1).padStart(2, '0')}`,
      unitType: defaultType,
      targetBedrooms: prog.targetBedrooms,
      targetBathrooms: prog.targetBathrooms,
      targetCarpetAreaSqFt: targetSqFt,
      targetCarpetAreaSqM: targetSqM,
      mandatoryRooms: [...prog.mandatoryRooms],
    }));
  }

  const flatCount = flats.length;
  const core: ApartmentContractCore = {
    liftCount: input.liftCount ?? (flatCount <= 2 ? 1 : 2),
    stairCount: input.stairCount ?? 2,
    commonLobby: input.commonLobby ?? true,
    liftArrangement: 'COMPACT_SHARED_BANK',
    corePlacement: input.corePlacement ?? 'CENTRAL',
  };

  const contractPartial = {
    schemaVersion: '1.0' as const,
    contractId: `contract_${input.projectId}_${flatCount}flats`,
    projectId: input.projectId,
    projectName: input.projectName ?? `${flatCount}-Flat Apartment Project`,
    projectType: 'MULTI_UNIT_RESIDENTIAL' as const,
    floorType: 'TYPICAL' as const,
    flatCount,
    flats,
    core,
    site: {
      plotWidthM,
      plotDepthM,
      setbacksM,
      buildableWidthM,
      buildableDepthM,
      buildableAreaSqM,
      roadFacing,
    },
    createdAt: '2026-09-30T00:00:00.000Z',
  };

  const contractHash = computeApartmentContractHash(contractPartial);

  return {
    ...contractPartial,
    contractHash,
  };
}

/**
 * Creates the Golden 3 x 3BHK Apartment Contract.
 */
export function createGolden3x3BhkContract(
  input: Create3x3BhkContractInput,
): ApartmentGenerationContract {
  return createApartmentContract({
    ...input,
    projectName: input.projectName ?? 'Golden 3x3BHK Apartment Project',
    unitSchedule: ['3BHK', '3BHK', '3BHK'],
    liftCount: input.liftCount ?? 2,
    stairCount: input.stairCount ?? 2,
    targetCarpetAreaSqFtPerUnit: input.targetCarpetAreaSqFtPerUnit ?? 1100,
  });
}

/**
 * Convenience helper to create the Golden 3x3BHK Apartment Contract with defaults.
 */
export function create3x3BhkApartmentContract(
  overrides?: Partial<Create3x3BhkContractInput>,
): ApartmentGenerationContract {
  return createGolden3x3BhkContract({
    projectId: 'golden-3x3bhk-project',
    projectName: 'Golden 3x3BHK Apartment',
    plotWidthM: 50,
    plotDepthM: 50,
    setbacksM: { front: 3, rear: 2, left: 2, right: 2 },
    roadFacing: 'North',
    liftCount: 2,
    stairCount: 2,
    targetCarpetAreaSqFtPerUnit: 1100,
    ...overrides,
  });
}

export const GOLDEN_3X3BHK_PROJECT_SPECS = {
  projectType: 'apartment',
  site: {
    plotWidthM: 50,
    plotDepthM: 50,
    roadFacing: 'North',
    setbacksM: { front: 5, rear: 4, left: 4, right: 4 },
  },
  height: 'G+4 (5 floors total)',
  flatCount: 3,
  flats: ['FLAT_01', 'FLAT_02', 'FLAT_03'],
  unitType: '3BHK',
  core: {
    passengerLifts: 2,
    staircaseCount: 2,
    commonLobby: true,
  },
} as const;

/**
 * Validates contract integrity and detects tampering across downstream transformations.
 */
export function verifyContractIntegrity(
  contract: ApartmentGenerationContract,
  expectedHash?: string,
): { valid: boolean; reasons: string[]; tamperIssues: string[] } {
  const reasons: string[] = [];

  if (contract.flatCount !== contract.flats.length) {
    reasons.push(
      `Contract flatCount (${contract.flatCount}) does not match flats length (${contract.flats.length}).`,
    );
  }

  contract.flats.forEach((f, idx) => {
    if (!f.unitId) {
      reasons.push(`Flat at index ${idx} is missing unitId.`);
    }
    if (!f.unitType) {
      reasons.push(`Flat ${f.unitId || idx} is missing unitType.`);
    }
    if (f.targetBedrooms <= 0) {
      reasons.push(`Flat ${f.unitId} has invalid targetBedrooms (${f.targetBedrooms}).`);
    }
  });

  const computed = computeApartmentContractHash(contract);
  if (expectedHash && computed !== expectedHash) {
    reasons.push(`Contract hash mismatch. Expected ${expectedHash}, computed ${computed}.`);
  }
  if (computed !== contract.contractHash) {
    reasons.push(
      `Contract internal hash mismatch. contractHash: ${contract.contractHash}, computed: ${computed}.`,
    );
  }

  return {
    valid: reasons.length === 0,
    reasons,
    tamperIssues: reasons,
  };
}

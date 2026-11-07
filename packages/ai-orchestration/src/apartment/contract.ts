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

import { getUnitProgram, type ResidentialUnitType } from './program-registry.js';

function sha256Hex(ascii: string): string {
  function rr(v: number, a: number) { return (v >>> a) | (v << (32 - a)); }
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const utf8: number[] = [];
  for (let b = 0; b < ascii.length; b++) {
    let c = ascii.charCodeAt(b);
    if (c < 0x80) utf8.push(c);
    else if (c < 0x800) utf8.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0xd800 || c >= 0xe000) utf8.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else {
      b++;
      c = 0x10000 + (((c & 0x3ff) << 10) | (ascii.charCodeAt(b) & 0x3ff));
      utf8.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  const bl = utf8.length * 8;
  utf8.push(0x80);
  while ((utf8.length % 64) !== 56) utf8.push(0);
  for (let s = 56; s >= 0; s -= 8) utf8.push(Math.floor(bl / Math.pow(2, s)) & 0xff);
  const words: number[] = [];
  for (let w = 0; w < utf8.length; w += 4) {
    words.push((utf8[w]! << 24) | (utf8[w + 1]! << 16) | (utf8[w + 2]! << 8) | utf8[w + 3]!);
  }
  for (let ch = 0; ch < words.length; ch += 16) {
    const w: number[] = [];
    for (let c = 0; c < 16; c++) w[c] = words[ch + c]!;
    for (let c = 16; c < 64; c++) {
      const s0 = rr(w[c - 15]!, 7) ^ rr(w[c - 15]!, 18) ^ (w[c - 15]! >>> 3);
      const s1 = rr(w[c - 2]!, 17) ^ rr(w[c - 2]!, 19) ^ (w[c - 2]! >>> 10);
      w[c] = (w[c - 16]! + s0 + w[c - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h0] = h;
    for (let t = 0; t < 64; t++) {
      const S1 = rr(e!, 6) ^ rr(e!, 11) ^ rr(e!, 25);
      const ch0 = (e! & f!) ^ ((~e!) & g!);
      const t1 = (h0! + S1 + ch0 + k[t]! + w[t]!) | 0;
      const S0 = rr(a!, 2) ^ rr(a!, 13) ^ rr(a!, 22);
      const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const t2 = (S0 + maj) | 0;
      h0 = g; g = f; f = e; e = (d! + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0]! + a!) | 0; h[1] = (h[1]! + b!) | 0; h[2] = (h[2]! + c!) | 0; h[3] = (h[3]! + d!) | 0;
    h[4] = (h[4]! + e!) | 0; h[5] = (h[5]! + f!) | 0; h[6] = (h[6]! + g!) | 0; h[7] = (h[7]! + h0!) | 0;
  }
  return h.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

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
      setbacksM: {
        front: payload.site.setbacksM.front,
        rear: payload.site.setbacksM.rear,
        left: payload.site.setbacksM.left,
        right: payload.site.setbacksM.right,
      },
      buildableWidthM: payload.site.buildableWidthM,
      buildableDepthM: payload.site.buildableDepthM,
      buildableAreaSqM: payload.site.buildableAreaSqM,
      roadFacing: payload.site.roadFacing,
    },
  };

  return sha256Hex(JSON.stringify(canonicalData));
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
  const missing:string[]=[];
  for(const key of ['plotWidthM','plotDepthM','setbacksM','roadFacing','unitSchedule'] as const)if(input[key]===undefined)missing.push(key);
  if(missing.length)throw new Error(`MISSING_REQUIRED_PROJECT_INPUT: ${missing.join(', ')}`);
  if(!input.unitSchedule?.length)throw new Error('MISSING_REQUIRED_PROJECT_INPUT: unitSchedule');
  if(input.flatCount!==undefined&&input.flatCount!==input.unitSchedule.length)throw new Error('UNIT_COUNT_MISMATCH');
  if(!Number.isFinite(input.plotWidthM)||!Number.isFinite(input.plotDepthM)||input.plotWidthM!<=0||input.plotDepthM!<=0||Object.values(input.setbacksM!).some(v=>!Number.isFinite(v)||v<0))throw new Error('INVALID_PROJECT_SITE');
  const plotWidthM = input.plotWidthM!;
  const plotDepthM = input.plotDepthM!;
  const setbacksM = input.setbacksM!;
  const roadFacing = input.roadFacing!;

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
    plotWidthM: input.plotWidthM ?? 50,
    plotDepthM: input.plotDepthM ?? 50,
    setbacksM: input.setbacksM ?? {front:3,rear:2,left:2,right:2},
    roadFacing: input.roadFacing ?? 'North',
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

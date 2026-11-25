import {
  RoomType,
  architecturalSpaceRole,
  isPhysicalBoundary,
  parseArchitecturalAreaMm2,
  stableValueHash,
  validateBuildingSchema,
  type ApartmentBhkType,
  type Building,
  type Door,
  type Floor,
  type GenerationControlState,
  type Point,
  type Room,
  type Wall,
  type Window,
} from '@ai-floor-planner/core';
import {
  openingFitsApartmentWall,
  polygonArea,
  projectOnSegment,
} from '@ai-floor-planner/geometry-engine';
import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { GeometryValidator } from '../validator/geometry-validator';
import { MIN_PROVISIONAL_COLUMN_SPACING_MM } from '../structural/provisional-column-host';
import { acceptApartmentFloorEdit, editApartmentOpening } from './apartment-opening-edit';
import { moveApartmentPartition } from './apartment-partition-edit';
import { expandFlatIntoSetbackMargin, optimizeRoomArea } from './room-area-optimizer';
import { buildingRefinementRevision } from './targeted-regeneration';
import {
  proposeProtectedLocalRegeneration,
  type LocalizedRegenerationOperation,
  type LocalizedRegenerationScope,
  type ProtectedRegionInvarianceProof,
} from './protected-local-regeneration';

export type CadEditAction =
  | 'RESIZE_ROOM_AREA'
  | 'MOVE_OPENING'
  | 'ADJUST_PARTITION_OR_PASSAGE'
  | 'RESIZE_OPENING'
  | 'LOCALIZED_FLAT_REGENERATION';

export interface CadEditIntent {
  readonly action: CadEditAction;
  readonly targetEntityId?: string;
  readonly targetRoomQuery?: string;
  readonly targetUnitIndex?: number;
  readonly targetOpeningKind?: 'door' | 'window';
  readonly targetWidthMm?: number;
  readonly shiftMm?: number;
  readonly moveOpeningMode?: 'TOWARDS_CORNER' | 'CENTER' | 'SHIFT_MM';
  readonly areaDeltaPercent?: number;
  readonly targetAreaSqM?: number;
  readonly targetAreaSqFt?: number;
  readonly targetAreaMm2?: number;
  readonly localScope?: LocalizedRegenerationScope;
  readonly localOperation?: LocalizedRegenerationOperation;
  readonly targetBhk?: ApartmentBhkType;
  readonly variantIndex?: number;
}

export type CadAiEditProposalStatus =
  | 'PREVIEW_READY'
  | 'REFUSED_LOCKED'
  | 'REFUSED_STALE_REVISION'
  | 'REFUSED_UNSUPPORTED'
  | 'REJECTED_BY_CONSTRAINTS';

export interface CadRoomAreaDelta {
  readonly roomId: string;
  readonly roomName: string;
  readonly unitId?: string;
  readonly beforeSqM: number;
  readonly afterSqM: number;
  readonly beforeSqFt: number;
  readonly afterSqFt: number;
  readonly deltaSqM: number;
}

export interface CadOpeningEditSummary {
  readonly openingId: string;
  readonly kind: 'door' | 'window';
  readonly hostWallId: string;
  readonly beforeWidthMm: number;
  readonly afterWidthMm: number;
  readonly beforePosition: Point;
  readonly afterPosition: Point;
}

export interface CadAiEditValidationSummary {
  readonly schemaValid: boolean;
  readonly geometryValid: boolean;
  readonly closureValid: boolean;
  readonly planarDeltaMm2: number;
  readonly unaffectedFlatsUnchanged: boolean;
  readonly unaffectedFloorsUnchanged: boolean;
}

export interface CadAiEditProposalRequest {
  readonly building: Building;
  readonly floorId: string;
  readonly control?: GenerationControlState;
  readonly expectedRevision?: number;
  readonly expectedRevisionDigest?: string;
  readonly selectedEntityId?: string;
  readonly instruction?: string;
  readonly parsedIntent?: CadEditIntent;
  readonly intentSource?: 'GEMINI_ASSISTED' | 'DETERMINISTIC';
}

export interface CadAiEditProposalResult {
  readonly status: CadAiEditProposalStatus;
  readonly intentSource: 'GEMINI_ASSISTED' | 'DETERMINISTIC';
  readonly parsedIntent: CadEditIntent;
  readonly expectedRevision: number;
  readonly baseRevisionDigest: string;
  readonly proposedRevision: number | null;
  readonly resolvedEntityIds: readonly string[];
  readonly affectedDependencies: {
    readonly wallIds: readonly string[];
    readonly roomIds: readonly string[];
    readonly openingIds: readonly string[];
    readonly unitIds: readonly string[];
  };
  readonly roomAreaDeltas: readonly CadRoomAreaDelta[];
  readonly openingSummary: CadOpeningEditSummary | null;
  readonly validation: CadAiEditValidationSummary;
  readonly invarianceProof?: ProtectedRegionInvarianceProof;
  readonly localCandidatesCount?: number;
  readonly message: string;
  readonly proposedBuilding: Building | null;
}

const SQMM_PER_SQM = 1_000_000;
const SQMM_PER_SQFT = 92_903.04;
const NBC_MIN_PASSAGE_CLEAR_WIDTH_MM = 1100;

function defaultControl(): GenerationControlState {
  return {
    schemaVersion: 1,
    revisionId: 'rev-0',
    lockedEntityIds: [],
    lockedFloorIds: [],
    protectedCoreIds: [],
    footprintLocked: true,
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeEntityId(rawId: string | undefined): string | undefined {
  if (!rawId) return undefined;
  return rawId.replace(/^cad:(?:wall|room|door|window|stair|floor|anno:room):/, '');
}

/** Deterministic natural-language architectural CAD edit parser (used directly or when Gemini is offline). */
export function parseCadEditInstructionDeterministically(
  instruction: string,
  selectedEntityId?: string,
): CadEditIntent {
  const clean = instruction.trim();
  const lower = clean.toLowerCase();
  const normalizedSelected = normalizeEntityId(selectedEntityId);

  const unitNumMatch = lower.match(/\b(?:flat|unit|apartment)\s*#?\s*0?(\d+)\b/i);
  const parsedUnitIndex = unitNumMatch ? Number.parseInt(unitNumMatch[1]!, 10) : undefined;

  // 1A. Convert flat BHK (e.g. "Convert Flat 2 from 2BHK to 3BHK" or "Make Flat 2 a 3BHK")
  const bhkConvertMatch = lower.match(/\b(?:to|into|as(?:\s+a)?)\s*([1-4])\s*bhk\b/i)
    ?? (/\b(?:convert|upgrade|change|turn)\b/.test(lower) ? lower.match(/\b([1-4])\s*bhk\b/i) : null);
  if (bhkConvertMatch) {
    return {
      action: 'LOCALIZED_FLAT_REGENERATION',
      localScope: 'SINGLE_FLAT',
      localOperation: 'CONVERT_BHK',
      targetBhk: `${bhkConvertMatch[1]}BHK` as ApartmentBhkType,
      targetUnitIndex: parsedUnitIndex ?? 2,
      targetEntityId: normalizedSelected,
    };
  }

  // 1B. Relocate kitchen inside 1 flat (e.g. "Relocate kitchen in Flat 2")
  if (/\b(?:relocate|reposition|swap|flip|move)\b/.test(lower) && /\bkitchen\b/.test(lower) && !/\b(?:door|window)\b/.test(lower)) {
    return {
      action: 'LOCALIZED_FLAT_REGENERATION',
      localScope: 'SINGLE_FLAT',
      localOperation: 'RELOCATE_KITCHEN',
      targetUnitIndex: parsedUnitIndex,
      targetEntityId: normalizedSelected,
    };
  }

  // 1C. Reconfigure Living/Dining arrangement inside 1 flat
  if (/\b(?:reconfigure|rearrange|change|swap|flip)\b/.test(lower) && /\bliving\b/.test(lower) && /\bdining\b/.test(lower)) {
    return {
      action: 'LOCALIZED_FLAT_REGENERATION',
      localScope: 'SINGLE_FLAT',
      localOperation: 'RECONFIGURE_LIVING_DINING',
      targetUnitIndex: parsedUnitIndex,
      targetEntityId: normalizedSelected,
    };
  }

  // 1D. Regenerate a single room (e.g. "Regenerate only bedroom 2 in Flat 2")
  if (/\bregenerate\b/.test(lower) && /\b(master\s+bedroom|bedroom\s*\d*|kitchen|living|dining)\b/.test(lower)) {
    const rmMatch = lower.match(/\b(master\s+bedroom|bedroom\s*\d*|kitchen|living|dining)\b/i);
    return {
      action: 'LOCALIZED_FLAT_REGENERATION',
      localScope: 'SINGLE_ROOM',
      localOperation: 'REGENERATE_ROOM',
      targetRoomQuery: rmMatch?.[1]?.toLowerCase(),
      targetUnitIndex: parsedUnitIndex,
      targetEntityId: normalizedSelected,
    };
  }

  // 1E. Localized flat regeneration (e.g. "Regenerate only Flat 2 while keeping the remaining flats unchanged")
  const flatRegenMatch = lower.match(/\bregenerate\b.*?\b(?:only\s+)?(?:flat|unit|apartment)\s*#?\s*0?(\d+)/i)
    ?? lower.match(/\b(?:only\s+)?(?:flat|unit|apartment)\s*#?\s*0?(\d+)\b.*?\bregenerate\b/i);
  if (flatRegenMatch) {
    return {
      action: 'LOCALIZED_FLAT_REGENERATION',
      localScope: 'SINGLE_FLAT',
      localOperation: 'REGENERATE_ALTERNATIVE',
      targetUnitIndex: Number.parseInt(flatRegenMatch[1]!, 10),
      targetEntityId: normalizedSelected,
    };
  }

  // 2. Resize window / door width (e.g. "Resize this window to 1500 mm")
  const resizeOpeningMatch = lower.match(/\b(?:resize|set|change|make|widen|narrow)\b.*?\b(window|door)\b.*?\b(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i)
    ?? lower.match(/\b(window|door)\b.*?\b(?:width|to)\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i);
  if (resizeOpeningMatch) {
    const kind = resizeOpeningMatch[1]!.toLowerCase() === 'door' ? 'door' : 'window';
    const val = Number.parseFloat(resizeOpeningMatch[2]!);
    const unit = resizeOpeningMatch[3]!.toLowerCase();
    const widthMm = Math.round(unit === 'm' ? val * 1000 : unit === 'cm' ? val * 10 : val);
    return {
      action: 'RESIZE_OPENING',
      targetOpeningKind: kind,
      targetWidthMm: widthMm,
      targetEntityId: normalizedSelected,
    };
  }

  // 3. Move opening along host wall (e.g. "Move this bedroom door towards the corner")
  if (/\b(?:move|shift|slide|reposition|center|centre)\b/.test(lower) && /\b(door|window|opening)\b/.test(lower)) {
    const kind: 'door' | 'window' = /\bwindow\b/.test(lower) ? 'window' : 'door';
    const roomHint = /\bmaster\s+bedroom\b/.test(lower)
      ? 'master bedroom'
      : /\bbedroom\b/.test(lower)
      ? 'bedroom'
      : /\bkitchen\b/.test(lower)
      ? 'kitchen'
      : /\bliving\b/.test(lower)
      ? 'living'
      : /\bbathroom|toilet\b/.test(lower)
      ? 'bathroom'
      : undefined;
    const mmMatch = lower.match(/([+-]?\d+(?:\.\d+)?)\s*(mm|cm|m)\b/);
    if (/\b(?:center|centre|middle)\b/.test(lower)) {
      return {
        action: 'MOVE_OPENING',
        targetOpeningKind: kind,
        targetRoomQuery: roomHint,
        moveOpeningMode: 'CENTER',
        targetEntityId: normalizedSelected,
      };
    }
    if (mmMatch && !/\bcorner\b/.test(lower)) {
      const raw = Number.parseFloat(mmMatch[1]!);
      const u = mmMatch[2]!.toLowerCase();
      const shiftMm = Math.round(u === 'm' ? raw * 1000 : u === 'cm' ? raw * 10 : raw);
      return {
        action: 'MOVE_OPENING',
        targetOpeningKind: kind,
        targetRoomQuery: roomHint,
        moveOpeningMode: 'SHIFT_MM',
        shiftMm,
        targetEntityId: normalizedSelected,
      };
    }
    return {
      action: 'MOVE_OPENING',
      targetOpeningKind: kind,
      targetRoomQuery: roomHint,
      moveOpeningMode: 'TOWARDS_CORNER',
      targetEntityId: normalizedSelected,
    };
  }

  // 4. Adjust interior partition or passage width (e.g. "Reduce the passage width without compromising circulation")
  if (
    (/\b(?:passage|corridor|hallway|foyer)\b/.test(lower) && /\b(?:width|narrow|reduce|shrink|widen|adjust)\b/.test(lower)) ||
    (/\bpartition|wall\b/.test(lower) && /\b(?:move|shift|offset|slide)\b/.test(lower))
  ) {
    const mmMatch = lower.match(/([+-]?\d+(?:\.\d+)?)\s*(mm|cm|m)\b/);
    const shiftMm = mmMatch
      ? Math.round(
          Number.parseFloat(mmMatch[1]!) *
            (mmMatch[2]!.toLowerCase() === 'm' ? 1000 : mmMatch[2]!.toLowerCase() === 'cm' ? 10 : 1),
        )
      : undefined;
    return {
      action: 'ADJUST_PARTITION_OR_PASSAGE',
      targetRoomQuery: /\bpassage|corridor|hallway\b/.test(lower) ? 'passage' : undefined,
      shiftMm,
      targetEntityId: normalizedSelected,
    };
  }

  // 5. Resize room carpet area (e.g. "Increase the master bedroom carpet area" or "Set master bedroom to 12' 6\" x 15' 0\"")
  const roomQueryMatch = lower.match(
    /\b(master\s+bedroom|bedroom\s*\d*|living(?:\s+room)?|dining|kitchen|study|bathroom|utility|balcony)\b/i,
  );
  const pctMatch = lower.match(/(\d+(?:\.\d+)?)\s*%/);
  const dimPairMatch = clean.match(/(\d+(?:['’]\s*\d*(?:\s+\d+\/\d+)?["”]?)?\s*(?:mm|cm|m|ft)?\s*[x×]\s*\d+(?:['’]\s*\d*(?:\s+\d+\/\d+)?["”]?)?\s*(?:mm|cm|m|ft)?)/i);
  const parsedDimArea = dimPairMatch ? parseArchitecturalAreaMm2(dimPairMatch[1]!) : null;
  const sqmMatch = lower.match(/(\d+(?:\s+\d+\/\d+|\.\d+)?)\s*(?:sq\.?\s*m|m2|m²|sqm)\b/i);
  const sqftMatch = lower.match(/(\d+(?:\s+\d+\/\d+|\.\d+)?)\s*(?:sq\.?\s*ft|ft2|ft²|sqft|sft)\b/i);
  const parsedSqm = sqmMatch ? parseArchitecturalAreaMm2(`${sqmMatch[1]} sq m`, 'sqm') : null;
  const parsedSqft = sqftMatch ? parseArchitecturalAreaMm2(`${sqftMatch[1]} sq ft`, 'sqft') : null;
  const isDecrease = /\b(?:reduce|decrease|shrink|smaller)\b/.test(lower);
  const pct = pctMatch ? Number.parseFloat(pctMatch[1]!) * (isDecrease ? -1 : 1) : isDecrease ? -8 : 8;

  const exactMm2 = parsedDimArea?.ok
    ? parsedDimArea.mm2
    : parsedSqm?.ok
      ? parsedSqm.mm2
      : parsedSqft?.ok
        ? parsedSqft.mm2
        : undefined;

  return {
    action: 'RESIZE_ROOM_AREA',
    targetEntityId: normalizedSelected,
    ...(parsedUnitIndex !== undefined ? { targetUnitIndex: parsedUnitIndex } : {}),
    targetRoomQuery: roomQueryMatch ? roomQueryMatch[1]!.toLowerCase() : 'master bedroom',
    ...(exactMm2 !== undefined ? { targetAreaMm2: exactMm2 } : {}),
    ...(parsedSqm?.ok ? { targetAreaSqM: parsedSqm.sqM } : {}),
    ...(parsedSqft?.ok ? { targetAreaSqFt: parsedSqft.sqFt } : {}),
    ...(exactMm2 === undefined ? { areaDeltaPercent: pct } : {}),
  };
}

function emptyValidation(): CadAiEditValidationSummary {
  return {
    schemaValid: false,
    geometryValid: false,
    closureValid: false,
    planarDeltaMm2: 0,
    unaffectedFlatsUnchanged: true,
    unaffectedFloorsUnchanged: true,
  };
}

function verifyProposedBuilding(
  before: Building,
  after: Building,
  editedFloorId: string,
  allowedUnitIds: ReadonlySet<string>,
): { ok: boolean; summary: CadAiEditValidationSummary; error?: string } {
  const schemaIssues = validateBuildingSchema(after);
  if (schemaIssues.length > 0) {
    return {
      ok: false,
      summary: { ...emptyValidation(), schemaValid: false },
      error: schemaIssues[0]!.message,
    };
  }

  const unaffectedFloorsUnchanged = before.floors.every(bf => {
    if (bf.id === editedFloorId) return true;
    const af = after.floors.find(f => f.id === bf.id);
    return Boolean(af && stableValueHash(bf) === stableValueHash(af));
  });

  const beforeFloor = before.floors.find(f => f.id === editedFloorId);
  const afterFloor = after.floors.find(f => f.id === editedFloorId);
  if (!beforeFloor || !afterFloor) {
    return { ok: false, summary: emptyValidation(), error: 'Target floor missing in proposed building.' };
  }

  let unaffectedFlatsUnchanged = true;
  if (allowedUnitIds.size > 0 && (beforeFloor.apartmentUnits?.length ?? 0) > 1) {
    for (const roomBefore of beforeFloor.rooms) {
      if (!roomBefore.unitId || allowedUnitIds.has(roomBefore.unitId)) continue;
      const roomAfter = afterFloor.rooms.find(r => r.id === roomBefore.id);
      if (!roomAfter || stableValueHash(roomBefore.boundary) !== stableValueHash(roomAfter.boundary)) {
        unaffectedFlatsUnchanged = false;
        break;
      }
    }
  }

  const audit = new GeometryValidator({
    autoCorrect: false,
    columnMergeThresholdMm: MIN_PROVISIONAL_COLUMN_SPACING_MM,
  }).audit(after, false).report;
  const criticalGeo = audit.errors.find(e => e.severity === 'CRITICAL' && !e.autoCorrected);
  const geometryValid = !criticalGeo;

  const isApartmentFloor = Boolean(afterFloor.apartmentUnits?.length);
  const closure = isApartmentFloor
    ? validateApartmentClosure({ ...after, floors: [afterFloor] })
    : { valid: true, issues: [] as const };
  const closureError = closure.issues.find(i => i.severity === 'error');
  const closureValid = !closureError;

  const summary: CadAiEditValidationSummary = {
    schemaValid: true,
    geometryValid,
    closureValid,
    planarDeltaMm2: audit.planarDeltaMm2,
    unaffectedFlatsUnchanged,
    unaffectedFloorsUnchanged,
  };

  if (!unaffectedFloorsUnchanged) {
    return { ok: false, summary, error: 'Proposed edit modified an unrelated building floor.' };
  }
  if (!unaffectedFlatsUnchanged) {
    return { ok: false, summary, error: 'Proposed edit modified rooms belonging to an unrelated apartment flat.' };
  }
  if (!geometryValid) {
    return { ok: false, summary, error: criticalGeo!.description };
  }
  if (!closureValid) {
    return { ok: false, summary, error: closureError!.message };
  }
  return { ok: true, summary };
}

function buildDiffFromProposal(
  beforeFloor: Floor,
  afterFloor: Floor,
): {
  wallIds: string[];
  roomIds: string[];
  openingIds: string[];
  unitIds: string[];
  roomAreaDeltas: CadRoomAreaDelta[];
} {
  const roomIds: string[] = [];
  const unitSet = new Set<string>();
  const roomAreaDeltas: CadRoomAreaDelta[] = [];

  for (const afterRoom of afterFloor.rooms) {
    const beforeRoom = beforeFloor.rooms.find(r => r.id === afterRoom.id);
    if (!beforeRoom) continue;
    const bArea = beforeRoom.boundary.points.length >= 3 ? polygonArea(beforeRoom.boundary) : beforeRoom.area;
    const aArea = afterRoom.boundary.points.length >= 3 ? polygonArea(afterRoom.boundary) : afterRoom.area;
    if (
      Math.abs(aArea - bArea) > 1 ||
      stableValueHash(beforeRoom.boundary) !== stableValueHash(afterRoom.boundary)
    ) {
      roomIds.push(afterRoom.id);
      if (afterRoom.unitId) unitSet.add(afterRoom.unitId);
      roomAreaDeltas.push({
        roomId: afterRoom.id,
        roomName: afterRoom.name,
        ...(afterRoom.unitId ? { unitId: afterRoom.unitId } : {}),
        beforeSqM: Number((bArea / SQMM_PER_SQM).toFixed(2)),
        afterSqM: Number((aArea / SQMM_PER_SQM).toFixed(2)),
        beforeSqFt: Number((bArea / SQMM_PER_SQFT).toFixed(2)),
        afterSqFt: Number((aArea / SQMM_PER_SQFT).toFixed(2)),
        deltaSqM: Number(((aArea - bArea) / SQMM_PER_SQM).toFixed(2)),
      });
    }
  }

  const wallIds = afterFloor.walls
    .filter(aw => {
      const bw = beforeFloor.walls.find(w => w.id === aw.id);
      return (
        !bw ||
        Math.hypot(aw.startPoint.x - bw.startPoint.x, aw.startPoint.y - bw.startPoint.y) > 0.01 ||
        Math.hypot(aw.endPoint.x - bw.endPoint.x, aw.endPoint.y - bw.endPoint.y) > 0.01 ||
        aw.hasOpening !== bw.hasOpening
      );
    })
    .map(w => w.id);

  const openingIds: string[] = [];
  for (const ad of afterFloor.doors) {
    const bd = beforeFloor.doors.find(d => d.id === ad.id);
    if (
      !bd ||
      ad.width !== bd.width ||
      ad.wallId !== bd.wallId ||
      Math.hypot(ad.position.x - bd.position.x, ad.position.y - bd.position.y) > 0.01
    ) {
      openingIds.push(ad.id);
    }
  }
  for (const aw of afterFloor.windows) {
    const bw = beforeFloor.windows.find(w => w.id === aw.id);
    if (
      !bw ||
      aw.width !== bw.width ||
      aw.wallId !== bw.wallId ||
      Math.hypot(aw.position.x - bw.position.x, aw.position.y - bw.position.y) > 0.01
    ) {
      openingIds.push(aw.id);
    }
  }

  return { wallIds, roomIds, openingIds, unitIds: [...unitSet], roomAreaDeltas };
}

function resolveRoomByQuery(floor: Floor, query: string | undefined, selectedId: string | undefined): Room | undefined {
  if (selectedId) {
    const direct = floor.rooms.find(r => r.id === selectedId);
    if (direct) return direct;
  }
  const habitable = floor.rooms.filter(
    r =>
      architecturalSpaceRole(r) !== 'OPEN_TO_SKY_VOID' &&
      r.type !== RoomType.Staircase &&
      r.type !== RoomType.Lift,
  );
  if (!query) return habitable[0];
  const q = query.toLowerCase().trim();
  if (q.includes('master')) {
    const namedMaster = habitable.find(r => r.name.toLowerCase().includes('master'));
    if (namedMaster) return namedMaster;
    const bedrooms = habitable.filter(r => r.type === RoomType.Bedroom);
    return bedrooms.sort((a, b) => b.area - a.area)[0];
  }
  const exactName = habitable.find(r => r.name.toLowerCase().includes(q));
  if (exactName) return exactName;
  if (q.includes('bedroom')) return habitable.find(r => r.type === RoomType.Bedroom);
  if (q.includes('living')) return habitable.find(r => r.type === RoomType.Living);
  if (q.includes('kitchen')) return habitable.find(r => r.type === RoomType.Kitchen);
  if (q.includes('dining')) return habitable.find(r => r.type === RoomType.Dining);
  if (q.includes('passage') || q.includes('corridor')) {
    return habitable.find(
      r =>
        r.type === RoomType.Corridor ||
        r.type === RoomType.Foyer ||
        /passage|corridor|lobby|foyer/i.test(r.name),
    );
  }
  return habitable[0];
}

function isEntityLocked(
  floorId: string,
  entityIds: readonly (string | undefined)[],
  control: GenerationControlState,
): boolean {
  if (control.lockedFloorIds.includes(floorId)) return true;
  const locked = new Set([...control.lockedEntityIds, ...control.protectedCoreIds]);
  return entityIds.some(id => id !== undefined && locked.has(id));
}

function relaxAreaTargetLockForExplicitUserEdit(building: Building): Building {
  const brief = building.metadata.generationBrief;
  if (brief?.requireAreaTargets) return building;
  const report = building.metadata.generationReport;
  if (!report) return building;
  return {
    ...building,
    metadata: {
      ...building.metadata,
      generationReport: {
        ...report,
        areaTargetDiagnostic: undefined,
        floorAreas: report.floorAreas?.map(fa => ({
          ...fa,
          units: fa.units.map(u => (u.target ? { ...u, target: undefined } : u)),
        })),
      },
    },
  };
}

/**
 * Controlled Canonical CAD Writeback & AI-Assisted CAD Edit Proposal Engine (Phase 4A §14 & §16).
 *
 * Evaluates structured or natural-language CAD edit requests against canonical `Building` constraints
 * without mutating live project state. Callers inspect the returned preview and explicitly accept it
 * through `EditorEngine` (`ReplaceBuildingCommand`) to preserve Undo/Redo and revision safety.
 */
export function proposeControlledCadEdit(request: CadAiEditProposalRequest): CadAiEditProposalResult {
  const { building, floorId } = request;
  const control = request.control ?? defaultControl();
  const baseRevisionDigest = buildingRefinementRevision(building, control);
  const intentSource = request.intentSource ?? 'DETERMINISTIC';
  const normalizedSelected = normalizeEntityId(request.selectedEntityId);
  const parsedIntent =
    request.parsedIntent ??
    parseCadEditInstructionDeterministically(request.instruction ?? '', normalizedSelected);

  const fail = (
    status: CadAiEditProposalStatus,
    message: string,
    resolvedEntityIds: readonly string[] = [],
  ): CadAiEditProposalResult => ({
    status,
    intentSource,
    parsedIntent,
    expectedRevision: building.version,
    baseRevisionDigest,
    proposedRevision: null,
    resolvedEntityIds,
    affectedDependencies: { wallIds: [], roomIds: [], openingIds: [], unitIds: [] },
    roomAreaDeltas: [],
    openingSummary: null,
    validation: emptyValidation(),
    message,
    proposedBuilding: null,
  });

  // Step 1: Revision currency check
  if (
    (request.expectedRevision !== undefined && request.expectedRevision !== building.version) ||
    (request.expectedRevisionDigest !== undefined && request.expectedRevisionDigest !== baseRevisionDigest)
  ) {
    return fail(
      'REFUSED_STALE_REVISION',
      `Stale CAD revision: expected revision ${request.expectedRevision ?? request.expectedRevisionDigest}, but live canonical model is at revision ${building.version}. Refresh the preview before applying.`,
    );
  }

  const floor = building.floors.find(f => f.id === floorId);
  if (!floor) {
    return fail('REJECTED_BY_CONSTRAINTS', `Floor '${floorId}' does not exist in the canonical building model.`);
  }

  if (control.lockedFloorIds.includes(floorId)) {
    return fail(
      'REFUSED_LOCKED',
      `Floor "${floor.name}" is locked. Unlock the floor before proposing canonical CAD modifications.`,
      [floorId],
    );
  }

  // Action 5: Protected Localized Flat / Room / Zone Regeneration (Phase 5 Gate E)
  if (parsedIntent.action === 'LOCALIZED_FLAT_REGENERATION') {
    const scope = parsedIntent.localScope ?? 'SINGLE_FLAT';
    let targetRoomIds: string[] | undefined;
    if (scope === 'SINGLE_ROOM') {
      const unitForRoom =
        parsedIntent.targetUnitIndex !== undefined
          ? floor.apartmentUnits?.[parsedIntent.targetUnitIndex - 1]
          : undefined;
      const scopedFloor: Floor = unitForRoom
        ? { ...floor, rooms: floor.rooms.filter(r => r.unitId === unitForRoom.id) }
        : floor;
      const matched = resolveRoomByQuery(scopedFloor, parsedIntent.targetRoomQuery, normalizedSelected);
      if (matched) targetRoomIds = [matched.id];
    }

    const localRes = proposeProtectedLocalRegeneration({
      building,
      floorId,
      scope,
      operation: parsedIntent.localOperation,
      targetUnitIndex: parsedIntent.targetUnitIndex,
      targetRoomIds,
      targetBhk: parsedIntent.targetBhk,
      targetAreaMm2: parsedIntent.targetAreaMm2,
      targetAreaSqFt: parsedIntent.targetAreaSqFt,
      variantIndex: parsedIntent.variantIndex,
      control,
      expectedRevision: request.expectedRevision,
      expectedRevisionDigest: request.expectedRevisionDigest,
    });

    if (localRes.status !== 'PREVIEW_READY' || !localRes.selectedCandidate) {
      return fail(
        localRes.status === 'PREVIEW_READY' ? 'REJECTED_BY_CONSTRAINTS' : localRes.status,
        localRes.message,
        localRes.targetUnitId ? [localRes.targetUnitId, ...localRes.editableRoomIds] : localRes.editableRoomIds,
      );
    }

    const chosen = localRes.selectedCandidate;
    const afterFloor = chosen.building.floors.find(f => f.id === floorId)!;
    const diff = buildDiffFromProposal(floor, afterFloor);

    return {
      status: 'PREVIEW_READY',
      intentSource,
      parsedIntent,
      expectedRevision: building.version,
      baseRevisionDigest,
      proposedRevision: chosen.building.version,
      resolvedEntityIds: localRes.targetUnitId ? [localRes.targetUnitId] : [...localRes.editableRoomIds],
      affectedDependencies: {
        wallIds: diff.wallIds,
        roomIds: [...new Set([...diff.roomIds, ...chosen.invarianceProof.entityDiff.addedRoomIds])],
        openingIds: diff.openingIds,
        unitIds: localRes.targetUnitId ? [localRes.targetUnitId] : diff.unitIds,
      },
      roomAreaDeltas: diff.roomAreaDeltas,
      openingSummary: null,
      validation: {
        schemaValid: true,
        geometryValid: true,
        closureValid: true,
        planarDeltaMm2: chosen.invarianceProof.floorPlanarDeltaMm2,
        unaffectedFlatsUnchanged: chosen.invarianceProof.unaffectedUnitsIdentical,
        unaffectedFloorsUnchanged: chosen.invarianceProof.unaffectedFloorsIdentical,
      },
      invarianceProof: chosen.invarianceProof,
      localCandidatesCount: localRes.candidates.length,
      message: localRes.message,
      proposedBuilding: chosen.building,
    };
  }

  // Action 4 & 2: Resize Opening or Move Opening
  if (parsedIntent.action === 'RESIZE_OPENING' || parsedIntent.action === 'MOVE_OPENING') {
    const selectedDoor = normalizedSelected ? floor.doors.find(d => d.id === normalizedSelected) : undefined;
    const selectedWindow = normalizedSelected ? floor.windows.find(w => w.id === normalizedSelected) : undefined;
    const selectedRoom = normalizedSelected ? floor.rooms.find(r => r.id === normalizedSelected) : undefined;
    const queriedRoom = parsedIntent.targetRoomQuery
      ? resolveRoomByQuery(floor, parsedIntent.targetRoomQuery, selectedRoom?.id)
      : selectedRoom;

    const wantDoor =
      selectedDoor !== undefined ||
      (selectedWindow === undefined && parsedIntent.targetOpeningKind === 'door');

    const candidates: Array<{ opening: Door | Window; kind: 'door' | 'window'; host: Wall }> = [];
    const pool: Array<{ opening: Door | Window; kind: 'door' | 'window' }> = selectedDoor
      ? [{ opening: selectedDoor, kind: 'door' }]
      : selectedWindow
      ? [{ opening: selectedWindow, kind: 'window' }]
      : wantDoor
      ? floor.doors.map(opening => ({ opening, kind: 'door' as const }))
      : floor.windows.map(opening => ({ opening, kind: 'window' as const }));

    for (const item of pool) {
      const host = floor.walls.find(w => w.id === item.opening.wallId);
      if (!host || !isPhysicalBoundary(host) || host.arc) continue;
      if (queriedRoom) {
        const servesRoom =
          item.kind === 'door'
            ? (item.opening as Door).connectsRooms.includes(queriedRoom.id)
            : (item.opening as Window).roomId === queriedRoom.id;
        if (!servesRoom) continue;
      }
      candidates.push({ ...item, host });
    }

    // Fallback to any straight-hosted opening of the requested kind on the floor if room query had none
    if (candidates.length === 0 && !selectedDoor && !selectedWindow) {
      for (const item of pool) {
        const host = floor.walls.find(w => w.id === item.opening.wallId);
        if (host && isPhysicalBoundary(host) && !host.arc) {
          candidates.push({ ...item, host });
        }
      }
    }

    if (candidates.length === 0) {
      return fail(
        'REJECTED_BY_CONSTRAINTS',
        `No straight physical wall-hosted ${wantDoor ? 'door' : 'window'} matched the selection on "${floor.name}".`,
      );
    }

    let lastConstraintError = 'Opening edit violates wall clearance or collision rules.';
    for (const cand of candidates) {
      const { opening, kind, host } = cand;
      const hostRooms = floor.rooms.filter(r => host.roomIds.includes(r.id));
      const unitIds = hostRooms.flatMap(r => (r.unitId ? [r.unitId] : []));
      if (
        isEntityLocked(
          floorId,
          [opening.id, host.id, ...hostRooms.map(r => r.id), ...unitIds],
          control,
        ) ||
        hostRooms.some(r => r.isFixed)
      ) {
        if (selectedDoor || selectedWindow || candidates.length === 1) {
          return fail(
            'REFUSED_LOCKED',
            `Opening '${opening.id}' or its host wall/room is locked and cannot be modified.`,
            [opening.id, host.id],
          );
        }
        continue;
      }

      const proj = projectOnSegment(opening.position, host.startPoint, host.endPoint);
      if (!proj || proj.length < 400) continue;

      const nextWidthMm =
        parsedIntent.action === 'RESIZE_OPENING'
          ? (parsedIntent.targetWidthMm ?? opening.width)
          : opening.width;

      const candidateOffsets: number[] = [];
      if (parsedIntent.action === 'RESIZE_OPENING') {
        candidateOffsets.push(proj.along, proj.length / 2);
      } else if (parsedIntent.moveOpeningMode === 'CENTER') {
        candidateOffsets.push(proj.length / 2);
      } else if (parsedIntent.moveOpeningMode === 'SHIFT_MM' && parsedIntent.shiftMm) {
        candidateOffsets.push(proj.along + parsedIntent.shiftMm);
      } else {
        // TOWARDS_CORNER: test safe corner offsets (150mm..350mm clear return from wall start/end)
        for (const clearance of [180, 220, 280, 350, 150]) {
          const lowCorner = nextWidthMm / 2 + clearance;
          const highCorner = proj.length - nextWidthMm / 2 - clearance;
          if (lowCorner < highCorner) {
            // Prefer moving towards the nearer corner unless already within 40mm of it
            const distLow = Math.abs(proj.along - lowCorner);
            const distHigh = Math.abs(proj.along - highCorner);
            if (distLow <= distHigh && distLow > 35) {
              candidateOffsets.push(lowCorner, highCorner);
            } else if (distHigh > 35) {
              candidateOffsets.push(highCorner, lowCorner);
            } else if (distLow > 35) {
              candidateOffsets.push(lowCorner);
            }
          }
        }
      }

      for (const rawOffset of candidateOffsets) {
        const offsetMm = Math.round(rawOffset);
        try {
          let nextBuilding: Building;
          if (floor.apartmentUnits?.length) {
            nextBuilding = editApartmentOpening(building, control, floorId, {
              action: 'update',
              id: opening.id,
              wallId: host.id,
              offsetMm,
              widthMm: nextWidthMm,
            });
          } else {
            const nextPos = proj.pointAt(offsetMm);
            if (!openingFitsApartmentWall(host, nextPos, nextWidthMm)) {
              throw new Error('Opening exceeds straight host wall return clearance.');
            }
            const nextFloor: Floor = {
              ...floor,
              doors:
                kind === 'door'
                  ? floor.doors.map(d =>
                      d.id === opening.id ? { ...d, position: nextPos, width: nextWidthMm, widthMm: nextWidthMm } : d,
                    )
                  : floor.doors,
              windows:
                kind === 'window'
                  ? floor.windows.map(w =>
                      w.id === opening.id ? { ...w, position: nextPos, width: nextWidthMm, widthMm: nextWidthMm } : w,
                    )
                  : floor.windows,
            };
            nextBuilding = {
              ...building,
              version: building.version + 1,
              updatedAt: new Date().toISOString(),
              floors: building.floors.map(f => (f.id === floorId ? nextFloor : f)),
            };
          }

          const check = verifyProposedBuilding(building, nextBuilding, floorId, new Set(unitIds));
          if (!check.ok) {
            lastConstraintError = check.error ?? lastConstraintError;
            continue;
          }

          const afterFloor = nextBuilding.floors.find(f => f.id === floorId)!;
          const afterOpening =
            kind === 'door'
              ? afterFloor.doors.find(d => d.id === opening.id)!
              : afterFloor.windows.find(w => w.id === opening.id)!;
          const diff = buildDiffFromProposal(floor, afterFloor);

          return {
            status: 'PREVIEW_READY',
            intentSource,
            parsedIntent,
            expectedRevision: building.version,
            baseRevisionDigest,
            proposedRevision: nextBuilding.version,
            resolvedEntityIds: [opening.id, host.id],
            affectedDependencies: {
              wallIds: diff.wallIds.length ? diff.wallIds : [host.id],
              roomIds: hostRooms.map(r => r.id),
              openingIds: [opening.id],
              unitIds: [...new Set(unitIds)],
            },
            roomAreaDeltas: diff.roomAreaDeltas,
            openingSummary: {
              openingId: opening.id,
              kind,
              hostWallId: host.id,
              beforeWidthMm: opening.width,
              afterWidthMm: afterOpening.width,
              beforePosition: opening.position,
              afterPosition: afterOpening.position,
            },
            validation: check.summary,
            message:
              parsedIntent.action === 'RESIZE_OPENING'
                ? `Verified ${kind} '${opening.id}' resize from ${opening.width} mm to ${afterOpening.width} mm on host wall '${host.id}'.`
                : `Verified ${kind} '${opening.id}' shift to (${Math.round(afterOpening.position.x)}, ${Math.round(afterOpening.position.y)}) mm along host wall '${host.id}' with full corner return clearance.`,
            proposedBuilding: nextBuilding,
          };
        } catch (err) {
          lastConstraintError = err instanceof Error ? err.message : String(err);
        }
      }
    }

    return fail('REJECTED_BY_CONSTRAINTS', lastConstraintError);
  }

  // Action 3: Shift interior partition / reduce passage width safely
  if (parsedIntent.action === 'ADJUST_PARTITION_OR_PASSAGE') {
    const selectedWall = normalizedSelected ? floor.walls.find(w => w.id === normalizedSelected) : undefined;
    if (selectedWall && isEntityLocked(floorId, [selectedWall.id], control)) {
      return fail('REFUSED_LOCKED', `Wall '${selectedWall.id}' is locked.`, [selectedWall.id]);
    }

    const internalWalls = selectedWall
      ? [selectedWall]
      : floor.walls.filter(
          w => !w.arc && !w.loadBearing && w.wallUse === 'INTERNAL_PARTITION' && w.roomIds.length === 2,
        );

    // Prioritize partitions bordering a passage/foyer/corridor or larger circulation hall when instruction mentions passage
    const wantsPassage = parsedIntent.targetRoomQuery === 'passage';
    const sortedWalls = [...internalWalls].sort((a, b) => {
      const score = (w: Wall) => {
        const rms = floor.rooms.filter(r => w.roomIds.includes(r.id));
        const hasPassage = rms.some(
          r =>
            r.type === RoomType.Corridor ||
            r.type === RoomType.Foyer ||
            /passage|corridor|foyer|dining|living/i.test(r.name),
        );
        return wantsPassage && hasPassage ? 0 : 1;
      };
      return score(a) - score(b);
    });

    const baseBuilding = relaxAreaTargetLockForExplicitUserEdit(building);
    let lastError = 'No unlocked internal partition with continuous straight returns could shift without violating room/circulation minimums.';

    for (const wall of sortedWalls) {
      const adjRooms = floor.rooms.filter(r => wall.roomIds.includes(r.id));
      const unitIds = adjRooms.flatMap(r => (r.unitId ? [r.unitId] : []));
      if (isEntityLocked(floorId, [wall.id, ...adjRooms.map(r => r.id), ...unitIds], control)) {
        if (selectedWall) {
          return fail('REFUSED_LOCKED', `Partition '${wall.id}' or an adjacent room/flat is locked.`, [wall.id]);
        }
        continue;
      }

      const passageRoom = adjRooms.find(
        r =>
          r.type === RoomType.Corridor ||
          r.type === RoomType.Foyer ||
          /passage|corridor|foyer/i.test(r.name),
      );
      const magnitudes = parsedIntent.shiftMm
        ? [parsedIntent.shiftMm]
        : [100, -100, 75, -75, 50, -50];

      for (const shift of magnitudes) {
        try {
          const candidate = moveApartmentPartition(baseBuilding, control, floorId, wall.id, shift);
          const afterFloor = candidate.floors.find(f => f.id === floorId)!;
          if (passageRoom) {
            const afterPassage = afterFloor.rooms.find(r => r.id === passageRoom.id)!;
            const beforeSpan = Math.min(passageRoom.width, passageRoom.height);
            const afterSpan = Math.min(afterPassage.width, afterPassage.height);
            if (afterSpan < NBC_MIN_PASSAGE_CLEAR_WIDTH_MM) {
              lastError = `Cannot reduce "${passageRoom.name}" below ${NBC_MIN_PASSAGE_CLEAR_WIDTH_MM} mm clear circulation width.`;
              continue;
            }
            if (wantsPassage && !parsedIntent.shiftMm && afterPassage.area >= passageRoom.area && beforeSpan > NBC_MIN_PASSAGE_CLEAR_WIDTH_MM + 60) {
              // Prefer the sign that actually reduces passage width when requested
              continue;
            }
          }

          const check = verifyProposedBuilding(building, candidate, floorId, new Set(unitIds));
          if (!check.ok) {
            lastError = check.error ?? lastError;
            continue;
          }
          const diff = buildDiffFromProposal(floor, afterFloor);
          return {
            status: 'PREVIEW_READY',
            intentSource,
            parsedIntent,
            expectedRevision: building.version,
            baseRevisionDigest,
            proposedRevision: candidate.version,
            resolvedEntityIds: [wall.id, ...adjRooms.map(r => r.id)],
            affectedDependencies: {
              wallIds: diff.wallIds,
              roomIds: diff.roomIds,
              openingIds: diff.openingIds,
              unitIds: diff.unitIds,
            },
            roomAreaDeltas: diff.roomAreaDeltas,
            openingSummary: null,
            validation: check.summary,
            message: `Verified ${Math.abs(shift)} mm interior partition shift on '${wall.id}' preserving >= ${NBC_MIN_PASSAGE_CLEAR_WIDTH_MM} mm clear circulation and exact flat boundary closure.`,
            proposedBuilding: candidate,
          };
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
    }

    return fail('REJECTED_BY_CONSTRAINTS', lastError);
  }

  // Action 1: Resize room carpet area
  const targetRoom = resolveRoomByQuery(floor, parsedIntent.targetRoomQuery, normalizedSelected);
  if (!targetRoom) {
    return fail('REJECTED_BY_CONSTRAINTS', `Could not locate target room on "${floor.name}".`);
  }

  if (
    isEntityLocked(floorId, [targetRoom.id, targetRoom.unitId], control) ||
    targetRoom.isFixed ||
    targetRoom.type === RoomType.Staircase ||
    targetRoom.type === RoomType.Lift
  ) {
    return fail(
      'REFUSED_LOCKED',
      `Room "${targetRoom.name}" (or its flat/core) is locked or protected and cannot be resized.`,
      [targetRoom.id],
    );
  }

  const currentAreaMm2 = targetRoom.boundary.points.length >= 3 ? polygonArea(targetRoom.boundary) : targetRoom.area;
  const requestedAreaMm2 = parsedIntent.targetAreaMm2
    ? Math.round(parsedIntent.targetAreaMm2)
    : parsedIntent.targetAreaSqM
      ? Math.round(parsedIntent.targetAreaSqM * SQMM_PER_SQM)
      : parsedIntent.targetAreaSqFt
        ? Math.round(parsedIntent.targetAreaSqFt * SQMM_PER_SQFT)
        : Math.round(currentAreaMm2 * (1 + (parsedIntent.areaDeltaPercent ?? 8) / 100));

  const baseBuilding = relaxAreaTargetLockForExplicitUserEdit(building);
  const allowedUnits = new Set(targetRoom.unitId ? [targetRoom.unitId] : []);

  // Strategy 1A: Try moveApartmentPartition on any unlocked internal partition of targetRoom first (exact topological & opening preservation!)
  if (floor.apartmentUnits?.length) {
    const roomPartitions = floor.walls.filter(
      w =>
        !w.arc &&
        !w.loadBearing &&
        w.wallUse === 'INTERNAL_PARTITION' &&
        w.roomIds.includes(targetRoom.id) &&
        w.roomIds.length === 2,
    );
    const wantIncrease = requestedAreaMm2 >= currentAreaMm2;
    for (const part of roomPartitions) {
      const wallLen = Math.hypot(part.endPoint.x - part.startPoint.x, part.endPoint.y - part.startPoint.y) || 3000;
      const idealShiftMag = Math.min(350, Math.max(50, Math.round(Math.abs(requestedAreaMm2 - currentAreaMm2) / wallLen / 25) * 25));
      for (const mag of [idealShiftMag, 150, 100, 75, 50]) {
        for (const sign of [1, -1]) {
          try {
            const cand = moveApartmentPartition(baseBuilding, control, floorId, part.id, mag * sign);
            const afterFloor = cand.floors.find(f => f.id === floorId)!;
            const afterTarget = afterFloor.rooms.find(r => r.id === targetRoom.id)!;
            const afterArea = polygonArea(afterTarget.boundary);
            if (wantIncrease ? afterArea <= currentAreaMm2 + 1000 : afterArea >= currentAreaMm2 - 1000) continue;
            const check = verifyProposedBuilding(building, cand, floorId, allowedUnits);
            if (!check.ok) continue;
            const diff = buildDiffFromProposal(floor, afterFloor);
            return {
              status: 'PREVIEW_READY',
              intentSource,
              parsedIntent,
              expectedRevision: building.version,
              baseRevisionDigest,
              proposedRevision: cand.version,
              resolvedEntityIds: [targetRoom.id, part.id],
              affectedDependencies: {
                wallIds: diff.wallIds,
                roomIds: diff.roomIds,
                openingIds: diff.openingIds,
                unitIds: diff.unitIds,
              },
              roomAreaDeltas: diff.roomAreaDeltas,
              openingSummary: null,
              validation: check.summary,
              message: `Verified "${targetRoom.name}" carpet area adjustment from ${(currentAreaMm2 / SQMM_PER_SQM).toFixed(2)} m² to ${(afterArea / SQMM_PER_SQM).toFixed(2)} m² via internal partition '${part.id}' while keeping all other flats untouched.`,
              proposedBuilding: cand,
            };
          } catch {
            // Try next shift candidate
          }
        }
      }
    }
  }

  // Strategy 1B: Parametric room area optimizer / local setback margin expansion
  const opt = optimizeRoomArea(baseBuilding, targetRoom.id, {
    targetAreaMm2: requestedAreaMm2,
    toleranceMm2: Math.max(250_000, Math.abs(requestedAreaMm2 - currentAreaMm2) * 0.45),
    allowAdjacentAdjustments: true,
    preserveStructural: true,
    control,
  });

  const allCandidates = [...opt.candidates];
  if (allCandidates.length === 0 && requestedAreaMm2 > currentAreaMm2 && !control.footprintLocked) {
    const modeA = expandFlatIntoSetbackMargin(baseBuilding, targetRoom.id, requestedAreaMm2, {
      control,
      synchronizeMatchingFloors: false,
    });
    allCandidates.push(...modeA.candidates);
  }

  for (const cand of allCandidates) {
    let candidateBuilding = cand.building;
    if (floor.apartmentUnits?.length) {
      try {
        const editedFl = candidateBuilding.floors.find(f => f.id === floorId)!;
        candidateBuilding = acceptApartmentFloorEdit(baseBuilding, editedFl);
      } catch {
        continue;
      }
    }
    const check = verifyProposedBuilding(building, candidateBuilding, floorId, allowedUnits);
    if (!check.ok) continue;
    const afterFloor = candidateBuilding.floors.find(f => f.id === floorId)!;
    const afterTarget = afterFloor.rooms.find(r => r.id === targetRoom.id)!;
    const afterArea = polygonArea(afterTarget.boundary);
    const diff = buildDiffFromProposal(floor, afterFloor);
    return {
      status: 'PREVIEW_READY',
      intentSource,
      parsedIntent,
      expectedRevision: building.version,
      baseRevisionDigest,
      proposedRevision: candidateBuilding.version,
      resolvedEntityIds: [targetRoom.id],
      affectedDependencies: {
        wallIds: diff.wallIds,
        roomIds: diff.roomIds,
        openingIds: diff.openingIds,
        unitIds: diff.unitIds,
      },
      roomAreaDeltas: diff.roomAreaDeltas,
      openingSummary: null,
      validation: check.summary,
      message: `Verified "${targetRoom.name}" carpet area optimization from ${(currentAreaMm2 / SQMM_PER_SQM).toFixed(2)} m² to ${(afterArea / SQMM_PER_SQM).toFixed(2)} m² (${cand.name}).`,
      proposedBuilding: candidateBuilding,
    };
  }

  return fail(
    'REJECTED_BY_CONSTRAINTS',
    opt.infeasibilityReason ??
      `Cannot resize "${targetRoom.name}" to ${(requestedAreaMm2 / SQMM_PER_SQM).toFixed(2)} m² without violating structural columns, adjacent room minimums, or flat closure.`,
    [targetRoom.id],
  );
}

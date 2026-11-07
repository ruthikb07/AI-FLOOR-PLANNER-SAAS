/**
 * Persistence Layer: LocalStorage & JSON Import/Export.
 * Strictly adheres to project envelope versioning and domain validation.
 */

import type { Building, BuildingBudgetIntent, CandidatePlan, FootprintIntent, GenerationControlState, SpaceProgram } from '@ai-floor-planner/core';
import type { FloorPlanImagePromptRequest } from '@ai-floor-planner/ai-orchestration';
import {
  serializeBuilding,
  deserializeBuilding,
  validateBuildingSchema,
  createBuilding,
  addRoom,
  addDoor,
  addWindow,
  addWall,
  RoomType,
  DoorType,
  WindowType,
  WallType,
  Direction,
  deriveSpaceProgramFromBuilding,
  deriveFootprintIntent,
  createGenerationControlState,
  validateGenerationControl,
  createUnreviewedBudget,
  refreshBudgetApproval,
} from '@ai-floor-planner/core';

export interface ProjectEnvelope {
  readonly schemaVersion: number;
  readonly projectId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly building: Building;
  readonly requiredRoomCounts?: Partial<Record<RoomType, number>>;
  readonly category?: BuildingCategory;
  readonly status?: ProjectLifecycleStatus;
  readonly spaceProgram?: SpaceProgram;
  readonly footprintIntent?: FootprintIntent;
  readonly buildingBudget?: BuildingBudgetIntent;
  /** null is a save-time tombstone used to invalidate stale alternatives. */
  readonly generationSession?: GenerationSession | null;
  readonly generationControl?: GenerationControlState;
  /** Latest AI concept image. Original artifacts remain immutable server-side. */
  readonly floorPlanImage?: FloorPlanImageSession | null;
  /** Gemini architectural evaluation of the accepted plan (PRD 25). Never validity. */
  readonly architecturalEvaluation?: ArchitecturalEvaluation | null;
}

export interface GenerationSession {
  readonly requestHash?: string;
  readonly requestSeed?: number;
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly selectedCandidateId?: string;
  readonly candidates: readonly CandidatePlan[];
}

/**
 * Persisted Gemini architectural evaluation of an accepted plan (PRD 25).
 * Stored separately from validation: score is never treated as validity (PRD 26).
 */
export interface ArchitecturalEvaluation {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly planId: string;
  readonly generatedAt: string;
  readonly overallScore: number;
  readonly requirementSatisfaction: number;
  readonly spatialQuality: number;
  readonly circulation: number;
  readonly adjacency: number;
  readonly zoning: number;
  readonly privacy: number;
  readonly daylight: number;
  readonly efficiency: number;
  readonly roomProportions: number;
  readonly orientation: number;
  readonly strengths: readonly string[];
  readonly concerns: readonly string[];
  readonly rationale: string;
  readonly model: string;
}

/**
 * Persisted AI concept image session (Master PRD Phase 2 §17/§18).
 * Records the reproducible request plus the immutable generation identity.
 */
export interface FloorPlanImageSession {
  readonly schemaVersion: 1;
  readonly generationId: string;
  readonly seed: number;
  readonly attempt: number;
  readonly generatedAt: string;
  readonly promptVersion: number;
  readonly model: string;
  readonly provider: string;
  readonly mimeType: string;
  readonly imageBase64: string;
  readonly request: FloorPlanImagePromptRequest;
  /** Canonical building identity/version the image was generated from. */
  readonly contextSignature: string;
}

export const BUILDING_CATEGORIES = ['residential', 'commercial', 'mixed_use', 'educational'] as const;
export type BuildingCategory = (typeof BUILDING_CATEGORIES)[number];

/**
 * Tolerant reader for the persisted AI concept image session. An unknown or
 * corrupt entry yields undefined — the UI then offers a fresh generation rather
 * than displaying a broken image or inventing one.
 */
function normalizeArchitecturalEvaluation(value: unknown): ArchitecturalEvaluation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const evaluation = value as Partial<ArchitecturalEvaluation>;
  if (
    evaluation.schemaVersion !== 1
    || typeof evaluation.projectId !== 'string'
    || typeof evaluation.planId !== 'string'
    || typeof evaluation.overallScore !== 'number'
    || !Array.isArray(evaluation.strengths)
    || !Array.isArray(evaluation.concerns)
  ) return undefined;
  return evaluation as ArchitecturalEvaluation;
}

function normalizeFloorPlanImageSession(value: unknown): FloorPlanImageSession | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const session = value as Partial<FloorPlanImageSession>;
  if (
    session.schemaVersion !== 1
    || typeof session.generationId !== 'string'
    || typeof session.imageBase64 !== 'string'
    || session.imageBase64.length === 0
    || typeof session.seed !== 'number'
    || typeof session.mimeType !== 'string'
    || !session.request
    || typeof session.request !== 'object'
  ) return undefined;
  return {
    ...session as FloorPlanImageSession,
    attempt: typeof session.attempt === 'number' ? session.attempt : 0,
    contextSignature: typeof session.contextSignature === 'string' ? session.contextSignature : '',
  };
}

export const PROJECT_LIFECYCLE_STATUSES = [
  'CONCEPT', 'DESIGNING', 'ANALYZING', 'GENERATED', 'REVIEW_REQUIRED', 'REVIEWED', 'RELEASED',
] as const;
export type ProjectLifecycleStatus = (typeof PROJECT_LIFECYCLE_STATUSES)[number];

export const CURRENT_PROJECT_SCHEMA_VERSION = 9;

export interface ProjectHeader {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly roomCount: number;
  readonly plotArea: number;
  readonly floorCount: number;
  readonly plotWidth: number;
  readonly plotDepth: number;
  readonly category: BuildingCategory;
  readonly status: ProjectLifecycleStatus;
}

const STORAGE_KEY_PREFIX = 'ai_floor_planner_proj_';
const ACTIVE_PROJECT_KEY = 'ai_floor_planner_active_id';

function normalizeBuildingCategory(value: unknown): BuildingCategory {
  return BUILDING_CATEGORIES.includes(value as BuildingCategory)
    ? value as BuildingCategory
    : 'residential';
}

function normalizeProjectStatus(value: unknown): ProjectLifecycleStatus {
  return PROJECT_LIFECYCLE_STATUSES.includes(value as ProjectLifecycleStatus)
    ? value as ProjectLifecycleStatus
    : 'CONCEPT';
}

function normalizeRequiredRoomCounts(input: unknown): Partial<Record<RoomType, number>> {
  if (!input || typeof input !== 'object') return {};
  const allowedTypes = new Set<string>(Object.values(RoomType));
  const counts: Partial<Record<RoomType, number>> = {};
  for (const [type, rawCount] of Object.entries(input as Record<string, unknown>)) {
    if (!allowedTypes.has(type) || !Number.isFinite(rawCount)) continue;
    const count = Math.max(0, Math.floor(rawCount as number));
    if (count > 0) counts[type as RoomType] = count;
  }
  return counts;
}

export class LocalStorageProjectStorage {
  save(envelope: ProjectEnvelope): void {
    try {
      const previousRaw = localStorage.getItem(STORAGE_KEY_PREFIX + envelope.projectId);
      const previousProgram = previousRaw
        ? (JSON.parse(previousRaw).spaceProgram as SpaceProgram | undefined)
        : undefined;
      const previousFootprint = previousRaw
        ? (JSON.parse(previousRaw).footprintIntent as FootprintIntent | undefined)
        : undefined;
      const previousGeneration = previousRaw
        ? (JSON.parse(previousRaw).generationSession as GenerationSession | undefined)
        : undefined;
      const previousControl = previousRaw
        ? (JSON.parse(previousRaw).generationControl as GenerationControlState | undefined)
        : undefined;
      const previousImage = previousRaw
        ? (JSON.parse(previousRaw).floorPlanImage as FloorPlanImageSession | undefined)
        : undefined;
      const category = normalizeBuildingCategory(envelope.category);
      const candidateProgram = envelope.spaceProgram ?? previousProgram;
      const spaceProgram = candidateProgram?.category === category
        ? candidateProgram
        : deriveSpaceProgramFromBuilding(envelope.building, category);
      const footprintIntent = envelope.footprintIntent ?? previousFootprint ?? deriveFootprintIntent(envelope.building);
      const generationControl = validateGenerationControl(envelope.generationControl ?? previousControl ?? createGenerationControlState(), envelope.building).state;
      const previousBudget = previousRaw ? JSON.parse(previousRaw).buildingBudget : undefined;
      const buildingBudget = normalizeBudget(envelope.buildingBudget ?? previousBudget, { building: envelope.building, program: spaceProgram, footprint: footprintIntent, generationControl });
      const serialized = JSON.stringify({
        ...envelope,
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        category,
        spaceProgram,
        buildingBudget,
        footprintIntent: envelope.footprintIntent ?? previousFootprint ?? deriveFootprintIntent(envelope.building),
        generationSession: envelope.generationSession === null
          ? undefined
          : envelope.generationSession ?? previousGeneration,
        floorPlanImage: envelope.floorPlanImage === null
          ? undefined
          : envelope.floorPlanImage ?? previousImage,
        generationControl: validateGenerationControl(
          envelope.generationControl ?? previousControl ?? createGenerationControlState(),
          envelope.building,
        ).state,
        building: JSON.parse(serializeBuilding(envelope.building)),
      });
      localStorage.setItem(STORAGE_KEY_PREFIX + envelope.projectId, serialized);
      localStorage.setItem(ACTIVE_PROJECT_KEY, envelope.projectId);
    } catch (err) {
      console.error('Failed to save project to LocalStorage:', err);
      throw new Error('Storage quota exceeded or storage unavailable.');
    }
  }

  load(projectId: string): ProjectEnvelope | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PREFIX + projectId);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const building = deserializeBuilding(JSON.stringify(parsed.building));
      const category = normalizeBuildingCategory(parsed.category);
      const savedProgram = parsed.spaceProgram as SpaceProgram | undefined;
      const savedFootprint = parsed.footprintIntent as FootprintIntent | undefined;
      const savedGeneration = parsed.generationSession as GenerationSession | undefined;
      const savedControl = parsed.generationControl as GenerationControlState | undefined;
      const program = savedProgram?.category === category ? savedProgram : deriveSpaceProgramFromBuilding(building, category);
      const footprint = savedFootprint ?? deriveFootprintIntent(building);
      const control = validateGenerationControl(savedControl, building).state;
      return {
        ...parsed,
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        building,
        requiredRoomCounts: normalizeRequiredRoomCounts(parsed.requiredRoomCounts),
        buildingBudget: normalizeBudget(parsed.buildingBudget, { building, program, footprint, generationControl: control }),
        category,
        status: normalizeProjectStatus(parsed.status),
        spaceProgram: savedProgram?.category === category
          ? savedProgram
          : deriveSpaceProgramFromBuilding(building, category),
        footprintIntent: savedFootprint ?? deriveFootprintIntent(building),
        generationSession: savedGeneration ? {
          ...savedGeneration,
          candidates: savedGeneration.candidates.map(candidate => ({
            ...candidate,
            building: deserializeBuilding(JSON.stringify(candidate.building)),
          })),
        } : undefined,
        floorPlanImage: normalizeFloorPlanImageSession(parsed.floorPlanImage),
        architecturalEvaluation: normalizeArchitecturalEvaluation(parsed.architecturalEvaluation),
        generationControl: validateGenerationControl(savedControl, building).state,
      };
    } catch (err) {
      console.error(`Failed to load project ${projectId}:`, err);
      return null;
    }
  }

  list(): ProjectHeader[] {
    const list: ProjectHeader[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const data = JSON.parse(raw);
            list.push({
              id: data.projectId,
              name: data.name ?? 'Untitled Project',
              updatedAt: data.updatedAt ?? new Date().toISOString(),
              roomCount: data.building?.floors?.reduce(
                (count: number, floor: { rooms?: unknown[] }) => count + (floor.rooms?.length ?? 0),
                0,
              ) ?? 0,
              plotArea: data.building?.site?.plotArea ?? 0,
              floorCount: data.building?.site?.plannedFloorCount ?? data.building?.floors?.length ?? 0,
              plotWidth: data.building?.site?.plotWidth ?? 0,
              plotDepth: data.building?.site?.plotDepth ?? 0,
              category: normalizeBuildingCategory(data.category),
              status: normalizeProjectStatus(data.status),
            });
          }
        }
      }
    } catch (e) {
      console.warn('Error reading project list from LocalStorage', e);
    }
    return list.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
  }

  delete(projectId: string): void {
    localStorage.removeItem(STORAGE_KEY_PREFIX + projectId);
    if (localStorage.getItem(ACTIVE_PROJECT_KEY) === projectId) {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
  }

  getActiveProjectId(): string | null {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  }

  setActiveProjectId(projectId: string): boolean {
    if (!localStorage.getItem(STORAGE_KEY_PREFIX + projectId)) return false;
    localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
    return true;
  }
}

export const projectStorage = new LocalStorageProjectStorage();

function normalizeBudget(value: unknown, context: import('@ai-floor-planner/core').ReviewedIntentContext): BuildingBudgetIntent {
  if (!value || typeof value !== 'object') return createUnreviewedBudget();
  const budget = value as BuildingBudgetIntent;
  if (budget.schemaVersion !== 1 || !budget.floorTargets || typeof budget.floorTargets !== 'object' || Array.isArray(budget.floorTargets)) return createUnreviewedBudget();
  return refreshBudgetApproval(context, budget);
}

/** Export project envelope as downloaded JSON file */
export function exportProjectAsJsonFile(envelope: ProjectEnvelope): void {
  const data = JSON.stringify(
    {
      ...envelope,
      building: JSON.parse(serializeBuilding(envelope.building)),
    },
    null,
    2,
  );
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${envelope.name.toLowerCase().replace(/\s+/g, '_')}_floorplan.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Validate and import project from JSON string */
export function parseAndValidateProjectJson(jsonString: string): ProjectEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error('Invalid JSON file format.');
  }

  const record = parsed as Record<string, unknown>;
  if (!record || typeof record !== 'object') {
    throw new Error('Imported JSON is not an object.');
  }

  const buildingData = (record.building ?? record) as Record<string, unknown>;
  const validationErrors = validateBuildingSchema(buildingData);
  if (validationErrors.length > 0) {
    throw new Error(`Building schema validation failed: ${validationErrors.map((e: any) => `${e.path}: ${e.message}`).join(', ')}`);
  }

  const building = deserializeBuilding(JSON.stringify(buildingData));
  const projectId = (record.projectId as string) ?? building.id;
  const name = (record.name as string) ?? building.name;

  const category = normalizeBuildingCategory(record.category);
  const importedProgram = record.spaceProgram as SpaceProgram | undefined;
  const importedFootprint = record.footprintIntent as FootprintIntent | undefined;
  const importedGeneration = record.generationSession as GenerationSession | undefined;
  const importedControl = record.generationControl as GenerationControlState | undefined;
  const program = importedProgram?.category === category ? importedProgram : deriveSpaceProgramFromBuilding(building, category);
  const footprint = importedFootprint ?? deriveFootprintIntent(building);
  return {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    projectId,
    name,
    createdAt: (record.createdAt as string) ?? building.createdAt,
    updatedAt: (record.updatedAt as string) ?? new Date().toISOString(),
    building,
    requiredRoomCounts: normalizeRequiredRoomCounts(record.requiredRoomCounts),
    buildingBudget: normalizeBudget(record.buildingBudget, { building, program, footprint, generationControl: validateGenerationControl(importedControl, building).state }),
    category,
    status: normalizeProjectStatus(record.status),
    spaceProgram: importedProgram?.category === category
      ? importedProgram
      : deriveSpaceProgramFromBuilding(building, category),
    footprintIntent: importedFootprint ?? deriveFootprintIntent(building),
    generationSession: importedGeneration ? {
      ...importedGeneration,
      candidates: importedGeneration.candidates.map(candidate => ({
        ...candidate,
        building: deserializeBuilding(JSON.stringify(candidate.building)),
      })),
    } : undefined,
    generationControl: validateGenerationControl(importedControl, building).state,
  };
}

/** Create Canonical 30×50 2BHK Plan via Authoritative Domain APIs */
export function createCanonical30x50_2BHK(
  projectName = 'Canonical 30×50 2BHK',
  projectId = `proj_${Date.now()}`,
): Building {
  // 30ft x 50ft = 9144mm x 15240mm
  const building = createBuilding({
    projectId,
    name: projectName,
    site: {
      plotWidth: 9144,
      plotDepth: 15240,
      roadFacing: Direction.North,
      setbacks: { front: 1500, rear: 1000, left: 1000, right: 1000 },
    },
    floors: [
      {
        buildingId: '',
        level: 0,
        name: 'Ground Floor',
        boundary: {
          points: [
            { x: 1000, y: 1500 },
            { x: 8144, y: 1500 },
            { x: 8144, y: 14240 },
            { x: 1000, y: 14240 },
          ],
        },
      },
    ],
  });

  const floor0 = building.floors[0]!;
  const floorId = floor0.id;

  // Add Rooms
  let b = addRoom(building, floorId, {
    floorId,
    type: RoomType.Living,
    name: 'Living Room',
    x: 1000,
    y: 1500,
    width: 4000,
    height: 4800,
  });

  b = addRoom(b, floorId, {
    floorId,
    type: RoomType.Dining,
    name: 'Dining / Hall',
    x: 5000,
    y: 1500,
    width: 3144,
    height: 4800,
  });

  b = addRoom(b, floorId, {
    floorId,
    type: RoomType.Kitchen,
    name: 'Kitchen',
    x: 5000,
    y: 6300,
    width: 3144,
    height: 3200,
  });

  b = addRoom(b, floorId, {
    floorId,
    type: RoomType.Bedroom,
    name: 'Master Bedroom',
    x: 1000,
    y: 6300,
    width: 4000,
    height: 4000,
  });

  b = addRoom(b, floorId, {
    floorId,
    type: RoomType.Bedroom,
    name: 'Bedroom 2',
    x: 1000,
    y: 10300,
    width: 4000,
    height: 3940,
  });

  b = addRoom(b, floorId, {
    floorId,
    type: RoomType.Bathroom,
    name: 'Common Bath',
    x: 5000,
    y: 9500,
    width: 3144,
    height: 2200,
  });

  // Exterior Perimeter Walls
  b = addWall(b, floorId, {
    floorId,
    startPoint: { x: 1000, y: 1500 },
    endPoint: { x: 8144, y: 1500 },
    type: WallType.External,
    thickness: 230,
  });
  b = addWall(b, floorId, {
    floorId,
    startPoint: { x: 8144, y: 1500 },
    endPoint: { x: 8144, y: 14240 },
    type: WallType.External,
    thickness: 230,
  });
  b = addWall(b, floorId, {
    floorId,
    startPoint: { x: 8144, y: 14240 },
    endPoint: { x: 1000, y: 14240 },
    type: WallType.External,
    thickness: 230,
  });
  b = addWall(b, floorId, {
    floorId,
    startPoint: { x: 1000, y: 14240 },
    endPoint: { x: 1000, y: 1500 },
    type: WallType.External,
    thickness: 230,
  });

  // Interior Dividing Walls
  b = addWall(b, floorId, {
    floorId,
    startPoint: { x: 5000, y: 1500 },
    endPoint: { x: 5000, y: 14240 },
    type: WallType.Internal,
    thickness: 115,
  });
  b = addWall(b, floorId, {
    floorId,
    startPoint: { x: 5000, y: 9500 },
    endPoint: { x: 8144, y: 9500 },
    type: WallType.Internal,
    thickness: 115,
  });
  b = addWall(b, floorId, {
    floorId,
    startPoint: { x: 1000, y: 6300 },
    endPoint: { x: 8144, y: 6300 },
    type: WallType.Internal,
    thickness: 115,
  });
  b = addWall(b, floorId, {
    floorId,
    startPoint: { x: 1000, y: 10300 },
    endPoint: { x: 8144, y: 10300 },
    type: WallType.Internal,
    thickness: 115,
  });

  const wallList = b.floors[0]!.walls;
  const frontWallId = wallList[0]?.id || 'ext_wall_north';

  // Add Doors & Windows
  b = addDoor(b, floorId, {
    floorId,
    wallId: frontWallId,
    position: { x: 3000, y: 1500 },
    width: 1000,
    height: 2100,
    type: DoorType.Single,
    connectsRooms: ['__outside__', b.floors[0]!.rooms[0]!.id],
  });

  const rooms = b.floors[0]!.rooms;
  const addInternalDoor = (
    wallId: string,
    position: { x: number; y: number },
    roomA: number,
    roomB: number,
  ) => {
    b = addDoor(b, floorId, {
      floorId,
      wallId,
      position,
      width: 900,
      height: 2100,
      type: DoorType.Single,
      connectsRooms: [rooms[roomA]!.id, rooms[roomB]!.id],
    });
  };
  addInternalDoor(wallList[4]!.id, { x: 5000, y: 2500 }, 0, 1);
  addInternalDoor(wallList[6]!.id, { x: 2000, y: 6300 }, 0, 3);
  addInternalDoor(wallList[6]!.id, { x: 6000, y: 6300 }, 1, 2);
  addInternalDoor(wallList[7]!.id, { x: 2000, y: 10300 }, 3, 4);
  addInternalDoor(wallList[5]!.id, { x: 6000, y: 9500 }, 2, 5);

  b = addWindow(b, floorId, {
    floorId,
    wallId: wallList[3]?.id || 'ext_wall_west',
    position: { x: 1000, y: 3500 },
    width: 1500,
    height: 1200,
    sillHeight: 900,
    type: WindowType.Sliding,
    roomId: b.floors[0]!.rooms[0]!.id,
  });

  const addExteriorWindow = (wallId: string, position: { x: number; y: number }, roomIndex: number) => {
    b = addWindow(b, floorId, {
      floorId,
      wallId,
      position,
      width: 1000,
      height: 1200,
      sillHeight: 900,
      type: WindowType.Sliding,
      roomId: rooms[roomIndex]!.id,
    });
  };
  addExteriorWindow(wallList[1]!.id, { x: 8144, y: 2500 }, 1);
  addExteriorWindow(wallList[1]!.id, { x: 8144, y: 7000 }, 2);
  addExteriorWindow(wallList[3]!.id, { x: 1000, y: 7000 }, 3);
  addExteriorWindow(wallList[3]!.id, { x: 1000, y: 11000 }, 4);
  addExteriorWindow(wallList[1]!.id, { x: 8144, y: 10000 }, 5);

  return b;
}

/** Create Empty Plot Building */
export function createEmptyPlot(widthMm: number, depthMm: number, name: string): Building {
  return createBuilding({
    projectId: `proj_${Date.now()}`,
    name: name || 'Custom Plot Plan',
    site: {
      plotWidth: widthMm,
      plotDepth: depthMm,
      plannedFloorCount: 1,
      roadFacing: Direction.North,
      setbacks: { front: 1500, rear: 1000, left: 1000, right: 1000 },
    },
    floors: [{ buildingId: '', level: 0, name: 'Ground Floor' }],
  });
}

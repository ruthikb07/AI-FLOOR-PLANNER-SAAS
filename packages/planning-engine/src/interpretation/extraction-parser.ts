/**
 * Phase 3 - Parse untrusted vision output into a typed ExtractedPlan.
 *
 * Gemini output is UNTRUSTED. This parser only maps structurally valid values
 * and rejects malformed payloads; it never fills in missing geometry or
 * silently substitutes defaults for rooms the model failed to return.
 */

import type {
  DiagnosticFragment,
  ExtractedBoundary,
  ExtractedCoreElement,
  ExtractedDoor,
  ExtractedFlat,
  ExtractedParking,
  ExtractedPlan,
  ExtractedRoom,
  ExtractedStair,
  ExtractedWindow,
  ExtractionMetadata,
} from './extraction';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function pointList(value: unknown): ExtractedBoundary | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const points: { x: number; y: number }[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const x = record ? num(record.x) : null;
    const y = record ? num(record.y) : null;
    if (x === null || y === null) return null;
    points.push({ x, y });
  }
  return { points };
}

const DOOR_TYPES = new Set(['single', 'double', 'sliding', 'open_passage', 'unknown']);
const SWINGS = new Set(['inward', 'outward', 'left', 'right', 'unknown']);

/** Build the extraction metadata for a specific image and site. */
export function createExtractionMetadata(params: {
  readonly imageWidePixels: number;
  readonly imageTallPixels: number;
  readonly plotWidth: number;
  readonly plotDepth: number;
  readonly orientation: number;
  readonly roadFacing: string;
  readonly extractionSource: string;
  readonly confidence: string;
}): ExtractionMetadata {
  const imageAspectRatio = params.imageTallPixels > 0 ? params.imageWidePixels / params.imageTallPixels : 0;
  const plotAspectRatio = params.plotDepth > 0 ? params.plotWidth / params.plotDepth : 0;
  return {
    imageWidePixels: params.imageWidePixels,
    imageTallPixels: params.imageTallPixels,
    imageAspectRatio,
    plotAspectRatio,
    aspectMismatchRatio: plotAspectRatio > 0 ? Math.abs(imageAspectRatio - plotAspectRatio) / plotAspectRatio : 0,
    orientationDegrees: params.orientation,
    roadFacing: params.roadFacing,
    extractionSource: params.extractionSource,
    confidence: params.confidence,
    normalizedAt: '',
  };
}

/**
 * Parse a raw vision payload into an ExtractedPlan. Returns `null` when the
 * payload cannot be trusted (missing boundary or room geometry).
 */
export function parseExtractionPayload(
  payload: unknown,
  metadata: ExtractionMetadata,
  planId: string,
): { plan: ExtractedPlan | null; diagnostics: DiagnosticFragment[] } {
  const diagnostics: DiagnosticFragment[] = [];
  const source = asRecord(payload);
  if (!source) {
    return { plan: null, diagnostics: [{ code: 'EXTRACTION_PAYLOAD_INVALID', severity: 'error', message: 'The vision response was not a JSON object.' }] };
  }

  const boundary = pointList(asRecord(source.boundary)?.points);
  if (!boundary) {
    return { plan: null, diagnostics: [{ code: 'EXTRACTION_PAYLOAD_BOUNDARY_INVALID', severity: 'error', message: 'The vision response did not contain a valid building boundary polygon.' }] };
  }

  const rooms: ExtractedRoom[] = [];
  for (const entry of Array.isArray(source.rooms) ? source.rooms : []) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = str(record.id);
    const name = str(record.name);
    const type = str(record.type) ?? name;
    const x = num(record.x);
    const y = num(record.y);
    const width = num(record.width);
    const height = num(record.height);
    if (!id || !name || !type || x === null || y === null || width === null || height === null) {
      diagnostics.push({ code: 'EXTRACTION_ROOM_SKIPPED', severity: 'warning', message: `Room "${name ?? id ?? 'unknown'}" was skipped because its geometry was incomplete.` });
      continue;
    }
    if (width <= 0 || height <= 0) {
      diagnostics.push({ code: 'EXTRACTION_ROOM_SKIPPED', severity: 'warning', message: `Room "${name}" was skipped because its extracted size was not positive.` });
      continue;
    }
    const flatId = str(record.flatId);
    rooms.push({
      id, name, type, imageX: x, imageY: y, imageWidth: width, imageHeight: height,
      imageArea: width * height, imageMinWidth: width, imageMinHeight: height,
      ...(flatId ? { flatId } : {}),
    });
  }

  if (rooms.length === 0) {
    return { plan: null, diagnostics: [...diagnostics, { code: 'EXTRACTION_NO_ROOMS', severity: 'error', message: 'The vision response contained no usable rooms.' }] };
  }

  const doors: ExtractedDoor[] = [];
  for (const entry of Array.isArray(source.doors) ? source.doors : []) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = str(record.id);
    const x = num(record.x);
    const y = num(record.y);
    const width = num(record.width);
    const height = num(record.height);
    const adjacentRoomId = str(record.adjacentRoomId);
    if (!id || x === null || y === null || width === null || height === null || !adjacentRoomId) continue;
    const rawType = str(record.type) ?? 'unknown';
    const rawSwing = str(record.swingDirection) ?? 'unknown';
    doors.push({
      id, imageX: x, imageY: y, imageWidth: width, imageHeight: height,
      type: (DOOR_TYPES.has(rawType) ? rawType : 'unknown') as ExtractedDoor['type'],
      swingDirection: (SWINGS.has(rawSwing) ? rawSwing : 'unknown') as ExtractedDoor['swingDirection'],
      connectsRooms: Array.isArray(record.connectsRooms) ? record.connectsRooms.filter((v): v is string => typeof v==='string') : [adjacentRoomId],
      adjacentRoomId,
    });
  }

  const windows: ExtractedWindow[] = [];
  for (const entry of Array.isArray(source.windows) ? source.windows : []) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = str(record.id);
    const x = num(record.x);
    const y = num(record.y);
    const width = num(record.width);
    const height = num(record.height);
    const adjacentRoomId = str(record.adjacentRoomId);
    if (!id || x === null || y === null || width === null || height === null || !adjacentRoomId) continue;
    windows.push({ id, imageX: x, imageY: y, imageWidth: width, imageHeight: height, adjacentRoomId });
  }

  const stairs: ExtractedStair[] = [];
  for (const entry of Array.isArray(source.stairs) ? source.stairs : []) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = str(record.id);
    const name = str(record.name) ?? 'Staircase';
    const x = num(record.x);
    const y = num(record.y);
    const width = num(record.width);
    const height = num(record.height);
    if (!id || x === null || y === null || width === null || height === null) continue;
    const flatId = str(record.flatId);
    stairs.push({ id, name, imageX: x, imageY: y, imageWidth: width, imageHeight: height, ...(flatId ? { flatId } : {}) });
  }

  const parking: ExtractedParking[] = [];
  for (const entry of Array.isArray(source.parking) ? source.parking : []) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = str(record.id);
    const name = str(record.name) ?? 'Parking';
    const x = num(record.x);
    const y = num(record.y);
    const width = num(record.width);
    const height = num(record.height);
    if (!id || x === null || y === null || width === null || height === null) continue;
    parking.push({ id, name, imageX: x, imageY: y, imageWidth: width, imageHeight: height });
  }

  // Apartment structure (recovery Phase 4). Parsed only when the payload
  // carries it; malformed entries are reported and dropped, never invented.
  const apartment = Array.isArray(source.flats)
    ? {
      flats: parseFlats(source.flats, diagnostics),
      lifts: parseCoreElements(source.lifts, 'Lift', diagnostics),
      lobbies: parseCoreElements(source.lobbies, 'Lobby', diagnostics),
      corridors: parseCoreElements(source.corridors, 'Corridor', diagnostics),
      shafts: parseCoreElements(source.shafts, 'Shaft', diagnostics),
    }
    : {};

  return {
    plan: { id: planId, boundary, rooms, doors, windows, stairs, parking, ...apartment, metadata },
    diagnostics,
  };
}

function parseFlats(value: unknown, diagnostics: DiagnosticFragment[]): ExtractedFlat[] {
  const flats: ExtractedFlat[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = str(record.id);
    const label = str(record.label) ?? id;
    const unitType = str(record.unitType);
    const x = num(record.x);
    const y = num(record.y);
    const width = num(record.width);
    const height = num(record.height);
    if (!id || !label || x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
      diagnostics.push({ code: 'EXTRACTION_FLAT_SKIPPED', severity: 'warning', message: `Flat "${label ?? id ?? 'unknown'}" was skipped because its boundary was incomplete.` });
      continue;
    }
    flats.push({ id, label, unitType: unitType ?? '', imageX: x, imageY: y, imageWidth: width, imageHeight: height });
  }
  return flats;
}

function parseCoreElements(value: unknown, fallbackName: string, diagnostics: DiagnosticFragment[]): ExtractedCoreElement[] {
  const elements: ExtractedCoreElement[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = str(record.id);
    const name = str(record.name) ?? fallbackName;
    const x = num(record.x);
    const y = num(record.y);
    const width = num(record.width);
    const height = num(record.height);
    if (!id || x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
      diagnostics.push({ code: 'EXTRACTION_CORE_ELEMENT_SKIPPED', severity: 'warning', message: `${fallbackName} "${name}" was skipped because its geometry was incomplete.` });
      continue;
    }
    const flatId = str(record.flatId);
    elements.push({ id, name, imageX: x, imageY: y, imageWidth: width, imageHeight: height, ...(flatId ? { flatId } : {}) });
  }
  return elements;
}

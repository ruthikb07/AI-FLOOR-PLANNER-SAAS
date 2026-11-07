/**
 * Phase 3 - Image to 2D extraction domain types.
 *
 * PRD 19-22: an intermediate representation sits between the Gemini vision
 * interpretation and the canonical Building Model. Image-space information is
 * normalized to real-world coordinates using the known site dimensions, then
 * validated by the deterministic geometry system BEFORE any geometry is
 * accepted as canonical. Invalid extractions are REJECTED, never silently
 * repaired or disguised.
 */

export interface ExtractedRoom {
  readonly id: string;
  readonly name: string;
  /** Raw vision label; mapped to a canonical RoomType during conversion. */
  readonly type: string;
  readonly imageX: number;
  readonly imageY: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly imageArea: number;
  readonly imageMinWidth: number;
  readonly imageMinHeight: number;
  readonly orientationHint?: number;
  /** Apartment grouping: owning flat id, or "COMMON" for shared space (Phase 4). */
  readonly flatId?: string;
}

/** A self-contained apartment unit read from the image (recovery Phase 4). */
export interface ExtractedFlat {
  readonly id: string;
  readonly label: string;
  /** Typology as read from the image (e.g. 2BHK); validated, never trusted. */
  readonly unitType: string;
  readonly imageX: number;
  readonly imageY: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
}

/** A common-core / circulation / service element read from the image. */
export interface ExtractedCoreElement {
  readonly id: string;
  readonly name: string;
  readonly imageX: number;
  readonly imageY: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** Present when the vision model assigned the element to a flat (a validation error for core elements). */
  readonly flatId?: string;
}

export interface ExtractedDoor {
  readonly id: string;
  readonly imageX: number;
  readonly imageY: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly type: 'single' | 'double' | 'sliding' | 'open_passage' | 'unknown';
  readonly swingDirection: 'inward' | 'outward' | 'left' | 'right' | 'unknown';
  readonly connectsRooms: readonly string[];
  readonly adjacentRoomId: string;
}

export interface ExtractedWindow {
  readonly id: string;
  readonly imageX: number;
  readonly imageY: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly adjacentRoomId: string;
}

export interface ExtractedStair {
  readonly id: string;
  readonly name: string;
  readonly imageX: number;
  readonly imageY: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** Apartment grouping (Phase 4): "COMMON" for core stairs. */
  readonly flatId?: string;
}

export interface ExtractedParking {
  readonly id: string;
  readonly name: string;
  readonly imageX: number;
  readonly imageY: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
}

export interface ExtractedPoint {
  readonly x: number;
  readonly y: number;
}

export interface ExtractedBoundary {
  readonly points: readonly ExtractedPoint[];
}

export interface ExtractionMetadata {
  readonly imageWidePixels: number;
  readonly imageTallPixels: number;
  readonly imageAspectRatio: number;
  readonly plotAspectRatio: number;
  readonly aspectMismatchRatio: number;
  readonly orientationDegrees: number;
  readonly roadFacing: string;
  readonly extractionSource: string;
  readonly confidence: string;
  readonly normalizedAt: string;
}

/**
 * Intermediate representation between image interpretation and the canonical
 * Building Model. It is NOT the building model itself - it must be normalized
 * and then validated before acceptance (PRD 21-23). Every entity carries an
 * extraction confidence so uncertain reads stay visible.
 */
export interface ExtractedPlan {
  readonly id: string;
  readonly imageId?: string;
  readonly siteId?: string;
  readonly boundary: ExtractedBoundary;
  readonly rooms: readonly ExtractedRoom[];
  readonly doors: readonly ExtractedDoor[];
  readonly windows: readonly ExtractedWindow[];
  readonly stairs: readonly ExtractedStair[];
  readonly parking: readonly ExtractedParking[];
  /** Apartment structure (Phase 4). Absent for single-family interpretations. */
  readonly flats?: readonly ExtractedFlat[];
  readonly lifts?: readonly ExtractedCoreElement[];
  readonly lobbies?: readonly ExtractedCoreElement[];
  readonly corridors?: readonly ExtractedCoreElement[];
  readonly shafts?: readonly ExtractedCoreElement[];
  readonly metadata: ExtractionMetadata;
  /** Optional per-entity extraction confidence (PRD 21). */
  readonly confidence?: Readonly<Record<string, 'confirmed' | 'likely' | 'ambiguous'>>;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'success';

export interface DiagnosticFragment {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
}

export interface ExtractionResult {
  readonly extractedPlan: ExtractedPlan;
  readonly interpretationSource: 'provider' | 'rule_based' | 'rule_based_fallback';
  readonly confidence: 'confirmed' | 'likely' | 'ambiguous';
  readonly diagnostics: readonly DiagnosticFragment[];
  readonly latencyMs: number;
}
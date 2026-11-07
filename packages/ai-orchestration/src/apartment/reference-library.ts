/**
 * Count-Matched Apartment Reference Library — Phase 2 recovery (P6, P9).
 *
 * The Phase 1 report identifies that reference images showing 4 flats
 * actively bias a weak distilled model toward 4 flats even when the user
 * requested 2. This module is the deterministic bridge between "how many
 * flats did the user request" and "which reference bucket should style this
 * generation" — it contains NO filesystem access (pure/testable); the caller
 * (backend, which owns the data directory) lists files and passes them in.
 *
 * User count always wins (§11): this module NEVER changes what flat count a
 * generation targets. It only selects which *style* references, if any, are
 * offered to FLUX for the count already decided by the schematic/manifest.
 */

export type ApartmentReferenceBucket = 'flats_1' | 'flats_2' | 'flats_3' | 'flats_4' | 'flats_6' | 'villa';

export const ALL_APARTMENT_REFERENCE_BUCKETS: readonly ApartmentReferenceBucket[] = [
  'flats_1',
  'flats_2',
  'flats_3',
  'flats_4',
  'flats_6',
  'villa',
];

/**
 * Deterministically resolves which reference bucket matches a given flat
 * count / project type. Never returns a bucket matching a DIFFERENT count
 * than what was requested — for counts above the largest defined bucket
 * (flats_6), style references are progressively LESS relevant, so once N
 * exceeds every bucket's exact match we intentionally return `null` (no
 * bucket) rather than silently borrowing a wrong-count bucket's images.
 */
export function resolveApartmentReferenceBucket(
  projectType: 'apartment' | 'residential_independent',
  flatsPerFloor?: number,
): ApartmentReferenceBucket | null {
  if (projectType === 'residential_independent') {
    return 'villa';
  }
  switch (flatsPerFloor) {
    case 1:
      return 'flats_1';
    case 2:
      return 'flats_2';
    case 3:
      return 'flats_3';
    case 4:
      return 'flats_4';
    case 6:
      return 'flats_6';
    default:
      // 5, 7, 8, ... : no exact-count bucket exists in the report's library.
      // Do NOT substitute a wrong-count bucket (§11/§14) — no style
      // references for this request; the schematic scaffold still carries
      // the exact structure.
      return null;
  }
}

export type ReferenceStatus = 'AVAILABLE' | 'PARTIAL' | 'DROPPED' | 'EMPTY' | 'FAILED';

export interface ReferenceDropRecord {
  readonly id: string;
  readonly reason: string;
}

export interface ReferenceSelectionDiagnostics {
  readonly bucket: ApartmentReferenceBucket | null;
  /** IDs the caller asked this selector to consider (candidate files in the bucket, before any load/attach attempt). */
  readonly requestedReferenceIds: readonly string[];
  /** IDs actually chosen (bucket order, capped at maxCount) to attempt loading. */
  readonly selectedReferenceIds: readonly string[];
  /** IDs that were successfully read/decoded and are being attached to the request. */
  readonly attachedReferenceIds: readonly string[];
  readonly drops: readonly ReferenceDropRecord[];
  readonly status: ReferenceStatus;
}

export interface AvailableReferenceFile {
  readonly id: string;
  readonly name: string;
}

/**
 * Pure selection: given the candidate file list already discovered in a
 * bucket directory, deterministically picks up to `maxCount` of them in a
 * stable order (sorted by id — the caller is expected to have listed the
 * directory with a stable sort, e.g. alphabetical).
 *
 * This function does NOT read file bytes; it only decides WHICH files to
 * attempt. The caller reports back any load failures via `reportLoadFailure`
 * style usage (see `finalizeReferenceSelection`).
 */
export function selectReferenceCandidates(
  _bucket: ApartmentReferenceBucket | null,
  availableFiles: readonly AvailableReferenceFile[],
  maxCount: number,
): { selected: readonly AvailableReferenceFile[]; requestedIds: readonly string[] } {
  const sorted = [...availableFiles].sort((a, b) => a.id.localeCompare(b.id));
  const requestedIds = sorted.map(f => f.id);
  const selected = sorted.slice(0, Math.max(0, maxCount));
  return { selected, requestedIds };
}

/**
 * Builds the final structured diagnostics for a reference-selection attempt,
 * given which candidates were selected and which of those actually loaded
 * successfully (attached) vs failed (dropped with a reason).
 */
export function finalizeReferenceSelection(
  bucket: ApartmentReferenceBucket | null,
  requestedIds: readonly string[],
  selectedIds: readonly string[],
  attachedIds: readonly string[],
  drops: readonly ReferenceDropRecord[],
): ReferenceSelectionDiagnostics {
  let status: ReferenceStatus;
  if (bucket === null || requestedIds.length === 0) {
    status = 'EMPTY';
  } else if (attachedIds.length === 0) {
    status = drops.length > 0 ? 'FAILED' : 'EMPTY';
  } else if (attachedIds.length < selectedIds.length) {
    status = 'PARTIAL';
  } else {
    status = 'AVAILABLE';
  }

  return {
    bucket,
    requestedReferenceIds: requestedIds,
    selectedReferenceIds: selectedIds,
    attachedReferenceIds: attachedIds,
    drops,
    status,
  };
}

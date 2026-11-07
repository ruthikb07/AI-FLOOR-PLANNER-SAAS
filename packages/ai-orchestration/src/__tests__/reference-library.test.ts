import { describe, expect, it } from 'vitest';
import {
  resolveApartmentReferenceBucket,
  selectReferenceCandidates,
  finalizeReferenceSelection,
  ALL_APARTMENT_REFERENCE_BUCKETS,
} from '../apartment/reference-library';

describe('Phase 2 recovery (P6/P9/P11) — resolveApartmentReferenceBucket', () => {
  it.each([
    [1, 'flats_1'],
    [2, 'flats_2'],
    [3, 'flats_3'],
    [4, 'flats_4'],
    [6, 'flats_6'],
  ] as const)('flat count %d resolves to bucket %s', (count, expected) => {
    expect(resolveApartmentReferenceBucket('apartment', count)).toBe(expected);
  });

  it('villa project type always resolves to the villa bucket, regardless of flatsPerFloor', () => {
    expect(resolveApartmentReferenceBucket('residential_independent', undefined)).toBe('villa');
    expect(resolveApartmentReferenceBucket('residential_independent', 4)).toBe('villa');
  });

  it('never substitutes a wrong-count bucket for an unsupported count (5, 7, 8) — user count always wins over borrowing a reference bucket', () => {
    expect(resolveApartmentReferenceBucket('apartment', 5)).toBeNull();
    expect(resolveApartmentReferenceBucket('apartment', 7)).toBeNull();
    expect(resolveApartmentReferenceBucket('apartment', 8)).toBeNull();
  });

  it('is deterministic: same input always resolves to the same bucket', () => {
    const a = resolveApartmentReferenceBucket('apartment', 2);
    const b = resolveApartmentReferenceBucket('apartment', 2);
    expect(a).toBe(b);
  });

  it('every defined bucket constant is reachable from some input', () => {
    const reachable = new Set(ALL_APARTMENT_REFERENCE_BUCKETS.filter(b => b !== 'villa').map((_, i) =>
      resolveApartmentReferenceBucket('apartment', [1, 2, 3, 4, 6][i]),
    ));
    for (const bucket of ['flats_1', 'flats_2', 'flats_3', 'flats_4', 'flats_6'] as const) {
      expect(reachable.has(bucket)).toBe(true);
    }
  });
});

describe('Phase 2 recovery (P12) — selectReferenceCandidates (deterministic ordering)', () => {
  it('selects candidates in a stable, deterministic order regardless of input order', () => {
    const filesA = [{ id: 'b', name: 'b.png' }, { id: 'a', name: 'a.png' }, { id: 'c', name: 'c.png' }];
    const filesB = [{ id: 'c', name: 'c.png' }, { id: 'a', name: 'a.png' }, { id: 'b', name: 'b.png' }];
    const resultA = selectReferenceCandidates('flats_2', filesA, 3);
    const resultB = selectReferenceCandidates('flats_2', filesB, 3);
    expect(resultA.selected.map(f => f.id)).toEqual(['a', 'b', 'c']);
    expect(resultB.selected.map(f => f.id)).toEqual(resultA.selected.map(f => f.id));
  });

  it('caps selection at maxCount', () => {
    const files = [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }, { id: 'c', name: 'c' }, { id: 'd', name: 'd' }];
    const { selected } = selectReferenceCandidates('flats_2', files, 2);
    expect(selected).toHaveLength(2);
    expect(selected.map(f => f.id)).toEqual(['a', 'b']);
  });

  it('returns empty selection for an empty candidate list', () => {
    const { selected, requestedIds } = selectReferenceCandidates('flats_2', [], 3);
    expect(selected).toHaveLength(0);
    expect(requestedIds).toHaveLength(0);
  });
});

describe('Phase 2 recovery (P13) — finalizeReferenceSelection (structured diagnostics, no silent drops)', () => {
  it('reports AVAILABLE when every selected reference attached successfully', () => {
    const diag = finalizeReferenceSelection('flats_2', ['a', 'b'], ['a', 'b'], ['a', 'b'], []);
    expect(diag.status).toBe('AVAILABLE');
    expect(diag.attachedReferenceIds).toEqual(['a', 'b']);
    expect(diag.drops).toHaveLength(0);
  });

  it('reports PARTIAL and records the drop reason when some references fail to attach', () => {
    const diag = finalizeReferenceSelection(
      'flats_2',
      ['a', 'b', 'c'],
      ['a', 'b'],
      ['a'],
      [{ id: 'b', reason: 'REFERENCE_RESIZE_ERROR: dimensions exceed 512x512' }],
    );
    expect(diag.status).toBe('PARTIAL');
    expect(diag.attachedReferenceIds).toEqual(['a']);
    expect(diag.drops).toEqual([{ id: 'b', reason: 'REFERENCE_RESIZE_ERROR: dimensions exceed 512x512' }]);
  });

  it('reports FAILED (not silently AVAILABLE) when every selected reference fails to attach', () => {
    const diag = finalizeReferenceSelection(
      'flats_2',
      ['a'],
      ['a'],
      [],
      [{ id: 'a', reason: 'REFERENCE_FILE_READ_ERROR: file not found' }],
    );
    expect(diag.status).toBe('FAILED');
    expect(diag.attachedReferenceIds).toHaveLength(0);
  });

  it('reports EMPTY when no bucket was resolved (e.g. unsupported flat count) or no candidates existed', () => {
    const diagNoBucket = finalizeReferenceSelection(null, [], [], [], []);
    expect(diagNoBucket.status).toBe('EMPTY');

    const diagNoCandidates = finalizeReferenceSelection('flats_5' as any, [], [], [], []);
    expect(diagNoCandidates.status).toBe('EMPTY');
  });

  it('never reports AVAILABLE when the provider actually received zero references (no false reference-guided claim)', () => {
    const diag = finalizeReferenceSelection('flats_2', ['a', 'b'], ['a', 'b'], [], [
      { id: 'a', reason: 'REFERENCE_FILE_READ_ERROR' },
      { id: 'b', reason: 'REFERENCE_FILE_READ_ERROR' },
    ]);
    expect(diag.status).not.toBe('AVAILABLE');
    expect(diag.attachedReferenceIds).toHaveLength(0);
  });
});

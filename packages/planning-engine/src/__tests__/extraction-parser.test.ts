import { describe, expect, it } from 'vitest';
import { createExtractionMetadata, parseExtractionPayload } from '../interpretation/extraction-parser';

const metadata = createExtractionMetadata({
  imageWidePixels: 1024, imageTallPixels: 768, plotWidth: 9144, plotDepth: 15240,
  orientation: 0, roadFacing: 'north', extractionSource: 'gemini_vision', confidence: 'likely',
});

const validPayload = {
  boundary: { points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 700 }, { x: 0, y: 700 }] },
  rooms: [
    { id: 'r1', name: 'Living Room', type: 'living', x: 40, y: 40, width: 400, height: 300 },
    { id: 'r2', name: 'Bedroom', type: 'bedroom', x: 500, y: 40, width: 400, height: 300 },
  ],
  doors: [{ id: 'd1', x: 460, y: 100, width: 20, height: 8, type: 'single', swingDirection: 'inward', adjacentRoomId: 'r1' }],
  windows: [{ id: 'w1', x: 100, y: 42, width: 80, height: 6, adjacentRoomId: 'r1' }],
  stairs: [{ id: 's1', name: 'Staircase', x: 500, y: 400, width: 140, height: 90 }],
  parking: [{ id: 'p1', name: 'Parking', x: 40, y: 400, width: 200, height: 120 }],
};

describe('Phase 3 — untrusted vision payload parsing (PRD 20/21)', () => {
  it('maps a valid payload into a typed ExtractedPlan with image-space geometry', () => {
    const { plan, diagnostics } = parseExtractionPayload(validPayload, metadata, 'plan-1');
    expect(plan).not.toBeNull();
    expect(plan!.id).toBe('plan-1');
    expect(plan!.rooms).toHaveLength(2);
    expect(plan!.rooms[0]!.imageArea).toBe(120_000);
    expect(plan!.doors[0]!.type).toBe('single');
    expect(plan!.stairs[0]!.name).toBe('Staircase');
    expect(plan!.parking[0]!.name).toBe('Parking');
    expect(diagnostics).toEqual([]);
  });

  it('rejects a payload without a usable boundary', () => {
    const { plan, diagnostics } = parseExtractionPayload({ ...validPayload, boundary: { points: [{ x: 0, y: 0 }] } }, metadata, 'p');
    expect(plan).toBeNull();
    expect(diagnostics.some(d => d.code === 'EXTRACTION_PAYLOAD_BOUNDARY_INVALID')).toBe(true);
  });

  it('rejects a payload with no usable rooms instead of inventing them', () => {
    const { plan, diagnostics } = parseExtractionPayload({ ...validPayload, rooms: [] }, metadata, 'p');
    expect(plan).toBeNull();
    expect(diagnostics.some(d => d.code === 'EXTRACTION_NO_ROOMS')).toBe(true);
  });

  it('skips rooms with incomplete geometry and reports them', () => {
    const { plan, diagnostics } = parseExtractionPayload({
      ...validPayload,
      rooms: [...validPayload.rooms, { id: 'r3', name: 'Study' }],
    }, metadata, 'p');
    expect(plan!.rooms).toHaveLength(2);
    expect(diagnostics.some(d => d.code === 'EXTRACTION_ROOM_SKIPPED')).toBe(true);
  });

  it('never substitutes an unrecognized door type with a fabricated one', () => {
    const { plan } = parseExtractionPayload({
      ...validPayload,
      doors: [{ ...validPayload.doors[0], type: 'revolving-hyper-door' }],
    }, metadata, 'p');
    expect(plan!.doors[0]!.type).toBe('unknown');
  });

  it('computes aspect mismatch metadata from image and plot dimensions', () => {
    const mismatch = createExtractionMetadata({
      imageWidePixels: 1024, imageTallPixels: 200, plotWidth: 9144, plotDepth: 15240,
      orientation: 0, roadFacing: 'north', extractionSource: 'gemini_vision', confidence: 'likely',
    });
    expect(mismatch.aspectMismatchRatio).toBeGreaterThan(0.5);
  });
});
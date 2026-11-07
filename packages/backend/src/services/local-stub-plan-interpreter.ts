/**
 * Phase 3 - Local deterministic plan interpreter (development stub).
 *
 * WHY THIS EXISTS: interpreting a FLUX image into a plan normally requires a
 * Gemini vision credential (server-side). This interpreter lets a developer
 * exercise the REAL Phase 3 pipeline (interpret -> normalize -> build ->
 * hard-validate -> evaluate) without any credential.
 *
 * TRUTHFUL PROVENANCE (.memory principle 4): it reports `rule_based` and never
 * claims to be Gemini. It must be enabled explicitly (IMAGE_INTERPRETER=local-stub).
 *
 * It synthesizes image-space geometry deterministically from the requested
 * program so the downstream deterministic validation is genuinely exercised.
 */

import type { DesignRequirementSpecification, SpaceProgram } from '@ai-floor-planner/core';

export interface SynthesizedInterpretation {
  readonly payload: Record<string, unknown>;
  /** Honest provenance for the extraction result. */
  readonly source: 'rule_based' | 'rule_based_fallback';
  readonly confidence: 'confirmed' | 'likely' | 'ambiguous';
}

interface Cell {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

const IMAGE_WIDE = 1024;
const IMAGE_TALL = 1024;
const MARGIN = 40;
const GUTTER = 12;

/** Deterministically schedule spaces: required program first, in a fixed order. */
function schedule(requirements: DesignRequirementSpecification, program?: SpaceProgram): Cell[] {
  const cells: Cell[] = [];
  if (program && program.items.length > 0) {
    for (const item of program.items) {
      const type = item.canonicalType ?? item.name.toLowerCase().replace(/\s+/g, '_');
      for (let index = 0; index < Math.max(0, item.quantity); index += 1) {
        cells.push({
          id: `${item.id}_${index + 1}`,
          name: item.quantity > 1 ? `${item.name} ${index + 1}` : item.name,
          type: String(type),
        });
      }
    }
    return cells;
  }
  const hard = requirements.hard;
  const push = (name: string, type: string, count: number) => {
    for (let index = 0; index < count; index += 1) {
      cells.push({ id: `${type}_${index + 1}`, name: count > 1 ? `${name} ${index + 1}` : name, type });
    }
  };
  if (hard.livingRoomRequired) push('Living Room', 'living', 1);
  if (hard.diningRoomRequired) push('Dining Room', 'dining', 1);
  if (hard.kitchenRequired) push('Kitchen', 'kitchen', 1);
  push('Bedroom', 'bedroom', hard.bedroomCount);
  push('Bathroom', 'bathroom', hard.bathroomCount);
  if (hard.staircaseRequired) push('Staircase', 'staircase', 1);
  if (hard.parkingSpacesCount > 0) push('Parking', 'parking', hard.parkingSpacesCount);
  return cells;
}

/**
 * Synthesize an interpretation payload. Layout is a deterministic, evenly
 * divided grid — visually simple but structurally valid, so the extracted plan
 * exercises real geometry, containment and program-count validation.
 */
export function synthesizeInterpretation(
  requirements: DesignRequirementSpecification,
  program?: SpaceProgram,
): SynthesizedInterpretation {
  const cells = schedule(requirements, program);
  const count = Math.max(1, cells.length);
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const usableWide = IMAGE_WIDE - MARGIN * 2;
  const usableTall = IMAGE_TALL - MARGIN * 2;
  const cellWidth = Math.floor((usableWide - GUTTER * (columns - 1)) / columns);
  const cellHeight = Math.floor((usableTall - GUTTER * (rows - 1)) / rows);

  const rooms: Record<string, unknown>[] = [];
  const stairs: Record<string, unknown>[] = [];
  const parking: Record<string, unknown>[] = [];

  cells.forEach((cell, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const entry = {
      id: cell.id,
      name: cell.name,
      type: cell.type,
      x: MARGIN + column * (cellWidth + GUTTER),
      y: MARGIN + row * (cellHeight + GUTTER),
      width: cellWidth,
      height: cellHeight,
    };
    if (cell.type === 'staircase') stairs.push(entry);
    else if (cell.type === 'parking') parking.push(entry);
    else rooms.push(entry);
  });

  // One door per room, hosted on the first contiguous neighbour where known.
  const doors = rooms.slice(1).map((room, index) => ({
    id: `door_${index + 1}`,
    x: Number(room.x) + 4,
    y: Number(room.y) + 4,
    width: 24,
    height: 10,
    type: 'single',
    swingDirection: 'inward',
    adjacentRoomId: String(room.id),
  }));

  // Provide at least one room so validation always has geometry to inspect.
  if (rooms.length === 0) {
    rooms.push({ id: 'living_1', name: 'Living Room', type: 'living', x: MARGIN, y: MARGIN, width: cellWidth, height: cellHeight });
  }

  return {
    payload: {
      boundary: {
        points: [
          { x: 0, y: 0 },
          { x: IMAGE_WIDE, y: 0 },
          { x: IMAGE_WIDE, y: IMAGE_TALL },
          { x: 0, y: IMAGE_TALL },
        ],
      },
      rooms,
      doors,
      windows: rooms.slice(0, 1).map(room => ({
        id: 'window_1',
        x: Number(room.x) + 2,
        y: Number(room.y) + 2,
        width: 40,
        height: 8,
        adjacentRoomId: String(room.id),
      })),
      stairs,
      parking,
    },
    source: 'rule_based',
    confidence: 'likely',
  };
}
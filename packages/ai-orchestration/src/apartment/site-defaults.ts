/**
 * Canonical Apartment Site Setback Defaults (Phase 1 recovery, P10).
 *
 * Single source of truth for the default setback envelope used whenever a
 * caller does not supply explicit project setbacks. Before this fix,
 * `manifest.ts` defaulted to {3,2,2,2} m while `schematic.ts` and
 * `feasibility.ts` defaulted to {4.5,3,3,3} m, so the schematic and manifest
 * could silently compute different buildable envelopes for the "same"
 * project. The manifest is the canonical numeric contract
 * (`ApartmentGenerationManifest`), so its default is the source of truth;
 * schematic.ts and feasibility.ts now import it instead of redeclaring it.
 */

export interface SetbackEnvelopeMm {
  readonly front: number;
  readonly rear: number;
  readonly left: number;
  readonly right: number;
}

export interface SetbackEnvelopeM {
  readonly front: number;
  readonly rear: number;
  readonly left: number;
  readonly right: number;
}

/** Millimetre form — used by manifest.ts and feasibility.ts. */
export const DEFAULT_APARTMENT_SETBACKS_MM: SetbackEnvelopeMm = {
  front: 3000,
  rear: 2000,
  left: 2000,
  right: 2000,
};

/** Metre form (derived) — used by schematic.ts. */
export const DEFAULT_APARTMENT_SETBACKS_M: SetbackEnvelopeM = {
  front: DEFAULT_APARTMENT_SETBACKS_MM.front / 1000,
  rear: DEFAULT_APARTMENT_SETBACKS_MM.rear / 1000,
  left: DEFAULT_APARTMENT_SETBACKS_MM.left / 1000,
  right: DEFAULT_APARTMENT_SETBACKS_MM.right / 1000,
};

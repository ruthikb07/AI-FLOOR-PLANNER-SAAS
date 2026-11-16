import type { ApartmentBhkType } from '../types/enums';
import type { DynamicApartmentUnitSpec } from '../types/apartment-manifest';

/**
 * Parses an explicit mixed unit program from a brief, e.g.
 *  - "2 flats of 2BHK and 3 flats of 3BHK per floor"
 *  - "2x 2BHK + 2x 3BHK"
 *  - "two 2 BHK and one 4BHK flats"
 * Returns the ordered BHK list (grouped in the order stated) or null when the
 * brief does not state at least two counted unit groups or the total falls
 * outside the supported 1..6 flats per floor.
 */
const WORD_NUMBERS: Readonly<Record<string, number>> = {
  one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
};

export function parseMixedUnitProgram(prompt?: string): ApartmentBhkType[] | null {
  if (!prompt) return null;
  const text = prompt.toLowerCase().replace(/\s+/g, ' ');
  const pattern = /\b(\d|one|single|two|three|four|five|six)\s*(?:x|×|\*|nos?\.?|no\.?)?\s*(?:(?:flats?|units?|apartments?|nos?)\s+(?:of\s+)?)?([1-4])\s*-?\s*bhk\b/g;
  const groups: { count: number; bhk: ApartmentBhkType }[] = [];
  for (const m of text.matchAll(pattern)) {
    const raw = m[1]!;
    const count = /^\d$/.test(raw) ? Number(raw) : WORD_NUMBERS[raw] ?? 0;
    if (count < 1 || count > 6) continue;
    groups.push({ count, bhk: `${m[2]}BHK` as ApartmentBhkType });
  }
  if (groups.length < 2) return null;
  const total = groups.reduce((s, g) => s + g.count, 0);
  if (total < 2 || total > 6) return null;
  return groups.flatMap(g => Array.from({ length: g.count }, () => g.bhk));
}

/** Builds unit specs for a parsed mixed program, preserving utility balconies. */
export function mixedUnitSpecs(types: readonly ApartmentBhkType[]): DynamicApartmentUnitSpec[] {
  return types.map((bhkType, i) => ({ unitIndex: i + 1, bhkType, hasUtilityBalcony: true }));
}

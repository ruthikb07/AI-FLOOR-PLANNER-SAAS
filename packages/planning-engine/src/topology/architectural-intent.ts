/**
 * Architectural intent interpretation.
 *
 * Converts a free-text architectural brief into a typed, validated
 * `ArchitecturalProgram`: what the user REQUIRES (mandatory, honoured or the
 * brief is reported infeasible) separated from what the user PREFERS (soft,
 * expressed through scoring and topology bias).
 *
 * Design rules enforced here:
 *
 * - Deterministic. The same prompt always yields the same program; no model
 *   call, no randomness, no clock. An LLM may later propose a program, but it
 *   must be validated through `validateProgram` before it reaches geometry.
 * - Intent never overrides physics. Nothing in this file can grant a topology
 *   permission to violate access, ventilation or envelope constraints; it only
 *   states what to aim for. The topology families and validators decide what is
 *   actually buildable.
 * - Conflicts are reported, not silently resolved. Asking for an east core and
 *   a west core is an error, because quietly picking one produces a plan the
 *   user did not ask for.
 *
 * This module makes no claim of statutory compliance.
 */

import type { ApartmentBhkType } from '@ai-floor-planner/core';

/** Where the user wants vertical circulation to sit. */
export type CorePreference =
  | 'CENTRAL'
  | 'EAST'
  | 'WEST'
  | 'NORTH'
  | 'SOUTH'
  | 'SPLIT'
  | 'UNSPECIFIED';

/** What organizes the plan's daylight and ventilation. */
export type VentilationStrategy =
  | 'CENTRAL_COURTYARD'
  | 'SIDE_SHAFTS'
  | 'PERIMETER_ONLY'
  | 'UNSPECIFIED';

/** Which architectural quality the user asked to optimize hardest. */
export type DesignPriority =
  | 'COMPACT_EFFICIENCY'
  | 'DAYLIGHT_VENTILATION'
  | 'PRIVACY_CIRCULATION'
  | 'KITCHEN_DINING'
  | 'UNSPECIFIED';

export type Strength = 'REQUIRED' | 'PREFERRED';

/** One interpreted clause, with the text that produced it. */
export interface IntentClause {
  readonly topic: string;
  readonly value: string;
  readonly strength: Strength;
  /** Verbatim source fragment, so every decision is traceable to the brief. */
  readonly evidence: string;
}

/** Mandatory requirements: a candidate that breaks one of these is rejected. */
export interface MandatoryRequirements {
  readonly flatsPerFloor: 1 | 2 | 3 | 4 | 5 | 6;
  readonly unitTypes: readonly ApartmentBhkType[];
  readonly everyBathroomVentilated: true;
  readonly everyFlatAccessibleFromCommonCore: true;
  readonly stairCount: number;
  readonly withinBuildingEnvelope: true;
  /** Set only when the brief states a core side as a requirement. */
  readonly corePlacement?: CorePreference;
  /** Set only when the brief requires a courtyard or perimeter-only ventilation rather than preferring one. */
  readonly ventilationStrategy?: VentilationStrategy;
  /** Set when the brief or config explicitly requires centering the building inside the permissible envelope. */
  readonly centerBuilding?: boolean;
  /** Set when the brief explicitly asks for a single central lift car rather than a multi-lift bank. */
  readonly singleLift?: boolean;
  /** Explicit area target in sq. ft. when stated in brief or config. */
  readonly targetAreaSqFt?: number;
  /** Explicit scope for targetAreaSqFt. */
  readonly areaTargetScope?: 'GROSS_FLOOR_AREA' | 'FLOOR_TOTAL_CARPET' | 'PER_APARTMENT_CARPET';
}

/** Soft preferences: these bias topology choice and scoring weights. */
export interface SoftPreferences {
  readonly corePreference: CorePreference;
  readonly ventilationStrategy: VentilationStrategy;
  readonly priority: DesignPriority;
  readonly bedroomsAwayFromLobby: boolean;
  readonly bedroomBalconies: 'ALL_BEDROOMS' | 'WHERE_FEASIBLE' | 'NONE_REQUESTED';
  readonly kitchenSize: 'LARGER' | 'STANDARD' | 'COMPACT';
  readonly kitchenStyle: 'OPEN' | 'ENCLOSED' | 'UNSPECIFIED';
  readonly sitoutSize: 'STANDARD' | 'COMPACT';
  readonly livingFirstEntrance: boolean;
  readonly minimizeCorridor: boolean;
  readonly coreCompactness: 'COMPACT' | 'STANDARD';
  readonly livingOrientation: 'EAST' | 'WEST' | 'NORTH' | 'SOUTH' | 'UNSPECIFIED';
}

export interface ArchitecturalProgram {
  readonly mandatory: MandatoryRequirements;
  readonly preferences: SoftPreferences;
  readonly clauses: readonly IntentClause[];
  /** Stable digest of the interpreted intent; drives deterministic seeding. */
  readonly intentDigest: string;
  readonly sourcePrompt: string;
}

export class IntentConflictError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'IntentConflictError';
  }
}

/** Split a brief into clauses so an "east" in one sentence cannot leak into another. */
function clausesOf(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .split(/[.;\n]|\b(?:and|but|while|whereas)\b|,/)
    .map(c => c.trim())
    .filter(Boolean);
}

const has = (clause: string, re: RegExp) => re.test(clause);
const NEGATED = /\b(no|not|avoid|don't|do not|never|without|omit|exclude|zero)\b/;

interface Accumulator<T> {
  readonly values: Set<T>;
  readonly evidence: Map<T, string>;
}

function accumulator<T>(): Accumulator<T> {
  return { values: new Set<T>(), evidence: new Map<T, string>() };
}

function record<T>(acc: Accumulator<T>, value: T, evidence: string): void {
  acc.values.add(value);
  if (!acc.evidence.has(value)) acc.evidence.set(value, evidence);
}

function sole<T>(acc: Accumulator<T>, code: string, label: string): T | undefined {
  if (acc.values.size > 1) {
    const requested = [...acc.values].join(' and ');
    throw new IntentConflictError(code, `${label} requested as both ${requested}; state one directly`);
  }
  return acc.values.values().next().value;
}

export interface InterpretIntentInput {
  readonly prompt?: string;
  readonly aiPrompt?: string;
  readonly flatsPerFloor: 1 | 2 | 3 | 4 | 5 | 6;
  readonly unitTypes: readonly ApartmentBhkType[];
  /** Road-facing side, used only to resolve "road-facing" style phrasing. */
  readonly roadSide?: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';
}

/**
 * Interprets an architectural brief into a validated program.
 *
 * Throws `IntentConflictError` when the brief demands two incompatible things,
 * so the user sees the conflict instead of an arbitrary resolution.
 */
export function interpretArchitecturalIntent(input: InterpretIntentInput): ArchitecturalProgram {
  const prompt = input.prompt ?? input.aiPrompt ?? '';
  const clauses = clausesOf(prompt);
  const found: IntentClause[] = [];

  const core = accumulator<CorePreference>();
  const vent = accumulator<VentilationStrategy>();
  const priority = accumulator<DesignPriority>();
  const kitchenSize = accumulator<'LARGER' | 'STANDARD' | 'COMPACT'>();
  const kitchenStyle = accumulator<'OPEN' | 'ENCLOSED'>();
  const sitout = accumulator<'STANDARD' | 'COMPACT'>();
  const compactness = accumulator<'COMPACT' | 'STANDARD'>();
  const livingFacing = accumulator<'EAST' | 'WEST' | 'NORTH' | 'SOUTH'>();

  let coreIsRequired = false;
  let ventIsRequired = false;
  let bedroomsAwayFromLobby = false;
  let livingFirst = false;
  let minimizeCorridor = false;
  let bedroomBalconies: SoftPreferences['bedroomBalconies'] = 'NONE_REQUESTED';
  let stairCount = 2;
  let centerBuilding = false;
  let singleLift = false;
  let targetAreaSqFt: number | undefined;
  let areaTargetScope: MandatoryRequirements['areaTargetScope'];

  const fullLower = prompt.toLowerCase();
  if (/\b(?:building\s+center(?:ed)?|center(?:ed)?\s+(?:the\s+)?building|center(?:ed)?\s+inside\s+(?:the\s+)?permissible)\b/.test(fullLower)) {
    centerBuilding = true;
  }
  const areaMatch = fullLower.match(/\b(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*ft\.?|sqft|square\s+feet)\b/);
  if (areaMatch) {
    const parsedArea = Number(areaMatch[1]!.replace(/,/g, ''));
    if (Number.isFinite(parsedArea) && parsedArea > 0) {
      targetAreaSqFt = parsedArea;
      if (/\bgross\s+floor\s+area\b/.test(fullLower)) {
        areaTargetScope = 'GROSS_FLOOR_AREA';
      } else if (/\b(?:total\s+carpet\s+area\s+per\s+floor|carpet\s+area\s+per\s+floor|floor\s+total\s+carpet)\b/.test(fullLower)) {
        areaTargetScope = 'FLOOR_TOTAL_CARPET';
      } else if (/\b(?:carpet\s+area\s+per\s+(?:apartment|flat|unit)|per\s+(?:apartment|flat|unit)\s+carpet)\b/.test(fullLower)) {
        areaTargetScope = 'PER_APARTMENT_CARPET';
      }
    }
  }

  for (const clause of clauses) {
    // ── Vertical circulation placement ────────────────────────────────────
    const mentionsCore = has(clause, /\b(lifts?|elevators?|stairs?|staircases?|cores?|vertical\s+circulation|lift\s+bank)\b/);
    if (mentionsCore) {
      const dirs: Array<[RegExp, CorePreference]> = [
        [/\beast(?:ern)?\b/, 'EAST'],
        [/\bwest(?:ern)?\b/, 'WEST'],
        [/\bnorth(?:ern)?\b/, 'NORTH'],
        [/\bsouth(?:ern)?\b/, 'SOUTH'],
      ];
      const matchedDirs = dirs.filter(([re]) => has(clause, re));
      const central = has(clause, /\b(central|centre|center|middle|core\s+in\s+the\s+middle)\b/);
      const split = has(clause, /\b(split|separate(?:d)?\s+cores?|two\s+cores?|distributed)\b/);

      if ((matchedDirs.length > 0 || central || split) && has(clause, NEGATED)) {
        throw new IntentConflictError(
          'AMBIGUOUS_CORE_PLACEMENT',
          'state the desired core placement directly; a negated placement is not silently inverted',
        );
      }
      for (const [, dir] of matchedDirs) record(core, dir, clause);
      if (central) record(core, 'CENTRAL', clause);
      if (split) record(core, 'SPLIT', clause);
      // "Place the core ..." / "provide a central lift core" / "central lift" reads as an instruction.
      if (
        has(clause, /\b(place|position|put|locate|keep|move|shift|provide|with|have|having|include|feature)\b/) ||
        ((matchedDirs.length > 0 || central || split) && !has(clause, /\b(prefer\w*|ideal\w*|optional\w*)\b/))
      ) {
        coreIsRequired = true;
      }
      if (has(clause, /\b(?:one|1|single|central)\s+lift\b/) && !has(clause, /\blift\s+(?:core|bank|shafts)\b/) && !has(clause, /\blifts\b/)) {
        singleLift = true;
      }

      if (has(clause, /\b(compact|tight|efficient|minimal|narrow)\b/)) record(compactness, 'COMPACT', clause);
      if (has(clause, /\b(spacious|generous|wide|grand)\b/)) record(compactness, 'STANDARD', clause);

      const stairMatch = clause.match(/\b(one|two|three|1|2|3)\s+(?:fire\s+)?(?:stairs?|staircases?)\b/);
      if (stairMatch) {
        const word = stairMatch[1]!;
        stairCount = word === 'one' || word === '1' ? 1 : word === 'three' || word === '3' ? 3 : 2;
      } else if (has(clause, /\b(?:stairs?|staircases?)\s+(?:positioned\s+)?on\s+(?:both|either)\s+sides?\b/)) {
        stairCount = 2;
      }
    }

    // ── Ventilation / daylight strategy ──────────────────────────────────
    if (has(clause, /\b(courtyards?|atriums?|open[\s-]to[\s-]sky|ots|light\s+well|air\s+well)\b/)) {
      if (has(clause, NEGATED)) {
        record(vent, 'PERIMETER_ONLY', clause);
        ventIsRequired = true;
      } else {
        if (has(clause, /\b(central|centre|center|middle|internal)\b/) || !has(clause, /\b(side|lateral|perimeter|flank)\b/)) {
          record(vent, 'CENTRAL_COURTYARD', clause);
        } else {
          record(vent, 'SIDE_SHAFTS', clause);
        }
        if (has(clause, /\b(around|organiz|organis|centred|centered|design(?:ed)?)\b/)) ventIsRequired = true;
      }
    } else if (has(clause, /\b(shafts?|ducts?)\b/) && has(clause, /\b(side|lateral|perimeter|flank)\b/)) {
      record(vent, 'SIDE_SHAFTS', clause);
    }

    // ── Optimization priority ─────────────────────────────────────────────
    if (has(clause, /\b(daylight|sunlight|natural\s+light|cross[\s-]ventilation|ventilation|airflow|breeze)\b/)
      && has(clause, /\b(prioriti[sz]e|priority|maximi[sz]e|focus|emphas)\b/)) {
      record(priority, 'DAYLIGHT_VENTILATION', clause);
    }
    if (has(clause, /\b(privacy|private|away\s+from\s+(?:the\s+)?(?:shared\s+)?lobby|quiet)\b/)) {
      record(priority, 'PRIVACY_CIRCULATION', clause);
      if (has(clause, /\b(bedrooms?)\b/) || has(clause, /away\s+from/)) bedroomsAwayFromLobby = true;
    }
    if (has(clause, /\b(compact|efficien\w*|minimi[sz]e\s+(?:inefficient\s+)?corridors?|space[\s-]saving)\b/)) {
      record(priority, 'COMPACT_EFFICIENCY', clause);
      if (has(clause, /corridors?/)) minimizeCorridor = true;
    }

    // ── Kitchen ───────────────────────────────────────────────────────────
    if (has(clause, /\bkitchens?\b/)) {
      if (has(clause, /\b(large|larger|big|bigger|spacious|generous|expanded)\b/)) {
        record(kitchenSize, 'LARGER', clause);
        record(priority, 'KITCHEN_DINING', clause);
      }
      if (has(clause, /\b(small|smaller|compact|minimal)\b/)) record(kitchenSize, 'COMPACT', clause);
      if (has(clause, /\b(open|breakfast\s+counter|island)\b/)) record(kitchenStyle, 'OPEN', clause);
      if (has(clause, /\b(enclosed|closed|separate(?:d)?)\b/)) record(kitchenStyle, 'ENCLOSED', clause);
    }

    // ── Sit-out / main balcony ───────────────────────────────────────────
    if (has(clause, /\b(sit[\s-]?outs?|main\s+balcon(?:y|ies)|living\s+balcon(?:y|ies))\b/)) {
      if (has(clause, /\b(small|smaller|compact|minimal|narrow)\b/)) record(sitout, 'COMPACT', clause);
      if (has(clause, /\b(large|larger|generous|standard)\b/)) record(sitout, 'STANDARD', clause);
    }

    // ── Bedroom balconies ────────────────────────────────────────────────
    if (has(clause, /\bbalcon(?:y|ies)\b/) && has(clause, /\b(bedrooms?|every\s+bedroom|each\s+bedroom|all\s+bedrooms?)\b/)) {
      bedroomBalconies = has(clause, /\b(where\s+feasible|where\s+possible|if\s+feasible)\b/)
        ? 'WHERE_FEASIBLE'
        : 'ALL_BEDROOMS';
    }

    // ── Entrance sequence ────────────────────────────────────────────────
    if (has(clause, /\b(living[\s-]first|entrance.*living|living.*entrance|enter.*living)\b/)) livingFirst = true;

    // ── Living room orientation ──────────────────────────────────────────
    if (has(clause, /\b(living|livings?\s+spaces?|living\s+rooms?)\b/)) {
      const dirs: Array<[RegExp, 'EAST' | 'WEST' | 'NORTH' | 'SOUTH']> = [
        [/\beast(?:ern)?[\s-]*(?:facing)?\b/, 'EAST'],
        [/\bwest(?:ern)?[\s-]*(?:facing)?\b/, 'WEST'],
        [/\bnorth(?:ern)?[\s-]*(?:facing)?\b/, 'NORTH'],
        [/\bsouth(?:ern)?[\s-]*(?:facing)?\b/, 'SOUTH'],
      ];
      for (const [re, dir] of dirs) if (has(clause, re)) record(livingFacing, dir, clause);
    }
  }

  const corePick = sole(core, 'CONFLICTING_CORE_PLACEMENT', 'core placement');
  const ventPick = sole(vent, 'CONFLICTING_VENTILATION_STRATEGY', 'ventilation strategy');
  const kitchenSizePick = sole(kitchenSize, 'CONFLICTING_KITCHEN_PREFERENCE', 'kitchen size');
  const kitchenStylePick = sole(kitchenStyle, 'CONFLICTING_KITCHEN_PREFERENCE', 'kitchen style');
  const sitoutPick = sole(sitout, 'CONFLICTING_SITOUT_PREFERENCE', 'sit-out size');
  const compactnessPick = sole(compactness, 'CONFLICTING_CORE_PREFERENCE', 'core compactness');
  const livingFacingPick = sole(livingFacing, 'CONFLICTING_LIVING_ORIENTATION', 'living orientation');

  // A single brief may legitimately mention several priorities; the strongest
  // explicit one wins in a fixed order rather than by accident of clause order.
  const priorityOrder: DesignPriority[] = [
    'DAYLIGHT_VENTILATION',
    'PRIVACY_CIRCULATION',
    'KITCHEN_DINING',
    'COMPACT_EFFICIENCY',
  ];
  const priorityPick = priorityOrder.find(p => priority.values.has(p)) ?? 'UNSPECIFIED';

  // Record every interpreted clause with the brief fragment that produced it,
  // so each decision stays traceable back to the user's own words.
  const collect = <T>(topic: string, acc: Accumulator<T>, required: boolean): void => {
    for (const value of acc.values) {
      found.push({
        topic,
        value: String(value),
        strength: required ? 'REQUIRED' : 'PREFERRED',
        evidence: acc.evidence.get(value) ?? '',
      });
    }
  };

  collect('corePlacement', core, coreIsRequired);
  collect('ventilationStrategy', vent, ventIsRequired);
  collect('priority', priority, false);
  collect('kitchenSize', kitchenSize, false);
  collect('kitchenStyle', kitchenStyle, false);
  collect('sitoutSize', sitout, false);
  collect('coreCompactness', compactness, false);
  collect('livingOrientation', livingFacing, false);

  const preferences: SoftPreferences = {
    corePreference: corePick ?? 'UNSPECIFIED',
    ventilationStrategy: ventPick ?? 'UNSPECIFIED',
    priority: priorityPick,
    bedroomsAwayFromLobby,
    bedroomBalconies,
    kitchenSize: kitchenSizePick ?? 'STANDARD',
    kitchenStyle: kitchenStylePick ?? 'UNSPECIFIED',
    sitoutSize: sitoutPick ?? 'STANDARD',
    livingFirstEntrance: livingFirst,
    minimizeCorridor,
    coreCompactness: compactnessPick ?? 'STANDARD',
    livingOrientation: livingFacingPick ?? 'UNSPECIFIED',
  };

  const mandatory: MandatoryRequirements = {
    flatsPerFloor: input.flatsPerFloor,
    unitTypes: input.unitTypes,
    everyBathroomVentilated: true,
    everyFlatAccessibleFromCommonCore: true,
    stairCount,
    withinBuildingEnvelope: true,
    ...(coreIsRequired && corePick ? { corePlacement: corePick } : {}),
    ...(ventIsRequired && ventPick ? { ventilationStrategy: ventPick } : {}),
    ...(centerBuilding ? { centerBuilding: true } : {}),
    ...(singleLift ? { singleLift: true } : {}),
    ...(targetAreaSqFt !== undefined ? { targetAreaSqFt } : {}),
    ...(areaTargetScope !== undefined ? { areaTargetScope } : {}),
  };

  // The seed digest covers only the choices that affect WHICH organization is
  // built, not the preferences applied inside each flat.
  //
  // Kitchen size, sit-out size and kitchen style are resolved by the room
  // slicer after the topology is fixed. Letting them perturb the digest would
  // make two briefs that differ only in kitchen size explore the families in a
  // different order andpossibly land on different topologies, so a "larger kitchen"
  // brief could end up with a smaller kitchen in a differently-shaped flat —
  // the comparison a user actually makes would then be meaningless.
  const digestSource = JSON.stringify({
    mandatory,
    organization: {
      corePreference: preferences.corePreference,
      ventilationStrategy: preferences.ventilationStrategy,
      // `priority` is deliberately EXCLUDED. A brief that only asks for a
      // larger kitchen sets priority KITCHEN_DINING, and letting that reorder
      // the families would hand the two briefs differently-shaped flats — so
      // the user's "larger kitchen" could arrive smaller, in a different plan.
      // Priority still drives scoring and ranking; it just does not perturb
      // the exploration seed.
      bedroomsAwayFromLobby: preferences.bedroomsAwayFromLobby,
      minimizeCorridor: preferences.minimizeCorridor,
      coreCompactness: preferences.coreCompactness,
      livingOrientation: preferences.livingOrientation,
    },
  });
  let digest = 2166136261;
  for (let i = 0; i < digestSource.length; i++) {
    digest ^= digestSource.charCodeAt(i);
    digest = Math.imul(digest, 16777619);
  }

  return {
    mandatory,
    preferences,
    clauses: found,
    intentDigest: (digest >>> 0).toString(16).padStart(8, '0'),
    sourcePrompt: prompt,
  };
}

/**
 * Deterministically validates a program that may have come from an AI proposal.
 * Structure and value domains are checked here; physical feasibility is decided
 * later by the topology families and the geometry validators.
 */
export function validateProgram(program: ArchitecturalProgram): { readonly valid: boolean; readonly issues: readonly string[] } {
  const issues: string[] = [];
  const { mandatory, preferences } = program;

  if (![1, 2, 3, 4, 5, 6].includes(mandatory.flatsPerFloor)) issues.push('flatsPerFloor must be 1, 2, 3, 4, 5 or 6');
  if (mandatory.unitTypes.length !== mandatory.flatsPerFloor) {
    issues.push(`unitTypes length ${mandatory.unitTypes.length} must equal flatsPerFloor ${mandatory.flatsPerFloor}`);
  }
  if (mandatory.unitTypes.some(t => !/^[1-4]BHK$/.test(t))) issues.push('unitTypes must each be 1BHK..4BHK');
  if (!Number.isInteger(mandatory.stairCount) || mandatory.stairCount < 1 || mandatory.stairCount > 3) {
    issues.push('stairCount must be 1, 2 or 3');
  }
  if (mandatory.everyBathroomVentilated !== true) issues.push('bathroom ventilation is not negotiable');
  if (mandatory.everyFlatAccessibleFromCommonCore !== true) issues.push('flat access is not negotiable');
  if (mandatory.withinBuildingEnvelope !== true) issues.push('envelope containment is not negotiable');

  const coreDomain: CorePreference[] = ['CENTRAL', 'EAST', 'WEST', 'NORTH', 'SOUTH', 'SPLIT', 'UNSPECIFIED'];
  if (!coreDomain.includes(preferences.corePreference)) issues.push('unknown core preference');
  if (mandatory.corePlacement && !coreDomain.includes(mandatory.corePlacement)) issues.push('unknown mandatory core placement');
  if (mandatory.corePlacement && preferences.corePreference !== mandatory.corePlacement) {
    issues.push('mandatory core placement disagrees with interpreted preference');
  }

  return { valid: issues.length === 0, issues };
}

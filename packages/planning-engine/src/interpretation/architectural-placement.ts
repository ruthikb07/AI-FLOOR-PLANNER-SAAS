/** Deterministic supported placement clauses; no inferred engineering approval. */
export interface ArchitecturalPlacement {
  liftSide: 'EAST' | 'WEST';
  otsPlacement: 'CENTRAL' | 'SIDE';
  coreCompactness: 'STANDARD' | 'COMPACT';
  kitchenSize: 'STANDARD' | 'LARGER';
  kitchenStyle: 'ENCLOSED' | 'OPEN';
  sitoutSize: 'STANDARD' | 'COMPACT';
  entranceStyle: 'LIVING_FIRST';
  bedroomBalconies: 'STANDARD' | 'ALL_BEDROOMS';
}

export function interpretArchitecturalPlacement(prompt = ''): ArchitecturalPlacement {
  // Split on sentences, semicolons, commas, or conjunction 'and'
  const clauses = prompt.toLowerCase().split(/[.;\n,]|\b(?:and|with|while)\b/);

  const requestedLift = new Set<'EAST' | 'WEST'>();
  const requestedOts = new Set<'CENTRAL' | 'SIDE'>();
  const requestedCore = new Set<'STANDARD' | 'COMPACT'>();
  const requestedKitchenSize = new Set<'STANDARD' | 'LARGER'>();
  const requestedKitchenStyle = new Set<'ENCLOSED' | 'OPEN'>();
  const requestedSitout = new Set<'STANDARD' | 'COMPACT'>();
  let bedroomBalconies: 'STANDARD' | 'ALL_BEDROOMS' = 'ALL_BEDROOMS';
  const entranceStyle = 'LIVING_FIRST' as const;

  for (const clause of clauses) {
    const trimmed = clause.trim();
    if (!trimmed) continue;

    // 1. Lift placement
    if (/\b(lifts?|elevators?)\b/.test(trimmed)) {
      const east = /\beast(?:ern)?\b/.test(trimmed);
      const west = /\bwest(?:ern)?\b/.test(trimmed);
      if ((east || west) && /\b(not|avoid|don't|do not)\b/.test(trimmed)) {
        throw new Error('AMBIGUOUS_LIFT_PLACEMENT: state the desired east or west side directly; negated placement clauses are not silently interpreted');
      }
      if (east) requestedLift.add('EAST');
      if (west) requestedLift.add('WEST');
    }

    // 2. OTS / Shaft placement
    if (/\b(ots|shafts?|open[\s-]to[\s-]sky|courtyards?|atriums?)\b/.test(trimmed)) {
      const central = /\b(central|center|middle)\b/.test(trimmed);
      const side = /\b(side|lateral|perimeter|flank)\b/.test(trimmed);
      if ((central || side) && /\b(not|avoid|don't|do not)\b/.test(trimmed)) {
        throw new Error('AMBIGUOUS_OTS_PLACEMENT: state the desired central or side OTS placement directly; negated placement clauses are not silently interpreted');
      }
      if (central) requestedOts.add('CENTRAL');
      if (side) requestedOts.add('SIDE');
    }

    // 3. Core Compactness
    if (/\b(core|vertical\s+circulation)\b/.test(trimmed)) {
      const compact = /\b(compact|tight|efficient|narrow|minimal)\b/.test(trimmed);
      const standard = /\b(standard|spacious|generous|wide)\b/.test(trimmed);
      if (compact) requestedCore.add('COMPACT');
      if (standard) requestedCore.add('STANDARD');
    }

    // 4. Kitchen Preferences
    if (/\b(kitchens?)\b/.test(trimmed)) {
      const larger = /\b(large|larger|spacious|expanded|big|generous)\b/.test(trimmed);
      const compact = /\b(compact|small|smaller|minimal)\b/.test(trimmed);
      if (larger) requestedKitchenSize.add('LARGER');
      if (compact) requestedKitchenSize.add('STANDARD');

      const open = /\b(open|breakfast\s+counter|american)\b/.test(trimmed);
      const enclosed = /\b(enclosed|closed|separated?)\b/.test(trimmed);
      if (open) requestedKitchenStyle.add('OPEN');
      if (enclosed) requestedKitchenStyle.add('ENCLOSED');
    }

    // 5. Sit-out Balcony Preferences
    if (/\b(sit[\s-]?out|main\s+balcony|living\s+balcony)\b/.test(trimmed) || (/\bbalcon(?:y|ies)\b/.test(trimmed) && !/\bbedroom\b/.test(trimmed))) {
      const compact = /\b(compact|small|smaller|minimal|narrow)\b/.test(trimmed);
      const standard = /\b(standard|large|larger|generous)\b/.test(trimmed);
      if (compact) requestedSitout.add('COMPACT');
      if (standard) requestedSitout.add('STANDARD');
    }

    // 6. Bedroom Balcony Preferences
    if (/\b(bedroom\s+balcon(?:y|ies)|all\s+bedrooms?|every\s+bedroom|2\s+balconies|two\s+balconies)\b/.test(trimmed)) {
      bedroomBalconies = 'ALL_BEDROOMS';
    }
  }

  if (requestedLift.size > 1) {
    throw new Error('CONFLICTING_LIFT_PLACEMENT: east and west were both requested for the shared lift bank');
  }
  if (requestedOts.size > 1) {
    throw new Error('CONFLICTING_OTS_PLACEMENT: central and side OTS placement were both requested');
  }
  if (requestedCore.size > 1) {
    throw new Error('CONFLICTING_CORE_PREFERENCE: conflicting core compactness preferences requested');
  }
  if (requestedKitchenSize.size > 1) {
    throw new Error('CONFLICTING_KITCHEN_PREFERENCE: conflicting larger and compact kitchen preferences requested');
  }
  if (requestedKitchenStyle.size > 1) {
    throw new Error('CONFLICTING_KITCHEN_PREFERENCE: conflicting open and enclosed kitchen styles requested');
  }
  if (requestedSitout.size > 1) {
    throw new Error('CONFLICTING_SITOUT_PREFERENCE: conflicting sit-out balcony preferences requested');
  }

  return {
    liftSide: requestedLift.values().next().value ?? 'WEST',
    otsPlacement: requestedOts.values().next().value ?? 'CENTRAL',
    coreCompactness: requestedCore.values().next().value ?? 'STANDARD',
    kitchenSize: requestedKitchenSize.values().next().value ?? 'STANDARD',
    kitchenStyle: requestedKitchenStyle.values().next().value ?? 'ENCLOSED',
    sitoutSize: requestedSitout.values().next().value ?? 'STANDARD',
    entranceStyle,
    bedroomBalconies,
  };
}

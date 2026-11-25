/**
 * Exact Multi-Unit Architectural Length & Area Conversion Engine (Phase 5 Gate D).
 *
 * Canonical internal units in RH Planner are strictly:
 * - Length: millimetres (`mm`)
 * - Area: square millimetres (`mm²`)
 *
 * Supports decimal and fractional imperial & metric inputs (`mm`, `cm`, `m`,
 * `ft`, `in`, `ft' in"`, `12' 6 1/2"`, `sq ft`, `sq m`, `mm²`, and `W × L` pairs).
 */

export const EXACT_MM_PER_INCH = 25.4;
export const EXACT_MM_PER_FOOT = 304.8;
export const EXACT_MM_PER_CM = 10;
export const EXACT_MM_PER_METER = 1000;
export const EXACT_SQMM_PER_SQFT = 92_903.04; // 304.8 * 304.8
export const EXACT_SQMM_PER_SQM = 1_000_000;

export type ArchitecturalLengthUnit = 'mm' | 'cm' | 'm' | 'ft' | 'in';
export type ArchitecturalAreaUnit = 'sqft' | 'sqm' | 'mm2';

export type ParsedLengthResult =
  | { readonly ok: true; readonly mm: number; readonly normalizedLabel: string }
  | { readonly ok: false; readonly error: string };

export type ParsedAreaResult =
  | {
      readonly ok: true;
      readonly mm2: number;
      readonly sqFt: number;
      readonly sqM: number;
      readonly dimensionsMm?: { readonly widthMm: number; readonly lengthMm: number };
      readonly normalizedLabel: string;
    }
  | { readonly ok: false; readonly error: string };

function parseNumberOrMixedFraction(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '');
  if (!s) return null;

  // Mixed fraction: "12 1/2" or "6-1/2"
  const mixed = s.match(/^([+-]?\d+)\s*(?:[-\s])\s*(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    if (!Number.isFinite(whole) || !Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    const sign = whole < 0 ? -1 : 1;
    return whole + sign * (num / den);
  }

  // Simple fraction: "1/2" or "3/4"
  const frac = s.match(/^([+-]?\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    return num / den;
  }

  // Decimal or integer
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s)) {
    const val = Number(s);
    return Number.isFinite(val) ? val : null;
  }

  return null;
}

export function formatArchitecturalLength(mm: number): {
  readonly mm: number;
  readonly m: number;
  readonly feetDecimal: number;
  readonly feetInches: string;
} {
  const cleanMm = Math.round(mm * 1000) / 1000;
  const totalInches = cleanMm / EXACT_MM_PER_INCH;
  const wholeFeet = Math.floor((totalInches + 1e-7) / 12);
  const remInches = Math.max(0, totalInches - wholeFeet * 12);
  // Round to nearest 1/8 inch for clean architectural readout
  const eighths = Math.round(remInches * 8);
  const carryFeet = Math.floor(eighths / 96);
  const finalFeet = wholeFeet + carryFeet;
  const remEighths = eighths % 96;
  const wholeIn = Math.floor(remEighths / 8);
  const fracNum = remEighths % 8;
  let fracStr = '';
  if (fracNum > 0) {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(fracNum, 8);
    fracStr = ` ${fracNum / g}/${8 / g}`;
  }
  return {
    mm: cleanMm,
    m: Number((cleanMm / EXACT_MM_PER_METER).toFixed(3)),
    feetDecimal: Number((cleanMm / EXACT_MM_PER_FOOT).toFixed(3)),
    feetInches: `${finalFeet}' ${wholeIn}${fracStr}"`,
  };
}

export function formatArchitecturalArea(mm2: number): {
  readonly mm2: number;
  readonly sqM: number;
  readonly sqFt: number;
  readonly labelMetric: string;
  readonly labelImperial: string;
} {
  const sqM = mm2 / EXACT_SQMM_PER_SQM;
  const sqFt = mm2 / EXACT_SQMM_PER_SQFT;
  return {
    mm2,
    sqM: Number(sqM.toFixed(3)),
    sqFt: Number(sqFt.toFixed(2)),
    labelMetric: `${sqM.toFixed(2)} m²`,
    labelImperial: `${sqFt.toFixed(1)} sq ft`,
  };
}

/**
 * Parses an architectural length input into exact millimetres (`mm`).
 *
 * Examples:
 * - `"3600 mm"` -> `3600`
 * - `"3.6 m"` -> `3600`
 * - `"12 ft"` / `"12'"` -> `3657.6`
 * - `"12' 6\""` / `"12'-6\""` / `"12 ft 6 in"` -> `3810`
 * - `"12' 6 1/2\""` -> `3822.7`
 * - `"10 1/2 ft"` -> `3200.4`
 */
export function parseArchitecturalLengthMm(
  input: string | number,
  defaultUnit: ArchitecturalLengthUnit = 'mm',
): ParsedLengthResult {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) {
      return { ok: false, error: 'Length must be a positive finite number.' };
    }
    const factor =
      defaultUnit === 'm'
        ? EXACT_MM_PER_METER
        : defaultUnit === 'cm'
          ? EXACT_MM_PER_CM
          : defaultUnit === 'ft'
            ? EXACT_MM_PER_FOOT
            : defaultUnit === 'in'
              ? EXACT_MM_PER_INCH
              : 1;
    const mm = input * factor;
    return { ok: true, mm, normalizedLabel: `${Math.round(mm * 100) / 100} mm` };
  }

  const raw = input
    .trim()
    .replace(/[’′]/g, "'")
    .replace(/[”″]/g, '"')
    .replace(/\s+/g, ' ');
  if (!raw) {
    return { ok: false, error: 'Enter a positive length (e.g. 3600 mm, 3.6 m, or 12\' 6").' };
  }

  // Compound feet + inches: e.g. 12' 6", 12'-6 1/2", 12 ft 6.5 in, 12'6
  const compoundFtIn = raw.match(
    /^([+-]?\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*[-]?\s*(\d+(?:\s+\d+\/\d+|-\d+\/\d+|\.\d+|\/\d+)?)\s*(?:"|in|inch|inches)?$/i,
  );
  if (compoundFtIn) {
    const ft = Number(compoundFtIn[1]);
    const inches = parseNumberOrMixedFraction(compoundFtIn[2]!);
    if (!Number.isFinite(ft) || ft < 0 || inches === null || inches < 0) {
      return { ok: false, error: `Invalid feet-inches measurement "${input}".` };
    }
    const mm = ft * EXACT_MM_PER_FOOT + inches * EXACT_MM_PER_INCH;
    if (mm <= 0) return { ok: false, error: 'Length must be greater than zero.' };
    return { ok: true, mm, normalizedLabel: formatArchitecturalLength(mm).feetInches };
  }

  // Single value + optional unit: decimal or mixed fraction
  const unitMatch = raw.match(
    /^(.+?)\s*(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|m|met(?:er|re)s?|ft|feet|'|in|inch|inches|")?$/i,
  );
  if (unitMatch) {
    const num = parseNumberOrMixedFraction(unitMatch[1]!);
    if (num !== null) {
      if (num <= 0) return { ok: false, error: 'Length must be greater than zero.' };
      const unitToken = (unitMatch[2] ?? defaultUnit).toLowerCase();
      let mm: number;
      if (unitToken === "'" || unitToken === 'ft' || unitToken === 'feet') {
        mm = num * EXACT_MM_PER_FOOT;
      } else if (unitToken === '"' || unitToken.startsWith('in')) {
        mm = num * EXACT_MM_PER_INCH;
      } else if (unitToken === 'm' || unitToken.startsWith('met')) {
        mm = num * EXACT_MM_PER_METER;
      } else if (unitToken === 'cm' || unitToken.startsWith('centimet')) {
        mm = num * EXACT_MM_PER_CM;
      } else {
        mm = num;
      }
      return { ok: true, mm, normalizedLabel: `${Math.round(mm * 100) / 100} mm` };
    }
  }

  return {
    ok: false,
    error: `Unrecognized length "${input}". Supported formats: 3600 mm, 3.6 m, 12 ft, 12' 6", 12' 6 1/2".`,
  };
}

/**
 * Parses a `Width × Length` dimension expression (e.g. `"12' 6\" x 15' 0\""`, `"3600 x 4500 mm"`, `"3.6m × 4.5m"`).
 */
export function parseDimensionPairMm(
  input: string,
  defaultUnit: ArchitecturalLengthUnit = 'mm',
): { readonly ok: true; readonly widthMm: number; readonly lengthMm: number; readonly areaMm2: number } | { readonly ok: false; readonly error: string } {
  const parts = input.trim().split(/\s*(?:[x×*]|by)\s*/i);
  if (parts.length !== 2) {
    return { ok: false, error: 'Expected Width × Length pair.' };
  }
  // If second side carries an explicit unit (e.g. "3600 x 4500 mm" or "12 x 15 ft") and first is unitless, inherit it
  const trailingUnitMatch = parts[1]!.trim().match(/(mm|cm|m|ft|feet|'|in|inch|inches|")$/i);
  const inheritedUnit: ArchitecturalLengthUnit = trailingUnitMatch
    ? trailingUnitMatch[1]!.toLowerCase() === "'" || trailingUnitMatch[1]!.toLowerCase().startsWith('f')
      ? 'ft'
      : trailingUnitMatch[1]!.toLowerCase() === '"' || trailingUnitMatch[1]!.toLowerCase().startsWith('in')
        ? 'in'
        : trailingUnitMatch[1]!.toLowerCase() === 'm'
          ? 'm'
          : trailingUnitMatch[1]!.toLowerCase() === 'cm'
            ? 'cm'
            : 'mm'
    : defaultUnit;

  const w = parseArchitecturalLengthMm(parts[0]!, inheritedUnit);
  if (!w.ok) return w;
  const l = parseArchitecturalLengthMm(parts[1]!, inheritedUnit);
  if (!l.ok) return l;
  return {
    ok: true,
    widthMm: w.mm,
    lengthMm: l.mm,
    areaMm2: w.mm * l.mm,
  };
}

/**
 * Parses an architectural area input into exact square millimetres (`mm²`).
 *
 * Supports:
 * - `"180 sq ft"`, `"180.5 sqft"`, `"165 1/2 sq.ft."`, `"180 ft²"`
 * - `"16.5 sq m"`, `"16.5 sqm"`, `"16.5 m²"`
 * - `"16500000 mm²"`
 * - Dimension expressions: `"12' x 15'"`, `"12' 6\" × 14' 6\""`, `"3600 x 4500 mm"`, `"3.6m x 4.5m"`
 */
export function parseArchitecturalAreaMm2(
  input: string | number,
  defaultUnit: ArchitecturalAreaUnit = 'sqft',
): ParsedAreaResult {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) {
      return { ok: false, error: 'Area must be a positive finite number.' };
    }
    const mm2 =
      defaultUnit === 'sqm'
        ? input * EXACT_SQMM_PER_SQM
        : defaultUnit === 'mm2'
          ? input
          : input * EXACT_SQMM_PER_SQFT;
    const fmt = formatArchitecturalArea(mm2);
    return {
      ok: true,
      mm2,
      sqFt: fmt.sqFt,
      sqM: fmt.sqM,
      normalizedLabel: defaultUnit === 'sqm' ? fmt.labelMetric : fmt.labelImperial,
    };
  }

  const raw = input.trim();
  if (!raw) {
    return { ok: false, error: 'Enter a positive target area (e.g. 180 sq ft, 16.7 sq m, or 12\' x 15\').' };
  }

  if (/\s*(?:[x×*]|by)\s*/i.test(raw)) {
    const pair = parseDimensionPairMm(raw, defaultUnit === 'sqm' ? 'm' : defaultUnit === 'sqft' ? 'ft' : 'mm');
    if (pair.ok) {
      const fmt = formatArchitecturalArea(pair.areaMm2);
      return {
        ok: true,
        mm2: pair.areaMm2,
        sqFt: fmt.sqFt,
        sqM: fmt.sqM,
        dimensionsMm: { widthMm: pair.widthMm, lengthMm: pair.lengthMm },
        normalizedLabel: `${fmt.labelImperial} (${fmt.labelMetric})`,
      };
    }
  }

  const areaMatch = raw.match(
    /^(.+?)\s*(sq\.?\s*ft\.?|sqft|sft|ft2|ft²|square\s+feet|sq\.?\s*m\.?|sqm|m2|m²|square\s+met(?:er|re)s?|sq\.?\s*mm|mm2|mm²)?$/i,
  );
  if (areaMatch) {
    const val = parseNumberOrMixedFraction(areaMatch[1]!);
    if (val !== null) {
      if (val <= 0) return { ok: false, error: 'Target area must be greater than zero.' };
      const unitRaw = (areaMatch[2] ?? defaultUnit).toLowerCase().replace(/[\s.]/g, '');
      let mm2: number;
      let isMetric = false;
      if (unitRaw === 'sqm' || unitRaw === 'm2' || unitRaw === 'm²' || unitRaw.startsWith('squaremet')) {
        mm2 = val * EXACT_SQMM_PER_SQM;
        isMetric = true;
      } else if (unitRaw === 'sqmm' || unitRaw === 'mm2' || unitRaw === 'mm²') {
        mm2 = val;
        isMetric = true;
      } else {
        mm2 = val * EXACT_SQMM_PER_SQFT;
      }
      const fmt = formatArchitecturalArea(mm2);
      return {
        ok: true,
        mm2,
        sqFt: fmt.sqFt,
        sqM: fmt.sqM,
        normalizedLabel: isMetric ? fmt.labelMetric : fmt.labelImperial,
      };
    }
  }

  return {
    ok: false,
    error: `Unrecognized area "${input}". Supported formats: 180 sq ft, 16.7 sq m, 165 1/2 sq ft, or 12' 6" x 14' 0".`,
  };
}

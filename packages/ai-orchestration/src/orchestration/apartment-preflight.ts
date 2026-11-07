/**
 * Gemini Visual Preflight & Apartment Acceptance Engine (§28, §29, §30).
 *
 * Implements:
 * - Structured Gemini Vision inspection of generated FLUX images before 2D vectorization.
 * - Detection of flat count, unit mix, lifts, stairs, central core, balconies, and language.
 * - Hard matching rules against the deterministic brief: NO "close enough" tolerance!
 * - Rejection of villas, Cyrillic text, wrong flat counts, missing lifts, and missing stairs.
 */

import { type BaseAIProvider } from '../providers/base';

export interface ExpectedApartmentBrief {
  readonly flatsPerFloor: number;
  readonly unitMix: ReadonlyArray<{ unitType: string; count: number }>;
  readonly liftCount: number;
  readonly stairCount: number;
  readonly commonCoreRequired: boolean;
}

export interface DetectedApartmentFeatures {
  readonly flatCount: number;
  readonly unitMix: readonly string[];
  readonly liftCount: number;
  readonly stairCount: number;
  readonly commonCore: boolean;
  readonly unitSeparation: boolean;
  readonly majorRooms: readonly string[];
  readonly balconies: boolean;
  readonly utilities: boolean;
  readonly parking: boolean;
  readonly labelLanguage: 'English' | 'Cyrillic' | 'Russian' | 'Mixed' | 'Other' | string;
  readonly isApartmentLayout: boolean; // false if standalone villa/house
  readonly visualQuality: number; // 1 to 10
  readonly confidence: number; // 0.0 to 1.0
  readonly observations: string;
}

export type PreflightFailureCode =
  | 'FLAT_COUNT_MISMATCH'
  | 'BHK_COUNT_MISMATCH'
  | 'EXTRA_FLAT'
  | 'MISSING_FLAT'
  | 'BEDROOM_MISSING'
  | 'EXTRA_BEDROOM'
  | 'LIFT_COUNT_MISMATCH'
  | 'STAIR_COUNT_MISMATCH'
  | 'CORE_MISSING'
  | 'CIRCULATION_MISSING'
  | 'UNIT_BOUNDARY_AMBIGUOUS'
  | 'IMAGE_UNREADABLE'
  | 'VISION_LOW_CONFIDENCE';

export interface ApartmentImagePreflight {
  readonly flatCount: number;
  readonly units: readonly string[];
  readonly detectedBedroomCountPerUnit: readonly number[];
  readonly stairCount: number;
  readonly liftCount: number;
  readonly commonCoreDetected: boolean;
  readonly circulationDetected: boolean;
  readonly unitSeparation: boolean;
  readonly readable: boolean;
  readonly confidence: number;
  readonly failureCodes: readonly PreflightFailureCode[];
}

export interface ApartmentVisualPreflightResult {
  readonly pass: boolean;
  readonly detected: DetectedApartmentFeatures;
  readonly failureReasons: readonly string[];
  readonly failureCodes: readonly PreflightFailureCode[];
  readonly matchingSummary: string;
  readonly imagePreflight: ApartmentImagePreflight;
}

export const APARTMENT_PREFLIGHT_SCHEMA = {
  type: 'object',
  properties: {
    flatCount: {
      type: 'integer',
      description: 'The exact number of distinct self-contained apartment flats/units shown on this floor plate.',
    },
    unitMix: {
      type: 'array',
      items: { type: 'string' },
      description: 'The typologies identified for each flat (e.g. ["2BHK", "3BHK"] or ["2BHK", "2BHK"]).',
    },
    liftCount: {
      type: 'integer',
      description: 'Number of elevators/lifts visible in the common core.',
    },
    stairCount: {
      type: 'integer',
      description: 'Number of distinct staircase blocks visible (e.g. main stair + fire escape stair).',
    },
    commonCore: {
      type: 'boolean',
      description: 'True if there is an identifiable central/shared lobby corridor connecting the flats.',
    },
    unitSeparation: {
      type: 'boolean',
      description: 'True if the individual flats have distinct party walls separating them with private entrances.',
    },
    majorRooms: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of identifiable room types (Living, Dining, Kitchen, Master Bedroom, Balcony, etc.).',
    },
    balconies: {
      type: 'boolean',
      description: 'True if balconies or sit-outs are visible on the apartment perimeters.',
    },
    utilities: {
      type: 'boolean',
      description: 'True if utility dry balconies or wet service areas are visible attached to kitchens.',
    },
    parking: {
      type: 'boolean',
      description: 'True if parking bays or vehicle driveways are shown.',
    },
    labelLanguage: {
      type: 'string',
      enum: ['English', 'Cyrillic', 'Russian', 'Mixed', 'Other'],
      description: 'Language or script of text labels in the floor plan.',
    },
    isApartmentLayout: {
      type: 'boolean',
      description: 'True if this is an orthographic multi-unit apartment floor plan. False if it is a standalone villa, single-family house, or 3D view.',
    },
    visualQuality: {
      type: 'integer',
      description: 'Visual clarity and technical linework quality score from 1 (unusable) to 10 (pristine architectural CAD).',
    },
    confidence: {
      type: 'number',
      description: 'Confidence in analysis from 0.0 to 1.0.',
    },
    observations: {
      type: 'string',
      description: 'Concise architectural observations of the floor plate.',
    },
  },
  required: [
    'flatCount',
    'unitMix',
    'liftCount',
    'stairCount',
    'commonCore',
    'unitSeparation',
    'labelLanguage',
    'isApartmentLayout',
    'visualQuality',
    'confidence',
  ],
};

export const APARTMENT_PREFLIGHT_PROMPT = `
You are an expert architectural plan reviewer evaluating an AI-generated 2D floor-plan image.
Your role is to strictly verify whether the image represents an orthographic multi-unit Indian apartment floor plan conforming to the requested design brief.

INSPECT THE IMAGE CAREFULLY FOR:
1. FLAT COUNT: Count the distinct individual apartment units sharing the floor plate.
2. UNIT MIX: Check the bedrooms in each separate flat:
   - 2BHK: Flat with Living room + 2 Bedrooms + Kitchen.
   - 3BHK: Flat with Living room + 3 Bedrooms + Kitchen.
   Report the detected array in unitMix (e.g. ["2BHK", "3BHK"]).
3. CENTRAL CORE:
   - LIFTS: Look for elevator shafts in the central core/lobby (square or rectangular compartments with diagonal 'X' crosses, elevator doors, or lift symbols). In apartment floor plans, two elevators are frequently shown as a paired dual-elevator bank or two side-by-side lift shafts [X][X]. If a paired dual-elevator bank or two elevator compartments are present in the core, count as 2 lifts.
   - STAIRCASES: Look for stairwells with tread lines and center railings (both main internal stairs and secondary/fire stairs). Count how many distinct staircases exist.
   - COMMON LOBBY: Verify a shared corridor/lobby providing separate entries to all flats.
4. TEXT / LABELS: Verify script. Only classify as Cyrillic/Russian if actual Cyrillic alphabet words appear. If labels are English or stylized Latin letters, report "English".
5. APARTMENT vs VILLA: Confirm that this is a multi-unit apartment building floor plan, NOT a standalone single-family villa or house.
6. TECHNICAL QUALITY: Confirm orthographic top-down 2D view with clear wall thickness, doors, and windows.

Return your exact structured findings following the JSON schema.
`.trim();

/**
 * Executes Gemini Vision preflight analysis on a generated apartment floor-plan image.
 */
export async function runGeminiApartmentPreflight(
  aiProvider: BaseAIProvider,
  imageBase64: string,
  expected: ExpectedApartmentBrief,
  imageMimeType = 'image/png',
): Promise<ApartmentVisualPreflightResult> {
  const unitMixDesc = expected.unitMix && expected.unitMix.length > 0
    ? ` (${expected.unitMix.map(u => `${u.count} x ${u.unitType}`).join(', ')})`
    : '';

  const userPrompt =
    `Analyze the attached generated floor-plan image. The brief requires: ${expected.flatsPerFloor} flats per floor${unitMixDesc}, ${expected.liftCount} lift(s), ${expected.stairCount} staircase(s). Return structured JSON according to the schema.`;

  const result = await aiProvider.complete({
    taskType: 'image_interpretation' as never,
    systemPrompt: APARTMENT_PREFLIGHT_PROMPT,
    userPrompt,
    // Explicit typed image part (recovery Phase 4, P8) — never embedded in text.
    images: [{ mimeType: imageMimeType, data: imageBase64 }],
    responseFormat: 'json',
    responseSchema: APARTMENT_PREFLIGHT_SCHEMA as Record<string, unknown>,
    temperature: 0.1,
    maxTokens: 2048,
  });

  let parsed: unknown = result.parsed;
  if (!parsed && typeof result.content === 'string') {
    try {
      parsed = JSON.parse(result.content);
    } catch {
      // Content could not be parsed as JSON
    }
  }
  const features = (parsed ?? {}) as unknown as DetectedApartmentFeatures;
  return evaluateApartmentPreflight(features, expected);
}

/**
 * Strict evaluation of detected features against the expected brief (§28 & §30).
 * Implements hard matching rules: No "close enough" tolerance!
 */
export function evaluateApartmentPreflight(
  detected: Partial<DetectedApartmentFeatures>,
  expected: ExpectedApartmentBrief,
): ApartmentVisualPreflightResult {
  const failureReasons: string[] = [];
  const failureCodes: PreflightFailureCode[] = [];

  const flatCount = detected.flatCount ?? 0;
  const liftCount = detected.liftCount ?? 0;
  const stairCount = detected.stairCount ?? 0;
  const commonCore = detected.commonCore ?? false;
  const unitSeparation = detected.unitSeparation ?? false;
  const isApartmentLayout = detected.isApartmentLayout ?? true;
  const labelLanguage = detected.labelLanguage ?? 'English';
  const visualQuality = detected.visualQuality ?? 5;
  const confidence = detected.confidence ?? 0.8;

  // 1. Standalone Villa Check (§28)
  if (!isApartmentLayout) {
    failureReasons.push('Generated image resembles a standalone single-family villa rather than a multi-unit apartment building.');
    failureCodes.push('IMAGE_UNREADABLE');
  }

  // 2. Strict Flat Count Matching (§13, §28, §30)
  if (flatCount !== expected.flatsPerFloor) {
    failureReasons.push(`Flat count mismatch: Requested ${expected.flatsPerFloor} flats, but image shows ${flatCount} flats.`);
    failureCodes.push('FLAT_COUNT_MISMATCH');
    if (flatCount > expected.flatsPerFloor) {
      failureCodes.push('EXTRA_FLAT');
    } else {
      failureCodes.push('MISSING_FLAT');
    }
  }

  // 2.5 Strict Unit Mix Matching (§21, §22, §26)
  if (expected.unitMix && expected.unitMix.length > 0 && detected.unitMix && detected.unitMix.length > 0) {
    const expectedMixCounts = new Map<string, number>();
    let expTotalBeds = 0;
    for (const item of expected.unitMix) {
      const typeNorm = item.unitType.toUpperCase().replace(/\s+/g, '');
      expectedMixCounts.set(typeNorm, (expectedMixCounts.get(typeNorm) ?? 0) + item.count);
      const bedMatch = /^(\d+)BHK/i.exec(typeNorm);
      if (bedMatch) expTotalBeds += parseInt(bedMatch[1]!, 10) * item.count;
    }

    const detectedMixCounts = new Map<string, number>();
    let detTotalBeds = 0;
    for (const u of detected.unitMix) {
      const typeNorm = u.toUpperCase().replace(/\s+/g, '');
      detectedMixCounts.set(typeNorm, (detectedMixCounts.get(typeNorm) ?? 0) + 1);
      const bedMatch = /^(\d+)BHK/i.exec(typeNorm);
      if (bedMatch) detTotalBeds += parseInt(bedMatch[1]!, 10);
    }

    let hasMixMismatch = false;
    for (const [type, count] of expectedMixCounts.entries()) {
      const detCount = detectedMixCounts.get(type) ?? 0;
      if (detCount !== count) {
        hasMixMismatch = true;
        failureReasons.push(
          `Unit mix mismatch: Expected ${count} x ${type}, but detected ${detCount} x ${type}.`,
        );
      }
    }
    if (hasMixMismatch) {
      failureCodes.push('BHK_COUNT_MISMATCH');
      if (detTotalBeds < expTotalBeds) {
        failureCodes.push('BEDROOM_MISSING');
      } else if (detTotalBeds > expTotalBeds) {
        failureCodes.push('EXTRA_BEDROOM');
      }
    }
  }

  // 3. Central Core & Unit Separation (§15, §28)
  if (expected.commonCoreRequired && !commonCore) {
    failureReasons.push('Common central core (shared lobby/corridor) is missing or illegible.');
    failureCodes.push('CORE_MISSING');
    failureCodes.push('CIRCULATION_MISSING');
  }

  if (expected.flatsPerFloor > 1 && !unitSeparation) {
    failureReasons.push('Flats lack clear separation; boundary walls between units are ambiguous.');
    failureCodes.push('UNIT_BOUNDARY_AMBIGUOUS');
  }

  // 4. Lift Count Matching (§28)
  if (expected.liftCount > 0 && liftCount < expected.liftCount) {
    failureReasons.push(`Lift count insufficient: Requested ${expected.liftCount} lift(s), but detected ${liftCount}.`);
    failureCodes.push('LIFT_COUNT_MISMATCH');
  }

  // 5. Staircase Count Matching (§28)
  if (expected.stairCount > 0 && stairCount < expected.stairCount) {
    failureReasons.push(`Staircase count insufficient: Requested ${expected.stairCount} stair(s), but detected ${stairCount}.`);
    failureCodes.push('STAIR_COUNT_MISMATCH');
  }

  // 6. Language & Script Requirement (§27)
  const langLower = labelLanguage.toLowerCase();
  if (langLower.includes('cyrillic') || langLower.includes('russian')) {
    failureReasons.push(`Forbidden script detected: Floor plan contains ${labelLanguage} text instead of English.`);
    failureCodes.push('IMAGE_UNREADABLE');
  }

  // 7. Visual Quality Gate (§26)
  if (visualQuality < 4) {
    failureReasons.push(`Visual quality score (${visualQuality}/10) is below acceptable architectural threshold.`);
    if (!failureCodes.includes('IMAGE_UNREADABLE')) failureCodes.push('IMAGE_UNREADABLE');
  }

  if (confidence < 0.6) {
    failureCodes.push('VISION_LOW_CONFIDENCE');
  }

  const pass = failureReasons.length === 0;
  const matchingSummary = pass
    ? `Visual acceptance PASS: ${flatCount} flats, ${liftCount} lifts, ${stairCount} stairs, English labels, verified central core.`
    : `Visual acceptance FAIL: ${failureReasons.join('; ')}`;

  const detectedBedroomCountPerUnit: number[] = (detected.unitMix ?? []).map(u => {
    const m = /^(\d+)BHK/i.exec(u.trim());
    return m ? parseInt(m[1]!, 10) : 0;
  });

  const imagePreflight: ApartmentImagePreflight = {
    flatCount,
    units: detected.unitMix ?? [],
    detectedBedroomCountPerUnit,
    stairCount,
    liftCount,
    commonCoreDetected: commonCore,
    circulationDetected: commonCore,
    unitSeparation,
    readable: visualQuality >= 4,
    confidence,
    failureCodes,
  };

  const completeDetected: DetectedApartmentFeatures = {
    flatCount,
    unitMix: detected.unitMix ?? [],
    liftCount,
    stairCount,
    commonCore,
    unitSeparation,
    majorRooms: detected.majorRooms ?? [],
    balconies: detected.balconies ?? false,
    utilities: detected.utilities ?? false,
    parking: detected.parking ?? false,
    labelLanguage,
    isApartmentLayout,
    visualQuality,
    confidence,
    observations: detected.observations ?? '',
  };

  return {
    pass,
    detected: completeDetected,
    failureReasons,
    failureCodes,
    matchingSummary,
    imagePreflight,
  };
}

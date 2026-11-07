/**
 * Targeted Apartment Planning Questionnaire & Information Completeness Gate (§19).
 *
 * Checks if the user supplied the minimum necessary information to plan an apartment floor plate.
 * Prompts targeted questions ONLY when specific parameters are missing or ambiguous.
 */

import { type ApartmentJurisdiction } from './jurisdiction';
import { type ApartmentFloorType } from './floor-configuration';
import { type ApartmentUnitType } from './typologies';

export interface DynamicApartmentQuestion {
  readonly id: string;
  readonly question: string;
  readonly description?: string;
  readonly type: 'number' | 'select' | 'multiselect' | 'unit_mix';
  readonly options?: readonly string[];
  readonly defaultValue?: unknown;
}

export interface ApartmentBriefInput {
  readonly projectType?: 'apartment' | string;
  readonly jurisdiction?: ApartmentJurisdiction;
  readonly floorCount?: number;
  readonly flatsPerFloor?: number;
  readonly floorStrategy?: ApartmentFloorType;
  readonly unitMix?: ReadonlyArray<{
    readonly unitType: ApartmentUnitType | string;
    readonly count: number;
    readonly carpetAreaSqFt?: number;
    readonly builtUpAreaSqFt?: number;
  }>;
  readonly commonCore?: {
    readonly passengerLifts?: number;
    readonly serviceLifts?: number;
    readonly staircaseCount?: number;
    readonly fireStaircaseRequired?: boolean;
    readonly commonLobby?: boolean;
    readonly serviceShaftsCount?: number;
  };
  readonly parking?: {
    readonly residentParkingCount?: number;
    readonly visitorParkingCount?: number;
    readonly twoWheelerParkingCount?: number;
  };
  readonly amenities?: {
    readonly groundSiteAmenities?: readonly string[];
    readonly buildingAmenities?: readonly string[];
  };
  readonly balconies?: {
    readonly livingBalcony?: boolean;
    readonly masterBalcony?: boolean;
    readonly dryBalcony?: boolean;
  };
  readonly targetCarpetAreaSqFtPerUnit?: number;
  readonly additionalPreferences?: readonly string[];
}

export interface ApartmentCompletenessResult {
  readonly isComplete: boolean;
  readonly missingFields: readonly string[];
  readonly questions: readonly DynamicApartmentQuestion[];
}

export function checkApartmentCompleteness(config?: Partial<ApartmentBriefInput>): ApartmentCompletenessResult {
  const missingFields: string[] = [];
  const questions: DynamicApartmentQuestion[] = [];

  // 1. Jurisdiction (§1)
  if (!config || !config.jurisdiction) {
    missingFields.push('jurisdiction');
    questions.push({
      id: 'jurisdiction',
      question: 'Which planning jurisdiction and development authority governs this project?',
      description: 'Determines applicable statutory minimums (UDCPR 2020 vs Mumbai DCPR 2034 vs NBC 2016).',
      type: 'select',
      options: [
        'Pune / PMC (Pune Municipal Corporation)',
        'Pune / PMRDA (Pune Metropolitan Region)',
        'Mumbai / MCGM (Greater Mumbai DCPR 2034)',
        'Generic Maharashtra (UDCPR-2020)',
        'Generic Indian (NBC 2016 Reference)',
      ],
      defaultValue: 'Pune / PMC (Pune Municipal Corporation)',
    });
  }

  // 2. Flats per floor (§13). Phase 1 recovery (P1): 1 flat per floor (single-unit
  // path) is a supported configuration, not a missing-field condition.
  if (!config || !config.flatsPerFloor || config.flatsPerFloor < 1) {
    missingFields.push('flatsPerFloor');
    questions.push({
      id: 'flatsPerFloor',
      question: 'How many flats per floor are required?',
      description: 'Exact number of residential tenements sharing a central core.',
      type: 'select',
      options: ['1 flat / floor', '2 flats / floor', '3 flats / floor', '4 flats / floor', '5 flats / floor', '6 flats / floor'],
      defaultValue: '4 flats / floor',
    });
  }

  // 3. Number of floors (§9)
  if (!config || !config.floorCount || config.floorCount < 1) {
    missingFields.push('floorCount');
    questions.push({
      id: 'floorCount',
      question: 'How many floors are planned for this apartment building?',
      description: 'E.g., Ground + 4 (5 Floors), Ground + 7 (8 Floors). Sets staircase width and lift mandates.',
      type: 'select',
      options: ['G+3 (4 Floors)', 'G+4 (5 Floors)', 'G+5 (6 Floors)', 'G+7 (8 Floors)', 'G+10 (11 Floors)'],
      defaultValue: 'G+4 (5 Floors)',
    });
  }

  // 4. Unit Mix (§14)
  const mixTotal = config?.unitMix ? config.unitMix.reduce((sum, u) => sum + (u.count || 0), 0) : 0;
  if (!config?.unitMix || config.unitMix.length === 0 || mixTotal <= 0) {
    missingFields.push('unitMix');
    questions.push({
      id: 'unitMix',
      question: 'What unit mix is required for this apartment?',
      description: 'Specify exact count and typologies (e.g. 2 x 2BHK and 2 x 3BHK).',
      type: 'unit_mix',
      defaultValue: [
        { unitType: '2BHK', count: 2 },
        { unitType: '3BHK', count: 2 },
      ],
    });
  }

  // 5. Floor Type / Strategy (§12) - optional default fallback to typical
  if (config && !config.floorStrategy) {
    // If not supplied, defaults safely to 'typical'
  }

  return {
    isComplete: missingFields.length === 0,
    missingFields,
    questions,
  };
}

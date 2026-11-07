/**
 * Design Strategy Profiles and Planning Grammar (Phase 2 & 3).
 *
 * Defines explicit architectural strategies based on real-world references:
 * - Parking-first L-shape with arrival foyer & stair (References 1 & 2)
 * - Courtyard / OTS-centered ventilation & wet core grouping (References 2 & 3)
 * - Offset stepped wings with independent service access (Reference 3)
 * - Compact frontage with open garden court
 */

import type { DesignStrategy } from '@ai-floor-planner/core';

export interface ArchitecturalStrategyProfile extends DesignStrategy {
  readonly priorityWeight: number;
  readonly defaultParkingSide: 'left' | 'right';
  readonly preferredCoreWidthRatio: number;
}

export const ARCHITECTURAL_STRATEGIES: readonly ArchitecturalStrategyProfile[] = [
  {
    id: 'parking_first_l_shape',
    name: 'Front Parking Court (L-Shape Massing)',
    description: 'Carves a dedicated off-street parking bay and entry porch into the front footprint; dog-legged staircase positioned off arrival foyer for independent vertical circulation.',
    footprintStrategy: 'l_shape_court',
    zoningStrategy: 'public_front_private_rear',
    circulationStrategy: 'foyer_hub',
    parkingStrategy: 'front_left_bay',
    outdoorStrategy: 'front_court_rear_utility',
    stairLocation: 'arrival_adjacent',
    wetCoreGrouping: 'clustered_rear_service',
    priorityWeight: 100,
    defaultParkingSide: 'left',
    preferredCoreWidthRatio: 0.42,
  },
  {
    id: 'courtyard_ots',
    name: 'Central OTS & Wet-Core Clustered',
    description: 'Embeds an Open-To-Sky (OTS) light well to naturally aerate internal bathrooms and kitchen; public living and dining form an open spine with bedrooms buffered at the perimeter.',
    footprintStrategy: 'courtyard_centered',
    zoningStrategy: 'central_living_lateral_private',
    circulationStrategy: 'central_lobby',
    parkingStrategy: 'front_left_bay',
    outdoorStrategy: 'central_ots',
    stairLocation: 'central_core',
    wetCoreGrouping: 'split_ensuite_central_service',
    priorityWeight: 90,
    defaultParkingSide: 'left',
    preferredCoreWidthRatio: 0.5,
  },
  {
    id: 'offset_wings',
    name: 'Offset Stepped Wings (Service-Articulated)',
    description: 'Steps the building massing to separate the main living suite from the kitchen, utility, and servant service zone, creating private courtyard pockets and direct service entry.',
    footprintStrategy: 'offset_stepped',
    zoningStrategy: 'split_wings',
    circulationStrategy: 'linear_spine',
    parkingStrategy: 'front_forecourt',
    outdoorStrategy: 'side_court_garden',
    stairLocation: 'arrival_adjacent',
    wetCoreGrouping: 'clustered_rear_service',
    priorityWeight: 80,
    defaultParkingSide: 'right',
    preferredCoreWidthRatio: 0.46,
  },
  {
    id: 'compact_frontage',
    name: 'Compact Massing & Garden Court',
    description: 'Consolidates the building into a proportional footprint preserving maximum contiguous frontage for parking, driveway, and landscaped garden.',
    footprintStrategy: 'compact_frontage',
    zoningStrategy: 'public_front_private_rear',
    circulationStrategy: 'foyer_hub',
    parkingStrategy: 'front_left_bay',
    outdoorStrategy: 'front_court_rear_utility',
    stairLocation: 'central_core',
    wetCoreGrouping: 'clustered_rear_service',
    priorityWeight: 70,
    defaultParkingSide: 'left',
    preferredCoreWidthRatio: 0.48,
  },
];

export function getStrategyProfile(id: string): ArchitecturalStrategyProfile {
  return ARCHITECTURAL_STRATEGIES.find(s => s.id === id) ?? ARCHITECTURAL_STRATEGIES[0]!;
}

export function selectArchitecturalStrategies(
  options: {
    hasParking: boolean;
    hasGarden: boolean;
    isNarrowLot: boolean;
    isIrregular: boolean;
    vastuEnabled: boolean;
  },
): readonly ArchitecturalStrategyProfile[] {
  if (options.isIrregular) {
    return [
      ARCHITECTURAL_STRATEGIES[2]!, // offset_wings
      ARCHITECTURAL_STRATEGIES[0]!, // parking_first_l_shape
      ARCHITECTURAL_STRATEGIES[1]!, // courtyard_ots
    ];
  }

  if (options.isNarrowLot) {
    return [
      ARCHITECTURAL_STRATEGIES[0]!, // parking_first_l_shape (Reference 1 & 2)
      ARCHITECTURAL_STRATEGIES[1]!, // courtyard_ots (Reference 2)
      ARCHITECTURAL_STRATEGIES[3]!, // compact_frontage
    ];
  }

  // Standard or wide lot (like 50x50 ft): return all 4 rich architectural strategies
  return [
    ARCHITECTURAL_STRATEGIES[0]!, // parking_first_l_shape
    ARCHITECTURAL_STRATEGIES[1]!, // courtyard_ots
    ARCHITECTURAL_STRATEGIES[2]!, // offset_wings
    ARCHITECTURAL_STRATEGIES[3]!, // compact_frontage
  ];
}

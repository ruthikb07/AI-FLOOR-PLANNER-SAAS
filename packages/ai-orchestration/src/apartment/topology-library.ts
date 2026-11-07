/**
 * Building Form & Apartment Floor Topology Library (§5).
 *
 * Implements:
 * - Reusable apartment-floor topology families for 2–8 units.
 * - TopologyCompatibility matrix matching unit count, aspect ratios, and core placement.
 * - Deterministic family selection for candidate search.
 */

export type ApartmentTopologyFamily =
  | 'THREE_WING_CORE'
  | 'FOUR_CORNER_CORE'
  | 'LINEAR_DUAL_LOADED'
  | 'LINEAR_SINGLE_LOADED'
  | 'CENTRAL_CORE_RADIAL'
  | 'L_SHAPED_CORE'
  | 'T_SHAPED_CORE'
  | 'DUAL_CORE'
  | 'SIDE_CORE'
  | 'COMPACT_RECTANGULAR';

export interface TopologyCompatibility {
  readonly family: ApartmentTopologyFamily;
  readonly name: string;
  readonly description: string;
  readonly minUnits: number;
  readonly maxUnits: number;
  readonly suitableAspectRatios: readonly [number, number]; // [minRatio, maxRatio] width/depth
  readonly supportsCentralCore: boolean;
  readonly supportsSideCore: boolean;
  readonly exposureCharacteristics: readonly string[];
  readonly circulationCharacteristics: readonly string[];
}

export const TOPOLOGY_FAMILIES: readonly TopologyCompatibility[] = [
  {
    family: 'THREE_WING_CORE',
    name: 'Tri-Wing Radial Core',
    description: 'T- or Y-shaped arrangement with 3 wings radiating from a central shared lift/stair core.',
    minUnits: 3,
    maxUnits: 3,
    suitableAspectRatios: [0.8, 1.25],
    supportsCentralCore: true,
    supportsSideCore: false,
    exposureCharacteristics: ['3-sided exterior exposure for every unit', 'Cross-ventilation on multiple facades'],
    circulationCharacteristics: ['Zero common corridors', 'Direct unit entry from central elevator lobby'],
  },
  {
    family: 'FOUR_CORNER_CORE',
    name: 'Four-Quadrant Corner Core',
    description: 'Four corner apartments wrapped symmetrically around a compact central service and elevator core.',
    minUnits: 4,
    maxUnits: 4,
    suitableAspectRatios: [0.8, 1.25],
    supportsCentralCore: true,
    supportsSideCore: false,
    exposureCharacteristics: ['2-sided corner exposure for all units', 'Excellent corner daylighting'],
    circulationCharacteristics: ['Central square lobby', 'Minimal travel distance to each quadrant entry'],
  },
  {
    family: 'COMPACT_RECTANGULAR',
    name: 'Compact Symmetrical Rectangular',
    description: 'Rectangular floor plate divided symmetrically into 2 or 3 wide-frontage units flanking the core.',
    minUnits: 2,
    maxUnits: 3,
    suitableAspectRatios: [0.5, 2.0],
    supportsCentralCore: true,
    supportsSideCore: true,
    exposureCharacteristics: ['Front-to-back or side daylighting', 'Protected internal core'],
    circulationCharacteristics: ['Compact arrival landing', 'Direct entrance doors'],
  },
  {
    family: 'SIDE_CORE',
    name: 'Perimeter Side Core',
    description: 'Vertical circulation core placed on a non-primary perimeter edge, maximizing contiguous residential facade.',
    minUnits: 2,
    maxUnits: 4,
    suitableAspectRatios: [0.6, 1.8],
    supportsCentralCore: false,
    supportsSideCore: true,
    exposureCharacteristics: ['Maximized daylight on 3 open facades', 'Core acts as thermal/acoustic buffer on side/rear'],
    circulationCharacteristics: ['Side entry corridor', 'Direct access along structural spine'],
  },
  {
    family: 'LINEAR_DUAL_LOADED',
    name: 'Linear Double-Loaded Corridor',
    description: 'Central spine circulation corridor with apartments flanking on opposing sides.',
    minUnits: 4,
    maxUnits: 8,
    suitableAspectRatios: [1.3, 3.0],
    supportsCentralCore: true,
    supportsSideCore: false,
    exposureCharacteristics: ['Single-sided or corner exterior exposure per flat', 'Consistent module repetition'],
    circulationCharacteristics: ['Central straight corridor', 'Standard fire escape stair at ends'],
  },
  {
    family: 'LINEAR_SINGLE_LOADED',
    name: 'Linear Single-Loaded Gallery',
    description: 'Apartments arrayed along an open or glazed single-loaded access corridor.',
    minUnits: 2,
    maxUnits: 4,
    suitableAspectRatios: [1.5, 3.5],
    supportsCentralCore: false,
    supportsSideCore: true,
    exposureCharacteristics: ['Dual aspect cross-ventilation', 'Through-unit airflow'],
    circulationCharacteristics: ['External walkway or single loaded corridor', 'Higher circulation area'],
  },
  {
    family: 'CENTRAL_CORE_RADIAL',
    name: 'Central Core Radial Cluster',
    description: '3 to 6 units radially clustered around an enlarged central elevator and service lobby.',
    minUnits: 3,
    maxUnits: 6,
    suitableAspectRatios: [0.85, 1.2],
    supportsCentralCore: true,
    supportsSideCore: false,
    exposureCharacteristics: ['Radial facade distribution', 'Exterior corner views'],
    circulationCharacteristics: ['Compact central atrium or lobby', 'Radial short doorways'],
  },
  {
    family: 'L_SHAPED_CORE',
    name: 'L-Shaped Corner Spine',
    description: 'Floor plate shaped around a courtyard or street corner with core at the bend.',
    minUnits: 3,
    maxUnits: 5,
    suitableAspectRatios: [0.9, 1.6],
    supportsCentralCore: false,
    supportsSideCore: true,
    exposureCharacteristics: ['Multiple facade orientations', 'Courtyard and street dual views'],
    circulationCharacteristics: ['L-shaped corridor connecting two distinct wings'],
  },
  {
    family: 'T_SHAPED_CORE',
    name: 'T-Shaped Articulated Core',
    description: 'Core situated at the intersection of a cross-bar and stem wing.',
    minUnits: 3,
    maxUnits: 5,
    suitableAspectRatios: [0.9, 1.5],
    supportsCentralCore: true,
    supportsSideCore: false,
    exposureCharacteristics: ['3 distinct wing facades', 'Good corner articulation'],
    circulationCharacteristics: ['T-junction circulation foyer'],
  },
  {
    family: 'DUAL_CORE',
    name: 'Dual Independent Core',
    description: 'Two separate vertical circulation cores serving independent apartment wings on large floor plates.',
    minUnits: 6,
    maxUnits: 8,
    suitableAspectRatios: [1.8, 3.5],
    supportsCentralCore: false,
    supportsSideCore: true,
    exposureCharacteristics: ['High privacy with 2-3 flats per core cluster', 'Maximized facade exposure'],
    circulationCharacteristics: ['Two separate lift/stair lobbies', 'Optional link bridge/corridor'],
  },
];

/**
 * Finds all compatible topology families for a given contract and floor plate aspect ratio.
 */
export function findCompatibleTopologyFamilies(
  flatCount: number,
  aspectRatio = 1.0,
  preferredCorePlacement: 'CENTRAL' | 'SIDE' = 'CENTRAL',
): readonly TopologyCompatibility[] {
  return TOPOLOGY_FAMILIES.filter(family => {
    // 1. Unit count bounds
    if (flatCount < family.minUnits || flatCount > family.maxUnits) {
      return false;
    }

    // 2. Aspect ratio suitability (with a 15% tolerance margin)
    const [minAsp, maxAsp] = family.suitableAspectRatios;
    if (aspectRatio < minAsp * 0.85 || aspectRatio > maxAsp * 1.15) {
      return false;
    }

    // 3. Core placement preference
    if (preferredCorePlacement === 'CENTRAL' && !family.supportsCentralCore) {
      return false;
    }
    if (preferredCorePlacement === 'SIDE' && !family.supportsSideCore) {
      return false;
    }

    return true;
  });
}

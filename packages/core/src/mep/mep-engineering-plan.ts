/**
 * Phase 3 coordinated MEP engineering plan.
 *
 * This is a drafting-level coordination model (electrical, plumbing, reflected
 * ceiling, fire safety and cantilever balcony framing) layered beside the
 * strictly validated `CanonicalMepSystems`. It never replaces that contract and
 * is not a certified engineering design: every element is a proposal for
 * professional review.
 */
import type { Point as Point2D } from '../types/geometry';

export type MepDiscipline = 'ELECTRICAL' | 'PLUMBING' | 'CEILING' | 'FIRE' | 'STRUCTURAL';

/** Engineering overlay toggles shared by the renderer, CAD and PDF exporters. */
export type EngineeringOverlay =
  | 'ARCHITECTURAL'
  | 'STRUCTURAL'
  | 'ELECTRICAL'
  | 'PLUMBING'
  | 'FALSE_CEILING'
  | 'FIRE_SAFETY';

export const ENGINEERING_OVERLAYS: readonly EngineeringOverlay[] = [
  'ARCHITECTURAL',
  'STRUCTURAL',
  'ELECTRICAL',
  'PLUMBING',
  'FALSE_CEILING',
  'FIRE_SAFETY',
];

export type MepSymbolKind =
  // Electrical (M-ELEC-SYMB)
  | 'DB' | 'FAN' | 'DL' | 'SB' | 'SB_2WAY' | 'SOCKET_16A' | 'GY' | 'AC_IDU' | 'AC_ODU'
  // Plumbing fixtures (M-PLUMB-FIXT)
  | 'PLUMB_SHAFT' | 'FT' | 'NT'
  // Fire safety (F-FIRE-SYMB)
  | 'FHR' | 'FHR_HR' | 'FACP' | 'SD' | 'HD' | 'EXIT_SIGN' | 'SPRINKLER';

export type MepEngineeringCadLayer =
  | 'M-ELEC-SYMB'
  | 'M-ELEC-WIRE'
  | 'M-PLUMB-PIPE'
  | 'M-PLUMB-FIXT'
  | 'A-CEIL-GRID'
  | 'F-FIRE-SYMB'
  | 'S-BEAM-CANTILEVER';

export interface MepSymbol {
  readonly id: string;
  readonly kind: MepSymbolKind;
  readonly discipline: MepDiscipline;
  readonly layer: MepEngineeringCadLayer;
  readonly position: Point2D;
  readonly roomId?: string;
  readonly unitId?: string;
  /** Plan footprint for rectangular items (shafts, ODUs); otherwise a symbol. */
  readonly widthMm?: number;
  readonly depthMm?: number;
  readonly label: string;
}

export type MepPipeKind = 'CWS' | 'HWS' | 'SP' | 'WP' | 'WIRING_LOOP';

export interface MepRun {
  readonly id: string;
  readonly kind: MepPipeKind;
  readonly discipline: MepDiscipline;
  readonly layer: MepEngineeringCadLayer;
  readonly diameterMm?: number;
  /** Nominal schematic fall target. Hydraulic sizing and available fall are unverified. */
  readonly slopeRatio?: string;
  /** Plan centerline run length in millimetres. */
  readonly lengthMm?: number;
  readonly points: readonly Point2D[];
  readonly roomId?: string;
}

export interface DrainageEconomySummary {
  readonly routingStatus: 'SCHEMATIC_UNSIZED';
  readonly sharedShaftCount: number;
  readonly servedWetRoomCount: number;
  readonly consolidatedBranchRuns: number;
  readonly totalDrainagePipeLengthMm: number;
  readonly collectorSlopeRatio?: string;
  readonly collectorTerminatesTowardsRoad: boolean;
  readonly unconnectedRiserCount: number;
}

export type CeilingZoneKind = 'COVE_GYPSUM' | 'GRID_600' | 'PELMET';

export interface CeilingZone {
  readonly id: string;
  readonly kind: CeilingZoneKind;
  readonly roomId: string;
  /** Closed outline (cove inset boundary, grid extent or pelmet pocket). */
  readonly outline: readonly Point2D[];
  /** Grid line segments for GRID_600 zones. */
  readonly gridLines?: readonly (readonly [Point2D, Point2D])[];
  readonly insetMm?: number;
}

export interface CantileverBeam {
  readonly id: string;
  readonly balconyRoomId: string;
  readonly start: Point2D;
  readonly end: Point2D;
  readonly projectionMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
}

export interface FloorMepEngineeringPlan {
  readonly floorId: string;
  readonly floorLevel: number;
  readonly symbols: readonly MepSymbol[];
  readonly runs: readonly MepRun[];
  readonly ceilings: readonly CeilingZone[];
  readonly cantileverBeams: readonly CantileverBeam[];
}

export interface CoordinatedMepEngineeringPlan {
  readonly schemaVersion: 'RH-MEP-3.0';
  readonly status: 'COORDINATION_PROPOSAL_NOT_CERTIFIED';
  readonly floors: readonly FloorMepEngineeringPlan[];
  /** Shaft stacks continuous from the top typical floor to the stilt collector line. */
  readonly verticalStacks: readonly {
    readonly id: string;
    readonly position: Point2D;
    readonly widthMm: number;
    readonly depthMm: number;
    readonly floorIds: readonly string[];
    readonly terminatesAtStiltCollector: boolean;
  }[];
  readonly drainageEconomy?: DrainageEconomySummary;
  readonly summary: Readonly<Record<string, number>>;
}

export const MEP_CAD_LAYER_COLORS: Readonly<Record<MepEngineeringCadLayer, number>> = {
  'M-ELEC-SYMB': 30,
  'M-ELEC-WIRE': 40,
  'M-PLUMB-PIPE': 150,
  'M-PLUMB-FIXT': 140,
  'A-CEIL-GRID': 253,
  'F-FIRE-SYMB': 10,
  'S-BEAM-CANTILEVER': 210,
};

export const OVERLAY_LAYERS: Readonly<Record<EngineeringOverlay, readonly MepEngineeringCadLayer[]>> = {
  ARCHITECTURAL: [],
  STRUCTURAL: ['S-BEAM-CANTILEVER'],
  ELECTRICAL: ['M-ELEC-SYMB', 'M-ELEC-WIRE'],
  PLUMBING: ['M-PLUMB-PIPE', 'M-PLUMB-FIXT'],
  FALSE_CEILING: ['A-CEIL-GRID'],
  FIRE_SAFETY: ['F-FIRE-SYMB'],
};

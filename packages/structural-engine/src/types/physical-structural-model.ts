/**
 * @ai-floor-planner/structural-engine — Distinct Physical vs Analytical Structural Identities (Gate 2)
 *
 * Strictly separates:
 * 1. Physical Structural Members (`PhysicalColumn`, `PhysicalBeam`, `PhysicalSlab`, `PhysicalFoundation`, `PhysicalStairWaist`)
 *    — Real constructible building occurrences used for RCC design cages, schedules, IFC4 physical entities,
 *      CAD framing drawings, Bar Bending Schedules (BBS), Material BOQ quantities, and localized optimization.
 * 2. Analytical Finite Elements (`AnalyticalNode`, `AnalyticalFrameElement`, `AnalysisStation`)
 *    — Numerical discretization entities used by Awatif C++/WASM FEA (`1` physical member <-> `1..N` analytical elements).
 * 3. Explicit Bidirectional Parent-Child Mapping & Consolidated Schedule Grouping (`C1`, `B1`, `S1`, `F1`)
 *    — Guarantees subdividing a physical girder or column into `k` finite elements NEVER duplicates reinforcement
 *      cages, IFC occurrences, BBS marks, or concrete volumes!
 */

import type { Point } from '@ai-floor-planner/core';
import type { ConcreteGrade, SteelGrade } from '../assembly/canonical-frame-assembler.js';
import type { StructuralMemberCategory } from './solver-types.js';

export type PhysicalMemberKind =
  | 'PHYSICAL_COLUMN'
  | 'PHYSICAL_BEAM'
  | 'PHYSICAL_SLAB'
  | 'PHYSICAL_FOUNDATION'
  | 'PHYSICAL_STAIR_WAIST';

export interface AnalysisStation {
  readonly stationId: string;
  readonly physicalMemberId: string;
  readonly analyticalElementId: string;
  readonly analyticalElementIndex: number;
  /** Distance from start of the parent physical member in millimetres (mm). */
  readonly physicalDistanceMm: number;
  /** Normalized coordinate [0, 1] along the parent physical member. */
  readonly normalizedPhysicalPosition: number;
  /** Normalized coordinate [0, 1] along the child analytical finite element. */
  readonly normalizedElementPosition: number;
}

export interface ReinforcementBar {
  readonly barId: string;
  readonly physicalMemberId: string;
  readonly scheduleGroupMark: string;
  readonly role:
    | 'TOP_MAIN'
    | 'BOTTOM_MAIN'
    | 'COLUMN_LONGITUDINAL'
    | 'TRANSVERSE_STIRRUP'
    | 'CONFINING_HOOP'
    | 'SLAB_SHORT_SPAN'
    | 'SLAB_LONG_SPAN'
    | 'FOOTING_BOTTOM_X'
    | 'FOOTING_BOTTOM_Y'
    | 'FOOTING_TOP_MAT'
    | 'STAIR_MAIN'
    | 'STAIR_DISTRIBUTION';
  readonly barDiaMm: number;
  readonly barCount: number;
  readonly spacingMm?: number;
  readonly layers: number;
  readonly cuttingLengthMm: number;
  readonly areaProvidedMm2: number;
}

export interface PhysicalColumn {
  readonly kind: 'PHYSICAL_COLUMN';
  readonly physicalMemberId: string;
  /** Multi-storey vertical stack mark (e.g. `C1`..`C48`). */
  readonly stackId: string;
  /** Grouped type mark for identical section + reinforcement lifts on the same storey/group (e.g. `CT-1`). */
  readonly scheduleGroupMark?: string;
  readonly floorId: string;
  readonly storeyLevel: number;
  readonly centerXMm: number;
  readonly centerYMm: number;
  readonly baseElevationMm: number;
  readonly topElevationMm: number;
  readonly clearHeightMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly rotationDeg: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  readonly sizingProvenance: 'CANONICAL_EXPLICIT' | 'PRELIMINARY_SPAN_AND_STACK_RULE' | 'OPTIMIZED';
  /** Ordered child analytical finite element IDs (`1..N`) from bottom to top of this physical column lift. */
  readonly analyticalElementIds: readonly string[];
  readonly analyticalElementIndices: readonly number[];
  readonly startAnalyticalNodeIndex: number;
  readonly endAnalyticalNodeIndex: number;
}

export interface PhysicalBeam {
  readonly kind: 'PHYSICAL_BEAM';
  readonly physicalMemberId: string;
  readonly beamMark: string;
  readonly scheduleGroupMark?: string;
  readonly category: Extract<
    StructuralMemberCategory,
    'BEAM' | 'CANTILEVER_BEAM' | 'PLINTH_BEAM' | 'TIE_BEAM'
  >;
  readonly floorId: string;
  readonly storeyLevel: number;
  readonly startPointMm: Point;
  readonly endPointMm: Point;
  readonly topElevationMm: number;
  readonly clearSpanMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  readonly supportedWallThicknessMm: number;
  readonly supportedWallHeightMm: number;
  readonly wallOpeningFraction: number;
  readonly sizingProvenance: 'CANONICAL_EXPLICIT' | 'PRELIMINARY_SPAN_AND_STACK_RULE' | 'OPTIMIZED';
  /** Ordered child analytical finite element IDs (`1..N`) along this continuous physical beam span! */
  readonly analyticalElementIds: readonly string[];
  readonly analyticalElementIndices: readonly number[];
  readonly startAnalyticalNodeIndex: number;
  readonly endAnalyticalNodeIndex: number;
  /** Intermediate analytical nodes where secondary beams or cantilevers frame into this physical beam. */
  readonly intermediateAnalyticalNodeIndices: readonly number[];
}

export interface PhysicalSlab {
  readonly deckReview?: import('../assembly/reviewed-decks.js').RectangularDeckReview;
  readonly kind: 'PHYSICAL_SLAB';
  readonly physicalMemberId: string;
  readonly slabMark: string;
  readonly scheduleGroupMark?: string;
  readonly floorId: string;
  readonly floorLevel: number;
  readonly roomId?: string;
  readonly roomName: string;
  readonly roomType: string;
  readonly panelType: 'TWO_WAY' | 'ONE_WAY' | 'CANTILEVER';
  /** Structural clear/effective bay spans bounded by supporting beams (never un-subdivided whole-floor plates!). */
  readonly lxMm: number;
  readonly lyMm: number;
  readonly aspectRatioLyLx: number;
  readonly areaM2: number;
  readonly thicknessMm: number;
  readonly topElevationMm: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  readonly discontinuousEdges: number;
  readonly supportingPhysicalBeamIds: readonly string[];
  readonly supportingAnalyticalElementIndices: readonly number[];
  readonly boundsMm: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
  };
  readonly exchangeBoundary?: readonly Point[];
  readonly sizingProvenance: 'PRELIMINARY_SPAN_DEPTH_RULE' | 'USER_OR_OPTIMIZER_ASSIGNED';
}

export interface PhysicalStairWaist {
  readonly bearingReview?: import('../loads/reviewed-stair-bearings.js').StairBearingReview;
  readonly kind: 'PHYSICAL_STAIR_WAIST';
  readonly physicalMemberId: string;
  readonly floorId: string;
  readonly stairId: string;
  readonly boundsMm: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
  };
  /** Flight travel direction in canonical plan (`'N' | 'S' | 'E' | 'W'`). */
  readonly flightDirection: 'N' | 'S' | 'E' | 'W';
  readonly baseElevationMm: number;
  readonly topElevationMm: number;
  readonly horizontalSpanMm: number;
  readonly widthMm: number;
  readonly waistThicknessMm: number;
  readonly riserMm: number;
  readonly treadMm: number;
  readonly riserCount: number;
  readonly supportingPhysicalBeamIds: readonly string[];
  readonly supportingAnalyticalElementIndices: readonly number[];
  /** True when planar inclined flight endpoints & thickness are fully defined for exact IFC4 solid export. */
  readonly ifcSolidGeometrySupported: boolean;
}

export interface PhysicalFoundation {
  readonly kind: 'PHYSICAL_FOUNDATION';
  readonly physicalMemberId: string;
  readonly footingId: string;
  readonly scheduleGroupMark?: string;
  readonly typology: 'ISOLATED' | 'COMBINED' | 'STRAP' | 'STRIP' | 'RIGID_RAFT';
  readonly supportedStackIds: readonly string[];
  readonly supportedAnalyticalBaseNodeIndices: readonly number[];
  readonly centerXMm: number;
  readonly centerYMm: number;
  readonly baseElevationMm: number;
  readonly lengthXMm: number;
  readonly widthYMm: number;
  readonly thicknessMm: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
}

export interface PhysicalToAnalyticalMapping {
  /** Maps `physicalMemberId` -> ordered child `analyticalElementIds` (`1..N`). */
  readonly physicalToAnalyticalElementIds: Readonly<Record<string, readonly string[]>>;
  /** Maps `analyticalElementId` -> parent `physicalMemberId` (`N -> 1`). */
  readonly analyticalToPhysicalMemberId: Readonly<Record<string, string>>;
  /** Maps `analyticalElementIndex` -> parent `physicalMemberId`. */
  readonly analyticalIndexToPhysicalMemberId: readonly string[];
  /** Ordered analysis stations across all physical frame members. */
  readonly stationsByPhysicalMemberId: Readonly<Record<string, readonly AnalysisStation[]>>;
}

export interface PhysicalStructuralModel {
  readonly columns: readonly PhysicalColumn[];
  readonly beams: readonly PhysicalBeam[];
  readonly slabs: readonly PhysicalSlab[];
  readonly stairWaists: readonly PhysicalStairWaist[];
  readonly mapping: PhysicalToAnalyticalMapping;
}

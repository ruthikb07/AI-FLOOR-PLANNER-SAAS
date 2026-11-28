/**
 * @ai-floor-planner/structural-engine — Canonical Architectural-to-Structural Frame Assembler (Milestone 5.1 Gates 2 & 3)
 *
 * Synthesizes a traceable Physical Structural Model AND 3D Analytical Frame Model from RH Planner's
 * Canonical `Building` (`mm`) without mutating architectural geometry:
 * 1. Binds `sourceArchitecturalRevision` (`building.version`) and `sourceArchitecturalSha256`.
 * 2. Preserves explicit physical vs analytical member separation (`PhysicalColumn`, `PhysicalBeam`,
 *    `PhysicalSlab`, `PhysicalStairWaist`, `PhysicalToAnalyticalMapping`), allowing `1` physical beam/column
 *    to map cleanly to `1..N` analytical finite elements (`AnalyticalFrameElement`) without duplicating cages!
 * 3. Generates practical engineering framing (`PRACTICAL_ARCHITECTURAL_GRID`):
 *    - Honors approved architectural `floor.columns` (`ΔX=0, ΔY=0`) without polluting column stacks with
 *      interior `115 mm` partition room bounding-box corners.
 *    - Enforces minimum structural column spacing (`>= 1,800 mm` for auto-synthesized columns) to eliminate
 *      artificial `660–800 mm` stub beams, while subdividing genuinely unframed long spans `> maxColumnSpacingMm`.
 *    - Protects doors, windows, stair flights, lift shafts, and open stilt parking drive aisles.
 *    - Splits wide floor bays with secondary beams framing into primary girders at mid-span analytical nodes
 *      (`1 PhysicalBeam -> 2+ AnalyticalFrameElements`), and subdivides large open slabs/terraces along
 *      supporting structural beam bays.
 *    - Sizes preliminary columns & beams according to actual tributary area, storey stack depth, clear span,
 *      and seismic ductility rules (naturally demand-varied across bays and storeys).
 */

import { canonicalBuildingHash, type Building, type Floor, type Point, type Room } from '@ai-floor-planner/core';
import type {
  AnalysisStation,
  PhysicalBeam,
  PhysicalColumn,
  PhysicalSlab,
  PhysicalStairWaist,
  PhysicalStructuralModel,
} from '../types/physical-structural-model.js';
import type {
  AnalyticalFrameElement,
  AnalyticalNode,
  SixDofRestraint,
  StructuralMemberCategory,
} from '../types/solver-types.js';
import {
  canonicalMmToStructuralMeters,
  computeRectangularSectionProps,
  IS875_RCC_UNIT_WEIGHT_KN_M3,
} from '../adapter/units-and-coordinates.js';

export type ConcreteGrade = 'M20' | 'M25' | 'M30' | 'M35' | 'M40';
export type SteelGrade = 'Fe415' | 'Fe500' | 'Fe550';

export const CONCRETE_FCK_MPA: Readonly<Record<ConcreteGrade, number>> = {
  M20: 20,
  M25: 25,
  M30: 30,
  M35: 35,
  M40: 40,
};

export const STEEL_FY_MPA: Readonly<Record<SteelGrade, number>> = {
  Fe415: 415,
  Fe500: 500,
  Fe550: 550,
};

/** IS 456:2000 Clause 6.2.3.1 Short-term static modulus of elasticity Ec = 5000 * sqrt(fck) MPa. */
export function concreteElasticModulusMPa(grade: ConcreteGrade): number {
  return 5000 * Math.sqrt(CONCRETE_FCK_MPA[grade]);
}

export interface ArchitecturalStructuralClash {
  readonly id: string;
  readonly kind:
    | 'DOOR_OPENING_INTRUSION'
    | 'WINDOW_OPENING_INTRUSION'
    | 'STAIR_FLIGHT_INTRUSION'
    | 'LIFT_CORE_INTRUSION'
    | 'STILT_DRIVE_AISLE_INTRUSION'
    | 'HEADROOM_CLEARANCE_WARNING';
  readonly severity: 'ERROR' | 'WARNING';
  readonly floorId: string;
  readonly structuralMemberId: string;
  readonly architecturalEntityId: string;
  readonly message: string;
  readonly positionMm: { readonly x: number; readonly y: number };
}

export interface SynthesizedSlabPanel {
  readonly deckReview?: import('../assembly/reviewed-decks.js').RectangularDeckReview;
  readonly id: string;
  readonly floorId: string;
  readonly floorLevel: number;
  readonly roomId?: string;
  readonly roomName: string;
  readonly roomType: string;
  readonly panelType: 'TWO_WAY' | 'ONE_WAY' | 'CANTILEVER';
  readonly lxMm: number;
  readonly lyMm: number;
  readonly aspectRatioLyLx: number;
  readonly areaM2: number;
  readonly thicknessMm: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  readonly discontinuousEdges: number;
  readonly supportingBeamElementIndices: readonly number[];
  readonly supportingPhysicalBeamIds?: readonly string[];
  readonly boundsMm: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
  };
  readonly exchangeBoundary?: readonly Point[];
  readonly sizingProvenance: 'PRELIMINARY_SPAN_DEPTH_RULE' | 'USER_OR_OPTIMIZER_ASSIGNED';
}

export interface SynthesizedStaircaseWaist {
  readonly hasExplicitStraightFlightGeometry?: boolean;
  readonly bearingReview?: import('../loads/reviewed-stair-bearings.js').StairBearingReview;
  readonly id: string;
  readonly floorId: string;
  readonly stairId: string;
  readonly horizontalSpanMm: number;
  readonly widthMm: number;
  readonly waistThicknessMm: number;
  readonly riserMm: number;
  readonly treadMm: number;
  readonly riserCount: number;
  readonly supportingBeamElementIndices: readonly number[];
  readonly boundsMm?: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
  };
  readonly flightDirection?: 'N' | 'S' | 'E' | 'W';
  readonly baseElevationMm?: number;
  readonly topElevationMm?: number;
  readonly ifcSolidGeometrySupported?: boolean;
}

export interface MemberDesignMetadata {
  /** Physical member ID (`PhysicalColumn.physicalMemberId` or `PhysicalBeam.physicalMemberId`). */
  readonly elementId: string;
  /** Primary analytical element index (first child segment). */
  readonly elementIndex: number;
  /** All child analytical element indices (`1..N`) belonging to this physical member! */
  readonly analyticalElementIndices: readonly number[];
  readonly analyticalElementIds: readonly string[];
  readonly category: StructuralMemberCategory;
  readonly floorId: string;
  readonly storeyLevel: number;
  readonly stackId?: string;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly clearSpanOrHeightMm: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  readonly supportedWallThicknessMm: number;
  readonly supportedWallHeightMm: number;
  readonly wallOpeningFraction: number;
  readonly sizingProvenance: 'PRELIMINARY_SPAN_AND_STACK_RULE' | 'CANONICAL_EXPLICIT' | 'OPTIMIZED';
}

export interface SynthesizedStructuralSystem {
  readonly systemId: string;
  readonly projectId: string;
  readonly buildingId: string;
  readonly sourceArchitecturalRevision: number;
  readonly sourceArchitecturalSha256: string;
  readonly structuralRevision: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  readonly ductileDetailing: boolean;
  readonly storeys: readonly {
    readonly id: string;
    readonly name: string;
    readonly elevationMm: number;
  }[];
  readonly nodes: readonly AnalyticalNode[];
  readonly elements: readonly AnalyticalFrameElement[];
  /** Physical frame member design metadata (one entry per PhysicalColumn / PhysicalBeam). */
  readonly memberMetadata: readonly MemberDesignMetadata[];
  readonly slabPanels: readonly SynthesizedSlabPanel[];
  readonly stairWaists: readonly SynthesizedStaircaseWaist[];
  readonly physicalModel: PhysicalStructuralModel;
  readonly baseColumnStackMap: Readonly<
    Record<
      string,
      {
        readonly stackId: string;
        readonly baseNodeIndex: number;
        readonly lowestColumnElementIndex: number;
        readonly xMm: number;
        readonly yMm: number;
        readonly columnWidthMm: number;
        readonly columnDepthMm: number;
      }
    >
  >;
  readonly clashes: readonly ArchitecturalStructuralClash[];
}

export interface RebarOverrideSpec {
  readonly barDiaMm?: number;
  readonly barCount?: number;
  readonly stirrupSpacingMm?: number;
  /** Actual uniform vertical link spacing for a provided-cage check (mm). */
  readonly providedLinkSpacingMm?:number;
}

export interface FrameSynthesisOptions {
  readonly concreteGrade?: ConcreteGrade;
  readonly steelGrade?: SteelGrade;
  readonly ductileDetailing?: boolean;
  readonly foundationDepthBelowPlinthMm?: number;
  readonly includePlinthTieBeams?: boolean;
  readonly maxColumnSpacingMm?: number;
  readonly minAutoColumnSpacingMm?: number;
  readonly snapToleranceMm?: number;
  /**
   * - `'PRACTICAL_ARCHITECTURAL_GRID'` (default): honors explicit structural columns & primary grid lines,
   *   avoiding interior partition room-corner duplication and short stub beams.
   * - `'LEGACY_DENSE_ROOM_CORNERS'`: reproduces the Milestone 5 dense room-corner mesh (e.g. 1,296 nodes / 2,877 elements)
   *   for large-model WASM stress-test verification.
   */
  readonly framingStrategy?: 'PRACTICAL_ARCHITECTURAL_GRID' | 'LEGACY_DENSE_ROOM_CORNERS';
  /** Number of finite-element subdivisions per physical beam (default 2 on primary girders >= 4.2m or explicit setting). */
  readonly analyticalSubdivisionsPerBeam?: number;
  readonly analyticalSubdivisionsPerColumn?: number;
  /** Optional per-physical-member section overrides (`physicalMemberId -> { widthMm, depthMm, concreteGrade? }`). */
  readonly sectionOverrides?: Readonly<
    Record<string, { readonly widthMm: number; readonly depthMm: number; readonly concreteGrade?: ConcreteGrade }>
  >;
  /** Optional per-physical-member reinforcement overrides (`physicalMemberId -> RebarOverrideSpec`). */
  readonly rebarOverrides?: Readonly<Record<string, RebarOverrideSpec>>;
  /** Optional slab thickness overrides (`slabPanelId -> thicknessMm`). */
  readonly slabThicknessOverridesMm?: Readonly<Record<string, number>>;
  /** Optional seismic zone & R factor for demand-based initial sizing (never hardcoded by storey count). */
  readonly seismicZone?: 'II' | 'III' | 'IV' | 'V';
  readonly responseReductionFactorR?: number;
  /**
   * - `'BEAM_BAY_GRID'` (default): synthesizes structural slab bays directly bounded by supporting frame beams on orthogonal floors.
   * - `'LEGACY_ROOM_POLYGONS'`: preserves per-room architectural bounding boxes.
   */
  readonly slabPanelizationMode?: 'BEAM_BAY_GRID' | 'LEGACY_ROOM_POLYGONS';
  readonly structuralRevision?: number;
}

const FIXED_BASE: SixDofRestraint = [true, true, true, true, true, true];

function roundUp25(mm: number): number {
  return Math.ceil(mm / 25) * 25;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function polygonBounds(pts: readonly Point[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 6000, minY: 0, maxY: 6000 };
  }
  return { minX, maxX, minY, maxY };
}

function rectRing(minX: number, maxX: number, minY: number, maxY: number): readonly Point[] {
  return [
    { x: Math.round(minX), y: Math.round(minY) },
    { x: Math.round(maxX), y: Math.round(minY) },
    { x: Math.round(maxX), y: Math.round(maxY) },
    { x: Math.round(minX), y: Math.round(maxY) },
  ];
}

function clusterAxisCoords(coords: readonly number[], tolMm: number): number[] {
  const sorted = [...coords].sort((a, b) => a - b);
  const clusters: { sum: number; count: number; rep: number }[] = [];
  for (const v of sorted) {
    const existing = clusters.find((c) => Math.abs(c.rep - v) <= tolMm);
    if (existing) {
      existing.sum += v;
      existing.count += 1;
      existing.rep = existing.sum / existing.count;
    } else {
      clusters.push({ sum: v, count: 1, rep: v });
    }
  }
  return clusters.map((c) => Math.round(c.rep));
}

export function synthesizeCanonicalStructuralSystem(
  building: Building,
  options: FrameSynthesisOptions = {},
): SynthesizedStructuralSystem {
  const concreteGrade = options.concreteGrade ?? 'M25';
  const steelGrade = options.steelGrade ?? 'Fe500';
  const ductileDetailing = options.ductileDetailing ?? true;
  const foundationDepthMm = options.foundationDepthBelowPlinthMm ?? 1500;
  const includePlinth = options.includePlinthTieBeams ?? true;
  const framingStrategy = options.framingStrategy ?? 'PRACTICAL_ARCHITECTURAL_GRID';
  const maxColSpacingMm =
    options.maxColumnSpacingMm ?? (framingStrategy === 'LEGACY_DENSE_ROOM_CORNERS' ? 5500 : 6400);
  const snapTolMm = options.snapToleranceMm ?? 320;
  const minAutoSpacingMm =
    options.minAutoColumnSpacingMm ?? (framingStrategy === 'LEGACY_DENSE_ROOM_CORNERS' ? snapTolMm : 1850);

  const archHash = canonicalBuildingHash(building);
  const sortedFloors: Floor[] = [...building.floors].sort((a, b) => a.level - b.level);
  if (sortedFloors.length === 0) {
    throw new Error('Cannot synthesize structural frame for a building with zero floors.');
  }

  interface ColumnStackPlan {
    id: string;
    xMm: number;
    yMm: number;
    explicitWidthMm?: number;
    explicitDepthMm?: number;
    fromExplicitColumn: boolean;
  }

  const stacks: ColumnStackPlan[] = [];

  const isObstructingCirculationOrOpening = (x: number, y: number): boolean => {
    for (const floor of sortedFloors) {
      for (const door of floor.doors ?? []) {
        const halfClear = (door.widthMm ?? door.width ?? 900) / 2 + 160;
        if (Math.hypot(x - door.position.x, y - door.position.y) < halfClear) return true;
      }
      for (const stair of floor.stairs ?? []) {
        const margin = 200;
        if (
          x > stair.x + margin &&
          x < stair.x + stair.width - margin &&
          y > stair.y + margin &&
          y < stair.y + stair.length - margin
        ) {
          return true;
        }
      }
      for (const room of floor.rooms ?? []) {
        const rName = `${room.type} ${room.name}`.toLowerCase();
        const isLiftOrDriveAisle =
          rName.includes('lift') ||
          rName.includes('elevator') ||
          (floor.floorUse === 'STILT_PARKING' && (rName.includes('drive') || rName.includes('aisle')));
        if (!isLiftOrDriveAisle) continue;
        const rb =
          room.boundary?.points && room.boundary.points.length >= 3
            ? polygonBounds(room.boundary.points)
            : { minX: room.x, maxX: room.x + room.width, minY: room.y, maxY: room.y + room.height };
        const margin = 220;
        if (x > rb.minX + margin && x < rb.maxX - margin && y > rb.minY + margin && y < rb.maxY - margin) {
          return true;
        }
      }
    }
    return false;
  };

  const addCandidatePoint = (
    x: number,
    y: number,
    explicit = false,
    wMm?: number,
    dMm?: number,
  ): ColumnStackPlan | null => {
    const minDist = explicit ? snapTolMm : minAutoSpacingMm;
    for (const s of stacks) {
      if (Math.hypot(s.xMm - x, s.yMm - y) <= minDist) {
        if (explicit && !s.fromExplicitColumn) {
          s.xMm = Math.round(x);
          s.yMm = Math.round(y);
          s.fromExplicitColumn = true;
          s.explicitWidthMm = wMm;
          s.explicitDepthMm = dMm;
        }
        return s;
      }
    }
    if (!explicit && framingStrategy === 'PRACTICAL_ARCHITECTURAL_GRID' && isObstructingCirculationOrOpening(x, y)) {
      return null;
    }
    const created: ColumnStackPlan = {
      id: `STK_${stacks.length + 1}`,
      xMm: Math.round(x),
      yMm: Math.round(y),
      explicitWidthMm: wMm,
      explicitDepthMm: dMm,
      fromExplicitColumn: explicit,
    };
    stacks.push(created);
    return created;
  };

  // 1. Honor explicit structural columns across floors FIRST (ΔX=0, ΔY=0)
  for (const floor of sortedFloors) {
    for (const col of floor.columns ?? []) {
      if (col.isStructural !== false) {
        addCandidatePoint(col.position.x, col.position.y, true, col.width, col.depth);
      }
    }
  }
  const hasExplicitColumnGrid = stacks.length >= 4;

  const subdivideSpanIfUnframed = (p0: Point, p1: Point) => {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    if (len <= maxColSpacingMm) return;
    const hasInteriorSupport = stacks.some((s) => {
      const t = ((s.xMm - p0.x) * dx + (s.yMm - p0.y) * dy) / (len * len);
      if (t <= 0.16 || t >= 0.84) return false;
      const perp = Math.abs((s.xMm - p0.x) * dy - (s.yMm - p0.y) * dx) / len;
      return perp <= 650;
    });
    if (hasInteriorSupport) return;
    const segs = Math.ceil(len / maxColSpacingMm);
    for (let k = 1; k < segs; k++) {
      addCandidatePoint(p0.x + (dx * k) / segs, p0.y + (dy * k) / segs);
    }
  };

  const refFloor = sortedFloors[0]!;
  const boundaryPts = refFloor.boundary?.points ?? [];

  if (framingStrategy === 'LEGACY_DENSE_ROOM_CORNERS' || !hasExplicitColumnGrid) {
    // Conceptual / surveyed plans without explicit columns (or legacy stress-test mode)
    for (const pt of boundaryPts) {
      addCandidatePoint(pt.x, pt.y);
    }
    for (const floor of sortedFloors) {
      for (const wall of floor.walls ?? []) {
        const isStructuralWall =
          wall.loadBearing ||
          wall.wallUse === 'EXTERNAL' ||
          wall.wallUse === 'CORE' ||
          wall.wallUse === 'UNIT_SEPARATION' ||
          wall.thickness >= 180;
        if (!isStructuralWall) continue;
        const len = Math.hypot(wall.endPoint.x - wall.startPoint.x, wall.endPoint.y - wall.startPoint.y);
        if (len < (framingStrategy === 'LEGACY_DENSE_ROOM_CORNERS' ? 600 : 1800)) continue;
        addCandidatePoint(wall.startPoint.x, wall.startPoint.y);
        addCandidatePoint(wall.endPoint.x, wall.endPoint.y);
      }

      if (framingStrategy === 'LEGACY_DENSE_ROOM_CORNERS') {
        for (const room of floor.rooms ?? []) {
          const isCantileverBalcony =
            String(room.type).toLowerCase() === 'balcony' ||
            room.spaceUse === 'OUTDOOR' ||
            room.name.toLowerCase().includes('balcony');
          if (isCantileverBalcony) continue;
          if (room.width >= 2200 && room.height >= 2200) {
            const b =
              room.boundary?.points && room.boundary.points.length >= 3
                ? polygonBounds(room.boundary.points)
                : { minX: room.x, maxX: room.x + room.width, minY: room.y, maxY: room.y + room.height };
            addCandidatePoint(b.minX, b.minY);
            addCandidatePoint(b.maxX, b.minY);
            addCandidatePoint(b.maxX, b.maxY);
            addCandidatePoint(b.minX, b.maxY);
          }
        }
      } else {
        // On unframed plans without explicit columns, frame stair/lift core corners cleanly
        for (const stair of floor.stairs ?? []) {
          addCandidatePoint(stair.x, stair.y);
          addCandidatePoint(stair.x + stair.width, stair.y);
          addCandidatePoint(stair.x + stair.width, stair.y + stair.length);
          addCandidatePoint(stair.x, stair.y + stair.length);
        }
      }
    }
  } else {
    // Building already has an architectural structural column grid (`floor.columns`):
    // Ensure outer building boundary corners & long perimeter edges > maxColSpacingMm are supported!
    for (const pt of boundaryPts) {
      addCandidatePoint(pt.x, pt.y);
    }
  }

  for (let i = 0; i < boundaryPts.length; i++) {
    subdivideSpanIfUnframed(boundaryPts[i]!, boundaryPts[(i + 1) % boundaryPts.length]!);
  }
  if (framingStrategy === 'LEGACY_DENSE_ROOM_CORNERS' || !hasExplicitColumnGrid) {
    for (const floor of sortedFloors) {
      for (const wall of floor.walls ?? []) {
        const isStructuralWall =
          wall.loadBearing ||
          wall.wallUse === 'EXTERNAL' ||
          wall.wallUse === 'CORE' ||
          wall.wallUse === 'UNIT_SEPARATION' ||
          wall.thickness >= 180;
        if (isStructuralWall) {
          subdivideSpanIfUnframed(wall.startPoint, wall.endPoint);
        }
      }
    }
  }

  if (stacks.length < 4) {
    const b = polygonBounds(refFloor.boundary?.points ?? []);
    const w = Math.max(4000, b.maxX - b.minX);
    const h = Math.max(4000, b.maxY - b.minY);
    const nx = Math.max(1, Math.ceil(w / maxColSpacingMm));
    const ny = Math.max(1, Math.ceil(h / maxColSpacingMm));
    for (let ix = 0; ix <= nx; ix++) {
      for (let iy = 0; iy <= ny; iy++) {
        addCandidatePoint(b.minX + (w * ix) / nx, b.minY + (h * iy) / ny);
      }
    }
  }

  stacks.sort((a, b) => (Math.abs(a.yMm - b.yMm) > 250 ? a.yMm - b.yMm : a.xMm - b.xMm));
  stacks.forEach((s, idx) => {
    s.id = `C${idx + 1}`;
  });

  // 2. Opening & Circulation Clash Audit + Auto-Nudge for Non-Explicit Columns
  const clashes: ArchitecturalStructuralClash[] = [];
  for (const stk of stacks) {
    for (const floor of sortedFloors) {
      for (const door of floor.doors ?? []) {
        const halfClear = (door.widthMm ?? door.width ?? 900) / 2 + 150;
        const dist = Math.hypot(stk.xMm - door.position.x, stk.yMm - door.position.y);
        if (dist < halfClear) {
          if (!stk.fromExplicitColumn) {
            const hostWall = floor.walls.find((w) => w.id === door.wallId);
            if (hostWall) {
              const wx = hostWall.endPoint.x - hostWall.startPoint.x;
              const wy = hostWall.endPoint.y - hostWall.startPoint.y;
              const wLen = Math.hypot(wx, wy) || 1;
              const sign =
                (stk.xMm - door.position.x) * wx + (stk.yMm - door.position.y) * wy >= 0 ? 1 : -1;
              stk.xMm = Math.round(door.position.x + sign * (wx / wLen) * (halfClear + 120));
              stk.yMm = Math.round(door.position.y + sign * (wy / wLen) * (halfClear + 120));
            }
          }
          if (Math.hypot(stk.xMm - door.position.x, stk.yMm - door.position.y) < halfClear) {
            clashes.push({
              id: `CLASH_${stk.id}_${door.id}`,
              kind: 'DOOR_OPENING_INTRUSION',
              severity: 'ERROR',
              floorId: floor.id,
              structuralMemberId: stk.id,
              architecturalEntityId: door.id,
              message: `Column stack ${stk.id} intrudes within door '${door.id}' clear opening width.`,
              positionMm: { x: stk.xMm, y: stk.yMm },
            });
          }
        }
      }

      for (const stair of floor.stairs ?? []) {
        const margin = 180;
        if (
          stk.xMm > stair.x + margin &&
          stk.xMm < stair.x + stair.width - margin &&
          stk.yMm > stair.y + margin &&
          stk.yMm < stair.y + stair.length - margin
        ) {
          clashes.push({
            id: `CLASH_${stk.id}_${stair.id}`,
            kind: 'STAIR_FLIGHT_INTRUSION',
            severity: 'ERROR',
            floorId: floor.id,
            structuralMemberId: stk.id,
            architecturalEntityId: stair.id,
            message: `Column stack ${stk.id} obstructs interior of staircase '${stair.id}'.`,
            positionMm: { x: stk.xMm, y: stk.yMm },
          });
        }
      }
    }
  }

  // 3. Build Elevation Levels: Foundation (-foundationDepthMm), Plinth (0 mm), and Top-of-Storey Slabs
  interface LevelSpec {
    readonly key: string;
    readonly elevationMm: number;
    readonly floor?: Floor;
    readonly isFoundation: boolean;
    readonly isPlinth: boolean;
  }

  const levels: LevelSpec[] = [
    { key: 'FOUNDATION', elevationMm: -foundationDepthMm, isFoundation: true, isPlinth: false },
  ];
  if (includePlinth) {
    levels.push({ key: 'PLINTH', elevationMm: 0, isFoundation: false, isPlinth: true });
  }

  const storeys: SynthesizedStructuralSystem['storeys'][number][] = [];
  let runningElevMm = 0;
  for (const floor of sortedFloors) {
    const elevationMm = floor.elevationMm ?? runningElevMm;
    storeys.push({ id: floor.id, name: floor.name, elevationMm });
    runningElevMm = elevationMm + floor.floorHeight;
    levels.push({
      key: floor.id,
      elevationMm: runningElevMm,
      floor,
      isFoundation: false,
      isPlinth: false,
    });
  }

  const allBounds = polygonBounds(stacks.map((s) => ({ x: s.xMm, y: s.yMm })));
  const planAreaM2 = Math.max(
    16,
    ((allBounds.maxX - allBounds.minX) * (allBounds.maxY - allBounds.minY)) / 1e6,
  );

  // Estimate actual tributary area per column stack from nearest neighbor distances in X & Y!
  const stackTribAreaM2 = stacks.map((stk, idx) => {
    let minEast = stk.xMm - allBounds.minX;
    let minWest = allBounds.maxX - stk.xMm;
    let minNorth = stk.yMm - allBounds.minY;
    let minSouth = allBounds.maxY - stk.yMm;
    {
      let best = Infinity;
      for (let j = 0; j < stacks.length; j++) {
        if (j === idx) continue;
        if (Math.abs(stacks[j]!.yMm - stk.yMm) <= 900 && stacks[j]!.xMm > stk.xMm + 400) {
          best = Math.min(best, stacks[j]!.xMm - stk.xMm);
        }
      }
      minWest = Number.isFinite(best) ? best / 2 : Math.min(2500, Math.max(600, allBounds.maxX - stk.xMm));
    }
    let bestW = Infinity;
    for (let j = 0; j < stacks.length; j++) {
      if (j === idx) continue;
      if (Math.abs(stacks[j]!.yMm - stk.yMm) <= 900 && stacks[j]!.xMm < stk.xMm - 400) {
        bestW = Math.min(bestW, stk.xMm - stacks[j]!.xMm);
      }
    }
    minEast = Number.isFinite(bestW) ? bestW / 2 : Math.min(2500, Math.max(600, stk.xMm - allBounds.minX));

    let bestS = Infinity;
    let bestN = Infinity;
    for (let j = 0; j < stacks.length; j++) {
      if (j === idx) continue;
      if (Math.abs(stacks[j]!.xMm - stk.xMm) <= 900 && stacks[j]!.yMm > stk.yMm + 400) {
        bestS = Math.min(bestS, stacks[j]!.yMm - stk.yMm);
      }
      if (Math.abs(stacks[j]!.xMm - stk.xMm) <= 900 && stacks[j]!.yMm < stk.yMm - 400) {
        bestN = Math.min(bestN, stk.yMm - stacks[j]!.yMm);
      }
    }
    minSouth = Number.isFinite(bestS) ? bestS / 2 : Math.min(2500, Math.max(600, allBounds.maxY - stk.yMm));
    minNorth = Number.isFinite(bestN) ? bestN / 2 : Math.min(2500, Math.max(600, stk.yMm - allBounds.minY));

    const trib = ((minEast + minWest) * (minNorth + minSouth)) / 1e6;
    return clamp(trib, 5.0, Math.max(12.0, (planAreaM2 / stacks.length) * 2.1));
  });

  const nodes: AnalyticalNode[] = [];
  const nodeGrid: number[][] = Array.from({ length: stacks.length }, () => []);

  for (let lIdx = 0; lIdx < levels.length; lIdx++) {
    const lvl = levels[lIdx]!;
    for (let sIdx = 0; sIdx < stacks.length; sIdx++) {
      const stk = stacks[sIdx]!;
      const nodeIndex = nodes.length;
      nodes.push({
        id: `N_${stk.id}_${lvl.key}`,
        index: nodeIndex,
        positionM: canonicalMmToStructuralMeters({ x: stk.xMm, y: stk.yMm }, lvl.elevationMm),
        floorId: lvl.floor?.id ?? lvl.key,
        restraint: lvl.isFoundation ? FIXED_BASE : undefined,
      });
      nodeGrid[sIdx]![lIdx] = nodeIndex;
    }
  }

  const elements: AnalyticalFrameElement[] = [];
  const memberMetadata: MemberDesignMetadata[] = [];
  const physicalColumns: PhysicalColumn[] = [];
  const physicalBeams: PhysicalBeam[] = [];
  const physicalToAnalyticalElementIds: Record<string, string[]> = {};
  const analyticalToPhysicalMemberId: Record<string, string> = {};
  const analyticalIndexToPhysicalMemberId: string[] = [];
  const stationsByPhysicalMemberId: Record<string, AnalysisStation[]> = {};

  const registerPhysicalStations = (
    physicalMemberId: string,
    childElementIds: readonly string[],
    childElementIndices: readonly number[],
    totalPhysicalLengthMm: number,
  ) => {
    physicalToAnalyticalElementIds[physicalMemberId] = [...childElementIds];
    const stations: AnalysisStation[] = [];
    const nSeg = childElementIds.length;
    for (let seg = 0; seg < nSeg; seg++) {
      const aId = childElementIds[seg]!;
      const aIdx = childElementIndices[seg]!;
      analyticalToPhysicalMemberId[aId] = physicalMemberId;
      analyticalIndexToPhysicalMemberId[aIdx] = physicalMemberId;
      for (let k = 0; k <= 10; k++) {
        if (seg > 0 && k === 0) continue; // shared interior node station
        const sElem = k / 10;
        const sPhys = (seg + sElem) / nSeg;
        stations.push({
          stationId: `${physicalMemberId}_ST_${stations.length}`,
          physicalMemberId,
          analyticalElementId: aId,
          analyticalElementIndex: aIdx,
          physicalDistanceMm: Number((sPhys * totalPhysicalLengthMm).toFixed(1)),
          normalizedPhysicalPosition: Number(sPhys.toFixed(4)),
          normalizedElementPosition: Number(sElem.toFixed(4)),
        });
      }
    }
    stationsByPhysicalMemberId[physicalMemberId] = stations;
  };

  const baseColumnStackMap: Record<
    string,
    {
      stackId: string;
      baseNodeIndex: number;
      lowestColumnElementIndex: number;
      xMm: number;
      yMm: number;
      columnWidthMm: number;
      columnDepthMm: number;
    }
  > = {};

  const colSub = Math.max(1, Math.floor(options.analyticalSubdivisionsPerColumn ?? 1));

  // 4. Create Physical Columns & Child Analytical Column Elements
  for (let sIdx = 0; sIdx < stacks.length; sIdx++) {
    const stk = stacks[sIdx]!;
    const isEdgeX =
      Math.abs(stk.xMm - allBounds.minX) < 600 || Math.abs(stk.xMm - allBounds.maxX) < 600;
    const isEdgeY =
      Math.abs(stk.yMm - allBounds.minY) < 600 || Math.abs(stk.yMm - allBounds.maxY) < 600;
    const isCorner = isEdgeX && isEdgeY;
    const isEdge = !isCorner && (isEdgeX || isEdgeY);
    const tribM2 = stackTribAreaM2[sIdx]!;

    for (let lIdx = 0; lIdx < levels.length - 1; lIdx++) {
      const botLvl = levels[lIdx]!;
      const topLvl = levels[lIdx + 1]!;
      const storeysAbove = Math.max(
        1,
        levels.slice(lIdx + 1).filter((l) => !l.isFoundation && !l.isPlinth).length,
      );
      const physicalId = `COL_${stk.id}_L${lIdx}`;
      const override = options.sectionOverrides?.[physicalId];
      const elGrade = override?.concreteGrade ?? concreteGrade;

      // Demand-differentiated sizing using actual tributary area, storey stack depth, and MRF sway demand!
      // Demand-differentiated sizing using actual tributary area, cumulative gravity, storey height, and seismic overturning/drift!
      const zoneZ = { II: 0.1, III: 0.16, IV: 0.24, V: 0.36 }[options.seismicZone ?? 'III'];
      const rFactor = Math.max(1.5, options.responseReductionFactorR ?? (ductileDetailing ? 5.0 : 3.0));
      const ahEst = (zoneZ / 2) * (1.0 / rFactor) * 2.5;
      const estGravityPuKn = 22.0 * tribM2 * storeysAbove;
      const segHeightM = (topLvl.elevationMm - botLvl.elevationMm) / 1000;
      const totalStoreyWeightAboveKn = 14.5 * planAreaM2 * storeysAbove;
      const colLateralShearKn = (1.5 * ahEst * totalStoreyWeightAboveKn) / Math.max(4, stacks.length);
      const colSeismicMomentKnM = colLateralShearKn * (segHeightM * 0.58);
      const overturningMultiplier = isCorner ? 1.28 + 1.4 * ahEst : isEdge ? 1.22 + 1.1 * ahEst : 1.15 + 0.6 * ahEst;
      const estPuKn = estGravityPuKn * overturningMultiplier;
      const mrfAmplifier = (isCorner ? 1.45 : isEdge ? 1.55 : 1.65) + (colSeismicMomentKnM * 3.8) / Math.max(120, estPuKn);

      // Upgrade concrete grade automatically on heavily loaded lower lifts if not overridden
      const autoGrade: ConcreteGrade =
        override?.concreteGrade ??
        (estPuKn > 3400 ? 'M35' : estPuKn > 2200 ? 'M30' : concreteGrade);
      const effectiveColGrade: ConcreteGrade =
        CONCRETE_FCK_MPA[autoGrade] > CONCRETE_FCK_MPA[elGrade] && !override?.concreteGrade ? autoGrade : elGrade;

      const reqAgMm2 =
        (estPuKn * mrfAmplifier * 1000) /
        (0.28 * CONCRETE_FCK_MPA[effectiveColGrade] + 0.011 * STEEL_FY_MPA[steelGrade]);
      // Drift stiffness floor: ensure column moment of inertia limits unfactored inter-storey drift <= 0.0036 * h_s
      const unfactoredColShearKn = colLateralShearKn / 1.5;
      const ecKPa = concreteElasticModulusMPa(effectiveColGrade) * 1000;
      const reqInertiaM4 =
        (unfactoredColShearKn * Math.pow(segHeightM, 2)) / Math.max(1, 12 * ecKPa * 0.0034);
      const minDimMm = ductileDetailing ? 300 : 230;

      let widthMm: number;
      let depthMm: number;
      let provenance: MemberDesignMetadata['sizingProvenance'] = 'PRELIMINARY_SPAN_AND_STACK_RULE';

      if (override) {
        widthMm = override.widthMm;
        depthMm = override.depthMm;
        provenance = 'OPTIMIZED';
      } else {
        const expW = stk.fromExplicitColumn && stk.explicitWidthMm ? stk.explicitWidthMm : minDimMm;
        const expD = stk.fromExplicitColumn && stk.explicitDepthMm ? stk.explicitDepthMm : minDimMm;
        const demandW =
          reqAgMm2 > 340_000 ? 500 : reqAgMm2 > 250_000 ? 450 : reqAgMm2 > 180_000 ? 400 : reqAgMm2 > 125_000 ? 350 : minDimMm;
        widthMm = Math.max(minDimMm, expW, demandW);
        const depthFromInertiaMm = Math.cbrt((12 * reqInertiaM4) / (widthMm / 1000)) * 1000;
        depthMm = clamp(
          roundUp25(Math.max(minDimMm, expD, reqAgMm2 / widthMm, depthFromInertiaMm)),
          minDimMm,
          900,
        );
        if (stk.fromExplicitColumn && widthMm === expW && depthMm === expD) {
          provenance = 'CANONICAL_EXPLICIT';
        }
      }

      const sec = computeRectangularSectionProps({
        widthMm,
        depthMm,
        elasticityMPa: concreteElasticModulusMPa(effectiveColGrade),
        unitWeightKnM3: IS875_RCC_UNIT_WEIGHT_KN_M3,
      });

      const nStart = nodeGrid[sIdx]![lIdx]!;
      const nEnd = nodeGrid[sIdx]![lIdx + 1]!;
      const segHeightMm = topLvl.elevationMm - botLvl.elevationMm;

      const chainNodes: number[] = [nStart];
      for (let k = 1; k < colSub; k++) {
        const zSubMm = botLvl.elevationMm + (segHeightMm * k) / colSub;
        const subNodeIdx = nodes.length;
        nodes.push({
          id: `N_${physicalId}_SUB${k}`,
          index: subNodeIdx,
          positionM: canonicalMmToStructuralMeters({ x: stk.xMm, y: stk.yMm }, zSubMm),
          floorId: topLvl.floor?.id ?? topLvl.key,
        });
        chainNodes.push(subNodeIdx);
      }
      chainNodes.push(nEnd);

      const childIds: string[] = [];
      const childIndices: number[] = [];
      for (let k = 0; k < colSub; k++) {
        const elIdx = elements.length;
        const aId = colSub === 1 ? physicalId : `${physicalId}__fe_${k + 1}`;
        elements.push({
          id: aId,
          index: elIdx,
          category: 'COLUMN',
          startNodeIndex: chainNodes[k]!,
          endNodeIndex: chainNodes[k + 1]!,
          section: sec,
          floorId: topLvl.floor?.id ?? topLvl.key,
          parentMemberId: physicalId,
        });
        childIds.push(aId);
        childIndices.push(elIdx);
      }

      registerPhysicalStations(physicalId, childIds, childIndices, segHeightMm);

      physicalColumns.push({
        kind: 'PHYSICAL_COLUMN',
        physicalMemberId: physicalId,
        stackId: stk.id,
        floorId: topLvl.floor?.id ?? topLvl.key,
        storeyLevel: topLvl.floor?.level ?? 0,
        centerXMm: stk.xMm,
        centerYMm: stk.yMm,
        baseElevationMm: botLvl.elevationMm,
        topElevationMm: topLvl.elevationMm,
        clearHeightMm: segHeightMm,
        widthMm,
        depthMm,
        rotationDeg: 0,
        concreteGrade: effectiveColGrade,
        steelGrade,
        sizingProvenance: provenance,
        analyticalElementIds: childIds,
        analyticalElementIndices: childIndices,
        startAnalyticalNodeIndex: nStart,
        endAnalyticalNodeIndex: nEnd,
      });

      memberMetadata.push({
        elementId: physicalId,
        elementIndex: childIndices[0]!,
        analyticalElementIndices: childIndices,
        analyticalElementIds: childIds,
        category: 'COLUMN',
        floorId: topLvl.floor?.id ?? topLvl.key,
        storeyLevel: topLvl.floor?.level ?? 0,
        stackId: stk.id,
        widthMm,
        depthMm,
        clearSpanOrHeightMm: segHeightMm,
        concreteGrade: effectiveColGrade,
        steelGrade,
        supportedWallThicknessMm: 0,
        supportedWallHeightMm: 0,
        wallOpeningFraction: 0,
        sizingProvenance: provenance,
      });

      if (lIdx === 0) {
        baseColumnStackMap[stk.id] = {
          stackId: stk.id,
          baseNodeIndex: nStart,
          lowestColumnElementIndex: childIndices[0]!,
          xMm: stk.xMm,
          yMm: stk.yMm,
          columnWidthMm: widthMm,
          columnDepthMm: depthMm,
        };
      }
    }
  }

  // 5. Connect Practical Horizontal Physical Beams + Analytical Mesh Subdivisions
  interface PlanEdge {
    readonly sA: number;
    readonly sB: number;
    readonly lengthMm: number;
  }
  const planEdges: PlanEdge[] = [];
  const edgeKeySet = new Set<string>();
  const minEdgeSpanMm = framingStrategy === 'LEGACY_DENSE_ROOM_CORNERS' ? 650 : 1200;

  const tryAddEdge = (i: number, j: number) => {
    if (i === j) return;
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    const key = `${a}_${b}`;
    if (edgeKeySet.has(key)) return;
    const pA = stacks[a]!;
    const pB = stacks[b]!;
    const dx = pB.xMm - pA.xMm;
    const dy = pB.yMm - pA.yMm;
    const len = Math.hypot(dx, dy);
    if (len < minEdgeSpanMm || len > maxColSpacingMm * 1.65) return;

    // Reject if another column stack lies collinearly strictly between pA and pB
    for (let k = 0; k < stacks.length; k++) {
      if (k === a || k === b) continue;
      const pK = stacks[k]!;
      const t = ((pK.xMm - pA.xMm) * dx + (pK.yMm - pA.yMm) * dy) / (len * len);
      if (t > 0.08 && t < 0.92) {
        const perp = Math.abs((pK.xMm - pA.xMm) * dy - (pK.yMm - pA.yMm) * dx) / len;
        if (perp < 340) return;
      }
    }

    // Reject diagonal interior shortcuts when framingStrategy is PRACTICAL_ARCHITECTURAL_GRID
    // unless aligned with an actual structural/perimeter wall!
    if (framingStrategy === 'PRACTICAL_ARCHITECTURAL_GRID') {
      const isOrthogonal = Math.abs(dx) <= 450 || Math.abs(dy) <= 450;
      if (!isOrthogonal) {
        const matchesWall = sortedFloors.some((fl) =>
          (fl.walls ?? []).some((w) => {
            const ds = Math.hypot(pA.xMm - w.startPoint.x, pA.yMm - w.startPoint.y);
            const de = Math.hypot(pB.xMm - w.endPoint.x, pB.yMm - w.endPoint.y);
            const dsRev = Math.hypot(pA.xMm - w.endPoint.x, pA.yMm - w.endPoint.y);
            const deRev = Math.hypot(pB.xMm - w.startPoint.x, pB.yMm - w.startPoint.y);
            return (ds < 500 && de < 500) || (dsRev < 500 && deRev < 500);
          }),
        );
        if (!matchesWall) return;
      }
    }

    edgeKeySet.add(key);
    planEdges.push({ sA: a, sB: b, lengthMm: len });
  };

  const alignTol = framingStrategy === 'LEGACY_DENSE_ROOM_CORNERS' ? 380 : 520;
  for (let i = 0; i < stacks.length; i++) {
    const pI = stacks[i]!;
    let bestEast = -1, distEast = Infinity;
    let bestNorth = -1, distNorth = Infinity;
    for (let j = 0; j < stacks.length; j++) {
      if (i === j) continue;
      const pJ = stacks[j]!;
      if (Math.abs(pJ.yMm - pI.yMm) <= alignTol && pJ.xMm > pI.xMm + minEdgeSpanMm) {
        const d = pJ.xMm - pI.xMm;
        if (d < distEast) {
          distEast = d;
          bestEast = j;
        }
      }
      if (Math.abs(pJ.xMm - pI.xMm) <= alignTol && pJ.yMm > pI.yMm + minEdgeSpanMm) {
        const d = pJ.yMm - pI.yMm;
        if (d < distNorth) {
          distNorth = d;
          bestNorth = j;
        }
      }
    }
    if (bestEast >= 0) tryAddEdge(i, bestEast);
    if (bestNorth >= 0) tryAddEdge(i, bestNorth);
  }

  for (const wall of refFloor.walls ?? []) {
    let iStart = -1, dStart = 500;
    let iEnd = -1, dEnd = 500;
    for (let k = 0; k < stacks.length; k++) {
      const ds = Math.hypot(stacks[k]!.xMm - wall.startPoint.x, stacks[k]!.yMm - wall.startPoint.y);
      const de = Math.hypot(stacks[k]!.xMm - wall.endPoint.x, stacks[k]!.yMm - wall.endPoint.y);
      if (ds < dStart) {
        dStart = ds;
        iStart = k;
      }
      if (de < dEnd) {
        dEnd = de;
        iEnd = k;
      }
    }
    if (iStart >= 0 && iEnd >= 0 && iStart !== iEnd) {
      tryAddEdge(iStart, iEnd);
    }
  }

  // Ensure full lateral graph connectivity across all column stacks
  const adj = new Map<number, number[]>();
  for (let i = 0; i < stacks.length; i++) adj.set(i, []);
  for (const e of planEdges) {
    adj.get(e.sA)!.push(e.sB);
    adj.get(e.sB)!.push(e.sA);
  }
  const visited = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nxt of adj.get(cur) ?? []) {
      if (!visited.has(nxt)) {
        visited.add(nxt);
        queue.push(nxt);
      }
    }
  }
  for (let idx = 0; idx < stacks.length; idx++) {
    if (visited.has(idx)) continue;
    let nearest = 0;
    let bestD = Infinity;
    for (const v of visited) {
      const d = Math.hypot(stacks[idx]!.xMm - stacks[v]!.xMm, stacks[idx]!.yMm - stacks[v]!.yMm);
      if (d < bestD) {
        bestD = d;
        nearest = v;
      }
    }
    const a = Math.min(idx, nearest);
    const b = Math.max(idx, nearest);
    edgeKeySet.add(`${a}_${b}`);
    planEdges.push({ sA: a, sB: b, lengthMm: bestD });
    visited.add(idx);
  }

  // Clustered structural grid lines in X and Y for slab bay subdivision!
  const gridLinesX = clusterAxisCoords(stacks.map((s) => s.xMm), 550);
  const gridLinesY = clusterAxisCoords(stacks.map((s) => s.yMm), 550);

  const beamElementsByLevel = new Map<number, number[]>();
  const physicalBeamsByLevel = new Map<number, PhysicalBeam[]>();

  for (let lIdx = 1; lIdx < levels.length; lIdx++) {
    const lvl = levels[lIdx]!;
    const levelBeamIndices: number[] = [];
    const levelPhysicalBeams: PhysicalBeam[] = [];
    const wallSourceFloor = lvl.isPlinth
      ? sortedFloors[0]!
      : sortedFloors.find((f) => f.level === (lvl.floor?.level ?? 0) + 1) ?? lvl.floor;

    for (let eIdx = 0; eIdx < planEdges.length; eIdx++) {
      const edge = planEdges[eIdx]!;
      const pA = stacks[edge.sA]!;
      const pB = stacks[edge.sB]!;
      const category: PhysicalBeam['category'] = lvl.isPlinth ? 'PLINTH_BEAM' : 'BEAM';
      const physicalId = `${lvl.isPlinth ? 'PB' : 'BM'}_${lvl.key}_${eIdx + 1}`;
      const override = options.sectionOverrides?.[physicalId];
      const elGrade = override?.concreteGrade ?? concreteGrade;

      // Demand-varied beam sizing based on clear span L, storey seismic shear role, and supported wall!
      let widthMm: number;
      let depthMm: number;
      let provenance: MemberDesignMetadata['sizingProvenance'] = 'PRELIMINARY_SPAN_AND_STACK_RULE';
      if (override) {
        widthMm = override.widthMm;
        depthMm = override.depthMm;
        provenance = 'OPTIMIZED';
      } else if (lvl.isPlinth) {
        widthMm = 230;
        depthMm = clamp(roundUp25(edge.lengthMm / 13), 300, 475);
      } else if (edge.lengthMm < 2450) {
        // Short coupling spans between closely-spaced columns: tau_v = E * theta * (D / L)^2!
        // Keep D proportional to short L (L/D >= 4.2, well above Cl. 29 deep-beam limit 2.0) with generous web width!
        depthMm = clamp(roundUp25(edge.lengthMm / 4.8), 250, 350);
        widthMm = Math.max(250, ductileDetailing ? 300 : 230);
      } else {
        // Primary frame girders sized from span L and lateral frame demand
        const spanRatio = sortedFloors.length >= 4 ? 10.5 : 11.5;
        depthMm = clamp(roundUp25(edge.lengthMm / spanRatio), 325, 750);
        widthMm = depthMm >= 525 ? 300 : depthMm >= 425 ? 250 : 230;
        if (ductileDetailing) {
          widthMm = Math.max(200, widthMm, roundUp25(depthMm * 0.35));
        }
      }

      const hostFloorHeightMm = lvl.floor?.floorHeight ?? 3000;
      const clearUnderBeamMm = hostFloorHeightMm - depthMm;
      if (!lvl.isPlinth && clearUnderBeamMm < 2100) {
        clashes.push({
          id: `HEADROOM_${physicalId}`,
          kind: 'HEADROOM_CLEARANCE_WARNING',
          severity: 'WARNING',
          floorId: lvl.floor?.id ?? lvl.key,
          structuralMemberId: physicalId,
          architecturalEntityId: lvl.floor?.id ?? lvl.key,
          message: `Beam ${physicalId} (${widthMm}x${depthMm} mm) leaves ${clearUnderBeamMm} mm clear headroom (< 2100 mm).`,
          positionMm: { x: Math.round((pA.xMm + pB.xMm) / 2), y: Math.round((pA.yMm + pB.yMm) / 2) },
        });
      }

      let wallThickMm = 0;
      let wallHeightMm = 0;
      let openingFrac = 0;
      if (wallSourceFloor && !(wallSourceFloor.floorUse === 'STILT_PARKING' && !lvl.isPlinth)) {
        const midX = (pA.xMm + pB.xMm) / 2;
        const midY = (pA.yMm + pB.yMm) / 2;
        const matchedWall = (wallSourceFloor.walls ?? []).find((w) => {
          const wmx = (w.startPoint.x + w.endPoint.x) / 2;
          const wmy = (w.startPoint.y + w.endPoint.y) / 2;
          return Math.hypot(wmx - midX, wmy - midY) < edge.lengthMm * 0.55;
        });
        if (matchedWall) {
          wallThickMm = matchedWall.thickness || 230;
          wallHeightMm = Math.max(0, (wallSourceFloor.floorHeight || 3000) - depthMm);
          let openArea = 0;
          for (const d of wallSourceFloor.doors ?? []) {
            if (d.wallId === matchedWall.id) {
              openArea += (d.widthMm ?? d.width ?? 900) * (d.heightMm ?? d.height ?? 2100);
            }
          }
          for (const win of wallSourceFloor.windows ?? []) {
            if (win.wallId === matchedWall.id) {
              openArea += (win.widthMm ?? win.width ?? 1200) * (win.heightMm ?? win.height ?? 1200);
            }
          }
          const grossWallArea = Math.max(1, edge.lengthMm * wallHeightMm);
          openingFrac = clamp(openArea / grossWallArea, 0, 0.75);
        } else if (
          lIdx === levels.length - 1 &&
          ((Math.abs(pA.xMm - allBounds.minX) < 500 && Math.abs(pB.xMm - allBounds.minX) < 500) ||
            (Math.abs(pA.xMm - allBounds.maxX) < 500 && Math.abs(pB.xMm - allBounds.maxX) < 500) ||
            (Math.abs(pA.yMm - allBounds.minY) < 500 && Math.abs(pB.yMm - allBounds.minY) < 500) ||
            (Math.abs(pA.yMm - allBounds.maxY) < 500 && Math.abs(pB.yMm - allBounds.maxY) < 500))
        ) {
          wallThickMm = 150;
          wallHeightMm = 1050;
        }
      }

      const sec = computeRectangularSectionProps({
        widthMm,
        depthMm,
        elasticityMPa: concreteElasticModulusMPa(elGrade),
        unitWeightKnM3: IS875_RCC_UNIT_WEIGHT_KN_M3,
      });

      // Gate 2: Subdivide long primary floor girders (>= 4,800 mm under PRACTICAL_ARCHITECTURAL_GRID, or explicit option)
      // into 2+ analytical finite elements while preserving ONE PhysicalBeam identity!
      const beamSub =
        options.analyticalSubdivisionsPerBeam !== undefined
          ? Math.max(1, Math.floor(options.analyticalSubdivisionsPerBeam))
          : framingStrategy === 'PRACTICAL_ARCHITECTURAL_GRID' && !lvl.isPlinth && edge.lengthMm >= 4800
            ? 2
            : 1;

      const nStart = nodeGrid[edge.sA]![lIdx]!;
      const nEnd = nodeGrid[edge.sB]![lIdx]!;
      const chainNodes: number[] = [nStart];
      const interNodes: number[] = [];

      for (let k = 1; k < beamSub; k++) {
        const t = k / beamSub;
        const subX = pA.xMm + (pB.xMm - pA.xMm) * t;
        const subY = pA.yMm + (pB.yMm - pA.yMm) * t;
        const subNodeIdx = nodes.length;
        nodes.push({
          id: `N_${physicalId}_M${k}`,
          index: subNodeIdx,
          positionM: canonicalMmToStructuralMeters({ x: subX, y: subY }, lvl.elevationMm),
          floorId: lvl.floor?.id ?? lvl.key,
        });
        chainNodes.push(subNodeIdx);
        interNodes.push(subNodeIdx);
      }
      chainNodes.push(nEnd);

      const childIds: string[] = [];
      const childIndices: number[] = [];
      for (let k = 0; k < beamSub; k++) {
        const elIdx = elements.length;
        const aId = beamSub === 1 ? physicalId : `${physicalId}__fe_${k + 1}`;
        elements.push({
          id: aId,
          index: elIdx,
          category,
          startNodeIndex: chainNodes[k]!,
          endNodeIndex: chainNodes[k + 1]!,
          section: sec,
          floorId: lvl.floor?.id ?? lvl.key,
          parentMemberId: physicalId,
        });
        childIds.push(aId);
        childIndices.push(elIdx);
        levelBeamIndices.push(elIdx);
      }

      registerPhysicalStations(physicalId, childIds, childIndices, edge.lengthMm);

      const physBeam: PhysicalBeam = {
        kind: 'PHYSICAL_BEAM',
        physicalMemberId: physicalId,
        beamMark: `B${eIdx + 1}`,
        category,
        floorId: lvl.floor?.id ?? lvl.key,
        storeyLevel: lvl.floor?.level ?? -1,
        startPointMm: { x: pA.xMm, y: pA.yMm },
        endPointMm: { x: pB.xMm, y: pB.yMm },
        topElevationMm: lvl.elevationMm,
        clearSpanMm: Math.round(edge.lengthMm),
        widthMm,
        depthMm,
        concreteGrade: elGrade,
        steelGrade,
        supportedWallThicknessMm: wallThickMm,
        supportedWallHeightMm: wallHeightMm,
        wallOpeningFraction: openingFrac,
        sizingProvenance: provenance,
        analyticalElementIds: childIds,
        analyticalElementIndices: childIndices,
        startAnalyticalNodeIndex: nStart,
        endAnalyticalNodeIndex: nEnd,
        intermediateAnalyticalNodeIndices: interNodes,
      };
      physicalBeams.push(physBeam);
      levelPhysicalBeams.push(physBeam);

      memberMetadata.push({
        elementId: physicalId,
        elementIndex: childIndices[0]!,
        analyticalElementIndices: childIndices,
        analyticalElementIds: childIds,
        category,
        floorId: lvl.floor?.id ?? lvl.key,
        storeyLevel: lvl.floor?.level ?? -1,
        widthMm,
        depthMm,
        clearSpanOrHeightMm: Math.round(edge.lengthMm),
        concreteGrade: elGrade,
        steelGrade,
        supportedWallThicknessMm: wallThickMm,
        supportedWallHeightMm: wallHeightMm,
        wallOpeningFraction: openingFrac,
        sizingProvenance: provenance,
      });
    }

    // Cantilever balcony beams projecting outside the column grid
    if (lvl.floor) {
      let cantIdx = 0;
      for (const room of lvl.floor.rooms ?? []) {
        const isBalcony =
          String(room.type).toLowerCase() === 'balcony' ||
          room.spaceUse === 'OUTDOOR' ||
          room.name.toLowerCase().includes('balcony');
        if (!isBalcony) continue;
        const rb =
          room.boundary?.points && room.boundary.points.length >= 3
            ? polygonBounds(room.boundary.points)
            : { minX: room.x, maxX: room.x + room.width, minY: room.y, maxY: room.y + room.height };

        let projDir: [number, number] | null = null;
        let projMm = 0;
        if (rb.maxX > allBounds.maxX + 400) {
          projDir = [1, 0];
          projMm = rb.maxX - allBounds.maxX;
        } else if (rb.minX < allBounds.minX - 400) {
          projDir = [-1, 0];
          projMm = allBounds.minX - rb.minX;
        } else if (rb.maxY > allBounds.maxY + 400) {
          projDir = [0, 1];
          projMm = rb.maxY - allBounds.maxY;
        } else if (rb.minY < allBounds.minY - 400) {
          projDir = [0, -1];
          projMm = allBounds.minY - rb.minY;
        }

        if (projDir && projMm >= 600) {
          const cx = (rb.minX + rb.maxX) / 2;
          const cy = (rb.minY + rb.maxY) / 2;
          let bestS = 0;
          let bestDist = Infinity;
          for (let s = 0; s < stacks.length; s++) {
            const d = Math.hypot(stacks[s]!.xMm - cx, stacks[s]!.yMm - cy);
            if (d < bestDist) {
              bestDist = d;
              bestS = s;
            }
          }
          const rootStk = stacks[bestS]!;
          const tipX = rootStk.xMm + projDir[0] * projMm;
          const tipY = rootStk.yMm + projDir[1] * projMm;
          const tipNodeIdx = nodes.length;
          nodes.push({
            id: `N_CANT_${lvl.key}_${++cantIdx}`,
            index: tipNodeIdx,
            positionM: canonicalMmToStructuralMeters({ x: tipX, y: tipY }, lvl.elevationMm),
            floorId: lvl.floor.id,
          });

          const physicalId = `CANT_${lvl.key}_${cantIdx}`;
          const override = options.sectionOverrides?.[physicalId];
          const elGrade = override?.concreteGrade ?? concreteGrade;
          const depthMm = override ? override.depthMm : clamp(roundUp25(projMm / 6.0 + 75), 325, 650);
          const widthMm = override ? override.widthMm : Math.max(230, ductileDetailing ? roundUp25(depthMm * 0.35) : 230);
          const sec = computeRectangularSectionProps({
            widthMm,
            depthMm,
            elasticityMPa: concreteElasticModulusMPa(elGrade),
            unitWeightKnM3: IS875_RCC_UNIT_WEIGHT_KN_M3,
          });

          const nStart = nodeGrid[bestS]![lIdx]!;
          const elIdx = elements.length;
          elements.push({
            id: physicalId,
            index: elIdx,
            category: 'CANTILEVER_BEAM',
            startNodeIndex: nStart,
            endNodeIndex: tipNodeIdx,
            section: sec,
            floorId: lvl.floor.id,
            parentMemberId: physicalId,
          });
          levelBeamIndices.push(elIdx);
          registerPhysicalStations(physicalId, [physicalId], [elIdx], projMm);

          const cantBeam: PhysicalBeam = {
            kind: 'PHYSICAL_BEAM',
            physicalMemberId: physicalId,
            beamMark: `CB${cantIdx}`,
            category: 'CANTILEVER_BEAM',
            floorId: lvl.floor.id,
            storeyLevel: lvl.floor.level,
            startPointMm: { x: rootStk.xMm, y: rootStk.yMm },
            endPointMm: { x: tipX, y: tipY },
            topElevationMm: lvl.elevationMm,
            clearSpanMm: Math.round(projMm),
            widthMm,
            depthMm,
            concreteGrade: elGrade,
            steelGrade,
            supportedWallThicknessMm: 115,
            supportedWallHeightMm: 1050,
            wallOpeningFraction: 0,
            sizingProvenance: override ? 'OPTIMIZED' : 'PRELIMINARY_SPAN_AND_STACK_RULE',
            analyticalElementIds: [physicalId],
            analyticalElementIndices: [elIdx],
            startAnalyticalNodeIndex: nStart,
            endAnalyticalNodeIndex: tipNodeIdx,
            intermediateAnalyticalNodeIndices: [],
          };
          physicalBeams.push(cantBeam);
          levelPhysicalBeams.push(cantBeam);

          memberMetadata.push({
            elementId: physicalId,
            elementIndex: elIdx,
            analyticalElementIndices: [elIdx],
            analyticalElementIds: [physicalId],
            category: 'CANTILEVER_BEAM',
            floorId: lvl.floor.id,
            storeyLevel: lvl.floor.level,
            widthMm,
            depthMm,
            clearSpanOrHeightMm: Math.round(projMm),
            concreteGrade: elGrade,
            steelGrade,
            supportedWallThicknessMm: 115,
            supportedWallHeightMm: 1050,
            wallOpeningFraction: 0,
            sizingProvenance: override ? 'OPTIMIZED' : 'PRELIMINARY_SPAN_AND_STACK_RULE',
          });
        }
      }
    }

    beamElementsByLevel.set(lIdx, levelBeamIndices);
    physicalBeamsByLevel.set(lIdx, levelPhysicalBeams);
  }

  // 6. Synthesize Physical Slab Panels (Subdividing Open Floor/Terrace Plates Along Supporting Beam Bays!) & Stair Waists
  const slabPanels: SynthesizedSlabPanel[] = [];
  const physicalSlabs: PhysicalSlab[] = [];
  const stairWaists: SynthesizedStaircaseWaist[] = [];
  const physicalStairWaists: PhysicalStairWaist[] = [];

  for (let lIdx = 1; lIdx < levels.length; lIdx++) {
    const lvl = levels[lIdx]!;
    if (!lvl.floor) continue;
    const floor = lvl.floor;
    const prevElevMm = levels[lIdx - 1]!.elevationMm;
    const levelBeams = beamElementsByLevel.get(lIdx) ?? [];
    const levelPhysBeams = physicalBeamsByLevel.get(lIdx) ?? [];

    const floorBoundaryPts = floor.boundary?.points ?? [];
    const isOrthogonalFloor =
      floorBoundaryPts.length >= 4 &&
      floorBoundaryPts.every((pt, i) => {
        const nxt = floorBoundaryPts[(i + 1) % floorBoundaryPts.length]!;
        return Math.abs(pt.x - nxt.x) <= 50 || Math.abs(pt.y - nxt.y) <= 50;
      });
    const useBeamBayGrid =
      (options.slabPanelizationMode ?? 'BEAM_BAY_GRID') === 'BEAM_BAY_GRID' &&
      framingStrategy === 'PRACTICAL_ARCHITECTURAL_GRID' &&
      isOrthogonalFloor &&
      gridLinesX.length >= 2 &&
      gridLinesY.length >= 2;

    const pointInPoly = (px: number, py: number, poly: readonly Point[]): boolean => {
      if (poly.length < 3) return true;
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i]!.x, yi = poly[i]!.y;
        const xj = poly[j]!.x, yj = poly[j]!.y;
        const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    };

    const synthesizedGridBayRooms: Room[] = [];
    if (useBeamBayGrid) {
      const cutouts = floor.voidBoundaries ?? [];
      for (let ix = 0; ix < gridLinesX.length - 1; ix++) {
        for (let iy = 0; iy < gridLinesY.length - 1; iy++) {
          const x0 = gridLinesX[ix]!;
          const x1 = gridLinesX[ix + 1]!;
          const y0 = gridLinesY[iy]!;
          const y1 = gridLinesY[iy + 1]!;
          if (x1 - x0 < 900 || y1 - y0 < 900) continue;
          const cx = 0.5 * (x0 + x1);
          const cy = 0.5 * (y0 + y1);
          if (floorBoundaryPts.length >= 3 && !pointInPoly(cx, cy, floorBoundaryPts)) continue;

          // Skip bays whose center falls inside an explicit void/OTS/lift/stair shaft
          const inVoid = cutouts.some((c) => c.points.length >= 3 && pointInPoly(cx, cy, c.points));
          if (inVoid) continue;
          const inStair = (floor.stairs ?? []).some(
            (st) => cx > st.x + 150 && cx < st.x + st.width - 150 && cy > st.y + 150 && cy < st.y + st.length - 150,
          );
          if (inStair) continue;

          const overlappingRooms = (floor.rooms ?? []).filter((rm) => {
            const rb =
              rm.boundary?.points && rm.boundary.points.length >= 3
                ? polygonBounds(rm.boundary.points)
                : { minX: rm.x, maxX: rm.x + rm.width, minY: rm.y, maxY: rm.y + rm.height };
            const ox = Math.min(x1, rb.maxX) - Math.max(x0, rb.minX);
            const oy = Math.min(y1, rb.maxY) - Math.max(y0, rb.minY);
            return ox > 200 && oy > 200;
          });
          if (
            overlappingRooms.length > 0 &&
            overlappingRooms.every((rm) => {
              const rn = `${rm.type} ${rm.name}`.toLowerCase();
              return rm.spaceUse === 'VOID' || rm.openToSky || rn.includes('lift') || rn.includes('elevator') || rn.includes('shaft');
            })
          ) {
            continue;
          }

          // Pick governing highest-occupancy room overlapping this structural bay
          const domRoom = overlappingRooms[0];
          const bayAreaM2 = ((x1 - x0) * (y1 - y0)) / 1e6;
          synthesizedGridBayRooms.push({
            id: `BAY_${floor.id}_${ix + 1}_${iy + 1}`,
            floorId: floor.id,
            type: (domRoom?.type ?? (floor.floorUse === 'ROOF' ? 'TERRACE' : 'LIVING_ROOM')) as Room['type'],
            name: domRoom ? `${domRoom.name || String(domRoom.type)} [Grid ${ix + 1}.${iy + 1}]` : `Slab Bay ${ix + 1}.${iy + 1}`,
            boundary: { points: rectRing(x0, x1, y0, y1) as Point[] },
            x: x0,
            y: y0,
            width: x1 - x0,
            height: y1 - y0,
            rotation: 0,
            area: bayAreaM2,
            priority: 1,
            tags: [],
            adjacencyRequirements: [],
            daylightRequirement: 'MEDIUM' as Room['daylightRequirement'],
            privacyRequirement: 'PUBLIC' as Room['privacyRequirement'],
            ventilationRequired: true,
            isFixed: false,
          });
        }
      }
      // Also preserve genuine cantilever balcony overhangs projecting outside the column grid!
      for (const rm of floor.rooms ?? []) {
        const rb =
          rm.boundary?.points && rm.boundary.points.length >= 3
            ? polygonBounds(rm.boundary.points)
            : { minX: rm.x, maxX: rm.x + rm.width, minY: rm.y, maxY: rm.y + rm.height };
        const projectsOutside =
          rb.maxX > allBounds.maxX + 350 ||
          rb.minX < allBounds.minX - 350 ||
          rb.maxY > allBounds.maxY + 350 ||
          rb.minY < allBounds.minY - 350;
        if (projectsOutside) {
          synthesizedGridBayRooms.push(rm);
        }
      }
    }

    const roomsToPanelize: Room[] =
      useBeamBayGrid && synthesizedGridBayRooms.length > 0
        ? synthesizedGridBayRooms
        : floor.rooms && floor.rooms.length > 0
        ? [...floor.rooms]
        : [
            {
              id: `SLAB_DEFAULT_${floor.id}`,
              floorId: floor.id,
              type: 'LIVING_ROOM' as Room['type'],
              name: floor.name || 'Floor Plate',
              boundary: floor.boundary,
              x: allBounds.minX,
              y: allBounds.minY,
              width: Math.max(3000, allBounds.maxX - allBounds.minX),
              height: Math.max(3000, allBounds.maxY - allBounds.minY),
              rotation: 0,
              area: planAreaM2,
              priority: 1,
              tags: [],
              adjacencyRequirements: [],
              daylightRequirement: 'MEDIUM' as Room['daylightRequirement'],
              privacyRequirement: 'PUBLIC' as Room['privacyRequirement'],
              ventilationRequired: true,
              isFixed: false,
            },
          ];

    let floorPanelSeq = 0;

    for (let rIdx = 0; rIdx < roomsToPanelize.length; rIdx++) {
      const room = roomsToPanelize[rIdx]!;
      if (room.spaceUse === 'VOID' || room.openToSky) continue;
      // Skip lift shafts (voids in floor slab!)
      const rNameLower = `${room.type} ${room.name}`.toLowerCase();
      if (rNameLower.includes('lift') || rNameLower.includes('elevator') || rNameLower.includes('shaft')) {
        continue;
      }

      const rb =
        room.boundary?.points && room.boundary.points.length >= 3
          ? polygonBounds(room.boundary.points)
          : { minX: room.x, maxX: room.x + room.width, minY: room.y, maxY: room.y + room.height };
      const rawW = Math.max(1200, rb.maxX - rb.minX);
      const rawH = Math.max(1200, rb.maxY - rb.minY);

      const projectsOutsideColumnGrid =
        rb.maxX > allBounds.maxX + 350 ||
        rb.minX < allBounds.minX - 350 ||
        rb.maxY > allBounds.maxY + 350 ||
        rb.minY < allBounds.minY - 350;
      const isExplicitBalconyName =
        String(room.type).toLowerCase() === 'balcony' ||
        room.name.toLowerCase().includes('balcony') ||
        room.name.toLowerCase().includes('chajja');
      const isCantilever =
        projectsOutsideColumnGrid ||
        (isExplicitBalconyName && Math.min(rawW, rawH) <= 2800 && floor.floorUse !== 'ROOF');

      // Subdivide large open rooms/terraces (> 5,200 mm) along interior structural beam grid lines!
      const xSplits =
        framingStrategy === 'PRACTICAL_ARCHITECTURAL_GRID' && !isCantilever && rawW > 5200
          ? [
              rb.minX,
              ...gridLinesX.filter((gx) => gx > rb.minX + 1600 && gx < rb.maxX - 1600),
              rb.maxX,
            ]
          : [rb.minX, rb.maxX];
      const ySplits =
        framingStrategy === 'PRACTICAL_ARCHITECTURAL_GRID' && !isCantilever && rawH > 5200
          ? [
              rb.minY,
              ...gridLinesY.filter((gy) => gy > rb.minY + 1600 && gy < rb.maxY - 1600),
              rb.maxY,
            ]
          : [rb.minY, rb.maxY];

      const totalRoomAreaM2 =
        room.area && room.area > 0.5 && room.area < 5000
          ? room.area > 600
            ? (rawW * rawH) / 1e6
            : room.area
          : (rawW * rawH) / 1e6;
      const boxAreaM2 = Math.max(0.5, (rawW * rawH) / 1e6);
      const areaScale = clamp(totalRoomAreaM2 / boxAreaM2, 0.4, 1.0);
      const isSubdivided = xSplits.length > 2 || ySplits.length > 2;

      for (let ix = 0; ix < xSplits.length - 1; ix++) {
        for (let iy = 0; iy < ySplits.length - 1; iy++) {
          const bMinX = xSplits[ix]!;
          const bMaxX = xSplits[ix + 1]!;
          const bMinY = ySplits[iy]!;
          const bMaxY = ySplits[iy + 1]!;
          const bayW = Math.max(1100, bMaxX - bMinX);
          const bayH = Math.max(1100, bMaxY - bMinY);
          const lxMm = Math.min(bayW, bayH);
          const lyMm = Math.max(bayW, bayH);
          const ratio = lyMm / lxMm;

          const panelType: SynthesizedSlabPanel['panelType'] = isCantilever
            ? 'CANTILEVER'
            : ratio > 2.0
              ? 'ONE_WAY'
              : 'TWO_WAY';

          floorPanelSeq++;
          const panelId = `SLAB_${floor.id}_${floorPanelSeq}`;
          const overrideThick = options.slabThicknessOverridesMm?.[panelId];
          // Size slab thickness per IS 456 Cl. 24.1 & L/d with realistic kt margin so spans up to 6m pass cleanly!
          const prelimThick = isCantilever
            ? clamp(Math.ceil(lxMm / 8.5 / 5) * 5, 135, 250)
            : panelType === 'ONE_WAY'
              ? clamp(Math.ceil(lxMm / 23 / 5) * 5, 130, 240)
              : clamp(Math.ceil((lxMm > 3500 ? lxMm / 24 : lxMm / 28) / 5) * 5, 125, 225);
          const thicknessMm =
            overrideThick ??
            (floor.slabThicknessMm ? Math.max(floor.slabThicknessMm, prelimThick) : prelimThick);

          let discEdges = 0;
          if (Math.abs(bMinX - allBounds.minX) < 500) discEdges++;
          if (Math.abs(bMaxX - allBounds.maxX) < 500) discEdges++;
          if (Math.abs(bMinY - allBounds.minY) < 500) discEdges++;
          if (Math.abs(bMaxY - allBounds.maxY) < 500) discEdges++;

          const cx = (bMinX + bMaxX) / 2;
          const cy = (bMinY + bMaxY) / 2;

          // Match supporting PhysicalBeams along the 4 edges of the rectangular bay [bMinX, bMaxX] x [bMinY, bMaxY] FIRST,
          // falling back to proximity only when an edge lacks a collinear beam!
          const edgeMatchedBeams = levelPhysBeams.filter((pb) => {
            const x0 = pb.startPointMm.x;
            const y0 = pb.startPointMm.y;
            const x1 = pb.endPointMm.x;
            const y1 = pb.endPointMm.y;
            const tol = 320;
            // Horizontal beam along y = bMinY or y = bMaxY overlapping [bMinX, bMaxX]
            if (Math.abs(y0 - y1) <= tol) {
              const yAvg = 0.5 * (y0 + y1);
              if (Math.abs(yAvg - bMinY) <= tol || Math.abs(yAvg - bMaxY) <= tol) {
                const overlap = Math.min(bMaxX, Math.max(x0, x1)) - Math.max(bMinX, Math.min(x0, x1));
                if (overlap > 250) return true;
              }
            }
            // Vertical beam along x = bMinX or x = bMaxX overlapping [bMinY, bMaxY]
            if (Math.abs(x0 - x1) <= tol) {
              const xAvg = 0.5 * (x0 + x1);
              if (Math.abs(xAvg - bMinX) <= tol || Math.abs(xAvg - bMaxX) <= tol) {
                const overlap = Math.min(bMaxY, Math.max(y0, y1)) - Math.max(bMinY, Math.min(y0, y1));
                if (overlap > 250) return true;
              }
            }
            if (isCantilever && pb.category === 'CANTILEVER_BEAM') {
              const bmx = 0.5 * (x0 + x1);
              const bmy = 0.5 * (y0 + y1);
              if (Math.hypot(bmx - cx, bmy - cy) <= Math.max(lyMm, 3200)) return true;
            }
            return false;
          });

          const scoredPhysBeams = levelPhysBeams
            .map((pb) => {
              const bmx = (pb.startPointMm.x + pb.endPointMm.x) / 2;
              const bmy = (pb.startPointMm.y + pb.endPointMm.y) / 2;
              return { pb, dist: Math.hypot(bmx - cx, bmy - cy) };
            })
            .sort((a, b) => a.dist - b.dist);

          const chosenPhysBeams =
            edgeMatchedBeams.length > 0
              ? edgeMatchedBeams
              : scoredPhysBeams
                  .filter((b) => b.dist <= Math.max(lyMm * 0.85, 4800))
                  .slice(0, 4)
                  .map((b) => b.pb);
          if (chosenPhysBeams.length === 0 && scoredPhysBeams[0]) {
            chosenPhysBeams.push(scoredPhysBeams[0].pb);
          }

          const chosenBeamElementIndices = chosenPhysBeams.flatMap(
            (pb) => pb.analyticalElementIndices,
          );
          if (chosenBeamElementIndices.length === 0 && levelBeams[0] !== undefined) {
            chosenBeamElementIndices.push(levelBeams[0]);
          }

          const bayAreaM2 = ((bayW * bayH) / 1e6) * areaScale;
          const bayBounds = { minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY };
          const rawRing = isSubdivided
            ? rectRing(bMinX, bMaxX, bMinY, bMaxY)
            : room.boundary?.points && room.boundary.points.length >= 3
              ? room.boundary.points
              : rectRing(bMinX, bMaxX, bMinY, bMaxY);

          const cutouts = floor.voidBoundaries ?? [];
          const overlapsOpening = cutouts.some((cutout) => {
            const bounds = polygonBounds(cutout.points);
            return (
              bayBounds.minX < bounds.maxX &&
              bounds.minX < bayBounds.maxX &&
              bayBounds.minY < bounds.maxY &&
              bounds.minY < bayBounds.maxY
            );
          });

          const labelSuffix = isSubdivided ? ` [Bay ${ix + 1}.${iy + 1}]` : '';
          const panelName = `${room.name || String(room.type)}${labelSuffix}`;

          slabPanels.push({
            id: panelId,
            floorId: floor.id,
            floorLevel: floor.level,
            roomId: room.id,
            roomName: panelName,
            roomType: String(room.type),
            panelType,
            lxMm: Math.round(lxMm),
            lyMm: Math.round(lyMm),
            aspectRatioLyLx: Number(ratio.toFixed(3)),
            areaM2: Number(bayAreaM2.toFixed(3)),
            thicknessMm,
            concreteGrade,
            steelGrade,
            discontinuousEdges: discEdges,
            supportingBeamElementIndices: chosenBeamElementIndices,
            supportingPhysicalBeamIds: chosenPhysBeams.map((pb) => pb.physicalMemberId),
            boundsMm: bayBounds,
            exchangeBoundary: !overlapsOpening && rawRing.length >= 3 ? rawRing : undefined,
            sizingProvenance: overrideThick
              ? 'USER_OR_OPTIMIZER_ASSIGNED'
              : 'PRELIMINARY_SPAN_DEPTH_RULE',
          });

          physicalSlabs.push({
            kind: 'PHYSICAL_SLAB',
            physicalMemberId: panelId,
            slabMark: `S${floorPanelSeq}`,
            floorId: floor.id,
            floorLevel: floor.level,
            roomId: room.id,
            roomName: panelName,
            roomType: String(room.type),
            panelType,
            lxMm: Math.round(lxMm),
            lyMm: Math.round(lyMm),
            aspectRatioLyLx: Number(ratio.toFixed(3)),
            areaM2: Number(bayAreaM2.toFixed(3)),
            thicknessMm,
            topElevationMm: lvl.elevationMm,
            concreteGrade,
            steelGrade,
            discontinuousEdges: discEdges,
            supportingPhysicalBeamIds: chosenPhysBeams.map((pb) => pb.physicalMemberId),
            supportingAnalyticalElementIndices: chosenBeamElementIndices,
            boundsMm: bayBounds,
            exchangeBoundary: !overlapsOpening && rawRing.length >= 3 ? rawRing : undefined,
            sizingProvenance: overrideThick
              ? 'USER_OR_OPTIMIZER_ASSIGNED'
              : 'PRELIMINARY_SPAN_DEPTH_RULE',
          });
        }
      }
    }

    // Staircase waist slabs (with exact 3D planar flight bounds & elevations for IFC4 IfcStairFlight solids!)
    for (const stair of floor.stairs ?? []) {
      const wRaw = Number(stair.width) || 1200;
      const lRaw = Number(stair.length) || 3000;
      const spanMm = Math.max(2000, Math.max(lRaw, wRaw));
      const widthMm = Math.max(1000, Math.min(wRaw, lRaw));
      const waistThickMm = clamp(Math.ceil(spanMm / 19 / 5) * 5, 160, 260);
      const sx = stair.x + wRaw / 2;
      const sy = stair.y + lRaw / 2;

      const stairPhysBeams = levelPhysBeams
        .map((pb) => {
          const bmx = (pb.startPointMm.x + pb.endPointMm.x) / 2;
          const bmy = (pb.startPointMm.y + pb.endPointMm.y) / 2;
          return { pb, dist: Math.hypot(bmx - sx, bmy - sy) };
        })
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 2)
        .map((b) => b.pb);
      const stairBeamElemIndices = stairPhysBeams.flatMap((pb) => pb.analyticalElementIndices);

      const rawDir = String((stair as { direction?: string }).direction ?? '').toUpperCase();
      const directions:Record<string,'N'|'S'|'E'|'W'> = { NORTH:'N', SOUTH:'S', EAST:'E', WEST:'W', N:'N', S:'S', E:'E', W:'W' };
      const explicitDirection = directions[rawDir];
      const flightDirection = explicitDirection ?? (lRaw >= wRaw ? 'N' : 'E');

      const stairBounds = {
        minX: Math.round(stair.x),
        maxX: Math.round(stair.x + wRaw),
        minY: Math.round(stair.y),
        maxY: Math.round(stair.y + lRaw),
      };
      const hasFiniteGeometry =
        Number.isFinite(stair.x) &&
        Number.isFinite(stair.y) &&
        wRaw >= 800 &&
        lRaw >= 1200 &&
        lvl.elevationMm > prevElevMm + 1200;

      const waistId = `STAIR_WAIST_${floor.id}_${stair.id}`;
      stairWaists.push({
        id: waistId,
        hasExplicitStraightFlightGeometry: stair.type === 'straight' && !!explicitDirection && hasFiniteGeometry &&
          [stair.width,stair.length,stair.riserHeight,stair.treadDepth,stair.riserCount].every(n=>Number.isFinite(n) && n>0),
        floorId: floor.id,
        stairId: stair.id,
        horizontalSpanMm: Math.round(spanMm),
        widthMm: Math.round(widthMm),
        waistThicknessMm: waistThickMm,
        riserMm: stair.riserHeight || 150,
        treadMm: stair.treadDepth || 275,
        riserCount: stair.riserCount || Math.round((floor.floorHeight || 3000) / 150),
        supportingBeamElementIndices: stairBeamElemIndices,
        boundsMm: stairBounds,
        flightDirection,
        baseElevationMm: prevElevMm,
        topElevationMm: lvl.elevationMm,
        ifcSolidGeometrySupported: hasFiniteGeometry,
      });

      physicalStairWaists.push({
        kind: 'PHYSICAL_STAIR_WAIST',
        physicalMemberId: waistId,
        floorId: floor.id,
        stairId: stair.id,
        boundsMm: stairBounds,
        flightDirection,
        baseElevationMm: prevElevMm,
        topElevationMm: lvl.elevationMm,
        horizontalSpanMm: Math.round(spanMm),
        widthMm: Math.round(widthMm),
        waistThicknessMm: waistThickMm,
        riserMm: stair.riserHeight || 150,
        treadMm: stair.treadDepth || 275,
        riserCount: stair.riserCount || Math.round((floor.floorHeight || 3000) / 150),
        supportingPhysicalBeamIds: stairPhysBeams.map((pb) => pb.physicalMemberId),
        supportingAnalyticalElementIndices: stairBeamElemIndices,
        ifcSolidGeometrySupported: hasFiniteGeometry,
      });
    }
  }

  return {
    systemId: `STRUCT_${building.id}_v${building.version}_r${options.structuralRevision ?? 1}`,
    projectId: building.projectId || building.metadata?.projectId || building.id,
    buildingId: building.id,
    sourceArchitecturalRevision: building.version,
    sourceArchitecturalSha256: archHash,
    structuralRevision: options.structuralRevision ?? 1,
    concreteGrade,
    steelGrade,
    ductileDetailing,
    storeys,
    nodes,
    elements,
    memberMetadata,
    slabPanels,
    stairWaists,
    physicalModel: {
      columns: physicalColumns,
      beams: physicalBeams,
      slabs: physicalSlabs,
      stairWaists: physicalStairWaists,
      mapping: {
        physicalToAnalyticalElementIds,
        analyticalToPhysicalMemberId,
        analyticalIndexToPhysicalMemberId,
        stationsByPhysicalMemberId,
      },
    },
    baseColumnStackMap,
    clashes,
  };
}

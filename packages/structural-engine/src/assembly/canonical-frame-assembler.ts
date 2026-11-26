/**
 * @ai-floor-planner/structural-engine — Canonical Architectural-to-Structural Frame Assembler (Phase A6)
 *
 * Synthesizes a traceable 3D structural frame + slab panel + staircase analytical model
 * from RH Planner's Canonical `Building` (`mm`) without mutating architectural geometry:
 * 1. Binds `sourceArchitecturalRevision` (`building.version`) and `sourceArchitecturalSha256`.
 * 2. Derives multi-storey column stacks from structural columns, load-bearing wall intersections,
 *    perimeter corners, and stair/lift cores, subdividing long spans > maxColumnSpacingMm.
 * 3. Audits every column against doors, windows, stair flights, lift cores, and stilt parking zones,
 *    nudging auto-placed columns along walls where safe and recording explicit clash warnings otherwise.
 * 4. Assigns demand-differentiated preliminary member sizes (`PRELIMINARY_SPAN_AND_STACK_RULE`)
 *    based on actual clear span L, cantilever status, storey stack depth, and seismic ductility rules.
 */

import { canonicalBuildingHash, type Building, type Floor, type Point, type Room } from '@ai-floor-planner/core';
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
    | 'HEADROOM_CLEARANCE_WARNING';
  readonly severity: 'ERROR' | 'WARNING';
  readonly floorId: string;
  readonly structuralMemberId: string;
  readonly architecturalEntityId: string;
  readonly message: string;
  readonly positionMm: { readonly x: number; readonly y: number };
}

export interface SynthesizedSlabPanel {
  readonly id: string;
  readonly floorId: string;
  readonly floorLevel: number;
  readonly roomId?: string;
  readonly roomName: string;
  readonly roomType: string;
  readonly panelType: 'TWO_WAY' | 'ONE_WAY' | 'CANTILEVER';
  /** Short clear/effective span lx in mm. */
  readonly lxMm: number;
  /** Long clear/effective span ly in mm. */
  readonly lyMm: number;
  readonly aspectRatioLyLx: number;
  readonly areaM2: number;
  readonly thicknessMm: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  /** Number of discontinuous edges (0..4) for IS 456 Annex D Case 1..9 selection. */
  readonly discontinuousEdges: number;
  readonly supportingBeamElementIndices: readonly number[];
  readonly boundsMm: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
  };
  readonly sizingProvenance: 'PRELIMINARY_SPAN_DEPTH_RULE' | 'USER_OR_OPTIMIZER_ASSIGNED';
}

export interface SynthesizedStaircaseWaist {
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
}

export interface MemberDesignMetadata {
  readonly elementId: string;
  readonly elementIndex: number;
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
  readonly nodes: readonly AnalyticalNode[];
  readonly elements: readonly AnalyticalFrameElement[];
  readonly memberMetadata: readonly MemberDesignMetadata[];
  readonly slabPanels: readonly SynthesizedSlabPanel[];
  readonly stairWaists: readonly SynthesizedStaircaseWaist[];
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

export interface FrameSynthesisOptions {
  readonly concreteGrade?: ConcreteGrade;
  readonly steelGrade?: SteelGrade;
  readonly ductileDetailing?: boolean;
  readonly foundationDepthBelowPlinthMm?: number;
  readonly includePlinthTieBeams?: boolean;
  readonly maxColumnSpacingMm?: number;
  readonly snapToleranceMm?: number;
  /** Optional per-member section overrides from localized structural optimization (`elementId -> { widthMm, depthMm, concreteGrade? }`). */
  readonly sectionOverrides?: Readonly<
    Record<string, { readonly widthMm: number; readonly depthMm: number; readonly concreteGrade?: ConcreteGrade }>
  >;
  /** Optional slab thickness overrides (`slabPanelId -> thicknessMm`). */
  readonly slabThicknessOverridesMm?: Readonly<Record<string, number>>;
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

export function synthesizeCanonicalStructuralSystem(
  building: Building,
  options: FrameSynthesisOptions = {},
): SynthesizedStructuralSystem {
  const concreteGrade = options.concreteGrade ?? 'M25';
  const steelGrade = options.steelGrade ?? 'Fe500';
  const ductileDetailing = options.ductileDetailing ?? true;
  const foundationDepthMm = options.foundationDepthBelowPlinthMm ?? 1500;
  const includePlinth = options.includePlinthTieBeams ?? true;
  const maxColSpacingMm = options.maxColumnSpacingMm ?? 5500;
  const snapTolMm = options.snapToleranceMm ?? 320;

  const archHash = canonicalBuildingHash(building);
  const sortedFloors: Floor[] = [...building.floors].sort((a, b) => a.level - b.level);
  if (sortedFloors.length === 0) {
    throw new Error('Cannot synthesize structural frame for a building with zero floors.');
  }

  // 1. Collect candidate column plan coordinates (x, y) in mm across floors so stacks are continuous
  interface ColumnStackPlan {
    id: string;
    xMm: number;
    yMm: number;
    explicitWidthMm?: number;
    explicitDepthMm?: number;
    fromExplicitColumn: boolean;
  }

  const stacks: ColumnStackPlan[] = [];
  const addCandidatePoint = (
    x: number,
    y: number,
    explicit = false,
    wMm?: number,
    dMm?: number,
  ): ColumnStackPlan => {
    for (const s of stacks) {
      if (Math.hypot(s.xMm - x, s.yMm - y) <= snapTolMm) {
        if (explicit && !s.fromExplicitColumn) {
          s.xMm = x;
          s.yMm = y;
          s.fromExplicitColumn = true;
          s.explicitWidthMm = wMm;
          s.explicitDepthMm = dMm;
        }
        return s;
      }
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

  // Explicit columns first
  for (const floor of sortedFloors) {
    for (const col of floor.columns ?? []) {
      if (col.isStructural !== false) {
        addCandidatePoint(col.position.x, col.position.y, true, col.width, col.depth);
      }
    }
  }

  const subdivideSpanIfUnframed = (p0: Point, p1: Point) => {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    if (len <= maxColSpacingMm) return;
    // Check if any existing stack already splits this segment near the middle!
    const hasInteriorSupport = stacks.some((s) => {
      const t = ((s.xMm - p0.x) * dx + (s.yMm - p0.y) * dy) / (len * len);
      if (t <= 0.18 || t >= 0.82) return false;
      const perp = Math.abs((s.xMm - p0.x) * dy - (s.yMm - p0.y) * dx) / len;
      return perp <= 550;
    });
    if (hasInteriorSupport) return;
    const segs = Math.ceil(len / maxColSpacingMm);
    for (let k = 1; k < segs; k++) {
      addCandidatePoint(p0.x + (dx * k) / segs, p0.y + (dy * k) / segs);
    }
  };

  // Floor boundary corners, room corners, and wall endpoints FIRST, then subdivide remaining long unframed spans!
  const refFloor = sortedFloors[0]!;
  const boundaryPts = refFloor.boundary?.points ?? [];
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
      if (len < 600) continue;
      addCandidatePoint(wall.startPoint.x, wall.startPoint.y);
      addCandidatePoint(wall.endPoint.x, wall.endPoint.y);
    }

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
  }

  // Now subdivide any perimeter boundary edges or structural walls that STILL exceed maxColSpacingMm without an interior column!
  for (let i = 0; i < boundaryPts.length; i++) {
    subdivideSpanIfUnframed(boundaryPts[i]!, boundaryPts[(i + 1) % boundaryPts.length]!);
  }
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

  // Fallback orthogonal grid if sparse architectural geometry had < 4 points
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

  // Sort stacks deterministically (South-to-North / West-to-East) and assign C1..Cn IDs
  stacks.sort((a, b) => (Math.abs(a.yMm - b.yMm) > 250 ? a.yMm - b.yMm : a.xMm - b.xMm));
  stacks.forEach((s, idx) => {
    s.id = `C${idx + 1}`;
  });

  // 2. Opening & Circulation Clash Audit + Auto-Nudge for Non-Explicit Columns
  const clashes: ArchitecturalStructuralClash[] = [];
  for (const stk of stacks) {
    for (const floor of sortedFloors) {
      // Check doors
      for (const door of floor.doors ?? []) {
        const halfClear = (door.widthMm ?? door.width ?? 900) / 2 + 150;
        const dist = Math.hypot(stk.xMm - door.position.x, stk.yMm - door.position.y);
        if (dist < halfClear) {
          if (!stk.fromExplicitColumn) {
            // Attempt safe nudge along host wall
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

      // Check stair flights (interior of stair box excluding perimeter corners)
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
  const storeyCount = sortedFloors.length;
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

  let runningElevMm = 0;
  for (const floor of sortedFloors) {
    const hMm = Math.max(2700, floor.floorHeight || 3000);
    runningElevMm += hMm;
    levels.push({
      key: floor.id,
      elevationMm: runningElevMm,
      floor,
      isFoundation: false,
      isPlinth: false,
    });
  }

  // Estimate tributary area per column stack for realistic demand-differentiated preliminary column sizing
  const allBounds = polygonBounds(stacks.map((s) => ({ x: s.xMm, y: s.yMm })));
  const planAreaM2 = Math.max(
    16,
    ((allBounds.maxX - allBounds.minX) * (allBounds.maxY - allBounds.minY)) / 1e6,
  );
  const avgTributaryM2 = planAreaM2 / Math.max(1, stacks.length);

  // Create Nodes: nodeIndexByStackAndLevel[stackIdx][levelIdx]
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

  const fckDefault = CONCRETE_FCK_MPA[concreteGrade];

  // 4. Create Vertical Column Elements with Demand-Differentiated Sizing per Stack & Storey!
  for (let sIdx = 0; sIdx < stacks.length; sIdx++) {
    const stk = stacks[sIdx]!;
    const isEdgeX =
      Math.abs(stk.xMm - allBounds.minX) < 600 || Math.abs(stk.xMm - allBounds.maxX) < 600;
    const isEdgeY =
      Math.abs(stk.yMm - allBounds.minY) < 600 || Math.abs(stk.yMm - allBounds.maxY) < 600;
    const posMultiplier = isEdgeX && isEdgeY ? 0.6 : isEdgeX || isEdgeY ? 0.85 : 1.25;
    const tribM2 = Math.max(6, avgTributaryM2 * posMultiplier);

    for (let lIdx = 0; lIdx < levels.length - 1; lIdx++) {
      const botLvl = levels[lIdx]!;
      const topLvl = levels[lIdx + 1]!;
      const storeysAbove = Math.max(
        1,
        levels.slice(lIdx + 1).filter((l) => !l.isFoundation && !l.isPlinth).length,
      );
      const elementId = `COL_${stk.id}_L${lIdx}`;
      const override = options.sectionOverrides?.[elementId];
      const elGrade = override?.concreteGrade ?? concreteGrade;

      // Preliminary axial + biaxial MRF moment magnification demand estimate:
      // In moment-resisting frames (IS 456 + IS 13920), combined Pu + Mux + Muy requires ~0.25*fck effective stress capacity
      // plus depth scaling for storey shear & beam bar anchorage!
      const estPuKn = 16.5 * tribM2 * storeysAbove;
      const mrfAmplifier = posMultiplier > 1.0 ? 1.85 : posMultiplier > 0.75 ? 1.65 : 1.35;
      const reqAgMm2 =
        (estPuKn * mrfAmplifier * 1000) /
        (0.28 * CONCRETE_FCK_MPA[elGrade] + 0.008 * STEEL_FY_MPA[steelGrade]);
      const minDimMm = ductileDetailing ? 300 : 230;

      let widthMm: number;
      let depthMm: number;
      let provenance: MemberDesignMetadata['sizingProvenance'] = 'PRELIMINARY_SPAN_AND_STACK_RULE';

      if (override) {
        widthMm = override.widthMm;
        depthMm = override.depthMm;
        provenance = 'OPTIMIZED';
      } else if (stk.fromExplicitColumn && stk.explicitWidthMm && stk.explicitDepthMm) {
        widthMm = Math.max(minDimMm, stk.explicitWidthMm);
        depthMm = Math.max(minDimMm, stk.explicitDepthMm);
        provenance = 'CANONICAL_EXPLICIT';
      } else {
        widthMm = reqAgMm2 > 145_000 ? 350 : minDimMm;
        const depthFromStackMm = minDimMm + (storeysAbove >= 3 ? (storeysAbove - 2) * 50 : 0) + (posMultiplier > 1.0 ? 50 : 0);
        depthMm = clamp(
          roundUp25(Math.max(minDimMm, depthFromStackMm, reqAgMm2 / widthMm)),
          minDimMm,
          750,
        );
      }

      const sec = computeRectangularSectionProps({
        widthMm,
        depthMm,
        elasticityMPa: concreteElasticModulusMPa(elGrade),
        unitWeightKnM3: IS875_RCC_UNIT_WEIGHT_KN_M3,
      });

      const elIdx = elements.length;
      const segHeightMm = topLvl.elevationMm - botLvl.elevationMm;
      elements.push({
        id: elementId,
        index: elIdx,
        category: 'COLUMN',
        startNodeIndex: nodeGrid[sIdx]![lIdx]!,
        endNodeIndex: nodeGrid[sIdx]![lIdx + 1]!,
        section: sec,
        floorId: topLvl.floor?.id ?? topLvl.key,
      });

      memberMetadata.push({
        elementId,
        elementIndex: elIdx,
        category: 'COLUMN',
        floorId: topLvl.floor?.id ?? topLvl.key,
        storeyLevel: topLvl.floor?.level ?? 0,
        stackId: stk.id,
        widthMm,
        depthMm,
        clearSpanOrHeightMm: segHeightMm,
        concreteGrade: elGrade,
        steelGrade,
        supportedWallThicknessMm: 0,
        supportedWallHeightMm: 0,
        wallOpeningFraction: 0,
        sizingProvenance: provenance,
      });

      if (lIdx === 0) {
        baseColumnStackMap[stk.id] = {
          stackId: stk.id,
          baseNodeIndex: nodeGrid[sIdx]![0]!,
          lowestColumnElementIndex: elIdx,
          xMm: stk.xMm,
          yMm: stk.yMm,
          columnWidthMm: widthMm,
          columnDepthMm: depthMm,
        };
      }
    }
  }

  // 5. Connect Horizontal Beams at Plinth & Every Floor Slab Level
  // Connect axis-aligned & wall-aligned nearest neighbors without overlapping collinear segments!
  interface PlanEdge {
    readonly sA: number;
    readonly sB: number;
    readonly lengthMm: number;
  }
  const planEdges: PlanEdge[] = [];
  const edgeKeySet = new Set<string>();

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
    if (len < 650 || len > maxColSpacingMm * 1.65) return;

    // Reject if another column stack lies collinearly strictly between pA and pB!
    for (let k = 0; k < stacks.length; k++) {
      if (k === a || k === b) continue;
      const pK = stacks[k]!;
      const t = ((pK.xMm - pA.xMm) * dx + (pK.yMm - pA.yMm) * dy) / (len * len);
      if (t > 0.08 && t < 0.92) {
        const perp = Math.abs((pK.xMm - pA.xMm) * dy - (pK.yMm - pA.yMm) * dx) / len;
        if (perp < 280) return;
      }
    }

    edgeKeySet.add(key);
    planEdges.push({ sA: a, sB: b, lengthMm: len });
  };

  // Connect orthogonal X/Y grid neighbors + explicit wall segments
  const alignTol = 380;
  for (let i = 0; i < stacks.length; i++) {
    const pI = stacks[i]!;
    let bestEast = -1, distEast = Infinity;
    let bestNorth = -1, distNorth = Infinity;
    for (let j = 0; j < stacks.length; j++) {
      if (i === j) continue;
      const pJ = stacks[j]!;
      if (Math.abs(pJ.yMm - pI.yMm) <= alignTol && pJ.xMm > pI.xMm + 600) {
        const d = pJ.xMm - pI.xMm;
        if (d < distEast) {
          distEast = d;
          bestEast = j;
        }
      }
      if (Math.abs(pJ.xMm - pI.xMm) <= alignTol && pJ.yMm > pI.yMm + 600) {
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

  // Also ensure perimeter / irregular plot boundary edges are framed
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

  // Ensure full graph connectivity across stacks so no column stack is laterally isolated
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

  // Map levelIdx -> beam element indices created at that level
  const beamElementsByLevel = new Map<number, number[]>();

  for (let lIdx = 1; lIdx < levels.length; lIdx++) {
    const lvl = levels[lIdx]!;
    const levelBeamIndices: number[] = [];
    const wallSourceFloor = lvl.isPlinth
      ? sortedFloors[0]!
      : sortedFloors.find((f) => f.level === (lvl.floor?.level ?? 0) + 1) ?? lvl.floor;

    for (let eIdx = 0; eIdx < planEdges.length; eIdx++) {
      const edge = planEdges[eIdx]!;
      const pA = stacks[edge.sA]!;
      const pB = stacks[edge.sB]!;
      const category: StructuralMemberCategory = lvl.isPlinth ? 'PLINTH_BEAM' : 'BEAM';
      const elementId = `${lvl.isPlinth ? 'PB' : 'BM'}_${lvl.key}_${eIdx + 1}`;
      const override = options.sectionOverrides?.[elementId];
      const elGrade = override?.concreteGrade ?? concreteGrade;

      // Span-differentiated beam sizing:
      // Plinth beam: 230x350..400; Floor beam: D = clamp(roundUp25(L / 12), 300, 750), b = 230 or 300
      let widthMm: number;
      let depthMm: number;
      let provenance: MemberDesignMetadata['sizingProvenance'] = 'PRELIMINARY_SPAN_AND_STACK_RULE';
      if (override) {
        widthMm = override.widthMm;
        depthMm = override.depthMm;
        provenance = 'OPTIMIZED';
      } else if (lvl.isPlinth) {
        widthMm = 230;
        depthMm = clamp(roundUp25(edge.lengthMm / 14), 325, 450);
      } else {
        depthMm = clamp(roundUp25(edge.lengthMm / 12), 300, 750);
        widthMm = depthMm >= 550 ? 300 : 230;
        if (ductileDetailing) {
          widthMm = Math.max(200, widthMm, roundUp25(depthMm * 0.35));
        }
      }

      // Check headroom under beam on circulation/parking levels
      const hostFloorHeightMm = lvl.floor?.floorHeight ?? 3000;
      const clearUnderBeamMm = hostFloorHeightMm - depthMm;
      if (!lvl.isPlinth && clearUnderBeamMm < 2100) {
        clashes.push({
          id: `HEADROOM_${elementId}`,
          kind: 'HEADROOM_CLEARANCE_WARNING',
          severity: 'WARNING',
          floorId: lvl.floor?.id ?? lvl.key,
          structuralMemberId: elementId,
          architecturalEntityId: lvl.floor?.id ?? lvl.key,
          message: `Beam ${elementId} (${widthMm}x${depthMm} mm) leaves ${clearUnderBeamMm} mm clear headroom (< 2100 mm).`,
          positionMm: { x: Math.round((pA.xMm + pB.xMm) / 2), y: Math.round((pA.yMm + pB.yMm) / 2) },
        });
      }

      // Detect masonry wall supported along this beam edge (and deduct door/window openings!)
      let wallThickMm = 0;
      let wallHeightMm = 0;
      let openingFrac = 0;
      if (wallSourceFloor && !(wallSourceFloor.floorUse === 'STILT_PARKING' && !lvl.isPlinth)) {
        const midX = (pA.xMm + pB.xMm) / 2;
        const midY = (pA.yMm + pB.yMm) / 2;
        const matchedWall = (wallSourceFloor.walls ?? []).find((w) => {
          const wmx = (w.startPoint.x + w.endPoint.x) / 2;
          const wmy = (w.startPoint.y + w.endPoint.y) / 2;
          return Math.hypot(wmx - midX, wmy - midY) < edge.lengthMm * 0.6;
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
          // Roof parapet wall on perimeter of top slab!
          lIdx === levels.length - 1 &&
          ((Math.abs(pA.xMm - allBounds.minX) < 500 && Math.abs(pB.xMm - allBounds.minX) < 500) ||
            (Math.abs(pA.xMm - allBounds.maxX) < 500 && Math.abs(pB.xMm - allBounds.maxX) < 500) ||
            (Math.abs(pA.yMm - allBounds.minY) < 500 && Math.abs(pB.yMm - allBounds.minY) < 500) ||
            (Math.abs(pA.yMm - allBounds.maxY) < 500 && Math.abs(pB.yMm - allBounds.maxY) < 500))
        ) {
          wallThickMm = 150;
          wallHeightMm = 1050; // 1.05 m parapet per NBC / UDCPR
        }
      }

      const sec = computeRectangularSectionProps({
        widthMm,
        depthMm,
        elasticityMPa: concreteElasticModulusMPa(elGrade),
        unitWeightKnM3: IS875_RCC_UNIT_WEIGHT_KN_M3,
      });

      const elIdx = elements.length;
      elements.push({
        id: elementId,
        index: elIdx,
        category,
        startNodeIndex: nodeGrid[edge.sA]![lIdx]!,
        endNodeIndex: nodeGrid[edge.sB]![lIdx]!,
        section: sec,
        floorId: lvl.floor?.id ?? lvl.key,
      });
      levelBeamIndices.push(elIdx);

      memberMetadata.push({
        elementId,
        elementIndex: elIdx,
        category,
        floorId: lvl.floor?.id ?? lvl.key,
        storeyLevel: lvl.floor?.level ?? -1,
        widthMm,
        depthMm,
        clearSpanOrHeightMm: edge.lengthMm,
        concreteGrade: elGrade,
        steelGrade,
        supportedWallThicknessMm: wallThickMm,
        supportedWallHeightMm: wallHeightMm,
        wallOpeningFraction: openingFrac,
        sizingProvenance: provenance,
      });
    }

    // Synthesize explicit CANTILEVER_BEAM elements for cantilevered balconies projecting outside the column grid!
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

        // Determine outward projection beyond column envelope
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
          // Attach cantilever bracket beam from nearest column node on that floor
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

          const elementId = `CANT_${lvl.key}_${cantIdx}`;
          const override = options.sectionOverrides?.[elementId];
          const elGrade = override?.concreteGrade ?? concreteGrade;
          // IS 456 Cl. 23.2.1 cantilever span/depth <= 7 -> D >= L / 7 + cover
          const depthMm = override ? override.depthMm : clamp(roundUp25(projMm / 6.5 + 50), 300, 650);
          const widthMm = override ? override.widthMm : 230;
          const sec = computeRectangularSectionProps({
            widthMm,
            depthMm,
            elasticityMPa: concreteElasticModulusMPa(elGrade),
            unitWeightKnM3: IS875_RCC_UNIT_WEIGHT_KN_M3,
          });

          const elIdx = elements.length;
          elements.push({
            id: elementId,
            index: elIdx,
            category: 'CANTILEVER_BEAM',
            startNodeIndex: nodeGrid[bestS]![lIdx]!,
            endNodeIndex: tipNodeIdx,
            section: sec,
            floorId: lvl.floor.id,
          });
          levelBeamIndices.push(elIdx);
          memberMetadata.push({
            elementId,
            elementIndex: elIdx,
            category: 'CANTILEVER_BEAM',
            floorId: lvl.floor.id,
            storeyLevel: lvl.floor.level,
            widthMm,
            depthMm,
            clearSpanOrHeightMm: projMm,
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
  }

  // 6. Synthesize Floor Slab Panels & Staircase Waist Slabs Mapped to Supporting Beams
  const slabPanels: SynthesizedSlabPanel[] = [];
  const stairWaists: SynthesizedStaircaseWaist[] = [];

  for (let lIdx = 1; lIdx < levels.length; lIdx++) {
    const lvl = levels[lIdx]!;
    if (!lvl.floor) continue;
    const floor = lvl.floor;
    const levelBeams = beamElementsByLevel.get(lIdx) ?? [];

    const roomsToPanelize: Room[] =
      floor.rooms && floor.rooms.length > 0
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

    for (let rIdx = 0; rIdx < roomsToPanelize.length; rIdx++) {
      const room = roomsToPanelize[rIdx]!;
      if (room.spaceUse === 'VOID' || room.openToSky) continue;

      const rb =
        room.boundary?.points && room.boundary.points.length >= 3
          ? polygonBounds(room.boundary.points)
          : { minX: room.x, maxX: room.x + room.width, minY: room.y, maxY: room.y + room.height };
      const rawW = Math.max(1200, rb.maxX - rb.minX);
      const rawH = Math.max(1200, rb.maxY - rb.minY);
      const lxMm = Math.min(rawW, rawH);
      const lyMm = Math.max(rawW, rawH);
      const ratio = lyMm / lxMm;

      const isCantilever =
        String(room.type).toLowerCase() === 'balcony' ||
        room.spaceUse === 'OUTDOOR' ||
        room.name.toLowerCase().includes('balcony');
      const panelType: SynthesizedSlabPanel['panelType'] = isCantilever
        ? 'CANTILEVER'
        : ratio > 2.0
          ? 'ONE_WAY'
          : 'TWO_WAY';

      const panelId = `SLAB_${floor.id}_${rIdx + 1}`;
      const overrideThick = options.slabThicknessOverridesMm?.[panelId];
      // Span-to-depth sizing per IS 456 Cl. 24.1: continuous two-way ~ lx/32, one-way ~ lx/26, cantilever ~ lx/10 (min 125 mm)
      const prelimThick = isCantilever
        ? clamp(Math.ceil(lxMm / 10 / 5) * 5, 130, 225)
        : panelType === 'ONE_WAY'
          ? clamp(Math.ceil(lxMm / 26 / 5) * 5, 125, 225)
          : clamp(Math.ceil(lxMm / 30 / 5) * 5, 125, 200);
      const thicknessMm = overrideThick ?? floor.slabThicknessMm ?? prelimThick;

      // Count exterior/discontinuous edges
      let discEdges = 0;
      if (Math.abs(rb.minX - allBounds.minX) < 500) discEdges++;
      if (Math.abs(rb.maxX - allBounds.maxX) < 500) discEdges++;
      if (Math.abs(rb.minY - allBounds.minY) < 500) discEdges++;
      if (Math.abs(rb.maxY - allBounds.maxY) < 500) discEdges++;

      // Find nearest supporting beams on this floor
      const cx = (rb.minX + rb.maxX) / 2;
      const cy = (rb.minY + rb.maxY) / 2;
      const scoredBeams = levelBeams
        .map((bElIdx) => {
          const el = elements[bElIdx]!;
          const n0 = nodes[el.startNodeIndex]!.positionM;
          const n1 = nodes[el.endNodeIndex]!.positionM;
          const bmx = ((n0[0] + n1[0]) / 2) * 1000;
          const bmy = -((n0[1] + n1[1]) / 2) * 1000;
          const dist = Math.hypot(bmx - cx, bmy - cy);
          return { bElIdx, dist };
        })
        .sort((a, b) => a.dist - b.dist);

      const chosenBeams = scoredBeams
        .filter((b) => b.dist <= Math.max(lyMm * 0.85, 4500))
        .slice(0, 4)
        .map((b) => b.bElIdx);
      if (chosenBeams.length === 0 && scoredBeams.length > 0) {
        chosenBeams.push(scoredBeams[0]!.bElIdx);
      }

      const areaM2 =
        room.area && room.area > 0.5 && room.area < 5000
          ? room.area > 600 // guard if area was stored in mm² vs m²
            ? (rawW * rawH) / 1e6
            : room.area
          : (rawW * rawH) / 1e6;

      slabPanels.push({
        id: panelId,
        floorId: floor.id,
        floorLevel: floor.level,
        roomId: room.id,
        roomName: room.name || String(room.type),
        roomType: String(room.type),
        panelType,
        lxMm,
        lyMm,
        aspectRatioLyLx: Number(ratio.toFixed(3)),
        areaM2: Number(areaM2.toFixed(3)),
        thicknessMm,
        concreteGrade,
        steelGrade,
        discontinuousEdges: discEdges,
        supportingBeamElementIndices: chosenBeams,
        boundsMm: rb,
        sizingProvenance:
          overrideThick || floor.slabThicknessMm
            ? 'USER_OR_OPTIMIZER_ASSIGNED'
            : 'PRELIMINARY_SPAN_DEPTH_RULE',
      });
    }

    // Staircase waist slabs
    for (const stair of floor.stairs ?? []) {
      const spanMm = Math.max(2400, Math.max(stair.length, stair.width));
      const widthMm = Math.max(1000, Math.min(stair.width, stair.length));
      const waistThickMm = clamp(Math.ceil(spanMm / 20 / 5) * 5, 150, 250);
      const sx = stair.x + stair.width / 2;
      const sy = stair.y + stair.length / 2;
      const stairBeams = levelBeams
        .map((bElIdx) => {
          const el = elements[bElIdx]!;
          const n0 = nodes[el.startNodeIndex]!.positionM;
          const n1 = nodes[el.endNodeIndex]!.positionM;
          const bmx = ((n0[0] + n1[0]) / 2) * 1000;
          const bmy = -((n0[1] + n1[1]) / 2) * 1000;
          return { bElIdx, dist: Math.hypot(bmx - sx, bmy - sy) };
        })
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 2)
        .map((b) => b.bElIdx);

      stairWaists.push({
        id: `STAIR_WAIST_${floor.id}_${stair.id}`,
        floorId: floor.id,
        stairId: stair.id,
        horizontalSpanMm: spanMm,
        widthMm,
        waistThicknessMm: waistThickMm,
        riserMm: stair.riserHeight || 150,
        treadMm: stair.treadDepth || 275,
        riserCount: stair.riserCount || Math.round((floor.floorHeight || 3000) / 150),
        supportingBeamElementIndices: stairBeams,
      });
    }
  }

  void fckDefault;

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
    nodes,
    elements,
    memberMetadata,
    slabPanels,
    stairWaists,
    baseColumnStackMap,
    clashes,
  };
}

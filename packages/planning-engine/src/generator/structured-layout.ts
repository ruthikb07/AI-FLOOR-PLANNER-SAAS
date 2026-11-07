import type {
  Building,
  DesignRequirementSpecification,
  InstanceDesignGraph,
  Room,
  RoomProgram,
  RoomProgramItem,
  Wall,
} from '@ai-floor-planner/core';
import { relationshipUtility } from '../graph/scorer';
import { FloorProgramPlanner } from '../multi-floor/planner';
import {
  Direction,
  DoorType,
  FunctionalZone,
  RoomType,
  WallType,
  WindowType,
  addDoor,
  addRoom,
  addStair,
  addWall,
  addWindow,
  createBuilding,
} from '@ai-floor-planner/core';

export type LayoutStrategy = 'compact_zoning' | 'open_circulation' | 'vastu_aligned' | 'linear_split';

export interface LayoutStrategyProfile {
  readonly strategy: LayoutStrategy;
  readonly name: string;
  readonly description: string;
  readonly columnRatio: number;
  readonly priority: Readonly<Partial<Record<RoomType, number>>>;
  /** Public-room chain rather than independent public spokes off a corridor. */
  readonly commonAccess?: 'direct_chain';
}

export const LAYOUT_STRATEGIES: readonly LayoutStrategyProfile[] = [
  {
    strategy: 'compact_zoning',
    name: 'Compact Space-Efficient',
    description: 'Balanced two-zone layout with short, fully connected circulation paths.',
    columnRatio: 0.5,
    priority: {
      [RoomType.Living]: 1,
      [RoomType.Dining]: 2,
      [RoomType.Kitchen]: 3,
      [RoomType.Bedroom]: 4,
      [RoomType.Bathroom]: 5,
    },
  },
  {
    strategy: 'open_circulation',
    name: 'Open Cross-Ventilated',
    description: 'Public rooms lead the circulation chain while private spaces retain external light.',
    columnRatio: 0.52,
    priority: {
      [RoomType.Living]: 1,
      [RoomType.Dining]: 2,
      [RoomType.Bedroom]: 3,
      [RoomType.Kitchen]: 4,
      [RoomType.Bathroom]: 5,
    },
  },
  {
    strategy: 'vastu_aligned',
    name: 'Vastu-Oriented',
    description: 'Directional ordering favors public space, kitchen, and private-room separation.',
    columnRatio: 0.48,
    priority: {
      [RoomType.Living]: 1,
      [RoomType.Pooja]: 2,
      [RoomType.Dining]: 3,
      [RoomType.Kitchen]: 4,
      [RoomType.Bedroom]: 5,
      [RoomType.Bathroom]: 6,
    },
  },
];

/** Preserve legacy placement for unreviewed programs. Explicit suites can use
 * the public-chain organization without relying on inferred bathroom owners. */
export function planningStrategies(vastuRequested: boolean, reviewedPolygon: boolean): readonly LayoutStrategyProfile[] {
  const common = { ...LAYOUT_STRATEGIES[2]!,
    strategy: (vastuRequested ? 'vastu_aligned' : 'linear_split') as LayoutStrategy,
    name: vastuRequested ? 'Vastu-influenced Common-led' : 'Common-led Cluster',
    description: 'Groups living, dining and kitchen through their own shared edges where feasible; private rooms retain distribution access.',
    priority: LAYOUT_STRATEGIES[0]!.priority,
    commonAccess: 'direct_chain' as const,
  };
  return [LAYOUT_STRATEGIES[0]!, { ...LAYOUT_STRATEGIES[1]!, name: 'Split Common / Service',
    description: 'Explores separate common and service banks with shared distribution; exposure is measured, not certified.' },
  reviewedPolygon ? common : vastuRequested ? LAYOUT_STRATEGIES[2]! : { ...common, commonAccess: undefined }];
}

interface ColumnPlacement {
  readonly item: RoomProgramItem;
  readonly minimumHeight: number;
}

interface PlacedRoom {
  readonly item: RoomProgramItem;
  readonly room: Room;
}

interface FloorLayoutResult {
  readonly building: Building;
  readonly placedRooms: readonly PlacedRoom[];
}

interface FloorFootprintPlan {
  readonly leftDepth: number;
  readonly rightDepth: number;
  readonly leftColumn: readonly ColumnPlacement[];
  readonly rightColumn: readonly ColumnPlacement[];
  readonly leftHeights: readonly number[];
  readonly rightHeights: readonly number[];
}

const DOOR_WIDTH_MM = 900;
const WINDOW_WIDTH_MM = 1000;
const OPENING_EDGE_CLEARANCE_MM = 200;

function roundUp(value: number, step = 10): number {
  return Math.ceil(value / step) * step;
}

function requiredCounts(program: RoomProgram): Partial<Record<RoomType, number>> {
  const counts: Partial<Record<RoomType, number>> = {};
  for (const item of program.items) {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
  }
  return counts;
}

export function roomProgramCounts(program: RoomProgram): Partial<Record<RoomType, number>> {
  return requiredCounts(program);
}

function resolvedSetbacks(spec: DesignRequirementSpecification) {
  return spec.setbacksMm ?? {
    front: Math.min(2000, Math.max(1000, Math.round(spec.hard.plotDepthMm * 0.1))),
    rear: Math.min(1500, Math.max(1000, Math.round(spec.hard.plotDepthMm * 0.08))),
    left: Math.min(1200, Math.max(900, Math.round(spec.hard.plotWidthMm * 0.08))),
    right: Math.min(1200, Math.max(900, Math.round(spec.hard.plotWidthMm * 0.08))),
  };
}

function minimumHeight(item: RoomProgramItem, width: number): number {
  return roundUp(Math.max(item.minHeightMm, item.minAreaMm2 / width), 10);
}

function desiredHeight(item: RoomProgramItem, width: number): number {
  const minimum = minimumHeight(item, width);
  if (item.isFixed) return minimum;
  const target = roundUp(Math.max(item.minHeightMm, item.targetAreaMm2 / width), 10);
  const maximum = Math.max(minimum, Math.floor(item.maxAreaMm2 / width));
  return Math.max(minimum, Math.min(target, maximum));
}

function orderItems(items: readonly RoomProgramItem[], profile: LayoutStrategyProfile): RoomProgramItem[] {
  return [...items].sort((a, b) => {
    const priorityA = a.type === RoomType.Staircase ? -100 : a.type === RoomType.Lift ? -90 : profile.priority[a.type] ?? 50;
    const priorityB = b.type === RoomType.Staircase ? -100 : b.type === RoomType.Lift ? -90 : profile.priority[b.type] ?? 50;
    return priorityA - priorityB || b.minAreaMm2 - a.minAreaMm2 || a.id.localeCompare(b.id);
  });
}

function packColumns(
  items: readonly RoomProgramItem[],
  leftWidth: number,
  rightWidth: number,
  depth: number,
  profile: LayoutStrategyProfile,
  graph: InstanceDesignGraph,
): [ColumnPlacement[], ColumnPlacement[]] {
  const columns: [ColumnPlacement[], ColumnPlacement[]] = [[], []];
  const minimumLoads: [number, number] = [0, 0];
  const targetLoads: [number, number] = [0, 0];

  for (const item of orderItems(items, profile)) {
    let candidates = [
      { index: 0 as const, width: leftWidth },
      { index: 1 as const, width: rightWidth },
    ].filter(candidate => candidate.width >= item.minWidthMm);
    if (item.isFixed && candidates.some(candidate => candidate.index === 0)) {
      candidates = candidates.filter(candidate => candidate.index === 0);
    }

    if (candidates.length === 0) {
      throw new Error(`"${item.name}" needs at least ${item.minWidthMm} mm width, but neither layout column can provide it.`);
    }

    candidates.sort((a, b) => {
      const cost = (candidate: { index: 0 | 1; width: number }) => {
        const column = columns[candidate.index];
        const affinity = column.reduce((best, placement) =>
          Math.max(best, relationshipUtility(graph, item, placement.item)),
        -1);
        const zoneMatches = column.filter(placement => placement.item.zone === item.zone).length;
        const projectedLoad = targetLoads[candidate.index] + desiredHeight(item, candidate.width);
        // Keep assignment independent of the provisional floor depth so the
        // sizing pass and final placement pass cannot choose different columns.
        return projectedLoad / 1500 - affinity * 4 - zoneMatches * 0.35;
      };
      return cost(a) - cost(b) || b.width - a.width;
    });

    const fitting = candidates.find(candidate =>
      minimumLoads[candidate.index] + minimumHeight(item, candidate.width) <= depth,
    );
    const target = fitting ?? candidates[0]!;
    const height = minimumHeight(item, target.width);
    columns[target.index].push({ item, minimumHeight: height });
    minimumLoads[target.index] += height;
    targetLoads[target.index] += desiredHeight(item, target.width);
  }

  if (minimumLoads[0] > depth || minimumLoads[1] > depth) {
    // Attempt deterministic load rebalancing before giving up:
    // If one column slightly exceeds depth due to greedy affinity clustering,
    // search for a single move or a single pairwise swap between columns
    // that brings both columns within buildable depth while respecting minWidth constraints.
    const overCol: 0 | 1 = (minimumLoads[0] ?? 0) > depth ? 0 : 1;
    const underCol: 0 | 1 = overCol === 0 ? 1 : 0;
    const colOver = columns[overCol];
    const colUnder = columns[underCol];

    // 1. Try moving a single non-fixed room from overflowing column to under-capacity column
    let balanced = false;
    for (let i = 0; i < colOver.length; i++) {
      const placement = colOver[i]!;
      if (placement.item.isFixed) continue;
      const targetWidth = underCol === 0 ? leftWidth : rightWidth;
      if (targetWidth < placement.item.minWidthMm) continue;
      const hUnder = minimumHeight(placement.item, targetWidth);
      const hOver = placement.minimumHeight;
      const currentUnder = minimumLoads[underCol] ?? 0;
      const currentOver = minimumLoads[overCol] ?? 0;
      if (currentUnder + hUnder <= depth && currentOver - hOver <= depth) {
        colUnder.push({ item: placement.item, minimumHeight: hUnder });
        colOver.splice(i, 1);
        minimumLoads[underCol] = currentUnder + hUnder;
        minimumLoads[overCol] = currentOver - hOver;
        balanced = true;
        break;
      }
    }

    // 2. If single move didn't balance, try a pairwise swap between columns
    if (!balanced) {
      for (let i = 0; i < colOver.length && !balanced; i++) {
        const itemOver = colOver[i]!;
        if (itemOver.item.isFixed) continue;
        const widthUnder = underCol === 0 ? leftWidth : rightWidth;
        if (widthUnder < itemOver.item.minWidthMm) continue;

        for (let j = 0; j < colUnder.length; j++) {
          const itemUnder = colUnder[j]!;
          if (itemUnder.item.isFixed) continue;
          const widthOver = overCol === 0 ? leftWidth : rightWidth;
          if (widthOver < itemUnder.item.minWidthMm) continue;

          const newHOverInUnder = minimumHeight(itemOver.item, widthUnder);
          const newHUnderInOver = minimumHeight(itemUnder.item, widthOver);
          const currentOver = minimumLoads[overCol] ?? 0;
          const currentUnder = minimumLoads[underCol] ?? 0;
          const nextLoadOver = currentOver - itemOver.minimumHeight + newHUnderInOver;
          const nextLoadUnder = currentUnder - itemUnder.minimumHeight + newHOverInUnder;

          if (nextLoadOver <= depth && nextLoadUnder <= depth) {
            colUnder[j] = { item: itemOver.item, minimumHeight: newHOverInUnder };
            colOver[i] = { item: itemUnder.item, minimumHeight: newHUnderInOver };
            minimumLoads[overCol] = nextLoadOver;
            minimumLoads[underCol] = nextLoadUnder;
            balanced = true;
            break;
          }
        }
      }
    }
  }

  if (minimumLoads[0] > depth || minimumLoads[1] > depth) {
    throw new Error('The room program cannot fit the buildable depth while preserving minimum room dimensions.');
  }

  const arrange = (column: ColumnPlacement[]): ColumnPlacement[] => {
    if (column.length < 2) return column;
    const fixed = orderItems(column.filter(placement => placement.item.isFixed).map(placement => placement.item), profile);
    const remaining = column.filter(placement => !placement.item.isFixed);
    const ordered: ColumnPlacement[] = fixed.map(item => column.find(placement => placement.item.id === item.id)!);
    if (ordered.length === 0 && remaining.length > 0) {
      const firstItem = orderItems(remaining.map(placement => placement.item), profile)[0]!;
      const firstIndex = remaining.findIndex(placement => placement.item.id === firstItem.id);
      ordered.push(remaining.splice(firstIndex, 1)[0]!);
    }

    while (remaining.length > 0) {
      const current = ordered.at(-1)!.item;
      remaining.sort((a, b) => {
        const value = (placement: ColumnPlacement) =>
          relationshipUtility(graph, current, placement.item) * 10
          + (current.zone === placement.item.zone ? 1 : 0)
          - (profile.priority[placement.item.type] ?? 50) * 0.001;
        return value(b) - value(a) || a.item.id.localeCompare(b.item.id);
      });
      ordered.push(remaining.shift()!);
    }
    return ordered;
  };

  return [arrange(columns[0]), arrange(columns[1])];
}

function allocatedHeights(column: readonly ColumnPlacement[], width: number, depth: number, fullCoverage = false): number[] {
  if (column.length === 0) return [];
  const minimumTotal = column.reduce((sum, placement) => sum + placement.minimumHeight, 0);
  const desired = column.map(placement => desiredHeight(placement.item, width));
  const desiredTotalHeight = desired.reduce((sum, height) => sum + height, 0);
  if (desiredTotalHeight <= depth) {
    const remaining = depth - desiredTotalHeight;
    const flexibleIndices = column
      .map((p, i) => (!p.item.isFixed && p.item.type !== RoomType.Bathroom && p.item.type !== RoomType.Pooja ? i : -1))
      .filter(i => i >= 0);
    if (fullCoverage && flexibleIndices.length > 0 && remaining > 0) {
      const perRoom = Math.floor(remaining / flexibleIndices.length);
      const remainder = remaining % flexibleIndices.length;
      const heights = [...desired];
      flexibleIndices.forEach((idx, i) => {
        heights[idx] = (heights[idx] ?? 0) + perRoom + (i === 0 ? remainder : 0);
      });
      return heights;
    }
    if (flexibleIndices.length > 0 && remaining > 200) {
      const perRoom = Math.floor(remaining / flexibleIndices.length);
      const heights = [...desired];
      for (const idx of flexibleIndices) {
        const item = column[idx]!.item;
        const currentH = heights[idx] ?? 0;
        const maxH = Math.max(currentH, Math.floor((item.maxAreaMm2 + width * 10) / width));
        const extra = Math.min(perRoom, maxH - currentH);
        if (extra > 0) heights[idx] = currentH + extra;
      }
      return heights;
    }
    if (fullCoverage && remaining > 0) {
      const anyNonFixed = column.map((p, i) => (!p.item.isFixed ? i : -1)).filter(i => i >= 0);
      const targetIndices = anyNonFixed.length > 0 ? anyNonFixed : column.map((_, i) => i);
      const perRoom = Math.floor(remaining / targetIndices.length);
      const remainder = remaining % targetIndices.length;
      const heights = [...desired];
      targetIndices.forEach((idx, i) => {
        heights[idx] = (heights[idx] ?? 0) + perRoom + (i === 0 ? remainder : 0);
      });
      return heights;
    }
    return desired;
  }

  const remaining = Math.max(0, depth - minimumTotal);
  const desiredExtras = desired.map((height, index) =>
    Math.max(0, height - column[index]!.minimumHeight),
  );
  const desiredTotal = desiredExtras.reduce((sum, value) => sum + value, 0);
  return column.map((placement, index) => {
    if (placement.item.isFixed || desiredTotal === 0) return placement.minimumHeight;
    const share = desiredTotal > 0
      ? Math.floor(remaining * (desiredExtras[index]! / desiredTotal))
      : 0;
    return placement.minimumHeight + share;
  });
}

function requiredFloorFootprint(
  items: readonly RoomProgramItem[],
  width: number,
  maximumDepth: number,
  profile: LayoutStrategyProfile,
  graph: InstanceDesignGraph,
  fullCoverage = false,
): FloorFootprintPlan {
  const leftWidth = Math.round(width * profile.columnRatio);
  const rightWidth = width - leftWidth;
  const [leftColumn, rightColumn] = packColumns(items, leftWidth, rightWidth, maximumDepth, profile, graph);
  const leftHeights = allocatedHeights(leftColumn, leftWidth, maximumDepth, fullCoverage);
  const rightHeights = allocatedHeights(rightColumn, rightWidth, maximumDepth, fullCoverage);
  const leftDepth = fullCoverage ? maximumDepth : leftHeights.reduce((sum, value) => sum + value, 0);
  const rightDepth = fullCoverage ? maximumDepth : rightHeights.reduce((sum, value) => sum + value, 0);
  return {
    leftDepth: Math.max(3000, Math.min(maximumDepth, leftDepth)),
    rightDepth: Math.max(3000, Math.min(maximumDepth, rightDepth)),
    leftColumn,
    rightColumn,
    leftHeights,
    rightHeights,
  };
}

function footprintBoundary(
  x: number,
  y: number,
  width: number,
  leftWidth: number,
  footprint: FloorFootprintPlan,
) {
  if (footprint.leftDepth === footprint.rightDepth) {
    return { points: [
      { x, y }, { x: x + width, y },
      { x: x + width, y: y + footprint.leftDepth }, { x, y: y + footprint.leftDepth },
    ] };
  }
  return { points: [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + footprint.rightDepth },
    { x: x + leftWidth, y: y + footprint.rightDepth },
    { x: x + leftWidth, y: y + footprint.leftDepth },
    { x, y: y + footprint.leftDepth },
  ] };
}

function openingStart(segmentStart: number, segmentLength: number, openingWidth: number): number {
  const centered = segmentStart + Math.floor((segmentLength - openingWidth) / 2);
  return Math.max(
    segmentStart + OPENING_EDGE_CLEARANCE_MM,
    Math.min(centered, segmentStart + segmentLength - openingWidth - OPENING_EDGE_CLEARANCE_MM),
  );
}

function addPerimeterWalls(
  building: Building,
  floorId: string,
  x: number,
  y: number,
  width: number,
  leftWidth: number,
  leftDepth: number,
  rightDepth: number,
): { building: Building; north: Wall; east: Wall; south: Wall; west: Wall } {
  let next = building;
  const add = (startPoint: { x: number; y: number }, endPoint: { x: number; y: number }) => {
    next = addWall(next, floorId, {
      floorId,
      startPoint,
      endPoint,
      type: WallType.External,
      thickness: 230,
    });
    return next.floors.find(floor => floor.id === floorId)!.walls.at(-1)!;
  };

  const north = add({ x, y }, { x: x + width, y });
  const east = add({ x: x + width, y }, { x: x + width, y: y + rightDepth });
  const rightSouth = add(
    { x: x + leftWidth, y: y + rightDepth },
    { x: x + width, y: y + rightDepth },
  );
  if (leftDepth !== rightDepth) {
    add(
      { x: x + leftWidth, y: y + Math.min(leftDepth, rightDepth) },
      { x: x + leftWidth, y: y + Math.max(leftDepth, rightDepth) },
    );
  }
  const leftSouth = add({ x, y: y + leftDepth }, { x: x + leftWidth, y: y + leftDepth });
  const west = add({ x, y }, { x, y: y + leftDepth });
  const south = leftDepth >= rightDepth ? leftSouth : rightSouth;
  return { building: next, north, east, south, west };
}

function roomTouchingEdge(
  rooms: readonly PlacedRoom[],
  direction: Direction,
  x: number,
  y: number,
  width: number,
  depth: number,
): Room {
  const epsilon = 1;
  const touching = rooms.filter(({ room }) => {
    if (direction === Direction.North) return Math.abs(room.y - y) <= epsilon;
    if (direction === Direction.South) return Math.abs(room.y + room.height - (y + depth)) <= epsilon;
    if (direction === Direction.East) return Math.abs(room.x + room.width - (x + width)) <= epsilon;
    return Math.abs(room.x - x) <= epsilon;
  });
  const preferred = touching.find(({ room }) => room.type === RoomType.Living)
    ?? touching.find(({ room }) => room.type === RoomType.Foyer)
    ?? touching.find(({ room }) => room.type === RoomType.Dining)
    ?? touching.find(({ room }) => room.type === RoomType.Drawing)
    ?? touching.find(({ room }) => room.type !== RoomType.Bathroom && room.type !== RoomType.Bedroom)
    ?? touching[0]
    ?? rooms[0]!;
  return preferred.room;
}

function addEntrance(
  building: Building,
  floorId: string,
  room: Room,
  direction: Direction,
  walls: { north: Wall; east: Wall; south: Wall; west: Wall },
): Building {
  const horizontal = direction === Direction.North || direction === Direction.South;
  const wall = direction === Direction.North
    ? walls.north
    : direction === Direction.South
      ? walls.south
      : direction === Direction.East
        ? walls.east
        : walls.west;
  const position = horizontal
    ? { x: openingStart(room.x, room.width, DOOR_WIDTH_MM), y: wall.startPoint.y }
    : { x: wall.startPoint.x, y: openingStart(room.y, room.height, DOOR_WIDTH_MM) };
  return addDoor(building, floorId, {
    floorId,
    wallId: wall.id,
    position,
    width: DOOR_WIDTH_MM,
    height: 2100,
    type: DoorType.Single,
    connectsRooms: ['__outside__', room.id],
  });
}

function addExternalWindows(
  building: Building,
  floorId: string,
  leftRooms: readonly PlacedRoom[],
  rightRooms: readonly PlacedRoom[],
  westWall: Wall,
  eastWall: Wall,
): Building {
  let next = building;
  const addForColumn = (rooms: readonly PlacedRoom[], wall: Wall) => {
    for (const { item, room } of rooms) {
      if (!item.ventilationRequired && item.daylight === 'none') continue;
      const windowWidth = Math.min(WINDOW_WIDTH_MM, room.height - OPENING_EDGE_CLEARANCE_MM * 2);
      if (windowWidth <= 0) continue;
      next = addWindow(next, floorId, {
        floorId,
        wallId: wall.id,
        position: {
          x: wall.startPoint.x,
          y: openingStart(room.y, room.height, windowWidth),
        },
        width: windowWidth,
        height: 1200,
        sillHeight: 900,
        type: WindowType.Sliding,
        roomId: room.id,
      });
    }
  };
  addForColumn(leftRooms, westWall);
  addForColumn(rightRooms, eastWall);
  return next;
}

export class StructuredLayoutGenerator {
  private readonly floorPlanner = new FloorProgramPlanner();

  generate(
    spec: DesignRequirementSpecification,
    program: RoomProgram,
    profile: LayoutStrategyProfile,
    graph: InstanceDesignGraph,
  ): Building {
    const isFullPlot = !!spec.hard.fullPlotCoverage;
    const setbacks = isFullPlot
      ? { front: 0, rear: 0, left: 0, right: 0 }
      : resolvedSetbacks(spec);
    const x = setbacks.left;
    const y = setbacks.front;
    let width = spec.hard.plotWidthMm - setbacks.left - setbacks.right;
    const depth = spec.hard.plotDepthMm - setbacks.front - setbacks.rear;
    if (width < 3000 || depth < 3000) {
      throw new Error('Buildable envelope is too small for structured residential generation.');
    }

    const floorsCount = Math.max(1, spec.hard.floorsCount);
    const allocation = this.floorPlanner.allocateDetailed(program, floorsCount, {
      availableAreaMm2: width * depth,
      requireOccupiedFloor: true,
      distributionStrategy: profile.strategy === 'open_circulation'
        ? 'ground_guest'
        : profile.strategy === 'vastu_aligned'
          ? 'top_master'
          : 'upper_private',
    });

    // Determine active floor items:
    // Outdoor spaces (parking, garden) are site-level amenities provided by SitePlanner.
    // If packing them as enclosed rooms inside the building causes the floor to exceed buildable depth,
    // defer them to the site zones so the residential building can be planned without failure.
    let activeFloorItems = allocation.floors;
    const testFit = (floors: readonly (readonly RoomProgramItem[])[]) => {
      try {
        floors.forEach((items, floorLevel) => requiredFloorFootprint(items, width, depth, profile, graph, isFullPlot && floorLevel === 0));
        return true;
      } catch {
        return false;
      }
    };

    if (!testFit(activeFloorItems)) {
      const withoutParking = activeFloorItems.map(items => items.filter(i => i.type !== RoomType.Parking));
      if (testFit(withoutParking)) {
        activeFloorItems = withoutParking;
      } else {
        const withoutOutdoor = activeFloorItems.map(items => items.filter(i => i.zone !== FunctionalZone.Outdoor && i.type !== RoomType.Parking && i.type !== RoomType.Garden));
        if (testFit(withoutOutdoor)) {
          activeFloorItems = withoutOutdoor;
        }
      }
    }

    const planAtWidth = (trialWidth: number) => activeFloorItems.map((items, floorLevel) => {
      try {
        const fullCoverage = isFullPlot && floorLevel === 0;
        return requiredFloorFootprint(items, trialWidth, depth, profile, graph, fullCoverage);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`PARTIAL_GENERATION_FAILURE: Floor ${floorLevel} sizing failed. ${reason}`);
      }
    });
    let floorFootprints = planAtWidth(width);
    // A large site is not an instruction to stretch every room across it.
    // Only the automatic (non-reviewed-footprint) generator takes this path.
    const fitsProgramAreas = (plans: readonly FloorFootprintPlan[], trialWidth: number) => {
      const left = Math.round(trialWidth * profile.columnRatio);
      return plans.every(plan => [
        { column: plan.leftColumn, heights: plan.leftHeights, width: left },
        { column: plan.rightColumn, heights: plan.rightHeights, width: trialWidth - left },
      ].every(bank => bank.column.every((placement, index) =>
        bank.width * bank.heights[index]! <= placement.item.maxAreaMm2 + bank.width * 10,
      )));
    };
    if (!isFullPlot && !fitsProgramAreas(floorFootprints, width)) {
      // Bounded deterministic width search, not a new placement/ranking engine.
      // Derive the upper bound from this Program, not the size of the land.
      const activeItems = activeFloorItems.flat();
      const maxRoomWidth = Math.max(...activeItems.map(item => item.maxAreaMm2 / Math.max(item.minHeightMm, 1)));
      const upper = Math.min(width, maxRoomWidth / Math.min(profile.columnRatio, 1 - profile.columnRatio));
      const step = Math.max(100, roundUp((upper - 3000) / 96, 100));
      const trialWidths = new Set<number>();
      for (let trial = 3000; trial <= upper; trial += step) trialWidths.add(trial);
      // Include exact Program thresholds: coarse sampling can otherwise miss a
      // narrow interval between a large bedroom minimum and a small pooja maximum.
      for (const item of activeItems) for (const ratio of [profile.columnRatio, 1 - profile.columnRatio]) {
        const low = Math.ceil(item.minWidthMm / ratio);
        const high = Math.floor(item.maxAreaMm2 / Math.max(item.minHeightMm, 1) / ratio);
        for (const value of [low, low + 1, high, high - 1]) if (value >= 3000 && value <= upper) trialWidths.add(value);
      }
      let proposal: { width: number; plans: FloorFootprintPlan[] } | undefined;
      for (const trial of [...trialWidths].sort((a, b) => b - a)) {
        try {
          const plans = planAtWidth(trial);
          if (fitsProgramAreas(plans, trial)) { proposal = { width: trial, plans }; break; }
        } catch { /* This width cannot hold the unchanged room minima; try the next bounded width. */ }
      }
      if (!proposal) throw new Error('PROGRAM_FOOTPRINT_REQUIRED: No automatic footprint fits the requested room dimensions and maximum areas. Review the Program and define a building footprint; the plot will not be filled by stretching rooms.');
      width = proposal.width;
      floorFootprints = proposal.plans;
    }
    const leftWidth = Math.round(width * profile.columnRatio);
    const footDepth = Math.max(...floorFootprints.map(p => Math.max(p.leftDepth, p.rightDepth)));
    const extraDepth = Math.max(0, depth - footDepth);
    const parkingRequested = spec.hard.parkingRequired || spec.hard.parkingSpacesCount > 0;
    const frontBuffer = (!isFullPlot && spec.hard.roadFacing === Direction.North && parkingRequested && extraDepth >= 2000)
      ? Math.min(extraDepth, Math.max(2000, Math.min(3000, extraDepth - 1000)))
      : 0;
    const buildingY = y + frontBuffer;

    const building = createBuilding({
      projectId: spec.projectId ?? `generated_${profile.strategy}`,
      name: `${spec.projectName} — ${profile.name}`,
      site: {
        plotWidth: spec.hard.plotWidthMm,
        plotDepth: spec.hard.plotDepthMm,
        orientation: spec.orientationDegrees,
        plotShape: spec.plotShape,
        roadFacing: spec.hard.roadFacing,
        setbacks,
      },
      floors: Array.from({ length: floorsCount }, (_, level) => ({
        buildingId: '',
        level,
        name: level === 0 ? 'Ground Floor' : `Floor ${level}`,
        boundary: footprintBoundary(x, buildingY, width, leftWidth, floorFootprints[level]!),
      })),
    });

    let next = building;
    for (let floorLevel = 0; floorLevel < floorsCount; floorLevel++) {
      const floor = next.floors.find(candidate => candidate.level === floorLevel)!;
      let result: FloorLayoutResult;
      try {
        result = this.layoutFloor(
          next,
          floor.id,
          profile,
          x,
          buildingY,
          width,
          floorFootprints[floorLevel]!,
          floorLevel === 0 ? spec.hard.roadFacing : Direction.North,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`PARTIAL_GENERATION_FAILURE: Floor ${floorLevel} could not be generated. ${reason}`);
      }
      next = result.building;

      if (floorsCount > 1) {
        const staircaseRoom = result.placedRooms.find(placed => placed.room.type === RoomType.Staircase)?.room;
        if (!staircaseRoom) {
          throw new Error(`Floor ${floorLevel} is missing its required staircase shaft.`);
        }
        const fromLevel = floorLevel === floorsCount - 1 ? floorLevel - 1 : floorLevel;
        const toLevel = floorLevel === floorsCount - 1 ? floorLevel : floorLevel + 1;
        next = addStair(next, floor.id, {
          floorId: floor.id,
          x: staircaseRoom.x,
          y: staircaseRoom.y,
          width: Math.min(1200, staircaseRoom.width),
          length: Math.min(3000, staircaseRoom.height),
          direction: Direction.North,
          connectsFloors: [fromLevel, toLevel],
          verticalCoreId: 'primary-stair-core',
        });
      }
    }

    return next;
  }

  private layoutFloor(
    building: Building,
    floorId: string,
    profile: LayoutStrategyProfile,
    x: number,
    y: number,
    width: number,
    footprint: FloorFootprintPlan,
    entranceDirection: Direction,
  ): FloorLayoutResult {
    const leftWidth = Math.round(width * profile.columnRatio);
    const rightWidth = width - leftWidth;
    const maximumDepth = Math.max(footprint.leftDepth, footprint.rightDepth);
    const leftColumn = footprint.leftColumn;
    const rightColumn = footprint.rightColumn;
    const leftHeights = footprint.leftHeights;
    const rightHeights = footprint.rightHeights;
    let next = building;

    const placeColumn = (
      column: readonly ColumnPlacement[],
      heights: readonly number[],
      columnX: number,
      columnWidth: number,
    ): PlacedRoom[] => {
      let cursorY = y;
      const placed: PlacedRoom[] = [];
      column.forEach((placement, index) => {
        const height = heights[index]!;
        next = addRoom(next, floorId, {
          floorId,
          type: placement.item.type,
          name: placement.item.name,
          x: columnX,
          y: cursorY,
          width: columnWidth,
          height,
          daylightRequirement: placement.item.daylight,
          privacyRequirement: placement.item.privacy,
          ventilationRequired: placement.item.ventilationRequired,
          isFixed: placement.item.isFixed,
          tags: [
            `program:${placement.item.id}`,
            `zone:${placement.item.zone}`,
            `strategy:${profile.strategy}`,
          ],
        });
        const room = next.floors.find(floor => floor.id === floorId)!.rooms.at(-1)!;
        placed.push({ item: placement.item, room });
        cursorY += height;
      });
      return placed;
    };

    const leftRooms = placeColumn(leftColumn, leftHeights, x, leftWidth);
    const rightRooms = placeColumn(rightColumn, rightHeights, x + leftWidth, rightWidth);
    const allRooms = [...leftRooms, ...rightRooms];
    const perimeter = addPerimeterWalls(
      next, floorId, x, y, width, leftWidth, footprint.leftDepth, footprint.rightDepth,
    );
    next = perimeter.building;

    let centerWall: Wall | undefined;
    if (leftRooms.length > 0 && rightRooms.length > 0) {
      next = addWall(next, floorId, {
        floorId,
        startPoint: { x: x + leftWidth, y },
        endPoint: { x: x + leftWidth, y: y + Math.min(footprint.leftDepth, footprint.rightDepth) },
        type: WallType.Internal,
        thickness: 115,
        roomIds: [leftRooms[0]!.room.id, rightRooms[0]!.room.id],
      });
      centerWall = next.floors.find(floor => floor.id === floorId)!.walls.at(-1)!;
    }

    const connectColumn = (rooms: readonly PlacedRoom[]) => {
      for (let index = 0; index < rooms.length - 1; index++) {
        const current = rooms[index]!.room;
        const nextRoom = rooms[index + 1]!.room;
        const boundaryY = current.y + current.height;
        next = addWall(next, floorId, {
          floorId,
          startPoint: { x: current.x, y: boundaryY },
          endPoint: { x: current.x + current.width, y: boundaryY },
          type: WallType.Internal,
          thickness: 115,
          roomIds: [current.id, nextRoom.id],
        });
        const wall = next.floors.find(floor => floor.id === floorId)!.walls.at(-1)!;
        next = addDoor(next, floorId, {
          floorId,
          wallId: wall.id,
          position: { x: openingStart(current.x, current.width, DOOR_WIDTH_MM), y: boundaryY },
          width: DOOR_WIDTH_MM,
          height: 2100,
          type: DoorType.Single,
          connectsRooms: [current.id, nextRoom.id],
        });
      }
    };
    connectColumn(leftRooms);
    connectColumn(rightRooms);

    if (centerWall && leftRooms[0] && rightRooms[0]) {
      const sharedHeight = Math.min(leftRooms[0].room.height, rightRooms[0].room.height);
      next = addDoor(next, floorId, {
        floorId,
        wallId: centerWall.id,
        position: { x: x + leftWidth, y: openingStart(y, sharedHeight, DOOR_WIDTH_MM) },
        width: DOOR_WIDTH_MM,
        height: 2100,
        type: DoorType.Single,
        connectsRooms: [leftRooms[0].room.id, rightRooms[0].room.id],
      });
    }

    const entranceRoom = roomTouchingEdge(allRooms, entranceDirection, x, y, width, maximumDepth);
    next = addEntrance(next, floorId, entranceRoom, entranceDirection, perimeter);
    next = addExternalWindows(next, floorId, leftRooms, rightRooms, perimeter.west, perimeter.east);

    return { building: next, placedRooms: allRooms };
  }
}

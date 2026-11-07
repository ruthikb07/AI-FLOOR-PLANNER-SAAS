import type {
  Building, DesignRequirementSpecification, Floor, InstanceDesignGraph, Point, Polygon,
  Room, RoomProgram, RoomProgramItem, Wall,
} from '@ai-floor-planner/core';
import {
  Direction, DoorType, MINIMUM_DIMENSIONS, MINIMUM_ROOM_AREAS, RoomType, WallType, WindowType,
  addDoor, addRoom, addStair, addWall, addWindow, createBuilding,
} from '@ai-floor-planner/core';
import { polygonArea } from '@ai-floor-planner/geometry-engine';
import { FloorProgramPlanner } from '../multi-floor/planner';
import type { LayoutStrategyProfile } from './structured-layout';
import {
  decomposeOrthogonalIntersection, decomposeOrthogonalPolygon, sharedRegionEdge, subtractRegions,
} from '../regions/orthogonal-decomposition';
import type { PlanningRegion, SharedRegionEdge } from '../regions/orthogonal-decomposition';

type PlacementProfile = LayoutStrategyProfile & { readonly architectural?: boolean };

const DOOR_WIDTH_MM = 900;
const WINDOW_WIDTH_MM = 1000;
const EDGE_CLEARANCE_MM = 250;
const EPSILON = 0.01;
const CORE_TYPES = new Set([RoomType.Staircase, RoomType.Lift]);

interface RoomPlacement extends PlanningRegion {
  readonly item: RoomProgramItem;
  readonly room: Room;
}

interface CorePlacement extends PlanningRegion {
  readonly sourceId: string;
  readonly type: RoomType;
}

function itemMinimum(item: RoomProgramItem): { width: number; height: number } {
  const minimumArea = Math.max(item.minAreaMm2, MINIMUM_ROOM_AREAS[item.type] ?? 0);
  const minimumDimension = MINIMUM_DIMENSIONS[item.type] ?? 0;
  const width = Math.max(item.minWidthMm, minimumDimension);
  let height = Math.max(item.minHeightMm, minimumDimension, Math.ceil(minimumArea / width));
  if (width * height < minimumArea) height = Math.ceil(minimumArea / width);
  return { width, height };
}

function corePlacements(
  polygons: readonly Polygon[],
  items: readonly RoomProgramItem[],
  profile: PlacementProfile,
): CorePlacement[] {
  if (!items.length) return [];
  // Prefer the smallest region that comfortably contains the core. This
  // preserves broad wing/bar regions for occupiable rooms.
  const common = decomposeOrthogonalIntersection(polygons).sort((a, b) => a.area - b.area || a.y - b.y || a.x - b.x);
  const dimensions = items.map(item => ({ item, ...itemMinimum(item) }));
  for (const region of common) {
    const rowWidth = dimensions.reduce((sum, item) => sum + item.width, 0);
    const rowHeight = Math.max(...dimensions.map(item => item.height));
    if (rowWidth <= region.width && rowHeight <= region.height) {
      let x = profile.strategy === 'vastu_aligned' || profile.strategy === 'linear_split' ? region.x + region.width - rowWidth : region.x;
      const y = profile.strategy === 'open_circulation' ? region.y + region.height - rowHeight : region.y;
      return dimensions.map(({ item, width, height }, index) => {
        const placement = { id: `core_${index + 1}`, sourceId: item.id, type: item.type, x, y, width, height, area: width * height };
        x += width;
        return placement;
      });
    }
    const columnWidth = Math.max(...dimensions.map(item => item.width));
    const columnHeight = dimensions.reduce((sum, item) => sum + item.height, 0);
    if (columnWidth <= region.width && columnHeight <= region.height) {
      const x = profile.strategy === 'vastu_aligned' || profile.strategy === 'linear_split' ? region.x + region.width - columnWidth : region.x;
      let y = profile.strategy === 'open_circulation' ? region.y + region.height - columnHeight : region.y;
      return dimensions.map(({ item, width, height }, index) => {
        const placement = { id: `core_${index + 1}`, sourceId: item.id, type: item.type, x, y, width, height, area: width * height };
        y += height;
        return placement;
      });
    }
  }
  throw new Error('CORE_CONTINUITY_FAILURE: No common region across all floor plates can contain the required vertical core.');
}

function fitsItem(item: RoomProgramItem, region: Pick<PlanningRegion, 'width' | 'height'>): boolean {
  const minimum = itemMinimum(item);
  const minimumArea = Math.max(item.minAreaMm2, MINIMUM_ROOM_AREAS[item.type] ?? 0);
  const normal = region.width + EPSILON >= minimum.width && region.height + EPSILON >= minimum.height;
  const rotated = region.width + EPSILON >= minimum.height && region.height + EPSILON >= minimum.width;
  return (normal || rotated) && region.width * region.height + EPSILON >= minimumArea;
}

type PackedRegion = PlanningRegion & { item: RoomProgramItem };

function guillotinePack(
  items: readonly RoomProgramItem[],
  region: PlanningRegion,
  profile: PlacementProfile,
  floorLevel: number,
  depth = 0,
): PackedRegion[] | undefined {
  if (!items.length) return [];
  if (items.length === 1) return fitsItem(items[0]!, region) ? [{ ...region, item: items[0]! }] : undefined;
  if (depth > 12) return undefined;
  const totalTarget = items.reduce((sum, item) => sum + item.targetAreaMm2, 0);
  const preferredAxis = profile.strategy === 'open_circulation'
    ? ((floorLevel + depth) % 2 === 0 ? 'horizontal' : 'vertical')
    : profile.strategy === 'vastu_aligned' ? 'horizontal' : (region.width >= region.height ? 'vertical' : 'horizontal');
  const axes: readonly ('vertical' | 'horizontal')[] = preferredAxis === 'vertical'
    ? ['vertical', 'horizontal'] : ['horizontal', 'vertical'];

  // Balanced groups avoid repeatedly peeling a single full-width sliver from
  // a large region. Feasibility still uses the existing dimensional checks.
  const splits = Array.from({ length: items.length - 1 }, (_, index) => index + 1)
    .sort((a, b) => !profile.architectural ? a - b : Math.abs(items.slice(0, a).reduce((sum, item) => sum + item.targetAreaMm2, 0) / totalTarget - 0.5)
      - Math.abs(items.slice(0, b).reduce((sum, item) => sum + item.targetAreaMm2, 0) / totalTarget - 0.5) || a - b);
  for (const split of splits) {
    const firstItems = items.slice(0, split);
    const secondItems = items.slice(split);
    // Keep a requested suite in one region until that suite itself is being
    // subdivided. Individual type sorting previously separated owners and baths.
    const owners = new Set(items.map(item => item.attachedToRoomId).filter(Boolean));
    const suiteOnly = owners.size === 1 && items.every(item => owners.has(item.id) || owners.has(item.attachedToRoomId));
    if (profile.architectural && !suiteOnly && items.some(item => item.attachedToRoomId && items.some(owner => owner.id === item.attachedToRoomId)
      && firstItems.includes(item) !== firstItems.some(owner => owner.id === item.attachedToRoomId))) continue;
    const targetRatio = firstItems.reduce((sum, item) => sum + item.targetAreaMm2, 0) / totalTarget;
    for (const axis of axes) {
      const cutLength = axis === 'vertical' ? region.width : region.height;
      const crossLength = axis === 'vertical' ? region.height : region.width;
      const lowerBound = (group: readonly RoomProgramItem[]) => {
        const areaBound = group.reduce((sum, item) => sum + Math.max(item.minAreaMm2, MINIMUM_ROOM_AREAS[item.type] ?? 0), 0)
          / Math.max(1, cutLength * crossLength);
        if (group.length !== 1) return areaBound;
        const minimum = itemMinimum(group[0]!);
        const dimensionBound = Math.min(minimum.width, minimum.height) / cutLength;
        return Math.max(areaBound, dimensionBound);
      };
      const firstMinimum = lowerBound(firstItems);
      const secondMaximum = 1 - lowerBound(secondItems);
      const ratios = [...new Set([
        targetRatio, firstMinimum, secondMaximum, (firstMinimum + secondMaximum) / 2,
      ].map(value => Math.max(0.05, Math.min(0.95, value))))];
      for (const ratio of ratios) {
        const first = axis === 'vertical'
          ? { ...region, id: `${region.id}_a`, width: region.width * ratio, area: region.area * ratio }
          : { ...region, id: `${region.id}_a`, height: region.height * ratio, area: region.area * ratio };
        const second = axis === 'vertical'
          ? { ...region, id: `${region.id}_b`, x: region.x + first.width, width: region.width - first.width, area: region.area - first.area }
          : { ...region, id: `${region.id}_b`, y: region.y + first.height, height: region.height - first.height, area: region.area - first.area };
        const firstPacked = guillotinePack(firstItems, first, profile, floorLevel, depth + 1);
        if (!firstPacked) continue;
        const secondPacked = guillotinePack(secondItems, second, profile, floorLevel, depth + 1);
        if (secondPacked) return [...firstPacked, ...secondPacked];
      }
    }
  }
  return undefined;
}

function regionOrder(
  regions: readonly PlanningRegion[],
  profile: PlacementProfile,
  anchors: readonly PlanningRegion[] = [],
): PlanningRegion[] {
  if (!regions.length) return [];
  const preferred = [...regions].sort((a, b) => {
    if (profile.strategy === 'open_circulation') return a.y - b.y || a.x - b.x || b.area - a.area;
    if (profile.strategy === 'vastu_aligned') return b.x - a.x || b.y - a.y || b.area - a.area;
    return b.area - a.area || a.y - b.y || a.x - b.x;
  });
  const anchor = preferred.find(region => anchors.some(value => sharedRegionEdge(region, value))) ?? preferred[0]!;
  const ordered: PlanningRegion[] = [anchor];
  const remaining = preferred.filter(region => region.id !== anchor.id);
  while (remaining.length) {
    const adjacentIndex = remaining.findIndex(region => ordered.some(existing => sharedRegionEdge(existing, region)));
    if (adjacentIndex < 0) {
      ordered.push(...remaining);
      break;
    }
    ordered.push(remaining.splice(adjacentIndex, 1)[0]!);
  }
  return ordered;
}

function orderItems(items: readonly RoomProgramItem[], profile: PlacementProfile): RoomProgramItem[] {
  const ordered = [...items].sort((a, b) => {
    const aPriority = a.type === RoomType.Corridor ? -50 : profile.priority[a.type] ?? 50;
    const bPriority = b.type === RoomType.Corridor ? -50 : profile.priority[b.type] ?? 50;
    return aPriority - bPriority || b.minAreaMm2 - a.minAreaMm2 || a.id.localeCompare(b.id);
  });
  if (!profile.architectural) return ordered;
  const result: RoomProgramItem[] = [];
  const append = (item: RoomProgramItem) => { if (!result.includes(item)) result.push(item); };
  for (const item of ordered) {
    if (item.attachedToRoomId && items.some(owner => owner.id === item.attachedToRoomId)) continue;
    append(item);

    if (item.type === RoomType.Bedroom) ordered.filter(bath => bath.attachedToRoomId === item.id).forEach(append);
    if (item.type === RoomType.Kitchen) ordered.filter(service => service.type === RoomType.Utility
      || (service.type === RoomType.Storage && !service.attachedToRoomId)).forEach(append);
  }
  return result;
}

function assignToRegions(
  items: readonly RoomProgramItem[],
  availableRegions: readonly PlanningRegion[],
  profile: PlacementProfile,
  floorLevel: number,
  anchors: readonly PlanningRegion[],
): { region: PlanningRegion; items: readonly RoomProgramItem[] }[] {
  const orderedItems = orderItems(items, profile);
  const orderedRegions = regionOrder(availableRegions.filter(region => region.width >= 900 && region.height >= 900), profile, anchors);
  const search = (regionCount: number) => {
    const regions = orderedRegions.slice(0, regionCount);
    const groups = regions.map(() => [] as RoomProgramItem[]);
    const units = !profile.architectural ? orderedItems.map(item => [item]) : orderedItems.filter(item => !item.attachedToRoomId || !items.some(owner => owner.id === item.attachedToRoomId))
      .map(item => [item, ...orderedItems.filter(bath => bath.attachedToRoomId === item.id)]);
    const visit = (index: number): boolean => {
      if (index === units.length) return groups.every(group => group.length > 0);
      const unit = units[index]!;
      const candidates = regions.map((region, regionIndex) => ({
        regionIndex,
        empty: groups[regionIndex]!.length === 0,
        load: groups[regionIndex]!.reduce((sum, value) => sum + value.targetAreaMm2, 0) / region.area,
      })).filter(candidate => guillotinePack([...groups[candidate.regionIndex]!, ...unit], regions[candidate.regionIndex]!, profile, floorLevel) !== undefined)
        .sort((a, b) => Number(a.empty) - Number(b.empty) || a.load - b.load || a.regionIndex - b.regionIndex);
      for (const candidate of candidates) {
        groups[candidate.regionIndex]!.push(...unit);
        if (visit(index + 1)) return true;
        groups[candidate.regionIndex]!.splice(-unit.length);
      }
      return false;
    };
    return visit(0) ? regions.map((region, index) => ({ region, items: groups[index]! })) : undefined;
  };

  for (let count = 1; count <= Math.min(orderedRegions.length, orderedItems.length); count += 1) {
    const result = search(count);
    if (result) return result;
  }
  const regionEvidence = orderedRegions.map(region => `${Math.round(region.width)}x${Math.round(region.height)}`).join(', ');
  const itemEvidence = orderedItems.map(item => `${item.name} (${Math.round(item.minAreaMm2 / 1e6)}m²)`).join(', ');
  throw new Error(`POLYGON_PACKING_FAILURE: The allocated rooms cannot fit the available planning regions while preserving minimum dimensions. Regions: ${regionEvidence || 'none'}. Rooms: ${itemEvidence}.`);
}

function partitionRegion(
  region: PlanningRegion,
  items: readonly RoomProgramItem[],
  profile: PlacementProfile,
  floorLevel: number,
): (PlanningRegion & { item: RoomProgramItem })[] {
  const packed = guillotinePack(items, region, profile, floorLevel);
  if (!packed) throw new Error('POLYGON_PACKING_FAILURE: A planning region cannot satisfy its assigned room dimensions.');
  return packed;
}

function sharedRoomEdge(a: Pick<PlanningRegion, 'x' | 'y' | 'width' | 'height'>, b: Pick<PlanningRegion, 'x' | 'y' | 'width' | 'height'>): SharedRegionEdge | undefined {
  return sharedRegionEdge({ ...a, id: 'a', area: a.width * a.height }, { ...b, id: 'b', area: b.width * b.height });
}

function openingPosition(edge: SharedRegionEdge, width: number): Point {
  if (edge.orientation === 'horizontal') return { x: edge.start.x + (edge.length - width) / 2, y: edge.start.y };
  return { x: edge.start.x, y: edge.start.y + (edge.length - width) / 2 };
}

function openingPositionOnWall(wall: Wall, edge: SharedRegionEdge, width: number): Point {
  const midpoint = { x: (edge.start.x + edge.end.x) / 2, y: (edge.start.y + edge.end.y) / 2 };
  const length = Math.hypot(wall.endPoint.x - wall.startPoint.x, wall.endPoint.y - wall.startPoint.y);
  const dx = (wall.endPoint.x - wall.startPoint.x) / length;
  const dy = (wall.endPoint.y - wall.startPoint.y) / length;
  return { x: midpoint.x - dx * width / 2, y: midpoint.y - dy * width / 2 };
}

function exteriorExposure(room: Pick<PlanningRegion, 'x' | 'y' | 'width' | 'height'>, polygon: Polygon): { edge: SharedRegionEdge; index: number } | undefined {
  for (let index = 0; index < polygon.points.length; index += 1) {
    const start = polygon.points[index]!;
    const end = polygon.points[(index + 1) % polygon.points.length]!;
    if (Math.abs(start.y - end.y) <= EPSILON) {
      const y = start.y;
      if (Math.abs(room.y - y) > EPSILON && Math.abs(room.y + room.height - y) > EPSILON) continue;
      const from = Math.max(room.x, Math.min(start.x, end.x));
      const to = Math.min(room.x + room.width, Math.max(start.x, end.x));
      if (to - from > EPSILON) return { index, edge: { orientation: 'horizontal', start: { x: from, y }, end: { x: to, y }, length: to - from } };
    } else if (Math.abs(start.x - end.x) <= EPSILON) {
      const x = start.x;
      if (Math.abs(room.x - x) > EPSILON && Math.abs(room.x + room.width - x) > EPSILON) continue;
      const from = Math.max(room.y, Math.min(start.y, end.y));
      const to = Math.min(room.y + room.height, Math.max(start.y, end.y));
      if (to - from > EPSILON) return { index, edge: { orientation: 'vertical', start: { x, y: from }, end: { x, y: to }, length: to - from } };
    }
  }
  return undefined;
}

/** A distribution spine is placed before rooms, not left over after packing.
 * Applicable to a broad rectangular region meeting the existing vertical core.
 * Concave/narrow cases retain the established polygon feasibility path. */
function anchoredPacking(items: readonly RoomProgramItem[], available: readonly PlanningRegion[], core: readonly CorePlacement[],
  profile: PlacementProfile, level: number): PackedRegion[] | undefined {
  if (!profile.architectural) return undefined;
  const circulation = items.find(item => item.type === RoomType.Corridor);
  const region = [...available].sort((a, b) => b.area - a.area)[0];
  if (!circulation || !region || region.width < 9000 || region.height < 9000) return undefined;
  const coreEdge = core.map(value => sharedRegionEdge(region, value)).find(edge => edge?.orientation === 'horizontal');
  if (!coreEdge) return undefined;
  const fromBottom = Math.abs(coreEdge.start.y - (region.y + region.height)) < EPSILON;
  const header = 1200;
  const spine = 1200;
  const leftWidth = (region.width - spine) * profile.columnRatio;
  const depth = region.height - header;
  const y = region.y + (fromBottom ? 0 : header);
  const ordered = orderItems(items.filter(item => item !== circulation), profile);
  const units = ordered.filter(item => !item.attachedToRoomId || !ordered.some(owner => owner.id === item.attachedToRoomId))
    .map(item => [item, ...ordered.filter(bath => bath.attachedToRoomId === item.id)]);
  const total = units.reduce((sum, unit) => sum + unit.reduce((area, item) => area + item.targetAreaMm2, 0), 0);
  const cuts = Array.from({ length: units.length - 1 }, (_, index) => index + 1).sort((a, b) =>
    Math.abs(units.slice(0, a).flat().reduce((sum, item) => sum + item.targetAreaMm2, 0) / total - 0.5)
    - Math.abs(units.slice(0, b).flat().reduce((sum, item) => sum + item.targetAreaMm2, 0) / total - 0.5));
  for (const [reserveMinimum, cut] of [false, true].flatMap(reserve => cuts.map(cut => [reserve, cut] as const))) {
    const sides = [units.slice(0, cut), units.slice(cut)];
    if (profile.strategy === 'open_circulation') sides.reverse();
    const result: PackedRegion[] = [
      { id: `${region.id}_spine`, x: region.x + leftWidth, y, width: spine, height: depth,
        area: spine * depth, item: circulation },
      { id: `${region.id}_arrival`, x: region.x, y: fromBottom ? region.y + depth : region.y,
        width: region.width, height: header, area: region.width * header,
        item: { ...circulation, id: `${circulation.id}_arrival`, name: `${circulation.name} Arrival` } },
    ];
    let feasible = true;
    for (let side = 0; side < 2; side++) {
      const groups = sides[side]!;
      const sideArea = groups.flat().reduce((sum, item) => sum + item.targetAreaMm2, 0);
      const width = side === 0 ? leftWidth : region.width - leftWidth - spine;
      const minima = groups.map(group => Math.max(
        ...group.map(item => Math.min(itemMinimum(item).width, itemMinimum(item).height)),
        group.reduce((sum, item) => sum + Math.max(item.minAreaMm2, MINIMUM_ROOM_AREAS[item.type] ?? 0), 0) / width));
      const minimumDepth = minima.reduce((sum, value) => sum + value, 0);
      if (reserveMinimum && minimumDepth > depth) { feasible = false; break; }
      let offset = 0;
      for (const [groupIndex, group] of groups.entries()) {
        const height = (reserveMinimum ? minima[groupIndex]! : 0) + (depth - (reserveMinimum ? minimumDepth : 0))
          * group.reduce((sum, item) => sum + item.targetAreaMm2, 0) / sideArea;
        const band = { id: `${region.id}_${side}_${offset}`, x: side === 0 ? region.x : region.x + leftWidth + spine,
          y: fromBottom ? y + depth - offset - height : y + offset, width, height, area: width * height };
        // Put the owner at the distribution edge and bath outward, while all
        // singleton rooms get their own common-side access edge.
        const packed = guillotinePack(group, band, { ...profile, strategy: 'compact_zoning' }, level);
        if (!packed) { feasible = false; break; }
        result.push(...(side === 0 ? packed.map(value => ({ ...value,
          x: band.x + band.width - (value.x - band.x) - value.width })) : packed));
        offset += height;
      }
      if (!feasible) break;
    }
    if (feasible) return result;
  }
  return undefined;
}

function addFloorGeometry(
  building: Building,
  floor: Floor,
  polygon: Polygon,
  items: readonly RoomProgramItem[],
  core: readonly CorePlacement[],
  profile: PlacementProfile,
): Building {
  let next = building;
  const placements: Omit<RoomPlacement, 'room'>[] = [];
  const coreItems = items.filter(item => CORE_TYPES.has(item.type));
  core.forEach(corePlacement => {
    const source = coreItems.find(item => item.id.startsWith(corePlacement.sourceId) || corePlacement.sourceId.startsWith(item.id.replace(/_floor_\d+$/, '')))
      ?? coreItems.find(item => item.type === corePlacement.type);
    if (!source) throw new Error(`CORE_CONTINUITY_FAILURE: Floor ${floor.level} is missing ${corePlacement.type}.`);
    placements.push({ ...corePlacement, item: source });
  });
  const available = subtractRegions(decomposeOrthogonalPolygon(polygon), core);
  const nonCore = items.filter(item => !CORE_TYPES.has(item.type));
  const anchored = anchoredPacking(nonCore, available, core, profile, floor.level);
  let assignments: ReturnType<typeof assignToRegions>;
  if (anchored) {
    placements.push(...anchored);
    assignments = [];
  } else try {
    assignments = assignToRegions(nonCore, available, profile, floor.level, core);
  } catch (error) {
    // Circulation remains explicit in the door graph even where a separate
    // corridor rectangle would make an otherwise feasible concave plate fail.
    // The corridor item is planner-generated, not a reviewed user room.
    const withoutSyntheticCorridor = nonCore.filter(item => item.type !== RoomType.Corridor);
    if (withoutSyntheticCorridor.length === nonCore.length) throw error;
    assignments = assignToRegions(withoutSyntheticCorridor, available, profile, floor.level, core);
  }
  assignments.forEach(assignment => placements.push(...partitionRegion(assignment.region, assignment.items, profile, floor.level)));

  const placed: RoomPlacement[] = [];
  for (const placement of placements) {
    const normalized = {
      x: Math.round(placement.x * 1e6) / 1e6,
      y: Math.round(placement.y * 1e6) / 1e6,
      width: Math.round(placement.width * 1e6) / 1e6,
      height: Math.round(placement.height * 1e6) / 1e6,
    };
    next = addRoom(next, floor.id, {
      floorId: floor.id, type: placement.item.type, name: placement.item.name,
      ...normalized,
      daylightRequirement: placement.item.daylight, privacyRequirement: placement.item.privacy,
      ventilationRequired: placement.item.ventilationRequired, isFixed: placement.item.isFixed,
      tags: [`program:${placement.item.id}`, `zone:${placement.item.zone}`, `strategy:${profile.strategy}`, 'geometry:polygon-aware'],
    });
    const room = next.floors.find(value => value.id === floor.id)!.rooms.at(-1)!;
    placed.push({ ...placement, ...normalized, area: normalized.width * normalized.height, room });
  }

  const perimeterWalls: Wall[] = [];
  polygon.points.forEach((startPoint, index) => {
    const endPoint = polygon.points[(index + 1) % polygon.points.length]!;
    next = addWall(next, floor.id, { floorId: floor.id, startPoint, endPoint, type: WallType.External, thickness: 230 });
    perimeterWalls.push(next.floors.find(value => value.id === floor.id)!.walls.at(-1)!);
  });

  const adjacency = placed.flatMap((room, index) => placed.slice(index + 1).flatMap(other => {
    const edge = sharedRoomEdge(room, other);
    return edge && edge.length >= 800 ? [{ room, other, edge }] : [];
  }));
  const root = floor.level > 0
    ? placed.find(value => value.room.type === RoomType.Staircase) ?? placed[0]
    : placed.find(value => value.room.type === RoomType.Living && exteriorExposure(value, polygon))
      ?? placed.find(value => exteriorExposure(value, polygon)) ?? placed[0];
  if (!root) throw new Error(`CONNECTIVITY_FAILURE: Floor ${floor.level} has no occupiable room.`);
  const visited = new Set([root.room.id]);
  const common = new Set([RoomType.Living, RoomType.Dining, RoomType.FamilyLiving, RoomType.Drawing,
    RoomType.Corridor, RoomType.Foyer, RoomType.Staircase, RoomType.Lift]);
  const connectionPriority = (a: RoomPlacement, b: RoomPlacement): number => {
    if (a.item.attachedToRoomId === b.item.id || b.item.attachedToRoomId === a.item.id) return 0;
    if (a.item.attachedToRoomId || b.item.attachedToRoomId) return 100;
    const publicRooms = [RoomType.Living, RoomType.FamilyLiving, RoomType.Drawing, RoomType.Dining, RoomType.Kitchen];
    if (profile.commonAccess === 'direct_chain' && publicRooms.includes(a.item.type) && publicRooms.includes(b.item.type)) return 0.5;
    if (common.has(a.item.type) && common.has(b.item.type)) return 1;
    if ((a.item.type === RoomType.Kitchen && [RoomType.Dining, RoomType.Utility, RoomType.Storage].includes(b.item.type))
      || (b.item.type === RoomType.Kitchen && [RoomType.Dining, RoomType.Utility, RoomType.Storage].includes(a.item.type))) return 2;
    if (common.has(a.item.type) || common.has(b.item.type)) return 3;
    return 10;
  };
  if (profile.architectural) adjacency.sort((a, b) => connectionPriority(a.room, a.other) - connectionPriority(b.room, b.other));
  while (visited.size < placed.length) {
    const connection = adjacency.find(edge => visited.has(edge.room.room.id) !== visited.has(edge.other.room.id));
    if (!connection) throw new Error(`CONNECTIVITY_FAILURE: Rooms on floor ${floor.level} do not form a connected physical adjacency graph.`);
    next = addWall(next, floor.id, {
      floorId: floor.id, startPoint: connection.edge.start, endPoint: connection.edge.end,
      type: WallType.Internal, thickness: 115, roomIds: [connection.room.room.id, connection.other.room.id],
    });
    const wall = next.floors.find(value => value.id === floor.id)!.walls.at(-1)!;
    const doorWidth = Math.min(DOOR_WIDTH_MM, connection.edge.length - 200);
    next = addDoor(next, floor.id, {
      floorId: floor.id, wallId: wall.id, position: openingPosition(connection.edge, doorWidth),
      width: doorWidth, height: 2100, type: DoorType.Single,
      connectsRooms: [connection.room.room.id, connection.other.room.id],
    });
    visited.add(connection.room.room.id);
    visited.add(connection.other.room.id);
  }

  const entranceExposure = exteriorExposure(root, polygon) ?? placed.map(value => ({ value, exposure: exteriorExposure(value, polygon) }))
    .find(value => value.exposure)?.exposure;
  if (floor.level === 0 && entranceExposure) {
    const width = Math.min(DOOR_WIDTH_MM, entranceExposure.edge.length - EDGE_CLEARANCE_MM * 2);
    next = addDoor(next, floor.id, {
      floorId: floor.id, wallId: perimeterWalls[entranceExposure.index]!.id,
      position: openingPositionOnWall(perimeterWalls[entranceExposure.index]!, entranceExposure.edge, width), width, height: 2100,
      type: DoorType.Single, connectsRooms: ['__outside__', root.room.id],
    });
  } else {
    const edge = adjacency.find(value => value.room.room.id === root.room.id || value.other.room.id === root.room.id)?.edge;
    if (!edge) throw new Error(`CONNECTIVITY_FAILURE: Floor ${floor.level} has no valid arrival edge.`);
    next = addWall(next, floor.id, { floorId: floor.id, startPoint: edge.start, endPoint: edge.end, type: WallType.Internal, thickness: 115, roomIds: [root.room.id] });
    const wall = next.floors.find(value => value.id === floor.id)!.walls.at(-1)!;
    const width = Math.min(DOOR_WIDTH_MM, edge.length - 200);
    next = addDoor(next, floor.id, { floorId: floor.id, wallId: wall.id, position: openingPosition(edge, width), width, height: 2100, type: DoorType.Single, connectsRooms: ['__outside__', root.room.id] });
  }

  for (const placement of placed) {
    if (!placement.item.ventilationRequired && placement.item.daylight === 'none') continue;
    const exposure = exteriorExposure(placement, polygon);
    if (!exposure || exposure.edge.length < 600) continue;
    const width = Math.min(WINDOW_WIDTH_MM, exposure.edge.length - EDGE_CLEARANCE_MM * 2);
    if (width <= 0) continue;
    next = addWindow(next, floor.id, {
      floorId: floor.id, wallId: perimeterWalls[exposure.index]!.id,
      position: openingPositionOnWall(perimeterWalls[exposure.index]!, exposure.edge, width), width, height: 1200, sillHeight: 900,
      type: WindowType.Sliding, roomId: placement.room.id,
    });
  }

  if (building.floors.length > 1) {
    const staircase = placed.find(value => value.room.type === RoomType.Staircase)?.room;
    if (!staircase) throw new Error(`CORE_CONTINUITY_FAILURE: Floor ${floor.level} is missing its staircase shaft.`);
    const lastLevel = Math.max(...building.floors.map(value => value.level));
    const fromLevel = floor.level === lastLevel ? floor.level - 1 : floor.level;
    const toLevel = floor.level === lastLevel ? floor.level : floor.level + 1;
    next = addStair(next, floor.id, {
      floorId: floor.id, x: staircase.x, y: staircase.y,
      width: Math.min(1200, staircase.width), length: Math.min(3000, staircase.height),
      direction: Direction.North, connectsFloors: [fromLevel, toLevel], verticalCoreId: 'primary-stair-core',
    });
  }
  return next;
}

/** Complete explicit enclosed uses independently of the access spanning tree.
 * Common/open/outdoor uses are not inferred to be enclosed. Existing walls and
 * their hosted openings remain authoritative; only uncovered intervals are added.
 * This generator emits orthogonal rooms. Non-orthogonal boundaries are left alone.
 */
export function completeEnclosedRoomWalls(building: Building, floorId: string): Building {
  const floor = building.floors.find(value => value.id === floorId);
  if (!floor) return building;
  const enclosed = new Set([RoomType.Bedroom, RoomType.Bathroom, RoomType.Storage, RoomType.Study, RoomType.ServantQuarter]);
  type Edge = { start: Point; end: Point; roomId: string };
  const edges: Edge[] = floor.rooms.flatMap(room => room.boundary.points.map((start, index) => ({
    start, end: room.boundary.points[(index + 1) % room.boundary.points.length]!, roomId: room.id,
  })));
  let next = building;
  for (const edge of edges.filter(value => enclosed.has(floor.rooms.find(room => room.id === value.roomId)!.type))) {
    const vertical = Math.abs(edge.start.x - edge.end.x) < EPSILON;
    if (!vertical && Math.abs(edge.start.y - edge.end.y) >= EPSILON) continue;
    const along = (point: Point) => vertical ? point.y : point.x;
    const across = (point: Point) => vertical ? point.x : point.y;
    const line = across(edge.start);
    const collinear = (start: Point, end: Point) => Math.abs(across(start) - line) < EPSILON && Math.abs(across(end) - line) < EPSILON;
    const low = Math.min(along(edge.start), along(edge.end)), high = Math.max(along(edge.start), along(edge.end));
    const walls = next.floors.find(value => value.id === floorId)!.walls;
    const existing = walls.filter(wall => collinear(wall.startPoint, wall.endPoint));
    const neighbors = edges.filter(value => collinear(value.start, value.end));
    const cuts = [...new Set([low, high,
      ...existing.flatMap(wall => [along(wall.startPoint), along(wall.endPoint)]),
      ...neighbors.flatMap(value => [along(value.start), along(value.end)]),
    ].filter(value => value >= low && value <= high))].sort((a, b) => a - b);
    for (let index = 1; index < cuts.length; index++) {
      const start = cuts[index - 1]!, end = cuts[index]!;
      if (end - start < EPSILON) continue;
      const covers = (a: Point, b: Point) => Math.min(along(a), along(b)) <= start + EPSILON && Math.max(along(a), along(b)) >= end - EPSILON;
      if (existing.some(wall => covers(wall.startPoint, wall.endPoint))) continue;
      const point = (value: number): Point => vertical ? { x: line, y: value } : { x: value, y: line };
      next = addWall(next, floorId, { floorId, startPoint: point(start), endPoint: point(end),
        type: WallType.Internal, thickness: 115,
        roomIds: [...new Set(neighbors.filter(value => covers(value.start, value.end)).map(value => value.roomId))],
      });
    }
  }
  return next;
}

/** Generates directly from authoritative per-floor polygons. */
export class PolygonLayoutGenerator {
  private readonly floorPlanner = new FloorProgramPlanner();

  generate(
    spec: DesignRequirementSpecification,
    program: RoomProgram,
    profile: PlacementProfile,
    _graph: InstanceDesignGraph,
    source: Building,
  ): Building {
    // Do not infer suite intent from legacy names. Preserve their established
    // placement path until ownership is explicitly reviewed.
    profile = { ...profile, architectural: program.items.some(item => item.attachedToRoomId !== undefined) };
    const floorCount = Math.max(1, spec.hard.floorsCount);
    const sourceFloors = [...source.floors].sort((a, b) => a.level - b.level).slice(0, floorCount);
    if (sourceFloors.length !== floorCount || sourceFloors.some(floor => floor.boundary.points.length < 4)) {
      throw new Error('POLYGON_GENERATION_FAILURE: Every planned floor must provide an approved boundary.');
    }
    const polygons = sourceFloors.map(floor => floor.boundary);
    const capacities = polygons.map(polygon => polygonArea(polygon));
    const allocation = this.floorPlanner.allocateDetailed(program, floorCount, {
      availableAreaMm2ByFloor: capacities,
      requireOccupiedFloor: true,
      // Candidate diversity belongs in zoning and geometry. Keeping a single
      // capacity-aware floor allocation prevents a strategy label from moving
      // hard requirements onto a plate that cannot carry them.
      distributionStrategy: 'upper_private',
    });
    const cores = corePlacements(polygons, allocation.floors[0]!.filter(item => CORE_TYPES.has(item.type)), profile);
    let building = createBuilding({
      projectId: spec.projectId ?? source.projectId,
      name: `${spec.projectName} — ${profile.name}`,
      site: {
        plotWidth: source.site.plotWidth,
        plotDepth: source.site.plotDepth,
        orientation: source.site.orientation,
        plotShape: source.site.plotShape,
        setbacks: source.site.setbacks,
        roadFacing: source.site.roadFacing,
        plannedFloorCount: floorCount,
      },
      floors: sourceFloors.map(floor => ({ buildingId: '', level: floor.level, name: floor.name, floorHeight: floor.floorHeight, boundary: floor.boundary })),
    });
    building = { ...building, site: source.site };
    for (let index = 0; index < building.floors.length; index += 1) {
      const floor = building.floors[index]!;
      building = addFloorGeometry(building, floor, floor.boundary, allocation.floors[index]!, cores, profile);
    }
    // Complete enclosures after every floor's original entities are allocated,
    // preserving existing room/opening IDs as well as their geometry.
    for (const floor of building.floors) building = completeEnclosedRoomWalls(building, floor.id);
    return building;
  }
}

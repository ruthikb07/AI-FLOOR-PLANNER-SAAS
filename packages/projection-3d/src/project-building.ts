import type { Building, Floor, Point, Polygon, Wall } from '@ai-floor-planner/core';
import { rectToPolygon, RoomType } from '@ai-floor-planner/core';
import { resolveProjectionSettings } from './settings';
import type {
  Building3DProjection,
  Building3DProjectionSettings,
  Level3D,
  Opening3D,
  ParameterProvenance,
  WallSolidSegment3D,
} from './types';

const EPSILON = 0.001;

function length(start: Point, end: Point): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function distanceAlongWall(point: Point, wall: Wall): number {
  const wallLength = length(wall.startPoint, wall.endPoint);
  if (wallLength <= EPSILON) return 0;
  const ux = (wall.endPoint.x - wall.startPoint.x) / wallLength;
  const uy = (wall.endPoint.y - wall.startPoint.y) / wallLength;
  const projected = (point.x - wall.startPoint.x) * ux + (point.y - wall.startPoint.y) * uy;
  return Math.max(0, Math.min(wallLength, projected));
}

function formatDatum(elevation: number): string {
  if (Math.abs(elevation) < EPSILON) return '±0.000';
  const prefix = elevation > 0 ? '+' : '−';
  return `${prefix}${(Math.abs(elevation) / 1000).toFixed(3)}`;
}

function floorHeight(floor: Floor, settings: Building3DProjectionSettings): { value: number; provenance: ParameterProvenance } {
  if (Number.isFinite(floor.floorHeight) && floor.floorHeight > 0) {
    return { value: floor.floorHeight, provenance: 'DERIVED' };
  }
  return settings.defaultFloorToFloorHeight;
}

function createLevels(floors: readonly Floor[], settings: Building3DProjectionSettings): readonly Level3D[] {
  const sorted = [...floors].sort((a, b) => a.level - b.level);
  let elevation = 0;
  return sorted.map(floor => {
    const height = floorHeight(floor, settings);
    const level: Level3D = {
      floorId: floor.id,
      floorName: floor.name,
      level: floor.level,
      elevation,
      floorToFloorHeight: height.value,
      floorToFloorProvenance: height.provenance,
      datumLabel: formatDatum(elevation),
    };
    elevation += height.value;
    return level;
  });
}

function createBuildableEnvelope(building: Building): Polygon | null {
  const { site } = building;
  if (site.plotBoundary.points.length !== 4 || site.plotShape !== 'rectangular') return null;
  const width = site.plotWidth - site.setbacks.left - site.setbacks.right;
  const depth = site.plotDepth - site.setbacks.front - site.setbacks.rear;
  if (width <= 0 || depth <= 0) return null;
  return rectToPolygon(site.setbacks.left, site.setbacks.front, width, depth);
}

function wallSolidSegments(
  wallLength: number,
  wallHeight: number,
  openings: readonly Opening3D[],
): readonly WallSolidSegment3D[] {
  const clamped = openings
    .map(opening => ({
      start: Math.max(0, opening.alongWall),
      end: Math.min(wallLength, opening.alongWall + opening.width),
      bottom: Math.max(0, opening.bottom),
      top: Math.min(wallHeight, opening.bottom + opening.height),
    }))
    .filter(opening => opening.end - opening.start > EPSILON && opening.top - opening.bottom > EPSILON)
    .sort((a, b) => a.start - b.start);

  if (clamped.length === 0) return [{ alongStart: 0, alongEnd: wallLength, bottom: 0, top: wallHeight }];

  const breakpoints = [...new Set([0, wallLength, ...clamped.flatMap(opening => [opening.start, opening.end])])].sort((a, b) => a - b);
  const solids: WallSolidSegment3D[] = [];
  for (let index = 0; index < breakpoints.length - 1; index += 1) {
    const alongStart = breakpoints[index]!;
    const alongEnd = breakpoints[index + 1]!;
    if (alongEnd - alongStart <= EPSILON) continue;
    const midpoint = (alongStart + alongEnd) / 2;
    const activeOpenings = clamped.filter(opening => midpoint >= opening.start && midpoint <= opening.end);
    if (activeOpenings.length === 0) {
      solids.push({ alongStart, alongEnd, bottom: 0, top: wallHeight });
      continue;
    }
    const lowestBottom = Math.min(...activeOpenings.map(opening => opening.bottom));
    const highestTop = Math.max(...activeOpenings.map(opening => opening.top));
    if (lowestBottom > EPSILON) solids.push({ alongStart, alongEnd, bottom: 0, top: lowestBottom });
    if (highestTop < wallHeight - EPSILON) solids.push({ alongStart, alongEnd, bottom: highestTop, top: wallHeight });
  }
  return solids;
}

function projectOpenings(floor: Floor, elevation: number, settings: Building3DProjectionSettings): readonly Opening3D[] {
  const wallById = new Map(floor.walls.map(wall => [wall.id, wall]));
  const doors: Opening3D[] = floor.doors.flatMap(door => {
    const wall = wallById.get(door.wallId);
    if (!wall) return [];
    return [{
      sourceEntityId: door.id,
      sourceEntityType: 'door',
      doorType: door.type,
      floorId: floor.id,
      hostWallId: wall.id,
      position: door.position,
      alongWall: distanceAlongWall(door.position, wall),
      width: door.width,
      bottom: 0,
      height: door.height || settings.defaultDoorHeight.value,
      elevation,
    }];
  });
  const windows: Opening3D[] = floor.windows.flatMap(window => {
    const wall = wallById.get(window.wallId);
    if (!wall) return [];
    return [{
      sourceEntityId: window.id,
      sourceEntityType: 'window',
      floorId: floor.id,
      hostWallId: wall.id,
      position: window.position,
      alongWall: distanceAlongWall(window.position, wall),
      width: window.width,
      bottom: window.sillHeight ?? settings.defaultWindowSillHeight.value,
      height: window.height || settings.defaultWindowHeight.value,
      elevation,
    }];
  });
  return [...doors, ...windows];
}

/**
 * Derive a non-authoritative scene description from the canonical Building.
 * No projected object is allowed to mutate or replace a domain entity.
 */
export function projectBuildingTo3D(
  building: Building,
  inputSettings: Partial<Building3DProjectionSettings> = {},
): Building3DProjection {
  const settings = resolveProjectionSettings(inputSettings);
  const levels = createLevels(building.floors, settings);
  const levelByFloor = new Map(levels.map(level => [level.floorId, level]));
  const openings = building.floors.flatMap(floor => projectOpenings(floor, levelByFloor.get(floor.id)?.elevation ?? 0, settings));
  const openingsByWall = new Map<string, Opening3D[]>();
  openings.forEach(opening => openingsByWall.set(opening.hostWallId, [...(openingsByWall.get(opening.hostWallId) ?? []), opening]));

  return {
    buildingId: building.id,
    buildingVersion: building.version,
    settings,
    levels,
    floorPlates: building.floors.map(floor => ({
      sourceEntityId: floor.id,
      sourceEntityType: 'floor',
      floorId: floor.id,
      boundary: floor.boundary,
      cutouts: [
        ...floor.rooms.filter(room => room.type === RoomType.ServiceShaft).map(room => room.boundary),
        // Cut the arrival slab from the actual lower-floor stair footprint,
        // only when the destination has an explicitly aligned representation.
        ...building.floors.filter(lower => lower.level < floor.level).flatMap(lower => lower.stairs
          .filter(stair => stair.connectsFloors[0] === lower.level && stair.connectsFloors[1] === floor.level
            && floor.stairs.some(arrival => arrival.connectsFloors[0] === lower.level
              && arrival.connectsFloors[1] === floor.level
              && arrival.verticalCoreId === stair.verticalCoreId
              && arrival.boundary.points.length === stair.boundary.points.length
              && stair.boundary.points.every(point => arrival.boundary.points.some(other =>
                Math.abs(point.x - other.x) < EPSILON && Math.abs(point.y - other.y) < EPSILON))))
          .map(stair => stair.boundary)),
      ],
      elevation: levelByFloor.get(floor.id)?.elevation ?? 0,
      thickness: settings.slabThickness.value,
    })),
    walls: building.floors.flatMap(floor => {
      const level = levelByFloor.get(floor.id);
      const wallHeight = Math.min(settings.defaultWallHeight.value, Math.max(1, (level?.floorToFloorHeight ?? settings.defaultFloorToFloorHeight.value) - settings.slabThickness.value));
      return floor.walls.map(wall => {
        const wallLength = length(wall.startPoint, wall.endPoint);
        return {
          sourceEntityId: wall.id,
          sourceEntityType: 'wall' as const,
          floorId: floor.id,
          startPoint: wall.startPoint,
          endPoint: wall.endPoint,
          elevation: level?.elevation ?? 0,
          length: wallLength,
          thickness: wall.thickness,
          height: wallHeight,
          solidSegments: wallSolidSegments(wallLength, wallHeight, openingsByWall.get(wall.id) ?? []),
        };
      });
    }),
    openings,
    rooms: building.floors.flatMap(floor => {
      const level = levelByFloor.get(floor.id);
      return floor.rooms.filter(room => room.type !== RoomType.ServiceShaft).map(room => ({
        sourceEntityId: room.id,
        sourceEntityType: 'room' as const,
        floorId: floor.id,
        boundary: room.boundary,
        // Prevent the optional room overlay from capping a stair opening.
        cutouts: room.type === RoomType.Staircase ? floor.stairs
          .filter(stair => stair.connectsFloors[1] === floor.level
            && stair.boundary.points.every(point => point.x >= room.x && point.x <= room.x + room.width
              && point.y >= room.y && point.y <= room.y + room.height))
          .map(stair => stair.boundary) : [],
        elevation: (level?.elevation ?? 0) + settings.slabThickness.value,
        height: Math.min(settings.defaultWallHeight.value, Math.max(1, (level?.floorToFloorHeight ?? settings.defaultFloorToFloorHeight.value) - settings.slabThickness.value)),
        name: room.name,
      }));
    }),
    stairs: building.floors.flatMap(floor => {
      const level = levelByFloor.get(floor.id);
      return floor.stairs.filter(stair => stair.connectsFloors[0] === floor.level
        && building.floors.some(target => target.level === stair.connectsFloors[1])).map(stair => ({
        sourceEntityId: stair.id,
        sourceEntityType: 'stair' as const,
        floorId: floor.id,
        boundary: stair.boundary,
        elevation: (level?.elevation ?? 0) + settings.slabThickness.value,
        verticalExtent: level?.floorToFloorHeight ?? settings.defaultFloorToFloorHeight.value,
        direction: stair.direction,
        connectsFloors: stair.connectsFloors,
        verticalCoreId: stair.verticalCoreId,
        representation: 'SCHEMATIC_VOLUME' as const,
        canonicalStair: stair,
      }));
    }),
    columns: building.floors.flatMap(floor => {
      const level = levelByFloor.get(floor.id);
      return floor.columns.map(column => ({
        sourceEntityId: column.id,
        sourceEntityType: 'column' as const,
        floorId: floor.id,
        position: column.position,
        width: column.width,
        depth: column.depth,
        elevation: (level?.elevation ?? 0) + settings.slabThickness.value,
        height: Math.min(settings.defaultWallHeight.value, Math.max(1, (level?.floorToFloorHeight ?? settings.defaultFloorToFloorHeight.value) - settings.slabThickness.value)),
        shape: column.shape,
        representation: 'SCHEMATIC_ONLY' as const,
      }));
    }),
    site: {
      sourceEntityId: building.site.id,
      sourceEntityType: 'site',
      plotBoundary: building.site.plotBoundary,
      buildableEnvelope: createBuildableEnvelope(building),
      northDegrees: building.site.orientation,
      roadFacing: building.site.roadFacing,
      roadWidth: building.site.roadWidth,
    },
  };
}

export class Building3DProjector {
  private cachedBuilding: Building | null = null;
  private cachedSettings = '';
  private cachedProjection: Building3DProjection | null = null;

  project(building: Building, settings: Partial<Building3DProjectionSettings> = {}): Building3DProjection {
    const settingsKey = JSON.stringify(resolveProjectionSettings(settings));
    if (this.cachedBuilding === building && this.cachedSettings === settingsKey && this.cachedProjection) return this.cachedProjection;
    const projected = projectBuildingTo3D(building, settings);
    this.cachedBuilding = building;
    this.cachedSettings = settingsKey;
    this.cachedProjection = projected;
    return projected;
  }
}

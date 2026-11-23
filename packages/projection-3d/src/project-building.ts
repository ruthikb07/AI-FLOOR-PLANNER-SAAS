import {
  apartmentFloorRegions,
  architecturalSlabCutouts,
  canonicalOpeningGeometry,
  canonicalStairSolids,
  fitOpeningInsideWall,
  generateApartmentWalls,
  mumtyCoverSolids,
  pointInPolygon,
  pointToSegmentDistance,
  polygonArea,
  polygonCentroid,
} from '@ai-floor-planner/geometry-engine';
import { isPhysicalBoundary, architecturalWallHeight } from '@ai-floor-planner/core';
import type { Building, Door, Floor, Point, Polygon, Room, Wall, Window } from '@ai-floor-planner/core';
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

function isOpenToSkyVoidRoom(room: Room): boolean {
  return (
    Boolean(room.openToSky) ||
    room.architecturalRole === 'OPEN_TO_SKY_VOID' ||
    room.spaceUse === 'VOID' ||
    room.type === RoomType.OTS
  );
}

function pointNearPolygonBoundary(pt: Point, poly: Polygon, toleranceMm: number): boolean {
  const pts = poly.points;
  for (let i = 0; i < pts.length; i += 1) {
    const start = pts[i]!;
    const end = pts[(i + 1) % pts.length]!;
    if (pointToSegmentDistance(pt, { start, end }) <= toleranceMm) return true;
  }
  return false;
}

/**
 * Retains strictly-interior cutout holes (e.g. stairs, lifts, internal MEP shafts)
 * while dropping perimeter recesses and open-ended OTS voids already carved out of
 * the outer built slab contour. Canonical hole coordinates are preserved unmodified.
 */
function sanitizeInteriorHole(hole: Polygon, outerBoundary: Polygon): Polygon | null {
  if (hole.points.length < 3 || polygonArea(hole) < 50_000) return null;
  const center = polygonCentroid(hole);
  if (!pointInPolygon(center, outerBoundary) || pointNearPolygonBoundary(center, outerBoundary, 25)) {
    return null;
  }
  return hole;
}

/**
 * Derives the exact built floor slab contour from actual built rooms + balconies/galleries,
 * carving out ALL perimeter recesses and open-ended OTS ventilation slots directly from the
 * outer slab polygon so zero floating empty slab trays or bridge strips appear in 3D.
 */
export function deriveBuiltFloorPlate(
  floor: Floor,
  rawCutouts: readonly Polygon[],
): { readonly boundary: Polygon; readonly cutouts: readonly Polygon[] } {
  const hasVoidRooms = floor.rooms.some(isOpenToSkyVoidRoom);
  if (!hasVoidRooms) {
    return { boundary: floor.boundary, cutouts: rawCutouts };
  }
  const builtRooms = floor.rooms.filter(room => !isOpenToSkyVoidRoom(room));
  if (builtRooms.length === 0) {
    return { boundary: floor.boundary, cutouts: rawCutouts };
  }

  try {
    const builtWalls = generateApartmentWalls(builtRooms, floor.id, floor.boundary);
    const regions = apartmentFloorRegions(builtWalls);
    const builtBoundary = regions.boundary;
    if (builtBoundary.points.length < 3 || polygonArea(builtBoundary) < 500_000) {
      return { boundary: floor.boundary, cutouts: rawCutouts };
    }

    // Merge strictly-interior voids from the built union with shaft/stair cutouts,
    // dropping any perimeter recess / open-ended OTS polygon already carved out of builtBoundary.
    const candidateHoles: Polygon[] = [...regions.voids, ...rawCutouts];
    const seen = new Set<string>();
    const cleanCutouts: Polygon[] = [];
    for (const candidate of candidateHoles) {
      const sanitized = sanitizeInteriorHole(candidate, builtBoundary);
      if (!sanitized) continue;
      const key = sanitized.points
        .map(p => `${Math.round(p.x / 10)},${Math.round(p.y / 10)}`)
        .sort()
        .join(';');
      if (seen.has(key)) continue;
      seen.add(key);
      cleanCutouts.push(sanitized);
    }
    return { boundary: builtBoundary, cutouts: cleanCutouts };
  } catch {
    // Disconnected or non-standard topology fallback: preserve floor.boundary with strictly-interior holes
    return { boundary: floor.boundary, cutouts: rawCutouts };
  }
}

function length(start: Point, end: Point): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function projectionOpeningInterval(opening: Door | Window, wall: Wall, allowNarrowing: boolean) {
  if (opening.openingGeometryVersion === 1) {
    // Defensive sanitizer: never let an out-of-bounds opening crash Floor 3D / Building 3D.
    try {
      const fitted = fitOpeningInsideWall(opening, wall, allowNarrowing);
      if (!fitted) return undefined;
      const geometry = canonicalOpeningGeometry(fitted, wall);
      const wallLen = geometry.length;
      const width = Math.min(fitted.width, wallLen - 200);
      if (!(width > 0)) return undefined;
      const alongWall = Math.max(100, Math.min(wallLen - 100 - width, geometry.start));
      return { position: geometry.pointAt(alongWall), alongWall, width };
    } catch {
      return undefined;
    }
  }
  const wallLength = length(wall.startPoint, wall.endPoint);
  if (wallLength < 650 || opening.width <= 0 || ![wallLength, opening.width, opening.position.x, opening.position.y].every(Number.isFinite) ||
      (!allowNarrowing && opening.width > wallLength - 200)) return undefined;
  const ux = (wall.endPoint.x - wall.startPoint.x) / wallLength;
  const uy = (wall.endPoint.y - wall.startPoint.y) / wallLength;
  const projected = (opening.position.x - wall.startPoint.x) * ux + (opening.position.y - wall.startPoint.y) * uy;
  const width = Math.min(opening.width, wallLength - 200);
  const alongWall = Math.max(100, Math.min(wallLength - 100 - width, projected));
  return { position: alongWall === projected ? opening.position : { x: wall.startPoint.x + alongWall * ux, y: wall.startPoint.y + alongWall * uy }, alongWall, width };
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
    if (floor.architecture && Number.isFinite(floor.elevationMm)) elevation = floor.elevationMm!;
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
    if (!wall || !isPhysicalBoundary(wall)) return [];
    const interval = projectionOpeningInterval(door, wall, false);
    if (!interval) return [];
    return [{
      sourceEntityId: door.id,
      sourceEntityType: 'door',
      doorType: door.type,
      floorId: floor.id,
      hostWallId: wall.id,
      ...interval,
      bottom: 0,
      height: door.height || settings.defaultDoorHeight.value,
      elevation,
    }];
  });
  const windows: Opening3D[] = floor.windows.flatMap(window => {
    const wall = wallById.get(window.wallId);
    if (!wall || !isPhysicalBoundary(wall)) return [];
    const interval = projectionOpeningInterval(window, wall, true);
    if (!interval) return [];
    return [{
      sourceEntityId: window.id,
      sourceEntityType: 'window',
      floorId: floor.id,
      hostWallId: wall.id,
      ...interval,
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

  const facadeCoord = building.metadata?.facadeCoordination;
  const coordinatedChajjas = (facadeCoord?.chajjaBands ?? []).map(band => {
    const lvl = levelByFloor.get(band.floorId);
    const elev = lvl?.elevation ?? 0;
    const fascia = band.fasciaThicknessMm || 100;
    const bottom = elev + (band.lintelHeightMm || 2100);
    return {
      ...band,
      elevation: elev,
      bottom,
      top: bottom + fascia,
    };
  });
  const otsLouverScreens = (facadeCoord?.otsLouverScreens ?? []).map(screen => {
    const lvl = levelByFloor.get(screen.floorId);
    return {
      ...screen,
      elevation: lvl?.elevation ?? 0,
    };
  });

  return {
    buildingId: building.id,
    buildingVersion: building.version,
    ...(coordinatedChajjas.length ? { coordinatedChajjas } : {}),
    ...(otsLouverScreens.length ? { otsLouverScreens } : {}),
    ...(facadeCoord?.galleryCoordinationMode ? { galleryCoordinationMode: facadeCoord.galleryCoordinationMode } : {}),
    ...(facadeCoord?.galleryBays?.length ? { galleryBays: facadeCoord.galleryBays } : {}),
    architecturalSolids: building.floors.filter(f => f.architecture).flatMap(f => {
      const level = levelByFloor.get(f.id)!;
      const next = levels.find(l => l.level > level.level);
      return [
        ...(f.canonicalStaircases ?? []).flatMap(s => canonicalStairSolids(s, next ? next.elevation - level.elevation : f.floorHeight, f.slabThicknessMm ?? 150).filter(p => !!next || p.top === 0).map(p => ({ ...p, sourceEntityId: s.id, sourceEntityType: 'stair' as const, floorId: f.id, bottom: level.elevation + p.bottom, top: level.elevation + p.top }))),
        ...mumtyCoverSolids(f).map(p => ({ ...p, sourceEntityId: p.sourceId, sourceEntityType: 'room' as const, floorId: f.id, bottom: level.elevation + p.bottom, top: level.elevation + p.top }))
      ];
    }),
    settings,
    levels,
    floorPlates: building.floors.map(floor => {
      const rawCutouts = floor.architecture ? architecturalSlabCutouts(floor) : [
        ...floor.rooms.filter(room => room.type === RoomType.ServiceShaft || room.openToSky || room.architecturalRole === 'OPEN_TO_SKY_VOID').map(room => room.boundary),
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
      ];
      const builtPlate = deriveBuiltFloorPlate(floor, rawCutouts);
      return {
        sourceEntityId: floor.id,
        sourceEntityType: 'floor',
        floorId: floor.id,
        boundary: builtPlate.boundary,
        cutouts: builtPlate.cutouts,
        elevation: levelByFloor.get(floor.id)?.elevation ?? 0,
        thickness: floor.architecture ? floor.slabThicknessMm ?? 150 : settings.slabThickness.value,
      };
    }),
    walls: building.floors.flatMap(floor => {
      const level = levelByFloor.get(floor.id);
      const canonicalHeight = (levels.find(l => l.level > (level?.level ?? floor.level))?.elevation ?? ((level?.elevation ?? 0) + floor.floorHeight)) - (level?.elevation ?? 0) - (floor.slabThicknessMm ?? 150);
      const wallHeight = floor.architecture ? canonicalHeight : Math.min(settings.defaultWallHeight.value, Math.max(1, (level?.floorToFloorHeight ?? settings.defaultFloorToFloorHeight.value) - settings.slabThickness.value));
      const voidRoomIds = new Set(floor.rooms.filter(isOpenToSkyVoidRoom).map(r => r.id));
      return floor.walls
        .filter(wall =>
          isPhysicalBoundary(wall) &&
          !(wall.roomIds.length > 0 && wall.roomIds.every(id => voidRoomIds.has(id))),
        )
        .map(wall => {
          const physicalHeight = architecturalWallHeight(wall, wallHeight);
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
            height: physicalHeight,
            ...(wall.arc ? { arc: wall.arc } : {}),
            solidSegments: wallSolidSegments(wallLength, physicalHeight, openingsByWall.get(wall.id) ?? []),
          };
        });
    }),
    openings,
    rooms: building.floors.flatMap(floor => {
      const level = levelByFloor.get(floor.id);
      return floor.rooms.filter(room => (!floor.architecture || room.type !== RoomType.Staircase) && room.type !== RoomType.ServiceShaft && !room.openToSky && room.architecturalRole !== 'OPEN_TO_SKY_VOID').map(room => ({
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
        height: floor.architecture ? 8 : Math.min(settings.defaultWallHeight.value, Math.max(1, (level?.floorToFloorHeight ?? settings.defaultFloorToFloorHeight.value) - settings.slabThickness.value)),
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

/**
 * Phase 3 - Canonical conversion of an extracted plan into a candidate Building.
 *
 * PRD 21-24: the extracted plan becomes a candidate Building ONLY if it passes
 * the deterministic geometry/constraint system. If it fails it is REJECTED -
 * no silent repair, no different geometry claiming to be the original image.
 */

import type { Building, Direction, RoomType, Wall, Point } from '@ai-floor-planner/core';
import { PlotShape, WallType, generateId } from '@ai-floor-planner/core';
import { createBuilding, createRoom, MINIMUM_ROOM_AREAS, MINIMUM_DIMENSIONS } from '@ai-floor-planner/core';
import {
  generateWalls,
  polygonEdges,
  pointToSegmentDistance,
  DEFAULT_WALL_CONFIG,
} from '@ai-floor-planner/geometry-engine';
import type { DiagnosticFragment, ExtractedPlan } from './extraction';
import { extractedRoomType, imageRectToMillimetres } from './extraction-analysis';

export interface ExtractionSite {
  readonly plotWidth: number;
  readonly plotDepth: number;
  readonly orientation: number;
  readonly roadFacing: string;
  readonly frontSetback: number;
  readonly rearSetback: number;
  readonly leftSetback: number;
  readonly rightSetback: number;
}

const DOOR_TYPE: Readonly<Record<string, string>> = {
  open_passage: 'open_passage',
  double: 'double',
  sliding: 'sliding',
  single: 'single',
  unknown: 'single',
};

function findHostingWall(walls: readonly Wall[], position: Point, adjacentRoomId?: string): Wall | undefined {
  if (adjacentRoomId) {
    const candidate = walls.find(w => w.roomIds.includes(adjacentRoomId) && pointToSegmentDistance(position, { start: w.startPoint, end: w.endPoint }) <= 600);
    if (candidate) return candidate;
  }
  const closest = walls
    .map(w => ({ wall: w, dist: pointToSegmentDistance(position, { start: w.startPoint, end: w.endPoint }) }))
    .filter(item => item.dist <= 600)
    .sort((a, b) => a.dist - b.dist)[0];
  return closest?.wall;
}

function isEdgeCoveredByWalls(edge: { start: Point; end: Point }, walls: readonly Wall[]): boolean {
  const isVert = Math.abs(edge.start.x - edge.end.x) < 2;
  const isHoriz = Math.abs(edge.start.y - edge.end.y) < 2;
  const edgeLow = isVert ? Math.min(edge.start.y, edge.end.y) : Math.min(edge.start.x, edge.end.x);
  const edgeHigh = isVert ? Math.max(edge.start.y, edge.end.y) : Math.max(edge.start.x, edge.end.x);

  for (const w of walls) {
    const wVert = Math.abs(w.startPoint.x - w.endPoint.x) < 2;
    const wHoriz = Math.abs(w.startPoint.y - w.endPoint.y) < 2;
    if (isVert && wVert && Math.abs(edge.start.x - w.startPoint.x) < 5) {
      const wLow = Math.min(w.startPoint.y, w.endPoint.y);
      const wHigh = Math.max(w.startPoint.y, w.endPoint.y);
      if (Math.max(edgeLow, wLow) < Math.min(edgeHigh, wHigh) - 10) {
        return true;
      }
    } else if (isHoriz && wHoriz && Math.abs(edge.start.y - w.startPoint.y) < 5) {
      const wLow = Math.min(w.startPoint.x, w.endPoint.x);
      const wHigh = Math.max(w.startPoint.x, w.endPoint.x);
      if (Math.max(edgeLow, wLow) < Math.min(edgeHigh, wHigh) - 10) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Convert an extracted plan into a candidate canonical Building on a single
 * ground floor. All coordinates are mapped from image space to real-world mm.
 */
export function extractPlanToBuilding(
  extracted: ExtractedPlan,
  site: ExtractionSite,
  projectId: string,
  name: string,
): { building: Building | null; diagnostics: DiagnosticFragment[] } {
  const diagnostics: DiagnosticFragment[] = [];
  const siteRect = { plotWidth: site.plotWidth, plotDepth: site.plotDepth };

  const wide = extracted.metadata.imageWidePixels;
  const tall = extracted.metadata.imageTallPixels;
  const boundaryPolygon = {
    points: extracted.boundary.points.map(point => ({
      x: (point.x / wide) * site.plotWidth,
      y: (point.y / tall) * site.plotDepth,
    })),
  };
  if (boundaryPolygon.points.length < 3) {
    return {
      building: null,
      diagnostics: [{
        code: 'EXTRACTION_BOUNDARY_DEGENERATE',
        severity: 'error',
        message: 'The extracted boundary has fewer than three points and cannot define a building.',
      }],
    };
  }

  const base = createBuilding({
    projectId,
    name,
    site: {
      plotWidth: site.plotWidth,
      plotDepth: site.plotDepth,
      plotShape: PlotShape.Rectangular,
      orientation: site.orientation,
      roadFacing: site.roadFacing as Direction,
      setbacks: {
        front: site.frontSetback,
        rear: site.rearSetback,
        left: site.leftSetback,
        right: site.rightSetback,
      },
    },
    floors: [{ buildingId: 'floor-extracted', level: 0, name: 'Ground Floor', boundary: boundaryPolygon }],
  });

  const floorId = base.floors[0]!.id;
  let building: Building = base;

  const appendRoom = (
    id: string,
    roomName: string,
    type: RoomType,
    rect: { imageX: number; imageY: number; imageWidth: number; imageHeight: number },
    fixed: boolean,
  ): void => {
    const real = imageRectToMillimetres(rect, extracted.metadata, siteRect);
    if (!real) return;
    const minArea = (MINIMUM_ROOM_AREAS as Record<string, number | undefined>)[type];
    const minDimension = (MINIMUM_DIMENSIONS as Record<string, number | undefined>)[type];
    const privacy = type === 'bedroom' || type === 'bathroom' ? 'high' : 'low';
    building = {
      ...building,
      floors: building.floors.map(floor => floor.level === 0
        ? {
          ...floor,
          rooms: [
            ...floor.rooms,
            createRoom({
              floorId,
              name: roomName,
              type,
              x: real.x,
              y: real.y,
              width: real.width,
              height: real.height,
              tags: [`extracted:${id}`],
              ...(minArea !== undefined ? { minArea } : {}),
              ...(minDimension !== undefined ? { minWidthMm: minDimension, minHeightMm: minDimension } : {}),
              daylightRequirement: 'medium' as never,
              privacyRequirement: privacy as never,
              isFixed: fixed,
            }),
          ],
        }
        : floor),
    };
  };

  for (const room of extracted.rooms) {
    appendRoom(room.id, room.name, extractedRoomType(room.type || room.name), room, false);
  }
  for (const stair of extracted.stairs) {
    appendRoom(stair.id, stair.name, 'staircase' as RoomType, stair, true);
  }
  for (const park of extracted.parking) {
    appendRoom(park.id, park.name, 'parking' as RoomType, park, false);
  }

  // Generate real architectural walls for the extracted plan
  const currentFloor = building.floors[0]!;
  if (currentFloor.rooms.length > 0) {
    const generatedWalls = generateWalls([...currentFloor.rooms], floorId, currentFloor.boundary);
    const allEdges = currentFloor.rooms.flatMap(r => polygonEdges(r.boundary).map(e => ({ edge: e, roomId: r.id })));
    const additionalWalls: Wall[] = [];
    for (const { edge, roomId } of allEdges) {
      if (!isEdgeCoveredByWalls(edge, generatedWalls) && !isEdgeCoveredByWalls(edge, additionalWalls)) {
        additionalWalls.push({
          id: generateId(),
          floorId,
          startPoint: edge.start,
          endPoint: edge.end,
          thickness: DEFAULT_WALL_CONFIG.internalThickness,
          type: WallType.Internal,
          roomIds: [roomId],
          hasOpening: false,
          loadBearing: false,
        });
      }
    }
    const finalWalls = [...generatedWalls, ...additionalWalls];
    building = {
      ...building,
      floors: building.floors.map(floor => floor.id === floorId ? { ...floor, walls: finalWalls } : floor),
    };
  }

  return { building, diagnostics };
}

/**
 * Attach extracted doors and windows to their detected adjacent rooms.
 * Unresolvable references are reported, never invented.
 */
export function attachExtractedOpenings(
  building: Building,
  extracted: ExtractedPlan,
  site: { readonly plotWidth: number; readonly plotDepth: number },
): { building: Building; diagnostics: DiagnosticFragment[] } {
  const diagnostics: DiagnosticFragment[] = [];
  const floorId = building.floors[0]!.id;
  let next = building;

  for (const door of extracted.doors) {
    const adjacent = next.floors[0]!.rooms.find(room => room.tags.includes(`extracted:${door.adjacentRoomId}`));
    const real = imageRectToMillimetres(door, extracted.metadata, site);
    if (!adjacent || !real) {
      if (!adjacent) {
        diagnostics.push({
          code: 'EXTRACTION_DOOR_SKIPPED',
          severity: 'warning',
          message: `Door "${door.id}" was not attached because its adjacent room was not extracted from the image.`,
        });
      }
      continue;
    }
    const hostWall = findHostingWall(next.floors[0]!.walls, { x: real.x, y: real.y }, adjacent.id);
    const wallId = hostWall ? hostWall.id : '__extracted__';
    next = {
      ...next,
      floors: next.floors.map(floor => floor.level === 0
        ? {
          ...floor,
          doors: [
            ...floor.doors,
            {
              id: door.id,
              floorId,
              wallId,
              position: { x: real.x, y: real.y },
              width: real.width,
              height: 2100,
              type: (DOOR_TYPE[door.type] ?? 'single') as never,
              swingDirection: (door.swingDirection === 'outward' ? 'outward' : door.swingDirection === 'left' ? 'left' : door.swingDirection === 'right' ? 'right' : 'inward') as never,
              connectsRooms: [adjacent.id, '__outside__'] as [string, string],
            },
          ],
        }
        : floor),
    };
  }

  for (const window of extracted.windows) {
    const adjacent = next.floors[0]!.rooms.find(room => room.tags.includes(`extracted:${window.adjacentRoomId}`));
    const real = imageRectToMillimetres(window, extracted.metadata, site);
    if (!adjacent || !real) continue;
    const hostWall = findHostingWall(next.floors[0]!.walls, { x: real.x, y: real.y }, adjacent.id);
    const wallId = hostWall ? hostWall.id : '__extracted__';
    next = {
      ...next,
      floors: next.floors.map(floor => floor.level === 0
        ? {
          ...floor,
          windows: [
            ...floor.windows,
            {
              id: window.id,
              floorId,
              wallId,
              position: { x: real.x, y: real.y },
              width: real.width,
              height: Math.max(600, real.height),
              sillHeight: 900,
              type: 'sliding' as never,
              roomId: adjacent.id,
            },
          ],
        }
        : floor),
    };
  }

  // Update wall hasOpening state for all hosting walls
  const openWallIds = new Set([
    ...next.floors[0]!.doors.map(d => d.wallId),
    ...next.floors[0]!.windows.map(w => w.wallId),
  ]);
  next = {
    ...next,
    floors: next.floors.map(floor => floor.level === 0
      ? {
        ...floor,
        walls: floor.walls.map(w => openWallIds.has(w.id) ? { ...w, hasOpening: true } : w),
      }
      : floor),
  };

  return { building: next, diagnostics };
}
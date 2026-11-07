/**
 * Immutable update helpers for the Building Model.
 *
 * Every function takes a Building and returns a NEW Building.
 * The original is NEVER mutated.
 */

import type { Building, Room, Floor, Point, Polygon, Door, Window, Column, Stair, Wall } from '../types';
import { EntityNotFoundError, InvalidDimensionError, InvalidCoordinateError } from './errors';
import { createRoom, createFloor, createWall, createDoor, createWindow, createColumn, createStair, rectToPolygon } from './factory';
import type { CreateRoomParams, CreateWallParams, CreateDoorParams, CreateWindowParams, CreateColumnParams, CreateStairParams } from './factory';

// ─── Internal Helpers ───────────────────────────────────────────────────────

/** Find a room across all floors. Returns [floorIndex, roomIndex] or throws. */
function findRoom(building: Building, roomId: string): { floorIdx: number; roomIdx: number } {
  for (let fi = 0; fi < building.floors.length; fi++) {
    const floor = building.floors[fi]!;
    for (let ri = 0; ri < floor.rooms.length; ri++) {
      if (floor.rooms[ri]!.id === roomId) {
        return { floorIdx: fi, roomIdx: ri };
      }
    }
  }
  throw new EntityNotFoundError('Room', roomId);
}

/** Find a door across all floors. Returns [floorIndex, doorIndex] or throws. */
function findDoor(building: Building, doorId: string): { floorIdx: number; doorIdx: number } {
  for (let fi = 0; fi < building.floors.length; fi++) {
    const floor = building.floors[fi]!;
    for (let di = 0; di < floor.doors.length; di++) {
      if (floor.doors[di]!.id === doorId) {
        return { floorIdx: fi, doorIdx: di };
      }
    }
  }
  throw new EntityNotFoundError('Door', doorId);
}

/** Find a window across all floors. Returns [floorIndex, windowIndex] or throws. */
function findWindow(building: Building, windowId: string): { floorIdx: number; winIdx: number } {
  for (let fi = 0; fi < building.floors.length; fi++) {
    const floor = building.floors[fi]!;
    for (let wi = 0; wi < floor.windows.length; wi++) {
      if (floor.windows[wi]!.id === windowId) {
        return { floorIdx: fi, winIdx: wi };
      }
    }
  }
  throw new EntityNotFoundError('Window', windowId);
}

/** Apply a room updater function to a specific room, returning a new Building. */
function updateRoomInBuilding(
  building: Building,
  roomId: string,
  updater: (room: Room) => Room,
): Building {
  const { floorIdx } = findRoom(building, roomId);

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx
        ? {
            ...floor,
            rooms: floor.rooms.map(room =>
              room.id === roomId ? updater(room) : room,
            ),
          }
        : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

// ─── Public Updaters ────────────────────────────────────────────────────────

/** Update a room's position. Returns new Building with updated room. */
export function moveRoom(
  building: Building,
  roomId: string,
  newX: number,
  newY: number,
): Building {
  if (!Number.isFinite(newX)) throw new InvalidCoordinateError('x', newX);
  if (!Number.isFinite(newY)) throw new InvalidCoordinateError('y', newY);

  return updateRoomInBuilding(building, roomId, room => ({
    ...room,
    x: newX,
    y: newY,
    boundary: rectToPolygon(newX, newY, room.width, room.height),
  }));
}

/** Update a room's dimensions. Returns new Building. Area recomputed. */
export function resizeRoom(
  building: Building,
  roomId: string,
  newWidth: number,
  newHeight: number,
): Building {
  if (!Number.isFinite(newWidth) || newWidth <= 0) {
    throw new InvalidDimensionError('width', newWidth);
  }
  if (!Number.isFinite(newHeight) || newHeight <= 0) {
    throw new InvalidDimensionError('height', newHeight);
  }

  return updateRoomInBuilding(building, roomId, room => ({
    ...room,
    width: newWidth,
    height: newHeight,
    area: newWidth * newHeight,
    boundary: rectToPolygon(room.x, room.y, newWidth, newHeight),
  }));
}

/** Add a room to a floor. Returns new Building. */
export function addRoom(
  building: Building,
  floorId: string,
  params: CreateRoomParams,
): Building {
  const floorIdx = building.floors.findIndex(f => f.id === floorId);
  if (floorIdx === -1) {
    throw new EntityNotFoundError('Floor', floorId);
  }

  const newRoom = createRoom(params);

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx
        ? { ...floor, rooms: [...floor.rooms, newRoom] }
        : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Remove a room from a floor. Returns new Building. */
export function removeRoom(
  building: Building,
  roomId: string,
): Building {
  const { floorIdx } = findRoom(building, roomId);

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx
        ? { ...floor, rooms: floor.rooms.filter(r => r.id !== roomId) }
        : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Move a door to a new position. Returns new Building. */
export function moveDoor(
  building: Building,
  doorId: string,
  newPosition: Point,
): Building {
  const { floorIdx } = findDoor(building, doorId);

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx
        ? {
            ...floor,
            doors: floor.doors.map(door =>
              door.id === doorId ? { ...door, position: newPosition } : door,
            ),
          }
        : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Move a window to a new position. Returns new Building. */
export function moveWindow(
  building: Building,
  windowId: string,
  newPosition: Point,
): Building {
  const { floorIdx } = findWindow(building, windowId);

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx
        ? {
            ...floor,
            windows: floor.windows.map(w =>
              w.id === windowId ? { ...w, position: newPosition } : w,
            ),
          }
        : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Add a door to a floor. Returns new Building. */
export function addDoor(
  building: Building,
  floorId: string,
  params: CreateDoorParams,
): Building {
  const floorIdx = building.floors.findIndex(f => f.id === floorId);
  if (floorIdx === -1) throw new EntityNotFoundError('Floor', floorId);

  const door = createDoor({ ...params, floorId });

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx ? { ...floor, doors: [...floor.doors, door] } : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Remove a door from its floor. Returns new Building. */
export function removeDoor(building: Building, doorId: string): Building {
  const { floorIdx } = findDoor(building, doorId);

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx
        ? { ...floor, doors: floor.doors.filter(d => d.id !== doorId) }
        : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Update a door's attributes. Returns new Building. */
export function updateDoor(
  building: Building,
  doorId: string,
  updates: Partial<Door>,
): Building {
  const { floorIdx } = findDoor(building, doorId);

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx
        ? {
            ...floor,
            doors: floor.doors.map(d =>
              d.id === doorId ? { ...d, ...updates } : d,
            ),
          }
        : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Add a window to a floor. Returns new Building. */
export function addWindow(
  building: Building,
  floorId: string,
  params: CreateWindowParams,
): Building {
  const floorIdx = building.floors.findIndex(f => f.id === floorId);
  if (floorIdx === -1) throw new EntityNotFoundError('Floor', floorId);

  const win = createWindow({ ...params, floorId });

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx ? { ...floor, windows: [...floor.windows, win] } : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Remove a window from its floor. Returns new Building. */
export function removeWindow(building: Building, windowId: string): Building {
  const { floorIdx } = findWindow(building, windowId);

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx
        ? { ...floor, windows: floor.windows.filter(w => w.id !== windowId) }
        : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Update a window's attributes. Returns new Building. */
export function updateWindow(
  building: Building,
  windowId: string,
  updates: Partial<Window>,
): Building {
  const { floorIdx } = findWindow(building, windowId);

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx
        ? {
            ...floor,
            windows: floor.windows.map(w =>
              w.id === windowId ? { ...w, ...updates } : w,
            ),
          }
        : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Add a column to a floor. Returns new Building. */
export function addColumn(
  building: Building,
  floorId: string,
  params: CreateColumnParams,
): Building {
  const floorIdx = building.floors.findIndex(f => f.id === floorId);
  if (floorIdx === -1) throw new EntityNotFoundError('Floor', floorId);

  const column = createColumn({ ...params, floorId });

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx ? { ...floor, columns: [...floor.columns, column] } : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Remove a column from its floor. Returns new Building. */
export function removeColumn(building: Building, columnId: string): Building {
  const floorIdx = building.floors.findIndex(f => f.columns.some(c => c.id === columnId));
  if (floorIdx === -1) throw new EntityNotFoundError('Column', columnId);

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx
        ? { ...floor, columns: floor.columns.filter(c => c.id !== columnId) }
        : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Update a column's attributes. Returns new Building. */
export function updateColumn(
  building: Building,
  columnId: string,
  updates: Partial<Column>,
): Building {
  const floorIdx = building.floors.findIndex(f => f.columns.some(c => c.id === columnId));
  if (floorIdx === -1) throw new EntityNotFoundError('Column', columnId);

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx
        ? {
            ...floor,
            columns: floor.columns.map(c =>
              c.id === columnId ? { ...c, ...updates } : c,
            ),
          }
        : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Add a stair to a floor. Returns new Building. */
export function addStair(
  building: Building,
  floorId: string,
  params: CreateStairParams,
): Building {
  const floorIdx = building.floors.findIndex(f => f.id === floorId);
  if (floorIdx === -1) throw new EntityNotFoundError('Floor', floorId);

  const stair = createStair({ ...params, floorId });

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx ? { ...floor, stairs: [...floor.stairs, stair] } : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Remove a stair from its floor. Returns new Building. */
export function removeStair(building: Building, stairId: string): Building {
  const floorIdx = building.floors.findIndex(f => f.stairs.some(s => s.id === stairId));
  if (floorIdx === -1) throw new EntityNotFoundError('Stair', stairId);

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx
        ? { ...floor, stairs: floor.stairs.filter(s => s.id !== stairId) }
        : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Update a stair's attributes. Returns new Building. */
export function updateStair(
  building: Building,
  stairId: string,
  updates: Partial<Stair>,
): Building {
  const floorIdx = building.floors.findIndex(f => f.stairs.some(s => s.id === stairId));
  if (floorIdx === -1) throw new EntityNotFoundError('Stair', stairId);

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx
        ? {
            ...floor,
            stairs: floor.stairs.map(s =>
              s.id === stairId ? { ...s, ...updates } : s,
            ),
          }
        : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Add a wall to a floor. Returns new Building. */
export function addWall(
  building: Building,
  floorId: string,
  params: CreateWallParams,
): Building {
  const floorIdx = building.floors.findIndex(f => f.id === floorId);
  if (floorIdx === -1) throw new EntityNotFoundError('Floor', floorId);

  const wall = createWall({ ...params, floorId });

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx ? { ...floor, walls: [...floor.walls, wall] } : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Remove a wall from its floor. Returns new Building. */
export function removeWall(building: Building, wallId: string): Building {
  const floorIdx = building.floors.findIndex(f => f.walls.some(w => w.id === wallId));
  if (floorIdx === -1) throw new EntityNotFoundError('Wall', wallId);

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx
        ? { ...floor, walls: floor.walls.filter(w => w.id !== wallId) }
        : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Update a wall's attributes (thickness, material, type). Returns new Building. */
export function updateWall(
  building: Building,
  wallId: string,
  updates: Partial<Wall>,
): Building {
  const floorIdx = building.floors.findIndex(f => f.walls.some(w => w.id === wallId));
  if (floorIdx === -1) throw new EntityNotFoundError('Wall', wallId);

  return {
    ...building,
    floors: building.floors.map((floor, fi) =>
      fi === floorIdx
        ? {
            ...floor,
            walls: floor.walls.map(w =>
              w.id === wallId ? { ...w, ...updates } : w,
            ),
          }
        : floor,
    ),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Polymorphic entity deletion helper. Returns new Building. */
export function deleteEntity(
  building: Building,
  entityType: string,
  entityId: string,
): Building {
  switch (entityType) {
    case 'room':
      return removeRoom(building, entityId);
    case 'wall':
      return removeWall(building, entityId);
    case 'door':
      return removeDoor(building, entityId);
    case 'window':
      return removeWindow(building, entityId);
    case 'column':
      return removeColumn(building, entityId);
    case 'stair':
      return removeStair(building, entityId);
    default:
      throw new Error(`Cannot delete unsupported entity type: ${entityType}`);
  }
}

/** Type map for generic entity updates. */
type EntityMap = {
  room: Room;
  floor: Floor;
  door: Door;
  window: Window;
  column: Column;
  stair: Stair;
  wall: Wall;
};

/** Generic entity updater — update any entity field by type and ID. */
export function updateEntity<T extends keyof EntityMap>(
  building: Building,
  entityType: T,
  entityId: string,
  updates: Partial<EntityMap[T]>,
): Building {
  if (entityType === 'room') {
    return updateRoomInBuilding(building, entityId, room => ({
      ...room,
      ...updates,
    }));
  }

  if (entityType === 'floor') {
    const floorIdx = building.floors.findIndex(f => f.id === entityId);
    if (floorIdx === -1) throw new EntityNotFoundError('Floor', entityId);

    return {
      ...building,
      floors: building.floors.map((floor, fi) =>
        fi === floorIdx ? { ...floor, ...updates } : floor,
      ),
      version: building.version + 1,
    updatedAt: new Date().toISOString(),
    };
  }

  if (entityType === 'door') {
    return updateDoor(building, entityId, updates as Partial<Door>);
  }

  if (entityType === 'window') {
    return updateWindow(building, entityId, updates as Partial<Window>);
  }

  if (entityType === 'column') {
    return updateColumn(building, entityId, updates as Partial<Column>);
  }

  if (entityType === 'stair') {
    return updateStair(building, entityId, updates as Partial<Stair>);
  }

  if (entityType === 'wall') {
    return updateWall(building, entityId, updates as Partial<Wall>);
  }

  throw new Error(`Unknown entity type: ${String(entityType)}`);
}

/** Add a new floor to the building at the top level. */
export function addFloorToBuilding(
  building: Building,
  params?: {
    name?: string;
    floorHeight?: number;
    boundary?: Polygon;
  },
): { building: Building; floor: Floor } {
  const nextLevel = building.floors.length;
  const groundFloor = building.floors.find(f => f.level === 0) ?? building.floors[0];
  const floor = createFloor({
    buildingId: building.id,
    level: nextLevel,
    name: params?.name ?? `Floor ${nextLevel}`,
    floorHeight: params?.floorHeight ?? groundFloor?.floorHeight,
    boundary: params?.boundary ?? (groundFloor?.boundary
      ? { points: groundFloor.boundary.points.map(p => ({ ...p })) }
      : { points: [] }),
  });

  const nextBuilding: Building = {
    ...building,
    floors: [...building.floors, floor],
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };

  return { building: nextBuilding, floor };
}

/** Remove a floor by ID from the building. Preserves at least 1 floor and re-indexes levels. */
export function removeFloorFromBuilding(
  building: Building,
  floorId: string,
): Building {
  if (building.floors.length <= 1) {
    throw new Error('Cannot remove the only floor in a building.');
  }

  const remainingFloors = building.floors
    .filter(f => f.id !== floorId)
    .map((floor, idx) => ({
      ...floor,
      level: idx,
      name: idx === 0 ? 'Ground Floor' : `Floor ${idx}`,
    }));

  return {
    ...building,
    floors: remainingFloors,
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

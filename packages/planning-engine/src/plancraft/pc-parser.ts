/**
 * Plancraft .pc compact DSL parser.
 * Faithfully parses indented architectural floor plans into PlancraftProjectNode.
 */

import type {
  PlancraftDoorNode,
  PlancraftFloorNode,
  PlancraftOpeningNode,
  PlancraftPoint,
  PlancraftProjectNode,
  PlancraftRoomChild,
  PlancraftRoomNode,
  PlancraftSwingDirection,
  PlancraftUnit,
  PlancraftWallNode,
  PlancraftWindowNode,
} from './types';

export class PlancraftParseError extends Error {
  constructor(message: string) {
    super(`PlancraftParseError: ${message}`);
    this.name = 'PlancraftParseError';
  }
}

const VALID_UNITS = new Set<string>(['mm', 'cm', 'm', 'ft', 'in']);
const VALID_SWINGS = new Set<string>(['left', 'right', 'double', 'sliding']);

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const len = line.length;

  while (i < len) {
    while (i < len && (line[i] === ' ' || line[i] === '\t')) i++;
    if (i >= len) break;

    if (line[i] === '"') {
      i++;
      let token = '';
      while (i < len && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < len) {
          token += line[i + 1];
          i += 2;
        } else {
          token += line[i];
          i++;
        }
      }
      if (i < len) i++;
      tokens.push(token);
    } else {
      let token = '';
      while (i < len && line[i] !== ' ' && line[i] !== '\t') {
        token += line[i];
        i++;
      }
      tokens.push(token);
    }
  }

  return tokens;
}

function parseCoord(token: string, context: string): PlancraftPoint {
  const parts = token.split(',');
  if (parts.length !== 2) {
    throw new PlancraftParseError(`${context}: expected coordinate "x,y" but got "${token}"`);
  }
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (isNaN(x) || isNaN(y)) {
    throw new PlancraftParseError(`${context}: invalid coordinate numbers in "${token}"`);
  }
  return { x, y };
}

function parseKvPairs(tokens: string[], startIdx: number): Map<string, string> {
  const pairs = new Map<string, string>();
  let i = startIdx;
  while (i < tokens.length) {
    const eq = tokens[i]!.indexOf('=');
    if (eq === -1) {
      i++;
      continue;
    }
    const key = tokens[i]!.substring(0, eq);
    let value = tokens[i]!.substring(eq + 1);

    if (value.startsWith('"') && !value.endsWith('"')) {
      value = value.slice(1);
      i++;
      while (i < tokens.length) {
        if (tokens[i]!.endsWith('"')) {
          value += ' ' + tokens[i]!.slice(0, -1);
          break;
        }
        value += ' ' + tokens[i]!;
        i++;
      }
    } else if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }

    pairs.set(key, value);
    i++;
  }
  return pairs;
}

function parseHeaderValue(line: string): string {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return '';
  let val = line.substring(colonIdx + 1).trim();
  if (val.length >= 2 && val[0] === '"' && val[val.length - 1] === '"') {
    val = val.slice(1, -1);
  }
  return val;
}

function parseWallLine(tokens: string[], lineNum: number, roomName: string): PlancraftWallNode {
  const ctx = `Line ${lineNum} (wall in "${roomName}")`;
  if (tokens.length < 5) {
    throw new PlancraftParseError(`${ctx}: expected "wall <direction> <from> <to> <thickness>"`);
  }
  const direction = tokens[1]!;
  const from = parseCoord(tokens[2]!, ctx);
  const to = parseCoord(tokens[3]!, ctx);
  const thickness = Number(tokens[4]);
  if (isNaN(thickness) || thickness <= 0) {
    throw new PlancraftParseError(`${ctx}: thickness must be a number > 0, got "${tokens[4]}"`);
  }

  const node: PlancraftWallNode = { type: 'wall', direction, from, to, thickness };
  const kv = parseKvPairs(tokens, 5);
  if (kv.has('bulge')) {
    const bulge = Number(kv.get('bulge'));
    if (!isNaN(bulge)) {
      return { ...node, bulge };
    }
  }

  return node;
}

function parseDoorLine(tokens: string[], lineNum: number, roomName: string): PlancraftDoorNode {
  const ctx = `Line ${lineNum} (door in "${roomName}")`;
  if (tokens.length < 5) {
    throw new PlancraftParseError(`${ctx}: expected "door <wall> <offset> <width> <swing>"`);
  }
  const wallDirection = tokens[1]!;
  const offset = Number(tokens[2]);
  const width = Number(tokens[3]);
  const swing = tokens[4]!;

  if (isNaN(offset) || offset < 0) {
    throw new PlancraftParseError(`${ctx}: offset must be a number >= 0, got "${tokens[2]}"`);
  }
  if (isNaN(width) || width <= 0) {
    throw new PlancraftParseError(`${ctx}: width must be a number > 0, got "${tokens[3]}"`);
  }
  if (!VALID_SWINGS.has(swing)) {
    throw new PlancraftParseError(`${ctx}: swing must be one of: left, right, double, sliding`);
  }

  return { type: 'door', wallDirection, offset, width, swing: swing as PlancraftSwingDirection };
}

function parseWindowLine(tokens: string[], lineNum: number, roomName: string): PlancraftWindowNode {
  const ctx = `Line ${lineNum} (window in "${roomName}")`;
  if (tokens.length < 6) {
    throw new PlancraftParseError(`${ctx}: expected "window <wall> <offset> <width> <height> <sill>"`);
  }
  const wallDirection = tokens[1]!;
  const offset = Number(tokens[2]);
  const width = Number(tokens[3]);
  const height = Number(tokens[4]);
  const sill = Number(tokens[5]);

  return { type: 'window', wallDirection, offset, width, height, sill };
}

function parseOpeningLine(tokens: string[], lineNum: number, roomName: string): PlancraftOpeningNode {
  const ctx = `Line ${lineNum} (opening in "${roomName}")`;
  if (tokens.length < 4) {
    throw new PlancraftParseError(`${ctx}: expected "opening <wall> <offset> <width>"`);
  }
  const wallDirection = tokens[1]!;
  const offset = Number(tokens[2]);
  const width = Number(tokens[3]);

  return { type: 'opening', wallDirection, offset, width };
}

function indentLevel(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === ' ') i++;
  return i;
}

export function parsePc(source: string): PlancraftProjectNode {
  const lines = source.split('\n');
  let name: string | undefined;
  let scaleRatio = 100;
  let unit: PlancraftUnit = 'mm';
  const floors: PlancraftFloorNode[] = [];

  let currentFloor: { name: string; children: PlancraftRoomNode[] } | null = null;
  let currentRoom: { name: string; children: PlancraftRoomChild[] } | null = null;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    const lineNum = lineIdx + 1;
    const line = rawLine.trimEnd();

    if (line.trim() === '') continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) continue;

    const indent = indentLevel(line);

    if (indent === 0) {
      if (trimmed.startsWith('plan:')) {
        name = parseHeaderValue(trimmed);
        if (!name) throw new PlancraftParseError(`Line ${lineNum}: plan name cannot be empty`);
      } else if (trimmed.startsWith('scale:')) {
        const val = Number(parseHeaderValue(trimmed));
        if (isNaN(val) || val <= 0) {
          throw new PlancraftParseError(`Line ${lineNum}: scale must be a number > 0`);
        }
        scaleRatio = val;
      } else if (trimmed.startsWith('unit:')) {
        const val = parseHeaderValue(trimmed);
        if (!VALID_UNITS.has(val)) {
          throw new PlancraftParseError(`Line ${lineNum}: unit must be one of: mm, cm, m, ft, in`);
        }
        unit = val as PlancraftUnit;
      } else if (trimmed.startsWith('floor:')) {
        if (currentRoom && currentFloor) {
          currentFloor.children.push({ type: 'room', ...currentRoom });
        }
        currentRoom = null;

        const floorName = parseHeaderValue(trimmed);
        if (!floorName) throw new PlancraftParseError(`Line ${lineNum}: floor name cannot be empty`);
        currentFloor = { name: floorName, children: [] };
        floors.push({ type: 'floor', ...currentFloor });
      } else {
        throw new PlancraftParseError(`Line ${lineNum}: unexpected line "${trimmed}"`);
      }
      continue;
    }

    if (indent >= 1 && indent <= 3) {
      if (trimmed.startsWith('room:')) {
        if (!currentFloor) {
          throw new PlancraftParseError(`Line ${lineNum}: room found outside of a floor`);
        }
        if (currentRoom) {
          currentFloor.children.push({ type: 'room', ...currentRoom });
        }
        const roomName = parseHeaderValue(trimmed);
        if (!roomName) throw new PlancraftParseError(`Line ${lineNum}: room name cannot be empty`);
        currentRoom = { name: roomName, children: [] };
        continue;
      }
    }

    if (indent >= 2) {
      if (!currentRoom) {
        throw new PlancraftParseError(`Line ${lineNum}: element found outside of a room`);
      }

      const tokens = tokenize(trimmed);
      if (tokens.length === 0) continue;

      const keyword = tokens[0];
      switch (keyword) {
        case 'wall':
          currentRoom.children.push(parseWallLine(tokens, lineNum, currentRoom.name));
          break;
        case 'door':
          currentRoom.children.push(parseDoorLine(tokens, lineNum, currentRoom.name));
          break;
        case 'window':
          currentRoom.children.push(parseWindowLine(tokens, lineNum, currentRoom.name));
          break;
        case 'opening':
          currentRoom.children.push(parseOpeningLine(tokens, lineNum, currentRoom.name));
          break;
        default:
          throw new PlancraftParseError(`Line ${lineNum}: unknown keyword "${keyword}"`);
      }
    }
  }

  if (currentRoom && currentFloor) {
    currentFloor.children.push({ type: 'room', ...currentRoom });
  }

  if (!name) {
    name = 'Architectural Floor Plan';
  }

  return { type: 'project', name, scale: { ratio: scaleRatio }, unit, floors };
}

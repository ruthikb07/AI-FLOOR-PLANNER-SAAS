/**
 * Plancraft .pcf furniture layout DSL parser and serializer.
 */

import type {
  PlancraftFurnitureElementDef,
  PlancraftFurnitureLayout,
  PlancraftFurniturePlacement,
  PlancraftPoint,
  PlancraftRelativePosition,
  PlancraftWallAnchor,
} from './types';

export class PlancraftLayoutParseError extends Error {
  constructor(message: string) {
    super(`PlancraftLayoutParseError: ${message}`);
    this.name = 'PlancraftLayoutParseError';
  }
}

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
    throw new PlancraftLayoutParseError(`${context}: expected "x,y" but got "${token}"`);
  }
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (isNaN(x) || isNaN(y)) {
    throw new PlancraftLayoutParseError(`${context}: invalid coordinate in "${token}"`);
  }
  return { x, y };
}

function parseKvPairs(tokens: string[], startIdx: number): Map<string, string> {
  const pairs = new Map<string, string>();
  for (let i = startIdx; i < tokens.length; i++) {
    const token = tokens[i]!;
    const eq = token.indexOf('=');
    if (eq === -1) continue;
    pairs.set(token.substring(0, eq), token.substring(eq + 1));
  }
  return pairs;
}

function parsePlacementLine(tokens: string[], lineNum: number): PlancraftFurniturePlacement {
  const ctx = `Line ${lineNum}`;
  if (tokens.length < 3) {
    throw new PlancraftLayoutParseError(`${ctx}: placement requires "place <element> at|anchor|rel ..."`);
  }

  const rawElement = tokens[1]!;
  const element = rawElement.startsWith('default/') ? rawElement.slice(8) : rawElement;
  const mode = tokens[2]!;

  let position: PlancraftPoint = { x: 0, y: 0 };
  let anchor: PlancraftWallAnchor | undefined;
  let relativePosition: PlancraftRelativePosition | undefined;
  let room: string | undefined;
  let kvStartIdx = 3;

  if (mode === 'at') {
    if (tokens.length < 4) {
      throw new PlancraftLayoutParseError(`${ctx}: "at" requires coordinates`);
    }
    position = parseCoord(tokens[3]!, ctx);
    kvStartIdx = 4;
    if (kvStartIdx < tokens.length && tokens[kvStartIdx] === 'in') {
      kvStartIdx++;
      if (kvStartIdx >= tokens.length) {
        throw new PlancraftLayoutParseError(`${ctx}: "in" requires a room name`);
      }
      room = tokens[kvStartIdx]!;
      kvStartIdx++;
    }
  } else if (mode === 'anchor') {
    if (tokens.length < 7) {
      throw new PlancraftLayoutParseError(`${ctx}: anchor requires "anchor <wall> <along> <offset> in <room>"`);
    }
    const wall = tokens[3]!;
    const along = Number(tokens[4]);
    const offset = Number(tokens[5]);
    if (tokens[6] !== 'in' || tokens.length < 8) {
      throw new PlancraftLayoutParseError(`${ctx}: expected "in <room>" after anchor`);
    }
    room = tokens[7]!;
    anchor = { wall, along: isNaN(along) ? 0.5 : along, offset: isNaN(offset) ? 0 : offset };
    kvStartIdx = 8;
  } else if (mode === 'rel') {
    if (tokens.length < 5) {
      throw new PlancraftLayoutParseError(`${ctx}: "rel" requires coordinates and room`);
    }
    const relCoord = parseCoord(tokens[3]!, ctx);
    relativePosition = { x: relCoord.x, y: relCoord.y };
    if (tokens[4] === 'in' && tokens.length >= 6) {
      room = tokens[5]!;
      kvStartIdx = 6;
    } else {
      kvStartIdx = 5;
    }
  }

  const kv = parseKvPairs(tokens, kvStartIdx);
  let scaleWidth = 100;
  let scaleDepth = 100;
  let lockProportions = true;
  let rotation = 0;

  if (kv.has('scale')) {
    const parts = kv.get('scale')!.split(',');
    scaleWidth = Number(parts[0]) || 100;
    scaleDepth = parts.length > 1 ? Number(parts[1]) || scaleWidth : scaleWidth;
    if (parts.length > 1) lockProportions = false;
  }

  if (kv.has('rotation')) {
    rotation = Number(kv.get('rotation')) || 0;
    rotation = ((rotation % 360) + 360) % 360;
  }

  if (kv.has('lockProportions')) {
    lockProportions = kv.get('lockProportions') === 'true';
  }

  return {
    element,
    position,
    scaleWidth,
    scaleDepth,
    lockProportions,
    rotation,
    room,
    anchor,
    relativePosition,
  };
}

export function parsePcf(source: string): PlancraftFurnitureLayout {
  const lines = source.split('\n');
  const placements: PlancraftFurniturePlacement[] = [];
  const elements: Record<string, PlancraftFurnitureElementDef> = {};

  let state: 'root' | 'placements' | 'elements' | 'element-body' = 'root';
  let currentElement: { id: string; name: string; tags: string[]; defaultWidth: number; defaultDepth: number; svg: string; source?: string } | null = null;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    const lineNum = lineIdx + 1;
    const line = rawLine.trimEnd();

    if (line.trim() === '') continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) continue;

    if (trimmed === 'furniture:' || trimmed === 'furniture') {
      state = 'root';
      continue;
    }
    if (trimmed === 'placements:' || trimmed === 'placements') {
      if (currentElement && currentElement.svg) {
        elements[currentElement.id] = { ...currentElement };
        currentElement = null;
      }
      state = 'placements';
      continue;
    }
    if (trimmed === 'elements:' || trimmed === 'elements') {
      state = 'elements';
      continue;
    }

    if (state === 'placements' || state === 'root') {
      const tokens = tokenize(trimmed);
      if (tokens[0] === 'place') {
        placements.push(parsePlacementLine(tokens, lineNum));
        continue;
      }
    }

    if (state === 'elements' || state === 'element-body') {
      if (state === 'element-body' && currentElement) {
        if (trimmed.startsWith('svg:')) {
          currentElement.svg = trimmed.substring(4).trim();
          continue;
        }
        if (trimmed.startsWith('source:')) {
          currentElement.source = trimmed.substring(7).trim();
          continue;
        }
        if (currentElement.svg && !currentElement.svg.endsWith('</svg>')) {
          currentElement.svg += ' ' + trimmed;
          continue;
        }
      }

      if (currentElement) {
        if (currentElement.svg) {
          elements[currentElement.id] = { ...currentElement };
        }
        currentElement = null;
      }

      // New element definition header: e.g. "plant: Potted Plant [living] 400x400"
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const id = trimmed.substring(0, colonIdx).trim();
        const rest = trimmed.substring(colonIdx + 1).trim();
        currentElement = {
          id,
          name: rest,
          tags: [],
          defaultWidth: 500,
          defaultDepth: 500,
          svg: '',
        };
        state = 'element-body';
      }
    }
  }

  if (currentElement && currentElement.svg) {
    elements[currentElement.id] = { ...currentElement };
  }

  return {
    placements,
    ...(Object.keys(elements).length > 0 ? { elements } : {}),
  };
}

function q(s: string): string {
  return s.includes(' ') || s.includes('\t') ? `"${s}"` : s;
}

export function serializePcf(layout: PlancraftFurnitureLayout): string {
  const lines: string[] = ['furniture:', ''];

  if (layout.elements && Object.keys(layout.elements).length > 0) {
    lines.push('elements:');
    for (const [id, def] of Object.entries(layout.elements)) {
      const tagsStr = def.tags.length > 0 ? ` [${def.tags.join(',')}]` : '';
      lines.push(`  ${id}: ${def.name}${tagsStr} ${def.defaultWidth}x${def.defaultDepth}`);
      const flatSvg = def.svg.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
      lines.push(`    svg: ${flatSvg}`);
      if (def.source) lines.push(`    source: ${def.source}`);
    }
    lines.push('');
  }

  lines.push('placements:');
  for (const p of layout.placements) {
    let line = `  place default/${p.element}`;
    if (p.anchor) {
      line += ` anchor ${q(p.anchor.wall)} ${p.anchor.along} ${p.anchor.offset}`;
      if (p.room) line += ` in ${q(p.room)}`;
    } else if (p.relativePosition) {
      line += ` rel ${p.relativePosition.x},${p.relativePosition.y}`;
      if (p.room) line += ` in ${q(p.room)}`;
    } else {
      line += ` at ${Math.round(p.position.x)},${Math.round(p.position.y)}`;
      if (p.room) line += ` in ${q(p.room)}`;
    }

    const kvParts: string[] = [];
    if (p.scaleWidth !== 100 || p.scaleDepth !== 100) {
      if (p.scaleWidth === p.scaleDepth) {
        kvParts.push(`scale=${p.scaleWidth}`);
      } else {
        kvParts.push(`scale=${p.scaleWidth},${p.scaleDepth}`);
      }
    }
    if (p.rotation !== 0) {
      kvParts.push(`rotation=${p.rotation}`);
    }
    if (!p.lockProportions) {
      kvParts.push('lockProportions=false');
    }
    if (kvParts.length > 0) {
      line += ' ' + kvParts.join(' ');
    }
    lines.push(line);
  }

  return lines.join('\n') + '\n';
}

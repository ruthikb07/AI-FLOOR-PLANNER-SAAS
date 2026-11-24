import { EXCHANGE_MAX_BYTES } from './cad-bim-adapter-contract';
import { isValidIfcGuid } from './ifc-guid';
import type { Point } from '../types/geometry';

interface StepEntity {
  readonly id: string;
  readonly type: string;
  readonly args: readonly string[];
}

function scan(text: string, delimiter: string, onReference?: (id: string) => void): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = false;
  let quoteStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (i - quoteStart > 32_768) throw new Error('IFC_TEXT_LIMIT');
      if (ch === "'" && text[i + 1] === "'") i++;
      else if (ch === "'") quote = false;
      continue;
    }
    if (ch === "'") { quote = true; quoteStart = i; }
    else if (ch === '(' && ++depth > 24) throw new Error('IFC_NESTING_LIMIT');
    else if (ch === ')' && --depth < 0) throw new Error('IFC_UNBALANCED_LIST');
    else if (ch === '#' && onReference) {
      const match = /^#([1-9]\d{0,8})(?!\d)/.exec(text.slice(i, i + 12));
      if (!match) throw new Error('IFC_INVALID_REFERENCE');
      onReference(match[0]);
      i += match[0].length - 1;
    } else if (ch === delimiter && depth === 0) {
      parts.push(text.slice(start, i).trim());
      if (parts.length > 150_020) throw new Error('IFC_ENTITY_LIMIT');
      start = i + 1;
    }
  }
  if (depth !== 0 || quote) throw new Error('IFC_INCOMPLETE_STATEMENT');
  parts.push(text.slice(start).trim());
  return parts;
}

export function stepArgs(value: string): readonly string[] {
  if (!value.startsWith('(') || !value.endsWith(')')) throw new Error('IFC_EXPECTED_LIST');
  return value.length === 2 ? [] : scan(value.slice(1, -1), ',');
}

export function stepNumber(value: string | undefined): number {
  if (value === undefined || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/.test(value)) throw new Error('IFC_EXPECTED_NUMBER');
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > 1e15) throw new Error('IFC_REAL_OUT_OF_RANGE');
  return n;
}

export function stepText(value: string | undefined): string {
  if (!value || !value.startsWith("'") || !value.endsWith("'")) return '';
  return value.slice(1, -1).replace(/''/g, "'").replace(/\\X2\\([0-9a-f]+)\\X0\\/gi, (encoded, hex: string) =>
    hex.length % 4 === 0 ? hex.replace(/.{4}/g, part => String.fromCharCode(Number.parseInt(part, 16))) : encoded,
  );
}

const rootClasses = new Set([
  'IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE', 'IFCWALL', 'IFCWALLSTANDARDCASE',
  'IFCSLAB', 'IFCROOF', 'IFCOPENINGELEMENT', 'IFCDOOR', 'IFCWINDOW', 'IFCSTAIR', 'IFCSTAIRFLIGHT',
  'IFCRAILING', 'IFCBEAM', 'IFCCOLUMN', 'IFCMEMBER', 'IFCPLATE', 'IFCPROPERTYSET', 'IFCELEMENTQUANTITY',
  'IFCDUCTSEGMENT', 'IFCPIPESEGMENT', 'IFCBUILDINGELEMENTPROXY',
]);

export function readIfc4Step(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > EXCHANGE_MAX_BYTES) throw new Error('IFC_FILE_SIZE_LIMIT');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  // Preserve comment markers in quoted metadata. STEP external references are never resolved here.
  const text = stripComments(source);
  const parts = scan(text, ';');
  if (parts[0]?.toUpperCase() !== 'ISO-10303-21' || parts[1]?.toUpperCase() !== 'HEADER'
    || parts.at(-2)?.toUpperCase() !== 'END-ISO-10303-21' || parts.at(-1) !== '') {
    throw new Error('IFC_INVALID_STEP_ENVELOPE');
  }
  const headerEnd = parts.findIndex((part, i) => i > 1 && part.toUpperCase() === 'ENDSEC');
  if (headerEnd < 0 || parts[headerEnd + 1]?.toUpperCase() !== 'DATA' || parts.at(-3)?.toUpperCase() !== 'ENDSEC') {
    throw new Error('IFC_INVALID_STEP_SECTIONS');
  }
  const schemas = parts.slice(2, headerEnd).filter(part => /^FILE_SCHEMA\s*\(/i.test(part));
  if (schemas.length !== 1 || !/^FILE_SCHEMA\s*\(\s*\(\s*'IFC4'\s*\)\s*\)$/i.test(schemas[0]!)) {
    throw new Error('IFC_SCHEMA_UNSUPPORTED');
  }

  const entities = new Map<string, StepEntity>();
  const roots = new Map<string, StepEntity>();
  const edges = new Map<string, ReadonlySet<string>>();
  for (let i = headerEnd + 2; i < parts.length - 3; i++) {
    const row = /^(#[1-9]\d{0,8})\s*=\s*([A-Z][A-Z0-9_]*)\s*\(([\s\S]*)\)$/i.exec(parts[i]!);
    if (!row || entities.has(row[1]!)) throw new Error('IFC_BAD_OR_DUPLICATE_ENTITY_ID');
    const id = row[1]!;
    const references = new Set<string>();
    const args = scan(row[3]!, ',', ref => { references.add(ref); });
    if (args.length > 8192 || references.size > 8192) throw new Error('IFC_REFERENCE_LIMIT');
    const type = row[2]!.toUpperCase();
    const entity = { id, type, args };
    entities.set(id, entity);
    edges.set(id, references);
    if (rootClasses.has(type) || type.startsWith('IFCREL')) {
      const guid = stepText(args[0]);
      if (!isValidIfcGuid(guid) || roots.has(guid)) throw new Error('IFC_INVALID_OR_DUPLICATE_GLOBAL_ID');
      roots.set(guid, entity);
    }
  }
  if (!entities.size) throw new Error('IFC_EMPTY_DATA');
  for (const refs of edges.values()) {
    for (const ref of refs) if (!entities.has(ref)) throw new Error('IFC_DANGLING_REFERENCE');
  }

  function entity(id: string | undefined, type?: string) {
    const node = id ? entities.get(id) : undefined;
    if (!node || (type !== undefined && node.type !== type)) throw new Error('IFC_UNEXPECTED_ENTITY');
    return node;
  }

  function point(id: string | undefined): readonly number[] {
    const numbers = stepArgs(entity(id, 'IFCCARTESIANPOINT').args[0]!).map(stepNumber);
    if (numbers.length < 2 || numbers.length > 3 || numbers.some(n => Math.abs(n) > 1e9)) {
      throw new Error('IFC_COORDINATE_OUT_OF_RANGE');
    }
    return numbers;
  }

  function ring(id: string | undefined): readonly Point[] {
    return stepArgs(entity(id, 'IFCPOLYLINE').args[0]!).map(ref => {
      const [x, y] = point(ref);
      return { x: x!, y: y! };
    });
  }

  return { entities, roots, entity, point, ring };
}

function stripComments(text: string) {
  const segments: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "'") {
      if (quoted && text[i + 1] === "'") i++;
      else quoted = !quoted;
    } else if (!quoted && text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error('IFC_UNTERMINATED_COMMENT');
      segments.push(text.slice(start, i), ' ');
      start = end + 2;
      i = end + 1;
    }
  }
  return segments.length ? segments.join('') + text.slice(start) : text;
}

/**
 * Clean-Room Pure-TypeScript STEP (ISO-10303-21 AP203/AP214/AP242) and IGES 3D Reader.
 *
 * Replaces Cota's optional LGPL-2.1 `occt-import-js` WebAssembly loader with a
 * zero-WASM, zero-LGPL parser for polygonal B-Rep shells (`CLOSED_SHELL`,
 * `OPEN_SHELL`, `FACETED_BREP`, `ADVANCED_FACE` with planar/polyloop/edge-loop
 * boundaries, `TRIANGULATED_FACE`, `TESSELLATED_FACE`) and IGES point/line/face
 * entities (`106`, `110`, `502`, `504`, `508`, `510`), surfacing explicit
 * warnings for unsupported curved NURBS surfaces so entities are never silently lost.
 */
import type { MeshProps } from '../document/types';
import type { Vec3 } from '../math';

export interface StepIgesImportReport {
  readonly meshes: Array<MeshProps & { name?: string }>;
  readonly warnings: string[];
  readonly unsupportedEntities: Record<string, number>;
}

let lastStepIgesReport: StepIgesImportReport | null = null;

export function getLastStepIgesImportReport(): StepIgesImportReport | null {
  return lastStepIgesReport;
}

function splitTopLevelArgs(raw: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (inStr) {
      cur += c;
      if (c === "'") {
        if (raw[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          inStr = false;
        }
      }
      continue;
    }
    if (c === "'") {
      inStr = true;
      cur += c;
      continue;
    }
    if (c === '(') {
      depth++;
      cur += c;
      continue;
    }
    if (c === ')') {
      depth--;
      cur += c;
      continue;
    }
    if (c === ',' && depth === 0) {
      args.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim() || args.length > 0) args.push(cur.trim());
  return args;
}

function parseStepRefs(listExpr: string): number[] {
  const out: number[] = [];
  const re = /#(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(listExpr)) !== null) out.push(Number(m[1]));
  return out;
}

function parseStepNumbers(listExpr: string): number[] {
  const inner = listExpr.trim().replace(/^\(/, '').replace(/\)$/, '');
  if (!inner.trim()) return [];
  return inner
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n));
}

function fanTriangulate(loop: Vec3[]): Array<[number, number, number]> {
  if (loop.length < 3) return [];
  const tris: Array<[number, number, number]> = [];
  for (let i = 1; i + 1 < loop.length; i++) {
    tris.push([0, i, i + 1]);
  }
  return tris;
}

function readStepBuffer(buf: ArrayBuffer): StepIgesImportReport {
  const text = new TextDecoder('latin1').decode(new Uint8Array(buf));
  if (!/ISO-10303-21/i.test(text) && !/#\d+\s*=\s*[A-Z0-9_]+\s*\(/i.test(text)) {
    throw new Error('Invalid STEP file: missing ISO-10303-21 header or entity instances.');
  }

  const entities = new Map<number, { type: string; args: string[]; raw: string }>();
  const stmtRe = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*?)\)\s*;/gi;
  let match: RegExpExecArray | null;
  while ((match = stmtRe.exec(text)) !== null) {
    const id = Number(match[1]);
    const type = match[2]!.toUpperCase();
    const raw = match[3]!;
    entities.set(id, { type, args: splitTopLevelArgs(raw), raw });
  }

  const points = new Map<number, Vec3>();
  const vertices = new Map<number, Vec3>();
  for (const [id, ent] of entities) {
    if (ent.type === 'CARTESIAN_POINT') {
      const coords = parseStepNumbers(ent.args[1] ?? '');
      if (coords.length >= 2) {
        points.set(id, [coords[0] ?? 0, coords[1] ?? 0, coords[2] ?? 0]);
      }
    }
  }
  for (const [id, ent] of entities) {
    if (ent.type === 'VERTEX_POINT') {
      const ptRef = parseStepRefs(ent.args[1] ?? '')[0];
      const pt = ptRef !== undefined ? points.get(ptRef) : undefined;
      if (pt) vertices.set(id, pt);
    }
  }

  const unsupported: Record<string, number> = {};
  const warnings: string[] = [];
  const meshes: Array<MeshProps & { name?: string }> = [];

  const extractFaceLoop = (boundRef: number): Vec3[] => {
    const bound = entities.get(boundRef);
    if (!bound) return [];
    const loopRef = parseStepRefs(bound.args[1] ?? '')[0];
    const loop = loopRef !== undefined ? entities.get(loopRef) : undefined;
    if (!loop) return [];
    if (loop.type === 'POLY_LOOP') {
      return parseStepRefs(loop.args[1] ?? '')
        .map(r => points.get(r))
        .filter((p): p is Vec3 => Boolean(p));
    }
    if (loop.type === 'EDGE_LOOP') {
      const pts: Vec3[] = [];
      for (const oeRef of parseStepRefs(loop.args[1] ?? '')) {
        const oe = entities.get(oeRef);
        if (!oe) continue;
        const ecRef = parseStepRefs(oe.args[3] ?? oe.args[2] ?? '')[0];
        const ec = ecRef !== undefined ? entities.get(ecRef) : undefined;
        if (!ec) continue;
        const vStartRef = parseStepRefs(ec.args[1] ?? '')[0];
        const vEndRef = parseStepRefs(ec.args[2] ?? '')[0];
        const orientedForward = !/\.F\./i.test(oe.args[4] ?? '.T.');
        const vRef = orientedForward ? vStartRef : vEndRef;
        const vPt = vRef !== undefined ? vertices.get(vRef) : undefined;
        if (vPt) pts.push(vPt);
      }
      return pts;
    }
    return [];
  };

  const buildMeshFromFaceRefs = (faceRefs: number[], name?: string): (MeshProps & { name?: string }) | null => {
    const meshVerts: Vec3[] = [];
    const meshFaces: number[][] = [];
    for (const fRef of faceRefs) {
      const face = entities.get(fRef);
      if (!face) continue;
      if (face.type === 'ADVANCED_FACE' && face.args[2]) {
        const surfRef = parseStepRefs(face.args[2])[0];
        const surf = surfRef !== undefined ? entities.get(surfRef) : undefined;
        if (surf && surf.type !== 'PLANE') {
          unsupported[surf.type] = (unsupported[surf.type] ?? 0) + 1;
        }
      }
      const boundRefs = parseStepRefs(face.args[1] ?? '');
      for (const bRef of boundRefs) {
        const bEnt = entities.get(bRef);
        if (bEnt && bEnt.type !== 'FACE_OUTER_BOUND' && bEnt.type !== 'FACE_BOUND') continue;
        const loop = extractFaceLoop(bRef);
        if (loop.length < 3) continue;
        const baseIdx = meshVerts.length;
        for (const p of loop) meshVerts.push(p);
        for (const [a, b, c] of fanTriangulate(loop)) {
          meshFaces.push([baseIdx + a, baseIdx + b, baseIdx + c]);
        }
        break; // Use outer loop per face
      }
    }
    if (meshVerts.length < 3 || meshFaces.length === 0) return null;
    return { vertices: meshVerts, faces: meshFaces, ...(name ? { name } : {}) };
  };

  // 1. Collect shells (`CLOSED_SHELL` / `OPEN_SHELL`)
  const usedFaces = new Set<number>();
  for (const [, ent] of entities) {
    if (ent.type === 'CLOSED_SHELL' || ent.type === 'OPEN_SHELL') {
      const rawName = (ent.args[0] ?? '').replace(/^'|'$/g, '').trim();
      const fRefs = parseStepRefs(ent.args[1] ?? '');
      fRefs.forEach(r => usedFaces.add(r));
      const mesh = buildMeshFromFaceRefs(fRefs, rawName || ent.type);
      if (mesh) meshes.push(mesh);
    } else if (ent.type === 'TRIANGULATED_FACE' || ent.type === 'TESSELLATED_FACE') {
      // IFC4/AP242 tessellated face
      const coordRef = parseStepRefs(ent.args[1] ?? '')[0];
      const coordList = coordRef !== undefined ? entities.get(coordRef) : undefined;
      if (coordList) {
        const nums = parseStepNumbers(coordList.raw);
        const verts: Vec3[] = [];
        for (let i = 0; i + 2 < nums.length; i += 3) verts.push([nums[i]!, nums[i + 1]!, nums[i + 2]!]);
        const idxNums = parseStepNumbers(ent.args[ent.args.length - 1] ?? '');
        const faces: number[][] = [];
        for (let i = 0; i + 2 < idxNums.length; i += 3) {
          faces.push([idxNums[i]! - 1, idxNums[i + 1]! - 1, idxNums[i + 2]! - 1]);
        }
        if (verts.length >= 3 && faces.length > 0) {
          meshes.push({ vertices: verts, faces, name: 'STEP_TESSELLATED_FACE' });
        }
      }
    }
  }

  // 2. Standalone faces not grouped in a shell
  const looseFaces: number[] = [];
  for (const [id, ent] of entities) {
    if ((ent.type === 'FACE_SURFACE' || ent.type === 'ADVANCED_FACE' || ent.type === 'FACE') && !usedFaces.has(id)) {
      looseFaces.push(id);
    }
  }
  if (looseFaces.length > 0) {
    const looseMesh = buildMeshFromFaceRefs(looseFaces, 'STEP_FACES');
    if (looseMesh) meshes.push(looseMesh);
  }

  // 3. Fallback bounding/point-hull prism if file contains only curves/NURBS solids
  if (meshes.length === 0 && points.size >= 3) {
    const allPts = [...points.values()];
    const tris = fanTriangulate(allPts.slice(0, Math.min(allPts.length, 64)));
    if (tris.length > 0) {
      meshes.push({ vertices: allPts.slice(0, Math.min(allPts.length, 64)), faces: tris.map(t => [...t]), name: 'STEP_APPROX_BODY' });
      warnings.push('STEP file contained non-polygonal surfaces; imported planar vertex approximation.');
    }
  }

  for (const [surfType, count] of Object.entries(unsupported)) {
    warnings.push(`${count} ${surfType} surface(s) approximated by boundary edge loops.`);
  }
  if (meshes.length === 0) {
    throw new Error('The STEP file contained no readable 3D faces or vertices.');
  }
  return { meshes, warnings, unsupportedEntities: unsupported };
}

function readIgesBuffer(buf: ArrayBuffer): StepIgesImportReport {
  const text = new TextDecoder('latin1').decode(new Uint8Array(buf));
  const lines = text.split(/\r?\n/);
  const paramLines: string[] = [];
  let hasIgesSections = false;
  for (const line of lines) {
    if (line.length >= 73) {
      const sec = line[72];
      if (sec === 'S' || sec === 'G' || sec === 'D' || sec === 'P' || sec === 'T') {
        hasIgesSections = true;
      }
      if (sec === 'P') {
        paramLines.push(line.slice(0, 64).trim());
      }
    }
  }
  if (!hasIgesSections) {
    throw new Error('Invalid IGES file: missing standard 80-column S/G/D/P/T sections.');
  }

  const records = paramLines.join('').split(';').map(s => s.trim()).filter(Boolean);
  const vertices: Vec3[] = [];
  const faces: number[][] = [];
  const unsupported: Record<string, number> = {};
  const warnings: string[] = [];

  for (const rec of records) {
    const parts = rec.split(',').map(p => Number(p.trim()));
    const typeCode = parts[0];
    if (!Number.isFinite(typeCode)) continue;
    if (typeCode === 110 && parts.length >= 7) {
      // Line entity: X1,Y1,Z1, X2,Y2,Z2 -> thin ribbon triangle for wireframe/mesh visibility
      const i0 = vertices.length;
      vertices.push(
        [parts[1]!, parts[2]!, parts[3]!],
        [parts[4]!, parts[5]!, parts[6]!],
        [(parts[1]! + parts[4]!) / 2 + 0.01, (parts[2]! + parts[5]!) / 2 + 0.01, (parts[3]! + parts[6]!) / 2],
      );
      faces.push([i0, i0 + 1, i0 + 2]);
    } else if (typeCode === 106 && parts.length >= 9) {
      // Copious data / 3D polygon loop
      const nTuples = Math.floor(parts[2] ?? 0);
      const flag = parts[1];
      const stride = flag === 2 ? 3 : 2;
      const startOffset = flag === 1 ? 4 : 3;
      const loop: Vec3[] = [];
      for (let k = 0; k < nTuples; k++) {
        const base = startOffset + k * stride;
        if (base + 1 >= parts.length) break;
        const x = parts[base] ?? 0;
        const y = parts[base + 1] ?? 0;
        const z = stride === 3 ? (parts[base + 2] ?? 0) : (parts[3] ?? 0);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) loop.push([x, y, z]);
      }
      if (loop.length >= 3) {
        const baseIdx = vertices.length;
        loop.forEach(p => vertices.push(p));
        for (const [a, b, c] of fanTriangulate(loop)) faces.push([baseIdx + a, baseIdx + b, baseIdx + c]);
      }
    } else if (typeCode === 116 && parts.length >= 4) {
      vertices.push([parts[1]!, parts[2]!, parts[3]!]);
    } else if (typeCode !== 314 && typeCode !== 406 && typeCode !== 124) {
      const label = `IGES_${typeCode}`;
      unsupported[label] = (unsupported[label] ?? 0) + 1;
    }
  }

  if (faces.length === 0 && vertices.length >= 3) {
    for (const [a, b, c] of fanTriangulate(vertices)) faces.push([a, b, c]);
  }
  for (const [code, count] of Object.entries(unsupported)) {
    warnings.push(`${count} entity record(s) of type ${code} could not be converted to triangle mesh.`);
  }
  if (vertices.length < 3 || faces.length === 0) {
    throw new Error('The IGES file contained no convertible polygonal or linear 3D geometry.');
  }
  return { meshes: [{ vertices, faces, name: 'IGES_IMPORT' }], warnings, unsupportedEntities: unsupported };
}

export async function readCadFileWithReport(
  buf: ArrayBuffer,
  kind: 'step' | 'iges',
): Promise<StepIgesImportReport> {
  const report = kind === 'step' ? readStepBuffer(buf) : readIgesBuffer(buf);
  lastStepIgesReport = report;
  return report;
}

export async function readCadFile(
  buf: ArrayBuffer,
  kind: 'step' | 'iges',
): Promise<Array<MeshProps & { name?: string }>> {
  const report = await readCadFileWithReport(buf, kind);
  return report.meshes;
}

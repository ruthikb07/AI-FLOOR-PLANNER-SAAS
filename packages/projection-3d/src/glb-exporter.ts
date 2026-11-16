/**
 * Pure TypeScript Binary glTF 2.0 (.glb) Exporter.
 *
 * Converts canonical Z-up millimeter BuildingScene meshes into Y-up meters
 * (* 0.001) binary glTF 2.0 containers without requiring Blender at runtime.
 */

import { MEP_MATERIALS, type Building } from '@ai-floor-planner/core';
import {
  projectBuildingScene,
  type BuildingScene,
  type SceneMesh,
} from './building-scene-projector';

interface MaterialPbrSpec {
  readonly baseColorFactor: [number, number, number, number];
  readonly metallicFactor: number;
  readonly roughnessFactor: number;
  readonly alphaMode?: 'BLEND' | 'OPAQUE';
}

function hexToLinearRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [toLinear(r), toLinear(g), toLinear(b)];
}

const ARCH_MATERIALS: Record<string, MaterialPbrSpec> = {
  MAT_Wall_Exterior: { baseColorFactor: [0.83, 0.76, 0.66, 1.0], metallicFactor: 0.0, roughnessFactor: 0.82 },
  MAT_Wall_Interior: { baseColorFactor: [0.88, 0.87, 0.82, 1.0], metallicFactor: 0.0, roughnessFactor: 0.85 },
  MAT_Concrete_Structural: { baseColorFactor: [0.38, 0.39, 0.40, 1.0], metallicFactor: 0.0, roughnessFactor: 0.90 },
  MAT_Glass_Aperture: {
    baseColorFactor: [0.82, 0.93, 0.98, 0.38],
    metallicFactor: 0.05,
    roughnessFactor: 0.05,
    alphaMode: 'BLEND',
  },
  MAT_Metal_Railing: { baseColorFactor: [0.12, 0.14, 0.16, 1.0], metallicFactor: 0.82, roughnessFactor: 0.26 },
  MAT_Floor_Tile: { baseColorFactor: [0.72, 0.68, 0.59, 1.0], metallicFactor: 0.0, roughnessFactor: 0.38 },
  MAT_Floor_Wet: { baseColorFactor: [0.36, 0.47, 0.49, 1.0], metallicFactor: 0.0, roughnessFactor: 0.52 },
  MAT_Door: { baseColorFactor: [0.22, 0.105, 0.045, 1.0], metallicFactor: 0.0, roughnessFactor: 0.60 },
};

function resolveMaterialSpec(name: string): MaterialPbrSpec {
  if (ARCH_MATERIALS[name]) return ARCH_MATERIALS[name]!;
  const mep = (MEP_MATERIALS as Record<string, { color: string; roughness: number; metalness: number }>)[name];
  if (mep) {
    const [r, g, b] = hexToLinearRgb(mep.color);
    return {
      baseColorFactor: [r, g, b, 1.0],
      metallicFactor: mep.metalness,
      roughnessFactor: mep.roughness,
    };
  }
  return { baseColorFactor: [0.82, 0.82, 0.80, 1.0], metallicFactor: 0.0, roughnessFactor: 0.75 };
}

function meshTrianglesToBuffers(mesh: SceneMesh): {
  positions: Float32Array;
  normals: Float32Array;
  min: [number, number, number];
  max: [number, number, number];
  vertexCount: number;
} | null {
  const geom = mesh.geometry?.faces?.length ? mesh.geometry : mesh.boolean?.base;
  if (!geom || !geom.vertices.length || !geom.faces.length) return null;

  const verts = geom.vertices;
  const validTriangles: Array<[number[], number[], number[]]> = [];

  for (const face of geom.faces) {
    if (!Array.isArray(face) || face.length < 3) continue;
    for (let k = 1; k + 1 < face.length; k++) {
      const i0 = face[0]!;
      const i1 = face[k]!;
      const i2 = face[k + 1]!;
      if (i0 === i1 || i1 === i2 || i0 === i2) continue;
      const v0 = verts[i0];
      const v1 = verts[i1];
      const v2 = verts[i2];
      if (!v0 || !v1 || !v2 || v0.length < 3 || v1.length < 3 || v2.length < 3) continue;
      validTriangles.push([v0, v1, v2]);
    }
  }

  if (validTriangles.length === 0) return null;

  const vertexCount = validTriangles.length * 3;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  let offset = 0;
  for (const [v0, v1, v2] of validTriangles) {
    // Canonical Z-up mm -> glTF Y-up meters (x = x*0.001, y = z*0.001, z = -y*0.001)
    const p0x = v0[0]! * 0.001;
    const p0y = v0[2]! * 0.001;
    const p0z = -v0[1]! * 0.001;

    const p1x = v1[0]! * 0.001;
    const p1y = v1[2]! * 0.001;
    const p1z = -v1[1]! * 0.001;

    const p2x = v2[0]! * 0.001;
    const p2y = v2[2]! * 0.001;
    const p2z = -v2[1]! * 0.001;

    const ux = p1x - p0x;
    const uy = p1y - p0y;
    const uz = p1z - p0z;
    const wx = p2x - p0x;
    const wy = p2y - p0y;
    const wz = p2z - p0z;

    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const nLen = Math.hypot(nx, ny, nz);
    if (nLen > 1e-8) {
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;
    } else {
      nx = 0;
      ny = 1;
      nz = 0;
    }

    const tri = [
      [p0x, p0y, p0z],
      [p1x, p1y, p1z],
      [p2x, p2y, p2z],
    ] as const;
    for (const [px, py, pz] of tri) {
      positions[offset] = px;
      positions[offset + 1] = py;
      positions[offset + 2] = pz;
      normals[offset] = nx;
      normals[offset + 1] = ny;
      normals[offset + 2] = nz;
      offset += 3;

      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (pz < minZ) minZ = pz;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
      if (pz > maxZ) maxZ = pz;
    }
  }

  return {
    positions,
    normals,
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    vertexCount,
  };
}

export function exportBuildingSceneToGlb(scene: BuildingScene): Uint8Array {
  const materialIndexMap = new Map<string, number>();
  const gltfMaterials: Array<Record<string, unknown>> = [];

  const getMaterialIndex = (name: string): number => {
    const key = name || 'MAT_Wall_Interior';
    const existing = materialIndexMap.get(key);
    if (existing !== undefined) return existing;
    const spec = resolveMaterialSpec(key);
    const idx = gltfMaterials.length;
    gltfMaterials.push({
      name: key,
      pbrMetallicRoughness: {
        baseColorFactor: spec.baseColorFactor,
        metallicFactor: spec.metallicFactor,
        roughnessFactor: spec.roughnessFactor,
      },
      ...(spec.alphaMode ? { alphaMode: spec.alphaMode } : {}),
      doubleSided: spec.alphaMode === 'BLEND',
    });
    materialIndexMap.set(key, idx);
    return idx;
  };

  const bufferViews: Array<Record<string, unknown>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  const gltfMeshes: Array<Record<string, unknown>> = [];
  const childNodes: Array<Record<string, unknown>> = [];
  const childNodeIndices: number[] = [];
  const binaryChunks: Uint8Array[] = [];
  let binByteLength = 0;

  const appendBin = (typed: Float32Array): { byteOffset: number; byteLength: number } => {
    const raw = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const byteOffset = binByteLength;
    binaryChunks.push(raw);
    binByteLength += raw.byteLength;
    return { byteOffset, byteLength: raw.byteLength };
  };

  const sourceMeshes: readonly SceneMesh[] = scene.meshes.length > 0
    ? scene.meshes
    : [
        {
          id: 'fallback_plinth',
          sourceEntityId: 'plinth',
          floorId: scene.floors[0]?.id ?? 'floor_0',
          buildingId: scene.buildingId,
          canonicalRevision: scene.canonicalRevision,
          kind: 'slab',
          material: 'MAT_Concrete_Structural',
          provenance: 'DERIVED_PRESENTATION',
          geometry: {
            vertices: [
              [0, 0, 0],
              [1000, 0, 0],
              [1000, 1000, 0],
              [0, 1000, 0],
            ],
            faces: [
              [0, 1, 2],
              [0, 2, 3],
            ],
          },
        },
      ];

  for (const sceneMesh of sourceMeshes) {
    const encoded = meshTrianglesToBuffers(sceneMesh);
    if (!encoded) continue;

    const posViewInfo = appendBin(encoded.positions);
    const posViewIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: posViewInfo.byteOffset,
      byteLength: posViewInfo.byteLength,
      target: 34962, // ARRAY_BUFFER
    });

    const normViewInfo = appendBin(encoded.normals);
    const normViewIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: normViewInfo.byteOffset,
      byteLength: normViewInfo.byteLength,
      target: 34962,
    });

    const posAccessorIdx = accessors.length;
    accessors.push({
      bufferView: posViewIdx,
      componentType: 5126, // FLOAT
      count: encoded.vertexCount,
      type: 'VEC3',
      min: encoded.min,
      max: encoded.max,
    });

    const normAccessorIdx = accessors.length;
    accessors.push({
      bufferView: normViewIdx,
      componentType: 5126,
      count: encoded.vertexCount,
      type: 'VEC3',
    });

    const matIdx = getMaterialIndex(sceneMesh.material);
    const meshIdx = gltfMeshes.length;
    gltfMeshes.push({
      name: sceneMesh.id,
      primitives: [
        {
          attributes: {
            POSITION: posAccessorIdx,
            NORMAL: normAccessorIdx,
          },
          material: matIdx,
        },
      ],
    });

    const nodeIdx = 1 + childNodes.length;
    childNodeIndices.push(nodeIdx);
    childNodes.push({
      name: sceneMesh.id,
      mesh: meshIdx,
      extras: {
        floorId: sceneMesh.floorId,
        kind: sceneMesh.kind,
        provenance: sceneMesh.provenance,
        canonicalRevision: sceneMesh.canonicalRevision,
      },
    });
  }

  // Pad binary buffer to 4-byte boundary per glTF 2.0 spec
  const paddedBinLength = Math.ceil(binByteLength / 4) * 4;
  const binPadding = paddedBinLength - binByteLength;
  const binBuffer = new Uint8Array(paddedBinLength);
  let cursor = 0;
  for (const chunk of binaryChunks) {
    binBuffer.set(chunk, cursor);
    cursor += chunk.byteLength;
  }

  const rootNode = {
    name: scene.buildingId || 'RH_Building',
    children: childNodeIndices,
    extras: {
      units: 'm',
      upAxis: 'Y',
      canonicalUnits: scene.units,
      canonicalRevision: scene.canonicalRevision,
    },
  };

  const gltfJson = {
    asset: {
      version: '2.0',
      generator: 'RH Planner Pure-TS glTF 2.0 Exporter',
    },
    scene: 0,
    scenes: [{ name: scene.buildingId || 'Scene', nodes: [0] }],
    nodes: [rootNode, ...childNodes],
    meshes: gltfMeshes,
    materials: gltfMaterials,
    bufferViews,
    accessors,
    buffers: [{ byteLength: paddedBinLength }],
  };

  const jsonRaw = new TextEncoder().encode(JSON.stringify(gltfJson));
  const paddedJsonLength = Math.ceil(jsonRaw.length / 4) * 4;
  const jsonChunk = new Uint8Array(paddedJsonLength);
  jsonChunk.fill(0x20); // ASCII space padding required for JSON chunk
  jsonChunk.set(jsonRaw, 0);

  const totalLength = 12 + 8 + paddedJsonLength + 8 + (paddedBinLength + (binPadding > 0 ? 0 : 0));
  const glb = new Uint8Array(totalLength);
  const view = new DataView(glb.buffer);

  // Header
  view.setUint32(0, 0x46546c67, true); // 'glTF'
  view.setUint32(4, 2, true); // version 2
  view.setUint32(8, totalLength, true);

  // JSON Chunk header
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f534a, true); // 'JSON'
  glb.set(jsonChunk, 20);

  // BIN Chunk header
  const binHeaderOffset = 20 + paddedJsonLength;
  view.setUint32(binHeaderOffset, paddedBinLength, true);
  view.setUint32(binHeaderOffset + 4, 0x004e4942, true); // 'BIN\0'
  glb.set(binBuffer, binHeaderOffset + 8);

  return glb;
}

export function exportBuildingToGlb(building: Building): Uint8Array {
  const scene = projectBuildingScene(building);
  return exportBuildingSceneToGlb(scene);
}


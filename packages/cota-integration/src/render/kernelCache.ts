/**
 * Pure-TypeScript Mesh Solid Kernel Adapter for Cota (`SOLIDKERNEL MESH`).
 *
 * Evaluates all 3D parametric solids (`BOX`, `CYLINDER`, `CONE`, `SPHERE`, `TORUS`,
 * `EXTRUDE`, `REVOLVE`, `UNION`, `SUBTRACT`, `INTERSECT`, `SLICE`, `FILLETEDGE`,
 * `CHAMFEREDGE`) through `three-bvh-csg` in `render/csg.ts` without bundling any
 * LGPL-2.1 `occt-wasm` WebAssembly binaries.
 */
import type { SolidProps } from '../core/document/types';

export interface OcctMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly surfaces: Float32Array;
  readonly edgePositions: Float32Array;
  readonly triGroup: Uint32Array;
  readonly spheres: ReadonlyArray<{ group: number; c: [number, number, number]; r: number }>;
  readonly volume: number;
}

export interface OcctStats {
  readonly evalMs: number;
  readonly meshMs: number;
  readonly volume: number;
}

export type KernelResult =
  | { ok: true; mesh: OcctMesh; stats: OcctStats & { initMs: number } }
  | { ok: false; op: string; message: string; size?: number };

export function persistentCacheAvailable(): boolean {
  return false;
}

export async function loadResults(_keys: string[]): Promise<Map<number | string, KernelResult>> {
  return new Map();
}

export function saveResult(_key: string, _res: KernelResult): void {
  // Mesh CSG cache is maintained directly in `render/csg.ts`.
}

export function clearPersistentCache(): Promise<void> {
  return Promise.resolve();
}

export type { SolidProps };

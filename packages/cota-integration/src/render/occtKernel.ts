/**
 * Pure-TypeScript Mesh Solid Kernel Coordinator (`SOLIDKERNEL MESH`).
 *
 * Reports exact OCCT B-Rep WASM kernel as disabled so `render/csg.ts` evaluates
 * every 3D solid deterministically with `three-bvh-csg` (MIT) and zero LGPL WASM.
 */
import type { SolidProps } from '../core/document/types';
import type { KernelResult } from './kernelCache';

export type { KernelResult };
export const KERNEL_TIMEOUT_MS = 20_000;
export const SPAWN_BACKLOG = 8;

type ResultsListener = (keys: string[]) => void;
type MessageListener = (line: string) => void;

const resultsListeners = new Set<ResultsListener>();
const messageListeners = new Set<MessageListener>();

export function onKernelResults(fn: ResultsListener): () => void {
  resultsListeners.add(fn);
  return () => resultsListeners.delete(fn);
}

export function onKernelMessage(fn: MessageListener): () => void {
  messageListeners.add(fn);
  return () => messageListeners.delete(fn);
}

export function kernelAvailable(): boolean {
  return false;
}

export function kernelResult(_key: string): KernelResult | undefined {
  return undefined;
}

export function maxWorkers(): number {
  return 1;
}

export function requestKernel(_key: string, _props: SolidProps): void {
  // Handled synchronously via `three-bvh-csg` mesh evaluator in `render/csg.ts`.
}

export function clearKernelResults(): void {
  // No-op when running in pure-TS mesh CSG mode.
}

import { runWorkerTask } from './worker-task';
import type { Building } from '@ai-floor-planner/core';
import { optimizeRoomArea, type RoomAreaRegenerationOptions, type RoomAreaOptimizationResult } from '@ai-floor-planner/planning-engine';

export function solveRoomArea(building: Building, roomId: string, options: RoomAreaRegenerationOptions, signal: AbortSignal): Promise<RoomAreaOptimizationResult> {
  if (signal.aborted) return Promise.reject(new Error('Room regeneration cancelled'));
  // Headless test environments have no Worker. Browsers use a dedicated worker.
  if (typeof Worker === 'undefined') return Promise.resolve(optimizeRoomArea(building, roomId, options));
  return runWorkerTask({
    start: () => new Worker(new URL('./room-area.worker.ts', import.meta.url), { type: 'module' }),
    input: { building, roomId, options },
    signal,
    timeoutMs: 120_000,
    label: 'Room regeneration',
    receive: data => {
      const response = data as { result?: RoomAreaOptimizationResult; error?: string } | null;
      if (!response?.result) throw new Error(response?.error ?? 'Empty solver response');
      return response.result;
    },
  });
}

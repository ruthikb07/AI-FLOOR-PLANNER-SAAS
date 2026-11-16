import type { Building } from '@ai-floor-planner/core';
import { optimizeRoomArea, type RoomAreaRegenerationOptions, type RoomAreaOptimizationResult } from '@ai-floor-planner/planning-engine';

export function solveRoomArea(building: Building, roomId: string, options: RoomAreaRegenerationOptions, signal: AbortSignal): Promise<RoomAreaOptimizationResult> {
  if (signal.aborted) return Promise.reject(new Error('Room regeneration cancelled'));
  // Headless test environments have no Worker. Browsers use a dedicated worker.
  if (typeof Worker === 'undefined') return Promise.resolve(optimizeRoomArea(building, roomId, options));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./room-area.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new Error('Room regeneration cancelled')); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: RoomAreaOptimizationResult; error?: string }>) => {
      finish();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? 'Empty solver response'));
    };
    worker.onerror = (event) => { finish(); reject(new Error(event.message)); };
    worker.postMessage({ building, roomId, options });
  });
}

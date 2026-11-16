import { afterEach, expect, it, vi } from 'vitest';
import type { Building } from '@ai-floor-planner/core';
import { solveRoomArea } from '../services/room-area-solver';
class TestWorker {
  static latest: TestWorker;
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: ErrorEvent) => void;
  terminate = vi.fn(); postMessage = vi.fn();
  constructor() { TestWorker.latest = this; }
}
afterEach(() => { vi.unstubAllGlobals(); });
it('terminates an in-flight worker on cancellation and ignores a late result', async () => {
  vi.stubGlobal('Worker', TestWorker);
  const abort = new AbortController();
  const pending = solveRoomArea({} as Building, 'room', { targetAreaMm2: 15e6 }, abort.signal);
  const rejected = expect(pending).rejects.toThrow(/cancelled/);
  abort.abort();
  TestWorker.latest.onmessage?.({ data: { result: { isFeasible: true } } } as MessageEvent);
  await rejected;
  expect(TestWorker.latest.terminate).toHaveBeenCalled();
});
it('returns a worker error without publishing candidates', async () => {
  vi.stubGlobal('Worker', TestWorker);
  const pending = solveRoomArea({} as Building, 'room', { targetAreaMm2: 15e6 }, new AbortController().signal);
  TestWorker.latest.onmessage?.({ data: { error: 'Solver rejected input' } } as MessageEvent);
  await expect(pending).rejects.toThrow('Solver rejected input');
  expect(TestWorker.latest.terminate).toHaveBeenCalledOnce();
});


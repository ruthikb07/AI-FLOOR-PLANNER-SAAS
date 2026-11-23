import { afterEach, expect, it, vi } from 'vitest';
import { runWorkerTask } from '../services/worker-task';

function start(signal = new AbortController().signal, postMessage = vi.fn()) {
  const worker = {
    terminate: vi.fn(), postMessage, onmessage: null, onmessageerror: null, onerror: null,
  } as unknown as Worker;
  const promise = runWorkerTask({
    signal, start: () => worker, timeoutMs: 100, input: {}, label: 'Generation',
    receive(data) {
      if (data === 'progress') return;
      if (data !== 'complete') throw new Error('Malformed result');
      return 'published';
    },
  });
  return { promise, worker };
}

afterEach(() => { vi.useRealTimers(); });

it('ends and terminates a silent worker after its deadline', async () => {
  vi.useFakeTimers();
  const { promise, worker } = start();
  const check = expect(promise).rejects.toThrow('Generation timed out');
  await vi.advanceTimersByTimeAsync(100);
  await check;
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(worker.onmessage).toBeNull();
});

it('cleans up workers on synchronous postMessage failure and unreadable responses', async () => {
  const failedSend = start(undefined, vi.fn(() => { throw new Error('Send failed'); }));
  await expect(failedSend.promise).rejects.toThrow('Send failed');
  expect(failedSend.worker.terminate).toHaveBeenCalledOnce();
  const unreadable = start();
  unreadable.worker.onmessageerror?.call(unreadable.worker, new MessageEvent('messageerror'));
  await expect(unreadable.promise).rejects.toThrow('returned unreadable data');
  expect(unreadable.worker.terminate).toHaveBeenCalledOnce();
});

it('ignores queued callbacks after cancellation and rejects malformed messages', async () => {
  const abort = new AbortController();
  const cancelled = start(abort.signal);
  const queued = cancelled.worker.onmessage;
  abort.abort();
  queued?.call(cancelled.worker, new MessageEvent('message', { data: 'complete' }));
  await expect(cancelled.promise).rejects.toMatchObject({ name: 'AbortError' });
  expect(cancelled.worker.terminate).toHaveBeenCalledOnce();

  const malformed = start();
  malformed.worker.onmessage?.call(malformed.worker, new MessageEvent('message', { data: 'unknown' }));
  await expect(malformed.promise).rejects.toThrow('Malformed result');
  expect(malformed.worker.terminate).toHaveBeenCalledOnce();
});

it('leaves progress running and terminates exactly once on success', async () => {
  const { promise, worker } = start();
  worker.onmessage?.call(worker, new MessageEvent('message', { data: 'progress' }));
  expect(worker.terminate).not.toHaveBeenCalled();
  worker.onmessage?.call(worker, new MessageEvent('message', { data: 'complete' }));
  await expect(promise).resolves.toBe('published');
  expect(worker.terminate).toHaveBeenCalledOnce();
});

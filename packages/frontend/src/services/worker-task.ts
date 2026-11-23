interface WorkerTask<T> {
  readonly start: () => Worker;
  readonly input: unknown;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly label: string;
  readonly receive: (data: unknown) => T | undefined;
}

/** Owns the worker, timeout and listeners until exactly one terminal result. */
export function runWorkerTask<T>(task: WorkerTask<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      task.signal.removeEventListener('abort', abort);
      if (worker) {
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        worker.terminate();
      }
      complete();
    };
    const fail = (error: unknown) => finish(() => reject(error));
    const abort = () => fail(new DOMException(`${task.label} cancelled.`, 'AbortError'));
    if (task.signal.aborted) {
      abort();
      return;
    }

    try {
      worker = task.start();
      task.signal.addEventListener('abort', abort, { once: true });
      worker.onmessage = event => {
        if (settled) return;
        try {
          const outcome = task.receive(event.data);
          if (outcome !== undefined) finish(() => resolve(outcome));
        } catch (error) {
          fail(error);
        }
      };
      worker.onerror = event => fail(new Error(event.message || `${task.label} worker stopped. Try again.`));
      worker.onmessageerror = () => fail(new Error(`${task.label} returned unreadable data. Try again.`));
      timer = setTimeout(() => fail(new Error(`${task.label} timed out. Try a smaller brief or run again.`)), task.timeoutMs);
      worker.postMessage(task.input);
    } catch (error) {
      fail(error);
    }
  });
}

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { PythonStructuralWorkerClient } from '../worker/python-structural-client.js';
import { evaluateSectionsWithConcreteProperties } from '../rcc/section-capacity-provider.js';

it('restarts the daemon after timeout, cancellation, process exit and protocol mismatch', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rh-structural-ipc-'));
  const script = path.join(directory, 'worker.py');
  const worker = new PythonStructuralWorkerClient();
  await writeFile(script, `
import json
import os
import sys
import time

for line in sys.stdin:
    req = json.loads(line)
    if req["action"] == "delay":
        time.sleep(15)
    if req["action"] == "exit":
        sys.exit(3)
    schema = "WRONG" if req["action"] == "bad-schema" else "CARBON4_PY_STRUCTURAL_V1"
    print(json.dumps(dict(ok=True, requestId=req["requestId"], schemaVersion=schema, pid=os.getpid())), flush=True)
`);
  vi.stubEnv('RH_CARBON4_WORKER_SCRIPT', script);
  try {
    const ping = () => worker.request({ action: 'ping' }, 5000);
    const [first, second] = await Promise.all([ping(), ping()]);
    expect(first.pid).toBe(second.pid);
    const timedOut = worker.request({ action: 'delay' }, 250);
    const queued = ping();
    await Promise.all([
      expect(timedOut).rejects.toThrow('timed out'),
      expect(queued).resolves.toMatchObject({ ok: true }),
    ]);
    const restarted = await ping();
    expect(restarted.pid).not.toBe(first.pid);
    const abort = new AbortController();
    const cancelled = worker.request({ action: 'delay' }, 5000, abort.signal);
    const queuedAfterCancel = ping();
    setTimeout(() => abort.abort(), 100);
    await expect(cancelled).rejects.toThrow('cancelled');
    expect((await queuedAfterCancel).pid).not.toBe(restarted.pid);
    expect((await ping()).pid).not.toBe(restarted.pid);
    await expect(worker.request({ action: 'exit' }, 5000)).rejects.toThrow(/exited|EPIPE/);
    await expect(worker.request({ action: 'bad-schema' }, 5000)).rejects.toThrow('invalid response');
    expect((await ping()).ok).toBe(true);

    const running = worker.request({ action: 'delay' }, 300);
    const queuedAbort = new AbortController();
    const dropped = worker.request({ action: 'exit' }, 5000, queuedAbort.signal);
    const survivor = ping();
    setTimeout(() => queuedAbort.abort(), 60);
    await Promise.all([
      expect(running).rejects.toThrow('timed out'),
      expect(dropped).rejects.toThrow('cancelled'),
      expect(survivor).resolves.toMatchObject({ ok: true }),
    ]);
  } finally {
    worker.dispose();
    vi.unstubAllEnvs();
    await rm(script, { force: true });
    await rm(directory, { recursive: true });
  }
}, 30_000);

it('reassembles bounded fiber batches in original demand order and requests section curves once', async () => {
  const worker = new PythonStructuralWorkerClient();
  const requests: { demands: readonly { id: string }[]; includeInteractionCurves: boolean; sectionId: string }[] = [];
  vi.spyOn(worker, 'request').mockImplementation(async payload => {
    const items = payload.items as typeof requests;
    requests.push(...items);
    return { ok: true, results: items.map(item => ({ sectionId: item.sectionId,
      interactionCurves: item.includeInteractionCurves ? 'first-response' : undefined,
      demandEvaluations: item.demands.map(demand => ({ id: demand.id })),
    })) } as never;
  });
  const demands = Array.from({ length: 19 }, (_, index) => ({ id: `d${index}`, puKn: index, muxKnM: 40, muyKnM: -40 }));
  const output = await evaluateSectionsWithConcreteProperties([{
    sectionId: 'rectangular-section', widthMm: 300, depthMm: 400, concreteGrade: 'M30', steelGrade: 'Fe500',
    bars: [], demands, includeInteractionCurves: true,
  }], worker);
  expect(requests.map(request => request.demands.length)).toEqual([4, 4, 4, 4, 3]);
  expect(requests.map(request => request.includeInteractionCurves)).toEqual([true, false, false, false, false]);
  expect(output.results[0]!.demandEvaluations.map(demand => demand.id)).toEqual(demands.map(demand => demand.id));
  expect(output.results[0]).toMatchObject({ interactionCurves: 'first-response' });
});

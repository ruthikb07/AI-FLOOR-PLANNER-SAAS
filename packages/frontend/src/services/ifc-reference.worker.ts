import { findBimClashes } from './bim-clash';
import { readIfcReference } from './ifc-reference';

type WorkerRequest =
  | { job: 'inspect'; bytes: ArrayBuffer }
  | { job: 'clash'; input: Parameters<typeof findBimClashes>[0] };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const request = event.data;
    if (request.job === 'inspect') self.postMessage({ model: readIfcReference(new Uint8Array(request.bytes)) });
    else if (request.job === 'clash') self.postMessage({ clashes: findBimClashes(request.input) });
    else throw new Error('IFC_WORKER_JOB_UNSUPPORTED');
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'IFC_REFERENCE_WORKER_FAILED' }); }
};

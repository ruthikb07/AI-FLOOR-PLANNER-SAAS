import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { serialize, deserialize } from 'node:v8';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import type { FullStructuralEvaluationSnapshot, ReviewedStructuralInputs, StructuralRegenerationSummary } from '@ai-floor-planner/structural-engine';
import { resolveLocalProjectsRoot } from './local-project-store.js';

export interface SavedEvaluation {
  readonly rebarOverrides?:import('@ai-floor-planner/structural-engine').FrameSynthesisOptions['rebarOverrides'];
  readonly solverBackends?: string;
  readonly snapshot: FullStructuralEvaluationSnapshot;
  readonly inputs: ReviewedStructuralInputs;
  readonly name: string;
  readonly analysisOptions: Readonly<Record<string, unknown>>;
  readonly regeneration?: StructuralRegenerationSummary;
}

const compress = promisify(gzip);
const decompress = promisify(gunzip);
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const root = () => path.join(resolveLocalProjectsRoot(), '.structural-evaluations');
const tables = ['loadCaseResults', 'combinationResults'] as const;

async function writePart(directory: string, value: unknown): Promise<string> {
  const bytes = await compress(serialize(value), { level: 1 });
  const hash = digest(bytes);
  await writeFile(path.join(directory, hash), bytes);
  return hash;
}

async function readPart(directory: string, hash: string) {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid structural evidence digest.');
  const bytes = await readFile(path.join(directory, hash));
  if (digest(bytes) !== hash) throw new Error('Structural evidence checksum mismatch.');
  return deserialize(await decompress(bytes));
}

async function publishEvaluation(staging: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(staging, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error;
      await delay(25 * 2 ** attempt);
    }
  }
}

export async function saveEvaluation(evaluation: SavedEvaluation): Promise<string> {
  const directory = root();
  await mkdir(directory, { recursive: true });
  const staging = await mkdtemp(path.join(directory, '.writing-'));
  try {
    const { system, solveEnvelope } = evaluation.snapshot;
    const backends = [...Object.values(solveEnvelope.loadCaseResults), ...Object.values(solveEnvelope.combinationResults)]
      .flatMap(result => result.diagnostics?.executionBackend ?? []);
    const solverBackends = [...new Set(backends)].sort().join(', ') || 'UNAVAILABLE';
    const header = await writePart(staging, { ...evaluation, solverBackends, snapshot: { ...evaluation.snapshot,
      solveEnvelope: { ...solveEnvelope, loadCaseResults: {}, combinationResults: {} } } });
    const cases = { loadCaseResults: {}, combinationResults: {} } as Record<typeof tables[number], Record<string, string>>;
    for (const table of tables) {
      for (const [key, value] of Object.entries(solveEnvelope[table])) cases[table][key] = await writePart(staging, value);
    }
    const manifest = JSON.stringify({ version: 1, nonce: randomUUID(), projectId: system.projectId,
      architecturalRevision: system.sourceArchitecturalRevision, architecturalDigest: system.sourceArchitecturalSha256,
      structuralRevision: system.structuralRevision, header, cases });
    const id = digest(manifest);
    await writeFile(path.join(staging, 'manifest.json'), manifest);
    await publishEvaluation(staging, path.join(directory, id));
    return id;
  } catch (error) {
    await rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => {});
    throw error;
  }
}

export async function readEvaluation(id: string, mode: 'full' | 'assistant' = 'full'): Promise<SavedEvaluation | undefined> {
  if (!/^[0-9a-f]{64}$/.test(id)) return undefined;
  const directory = path.join(root(), id);
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(directory, 'manifest.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  if (digest(bytes) !== id) throw new Error('Structural evaluation manifest checksum mismatch.');
  const manifest = JSON.parse(bytes.toString());
  if (manifest.version !== 1) throw new Error('Unsupported structural evaluation version.');
  const { solverBackends, ...evaluation }: SavedEvaluation = await readPart(directory, manifest.header);
  // Assistant responses use design totals and provenance from the hashed header.
  // Older evaluations have no stored backend summary and use their original case chunks.
  if (mode === 'assistant' && solverBackends !== undefined) return { ...evaluation, solverBackends };
  const cases = { loadCaseResults: {}, combinationResults: {} } as Record<typeof tables[number],
    Record<string, FullStructuralEvaluationSnapshot['solveEnvelope']['loadCaseResults'][string]>>;
  for (const table of tables) {
    for (const [key, hash] of Object.entries(manifest.cases[table] as Record<string, string>)) {
      cases[table][key] = await readPart(directory, hash);
    }
  }
  return { ...evaluation, snapshot: { ...evaluation.snapshot,
    solveEnvelope: { ...evaluation.snapshot.solveEnvelope, ...cases } } };
}


/** Additional analysis results are immutable siblings of the saved evaluation. */
export async function saveCoupledReceipt(evaluationId: string, receipt: object): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(evaluationId)) throw new Error('Invalid evaluation identifier.');
  const directory = path.join(root(),evaluationId,'coupled-gravity');
  await mkdir(directory,{recursive:true});
  const stage = await mkdtemp(path.join(directory,'.writing-'));
  try {
    const hash = await writePart(stage,receipt);
    const name = path.join(directory,hash);
    await rename(path.join(stage,hash),name).catch(async error=>{
      if (!['EEXIST','EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await readPart(directory,hash);
    });
    return hash;
  } finally { await rm(stage,{recursive:true,force:true}); }
}

export async function loadCoupledReceipt(evaluationId: string, resultId: string): Promise<unknown> {
  if (![evaluationId,resultId].every(id=>/^[0-9a-f]{64}$/.test(id))) return undefined;
  try { return await readPart(path.join(root(),evaluationId,'coupled-gravity'),resultId); }
  catch (error) { if ((error as NodeJS.ErrnoException).code==='ENOENT') return undefined; throw error; }
}

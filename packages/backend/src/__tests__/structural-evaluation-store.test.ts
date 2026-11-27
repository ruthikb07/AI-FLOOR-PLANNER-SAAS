import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { saveEvaluation, type SavedEvaluation } from '../services/structural-evaluation-store';

const { beforeRename } = vi.hoisted(() => ({ beforeRename: vi.fn() }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...fs,
    rename: async (...args: Parameters<typeof fs.rename>) => {
      beforeRename();
      return fs.rename(...args);
    },
  };
});

it('recovers the original revision and load cases after eviction and module restart, and rejects altered bytes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rh-evaluation-store-'));
  vi.stubEnv('RH_LOCAL_PROJECTS_DIR', root);
  try {
    // Storage-only fixture. The opaque payload includes a typed array to exercise lossless replay.
    const payload = { name: 'persistence fixture', inputs: {}, analysisOptions: { foundationPreference: 'AUTO' },
      snapshot: { system: { projectId: 'p', sourceArchitecturalRevision: 4, sourceArchitecturalSha256: 'a'.repeat(64), structuralRevision: 2 },
        solveEnvelope: { loadCaseResults: { DL: { sample: new Float64Array([0.25]), diagnostics: { executionBackend: 'AWATIF_CPP_WASM' } } }, combinationResults: {} } } };
    beforeRename.mockImplementationOnce(() => {
      throw Object.assign(new Error('Transient Windows directory lock'), { code: 'EPERM' });
    });
    const ids = await Promise.all(Array.from({ length: 6 }, () => saveEvaluation(payload as unknown as SavedEvaluation)));
    expect(new Set(ids).size).toBe(6);
    expect(beforeRename).toHaveBeenCalledTimes(7);
    vi.resetModules();
    const { readEvaluation } = await import('../services/structural-evaluation-store');
    const id = ids[0]!;
    expect(await readEvaluation(id)).toEqual(payload);
    expect(await readEvaluation('../manifest.json')).toBeUndefined();
    const directory = path.join(root, '.structural-evaluations', id);
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    await writeFile(path.join(directory, manifest.cases.loadCaseResults.DL), 'changed bytes');
    await expect(readEvaluation(id)).rejects.toThrow('checksum mismatch');
    const assistant = await readEvaluation(id, 'assistant');
    expect(assistant?.solverBackends).toBe('AWATIF_CPP_WASM');
    expect(assistant?.snapshot.solveEnvelope.loadCaseResults).toEqual({});
    expect(assistant?.snapshot.system).toEqual(payload.snapshot.system);
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

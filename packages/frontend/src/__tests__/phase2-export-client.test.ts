import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  canonicalRevisionJson,
  createBuilding,
  type ExportFileDescriptor,
} from '@ai-floor-planner/core';
import { requestVerifiedExport, fetchVerifiedBytes } from '../services/export-client';
afterEach(() => {
  vi.unstubAllGlobals();
});
it('matches the canonical hash, revision, checksum and byte count before accepting bytes', async () => {
  const building = createBuilding({
    projectId: 'client',
    name: 'Client',
    site: { plotWidth: 30000, plotDepth: 40000 },
  });
  const bytes = new TextEncoder().encode('real artifact bytes');
  const descriptor: ExportFileDescriptor = {
    fileId: 'a',
    fileName: 'verified.pdf',
    fileType: 'PDF',
    discipline: 'ARCHITECTURAL',
    title: 'Verified',
    mimeType: 'application/pdf',
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    revision: building.version,
    buildingId: building.id,
    revisionHash: createHash('sha256').update(canonicalRevisionJson(building)).digest('hex'),
    verification: { isValid: true, errors: [], checks: {} },
    downloadUrl: '/verified',
  };
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ artifact: descriptor }) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => bytes.buffer })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ artifact: { ...descriptor, revisionHash: 'stale' } }),
      }),
  );
  expect(await requestVerifiedExport(building, 'pdf')).toEqual(descriptor);
  expect((await fetchVerifiedBytes(descriptor)).size).toBe(bytes.length);
  await expect(fetchVerifiedBytes(descriptor)).rejects.toThrow('checksum mismatch');
  await expect(requestVerifiedExport(building, 'pdf')).rejects.toThrow('Unverified or stale');
});

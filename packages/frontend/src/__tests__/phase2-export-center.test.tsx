// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuilding, createFloor, type ExportFileDescriptor } from '@ai-floor-planner/core';
import type { EditorContextValue } from '../stores/editor-store';
import { ExportCenterWorkspace } from '../components/argon/ExportCenterWorkspace';
import {
  requestVerifiedExport,
  downloadVerifiedExport,
  fetchVerifiedBytes,
} from '../services/export-client';
vi.mock('../services/export-client', () => ({
  requestVerifiedExport: vi.fn(),
  downloadVerifiedExport: vi.fn(),
  fetchVerifiedBytes: vi.fn(),
}));

describe('Phase 2 live export controls', () => {
  let root: Root, host: HTMLDivElement;
  const base = createBuilding({
    projectId: 'phase2-ui',
    name: 'UI canonical',
    site: { plotWidth: 30000, plotDepth: 40000 },
  });
  const building = {
    ...base,
    version: 4,
    floors: [
      createFloor({ buildingId: base.id, level: 0, name: 'Ground Stilt Parking' }),
      createFloor({ buildingId: base.id, level: 1, name: '1st Floor' }),
      createFloor({ buildingId: base.id, level: 2, name: 'Terrace Plan' }),
    ],
  };
  const descriptor: ExportFileDescriptor = {
    fileId: 'a',
    fileName: 'verified.dxf',
    fileType: 'DXF',
    discipline: 'ARCHITECTURAL',
    title: 'Verified',
    mimeType: 'application/dxf',
    sizeBytes: 12345,
    sha256: 'a'.repeat(64),
    revision: 4,
    buildingId: building.id,
    verification: { isValid: true, errors: [], checks: {} },
    downloadUrl: '/verified',
  };
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vi.mocked(requestVerifiedExport).mockResolvedValue(descriptor);
    vi.mocked(fetchVerifiedBytes).mockResolvedValue(
      Object.assign(new Blob(['verified'], { type: 'application/pdf' }), {
        text: async () => '{"verified":true}',
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['<svg/>'], { type: 'image/svg+xml' }),
      }),
    );
    URL.createObjectURL = vi.fn().mockReturnValue('blob:verified');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });
  const mount = async (b = building) =>
    act(async () =>
      root.render(
        <ExportCenterWorkspace editor={{ building: b } as unknown as EditorContextValue} />,
      ),
    );
  it('every active Preview and Independent Download button invokes its actual artifact action', async () => {
    await mount();
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-label]'));
    expect(buttons.length).toBe(44); // site + 3 floors + structural + complete, 3 formats each; reports 2 formats; two actions
    for (const button of buttons) {
      await act(async () => button.click());
      expect(requestVerifiedExport).toHaveBeenLastCalledWith(
        building,
        expect.any(String),
        expect.objectContaining({ paperSize: 'A3', scale: 'FIT_TO_PAGE' }),
        expect.any(AbortSignal),
      );
      if (button.getAttribute('aria-label')!.startsWith('Download'))
        expect(downloadVerifiedExport).toHaveBeenLastCalledWith(
          descriptor,
          expect.any(AbortSignal),
        );
      else {
        expect(host.querySelector('[role="dialog"]')).not.toBeNull();
        await act(async () =>
          Array.from(host.querySelectorAll('button'))
            .find((b) => b.textContent === 'Close preview')!
            .click(),
        );
      }
    }
    expect(requestVerifiedExport).toHaveBeenCalledTimes(buttons.length);
    expect(host.textContent).toContain(
      'VERIFIED · 12345 bytes · SHA-256 aaaaaaaaaaaaaaaa · revision 4',
    );
    expect(host.textContent).toContain('UDCPR 2020 Statutory Compliance Report');
    expect(host.textContent).toContain('UNAVAILABLE (PENDING PHASE 5)');
    expect(host.textContent).toContain('UNAVAILABLE (PENDING PHASE 6)');
    expect(host.querySelectorAll('button:disabled')).toHaveLength(4);
  });
  it('invalidates generated artifacts and rejects an in-flight old revision', async () => {
    await mount();
    let resolve!: (value: ExportFileDescriptor) => void;
    vi.mocked(requestVerifiedExport).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label^="Download"]')!.click(),
    );
    await mount({ ...building, version: 5 });
    await act(async () => resolve(descriptor));
    expect(downloadVerifiedExport).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('12345 bytes');
    expect(host.textContent).toContain('revision 5');
  });
  it('displays a failure and never reports success for a failed real export', async () => {
    vi.mocked(requestVerifiedExport).mockRejectedValueOnce(new Error('Reader rejected artifact'));
    await mount();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label^="Download"]')!.click(),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Reader rejected artifact');
    expect(host.textContent).not.toContain('VERIFIED ·');
    expect(downloadVerifiedExport).not.toHaveBeenCalled();
  });
});

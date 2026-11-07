import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MINIMAL_DXF } from '../services/advanced-export';

/**
 * Phase 1 download-path tests.
 *
 * These tests verify:
 * 1. MINIMAL_DXF constant matches the exact expected content.
 * 2. downloadTextFile creates a Blob with the correct content and filename,
 *    and does NOT revoke the URL immediately.
 *
 * Since we run in a Node environment (no jsdom), we mock the global
 * document/URL APIs to verify the helper's behavior programmatically.
 */

// Mock DOM globals that downloadTextFile depends on
function setupDomMocks() {
  const createdAnchors: Array<{ href: string; download: string; style: any; click: () => void }> = [];
  const createdDivs: Array<{ style: any; setAttribute: (k: string, v: string) => void; appendChild: (c: any) => void; remove: () => void; parentNode: any }> = [];
  const revokedUrls: string[] = [];
  let blobUrlCounter = 0;

  const mockCreateObjectURL = vi.fn((_blob: Blob) => {
    blobUrlCounter++;
    return `blob:mock-${blobUrlCounter}`;
  });
  const mockRevokeObjectURL = vi.fn((url: string) => {
    revokedUrls.push(url);
  });

  const mockCreateElement = vi.fn((tag: string) => {
    if (tag === 'a') {
      const anchor = {
        href: '',
        download: '',
        style: { display: '' },
        click: vi.fn(),
        rel: '',
        setAttribute: vi.fn(),
      };
      createdAnchors.push(anchor as any);
      return anchor;
    }
    // div or button or span
    const el = {
      style: { cssText: '' },
      textContent: '',
      setAttribute: vi.fn(),
      appendChild: vi.fn(),
      addEventListener: vi.fn(),
      remove: vi.fn(),
      parentNode: null,
    };
    createdDivs.push(el as any);
    return el;
  });

  const mockBody = {
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  };

  // Set up globals
  (globalThis as any).document = {
    createElement: mockCreateElement,
    body: mockBody,
  };
  (globalThis as any).URL = {
    createObjectURL: mockCreateObjectURL,
    revokeObjectURL: mockRevokeObjectURL,
  };
  (globalThis as any).Blob = class MockBlob {
    parts: any[];
    options: any;
    size: number;
    type: string;
    constructor(parts: any[], options?: any) {
      this.parts = parts;
      this.options = options;
      this.size = parts.reduce((acc: number, p: any) => acc + (typeof p === 'string' ? p.length : 0), 0);
      this.type = options?.type || '';
    }
    async text() {
      return this.parts.join('');
    }
  };

  return {
    createdAnchors,
    createdDivs,
    revokedUrls,
    mockCreateObjectURL,
    mockRevokeObjectURL,
    mockBody,
    mockCreateElement,
  };
}

describe('Phase 1 download-path proof', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleSpy.mockRestore();
    delete (globalThis as any).document;
    delete (globalThis as any).URL;
  });

  it('MINIMAL_DXF matches the exact expected DXF content', () => {
    const expected =
      '0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n30\n0.0\n11\n100.0\n21\n100.0\n31\n0.0\n0\nENDSEC\n0\nEOF\n';
    expect(MINIMAL_DXF).toBe(expected);
    expect(MINIMAL_DXF).toContain('SECTION');
    expect(MINIMAL_DXF).toContain('ENTITIES');
    expect(MINIMAL_DXF).toContain('LINE');
    expect(MINIMAL_DXF).toContain('ENDSEC');
    expect(MINIMAL_DXF).toContain('EOF');
    // Verify each token is on its own line
    const lines = MINIMAL_DXF.split('\n');
    expect(lines[0]).toBe('0');
    expect(lines[1]).toBe('SECTION');
    expect(lines[2]).toBe('2');
    expect(lines[3]).toBe('ENTITIES');
  });

  it('downloadTextFile creates Blob with correct content, sets filename on anchor, and does NOT revoke URL immediately', async () => {
    const mocks = setupDomMocks();

    // Dynamically import AFTER mocks are in place
    const { downloadTextFile } = await import('../services/advanced-export');

    downloadTextFile('AI_BUILDING_SAAS_TEST.dxf', MINIMAL_DXF, 'application/dxf');

    // 1. Verify Blob was created (URL.createObjectURL was called)
    expect(mocks.mockCreateObjectURL).toHaveBeenCalled();
    const firstBlobArg = mocks.mockCreateObjectURL.mock.calls[0]![0];
    // Verify the blob content
    const blobText = await firstBlobArg.text();
    expect(blobText).toBe(MINIMAL_DXF);
    expect(firstBlobArg.type).toBe('application/dxf');
    expect(firstBlobArg.size).toBe(MINIMAL_DXF.length);

    // 2. Verify an anchor was created with the correct download filename
    expect(mocks.createdAnchors.length).toBeGreaterThanOrEqual(1);
    const mainAnchor = mocks.createdAnchors[0]!;
    expect(mainAnchor.download).toBe('AI_BUILDING_SAAS_TEST.dxf');
    expect(mainAnchor.href).toBe('blob:mock-1');

    // 3. Verify anchor.click() was called
    expect(mainAnchor.click).toHaveBeenCalledOnce();

    // 4. Verify URL was NOT revoked immediately
    expect(mocks.mockRevokeObjectURL).not.toHaveBeenCalled();

    // 5. Verify URL IS revoked after ~2000ms
    vi.advanceTimersByTime(2100);
    expect(mocks.mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-1');

    // 6. Verify console.log was called with filename info
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('AI_BUILDING_SAAS_TEST.dxf')
    );
  });

  it('sanitizes filenames to safe characters', async () => {
    const mocks = setupDomMocks();
    const { downloadTextFile } = await import('../services/advanced-export');

    downloadTextFile('bad<>:"/|?*file.dxf', 'test', 'text/plain');

    const anchor = mocks.createdAnchors[0]!;
    // All unsafe chars should be replaced with underscores
    expect(anchor.download).not.toMatch(/[<>:"/|?*]/);
    expect(anchor.download).toMatch(/\.dxf$/);
  });
});

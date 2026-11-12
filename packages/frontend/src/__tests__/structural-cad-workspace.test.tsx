// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuilding, createFloor, type ExportFileDescriptor } from '@ai-floor-planner/core';
import type { EditorContextValue } from '../stores/editor-store';
import { StructuralCADWorkspace } from '../components/argon/StructuralCADWorkspace';
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

describe('StructuralCADWorkspace Component', () => {
  let root: Root, host: HTMLDivElement;
  const base = createBuilding({
    projectId: 'str-ui-test',
    name: 'RH Skyview Heights',
    site: { plotWidth: 18000, plotDepth: 25000 },
  });
  const building = {
    ...base,
    version: 2,
    floors: [
      createFloor({ buildingId: base.id, level: 0, name: 'Foundation / Stilt' }),
      createFloor({ buildingId: base.id, level: 1, name: 'Typical Floor 1' }),
      createFloor({ buildingId: base.id, level: 2, name: 'Typical Floor 2' }),
    ],
  };

  const descriptor: ExportFileDescriptor = {
    fileId: 'str-desc-1',
    fileName: 'RH_Planner_str_drawings.pdf',
    fileType: 'PDF',
    discipline: 'STRUCTURAL',
    title: 'Structural CAD Drawings S-101 to S-104',
    mimeType: 'application/pdf',
    sizeBytes: 15432,
    sha256: 'b'.repeat(64),
    revision: 2,
    buildingId: building.id,
    verification: { isValid: true, errors: [], checks: {} },
    downloadUrl: '/str-download',
  };

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vi.mocked(requestVerifiedExport).mockResolvedValue(descriptor);
    vi.mocked(fetchVerifiedBytes).mockResolvedValue(
      new Blob(['fake-pdf-bytes'], { type: 'application/pdf' }),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  const mount = async () => {
    await act(async () => {
      root.render(
        <StructuralCADWorkspace editor={{ building } as unknown as EditorContextValue} />,
      );
    });
  };

  it('renders structural workspace header with engineering badges and discipline title', async () => {
    await mount();
    expect(host.textContent).toContain('05 • STRUCTURAL CAD & FRAMING');
    expect(host.textContent).toContain('IS 456 / IS 1893:2016');
    expect(host.textContent).toContain('ETABS v23.3.2 OAPI');
    expect(host.textContent).toContain('RH Skyview Heights');
  });

  it('renders view mode switcher buttons and switches active view', async () => {
    await mount();
    const fndBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Foundation & Columns'));
    expect(fndBtn).toBeDefined();

    const beamBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Beam Framing'));
    expect(beamBtn).toBeDefined();

    const slabBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Slab Detailing'));
    expect(slabBtn).toBeDefined();

    const etabsBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('ETABS Drift & Stress'));
    expect(etabsBtn).toBeDefined();

    // Click Beam Framing
    await act(async () => beamBtn?.click());
    expect(host.querySelector('#beams-layer')).not.toBeNull();
  });

  it('displays structural analysis ledger with IS 1893 drift check and SE-1 BLOCKED status', async () => {
    await mount();
    expect(host.textContent).toContain('IS 1893:2016 Drift Check');
    expect(host.textContent).toContain('Column Schedule (IS 456)');
    expect(host.textContent).toContain('Beam Framing (IS 13920)');
    expect(host.textContent).toContain('CONSTRUCTION STATUS: BLOCKED');
    expect(host.textContent).toContain('Registered Structural Engineer (SE-1)');
  });

  it('triggers verified export on clicking download drawings and analysis report buttons', async () => {
    await mount();
    const downloadDrawingsBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Drawings (A3 PDF)'));
    expect(downloadDrawingsBtn).toBeDefined();

    await act(async () => downloadDrawingsBtn?.click());
    expect(requestVerifiedExport).toHaveBeenCalledWith(
      building,
      'structural-drawings-pdf',
      expect.objectContaining({ drawingKind: 'STRUCTURAL' }),
      expect.any(AbortSignal),
    );
    expect(downloadVerifiedExport).toHaveBeenCalledWith(descriptor, expect.any(AbortSignal));

    const downloadReportBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Analysis Report'));
    expect(downloadReportBtn).toBeDefined();

    await act(async () => downloadReportBtn?.click());
    expect(requestVerifiedExport).toHaveBeenCalledWith(
      building,
      'structural-report-pdf',
      expect.objectContaining({ drawingKind: 'STRUCTURAL' }),
      expect.any(AbortSignal),
    );
  });
});

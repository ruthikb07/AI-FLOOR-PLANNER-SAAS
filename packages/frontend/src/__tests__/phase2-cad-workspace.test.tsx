// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ColumnShape, createGenerationControlState } from '@ai-floor-planner/core';
import { ArchitecturalCADWorkspace } from '../components/argon/ArchitecturalCADWorkspace';
import { createCanonical30x50_2BHK } from '../services/storage';
import type { EditorContextValue } from '../stores/editor-store';
import { requestVerifiedExport, downloadVerifiedExport } from '../services/export-client';
vi.mock('../services/export-client', () => ({
  requestVerifiedExport: vi.fn(),
  downloadVerifiedExport: vi.fn(),
}));

it('filters real canvas layers independently, selects properties, uses actual floor tabs and exports the active revision', async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const original = createCanonical30x50_2BHK();
  const base = original.floors[0]!;
  const floor = {
    ...base,
    columns: [
      {
        id: 'column-1',
        floorId: base.id,
        position: { x: 1000, y: 1000 },
        width: 230,
        depth: 450,
        shape: ColumnShape.Rectangular,
        isStructural: true,
        gridReference: 'C1',
      },
    ],
    beams: [
      {
        id: 'beam-1',
        floorId: base.id,
        startPoint: { x: 1000, y: 1000 },
        endPoint: { x: 4000, y: 1000 },
        widthMm: 230,
        depthMm: 450,
        type: 'PRIMARY' as const,
      },
    ],
    furniture: [
      {
        id: 'furniture-1',
        roomId: base.rooms[0]!.id,
        type: 'bed' as const,
        xMm: 1000,
        yMm: 2000,
        widthMm: 1500,
        depthMm: 2000,
        rotationDeg: 0 as const,
        layer: 'A-FURN' as const,
      },
    ],
  };
  const building = {
    ...original,
    floors: [floor, { ...floor, id: 'second-floor', name: 'Actual second floor', level: 1 }],
  };
  const editor = {
    building,
    activeFloor: floor,
    selection: null,
    selections: [],
    activeTool: 'select',
    generationControl: createGenerationControlState(),
    diagnostics: { warnings: [], errors: [], infos: [] },
    switchFloor: vi.fn(),
    selectEntity: vi.fn(),
    clearSelection: vi.fn(),
  } as unknown as EditorContextValue;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ArchitecturalCADWorkspace editor={editor} />));
    const canvas = () => host.querySelector('.floor-plan')!;
    expect(host.querySelectorAll('[aria-label="Model floors"] button')).toHaveLength(2);
    const controls = host.querySelector('[aria-label="CAD layers"]')!;
    for (const [label, selector] of [
      ['Walls', '.layer-walls'],
      ['Columns', '.layer-columns'],
      ['Beams', '.layer-beams'],
      ['Doors/Windows', '.layer-openings'],
      ['Furniture', '.layer-furniture'],
      ['Staircases', '.layer-stairs'],
      ['Dimensions', '.layer-annotations'],
    ]) {
      expect(canvas().querySelector(selector!)).not.toBeNull();
      const button = Array.from(controls.querySelectorAll('button')).find(
        (b) => b.textContent === label,
      )!;
      await act(async () => button.click());
      expect(canvas().querySelector(selector!)).toBeNull();
      await act(async () => button.click());
      expect(canvas().querySelector(selector!)).not.toBeNull();
    }
    await act(async () =>
      canvas()
        .querySelector('[data-entity-type="column"]')!
        .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50 })),
    );
    expect(editor.selectEntity).toHaveBeenCalledWith('column', 'column-1', floor.id);
    await act(async () =>
      root.render(
        <ArchitecturalCADWorkspace
          editor={{
            ...editor,
            selection: { entityType: 'column', entityId: 'column-1', floorId: floor.id },
          }}
        />,
      ),
    );
    expect(host.textContent).toContain('Column C1');
    expect(host.textContent).toContain('230 x 450 mm');
    await act(async () =>
      Array.from(host.querySelectorAll('[aria-label="Model floors"] button'))
        .find((b) => b.textContent === 'Actual second floor')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(editor.switchFloor).toHaveBeenCalledWith('second-floor');
    vi.mocked(requestVerifiedExport).mockResolvedValue({
      fileId: 'a',
      fileName: 'real.pdf',
      fileType: 'PDF',
      discipline: 'ARCHITECTURAL',
      title: 'Verified',
      mimeType: 'application/pdf',
      sizeBytes: 3000,
      sha256: 'a'.repeat(64),
    });
    for (const format of ['dwg', 'dxf', 'pdf']) {
      await act(async () =>
        Array.from(host.querySelectorAll('button'))
          .find((b) => b.textContent === `Export ${format.toUpperCase()}`)!
          .click(),
      );
      expect(requestVerifiedExport).toHaveBeenLastCalledWith(
        building,
        format,
        { floorId: floor.id, scale: 'FIT_TO_PAGE' },
        expect.any(AbortSignal),
      );
    }
    expect(downloadVerifiedExport).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

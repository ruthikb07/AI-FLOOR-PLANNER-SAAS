// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  createBuilding,
  createGenerationControlState,
  type Building,
} from '@ai-floor-planner/core';
import { solveMultiSheetApartmentProject } from '@ai-floor-planner/planning-engine';
import { ArchitecturalCADWorkspace } from '../components/argon/ArchitecturalCADWorkspace';
import { InteractivePlanEditorPage } from '../components/argon/InteractivePlanEditorPage';
import { ETABSExportPanel } from '../components/argon/ETABSExportPanel';
import type { EditorContextValue } from '../stores/editor-store';

function createSampleApartmentBuilding(): Building {
  return solveMultiSheetApartmentProject({
    plotWidthMm: 44_000,
    plotDepthMm: 34_000,
    roadWidthMm: 12_000,
    roadAccessSides: [Direction.South],
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'pune_pmc',
    verticalStackType: 'STILT_PLUS_N',
    numTypicalFloors: 2,
    floorToFloorHeightMm: 3000,
    stiltHeightMm: 3000,
    flatsPerFloor: 4,
    units: [
      { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true, targetCarpetSqFt: 1300 },
      { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true, targetCarpetSqFt: 1300 },
      { unitIndex: 3, bhkType: '3BHK', hasUtilityBalcony: true, targetCarpetSqFt: 1600 },
      { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true, targetCarpetSqFt: 1600 },
    ],
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
    visitorParkingPercent: 10,
    setbacksMm: { front: 2000, rear: 2000, left: 2000, right: 2000 },
    includeWindowChajjas: true,
  }).building;
}

function createEditorMock(building: Building, overrides: Partial<EditorContextValue> = {}): EditorContextValue {
  const typicalFloor = building.floors.find((f) => f.floorUse === 'RESIDENTIAL') ?? building.floors[0]!;
  return {
    building,
    activeFloor: typicalFloor,
    selection: null,
    selections: [],
    activeTool: 'select',
    generationControl: createGenerationControlState(),
    diagnostics: { warnings: [], errors: [], infos: [] },
    validationSummary: { valid: true, errorCount: 0, warningCount: 0, issues: [] },
    canUndo: false,
    canRedo: false,
    switchFloor: vi.fn(),
    selectEntity: vi.fn(),
    clearSelection: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    executeCommand: vi.fn(),
    applyRefinement: vi.fn(),
    ...overrides,
  } as unknown as EditorContextValue;
}

describe('RH Planner Phase 4 — Edit Plan Studio, Top Discipline Bar & ETABS Import Guide', () => {
  const mountedRoots: Array<{ root: Root; host: HTMLElement }> = [];

  afterEach(async () => {
    while (mountedRoots.length > 0) {
      const item = mountedRoots.pop()!;
      await act(async () => item.root.unmount());
      item.host.remove();
    }
  });

  async function renderIntoHost(element: React.ReactElement): Promise<HTMLElement> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mountedRoots.push({ root, host });
    await act(async () => root.render(element));
    return host;
  }

  it('1. renders prominent Edit Plan action and all 6 discipline switcher buttons beside floor tabs without polluting [aria-label="Model floors"]', async () => {
    const building = createSampleApartmentBuilding();
    const editor = createEditorMock(building);
    const onOpenEditPlan = vi.fn();

    const host = await renderIntoHost(
      <ArchitecturalCADWorkspace editor={editor} onOpenEditPlan={onOpenEditPlan} />,
    );

    const floorTabs = host.querySelector('[aria-label="Model floors"]');
    expect(floorTabs).not.toBeNull();
    expect(floorTabs!.querySelectorAll('button')).toHaveLength(building.floors.length);

    const disciplineToolbar = host.querySelector('[aria-label="Engineering discipline overlay switcher"]');
    expect(disciplineToolbar).not.toBeNull();
    expect(floorTabs!.contains(disciplineToolbar)).toBe(false);

    const expectedLabels = [
      'Architectural Plan',
      'Structural + Chajja Plan',
      'Electrical Plan (M-ELEC)',
      'Plumbing & OTS Duct Plan (M-PLUMB)',
      'Fire Safety Plan (F-FIRE)',
      'False Ceiling Plan (A-CEIL)',
    ];
    for (const label of expectedLabels) {
      const btn = Array.from(disciplineToolbar!.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === label,
      );
      expect(btn, `Missing discipline switcher button: ${label}`).toBeDefined();
    }

    const editPlanBtn = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Edit Plan',
    );
    expect(editPlanBtn).toBeDefined();
    await act(async () => editPlanBtn!.click());
    expect(onOpenEditPlan).toHaveBeenCalledTimes(1);
  });

  it('2. renders InteractivePlanEditorPage with Mode A checkbox and runs Mode B "Regenerate Similar (Keep Edited Ratios)" to call editor.applyRefinement', async () => {
    const building = createSampleApartmentBuilding();
    const applyRefinement = vi.fn();
    const onBackToCad = vi.fn();
    const editor = createEditorMock(building, { applyRefinement });

    const host = await renderIntoHost(
      <InteractivePlanEditorPage editor={editor} onBackToCad={onBackToCad} />,
    );

    expect(host.textContent).toContain('03 · Interactive Plan Editor Studio');
    expect(host.textContent).toContain('Expand External Boundary into Setback');

    const applyRoomSizeBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Apply Room Size'),
    );
    expect(applyRoomSizeBtn).toBeDefined();

    const expandOutBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('+300mm Out'),
    );
    expect(expandOutBtn).toBeDefined();

    const targetSqFtInput = host.querySelector('input[aria-label="Target Area Per Flat (sq.ft.)"]') as
      | HTMLInputElement
      | null;
    if (targetSqFtInput) {
      await act(async () => {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        nativeSetter.call(targetSqFtInput, '1385');
        targetSqFtInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    const regenBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Regenerate Similar (Keep Edited Ratios)'),
    );
    expect(regenBtn).toBeDefined();
    await act(async () => regenBtn!.click());

    expect(applyRefinement).toHaveBeenCalledTimes(1);
    const [updatedBuilding, reason] = applyRefinement.mock.calls[0]!;
    expect(updatedBuilding).toBeDefined();
    expect(String(reason)).toContain('Keep Edited Ratios');

    const backBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Done Editing'),
    );
    expect(backBtn).toBeDefined();
    await act(async () => backBtn!.click());
    expect(onBackToCad).toHaveBeenCalledTimes(1);
  });

  it('3. toggles CSI ETABS 3-step .e2k import guide in ETABSExportPanel', async () => {
    const building = createBuilding({
      projectId: 'etabs-guide-ui',
      name: 'ETABS Guide Apartment',
      site: { plotWidth: 20_000, plotDepth: 25_000 },
    });

    const host = await renderIntoHost(<ETABSExportPanel building={building} />);
    expect(host.querySelector('[aria-label="CSI ETABS .e2k Import Guide"]')).toBeNull();

    const toggleBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('How to Import .e2k in ETABS'),
    );
    expect(toggleBtn).toBeDefined();

    await act(async () => toggleBtn!.click());

    const guide = host.querySelector('[aria-label="CSI ETABS .e2k Import Guide"]');
    expect(guide).not.toBeNull();
    expect(guide!.textContent).toContain('KN / M / C');
    expect(guide!.textContent).toContain('File → Import → ETABS .e2k Text File...');
    expect(guide!.textContent).toContain('Analyze → Check Model');
  });
});

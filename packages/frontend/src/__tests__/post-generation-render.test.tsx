// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

import type { Building } from '@ai-floor-planner/core';
import { executeAuditedPlanningPipeline } from '@ai-floor-planner/planning-engine';
import { renderFloor } from '@ai-floor-planner/renderer';
import { createArgonRequest } from '../services/argon-request';
import { ArgonStudioShell } from '../components/argon/ArgonStudioShell';
import type { ProjectSetupWizardData } from '../components/argon/ProjectSetupWizard';
import { studioStoreActions } from '../stores/useStudioStore';
import { ArchitecturalCADWorkspace } from '../components/argon/ArchitecturalCADWorkspace';
import { InteractivePlanEditorPage } from '../components/argon/InteractivePlanEditorPage';
import { FloorIsometricEditor } from '../components/argon/FloorIsometricEditor';
import { Building3DCustomizer } from '../components/argon/Building3DCustomizer';
import { StructuralCADWorkspace } from '../components/argon/StructuralCADWorkspace';
import { UdcprEtabsAnalysis } from '../components/argon/UdcprEtabsAnalysis';
import { ExportCenterWorkspace } from '../components/argon/ExportCenterWorkspace';
import { useEditorStore } from '../stores/editor-store';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const SCENARIOS: ProjectSetupWizardData[] = [
  studioStoreActions.getProjectSetupWizardData(),
  {
    projectName: 'Dual Wing G+3',
    plotWidthM: 28,
    plotDepthM: 32,
    roadWidthM: 12,
    roadFacing: 'East',
    frontSetbackM: 3,
    rearSetbackM: 2,
    sideSetbackM: 2,
    floorsCount: 3,
    hasStiltParking: false,
    flatsPerFloor: 2,
    bhkMix: [
      { unitType: '2BHK', carpetAreaSqFt: 1100, count: 1 },
      { unitType: '3BHK', carpetAreaSqFt: 1450, count: 1 },
    ],
    includeWindowChajjas: true,
    staggeredBalconies: true,
    aiPrompt: 'Cross-ventilated dual wing with balconies and chajjas',
  },
];

describe('Post-generation rendering regression suite', () => {
  const roots: Array<{ root: Root; host: HTMLElement }> = [];

  afterEach(async () => {
    while (roots.length) {
      const r = roots.pop()!;
      await act(async () => r.root.unmount());
      r.host.remove();
    }
  });

  it('mounts ArgonStudioShell cleanly without crashing', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push({ root, host });
    await act(async () => {
      root.render(<ArgonStudioShell />);
    });
    expect(host.querySelector('[data-testid="welcome-scroll-container"]')?.textContent).toContain('RH PLANNER');
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="cta-new-construction"]')?.click();
      await import('../components/argon/ProjectSetupWizard');
    });
    expect(host.textContent).toContain('Project type and site');
  });

  it('renders chajjas in SVG and mounts every post-generation workspace without throwing', async () => {
    for (const wizardData of SCENARIOS) {
      const request = createArgonRequest(wizardData);
      const result = await executeAuditedPlanningPipeline(request);
      const jsonRoundtripBuilding = JSON.parse(JSON.stringify(result.building)) as Building;

      const typicalFloor = jsonRoundtripBuilding.floors.find((f) => f.apartmentUnits?.length) ?? jsonRoundtripBuilding.floors[0]!;
      const svg = renderFloor(typicalFloor, jsonRoundtripBuilding, { scale: 0.04, offsetX: 50, offsetY: 50 }, 1200, 800);
      expect(svg).toContain('window-chajja');

      let capturedEditor: ReturnType<typeof useEditorStore> | null = null;
      const Harness: React.FC<{ workspace: string }> = ({ workspace }) => {
        const editor = useEditorStore();
        capturedEditor = editor;
        if (workspace === 'cad_2d') return <ArchitecturalCADWorkspace editor={editor} />;
        if (workspace === 'edit_plan') return <InteractivePlanEditorPage editor={editor} />;
        if (workspace === 'isometric') return <FloorIsometricEditor editor={editor} />;
        if (workspace === 'building_3d') return <Building3DCustomizer editor={editor} />;
        if (workspace === 'structural_cad') return <StructuralCADWorkspace editor={editor} />;
        if (workspace === 'engineering') return <UdcprEtabsAnalysis editor={editor} />;
        if (workspace === 'export') return <ExportCenterWorkspace editor={editor} />;
        return null;
      };

      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      roots.push({ root, host });

      await act(async () => {
        root.render(<Harness workspace="cad_2d" />);
      });

      await act(async () => {
        capturedEditor!.setBuilding(jsonRoundtripBuilding, wizardData.projectName, {}, 'residential');
        capturedEditor!.switchFloor(typicalFloor.id);
      });

      expect(host.querySelector('h1')?.textContent).toBe('2D Architectural CAD');

      for (const btn of Array.from(host.querySelectorAll('[aria-label="Engineering discipline overlay switcher"] button'))) {
        await act(async () => {
          (btn as HTMLButtonElement).click();
        });
      }

      for (const btn of Array.from(host.querySelectorAll('[aria-label="Model floors"] button'))) {
        await act(async () => {
          (btn as HTMLButtonElement).click();
        });
      }

      for (const ws of ['edit_plan', 'isometric', 'building_3d', 'structural_cad', 'engineering', 'export', 'cad_2d']) {
        await act(async () => {
          root.render(<Harness workspace={ws} />);
        });
      }
    }
  }, 120_000);
});

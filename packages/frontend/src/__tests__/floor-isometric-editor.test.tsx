// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  createBuilding,
  createFloor,
  createRoom,
  rectToPolygon,
  RoomType,
  type Building,
  type Floor,
} from '@ai-floor-planner/core';
import { FloorIsometricEditor } from '../components/argon/FloorIsometricEditor';
import type { EditorContextValue } from '../stores/editor-store';

// Mock ThreeBuildingScene in jsdom environment to focus on isometric floor orchestrator
vi.mock('../components/model-3d/ThreeBuildingScene', () => ({
  ThreeBuildingScene: vi.fn((props: Record<string, unknown>) => (
    <div
      data-testid="mock-three-building-scene"
      data-camera-preset={props.cameraPreset}
      data-floor-mode={props.floorMode}
      data-active-floor-id={props.activeFloorId}
    >
      Mock 3D Isometric Scene
    </div>
  )),
}));

// Mock ArchitecturalCanvas in jsdom environment
vi.mock('../components/canvas/ArchitecturalCanvas', () => ({
  ArchitecturalCanvas: vi.fn(() => (
    <div data-testid="mock-architectural-canvas">
      Mock 2D Drafting Canvas
    </div>
  )),
}));

describe('FloorIsometricEditor Component', () => {
  let root: Root;
  let host: HTMLDivElement;
  let building: Building;
  let switchFloorMock: ReturnType<typeof vi.fn>;
  let selectEntityMock: ReturnType<typeof vi.fn>;
  let clearSelectionMock: ReturnType<typeof vi.fn>;

  const floor1Id = 'floor-ground';
  const floor2Id = 'floor-first';
  const floor3Id = 'floor-terrace';

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    const floor1: Floor = {
      ...createFloor({
        buildingId: 'b-1',
        name: 'Ground Stilt Level',
        level: 0,
        floorHeight: 3000,
        boundary: rectToPolygon(0, 0, 15000, 12000),
      }),
      id: floor1Id,
      rooms: [
        createRoom({
          floorId: floor1Id,
          name: 'Stilt Parking',
          type: RoomType.Parking,
          x: 0,
          y: 0,
          width: 8000,
          height: 6000,
        }),
      ],
      walls: [],
      doors: [],
      windows: [],
    };

    const floor2: Floor = {
      ...createFloor({
        buildingId: 'b-1',
        name: '1st Typical Floor',
        level: 1,
        floorHeight: 3150,
        boundary: rectToPolygon(0, 0, 15000, 12000),
      }),
      id: floor2Id,
      rooms: [
        createRoom({
          floorId: floor2Id,
          name: 'Living Room 101',
          type: RoomType.Living,
          x: 0,
          y: 0,
          width: 5000,
          height: 4000,
        }),
      ],
      walls: [],
      doors: [],
      windows: [],
    };

    const floor3: Floor = {
      ...createFloor({
        buildingId: 'b-1',
        name: 'Terrace Sky Deck',
        level: 2,
        floorHeight: 3000,
        boundary: rectToPolygon(0, 0, 15000, 12000),
      }),
      id: floor3Id,
      rooms: [],
      walls: [],
      doors: [],
      windows: [],
    };

    building = {
      ...createBuilding({
        projectId: 'proj-iso-1',
        name: 'Skyline Isometric Test',
        site: {
          plotWidth: 20000,
          plotDepth: 25000,
        },
      }),
      id: 'b-1',
      floors: [floor1, floor2, floor3],
    };

    switchFloorMock = vi.fn();
    selectEntityMock = vi.fn();
    clearSelectionMock = vi.fn();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  const createMockEditor = (activeFloorId: string): EditorContextValue => ({
    building,
    activeFloor: building.floors.find((f) => f.id === activeFloorId) ?? building.floors[0]!,
    selection: null,
    projectName: building.name,
    switchFloor: switchFloorMock,
    selectEntity: selectEntityMock,
    clearSelection: clearSelectionMock,
    generationControl: {
      projectId: 'proj-iso-1',
      lockedRoomIds: [],
      lockedFloorIds: [],
      lockedCoreIds: [],
    },
    applyRefinement: vi.fn(),
    executeCommand: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    toggleRoomSelection: vi.fn(),
    setTool: vi.fn(),
    deleteSelected: vi.fn(),
    saveProject: vi.fn(),
    revalidate: vi.fn(),
    setRoomLocks: vi.fn(),
    setFloorLock: vi.fn(),
    setCoreLock: vi.fn(),
    loadProject: vi.fn(),
    setBuilding: vi.fn(),
    updateSite: vi.fn(),
    setRequiredRoomCounts: vi.fn(),
    addFloor: vi.fn(),
    removeFloor: vi.fn(),
    duplicateFloor: vi.fn(),
    reorderFloors: vi.fn(),
    updateFloorHeight: vi.fn(),
    generateDesign: vi.fn(),
    resetDesign: vi.fn(),
    exportDXF: vi.fn(),
    exportIFC: vi.fn(),
    exportPDF: vi.fn(),
    diagnostics: [],
    canUndo: false,
    canRedo: false,
    isDirty: false,
    activeTool: 'select',
    viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    setViewport: vi.fn(),
    resetViewport: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomToFit: vi.fn(),
    snapConfig: { grid: true, endpoint: true, midpoint: true, center: true, angle: true, distance: true, tolerance: 10 },
    setSnapConfig: vi.fn(),
    interactionState: { type: 'idle' },
    validationDisplay: { showErrors: true, showWarnings: true, showInfos: true, selectedErrorId: null },
    setValidationDisplay: vi.fn(),
    projectStatus: 'ready',
    requiredRoomCounts: {},
  } as unknown as EditorContextValue);

  it('renders dynamic floors from canonical model instead of hardcoded levels', () => {
    const editor = createMockEditor(floor1Id);
    act(() => {
      root.render(<FloorIsometricEditor editor={editor} />);
    });

    // Verify all 3 canonical floor buttons are rendered
    expect(host.querySelector(`[data-testid="floor-btn-${floor1Id}"]`)).not.toBeNull();
    expect(host.querySelector(`[data-testid="floor-btn-${floor2Id}"]`)).not.toBeNull();
    expect(host.querySelector(`[data-testid="floor-btn-${floor3Id}"]`)).not.toBeNull();

    // Verify labels match canonical floor names
    expect(host.querySelector(`[data-testid="floor-btn-${floor1Id}"]`)?.textContent).toContain('Ground Stilt Level');
    expect(host.querySelector(`[data-testid="floor-btn-${floor2Id}"]`)?.textContent).toContain('1st Typical Floor');
    expect(host.querySelector(`[data-testid="floor-btn-${floor3Id}"]`)?.textContent).toContain('Terrace Sky Deck');

    // Verify elevations calculated accurately (+0.00m, +3.15m)
    expect(host.querySelector(`[data-testid="floor-btn-${floor1Id}"]`)?.textContent).toContain('+0.00m');
    expect(host.querySelector(`[data-testid="floor-btn-${floor2Id}"]`)?.textContent).toContain('+3.15m');
  });

  it('calls editor.switchFloor() when a floor button is clicked', () => {
    const editor = createMockEditor(floor1Id);
    act(() => {
      root.render(<FloorIsometricEditor editor={editor} />);
    });

    const floor2Btn = host.querySelector(`[data-testid="floor-btn-${floor2Id}"]`) as HTMLButtonElement;
    expect(floor2Btn).not.toBeNull();

    act(() => {
      floor2Btn.click();
    });

    expect(switchFloorMock).toHaveBeenCalledTimes(1);
    expect(switchFloorMock).toHaveBeenCalledWith(floor2Id);
  });

  it('displays the active floor information correctly in the floating badge', () => {
    const editor = createMockEditor(floor2Id);
    act(() => {
      root.render(<FloorIsometricEditor editor={editor} />);
    });

    const badgeName = host.querySelector('[data-testid="active-floor-name"]');
    expect(badgeName?.textContent).toBe('1st Typical Floor');

    const badgeElevation = host.querySelector('[data-testid="active-floor-elevation"]');
    expect(badgeElevation?.textContent).toContain('+3.15m');
  });

  it('renders Three.js isometric viewport in isolated mode by default', () => {
    const editor = createMockEditor(floor1Id);
    act(() => {
      root.render(<FloorIsometricEditor editor={editor} />);
    });

    const viewport3D = host.querySelector('[data-testid="isometric-3d-viewport"]');
    expect(viewport3D).not.toBeNull();

    const mockThreeScene = host.querySelector('[data-testid="mock-three-building-scene"]');
    expect(mockThreeScene).not.toBeNull();
    expect(mockThreeScene?.getAttribute('data-camera-preset')).toBe('isometric');
    expect(mockThreeScene?.getAttribute('data-floor-mode')).toBe('isolate');
    expect(mockThreeScene?.getAttribute('data-active-floor-id')).toBe(floor1Id);
  });

  it('toggles between 3D isometric isolated mode and 2D drafting plan mode', () => {
    const editor = createMockEditor(floor1Id);
    act(() => {
      root.render(<FloorIsometricEditor editor={editor} />);
    });

    // Initially in 3D
    expect(host.querySelector('[data-testid="isometric-3d-viewport"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="drafting-2d-viewport"]')).toBeNull();

    // Switch to 2D Technical Plan
    const btn2D = host.querySelector('[data-testid="toggle-view-2d"]') as HTMLButtonElement;
    act(() => {
      btn2D.click();
    });

    expect(host.querySelector('[data-testid="isometric-3d-viewport"]')).toBeNull();
    expect(host.querySelector('[data-testid="drafting-2d-viewport"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="mock-architectural-canvas"]')).not.toBeNull();

    // Switch back to 3D Isometric
    const btn3D = host.querySelector('[data-testid="toggle-view-3d"]') as HTMLButtonElement;
    act(() => {
      btn3D.click();
    });

    expect(host.querySelector('[data-testid="isometric-3d-viewport"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="drafting-2d-viewport"]')).toBeNull();
  });
});

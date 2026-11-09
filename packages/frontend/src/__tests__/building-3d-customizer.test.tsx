// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  createBuilding,
  createFloor,
  createWall,
  createDoor,
  createWindow,
  rectToPolygon,
  DoorType,
  WindowType,
  type Building,
  type Floor,
  type IEditorCommand,
  UpdateWindowPropertiesCommand,
  UpdateDoorPropertiesCommand,
  BatchCommand,
} from '@ai-floor-planner/core';
import { Building3DCustomizer } from '../components/argon/Building3DCustomizer';
import type { EditorContextValue } from '../stores/editor-store';

// Mock ModelWorkspace in jsdom to isolate 3D customizer controls and HUD
vi.mock('../components/model-3d/ModelWorkspace', () => ({
  default: vi.fn((props: Record<string, unknown>) => (
    <div
      data-testid="mock-model-workspace"
      data-explode-value={props.explodeValue}
      data-lighting-mode={props.lightingMode}
    >
      Mock Model Workspace
    </div>
  )),
}));

function setNativeInputValue(element: HTMLInputElement, value: string): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;
  nativeSetter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Building3DCustomizer Component', () => {
  let root: Root;
  let host: HTMLDivElement;
  let building: Building;
  let executedCommands: IEditorCommand[];
  let executeCommandMock: ReturnType<typeof vi.fn>;
  let switchFloorMock: ReturnType<typeof vi.fn>;
  let selectEntityMock: ReturnType<typeof vi.fn>;
  let clearSelectionMock: ReturnType<typeof vi.fn>;

  const floor1Id = 'floor-1';
  const wall1Id = 'wall-1';
  const door1Id = 'door-1';
  const win1Id = 'win-1';

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    executedCommands = [];

    const floor1: Floor = {
      ...createFloor({
        buildingId: 'b-customizer',
        name: 'Level 1 Apartment',
        level: 1,
        floorHeight: 3000,
        boundary: rectToPolygon(0, 0, 12000, 10000),
      }),
      id: floor1Id,
      walls: [
        {
          ...createWall({
            floorId: floor1Id,
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 12000, y: 0 },
          }),
          id: wall1Id,
        },
      ],
      doors: [
        {
          ...createDoor({
            floorId: floor1Id,
            wallId: wall1Id,
            position: { x: 2000, y: 0 },
            width: 900,
            height: 2100,
            type: DoorType.Single,
            connectsRooms: ['room-1', 'room-2'],
          }),
          id: door1Id,
        },
      ],
      windows: [
        {
          ...createWindow({
            floorId: floor1Id,
            wallId: wall1Id,
            position: { x: 6000, y: 0 },
            width: 1500,
            height: 1200,
            sillHeight: 900,
            type: WindowType.Sliding,
            roomId: 'room-1',
          }),
          id: win1Id,
        },
      ],
      rooms: [],
    };

    building = {
      ...createBuilding({
        projectId: 'proj-customizer-1',
        name: 'Customizer Test Project',
        site: {
          plotWidth: 20000,
          plotDepth: 25000,
        },
      }),
      id: 'b-customizer',
      floors: [floor1],
    };

    executeCommandMock = vi.fn((cmd: IEditorCommand) => {
      executedCommands.push(cmd);
    });
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

  const createMockEditor = (selection: EditorContextValue['selection'] = null): EditorContextValue => ({
    building,
    activeFloor: building.floors[0]!,
    selection,
    projectName: building.name,
    executeCommand: executeCommandMock,
    switchFloor: switchFloorMock,
    selectEntity: selectEntityMock,
    clearSelection: clearSelectionMock,
    generationControl: {
      projectId: 'proj-customizer-1',
      lockedRoomIds: [],
      lockedFloorIds: [],
      lockedCoreIds: [],
    },
    applyRefinement: vi.fn(),
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

  it('renders explode slider and updates explode value on change', async () => {
    const editor = createMockEditor();
    await act(async () => {
      root.render(<Building3DCustomizer editor={editor} />);
    });

    const explodeSlider = host.querySelector('[data-testid="explode-slider"]') as HTMLInputElement;
    const explodeLabel = host.querySelector('[data-testid="explode-value-label"]');

    expect(explodeSlider).not.toBeNull();
    expect(explodeLabel?.textContent).toBe('0%');

    act(() => {
      setNativeInputValue(explodeSlider, '50');
    });

    expect(host.querySelector('[data-testid="explode-value-label"]')?.textContent).toBe('50%');
  });

  it('toggles Day and Night lighting modes', async () => {
    const editor = createMockEditor();
    await act(async () => {
      root.render(<Building3DCustomizer editor={editor} />);
    });

    const btnDay = host.querySelector('[data-testid="btn-lighting-day"]') as HTMLButtonElement;
    const btnNight = host.querySelector('[data-testid="btn-lighting-night"]') as HTMLButtonElement;

    // Day is initially active
    expect(btnDay.className).toContain('bg-amber-500');

    // Click Night button
    act(() => {
      btnNight.click();
    });

    expect(btnNight.className).toContain('bg-indigo-500');

    // Click Day button
    act(() => {
      btnDay.click();
    });

    expect(btnDay.className).toContain('bg-amber-500');
  });

  it('dispatches typed UpdateWindowPropertiesCommand when window fixture is clicked with selected window', async () => {
    const editor = createMockEditor({ entityType: 'window', entityId: win1Id, floorId: floor1Id });
    await act(async () => {
      root.render(<Building3DCustomizer editor={editor} />);
    });

    const slidingWinBtn = host.querySelector('[data-testid="fixture-opt-sliding_aluminum_win"]') as HTMLButtonElement;
    expect(slidingWinBtn).not.toBeNull();

    act(() => {
      slidingWinBtn.click();
    });

    expect(executeCommandMock).toHaveBeenCalledTimes(1);
    const cmd = executedCommands[0] as UpdateWindowPropertiesCommand;
    expect(cmd).toBeInstanceOf(UpdateWindowPropertiesCommand);
    expect(cmd.windowId).toBe(win1Id);
    expect(cmd.updates).toMatchObject({
      styleId: 'SLIDING_UPVC',
      materialId: 'mat_aluminum_anodized_dark',
    });
  });

  it('dispatches BatchCommand to active floor windows when no window is selected', async () => {
    const editor = createMockEditor(null);
    await act(async () => {
      root.render(<Building3DCustomizer editor={editor} />);
    });

    const casementWinBtn = host.querySelector('[data-testid="fixture-opt-casement_timber_win"]') as HTMLButtonElement;
    expect(casementWinBtn).not.toBeNull();

    act(() => {
      casementWinBtn.click();
    });

    expect(executeCommandMock).toHaveBeenCalledTimes(1);
    const cmd = executedCommands[0] as BatchCommand;
    expect(cmd).toBeInstanceOf(BatchCommand);
    expect(cmd.description).toContain('Apply Casement Timber Windows');
    expect(cmd.commands.length).toBe(1);
    const subCmd = cmd.commands[0] as UpdateWindowPropertiesCommand;
    expect(subCmd).toBeInstanceOf(UpdateWindowPropertiesCommand);
    expect(subCmd.windowId).toBe(win1Id);
    expect(subCmd.updates).toMatchObject({
      styleId: 'CASEMENT_ALUMINUM',
      materialId: 'mat_teak_timber_clear',
    });
  });

  it('dispatches typed UpdateDoorPropertiesCommand when door fixture is clicked', async () => {
    const editor = createMockEditor({ entityType: 'door', entityId: door1Id, floorId: floor1Id });
    await act(async () => {
      root.render(<Building3DCustomizer editor={editor} />);
    });

    const solidDoorBtn = host.querySelector('[data-testid="fixture-opt-solid_core_main_door"]') as HTMLButtonElement;
    expect(solidDoorBtn).not.toBeNull();

    act(() => {
      solidDoorBtn.click();
    });

    expect(executeCommandMock).toHaveBeenCalledTimes(1);
    const cmd = executedCommands[0] as UpdateDoorPropertiesCommand;
    expect(cmd).toBeInstanceOf(UpdateDoorPropertiesCommand);
    expect(cmd.doorId).toBe(door1Id);
    expect(cmd.updates).toMatchObject({
      styleId: 'FLUSH_TIMBER',
      materialId: 'mat_teak_hardwood_solid',
    });
  });

  it('disables unsupported furniture items and flags them with Pending Phase 8 badges', async () => {
    const editor = createMockEditor();
    await act(async () => {
      root.render(<Building3DCustomizer editor={editor} />);
    });

    // Switch to Furniture tab
    const furnitureTab = host.querySelector('[data-testid="tab-furniture"]') as HTMLButtonElement;
    act(() => {
      furnitureTab.click();
    });

    const furnitureList = host.querySelector('[data-testid="furniture-list"]');
    expect(furnitureList).not.toBeNull();

    const bedOption = host.querySelector('[data-testid="furniture-opt-bed_master"]');
    expect(bedOption).not.toBeNull();
    expect(bedOption?.getAttribute('aria-disabled')).toBe('true');
    expect(bedOption?.className).toContain('cursor-not-allowed');

    const badges = host.querySelectorAll('[data-testid="badge-pending-phase8"]');
    expect(badges.length).toBeGreaterThanOrEqual(6);
    expect(badges[0]?.textContent).toContain('Pending Phase 8');
  });

  it('dispatches Apply Global 3D Skin BatchCommand across all building openings', async () => {
    const editor = createMockEditor();
    await act(async () => {
      root.render(<Building3DCustomizer editor={editor} />);
    });

    const applyGlobalBtn = host.querySelector('[data-testid="btn-apply-global-skin"]') as HTMLButtonElement;
    expect(applyGlobalBtn).not.toBeNull();

    act(() => {
      applyGlobalBtn.click();
    });

    expect(executeCommandMock).toHaveBeenCalledTimes(1);
    const cmd = executedCommands[0] as BatchCommand;
    expect(cmd).toBeInstanceOf(BatchCommand);
    expect(cmd.description).toContain('Apply Global 3D Skin');
    // 1 window + 1 door = 2 commands in the batch
    expect(cmd.commands.length).toBe(2);
  });
});

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  type Building,
  RoomType,
  WallType,
  Direction,
  ApplyRoomAreaRegenerationCommand,
  createBuilding,
  createFloor,
  createRoom,
  createWall,
  createGenerationControlState,
  rectToPolygon,
  type IEditorCommand,
} from '@ai-floor-planner/core';
import { RoomAreaCustomizerPanel } from '../components/argon/RoomAreaCustomizerPanel';
import type { EditorContextValue } from '../stores/editor-store';

function createMockBuilding(): Building {
  const floor1Id = 'floor-0';

  const room1 = {
    ...createRoom({
      floorId: floor1Id,
      name: 'Master Bedroom',
      type: RoomType.Bedroom,
      x: 1000,
      y: 1000,
      width: 4000,
      height: 3000,
    }),
    id: 'room-bed-1',
    minArea: 9_500_000,
  };

  const room2 = {
    ...createRoom({
      floorId: floor1Id,
      name: 'Bedroom 2',
      type: RoomType.Bedroom,
      x: 5000,
      y: 1000,
      width: 4000,
      height: 3000,
    }),
    id: 'room-bed-2',
    minArea: 9_500_000,
  };

  const wall1 = {
    ...createWall({
      floorId: floor1Id,
      startPoint: { x: 5000, y: 1000 },
      endPoint: { x: 5000, y: 4000 },
      thickness: 115,
      type: WallType.Partition,
      roomIds: [room1.id, room2.id],
    }),
    id: 'wall-1',
  };

  const floor = {
    ...createFloor({
      buildingId: 'b-1',
      level: 0,
      name: 'Ground Floor',
      floorHeight: 3000,
      boundary: rectToPolygon(0, 0, 12000, 10000),
    }),
    id: floor1Id,
    rooms: [room1, room2],
    walls: [wall1],
  };

  return {
    ...createBuilding({
      projectId: 'p-1',
      name: 'Test Building',
      site: {
        plotWidth: 15000,
        plotDepth: 12000,
        roadFacing: Direction.North,
        plannedFloorCount: 1,
        setbacks: { front: 1500, rear: 1000, left: 1000, right: 1000 },
      },
      floors: [],
    }),
    id: 'b-1',
    version: 1,
    floors: [floor],
  };
}

describe('RoomAreaCustomizerPanel Component', () => {
  let root: Root;
  let host: HTMLDivElement;
  let building: Building;
  let executedCommands: IEditorCommand[];
  let setRoomLocksMock: ReturnType<typeof vi.fn>;
  let executeCommandMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    building = createMockBuilding();
    executedCommands = [];
    setRoomLocksMock = vi.fn();
    executeCommandMock = vi.fn((cmd: IEditorCommand) => {
      executedCommands.push(cmd);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function createEditorContext(): EditorContextValue {
    return {
      engine: {} as any,
      building,
      activeFloor: building.floors[0]!,
      selection: { entityType: 'room', entityId: 'room-bed-1', floorId: 'floor-0' },
      selections: [{ entityType: 'room', entityId: 'room-bed-1', floorId: 'floor-0' }],
      generationControl: createGenerationControlState(),
      activeTool: 'select' as any,
      canUndo: true,
      canRedo: false,
      validationSummary: {
        isValid: true,
        overallScore: 100,
        failed: 0,
        passed: 10,
        total: 10,
        violations: [],
        suggestions: [],
        categoryScores: {},
      },
      diagnostics: {} as any,
      projectName: 'Test Project',
      projectId: 'p-1',
      projectCategory: 'residential' as any,
      projectStatus: 'draft' as any,
      requiredRoomCounts: {},
      executeCommand: executeCommandMock,
      undo: vi.fn(),
      redo: vi.fn(),
      selectEntity: vi.fn(),
      toggleRoomSelection: vi.fn(),
      clearSelection: vi.fn(),
      switchFloor: vi.fn(),
      setTool: vi.fn(),
      deleteSelected: vi.fn(),
      saveProject: vi.fn(),
      revalidate: vi.fn(),
      setRoomLocks: setRoomLocksMock,
      setFloorLock: vi.fn(),
      setCoreLock: vi.fn(),
      applyRefinement: vi.fn(),
      loadProject: vi.fn(),
      setBuilding: vi.fn(),
      updateSite: vi.fn(),
      setRequiredRoomCounts: vi.fn(),
      addFloor: vi.fn(),
      removeFloor: vi.fn(),
    };
  }

  it('renders measured room area, clear dimensions, and statutory minimums', () => {
    const editor = createEditorContext();
    const room = building.floors[0]!.rooms[0]!;

    act(() => {
      root.render(<RoomAreaCustomizerPanel editor={editor} room={room} />);
    });

    expect(host.textContent).toContain('Room Area Customizer');
    expect(host.textContent).toContain('12.00 m²');
    expect(host.textContent).toContain('Statutory Min: 9.50 m²');
    expect(host.textContent).toContain('4.00 × 3.00 m');
  });

  it('allows switching units between m² and sq ft', () => {
    const editor = createEditorContext();
    const room = building.floors[0]!.rooms[0]!;

    act(() => {
      root.render(<RoomAreaCustomizerPanel editor={editor} room={room} />);
    });

    const sqFtBtn = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'sq ft'
    );
    expect(sqFtBtn).toBeDefined();

    act(() => {
      sqFtBtn!.click();
    });

    const input = host.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input).toBeDefined();
    expect(parseFloat(input.value)).toBeCloseTo(129.2, 1);
  });

  it('calls setRoomLocks when lock button is clicked', () => {
    const editor = createEditorContext();
    const room = building.floors[0]!.rooms[0]!;

    act(() => {
      root.render(<RoomAreaCustomizerPanel editor={editor} room={room} />);
    });

    const lockBtn = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Unlocked')
    );
    expect(lockBtn).toBeDefined();

    act(() => {
      lockBtn!.click();
    });

    expect(setRoomLocksMock).toHaveBeenCalledWith(['room-bed-1'], true);
  });

  it('regenerates room area and generates candidate alternatives', async () => {
    const editor = createEditorContext();
    const room = building.floors[0]!.rooms[0]!;

    act(() => {
      root.render(<RoomAreaCustomizerPanel editor={editor} room={room} />);
    });

    const input = host.querySelector('input[type="number"]') as HTMLInputElement;
    act(() => {
      input.value = '14.00';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const regenBtn = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Regenerate Selected Room')
    );
    expect(regenBtn).toBeDefined();

    await act(async () => {
      regenBtn!.click();
      await new Promise((r) => setTimeout(r, 150));
    });

    expect(host.textContent).toContain('Proposed Alternatives');
    expect(host.textContent).toContain('Candidate A');
  });

  it('accepts a candidate and executes ApplyRoomAreaRegenerationCommand', async () => {
    const editor = createEditorContext();
    const room = building.floors[0]!.rooms[0]!;

    act(() => {
      root.render(<RoomAreaCustomizerPanel editor={editor} room={room} />);
    });

    const input = host.querySelector('input[type="number"]') as HTMLInputElement;
    act(() => {
      input.value = '14.00';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const regenBtn = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Regenerate Selected Room')
    );

    await act(async () => {
      regenBtn!.click();
      await new Promise((r) => setTimeout(r, 150));
    });

    const acceptBtn = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Accept'
    );
    expect(acceptBtn).toBeDefined();

    act(() => {
      acceptBtn!.click();
    });

    expect(executeCommandMock).toHaveBeenCalledTimes(1);
    const cmd = executedCommands[0];
    expect(cmd).toBeInstanceOf(ApplyRoomAreaRegenerationCommand);
    expect((cmd as ApplyRoomAreaRegenerationCommand).metadata.roomId).toBe('room-bed-1');
  });
});

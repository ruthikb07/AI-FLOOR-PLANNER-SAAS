/**
 * Headless Architectural Editor Engine.
 *
 * Sits ABOVE the Building Model, managing editor-local state, command dispatch,
 * history (undo/redo), and subscription-based change notifications.
 *
 * ARCHITECTURAL BOUNDARIES:
 * - Building Model is the Single Source of Truth for all domain data.
 * - EditorState contains UI/view/tool/selection state and is NEVER serialized into Building.
 * - Geometry & Constraint engines are queried as pure functional authorities.
 * - Renderer is notified to project the updated Building model.
 */

import type { Building, Floor } from '../types';
import type {
  EditorState,
  EditorSelection,
  EditorTool,
  ViewportState,
  SnapConfiguration,
  TemporaryInteractionState,
  ValidationDisplayState,
  IEditorCommand,
  EditorListener,
  EditorEvent,
  EditorEventType,
} from './types';
import {
  DEFAULT_SNAP_CONFIG,
  DEFAULT_INTERACTION_STATE,
  DEFAULT_VALIDATION_DISPLAY,
} from './types';
import { CommandHistory } from './history';
import { AddFloorCommand, RemoveFloorCommand } from './commands/floor-commands';

export interface EditorEngineOptions {
  historyDepth?: number;
  initialFloorId?: string;
  initialTool?: EditorTool;
  initialSnapConfig?: Partial<SnapConfiguration>;
  initialViewport?: Partial<ViewportState>;
}

export class EditorEngine {
  private building: Building;
  private state: EditorState;
  private history: CommandHistory;
  private listeners = new Set<EditorListener>();

  constructor(building: Building, options: EditorEngineOptions = {}) {
    this.building = building;
    this.history = new CommandHistory(options.historyDepth ?? 50);

    const defaultFloorId = options.initialFloorId
      ?? building.floors[0]?.id
      ?? '';

    this.state = {
      activeFloorId: defaultFloorId,
      selection: null,
      selections: [],
      hoveredEntity: null,
      activeTool: options.initialTool ?? 'select',
      viewport: {
        zoom: 1,
        panX: 0,
        panY: 0,
        width: 1000,
        height: 800,
        ...options.initialViewport,
      },
      snapConfig: {
        ...DEFAULT_SNAP_CONFIG,
        ...options.initialSnapConfig,
      },
      interaction: DEFAULT_INTERACTION_STATE,
      validationDisplay: DEFAULT_VALIDATION_DISPLAY,
      historySummary: this.history.getSummary(),
    };
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  /** Get the current authoritative Building model. */
  getBuilding(): Building {
    return this.building;
  }

  /** Get the current editor-local state. */
  getState(): Readonly<EditorState> {
    return this.state;
  }

  /** Get the currently active Floor entity, or undefined if no floors exist. */
  getActiveFloor(): Floor | undefined {
    return this.building.floors.find(f => f.id === this.state.activeFloorId) ?? this.building.floors[0];
  }

  // ─── Subscriptions ────────────────────────────────────────────────────────

  /** Subscribe to editor state and building events. Returns an unsubscribe function. */
  subscribe(listener: EditorListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(eventType: EditorEventType, command?: IEditorCommand, previousState?: EditorState): void {
    const event: EditorEvent = {
      type: eventType,
      building: this.building,
      state: this.state,
      previousState,
      command,
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in editor listener:', err);
      }
    }
  }

  // ─── Command Dispatch & History ───────────────────────────────────────────

  /**
   * Execute an editor command.
   * If the command mutates the Building model, it is pushed to the undo history.
   */
  execute(command: IEditorCommand): void {
    const prevBuilding = this.building;
    const prevState = this.state;

    const result = command.execute(this.building, this.state);

    const buildingChanged = result.building !== prevBuilding;

    this.building = result.building;

    // Apply state updates from command
    if (result.stateUpdates) {
      this.state = {
        ...this.state,
        ...result.stateUpdates,
      };
    }

    // Record in history if the building changed or if command explicitly requested tracking
    if (buildingChanged) {
      this.history.push(command, prevBuilding, this.building, prevState, this.state);
      this.state = {
        ...this.state,
        historySummary: this.history.getSummary(),
      };

      this.emit('building_changed', command, prevState);
      this.emit('validation_requested', command);
      this.emit('render_requested', command);
    } else {
      this.emit('state_changed', command, prevState);
    }
  }

  /** Undo the most recent reversible command. */
  undo(): boolean {
    if (!this.history.canUndo) return false;

    const prevState = this.state;
    const undoResult = this.history.undo(this.state);
    if (!undoResult) return false;

    this.building = undoResult.building;

    this.state = {
      ...this.state,
      ...undoResult.stateUpdates,
      historySummary: this.history.getSummary(),
    };

    this.emit('history_changed', undoResult.command, prevState);
    this.emit('building_changed', undoResult.command, prevState);
    this.emit('validation_requested', undoResult.command);
    this.emit('render_requested', undoResult.command);

    return true;
  }

  /** Redo the most recently undone command. */
  redo(): boolean {
    if (!this.history.canRedo) return false;

    const prevState = this.state;
    const redoResult = this.history.redo(this.state);
    if (!redoResult) return false;

    this.building = redoResult.building;

    this.state = {
      ...this.state,
      ...redoResult.stateUpdates,
      historySummary: this.history.getSummary(),
    };

    this.emit('history_changed', redoResult.command, prevState);
    this.emit('building_changed', redoResult.command, prevState);
    this.emit('validation_requested', redoResult.command);
    this.emit('render_requested', redoResult.command);

    return true;
  }

  // ─── Direct State Helpers (Non-domain Mutations) ──────────────────────────

  /** Set the currently selected entity. */
  selectEntity(selection: EditorSelection | null): void {
    if (
      this.state.selection?.entityId === selection?.entityId &&
      this.state.selection?.entityType === selection?.entityType
    ) {
      return;
    }

    const prevState = this.state;
    this.state = {
      ...this.state,
      selection,
      selections: selection ? [selection] : [],
    };

    this.emit('selection_changed', undefined, prevState);
    this.emit('render_requested');
  }

  /** Set the currently hovered entity. */
  setHoveredEntity(hoveredEntity: EditorSelection | null): void {
    if (
      this.state.hoveredEntity?.entityId === hoveredEntity?.entityId &&
      this.state.hoveredEntity?.entityType === hoveredEntity?.entityType
    ) {
      return;
    }

    this.state = {
      ...this.state,
      hoveredEntity,
    };

    this.emit('state_changed');
  }

  /** Switch active floor. */
  setActiveFloor(floorId: string): void {
    if (this.state.activeFloorId === floorId) return;

    const floorExists = this.building.floors.some(f => f.id === floorId);
    if (!floorExists && floorId !== '') return;

    const prevState = this.state;
    this.state = {
      ...this.state,
      activeFloorId: floorId,
      // Clear selection if it belonged to previous floor
      selection: this.state.selection?.floorId && this.state.selection.floorId !== floorId ? null : this.state.selection,
      selections: (this.state.selections ?? []).filter(selection => !selection.floorId || selection.floorId === floorId),
    };

    this.emit('floor_changed', undefined, prevState);
    this.emit('render_requested');
  }

  /** Add a new floor level. */
  addFloor(name?: string, floorHeight?: number): void {
    this.execute(new AddFloorCommand({ name, floorHeight }));
  }

  /** Remove a floor by ID. */
  removeFloor(floorId: string): void {
    this.execute(new RemoveFloorCommand(floorId));
  }

  /** Switch active tool. */
  setActiveTool(tool: EditorTool): void {
    if (this.state.activeTool === tool) return;

    const prevState = this.state;
    this.state = {
      ...this.state,
      activeTool: tool,
    };

    this.emit('tool_changed', undefined, prevState);
  }

  /** Update viewport pan and zoom. */
  setViewport(viewport: Partial<ViewportState>): void {
    this.state = {
      ...this.state,
      viewport: {
        ...this.state.viewport,
        ...viewport,
      },
    };

    this.emit('state_changed');
  }

  /** Update snap configuration. */
  setSnapConfig(config: Partial<SnapConfiguration>): void {
    this.state = {
      ...this.state,
      snapConfig: {
        ...this.state.snapConfig,
        ...config,
      },
    };

    this.emit('state_changed');
  }

  /** Update transient interaction state. */
  setInteraction(interaction: Partial<TemporaryInteractionState>): void {
    this.state = {
      ...this.state,
      interaction: {
        ...this.state.interaction,
        ...interaction,
      },
    };

    this.emit('state_changed');
  }

  /** Update validation display status. */
  setValidationDisplay(validationDisplay: Partial<ValidationDisplayState>): void {
    this.state = {
      ...this.state,
      validationDisplay: {
        ...this.state.validationDisplay,
        ...validationDisplay,
      },
    };

    this.emit('state_changed');
  }

  /**
   * Reset building to a new model (e.g. upon opening a new file).
   */
  setBuilding(building: Building, resetHistory: boolean = true): void {
    const prevState = this.state;
    this.building = building;

    if (resetHistory) {
      this.history.clear();
    }

    const activeFloorExists = building.floors.some(f => f.id === this.state.activeFloorId);
    const activeFloorId = activeFloorExists
      ? this.state.activeFloorId
      : building.floors[0]?.id ?? '';

    this.state = {
      ...this.state,
      activeFloorId,
      selection: null,
      selections: [],
      hoveredEntity: null,
      historySummary: this.history.getSummary(),
    };

    this.emit('building_changed', undefined, prevState);
    this.emit('validation_requested');
    this.emit('render_requested');
  }

  /** Trigger an explicit render request event to all subscribers. */
  requestRender(): void {
    this.emit('render_requested');
  }

  /** Trigger an explicit validation request event to all subscribers. */
  requestValidation(): void {
    this.emit('validation_requested');
  }
}

/**
 * Editor State & Command Architecture Types for the Interactive Architectural Editor.
 *
 * CRITICAL ARCHITECTURAL INVARIANT:
 * Editor state is strictly decoupled from the domain Building Model.
 * Editor state MUST NEVER be serialized into or stored inside the Building entity.
 */

import type { Building, Point, AlignmentGuide } from '../types';

// ─── Entity & Selection Types ───────────────────────────────────────────────

/** Types of domain entities that can be selected or inspected in the editor. */
export type EditorEntityType =
  | 'room'
  | 'wall'
  | 'door'
  | 'window'
  | 'stair'
  | 'column'
  | 'beam'
  | 'furniture'
  | 'floor'
  | 'site';

/** A selected entity reference with type, stable domain ID, and optional floor reference. */
export interface EditorSelection {
  readonly entityType: EditorEntityType;
  readonly entityId: string;
  readonly floorId?: string;
}

// ─── Tools & Modes ──────────────────────────────────────────────────────────

/** Active editor tool. */
export type EditorTool =
  | 'select'
  | 'pan'
  | 'add_room'
  | 'add_wall'
  | 'add_door'
  | 'add_window'
  | 'add_column'
  | 'add_stair'
  | 'measure';

// ─── Viewport & Snapping Configuration ──────────────────────────────────────

/** Viewport camera state (zoom and pan offsets). */
export interface ViewportState {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
  readonly width: number;
  readonly height: number;
}

/** Snapping configuration for the editor. */
export interface SnapConfiguration {
  readonly enabled: boolean;
  readonly grid: boolean;
  readonly gridSize: number;           // in millimeters
  readonly wallEndpoints: boolean;
  readonly wallEdges: boolean;
  readonly roomBoundaries: boolean;
  readonly alignmentGuides: boolean;
  readonly threshold: number;          // snap distance threshold in millimeters
}

/** Default snap configuration. */
export const DEFAULT_SNAP_CONFIG: SnapConfiguration = {
  enabled: true,
  grid: true,
  gridSize: 100, // 100 mm minor grid
  wallEndpoints: true,
  wallEdges: true,
  roomBoundaries: true,
  alignmentGuides: true,
  threshold: 150, // 150 mm world-space tolerance
};

// ─── Transient Interaction State ────────────────────────────────────────────

/** Temporary interaction state during active mouse/drag gestures (non-authoritative). */
export interface TemporaryInteractionState {
  readonly isDragging: boolean;
  readonly dragStartPoint?: Point;
  readonly dragCurrentPoint?: Point;
  readonly activeHandle?: string;
  readonly activeGuideLines?: readonly AlignmentGuide[];
}

/** Default idle interaction state. */
export const DEFAULT_INTERACTION_STATE: TemporaryInteractionState = {
  isDragging: false,
};

// ─── Validation Display State ───────────────────────────────────────────────

/** Validation display status in the editor HUD. */
export type ValidationStatus = 'idle' | 'validating' | 'valid' | 'warning' | 'invalid';

export interface ValidationDisplayState {
  readonly status: ValidationStatus;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly score?: number;
  readonly lastValidatedAt?: string;
}

export const DEFAULT_VALIDATION_DISPLAY: ValidationDisplayState = {
  status: 'idle',
  errorCount: 0,
  warningCount: 0,
};

// ─── History Summary ────────────────────────────────────────────────────────

/** Summary of undo/redo history status. */
export interface HistorySummary {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoCount: number;
  readonly redoCount: number;
  readonly lastCommandDescription?: string;
}

// ─── Full Editor State ──────────────────────────────────────────────────────

/**
 * Editor-local state container.
 * This is 100% separate from the Building model.
 */
export interface EditorState {
  readonly activeFloorId: string;
  readonly selection: EditorSelection | null;
  /** Multi-selection; selection remains the primary inspector target. */
  readonly selections?: readonly EditorSelection[];
  readonly hoveredEntity: EditorSelection | null;
  readonly activeTool: EditorTool;
  readonly viewport: ViewportState;
  readonly snapConfig: SnapConfiguration;
  readonly interaction: TemporaryInteractionState;
  readonly validationDisplay: ValidationDisplayState;
  readonly historySummary: HistorySummary;
}

// ─── Editor Command Interface ───────────────────────────────────────────────

/** Result of executing or undoing a command. */
export interface CommandExecutionResult {
  readonly building: Building;
  readonly stateUpdates?: Partial<EditorState>;
}

/**
 * Interface for all editor commands.
 * Commands must be deterministic, testable, and reversible.
 */
export interface IEditorCommand {
  readonly id: string;
  readonly description: string;
  readonly affectedEntityId?: string;

  /**
   * Execute the command, taking the current Building and EditorState and returning the new Building.
   */
  execute(building: Building, state: EditorState): CommandExecutionResult;

  /**
   * Revert the command, returning the previous Building state.
   */
  undo(building: Building, state: EditorState): CommandExecutionResult;
}

// ─── Event & Subscription Types ─────────────────────────────────────────────

export type EditorEventType =
  | 'state_changed'
  | 'building_changed'
  | 'selection_changed'
  | 'floor_changed'
  | 'tool_changed'
  | 'history_changed'
  | 'validation_requested'
  | 'render_requested';

export interface EditorEvent {
  readonly type: EditorEventType;
  readonly building: Building;
  readonly state: EditorState;
  readonly previousState?: EditorState;
  readonly command?: IEditorCommand;
}

export type EditorListener = (event: EditorEvent) => void;

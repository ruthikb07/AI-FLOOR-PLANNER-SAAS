/**
 * @ai-floor-planner/core/editor
 *
 * Interactive Architectural Editor Foundation.
 */

// Types & Interfaces
export type {
  EditorEntityType,
  EditorSelection,
  EditorTool,
  ViewportState,
  SnapConfiguration,
  TemporaryInteractionState,
  ValidationStatus,
  ValidationDisplayState,
  HistorySummary,
  EditorState,
  CommandExecutionResult,
  IEditorCommand,
  EditorEventType,
  EditorEvent,
  EditorListener,
} from './types';

export {
  DEFAULT_SNAP_CONFIG,
  DEFAULT_INTERACTION_STATE,
  DEFAULT_VALIDATION_DISPLAY,
} from './types';

// History Manager
export {
  CommandHistory,
} from './history';
export type {
  HistoryEntry,
} from './history';

// Commands
export {
  SelectEntityCommand,
  ClearSelectionCommand,
  SwitchFloorCommand,
  SetToolCommand,
  SetSelectionsCommand,
  AddRoomCommand,
  MoveRoomCommand,
  ResizeRoomCommand,
  UpdateRoomGeometryCommand,
  UpdateRoomPropertiesCommand,
  AddDoorCommand,
  MoveDoorCommand,
  UpdateDoorPropertiesCommand,
  RemoveDoorCommand,
  AddWindowCommand,
  MoveWindowCommand,
  UpdateWindowPropertiesCommand,
  RemoveWindowCommand,
  DeleteEntityCommand,
  BatchCommand,
  ReplaceBuildingCommand,
  UpdateSiteCommand,
  type UpdateSiteParams,
} from './commands/index';

// Editor Engine
export {
  EditorEngine,
} from './engine';
export type {
  EditorEngineOptions,
} from './engine';

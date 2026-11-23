import type { Building } from '../../types';
import { generateId } from '../../models/id';
import type { CommandExecutionResult, EditorState, IEditorCommand } from '../types';

/** Atomically applies an already-validated Building snapshot as one undoable action. */
export class ReplaceBuildingCommand implements IEditorCommand {
  readonly id = generateId();
  readonly description: string;
  private readonly before: Building;
  private readonly after: Building;

  constructor(before: Building, after: Building, description = 'Targeted regeneration', private readonly preserveSnapshot = false) {
    this.before = before;
    this.after = after;
    this.description = description;
  }

  execute(_building: Building, state: EditorState): CommandExecutionResult {
    if (!this.preserveSnapshot) return { building: this.after };
    return {
      building: this.after,
      preserveSnapshot: true,
      stateUpdates: {
        activeFloorId: this.after.floors.some(floor => floor.id === state.activeFloorId)
          ? state.activeFloorId : this.after.floors[0]?.id ?? '',
        selection: null,
        selections: [],
        hoveredEntity: null,
      },
    };
  }

  undo(_building: Building, _state: EditorState): CommandExecutionResult {
    return { building: this.before };
  }
}

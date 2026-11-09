import type { Building } from '../../types';
import { generateId } from '../../models/id';
import type { CommandExecutionResult, EditorState, IEditorCommand } from '../types';

export interface RoomAreaRegenerationMetadata {
  readonly roomId: string;
  readonly roomName: string;
  readonly requestedAreaMm2: number;
  readonly achievedAreaMm2: number;
  readonly candidateType: 'A' | 'B' | 'C';
  readonly changedRoomIds: readonly string[];
  readonly baseRevision: string;
}

/**
 * Reversible command for applying an accepted room area regeneration alternative.
 * Preserves full undo/redo and updates canonical building revision.
 */
export class ApplyRoomAreaRegenerationCommand implements IEditorCommand {
  readonly id = generateId();
  readonly description: string;
  readonly affectedEntityId: string;
  readonly metadata: RoomAreaRegenerationMetadata;
  private readonly before: Building;
  private readonly after: Building;

  constructor(before: Building, after: Building, metadata: RoomAreaRegenerationMetadata) {
    this.before = before;
    this.after = { ...after, version: before.version + 1 };
    this.metadata = metadata;
    this.affectedEntityId = metadata.roomId;
    const requestedM2 = (metadata.requestedAreaMm2 / 1_000_000).toFixed(2);
    const achievedM2 = (metadata.achievedAreaMm2 / 1_000_000).toFixed(2);
    this.description = `Regenerate ${metadata.roomName} to ${achievedM2} m² (target ${requestedM2} m² via Candidate ${metadata.candidateType})`;
  }

  execute(_building: Building, state: EditorState): CommandExecutionResult {
    return {
      building: this.after,
      stateUpdates: {
        selection: {
          entityType: 'room',
          entityId: this.metadata.roomId,
          floorId: state.activeFloorId,
        },
      },
    };
  }

  undo(_building: Building, state: EditorState): CommandExecutionResult {
    return {
      building: this.before,
      stateUpdates: {
        selection: {
          entityType: 'room',
          entityId: this.metadata.roomId,
          floorId: state.activeFloorId,
        },
      },
    };
  }
}

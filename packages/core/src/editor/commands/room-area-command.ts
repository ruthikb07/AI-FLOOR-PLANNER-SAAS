import { canonicalBuildingHash } from '../../models/canonical-revision';
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
  private readonly beforeHash: string;

  constructor(before: Building, after: Building, metadata: RoomAreaRegenerationMetadata, private readonly validateAcceptance?: (current: Building, proposed: Building) => void) {
    this.before = structuredClone(before);
    this.beforeHash = canonicalBuildingHash(before);
    this.after = { ...structuredClone(after), version: before.version + 1 };
    this.metadata = structuredClone(metadata);
    this.affectedEntityId = metadata.roomId;
    const requestedM2 = (metadata.requestedAreaMm2 / 1_000_000).toFixed(2);
    const achievedM2 = (metadata.achievedAreaMm2 / 1_000_000).toFixed(2);
    this.description = `Regenerate ${metadata.roomName} to ${achievedM2} m² (target ${requestedM2} m² via Candidate ${metadata.candidateType})`;
  }

  execute(building: Building, _state: EditorState): CommandExecutionResult {
    if (canonicalBuildingHash(building) !== this.beforeHash) throw new Error('Stale room regeneration command');
    if (!this.validateAcceptance) throw new Error('Room regeneration requires a deterministic acceptance validator');
    this.validateAcceptance(building, this.after);
    const floor = this.after.floors.find(f => f.rooms.some(r => r.id === this.metadata.roomId));
    if (!floor) throw new Error('Regenerated room identity is missing');
    return {
      building: structuredClone(this.after),
      stateUpdates: {
        activeFloorId: floor.id,
        selections: [{ entityType: 'room', entityId: this.metadata.roomId, floorId: floor.id }],
        selection: {
          entityType: 'room',
          entityId: this.metadata.roomId,
          floorId: floor.id,
        },
      },
    };
  }

  undo(_building: Building, _state: EditorState): CommandExecutionResult {
    const floor = this.before.floors.find(f => f.rooms.some(r => r.id === this.metadata.roomId))!;
    return {
      building: structuredClone(this.before),
      stateUpdates: {
        activeFloorId: floor.id,
        selections: [{ entityType: 'room', entityId: this.metadata.roomId, floorId: floor.id }],
        selection: {
          entityType: 'room',
          entityId: this.metadata.roomId,
          floorId: floor.id,
        },
      },
    };
  }
}


/**
 * Deterministic, Bounded Command History Stack for Undo/Redo.
 *
 * Stores reversible commands alongside structural references to Building states.
 */

import type { Building } from '../types';
import type { IEditorCommand, EditorState, HistorySummary } from './types';

export interface HistoryEntry {
  readonly command: IEditorCommand;
  readonly beforeBuilding: Building;
  readonly afterBuilding: Building;
  readonly beforeState?: Partial<EditorState>;
  readonly afterState?: Partial<EditorState>;
  readonly timestamp: string;
}

export class CommandHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private maxDepth: number;

  constructor(maxDepth: number = 50) {
    this.maxDepth = Math.max(1, maxDepth);
  }

  /** Push an executed command into the undo history and clear redo stack. */
  push(
    command: IEditorCommand,
    beforeBuilding: Building,
    afterBuilding: Building,
    beforeState?: Partial<EditorState>,
    afterState?: Partial<EditorState>,
  ): void {
    this.undoStack.push({
      command,
      beforeBuilding,
      afterBuilding,
      beforeState,
      afterState,
      timestamp: new Date().toISOString(),
    });

    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift(); // Evict oldest entry
    }

    // New action invalidates the redo branch
    this.redoStack = [];
  }

  /** Can we undo the last command? */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Can we redo the previously undone command? */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Number of actions available to undo. */
  get undoCount(): number {
    return this.undoStack.length;
  }

  /** Number of actions available to redo. */
  get redoCount(): number {
    return this.redoStack.length;
  }

  /** Description of the top command on the undo stack. */
  get lastCommandDescription(): string | undefined {
    const top = this.undoStack[this.undoStack.length - 1];
    return top?.command.description;
  }

  /** Summary snapshot for EditorState. */
  getSummary(): HistorySummary {
    return {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoCount: this.undoCount,
      redoCount: this.redoCount,
      lastCommandDescription: this.lastCommandDescription,
    };
  }

  /**
   * Undo the top command.
   * Returns the restored Building and any state updates, or null if undo stack is empty.
   */
  undo(currentState: EditorState): { building: Building; command: IEditorCommand; stateUpdates?: Partial<EditorState> } | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;

    // Call command.undo to get state updates
    const undoResult = entry.command.undo(entry.afterBuilding, currentState);

    this.redoStack.push(entry);

    return {
      building: entry.beforeBuilding,
      command: entry.command,
      stateUpdates: {
        ...entry.beforeState,
        ...undoResult.stateUpdates,
      },
    };
  }

  /**
   * Redo the top command on the redo stack.
   * Returns the restored Building and any state updates, or null if redo stack is empty.
   */
  redo(currentState: EditorState): { building: Building; command: IEditorCommand; stateUpdates?: Partial<EditorState> } | null {
    const entry = this.redoStack[this.redoStack.length - 1];
    if (!entry) return null;

    const redoResult = entry.command.execute(entry.beforeBuilding, currentState);
    this.redoStack.pop();

    this.undoStack.push(entry);

    return {
      building: entry.afterBuilding,
      command: entry.command,
      stateUpdates: {
        ...entry.afterState,
        ...redoResult.stateUpdates,
      },
    };
  }

  /** Clear all history. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Get read-only list of undo stack entries. */
  getUndoEntries(): readonly HistoryEntry[] {
    return this.undoStack;
  }

  /** Get read-only list of redo stack entries. */
  getRedoEntries(): readonly HistoryEntry[] {
    return this.redoStack;
  }
}

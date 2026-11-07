import type { Building, Room, RoomType } from '@ai-floor-planner/core';
import { moveRoom, resizeRoom, updateEntity } from '@ai-floor-planner/core';
import { diagnosticsToValidation, evaluateDesign, type ValidationSummary } from '@ai-floor-planner/planning-engine';
import { AIEditCommand } from './command';
import { resolveRoomTarget } from './target-resolver';
import type { AIEditIntent, AIEditPlannerOptions, AIEditPreview } from './types';

interface Candidate {
  readonly building: Building;
  readonly validation: ValidationSummary;
  readonly magnitude: number;
}

function versioned(building: Building, original: Building): Building {
  return {
    ...building,
    version: original.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

function uniquePositions(positions: readonly { x: number; y: number }[]) {
  const seen = new Set<string>();
  return positions.filter(position => {
    const key = `${Math.round(position.x)}:${Math.round(position.y)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class AIEditPlanner {
  constructor() {}

  private validate(building: Building, options: any = {}): ValidationSummary {
    return diagnosticsToValidation(building, options);
  }

  preview(building: Building, intent: AIEditIntent, options: AIEditPlannerOptions = {}): AIEditPreview {
    const validationOptions = {
      requiredRoomCounts: options.requiredRoomCounts as Partial<Record<RoomType, number>> | undefined,
      allowIncompleteDraft: options.allowIncompleteDraft ?? false,
    };
    const beforeValidation = this.validate(building, validationOptions);
    const resolution = resolveRoomTarget(
      building,
      intent.targetQuery,
      options.activeFloorId,
      options.selectedRoomId,
    );
    if (!resolution.room) {
      return {
        status: 'clarification_required',
        message: resolution.message ?? 'Choose a room to edit.',
        intent,
        targetRoom: null,
        beforeBuilding: building,
        afterBuilding: null,
        beforeValidation,
        afterValidation: null,
        command: null,
        attemptedCandidates: 0,
        validCandidates: 0,
      };
    }
    const room = resolution.room;
    if (room.isFixed) return this.rejected(building, beforeValidation, intent, room, 'Fixed/core rooms cannot be changed by AI editing.', 0);

    const candidates = intent.action === 'resize_room'
      ? this.resizeCandidates(building, room, intent, validationOptions)
      : intent.action === 'move_room'
        ? this.moveCandidates(building, room, intent, validationOptions)
        : this.renameCandidates(building, room, intent, validationOptions);
    const valid = candidates.filter(candidate => candidate.validation.isValid);
    if (!valid.length) {
      const first = candidates[0];
      const reason = first?.validation.violations.find(violation => !violation.passed)?.message;
      return this.rejected(
        building,
        beforeValidation,
        intent,
        room,
        reason ? `Edit rejected by constraints: ${reason}` : 'No hard-valid geometry was found for this instruction.',
        candidates.length,
        first?.validation ?? null,
      );
    }

    valid.sort((a, b) => {
      if (intent.action === 'move_room' && intent.direction !== 'auto') return b.magnitude - a.magnitude || b.validation.overallScore - a.validation.overallScore;
      return b.validation.overallScore - a.validation.overallScore || b.magnitude - a.magnitude;
    });
    const chosen = valid[0]!;
    const description = `AI: ${intent.reasoning}`;
    const command = new AIEditCommand(
      description,
      building,
      chosen.building,
      room.id,
      room.floorId,
    );
    return {
      status: 'ready',
      message: `Validated edit ready. Quality ${beforeValidation.overallScore}→${chosen.validation.overallScore}; plan version ${building.version}→${chosen.building.version}.`,
      intent,
      targetRoom: room,
      beforeBuilding: building,
      afterBuilding: chosen.building,
      beforeValidation,
      afterValidation: chosen.validation,
      beforeDiagnostics: evaluateDesign(building),
      afterDiagnostics: evaluateDesign(chosen.building),
      command,
      attemptedCandidates: candidates.length,
      validCandidates: valid.length,
    };
  }

  private resizeCandidates(
    building: Building,
    room: Room,
    intent: AIEditIntent,
    options: any,
  ): Candidate[] {
    let width = intent.widthMm ?? room.width;
    let height = intent.heightMm ?? room.height;
    if (intent.scalePercent !== undefined) {
      const factor = Math.sqrt(Math.max(0.2, 1 + intent.scalePercent / 100));
      width = room.width * factor;
      height = room.height * factor;
    } else if (intent.dimensionDeltaMm !== undefined) {
      width = room.width + intent.dimensionDeltaMm;
      height = room.height + intent.dimensionDeltaMm;
    }
    const dimensionOptions = [{ width, height }];
    if (intent.scalePercent !== undefined && intent.scalePercent > 0) {
      const areaFactor = 1 + intent.scalePercent / 100;
      dimensionOptions.push({ width: room.width * areaFactor, height: room.height });
      dimensionOptions.push({ width: room.width, height: room.height * areaFactor });
    }
    const candidates: Candidate[] = [];
    for (const dimensions of dimensionOptions) {
      if (dimensions.width < 500 || dimensions.height < 500) continue;
      const dx = dimensions.width - room.width;
      const dy = dimensions.height - room.height;
      const positions = uniquePositions([
        { x: room.x, y: room.y },
        { x: room.x - dx, y: room.y },
        { x: room.x, y: room.y - dy },
        { x: room.x - dx, y: room.y - dy },
        { x: room.x - dx / 2, y: room.y - dy / 2 },
      ]);
      for (const position of positions) {
        try {
          const resized = resizeRoom(building, room.id, Math.round(dimensions.width), Math.round(dimensions.height));
          const moved = moveRoom(resized, room.id, Math.round(position.x), Math.round(position.y));
          const candidateBuilding = versioned(moved, building);
          candidates.push({
            building: candidateBuilding,
            validation: this.validate(candidateBuilding, options),
            magnitude: Math.abs(dimensions.width * dimensions.height - room.area),
          });
        } catch {
          // Invalid numeric/domain proposals are omitted from the bounded candidate set.
        }
      }
    }
    return candidates;
  }

  private moveCandidates(
    building: Building,
    room: Room,
    intent: AIEditIntent,
    options: any,
  ): Candidate[] {
    const requested = Math.max(100, Math.min(intent.distanceMm ?? 500, 10000));
    const offsets: { x: number; y: number; magnitude: number }[] = [];
    const direction = intent.direction ?? 'auto';
    if (direction !== 'auto') {
      for (const ratio of [1, 0.75, 0.5, 0.25]) {
        const amount = Math.round(requested * ratio);
        offsets.push({
          x: direction === 'east' ? amount : direction === 'west' ? -amount : 0,
          y: direction === 'south' ? amount : direction === 'north' ? -amount : 0,
          magnitude: amount,
        });
      }
    } else {
      for (const amount of [250, 500, 750, 1000, 1500, 2000]) {
        const directionalOffsets: readonly (readonly [number, number])[] = [
          [amount, 0], [-amount, 0], [0, amount], [0, -amount],
          [amount, amount], [-amount, amount], [amount, -amount], [-amount, -amount],
        ];
        for (const [x, y] of directionalOffsets) {
          offsets.push({ x, y, magnitude: Math.abs(x) + Math.abs(y) });
        }
      }
    }
    return offsets.map(offset => {
      try {
        const moved = versioned(moveRoom(building, room.id, room.x + offset.x, room.y + offset.y), building);
        return { building: moved, validation: this.validate(moved, options), magnitude: offset.magnitude };
      } catch {
        return null;
      }
    }).filter((candidate): candidate is Candidate => candidate !== null);
  }

  private renameCandidates(
    building: Building,
    room: Room,
    intent: AIEditIntent,
    options: any,
  ): Candidate[] {
    const name = intent.newName?.trim().slice(0, 80);
    if (!name || name === room.name) return [];
    const renamed = versioned(updateEntity(building, 'room', room.id, { name }), building);
    return [{ building: renamed, validation: this.validate(renamed, options), magnitude: 1 }];
  }

  private rejected(
    building: Building,
    beforeValidation: ValidationSummary,
    intent: AIEditIntent,
    room: Room,
    message: string,
    attemptedCandidates: number,
    afterValidation: ValidationSummary | null = null,
  ): AIEditPreview {
    return {
      status: 'rejected', message, intent, targetRoom: room,
      beforeBuilding: building, afterBuilding: null,
      beforeValidation, afterValidation,
      beforeDiagnostics: evaluateDesign(building),
      afterDiagnostics: null,
      command: null,
      attemptedCandidates, validCandidates: 0,
    };
  }
}

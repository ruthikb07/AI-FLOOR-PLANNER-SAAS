import type { Building, Room, DesignDiagnostics } from '@ai-floor-planner/core';
import type { ValidationSummary } from '@ai-floor-planner/planning-engine';
import type { AIEditCommand } from './command';

export type AIEditAction = 'resize_room' | 'move_room' | 'rename_room';
export type AIEditDirection = 'north' | 'south' | 'east' | 'west' | 'auto';
export type AIEditParseSource = 'provider' | 'rule_based' | 'rule_based_fallback';

export interface AIEditIntent {
  readonly action: AIEditAction;
  readonly targetQuery: string;
  readonly direction?: AIEditDirection;
  readonly distanceMm?: number;
  readonly widthMm?: number;
  readonly heightMm?: number;
  readonly scalePercent?: number;
  readonly dimensionDeltaMm?: number;
  readonly newName?: string;
  readonly reasoning: string;
}

export interface AIEditDiagnostic {
  readonly code: 'EMPTY_COMMAND' | 'UNSUPPORTED_COMMAND' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_TIMEOUT' | 'PROVIDER_ERROR' | 'INVALID_PROVIDER_OUTPUT';
  readonly severity: 'info' | 'warning';
  readonly message: string;
}

export interface AIEditParseResult {
  readonly intent: AIEditIntent | null;
  readonly source: AIEditParseSource;
  readonly providerName: string | null;
  readonly model: string | null;
  readonly usedFallback: boolean;
  readonly diagnostics: readonly AIEditDiagnostic[];
  readonly latencyMs: number;
}

export interface AIEditRoomSummary {
  readonly id: string;
  readonly floorId: string;
  readonly floorLevel: number;
  readonly name: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly isFixed: boolean;
  readonly selected: boolean;
}

export interface AIEditModelContext {
  readonly buildingId: string;
  readonly buildingVersion: number;
  readonly plotWidthMm: number;
  readonly plotDepthMm: number;
  readonly activeFloorId: string;
  readonly selectedRoomId: string | null;
  readonly rooms: readonly AIEditRoomSummary[];
  readonly promptSummary: string;
}

export interface AIEditPlannerOptions {
  readonly activeFloorId?: string;
  readonly selectedRoomId?: string;
  readonly requiredRoomCounts?: Readonly<Record<string, number>>;
  readonly allowIncompleteDraft?: boolean;
}

export interface AIEditPreview {
  readonly status: 'ready' | 'clarification_required' | 'rejected';
  readonly message: string;
  readonly intent: AIEditIntent;
  readonly targetRoom: Room | null;
  readonly beforeBuilding: Building;
  readonly afterBuilding: Building | null;
  readonly beforeValidation: ValidationSummary;
  readonly afterValidation: ValidationSummary | null;
  readonly beforeDiagnostics?: DesignDiagnostics;
  readonly afterDiagnostics?: DesignDiagnostics | null;
  readonly command: AIEditCommand | null;
  readonly attemptedCandidates: number;
  readonly validCandidates: number;
}

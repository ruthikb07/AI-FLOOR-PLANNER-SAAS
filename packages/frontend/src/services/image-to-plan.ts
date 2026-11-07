/**
 * Phase 3 - Image interpretation driving helpers (frontend).
 *
 * Converts a stored, immutable concept image into a validated editable 2D plan
 * through the server-side boundary: RAW IMAGE -> INTERPRETATION -> STRUCTURED
 * PLAN -> NORMALIZATION -> HARD VALIDATION -> CANONICAL 2D PLAN (or REJECT).
 *
 * Stage reporting is honest: each stage reflects actual progress, and a failed
 * stage names itself (PRD 33).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesignRequirementSpecification, SpaceProgram } from '@ai-floor-planner/core';
import { BackendAPI, BackendError } from './backend-api';
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  projectStorage,
  type ArchitecturalEvaluation,
  type ProjectEnvelope,
} from './storage';

export type InterpretationStage =
  | 'reading_image'
  | 'interpreting_image'
  | 'validating_plan'
  | 'evaluating_architecture';

export interface InterpretationFlowState {
  readonly stage: InterpretationStage;
  readonly completed: readonly InterpretationStage[];
  readonly failedStage: InterpretationStage | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface InterpretationOutcome {
  readonly status: 'ACCEPTED' | 'REJECTED';
  readonly planId: string | null;
  readonly diagnostics: readonly { code: string; severity: string; message: string }[];
  readonly rejectedReason: string | null;
}

export interface UseImageToPlanOptions {
  readonly projectId: string;
  readonly backend?: BackendAPI;
}

/** Saved evaluation lookup for display after reload. */
export function readArchitecturalEvaluation(envelope: ProjectEnvelope): ArchitecturalEvaluation | null {
  return envelope.architecturalEvaluation ?? null;
}

/**
 * Drives the Phase 3 image-to-plan flow. On success the accepted building is
 * installed as the workspace canonical Building via the provided callback, and
 * the Gemini architectural evaluation is stored for display.
 */
export function useImageToPlan({ projectId, backend }: UseImageToPlanOptions) {
  const service = backend ?? new BackendAPI();
  const running = useRef<AbortController>();
  const [flow, setFlow] = useState<InterpretationFlowState>({
    stage: 'reading_image',
    completed: [],
    failedStage: null,
    errorCode: null,
    errorMessage: null,
  });
  const [outcome, setOutcome] = useState<InterpretationOutcome | null>(null);
  const [evaluation, setEvaluation] = useState<ArchitecturalEvaluation | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => running.current?.abort(), []);

  const run = useCallback(async (
    params: {
      readonly requirements: DesignRequirementSpecification;
      readonly program: SpaceProgram | undefined;
      readonly imageBase64: string;
      readonly imageMimeType: string;
      readonly imageWidePixels: number;
      readonly imageTallPixels: number;
      readonly onAcceptBuilding: (building: never) => void;
      readonly evaluate?: boolean;
      readonly buildingSummary?: string;
      readonly requirementsSummary?: string;
    },
  ): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setOutcome(null);
    setEvaluation(null);
    setFlow({ stage: 'reading_image', completed: [], failedStage: null, errorCode: null, errorMessage: null });
    const controller = new AbortController();
    running.current = controller;
    const markComplete = (stage: InterpretationStage) => setFlow(current => ({ ...current, completed: [...current.completed, stage] }));
    const fail = (stage: InterpretationStage, code: string, message: string) => {
      setFlow(current => ({ ...current, stage, failedStage: stage, errorCode: code, errorMessage: message }));
    };
    try {
      markComplete('reading_image');
      setFlow(current => ({ ...current, stage: 'interpreting_image' }));

      const outcome = await service.interpretFloorPlanImage(
        projectId,
        params.requirements.projectName ?? projectId,
        params.requirements,
        params.program,
        params.imageBase64,
        params.imageMimeType,
        params.imageWidePixels,
        params.imageTallPixels,
        controller.signal,
      );
      markComplete('interpreting_image');
      setFlow(current => ({ ...current, stage: 'validating_plan' }));

      if (outcome.status !== 'ACCEPTED' || !outcome.building) {
        setOutcome({
          status: 'REJECTED',
          planId: outcome.planId,
          diagnostics: outcome.diagnostics,
          rejectedReason: outcome.rejectedReason ?? 'The extracted plan did not pass deterministic validation.',
        });
        fail('validating_plan', 'PLAN_REJECTED', outcome.rejectedReason ?? 'The extracted plan did not pass deterministic validation.');
        return false;
      }

      params.onAcceptBuilding(outcome.building as never);
      setOutcome({ status: 'ACCEPTED', planId: outcome.planId, diagnostics: outcome.diagnostics, rejectedReason: null });
      markComplete('validating_plan');

      if (params.evaluate) {
        setFlow(current => ({ ...current, stage: 'evaluating_architecture' }));
        try {
          const response = await service.evaluateArchitecture(
            params.buildingSummary ?? projectId,
            params.requirementsSummary ?? params.requirements.projectName ?? projectId,
            params.imageBase64,
            params.imageMimeType,
            controller.signal,
          );
          const stored: ArchitecturalEvaluation = {
            schemaVersion: 1,
            projectId,
            planId: outcome.planId,
            generatedAt: new Date().toISOString(),
            ...response.evaluation,
          };
          const current = projectStorage.load(projectId);
          if (current) {
            projectStorage.save({
              ...current,
              schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
              architecturalEvaluation: stored,
              updatedAt: new Date().toISOString(),
            });
          }
          setEvaluation(stored);
        } catch (evaluationError) {
          const message = evaluationError instanceof BackendError ? evaluationError.message : 'Architectural evaluation is unavailable; the valid plan was kept.';
          fail('evaluating_architecture', evaluationError instanceof BackendError ? evaluationError.code : 'ARCHITECTURAL_EVALUATION_FAILED', message);
          return true;
        }
        markComplete('evaluating_architecture');
      }
      return true;
    } catch (cause) {
      const code = cause instanceof BackendError ? cause.code : 'IMAGE_INTERPRETATION_FAILED';
      const message = cause instanceof Error ? cause.message : 'Image interpretation failed.';
      fail('interpreting_image', code, message);
      setOutcome({ status: 'REJECTED', planId: null, diagnostics: [], rejectedReason: message });
      return false;
    } finally {
      setBusy(false);
      running.current = undefined;
    }
  }, [busy, projectId, service]);

  const reset = useCallback(() => {
    setFlow({ stage: 'reading_image', completed: [], failedStage: null, errorCode: null, errorMessage: null });
    setOutcome(null);
    setEvaluation(null);
  }, []);

  return { run, reset, flow, outcome, evaluation, busy };
}
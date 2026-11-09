import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  X,
  RotateCcw,
} from 'lucide-react';
import type { PipelineStageId, PipelineStageProgressEvent } from '@ai-floor-planner/planning-engine';
import { ArgonButton } from './ui';

interface GenerationProgressModalProps {
  readonly isOpen: boolean;
  readonly error?: string;
  readonly progress?: PipelineStageProgressEvent | null;
  readonly onCancel?: () => void;
  readonly onRetry?: () => void;
}

const STAGE_LABELS: Record<PipelineStageId, string> = {
  PLOT_BOUNDARY_SOLVE: 'Validating Plot & Setbacks',
  UNIT_SPATIAL_SLICING: 'Solving Spatial Layout',
  WALL_AND_OPENING_TOPOLOGY: 'Assembling Topology',
  COLUMN_AND_BEAM_GRID: 'Placing Structure (S-COLS & S-BEAM)',
  GEOMETRY_ZERO_ERROR_AUDIT: 'Auditing Geometry (Zero Delta)',
  UDCPR_CHECK: 'Measured UDCPR / NBC Assessment',
  COMPLETE: 'Finalizing Canonical Manifest',
};

export const GenerationProgressModal: React.FC<GenerationProgressModalProps> = ({
  isOpen,
  error,
  progress,
  onCancel,
  onRetry,
}) => {
  if (!isOpen) return null;

  const currentStage = progress?.stage ?? 'PLOT_BOUNDARY_SOLVE';
  const hasError = Boolean(error) || progress?.status === 'FAILED';

  const getStageState = (stage: PipelineStageId): 'completed' | 'active' | 'pending' | 'error' => {
    if (hasError && stage === currentStage) return 'error';
    const status = progress?.stageStatuses[stage];
    if (status === 'COMPLETED') return 'completed';
    if (status === 'RUNNING') return 'active';
    return 'pending';
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-argon-text/40 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-2xl bg-argon-card border border-argon-border rounded-2xl shadow-xl overflow-hidden text-argon-text flex flex-col">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-argon-border bg-argon-surface/90">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-argon-btn text-argon-card flex items-center justify-center shadow-xs">
              <Sparkles className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-argon-muted">
                ARGON 4 SOLVER ENGINE
              </div>
              <h2 className="text-base font-bold text-argon-text mt-0.5 tracking-tight">
                Synthesizing Architectural Building Model
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-argon-card border border-argon-border text-xs font-mono text-argon-text shadow-2xs">
              <Clock className="w-3.5 h-3.5 text-argon-btn" />
              <span>{progress?.currentStageDurationMs ? Math.round(progress.currentStageDurationMs / 1000) : 0}s</span>
            </div>
            {onCancel && (
              <button
                onClick={onCancel}
                className="p-1.5 rounded-lg hover:bg-argon-surface text-argon-muted hover:text-argon-text transition-colors"
                title="Close Modal"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-argon-surface h-2 relative overflow-hidden">
          <div
            className="h-full bg-argon-btn transition-all duration-300 ease-out"
            style={{ width: `${progress?.progressPercent ?? 0}%` }}
          />
        </div>

        {/* Main Content Body */}
        <div className="p-6 space-y-3.5 max-h-[60vh] overflow-y-auto argon-scrollbar">
          <div className="space-y-2">
            {(Object.keys(STAGE_LABELS) as PipelineStageId[]).map((stage, idx) => {
              const state = getStageState(stage);
              return (
                <div
                  key={stage}
                  className={`p-3.5 rounded-xl border transition-all ${
                    state === 'active'
                      ? 'bg-argon-accent/15 border-argon-accent shadow-2xs'
                      : state === 'completed'
                      ? 'bg-argon-pass/10 border-argon-pass/30'
                      : state === 'error'
                      ? 'bg-argon-error/10 border-argon-error/40'
                      : 'bg-argon-surface/30 border-argon-border/50 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                      {state === 'completed' && <CheckCircle2 className="w-5 h-5 text-argon-pass" />}
                      {state === 'active' && (
                        <div className="w-4 h-4 border-2 border-argon-btn border-t-transparent rounded-full animate-spin" />
                      )}
                      {state === 'error' && <AlertTriangle className="w-5 h-5 text-argon-error" />}
                      {state === 'pending' && <div className="w-4 h-4 border-2 border-argon-border rounded-full" />}
                    </div>
                    <span
                      className={`text-sm font-semibold flex items-center justify-between w-full ${
                        state === 'active'
                          ? 'text-argon-btn font-bold'
                          : state === 'completed'
                          ? 'text-argon-text'
                          : state === 'error'
                          ? 'text-argon-error'
                          : 'text-argon-muted'
                      }`}
                    >
                      <span>
                        0{idx + 1}. {STAGE_LABELS[stage]}
                      </span>
                      <small className="font-mono text-xs text-argon-muted font-normal">
                        {progress?.stageStatuses[stage] ?? 'PENDING'} ·{' '}
                        {Math.round(progress?.stageTimingsMs[stage] ?? 0)} ms
                      </small>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {hasError && (
            <div className="p-4 rounded-xl bg-argon-error/15 border border-argon-error/30 text-argon-error text-xs font-medium">
              {error || progress?.errors?.at(-1)?.description || 'Generation failed. Review the plot and room program.'}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-argon-border bg-argon-surface/90 flex items-center justify-between">
          <div className="text-xs text-argon-muted font-mono">
            <span>Canonical Building Contract &middot; Zero-Error Geometry Audit</span>
          </div>
          <div className="flex items-center gap-3">
            {hasError && onRetry && (
              <ArgonButton
                variant="primary"
                size="sm"
                leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                onClick={onRetry}
              >
                Retry Generation
              </ArgonButton>
            )}
            {onCancel && (
              <ArgonButton
                variant="secondary"
                size="sm"
                onClick={onCancel}
              >
                {hasError ? 'Close' : 'Cancel'}
              </ArgonButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

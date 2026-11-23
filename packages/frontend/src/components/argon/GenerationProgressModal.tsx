import { useEffect, useState } from 'react';
import { ArrowRight, Clock, RotateCcw } from 'lucide-react';
import type { PipelineStageId, PipelineStageProgressEvent } from '@ai-floor-planner/planning-engine';
import type { WizardState } from '../../stores/useStudioStore';
import { ParcelStudy } from './ParcelStudy';
import { ArgonButton } from './ui';

interface GenerationProgressModalProps {
  readonly isOpen: boolean;
  readonly error?: string;
  readonly progress?: PipelineStageProgressEvent | null;
  readonly onCancel?: () => void;
  readonly onRetry?: () => void;
  readonly draft?: WizardState;
}

const STAGES: ReadonlyArray<{ id: PipelineStageId; label: string }> = [
  { id: 'PLOT_BOUNDARY_SOLVE', label: 'Check plot and setbacks' },
  { id: 'UNIT_SPATIAL_SLICING', label: 'Solve apartment layouts' },
  { id: 'WALL_AND_OPENING_TOPOLOGY', label: 'Assemble walls, openings and circulation' },
  { id: 'COLUMN_AND_BEAM_GRID', label: 'Place preliminary framing' },
  { id: 'GEOMETRY_ZERO_ERROR_AUDIT', label: 'Audit geometry and areas' },
  { id: 'UDCPR_CHECK', label: 'Evaluate configured planning rules' },
  { id: 'COMPLETE', label: 'Prepare the building model' },
];

export function GenerationProgressModal({ isOpen, error, progress, onCancel, onRetry, draft }: GenerationProgressModalProps) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isOpen) return;
    setElapsed(0);
    const start = performance.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((performance.now() - start) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [isOpen]);

  if (!isOpen && !error) return null;
  const failed = Boolean(error) || progress?.status === 'FAILED';
  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-black/35 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="rh-generation-title"
        className="rh-generation rh-atelier-generation w-full max-h-full overflow-auto bg-argon-card shadow-xl">
        {draft && <aside><ParcelStudy draft={draft} mode="site" interactive={false} /><p>Brief parcel · {draft.projectName}</p></aside>}
        <div className="rh-generation-sheet">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="rh-kicker">Architectural generation</p>
            <h2 id="rh-generation-title" className="font-display text-3xl font-semibold">
              {failed ? 'Generation needs attention' : 'Generating your building'}
            </h2>
          </div>
          <span className="flex items-center gap-1 font-mono text-xs" aria-label="Elapsed time"><Clock size={14} /> {elapsed}s</span>
        </header>
        {failed ? <p role="alert" className="mt-4 text-sm text-argon-error">
          {error || progress?.errors?.at(-1)?.description || 'Review the plot and room program, then try again.'}
        </p> : <p role="status" className="mt-4 text-sm text-argon-muted">
          {progress ? STAGES.find((stage) => stage.id === progress.stage)?.label : 'Waiting for the planning service to return a model.'}
        </p>}
        {!failed && <progress className="my-3 block w-full accent-[var(--argon-btn)]" aria-label="Generation progress"
          max={100} value={progress?.progressPercent} />}
        {progress && <ol className="my-4 divide-y divide-[var(--argon-border)] border-y border-argon-border">
          {STAGES.map(({ id, label }) => (
            <li key={id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>{label}</span>
              <span className="shrink-0 font-mono text-xs text-argon-muted">{progress.stageStatuses[id] ?? 'PENDING'}</span>
            </li>
          ))}
        </ol>}
        <footer className="mt-5 flex flex-wrap justify-end gap-2">
          {onCancel && <ArgonButton variant="secondary" size="sm" onClick={onCancel}>{failed ? 'Close' : 'Cancel'}</ArgonButton>}
          {failed && onRetry && <ArgonButton variant="primary" size="sm" onClick={onRetry} leftIcon={<RotateCcw size={14} />} rightIcon={<ArrowRight size={14} />}>Retry Generation</ArgonButton>}
        </footer>
        </div>
      </section>
    </div>
  );
}

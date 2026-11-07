/**
 * Phase 3 - Image to 2D conversion panel (PRD 19-27).
 *
 * RAW IMAGE -> INTERPRETATION -> STRUCTURED PLAN -> NORMALIZATION ->
 * HARD VALIDATION -> CANONICAL 2D PLAN -> GEMINI EVALUATION.
 *
 * Honesty: rejected conversions never install geometry, the stored image is
 * never modified, and the Gemini score is never presented as validity (PRD 26).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, ScanSearch, TriangleAlert } from 'lucide-react';
import type { DesignRequirementSpecification, SpaceProgram } from '@ai-floor-planner/core';
import { readArchitecturalEvaluation, useImageToPlan, type InterpretationStage } from '../../services/image-to-plan';
import { imageDataUrl, resolveImageRequirements } from '../../services/ai-concept-image';
import type { ArchitecturalEvaluation, ProjectEnvelope } from '../../services/storage';

interface ImageToPlanPanelProps {
  projectId: string;
  envelope: ProjectEnvelope;
  session?: { imageBase64: string; mimeType: string; width?: number; height?: number } | null;
  onAcceptBuilding: (building: never) => void;
  onConverted?: () => void;
}

const STAGE_LABELS: Record<InterpretationStage, string> = {
  reading_image: 'Reading stored image',
  interpreting_image: 'Converting to 2D',
  validating_plan: 'Validating geometry',
  evaluating_architecture: 'Gemini evaluation',
};

const SCORE_ROWS = [
  ['Requirement fit', 'requirementSatisfaction'],
  ['Spatial quality', 'spatialQuality'],
  ['Circulation', 'circulation'],
  ['Adjacency', 'adjacency'],
  ['Zoning', 'zoning'],
  ['Privacy', 'privacy'],
  ['Daylight', 'daylight'],
  ['Efficiency', 'efficiency'],
] as const;

export const ImageToPlanPanel: React.FC<ImageToPlanPanelProps> = ({ projectId, envelope, session, onAcceptBuilding, onConverted }) => {
  const { run, reset, flow, outcome, evaluation, busy } = useImageToPlan({ projectId });
  const [savedEvaluation, setSavedEvaluation] = useState(() => readArchitecturalEvaluation(envelope));
  const [includeEvaluation, setIncludeEvaluation] = useState(true);
  useEffect(() => { setSavedEvaluation(readArchitecturalEvaluation(envelope)); }, [envelope, outcome]);

  const convert = useCallback(async () => {
    if (!session?.imageBase64) return;
    reset();
    const ok = await run({
      requirements: resolveImageRequirements(envelope) as DesignRequirementSpecification,
      program: envelope.spaceProgram as SpaceProgram | undefined,
      imageBase64: session.imageBase64,
      imageMimeType: session.mimeType,
      imageWidePixels: session.width ?? 1024,
      imageTallPixels: session.height ?? 1024,
      onAcceptBuilding,
      evaluate: includeEvaluation,
      buildingSummary: '2D plan converted from the generated concept image',
      requirementsSummary: resolveImageRequirements(envelope)?.projectName ?? projectId,
    });
    if (ok) onConverted?.();
  }, [session, envelope, includeEvaluation, onAcceptBuilding, onConverted, projectId, reset, run]);

  const accepted = outcome?.status === 'ACCEPTED';
  const rejected = outcome?.status === 'REJECTED';
  const shown: ArchitecturalEvaluation | null = evaluation ?? savedEvaluation;

  return (
    <section className="generation-concept-image" aria-label="Image to editable 2D plan">
      <header className="concept-image-header">
        <div>
          <span className="eyebrow">Image to 2D CAD</span>
          <h2>Convert image to editable plan</h2>
        </div>
        <button className="btn-primary" onClick={convert} disabled={busy || !session?.imageBase64}>
          {busy ? <Loader2 size={14} /> : <ScanSearch size={14} />}
          {busy ? 'Converting…' : 'Convert to 2D'}
        </button>
      </header>

      {session?.imageBase64 && (
        <figure className="concept-image-frame">
          <img src={imageDataUrl(session.mimeType, session.imageBase64)} alt="Stored AI concept image being converted" />
        </figure>
      )}

      {(busy || flow.completed.length > 0) && (
        <ol className="concept-image-stages" aria-live="polite">
          {(Object.keys(STAGE_LABELS) as InterpretationStage[]).map(stage => {
            const done = flow.completed.includes(stage);
            const failedHere = flow.failedStage === stage;
            const active = flow.stage === stage && !failedHere;
            return (
              <li key={stage} className={failedHere ? 'concept-stage-failed' : done ? 'concept-stage-done' : active ? 'concept-stage-active' : 'concept-stage-pending'}>
                {done ? <CheckCircle2 size={13} /> : failedHere ? <TriangleAlert size={13} /> : active ? <Loader2 size={13} /> : null}
                <span>{STAGE_LABELS[stage]}</span>
                {failedHere && flow.errorCode && <strong>{flow.errorCode}</strong>}
              </li>
            );
          })}
        </ol>
      )}

      {accepted && (
        <p className="concept-image-note" role="status">
          <CheckCircle2 size={14} /> Converted into a valid 2D plan — open in the CAD editor.
        </p>
      )}

      {rejected && outcome && (
        <div className="concept-image-error" role="alert">
          <p><TriangleAlert size={14} /> The image was NOT converted. The original image is unchanged and no substitute plan was created.</p>
          {outcome.rejectedReason && <p>{outcome.rejectedReason}</p>}
          {outcome.diagnostics.filter(d => d.severity === 'error').slice(0, 5).map(issue => (
            <p key={issue.code}><strong>{issue.code}:</strong> {issue.message}</p>
          ))}
        </div>
      )}

      {flow.failedStage === 'evaluating_architecture' && flow.errorMessage && (
        <p className="concept-image-note" role="status"><TriangleAlert size={14} /> {flow.errorMessage}</p>
      )}

      {shown && (
        <aside className="concept-image-evaluation" aria-label="Gemini architectural evaluation">
          <span className="eyebrow">Gemini architectural evaluation · review required</span>
          <h3>Overall {shown.overallScore} / 100</h3>
          <dl className="concept-image-metadata">
            {SCORE_ROWS.map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{shown[key]}</dd></div>)}
          </dl>
          {shown.strengths.length > 0 && <div><strong>Strengths</strong><ul>{shown.strengths.map(item => <li key={item}>{item}</li>)}</ul></div>}
          {shown.concerns.length > 0 && <div><strong>Concerns</strong><ul>{shown.concerns.map(item => <li key={item}>{item}</li>)}</ul></div>}
          {shown.rationale && <p>{shown.rationale}</p>}
          <p className="concept-image-note">Model: {shown.model} · Score only, never validity (PRD 26).</p>
        </aside>
      )}

      <label className="concept-image-toggle">
        <input type="checkbox" checked={includeEvaluation} onChange={event => setIncludeEvaluation(event.target.checked)} />
        Request Gemini architectural evaluation after conversion
      </label>
      <p className="concept-image-disclaimer">
        IMMUTABLE SOURCE · The stored image is never altered. Rejected conversions leave it untouched.
      </p>
    </section>
  );
};
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Sparkles, X } from 'lucide-react';
import type { ArchitecturalEvaluationResult } from '@ai-floor-planner/ai-orchestration';
import type { EditorContextValue } from '../../stores/editor-store';

interface DesignAssistantProps {
  editor: EditorContextValue;
  onClose: () => void;
  onEdit: () => void;
}

export function DesignAssistant({ editor, onClose, onEdit }: DesignAssistantProps) {
  const { building, activeFloor, selection, validationSummary } = editor;
  const activeRoom = selection?.entityType === 'room'
    ? activeFloor.rooms.find((room) => room.id === selection.entityId)
    : undefined;
  const activeFlat = activeFloor.apartmentUnits?.find((flat) => flat.id === activeRoom?.unitId);
  const context = JSON.stringify([building.id, building.version, activeFloor.id, selection]);
  const currentContext = useRef(context);
  currentContext.current = context;
  const request = useRef<AbortController>();
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<ArchitecturalEvaluationResult>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const pending = request.current;
    pending?.abort();
    setBusy(false);
    setResult(undefined);
    setError('');
    return () => request.current?.abort();
  }, [context]);

  async function review() {
    if (!prompt.trim() || !validationSummary.isValid || busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setResult(undefined);
    const isCurrent = () => !controller.signal.aborted && currentContext.current === context;
    try {
      const response = await fetch('/api/v1/architecture/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          buildingSummary: JSON.stringify({
            project: building.name,
            buildingId: building.id,
            revision: building.version,
            floor: { id: activeFloor.id, name: activeFloor.name },
            selectedFlat: activeFlat && { id: activeFlat.id, type: activeFlat.unitType },
            selection,
            validationFindingCount: validationSummary.violations.length,
            rooms: activeFloor.rooms.map(({ id, unitId, name, type, width, height, area }) => ({
              id, unitId, name, type, widthMm: width, depthMm: height, areaSqM: area / 1_000_000,
            })),
          }),
          requirementsSummary: prompt.trim(),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? `Review failed (${response.status}).`);
      if (!body.evaluation || !Array.isArray(body.evaluation.concerns) || !Array.isArray(body.evaluation.strengths)) {
        throw new Error('The review service returned an invalid response.');
      }
      if (isCurrent()) setResult(body.evaluation);
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : 'Architectural review failed.');
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  return (
    <aside className="rh-assistant" aria-label="Architectural Design Review">
      <header>
        <h2><Sparkles size={17} /> Architectural Design Review</h2>
        <button type="button" className="rh-button" aria-label="Close review panel" onClick={onClose}><X size={17} /></button>
      </header>
      <p className="rh-assistant-context">{editor.projectName} · Revision {building.version} · {activeFloor.name}
        {activeFlat ? ` · ${activeFlat.unitType}` : ''}
        {selection ? ` · ${activeRoom?.name ?? selection.entityType}` : ''}
      </p>
      <p>Request an advisory architectural review of the active floor. Apply dimensional changes in the Wall &amp; Room Editor.</p>
      {!validationSummary.isValid && <p role="status">Resolve the current geometry findings before requesting a review.</p>}
      <form onSubmit={(event) => { event.preventDefault(); void review(); }}>
        <label htmlFor="rh-assistant-prompt">Review request</label>
        <textarea id="rh-assistant-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)}
          maxLength={1500} rows={4} placeholder="Review circulation and daylight for this floor." />
        <div className="rh-assistant-actions">
          <button className="rh-button rh-button-primary" disabled={!prompt.trim() || busy || !validationSummary.isValid} type="submit">
            {error ? 'Retry review' : 'Run Architectural Review'}
          </button>
          {busy && <button className="rh-button" type="button" onClick={() => { request.current?.abort(); setBusy(false); }}>Cancel request</button>}
          <button className="rh-button" type="button" onClick={onEdit}>Open plan editor <ArrowRight size={15} /></button>
        </div>
      </form>
      {busy && <p role="status">Waiting for the architectural review service…</p>}
      {error && <p role="alert">{error}</p>}
      {result && <div className="rh-assistant-result" role="status">
        <h3>Advisory review · Revision {building.version}</h3>
        {result.rationale && <p>{result.rationale}</p>}
        <ul>{[...result.concerns, ...result.strengths].map((finding, index) => <li key={index}>{finding}</li>)}</ul>
      </div>}
    </aside>
  );
}

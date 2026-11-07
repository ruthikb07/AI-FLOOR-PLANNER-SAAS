/**
 * AI Concept Image panel — Master PRD Phase 2 (§17/§18).
 *
 * Drives the real end-to-end Phase 2 loop for a user:
 *   Enter Requirements -> Feasibility -> Generate -> Receive AI Floor Plan Image
 *   -> See the image -> Regenerate alternatives
 *
 * Honesty rules enforced here:
 *  - The image is labelled an AI concept, NOT a validated plan (PRD §7).
 *  - No fake progress: real pending/error states only; the failed stage is named.
 *  - Regeneration always produces a NEW immutable artifact (PRD §24).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImageOff, Loader2, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { BackendAPI, BackendError } from '../../services/backend-api';
import {
  compileImageRequest,
  imageContextSignature,
  imageDataUrl,
  resolveImageRequirements,
} from '../../services/ai-concept-image';
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  projectStorage,
  type FloorPlanImageSession,
  type ProjectEnvelope,
} from '../../services/storage';

interface AiConceptImagePanelProps {
  projectId: string;
  /** The live envelope from the workspace, used for freshness comparison. */
  envelope: ProjectEnvelope;
}

export const AiConceptImagePanel: React.FC<AiConceptImagePanelProps> = ({ projectId, envelope }) => {
  const backend = useMemo(() => new BackendAPI(), []);
  const running = useRef<AbortController>();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; running.current?.abort(); }, []);

  const [session, setSession] = useState<FloorPlanImageSession | undefined>(() => {
    const saved = projectStorage.load(projectId)?.floorPlanImage;
    return saved ?? undefined;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | undefined>();

  useEffect(() => {
    setSession(projectStorage.load(projectId)?.floorPlanImage ?? undefined);
  }, [projectId]);

  const requirements = useMemo(() => resolveImageRequirements(envelope), [envelope]);
  const liveSignature = imageContextSignature(envelope.building);
  const stale = !!session && session.contextSignature !== liveSignature;
const run = useCallback(async () => {
    if (busy) return;
    const attempt = (session?.attempt ?? -1) + 1;
    const request = compileImageRequest(envelope, attempt);
    if (!request) {
      setError({ code: 'IMAGE_REQUIREMENTS_MISSING', message: 'Save a reviewed Space Program before requesting a concept image.' });
      return;
    }
    setBusy(true);
    setError(undefined);
    const controller = new AbortController();
    running.current = controller;
    try {
      const artifact = await backend.generateFloorPlanImage(projectId, request, controller.signal);
      if (!mounted.current) return;
      const next: FloorPlanImageSession = {
        schemaVersion: 1,
        generationId: artifact.generationId,
        seed: artifact.seed,
        attempt,
        generatedAt: artifact.generatedAt,
        promptVersion: artifact.promptVersion,
        model: artifact.model,
        provider: artifact.provider,
        mimeType: artifact.mimeType,
        imageBase64: artifact.imageBase64,
        request,
        contextSignature: liveSignature,
      };
      const current = projectStorage.load(projectId);
      if (!current) throw new Error('Project no longer exists.');
      projectStorage.save({
        ...current,
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        floorPlanImage: next,
        updatedAt: new Date().toISOString(),
      });
      setSession(next);
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof BackendError) setError({ code: cause.code, message: cause.message });
      else setError({ code: 'IMAGE_GENERATION_FAILED', message: cause instanceof Error ? cause.message : 'Image generation failed.' });
    } finally {
      if (mounted.current) setBusy(false);
      running.current = undefined;
    }
  }, [backend, busy, envelope, liveSignature, projectId, session?.attempt]);

  const hasProgram = !!requirements;
return (
    <section className="generation-concept-image" aria-label="AI architectural concept image">
      <header className="concept-image-header">
        <div>
          <span className="eyebrow">AI concept image · FLUX</span>
          <h2>Architectural floor-plan concept</h2>
        </div>
        <button
          className="btn-secondary"
          onClick={run}
          disabled={busy || !hasProgram}
          title={hasProgram ? undefined : 'Save a reviewed Space Program first'}
        >
          {busy ? <Loader2 size={14} /> : session ? <RefreshCw size={14} /> : <Sparkles size={14} />}
          {busy ? 'Generating…' : session ? 'Regenerate alternative' : 'Generate concept image'}
        </button>
      </header>

      {!hasProgram && (
        <p className="concept-image-note"><TriangleAlert size={14} /> A reviewed Space Program is required before a concept image can be requested.</p>
      )}

      {error && (
        <p className="concept-image-error" role="alert" data-code={error.code}>
          <TriangleAlert size={14} /> {error.message}
        </p>
      )}

      {session && (
        <>
          <figure className="concept-image-frame">
            <img src={imageDataUrl(session.mimeType, session.imageBase64)} alt="AI generated architectural floor-plan concept" />
          </figure>
          {stale && (
            <p className="concept-image-stale">
              <TriangleAlert size={14} /> This image was generated from an earlier revision of the Site or Program. Regenerate to reflect the current inputs.
            </p>
          )}
          <dl className="concept-image-metadata">
            <div><dt>Generation</dt><dd>{session.generationId}</dd></div>
            <div><dt>Seed</dt><dd>{session.seed}</dd></div>
            <div><dt>Attempt</dt><dd>{session.attempt + 1}</dd></div>
            <div><dt>Model</dt><dd>{session.model}</dd></div>
            <div><dt>Provider</dt><dd>{session.provider}</dd></div>
            <div><dt>Prompt version</dt><dd>v{session.promptVersion}</dd></div>
          </dl>
          <details className="concept-image-prompt">
            <summary>Original generation prompt</summary>
            <p>{session.request.prompt}</p>
            <p className="concept-image-negative"><strong>Excluded:</strong> {session.request.negativePrompt}</p>
          </details>
        </>
      )}

      <p className="concept-image-disclaimer">
        AI CONCEPT IMAGE ONLY · NOT A VALIDATED PLAN · Geometry is validated separately by the deterministic system.
      </p>

      {!session && !busy && hasProgram && (
        <p className="concept-image-note"><ImageOff size={14} /> No concept image generated yet for this project.</p>
      )}
    </section>
  );
};
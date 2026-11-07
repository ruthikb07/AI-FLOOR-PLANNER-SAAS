import React, { useEffect, useMemo, useRef, useState } from 'react';
import { reviewedWorkflowInput, isGenerationSessionCurrent, acceptGenerationResult } from '../../services/reviewed-generation';
import { BackendAPI } from '../../services/backend-api';
import { ArchitecturalEvidencePanel } from './ArchitecturalEvidencePanel';
import { AiConceptImagePanel } from './AiConceptImagePanel';
import { ImageToPlanPanel } from './ImageToPlanPanel';
import type { CandidatePlan, Floor, RoomType } from '@ai-floor-planner/core';
import { buildingHasDesignedGeometry, adaptSpaceProgramToPlannerProgram } from '@ai-floor-planner/core';
import {
  GENERATION_STAGES, assessGenerationReadiness,
  type GenerationStageId,
} from '@ai-floor-planner/planning-engine';
import {
  ArrowLeft, Check, CheckCircle2, ChevronRight, Circle, CircleDot,
  GitCompareArrows, Layers3, Play, ShieldCheck, TriangleAlert, X,
} from 'lucide-react';
import {
  CURRENT_PROJECT_SCHEMA_VERSION, projectStorage,
  type GenerationSession, type ProjectEnvelope,
} from '../../services/storage';

interface GenerationWorkspaceProps {
  projectId: string;
  onBackToFootprint: () => void;
  onBackToProgram: () => void;
  onBackToSite: () => void;
  onBackToProjects: () => void;
  onOpenEditor: () => void;
}

type StageState = 'PENDING' | 'ACTIVE' | 'COMPLETE';

const MM2_PER_FT2 = 92_903.04;
const area = (value: number) => `${(value / MM2_PER_FT2).toLocaleString(undefined, { maximumFractionDigits: 0 })} ft²`;
const floorName = (level: number) => level === 0 ? 'Ground' : level === 1 ? 'First' : level === 2 ? 'Second' : `Level ${level}`;
const points = (floor: Floor) => floor.boundary.points.map(point => `${point.x},${point.y}`).join(' ');

const ROOM_COLORS: Partial<Record<RoomType, string>> = {
  living: '#d7e7df', dining: '#e7e0cf', kitchen: '#dce6cf', bedroom: '#d9deec',
  bathroom: '#d5e6ea', staircase: '#e0d8cb', lift: '#cfd5dc', parking: '#e3e5e7',
};

function PlanPreview({ candidate, floorLevel }: { candidate: CandidatePlan; floorLevel: number }) {
  const floor = candidate.building.floors.find(item => item.level === floorLevel) ?? candidate.building.floors[0]!;
  const width = candidate.building.site.plotWidth;
  const depth = candidate.building.site.plotDepth;
  const labelSize = Math.max(180, Math.min(width, depth) * 0.018);
  return <svg className="generation-plan" viewBox={`0 0 ${width} ${depth}`} role="img" aria-label={`${candidate.name} ${floorName(floor.level)} plan preview`}>
    <rect width={width} height={depth} className="generation-plot" />
    <polygon points={points(floor)} className="generation-boundary" />
    {floor.rooms.map(room => <g key={room.id}>
      <rect x={room.x} y={room.y} width={room.width} height={room.height} fill={ROOM_COLORS[room.type] ?? '#dde1e5'} className="generation-room" />
      <text x={room.x + room.width / 2} y={room.y + room.height / 2} fontSize={labelSize}>{room.name}</text>
    </g>)}
    {floor.walls.map(wall => <line key={wall.id} x1={wall.startPoint.x} y1={wall.startPoint.y} x2={wall.endPoint.x} y2={wall.endPoint.y} className={wall.type === 'external' ? 'external' : ''} />)}
  </svg>;
}

function metricRows(candidate: CandidatePlan) {
  return [
    ['Overall quality', candidate.metrics.overallQualityScore],
    ['Area efficiency', candidate.metrics.areaEfficiencyScore],
    ['Adjacency', candidate.metrics.adjacencyScore],
    ['Circulation', candidate.metrics.circulationScore],
    ['Privacy', candidate.metrics.privacyScore],
    ['Multi-floor', candidate.multiFloorPlanning.buildingLevelScore],
  ] as const;
}

export const GenerationWorkspace: React.FC<GenerationWorkspaceProps> = props => {
  const mounted = useRef(true);
  const running = useRef<AbortController>();
  const backend = useMemo(() => new BackendAPI(), []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; running.current?.abort(); }; }, []);
  const [envelope, setEnvelope] = useState<ProjectEnvelope>(() => {
    const loaded = projectStorage.load(props.projectId);
    if (!loaded) throw new Error('Project not found.');
    return loaded;
  });
  const [session, setSession] = useState<GenerationSession | undefined>(envelope.generationSession ?? undefined);
  const [selectedId, setSelectedId] = useState(session?.selectedCandidateId ?? session?.candidates[0]?.id);
  const [selectedFloor, setSelectedFloor] = useState(0);
  const [stageStates, setStageStates] = useState<Record<GenerationStageId, StageState>>(() => Object.fromEntries(GENERATION_STAGES.map(stage => [stage.id, 'PENDING'])) as Record<GenerationStageId, StageState>);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => {
    const refresh = () => {
      const latest = projectStorage.load(props.projectId);
      if (latest) { setEnvelope(latest); setSession(latest.generationSession ?? undefined); }
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('focus', refresh); };
  }, [props.projectId]);
  const program = envelope.spaceProgram;
  const evidenceProgram = useMemo(() => {
    try { return program ? adaptSpaceProgramToPlannerProgram(program, envelope.building.site.plannedFloorCount ?? envelope.building.floors.length) : undefined; }
    catch { return undefined; }
  }, [program, envelope.building]);
  const input = reviewedWorkflowInput(envelope);
  const readiness = useMemo(() => input ? assessGenerationReadiness(input) : {
    status: 'BLOCKED' as const,
    issues: [{ code: 'INPUTS_MISSING', severity: 'BLOCKING' as const, message: 'A saved Space Program and Footprint are required before generation.' }],
  }, [input]);
  const candidates = isGenerationSessionCurrent(envelope, session) ? session?.candidates ?? [] : [];
  const selected = candidates.find(candidate => candidate.id === selectedId) ?? candidates[0];

  const generate = async () => {
    if (!input || readiness.status === 'BLOCKED') return;
    setBusy(true);
    const controller = new AbortController(); running.current = controller;
    setError(undefined);
    setStageStates(Object.fromEntries(GENERATION_STAGES.map(stage => [stage.id, 'PENDING'])) as Record<GenerationStageId, StageState>);
    try {
      const result = await backend.generate(input, controller.signal, job => {
        if (job.stage) setStageStates(previous => ({ ...previous, [job.stage!]: job.status === 'SUCCEEDED' ? 'COMPLETE' : 'ACTIVE' }));
      });
      if (!mounted.current) return;
      const generationSession: GenerationSession = { schemaVersion: 1, generatedAt: result.generatedAt, candidates: result.candidates, requestHash: result.requestHash, requestSeed: input.request!.seed };
      const current = projectStorage.load(props.projectId);
      if (!current) throw new Error('Project no longer exists.');
      const updated = acceptGenerationResult(current, generationSession);
      projectStorage.save(updated);
      setEnvelope(updated);
      setSession(generationSession);
      setSelectedId(result.candidates[0]?.id);
      setSelectedFloor(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Generation could not complete.');
    } finally {
      setBusy(false);
      running.current = undefined;
    }
  };

  const select = (candidate: CandidatePlan) => {
    setSelectedId(candidate.id);
    if (!session) return;
    const current = projectStorage.load(props.projectId);
    if (!current || !isGenerationSessionCurrent(current, session)) { setError('These options are stale. Review Requirements and Budget again.'); return; }
    const nextSession = { ...session, selectedCandidateId: candidate.id };
    const updated = { ...current, generationSession: nextSession };
    projectStorage.save(updated);
    setSession(nextSession);
    setEnvelope(updated);
  };

  const applyCandidate = () => {
    if (!selected) return;
    const current = projectStorage.load(props.projectId);
    if (!current || !isGenerationSessionCurrent(current, session)) { setError('These options are stale. Review Requirements and Budget again.'); return; }
    const updated: ProjectEnvelope = {
      ...current,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      building: selected.building,
      requiredRoomCounts: selected.requiredRoomCounts,
      generationSession: session ? { ...session, selectedCandidateId: selected.id } : undefined,
      status: 'GENERATED',
      updatedAt: new Date().toISOString(),
    };
    projectStorage.save(updated);
    props.onOpenEditor();
  };

  const requestApply = () => {
    if (buildingHasDesignedGeometry(envelope.building)) setConfirmOpen(true);
    else applyCandidate();
  };

  return <div className="generation-workspace">
    <header className="generation-header">
      <button className="btn-icon" aria-label="Back to projects" onClick={props.onBackToProjects}><ArrowLeft size={17} /></button>
      <div className="generation-brand"><Layers3 size={18} /><div><strong>FORMA</strong><small>DESIGN GENERATION</small></div></div>
      <nav className="generation-stage-nav" aria-label="Project workflow">
        {['PROJECT', 'SITE', 'REQUIREMENTS', 'BUDGET', 'GENERATE'].map((stage, index) => <React.Fragment key={stage}>
          <button className={stage === 'GENERATE' ? 'active' : ''} disabled={stage === 'PROJECT'} onClick={stage === 'SITE' ? props.onBackToSite : stage === 'REQUIREMENTS' ? props.onBackToProgram : stage === 'BUDGET' ? props.onBackToFootprint : undefined}>{stage}</button>
          {index < 4 && <ChevronRight size={13} />}
        </React.Fragment>)}
      </nav>
      <span className="generation-save-state">{session && !isGenerationSessionCurrent(envelope, session) ? 'Saved options are stale — review inputs' : session ? `${candidates.length} options saved locally` : 'No generated options'}</span>
    </header>

    <main className="generation-main">
      <section className="generation-title">
        <div><span className="eyebrow">Project / Generate</span><h1>{envelope.name}</h1><p>Use exactly the reviewed requirements, approved building area and boundary policy. An unsupported result stops here; your brief is not relaxed.</p></div>
        <div><button className="btn-secondary" onClick={props.onBackToFootprint}>Back to Budget</button><button className="btn-primary" disabled={busy || readiness.status === 'BLOCKED'} onClick={generate}><Play size={14} />{busy ? 'Generating…' : session ? 'Regenerate Options' : 'Generate Options'}</button>{busy && <button className="btn-secondary" onClick={() => running.current?.abort()}>Cancel generation</button>}</div>
      </section>

      {input?.request && <section className="intent-card" aria-label="Exact approved generation summary">
        <h2>Exact approved brief</h2>
        <p>Site {input.request.site.plotWidth / 1000} × {input.request.site.plotDepth / 1000} m · {input.request.instances.length} reviewed spaces · ±{input.request.budget.acceptedTolerance * 100}% planning tolerance</p>
        <p>{Object.entries(input.request.floorTargets).map(([level, target]) => `${floorName(Number(level))}: ${(target / 1e6).toFixed(2)} m²`).join(' · ')} · Total {(Object.values(input.request.floorTargets).reduce((sum, target) => sum + target, 0) / 1e6).toFixed(2)} m²</p>
        <p>Boundary: {input.request.budget.footprintFreedom.replaceAll('_', ' ').toLowerCase()} · Seed {input.request.seed}</p>
        <small>Brief reference {input.request.requestHash} · Preliminary architectural concept only</small>
      </section>}

      <AiConceptImagePanel projectId={props.projectId} envelope={envelope} />

      <ImageToPlanPanel
        projectId={props.projectId}
        envelope={envelope}
        session={envelope.floorPlanImage ? {
          imageBase64: envelope.floorPlanImage.imageBase64,
          mimeType: envelope.floorPlanImage.mimeType,
          width: envelope.floorPlanImage.request.width,
          height: envelope.floorPlanImage.request.height,
        } : null}
        onAcceptBuilding={building => {
          const current = projectStorage.load(props.projectId);
          if (!current) return;
          projectStorage.save({
            ...current,
            schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
            building: building as typeof current.building,
            status: 'GENERATED',
            updatedAt: new Date().toISOString(),
          });
        }}
        onConverted={props.onOpenEditor}
      />

      <section className={`generation-readiness ${readiness.status.toLowerCase()}`}>
        <div>{readiness.status === 'READY' ? <ShieldCheck size={20} /> : <TriangleAlert size={20} />}<span><strong>{readiness.status === 'READY' ? 'APPROVED INPUTS READY' : 'GENERATION BLOCKED'}</strong><small>{readiness.status === 'READY' ? 'The current engine will attempt this exact brief. A valid architectural solution is not guaranteed.' : 'Review the reasons below. Existing geometry and approved targets stay unchanged.'}</small></span></div>
        {readiness.issues.map(issue => <p key={issue.code}><strong>{issue.code.replaceAll('_', ' ')}</strong>{issue.message}</p>)}
      </section>

      <div className="generation-layout">
        <aside className="generation-progress">
          <div><span className="eyebrow">Actual execution</span><h2>Generation pipeline</h2></div>
          <ol>{GENERATION_STAGES.map(stage => { const state = stageStates[stage.id]; return <li key={stage.id} className={state.toLowerCase()}>{state === 'COMPLETE' ? <CheckCircle2 size={18} /> : state === 'ACTIVE' ? <CircleDot size={18} /> : <Circle size={18} />}<span><strong>{stage.label}</strong><small>{stage.detail}</small></span></li>; })}</ol>
          <div className="generation-engine-note"><strong>What is not evaluated</strong><p>Regulatory compliance, structural analysis, energy performance and professional approval remain NOT CHECKED.</p></div>
        </aside>

        <section className="generation-candidates">
          <div className="generation-section-heading"><div><span className="eyebrow">Ranked alternatives</span><h2>{candidates.length ? `${candidates.length} hard-valid options` : 'Awaiting generation'}</h2></div>{session && <span>Generated {new Date(session.generatedAt).toLocaleString()}</span>}</div>
          {error && <div className="generation-error"><TriangleAlert size={17} /><div><strong>Generation stopped safely</strong><p>{error}</p></div></div>}
          {!candidates.length && !error && <div className="generation-empty"><GitCompareArrows size={30} /><h3>No alternatives generated</h3><p>Run the verified pipeline to create calculated options. Existing project geometry will remain unchanged until you explicitly adopt one.</p></div>}
          {!!candidates.length && <>
            <div className="candidate-strip" style={{ gridTemplateColumns: `repeat(${candidates.length}, minmax(0, 1fr))` }}>{candidates.map(candidate => <button key={candidate.id} className={candidate.id === selected?.id ? 'active' : ''} onClick={() => select(candidate)}><span>OPTION {String.fromCharCode(64 + candidate.rank)}</span><strong>{candidate.name.replace(/\s+\d+BHK$/, '')}</strong><small>{candidate.description}</small><div><b>{candidate.metrics.overallQualityScore}</b><em>CALCULATED</em></div></button>)}</div>
            {selected && <div className="generation-review">
              <div className="generation-canvas-card">
                <div className="generation-canvas-toolbar"><div><span className="eyebrow">Option {String.fromCharCode(64 + selected.rank)}</span><h2>{selected.name}</h2></div><span>HARD VALID <Check size={14} /></span></div>
                <PlanPreview candidate={selected} floorLevel={selectedFloor} />
                <div className="generation-floor-nav"><span>BUILDING</span>{[...selected.building.floors].reverse().map(floor => <button key={floor.id} className={floor.level === selectedFloor ? 'active' : ''} onClick={() => setSelectedFloor(floor.level)}><strong>{floorName(floor.level)}</strong><small>{floor.rooms.length} spaces</small></button>)}</div>
              </div>
              <aside className="generation-evidence">
                <span className="eyebrow">Calculated evidence</span><h2>Option summary</h2>
                <dl><div><dt>Hard constraints</dt><dd>PASS</dd></div><div><dt>Rooms</dt><dd>{selected.metrics.roomCount}</dd></div><div><dt>Carpet area</dt><dd>{area(selected.metrics.totalCarpetAreaMm2)}</dd></div><div><dt>Floors</dt><dd>{selected.multiFloorPlanning.floorCount}</dd></div><div><dt>Valid attempts</dt><dd>{selected.optimization.validAttempts}/{selected.optimization.attempts}</dd></div><div><dt>Accepted repairs</dt><dd>{selected.optimization.acceptedRepairs}</dd></div></dl>
                <ArchitecturalEvidencePanel candidate={selected} program={evidenceProgram} />
                <button className="btn-primary generation-adopt" onClick={requestApply}>Open Concept for Review <ChevronRight size={15} /></button>
                <p className="generation-disclaimer">CONCEPT DESIGN · NOT FOR CONSTRUCTION · Professional review required.</p>
              </aside>
            </div>}
            <section className="generation-comparison"><div><span className="eyebrow">Evidence comparison</span><h2>Compare calculated metrics</h2></div><div className="comparison-grid" style={{ gridTemplateColumns: `minmax(150px, 1.3fr) repeat(${candidates.length}, minmax(90px, 1fr))` }}><span>Metric</span>{candidates.map(candidate => <strong key={candidate.id}>Option {String.fromCharCode(64 + candidate.rank)}</strong>)}{metricRows(candidates[0]!).map(([label], row) => <React.Fragment key={label}><span>{label}</span>{candidates.map(candidate => <b key={candidate.id}>{metricRows(candidate)[row]![1]}</b>)}</React.Fragment>)}</div></section>
          </>}
        </section>
      </div>
    </main>

    {confirmOpen && selected && <div className="generation-modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="replace-design-title" className="generation-dialog"><button aria-label="Close replacement warning" onClick={() => setConfirmOpen(false)}><X size={16} /></button><TriangleAlert size={24} /><h2 id="replace-design-title">Replace current concept geometry?</h2><p>Adopting Option {String.fromCharCode(64 + selected.rank)} replaces the current rooms, walls, openings and stairs with this generated candidate. The saved Site, Program, Footprint and alternative set remain available.</p><div><button className="btn-secondary" onClick={() => setConfirmOpen(false)}>Cancel</button><button className="btn-primary" onClick={applyCandidate}>Replace & Open Editor</button></div></section></div>}
  </div>;
};

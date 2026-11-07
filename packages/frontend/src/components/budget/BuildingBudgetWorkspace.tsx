import React, { useState } from 'react';
import { approveBuildingBudget, assessBuildingBudget, createUnreviewedBudget, refreshBudgetApproval, reviewedDependencySignature, getFootprintEnvelope, validateFootprint,
  type BuildingBudgetIntent, type BuildingBudgetMode, type FootprintFreedom, type FootprintIntent } from '@ai-floor-planner/core';
import { projectStorage } from '../../services/storage';

interface Props { projectId: string; onSite: () => void; onRequirements: () => void; onFootprint: () => void; onGenerate: () => void }
const area = (n: number) => Number.isFinite(n) ? `${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} m²` : 'Not specified';
export function BuildingBudgetWorkspace(props: Props) {
  const [project] = useState(() => projectStorage.load(props.projectId));
  const [budget, setBudget] = useState<BuildingBudgetIntent>(() => project?.buildingBudget ?? createUnreviewedBudget());
  const [footprint, setFootprint] = useState<FootprintIntent | undefined>(project?.footprintIntent);
  const [error, setError] = useState('');
  if (!project?.spaceProgram || !footprint) return <main className="intent-workspace"><h1>Review your requirements first</h1><button onClick={props.onRequirements}>Open requirements</button></main>;
  const context = { building: project.building, program: project.spaceProgram, footprint, generationControl: project.generationControl };
  const assessment = assessBuildingBudget(context, budget);
  const floors = project.building.site.plannedFloorCount ?? project.building.floors.length;
  const state = refreshBudgetApproval(context, budget).approvalState;
  const change = (patch: Partial<BuildingBudgetIntent>) => { setBudget(current => ({ ...current, provenance: 'USER_DEFINED', ...patch, approvalState: 'UNREVIEWED' })); setError(''); };
  const saveDraft = () => {
    const latest = projectStorage.load(props.projectId);
    if (!latest) throw new Error('Project no longer exists.');
    projectStorage.save({ ...latest, buildingBudget: budget, footprintIntent: footprint, generationSession: null });
  };
  const approve = () => {
    try {
      const latest = projectStorage.load(props.projectId);
      if (!latest?.spaceProgram) throw new Error('Requirements unavailable.');
      if (reviewedDependencySignature({ ...context, building: latest.building, program: latest.spaceProgram, generationControl: latest.generationControl }) !== reviewedDependencySignature(context)) throw new Error('Requirements changed in another window. Reopen Budget to review the latest brief.');
      const approved = approveBuildingBudget({ ...context, building: latest.building, program: latest.spaceProgram, generationControl: latest.generationControl }, budget);
      projectStorage.save({ ...latest, buildingBudget: approved, footprintIntent: footprint, generationSession: null });
      setBudget(approved); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Budget could not be approved.'); }
  };
  const recommend = () => {
    const total = Math.round(assessment.recommendedRange[1] / 1e6) * 1e6;
    // Explicit user action proposes a balanced floor allocation, never approval.
    change({ mode: 'TOTAL_BUILT_UP', totalGrossTarget: total, groundFootprintTarget: undefined, coverageTarget: undefined,
      floorTargets: Object.fromEntries(Array.from({ length: floors }, (_, level) => [level, total / floors])), provenance: 'RECOMMENDED' });
  };
  const proposeBoundary = () => {
    const ground = assessment.floorTargets[0];
    const envelope = getFootprintEnvelope(project.building);
    if (!ground || ground <= 0) { setError('Choose a valid ground-floor area first.'); return; }
    const ratio = Math.min(1.5, Math.max(0.7, envelope.width / envelope.depth));
    // This explicit preview action fits the requested area, never chooses it.
    const width = Math.min(envelope.width, Math.max(ground / envelope.depth, Math.sqrt(ground * ratio)));
    const depth = ground / width;
    const proposal: FootprintIntent = { ...footprint, shape: 'rectangle', parameters: { width, depth },
      transform: { x: envelope.x + (envelope.width - width) / 2, y: envelope.y + (envelope.depth - depth) / 2, rotation: 0, mirrored: false },
      strategy: 'custom_per_floor', floorOverrides: Object.entries(assessment.floorTargets).filter(([level]) => Number(level) > 0).map(([level, target]) => ({ floorLevel: Number(level), scalePercent: Math.sqrt(target / ground) * 100 })),
      provenance: 'USER_DEFINED', updatedAt: new Date().toISOString() };
    const validity = validateFootprint(project.building, proposal);
    if (validity.status === 'INVALID') { setError('This simple rectangular preview cannot fit. Use Boundary settings; your area target is unchanged.'); return; }
    setFootprint(proposal); change({});
  };
  const areaInput = (label: string, value: number | undefined, update: (n: number | undefined) => void) => <label>{label}<input aria-label={label} type="number" min="0" step="0.1" value={value === undefined ? '' : Number((value / 1e6).toFixed(3))} onChange={e => update(e.target.value === '' ? undefined : Number(e.target.value) * 1e6)} /></label>;
  return <main className="intent-workspace">
    <header><strong>AI BUILDING SAAS</strong><nav aria-label="Design steps"><button onClick={props.onSite}>1 Site</button><button onClick={props.onRequirements}>2 Requirements</button><b>3 Building Budget</b><span>4 Generate</span></nav></header>
    <section className="intent-title"><div><small>REVIEWED RESIDENTIAL INTENT</small><h1>How much building do you need?</h1><p>The plot is land. Your building area is a separate, explicit decision.</p></div><span className={`intent-state ${state.toLowerCase()}`}>{state === 'APPROVED' ? 'Budget approved' : state === 'STALE' ? 'Review required — inputs changed' : 'Unreviewed budget'}</span></section>
    <div className="intent-layout"><section className="intent-card">
      <h2>Building area & floor allocation</h2><p>Area fields use m². Your site's saved dimension units are preserved.</p>
      <label>Choose your target mode<select aria-label="Budget mode" value={budget.mode} onChange={e => change({ mode: e.target.value as BuildingBudgetMode })}><option value="TOTAL_BUILT_UP">Total built-up area</option><option value="GROUND_FOOTPRINT">Ground footprint</option><option value="FLOOR_WISE">Floor-wise areas</option><option value="COVERAGE">Site coverage</option></select></label>
      <div className="intent-fields">{areaInput('Total built-up target (m²)', budget.totalGrossTarget, totalGrossTarget => change({ totalGrossTarget }))}{areaInput('Ground footprint target (m²)', budget.groundFootprintTarget, groundFootprintTarget => change({ groundFootprintTarget }))}
      <label>Site coverage (%)<input aria-label="Site coverage (%)" type="number" min="0" max="100" value={budget.coverageTarget === undefined ? '' : budget.coverageTarget * 100} onChange={e => change({ coverageTarget: e.target.value === '' ? undefined : Number(e.target.value) / 100 })} /></label>
      <label>Planning tolerance (%)<input aria-label="Planning tolerance (%)" type="number" min="0" max="5" step=".5" value={budget.acceptedTolerance * 100} onChange={e => change({ acceptedTolerance: Number(e.target.value) / 100 })} /></label>
      {Array.from({ length: floors }, (_, level) => <React.Fragment key={level}>{areaInput(`${level === 0 ? 'Ground' : `Floor ${level}`} allocation (m²)`, budget.floorTargets[level], value => { const next = { ...budget.floorTargets }; if (value === undefined) delete next[level]; else next[level] = value; change({ floorTargets: next }); })}</React.Fragment>)}</div>
      <p>Multiple targets must agree exactly. The tolerance applies to generated results, not contradictory inputs.</p>
      <label>Building boundary policy<select aria-label="Building boundary policy" value={budget.footprintFreedom} onChange={e => change({ footprintFreedom: e.target.value as FootprintFreedom })}><option value="FIXED_BOUNDARY">Keep selected boundary fixed</option><option value="FLEXIBLE_WITHIN_ENVELOPE">Allow changes inside buildable envelope</option><option value="APPROVAL_REQUIRED_FOR_CHANGE">Ask before changing the boundary</option></select></label>
      <button onClick={recommend}>Use recommended target & propose equal floor allocations</button><p>This fills a draft for your review; it does not approve it.</p>
      <h2>Selected boundary preview</h2><p>{footprint.shape} · {(footprint.parameters.width / 1000).toFixed(2)} m × {(footprint.parameters.depth / 1000).toFixed(2)} m. Site dimensions stay unchanged.</p>
      <button onClick={proposeBoundary}>Preview rectangle matching these floor targets</button> <button onClick={() => { saveDraft(); props.onFootprint(); }}>Boundary settings</button>
      <p>The preview is a proposed boundary, not a synthesized plan. The current engine may still be unable to fill it while preserving your approved brief.</p>
    </section><aside className="intent-card intent-summary"><h2>{state === 'APPROVED' ? 'Your approved brief' : 'Your brief for review'}</h2><dl>
      <dt>Plot dimensions</dt><dd>{project.building.site.plotWidth / 1000} × {project.building.site.plotDepth / 1000} m</dd>
      <dt>Site area</dt><dd>{area(assessment.siteArea)}</dd><dt>Buildable envelope / floor</dt><dd>{area(assessment.envelopeArea)}</dd>
      <dt>Recommended building range</dt><dd>{area(assessment.recommendedRange[0])} – {area(assessment.recommendedRange[1])}</dd>
      <dt>Selected total target</dt><dd>{area(assessment.totalGrossTarget)}</dd><dt>Selected spaces</dt><dd>{project.spaceProgram.items.reduce((sum, item) => sum + item.quantity, 0)}</dd>
      <dt>Target tolerance</dt><dd>±{budget.acceptedTolerance * 100}%</dd></dl>
      <ul aria-label="Selected floor targets">{Object.entries(assessment.floorTargets).map(([level, target]) => <li key={level}>{level === '0' ? 'Ground' : `Floor ${level}`} · {area(target)}</li>)}</ul>
      <ul>{project.spaceProgram.items.map(item => <li key={item.id}>{item.quantity} × {item.name} · {item.priority} · {item.floorPreference.kind === 'specific' ? `Floor ${item.floorPreference.specificFloor}` : item.floorPreference.kind.replaceAll('_', ' ')}</li>)}</ul>
      <p>Preliminary area guidance, not statutory coverage, construction approval or structural safety.</p>
      {!!assessment.issues.length && <div className="intent-errors" role="alert"><strong>Resolve before approval</strong>{assessment.issues.map((issue, index) => <p key={index}>{issue.message}</p>)}</div>}
      {error && <div className="intent-errors" role="alert">{error}</div>}
      <button className="intent-primary" disabled={assessment.issues.length > 0} onClick={approve}>Approve requirements & budget</button>
      <button className="intent-primary" disabled={state !== 'APPROVED'} onClick={props.onGenerate}>Continue to Generate →</button>
    </aside></div>
  </main>;
}

import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Bath, BedDouble, BriefcaseBusiness, Building2, CarFront, CheckCircle2,
  ChevronRight, CircleAlert, CookingPot, DoorOpen, GraduationCap, Layers3, Minus,
  Plus, Search, Shapes, Sofa, Trash2, TriangleAlert,
} from 'lucide-react';
import {
  addProgramItem, applySpaceProgramPreset, calculateProgramCapacity, createCustomProgramItem,
  createEmptySpaceProgram, createProgramItem, getGenerationReadiness,
  getSpaceCatalog, getSpaceProgramPresets, removeProgramItem, searchSpaceCatalog,
  updateProgramItem, validateSpaceProgram,
  type SpaceDefinition, type SpaceFloorPreference, type SpaceFunctionalGroup,
  type SpacePriority, type SpaceProgram, type SpaceProgramItem,
} from '@ai-floor-planner/core';
import { CURRENT_PROJECT_SCHEMA_VERSION, projectStorage, type ProjectEnvelope } from '../../services/storage';

interface ProgramWorkspaceProps {
  projectId: string;
  onBackToSite: () => void;
  onBackToProjects: () => void;
  onOpenFootprint: () => void;
}

const GROUP_LABELS: Partial<Record<SpaceFunctionalGroup, string>> = {
  private: 'Private', baths: 'Baths', living: 'Living', service: 'Service', special: 'Special',
  circulation: 'Circulation', outdoor: 'Outdoor', vehicle: 'Vehicle', work: 'Work',
  learning: 'Learning', technical: 'Technical',
};
const PRIORITIES: SpacePriority[] = ['required', 'preferred', 'optional'];
const RESERVE_RATIO = 0.22;

function areaDivisor(unit: 'metric' | 'imperial'): number {
  return unit === 'imperial' ? 304.8 * 304.8 : 1_000_000;
}
function displayArea(mm2: number, unit: 'metric' | 'imperial'): number {
  return Number((mm2 / areaDivisor(unit)).toFixed(1));
}
function parseArea(value: string, unit: 'metric' | 'imperial'): number {
  return Number(value) * areaDivisor(unit);
}
function areaText(mm2: number, unit: 'metric' | 'imperial'): string {
  return displayArea(mm2, unit).toLocaleString() + (unit === 'imperial' ? ' ft²' : ' m²');
}
function categoryLabel(value: string): string {
  return value.replace('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
}
function floorName(level: number): string {
  return level === 0 ? 'Ground' : level === 1 ? 'First' : level === 2 ? 'Second' : 'Floor ' + level;
}
function catalogIcon(definition: SpaceDefinition): React.ReactNode {
  if (definition.group === 'private') return <BedDouble size={18} />;
  if (definition.group === 'baths') return <Bath size={18} />;
  if (definition.group === 'living') return <Sofa size={18} />;
  if (definition.group === 'service') return <CookingPot size={18} />;
  if (definition.group === 'vehicle') return <CarFront size={18} />;
  if (definition.group === 'circulation') return <Layers3 size={18} />;
  if (definition.group === 'learning') return <GraduationCap size={18} />;
  if (definition.group === 'work') return <BriefcaseBusiness size={18} />;
  return <DoorOpen size={18} />;
}

export const ProgramWorkspace: React.FC<ProgramWorkspaceProps> = ({ projectId, onBackToSite, onBackToProjects, onOpenFootprint }) => {
  const initial = useMemo(() => projectStorage.load(projectId), [projectId]);
  const initialProgram = initial?.spaceProgram ?? (initial ? createEmptySpaceProgram(initial.category ?? 'residential') : null);
  const [envelope, setEnvelope] = useState<ProjectEnvelope | null>(initial);
  const [program, setProgram] = useState<SpaceProgram | null>(initialProgram);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<SpaceFunctionalGroup | undefined>();
  const [saved, setSaved] = useState(true);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customMin, setCustomMin] = useState('10');
  const [customPreferred, setCustomPreferred] = useState('14');
  const [customGroup, setCustomGroup] = useState<SpaceFunctionalGroup>('special');
  const idCounter = useRef(0);

  if (!envelope || !program) {
    return <main className="program-missing"><h1>Project unavailable</h1><button className="btn-primary" onClick={onBackToProjects}>Back to projects</button></main>;
  }

  const category = envelope.category ?? 'residential';
  const unit = envelope.building.site.unitSystem ?? 'metric';
  const unitLabel = unit === 'imperial' ? 'ft²' : 'm²';
  const floorCount = envelope.building.site.plannedFloorCount ?? Math.max(1, envelope.building.floors.length);
  const catalog = searchSpaceCatalog(category, search, group);
  const groups = [...new Set(getSpaceCatalog(category).map(item => item.group))];
  const presets = getSpaceProgramPresets(category);
  const validation = validateSpaceProgram(program, floorCount);
  const readiness = getGenerationReadiness(program);
  const capacity = calculateProgramCapacity(envelope.building, program);
  const totalInstances = program.items.reduce((sum, item) => sum + item.quantity, 0);
  const priorityCounts = PRIORITIES.reduce<Record<SpacePriority, number>>((result, priority) => {
    result[priority] = program.items.filter(item => item.priority === priority).reduce((sum, item) => sum + item.quantity, 0);
    return result;
  }, { required: 0, preferred: 0, optional: 0 });
  const utilization = Math.max(0, Math.min(100, Math.round((capacity.utilizationRatio ?? 0) * 100)));

  const changeProgram = (next: SpaceProgram) => { setProgram(next); setSaved(false); };
  const persist = (value = program) => {
    const nextEnvelope: ProjectEnvelope = {
      ...envelope, schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION, spaceProgram: value,
      generationSession: null,
      updatedAt: new Date().toISOString(),
    };
    projectStorage.save(nextEnvelope);
    setEnvelope(nextEnvelope);
    setSaved(true);
  };
  const nextId = (prefix: string) => {
    idCounter.current += 1;
    return 'space_' + prefix + '_' + Date.now() + '_' + idCounter.current;
  };
  const addDefinition = (definition: SpaceDefinition) => {
    const existing = program.items.find(item => item.definitionId === definition.id && !item.isCustom);
    changeProgram(existing
      ? updateProgramItem(program, existing.id, { quantity: existing.quantity + 1 })
      : addProgramItem(program, createProgramItem(definition, nextId(definition.id), { quantity: 1 })));
  };
  const changeQuantity = (item: SpaceProgramItem, delta: number) => {
    if (item.quantity + delta < 1) return;
    changeProgram(updateProgramItem(program, item.id, { quantity: item.quantity + delta }));
  };
  const applyPreset = (presetId: string) => {
    const preset = presets.find(candidate => candidate.id === presetId);
    if (!preset) return;
    changeProgram(applySpaceProgramPreset(preset, (definitionId, index) => nextId(definitionId + '_' + index)));
  };
  const addCustom = () => {
    const name = customName.trim();
    const minimum = parseArea(customMin, unit);
    const preferred = parseArea(customPreferred, unit);
    if (!name || minimum <= 0 || preferred < minimum) return;
    changeProgram(addProgramItem(program, createCustomProgramItem(nextId('custom'), name, minimum, preferred, 'preferred', customGroup)));
    setCustomName('');
    setCustomOpen(false);
  };
  const updateFloor = (item: SpaceProgramItem, raw: string) => {
    const floorPreference: SpaceFloorPreference = raw.startsWith('specific:')
      ? { kind: 'specific', specificFloor: Number(raw.split(':')[1]) }
      : { kind: raw as SpaceFloorPreference['kind'] };
    changeProgram(updateProgramItem(program, item.id, { floorPreference }));
  };
  const navigate = (action: () => void) => { if (!saved) persist(); action(); };

  return (
    <div className="program-workspace">
      <header className="program-header">
        <button className="btn-icon" onClick={() => navigate(onBackToProjects)} aria-label="Back to projects"><ArrowLeft size={17} /></button>
        <div className="program-brand"><Layers3 size={18} /><div><strong>FORMA</strong><small>SPACE PROGRAM</small></div></div>
        <nav className="program-stage-nav" aria-label="Project workflow">
          {['PROJECT', 'SITE', 'REQUIREMENTS', 'BUDGET', 'GENERATE'].map((stage, index) => <React.Fragment key={stage}><button className={stage === 'REQUIREMENTS' ? 'active' : index > 3 ? 'future' : ''} onClick={stage === 'SITE' ? () => navigate(onBackToSite) : stage === 'BUDGET' ? () => navigate(onOpenFootprint) : undefined} disabled={!['SITE', 'REQUIREMENTS', 'BUDGET'].includes(stage)}>{stage}</button>{index < 4 && <ChevronRight size={13} />}</React.Fragment>)}
        </nav>
        <span className="program-save-state">{saved ? 'Saved locally' : 'Unsaved changes'}</span>
      </header>

      <main className="program-main">
        <section className="program-title">
          <div><span className="eyebrow">Project / Program</span><h1>{envelope.name}</h1><p>Define intent before geometry. Every area is a planning requirement, not an actual built area.</p></div>
          <div className="program-title-actions"><button className="btn-secondary" onClick={() => navigate(onBackToSite)}>Back to Site</button><button className="btn-primary" onClick={() => persist()} disabled={saved || validation.status === 'INVALID'}>Save program</button></div>
        </section>
        {program.provenance === 'DERIVED_FROM_EXISTING_DESIGN' && <div className="program-provenance"><CircleAlert size={16} /><span><strong>Program derived from existing design.</strong> Review these interpreted room counts before using them for future generation.</span></div>}

        <div className="program-layout">
          <aside className="catalog-panel">
            <div className="program-panel-header"><div><span className="eyebrow">{categoryLabel(category)}</span><h2>Space catalog</h2></div><span>{catalog.length}</span></div>
            {presets.length > 0 && <section className="program-presets"><span>Starter presets</span><div>{presets.map(preset => <button key={preset.id} onClick={() => applyPreset(preset.id)}>{preset.name}</button>)}</div><small>Presets populate requirements only—never layouts.</small></section>}
            <div className="catalog-search"><Search size={14} /><input aria-label="Search spaces" placeholder="Search spaces..." value={search} onChange={event => setSearch(event.target.value)} /></div>
            <div className="catalog-groups"><button className={!group ? 'active' : ''} onClick={() => setGroup(undefined)}>All</button>{groups.map(value => <button key={value} className={group === value ? 'active' : ''} onClick={() => setGroup(value)}>{GROUP_LABELS[value] ?? value}</button>)}</div>
            <div className="catalog-list">
              {catalog.map(definition => {
                const quantity = program.items.find(item => item.definitionId === definition.id)?.quantity ?? 0;
                return <article className="catalog-item" key={definition.id}><span className="catalog-icon">{catalogIcon(definition)}</span><div className="catalog-copy"><strong>{definition.displayName}</strong><small>Preferred {areaText(definition.preferredAreaMm2, unit)}</small><em className={definition.generatorSupport === 'supported' ? 'supported' : ''}>{definition.generatorSupport === 'supported' ? 'Generator supported' : 'Program only'}</em></div><div className="catalog-stepper">{quantity > 0 && <button aria-label={'Decrease ' + definition.displayName} onClick={() => { const item = program.items.find(candidate => candidate.definitionId === definition.id); if (item) changeQuantity(item, -1); }}><Minus size={12} /></button>}<span>{quantity || ''}</span><button aria-label={'Add ' + definition.displayName} onClick={() => addDefinition(definition)}><Plus size={13} /></button></div></article>;
              })}
              {catalog.length === 0 && <div className="catalog-empty">No spaces match this search.</div>}
            </div>
            <section className="custom-space">
              <button className="custom-space-toggle" onClick={() => setCustomOpen(value => !value)}><Plus size={14} /> Custom space</button>
              {customOpen && <div className="custom-space-form"><label>Name<input aria-label="Custom space name" value={customName} onChange={event => setCustomName(event.target.value)} placeholder="e.g. Music Room" /></label><div><label>Minimum ({unitLabel})<input aria-label="Custom minimum area" type="number" min="0" value={customMin} onChange={event => setCustomMin(event.target.value)} /></label><label>Preferred ({unitLabel})<input aria-label="Custom preferred area" type="number" min="0" value={customPreferred} onChange={event => setCustomPreferred(event.target.value)} /></label></div><label>Functional group<select aria-label="Custom functional group" value={customGroup} onChange={event => setCustomGroup(event.target.value as SpaceFunctionalGroup)}>{Object.entries(GROUP_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="btn-primary" onClick={addCustom}>Add custom requirement</button></div>}
            </section>
          </aside>

          <section className="my-program-panel">
            <div className="program-panel-header"><div><span className="eyebrow">Structured brief</span><h2>My program</h2></div><span>{program.items.length} types / {totalInstances} spaces</span></div>
            {program.items.length === 0 ? <div className="program-empty"><Layers3 size={25} /><h3>No spaces defined</h3><p>Choose a preset or add spaces from the catalog. Nothing will be generated until this brief is reviewed.</p></div> : <div className="program-items">
              {program.items.map(item => <article className="program-item" key={item.id}>
                <header><div><span className="program-item-icon">{item.isCustom ? <Shapes size={16} /> : catalogIcon(getSpaceCatalog(category).find(definition => definition.id === item.definitionId) ?? ({ group: item.group } as SpaceDefinition))}</span><div><strong>{item.name}</strong><small>{GROUP_LABELS[item.group] ?? item.group} · {item.generatorSupport === 'supported' ? 'Generator supported' : 'Program only'}</small></div></div><button aria-label={'Remove ' + item.name} onClick={() => changeProgram(removeProgramItem(program, item.id))}><Trash2 size={14} /></button></header>
                <div className="program-item-grid">
                  <label>Maximum ({unitLabel})<input aria-label={item.name + ' maximum area'} type="number" min="0" step=".1" value={item.maximumAreaMm2 === undefined ? '' : displayArea(item.maximumAreaMm2, unit)} onChange={event => changeProgram(updateProgramItem(program, item.id, { maximumAreaMm2: event.target.value === '' ? undefined : parseArea(event.target.value, unit) }))} /></label>
                  {item.canonicalType === 'bathroom' && <label>Attached bedroom<select aria-label={item.name + ' attached bedroom'} value={item.attachedToRoomId ?? ''} onChange={event => changeProgram(updateProgramItem(program, item.id, { attachedToRoomId: event.target.value || undefined }))}><option value="">Common / no owner</option>{program.items.filter(owner => owner.canonicalType === 'bedroom').map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>}
                  <label>Quantity<div className="program-quantity"><button aria-label={'Decrease program ' + item.name} onClick={() => changeQuantity(item, -1)}><Minus size={12} /></button><strong>{item.quantity}</strong><button aria-label={'Increase program ' + item.name} onClick={() => changeQuantity(item, 1)}><Plus size={12} /></button></div></label>
                  <label>Priority<select aria-label={item.name + ' priority'} value={item.priority} onChange={event => changeProgram(updateProgramItem(program, item.id, { priority: event.target.value as SpacePriority }))}>{PRIORITIES.map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>
                  <label>Minimum ({unitLabel})<input aria-label={item.name + ' minimum area'} type="number" min="0" step=".1" value={displayArea(item.minimumAreaMm2, unit)} onChange={event => changeProgram(updateProgramItem(program, item.id, { minimumAreaMm2: parseArea(event.target.value, unit) }))} /></label>
                  <label>Preferred ({unitLabel})<input aria-label={item.name + ' preferred area'} type="number" min="0" step=".1" value={displayArea(item.preferredAreaMm2, unit)} onChange={event => changeProgram(updateProgramItem(program, item.id, { preferredAreaMm2: parseArea(event.target.value, unit) }))} /></label>
                  <label>Floor preference<select aria-label={item.name + ' floor preference'} value={item.floorPreference.kind === 'specific' ? 'specific:' + item.floorPreference.specificFloor : item.floorPreference.kind} onChange={event => updateFloor(item, event.target.value)}><option value="any">ANY FLOOR</option><option value="ground_preferred">GROUND PREFERRED</option><option value="upper_preferred">UPPER FLOOR PREFERRED</option><option value="top_preferred">TOP FLOOR PREFERRED</option><option value="ground_required">GROUND REQUIRED</option>{Array.from({ length: floorCount }, (_, level) => <option key={level} value={'specific:' + level}>SPECIFIC · {floorName(level).toUpperCase()}</option>)}</select></label>
                  <label className="program-notes">Notes<input aria-label={item.name + ' notes'} value={item.notes ?? ''} onChange={event => changeProgram(updateProgramItem(program, item.id, { notes: event.target.value }))} placeholder="Optional requirements" /></label>
                </div>
              </article>)}
            </div>}
          </section>

          <aside className="program-summary-panel">
            <section><span className="eyebrow">Program validity</span><div className={'program-state state-' + validation.status.toLowerCase()}>{validation.status === 'VALID' ? <CheckCircle2 size={17} /> : <TriangleAlert size={17} />}<div><strong>{validation.status}</strong><small>{validation.issues.length ? validation.issues[0]?.message : 'All program entries are structurally valid.'}</small></div></div></section>
            <section><span className="eyebrow">Generation readiness</span><div className={'generation-state state-' + readiness.toLowerCase()}><strong>{readiness.replace('_', ' ')}</strong><small>{readiness === 'FULLY_SUPPORTED' ? 'Current residential planner can consume these standard spaces.' : category === 'residential' ? 'Program can be saved; unsupported spaces must be resolved before automatic generation.' : 'PROGRAM SUPPORTED · AUTOMATIC GENERATION NOT YET CONFIGURED'}</small></div></section>
            <section><h2>Program summary</h2><dl className="program-summary-list"><div><dt>Category</dt><dd>{categoryLabel(category)}</dd></div><div><dt>Space instances</dt><dd>{totalInstances}</dd></div><div><dt>Required</dt><dd>{priorityCounts.required}</dd></div><div><dt>Preferred</dt><dd>{priorityCounts.preferred}</dd></div><div><dt>Optional</dt><dd>{priorityCounts.optional}</dd></div><div><dt>Minimum area</dt><dd>{areaText(capacity.minimumProgramAreaMm2, unit)}</dd></div><div><dt>Preferred area</dt><dd>{areaText(capacity.preferredProgramAreaMm2, unit)}</dd></div></dl></section>
            <section><div className="capacity-heading"><div><span className="eyebrow">Preliminary capacity</span><h2>{capacity.state}</h2></div><Building2 size={18} /></div><div className="capacity-bar" role="progressbar" aria-label="Program utilization" aria-valuemin={0} aria-valuemax={100} aria-valuenow={utilization}><span style={{ width: utilization + '%' }} /></div><p className="capacity-caption">{utilization}% of estimated usable geometric capacity. Denominator includes a documented {Math.round(RESERVE_RATIO * 100)}% preliminary reserve.</p><dl className="program-summary-list"><div><dt>Envelope / floor</dt><dd>{areaText(capacity.buildableEnvelopePerFloorMm2, unit)}</dd></div><div><dt>Planned levels</dt><dd>{capacity.plannedFloorCount}</dd></div><div><dt>Geometric capacity</dt><dd>{areaText(capacity.geometricCapacityMm2, unit)}</dd></div>{capacity.fsiLimitedCapacityMm2 !== undefined && <div><dt>FSI-limited potential</dt><dd>{areaText(capacity.fsiLimitedCapacityMm2, unit)}</dd></div>}<div><dt>Estimated usable</dt><dd>{areaText(capacity.estimatedUsableCapacityMm2, unit)}</dd></div>{capacity.deficitMm2 !== undefined && <div className="capacity-deficit"><dt>Deficit</dt><dd>{areaText(capacity.deficitMm2, unit)}</dd></div>}</dl>{capacity.state === 'INFEASIBLE' && <div className="capacity-advice"><strong>Program infeasible</strong><p>Reduce areas or optional rooms, increase planned levels, or return to Site to review the envelope. Requirements will not be changed automatically.</p></div>}<details><summary>Calculation assumptions</summary>{capacity.assumptions.map(assumption => <p key={assumption}>{assumption}</p>)}</details></section>
            <section><h2>Floor distribution intent</h2><div className="floor-pressure-list">{capacity.floorPressures.map(floor => <article key={floor.floorLevel} className={'pressure-' + floor.status.toLowerCase()}><header><strong>{floorName(floor.floorLevel)}</strong><span>{floor.status.replace('_', ' ')}</span></header><p>{floor.itemNames.length ? floor.itemNames.join(', ') : 'No fixed preference'}</p><small>{areaText(floor.preferredDemandMm2, unit)} preferred / {areaText(floor.availableAreaMm2, unit)} estimated</small></article>)}</div>{program.items.some(item => item.floorPreference.kind === 'any') && <p className="unresolved-floor">ANY FLOOR · {program.items.filter(item => item.floorPreference.kind === 'any').map(item => item.name).join(', ')}</p>}</section>
            <section className="program-regulatory"><CircleAlert size={16} /><div><strong>NOT CODE APPROVAL</strong><p>Capacity is a preliminary geometry calculation using user-provided Site inputs.</p></div></section>
            <button className="program-footprint-action" disabled={validation.status === 'INVALID'} onClick={() => navigate(onOpenFootprint)}><span><strong>Review Building Budget</strong><small>Choose the building size independently of the site</small></span><ChevronRight size={16} /></button>
          </aside>
        </div>
      </main>
    </div>
  );
};

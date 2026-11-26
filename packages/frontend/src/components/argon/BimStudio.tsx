import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  EXCHANGE_MAX_BYTES, exchangeArtifactDigest, exchangeRevision, type IfcExchangeManifest,
} from '@ai-floor-planner/core';
import { projectBuildingTo3D, type ProjectionSource } from '@ai-floor-planner/projection-3d';
import type { EditorContextValue } from '../../stores/editor-store';
import { calculateBimSchedule, scheduleCsv, type BimKind, type BimQuantityRow } from '../../services/bim-quantities';
import { DEFAULT_MODEL_VIEW_PREFERENCES, projectionSourceToSelection } from '../../services/projection-preferences';
import { alignedPlanPrism, type IfcReferenceModel } from '../../services/ifc-reference';
import {
  loadProjectBimFederation,
  saveProjectBimFederation,
  type PersistedLinkedReference,
} from '../../services/ifc-reference-store';
import { runWorkerTask } from '../../services/worker-task';
import type { BimClash, ClashResolutionStatus, findBimClashes } from '../../services/bim-clash';
import { queryBimSchedule, type BimQueryResponse } from '../../services/bim-query';
import { ThreeBuildingScene } from '../model-3d/ThreeBuildingScene';
import './bim-studio.css';

const categories: Array<[BimKind | 'all', string]> = [
  ['all', 'All elements'], ['room', 'Rooms'], ['flat', 'Flats'], ['wall', 'Walls'], ['door', 'Doors'], ['window', 'Windows'],
  ['slab', 'Slabs'], ['stair', 'Stairs'],
];
const m2 = (area?: number) => area === undefined ? 'Unavailable' : (area / 1e6).toFixed(3) + ' m²';

function download(content: BlobPart, mime: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BimStudio({ editor, onOpenCad }: { editor: EditorContextValue; onOpenCad: () => void }) {
  const { building, activeFloor, selection, switchFloor, selectEntity, clearSelection } = editor;
  const [filter, setFilter] = useState<BimKind | 'all'>('all');
  const [search, setSearch] = useState('');
  const [showModel, setShowModel] = useState(false);
  const [isolate, setIsolate] = useState(true);
  const [section, setSection] = useState(false);
  const [explode, setExplode] = useState(false);
  const [localRow, setLocalRow] = useState<BimQuantityRow>();
  const [manifest, setManifest] = useState<IfcExchangeManifest>();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'import' | 'export' | 'clash'>();
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] = useState<BimQueryResponse>();
  const [references, setReferences] = useState<PersistedLinkedReference[]>([]);
  const [activeReference, setActiveReference] = useState('');
  const [discipline, setDiscipline] = useState('Unclassified');
  const [alignment, setAlignment] = useState({ x: '0', y: '0', z: '0', angle: '0' });
  const [showReference, setShowReference] = useState(true);
  const [tolerance, setTolerance] = useState('0.5');
  const [minClearance, setMinClearance] = useState('0');
  const [includeSlabsAndStructure, setIncludeSlabsAndStructure] = useState(false);
  const [clashResolutions, setClashResolutions] = useState<Record<string, ClashResolutionStatus>>({});
  const [federationLoadedForProject, setFederationLoadedForProject] = useState('');
  const [clashes, setClashes] = useState<ReturnType<typeof findBimClashes>>();
  const previousBuildingRef = useRef(building);
  const operation = useRef<AbortController>();
  const projection = useMemo(() => projectBuildingTo3D(building), [building]);
  const source = useMemo(() => exchangeRevision(building), [building]);
  const wallProjection = useMemo(() => projection.walls.filter(wall => wall.floorId === activeFloor.id), [projection, activeFloor.id]);
  const schedule = useMemo(() => calculateBimSchedule(activeFloor, wallProjection,
    projection.floorPlates.find(plate => plate.floorId === activeFloor.id)), [activeFloor, projection, wallProjection]);
  const selected = schedule.rows.find(row => row.id === selection?.entityId && row.kind === selection.entityType)
    ?? (localRow && schedule.rows.find(row => row.id === localRow.id && row.kind === localRow.kind));
  const selectedMapping = selected && manifest?.elements.find(item => item.floorId === activeFloor.id && item.canonicalId === selected?.id && item.kind === selected.kind);
  const reference = references.find(item => item.model.sha256 === activeReference);
  const elevation = projection.levels.find(level => level.floorId === activeFloor.id)?.elevation ?? 0;
  const filtered = schedule.rows.filter(row => (filter === 'all' || filter === row.kind) &&
    (row.name + ' ' + row.id + ' ' + (row.material ?? '')).toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => { setManifest(undefined); }, [source.sha256]);
  useEffect(() => {
    setClashes(undefined);
    setQueryResult(undefined);
    return () => { operation.current?.abort(); };
  }, [source.sha256, activeFloor.id]);
  useEffect(() => {
    let cancelled = false;
    setReferences([]);
    setActiveReference('');
    setClashResolutions({});
    setFederationLoadedForProject('');
    void loadProjectBimFederation(building.projectId).then(persisted => {
      if (cancelled) return;
      if (persisted && persisted.projectId === building.projectId) {
        setReferences([...persisted.references]);
        setActiveReference(persisted.activeReferenceSha256 || persisted.references[0]?.model.sha256 || '');
        setClashResolutions({ ...persisted.clashResolutions });
      }
      setFederationLoadedForProject(building.projectId);
    });
    return () => {
      cancelled = true;
    };
  }, [building.projectId]);

  useEffect(() => {
    if (federationLoadedForProject !== building.projectId) return;
    void saveProjectBimFederation({
      projectId: building.projectId,
      activeReferenceSha256: activeReference,
      references,
      clashResolutions,
      updatedAt: new Date().toISOString(),
    });
  }, [building.projectId, federationLoadedForProject, activeReference, references, clashResolutions]);

  useEffect(() => {
    setClashes(undefined);
    if (busy === 'clash') operation.current?.abort();
  }, [activeReference, references, tolerance, minClearance, includeSlabsAndStructure]);

  function pick(row: BimQuantityRow) {
    setLocalRow(undefined);
    if (row.kind === 'flat' || row.kind === 'slab') { clearSelection(); setLocalRow(row); }
    else selectEntity(row.kind, row.id, activeFloor.id);
  }

  function pickProjection(value: ProjectionSource) {
    const item = projectionSourceToSelection(value);
    if (item) {
      if (item.floorId && item.floorId !== activeFloor.id) switchFloor(item.floorId);
      setLocalRow(undefined);
      selectEntity(item.entityType, item.entityId, item.floorId);
    }
  }

  async function exportIfc() {
    const controller = new AbortController();
    operation.current = controller;
    setBusy('export'); setError(''); setNotice('');
    try {
      const response = await fetch('/api/v1/export/ifc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ building, source }), signal: controller.signal,
      });
      const data = await response.json() as { manifest: IfcExchangeManifest; contentBase64: string; error?: { message: string } };
      if (!response.ok) throw new Error(data.error?.message ?? 'IFC export failed.');
      const actual = data.manifest;
      const current = exchangeRevision(editor.engine.getBuilding());
      if (controller.signal.aborted) return;
      if (actual.format !== 'IFC4' || actual.source.sha256 !== source.sha256 || actual.source.sha256 !== current.sha256 ||
        actual.source.buildingId !== source.buildingId || actual.source.projectId !== source.projectId ||
        actual.source.revision !== source.revision || actual.verification !== 'SOFTWARE_READBACK') throw new Error('Stale IFC response.');
      const bytes = Uint8Array.from(atob(data.contentBase64), c => c.charCodeAt(0));
      if (!bytes.length || bytes.length > EXCHANGE_MAX_BYTES || exchangeArtifactDigest(bytes) !== actual.artifactSha256)
        throw new Error('IFC artifact checksum mismatch.');
      download(bytes, 'application/x-step', 'rh-planner-r' + source.revision + '.ifc');
      setManifest(actual);
      setNotice('IFC4 exported with ' + actual.elements.length + ' mapped entities and ' + actual.omissions.length + ' declared omissions.');
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'IFC export failed.'); }
    finally { if (operation.current === controller) setBusy(undefined); }
  }

  async function importReference(file: File | undefined) {
    if (!file) return;
    setError(''); setNotice('');
    if (!/\.ifc$/i.test(file.name) || !file.size || file.size > EXCHANGE_MAX_BYTES) {
      setError('Choose an uncompressed IFC file of up to 25 MiB.'); return;
    }
    if (references.length >= 4) { setError('Remove a reference before importing another model.'); return; }
    const controller = new AbortController();
    operation.current = controller;
    setBusy('import');
    try {
      const bytes = await file.arrayBuffer();
      const model = await runWorkerTask<IfcReferenceModel>({
        start: () => new Worker(new URL('../../services/ifc-reference.worker.ts', import.meta.url), { type: 'module' }),
        input: { job: 'inspect', bytes }, transfer: [bytes], signal: controller.signal, label: 'IFC reference import', timeoutMs: 30_000,
        receive: data => {
          if (!data || typeof data !== 'object') throw new Error('Invalid IFC worker response.');
          const message = data as { model?: IfcReferenceModel; error?: string };
          if (message.error) throw new Error(message.error);
          if (!message.model || message.model.schema !== 'IFC4' || !Array.isArray(message.model.elements))
            throw new Error('Invalid IFC worker model.');
          return message.model;
        },
      });
      if (controller.signal.aborted) return;
      if (references.some(item => item.model.sha256 === model.sha256)) throw new Error('This reference is already open.');
      setReferences(items => [...items, { model, fileName: file.name, discipline }]);
      setActiveReference(model.sha256);
      setNotice('Reference inspected. Apply the measured alignment to display it.');
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Reference import failed.'); }
    finally { if (operation.current === controller) setBusy(undefined); }
  }

  function applyAlignment(event: FormEvent) {
    event.preventDefault();
    if (!reference) return;
    const entries = Object.values(alignment);
    const [x, y, z, angle] = entries.map(Number);
    if (entries.some(value => !value.trim()) || [x, y, z, angle].some(value => !Number.isFinite(value) || Math.abs(value!) > 1e7)) {
      setError('Enter finite model alignment offsets and rotation.'); return;
    }
    setReferences(items => items.map(item => item === reference ? {
      ...item, alignment: { x: x!, y: y!, z: z!, angle: angle! * Math.PI / 180 },
    } : item));
    setError('');
  }

  function selectClash(clash: BimClash) {
    setFilter(clash.elementKind === 'column' || clash.elementKind === 'beam' ? 'all' : clash.elementKind);
    setSearch(clash.elementId);
    if (clash.elementKind !== 'slab') {
      selectEntity(clash.elementKind, clash.elementId, clash.floorId);
    }
  }

  function setClashStatus(clash: BimClash, nextStatus: ClashResolutionStatus) {
    const key = `${source.sha256}::${clash.id}`;
    setClashResolutions(prev => ({ ...prev, [key]: nextStatus }));
    setClashes(prev =>
      prev
        ? {
            ...prev,
            results: prev.results.map(item => (item.id === clash.id ? { ...item, status: nextStatus } : item)),
          }
        : prev,
    );
  }

  const profiles = useMemo(() => reference?.model.elements.flatMap(entity => entity.prisms) ?? [], [reference]);
  const floorPlate = useMemo(
    () => projection.floorPlates.find(plate => plate.floorId === activeFloor.id),
    [projection.floorPlates, activeFloor.id],
  );
  async function checkClashes() {
    if (!reference?.alignment) return;
    const controller = new AbortController();
    operation.current = controller;
    setError(''); setNotice(''); setBusy('clash'); setClashes(undefined);
    try {
      const result = await runWorkerTask<ReturnType<typeof findBimClashes>>({
        start: () => new Worker(new URL('../../services/ifc-reference.worker.ts', import.meta.url), { type: 'module' }),
        input: {
          job: 'clash',
          input: {
            floor: activeFloor,
            walls: wallProjection,
            plate: floorPlate,
            reference: profiles,
            alignment: reference.alignment,
            referenceSha256: reference.model.sha256,
            revisionSha256: source.sha256,
            toleranceMm: Number(tolerance),
            minClearanceMm: Number(minClearance) || 0,
            includeSlabsAndStructure,
            resolutions: clashResolutions,
          },
        },
        signal: controller.signal, label: 'IFC clash check', timeoutMs: 30_000,
        receive: data => {
          if (!data || typeof data !== 'object') throw new Error('Invalid IFC worker response.');
          const message = data as { clashes?: ReturnType<typeof findBimClashes>; error?: string };
          if (message.error) throw new Error(message.error);
          if (!message.clashes || !Array.isArray(message.clashes.results)) throw new Error('Invalid IFC clash response.');
          return message.clashes;
        },
      });
      if (!controller.signal.aborted) setClashes(result);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Clash check failed.'); }
    finally { if (operation.current === controller) setBusy(undefined); }
  }

  const activePrisms = showReference && reference?.alignment ? profiles
    .map(prism => alignedPlanPrism(prism, reference.alignment!))
    .filter(prism => prism.bottomMm <= elevation + activeFloor.floorHeight && prism.topMm >= elevation) : [];
  const boundary = activeFloor.boundary.points;
  const xs = boundary.map(point => point.x), ys = boundary.map(point => point.y);
  const box = boundary.length >= 3 && [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];

  return <section className="rh-bim" aria-label="RH Planner — BIM Studio">
    <header className="rh-bim-header">
      <div><h1>RH Planner — BIM Studio</h1><p>Canonical revision {source.revision} · {source.sha256.slice(0, 12)} · IFC4</p></div>
      <div className="rh-bim-controls">
        <button type="button" onClick={onOpenCad}>Precision CAD</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void exportIfc()}>Export IFC4</button>
        {manifest && <button type="button" onClick={() => download(JSON.stringify(manifest, null, 2), 'application/json', 'rh-planner-ifc-manifest.json')}>Download manifest</button>}
        {busy && <button type="button" onClick={() => { operation.current?.abort(); setBusy(undefined); setNotice('Operation cancelled.'); }}>Cancel {busy}</button>}
      </div>
    </header>
    {(notice || busy) && <p role="status">{busy ? (busy === 'import' ? 'Inspecting IFC reference…' : busy === 'clash' ? 'Checking wall intersections…' : 'Authoring IFC4…') : notice}</p>}
    {error && <p role="alert">{error}</p>}
    {manifest && <details><summary>Export coverage</summary><ul>{Object.entries(manifest.omissions.reduce<Record<string, number>>((counts, item) => {
      counts[item.reason] = (counts[item.reason] ?? 0) + 1; return counts;
    }, {})).map(([reason, count]) => <li key={reason}>{count} · {reason}</li>)}</ul></details>}
    {!building.floors.length ? <p>Open an accepted building to inspect BIM quantities.</p> : <>
      <div className="rh-bim-controls">
        <label>Storey <select aria-label="BIM storey" value={activeFloor.id} onChange={event => { switchFloor(event.target.value); setLocalRow(undefined); }}>
          {projection.levels.map(level => <option key={level.floorId} value={level.floorId}>{level.floorName} · {level.datumLabel}</option>)}
        </select></label>
        <button type="button" aria-pressed={showModel} onClick={() => setShowModel(value => !value)}>{showModel ? 'Hide 3D model' : 'Show 3D model'}</button>
        {showModel && <>
          <button type="button" aria-pressed={isolate} onClick={() => setIsolate(value => !value)}>Isolate storey</button>
          <button type="button" aria-pressed={section} onClick={() => setSection(value => !value)}>Section</button>
          <button type="button" aria-pressed={explode} onClick={() => { setIsolate(false); setExplode(value => !value); }}>Explode</button>
        </>}
      </div>
      {showModel && <div className="rh-bim-viewport" data-testid="bim-model">
        <ThreeBuildingScene projection={projection} activeFloorId={activeFloor.id} selection={selection}
          viewMode="solid" cameraPreset="isometric" floorMode={isolate ? 'isolate' : 'all'} exploded={explode}
          sectionCut={section} layers={DEFAULT_MODEL_VIEW_PREFERENCES.layers} fitRequest={0} onSelect={pickProjection} onClearSelection={clearSelection} />
      </div>}
      <dl className="rh-bim-totals" aria-label="Floor quantities">
        <div><dt>Gross footprint</dt><dd>{m2(schedule.grossAreaMm2)}</dd></div>
        <div><dt>Modeled unit carpet</dt><dd>{m2(schedule.modeledCarpetMm2)}</dd></div>
        <div><dt>Built slab footprint</dt><dd>{m2(schedule.slabAreaMm2)}</dd></div>
        <div><dt>Balconies</dt><dd>{m2(schedule.balconyMm2)}</dd></div>
        <div><dt>Common circulation</dt><dd>{m2(schedule.commonMm2)}</dd></div>
      </dl>
      <div className="rh-bim-grid">
        <section className="rh-bim-card" aria-label="Element schedules">
          <h2>Element schedules</h2>
          <div className="rh-bim-controls">
            <label>Schedule <select aria-label="BIM schedule" value={filter} onChange={event => setFilter(event.target.value as BimKind | 'all')}>
              {categories.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            <label>Find element <input value={search} onChange={event => setSearch(event.target.value)} /></label>
            <button type="button" disabled={!filtered.length} onClick={() => download(scheduleCsv(filtered), 'text/csv', 'rh-planner-bim-schedule.csv')}>Download CSV</button>
          </div>
          <div className="rh-bim-scroll"><table><thead><tr><th scope="col">Name</th><th scope="col">Class</th><th scope="col">Area</th></tr></thead>
            <tbody>{filtered.map(row => <tr key={row.kind + row.id}>
              <td><button type="button" aria-pressed={selected?.id === row.id && selected.kind === row.kind} onClick={() => pick(row)}>{row.name}</button></td>
              <td>{row.ifcClass ?? row.kind}</td><td>{m2(row.modeledAreaMm2 ?? row.areaMm2)}</td>
            </tr>)}</tbody></table>{!filtered.length && <p>No matching elements.</p>}</div>
        </section>
        <section className="rh-bim-card" aria-label="BIM property inspector">
          <h2>Properties</h2>
          {selected ? <dl className="rh-bim-properties">
            <dt>Canonical ID</dt><dd>{selected.id}</dd>
            <dt>Class</dt><dd>{selected.ifcClass ?? selected.kind}</dd>
            {selectedMapping && <><dt>IFC GlobalId</dt><dd>{selectedMapping.externalId}</dd></>}
            {selected.hostWallId && <><dt>Host wall</dt><dd>{selected.hostWallId}</dd></>}
            {selected.material && <><dt>Material</dt><dd>{selected.material}</dd></>}
            <dt>Geometric area</dt><dd>{m2(selected.areaMm2)}</dd>
            {selected.modeledAreaMm2 !== undefined && <><dt>Modeled usable area</dt><dd>{m2(selected.modeledAreaMm2)}</dd></>}
            {selected.lengthMm !== undefined && <><dt>Length</dt><dd>{selected.lengthMm.toFixed(1)} mm</dd></>}
            {selected.widthMm !== undefined && <><dt>Width / thickness</dt><dd>{selected.widthMm} mm</dd></>}
            {selected.heightMm !== undefined && <><dt>Height / depth</dt><dd>{selected.heightMm} mm</dd></>}
            {selected.volumeMm3 !== undefined && <><dt>Element volume</dt><dd>{(selected.volumeMm3 / 1e9).toFixed(3)} m³</dd></>}
            {selected.riserCount !== undefined && <><dt>Risers</dt><dd>{selected.riserCount}</dd></>}
          </dl> : <p>Select an element in the model or schedule.</p>}
          <form onSubmit={event => {
            event.preventDefault();
            const res = queryBimSchedule(query, schedule.rows, {
              building,
              previousBuilding: previousBuildingRef.current.version !== building.version ? previousBuildingRef.current : undefined,
              floor: activeFloor,
              clashes: clashes?.results,
              control: editor.generationControl,
            });
            setQueryResult(res);
          }}>
            <label>Model query <input value={query} placeholder="Total window area or Regenerate Flat 2" onChange={event => setQuery(event.target.value)} /></label>
            <button type="submit">Run query</button>
          </form>
          {queryResult && (
            <div>
              <p role="status">{queryResult.text}</p>
              {queryResult.proposalPreview?.status === 'PREVIEW_READY' && queryResult.proposalPreview.proposedBuilding && (
                <div className="rh-bim-controls" data-testid="bim-assistant-preview">
                  <button
                    type="button"
                    data-testid="bim-accept-proposal-btn"
                    onClick={() => {
                      const prop = queryResult.proposalPreview!;
                      if (!prop.proposedBuilding) return;
                      previousBuildingRef.current = building;
                      editor.applyRefinement(prop.proposedBuilding, prop.message, true, prop.baseRevisionDigest);
                      setQueryResult(undefined);
                      setNotice('Applied canonical BIM/CAD proposal to revision ' + prop.proposedRevision + '.');
                    }}
                  >
                    Accept Preview
                  </button>
                  <button type="button" onClick={() => setQueryResult(undefined)}>Discard Preview</button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
      <section className="rh-bim-card" aria-label="Read-only IFC references">
        <h2>Read-only IFC references</h2>
        <div className="rh-bim-controls">
          <label>Discipline <select value={discipline} onChange={event => setDiscipline(event.target.value)}>
            {['Unclassified', 'Architectural', 'Structural', 'Mechanical', 'Electrical', 'Plumbing', 'Other'].map(item => <option key={item}>{item}</option>)}
          </select></label>
          <label>Import IFC reference <input type="file" accept=".ifc" disabled={Boolean(busy)} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''; void importReference(file);
          }} /></label>
          {reference && <><label>Reference model <select value={activeReference} onChange={event => setActiveReference(event.target.value)}>
            {references.map(item => <option value={item.model.sha256} key={item.model.sha256}>{item.fileName}</option>)}
          </select></label>
          <button type="button" onClick={() => {
            const remaining = references.filter(item => item !== reference);
            setReferences(remaining); setActiveReference(remaining[0]?.model.sha256 ?? '');
          }}>Remove reference</button></>}
        </div>
        {reference && <>
          <p>{reference.model.name || reference.fileName} · {reference.discipline} · {reference.model.unit} · {reference.model.elements.length} elements</p>
          <p>SHA-256 <code>{reference.model.sha256}</code></p>
          <details><summary>Storeys and unsupported bodies</summary>
            <ul>{reference.model.storeys.map(level => <li key={level.globalId}>{level.name} · {level.elevationMm} mm</li>)}</ul>
            <ul>{Object.entries(reference.model.unsupported).map(([kind, count]) => <li key={kind}>{kind} · {count}</li>)}</ul>
          </details>
          <form className="rh-bim-controls" onSubmit={applyAlignment}>
            {(['x', 'y', 'z', 'angle'] as const).map(key => <label key={key}>{key === 'angle' ? 'Rotation (degrees)' : key.toUpperCase() + ' offset (mm)'}
              <input type="number" step="any" required value={alignment[key]} onChange={event => setAlignment({ ...alignment, [key]: event.target.value })} /></label>)}
            <button type="submit">Apply alignment</button>
            <button type="button" aria-pressed={showReference} onClick={() => setShowReference(value => !value)}>Show reference outline</button>
          </form>
          {reference.alignment && <div className="rh-bim-controls">
            <label>Clash tolerance (mm) <input type="number" min="0.01" step="any" value={tolerance} onChange={event => setTolerance(event.target.value)} /></label>
            <label>Min clearance (mm) <input type="number" min="0" max="2000" step="10" value={minClearance} onChange={event => setMinClearance(event.target.value)} /></label>
            <label><input type="checkbox" checked={includeSlabsAndStructure} onChange={event => setIncludeSlabsAndStructure(event.target.checked)} /> Slabs, columns &amp; door zones</label>
            <button type="button" disabled={Boolean(busy)} onClick={() => void checkClashes()}>Check wall clashes</button>
          </div>}
          {box && showReference && reference.alignment && <svg viewBox={box.join(' ')} className="rh-bim-overlay" aria-label="Aligned reference floor outline" role="img">
            <polygon points={boundary.map(p => p.x + ',' + p.y).join(' ')} fill="#f0e5d1" stroke="#856143" vectorEffect="non-scaling-stroke" />
            {activePrisms.map((prism, i) => <polygon key={prism.globalId + i} points={prism.boundary.map(p => p.x + ',' + p.y).join(' ')}
              fill="#a8b7aa" fillOpacity=".55" stroke="#435b4e" vectorEffect="non-scaling-stroke" />)}
            {(clashes?.results ?? []).map(clash => <circle key={clash.id} cx={clash.point.x} cy={clash.point.y} r={Math.max(box[2]!, box[3]!) / 150} fill="#a53f27" />)}
          </svg>}
          {clashes && <div role="region" aria-label="Wall clash results">
            <p>{clashes.results.filter(item => item.kind !== 'CLEARANCE').length} confirmed intersections
              {' · '}{clashes.results.filter(item => item.kind === 'CLEARANCE').length} clearance findings
              {' · '}{clashes.results.filter(item => item.status === 'OPEN').length} open</p>
            <p>{clashes.comparisons} checked pairs · {clashes.coverage.outsideStorey} profiles outside storey
              {' · '}{clashes.coverage.excludedByScope} elements outside check scope
              {' · '}{clashes.coverage.unsupported} unsupported check inputs</p>
            {Object.keys(reference.model.unsupported).length > 0 && <p>Some reference bodies were omitted during import. See storeys and unsupported bodies.</p>}
            <ul>{clashes.results.map(clash => <li key={clash.id} className="rh-bim-controls">
              <button type="button" onClick={() => selectClash(clash)}>
                {clash.kind} · {clash.elementKind}:{clash.ifcClass} · {clash.kind === 'CLEARANCE' ? `${clash.clearanceMm} mm gap` : `${(clash.volumeMm3 / 1e9).toFixed(4)} m³`} · {clash.status}
              </button>
              <select
                aria-label={`Status for clash ${clash.id}`}
                value={clash.status}
                onChange={e => setClashStatus(clash, e.target.value as ClashResolutionStatus)}
              >
                <option value="OPEN">OPEN</option>
                <option value="RESOLVED">RESOLVED</option>
                <option value="IGNORED">IGNORED</option>
              </select>
            </li>)}</ul>
          </div>}
        </>}
      </section>
      <p className="rh-bim-review">Geometric schedules and reference checks · Professional review required</p>
    </>}
  </section>;
}

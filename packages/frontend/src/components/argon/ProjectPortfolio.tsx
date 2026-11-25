import { lazy, Suspense, useMemo, useState } from 'react';
import { ArrowRight, Box, FilePlus2, FileUp, HardDrive, LayoutTemplate, Trash2 } from 'lucide-react';
import type { Building } from '@ai-floor-planner/core';
import { polygonBoundingBox } from '@ai-floor-planner/geometry-engine';
import {
  computeFloorEfficiencyBreakdown,
  type AlternativeExplorationControls,
} from '@ai-floor-planner/planning-engine';
import { fitToView, renderFloor } from '@ai-floor-planner/renderer';
import {
  exportArchivedProjectPayloadAsJsonFile,
  projectStorage,
  type ProjectHeader,
} from '../../services/storage';
import type { ArchivedProjectRevision } from '../../services/durable-project-store';
import type { LocalDiskProjectManifest } from '../../services/local-project-api';

const ConceptModel = lazy(() => import('./ConceptModel'));

export function representativeFloor(building: Building) {
  return building.floors.find(floor => floor.apartmentUnits?.length) ?? building.floors[0];
}

export function PlanThumbnail({ building }: { building: Building }) {
  const floor = representativeFloor(building);
  const src = useMemo(() => {
    if (!floor?.boundary.points.length) return undefined;
    const width = 520;
    const height = 360;
    const transform = fitToView(polygonBoundingBox(floor.boundary), width, height, 22);
    const svg = renderFloor(floor, building, transform, width, height, { showGrid: false, showTitleBlock: false, showDimensions: false });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [building, floor]);
  return src ? <img className="rh-catalog-plan" src={src} alt={`Plan preview of ${floor?.name.replaceAll('_', ' ')}`} /> :
    <div className="rh-catalog-plan rh-catalog-plan-empty">No drawing available</div>;
}

export interface GeneratedConcept {
  readonly building: Building;
  readonly seed: number;
  readonly sourceRevision?: Building;
}

function conceptId(building: Building): string {
  return building.metadata.generationRunId ?? `${building.id}:${building.version}`;
}

function conceptFacts(building: Building) {
  const floor = representativeFloor(building);
  const telemetry = building.metadata.generationBrief?.aiTelemetry;
  const modeLabel = telemetry?.interpretationSource === 'GEMINI'
    ? `Live AI · Gemini (${telemetry.modelUsed ?? 'model unavailable'})${telemetry.fallbackTriggered ? ' · fallback model' : ''}${telemetry.cacheHit ? ' · cached' : ''}`
    : telemetry?.geminiInvoked
      ? `Deterministic fallback · ${telemetry.fallbackReason ?? 'Provider unavailable'}`
      : telemetry?.fallbackReason ?? 'Deterministic rules';
  return [
    ...(telemetry?.interpretationSource ? [{
      name: 'Brief interpretation',
      value: modeLabel,
    }] : []),
    ...(telemetry?.interpretationSource === 'GEMINI' && telemetry.influencedGeometry !== undefined ? [{
      name: 'Geometry provenance',
      value: telemetry.influencedGeometry
        ? 'AI-assisted deterministic geometry (accepted)'
        : 'Deterministic baseline geometry (accepted)',
    }] : []),
    ...(telemetry?.tokenUsage && telemetry.tokenUsage.totalTokens > 0 ? [{
      name: 'AI tokens & latency',
      value: `${telemetry.tokenUsage.totalTokens} tokens · AI ${telemetry.latencyMs ?? 0} ms${telemetry.solverLatencyMs ? ` · Solver ${telemetry.solverLatencyMs} ms` : ''}`,
    }] : telemetry?.solverLatencyMs ? [{
      name: 'Solver latency',
      value: `${telemetry.solverLatencyMs} ms`,
    }] : []),
    ...(telemetry?.conflictsDetected?.length ? [{
      name: 'Brief advisories',
      value: telemetry.conflictsDetected.map(c => c.message).join(' '),
    }] : []),
    { name: 'Levels', value: building.floors.length.toString() },
    { name: 'Units on shown floor', value: floor?.apartmentUnits?.length.toString() ?? '—' },
    { name: 'Room area on shown floor', value: floor ? `${(floor.rooms.reduce((total, room) => total + room.area, 0) / 1_000_000).toFixed(1)} m²` : '—' },
  ];
}

export function ConceptReviewWorkspace({ concepts, activeBuilding, canGenerate, notice, onGenerate, onOpen }: {
  concepts: readonly GeneratedConcept[];
  activeBuilding: Building;
  canGenerate: boolean;
  notice: string;
  onGenerate: (controls?: AlternativeExplorationControls) => void;
  onOpen: (concept: GeneratedConcept) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [preview, setPreview] = useState<'plan' | '3d'>('plan');
  const [controls, setControls] = useState<AlternativeExplorationControls>({
    preserveCore: false,
    preserveExteriorFootprint: false,
    changeInternalLayout: true,
    exploreAlternativeMassing: true,
    optimizeCarpetArea: false,
    improveCirculation: false,
    improveDaylight: false,
  });
  const collection = concepts.length ? concepts : [{ building: activeBuilding, seed: 1 }];
  const selected = collection.find(concept => conceptId(concept.building) === selectedId) ?? collection.at(-1)!;
  const { building } = selected;
  const title = building.metadata.generationBrief?.buildingMassingShape?.replaceAll('_', ' ') ?? building.name;
  const repFloor = representativeFloor(building);
  const efficiency = useMemo(
    () => (repFloor ? computeFloorEfficiencyBreakdown(repFloor) : null),
    [repFloor],
  );

  const toggleControl = (key: keyof AlternativeExplorationControls) => {
    setControls(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return <section className="rh-catalog rh-concept-gallery" aria-label="Massing studies gallery">
    <header className="rh-catalog-heading">
      <div><p className="rh-atelier-kicker">{building.name}</p><h1>Massing Studies</h1></div>
      <button type="button" className="rh-outline-action" onClick={() => onGenerate(controls)} disabled={!canGenerate}><FilePlus2 size={17} /> Generate Massing Alternative</button>
    </header>
    <div
      data-testid="alternative-exploration-controls"
      aria-label="Design alternative controls"
      className="mb-3 flex flex-wrap items-center gap-1.5 text-xs"
    >
      {([
        ['preserveCore', 'Preserve core'],
        ['preserveExteriorFootprint', 'Preserve exterior footprint'],
        ['changeInternalLayout', 'Change internal layout'],
        ['exploreAlternativeMassing', 'Explore alternative massing'],
        ['optimizeCarpetArea', 'Optimize carpet area'],
        ['improveCirculation', 'Improve circulation'],
        ['improveDaylight', 'Improve daylight'],
      ] as const).map(([key, label]) => (
        <button
          key={key}
          type="button"
          data-testid={`alt-ctrl-${key}`}
          aria-pressed={Boolean(controls[key])}
          onClick={() => toggleControl(key)}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-mono ${
            controls[key] ? 'border-amber-500 bg-amber-500/20 font-semibold' : 'border-black/15 opacity-80'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
    {notice && <p className="rh-catalog-notice" role="status">{notice}</p>}
    <div className="rh-concept-workbench">
      <div className="rh-concept-stage">
        <div className="rh-concept-modes" aria-label="Concept preview mode">
          <button type="button" aria-pressed={preview === 'plan'} onClick={() => setPreview('plan')}><LayoutTemplate size={16} /> Plan</button>
          <button type="button" aria-pressed={preview === '3d'} onClick={() => setPreview('3d')}><Box size={16} /> Building</button>
        </div>
        {preview === 'plan' ? <PlanThumbnail building={building} /> :
          <Suspense fallback={<p role="status">Opening building preview…</p>}><ConceptModel key={conceptId(building)} building={building} /></Suspense>}
      </div>
      <div className="rh-concept-description">
        <h2>{title}</h2>
        <dl>{conceptFacts(building).map(fact => <div key={fact.name}><dt>{fact.name}</dt><dd>{fact.value}</dd></div>)}</dl>
        {efficiency && (
          <div data-testid="floor-efficiency-breakdown" className="my-2 rounded border border-black/10 p-2 text-[11px] font-mono">
            <div className="font-semibold mb-1">Floor Plate Breakdown ({efficiency.grossFloorPlate.areaSqM.toFixed(1)} m²)</div>
            <div>Carpet: {efficiency.modeledHabitableCarpet.areaSqM.toFixed(1)} m² ({efficiency.modeledHabitableCarpet.shareOfGrossPercent}%) · Walls: {efficiency.wallFootprint.shareOfGrossPercent}%</div>
            <div>Common Circ: {efficiency.commonCirculation.shareOfGrossPercent}% · Core: {efficiency.verticalCore.shareOfGrossPercent}% · Balconies: {efficiency.balconiesAndOutdoor.shareOfGrossPercent}%</div>
          </div>
        )}
        <button type="button" className="rh-solid-action" onClick={() => onOpen(selected)}>Open in CAD <ArrowRight size={17} /></button>
        {selected.sourceRevision && <p className="rh-concept-note">Opening this alternative creates a revision of the current project.</p>}
      </div>
    </div>
    <div className="rh-concept-strip" aria-label="Available concepts">
      {collection.map((concept, index) => <button key={conceptId(concept.building)} type="button"
        aria-pressed={conceptId(concept.building) === conceptId(building)} onClick={() => setSelectedId(conceptId(concept.building))}>
        <PlanThumbnail building={concept.building} />
        <span>Study {index + 1} · {concept.building.metadata.generationBrief?.buildingMassingShape?.replaceAll('_', ' ') ?? 'Massing Study'}</span>
      </button>)}
    </div>
  </section>;
}

function BrowserRevisionArchive({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<readonly ArchivedProjectRevision[]>();
  const [error, setError] = useState('');
  return <details className="rh-library-revisions" onToggle={event => {
    if (!event.currentTarget.open) return;
    setError('');
    void projectStorage.archivedRevisions(projectId).then(setEntries, reason => {
      setError(reason instanceof Error ? reason.message : 'Could not open archived browser revisions.');
    });
  }}>
    <summary>Archived browser revisions</summary>
    {error ? <p role="alert">{error}</p> : !entries ? <p role="status">Reading archive�</p> :
      entries.length === 0 ? <p>No browser revisions have been archived.</p> :
        <ol>{entries.map(entry => <li key={entry.id}>
          <time dateTime={entry.savedAt}>{new Date(entry.savedAt).toLocaleString()}</time>
          <button type="button" onClick={() => exportArchivedProjectPayloadAsJsonFile(entry.payload, projectId, entry.version)}>Export revision {entry.version}</button>
        </li>)}</ol>}
  </details>;
}

export function ProjectLibrary({
  projects,
  diskProjects = [],
  onOpen,
  onOpenDiskProject,
  onDeleteDiskProject,
  onCreate,
  onImportCad,
}: {
  projects: readonly ProjectHeader[];
  diskProjects?: readonly LocalDiskProjectManifest[];
  onOpen: (id: string) => void;
  onOpenDiskProject?: (id: string, revision?: number) => void;
  onDeleteDiskProject?: (id: string) => void;
  onCreate: () => void;
  onImportCad?: () => void;
}) {
  const [visible, setVisible] = useState(12);
  const diskIds = useMemo(() => new Set(diskProjects.map(p => p.projectId)), [diskProjects]);
  const browserOnlyProjects = useMemo(() => projects.filter(p => !diskIds.has(p.id)), [projects, diskIds]);
  const totalCount = diskProjects.length + browserOnlyProjects.length;

  return <section className="rh-catalog rh-project-library" aria-label="Project library" data-testid="project-library-view">
    <header className="rh-catalog-heading">
      <div>
        <p className="rh-atelier-kicker">
          {totalCount} saved {totalCount === 1 ? 'project' : 'projects'} · Local Disk Library
        </p>
        <h1>Project Library</h1>
      </div>
      <div className="flex items-center gap-2">
        {onImportCad && (
          <button type="button" className="rh-outline-action" onClick={onImportCad}>
            <FileUp size={16} /> Import CAD
          </button>
        )}
        <button type="button" className="rh-solid-action" data-testid="btn-new-project-from-switcher" onClick={onCreate}>
          <FilePlus2 size={17} /> New project
        </button>
      </div>
    </header>
    {totalCount === 0 && <p className="rh-catalog-notice">Saved local disk and browser projects will appear here. Click Save in the top bar to archive any revision to local disk.</p>}
    <div className="rh-library-grid">
      {diskProjects.slice(0, visible).map(project => {
        const localCached = projectStorage.load(project.projectId);
        return <article key={`disk-${project.projectId}`} data-testid={`disk-project-card-${project.projectId}`}>
          {localCached ? (
            <PlanThumbnail building={localCached.building} />
          ) : (
            <div className="rh-catalog-plan rh-catalog-plan-empty flex flex-col items-center justify-center gap-1.5">
              <HardDrive size={22} className="text-amber-400" />
              <span className="font-mono text-xs uppercase tracking-wider text-amber-300">
                {project.shapeId.replaceAll('_', ' ')}
              </span>
              {project.sourceCadFileName && (
                <span className="font-mono text-[10px] text-sky-400">CAD: {project.sourceCadFileName}</span>
              )}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <h2>{project.name}</h2>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-amber-500/15 border border-amber-400/35 text-amber-300 shrink-0">
              {project.shapeId.replaceAll('_', ' ')}
            </span>
          </div>
          <p className="font-mono text-xs">
            {project.floorCount} floors · {project.roomCount} rooms · Rev. {project.latestRevision}
            {project.complianceScore !== undefined ? ` · ${project.complianceScore}/100` : ''}
          </p>
          <p className="font-mono text-[11px] opacity-75">
            {project.structuralColumnsCount} cols · {project.structuralBeamsCount} beams
            {project.hasSourceCad ? ` · Source CAD attached` : ''}
            {' · '}Saved {new Date(project.updatedAt).toLocaleString()}
          </p>
          {!!project.revisions?.length && <details className="rh-library-revisions">
            <summary>Disk revisions ({project.revisions.length})</summary>
            <ol>{project.revisions.map(revision => <li key={revision.version}>
              <span>Revision {revision.version}{revision.complianceScore !== undefined ? ` (${revision.complianceScore}/100)` : ''}</span>
              <time dateTime={revision.savedAt}>{new Date(revision.savedAt).toLocaleString()}</time>
            </li>)}</ol>
          </details>}
          {localCached && <BrowserRevisionArchive projectId={project.projectId} />}
          <div className="flex items-center gap-2 mt-2">
            <button
              className="rh-outline-action flex-1"
              type="button"
              data-testid={`open-disk-project-${project.projectId}`}
              onClick={() => onOpenDiskProject?.(project.projectId)}
            >
              Open from Disk <ArrowRight size={16} />
            </button>
            {onDeleteDiskProject && (
              <button
                className="rh-outline-action"
                type="button"
                aria-label={`Delete ${project.name}`}
                onClick={() => onDeleteDiskProject(project.projectId)}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </article>;
      })}
      {browserOnlyProjects.slice(0, Math.max(0, visible - diskProjects.length)).map(project => {
        const envelope = projectStorage.load(project.id);
        return <article key={project.id} data-testid={`browser-project-card-${project.id}`}>
          {envelope && <PlanThumbnail building={envelope.building} />}
          <h2>{project.name}</h2>
          <p>{project.floorCount} floors · {project.roomCount} rooms{envelope ? ` · Revision ${envelope.building.version}` : ''}</p>
          <p>Edited {new Date(project.updatedAt).toLocaleDateString()}</p>
          {!!envelope?.revisionHistory?.length && <details className="rh-library-revisions">
            <summary>Saved revision history</summary>
            <ol>{envelope.revisionHistory.map(revision => <li key={revision.version}>
              <span>Revision {revision.version}</span>
              <time dateTime={revision.savedAt}>{new Date(revision.savedAt).toLocaleString()}</time>
            </li>)}</ol>
          </details>}
          {envelope && <BrowserRevisionArchive projectId={project.id} />}
          <button className="rh-outline-action" type="button" onClick={() => onOpen(project.id)}>Open project <ArrowRight size={16} /></button>
        </article>;
      })}
    </div>
    {visible < totalCount && <button className="rh-outline-action" type="button" onClick={() => setVisible(current => current + 12)}>Show more projects</button>}
  </section>;
}

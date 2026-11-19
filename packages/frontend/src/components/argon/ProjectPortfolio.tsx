import { lazy, Suspense, useMemo, useState } from 'react';
import { ArrowRight, Box, FilePlus2, LayoutTemplate } from 'lucide-react';
import type { Building } from '@ai-floor-planner/core';
import { polygonBoundingBox } from '@ai-floor-planner/geometry-engine';
import { fitToView, renderFloor } from '@ai-floor-planner/renderer';
import { projectStorage, type ProjectHeader } from '../../services/storage';

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
}

function conceptFacts(building: Building) {
  const floor = representativeFloor(building);
  return [
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
  onGenerate: () => void;
  onOpen: (concept: GeneratedConcept) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [preview, setPreview] = useState<'plan' | '3d'>('plan');
  const collection = concepts.length ? concepts : [{ building: activeBuilding, seed: 1 }];
  const selected = collection.find(concept => concept.building.id === selectedId) ?? collection.at(-1)!;
  const { building } = selected;
  const title = building.metadata.generationBrief?.buildingMassingShape?.replaceAll('_', ' ') ?? building.name;

  return <section className="rh-catalog rh-concept-gallery" aria-label="Massing studies gallery">
    <header className="rh-catalog-heading">
      <div><p className="rh-atelier-kicker">{building.name}</p><h1>Massing Studies</h1></div>
      <button type="button" className="rh-outline-action" onClick={onGenerate} disabled={!canGenerate}><FilePlus2 size={17} /> Generate Massing Alternative</button>
    </header>
    {notice && <p className="rh-catalog-notice" role="status">{notice}</p>}
    <div className="rh-concept-workbench">
      <div className="rh-concept-stage">
        <div className="rh-concept-modes" aria-label="Concept preview mode">
          <button type="button" aria-pressed={preview === 'plan'} onClick={() => setPreview('plan')}><LayoutTemplate size={16} /> Plan</button>
          <button type="button" aria-pressed={preview === '3d'} onClick={() => setPreview('3d')}><Box size={16} /> Building</button>
        </div>
        {preview === 'plan' ? <PlanThumbnail building={building} /> :
          <Suspense fallback={<p role="status">Opening building preview…</p>}><ConceptModel key={building.id} building={building} /></Suspense>}
      </div>
      <div className="rh-concept-description">
        <h2>{title}</h2>
        <dl>{conceptFacts(building).map(fact => <div key={fact.name}><dt>{fact.name}</dt><dd>{fact.value}</dd></div>)}</dl>
        <button type="button" className="rh-solid-action" onClick={() => onOpen(selected)}>Open in CAD <ArrowRight size={17} /></button>
        {selected.building.id !== activeBuilding.id && <p className="rh-concept-note">Opening this alternative saves it as a separate project.</p>}
      </div>
    </div>
    <div className="rh-concept-strip" aria-label="Available concepts">
      {collection.map((concept, index) => <button key={concept.building.id} type="button"
        aria-pressed={concept.building.id === building.id} onClick={() => setSelectedId(concept.building.id)}>
        <PlanThumbnail building={concept.building} />
        <span>Study {index + 1} · {concept.building.metadata.generationBrief?.buildingMassingShape?.replaceAll('_', ' ') ?? 'Massing Study'}</span>
      </button>)}
    </div>
  </section>;
}

export function ProjectLibrary({ projects, onOpen, onCreate }: {
  projects: readonly ProjectHeader[];
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const [visible, setVisible] = useState(12);
  return <section className="rh-catalog rh-project-library" aria-label="Project library">
    <header className="rh-catalog-heading">
      <div><p className="rh-atelier-kicker">{projects.length} saved {projects.length === 1 ? 'project' : 'projects'}</p><h1>Project library</h1></div>
      <button type="button" className="rh-solid-action" data-testid="btn-new-project-from-switcher" onClick={onCreate}><FilePlus2 size={17} /> New project</button>
    </header>
    {projects.length === 0 && <p className="rh-catalog-notice">Saved projects will appear here.</p>}
    <div className="rh-library-grid">
      {projects.slice(0, visible).map(project => {
        const envelope = projectStorage.load(project.id);
        return <article key={project.id}>
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
          <button className="rh-outline-action" type="button" onClick={() => onOpen(project.id)}>Open project <ArrowRight size={16} /></button>
        </article>;
      })}
    </div>
    {visible < projects.length && <button className="rh-outline-action" type="button" onClick={() => setVisible(current => current + 12)}>Show more projects</button>}
  </section>;
}

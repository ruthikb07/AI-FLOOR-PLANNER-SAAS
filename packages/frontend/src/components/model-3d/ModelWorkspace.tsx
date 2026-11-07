import React, { useEffect, useMemo, useState } from 'react';
import { Box, Building2, Eye, Focus, Layers3, PanelTop, Rotate3D, Ruler, Settings2 } from 'lucide-react';
import type { Building, EditorSelection, GenerationControlState } from '@ai-floor-planner/core';
import { coordinateStairAccess, stairModelIssues } from '@ai-floor-planner/planning-engine';
import { createBlenderExport, createBlenderLauncher } from '../../services/blender-export';
import { Building3DProjector, type Building3DProjectionSettings, type ProjectionParameter, type ProjectionSource } from '@ai-floor-planner/projection-3d';
import { ThreeBuildingScene } from './ThreeBuildingScene';
import {
  loadModelViewPreferences,
  DEFAULT_MODEL_VIEW_PREFERENCES,
  projectionSourceToSelection,
  saveModelViewPreferences,
  type ModelLayerVisibility,
  type ModelViewPreferences,
} from '../../services/projection-preferences';

interface ModelWorkspaceProps {
  readonly generationControl: GenerationControlState;
  readonly onApplyBuilding: (building: Building, description: string) => void;
  readonly building: Building;
  readonly activeFloorId: string;
  readonly selection: EditorSelection | null;
  readonly onSelectEntity: (entityType: string, entityId: string, floorId: string) => void;
  readonly onClearSelection: () => void;
  readonly onSwitchFloor: (floorId: string) => void;
}

const projector = new Building3DProjector();

function updateParameter(settings: Building3DProjectionSettings, key: keyof Building3DProjectionSettings, rawValue: string): Building3DProjectionSettings {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) return settings;
  return { ...settings, [key]: { value, provenance: 'USER_PROVIDED' } satisfies ProjectionParameter };
}

export const ModelWorkspace: React.FC<ModelWorkspaceProps> = ({ building, generationControl, onApplyBuilding, activeFloorId, selection, onSelectEntity, onClearSelection, onSwitchFloor }) => {
  const [coordinationMessage, setCoordinationMessage] = useState('');
  const [stairReviewOpen, setStairReviewOpen] = useState(false);
  const stairIssues = useMemo(() => stairModelIssues(building), [building]);
  const [preferences, setPreferences] = useState<ModelViewPreferences>(() => loadModelViewPreferences(building.projectId));
  const [fitRequest, setFitRequest] = useState(0);
  const [fitSite, setFitSite] = useState(false);
  const [snapshotRequest, setSnapshotRequest] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const projection = useMemo(() => projector.project(building, preferences.heightSettings), [building, preferences.heightSettings]);

  useEffect(() => { setPreferences(loadModelViewPreferences(building.projectId)); }, [building.projectId]);
  useEffect(() => { saveModelViewPreferences(building.projectId, preferences); }, [building.projectId, preferences]);

  const update = <K extends keyof ModelViewPreferences,>(key: K, value: ModelViewPreferences[K]) => setPreferences(current => ({ ...current, [key]: value }));
  const toggleLayer = (key: keyof ModelLayerVisibility) => setPreferences(current => ({ ...current, layers: { ...current.layers, [key]: !current.layers[key] } }));
  const handleSelect = (source: ProjectionSource) => {
    const mapped = projectionSourceToSelection(source);
    if (!mapped) return;
    onSwitchFloor(mapped.floorId);
    onSelectEntity(mapped.entityType, mapped.entityId, mapped.floorId);
  };

  if (projection.floorPlates.every(plate => plate.boundary.points.length < 3)) {
    return <div className="model-empty-state"><Box size={38} /><strong>NO BUILDING GEOMETRY AVAILABLE</strong><p>Create or load valid floor geometry before opening the structured model.</p></div>;
  }

  const selectedLevel = projection.levels.find(level => level.floorId === activeFloorId);
  const coordinate = () => {
    const result = coordinateStairAccess(building, generationControl);
    if (result.changed) onApplyBuilding(result.building, 'Coordinate stair flights, landing and hosted doors');
    setCoordinationMessage(result.issues.length ? result.issues.join(' ') : result.changed ? `Coordinated stair flights and ${result.movedDoorIds.length} door(s). Undo is available. Professional review still required.` : 'No changes needed.');
    setStairReviewOpen(true);
  };
  const exportBlender = (windowsLauncher: boolean) => {
    try {
      const artifact = windowsLauncher ? createBlenderLauncher(building, projection) : createBlenderExport(building, projection);
      const url = URL.createObjectURL(new Blob([artifact.content], { type: 'application/octet-stream' }));
      const link = document.createElement('a'); link.href = url; link.download = artifact.filename; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage(windowsLauncher ? 'Downloaded. Run the .cmd in your Downloads folder. It creates a new .blend alongside it and opens Blender. On failure the console stays open with the error. Only run exports you trust.' : 'Downloaded Python script. Do not double-click it in Windows: open Blender → Scripting → Open, then Run Script in a new scene, or use the command below.');
    } catch (error) { setExportMessage(error instanceof Error ? error.message : 'Blender export failed.'); }
  };
  return <section className="model-workspace" aria-label="Canonical 3D building model workspace">
    <ThreeBuildingScene
      projection={projection}
      activeFloorId={activeFloorId}
      selection={selection}
      viewMode={preferences.viewMode}
      cameraPreset={preferences.cameraPreset}
      floorMode={preferences.floorMode}
      exploded={preferences.exploded}
      layers={preferences.layers}
      fitRequest={fitRequest}
      fitSite={fitSite}
      snapshotRequest={snapshotRequest}
      onSelect={handleSelect}
      onClearSelection={onClearSelection}
    />

    <div className="model-context-card">
      <span>SCHEMATIC / DESIGN MODEL</span>
      <strong>{building.name}</strong>
      <small>Canonical projection · not construction BIM</small>
      {stairIssues.length > 0 && <small role="status">{stairIssues.length} stair geometry/access items require review</small>}
    </div>

    <div className="model-toolbar" aria-label="3D model controls">
      <div className="model-control-group">
        <Rotate3D size={14} />
        {(['isometric', 'front', 'back', 'left', 'right', 'top'] as const).map(preset => <button key={preset} className={preferences.cameraPreset === preset ? 'active' : ''} onClick={() => update('cameraPreset', preset)}>{preset}</button>)}
      </div>
      <div className="model-control-group compact">
        <button onClick={() => { setFitSite(false); setFitRequest(value => value + 1); }} title="Focus on the building, not the entire plot"><Focus size={15} /> Fit building</button>
        <button onClick={() => { update('layers', { ...preferences.layers, site: true }); setFitSite(true); setFitRequest(value => value + 1); }}>Fit site</button>
        <button onClick={() => { setPreferences(current => ({ ...DEFAULT_MODEL_VIEW_PREFERENCES, heightSettings:current.heightSettings })); setFitSite(false); setFitRequest(value => value + 1); }}>Reset view</button>
        <button className={preferences.exploded ? 'active' : ''} onClick={() => update('exploded', !preferences.exploded)}><Layers3 size={15} /> Explode</button>
        <button className={layersOpen ? 'active' : ''} onClick={() => setLayersOpen(open => !open)}><Eye size={15} /> Layers</button>
        <button className={settingsOpen ? 'active' : ''} onClick={() => setSettingsOpen(open => !open)}><Settings2 size={15} /> Heights</button>
        <button onClick={() => setStairReviewOpen(open => !open)}>Stair review{stairIssues.length ? ` (${stairIssues.length})` : ''}</button>
        <button onClick={() => setSnapshotRequest(value => value + 1)}>Save view PNG</button>
        <button onClick={() => setExportOpen(open => !open)}>Export Blender</button>
      </div>
    </div>

    <p className="model-navigation-help">Drag to orbit · Right-drag to pan · Scroll to zoom · Click to select</p>

    {exportOpen && <aside className="model-popover model-export-panel" aria-label="Blender export instructions">
      <header><Box size={18} /><div><strong>Continue in Blender</strong><small>Current project · metres · architectural model</small></div><button aria-label="Close Blender export" onClick={() => setExportOpen(false)}>×</button></header>
      <p><strong>Windows + Blender 5.2:</strong> download the launcher and run it. It builds in a separate background session, saves a .blend beside the download and opens it. Your open Blender scene is not cleared.</p>
      <button className="btn btn-primary" onClick={() => exportBlender(true)}>Download Windows launcher (.cmd)</button>
      <p>A review camera and lighting are included. In Blender press F12 to render. The browser PNG button saves the current 3D view.</p>
      <details><summary>Advanced / Python export</summary><button className="btn btn-secondary" onClick={() => exportBlender(false)}>Download .py</button><p>In PowerShell type the command prefix below, then drag the downloaded .py from File Explorer into the terminal to insert its real path, and press Enter.</p><code>blender --background --python-exit-code 1 --python</code><p>Do not type C:\PATH\TO or YOUR_FILE.py literally: those are placeholders. Ordinary Python cannot import bpy. Use Blender or the Windows launcher above.</p></details>
      {exportMessage && <p role="status">{exportMessage}</p>}
      <small>Architectural geometry only. No engineered RCC, reinforcement or construction approval.</small>
    </aside>}

    <div className="model-floor-controls">
      <div className="model-segmented-control">
        {(['all', 'active', 'isolate'] as const).map(mode => <button key={mode} className={preferences.floorMode === mode ? 'active' : ''} onClick={() => update('floorMode', mode)}>{mode === 'all' ? 'All floors' : mode === 'active' ? 'Active floor' : 'Isolate'}</button>)}
      </div>
      <div className="model-level-picker">
        {projection.levels.map(level => <button key={level.floorId} className={activeFloorId === level.floorId ? 'active' : ''} onClick={() => onSwitchFloor(level.floorId)}><span>{level.floorName}</span><small>{level.datumLabel}</small></button>)}
      </div>
      <div className="model-segmented-control">
        {(['solid', 'xray', 'rooms'] as const).map(mode => <button key={mode} className={preferences.viewMode === mode ? 'active' : ''} onClick={() => update('viewMode', mode)}>{mode}</button>)}
      </div>
    </div>

    {stairReviewOpen && <aside className="model-popover model-stair-panel" aria-label="Stair geometry and access review">
      <header><Ruler size={15} /><div><strong>Flights & arrival access</strong><small>Architectural coordination · not RCC design</small></div><button onClick={() => setStairReviewOpen(false)} aria-label="Close stair review">×</button></header>
      <p>Fits an aligned U-stair and reserves a landing outside its opening. Moves eligible doors along existing walls; rooms and floor plates stay unchanged.</p>
      <button className="btn btn-primary" onClick={coordinate}>Coordinate stairs & doors</button>
      {coordinationMessage && <p role="status">{coordinationMessage}</p>}
      {stairIssues.length > 0 ? <ul>{stairIssues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <p>Current flight/landing checks found no listed issue. This is not a headroom, guardrail, fire, accessibility or structural assessment.</p>}
      <p>Blender export includes actual flights, wall openings, aligned floors and stair voids. Furniture, reinforcement and engineered framing are not included.</p>
    </aside>}

    {layersOpen && <aside className="model-popover model-layers-panel" aria-label="3D layer visibility">
      <header><PanelTop size={15} /><div><strong>Model layers</strong><small>View state only</small></div></header>
      {(Object.keys(preferences.layers) as (keyof ModelLayerVisibility)[]).map(key => <label key={key}><input type="checkbox" checked={preferences.layers[key]} onChange={() => toggleLayer(key)} /><span>{key.replace(/([A-Z])/g, ' $1')}</span></label>)}
    </aside>}

    {settingsOpen && <aside className="model-popover model-height-panel" aria-label="Building height settings">
      <header><Ruler size={15} /><div><strong>Building height settings</strong><small>Canonical mm · concept defaults</small></div></header>
      {([
        ['defaultFloorToFloorHeight', 'Floor-to-floor fallback'],
        ['defaultWallHeight', 'Wall height'],
        ['slabThickness', 'Slab thickness'],
        ['defaultDoorHeight', 'Door height fallback'],
        ['defaultWindowSillHeight', 'Window sill fallback'],
        ['defaultWindowHeight', 'Window height fallback'],
        ['parapetHeight', 'Parapet height'],
      ] as const).map(([key, label]) => <label key={key}><span>{label}<small>{preferences.heightSettings[key].provenance.replace('_', ' ')}</small></span><div><input type="number" min="1" step="50" value={preferences.heightSettings[key].value} onChange={event => update('heightSettings', updateParameter(preferences.heightSettings, key, event.target.value))} /><em>mm</em></div></label>)}
      <p>Defaults are architectural project values, not code requirements. Existing door and window entity dimensions remain authoritative.</p>
    </aside>}

    <div className="model-north-indicator" style={{ transform: `rotate(${projection.site.northDegrees}deg)` }}><span>N</span><i /></div>
    {preferences.layers.labels && <div className="model-datum"><Building2 size={14} /><span>{selectedLevel?.floorName ?? 'Building stack'}</span><strong>{selectedLevel?.datumLabel ?? '±0.000'}</strong></div>}
  </section>;
};

export default ModelWorkspace;

import React, { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import {
  Box,
  Building2,
  Eye,
  Focus,
  Footprints,
  Layers3,
  Palette,
  PanelTop,
  Rotate3D,
  Ruler,
  Settings2,
  Sun,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Building, EditorSelection, GenerationControlState } from '@ai-floor-planner/core';
import { coordinateStairAccess, stairModelIssues } from '@ai-floor-planner/planning-engine';
import { createBlenderExport, createBlenderLauncher } from '../../services/blender-export';
import { Building3DProjector, type Building3DProjectionSettings, type ProjectionParameter, type ProjectionSource } from '@ai-floor-planner/projection-3d';
import {
  ThreeBuildingScene,
  type ArchitecturalMaterialPalette,
  type BuildingLightingMode,
} from './ThreeBuildingScene';
import {
  loadModelViewPreferences,
  DEFAULT_MODEL_VIEW_PREFERENCES,
  projectionSourceToSelection,
  saveModelViewPreferences,
  type ModelLayerVisibility,
  type ModelViewPreferences,
} from '../../services/projection-preferences';

export interface ModelWorkspaceProps {
  readonly generationControl: GenerationControlState;
  readonly onApplyBuilding: (building: Building, description: string) => void;
  readonly building: Building;
  readonly activeFloorId: string;
  readonly selection: EditorSelection | null;
  readonly onSelectEntity: (entityType: string, entityId: string, floorId: string) => void;
  readonly onClearSelection: () => void;
  readonly onSwitchFloor: (floorId: string) => void;
  readonly explodeValue?: number;
  readonly onExplodeChange?: (value: number) => void;
  readonly lightingMode?: BuildingLightingMode;
  readonly onLightingModeChange?: (mode: BuildingLightingMode) => void;
  readonly materialPalette?: ArchitecturalMaterialPalette;
  readonly onMaterialPaletteChange?: (palette: ArchitecturalMaterialPalette) => void;
  readonly linkedSpanStoreys?: 1 | 2 | 3;
  readonly onLinkedSpanChange?: (span: 1 | 2 | 3) => void;
  readonly sceneRef?: React.MutableRefObject<THREE.Scene | null>;
}

const projector = new Building3DProjector();

function updateParameter(settings: Building3DProjectionSettings, key: keyof Building3DProjectionSettings, rawValue: string): Building3DProjectionSettings {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) return settings;
  return { ...settings, [key]: { value, provenance: 'USER_PROVIDED' } satisfies ProjectionParameter };
}

export const ModelWorkspace: React.FC<ModelWorkspaceProps> = ({
  building,
  generationControl,
  onApplyBuilding,
  activeFloorId,
  selection,
  onSelectEntity,
  onClearSelection,
  onSwitchFloor,
  explodeValue,
  onExplodeChange,
  lightingMode,
  onLightingModeChange,
  materialPalette,
  onMaterialPaletteChange,
  linkedSpanStoreys,
  onLinkedSpanChange,
  sceneRef,
}) => {
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
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [sectionCut, setSectionCut] = useState(false);
  const [parallelProjection, setParallelProjection] = useState(false);

  const [localLighting, setLocalLighting] = useState<BuildingLightingMode>('day');
  const [localPalette, setLocalPalette] = useState<ArchitecturalMaterialPalette>('travertine');
  const [localLinkedSpan, setLocalLinkedSpan] = useState<1 | 2 | 3>(1);
  const [walkthroughActive, setWalkthroughActive] = useState(false);
  const [walkCommand, setWalkCommand] = useState<{ action: 'forward' | 'backward' | 'left' | 'right'; seq: number }>({
    action: 'forward',
    seq: 0,
  });
  const [zoomCommand, setZoomCommand] = useState<{ dir: 'in' | 'out'; seq: number }>({
    dir: 'in',
    seq: 0,
  });

  const effectiveLighting = lightingMode ?? localLighting;
  const effectivePalette = materialPalette ?? localPalette;
  const effectiveLinkedSpan = linkedSpanStoreys ?? localLinkedSpan;

  const setLighting = (mode: BuildingLightingMode) => {
    if (onLightingModeChange) onLightingModeChange(mode);
    else setLocalLighting(mode);
  };
  const setPalette = (palette: ArchitecturalMaterialPalette) => {
    if (onMaterialPaletteChange) onMaterialPaletteChange(palette);
    else setLocalPalette(palette);
  };
  const setLinkedSpan = (span: 1 | 2 | 3) => {
    if (onLinkedSpanChange) onLinkedSpanChange(span);
    else setLocalLinkedSpan(span);
  };

  const projection = useMemo(() => projector.project(building, preferences.heightSettings), [building, preferences.heightSettings]);

  useEffect(() => { setPreferences(loadModelViewPreferences(building.projectId)); }, [building.projectId]);
  useEffect(() => { saveModelViewPreferences(building.projectId, preferences); }, [building.projectId, preferences]);

  const update = <K extends keyof ModelViewPreferences,>(key: K, value: ModelViewPreferences[K]) =>
    setPreferences(current => ({ ...current, [key]: value }));
  const toggleLayer = (key: keyof ModelLayerVisibility) =>
    setPreferences(current => ({ ...current, layers: { ...current.layers, [key]: !current.layers[key] } }));

  const handleSelect = (source: ProjectionSource) => {
    const mapped = projectionSourceToSelection(source);
    if (!mapped) return;
    onSwitchFloor(mapped.floorId);
    onSelectEntity(mapped.entityType, mapped.entityId, mapped.floorId);
  };

  const effectiveExplodeDistance = explodeValue !== undefined
    ? (explodeValue / 100) * 4.5
    : (preferences.exploded ? 1.8 : 0);
  const effectiveExploded = effectiveExplodeDistance > 0;

  if (projection.floorPlates.every(plate => plate.boundary.points.length < 3)) {
    return (
      <div className="model-empty-state">
        <Box size={38} />
        <strong>NO BUILDING GEOMETRY AVAILABLE</strong>
        <p>Create or load valid floor geometry before opening the structured model.</p>
      </div>
    );
  }

  const activeCanonicalFloor = building.floors.find(f => f.id === activeFloorId) ?? building.floors[0];
  const selectedRoomEntity =
    selection?.entityType === 'room'
      ? building.floors
          .find(f => f.id === (selection.floorId || activeFloorId))
          ?.rooms.find(r => r.id === selection.entityId)
      : undefined;

  const selectedLevel = projection.levels.find(level => level.floorId === activeFloorId);

  const coordinate = () => {
    const result = coordinateStairAccess(building, generationControl);
    if (result.changed) onApplyBuilding(result.building, 'Coordinate stair flights, landing and hosted doors');
    setCoordinationMessage(
      result.issues.length
        ? result.issues.join(' ')
        : result.changed
          ? `Coordinated stair flights and ${result.movedDoorIds.length} door(s). Undo is available. Professional review still required.`
          : 'No changes needed.',
    );
    setStairReviewOpen(true);
  };

  const exportBlender = (windowsLauncher: boolean) => {
    try {
      const artifact = windowsLauncher ? createBlenderLauncher(building, projection) : createBlenderExport(building, projection);
      const url = URL.createObjectURL(new Blob([artifact.content], { type: 'application/octet-stream' }));
      const link = document.createElement('a'); link.href = url; link.download = artifact.filename; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage(
        windowsLauncher
          ? 'Downloaded. Run the .cmd in your Downloads folder. It creates a new .blend alongside it and opens Blender.'
          : 'Downloaded Python script. Open Blender -> Scripting -> Open, then Run Script in a new scene.',
      );
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'Blender export failed.');
    }
  };

  const handleResetView = () => {
    setWalkthroughActive(false);
    setFitSite(false);
    setLinkedSpan(1);
    onExplodeChange?.(0);
    setPreferences(current => ({
      ...DEFAULT_MODEL_VIEW_PREFERENCES,
      heightSettings: current.heightSettings,
    }));
    setFitRequest(value => value + 1);
  };

  return (
    <section
      className={effectiveLighting === 'night' ? 'model-workspace model-workspace-night' : 'model-workspace'}
      aria-label="Canonical 3D building model workspace"
    >
      <ThreeBuildingScene
        projection={projection}
        activeFloorId={activeFloorId}
        selection={selection}
        viewMode={preferences.viewMode}
        cameraPreset={preferences.cameraPreset}
        floorMode={preferences.floorMode}
        exploded={effectiveExploded}
        explodeDistance={effectiveExplodeDistance}
        lightingMode={effectiveLighting}
        materialPalette={effectivePalette}
        sectionCut={sectionCut}
        parallelProjection={parallelProjection}
        walkthroughActive={walkthroughActive}
        walkCommand={walkCommand}
        zoomCommand={zoomCommand}
        linkedSpanStoreys={effectiveLinkedSpan}
        layers={preferences.layers}
        fitRequest={fitRequest}
        fitSite={fitSite}
        snapshotRequest={snapshotRequest}
        onSelect={handleSelect}
        onClearSelection={onClearSelection}
        sceneRef={sceneRef}
      />

      <div className="model-context-card">
        <span>DAYLIGHT ARCHITECTURAL 3D</span>
        <strong>{building.name}</strong>
        <small>
          Canonical projection · {effectivePalette.toUpperCase()} finish · {effectiveLighting.toUpperCase()}
        </small>
        {effectiveLinkedSpan > 1 && (
          <small className="font-semibold text-amber-700" data-testid="linked-storey-badge">
            Linked {effectiveLinkedSpan === 2 ? 'Duplex (2-Storey)' : 'Triplex (3-Storey)'} canonical stair stack
          </small>
        )}
        {selectedRoomEntity && (
          <div
            data-testid="selected-room-summary"
            className="mt-1 pt-1 border-t border-black/10 flex items-center justify-between gap-2 text-[10px]"
          >
            <span>
              <strong>{selectedRoomEntity.name}</strong> · {(selectedRoomEntity.area / 1e6).toFixed(1)} m²
            </span>
            <button
              type="button"
              onClick={onClearSelection}
              className="underline opacity-80 hover:opacity-100"
            >
              Clear
            </button>
          </div>
        )}
        {stairIssues.length > 0 && <small role="status">{stairIssues.length} stair geometry items require review</small>}
      </div>

      <div className="model-toolbar" aria-label="3D model controls">
        <div className="model-control-group">
          <Rotate3D size={14} />
          {(['isometric', 'front', 'back', 'left', 'right', 'top'] as const).map(preset => (
            <button
              key={preset}
              data-testid={`camera-preset-${preset}`}
              className={!walkthroughActive && preferences.cameraPreset === preset ? 'active' : ''}
              onClick={() => {
                setWalkthroughActive(false);
                update('cameraPreset', preset);
              }}
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="model-control-group compact">
          <button
            type="button"
            data-testid="btn-3d-zoom-in"
            onClick={() => setZoomCommand(z => ({ dir: 'in', seq: z.seq + 1 }))}
            title="Zoom In"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            data-testid="btn-3d-zoom-out"
            onClick={() => setZoomCommand(z => ({ dir: 'out', seq: z.seq + 1 }))}
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            data-testid="btn-fit-building"
            onClick={() => {
              setWalkthroughActive(false);
              setFitSite(false);
              setFitRequest(value => value + 1);
            }}
            title="Focus on the building"
          >
            <Focus size={14} /> Fit building
          </button>
          <button
            type="button"
            data-testid="btn-reset-view"
            onClick={handleResetView}
          >
            Reset view
          </button>
          <button type="button" aria-pressed={parallelProjection} className={parallelProjection ? 'active' : ''} onClick={() => {
            setWalkthroughActive(false);
            setParallelProjection(current => !current);
          }}>Orthographic</button>
          <button type="button" aria-pressed={sectionCut} className={sectionCut ? 'active' : ''} onClick={() => setSectionCut(current => !current)}>
            Section cut
          </button>
          <button
            type="button"
            data-testid="btn-walkthrough"
            className={walkthroughActive ? 'active' : ''}
            onClick={() => setWalkthroughActive(v => !v)}
          >
            <Footprints size={14} /> {walkthroughActive ? 'Exit Walk' : 'Walkthrough'}
          </button>
          <button
            type="button"
            data-testid="btn-explode-toggle"
            className={effectiveExploded ? 'active' : ''}
            onClick={() => {
              if (onExplodeChange) onExplodeChange(effectiveExploded ? 0 : 60);
              else update('exploded', !preferences.exploded);
            }}
          >
            <Layers3 size={14} /> Explode
          </button>
          <button
            type="button"
            data-testid="btn-materials-popover"
            className={materialsOpen ? 'active' : ''}
            onClick={() => setMaterialsOpen(o => !o)}
          >
            <Palette size={14} /> Materials
          </button>
          <button
            type="button"
            data-testid="btn-daylight-cycle"
            onClick={() => {
              const order: BuildingLightingMode[] = ['day', 'golden', 'night'];
              const next = order[(order.indexOf(effectiveLighting) + 1) % order.length]!;
              setLighting(next);
            }}
            title="Cycle Daylight / Golden Hour / Night"
          >
            <Sun size={14} /> {effectiveLighting === 'day' ? 'Day' : effectiveLighting === 'golden' ? 'Golden' : 'Night'}
          </button>
          <button className={layersOpen ? 'active' : ''} onClick={() => setLayersOpen(o => !o)}>
            <Eye size={14} /> Layers
          </button>
          <button className={settingsOpen ? 'active' : ''} onClick={() => setSettingsOpen(o => !o)}>
            <Settings2 size={14} /> Heights
          </button>
          <button onClick={() => setStairReviewOpen(o => !o)}>
            Stair review{stairIssues.length ? ` (${stairIssues.length})` : ''}
          </button>
          <button onClick={() => setSnapshotRequest(value => value + 1)}>PNG</button>
          <button onClick={() => setExportOpen(o => !o)}>Export Blender</button>
        </div>
      </div>

      {/* Walkthrough On-Screen Controls */}
      {walkthroughActive && (
        <div
          data-testid="walkthrough-hud"
          className="absolute top-28 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-500/40 bg-[#FFFDF9]/95 text-[#221D18] shadow-lg text-xs font-mono"
        >
          <span className="font-bold text-[#8B6843]">Eye-Level 1.65m ({activeCanonicalFloor?.name}):</span>
          <button
            type="button"
            data-testid="walk-forward"
            onClick={() => setWalkCommand(w => ({ action: 'forward', seq: w.seq + 1 }))}
            className="px-2 py-1 rounded bg-[#EAE0D2] hover:bg-[#D8CAB8]"
          >
            Forward (W)
          </button>
          <button
            type="button"
            data-testid="walk-back"
            onClick={() => setWalkCommand(w => ({ action: 'backward', seq: w.seq + 1 }))}
            className="px-2 py-1 rounded bg-[#EAE0D2] hover:bg-[#D8CAB8]"
          >
            Back (S)
          </button>
          <button
            type="button"
            data-testid="walk-left"
            onClick={() => setWalkCommand(w => ({ action: 'left', seq: w.seq + 1 }))}
            className="px-2 py-1 rounded bg-[#EAE0D2] hover:bg-[#D8CAB8]"
          >
            Turn L (A)
          </button>
          <button
            type="button"
            data-testid="walk-right"
            onClick={() => setWalkCommand(w => ({ action: 'right', seq: w.seq + 1 }))}
            className="px-2 py-1 rounded bg-[#EAE0D2] hover:bg-[#D8CAB8]"
          >
            Turn R (D)
          </button>
        </div>
      )}

      <p className="model-navigation-help">
        Drag to orbit · Right-drag to pan · Scroll to zoom · Click wall or room slab to select
      </p>

      {materialsOpen && (
        <aside className="model-popover model-layers-panel" aria-label="Materials, daylight & room inspector">
          <header>
            <Palette size={15} />
            <div>
              <strong>Materials &amp; Room Inspector</strong>
              <small>PBR Presentation Finishes</small>
            </div>
            <button onClick={() => setMaterialsOpen(false)} aria-label="Close materials panel">×</button>
          </header>
          <div className="p-3 space-y-3 text-xs">
            <div>
              <div className="font-mono text-[10px] uppercase opacity-75 mb-1.5">Facade Finish</div>
              <div className="grid grid-cols-3 gap-1.5">
                {(['travertine', 'concrete', 'coastal'] as const).map(pal => (
                  <button
                    key={pal}
                    type="button"
                    data-testid={`material-${pal}`}
                    onClick={() => setPalette(pal)}
                    className={`px-2 py-1.5 rounded-lg border font-mono capitalize ${
                      effectivePalette === pal ? 'bg-[#8B6843] text-white border-[#8B6843]' : 'border-[#D8CAB8]'
                    }`}
                  >
                    {pal}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="font-mono text-[10px] uppercase opacity-75 mb-1.5">Duplex / Triplex Canonical Stack</div>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  [1, 'Single'],
                  [2, 'Duplex (2F)'],
                  [3, 'Triplex (3F)'],
                ] as const).map(([span, label]) => (
                  <button
                    key={span}
                    type="button"
                    data-testid={`linked-span-${span}`}
                    onClick={() => setLinkedSpan(span)}
                    className={`px-2 py-1.5 rounded-lg border font-mono text-[10px] ${
                      effectiveLinkedSpan === span ? 'bg-[#8B6843] text-white border-[#8B6843]' : 'border-[#D8CAB8]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {activeCanonicalFloor && activeCanonicalFloor.rooms.length > 0 && (
              <div>
                <div className="font-mono text-[10px] uppercase opacity-75 mb-1.5">
                  Select Room ({activeCanonicalFloor.name})
                </div>
                <select
                  data-testid="room-quick-selector"
                  aria-label="Select room in 3D"
                  value={selection?.entityType === 'room' ? selection.entityId : ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) onClearSelection();
                    else onSelectEntity('room', id, activeCanonicalFloor.id);
                  }}
                  className="w-full rounded-lg border border-[#D8CAB8] px-2 py-1.5 text-xs font-mono"
                >
                  <option value="">-- Click floor or pick room --</option>
                  {activeCanonicalFloor.rooms.map(room => (
                    <option key={room.id} value={room.id}>
                      {room.name} ({(room.area / 1e6).toFixed(1)} m²)
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </aside>
      )}

      {exportOpen && (
        <aside className="model-popover model-export-panel" aria-label="Blender export instructions">
          <header>
            <Box size={18} />
            <div>
              <strong>Continue in Blender</strong>
              <small>Current project · metres · architectural model</small>
            </div>
            <button aria-label="Close Blender export" onClick={() => setExportOpen(false)}>×</button>
          </header>
          <p><strong>Windows + Blender 5.2:</strong> download the launcher and run it in a separate background session.</p>
          <button className="btn btn-primary" onClick={() => exportBlender(true)}>Download Windows launcher (.cmd)</button>
          <details>
            <summary>Advanced / Python export</summary>
            <button className="btn btn-secondary" onClick={() => exportBlender(false)}>Download .py</button>
          </details>
          {exportMessage && <p role="status">{exportMessage}</p>}
        </aside>
      )}

      <div className="model-floor-controls">
        <div className="model-segmented-control">
          {(['all', 'active', 'isolate'] as const).map(mode => (
            <button
              key={mode}
              data-testid={`floor-mode-${mode}`}
              aria-pressed={preferences.floorMode === mode}
              className={preferences.floorMode === mode ? 'active' : ''}
              onClick={() => update('floorMode', mode)}
            >
              {mode === 'all' ? 'All floors' : mode === 'active' ? 'Active floor' : 'Isolate'}
            </button>
          ))}
        </div>
        <div className="model-level-picker">
          {projection.levels.map(level => (
            <button
              key={level.floorId}
              data-testid={`model-level-${level.floorId}`}
              aria-pressed={activeFloorId === level.floorId}
              className={activeFloorId === level.floorId ? 'active' : ''}
              onClick={() => onSwitchFloor(level.floorId)}
            >
              <span title={level.floorName}>{level.floorName.replace(/_PLAN$/i, '').replace(/_/g, ' ')}</span>
              <small>{level.datumLabel}</small>
            </button>
          ))}
        </div>
        <div className="model-segmented-control">
          {(['solid', 'xray', 'rooms'] as const).map(mode => (
            <button
              key={mode}
              data-testid={`view-mode-${mode}`}
              aria-pressed={preferences.viewMode === mode}
              className={preferences.viewMode === mode ? 'active' : ''}
              onClick={() => update('viewMode', mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {stairReviewOpen && (
        <aside className="model-popover model-stair-panel" aria-label="Stair geometry and access review">
          <header>
            <Ruler size={15} />
            <div>
              <strong>Flights &amp; arrival access</strong>
              <small>Architectural coordination · not RCC design</small>
            </div>
            <button onClick={() => setStairReviewOpen(false)} aria-label="Close stair review">×</button>
          </header>
          <p>Coordinates canonical U-stair landings and adjacent door clearances across stacked storeys.</p>
          <button className="btn btn-primary" onClick={coordinate}>Coordinate stairs &amp; doors</button>
          {coordinationMessage && <p role="status">{coordinationMessage}</p>}
          {stairIssues.length > 0 ? (
            <ul>{stairIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>
          ) : (
            <p>Current flight/landing checks found no listed issue. Professional engineering review required.</p>
          )}
        </aside>
      )}

      {layersOpen && (
        <aside className="model-popover model-layers-panel" aria-label="3D layer visibility">
          <header>
            <PanelTop size={15} />
            <div>
              <strong>Model layers</strong>
              <small>View state only</small>
            </div>
          </header>
          {(Object.keys(preferences.layers) as (keyof ModelLayerVisibility)[]).map(key => (
            <label key={key}>
              <input type="checkbox" checked={preferences.layers[key]} onChange={() => toggleLayer(key)} />
              <span>{key.replace(/([A-Z])/g, ' $1')}</span>
            </label>
          ))}
        </aside>
      )}

      {settingsOpen && (
        <aside className="model-popover model-height-panel" aria-label="Building height settings">
          <header>
            <Ruler size={15} />
            <div>
              <strong>Building height settings</strong>
              <small>Canonical mm · concept defaults</small>
            </div>
          </header>
          {([
            ['defaultFloorToFloorHeight', 'Floor-to-floor fallback'],
            ['defaultWallHeight', 'Wall height'],
            ['slabThickness', 'Slab thickness'],
            ['defaultDoorHeight', 'Door height fallback'],
            ['defaultWindowSillHeight', 'Window sill fallback'],
            ['defaultWindowHeight', 'Window height fallback'],
            ['parapetHeight', 'Parapet height'],
          ] as const).map(([key, label]) => (
            <label key={key}>
              <span>
                {label}
                <small>{preferences.heightSettings[key].provenance.replace('_', ' ')}</small>
              </span>
              <div>
                <input
                  type="number"
                  min="1"
                  step="50"
                  value={preferences.heightSettings[key].value}
                  onChange={event =>
                    update('heightSettings', updateParameter(preferences.heightSettings, key, event.target.value))
                  }
                />
                <em>mm</em>
              </div>
            </label>
          ))}
        </aside>
      )}

      <div className="model-north-indicator" style={{ transform: `rotate(${projection.site.northDegrees}deg)` }}>
        <span>N</span>
        <i />
      </div>
      {preferences.layers.labels && (
        <div className="model-datum">
          <Building2 size={14} />
          <span>{selectedLevel?.floorName ?? 'Building stack'}</span>
          <strong>{selectedLevel?.datumLabel ?? '±0.000'}</strong>
        </div>
      )}
    </section>
  );
};

export default ModelWorkspace;

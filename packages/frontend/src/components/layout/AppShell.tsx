import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useEditorStore } from '../../stores/editor-store';
import { TopBar } from './TopBar';
import { ToolPalette } from './ToolPalette';
import { ArchitecturalCanvas } from '../canvas/ArchitecturalCanvas';
import { PropertyInspector } from '../inspector/PropertyInspector';
import { StatusBar } from './StatusBar';
import { NewProjectModal } from '../modals/NewProjectModal';
import { ExportModal } from '../modals/ExportModal';
import { AIDesignModal } from '../ai-design/AIDesignModal';
import { AIEditPanel } from '../ai-edit/AIEditPanel';
import { DesignDiagnosticsPanel } from '../diagnostics/DesignDiagnosticsPanel';
import { BarChart3, Box, DraftingCompass, SlidersHorizontal } from 'lucide-react';
import { BuildingNavigator, type WorkspaceLayer } from '../workspace/BuildingNavigator';
import { CommandPalette } from '../workspace/CommandPalette';
import { floorSearchKeywords, isEditableKeyboardTarget, type WorkspaceCommand } from '../../services/workspace-commands';
type InspectorView = 'properties' | 'quality';
type WorkspaceView = '2d' | '3d';

const ModelWorkspace = lazy(() => import('../model-3d/ModelWorkspace'));

interface AppShellProps {
  onNewProject: (projectId: string) => void;
  onReviewRequirements: () => void;
  onBackToProjects: () => void;
  onOpenSite: () => void;
}

export const AppShell: React.FC<AppShellProps> = ({ onBackToProjects, onOpenSite, onReviewRequirements, onNewProject }) => {
  const editor = useEditorStore();
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isAIDesignModalOpen, setIsAIDesignModalOpen] = useState(false);
  const [isAIEditPanelOpen, setIsAIEditPanelOpen] = useState(false);
  const [inspectorView, setInspectorView] = useState<InspectorView>('quality');
  const [cursorWorldPos, setCursorWorldPos] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.05);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [navigatorCollapsed, setNavigatorCollapsed] = useState(true);
  const [fitRequest, setFitRequest] = useState(0);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [layers, setLayers] = useState<Record<WorkspaceLayer, boolean>>({ rooms: true, walls: true, openings: true, stairs: true, dimensions: true, grid: true, validation: true, siteZones: true });
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('2d');

  useEffect(() => {
    if (editor.selection) setInspectorView('properties');
  }, [editor.selection]);

  const selectedRoomIds = editor.selections.filter(item => item.entityType === 'room').map(item => item.entityId);
  const workspaceCommands = useMemo<WorkspaceCommand[]>(() => [
    { id: 'tool-select', label: 'Select tool', group: 'Tools', keywords: ['pointer', 'selection'], shortcut: 'V', run: () => editor.setTool('select') },
    { id: 'tool-room', label: 'Add room', group: 'Tools', keywords: ['space', 'draw'], shortcut: 'R', run: () => editor.setTool('add_room') },
    { id: 'tool-door', label: 'Add door', group: 'Tools', keywords: ['opening'], shortcut: 'D', run: () => editor.setTool('add_door') },
    { id: 'tool-window', label: 'Add window', group: 'Tools', keywords: ['opening'], shortcut: 'N', run: () => editor.setTool('add_window') },
    { id: 'tool-measure', label: 'Measure distance', group: 'Tools', keywords: ['dimension', 'ruler'], shortcut: 'M', run: () => editor.setTool('measure') },
    { id: 'tool-wall', label: 'Draw wall', group: 'Tools', keywords: ['wall'], disabled: true, disabledReason: 'Walls are derived from room topology', run: () => undefined },
    ...editor.building.floors.map(floor => ({ id: `floor-${floor.id}`, label: `Go to ${floor.name}`, group: 'Floors' as const, keywords: floorSearchKeywords(floor.level), run: () => editor.switchFloor(floor.id) })),
    { id: 'view-fit', label: 'Fit active floor to view', group: 'Views', keywords: ['fit', 'zoom', 'center'], shortcut: 'F', run: () => setFitRequest(value => value + 1) },
    { id: 'view-grid', label: layers.grid ? 'Hide grid' : 'Show grid', group: 'Views', keywords: ['grid', 'layer'], run: () => setLayers(value => ({ ...value, grid: !value.grid })) },
    { id: 'view-snap', label: snapEnabled ? 'Disable snapping' : 'Enable snapping', group: 'Views', keywords: ['snap', 'grid'], run: () => setSnapEnabled(value => !value) },
    { id: 'selection-clear', label: 'Clear selection', group: 'Selection', keywords: ['escape', 'deselect'], shortcut: 'Esc', disabled: editor.selections.length === 0, run: editor.clearSelection },
    { id: 'selection-lock', label: 'Lock selected rooms for generation', group: 'Selection', keywords: ['lock', 'protect'], disabled: selectedRoomIds.length === 0, run: () => editor.setRoomLocks(selectedRoomIds, true) },
    { id: 'selection-unlock', label: 'Unlock selected rooms for generation', group: 'Selection', keywords: ['unlock', 'variable'], disabled: selectedRoomIds.length === 0, run: () => editor.setRoomLocks(selectedRoomIds, false) },
    { id: 'regen-selected', label: 'Regenerate selected rooms', group: 'Generation', keywords: ['regen', 'refine', 'alternative'], disabled: selectedRoomIds.length === 0, run: () => setInspectorView('properties') },
    { id: 'project-export', label: 'Open export studio', group: 'Project', keywords: ['export', 'pdf', 'svg'], run: () => setIsExportModalOpen(true) },
    { id: 'mode-structure', label: 'Open structural engineering workspace', group: 'Views', keywords: ['structure', 'columns'], disabled: true, disabledReason: 'Structural analysis is not implemented', run: () => undefined },
  ], [editor, layers.grid, selectedRoomIds, snapEnabled]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandPaletteOpen(open => !open); return; }
      if (commandPaletteOpen || isEditableKeyboardTarget(event.target)) return;
      if (event.key === ' ') { event.preventDefault(); editor.setTool('pan'); return; }
      const shortcutTools: Record<string, Parameters<typeof editor.setTool>[0]> = { v: 'select', r: 'add_room', d: 'add_door', n: 'add_window', m: 'measure' };
      const tool = shortcutTools[event.key.toLowerCase()];
      if (tool) { event.preventDefault(); editor.setTool(tool); }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); setFitRequest(value => value + 1); }
    };
    const handleKeyUp = (event: KeyboardEvent) => { if (event.key === ' ' && editor.activeTool === 'pan') editor.setTool('select'); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [commandPaletteOpen, editor]);

  return (
    <div className="app-container">
      {/* 1. Header Navigation */}
      <TopBar
        editor={editor}
        onOpenNewModal={() => setIsNewModalOpen(true)}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        onOpenAIDesignModal={() => setIsAIDesignModalOpen(true)}
        onOpenAIEditPanel={() => setIsAIEditPanelOpen(true)}
        onBackToProjects={onBackToProjects}
        onOpenSite={onOpenSite}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />

      {/* 2. Main CAD Workspace (5-zone layout) */}
      <main className={`workspace-main ${workspaceView === '3d' ? 'model-mode' : ''}`}>
        {/* Left Toolbar */}
        <div className="workspace-left-rail">
          <BuildingNavigator editor={editor} layers={layers} onToggleLayer={layer => setLayers(value => ({ ...value, [layer]: !value[layer] }))} collapsed={navigatorCollapsed} onToggleCollapsed={() => setNavigatorCollapsed(value => !value)} />
          <ToolPalette editor={editor} onOpenCommandPalette={() => setCommandPaletteOpen(true)} />
        </div>

        {/* Center Canvas Viewport */}
        <div className="workspace-view-stage">
          <div className="workspace-view-switch" role="tablist" aria-label="Building representation">
            <button role="tab" aria-selected={workspaceView === '2d'} className={workspaceView === '2d' ? 'active' : ''} onClick={() => setWorkspaceView('2d')}><DraftingCompass size={15} /> 2D Plan</button>
            <button role="tab" aria-selected={workspaceView === '3d'} className={workspaceView === '3d' ? 'active' : ''} onClick={() => setWorkspaceView('3d')}><Box size={15} /> 3D Model</button>
          </div>
          {workspaceView === '2d'
            ? <ArchitecturalCanvas
                editor={editor}
                onCursorMove={setCursorWorldPos}
                onZoomChange={setZoom}
                snapEnabled={snapEnabled}
                layers={layers}
                fitRequest={fitRequest}
              />
            : <Suspense fallback={<div className="model-loading-state"><Box size={30} /><strong>Loading structured 3D projection…</strong><span>Three.js is downloaded only when 3D mode opens.</span></div>}>
                <ModelWorkspace
                  building={editor.building}
                  generationControl={editor.generationControl}
                  onApplyBuilding={editor.applyRefinement}
                  activeFloorId={editor.activeFloor.id}
                  selection={editor.selection}
                  onSelectEntity={editor.selectEntity}
                  onClearSelection={editor.clearSelection}
                  onSwitchFloor={editor.switchFloor}
                />
              </Suspense>}
        </div>

        {/* Right Intelligence Dock */}
        <aside className="inspector-dock" aria-label="Plan inspector">
          <div className="inspector-tabs" role="tablist" aria-label="Inspector views">
            <button
              role="tab"
              aria-selected={inspectorView === 'properties'}
              className={inspectorView === 'properties' ? 'active' : ''}
              onClick={() => setInspectorView('properties')}
            >
              <SlidersHorizontal size={14} /> Properties
            </button>
            <button
              role="tab"
              aria-selected={inspectorView === 'quality'}
              className={inspectorView === 'quality' ? 'active' : ''}
              onClick={() => setInspectorView('quality')}
            >
              <BarChart3 size={14} /> Quality
              {editor.validationSummary.violations.length > 0 && (
                <span className="tab-notification">{editor.validationSummary.violations.length}</span>
              )}
            </button>
          </div>
          <div className="inspector-dock-content">
            {inspectorView === 'properties'
              ? <PropertyInspector editor={editor} embedded />
              : <DesignDiagnosticsPanel editor={editor} />}
          </div>
        </aside>
      </main>

      {/* 3. Bottom Status Bar */}
      <StatusBar
        editor={editor}
        cursorWorldPos={cursorWorldPos}
        zoom={zoom}
        snapEnabled={snapEnabled}
        selectionCount={editor.selections.length}
        onToggleSnap={() => setSnapEnabled(value => !value)}
        onOpenQuality={() => setInspectorView('quality')}
      />

      {/* Dialog Modals */}
      <NewProjectModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onSelectBuilding={(building, name, category) => { editor.setBuilding(building, name, {}, category); onNewProject(building.projectId); }}
      />

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        building={editor.building}
        floor={editor.activeFloor}
        validationSummary={editor.validationSummary}
      />

      {/* AI design requirements and candidate-generation modal */}
      <AIDesignModal
        onReviewRequirements={() => { editor.saveProject(); onReviewRequirements(); }}
        building={editor.building}
        isOpen={isAIDesignModalOpen}
        onClose={() => setIsAIDesignModalOpen(false)}
        onSelectCandidate={(cand) => {
          editor.setBuilding(cand.building, cand.name, cand.requiredRoomCounts);
        }}
      />

      <AIEditPanel
        isOpen={isAIEditPanelOpen}
        onClose={() => setIsAIEditPanelOpen(false)}
        editor={editor}
      />
      <CommandPalette open={commandPaletteOpen} commands={workspaceCommands} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
};

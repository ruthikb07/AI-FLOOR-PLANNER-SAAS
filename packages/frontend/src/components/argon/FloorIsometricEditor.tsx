import React, { useMemo, useState, useRef } from 'react';
import * as THREE from 'three';
import {
  Layers,
  Box,
  Compass,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import type { EditorContextValue } from '../../stores/editor-store';
import { ArchitecturalCanvas } from '../canvas/ArchitecturalCanvas';
import { ThreeBuildingScene, type BuildingLightingMode } from '../model-3d/ThreeBuildingScene';
import { Building3DProjector, type ProjectionSource } from '@ai-floor-planner/projection-3d';
import {
  projectionSourceToSelection,
  type ModelLayerVisibility,
} from '../../services/projection-preferences';

interface FloorIsometricEditorProps {
  editor: EditorContextValue;
  lightingMode?: BuildingLightingMode;
}

export const FloorIsometricEditor: React.FC<FloorIsometricEditorProps> = ({
  editor,
  lightingMode = 'golden',
}) => {
  const [viewMode, setViewMode] = useState<'3d_iso' | '2d_plan'>('3d_iso');
  const [fitRequest, setFitRequest] = useState(0);
  const sceneRef = useRef<THREE.Scene | null>(null);

  const projector = useMemo(() => new Building3DProjector(), []);
  const projection = useMemo(
    () => projector.project(editor.building),
    [editor.building, projector]
  );

  const isoLayers = useMemo<ModelLayerVisibility>(
    () => ({
      floorPlates: true,
      walls: true,
      rooms: true,
      openings: true,
      stairs: true,
      site: false,
      labels: true,
    }),
    []
  );

  const floors = editor.building.floors;
  const activeFloor = editor.activeFloor;

  const handleSelect3D = (source: ProjectionSource) => {
    const mapped = projectionSourceToSelection(source);
    if (!mapped) return;
    if (mapped.floorId !== editor.activeFloor.id) {
      editor.switchFloor(mapped.floorId);
    }
    editor.selectEntity(mapped.entityType, mapped.entityId, mapped.floorId);
  };

  const getElevationLabel = (floor: (typeof floors)[number]) => {
    const heightMm = floor.floorHeight ?? 3000;
    const elevationM = ((floor.level * heightMm) / 1000).toFixed(2);
    return `+${elevationM}m`;
  };

  return (
    <div
      data-testid="floor-isometric-editor"
      className="w-full h-full min-h-0 bg-argon-bg text-argon-text flex flex-col overflow-hidden"
    >
      {/* Top Per-Floor Selector Header Bar */}
      <div className="bg-argon-surface border-b border-argon-border px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between flex-shrink-0 gap-3">
        <div className="flex min-w-0 max-w-full items-center gap-3 overflow-x-auto py-1">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-argon-btn mr-1 flex items-center gap-1.5 whitespace-nowrap">
            <Layers className="w-4 h-4 text-argon-btn" />
            <span>FLOOR 3D · CUTAWAY:</span>
          </span>

          <div
            data-testid="floor-selector-group"
            className="flex items-center gap-1.5"
          >
            {floors.map((floor) => {
              const isActive = floor.id === activeFloor.id;
              const elevLabel = getElevationLabel(floor);
              return (
                <button
                  key={floor.id}
                  data-testid={`floor-btn-${floor.id}`}
                  onClick={() => editor.switchFloor(floor.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-argon-btn text-argon-card font-bold shadow-xs'
                      : 'bg-argon-card text-argon-text border border-argon-border hover:bg-argon-surface'
                  }`}
                >
                  <span>{floor.name}</span>
                  <span className={`text-[10px] ${isActive ? 'opacity-90 font-bold' : 'text-argon-muted'}`}>
                    ({elevLabel})
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* View Mode Controls: 3D Isometric Isolated vs 2D Drafting Plan */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="flex items-center bg-argon-card p-1 rounded-xl border border-argon-border">
            <button
              data-testid="toggle-view-3d"
              onClick={() => setViewMode('3d_iso')}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === '3d_iso'
                  ? 'bg-argon-btn text-argon-card font-bold shadow'
                  : 'text-argon-muted hover:text-argon-text'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              <span>3D Cutaway</span>
            </button>
            <button
              data-testid="toggle-view-2d"
              onClick={() => setViewMode('2d_plan')}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === '2d_plan'
                  ? 'bg-argon-btn text-argon-card font-bold shadow'
                  : 'text-argon-muted hover:text-argon-text'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>2D Technical Plan</span>
            </button>
          </div>

          {viewMode === '3d_iso' && (
            <button
              onClick={() => setFitRequest((v) => v + 1)}
              title="Reset Isometric Camera Fit"
              className="px-2.5 py-1.5 rounded-lg bg-argon-card border border-argon-border hover:bg-argon-surface text-argon-text text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-argon-btn" />
              <span>Fit</span>
            </button>
          )}

          <div className="text-[11px] font-mono text-argon-muted bg-argon-card px-3 py-1.5 rounded-lg border border-argon-border hidden md:flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-argon-pass" />
            <span>Isolated Plate · Upper Floors Suppressed</span>
          </div>
        </div>
      </div>

      {/* Main Viewport Area */}
      <div className="flex-1 relative flex flex-col min-w-0 min-h-0 model-workspace">
        <div className="pointer-events-none absolute top-3 left-3 z-20 flex items-center gap-2 rounded-lg border border-argon-border bg-argon-card px-3 py-1.5 text-xs font-mono shadow-sm backdrop-blur">
          <span data-testid="active-floor-name" className="font-semibold text-argon-text">
            {activeFloor.name}
          </span>
          <span data-testid="active-floor-elevation" className="text-argon-muted">
            {getElevationLabel(activeFloor)}
          </span>
        </div>
        {viewMode === '3d_iso' ? (
          <div data-testid="isometric-3d-viewport" className="w-full h-full relative">
            <ThreeBuildingScene
              projection={projection}
              activeFloorId={activeFloor.id}
              selection={editor.selection}
              viewMode="solid"
              cameraPreset="isometric"
              floorMode="isolate"
              exploded={false}
              lightingMode={lightingMode}
              materialPalette="travertine"
              layers={isoLayers}
              fitRequest={fitRequest}
              fitSite={false}
              onSelect={handleSelect3D}
              onClearSelection={() => editor.clearSelection()}
              sceneRef={sceneRef}
            />
          </div>
        ) : (
          <div data-testid="drafting-2d-viewport" className="w-full h-full relative">
            <ArchitecturalCanvas
              editor={editor}
              onCursorMove={() => {}}
              onZoomChange={() => {}}
              snapEnabled={true}
              layers={{
                rooms: true,
                walls: true,
                openings: true,
                stairs: true,
                dimensions: true,
                grid: true,
                validation: true,
                siteZones: true,
              }}
              fitRequest={fitRequest}
            />
          </div>
        )}
      </div>
    </div>
  );
};

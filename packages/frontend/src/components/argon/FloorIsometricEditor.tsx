import React, { useMemo, useState, useRef, useEffect } from 'react';
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
import { ThreeBuildingScene } from '../model-3d/ThreeBuildingScene';
import { Building3DProjector, type ProjectionSource } from '@ai-floor-planner/projection-3d';
import {
  projectionSourceToSelection,
  type ModelLayerVisibility,
} from '../../services/projection-preferences';
import { FLOOR_ISOMETRIC_BLUEPRINT_CONFIG } from '../../views/animations/FloorIsometricSceneConfig';

interface FloorIsometricEditorProps {
  editor: EditorContextValue;
}

export const FloorIsometricEditor: React.FC<FloorIsometricEditorProps> = ({
  editor,
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

  // Apply BlueprintLines animation when scene is ready
  useEffect(() => {
    if (sceneRef.current) {
      const config = FLOOR_ISOMETRIC_BLUEPRINT_CONFIG.blueprintLines;
      if (!config.enabled) return;

      const lineGroup = new THREE.Group();
      lineGroup.name = 'blueprint-lines';
      sceneRef.current.add(lineGroup);

      const segmentCount = 12;

      for (let i = 0; i < segmentCount; i++) {
        const angle = (i / segmentCount) * Math.PI * 2;
        const radius = 6 + Math.random() * 2;

        const geometry = new THREE.RingGeometry(2, 2.2, 64);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(
          radius * Math.cos(angle),
          0.02,
          radius * Math.sin(angle)
        );

        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(config.color),
          transparent: true,
          opacity: config.opacity,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });

        const ring = new THREE.Points(geometry, material);
        ring.rotation.y = angle;
        ring.position.x = Math.cos(angle) * 6;
        ring.position.z = Math.sin(angle) * 6;
        lineGroup.add(ring);
      }

      // Animation loop
      let animationTime = 0;
      const animate = () => {
        animationTime += 16; // approx 60fps
        lineGroup.rotation.y = (animationTime % 2000) / 2000 * Math.PI * 2;
        requestAnimationFrame(animate);
      };
      animate();
    }
  }, [sceneRef.current]);

  return (
    <div
      data-testid="floor-isometric-editor"
      className="w-full h-[calc(100vh-3.5rem)] bg-slate-950 text-slate-100 flex flex-col overflow-hidden"
    >
      {/* Top Per-Floor Selector Header Bar */}
      <div className="h-14 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between flex-shrink-0 gap-4">
        <div className="flex items-center gap-3 overflow-x-auto custom-scrollbar py-1">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-amber-400 mr-1 flex items-center gap-1.5 whitespace-nowrap">
            <Layers className="w-4 h-4 text-amber-400" />
            <span>FLOOR ISOMETRIC:</span>
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
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                    isActive
                      ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20'
                      : 'bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  <span>{floor.name}</span>
                  <span className={`text-[10px] ${isActive ? 'text-slate-900/80 font-bold' : 'text-slate-500'}`}>
                    ({elevLabel})
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* View Mode Controls: 3D Isometric Isolated vs 2D Drafting Plan */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            data-testid="toggle-view-3d"
            onClick={() => setViewMode('3d_iso')}
            className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold flex items-center gap-1.5 transition-all ${
              viewMode === '3d_iso'
                ? 'bg-amber-500 text-slate-950 font-bold shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Box className="w-3.5 h-3.5" />
            <span>3D Isometric</span>
          </button>
          <button
            data-testid="toggle-view-2d"
            onClick={() => setViewMode('2d_plan')}
            className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold flex items-center gap-1.5 transition-all ${
              viewMode === '2d_plan'
                ? 'bg-amber-500 text-slate-950 font-bold shadow'
                : 'text-slate-400 hover:text-slate-200'
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
            className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-300 text-xs font-mono flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
            <span>Fit</span>
          </button>
        )}

        <div className="text-[11px] font-mono text-slate-400 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 hidden md:flex items-center gap-1.5">
          <Compass className="w-3.5 h-3.5 text-emerald-400" />
          <span>Isolated Plate · Upper Floors Suppressed</span>
        </div>
      </div>

      {/* Main Viewport Area */}
      <div className="flex-1 relative bg-slate-950 flex flex-col min-w-0">
        {viewMode === '3d_iso' ? (
          <div
            data-testid="isometric-3d-viewport"
            className="w-full h-full relative"
          >
            <ThreeBuildingScene
              projection={projection}
              activeFloorId={activeFloor.id}
              selection={editor.selection}
              viewMode="solid"
              cameraPreset="isometric"
              floorMode="isolate"
              exploded={false}
              layers={isoLayers}
              fitRequest={fitRequest}
              fitSite={false}
              onSelect={handleSelect3D}
              onClearSelection={() => editor.clearSelection()}
              sceneRef={sceneRef}
            />
          </div>
        ) : (
          <div
            data-testid="drafting-2d-viewport"
            className="w-full h-full relative"
          >
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

        {/* Floating Floor Info Badge */}
        <div
          data-testid="floor-info-badge"
          className="absolute top-4 left-4 z-20 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-4 shadow-xl text-xs space-y-1 pointer-events-none"
        >
          <div className="font-mono font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>ACTIVE ISOMETRIC PLATE</span>
          </div>
          <div
            data-testid="active-floor-name"
            className="text-sm font-bold text-slate-100"
          >
            {activeFloor.name}
          </div>
          <div
            data-testid="active-floor-elevation"
            className="text-slate-400 font-mono"
          >
            Slab Level: {getElevationLabel(activeFloor)} (Level {activeFloor.level})
          </div>
          <div className="text-[11px] text-slate-500 font-mono pt-1 border-t border-slate-800/80">
            {activeFloor.rooms.length} Rooms · {activeFloor.walls.length} Walls ·{' '}
            {activeFloor.doors.length + activeFloor.windows.length} Openings
          </div>
        </div>
      </div>
    </div>
  );
};
export default FloorIsometricEditor;
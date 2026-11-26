import React, { lazy, Suspense, useState, useMemo, useRef } from 'react';
import { architecturePhotos, photoUrl } from '../studio/architecture-photos';
import {
  Box,
  Sun,
  Moon,
  Sunset,
  Layers,
  Home,
  Bed,
  DoorOpen,
  Maximize,
  Layout,
  Armchair,
  CheckCircle2,
  ChevronRight,
  Palette,
} from 'lucide-react';
import * as THREE from 'three';
import type { EditorContextValue } from '../../stores/editor-store';
import {
  UpdateWindowPropertiesCommand,
  UpdateDoorPropertiesCommand,
  BatchCommand,
  type GalleryCoordinationMode,
  type OpeningStyleId,
  type IEditorCommand,
} from '@ai-floor-planner/core';
import { coordinateBuildingFacade } from '@ai-floor-planner/planning-engine';
import { FurniturePlacementControls } from './FurniturePlacementControls';
import { use3DAnimation } from '../../hooks/use3dAnimations';
import {
  ALL_FURNITURE_CATEGORY_IDS,
  type ArchitecturalMaterialPalette,
  type BuildingLightingMode,
  type FurnitureCategoryId,
  type OpeningFinishOverride,
} from '../model-3d/ThreeBuildingScene';

const ModelWorkspace = lazy(() => import('../model-3d/ModelWorkspace'));

interface Building3DCustomizerProps {
  editor: EditorContextValue;
  lightingMode?: BuildingLightingMode;
  onLightingModeChange?: (mode: BuildingLightingMode) => void;
  onGalleryCoordinationModeChange?: (mode: GalleryCoordinationMode) => void;
}

interface FixtureOption {
  readonly id: string;
  readonly label: string;
  readonly type: 'window' | 'door';
  readonly styleId: OpeningStyleId;
  readonly materialId: string;
  readonly icon: React.ReactNode;
  readonly description: string;
}

interface FurnitureOption {
  readonly id: FurnitureCategoryId;
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly category: string;
  readonly clearanceNote: string;
}

export const Building3DCustomizer: React.FC<Building3DCustomizerProps> = ({
  editor,
  lightingMode: controlledLightingMode,
  onLightingModeChange,
  onGalleryCoordinationModeChange,
}) => {
  const [explodeValue, setExplodeValue] = useState(0);
  const [localLightingMode, setLocalLightingMode] = useState<BuildingLightingMode>(controlledLightingMode ?? 'golden');
  const lightingMode = controlledLightingMode ?? localLightingMode;
  const setLightingMode = (mode: BuildingLightingMode) => {
    setLocalLightingMode(mode);
    onLightingModeChange?.(mode);
  };
  const [materialPalette, setMaterialPalette] = useState<ArchitecturalMaterialPalette>('travertine');
  const [openingFinish, setOpeningFinish] = useState<OpeningFinishOverride>({});
  const [enabledFurniture, setEnabledFurniture] = useState<readonly FurnitureCategoryId[]>(
    () => [...ALL_FURNITURE_CATEGORY_IDS],
  );
  const [interiorCutawayActive, setInteriorCutawayActive] = useState(false);
  const [linkedSpanStoreys, setLinkedSpanStoreys] = useState<1 | 2 | 3>(1);
  const [customizerTab, setCustomizerTab] = useState<'fixtures' | 'furniture'>('fixtures');
  const [selectedFixtureId, setSelectedFixtureId] = useState<string>('sliding_aluminum_win');
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');
  const sceneRef = useRef<THREE.Scene | null>(null);

  const fixtureFinishMap: Record<string, OpeningFinishOverride> = {
    sliding_aluminum_win: { frameColorHex: 0x262c36, glassColorHex: 0x5282a6, glassOpacity: 0.56 },
    casement_timber_win: { frameColorHex: 0x9b6236, glassColorHex: 0x5f8fa8, glassOpacity: 0.52 },
    fixed_structural_glass: { frameColorHex: 0x181e26, glassColorHex: 0x3b86b8, glassOpacity: 0.64 },
    solid_core_main_door: { doorColorHex: 0x6b3a1e },
    internal_flush_door: { doorColorHex: 0xd8cec0 },
  };

  const activeGalleryMode: GalleryCoordinationMode =
    editor.building.metadata?.facadeCoordination?.galleryCoordinationMode ??
    editor.building.metadata?.generationBrief?.galleryCoordinationMode ??
    (editor.building.metadata?.generationBrief?.staggeredBalconies === false
      ? 'STACKED_RIBBON'
      : 'DOUBLE_HEIGHT_STAGGER');

  const handleGalleryModeSwitch = (mode: GalleryCoordinationMode) => {
    if (onGalleryCoordinationModeChange) {
      onGalleryCoordinationModeChange(mode);
    } else {
      const updated = coordinateBuildingFacade(editor.building, { galleryCoordinationMode: mode });
      editor.applyRefinement(
        { ...updated, version: editor.building.version + 1 },
        `Switch facade gallery rhythm to ${mode}`,
      );
    }
    setFeedbackMessage(
      mode === 'DOUBLE_HEIGHT_STAGGER'
        ? 'Applied Double-Height Stagger (6,300 mm alternating sky-decks)'
        : 'Applied Stacked Ribbon (vertically aligned continuous galleries)',
    );
  };

  // Disable continuous particle loop so idle GPU stays at 0% (60fps on-demand rendering)
  use3DAnimation(sceneRef, {
    particles: { enabled: false },
    explosion: { enabled: false },
  });

  const fixtureOptions: readonly FixtureOption[] = useMemo(
    () => [
      {
        id: 'sliding_aluminum_win',
        label: 'Sliding Aluminum Windows',
        type: 'window',
        styleId: 'SLIDING_UPVC',
        materialId: 'mat_aluminum_anodized_dark',
        icon: <Maximize className="w-4 h-4" />,
        description: 'Thermal-break dark aluminum sliding profile',
      },
      {
        id: 'casement_timber_win',
        label: 'Casement Timber Windows',
        type: 'window',
        styleId: 'CASEMENT_ALUMINUM',
        materialId: 'mat_teak_timber_clear',
        icon: <Maximize className="w-4 h-4" />,
        description: 'Architectural casement profile with timber grain finish',
      },
      {
        id: 'fixed_structural_glass',
        label: 'Fixed Structural Glass',
        type: 'window',
        styleId: 'FIXED_GLAZING',
        materialId: 'mat_glass_low_e',
        icon: <Maximize className="w-4 h-4" />,
        description: 'Frameless acoustic low-E fixed vision glazing',
      },
      {
        id: 'solid_core_main_door',
        label: 'Solid Core Main Door',
        type: 'door',
        styleId: 'FLUSH_TIMBER',
        materialId: 'mat_teak_hardwood_solid',
        icon: <DoorOpen className="w-4 h-4" />,
        description: 'Heavy solid core acoustic timber door profile',
      },
      {
        id: 'internal_flush_door',
        label: 'Internal Flush Doors',
        type: 'door',
        styleId: 'FLUSH_TIMBER',
        materialId: 'mat_engineered_flush_white',
        icon: <DoorOpen className="w-4 h-4" />,
        description: 'Engineered lightweight internal flush swing door',
      },
    ],
    []
  );

  const furnitureOptions: readonly FurnitureOption[] = useMemo(
    () => [
      { id: 'bed_master', label: 'King / Queen Bed Suites', icon: <Bed className="w-4 h-4" />, category: 'A-FURN Bed', clearanceNote: 'Bedroom display' },
      { id: 'sofa_living', label: 'L-Sectional Living Seating', icon: <Armchair className="w-4 h-4" />, category: 'A-FURN Seating', clearanceNote: 'Living room display' },
      { id: 'dining_set', label: '6-Seat Timber Dining Suite', icon: <Layout className="w-4 h-4" />, category: 'A-FURN Dining', clearanceNote: 'Proportional to dining zone' },
      { id: 'wardrobe_full', label: 'Full-Height Joinery Wardrobes', icon: <Layers className="w-4 h-4" />, category: 'A-FURN Storage', clearanceNote: '550 mm flush perimeter joinery' },
      { id: 'kitchen_modular', label: 'Modular Stone Counter & Casework', icon: <Home className="w-4 h-4" />, category: 'A-FURN Casework', clearanceNote: '600 mm counter depth' },
      { id: 'bath_fixtures', label: 'Vitreous Ceramic Bath Fixtures', icon: <Home className="w-4 h-4" />, category: 'P-FIXT Plumbing', clearanceNote: 'Bathroom display' },
    ],
    []
  );

  const toggleFurnitureCategory = (id: FurnitureCategoryId, label: string) => {
    setEnabledFurniture(prev => {
      const exists = prev.includes(id);
      const next = exists ? prev.filter(item => item !== id) : [...prev, id];
      setInteriorCutawayActive(true);
      setFeedbackMessage(
        `${exists ? 'Hidden' : 'Enabled'} ${label} in 3D interior cutaway (${next.length}/${ALL_FURNITURE_CATEGORY_IDS.length} categories active).`,
      );
      return next;
    });
  };

  const applyFixtureToSelectionOrFloor = (fixture: FixtureOption) => {
    setSelectedFixtureId(fixture.id);
    const visualDelta = fixtureFinishMap[fixture.id];
    if (visualDelta) {
      setOpeningFinish((prev) => ({ ...prev, ...visualDelta }));
    }
    const selection = editor.selection;

    if (selection && selection.entityType === fixture.type) {
      if (fixture.type === 'window') {
        editor.executeCommand(
          new UpdateWindowPropertiesCommand(selection.entityId, {
            styleId: fixture.styleId,
            materialId: fixture.materialId,
          })
        );
        setFeedbackMessage(`Updated selected window to ${fixture.label}`);
        return;
      } else if (fixture.type === 'door') {
        editor.executeCommand(
          new UpdateDoorPropertiesCommand(selection.entityId, {
            styleId: fixture.styleId,
            materialId: fixture.materialId,
          })
        );
        setFeedbackMessage(`Updated selected door to ${fixture.label}`);
        return;
      }
    }

    const activeFloor = editor.activeFloor;
    if (fixture.type === 'window') {
      const windows = activeFloor.windows;
      if (!windows.length) {
        setFeedbackMessage(`Active floor (${activeFloor.name}) has no windows to update.`);
        return;
      }
      const commands = windows.map(
        (win) =>
          new UpdateWindowPropertiesCommand(win.id, {
            styleId: fixture.styleId,
            materialId: fixture.materialId,
          })
      );
      editor.executeCommand(
        new BatchCommand(
          `Apply ${fixture.label} to ${activeFloor.name} (${commands.length} windows)`,
          commands
        )
      );
      setFeedbackMessage(
        `Applied ${fixture.label} to ${commands.length} window(s) on ${activeFloor.name}`
      );
    } else {
      const doors = activeFloor.doors;
      if (!doors.length) {
        setFeedbackMessage(`Active floor (${activeFloor.name}) has no doors to update.`);
        return;
      }
      const commands = doors.map(
        (door) =>
          new UpdateDoorPropertiesCommand(door.id, {
            styleId: fixture.styleId,
            materialId: fixture.materialId,
          })
      );
      editor.executeCommand(
        new BatchCommand(
          `Apply ${fixture.label} to ${activeFloor.name} (${commands.length} doors)`,
          commands
        )
      );
      setFeedbackMessage(
        `Applied ${fixture.label} to ${commands.length} door(s) on ${activeFloor.name}`
      );
    }
  };

  const applyGlobal3DSkin = () => {
    const defaultFixture = fixtureOptions[0]!;
    const selectedFixture =
      fixtureOptions.find((f) => f.id === selectedFixtureId) ?? defaultFixture;
    const visualDelta = fixtureFinishMap[selectedFixture.id];
    if (visualDelta) {
      setOpeningFinish((prev) => ({ ...prev, ...visualDelta }));
    }
    const commands: IEditorCommand[] = [];

    editor.building.floors.forEach((floor) => {
      floor.windows.forEach((win) => {
        commands.push(
          new UpdateWindowPropertiesCommand(win.id, {
            styleId: selectedFixture.type === 'window' ? selectedFixture.styleId : 'SLIDING_UPVC',
            materialId:
              selectedFixture.type === 'window'
                ? selectedFixture.materialId
                : 'mat_aluminum_anodized_dark',
          })
        );
      });
      floor.doors.forEach((door) => {
        commands.push(
          new UpdateDoorPropertiesCommand(door.id, {
            styleId: selectedFixture.type === 'door' ? selectedFixture.styleId : 'FLUSH_TIMBER',
            materialId:
              selectedFixture.type === 'door'
                ? selectedFixture.materialId
                : 'mat_teak_hardwood_solid',
          })
        );
      });
    });

    if (commands.length === 0) {
      setFeedbackMessage('Building contains no door or window openings to style.');
      return;
    }

    editor.executeCommand(
      new BatchCommand(
        `Apply Global 3D Skin (${selectedFixture.label}) across entire building`,
        commands
      )
    );
    setFeedbackMessage(
      `Global skin applied: updated ${commands.length} opening(s) across ${editor.building.floors.length} floor(s).`
    );
  };

  const isNight = lightingMode === 'night';

  return (
    <div
      data-testid="building-3d-customizer"
      className={`rh-3d-split-shell transition-colors ${isNight ? 'bg-slate-950 text-slate-100' : 'bg-argon-bg text-argon-text'
        }`}
    >
      {/* Left Column: Full Interactive 3D Viewport (1fr, min-height 520px) */}
      <main className="rh-3d-split-canvas-col">
        <Suspense
          fallback={
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-argon-muted">
              <Box className="w-12 h-12 animate-pulse text-argon-btn" />
              <div className="text-sm font-mono uppercase tracking-widest">
                Initializing 3D Building Core...
              </div>
            </div>
          }
        >
          <ModelWorkspace
            building={editor.building}
            generationControl={editor.generationControl}
            onApplyBuilding={editor.applyRefinement}
            activeFloorId={editor.activeFloor.id}
            selection={editor.selection}
            onSelectEntity={editor.selectEntity}
            onClearSelection={editor.clearSelection}
            onSwitchFloor={editor.switchFloor}
            explodeValue={explodeValue}
            onExplodeChange={setExplodeValue}
            lightingMode={lightingMode}
            onLightingModeChange={setLightingMode}
            materialPalette={materialPalette}
            onMaterialPaletteChange={setMaterialPalette}
            openingFinish={openingFinish}
            enabledFurnitureCategories={enabledFurniture}
            forceInteriorCutaway={interiorCutawayActive}
            linkedSpanStoreys={linkedSpanStoreys}
            onLinkedSpanChange={setLinkedSpanStoreys}
            sceneRef={sceneRef}
          />
        </Suspense>

        {/* Top-right Explode & Lighting Controls (clear of bottom floor selector) */}
        <div
          data-testid="hud-controls"
          className={`hidden sm:flex absolute top-3 right-3 z-20 items-center gap-4 px-4 py-2 rounded-2xl border shadow-xl backdrop-blur-xl ${isNight
            ? 'bg-slate-900/90 border-slate-800 text-slate-100'
            : 'bg-[#FFFDF9]/92 border-[#D8CAB8] text-[#221D18]'
            }`}
        >
          <div className="flex flex-col gap-1 min-w-[150px]">
            <div className="flex items-center justify-between">
              <label
                htmlFor="explode-slider"
                className="text-[10px] font-mono font-bold text-[#8B6843] uppercase tracking-wider"
              >
                EXPLODE
              </label>
              <span data-testid="explode-value-label" className="text-[10px] font-mono opacity-75">
                {explodeValue}%
              </span>
            </div>
            <input
              id="explode-slider"
              data-testid="explode-slider"
              type="range"
              min="0"
              max="100"
              value={explodeValue}
              onChange={(e) => setExplodeValue(Number(e.target.value))}
              className="w-full h-1.5 rounded-lg cursor-pointer"
            />
          </div>

          <div className={`w-px h-8 ${isNight ? 'bg-slate-800' : 'bg-[#D8CAB8]'}`} />

          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-mono font-bold text-[#8B6843] uppercase tracking-wider">
              LIGHTING
            </span>
            <div className="flex items-center gap-1 p-0.5 rounded-xl border border-current/15">
              <button
                data-testid="btn-lighting-day"
                aria-pressed={lightingMode === 'day'}
                onClick={() => setLightingMode('day')}
                className={`px-2 py-1 rounded-lg flex items-center gap-1 transition-all cursor-pointer ${lightingMode === 'day'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'opacity-65 hover:opacity-100'
                  }`}
              >
                <Sun className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold">DAY</span>
              </button>
              <button
                data-testid="btn-lighting-golden"
                aria-pressed={lightingMode === 'golden'}
                onClick={() => setLightingMode('golden')}
                className={`px-2 py-1 rounded-lg flex items-center gap-1 transition-all cursor-pointer ${lightingMode === 'golden'
                  ? 'bg-orange-500 text-white font-bold shadow'
                  : 'opacity-65 hover:opacity-100'
                  }`}
              >
                <Sunset className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold">SUNSET</span>
              </button>
              <button
                data-testid="btn-lighting-night"
                aria-pressed={lightingMode === 'night'}
                onClick={() => setLightingMode('night')}
                className={`px-2 py-1 rounded-lg flex items-center gap-1 transition-all cursor-pointer ${lightingMode === 'night'
                  ? 'bg-indigo-500 text-white font-bold shadow'
                  : 'opacity-65 hover:opacity-100'
                  }`}
              >
                <Moon className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold">NIGHT</span>
              </button>
            </div>
          </div>
        </div>

      </main>

      {/* Right Column: Constrained 380px Element Customizer Sidebar (strictly zero horizontal overflow) */}
      <aside
        data-testid="element-customizer-sidebar"
        className={`rh-3d-split-sidebar-col flex flex-col shadow-lg overflow-x-hidden ${isNight ? 'bg-slate-900 border-slate-800' : 'bg-argon-card border-argon-border'
          }`}
      >
        <div className="px-3.5 py-3 border-b border-slate-700/80 bg-[#0D1320] text-[#F8FAFC] min-w-0">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400">
            3D VISUALIZER
          </span>
          <h3 className="font-display text-xl font-semibold mt-0.5 truncate text-[#F8FAFC]">Finishes &amp; openings</h3>
          <p className="text-[11px] text-slate-300 font-mono mt-0.5 leading-snug">
            Instant PBR finish hot-swap without rebuilding geometry.
          </p>
        </div>

        <details className="rh-finish-reference">
          <summary>Built façade reference</summary>
          <figure>
            <img src={photoUrl(architecturePhotos.facade)} alt={architecturePhotos.facade.alt} loading="lazy" />
            <figcaption><a href={architecturePhotos.facade.source} target="_blank" rel="noreferrer">{architecturePhotos.facade.title} · {architecturePhotos.facade.credit}</a></figcaption>
          </figure>
        </details>

        {/* Gallery Rhythm Switcher (Double-Height Stagger vs Stacked Ribbon) */}
        <div className={`px-3.5 py-2.5 border-b min-w-0 ${isNight ? 'border-slate-800' : 'border-argon-border/70'}`}>
          <div className="flex items-center justify-between gap-1 text-[10px] font-mono font-bold uppercase tracking-wider text-argon-btn mb-1.5">
            <span className="flex items-center gap-1 min-w-0 truncate"><Layers className="w-3.5 h-3.5 shrink-0" /> Gallery Rhythm</span>
            <span className="text-[9px] opacity-75 shrink-0">2,100 mm Lock</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Tower 3D Gallery Coordination Mode">
            <button
              type="button"
              data-testid="tower-gallery-stagger"
              aria-pressed={activeGalleryMode === 'DOUBLE_HEIGHT_STAGGER'}
              onClick={() => handleGalleryModeSwitch('DOUBLE_HEIGHT_STAGGER')}
              className={`py-1.5 px-1.5 rounded-lg text-[10.5px] font-mono border cursor-pointer transition-colors truncate ${activeGalleryMode === 'DOUBLE_HEIGHT_STAGGER'
                ? 'bg-argon-btn text-white border-argon-btn font-bold'
                : 'border-argon-border opacity-80 hover:opacity-100'
                }`}
            >
              Double-Height
            </button>
            <button
              type="button"
              data-testid="tower-gallery-stacked"
              aria-pressed={activeGalleryMode === 'STACKED_RIBBON'}
              onClick={() => handleGalleryModeSwitch('STACKED_RIBBON')}
              className={`py-1.5 px-1.5 rounded-lg text-[10.5px] font-mono border cursor-pointer transition-colors truncate ${activeGalleryMode === 'STACKED_RIBBON'
                ? 'bg-argon-btn text-white border-argon-btn font-bold'
                : 'border-argon-border opacity-80 hover:opacity-100'
                }`}
            >
              Stacked Ribbon
            </button>
          </div>
        </div>

        {/* Material / Texture Finish Swapper */}
        <div className={`px-3.5 py-2.5 border-b min-w-0 ${isNight ? 'border-slate-800' : 'border-argon-border/70'}`}>
          <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-argon-btn mb-1.5">
            <Palette className="w-3.5 h-3.5 shrink-0" /> PRIMARY WALL MATERIAL
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {([
              ['travertine', 'Travertine', '#EAE5DC'],
              ['concrete', 'Concrete', '#C7CFD9'],
              ['coastal', 'Coastal', '#F4EAD8'],
            ] as const).map(([id, label, swatch]) => (
              <button
                key={id}
                type="button"
                data-testid={`sidebar-material-${id}`}
                aria-pressed={materialPalette === id}
                onClick={() => {
                  setMaterialPalette(id);
                  setFeedbackMessage(`Applied ${label} architectural PBR finish`);
                }}
                className={`py-1.5 px-1.5 rounded-lg text-[10.5px] font-mono border cursor-pointer transition-colors flex items-center justify-center gap-1 min-w-0 ${materialPalette === id
                  ? 'bg-argon-btn text-white border-argon-btn font-bold'
                  : 'border-argon-border opacity-85 hover:opacity-100'
                  }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full border border-black/30 shrink-0"
                  style={{ backgroundColor: swatch }}
                />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="px-3 py-2.5 grid grid-cols-2 gap-1.5 min-w-0">
          <button
            data-testid="tab-fixtures"
            onClick={() => setCustomizerTab('fixtures')}
            className={`py-2 px-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer truncate ${customizerTab === 'fixtures'
              ? 'bg-argon-btn text-argon-card shadow-xs'
              : 'border border-argon-border opacity-75'
              }`}
          >
            FIXTURES (ACTIVE)
          </button>
          <button
            data-testid="tab-furniture"
            onClick={() => setCustomizerTab('furniture')}
            className={`py-2 px-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer truncate ${customizerTab === 'furniture'
              ? 'bg-argon-btn text-argon-card shadow-xs'
              : 'border border-argon-border opacity-75'
              }`}
          >
            FURNITURE
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-3.5 py-2 space-y-2 min-w-0">
          {customizerTab === 'fixtures' ? (
            <div data-testid="fixtures-list" className="space-y-2">
              {fixtureOptions.map((opt) => {
                const isSelected = selectedFixtureId === opt.id;
                return (
                  <button
                    key={opt.id}
                    data-testid={`fixture-opt-${opt.id}`}
                    onClick={() => applyFixtureToSelectionOrFloor(opt)}
                    className={`w-full p-3 rounded-xl border flex items-start gap-2.5 text-left transition-all cursor-pointer ${isSelected
                      ? 'border-argon-btn bg-argon-btn/10'
                      : 'border-argon-border hover:bg-argon-surface/60'
                      }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${isSelected ? 'bg-argon-btn text-white' : 'bg-argon-surface text-argon-muted'
                        }`}
                    >
                      {opt.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold truncate">{opt.label}</span>
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-argon-surface border border-argon-border text-argon-btn">
                          {opt.type}
                        </span>
                      </div>
                      <div className="text-[10px] opacity-75 mt-0.5">{opt.description}</div>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 opacity-50 mt-1" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div data-testid="furniture-list" className="space-y-2">
              <div className="p-2.5 bg-argon-surface/80 border border-argon-border rounded-xl flex items-center justify-between gap-2 text-[11px]">
                <span>
                  Interior 3D Furniture Layers ({enabledFurniture.length}/{ALL_FURNITURE_CATEGORY_IDS.length} active)
                </span>
                <button
                  type="button"
                  data-testid="btn-toggle-furniture-cutaway"
                  aria-pressed={interiorCutawayActive}
                  onClick={() => setInteriorCutawayActive(v => !v)}
                  className={`px-2 py-1 rounded font-mono text-[10px] border cursor-pointer ${
                    interiorCutawayActive
                      ? 'bg-argon-btn text-argon-card border-argon-btn font-bold'
                      : 'border-argon-border text-argon-text'
                  }`}
                >
                  {interiorCutawayActive ? 'Cutaway ON' : 'Cutaway View'}
                </button>
              </div>
              <FurniturePlacementControls editor={editor} />
              {furnitureOptions.map((opt) => {
                const isActive = enabledFurniture.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`furniture-opt-${opt.id}`}
                    aria-pressed={isActive}
                    onClick={() => toggleFurnitureCategory(opt.id, opt.label)}
                    className={`w-full p-3 rounded-xl border flex items-start gap-2.5 text-left transition-all cursor-pointer ${
                      isActive
                        ? 'border-argon-btn bg-argon-btn/10'
                        : 'border-argon-border opacity-70 hover:opacity-100'
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isActive ? 'bg-argon-btn text-white' : 'bg-argon-surface text-argon-muted'
                      }`}
                    >
                      {opt.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold truncate">{opt.label}</span>
                        <span
                          data-testid={`badge-furn-state-${opt.id}`}
                          className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border border-argon-border"
                        >
                          {isActive ? 'VISIBLE' : 'HIDDEN'}
                        </span>
                      </div>
                      <div className="text-[10px] opacity-75">{opt.category} · {opt.clearanceNote}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-3.5 border-t border-slate-700/80 bg-[#0D1320]">
          {feedbackMessage && <p data-testid="feedback-notice" role="status" className="rh-finish-feedback">{feedbackMessage}</p>}
          <button
            data-testid="btn-apply-global-skin"
            onClick={applyGlobal3DSkin}
            className="w-full py-2.5 rounded-xl bg-argon-btn hover:bg-argon-btnHover text-argon-card font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Apply Global 3D Skin</span>
          </button>
        </div>
      </aside>
    </div>
  );
};
export default Building3DCustomizer;

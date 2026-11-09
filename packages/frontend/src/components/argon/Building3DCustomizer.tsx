import React, { lazy, Suspense, useState, useMemo } from 'react';
import {
  Box,
  Sun,
  Moon,
  Layers,
  Home,
  Bed,
  DoorOpen,
  Maximize,
  Layout,
  Armchair,
  CheckCircle2,
  ChevronRight,
  Sparkles,
  Clock,
} from 'lucide-react';
import type { EditorContextValue } from '../../stores/editor-store';
import {
  UpdateWindowPropertiesCommand,
  UpdateDoorPropertiesCommand,
  BatchCommand,
  type OpeningStyleId,
  type IEditorCommand,
} from '@ai-floor-planner/core';

const ModelWorkspace = lazy(() => import('../model-3d/ModelWorkspace'));

interface Building3DCustomizerProps {
  editor: EditorContextValue;
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
  readonly id: string;
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly category: string;
  readonly pendingPhase: string;
}

export const Building3DCustomizer: React.FC<Building3DCustomizerProps> = ({
  editor,
}) => {
  const [explodeValue, setExplodeValue] = useState(0);
  const [lightingMode, setLightingMode] = useState<'day' | 'night'>('day');
  const [customizerTab, setCustomizerTab] = useState<'fixtures' | 'furniture'>('fixtures');
  const [selectedFixtureId, setSelectedFixtureId] = useState<string>('sliding_aluminum_win');
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');

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
      {
        id: 'bed_master',
        label: 'King/Queen Size Beds',
        icon: <Bed className="w-4 h-4" />,
        category: 'A-FURN Bed',
        pendingPhase: 'Pending Phase 8 (PBR Catalog)',
      },
      {
        id: 'sofa_living',
        label: '3-Seater L-Shape Sofas',
        icon: <Armchair className="w-4 h-4" />,
        category: 'A-FURN Seating',
        pendingPhase: 'Pending Phase 8 (PBR Catalog)',
      },
      {
        id: 'dining_set',
        label: '6-Seat Dining Set',
        icon: <Layout className="w-4 h-4" />,
        category: 'A-FURN Dining',
        pendingPhase: 'Pending Phase 8 (PBR Catalog)',
      },
      {
        id: 'wardrobe_full',
        label: 'Full-Height Wardrobes',
        icon: <Layers className="w-4 h-4" />,
        category: 'A-FURN Storage',
        pendingPhase: 'Pending Phase 8 (PBR Catalog)',
      },
      {
        id: 'kitchen_modular',
        label: 'Modular Kitchen Cabinets',
        icon: <Home className="w-4 h-4" />,
        category: 'A-FURN Casework',
        pendingPhase: 'Pending Phase 8 (PBR Catalog)',
      },
      {
        id: 'bath_fixtures',
        label: 'Standard Bath Fixtures',
        icon: <Home className="w-4 h-4" />,
        category: 'P-FIXT Plumbing',
        pendingPhase: 'Pending Phase 8 (PBR Catalog)',
      },
    ],
    []
  );

  const applyFixtureToSelectionOrFloor = (fixture: FixtureOption) => {
    setSelectedFixtureId(fixture.id);
    const selection = editor.selection;

    // 1. If user selected a matching entity, update just that entity
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

    // 2. Otherwise apply to all matching elements on active floor
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

  return (
    <div
      data-testid="building-3d-customizer"
      className="w-full h-[calc(100vh-3.5rem)] bg-slate-950 text-slate-100 flex overflow-hidden relative"
    >
      {/* Main 3D Viewport Area */}
      <main className="flex-1 relative bg-slate-950 min-w-0">
        <Suspense
          fallback={
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-slate-400">
              <Box className="w-12 h-12 animate-pulse text-amber-500" />
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
            lightingMode={lightingMode}
          />
        </Suspense>

        {/* Floating 3D HUD Controls */}
        <div
          data-testid="hud-controls"
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-6 px-8 py-4 bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl"
        >
          {/* Explode Slider */}
          <div className="flex flex-col gap-2 min-w-[200px]">
            <div className="flex items-center justify-between">
              <label
                htmlFor="explode-slider"
                className="text-[10px] font-mono font-bold text-amber-400 uppercase tracking-wider"
              >
                EXPLODE / REASSEMBLE
              </label>
              <span
                data-testid="explode-value-label"
                className="text-[10px] font-mono text-slate-400"
              >
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
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
          </div>

          <div className="w-px h-10 bg-slate-800" />

          {/* Lighting Toggles */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-mono font-bold text-indigo-400 uppercase tracking-wider">
              LIGHTING STATE
            </span>
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                data-testid="btn-lighting-day"
                onClick={() => setLightingMode('day')}
                className={`p-2 rounded-lg flex items-center gap-2 transition-all ${
                  lightingMode === 'day'
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-lg shadow-amber-500/20'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Sun className="w-4 h-4" />
                <span className="text-[10px] font-bold">DAY</span>
              </button>
              <button
                data-testid="btn-lighting-night"
                onClick={() => setLightingMode('night')}
                className={`p-2 rounded-lg flex items-center gap-2 transition-all ${
                  lightingMode === 'night'
                    ? 'bg-indigo-500 text-slate-100 font-bold shadow-lg shadow-indigo-500/20'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Moon className="w-4 h-4" />
                <span className="text-[10px] font-bold">NIGHT</span>
              </button>
            </div>
          </div>
        </div>

        {/* Top-Right Performance Overlay */}
        <div className="absolute top-4 left-4 z-20 flex flex-col gap-1 px-3 py-2 bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-lg font-mono text-[10px] text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>WebGL Core Active</span>
          </div>
          <div>Project: {editor.projectName}</div>
          <div>Active Floor: {editor.activeFloor.name}</div>
          <div>Floors: {editor.building.floors.length} lvl</div>
          {editor.selection && (
            <div className="text-amber-400">
              Selected: {editor.selection.entityType} ({editor.selection.entityId.slice(0, 8)})
            </div>
          )}
        </div>

        {/* Toast / Feedback Notice */}
        {feedbackMessage && (
          <div
            data-testid="feedback-notice"
            role="status"
            className="absolute top-4 right-8 z-30 flex items-center gap-2 px-4 py-2.5 bg-slate-900/95 border border-amber-500/40 rounded-xl text-xs font-mono text-amber-300 shadow-xl backdrop-blur-md"
          >
            <Sparkles className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>{feedbackMessage}</span>
          </div>
        )}
      </main>

      {/* Right-Hand Element Customizer Drawer */}
      <aside className="w-84 bg-slate-900 border-l border-slate-800 flex flex-col flex-shrink-0 shadow-2xl">
        <div className="p-5 border-b border-slate-800 bg-slate-900/90">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400">
            3D VISUALIZER
          </span>
          <h3 className="text-base font-bold text-slate-100 mt-0.5">
            Element Customizer
          </h3>
          <p className="text-[11px] text-slate-400 font-mono mt-1">
            Canonical profile updates reflect in 3D projection & IFC export
          </p>
        </div>

        {/* Tab Selection */}
        <div className="p-4 flex items-center gap-2">
          <button
            data-testid="tab-fixtures"
            onClick={() => setCustomizerTab('fixtures')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
              customizerTab === 'fixtures'
                ? 'bg-slate-800 text-amber-400 border border-amber-500/30 shadow-lg'
                : 'bg-slate-950 text-slate-500 border border-slate-800'
            }`}
          >
            FIXTURES (ACTIVE)
          </button>
          <button
            data-testid="tab-furniture"
            onClick={() => setCustomizerTab('furniture')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
              customizerTab === 'furniture'
                ? 'bg-slate-800 text-amber-400 border border-amber-500/30 shadow-lg'
                : 'bg-slate-950 text-slate-500 border border-slate-800'
            }`}
          >
            FURNITURE (PHASE 8)
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-3">
          <h4 className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest px-1">
            {customizerTab === 'fixtures'
              ? 'Window & Door Profiles (Supported)'
              : 'A-FURN Element Types (Scheduled)'}
          </h4>

          {customizerTab === 'fixtures' ? (
            <div data-testid="fixtures-list" className="space-y-2.5">
              {fixtureOptions.map((opt) => {
                const isSelected = selectedFixtureId === opt.id;
                return (
                  <button
                    key={opt.id}
                    data-testid={`fixture-opt-${opt.id}`}
                    onClick={() => applyFixtureToSelectionOrFloor(opt)}
                    className={`w-full p-3.5 rounded-xl border flex items-start gap-3 text-left transition-all shadow-sm ${
                      isSelected
                        ? 'bg-slate-800 border-amber-500/60 shadow-amber-500/10'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        isSelected
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-slate-900 border border-slate-800 text-slate-400'
                      }`}
                    >
                      {opt.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-slate-200 truncate">
                          {opt.label}
                        </span>
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-amber-400/80">
                          {opt.type}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1 leading-snug">
                        {opt.description}
                      </div>
                      <div className="text-[9px] font-mono text-slate-500 mt-1">
                        Style: {opt.styleId}
                      </div>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-600 mt-1" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div data-testid="furniture-list" className="space-y-2.5">
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2.5 text-amber-300">
                <Clock className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <strong>3D PBR Furniture Library scheduled for Phase 8.</strong>
                  <p className="text-[10px] text-amber-400/80 mt-0.5">
                    Controls are preview-only and disabled to prevent unbacked state changes.
                  </p>
                </div>
              </div>

              {furnitureOptions.map((opt) => (
                <div
                  key={opt.id}
                  data-testid={`furniture-opt-${opt.id}`}
                  className="w-full bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 flex items-start gap-3 text-left opacity-60 cursor-not-allowed"
                  aria-disabled="true"
                >
                  <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 flex-shrink-0">
                    {opt.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-400">
                      {opt.label}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {opt.category}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span
                        data-testid="badge-pending-phase8"
                        className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-slate-900 text-amber-400/80 border border-amber-500/20"
                      >
                        {opt.pendingPhase}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="p-4 rounded-xl bg-amber-500/5 border border-dashed border-amber-500/20 text-center space-y-2 mt-4">
            <Sparkles className="w-4 h-4 text-amber-500/60 mx-auto" />
            <p className="text-[10px] text-amber-400/80 leading-relaxed italic">
              "Selecting a fixture profile executes typed reversible commands into the
              sole-authority Canonical Building model."
            </p>
          </div>
        </div>

        <div className="p-5 border-t border-slate-800 bg-slate-950/50">
          <button
            data-testid="btn-apply-global-skin"
            onClick={applyGlobal3DSkin}
            className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all active:scale-[0.99]"
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

import React, { lazy, Suspense, useState } from 'react';
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
} from 'lucide-react';
import type { EditorContextValue } from '../../stores/editor-store';

const ModelWorkspace = lazy(() => import('../model-3d/ModelWorkspace'));

interface Building3DCustomizerProps {
  editor: EditorContextValue;
}

export const Building3DCustomizer: React.FC<Building3DCustomizerProps> = ({
  editor,
}) => {
  const [explodeValue, setExplodeValue] = useState(0);
  const [lightingMode, setLightingMode] = useState<'day' | 'night'>('day');
  const [customizerTab, setCustomizerTab] = useState<'fixtures' | 'furniture'>('fixtures');

  const fixtureOptions = [
    { label: 'Sliding Aluminum Windows', icon: <Maximize className="w-4 h-4" /> },
    { label: 'Casement Timber Windows', icon: <Maximize className="w-4 h-4" /> },
    { label: 'Fixed Structural Glass', icon: <Maximize className="w-4 h-4" /> },
    { label: 'Solid Core Main Door', icon: <DoorOpen className="w-4 h-4" /> },
    { label: 'Internal Flush Doors', icon: <DoorOpen className="w-4 h-4" /> },
  ];

  const furnitureOptions = [
    { label: 'King/Queen Size Beds', icon: <Bed className="w-4 h-4" /> },
    { label: '3-Seater L-Shape Sofas', icon: <Armchair className="w-4 h-4" /> },
    { label: '6-Seat Dining Set', icon: <Layout className="w-4 h-4" /> },
    { label: 'Full-Height Wardrobes', icon: <Layers className="w-4 h-4" /> },
    { label: 'Modular Kitchen Cabinets', icon: <Home className="w-4 h-4" /> },
    { label: 'Standard Bath Fixtures', icon: <Home className="w-4 h-4" /> },
  ];

  return (
    <div className="w-full h-[calc(100vh-3.5rem)] bg-slate-950 text-slate-100 flex overflow-hidden relative">
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
          />
        </Suspense>

        {/* Floating 3D HUD Controls */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-6 px-8 py-4 bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl">
          {/* Explode Slider */}
          <div className="flex flex-col gap-2 min-w-[200px]">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono font-bold text-amber-400 uppercase tracking-wider">
                EXPLODE / REASSEMBLE
              </label>
              <span className="text-[10px] font-mono text-slate-400">{explodeValue}%</span>
            </div>
            <input
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
            <label className="text-[10px] font-mono font-bold text-indigo-400 uppercase tracking-wider">
              LIGHTING STATE
            </label>
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setLightingMode('day')}
                className={`p-2 rounded-lg flex items-center gap-2 transition-all ${
                  lightingMode === 'day'
                    ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/10'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Sun className="w-4 h-4" />
                <span className="text-[10px] font-bold">DAY</span>
              </button>
              <button
                onClick={() => setLightingMode('night')}
                className={`p-2 rounded-lg flex items-center gap-2 transition-all ${
                  lightingMode === 'night'
                    ? 'bg-indigo-500 text-slate-100 shadow-lg shadow-indigo-500/10'
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
        <div className="absolute top-4 left-4 z-20 flex flex-col gap-1 px-3 py-2 bg-slate-900/40 backdrop-blur-md border border-slate-800 rounded-lg font-mono text-[10px] text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>WebGL Core: 60 FPS</span>
          </div>
          <div>Project: {editor.projectName}</div>
          <div>Floors: {editor.building.floors.length} lvl</div>
        </div>
      </main>

      {/* Right-Hand Element Customizer Drawer */}
      <aside className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col flex-shrink-0 shadow-2xl">
        <div className="p-5 border-b border-slate-800 bg-slate-900/90">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400">
            3D VISUALIZER
          </span>
          <h3 className="text-base font-bold text-slate-100 mt-0.5">
            Element Customizer
          </h3>
        </div>

        {/* Tab Selection */}
        <div className="p-4 flex items-center gap-2">
          <button
            onClick={() => setCustomizerTab('fixtures')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
              customizerTab === 'fixtures'
                ? 'bg-slate-800 text-amber-400 border border-amber-500/30 shadow-lg'
                : 'bg-slate-950 text-slate-500 border border-slate-800'
            }`}
          >
            FIXTURES
          </button>
          <button
            onClick={() => setCustomizerTab('furniture')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
              customizerTab === 'furniture'
                ? 'bg-slate-800 text-amber-400 border border-amber-500/30 shadow-lg'
                : 'bg-slate-950 text-slate-500 border border-slate-800'
            }`}
          >
            FURNITURE
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-3">
          <h4 className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest px-1">
            {customizerTab === 'fixtures' ? 'Window & Door Profiles' : 'A-FURN Element Types'}
          </h4>

          {(customizerTab === 'fixtures' ? fixtureOptions : furnitureOptions).map((opt, i) => (
            <button
              key={i}
              className="w-full bg-slate-950 p-4 rounded-xl border border-slate-800 flex items-center gap-3 text-left group hover:border-amber-500/50 transition-all hover:bg-slate-900 shadow-sm"
            >
              <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 group-hover:text-amber-400 transition-colors">
                {opt.icon}
              </div>
              <div className="flex-1">
                <div className="text-xs font-bold text-slate-200 group-hover:text-slate-100">
                  {opt.label}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Applied to all valid wall hosts
                </div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-700 group-hover:text-amber-400 transition-colors" />
            </button>
          ))}

          <div className="p-4 rounded-xl bg-amber-500/5 border border-dashed border-amber-500/20 text-center space-y-2 mt-6">
            <Sparkles className="w-5 h-5 text-amber-500/60 mx-auto" />
            <p className="text-[10px] text-amber-400/80 leading-relaxed italic">
              "Selecting a profile updates the Building Model's global geometry metadata, affecting all projected floor sheets."
            </p>
          </div>
        </div>

        <div className="p-5 border-t border-slate-800 bg-slate-950/50">
          <button className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all">
            <CheckCircle2 className="w-4 h-4" />
            <span>Apply Global 3D Skin</span>
          </button>
        </div>
      </aside>
    </div>
  );
};

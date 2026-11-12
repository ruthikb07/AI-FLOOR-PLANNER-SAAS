import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  Compass,
  Layers,
  DraftingCompass,
  Box,
  ShieldCheck,
  Download,
  FolderOpen,
  ChevronDown,
  Command,
  Bell,
  Settings,
  User,
  Plus,
  Check,
} from 'lucide-react';
import { useEditorStore } from '../../stores/editor-store';
import { ProjectSetupWizard, type ProjectSetupWizardData } from './ProjectSetupWizard';
import { RHWelcomeScreen } from '../studio/RHWelcomeScreen';
import { ArchitecturalCADWorkspace } from './ArchitecturalCADWorkspace';
import { FloorIsometricEditor } from './FloorIsometricEditor';
import { Building3DCustomizer } from './Building3DCustomizer';
import { StructuralCADWorkspace } from './StructuralCADWorkspace';
import { UdcprEtabsAnalysis } from './UdcprEtabsAnalysis';
import { ExportCenterWorkspace } from './ExportCenterWorkspace';
import { GenerationProgressModal } from './GenerationProgressModal';
import { projectStorage } from '../../services/storage';
import {
  type executeAuditedPlanningPipeline,
  type PipelineStageProgressEvent,
} from '@ai-floor-planner/planning-engine';

import { createArgonRequest } from '../../services/argon-request';

export type ArgonWorkspaceId =
  | 'setup'
  | 'cad_2d'
  | 'isometric'
  | 'building_3d'
  | 'structural_cad'
  | 'engineering'
  | 'export';

interface ArgonStudioShellProps {
  onBackToProjects?: () => void;
}

export const ArgonStudioShell: React.FC<ArgonStudioShellProps> = ({
  onBackToProjects,
}) => {
  const editor = useEditorStore();
  const [activeWorkspace, setActiveWorkspace] = useState<ArgonWorkspaceId>('setup');
  const [isProjectSwitcherOpen, setIsProjectSwitcherOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState<PipelineStageProgressEvent | null>(null);

  const projectList = projectStorage.list();

  const workspaces: Array<{ id: ArgonWorkspaceId; label: string; icon: React.ReactNode }> = [
    { id: 'setup', label: '01 • Setup Wizard', icon: <Compass className="w-4 h-4" /> },
    { id: 'cad_2d', label: '02 • 2D CAD Studio', icon: <DraftingCompass className="w-4 h-4" /> },
    { id: 'isometric', label: '03 • Floor Editor', icon: <Layers className="w-4 h-4" /> },
    { id: 'building_3d', label: '04 • 3D Building', icon: <Box className="w-4 h-4" /> },
    { id: 'structural_cad', label: '05 • Structural CAD', icon: <Building2 className="w-4 h-4" /> },
    { id: 'engineering', label: '06 • Engineering', icon: <ShieldCheck className="w-4 h-4" /> },
    { id: 'export', label: '07 • Export Center', icon: <Download className="w-4 h-4" /> },
  ];

  const workerRef = useRef<Worker | null>(null);
  const lastBrief = useRef<ProjectSetupWizardData | null>(null);
  const [generationError, setGenerationError] = useState('');
  /**
   * Set when geometry generated successfully but the durable save did not.
   * Kept separate from `generationError`: the plan exists and is usable, which
   * is a different situation from a generation that failed.
   */
  const [saveWarning, setSaveWarning] = useState('');
  useEffect(() => () => workerRef.current?.terminate(), []);
  const handleGenerate = (data: ProjectSetupWizardData) => {
    workerRef.current?.terminate();
    lastBrief.current = data;
    setIsGenerating(true); setPipelineProgress(null); setGenerationError('');
    try {
      const request = createArgonRequest(data);
      const worker = new Worker(new URL('../../services/argon-planning.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<{
        type: 'progress' | 'complete' | 'error'; progress?: PipelineStageProgressEvent;
        result?: Awaited<ReturnType<typeof executeAuditedPlanningPipeline>>; message?: string;
      }>) => {
        if (workerRef.current !== worker) return;
        if (event.data.progress) setPipelineProgress(event.data.progress);
        if (event.data.type === 'error') {
          setGenerationError(event.data.message ?? 'Generation failed. Review the plot and program.'); worker.terminate();
        }
        if (event.data.type === 'complete' && event.data.result) {
          try {
            // The plan is handed to the editor and the user is taken to it
            // immediately. Persistence is reported separately below: a storage
            // problem must not read as a generation failure, and must not
            // discard a plan that has already passed every geometric and
            // regulatory check.
            const outcome = editor.setBuilding(event.data.result.building, data.projectName, {}, 'residential');
            const firstResidential = event.data.result.building.floors.find(floor => floor.apartmentUnits?.length);
            if (firstResidential) editor.switchFloor(firstResidential.id);
            setIsGenerating(false); setActiveWorkspace('cad_2d');
            setSaveWarning('');

            void outcome.durable.then(result => {
              if (result.state === 'SAVED') return;
              setSaveWarning(
                result.state === 'UNAVAILABLE'
                  ? 'This plan is open and complete, but durable storage is unavailable, so it will not '
                    + 'survive a reload. Export the project to keep it.'
                  : `This plan is open and complete, but it could not be saved durably: ${result.reason ?? result.state} `
                    + 'Export the project to keep it.',
              );
            });
          } catch (error) {
            // Only a genuine defect reaches here now, not a capacity problem.
            setGenerationError(error instanceof Error ? error.message : 'Could not open the generated project.');
          }
          worker.terminate();
        }
      };
      worker.onerror = event => { setGenerationError(event.message || 'The planning worker could not start.'); worker.terminate(); };
      worker.postMessage(request);
    } catch (error) { setGenerationError(error instanceof Error ? error.message : String(error)); }
  };
  const cancelGeneration = () => { workerRef.current?.terminate(); workerRef.current = null; setIsGenerating(false); };

  const [showWelcome, setShowWelcome] = useState(() => {
    if (typeof window !== 'undefined') {
      return !sessionStorage.getItem('rh_welcome_dismissed');
    }
    return true;
  });

  const dismissWelcome = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('rh_welcome_dismissed', 'true');
    }
    setShowWelcome(false);
  };

  return (
    <div className="argon-shell flex flex-col h-screen w-screen bg-argon-bg text-argon-text overflow-hidden font-sans relative">
      {showWelcome && (
        <RHWelcomeScreen
          onStartNewProject={dismissWelcome}
          onOpenExisting={() => {
            dismissWelcome();
            setIsProjectSwitcherOpen(true);
          }}
          onExplore={() => {
            dismissWelcome();
            setActiveWorkspace('building_3d');
          }}
        />
      )}
      {/* STRICTLY ONE UNIFIED TOP HEADER BAR (H-14) */}
      <header className="h-14 bg-argon-surface/95 border-b border-argon-border flex items-center justify-between px-4 z-50 flex-shrink-0 shadow-2xs">
        {/* Left: Brand + Project Switcher */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-1">
            <div className="w-8 h-8 rounded-lg bg-argon-btn flex items-center justify-center text-argon-card shadow-xs">
              <Building2 className="w-5 h-5" />
            </div>
            <span className="font-black text-lg tracking-tighter uppercase italic text-argon-text">
              ARGON<span className="text-argon-accent font-extrabold">4</span>
            </span>
          </div>

          <div className="h-6 w-px bg-argon-border" />

          <div className="relative">
            <button
              onClick={() => setIsProjectSwitcherOpen(!isProjectSwitcherOpen)}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-argon-card border border-argon-border hover:bg-argon-surface transition-colors group shadow-2xs"
            >
              <FolderOpen className="w-4 h-4 text-argon-muted group-hover:text-argon-btn transition-colors" />
              <div className="text-left">
                <div className="text-[10px] font-mono font-bold text-argon-muted uppercase leading-none mb-0.5">
                  ACTIVE PROJECT
                </div>
                <div className="text-sm font-bold text-argon-text leading-none">
                  {editor.projectName || 'Untitled Project'}
                </div>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-argon-muted transition-transform ${isProjectSwitcherOpen ? 'rotate-180' : ''}`} />
            </button>

            {isProjectSwitcherOpen && (
              <div className="absolute top-full left-0 mt-2 w-72 bg-argon-card border border-argon-border rounded-xl shadow-xl z-[100] overflow-hidden animate-fadeIn">
                <div className="p-3 border-b border-argon-border bg-argon-surface/60 flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold text-argon-muted uppercase tracking-widest">
                    Switch Project
                  </span>
                  <button className="text-[10px] font-bold text-argon-btn hover:text-argon-btnHover flex items-center gap-1">
                    <Plus className="w-3 h-3" /> NEW
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto argon-scrollbar p-1.5">
                  {projectList.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        editor.loadProject(p.id);
                        setIsProjectSwitcherOpen(false);
                      }}
                      className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors mb-1 text-left ${
                        p.id === editor.projectId
                          ? 'bg-argon-accent/15 border border-argon-accent/40'
                          : 'hover:bg-argon-surface border border-transparent'
                      }`}
                    >
                      <div>
                        <div className={`text-sm font-bold ${p.id === editor.projectId ? 'text-argon-btn' : 'text-argon-text'}`}>
                          {p.name}
                        </div>
                        <div className="text-[10px] text-argon-muted font-mono mt-0.5">
                          {p.floorCount} FLOORS • {p.roomCount} ROOMS
                        </div>
                      </div>
                      {p.id === editor.projectId && <Check className="w-4 h-4 text-argon-btn" />}
                    </button>
                  ))}
                </div>
                {onBackToProjects && (
                  <button
                    onClick={onBackToProjects}
                    className="w-full py-3 text-center text-xs font-bold text-argon-muted hover:text-argon-text hover:bg-argon-surface border-t border-argon-border transition-colors"
                  >
                    ← BACK TO PROJECT HUB
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Center: Workspace Switcher */}
        <nav className="flex items-center gap-1 bg-argon-surface/80 p-1 rounded-xl border border-argon-border">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => setActiveWorkspace(ws.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeWorkspace === ws.id
                  ? 'bg-argon-btn text-argon-card shadow-xs'
                  : 'text-argon-muted hover:text-argon-text hover:bg-argon-surface'
              }`}
            >
              {ws.icon}
              <span className="whitespace-nowrap">{ws.label}</span>
            </button>
          ))}
        </nav>

        {/* Right: Tools & Profile */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-argon-card border border-argon-border shadow-2xs">
            <button className="p-1.5 text-argon-muted hover:text-argon-text transition-colors" title="Command Palette (Ctrl+K)">
              <Command className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-argon-border" />
            <button className="p-1.5 text-argon-muted hover:text-argon-text transition-colors" title="Notifications">
              <Bell className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-argon-border" />
            <button className="p-1.5 text-argon-muted hover:text-argon-text transition-colors" title="Settings">
              <Settings className="w-4 h-4" />
            </button>
          </div>

          <button className="w-9 h-9 rounded-full bg-argon-card border border-argon-border flex items-center justify-center text-argon-text hover:border-argon-btn transition-all shadow-2xs">
            <User className="w-5 h-5 text-argon-muted" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 relative overflow-hidden flex flex-col min-h-0 bg-argon-bg">
        {activeWorkspace === 'setup' && (
          <ProjectSetupWizard
            onGenerate={handleGenerate}
            onCancel={() => setActiveWorkspace('cad_2d')}
          />
        )}
        {activeWorkspace === 'cad_2d' && (
          <ArchitecturalCADWorkspace editor={editor} />
        )}
        {activeWorkspace === 'isometric' && (
          <FloorIsometricEditor editor={editor} />
        )}
        {activeWorkspace === 'building_3d' && (
          <Building3DCustomizer editor={editor} />
        )}
        {activeWorkspace === 'structural_cad' && (
          <StructuralCADWorkspace editor={editor} />
        )}
        {activeWorkspace === 'engineering' && (
          <UdcprEtabsAnalysis editor={editor} onHighlight={()=>setActiveWorkspace('cad_2d')} />
        )}
        {activeWorkspace === 'export' && (
          <ExportCenterWorkspace editor={editor} />
        )}

        {/*
          Persistence warning. Shown when the plan generated and opened
          successfully but the durable save did not, so the user can act on it
          by exporting. This is deliberately not an error banner: the plan is
          complete and usable, only its storage is at risk.
        */}
        {saveWarning && (
          <div
            role="status"
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-2xl px-4 py-3 rounded-lg
                       bg-amber-50 border border-amber-300 text-amber-900 text-sm shadow-lg flex items-start gap-3"
          >
            <span className="font-bold shrink-0">NOT SAVED</span>
            <span className="flex-1">{saveWarning}</span>
            <button
              onClick={() => setSaveWarning('')}
              className="shrink-0 font-bold text-amber-700 hover:text-amber-900"
              aria-label="Dismiss the storage warning"
            >
              ×
            </button>
          </div>
        )}

        {/* Generation Progress Modal */}
        <GenerationProgressModal
          isOpen={isGenerating}
          progress={pipelineProgress}
          error={generationError}
          onRetry={() => { if (lastBrief.current) handleGenerate(lastBrief.current); }}
          onCancel={cancelGeneration}
        />
      </main>

      {/* Global CSS Injection for ARGON 4 Components */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #334155;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #475569;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 16px;
          width: 16px;
          border-radius: 50%;
          background: #f59e0b;
          cursor: pointer;
          border: 2px solid #0f172a;
          box-shadow: 0 0 10px rgba(245, 158, 11, 0.3);
        }
      ` }} />
    </div>
  );
};

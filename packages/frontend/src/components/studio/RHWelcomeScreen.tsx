/**
 * RH Planner - Cinematic Brand & Welcome Overlay
 */
import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, ArrowRight, FolderOpen, Compass, Volume2, VolumeX, Building2 } from 'lucide-react';
import { CinematicWelcomeScene } from './CinematicWelcomeScene';

interface RHWelcomeScreenProps {
  onStartNewProject: () => void;
  onOpenExisting: () => void;
  onExplore: () => void;
}

export const RHWelcomeScreen: React.FC<RHWelcomeScreenProps> = ({
  onStartNewProject,
  onOpenExisting,
  onExplore,
}) => {
  const [introFinished, setIntroFinished] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Timer for the sparkling wave intro sequence
    const timer = setTimeout(() => {
      setIntroFinished(true);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  const toggleSound = () => {
    setSoundEnabled(!soundEnabled);
    if (!soundEnabled && audioRef.current) {
      audioRef.current.play().catch(() => {});
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-between bg-[#0a0a0a] text-[#FAF8F4] overflow-hidden font-sans select-none">
      {/* 3D Building Assembly Background */}
      <CinematicWelcomeScene
        onStartProject={onStartNewProject}
        onExplore={() => {
          // Scroll to explorer section
          const scrollContainer = document.querySelector('.overflow-y-auto');
          if (scrollContainer) {
            scrollContainer.scrollTo({ top: window.innerHeight, behavior: 'smooth' });
          }
        }}
      />

      {/* Intro Sparkling Wave & Logo Reveal Overlay */}
      {!introFinished && (
        <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-[#0a0a0a] transition-opacity duration-1500 ease-in-out">
          <div className="relative flex flex-col items-center space-y-8 scale-110">
            {/* Luminous Wave & RH Monogram */}
            <div className="relative w-32 h-32 rounded-3xl bg-gradient-to-br from-[#A67C52] via-[#E8DCCB] to-[#252723] p-[1.5px] shadow-2xl shadow-[#A67C52]/40">
              <div className="w-full h-full bg-[#0d0d0d] rounded-[22px] flex items-center justify-center relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#E8DCCB]/30 to-transparent -translate-x-full animate-shimmer" />
                <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] pointer-events-none" />

                {/* SVG Light Streak */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-50" viewBox="0 0 100 100">
                  <defs>
                    <linearGradient id="streak" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="transparent" />
                      <stop offset="50%" stopColor="#E8DCCB" />
                      <stop offset="100%" stopColor="transparent" />
                    </linearGradient>
                  </defs>
                  <rect width="200" height="2" fill="url(#streak)" transform="rotate(-45 50 50)">
                    <animateTransform attributeName="transform" type="translate" from="-150 -150" to="150 150" dur="3s" repeatCount="indefinite" />
                  </rect>
                </svg>

                <span className="text-5xl font-black tracking-tighter text-[#E8DCCB] font-serif drop-shadow-2xl">RH</span>
              </div>

              {/* Particle Sparkle Emitted from corners (CSS approximation) */}
              <div className="absolute -top-1 -right-1 w-2 h-2 bg-[#FFD700] rounded-full blur-[2px] animate-pulse" />
              <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-[#FFD700] rounded-full blur-[2px] animate-pulse delay-700" />
            </div>

            <div className="text-center space-y-3">
              <h1 className="text-4xl font-serif tracking-[0.2em] text-[#FAF8F4] uppercase font-bold tracking-tighter opacity-0 animate-fadeInUp">
                RH Planner
              </h1>
              <p className="text-[10px] font-mono tracking-[0.5em] text-[#A67C52] uppercase opacity-0 animate-fadeInUp delay-500">
                Architectural AI Visualization
              </p>
            </div>
          </div>

          <button
            onClick={() => setIntroFinished(true)}
            className="absolute bottom-12 text-[10px] font-mono tracking-widest text-[#555] hover:text-[#A67C52] transition-all uppercase cursor-pointer"
          >
            Skip Intro — Step Inside
          </button>
        </div>
      )}

      {/* Top Header Bar */}
      <header className="w-full max-w-7xl mx-auto p-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#A67C52] text-[#0a0a0a] flex items-center justify-center font-bold font-serif text-lg shadow-lg">
            RH
          </div>
          <span className="text-xl font-bold tracking-wider font-serif text-[#FAF8F4]">
            RH PLANNER
          </span>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={toggleSound}
            className="p-2.5 rounded-xl bg-[#141414]/80 border border-[#333] text-[#B8A58F] hover:text-[#FAF8F4] transition-all backdrop-blur-md"
            title={soundEnabled ? 'Mute Sound' : 'Enable Ambient Sound'}
          >
            {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button
            onClick={() => setIntroFinished(true)}
            className="px-4 py-2 rounded-xl bg-[#141414]/80 border border-[#333] text-xs font-mono font-bold text-[#E8DCCB] hover:bg-[#252723] transition-all backdrop-blur-md"
          >
            SKIP INTRO
          </button>
        </div>
      </header>

      {/* Main Welcome Hero Content */}
      <main className="w-full max-w-7xl mx-auto px-6 py-12 flex flex-col lg:flex-row items-center justify-between gap-12 z-10 my-auto">
        <div className="max-w-2xl space-y-8">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#A67C52]/10 border border-[#A67C52]/30 text-[#E8DCCB] text-xs font-mono uppercase tracking-widest">
            <Sparkles size={13} className="text-[#A67C52]" />
            <span>Next-Gen AI Architectural Workspace</span>
          </div>

          <div className="space-y-4">
            <h1 className="text-5xl sm:text-6xl font-serif font-bold tracking-tight text-[#FAF8F4] leading-[1.1]">
              Design Your Vision. <br />
              <span className="bg-gradient-to-r from-[#E8DCCB] via-[#B8A58F] to-[#A67C52] bg-clip-text text-transparent">
                Explore It in 3D.
              </span>
            </h1>
            <p className="text-base text-[#B8A58F] leading-relaxed max-w-xl font-light">
              An AI-assisted architectural design workspace for turning your requirements into editable floor plans, intelligent layouts, interactive 3D buildings and professional project deliverables.
            </p>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-wrap items-center gap-4 pt-4">
            <button
              onClick={onStartNewProject}
              className="px-7 py-4 rounded-xl bg-[#A67C52] hover:bg-[#b8895c] text-[#0a0a0a] font-bold text-sm tracking-wider uppercase flex items-center gap-3 shadow-xl shadow-[#A67C52]/20 transition-all transform hover:-translate-y-0.5 cursor-pointer"
            >
              <Building2 size={18} />
              <span>Create New Project</span>
              <ArrowRight size={16} />
            </button>

            <button
              onClick={onOpenExisting}
              className="px-6 py-4 rounded-xl bg-[#141414]/90 hover:bg-[#1a1a1a] border border-[#333] text-[#FAF8F4] font-bold text-sm tracking-wider uppercase flex items-center gap-3 backdrop-blur-md transition-all cursor-pointer"
            >
              <FolderOpen size={18} className="text-[#B8A58F]" />
              <span>Open Existing Project</span>
            </button>

            <button
              onClick={onExplore}
              className="px-6 py-4 rounded-xl bg-transparent hover:bg-[#141414]/50 border border-[#333] text-[#B8A58F] hover:text-[#FAF8F4] font-bold text-sm tracking-wider uppercase flex items-center gap-2 transition-all cursor-pointer"
            >
              <Compass size={18} />
              <span>Explore Capabilities</span>
            </button>
          </div>

          {/* Capability Highlights */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6 border-t border-[#222]">
            <div>
              <div className="text-sm font-bold text-[#FAF8F4] font-serif">AI-Assisted</div>
              <div className="text-xs text-[#737373] font-mono mt-0.5">Automated Slicing</div>
            </div>
            <div>
              <div className="text-sm font-bold text-[#FAF8F4] font-serif">2D / 3D</div>
              <div className="text-xs text-[#737373] font-mono mt-0.5">Synced Projections</div>
            </div>
            <div>
              <div className="text-sm font-bold text-[#FAF8F4] font-serif">Customizable</div>
              <div className="text-xs text-[#737373] font-mono mt-0.5">Room Area Solver</div>
            </div>
            <div>
              <div className="text-sm font-bold text-[#FAF8F4] font-serif">Professional</div>
              <div className="text-xs text-[#737373] font-mono mt-0.5">DWG, DXF & PDF</div>
            </div>
          </div>
        </div>

        {/* Right side spacer for 3D building background interaction */}
        <div className="hidden lg:block w-96 h-96 pointer-events-none" />
      </main>

      {/* Footer */}
      <footer className="w-full max-w-7xl mx-auto p-6 flex items-center justify-between text-xs font-mono text-[#737373] z-10 border-t border-[#1a1a1a]">
        <div>© 2026 RH Planner Inc. All rights reserved.</div>
        <div className="flex items-center gap-6">
          <span>UDCPR 2020 Compliance Engine</span>
          <span>Three.js WebGL Core</span>
        </div>
      </footer>
    </div>
  );
};
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  Box,
  Building2,
  FileUp,
  FolderOpen,
  Layers,
  Moon,
  Sun,
  Sunset,
} from 'lucide-react';
import { architecturePhotos, photoUrl } from './architecture-photos';
import type { ShowcaseLightingMode } from './ResidenceShowcase';

const ResidenceShowcase = lazy(() => import('./ResidenceShowcase'));

interface RHWelcomeScreenProps {
  onStartNewProject: (projectType: 'new_construction' | 'redevelopment') => void;
  onImportReference?: () => void;
  onOpenExisting: () => void;
  lightingMode: ShowcaseLightingMode;
  onToggleLightingMode: (mode: ShowcaseLightingMode) => void;
}

const chapters = [
  {
    label: 'Aerial Overview',
    title: 'Precision Residential Architecture',
    text: 'Parametric massing, coordinated 2D CAD drawings, structural framing, and real-time PBR visualization.',
  },
  {
    label: 'Arrival Court',
    title: 'Arrival Court & Reflective Water',
    text: 'Landscaped podium arrival court with reflective water basins, warm 2700K pathway bollards, and shaded canopy.',
  },
  {
    label: 'Podium & Street',
    title: 'Podium & Urban Streetscape',
    text: 'Multi-level stilt and podium massing integrated with setback envelopes, driveways, and landscaped terraces.',
  },
  {
    label: 'Facade & Chajjas',
    title: 'Facade Glazing & 600 mm Chajjas',
    text: 'Low-E reflective vision glazing, brushed bronze mullions, laminated glass balustrades, and cast concrete sunshades.',
  },
  {
    label: 'Lobby Interior',
    title: 'Entrance Lobby & 2700K Illumination',
    text: 'Double-height arrival lobby illuminated with warm 2700K architectural lighting for twilight and night studies.',
  },
] as const;

const LIGHTING_PRESETS: ReadonlyArray<{
  id: ShowcaseLightingMode;
  label: string;
  shortLabel: string;
  icon: typeof Sun;
}> = [
  { id: 'day', label: 'Morning Daylight', shortLabel: 'Day', icon: Sun },
  { id: 'golden', label: 'Golden Sunset', shortLabel: 'Sunset', icon: Sunset },
  { id: 'night', label: 'Night Illumination', shortLabel: 'Night', icon: Moon },
];

export function RHWelcomeScreen({
  onStartNewProject,
  onImportReference,
  onOpenExisting,
  lightingMode,
  onToggleLightingMode,
}: RHWelcomeScreenProps) {
  const host = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLElement>(null);
  const selection = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const [orbit, setOrbit] = useState(false);
  const chapter = Math.min(chapters.length - 1, Math.round(progress * (chapters.length - 1)));

  useEffect(() => {
    const scroller = host.current;
    const region = track.current;
    if (!scroller || !region) return;
    let frame = 0;
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          const extent = Math.max(1, region.offsetHeight - scroller.clientHeight);
          setProgress(Math.max(0, Math.min(1, (scroller.scrollTop - region.offsetTop) / extent)));
        });
      }
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(scroller);
    observer?.observe(region);
    scroller.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      scroller.removeEventListener('scroll', schedule);
    };
  }, []);

  function jump(fraction: number) {
    const scroller = host.current;
    const region = track.current;
    if (!scroller || !region) return;
    setOrbit(false);
    setProgress(fraction);
    scroller.scrollTo({
      top: region.offsetTop + fraction * (region.offsetHeight - scroller.clientHeight),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }

  function openProjectSelection() {
    setOrbit(false);
    selection.current?.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }

  return (
    <div ref={host} className="rh-atelier-welcome rh-obsidian-welcome" data-testid="welcome-scroll-container">
      <header className="rh-atelier-top rh-obsidian-top">
        <button className="rh-atelier-brand rh-obsidian-brand" type="button" onClick={() => jump(0)}>
          <span className="rh-monogram-mark" aria-hidden="true">RH</span>{' '}
          <span className="rh-monogram-word">PLANNER</span>
        </button>
        <nav aria-label="Studio Navigation">
          <button type="button" className="rh-quiet-action" onClick={onOpenExisting}>
            <FolderOpen size={15} /> Recent Projects
          </button>
          <button type="button" className="rh-solid-action" onClick={openProjectSelection}>
            Launch Studio <ArrowRight size={15} />
          </button>
        </nav>
      </header>

      <main>
        <section ref={track} className="rh-atelier-track" aria-label="Architectural 3D Viewport">
          <div
            className="rh-atelier-viewport"
            data-orbit={orbit}
            data-lighting={lightingMode}
            data-view={chapters[chapter]!.label.toLowerCase()}
          >
            <img
              className="rh-atelier-fallback"
              src={photoUrl(architecturePhotos.residence)}
              srcSet={`${import.meta.env.BASE_URL}architecture/residence-small.webp 720w, ${photoUrl(architecturePhotos.residence)} 1600w`}
              sizes="100vw"
              alt=""
            />
            <Suspense fallback={null}>
              <ResidenceShowcase progress={progress} orbit={orbit} lightingMode={lightingMode} />
            </Suspense>
            <div className="rh-atelier-scrim" aria-hidden="true" />

            <div className="rh-atelier-story" aria-live="off">
              {chapter === 0 ? (
                <>
                  <p className="rh-atelier-kicker">ARCHITECTURAL BIM &amp; REAL-TIME VISUALIZATION STUDIO</p>
                  <h1>
                    Architectural precision.<br />
                    <i>Photorealistic clarity.</i>
                  </h1>
                  <p>
                    Author residential massing studies, coordinated 2D CAD drawings, structural framing, and
                    interactive PBR building models in one unified studio.
                  </p>
                </>
              ) : (
                <>
                  <p className="rh-atelier-kicker">CAMERA PRESET · 0{chapter + 1} / 0{chapters.length}</p>
                  <h2>{chapters[chapter]!.title}</h2>
                  <p>{chapters[chapter]!.text}</p>
                </>
              )}
              {chapter === 0 && (
                <div className="rh-hero-cta-row">
                  <button
                    type="button"
                    className="rh-solid-action"
                    onClick={openProjectSelection}
                  >
                    New Architectural Project <ArrowRight size={15} />
                  </button>
                  <button
                    type="button"
                    className="rh-quiet-action"
                    data-testid="cta-explore-scroll"
                    onClick={() => jump(0.25)}
                  >
                    <ArrowDown size={15} /> Explore Arrival Court
                  </button>
                </div>
              )}
            </div>

            <nav className="rh-atelier-chapters" aria-label="Camera Presets">
              {chapters.map((item, index) => (
                <button
                  key={item.label}
                  aria-pressed={chapter === index}
                  type="button"
                  onClick={() => jump(index / (chapters.length - 1))}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="rh-atelier-controls">
              <div className="rh-lighting-segmented" role="group" aria-label="Lighting Atmosphere">
                {LIGHTING_PRESETS.map(preset => {
                  const Icon = preset.icon;
                  const active = lightingMode === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      data-testid={preset.id === 'night' ? 'welcome-theme-toggle' : `welcome-light-${preset.id}`}
                      aria-pressed={active}
                      title={preset.label}
                      onClick={() => onToggleLightingMode(preset.id)}
                    >
                      <Icon size={14} />
                      <span>{preset.label}</span>
                    </button>
                  );
                })}
              </div>
              <div>
                <button
                  type="button"
                  aria-pressed={orbit}
                  onClick={() => setOrbit(current => !current)}
                  className="rh-quiet-action"
                >
                  <Box size={15} /> {orbit ? 'Resume Camera Tour' : 'Free Orbit 3D'}
                </button>
              </div>
            </div>

            <div className="rh-atelier-context-fallback">Architectural Preview · Hardware WebGL Unavailable</div>
          </div>
        </section>

        <section ref={selection} className="rh-atelier-entry rh-obsidian-launcher" aria-labelledby="rh-atelier-entry-title">
          <div className="rh-atelier-section-title">
            <div>
              <p className="rh-atelier-kicker">PROJECT INITIALIZATION</p>
              <h2 id="rh-atelier-entry-title">Architectural Studio Launcher</h2>
            </div>
            <button
              type="button"
              data-testid="cta-open-existing"
              onClick={onOpenExisting}
              className="rh-outline-action"
            >
              <FolderOpen size={15} /> Browse Project Library
            </button>
          </div>

          <div className="rh-launcher-grid">
            <button
              type="button"
              className="rh-launcher-card rh-launcher-card--primary"
              data-testid="cta-new-construction"
              onClick={() => onStartNewProject('new_construction')}
            >
              <div className="rh-launcher-card-media">
                <img src={photoUrl(architecturePhotos.residence)} alt="" loading="lazy" />
                <span className="rh-launcher-badge">01 · GREENFIELD</span>
              </div>
              <div className="rh-launcher-card-body">
                <div className="rh-launcher-card-head">
                  <Building2 size={18} />
                  <strong>New Architectural Project</strong>
                </div>
                <small>
                  Define site parcel, setbacks, tower height, massing geometry, and 1BHK–4BHK apartment mix.
                </small>
                <span className="rh-launcher-link">
                  Configure Project Brief <ArrowRight size={15} />
                </span>
              </div>
            </button>

            <button
              type="button"
              className="rh-launcher-card"
              data-testid="cta-redevelopment"
              onClick={() => onStartNewProject('redevelopment')}
            >
              <div className="rh-launcher-card-media">
                <img src={photoUrl(architecturePhotos.construction)} alt="" loading="lazy" />
                <span className="rh-launcher-badge">02 · REDEVELOPMENT</span>
              </div>
              <div className="rh-launcher-card-body">
                <div className="rh-launcher-card-head">
                  <Layers size={18} />
                  <strong>Redevelopment (Duplex / Triplex)</strong>
                </div>
                <small>
                  Document existing structure, retained/demolished zones, linked multi-level duplexes, and member area briefs.
                </small>
                <span className="rh-launcher-link">
                  Open Redevelopment Brief <ArrowRight size={15} />
                </span>
              </div>
            </button>

            <button
              type="button"
              className="rh-launcher-card"
              data-testid="cta-import-cad"
              onClick={() => {
                if (onImportReference) {
                  onImportReference();
                } else {
                  onStartNewProject('new_construction');
                }
              }}
            >
              <div className="rh-launcher-card-icon-stage">
                <FileUp size={34} />
                <span className="rh-launcher-badge">03 · REFERENCE IMPORT</span>
              </div>
              <div className="rh-launcher-card-body">
                <div className="rh-launcher-card-head">
                  <FileUp size={18} />
                  <strong>Import Existing PDF / CAD</strong>
                </div>
                <small>
                  Upload architectural PDF sheets, DXF surveys, or reference plans for scale calibration and 2D/3D modeling.
                </small>
                <span className="rh-launcher-link">
                  Upload &amp; Calibrate Drawing <ArrowRight size={15} />
                </span>
              </div>
            </button>

            <button
              type="button"
              className="rh-launcher-card"
              data-testid="cta-recent-projects"
              onClick={onOpenExisting}
            >
              <div className="rh-launcher-card-icon-stage">
                <FolderOpen size={34} />
                <span className="rh-launcher-badge">04 · ARCHIVE</span>
              </div>
              <div className="rh-launcher-card-body">
                <div className="rh-launcher-card-head">
                  <FolderOpen size={18} />
                  <strong>Recent Projects</strong>
                </div>
                <small>
                  Resume saved residential towers, compare massing revisions, inspect compliance audits, and export BIM deliverables.
                </small>
                <span className="rh-launcher-link">
                  Open Recent Projects <ArrowRight size={15} />
                </span>
              </div>
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

import React, { Suspense, useMemo, useState } from 'react';
import type { BuildingMassingShape, EngineeringOverlay, PlanCategory } from '@ai-floor-planner/core';
import { apartmentFloorOutline } from '@ai-floor-planner/geometry-engine';
import {
  BUILDING_SHAPE_CATALOG,
  PLAN_CATEGORY_CATALOG,
  GeometryValidator,
  evaluateStudioLayoutScore,
} from '@ai-floor-planner/planning-engine';
import type { EditorContextValue } from '../../stores/editor-store';
import { ArchitecturalCanvas } from '../canvas/ArchitecturalCanvas';
import { PropertyInspector } from '../inspector/PropertyInspector';
import { requestVerifiedExport, downloadVerifiedExport } from '../../services/export-client';
import type { WorkspaceLayer } from '../workspace/BuildingNavigator';

const LazyPrecisionCadWorkbench = React.lazy(() => import('./PrecisionCadWorkbench'));

export interface ArchitecturalCADWorkspaceProps {
  editor: EditorContextValue;
  onRegeneratePlan?: () => void;
  initialPrecisionCadOpen?: boolean;
  onSelectMassingVariant?: (shape: BuildingMassingShape) => void;
  onSelectPlanCategory?: (category: PlanCategory) => void;
  onToggleAutoExplore?: (enabled: boolean) => void;
  autoExploreEnabled?: boolean;
  onOpenEditPlan?: () => void;
  generationSeed?: number;
  isGenerating?: boolean;
  canRegenerate?: boolean;
}

const VARIANT_MASSING_CHOICES: ReadonlyArray<{ id: BuildingMassingShape; label: string }> = [
  { id: 'CURVED_CRESCENT', label: 'Curved Crescent' },
  { id: 'Y_SHAPE_TRISKELE', label: 'Y-Triskele' },
  { id: 'TRIANGULAR_ATRIUM', label: 'Triangular' },
  { id: 'ROTUNDA_COURTYARD', label: 'Rotunda' },
  { id: 'H_SHAPE_WING', label: 'H-Shape' },
  { id: 'COMPACT_DOUBLE_LOADED', label: 'Compact' },
];

export const ArchitecturalCADWorkspace: React.FC<ArchitecturalCADWorkspaceProps> = ({
  editor,
  onRegeneratePlan,
  initialPrecisionCadOpen = false,
  onSelectMassingVariant,
  onSelectPlanCategory,
  onToggleAutoExplore,
  autoExploreEnabled = false,
  onOpenEditPlan,
  generationSeed = 1,
  isGenerating = false,
  canRegenerate = true,
}) => {
  const activeArchetype = editor.building.metadata.generationBrief?.archetype;
  const activeMassingShape = editor.building.metadata.generationBrief?.buildingMassingShape;
  const activePlanCategory = editor.building.metadata.generationBrief?.planCategory as PlanCategory | undefined;
  const [shapeDrawerOpen, setShapeDrawerOpen] = useState(false);
  const [scoreDrawerOpen, setScoreDrawerOpen] = useState(false);
  const [precisionCadOpen, setPrecisionCadOpen] = useState(initialPrecisionCadOpen);
  React.useEffect(() => {
    if (initialPrecisionCadOpen) setPrecisionCadOpen(true);
  }, [initialPrecisionCadOpen]);
  const [entityLayers, setEntityLayers] = useState({ columns: false, beams: false, furniture: true });
  const [disciplines, setDisciplines] = useState<Record<EngineeringOverlay, boolean>>({
    ARCHITECTURAL: true,
    STRUCTURAL: false,
    ELECTRICAL: false,
    PLUMBING: false,
    FALSE_CEILING: false,
    FIRE_SAFETY: false,
  });
  const [exportStatus, setExportStatus] = useState('');
  const controller = React.useRef(new AbortController());
  React.useEffect(() => {
    controller.current.abort();
    controller.current = new AbortController();
    setExportStatus('');
    return () => controller.current.abort();
  }, [editor.building, editor.activeFloor.id]);
  const snapshot = React.useRef(editor.building);
  snapshot.current = editor.building;
  const quickExport = async (format: 'dwg' | 'dxf' | 'pdf') => {
    const building = editor.building,
      signal = controller.current.signal;
    setExportStatus('Generating / verifying...');
    try {
      const artifact = await requestVerifiedExport(
        building,
        format,
        { floorId: editor.activeFloor.id, scale: 'FIT_TO_PAGE' },
        signal,
      );
      if (signal.aborted || snapshot.current !== building)
        throw new Error('Stale revision: export again');
      await downloadVerifiedExport(artifact, signal);
      setExportStatus(`VERIFIED ${artifact.sizeBytes} bytes · ${artifact.sha256?.slice(0, 12)}`);
    } catch (e) {
      setExportStatus(String(e));
    }
  };
  const [showCadUnderlay, setShowCadUnderlay] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const sourceCadUnderlay = editor.building.metadata.sourceCadUnderlay;
  const underlayBounds = useMemo(() => {
    const pts = sourceCadUnderlay?.polylines.flatMap(pl => pl.points) ?? [];
    if (!pts.length) return null;
    const minX = Math.min(...pts.map(p => p.x));
    const maxX = Math.max(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y));
    const maxY = Math.max(...pts.map(p => p.y));
    return { minX, minY, w: Math.max(1000, maxX - minX), h: Math.max(1000, maxY - minY) };
  }, [sourceCadUnderlay]);

  const [layers, setLayers] = useState<Record<WorkspaceLayer, boolean>>({
    rooms: true,
    walls: true,
    openings: true,
    stairs: true,
    dimensions: true,
    grid: false,
    validation: true,
    siteZones: true,
  });
  const report = useMemo(
    () => new GeometryValidator({ autoCorrect: false }).audit(editor.building, false).report,
    [editor.building],
  );
  const complianceReport = useMemo(
    () => evaluateStudioLayoutScore(editor.building),
    [editor.building],
  );
  const outlineVertexCount = useMemo(() => {
    try {
      const outline = apartmentFloorOutline(editor.activeFloor.walls);
      if (outline.points.length >= 4) return outline.points.length;
    } catch {
      // Fallback to activeFloor boundary polygon if walls do not form a closed ring
    }
    return editor.activeFloor.boundary.points.length;
  }, [editor.activeFloor.walls, editor.activeFloor.boundary.points.length]);
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-slate-950 text-slate-100"
      aria-label="Architectural CAD workspace"
    >
      <div className="rh-cad-actions flex flex-wrap items-center gap-3 border-b border-argon-border p-3">
        <h1 className="rh-workspace-title">2D Architectural CAD</h1>
        {onRegeneratePlan && (
          <button
            type="button"
            disabled={isGenerating || !canRegenerate}
            onClick={onRegeneratePlan}
            className="rounded bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {isGenerating ? 'Synthesizing...' : `Generate Massing Variant (Rev #${generationSeed})`}
          </button>
        )}
        {onOpenEditPlan && (
          <button
            type="button"
            onClick={onOpenEditPlan}
            className="rounded bg-argon-btn px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-argon-btnHover"
          >
            Wall &amp; Room Editor
          </button>
        )}
        <button
          type="button"
          data-testid="toggle-precision-cad-studio"
          aria-pressed={precisionCadOpen}
          onClick={() => setPrecisionCadOpen(open => !open)}
          className={`rounded border px-3 py-2 text-xs font-semibold transition-colors ${
            precisionCadOpen
              ? 'border-amber-300 bg-[#F4F4ED] text-[#122624]'
              : 'border-amber-400/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
          }`}
        >
          {precisionCadOpen ? 'Standard CAD Sheet' : 'Precision CAD Studio'}
        </button>
        <span
          className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2.5 py-1 font-mono text-xs font-medium text-sky-300"
          title={`${activeMassingShape ? activeMassingShape.replace(/_/g, ' ') : 'Architectural Massing'}${activeArchetype ? ` · ${activeArchetype.replace(/_/g, ' ')}` : ''}`}
        >
          {activeMassingShape ? activeMassingShape.replace(/_/g, ' ') : 'Architectural Massing'}
        </span>
        <button type="button" aria-expanded={scoreDrawerOpen} aria-controls="layout-score-breakdown" onClick={() => setScoreDrawerOpen(open => !open)}
          className={`rounded-full border px-2.5 py-1 font-mono text-xs font-semibold tabular-nums ${complianceReport.passed
            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
            : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
            }`}
        >
          Layout score {complianceReport.score} / 100
        </button>
        {(['dwg', 'dxf', 'pdf'] as const).map((format) => (
          <button
            key={format}
            className="rounded bg-slate-800 px-3 py-2 text-xs"
            onClick={() => void quickExport(format)}
          >
            Export {format.toUpperCase()}
          </button>
        ))}
        <span role="status" className="text-xs text-amber-200">
          {exportStatus}
        </span>
      </div>
      {scoreDrawerOpen && <aside id="layout-score-breakdown" aria-label="Score Breakdown" className="absolute right-0 top-16 z-40 max-h-[75vh] w-full max-w-md overflow-auto border border-argon-border bg-slate-900 p-4 shadow-xl">
        <header className="flex items-center justify-between gap-4"><h2 className="text-lg font-semibold">Score Breakdown</h2>
          <button type="button" onClick={() => setScoreDrawerOpen(false)}>Close</button></header>
        <p className="mt-2 text-xs">Revision {editor.building.version} · {complianceReport.basePoints} base points</p>
        <ul className="mt-2 divide-y divide-slate-700">{complianceReport.criteria.map(row => <li key={row.label} className="py-2 text-sm">
          <div className="flex justify-between gap-4"><strong>{row.label}</strong><span>{row.earned}/{row.points} · {row.unresolved ? 'unverified' : `−${row.points - row.earned}`}</span></div>
          {row.findings.length > 0 && <details><summary>{row.findings.length} findings</summary><ul className="break-words text-xs">{row.findings.map((finding, index) =>
            <li key={`${finding.id}-${index}`} className="mt-2"><strong>{finding.id}</strong> · {finding.elementIds.join(', ')}<p>{finding.actual} · Required {finding.required}</p></li>)}</ul></details>}
        </li>)}</ul>
      </aside>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 bg-slate-900/95 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
            Footprint Geometry:
          </span>
          <span
            data-testid="footprint-vertex-classification"
            className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold ${outlineVertexCount > 4
              ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200'
              : 'border-slate-600 bg-slate-800 text-slate-300'
              }`}
          >
            {outlineVertexCount > 4
              ? `Polygonal (${outlineVertexCount} vertices)`
              : `Rectangular (${outlineVertexCount} vertices)`}
          </span>
        </div>
        {onSelectMassingVariant && (
          <div className="relative flex flex-wrap items-center gap-1.5" role="group" aria-label="N-Shape & Category Alternatives">
            <span className="font-mono text-[11px] text-slate-400 mr-1">Shapes:</span>
            {VARIANT_MASSING_CHOICES.map((choice) => {
              const isSelected = activeMassingShape === choice.id;
              return (
                <button
                  key={choice.id}
                  type="button"
                  data-testid={`cad-variant-${choice.id}`}
                  disabled={isGenerating || !canRegenerate}
                  onClick={() => onSelectMassingVariant(choice.id)}
                  className={`rounded px-2.5 py-1 text-[11px] font-mono transition-colors disabled:opacity-45 ${isSelected
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                    }`}
                >
                  {choice.label}
                </button>
              );
            })}
            <button
              type="button"
              data-testid="switch-shape-category-btn"
              onClick={() => setShapeDrawerOpen(v => !v)}
              className="rounded border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-mono font-semibold text-cyan-200 hover:bg-cyan-500/25"
            >
              Switch Shape / Category ({BUILDING_SHAPE_CATALOG.length})
            </button>
            {shapeDrawerOpen && (
              <div
                data-testid="cad-shape-category-drawer"
                className="absolute right-0 top-9 z-40 w-[560px] max-w-[92vw] max-h-[70vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/95 p-3 shadow-2xl backdrop-blur"
              >
                <div className="flex items-center justify-between border-b border-slate-700 pb-2 mb-2">
                  <span className="text-xs font-bold text-amber-300">
                    Shape &amp; Residential Category Catalog ({BUILDING_SHAPE_CATALOG.length}+)
                  </span>
                  <div className="flex items-center gap-2">
                    {onToggleAutoExplore && (
                      <button
                        type="button"
                        onClick={() => onToggleAutoExplore(!autoExploreEnabled)}
                        className={`rounded px-2 py-0.5 text-[10px] font-mono border ${autoExploreEnabled
                          ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                          : 'bg-slate-800 text-slate-300 border-slate-600'
                          }`}
                      >
                        Auto-Explore Novel Shape: {autoExploreEnabled ? 'ON' : 'OFF'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShapeDrawerOpen(false)}
                      className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700"
                    >
                      Close
                    </button>
                  </div>
                </div>
                {onSelectPlanCategory && (
                  <div className="mb-3">
                    <div className="text-[10px] font-mono uppercase text-slate-400 mb-1.5">Plan Categories</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {PLAN_CATEGORY_CATALOG.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => {
                            onSelectPlanCategory(cat.id);
                            setShapeDrawerOpen(false);
                          }}
                          className={`rounded border p-1.5 text-left flex items-center gap-2 ${activePlanCategory === cat.id
                            ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                            : 'border-slate-700 bg-slate-800/70 text-slate-200 hover:bg-slate-800'
                            }`}
                        >
                          <svg viewBox="0 0 80 60" className="w-8 h-6 shrink-0">
                            <path d={cat.svgPath} fill="none" stroke="currentColor" strokeWidth="3" />
                          </svg>
                          <span className="text-[10px] font-semibold leading-tight">{cat.shortLabel}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="text-[10px] font-mono uppercase text-slate-400 mb-1.5">All Massing Geometries</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {BUILDING_SHAPE_CATALOG.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      data-testid={`drawer-shape-${entry.id}`}
                      onClick={() => {
                        onSelectMassingVariant(entry.id);
                        setShapeDrawerOpen(false);
                      }}
                      className={`rounded border p-1.5 text-left flex items-center gap-2 ${activeMassingShape === entry.id
                        ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                        : 'border-slate-700 bg-slate-800/70 text-slate-200 hover:bg-slate-800'
                        }`}
                    >
                      <svg viewBox="0 0 80 60" className="w-9 h-7 shrink-0">
                        <path d={entry.svgPath} fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="2.5" />
                      </svg>
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold truncate">{entry.label}</div>
                        <div className="text-[9px] text-slate-400">{entry.supportsCurves ? 'Curved Arc' : entry.supportsNonOrthogonal ? 'Polygonal' : 'Orthogonal'}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 bg-slate-900 p-3">
        <div
          className="flex shrink-0 gap-2 overflow-x-auto"
          aria-label="Model floors"
        >
          {editor.building.floors.map((floor) => (
            <button
              key={floor.id}
              onClick={() => editor.switchFloor(floor.id)}
              className={`shrink-0 rounded px-3 py-2 text-xs ${floor.id === editor.activeFloor.id ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}
            >
              {floor.name}
            </button>
          ))}
        </div>
        <button type="button" aria-expanded={showInspector} aria-controls="drawing-inspector"
          className="rounded bg-slate-800 px-3 py-2 text-xs text-slate-200"
          onClick={() => setShowInspector(visible => !visible)}>
          {showInspector ? 'Hide inspector' : 'Show inspector'}
        </button>
        <div
          className="argon-tool-strip argon-discipline-toolbar flex flex-wrap items-center gap-1.5"
          role="toolbar"
          aria-label="Engineering discipline overlay switcher"
        >
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Discipline Plans:
          </span>
          {(
            [
              ['ARCHITECTURAL', 'Architectural Plan'],
              ['STRUCTURAL', 'Structural + Chajja Plan'],
              ['ELECTRICAL', 'Electrical Plan (M-ELEC)'],
              ['PLUMBING', 'Plumbing & OTS Duct Plan (M-PLUMB)'],
              ['FIRE_SAFETY', 'Fire Safety Plan (F-FIRE)'],
              ['FALSE_CEILING', 'False Ceiling Plan (A-CEIL)'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={disciplines[key]}
              onClick={() => {
                const nextVal = !disciplines[key];
                setDisciplines((p) => ({ ...p, [key]: nextVal }));
                if (key === 'STRUCTURAL') {
                  setEntityLayers((p) => ({ ...p, columns: nextVal, beams: nextVal }));
                }
              }}
              className={`shrink-0 rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${disciplines[key]
                ? 'bg-cyan-500 text-slate-950 font-semibold'
                : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {precisionCadOpen ? (
        <div className="min-h-0 flex-1">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center bg-[#F4F4ED] font-mono text-xs text-[#122624]">
                Loading Precision CAD Studio...
              </div>
            }
          >
            <LazyPrecisionCadWorkbench
              editor={editor}
              onExitPrecisionStudio={() => setPrecisionCadOpen(false)}
            />
          </Suspense>
        </div>
      ) : (
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-[320px] min-w-0 flex-1">
          <ArchitecturalCanvas
            modelOnly
            entityLayers={entityLayers}
            disciplines={disciplines}
            editor={editor}
            snapEnabled
            layers={layers}
            fitRequest={0}
          />
          {showCadUnderlay && sourceCadUnderlay && underlayBounds && (
            <div
              data-testid="cad-underlay-overlay"
              className="pointer-events-none absolute bottom-4 left-4 z-20 w-72 rounded-xl border border-sky-400/40 bg-[#080A0F]/90 p-2.5 shadow-2xl backdrop-blur"
            >
              <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-sky-300">
                <span>CAD UNDERLAY · {sourceCadUnderlay.fileName}</span>
                <span>{sourceCadUnderlay.detectedUnit.toUpperCase()}</span>
              </div>
              <svg
                viewBox={`${underlayBounds.minX - 500} ${underlayBounds.minY - 500} ${underlayBounds.w + 1000} ${underlayBounds.h + 1000}`}
                className="h-44 w-full rounded bg-black/50"
                preserveAspectRatio="xMidYMid meet"
              >
                {sourceCadUnderlay.polylines.map((pl, idx) => (
                  <path
                    key={idx}
                    d={pl.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + (pl.closed ? ' Z' : '')}
                    fill="none"
                    stroke="#38BDF8"
                    strokeOpacity={0.8}
                    strokeWidth={Math.max(underlayBounds.w * 0.005, 45)}
                  />
                ))}
              </svg>
            </div>
          )}
        </div>
        <aside id="drawing-inspector" aria-label="Drawing inspector" hidden={!showInspector}
          className="rh-drawing-inspector w-full overflow-auto border-t border-slate-700 bg-slate-900 p-5 lg:w-80 lg:border-l lg:border-t-0">
          <PropertyInspector editor={editor} embedded />
          <h2 className="font-bold">Geometry audit · revision {editor.building.version}</h2>
          <p className={`my-3 text-sm ${report.isValid ? 'text-emerald-300' : 'text-amber-300'}`}>
            {report.isValid ? 'INTERNAL GEOMETRY CHECK PASSED' : 'CORRECTION REQUIRED'}
          </p>
          <p className="text-xs text-slate-300">Measured area delta: {report.planarDeltaMm2} mm²</p>
          <p className="my-3 text-xs text-slate-400">
            This software check does not certify structural safety or regulatory compliance.
            Professional review required.
          </p>
          <div className="my-4 flex flex-wrap gap-2">
            {(
              ['rooms', 'walls', 'openings', 'stairs', 'dimensions', 'grid'] as WorkspaceLayer[]
            ).map((layer) => (
              <button
                key={layer}
                aria-pressed={layers[layer]}
                onClick={() =>
                  setLayers((previous) => ({ ...previous, [layer]: !previous[layer] }))
                }
                className={`rounded px-2 py-1 text-xs ${layers[layer] ? 'bg-amber-500/20 text-amber-200' : 'bg-slate-800 text-slate-400'}`}
              >
                {layer}
              </button>
            ))}
          </div>
          <ul className="space-y-3 text-xs">
            {report.errors
              .filter((error) => !error.autoCorrected)
              .map((error, index) => (
                <li key={`${error.code}-${index}`} className="rounded border border-slate-700 p-2">
                  <strong>{error.code}</strong>
                  <p className="mt-1 text-slate-300">{error.description}</p>
                </li>
              ))}
          </ul>
        </aside>
      </div>
      )}
      <div
        aria-label="CAD layers"
        className="flex shrink-0 flex-wrap gap-2 border-t border-slate-700 bg-slate-900 p-3"
      >
        {(['walls', 'openings', 'stairs', 'dimensions'] as const).map((layer) => (
          <button
            key={layer}
            aria-pressed={layers[layer]}
            onClick={() => setLayers((p) => ({ ...p, [layer]: !p[layer] }))}
          >
            {
              {
                walls: 'Walls',
                openings: 'Doors/Windows',
                stairs: 'Staircases',
                dimensions: 'Dimensions',
              }[layer]
            }
          </button>
        ))}
        {(['columns', 'beams', 'furniture'] as const).map((layer) => (
          <button
            key={layer}
            aria-pressed={entityLayers[layer]}
            onClick={() => setEntityLayers((p) => ({ ...p, [layer]: !p[layer] }))}
          >
            {layer[0]!.toUpperCase() + layer.slice(1)}
          </button>
        ))}
        {sourceCadUnderlay && (
          <button
            type="button"
            data-testid="toggle-cad-underlay"
            aria-pressed={showCadUnderlay}
            onClick={() => setShowCadUnderlay(v => !v)}
            className={`rounded px-2.5 py-1 text-xs font-mono border ${
              showCadUnderlay
                ? 'border-sky-400/60 bg-sky-500/20 text-sky-200'
                : 'border-slate-700 bg-slate-800 text-slate-300'
            }`}
          >
            CAD Underlay ({sourceCadUnderlay.fileName})
          </button>
        )}
      </div>
    </section>
  );
};

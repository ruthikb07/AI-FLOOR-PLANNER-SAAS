import React, { useEffect, useState, useMemo, useRef } from 'react';
import type { EditorContextValue } from '../../stores/editor-store';
import { apartmentFloorOutline, architecturalSlabCutouts, containsPolygon } from '@ai-floor-planner/geometry-engine';
import {
  Layers,
  Download,
  Eye,
  ShieldAlert,
  FileText,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import {
  requestVerifiedExport,
  downloadVerifiedExport,
  fetchVerifiedBytes,
} from '../../services/export-client';

export type StructuralCADViewMode =
  | 'FOUNDATION_COLUMNS'
  | 'BEAM_FRAMING'
  | 'SLAB_DETAILING'
  | 'ETABS_UTILIZATION';

export const StructuralCADWorkspace: React.FC<{ editor: EditorContextValue }> = ({ editor }) => {
  const { building } = editor;
  const [viewMode, setViewMode] = useState<StructuralCADViewMode>('FOUNDATION_COLUMNS');
  const [selectedFloorId, setSelectedFloorId] = useState<string>(() => building.floors[0]?.id || '');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [previewModal, setPreviewModal] = useState<{ url: string; title: string; text?: string } | null>(null);

  const controller = useRef(new AbortController());
  useEffect(() => {
    const next = new AbortController();
    controller.current = next;
    setPreviewModal(null);
    setBusy(false);
    setStatusMessage('');
    return () => next.abort();
  }, [building]);
  useEffect(() => () => {
    if (previewModal) URL.revokeObjectURL(previewModal.url);
  }, [previewModal]);

  // Determine structural elements and grids from building
  const activeFloor = useMemo(() => {
    return building.floors.find((f) => f.id === selectedFloorId) || building.floors[0];
  }, [building.floors, selectedFloorId]);

  const { gridXs, gridYs, columns, beams, outline } = useMemo(() => {
    const columns = activeFloor?.columns ?? [];
    const beams = activeFloor?.beams ?? [];
    let outline = activeFloor?.boundary.points ?? [];
    if (activeFloor?.walls.length) {
      try {
        outline = apartmentFloorOutline(activeFloor.walls).points;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('WALL_TOPOLOGY_INVALID:')) throw error;
      }
    }
    const gridXs = [...new Set(columns.map((column) => column.position.x))].sort((a, b) => a - b);
    const gridYs = [...new Set(columns.map((column) => column.position.y))].sort((a, b) => a - b);
    return { gridXs, gridYs, columns, beams, outline };
  }, [activeFloor]);
  const slabRings = activeFloor ? [outline, ...architecturalSlabCutouts(activeFloor)
    .filter(cutout => containsPolygon({ points: outline }, cutout)).map(cutout => cutout.points)] : [];
  const slabPath = slabRings.filter(ring => ring.length >= 3).map(ring => `M ${ring.map(point => `${point.x},${point.y}`).join(' L ')} Z`).join(' ');

  // Canvas bounds calculation
  const canvasBounds = useMemo(() => {
    const xs = [...gridXs, ...outline.map(({ x }) => x),
      ...beams.flatMap(({ startPoint, endPoint }) => [startPoint.x, endPoint.x])];
    const ys = [...gridYs, ...outline.map(({ y }) => y),
      ...beams.flatMap(({ startPoint, endPoint }) => [startPoint.y, endPoint.y])];
    const minX = (xs.length ? Math.min(...xs) : 0) - 2500;
    const maxX = (xs.length ? Math.max(...xs) : 0) + 2500;
    const minY = (ys.length ? Math.min(...ys) : 0) - 2500;
    const maxY = (ys.length ? Math.max(...ys) : 0) + 2500;
    const width = maxX - minX;
    const height = maxY - minY;
    return { minX, minY, maxX, maxY, width, height };
  }, [gridXs, gridYs, outline, beams]);

  async function exportStructuralArtifact(
    format: 'structural-drawings-pdf' | 'structural-report-pdf' | 'structural-report-json',
    action: 'download' | 'preview',
  ) {
    const signal = controller.current.signal;
    setBusy(true);
    setStatusMessage(format === 'structural-drawings-pdf'
      ? 'Preparing structural drawings…' : 'Requesting the analysis report…');
    try {
      const artifact = await requestVerifiedExport(
        building, format, { drawingKind: 'STRUCTURAL', exportScope: 'all_floors' }, signal,
      );
      if (signal.aborted) return;
      if (action === 'download') {
        await downloadVerifiedExport(artifact, signal);
        if (!signal.aborted) setStatusMessage(`Download started · ${artifact.fileName}`);
      } else {
        const bytes = await fetchVerifiedBytes(artifact, signal);
        if (signal.aborted) return;
        setPreviewModal({ url: URL.createObjectURL(bytes), title: artifact.title });
        setStatusMessage('Verified preview opened.');
      }
    } catch (error) {
      if (!signal.aborted) setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col rh-workspace bg-argon-bg text-argon-text font-sans" aria-label="Structural CAD Workspace">
      {/* Top Engineering Ribbon */}
      <header className="flex flex-wrap items-center justify-between border-b border-argon-border bg-argon-card/90 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-argon-surface border border-argon-border text-argon-btn">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="rh-workspace-title">Structural CAD</h1>
            </div>
            <p className="text-[11px] text-argon-muted">
              {building.name || 'RH Planner Project'} · Rev {building.version} · Preliminary framing
            </p>
          </div>
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center rounded-lg border border-argon-border bg-argon-bg/70 p-1">
          <button
            onClick={() => setViewMode('FOUNDATION_COLUMNS')}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === 'FOUNDATION_COLUMNS'
                ? 'bg-argon-btn text-argon-card shadow-xs'
                : 'text-argon-muted hover:text-argon-text'
            }`}
          >
            Columns
          </button>
          <button
            onClick={() => setViewMode('BEAM_FRAMING')}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === 'BEAM_FRAMING'
                ? 'bg-argon-btn text-argon-card shadow-xs'
                : 'text-argon-muted hover:text-argon-text'
            }`}
          >
            Beam Framing
          </button>
          <button
            onClick={() => setViewMode('SLAB_DETAILING')}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === 'SLAB_DETAILING'
                ? 'bg-argon-btn text-argon-card shadow-xs'
                : 'text-argon-muted hover:text-argon-text'
            }`}
          >
            Slab outline
          </button>
          <button
            onClick={() => setViewMode('ETABS_UTILIZATION')}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === 'ETABS_UTILIZATION'
                ? 'bg-argon-btn text-argon-card shadow-xs'
                : 'text-argon-muted hover:text-argon-text'
            }`}
          >
            ETABS status
          </button>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2">
          <button
            disabled={busy}
            onClick={() => void exportStructuralArtifact('structural-drawings-pdf', 'preview')}
            className="flex items-center gap-1.5 rounded-lg border border-argon-border bg-argon-surface px-3 py-1.5 text-xs font-semibold text-argon-text hover:bg-argon-border disabled:opacity-50"
            title="Preview Multi-Sheet ISO A3 Structural Drawing Set (S-101 to S-104)"
          >
            <Eye className="h-3.5 w-3.5" />
            Preview Drawings
          </button>
          <button
            disabled={busy}
            onClick={() => void exportStructuralArtifact('structural-drawings-pdf', 'download')}
            className="flex items-center gap-1.5 rounded-lg border border-indigo-600/70 bg-indigo-600/20 px-3 py-1.5 text-xs font-semibold text-argon-text hover:bg-indigo-600/30 disabled:opacity-50"
            title="Download ISO A3 Structural Drawings PDF"
          >
            <Download className="h-3.5 w-3.5" />
            Drawings (A3 PDF)
          </button>
          <button
            disabled={busy}
            onClick={() => void exportStructuralArtifact('structural-report-pdf', 'download')}
            className="flex items-center gap-1.5 rounded-lg border border-amber-600/70 bg-amber-600/20 px-3 py-1.5 text-xs font-semibold text-argon-text hover:bg-amber-600/30 disabled:opacity-50"
            title="Download Comprehensive ETABS Structural Analysis & IS Code Report"
          >
            <FileText className="h-3.5 w-3.5" />
            Analysis Report
          </button>
          <button
            disabled={busy}
            onClick={() => void exportStructuralArtifact('structural-report-json', 'download')}
            className="flex items-center gap-1.5 rounded-lg border border-argon-border bg-argon-surface/80 px-2.5 py-1.5 text-xs font-semibold text-argon-muted hover:bg-argon-border disabled:opacity-50"
            title="Download the verified structural analysis report in JSON"
          >
            Report JSON
          </button>
        </div>
      </header>

      {/* Main Workspace Body: Canvas + Structural Inspector */}
      <div className="rh-workspace-body flex flex-1 min-h-0 flex-col lg:flex-row">
        {/* Left / Center Canvas Area */}
        <div className="flex-1 relative flex flex-col min-h-[300px] bg-[#171b1d] overflow-hidden select-none">
          {/* Floor & Level Switcher Bar */}
          <div className="absolute top-3 inset-x-4 z-10 flex max-w-max flex-wrap items-center gap-1 rounded-lg border border-argon-border bg-argon-card/90 p-1 shadow-lg backdrop-blur">
            <span className="px-2 text-[11px] font-semibold text-argon-muted uppercase tracking-wider">Level:</span>
            {building.floors.map((f, i) => (
              <button
                key={f.id}
                onClick={() => setSelectedFloorId(f.id)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  (activeFloor?.id === f.id)
                    ? 'bg-argon-btn text-argon-card'
                    : 'text-argon-muted hover:text-argon-text'
                }`}
              >
                {i === 0 ? 'Foundation / Stilt' : f.name || `L${i}`}
              </button>
            ))}
          </div>

          {/* Canvas Navigation Toolbar */}
          <div className="absolute top-3 right-4 z-10 flex items-center gap-1 rounded-lg border border-argon-border bg-argon-card/90 p-1 shadow-lg backdrop-blur">
            <button
              onClick={() => setZoom((z) => Math.min(z * 1.25, 4))}
              className="p-1.5 text-argon-muted hover:text-white rounded hover:bg-argon-surface"
              title="Zoom In"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(z / 1.25, 0.4))}
              className="p-1.5 text-argon-muted hover:text-white rounded hover:bg-argon-surface"
              title="Zoom Out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="p-1.5 text-argon-muted hover:text-white rounded hover:bg-argon-surface"
              title="Reset View"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* SVG Structural Engineering Canvas */}
          <div
            className="flex-1 w-full h-full cursor-grab active:cursor-grabbing flex items-center justify-center overflow-hidden"
            onMouseDown={(e) => {
              setIsDragging(true);
              setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
            }}
            onMouseMove={(e) => {
              if (isDragging) {
                setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
              }
            }}
            onMouseUp={() => setIsDragging(false)}
            onMouseLeave={() => setIsDragging(false)}
          >
            <svg
              className="w-full h-full"
              viewBox={`${canvasBounds.minX} ${canvasBounds.minY} ${canvasBounds.width} ${canvasBounds.height}`}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
              }}
            >
              <defs>
                {/* Diagonal hatch for footings */}
                {/* Slab hatch */}
                <pattern id="slabHatch" width="1200" height="1200" patternUnits="userSpaceOnUse">
                  <path d="M 0 600 L 1200 600 M 600 0 L 600 1200" stroke="#1e293b" strokeWidth="40" strokeDasharray="100 100" />
                </pattern>
              </defs>

              {/* 1. Grid Lines along X (A, B, C...) */}
              {gridXs.map((x, i) => {
                const tag = String.fromCharCode(65 + i);
                const startY = Math.min(...gridYs) - 1500;
                const endY = Math.max(...gridYs) + 1500;
                return (
                  <g key={`grid_x_${tag}`}>
                    <line
                      x1={x}
                      y1={startY}
                      x2={x}
                      y2={endY}
                      stroke="#dc2626"
                      strokeWidth="50"
                      strokeDasharray="400 200 100 200"
                      opacity="0.85"
                    />
                    {/* Grid bubbles at both ends */}
                    <circle cx={x} cy={startY - 600} r="500" fill="#0f172a" stroke="#dc2626" strokeWidth="70" />
                    <text x={x} y={startY - 460} textAnchor="middle" fill="#f87171" fontSize="420" fontWeight="bold">
                      {tag}
                    </text>
                    <circle cx={x} cy={endY + 600} r="500" fill="#0f172a" stroke="#dc2626" strokeWidth="70" />
                    <text x={x} y={endY + 740} textAnchor="middle" fill="#f87171" fontSize="420" fontWeight="bold">
                      {tag}
                    </text>
                  </g>
                );
              })}

              {/* 2. Grid Lines along Y (1, 2, 3...) */}
              {gridYs.map((y, i) => {
                const tag = String(i + 1);
                const startX = Math.min(...gridXs) - 1500;
                const endX = Math.max(...gridXs) + 1500;
                return (
                  <g key={`grid_y_${tag}`}>
                    <line
                      x1={startX}
                      y1={y}
                      x2={endX}
                      y2={y}
                      stroke="#dc2626"
                      strokeWidth="50"
                      strokeDasharray="400 200 100 200"
                      opacity="0.85"
                    />
                    {/* Grid bubbles at both ends */}
                    <circle cx={startX - 600} cy={y} r="500" fill="#0f172a" stroke="#dc2626" strokeWidth="70" />
                    <text x={startX - 600} y={y + 140} textAnchor="middle" fill="#f87171" fontSize="420" fontWeight="bold">
                      {tag}
                    </text>
                    <circle cx={endX + 600} cy={y} r="500" fill="#0f172a" stroke="#dc2626" strokeWidth="70" />
                    <text x={endX + 600} y={y + 140} textAnchor="middle" fill="#f87171" fontSize="420" fontWeight="bold">
                      {tag}
                    </text>
                  </g>
                );
              })}

              {viewMode === 'SLAB_DETAILING' && (
                <g id="slabs-layer">
                  <path d={slabPath} fillRule="evenodd" fill="url(#slabHatch)" stroke="#b08b5b" strokeWidth="45" />
                </g>
              )}
              {viewMode === 'FOUNDATION_COLUMNS' && activeFloor?.id === building.floors[0]?.id && (
                <g id="foundation-supports" aria-label="Preliminary foundation support locations">
                  {columns.map(({ id, position: { x, y }, width, depth }) => {
                    const marker = Math.max(width, depth) / 2 + 260;
                    return <path key={id} d={`M ${x - marker},${y} H ${x + marker} M ${x},${y - marker} V ${y + marker}`}
                      fill="none" stroke="#d1ae7c" strokeWidth="45"><title>Foundation support at {id}</title></path>;
                  })}
                </g>
              )}
              {viewMode === 'BEAM_FRAMING' && (
                <g id="beams-layer">
                  {beams.map((beam) => (
                    <line key={beam.id} x1={beam.startPoint.x} y1={beam.startPoint.y}
                      x2={beam.endPoint.x} y2={beam.endPoint.y} stroke="#d1ae7c"
                      strokeWidth={beam.widthMm} strokeLinecap="square">
                      <title>{beam.type} · {beam.widthMm} × {beam.depthMm} mm</title>
                    </line>
                  ))}
                </g>
              )}
              <g id="columns-layer">
                {columns.map((column) => (
                  <rect key={column.id} x={column.position.x - column.width / 2}
                    y={column.position.y - column.depth / 2} width={column.width} height={column.depth}
                    rx={column.shape === 'circular' ? Math.min(column.width, column.depth) / 2 : undefined}
                    fill="#f6f2ea" stroke="#b08b5b" strokeWidth="65">
                    <title>{column.gridReference ?? column.id} · {column.width} × {column.depth} mm</title>
                  </rect>
                ))}
              </g>
            </svg>
          </div>

          {/* Canvas Bottom Status Bar */}
          <footer className="flex items-center justify-between border-t border-argon-border bg-argon-card/90 px-4 py-1.5 text-xs text-argon-muted">
            <div className="flex flex-wrap items-center gap-3">
              <span>{activeFloor?.name}</span>
              <span>{columns.length} columns · {beams.length} beams</span>
            </div>
            {statusMessage && <div role="status" className="text-argon-text font-medium">{statusMessage}</div>}
          </footer>
        </div>

        <aside className="w-full lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-argon-border bg-argon-card p-4 overflow-auto">
          <p className="rh-kicker">Active level</p>
          <h2 className="rh-workspace-title">{activeFloor?.name ?? 'No level selected'}</h2>
          <dl className="my-3 grid grid-cols-2 gap-2 text-sm">
            <dt>Columns</dt><dd className="font-mono">{columns.length}</dd>
            <dt>Beams</dt><dd className="font-mono">{beams.length}</dd>
            <dt>Slab thickness</dt><dd className="font-mono">{activeFloor?.slabThicknessMm ? `${activeFloor.slabThicknessMm} mm` : 'Unavailable'}</dd>
          </dl>
          <p className="text-sm text-argon-muted">Foundation crosses locate preliminary supports. Footing sizes depend on verified loads and geotechnical inputs.</p>
          <p className="mt-2 text-sm text-argon-muted">Preliminary framing · verified ETABS results are unavailable.</p>
          <p className="mt-4 flex items-center gap-2 text-sm font-semibold"><ShieldAlert size={16} /> Professional review required</p>
        </aside>
      </div>

      {/* Preview Modal for Generated PDFs */}
      {previewModal && (
        <div
          role="dialog"
          aria-label={previewModal.title}
          className="fixed inset-6 z-50 flex flex-col rounded-xl border border-argon-border bg-argon-card p-4 shadow-2xl backdrop-blur"
        >
          <div className="mb-3 flex items-center justify-between border-b border-argon-border pb-2">
            <h3 className="font-bold text-argon-text">{previewModal.title}</h3>
            <button
              onClick={() => {
                URL.revokeObjectURL(previewModal.url);
                setPreviewModal(null);
              }}
              className="rounded bg-argon-surface px-3 py-1 text-xs text-argon-muted hover:bg-argon-border"
            >
              Close Preview
            </button>
          </div>
          <iframe
            src={previewModal.url}
            title={previewModal.title}
            className="flex-1 w-full rounded border border-argon-border bg-white"
          />
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useState, useMemo, useRef } from 'react';
import type { EditorContextValue } from '../../stores/editor-store';
import { apartmentFloorOutline, architecturalSlabCutouts, containsPolygon } from '@ai-floor-planner/geometry-engine';
import { evaluateIS456StructuralAnalysis } from '@ai-floor-planner/planning-engine';
import {
  Activity,
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
import { StructuralAnalysisPanel } from './StructuralAnalysisPanel';

export type StructuralCADViewMode =
  | 'FOUNDATION_COLUMNS'
  | 'BEAM_FRAMING'
  | 'SLAB_DETAILING'
  | 'STRUCTURAL_ANALYSIS';

function clusterGridValues(values: readonly number[], toleranceMm = 180): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[] = [];
  for (const v of sorted) {
    if (!clusters.some((c) => Math.abs(c - v) <= toleranceMm)) {
      clusters.push(v);
    }
  }
  return clusters;
}

function gridLabelX(i: number): string {
  if (i < 26) return String.fromCharCode(65 + i);
  return `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`;
}

export const StructuralCADWorkspace: React.FC<{ editor: EditorContextValue }> = ({ editor }) => {
  const { building } = editor;
  const [viewMode, setViewMode] = useState<StructuralCADViewMode>('FOUNDATION_COLUMNS');
  const [selectedFloorId, setSelectedFloorId] = useState<string>(() => {
    const firstRes = building.floors.find((f) => f.floorUse === 'RESIDENTIAL');
    return firstRes?.id || building.floors[0]?.id || '';
  });
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [previewModal, setPreviewModal] = useState<{ url: string; title: string; text?: string } | null>(null);
  const [selectedCadHint, setSelectedCadHint] = useState<{
    kind: 'COLUMN' | 'BEAM';
    xMm: number;
    yMm: number;
    floorId: string;
    label: string;
  } | null>(null);

  const controller = useRef(new AbortController());
  useEffect(() => {
    const next = new AbortController();
    controller.current = next;
    setPreviewModal(null);
    setSelectedCadHint(null);
    setBusy(false);
    setStatusMessage('');
    return () => next.abort();
  }, [building]);
  useEffect(() => () => {
    if (previewModal) URL.revokeObjectURL(previewModal.url);
  }, [previewModal]);

  const activeFloor = useMemo(() => {
    return building.floors.find((f) => f.id === selectedFloorId) || building.floors[0];
  }, [building.floors, selectedFloorId]);

  const quickAnalysis = useMemo(() => evaluateIS456StructuralAnalysis(building), [building]);

  const { gridXs, gridYs, columns, beams, walls, outline } = useMemo(() => {
    const columns = activeFloor?.columns ?? [];
    const beams = activeFloor?.beams ?? [];
    const walls = activeFloor?.walls ?? [];
    let outline = activeFloor?.boundary.points ?? [];
    if (activeFloor?.walls.length) {
      try {
        outline = apartmentFloorOutline(activeFloor.walls).points;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('WALL_TOPOLOGY_INVALID:')) throw error;
      }
    }
    const gridXs = clusterGridValues(columns.map((column) => column.position.x), 180);
    const gridYs = clusterGridValues(columns.map((column) => column.position.y), 180);
    return { gridXs, gridYs, columns, beams, walls, outline };
  }, [activeFloor]);

  const slabRings = activeFloor
    ? [
        outline,
        ...architecturalSlabCutouts(activeFloor)
          .filter((cutout) => containsPolygon({ points: outline }, cutout))
          .map((cutout) => cutout.points),
      ]
    : [];
  const slabPath = slabRings
    .filter((ring) => ring.length >= 3)
    .map((ring) => `M ${ring.map((point) => `${point.x},${point.y}`).join(' L ')} Z`)
    .join(' ');

  const canvasBounds = useMemo(() => {
    const xs = [
      ...gridXs,
      ...outline.map(({ x }) => x),
      ...beams.flatMap(({ startPoint, endPoint }) => [startPoint.x, endPoint.x]),
    ];
    const ys = [
      ...gridYs,
      ...outline.map(({ y }) => y),
      ...beams.flatMap(({ startPoint, endPoint }) => [startPoint.y, endPoint.y]),
    ];
    const minX = (xs.length ? Math.min(...xs) : 0) - 2800;
    const maxX = (xs.length ? Math.max(...xs) : 0) + 2800;
    const minY = (ys.length ? Math.min(...ys) : 0) - 2800;
    const maxY = (ys.length ? Math.max(...ys) : 0) + 2800;
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }, [gridXs, gridYs, outline, beams]);

  async function exportStructuralArtifact(
    format: 'structural-drawings-pdf' | 'structural-report-pdf' | 'structural-report-json',
    action: 'download' | 'preview',
  ) {
    const signal = controller.current.signal;
    setBusy(true);
    setStatusMessage(
      format === 'structural-drawings-pdf' ? 'Preparing structural drawings…' : 'Generating structural report…',
    );
    try {
      const artifact = await requestVerifiedExport(
        building,
        format,
        { drawingKind: 'STRUCTURAL', exportScope: 'all_floors' },
        signal,
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
    <div
      data-testid="structural-cad-workspace"
      className="flex h-full min-h-0 flex-col bg-[#0B101B] text-[#F8FAFC] font-sans"
      aria-label="Structural CAD Workspace"
    >
      {/* Top Engineering Ribbon — High-Contrast Dark Obsidian Glass */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/80 bg-[#0F172A] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-400/40 text-amber-300">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-[#F8FAFC]">Structural CAD &amp; RCC Framing</h1>
            <p className="text-[11px] font-mono text-slate-300">
              {building.name || 'RH Planner Project'} · Rev {building.version} · IS 456:2000 &amp; IS 1893:2016
            </p>
          </div>
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center rounded-lg border border-slate-700 bg-[#0B101B] p-1 gap-0.5">
          {([
            ['FOUNDATION_COLUMNS', 'Columns', 'struct-tab-columns'],
            ['BEAM_FRAMING', 'Beam Framing', 'struct-tab-beams'],
            ['SLAB_DETAILING', 'Slab Outline', 'struct-tab-slabs'],
            ['STRUCTURAL_ANALYSIS', 'Structural Analysis', 'struct-tab-analysis'],
          ] as const).map(([mode, label, testId]) => (
            <button
              key={mode}
              type="button"
              data-testid={testId}
              onClick={() => setViewMode(mode)}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                viewMode === mode
                  ? 'bg-amber-500 text-[#0B101B] shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              {mode === 'STRUCTURAL_ANALYSIS' && <Activity className="h-3.5 w-3.5" />}
              {label}
            </button>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportStructuralArtifact('structural-drawings-pdf', 'preview')}
            className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-[#F8FAFC] hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
          >
            <Eye className="h-3.5 w-3.5" />
            Preview Drawings
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportStructuralArtifact('structural-drawings-pdf', 'download')}
            className="flex items-center gap-1.5 rounded-lg border border-indigo-400/60 bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-100 hover:bg-indigo-500/30 disabled:opacity-50 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Drawings (A3 PDF)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportStructuralArtifact('structural-report-pdf', 'download')}
            className="flex items-center gap-1.5 rounded-lg border border-amber-400/70 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 disabled:opacity-50 cursor-pointer"
          >
            <FileText className="h-3.5 w-3.5" />
            Analysis Report
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportStructuralArtifact('structural-report-json', 'download')}
            className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
          >
            Report JSON
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      {viewMode === 'STRUCTURAL_ANALYSIS' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <StructuralAnalysisPanel
            building={building}
            reportBusy={busy}
            initialSelectedCoordinate={selectedCadHint}
            onDownloadReportPdf={() => void exportStructuralArtifact('structural-report-pdf', 'download')}
          />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
          {/* Left / Center Canvas Area */}
          <div className="flex-1 relative flex flex-col min-h-[300px] bg-[#11161F] overflow-hidden select-none">
            {/* Floor & Level Switcher Bar */}
            <div className="absolute top-3 left-4 z-10 flex max-w-[75%] flex-wrap items-center gap-1 rounded-lg border border-slate-700 bg-[#0B101B]/95 p-1 shadow-lg backdrop-blur">
              <span className="px-2 text-[11px] font-mono font-semibold text-amber-300 uppercase tracking-wider">Level:</span>
              {building.floors.map((f, i) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelectedFloorId(f.id)}
                  className={`rounded px-2 py-0.5 text-xs font-mono font-semibold transition-colors cursor-pointer ${
                    activeFloor?.id === f.id
                      ? 'bg-amber-500 text-[#0B101B]'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {i === 0 && f.floorUse === 'STILT_PARKING' ? 'Foundation / Stilt' : f.name || `L${i}`}
                </button>
              ))}
            </div>

            {/* Canvas Navigation Toolbar */}
            <div className="absolute top-3 right-4 z-10 flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0B101B]/95 p-1 shadow-lg backdrop-blur">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(z * 1.25, 4))}
                className="p-1.5 text-slate-300 hover:text-white rounded hover:bg-slate-800 cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(z / 1.25, 0.4))}
                className="p-1.5 text-slate-300 hover:text-white rounded hover:bg-slate-800 cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                className="p-1.5 text-slate-300 hover:text-white rounded hover:bg-slate-800 cursor-pointer"
                title="Reset View"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* SVG Structural Engineering Canvas */}
            <div
              className="flex-1 w-full h-full pt-12 pb-2 cursor-grab active:cursor-grabbing flex items-center justify-center overflow-hidden"
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
                  <pattern id="slabHatch" width="1200" height="1200" patternUnits="userSpaceOnUse">
                    <path d="M 0 600 L 1200 600 M 600 0 L 600 1200" stroke="#334155" strokeWidth="40" strokeDasharray="100 100" />
                  </pattern>
                </defs>

                {/* Architectural Wall Reference Underlay (proves every column is wall-corner locked) */}
                <g id="wall-reference-layer" opacity="0.32">
                  {walls.map((w) => (
                    <line
                      key={w.id}
                      x1={w.startPoint.x}
                      y1={w.startPoint.y}
                      x2={w.endPoint.x}
                      y2={w.endPoint.y}
                      stroke="#94a3b8"
                      strokeWidth={Math.max(115, w.thickness || 150)}
                      strokeLinecap="square"
                    />
                  ))}
                </g>

                {/* 1. Grid Lines along X (A, B, C...) */}
                {gridXs.length > 0 && gridYs.length > 0 && gridXs.map((x, i) => {
                  const tag = gridLabelX(i);
                  const startY = Math.min(...gridYs) - 1500;
                  const endY = Math.max(...gridYs) + 1500;
                  return (
                    <g key={`grid_x_${tag}`}>
                      <line
                        x1={x}
                        y1={startY}
                        x2={x}
                        y2={endY}
                        stroke="#ef4444"
                        strokeWidth="36"
                        strokeDasharray="400 200 100 200"
                        opacity="0.55"
                      />
                      <circle cx={x} cy={startY - 560} r="460" fill="#0f172a" stroke="#ef4444" strokeWidth="60" />
                      <text x={x} y={startY - 430} textAnchor="middle" fill="#fca5a5" fontSize="380" fontWeight="bold">
                        {tag}
                      </text>
                      <circle cx={x} cy={endY + 560} r="460" fill="#0f172a" stroke="#ef4444" strokeWidth="60" />
                      <text x={x} y={endY + 690} textAnchor="middle" fill="#fca5a5" fontSize="380" fontWeight="bold">
                        {tag}
                      </text>
                    </g>
                  );
                })}

                {/* 2. Grid Lines along Y (1, 2, 3...) */}
                {gridXs.length > 0 && gridYs.length > 0 && gridYs.map((y, i) => {
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
                        stroke="#ef4444"
                        strokeWidth="36"
                        strokeDasharray="400 200 100 200"
                        opacity="0.55"
                      />
                      <circle cx={startX - 560} cy={y} r="460" fill="#0f172a" stroke="#ef4444" strokeWidth="60" />
                      <text x={startX - 560} y={y + 130} textAnchor="middle" fill="#fca5a5" fontSize="380" fontWeight="bold">
                        {tag}
                      </text>
                      <circle cx={endX + 560} cy={y} r="460" fill="#0f172a" stroke="#ef4444" strokeWidth="60" />
                      <text x={endX + 560} y={y + 130} textAnchor="middle" fill="#fca5a5" fontSize="380" fontWeight="bold">
                        {tag}
                      </text>
                    </g>
                  );
                })}

                {viewMode === 'SLAB_DETAILING' && (
                  <g id="slabs-layer">
                    <path d={slabPath} fillRule="evenodd" fill="url(#slabHatch)" stroke="#f59e0b" strokeWidth="55" />
                  </g>
                )}

                {viewMode === 'FOUNDATION_COLUMNS' && activeFloor?.id === building.floors[0]?.id && (
                  <g id="foundation-supports" aria-label="Preliminary foundation support locations">
                    {columns.map(({ id, position: { x, y }, width, depth }) => {
                      const marker = Math.max(width, depth) / 2 + 280;
                      return (
                        <path
                          key={id}
                          d={`M ${x - marker},${y} H ${x + marker} M ${x},${y - marker} V ${y + marker}`}
                          fill="none"
                          stroke="#f59e0b"
                          strokeWidth="45"
                          opacity="0.7"
                        >
                          <title>Foundation support at {id}</title>
                        </path>
                      );
                    })}
                  </g>
                )}

                {/* Beam Framing Layer (prominent in Beam Framing mode, subtle framing reference in Columns mode) */}
                {(viewMode === 'BEAM_FRAMING' || viewMode === 'FOUNDATION_COLUMNS') && (
                  <g id="beams-layer" opacity={viewMode === 'BEAM_FRAMING' ? 0.95 : 0.42}>
                    {beams.map((beam) => {
                      const strokeColor =
                        beam.type === 'PRIMARY'
                          ? '#f59e0b'
                          : beam.type === 'CANTILEVER'
                            ? '#a78bfa'
                            : '#38bdf8';
                      return (
                        <line
                          key={beam.id}
                          x1={beam.startPoint.x}
                          y1={beam.startPoint.y}
                          x2={beam.endPoint.x}
                          y2={beam.endPoint.y}
                          stroke={strokeColor}
                          strokeWidth={viewMode === 'BEAM_FRAMING' ? beam.widthMm : Math.round(beam.widthMm * 0.65)}
                          strokeLinecap="square"
                          className="cursor-pointer"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setSelectedCadHint({
                              kind: 'BEAM',
                              xMm: (beam.startPoint.x + beam.endPoint.x) / 2,
                              yMm: (beam.startPoint.y + beam.endPoint.y) / 2,
                              floorId: activeFloor?.id ?? '',
                              label: `${beam.type} Beam (${beam.widthMm}×${beam.depthMm} mm)`,
                            });
                          }}
                        >
                          <title>
                            {beam.type} · {beam.widthMm} × {beam.depthMm} mm (Click to inspect/optimize)
                          </title>
                        </line>
                      );
                    })}
                  </g>
                )}

                {/* Corner-Locked RCC Columns */}
                <g id="columns-layer">
                  {columns.map((column) => (
                    <g
                      key={column.id}
                      className="cursor-pointer"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setSelectedCadHint({
                          kind: 'COLUMN',
                          xMm: column.position.x,
                          yMm: column.position.y,
                          floorId: activeFloor?.id ?? '',
                          label: `Column ${column.gridReference ?? column.id} (${column.width}×${column.depth} mm)`,
                        });
                      }}
                    >
                      <rect
                        x={column.position.x - column.width / 2}
                        y={column.position.y - column.depth / 2}
                        width={column.width}
                        height={column.depth}
                        rx={column.shape === 'circular' ? Math.min(column.width, column.depth) / 2 : undefined}
                        fill="#f8fafc"
                        stroke="#f59e0b"
                        strokeWidth="65"
                      >
                        <title>
                          {column.gridReference ?? column.id} · {column.width} × {column.depth} mm
                        </title>
                      </rect>
                      {column.gridReference && (
                        <text
                          x={column.position.x + column.width / 2 + 120}
                          y={column.position.y - column.depth / 2 - 60}
                          fill="#fde68a"
                          fontSize="260"
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          {column.gridReference}
                        </text>
                      )}
                    </g>
                  ))}
                </g>
              </svg>
            </div>

            {/* Canvas Bottom Status Bar — High Contrast */}
            <footer className="flex items-center justify-between border-t border-slate-700/80 bg-[#0F172A] px-4 py-1.5 text-xs font-mono text-slate-200">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold text-[#F8FAFC]">{activeFloor?.name}</span>
                <span className="text-amber-300">{columns.length} corner-locked columns</span>
                <span className="text-sky-300">{beams.length} beams</span>
                <span className="text-slate-400">
                  (Primary {quickAnalysis.buildingSummary.primaryBeamCount} · Secondary {quickAnalysis.buildingSummary.secondaryBeamCount} · Cantilever {quickAnalysis.buildingSummary.cantileverBeamCount})
                </span>
              </div>
              {statusMessage && <div role="status" className="text-amber-300 font-semibold">{statusMessage}</div>}
            </footer>
          </div>

          {/* Right Structural Inspector Sidebar — Strictly High-Contrast Obsidian Glass (>= 7:1 WCAG) */}
          <aside
            data-testid="structural-sidebar"
            className="w-full lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-700/80 bg-[#0B101B] text-[#F8FAFC] p-4 overflow-auto space-y-4"
          >
            <div>
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-amber-400">
                Active Level
              </p>
              <h2 className="mt-1 text-base font-bold font-mono text-[#F8FAFC] break-words">
                {activeFloor?.name ?? 'No level selected'}
              </h2>
            </div>

            <dl className="grid grid-cols-2 gap-2.5 rounded-xl border border-slate-700/80 bg-[#111827] p-3 text-xs">
              <div>
                <dt className="text-slate-400 font-mono uppercase text-[10px]">Columns</dt>
                <dd data-testid="struct-sidebar-col-count" className="mt-0.5 text-lg font-bold font-mono text-[#F8FAFC]">
                  {columns.length}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400 font-mono uppercase text-[10px]">Beams</dt>
                <dd data-testid="struct-sidebar-beam-count" className="mt-0.5 text-lg font-bold font-mono text-sky-300">
                  {beams.length}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400 font-mono uppercase text-[10px]">Slab Thickness</dt>
                <dd className="mt-0.5 text-sm font-bold font-mono text-[#F8FAFC]">
                  {activeFloor?.slabThicknessMm ? `${activeFloor.slabThicknessMm} mm` : '150 mm'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400 font-mono uppercase text-[10px]">Max Beam Span</dt>
                <dd className="mt-0.5 text-sm font-bold font-mono text-amber-300">
                  {(quickAnalysis.buildingSummary.maxBeamSpanMm / 1000).toFixed(2)} m
                </dd>
              </div>
            </dl>

            {/* Live IS 456 / IS 1893 Summary Card */}
            <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400">
                  IS 456 &amp; IS 1893 Live Check
                </span>
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-mono font-bold text-emerald-300">
                  Zone {quickAnalysis.inputs.seismicZone}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-y-1.5 text-xs font-mono">
                <dt className="text-slate-400">Factored Gravity</dt>
                <dd className="text-right font-semibold text-[#F8FAFC]">
                  {quickAnalysis.gravitySummary.factoredTotalGravityKn.toLocaleString()} kN
                </dd>
                <dt className="text-slate-400">Base Shear Vb</dt>
                <dd className="text-right font-semibold text-amber-300">
                  {quickAnalysis.seismicSummary.designBaseShearVbKn.toLocaleString()} kN
                </dd>
                <dt className="text-slate-400">Max Col Util</dt>
                <dd className="text-right font-semibold text-emerald-300">
                  {(quickAnalysis.healthSummary.maxColumnUtilization * 100).toFixed(0)}%
                </dd>
                <dt className="text-slate-400">Slab Check</dt>
                <dd className="text-right font-semibold text-emerald-300">
                  {quickAnalysis.slabCheck.status}
                </dd>
              </dl>
              <button
                type="button"
                data-testid="struct-open-analysis-cta"
                onClick={() => setViewMode('STRUCTURAL_ANALYSIS')}
                className="mt-2 w-full rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-[#0B101B] hover:bg-amber-400 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Activity className="h-3.5 w-3.5" />
                Open Full Structural Analysis
              </button>
              {selectedCadHint && (
                <div className="mt-2 rounded-lg border border-amber-400/40 bg-amber-500/10 p-2.5 text-[11px] font-mono space-y-1.5">
                  <div className="font-bold text-amber-200">Selected: {selectedCadHint.label}</div>
                  <button
                    type="button"
                    data-testid="struct-cad-inspect-member-btn"
                    onClick={() => setViewMode('STRUCTURAL_ANALYSIS')}
                    className="w-full rounded bg-sky-500/25 border border-sky-400/50 px-2 py-1 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/35 cursor-pointer"
                  >
                    Inspect &amp; Optimize Member in Awatif Studio →
                  </button>
                </div>
              )}
            </div>

            {/* Color Legend */}
            <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-3 text-xs space-y-1.5">
              <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
                Framing Legend
              </div>
              <div className="flex items-center gap-2 text-slate-200">
                <span className="inline-block h-2.5 w-2.5 rounded-xs bg-[#f8fafc] border border-amber-400" />
                <span>Corner-Locked RCC Columns (ΔX=0, ΔY=0)</span>
              </div>
              <div className="flex items-center gap-2 text-slate-200">
                <span className="inline-block h-1 w-4 bg-amber-400" />
                <span>Primary Grid Beams (230×450 mm)</span>
              </div>
              <div className="flex items-center gap-2 text-slate-200">
                <span className="inline-block h-1 w-4 bg-sky-400" />
                <span>Secondary Slab Beams (230×400 mm)</span>
              </div>
              <div className="flex items-center gap-2 text-slate-200">
                <span className="inline-block h-1 w-4 bg-violet-400" />
                <span>Cantilever Balcony Beams</span>
              </div>
            </div>

            <p className="flex items-start gap-2 rounded-lg border border-slate-700/80 bg-[#0F172A] p-2.5 text-[11px] text-slate-300">
              <ShieldAlert size={15} className="text-amber-400 shrink-0 mt-0.5" />
              <span>Preliminary IS 456:2000 / IS 1893:2016 framing &amp; sizing. Licensed structural engineer review &amp; full FEA (.e2k) required before construction.</span>
            </p>
          </aside>
        </div>
      )}

      {/* Preview Modal for Generated PDFs */}
      {previewModal && (
        <div
          role="dialog"
          aria-label={previewModal.title}
          className="fixed inset-6 z-50 flex flex-col rounded-xl border border-slate-700 bg-[#0F172A] p-4 shadow-2xl backdrop-blur"
        >
          <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-2">
            <h3 className="font-bold text-[#F8FAFC]">{previewModal.title}</h3>
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(previewModal.url);
                setPreviewModal(null);
              }}
              className="rounded bg-slate-800 px-3 py-1 text-xs text-slate-200 hover:bg-slate-700 cursor-pointer"
            >
              Close Preview
            </button>
          </div>
          <iframe
            src={previewModal.url}
            title={previewModal.title}
            className="flex-1 w-full rounded border border-slate-700 bg-white"
          />
        </div>
      )}
    </div>
  );
};

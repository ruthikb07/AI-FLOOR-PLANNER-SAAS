import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MODEL_TAB,
  mountCotaCad,
  type CanonicalWritebackPreview,
  type CotaCadExportFormat,
  type CotaCanonicalEntityLink,
  type CotaCommandCatalogueEntry,
  type CotaWorkspaceSnapshot,
  type MountedCotaCadController,
  type ViewName,
  type VisualStyle,
} from '@ai-floor-planner/cota-integration';
import type { EditorContextValue } from '../../stores/editor-store';
import { unifiedWorkspaceActions } from '../../stores/unified-workspace-store';
import { saveProjectEngineeringDocument, uint8ToBase64 } from '../../services/local-project-api';

interface CotaWorkspaceProps {
  readonly editor: EditorContextValue;
  readonly theme?: 'day' | 'night';
  readonly onOpen2DCad?: () => void;
  readonly onOpenBim?: () => void;
}

const TOOL_GROUPS: ReadonlyArray<{
  readonly title: string;
  readonly tools: ReadonlyArray<{ readonly cmd: string; readonly label: string; readonly hint: string }>;
}> = [
  {
    title: '2D Draw',
    tools: [
      { cmd: 'LINE', label: 'Line', hint: 'LINE (L) — Straight 2D/3D segment' },
      { cmd: 'PLINE', label: 'Polyline', hint: 'PLINE (PL) — Connected line/arc polyline' },
      { cmd: 'RECTANGLE', label: 'Rect', hint: 'RECTANGLE (REC) — Axis-aligned rectangle' },
      { cmd: 'CIRCLE', label: 'Circle', hint: 'CIRCLE (C) — Center/radius/2P/3P/TTR' },
      { cmd: 'ARC', label: 'Arc', hint: 'ARC (A) — 3-point or center/start/end arc' },
      { cmd: 'ELLIPSE', label: 'Ellipse', hint: 'ELLIPSE (EL) — Center & major/minor axes' },
      { cmd: 'POLYGON', label: 'Polygon', hint: 'POLYGON (POL) — Regular N-sided polygon' },
      { cmd: 'SPLINE', label: 'Spline', hint: 'SPLINE (SPL) — Smooth NURBS/Catmull curve' },
      { cmd: 'HATCH', label: 'Hatch', hint: 'HATCH (H) — Pattern or solid associative fill' },
      { cmd: 'TEXT', label: 'Text', hint: 'MTEXT (MT) — Multi-line CAD annotation' },
      { cmd: 'BLOCK', label: 'Block', hint: 'BLOCK (B) — Define reusable symbol block' },
      { cmd: 'INSERT', label: 'Insert', hint: 'INSERT (I) — Place block instance' },
    ],
  },
  {
    title: 'Modify',
    tools: [
      { cmd: 'MOVE', label: 'Move', hint: 'MOVE (M) — Displace selected entities' },
      { cmd: 'COPY', label: 'Copy', hint: 'COPY (CO) — Duplicate selected entities' },
      { cmd: 'ROTATE', label: 'Rotate', hint: 'ROTATE (RO) — Rotate around base point' },
      { cmd: 'OFFSET', label: 'Offset', hint: 'OFFSET (O) — Parallel curve/wall offset' },
      { cmd: 'TRIM', label: 'Trim', hint: 'TRIM (TR) — Trim at cutting edges' },
      { cmd: 'EXTEND', label: 'Extend', hint: 'EXTEND (EX) — Extend to boundary edges' },
      { cmd: 'FILLET', label: 'Fillet', hint: 'FILLET (F) — Round corner by radius' },
      { cmd: 'CHAMFER', label: 'Chamfer', hint: 'CHAMFER (CHA) — Bevel corner distances' },
      { cmd: 'MIRROR', label: 'Mirror', hint: 'MIRROR (MI) — Reflect across axis line' },
      { cmd: 'SCALE', label: 'Scale', hint: 'SCALE (SC) — Uniform scale from base' },
      { cmd: 'ARRAY', label: 'Array', hint: 'ARRAY (AR) — Rectangular or polar array' },
      { cmd: 'EXPLODE', label: 'Explode', hint: 'EXPLODE (X) — Decompose block/polyline' },
    ],
  },
  {
    title: '3D Solids',
    tools: [
      { cmd: 'BOX', label: 'Box', hint: 'BOX — 3D parametric solid box' },
      { cmd: 'CYLINDER', label: 'Cylinder', hint: 'CYLINDER (CYL) — 3D solid cylinder' },
      { cmd: 'SPHERE', label: 'Sphere', hint: 'SPHERE — 3D parametric sphere' },
      { cmd: 'EXTRUDE', label: 'Extrude', hint: 'EXTRUDE (EXT) — Extrude closed 2D profile' },
      { cmd: 'REVOLVE', label: 'Revolve', hint: 'REVOLVE (REV) — Revolve profile around axis' },
      { cmd: 'UNION', label: 'Union', hint: 'UNION (UNI) — Boolean CSG union' },
      { cmd: 'SUBTRACT', label: 'Subtract', hint: 'SUBTRACT (SU) — Boolean CSG difference' },
      { cmd: 'INTERSECT', label: 'Intersect', hint: 'INTERSECT (IN) — Boolean CSG intersection' },
      { cmd: 'SLICE', label: 'Slice', hint: 'SLICE (SL) — Cut 3D solid by plane' },
      { cmd: 'FILLETEDGE', label: 'Fillet3D', hint: 'FILLETEDGE — Fillet 3D solid edges' },
    ],
  },
  {
    title: 'Dimension & Sheet',
    tools: [
      { cmd: 'DIMLINEAR', label: 'DimLin', hint: 'DIMLINEAR (DLI) — Horizontal/vertical linear dimension' },
      { cmd: 'DIMALIGNED', label: 'DimAli', hint: 'DIMALIGNED (DAL) — Aligned linear dimension' },
      { cmd: 'DIMANGULAR', label: 'DimAng', hint: 'DIMANGULAR (DAN) — Angular dimension' },
      { cmd: 'DIMRADIUS', label: 'DimRad', hint: 'DIMRADIUS (DRA) — Radial dimension' },
      { cmd: 'MLEADER', label: 'MLeader', hint: 'MLEADER (MLD) — Multi-leader callout' },
      { cmd: 'AUTODIM', label: 'AutoDim', hint: 'AUTODIM — Automatic profile dimensioning' },
      { cmd: 'VIEWBASE', label: 'ViewBase', hint: 'VIEWBASE — Projected orthographic sheet view' },
      { cmd: 'UCS', label: 'UCS', hint: 'UCS — Define or align User Coordinate System' },
    ],
  },
];

function triggerDownload(bytes: Uint8Array, mimeType: string, fileName: string) {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export const CotaWorkspace: React.FC<CotaWorkspaceProps> = ({
  editor,
  theme = 'night',
  onOpen2DCad,
  onOpenBim,
}) => {
  const viewportHostRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const ctrlRef = useRef<MountedCotaCadController | null>(null);

  const [snapshot, setSnapshot] = useState<CotaWorkspaceSnapshot | null>(null);
  const [selectedLink, setSelectedLink] = useState<CotaCanonicalEntityLink | null>(null);
  const [cliText, setCliText] = useState('');
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [cmdDrawerOpen, setCmdDrawerOpen] = useState(false);
  const [cmdSearch, setCmdSearch] = useState('');
  const [newLayerName, setNewLayerName] = useState('');
  const [writebackPreview, setWritebackPreview] = useState<CanonicalWritebackPreview | null>(null);
  const [statusBanner, setStatusBanner] = useState('');
  const [errorBanner, setErrorBanner] = useState('');

  const { building, activeFloor } = editor;

  // Mount isolated Cota CAD engine inside `viewportHostRef`
  useEffect(() => {
    const host = viewportHostRef.current;
    if (!host) return;

    const savedRecord = unifiedWorkspaceActions.getCotaDrawingRecord(building.projectId, activeFloor.id);
    const useSaved = savedRecord && savedRecord.source.revision === building.version;

    const controller = mountCotaCad({
      container: host,
      projectId: building.projectId,
      buildingId: building.id,
      drawingId: `cota-${activeFloor.id}`,
      revision: building.version,
      building,
      floorId: activeFloor.id,
      initialDrawingRecord: useSaved ? savedRecord : null,
      theme,
      onStateChange: next => setSnapshot(next),
      onCanonicalEntitySelected: link => {
        setSelectedLink(link);
        if (link && (link.canonicalKind === 'wall' || link.canonicalKind === 'door' || link.canonicalKind === 'window' || link.canonicalKind === 'room' || link.canonicalKind === 'column')) {
          editor.selectEntity(link.canonicalKind, link.canonicalId, link.floorId);
        }
      },
      onError: msg => setErrorBanner(msg),
    });

    ctrlRef.current = controller;
    setSnapshot(controller.getSnapshot());
    setWritebackPreview(null);

    return () => {
      try {
        unifiedWorkspaceActions.saveCotaDrawingRecord(controller.serializeProjectDrawing());
      } catch {
        // Ignore snapshot serialization errors during unmount
      }
      controller.unmount();
      ctrlRef.current = null;
    };
  }, [building.projectId, activeFloor.id]);

  // Keep user informed when canonical revision advances in another workspace
  const isStaleProjection = Boolean(
    snapshot && snapshot.canonicalSource.revision !== building.version,
  );

  const suggestions = useMemo(() => {
    if (!ctrlRef.current || !cliText.trim() || cliText.includes(' ')) return [];
    return ctrlRef.current.autocomplete(cliText.trim(), 8);
  }, [cliText, snapshot?.activeCommand]);

  const commandResults = useMemo<CotaCommandCatalogueEntry[]>(() => {
    if (!cmdDrawerOpen || !ctrlRef.current) return [];
    return ctrlRef.current.searchCommands(cmdSearch).slice(0, 120);
  }, [cmdDrawerOpen, cmdSearch]);

  const runCommand = (raw: string) => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    const trimmed = raw.trim();
    if (trimmed) {
      setCmdHistory(prev => [...prev.slice(-60), trimmed]);
      setHistoryIdx(-1);
    }
    if (trimmed.includes('\n')) {
      void ctrl.runScriptText(trimmed);
    } else {
      ctrl.submitCommandText(raw);
    }
    setCliText('');
  };

  const handleSaveToProject = async () => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    setErrorBanner('');
    try {
      const record = ctrl.serializeProjectDrawing(`${building.name} — ${activeFloor.name} Professional CAD`);
      const meta = await unifiedWorkspaceActions.persistCotaDrawingToProject(record);
      setStatusBanner(`Saved "${meta.fileName}" (Rev #${meta.canonicalRevision}) to Unified Project Files.`);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to save CAD drawing to project.');
    }
  };

  const handleExport = async (fmt: CotaCadExportFormat) => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    setErrorBanner('');
    try {
      const out = await ctrl.exportDrawing(fmt);
      triggerDownload(out.bytes, out.mimeType, out.fileName);
      if (fmt === 'pdf') {
        await saveProjectEngineeringDocument(building.projectId, {
          buildingId: building.id,
          floorId: activeFloor.id,
          kind: 'plot_pdf',
          name: `${activeFloor.name} Vector CAD Plot`,
          fileName: out.fileName,
          mimeType: out.mimeType,
          canonicalRevision: out.revision,
          provenance: 'exported_deliverable',
          contentBase64: uint8ToBase64(out.bytes),
        });
        void unifiedWorkspaceActions.refreshProjectDocuments(building.projectId);
      }
      setStatusBanner(`Exported ${out.fileName} (${(out.bytes.byteLength / 1024).toFixed(1)} KB).`);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : `Export ${fmt.toUpperCase()} failed.`);
    }
  };

  const handleImportFile = async (file: File | undefined) => {
    const ctrl = ctrlRef.current;
    if (!file || !ctrl) return;
    setErrorBanner('');
    try {
      const bytes = await file.arrayBuffer();
      const rep = await ctrl.importCadFile({ name: file.name, bytes });
      await saveProjectEngineeringDocument(building.projectId, {
        buildingId: building.id,
        floorId: activeFloor.id,
        kind: 'cad_reference',
        name: `CAD Exchange: ${file.name}`,
        fileName: file.name,
        mimeType: 'application/octet-stream',
        canonicalRevision: building.version,
        provenance: 'imported_external',
        contentBase64: uint8ToBase64(new Uint8Array(bytes)),
      });
      void unifiedWorkspaceActions.refreshProjectDocuments(building.projectId);
      setStatusBanner(
        `Imported ${rep.importedEntities} entities from ${rep.fileName}${rep.warnings.length ? ` (${rep.warnings.length} fidelity note(s))` : ''}.`,
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'CAD file import failed.');
    }
  };

  const handlePreviewWriteback = (promoteSelected: boolean) => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    const preview = ctrl.previewCanonicalWriteback(editor.engine.getBuilding(), promoteSelected);
    setWritebackPreview(preview);
  };

  const handleApplyWriteback = () => {
    const ctrl = ctrlRef.current;
    if (!ctrl || !writebackPreview?.ok || !writebackPreview.candidateBuilding) return;
    const nextBldg = writebackPreview.candidateBuilding;
    editor.applyRefinement(
      nextBldg,
      `Apply ${writebackPreview.changes.length} validated Cota CAD architectural edit(s)`,
      true,
    );
    ctrl.syncFromCanonicalBuilding(nextBldg, activeFloor.id, false);
    setWritebackPreview(null);
    setStatusBanner(`Applied ${writebackPreview.changes.length} validated CAD change(s) -> Canonical Revision #${nextBldg.version}.`);
  };

  return (
    <section
      aria-label="Professional CAD Studio"
      data-testid="cota-professional-cad-workspace"
      className="flex flex-col w-full h-full bg-slate-950 text-slate-100 select-none overflow-hidden"
    >
      {/* Top Ribbon Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 border-b border-white/10 bg-slate-900/95 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-semibold text-amber-300 tracking-wide uppercase">
            Cota CAD 2D/3D
          </span>
          <label className="flex items-center gap-1 text-slate-300">
            <span>Storey</span>
            <select
              aria-label="CAD active storey"
              value={activeFloor.id}
              onChange={e => editor.switchFloor(e.target.value)}
              className="rounded bg-slate-800 border border-white/15 px-2 py-0.5 text-xs text-slate-100"
            >
              {building.floors.map(f => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>

          {/* Space Tabs: Model + Paper Layouts */}
          <div className="flex items-center rounded bg-slate-800/90 p-0.5 border border-white/10" role="tablist" aria-label="CAD Space Tabs">
            <button
              type="button"
              role="tab"
              data-testid="cota-tab-model"
              aria-selected={snapshot?.activeTab === MODEL_TAB}
              onClick={() => ctrlRef.current?.setActiveTab(MODEL_TAB)}
              className={`px-2 py-0.5 rounded font-mono text-[11px] ${snapshot?.activeTab === MODEL_TAB ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'}`}
            >
              Model
            </button>
            {(snapshot?.layouts ?? []).map(l => (
              <button
                key={l.id}
                type="button"
                role="tab"
                data-testid={`cota-tab-layout-${l.id}`}
                aria-selected={snapshot?.activeTab === l.id}
                onClick={() => ctrlRef.current?.setActiveTab(l.id)}
                className={`px-2 py-0.5 rounded font-mono text-[11px] ${snapshot?.activeTab === l.id ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'}`}
              >
                {l.name}
              </button>
            ))}
          </div>

          {/* Visual Style */}
          <select
            aria-label="CAD visual style"
            data-testid="cota-visual-style-select"
            value={snapshot?.visualStyle ?? '2dwireframe'}
            onChange={e => ctrlRef.current?.setVisualStyle(e.target.value as VisualStyle)}
            className="rounded bg-slate-800 border border-white/15 px-2 py-0.5 text-xs text-slate-100"
          >
            <option value="2dwireframe">2D Wireframe</option>
            <option value="wireframe">3D Wireframe</option>
            <option value="hidden">Hidden Line</option>
            <option value="shaded">Shaded</option>
            <option value="shadedEdges">Shaded + Edges</option>
          </select>

          {/* Standard Views */}
          <div className="hidden lg:flex items-center gap-1">
            {(['TOP', 'FRONT', 'RIGHT', 'SWISO'] as ViewName[]).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => ctrlRef.current?.setStandardView(v)}
                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-white/10 font-mono text-[10px]"
              >
                {v}
              </button>
            ))}
            <button
              type="button"
              onClick={() => ctrlRef.current?.setCameraProjection(snapshot?.cameraMode === 'persp' ? 'ortho' : 'persp')}
              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-white/10 font-mono text-[10px]"
            >
              {snapshot?.cameraMode === 'persp' ? 'PERSP' : 'ORTHO'}
            </button>
          </div>

          {/* Tiled VPORTS */}
          <select
            aria-label="Tiled viewports"
            data-testid="cota-vports-select"
            value={snapshot?.viewportCount ?? 1}
            onChange={e => ctrlRef.current?.setViewportCount(Number(e.target.value) as 1 | 2 | 3 | 4)}
            className="rounded bg-slate-800 border border-white/15 px-1.5 py-0.5 font-mono text-[11px]"
          >
            <option value={1}>1 Viewport</option>
            <option value={2}>2 VPORTS</option>
            <option value={3}>3 VPORTS</option>
            <option value={4}>4 VPORTS</option>
          </select>
        </div>

        {/* File & Cross-Workspace Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            disabled={!snapshot?.canUndo}
            onClick={() => ctrlRef.current?.undo()}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-white/10 font-mono text-[11px]"
          >
            Undo
          </button>
          <button
            type="button"
            disabled={!snapshot?.canRedo}
            onClick={() => ctrlRef.current?.redo()}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-white/10 font-mono text-[11px]"
          >
            Redo
          </button>
          <button
            type="button"
            onClick={() => ctrlRef.current?.zoomExtents()}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-white/10 font-mono text-[11px]"
          >
            Zoom Extents
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".cota,.dxf,.dwg,.obj,.stl,.step,.stp,.iges,.igs"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              e.target.value = '';
              void handleImportFile(f);
            }}
          />
          <button
            type="button"
            data-testid="cota-import-file-btn"
            onClick={() => fileInputRef.current?.click()}
            className="px-2 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-sky-200 font-mono text-[11px]"
          >
            Import CAD/3D
          </button>

          {(['cota', 'dxf', 'dwg', 'obj', 'stl', 'pdf'] as CotaCadExportFormat[]).map(fmt => (
            <button
              key={fmt}
              type="button"
              data-testid={`cota-export-${fmt}`}
              onClick={() => void handleExport(fmt)}
              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-white/15 font-mono text-[10px] uppercase"
            >
              .{fmt}
            </button>
          ))}

          <button
            type="button"
            data-testid="cota-save-project-btn"
            onClick={() => void handleSaveToProject()}
            className="px-2.5 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-[11px]"
          >
            Save to Project
          </button>

          <button
            type="button"
            data-testid="cota-cmd-ref-toggle"
            onClick={() => setCmdDrawerOpen(v => !v)}
            className="px-2 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-400/40 text-indigo-200 font-mono text-[11px]"
          >
            Commands (240+)
          </button>
        </div>
      </div>

      {/* Status / Stale Revision Alerts */}
      {(statusBanner || errorBanner || isStaleProjection) && (
        <div className="flex items-center justify-between gap-2 px-3 py-1 bg-slate-900 border-b border-white/10 text-xs font-mono">
          <div className="flex items-center gap-3">
            {isStaleProjection && (
              <span className="text-amber-300">
                Canonical Building advanced to Rev #{building.version} (CAD projection is Rev #{snapshot?.canonicalSource.revision}). Click &quot;Sync from Plan&quot; to refresh while preserving C-DRAFT geometry.
              </span>
            )}
            {errorBanner && <span role="alert" className="text-rose-400">{errorBanner}</span>}
            {!errorBanner && statusBanner && <span role="status" className="text-emerald-300">{statusBanner}</span>}
          </div>
          {(statusBanner || errorBanner) && (
            <button
              type="button"
              onClick={() => { setStatusBanner(''); setErrorBanner(''); }}
              className="text-slate-400 hover:text-white px-1"
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* Main 3-Column CAD Studio Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Drafting, Modify, 3D Solids & Dimension Palette */}
        <aside
          aria-label="CAD Drafting Tools"
          className="w-48 shrink-0 border-r border-white/10 bg-slate-900/80 overflow-y-auto p-2 space-y-3"
        >
          {TOOL_GROUPS.map(group => (
            <div key={group.title}>
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">
                {group.title}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {group.tools.map(t => (
                  <button
                    key={t.cmd}
                    type="button"
                    data-testid={`cota-tool-${t.cmd}`}
                    title={t.hint}
                    onClick={() => runCommand(t.cmd)}
                    className={`px-1.5 py-1 rounded text-left font-mono text-[11px] truncate border transition-colors ${
                      snapshot?.activeCommand === t.cmd
                        ? 'bg-amber-500/25 border-amber-400 text-amber-200'
                        : 'bg-slate-800/80 hover:bg-slate-700/80 border-white/10 text-slate-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        {/* Center Three.js CAD Viewport + Bottom Command Line */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
          <div
            ref={viewportHostRef}
            data-testid="cota-cad-viewport"
            className="flex-1 min-h-0 w-full relative bg-slate-950"
          />

          {/* Searchable 240+ Command Reference Overlay Drawer */}
          {cmdDrawerOpen && (
            <div
              role="dialog"
              aria-label="Cota CAD Command Reference"
              data-testid="cota-command-reference-drawer"
              className="absolute top-2 right-2 bottom-28 w-96 max-w-full bg-slate-900/95 border border-white/15 rounded-xl shadow-2xl flex flex-col z-30 overflow-hidden backdrop-blur"
            >
              <div className="p-2.5 border-b border-white/10 flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-bold text-amber-300">
                  CAD Command Reference ({commandResults.length})
                </span>
                <button
                  type="button"
                  onClick={() => setCmdDrawerOpen(false)}
                  className="text-xs font-mono text-slate-400 hover:text-white px-1.5"
                >
                  Close
                </button>
              </div>
              <div className="p-2 border-b border-white/10">
                <input
                  type="search"
                  data-testid="cota-cmd-search-input"
                  value={cmdSearch}
                  onChange={e => setCmdSearch(e.target.value)}
                  placeholder="Search LINE, TRIM, EXTRUDE, DIM, UCS…"
                  className="w-full rounded bg-slate-950 border border-white/15 px-2.5 py-1 text-xs font-mono text-slate-100"
                />
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-white/5 p-1.5">
                {commandResults.map(cmd => (
                  <button
                    key={cmd.name}
                    type="button"
                    onClick={() => {
                      runCommand(cmd.name);
                      setCmdDrawerOpen(false);
                    }}
                    className="w-full text-left p-2 hover:bg-white/5 rounded transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-sky-300">{cmd.name}</span>
                      {cmd.aliases.length > 0 && (
                        <span className="font-mono text-[10px] text-slate-400">
                          Aliases: {cmd.aliases.join(', ')}
                        </span>
                      )}
                    </div>
                    {cmd.description && (
                      <div className="text-[11px] text-slate-300 mt-0.5 line-clamp-2">{cmd.description}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Interactive CAD Command Line & Transcript */}
          <div className="border-t border-white/15 bg-slate-900/95 px-3 py-1.5 space-y-1">
            <div
              data-testid="cota-cli-transcript"
              className="max-h-16 overflow-y-auto font-mono text-[11px] text-slate-300 space-y-0.5"
            >
              {(snapshot?.output ?? []).slice(-5).map((line, i) => (
                <div key={i} className="truncate">
                  {line}
                </div>
              ))}
            </div>

            {suggestions.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap" data-testid="cota-cli-autocomplete">
                {suggestions.map(s => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => runCommand(s.name)}
                    className="px-2 py-0.5 rounded bg-sky-500/15 hover:bg-sky-500/30 border border-sky-400/30 font-mono text-[10px] text-sky-200"
                  >
                    {s.name}
                    {s.alias ? ` (${s.alias})` : ''}
                  </button>
                ))}
              </div>
            )}

            <form
              onSubmit={e => {
                e.preventDefault();
                runCommand(cliText);
              }}
              className="flex items-center gap-2"
            >
              <span className="font-mono text-xs text-amber-300 shrink-0">
                {snapshot?.prompt || 'Command:'}
              </span>
              <input
                type="text"
                data-testid="cota-cli-input"
                aria-label="CAD command line"
                value={cliText}
                onChange={e => setCliText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    ctrlRef.current?.cancelActiveCommand();
                    setCliText('');
                  } else if (e.key === 'ArrowUp' && cmdHistory.length > 0) {
                    e.preventDefault();
                    const nextIdx = historyIdx < 0 ? cmdHistory.length - 1 : Math.max(0, historyIdx - 1);
                    setHistoryIdx(nextIdx);
                    setCliText(cmdHistory[nextIdx] ?? '');
                  } else if (e.key === 'ArrowDown' && historyIdx >= 0) {
                    e.preventDefault();
                    const nextIdx = historyIdx + 1;
                    if (nextIdx >= cmdHistory.length) {
                      setHistoryIdx(-1);
                      setCliText('');
                    } else {
                      setHistoryIdx(nextIdx);
                      setCliText(cmdHistory[nextIdx] ?? '');
                    }
                  }
                }}
                placeholder="Type command or X,Y,Z coordinates (e.g. LINE, CIRCLE, OFFSET, BOX, EXTRUDE)…"
                className="flex-1 rounded bg-slate-950 border border-white/20 px-2.5 py-1 font-mono text-xs text-slate-100 focus:outline-none focus:border-amber-400"
              />
              <button
                type="submit"
                data-testid="cota-cli-execute"
                className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 font-mono text-xs text-amber-200"
              >
                Enter
              </button>
              {snapshot?.activeCommand && (
                <button
                  type="button"
                  onClick={() => ctrlRef.current?.cancelActiveCommand()}
                  className="px-2 py-1 rounded bg-rose-500/20 border border-rose-400/40 font-mono text-xs text-rose-200"
                >
                  Cancel (Esc)
                </button>
              )}
            </form>

            {/* Drafting Precision Status Bar */}
            <div className="flex items-center justify-between gap-2 pt-0.5 text-[10px] font-mono text-slate-400 flex-wrap">
              <div className="flex items-center gap-3 tabular-nums">
                <span data-testid="cota-coords-readout">
                  X: {snapshot ? snapshot.cursor.x.toFixed(1) : '0.0'} · Y: {snapshot ? snapshot.cursor.y.toFixed(1) : '0.0'} · Z: {snapshot ? snapshot.cursor.z.toFixed(1) : '0.0'} mm
                </span>
                <span>UCS: {snapshot?.ucsName ?? 'World'}</span>
                <span>Entities: {snapshot?.entityCount ?? 0} ({snapshot?.mappedCanonicalCount ?? 0} Canonical)</span>
              </div>
              <div className="flex items-center gap-1">
                {(
                  [
                    ['GRID', snapshot?.gridOn, { gridOn: !snapshot?.gridOn }],
                    ['SNAP', snapshot?.gridSnap, { gridSnap: !snapshot?.gridSnap }],
                    ['ORTHO', snapshot?.ortho, { ortho: !snapshot?.ortho }],
                    ['POLAR', snapshot?.polar, { polar: !snapshot?.polar }],
                    ['ESNAP', snapshot?.esnap, { esnap: !snapshot?.esnap }],
                    ['OTRACK', snapshot?.otrack, { otrack: !snapshot?.otrack }],
                    ['DYN', snapshot?.dynInput, { dynInput: !snapshot?.dynInput }],
                  ] as const
                ).map(([label, active, patch]) => (
                  <button
                    key={label}
                    type="button"
                    data-testid={`cota-toggle-${label}`}
                    aria-pressed={Boolean(active)}
                    onClick={() => ctrlRef.current?.setDraftingOption(patch)}
                    className={`px-1.5 py-0.5 rounded border ${
                      active
                        ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300 font-bold'
                        : 'bg-slate-800 border-white/10 text-slate-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Layer Manager & Canonical Architectural Bridge */}
        <aside
          aria-label="CAD Layers and Canonical Bridge"
          className="w-72 shrink-0 border-l border-white/10 bg-slate-900/85 overflow-y-auto p-3 space-y-4 text-xs"
        >
          {/* Canonical Architectural Bridge */}
          <div className="rounded-lg border border-amber-400/30 bg-amber-500/5 p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-amber-300 uppercase text-[11px]">
                Canonical Architectural Bridge
              </span>
              <span className="font-mono text-[10px] text-slate-300">
                Rev #{snapshot?.canonicalSource.revision ?? building.version}
              </span>
            </div>
            <p className="text-[11px] text-slate-300 leading-snug">
              Authoritative model: <strong>{building.name}</strong> ({activeFloor.name}). Free-form CAD lines on <code>C-DRAFT</code> never auto-convert into walls unless explicitly promoted.
            </p>
            {selectedLink && (
              <div className="rounded bg-slate-950/80 border border-sky-400/30 p-2 font-mono text-[10px] text-sky-200">
                Linked {selectedLink.canonicalKind.toUpperCase()}: {selectedLink.canonicalId}
              </div>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                data-testid="cota-sync-from-plan"
                onClick={() => ctrlRef.current?.syncFromCanonicalBuilding(editor.engine.getBuilding(), activeFloor.id, false)}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-white/15 font-mono text-[10px]"
              >
                Sync 2D Plan
              </button>
              <button
                type="button"
                data-testid="cota-sync-3d-solids"
                onClick={() => {
                  ctrlRef.current?.syncFromCanonicalBuilding(editor.engine.getBuilding(), activeFloor.id, true);
                  ctrlRef.current?.setVisualStyle('shadedEdges');
                  ctrlRef.current?.setStandardView('SWISO');
                }}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-white/15 font-mono text-[10px]"
              >
                Sync + 3D Solids
              </button>
              <button
                type="button"
                data-testid="cota-preview-writeback"
                onClick={() => handlePreviewWriteback(false)}
                className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 font-mono text-[10px]"
              >
                Preview Writeback
              </button>
              <button
                type="button"
                data-testid="cota-promote-line-btn"
                onClick={() => handlePreviewWriteback(true)}
                className="px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-200 font-mono text-[10px]"
              >
                Promote Line -&gt; Wall
              </button>
            </div>

            {writebackPreview && (
              <div
                data-testid="cota-writeback-preview-card"
                className="rounded bg-slate-950 border border-white/15 p-2 space-y-1.5 font-mono text-[10px]"
              >
                <div className={writebackPreview.ok ? 'text-emerald-300 font-bold' : 'text-rose-300 font-bold'}>
                  {writebackPreview.ok
                    ? `Ready: ${writebackPreview.changes.length} validated change(s) -> Rev #${writebackPreview.nextRevision}`
                    : `Blocked (${writebackPreview.blockingFindings.length} issue(s))`}
                </div>
                {writebackPreview.changes.map((c, idx) => (
                  <div key={idx} className="text-slate-300">• {c.summary}</div>
                ))}
                {writebackPreview.blockingFindings.map((b, idx) => (
                  <div key={idx} className="text-rose-300">✕ {b}</div>
                ))}
                {writebackPreview.ok && (
                  <button
                    type="button"
                    data-testid="cota-apply-writeback-btn"
                    onClick={handleApplyWriteback}
                    className="w-full py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold"
                  >
                    Apply to Canonical Building
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-1 border-t border-white/10">
              {onOpen2DCad && (
                <button type="button" onClick={onOpen2DCad} className="text-[10px] font-mono text-sky-300 hover:underline">
                  &larr; 2D Arch Sheet
                </button>
              )}
              {onOpenBim && (
                <button type="button" onClick={onOpenBim} className="text-[10px] font-mono text-amber-300 hover:underline">
                  BIM Studio &rarr;
                </button>
              )}
            </div>
          </div>

          {/* Layer Manager */}
          <div className="space-y-2">
            <div className="font-mono font-bold text-slate-200 uppercase text-[11px]">
              CAD Layers ({snapshot?.layers.length ?? 0})
            </div>
            <form
              onSubmit={e => {
                e.preventDefault();
                if (!newLayerName.trim() || !ctrlRef.current) return;
                try {
                  const l = ctrlRef.current.addLayer(newLayerName.trim());
                  ctrlRef.current.setCurrentLayer(l.id);
                  setNewLayerName('');
                } catch (err) {
                  setErrorBanner(err instanceof Error ? err.message : 'Could not create layer.');
                }
              }}
              className="flex gap-1"
            >
              <input
                type="text"
                value={newLayerName}
                onChange={e => setNewLayerName(e.target.value)}
                placeholder="New layer name…"
                className="flex-1 rounded bg-slate-950 border border-white/15 px-2 py-1 font-mono text-[11px]"
              />
              <button
                type="submit"
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-white/15 font-mono text-[11px]"
              >
                + Layer
              </button>
            </form>

            <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
              {(snapshot?.layers ?? []).map(layer => {
                const isCurrent = snapshot?.currentLayerId === layer.id;
                return (
                  <div
                    key={layer.id}
                    className={`flex items-center justify-between gap-1 px-2 py-1 rounded border font-mono text-[11px] ${
                      isCurrent ? 'bg-sky-500/15 border-sky-400/40' : 'bg-slate-950/60 border-white/5'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => ctrlRef.current?.setCurrentLayer(layer.id)}
                      className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0 border border-white/20"
                        style={{ backgroundColor: layer.color }}
                      />
                      <span className="truncate">{layer.name}</span>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title={layer.visible ? 'Hide layer' : 'Show layer'}
                        onClick={() => ctrlRef.current?.toggleLayerVisibility(layer.id)}
                        className={`px-1 rounded text-[10px] ${layer.visible ? 'text-emerald-300' : 'text-slate-500'}`}
                      >
                        {layer.visible ? 'ON' : 'OFF'}
                      </button>
                      <button
                        type="button"
                        title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                        onClick={() => ctrlRef.current?.toggleLayerLock(layer.id)}
                        className={`px-1 rounded text-[10px] ${layer.locked ? 'text-amber-300' : 'text-slate-500'}`}
                      >
                        {layer.locked ? 'LCK' : 'ULK'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
};

export default CotaWorkspace;

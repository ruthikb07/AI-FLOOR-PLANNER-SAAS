import React, { useEffect, useRef, useState } from 'react';
import {
  CLASH_METHODS,
  mountOpenBimStudio,
  type ClashMethod,
  type ElementClash,
  type FederatedBoxPrismInput,
  type MountedOpenBimStudioController,
  type OpenBimSessionSnapshot,
} from '@ai-floor-planner/openbim-integration';
import type { EditorContextValue } from '../../stores/editor-store';
import { loadProjectBimFederation, type PersistedLinkedReference } from '../../services/ifc-reference-store';
import { alignedPlanPrism } from '../../services/ifc-reference';
import { unifiedWorkspaceActions } from '../../stores/unified-workspace-store';
import { saveProjectEngineeringDocument, uint8ToBase64 } from '../../services/local-project-api';

function downloadBytes(bytes: Uint8Array, mime: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export const ModelCoordinationWorkspace: React.FC<{
  readonly editor: EditorContextValue;
  readonly onOpenBim?: () => void;
  readonly onOpenProCad?: () => void;
}> = ({ editor, onOpenBim, onOpenProCad }) => {
  const { building, activeFloor } = editor;
  const ctrlRef = useRef<MountedOpenBimStudioController | null>(null);
  const bcfImportRef = useRef<HTMLInputElement | null>(null);

  const [snap, setSnap] = useState<OpenBimSessionSnapshot | null>(null);
  const [linkedRefs, setLinkedRefs] = useState<PersistedLinkedReference[]>([]);
  const [clashMethod, setClashMethod] = useState<ClashMethod>('hard-triangle');
  const [toleranceMm, setToleranceMm] = useState('5');
  const [clearanceMm, setClearanceMm] = useState('50');
  const [includeSampleMep, setIncludeSampleMep] = useState(true);
  const [runningClash, setRunningClash] = useState(false);

  // BCF Issue form state
  const [issueTitle, setIssueTitle] = useState('');
  const [issuePriority, setIssuePriority] = useState('Normal');
  const [issueAssignee, setIssueAssignee] = useState('mep-lead@studio.local');
  const [issueDesc, setIssueDesc] = useState('');
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    void loadProjectBimFederation(building.projectId).then(fed => {
      setLinkedRefs(fed ? [...fed.references] : []);
    });

    const persisted = unifiedWorkspaceActions.getOpenBimState(building.projectId);
    const ctrl = mountOpenBimStudio({
      projectId: building.projectId,
      buildingId: building.id,
      revision: building.version,
      building,
      initialClassifications: persisted?.classifications,
      initialCustomProperties: persisted?.customProperties,
      initialBcfIssues: persisted?.bcfIssues,
      onStateChange: next => {
        setSnap(next);
        unifiedWorkspaceActions.upsertOpenBimState(building.projectId, {
          syncedRevision: next.source.revision,
          classifications: next.classificationAssignments,
          customProperties: next.customProperties,
          bcfIssues: next.bcfIssues,
          lastIdsReport: next.lastIdsReport,
          lastQtoRun: next.lastQtoRun,
          lastIfcDiagnostics: next.lastIfcDiagnostics,
        });
      },
    });
    ctrlRef.current = ctrl;
    setSnap(ctrl.getSnapshot());
    return () => {
      ctrl.unmount();
      ctrlRef.current = null;
    };
  }, [building.projectId]);

  useEffect(() => {
    ctrlRef.current?.updateBuilding(building);
  }, [building]);

  const buildFederatedPrisms = (): FederatedBoxPrismInput[] => {
    const prisms: FederatedBoxPrismInput[] = [];
    for (const ref of linkedRefs) {
      const align = ref.alignment ?? { x: 0, y: 0, z: 0, angle: 0 };
      for (const el of ref.model.elements) {
        for (const p of el.prisms) {
          const ap = alignedPlanPrism(p, align);
          const xs = ap.boundary.map(pt => pt.x);
          const ys = ap.boundary.map(pt => pt.y);
          if (xs.length >= 3) {
            prisms.push({
              modelId: ref.fileName,
              globalId: el.globalId,
              ifcClass: el.ifcClass,
              name: el.name || el.globalId,
              minXMm: Math.min(...xs),
              maxXMm: Math.max(...xs),
              minYMm: Math.min(...ys),
              maxYMm: Math.max(...ys),
              bottomMm: ap.bottomMm,
              topMm: ap.topMm,
            });
          }
        }
      }
    }

    if (includeSampleMep && activeFloor.walls.length > 0) {
      const hostWall = activeFloor.walls[0]!;
      const mx = (hostWall.startPoint.x + hostWall.endPoint.x) / 2;
      const my = (hostWall.startPoint.y + hostWall.endPoint.y) / 2;
      prisms.push({
        modelId: 'federated-mep-trunk',
        globalId: '2O2Fr$t4X7Zf8NOew3FLOH',
        ifcClass: 'IFCDUCTSEGMENT',
        name: 'HVAC Supply Trunk SD-101',
        minXMm: mx - 250,
        maxXMm: mx + 250,
        minYMm: my - 350,
        maxYMm: my + 350,
        bottomMm: 2100,
        topMm: 2550,
      });
    }
    return prisms;
  };

  const handleRunClash = async () => {
    if (!ctrlRef.current) return;
    setRunningClash(true);
    try {
      const prisms = buildFederatedPrisms();
      const hits = await ctrlRef.current.run3DClashDetection(prisms, clashMethod, {
        tolerance: Math.max(0.0005, Number(toleranceMm) / 1000),
        clearance: Math.max(0, Number(clearanceMm) / 1000),
      });
      setStatusMsg(`3D Clash Detection (${clashMethod}) completed: ${hits.length} clash(es) detected across ${prisms.length} federated discipline prism(s).`);
    } finally {
      setRunningClash(false);
    }
  };

  const handleLogClashToBcf = (clash: ElementClash) => {
    if (!ctrlRef.current) return;
    const iss = ctrlRef.current.addBcfIssue({
      title: `[${clash.kind.toUpperCase()}] ${clash.a.name} vs ${clash.b.name}`,
      topicType: 'Clash',
      priority: clash.kind === 'intersect' ? 'Critical' : 'Normal',
      assignedTo: issueAssignee,
      description: `Method: ${clash.method} (${clash.precision}). Overlap volume: ${clash.depthVol.toFixed(5)} m³, min gap: ${(clash.minGap * 1000).toFixed(1)} mm.`,
    });
    void unifiedWorkspaceActions.persistOpenBimSessionToProject(building.projectId, building.id, building.version);
    setStatusMsg(`Created BCF 2.1 issue "${iss.title}" (${iss.guid.slice(0, 8)}).`);
  };

  const handleExportBcfZip = async () => {
    if (!ctrlRef.current) return;
    const bytes = ctrlRef.current.exportBcfZip(building.name);
    const fileName = `${building.projectId}-coordination-r${building.version}.bcfzip`;
    downloadBytes(bytes, 'application/zip', fileName);
    await saveProjectEngineeringDocument(building.projectId, {
      buildingId: building.id,
      kind: 'bcf_archive',
      name: `BCF 2.1 Coordination Archive (${snap?.bcfIssues.length ?? 0} issues)`,
      fileName,
      mimeType: 'application/zip',
      canonicalRevision: building.version,
      provenance: 'exported_deliverable',
      contentBase64: uint8ToBase64(bytes),
    });
    void unifiedWorkspaceActions.refreshProjectDocuments(building.projectId);
    setStatusMsg(`Exported ${fileName} and stored in Unified Project Files.`);
  };

  return (
    <section
      aria-label="Model Coordination and BCF Issue Tracker"
      data-testid="model-coordination-workspace"
      className="flex flex-col w-full h-full bg-slate-950 text-slate-100 overflow-y-auto p-4 space-y-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <h1 className="text-lg font-semibold text-amber-300">
            Model Federation, 3D Clash Detection &amp; BCF 2.1 Coordination
          </h1>
          <p className="text-xs font-mono text-slate-400">
            Active Project: {building.name} · Canonical Rev #{building.version} · {linkedRefs.length} linked IFC reference(s) · {snap?.bcfIssues.length ?? 0} BCF issue(s)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onOpenBim && (
            <button
              type="button"
              onClick={onOpenBim}
              className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-white/15 text-xs font-mono"
            >
              BIM Studio
            </button>
          )}
          {onOpenProCad && (
            <button
              type="button"
              onClick={onOpenProCad}
              className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-white/15 text-xs font-mono"
            >
              Professional CAD
            </button>
          )}
          <input
            ref={bcfImportRef}
            type="file"
            accept=".bcfzip,.bcf,.zip"
            className="hidden"
            onChange={async e => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f || !ctrlRef.current) return;
              const bytes = new Uint8Array(await f.arrayBuffer());
              const imported = ctrlRef.current.importBcfZip(bytes);
              setStatusMsg(`Imported ${imported.length} BCF 2.1 topic(s) from ${f.name}.`);
            }}
          />
          <button
            type="button"
            data-testid="coord-import-bcf-btn"
            onClick={() => bcfImportRef.current?.click()}
            className="px-3 py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-sky-200 text-xs font-mono"
          >
            Import .bcfzip
          </button>
          <button
            type="button"
            data-testid="coord-export-bcf-btn"
            onClick={() => void handleExportBcfZip()}
            className="px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs font-mono"
          >
            Export .bcfzip
          </button>
        </div>
      </header>

      {statusMsg && (
        <div role="status" data-testid="coord-status-banner" className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs font-mono text-emerald-200">
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Left: 3D BVH / GJK Clash Runner */}
        <div className="rounded-xl border border-white/10 bg-slate-900/80 p-4 space-y-3">
          <h2 className="text-sm font-mono font-bold text-sky-300 uppercase">
            3D BVH / Convex-GJK / Clearance Clash Engine
          </h2>
          <div className="flex flex-wrap items-end gap-3 text-xs">
            <label className="space-y-1">
              <span className="block font-mono text-slate-400">Algorithm</span>
              <select
                aria-label="3D clash method"
                data-testid="coord-clash-method"
                value={clashMethod}
                onChange={e => setClashMethod(e.target.value as ClashMethod)}
                className="rounded bg-slate-950 border border-white/15 px-2 py-1 font-mono"
              >
                {CLASH_METHODS.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block font-mono text-slate-400">Tolerance (mm)</span>
              <input
                type="number"
                value={toleranceMm}
                onChange={e => setToleranceMm(e.target.value)}
                className="w-24 rounded bg-slate-950 border border-white/15 px-2 py-1 font-mono"
              />
            </label>
            <label className="space-y-1">
              <span className="block font-mono text-slate-400">Clearance (mm)</span>
              <input
                type="number"
                value={clearanceMm}
                onChange={e => setClearanceMm(e.target.value)}
                className="w-24 rounded bg-slate-950 border border-white/15 px-2 py-1 font-mono"
              />
            </label>
            <label className="flex items-center gap-1.5 font-mono text-slate-300 pb-1">
              <input
                type="checkbox"
                checked={includeSampleMep}
                onChange={e => setIncludeSampleMep(e.target.checked)}
              />
              Include MEP HVAC Trunk Test Envelope
            </label>
            <button
              type="button"
              data-testid="coord-run-clash-btn"
              disabled={runningClash}
              onClick={() => void handleRunClash()}
              className="px-3 py-1.5 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-mono font-bold"
            >
              {runningClash ? 'Running BVH…' : 'Run 3D Clash Check'}
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-white/10 text-xs">
            {(snap?.lastFederatedClashes ?? []).length === 0 ? (
              <p className="text-slate-400 py-3 font-mono">
                Click &quot;Run 3D Clash Check&quot; to test canonical architectural walls, slabs, and columns against federated discipline models.
              </p>
            ) : (
              (snap?.lastFederatedClashes ?? []).map((c, idx) => (
                <div key={idx} className="py-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-mono font-semibold text-rose-300">
                      {c.kind.toUpperCase()} · {c.a.name} &harr; {c.b.name}
                    </div>
                    <div className="font-mono text-[11px] text-slate-400">
                      Precision: {c.precision} · Tri pairs: {c.triPairs} · Overlap: {c.depthVol.toFixed(5)} m³
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid={`coord-log-clash-${idx}`}
                    onClick={() => handleLogClashToBcf(c)}
                    className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 font-mono text-[11px] text-amber-200 shrink-0"
                  >
                    + Log BCF Issue
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: BCF 2.1 Issue Management Board */}
        <div className="rounded-xl border border-white/10 bg-slate-900/80 p-4 space-y-3">
          <h2 className="text-sm font-mono font-bold text-amber-300 uppercase">
            BCF 2.1 Issue Tracker ({snap?.bcfIssues.length ?? 0})
          </h2>

          <form
            onSubmit={e => {
              e.preventDefault();
              if (!issueTitle.trim() || !ctrlRef.current) return;
              ctrlRef.current.addBcfIssue({
                title: issueTitle,
                priority: issuePriority,
                assignedTo: issueAssignee,
                description: issueDesc,
              });
              void unifiedWorkspaceActions.persistOpenBimSessionToProject(building.projectId, building.id, building.version);
              setIssueTitle('');
              setIssueDesc('');
            }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs"
          >
            <input
              type="text"
              data-testid="coord-bcf-title-input"
              value={issueTitle}
              onChange={e => setIssueTitle(e.target.value)}
              placeholder="Issue title (e.g. Beam headroom at Stair-1)…"
              className="sm:col-span-2 rounded bg-slate-950 border border-white/15 px-2.5 py-1 font-mono"
            />
            <select
              value={issuePriority}
              onChange={e => setIssuePriority(e.target.value)}
              className="rounded bg-slate-950 border border-white/15 px-2 py-1 font-mono"
            >
              <option value="Critical">Critical</option>
              <option value="Major">Major</option>
              <option value="Normal">Normal</option>
              <option value="Minor">Minor</option>
            </select>
            <input
              type="text"
              value={issueAssignee}
              onChange={e => setIssueAssignee(e.target.value)}
              placeholder="Assignee email"
              className="rounded bg-slate-950 border border-white/15 px-2.5 py-1 font-mono"
            />
            <input
              type="text"
              value={issueDesc}
              onChange={e => setIssueDesc(e.target.value)}
              placeholder="Resolution notes / sleeve specification…"
              className="rounded bg-slate-950 border border-white/15 px-2.5 py-1 font-mono"
            />
            <button
              type="submit"
              data-testid="coord-add-bcf-btn"
              className="rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono font-bold px-3 py-1"
            >
              Create Topic
            </button>
          </form>

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1 text-xs">
            {(snap?.bcfIssues ?? []).length === 0 ? (
              <p className="text-slate-400 font-mono py-2">No BCF coordination issues logged yet.</p>
            ) : (
              (snap?.bcfIssues ?? []).map(iss => (
                <div key={iss.guid} data-testid="coord-bcf-card" className="rounded-lg border border-white/10 bg-slate-950/80 p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-slate-100">{iss.title}</span>
                    <select
                      aria-label={`BCF status for ${iss.title}`}
                      value={iss.topicStatus}
                      onChange={e => ctrlRef.current?.updateBcfIssueStatus(iss.guid, e.target.value)}
                      className="rounded bg-slate-800 border border-white/15 px-2 py-0.5 font-mono text-[11px]"
                    >
                      <option value="Open">Open</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Resolved">Resolved</option>
                      <option value="Closed">Closed</option>
                    </select>
                  </div>
                  <div className="font-mono text-[10px] text-slate-400">
                    Priority: {iss.priority ?? 'Normal'} · Assigned: {iss.assignedTo || 'Unassigned'} · Rev #{iss.canonicalRevision}
                  </div>
                  {iss.description && <p className="text-slate-300 text-[11px]">{iss.description}</p>}
                  {(iss.comments ?? []).map(cm => (
                    <div key={cm.guid} className="pl-2 border-l-2 border-amber-400/40 text-[11px] text-slate-300">
                      <strong>{cm.author}:</strong> {cm.text}
                    </div>
                  ))}
                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      const txt = commentDrafts[iss.guid]?.trim();
                      if (!txt || !ctrlRef.current) return;
                      ctrlRef.current.addBcfComment(iss.guid, 'Coordinator', txt);
                      setCommentDrafts(prev => ({ ...prev, [iss.guid]: '' }));
                    }}
                    className="flex gap-1 pt-1"
                  >
                    <input
                      type="text"
                      value={commentDrafts[iss.guid] ?? ''}
                      onChange={e => setCommentDrafts(prev => ({ ...prev, [iss.guid]: e.target.value }))}
                      placeholder="Add BCF comment…"
                      className="flex-1 rounded bg-slate-900 border border-white/10 px-2 py-0.5 font-mono text-[11px]"
                    />
                    <button type="submit" className="px-2 py-0.5 rounded bg-slate-800 border border-white/15 font-mono text-[10px]">
                      Comment
                    </button>
                  </form>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default ModelCoordinationWorkspace;

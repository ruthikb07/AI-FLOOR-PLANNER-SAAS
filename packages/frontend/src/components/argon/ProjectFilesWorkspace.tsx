import React, { useEffect, useState } from 'react';
import { exchangeRevision } from '@ai-floor-planner/core';
import type { EditorContextValue } from '../../stores/editor-store';
import { unifiedWorkspaceActions, useUnifiedWorkspaceStore } from '../../stores/unified-workspace-store';
import {
  base64ToUint8,
  deleteProjectEngineeringDocument,
  loadProjectEngineeringDocument,
  type ProjectEngineeringDocumentMeta,
} from '../../services/local-project-api';

export const ProjectFilesWorkspace: React.FC<{
  readonly editor: EditorContextValue;
  readonly onNavigateWorkspace: (ws: 'cad_2d' | 'pro_cad' | 'bim' | 'coordination' | 'export') => void;
}> = ({ editor, onNavigateWorkspace }) => {
  const { building, projectName } = editor;
  const unified = useUnifiedWorkspaceStore();
  const [statusMsg, setStatusMsg] = useState('');

  const source = exchangeRevision(building);
  const docs = unified.documentsByProject[building.projectId] ?? [];

  useEffect(() => {
    void unifiedWorkspaceActions.refreshProjectDocuments(building.projectId);
  }, [building.projectId, building.version]);

  const handleDownload = async (doc: ProjectEngineeringDocumentMeta) => {
    const loaded = await loadProjectEngineeringDocument(building.projectId, doc.docId);
    if (!loaded) {
      setStatusMsg(`Could not load "${doc.fileName}".`);
      return;
    }
    const bytes = base64ToUint8(loaded.contentBase64);
    const url = URL.createObjectURL(new Blob([bytes], { type: doc.mimeType }));
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const handleDelete = async (doc: ProjectEngineeringDocumentMeta) => {
    await deleteProjectEngineeringDocument(building.projectId, doc.docId);
    await unifiedWorkspaceActions.refreshProjectDocuments(building.projectId);
    setStatusMsg(`Removed "${doc.fileName}" from project files.`);
  };

  return (
    <section
      aria-label="Unified Project Engineering Files"
      data-testid="project-files-workspace"
      className="flex flex-col w-full h-full bg-slate-950 text-slate-100 overflow-y-auto p-5 space-y-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <h1 className="text-lg font-semibold text-amber-300">
            Unified Project Engineering Files &amp; Deliverables
          </h1>
          <p className="text-xs font-mono text-slate-400">
            Project: {projectName || building.name} ({building.projectId}) · Canonical Revision #{source.revision} · Digest {source.sha256.slice(0, 16)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigateWorkspace('pro_cad')}
            className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-white/15 text-xs font-mono"
          >
            Open Professional CAD
          </button>
          <button
            type="button"
            onClick={() => onNavigateWorkspace('bim')}
            className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-white/15 text-xs font-mono"
          >
            Open BIM Studio
          </button>
          <button
            type="button"
            onClick={() => onNavigateWorkspace('coordination')}
            className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-white/15 text-xs font-mono"
          >
            Open Coordination
          </button>
        </div>
      </header>

      {statusMsg && (
        <div role="status" className="rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-xs font-mono text-sky-200">
          {statusMsg}
        </div>
      )}

      {/* Authoritative Canonical Model Card */}
      <div className="rounded-xl border border-amber-400/30 bg-amber-500/5 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs font-mono uppercase text-amber-300 font-bold">
            Authoritative Canonical Building Model (mm)
          </div>
          <div className="text-sm font-semibold">{building.name}</div>
          <div className="text-xs font-mono text-slate-400">
            {building.floors.length} Storey(s) · {building.floors.reduce((s, f) => s + f.rooms.length, 0)} Rooms ·{' '}
            {building.floors.reduce((s, f) => s + f.walls.length, 0)} Walls · Revision #{building.version}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigateWorkspace('cad_2d')}
            className="px-3 py-1.5 rounded bg-amber-500 text-slate-950 font-mono text-xs font-bold"
          >
            2D Architectural Plan
          </button>
          <button
            type="button"
            onClick={() => onNavigateWorkspace('export')}
            className="px-3 py-1.5 rounded bg-slate-800 border border-white/15 font-mono text-xs"
          >
            Deliverable Exports
          </button>
        </div>
      </div>

      {/* Attached CAD Drawings, OpenBIM Sessions, BCF Archives, IDS & COBie Deliverables */}
      <div className="rounded-xl border border-white/10 bg-slate-900/80 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-mono font-bold uppercase text-slate-200">
            Project-Scoped CAD / BIM / BCF / COBie Assets ({docs.length})
          </h2>
          <button
            type="button"
            onClick={() => void unifiedWorkspaceActions.refreshProjectDocuments(building.projectId)}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-white/10 font-mono text-xs"
          >
            Refresh
          </button>
        </div>

        {docs.length === 0 ? (
          <p className="text-xs font-mono text-slate-400 py-4">
            No engineering documents saved to this project yet. Save a `.cota` drawing or PDF plot from Professional CAD, run an IDS 1.0 audit or COBie 2.4 export in BIM Studio, or export a `.bcfzip` archive in Model Coordination.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="border-b border-white/10 text-slate-400">
                <tr>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Provenance</th>
                  <th className="py-2 pr-3">Canonical Rev</th>
                  <th className="py-2 pr-3">Size</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {docs.map(doc => {
                  const outdated = doc.canonicalRevision < building.version;
                  return (
                    <tr key={doc.docId} data-testid={`project-doc-row-${doc.docId}`}>
                      <td className="py-2 pr-3 font-sans font-medium text-slate-100">
                        <div>{doc.name}</div>
                        <div className="text-[10px] font-mono text-slate-400">{doc.fileName}</div>
                      </td>
                      <td className="py-2 pr-3 uppercase text-sky-300">{doc.kind.replace('_', ' ')}</td>
                      <td className="py-2 pr-3 text-slate-300">{doc.provenance}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={`px-2 py-0.5 rounded ${
                            outdated
                              ? 'bg-amber-500/20 border border-amber-400/40 text-amber-300'
                              : 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-300'
                          }`}
                        >
                          Rev #{doc.canonicalRevision} {outdated ? '(OUTDATED)' : '(CURRENT)'}
                        </span>
                      </td>
                      <td className="py-2 pr-3">{(doc.byteSize / 1024).toFixed(1)} KB</td>
                      <td className="py-2 text-right space-x-1.5">
                        {doc.kind === 'cota_drawing' && (
                          <button
                            type="button"
                            onClick={() => onNavigateWorkspace('pro_cad')}
                            className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-amber-200"
                          >
                            Open CAD
                          </button>
                        )}
                        {(doc.kind === 'bcf_archive' || doc.kind === 'openbim_session') && (
                          <button
                            type="button"
                            onClick={() => onNavigateWorkspace('coordination')}
                            className="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-400/40 text-sky-200"
                          >
                            Inspect
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleDownload(doc)}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-white/15"
                        >
                          Download
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(doc)}
                          className="px-2 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-rose-300"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};

export default ProjectFilesWorkspace;

import React, { useEffect, useRef, useState } from 'react';
import { PlanThumbnail } from './ProjectPortfolio';
import { ETABSExportPanel } from './ETABSExportPanel';
import { canonicalBuildingHash, type BlenderExportManifest, type ExportFileDescriptor } from '@ai-floor-planner/core';
import type { EditorContextValue } from '../../stores/editor-store';
import {
  requestVerifiedExport,
  downloadVerifiedExport,
  fetchVerifiedBytes,
  type VerifiedExportFormat,
  type VerifiedExportOptions,
} from '../../services/export-client';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const ExportCenterWorkspace: React.FC<{ editor: EditorContextValue }> = ({ editor }) => {
  const { building } = editor;
  const [paperSize, setPaper] = useState<'A3' | 'A2' | 'A1'>('A3');
  const [scale, setScale] = useState('FIT_TO_PAGE');
  const [artifacts, setArtifacts] = useState<Record<string, ExportFileDescriptor>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{
    url: string;
    type: string;
    title: string;
    text?: string;
  } | null>(null);
  const [blenderStatus, setBlenderStatus] = useState<'IDLE' | 'GENERATING' | 'VERIFIED' | 'FAILED'>('IDLE');
  const [blenderManifest, setBlenderManifest] = useState<BlenderExportManifest | null>(null);
  const [blenderError, setBlenderError] = useState<string>('');
  const [modelStatus, setModelStatus] = useState('');
  const controller = useRef(new AbortController());
  const current = useRef(building);
  current.current = building;
  useEffect(() => {
    controller.current.abort();
    controller.current = new AbortController();
    setArtifacts({});
    setPreview(null);
    setBusy(null);
    setError('');
    setBlenderStatus('IDLE');
    setBlenderManifest(null);
    setBlenderError('');
    setModelStatus('');
    return () => controller.current.abort();
  }, [building, paperSize, scale]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const rows = [
    {
      id: 'site',
      title: '01 Site Plan',
      options: { floorId: 'site', exportScope: 'site_plan' } as VerifiedExportOptions,
      formats: ['dwg', 'dxf', 'pdf'],
    },
    ...building.floors.map((f) => ({
      id: f.id,
      title: f.name,
      options: { floorId: f.id, exportScope: 'current_floor' } as VerifiedExportOptions,
      formats: ['dwg', 'dxf', 'pdf'],
    })),
    {
      id: 'structural',
      title: 'Structural Column & Beam Layout (S-COLS / S-BEAM)',
      options: {
        drawingKind: 'STRUCTURAL',
        exportScope: 'all_floors',
        includeRoomLabels: false,
        includeFurniture: false,
      } as VerifiedExportOptions,
      formats: ['dwg', 'dxf', 'pdf'],
    },
    {
      id: 'complete',
      title: 'Complete Building Drawing Set',
      options: { exportScope: 'complete_project' } as VerifiedExportOptions,
      formats: ['dwg', 'dxf', 'pdf'],
    },
    {
      id: 'geometry',
      title: 'Geometry Validation & Area Ledger Report',
      options: { exportScope: 'all_floors' } as VerifiedExportOptions,
      formats: ['geometry-pdf', 'geometry-json'],
    },
    { id: 'udcpr', title: 'UDCPR 2020 Statutory Compliance Report', options: { exportScope: 'all_floors' } as VerifiedExportOptions, formats: ['udcpr-pdf', 'udcpr-json'] },
    {
      id: 'structural_drawings',
      title: 'Structural CAD Drawing Set (S-101 to S-104 ISO A3)',
      options: { drawingKind: 'STRUCTURAL', exportScope: 'all_floors' } as VerifiedExportOptions,
      formats: ['structural-drawings-pdf'],
    },
    {
      id: 'structural_analysis_report',
      title: 'ETABS Structural Analysis & IS Code Compliance Report',
      options: { drawingKind: 'STRUCTURAL', exportScope: 'all_floors' } as VerifiedExportOptions,
      formats: ['structural-report-pdf', 'structural-report-json'],
    },
  ];
  const run = async (
    id: string,
    title: string,
    format: VerifiedExportFormat,
    options: VerifiedExportOptions,
    action: 'preview' | 'download',
  ) => {
    const snapshot = building,
      signal = controller.current.signal,
      key = `${id}-${format}`;
    setBusy(key);
    setError('');
    try {
      const artifact = await requestVerifiedExport(
        snapshot,
        format,
        { ...options, paperSize, scale },
        signal,
      );
      if (current.current !== snapshot || signal.aborted) return;
      setArtifacts((previous) => ({ ...previous, [key]: artifact }));
      if (action === 'download') await downloadVerifiedExport(artifact, signal);
      else {
        let blob: Blob;
        if (format === 'dwg' || format === 'dxf') {
          const response = await fetch(
            `/api/v1/export/preview/${encodeURIComponent(artifact.fileName)}`,
            { signal },
          );
          if (!response.ok) throw new Error('CAD preview failed to reopen');
          blob = await response.blob();
        } else blob = await fetchVerifiedBytes(artifact, signal);
        if (current.current === snapshot && !signal.aborted)
          {
            const content = format.endsWith('-json') ? await blob.text() : undefined;
            if (current.current === snapshot && !signal.aborted) setPreview({
              url: URL.createObjectURL(blob), type: blob.type, title, text: content,
            });
          }
      }
    } catch (e) {
      if (!signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal.aborted) setBusy(null);
    }
  };

  async function downloadBuildingModel() {
    const signal = controller.current.signal;
    setBusy('building-model');
    setModelStatus('Preparing building geometry…');
    try {
      const response = await fetch('/api/v1/export/glb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ building, options: { expectedRevision: building.version } }),
        signal,
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error?.message ?? `GLB export failed (${response.status}).`);
      if (response.headers.get('x-building-revision') !== String(building.version) ||
        response.headers.get('x-building-sha256') !== canonicalBuildingHash(building)) {
        throw new Error('The GLB response belongs to a different building revision.');
      }
      const bytes = await response.arrayBuffer();
      if (signal.aborted || current.current !== building) return;
      const header = new DataView(bytes);
      if (bytes.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67
        || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== bytes.byteLength) {
        throw new Error('The exported file has an invalid GLB header or length.');
      }
      const name = (building.name || building.id).replace(/[^a-zA-Z0-9_-]/g, '_');
      downloadBlob(new Blob([bytes], { type: 'model/gltf-binary' }), `${name}.glb`);
      setModelStatus(`Download started · ${bytes.byteLength.toLocaleString()} bytes · revision ${building.version}`);
    } catch (cause) {
      if (!signal.aborted) setModelStatus(cause instanceof Error ? cause.message : 'GLB export failed.');
    } finally {
      if (!signal.aborted) setBusy(null);
    }
  }

  async function generateBlenderPackage() {
    const signal = controller.current.signal;
    setBlenderStatus('GENERATING');
    setBlenderManifest(null);
    setBlenderError('');
    try {
      const res = await fetch('/api/v1/export/blender-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ building, options: { expectedRevision: building.version } }),
        signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? data.message ?? `Blender export failed (${res.status}).`);
      if (signal.aborted || current.current !== building) return;
      const manifest = data as BlenderExportManifest;
      if (manifest.buildingId !== building.id || manifest.revision !== building.version
        || !manifest.files?.length || manifest.files.some(file => !file.verification?.isValid || !file.sha256 || !file.downloadUrl)) {
        throw new Error('Blender returned an unverified or stale package.');
      }
      setBlenderManifest(manifest);
      setBlenderStatus('VERIFIED');
    } catch (cause) {
      if (signal.aborted) return;
      setBlenderStatus('FAILED');
      setBlenderError(cause instanceof Error ? cause.message : 'Blender export failed.');
    }
  }

  async function downloadBlenderFile(file: ExportFileDescriptor) {
    const signal = controller.current.signal;
    setBusy(file.fileId);
    setBlenderError('');
    try {
      await downloadVerifiedExport(file, signal);
    } catch (cause) {
      if (!signal.aborted) setBlenderError(cause instanceof Error ? cause.message : 'Download failed.');
    } finally {
      if (!signal.aborted) setBusy(null);
    }
  }

  return (
    <section
      className="rh-exports h-full overflow-auto p-4 sm:p-6"
      aria-label="Independent export center"
    >
      <header className="rh-export-header rh-delivery-cover">
        <div>
          <p className="rh-kicker">{building.name} · revision {building.version}</p>
          <h2>Export Center</h2>
        </div>
        <dl className="rh-delivery-register">
          <div><dt>Drawing sheets</dt><dd>{rows.length}</dd></div>
          <div><dt>Verified drawing files</dt><dd>{Object.keys(artifacts).length}</dd></div>
        </dl>
        <PlanThumbnail building={building} />
      </header>
      <nav className="rh-delivery-nav" aria-label="Export sections">
        <a href="#delivery-sheets">Drawing sheets</a>
        <a href="#delivery-models">Model files</a>
        <a href="#delivery-etabs">ETABS</a>
      </nav>
      <div className="rh-delivery-desk" id="delivery-sheets">
      <aside className="rh-delivery-settings" aria-label="Drawing issue settings">
      <h3>Drawing issue</h3>
      <div className="rh-sheet-settings my-4 flex flex-wrap gap-4">
        <label>
          Paper{' '}
          <select
            aria-label="Export paper"
            value={paperSize}
            onChange={(e) => setPaper(e.target.value as typeof paperSize)}
            className="bg-argon-surface p-2"
          >
            {['A3', 'A2', 'A1'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          Scale{' '}
          <select
            aria-label="Export scale"
            value={scale}
            onChange={(e) => setScale(e.target.value)}
            className="bg-argon-surface p-2"
          >
            {['FIT_TO_PAGE', '1:50', '1:100', '1:200'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="mb-4 text-xs text-argon-muted">
        Exact scales fall back to fit-to-page when needed. Automated checks provide engineering
        design assistance and require verification by a licensed Architect/Engineer before municipal
        submission.
      </p>
      </aside>
      <div className="rh-delivery-content">
      {error && (
        <p role="alert" className="my-3 text-argon-error">
          {error}
        </p>
      )}
      <div className="rh-delivery-sheets grid gap-4 xl:grid-cols-2">
        {rows.map((row) => (
          <article key={row.id} className="rh-export-card p-4">
            <h3 className="font-medium">{row.title}</h3>
            {row.formats.map((f) => {
              const format = f as VerifiedExportFormat,
                key = `${row.id}-${format}`,
                artifact = artifacts[key];
              return (
                <div key={format} className="my-3 border-t border-argon-border pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="mr-auto text-xs">{format.toUpperCase()}</strong>
                    <button
                      disabled={busy !== null}
                      onClick={() => void run(row.id, row.title, format, row.options, 'preview')}
                      className="rh-button"
                      aria-label={`Preview ${row.title} ${format}`}
                    >
                      Preview
                    </button>
                    <button
                      disabled={busy !== null}
                      onClick={() => void run(row.id, row.title, format, row.options, 'download')}
                      className="rh-button rh-button-primary"
                      aria-label={`Download ${row.title} ${format}`}
                    >
                      Download
                    </button>
                  </div>
                  <p className="mt-2 break-words text-xs text-argon-muted" role="status">
                    {busy === key
                      ? 'GENERATING / VERIFYING'
                      : artifact
                        ? `VERIFIED · ${artifact.sizeBytes} bytes · SHA-256 ${artifact.sha256?.slice(0, 16)} · revision ${artifact.revision}`
                        : 'Ready to request'}
                  </p>
                </div>
              );
            })}
          </article>
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2" id="delivery-models">
        <article className="rh-export-card p-4">
          <h3 className="font-semibold">Building model</h3>
          <p className="my-2 text-sm text-argon-muted">Whole-building GLB from the active architectural model.</p>
          <button type="button" className="rh-button rh-button-primary" disabled={busy !== null}
            onClick={() => void downloadBuildingModel()}>Download building GLB</button>
          {modelStatus && <p role="status" className="mt-2 text-sm">{modelStatus}</p>}
        </article>
        <article className="rh-export-card p-4">
          <h3 className="font-semibold">Native Blender package</h3>
          <p className="my-2 text-sm text-argon-muted">Generate .blend and .glb files using the server’s Blender installation.</p>
          <button type="button" className="rh-button" disabled={blenderStatus === 'GENERATING'}
            onClick={() => void generateBlenderPackage()}>
            {blenderStatus === 'GENERATING' ? 'Preparing package…' : 'Generate 3D Package'}
          </button>
          {blenderError && <p role="alert" className="mt-2 text-sm">{blenderError}</p>}
          {blenderManifest && <ul className="mt-3 space-y-2">
            {blenderManifest.files.map((file) => <li key={file.fileId}>
              <button type="button" className="rh-button" disabled={busy !== null} onClick={() => void downloadBlenderFile(file)}>
                Download {file.fileName}
              </button>
            </li>)}
          </ul>}
        </article>
      </div>
      <div id="delivery-etabs"><ETABSExportPanel building={building} /></div>
      </div>
      </div>
      {preview && (
        <div
          role="dialog"
          aria-label="Verified artifact preview"
          className="rh-export-card fixed inset-2 sm:inset-6 z-[60] flex flex-col p-4"
        >
          <div className="mb-3 flex justify-between">
            <h3>
              {preview.title} · verified revision {building.version}
            </h3>
            <button type="button" className="rh-button" onClick={() => setPreview(null)}>Close preview</button>
          </div>
          <>
            {preview.text ? (
              <pre className="min-h-0 flex-1 overflow-auto bg-argon-surface p-4 text-xs">
                {preview.text}
              </pre>
            ) : (
              <iframe
                sandbox={preview.type === 'image/svg+xml' ? '' : undefined}
                title={preview.title}
                src={preview.url}
                className="min-h-0 flex-1 bg-white"
              />
            )}
          </>
        </div>
      )}
    </section>
  );
};

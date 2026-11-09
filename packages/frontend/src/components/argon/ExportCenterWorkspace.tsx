import React, { useEffect, useRef, useState } from 'react';
import type { ExportFileDescriptor } from '@ai-floor-planner/core';
import type { EditorContextValue } from '../../stores/editor-store';
import {
  requestVerifiedExport,
  downloadVerifiedExport,
  fetchVerifiedBytes,
  type VerifiedExportFormat,
  type VerifiedExportOptions,
} from '../../services/export-client';

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
          setPreview({
            url: URL.createObjectURL(blob),
            type: blob.type,
            title,
            text: format.endsWith('-json') ? await blob.text() : undefined,
          });
      }
    } catch (e) {
      if (!signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal.aborted) setBusy(null);
    }
  };
  return (
    <section
      className="h-full overflow-auto bg-slate-950 p-6 text-slate-100"
      aria-label="Independent export center"
    >
      <h2 className="text-xl font-bold">Independent Export Center</h2>
      <p className="mt-2 text-slate-400">
        {building.name} · revision {building.version}
      </p>
      <div className="my-4 flex flex-wrap gap-4">
        <label>
          Paper{' '}
          <select
            aria-label="Export paper"
            value={paperSize}
            onChange={(e) => setPaper(e.target.value as typeof paperSize)}
            className="bg-slate-800 p-2"
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
            className="bg-slate-800 p-2"
          >
            {['FIT_TO_PAGE', '1:50', '1:100', '1:200'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="mb-4 text-xs text-amber-200">
        Exact scales fall back to fit-to-page when needed. Automated checks provide engineering
        design assistance and require verification by a licensed Architect/Engineer before municipal
        submission.
      </p>
      {error && (
        <p role="alert" className="my-3 text-red-300">
          {error}
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {rows.map((row) => (
          <article key={row.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h3 className="font-medium">{row.title}</h3>
            {row.formats.map((f) => {
              const format = f as VerifiedExportFormat,
                key = `${row.id}-${format}`,
                artifact = artifacts[key];
              return (
                <div key={format} className="my-3 border-t border-slate-700 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="mr-auto text-xs">{format.toUpperCase()}</strong>
                    <button
                      disabled={busy !== null}
                      onClick={() => void run(row.id, row.title, format, row.options, 'preview')}
                      className="rounded bg-slate-700 px-3 py-2 text-xs"
                      aria-label={`Preview ${row.title} ${format}`}
                    >
                      Preview
                    </button>
                    <button
                      disabled={busy !== null}
                      onClick={() => void run(row.id, row.title, format, row.options, 'download')}
                      className="rounded bg-amber-500 px-3 py-2 text-xs text-slate-950"
                      aria-label={`Download ${row.title} ${format}`}
                    >
                      Independent Download
                    </button>
                  </div>
                  <p className="mt-2 break-all text-xs text-slate-400">
                    {busy === key
                      ? 'GENERATING / VERIFYING'
                      : artifact
                        ? `VERIFIED · ${artifact.sizeBytes} bytes · SHA-256 ${artifact.sha256?.slice(0, 16)} · revision ${artifact.revision}`
                        : 'NOT_RUN'}
                  </p>
                </div>
              );
            })}
          </article>
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {[
          ['Blender .blend / .glb', 5],
          ['ETABS .e2k / Structural Error PDF', 6],
        ].map(([name, phase]) => (
          <article key={name} className="rounded border border-slate-700 p-4">
            <h3>{name}</h3>
            <p className="my-2 text-xs text-slate-400">UNAVAILABLE (PENDING PHASE {phase})</p>
            <button disabled>Preview</button>
            <button disabled className="ml-4">
              Download
            </button>
          </article>
        ))}
      </div>
      {preview && (
        <div
          role="dialog"
          aria-label="Verified artifact preview"
          className="fixed inset-6 z-50 flex flex-col rounded-xl border border-slate-600 bg-slate-900 p-4"
        >
          <div className="mb-3 flex justify-between">
            <h3>
              {preview.title} · verified revision {building.version}
            </h3>
            <button onClick={() => setPreview(null)}>Close preview</button>
          </div>
          <>
            {preview.text ? (
              <pre className="min-h-0 flex-1 overflow-auto bg-slate-950 p-4 text-xs">
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

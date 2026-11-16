import { useEffect, useRef, useState } from 'react';
import { canonicalRevisionJson, parseStructuralProjectForExport, type Building, type ETABSExportDescriptor } from '@ai-floor-planner/core';

const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
function save(bytes: Blob, filename: string) {
  const url = URL.createObjectURL(bytes), link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Reviewed structural input remains separate from architectural/provisional members. */
export function ETABSExportPanel({ building }: { building: Building }) {
  const [source, setSource] = useState(''), [token, setToken] = useState('');
  const [artifact, setArtifact] = useState<ETABSExportDescriptor | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [showImportGuide, setShowImportGuide] = useState(false);
  const generation = useRef(0);
  const current = useRef(building); current.current = building;
  useEffect(() => { generation.current++; setSource(''); setArtifact(null); setError(''); setBusy(false); }, [building]);
  const changeSource = (value: string) => { generation.current++; setSource(value); setArtifact(null); setError(''); setBusy(false); };
  async function exportModel() {
    const requestGeneration = ++generation.current, requestedBuilding = building;
    setBusy(true); setError(''); setArtifact(null);
    try {
      const project = parseStructuralProjectForExport(JSON.parse(source));
      const revision = await sha256(new TextEncoder().encode(canonicalRevisionJson(requestedBuilding)));
      if (project.architecturalBuildingId !== requestedBuilding.id || project.sourceArchitecturalRevisionId !== revision)
        throw new Error('ENGINEERING_INPUTS_REQUIRED: structural review must reference this building and its current architectural SHA-256 revision.');
      const response = await fetch('/api/v1/export/etabs', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ project }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Native export failed');
      const result = body.artifact as ETABSExportDescriptor;
      if (result.projectId !== project.id || result.sourceArchitecturalRevisionId !== revision || result.verification !== 'NATIVE_REOPEN_MATCH'
        || result.analysisStatus !== 'NOT_ANALYZED' || !/^[a-f0-9]{64}$/.test(result.sha256)
        || !/^[a-f0-9]{32}$/.test(result.artifactId) || result.downloadUrl !== '/api/v1/export/etabs/download/' + result.artifactId)
        throw new Error('Unverified or stale native export response');
      if (generation.current === requestGeneration && current.current === requestedBuilding) setArtifact(result);
    } catch (e) { if (generation.current === requestGeneration) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (generation.current === requestGeneration) setBusy(false); }
  }
  async function download() {
    if (!artifact) return;
    const requestGeneration = generation.current;
    setBusy(true); setError('');
    try {
      const response = await fetch(artifact.downloadUrl, { headers: { Authorization: 'Bearer ' + token } });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message ?? 'Download failed'); }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== artifact.byteLength || await sha256(bytes) !== artifact.sha256) throw new Error('Downloaded EDB checksum mismatch');
      if (requestGeneration !== generation.current) throw new Error('Architectural revision or structural input changed during download');
      save(new Blob([bytes], { type: 'application/octet-stream' }), artifact.fileName);
    } catch (e) { if (requestGeneration === generation.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (requestGeneration === generation.current) setBusy(false); }
  }
  async function downloadE2k() {
    const requestGeneration = ++generation.current;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/export/etabs/e2k', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ building }),
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error?.message ?? 'ETABS .e2k generation failed');
      }
      const e2kText = await response.text();
      if (requestGeneration !== generation.current) return;
      const safeName = (building.name || building.id || 'etabs_model').replace(/[^a-zA-Z0-9_-]/g, '_');
      save(new Blob([e2kText], { type: 'text/plain;charset=utf-8' }), `${safeName}.e2k`);
    } catch (e) {
      if (requestGeneration === generation.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (requestGeneration === generation.current) setBusy(false);
    }
  }

  return <section aria-label="Native ETABS export" className="my-6 rounded border border-slate-700 p-4">
    <h3 className="font-semibold">Export to ETABS (.edb / .e2k)</h3>
    <p className="my-2 text-sm text-slate-400">Download a ready-to-import CSI ETABS text model (.e2k) directly, or upload an engineer-reviewed StructuralProject for local native .edb creation. Export transfers supported inputs; it does not run analysis or certify design safety.</p>
    <label className="block">Reviewed StructuralProject JSON<input aria-label="Reviewed StructuralProject JSON" type="file" accept=".json,application/json" disabled={busy} onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      const requestedBuilding = building;
      if (file.size > 1048576) { setError('StructuralProject exceeds 1 MiB'); return; }
      const value = await file.text(); if (current.current === requestedBuilding) changeSource(value);
    }} /></label>
    <label className="my-3 block">Local export token<input aria-label="Local export token" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} className="ml-3 bg-slate-800 p-2" /></label>
    <div className="flex flex-wrap gap-2">
      <button disabled={busy || !source || token.length < 32} onClick={() => void exportModel()} className="rounded bg-indigo-700 p-2 disabled:opacity-40">{busy ? 'Working with native ETABS…' : 'Export to ETABS (.edb)'}</button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void downloadE2k()}
        className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
      >
        Download CSI ETABS (.e2k)
      </button>
      <button
        type="button"
        onClick={() => setShowImportGuide((v) => !v)}
        title="View step-by-step instructions to open .e2k in CSI ETABS"
        className="rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
      >
        {showImportGuide ? 'Hide ETABS Import Guide' : 'How to Import .e2k in ETABS'}
      </button>
    </div>
    {showImportGuide && (
      <div
        role="region"
        aria-label="CSI ETABS .e2k Import Guide"
        className="mt-3 rounded border border-emerald-500/40 bg-slate-900/80 p-3 text-xs text-slate-200"
      >
        <p className="mb-1.5 font-semibold text-emerald-300">
          CSI ETABS 3-Step Import Guide (.e2k Text Model — Units: kN, m, C)
        </p>
        <ol className="list-decimal space-y-1 pl-4 text-slate-300">
          <li>
            Launch <strong>CSI ETABS</strong> (v18–v22) and open{' '}
            <code>File → Import → ETABS .e2k Text File...</code> (do not use double-click).
          </li>
          <li>
            Select the downloaded <code>.e2k</code> file and verify units are{' '}
            <strong>KN / M / C</strong> and Story Definitions match from Top to <code>BASE</code>.
          </li>
          <li>
            Run <code>Analyze → Check Model</code> (0 overlapping joint warnings), review IS 456 load combos{' '}
            (<code>IS456_1.5(DL+LL)</code>, <code>EQX</code>, <code>EQY</code>), then save natively as{' '}
            <code>.edb</code>.
          </li>
        </ol>
      </div>
    )}
    {error && <p role="alert" className="mt-3 text-red-300">{error}</p>}
    {artifact && <div className="mt-3">
      <p>{artifact.exportMode === 'ANALYSIS_READY' ? 'Analysis-ready model' : 'Model-only'} · NOT ANALYZED · Design NOT VERIFIED</p>
      <p className="break-all text-xs">Native reopen verified · {artifact.byteLength} bytes · SHA-256 {artifact.sha256}</p>
      <button disabled={busy} onClick={() => void download()} className="mr-3 mt-2 rounded bg-slate-700 p-2">Download verified .edb</button>
      <button onClick={() => save(new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' }), artifact.fileName + '.manifest.json')} className="rounded bg-slate-700 p-2">Download manifest</button>
    </div>}
  </section>;
}

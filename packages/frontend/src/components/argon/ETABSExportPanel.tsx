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
  return <section aria-label="Native ETABS export" className="my-6 rounded border border-slate-700 p-4">
    <h3 className="font-semibold">Export to ETABS (.edb)</h3>
    <p className="my-2 text-sm text-slate-400">Import the engineer-reviewed StructuralProject for this architectural revision. Export transfers supported inputs; it does not run analysis or certify design safety.</p>
    <label className="block">Reviewed StructuralProject JSON<input aria-label="Reviewed StructuralProject JSON" type="file" accept=".json,application/json" disabled={busy} onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      const requestedBuilding = building;
      if (file.size > 1048576) { setError('StructuralProject exceeds 1 MiB'); return; }
      const value = await file.text(); if (current.current === requestedBuilding) changeSource(value);
    }} /></label>
    <label className="my-3 block">Local export token<input aria-label="Local export token" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} className="ml-3 bg-slate-800 p-2" /></label>
    <button disabled={busy || !source || token.length < 32} onClick={() => void exportModel()} className="rounded bg-indigo-700 p-2 disabled:opacity-40">{busy ? 'Working with native ETABS…' : 'Export to ETABS (.edb)'}</button>
    {error && <p role="alert" className="mt-3 text-red-300">{error}</p>}
    {artifact && <div className="mt-3">
      <p>{artifact.exportMode === 'ANALYSIS_READY' ? 'Analysis-ready model' : 'Model-only'} · NOT ANALYZED · Design NOT VERIFIED</p>
      <p className="break-all text-xs">Native reopen verified · {artifact.byteLength} bytes · SHA-256 {artifact.sha256}</p>
      <button disabled={busy} onClick={() => void download()} className="mr-3 mt-2 rounded bg-slate-700 p-2">Download verified .edb</button>
      <button onClick={() => save(new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' }), artifact.fileName + '.manifest.json')} className="rounded bg-slate-700 p-2">Download manifest</button>
    </div>}
  </section>;
}

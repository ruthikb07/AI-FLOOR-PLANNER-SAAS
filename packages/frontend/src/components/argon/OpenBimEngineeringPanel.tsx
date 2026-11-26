import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BUILTIN_CLASSIFICATION_SYSTEMS,
  DEFAULT_RESIDENTIAL_IDS_XML,
  compileFormula,
  mountOpenBimStudio,
  validateFormula,
  type BimCanonicalEditResult,
  type MountedOpenBimStudioController,
  type OpenBimSessionSnapshot,
} from '@ai-floor-planner/openbim-integration';
import type { EditorContextValue } from '../../stores/editor-store';
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

export const OpenBimEngineeringPanel: React.FC<{ editor: EditorContextValue }> = ({ editor }) => {
  const { building, activeFloor, selection } = editor;
  const ctrlRef = useRef<MountedOpenBimStudioController | null>(null);
  const [snap, setSnap] = useState<OpenBimSessionSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<'authoring' | 'qto' | 'ids' | 'ifc_semantic'>('authoring');

  // Authoring & classification form state
  const [classSystemId, setClassSystemId] = useState(BUILTIN_CLASSIFICATION_SYSTEMS[0]!.id);
  const [classCode, setClassCode] = useState(BUILTIN_CLASSIFICATION_SYSTEMS[0]!.codes[0]!.code);
  const [propKey, setPropKey] = useState('FireRating');
  const [propVal, setPropVal] = useState('FD60');
  const [paramValueMm, setParamValueMm] = useState('230');
  const [materialText, setMaterialText] = useState('AAC Masonry 230mm');
  const [editPreview, setEditPreview] = useState<BimCanonicalEditResult | null>(null);

  // Formula & IDS state
  const [formulaExpr, setFormulaExpr] = useState('ROUND([Area] * 1.08, 2)');
  const [idsXmlText, setIdsXmlText] = useState(DEFAULT_RESIDENTIAL_IDS_XML);
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
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
    setEditPreview(null);
  }, [building]);

  const activeSystem = useMemo(
    () => BUILTIN_CLASSIFICATION_SYSTEMS.find(s => s.id === classSystemId) ?? BUILTIN_CLASSIFICATION_SYSTEMS[0]!,
    [classSystemId],
  );

  const targetEntity = useMemo(() => {
    if (selection && (selection.entityType === 'wall' || selection.entityType === 'door' || selection.entityType === 'window')) {
      return { kind: selection.entityType as 'wall' | 'door' | 'window', id: selection.entityId };
    }
    const firstWall = activeFloor.walls[0];
    return firstWall ? { kind: 'wall' as const, id: firstWall.id } : null;
  }, [selection, activeFloor]);

  const formulaEval = useMemo(() => {
    const check = validateFormula(formulaExpr);
    if (!check.ok) return { ok: false as const, error: check.error, rows: [] };
    try {
      const fn = compileFormula(formulaExpr);
      const rows = (ctrlRef.current?.getProjectedModel().takeoffRows ?? []).slice(0, 8).map(r => ({
        label: r.label,
        area: r.area,
        volume: r.volume,
        computed: fn({
          values: {
            Count: r.count,
            Length: Number(r.length.toFixed(3)),
            Area: Number(r.area.toFixed(3)),
            Volume: Number(r.volume.toFixed(3)),
          },
        }),
      }));
      return { ok: true as const, error: '', rows };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Formula evaluation error', rows: [] };
    }
  }, [formulaExpr, snap?.source.sha256]);

  const handleExportCobie = async (fmt: 'xls' | 'zip') => {
    if (!ctrlRef.current) return;
    const bytes = ctrlRef.current.exportCobie(fmt);
    const fileName = `${building.projectId}-cobie24-r${building.version}.${fmt}`;
    const mime = fmt === 'xls' ? 'application/vnd.ms-excel' : 'application/zip';
    downloadBytes(bytes, mime, fileName);
    await saveProjectEngineeringDocument(building.projectId, {
      buildingId: building.id,
      kind: 'cobie_package',
      name: `COBie 2.4 Facility Handover (${fmt.toUpperCase()})`,
      fileName,
      mimeType: mime,
      canonicalRevision: building.version,
      provenance: 'exported_deliverable',
      contentBase64: uint8ToBase64(bytes),
    });
    void unifiedWorkspaceActions.refreshProjectDocuments(building.projectId);
    setStatusMsg(`Exported ${fileName} and archived to Unified Project Files.`);
  };

  const handleRunIds = async () => {
    if (!ctrlRef.current) return;
    try {
      const report = ctrlRef.current.runIdsAudit(idsXmlText);
      await saveProjectEngineeringDocument(building.projectId, {
        docId: 'ids-latest-audit',
        buildingId: building.id,
        kind: 'ids_report',
        name: `IDS 1.0 Audit (${report.passRatePct}% Pass)`,
        fileName: `${building.projectId}-ids-r${building.version}.json`,
        mimeType: 'application/json',
        canonicalRevision: building.version,
        provenance: 'authored_openbim',
        contentText: JSON.stringify(report, null, 2),
      });
      void unifiedWorkspaceActions.refreshProjectDocuments(building.projectId);
      setStatusMsg(`IDS 1.0 audit complete: ${report.passRatePct}% pass rate across ${report.elementsChecked} elements.`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Invalid IDS XML specification.');
    }
  };

  return (
    <section
      className="rh-bim-card"
      aria-label="OpenBIM Studio Authoring, Validation & 5D QTO"
      data-testid="openbim-studio-panel"
    >
      <div className="rh-bim-controls" style={{ justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <div>
          <h2>OpenBIM Studio — Classification, 5D QTO, IDS 1.0 &amp; COBie 2.4</h2>
          <p style={{ fontSize: '0.8rem', opacity: 0.8 }}>
            Integrated OpenBIM v0.74 engine · {snap?.elementCount ?? 0} semantic BIM elements · Canonical Rev #{building.version}
          </p>
        </div>
        <div className="rh-bim-controls" role="tablist" aria-label="OpenBIM Subsystems">
          {(
            [
              ['authoring', 'Authoring & Classification'],
              ['qto', '5D QTO & COBie 2.4'],
              ['ids', 'IDS 1.0 Validation'],
              ['ifc_semantic', 'IFC4 / IFC4X3 Fidelity'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              data-testid={`openbim-tab-${id}`}
              aria-selected={activeTab === id}
              aria-pressed={activeTab === id}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {statusMsg && (
        <p role="status" data-testid="openbim-status-banner" style={{ marginBottom: '0.75rem', fontWeight: 600 }}>
          {statusMsg}
        </p>
      )}

      {activeTab === 'authoring' && (
        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <div>
            <h3>Classification &amp; Custom Psets</h3>
            <p style={{ fontSize: '0.82rem' }}>
              Target Element: <code>{targetEntity ? `${targetEntity.kind}:${targetEntity.id}` : 'None'}</code>
            </p>
            <div className="rh-bim-controls" style={{ marginTop: '0.5rem' }}>
              <label>
                System{' '}
                <select
                  aria-label="Classification system"
                  data-testid="openbim-class-system"
                  value={classSystemId}
                  onChange={e => {
                    const sys = BUILTIN_CLASSIFICATION_SYSTEMS.find(s => s.id === e.target.value)!;
                    setClassSystemId(sys.id);
                    setClassCode(sys.codes[0]?.code ?? '');
                  }}
                >
                  {BUILTIN_CLASSIFICATION_SYSTEMS.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Code{' '}
                <select
                  aria-label="Classification code"
                  data-testid="openbim-class-code"
                  value={classCode}
                  onChange={e => setClassCode(e.target.value)}
                >
                  {activeSystem.codes.map(ent => (
                    <option key={ent.code} value={ent.code}>
                      {ent.code} — {ent.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                data-testid="openbim-assign-class-btn"
                disabled={!targetEntity}
                onClick={() => {
                  if (!targetEntity || !ctrlRef.current) return;
                  ctrlRef.current.assignClassification(targetEntity.id, classSystemId, classCode);
                  void unifiedWorkspaceActions.persistOpenBimSessionToProject(building.projectId, building.id, building.version);
                  setStatusMsg(`Assigned ${activeSystem.name} [${classCode}] to ${targetEntity.id}.`);
                }}
              >
                Assign Classification
              </button>
            </div>

            <div className="rh-bim-controls" style={{ marginTop: '0.5rem' }}>
              <label>
                Property{' '}
                <input value={propKey} onChange={e => setPropKey(e.target.value)} placeholder="FireRating" />
              </label>
              <label>
                Value{' '}
                <input value={propVal} onChange={e => setPropVal(e.target.value)} placeholder="FD60" />
              </label>
              <button
                type="button"
                data-testid="openbim-set-prop-btn"
                disabled={!targetEntity}
                onClick={() => {
                  if (!targetEntity || !ctrlRef.current) return;
                  ctrlRef.current.setCustomProperty(targetEntity.id, propKey, propVal);
                  void unifiedWorkspaceActions.persistOpenBimSessionToProject(building.projectId, building.id, building.version);
                  setStatusMsg(`Set ${propKey}="${propVal}" on ${targetEntity.id}.`);
                }}
              >
                Save Property
              </button>
            </div>
          </div>

          <div>
            <h3>Validated Parametric BIM Edit</h3>
            <p style={{ fontSize: '0.82rem' }}>
              Propose dimensional or material changes on <code>{targetEntity ? `${targetEntity.kind}:${targetEntity.id}` : 'floor slab'}</code> through the canonical architectural constraint engine.
            </p>
            <div className="rh-bim-controls" style={{ marginTop: '0.5rem' }}>
              <label>
                {targetEntity?.kind === 'wall' ? 'Thickness (mm)' : 'Width (mm)'}{' '}
                <input
                  type="number"
                  data-testid="openbim-param-mm-input"
                  value={paramValueMm}
                  onChange={e => setParamValueMm(e.target.value)}
                />
              </label>
              <label>
                Material{' '}
                <input value={materialText} onChange={e => setMaterialText(e.target.value)} />
              </label>
              <button
                type="button"
                data-testid="openbim-preview-edit-btn"
                onClick={() => {
                  if (!ctrlRef.current) return;
                  const mm = Number(paramValueMm);
                  const res = ctrlRef.current.proposeCanonicalEdit({
                    floorId: activeFloor.id,
                    entityKind: targetEntity?.kind ?? 'slab',
                    canonicalId: targetEntity?.id ?? `${activeFloor.id}::slab`,
                    patch:
                      targetEntity?.kind === 'wall' || !targetEntity
                        ? { thicknessMm: mm, material: materialText }
                        : { widthMm: mm, material: materialText },
                  });
                  setEditPreview(res);
                }}
              >
                Validate BIM Edit
              </button>
            </div>
            {editPreview && (
              <div data-testid="openbim-edit-preview" style={{ marginTop: '0.5rem' }}>
                <p style={{ fontWeight: 600 }}>
                  {editPreview.ok ? `Validated: ${editPreview.summary}` : `Rejected: ${editPreview.summary}`}
                </p>
                {editPreview.blockingFindings.map((f, i) => (
                  <p key={i} style={{ fontSize: '0.8rem' }}>• {f}</p>
                ))}
                {editPreview.ok && editPreview.candidateBuilding && (
                  <button
                    type="button"
                    data-testid="openbim-apply-edit-btn"
                    onClick={() => {
                      editor.applyRefinement(editPreview.candidateBuilding!, editPreview.summary, true);
                      setEditPreview(null);
                      setStatusMsg(`Applied BIM edit -> Canonical Revision #${editPreview.candidateBuilding!.version}.`);
                    }}
                  >
                    Commit to Canonical Building
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'qto' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="rh-bim-controls" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>5D QTO Estimated Direct Cost:</strong>{' '}
              <span data-testid="openbim-qto-total">
                ₹{Math.round(snap?.lastQtoRun.costTotal ?? 0).toLocaleString('en-IN')}
              </span>{' '}
              ({snap?.lastQtoRun.results.length ?? 0} work packages)
            </div>
            <div className="rh-bim-controls">
              <button type="button" data-testid="openbim-export-cobie-xls" onClick={() => void handleExportCobie('xls')}>
                Export COBie 2.4 (.xls)
              </button>
              <button type="button" data-testid="openbim-export-cobie-zip" onClick={() => void handleExportCobie('zip')}>
                Export COBie CSV (.zip)
              </button>
            </div>
          </div>

          <div className="rh-bim-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Work Package</th>
                  <th scope="col">Classification</th>
                  <th scope="col">Net Qty</th>
                  <th scope="col">Amount (INR)</th>
                </tr>
              </thead>
              <tbody>
                {(snap?.lastQtoRun.results ?? []).map(r => (
                  <tr key={r.ruleId}>
                    <td>{r.ruleName}</td>
                    <td>{r.classification || 'Uncoded'}</td>
                    <td>{r.quantity.toFixed(2)} {r.unit}</td>
                    <td>₹{Math.round(r.cost?.total ?? 0).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3>Safe AST Schedule Formula Evaluator</h3>
            <div className="rh-bim-controls">
              <label style={{ flex: 1 }}>
                Formula{' '}
                <input
                  data-testid="openbim-formula-input"
                  value={formulaExpr}
                  onChange={e => setFormulaExpr(e.target.value)}
                  style={{ width: '260px' }}
                />
              </label>
              <span>{formulaEval.ok ? `Valid AST (${formulaEval.rows.length} preview rows)` : `Formula error: ${formulaEval.error}`}</span>
            </div>
            {formulaEval.ok && formulaEval.rows.length > 0 && (
              <div className="rh-bim-scroll" style={{ maxHeight: '160px', marginTop: '0.4rem' }}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Element</th>
                      <th scope="col">Area (m²)</th>
                      <th scope="col">Computed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {formulaEval.rows.map((r, idx) => (
                      <tr key={idx}>
                        <td>{r.label}</td>
                        <td>{r.area.toFixed(2)}</td>
                        <td>{String(r.computed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'ids' && (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div className="rh-bim-controls" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>buildingSMART IDS 1.0 Audit:</strong>{' '}
              <span data-testid="openbim-ids-pass-rate">
                {snap?.lastIdsReport ? `${snap.lastIdsReport.passRatePct}% Pass (${snap.lastIdsReport.failedSpecifications} failed specs)` : 'Not run'}
              </span>
            </div>
            <button type="button" data-testid="openbim-run-ids-btn" onClick={() => void handleRunIds()}>
              Run IDS 1.0 Audit &amp; Save Report
            </button>
          </div>
          <textarea
            aria-label="IDS 1.0 XML specification"
            rows={5}
            value={idsXmlText}
            onChange={e => setIdsXmlText(e.target.value)}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.75rem', padding: '0.5rem' }}
          />
          {snap?.lastIdsReport && (
            <div className="rh-bim-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Specification</th>
                    <th scope="col">Applicable Elements</th>
                    <th scope="col">Passed Facets</th>
                    <th scope="col">Failed Facets</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.lastIdsReport.summary.map(s => (
                    <tr key={s.specificationId}>
                      <td>{s.specificationName}</td>
                      <td>{s.applicableCount}</td>
                      <td>{s.passed}</td>
                      <td>{s.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'ifc_semantic' && (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div className="rh-bim-controls">
            <label>
              Inspect IFC2X3 / IFC4 / IFC4X3 STEP File{' '}
              <input
                type="file"
                accept=".ifc,.ifczip"
                data-testid="openbim-ifc-fidelity-input"
                onChange={async e => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f || !ctrlRef.current) return;
                  const bytes = new Uint8Array(await f.arrayBuffer());
                  const diag = ctrlRef.current.inspectIfcStepBytes(f.name, bytes);
                  setStatusMsg(
                    `Inspected ${f.name}: schema=${diag.interop?.schema ?? 'Unknown'}, ${diag.interop?.totalEntities ?? 0} STEP entities, ${diag.findings.length} semantic finding(s).`,
                  );
                }}
              />
            </label>
          </div>
          {snap?.lastIfcDiagnostics ? (
            <div>
              <p>
                <strong>{snap.lastIfcDiagnostics.fileName}</strong> · Schema:{' '}
                <code>{snap.lastIfcDiagnostics.interop?.schema ?? 'Unknown'}</code> · Total STEP Entities:{' '}
                {snap.lastIfcDiagnostics.interop?.totalEntities ?? 0}
              </p>
              {snap.lastIfcDiagnostics.fidelity && (
                <p>
                  Per-Entity Fidelity: {snap.lastIfcDiagnostics.fidelity.totals.preserved} preserved ·{' '}
                  {snap.lastIfcDiagnostics.fidelity.totals.transformed} transformed ·{' '}
                  {snap.lastIfcDiagnostics.fidelity.totals.approximated} approximated ·{' '}
                  {snap.lastIfcDiagnostics.fidelity.totals.unsupported} unsupported
                </p>
              )}
              {snap.lastIfcDiagnostics.findings.length > 0 && (
                <ul>
                  {snap.lastIfcDiagnostics.findings.slice(0, 12).map((f, i) => (
                    <li key={i}>
                      <code>{f.code}</code> [{f.severity}]: {f.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p>Select any IFC STEP file to run OpenBIM semantic graph validation and per-entity conversion fidelity reporting.</p>
          )}
        </div>
      )}
    </section>
  );
};

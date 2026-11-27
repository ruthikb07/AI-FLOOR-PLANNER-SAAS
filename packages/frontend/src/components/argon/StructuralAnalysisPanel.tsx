import React, { useEffect, useMemo, useState } from 'react';
import type { Building } from '@ai-floor-planner/core';
import {
  type ConcreteGradeCode,
  type SeismicZoneCode,
  type SteelGradeCode,
} from '@ai-floor-planner/planning-engine';
import {
  MANDATORY_STRUCTURAL_DISCLAIMER,
  type FoundationSystemPreference,
  type SingleCaseSolveResult,
  type StructuralEvaluationSummary,
  type OptimizationObjectiveMode,
  type ReviewedStructuralInputs,
  type StructuralOptimizationSummary,
} from '@ai-floor-planner/structural-engine';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Cpu,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Send,
  ShieldAlert,
  Sparkles,
  Wrench,
} from 'lucide-react';

interface StructuralAnalysisPanelProps {
  readonly building: Building;
  readonly onDownloadReportPdf?: () => void;
  readonly reportBusy?: boolean;
}

type ScheduleSubTab =
  | 'COLUMNS'
  | 'BEAMS_SLABS'
  | 'FOOTINGS'
  | 'SEISMIC'
  | 'DIAGRAMS'
  | 'OPTIMIZER'
  | 'BBS_BOQ'
  | 'AI_ASSISTANT';

type DiagramKind = 'BMD' | 'SFD' | 'AFD' | 'TORSION' | 'DEFLECTION' | 'UTILIZATION';

async function requestStructural<T>(action: string, data: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/v1/structural/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? 'Structural request failed.');
  return result as T;
}

interface AnalysisRequest {
  readonly building: Building;
  readonly reviewedInputs: ReviewedStructuralInputs;
  readonly foundationPreference: FoundationSystemPreference;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const StructuralAnalysisPanel: React.FC<StructuralAnalysisPanelProps> = ({
  building,
  onDownloadReportPdf,
  reportBusy = false,
}) => {
  const [seismicZone, setSeismicZone] = useState<SeismicZoneCode>('III');
  const [concreteGrade, setConcreteGrade] = useState<ConcreteGradeCode>('M25');
  const [steelGrade, setSteelGrade] = useState<SteelGradeCode>('Fe500');
  const [sbcRaw, setSbcRaw] = useState('');
  const [foundationDepthM, setFoundationDepthM] = useState('');
  const [soilUnitWeight, setSoilUnitWeight] = useState('');
  const [settlementLimit, setSettlementLimit] = useState('');
  const [geotechReference, setGeotechReference] = useState('');
  const [foundationPref, setFoundationPref] = useState<FoundationSystemPreference>('AUTO');
  const [windEnabled, setWindEnabled] = useState<boolean>(true);
  const [activeSubTab, setActiveSubTab] = useState<ScheduleSubTab>('COLUMNS');

  // Awatif C++/WASM Live Evaluation State
  const [analysis, setAnalysis] = useState<{
    request: AnalysisRequest;
    evaluationId: string;
    snapshot: StructuralEvaluationSummary;
  } | null>(null);
  const [analysisRetry, setAnalysisRetry] = useState(0);
  const [feaBusy, setFeaBusy] = useState<boolean>(false);
  const [feaError, setFeaError] = useState<string>('');

  // Diagram & Member Inspector State
  const [diagramKind, setDiagramKind] = useState<DiagramKind>('BMD');
  const [selectedComboId, setSelectedComboId] = useState<string>('ULS_15_DL_LL');
  const [selectedElementIdx, setSelectedElementIdx] = useState<number>(0);
  const [caseDetail, setCaseDetail] = useState<{
    evaluationId: string;
    caseId: string;
    result?: SingleCaseSolveResult;
    error?: string;
  } | null>(null);

  // Optimizer State
  const [optMode, setOptMode] = useState<OptimizationObjectiveMode>('BALANCED');
  const [optBusy, setOptBusy] = useState<boolean>(false);
  const [optimization, setOptimization] = useState<{
    request: AnalysisRequest;
    evaluationId: string;
    result: StructuralOptimizationSummary;
  } | null>(null);

  // Export & AI Assistant State
  const [exportStatus, setExportStatus] = useState<string>('');
  const [exportBusy, setExportBusy] = useState<boolean>(false);
  const [assistantQuery, setAssistantQuery] = useState<string>('Summarize structural health, utilization, and rebar quantities');
  const [assistantBusy, setAssistantBusy] = useState<boolean>(false);
  const [assistantReply, setAssistantReply] = useState<{
    evaluationId: string;
    text: string;
    source: string;
  } | null>(null);
  const [useAi, setUseAi] = useState(false);

  const parsedSbc = Number(sbcRaw);
  const depth = Number(foundationDepthM);
  const unitWeight = Number(soilUnitWeight);
  const settlement = Number(settlementLimit);
  const hasGeotechnicalInputs = [parsedSbc, depth, unitWeight, settlement].every(
    (value) => Number.isFinite(value) && value > 0,
  ) && geotechReference.trim().length > 0;

  // Incomplete fields leave the pending foundation model unchanged while the report is being entered.
  const [appliedSbc, appliedDepth, appliedUnitWeight, appliedSettlement, appliedReport] =
    hasGeotechnicalInputs
      ? [parsedSbc, depth, unitWeight, settlement, geotechReference.trim()] as const
      : [0, 0, 0, 0, ''] as const;

  const reviewedInputs: ReviewedStructuralInputs = useMemo(
    () => ({
      concreteGrade,
      steelGrade,
      ductileDetailingIS13920: seismicZone !== 'II',
      floorFinishKnM2: 1.2,
      masonryUnitWeightKnM3: 19.0,
      roofLiveLoadKnM2: 1.5,
      seismic: {
        enabled: true,
        zone: seismicZone,
        soilType: 'MEDIUM',
        importanceFactorI: 1.0,
        responseReductionFactorR: seismicZone === 'II' ? 3.0 : 5.0,
        frameSystemType: 'RC_MRF_WITH_BRICK_INFILL',
      },
      wind: windEnabled
        ? {
            enabled: true,
            basicWindSpeedVbMs: 39,
            terrainCategory: 2,
          }
        : undefined,
      geotechnical: hasGeotechnicalInputs
        ? {
            safeBearingCapacityKPa: appliedSbc,
            foundationDepthBelowGroundM: appliedDepth,
            soilUnitWeightKnM3: appliedUnitWeight,
            allowableSettlementMm: appliedSettlement,
            reportReference: appliedReport,
          }
        : null,
    }),
    [concreteGrade, steelGrade, seismicZone, windEnabled, hasGeotechnicalInputs, appliedSbc, appliedDepth, appliedUnitWeight, appliedSettlement, appliedReport],
  );

  const analysisRequest = useMemo<AnalysisRequest>(
    () => ({ building, reviewedInputs, foundationPreference: foundationPref }),
    [building, reviewedInputs, foundationPref],
  );

  useEffect(() => {
    const abort = new AbortController();
    setFeaBusy(true);
    setFeaError('');
    setOptimization(null);
    const delay = window.setTimeout(() => {
      requestStructural<{ evaluationId: string; snapshot: StructuralEvaluationSummary }>(
        'analyze', analysisRequest, abort.signal,
      ).then((result) => {
        if (abort.signal.aborted) return;
        setAnalysis({ request: analysisRequest, ...result });
        const combinationIds = Object.keys(result.snapshot.solveEnvelope.combinationResults);
        if (combinationIds.length) {
          setSelectedComboId((current) => combinationIds.includes(current) ? current : combinationIds[0]!);
        }
      }).catch((error: unknown) => {
        if (!abort.signal.aborted) setFeaError(error instanceof Error ? error.message : String(error));
      }).finally(() => {
        if (!abort.signal.aborted) setFeaBusy(false);
      });
    }, 250);
    return () => {
      window.clearTimeout(delay);
      abort.abort();
    };
  }, [analysisRequest, analysisRetry]);

  const activeAnalysis = analysis?.request === analysisRequest ? analysis : null;
  const activeOptimization = optimization?.request === analysisRequest ? optimization : null;
  const optResult = activeOptimization?.result;
  const activeSnap = optResult?.after ?? activeAnalysis?.snapshot;
  const evaluationId = activeOptimization?.evaluationId ?? activeAnalysis?.evaluationId;
  const caseId = activeSnap?.solveEnvelope.combinationResults[selectedComboId]
    ? selectedComboId
    : Object.keys(activeSnap?.solveEnvelope.combinationResults ?? {})[0];
  const caseSummary = caseId ? activeSnap?.solveEnvelope.combinationResults[caseId] : undefined;
  const selectedCase = caseDetail?.evaluationId === evaluationId && caseDetail?.caseId === caseId ? caseDetail : null;
  const activeComboResult = selectedCase?.result;
  const solverBackend = caseSummary?.diagnostics.executionBackend ?? 'PENDING';

  useEffect(() => {
    if (activeSubTab !== 'DIAGRAMS' || !evaluationId || !caseId) return;
    const abort = new AbortController();
    requestStructural<{ result: SingleCaseSolveResult }>('case', { evaluationId, caseId }, abort.signal)
      .then(({ result }) => {
        if (!abort.signal.aborted) setCaseDetail({ evaluationId, caseId, result });
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          setCaseDetail({ evaluationId, caseId, error: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => abort.abort();
  }, [activeSubTab, evaluationId, caseId]);

  const lifecycleBadge = useMemo(() => {
    if (!activeSnap) return { label: feaError ? 'ANALYSIS UNAVAILABLE' : 'ANALYSIS PENDING', cls: 'bg-sky-500/20 text-sky-300 border-sky-400/40' };
    if (activeSnap.foundationDesign.status === 'MISSING_GEOTECHNICAL_INPUT') {
      return { label: 'INPUT REVIEW REQUIRED (GEOTECHNICAL)', cls: 'bg-amber-500/20 text-amber-300 border-amber-400/40' };
    }
    if (activeSnap.foundationDesign.status === 'UNSUPPORTED_FOUNDATION_TYPE') {
      return { label: 'UNSUPPORTED FOUNDATION SYSTEM', cls: 'bg-amber-500/20 text-amber-300 border-amber-400/40' };
    }
    if (optResult?.status === 'OPTIMIZED_VERIFIED') {
      return { label: 'OPTIMIZED · CHECKS PASSED (REVIEW REQ.)', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40' };
    }
    if (activeSnap.criticalDefectCount === 0 && activeSnap.rccDesign.allPassed && activeSnap.foundationDesign.allPassed) {
      return { label: 'DESIGN CHECKS PASSED (REVIEW REQ.)', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40' };
    }
    return { label: `DESIGN DEFECTS DETECTED (${activeSnap.criticalDefectCount})`, cls: 'bg-rose-500/20 text-rose-300 border-rose-400/40' };
  }, [activeSnap, optResult, feaError]);

  async function handleRunOptimizer() {
    setOptBusy(true);
    setExportStatus(`Running ${optMode} optimization with full-frame Awatif WASM global reanalysis…`);
    try {
      const { evaluationId, optimization: res } = await requestStructural<{
        evaluationId: string;
        optimization: StructuralOptimizationSummary;
      }>('optimize', { ...analysisRequest, mode: optMode, maxIterations: 6 });
      setOptimization({ request: analysisRequest, evaluationId, result: res });
      setExportStatus(
        `Optimization ${res.status}: ${res.iterations.length} global reanalysis iteration(s), ${res.deltaSummary.defectsResolved} defect(s) resolved.`,
      );
    } catch (err) {
      setExportStatus(err instanceof Error ? err.message : 'Optimization failed');
    } finally {
      setOptBusy(false);
    }
  }

  async function handleDownloadBackendDrawing(format: 'dxf' | 'ifc' | 'pdf') {
    if (!evaluationId) return;
    setExportBusy(true);
    setExportStatus(`Generating Structural ${format.toUpperCase()} package…`);
    try {
      const res = await fetch('/api/v1/structural/drawings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evaluationId, format }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message ?? `Structural ${format.toUpperCase()} generation failed`);
      }
      const blob = await res.blob();
      const safeName = (building.name || building.id || 'structural').replace(/[^a-zA-Z0-9_-]/g, '_');
      const ext = format === 'pdf' ? 'structural_bbs.pdf' : `structural.${format}`;
      triggerDownload(blob, `${safeName}_${ext}`);
      setExportStatus(`Downloaded ${safeName}_${ext}`);
    } catch (err) {
      setExportStatus(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setExportBusy(false);
    }
  }

  async function handleDownloadE2k() {
    setExportBusy(true);
    setExportStatus('Generating optional CSI ETABS (.e2k) interoperability file…');
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
      const text = await response.text();
      const safeName = (building.name || building.id || 'etabs_model').replace(/[^a-zA-Z0-9_-]/g, '_');
      triggerDownload(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${safeName}.e2k`);
      setExportStatus(`Downloaded optional ${safeName}.e2k (${Math.round(text.length / 1024)} KB)`);
    } catch (err) {
      setExportStatus(err instanceof Error ? err.message : 'ETABS .e2k export failed');
    } finally {
      setExportBusy(false);
    }
  }

  async function handleAskAssistant() {
    if (!assistantQuery.trim() || !evaluationId) return;
    setAssistantBusy(true);
    try {
      const data = await requestStructural<{
        answer: string;
        interpretation?: string;
        aiTelemetry: { source: string };
      }>('assistant', { evaluationId, query: assistantQuery, useAi });
      setAssistantReply({
        evaluationId,
        text: data.answer + (data.interpretation ? '\n\nGemini interpretation\n' + data.interpretation : ''),
        source: data.aiTelemetry.source,
      });
    } catch (err) {
      setAssistantReply({
        evaluationId,
        text: err instanceof Error ? err.message : 'Failed to query structural assistant',
        source: 'REQUEST_FAILED',
      });
    } finally {
      setAssistantBusy(false);
    }
  }

  const baseShearDisplayKn = activeSnap?.loadTakeoff.seismicSummary?.designBaseShearVbXKn;
  const totalGravitySlsKn = activeSnap
    ? activeSnap.loadTakeoff.totalDeadPlusSdlKn + activeSnap.loadTakeoff.totalOccupancyLiveKn + activeSnap.loadTakeoff.totalRoofLiveKn
    : undefined;

  // Isometric projection helper for 3D FEA Diagram Canvas (X_east, Y_north, Z_up -> 2D screen SVG)
  const renderIsometricDiagram = () => {
    if (!activeSnap || !activeComboResult) {
      return <div className="p-8 text-center text-xs text-slate-400 font-mono">Solving 3D frame in Awatif WASM…</div>;
    }
    const { system } = activeSnap;
    const isoProject = (xM: number, yM: number, zM: number): [number, number] => {
      const sx = (xM - yM * 0.65) * 42;
      const sy = -(zM * 46 + (xM + yM * 0.65) * 16);
      return [sx, sy];
    };

    const projectedNodes = system.nodes.map((n) => isoProject(...n.positionM));
    const pxs = projectedNodes.map((p) => p[0]);
    const pys = projectedNodes.map((p) => p[1]);
    const minX = Math.min(...pxs) - 70;
    const maxX = Math.max(...pxs) + 70;
    const minY = Math.min(...pys) - 70;
    const maxY = Math.max(...pys) + 70;

    // Max diagram value for normalization
    let maxDiagVal = 1;
    for (const mf of activeComboResult.memberForces) {
      const v =
        diagramKind === 'BMD'
          ? mf.extrema.maxAbsMyKnM
          : diagramKind === 'SFD'
            ? Math.max(mf.extrema.maxAbsVzKn, mf.extrema.maxAbsVyKn)
            : diagramKind === 'AFD'
              ? Math.max(mf.extrema.maxCompressionKn, mf.extrema.maxTensionKn)
              : diagramKind === 'TORSION'
                ? mf.extrema.maxAbsMxKnM
                : mf.extrema.maxLocalDeflectionM * 1000;
      if (v > maxDiagVal) maxDiagVal = v;
    }

    const utilByElement = new Map<number, { util: number; failed: boolean }>();
    for (const b of activeSnap.rccDesign.beams) {
      utilByElement.set(b.elementIndex, { util: b.maxUtilization, failed: b.status === 'FAILED' });
    }
    for (const c of activeSnap.rccDesign.columns) {
      utilByElement.set(c.elementIndex, { util: c.maxUtilization, failed: c.status === 'FAILED' });
    }

    return (
      <svg
        data-testid="struct-fea-diagram-canvas"
        viewBox={`${minX} ${minY} ${Math.max(200, maxX - minX)} ${Math.max(180, maxY - minY)}`}
        className="w-full h-[380px] rounded-xl bg-[#070B14] border border-slate-800 select-none"
      >
        {/* Base Support Reactions & Triangles */}
        {activeComboResult.reactions.map((rx) => {
          const [sx, sy] = projectedNodes[rx.nodeIndex]!;
          return (
            <g key={`sup-${rx.nodeIndex}`}>
              <polygon
                points={`${sx},${sy} ${sx - 6},${sy + 10} ${sx + 6},${sy + 10}`}
                fill="#10B981"
                opacity={0.85}
              />
              <text x={sx + 8} y={sy + 12} fill="#6EE7B7" fontSize="8" fontFamily="monospace">
                Rz={rx.reactionKnM[2].toFixed(0)}kN
              </text>
            </g>
          );
        })}

        {/* Frame Elements + Diagram Ribbons */}
        {system.elements.map((el) => {
          const n0 = system.nodes[el.startNodeIndex]!;
          const n1 = system.nodes[el.endNodeIndex]!;
          const [x0, y0] = projectedNodes[el.startNodeIndex]!;
          const [x1, y1] = projectedNodes[el.endNodeIndex]!;
          const mf = activeComboResult.memberForces[el.index]!;
          const uInfo = utilByElement.get(el.index);

          const strokeColor =
            diagramKind === 'UTILIZATION'
              ? !uInfo
                ? '#64748B'
                : uInfo.failed || uInfo.util > 1.0
                  ? '#EF4444'
                  : uInfo.util > 0.78
                    ? '#F59E0B'
                    : '#10B981'
              : selectedElementIdx === el.index
                ? '#FBBF24'
                : '#64748B';

          // Build station diagram polygon perpendicular in screen space
          const dx = x1 - x0;
          const dy = y1 - y0;
          const segLen = Math.hypot(dx, dy) || 1;
          const nx = -dy / segLen;
          const ny = dx / segLen;

          const diagramPts = mf.stations.map((st) => {
            const bx = x0 + dx * st.s;
            const by = y0 + dy * st.s;
            const rawVal =
              diagramKind === 'BMD'
                ? st.momentMyKnM
                : diagramKind === 'SFD'
                  ? st.shearVzKn
                  : diagramKind === 'AFD'
                    ? st.axialAwatifKn
                    : diagramKind === 'TORSION'
                      ? st.torsionMxKnM
                      : diagramKind === 'DEFLECTION'
                        ? st.localDeflectionM[1] * 1000
                        : 0;
            const offsetPx = diagramKind === 'UTILIZATION' ? 0 : (rawVal / maxDiagVal) * 26;
            return `${(bx + nx * offsetPx).toFixed(1)},${(by + ny * offsetPx).toFixed(1)}`;
          });

          // Deformed nodal curve overlay when DEFLECTION selected
          const d0 = activeComboResult.displacements[el.startNodeIndex]!;
          const d1 = activeComboResult.displacements[el.endNodeIndex]!;
          const [dx0, dy0] = isoProject(
            n0.positionM[0] + d0.translationM[0] * 60,
            n0.positionM[1] + d0.translationM[1] * 60,
            n0.positionM[2] + d0.translationM[2] * 60,
          );
          const [dx1, dy1] = isoProject(
            n1.positionM[0] + d1.translationM[0] * 60,
            n1.positionM[1] + d1.translationM[1] * 60,
            n1.positionM[2] + d1.translationM[2] * 60,
          );

          void n0;
          void n1;

          return (
            <g
              key={el.id}
              onClick={() => setSelectedElementIdx(el.index)}
              className="cursor-pointer"
            >
              {diagramKind !== 'UTILIZATION' && diagramKind !== 'DEFLECTION' && (
                <polygon
                  points={`${x0.toFixed(1)},${y0.toFixed(1)} ${diagramPts.join(' ')} ${x1.toFixed(1)},${y1.toFixed(1)}`}
                  fill={
                    diagramKind === 'BMD'
                      ? 'rgba(245, 158, 11, 0.28)'
                      : diagramKind === 'SFD'
                        ? 'rgba(56, 189, 248, 0.28)'
                        : 'rgba(167, 139, 250, 0.28)'
                  }
                  stroke={
                    diagramKind === 'BMD'
                      ? '#F59E0B'
                      : diagramKind === 'SFD'
                        ? '#38BDF8'
                        : '#A78BFA'
                  }
                  strokeWidth={1.1}
                />
              )}
              {diagramKind === 'DEFLECTION' && (
                <line
                  x1={dx0}
                  y1={dy0}
                  x2={dx1}
                  y2={dy1}
                  stroke="#38BDF8"
                  strokeWidth={2}
                  strokeDasharray="4 2"
                />
              )}
              <line
                x1={x0}
                y1={y0}
                x2={x1}
                y2={y1}
                stroke={strokeColor}
                strokeWidth={selectedElementIdx === el.index ? 3.2 : uInfo?.failed ? 2.8 : 1.8}
              />
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <div
      data-testid="structural-analysis-panel"
      className="flex flex-col gap-4 bg-[#0B101B] text-[#F8FAFC] p-4 sm:p-5 overflow-auto h-full"
    >
      {/* Header, Solver Provenance & Lifecycle Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/80 bg-[#111827] p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Cpu className="h-4 w-4 text-amber-400" />
            <h2 className="text-base font-bold tracking-tight text-[#F8FAFC]">
              Built-In IS 456:2000 &amp; IS 1893:2016 Structural Analysis
            </h2>
            <span
              data-testid="struct-solver-backend-badge"
              className="rounded-full bg-indigo-500/20 border border-indigo-400/40 px-2.5 py-0.5 text-[10px] font-mono font-semibold text-indigo-200"
            >
              SOLVER: {solverBackend}
            </span>
            <span
              data-testid="struct-lifecycle-badge"
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-mono font-semibold ${lifecycleBadge.cls}`}
            >
              {lifecycleBadge.label}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-300">
            {activeSnap
              ? `${activeSnap.system.nodes.length} 6-DOF nodes · ${activeSnap.system.elements.length} 3D frame elements · Equilibrium ${
                  caseSummary?.equilibrium.isEquilibrated ? 'VERIFIED' : caseSummary ? 'RESIDUAL EXCEEDS LIMIT' : 'PENDING'
                } · Arch Rev v${activeSnap.system.sourceArchitecturalRevision}`
              : `${building.floors.length} canonical storeys`}
          </p>
        </div>

        {/* Direct Deliverables: Structural DXF, OpenBIM IFC4, BBS PDF, Optional ETABS .e2k */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="struct-download-dxf"
            disabled={exportBusy || !evaluationId || feaBusy}
            onClick={() => void handleDownloadBackendDrawing('dxf')}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-400/60 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50 cursor-pointer"
          >
            <FileCode2 className="h-3.5 w-3.5" />
            Structural DXF
          </button>
          <button
            type="button"
            data-testid="struct-download-ifc"
            disabled={exportBusy || !evaluationId || feaBusy}
            onClick={() => void handleDownloadBackendDrawing('ifc')}
            className="flex items-center gap-1.5 rounded-lg border border-cyan-400/60 bg-cyan-500/15 px-2.5 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50 cursor-pointer"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Structural IFC4
          </button>
          <button
            type="button"
            data-testid="struct-download-bbs-pdf"
            disabled={exportBusy || !evaluationId || feaBusy}
            onClick={() => void handleDownloadBackendDrawing('pdf')}
            className="flex items-center gap-1.5 rounded-lg border border-sky-400/60 bg-sky-500/15 px-2.5 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/25 disabled:opacity-50 cursor-pointer"
          >
            <FileText className="h-3.5 w-3.5" />
            Drawings &amp; BBS (PDF)
          </button>
          <button
            type="button"
            data-testid="struct-download-e2k"
            disabled={exportBusy}
            onClick={() => void handleDownloadE2k()}
            className="flex items-center gap-1.5 rounded-lg border border-amber-400/60 bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 disabled:opacity-50 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Optional ETABS (.e2k)
          </button>
          {onDownloadReportPdf && (
            <button
              type="button"
              data-testid="struct-download-report-pdf"
              disabled={reportBusy}
              onClick={onDownloadReportPdf}
              className="hidden"
            >
              Legacy Report
            </button>
          )}
        </div>
      </div>

      {/* Reviewed Engineering & Geotechnical Inputs Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 rounded-xl border border-slate-700/80 bg-[#111827] p-3.5">
        <label className="flex flex-col gap-1 text-xs text-slate-300">
          <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400">Seismic Zone (IS 1893)</span>
          <select
            data-testid="struct-seismic-zone"
            value={seismicZone}
            onChange={(e) => setSeismicZone(e.target.value as SeismicZoneCode)}
            className="rounded-lg border border-slate-600 bg-[#0B101B] px-2.5 py-1.5 text-xs font-mono text-[#F8FAFC]"
          >
            <option value="II">Zone II (Z = 0.10)</option>
            <option value="III">Zone III (Z = 0.16 · Pune/Mumbai)</option>
            <option value="IV">Zone IV (Z = 0.24 · Delhi NCR)</option>
            <option value="V">Zone V (Z = 0.36 · High Seismic)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-300">
          <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400">Concrete Grade (IS 456)</span>
          <select
            data-testid="struct-concrete-grade"
            value={concreteGrade}
            onChange={(e) => setConcreteGrade(e.target.value as ConcreteGradeCode)}
            className="rounded-lg border border-slate-600 bg-[#0B101B] px-2.5 py-1.5 text-xs font-mono text-[#F8FAFC]"
          >
            <option value="M20">M20 (20 MPa)</option>
            <option value="M25">M25 (25 MPa)</option>
            <option value="M30">M30 (30 MPa)</option>
            <option value="M35">M35 (35 MPa)</option>
            <option value="M40">M40 (40 MPa)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-300">
          <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400">Rebar Steel Grade</span>
          <select
            data-testid="struct-steel-grade"
            value={steelGrade}
            onChange={(e) => setSteelGrade(e.target.value as SteelGradeCode)}
            className="rounded-lg border border-slate-600 bg-[#0B101B] px-2.5 py-1.5 text-xs font-mono text-[#F8FAFC]"
          >
            <option value="Fe415">Fe415</option>
            <option value="Fe500">Fe500 (HYSD)</option>
            <option value="Fe550">Fe550</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-300">
          <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400">Soil SBC (kN/m² · Geotech)</span>
          <input
            data-testid="struct-sbc-input"
            type="number"
            min={0}
            max={1000}
            step={10}
            placeholder="From site report"
            value={sbcRaw}
            onChange={(e) => setSbcRaw(e.target.value)}
            className="rounded-lg border border-slate-600 bg-[#0B101B] px-2.5 py-1.5 text-xs font-mono text-[#F8FAFC]"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-300">
          <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400">Foundation Depth (m)</span>
          <input
            data-testid="struct-foundation-depth-input"
            type="number"
            min={0.8}
            max={6.0}
            step={0.1}
            value={foundationDepthM}
            onChange={(e) => setFoundationDepthM(e.target.value)}
            className="rounded-lg border border-slate-600 bg-[#0B101B] px-2.5 py-1.5 text-xs font-mono text-[#F8FAFC]"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-300">
          <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400">Geotechnical report reference</span>
          <input data-testid="struct-geotech-reference" type="text" value={geotechReference}
            onChange={(e) => setGeotechReference(e.target.value)}
            className="rounded-lg border border-slate-600 bg-[#0B101B] px-2.5 py-1.5 text-xs font-mono text-[#F8FAFC]" />
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-300">
          <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400">Settlement limit (mm)</span>
          <input data-testid="struct-settlement-limit" type="number" min={0} step="any" value={settlementLimit}
            onChange={(e) => setSettlementLimit(e.target.value)}
            className="rounded-lg border border-slate-600 bg-[#0B101B] px-2.5 py-1.5 text-xs font-mono text-[#F8FAFC]" />
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-300">
          <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400">Soil unit weight (kN/m³)</span>
          <input data-testid="struct-soil-unit-weight" type="number" min={0} step="any" value={soilUnitWeight}
            onChange={(e) => setSoilUnitWeight(e.target.value)}
            className="rounded-lg border border-slate-600 bg-[#0B101B] px-2.5 py-1.5 text-xs font-mono text-[#F8FAFC]" />
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-300">
          <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400">Foundation System</span>
          <select
            data-testid="struct-foundation-pref"
            value={foundationPref}
            onChange={(e) => setFoundationPref(e.target.value as FoundationSystemPreference)}
            className="rounded-lg border border-slate-600 bg-[#0B101B] px-2.5 py-1.5 text-xs font-mono text-[#F8FAFC]"
          >
            <option value="AUTO">AUTO (Isolated/Combined/Raft)</option>
            <option value="ISOLATED">Isolated Pad Footings</option>
            <option value="COMBINED">Combined Footings</option>
            <option value="STRAP">Cantilever Strap Footings</option>
            <option value="STRIP">Continuous Strip Footings</option>
            <option value="RIGID_RAFT">Rigid Mat Raft (IS 2950)</option>
          </select>
        </label>
      </div>

      <p className="text-xs text-slate-300">
        Preliminary load assumptions include 1.2 kN/m² floor finish, 19 kN/m³ masonry, 1.5 kN/m² roof live load,
        and medium seismic site class. {windEnabled && 'Wind uses 39 m/s and terrain category 2.'}
      </p>
      <button type="button" className="self-start text-xs text-sky-300 underline disabled:opacity-50"
        disabled={feaBusy} onClick={() => { setAnalysis(null); setAnalysisRetry((current) => current + 1); }}>
        Rerun structural analysis
      </button>
      {(exportStatus || feaError) && (
        <div
          role="status"
          className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 font-mono"
        >
          {feaError ? `Solver Alert: ${feaError}` : exportStatus}
        </div>
      )}

      {/* Key Engineering KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-3.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Unfactored Service Gravity (SLS)</div>
          <div className="mt-1 text-xl font-bold font-mono text-[#F8FAFC]">
            {totalGravitySlsKn?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? '—'} <span className="text-xs font-normal text-slate-400">kN</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-300">
            Zero duplicate self-weight · Exact vertical reaction balance
          </div>
        </div>

        <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-3.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Seismic Base Shear Vb (Zone {seismicZone})
          </div>
          <div data-testid="struct-base-shear-value" className="mt-1 text-xl font-bold font-mono text-amber-300">
            {baseShearDisplayKn?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? '—'} <span className="text-xs font-normal text-slate-400">kN</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-300">
            Modal T1 = {activeSnap?.loadTakeoff.seismicSummary?.analyticalFundamentalPeriodSec.toFixed(3) ?? '—'}s · Wind {windEnabled ? 'ON' : 'OFF'}{' '}
            <button
              type="button"
              onClick={() => setWindEnabled((v) => !v)}
              className="underline text-sky-300 ml-1 cursor-pointer"
            >
              toggle
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-3.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Max Member Utilization</div>
          <div
            className={`mt-1 text-xl font-bold font-mono ${
              (activeSnap?.maxMemberUtilization ?? 0.7) <= 1.0 ? 'text-emerald-300' : 'text-rose-400'
            }`}
          >
            {activeSnap ? activeSnap.maxMemberUtilization.toFixed(3) : '…'}
          </div>
          <div className="mt-1 text-[11px] text-slate-300">
            {activeSnap
              ? `${activeSnap.rccDesign.columns.filter((c) => c.status === 'PASSED').length}/${activeSnap.rccDesign.columns.length} cols · ${activeSnap.rccDesign.beams.filter((b) => b.status === 'PASSED').length}/${activeSnap.rccDesign.beams.length} beams OK`
              : 'Awaiting analysis results'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-3.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Deduplicated BOQ &amp; BBS</div>
          <div className="mt-1 text-xl font-bold font-mono text-sky-300">
            {activeSnap ? `${activeSnap.detailingAndBoq.quantities.netConcreteVolumeM3} m³` : '…'}{' '}
            <span className="text-xs font-normal text-slate-400">
              · {activeSnap ? `${activeSnap.detailingAndBoq.quantities.totalSteelTonnes} MT` : ''}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-300">
            {activeSnap
              ? `${activeSnap.detailingAndBoq.bbsEntries.length} BBS bar marks · Joint ded. ${activeSnap.detailingAndBoq.quantities.jointAndSlabIntersectionDeductionM3} m³`
              : 'Computing cutting lengths'}
          </div>
        </div>
      </div>

      {/* Sub-Tab Navigation */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-700/80 pb-2">
        {(
          [
            ['COLUMNS', 'Columns (P-Mx-My)'],
            ['BEAMS_SLABS', 'Beams & Slabs'],
            ['FOOTINGS', 'Foundations'],
            ['SEISMIC', 'Modal & Drift'],
            ['DIAGRAMS', '3D Force Diagrams'],
            ['OPTIMIZER', 'Defects & AI Optimizer'],
            ['BBS_BOQ', 'BBS & Quantities'],
            ['AI_ASSISTANT', 'Engineering Assistant'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-testid={`struct-subtab-${id.toLowerCase()}`}
            onClick={() => setActiveSubTab(id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              activeSubTab === id
                ? 'bg-amber-500 text-[#0B101B]'
                : 'bg-[#111827] text-slate-300 hover:bg-slate-800 border border-slate-700/70'
            }`}
          >
            {label}
          </button>
        ))}
        {feaBusy && <span className="ml-2 text-xs font-mono text-amber-300">Awaiting evaluated results…</span>}
      </div>

      {/* 1. COLUMNS SCHEDULE */}
      {activeSubTab === 'COLUMNS' && (
        <div className="rounded-xl border border-slate-700/80 bg-[#111827] overflow-auto">
          <table data-testid="struct-column-schedule-table" className="w-full text-left text-xs font-mono">
            <thead className="bg-[#0F172A] text-slate-300 border-b border-slate-700">
              <tr>
                <th className="p-2.5">Member</th>
                <th className="p-2.5">Size (mm)</th>
                <th className="p-2.5">Pu (kN)</th>
                <th className="p-2.5">Mux / Muy (kN·m)</th>
                <th className="p-2.5">Main Rebar</th>
                <th className="p-2.5">IS 13920 Ties</th>
                <th className="p-2.5">Bresler Ratio</th>
                <th className="p-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {activeSnap
                ? activeSnap.rccDesign.columns.map((col) => (
                    <tr key={col.elementId} className="hover:bg-slate-800/50">
                      <td className="p-2.5 font-semibold text-amber-300">{col.elementId}</td>
                      <td className="p-2.5">
                        {col.widthMm}×{col.depthMm} ({col.concreteGrade})
                      </td>
                      <td className="p-2.5">{col.demandPuKn}</td>
                      <td className="p-2.5">
                        {col.designMuxWithEccentricityAndSlendernessKnM} / {col.designMuyWithEccentricityAndSlendernessKnM}
                      </td>
                      <td className="p-2.5">{col.longitudinalBars.label}</td>
                      <td className="p-2.5">{col.lateralTies.label}</td>
                      <td className="p-2.5">{col.biaxialInteractionRatio}</td>
                      <td className="p-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold ${
                            col.status === 'PASSED'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {col.status === 'PASSED' ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                          {col.status}
                        </span>
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>
      )}

      {/* 2. BEAMS & SLABS */}
      {activeSubTab === 'BEAMS_SLABS' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-700/80 bg-[#111827] overflow-auto">
            <table data-testid="struct-beam-checks-table" className="w-full text-left text-xs font-mono">
              <thead className="bg-[#0F172A] text-slate-300 border-b border-slate-700">
                <tr>
                  <th className="p-2.5">Beam ID</th>
                  <th className="p-2.5">Section (mm)</th>
                  <th className="p-2.5">Span (mm)</th>
                  <th className="p-2.5">Me Hog / Sag (kN·m)</th>
                  <th className="p-2.5">Ve (kN)</th>
                  <th className="p-2.5">Top / Bottom Steel</th>
                  <th className="p-2.5">Stirrups</th>
                  <th className="p-2.5">Util</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {activeSnap
                  ? activeSnap.rccDesign.beams.map((bm) => (
                      <tr key={bm.elementId} className="hover:bg-slate-800/50">
                        <td className="p-2.5 font-semibold text-sky-300">{bm.elementId}</td>
                        <td className="p-2.5">
                          {bm.widthMm}×{bm.depthMm}
                        </td>
                        <td className="p-2.5">{bm.clearSpanMm}</td>
                        <td className="p-2.5">
                          {bm.equivalentHoggingMeKnM} / {bm.equivalentSaggingMeKnM}
                        </td>
                        <td className="p-2.5">{bm.equivalentShearVeKn}</td>
                        <td className="p-2.5">
                          T: {bm.topBarsSupport.label} · B: {bm.bottomBarsMidspan.label}
                        </td>
                        <td className="p-2.5">{bm.stirrups.label}</td>
                        <td className={`p-2.5 font-bold ${bm.status === 'PASSED' ? 'text-emerald-300' : 'text-rose-400'}`}>
                          {bm.maxUtilization} ({bm.status})
                        </td>
                      </tr>
                    ))
                  : null}
              </tbody>
            </table>
          </div>

          {activeSnap && (
            <div className="rounded-xl border border-slate-700/80 bg-[#111827] overflow-auto">
              <div className="px-3 py-2 text-xs font-bold border-b border-slate-700 bg-[#0F172A] text-slate-200">
                IS 456 Annex D Two-Way / One-Way / Cantilever Slab Panels &amp; Staircase Waist Slabs
              </div>
              <table className="w-full text-left text-xs font-mono">
                <thead className="text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="p-2">Panel</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">lx × ly (mm)</th>
                    <th className="p-2">Thickness</th>
                    <th className="p-2">Short Span Rebar</th>
                    <th className="p-2">Long Span Rebar</th>
                    <th className="p-2">L/d Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {activeSnap.rccDesign.slabs.map((sl) => (
                    <tr key={sl.panelId}>
                      <td className="p-2 text-emerald-300">{sl.panelId} ({sl.roomName})</td>
                      <td className="p-2">{sl.panelType}</td>
                      <td className="p-2">{sl.lxMm}×{sl.lyMm}</td>
                      <td className="p-2">{sl.thicknessMm} mm</td>
                      <td className="p-2">T{sl.shortSpanBottomDiaMm}@{sl.shortSpanBottomSpacingMm} mm c/c</td>
                      <td className="p-2">T{sl.longSpanDiaMm}@{sl.longSpanSpacingMm} mm c/c</td>
                      <td className="p-2">{sl.spanOverDepthActual} &le; {sl.spanOverDepthAllowable} ({sl.status})</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 3. FOUNDATIONS (SAFE-LIKE GEOTECHNICAL SCHEDULE) */}
      {activeSubTab === 'FOOTINGS' && (
        <div className="rounded-xl border border-slate-700/80 bg-[#111827] overflow-auto">
          {activeSnap?.foundationDesign.status === 'MISSING_GEOTECHNICAL_INPUT' ? (
            <div
              data-testid="struct-missing-geotech-banner"
              className="p-6 flex items-start gap-3 text-amber-200 bg-amber-500/10"
            >
              <ShieldAlert className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
              <div className="text-xs leading-relaxed">
                <div className="font-bold text-sm">MISSING_GEOTECHNICAL_INPUT — Foundation Design Gated (IS 1904:1986)</div>
                RH Planner never invents soil Safe Bearing Capacity (SBC). Enter a reviewed site geotechnical SBC (&ge; 30 kN/m²) in the{' '}
                <strong>Soil SBC</strong> input above to design Isolated, Combined, Strap, Strip, or Rigid-Mat Raft foundations.
              </div>
            </div>
          ) : (
            <table data-testid="struct-footing-schedule-table" className="w-full text-left text-xs font-mono">
              <thead className="bg-[#0F172A] text-slate-300 border-b border-slate-700">
                <tr>
                  <th className="p-2.5">Footing ID</th>
                  <th className="p-2.5">Typology</th>
                  <th className="p-2.5">Plan L×W×D (mm)</th>
                  <th className="p-2.5">P_SLS / Pu (kN)</th>
                  <th className="p-2.5">q_max / SBC (kPa)</th>
                  <th className="p-2.5">Punching (MPa)</th>
                  <th className="p-2.5">Bottom / Top Reinforcement</th>
                  <th className="p-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {activeSnap
                  ? activeSnap.foundationDesign.footings.map((ft) => (
                      <tr key={ft.footingId} className="hover:bg-slate-800/50">
                        <td className="p-2.5 font-semibold text-emerald-300">{ft.footingId}</td>
                        <td className="p-2.5">{ft.typology}</td>
                        <td className="p-2.5">
                          {ft.lengthXMm}×{ft.widthYMm}×{ft.thicknessMm}
                        </td>
                        <td className="p-2.5">
                          {ft.serviceLoadPKn} / {ft.factoredLoadPuKn}
                        </td>
                        <td className="p-2.5">
                          {ft.maxSoilPressureKPa} / {ft.allowableBearingPressureKPa}
                        </td>
                        <td className="p-2.5">
                          {ft.punchingShearStressMPa} &le; {ft.punchingShearCapacityMPa}
                        </td>
                        <td className="p-2.5">
                          {ft.bottomMeshXLabel}
                          {ft.topMeshLabel ? ` · ${ft.topMeshLabel}` : ''}
                          {ft.strapBeamLabel ? ` · ${ft.strapBeamLabel}` : ''}
                        </td>
                        <td className={`p-2.5 font-bold ${ft.status === 'PASSED' ? 'text-emerald-300' : 'text-rose-400'}`}>
                          {ft.status} ({ft.maxUtilization})
                        </td>
                      </tr>
                    ))
                  : null}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 4. MODAL & STOREY DRIFT */}
      {activeSubTab === 'SEISMIC' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300 mb-3">
              Local Modal Eigenvalues (Rayleigh-Ritz Awatif Flexibility)
            </h3>
            <table className="w-full text-left text-xs font-mono">
              <thead className="text-slate-400 border-b border-slate-700">
                <tr>
                  <th className="py-1.5">Mode</th>
                  <th className="py-1.5">Period T (s)</th>
                  <th className="py-1.5">Freq (Hz)</th>
                  <th className="py-1.5">Mass X (%)</th>
                  <th className="py-1.5">Mass Y (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {(activeSnap?.loadTakeoff.seismicSummary?.modes ?? []).map((m) => (
                  <tr key={m.modeNumber}>
                    <td className="py-1.5 text-amber-200">Mode {m.modeNumber}</td>
                    <td className="py-1.5">{m.periodSec.toFixed(3)}</td>
                    <td className="py-1.5">{m.frequencyHz.toFixed(2)}</td>
                    <td className="py-1.5">{m.massParticipationXPct.toFixed(1)}%</td>
                    <td className="py-1.5">{m.massParticipationYPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-sky-300 mb-3">
              IS 1893:2016 Cl. 7.11.1 Inter-Storey Drift Verification (&le; 0.004 hs)
            </h3>
            <table className="w-full text-left text-xs font-mono">
              <thead className="text-slate-400 border-b border-slate-700">
                <tr>
                  <th className="py-1.5">Level</th>
                  <th className="py-1.5">Elev (m)</th>
                  <th className="py-1.5">Drift X/Y (mm)</th>
                  <th className="py-1.5">Limit (mm)</th>
                  <th className="py-1.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {(activeSnap?.storeyDriftChecks ?? []).map((d) => (
                  <tr key={d.floorId}>
                    <td className="py-1.5">{d.floorId}</td>
                    <td className="py-1.5">{d.elevationM}</td>
                    <td className="py-1.5">
                      {d.maxDriftXMm} / {d.maxDriftYMm}
                    </td>
                    <td className="py-1.5">{d.allowableDriftMm}</td>
                    <td className={`py-1.5 font-bold ${d.isCompliant ? 'text-emerald-300' : 'text-rose-400'}`}>
                      {d.isCompliant ? 'COMPLIANT' : 'EXCEEDS'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. 3D ISOMETRIC FEA FORCE DIAGRAMS & STATION INSPECTOR */}
      {activeSubTab === 'DIAGRAMS' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 flex flex-col gap-3 rounded-xl border border-slate-700/80 bg-[#111827] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1">
                {(['BMD', 'SFD', 'AFD', 'TORSION', 'DEFLECTION', 'UTILIZATION'] as const).map((dk) => (
                  <button
                    key={dk}
                    type="button"
                    data-testid={`struct-diagram-btn-${dk.toLowerCase()}`}
                    onClick={() => setDiagramKind(dk)}
                    className={`rounded px-2.5 py-1 text-[11px] font-mono font-semibold cursor-pointer ${
                      diagramKind === dk ? 'bg-amber-500 text-[#0B101B]' : 'bg-[#0B101B] text-slate-300 border border-slate-700'
                    }`}
                  >
                    {dk}
                  </button>
                ))}
              </div>
              {activeSnap && (
                <select
                  data-testid="struct-combo-selector"
                  value={selectedComboId}
                  onChange={(e) => setSelectedComboId(e.target.value)}
                  className="rounded border border-slate-600 bg-[#0B101B] px-2.5 py-1 text-xs font-mono text-[#F8FAFC]"
                >
                  {Object.entries(activeSnap.solveEnvelope.combinationResults).map(([cid, cres]) => (
                    <option key={cid} value={cid}>
                      {cres.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {renderIsometricDiagram()}
          </div>

          <div
            data-testid="struct-member-inspector"
            className="rounded-xl border border-slate-700/80 bg-[#111827] p-4 flex flex-col gap-2 text-xs font-mono overflow-auto max-h-[450px]"
          >
            <div className="font-bold text-amber-300 uppercase tracking-wider">
              Member 11-Station Force &amp; Clause Inspector
            </div>
            {activeSnap && activeComboResult && activeComboResult.memberForces[selectedElementIdx] ? (
              (() => {
                const mf = activeComboResult.memberForces[selectedElementIdx]!;
                const meta = activeSnap.system.memberMetadata[selectedElementIdx]!;
                return (
                  <>
                    <div className="text-slate-200 font-semibold">
                      {mf.elementId} ({meta.category} · {meta.widthMm}×{meta.depthMm} mm · L={mf.lengthM.toFixed(2)}m)
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 rounded bg-[#0B101B] p-2 text-[11px]">
                      <div>Max N: {mf.extrema.maxCompressionKn.toFixed(1)} kN</div>
                      <div>Max |Vz|: {mf.extrema.maxAbsVzKn.toFixed(1)} kN</div>
                      <div>Max +My: {mf.extrema.maxPositiveMyKnM.toFixed(2)} kN·m</div>
                      <div>Min -My: {mf.extrema.maxNegativeMyKnM.toFixed(2)} kN·m</div>
                      <div>Max |Mx|: {mf.extrema.maxAbsMxKnM.toFixed(2)} kN·m</div>
                      <div>Defl: {(mf.extrema.maxLocalDeflectionM * 1000).toFixed(2)} mm</div>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">Stations x/L (N, Vz, My):</div>
                    <div className="divide-y divide-slate-800 text-[10px]">
                      {mf.stations.slice(0, 11).map((st, idx) => (
                        <div key={idx} className="py-1 flex justify-between">
                          <span>x={st.xM.toFixed(2)}m</span>
                          <span>N={st.axialAwatifKn.toFixed(0)}</span>
                          <span>V={st.shearVzKn.toFixed(1)}</span>
                          <span>M={st.momentMyKnM.toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()
            ) : (
              <div className="text-slate-400">Click any 3D frame element to inspect internal forces.</div>
            )}
          </div>
        </div>
      )}

      {/* 6. DEFECTS & GLOBAL-REANALYSIS OPTIMIZER */}
      {activeSubTab === 'OPTIMIZER' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/80 bg-[#111827] p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Wrench className="h-4 w-4 text-amber-400" />
              <select
                data-testid="struct-optimizer-mode"
                value={optMode}
                onChange={(e) => setOptMode(e.target.value as OptimizationObjectiveMode)}
                className="rounded-lg border border-slate-600 bg-[#0B101B] px-3 py-1.5 text-xs font-mono text-[#F8FAFC]"
              >
                <option value="BALANCED">BALANCED (Safety + Economy)</option>
                <option value="MIN_CONCRETE">MIN_CONCRETE (Minimum Concrete m³)</option>
                <option value="MIN_STEEL">MIN_STEEL (Minimum Rebar Tonnage)</option>
                <option value="MIN_COST">MIN_COST (Minimum Indicative INR Cost)</option>
                <option value="MAX_CLEARANCE">MAX_CLEARANCE (Preserve Headroom)</option>
                <option value="SIMPLIFIED_CONSTRUCTION">SIMPLIFIED_CONSTRUCTION (Uniform Shuttering)</option>
              </select>
              <button
                type="button"
                data-testid="struct-run-optimizer-btn"
                disabled={optBusy || !evaluationId || feaBusy}
                onClick={() => void handleRunOptimizer()}
                className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-[#0B101B] hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {optBusy ? 'Reanalyzing Global Frame…' : 'Run Global Reanalysis Optimization'}
              </button>
            </div>
            {optResult && (
              <div data-testid="struct-optimizer-summary" className="text-xs font-mono text-emerald-300">
                Status: {optResult.status} · Arch Hash Protected: {String(optResult.architecturalGeometryProtected)} · ΔConc:{' '}
                {optResult.deltaSummary.concreteDeltaM3} m³ · ΔSteel: {optResult.deltaSummary.steelDeltaKg} kg
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
              Active Structural Defects ({activeSnap?.defects.length ?? 0})
            </h3>
            {activeSnap && activeSnap.defects.length === 0 ? (
              <div className="text-xs text-emerald-300 font-mono flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> The defect detector reported zero findings in the available checks.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {(activeSnap?.defects ?? []).map((d) => (
                  <div key={d.defectId} className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs font-mono">
                    <div className="font-bold text-rose-300">
                      [{d.severity}] {d.memberId} ({d.memberCategory} · {d.storey}) — Util {d.utilizationRatio} ({d.clause})
                    </div>
                    <div className="text-slate-200 mt-1">{d.explanation}</div>
                    <div className="text-amber-200 mt-1">Proposed Fix: {d.proposedCorrection}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 7. BAR BENDING SCHEDULE (BBS) & DEDUPLICATED QUANTITIES */}
      {activeSubTab === 'BBS_BOQ' && activeSnap && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs font-mono">
            <div className="rounded-lg border border-slate-700 bg-[#111827] p-3">
              <div className="text-slate-400 text-[10px]">NET CONCRETE</div>
              <div className="text-base font-bold text-sky-300 mt-0.5">{activeSnap.detailingAndBoq.quantities.netConcreteVolumeM3} m³</div>
            </div>
            <div className="rounded-lg border border-slate-700 bg-[#111827] p-3">
              <div className="text-slate-400 text-[10px]">JOINT DEDUCTION</div>
              <div className="text-base font-bold text-emerald-300 mt-0.5">-{activeSnap.detailingAndBoq.quantities.jointAndSlabIntersectionDeductionM3} m³</div>
            </div>
            <div className="rounded-lg border border-slate-700 bg-[#111827] p-3">
              <div className="text-slate-400 text-[10px]">TOTAL REBAR STEEL</div>
              <div className="text-base font-bold text-amber-300 mt-0.5">{activeSnap.detailingAndBoq.quantities.totalSteelWeightKg} kg</div>
            </div>
            <div className="rounded-lg border border-slate-700 bg-[#111827] p-3">
              <div className="text-slate-400 text-[10px]">SHUTTERING AREA</div>
              <div className="text-base font-bold text-slate-100 mt-0.5">{activeSnap.detailingAndBoq.quantities.formworkAreaM2} m²</div>
            </div>
            <div className="rounded-lg border border-slate-700 bg-[#111827] p-3">
              <div className="text-slate-400 text-[10px]">EXCAVATION</div>
              <div className="text-base font-bold text-slate-100 mt-0.5">{activeSnap.detailingAndBoq.quantities.excavationVolumeM3} m³</div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/80 bg-[#111827] overflow-auto max-h-[380px]">
            <table data-testid="struct-bbs-table" className="w-full text-left text-xs font-mono">
              <thead className="bg-[#0F172A] text-slate-300 border-b border-slate-700 sticky top-0">
                <tr>
                  <th className="p-2.5">Bar Mark</th>
                  <th className="p-2.5">Member</th>
                  <th className="p-2.5">Shape (IS 2502)</th>
                  <th className="p-2.5">Dia</th>
                  <th className="p-2.5">Qty</th>
                  <th className="p-2.5">Cut Length (mm)</th>
                  <th className="p-2.5">Total (m)</th>
                  <th className="p-2.5">Weight (kg)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {activeSnap.detailingAndBoq.bbsEntries.map((row) => (
                  <tr key={row.barMark}>
                    <td className="p-2 text-amber-300 font-semibold">{row.barMark}</td>
                    <td className="p-2">{row.memberId}</td>
                    <td className="p-2 text-[11px]">{row.shapeCode}</td>
                    <td className="p-2">T{row.barDiaMm}</td>
                    <td className="p-2">{row.totalBars}</td>
                    <td className="p-2">{row.cuttingLengthMm}</td>
                    <td className="p-2">{row.totalLengthM}</td>
                    <td className="p-2 font-semibold text-sky-300">{row.totalWeightKg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 8. UNIFIED AI STRUCTURAL ENGINEERING ASSISTANT */}
      {activeSubTab === 'AI_ASSISTANT' && (
        <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
            <Bot className="h-4 w-4" />
            Natural-Language Structural Engineering Assistant (Grounded in Awatif FEA &amp; IS Codes)
          </div>
          <div className="flex gap-2">
            <input
              data-testid="struct-assistant-input"
              type="text"
              value={assistantQuery}
              onChange={(e) => setAssistantQuery(e.target.value)}
              placeholder="Ask e.g. 'Why did any beam fail?', 'Summarize BBS steel quantities', 'Check foundation bearing'..."
              className="flex-1 rounded-lg border border-slate-600 bg-[#0B101B] px-3 py-2 text-xs font-mono text-[#F8FAFC]"
            />
            <button
              type="button"
              data-testid="struct-assistant-send"
              disabled={assistantBusy || !evaluationId || feaBusy}
              onClick={() => void handleAskAssistant()}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-[#0B101B] hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
            >
              <Send className="h-3.5 w-3.5" />
              {assistantBusy ? 'Analyzing…' : 'Ask Engineer AI'}
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={useAi} onChange={(event) => setUseAi(event.target.checked)} />
            Request optional Gemini interpretation
          </label>
          {assistantReply && assistantReply.evaluationId === evaluationId && (
            <div
              data-testid="struct-assistant-answer"
              className="rounded-lg border border-slate-700 bg-[#0B101B] p-3.5 text-xs whitespace-pre-wrap leading-relaxed text-slate-200 font-mono"
            >
              <div className="text-[10px] text-indigo-300 mb-1.5">Execution Source: {assistantReply.source}</div>
              {assistantReply.text}
            </div>
          )}
        </div>
      )}

      {/* Mandatory Professional Engineering Review Disclaimer */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[11px] text-amber-200/90 flex items-center gap-2">
        <Activity className="h-4 w-4 shrink-0 text-amber-400" />
        <span>{MANDATORY_STRUCTURAL_DISCLAIMER}</span>
      </div>
    </div>
  );
};

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
  Eye,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Layers,
  Send,
  ShieldAlert,
  Sparkles,
  Wrench,
} from 'lucide-react';

interface StructuralAnalysisPanelProps {
  readonly building: Building;
  readonly onDownloadReportPdf?: () => void;
  readonly reportBusy?: boolean;
  readonly initialSelectedCoordinate?: {
    readonly kind: 'COLUMN' | 'BEAM';
    readonly xMm: number;
    readonly yMm: number;
    readonly floorId: string;
    readonly label: string;
  } | null;
}

type ScheduleSubTab =
  | 'COLUMNS'
  | 'BEAMS_SLABS'
  | 'FOOTINGS'
  | 'STUDIO_VIEWS'
  | 'SEISMIC'
  | 'DIAGRAMS'
  | 'OPTIMIZER'
  | 'BBS_BOQ'
  | 'AI_ASSISTANT';

type StudioPlanViewKind = 'PHYSICAL_FRAMING' | 'ANALYTICAL_MESH' | 'FOUNDATION_PLAN';

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

/** Renders a to-scale SVG reinforcement cross-section for a physical RCC beam or column. */
const RebarCrossSectionSvg: React.FC<{
  readonly kind: 'BEAM' | 'COLUMN';
  readonly widthMm: number;
  readonly depthMm: number;
  readonly topOrLongBars: { readonly barCount: number; readonly barDiaMm: number; readonly label: string };
  readonly bottomBars?: { readonly barCount: number; readonly barDiaMm: number; readonly label: string };
  readonly stirrupLabel: string;
}> = ({ kind, widthMm, depthMm, topOrLongBars, bottomBars, stirrupLabel }) => {
  const pad = 28;
  const scale = Math.min(130 / Math.max(200, widthMm), 130 / Math.max(200, depthMm));
  const wPx = widthMm * scale;
  const dPx = depthMm * scale;
  const coverPx = Math.max(8, (kind === 'COLUMN' ? 40 : 25) * scale);
  const svgW = wPx + pad * 2;
  const svgH = dPx + pad * 2;

  const barCircles: { cx: number; cy: number; r: number; fill: string }[] = [];
  const x0 = pad + coverPx;
  const x1 = pad + wPx - coverPx;
  const y0 = pad + coverPx;
  const y1 = pad + dPx - coverPx;

  if (kind === 'BEAM') {
    const nTop = Math.max(2, Math.min(8, topOrLongBars.barCount));
    const rTop = Math.max(3, (topOrLongBars.barDiaMm * scale) / 2);
    for (let i = 0; i < nTop; i++) {
      const t = nTop === 1 ? 0.5 : i / (nTop - 1);
      barCircles.push({ cx: x0 + t * (x1 - x0), cy: y0 + rTop, r: rTop, fill: '#F59E0B' });
    }
    const bot = bottomBars ?? topOrLongBars;
    const nBot = Math.max(2, Math.min(8, bot.barCount));
    const rBot = Math.max(3, (bot.barDiaMm * scale) / 2);
    for (let i = 0; i < nBot; i++) {
      const t = nBot === 1 ? 0.5 : i / (nBot - 1);
      barCircles.push({ cx: x0 + t * (x1 - x0), cy: y1 - rBot, r: rBot, fill: '#38BDF8' });
    }
  } else {
    const nCol = Math.max(4, Math.min(16, topOrLongBars.barCount));
    const rCol = Math.max(3.2, (topOrLongBars.barDiaMm * scale) / 2);
    // Distribute symmetrically around perimeter (4 corners + intermediate bars)
    barCircles.push(
      { cx: x0 + rCol, cy: y0 + rCol, r: rCol, fill: '#F59E0B' },
      { cx: x1 - rCol, cy: y0 + rCol, r: rCol, fill: '#F59E0B' },
      { cx: x1 - rCol, cy: y1 - rCol, r: rCol, fill: '#F59E0B' },
      { cx: x0 + rCol, cy: y1 - rCol, r: rCol, fill: '#F59E0B' },
    );
    const rem = nCol - 4;
    const perFace = Math.floor(rem / 2);
    for (let i = 1; i <= perFace; i++) {
      const t = i / (perFace + 1);
      barCircles.push({ cx: x0 + rCol, cy: y0 + t * (y1 - y0), r: rCol, fill: '#FDE68A' });
      barCircles.push({ cx: x1 - rCol, cy: y0 + t * (y1 - y0), r: rCol, fill: '#FDE68A' });
    }
  }

  return (
    <div data-testid="struct-rebar-cross-section" className="rounded-lg border border-slate-700/80 bg-[#070B14] p-2.5 flex items-center gap-3">
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} className="shrink-0">
        <rect x={pad} y={pad} width={wPx} height={dPx} fill="#1E293B" stroke="#94A3B8" strokeWidth={1.6} />
        <rect
          x={x0}
          y={y0}
          width={Math.max(8, x1 - x0)}
          height={Math.max(8, y1 - y0)}
          rx={3}
          fill="none"
          stroke="#10B981"
          strokeWidth={1.5}
        />
        {barCircles.map((b, idx) => (
          <circle key={idx} cx={b.cx} cy={b.cy} r={b.r} fill={b.fill} stroke="#0B101B" strokeWidth={0.8} />
        ))}
        <text x={pad + wPx / 2} y={pad - 8} textAnchor="middle" fill="#CBD5E1" fontSize="9" fontFamily="monospace">
          b={widthMm}mm
        </text>
        <text x={pad + wPx + 5} y={pad + dPx / 2} fill="#CBD5E1" fontSize="9" fontFamily="monospace">
          D={depthMm}
        </text>
      </svg>
      <div className="text-[10px] font-mono space-y-1 text-slate-300">
        <div className="font-bold text-slate-100">{kind} Cross-Section</div>
        {kind === 'BEAM' ? (
          <>
            <div className="text-amber-300">Top: {topOrLongBars.label}</div>
            <div className="text-sky-300">Bot: {bottomBars?.label}</div>
          </>
        ) : (
          <div className="text-amber-300">Main: {topOrLongBars.label}</div>
        )}
        <div className="text-emerald-300">Links: {stirrupLabel}</div>
      </div>
    </div>
  );
};

export const StructuralAnalysisPanel: React.FC<StructuralAnalysisPanelProps> = ({
  building,
  onDownloadReportPdf,
  reportBusy = false,
  initialSelectedCoordinate = null,
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

  // Gate 9 Studio View State
  const [studioViewKind, setStudioViewKind] = useState<StudioPlanViewKind>('PHYSICAL_FRAMING');
  const [studioFloorId, setStudioFloorId] = useState<string>(() => {
    const resFloor = building.floors.find((f) => f.floorUse === 'RESIDENTIAL');
    return resFloor?.id || building.floors[0]?.id || '';
  });
  const [selectedPhysicalMemberId, setSelectedPhysicalMemberId] = useState<string | null>(null);

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

  // Global & Single-Member Optimizer State
  const [optMode, setOptMode] = useState<OptimizationObjectiveMode>('BALANCED');
  const [optBusy, setOptBusy] = useState<boolean>(false);
  const [optimization, setOptimization] = useState<{
    request: AnalysisRequest;
    evaluationId: string;
    result: StructuralOptimizationSummary;
  } | null>(null);
  const [memberOptPreview, setMemberOptPreview] = useState<{
    request: AnalysisRequest;
    targetPhysicalMemberId: string;
    result: StructuralOptimizationSummary;
  } | null>(null);
  const [memberOptBusy, setMemberOptBusy] = useState<boolean>(false);

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
  const hasGeotechnicalInputs =
    [parsedSbc, depth, unitWeight, settlement].every((value) => Number.isFinite(value) && value > 0) &&
    geotechReference.trim().length > 0;

  const [appliedSbc, appliedDepth, appliedUnitWeight, appliedSettlement, appliedReport] = hasGeotechnicalInputs
    ? ([parsedSbc, depth, unitWeight, settlement, geotechReference.trim()] as const)
    : ([0, 0, 0, 0, ''] as const);

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
    [
      concreteGrade,
      steelGrade,
      seismicZone,
      windEnabled,
      hasGeotechnicalInputs,
      appliedSbc,
      appliedDepth,
      appliedUnitWeight,
      appliedSettlement,
      appliedReport,
    ],
  );

  const analysisRequest = useMemo<AnalysisRequest>(
    () => ({ building, reviewedInputs, foundationPreference: foundationPref }),
    [building, reviewedInputs, foundationPref],
  );

  // Strict stale-result invalidation whenever geometry or reviewed inputs change
  useEffect(() => {
    const abort = new AbortController();
    setFeaBusy(true);
    setFeaError('');
    setOptimization(null);
    setMemberOptPreview(null);
    const delay = window.setTimeout(() => {
      requestStructural<{ evaluationId: string; snapshot: StructuralEvaluationSummary }>(
        'analyze',
        analysisRequest,
        abort.signal,
      )
        .then((result) => {
          if (abort.signal.aborted) return;
          setAnalysis({ request: analysisRequest, ...result });
          const combinationIds = Object.keys(result.snapshot.solveEnvelope.combinationResults);
          if (combinationIds.length) {
            setSelectedComboId((current) => (combinationIds.includes(current) ? current : combinationIds[0]!));
          }
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted) setFeaError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
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
  const activePreview = memberOptPreview?.request === analysisRequest ? memberOptPreview : null;
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
  const fallbackReason = caseSummary?.diagnostics.backendFallbackReason;

  // Map CAD coordinate hint or auto-select highest-utilization physical member
  useEffect(() => {
    if (!activeSnap) return;
    if (initialSelectedCoordinate) {
      const { kind, xMm, yMm, floorId } = initialSelectedCoordinate;
      if (kind === 'COLUMN') {
        let bestId: string | null = null;
        let bestDist = Infinity;
        for (const pc of activeSnap.system.physicalModel.columns) {
          if (floorId && pc.floorId !== floorId) continue;
          const d = Math.hypot(pc.centerXMm - xMm, pc.centerYMm - yMm);
          if (d < bestDist) {
            bestDist = d;
            bestId = pc.physicalMemberId;
          }
        }
        if (bestId) {
          setSelectedPhysicalMemberId(bestId);
          setActiveSubTab('STUDIO_VIEWS');
          if (floorId) setStudioFloorId(floorId);
          return;
        }
      } else {
        let bestId: string | null = null;
        let bestDist = Infinity;
        for (const pb of activeSnap.system.physicalModel.beams) {
          if (floorId && pb.floorId !== floorId) continue;
          const mx = (pb.startPointMm.x + pb.endPointMm.x) / 2;
          const my = (pb.startPointMm.y + pb.endPointMm.y) / 2;
          const d = Math.hypot(mx - xMm, my - yMm);
          if (d < bestDist) {
            bestDist = d;
            bestId = pb.physicalMemberId;
          }
        }
        if (bestId) {
          setSelectedPhysicalMemberId(bestId);
          setActiveSubTab('STUDIO_VIEWS');
          if (floorId) setStudioFloorId(floorId);
          return;
        }
      }
    }
    setSelectedPhysicalMemberId((prev) => {
      if (
        prev &&
        (activeSnap.rccDesign.beams.some((b) => b.physicalMemberId === prev) ||
          activeSnap.rccDesign.columns.some((c) => c.physicalMemberId === prev))
      ) {
        return prev;
      }
      const worstBeam = [...activeSnap.rccDesign.beams].sort((a, b) => b.maxUtilization - a.maxUtilization)[0];
      const worstCol = [...activeSnap.rccDesign.columns].sort((a, b) => b.maxUtilization - a.maxUtilization)[0];
      if (!worstBeam && !worstCol) return null;
      return (worstBeam?.maxUtilization ?? 0) >= (worstCol?.maxUtilization ?? 0)
        ? worstBeam!.physicalMemberId
        : worstCol!.physicalMemberId;
    });
  }, [activeSnap, initialSelectedCoordinate]);

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

  // Distinct Gate 9 Lifecycle Statuses: ANALYZED | DESIGN_FAILED | UNSUPPORTED_REQUIRED_CHECK | DESIGN_CHECKS_PASSED
  const lifecycleBadge = useMemo(() => {
    if (!activeSnap) {
      return {
        statusCode: feaError ? 'ANALYSIS_UNAVAILABLE' : 'PENDING',
        label: feaError ? 'ANALYSIS UNAVAILABLE' : 'ANALYSIS PENDING',
        cls: 'bg-sky-500/20 text-sky-300 border-sky-400/40',
      };
    }
    if (
      activeSnap.designLifecycleStatus === 'UNSUPPORTED_REQUIRED_CHECK' ||
      activeSnap.foundationDesign.status === 'UNSUPPORTED_FOUNDATION_TYPE'
    ) {
      return {
        statusCode: 'UNSUPPORTED_REQUIRED_CHECK',
        label: 'UNSUPPORTED_REQUIRED_CHECK',
        cls: 'bg-violet-500/20 text-violet-200 border-violet-400/50',
      };
    }
    if (activeSnap.foundationDesign.status === 'MISSING_GEOTECHNICAL_INPUT') {
      const superFailed = activeSnap.criticalDefectCount > 0 || !activeSnap.rccDesign.allPassed;
      return {
        statusCode: superFailed ? 'DESIGN_FAILED' : 'ANALYZED',
        label: superFailed
          ? `DESIGN_FAILED (${activeSnap.criticalDefectCount}) · GEOTECHNICAL REQ.`
          : 'ANALYZED · INPUT_REVIEW_REQUIRED (GEOTECHNICAL)',
        cls: superFailed
          ? 'bg-rose-500/20 text-rose-300 border-rose-400/40'
          : 'bg-amber-500/20 text-amber-300 border-amber-400/40',
      };
    }
    if (activeSnap.designLifecycleStatus === 'DESIGN_CHECKS_PASSED') {
      return {
        statusCode: 'DESIGN_CHECKS_PASSED',
        label: 'DESIGN_CHECKS_PASSED (REVIEW REQ.)',
        cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40',
      };
    }
    return {
      statusCode: 'DESIGN_FAILED',
      label: `DESIGN_FAILED (${activeSnap.criticalDefectCount} FINDINGS)`,
      cls: 'bg-rose-500/20 text-rose-300 border-rose-400/40',
    };
  }, [activeSnap, feaError]);

  const selectedMemberDetail = useMemo(() => {
    if (!activeSnap || !selectedPhysicalMemberId) return null;
    const beam = activeSnap.rccDesign.beams.find((b) => b.physicalMemberId === selectedPhysicalMemberId);
    if (beam) {
      const defect = activeSnap.defects.find((d) => d.physicalMemberId === selectedPhysicalMemberId);
      return { kind: 'BEAM' as const, beam, defect };
    }
    const column = activeSnap.rccDesign.columns.find((c) => c.physicalMemberId === selectedPhysicalMemberId);
    if (column) {
      const defect = activeSnap.defects.find((d) => d.physicalMemberId === selectedPhysicalMemberId);
      return { kind: 'COLUMN' as const, column, defect };
    }
    return null;
  }, [activeSnap, selectedPhysicalMemberId]);

  const selectByAnalyticalElementIndex = (elIdx: number) => {
    setSelectedElementIdx(elIdx);
    if (!activeSnap) return;
    const el = activeSnap.system.elements[elIdx];
    const physId =
      el?.parentMemberId ??
      (el ? activeSnap.system.physicalModel.mapping.analyticalToPhysicalMemberId[el.id] : undefined);
    if (physId) {
      setSelectedPhysicalMemberId(physId);
      setMemberOptPreview(null);
    }
  };

  async function handleRunOptimizer() {
    setOptBusy(true);
    setMemberOptPreview(null);
    setExportStatus(`Running ${optMode} optimization with full-frame Awatif WASM global reanalysis…`);
    try {
      const { evaluationId: nextEvalId, optimization: res } = await requestStructural<{
        evaluationId: string;
        optimization: StructuralOptimizationSummary;
      }>('optimize', {
        ...analysisRequest,
        mode: optMode,
        maxIterations: 6,
        initialSectionOverrides: optResult?.sectionOverridesApplied,
        initialRebarOverrides: optResult?.rebarOverridesApplied,
        initialSlabOverridesMm: optResult?.slabOverridesApplied,
        initialFootingOverrides: optResult?.footingOverridesApplied,
      });
      setOptimization({ request: analysisRequest, evaluationId: nextEvalId, result: res });
      setExportStatus(
        `Optimization ${res.status}: ${res.iterations.length} global reanalysis iteration(s), ${res.deltaSummary.defectsResolved} defect(s) resolved.`,
      );
    } catch (err) {
      setExportStatus(err instanceof Error ? err.message : 'Optimization failed');
    } finally {
      setOptBusy(false);
    }
  }

  async function handleSingleMemberOptimization(previewOnly: boolean) {
    if (!selectedPhysicalMemberId) return;
    setMemberOptBusy(true);
    setExportStatus(
      previewOnly
        ? `Previewing localized optimization + global reanalysis for ${selectedPhysicalMemberId}…`
        : `Applying localized optimization + full-frame global reanalysis for ${selectedPhysicalMemberId}…`,
    );
    try {
      const data = await requestStructural<{
        evaluationId?: string;
        previewOnly: boolean;
        optimization: StructuralOptimizationSummary;
      }>('optimize', {
        ...analysisRequest,
        mode: optMode,
        targetPhysicalMemberIds: [selectedPhysicalMemberId],
        previewOnly,
        maxIterations: 3,
        initialSectionOverrides: optResult?.sectionOverridesApplied,
        initialRebarOverrides: optResult?.rebarOverridesApplied,
        initialSlabOverridesMm: optResult?.slabOverridesApplied,
        initialFootingOverrides: optResult?.footingOverridesApplied,
      });
      if (previewOnly) {
        setMemberOptPreview({
          request: analysisRequest,
          targetPhysicalMemberId: selectedPhysicalMemberId,
          result: data.optimization,
        });
        setExportStatus(
          `Preview ready for ${selectedPhysicalMemberId}: global max utilization ${data.optimization.before.maxMemberUtilization} → ${data.optimization.after.maxMemberUtilization}. Review and click Accept to commit.`,
        );
      } else if (data.evaluationId) {
        setOptimization({
          request: analysisRequest,
          evaluationId: data.evaluationId,
          result: data.optimization,
        });
        setMemberOptPreview(null);
        setExportStatus(
          `Accepted & globally reanalyzed ${selectedPhysicalMemberId} (${data.optimization.iterations.length} full-frame WASM reanalysis pass(es)).`,
        );
      }
    } catch (err) {
      setExportStatus(err instanceof Error ? err.message : 'Member optimization failed');
    } finally {
      setMemberOptBusy(false);
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
    ? activeSnap.loadTakeoff.totalDeadPlusSdlKn +
      activeSnap.loadTakeoff.totalOccupancyLiveKn +
      activeSnap.loadTakeoff.totalRoofLiveKn
    : undefined;

  // Gate 9: Interactive Selected Physical Member Failure & Optimization Inspector Card
  const renderSelectedMemberInspector = () => {
    if (!activeSnap || !selectedMemberDetail) {
      return (
        <div
          data-testid="struct-selected-member-panel"
          className="rounded-xl border border-slate-700/80 bg-[#111827] p-4 text-xs font-mono text-slate-400"
        >
          Click any physical beam or column in the CAD Plan, 3D Diagram, or Schedules to inspect governing clauses, rebar cage, and localized optimization.
        </div>
      );
    }

    const isBeam = selectedMemberDetail.kind === 'BEAM';
    const bm = isBeam ? selectedMemberDetail.beam : undefined;
    const col = !isBeam ? selectedMemberDetail.column : undefined;
    const physId = isBeam ? bm!.physicalMemberId : col!.physicalMemberId;
    const status = isBeam ? bm!.status : col!.status;
    const util = isBeam ? bm!.maxUtilization : col!.maxUtilization;
    const childIds = isBeam ? bm!.analyticalElementIds : col!.analyticalElementIds;
    const groupMark = isBeam ? bm!.scheduleGroupMark : col!.scheduleGroupMark;

    const previewForThis =
      activePreview && activePreview.targetPhysicalMemberId === physId ? activePreview.result : null;
    const previewChange = previewForThis?.iterations[0]?.modifiedMembersDetail.find(
      (m) => m.physicalMemberId === physId,
    );

    return (
      <div
        data-testid="struct-selected-member-panel"
        className="rounded-xl border border-slate-700/80 bg-[#111827] p-4 flex flex-col gap-3 text-xs font-mono"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-bold">
              Physical Member Inspector · [{groupMark}]
            </div>
            <div className="text-sm font-bold text-slate-100 mt-0.5">{physId}</div>
          </div>
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-bold ${
              status === 'PASSED'
                ? 'bg-emerald-500/20 text-emerald-300'
                : status === 'UNSUPPORTED'
                  ? 'bg-violet-500/20 text-violet-200'
                  : 'bg-rose-500/20 text-rose-300'
            }`}
          >
            {status} · Util {util.toFixed(3)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-[#0B101B] p-2.5 text-[11px] text-slate-300">
          <div>
            <span className="text-slate-500">Section:</span>{' '}
            {isBeam ? `${bm!.widthMm}×${bm!.depthMm} (${bm!.concreteGrade})` : `${col!.widthMm}×${col!.depthMm} (${col!.concreteGrade})`}
          </div>
          <div>
            <span className="text-slate-500">Span/Ht:</span>{' '}
            {isBeam ? `${bm!.clearSpanMm} mm` : `${col!.clearHeightMm} mm`}
          </div>
          <div>
            <span className="text-slate-500">Gov Combo:</span>{' '}
            <span className="text-amber-200">{isBeam ? bm!.governingComboId : col!.governingComboId}</span>
          </div>
          <div>
            <span className="text-slate-500">Analytical FE:</span>{' '}
            <span className="text-sky-300">{childIds.length} ({childIds.join(', ')})</span>
          </div>
          {isBeam ? (
            <>
              <div>Me: {bm!.equivalentHoggingMeKnM} / {bm!.equivalentSaggingMeKnM} kN·m</div>
              <div>Mu,lim: {bm!.muLimKnM} kN·m</div>
              <div>Ve: {bm!.equivalentShearVeKn} kN ({bm!.nominalShearStressMPa} MPa)</div>
              <div>Defl: {bm!.slsDeflectionMm} / {bm!.slsAllowableDeflectionMm} mm</div>
            </>
          ) : (
            <>
              <div>Pu: {col!.demandPuKn} kN (Puz {col!.capacityPuzKn} kN)</div>
              <div>Bresler: {col!.biaxialInteractionRatio} (αn={col!.breslerAlphaN})</div>
              <div>Mux/Mux1: {col!.designMuxWithEccentricityAndSlendernessKnM}/{col!.capacityMux1AtPuKnM}</div>
              <div>Muy/Muy1: {col!.designMuyWithEccentricityAndSlendernessKnM}/{col!.capacityMuy1AtPuKnM}</div>
            </>
          )}
        </div>

        {selectedMemberDetail.defect && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-[11px] text-rose-200">
            <div className="font-bold text-rose-300">{selectedMemberDetail.defect.clause}</div>
            <div className="mt-0.5">{selectedMemberDetail.defect.explanation}</div>
          </div>
        )}

        {isBeam ? (
          <RebarCrossSectionSvg
            kind="BEAM"
            widthMm={bm!.widthMm}
            depthMm={bm!.depthMm}
            topOrLongBars={bm!.topBarsSupport}
            bottomBars={bm!.bottomBarsMidspan}
            stirrupLabel={bm!.stirrups.label}
          />
        ) : (
          <RebarCrossSectionSvg
            kind="COLUMN"
            widthMm={col!.widthMm}
            depthMm={col!.depthMm}
            topOrLongBars={col!.longitudinalBars}
            stirrupLabel={col!.lateralTies.label}
          />
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            data-testid="struct-preview-member-opt-btn"
            disabled={memberOptBusy || feaBusy || !evaluationId}
            onClick={() => void handleSingleMemberOptimization(true)}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-amber-400/60 bg-amber-500/20 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/30 disabled:opacity-50 cursor-pointer"
          >
            <Eye className="h-3.5 w-3.5" />
            {memberOptBusy ? 'Reanalyzing…' : 'Preview Member Optimization'}
          </button>
          {previewForThis && (
            <button
              type="button"
              data-testid="struct-accept-member-opt-btn"
              disabled={memberOptBusy || feaBusy}
              onClick={() => void handleSingleMemberOptimization(false)}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-[#0B101B] hover:bg-emerald-400 disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Accept &amp; Apply Full Reanalysis
            </button>
          )}
        </div>

        {previewForThis && (
          <div
            data-testid="struct-member-opt-preview-card"
            className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-2.5 text-[11px] space-y-1 text-emerald-100"
          >
            <div className="font-bold text-emerald-300">
              Full-Frame Reanalysis Preview ({previewForThis.status})
            </div>
            {previewChange ? (
              <div>
                Before: {previewChange.previousDimensionsAndRebar} →{' '}
                <span className="font-bold text-amber-200">{previewChange.proposedDimensionsAndRebar}</span>
              </div>
            ) : (
              <div>Member already meets target criteria under {optMode} objective.</div>
            )}
            <div>
              Global Max Util: {previewForThis.before.maxMemberUtilization} →{' '}
              <span className="font-bold">{previewForThis.after.maxMemberUtilization}</span> · Failed:{' '}
              {previewForThis.before.criticalDefectCount} → {previewForThis.after.criticalDefectCount}
            </div>
            <div>
              ΔConcrete: {previewForThis.deltaSummary.concreteDeltaM3} m³ · ΔSteel:{' '}
              {previewForThis.deltaSummary.steelDeltaKg} kg · Arch SHA Protected:{' '}
              {String(previewForThis.architecturalGeometryProtected)}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Gate 9: 2D SVG Physical Framing View | Analytical Mesh View | Foundation Footprint View
  const renderStudioPlanView = () => {
    if (!activeSnap) {
      return <div className="p-8 text-center text-xs font-mono text-slate-400">Evaluating physical &amp; analytical structural model…</div>;
    }
    const { system, rccDesign, foundationDesign } = activeSnap;
    const allXs = system.nodes.map((n) => n.positionM[0] * 1000);
    const allYs = system.nodes.map((n) => -n.positionM[1] * 1000);
    const minX = (allXs.length ? Math.min(...allXs) : 0) - 2400;
    const maxX = (allXs.length ? Math.max(...allXs) : 10000) + 2400;
    const minY = (allYs.length ? Math.min(...allYs) : 0) - 2400;
    const maxY = (allYs.length ? Math.max(...allYs) : 10000) + 2400;
    const vbW = Math.max(4000, maxX - minX);
    const vbH = Math.max(4000, maxY - minY);

    const floorId =
      system.storeys.some((s) => s.id === studioFloorId) || studioFloorId === 'PLINTH'
        ? studioFloorId
        : system.storeys[0]?.id ?? 'PLINTH';

    const beamByPhysId = new Map(rccDesign.beams.map((b) => [b.physicalMemberId, b]));
    const colByPhysId = new Map(rccDesign.columns.map((c) => [c.physicalMemberId, c]));

    return (
      <svg
        data-testid={`struct-studio-canvas-${studioViewKind.toLowerCase()}`}
        viewBox={`${minX} ${minY} ${vbW} ${vbH}`}
        className="w-full h-[420px] rounded-xl bg-[#070B14] border border-slate-800 select-none"
      >
        {studioViewKind === 'PHYSICAL_FRAMING' && (
          <g>
            {/* Subdivided Physical Slab Bays */}
            {system.physicalModel.slabs
              .filter((sl) => sl.floorId === floorId)
              .map((sl) => (
                <g key={sl.physicalMemberId}>
                  <rect
                    x={sl.boundsMm.minX}
                    y={sl.boundsMm.minY}
                    width={sl.boundsMm.maxX - sl.boundsMm.minX}
                    height={sl.boundsMm.maxY - sl.boundsMm.minY}
                    fill="rgba(30, 41, 59, 0.35)"
                    stroke="#334155"
                    strokeWidth={35}
                    strokeDasharray="180 120"
                  />
                </g>
              ))}

            {/* Continuous Physical Beams (click to inspect & optimize!) */}
            {system.physicalModel.beams
              .filter((pb) => pb.floorId === floorId)
              .map((pb) => {
                const des = beamByPhysId.get(pb.physicalMemberId);
                const isSel = selectedPhysicalMemberId === pb.physicalMemberId;
                const color = isSel
                  ? '#FBBF24'
                  : des?.status === 'UNSUPPORTED'
                    ? '#A78BFA'
                    : des?.status === 'FAILED'
                      ? '#EF4444'
                      : '#10B981';
                const mx = (pb.startPointMm.x + pb.endPointMm.x) / 2;
                const my = (pb.startPointMm.y + pb.endPointMm.y) / 2;
                return (
                  <g
                    key={pb.physicalMemberId}
                    data-testid={`phys-beam-${pb.physicalMemberId}`}
                    onClick={() => {
                      setSelectedPhysicalMemberId(pb.physicalMemberId);
                      setMemberOptPreview(null);
                    }}
                    className="cursor-pointer"
                  >
                    <line
                      x1={pb.startPointMm.x}
                      y1={pb.startPointMm.y}
                      x2={pb.endPointMm.x}
                      y2={pb.endPointMm.y}
                      stroke={color}
                      strokeWidth={isSel ? Math.max(360, pb.widthMm * 1.35) : Math.max(230, pb.widthMm)}
                      strokeLinecap="round"
                    >
                      <title>
                        {pb.physicalMemberId} [{des?.scheduleGroupMark}] · {pb.widthMm}×{pb.depthMm}mm · Util {des?.maxUtilization} ({des?.status})
                      </title>
                    </line>
                    <text
                      x={mx}
                      y={my - 180}
                      textAnchor="middle"
                      fill="#E2E8F0"
                      fontSize="210"
                      fontFamily="monospace"
                    >
                      {des?.scheduleGroupMark ?? pb.physicalMemberId}
                    </text>
                  </g>
                );
              })}

            {/* Physical Columns */}
            {system.physicalModel.columns
              .filter((pc) => pc.floorId === floorId)
              .map((pc) => {
                const des = colByPhysId.get(pc.physicalMemberId);
                const isSel = selectedPhysicalMemberId === pc.physicalMemberId;
                const fill = isSel
                  ? '#FBBF24'
                  : des?.status === 'FAILED'
                    ? '#EF4444'
                    : '#F8FAFC';
                return (
                  <g
                    key={pc.physicalMemberId}
                    data-testid={`phys-col-${pc.physicalMemberId}`}
                    onClick={() => {
                      setSelectedPhysicalMemberId(pc.physicalMemberId);
                      setMemberOptPreview(null);
                    }}
                    className="cursor-pointer"
                  >
                    <rect
                      x={pc.centerXMm - pc.widthMm / 2}
                      y={pc.centerYMm - pc.depthMm / 2}
                      width={pc.widthMm}
                      height={pc.depthMm}
                      fill={fill}
                      stroke="#0F172A"
                      strokeWidth={55}
                    >
                      <title>
                        {pc.physicalMemberId} [{des?.scheduleGroupMark}] · {pc.widthMm}×{pc.depthMm}mm · Util {des?.maxUtilization} ({des?.status})
                      </title>
                    </rect>
                    <text
                      x={pc.centerXMm + pc.widthMm / 2 + 90}
                      y={pc.centerYMm - pc.depthMm / 2 - 40}
                      fill="#FDE68A"
                      fontSize="220"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      {pc.stackId}
                    </text>
                  </g>
                );
              })}
          </g>
        )}

        {studioViewKind === 'ANALYTICAL_MESH' && (
          <g>
            {/* Child Analytical Finite Elements (showing subdivided girder segments __fe_1, __fe_2) */}
            {system.elements
              .filter((el) => el.floorId === floorId && el.category !== 'COLUMN')
              .map((el) => {
                const n0 = system.nodes[el.startNodeIndex]!;
                const n1 = system.nodes[el.endNodeIndex]!;
                const x0 = n0.positionM[0] * 1000;
                const y0 = -n0.positionM[1] * 1000;
                const x1 = n1.positionM[0] * 1000;
                const y1 = -n1.positionM[1] * 1000;
                const isSubdivided = el.id.includes('__fe_');
                return (
                  <g
                    key={el.id}
                    onClick={() => selectByAnalyticalElementIndex(el.index)}
                    className="cursor-pointer"
                  >
                    <line
                      x1={x0}
                      y1={y0}
                      x2={x1}
                      y2={y1}
                      stroke={isSubdivided ? '#38BDF8' : '#94A3B8'}
                      strokeWidth={140}
                      strokeDasharray={isSubdivided ? '260 110' : undefined}
                    >
                      <title>
                        Analytical Element {el.id} → Parent Physical {el.parentMemberId}
                      </title>
                    </line>
                  </g>
                );
              })}

            {/* Analytical 6-DOF Nodes (highlighting internal mesh subdivision nodes in cyan) */}
            {system.nodes
              .filter((nd) => nd.floorId === floorId)
              .map((nd) => {
                const cx = nd.positionM[0] * 1000;
                const cy = -nd.positionM[1] * 1000;
                const isSubNode = nd.id.includes('_M') || nd.id.includes('_SUB');
                return (
                  <circle
                    key={nd.id}
                    cx={cx}
                    cy={cy}
                    r={isSubNode ? 175 : 225}
                    fill={isSubNode ? '#22D3EE' : '#F59E0B'}
                    stroke="#0B101B"
                    strokeWidth={45}
                  >
                    <title>
                      Analytical Node {nd.id} ({nd.positionM.map((v) => v.toFixed(2)).join(', ')} m)
                    </title>
                  </circle>
                );
              })}
          </g>
        )}

        {studioViewKind === 'FOUNDATION_PLAN' && (
          <g>
            {foundationDesign.footings.map((ft) => {
              const pass = ft.status === 'PASSED';
              return (
                <g key={ft.footingId}>
                  <rect
                    x={ft.centerXMm - ft.lengthXMm / 2}
                    y={ft.centerYMm - ft.widthYMm / 2}
                    width={ft.lengthXMm}
                    height={ft.widthYMm}
                    fill={pass ? 'rgba(16, 185, 129, 0.18)' : 'rgba(239, 68, 68, 0.22)'}
                    stroke={pass ? '#10B981' : '#EF4444'}
                    strokeWidth={75}
                  >
                    <title>
                      {ft.footingId} [{ft.scheduleGroupMark}] · {ft.typology} {ft.lengthXMm}×{ft.widthYMm}×{ft.thicknessMm}mm · q_max={ft.maxSoilPressureKPa}/{ft.allowableBearingPressureKPa} kPa ({ft.status})
                    </title>
                  </rect>
                  <text
                    x={ft.centerXMm}
                    y={ft.centerYMm + 80}
                    textAnchor="middle"
                    fill="#E2E8F0"
                    fontSize="210"
                    fontFamily="monospace"
                  >
                    {ft.scheduleGroupMark} ({ft.maxSoilPressureKPa}kPa)
                  </text>
                </g>
              );
            })}
            {Object.values(system.baseColumnStackMap).map((stk) => (
              <rect
                key={stk.stackId}
                x={stk.xMm - stk.columnWidthMm / 2}
                y={stk.yMm - stk.columnDepthMm / 2}
                width={stk.columnWidthMm}
                height={stk.columnDepthMm}
                fill="#F8FAFC"
                stroke="#F59E0B"
                strokeWidth={45}
              />
            ))}
          </g>
        )}
      </svg>
    );
  };

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
                : mf.extrema.maxRelativeChordDeflectionM * 1000;
      if (v > maxDiagVal) maxDiagVal = v;
    }

    const utilByElement = new Map<number, { util: number; failed: boolean }>();
    for (const b of activeSnap.rccDesign.beams) {
      for (const idx of b.analyticalElementIndices) {
        utilByElement.set(idx, { util: b.maxUtilization, failed: b.status !== 'PASSED' });
      }
    }
    for (const c of activeSnap.rccDesign.columns) {
      for (const idx of c.analyticalElementIndices) {
        utilByElement.set(idx, { util: c.maxUtilization, failed: c.status !== 'PASSED' });
      }
    }

    return (
      <svg
        data-testid="struct-fea-diagram-canvas"
        viewBox={`${minX} ${minY} ${Math.max(200, maxX - minX)} ${Math.max(180, maxY - minY)}`}
        className="w-full h-[380px] rounded-xl bg-[#070B14] border border-slate-800 select-none"
      >
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

        {system.elements.map((el) => {
          const n0 = system.nodes[el.startNodeIndex]!;
          const n1 = system.nodes[el.endNodeIndex]!;
          const [x0, y0] = projectedNodes[el.startNodeIndex]!;
          const [x1, y1] = projectedNodes[el.endNodeIndex]!;
          const mf = activeComboResult.memberForces[el.index]!;
          const uInfo = utilByElement.get(el.index);
          const isPhysSelected = el.parentMemberId && el.parentMemberId === selectedPhysicalMemberId;

          const strokeColor =
            diagramKind === 'UTILIZATION'
              ? !uInfo
                ? '#64748B'
                : uInfo.failed || uInfo.util > 1.0
                  ? '#EF4444'
                  : uInfo.util > 0.78
                    ? '#F59E0B'
                    : '#10B981'
              : selectedElementIdx === el.index || isPhysSelected
                ? '#FBBF24'
                : '#64748B';

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
                        ? (st.relativeChordDeflectionM?.[1] ?? st.localDeflectionM[1]) * 1000
                        : 0;
            const offsetPx = diagramKind === 'UTILIZATION' ? 0 : (rawVal / maxDiagVal) * 26;
            return `${(bx + nx * offsetPx).toFixed(1)},${(by + ny * offsetPx).toFixed(1)}`;
          });

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

          return (
            <g
              key={el.id}
              onClick={() => selectByAnalyticalElementIndex(el.index)}
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
                strokeWidth={selectedElementIdx === el.index || isPhysSelected ? 3.2 : uInfo?.failed ? 2.8 : 1.8}
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
              {fallbackReason ? ` (FALLBACK: ${fallbackReason})` : ''}
            </span>
            <span
              data-testid="struct-lifecycle-badge"
              data-lifecycle-code={lifecycleBadge.statusCode}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-mono font-semibold ${lifecycleBadge.cls}`}
            >
              {lifecycleBadge.label}
            </span>
          </div>
          <p data-testid="struct-solver-diagnostics-bar" className="mt-1 text-xs font-mono text-slate-300">
            {activeSnap
              ? `Physical: ${activeSnap.system.physicalModel.columns.length} cols, ${activeSnap.system.physicalModel.beams.length} beams, ${activeSnap.system.physicalModel.slabs.length} slabs → Analytical: ${activeSnap.system.nodes.length} nodes, ${activeSnap.system.elements.length} 3D FE · WASM Heap ${((caseSummary?.diagnostics.wasmLinearMemoryBytes ?? 0) / 1048576).toFixed(1)} MB (Stack ${((caseSummary?.diagnostics.wasmStackCapacityBytes ?? 0) / 1048576).toFixed(1)} MB) · Factorized once/${caseSummary?.diagnostics.factorizationReusedCount ?? 0} RHS · Equilibrium ${
                  caseSummary?.equilibrium.isEquilibrated ? `VERIFIED (${caseSummary.equilibrium.relativeStiffnessResidual.toExponential(2)})` : 'PENDING'
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
          <input
            data-testid="struct-geotech-reference"
            type="text"
            value={geotechReference}
            onChange={(e) => setGeotechReference(e.target.value)}
            className="rounded-lg border border-slate-600 bg-[#0B101B] px-2.5 py-1.5 text-xs font-mono text-[#F8FAFC]"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-300">
          <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400">Settlement limit (mm)</span>
          <input
            data-testid="struct-settlement-limit"
            type="number"
            min={0}
            step="any"
            value={settlementLimit}
            onChange={(e) => setSettlementLimit(e.target.value)}
            className="rounded-lg border border-slate-600 bg-[#0B101B] px-2.5 py-1.5 text-xs font-mono text-[#F8FAFC]"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-300">
          <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400">Soil unit weight (kN/m³)</span>
          <input
            data-testid="struct-soil-unit-weight"
            type="number"
            min={0}
            step="any"
            value={soilUnitWeight}
            onChange={(e) => setSoilUnitWeight(e.target.value)}
            className="rounded-lg border border-slate-600 bg-[#0B101B] px-2.5 py-1.5 text-xs font-mono text-[#F8FAFC]"
          />
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
      <button
        type="button"
        className="self-start text-xs text-sky-300 underline disabled:opacity-50"
        disabled={feaBusy}
        onClick={() => {
          setAnalysis(null);
          setAnalysisRetry((current) => current + 1);
        }}
      >
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
            {totalGravitySlsKn?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? '—'}{' '}
            <span className="text-xs font-normal text-slate-400">kN</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-300">
            Simultaneous per-combo reactions · Zero duplicate self-weight
          </div>
        </div>

        <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-3.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Seismic Base Shear Vb (Zone {seismicZone})
          </div>
          <div data-testid="struct-base-shear-value" className="mt-1 text-xl font-bold font-mono text-amber-300">
            {baseShearDisplayKn?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? '—'}{' '}
            <span className="text-xs font-normal text-slate-400">kN</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-300">
            Modal T1 = {activeSnap?.loadTakeoff.seismicSummary?.analyticalFundamentalPeriodSec.toFixed(3) ?? '—'}s · Wind{' '}
            {windEnabled ? 'ON' : 'OFF'}{' '}
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
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Max Physical Utilization</div>
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
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Consolidated BOQ &amp; BBS</div>
          <div className="mt-1 text-xl font-bold font-mono text-sky-300">
            {activeSnap ? `${activeSnap.detailingAndBoq.quantities.netConcreteVolumeM3} m³` : '…'}{' '}
            <span className="text-xs font-normal text-slate-400">
              · {activeSnap ? `${activeSnap.detailingAndBoq.quantities.totalSteelTonnes} MT` : ''}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-300">
            {activeSnap
              ? `${activeSnap.detailingAndBoq.bbsEntries.length} consolidated BBS marks · Joint ded. ${activeSnap.detailingAndBoq.quantities.jointAndSlabIntersectionDeductionM3} m³`
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
            ['STUDIO_VIEWS', 'Framing, Mesh & Footing Views'],
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
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 rounded-xl border border-slate-700/80 bg-[#111827] overflow-auto max-h-[480px]">
            <table data-testid="struct-column-schedule-table" className="w-full text-left text-xs font-mono">
              <thead className="bg-[#0F172A] text-slate-300 border-b border-slate-700 sticky top-0">
                <tr>
                  <th className="p-2.5">Physical Member</th>
                  <th className="p-2.5">Group</th>
                  <th className="p-2.5">Size (mm)</th>
                  <th className="p-2.5">Pu (kN)</th>
                  <th className="p-2.5">Mux / Muy</th>
                  <th className="p-2.5">Main Rebar</th>
                  <th className="p-2.5">Bresler</th>
                  <th className="p-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {activeSnap
                  ? activeSnap.rccDesign.columns.map((col) => (
                      <tr
                        key={col.physicalMemberId}
                        onClick={() => {
                          setSelectedPhysicalMemberId(col.physicalMemberId);
                          setMemberOptPreview(null);
                        }}
                        className={`cursor-pointer hover:bg-slate-800/60 ${
                          selectedPhysicalMemberId === col.physicalMemberId ? 'bg-amber-500/10' : ''
                        }`}
                      >
                        <td className="p-2.5 font-semibold text-amber-300">{col.physicalMemberId}</td>
                        <td className="p-2.5 text-slate-400">{col.scheduleGroupMark}</td>
                        <td className="p-2.5">
                          {col.widthMm}×{col.depthMm} ({col.concreteGrade})
                        </td>
                        <td className="p-2.5">{col.demandPuKn}</td>
                        <td className="p-2.5">
                          {col.designMuxWithEccentricityAndSlendernessKnM} / {col.designMuyWithEccentricityAndSlendernessKnM}
                        </td>
                        <td className="p-2.5">{col.longitudinalBars.label}</td>
                        <td className="p-2.5">{col.biaxialInteractionRatio}</td>
                        <td className="p-2.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold ${
                              col.status === 'PASSED'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-rose-500/20 text-rose-300'
                            }`}
                          >
                            {col.status === 'PASSED' ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : (
                              <AlertTriangle className="h-3 w-3" />
                            )}
                            {col.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  : null}
              </tbody>
            </table>
          </div>
          {renderSelectedMemberInspector()}
        </div>
      )}

      {/* 2. BEAMS & SLABS */}
      {activeSubTab === 'BEAMS_SLABS' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 flex flex-col gap-4">
            <div className="rounded-xl border border-slate-700/80 bg-[#111827] overflow-auto max-h-[340px]">
              <table data-testid="struct-beam-checks-table" className="w-full text-left text-xs font-mono">
                <thead className="bg-[#0F172A] text-slate-300 border-b border-slate-700 sticky top-0">
                  <tr>
                    <th className="p-2.5">Physical Beam</th>
                    <th className="p-2.5">FE</th>
                    <th className="p-2.5">Section (mm)</th>
                    <th className="p-2.5">Span (mm)</th>
                    <th className="p-2.5">Me Hog / Sag</th>
                    <th className="p-2.5">Top / Bottom Steel</th>
                    <th className="p-2.5">Util</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {activeSnap
                    ? activeSnap.rccDesign.beams.map((bm) => (
                        <tr
                          key={bm.physicalMemberId}
                          onClick={() => {
                            setSelectedPhysicalMemberId(bm.physicalMemberId);
                            setMemberOptPreview(null);
                          }}
                          className={`cursor-pointer hover:bg-slate-800/60 ${
                            selectedPhysicalMemberId === bm.physicalMemberId ? 'bg-amber-500/10' : ''
                          }`}
                        >
                          <td className="p-2.5 font-semibold text-sky-300">
                            {bm.physicalMemberId} <span className="text-slate-400">[{bm.scheduleGroupMark}]</span>
                          </td>
                          <td className="p-2.5 text-cyan-300">{bm.analyticalElementIndices.length}</td>
                          <td className="p-2.5">
                            {bm.widthMm}×{bm.depthMm}
                          </td>
                          <td className="p-2.5">{bm.clearSpanMm}</td>
                          <td className="p-2.5">
                            {bm.equivalentHoggingMeKnM} / {bm.equivalentSaggingMeKnM}
                          </td>
                          <td className="p-2.5">
                            T: {bm.topBarsSupport.label} · B: {bm.bottomBarsMidspan.label}
                          </td>
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
              <div className="rounded-xl border border-slate-700/80 bg-[#111827] overflow-auto max-h-[240px]">
                <div className="px-3 py-2 text-xs font-bold border-b border-slate-700 bg-[#0F172A] text-slate-200 sticky top-0">
                  IS 456 Annex D Subdivided Two-Way / One-Way / Cantilever Slab Bays &amp; Staircase Waist Slabs
                </div>
                <table className="w-full text-left text-xs font-mono">
                  <thead className="text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="p-2">Panel</th>
                      <th className="p-2">Type</th>
                      <th className="p-2">lx × ly (mm)</th>
                      <th className="p-2">Thickness</th>
                      <th className="p-2">Short Span Rebar</th>
                      <th className="p-2">L/d Check</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {activeSnap.rccDesign.slabs.map((sl) => (
                      <tr key={sl.panelId}>
                        <td className="p-2 text-emerald-300">
                          {sl.panelId} [{sl.scheduleGroupMark}]
                        </td>
                        <td className="p-2">{sl.panelType}</td>
                        <td className="p-2">
                          {sl.lxMm}×{sl.lyMm}
                        </td>
                        <td className="p-2">{sl.thicknessMm} mm</td>
                        <td className="p-2">
                          T{sl.shortSpanBottomDiaMm}@{sl.shortSpanBottomSpacingMm} mm c/c
                        </td>
                        <td className="p-2">
                          {sl.spanOverDepthActual} &le; {sl.spanOverDepthAllowable} ({sl.status})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {renderSelectedMemberInspector()}
        </div>
      )}

      {/* 3. FOUNDATIONS (SAFE-LIKE GEOTECHNICAL SCHEDULE) */}
      {activeSubTab === 'FOOTINGS' && (
        <div className="flex flex-col gap-3">
          {activeSnap && activeSnap.foundationDesign.infeasibilityDiagnostics.length > 0 && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs font-mono text-rose-200 space-y-1">
              <div className="font-bold text-rose-300">Geotechnical / Shallow Foundation Infeasibility Diagnostics:</div>
              {activeSnap.foundationDesign.infeasibilityDiagnostics.map((msg, idx) => (
                <div key={idx}>• {msg}</div>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-slate-700/80 bg-[#111827] overflow-auto">
            {activeSnap?.foundationDesign.status === 'MISSING_GEOTECHNICAL_INPUT' ? (
              <div
                data-testid="struct-missing-geotech-banner"
                className="p-6 flex items-start gap-3 text-amber-200 bg-amber-500/10"
              >
                <ShieldAlert className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
                <div className="text-xs leading-relaxed">
                  <div className="font-bold text-sm">
                    MISSING_GEOTECHNICAL_INPUT — Foundation Design Gated (IS 1904:1986)
                  </div>
                  RH Planner never invents soil Safe Bearing Capacity (SBC). Enter a reviewed site geotechnical SBC (&ge; 30 kN/m²) in the{' '}
                  <strong>Soil SBC</strong> input above to design Isolated, Combined, Strap, Strip, or Rigid-Mat Raft foundations.
                </div>
              </div>
            ) : (
              <table data-testid="struct-footing-schedule-table" className="w-full text-left text-xs font-mono">
                <thead className="bg-[#0F172A] text-slate-300 border-b border-slate-700">
                  <tr>
                    <th className="p-2.5">Footing ID</th>
                    <th className="p-2.5">Formulation / Typology</th>
                    <th className="p-2.5">Plan L×W×D (mm)</th>
                    <th className="p-2.5">P_SLS / Pu (kN)</th>
                    <th className="p-2.5">q_net / SBC (kPa)</th>
                    <th className="p-2.5">Settle (mm)</th>
                    <th className="p-2.5">Punching (MPa)</th>
                    <th className="p-2.5">Reinforcement</th>
                    <th className="p-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {activeSnap
                    ? activeSnap.foundationDesign.footings.map((ft) => (
                        <tr key={ft.footingId} className="hover:bg-slate-800/50">
                          <td className="p-2.5 font-semibold text-emerald-300">
                            {ft.footingId} [{ft.scheduleGroupMark}]
                          </td>
                          <td className="p-2.5">
                            {ft.typology} <span className="text-[10px] text-slate-400">({ft.analysisFormulation})</span>
                          </td>
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
                            {ft.estimatedSettlementMm} / {ft.allowableSettlementMm}
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
        </div>
      )}

      {/* 4. GATE 9 STUDIO VIEWS: PHYSICAL FRAMING | ANALYTICAL MESH | FOUNDATION PLAN */}
      {activeSubTab === 'STUDIO_VIEWS' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 flex flex-col gap-3 rounded-xl border border-slate-700/80 bg-[#111827] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Layers className="h-4 w-4 text-amber-400" />
                {(
                  [
                    ['PHYSICAL_FRAMING', 'Physical Framing View', 'struct-view-physical'],
                    ['ANALYTICAL_MESH', 'Analytical Mesh View', 'struct-view-analytical'],
                    ['FOUNDATION_PLAN', 'Foundation View', 'struct-view-foundation'],
                  ] as const
                ).map(([kind, label, tid]) => (
                  <button
                    key={kind}
                    type="button"
                    data-testid={tid}
                    onClick={() => setStudioViewKind(kind)}
                    className={`rounded px-2.5 py-1 text-xs font-mono font-semibold cursor-pointer ${
                      studioViewKind === kind
                        ? 'bg-amber-500 text-[#0B101B]'
                        : 'bg-[#0B101B] text-slate-300 border border-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {studioViewKind !== 'FOUNDATION_PLAN' && activeSnap && (
                <select
                  data-testid="struct-studio-floor-selector"
                  value={studioFloorId}
                  onChange={(e) => setStudioFloorId(e.target.value)}
                  className="rounded border border-slate-600 bg-[#0B101B] px-2.5 py-1 text-xs font-mono text-[#F8FAFC]"
                >
                  {activeSnap.system.nodes.some((n) => n.floorId === 'PLINTH') && (
                    <option value="PLINTH">Plinth Tie Level (0.0 m)</option>
                  )}
                  {activeSnap.system.storeys.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name || st.id} ({(st.elevationMm / 1000).toFixed(2)} m)
                    </option>
                  ))}
                </select>
              )}
            </div>
            {renderStudioPlanView()}
            <div className="text-[11px] font-mono text-slate-400 flex flex-wrap gap-4">
              <span>• Green: PASSED</span>
              <span>• Red: DESIGN_FAILED</span>
              <span>• Violet: UNSUPPORTED_SCOPE</span>
              <span>• Cyan dashed (Mesh View): Subdivided Finite Elements (__fe_1..N)</span>
            </div>
          </div>
          {renderSelectedMemberInspector()}
        </div>
      )}

      {/* 5. MODAL & STOREY DRIFT */}
      {activeSubTab === 'SEISMIC' && (
        <div className="flex flex-col gap-3">
          {activeSnap?.loadTakeoff.seismicSummary && (
            <div className="rounded-lg border border-slate-700 bg-[#0F172A] px-3.5 py-2 text-[11px] font-mono text-slate-300">
              Formulation: <span className="text-amber-300">{activeSnap.loadTakeoff.seismicSummary.modalFormulation}</span> · Orthonormality Error:{' '}
              {activeSnap.loadTakeoff.seismicSummary.orthogonalityMaxError.toExponential(2)} · Mass Participation: X{' '}
              {activeSnap.loadTakeoff.seismicSummary.totalModalMassParticipationXPct.toFixed(1)}% / Y{' '}
              {activeSnap.loadTakeoff.seismicSummary.totalModalMassParticipationYPct.toFixed(1)}% (3D coupled torsional/response-spectrum/shell dynamics not claimed)
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300 mb-3">
                Reduced-Order Storey Translational Modal Eigenvalues (Awatif WASM Flexibility)
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
        </div>
      )}

      {/* 6. 3D ISOMETRIC FEA FORCE DIAGRAMS & STATION INSPECTOR */}
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
                      diagramKind === dk
                        ? 'bg-amber-500 text-[#0B101B]'
                        : 'bg-[#0B101B] text-slate-300 border border-slate-700'
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

          <div className="flex flex-col gap-3">
            <div
              data-testid="struct-member-inspector"
              className="rounded-xl border border-slate-700/80 bg-[#111827] p-4 flex flex-col gap-2 text-xs font-mono overflow-auto max-h-[260px]"
            >
              <div className="font-bold text-amber-300 uppercase tracking-wider">
                Analytical Element 11-Station Force Inspector
              </div>
              {activeSnap && activeComboResult && activeComboResult.memberForces[selectedElementIdx] ? (
                (() => {
                  const mf = activeComboResult.memberForces[selectedElementIdx]!;
                  const el = activeSnap.system.elements[selectedElementIdx]!;
                  return (
                    <>
                      <div className="text-slate-200 font-semibold">
                        {mf.elementId} → Physical {el.parentMemberId ?? mf.elementId} (L={mf.lengthM.toFixed(2)}m)
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 rounded bg-[#0B101B] p-2 text-[11px]">
                        <div>Max N: {mf.extrema.maxCompressionKn.toFixed(1)} kN</div>
                        <div>Max |Vz|: {mf.extrema.maxAbsVzKn.toFixed(1)} kN</div>
                        <div>Max +My: {mf.extrema.maxPositiveMyKnM.toFixed(2)} kN·m</div>
                        <div>Min -My: {mf.extrema.maxNegativeMyKnM.toFixed(2)} kN·m</div>
                        <div>Max |Mx|: {mf.extrema.maxAbsMxKnM.toFixed(2)} kN·m</div>
                        <div>Chord Defl: {(mf.extrema.maxRelativeChordDeflectionM * 1000).toFixed(2)} mm</div>
                      </div>
                      <div className="divide-y divide-slate-800 text-[10px]">
                        {mf.stations.slice(0, 6).map((st, idx) => (
                          <div key={idx} className="py-0.5 flex justify-between">
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
                <div className="text-slate-400">Click any 3D frame element to inspect internal forces &amp; optimize its parent physical member.</div>
              )}
            </div>
            {renderSelectedMemberInspector()}
          </div>
        </div>
      )}

      {/* 7. DEFECTS & GLOBAL-REANALYSIS OPTIMIZER */}
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

          {/* Gate 9: Side-by-Side Before-and-After Optimization Comparison */}
          {optResult && (
            <div
              data-testid="struct-before-after-comparison"
              className="rounded-xl border border-emerald-500/30 bg-[#111827] p-4 overflow-auto"
            >
              <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-300 mb-2.5">
                Before vs After Global-Reanalysis Optimization Comparison
              </h3>
              <table className="w-full text-left text-xs font-mono">
                <thead className="text-slate-400 border-b border-slate-700">
                  <tr>
                    <th className="py-1.5">Metric</th>
                    <th className="py-1.5">Baseline (Before)</th>
                    <th className="py-1.5">Optimized (After Global Reanalysis)</th>
                    <th className="py-1.5">Delta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  <tr>
                    <td className="py-1.5">Lifecycle Status</td>
                    <td className="py-1.5 text-rose-300">{optResult.before.designLifecycleStatus}</td>
                    <td className="py-1.5 text-emerald-300">{optResult.after.designLifecycleStatus}</td>
                    <td className="py-1.5">{optResult.iterations.length} WASM Passes</td>
                  </tr>
                  <tr>
                    <td className="py-1.5">Max Member Utilization</td>
                    <td className="py-1.5">{optResult.before.maxMemberUtilization}</td>
                    <td className="py-1.5 font-bold text-emerald-300">{optResult.after.maxMemberUtilization}</td>
                    <td className="py-1.5">
                      {(optResult.after.maxMemberUtilization - optResult.before.maxMemberUtilization).toFixed(3)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5">Critical / Major Defects</td>
                    <td className="py-1.5">{optResult.before.criticalDefectCount}</td>
                    <td className="py-1.5 font-bold text-emerald-300">{optResult.after.criticalDefectCount}</td>
                    <td className="py-1.5">-{optResult.deltaSummary.defectsResolved} resolved</td>
                  </tr>
                  <tr>
                    <td className="py-1.5">Net Concrete Volume</td>
                    <td className="py-1.5">{optResult.before.detailingAndBoq.quantities.netConcreteVolumeM3} m³</td>
                    <td className="py-1.5">{optResult.after.detailingAndBoq.quantities.netConcreteVolumeM3} m³</td>
                    <td className="py-1.5">{optResult.deltaSummary.concreteDeltaM3} m³</td>
                  </tr>
                  <tr>
                    <td className="py-1.5">Total Reinforcement Steel</td>
                    <td className="py-1.5">{optResult.before.detailingAndBoq.quantities.totalSteelWeightKg} kg</td>
                    <td className="py-1.5">{optResult.after.detailingAndBoq.quantities.totalSteelWeightKg} kg</td>
                    <td className="py-1.5">{optResult.deltaSummary.steelDeltaKg} kg</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 rounded-xl border border-slate-700/80 bg-[#111827] p-4 max-h-[450px] overflow-auto">
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
                    <div
                      key={d.defectId}
                      onClick={() => {
                        if (d.physicalMemberId) {
                          setSelectedPhysicalMemberId(d.physicalMemberId);
                          setMemberOptPreview(null);
                        }
                      }}
                      className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs font-mono cursor-pointer hover:bg-rose-500/15"
                    >
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
            {renderSelectedMemberInspector()}
          </div>
        </div>
      )}

      {/* 8. BAR BENDING SCHEDULE (BBS) & DEDUPLICATED QUANTITIES */}
      {activeSubTab === 'BBS_BOQ' && activeSnap && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs font-mono">
            <div className="rounded-lg border border-slate-700 bg-[#111827] p-3">
              <div className="text-slate-400 text-[10px]">NET CONCRETE</div>
              <div className="text-base font-bold text-sky-300 mt-0.5">
                {activeSnap.detailingAndBoq.quantities.netConcreteVolumeM3} m³
              </div>
            </div>
            <div className="rounded-lg border border-slate-700 bg-[#111827] p-3">
              <div className="text-slate-400 text-[10px]">JOINT DEDUCTION</div>
              <div className="text-base font-bold text-emerald-300 mt-0.5">
                -{activeSnap.detailingAndBoq.quantities.jointAndSlabIntersectionDeductionM3} m³
              </div>
            </div>
            <div className="rounded-lg border border-slate-700 bg-[#111827] p-3">
              <div className="text-slate-400 text-[10px]">TOTAL REBAR STEEL</div>
              <div className="text-base font-bold text-amber-300 mt-0.5">
                {activeSnap.detailingAndBoq.quantities.totalSteelWeightKg} kg
              </div>
            </div>
            <div className="rounded-lg border border-slate-700 bg-[#111827] p-3">
              <div className="text-slate-400 text-[10px]">SHUTTERING AREA</div>
              <div className="text-base font-bold text-slate-100 mt-0.5">
                {activeSnap.detailingAndBoq.quantities.formworkAreaM2} m²
              </div>
            </div>
            <div className="rounded-lg border border-slate-700 bg-[#111827] p-3">
              <div className="text-slate-400 text-[10px]">EXCAVATION</div>
              <div className="text-base font-bold text-slate-100 mt-0.5">
                {activeSnap.detailingAndBoq.quantities.excavationVolumeM3} m³
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/80 bg-[#111827] overflow-auto max-h-[380px]">
            <table data-testid="struct-bbs-table" className="w-full text-left text-xs font-mono">
              <thead className="bg-[#0F172A] text-slate-300 border-b border-slate-700 sticky top-0">
                <tr>
                  <th className="p-2.5">Bar Mark</th>
                  <th className="p-2.5">Consolidated Group</th>
                  <th className="p-2.5">Members</th>
                  <th className="p-2.5">Shape (IS 2502)</th>
                  <th className="p-2.5">Dia</th>
                  <th className="p-2.5">Total Bars</th>
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
                    <td className="p-2 text-cyan-300">{row.memberCount}</td>
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

      {/* 9. UNIFIED AI STRUCTURAL ENGINEERING ASSISTANT */}
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

/**
 * Backend HTTP Routes for RH Planner's Embedded Awatif v3.4.0 Structural Engineering Engine,
 * RCC/Foundation Design, Protected Localized Global-Reanalysis Optimizer, CAD/BIM Drawings,
 * and Unified AI Structural Engineering Assistant (Phases A7–A19).
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AITaskType, validateBuildingSchema, type Building } from '@ai-floor-planner/core';
import type { BaseAIProvider } from '@ai-floor-planner/ai-orchestration';
import {
  exportStructuralEngineeringDxf,
  exportStructuralIfc4Step,
  MANDATORY_STRUCTURAL_DISCLAIMER,
  snapshotDrawingApprovalStatus,
  snapshotSolverBackends,
  type ConcreteGrade,
  type FootingSizingOverrides,
  type FoundationSystemPreference,
  type FrameSynthesisOptions,
  type FullStructuralEvaluationSnapshot,
  type OptimizationObjectiveMode,
  type ReviewedStructuralInputs,
  type SeismicZoneIS1893,
  type StructuralCaseSummary,
  type StructuralEvaluationSummary,
  type SoilTypeIS1893,
  type SteelGrade,
} from '@ai-floor-planner/structural-engine';
import { StructuralAnalysisEngine } from '../services/structural-analysis-engine.js';
import { StructuralDrawingsService } from '../services/structural-drawings-service.js';
import { RequestBodyTooLarge, isRecord } from './http-input.js';

const engine = new StructuralAnalysisEngine();
const drawingsService = new StructuralDrawingsService();

interface SavedEvaluation {
  readonly snapshot: FullStructuralEvaluationSnapshot;
  readonly inputs: ReviewedStructuralInputs;
  readonly name: string;
}

const evaluations = new Map<string, SavedEvaluation>();

function rememberEvaluation(evaluation: SavedEvaluation): string {
  const id = randomUUID();
  evaluations.set(id, evaluation);
  if (evaluations.size > 4) evaluations.delete(evaluations.keys().next().value!);
  return id;
}

function withoutRuleChecks<T extends { readonly ruleChecks: readonly unknown[] }>(record: T): Omit<T, 'ruleChecks'> {
  const { ruleChecks, ...summary } = record;
  void ruleChecks;
  return summary;
}

function summarizeEvaluation(snapshot: FullStructuralEvaluationSnapshot): StructuralEvaluationSummary {
  function summarizeResults(results: FullStructuralEvaluationSnapshot['solveEnvelope']['combinationResults']) {
    return Object.fromEntries(Object.entries(results).map(([id, { name, diagnostics, equilibrium }]) => [
      id, { name, diagnostics, equilibrium } satisfies StructuralCaseSummary,
    ]));
  }
  return {
    ...snapshot,
    rccDesign: {
      ...snapshot.rccDesign,
      columns: snapshot.rccDesign.columns.map(withoutRuleChecks),
      beams: snapshot.rccDesign.beams.map(withoutRuleChecks),
      slabs: snapshot.rccDesign.slabs.map(withoutRuleChecks),
      stairs: snapshot.rccDesign.stairs.map(withoutRuleChecks),
    },
    foundationDesign: {
      ...withoutRuleChecks(snapshot.foundationDesign),
      footings: snapshot.foundationDesign.footings.map(withoutRuleChecks),
    },
    solveEnvelope: {
      ...snapshot.solveEnvelope,
      loadCaseResults: summarizeResults(snapshot.solveEnvelope.loadCaseResults),
      combinationResults: summarizeResults(snapshot.solveEnvelope.combinationResults),
    },
  };
}

function parseReviewedInputs(raw: unknown): ReviewedStructuralInputs | { error: string } {
  if (!isRecord(raw)) {
    return { error: 'reviewedInputs object is required.' };
  }
  const concreteGrade = (raw.concreteGrade ?? 'M25') as ConcreteGrade;
  if (!['M20', 'M25', 'M30', 'M35', 'M40'].includes(concreteGrade)) {
    return { error: `Unsupported concreteGrade '${String(concreteGrade)}'.` };
  }
  const steelGrade = (raw.steelGrade ?? 'Fe500') as SteelGrade;
  if (!['Fe415', 'Fe500', 'Fe550'].includes(steelGrade)) {
    return { error: `Unsupported steelGrade '${String(steelGrade)}'.` };
  }

  let geotechnical: ReviewedStructuralInputs['geotechnical'] = null;
  if (raw.geotechnical != null) {
    if (!isRecord(raw.geotechnical)) return { error: 'Geotechnical inputs must be an object.' };
    const { safeBearingCapacityKPa, foundationDepthBelowGroundM, soilUnitWeightKnM3, allowableSettlementMm, reportReference } = raw.geotechnical;
    for (const [label, value] of Object.entries({ safeBearingCapacityKPa, foundationDepthBelowGroundM, soilUnitWeightKnM3, allowableSettlementMm })) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return { error: 'Geotechnical ' + label + ' must be a positive reviewed number.' };
      }
    }
    if (typeof reportReference !== 'string' || !reportReference.trim()) {
      return { error: 'A site geotechnical report reference is required.' };
    }
    geotechnical = {
      safeBearingCapacityKPa: safeBearingCapacityKPa as number,
      foundationDepthBelowGroundM: foundationDepthBelowGroundM as number,
      soilUnitWeightKnM3: soilUnitWeightKnM3 as number,
      allowableSettlementMm: allowableSettlementMm as number,
      reportReference: reportReference.trim(),
    };
  }

  const seismicRaw = isRecord(raw.seismic) ? raw.seismic : null;
  const windRaw = isRecord(raw.wind) ? raw.wind : null;

  for (const [label, value] of Object.entries({
    floorFinishKnM2: raw.floorFinishKnM2,
    masonryUnitWeightKnM3: raw.masonryUnitWeightKnM3,
    roofLiveLoadKnM2: raw.roofLiveLoadKnM2,
    waterTankLoadKn: raw.waterTankLoadKn,
    importanceFactorI: seismicRaw?.importanceFactorI,
    responseReductionFactorR: seismicRaw?.responseReductionFactorR,
    basicWindSpeedVbMs: windRaw?.basicWindSpeedVbMs,
  })) {
    const minimum = ['floorFinishKnM2', 'roofLiveLoadKnM2', 'waterTankLoadKn'].includes(label) ? 0 : Number.MIN_VALUE;
    if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < minimum)) {
      return { error: label + ' is outside the supported numeric range.' };
    }
  }
  if (seismicRaw?.zone != null && !['II', 'III', 'IV', 'V'].includes(String(seismicRaw.zone))) {
    return { error: 'Unsupported seismic zone.' };
  }
  if (seismicRaw?.soilType != null && !['ROCK_HARD', 'MEDIUM', 'SOFT'].includes(String(seismicRaw.soilType))) {
    return { error: 'Unsupported seismic site class.' };
  }

  return {
    concreteGrade,
    steelGrade,
    ductileDetailingIS13920: raw.ductileDetailingIS13920 !== false,
    floorFinishKnM2: typeof raw.floorFinishKnM2 === 'number' ? raw.floorFinishKnM2 : 1.2,
    masonryUnitWeightKnM3:
      typeof raw.masonryUnitWeightKnM3 === 'number' ? raw.masonryUnitWeightKnM3 : 19.0,
    roofLiveLoadKnM2: typeof raw.roofLiveLoadKnM2 === 'number' ? raw.roofLiveLoadKnM2 : 1.5,
    waterTankLoadKn: typeof raw.waterTankLoadKn === 'number' ? raw.waterTankLoadKn : 0,
    seismic: seismicRaw
      ? {
          enabled: seismicRaw.enabled !== false,
          zone: (['II', 'III', 'IV', 'V'].includes(String(seismicRaw.zone))
            ? seismicRaw.zone
            : 'III') as SeismicZoneIS1893,
          soilType: (['ROCK_HARD', 'MEDIUM', 'SOFT'].includes(String(seismicRaw.soilType))
            ? seismicRaw.soilType
            : 'MEDIUM') as SoilTypeIS1893,
          importanceFactorI:
            typeof seismicRaw.importanceFactorI === 'number' ? seismicRaw.importanceFactorI : 1.0,
          responseReductionFactorR:
            typeof seismicRaw.responseReductionFactorR === 'number'
              ? seismicRaw.responseReductionFactorR
              : 5.0,
          frameSystemType:
            seismicRaw.frameSystemType === 'RC_MRF_WITHOUT_INFILL'
              ? 'RC_MRF_WITHOUT_INFILL'
              : 'RC_MRF_WITH_BRICK_INFILL',
        }
      : {
          enabled: true,
          zone: 'III',
          soilType: 'MEDIUM',
          importanceFactorI: 1.0,
          responseReductionFactorR: 5.0,
          frameSystemType: 'RC_MRF_WITH_BRICK_INFILL',
        },
    wind: windRaw
      ? {
          enabled: Boolean(windRaw.enabled),
          basicWindSpeedVbMs:
            typeof windRaw.basicWindSpeedVbMs === 'number' ? windRaw.basicWindSpeedVbMs : 39,
          terrainCategory: ([1, 2, 3, 4].includes(Number(windRaw.terrainCategory))
            ? Number(windRaw.terrainCategory)
            : 2) as 1 | 2 | 3 | 4,
        }
      : undefined,
    geotechnical,
  };
}

function buildDeterministicAssistantAnswer(
  query: string,
  snapshot: FullStructuralEvaluationSnapshot,
  inputs: ReviewedStructuralInputs,
): string {
  const qLower = query.toLowerCase();
  const { rccDesign, foundationDesign, detailingAndBoq, defects, loadTakeoff } = snapshot;
  const boq = detailingAndBoq.quantities;

  if (qLower.includes('why') || qLower.includes('fail') || qLower.includes('defect')) {
    if (defects.length === 0) {
      return `The defect detector reported zero findings. Foundation status: ${foundationDesign.status}. Maximum evaluated utilization: ${snapshot.maxMemberUtilization}. ${MANDATORY_STRUCTURAL_DISCLAIMER}`;
    }
    const lines = defects
      .slice(0, 5)
      .map(
        (d) =>
          `• **${d.memberId}** (${d.memberCategory}, ${d.storey}): Utilization **${d.utilizationRatio}** under \`${d.governingCombination}\` (${d.clause}) — ${d.explanation}. *Fix:* ${d.proposedCorrection}`,
      );
    return `Detected **${defects.length}** structural finding(s):\n${lines.join('\n')}\n\n${MANDATORY_STRUCTURAL_DISCLAIMER}`;
  }

  if (qLower.includes('bbs') || qLower.includes('bar bending') || qLower.includes('steel') || qLower.includes('quantit')) {
    return `**Bar Bending Schedule & Deduplicated BOQ Summary:**\n• Net Concrete Volume: **${boq.netConcreteVolumeM3} m³** (deducted ${boq.jointAndSlabIntersectionDeductionM3} m³ at beam-column/slab intersections)\n• Total Reinforcement Steel: **${boq.totalSteelWeightKg} kg (${boq.totalSteelTonnes} MT)** across ${detailingAndBoq.bbsEntries.length} bar marks (Columns ${boq.steelByCategoryKg.columns} kg, Beams ${boq.steelByCategoryKg.beams} kg, Slabs ${boq.steelByCategoryKg.slabs} kg, Footings ${boq.steelByCategoryKg.footings} kg)\n• Formwork: **${boq.formworkAreaM2} m²** · Excavation: **${boq.excavationVolumeM3} m³**\n\n${MANDATORY_STRUCTURAL_DISCLAIMER}`;
  }

  if (qLower.includes('foundation') || qLower.includes('footing') || qLower.includes('sbc') || qLower.includes('raft')) {
    if (foundationDesign.status === 'MISSING_GEOTECHNICAL_INPUT') {
      return `Foundation design is currently gated (**MISSING_GEOTECHNICAL_INPUT**) because no reviewed geotechnical Safe Bearing Capacity (SBC) was supplied. Enter your site geotechnical SBC (kN/m²) and foundation depth to size footings per IS 1904:1986 & IS 456 Cl. 34.`;
    }
    return `**Foundation Design (${foundationDesign.selectedStrategy}):**\n• Status: **${foundationDesign.status}** (${foundationDesign.footings.length} foundation elements for SBC = ${inputs.geotechnical?.safeBearingCapacityKPa} kPa)\n• Peak Soil Pressure: **${Math.max(0, ...foundationDesign.footings.map((f) => f.maxSoilPressureKPa))} kPa**; allowed ${inputs.geotechnical?.safeBearingCapacityKPa} kPa\n\n${MANDATORY_STRUCTURAL_DISCLAIMER}`;
  }

  return `**Structural Evaluation (${inputs.concreteGrade} / ${inputs.steelGrade}; ${snapshotSolverBackends(snapshot)}):**\n• Gravity Total (DL+SDL+LL): **${(loadTakeoff.totalDeadPlusSdlKn + loadTakeoff.totalOccupancyLiveKn + loadTakeoff.totalRoofLiveKn).toFixed(1)} kN** | Seismic Base Shear Vb: **${loadTakeoff.seismicSummary?.designBaseShearVbXKn.toFixed(1) ?? '0'} kN**\n• RCC Superstructure: **${rccDesign.columns.filter((c) => c.status === 'PASSED').length}/${rccDesign.columns.length}** columns passed, **${rccDesign.beams.filter((b) => b.status === 'PASSED').length}/${rccDesign.beams.length}** beams passed, **${rccDesign.slabs.filter((s) => s.status === 'PASSED').length}/${rccDesign.slabs.length}** slabs passed (Max Utilization **${snapshot.maxMemberUtilization}**)\n• Foundations: **${foundationDesign.status}**\n• Quantities: **${boq.netConcreteVolumeM3} m³** concrete, **${boq.totalSteelTonnes} MT** rebar steel.\n\n${MANDATORY_STRUCTURAL_DISCLAIMER}`;
}

export async function handleStructuralRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  readBody: (request: IncomingMessage) => Promise<string>,
  sendJson: (response: ServerResponse, status: number, body: unknown) => void,
  deps: { readonly gemini: BaseAIProvider | null },
): Promise<boolean> {
  const match = url.pathname.match(/^\/api(?:\/v1)?\/structural\/(analyze|optimize|drawings|assistant|case|design|evaluation)$/);
  if (!match) return false;

  if (request.method !== 'POST') {
    sendJson(response, 405, {
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for structural engineering endpoints.' },
    });
    return true;
  }

  try {
    const raw = await readBody(request);
    let body: unknown;
    try {
      body = raw.length > 0 ? JSON.parse(raw) : null;
    } catch {
      sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
      return true;
    }

    if (!isRecord(body)) {
      sendJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'A request object is required.' } });
      return true;
    }

    const action = match[1]!;
    const format = typeof body.format === 'string' ? body.format.toLowerCase() : 'dxf';
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (action === 'drawings' && !['dxf', 'ifc', 'pdf'].includes(format)) {
      sendJson(response, 400, { error: { code: 'UNSUPPORTED_FORMAT', message: "Use 'dxf', 'ifc', or 'pdf'." } });
      return true;
    }
    if (action === 'assistant' && (!query || query.length > 2000)) {
      sendJson(response, 400, { error: { code: 'INVALID_QUERY', message: 'Enter a question of up to 2000 characters.' } });
      return true;
    }

    if ((action === 'case' || action === 'design' || action === 'evaluation') && typeof body.evaluationId !== 'string') {
      sendJson(response, 400, { error: { code: 'INVALID_STRUCTURAL_EVALUATION', message: 'An evaluation identifier is required.' } });
      return true;
    }
    let evaluation: SavedEvaluation;
    if (action !== 'analyze' && action !== 'optimize' && body.evaluationId !== undefined) {
      const saved = typeof body.evaluationId === 'string' ? evaluations.get(body.evaluationId) : undefined;
      if (!saved) {
        sendJson(response, 409, { error: { code: 'STRUCTURAL_EVALUATION_EXPIRED', message: 'Run structural analysis again before using this result.' } });
        return true;
      }
      evaluation = saved;
    } else {
      const errors = validateBuildingSchema(body.building);
      if (errors.length || !isRecord(body.building) || !Array.isArray(body.building.floors) || body.building.floors.length === 0) {
        sendJson(response, 400, {
          error: { code: 'INVALID_BUILDING', message: errors[0]?.message ?? 'At least one canonical floor is required.', path: errors[0]?.path },
        });
        return true;
      }
      const building = body.building as unknown as Building;
      const parsedInputs = parseReviewedInputs(body.reviewedInputs);
      if ('error' in parsedInputs) {
        sendJson(response, 400, { error: { code: 'INVALID_ENGINEERING_INPUTS', message: parsedInputs.error } });
        return true;
      }
      const name = building.name || building.id;
      const foundationPref = (body.foundationPreference ?? 'AUTO') as FoundationSystemPreference;
      if (!['AUTO', 'ISOLATED', 'COMBINED', 'STRAP', 'STRIP', 'RIGID_RAFT', 'FLEXIBLE_WINKLER_RAFT', 'PILE_GROUP'].includes(foundationPref)) {
        sendJson(response, 400, { error: { code: 'INVALID_FOUNDATION_PREFERENCE', message: 'Unknown foundation preference.' } });
        return true;
      }

      if (action === 'optimize') {
        const mode = (body.mode ?? 'BALANCED') as OptimizationObjectiveMode;
        const maxIterations = body.maxIterations ?? 6;
        if (!['BALANCED', 'MIN_CONCRETE', 'MIN_STEEL', 'MIN_COST', 'MAX_CLEARANCE', 'SIMPLIFIED_CONSTRUCTION'].includes(mode) ||
            typeof maxIterations !== 'number' || !Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10) {
          sendJson(response, 400, { error: { code: 'INVALID_OPTIMIZATION_OPTIONS', message: 'Select a supported objective and one to ten iterations.' } });
          return true;
        }
        const targetPhysicalMemberIds = Array.isArray(body.targetPhysicalMemberIds)
          ? body.targetPhysicalMemberIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          : undefined;
        const initialSectionOverrides = isRecord(body.initialSectionOverrides)
          ? (body.initialSectionOverrides as FrameSynthesisOptions['sectionOverrides'])
          : undefined;
        const initialRebarOverrides = isRecord(body.initialRebarOverrides)
          ? (body.initialRebarOverrides as FrameSynthesisOptions['rebarOverrides'])
          : undefined;
        const initialSlabOverridesMm = isRecord(body.initialSlabOverridesMm)
          ? (body.initialSlabOverridesMm as FrameSynthesisOptions['slabThicknessOverridesMm'])
          : undefined;
        const initialFootingOverrides = isRecord(body.initialFootingOverrides)
          ? (body.initialFootingOverrides as FootingSizingOverrides['byId'])
          : undefined;

        const optimization = await engine.optimizeReviewedBuilding({
          building,
          inputs: parsedInputs,
          mode,
          targetPhysicalMemberIds,
          initialSectionOverrides,
          initialRebarOverrides,
          initialSlabOverridesMm,
          initialFootingOverrides,
          foundationPreference: foundationPref,
          maxIterations,
        });
        const previewOnly = body.previewOnly === true;
        const evaluationId = previewOnly
          ? undefined
          : rememberEvaluation({ snapshot: optimization.after, inputs: parsedInputs, name });
        sendJson(response, 200, {
          evaluationId,
          previewOnly,
          disclaimer: MANDATORY_STRUCTURAL_DISCLAIMER,
          optimization: {
            ...optimization,
            before: summarizeEvaluation(optimization.before),
            after: summarizeEvaluation(optimization.after),
          },
        });
        return true;
      }

      const footingOverrides: FootingSizingOverrides = { preference: foundationPref };
      const snapshot = await engine.analyzeReviewedBuilding(building, parsedInputs, { footingOverrides });
      evaluation = { snapshot, inputs: parsedInputs, name };
      if (action === 'analyze') {
        const lifecycleStatus = snapshot.designLifecycleStatus;
        const evaluationId = rememberEvaluation(evaluation);
        response.setHeader('X-Structural-Evaluation-Id', evaluationId);
        sendJson(response, 200, { evaluationId, lifecycleStatus, disclaimer: MANDATORY_STRUCTURAL_DISCLAIMER, snapshot: summarizeEvaluation(snapshot) });
        return true;
      }
    }

    const { snapshot, inputs, name } = evaluation;
    if (action === 'evaluation') {
      sendJson(response, 200, { evaluationId: body.evaluationId, snapshot: summarizeEvaluation(snapshot) });
      return true;
    }

    if (action === 'case') {
      const { caseId } = body;
      const results = body.kind === 'loadCase' ? snapshot.solveEnvelope.loadCaseResults : snapshot.solveEnvelope.combinationResults;
      const result = typeof caseId === 'string' && Object.hasOwn(results, caseId) ? results[caseId] : undefined;
      if (!result) {
        sendJson(response, 404, { error: { code: 'STRUCTURAL_CASE_NOT_FOUND', message: 'This case is unavailable for the selected evaluation.' } });
        return true;
      }
      sendJson(response, 200, { evaluationId: body.evaluationId, result });
      return true;
    }

    if (action === 'design') {
      const { memberId } = body;
      const { rccDesign, foundationDesign } = snapshot;
      const record = rccDesign.columns.find((item) => item.elementId === memberId) ??
        rccDesign.beams.find((item) => item.elementId === memberId) ??
        rccDesign.slabs.find((item) => item.panelId === memberId) ??
        rccDesign.stairs.find((item) => item.waistId === memberId) ??
        foundationDesign.footings.find((item) => item.footingId === memberId);
      if (!record) {
        sendJson(response, 404, { error: { code: 'STRUCTURAL_MEMBER_NOT_FOUND', message: 'This member is unavailable for the selected evaluation.' } });
        return true;
      }
      sendJson(response, 200, { evaluationId: body.evaluationId, record });
      return true;
    }

    if (action === 'drawings') {
      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const revision = snapshot.system.sourceArchitecturalSha256;
      const approvalStatus = snapshotDrawingApprovalStatus(snapshot);

      if (format === 'dxf') {
        const dxf = exportStructuralEngineeringDxf(snapshot, name);
        const buf = Buffer.from(dxf, 'utf-8');
        response.writeHead(200, {
          'Content-Type': 'application/dxf; charset=utf-8',
          'Content-Length': String(buf.length),
          'X-Structural-Source-Revision': revision,
          'X-Structural-Approval-Status': approvalStatus,
          'Content-Disposition': `attachment; filename="${safeName}_structural.dxf"`,
        });
        response.end(buf);
        return true;
      }

      if (format === 'ifc') {
        const ifc = exportStructuralIfc4Step(snapshot, name);
        const buf = Buffer.from(ifc, 'utf-8');
        response.writeHead(200, {
          'Content-Type': 'application/x-step; charset=utf-8',
          'Content-Length': String(buf.length),
          'X-Structural-Source-Revision': revision,
          'X-Structural-Approval-Status': approvalStatus,
          'Content-Disposition': `attachment; filename="${safeName}_structural.ifc"`,
        });
        response.end(buf);
        return true;
      }

      if (format === 'pdf') {
        const pdf = await drawingsService.generateReviewedStructuralDrawingPdf(
          snapshot,
          name,
        );
        response.writeHead(200, {
          'Content-Type': pdf.mimeType,
          'Content-Length': String(pdf.data.length),
          'X-Structural-Source-Revision': revision,
          'X-Structural-Approval-Status': approvalStatus,
          'Content-Disposition': `attachment; filename="${pdf.filename}"`,
          'X-CAD-Pages': String(pdf.pageCount),
        });
        response.end(Buffer.from(pdf.data));
        return true;
      }
    }

    if (action === 'assistant') {
      const deterministicAnswer = buildDeterministicAssistantAnswer(query, snapshot, inputs);
      let interpretation: string | undefined;
      let geminiInvoked = false;
      let modelUsed: string | undefined;

      if (body.useAi === true && deps.gemini) {
        try {
          const genRes = await deps.gemini.complete({
            taskType: AITaskType.PlanExplanation,
            systemPrompt:
              'You are a Principal Indian Structural Engineer (IS 456:2000, IS 1893:2016, IS 13920:2016, IS 1904:1986). Use ONLY the verified numerical FEA & RCC/Foundation facts provided below. Never invent numbers or certify unverified safety. Always end with a brief reminder that licensed structural engineer review is required.',
            userPrompt: `User Question: ${query}\n\nVerified Awatif FEA & Design Facts:\n${deterministicAnswer}`,
            maxTokens: 500,
            temperature: 0.1,
            responseFormat: 'text',
            totalDeadlineMs: 15000,
          });
          if (genRes.content?.trim()) {
            interpretation = genRes.content.trim();
            geminiInvoked = true;
            modelUsed = genRes.model;
          }
        } catch {
          // Graceful deterministic fallback when Gemini is offline/rate-limited
          interpretation = undefined;
        }
      }

      sendJson(response, 200, {
        answer: deterministicAnswer,
        interpretation,
        architecturalRevision: snapshot.system.sourceArchitecturalSha256,
        deterministicFacts: deterministicAnswer,
        disclaimer: MANDATORY_STRUCTURAL_DISCLAIMER,
        aiTelemetry: {
          geminiInvoked,
          source: geminiInvoked ? 'GEMINI_GROUNDED_IN_AWATIF_FEA' : 'DETERMINISTIC_AWATIF_FEA',
          modelUsed,
        },
        summaryMetrics: {
          criticalDefectCount: snapshot.criticalDefectCount,
          maxMemberUtilization: snapshot.maxMemberUtilization,
          foundationStatus: snapshot.foundationDesign.status,
          netConcreteM3: snapshot.detailingAndBoq.quantities.netConcreteVolumeM3,
          totalSteelKg: snapshot.detailingAndBoq.quantities.totalSteelWeightKg,
        },
      });
      return true;
    }

    return false;
  } catch (err) {
    if (err instanceof RequestBodyTooLarge) throw err;
    sendJson(response, 500, {
      error: {
        code: 'STRUCTURAL_ENGINE_ERROR',
        message: err instanceof Error ? err.message : 'Structural engine failure.',
      },
    });
    return true;
  }
}

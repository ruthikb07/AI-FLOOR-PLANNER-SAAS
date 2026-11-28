/**
 * Backend HTTP Routes for RH Planner's Embedded Awatif v3.4.0 Structural Engineering Engine,
 * RCC/Foundation Design, Protected Localized Global-Reanalysis Optimizer, CAD/BIM Drawings,
 * and Unified AI Structural Engineering Assistant (Phases A7â€“A19).
 */

import { engineeringInputRecords } from '../services/engineering-input-records.js';
import { loadCoupledReceipt, saveCoupledReceipt, readEvaluation, saveEvaluation, type SavedEvaluation } from '../services/structural-evaluation-store.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AITaskType, canonicalBuildingHash, validateBuildingSchema, type Building } from '@ai-floor-planner/core';
import type { BaseAIProvider } from '@ai-floor-planner/ai-orchestration';
import {
  getSharedPythonStructuralWorker,
  assembleLoadedAnalyticalFrameModel,
  type AnalyticalSolveEnvelope,
  exportStructuralBbsCsv,
  exportStructuralEngineeringDxf,
  exportStructuralEngineeringJsonReport,
  exportStructuralIfc4Step,
  MANDATORY_STRUCTURAL_DISCLAIMER,
  snapshotDrawingApprovalStatus,
  snapshotSolverBackends,
  UnsupportedStructuralMethodError,
  type ConcreteGrade,
  type FootingSizingOverrides,
  type FoundationSystemPreference,
  type FrameSynthesisOptions,
  type FullStructuralEvaluationSnapshot,
  type OptimizationObjectiveMode,
  isRectangularDeckReview,
  isStairBearingReview,
  DeckReviewError,
  type AutomaticDeckMeshRegion,
  type PhysicalDeckMeshReceipt,
  type PythonWorkerResponseBase,
  type ReviewedStructuralInputs,
  type SectionCapacityBackend,
  type SeismicZoneIS1893,
  type StructuralCaseSummary,
  type StructuralEvaluationSummary,
  type StructuralSolverBackend,
  type SoilTypeIS1893,
  type SteelGrade,
} from '@ai-floor-planner/structural-engine';
import { StructuralAnalysisEngine } from '../services/structural-analysis-engine.js';
import { StructuralDrawingsService } from '../services/structural-drawings-service.js';
import { checkCoupledGravityFoundations, coupledDesignBlocker } from '../services/coupled-foundation.js';
import { coupledFrameCandidates, type CoupledFrameRegistry } from '../services/coupled-frame-design.js';
import { RequestBodyTooLarge, isRecord } from './http-input.js';

const engine = new StructuralAnalysisEngine();
const drawingsService = new StructuralDrawingsService();

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
  const stairs = raw.stairBearingReviews;
  if (stairs !== undefined && (!Array.isArray(stairs) || !stairs.every(isStairBearingReview))) return { error: 'Invalid stair bearing review.' };
  const reviews = raw.rectangularDeckReviews;
  if (reviews !== undefined && (!Array.isArray(reviews) || !reviews.every(isRectangularDeckReview))) {
    return { error: 'Invalid rectangular deck review. Supply the revision, reviewed levels, loads and bearing width.' };
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
    const { subgradeModulusKnM3, bearingCapacityBasis, waterTableDepthBelowGroundM } = raw.geotechnical;
    if (bearingCapacityBasis !== undefined && bearingCapacityBasis !== 'NET' && bearingCapacityBasis !== 'GROSS') {
      return { error: 'Geotechnical bearingCapacityBasis must be NET or GROSS.' };
    }
    if (waterTableDepthBelowGroundM !== undefined &&
        (typeof waterTableDepthBelowGroundM !== 'number' || !Number.isFinite(waterTableDepthBelowGroundM) ||
          waterTableDepthBelowGroundM < 0)) {
      return { error: 'Geotechnical waterTableDepthBelowGroundM must be a finite nonnegative depth.' };
    }
    if (subgradeModulusKnM3 !== undefined &&
        (typeof subgradeModulusKnM3 !== 'number' || !Number.isFinite(subgradeModulusKnM3) || subgradeModulusKnM3 <= 100)) {
      return { error: 'Geotechnical subgradeModulusKnM3 must be a reviewed value greater than 100 kN/mÂ³.' };
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
      ...(bearingCapacityBasis !== undefined ? { bearingCapacityBasis } : {}),
      ...(waterTableDepthBelowGroundM !== undefined ? { waterTableDepthBelowGroundM } : {}),
      ...(subgradeModulusKnM3 !== undefined ? { subgradeModulusKnM3 } : {}),
    };
  }

  const seismicRaw = isRecord(raw.seismic) ? raw.seismic : null;
  const windRaw = isRecord(raw.wind) ? raw.wind : null;
  let waterTankSupport: ReviewedStructuralInputs['waterTankSupport'];
  if (raw.waterTankSupport !== undefined) {
    const support = raw.waterTankSupport;
    if (!isRecord(support) || typeof support.reference !== 'string' || !support.reference.trim() ||
        !isRecord(support.centerOfGravityMm) || !Array.isArray(support.reactions) ||
        support.reactions.length === 0 || support.reactions.length > 128) {
      return { error: 'Tank support requires a reference, plan center of gravity and one to 128 column reactions.' };
    }
    const { x, y } = support.centerOfGravityMm;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      return { error: 'Tank center of gravity requires finite x and y coordinates in millimetres.' };
    }
    const reactions: NonNullable<ReviewedStructuralInputs['waterTankSupport']>['reactions'][number][] = [];
    for (const reaction of support.reactions) {
      if (!isRecord(reaction) || typeof reaction.physicalColumnId !== 'string' || !reaction.physicalColumnId.trim() ||
          typeof reaction.verticalReactionKn !== 'number' || !Number.isFinite(reaction.verticalReactionKn) || reaction.verticalReactionKn <= 0) {
        return { error: 'Each tank reaction requires a physical column ID and positive vertical force in kN.' };
      }
      reactions.push({ physicalColumnId: reaction.physicalColumnId.trim(), verticalReactionKn: reaction.verticalReactionKn });
    }
    if (new Set(reactions.map(reaction => reaction.physicalColumnId)).size !== reactions.length ||
        typeof raw.waterTankLoadKn !== 'number' || raw.waterTankLoadKn <= 0) {
      return { error: 'Tank support requires a positive total tank load and unique receiving columns.' };
    }
    waterTankSupport = { reference: support.reference.trim(), centerOfGravityMm: { x, y }, reactions };
  }

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
    ...(reviews ? { rectangularDeckReviews: reviews } : {}),
    ...(stairs ? { stairBearingReviews: stairs } : {}),
    ductileDetailingIS13920: raw.ductileDetailingIS13920 !== false,
    floorFinishKnM2: typeof raw.floorFinishKnM2 === 'number' ? raw.floorFinishKnM2 : 1.2,
    masonryUnitWeightKnM3:
      typeof raw.masonryUnitWeightKnM3 === 'number' ? raw.masonryUnitWeightKnM3 : 19.0,
    roofLiveLoadKnM2: typeof raw.roofLiveLoadKnM2 === 'number' ? raw.roofLiveLoadKnM2 : 1.5,
    waterTankLoadKn: typeof raw.waterTankLoadKn === 'number' ? raw.waterTankLoadKn : 0,
    ...(waterTankSupport ? { waterTankSupport } : {}),
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
  solverBackends = snapshotSolverBackends(snapshot),
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
          `â€¢ **${d.memberId}** (${d.memberCategory}, ${d.storey}): Utilization **${d.utilizationRatio}** under \`${d.governingCombination}\` (${d.clause}) â€” ${d.explanation}. *Fix:* ${d.proposedCorrection}`,
      );
    return `Detected **${defects.length}** structural finding(s):\n${lines.join('\n')}\n\n${MANDATORY_STRUCTURAL_DISCLAIMER}`;
  }

  if (qLower.includes('bbs') || qLower.includes('bar bending') || qLower.includes('steel') || qLower.includes('quantit')) {
    return `**Bar Bending Schedule & Deduplicated BOQ Summary:**\nâ€¢ Net Concrete Volume: **${boq.netConcreteVolumeM3} mÂ³** (deducted ${boq.jointAndSlabIntersectionDeductionM3} mÂ³ at beam-column/slab intersections)\nâ€¢ Total Reinforcement Steel: **${boq.totalSteelWeightKg} kg (${boq.totalSteelTonnes} MT)** across ${detailingAndBoq.bbsEntries.length} bar marks (Columns ${boq.steelByCategoryKg.columns} kg, Beams ${boq.steelByCategoryKg.beams} kg, Slabs ${boq.steelByCategoryKg.slabs} kg, Footings ${boq.steelByCategoryKg.footings} kg)\nâ€¢ Formwork: **${boq.formworkAreaM2} mÂ²** Â· Excavation: **${boq.excavationVolumeM3} mÂ³**\n\n${MANDATORY_STRUCTURAL_DISCLAIMER}`;
  }

  if (qLower.includes('foundation') || qLower.includes('footing') || qLower.includes('sbc') || qLower.includes('raft')) {
    if (foundationDesign.status === 'MISSING_GEOTECHNICAL_INPUT') {
      return `Foundation design is currently gated (**MISSING_GEOTECHNICAL_INPUT**) because no reviewed geotechnical Safe Bearing Capacity (SBC) was supplied. Enter your site geotechnical SBC (kN/mÂ²) and foundation depth to size footings per IS 1904:1986 & IS 456 Cl. 34.`;
    }
    return `**Foundation Design (${foundationDesign.selectedStrategy}):**\nâ€¢ Status: **${foundationDesign.status}** (${foundationDesign.footings.length} foundation elements for SBC = ${inputs.geotechnical?.safeBearingCapacityKPa} kPa)\nâ€¢ Peak Soil Pressure: **${Math.max(0, ...foundationDesign.footings.map((f) => f.maxSoilPressureKPa))} kPa**; allowed ${inputs.geotechnical?.safeBearingCapacityKPa} kPa\n\n${MANDATORY_STRUCTURAL_DISCLAIMER}`;
  }

  return `**Structural Evaluation (${inputs.concreteGrade} / ${inputs.steelGrade}; ${solverBackends}):**\nâ€¢ Gravity Total (DL+SDL+LL): **${(loadTakeoff.totalDeadPlusSdlKn + loadTakeoff.totalOccupancyLiveKn + loadTakeoff.totalRoofLiveKn).toFixed(1)} kN** | Seismic Base Shear Vb: **${loadTakeoff.seismicSummary?.designBaseShearVbXKn.toFixed(1) ?? '0'} kN**\nâ€¢ RCC Superstructure: **${rccDesign.columns.filter((c) => c.status === 'PASSED').length}/${rccDesign.columns.length}** columns passed, **${rccDesign.beams.filter((b) => b.status === 'PASSED').length}/${rccDesign.beams.length}** beams passed, **${rccDesign.slabs.filter((s) => s.status === 'PASSED').length}/${rccDesign.slabs.length}** slabs passed (Max Utilization **${snapshot.maxMemberUtilization}**)\nâ€¢ Foundations: **${foundationDesign.status}**\nâ€¢ Quantities: **${boq.netConcreteVolumeM3} mÂ³** concrete, **${boq.totalSteelTonnes} MT** rebar steel.\n\n${MANDATORY_STRUCTURAL_DISCLAIMER}`;
}

export async function handleStructuralRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  readBody: (request: IncomingMessage) => Promise<string>,
  sendJson: (response: ServerResponse, status: number, body: unknown) => void,
  deps: { readonly gemini: BaseAIProvider | null },
): Promise<boolean> {
  const match = url.pathname.match(/^\/api(?:\/v1)?\/structural\/(analyze|optimize|drawings|assistant|case|design|evaluation|deck-topology|alignment-preview|engineering-inputs|coupled-gravity)$/);
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
    if (action === 'engineering-inputs') {
      const building = body.building as Building;
      if (validateBuildingSchema(building).length || !building.floors?.length ||
          body.digest !== canonicalBuildingHash(building)) {
        sendJson(response,409,{error:{code:'REVIEW_REVISION_MISMATCH',message:'A matching canonical building revision is required.'}});
        return true;
      }
      try { sendJson(response,200,{records:await engineeringInputRecords(building,body.record)}); }
      catch (error) {
        if (!(error instanceof TypeError)) throw error;
        sendJson(response,422,{error:{code:'INVALID_ENGINEERING_RECORD',message:error.message}});
      }
      return true;
    }
    if (action === 'analyze' && body.regenerate !== undefined && typeof body.regenerate !== 'boolean') {
      sendJson(response, 400, { error: { code: 'INVALID_REGENERATION_OPTION', message: 'The regenerate option must be true or false.' } });
      return true;
    }
    const format = typeof body.format === 'string' ? body.format.toLowerCase() : 'dxf';
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (action === 'drawings' && !['dxf', 'ifc', 'pdf', 'bbs_csv', 'csv', 'json'].includes(format)) {
      sendJson(response, 400, { error: { code: 'UNSUPPORTED_FORMAT', message: "Use 'dxf', 'ifc', 'pdf', 'bbs_csv', or 'json'." } });
      return true;
    }
    if (action === 'assistant' && (!query || query.length > 2000)) {
      sendJson(response, 400, { error: { code: 'INVALID_QUERY', message: 'Enter a question of up to 2000 characters.' } });
      return true;
    }

    if (['case', 'design', 'evaluation', 'deck-topology', 'alignment-preview', 'coupled-gravity'].includes(action) && typeof body.evaluationId !== 'string') {
      sendJson(response, 400, { error: { code: 'INVALID_STRUCTURAL_EVALUATION', message: 'An evaluation identifier is required.' } });
      return true;
    }
    let evaluation: SavedEvaluation;
    if (action !== 'analyze' && action !== 'optimize' && body.evaluationId !== undefined) {
      const saved = typeof body.evaluationId === 'string'
        ? await readEvaluation(body.evaluationId, action === 'assistant' ? 'assistant' : 'full')
        : undefined;
      if (!saved) {
        sendJson(response, 409, { error: { code: 'STRUCTURAL_EVALUATION_EXPIRED', message: 'Run structural analysis again before using this result.' } });
        return true;
      }
      if (action === 'coupled-gravity') {
        const system = saved.snapshot.system;
        if (typeof body.resultId === 'string') {
          const cached = await loadCoupledReceipt(String(body.evaluationId),body.resultId);
          if (!isRecord(cached) || cached.architectureSha256!==body.architectureSha256 ||
              cached.structuralRevision!==system.structuralRevision || cached.evaluationId!==body.evaluationId) {
            sendJson(response,409,{error:{code:'COUPLED_RESULT_MISMATCH',message:'Saved result does not match this evaluation.'}});
          } else sendJson(response,200,{...cached,resultId:body.resultId});
          return true;
        }
        const panels = system.slabPanels;
        const reviews = panels.map(panel => panel.deckReview);
        const stairConflict = system.stairWaists.some(stair=>{
          const box=stair.boundsMm;
          if (!box || !stair.bearingReview || !stair.hasExplicitStraightFlightGeometry) return true;
          return panels.some(panel=>{
            const slab=panel.boundsMm, top=panel.deckReview?.structuralTopMm;
            return slab && (top===stair.baseElevationMm || top===stair.topElevationMm) &&
              Math.min(slab.maxX,box.maxX)>Math.max(slab.minX,box.minX) &&
              Math.min(slab.maxY,box.maxY)>Math.max(slab.minY,box.minY);
          });
        });
        if (body.architectureSha256 !== system.sourceArchitecturalSha256 || !panels.length ||
            reviews.some(review => !review) || stairConflict ||
            !system.storeys.every(floor => panels.some(p=>p.floorId===floor.id))) {
          sendJson(response,422,{error:{code:'COUPLED_DECK_SCOPE',message:'A matching revision and reviewed rectangular decks or independent grid bays at every frame level, including the roof, are required. Stair systems require regional analysis.'}});
          return true;
        }
        const gravityInputs = {...saved.inputs, seismic:undefined, wind:undefined};
        const {analyticalModel,loadTakeoff} = await assembleLoadedAnalyticalFrameModel(system,gravityInputs,undefined,
          {meshedSlabPanelIds:new Set(panels.map(p=>p.id))});
        if (Object.values(loadTakeoff.unassignedGravityKnByCase ?? {}).some(n=>n!==0)) {
          sendJson(response,422,{error:{code:'UNASSIGNED_GRAVITY',message:'The saved frame has an unresolved gravity source.'}});
          return true;
        }
        const decks = panels.map(panel => {
          const review = panel.deckReview!;
          const source = saved.snapshot.loadTakeoff.loadSourceAudit?.find(item=>item.sourceId===panel.id && item.category==='SLAB_PANEL');
          const forces = source?.gravityTransfer?.forceByCaseKn;
          if (!forces || !panel.boundsMm || !panel.supportingBeamElementIndices.length || !panel.areaM2 ||
              !['DL','SDL','LL'].every(id=>Number.isFinite(forces[id]) && forces[id]! >= 0)) throw new Error('Missing reviewed deck pressure ledger.');
          return {id:panel.id,boundsMm:panel.boundsMm,topMm:review.structuralTopMm,thicknessMm:review.thicknessMm,
            reference:review.reference,elasticityKPa:system.elements[panel.supportingBeamElementIndices[0]!]!.section.elasticityKPa,
            supportingBeamElementIndices:panel.supportingBeamElementIndices,
            pressures:Object.fromEntries(['DL','SDL','LL'].map(id=>[id,forces[id]!/panel.areaM2]))};
        });
        const controller = new AbortController();
        const cancel = () => controller.abort();
        response.once('close',cancel);
        const solved = await getSharedPythonStructuralWorker().request<PythonWorkerResponseBase & {
          envelope?:AnalyticalSolveEnvelope; slabLoadLedger?:unknown; frameRegistry?:CoupledFrameRegistry;
        }>({action:'reviewed_rectangular_gravity', model:analyticalModel,decks},undefined,controller.signal)
          .finally(()=>response.off('close',cancel));
        if (!solved.ok || !solved.envelope || !solved.frameRegistry) {
          sendJson(response,422,{error:{code:'COUPLED_SOLVE_FAILED',message:solved.message}});
          return true;
        }
        const results = [...Object.values(solved.envelope.loadCaseResults), ...Object.values(solved.envelope.combinationResults)];
        if (!results.length || results.some(r=>!r.equilibrium.isEquilibrated)) {
          sendJson(response,422,{error:{code:'COUPLED_EQUILIBRIUM_FAILED',message:'Coupled gravity forces or moments failed equilibrium.'}});
          return true;
        }
        const blocker=coupledDesignBlocker(saved,solved.envelope);
        const receipt = {evaluationId:body.evaluationId,architectureSha256:system.sourceArchitecturalSha256,
          structuralRevision:system.structuralRevision,scope:'ELASTIC_GRAVITY_COMPRESSION_ONLY_BEARINGS',
          slabLoadLedger:solved.slabLoadLedger,envelope:solved.envelope,
          stairLoadTransfers:loadTakeoff.loadSourceAudit?.filter(source=>source.category==='STAIRCASE_FLIGHT'),
          frameDesign:coupledFrameCandidates(saved,solved.envelope,solved.frameRegistry,blocker),
          foundation:checkCoupledGravityFoundations(saved,solved.envelope,blocker)};
        const resultId = await saveCoupledReceipt(String(body.evaluationId),receipt);
        sendJson(response,200,{...receipt,resultId});
        return true;
      }
      if (action === 'deck-topology' || action === 'alignment-preview') {
        const building = body.building as Building;
        if (validateBuildingSchema(building).length || canonicalBuildingHash(building) !== saved.snapshot.system.sourceArchitecturalSha256) {
          sendJson(response, 409, { error: { code: 'DECK_ARCHITECTURE_MISMATCH', message: 'Supply the architecture used by this evaluation.' } });
          return true;
        }
        if (action === 'alignment-preview') {
          const { floorId, beamIds } = body;
          if (typeof floorId !== 'string' || !building.floors.some(floor => floor.id === floorId) ||
              !Array.isArray(beamIds) || beamIds.length < 2 || beamIds.length > 32 ||
              beamIds.some(id => typeof id !== 'string') || new Set(beamIds).size !== beamIds.length) {
            sendJson(response, 400, { error: { code: 'INVALID_BEAM_CHAIN', message: 'Select two to 32 different beams on one floor.' } });
            return true;
          }
          const { columns, beams } = saved.snapshot.system.physicalModel;
          const selectedIds = new Set(beamIds);
          const selected = beams.filter(beam => beam.floorId === floorId && selectedIds.has(beam.physicalMemberId));
          if (selected.length !== beamIds.length) {
            sendJson(response, 422, { error: { code: 'INVALID_BEAM_CHAIN', message: 'Some members are missing from the selected floor.' } });
            return true;
          }
          const result = await getSharedPythonStructuralWorker().request<PythonWorkerResponseBase & { preview?: unknown }>({
            action: 'preview_framing_alignment', floorId, beams: selected, columns,
            floors: building.floors.map(({ id, floorUse, boundary, voidBoundaries, canonicalStaircases, rooms }) =>
              ({ id, floorUse, boundary, voidBoundaries, canonicalStaircases,
                rooms: rooms.map(room => ({ id: room.id, boundary: room.boundary })) })),
          });
          if (!result.ok) {
            sendJson(response, 422, { error: { code: 'INVALID_BEAM_CHAIN', message: result.message } });
            return true;
          }
          sendJson(response, 200, { evaluationId: body.evaluationId,
            structuralRevision: saved.snapshot.system.structuralRevision,
            architectureSha256: saved.snapshot.system.sourceArchitecturalSha256, preview: result.preview });
          return true;
        }
        const proposal = body.meshProposal;
        const floorId = isRecord(proposal) ? proposal.supportingFloorId : undefined;
        if (proposal !== undefined && (!isRecord(proposal) || typeof proposal.regionId !== 'string' ||
            !Array.isArray(proposal.nodes) || !Array.isArray(proposal.quads) ||
            !building.floors.some(floor => floor.id === floorId))) {
          sendJson(response, 400, { error: { code: 'INVALID_DECK_MESH', message: 'Specify a supporting floor, region, nodes and quads.' } });
          return true;
        }
        const automatic = body.automaticMesh === true && proposal === undefined;
        const reviews = body.interfaceReviews ?? [];
        if (!Array.isArray(reviews) || reviews.length > 1024 || reviews.some(review =>
          !automatic || !isRecord(review) || review.evaluationId !== body.evaluationId ||
          review.connection !== 'MONOLITHIC_FULL_INTERFACE' ||
          typeof review.reference !== 'string' || !review.reference.trim() || review.reference.length > 512 ||
          !building.floors.some(floor => floor.id === review.supportingFloorId) ||
          !Array.isArray(review.regionIds) || review.regionIds.length !== 2 ||
          !review.regionIds.every((id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 512))) {
          sendJson(response, 422, { error: { code: 'INVALID_INTERFACE_REVIEW', message: 'Specify reviewed region pairs bound to this evaluation and supporting floor.' } });
          return true;
        }
        const frameNodeCount = saved.snapshot.system.nodes.length;
        let firstFreeNode = frameNodeCount;
        const decks = [];
        const worker = getSharedPythonStructuralWorker();
        for (const floor of building.floors) {
          if (proposal !== undefined && floor.id !== floorId) continue;
          const reviewed = saved.snapshot.system.physicalModel.slabs.filter(slab => slab.floorId === floor.id && slab.deckReview);
          const floorReviews = reviews.filter(review => review.supportingFloorId === floor.id);
          if (reviewed.length && floorReviews.length) {
            sendJson(response, 422, { error: { code: 'DECK_ALREADY_REVIEWED', floorId: floor.id,
              message: 'Conventional transfer is already registered for this floor.' } });
            return true;
          }
          if (reviewed.length) {
            if (proposal !== undefined) {
              sendJson(response, 422, { error: { code: 'DECK_ALREADY_REVIEWED', message: 'This floor uses reviewed conventional slab transfer.' } });
              return true;
            }
            decks.push({ supportingFloorId: floor.id, status: 'ANALYZED_REVIEWED_DECK', slabs: reviewed });
            continue;
          }
          const base = saved.snapshot.system.storeys.find(s => s.id === floor.id)?.elevationMm;
          const owners = building.floors.filter(candidate => candidate.id !== floor.id && base !== undefined &&
            candidate.elevationMm === base + floor.floorHeight);
          const owner = owners.length === 1 ? owners[0] : undefined;
          if (!owner) {
            if (proposal !== undefined || floorReviews.length) {
              sendJson(response, 422, { error: { code: 'SURFACE_OWNERSHIP_REVIEW_REQUIRED', message: 'No unique registered deck surface at this level.' } });
              return true;
            }
            decks.push({ supportingFloorId: floor.id, status: 'SURFACE_OWNERSHIP_REVIEW_REQUIRED' });
            continue;
          }
          const beams = saved.snapshot.system.physicalModel.beams.filter(beam => beam.floorId === floor.id);
          if (response.destroyed) return true;
          const controller = new AbortController();
          const cancel = () => controller.abort();
          response.once('close', cancel);
          const result = await worker.request<PythonWorkerResponseBase & {
            meshReceipt?: PhysicalDeckMeshReceipt;
            automaticMesh?: { regions: AutomaticDeckMeshRegion[]; nextFreeNodeIndex: number; jointRegistry: unknown };
          }>({ action: 'coordinate_deck', floor: owner, supportingFloor: floor,
            registeredSurface: true, beams, ...(!automatic && proposal === undefined ? {} : {
              ...(automatic ? { firstFreeNode, interfaceReviews: floorReviews } : { meshProposal: proposal }),
              frameNodes: saved.snapshot.system.nodes.map(({ index, positionM }) => ({ index, positionM })),
              frameElements: saved.snapshot.system.elements.map(({ id, startNodeIndex, endNodeIndex }) => ({ id, startNodeIndex, endNodeIndex })),
            }) }, undefined, controller.signal).catch((error: unknown) => {
              if (controller.signal.aborted) return undefined;
              throw error;
            }).finally(() => response.off('close', cancel));
          if (result === undefined || response.destroyed) return true;
          if (!result.ok) {
            if (floorReviews.length) {
              sendJson(response, 422, { error: { code: 'INVALID_INTERFACE_REVIEW', floorId: floor.id, message: result.message } });
              return true;
            }
            if (automatic) {
              decks.push({ supportingFloorId: floor.id, status: 'DECK_GEOMETRY_REVIEW_REQUIRED', reason: result.message });
              continue;
            }
            sendJson(response, 422, { error: { code: proposal === undefined ? 'UNSUPPORTED_DECK_GEOMETRY' : 'INVALID_DECK_MESH', floorId: floor.id, message: result.message } });
            return true;
          }
          if (proposal !== undefined) {
            if (!result.meshReceipt) throw new Error('Missing mesh validation receipt from structural worker.');
            sendJson(response, 200, { evaluationId: body.evaluationId, architectureSha256: saved.snapshot.system.sourceArchitecturalSha256,
              structuralRevision: saved.snapshot.system.structuralRevision, supportingFloorId: floor.id,
              surfaceFloorId: owner.id, candidateElevationMm: owner.elevationMm, candidateThicknessMm: owner.slabThicknessMm ?? null,
              concreteGrade: saved.snapshot.system.concreteGrade, meshReceipt: result.meshReceipt });
            return true;
          }
          if (automatic) {
            if (!result.automaticMesh || !isRecord(result.deck)) throw new Error('Missing automatic mesh result.');
            firstFreeNode = result.automaticMesh.nextFreeNodeIndex;
            decks.push({ ...result.deck, automaticMesh: result.automaticMesh.regions, jointRegistry: result.automaticMesh.jointRegistry });
          } else {
            decks.push(result.deck);
          }
        }
        sendJson(response, 200, { evaluationId: body.evaluationId, structuralRevision: saved.snapshot.system.structuralRevision, decks,
          ...(automatic ? { architectureSha256: saved.snapshot.system.sourceArchitecturalSha256,
            meshRegistry: { frameNodeCount, additionalNodeCount: firstFreeNode - frameNodeCount } } : {}) });
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
      const preferredSolverBackend = (body.preferredSolverBackend ?? 'AWATIF_CPP_WASM') as StructuralSolverBackend;
      if (!['AWATIF_CPP_WASM', 'TYPESCRIPT_SPARSE_LU_REFERENCE', 'PYNITE_3D_FRAME', 'PYNITE_PLATE_QUAD', 'PYNITE_PDELTA'].includes(preferredSolverBackend)) {
        sendJson(response, 400, { error: { code: 'INVALID_SOLVER_BACKEND', message: 'Unknown structural solver backend.' } });
        return true;
      }
      const sectionCapacityBackend = (body.sectionCapacityBackend ?? 'RH_IS456_ANALYTICAL') as SectionCapacityBackend;
      if (!['RH_IS456_ANALYTICAL', 'CONCRETE_PROPERTIES_FIBER'].includes(sectionCapacityBackend)) {
        sendJson(response, 400, { error: { code: 'INVALID_SECTION_BACKEND', message: 'Unknown section capacity backend.' } });
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
          preferredSolverBackend,
          sectionCapacityBackend,
          maxIterations,
        });
        const previewOnly = body.previewOnly === true;
        const evaluationId = previewOnly
          ? undefined
          : await saveEvaluation({ snapshot: optimization.after, inputs: parsedInputs, name, analysisOptions: { mode, maxIterations, foundationPreference: foundationPref, preferredSolverBackend, sectionCapacityBackend, targetPhysicalMemberIds, initialSectionOverrides, initialRebarOverrides, initialSlabOverridesMm, initialFootingOverrides } });
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
      const analysisOptions = { foundationPreference: foundationPref, preferredSolverBackend, sectionCapacityBackend };
      if (action === 'analyze' && body.regenerate === true) {
        if (response.destroyed) return true;
        const controller = new AbortController();
        const cancel = () => controller.abort();
        response.once('close', cancel);
        try {
          const result = await engine.regenerateReviewedBuilding({
            building, inputs: parsedInputs, ...analysisOptions, signal: controller.signal,
          });
          if (controller.signal.aborted) return true;
          evaluation = { ...result, inputs: parsedInputs, name, analysisOptions };
        } finally {
          response.off('close', cancel);
        }
      } else {
        const snapshot = await engine.analyzeReviewedBuilding(building, parsedInputs, {
          footingOverrides, preferredSolverBackend, sectionCapacityBackend,
        });
        evaluation = { snapshot, inputs: parsedInputs, name, analysisOptions };
      }
      if (action === 'analyze') {
        const { snapshot, regeneration } = evaluation;
        const lifecycleStatus = snapshot.designLifecycleStatus;
        const carbon4LifecycleStatus = snapshot.carbon4LifecycleStatus ?? lifecycleStatus;
        const evaluationId = await saveEvaluation(evaluation);
        response.setHeader('X-Structural-Evaluation-Id', evaluationId);
        sendJson(response, 200, { evaluationId, lifecycleStatus, carbon4LifecycleStatus, regeneration, disclaimer: MANDATORY_STRUCTURAL_DISCLAIMER, snapshot: summarizeEvaluation(snapshot) });
        return true;
      }
    }

    const { snapshot, inputs, name } = evaluation;
    if (action === 'evaluation') {
      sendJson(response, 200, { evaluationId: body.evaluationId, snapshot: summarizeEvaluation(snapshot), regeneration: evaluation.regeneration });
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

      if (format === 'bbs_csv' || format === 'csv') {
        const csv = exportStructuralBbsCsv(snapshot.detailingAndBoq, {
          projectName: name,
          sourceArchitecturalSha256: revision,
          structuralRevision: snapshot.system.structuralRevision,
          lifecycleStatus: snapshot.carbon4LifecycleStatus ?? snapshot.designLifecycleStatus,
        });
        const buf = Buffer.from(csv, 'utf-8');
        response.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Length': String(buf.length),
          'X-Structural-Source-Revision': revision,
          'X-Structural-Approval-Status': approvalStatus,
          'Content-Disposition': `attachment; filename="${safeName}_structural_bbs.csv"`,
        });
        response.end(buf);
        return true;
      }

      if (format === 'json') {
        const jsonReport = exportStructuralEngineeringJsonReport(snapshot, name, inputs, evaluation.regeneration);
        const buf = Buffer.from(jsonReport, 'utf-8');
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': String(buf.length),
          'X-Structural-Source-Revision': revision,
          'X-Structural-Approval-Status': approvalStatus,
          'Content-Disposition': `attachment; filename="${safeName}_structural_report.json"`,
        });
        response.end(buf);
        return true;
      }
    }

    if (action === 'assistant') {
      const deterministicAnswer = buildDeterministicAssistantAnswer(query, snapshot, inputs, evaluation.solverBackends);
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
    if (response.destroyed) return true;
    if (err instanceof RequestBodyTooLarge) throw err;
    if (err instanceof DeckReviewError) {
      sendJson(response, 422, { error: { code: 'UNSUPPORTED_DECK_REVIEW', message: err.message } });
      return true;
    }
    if (err instanceof UnsupportedStructuralMethodError) {
      sendJson(response, 422, { error: { code: 'UNSUPPORTED_STRUCTURAL_METHOD', message: err.message, method: err.method } });
      return true;
    }
    sendJson(response, 500, {
      error: {
        code: 'STRUCTURAL_ENGINE_ERROR',
        message: err instanceof Error ? err.message : 'Structural engine failure.',
      },
    });
    return true;
  }
}

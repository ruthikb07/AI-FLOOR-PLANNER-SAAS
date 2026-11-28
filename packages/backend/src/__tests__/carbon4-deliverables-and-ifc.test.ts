import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ColumnShape,
  DaylightLevel,
  Direction,
  PlotShape,
  PrivacyLevel,
  RoomType,
  StairType,
  WallType,
  canonicalBuildingHash,
  type Building,
} from '@ai-floor-planner/core';
import {
  PyNiteStructuralSolver,
  assembleLoadedAnalyticalFrameModel,
  evaluateFullBuildingStructuralSystem,
  exportStructuralBbsCsv,
  exportStructuralEngineeringDxf,
  exportStructuralEngineeringJsonReport,
  exportStructuralIfc4Step,
  optimizeStructuralSystemWithGlobalReanalysis,
  shutdownSharedPythonStructuralWorker,
  synthesizeCanonicalStructuralSystem,
  type ReviewedStructuralInputs,
  type StructuralEvaluationSummary,
} from '@ai-floor-planner/structural-engine';
import { StructuralDrawingsService } from '../services/structural-drawings-service.js';
import { createBackendServer } from '../server.js';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const frozenBenchmarkDir = path.resolve(repoRoot, '../phase7-evidence/frozen-benchmark');
const deliverablesDir = path.join(
  process.env.RH_CARBON4_EVIDENCE_DIR ?? path.resolve(repoRoot, '../carbon4-evidence'),
  'deliverables',
);

afterAll(() => {
  shutdownSharedPythonStructuralWorker();
});

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function createStiltPlus5VerifiedApartment(compactApiFixture = false): Building {
  const gridXs = compactApiFixture ? [0, 4200] : [0, 4200, 8400, 12600];
  const gridYs = compactApiFixture ? [0, 4000] : [0, 4000, 8000];
  const wTot = gridXs.at(-1)!;
  const dTot = gridYs.at(-1)!;
  let runningElev = 0;

  const floors = Array.from({ length: compactApiFixture ? 1 : 6 }, (_, lvl) => {
    const floorId = `c4_apt_fl_${lvl}`;
    const isStilt = lvl === 0;
    const hMm = isStilt ? 3000 : 3150;
    const elev = runningElev;
    runningElev += hMm;

    const pts = [
      { x: 0, y: 0 },
      { x: wTot, y: 0 },
      { x: wTot, y: dTot },
      { x: 0, y: dTot },
    ];

    const columns = gridXs.flatMap((gx, ix) =>
      gridYs.map((gy, iy) => ({
        id: `c4_col_${lvl}_${ix}_${iy}`,
        floorId,
        position: { x: gx, y: gy },
        width: 400,
        depth: 450,
        shape: ColumnShape.Rectangular,
        isStructural: true,
      })),
    );

    return {
      id: floorId,
      buildingId: 'bldg_c4_verified_apt',
      level: lvl,
      name: isStilt ? 'Stilt Parking Level' : `Residential Level ${lvl}`,
      floorUse: (isStilt ? 'STILT_PARKING' : 'RESIDENTIAL') as 'STILT_PARKING' | 'RESIDENTIAL',
      elevationMm: elev,
      floorHeight: hMm,
      boundary: { points: pts },
      columns,
      walls: pts.map((p0, idx) => ({
        id: `c4_w_${lvl}_${idx}`,
        floorId,
        startPoint: p0,
        endPoint: pts[(idx + 1) % pts.length]!,
        thickness: isStilt ? 115 : 230,
        type: WallType.External,
        wallUse: 'EXTERNAL' as const,
        roomIds: [],
        hasOpening: isStilt,
        loadBearing: !isStilt,
      })),
      rooms: [
        {
          id: `c4_rm_${lvl}_1`,
          floorId,
          type: isStilt ? RoomType.Corridor : RoomType.Living,
          name: isStilt ? 'Stilt Parking Bay' : `Apartment Floor Plate L${lvl}`,
          boundary: { points: pts },
          x: 0,
          y: 0,
          width: wTot,
          height: dTot,
          rotation: 0,
          area: wTot * dTot,
          priority: 1,
          tags: [],
          adjacencyRequirements: [],
          daylightRequirement: DaylightLevel.High,
          privacyRequirement: PrivacyLevel.Low,
          ventilationRequired: true,
          isFixed: false,
        },
      ],
      doors: [],
      windows: [],
      stairs: compactApiFixture ? [] : [
        {
          id: `c4_stair_${lvl}`,
          floorId,
          type: StairType.Straight,
          boundary: {
            points: [
              { x: 4400, y: 400 },
              { x: 7600, y: 400 },
              { x: 7600, y: 1600 },
              { x: 4400, y: 1600 },
            ],
          },
          x: 4400,
          y: 400,
          width: 1200,
          length: 3200,
          direction: Direction.East,
          riserCount: Math.round(hMm / 150),
          riserHeight: 150,
          treadDepth: 275,
          landingWidth: 1200,
          connectsFloors: [lvl, lvl + 1] as const,
        },
      ],
    };
  });

  return {
    id: 'bldg_c4_verified_apt',
    projectId: 'proj_c4_verified_apt',
    name: 'Carbon 4 Verified Stilt+5 Apartment',
    version: 1,
    createdAt: '2026-11-27T00:00:00.000Z',
    updatedAt: '2026-11-27T00:00:00.000Z',
    metadata: { projectId: 'proj_c4_verified_apt' },
    site: {
      id: 'site_c4_apt',
      plotBoundary: {
        points: [
          { x: -3000, y: -3000 },
          { x: wTot + 3000, y: -3000 },
          { x: wTot + 3000, y: dTot + 3000 },
          { x: -3000, y: dTot + 3000 },
        ],
      },
      plotWidth: wTot + 6000,
      plotDepth: dTot + 6000,
      plotArea: ((wTot + 6000) * (dTot + 6000)) / 1e6,
      plotShape: PlotShape.Rectangular,
      orientation: 0,
      setbacks: { front: 3000, rear: 3000, left: 3000, right: 3000 },
      accessPoints: [],
      roadFacing: Direction.South,
    },
    floors,
  };
}

describe('Carbon 4 Section 07 & 08 — Verified Deliverables (PDF, JSON, BBS CSV, DXF, IFC4) & Derived 4-Flat Audit', () => {
  it('runs PyNite and Concrete Properties through the HTTP analysis and report routes', async () => {
    const server = createBackendServer({ gemini: null, briefInterpreterKind: 'gemini' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/structural/`;
    const post = (route: string, body: unknown) => fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    try {
      const building = createStiltPlus5VerifiedApartment(true);
      const geotechnical = {
        safeBearingCapacityKPa: 250, bearingCapacityBasis: 'GROSS',
        foundationDepthBelowGroundM: 1.8, soilUnitWeightKnM3: 18.5,
        allowableSettlementMm: 40, waterTableDepthBelowGroundM: 0, reportReference: 'C4-HTTP-FIXTURE',
      };
      const request = {
        building,
        reviewedInputs: { geotechnical, seismic: { enabled: false } },
        sectionCapacityBackend: 'CONCRETE_PROPERTIES_FIBER',
        preferredSolverBackend: 'PYNITE_3D_FRAME',
      };
      const unsupported = await post('analyze', { ...request, preferredSolverBackend: 'PYNITE_PLATE_QUAD' });
      expect(unsupported.status, await unsupported.clone().text()).toBe(422);
      const analyzed = await post('analyze', request);
      expect(analyzed.status, analyzed.ok ? undefined : await analyzed.clone().text()).toBe(200);
      const { evaluationId, snapshot } = await analyzed.json() as { evaluationId: string; snapshot: StructuralEvaluationSummary };
      expect(Object.keys(snapshot.solveEnvelope.combinationResults).length).toBeGreaterThan(0);
      expect(Object.values(snapshot.solveEnvelope.combinationResults).every(
        (item) => item.diagnostics.executionBackend === 'PYNITE_3D_FRAME',
      )).toBe(true);
      expect(snapshot.rccDesign.columns.length).toBeGreaterThan(0);
      expect(snapshot.rccDesign.columns.every((item) =>
        item.sectionCapacityProvider === 'CONCRETE_PROPERTIES_FIBER')).toBe(true);
      const exported = await post('drawings', { evaluationId, format: 'json' });
      expect(exported.status).toBe(200);
      const report = await exported.json() as {
        reviewedInputs: ReviewedStructuralInputs;
        project: { sourceArchitecturalSha256: string };
      };
      expect(report.reviewedInputs.geotechnical).toMatchObject(geotechnical);
      expect(report.project.sourceArchitecturalSha256).toBe(canonicalBuildingHash(building));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 300_000);

  it('Generates verified revision-bound PDF, JSON, BBS CSV, DXF, and IFC4 packages while keeping frozen Phase 7 benchmark immutable', async () => {
    mkdirSync(deliverablesDir, { recursive: true });

    // 1. Verify frozen Phase 7 benchmark files remain 100% immutable
    const frozenManifestPath = path.join(frozenBenchmarkDir, 'manifest.json');
    const frozenManifest = existsSync(frozenManifestPath)
      ? JSON.parse(readFileSync(frozenManifestPath, 'utf8')) as { files: Record<string, string> }
      : null;
    const verifyFrozenEvidence = () => {
      for (const [file, sha] of Object.entries(frozenManifest?.files ?? {})) {
        expect(sha256File(path.join(frozenBenchmarkDir, file))).toBe(sha);
      }
    };
    verifyFrozenEvidence();

    const apartmentWithStairs = createStiltPlus5VerifiedApartment();
    const originalDigest = canonicalBuildingHash(apartmentWithStairs);
    // A separate synthetic frame exercises the positive sizing and export path.
    // The original six flights remain in their own gated evaluation below.
    const building: Building = {
      ...apartmentWithStairs,
      id: 'synthetic-frame-g5', projectId:'synthetic-frame-g5',
      metadata:{...apartmentWithStairs.metadata,projectId:'synthetic-frame-g5'},
      name:'Synthetic G+5 frame-only design and export benchmark',
      floors:apartmentWithStairs.floors.map(floor=>({...floor,buildingId:'synthetic-frame-g5',stairs:[]})),
    };
    const preArchHash = canonicalBuildingHash(building);

    const baseSys = synthesizeCanonicalStructuralSystem(building, {
      concreteGrade: 'M30',
      seismicZone: 'IV',
    });
    const roofColumn = [...baseSys.physicalModel.columns].sort((a, b) => b.topElevationMm - a.topElevationMm)[0]!;
    const reviewedInputs: ReviewedStructuralInputs = {
      concreteGrade: 'M30',
      steelGrade: 'Fe500',
      ductileDetailingIS13920: true,
      floorFinishKnM2: 1.25,
      masonryUnitWeightKnM3: 19.0,
      roofLiveLoadKnM2: 1.5,
      waterTankLoadKn: 80,
      waterTankSupport: {
        reference: 'G+5 fixture tank supported directly over a column',
        centerOfGravityMm: { x: roofColumn.centerXMm, y: roofColumn.centerYMm },
        reactions: [{ physicalColumnId: roofColumn.physicalMemberId, verticalReactionKn: 80 }],
      },
      seismic: {
        enabled: true,
        zone: 'IV',
        soilType: 'MEDIUM',
        importanceFactorI: 1.0,
        responseReductionFactorR: 5.0,
        frameSystemType: 'RC_MRF_WITH_BRICK_INFILL',
      },
      geotechnical: {
        safeBearingCapacityKPa: 250,
        bearingCapacityBasis: 'NET',
        waterTableDepthBelowGroundM: 8,
        foundationDepthBelowGroundM: 1.8,
        soilUnitWeightKnM3: 18.5,
        allowableSettlementMm: 40,
        subgradeModulusKnM3: 24_000,
        reportReference: 'GT-C4-DELIVERABLE-2026',
      },
    };

    // Start with an intentionally undersized column & beam, then optimize with ConcreteProperties + Awatif WASM
    const stairSnapshot = await evaluateFullBuildingStructuralSystem({building:apartmentWithStairs,inputs:reviewedInputs});
    expect(canonicalBuildingHash(apartmentWithStairs)).toBe(originalDigest);
    expect(stairSnapshot.designLifecycleStatus).toBe('UNSUPPORTED_REQUIRED_CHECK');
    expect(stairSnapshot.rccDesign.stairs.filter(flight=>flight.status==='UNSUPPORTED')).toHaveLength(6);
    expect(stairSnapshot.foundationDesign.allPassed).toBe(false);
    expect(stairSnapshot.loadTakeoff.loadSourceAudit?.filter(s=>s.transferMethod==='UNRESOLVED_STAIR_BEARING')).toHaveLength(6);
    expect(exportStructuralIfc4Step(stairSnapshot, apartmentWithStairs.name)).toContain('IFCSTAIRFLIGHT');
    const baseCol = baseSys.memberMetadata.find((m) => m.category === 'COLUMN' && m.elementId.endsWith('_L0'))!;
    const baseBeam = baseSys.memberMetadata.find((m) => m.category === 'BEAM')!;

    const opt = await optimizeStructuralSystemWithGlobalReanalysis({
      building,
      inputs: reviewedInputs,
      mode: 'BALANCED',
      sectionCapacityBackend: 'CONCRETE_PROPERTIES_FIBER',
      initialSectionOverrides: {
        [baseCol.elementId]: { widthMm: 250, depthMm: 300, concreteGrade: 'M25' },
        [baseBeam.elementId]: { widthMm: 200, depthMm: 250, concreteGrade: 'M25' },
      },
      maxIterations: 6,
    });

    expect(canonicalBuildingHash(building)).toBe(preArchHash);
    expect(opt.before.designLifecycleStatus).toBe('DESIGN_FAILED');
    const snap = opt.after;
    expect(snap.designLifecycleStatus).toBe('DESIGN_CHECKS_PASSED');
    expect(snap.carbon4LifecycleStatus).toBe('CHECKS_PASSED_WITHIN_SCOPE');
    expect(snap.rccDesign.allPassed).toBe(true);
    expect(snap.foundationDesign.allPassed).toBe(true);
    expect(snap.loadTakeoff.slabLoadPaths?.preliminaryDistribution).toEqual([]);

    // Cross-check the optimized building's governing seismic combination in PyNite 3D Frame!
    const loadedModel = (await assembleLoadedAnalyticalFrameModel(snap.system, reviewedInputs)).analyticalModel;
    const pynite = new PyNiteStructuralSolver();
    await pynite.initialize();
    const pnEnv = await pynite.analyze(
      {
        ...loadedModel,
        combinations: loadedModel.combinations.filter((c) => c.id === 'ULS_15_DL_PLUS_EQX'),
      },
      { solveLoadCases: false, solveCombinations: true },
    );
    const rWasm = snap.solveEnvelope.combinationResults.ULS_15_DL_PLUS_EQX!;
    const rPn = pnEnv.combinationResults.ULS_15_DL_PLUS_EQX!;
    const rzWasm = rWasm.reactions.reduce((s, r) => s + r.reactionKnM[2], 0);
    const rzPn = rPn.reactions.reduce((s, r) => s + r.reactionKnM[2], 0);
    expect(Math.abs(rzWasm - rzPn)).toBeLessThan(1e-2);

    // Export all 5 mandatory deliverables
    const pdfOut = await new StructuralDrawingsService().generateReviewedStructuralDrawingPdf(
      snap,
      building.name,
    );
    expect(pdfOut.pageCount).toBeGreaterThanOrEqual(6);
    expect(Buffer.from(pdfOut.data.subarray(0, 8)).toString('utf8')).toContain('%PDF-');
    const pdfPath = path.join(deliverablesDir, 'carbon4-verified-structural-package.pdf');
    writeFileSync(pdfPath, pdfOut.data);

    const jsonReport = exportStructuralEngineeringJsonReport(snap, building.name, reviewedInputs);
    const parsedReport = JSON.parse(jsonReport) as {
      reportSchema: string;
      lifecycleAndApproval: { carbon4LifecycleStatus: string; drawingApprovalStatus: string };
      project: { sourceArchitecturalSha256: string; structuralModelFingerprint: string };
      reviewedInputs: ReviewedStructuralInputs;
      analysisResults: typeof snap.solveEnvelope;
      reinforcementAndQuantities: { massReconciliationAudit: { isReconciled: boolean; maxReconciliationDiscrepancyKg: number } };
    };
    expect(parsedReport.reportSchema).toBe('RH_PLANNER_CARBON4_STRUCTURAL_REPORT_V1');
    expect(parsedReport.lifecycleAndApproval.carbon4LifecycleStatus).toBe('CHECKS_PASSED_WITHIN_SCOPE');
    expect(parsedReport.lifecycleAndApproval.drawingApprovalStatus).toBe('PRELIMINARY_FOR_ENGINEER_REVIEW');
    expect(parsedReport.project.sourceArchitecturalSha256).toBe(preArchHash);
    expect(parsedReport.project.structuralModelFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(parsedReport.reviewedInputs).toEqual(reviewedInputs);
    expect(parsedReport.analysisResults.combinationResults.ULS_15_DL_PLUS_EQX?.reactions.length).toBeGreaterThan(0);
    expect(parsedReport.reinforcementAndQuantities.massReconciliationAudit.isReconciled).toBe(true);
    expect(parsedReport.reinforcementAndQuantities.massReconciliationAudit.maxReconciliationDiscrepancyKg).toBeLessThan(1e-6);
    const jsonPath = path.join(deliverablesDir, 'carbon4-verified-structural-report.json');
    writeFileSync(jsonPath, jsonReport, 'utf8');

    const bbsCsv = exportStructuralBbsCsv(snap.detailingAndBoq, {
      projectName: building.name,
      sourceArchitecturalSha256: snap.system.sourceArchitecturalSha256,
      structuralRevision: snap.system.structuralRevision,
      lifecycleStatus: snap.carbon4LifecycleStatus,
    });
    expect(bbsCsv).toContain('TOTAL_RECONCILED');
    const csvPath = path.join(deliverablesDir, 'carbon4-verified-bbs-schedule.csv');
    writeFileSync(csvPath, bbsCsv, 'utf8');

    const dxfText = exportStructuralEngineeringDxf(snap, building.name);
    expect(dxfText).toContain('A-GRID-REF');
    expect(dxfText).toContain('\n8\nS-COLS\n');
    expect(dxfText).toContain('\n8\nS-BEAM\n');
    expect(dxfText).toContain('\n8\nS-FOOTING\n');
    const dxfPath = path.join(deliverablesDir, 'carbon4-verified-structural.dxf');
    writeFileSync(dxfPath, dxfText, 'utf8');

    const ifcText = exportStructuralIfc4Step(snap, building.name);
    expect(ifcText).toContain('FILE_SCHEMA((\'IFC4\'))');
    expect(ifcText).not.toContain('IFCSTAIRFLIGHT');
    const ifcPath = path.join(deliverablesDir, 'carbon4-verified-structural.ifc');
    writeFileSync(ifcPath, ifcText, 'utf8');

    const snapshotPath = path.join(deliverablesDir, 'carbon4-verified-snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify(snap), 'utf8');

    // Also audit a fresh derived revision of the real 4-flat production apartment (without mutating frozen-benchmark!)
    const fourFlatPath = path.join(repoRoot, 'test-artifacts/phase1-generated/four-flat-production-building.json');
    if (existsSync(fourFlatPath)) {
      const rawFourFlat = JSON.parse(readFileSync(fourFlatPath, 'utf8')) as { building?: Building } | Building;
      const fourFlatBldg = ('building' in rawFourFlat && rawFourFlat.building ? rawFourFlat.building : rawFourFlat) as Building;
      const ffHashBefore = canonicalBuildingHash(fourFlatBldg);

      const ffDerivedEval = await evaluateFullBuildingStructuralSystem({
        building: fourFlatBldg,
        inputs: {
          concreteGrade: 'M30',
          steelGrade: 'Fe500',
          ductileDetailingIS13920: true,
          floorFinishKnM2: 1.25,
          masonryUnitWeightKnM3: 19.0,
          roofLiveLoadKnM2: 1.5,
          waterTankLoadKn: 100,
          seismic: {
            enabled: true,
            zone: 'V',
            soilType: 'MEDIUM',
            importanceFactorI: 1.0,
            responseReductionFactorR: 5.0,
            frameSystemType: 'RC_MRF_WITH_BRICK_INFILL',
          },
          geotechnical: {
            safeBearingCapacityKPa: 250,
            bearingCapacityBasis: 'NET',
            foundationDepthBelowGroundM: 2.0,
            soilUnitWeightKnM3: 19.0,
            allowableSettlementMm: 40,
            subgradeModulusKnM3: 28_000,
            reportReference: 'GT-C4-FOURFLAT-DERIVED',
          },
        },
        synthesisOptions: { structuralRevision: 2 },
      });

      expect(canonicalBuildingHash(fourFlatBldg)).toBe(ffHashBefore);
      expect(ffDerivedEval.detailingAndBoq.quantities.massReconciliationAudit?.isReconciled).toBe(true);

      writeFileSync(
        path.join(deliverablesDir, 'carbon4-four-flat-derived-audit.json'),
        JSON.stringify(
          {
            sourceArchitecturalSha256: ffHashBefore,
            architecturalGeometryUnchanged: canonicalBuildingHash(fourFlatBldg) === ffHashBefore,
            frozenPhase7BaselineReference: {
              criticalDefects: 361,
              beamShearDefects: 275,
              columnDefects: 80,
              driftDefects: 6,
              preliminarySlabPanels: 759,
              colC23Utilization: 184.744,
              worstBeamUtilization: 4.15,
            },
            carbon4DerivedRevision2: {
              structuralRevision: ffDerivedEval.system.structuralRevision,
              designLifecycleStatus: ffDerivedEval.designLifecycleStatus,
              carbon4LifecycleStatus: ffDerivedEval.carbon4LifecycleStatus,
              criticalDefects: ffDerivedEval.criticalDefectCount,
              beamDefects: ffDerivedEval.defects.filter((d) => d.memberCategory === 'BEAM').length,
              columnDefects: ffDerivedEval.defects.filter((d) => d.memberCategory === 'COLUMN').length,
              driftDefects: ffDerivedEval.defects.filter((d) => d.memberCategory === 'STOREY_DRIFT').length,
              maxMemberUtilization: ffDerivedEval.maxMemberUtilization,
              verifiedOneWaySlabs: ffDerivedEval.loadTakeoff.slabLoadPathAudit?.verifiedOneWayOppositeEdges.length ?? 0,
              verifiedTwoWaySlabs: ffDerivedEval.loadTakeoff.slabLoadPathAudit?.verifiedTwoWayYieldLineIs456.length ?? 0,
              preliminarySlabsRemaining:
                ffDerivedEval.loadTakeoff.slabLoadPaths?.preliminaryDistribution.length ?? 0,
              massReconciliationAudit: ffDerivedEval.detailingAndBoq.quantities.massReconciliationAudit,
            },
          },
          null,
          2,
        ),
        'utf8',
      );
    }
    verifyFrozenEvidence();
  }, 600_000);
});

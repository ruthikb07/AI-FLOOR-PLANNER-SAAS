import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AwatifStructuralSolver,
  assembleLoadedAnalyticalFrameModel,
  detectStructuralDefects,
  evaluateStoreyDrifts,
  optimizeStructuralSystemWithGlobalReanalysis,
  regenerateStructuralDesign,
  runCompleteRccDesign,
  runFoundationDesign,
} from '../index.js';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const frozenDir = path.resolve(repoRoot, '../phase7-evidence/frozen-benchmark');
const carbonEvidenceDir = process.env.RH_CARBON4_EVIDENCE_DIR ?? path.resolve(repoRoot, '../carbon4-evidence');

const sha256 = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

describe.skipIf(!existsSync(path.join(frozenDir, 'manifest.json')))(
  'Carbon 4 Gate 01 — Frozen Phase 7 Baseline Reproduction (Unmodified Inputs & Model)',
  () => {
    it('blocks automatic sizing of the frozen project until its gravity transfer is complete', async () => {
      const building = JSON.parse(readFileSync(path.join(frozenDir, 'architecture.json'), 'utf8'));
      const inputs = JSON.parse(readFileSync(path.join(frozenDir, 'reviewed-inputs.json'), 'utf8'));
      const manifest = JSON.parse(readFileSync(path.join(frozenDir, 'manifest.json'), 'utf8'));
      const { snapshot, regeneration } = await regenerateStructuralDesign({ building, inputs });

      expect(regeneration).toMatchObject({ status: 'UNSUPPORTED', revisionsAnalyzed: 1 });
      expect(regeneration.remainingFindings).toBe(snapshot.criticalDefectCount);
      expect(regeneration.blockers).toContainEqual(expect.stringContaining('slab load paths'));
      expect(regeneration.selectedStructuralRevision).toBe(snapshot.system.structuralRevision);
      expect(snapshot.system.sourceArchitecturalSha256).toBe(manifest.canonicalArchitecturalDigest);
      const paths = snapshot.loadTakeoff.slabLoadPaths!;
      expect(paths.oneWayEdgeSupported.length + paths.preliminaryDistribution.length + paths.missingSupport.length)
        .toBe(snapshot.system.slabPanels.length);
      expect(snapshot.loadTakeoff.unassignedGravityKnByCase!.DL).toBeGreaterThan(0);
      expect(snapshot.loadTakeoff.loadSourceAudit?.filter(record => record.transferMethod === 'UNRESOLVED_SLAB_SUPPORT')
        .every(record => record.receivingElementIds.length === 0)).toBe(true);

      const manual = await optimizeStructuralSystemWithGlobalReanalysis({ building, inputs, maxIterations: 4 });
      expect(manual.status).toBe('UNSUPPORTED_SCOPE');
      expect(manual.iterations).toEqual([]);
      expect(manual.architecturalGeometryProtected).toBe(true);
    }, 90_000);

    it('reproduces exact frozen 422-node / 744-element / 361-finding / COL_C23_L0=184.744 baseline', async () => {
      mkdirSync(carbonEvidenceDir, { recursive: true });
      const manifest = JSON.parse(readFileSync(path.join(frozenDir, 'manifest.json'), 'utf8'));
      for (const [name, expectedHash] of Object.entries(manifest.files as Record<string, string>)) {
        const actual = sha256(readFileSync(path.join(frozenDir, name)));
        expect(actual, `Frozen file ${name} digest`).toBe(expectedHash);
      }

      const wasmPath = path.resolve(repoRoot, 'packages/structural-engine/src/wasm/lSolver.wasm');
      const wasmSha = sha256(readFileSync(wasmPath));
      expect(wasmSha).toBe(manifest.solver.sha256);

      const system = JSON.parse(readFileSync(path.join(frozenDir, 'structural-system.json'), 'utf8'));
      const frozenAnalytical = JSON.parse(readFileSync(path.join(frozenDir, 'analytical-model.json'), 'utf8'));
      const inputs = JSON.parse(readFileSync(path.join(frozenDir, 'reviewed-inputs.json'), 'utf8'));

      const solver = new AwatifStructuralSolver();
      await solver.initialize();

      const envelope = await solver.analyze(frozenAnalytical, { preferredBackend: 'AWATIF_CPP_WASM' });
      const drifts = evaluateStoreyDrifts(system, envelope);
      const rcc = runCompleteRccDesign(system, inputs, envelope);
      const raft = runFoundationDesign(system, inputs, envelope);
      const defects = detectStructuralDefects({
        system,
        storeyDriftChecks: drifts,
        rccDesign: rcc,
        foundationDesign: raft,
      });

      const colC23 = rcc.columns.find((c) => c.elementId === 'COL_C23_L0')!;
      const worstBeam = [...rcc.beams].sort((a, b) => b.maxUtilization - a.maxUtilization)[0]!;
      const majorOrCritical = defects.filter((d) => d.severity === 'CRITICAL' || d.severity === 'MAJOR');
      const beamFails = rcc.beams.filter((b) => b.status === 'FAILED').length;
      const colFails = rcc.columns.filter((c) => c.status === 'FAILED').length;
      const driftFails = drifts.filter((d) => !d.isCompliant).length;

      expect(frozenAnalytical.nodes.length).toBe(422);
      expect(frozenAnalytical.elements.length).toBe(744);
      expect(Object.keys(envelope.loadCaseResults).length).toBe(7);
      expect(Object.keys(envelope.combinationResults).length).toBe(30);
      expect(
        Object.values(envelope.combinationResults).every(
          (c) => c.diagnostics.executionBackend === 'AWATIF_CPP_WASM',
        ),
      ).toBe(true);

      expect(beamFails).toBe(275);
      expect(colFails).toBe(80);
      expect(driftFails).toBe(6);
      expect(majorOrCritical.length).toBe(361);
      expect(colC23.biaxialInteractionRatio).toBe(184.744);
      expect(worstBeam.maxUtilization).toBe(4.15);
      expect(raft.footings[0]!.maxSoilPressureKPa).toBeCloseTo(75.52, 2);
      expect(raft.footings[0]!.grossMaxSoilPressureKPa).toBeCloseTo(108.82, 2);

      // Verify frozen system has 759 slab panels (all 759 were preliminary in Phase 7 with 0 exact one-way matches)
      expect(system.slabPanels.length).toBe(759);
      const currentLoadCheck = await assembleLoadedAnalyticalFrameModel(system, inputs, solver);

      const snapshotRecord = {
        reproducedAt: new Date().toISOString(),
        canonicalArchitecturalDigest: manifest.canonicalArchitecturalDigest,
        wasmSha256: wasmSha,
        nodes: frozenAnalytical.nodes.length,
        elements: frozenAnalytical.elements.length,
        loadCases: Object.keys(envelope.loadCaseResults).length,
        combinations: Object.keys(envelope.combinationResults).length,
        findings: {
          totalMajorCritical: majorOrCritical.length,
          beamShearFailures: beamFails,
          columnFailures: colFails,
          driftFailures: driftFails,
        },
        colC23L0: {
          sectionMm: `${colC23.widthMm}x${colC23.depthMm}`,
          bars: colC23.longitudinalBars.label,
          governingCombo: colC23.governingComboId,
          demandPuKn: colC23.demandPuKn,
          demandMuxKnM: colC23.designMuxWithEccentricityAndSlendernessKnM,
          demandMuyKnM: colC23.designMuyWithEccentricityAndSlendernessKnM,
          capacityMux1KnM: colC23.capacityMux1AtPuKnM,
          capacityMuy1KnM: colC23.capacityMuy1AtPuKnM,
          biaxialInteractionRatio: colC23.biaxialInteractionRatio,
        },
        worstBeam: {
          id: worstBeam.elementId,
          sectionMm: `${worstBeam.widthMm}x${worstBeam.depthMm}`,
          governingCombo: worstBeam.governingComboId,
          maxUtilization: worstBeam.maxUtilization,
          nominalShearMPa: worstBeam.nominalShearStressMPa,
          tauCMaxMPa: worstBeam.maxShearLimitTauCMaxMPa,
        },
        frozenSlabPanelCount: system.slabPanels.length,
        activeAssemblerSlabLoadPaths: currentLoadCheck.loadTakeoff.slabLoadPaths,
        raft: {
          status: raft.status,
          governingSlsCombo: raft.footings[0]!.governingSlsComboId,
          netPeakKPa: raft.footings[0]!.maxSoilPressureKPa,
          grossPeakKPa: raft.footings[0]!.grossMaxSoilPressureKPa,
        },
      };

      writeFileSync(
        path.join(carbonEvidenceDir, 'frozen-phase7-reproduction.json'),
        JSON.stringify(snapshotRecord, null, 2),
      );
    }, 60_000);
  },
);

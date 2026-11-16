import { describe, expect, it } from 'vitest';
import { Direction, DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES, type MultiSheetApartmentConfig } from '@ai-floor-planner/core';
import { solveMultiSheetApartmentProject } from '../apartment/multi-sheet-apartment-solver';
import { executeAuditedPlanningPipeline } from '../pipeline/stage-progress-emitter';
import { generateDesignConcepts } from '../topology/generative-topology-engine';
import { createGenerationReport } from '../apartment/generation-report';
import { generateApartmentOutcome } from '../apartment/generation-outcome';

const config = (width = 18400, depth = 22500): MultiSheetApartmentConfig => ({
  projectId: 'livability-phase1', plotWidthMm: width, plotDepthMm: depth, roadWidthMm: 12000,
  roadAccessSides: [Direction.North], lotAllotmentMode: 'FULL_LOT_100_PERCENT', jurisdiction: 'generic_maharashtra',
  verticalStackType: 'G_PLUS_N', numTypicalFloors: 1, flatsPerFloor: 2,
  units: [{ unitIndex: 1, bhkType: '3BHK', hasUtilityBalcony: true }, { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: true }],
  siteAmenities: DEFAULT_SITE_AMENITIES, stiltAmenities: DEFAULT_STILT_AMENITIES,
  terraceAmenities: DEFAULT_TERRACE_AMENITIES, parkingMode: 'STILT_AND_SURFACE', structuralLayoutMode: 'DEFERRED',
});

describe('Phase 1 best effort without false acceptance', () => {
  it('retains failed candidates separately from accepted concepts', () => {
    // Test that when failed candidates exist, bestEffort is retained separately from accepted concepts
    for (const env of [
      { w: 18400, h: 22500, flats: 2 as const, units: ['3BHK', '3BHK'] as const },
      { w: 20000, h: 25000, flats: 4 as const, units: ['4BHK', '4BHK', '4BHK', '4BHK'] as const },
      { w: 15000, h: 20000, flats: 3 as const, units: ['3BHK', '3BHK', '3BHK'] as const },
    ]) {
      const res = generateDesignConcepts({ envelope: { x: 0, y: 0, w: env.w, h: env.h },
        flatsPerFloor: env.flats, unitTypes: env.units as any, maxCandidates: 24 });
      if (res.bestEffort) {
        console.log('FOUND BEST EFFORT ON:', env);
        expect(res.concepts.every(c => c.score.feasible)).toBe(true);
        expect(res.bestEffort.score.feasible).toBe(false);
        expect(res.bestEffort.score.hardConstraints.some(c => !c.satisfied)).toBe(true);
        break;
      }
    }
    const result = generateDesignConcepts({ envelope: { x: 0, y: 0, w: 18400, h: 22500 },
      flatsPerFloor: 2, unitTypes: ['3BHK', '3BHK'], maxCandidates: 24 });
    expect(result.concepts.every(c => c.score.feasible)).toBe(true);
    if (result.bestEffort) {
      expect(result.bestEffort.score.feasible).toBe(false);
      expect(result.bestEffort.score.hardConstraints.some(c => !c.satisfied)).toBe(true);
    }
    expect(result.diagnostics.assembledCandidates).toBeLessThanOrEqual(24);
  });

  it('compares the repaired candidate and reports the safer fallback with ranked findings', () => {
    const result = solveMultiSheetApartmentProject(config(), undefined, { legacyOnly: true });
    const report = result.generationReport!;
    expect(report).toEqual(result.building.metadata.generationReport);
    expect(report.strategy).toBe('LEGACY_FALLBACK');
    expect(report.status).toBe('BEST_EFFORT');
    expect(report.professionalReviewRequired).toBe(true);
    expect(report.violations.some(v => v.code === 'LEGACY_FALLBACK_USED')).toBe(true);
    expect(report.violations.map(v => v.rank)).toEqual(report.violations.map((_, i) => i + 1));
    const firstWarning = report.violations.findIndex(v => v.severity === 'WARNING');
    if (firstWarning >= 0) expect(report.violations.slice(firstWarning).every(v => v.severity === 'WARNING')).toBe(true);

    // A bathroom with no windows cannot pass because it happens to align with a shaft.
    const stripped = { ...result.building, floors: result.building.floors.map(f => ({ ...f, windows: [] })) };
    const audited = createGenerationReport(stripped, result.validationReport!, report);
    expect(audited.violations.some(v => v.code === 'BATHROOM_OPENING_MISSING')).toBe(true);
    expect(audited.status).toBe('BEST_EFFORT');
  }, 60000);

  it('distinguishes malformed inputs, empty envelopes and engine limits without silently changing the request', () => {
    expect(generateApartmentOutcome({ ...config(), plotWidthMm: NaN }).status).toBe('INVALID_INPUT');
    const tightPlot = { ...config(6000, 6000) };
    const outcome = generateApartmentOutcome(tightPlot);
    expect(outcome.status).toBe('SEARCH_EXHAUSTED');
    if (outcome.status !== 'PLAN') {
      expect(outcome.alternative).toBeDefined();
      expect(outcome.alternativeChanges.length).toBeGreaterThan(0);
    }
    const empty = generateApartmentOutcome({ ...config(), lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
      setbacksMm: { left: 10000, right: 10000, front: 0, rear: 0 } });
    expect(empty.status).toBe('INFEASIBLE');
  }, 60000);

  it('keeps the generated building when the pipeline finds invalid geometry', async () => {
    const result = await executeAuditedPlanningPipeline(config(18288, 24384));
    expect(result.building.floors.length).toBeGreaterThan(0);
    expect(result.building.metadata.generationReport).toBeDefined();
    if (!result.validationReport.isValid) {
      expect(result.building.metadata.generationReport!.status).toBe('BEST_EFFORT');
      expect(result.building.metadata.generationReport!.violations.some(v => v.severity === 'CRITICAL')).toBe(true);
    }
  }, 60000);
});

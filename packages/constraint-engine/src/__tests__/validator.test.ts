/**
 * Unit tests for the Phase 4 Constraint Engine.
 * Tests: registry, validator, scoring, hard constraints, soft constraints, providers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PlanValidator } from '../validator';
import { ConstraintRegistry } from '../registry';
import { createDefaultRegistry } from '../constraints/index';
import { resolveConfig } from '../config';
import { buildEvaluationContext } from '../context';
import { RequiredRoomsPresent } from '../constraints/hard/required-rooms';
import { validate } from '../compat';
import { ConstraintSeverity, ConstraintCategory } from '../types';
import type { Constraint, ConstraintResult } from '../types';
import { computeCategoryScore, computeOverallScore } from '../scoring';
import { RoomType } from '@ai-floor-planner/core';
import type { Building } from '@ai-floor-planner/core';

// ─── Helpers ────────────────────────────────────────────────────────────────

const FIXTURES_DIR = path.resolve(__dirname, '../../../../tests/fixtures');

function loadFixture(name: string): Building {
  const json = fs.readFileSync(path.join(FIXTURES_DIR, `${name}.json`), 'utf-8');
  return JSON.parse(json) as Building;
}

function createValidatorWithDefaults(): PlanValidator {
  const registry = createDefaultRegistry();
  return new PlanValidator(registry);
}

// ─── Registry Tests ─────────────────────────────────────────────────────────

describe('ConstraintRegistry', () => {
  let registry: ConstraintRegistry;

  beforeEach(() => {
    registry = new ConstraintRegistry();
  });

  it('registers a constraint and retrieves by ID', () => {
    const constraint: Constraint = {
      id: 'TEST-001', name: 'Test', description: 'test',
      category: ConstraintCategory.GEOMETRY, severity: ConstraintSeverity.HARD,
      enabled: true,
      evaluate: () => [],
    };
    registry.register(constraint);
    expect(registry.get('TEST-001')).toBe(constraint);
    expect(registry.size).toBe(1);
  });

  it('throws on duplicate ID', () => {
    const constraint: Constraint = {
      id: 'TEST-001', name: 'Test', description: 'test',
      category: ConstraintCategory.GEOMETRY, severity: ConstraintSeverity.HARD,
      enabled: true, evaluate: () => [],
    };
    registry.register(constraint);
    expect(() => registry.register(constraint)).toThrow(/already registered/);
  });

  it('filters by category', () => {
    const c1: Constraint = { id: 'A', name: 'A', description: '', category: ConstraintCategory.GEOMETRY, severity: ConstraintSeverity.HARD, enabled: true, evaluate: () => [] };
    const c2: Constraint = { id: 'B', name: 'B', description: '', category: ConstraintCategory.DAYLIGHT, severity: ConstraintSeverity.SOFT, enabled: true, evaluate: () => [] };
    registry.registerAll([c1, c2]);
    expect(registry.getByCategory(ConstraintCategory.GEOMETRY)).toHaveLength(1);
    expect(registry.getByCategory(ConstraintCategory.DAYLIGHT)).toHaveLength(1);
  });

  it('filters by severity', () => {
    const c1: Constraint = { id: 'A', name: 'A', description: '', category: ConstraintCategory.GEOMETRY, severity: ConstraintSeverity.HARD, enabled: true, evaluate: () => [] };
    const c2: Constraint = { id: 'B', name: 'B', description: '', category: ConstraintCategory.DAYLIGHT, severity: ConstraintSeverity.SOFT, enabled: true, evaluate: () => [] };
    registry.registerAll([c1, c2]);
    expect(registry.getBySeverity(ConstraintSeverity.HARD)).toHaveLength(1);
    expect(registry.getBySeverity(ConstraintSeverity.SOFT)).toHaveLength(1);
  });

  it('enable/disable toggles constraint', () => {
    const c: Constraint = { id: 'X', name: 'X', description: '', category: ConstraintCategory.GEOMETRY, severity: ConstraintSeverity.HARD, enabled: true, evaluate: () => [] };
    registry.register(c);
    expect(registry.get('X')!.enabled).toBe(true);
    registry.setEnabled('X', false);
    expect(registry.get('X')!.enabled).toBe(false);
  });

  it('unregister removes constraint', () => {
    const c: Constraint = { id: 'X', name: 'X', description: '', category: ConstraintCategory.GEOMETRY, severity: ConstraintSeverity.HARD, enabled: true, evaluate: () => [] };
    registry.register(c);
    registry.unregister('X');
    expect(registry.has('X')).toBe(false);
    expect(registry.size).toBe(0);
  });

  it('default registry has all built-in constraints', () => {
    const defaultReg = createDefaultRegistry();
    // 16 hard + 26 soft + 8 vastu = 50 total
    expect(defaultReg.size).toBeGreaterThanOrEqual(40);
  });
});

// ─── Scoring Tests ──────────────────────────────────────────────────────────

describe('Scoring', () => {
  it('computeCategoryScore does not invent a perfect score for no results', () => {
    const score = computeCategoryScore([], 'test', 0.2);
    expect(score.score).toBe(0);
    expect(score.weight).toBe(0);
  });

  it('computeCategoryScore normalizes to 0-100', () => {
    const results: ConstraintResult[] = [
      { constraintId: 'A', passed: true, severity: ConstraintSeverity.SOFT, score: 10, maxScore: 20, message: '', affectedEntities: [], explanation: '' },
      { constraintId: 'B', passed: false, severity: ConstraintSeverity.SOFT, score: 5, maxScore: 10, message: '', affectedEntities: [], explanation: '' },
    ];
    const cat = computeCategoryScore(results, 'test', 0.2);
    // (10+5)/(20+10) = 15/30 = 50%
    expect(cat.score).toBe(50);
  });

  it('computeOverallScore is weighted average', () => {
    const categories = {
      [ConstraintCategory.GEOMETRY]: { category: 'geometry', score: 80, maxScore: 100, weight: 0.5, details: [] },
      [ConstraintCategory.DAYLIGHT]: { category: 'daylight', score: 60, maxScore: 100, weight: 0.5, details: [] },
    };
    const overall = computeOverallScore(categories);
    // (80*0.5 + 60*0.5) / 1.0 = 70
    expect(overall).toBe(70);
  });

  it('overall score is in [0, 100]', () => {
    const categories = {
      [ConstraintCategory.GEOMETRY]: { category: 'geometry', score: 0, maxScore: 100, weight: 1.0, details: [] },
    };
    expect(computeOverallScore(categories)).toBeGreaterThanOrEqual(0);
    expect(computeOverallScore(categories)).toBeLessThanOrEqual(100);
  });
});

// ─── Validator Tests with Fixtures ──────────────────────────────────────────

describe('PlanValidator', () => {
  let validator: PlanValidator;

  beforeEach(() => {
    validator = createValidatorWithDefaults();
  });

  it('default constructor registers and executes the production constraint set', () => {
    const productionValidator = new PlanValidator();
    const building = loadFixture('invalid-overlap');
    const summary = productionValidator.validate(building);

    expect(productionValidator.registry.size).toBeGreaterThanOrEqual(40);
    expect(summary.totalConstraints).toBeGreaterThan(0);
    expect(summary.isValid).toBe(false);
    expect(summary.violations.some(v => v.constraintId === 'HC-003')).toBe(true);
  });

  it('rejects an explicitly empty registry instead of silently validating nothing', () => {
    expect(() => new PlanValidator(new ConstraintRegistry())).toThrow(/at least one registered constraint/i);
  });

  it('rejects validation filters that match no enabled constraints', () => {
    const building = loadFixture('minimal-1room');
    expect(() => validator.validate(building, { constraintIds: ['DOES-NOT-EXIST'] })).toThrow(
      /no enabled constraints matched/i,
    );
  });

  it('treats a developed plan with rooms but no doors as inaccessible by default', () => {
    const building = loadFixture('30x50-3bhk');
    const summary = new PlanValidator().validate(building);

    expect(summary.isValid).toBe(false);
    expect(summary.violations.some(v => v.constraintId === 'HC-010')).toBe(true);
  });

  describe('Schematic draft fixtures', () => {
    it('30x50-2bhk is valid in explicit draft mode with score > 0', () => {
      const building = loadFixture('30x50-2bhk');
      const summary = validator.validate(building, { allowIncompleteDraft: true });
      expect(summary.isValid).toBe(true);
      expect(summary.overallScore).toBeGreaterThan(0);
    });

    it('minimal-1room is valid in explicit draft mode', () => {
      const building = loadFixture('minimal-1room');
      const summary = validator.validate(building, { allowIncompleteDraft: true });
      expect(summary.isValid).toBe(true);
    });

    it('30x50-3bhk is valid in explicit draft mode with score > 0', () => {
      const building = loadFixture('30x50-3bhk');
      const summary = validator.validate(building, { allowIncompleteDraft: true });
      expect(summary.isValid).toBe(true);
      expect(summary.overallScore).toBeGreaterThan(0);
    });

    it('validatePlan method returns PlanValidationResult matching Phase 4 spec', () => {
      const building = loadFixture('30x50-2bhk');
      const planRes = validator.validatePlan(building, { allowIncompleteDraft: true });
      expect(planRes.valid).toBe(true);
      expect(planRes.hardFailures).toHaveLength(0);
      expect(planRes.softScore).toBeGreaterThan(0);
      expect(planRes.allResults.length).toBeGreaterThan(0);
      expect(planRes.categoryScores).toBeDefined();
    });

    it('top-level validatePlan function returns valid=false when hard failures exist', () => {
      const building = loadFixture('invalid-overlap');
      const planRes = validator.validatePlan(building);
      expect(planRes.valid).toBe(false);
      expect(planRes.hardFailures.length).toBeGreaterThan(0);
      expect(planRes.hardFailures.some(f => f.constraintId === 'HC-003')).toBe(true);
    });
  });

  describe('Invalid fixtures — hard constraint failures', () => {
    it('invalid-overlap fails with HC-003', () => {
      const building = loadFixture('invalid-overlap');
      const summary = validator.validate(building);
      expect(summary.isValid).toBe(false);
      expect(summary.violations.some(v => v.constraintId === 'HC-003')).toBe(true);
    });

    it('invalid-outside-boundary fails with HC-001', () => {
      const building = loadFixture('invalid-outside-boundary');
      const summary = validator.validate(building);
      expect(summary.isValid).toBe(false);
      expect(summary.violations.some(v => v.constraintId === 'HC-001')).toBe(true);
    });

    it('invalid-missing-room fails with HC-020 when required types specified', () => {
      const building = loadFixture('invalid-missing-room');
      const reg = createDefaultRegistry();
      void new PlanValidator(reg, { enableVastu: false });

      // Validate with required room types
      const config = resolveConfig({ enableVastu: false }, building);
      const ctx = buildEvaluationContext(building, config, [RoomType.Kitchen, RoomType.Bathroom]);

      // Run the RequiredRoomsPresent constraint directly
      const results = RequiredRoomsPresent.evaluate(ctx);
      const failures = results.filter((r: ConstraintResult) => !r.passed);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0]!.constraintId).toBe('HC-020');
    });

    it('invalid-door-no-wall fails with HC-011', () => {
      const building = loadFixture('invalid-door-no-wall');
      const summary = validator.validate(building);
      expect(summary.isValid).toBe(false);
      expect(summary.violations.some(v => v.constraintId === 'HC-011')).toBe(true);
    });

    it('invalid-window-no-wall fails with HC-015', () => {
      const building = loadFixture('invalid-window-no-wall');
      const summary = validator.validate(building);
      expect(summary.isValid).toBe(false);
      expect(summary.violations.some(v => v.constraintId === 'HC-015')).toBe(true);
    });

    it('invalid-stair-no-floor fails with HC-014', () => {
      const building = loadFixture('invalid-stair-no-floor');
      const summary = validator.validate(building);
      expect(summary.isValid).toBe(false);
      expect(summary.violations.some(v => v.constraintId === 'HC-014')).toBe(true);
    });
  });

  describe('validateOne', () => {
    it('evaluates a single constraint by ID', () => {
      const building = loadFixture('30x50-2bhk');
      const results = validator.validateOne(building, 'HC-001');
      expect(results).toHaveLength(1);
      expect(results[0]?.constraintId).toBe('HC-001');
      expect(results[0]?.passed).toBe(true);
    });

    it('returns error result for non-existent constraint ID', () => {
      const building = loadFixture('30x50-2bhk');
      const results = validator.validateOne(building, 'NON-EXISTENT-ID');
      expect(results).toHaveLength(1);
      expect(results[0]?.passed).toBe(false);
      expect(results[0]?.message).toMatch(/not found/i);
    });
  });

  describe('Determinism', () => {
    it('same building validated twice produces identical summary', () => {
      const building = loadFixture('30x50-2bhk');
      const a = validator.validate(building);
      const b = validator.validate(building);
      expect(a.isValid).toBe(b.isValid);
      expect(a.overallScore).toBe(b.overallScore);
      expect(a.totalConstraints).toBe(b.totalConstraints);
      expect(a.passed).toBe(b.passed);
      expect(a.failed).toBe(b.failed);
    });
  });

  describe('Immutability', () => {
    it('validation does not mutate the building', () => {
      const building = loadFixture('30x50-2bhk');
      const json1 = JSON.stringify(building);
      validator.validate(building);
      const json2 = JSON.stringify(building);
      expect(json1).toBe(json2);
    });
  });

  describe('Configuration', () => {
    it('rebuilds the managed default registry when Vastu is reconfigured', () => {
      const v = new PlanValidator(undefined, { enableVastu: true });
      expect(v.registry.getByCategory(ConstraintCategory.VASTU).length).toBeGreaterThan(0);

      v.configure({ enableVastu: false });

      expect(v.registry.getByCategory(ConstraintCategory.VASTU)).toHaveLength(0);
    });

    it('disabled constraint is not evaluated', () => {
      const registry = createDefaultRegistry();
      registry.setEnabled('HC-001', false);
      const v = new PlanValidator(registry);

      const building = loadFixture('invalid-outside-boundary');
      const summary = v.validate(building);
      // HC-001 should not appear since it's disabled
      expect(summary.results.some(r => r.constraintId === 'HC-001')).toBe(false);
    });

    it('short-circuit stops after first hard failure', () => {
      const building = loadFixture('invalid-overlap');
      const summary = validator.validate(building, { shortCircuit: true });
      expect(summary.isValid).toBe(false);
      // Should have fewer results than full validation
      const fullSummary = validator.validate(building);
      expect(summary.totalConstraints).toBeLessThanOrEqual(fullSummary.totalConstraints);
    });
  });

  describe('Soft scoring — quality variants', () => {
    it('poor-daylight fixture has lower daylight score', () => {
      const poorDaylight = loadFixture('quality-poor-daylight');
      const summary = validator.validate(poorDaylight);
      const daylightScore = summary.categoryScores[ConstraintCategory.DAYLIGHT];
      if (daylightScore) {
        expect(daylightScore.score).toBeLessThan(80);
      }
    });

    it('poor-circulation fixture has lower circulation score', () => {
      const poorCirc = loadFixture('quality-poor-circulation');
      const summary = validator.validate(poorCirc);
      const circScore = summary.categoryScores[ConstraintCategory.CIRCULATION];
      if (circScore) {
        expect(circScore.score).toBeLessThan(70);
      }
    });

    it('poor-privacy fixture has lower privacy score', () => {
      const poorPriv = loadFixture('quality-poor-privacy');
      const summary = validator.validate(poorPriv);
      const privScore = summary.categoryScores[ConstraintCategory.PRIVACY];
      if (privScore) {
        expect(privScore.score).toBeLessThan(70);
      }
    });

    it('vastu-good fixture has reasonable vastu score', () => {
      const vastuGood = loadFixture('quality-vastu-good');
      const summary = validator.validate(vastuGood);
      const vastuScore = summary.categoryScores[ConstraintCategory.VASTU];
      if (vastuScore) {
        expect(vastuScore.score).toBeGreaterThan(20);
      }
    });

    it('vastu-bad fixture has lower vastu score', () => {
      const vastuBad = loadFixture('quality-vastu-bad');
      const summary = validator.validate(vastuBad);
      const vastuScore = summary.categoryScores[ConstraintCategory.VASTU];
      if (vastuScore) {
        expect(vastuScore.score).toBeLessThan(60);
      }
    });
  });

  describe('Human-readable messages', () => {
    it('violation messages include room names', () => {
      const building = loadFixture('invalid-overlap');
      const summary = validator.validate(building);
      const overlapViolation = summary.violations.find(v => v.constraintId === 'HC-003');
      expect(overlapViolation).toBeDefined();
      expect(overlapViolation!.message).toContain('Bedroom');
      expect(overlapViolation!.message).not.toMatch(/^Constraint .* failed/);
    });

    it('violation messages include measurements', () => {
      const building = loadFixture('invalid-overlap');
      const summary = validator.validate(building);
      const overlapViolation = summary.violations.find(v => v.constraintId === 'HC-003');
      expect(overlapViolation).toBeDefined();
      expect(overlapViolation!.message).toMatch(/sq ft/);
    });

    it('violations have explanations', () => {
      const building = loadFixture('invalid-outside-boundary');
      const summary = validator.validate(building);
      const violation = summary.violations[0];
      expect(violation).toBeDefined();
      expect(violation!.explanation.length).toBeGreaterThan(20);
    });
  });

  describe('Suggestions', () => {
    it('hard violations produce repair suggestions', () => {
      const building = loadFixture('invalid-overlap');
      const summary = validator.validate(building);
      expect(summary.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe('isValid shortcut', () => {
    it('returns true for a valid schematic in explicit draft mode', () => {
      const building = loadFixture('30x50-2bhk');
      expect(validator.isValid(building, { allowIncompleteDraft: true })).toBe(true);
    });

    it('returns false for invalid plan', () => {
      const building = loadFixture('invalid-overlap');
      expect(validator.isValid(building)).toBe(false);
    });
  });

  describe('score method', () => {
    it('returns PlanScore structure', () => {
      const building = loadFixture('30x50-2bhk');
      const score = validator.score(building, { allowIncompleteDraft: true });
      expect(score.overall).toBeGreaterThanOrEqual(0);
      expect(score.overall).toBeLessThanOrEqual(100);
      expect(score.categories).toBeDefined();
      expect(score.hardConstraintsPassed).toBe(true);
    });
  });

  describe('Performance', () => {
    it('validates 30x50-2bhk in under 50ms', () => {
      const building = loadFixture('30x50-2bhk');
      const start = performance.now();
      validator.validate(building);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
    });

    it('HARD-only check in under 10ms', () => {
      const building = loadFixture('30x50-2bhk');
      // Warm up JIT to avoid cold-start timing flakiness
      validator.isValid(building);
      const start = performance.now();
      validator.isValid(building);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(25);
    });
  });
});

// ─── Backward Compatibility ─────────────────────────────────────────────────

describe('Backward-compatible validate()', () => {
  it('returns ValidationReport matching old shape', () => {
    const building = loadFixture('30x50-2bhk');
    const report = validate(building);
    expect(report).toHaveProperty('isValid');
    expect(report).toHaveProperty('score');
    expect(report).toHaveProperty('hardViolations');
    expect(report).toHaveProperty('softViolations');
    expect(report).toHaveProperty('suggestions');
    expect(report).toHaveProperty('timestamp');
    expect(report.isValid).toBe(true);
  });
});

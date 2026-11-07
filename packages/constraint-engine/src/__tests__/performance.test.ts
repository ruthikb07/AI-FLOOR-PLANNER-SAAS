import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PlanValidator } from '../validator';
import { createDefaultRegistry } from '../constraints/index';
import type { Building } from '@ai-floor-planner/core';

const FIXTURES_DIR = path.resolve(__dirname, '../../../../tests/fixtures');

function loadFixture(name: string): Building {
  const json = fs.readFileSync(path.join(FIXTURES_DIR, `${name}.json`), 'utf-8');
  return JSON.parse(json) as Building;
}

describe('Performance Benchmarks', () => {
  const registry = createDefaultRegistry();
  const validator = new PlanValidator(registry);

  it('validates standard 2BHK plan in under 50ms (MUST requirement)', () => {
    const building = loadFixture('30x50-2bhk');
    validator.validate(building, { allowIncompleteDraft: true });
    const start = performance.now();
    const summary = validator.validate(building, { allowIncompleteDraft: true });
    const duration = performance.now() - start;

    expect(summary.isValid).toBe(true);
    expect(duration).toBeLessThan(50);
  });

  it('validates 3BHK plan in under 50ms', () => {
    const building = loadFixture('30x50-3bhk');
    validator.validate(building, { allowIncompleteDraft: true });
    const start = performance.now();
    const summary = validator.validate(building, { allowIncompleteDraft: true });
    const duration = performance.now() - start;

    expect(summary.isValid).toBe(true);
    expect(duration).toBeLessThan(50);
  });

  it('HARD-only fast validity check runs in under 10ms (MUST requirement)', () => {
    const building = loadFixture('30x50-2bhk');
    validator.isValid(building, { allowIncompleteDraft: true });
    const start = performance.now();
    const valid = validator.isValid(building, { allowIncompleteDraft: true });
    const duration = performance.now() - start;

    expect(valid).toBe(true);
    expect(duration).toBeLessThan(10);
  });

  it('executes 100 sequential evaluations in under 5000ms (candidate generation stress)', () => {
    const building = loadFixture('30x50-2bhk');
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      validator.validate(building);
    }
    const totalDuration = performance.now() - start;
    expect(totalDuration).toBeLessThan(5000);
  });
});

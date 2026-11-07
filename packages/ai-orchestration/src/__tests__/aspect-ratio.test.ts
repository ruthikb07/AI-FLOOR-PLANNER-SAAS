import { describe, expect, it } from 'vitest';
import {
  computeAspectAdaptedDimensions,
  MIN_OUTPUT_DIMENSION_PX,
  MAX_OUTPUT_DIMENSION_PX,
  OUTPUT_DIMENSION_STEP_PX,
} from '../orchestration/aspect-ratio';

describe('Phase 2 recovery (P3) — computeAspectAdaptedDimensions', () => {
  it('is deterministic: identical plot dimensions always yield identical output dimensions', () => {
    const a = computeAspectAdaptedDimensions(30, 45);
    const b = computeAspectAdaptedDimensions(30, 45);
    expect(a).toEqual(b);
  });

  it('portrait plot (deep, narrow) => portrait output (height > width)', () => {
    const { width, height } = computeAspectAdaptedDimensions(18, 30);
    expect(height).toBeGreaterThan(width);
  });

  it('landscape plot (wide, shallow) => landscape output (width > height)', () => {
    const { width, height } = computeAspectAdaptedDimensions(45, 20);
    expect(width).toBeGreaterThan(height);
  });

  it('square-ish plot => approximately square output', () => {
    const { width, height } = computeAspectAdaptedDimensions(30, 30);
    expect(Math.abs(width - height)).toBeLessThanOrEqual(OUTPUT_DIMENSION_STEP_PX);
  });

  it('never returns a forced 1024x1024 square for a non-square plot', () => {
    const { width, height } = computeAspectAdaptedDimensions(18, 30);
    expect(width === 1024 && height === 1024).toBe(false);
  });

  it('stays within supported min/max dimensions for extreme plot ratios', () => {
    const extreme = computeAspectAdaptedDimensions(100, 5);
    expect(extreme.width).toBeLessThanOrEqual(MAX_OUTPUT_DIMENSION_PX);
    expect(extreme.height).toBeGreaterThanOrEqual(MIN_OUTPUT_DIMENSION_PX);

    const extremeOther = computeAspectAdaptedDimensions(5, 100);
    expect(extremeOther.height).toBeLessThanOrEqual(MAX_OUTPUT_DIMENSION_PX);
    expect(extremeOther.width).toBeGreaterThanOrEqual(MIN_OUTPUT_DIMENSION_PX);
  });

  it('dimensions are rounded to the fixed step for provider compatibility', () => {
    const { width, height } = computeAspectAdaptedDimensions(23, 41);
    expect(width % OUTPUT_DIMENSION_STEP_PX).toBe(0);
    expect(height % OUTPUT_DIMENSION_STEP_PX).toBe(0);
  });

  it('preserves the planning aspect ratio direction without distortion beyond the clamp', () => {
    const wide = computeAspectAdaptedDimensions(60, 20); // 3:1 raw, clamped to 2:1
    expect(wide.aspectRatio).toBeCloseTo(2.0, 5);
    const tall = computeAspectAdaptedDimensions(20, 60); // 1:3 raw, clamped to 1:2
    expect(tall.aspectRatio).toBeCloseTo(0.5, 5);
  });
});

/**
 * Deterministic Plot-Aspect Output Dimension Calculator — Phase 2 recovery (P3).
 *
 * The Phase 1 report identifies forced 1024x1024 square output as a direct
 * cause of cramped/overlapping apartment plates: real floor plates are
 * rectangular, and the reference library is strongly portrait. This module
 * derives FLUX output width/height from the actual plot proportions instead.
 *
 * Determinism contract: same plotWidthM + plotDepthM => identical width/height
 * every time. No randomness. A wide plot yields landscape output; a deep plot
 * yields portrait output; a square-ish plot yields square-ish output.
 */

/** Minimum single-dimension pixel size (keeps output usable / within provider limits). */
export const MIN_OUTPUT_DIMENSION_PX = 512;

/** Maximum single-dimension pixel size (keeps output within klein's supported envelope). */
export const MAX_OUTPUT_DIMENSION_PX = 1536;

/** Dimensions are rounded to this step (a common diffusion-model constraint). */
export const OUTPUT_DIMENSION_STEP_PX = 64;

/**
 * Total pixel budget preserved from the previous square 1024x1024 default
 * (1,048,576 px) so overall output resolution/latency stays comparable while
 * the SHAPE adapts to the plot.
 */
export const TARGET_PIXEL_BUDGET = 1024 * 1024;

/** Aspect ratio (width:depth) is clamped to this range to avoid degenerate slivers. */
export const MIN_ASPECT_RATIO = 0.5;
export const MAX_ASPECT_RATIO = 2.0;

export interface AspectAdaptedDimensions {
  readonly width: number;
  readonly height: number;
  /** The clamped aspect ratio actually used (width / height), for diagnostics/tests. */
  readonly aspectRatio: number;
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Computes deterministic output width/height from a plot's plan-view
 * proportions (width along the road frontage, depth into the site).
 *
 * A wide plot (plotWidthM > plotDepthM) => landscape output (width > height).
 * A deep plot (plotDepthM > plotWidthM) => portrait output (height > width).
 * A roughly square plot => roughly square output.
 */
export function computeAspectAdaptedDimensions(
  plotWidthM: number,
  plotDepthM: number,
): AspectAdaptedDimensions {
  const safeWidth = Math.max(0.1, plotWidthM);
  const safeDepth = Math.max(0.1, plotDepthM);
  const rawAspect = safeWidth / safeDepth;
  const aspectRatio = clamp(rawAspect, MIN_ASPECT_RATIO, MAX_ASPECT_RATIO);

  let width = Math.sqrt(TARGET_PIXEL_BUDGET * aspectRatio);
  let height = Math.sqrt(TARGET_PIXEL_BUDGET / aspectRatio);

  width = roundToStep(width, OUTPUT_DIMENSION_STEP_PX);
  height = roundToStep(height, OUTPUT_DIMENSION_STEP_PX);

  width = clamp(width, MIN_OUTPUT_DIMENSION_PX, MAX_OUTPUT_DIMENSION_PX);
  height = clamp(height, MIN_OUTPUT_DIMENSION_PX, MAX_OUTPUT_DIMENSION_PX);

  return { width, height, aspectRatio };
}

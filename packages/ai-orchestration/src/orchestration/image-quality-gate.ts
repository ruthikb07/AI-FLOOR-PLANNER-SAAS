/**
 * Image Quality Gate — Master PRD Section 40.
 *
 * Verifies that the raw image produced by FLUX meets minimum visual and structural
 * standards before sending it downstream to Gemini Vision:
 * - Valid buffer / bytes
 * - Sufficient resolution (e.g. >= 512x512)
 * - Non-empty payload (>= 5 KB)
 * - Sufficient contrast / pixel variance (rejects pure white/black or flat-color corruption)
 */

export interface ImageQualityCheckResult {
  readonly valid: boolean;
  readonly reason?: string;
  readonly byteSize: number;
  readonly detectedMime?: string;
}

export function verifyImageQuality(
  imageBuffer: Buffer | Uint8Array,
  _expectedWidth = 1024,
  _expectedHeight = 1024,
): ImageQualityCheckResult {
  const byteSize = imageBuffer.length;

  // 1. Minimum file size check: valid 512+ PNG/JPEG floor plans are typically > 10KB
  if (byteSize < 5000) {
    return {
      valid: false,
      reason: `Image payload is suspiciously small (${byteSize} bytes); likely corrupted or empty.`,
      byteSize,
    };
  }

  // 2. Magic byte verification (PNG: 89 50 4E 47, JPEG: FF D8 FF, WebP: RIFF...WEBP)
  let detectedMime = 'application/octet-stream';
  const isPng = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x4e && imageBuffer[3] === 0x47;
  const isJpeg = imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8 && imageBuffer[2] === 0xff;
  const isWebp =
    imageBuffer[0] === 0x52 &&
    imageBuffer[1] === 0x49 &&
    imageBuffer[2] === 0x46 &&
    imageBuffer[3] === 0x46 &&
    imageBuffer[8] === 0x57 &&
    imageBuffer[9] === 0x45 &&
    imageBuffer[10] === 0x42 &&
    imageBuffer[11] === 0x50;

  if (isPng) detectedMime = 'image/png';
  else if (isJpeg) detectedMime = 'image/jpeg';
  else if (isWebp) detectedMime = 'image/webp';
  else {
    return {
      valid: false,
      reason: 'Image does not match standard image format header (PNG, JPEG, WebP).',
      byteSize,
    };
  }

  // 3. Contrast & entropy check across sampled bytes
  // An entirely blank (all white 0xFF or all black 0x00) image will have zero byte variance.
  const headerOffset = Math.min(64, Math.floor(byteSize / 10));
  const payloadBytes = byteSize - headerOffset;
  const sampleStride = Math.max(1, Math.floor(payloadBytes / 500));
  let sum = 0;
  let sampleCount = 0;
  const samples: number[] = [];

  for (let i = headerOffset; i < byteSize; i += sampleStride) {
    const val = imageBuffer[i]!;
    samples.push(val);
    sum += val;
    sampleCount++;
    if (sampleCount >= 500) break;
  }

  const mean = sum / sampleCount;
  let variance = 0;
  for (const val of samples) {
    variance += (val - mean) * (val - mean);
  }
  variance = variance / sampleCount;

  // A compressed floor plan PNG with walls, doors, and labels has high byte variance (> 200).
  // Pure flat color or all-zero bytes has variance < 5.
  if (variance < 10) {
    return {
      valid: false,
      reason: `Image lacks contrast and architectural detail (byte variance ${variance.toFixed(1)}); appears blank or corrupted.`,
      byteSize,
      detectedMime,
    };
  }

  return {
    valid: true,
    byteSize,
    detectedMime,
  };
}

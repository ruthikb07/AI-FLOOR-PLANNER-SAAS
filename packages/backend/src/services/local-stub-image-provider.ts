/**
 * Local development stub image provider â€” Master PRD Phase 2.
 *
 * WHY THIS EXISTS: the real Phase 2 loop needs Cloudflare credentials. This
 * provider lets a developer exercise the REAL pipeline (prompt compiler ->
 * HTTP boundary -> immutable artifact -> UI) without any credential, and it
 * emits a genuine, deterministic schematic PNG so the browser displays a real
 * image.
 *
 * TRUTHFUL PROVENANCE (.memory principle 4): this provider identifies itself as
 * `local-stub` everywhere â€” artifact metadata, UI label and logs. It never
 * claims to be FLUX/Cloudflare, and it is NEVER the default. It must be enabled
 * explicitly with IMAGE_PROVIDER=local-stub.
 *
 * Determinism (PRD Â§17): identical request + seed => identical bytes; a
 * different seed yields a different schematic partition. No Math.random.
 */

import { deflateSync } from 'node:zlib';
import type { FloorPlanImagePromptRequest, GeneratedPlanImage, ImageGenerationProvider } from '@ai-floor-planner/ai-orchestration';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

/** Deterministic seeded LCG â€” never Math.random (PRD Â§17). */
function lcg(seed: number): () => number {
  let state = (seed % 2_147_483_647 + 2_147_483_647) % 2_147_483_647 || 1;
  return () => {
    state = (state * 48_271) % 2_147_483_647;
    return state / 2_147_483_647;
  };
}

export function renderSchematicPng(request: FloorPlanImagePromptRequest): Buffer {
  const width = Math.max(64, Math.min(2048, Math.round(request.width)));
  const height = Math.max(64, Math.min(2048, Math.round(request.height)));
  const pixels = new Uint8Array(width * height * 3).fill(255);
  const random = lcg(request.seed);

  const setPixel = (x: number, y: number, value: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 3;
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, thickness: number): void => {
    for (let t = 0; t < thickness; t += 1) {
      for (let x = x0; x <= x1; x += 1) { setPixel(x, y0 + t, 0); setPixel(x, y1 - t, 0); }
      for (let y = y0; y <= y1; y += 1) { setPixel(x0 + t, y, 0); setPixel(x1 - t, y, 0); }
    }
  };

  const margin = Math.round(Math.min(width, height) * 0.08);
  const scale = Math.max(1, Math.round(Math.min(width, height) / 512));
  // Plot boundary, then the inner building envelope (schematic only).
  rect(margin, margin, width - margin, height - margin, scale * 2);
  const inset = Math.round(Math.min(width, height) * 0.12);
  const bx0 = margin + inset;
  const by0 = margin + inset;
  const bx1 = width - margin - inset;
  const by1 = height - margin - inset;
  rect(bx0, by0, bx1, by1, scale);

  // Deterministic room partition inside the envelope (seed-driven, not random).
  const columns = 2 + Math.floor(random() * 3);
  const rows = 2 + Math.floor(random() * 3);
  const cellWidth = (bx1 - bx0) / columns;
  const cellHeight = (by1 - by0) / rows;
  for (let column = 1; column < columns; column += 1) {
    const jitter = Math.round((random() - 0.5) * cellWidth * 0.4);
    const x = Math.min(bx1 - 1, Math.max(bx0 + 1, Math.round(bx0 + column * cellWidth + jitter)));
    for (let y = by0; y <= by1; y += 1) for (let t = 0; t < scale; t += 1) setPixel(x + t, y, 0);
  }
  for (let row = 1; row < rows; row += 1) {
    const jitter = Math.round((random() - 0.5) * cellHeight * 0.4);
    const y = Math.min(by1 - 1, Math.max(by0 + 1, Math.round(by0 + row * cellHeight + jitter)));
    for (let x = bx0; x <= bx1; x += 1) for (let t = 0; t < scale; t += 1) setPixel(x, y + t, 0);
  }

  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0; // filter: none
    raw.set(pixels.subarray(y * width * 3, (y + 1) * width * 3), rowStart + 1);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour RGB

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(chunk('IHDR', ihdr)),
    Buffer.from(chunk('IDAT', new Uint8Array(deflateSync(Buffer.from(raw))))),
    Buffer.from(chunk('IEND', new Uint8Array(0))),
  ]);
}

export class LocalStubImageProvider implements ImageGenerationProvider {
  readonly name = 'local-stub';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async generateFloorPlan(request: FloorPlanImagePromptRequest): Promise<GeneratedPlanImage> {
    const startedAt = Date.now();
    const png = renderSchematicPng(request);
    return {
      imageBase64: png.toString('base64'),
      mimeType: 'image/png',
      provider: this.name,
      model: 'schematic-stub',
      seed: request.seed,
      promptVersion: request.promptVersion,
      prompt: request.prompt,
      generatedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
  }
}

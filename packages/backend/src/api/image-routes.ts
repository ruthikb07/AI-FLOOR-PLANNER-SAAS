/**
 * Image generation route handlers â€” Master PRD Phase 2 (Â§17/Â§18).
 *
 * The only boundary between the browser and the Cloudflare credentials. The
 * frontend sends the deterministic compiled prompt request; this handler runs
 * it through the server-side provider and persists the ORIGINAL image as an
 * immutable artifact before returning it.
 */

import { ImageProviderError } from '@ai-floor-planner/ai-orchestration';
import type { FloorPlanImagePromptRequest } from '@ai-floor-planner/ai-orchestration';
import type { ImageGenerationProvider } from '@ai-floor-planner/ai-orchestration';
import type { ImageArtifactStore, StoredImageArtifact } from '../services/image-artifact-store.js';

export interface ImageRouteDeps {
  readonly provider: ImageGenerationProvider | null;
  readonly store: ImageArtifactStore;
}

export interface RouteResponse {
  readonly status: number;
  readonly json: unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Minimal structural validation of the untrusted compiled request. */
export function parseFloorPlanImageRequest(value: unknown): FloorPlanImagePromptRequest | null {
  if (!isRecord(value)) return null;
  const prompt = value.prompt;
  const negativePrompt = value.negativePrompt;
  const seed = value.seed;
  const width = value.width;
  const height = value.height;
  if (typeof prompt !== 'string' || prompt.trim().length === 0) return null;
  if (typeof negativePrompt !== 'string') return null;
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return null;
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return null;
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return null;
  if (value.schemaVersion !== 1 || typeof value.promptVersion !== 'number') return null;
  const metadata = value.metadata;
  if (!isRecord(metadata) || typeof metadata.projectName !== 'string') return null;
  return value as unknown as FloorPlanImagePromptRequest;
}

export async function handleFloorPlanGeneration(
  body: unknown,
  deps: ImageRouteDeps,
): Promise<RouteResponse> {
  const record = isRecord(body) ? body : {};
  const projectId = typeof record.projectId === 'string' && record.projectId.trim().length > 0
    ? record.projectId.trim()
    : null;
  const request = parseFloorPlanImageRequest(record.request);
  if (!projectId || !request) {
    return { status: 400, json: { error: { code: 'INVALID_REQUEST', message: 'A projectId and a compiled FloorPlanImagePromptRequest are required.' } } };
  }
  if (!deps.provider || !(await deps.provider.isAvailable())) {
    return {
      status: 503,
      json: { error: { code: 'IMAGE_PROVIDER_NOT_CONFIGURED', message: 'Floor-plan image generation is not configured on this server.' } },
    };
  }
  try {
    const generated = await deps.provider.generateFloorPlan(request);
    const artifact = await deps.store.save(projectId, generated, request);
    return { status: 200, json: { artifact } };
  } catch (error) {
    if (error instanceof ImageProviderError) {
      const status = error.code === 'IMAGE_PROVIDER_NOT_CONFIGURED' ? 503 : 502;
      return { status, json: { error: { code: error.code, message: error.message } } };
    }
    return { status: 500, json: { error: { code: 'IMAGE_GENERATION_FAILED', message: 'Image generation failed unexpectedly.' } } };
  }
}

export async function handleArtifactGet(generationId: string, store: ImageArtifactStore): Promise<RouteResponse> {
  if (!/^gen_[0-9a-z_]+$/.test(generationId)) {
    return { status: 400, json: { error: { code: 'INVALID_GENERATION_ID', message: 'Malformed generation id.' } } };
  }
  const artifact: StoredImageArtifact | null = await store.get(generationId);
  if (!artifact) {
    return { status: 404, json: { error: { code: 'ARTIFACT_NOT_FOUND', message: 'No image artifact exists for this generation id.' } } };
  }
  return { status: 200, json: { artifact } };
}

/**
 * Immutable Image Artifact Store — Master PRD Phase 2 / §17.
 *
 * Persists the ORIGINAL generated floor-plan image together with the full
 * reproduction metadata (generation id, project id, seed, model, provider,
 * prompt version, original prompt, timestamp). Regeneration always produces a
 * NEW generation id and a NEW artifact — an existing artifact is never
 * modified or deleted through this API (PRD §17 "Do not overwrite the original
 * image" and §24 "Immutable image rule").
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import path from 'path';
import type { GeneratedPlanImage } from '@ai-floor-planner/ai-orchestration';
import type { FloorPlanImagePromptRequest } from '@ai-floor-planner/ai-orchestration';

/** Reproduction metadata persisted beside every original image (PRD §17). */
export interface StoredImageArtifactMetadata {
  readonly generationId: string;
  readonly projectId: string;
  readonly seed: number;
  readonly model: string;
  readonly provider: string;
  readonly promptVersion: number;
  readonly originalPrompt: string;
  readonly negativePrompt: string;
  readonly width: number;
  readonly height: number;
  readonly mimeType: string;
  readonly generatedAt: string;
  readonly latencyMs: number;
}

export interface StoredImageArtifact extends StoredImageArtifactMetadata {
  readonly imageBase64: string;
}

export class ImageArtifactImmutabilityError extends Error {
  constructor(generationId: string) {
    super(`Image artifact ${generationId} already exists and can never be overwritten.`);
    this.name = 'ImageArtifactImmutabilityError';
    Object.setPrototypeOf(this, ImageArtifactImmutabilityError.prototype);
  }
}

export class ImageArtifactStore {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /** New unique generation id per attempt; regeneration never reuses one. */
  private newGenerationId(seed: number): string {
    return `gen_${seed}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  }

  private metadataPath(generationId: string): string {
    return path.join(this.baseDir, `${generationId}.json`);
  }

  private imagePath(generationId: string, extension: string): string {
    return path.join(this.baseDir, `${generationId}.${extension}`);
  }

  async save(projectId: string, image: GeneratedPlanImage, request: FloorPlanImagePromptRequest): Promise<StoredImageArtifact> {
    await mkdir(this.baseDir, { recursive: true });
    const generationId = this.newGenerationId(image.seed);
    const metadataPath = this.metadataPath(generationId);

    // Paranoid immutability guard (defense in depth — ids are unique per call).
    try {
      await access(metadataPath);
      throw new ImageArtifactImmutabilityError(generationId);
    } catch (error) {
      if (error instanceof ImageArtifactImmutabilityError) throw error;
      // ENOENT — path is free, continue.
    }

    const extension = image.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const artifact: StoredImageArtifact = {
      generationId,
      projectId,
      seed: image.seed,
      model: image.model,
      provider: image.provider,
      promptVersion: request.promptVersion,
      originalPrompt: image.prompt,
      negativePrompt: request.negativePrompt,
      width: request.width,
      height: request.height,
      mimeType: image.mimeType,
      generatedAt: image.generatedAt,
      latencyMs: image.latencyMs,
      imageBase64: image.imageBase64,
    };

    const { imageBase64, ...metadata } = artifact;
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    await writeFile(this.imagePath(generationId, extension), Buffer.from(imageBase64, 'base64'));
    return artifact;
  }

  async get(generationId: string): Promise<StoredImageArtifact | null> {
    let raw: string;
    try {
      raw = await readFile(this.metadataPath(generationId), 'utf8');
    } catch {
      return null;
    }
    const metadata = JSON.parse(raw) as StoredImageArtifactMetadata;
    const extension = metadata.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const imageBytes = await readFile(this.imagePath(generationId, extension));
    return { ...metadata, imageBase64: imageBytes.toString('base64') };
  }

  async listByProject(projectId: string): Promise<StoredImageArtifactMetadata[]> {
    let entries: string[];
    try {
      entries = await readdir(this.baseDir);
    } catch {
      return [];
    }
    const matches = entries
      .filter(name => name.endsWith('.json'))
      .map(async name => {
        try {
          const raw = await readFile(path.join(this.baseDir, name), 'utf8');
          return JSON.parse(raw) as StoredImageArtifactMetadata;
        } catch {
          return null;
        }
      });
    return (await Promise.all(matches))
      .filter((item): item is StoredImageArtifactMetadata => item !== null)
      .filter(item => item.projectId === projectId)
      .sort((a, b) => (b.generatedAt > a.generatedAt ? 1 : -1));
  }
}

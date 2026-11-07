/**
 * Image Generation Provider Abstraction â€” Master PRD Phase 2.
 *
 * AI #1 (image generation): Cloudflare Workers AI / FLUX produces the visual
 * architectural floor-plan CONCEPT only. It is never the CAD engine, geometry
 * validator or canonical source of project geometry (PRD Â§5 / Â§7).
 *
 * SECURITY (PRD Â§36): Cloudflare credentials are supplied by the SERVER-side
 * caller (packages/backend) from environment variables. This module must never
 * be instantiated in the browser with real credentials.
 *
 * Determinism (PRD Â§17): the outgoing HTTP request is a pure function of the
 * compiled prompt request. same input + same seed => identical request;
 * same input + different seed => a different candidate possibility.
 */

import type { FloorPlanImagePromptRequest, ReferenceImageInput } from '../orchestration/image-prompt-compiler';
import type { ReferenceSelectionDiagnostics } from '../apartment/reference-library.js';

export interface GeneratedPlanImage {
  /** Raw encoded image bytes (base64, no data-URL prefix). */
  readonly imageBase64: string;
  readonly mimeType: 'image/png' | 'image/jpeg';
  readonly provider: string;
  readonly model: string;
  readonly seed: number;
  readonly promptVersion: number;
  readonly prompt: string;
  readonly generatedAt: string;
  readonly latencyMs: number;
  /** Structured reference selection and drop diagnostics (Phase 2 recovery). */
  readonly referenceDiagnostics?: ReferenceSelectionDiagnostics;
}

export interface ImageGenerationProvider {
  readonly name: string;
  generateFloorPlan(request: FloorPlanImagePromptRequest): Promise<GeneratedPlanImage>;
  isAvailable(): Promise<boolean>;
}

/**
 * Transport diagnostic stage names (Phase 1 recovery — P7 transport
 * diagnostics). Lets a caller grep logs to tell "request construction
 * failure" apart from "reference preparation failure", "network/fetch
 * failure", "HTTP error" and "response decoding failure" instead of a single
 * generic "fetch failed" message.
 */
export type FluxTransportDiagnosticStage =
  | 'request_construction_failure'
  | 'reference_preparation_failure'
  | 'network_fetch_failure'
  | 'http_response'
  | 'http_error'
  | 'response_decode_failure';

/**
 * Emits a structured, credential-safe diagnostic log line for the FLUX
 * request lifecycle. NEVER logs the API token, the Authorization header
 * value, or any other secret â€” only the model name, request shape (field
 * names, not values), HTTP status, and error messages/names.
 */
function logTransportDiagnostic(
  stage: FluxTransportDiagnosticStage,
  details: {
    model: string;
    hasReferences?: boolean;
    fieldsSent?: readonly string[];
    status?: number;
    ok?: boolean;
    contentType?: string;
    detail?: string;
    retryAfterReferenceRejection?: boolean;
    error?: unknown;
  },
): void {
  const errorSummary = details.error instanceof Error
    ? `${details.error.name}: ${details.error.message}`
    : details.error !== undefined
      ? String(details.error)
      : undefined;

  console.warn('[CloudflareImageProvider][flux_transport]', JSON.stringify({
    stage,
    model: details.model,
    hasReferences: details.hasReferences,
    fieldsSent: details.fieldsSent,
    status: details.status,
    ok: details.ok,
    contentType: details.contentType,
    detail: details.detail,
    retryAfterReferenceRejection: details.retryAfterReferenceRejection,
    error: errorSummary,
  }));
}

export type ImageProviderErrorCode =
  | 'IMAGE_PROVIDER_NOT_CONFIGURED'
  | 'REFERENCE_FILE_READ_ERROR'
  | 'REFERENCE_FETCH_ERROR'
  | 'REFERENCE_RESIZE_ERROR'
  | 'CLOUDFLARE_NETWORK_ERROR'
  | 'CLOUDFLARE_TIMEOUT'
  | 'CLOUDFLARE_HTTP_ERROR'
  | 'CLOUDFLARE_RESPONSE_DECODE_ERROR'
  | 'CLOUDFLARE_AUTH_ERROR'
  | 'IMAGE_PROVIDER_TIMEOUT'
  | 'IMAGE_PROVIDER_HTTP_ERROR'
  | 'IMAGE_PROVIDER_INVALID_RESPONSE';

export class ImageProviderError extends Error {
  readonly code: ImageProviderErrorCode;
  readonly status?: number;

  constructor(code: ImageProviderErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'ImageProviderError';
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, ImageProviderError.prototype);
  }
}

/** PRD Â§17: model that produces the floor-plan concept image. */
export const DEFAULT_FLUX_MODEL = '@cf/black-forest-labs/flux-2-klein-4b' as const;

export interface CloudflareImageProviderOptions {
  readonly accountId: string;
  readonly apiToken: string;
  /** Defaults to the PRD model; overridable via CLOUDFLARE_FLUX_MODEL. */
  readonly model?: string;
  /**
   * Diffusion steps. NOT part of the default payload (Phase 1 recovery, P7):
   * flux-2-klein-4b is a fixed-step distilled model and does not document a
   * `steps` multipart field. Only sent when `includeSteps` is explicitly true
   * on a verified-supported path.
   */
  readonly steps?: number;
  /** Explicit opt-in to send `steps` in the request. Defaults to false. */
  readonly includeSteps?: boolean;
  readonly timeoutMs?: number;
  /** Test seam only â€” production uses the real Cloudflare endpoint. */
  readonly endpointOverride?: string;
  readonly fetchImpl?: typeof fetch;
  /**
   * Include the compiler's negative_prompt in the request. Defaults to false
   * (Phase 1 recovery, P7): klein's documented multipart params are prompt,
   * width, height and image inputs only; negative_prompt is not documented
   * for klein. Only enable on a verified-supported path.
   */
  readonly includeNegativePrompt?: boolean;
  /** Include width/height in the request. */
  readonly includeDimensions?: boolean;
}

/**
 * Pure request builder â€” the ONLY place the Cloudflare request body is shaped.
 * Exposed for determinism tests (PRD Â§17) and the backend request log.
 *
 * Default payload is limited to the documented klein-4b multipart params:
 * prompt, seed, width, height (Phase 1 recovery, P7). `steps` and
 * `negative_prompt` are only included when explicitly opted into.
 */

export function buildCloudflareImageRequestBody(
  request: FloorPlanImagePromptRequest,
  options: Pick<CloudflareImageProviderOptions, 'steps' | 'includeSteps' | 'includeNegativePrompt' | 'includeDimensions'> = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: request.prompt,
    seed: request.seed,
  };
  if ((options.includeSteps ?? false) && options.steps !== undefined) {
    body.steps = options.steps;
  }
  if ((options.includeNegativePrompt ?? false) && request.negativePrompt.trim().length > 0) {
    body.negative_prompt = request.negativePrompt;
  }
  if (options.includeDimensions ?? true) {
    body.width = request.width;
    body.height = request.height;
  }
  return body;
}

/**
 * Build a FormData payload for the Cloudflare API.
 * flux-2-klein-4b (and newer models) require multipart/form-data.
 * Supports multi-reference image inputs (input_image_0 .. input_image_3) <= 512x512 (§3).
 */
export function buildCloudflareFormData(
  body: Record<string, unknown>,
  referenceImages?: readonly ReferenceImageInput[],
): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null) {
      form.append(key, String(value));
    }
  }
  if (referenceImages && referenceImages.length > 0) {
    referenceImages.slice(0, 4).forEach((ref, index) => {
      try {
        const buffer = Buffer.from(ref.base64Data, 'base64');
        const blob = new Blob([buffer], { type: ref.mimeType || 'image/png' });
        form.append(`input_image_${index}`, blob, `${ref.name || `ref_${index}.png`}`);
      } catch (err) {
        console.warn(`[CloudflareImageProvider] Could not append reference image ${index}:`, err);
      }
    });
  }
  return form;
}

class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.active--;
          const next = this.queue.shift();
          if (next) next();
        }
      };
    }
    return new Promise(resolve => {
      this.queue.push(() => {
        this.active++;
        let released = false;
        resolve(() => {
          if (!released) {
            released = true;
            this.active--;
            const next = this.queue.shift();
            if (next) next();
          }
        });
      });
    });
  }
}

export const cloudflareImageLimiter = new ConcurrencyLimiter(2);

export class CloudflareImageProvider implements ImageGenerationProvider {
  readonly name = 'cloudflare-workers-ai';

  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly model: string;
  private readonly steps: number;
  private readonly includeSteps: boolean;
  private readonly timeoutMs: number;
  private readonly endpoint: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly includeNegativePrompt: boolean;
  private readonly includeDimensions: boolean;

  constructor(options: CloudflareImageProviderOptions) {
    this.accountId = options.accountId.trim();
    this.apiToken = options.apiToken.trim();
    this.model = options.model?.trim() || DEFAULT_FLUX_MODEL;
    this.steps = options.steps ?? 4;
    // Phase 1 recovery (P7): steps and negative_prompt are NOT part of the
    // documented klein-4b multipart contract. Default them OFF; only a
    // verified-supported caller should opt in.
    this.includeSteps = options.includeSteps ?? false;
    // Staggered Concurrency & Retry Backoff (§3.1): Limit timeout to 15s by default
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.includeNegativePrompt = options.includeNegativePrompt ?? false;
    this.includeDimensions = options.includeDimensions ?? true;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const sanitizedModel = this.model.replace(/^\/+/, '');
    this.endpoint = options.endpointOverride ?? (this.isConfigured()
      ? `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/ai/run/${sanitizedModel}`
      : null);
  }

  isConfigured(): boolean {
    return this.accountId.length > 0 && this.apiToken.length > 0;
  }

  async isAvailable(): Promise<boolean> {
    return this.isConfigured();
  }

  getModel(): string {
    return this.model;
  }

  async generateFloorPlan(request: FloorPlanImagePromptRequest): Promise<GeneratedPlanImage> {
    if (!this.isConfigured() || !this.endpoint) {
      throw new ImageProviderError(
        'IMAGE_PROVIDER_NOT_CONFIGURED',
        'Cloudflare image generation is not configured on the server (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN missing).',
      );
    }

    // Limit concurrency to 2 at a time (§3.1)
    const releaseConcurrency = await cloudflareImageLimiter.acquire();
    try {
      return await this.executeGenerateFloorPlan(request);
    } finally {
      releaseConcurrency();
    }
  }

  private async executeGenerateFloorPlan(request: FloorPlanImagePromptRequest): Promise<GeneratedPlanImage> {
    // ─── Phase 1 recovery (transport diagnostics) ───────────────────────────
    let hasReferences = false;
    let body: Record<string, unknown>;
    let formData: FormData;
    try {
      hasReferences = Boolean(request.referenceImages && request.referenceImages.length > 0);
      body = buildCloudflareImageRequestBody(request, {
        steps: this.steps,
        includeSteps: this.includeSteps,
        includeNegativePrompt: this.includeNegativePrompt,
        includeDimensions: this.includeDimensions,
      });
    } catch (err) {
      logTransportDiagnostic('request_construction_failure', { model: this.model, error: err });
      throw new ImageProviderError(
        'IMAGE_PROVIDER_INVALID_RESPONSE',
        `Failed to construct Cloudflare FLUX request body: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      formData = buildCloudflareFormData(body, request.referenceImages);
    } catch (err) {
      logTransportDiagnostic('reference_preparation_failure', { model: this.model, hasReferences, error: err });
      throw new ImageProviderError(
        'REFERENCE_RESIZE_ERROR',
        `Failed to prepare reference images for Cloudflare FLUX request: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const startedAt = Date.now();
    try {
      // Do NOT set Content-Type manually; the fetch runtime generates the
      // correct multipart/form-data boundary automatically from FormData.
      let response: Response | undefined;
      const retryDelays = [500, 1500];

      for (let attempt = 0; attempt <= 2; attempt++) {
        if (attempt > 0) {
          const delay = retryDelays[attempt - 1] ?? 1500;
          await new Promise(r => setTimeout(r, delay));
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const res = await this.fetchImpl(this.endpoint!, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiToken}`,
              'Accept': 'image/png, application/json',
            },
            body: formData,
            signal: controller.signal,
            keepalive: true,
          });
          clearTimeout(timeout);
          if ((res.status === 429 || res.status === 503) && attempt < 2) {
            continue;
          }
          response = res;
          break;
        } catch (fetchErr) {
          clearTimeout(timeout);
          const msg = fetchErr instanceof Error ? `${fetchErr.name} ${fetchErr.message}` : String(fetchErr);
          const isTransient = /ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|network|timeout|abort/i.test(msg);
          if (isTransient && attempt < 2) {
            continue;
          }
          logTransportDiagnostic('network_fetch_failure', {
            model: this.model,
            hasReferences,
            fieldsSent: Object.keys(body),
            error: fetchErr,
          });
          throw fetchErr;
        }
      }

      if (!response) {
        throw new ImageProviderError('IMAGE_PROVIDER_HTTP_ERROR', 'Cloudflare request failed after retries.');
      }

      logTransportDiagnostic('http_response', {
        model: this.model,
        hasReferences,
        fieldsSent: Object.keys(body),
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type') ?? undefined,
      });

      let referencesWereDropped = false;
      // If reference images are rejected (e.g. 400 bad request), gracefully fall back
      // to textual architectural reference specification (§3).
      if (!response.ok && response.status === 400 && hasReferences) {
        referencesWereDropped = true;
        console.warn(
          '[CloudflareImageProvider] Multi-reference image input not accepted by endpoint. Falling back to detailed textual architectural reference specification...',
        );
        const plainFormData = buildCloudflareFormData(body);
        for (let attempt = 0; attempt <= 2; attempt++) {
          if (attempt > 0) {
            const delay = retryDelays[attempt - 1] ?? 1500;
            await new Promise(r => setTimeout(r, delay));
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
          try {
            const res = await this.fetchImpl(this.endpoint!, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${this.apiToken}`,
                'Accept': 'image/png, application/json',
              },
              body: plainFormData,
              signal: controller.signal,
              keepalive: true,
            });
            clearTimeout(timeout);
            if ((res.status === 429 || res.status === 503) && attempt < 2) {
              continue;
            }
            response = res;
            break;
          } catch (fetchErr) {
            clearTimeout(timeout);
            const msg = fetchErr instanceof Error ? `${fetchErr.name} ${fetchErr.message}` : String(fetchErr);
            const isTransient = /ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|network|timeout|abort/i.test(msg);
            if (isTransient && attempt < 2) {
              continue;
            }
            logTransportDiagnostic('network_fetch_failure', {
              model: this.model,
              hasReferences: false,
              fieldsSent: Object.keys(body),
              error: fetchErr,
              retryAfterReferenceRejection: true,
            });
            throw fetchErr;
          }
        }
        logTransportDiagnostic('http_response', {
          model: this.model,
          hasReferences: false,
          fieldsSent: Object.keys(body),
          status: response.status,
          ok: response.ok,
          contentType: response.headers.get('content-type') ?? undefined,
          retryAfterReferenceRejection: true,
        });
      }

      if (!response.ok) {
        const detail = await this.describeError(response);
        logTransportDiagnostic('http_error', { model: this.model, status: response.status, detail });
        if (response.status === 401 || response.status === 403) {
          throw new ImageProviderError(
            'CLOUDFLARE_AUTH_ERROR',
            `Cloudflare authentication failed (HTTP ${response.status}). Verify credentials configuration.`,
            response.status,
          );
        }
        if (response.status === 408 || response.status === 504) {
          throw new ImageProviderError(
            'CLOUDFLARE_TIMEOUT',
            `Cloudflare image generation timed out at gateway (HTTP ${response.status}).`,
            response.status,
          );
        }
        throw new ImageProviderError(
          'CLOUDFLARE_HTTP_ERROR',
          `Cloudflare image generation failed with HTTP ${response.status}. ${detail}`.trim(),
          response.status,
        );
      }

      let finalRefDiagnostics = request.referenceDiagnostics;
      if (referencesWereDropped) {
        finalRefDiagnostics = {
          bucket: request.referenceDiagnostics?.bucket ?? null,
          requestedReferenceIds: request.referenceDiagnostics?.requestedReferenceIds ?? [],
          selectedReferenceIds: request.referenceDiagnostics?.selectedReferenceIds ?? [],
          attachedReferenceIds: [],
          drops: [
            ...(request.referenceDiagnostics?.drops ?? []),
            {
              id: 'all_references',
              reason: 'Endpoint returned HTTP 400 with multipart references; retried without reference images.',
            },
          ],
          status: 'DROPPED',
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      try {
        if (contentType.startsWith('image/')) {
          return await this.fromBytes(response, request, contentType, startedAt, finalRefDiagnostics);
        }
        return await this.fromJson(response, request, startedAt, finalRefDiagnostics);
      } catch (decodeErr) {
        logTransportDiagnostic('response_decode_failure', { model: this.model, contentType, error: decodeErr });
        throw decodeErr;
      }
    } catch (error) {
      if (error instanceof ImageProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ImageProviderError('CLOUDFLARE_TIMEOUT', 'Cloudflare image generation timed out.');
      }
      const causeMsg = error instanceof Error && (error as any).cause
        ? String((error as any).cause)
        : (error instanceof Error ? error.message : 'Unknown network failure');
      throw new ImageProviderError(
        'CLOUDFLARE_NETWORK_ERROR',
        `Cloudflare network connection failed: ${causeMsg}`,
      );
    }
  }


  private async fromJson(
    response: Response,
    request: FloorPlanImagePromptRequest,
    startedAt: number,
    referenceDiagnostics?: ReferenceSelectionDiagnostics,
  ): Promise<GeneratedPlanImage> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ImageProviderError('CLOUDFLARE_RESPONSE_DECODE_ERROR', 'Cloudflare returned malformed JSON.');
    }
    if (payload === null || typeof payload !== 'object') {
      throw new ImageProviderError('CLOUDFLARE_RESPONSE_DECODE_ERROR', 'Cloudflare returned a non-object envelope.');
    }
    const envelope = payload as Record<string, unknown>;
    if (envelope.success === false) {
      const errors = formatCloudflareErrors(envelope.errors);
      throw new ImageProviderError('CLOUDFLARE_HTTP_ERROR', `Cloudflare reported failure: ${errors}`);
    }
    const result = envelope.result;
    const imageBase64 = typeof result === 'string'
      ? result
      : result !== null && typeof result === 'object'
        ? (result as Record<string, unknown>).image
        : undefined;
    if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
      throw new ImageProviderError('CLOUDFLARE_RESPONSE_DECODE_ERROR', 'Cloudflare response contained no image payload.');
    }
    // Inspect magic bytes of base64 image (JPEG starts with /9j/, PNG starts with iVBORw0KGgo)
    let fallbackMime: 'image/png' | 'image/jpeg' = 'image/png';
    if (imageBase64.startsWith('/9j/')) {
      fallbackMime = 'image/jpeg';
    }
    return {
      imageBase64,
      mimeType: this.mimeTypeFrom(contentTypeOf(envelope), fallbackMime),
      provider: this.name,
      model: this.model,
      seed: request.seed,
      promptVersion: request.promptVersion,
      prompt: request.prompt,
      generatedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      referenceDiagnostics,
    };
  }

  private async fromBytes(
    response: Response,
    request: FloorPlanImagePromptRequest,
    contentType: string,
    startedAt: number,
    referenceDiagnostics?: ReferenceSelectionDiagnostics,
  ): Promise<GeneratedPlanImage> {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      throw new ImageProviderError('CLOUDFLARE_RESPONSE_DECODE_ERROR', 'Cloudflare returned an empty image payload.');
    }
    return {
      imageBase64: Buffer.from(buffer).toString('base64'),
      mimeType: this.mimeTypeFrom(contentType, 'image/png'),
      provider: this.name,
      model: this.model,
      seed: request.seed,
      promptVersion: request.promptVersion,
      prompt: request.prompt,
      generatedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      referenceDiagnostics,
    };
  }

  private mimeTypeFrom(contentType: string | undefined, fallback: 'image/png' | 'image/jpeg'): 'image/png' | 'image/jpeg' {
    if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return 'image/jpeg';
    if (contentType?.includes('png')) return 'image/png';
    return fallback;
  }

  private async describeError(response: Response): Promise<string> {
    try {
      const payload: unknown = await response.json();
      if (payload !== null && typeof payload === 'object') {
        const envelope = payload as Record<string, unknown>;
        if (Array.isArray(envelope.errors) && envelope.errors.length > 0) return formatCloudflareErrors(envelope.errors);
        if (typeof envelope.message === 'string') return envelope.message;
      }
    } catch {
      // Non-JSON error body - fall through.
    }
    return '';
  }
}

function formatCloudflareErrors(errors: unknown): string {
  if (!Array.isArray(errors)) return 'unknown error';
  return errors
    .map(err => {
      if (typeof err === 'string') return err;
      if (err && typeof err === 'object') {
        const obj = err as Record<string, unknown>;
        return typeof obj.message === 'string' ? obj.message : JSON.stringify(err);
      }
      return String(err);
    })
    .join('; ');
}

function contentTypeOf(envelope: Record<string, unknown>): string | undefined {
  const contentType = envelope.contentType;
  return typeof contentType === 'string' ? contentType : undefined;
}

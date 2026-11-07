import type { AIChunk, AIRequest, AIResponse, ModelInfo } from '@ai-floor-planner/core';
import { AITaskType } from '@ai-floor-planner/core';
import { BaseAIProvider, AISafetyError } from './base';
import { REQUIREMENT_RESPONSE_SCHEMA } from '../requirements/schema';
import { asRecord, parseJsonContent, postJson, response, usage, type ProviderFetch } from './http';

export interface OpenAIProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: ProviderFetch;
}

export class OpenAIProvider extends BaseAIProvider {
  readonly name = 'openai';
  private readonly options;

  constructor(options: OpenAIProviderOptions) {
    super();
    this.options = {
      apiKey: options.apiKey,
      model: options.model ?? 'gpt-4o-mini',
      endpoint: options.endpoint ?? 'https://api.openai.com/v1/responses',
      timeoutMs: options.timeoutMs ?? 15000,
      fetchImplementation: options.fetchImplementation ?? fetch,
    };
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    if (!this.options.apiKey.trim()) throw new Error('OpenAI API key is not configured.');
    // Vision inputs are not wired for this provider; refuse rather than silently drop the image.
    if (request.images && request.images.length > 0) {
      throw new AISafetyError('OpenAIProvider does not support image inputs; use a vision-capable provider.');
    }
    const wantsJson = request.responseFormat === 'json';
    const extractsRequirements = request.taskType === AITaskType.RequirementExtraction;
    const responseSchema = request.responseSchema ?? (extractsRequirements ? REQUIREMENT_RESPONSE_SCHEMA : undefined);
    const payload = {
      model: this.options.model,
      instructions: request.systemPrompt,
      input: request.userPrompt,
      store: false,
      ...(request.maxTokens ? { max_output_tokens: request.maxTokens } : {}),
      ...(wantsJson ? {
        text: {
          format: responseSchema ? {
            type: 'json_schema',
            name: request.responseSchemaName ?? (extractsRequirements ? 'building_requirements' : 'structured_response'),
            strict: true,
            schema: responseSchema,
          } : { type: 'json_object' },
        },
      } : {}),
    };
    const result = await postJson(this.options, { Authorization: `Bearer ${this.options.apiKey}` }, payload);
    const content = this.extractOutputText(result.body);
    const parsed = wantsJson ? parseJsonContent(content) : undefined;
    const rawUsage = asRecord(result.body.usage);
    return response(
      content,
      parsed,
      usage(rawUsage.input_tokens, rawUsage.output_tokens, rawUsage.total_tokens),
      typeof result.body.model === 'string' ? result.body.model : this.options.model,
      result.latencyMs,
    );
  }

  async *stream(request: AIRequest): AsyncIterable<AIChunk> {
    const completed = await this.complete(request);
    yield { content: completed.content, isComplete: true };
  }

  async isAvailable(): Promise<boolean> {
    return this.options.apiKey.trim().length > 0;
  }

  getModelInfo(): ModelInfo {
    return { provider: this.name, model: this.options.model, contextWindow: 128000, supportsJson: true, supportsStreaming: false };
  }

  private extractOutputText(envelope: Record<string, unknown>): string {
    if (typeof envelope.output_text === 'string' && envelope.output_text.trim()) return envelope.output_text;
    const output = Array.isArray(envelope.output) ? envelope.output : [];
    for (const item of output) {
      const content = Array.isArray(asRecord(item).content) ? asRecord(item).content as unknown[] : [];
      for (const part of content) {
        const text = asRecord(part).text;
        if (typeof text === 'string' && text.trim()) return text;
      }
    }
    throw new AISafetyError('OpenAI response contained no output text.');
  }
}

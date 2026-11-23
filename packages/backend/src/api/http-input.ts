import { validateBuildingSchema } from '@ai-floor-planner/core';

export class RequestBodyTooLarge extends Error {}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function buildingInputError(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.metadata) || !Number.isSafeInteger(value.version)
    || Number(value.version) < 0 || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') {
    return 'A canonical building with metadata, timestamps and a nonnegative revision is required.';
  }
  const first = validateBuildingSchema(value)[0];
  return first ? `${first.path}: ${first.message}` : undefined;
}

export function validCadUpload(value: unknown): boolean {
  if (!isRecord(value) || typeof value.fileName !== 'string' || value.fileName.length > 255
    || !/^[^/\\\x00-\x1f]+\.(?:dxf|dwg|pdf)$/i.test(value.fileName)) return false;
  if (value.contentText !== undefined) {
    return value.contentBase64 === undefined && /\.dxf$/i.test(value.fileName)
      && typeof value.contentText === 'string' && value.contentText.length > 0;
  }
  const encoded = value.contentBase64;
  return typeof encoded === 'string' && encoded.length > 0 && encoded.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded);
}

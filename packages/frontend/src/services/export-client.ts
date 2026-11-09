import {
  canonicalRevisionJson,
  type Building,
  type ExportFileDescriptor,
  type VerifiedArtifactFormat,
  type VerifiedArtifactOptions,
} from '@ai-floor-planner/core';

export type VerifiedExportFormat = VerifiedArtifactFormat;
export type VerifiedExportOptions = VerifiedArtifactOptions;
export async function requestVerifiedExport(
  building: Building,
  format: VerifiedExportFormat,
  options: VerifiedExportOptions = {},
  signal?: AbortSignal,
): Promise<ExportFileDescriptor> {
  const response = await fetch('/api/v1/export/artifacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ building, format, options }),
    signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? `Export failed (${response.status})`);
  const descriptor = result.artifact as ExportFileDescriptor;
  const revisionHash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(canonicalRevisionJson(building)),
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (
    descriptor.revisionHash !== revisionHash ||
    descriptor.buildingId !== building.id ||
    descriptor.revision !== building.version ||
    !descriptor.verification?.isValid ||
    !descriptor.sha256 ||
    !descriptor.downloadUrl ||
    !descriptor.sizeBytes
  )
    throw new Error('Unverified or stale export response');
  return descriptor;
}
export async function fetchVerifiedBytes(
  artifact: ExportFileDescriptor,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(artifact.downloadUrl!, { signal });
  if (!response.ok) throw new Error(`Artifact download failed (${response.status})`);
  const bytes = await response.arrayBuffer();
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (bytes.byteLength !== artifact.sizeBytes || sha256 !== artifact.sha256)
    throw new Error('Artifact checksum mismatch');
  if (signal?.aborted) throw new DOMException('Export revision changed', 'AbortError');
  return new Blob([bytes], { type: artifact.mimeType });
}
export async function downloadVerifiedExport(
  artifact: ExportFileDescriptor,
  signal?: AbortSignal,
): Promise<void> {
  const blob = await fetchVerifiedBytes(artifact, signal);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = artifact.fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

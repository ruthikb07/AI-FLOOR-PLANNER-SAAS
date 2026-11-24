import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { canonicalBuildingHash } from '../models/canonical-revision';
import type { Building } from '../types/building';

export type ExchangeFormat = 'DXF' | 'IFC4X3_ADD2';
export type ExchangeElementKind = 'floor' | 'wall' | 'room' | 'door' | 'window';

export const EXCHANGE_FRAME = 'BUILDING_LOCAL_RIGHT_HANDED_Z_UP' as const;
export const EXCHANGE_MAX_BYTES = 25 * 1024 * 1024;

export interface CanonicalExchangeRevision {
  readonly buildingId: string;
  readonly projectId: string;
  readonly revision: number;
  readonly sha256: string;
}

export interface ExchangeElementMapping {
  readonly kind: ExchangeElementKind;
  readonly floorId: string;
  readonly canonicalId: string;
  readonly externalId: string;
  readonly hostWallId?: string;
}

export interface ExchangeManifest {
  readonly contractVersion: 1;
  readonly format: ExchangeFormat;
  readonly unit: 'mm';
  readonly frame: typeof EXCHANGE_FRAME;
  readonly source: CanonicalExchangeRevision;
  readonly artifactSha256: string;
  readonly elements: readonly ExchangeElementMapping[];
}

export interface ExchangeArtifact {
  readonly manifest: ExchangeManifest;
  readonly bytes: Uint8Array;
}

export interface ExchangeReadback {
  readonly maximumPositionErrorMm: number;
  readonly maximumArcDeviationMm: number;
  readonly maximumAreaErrorMm2: number;
  readonly lostCanonicalIds: readonly string[];
  readonly changedHostIds: readonly string[];
}

/** Outbound projection and independent readback boundary for a future adapter. */
export interface CanonicalExchangeAdapter {
  readonly format: ExchangeFormat;
  export(building: Building, revision: CanonicalExchangeRevision): Promise<ExchangeArtifact>;
  readback(artifact: ExchangeArtifact, expected: CanonicalExchangeRevision): Promise<ExchangeReadback>;
}

export function exchangeRevision(building: Building): CanonicalExchangeRevision {
  return { buildingId: building.id, projectId: building.projectId, revision: building.version, sha256: canonicalBuildingHash(building) };
}

export function exchangeArtifactDigest(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/** Check provenance and ID mapping before a format-specific parser receives the artifact. */
export function assertExchangeArtifact(artifact: ExchangeArtifact, building: Building): void {
  const { manifest, bytes } = artifact;
  if (manifest.contractVersion !== 1 || !['DXF', 'IFC4X3_ADD2'].includes(manifest.format)
    || manifest.unit !== 'mm' || manifest.frame !== EXCHANGE_FRAME) {
    throw new Error('Unsupported exchange contract, format, unit or coordinate frame');
  }
  const source = exchangeRevision(building);
  if (manifest.source.buildingId !== source.buildingId || manifest.source.projectId !== source.projectId
    || manifest.source.revision !== source.revision || manifest.source.sha256 !== source.sha256) {
    throw new Error('Exchange artifact refers to a different canonical revision');
  }
  if (!bytes.length || bytes.length > EXCHANGE_MAX_BYTES) throw new Error('Exchange artifact is empty or exceeds the size limit');
  if (manifest.artifactSha256 !== exchangeArtifactDigest(bytes)) throw new Error('Exchange artifact digest mismatch');

  const key = (kind: ExchangeElementKind, floor: string, id: string) => JSON.stringify([kind, floor, id]);
  const sourceElements = new Map<string, string | undefined>();
  for (const floor of building.floors) {
    sourceElements.set(key('floor', floor.id, floor.id), undefined);
    for (const wall of floor.walls) sourceElements.set(key('wall', floor.id, wall.id), undefined);
    for (const room of floor.rooms) sourceElements.set(key('room', floor.id, room.id), undefined);
    for (const door of floor.doors) sourceElements.set(key('door', floor.id, door.id), door.wallId);
    for (const window of floor.windows) sourceElements.set(key('window', floor.id, window.id), window.wallId);
  }
  if (manifest.elements.length !== sourceElements.size) throw new Error('Exchange manifest must account for every scoped canonical element');

  const externalIds = new Set<string>();
  for (const mapping of manifest.elements) {
    const id = key(mapping.kind, mapping.floorId, mapping.canonicalId);
    if (!sourceElements.has(id) || !mapping.externalId.trim() || externalIds.has(mapping.externalId)) {
      throw new Error('Exchange manifest contains an invalid or duplicate element ID');
    }
    const host = sourceElements.get(id);
    if (host !== mapping.hostWallId || (host && !building.floors.some(floor =>
      floor.id === mapping.floorId && floor.walls.some(wall => wall.id === host)))) {
      throw new Error('Exchange manifest changed an opening host');
    }
    sourceElements.delete(id);
    externalIds.add(mapping.externalId);
  }
}

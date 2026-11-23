import { expect, it } from 'vitest';
import { createBuilding, type Building } from '../index';
import { assertExchangeArtifact, exchangeArtifactDigest, exchangeRevision, type ExchangeArtifact } from '../interchange/cad-bim-adapter-contract';

const base = createBuilding({ projectId: 'adapter-fixture', name: 'Exchange sample', site: { plotWidth: 10000, plotDepth: 12000 },
  floors: [{ buildingId: '', level: 0 }] });
const floor = base.floors[0]!;
const building: Building = { ...base, floors: [{ ...floor,
  walls: [{ id: 'axis', floorId: floor.id } as typeof floor.walls[number]],
  doors: [{ id: 'entry', floorId: floor.id, wallId: 'axis' } as typeof floor.doors[number]],
}] };
const bytes = new TextEncoder().encode('contract fixture payload');
const fixture: ExchangeArtifact = { bytes, manifest: {
  contractVersion: 1, format: 'DXF', unit: 'mm', frame: 'BUILDING_LOCAL_RIGHT_HANDED_Z_UP',
  source: exchangeRevision(building), artifactSha256: exchangeArtifactDigest(bytes),
  elements: [
    { kind: 'floor', floorId: floor.id, canonicalId: floor.id, externalId: '10' },
    { kind: 'wall', floorId: floor.id, canonicalId: 'axis', externalId: '11' },
    { kind: 'door', floorId: floor.id, canonicalId: 'entry', externalId: '12', hostWallId: 'axis' },
  ],
} };

it('checks a revision-pinned, millimetre manifest independently of a format parser', () => {
  expect(() => assertExchangeArtifact(fixture, building)).not.toThrow();
  expect(() => assertExchangeArtifact(fixture, { ...building, version: building.version + 1 })).toThrow(/different canonical revision/);
  expect(() => assertExchangeArtifact(fixture, { ...building, name: 'Same version, different content' })).toThrow(/different canonical revision/);
  expect(() => assertExchangeArtifact({ ...fixture, bytes: Uint8Array.of(1, 2, 3) }, building)).toThrow(/digest mismatch/);
  expect(() => assertExchangeArtifact({ ...fixture, manifest: { ...fixture.manifest, unit: 'ft' as 'mm' } }, building)).toThrow(/coordinate frame/);
});

it('rejects incomplete, duplicated and incorrectly hosted mappings', () => {
  const [floorMapping, wall, door] = fixture.manifest.elements;
  const edited = (elements: ExchangeArtifact['manifest']['elements']): ExchangeArtifact => ({
    ...fixture, manifest: { ...fixture.manifest, elements },
  });
  expect(() => assertExchangeArtifact(edited([floorMapping!, wall!]), building)).toThrow(/account for every/);
  expect(() => assertExchangeArtifact(edited([floorMapping!, wall!, { ...door!, externalId: wall!.externalId }]), building)).toThrow(/duplicate element/);
  expect(() => assertExchangeArtifact(edited([floorMapping!, wall!, { ...door!, hostWallId: 'missing' }]), building)).toThrow(/opening host/);
});

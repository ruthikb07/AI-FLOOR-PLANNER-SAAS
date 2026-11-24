import { expect, it } from 'vitest';
import { createBuilding, createDoor, createRoom, createWall, createWindow, RoomType, type Building } from '../index';
import { assertExchangeArtifact, exchangeArtifactDigest, exchangeRevision, type ExchangeArtifact } from '../interchange/cad-bim-adapter-contract';

const base = createBuilding({ projectId: 'adapter-fixture', name: 'Exchange sample', site: { plotWidth: 10000, plotDepth: 12000 },
  floors: [{ buildingId: '', level: 0 }] });
const floor = base.floors[0]!;
const room = { ...createRoom({ floorId: floor.id, type: RoomType.Living, x: 0, y: 0, width: 5000, height: 3900 }), id: 'living' };
const wall = { ...createWall({ floorId: floor.id, roomIds: [room.id], startPoint: { x: 0, y: 0 },
  endPoint: { x: 5000, y: 0 } }), id: 'axis', hasOpening: true };
const door = { ...createDoor({ floorId: floor.id, wallId: wall.id, position: { x: 1200, y: 0 },
  connectsRooms: [room.id, '__outside__'] }), id: 'entry' };
const window = { ...createWindow({ floorId: floor.id, wallId: wall.id, position: { x: 3500, y: 0 },
  roomId: room.id }), id: 'window' };
const building: Building = { ...base, floors: [{ ...floor,
  rooms: [room], walls: [wall], doors: [door], windows: [window],
}] };
const bytes = new TextEncoder().encode('contract fixture payload');
const fixture: ExchangeArtifact = { bytes, manifest: {
  contractVersion: 1, format: 'DXF', unit: 'mm', frame: 'BUILDING_LOCAL_RIGHT_HANDED_Z_UP',
  source: exchangeRevision(building), artifactSha256: exchangeArtifactDigest(bytes),
  elements: [
    { kind: 'floor', floorId: floor.id, canonicalId: floor.id, externalId: '10' },
    { kind: 'wall', floorId: floor.id, canonicalId: 'axis', externalId: '11' },
    { kind: 'door', floorId: floor.id, canonicalId: door.id, externalId: '12', hostWallId: wall.id },
    { kind: 'room', floorId: floor.id, canonicalId: room.id, externalId: '13' },
    { kind: 'window', floorId: floor.id, canonicalId: window.id, externalId: '14', hostWallId: wall.id },
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
  const [floorMapping, wall, door, room, window] = fixture.manifest.elements;
  const edited = (elements: ExchangeArtifact['manifest']['elements']): ExchangeArtifact => ({
    ...fixture, manifest: { ...fixture.manifest, elements },
  });
  expect(() => assertExchangeArtifact(edited([floorMapping!, wall!]), building)).toThrow(/account for every/);
  expect(() => assertExchangeArtifact(edited([floorMapping!, wall!, { ...door!, externalId: wall!.externalId }, room!, window!]), building))
    .toThrow(/duplicate element/);
  expect(() => assertExchangeArtifact(edited([floorMapping!, wall!, door!, room!, { ...window!, hostWallId: 'missing' }]), building))
    .toThrow(/opening host/);
});

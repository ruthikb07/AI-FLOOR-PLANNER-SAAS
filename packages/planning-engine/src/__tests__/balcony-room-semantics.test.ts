import { describe, expect, it } from 'vitest';
import { RoomType, type Floor, type Room } from '@ai-floor-planner/core';
import { apartmentRoomRoles } from '../interpretation/apartment-plan';
import { furnishRoom } from '../plancraft/auto-furnish-apartment';

describe('host-qualified outdoor room names', () => {
  it.each(['Master Bedroom Balcony', 'Bedroom 02 Balcony', 'Living Sit-out', 'Kitchen Utility Balcony'])(
    'classifies %s as outdoor rather than its host room', name => {
      expect(apartmentRoomRoles(name)).toEqual(['balcony']);
    },
  );
  it.each([RoomType.Balcony, RoomType.Bedroom])('never puts beds on a bedroom balcony, including legacy %s records', type => {
    const room = { id: 'bed-balcony', name: 'Master Bedroom Balcony', type, tags: [],
      x: 0, y: 0, width: 1500, height: 9000, area: 13500000 } as unknown as Room;
    expect(furnishRoom(room, { doors: [], windows: [] } as unknown as Floor)).toEqual([]);
  });
  it('keeps actual bedroom semantics intact', () => {
    expect(apartmentRoomRoles('Master Bedroom')).toEqual(['bedroom']);
  });
});

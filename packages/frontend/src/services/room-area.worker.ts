import type { Building } from '@ai-floor-planner/core';
import { optimizeRoomArea, type RoomAreaRegenerationOptions } from '@ai-floor-planner/planning-engine';
self.onmessage = (event: MessageEvent<{ building: Building; roomId: string; options: RoomAreaRegenerationOptions }>) => {
  try {
    const { building, roomId, options } = event.data;
    self.postMessage({ result: optimizeRoomArea(building, roomId, options) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};

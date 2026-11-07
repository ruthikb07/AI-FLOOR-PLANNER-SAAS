import { writeFileSync } from 'node:fs';
import type { CandidatePlan } from '@ai-floor-planner/core';

/** Opt-in local audit artifact; never consumed by generation or ranking. */
export function recordPlacementBenchmark(candidates: readonly CandidatePlan[]) {
  if (!process.env.PLACEMENT_REPORT) return;
  writeFileSync(process.env.PLACEMENT_REPORT, JSON.stringify(candidates.map(candidate => {
    const evidence = candidate.architecturalEvidence!;
    const rooms = candidate.building.floors.flatMap(floor => floor.rooms);
    return { id: candidate.id, name: candidate.name, description: candidate.description,
      strategy: candidate.strategy, rank: candidate.rank, score: candidate.metrics.overallQualityScore,
      hardValid: candidate.validation.isValid, required: evidence.requiredFloors,
      suites: evidence.suites, wet: evidence.wetStacking, closeout: evidence.closeout,
      openSpace: evidence.openSpace, repair: candidate.optimization,
      geometry: rooms.map(room => ({ id: room.id, name: room.name, floorId: room.floorId, type: room.type,
        tags: room.tags, x: room.x, y: room.y, width: room.width, height: room.height,
        aspect: Math.max(room.width, room.height) / Math.min(room.width, room.height) })),
      topology: candidate.building.floors.map(floor => ({ level: floor.level, doors: floor.doors.map(door =>
        door.connectsRooms.map(id => rooms.find(room => room.id === id)?.name ?? id)) })),
      building: candidate.building,
    };
  }), null, 2));
}

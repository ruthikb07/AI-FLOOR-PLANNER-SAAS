import type { Building, Room } from '@ai-floor-planner/core';
import { RoomType } from '@ai-floor-planner/core';
import { sourceProgramItemId } from '../graph/scorer';

const FUNCTIONAL = new Set([RoomType.Living, RoomType.FamilyLiving, RoomType.Drawing,
  RoomType.Dining, RoomType.Kitchen, RoomType.Utility, RoomType.Storage, RoomType.OTS, RoomType.Dressing]);
const DISTRIBUTION = new Set([RoomType.Corridor, RoomType.Foyer, RoomType.Staircase, RoomType.Lift, RoomType.Porch]);

export interface CandidateDiversityEvidence {
  readonly accessEdges: readonly string[];
  /** Components connected without walking through distribution/private rooms. */
  readonly functionalClusters: readonly (readonly string[])[];
  readonly floorAssignments: readonly string[];
  readonly distributionAccess: readonly string[];
  readonly signature: string;
}

function identity(room: Room): string {
  const tag = room.tags.find(value => value.startsWith('program:'));
  return tag ? sourceProgramItemId(tag.slice(8)) : `unmapped:${room.type}`;
}

/** For hard-valid canonical candidates, compare organization, not UUIDs, names,
 * millimetre jitter or scores. Optional rooms only contribute if materialized. */
export function candidateDiversityEvidence(building: Building): CandidateDiversityEvidence {
  const accessEdges: string[] = [], floorAssignments: string[] = [], distributionAccess: string[] = [];
  const functionalClusters: string[][] = [];
  for (const floor of building.floors) {
    const rooms = new Map(floor.rooms.map(room => [room.id, room]));
    const key = (room: Room) => `${floor.level}:${identity(room)}`;
    const edges = floor.doors.flatMap(door => {
      const a = rooms.get(door.connectsRooms[0]), b = rooms.get(door.connectsRooms[1]);
      return a && b ? [[a, b] as const] : [];
    });
    floor.rooms.filter(room => !DISTRIBUTION.has(room.type)).forEach(room => floorAssignments.push(key(room)));
    edges.forEach(([a, b]) => {
      accessEdges.push([key(a), key(b)].sort().join('~'));
      if (DISTRIBUTION.has(a.type) !== DISTRIBUTION.has(b.type)) distributionAccess.push(key(DISTRIBUTION.has(a.type) ? b : a));
    });
    const functional = floor.rooms.filter(room => FUNCTIONAL.has(room.type));
    const unseen = new Set(functional.map(room => room.id));
    for (const root of functional) {
      if (!unseen.delete(root.id)) continue;
      const queue = [root];
      for (let index = 0; index < queue.length; index++) {
        const current = queue[index]!;
        for (const [a, b] of edges) {
          const next = a.id === current.id ? b : b.id === current.id ? a : undefined;
          if (next && FUNCTIONAL.has(next.type) && unseen.delete(next.id)) queue.push(next);
        }
      }
      functionalClusters.push(queue.map(key).sort());
    }
  }
  const unique = (values: string[]) => [...new Set(values)].sort();
  functionalClusters.sort((a, b) => a.join('|').localeCompare(b.join('|')));
  const data = { accessEdges: unique(accessEdges), functionalClusters,
    floorAssignments: unique(floorAssignments), distributionAccess: unique(distributionAccess) };
  return { ...data, signature: JSON.stringify(data) };
}

/** A split/merged functional cluster must change the relationship of at least
 * two present Program spaces. A single changed coordinate/label never qualifies.
 * Floor redistribution of two rooms is also organizational (legacy layouts). */
export function compareCandidateDiversity(a: CandidateDiversityEvidence, b: CandidateDiversityEvidence) {
  const difference = (left: readonly string[], right: readonly string[]) =>
    [...left.filter(item => !right.includes(item)), ...right.filter(item => !left.includes(item))];
  const members = new Set(a.functionalClusters.flat().filter(member => b.functionalClusters.flat().includes(member)));
  const changedClusterMembers = [...members].filter(member => {
    const left = a.functionalClusters.find(cluster => cluster.includes(member));
    const right = b.functionalClusters.find(cluster => cluster.includes(member));
    return !!left && !!right && left.filter(item => members.has(item)).join('|') !== right.filter(item => members.has(item)).join('|');
  }).sort();
  const programId = (value: string) => value.slice(value.indexOf(':') + 1);
  const commonProgram = new Set(a.floorAssignments.map(programId).filter(id => b.floorAssignments.some(item => programId(item) === id)));
  const floorChanges = difference(a.floorAssignments.filter(item => commonProgram.has(programId(item))),
    b.floorAssignments.filter(item => commonProgram.has(programId(item))));
  return { meaningful: changedClusterMembers.length >= 2 || floorChanges.length >= 4,
    changedClusterMembers, changedAccessEdges: difference(a.accessEdges, b.accessEdges).sort(),
    changedFloorAssignments: floorChanges.sort() };
}

export function organizationDescription(building: Building): string {
  const evidence = candidateDiversityEvidence(building);
  return `${evidence.functionalClusters.length} common/service door-connected groups across ${building.floors.length} floor(s); `
    + `${evidence.distributionAccess.length} spaces connect directly to distribution. No daylight or professional-approval claim.`;
}

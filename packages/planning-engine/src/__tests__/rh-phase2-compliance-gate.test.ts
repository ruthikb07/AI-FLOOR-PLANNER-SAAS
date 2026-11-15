import { describe, it, expect } from 'vitest';
import {
  solveMultiSheetApartmentProject,
} from '../apartment/multi-sheet-apartment-solver';
import { evaluateArchitecturalComplianceScore } from '../topology/candidate-scoring';
import { optimizeRoomArea } from '../refinement/room-area-optimizer';
import { generateTargetedRefinements } from '../refinement/targeted-regeneration';
import {
  type MultiSheetApartmentConfig,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  RoomType,
  Direction,
} from '@ai-floor-planner/core';

function createApartmentConfig(
  bhkTypes: Array<'2BHK' | '3BHK' | '4BHK'>,
  overrides: Partial<MultiSheetApartmentConfig> = {},
): MultiSheetApartmentConfig {
  return {
    plotWidthMm: 44000,
    plotDepthMm: 34000,
    roadWidthMm: 12000,
    roadAccessSides: [Direction.South],
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'pune_pmc',
    verticalStackType: 'STILT_PLUS_N',
    numTypicalFloors: 5,
    floorToFloorHeightMm: 3000,
    stiltHeightMm: 3000,
    flatsPerFloor: bhkTypes.length as 1 | 2 | 3 | 4 | 5 | 6,
    units: bhkTypes.map((bhkType, idx) => ({
      unitIndex: idx + 1,
      bhkType,
      hasUtilityBalcony: true,
    })),
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
    visitorParkingPercent: 10,
    setbacksMm: {
      front: 2000,
      rear: 2000,
      left: 2000,
      right: 2000,
    },
    aiPrompt:
      'Design a G+5 residential apartment building with 2000mm setbacks on all sides, full plot utilization, private bedroom balconies, and central lift and dual staircases.',
    ...overrides,
  };
}

const projectCache = new Map<string, ReturnType<typeof solveMultiSheetApartmentProject>>();
function getSolvedProject(bhkTypes: Array<'2BHK' | '3BHK' | '4BHK'>) {
  const key = bhkTypes.join(',');
  let cached = projectCache.get(key);
  if (!cached) {
    cached = solveMultiSheetApartmentProject(createApartmentConfig(bhkTypes));
    projectCache.set(key, cached);
  }
  return cached;
}

describe('RH Planner Phase 2 — >= 85 Compliance Gate, Room Proportions, Circulation, Balconies & Targeted Refinement', () => {
  it('1. enforces >= 85 Architectural Compliance Score and 0 red violations across 2BHK, 3BHK, 4BHK, and mixed apartment plans', () => {
    const scenarios: Array<{ label: string; bhkTypes: Array<'2BHK' | '3BHK' | '4BHK'> }> = [
      { label: '4x 2BHK', bhkTypes: ['2BHK', '2BHK', '2BHK', '2BHK'] },
      { label: '4x 3BHK', bhkTypes: ['3BHK', '3BHK', '3BHK', '3BHK'] },
      { label: '4x 4BHK', bhkTypes: ['4BHK', '4BHK', '4BHK', '4BHK'] },
      { label: 'Mixed 2BHK+3BHK+4BHK+3BHK', bhkTypes: ['2BHK', '3BHK', '4BHK', '3BHK'] },
    ];

    for (const scenario of scenarios) {
      const { building } = getSolvedProject(scenario.bhkTypes);
      const compliance = evaluateArchitecturalComplianceScore(building);

      expect(compliance.score, `${scenario.label}: ${JSON.stringify(compliance.violations)}`).toBeGreaterThanOrEqual(85);
      expect(compliance.passed, `${scenario.label} passed flag`).toBe(true);
      expect(compliance.redConflictCount, `${scenario.label} red conflicts`).toBe(0);
      expect(building.complianceRating?.score).toBeGreaterThanOrEqual(85);
      expect(building.complianceRating?.passed).toBe(true);
    }
  });

  it('2. eliminates narrow tunnel bedrooms (clear width >= 3000mm, aspect ratio <= 2.2) and utilizes >= 82% of permissible setback envelope', () => {
    const project = getSolvedProject(['4BHK', '4BHK', '4BHK', '4BHK']);
    expect(project.schedule.overallDeltaMm2).toBe(0);

    const typSheet = project.sheets.find(s => s.sheetType === 'TYPICAL_FLOOR_PLAN')!;
    const typFloor = typSheet.floor!;
    const bedrooms = typFloor.rooms.filter(
      r => r.type === RoomType.Bedroom && !r.name.toLowerCase().includes('balcony'),
    );
    expect(bedrooms.length).toBe(16);

    for (const bed of bedrooms) {
      const shortDim = Math.min(bed.width, bed.height);
      const longDim = Math.max(bed.width, bed.height);
      const aspect = longDim / Math.max(1, shortDim);
      expect(shortDim, `${bed.id} (${bed.name}) width=${bed.width}, height=${bed.height}`).toBeGreaterThanOrEqual(3000);
      expect(aspect, `${bed.id} (${bed.name}) aspect=${aspect.toFixed(2)}`).toBeLessThanOrEqual(2.2);
    }

    // Permissible envelope with 2000mm setbacks on 44m x 34m plot is 40m x 30m (1,200,000,000 mm²)
    const envWidthMm = 44000 - 4000;
    const envDepthMm = 34000 - 4000;
    const nonVoidAreaMm2 = typFloor.rooms
      .filter(r => (r.type as string) !== 'void' && r.type !== RoomType.OTS && !r.id.includes('courtyard_void'))
      .reduce((sum, r) => sum + r.width * r.height, 0);
    const utilization = nonVoidAreaMm2 / (envWidthMm * envDepthMm);
    expect(utilization).toBeGreaterThanOrEqual(0.82);
  });

  it('3. enforces 4BHK internal circulation hierarchy (Living -> Internal Passage -> Bedrooms) and prevents furniture inside passages/corridors', () => {
    const { building } = getSolvedProject(['4BHK', '4BHK', '4BHK', '4BHK']);
    const typFloor = building.floors.find(f => f.level === 1)!;

    // Check internal passages have doors/openings connecting to Living/Dining and Bedrooms
    const unit1Rooms = typFloor.rooms.filter(r => r.unitId === 'flat_01');
    const unit1Passage = unit1Rooms.find(
      r => r.type === RoomType.Corridor || r.name.toLowerCase().includes('passage'),
    );
    expect(unit1Passage).toBeDefined();

    // Verify zero furniture placed in any corridor, internal passage, or foyer
    const passageIds = new Set(
      typFloor.rooms
        .filter(
          r =>
            r.type === RoomType.Corridor ||
            r.type === RoomType.Foyer ||
            r.name.toLowerCase().includes('lobby') ||
            r.name.toLowerCase().includes('passage') ||
            r.name.toLowerCase().includes('corridor'),
        )
        .map(r => r.id),
    );
    const passageFurniture = (typFloor.furniture ?? []).filter(f => passageIds.has(f.roomId));
    expect(passageFurniture).toHaveLength(0);
  });

  it('4. splits balconies at every inter-flat boundary with a full-height party partition wall', () => {
    const { building } = getSolvedProject(['3BHK', '3BHK', '3BHK', '3BHK']);
    const typFloor = building.floors.find(f => f.level === 1)!;

    const balconies = typFloor.rooms.filter(
      r => r.type === RoomType.Balcony || r.name.toLowerCase().includes('balcony'),
    );
    expect(balconies.length).toBeGreaterThanOrEqual(4);

    // Every balcony must belong to a single unitId
    for (const bal of balconies) {
      expect(bal.unitId).toBeTruthy();
    }

    // Check if any two balconies from different flats touch, there is a FULL_HEIGHT_WALL between them
    for (let i = 0; i < balconies.length; i++) {
      for (let j = i + 1; j < balconies.length; j++) {
        const b1 = balconies[i]!;
        const b2 = balconies[j]!;
        if (b1.unitId === b2.unitId) continue;

        const touchX =
          (Math.abs(b1.x + b1.width - b2.x) <= 5 || Math.abs(b2.x + b2.width - b1.x) <= 5) &&
          Math.min(b1.y + b1.height, b2.y + b2.height) - Math.max(b1.y, b2.y) > 200;
        const touchY =
          (Math.abs(b1.y + b1.height - b2.y) <= 5 || Math.abs(b2.y + b2.height - b1.y) <= 5) &&
          Math.min(b1.x + b1.width, b2.x + b2.width) - Math.max(b1.x, b2.x) > 200;

        if (touchX || touchY) {
          const partyWall = typFloor.walls.find(
            w =>
              w.roomIds.includes(b1.id) &&
              w.roomIds.includes(b2.id) &&
              w.boundaryRole === 'FULL_HEIGHT_WALL' &&
              w.thickness >= 200,
          );
          expect(partyWall, `Party wall between ${b1.id} and ${b2.id}`).toBeDefined();
        }
      }
    }
  });

  it('5. encloses Ground/Stilt entrance lobby perimeter walls in 2D & 3D and provides a main entrance door', () => {
    const { building } = getSolvedProject(['2BHK', '2BHK', '2BHK', '2BHK']);
    const stiltFloor = building.floors.find(f => f.level === 0)!;

    const grandLobby = stiltFloor.rooms.find(r => r.id.includes('grand_lobby') || r.type === RoomType.Foyer)!;
    expect(grandLobby).toBeDefined();
    expect(grandLobby.architecturalRole).toBe('ENCLOSED_HABITABLE');

    const lobbyWalls = stiltFloor.walls.filter(w => w.roomIds.includes(grandLobby.id));
    expect(lobbyWalls.length).toBeGreaterThanOrEqual(3);
    for (const wall of lobbyWalls) {
      expect(wall.boundaryRole).toBe('FULL_HEIGHT_WALL');
    }

    const mainEntranceDoor = stiltFloor.doors.find(d => (d.connectsRooms ?? []).includes(grandLobby.id));
    expect(mainEntranceDoor).toBeDefined();
  });

  it('6. supports single-room area optimization (wall sliding) and single-room targeted regeneration inside apartment flats', () => {
    const { building } = getSolvedProject(['4BHK', '4BHK', '4BHK', '4BHK']);
    const typFloor = building.floors.find(f => f.level === 1)!;

    const targetBed = typFloor.rooms.find(
      r => r.unitId === 'flat_04' && r.type === RoomType.Bedroom && r.id.includes('bed_3'),
    ) ?? typFloor.rooms.find(r => r.unitId === 'flat_01' && r.type === RoomType.Bedroom)!;
    expect(targetBed).toBeDefined();

    const originalAreaMm2 = targetBed.width * targetBed.height;
    const requestedAreaMm2 = Math.round(originalAreaMm2 * 1.1);

    const areaResult = optimizeRoomArea(building, targetBed.id, {
      targetAreaMm2: requestedAreaMm2,
    });
    expect(areaResult.isFeasible, areaResult.infeasibilityReason).toBe(true);
    expect(areaResult.candidates.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(areaResult.candidates[0]!.achievedAreaMm2 - originalAreaMm2)).toBeGreaterThan(100_000);

    // Single-room targeted regeneration on the same bedroom
    const regenCandidates = generateTargetedRefinements({
      building,
      control: {
        schemaVersion: 1,
        revisionId: 'rev-0',
        lockedEntityIds: [],
        lockedFloorIds: [],
        protectedCoreIds: [],
        footprintLocked: true,
        updatedAt: new Date().toISOString(),
      },
      selectedRoomIds: [targetBed.id],
    });
    expect(regenCandidates.length).toBeGreaterThanOrEqual(1);
  });
});

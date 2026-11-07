/**
 * TWO-PHASE upgrade, Phase 1 — deterministic apartment planning.
 * PROGRAM → FEASIBILITY → SPATIAL RELATIONSHIP GRAPH → DETERMINISTIC LAYOUT,
 * four controlled strategies with identical hard requirements.
 */
import { describe, expect, it } from 'vitest';
import {
  APARTMENT_CONCEPT_STRATEGIES,
  COMMON_LOBBY_ID,
  type ApartmentLayoutStrategy,
} from '../apartment/layout-planner';
import { generateDeterministicApartmentSchematic, type DeterministicApartmentSchematic } from '../apartment/schematic';
import { buildApartmentGenerationManifest, validateSchematicMatchesManifest } from '../apartment/manifest';
import { renderSchematicPng512 } from '../apartment/schematic-renderer';
import { getApartmentRulesProfile } from '../apartment/jurisdiction';
import type { ApartmentBriefConfig } from '../types/apartment';

const STRATEGIES = APARTMENT_CONCEPT_STRATEGIES.map(s => s.id);
const rules = getApartmentRulesProfile('pune_pmc', { floorCount: 4, buildingHeightM: 12.4, tenementsPerFloor: 2 });

/** Acceptance scenario: 2 flats (1 × 2BHK + 1 × 3BHK), 2 lifts, 2 stairs, 1 common lobby. */
const acceptanceMix = [
  { unitType: '2BHK', count: 1, carpetAreaSqFt: 700 },
  { unitType: '3BHK', count: 1, carpetAreaSqFt: 1000 },
];

function plan(strategy: ApartmentLayoutStrategy, flats = 2, mix: ReadonlyArray<{ unitType: string; count: number; carpetAreaSqFt?: number }> = acceptanceMix, site = { w: 45, d: 50 }) {
  return generateDeterministicApartmentSchematic({
    siteWidthM: site.w,
    siteDepthM: site.d,
    setbacksM: { front: 3, rear: 2, left: 2, right: 2 },
    flatsPerFloor: flats,
    unitMix: mix,
    commonCoreConfig: { passengerLifts: 2, staircaseCount: 2, commonLobby: true },
    rulesProfile: rules,
    strategy,
  });
}

function brief(flats: number, mix: ApartmentBriefConfig['unitMix']): ApartmentBriefConfig {
  return {
    projectType: 'apartment',
    jurisdiction: 'pune_pmc',
    floorCount: 4,
    flatsPerFloor: flats,
    unitMix: mix,
    commonCore: { passengerLifts: 2, serviceLifts: 0, staircaseCount: 2, fireStaircaseRequired: true, commonLobby: true },
    parking: { residentParkingCount: flats, visitorParkingCount: 1 },
    amenities: { groundSiteAmenities: [], buildingAmenities: [] },
  };
}

const roomsOf = (s: DeterministicApartmentSchematic, flatIdx: number) => [...s.units[flatIdx]!.rooms, ...s.units[flatIdx]!.balconies];

describe('Phase 1 — four controlled concept strategies', () => {
  it('defines EXACTLY four strategies in candidate order', () => {
    expect(APARTMENT_CONCEPT_STRATEGIES.map(s => [s.candidateNumber, s.id])).toEqual([
      [1, 'balanced'], [2, 'daylight'], [3, 'privacy'], [4, 'circulation'],
    ]);
  });

  it.each(STRATEGIES)('%s: same hard requirements as the manifest (flats, mix, bedrooms, core)', strategy => {
    const s = plan(strategy);
    const manifest = buildApartmentGenerationManifest({
      site: { plotWidthMm: 45000, plotDepthMm: 50000, setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 } },
      apartmentConfig: brief(2, acceptanceMix),
      rulesProfile: rules,
    });
    const check = validateSchematicMatchesManifest(s, manifest);
    expect(check.discrepancies).toEqual([]);
    expect(check.matches).toBe(true);
    expect(s.strategy).toBe(strategy);
    expect(s.units.map(u => u.unitType)).toEqual(['2BHK', '3BHK']);
    expect(s.core.lifts).toHaveLength(2);
    expect(s.core.stairs).toHaveLength(2);
    const beds = (i: number) => roomsOf(s, i).filter(r => r.type === 'master_bedroom' || r.type === 'bedroom').length;
    expect(beds(0)).toBe(2);
    expect(beds(1)).toBe(3);
  });

  it('strategies produce genuinely different organisations (not seed noise)', () => {
    const signatures = STRATEGIES.map(st => {
      const s = plan(st);
      return JSON.stringify({ lifts: s.core.lifts.map(l => l.bounds), units: s.units.map(u => u.bodyBounds), fp: s.buildingFootprint });
    });
    expect(new Set(signatures).size).toBe(4);
    // Privacy staggers the entrances; balanced mirrors them.
    const entranceDy = (st: ApartmentLayoutStrategy) => {
      const s = plan(st);
      // Entrance doors sit in the lobby side walls; measure the offset along that wall.
      const along = s.doors.find(d => d.id === s.units[0]!.entranceDoorId)!.wallAxis;
      return Math.abs(s.units[0]!.entrancePoint[along] - s.units[1]!.entrancePoint[along]);
    };
    expect(entranceDy('privacy')).toBeGreaterThan(entranceDy('balanced') + 1.0);
    // Circulation groups the lifts beside stair 1.
    const circ = plan('circulation');
    const [l1, l2] = circ.core.lifts.map(l => l.bounds);
    const sameRow = Math.abs(l1!.y - l2!.y) < 1e-6 || Math.abs(l1!.x - l2!.x) < 1e-6;
    expect(sameRow).toBe(true);
  });

  it('is deterministic: same input ⇒ identical schematic', () => {
    for (const st of STRATEGIES) {
      expect(JSON.stringify(plan(st))).toBe(JSON.stringify(plan(st)));
    }
  });
});

describe('Phase 1 — spatial relationship graph & apartment logic', () => {
  it.each(STRATEGIES)('%s: every spatial check passes', strategy => {
    const s = plan(strategy);
    expect(s.layoutFits).toBe(true);
    expect(s.spatialChecks.filter(c => c.status === 'FAIL')).toEqual([]);
    const codes = new Set(s.spatialChecks.map(c => c.code));
    for (const code of [
      'FLAT_ENTRANCE_SINGLE', 'ENTRANCE_TO_FOYER', 'LOBBY_NOT_INTO_PRIVATE', 'FOYER_TO_LIVING', 'DINING_KITCHEN',
      'KITCHEN_UTILITY', 'MASTER_ENSUITE', 'BEDROOM_ACCESS', 'COMMON_BATH_ACCESS', 'ALL_ROOMS_REACHABLE',
      'HABITABLE_ON_EXTERNAL_EDGE', 'WET_SERVICE_STACK', 'LOBBY_SERVES_ALL_FLATS', 'CORE_OPENS_TO_LOBBY',
      'NO_OVERLAPS', 'FLATS_SEPARATED',
    ]) {
      expect(codes.has(code)).toBe(true);
    }
  });

  it.each(STRATEGIES)('%s: COMMON LOBBY → ENTRANCE → FOYER → LIVING/DINING (never a bedroom or bath)', strategy => {
    const s = plan(strategy);
    for (const u of s.units) {
      const entrance = s.doors.find(d => d.id === u.entranceDoorId)!;
      expect(entrance.kind).toBe('flat_entrance');
      expect(entrance.connects).toContain(COMMON_LOBBY_ID);
      const inside = entrance.connects.find(id => id !== COMMON_LOBBY_ID)!;
      const room = u.rooms.find(r => r.id === inside)!;
      expect(room.type).toBe('foyer');
      expect(room.zone).toBe('PUBLIC');
      const ld = u.rooms.find(r => r.type === 'living_dining')!;
      expect(s.doors.some(d => d.connects.includes(room.id) && d.connects.includes(ld.id))).toBe(true);
      // No lobby door into any private or service room.
      const lobbyDoors = s.doors.filter(d => d.connects.includes(COMMON_LOBBY_ID) && d.flatId === u.flatId);
      expect(lobbyDoors).toHaveLength(1);
    }
  });

  it('zones rooms PUBLIC / SERVICE / PRIVATE and keeps wet rooms in the service stack', () => {
    const s = plan('balanced');
    for (const u of s.units) {
      for (const r of u.rooms) {
        if (r.type === 'foyer' || r.type === 'living_dining') expect(r.zone).toBe('PUBLIC');
        if (r.type === 'kitchen' || r.type === 'utility' || r.type === 'common_toilet') expect(r.zone).toBe('SERVICE');
        if (r.type === 'master_bedroom' || r.type === 'bedroom') {
          expect(r.zone).toBe('PRIVATE');
          expect(r.onFacade).toBe(true);
        }
      }
      expect(u.rooms.find(r => r.type === 'living_dining')!.onFacade).toBe(true);
    }
  });

  it('doors are canonical objects with type, width and swing', () => {
    const s = plan('balanced');
    expect(s.doors.length).toBeGreaterThan(10);
    for (const d of s.doors) {
      expect(['single', 'double', 'sliding', 'open_passage']).toContain(d.doorType);
      expect(d.widthM).toBeGreaterThanOrEqual(0.6);
      expect(d.widthM).toBeLessThanOrEqual(1.5);
      expect(['inward', 'outward', 'left', 'right']).toContain(d.swing);
      expect(d.connects).toHaveLength(2);
    }
  });
});

describe('Phase 1 — area control and feasibility', () => {
  it.each(STRATEGIES)('%s: each flat is sized from its target (±15%%), FLUX never decides areas', strategy => {
    const s = plan(strategy);
    for (const report of s.areaReport.units) {
      expect(Math.abs(report.deviationPct)).toBeLessThanOrEqual(15);
      expect(report.status).not.toBe('FAIL');
      const beds = report.lines.find(l => l.category === 'bedrooms')!;
      expect(beds.actualSqM).toBeGreaterThanOrEqual(beds.targetSqM - 0.01);
    }
    const f = s.areaReport.floor;
    expect(f.fits).toBe(true);
    expect(f.unitsSqM + f.coreSqM + f.lobbySqM).toBeLessThanOrEqual(f.buildableSqM);
    // The 3BHK really is larger than the 2BHK.
    expect(s.units[1]!.actualCarpetAreaSqM).toBeGreaterThan(s.units[0]!.actualCarpetAreaSqM * 1.25);
  });

  it('FEASIBILITY FAIL when the programme cannot fit the buildable envelope (no silent shrink)', () => {
    const s = plan('balanced', 2, acceptanceMix, { w: 15, d: 60 });
    expect(s.layoutFits).toBe(false);
    expect(s.areaReport.floor.message).toMatch(/^FEASIBILITY FAIL/);
    const manifest = buildApartmentGenerationManifest({
      site: { plotWidthMm: 15000, plotDepthMm: 60000, setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 } },
      apartmentConfig: brief(2, acceptanceMix),
      rulesProfile: rules,
    });
    const check = validateSchematicMatchesManifest(s, manifest);
    expect(check.matches).toBe(false);
    expect(check.feasibilityFail).toBe(true);
  });

  it('compacts deterministically (deeper service band) before declaring a narrow plot infeasible', () => {
    const s = generateDeterministicApartmentSchematic({
      siteWidthM: 18.288, siteDepthM: 30.48, setbacksM: { front: 3, rear: 2, left: 2, right: 2 },
      flatsPerFloor: 2,
      unitMix: [{ unitType: '2BHK', count: 1, carpetAreaSqFt: 850 }, { unitType: '3BHK', count: 1, carpetAreaSqFt: 1200 }],
      commonCoreConfig: { passengerLifts: 2, staircaseCount: 2 },
      rulesProfile: getApartmentRulesProfile('mumbai_mcgm', { floorCount: 5, tenementsPerFloor: 2 }),
    });
    expect(s.layoutFits).toBe(true);
    expect(s.layoutAdaptations.length).toBeGreaterThan(0);
    expect(s.spatialChecks.filter(c => c.status === 'FAIL')).toEqual([]);
  });
});

describe('Phase 1 — test matrix (2, 3, 4 flats + generalized cases)', () => {
  const cases: Array<[number, Array<{ unitType: string; count: number }>]> = [
    [1, [{ unitType: '3BHK', count: 1 }]],
    [2, [{ unitType: '2BHK', count: 2 }]],
    [3, [{ unitType: '2BHK', count: 2 }, { unitType: '3BHK', count: 1 }]],
    [4, [{ unitType: '2BHK', count: 2 }, { unitType: '3BHK', count: 2 }]],
    [4, [{ unitType: '1BHK', count: 2 }, { unitType: '2BHK', count: 2 }]],
    [6, [{ unitType: '2BHK', count: 6 }]],
  ];
  it.each(cases)('%d flats %j: all four strategies fit and pass every spatial check', (n, mix) => {
    for (const st of STRATEGIES) {
      const s = plan(st, n, mix);
      expect(s.units).toHaveLength(n);
      expect(s.layoutFits).toBe(true);
      expect(s.spatialChecks.filter(c => c.status === 'FAIL')).toEqual([]);
      const png = renderSchematicPng512(s);
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    }
  });
});

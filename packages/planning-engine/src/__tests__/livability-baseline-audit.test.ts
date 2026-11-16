/**
 * LIVABILITY BASELINE AUDIT — the "before" column for docs/specs/LIVABILITY_STANDARDS.md.
 *
 * Measures the engine against the metrics the livability standard formalizes and
 * prints a table. It deliberately asserts nothing about quality: its job is to
 * keep the measured baseline reproducible, so later passes can show real
 * before/after movement instead of claimed improvement. The thresholds in the
 * standard were calibrated from this output rather than invented.
 *
 * A professional review previously flagged four problems; each metric below
 * targets one of them:
 *   - wasted space            → carpet ratio, circulation share, unassigned
 *   - weak ventilation/light  → facade-touching habitable rooms, windowless rooms
 *   - unclear outer/inner walls → external vs internal wall classification
 *   - illogical relationships → toilets onto living/dining, bedroom off main door,
 *                               habitable rooms used as passages
 */

import { describe, it, expect } from 'vitest';
import {
  Direction,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  RoomType,
  type Building,
  type Floor,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { polygonArea } from '@ai-floor-planner/geometry-engine';
import { solveMultiSheetApartmentProject } from '../apartment/multi-sheet-apartment-solver';

const SQM = 1_000_000;

interface Scenario {
  readonly label: string;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly flats: 2 | 3 | 4;
  readonly bhk: '1BHK' | '2BHK' | '3BHK';
}

const SCENARIOS: readonly Scenario[] = [
  { label: 'small 18x25', widthMm: 18000, depthMm: 25000, flats: 2, bhk: '2BHK' },
  { label: 'medium 25x30', widthMm: 25000, depthMm: 30000, flats: 2, bhk: '2BHK' },
  { label: 'standard 36x40', widthMm: 36000, depthMm: 40000, flats: 4, bhk: '2BHK' },
  { label: 'large 40x50', widthMm: 40000, depthMm: 50000, flats: 4, bhk: '2BHK' },
  { label: 'wide 50x30', widthMm: 50000, depthMm: 30000, flats: 4, bhk: '2BHK' },
  { label: 'narrow 20x45', widthMm: 20000, depthMm: 45000, flats: 2, bhk: '2BHK' },
  { label: 'large 3BHK 40x50', widthMm: 40000, depthMm: 50000, flats: 4, bhk: '3BHK' },
];

function config(s: Scenario): MultiSheetApartmentConfig {
  const setback = s.widthMm < 22000 ? 1500 : 3000;
  return {
    projectId: `audit-${s.label.replace(/\s+/g, '-')}`,
    projectName: `Audit ${s.label}`,
    aiPrompt: 'Four flats with bedroom balconies, functional bathroom ventilation and living-first entrances.',
    structuralLayoutMode: 'DEFERRED',
    plotWidthMm: s.widthMm,
    plotDepthMm: s.depthMm,
    roadWidthMm: 12000,
    roadAccessSides: [Direction.North],
    setbacksMm: { front: setback + 1500, rear: setback, left: setback, right: setback },
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'generic_maharashtra',
    verticalStackType: 'G_PLUS_N',
    numTypicalFloors: 4,
    flatsPerFloor: s.flats,
    units: Array.from({ length: s.flats }, (_, i) => ({
      unitIndex: i + 1, bhkType: s.bhk, hasUtilityBalcony: true,
    })),
    floorToFloorHeightMm: 3150,
    stiltHeightMm: 3150,
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
  };
}

const HABITABLE = new Set<string>([
  RoomType.Living, RoomType.Dining, RoomType.Bedroom, RoomType.Kitchen,
  RoomType.Study, RoomType.FamilyLiving, RoomType.Drawing,
]);
const WET = new Set<string>([RoomType.Bathroom]);

const area = (r: { boundary: { points: readonly { x: number; y: number }[] } }) => polygonArea(r.boundary as never) / SQM;

function onEnvelope(r: { x: number; y: number; width: number; height: number }, f: Floor): boolean {
  const xs = f.boundary.points.map(p => p.x);
  const ys = f.boundary.points.map(p => p.y);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  return Math.abs(r.x - minX) <= 1 || Math.abs(r.y - minY) <= 1
    || Math.abs(r.x + r.width - maxX) <= 1 || Math.abs(r.y + r.height - maxY) <= 1;
}

interface Metrics {
  readonly label: string;
  readonly status: string;
  readonly rooms: number;
  readonly carpetRatio: number;
  readonly circulationShare: number;
  readonly aspectWorst: number;
  readonly sliverRooms: number;
  readonly habitableOnFacade: number;
  readonly habitableTotal: number;
  readonly windowlessHabitable: number;
  readonly wetWithoutVent: number;
  readonly toiletOntoPublic: number;
  readonly habitableAsPassage: number;
  readonly externalWalls: number;
  readonly internalWalls: number;
  readonly bedroomsWithBalcony: number;
  readonly bedroomsTotal: number;
}

function measure(label: string, building: Building): Metrics {
  const floor = building.floors.find(f => f.apartmentUnits?.length)!;
  const rooms = floor.rooms;
  const envelopeArea = polygonArea(floor.boundary) / SQM;

  const unitRooms = rooms.filter(r => r.unitId);
  const carpet = unitRooms.filter(r => r.spaceUse === 'UNIT').reduce((s, r) => s + area(r), 0);
  const circulation = rooms
    .filter(r => r.type === RoomType.Corridor || r.type === RoomType.Foyer)
    .reduce((s, r) => s + area(r), 0);

  const habitable = unitRooms.filter(r => HABITABLE.has(r.type));
  const ratios = habitable.map(r => {
    const long = Math.max(r.width, r.height);
    const short = Math.min(r.width, r.height);
    return short > 0 ? long / short : 99;
  });

  const wet = unitRooms.filter(r => WET.has(r.type));
  const shafts = rooms.filter(r => r.type === RoomType.ServiceShaft);
  const wetVented = wet.filter(r =>
    floor.windows.some(w => w.roomId === r.id)
    || onEnvelope(r, floor)
    || shafts.some(sh => Math.abs(sh.x - (r.x + r.width)) <= 1 || Math.abs(r.x - (sh.x + sh.width)) <= 1
      || Math.abs(sh.y - (r.y + r.height)) <= 1 || Math.abs(r.y - (sh.y + sh.height)) <= 1));

  // A toilet opening onto living/dining/kitchen is the relationship problem
  // the reviewer flagged; measured from real door connections.
  const publicIds = new Set(unitRooms
    .filter(r => r.type === RoomType.Living || r.type === RoomType.Dining || r.type === RoomType.Kitchen)
    .map(r => r.id));
  const toiletOntoPublic = wet.filter(t =>
    floor.doors.some(d => d.connectsRooms.includes(t.id) && d.connectsRooms.some(id => publicIds.has(id)))).length;

  // A habitable room with 3+ doors is being walked through rather than occupied.
  const habitableAsPassage = habitable.filter(r =>
    floor.doors.filter(d => d.connectsRooms.includes(r.id)).length >= 3).length;

  const bedrooms = unitRooms.filter(r => r.type === RoomType.Bedroom);
  const bedroomsWithBalcony = bedrooms.filter(b =>
    unitRooms.some(r => r.id === `${b.id}__balcony` || r.id.startsWith(`${b.id}__balcony`))).length;

  return {
    label,
    status: 'PLAN_GENERATED',
    rooms: rooms.length,
    carpetRatio: carpet / envelopeArea,
    circulationShare: circulation / envelopeArea,
    aspectWorst: ratios.length ? Math.max(...ratios) : 0,
    sliverRooms: ratios.filter(r => r > 2.5).length,
    habitableOnFacade: habitable.filter(r => onEnvelope(r, floor)).length,
    habitableTotal: habitable.length,
    windowlessHabitable: habitable.filter(r => !floor.windows.some(w => w.roomId === r.id)).length,
    wetWithoutVent: wet.length - wetVented.length,
    toiletOntoPublic,
    habitableAsPassage,
    externalWalls: floor.walls.filter(w => w.wallUse === 'EXTERNAL').length,
    internalWalls: floor.walls.filter(w => w.wallUse === 'INTERNAL_PARTITION').length,
    bedroomsWithBalcony,
    bedroomsTotal: bedrooms.length,
  };
}

describe('LIVABILITY AUDIT (Step 0) — current engine output', () => {
  it('measures livability metrics across the benchmark matrix', () => {
    const results: Metrics[] = [];
    const failures: Array<{ label: string; reason: string }> = [];

    for (const scenario of SCENARIOS) {
      try {
        const solved = solveMultiSheetApartmentProject(config(scenario));
        results.push(measure(scenario.label, solved.building));
      } catch (error) {
        failures.push({ label: scenario.label, reason: error instanceof Error ? error.message : String(error) });
      }
    }

    console.log('\nAUDIT_START');
    console.log('| scenario | rooms | carpet% | circ% | worstAspect | slivers | habitableOnFacade | windowless | wetNoVent | toiletOntoPublic | habitableAsPassage | ext/int walls | bedroomBalconies |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const m of results) {
      console.log(
        `| ${m.label} | ${m.rooms} | ${(m.carpetRatio * 100).toFixed(1)} | ${(m.circulationShare * 100).toFixed(1)} `
        + `| ${m.aspectWorst.toFixed(2)} | ${m.sliverRooms} | ${m.habitableOnFacade}/${m.habitableTotal} `
        + `| ${m.windowlessHabitable} | ${m.wetWithoutVent} | ${m.toiletOntoPublic} | ${m.habitableAsPassage} `
        + `| ${m.externalWalls}/${m.internalWalls} | ${m.bedroomsWithBalcony}/${m.bedroomsTotal} |`,
      );
    }
    for (const f of failures) {
      console.log(`| ${f.label} | INFEASIBLE: ${f.reason.slice(0, 90)} |`);
    }
    console.log('AUDIT_END\n');

    expect(results.length + failures.length).toBe(SCENARIOS.length);
  }, 600_000);
});

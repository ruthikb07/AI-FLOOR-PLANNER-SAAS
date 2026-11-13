/**
 * PHASE 0 BENCHMARK — diagnosis only, no fixes.
 *
 * Runs the generation pipeline across a plot/flat/BHK matrix and reports:
 *   1. a rejection-reason histogram from the topology engine, and
 *   2. how often `solveMultiSheetApartmentProject` silently falls back to the
 *      legacy `partitionMacroFootprint` template.
 *
 * Fallback detection observes the production bridge's actual return value.
 * Separate topology calls provide rejection diagnostics, not proof of which
 * branch production selected (time budgets can affect separate runs).
 *
 * This file asserts nothing about plan quality. It exists so the fixes that
 * follow can show measured movement instead of claimed improvement.
 */

import { describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import * as productionBridge from '../topology/production-bridge';
import {
  Direction,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  RoomType,
  type Building,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { polygonArea } from '@ai-floor-planner/geometry-engine';
import { solveMultiSheetApartmentProject } from '../apartment/multi-sheet-apartment-solver';
import { generateDesignConcepts } from '../topology/generative-topology-engine';

const SQM = 1_000_000;

type Bhk = '1BHK' | '2BHK' | '3BHK' | '4BHK';

interface Case {
  readonly widthM: number;
  readonly depthM: number;
  readonly flats: number;
  readonly bhk: Bhk | 'MIXED';
}

/** Plots 15–50 m, flats 1–6, 2–4 BHK, as the brief specifies. */
function buildMatrix(): Case[] {
  const cases: Case[] = [];
  const plots: Array<[number, number]> = [
    [15, 20], [18, 25], [18.4, 22.5], [18.4, 28.5], [24, 28.5],
    [25, 30], [30, 30], [36, 40], [40, 50], [50, 30], [20, 45], [50, 50],
  ];
  for (const [widthM, depthM] of plots) {
    for (const flats of [1, 2, 3, 4, 5, 6]) {
      for (const bhk of ['2BHK', '3BHK', '4BHK', 'MIXED'] as const) {
        cases.push({ widthM, depthM, flats, bhk });
      }
    }
  }
  return cases;
}

function unitType(c: Case, index: number): Bhk {
  return c.bhk === 'MIXED' ? (['2BHK', '3BHK', '4BHK'] as const)[index % 3]! : c.bhk;
}

function config(c: Case): MultiSheetApartmentConfig {
  const setback = c.widthM < 22 ? 1500 : 3000;
  return {
    projectId: `bench-${c.widthM}x${c.depthM}-${c.flats}-${c.bhk}`,
    projectName: 'Benchmark',
    aiPrompt: 'Residential apartment with bedroom balconies and functional bathroom ventilation.',
    structuralLayoutMode: 'DEFERRED',
    plotWidthMm: Math.round(c.widthM * 1000),
    plotDepthMm: Math.round(c.depthM * 1000),
    roadWidthMm: 12000,
    roadAccessSides: [Direction.North],
    setbacksMm: { front: setback + 1500, rear: setback, left: setback, right: setback },
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'generic_maharashtra',
    verticalStackType: 'G_PLUS_N',
    numTypicalFloors: 4,
    // The config type only admits 2|3|4 (root cause 7). Out-of-range flat
    // counts are recorded as a type-level limitation, not silently clamped.
    flatsPerFloor: c.flats as 2 | 3 | 4,
    units: Array.from({ length: c.flats }, (_, i) => ({
      unitIndex: i + 1, bhkType: unitType(c, i), hasUtilityBalcony: true,
    })),
    floorToFloorHeightMm: 3150,
    stiltHeightMm: 3150,
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
  };
}

/** Collapses a rejection message to a stable class for histogramming. */
function classify(reason: string): string {
  if (/run \d+ mm is below/.test(reason)) return 'FLAT_RUN_BELOW_MIN';
  if (/span \d+ mm is below/.test(reason)) return 'FLAT_SPAN_BELOW_MIN';
  if (/is far beyond the/.test(reason)) return 'FLAT_OVERSIZED';
  if (/no exterior wall long enough/.test(reason)) return 'NO_WINDOW_WALL';
  if (/shares only .* with common circulation/.test(reason)) return 'NO_ENTRANCE_WALL';
  if (/disconnected networks/.test(reason)) return 'CIRCULATION_DISCONNECTED';
  if (/does not adjoin common circulation/.test(reason)) return 'CORE_NOT_ADJOINING';
  if (/does not tile the envelope/.test(reason)) return 'TILING_INEXACT';
  if (/core band runs|core band is/.test(reason)) return 'CORE_BAND_TOO_SMALL';
  if (/leaves wings only|leaves the open wing|between them/.test(reason)) return 'WING_TOO_NARROW';
  if (/central court/.test(reason)) return 'COURT_INFEASIBLE';
  if (/needs at least two staircases|at least three flats/.test(reason)) return 'FAMILY_PRECONDITION';
  if (/EVERY_BATHROOM_VENTILATED/.test(reason)) return 'EVERY_BATHROOM_VENTILATED';
  if (/EVERY_FLAT_HAS_ONE_ENTRANCE/.test(reason)) return 'EVERY_FLAT_HAS_ONE_ENTRANCE';
  if (/REQUIRED_CORE_PLACEMENT/.test(reason)) return 'REQUIRED_CORE_PLACEMENT';
  if (/EVERY_FLAT_REACHES_FACADE/.test(reason)) return 'EVERY_FLAT_REACHES_FACADE';
  if (/lift landing/.test(reason)) return 'LIFT_LANDING_TOO_NARROW';
  if (/budget/.test(reason)) return 'SEARCH_BUDGET';
  return `OTHER: ${reason.slice(0, 48)}`;
}

interface Row {
  readonly label: string;
  readonly concepts: number;
  readonly usedFallback: boolean;
  readonly planned: boolean;
  readonly infeasibleReason?: string;
  readonly maxStairW?: number;
  readonly maxStairH?: number;
  readonly floorStairsEmpty?: boolean;
  readonly kitchenSqm?: number;
  readonly livingSqm?: number;
  readonly bathsNoVent?: number;
  readonly bathsTotal?: number;
  readonly carpetRatio?: number;
}

function measure(label: string, building: Building, concepts: number, usedFallback: boolean): Row {
  const floor = building.floors.find(f => f.apartmentUnits?.length)!;
  const stairs = floor.rooms.filter(r => r.type === RoomType.Staircase);
  const baths = floor.rooms.filter(r => r.type === RoomType.Bathroom);
  // Adjacency alone does not provide ventilation. Require an actual opening
  // hosted by an external/shaft wall belonging to this bathroom.
  const ventilated = baths.filter(b => floor.windows.some(w =>
    w.roomId === b.id && w.width > 0 && w.height > 0 && floor.walls.some(wall =>
      wall.id === w.wallId && wall.roomIds.includes(b.id)
      && (wall.wallUse === 'EXTERNAL' || wall.wallUse === 'SHAFT'))));

  const kitchens = floor.rooms.filter(r => r.type === RoomType.Kitchen);
  const livings = floor.rooms.filter(r => r.type === RoomType.Living);
  const carpet = floor.rooms.filter(r => r.spaceUse === 'UNIT').reduce((s, r) => s + polygonArea(r.boundary), 0);

  return {
    label,
    concepts,
    usedFallback,
    planned: true,
    maxStairW: stairs.length ? Math.max(...stairs.map(s => s.width)) : 0,
    maxStairH: stairs.length ? Math.max(...stairs.map(s => s.height)) : 0,
    floorStairsEmpty: (floor.stairs?.length ?? 0) === 0,
    kitchenSqm: kitchens.length ? Math.max(...kitchens.map(k => polygonArea(k.boundary) / SQM)) : 0,
    livingSqm: livings.length ? Math.max(...livings.map(l => polygonArea(l.boundary) / SQM)) : 0,
    bathsNoVent: baths.length - ventilated.length,
    bathsTotal: baths.length,
    carpetRatio: carpet / polygonArea(floor.boundary),
  };
}

describe('PHASE 0 BENCHMARK — rejection histogram and legacy fallback usage', () => {
  it('measures rejections and fallback usage across the matrix', () => {
    const matrix = buildMatrix();
    const selectionSpy = vi.spyOn(productionBridge, 'selectProductionTopology');
    const histogram = new Map<string, number>();
    const rows: Row[] = [];
    let zeroConceptCases = 0;

    for (const c of matrix) {
      const label = `${c.widthM}x${c.depthM} ${c.flats}x${c.bhk}`;
      const cfg = config(c);

      const setback = c.widthM < 22 ? 1500 : 3000;
      const envelope = {
        x: setback,
        y: setback,
        w: cfg.plotWidthMm - 2 * setback,
        h: cfg.plotDepthMm - setback - (setback + 1500),
      };

      // Ask the topology engine directly, so rejection reasons are visible.
      let concepts = 0;
      if (envelope.w > 0 && envelope.h > 0 && [2, 3, 4].includes(c.flats)) {
        try {
          const res = generateDesignConcepts({
            envelope,
            flatsPerFloor: c.flats as 2 | 3 | 4,
            unitTypes: Array.from({ length: c.flats }, (_, i) => unitType(c, i)),
            aiPrompt: cfg.aiPrompt,
            seed: 1,
          });
          concepts = res.concepts.length;
          for (const rejection of res.rejected) {
            for (const reason of rejection.reasons) {
              const key = classify(reason);
              histogram.set(key, (histogram.get(key) ?? 0) + 1);
            }
          }
        } catch (error) {
          const key = `INTENT_ERROR: ${(error instanceof Error ? error.message : String(error)).slice(0, 40)}`;
          histogram.set(key, (histogram.get(key) ?? 0) + 1);
        }
      } else {
        histogram.set('TYPE_LIMIT_FLATS_NOT_2_3_4', (histogram.get('TYPE_LIMIT_FLATS_NOT_2_3_4') ?? 0) + 1);
      }
      if (concepts === 0) zeroConceptCases++;

      // Now the production solver, to see what the user would actually get.
      selectionSpy.mockClear();
      try {
        const solved = solveMultiSheetApartmentProject(cfg);
        const selection = selectionSpy.mock.results[0];
        const usedFallback = solved.generationReport
          ? solved.generationReport.strategy === 'LEGACY_FALLBACK'
          : selection?.type === 'return' && selection.value === undefined;
        rows.push(measure(label, solved.building, concepts, usedFallback));
      } catch (error) {
        rows.push({
          label,
          concepts,
          usedFallback: false,
          planned: false,
          infeasibleReason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const planned = rows.filter(r => r.planned);
    const fellBack = planned.filter(r => r.usedFallback);
    const threw = rows.filter(r => !r.planned);
    selectionSpy.mockRestore();
    writeFileSync(new URL('../../../../test-artifacts/livability-current-results.json', import.meta.url),
      JSON.stringify({ measurement: 'Actual production topology selection; wet rooms require a hosted opening, not adjacency alone. Software audit, not compliance certification.',
        histogram: Object.fromEntries(histogram), rows }, null, 2));

    console.log('\n| flats | cases | plans | actual legacy fallback | no plan |');
    console.log('|---|---|---|---|---|');
    for (const flats of [1, 2, 3, 4, 5, 6]) {
      const group = rows.filter(r => r.label.includes(` ${flats}x`));
      console.log(`| ${flats} | ${group.length} | ${group.filter(r => r.planned).length} | ${group.filter(r => r.usedFallback).length} | ${group.filter(r => !r.planned).length} |`);
    }

    console.log('\nPHASE0_START');
    console.log(`matrix cases: ${matrix.length}`);
    console.log(`plans produced: ${planned.length}`);
    console.log(`pipeline threw (no plan at all): ${threw.length}`);
    console.log(`cases with 0 topology concepts: ${zeroConceptCases} of ${matrix.length}`);
    console.log(`LEGACY FALLBACK USED: ${fellBack.length} of ${planned.length} plans `
      + `(${((fellBack.length / Math.max(1, planned.length)) * 100).toFixed(1)}%)`);

    console.log('\n--- REJECTION HISTOGRAM (topology engine) ---');
    for (const [reason, count] of [...histogram.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`${String(count).padStart(5)}  ${reason}`);
    }

    console.log('\n--- CASES THAT PRODUCED NO PLAN ---');
    const reasons = new Map<string, number>();
    for (const r of threw) {
      const key = (r.infeasibleReason ?? '').slice(0, 70);
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
    for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`${String(count).padStart(5)}  ${reason}`);
    }

    console.log('\n--- QUALITY METRICS ON PRODUCED PLANS (worst observed) ---');
    const num = (xs: number[]) => (xs.length ? xs : [0]);
    console.log(`max stair room width : ${Math.max(...num(planned.map(r => r.maxStairW ?? 0)))} mm`);
    console.log(`max stair room height: ${Math.max(...num(planned.map(r => r.maxStairH ?? 0)))} mm`);
    console.log(`plans with empty Floor.stairs: ${planned.filter(r => r.floorStairsEmpty).length} of ${planned.length}`);
    console.log(`max living area      : ${Math.max(...num(planned.map(r => r.livingSqm ?? 0))).toFixed(1)} m2`);
    console.log(`max kitchen area     : ${Math.max(...num(planned.map(r => r.kitchenSqm ?? 0))).toFixed(1)} m2`);
    const ratios = planned.filter(r => (r.kitchenSqm ?? 0) > 0).map(r => (r.livingSqm ?? 0) / (r.kitchenSqm ?? 1));
    console.log(`worst living:kitchen : ${Math.max(...num(ratios)).toFixed(2)} : 1`);
    console.log(`bathrooms without ventilation: ${planned.reduce((s, r) => s + (r.bathsNoVent ?? 0), 0)} `
      + `of ${planned.reduce((s, r) => s + (r.bathsTotal ?? 0), 0)}`);
    const carpets = planned.map(r => r.carpetRatio ?? 0).filter(x => x > 0);
    if (carpets.length) {
      console.log(`carpet ratio range   : ${(Math.min(...carpets) * 100).toFixed(1)}% – ${(Math.max(...carpets) * 100).toFixed(1)}%`);
    }
    console.log('PHASE0_END\n');

    expect(rows.length).toBe(matrix.length);
  }, 1_800_000);
});

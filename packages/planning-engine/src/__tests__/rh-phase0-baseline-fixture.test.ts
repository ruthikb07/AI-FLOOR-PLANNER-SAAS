import { describe, expect, it } from 'vitest';
import {
  Direction,
  RoomType,
  createBuilding,
  createDefaultFootprintIntent,
  createGenerationControlState,
  applySpaceProgramPreset,
  getSpaceProgramPresets,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { solveMultiSheetApartmentProject } from '../apartment/multi-sheet-apartment-solver';
import { interpretArchitecturalIntent } from '../topology/architectural-intent';
import { runGenerationWorkflow } from '../generation/workflow';
import { generateTargetedRefinements } from '../refinement/targeted-regeneration';

const BASE_PHASE0_PROMPT =
  'Design a modern G+5 residential building with four 2BHK apartments per typical floor, private bedroom balconies, ' +
  'a central lift, two staircases positioned on either side, no OTS, and center the building inside the permissible building envelope.';

function createPhase0Config(overrides: Partial<MultiSheetApartmentConfig> = {}): MultiSheetApartmentConfig {
  return {
    projectId: 'rh-phase0-fixture',
    projectName: 'RH Phase 0 Baseline Verification Fixture',
    plotWidthMm: 46_000,
    plotDepthMm: 40_000,
    roadWidthMm: 18_000,
    roadAccessSides: [Direction.South],
    setbacksMm: { front: 4_500, rear: 3_000, left: 3_000, right: 3_000 },
    numTypicalFloors: 5,
    verticalStackType: 'STILT_PLUS_N',
    flatsPerFloor: 4,
    units: [
      { unitIndex: 1, bhkType: '2BHK', targetCarpetSqFt: 850, hasUtilityBalcony: true },
      { unitIndex: 2, bhkType: '2BHK', targetCarpetSqFt: 850, hasUtilityBalcony: true },
      { unitIndex: 3, bhkType: '2BHK', targetCarpetSqFt: 850, hasUtilityBalcony: true },
      { unitIndex: 4, bhkType: '2BHK', targetCarpetSqFt: 850, hasUtilityBalcony: true },
    ],
    aiPrompt: BASE_PHASE0_PROMPT,
    ...overrides,
  };
}

describe('RH Phase 0 — Reproducible Test Scenario & Controlled Repairs', () => {
  it('parses natural prompt instructions for CENTRAL core, two staircases on either side, single central lift, NO OTS, and CENTER BUILDING', () => {
    const program = interpretArchitecturalIntent({
      flatsPerFloor: 4,
      unitTypes: ['2BHK', '2BHK', '2BHK', '2BHK'],
      aiPrompt: BASE_PHASE0_PROMPT,
    });

    expect(program.mandatory.corePlacement).toBe('CENTRAL');
    expect(program.mandatory.stairCount).toBe(2);
    expect(program.mandatory.singleLift).toBe(true);
    expect(program.mandatory.ventilationStrategy).toBe('PERIMETER_ONLY');
    expect(program.mandatory.centerBuilding).toBe(true);
    expect(program.preferences.bedroomBalconies).toBe('ALL_BEDROOMS');
  });

  it('honours the Image 3 user prompt without selecting a 624 m2 OTS strip or connecting Master Bedroom to Kitchen', () => {
    const image3Prompt =
      'Design a modern G+5 apartment with 4 spacious 2BHK flats per floor, each having one bedroom with a private balcony. ' +
      'Provide a central lift core, staircases on both sides, and an open-to-sky (OTS) courtyard. ' +
      'Optimize for Vastu, natural light, ventilation, privacy, and efficient space utilization.';

    const intent = interpretArchitecturalIntent({
      flatsPerFloor: 4,
      unitTypes: ['2BHK', '2BHK', '2BHK', '2BHK'],
      aiPrompt: image3Prompt,
    });
    expect(intent.mandatory.corePlacement).toBe('CENTRAL');
    expect(intent.mandatory.stairCount).toBe(2);
    expect(intent.preferences.ventilationStrategy).toBe('CENTRAL_COURTYARD');

    const result = solveMultiSheetApartmentProject(
      createPhase0Config({
        plotWidthMm: 46_000,
        plotDepthMm: 32_100,
        aiPrompt: image3Prompt,
      }),
    );

    expect(result.generationReport?.selectedFamily).not.toBe('LINEAR_SINGLE_LOADED');

    const typicalFloor = result.building.floors.find(f => f.floorUse === 'RESIDENTIAL')!;
    const roomById = new Map(typicalFloor.rooms.map(r => [r.id, r]));

    for (const door of typicalFloor.doors) {
      const [idA, idB] = door.connectsRooms;
      const roomA = roomById.get(idA);
      const roomB = roomById.get(idB);
      if (!roomA || !roomB) continue;
      const isBedToKitchen =
        (roomA.type === RoomType.Bedroom && (roomB.type === RoomType.Kitchen || roomB.type === RoomType.Utility)) ||
        (roomB.type === RoomType.Bedroom && (roomA.type === RoomType.Kitchen || roomA.type === RoomType.Utility));
      expect(isBedToKitchen).toBe(false);
    }
  });

  it('evaluates Interpretation 1 (2,000 sq. ft. GROSS_FLOOR_AREA): reports infeasibility below minimum habitable plate, preserves NO OTS, centers building, and places 2 stairs flanking 1 central lift', () => {
    const config = createPhase0Config({
      targetAreaSqFt: 2000,
      areaTargetScope: 'GROSS_FLOOR_AREA',
      centerBuildingInEnvelope: true,
    });
    const result = solveMultiSheetApartmentProject(config);
    const diag = result.schedule.areaTargetDiagnostic;

    expect(diag).toBeDefined();
    expect(diag!.scope).toBe('GROSS_FLOOR_AREA');
    expect(diag!.requestedSqFt).toBe(2000);
    expect(diag!.status).toBe('INFEASIBLE_BELOW_MINIMUM_HABITABLE_FLOOR_PLATE');
    expect(diag!.achievedM2).toBeGreaterThanOrEqual(diag!.minimumFeasibleGrossM2);

    const typicalFloor = result.building.floors.find(f => f.floorUse === 'RESIDENTIAL')!;
    // Verify NO OTS (zero OPEN_TO_SKY_VOID rooms)
    const otsRooms = typicalFloor.rooms.filter(
      r => r.name.toLowerCase().includes('open-to-sky') || r.name.toLowerCase().includes('ots'),
    );
    expect(otsRooms.length).toBe(0);

    // Verify 1 central lift flanked by 2 staircases on either side
    const lifts = typicalFloor.rooms.filter(r => r.type === RoomType.Lift);
    const stairs = typicalFloor.rooms.filter(r => r.type === RoomType.Staircase);
    expect(lifts.length).toBe(1);
    expect(stairs.length).toBe(2);

    const liftCenterY = lifts[0]!.y + lifts[0]!.height / 2;
    const stairCentersY = stairs.map(s => s.y + s.height / 2).sort((a, b) => a - b);
    expect(stairCentersY[0]!).toBeLessThan(liftCenterY);
    expect(stairCentersY[1]!).toBeGreaterThan(liftCenterY);

    // Verify building is centered inside permissible envelope [3000..43000, 3000..35500]
    const xs = typicalFloor.boundary.points.map(p => p.x);
    const ys = typicalFloor.boundary.points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const leftMarginFromSetback = minX - 3000;
    const rightMarginFromSetback = 43000 - maxX;
    const rearMarginFromSetback = minY - 3000;
    const frontMarginFromSetback = 35500 - maxY;

    expect(Math.abs(leftMarginFromSetback - rightMarginFromSetback)).toBeLessThanOrEqual(10);
    expect(Math.abs(rearMarginFromSetback - frontMarginFromSetback)).toBeLessThanOrEqual(10);

    // Verify planar conservation across all sheets
    expect(result.schedule.overallDeltaMm2).toBeLessThan(0.001);
  });

  it('evaluates Interpretation 2 (2,000 sq. ft. FLOOR_TOTAL_CARPET): achieves ~2,000 sq. ft. (185.8 m2) total carpet per floor (~500 sq. ft. per flat) with private bedroom balconies and NO OTS', () => {
    const config = createPhase0Config({
      targetAreaSqFt: 2000,
      areaTargetScope: 'FLOOR_TOTAL_CARPET',
      centerBuildingInEnvelope: true,
    });
    const result = solveMultiSheetApartmentProject(config);
    const diag = result.schedule.areaTargetDiagnostic;

    expect(diag).toBeDefined();
    expect(diag!.scope).toBe('FLOOR_TOTAL_CARPET');
    expect(diag!.status).toBe('ACHIEVED');
    expect(diag!.achievedM2).toBeGreaterThan(165);
    expect(diag!.achievedM2).toBeLessThan(215);

    // Every flat on the first residential floor has private bedroom balconies
    const balcSchedule = (result.building.metadata as Record<string, any>)?.bedroomBalconySchedule as Array<{
      flatId: string | null;
      floorId: string;
      balconyId: string | null;
    }>;
    expect(Array.isArray(balcSchedule)).toBe(true);
    const firstResFloorId = result.building.floors.find(f => f.floorUse === 'RESIDENTIAL')!.id;
    const flatsWithBedBalc = new Set(
      balcSchedule
        .filter(item => item.floorId === firstResFloorId && item.balconyId !== null)
        .map(item => item.flatId),
    );
    expect(flatsWithBedBalc.size).toBe(4);

    // Truthful AI telemetry
    const brief = (result.building.metadata as Record<string, any>)?.generationBrief;
    expect(brief?.aiTelemetry?.geminiInvoked).toBe(false);
    expect(brief?.aiTelemetry?.referenceImageUsedForGeometry).toBe(false);
  });

  it('evaluates Interpretation 3 (2,000 sq. ft. PER_APARTMENT_CARPET): achieves ~2,000 sq. ft. (185.8 m2) carpet per apartment on an adequate plot and clamps to maximum feasible plot utilization on a smaller plot', () => {
    const largePlotConfig = createPhase0Config({
      plotWidthMm: 46_000,
      plotDepthMm: 40_000,
      targetAreaSqFt: 2000,
      areaTargetScope: 'PER_APARTMENT_CARPET',
      centerBuildingInEnvelope: true,
    });
    const largeResult = solveMultiSheetApartmentProject(largePlotConfig);
    const largeDiag = largeResult.schedule.areaTargetDiagnostic!;

    expect(largeDiag.scope).toBe('PER_APARTMENT_CARPET');
    expect(largeDiag.status).toBe('ACHIEVED');
    expect(largeDiag.achievedM2).toBeGreaterThan(165);
    expect(largeDiag.achievedM2).toBeLessThan(208);
    expect(largeResult.schedule.overallDeltaMm2).toBeLessThan(0.001);

    // On a smaller plot (30m x 25m), it utilizes 100% of the permissible envelope and reports CLAMPED_TO_ENVELOPE_MAX
    const compactPlotConfig = createPhase0Config({
      plotWidthMm: 30_000,
      plotDepthMm: 25_000,
      targetAreaSqFt: 2000,
      areaTargetScope: 'PER_APARTMENT_CARPET',
      centerBuildingInEnvelope: true,
    });
    const compactResult = solveMultiSheetApartmentProject(compactPlotConfig);
    const compactDiag = compactResult.schedule.areaTargetDiagnostic!;

    expect(compactDiag.status).toBe('CLAMPED_TO_ENVELOPE_MAX');
    // Permissible envelope is (30000 - 6000) x (25000 - 7500) = 24000 x 17500 = 420.0 m2
    expect(compactResult.schedule.groundCoverageM2).toBeCloseTo(420.0, 1);
  });

  it('preserves exterior windows on selected rooms during targeted regeneration when their host wall segment remains on the room boundary', async () => {
    const building = createBuilding({
      projectId: 'refinement-win-preserve',
      name: 'Refinement Window Preservation',
      site: {
        plotWidth: 18_000,
        plotDepth: 24_000,
        roadFacing: Direction.North,
        plannedFloorCount: 2,
        setbacks: { front: 1_500, rear: 1_000, left: 1_000, right: 1_000 },
      },
      floors: [{ buildingId: '', level: 0 }],
    });
    const program = applySpaceProgramPreset(
      getSpaceProgramPresets('residential').find(value => value.id === 'residential_2bhk')!,
    );
    const base = createDefaultFootprintIntent(building);
    const footprint = {
      ...base,
      shape: 'rectangle' as const,
      parameters: { ...base.parameters, width: 16_000, depth: 21_500, wingWidth: 6_000, wingDepth: 7_000 },
      transform: { ...base.transform, x: 1_000, y: 1_500 },
      strategy: 'same_all_levels' as const,
      floorOverrides: [],
    };
    const wf = await runGenerationWorkflow({ building, category: 'residential', program, footprint });
    const source = wf.candidates[0]!.building;
    const floor = source.floors[0]!;
    const rooms = floor.rooms.filter(r => r.type !== RoomType.Staircase);

    let pair: readonly [typeof rooms[number], typeof rooms[number]] | undefined;
    for (let i = 0; i < rooms.length && !pair; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i]!;
        const b = rooms[j]!;
        const minX = Math.min(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxX = Math.max(a.x + a.width, b.x + b.width);
        const maxY = Math.max(a.y + a.height, b.y + b.height);
        if (Math.abs(a.area + b.area - (maxX - minX) * (maxY - minY)) < 2) {
          pair = [a, b];
          break;
        }
      }
    }
    expect(pair).toBeDefined();

    const selectedIds = pair!.map(r => r.id);
    const sourceSelectedWindows = floor.windows.filter(w => selectedIds.includes(w.roomId));
    const candidates = generateTargetedRefinements({
      building: source,
      control: createGenerationControlState(),
      selectedRoomIds: selectedIds,
      requiredRoomCounts: wf.candidates[0]!.requiredRoomCounts as Record<string, number>,
    });

    expect(candidates.length).toBeGreaterThan(0);
    if (sourceSelectedWindows.length > 0) {
      const refinedFloor = candidates[0]!.building.floors[0]!;
      const refinedSelectedWindows = refinedFloor.windows.filter(w => selectedIds.includes(w.roomId));
      expect(refinedSelectedWindows.length).toBeGreaterThan(0);
    }
  }, 25_000);
});

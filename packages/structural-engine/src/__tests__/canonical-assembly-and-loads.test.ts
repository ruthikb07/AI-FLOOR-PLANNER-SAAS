import { describe, expect, it } from 'vitest';
import {
  DaylightLevel,
  Direction,
  DoorType,
  PlotShape,
  PrivacyLevel,
  RoomType,
  StairType,
  SwingDirection,
  WallType,
  WindowType,
  type Building,
  type Floor,
} from '@ai-floor-planner/core';
import {
  AwatifStructuralSolver,
  assembleLoadedAnalyticalFrameModel,
  synthesizeCanonicalStructuralSystem,
  type ReviewedStructuralInputs,
} from '../index.js';

function createTestMultiStoreyBuilding(): Building {
  const makeFloor = (level: number, id: string): Floor => ({
    id,
    buildingId: 'bldg-ms2',
    level,
    name: `Floor ${level}`,
    floorHeight: 3150,
    boundary: {
      points: [
        { x: 0, y: 0 },
        { x: 10_500, y: 0 },
        { x: 10_500, y: 8_400 },
        { x: 0, y: 8_400 },
      ],
    },
    rooms: [
      {
        id: `rm-liv-${level}`,
        floorId: id,
        type: RoomType.Living,
        name: 'Living Hall',
        boundary: {
          points: [
            { x: 0, y: 0 },
            { x: 6_000, y: 0 },
            { x: 6_000, y: 4_500 },
            { x: 0, y: 4_500 },
          ],
        },
        x: 0,
        y: 0,
        width: 6_000,
        height: 4_500,
        rotation: 0,
        area: 27,
        priority: 1,
        tags: [],
        adjacencyRequirements: [],
        daylightRequirement: DaylightLevel.High,
        privacyRequirement: PrivacyLevel.Low,
        ventilationRequired: true,
        isFixed: false,
      },
      {
        id: `rm-bed-${level}`,
        floorId: id,
        type: RoomType.Bedroom,
        name: 'Master Bedroom',
        boundary: {
          points: [
            { x: 6_000, y: 0 },
            { x: 10_500, y: 0 },
            { x: 10_500, y: 4_500 },
            { x: 6_000, y: 4_500 },
          ],
        },
        x: 6_000,
        y: 0,
        width: 4_500,
        height: 4_500,
        rotation: 0,
        area: 20.25,
        priority: 2,
        tags: [],
        adjacencyRequirements: [],
        daylightRequirement: DaylightLevel.Medium,
        privacyRequirement: PrivacyLevel.High,
        ventilationRequired: true,
        isFixed: false,
      },
      {
        id: `rm-balc-${level}`,
        floorId: id,
        type: RoomType.Balcony,
        name: 'Front Balcony',
        spaceUse: 'OUTDOOR',
        boundary: {
          points: [
            { x: 1_000, y: -1_500 },
            { x: 5_000, y: -1_500 },
            { x: 5_000, y: 0 },
            { x: 1_000, y: 0 },
          ],
        },
        x: 1_000,
        y: -1_500,
        width: 4_000,
        height: 1_500,
        rotation: 0,
        area: 6,
        priority: 3,
        tags: [],
        adjacencyRequirements: [],
        daylightRequirement: DaylightLevel.High,
        privacyRequirement: PrivacyLevel.None,
        ventilationRequired: true,
        isFixed: false,
      },
    ],
    walls: [
      {
        id: `w-front-${level}`,
        floorId: id,
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 10_500, y: 0 },
        thickness: 230,
        type: WallType.External,
        wallUse: 'EXTERNAL',
        roomIds: [`rm-liv-${level}`, `rm-bed-${level}`],
        hasOpening: true,
        loadBearing: true,
      },
      {
        id: `w-mid-${level}`,
        floorId: id,
        startPoint: { x: 6_000, y: 0 },
        endPoint: { x: 6_000, y: 8_400 },
        thickness: 230,
        type: WallType.Internal,
        wallUse: 'UNIT_SEPARATION',
        roomIds: [`rm-liv-${level}`, `rm-bed-${level}`],
        hasOpening: true,
        loadBearing: true,
      },
      {
        id: `w-back-${level}`,
        floorId: id,
        startPoint: { x: 0, y: 8_400 },
        endPoint: { x: 10_500, y: 8_400 },
        thickness: 230,
        type: WallType.External,
        wallUse: 'EXTERNAL',
        roomIds: [],
        hasOpening: false,
        loadBearing: true,
      },
    ],
    doors: [
      {
        id: `d-main-${level}`,
        floorId: id,
        wallId: `w-front-${level}`,
        position: { x: 3_000, y: 0 },
        width: 1050,
        height: 2100,
        type: DoorType.Single,
        swingDirection: SwingDirection.Left,
        connectsRooms: [`rm-liv-${level}`, `rm-balc-${level}`],
      },
    ],
    windows: [
      {
        id: `win-1-${level}`,
        floorId: id,
        wallId: `w-front-${level}`,
        position: { x: 8_200, y: 0 },
        width: 1500,
        height: 1350,
        sillHeight: 900,
        type: WindowType.Sliding,
        roomId: `rm-bed-${level}`,
      },
    ],
    stairs: [
      {
        id: `st-${level}`,
        floorId: id,
        type: StairType.UShaped,
        boundary: {
          points: [
            { x: 6_500, y: 4_800 },
            { x: 9_800, y: 4_800 },
            { x: 9_800, y: 7_200 },
            { x: 6_500, y: 7_200 },
          ],
        },
        x: 6_500,
        y: 4_800,
        width: 2_400,
        length: 3_300,
        direction: Direction.North,
        riserCount: 21,
        riserHeight: 150,
        treadDepth: 275,
        landingWidth: 1_200,
        connectsFloors: [level, level + 1],
      },
    ],
    columns: [],
  });

  return {
    id: 'bldg-ms2',
    projectId: 'proj-ms2',
    name: 'G+3 Apartment Test',
    version: 3,
    createdAt: '2026-11-27T00:00:00.000Z',
    updatedAt: '2026-11-27T00:00:00.000Z',
    metadata: { projectId: 'proj-ms2' },
    site: {
      id: 'site-1',
      plotBoundary: {
        points: [
          { x: -3000, y: -3000 },
          { x: 13_500, y: -3000 },
          { x: 13_500, y: 11_400 },
          { x: -3000, y: 11_400 },
        ],
      },
      plotWidth: 16_500,
      plotDepth: 14_400,
      plotArea: 237.6,
      plotShape: PlotShape.Rectangular,
      orientation: 0,
      setbacks: { front: 3000, rear: 3000, left: 3000, right: 3000 },
      accessPoints: [],
      roadFacing: Direction.South,
    },
    floors: [makeFloor(0, 'fl-0'), makeFloor(1, 'fl-1'), makeFloor(2, 'fl-2'), makeFloor(3, 'fl-3')],
  };
}

describe('Canonical-to-Structural Frame Assembler & Indian Load/Combination Engine (Phases A6 & A8)', () => {
  it('synthesizes demand-differentiated columns/beams/cantilevers, checks opening clearances, and solves all IS combinations in Awatif WASM with exact vertical equilibrium', async () => {
    const building = createTestMultiStoreyBuilding();
    const system = synthesizeCanonicalStructuralSystem(building, {
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
      ductileDetailing: true,
    });

    expect(system.sourceArchitecturalRevision).toBe(3);
    expect(system.sourceArchitecturalSha256).toHaveLength(64);
    expect(system.elements.some((e) => e.category === 'CANTILEVER_BEAM')).toBe(true);
    expect(system.slabPanels.some((p) => p.panelType === 'CANTILEVER')).toBe(true);
    expect(system.stairWaists.length).toBe(4);

    // Demand-differentiated sizing check: columns across 4 storeys + interior/corner MUST NOT all share identical dimensions!
    const uniqueColumnSizes = new Set(
      system.memberMetadata
        .filter((m) => m.category === 'COLUMN')
        .map((m) => `${m.widthMm}x${m.depthMm}`),
    );
    expect(uniqueColumnSizes.size).toBeGreaterThanOrEqual(2);

    const uniqueBeamSizes = new Set(
      system.memberMetadata
        .filter((m) => m.category === 'BEAM' || m.category === 'PLINTH_BEAM')
        .map((m) => `${m.widthMm}x${m.depthMm}`),
    );
    expect(uniqueBeamSizes.size).toBeGreaterThanOrEqual(2);

    const topElevation = Math.max(...system.physicalModel.columns.map(column => column.topElevationMm));
    const supports = system.physicalModel.columns.filter(column => column.topElevationMm === topElevation).slice(0, 2);
    const inputs: ReviewedStructuralInputs = {
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
      ductileDetailingIS13920: true,
      floorFinishKnM2: 1.2,
      masonryUnitWeightKnM3: 19.0,
      roofLiveLoadKnM2: 1.5,
      waterTankLoadKn: 80,
      waterTankSupport: {
        reference: 'TEST-TANK-SUPPORTS',
        centerOfGravityMm: { x: (supports[0]!.centerXMm + supports[1]!.centerXMm) / 2,
          y: (supports[0]!.centerYMm + supports[1]!.centerYMm) / 2 },
        reactions: supports.map(column => ({ physicalColumnId: column.physicalMemberId, verticalReactionKn: 40 })),
      },
      seismic: {
        enabled: true,
        zone: 'III',
        soilType: 'MEDIUM',
        importanceFactorI: 1.0,
        responseReductionFactorR: 5.0,
        frameSystemType: 'RC_MRF_WITH_BRICK_INFILL',
      },
      wind: {
        enabled: true,
        basicWindSpeedVbMs: 39,
        terrainCategory: 2,
      },
      geotechnical: null, // Explicitly omitted: frame analysis succeeds without inventing SBC!
    };

    const solver = new AwatifStructuralSolver();
    const { analyticalModel, loadTakeoff } = await assembleLoadedAnalyticalFrameModel(
      system,
      inputs,
      solver,
    );

    expect(loadTakeoff.memberSelfWeightKn).toBeGreaterThan(100);
    expect(loadTakeoff.slabSelfWeightKn + loadTakeoff.unassignedGravityKnByCase!.DL).toBeGreaterThan(200);
    expect(loadTakeoff.unassignedGravityKnByCase!.DL).toBeGreaterThan(0);
    expect(loadTakeoff.waterTankLoadKn).toBe(80);
    expect(loadTakeoff.loadSourceAudit?.find(r => r.sourceId === 'ROOF_WATER_TANK')).toMatchObject({
      transferMethod: 'REVIEWED_ROOF_TANK_REACTIONS',
      receivingElementIds: supports.map(column => system.nodes[column.endAnalyticalNodeIndex]!.id),
    });

    for (const waterTankSupport of [undefined, {
      ...inputs.waterTankSupport!, centerOfGravityMm: { x: inputs.waterTankSupport!.centerOfGravityMm.x + 100,
        y: inputs.waterTankSupport!.centerOfGravityMm.y },
    }]) {
      const unresolved = await assembleLoadedAnalyticalFrameModel(system, { ...inputs, waterTankSupport });
      expect(unresolved.loadTakeoff.waterTankLoadKn).toBe(0);
      expect(unresolved.loadTakeoff.unassignedGravityKnByCase!.SDL - loadTakeoff.unassignedGravityKnByCase!.SDL).toBeCloseTo(80, 9);
      expect(unresolved.loadTakeoff.loadSourceAudit?.find(r => r.sourceId === 'ROOF_WATER_TANK')?.receivingElementIds).toEqual([]);
    }
    expect(loadTakeoff.masonryWallLoadKn).toBeGreaterThan(100);
    expect(loadTakeoff.seismicSummary?.designBaseShearVbXKn).toBeGreaterThan(10);
    expect(loadTakeoff.windBaseShearXKn).toBeGreaterThan(10);

    const envelope = await solver.analyze(analyticalModel, { preferredBackend: 'AWATIF_CPP_WASM' });

    // Verify zero duplicate self-weight & 100% exact vertical reaction conservation
    const slsRes = envelope.combinationResults.SLS_10_DL_LL!;
    expect(slsRes.diagnostics.executionBackend).toBe('AWATIF_CPP_WASM');
    expect(slsRes.equilibrium.isEquilibrated).toBe(true);

    const totalVerticalReactionSls = slsRes.reactions.reduce((s, r) => s + r.reactionKnM[2], 0);
    const expectedTotalGravity =
      loadTakeoff.totalDeadPlusSdlKn + loadTakeoff.totalOccupancyLiveKn + loadTakeoff.totalRoofLiveKn;
    expect(Math.abs(totalVerticalReactionSls - expectedTotalGravity) / expectedTotalGravity).toBeLessThan(1e-7);

    // ULS 1.5(DL+SDL+LL) vertical reaction must be 1.5x SLS vertical reaction!
    const ulsRes = envelope.combinationResults.ULS_15_DL_LL!;
    expect(ulsRes.equilibrium.isEquilibrated).toBe(true);
    const totalVerticalReactionUls = ulsRes.reactions.reduce((s, r) => s + r.reactionKnM[2], 0);
    expect(Math.abs(totalVerticalReactionUls - 1.5 * expectedTotalGravity) / expectedTotalGravity).toBeLessThan(1e-7);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  DoorType,
  EditorEngine,
  EXACT_MM_PER_FOOT,
  EXACT_MM_PER_INCH,
  EXACT_SQMM_PER_SQFT,
  EXACT_SQMM_PER_SQM,
  PlotShape,
  ReplaceBuildingCommand,
  RoomType,
  SwingDirection,
  WindowType,
  createDoor,
  createFloor,
  createGenerationControlState,
  createRoom,
  createSite,
  createWindow,
  deserializeBuilding,
  parseArchitecturalAreaMm2,
  parseArchitecturalLengthMm,
  parseDimensionPairMm,
  serializeBuilding,
  stableValueHash,
  updateGenerationControl,
  type Building,
  type Floor,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import {
  generateApartmentWalls,
  measureApartmentAreaLedger,
  polygonArea,
} from '@ai-floor-planner/geometry-engine';
import {
  ARCHITECTURAL_REQUIREMENT_HIERARCHY,
  auditFloorFunctionalQuality,
  compareCanonicalBuildingAlternatives,
  computeFloorEfficiencyBreakdown,
  evaluateBriefRequirementHierarchyAndConflicts,
  optimizeRoomArea,
  proposeControlledCadEdit,
  proposeProtectedLocalRegeneration,
  resolveExplorationConfigFromControls,
  solveMultiSheetApartmentProject,
  verifyAlternativeRespectsControls,
  verifyProtectedRegionInvariance,
} from '../index';

function makeFourFlatConfig(overrides: Partial<MultiSheetApartmentConfig> = {}): MultiSheetApartmentConfig {
  return {
    projectId: 'phase5a-four-flat',
    projectName: 'Phase 5A Four-Flat Benchmark',
    structuralLayoutMode: 'DEFERRED',
    plotWidthMm: 36_000,
    plotDepthMm: 32_000,
    roadWidthMm: 12_000,
    roadAccessSides: [Direction.South],
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'pune_pmc',
    verticalStackType: 'STILT_PLUS_N',
    numTypicalFloors: 2,
    floorToFloorHeightMm: 3150,
    stiltHeightMm: 3150,
    flatsPerFloor: 4,
    units: [
      { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
      { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
      { unitIndex: 3, bhkType: '2BHK', hasUtilityBalcony: true },
      { unitIndex: 4, bhkType: '2BHK', hasUtilityBalcony: true },
    ],
    setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
    ...overrides,
  };
}

describe('Phase 5A — Gates B, C, D & E: Architectural Intelligence, Exact Units & Protected Localized Regeneration', () => {
  const sharedFourFlat = solveMultiSheetApartmentProject(makeFourFlatConfig()).building;
  const typicalFloor = sharedFourFlat.floors.find(f => (f.apartmentUnits?.length ?? 0) === 4)!;

  describe('Gate D — Exact Multi-Unit Length & Area Parsing + Locked Room Protection', () => {
    it('parses decimal, fractional imperial, metric, and W×L dimension expressions to exact mm and mm²', () => {
      const lenMm = parseArchitecturalLengthMm('3650 mm');
      expect(lenMm).toMatchObject({ ok: true, mm: 3650 });

      const lenM = parseArchitecturalLengthMm('3.65 m');
      expect(lenM.ok && lenM.mm).toBeCloseTo(3650, 5);

      const lenFtIn = parseArchitecturalLengthMm(`12' 6"`);
      expect(lenFtIn.ok && lenFtIn.mm).toBeCloseTo(12 * EXACT_MM_PER_FOOT + 6 * EXACT_MM_PER_INCH, 5);

      const lenMixedFrac = parseArchitecturalLengthMm(`12' 6 1/2"`);
      expect(lenMixedFrac.ok && lenMixedFrac.mm).toBeCloseTo(12 * EXACT_MM_PER_FOOT + 6.5 * EXACT_MM_PER_INCH, 5);

      const areaSqFtFrac = parseArchitecturalAreaMm2('165 1/2 sq ft');
      expect(areaSqFtFrac.ok && areaSqFtFrac.mm2).toBeCloseTo(165.5 * EXACT_SQMM_PER_SQFT, 2);

      const areaSqM = parseArchitecturalAreaMm2('18.25 sq m');
      expect(areaSqM.ok && areaSqM.mm2).toBeCloseTo(18.25 * EXACT_SQMM_PER_SQM, 2);

      const dimPair = parseDimensionPairMm(`12' 0" x 15' 0"`);
      expect(dimPair.ok && dimPair.areaMm2).toBeCloseTo(180 * EXACT_SQMM_PER_SQFT, 2);

      const areaFromDims = parseArchitecturalAreaMm2('3600 x 4500 mm');
      expect(areaFromDims.ok && areaFromDims.mm2).toBe(16_200_000);
    });

    it('never shrinks locked neighbour rooms during room area customization', () => {
      const unit1 = typicalFloor.apartmentUnits![0]!;
      const unit1Rooms = typicalFloor.rooms.filter(r => r.unitId === unit1.id);
      const bedrooms = unit1Rooms.filter(r => r.type === RoomType.Bedroom);
      expect(bedrooms.length).toBeGreaterThanOrEqual(2);
      const targetBed = bedrooms[0]!;
      const siblingBed = bedrooms[1]!;

      const lockedControl = updateGenerationControl(createGenerationControlState(), {
        lockedEntityIds: [siblingBed.id],
      });
      const res = optimizeRoomArea(sharedFourFlat, targetBed.id, {
        targetAreaMm2: Math.round(targetBed.area * 1.12),
        allowAdjacentAdjustments: true,
        control: lockedControl,
      });

      for (const cand of res.candidates) {
        const afterSibling = cand.building.floors
          .find(f => f.id === typicalFloor.id)!
          .rooms.find(r => r.id === siblingBed.id)!;
        expect(stableValueHash(afterSibling.boundary)).toBe(stableValueHash(siblingBed.boundary));
      }
    });
  });

  describe('Gate B — 7-Level Requirement Hierarchy, Conflict Resolution & Efficiency Breakdown', () => {
    it('enforces the 7-level hierarchy and surfaces measurable alternatives on infeasible/conflicting briefs', () => {
      expect(ARCHITECTURAL_REQUIREMENT_HIERARCHY).toHaveLength(7);
      expect(ARCHITECTURAL_REQUIREMENT_HIERARCHY[0]!.id).toBe('PHYSICAL_MANDATORY');
      expect(ARCHITECTURAL_REQUIREMENT_HIERARCHY[1]!.id).toBe('EXPLICIT_USER_CONSTRAINTS');

      // Conflict 1: Tiny plot for 4 × 3BHK @ 1400 sq ft each + 1 staircase requested on 8-storey (> 15m) high-rise
      const infeasibleEval = evaluateBriefRequirementHierarchyAndConflicts(
        makeFourFlatConfig({
          plotWidthMm: 16_000,
          plotDepthMm: 18_000,
          numTypicalFloors: 8,
          aiPrompt: 'Provide 1 staircase and central lift.',
          units: [
            { unitIndex: 1, bhkType: '3BHK', targetCarpetSqFt: 1400, hasUtilityBalcony: true },
            { unitIndex: 2, bhkType: '3BHK', targetCarpetSqFt: 1400, hasUtilityBalcony: true },
            { unitIndex: 3, bhkType: '3BHK', targetCarpetSqFt: 1400, hasUtilityBalcony: true },
            { unitIndex: 4, bhkType: '3BHK', targetCarpetSqFt: 1400, hasUtilityBalcony: true },
          ],
        }),
      );
      expect(infeasibleEval.isFeasibleWithoutConflict).toBe(false);
      const codes = infeasibleEval.conflicts.map(c => c.code);
      expect(codes).toContain('ENVELOPE_TOO_SMALL_FOR_PROGRAM');
      expect(codes).toContain('CARPET_TARGETS_EXCEED_ENVELOPE');
      expect(codes).toContain('HIGH_RISE_STAIR_MINIMUM_OVERRIDE');
      expect(
        infeasibleEval.conflicts.find(c => c.code === 'CARPET_TARGETS_EXCEED_ENVELOPE')!.alternatives.length,
      ).toBeGreaterThan(0);

      // Conflict 2: Prompt contradiction (East core AND West core)
      const contradictoryEval = evaluateBriefRequirementHierarchyAndConflicts(
        makeFourFlatConfig({
          aiPrompt: 'Place the lift core on the east side and place the staircase core on the west side.',
        }),
      );
      expect(contradictoryEval.conflicts.some(c => c.code === 'PROMPT_CONTRADICTION')).toBe(true);
    });

    it('computes exact planar-conserved floor efficiency breakdown and passes functional architectural quality audit', () => {
      const breakdown = computeFloorEfficiencyBreakdown(typicalFloor);
      expect(breakdown.isPlanarConserved).toBe(true);
      expect(Math.abs(breakdown.planarDeltaMm2)).toBeLessThan(0.001);
      expect(breakdown.residualUnassigned.areaMm2).toBeLessThan(0.001);
      expect(breakdown.modeledHabitableCarpet.areaSqM).toBeGreaterThan(100);
      expect(breakdown.wallFootprint.areaSqM).toBeGreaterThan(10);
      expect(breakdown.commonCirculation.areaSqM).toBeGreaterThan(5);
      expect(breakdown.verticalCore.areaSqM).toBeGreaterThan(10);

      const quality = auditFloorFunctionalQuality(typicalFloor);
      expect(quality.findings).toEqual([]);
      expect(quality.passed).toBe(true);
    });
  });

  describe('Gate C — Multi-Dimensional Design Diversity & User Exploration Controls', () => {
    it('distinguishes genuinely different topologies/massings and rejects near-duplicates with minor dimension tweaks', () => {
      const altMassing = solveMultiSheetApartmentProject(
        makeFourFlatConfig({
          generationSeed: 2,
          buildingMassingShape: 'H_SHAPE_WING',
        }),
      ).building;

      const cmpDistinct = compareCanonicalBuildingAlternatives(sharedFourFlat, altMassing);
      expect(cmpDistinct.meaningful).toBe(true);
      expect(cmpDistinct.massingShapeChanged).toBe(true);

      // Identical physical layout is rejected as duplicate
      const cmpIdentical = compareCanonicalBuildingAlternatives(sharedFourFlat, sharedFourFlat);
      expect(cmpIdentical.meaningful).toBe(false);
      expect(cmpIdentical.physicalGeometryIdentical).toBe(true);

      // Exploration controls: preserveExteriorFootprint keeps massing locked while exploring internal archetype
      const controlledCfg = resolveExplorationConfigFromControls(
        makeFourFlatConfig({ buildingMassingShape: 'COMPACT_DOUBLE_LOADED' }),
        sharedFourFlat,
        { preserveExteriorFootprint: true, preserveCore: true, changeInternalLayout: true, improveDaylight: true },
        3,
        [sharedFourFlat],
      );
      expect(controlledCfg.buildingMassingShape).toBe('COMPACT_DOUBLE_LOADED');
      expect(controlledCfg.lockedMassingShape).toBe('COMPACT_DOUBLE_LOADED');
      expect(controlledCfg.preferredArchetype).toBeDefined();

      const altInternal = solveMultiSheetApartmentProject(controlledCfg).building;
      const controlCheck = verifyAlternativeRespectsControls(sharedFourFlat, altInternal, {
        preserveExteriorFootprint: true,
      });
      expect(controlCheck.ok).toBe(true);
    });
  });

  describe('Gate E — All 14 Mandatory Protected Localized Regeneration Scenarios', () => {
    it('(1-5) regenerates ONLY Flat 2 of a 4-flat floor while keeping Flats 1, 3, 4, 230 mm party walls, central core, and other floors byte-identical', () => {
      const beforeSnapshot = stableValueHash(sharedFourFlat);
      const res = proposeProtectedLocalRegeneration({
        building: sharedFourFlat,
        floorId: typicalFloor.id,
        scope: 'SINGLE_FLAT',
        operation: 'REGENERATE_ALTERNATIVE',
        targetUnitIndex: 2,
      });

      // Caller building was never mutated during preview generation
      expect(stableValueHash(sharedFourFlat)).toBe(beforeSnapshot);

      expect(res.status, res.message).toBe('PREVIEW_READY');
      expect(res.candidates.length).toBeGreaterThanOrEqual(1);
      const chosen = res.selectedCandidate!;
      const proof = chosen.invarianceProof;

      // E5.2: Flats 1, 3, 4 byte-identical
      expect(proof.unaffectedUnitsIdentical).toBe(true);
      expect(proof.beforeProtectedDigest).toBe(proof.afterProtectedDigest);

      // E5.3: Shared 230 mm party walls & exterior outline invariant
      expect(proof.partyWallsGeometryInvariant).toBe(true);
      expect(proof.exteriorOutlineInvariant).toBe(true);

      // E5.4: Central core & structural columns identical
      expect(proof.coreElementsIdentical).toBe(true);
      expect(proof.columnsIdentical).toBe(true);

      // E5.5: All other floors byte-identical
      expect(proof.unaffectedFloorsIdentical).toBe(true);

      // Planar conservation < 0.001 mm²
      expect(proof.zoneAreaDeltaMm2).toBeLessThan(0.001);
      expect(proof.floorPlanarDeltaMm2).toBeLessThan(0.001);

      // Verify Flat 2 genuinely changed while Flats 1, 3, 4 did not change a single coordinate
      const afterFloor = chosen.building.floors.find(f => f.id === typicalFloor.id)!;
      const flat2Id = typicalFloor.apartmentUnits![1]!.id;
      for (const unit of typicalFloor.apartmentUnits!) {
        const beforeUnitRooms = typicalFloor.rooms.filter(r => r.unitId === unit.id);
        const afterUnitRooms = afterFloor.rooms.filter(r => r.unitId === unit.id);
        if (unit.id === flat2Id) {
          expect(stableValueHash(afterUnitRooms.map(r => r.boundary))).not.toBe(
            stableValueHash(beforeUnitRooms.map(r => r.boundary)),
          );
        } else {
          expect(afterUnitRooms).toEqual(beforeUnitRooms);
        }
      }
    });

    it('rejects protected opening and wall metadata changes without a coordinate change', () => {
      const flat2Id = typicalFloor.apartmentUnits![1]!.id;
      const protectedRooms = new Set(typicalFloor.rooms.filter(room => room.unitId !== flat2Id).map(room => room.id));
      const window = typicalFloor.windows.find(opening => protectedRooms.has(opening.roomId))!;
      const wall = typicalFloor.walls.find(item => item.id === window.wallId)!;
      const alteredFloors: Floor[] = [
        { ...typicalFloor, windows: typicalFloor.windows.map(item => item.id === window.id
          ? { ...item, sillHeight: item.sillHeight + 10 } : item) },
        { ...typicalFloor, walls: typicalFloor.walls.map(item => item.id === wall.id
          ? { ...item, material: 'unrelated wall material' } : item) },
      ];
      for (const altered of alteredFloors) {
        const proof = verifyProtectedRegionInvariance({
          before: sharedFourFlat,
          after: { ...sharedFourFlat, floors: sharedFourFlat.floors.map(floor => floor.id === altered.id ? altered : floor) },
          targetFloorId: typicalFloor.id,
          targetUnitId: flat2Id,
          editableRoomIdsBefore: new Set(typicalFloor.rooms.filter(room => room.unitId === flat2Id).map(room => room.id)),
        });
        expect(proof.passed, proof.violations.join(' ')).toBe(false);
        expect(proof.beforeProtectedDigest).not.toBe(proof.afterProtectedDigest);
      }
    });

    it('(6) regenerates ONLY 1 bedroom inside Flat 2 without affecting other flats', () => {
      const flat2Id = typicalFloor.apartmentUnits![1]!.id;
      const bed = typicalFloor.rooms.find(r => r.unitId === flat2Id && r.type === RoomType.Bedroom)!;
      const res = proposeProtectedLocalRegeneration({
        building: sharedFourFlat,
        floorId: typicalFloor.id,
        scope: 'SINGLE_ROOM',
        operation: 'REGENERATE_ROOM',
        targetUnitId: flat2Id,
        targetRoomIds: [bed.id],
        targetAreaMm2: Math.round(bed.area * 1.08),
      });
      expect(res.status, res.message).toBe('PREVIEW_READY');
      expect(res.selectedCandidate!.invarianceProof.unaffectedUnitsIdentical).toBe(true);
      expect(res.selectedCandidate!.invarianceProof.unaffectedFloorsIdentical).toBe(true);
    });

    it('(7) relocates Kitchen inside Flat 2 by >= 800 mm while preserving connectivity, ventilation, and Flats 1, 3, 4', () => {
      const flat2Id = typicalFloor.apartmentUnits![1]!.id;
      const beforeK = typicalFloor.rooms.find(r => r.unitId === flat2Id && r.type === RoomType.Kitchen)!;

      const res = proposeProtectedLocalRegeneration({
        building: sharedFourFlat,
        floorId: typicalFloor.id,
        scope: 'SINGLE_FLAT',
        operation: 'RELOCATE_KITCHEN',
        targetUnitId: flat2Id,
      });
      expect(res.status, res.message).toBe('PREVIEW_READY');
      const afterFloor = res.selectedCandidate!.building.floors.find(f => f.id === typicalFloor.id)!;
      const afterK = afterFloor.rooms.find(r => r.unitId === flat2Id && r.type === RoomType.Kitchen)!;
      const centroidShift = Math.hypot(
        afterK.x + afterK.width / 2 - (beforeK.x + beforeK.width / 2),
        afterK.y + afterK.height / 2 - (beforeK.y + beforeK.height / 2),
      );
      expect(centroidShift).toBeGreaterThanOrEqual(800);
      expect(res.selectedCandidate!.invarianceProof.passed).toBe(true);
    });

    it('(8) converts Flat 2 from 2BHK to 3BHK when flat area allows while keeping Flats 1, 3, 4 as untouched 2BHKs', () => {
      const res = proposeControlledCadEdit({
        building: sharedFourFlat,
        floorId: typicalFloor.id,
        instruction: 'Convert Flat 2 from 2BHK to 3BHK',
      });
      expect(res.status, res.message).toBe('PREVIEW_READY');
      expect(res.invarianceProof?.passed).toBe(true);

      const afterFloor = res.proposedBuilding!.floors.find(f => f.id === typicalFloor.id)!;
      const flat2After = afterFloor.apartmentUnits![1]!;
      expect(flat2After.unitType).toBe('3BHK');
      const flat2Beds = afterFloor.rooms.filter(r => r.unitId === flat2After.id && r.type === RoomType.Bedroom);
      expect(flat2Beds).toHaveLength(3);

      // Flats 1, 3, 4 are still 2BHK with 2 bedrooms each!
      for (const idx of [0, 2, 3]) {
        const u = afterFloor.apartmentUnits![idx]!;
        expect(u.unitType).toBe('2BHK');
        expect(afterFloor.rooms.filter(r => r.unitId === u.id && r.type === RoomType.Bedroom)).toHaveLength(2);
      }
    });

    it('(9) increases Master Bedroom area in Flat 2 while keeping Flats 1, 3, 4 and party walls untouched', () => {
      const flat2Id = typicalFloor.apartmentUnits![1]!.id;
      const beforeMaster = typicalFloor.rooms.find(
        r => r.unitId === flat2Id && r.type === RoomType.Bedroom && r.name.toLowerCase().includes('master'),
      )!;
      const targetMm2 = Math.round(beforeMaster.area * 1.12);

      const res = proposeProtectedLocalRegeneration({
        building: sharedFourFlat,
        floorId: typicalFloor.id,
        scope: 'SINGLE_FLAT',
        operation: 'RESIZE_MASTER_BEDROOM',
        targetUnitId: flat2Id,
        targetAreaMm2: targetMm2,
      });
      expect(res.status, res.message).toBe('PREVIEW_READY');
      const afterFloor = res.selectedCandidate!.building.floors.find(f => f.id === typicalFloor.id)!;
      const afterMaster = afterFloor.rooms.find(
        r => r.unitId === flat2Id && r.type === RoomType.Bedroom && r.name.toLowerCase().includes('master'),
      )!;
      expect(afterMaster.area).toBeGreaterThan(beforeMaster.area);
      expect(res.selectedCandidate!.invarianceProof.passed).toBe(true);
    });

    it('(10) changes Living/Dining arrangement in Flat 2 (both full-flat and connected room-group preserving bedrooms)', () => {
      const flat2Id = typicalFloor.apartmentUnits![1]!.id;
      const resFlat = proposeProtectedLocalRegeneration({
        building: sharedFourFlat,
        floorId: typicalFloor.id,
        scope: 'SINGLE_FLAT',
        operation: 'RECONFIGURE_LIVING_DINING',
        targetUnitId: flat2Id,
      });
      expect(resFlat.status, resFlat.message).toBe('PREVIEW_READY');
      expect(resFlat.selectedCandidate!.invarianceProof.passed).toBe(true);

      // Also test CONNECTED_ROOM_GROUP on a regenerated flat whose public zone is a clean rectangular sub-box
      const baseForGroup = resFlat.selectedCandidate!.building;
      const floorForGroup = baseForGroup.floors.find(f => f.id === typicalFloor.id)!;
      const publicGroup = floorForGroup.rooms.filter(
        r =>
          r.unitId === flat2Id &&
          (r.type === RoomType.Living || r.type === RoomType.Dining || r.type === RoomType.Kitchen || r.type === RoomType.Balcony || r.type === RoomType.Foyer),
      );
      const beforeBeds = floorForGroup.rooms.filter(r => r.unitId === flat2Id && r.type === RoomType.Bedroom);

      const resGroup = proposeProtectedLocalRegeneration({
        building: baseForGroup,
        floorId: floorForGroup.id,
        scope: 'CONNECTED_ROOM_GROUP',
        operation: 'RECONFIGURE_LIVING_DINING',
        targetUnitId: flat2Id,
        targetRoomIds: publicGroup.map(r => r.id),
      });
      expect(resGroup.status).toBe('PREVIEW_READY');
      const afterGroupFloor = resGroup.selectedCandidate!.building.floors.find(f => f.id === floorForGroup.id)!;
      const afterBeds = afterGroupFloor.rooms.filter(r => r.unitId === flat2Id && r.type === RoomType.Bedroom);
      // Even Flat 2's own bedrooms stayed 100% byte-identical!
      expect(afterBeds).toEqual(beforeBeds);
    });

    it('(11) regenerates inside a non-rectangular trapezoid/chamfered flat with < 0.001 mm² planar conservation', () => {
      // Construct a clean 2-flat floor where Flat 1 is rectangular [0..10000, 0..10000],
      // Core Corridor is [10000..13000, 0..10000], and Flat 2 is a right-trapezoid [13000..23500] tapering to [13000..22500] along angled East plot line!
      const floorBoundary = {
        points: [
          { x: 0, y: 0 },
          { x: 23500, y: 0 },
          { x: 22500, y: 10000 },
          { x: 0, y: 10000 },
        ],
      };
      const flat1Boundary = {
        points: [
          { x: 0, y: 0 },
          { x: 10000, y: 0 },
          { x: 10000, y: 10000 },
          { x: 0, y: 10000 },
        ],
      };
      const corrBoundary = {
        points: [
          { x: 10000, y: 0 },
          { x: 13000, y: 0 },
          { x: 13000, y: 10000 },
          { x: 10000, y: 10000 },
        ],
      };
      const flat2Boundary = {
        points: [
          { x: 13000, y: 0 },
          { x: 23500, y: 0 },
          { x: 22500, y: 10000 },
          { x: 13000, y: 10000 },
        ],
      };

      const makeSimpleRoom = (
        id: string,
        name: string,
        type: RoomType,
        spaceUse: NonNullable<Floor['rooms'][number]['spaceUse']>,
        unitId: string | undefined,
        pts: readonly { x: number; y: number }[],
      ) => {
        const rx = Math.min(...pts.map(p => p.x));
        const ry = Math.min(...pts.map(p => p.y));
        const rw = Math.max(...pts.map(p => p.x)) - rx;
        const rh = Math.max(...pts.map(p => p.y)) - ry;
        const base = createRoom({
          floorId: 'f_trap',
          name,
          type,
          x: rx,
          y: ry,
          width: rw,
          height: rh,
          tags: unitId ? [`flat:${unitId}`, `role:${type}`] : [`role:${type}`],
        });
        return {
          ...base,
          id,
          spaceUse,
          planningZone: 'PUBLIC' as const,
          ...(unitId ? { unitId } : {}),
          area: polygonArea({ points: [...pts] }),
          boundary: { points: [...pts] },
        };
      };

      const rooms = [
        makeSimpleRoom('f_trap::f1_bed1', 'Flat 1 Master Bed', RoomType.Bedroom, 'UNIT', 'u1', [
          { x: 0, y: 0 }, { x: 4500, y: 0 }, { x: 4500, y: 5000 }, { x: 0, y: 5000 },
        ]),
        makeSimpleRoom('f_trap::f1_bath1', 'Flat 1 Bath', RoomType.Bathroom, 'UNIT', 'u1', [
          { x: 0, y: 5000 }, { x: 4500, y: 5000 }, { x: 4500, y: 10000 }, { x: 0, y: 10000 },
        ]),
        makeSimpleRoom('f_trap::f1_liv', 'Flat 1 Living', RoomType.Living, 'UNIT', 'u1', [
          { x: 4500, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 6500 }, { x: 4500, y: 6500 },
        ]),
        makeSimpleRoom('f_trap::f1_kit', 'Flat 1 Kitchen', RoomType.Kitchen, 'UNIT', 'u1', [
          { x: 4500, y: 6500 }, { x: 10000, y: 6500 }, { x: 10000, y: 10000 }, { x: 4500, y: 10000 },
        ]),
        makeSimpleRoom('f_trap::corr', 'Common Corridor', RoomType.Corridor, 'COMMON', undefined, corrBoundary.points),
        makeSimpleRoom('f_trap::f2_liv', 'Flat 2 Living', RoomType.Living, 'UNIT', 'u2', [
          { x: 13000, y: 0 }, { x: 18000, y: 0 }, { x: 18000, y: 6500 }, { x: 13000, y: 6500 },
        ]),
        makeSimpleRoom('f_trap::f2_kit', 'Flat 2 Kitchen', RoomType.Kitchen, 'UNIT', 'u2', [
          { x: 13000, y: 6500 }, { x: 18000, y: 6500 }, { x: 18000, y: 10000 }, { x: 13000, y: 10000 },
        ]),
        makeSimpleRoom('f_trap::f2_bed1', 'Flat 2 Master Bed', RoomType.Bedroom, 'UNIT', 'u2', [
          { x: 18000, y: 0 }, { x: 23500, y: 0 }, { x: 23100, y: 4000 }, { x: 18000, y: 4000 },
        ]),
        makeSimpleRoom('f_trap::f2_bath', 'Flat 2 Bath', RoomType.Bathroom, 'UNIT', 'u2', [
          { x: 18000, y: 4000 }, { x: 23100, y: 4000 }, { x: 22900, y: 6000 }, { x: 18000, y: 6000 },
        ]),
        makeSimpleRoom('f_trap::f2_bed2', 'Flat 2 Bed 2', RoomType.Bedroom, 'UNIT', 'u2', [
          { x: 18000, y: 6000 }, { x: 22900, y: 6000 }, { x: 22500, y: 10000 }, { x: 18000, y: 10000 },
        ]),
      ];
      const walls = generateApartmentWalls(rooms, 'f_trap', floorBoundary, true);
      const findWall = (a: string, b?: string) =>
        walls.find(w => (b ? w.roomIds.includes(a) && w.roomIds.includes(b) : w.roomIds.length === 1 && w.roomIds[0] === a))!;

      const wEnt1 = findWall('f_trap::corr', 'f_trap::f1_liv');
      const wEnt2 = findWall('f_trap::corr', 'f_trap::f2_liv');
      const wF1B1 = findWall('f_trap::f1_liv', 'f_trap::f1_bed1');
      const wF1Bath = findWall('f_trap::f1_liv', 'f_trap::f1_bath1');
      const wF1Kit = findWall('f_trap::f1_liv', 'f_trap::f1_kit');
      const wF1ExtBath = findWall('f_trap::f1_bath1');

      const mid = (w: (typeof walls)[number]) => ({
        x: (w.startPoint.x + w.endPoint.x) / 2,
        y: (w.startPoint.y + w.endPoint.y) / 2,
      });

      const mkDoor = (id: string, wallId: string, position: { x: number; y: number }, width: number, connectsRooms: [string, string]) => ({
        ...createDoor({ floorId: 'f_trap', wallId, position, width, height: 2100, type: DoorType.Single, swingDirection: SwingDirection.Left, connectsRooms }),
        id,
        widthMm: width,
        openingGeometryVersion: 1 as const,
        positionReference: 'CENTER' as const,
      });

      const baseTrapFloor = createFloor({
        buildingId: 'b_trap',
        level: 1,
        name: 'Trapezoid Floor',
        floorHeight: 3000,
        boundary: floorBoundary,
      });

      const trapFloor: Floor = {
        ...baseTrapFloor,
        id: 'f_trap',
        rooms,
        walls,
        doors: [
          mkDoor('d_ent1', wEnt1.id, mid(wEnt1), 1050, ['f_trap::corr', 'f_trap::f1_liv']),
          mkDoor('d_f1_b1', wF1B1.id, mid(wF1B1), 900, ['f_trap::f1_liv', 'f_trap::f1_bed1']),
          mkDoor('d_f1_ba', wF1Bath.id, mid(wF1Bath), 750, ['f_trap::f1_liv', 'f_trap::f1_bath1']),
          mkDoor('d_f1_kit', wF1Kit.id, mid(wF1Kit), 900, ['f_trap::f1_liv', 'f_trap::f1_kit']),
          mkDoor('d_ent2', wEnt2.id, mid(wEnt2), 1050, ['f_trap::corr', 'f_trap::f2_liv']),
        ],
        windows: [
          {
            ...createWindow({
              floorId: 'f_trap',
              wallId: wF1ExtBath.id,
              roomId: 'f_trap::f1_bath1',
              position: mid(wF1ExtBath),
              width: 600,
              height: 600,
              sillHeight: 1500,
              type: WindowType.Ventilator,
            }),
            id: 'w_f1_bath',
            widthMm: 600,
            openingGeometryVersion: 1,
            positionReference: 'CENTER',
          },
        ],
        apartmentUnits: [
          { id: 'u1', unitType: '1BHK', boundary: flat1Boundary },
          { id: 'u2', unitType: '2BHK', boundary: flat2Boundary },
        ],
      };

      const trapSite = createSite({
        plotWidth: 28000,
        plotDepth: 15000,
        plotShape: PlotShape.Irregular,
        setbacks: { front: 2000, rear: 2000, left: 2000, right: 2000 },
        roadFacing: Direction.South,
        roadWidth: 12000,
      });

      const trapBuilding: Building = {
        id: 'b_trap',
        projectId: 'p_trap',
        name: 'Irregular Trapezoid Apartment',
        site: {
          ...trapSite,
          plotBoundary: { points: [{ x: -2000, y: -2000 }, { x: 26000, y: -2000 }, { x: 25000, y: 13000 }, { x: -2000, y: 13000 }] },
        },
        floors: [trapFloor],
        metadata: { projectId: 'p_trap', description: 'Trapezoid test', tags: [] },
        version: 1,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };

      expect(Math.abs(measureApartmentAreaLedger(trapFloor).delta)).toBeLessThan(0.001);

      const trapRes = proposeProtectedLocalRegeneration({
        building: trapBuilding,
        floorId: 'f_trap',
        scope: 'SINGLE_FLAT',
        operation: 'REGENERATE_ALTERNATIVE',
        targetUnitId: 'u2',
      });
      expect(trapRes.status, trapRes.message).toBe('PREVIEW_READY');
      expect(trapRes.selectedCandidate!.invarianceProof.passed).toBe(true);
      expect(trapRes.selectedCandidate!.invarianceProof.zoneAreaDeltaMm2).toBeLessThan(0.001);
      expect(trapRes.selectedCandidate!.invarianceProof.floorPlanarDeltaMm2).toBeLessThan(0.001);
    });

    it('(12) rejects infeasible local BHK/area targets, locked flats, and stale revisions without mutating state', () => {
      // Compact 4-flat on small plot -> Flat 2 < 88 m², so 4BHK local conversion is rejected cleanly
      const compactFour = solveMultiSheetApartmentProject(
        makeFourFlatConfig({ plotWidthMm: 26_000, plotDepthMm: 24_000 }),
      ).building;
      const compFloor = compactFour.floors.find(f => (f.apartmentUnits?.length ?? 0) === 4)!;
      const beforeHash = stableValueHash(compactFour);

      const infeasible4Bhk = proposeProtectedLocalRegeneration({
        building: compactFour,
        floorId: compFloor.id,
        scope: 'SINGLE_FLAT',
        operation: 'CONVERT_BHK',
        targetBhk: '4BHK',
        targetUnitIndex: 2,
      });
      expect(infeasible4Bhk.status).toBe('REJECTED_BY_CONSTRAINTS');
      expect(infeasible4Bhk.selectedCandidate).toBeNull();
      expect(stableValueHash(compactFour)).toBe(beforeHash);

      // Locked flat check
      const flat2Id = compFloor.apartmentUnits![1]!.id;
      const lockedFlatRes = proposeProtectedLocalRegeneration({
        building: compactFour,
        floorId: compFloor.id,
        scope: 'SINGLE_FLAT',
        targetUnitId: flat2Id,
        control: updateGenerationControl(createGenerationControlState(), { lockedEntityIds: [flat2Id] }),
      });
      expect(lockedFlatRes.status).toBe('REFUSED_LOCKED');

      // Stale revision check
      const staleRes = proposeProtectedLocalRegeneration({
        building: compactFour,
        floorId: compFloor.id,
        scope: 'SINGLE_FLAT',
        targetUnitId: flat2Id,
        expectedRevision: compactFour.version + 5,
      });
      expect(staleRes.status).toBe('REFUSED_STALE_REVISION');
    });

    it('(13-14) supports atomic Undo/Redo via EditorEngine and lossless save/reload round-trip after localized regeneration', () => {
      const engine = new EditorEngine(sharedFourFlat);
      const hashBefore = stableValueHash(engine.getBuilding());

      const proposal = proposeProtectedLocalRegeneration({
        building: engine.getBuilding(),
        floorId: typicalFloor.id,
        scope: 'SINGLE_FLAT',
        operation: 'REGENERATE_ALTERNATIVE',
        targetUnitIndex: 2,
      });
      expect(proposal.status).toBe('PREVIEW_READY');
      const proposed = proposal.selectedCandidate!.building;

      engine.execute(
        new ReplaceBuildingCommand(engine.getBuilding(), proposed, 'Protected Flat 2 Regeneration', true),
      );
      const hashAfter = stableValueHash(engine.getBuilding());
      expect(hashAfter).not.toBe(hashBefore);
      expect(engine.getBuilding().version).toBe(sharedFourFlat.version + 1);

      // Undo restores exact pre-regeneration hash
      engine.undo();
      expect(stableValueHash(engine.getBuilding())).toBe(hashBefore);

      // Redo restores exact post-regeneration hash
      engine.redo();
      expect(stableValueHash(engine.getBuilding())).toBe(hashAfter);

      // Save & reload round-trip (`serializeBuilding` -> `deserializeBuilding`)
      const json = serializeBuilding(engine.getBuilding());
      const reloaded = deserializeBuilding(json);
      expect(stableValueHash(reloaded)).toBe(hashAfter);
      const verifyAfterReload = verifyProtectedRegionInvariance({
        before: sharedFourFlat,
        after: reloaded,
        targetFloorId: typicalFloor.id,
        editableRoomIdsBefore: new Set(proposal.editableRoomIds),
        targetUnitId: proposal.targetUnitId,
      });
      expect(verifyAfterReload.passed).toBe(true);
    });
  });
});

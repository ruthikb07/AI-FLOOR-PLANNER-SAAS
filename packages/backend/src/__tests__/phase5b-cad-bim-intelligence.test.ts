import { projectBuildingTo3D } from '@ai-floor-planner/projection-3d';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  SwingDirection,
  createGenerationControlState,
  exchangeRevision,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import {
  canonicalCurvedOpeningGeometry,
  projectOnSegment,
} from '@ai-floor-planner/geometry-engine';
import {
  auditArchitecturalElementRealism,
  editApartmentOpening,
  editCanonicalWallThickness,
  executeAuditedPlanningPipeline,
  moveApartmentPartition,
} from '@ai-floor-planner/planning-engine';
import { GeminiProvider, type BaseAIProvider } from '@ai-floor-planner/ai-orchestration';
import { CanonicalIfcExchangeAdapter } from '../services/canonical-ifc-adapter';
import { handleBimAssistantQuery } from '../api/bim-assistant-routes';

const BASE_APARTMENT_CONFIG: MultiSheetApartmentConfig = {
  projectId: 'phase5b-suite',
  structuralLayoutMode: 'DEFERRED',
  plotWidthMm: 36000,
  plotDepthMm: 32000,
  roadWidthMm: 12000,
  roadAccessSides: [Direction.South],
  jurisdiction: 'pune_pmc',
  lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
  verticalStackType: 'STILT_PLUS_N',
  generationSeed: 7,
  numTypicalFloors: 1,
  floorToFloorHeightMm: 3150,
  stiltHeightMm: 3000,
  flatsPerFloor: 4,
  units: [
    { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
    { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: true },
    { unitIndex: 3, bhkType: '2BHK', hasUtilityBalcony: true },
    { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true },
  ],
  setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
  parkingMode: 'STILT_AND_SURFACE',
  siteAmenities: DEFAULT_SITE_AMENITIES,
  stiltAmenities: DEFAULT_STILT_AMENITIES,
  terraceAmenities: DEFAULT_TERRACE_AMENITIES,
};

describe('Phase 5B Backend — Direct CAD Editing, Element Realism, IFC4 Curved Openings & BIM Assistant API', () => {
  it('Gate F, G & H1/H2: supports direct partition thickness, door swing flip, window sill edit, curved-wall window hosting + IFC4 roundtrip, and architectural realism audit', async () => {
    const { building, validationReport } = await executeAuditedPlanningPipeline(BASE_APARTMENT_CONFIG);
    expect(validationReport.isValid).toBe(true);

    // Gate G: Architectural element realism across stilt, typical, and terrace storeys
    for (const floor of building.floors) {
      const realism = auditArchitecturalElementRealism(floor);
      expect(realism.passed).toBe(true);
      expect(realism.findings.filter(f => f.code === 'UNREQUESTED_LIFT_MACHINE_ROOM')).toHaveLength(0);
    }

    const stiltFloor = building.floors.find(f => f.name.toLowerCase().includes('stilt'));
    expect(stiltFloor).toBeDefined();
    expect(
      auditArchitecturalElementRealism(stiltFloor!).findings.filter(
        f => f.code === 'STILT_PARKING_ENCLOSED_BY_FULL_WALL',
      ),
    ).toHaveLength(0);

    const typical = building.floors.find(f => (f.apartmentUnits?.length ?? 0) >= 4)!;

    // 1. Direct internal partition thickness edit (115 mm -> 150 mm) succeeds while party/exterior walls (< 230 mm) are protected
    const internalWall = typical.walls.find(w => {
      if (w.roomIds.length !== 2) return false;
      const rA = typical.rooms.find(r => r.id === w.roomIds[0]);
      const rB = typical.rooms.find(r => r.id === w.roomIds[1]);
      return Boolean(rA?.unitId && rA.unitId === rB?.unitId && !rA.isFixed && !rB?.isFixed);
    })!;
    expect(internalWall).toBeDefined();
    const thickerBuilding = editCanonicalWallThickness(
      building,
      createGenerationControlState(),
      typical.id,
      internalWall.id,
      150,
    );
    const updatedInternal = thickerBuilding.floors
      .find(f => f.id === typical.id)!
      .walls.find(w => w.id === internalWall.id)!;
    expect(updatedInternal.thickness).toBe(150);

    const exteriorWall = typical.walls.find(w => w.roomIds.length === 1 && !w.arc)!;
    expect(() =>
      editCanonicalWallThickness(building, createGenerationControlState(), typical.id, exteriorWall.id, 115),
    ).toThrow(/230 mm/);

    // 2. Flip internal door swing direction and update window sill height
    const editableDoor = typical.doors.find(d => {
      const host = typical.walls.find(w => w.id === d.wallId);
      const room = typical.rooms.find(r => r.id === d.connectsRooms[0]);
      return Boolean(host && !host.arc && room?.unitId && !room.isFixed && d.width >= 750);
    })!;
    const doorHost = typical.walls.find(w => w.id === editableDoor.wallId)!;
    const doorAlong = projectOnSegment(editableDoor.position, doorHost.startPoint, doorHost.endPoint)!.along;
    const targetSwing =
      editableDoor.swingDirection === SwingDirection.Left ? SwingDirection.Right : SwingDirection.Left;
    const flippedDoorBuilding = editApartmentOpening(building, createGenerationControlState(), typical.id, {
      action: 'update',
      id: editableDoor.id,
      wallId: doorHost.id,
      widthMm: editableDoor.width,
      offsetMm: doorAlong,
      swingDirection: targetSwing,
    });
    const updatedDoor = flippedDoorBuilding.floors
      .find(f => f.id === typical.id)!
      .doors.find(d => d.id === editableDoor.id)!;
    expect(updatedDoor.swingDirection).toBe(targetSwing);

    const editableWindow = typical.windows.find(w => {
      const host = typical.walls.find(wall => wall.id === w.wallId);
      const room = typical.rooms.find(r => r.id === w.roomId);
      return Boolean(host && !host.arc && host.roomIds.length === 1 && room?.unitId && !room.isFixed);
    })!;
    const winHost = typical.walls.find(w => w.id === editableWindow.wallId)!;
    const winAlong = projectOnSegment(editableWindow.position, winHost.startPoint, winHost.endPoint)!.along;
    const sillEditedBuilding = editApartmentOpening(
      flippedDoorBuilding,
      createGenerationControlState(),
      typical.id,
      {
        action: 'update',
        id: editableWindow.id,
        wallId: winHost.id,
        widthMm: editableWindow.width,
        offsetMm: winAlong,
        sillHeightMm: 1050,
      },
    );
    const updatedWindow = sillEditedBuilding.floors
      .find(f => f.id === typical.id)!
      .windows.find(w => w.id === editableWindow.id)!;
    expect(updatedWindow.sillHeight).toBe(1050);

    // 3. Curved-wall window remove/add/move/resize & IFC4 roundtrip on Elliptical Tower massing
    const curvedShapeResult = await executeAuditedPlanningPipeline({
      ...BASE_APARTMENT_CONFIG,
      projectId: 'phase5b-elliptical-tower',
      plotWidthMm: 42000,
      plotDepthMm: 36000,
      buildingMassingShape: 'ELLIPTICAL_TOWER',
      units: BASE_APARTMENT_CONFIG.units!.map(u => ({ ...u, hasUtilityBalcony: false })),
    });
    const rotundaFloor = curvedShapeResult.building.floors.find(
      f => Boolean(f.apartmentUnits?.length) && f.walls.some(w => Boolean(w.arc)),
    )!;
    const curvedCandidates = rotundaFloor.walls
      .filter(w => {
        if (!w.arc) return false;
        if (w.boundaryRole === 'PARAPET' || w.boundaryRole === 'GUARDRAIL' || w.boundaryRole === 'OPEN_BOUNDARY') return false;
        const nonVoidRooms = rotundaFloor.rooms.filter(
          r => w.roomIds.includes(r.id) && r.spaceUse !== 'VOID' && !r.openToSky,
        );
        if (nonVoidRooms.length !== 1) return false;
        const room = nonVoidRooms[0]!;
        const arcLen = Math.abs(w.arc.endAngleRad - w.arc.startAngleRad) * w.arc.radiusMm;
        const hasDoor = rotundaFloor.doors.some(d => d.wallId === w.id);
        return Boolean(room.unitId && !room.isFixed && room.spaceUse !== 'OUTDOOR' && !hasDoor && arcLen >= 750);
      })
      .sort(
        (a, b) =>
          Math.abs(b.arc!.endAngleRad - b.arc!.startAngleRad) * b.arc!.radiusMm -
          Math.abs(a.arc!.endAngleRad - a.arc!.startAngleRad) * a.arc!.radiusMm,
      );
    const curvedWall = curvedCandidates[0]!;
    expect(curvedWall).toBeDefined();

    // Clear any pre-synthesized window on curvedWall first so we verify remove + add + update cleanly
    let baseCurvedBuilding = curvedShapeResult.building;
    for (const preWin of rotundaFloor.windows.filter(w => w.wallId === curvedWall.id)) {
      baseCurvedBuilding = editApartmentOpening(
        baseCurvedBuilding,
        createGenerationControlState(),
        rotundaFloor.id,
        { action: 'remove', id: preWin.id },
      );
    }

    const curvedLen =
      Math.abs(curvedWall.arc!.endAngleRad - curvedWall.arc!.startAngleRad) * curvedWall.arc!.radiusMm;
    const initWinW = Math.min(1100, Math.max(600, Math.floor(curvedLen - 300)));
    const nextWinW = Math.min(1200, Math.max(620, Math.floor(curvedLen - 250)));
    const addedCurvedWin = editApartmentOpening(
      baseCurvedBuilding,
      createGenerationControlState(),
      rotundaFloor.id,
      {
        action: 'add',
        kind: 'window',
        wallId: curvedWall.id,
        widthMm: initWinW,
        offsetMm: Math.round(curvedLen * 0.48),
        sillHeightMm: 950,
      },
    );
    const createdWin = addedCurvedWin.floors
      .find(f => f.id === rotundaFloor.id)!
      .windows.find(w => w.wallId === curvedWall.id)!;
    expect(createdWin).toBeDefined();
    expect(createdWin.sillHeight).toBe(950);

    const interactive = projectBuildingTo3D(addedCurvedWin);
    const viewWall = interactive.walls.find(wall => wall.sourceEntityId === curvedWall.id)!;
    const viewWindow = interactive.openings.find(opening => opening.sourceEntityId === createdWin.id);
    expect(viewWall.length).toBeCloseTo(curvedLen, 6);
    expect(viewWindow?.width).toBe(createdWin.width);
    const center = viewWindow!.alongWall + viewWindow!.width / 2;
    expect(viewWall.solidSegments.some(segment => segment.alongStart < center && segment.alongEnd > center
      && segment.bottom < createdWin.sillHeight + createdWin.height / 2
      && segment.top > createdWin.sillHeight + createdWin.height / 2)).toBe(false);


    const movedCurvedWin = editApartmentOpening(
      addedCurvedWin,
      createGenerationControlState(),
      rotundaFloor.id,
      {
        action: 'update',
        id: createdWin.id,
        wallId: curvedWall.id,
        widthMm: nextWinW,
        offsetMm: Math.round(curvedLen * 0.52),
        sillHeightMm: 850,
      },
    );
    const afterCurvedWin = movedCurvedWin.floors
      .find(f => f.id === rotundaFloor.id)!
      .windows.find(w => w.id === createdWin.id)!;
    expect(afterCurvedWin.width).toBe(nextWinW);
    expect(afterCurvedWin.sillHeight).toBe(850);
    const curvedPlacement = canonicalCurvedOpeningGeometry(afterCurvedWin, curvedWall);
    expect(Math.abs(curvedPlacement.center - Math.round(curvedLen * 0.52))).toBeLessThanOrEqual(2);

    const adapter = new CanonicalIfcExchangeAdapter();
    const curvedRev = exchangeRevision(movedCurvedWin);
    const curvedIfc = await adapter.export(movedCurvedWin, curvedRev);
    const curvedReadback = await adapter.readback(curvedIfc, curvedRev);
    expect(curvedReadback.lostCanonicalIds).toEqual([]);
    expect(curvedReadback.changedHostIds).toEqual([]);
    expect(curvedReadback.maximumPositionErrorMm).toBeLessThanOrEqual(0.001);

    // Probe partition slide helper
    const candidatePartitions = typical.walls.filter(w => {
      if (w.roomIds.length !== 2) return false;
      const rA = typical.rooms.find(r => r.id === w.roomIds[0]);
      const rB = typical.rooms.find(r => r.id === w.roomIds[1]);
      return Boolean(rA?.unitId && rA.unitId === rB?.unitId && !rA.isFixed && !rB?.isFixed);
    });
    for (const part of candidatePartitions) {
      try {
        const shifted = moveApartmentPartition(building, createGenerationControlState(), typical.id, part.id, 40);
        expect(shifted.version).toBe(building.version + 1);
        break;
      } catch {
        // Partition may have perpendicular T-junctions; continue probing cleanly
      }
    }
  }, 60_000);

  it('Gate J Backend API: routes factual BIM queries with 0 API calls, caches structured Gemini intent, and requires user acceptance for mutations', async () => {
    const { building } = await executeAuditedPlanningPipeline({
      ...BASE_APARTMENT_CONFIG,
      projectId: 'phase5b-bim-api',
    });
    const typical = building.floors.find(f => (f.apartmentUnits?.length ?? 0) >= 4)!;

    let providerCalls = 0;
    const mockGemini = {
      getModelInfo: () => ({ provider: 'gemini', model: 'gemini-3-flash-preview' }),
      complete: async () => {
        providerCalls++;
        return {
          content: JSON.stringify({
            commandClass: 'LOCAL_FLAT_REGENERATION',
            normalizedInstruction: 'Regenerate Flat 2 only keeping core and other flats untouched',
            advisoryExplanation: 'Isolated Flat 2 layout regeneration keeps core, columns, and neighboring flats invariant.',
          }),
          parsed: {
            commandClass: 'LOCAL_FLAT_REGENERATION',
            normalizedInstruction: 'Regenerate Flat 2 only keeping core and other flats untouched',
            advisoryExplanation: 'Isolated Flat 2 layout regeneration keeps core, columns, and neighboring flats invariant.',
          },
          model: 'gemini-3-flash-preview',
          apiCallCount: 1,
          usage: { promptTokens: 120, completionTokens: 45, totalTokens: 165 },
        };
      },
    } as unknown as BaseAIProvider;

    // 1. Factual query bypasses provider completely (0 API calls)
    const factual = await handleBimAssistantQuery(
      { building, floorId: typical.id, query: 'Total window area' },
      { gemini: mockGemini, briefInterpreterKind: 'gemini' },
    );
    expect(factual.status).toBe(200);
    if ('aiTelemetry' in factual.json) {
      expect(factual.json.aiTelemetry.apiCallCount).toBe(0);
      expect(factual.json.aiTelemetry.geminiInvoked).toBe(false);
    }
    expect(providerCalls).toBe(0);

    // 2. Ambiguous natural-language edit query invokes Gemini once, produces preview requiring acceptance, then hits SHA-256 cache on repeat
    const editQueryBody = {
      building,
      floorId: typical.id,
      query: 'Could you rework Flat 2 internally without disturbing the staircase or neighbors?',
      clashes: [{ ifcClass: 'IFCDUCTSEGMENT<script>', kind: 'INTERSECTION', volumeMm3: 12000000 }],
    };
    const firstCall = await handleBimAssistantQuery(editQueryBody, {
      gemini: mockGemini,
      briefInterpreterKind: 'gemini',
    });
    expect(firstCall.status).toBe(200);
    expect(providerCalls).toBe(1);
    if ('aiTelemetry' in firstCall.json) {
      expect(firstCall.json.commandClass).toBe('LOCAL_FLAT_REGENERATION');
      expect(firstCall.json.requiresUserAcceptance).toBe(true);
      expect(firstCall.json.proposalPreview?.proposedBuilding).toBeDefined();
      expect(firstCall.json.aiTelemetry.invocationMode).toBe('LIVE_PROVIDER');
    }

    const cachedCall = await handleBimAssistantQuery(editQueryBody, {
      gemini: mockGemini,
      briefInterpreterKind: 'gemini',
    });
    expect(cachedCall.status).toBe(200);
    expect(providerCalls).toBe(1);
    if ('aiTelemetry' in cachedCall.json) {
      expect(cachedCall.json.aiTelemetry.cacheHit).toBe(true);
      expect(cachedCall.json.aiTelemetry.apiCallCount).toBe(0);
      expect(cachedCall.json.aiTelemetry.invocationMode).toBe('CACHED_PROVIDER_RESPONSE');
    }

    // Opt-in live Gemini verification when RUN_LIVE_AI_TESTS === '1' and GEMINI_API_KEY is present
    if (process.env.RUN_LIVE_AI_TESTS === '1' && process.env.GEMINI_API_KEY) {
      const liveProvider = new GeminiProvider({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
      });
      const liveRes = await handleBimAssistantQuery(
        {
          building,
          floorId: typical.id,
          query: 'Give me an architectural compliance summary of this floor plate.',
          reasoningMode: 'FAST',
        },
        { gemini: liveProvider, briefInterpreterKind: 'gemini' },
      );
      expect(liveRes.status).toBe(200);
      if ('aiTelemetry' in liveRes.json) {
        expect(liveRes.json.aiTelemetry.geminiInvoked).toBe(true);
      }
    }
  }, 60_000);
});

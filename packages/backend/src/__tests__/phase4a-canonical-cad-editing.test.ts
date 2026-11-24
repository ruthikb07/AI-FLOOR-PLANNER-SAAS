import { describe, expect, it } from 'vitest';
import {
  CanonicalDxfExchangeAdapter,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  EditorEngine,
  ReplaceBuildingCommand,
  createGenerationControlState,
  exchangeRevision,
  projectBuildingToCanonicalCad,
  stableValueHash,
  updateGenerationControl,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import {
  buildingRefinementRevision,
  executeAuditedPlanningPipeline,
  proposeControlledCadEdit,
} from '@ai-floor-planner/planning-engine';
import { exportBuildingToGlb, projectBuildingScene } from '@ai-floor-planner/projection-3d';
import { handleCadEditProposal } from '../api/cad-edit-routes.js';
import { CadExportService } from '../services/cad-export-service.js';

describe('Phase 4A Gate E — Controlled Canonical CAD Writeback & AI-Assisted CAD Editing', () => {
  const baseConfig: MultiSheetApartmentConfig = {
    projectId: 'phase4a-controlled-cad-edit',
    structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
    plotWidthMm: 32000,
    plotDepthMm: 36000,
    roadWidthMm: 12000,
    roadAccessSides: [Direction.South],
    jurisdiction: 'pune_pmc',
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    verticalStackType: 'STILT_PLUS_N',
    numTypicalFloors: 2,
    floorToFloorHeightMm: 3150,
    stiltHeightMm: 3150,
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

  it('validates all 5 architectural AI-CAD edit instruction classes while protecting unrelated flats and floors', async () => {
    const { building: baseBuilding } = await executeAuditedPlanningPipeline(baseConfig);
    const typicalFloor = baseBuilding.floors.find(f => Boolean(f.apartmentUnits?.length))!;
    const control = createGenerationControlState();

    // 1. Resize window to 1500 mm
    const winTarget =
      typicalFloor.windows.find(w => {
        const host = typicalFloor.walls.find(wl => wl.id === w.wallId);
        if (!host || host.arc) return false;
        const hostRooms = typicalFloor.rooms.filter(r => host.roomIds.includes(r.id));
        if (hostRooms.some(r => r.isFixed || r.type === 'staircase' || r.type === 'lift')) return false;
        return (
          Math.hypot(host.endPoint.x - host.startPoint.x, host.endPoint.y - host.startPoint.y) >= 2100 &&
          w.width !== 1500
        );
      }) ?? typicalFloor.windows[0]!;
    const resizeWinResp = await handleCadEditProposal(
      {
        building: baseBuilding,
        floorId: typicalFloor.id,
        expectedRevision: baseBuilding.version,
        control,
        selectedEntityId: winTarget.id,
        instruction: 'Resize this window to 1500 mm',
      },
      { gemini: null, briefInterpreterKind: 'gemini' },
    );
    expect(resizeWinResp.status).toBe(200);
    if (!('proposal' in resizeWinResp.json)) throw new Error('Expected proposal payload');
    expect(resizeWinResp.json.aiTelemetry.interpretationSource).toBe('DETERMINISTIC');
    expect(resizeWinResp.json.proposal.status).toBe('PREVIEW_READY');
    expect(resizeWinResp.json.proposal.openingSummary?.afterWidthMm).toBe(1500);
    expect(resizeWinResp.json.proposal.validation.closureValid).toBe(true);
    expect(resizeWinResp.json.proposal.validation.unaffectedFlatsUnchanged).toBe(true);
    expect(resizeWinResp.json.proposal.validation.unaffectedFloorsUnchanged).toBe(true);

    // 2. Move bedroom door towards the corner
    const moveDoorProposal = proposeControlledCadEdit({
      building: baseBuilding,
      floorId: typicalFloor.id,
      expectedRevision: baseBuilding.version,
      control,
      instruction: 'Move this bedroom door towards the corner',
    });
    expect(moveDoorProposal.status).toBe('PREVIEW_READY');
    expect(moveDoorProposal.openingSummary?.kind).toBe('door');
    expect(
      Math.hypot(
        moveDoorProposal.openingSummary!.afterPosition.x - moveDoorProposal.openingSummary!.beforePosition.x,
        moveDoorProposal.openingSummary!.afterPosition.y - moveDoorProposal.openingSummary!.beforePosition.y,
      ),
    ).toBeGreaterThan(10);
    expect(moveDoorProposal.validation.unaffectedFlatsUnchanged).toBe(true);

    // 3. Increase master bedroom carpet area
    const resizeRoomProposal = proposeControlledCadEdit({
      building: baseBuilding,
      floorId: typicalFloor.id,
      expectedRevision: baseBuilding.version,
      control,
      instruction: 'Increase the master bedroom carpet area',
    });
    expect(resizeRoomProposal.status).toBe('PREVIEW_READY');
    expect(resizeRoomProposal.roomAreaDeltas.length).toBeGreaterThan(0);
    expect(resizeRoomProposal.roomAreaDeltas.some(d => d.deltaSqM > 0)).toBe(true);
    expect(resizeRoomProposal.validation.closureValid).toBe(true);
    expect(resizeRoomProposal.validation.unaffectedFlatsUnchanged).toBe(true);

    // 4. Reduce passage width / shift internal partition safely
    const passageProposal = proposeControlledCadEdit({
      building: baseBuilding,
      floorId: typicalFloor.id,
      expectedRevision: baseBuilding.version,
      control,
      instruction: 'Reduce the passage width without compromising circulation',
    });
    expect(passageProposal.status).toBe('PREVIEW_READY');
    expect(passageProposal.validation.geometryValid).toBe(true);
    expect(passageProposal.validation.closureValid).toBe(true);
    expect(passageProposal.validation.unaffectedFlatsUnchanged).toBe(true);

    // 5. Explicit refusal for localized free-form single-flat topological regeneration ("Regenerate only Flat 2...")
    const flat2Refusal = proposeControlledCadEdit({
      building: baseBuilding,
      floorId: typicalFloor.id,
      expectedRevision: baseBuilding.version,
      control,
      instruction: 'Regenerate only Flat 2 while keeping the remaining flats unchanged',
    });
    expect(flat2Refusal.status).toBe('REFUSED_UNSUPPORTED');
    expect(flat2Refusal.proposedBuilding).toBeNull();
    expect(flat2Refusal.message).toMatch(/Flat 2/);
    expect(flat2Refusal.validation.unaffectedFlatsUnchanged).toBe(true);
  }, 60_000);

  it('enforces stale revision rejection, locked room/floor guardrails, Undo/Redo, and 2D/3D/DXF/GLB sync after canonical edit', async () => {
    const { building: baseBuilding } = await executeAuditedPlanningPipeline(baseConfig);
    const typicalFloor = baseBuilding.floors.find(f => Boolean(f.apartmentUnits?.length))!;
    const control = createGenerationControlState();

    // Stale revision check
    const stale = proposeControlledCadEdit({
      building: baseBuilding,
      floorId: typicalFloor.id,
      expectedRevision: baseBuilding.version + 99,
      control,
      instruction: 'Resize this window to 1500 mm',
    });
    expect(stale.status).toBe('REFUSED_STALE_REVISION');
    expect(stale.proposedBuilding).toBeNull();

    // Locked floor check
    const lockedFloorControl = updateGenerationControl(control, {
      lockedFloorIds: [typicalFloor.id],
    });
    const lockedRes = proposeControlledCadEdit({
      building: baseBuilding,
      floorId: typicalFloor.id,
      expectedRevision: baseBuilding.version,
      control: lockedFloorControl,
      instruction: 'Increase the master bedroom carpet area',
    });
    expect(lockedRes.status).toBe('REFUSED_LOCKED');

    // Accept canonical edit through EditorEngine and verify Undo/Redo + 2D/3D/DXF/GLB sync
    const engine = new EditorEngine(baseBuilding);
    const beforeHash = stableValueHash(engine.getBuilding());
    const proposal = proposeControlledCadEdit({
      building: engine.getBuilding(),
      floorId: typicalFloor.id,
      expectedRevision: engine.getBuilding().version,
      control,
      instruction: 'Increase the master bedroom carpet area',
    });
    expect(proposal.status).toBe('PREVIEW_READY');
    expect(proposal.baseRevisionDigest).toBe(buildingRefinementRevision(engine.getBuilding(), control));

    engine.execute(
      new ReplaceBuildingCommand(
        engine.getBuilding(),
        proposal.proposedBuilding!,
        proposal.message,
        true,
      ),
    );
    const edited = engine.getBuilding();
    expect(edited.version).toBe(baseBuilding.version + 1);
    expect(stableValueHash(edited)).not.toBe(beforeHash);

    // 2D Canonical CAD Adapter sync
    const cadDoc = projectBuildingToCanonicalCad(edited, { floorId: typicalFloor.id });
    expect(cadDoc.expectedRevision).toBe(edited.version);
    const dxfAdapter = new CanonicalDxfExchangeAdapter();
    const rev = exchangeRevision(edited);
    const dxfArtifact = await dxfAdapter.export(edited, rev);
    const dxfReadback = await dxfAdapter.readback(dxfArtifact, rev, edited);
    expect(dxfReadback.lostCanonicalIds).toEqual([]);
    expect(dxfReadback.changedHostIds).toEqual([]);

    // Production CAD DXF export + 3D Scene + GLB export sync
    const cadExporter = new CadExportService();
    const prodDxf = cadExporter.exportCad(edited, 'dxf', { floorId: typicalFloor.id, includeStructural: false });
    expect(prodDxf.validation.isValid).toBe(true);

    const scene3d = projectBuildingScene(edited);
    expect(scene3d.meshes.length).toBeGreaterThan(20);
    const glbBytes = await exportBuildingToGlb(edited);
    expect(Buffer.from(glbBytes.subarray(0, 4)).toString('ascii')).toBe('glTF');

    // Undo restores exact prior canonical hash; Redo re-applies exact edited hash
    const editedHash = stableValueHash(edited);
    engine.undo();
    expect(stableValueHash(engine.getBuilding())).toBe(beforeHash);
    engine.redo();
    expect(stableValueHash(engine.getBuilding())).toBe(editedHash);
  }, 60_000);
});

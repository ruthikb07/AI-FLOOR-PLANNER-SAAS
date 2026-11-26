// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { SwingDirection, createGenerationControlState, type Building } from '@ai-floor-planner/core';
import { projectOnSegment } from '@ai-floor-planner/geometry-engine';
import { editApartmentOpening } from '@ai-floor-planner/planning-engine';
import { projectBuildingTo3D } from '@ai-floor-planner/projection-3d';
import { readIfcReference } from '../services/ifc-reference';
import { loadProjectBimFederation, saveProjectBimFederation } from '../services/ifc-reference-store';
import { findBimClashes } from '../services/bim-clash';
import { calculateBimSchedule } from '../services/bim-quantities';
import { queryBimSchedule } from '../services/bim-query';

const fixture = JSON.parse(
  await readFile(
    new URL('../../../../test-artifacts/phase1-generated/four-flat-production-building.json', import.meta.url),
    'utf8',
  ),
) as Building;

describe('Phase 5B Frontend — Advanced IFC4 Reference Reader, Persistence, 3D Clash & Deterministic BIM Assistant', () => {
  it('Gate H3 & H4: parses IfcCircleProfileDef, IfcArbitraryProfileDefWithVoids, IfcFacetedBrep, and IfcTriangulatedFaceSet and isolates federation by projectId', async () => {
    const advancedIfc = [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
      "FILE_NAME('mep-struct-ref.ifc','2026-11-25T10:00:00',('Engineer'),('Firm'),'Test','Test','');",
      "FILE_SCHEMA(('IFC4'));",
      'ENDSEC;',
      'DATA;',
      '#1=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);',
      '#2=IFCUNITASSIGNMENT((#1));',
      "#3=IFCPROJECT('0000000000000000000001',$,'RefProject',$,$,$,$,$,#2);",
      '#10=IFCCARTESIANPOINT((0.,0.,0.));',
      '#11=IFCDIRECTION((0.,0.,1.));',
      '#12=IFCDIRECTION((1.,0.,0.));',
      '#13=IFCAXIS2PLACEMENT3D(#10,#11,#12);',
      '#14=IFCLOCALPLACEMENT($,#13);',
      // 1. Circular pipe column / vertical riser via IFCCIRCLEPROFILEDEF
      '#20=IFCCARTESIANPOINT((5000.,-5000.));',
      '#21=IFCAXIS2PLACEMENT2D(#20,$);',
      '#22=IFCCIRCLEPROFILEDEF(.AREA.,$,#21,250.);',
      '#23=IFCEXTRUDEDAREASOLID(#22,#13,#11,2400.);',
      "#24=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#23));",
      '#25=IFCPRODUCTDEFINITIONSHAPE($,$,(#24));',
      "#26=IFCPIPESEGMENT('0000000000000000000002',$,'Riser <script>alert(1)</script>',$,$,#14,#25,$,$);",
      // 2. Slab with opening cutout via IFCARBITRARYPROFILEDEFWITHVOIDS
      '#30=IFCCARTESIANPOINT((1000.,-1000.));',
      '#31=IFCCARTESIANPOINT((4000.,-1000.));',
      '#32=IFCCARTESIANPOINT((4000.,-4000.));',
      '#33=IFCCARTESIANPOINT((1000.,-4000.));',
      '#34=IFCPOLYLINE((#30,#31,#32,#33,#30));',
      '#35=IFCCARTESIANPOINT((2000.,-2000.));',
      '#36=IFCCARTESIANPOINT((3000.,-2000.));',
      '#37=IFCCARTESIANPOINT((3000.,-3000.));',
      '#38=IFCCARTESIANPOINT((2000.,-3000.));',
      '#39=IFCPOLYLINE((#35,#36,#37,#38,#35));',
      '#40=IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,#34,(#39));',
      '#41=IFCEXTRUDEDAREASOLID(#40,#13,#11,200.);',
      "#42=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#41));",
      '#43=IFCPRODUCTDEFINITIONSHAPE($,$,(#42));',
      "#44=IFCSLAB('0000000000000000000003',$,'Ref Slab With Void',$,$,#14,#43,$,.FLOOR.);",
      // 3. Faceted Brep equipment box via IFCFACETEDBREP
      '#50=IFCCARTESIANPOINT((6000.,-2000.,900.));',
      '#51=IFCCARTESIANPOINT((7200.,-2000.,900.));',
      '#52=IFCCARTESIANPOINT((7200.,-3000.,900.));',
      '#53=IFCCARTESIANPOINT((6000.,-3000.,900.));',
      '#54=IFCCARTESIANPOINT((6000.,-2000.,1500.));',
      '#55=IFCCARTESIANPOINT((7200.,-2000.,1500.));',
      '#56=IFCCARTESIANPOINT((7200.,-3000.,1500.));',
      '#57=IFCCARTESIANPOINT((6000.,-3000.,1500.));',
      '#58=IFCPOLYLOOP((#50,#51,#52,#53));',
      '#59=IFCFACEOUTERBOUND(#58,.T.);',
      '#60=IFCFACE((#59));',
      '#61=IFCPOLYLOOP((#54,#55,#56,#57));',
      '#62=IFCFACEOUTERBOUND(#61,.T.);',
      '#63=IFCFACE((#62));',
      '#64=IFCCLOSEDSHELL((#60,#63));',
      '#65=IFCFACETEDBREP(#64);',
      "#66=IFCSHAPEREPRESENTATION($,'Body','Brep',(#65));",
      '#67=IFCPRODUCTDEFINITIONSHAPE($,$,(#66));',
      "#68=IFCDUCTSEGMENT('0000000000000000000004',$,'Supply Duct Brep',$,$,#14,#67,$,$);",
      // 4. Tessellated TriangulatedFaceSet via IFCTRIANGULATEDFACESET
      '#70=IFCCARTESIANPOINTLIST3D(((8000.,-2000.,1800.),(9000.,-2000.,1800.),(9000.,-2800.,1800.),(8000.,-2800.,1800.),(8000.,-2000.,2300.),(9000.,-2800.,2300.)));',
      '#71=IFCTRIANGULATEDFACESET(#70,$,.T.,((1,2,3),(1,3,4),(1,2,5),(3,4,6)),$);',
      "#72=IFCSHAPEREPRESENTATION($,'Body','Tessellation',(#71));",
      '#73=IFCPRODUCTDEFINITIONSHAPE($,$,(#72));',
      "#74=IFCCABLECARRIERSEGMENT('0000000000000000000005',$,'Cable Tray Tessellated',$,$,#14,#73,$,$);",
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\n');

    const refModel = readIfcReference(new TextEncoder().encode(advancedIfc));
    expect(Object.keys(refModel.unsupported)).toHaveLength(0);
    expect(refModel.elements).toHaveLength(4);
    const slabWithVoid = refModel.elements.find(e => e.ifcClass === 'IFCSLAB')!;
    expect(slabWithVoid.prisms[0]?.holes?.length).toBe(1);
    const pipeEntity = refModel.elements.find(e => e.ifcClass === 'IFCPIPESEGMENT')!;
    expect(pipeEntity.prisms[0]?.boundary.length).toBeGreaterThanOrEqual(16);

    await saveProjectBimFederation({
      projectId: 'proj-alpha',
      activeReferenceSha256: refModel.sha256,
      references: [
        {
          fileName: 'mep-struct-ref.ifc',
          discipline: 'MEP',
          alignment: { x: 100, y: 0, z: 0, angle: 0 },
          model: refModel,
        },
      ],
      clashResolutions: { 'clash-001': 'RESOLVED', 'clash-002': 'IGNORED' },
      updatedAt: new Date().toISOString(),
    });

    const loadedAlpha = await loadProjectBimFederation('proj-alpha');
    expect(loadedAlpha?.references).toHaveLength(1);
    expect(loadedAlpha?.references[0]?.discipline).toBe('MEP');
    expect(loadedAlpha?.clashResolutions['clash-001']).toBe('RESOLVED');
    expect(await loadProjectBimFederation('proj-beta')).toBeNull();
  });

  it('Gate I & J: runs 3D clash + minimum clearance + resolution tracking and executes all 9 deterministic BIM command classes with 0 API calls', () => {
    const floor = fixture.floors.find(candidate => candidate.floorUse === 'RESIDENTIAL')!;
    const projection = projectBuildingTo3D(fixture);
    const walls = projection.walls.filter(item => item.floorId === floor.id);
    const plate = projection.floorPlates.find(item => item.floorId === floor.id);

    const targetWall = floor.walls.find(w => !w.arc && w.roomIds.length >= 1)!;
    const view = walls.find(w => w.sourceEntityId === targetWall.id)!;
    const midX = (targetWall.startPoint.x + targetWall.endPoint.x) / 2;
    const midY = (targetWall.startPoint.y + targetWall.endPoint.y) / 2;

    // Reference coordinates in IFC right-handed XY (where alignedPlanPrism maps y -> -y)
    const hardDuct = {
      globalId: 'DUCT_HARD_CLASH',
      ifcClass: 'IFCDUCTSEGMENT',
      name: 'HVAC Main Duct <script>bad()</script>',
      boundary: [
        { x: midX - 250, y: -(midY - 250) },
        { x: midX + 250, y: -(midY - 250) },
        { x: midX + 250, y: -(midY + 250) },
        { x: midX - 250, y: -(midY + 250) },
      ],
      bottomMm: view.elevation + 2150,
      topMm: view.elevation + 2450,
    };

    const nearPipe = {
      globalId: 'PIPE_CLEARANCE_WARN',
      ifcClass: 'IFCPIPESEGMENT',
      name: 'Chilled Water Pipe',
      boundary: [
        { x: targetWall.startPoint.x + 20, y: -(targetWall.startPoint.y + targetWall.thickness / 2 + 40) },
        { x: targetWall.startPoint.x + 120, y: -(targetWall.startPoint.y + targetWall.thickness / 2 + 40) },
        { x: targetWall.startPoint.x + 120, y: -(targetWall.startPoint.y + targetWall.thickness / 2 + 100) },
        { x: targetWall.startPoint.x + 20, y: -(targetWall.startPoint.y + targetWall.thickness / 2 + 100) },
      ],
      bottomMm: view.elevation + 2150,
      topMm: view.elevation + 2300,
    };

    const clashRun = findBimClashes({
      floor,
      walls,
      plate,
      reference: [hardDuct, nearPipe],
      alignment: { x: 0, y: 0, z: 0, angle: 0 },
      referenceSha256: 'ref-sha',
      revisionSha256: 'rev-sha',
      toleranceMm: 0.5,
      minClearanceMm: 150,
      includeSlabsAndStructure: true,
      resolutions: {},
    });
    expect(clashRun.results.some(c => c.referenceGlobalId === 'DUCT_HARD_CLASH' && c.kind === 'INTERSECTION')).toBe(true);
    expect(clashRun.results.every(c => c.status === 'OPEN')).toBe(true);

    const firstId = clashRun.results[0]!.id;
    const resolvedRun = findBimClashes({
      floor,
      walls,
      plate,
      reference: [hardDuct, nearPipe],
      alignment: { x: 0, y: 0, z: 0, angle: 0 },
      referenceSha256: 'ref-sha',
      revisionSha256: 'rev-sha',
      toleranceMm: 0.5,
      minClearanceMm: 150,
      includeSlabsAndStructure: true,
      resolutions: { [firstId]: 'RESOLVED' },
    });
    expect(resolvedRun.results.find(c => c.id === firstId)?.status).toBe('RESOLVED');

    // Gate J: All 9 command classes in queryBimSchedule with 0 provider calls
    const schedule = calculateBimSchedule(floor, walls, plate);
    const ctx = { building: fixture, floor, clashes: clashRun.results };

    // 1. LIST_ELEMENTS
    const c1 = queryBimSchedule('Show all doors', schedule.rows, ctx);
    expect(c1.apiCallCount).toBe(0);
    expect(c1.matches).toHaveLength(floor.doors.length);

    // 2. CALCULATE_QUANTITY
    const c2 = queryBimSchedule('Total window area', schedule.rows, ctx);
    expect(c2.apiCallCount).toBe(0);
    expect(c2.text).toMatch(/m² of window openings/);

    // 3. BELOW_TARGET_ROOMS
    const c3 = queryBimSchedule('Highlight rooms below target area', schedule.rows, ctx);
    expect(c3.apiCallCount).toBe(0);
    expect(c3.commandClass).toBe('BELOW_TARGET_ROOMS');

    // 4. CLASH_RESOLUTION
    const c4 = queryBimSchedule('Identify clashes <script>bad()</script>', schedule.rows, ctx);
    expect(c4.apiCallCount).toBe(0);
    expect(c4.commandClass).toBe('CLASH_RESOLUTION');
    expect(c4.text).not.toContain('<script>');

    // 5. LOCAL_FLAT_REGENERATION (preview only — never mutates fixture!)
    const c5 = queryBimSchedule('Regenerate Flat 2 only keeping stairs and Flat 1 untouched', schedule.rows, ctx);
    expect(c5.apiCallCount).toBe(0);
    expect(c5.commandClass).toBe('LOCAL_FLAT_REGENERATION');
    expect(c5.mode).toBe('PROPOSAL_PREVIEW');
    expect(c5.proposalPreview?.proposedBuilding).toBeDefined();

    // 6. MOVE_DOOR_CLEARANCE
    const door = floor.doors.find(d => floor.walls.some(w => w.id === d.wallId && !w.arc))!;
    const c6 = queryBimSchedule(`Move door ${door.id} by 50 mm`, schedule.rows, ctx);
    expect(c6.apiCallCount).toBe(0);
    expect(c6.commandClass).toBe('MOVE_DOOR_CLEARANCE');

    // 7. RESIZE_ROOM_TARGET
    const c7 = queryBimSchedule('Increase Master Bedroom to 165 sq ft', schedule.rows, ctx);
    expect(c7.apiCallCount).toBe(0);
    expect(c7.commandClass).toBe('RESIZE_ROOM_TARGET');

    // 8. COMPLIANCE_EXPLANATION
    const c8 = queryBimSchedule('Explain compliance findings', schedule.rows, ctx);
    expect(c8.apiCallCount).toBe(0);
    expect(c8.commandClass).toBe('COMPLIANCE_EXPLANATION');

    // 9. REVISION_DIFF
    const dHost = floor.walls.find(w => w.id === door.wallId)!;
    const nextBuilding = editApartmentOpening(fixture, createGenerationControlState(), floor.id, {
      action: 'update',
      id: door.id,
      wallId: dHost.id,
      widthMm: door.width,
      offsetMm: projectOnSegment(door.position, dHost.startPoint, dHost.endPoint)!.along,
      swingDirection: door.swingDirection === SwingDirection.Left ? SwingDirection.Right : SwingDirection.Left,
    });
    const c9 = queryBimSchedule('Compare changes with previous revision', schedule.rows, {
      building: nextBuilding,
      previousBuilding: fixture,
      floor,
    });
    expect(c9.apiCallCount).toBe(0);
    expect(c9.commandClass).toBe('REVISION_DIFF');
    expect(c9.text).toMatch(/Revision diff/);

    const missingFlat = queryBimSchedule('Show all doors in Flat 99', schedule.rows, ctx);
    expect(missingFlat.matches).toEqual([]);
    expect(missingFlat.text).toMatch(/Flat 99.*not found/i);

    expect(queryBimSchedule('Upload the model elsewhere', schedule.rows, ctx).mode).toBe('UNSUPPORTED');
  });
});

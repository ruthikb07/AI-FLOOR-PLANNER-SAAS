import { describe, expect, it } from 'vitest';
import {
  ColumnShape,
  DaylightLevel,
  Direction,
  DoorType,
  PlotShape,
  PrivacyLevel,
  RoomType,
  SwingDirection,
  WallType,
  WindowType,
  type Building,
} from '@ai-floor-planner/core';
import {
  canonicalToOpenBimWorld,
  compileFormula,
  mountOpenBimStudio,
  openBimWorldToCanonical,
  validateFormula,
} from '../index';

function createSampleBimBuilding(): Building {
  const boundary = {
    points: [
      { x: 0, y: 0 },
      { x: 9000, y: 0 },
      { x: 9000, y: 7000 },
      { x: 0, y: 7000 },
    ],
  };
  return {
    id: 'bldg-bim-01',
    projectId: 'proj-bim-01',
    name: 'OpenBIM Residence',
    version: 5,
    createdAt: '2026-11-26T00:00:00.000Z',
    updatedAt: '2026-11-26T00:00:00.000Z',
    metadata: { projectId: 'proj-bim-01' },
    site: {
      id: 'site-bim-01',
      plotBoundary: boundary,
      plotWidth: 9000,
      plotDepth: 7000,
      plotArea: 63_000_000,
      plotShape: PlotShape.Rectangular,
      orientation: 0,
      setbacks: { front: 1500, rear: 1500, left: 1500, right: 1500 },
      accessPoints: [],
      roadFacing: Direction.North,
    },
    floors: [
      {
        id: 'floor-g',
        buildingId: 'bldg-bim-01',
        level: 0,
        name: 'Ground Floor',
        floorHeight: 3000,
        slabThicknessMm: 150,
        boundary,
        rooms: [
          {
            id: 'r-1',
            floorId: 'floor-g',
            type: RoomType.Living,
            name: 'Living Room',
            boundary,
            x: 0,
            y: 0,
            width: 9000,
            height: 7000,
            rotation: 0,
            area: 63_000_000,
            priority: 1,
            tags: [],
            adjacencyRequirements: [],
            daylightRequirement: DaylightLevel.High,
            privacyRequirement: PrivacyLevel.Low,
            ventilationRequired: true,
            isFixed: false,
          },
        ],
        walls: [
          {
            id: 'w-ext-n',
            floorId: 'floor-g',
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 9000, y: 0 },
            thickness: 230,
            heightMm: 3000,
            type: WallType.External,
            wallUse: 'EXTERNAL',
            roomIds: ['r-1'],
            hasOpening: true,
            loadBearing: true,
          },
          {
            id: 'w-ext-e',
            floorId: 'floor-g',
            startPoint: { x: 9000, y: 0 },
            endPoint: { x: 9000, y: 7000 },
            thickness: 230,
            heightMm: 3000,
            type: WallType.External,
            wallUse: 'EXTERNAL',
            roomIds: ['r-1'],
            hasOpening: true,
            loadBearing: true,
          },
          {
            id: 'w-ext-s',
            floorId: 'floor-g',
            startPoint: { x: 9000, y: 7000 },
            endPoint: { x: 0, y: 7000 },
            thickness: 230,
            heightMm: 3000,
            type: WallType.External,
            wallUse: 'EXTERNAL',
            roomIds: ['r-1'],
            hasOpening: false,
            loadBearing: true,
          },
          {
            id: 'w-ext-w',
            floorId: 'floor-g',
            startPoint: { x: 0, y: 7000 },
            endPoint: { x: 0, y: 0 },
            thickness: 230,
            heightMm: 3000,
            type: WallType.External,
            wallUse: 'EXTERNAL',
            roomIds: ['r-1'],
            hasOpening: false,
            loadBearing: true,
          },
        ],
        doors: [
          {
            id: 'd-main',
            floorId: 'floor-g',
            wallId: 'w-ext-n',
            position: { x: 2500, y: 0 },
            width: 1050,
            height: 2100,
            type: DoorType.Single,
            swingDirection: SwingDirection.Inward,
            connectsRooms: ['exterior', 'r-1'],
          },
        ],
        windows: [
          {
            id: 'win-e',
            floorId: 'floor-g',
            wallId: 'w-ext-e',
            position: { x: 9000, y: 3500 },
            width: 1500,
            height: 1200,
            sillHeight: 900,
            type: WindowType.Sliding,
            roomId: 'r-1',
          },
        ],
        stairs: [],
        columns: [
          { id: 'col-nw', floorId: 'floor-g', position: { x: 0, y: 0 }, width: 300, depth: 450, shape: ColumnShape.Rectangular, isStructural: true },
        ],
        beams: [],
      },
    ],
  };
}

describe('@ai-floor-planner/openbim-integration — OpenBIM Engine & Canonical Bridge', () => {
  it('applies exact single-step coordinate transform between Canonical mm and OpenBIM Y-up metres', () => {
    const world = canonicalToOpenBimWorld(9000, 7000, 3000);
    expect(world).toEqual({ x: 9, y: 3, z: -7 });
    const back = openBimWorldToCanonical(world);
    expect(back).toEqual({ x: 9000, y: 7000, z: 3000 });
  });

  it('audits IDS 1.0 specifications, evaluates AST formulas & 5D QTO rules, and exports COBie 2.4 (.xls & .zip)', () => {
    const building = createSampleBimBuilding();
    const bim = mountOpenBimStudio({
      projectId: building.projectId,
      buildingId: building.id,
      revision: building.version,
      building,
    });

    const idsReport = bim.runIdsAudit();
    expect(idsReport.passRatePct).toBe(100);
    expect(idsReport.failedSpecifications).toBe(0);

    // Classification assignment & custom property
    bim.assignClassification('w-ext-n', 'omniclass-21', '21-02 10 20');
    bim.setCustomProperty('d-main', 'FireRating', 'FD60');

    // Formula engine check
    expect(validateFormula('ROUND([Area] * 1.08, 2)')).toEqual({ ok: true });
    const fn = compileFormula('ROUND([Area] * 1.08, 2)');
    expect(fn({ values: { Area: 100 } })).toBe(108);

    // 5D QTO evaluation
    const qto = bim.runQtoEvaluation();
    expect(qto.results.length).toBeGreaterThanOrEqual(4);
    expect(qto.costTotal).toBeGreaterThan(50_000);

    // COBie 2.4 export
    const cobieXls = bim.exportCobie('xls');
    expect(new TextDecoder().decode(cobieXls)).toContain('Facility');
    const cobieZip = bim.exportCobie('zip');
    expect(cobieZip[0]).toBe(0x50); // PK zip magic
    expect(cobieZip[1]).toBe(0x4b);

    bim.unmount();
  });

  it('runs 3D BVH/GJK clash detection, round-trips BCF 2.1 .bcfzip archives, inspects IFC4/IFC4X3 STEP, and validates canonical BIM edits', async () => {
    const building = createSampleBimBuilding();
    const bim = mountOpenBimStudio({
      projectId: building.projectId,
      buildingId: building.id,
      revision: building.version,
      building,
    });

    // Intersecting federated MEP duct through north exterior wall (x=4500, y=-200..+200, z=2200..2600)
    const clashes = await bim.run3DClashDetection(
      [
        {
          modelId: 'mep-hvac-ref',
          globalId: '2O2Fr$t4X7Zf8NOew3FLOH',
          ifcClass: 'IFCDUCTSEGMENT',
          name: 'Supply Duct SD-01',
          minXMm: 4300,
          maxXMm: 4700,
          minYMm: -300,
          maxYMm: 300,
          bottomMm: 2200,
          topMm: 2600,
        },
      ],
      'hard-triangle',
    );
    expect(clashes.length).toBeGreaterThanOrEqual(1);
    expect(clashes[0]!.kind).toBe('intersect');

    // BCF 2.1 issue + comment + .bcfzip round-trip
    const issue = bim.addBcfIssue({
      title: 'HVAC Duct clashes with North Exterior Wall',
      topicType: 'Clash',
      priority: 'Critical',
      assignedTo: 'mep@studio.local',
      description: 'Provide builders work sleeve or lower ductsoffit.',
      ifcGuid: '2O2Fr$t4X7Zf8NOew3FLOH',
    });
    bim.addBcfComment(issue.guid, 'Lead Architect', 'Approved 350x450 sleeved opening only if non-column zone.');
    const bcfZipBytes = bim.exportBcfZip('OpenBIM Residence');
    expect(bcfZipBytes[0]).toBe(0x50);

    const bim2 = mountOpenBimStudio({
      projectId: building.projectId,
      buildingId: building.id,
      revision: building.version,
      building,
    });
    const reimported = bim2.importBcfZip(bcfZipBytes);
    expect(reimported.length).toBe(1);
    expect(reimported[0]!.title).toBe('HVAC Duct clashes with North Exterior Wall');
    expect(reimported[0]!.comments?.length).toBe(1);

    // IFC4X3 STEP semantic + fidelity inspection
    const sampleIfc = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('sample.ifc','2026-11-26T00:00:00',('Architect'),('Studio'),'RH','RH','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1=IFCPROJECT('0YvctVUKr0kugbFTf53O9L',$,'Sample Project',$,$,$,$,$,#2);
#2=IFCUNITASSIGNMENT((#3));
#3=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#4=IFCSITE('1YvctVUKr0kugbFTf53O9L',$,'Site',$,$,$,$,$,.ELEMENT.,$,$,$,$,$);
#5=IFCBUILDING('2YvctVUKr0kugbFTf53O9L',$,'Building',$,$,$,$,$,.ELEMENT.,$,$,$);
#6=IFCBUILDINGSTOREY('3YvctVUKr0kugbFTf53O9L',$,'Ground Floor',$,$,$,$,$,.ELEMENT.,0.);
#7=IFCWALL('01vctVUKr0kugbFTf53O9L',$,'Wall-N',$,$,$,$,$,.STANDARD.);
#8=IFCRELAGGREGATES('11vctVUKr0kugbFTf53O9L',$,$,$,#1,(#4));
#9=IFCRELAGGREGATES('12vctVUKr0kugbFTf53O9L',$,$,$,#4,(#5));
#10=IFCRELAGGREGATES('13vctVUKr0kugbFTf53O9L',$,$,$,#5,(#6));
#11=IFCRELCONTAINEDINSPATIALSTRUCTURE('14vctVUKr0kugbFTf53O9L',$,$,$,(#7),#6);
ENDSEC;
END-ISO-10303-21;`;
    const diag = bim.inspectIfcStepBytes('sample.ifc', new TextEncoder().encode(sampleIfc));
    expect(diag.interop?.schema).toContain('IFC4X3');
    expect(diag.interop?.totalEntities).toBe(11);
    expect(diag.fidelity?.rows.length).toBeGreaterThanOrEqual(4);

    // Validated BIM canonical edit: reject <230mm exterior wall, accept 300mm exterior wall
    const rejected = bim.proposeCanonicalEdit({
      floorId: 'floor-g',
      entityKind: 'wall',
      canonicalId: 'w-ext-n',
      patch: { thicknessMm: 115 },
    });
    expect(rejected.ok).toBe(false);

    const accepted = bim.proposeCanonicalEdit({
      floorId: 'floor-g',
      entityKind: 'wall',
      canonicalId: 'w-ext-n',
      patch: { thicknessMm: 300, material: 'RCC Shear Wall 300mm' },
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.candidateBuilding?.version).toBe(building.version + 1);
    expect(accepted.candidateBuilding?.floors[0]?.walls[0]?.thickness).toBe(300);

    bim.unmount();
    bim2.unmount();
  });
});

/** Revision-bound DXF and IFC4 projections of a structural evaluation. */

import { canonicalIfcGlobalId, exchangeRing, IfcStepWriter, stepList, stepReal, stepString, type StepId } from '@ai-floor-planner/core';
import { elementLengthAndLambda } from '../math/frame-mechanics.js';
import type { FullStructuralEvaluationSnapshot } from '../optimization/defect-and-optimizer.js';

export function snapshotSolverBackends(snapshot: FullStructuralEvaluationSnapshot): string {
  const results = [
    ...Object.values(snapshot.solveEnvelope.loadCaseResults),
    ...Object.values(snapshot.solveEnvelope.combinationResults),
  ];
  return [...new Set(results.map((result) => result.diagnostics.executionBackend))].sort().join(', ') || 'UNAVAILABLE';
}

export const MANDATORY_STRUCTURAL_DISCLAIMER =
  'RH Planner structural review output. Requires independent verification, site geotechnical confirmation, and the seal of a licensed structural engineer before construction.';

function dxfLine(layer: string, x1: number, y1: number, x2: number, y2: number): string {
  return [
    '0', 'LINE',
    '8', layer,
    '10', x1.toFixed(2),
    '20', y1.toFixed(2),
    '30', '0.0',
    '11', x2.toFixed(2),
    '21', y2.toFixed(2),
    '31', '0.0',
  ].join('\n');
}

function dxfRect(layer: string, cx: number, cy: number, w: number, h: number): string {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  return [
    dxfLine(layer, x0, y0, x1, y0),
    dxfLine(layer, x1, y0, x1, y1),
    dxfLine(layer, x1, y1, x0, y1),
    dxfLine(layer, x0, y1, x0, y0),
  ].join('\n');
}

function dxfText(layer: string, x: number, y: number, height: number, content: string): string {
  const clean = content.replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7E]/g, '');
  return [
    '0', 'TEXT',
    '8', layer,
    '10', x.toFixed(2),
    '20', y.toFixed(2),
    '30', '0.0',
    '40', height.toFixed(1),
    '1', clean,
  ].join('\n');
}

/** Projects the reviewed foundation, storey plans and BBS in right-handed millimetres. */
export function exportStructuralEngineeringDxf(
  snapshot: FullStructuralEvaluationSnapshot,
  projectName = 'RH Planner Structural Project',
): string {
  const { system, rccDesign, foundationDesign, detailingAndBoq } = snapshot;
  const entities: string[] = [];

  const layers = [
    ['S-GRID', 8],
    ['S-FOOTING', 3],
    ['S-COLS', 1],
    ['S-BEAM', 30],
    ['S-SLAB', 5],
    ['S-REBAR', 2],
    ['S-ANNO', 7],
    ['S-SCHEDULE', 4],
    ['S-TITLE', 7],
  ] as const;

  const layerTable = [
    '0', 'TABLE',
    '2', 'LAYER',
    '70', String(layers.length),
    ...layers.flatMap(([name, color]) => [
      '0', 'LAYER',
      '2', name,
      '70', '0',
      '62', String(color),
      '6', 'CONTINUOUS',
    ]),
    '0', 'ENDTAB',
  ].join('\n');

  // Sheet 1: Foundation & Column Grid Layout (X offset 0)
  entities.push(dxfText('S-TITLE', 0, 4500, 350, `SHEET S-101: FOUNDATION & COLUMN LAYOUT - ${projectName}`));
  entities.push(
    dxfText(
      'S-TITLE',
      0,
      4000,
      180,
      `Arch Rev ${system.sourceArchitecturalRevision} (SHA ${system.sourceArchitecturalSha256.slice(0, 12)}) | Solver: ${snapshotSolverBackends(snapshot)}`,
    ),
  );

  for (const stk of Object.values(system.baseColumnStackMap)) {
    const cx = stk.xMm;
    const cy = -stk.yMm;
    entities.push(dxfRect('S-COLS', cx, cy, stk.columnWidthMm, stk.columnDepthMm));
    entities.push(dxfText('S-ANNO', cx + 220, cy + 180, 150, `${stk.stackId} (${stk.columnWidthMm}x${stk.columnDepthMm})`));
  }

  for (const ft of foundationDesign.footings) {
    const cx = ft.centerXMm;
    const cy = -ft.centerYMm;
    entities.push(dxfRect('S-FOOTING', cx, cy, ft.lengthXMm, ft.widthYMm));
    entities.push(
      dxfText(
        'S-REBAR',
        cx - ft.lengthXMm / 2 + 80,
        cy - ft.widthYMm / 2 + 100,
        130,
        `${ft.footingId} ${ft.typology} ${ft.lengthXMm}x${ft.widthYMm}x${ft.thicknessMm} (${ft.bottomMeshXLabel})`,
      ),
    );
  }

  const extentX = system.nodes.reduce((extent, node) => Math.max(extent, Math.abs(node.positionM[0] * 1000)), 0);
  const sheetPitchMm = Math.max(28_000, 2 * extentX + 8_000);
  const floors = [
    ...(rccDesign.beams.some((beam) => beam.floorId === 'PLINTH') ? [{ id: 'PLINTH', name: 'Plinth' }] : []),
    ...system.storeys,
  ];
  for (const [floorIndex, floor] of floors.entries()) {
    const offsetX = (floorIndex + 1) * sheetPitchMm;
    entities.push(dxfText('S-TITLE', offsetX, 4500, 350, 'FRAME PLAN - ' + (floor.name || floor.id)));
    for (const col of rccDesign.columns.filter((item) => item.floorId === floor.id)) {
      const element = system.elements[col.elementIndex]!;
      const end = system.nodes[element.endNodeIndex]!.positionM;
      entities.push(dxfRect('S-COLS', offsetX + end[0] * 1000, end[1] * 1000, col.widthMm, col.depthMm));
    }
    for (const beam of rccDesign.beams.filter((item) => item.floorId === floor.id)) {
      const element = system.elements[beam.elementIndex]!;
      const start = system.nodes[element.startNodeIndex]!.positionM;
      const end = system.nodes[element.endNodeIndex]!.positionM;
      const x0 = offsetX + start[0] * 1000;
      const y0 = start[1] * 1000;
      const x1 = offsetX + end[0] * 1000;
      const y1 = end[1] * 1000;
      entities.push(dxfLine('S-BEAM', x0, y0, x1, y1),
        dxfText('S-REBAR', (x0 + x1) / 2, (y0 + y1) / 2 + 120, 120,
          `${beam.elementId} (${beam.widthMm}x${beam.depthMm}) T:${beam.topBarsSupport.label} B:${beam.bottomBarsMidspan.label}`));
    }
    for (const panel of system.slabPanels.filter((item) => item.floorId === floor.id && item.exchangeBoundary)) {
      const ring = panel.exchangeBoundary!;
      for (const [index, start] of ring.entries()) {
        const end = ring[(index + 1) % ring.length]!;
        if (start.x !== end.x || start.y !== end.y) {
          entities.push(dxfLine('S-SLAB', offsetX + start.x, -start.y, offsetX + end.x, -end.y));
        }
      }
      entities.push(dxfText('S-ANNO', offsetX + (panel.boundsMm.minX + panel.boundsMm.maxX) / 2,
        -(panel.boundsMm.minY + panel.boundsMm.maxY) / 2, 130, `${panel.id} (${panel.thicknessMm}mm)`));
    }
  }

  const xOff3 = (floors.length + 1) * sheetPitchMm;
  entities.push(dxfText('S-TITLE', xOff3, 4500, 350, 'BAR BENDING SCHEDULE & MATERIAL QUANTITIES'));
  const q = detailingAndBoq.quantities;
  entities.push(
    dxfText(
      'S-SCHEDULE',
      xOff3,
      3800,
      180,
      `NET CONCRETE: ${q.netConcreteVolumeM3} m3 (Joint Deduction: ${q.jointAndSlabIntersectionDeductionM3} m3) | TOTAL REBAR: ${q.totalSteelWeightKg} kg (${q.totalSteelTonnes} MT) | FORMWORK: ${q.formworkAreaM2} m2`,
    ),
  );

  let rowY = 3200;
  entities.push(
    dxfText(
      'S-SCHEDULE',
      xOff3,
      rowY,
      150,
      'BAR_MARK | MEMBER_ID | DIA_MM | QTY | CUT_LEN_MM | TOTAL_LEN_M | WEIGHT_KG | DESCRIPTION',
    ),
  );
  for (const entry of detailingAndBoq.bbsEntries) {
    rowY -= 260;
    entities.push(
      dxfText(
        'S-SCHEDULE',
        xOff3,
        rowY,
        130,
        `${entry.barMark} | ${entry.memberId} | T${entry.barDiaMm} | ${entry.totalBars} | ${entry.cuttingLengthMm} | ${entry.totalLengthM}m | ${entry.totalWeightKg}kg | ${entry.description}`,
      ),
    );
  }

  entities.push(dxfText('S-TITLE', xOff3, rowY - 600, 140, MANDATORY_STRUCTURAL_DISCLAIMER));

  return [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$INSUNITS',
    '70', '4', // 4 = Millimetres
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'TABLES',
    layerTable,
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'ENTITIES',
    entities.join('\n'),
    '0', 'ENDSEC',
    '0', 'EOF',
    '',
  ].join('\n');
}


/** Projects the evaluated physical frame and supported planar profiles to IFC4. */
export function exportStructuralIfc4Step(
  snapshot: FullStructuralEvaluationSnapshot,
  projectName = 'RH Planner Structural Model',
): string {
  const { system, rccDesign, foundationDesign, detailingAndBoq } = snapshot;
  const step = new IfcStepWriter();
  const guid = (...identity: string[]) => stepString(canonicalIfcGlobalId(system.projectId, system.buildingId, 'structural', ...identity));
  const direction = (axes: readonly number[]) => step.add('IFCDIRECTION', stepList(axes.map(stepReal)));
  const origin = step.point(0, 0, 0);
  const axis = step.add('IFCAXIS2PLACEMENT3D', origin, '$', '$');
  const zAxis = direction([0, 0, 1]);
  const context = step.add('IFCGEOMETRICREPRESENTATIONCONTEXT', '$', "'Model'", '3', '1.E-05', axis, '$');
  const units = step.add('IFCUNITASSIGNMENT', stepList([
    step.add('IFCSIUNIT', '*', '.LENGTHUNIT.', '.MILLI.', '.METRE.'),
    step.add('IFCSIUNIT', '*', '.AREAUNIT.', '$', '.SQUARE_METRE.'),
    step.add('IFCSIUNIT', '*', '.VOLUMEUNIT.', '$', '.CUBIC_METRE.'),
    step.add('IFCSIUNIT', '*', '.FORCEUNIT.', '.KILO.', '.NEWTON.'),
  ]));
  const project = step.add('IFCPROJECT', guid('project'), '$', stepString(projectName),
    stepString(MANDATORY_STRUCTURAL_DISCLAIMER), '$', '$', '$', stepList([context]), units);
  const sitePlace = step.placement(0);
  const site = step.add('IFCSITE', guid('site'), '$', "'Site'", '$', '$', sitePlace, '$', '$', '.ELEMENT.', '$', '$', '$', '$', '$');
  const buildingPlace = step.placement(0, sitePlace);
  const building = step.add('IFCBUILDING', guid('building'), '$', stepString(projectName), '$', '$', buildingPlace, '$', '$', '.ELEMENT.', '$', '$', '$');
  const aggregate = (id: string, parent: StepId, children: readonly StepId[]) =>
    step.add('IFCRELAGGREGATES', guid('aggregate', id), '$', '$', '$', parent, stepList(children));
  aggregate('project', project, [site]);
  aggregate('site', site, [building]);

  const storeys = new Map<string, { entity: StepId; place: StepId; elevationMm: number; products: StepId[] }>();
  const addStorey = (floorId: string, name: string, elevationMm: number) => {
    const place = step.placement(elevationMm, buildingPlace);
    const entity = step.add('IFCBUILDINGSTOREY', guid('storey', floorId), '$', stepString(name),
      '$', '$', place, '$', '$', '.ELEMENT.', stepReal(elevationMm));
    storeys.set(floorId, { entity, place, elevationMm, products: [] });
  };
  const foundationElevation = (system.nodes.find((node) => node.floorId === 'FOUNDATION')?.positionM[2] ?? 0) * 1000;
  addStorey('FOUNDATION', 'Foundation', foundationElevation);
  if (system.nodes.some((node) => node.floorId === 'PLINTH')) addStorey('PLINTH', 'Plinth', 0);
  for (const floor of system.storeys) addStorey(floor.id, floor.name || floor.id, floor.elevationMm);
  aggregate('building', building, [...storeys.values()].map((storey) => storey.entity));

  const attachDesign = (target: StepId, key: string, props: Record<string, string | number>) => {
    const properties = Object.entries(props).map(([label, value]) => {
      const typedValue = typeof value === 'number' && Number.isFinite(value)
        ? 'IFCREAL(' + stepReal(value) + ')'
        : 'IFCLABEL(' + stepString(typeof value === 'string' ? value : 'UNAVAILABLE') + ')';
      return step.add('IFCPROPERTYSINGLEVALUE', stepString(label), '$', typedValue, '$');
    });
    const pset = step.add('IFCPROPERTYSET', guid('pset', key), '$', "'Pset_RHPlannerStructuralDesign'", '$', stepList(properties));
    step.add('IFCRELDEFINESBYPROPERTIES', guid('properties', key), '$', '$', '$', stepList([target]), pset);
  };
  const rect = (width: number, depth: number) =>
    step.add('IFCRECTANGLEPROFILEDEF', '.AREA.', '$', '$', stepReal(width), stepReal(depth));

  const extrude = (profile: StepId, depthMm: number) => ({
    id: step.add('IFCEXTRUDEDAREASOLID', profile, axis, zAxis, stepReal(depthMm)),
    type: "'SweptSolid'" as const,
  });

  function frameBrep(axes: number[][], widthMm: number, depthMm: number, lengthMm: number) {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
    const points = [0, lengthMm].flatMap((station) => corners.map(([width, depth]) =>
      step.point(...axes[0]!.map((direction, index) => direction * station +
        axes[1]![index]! * width * widthMm / 2 + axes[2]![index]! * depth * depthMm / 2)),
    ));
    const faces = [[3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]].map((indices) => {
      const loop = step.add('IFCPOLYLOOP', stepList(indices.map((index) => points[index]!)));
      return step.add('IFCFACE', stepList([step.add('IFCFACEOUTERBOUND', loop, '.T.')]));
    });
    return step.add('IFCFACETEDBREP', step.add('IFCCLOSEDSHELL', stepList(faces)));
  }

  function addProduct(params: {
    type: string; subtype: string; id: string; floorId: string;
    baseMm: readonly [number, number, number];
    body: { id: StepId; type: "'SweptSolid'" | "'Brep'" };
    axes?: number[][]; properties: Record<string, string | number>;
  }) {
    const storey = storeys.get(params.floorId);
    if (!storey) throw new Error('Missing IFC structural storey for ' + params.id);
    const [x, y, z] = params.baseMm;
    const location = step.point(x, y, z - storey.elevationMm);
    const placementAxis = step.add('IFCAXIS2PLACEMENT3D', location,
      params.axes ? direction(params.axes[0]!) : '$', params.axes ? direction(params.axes[1]!) : '$');
    const place = step.add('IFCLOCALPLACEMENT', storey.place, placementAxis);
    const shape = step.add('IFCSHAPEREPRESENTATION', context, "'Body'", params.body.type, stepList([params.body.id]));
    const representation = step.add('IFCPRODUCTDEFINITIONSHAPE', '$', '$', stepList([shape]));
    const product = step.add(params.type, guid(params.type, params.id), '$', stepString(params.id), '$', '$',
      place, representation, stepString(params.id), params.subtype);
    storey.products.push(product);
    attachDesign(product, params.type + ':' + params.id, params.properties);
  }

  for (const member of [...rccDesign.columns, ...rccDesign.beams]) {
    const element = system.elements[member.elementIndex]!;
    const start = system.nodes[element.startNodeIndex]!.positionM;
    const end = system.nodes[element.endNodeIndex]!.positionM;
    const frame = elementLengthAndLambda(start, end, element.localAxisAngleDeg);
    const column = 'longitudinalBars' in member;
    addProduct({
      type: column ? 'IFCCOLUMN' : 'IFCBEAM', subtype: column ? '.COLUMN.' : '.BEAM.',
      id: member.elementId, floorId: member.floorId, baseMm: [start[0] * 1000, start[1] * 1000, start[2] * 1000],
      axes: column ? frame.lambda3x3 : undefined,
      body: column
        ? extrude(rect(member.widthMm, member.depthMm), frame.lengthM * 1000)
        : { id: frameBrep(frame.lambda3x3, member.widthMm, member.depthMm, frame.lengthM * 1000), type: "'Brep'" },
      properties: {
        ConcreteGrade: member.concreteGrade, SteelGrade: member.steelGrade,
        WidthMm: member.widthMm, DepthMm: member.depthMm, FrameLengthMm: frame.lengthM * 1000,
        Reinforcement: column ? member.longitudinalBars.label : member.topBarsSupport.label + ' / ' + member.bottomBarsMidspan.label,
        TransverseReinforcement: column ? member.lateralTies.label : member.stirrups.label,
        UtilizationRatio: member.maxUtilization, DesignStatus: member.status,
      },
    });
  }

  const panelById = new Map(system.slabPanels.map((panel) => [panel.id, panel]));
  const omittedSlabIds: string[] = [];
  for (const slab of rccDesign.slabs) {
    const panel = panelById.get(slab.panelId);
    const top = system.nodes.find((node) => node.floorId === slab.floorId)?.positionM[2];
    if (!panel?.exchangeBoundary || top === undefined) {
      omittedSlabIds.push(slab.panelId);
      continue;
    }
    const boundary = exchangeRing({ points: panel.exchangeBoundary });
    const profile = step.add('IFCARBITRARYCLOSEDPROFILEDEF', '.AREA.', '$', step.polyline(boundary));
    addProduct({
      type: 'IFCSLAB', subtype: '.FLOOR.', id: slab.panelId, floorId: slab.floorId,
      baseMm: [0, 0, top * 1000 - slab.thicknessMm], body: extrude(profile, slab.thicknessMm),
      properties: { ThicknessMm: slab.thicknessMm, UtilizationRatio: slab.maxUtilization, DesignStatus: slab.status },
    });
  }

  for (const footing of foundationDesign.footings) {
    const raft = footing.typology === 'RIGID_RAFT';
    addProduct({
      type: raft ? 'IFCSLAB' : 'IFCFOOTING',
      subtype: raft ? '.BASESLAB.' : footing.typology === 'STRIP' ? '.STRIP_FOOTING.' : '.PAD_FOOTING.',
      id: footing.footingId, floorId: 'FOUNDATION',
      baseMm: [footing.centerXMm, -footing.centerYMm, -footing.excavationDepthM * 1000],
      body: extrude(rect(footing.lengthXMm, footing.widthYMm), footing.thicknessMm),
      properties: {
        Typology: footing.typology, MaxSoilPressureKPa: footing.maxSoilPressureKPa,
        AllowableSBCKPa: footing.allowableBearingPressureKPa, BottomMeshX: footing.bottomMeshXLabel,
        BottomMeshY: footing.bottomMeshYLabel, UtilizationRatio: footing.maxUtilization, DesignStatus: footing.status,
      },
    });
  }

  attachDesign(building, 'evaluation', {
    SolverBackend: snapshotSolverBackends(snapshot),
    ArchitecturalRevision: system.sourceArchitecturalRevision,
    ArchitecturalSha256: system.sourceArchitecturalSha256,
    FoundationStatus: foundationDesign.status,
    OmittedSlabPanelCount: omittedSlabIds.length,
    OmittedStairWaistCount: system.stairWaists.length,
    NetConcreteVolumeM3: detailingAndBoq.quantities.netConcreteVolumeM3,
    TotalRebarWeightKg: detailingAndBoq.quantities.totalSteelWeightKg,
  });
  for (const [id, storey] of storeys) {
    if (storey.products.length) {
      step.add('IFCRELCONTAINEDINSPATIALSTRUCTURE', guid('containment', id), '$', '$', '$',
        stepList(storey.products), storey.entity);
    }
  }
  return new TextDecoder().decode(step.encode('RH Planner IFC4 structural exchange', projectName + '.ifc'));
}

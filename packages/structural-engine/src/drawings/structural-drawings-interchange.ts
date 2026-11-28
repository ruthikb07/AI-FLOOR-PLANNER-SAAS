/**
 * Revision-bound DXF and IFC4 projections of a physical structural evaluation (Milestone 5.1 Gate 10).
 *
 * Strictly enforces:
 * - Physical member export (`1 PhysicalBeam` -> `1 IfcBeam` across full span `startNode..endNode`, never split per FEA segment!).
 * - Supported inclined staircase waist solids exported as `IFCSTAIRFLIGHT` faceted Breps (`OmittedStairWaistCount = 0` for planar flights!).
 * - Consolidated BBS marks & physical `scheduleGroupMark` properties.
 * - Failed / unsupported / unreviewed designs are stamped `DIAGNOSTIC_NOT_FOR_CONSTRUCTION` (never construction-approved).
 */

import {
  canonicalIfcGlobalId,
  exchangeRing,
  IfcStepWriter,
  stepList,
  stepReal,
  stepString,
  stableValueHash,
  type StepId,
} from '@ai-floor-planner/core';
import { elementLengthAndLambda } from '../math/frame-mechanics.js';
import type { FullStructuralEvaluationSnapshot, StructuralRegenerationSummary } from '../optimization/defect-and-optimizer.js';
import type { ReviewedStructuralInputs } from '../loads/indian-load-assembler.js';
import type { AnalyticalSolveEnvelope } from '../types/solver-types.js';
import {
  CARBON4_SECTION_CAPABILITY_REGISTRY,
  CARBON4_SOLVER_CAPABILITY_REGISTRY,
} from '../capabilities/solver-capability-registry.js';

export function snapshotSolverBackends(snapshot: FullStructuralEvaluationSnapshot): string {
  const results = [
    ...Object.values(snapshot.solveEnvelope.loadCaseResults),
    ...Object.values(snapshot.solveEnvelope.combinationResults),
  ];
  return [...new Set(results.map((result) => result.diagnostics.executionBackend))].sort().join(', ') || 'UNAVAILABLE';
}

export function snapshotDrawingApprovalStatus(
  snapshot: FullStructuralEvaluationSnapshot,
): 'PRELIMINARY_FOR_ENGINEER_REVIEW' | 'DIAGNOSTIC_NOT_FOR_CONSTRUCTION' {
  return snapshot.designLifecycleStatus === 'DESIGN_CHECKS_PASSED'
    ? 'PRELIMINARY_FOR_ENGINEER_REVIEW'
    : 'DIAGNOSTIC_NOT_FOR_CONSTRUCTION';
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

function getPhysicalMemberEndPositionsM(
  system: FullStructuralEvaluationSnapshot['system'],
  member: { readonly elementIndex: number; readonly analyticalElementIndices?: readonly number[] },
): { readonly startM: readonly [number, number, number]; readonly endM: readonly [number, number, number]; readonly firstEl: FullStructuralEvaluationSnapshot['system']['elements'][number] } {
  const indices =
    member.analyticalElementIndices && member.analyticalElementIndices.length > 0
      ? member.analyticalElementIndices
      : [member.elementIndex];
  const firstEl = system.elements[indices[0]!]!;
  const lastEl = system.elements[indices[indices.length - 1]!]!;
  return {
    startM: system.nodes[firstEl.startNodeIndex]!.positionM,
    endM: system.nodes[lastEl.endNodeIndex]!.positionM,
    firstEl,
  };
}

/** Projects the physical foundation, storey framing, stair waists, cross-sections, and consolidated BBS in right-handed millimetres. */
export function exportStructuralEngineeringDxf(
  snapshot: FullStructuralEvaluationSnapshot,
  projectName = 'RH Planner Structural Project',
): string {
  const { system, rccDesign, foundationDesign, detailingAndBoq } = snapshot;
  const approvalStatus = snapshotDrawingApprovalStatus(snapshot);
  const entities: string[] = [];

  const layers = [
    ['A-GRID-REF', 9],
    ['S-GRID', 8],
    ['S-FOOTING', 3],
    ['S-COLS', 1],
    ['S-BEAM', 30],
    ['S-SLAB', 5],
    ['S-STAIR', 6],
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
  entities.push(dxfText('S-TITLE', 0, 5000, 350, `SHEET S-101: FOUNDATION & COLUMN LAYOUT - ${projectName}`));
  entities.push(
    dxfText(
      'S-TITLE',
      0,
      4450,
      180,
      `Arch Rev ${system.sourceArchitecturalRevision} (SHA ${system.sourceArchitecturalSha256.slice(0, 12)}) | Struct Rev ${system.structuralRevision} | Solver: ${snapshotSolverBackends(snapshot)}`,
    ),
  );
  entities.push(
    dxfText(
      'S-TITLE',
      0,
      4050,
      200,
      approvalStatus === 'DIAGNOSTIC_NOT_FOR_CONSTRUCTION'
        ? `STATUS: ${snapshot.designLifecycleStatus} - DIAGNOSTIC REPORT ONLY (NOT FOR CONSTRUCTION)`
        : `STATUS: ${snapshot.designLifecycleStatus} - FOR LICENSED STRUCTURAL ENGINEER REVIEW`,
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
        `${ft.footingId} [${ft.scheduleGroupMark}] ${ft.typology} ${ft.lengthXMm}x${ft.widthYMm}x${ft.thicknessMm} (${ft.bottomMeshXLabel})`,
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
    entities.push(dxfText('S-TITLE', offsetX, 4500, 350, `PHYSICAL FRAME PLAN - ${floor.name || floor.id}`));
    for (const col of rccDesign.columns.filter((item) => item.floorId === floor.id)) {
      const { endM } = getPhysicalMemberEndPositionsM(system, col);
      entities.push(dxfRect('S-COLS', offsetX + endM[0] * 1000, endM[1] * 1000, col.widthMm, col.depthMm));
    }
    for (const beam of rccDesign.beams.filter((item) => item.floorId === floor.id)) {
      const { startM, endM } = getPhysicalMemberEndPositionsM(system, beam);
      const x0 = offsetX + startM[0] * 1000;
      const y0 = startM[1] * 1000;
      const x1 = offsetX + endM[0] * 1000;
      const y1 = endM[1] * 1000;
      entities.push(
        dxfLine('S-BEAM', x0, y0, x1, y1),
        dxfText(
          'S-REBAR',
          (x0 + x1) / 2,
          (y0 + y1) / 2 + 120,
          120,
          `${beam.physicalMemberId} [${beam.scheduleGroupMark}] (${beam.widthMm}x${beam.depthMm}) T:${beam.topBarsSupport.label} B:${beam.bottomBarsMidspan.label}`,
        ),
      );
    }
    for (const panel of system.slabPanels.filter((item) => item.floorId === floor.id && item.exchangeBoundary)) {
      const ring = panel.exchangeBoundary!;
      for (const [index, start] of ring.entries()) {
        const end = ring[(index + 1) % ring.length]!;
        if (start.x !== end.x || start.y !== end.y) {
          entities.push(dxfLine('S-SLAB', offsetX + start.x, -start.y, offsetX + end.x, -end.y));
        }
      }
      entities.push(
        dxfText(
          'S-ANNO',
          offsetX + (panel.boundsMm.minX + panel.boundsMm.maxX) / 2,
          -(panel.boundsMm.minY + panel.boundsMm.maxY) / 2,
          130,
          `${panel.id} (${panel.thicknessMm}mm)`,
        ),
      );
    }
    for (const st of system.stairWaists.filter((item) => item.floorId === floor.id && item.boundsMm)) {
      const b = st.boundsMm!;
      const cx = offsetX + (b.minX + b.maxX) / 2;
      const cy = -(b.minY + b.maxY) / 2;
      entities.push(dxfRect('S-STAIR', cx, cy, b.maxX - b.minX, b.maxY - b.minY));
      entities.push(dxfText('S-ANNO', cx - 400, cy, 120, `${st.id} (Waist ${st.waistThicknessMm}mm)`));
    }
  }

  const xOff3 = (floors.length + 1) * sheetPitchMm;
  entities.push(dxfText('S-TITLE', xOff3, 4500, 350, 'CONSOLIDATED BAR BENDING SCHEDULE & MATERIAL QUANTITIES'));
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
      'BAR_MARK | GROUP_MEMBERS | DIA_MM | MEMBERS | TOTAL_BARS | CUT_LEN_MM | TOTAL_LEN_M | WEIGHT_KG | DESCRIPTION',
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
        `${entry.barMark} | ${entry.memberId} | T${entry.barDiaMm} | ${entry.memberCount} | ${entry.totalBars} | ${entry.cuttingLengthMm} | ${entry.totalLengthM}m | ${entry.totalWeightKg.toFixed(2)}kg | ${entry.description}`,
      ),
    );
  }

  entities.push(dxfText('S-TITLE', xOff3, rowY - 600, 140, MANDATORY_STRUCTURAL_DISCLAIMER));

  return [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$INSUNITS',
    '70', '4',
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

/** Projects the evaluated PHYSICAL frame, slabs, foundations, and supported inclined stair-waist solids to IFC4 STEP. */
export function exportStructuralIfc4Step(
  snapshot: FullStructuralEvaluationSnapshot,
  projectName = 'RH Planner Structural Model',
): string {
  const { system, rccDesign, foundationDesign, detailingAndBoq } = snapshot;
  const approvalStatus = snapshotDrawingApprovalStatus(snapshot);
  const step = new IfcStepWriter();
  const guid = (...identity: string[]) =>
    stepString(canonicalIfcGlobalId(system.projectId, system.buildingId, 'structural', ...identity));
  const direction = (axes: readonly number[]) => step.add('IFCDIRECTION', stepList(axes.map(stepReal)));
  const origin = step.point(0, 0, 0);
  const axis = step.add('IFCAXIS2PLACEMENT3D', origin, '$', '$');
  const zAxis = direction([0, 0, 1]);
  const context = step.add('IFCGEOMETRICREPRESENTATIONCONTEXT', '$', "'Model'", '3', '1.E-05', axis, '$');
  const units = step.add(
    'IFCUNITASSIGNMENT',
    stepList([
      step.add('IFCSIUNIT', '*', '.LENGTHUNIT.', '.MILLI.', '.METRE.'),
      step.add('IFCSIUNIT', '*', '.AREAUNIT.', '$', '.SQUARE_METRE.'),
      step.add('IFCSIUNIT', '*', '.VOLUMEUNIT.', '$', '.CUBIC_METRE.'),
      step.add('IFCSIUNIT', '*', '.FORCEUNIT.', '.KILO.', '.NEWTON.'),
    ]),
  );
  const project = step.add(
    'IFCPROJECT',
    guid('project'),
    '$',
    stepString(projectName),
    stepString(MANDATORY_STRUCTURAL_DISCLAIMER),
    '$',
    '$',
    '$',
    stepList([context]),
    units,
  );
  const sitePlace = step.placement(0);
  const site = step.add(
    'IFCSITE',
    guid('site'),
    '$',
    "'Site'",
    '$',
    '$',
    sitePlace,
    '$',
    '$',
    '.ELEMENT.',
    '$',
    '$',
    '$',
    '$',
    '$',
  );
  const buildingPlace = step.placement(0, sitePlace);
  const building = step.add(
    'IFCBUILDING',
    guid('building'),
    '$',
    stepString(projectName),
    '$',
    '$',
    buildingPlace,
    '$',
    '$',
    '.ELEMENT.',
    '$',
    '$',
    '$',
  );
  const aggregate = (id: string, parent: StepId, children: readonly StepId[]) =>
    step.add('IFCRELAGGREGATES', guid('aggregate', id), '$', '$', '$', parent, stepList(children));
  aggregate('project', project, [site]);
  aggregate('site', site, [building]);

  const storeys = new Map<string, { entity: StepId; place: StepId; elevationMm: number; products: StepId[] }>();
  const addStorey = (floorId: string, name: string, elevationMm: number) => {
    const place = step.placement(elevationMm, buildingPlace);
    const entity = step.add(
      'IFCBUILDINGSTOREY',
      guid('storey', floorId),
      '$',
      stepString(name),
      '$',
      '$',
      place,
      '$',
      '$',
      '.ELEMENT.',
      stepReal(elevationMm),
    );
    storeys.set(floorId, { entity, place, elevationMm, products: [] });
  };
  const foundationElevation =
    (system.nodes.find((node) => node.floorId === 'FOUNDATION')?.positionM[2] ?? 0) * 1000;
  addStorey('FOUNDATION', 'Foundation', foundationElevation);
  if (system.nodes.some((node) => node.floorId === 'PLINTH')) addStorey('PLINTH', 'Plinth', 0);
  for (const floor of system.storeys) addStorey(floor.id, floor.name || floor.id, floor.elevationMm);
  aggregate('building', building, [...storeys.values()].map((storey) => storey.entity));

  const attachDesign = (target: StepId, key: string, props: Record<string, string | number>) => {
    const properties = Object.entries(props).map(([label, value]) => {
      const typedValue =
        typeof value === 'number' && Number.isFinite(value)
          ? 'IFCREAL(' + stepReal(value) + ')'
          : 'IFCLABEL(' + stepString(typeof value === 'string' ? value : 'UNAVAILABLE') + ')';
      return step.add('IFCPROPERTYSINGLEVALUE', stepString(label), '$', typedValue, '$');
    });
    const pset = step.add(
      'IFCPROPERTYSET',
      guid('pset', key),
      '$',
      "'Pset_RHPlannerStructuralDesign'",
      '$',
      stepList(properties),
    );
    step.add('IFCRELDEFINESBYPROPERTIES', guid('properties', key), '$', '$', '$', stepList([target]), pset);
  };
  const rect = (width: number, depth: number) =>
    step.add('IFCRECTANGLEPROFILEDEF', '.AREA.', '$', '$', stepReal(width), stepReal(depth));

  const extrude = (profile: StepId, depthMm: number) => ({
    id: step.add('IFCEXTRUDEDAREASOLID', profile, axis, zAxis, stepReal(depthMm)),
    type: "'SweptSolid'" as const,
  });

  function frameBrep(axes: number[][], widthMm: number, depthMm: number, lengthMm: number) {
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const;
    const points = [0, lengthMm].flatMap((station) =>
      corners.map(([width, depth]) =>
        step.point(
          ...axes[0]!.map(
            (dir, index) =>
              dir * station +
              axes[1]![index]! * width * (widthMm / 2) +
              axes[2]![index]! * depth * (depthMm / 2),
          ),
        ),
      ),
    );
    const faces = [
      [3, 2, 1, 0],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ].map((indices) => {
      const loop = step.add('IFCPOLYLOOP', stepList(indices.map((index) => points[index]!)));
      return step.add('IFCFACE', stepList([step.add('IFCFACEOUTERBOUND', loop, '.T.')]));
    });
    return step.add('IFCFACETEDBREP', step.add('IFCCLOSEDSHELL', stepList(faces)));
  }

  function addProduct(params: {
    type: string;
    subtype: string;
    id: string;
    floorId: string;
    baseMm: readonly [number, number, number];
    body: { id: StepId; type: "'SweptSolid'" | "'Brep'" };
    axes?: number[][];
    extraArgsAfterSubtype?: readonly string[];
    properties: Record<string, string | number>;
  }) {
    const storey = storeys.get(params.floorId);
    if (!storey) throw new Error('Missing IFC structural storey for ' + params.id);
    const [x, y, z] = params.baseMm;
    const location = step.point(x, y, z - storey.elevationMm);
    const placementAxis = step.add(
      'IFCAXIS2PLACEMENT3D',
      location,
      params.axes ? direction(params.axes[0]!) : '$',
      params.axes ? direction(params.axes[1]!) : '$',
    );
    const place = step.add('IFCLOCALPLACEMENT', storey.place, placementAxis);
    const shape = step.add(
      'IFCSHAPEREPRESENTATION',
      context,
      "'Body'",
      params.body.type,
      stepList([params.body.id]),
    );
    const representation = step.add('IFCPRODUCTDEFINITIONSHAPE', '$', '$', stepList([shape]));
    const product = step.add(
      params.type,
      guid(params.type, params.id),
      '$',
      stepString(params.id),
      '$',
      '$',
      place,
      representation,
      stepString(params.id),
      ...(params.extraArgsAfterSubtype ?? []),
      params.subtype,
    );
    storey.products.push(product);
    attachDesign(product, params.type + ':' + params.id, params.properties);
  }

  // 1. Export Physical Columns & Physical Beams (1 IFC entity per PhysicalMember across full physical span!)
  for (const member of [...rccDesign.columns, ...rccDesign.beams]) {
    const { startM, endM, firstEl } = getPhysicalMemberEndPositionsM(system, member);
    const frame = elementLengthAndLambda(startM, endM, firstEl.localAxisAngleDeg);
    const column = 'longitudinalBars' in member;
    addProduct({
      type: column ? 'IFCCOLUMN' : 'IFCBEAM',
      subtype: column ? '.COLUMN.' : '.BEAM.',
      id: member.physicalMemberId,
      floorId: member.floorId,
      baseMm: [startM[0] * 1000, startM[1] * 1000, startM[2] * 1000],
      axes: column ? frame.lambda3x3 : undefined,
      body: column
        ? extrude(rect(member.widthMm, member.depthMm), frame.lengthM * 1000)
        : {
            id: frameBrep(frame.lambda3x3, member.widthMm, member.depthMm, frame.lengthM * 1000),
            type: "'Brep'",
          },
      properties: {
        PhysicalMemberId: member.physicalMemberId,
        ScheduleGroupMark: member.scheduleGroupMark,
        AnalyticalChildCount: member.analyticalElementIndices.length,
        ConcreteGrade: member.concreteGrade,
        SteelGrade: member.steelGrade,
        WidthMm: member.widthMm,
        DepthMm: member.depthMm,
        FrameLengthMm: frame.lengthM * 1000,
        Reinforcement: column
          ? member.longitudinalBars.label
          : member.topBarsSupport.label + ' / ' + member.bottomBarsMidspan.label,
        TransverseReinforcement: column ? member.lateralTies.label : member.stirrups.label,
        UtilizationRatio: member.maxUtilization,
        DesignStatus: member.status,
      },
    });
  }

  // 2. Export Physical Slabs
  const panelById = new Map(system.slabPanels.map((panel) => [panel.id, panel]));
  const omittedSlabIds: string[] = [];
  for (const slab of rccDesign.slabs) {
    const panel = panelById.get(slab.panelId);
    const top = panel?.deckReview ? panel.deckReview.structuralTopMm / 1000 :
      system.nodes.find((node) => node.floorId === slab.floorId)?.positionM[2];
    if (!panel?.exchangeBoundary || top === undefined) {
      omittedSlabIds.push(slab.panelId);
      continue;
    }
    const boundary = exchangeRing({ points: panel.exchangeBoundary });
    const profile = step.add('IFCARBITRARYCLOSEDPROFILEDEF', '.AREA.', '$', step.polyline(boundary));
    addProduct({
      type: 'IFCSLAB',
      subtype: panel.deckReview?.use === 'ROOF' ? '.ROOF.' : '.FLOOR.',
      id: slab.panelId,
      floorId: slab.floorId,
      baseMm: [0, 0, top * 1000 - slab.thicknessMm],
      body: extrude(profile, slab.thicknessMm),
      properties: {
        ...(panel.deckReview ? { DeckReviewReference: panel.deckReview.reference, SurfaceFloorId: panel.deckReview.surfaceFloorId,
          StructuralTopMm: panel.deckReview.structuralTopMm, FinishedFloorMm: panel.deckReview.finishedFloorMm } : {}),
        PhysicalMemberId: slab.physicalMemberId,
        ScheduleGroupMark: slab.scheduleGroupMark,
        ThicknessMm: slab.thicknessMm,
        ShortSpanRebar: `T${slab.shortSpanBottomDiaMm}@${slab.shortSpanBottomSpacingMm}`,
        LongSpanRebar: `T${slab.longSpanDiaMm}@${slab.longSpanSpacingMm}`,
        UtilizationRatio: slab.maxUtilization,
        DesignStatus: slab.status,
      },
    });
  }

  // 3. Export Supported Staircase Waist Inclined Solids (`IFCSTAIRFLIGHT`, Gate 10!)
  const waistById = new Map(system.stairWaists.map((w) => [w.id, w]));
  const omittedStairIds: string[] = [];
  let exportedStairCount = 0;

  for (const stairDesign of rccDesign.stairs) {
    const waist = waistById.get(stairDesign.waistId);
    if (
      !waist ||
      !waist.ifcSolidGeometrySupported ||
      !waist.boundsMm ||
      waist.baseElevationMm === undefined ||
      waist.topElevationMm === undefined
    ) {
      omittedStairIds.push(stairDesign.waistId);
      continue;
    }

    const b = waist.boundsMm;
    const midXMm = (b.minX + b.maxX) / 2;
    const midYMm = (b.minY + b.maxY) / 2;
    const dir = waist.flightDirection ?? 'N';

    // Convert canonical plan (xMm East, yMm South -> -yMm North) into 3D inclined waist centerline [startM -> endM]
    let startPlanMm: [number, number];
    let endPlanMm: [number, number];
    if (dir === 'N') {
      startPlanMm = [midXMm, b.maxY];
      endPlanMm = [midXMm, b.minY];
    } else if (dir === 'S') {
      startPlanMm = [midXMm, b.minY];
      endPlanMm = [midXMm, b.maxY];
    } else if (dir === 'E') {
      startPlanMm = [b.minX, midYMm];
      endPlanMm = [b.maxX, midYMm];
    } else {
      startPlanMm = [b.maxX, midYMm];
      endPlanMm = [b.minX, midYMm];
    }

    const startM: [number, number, number] = [
      startPlanMm[0] / 1000,
      -startPlanMm[1] / 1000,
      (waist.baseElevationMm + waist.waistThicknessMm / 2) / 1000,
    ];
    const endM: [number, number, number] = [
      endPlanMm[0] / 1000,
      -endPlanMm[1] / 1000,
      (waist.topElevationMm - waist.waistThicknessMm / 2) / 1000,
    ];
    const flightFrame = elementLengthAndLambda(startM, endM, 0);

    // IFC4 IfcStairFlight attributes:
    // (GlobalId, OwnerHistory, Name, Description, ObjectType, ObjectPlacement, Representation, Tag, NumberOfRisers, NumberOfTreads, RiserHeight, TreadLength, PredefinedType)
    addProduct({
      type: 'IFCSTAIRFLIGHT',
      subtype: '.STRAIGHT.',
      id: stairDesign.waistId,
      floorId: stairDesign.floorId,
      baseMm: [startM[0] * 1000, startM[1] * 1000, startM[2] * 1000],
      body: {
        id: frameBrep(
          flightFrame.lambda3x3,
          waist.widthMm,
          waist.waistThicknessMm,
          flightFrame.lengthM * 1000,
        ),
        type: "'Brep'",
      },
      extraArgsAfterSubtype: [
        String(waist.riserCount),
        String(Math.max(1, waist.riserCount - 1)),
        stepReal(waist.riserMm),
        stepReal(waist.treadMm),
      ],
      properties: {
        PhysicalMemberId: stairDesign.physicalMemberId,
        WaistThicknessMm: waist.waistThicknessMm,
        WidthMm: waist.widthMm,
        BearingReview: waist.bearingReview?.reference ?? 'UNREVIEWED',
        LowerBearingBeam: waist.bearingReview?.lowerBeamId ?? 'UNREVIEWED',
        UpperBearingBeam: waist.bearingReview?.upperBeamId ?? 'UNREVIEWED',
        InclinedLengthMm: Number((flightFrame.lengthM * 1000).toFixed(1)),
        RiserCount: waist.riserCount,
        MainReinforcement: `T${stairDesign.mainBarDiaMm}@${stairDesign.mainBarSpacingMm} mm c/c`,
        DistributionReinforcement: `T${stairDesign.distributionBarDiaMm}@${stairDesign.distributionBarSpacingMm} mm c/c`,
        UtilizationRatio: stairDesign.maxUtilization,
        DesignStatus: stairDesign.status,
      },
    });
    exportedStairCount++;
  }

  // 4. Export Physical Foundations
  for (const footing of foundationDesign.footings) {
    const raft = footing.typology === 'RIGID_RAFT';
    addProduct({
      type: raft ? 'IFCSLAB' : 'IFCFOOTING',
      subtype:
        raft
          ? '.BASESLAB.'
          : footing.typology === 'STRIP'
            ? '.STRIP_FOOTING.'
            : '.PAD_FOOTING.',
      id: footing.footingId,
      floorId: 'FOUNDATION',
      baseMm: [footing.centerXMm, -footing.centerYMm, -footing.excavationDepthM * 1000],
      body: extrude(rect(footing.lengthXMm, footing.widthYMm), footing.thicknessMm),
      properties: {
        PhysicalMemberId: footing.footingId,
        ScheduleGroupMark: footing.scheduleGroupMark,
        Typology: footing.typology,
        AnalysisFormulation: footing.analysisFormulation,
        MaxSoilPressureKPa: footing.maxSoilPressureKPa,
        AllowableSBCKPa: footing.allowableBearingPressureKPa,
        EstimatedSettlementMm: footing.estimatedSettlementMm,
        BottomMeshX: footing.bottomMeshXLabel,
        BottomMeshY: footing.bottomMeshYLabel,
        UtilizationRatio: footing.maxUtilization,
        DesignStatus: footing.status,
      },
    });
  }

  attachDesign(building, 'evaluation', {
    SolverBackend: snapshotSolverBackends(snapshot),
    DesignLifecycleStatus: snapshot.designLifecycleStatus,
    DrawingApprovalStatus: approvalStatus,
    ArchitecturalRevision: system.sourceArchitecturalRevision,
    ArchitecturalSha256: system.sourceArchitecturalSha256,
    StructuralRevision: system.structuralRevision,
    PhysicalColumnCount: rccDesign.columns.length,
    PhysicalBeamCount: rccDesign.beams.length,
    AnalyticalElementCount: system.elements.length,
    FoundationStatus: foundationDesign.status,
    OmittedSlabPanelCount: omittedSlabIds.length,
    ExportedStairWaistCount: exportedStairCount,
    OmittedStairWaistCount: omittedStairIds.length,
    NetConcreteVolumeM3: detailingAndBoq.quantities.netConcreteVolumeM3,
    TotalRebarWeightKg: detailingAndBoq.quantities.totalSteelWeightKg,
  });

  for (const [id, storey] of storeys) {
    if (storey.products.length) {
      step.add(
        'IFCRELCONTAINEDINSPATIALSTRUCTURE',
        guid('containment', id),
        '$',
        '$',
        '$',
        stepList(storey.products),
        storey.entity,
      );
    }
  }
  return new TextDecoder().decode(
    step.encode('RH Planner IFC4 structural exchange', projectName + '.ifc'),
  );
}

/**
 * Exports a complete, revision-bound Carbon 4 Engineering Analysis, Design, Reinforcement & Audit JSON Report (`Section 07`).
 */
export function exportStructuralEngineeringJsonReport(
  snapshot: FullStructuralEvaluationSnapshot,
  projectName = 'RH Planner Structural Project',
  reviewedInputs?: ReviewedStructuralInputs,
  regeneration?: StructuralRegenerationSummary,
): string {
  const { system, loadTakeoff, solveEnvelope, storeyDriftChecks, rccDesign, foundationDesign, detailingAndBoq, defects, unsupportedChecks } = snapshot;
  function reportCases(cases: AnalyticalSolveEnvelope['combinationResults']) {
    return Object.fromEntries(Object.entries(cases).map(([id, { memberForces, ...result }]) => [
      id,
      {
        ...result,
        memberForces: memberForces.map(({ elementId, localEndActionsKnM, extrema }) => ({
          elementId, localEndActionsKnM, extrema,
        })),
      },
    ]));
  }
  const comboDiagnostics = Object.fromEntries(
    Object.entries(solveEnvelope.combinationResults).map(([id, res]) => [
      id,
      {
        name: res.name,
        executionBackend: res.diagnostics.executionBackend,
        solveDurationMs: res.diagnostics.solveDurationMs,
        equilibrium: res.equilibrium,
      },
    ]),
  );

  const report = {
    reportSchema: 'RH_PLANNER_CARBON4_STRUCTURAL_REPORT_V1',
    generatedAt: new Date().toISOString(),
    project: {
      projectName,
      projectId: system.projectId,
      buildingId: system.buildingId,
      sourceArchitecturalRevision: system.sourceArchitecturalRevision,
      sourceArchitecturalSha256: system.sourceArchitecturalSha256,
      structuralRevision: system.structuralRevision,
      structuralModelFingerprint: stableValueHash(system),
      engineeringInputsFingerprint: reviewedInputs ? stableValueHash(reviewedInputs) : null,
    },
    provenanceAndCapabilities: {
      activeSolverBackends: snapshotSolverBackends(snapshot),
      activeSectionCapacityBackend: snapshot.sectionCapacityBackend ?? 'RH_IS456_ANALYTICAL',
      solverCapabilityRegistry: CARBON4_SOLVER_CAPABILITY_REGISTRY,
      sectionCapabilityRegistry: CARBON4_SECTION_CAPABILITY_REGISTRY,
    },
    lifecycleAndApproval: {
      designLifecycleStatus: snapshot.designLifecycleStatus,
      carbon4LifecycleStatus: snapshot.carbon4LifecycleStatus ?? snapshot.designLifecycleStatus,
      drawingApprovalStatus: snapshotDrawingApprovalStatus(snapshot),
      disclaimer: MANDATORY_STRUCTURAL_DISCLAIMER,
    },
    modelSummary: {
      storeys: system.storeys,
      analyticalNodeCount: system.nodes.length,
      analyticalElementCount: system.elements.length,
      physicalColumnCount: system.physicalModel.columns.length,
      physicalBeamCount: system.physicalModel.beams.length,
      physicalSlabCount: system.physicalModel.slabs.length,
      physicalStairWaistCount: system.physicalModel.stairWaists.length,
      physicalFoundationCount: foundationDesign.physicalFoundations.length,
    },
    reviewedInputs: reviewedInputs ?? null,
    regeneration,
    analyticalGeometry: { nodes: system.nodes, elements: system.elements },
    analysisResults: {
      ...solveEnvelope,
      loadCaseResults: reportCases(solveEnvelope.loadCaseResults),
      combinationResults: reportCases(solveEnvelope.combinationResults),
    },
    loadsAndLoadPaths: {
      loadTakeoff,
      combinationEquilibriumAudit: comboDiagnostics,
    },
    seismicAndDriftChecks: {
      seismicSummary: loadTakeoff.seismicSummary ?? null,
      storeyDriftChecks,
    },
    rccDesignSummary: {
      allPassed: rccDesign.allPassed,
      failedMemberCount: rccDesign.failedMemberCount,
      unsupportedMemberCount: rccDesign.unsupportedMemberCount,
      columns: rccDesign.columns,
      beams: rccDesign.beams,
      slabs: rccDesign.slabs,
      stairs: rccDesign.stairs,
    },
    foundationDesignSummary: foundationDesign,
    reinforcementAndQuantities: {
      quantities: detailingAndBoq.quantities,
      massReconciliationAudit: detailingAndBoq.quantities.massReconciliationAudit ?? null,
      canonicalReinforcement: detailingAndBoq.canonicalReinforcement ?? null,
      bbsEntries: detailingAndBoq.bbsEntries,
    },
    defectWarningAndUnsupportedRegister: {
      criticalOrMajorCount: snapshot.criticalDefectCount,
      maxMemberUtilization: snapshot.maxMemberUtilization,
      unsupportedChecks,
      architecturalClashes: system.clashes,
      defects,
    },
  };

  return `${JSON.stringify(report)}\n`;
}

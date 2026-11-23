import { isPhysicalBoundary, architecturalSpaceRole } from '@ai-floor-planner/core';
import * as acad from "@node-projects/acad-ts";
import { createHash } from "node:crypto";
import {
  canonicalRevisionJson,
  MEP_CAD_LAYER_COLORS,
  validateBuildingSchema,
  type Building,
  type Floor,
  type FloorMepEngineeringPlan,
  type Point,
  type ResidentialCadOptions,
  type ResidentialCadSheetMetadata,
} from "@ai-floor-planner/core";
import {
  canonicalStairSolids,
  polygonArea,
  polygonCentroid,
  polygonBoundingBox,
  wallToPolygon,
  columnFootprint,
  beamFootprint,
  segmentFootprint,
  pointInPolygon,
  projectOnSegment,
  hardeningOverlapArea,
  uncoveredResidentialOverlap,
  measureApartmentAreaLedger,
  measureUnitCarpetAreas,
  measureClearRoom,
  containsPolygon,
  textBoxesOverlap,
  type TextBox,
} from "@ai-floor-planner/geometry-engine";
import { verifyCadArtifact } from "../services/artifact-verifier.js";
import {
  ExportError,
  selectExportFloors,
} from "../services/export-selection.js";
export const RESIDENTIAL_CAD_LAYERS = {
  "A-WALL-EXTR": 11,
  "A-GUARD": 32,
  "A-STAIR": 8,
  "A-WALL-INTR": 252,
  "S-COLS": 5,
  "S-BEAM": 4,
  "S-GRID": 8,
  "A-DOOR": 2,
  "A-WIND": 2,
  "A-CHAJJA": 8,
  "A-FLOR-BALC": 3,
  "A-BALC": 3,
  "A-ANNO-TEXT": 1,
  "A-ANNO-DIMS": 7,
  "A-PARK-STAL": 6,
  "A-SLAB": 9,
  "S-FOOT-DIAG": 8,
  "S-PEDESTAL-DIAG": 9,
  ...MEP_CAD_LAYER_COLORS,
} as const;
/** Display rounding only. Geometry, dimensions and area acceptance always retain raw millimetres. */
export function residentialImperial(mm: number): string {
  const inches = Math.round(mm / 25.4);
  return `${Math.floor(inches / 12)}'-${inches % 12}"`;
}
const signature = (f: Floor) =>
  f.columns
    .map((c) => `${c.position.x}:${c.position.y}:${c.width}:${c.depth}`)
    .sort()
    .join("|");
export function assertResidentialCadSource(building: Building) {
  if (building.floors.length < 2)
    throw new ExportError(
      "INVALID_RESIDENTIAL_ASSEMBLY",
      "Physical multistory canonical floors required",
    );
  const ref = building.floors[0]!;
  if (!ref.columns.length)
    throw new ExportError(
      "MISSING_STRUCTURAL_MEMBERS",
      "Canonical columns are required; exports do not invent supports",
    );
  for (const f of building.floors) {
    if (
      signature(f) !== signature(ref) ||
      new Set(f.columns.map((c) => `${c.position.x}:${c.position.y}`)).size !==
        f.columns.length
    )
      throw new ExportError(
        "COLUMN_CONTINUITY_FAILED",
        `Column coordinates/sections differ or duplicate on ${f.id}`,
      );
    const ledger = measureApartmentAreaLedger(f);
    if (
      !ledger.supported ||
      !Number.isFinite(ledger.delta) ||
      Math.abs(ledger.delta) >= 0.001 ||
      ledger.unassigned >= 0.001 ||
      ledger.overlap >= 0.001 ||
      ledger.roomVoidOverlap >= 0.001
    )
      throw new ExportError(
        "SOURCE_PLANAR_GATE_FAILED",
        `Invalid raw partition on ${f.id}`,
      );
    for (const r of f.rooms.filter((r) =>
      ["balcony", "utility"].includes(r.type),
    ))
      for (const c of f.columns)
        if (
          uncoveredResidentialOverlap(
            columnFootprint(c),
            r.boundary,
            f.walls.map(wallToPolygon),
          ) >= 0.001
        )
          throw new ExportError(
            "BALCONY_COLUMN_INTERSECTION",
            `${c.id} intrudes into ${r.id}`,
          );
  }
}
export class ResidentialCadSerializer {
  serialize(building: Building, options: ResidentialCadOptions) {
    const format = "dxf" as const;
    if (!["A", "B"].includes(options.standard))
      throw new ExportError(
        "INVALID_CAD_STANDARD",
        "Residential standard must be A or B",
        400,
      );
    const schemaErrors = validateBuildingSchema(building);
    if (schemaErrors.length)
      throw new ExportError(
        "INVALID_BUILDING",
        JSON.stringify(schemaErrors.slice(0, 8)),
        400,
      );
    const floors = selectExportFloors(building, {
      floorId: options.floorId,
      exportScope: options.combined ? "all_floors" : "current_floor",
    });
    assertResidentialCadSource(building);
    const doc = new acad.CadDocument(acad.ACadVersion.AC1032),
      style = new acad.TextStyle("ARGON_RESIDENTIAL");
    doc.textStyles!.add(style);
    doc.header!.insUnits = acad.UnitsType.Millimeters;
    doc.header!.measurementUnits = acad.MeasurementUnits.Metric;
    doc.header!.showModelSpace = true;
    doc.header!.tileModeEnabled = true;
    doc.header!.splineType = 6;
    doc.header!.codePage = "UTF-8";
    const center = new acad.LineType("CENTER2");
    center.description = "Center (.5x) ____ _ ____ _ ____";
    for (const length of [19.05, -3.175, 3.175, -3.175]) {
      const part = new acad.LineTypeSegment();
      part.length = length;
      center.addSegment(part);
    }
    doc.lineTypes!.add(center);
    const layers = new Map<string, acad.Layer>();
    for (const [name, aci] of Object.entries(RESIDENTIAL_CAD_LAYERS)) {
      const l = new acad.Layer(name);
      l.color = new acad.Color(aci);
      if (name === "S-GRID") l.lineType = center;
      doc.layers!.add(l);
      layers.set(name, l);
    }
    const layer = (name: string) => {
      const l = layers.get(name);
      if (!l) throw new Error(`Unregistered layer ${name}`);
      return l;
    };
    const boxes: TextBox[] = [],
      extent: Point[] = [];
    const add = (
      entity: acad.Entity,
      name: string,
      block?: acad.BlockRecord,
    ) => {
      entity.layer = layer(name);
      if (name === "S-GRID") entity.lineTypeScale = 30;
      (block?.entities ?? doc.entities!).add(entity);
    };
    const line = (
      a: Point,
      b: Point,
      name: string,
      block?: acad.BlockRecord,
    ) => {
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite))
        throw new ExportError("NONFINITE_CAD_ENTITY", "Nonfinite line");
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-7) return;
      add(
        new acad.Line(new acad.XYZ(a.x, a.y, 0), new acad.XYZ(b.x, b.y, 0)),
        name,
        block,
      );
      extent.push(a, b);
    };
    const poly = (points: readonly Point[], name: string, solid = false) => {
      if (
        points.length < 3 ||
        points.some((p) => ![p.x, p.y].every(Number.isFinite))
      )
        throw new ExportError("INVALID_CAD_POLYGON", "Invalid entity boundary");
      const q = new acad.LwPolyline();
      q.isClosed = true;
      points.forEach((p) =>
        q.vertices.push(new acad.LwPolylineVertex(new acad.XY(p.x, p.y))),
      );
      add(q, name);
      extent.push(...points);
      if (solid && points.length === 4) {
        const p = points.map((p) => new acad.XYZ(p.x, p.y, 0));
        add(new acad.Solid(p[0], p[1], p[3], p[2]), name);
      }
    };
    const text = (
      value: string,
      p: Point,
      height: number,
      name = "A-ANNO-TEXT",
      block?: acad.BlockRecord,
    ) => {
      const box = {
        x: p.x,
        y: p.y,
        width: value.length * height * 0.7,
        height: height * 1.2,
        text: value,
      };
      if (
        !Number.isFinite(height) ||
        height <= 0 ||
        boxes.some((b) => textBoxesOverlap(b, box))
      )
        throw new ExportError(
          "CAD_ANNOTATION_COLLISION",
          `No collision-free annotation for ${value}`,
        );
      const e = new acad.TextEntity(value);
      e.style = style;
      e.height = height;
      e.insertPoint = new acad.XYZ(p.x, p.y, 0);
      e.alignmentPoint = new acad.XYZ(p.x, p.y, 0);
      e.horizontalAlignment = 1;
      e.verticalAlignment = 2;
      add(e, name, block);
      boxes.push(box);
      extent.push(
        { x: p.x - box.width / 2, y: p.y - box.height / 2 },
        { x: p.x + box.width / 2, y: p.y + box.height / 2 },
      );
    };
    const all = building.floors.flatMap((f) => f.boundary.points),
      body = polygonBoundingBox({ points: all }),
      panelWidth = body.width + 23000;
    const metadata: ResidentialCadSheetMetadata = {
      standard: options.standard,
      buildingId: building.id,
      revision: building.version,
      revisionHash: createHash("sha256")
        .update(canonicalRevisionJson(building))
        .digest("hex"),
      floorIds: floors.map((f) => f.id),
      transforms: [],
      areas: [],
      columnSchedule: [],
      areaConventions: {
        gross: "CANONICAL_CENTERLINE_GROSS",
        carpet: "UNIT_USABLE_PLUS_INTERNAL_PARTITIONS",
        slab: "FLOOR_BOUNDARY_MINUS_EXPLICIT_VOIDS",
      },
      openingHandedness: "SCHEMATIC_LEFT_JAMB",
      annotationOmissions: [],
      structuralAnalysis: "NOT_RUN",
      foundationSizing: "NOT_PROVIDED",
      professionalReviewRequired: true,
    };
    const transforms: {
        floorId: string;
        translation: Point;
        yAxis: "NEGATED";
      }[] = [],
      areas: {
        floorId: string;
        grossMm2: number;
        carpetMm2: number;
        slabMm2: number;
      }[] = [],
      schedule: ResidentialCadSheetMetadata["columnSchedule"][number][] = [],
      omissions: { roomId: string; reason: string }[] = [];
    const base = [...building.floors[0]!.columns].sort(
      (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
    );
    const xs = [...new Set(base.map((c) => c.position.x))].sort(
        (a, b) => a - b,
      ),
      ys = [...new Set(base.map((c) => c.position.y))].sort((a, b) => a - b);
    const axisName = (i: number): string =>
      i < 26
        ? String.fromCharCode(65 + i)
        : axisName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
    for (const [panel, floor] of floors.entries()) {
      const shift = { x: panel * panelWidth, y: 0 },
        cad = (p: Point): Point => ({ x: p.x + shift.x, y: -p.y + shift.y });
      transforms.push({
        floorId: floor.id,
        translation: shift,
        yAxis: "NEGATED",
      });
      const bounds = polygonBoundingBox(floor.boundary),
        left = bounds.x + shift.x,
        right = left + bounds.width,
        top = -bounds.y,
        bottom = top - bounds.height;
      const ledger = measureApartmentAreaLedger(floor),
        carpet = measureUnitCarpetAreas(floor, ledger).reduce(
          (s, u) => s + u.areaMm2,
          0,
        );
      areas.push({
        floorId: floor.id,
        grossMm2: ledger.gross,
        carpetMm2: carpet,
        slabMm2: polygonArea(floor.boundary) - ledger.void,
      });
      poly(floor.boundary.points.map(cad), "A-SLAB");
      text(
        `STANDARD ${options.standard} | ${floor.name.toUpperCase()} | REV ${building.version}`,
        { x: (left + right) / 2, y: top + 4000 },
        180,
      );
      const areaLine = (name: string, mm2: number) =>
        `${name}: ${(mm2 / 1e6).toFixed(3)} SQ.M. | ${(mm2 / 92903.04).toFixed(3)} SQ.FT.`;
      const footer = [
        areaLine("BUILT-UP (CANONICAL GROSS)", ledger.gross),
        areaLine("CARPET (MEASURED UNIT INTERIORS + PARTITIONS)", carpet),
        areaLine(
          "SLAB (BOUNDARY LESS EXPLICIT VOIDS)",
          polygonArea(floor.boundary) - ledger.void,
        ),
        "PROVISIONAL GEOMETRY | STRUCTURAL ANALYSIS NOT RUN | PROFESSIONAL REVIEW REQUIRED",
        ...(options.standard === "A"
          ? ["DOOR HINGE HAND UNSPECIFIED / SWINGS ARE SCHEMATIC - VERIFY"]
          : []),
      ];
      footer.forEach((s, i) =>
        text(s, { x: (left + right) / 2, y: bottom - 5500 - i * 500 }, 120),
      );
      if (options.standard === "A") {
        const arcCenterByGroup = (w: Floor["walls"][number]) => {
          if (!w.arc || !(w.arc.radiusMm > 0)) return undefined;
          const cadCenter = cad(w.arc.center);
          const cadStart = cad(w.startPoint);
          const cadEnd = cad(w.endPoint);
          if (![cadCenter.x, cadCenter.y, cadStart.x, cadStart.y, cadEnd.x, cadEnd.y].every(Number.isFinite)) return undefined;
          const a0 = Math.atan2(cadStart.y - cadCenter.y, cadStart.x - cadCenter.x);
          const a1 = Math.atan2(cadEnd.y - cadCenter.y, cadEnd.x - cadCenter.x);
          let startRad = a0;
          let endRad = a1;
          if ((endRad - startRad + 2 * Math.PI) % (2 * Math.PI) > Math.PI) {
            startRad = a1;
            endRad = a0;
          }
          return { center: cadCenter, radius: w.arc.radiusMm, startRad, endRad };
        };
        for (const wall of floor.walls.filter(isPhysicalBoundary)) {
          const wallArc = arcCenterByGroup(wall);
          const isBalconyWall = wall.wallUse === "BALCONY" || wall.boundaryRole === "PARAPET" || wall.boundaryRole === "GUARDRAIL";
          if (wall.boundaryRole === "PARAPET" || wall.boundaryRole === "GUARDRAIL") {
            if (wallArc) {
              add(new acad.Arc(new acad.XYZ(wallArc.center.x, wallArc.center.y, 0), wallArc.radius, wallArc.startRad, wallArc.endRad), "A-BALC");
            }
            line(cad(wall.startPoint), cad(wall.endPoint), "A-GUARD");
            continue;
          }
          if (wallArc) {
            const arcLayer = isBalconyWall ? "A-BALC" : "A-WALL-EXTR";
            add(new acad.Arc(new acad.XYZ(wallArc.center.x, wallArc.center.y, 0), wallArc.radius, wallArc.startRad, wallArc.endRad), arcLayer);
          }
          const q = projectOnSegment(
            wall.startPoint,
            wall.startPoint,
            wall.endPoint,
          );
          if (!q) throw new ExportError("DEGENERATE_WALL", wall.id);
          const holes = [...floor.doors, ...floor.windows]
            .filter((o) => o.wallId === wall.id)
            .map((o) => {
              const p = projectOnSegment(
                o.position,
                wall.startPoint,
                wall.endPoint,
              )!;
              return [
                Math.max(0, p.along - o.width / 2),
                Math.min(q.length, p.along + o.width / 2),
              ] as [number, number];
            })
            .sort((a, b) => a[0] - b[0]);
          const spans: [number, number][] = [];
          let cursor = 0;
          for (const [a, b] of holes) {
            if (a > cursor) spans.push([cursor, a]);
            cursor = Math.max(cursor, b);
          }
          if (cursor < q.length) spans.push([cursor, q.length]);
          for (const [a, b] of spans)
            if (b - a > 1e-6)
              poly(
                segmentFootprint(
                  q.pointAt(a),
                  q.pointAt(b),
                  wall.thickness,
                ).points.map(cad),
                wall.type === "external" ||
                  wall.wallUse === "EXTERNAL" ||
                  wall.wallUse === "UNIT_SEPARATION"
                  ? "A-WALL-EXTR"
                  : "A-WALL-INTR",
                true,
              );
        }
        for (const r of floor.rooms) {
          if (["balcony", "utility"].includes(r.type)) {
            poly(r.boundary.points.map(cad), "A-FLOR-BALC");
            if (r.curvedEdges?.length) {
              poly(r.boundary.points.map(cad), "A-BALC");
            }
          }
          const stall = r.type === "parking" && /^C[- ]?\d+/i.test(r.name);
          if (stall) {
            poly(r.boundary.points.map(cad), "A-PARK-STAL");
            const b = polygonBoundingBox(r.boundary);
            for (let i = 1; i < 5; i++)
              line(
                cad({ x: b.x, y: b.y + (i * b.height) / 5 }),
                cad({ x: b.x + 250, y: b.y + (i * b.height) / 5 - 250 }),
                "A-PARK-STAL",
              );
          }
          if (
            r.tags.includes("STILT_CIRCULATION") ||
            r.name.startsWith("Stilt circulation")
          ) {
            omissions.push({
              roomId: r.id,
              reason:
                "Open circulation partition cell; actual stalls and aisle are labelled instead",
            });
            continue;
          }
          const centerPoint = polygonCentroid(r.boundary),
            clear = measureClearRoom(floor, r),
            dimensions = clear
              ? `${residentialImperial(clear.width)} x ${residentialImperial(clear.height)}`
              : `${residentialImperial(r.width)} x ${residentialImperial(r.height)} (ENVELOPE)`;
          const roomName =
            r.type === "custom"
              ? r.name.toUpperCase()
              : r.type.toUpperCase().replace(/_/g, " ");
          const label = `${stall ? r.name : roomName} ${dimensions}`;
          const widths = clear?.width ?? r.width,
            heights = clear?.height ?? r.height;
          let h = Math.min(
              120,
              (widths * 0.7) / (label.length * 0.7),
              heights / 5,
            ),
            chosen = false;
          for (let attempt = 0; attempt < 30 && h >= 2; attempt++, h *= 0.8) {
            const w = label.length * h * 0.7,
              d = h * 1.2;
            const box = {
              points: [
                { x: centerPoint.x - w / 2, y: centerPoint.y - d / 2 },
                { x: centerPoint.x + w / 2, y: centerPoint.y - d / 2 },
                { x: centerPoint.x + w / 2, y: centerPoint.y + d / 2 },
                { x: centerPoint.x - w / 2, y: centerPoint.y + d / 2 },
              ],
            };
            if (
              containsPolygon(r.boundary, box) &&
              !floor.walls.some(
                (w) => hardeningOverlapArea(box, wallToPolygon(w)) >= 0.001,
              ) &&
              !floor.columns.some(
                (c) => hardeningOverlapArea(box, columnFootprint(c)) >= 0.001,
              )
            ) {
              text(label, cad(centerPoint), h);
              chosen = true;
              break;
            }
          }
          if (!chosen) {
            const xsR = r.boundary.points.map((p) => p.x);
            const ysR = r.boundary.points.map((p) => p.y);
            const minXR = Math.min(...xsR), maxXR = Math.max(...xsR);
            const minYR = Math.min(...ysR), maxYR = Math.max(...ysR);
            const midR = { x: (minXR + maxXR) / 2, y: (minYR + maxYR) / 2 };
            const dxR = (maxXR - minXR) * 0.22;
            const dyR = (maxYR - minYR) * 0.22;
            const anchors: Point[] = [
              midR,
              { x: centerPoint.x - dxR, y: centerPoint.y },
              { x: centerPoint.x + dxR, y: centerPoint.y },
              { x: centerPoint.x, y: centerPoint.y - dyR },
              { x: centerPoint.x, y: centerPoint.y + dyR },
              { x: midR.x - dxR, y: midR.y - dyR },
              { x: midR.x + dxR, y: midR.y + dyR },
            ];
            const candLabels = [
              label,
              roomName,
              r.type === "bathroom" ? "WC" : roomName.slice(0, 6),
            ];
            outerFallback: for (const candLabel of candLabels) {
              for (const anchor of anchors) {
                let hf = Math.min(
                  90,
                  (widths * 0.65) / (candLabel.length * 0.7),
                  heights / 4,
                );
                for (let attempt = 0; attempt < 25 && hf >= 2; attempt++, hf *= 0.8) {
                  const wf = candLabel.length * hf * 0.7;
                  const df = hf * 1.2;
                  const box = {
                    points: [
                      { x: anchor.x - wf / 2, y: anchor.y - df / 2 },
                      { x: anchor.x + wf / 2, y: anchor.y - df / 2 },
                      { x: anchor.x + wf / 2, y: anchor.y + df / 2 },
                      { x: anchor.x - wf / 2, y: anchor.y + df / 2 },
                    ],
                  };
                  if (
                    containsPolygon(r.boundary, box) &&
                    !floor.walls.some(
                      (w) => hardeningOverlapArea(box, wallToPolygon(w)) >= 0.001,
                    ) &&
                    !floor.columns.some(
                      (c) => hardeningOverlapArea(box, columnFootprint(c)) >= 0.001,
                    )
                  ) {
                    text(candLabel, cad(anchor), hf);
                    chosen = true;
                    break outerFallback;
                  }
                }
              }
            }
          }
          if (!chosen) {
            if (
              r.unitId &&
              ["living", "bedroom", "kitchen", "bathroom"].includes(r.type)
            )
              throw new ExportError("CAD_LABEL_INFEASIBLE", r.id);
            omissions.push({
              roomId: r.id,
              reason:
                "No clear centroid annotation envelope; nonhabitable boundary is retained",
            });
          }
        }
        const floorCoordinatedChajjas =
          building.metadata?.generationBrief?.includeWindowChajjas !== false
            ? (building.metadata?.facadeCoordination?.chajjaBands ?? []).filter(
                (b) => b.floorId === floor.id,
              )
            : [];
        const coveredChajjaWindowIds = new Set<string>();
        for (const band of floorCoordinatedChajjas) {
          for (const wid of band.windowIds) coveredChajjaWindowIds.add(wid);
          const proj = band.projectionMm || 600;
          const n = band.outwardNormal;
          poly(
            [
              band.startPoint,
              band.endPoint,
              { x: band.endPoint.x + n.x * proj, y: band.endPoint.y + n.y * proj },
              { x: band.startPoint.x + n.x * proj, y: band.startPoint.y + n.y * proj },
            ].map(cad),
            "A-CHAJJA",
          );
        }
        for (const opening of [...floor.doors, ...floor.windows].filter(o => floor.walls.some(w => w.id === o.wallId && isPhysicalBoundary(w)))) {
          const wall = floor.walls.find((w) => w.id === opening.wallId);
          if (!wall) throw new ExportError("UNHOSTED_OPENING", opening.id);
          const p = projectOnSegment(
            opening.position,
            wall.startPoint,
            wall.endPoint,
          );
          if (
            !p ||
            p.distance > wall.thickness / 2 + 0.001 ||
            p.along - opening.width / 2 < -0.001 ||
            p.along + opening.width / 2 > p.length + 0.001
          )
            throw new ExportError("OPENING_OUTSIDE_HOST", opening.id);
          const a = p.pointAt(p.along - opening.width / 2),
            b = p.pointAt(p.along + opening.width / 2),
            isDoor = floor.doors.some((d) => d.id === opening.id),
            name = isDoor ? "A-DOOR" : "A-WIND";
          poly(segmentFootprint(a, b, wall.thickness).points.map(cad), name);
          if (!isDoor) {
            line(cad(a), cad(b), name);
            if (
              building.metadata?.generationBrief?.includeWindowChajjas !== false &&
              !coveredChajjaWindowIds.has(opening.id) &&
              p.length > 0
            ) {
              const ux = (wall.endPoint.x - wall.startPoint.x) / p.length,
                uy = (wall.endPoint.y - wall.startPoint.y) / p.length;
              const nA = { x: -uy, y: ux },
                nB = { x: uy, y: -ux };
              const probeDist = wall.thickness / 2 + 120;
              const midPt = p.pointAt(p.along);
              const isOutsideBuilt = (pt: Point) =>
                !floor.rooms.some(
                  (r) => architecturalSpaceRole(r) !== "OPEN_TO_SKY_VOID" && !r.tags?.includes("recess:perimeter") && pointInPolygon(pt, r.boundary),
                );
              const probeA = { x: midPt.x + nA.x * probeDist, y: midPt.y + nA.y * probeDist },
                probeB = { x: midPt.x + nB.x * probeDist, y: midPt.y + nB.y * probeDist };
              const outA = isOutsideBuilt(probeA) || !pointInPolygon(probeA, floor.boundary);
              const outB = isOutsideBuilt(probeB) || !pointInPolygon(probeB, floor.boundary);
              const isExtOrShaft =
                wall.wallUse === "EXTERNAL" ||
                wall.wallUse === "SHAFT" ||
                wall.type === "external" ||
                wall.roomIds.length <= 1 ||
                outA !== outB;
              if (isExtOrShaft && (outA || outB)) {
                const outN = !pointInPolygon(probeA, floor.boundary)
                  ? nA
                  : !pointInPolygon(probeB, floor.boundary)
                    ? nB
                    : outA && !outB
                      ? nA
                      : nB;
                const halfChajjaW = opening.width / 2 + 150;
                const cA = { x: midPt.x - ux * halfChajjaW, y: midPt.y - uy * halfChajjaW },
                  cB = { x: midPt.x + ux * halfChajjaW, y: midPt.y + uy * halfChajjaW };
                const innerOff = wall.thickness / 2,
                  outerOff = innerOff + 600;
                poly(
                  [
                    { x: cA.x + outN.x * innerOff, y: cA.y + outN.y * innerOff },
                    { x: cB.x + outN.x * innerOff, y: cB.y + outN.y * innerOff },
                    { x: cB.x + outN.x * outerOff, y: cB.y + outN.y * outerOff },
                    { x: cA.x + outN.x * outerOff, y: cA.y + outN.y * outerOff },
                  ].map(cad),
                  "A-CHAJJA",
                );
              }
            }
            continue;
          }
          const door = floor.doors.find((d) => d.id === opening.id)!;
          if (["sliding", "open_passage"].includes(door.type)) {
            if (door.type === "sliding")
              line(cad(a), cad(p.pointAt(p.along)), name);
            continue;
          }
          const dx = (b.x - a.x) / opening.width,
            dy = (b.y - a.y) / opening.width;
          const target = floor.rooms.find(
              (r) => r.id === door.connectsRooms[1],
            ),
            centerRoom = target
              ? polygonCentroid(target.boundary)
              : { x: opening.position.x - dy, y: opening.position.y + dx };
          let side =
            -dy * (centerRoom.x - opening.position.x) +
              dx * (centerRoom.y - opening.position.y) >=
            0
              ? 1
              : -1;
          if (door.openingGeometryVersion === 1) side = ["outward","left"].includes(door.swingDirection) ? -1 : 1;
          else if (door.swingDirection === "outward") side *= -1;
          const leaf = {
            x: a.x - side * dy * opening.width,
            y: a.y + side * dx * opening.width,
          };
          line(cad(a), cad(leaf), name);
          const hinge = cad(a),
            closed = cad(b),
            open = cad(leaf),
            u = Math.atan2(closed.y - hinge.y, closed.x - hinge.x),
            v = Math.atan2(open.y - hinge.y, open.x - hinge.x);
          let start = u,
            end = v;
          if ((end - start + 2 * Math.PI) % (2 * Math.PI) > Math.PI) {
            start = v;
            end = u;
          }
          const arc = new acad.Arc(
            new acad.XYZ(hinge.x, hinge.y, 0),
            opening.width,
            start,
            end,
          );
          add(arc, name);
        }
        for (const stair of floor.canonicalStaircases ?? []) {
          for (const part of canonicalStairSolids(stair, floor.floorHeight, floor.slabThicknessMm).filter(p => floor.floorUse !== "ROOF" || p.top === 0))
            poly(part.boundary.points.map(cad), "A-STAIR");
          if (floor.floorUse !== "ROOF") {
            const midC = polygonCentroid(stair.midLanding);
            const flC = stair.floorLanding ? polygonCentroid(stair.floorLanding) : polygonCentroid(stair.polygon);
            const f1C = polygonCentroid(stair.flight1);
            const f2C = polygonCentroid(stair.flight2);
            const dx = midC.x - flC.x, dy = midC.y - flC.y, len = Math.hypot(dx, dy);
            if (len > 100) {
              const ux = dx / len, uy = dy / len;
              const f1Box = polygonBoundingBox(stair.flight1);
              const runHalf = Math.max(150, (Math.abs(ux) > Math.abs(uy) ? f1Box.width : f1Box.height) * 0.34);
              line(cad({ x: f1C.x - ux * runHalf, y: f1C.y - uy * runHalf }), cad({ x: f1C.x + ux * runHalf, y: f1C.y + uy * runHalf }), "A-STAIR");
              line(cad({ x: f2C.x + ux * runHalf, y: f2C.y + uy * runHalf }), cad({ x: f2C.x - ux * runHalf, y: f2C.y - uy * runHalf }), "A-STAIR");
            }
          }
        }
        if (floor.floorUse === "STILT_PARKING")
          for (const drive of building.site.siteZones?.filter(
            (z) => z.regulatoryUse === "DRIVEWAY",
          ) ?? []) {
            const b = polygonBoundingBox(drive.boundary),
              p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
            line(
              cad({ x: p.x, y: p.y - 800 }),
              cad({ x: p.x, y: p.y + 800 }),
              "A-PARK-STAL",
            );
            text(
              `AISLE ${(Math.min(b.width, b.height) / 1000).toFixed(2)} m (MIN 3.00 m)`,
              cad({ x: p.x + 1000, y: p.y }),
              100,
              "A-PARK-STAL",
            );
          }
      }
      for (const c of floor.columns) {
        poly(columnFootprint(c).points.map(cad), "S-COLS", true);
      }
      const floorMep: FloorMepEngineeringPlan | undefined =
        building.mepEngineering?.floors.find((m) => m.floorId === floor.id);
      if (floorMep) {
        for (const cb of floorMep.cantileverBeams) {
          line(cad(cb.start), cad(cb.end), "S-BEAM-CANTILEVER");
          const dx = cb.end.x - cb.start.x;
          const dy = cb.end.y - cb.start.y;
          const len = Math.hypot(dx, dy);
          if (len > 1) {
            const hw = (cb.widthMm || 230) / 2;
            const nx = (-dy / len) * hw;
            const ny = (dx / len) * hw;
            poly(
              [
                cad({ x: cb.start.x + nx, y: cb.start.y + ny }),
                cad({ x: cb.end.x + nx, y: cb.end.y + ny }),
                cad({ x: cb.end.x - nx, y: cb.end.y - ny }),
                cad({ x: cb.start.x - nx, y: cb.start.y - ny }),
              ],
              "S-BEAM-CANTILEVER",
            );
          }
        }
        for (const cz of floorMep.ceilings) {
          if (cz.outline.length >= 3) {
            poly(cz.outline.map(cad), "A-CEIL-GRID");
          }
          for (const [a, b] of cz.gridLines ?? []) {
            line(cad(a), cad(b), "A-CEIL-GRID");
          }
        }
        for (const run of floorMep.runs) {
          for (let i = 0; i < run.points.length - 1; i++) {
            line(cad(run.points[i]!), cad(run.points[i + 1]!), run.layer);
          }
        }
        for (const sym of floorMep.symbols) {
          const cx = sym.position.x;
          const cy = sym.position.y;
          if (sym.widthMm && sym.depthMm) {
            const hw = sym.widthMm / 2;
            const hd = sym.depthMm / 2;
            const tl = { x: cx - hw, y: cy - hd };
            const tr = { x: cx + hw, y: cy - hd };
            const br = { x: cx + hw, y: cy + hd };
            const bl = { x: cx - hw, y: cy + hd };
            poly([cad(tl), cad(tr), cad(br), cad(bl)], sym.layer);
            line(cad(tl), cad(br), sym.layer);
            line(cad(tr), cad(bl), sym.layer);
          } else {
            const r = 120;
            poly(
              [
                cad({ x: cx, y: cy - r }),
                cad({ x: cx + r, y: cy }),
                cad({ x: cx, y: cy + r }),
                cad({ x: cx - r, y: cy }),
              ],
              sym.layer,
            );
            line(cad({ x: cx - r, y: cy }), cad({ x: cx + r, y: cy }), sym.layer);
            line(cad({ x: cx, y: cy - r }), cad({ x: cx, y: cy + r }), sym.layer);
          }
        }
      }
      if (options.standard === "B") {
        for (const beam of floor.beams ?? []) {
          line(cad(beam.startPoint), cad(beam.endPoint), "S-BEAM");
          poly(beamFootprint(beam).points.map(cad), "S-BEAM");
        }
        let lastLabelX = -Infinity;
        let xTier = 0;
        xs.forEach((x, i) => {
          line(
            cad({ x, y: bounds.y - 1000 }),
            cad({ x, y: bounds.y + bounds.height + 1000 }),
            "S-GRID",
          );
          if (x - lastLabelX < 240) xTier = (xTier + 1) % 3;
          else xTier = 0;
          lastLabelX = x;
          text(axisName(i), { x: x + shift.x, y: top + 1600 + xTier * 260 }, 140, "S-GRID");
        });
        let lastLabelY = -Infinity;
        let yTier = 0;
        ys.forEach((y, i) => {
          line(
            cad({ x: bounds.x - 1000, y }),
            cad({ x: bounds.x + bounds.width + 1000, y }),
            "S-GRID",
          );
          if (y - lastLabelY < 240) yTier = (yTier + 1) % 3;
          else yTier = 0;
          lastLabelY = y;
          text(String(i + 1), { x: left - 1500 - yTier * 320, y: -y }, 140, "S-GRID");
        });
        const block = new acad.BlockRecord(`ARGON_SCHEDULE_${panel}`);
        doc.blockRecords!.add(block);
        const tableX = right + 6500,
          tableY = top + 1000;
        text(
          "COLUMN SCHEDULE - PROVISIONAL SIZES",
          { x: tableX, y: tableY + 700 },
          140,
          "A-ANNO-TEXT",
          block,
        );
        const columns = [...floor.columns].sort(
          (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
        );
        const rows = [
          "ID | GRID | SECTION mm",
          ...columns.map(
            (c, i) =>
              `C${i + 1} | ${axisName(xs.indexOf(c.position.x))}/${ys.indexOf(c.position.y) + 1} | ${c.width} x ${c.depth}`,
          ),
        ];
        rows.forEach((value, i) => {
          text(
            value,
            { x: tableX, y: tableY - i * 400 },
            130,
            "A-ANNO-TEXT",
            block,
          );
          line(
            { x: tableX - 3000, y: tableY - i * 400 + 200 },
            { x: tableX + 3000, y: tableY - i * 400 + 200 },
            "A-ANNO-DIMS",
            block,
          );
        });
        line(
          { x: tableX - 3000, y: tableY + 200 },
          { x: tableX - 3000, y: tableY - rows.length * 400 + 200 },
          "A-ANNO-DIMS",
          block,
        );
        line(
          { x: tableX + 3000, y: tableY + 200 },
          { x: tableX + 3000, y: tableY - rows.length * 400 + 200 },
          "A-ANNO-DIMS",
          block,
        );
        const insert = new acad.Insert(block);
        insert.insertPoint = new acad.XYZ(0, 0, 0);
        add(insert, "A-ANNO-TEXT");
        const emittedFootingOutlines: { points: Point[] }[] = [];
        for (const [i, c] of columns.entries()) {
          const tag = `C${i + 1}`,
            grid = `${axisName(xs.indexOf(c.position.x))}/${ys.indexOf(c.position.y) + 1}`;
          schedule.push({
            columnId: c.id,
            tag,
            floorId: floor.id,
            grid,
            widthMm: c.width,
            depthMm: c.depth,
            sourcePosition: c.position,
          });
          const p = cad(c.position);
          text(tag, { x: p.x + 650, y: p.y + 650 }, 110);
          if (floor.floorUse === "STILT_PARKING") {
            let maxHalfX = c.width * 1.5;
            let maxHalfY = c.depth * 1.5;
            for (const o of columns) {
              if (o.id === c.id) continue;
              const dx = Math.abs(o.position.x - c.position.x);
              const dy = Math.abs(o.position.y - c.position.y);
              if (dy < maxHalfY + o.depth * 1.5 && dx > 0) {
                maxHalfX = Math.min(maxHalfX, Math.max(c.width * 0.52, dx / 2 - 25));
              }
              if (dx < maxHalfX + o.width * 1.5 && dy > 0) {
                maxHalfY = Math.min(maxHalfY, Math.max(c.depth * 0.52, dy / 2 - 25));
              }
            }
            for (const [factor, name] of [
              [2, "S-PEDESTAL-DIAG"],
              [3, "S-FOOT-DIAG"],
            ] as const) {
              const scaleCap = factor === 2 ? 0.72 : 1.0;
              let w = Math.min(c.width * factor, maxHalfX * 2 * scaleCap);
              let h = Math.min(c.depth * factor, maxHalfY * 2 * scaleCap);
              const makeOutline = (ow: number, oh: number) => ({
                points: [
                  { x: c.position.x - ow / 2, y: c.position.y - oh / 2 },
                  { x: c.position.x + ow / 2, y: c.position.y - oh / 2 },
                  { x: c.position.x + ow / 2, y: c.position.y + oh / 2 },
                  { x: c.position.x - ow / 2, y: c.position.y + oh / 2 },
                ],
              });
              let outline = makeOutline(w, h);
              if (factor === 3) {
                for (let shrink = 0; shrink < 8; shrink++) {
                  if (
                    !emittedFootingOutlines.some(
                      (prev) => hardeningOverlapArea(outline, prev) >= 0.001,
                    )
                  )
                    break;
                  w = Math.max(c.width * 1.05, w * 0.85);
                  h = Math.max(c.depth * 1.05, h * 0.85);
                  outline = makeOutline(w, h);
                }
                if (
                  emittedFootingOutlines.some(
                    (prev) => hardeningOverlapArea(outline, prev) >= 0.001,
                  )
                )
                  continue;
                emittedFootingOutlines.push(outline);
              }
              poly(outline.points.map(cad), name);
            }
          }
        }
        text(
          "FOOTING DIAGRAMS ONLY / NOT TO SCALE / FOUNDATION SIZING NOT PROVIDED",
          { x: (left + right) / 2, y: bottom - 4500 },
          110,
        );
      }
      // Editable line/text architectural dimensions and cumulative grid offsets, with ticks.
      const axis = (values: readonly number[], horizontal: boolean) => {
        const base = values[0]!;
        for (const [i, value] of values.entries()) {
          const p = horizontal
            ? { x: value + shift.x, y: bottom - 2000 }
            : { x: left - 2800, y: -value };
          line(
            { x: p.x - 100, y: p.y - 100 },
            { x: p.x + 100, y: p.y + 100 },
            "A-ANNO-DIMS",
          );
          const label = residentialImperial(value - base);
          const labelW = label.length * 100 * 0.7;
          const labelH = 100 * 1.2;
          let labelPos = horizontal
            ? { x: p.x, y: p.y - 350 }
            : { x: p.x - 1000, y: p.y };
          for (let tier = 0; tier < 10; tier++) {
            const cand = horizontal
              ? { x: p.x, y: p.y - 350 - tier * 240 }
              : { x: p.x - 1000 - tier * 800, y: p.y };
            const candBox = { x: cand.x, y: cand.y, width: labelW, height: labelH, text: label };
            if (!boxes.some((b) => textBoxesOverlap(b, candBox))) {
              labelPos = cand;
              break;
            }
          }
          text(
            label,
            labelPos,
            100,
            "A-ANNO-DIMS",
          );
          if (i > 0) {
            const prev = values[i - 1]!;
            const q = horizontal
              ? { x: prev + shift.x, y: bottom - 2000 }
              : { x: left - 2800, y: -prev };
            line(q, p, "A-ANNO-DIMS");
          }
        }
      };
      axis(xs, true);
      axis(ys, false);
    }
    const bounds = polygonBoundingBox({ points: extent });
    doc.header!.modelSpaceExtMin = new acad.XYZ(
      bounds.x - 1000,
      bounds.y - 1000,
      0,
    );
    doc.header!.modelSpaceExtMax = new acad.XYZ(
      bounds.x + bounds.width + 1000,
      bounds.y + bounds.height + 1000,
      0,
    );
    for (const v of doc.vPorts!) {
      v.center = new acad.XY(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      v.viewHeight = Math.max(bounds.height, bounds.width) * 1.15;
      v.aspectRatio = Math.max(bounds.width / bounds.height, 0.1);
    }
    let data: Uint8Array;
    {
      const chunks: string[] = [];
      const writer = new acad.DxfWriter(
        {
          write: (s: string) => {
            chunks.push(s);
          },
        },
        doc,
        false,
      );
      writer.configuration.writeOptionalValues = true;
      writer.configuration.writeAllHeaderVariables = false;
      for (const variable of [
        "$TILEMODE",
        "$EXTMIN",
        "$EXTMAX",
        "$INSUNITS",
        "$SPLINETYPE",
      ])
        writer.configuration.addHeaderVariable(variable);
      writer.write();
      data = Buffer.from(chunks.join(""), "utf8");
    }
    const finalMetadata: ResidentialCadSheetMetadata = {
      ...metadata,
      transforms,
      areas,
      columnSchedule: schedule,
      annotationOmissions: omissions,
    };
    const verification = verifyResidentialCadDrawing(
      data,
      format,
      finalMetadata,
      doc,
    );
    if (!verification.isValid)
      throw new ExportError(
        "RESIDENTIAL_CAD_ROUNDTRIP_FAILED",
        verification.errors.join("; "),
      );
    return {
      data,
      metadata: finalMetadata,
      verification,
      bounds,
      layerNames: Object.keys(RESIDENTIAL_CAD_LAYERS),
      entityCount: [...doc.entities!].length,
      format,
      filename: `residential_${options.standard}_${options.combined ? "combined" : floorSafe(floors[0]!.id)}.${format}`,
    };
  }
}
function floorSafe(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Reopened slab contours must retain raw canonical areas; display precision is never used here. */
export function verifyResidentialCadDrawing(
  data: Uint8Array,
  format: "dxf" | "dwg",
  metadata: ResidentialCadSheetMetadata,
  expected?: acad.CadDocument,
  native?: import("@ai-floor-planner/core").NativeCadVerification,
): ReturnType<typeof verifyCadArtifact> {
  const verified = verifyCadArtifact(
      data,
      format,
      expected,
      undefined,
      format === "dwg" ? native : undefined,
    ),
    errors = [...verified.errors];
  if (verified.document) {
    const contours = [...verified.document.entities!].filter(
      (e): e is acad.LwPolyline =>
        e instanceof acad.LwPolyline && e.layer.name === "A-SLAB",
    );
    const references = expected
      ? [...expected.entities!].filter(
          (e): e is acad.LwPolyline =>
            e instanceof acad.LwPolyline && e.layer.name === "A-SLAB",
        )
      : undefined;
    if (contours.length !== metadata.floorIds.length)
      errors.push(
        "Residential slab contour count differs from canonical floors",
      );
    const key = (p: acad.LwPolyline) =>
      JSON.stringify(
        p.vertices.map((v) => [
          Math.round(v.location.x * 1e6),
          Math.round(v.location.y * 1e6),
        ]),
      );
    for (const [i, area] of metadata.areas.entries()) {
      const reference = references?.[i];
      const contour = references
        ? reference
          ? contours.find((c) => key(c) === key(reference))
          : undefined
        : contours[i];
      if (
        !contour ||
        !contour.isClosed ||
        Math.abs(
          polygonArea({ points: contour.vertices.map((v) => v.location) }) -
            area.grossMm2,
        ) >= 0.001
      )
        errors.push(`Raw serialized slab area mismatch: ${area.floorId}`);
    }
    for (const [name, aci] of Object.entries(RESIDENTIAL_CAD_LAYERS))
      if (
        [...verified.document.layers!].find((l) => l.name === name)?.color
          .index !== aci
      )
        errors.push(`Residential layer/color mismatch: ${name}`);
  }
  return {
    ...verified,
    isValid: errors.length === 0,
    errors,
    checks: {
      ...verified.checks,
      residentialAreaReadback:
        !!verified.document && errors.every((e) => !e.includes("slab")),
    },
  };
}

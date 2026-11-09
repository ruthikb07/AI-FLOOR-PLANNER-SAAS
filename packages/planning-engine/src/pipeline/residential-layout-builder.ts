import {
  createBuilding,
  createFloor,
  createRoom,
  createWall,
  rectToPolygon,
  RoomType,
  WallType,
  DoorType,
  WindowType,
  SwingDirection,
  Direction,
  PlotShape,
  type Building,
  type Floor,
  type Room,
  type Wall,
  type Polygon,
  type Point,
  type MultiSheetApartmentConfig,
  type Site,
  type Door,
} from "@ai-floor-planner/core";
import {
  permissibleResidentialEnvelope,
  inscribedResidentialRectangle,
  residentialRoadFrame,
  residentialEnvelopeRemainder,
  rectangularBounds,
  polygonArea,
  polygonBoundingBox,
} from "@ai-floor-planner/geometry-engine";
import { infeasible } from "../structural/solver-result";

export type ResidentialSynthesisConfig = MultiSheetApartmentConfig &
  Partial<Pick<Site, "plotBoundary">>;
type Link = { a: Room; b: Room; width: number; type: DoorType; point?: Point };

/** Procedural strip packing from dimensions, never coordinates copied from reference drawings. */
export function buildResidentialLayout(config: ResidentialSynthesisConfig) {
  if (
    ![config.plotWidthMm, config.plotDepthMm, config.roadWidthMm].every(
      (v) => Number.isFinite(v) && v > 0,
    ) ||
    !Number.isInteger(config.numTypicalFloors) ||
    config.numTypicalFloors < 1 ||
    config.numTypicalFloors > 40 ||
    config.verticalStackType !== "STILT_PLUS_N" ||
    config.flatsPerFloor !== 2 ||
    config.units?.length !== 2 ||
    config.units.some(
      (u) =>
        !["2BHK", "3BHK"].includes(u.bhkType) ||
        !Number.isInteger(u.unitIndex) ||
        u.unitIndex < 1 ||
        !Number.isInteger(u.attachedBathCount ?? 0) ||
        (u.attachedBathCount ?? 0) < 0 ||
        (u.attachedBathCount ?? 0) >= Number(u.bhkType[0]),
    ) ||
    new Set(config.units.map((u) => u.unitIndex)).size !== 2
  )
    throw infeasible(
      "ENVELOPE: supported brief requires positive dimensions, stilt, 1–40 residential levels and two explicitly specified 2BHK/3BHK units.",
    );
  const facing = config.roadAccessSides[0] ?? Direction.North;
  const plot =
    config.plotBoundary ??
    rectToPolygon(0, 0, config.plotWidthMm, config.plotDepthMm);
  const plotBounds = polygonBoundingBox(plot);
  if (
    Math.abs(plotBounds.width - config.plotWidthMm) > 0.001 ||
    Math.abs(plotBounds.height - config.plotDepthMm) > 0.001
  )
    throw infeasible(
      "ENVELOPE: surveyed polygon extents disagree with declared plot dimensions.",
    );
  const frame = residentialRoadFrame(plot, facing),
    localPlot = { points: plot.points.map(frame.toLocal) };
  // Provisional layout defaults, not asserted statutory setbacks. Explicit brief margins take precedence.
  const margins = config.setbacksMm ?? {
    front: 3000,
    rear: 1500,
    left: 1500,
    right: 1500,
  };
  const centreMargins = {
    front: margins.front + 115,
    rear: margins.rear + 115,
    left: margins.left + 115,
    right: margins.right + 115,
  };
  const outer = permissibleResidentialEnvelope(
    localPlot,
    centreMargins,
    Direction.North,
  );
  const inscribed = inscribedResidentialRectangle(outer),
    raw = rectangularBounds(inscribed)!;
  const width = Math.min(raw.width, 18000),
    depth = Math.min(raw.height, 26000);
  const x = raw.minX + (raw.width - width) / 2,
    y = raw.minY;
  if (width < 12000 || depth < 18000)
    throw infeasible(
      `ENVELOPE: at (${x}, ${y}) usable ${width} x ${depth} mm cannot fit the bounded two-wing residential topology.`,
    );
  const slab = rectToPolygon(x, y, width, depth),
    bay = width / 3,
    balconyDepth = 1600;
  const gridEnvelope = rectToPolygon(
    x,
    y + balconyDepth,
    width,
    depth - balconyDepth,
  );
  const rowCount = Math.ceil((depth - balconyDepth) / 6000),
    row = (depth - balconyDepth) / rowCount;
  const stairY = y + balconyDepth + row,
    stairDepth = row,
    stairWidth = bay - 1500;
  if (row < 3600 || stairWidth < 2600)
    throw infeasible(
      `CORE_ANCHOR: insufficient flight/landing bay at (${x + bay}, ${stairY}).`,
    );
  const initial = createBuilding({
    projectId: config.projectId ?? "residential-synthesis",
    name: config.projectName ?? "Residential synthesis",
    site: { plotWidth: config.plotWidthMm, plotDepth: config.plotDepthMm },
  });
  const buildingId = `synthesis:${config.projectId ?? "residential"}`;
  const groundOuter =
    raw.width === width && raw.height === depth ? outer : slab;
  const floors: Floor[] = [];
  const driveway = rectToPolygon(x + bay + 115, 0, bay - 230, stairY);
  const gate = {
    id: `${buildingId}:gate`,
    position: { x: x + 1.5 * bay, y: 0 },
    width: bay - 230,
    direction: Direction.North,
  };
  // The road-side polygon edge must really meet the proposed gate.
  const plotTop = Math.min(...localPlot.points.map((p) => p.y));
  if (plotTop !== 0) throw infeasible("ENVELOPE: unsupported road origin.");

  for (let level = 0; level <= config.numTypicalFloors + 1; level++) {
    const ground = level === 0,
      roof = level === config.numTypicalFloors + 1;
    const f0 = createFloor({
      buildingId,
      level,
      name: ground ? "Stilt" : roof ? "Terrace" : `Residential ${level}`,
      floorHeight: ground
        ? (config.stiltHeightMm ?? 3300)
        : (config.floorToFloorHeightMm ?? 3000),
      boundary: ground || roof ? groundOuter : slab,
    });
    const floorId = `${buildingId}:floor:${level}`;
    const rooms: Room[] = [],
      links: Link[] = [],
      units: NonNullable<Floor["apartmentUnits"]>[number][] = [];
    const room = (
      name: string,
      type: RoomType,
      rx: number,
      ry: number,
      w: number,
      h: number,
      unitId?: string,
      tags: readonly string[] = [],
    ) => {
      const r: Room = {
        ...createRoom({
          floorId,
          type,
          name,
          x: rx,
          y: ry,
          width: w,
          height: h,
          tags: [...tags],
        }),
        id: `${floorId}:room:${name}`,
        unitId,
        spaceUse: unitId
          ? type === RoomType.Balcony
            ? "OUTDOOR"
            : "UNIT"
          : [RoomType.Staircase, RoomType.Lift].includes(type)
            ? "CORE"
            : "COMMON",
        clearHeightMm: f0.floorHeight - 250,
      };
      rooms.push(r);
      return r;
    };
    const commonFront = room(
      "Common entrance",
      ground ? RoomType.Parking : RoomType.Corridor,
      x + bay,
      y,
      bay,
      stairY - y,
      undefined,
      ground ? ["STILT_CIRCULATION"] : [],
    );
    const stair = room(
      roof ? "Stair cover" : "Stair enclosure",
      RoomType.Staircase,
      x + bay,
      stairY,
      stairWidth,
      stairDepth,
    );
    const beside = room(
      "Common stair lobby",
      RoomType.Corridor,
      x + bay + stairWidth,
      stairY,
      bay - stairWidth,
      stairDepth,
    );
    const liftY = stairY + stairDepth,
      liftSize = 2100;
    const lift = room(
      "Lift well",
      RoomType.Lift,
      x + bay,
      liftY,
      liftSize,
      liftSize,
    );
    const liftLobby = room(
      "Common lift lobby",
      RoomType.Corridor,
      x + bay + liftSize,
      liftY,
      bay - liftSize,
      liftSize,
    );
    const backHeight = y + depth - liftY - liftSize;
    if (backHeight <= 1300)
      throw infeasible(`CORE_ANCHOR: no back lobby at (${x + bay}, ${liftY}).`);
    const back = room(
      roof ? "Lift machine room" : "Common rear lobby",
      roof ? RoomType.Custom : RoomType.Corridor,
      x + bay,
      liftY + liftSize,
      bay,
      backHeight,
      undefined,
      roof ? ["LIFT_MACHINE_ROOM"] : [],
    );
    const accessPoint = { x: x + bay + stairWidth / 2, y: stairY };
    links.push(
      {
        a: commonFront,
        b: stair,
        width: 1300,
        type: DoorType.OpenPassage,
        point: accessPoint,
      },
      { a: commonFront, b: beside, width: 1200, type: DoorType.OpenPassage },
      { a: beside, b: liftLobby, width: 1200, type: DoorType.OpenPassage },
      { a: lift, b: liftLobby, width: 900, type: DoorType.Sliding },
      { a: liftLobby, b: back, width: 1200, type: DoorType.OpenPassage },
    );
    for (let side = 0; side < 2; side++) {
      const ux = x + side * 2 * bay,
        inner = side === 0 ? ux + bay : ux;
      if (ground) {
        const serviceX = side === 0 ? ux : ux + bay - 2000;
        const service = room(
          side === 0 ? "Security cabin" : "Electrical meter room",
          RoomType.Custom,
          serviceX,
          y,
          2000,
          2500,
          undefined,
          [side === 0 ? "SECURITY_CABIN" : "ELECTRICAL_METER_ROOM"],
        );
        const stallX = side === 0 ? ux + bay - 2615 : ux + 115;
        const stall = room(
          `C-0${side + 1}`,
          RoomType.Parking,
          stallX,
          y + 115,
          2500,
          5000,
        );
        // Tile the open circulation around real marked stalls/services without creating enclosing partitions.
        const xs = [
          ...new Set([
            ux,
            ux + bay,
            service.x,
            service.x + service.width,
            stall.x,
            stall.x + stall.width,
          ]),
        ].sort((a, b) => a - b);
        const ys = [
          ...new Set([
            y,
            y + depth,
            service.y,
            service.y + service.height,
            stall.y,
            stall.y + stall.height,
          ]),
        ].sort((a, b) => a - b);
        for (let i = 1; i < xs.length; i++)
          for (let j = 1; j < ys.length; j++) {
            const mx = (xs[i]! + xs[i - 1]!) / 2,
              my = (ys[j]! + ys[j - 1]!) / 2;
            if (
              [service, stall].some(
                (r) =>
                  mx > r.x &&
                  mx < r.x + r.width &&
                  my > r.y &&
                  my < r.y + r.height,
              )
            )
              continue;
            room(
              `Stilt circulation ${side}-${i}-${j}`,
              RoomType.Foyer,
              xs[i - 1]!,
              ys[j - 1]!,
              xs[i]! - xs[i - 1]!,
              ys[j]! - ys[j - 1]!,
            );
          }
      } else if (roof) {
        room(`Open terrace ${side}`, RoomType.Terrace, ux, y, bay, depth);
      } else {
        const spec = config.units![side]!,
          unitId = `${floorId}:unit:${spec.unitIndex}`;
        units.push({
          id: unitId,
          unitType: spec.bhkType,
          boundary: rectToPolygon(ux, y, bay, depth),
        });
        const balcony = room(
          `Unit ${side} balcony`,
          RoomType.Balcony,
          ux,
          y,
          bay,
          balconyDepth,
          unitId,
        );
        const living = room(
          `Unit ${side} living`,
          RoomType.Living,
          ux,
          y + balconyDepth,
          bay,
          3600,
          unitId,
        );
        const privateWidth = 1300,
          privateX = side === 0 ? ux + bay - privateWidth : ux,
          privateY = y + balconyDepth + 3600;
        const privatePassage = room(
          `Unit ${side} private passage`,
          RoomType.Corridor,
          privateX,
          privateY,
          privateWidth,
          y + depth - privateY,
          unitId,
        );
        const outerX = side === 0 ? ux : ux + privateWidth,
          outerWidth = bay - privateWidth;
        const n = Number(spec.bhkType[0]),
          bedDepth = (y + depth - privateY - 2400 - n * 1200) / n;
        if (bedDepth < 2900)
          throw infeasible(
            `UNIT_PACKING: ${spec.bhkType} bedroom depth ${bedDepth} mm at (${outerX}, ${privateY}) is infeasible.`,
          );
        const entryY = living.y + 115 + 75 + 1050 / 2;
        links.push(
          {
            a: commonFront,
            b: living,
            width: 1050,
            type: DoorType.Single,
            point: { x: inner, y: entryY },
          },
          {
            a: living,
            b: balcony,
            width: 1100,
            type: DoorType.Sliding,
            point: { x: side === 0 ? ux + bay - 850 : ux + 850, y: living.y },
          },
          {
            a: living,
            b: privatePassage,
            width: 1000,
            type: DoorType.OpenPassage,
          },
        );
        let ry = privateY;
        const kitchen = room(
          `Unit ${side} kitchen`,
          RoomType.Kitchen,
          outerX,
          ry,
          outerWidth,
          2400,
          unitId,
        );
        ry += 2400;
        links.push({
          a: privatePassage,
          b: kitchen,
          width: 900,
          type: DoorType.OpenPassage,
        });
        for (let k = 0; k < n; k++) {
          const bed = room(
            `Unit ${side} bedroom ${k + 1}`,
            RoomType.Bedroom,
            outerX,
            ry,
            outerWidth,
            bedDepth,
            unitId,
          );
          ry += bedDepth;
          const bath = room(
            `Unit ${side} bath ${k + 1}`,
            RoomType.Bathroom,
            outerX,
            ry,
            outerWidth,
            k === n - 1 ? y + depth - ry : 1200,
            unitId,
          );
          const attached = k < (spec.attachedBathCount ?? 0);
          rooms[rooms.indexOf(bath)] = {
            ...bath,
            bathroomOwnerRoomId: attached ? bed.id : undefined,
            bathroomAccessClass: attached ? "ATTACHED" : "COMMON",
          };
          ry = bath.y + bath.height;
          links.push(
            {
              a: privatePassage,
              b: bed,
              width: 900,
              type: DoorType.Single,
              point: {
                x: side === 0 ? privateX : privateX + privateWidth,
                y: bed.y + 57.5 + 75 + 450,
              },
            },
            {
              a: attached ? bed : privatePassage,
              b: bath,
              width: 750,
              type: DoorType.Sliding,
            },
          );
        }
      }
    }
    if (ground || roof)
      for (const [i, p] of residentialEnvelopeRemainder(
        groundOuter,
        slab,
      ).entries()) {
        const bounds = polygonBoundingBox(p),
          r = room(
            `Skew circulation ${i}`,
            roof ? RoomType.Terrace : RoomType.Foyer,
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
          );
        // Core's existing schema defines Room.area as width*height, a nominal cache.
        // Exact skewed areas come exclusively from boundary integration in the ledger.
        rooms[rooms.indexOf(r)] = {
          ...r,
          boundary: p,
          tags: [
            ...r.tags,
            "NON_RECTANGULAR_BOUNDARY",
            "NOMINAL_BOUNDING_BOX_AREA",
          ],
        };
      }
    const walls = buildWalls(floorId, rooms, ground, roof, links);
    const doors: Door[] = links.map((link, i) => {
      const wall = walls.find(
        (w) => w.roomIds.includes(link.a.id) && w.roomIds.includes(link.b.id),
      );
      if (!wall)
        throw infeasible(
          `OPENING_REFINEMENT: no shared boundary for ${link.a.id} / ${link.b.id}.`,
        );
      const point = link.point ?? {
        x: (wall.startPoint.x + wall.endPoint.x) / 2,
        y: (wall.startPoint.y + wall.endPoint.y) / 2,
      };
      return {
        id: `${floorId}:door:${i}`,
        floorId,
        wallId: wall.id,
        position: point,
        width: link.width,
        height: 2100,
        type: link.type,
        swingDirection: SwingDirection.Inward,
        connectsRooms: [link.a.id, link.b.id],
      };
    });
    const windows: Floor["windows"][number][] = [];
    if (!ground && !roof)
      for (const r of rooms.filter(
        (r) =>
          r.unitId &&
          [RoomType.Living, RoomType.Bedroom, RoomType.Kitchen].includes(
            r.type,
          ),
      )) {
        const host = walls.find(
          (w) =>
            w.wallUse === "EXTERNAL" &&
            w.roomIds.includes(r.id) &&
            (r.type === RoomType.Living
              ? w.startPoint.y === r.y && w.endPoint.y === r.y
              : w.startPoint.x === w.endPoint.x),
        );
        if (!host)
          throw infeasible(
            `UNIT_PACKING: no exterior window host for ${r.id}.`,
          );
        const living = r.type === RoomType.Living;
        const side = Number(r.name.split(" ")[1]);
        let position = living
          ? { x: side === 0 ? r.x + 1150 : r.x + r.width - 1150, y: r.y }
          : {
              x: host.startPoint.x,
              y: (host.startPoint.y + host.endPoint.y) / 2,
            };
        const windowWidth = living
          ? 1600
          : r.type === RoomType.Kitchen
            ? 900
            : Math.max(1000, r.area / 12000);
        if (!living) {
          const low =
              Math.min(host.startPoint.y, host.endPoint.y) +
              windowWidth / 2 +
              100,
            high =
              Math.max(host.startPoint.y, host.endPoint.y) -
              windowWidth / 2 -
              100;
          const targets = [
            position.y,
            low,
            high,
            ...Array.from(
              { length: 9 },
              (_, i) => low + ((high - low) * i) / 8,
            ),
          ].filter((v) => v >= low && v <= high);
          const chosen = targets.find((v) =>
            Array.from(
              { length: rowCount + 1 },
              (_, i) => y + balconyDepth + i * row,
            ).every((line) => Math.abs(line - v) >= windowWidth / 2 + 115),
          );
          if (chosen === undefined)
            throw infeasible(
              `OPENING_REFINEMENT: column-free exterior aperture unavailable for ${r.id}.`,
            );
          position = { ...position, y: chosen };
        }

        windows.push({
          id: `${floorId}:window:${windows.length}`,
          floorId,
          wallId: host.id,
          roomId: r.id,
          position,
          width: windowWidth,
          height: r.type === RoomType.Bathroom ? 900 : 1500,
          sillHeight: 900,
          type: WindowType.Casement,
        });
      }
    const clearWidth = (stairWidth - 230) / 2,
      landing = 1300;
    const canonical = {
      id: `${floorId}:stair`,
      floorId,
      polygon: stair.boundary,
      flight1: rectToPolygon(
        stair.x + 115,
        stair.y + 115,
        clearWidth,
        stairDepth - 230 - landing,
      ),
      flight2: rectToPolygon(
        stair.x + 115 + clearWidth,
        stair.y + 115,
        clearWidth,
        stairDepth - 230 - landing,
      ),
      midLanding: rectToPolygon(
        stair.x + 115,
        stair.y + stairDepth - 115 - landing,
        stairWidth - 230,
        landing,
      ),
      riserCount: 18,
      treadWidthMm: 250,
      clearWidthMm: clearWidth,
      accessEdge: {
        type: "OPEN_PASSAGE" as const,
        startPoint: { x: accessPoint.x - 650, y: stairY },
        endPoint: { x: accessPoint.x + 650, y: stairY },
      },
    };
    floors.push({
      ...f0,
      id: floorId,
      rooms,
      walls: walls.map((w) => ({
        ...w,
        hasOpening:
          doors.some((d) => d.wallId === w.id) ||
          windows.some((v) => v.wallId === w.id),
      })),
      doors,
      windows,
      apartmentUnits: units,
      floorUse: ground ? "STILT_PARKING" : roof ? "ROOF" : "RESIDENTIAL",
      canonicalStaircases: [canonical],
      elevationMm:
        level === 0
          ? 0
          : (config.stiltHeightMm ?? 3300) +
            (level - 1) * (config.floorToFloorHeightMm ?? 3000),
      parkingClearHeightMm: ground
        ? (config.stiltHeightMm ?? 3300) - 450
        : undefined,
      slabThicknessMm: 150,
    });
  }
  const b: Building = {
    ...initial,
    id: buildingId,
    regulatoryContext: config.regulatoryContext,
    floors,
    site: {
      ...initial.site,
      id: `${buildingId}:site`,
      plotBoundary: localPlot,
      plotShape: rectangularBounds(localPlot)
        ? PlotShape.Rectangular
        : PlotShape.Irregular,
      plotArea: polygonArea(localPlot),
      setbacks: margins,
      roadFacing: Direction.North,
      roadWidth: config.roadWidthMm,
      plannedFloorCount: config.numTypicalFloors + 2,
      accessPoints: [gate],
      siteZones: [
        {
          id: `${buildingId}:driveway`,
          kind: "vehicle_circulation",
          regulatoryUse: "DRIVEWAY",
          name: "Open stilt driveway",
          boundary: driveway,
          area: polygonArea(driveway),
          accessLinks: [gate.id],
          source: "GENERATED",
          reviewStatus: "UNREVIEWED",
        },
      ],
    },
    metadata: {
      ...initial.metadata,
      tags: ["ASSERTED_FROM_BRIEF", "PROVISIONAL_STRUCTURAL_LAYOUT"],
      generationBrief: {
        source: "DETERMINISTIC",
        units: config.units!.map((u) => ({
          unitIndex: u.unitIndex,
          bhkType: u.bhkType,
          targetCarpetSqFt: u.targetCarpetSqFt,
        })),
      },
    },
  };
  return {
    building: transformBuilding(b, frame.fromLocal, facing, plot),
    structuralEnvelope: { points: gridEnvelope.points.map(frame.fromLocal) },
    permissibleEnvelope: { points: outer.points.map(frame.fromLocal) },
  };
}

/** Split at real room endpoints; each canonical wall segment has at most two semantic owners. */
function buildWalls(
  floorId: string,
  rooms: Room[],
  ground: boolean,
  roof: boolean,
  links: Link[],
): Wall[] {
  const lines = new Map<string, { a: Point; b: Point; rooms: Room[] }>();
  for (const r of rooms)
    r.boundary.points.forEach((a, i) => {
      const b = r.boundary.points[(i + 1) % r.boundary.points.length]!;
      if (a.x !== b.x && a.y !== b.y) return; // skew circulation is open; its slab boundary is not an enclosure
      const vertical = a.x === b.x,
        constant = vertical ? a.x : a.y;
      const start = Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x),
        end = Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x);
      const cuts = [
        ...new Set([
          start,
          end,
          ...rooms
            .flatMap((q) =>
              q.boundary.points
                .filter((p) => (vertical ? p.x : p.y) === constant)
                .map((p) => (vertical ? p.y : p.x)),
            )
            .filter((v) => v > start && v < end),
        ]),
      ].sort((a, b) => a - b);
      for (let j = 1; j < cuts.length; j++) {
        const low = cuts[j - 1]!,
          high = cuts[j]!;
        if (high - low < 1e-6) continue;
        const key = `${vertical ? "v" : "h"}:${constant}:${low}:${high}`;
        const item = lines.get(key) ?? {
          a: vertical ? { x: constant, y: low } : { x: low, y: constant },
          b: vertical ? { x: constant, y: high } : { x: high, y: constant },
          rooms: [],
        };
        if (!item.rooms.includes(r)) item.rooms.push(r);
        lines.set(key, item);
      }
    });
  const walls: Wall[] = [];
  for (const { a, b, rooms: owners } of lines.values()) {
    const core = owners.some(
      (r) => r.type === RoomType.Staircase || r.type === RoomType.Lift,
    );
    const service = owners.some(
      (r) =>
        r.tags.includes("SECURITY_CABIN") ||
        r.tags.includes("ELECTRICAL_METER_ROOM"),
    );
    if (
      ground &&
      !core &&
      !service &&
      !links.some((link) => owners.includes(link.a) && owners.includes(link.b))
    )
      continue;
    let use: NonNullable<Wall["wallUse"]> = "INTERNAL_PARTITION",
      thickness = 115,
      type = WallType.Internal;
    if (owners.length === 1) {
      use =
        roof || owners[0]!.type === RoomType.Balcony ? "PARAPET" : "EXTERNAL";
      thickness = use === "PARAPET" ? 100 : 230;
      type = WallType.External;
    } else if (owners.some((r) => r.type === RoomType.Balcony)) {
      use = "EXTERNAL";
      thickness = 230;
      type = WallType.External;
    } else if (
      owners.some((r) => !!r.unitId) &&
      owners.some((r) => !r.unitId)
    ) {
      use = "UNIT_SEPARATION";
      thickness = 230;
    } else if (core) {
      use = "CORE";
      thickness = 230;
    } else if (owners.every((r) => !r.unitId)) {
      use = "COMMON_CORRIDOR";
      thickness = 150;
    }
    walls.push({
      ...createWall({
        floorId,
        startPoint: a,
        endPoint: b,
        thickness,
        type,
        roomIds: owners.map((r) => r.id),
      }),
      id: `${floorId}:wall:${walls.length}`,
      wallUse: use,
      unitIds: [
        ...new Set(owners.flatMap((r) => (r.unitId ? [r.unitId] : []))),
      ],
      loadBearing: use === "UNIT_SEPARATION" || use === "EXTERNAL",
      provenance: "PROVISIONAL_HEURISTIC",
    });
  }
  return walls;
}

function transformBuilding(
  b: Building,
  map: (p: Point) => Point,
  facing: Direction,
  plot: Polygon,
): Building {
  const poly = (p: Polygon): Polygon => ({ points: p.points.map(map) });
  const floors = b.floors.map((f) => ({
    ...f,
    boundary: poly(f.boundary),
    rooms: f.rooms.map((r) => {
      const boundary = poly(r.boundary),
        bounds = polygonBoundingBox(boundary);
      return {
        ...r,
        boundary,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    }),
    walls: f.walls.map((w) => ({
      ...w,
      startPoint: map(w.startPoint),
      endPoint: map(w.endPoint),
    })),
    doors: f.doors.map((d) => ({ ...d, position: map(d.position) })),
    windows: f.windows.map((w) => ({ ...w, position: map(w.position) })),
    apartmentUnits: f.apartmentUnits?.map((u) => ({
      ...u,
      boundary: poly(u.boundary),
    })),
    canonicalStaircases: f.canonicalStaircases?.map((s) => ({
      ...s,
      polygon: poly(s.polygon),
      flight1: poly(s.flight1),
      flight2: poly(s.flight2),
      midLanding: poly(s.midLanding),
      accessEdge: {
        ...s.accessEdge,
        startPoint: map(s.accessEdge.startPoint),
        endPoint: map(s.accessEdge.endPoint),
      },
    })),
  }));
  return {
    ...b,
    floors,
    site: {
      ...b.site,
      plotBoundary: plot,
      roadFacing: facing,
      accessPoints: b.site.accessPoints.map((g) => ({
        ...g,
        position: map(g.position),
        direction: facing,
      })),
      siteZones: b.site.siteZones?.map((z) => ({
        ...z,
        boundary: poly(z.boundary),
      })),
    },
  };
}

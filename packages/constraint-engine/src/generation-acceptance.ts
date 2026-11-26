import { architecturalSpaceRole, isPhysicalBoundary, PLUMBING_RESERVATION_NOTE_TAG, PLUMBING_RISER_TAG, RoomType, validateBuildingSchema, type ApartmentGenerationViolation, type Building, type Floor, type GeometryValidationReport, type Room } from '@ai-floor-planner/core';
import { openingFitsApartmentWall, polygonBoundingBox } from '@ai-floor-planner/geometry-engine';

export interface GenerationBlockingFinding {
  readonly code: string;
  readonly message: string;
}

type ArchitecturalFinding = Omit<ApartmentGenerationViolation, 'rank'>;

function hasDualStairRoutes(floor: Floor): boolean {
  const nodes = new Set(floor.rooms.filter(room => !room.unitId &&
    (room.type === RoomType.Corridor || room.type === RoomType.Staircase || room.type === RoomType.Foyer)).map(room => room.id));
  const graph = new Map<string, string[]>([...nodes].map(id => [id, []]));
  const connect = (ids: readonly string[]) => {
    if (ids.length !== 2) return;
    const [a, b] = ids as readonly [string, string];
    graph.get(a)?.push(b);
    graph.get(b)?.push(a);
  };
  for (const wall of floor.walls) {
    if (!isPhysicalBoundary(wall) && Math.hypot(wall.endPoint.x - wall.startPoint.x, wall.endPoint.y - wall.startPoint.y) >= 900) connect(wall.roomIds);
  }
  const walls = new Map(floor.walls.map(wall => [wall.id, wall]));
  const hostedDoors = floor.doors.filter(door => {
    const wall = walls.get(door.wallId);
    return wall && door.connectsRooms.every(id => wall.roomIds.includes(id)) && openingFitsApartmentWall(wall, door.position, door.width);
  });
  for (const door of hostedDoors) connect(door.connectsRooms);
  const stairs = floor.rooms.filter(room => room.type === RoomType.Staircase);
  const roomById = new Map(floor.rooms.map(room => [room.id, room]));
  return stairs.length === 2 && (floor.apartmentUnits ?? []).every(unit => {
    const seen = new Set(hostedDoors.filter(door => door.connectsRooms.some(id => roomById.get(id)?.unitId === unit.id))
      .flatMap(door => door.connectsRooms.filter(id => nodes.has(id))));
    for (const id of seen) for (const adjacent of graph.get(id) ?? []) if (nodes.has(adjacent)) seen.add(adjacent);
    return stairs.every(stair => seen.has(stair.id));
  });
}

/** Minimum unobstructed section through an axis-aligned common passage. */
export function minimumCommonPassageWidthMm(floor: Floor, room: Room): number {
  const horizontal = room.width >= room.height;
  const long = horizontal ? room.x : room.y;
  const across = horizontal ? room.y : room.x;
  const length = horizontal ? room.width : room.height;
  const span = horizontal ? room.height : room.width;
  const obstacles: { start: number; end: number; low: number; high: number }[] = [];
  for (const wall of floor.walls.filter(wall => isPhysicalBoundary(wall) && wall.roomIds.includes(room.id))) {
    const [a, b] = [wall.startPoint, wall.endPoint];
    const along = horizontal ? [a.x, b.x] : [a.y, b.y];
    const fixed = horizontal ? [a.y, b.y] : [a.x, b.x];
    if (fixed[0] !== fixed[1]) continue;
    obstacles.push({ start: Math.min(...along), end: Math.max(...along), low: fixed[0]! - wall.thickness / 2,
      high: fixed[0]! + wall.thickness / 2 });
  }
  for (const column of floor.columns) {
    const x = horizontal ? column.position.x : column.position.y;
    const y = horizontal ? column.position.y : column.position.x;
    const w = horizontal ? column.width : column.depth;
    const h = horizontal ? column.depth : column.width;
    obstacles.push({ start: x - w / 2, end: x + w / 2, low: y - h / 2, high: y + h / 2 });
  }
  const cuts = [...new Set([long, long + length, ...obstacles.flatMap(block => [block.start, block.end])
    .filter(value => value > long && value < long + length)])].sort((a, b) => a - b);
  return Math.min(span, ...cuts.slice(1).map((end, i) => {
    const middle = (cuts[i]! + end) / 2;
    const blocked = obstacles.filter(block => middle > block.start && middle < block.end && block.high > across && block.low < across + span)
      .sort((a, b) => a.low - b.low);
    let start = across, widest = 0;
    for (const block of blocked) {
      widest = Math.max(widest, block.low - start);
      start = Math.max(start, block.high);
    }
    return Math.max(widest, across + span - start);
  }));
}

/** Evaluate mandatory architectural controls against the canonical geometry, including after edits. */
export function architecturalRequirementFindings(building: Building): readonly ArchitecturalFinding[] {
  const brief = building.metadata?.generationBrief;
  const options = brief?.architectureOptions;
  const coordinateRisers = options?.coordinatedWetWallLayout || options?.requireWetWallRisers || brief?.coordinatedWetWallLayout;
  if (!options && !coordinateRisers) return [];
  const floors = building.floors.filter(floor => floor.apartmentUnits?.length).sort((a, b) => a.level - b.level);
  const reservations = floors.map(floor => floor.rooms.filter(room => room.type === RoomType.ServiceShaft &&
    room.tags.some(tag => tag.startsWith(PLUMBING_RISER_TAG))));
  const footprint = (index: number) => JSON.stringify(reservations[index]?.map(room =>
    room.boundary.points.map(({ x, y }) => `${x},${y}`).sort().join(';')).sort());
  const firstFootprint = coordinateRisers ? footprint(0) : undefined;
  return floors.flatMap((floor, index) => {
    const findings: ArchitecturalFinding[] = [];
    const add = (code: string, description: string, ids = [floor.id]) => findings.push({
      code, source: 'GENERATION', severity: 'CRITICAL', description, floorId: floor.id, elementIds: ids,
    });
    for (const [count, type] of [[options?.stairCount, RoomType.Staircase], [options?.liftCount, RoomType.Lift]] as const) {
      if (count !== undefined && floor.rooms.filter(room => room.type === type).length !== count) {
        add('MANDATORY_BRIEF_UNMET', `${floor.name} requires exactly ${count} ${type === RoomType.Staircase ? 'stairs' : 'lifts'}.`);
      }
    }
    const hasCourtyard = floor.rooms.some(room => architecturalSpaceRole(room) === 'OPEN_TO_SKY_VOID' && !room.tags.includes('recess:perimeter'));
    if (options?.openToSky === 'REQUIRED' && !hasCourtyard) add('MANDATORY_BRIEF_UNMET', `${floor.name} requires an internal open-to-sky space.`);
    if (options?.openToSky === 'PROHIBITED' && hasCourtyard) add('MANDATORY_BRIEF_UNMET', `${floor.name} prohibits internal open-to-sky spaces.`);
    if (options?.stairCount === 2 && !hasDualStairRoutes(floor)) add('MANDATORY_BRIEF_UNMET', `${floor.name} must provide a hosted route from every flat to both stairs.`);
    const dimensions = options?.coreDimensions;
    if (dimensions) {
      const stairs = floor.canonicalStaircases ?? [];
      for (const stair of stairs) {
        const bound = polygonBoundingBox(stair.floorLanding ?? stair.midLanding);
        const lower = Math.min(bound.width, bound.height);
        const issue = (dimensions.flightWidthMm !== undefined && stair.clearWidthMm < dimensions.flightWidthMm) ||
          (dimensions.treadDepthMm !== undefined && stair.treadWidthMm + 0.001 < dimensions.treadDepthMm) ||
          (dimensions.landingDepthMm !== undefined && lower < dimensions.landingDepthMm) ||
          (dimensions.maxRiserMm !== undefined && floor.floorHeight / stair.riserCount > dimensions.maxRiserMm + 0.001);
        if (issue) add('CORE_DIMENSION_UNMET', `${floor.name} has a stair outside the specified flight, tread, landing or riser dimensions.`, [stair.id]);
      }
      for (const lift of floor.rooms.filter(room => room.type === RoomType.Lift)) {
        if (lift.width < (dimensions.liftShaftWidthMm ?? 0) || lift.height < (dimensions.liftShaftDepthMm ?? 0)) {
          add('CORE_DIMENSION_UNMET', `${lift.name} on ${floor.name} is smaller than the specified shaft.`, [lift.id]);
        }
      }
      const court = floor.rooms.find(room => room.tags.includes('shaft:central-court'));
      if (dimensions.courtyardWidthMm !== undefined && (!court || court.width < dimensions.courtyardWidthMm)) {
        add('CORE_DIMENSION_UNMET', `${floor.name} cannot fit the specified central courtyard width.`);
      }
      if (dimensions.circulationWidthMm !== undefined) for (const corridor of floor.rooms.filter(room => room.tags.includes('core:corridor'))) {
        const width = minimumCommonPassageWidthMm(floor, corridor);
        if (width + 0.001 < dimensions.circulationWidthMm) add('CORE_DIMENSION_UNMET',
          `${corridor.name} on ${floor.name} clears ${width.toFixed(1)} mm. The brief requires ${dimensions.circulationWidthMm} mm.`, [corridor.id]);
      }
    }
    if (coordinateRisers && footprint(index) !== firstFootprint) {
      add('WET_WALL_RISER_ALIGNMENT_MISMATCH', `Architectural riser footprints on ${floor.name} differ from ${floors[0]!.name}.`,
        [...reservations[index]!.map(room => room.id), ...reservations[0]!.map(room => room.id)]);
    }
    if (options?.requireWetWallRisers) {
      const served = new Set(reservations[index]!.flatMap(room => room.tags));
      for (const bath of floor.rooms.filter(room => room.type === RoomType.Bathroom && room.unitId)) {
        if (!bath.tags.some(tag => tag.startsWith('apt-room:') && served.has(PLUMBING_RISER_TAG + tag.slice('apt-room:'.length)))) {
          const reason = bath.tags.find(tag => tag.startsWith(PLUMBING_RESERVATION_NOTE_TAG))?.slice(PLUMBING_RESERVATION_NOTE_TAG.length);
          add('WET_WALL_RISER_REQUIRED', `${bath.name}: ${reason ?? 'No feasible architectural plumbing riser.'}`, [bath.id]);
        }
      }
    }
    return findings;
  });
}

export function generationBlockingFindings(
  building: Building,
  report?: GeometryValidationReport,
): readonly GenerationBlockingFinding[] {
  const schemaError = validateBuildingSchema(building)[0];
  if (schemaError || !building.metadata || !building.floors.length) {
    return [{ code: 'INVALID_BUILDING', message: schemaError
      ? `${schemaError.path}: ${schemaError.message}`
      : 'The generated building is missing metadata or physical floors.' }];
  }
  if (!report || !Array.isArray(report.errors) || !Number.isFinite(report.planarDeltaMm2)) {
    return [{ code: 'MISSING_GEOMETRY_AUDIT', message: 'The generated plan is missing a complete geometry audit.' }];
  }

  const findings: GenerationBlockingFinding[] = report.errors
    .filter(issue => issue?.severity === 'CRITICAL' && !issue.autoCorrected)
    .map(issue => ({ code: issue.code, message: issue.description }));
  findings.push(...architecturalRequirementFindings(building).map(issue => ({ code: issue.code, message: issue.description })));
  const brief = building.metadata.generationBrief;
  if (brief?.lockedMassingShape && brief.buildingMassingShape !== brief.lockedMassingShape) {
    findings.push({ code: 'LOCKED_MASSING_UNREALIZED',
      message: `The search did not find a valid ${brief.lockedMassingShape} layout for this envelope and program. The evaluated geometry used ${brief.buildingMassingShape ?? 'an unidentified massing'}. Adjust the program or unlock the shape.` });
  }
  const generationReport = building.metadata.generationReport;
  for (const issue of generationReport?.violations ?? []) {
    if (issue.severity === 'CRITICAL' && (['GEOMETRY', 'CLOSURE', 'OPENING'].includes(issue.source) ||
      ['AREA_TARGET_UNMET', 'MANDATORY_BRIEF_UNMET', 'DUPLICATE_FINAL_LAYOUT', 'CORE_DIMENSION_UNMET', 'WET_WALL_RISER_ALIGNMENT_MISMATCH', 'WET_WALL_RISER_REQUIRED'].includes(issue.code))) {
      findings.push({ code: issue.code, message: issue.description });
    }
  }
  if (report.isValid !== true && findings.length === 0) {
    findings.push({ code: 'GEOMETRY_NOT_VALID', message: 'The geometry audit did not pass.' });
  }
  return [...new Map(findings.map(finding => [`${finding.code}:${finding.message}`, finding])).values()];
}

export function requireAcceptedGeneration(result: { building: Building; validationReport?: GeometryValidationReport }): void {
  const first = generationBlockingFindings(result.building, result.validationReport)[0];
  if (first) throw new Error(`Required design checks failed. ${first.message} Try a different massing or adjust the brief.`);
}

import {
  RoomType, architecturalSpaceRole, createDoor, createWindow, isPhysicalBoundary,
  stableValueHash, validateBuildingSchema, withArchitecturalElements,
  type Building, type Door, type Floor, type GenerationControlState, type Window,
} from '@ai-floor-planner/core';
import { openingFitsApartmentWall, projectOnSegment, safeCanonicalOpeningGeometry } from '@ai-floor-planner/geometry-engine';
import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { measureAreaTarget, measureResidentialFloorAreas } from '../apartment/apartment-area-targets';
import { physicalLayoutHash } from '../topology/physical-layout-fingerprint';
import { GeometryValidator } from '../validator/geometry-validator';
import { MIN_PROVISIONAL_COLUMN_SPACING_MM } from '../structural/provisional-column-host';

export type OpeningEdit =
  | { readonly action: 'remove'; readonly id: string }
  | { readonly action: 'update'; readonly id: string; readonly wallId: string; readonly offsetMm: number; readonly widthMm: number }
  | { readonly action: 'add'; readonly kind: 'door' | 'window'; readonly wallId: string; readonly offsetMm: number; readonly widthMm: number };

export function editApartmentOpening(building: Building, control: GenerationControlState, floorId: string, edit: OpeningEdit): Building {
  const floor = building.floors.find(item => item.id === floorId);
  if (!floor?.apartmentUnits?.length) throw new Error('Select a generated residential floor to edit openings.');
  if (control.lockedFloorIds.includes(floorId)) throw new Error('Unlock the floor before editing its openings.');

  const door = 'id' in edit ? floor.doors.find(item => item.id === edit.id) : undefined;
  const window = 'id' in edit ? floor.windows.find(item => item.id === edit.id) : undefined;
  const previous = door ?? window;
  if (edit.action !== 'add' && !previous) throw new Error('The selected opening no longer exists.');
  const requestedHost = edit.action === 'remove' ? previous!.wallId : edit.wallId;
  const host = floor.walls.find(wall => wall.id === requestedHost);
  if (!host || !isPhysicalBoundary(host) || host.arc) throw new Error('Select a straight physical wall. Curved opening hosts require a coordinated edit.');

  const locked = new Set([...control.lockedEntityIds, ...control.protectedCoreIds]);
  const oldHost = floor.walls.find(wall => wall.id === previous?.wallId);
  const hostRooms = floor.rooms.filter(room => host.roomIds.includes(room.id) || oldHost?.roomIds.includes(room.id));
  const units = new Set(hostRooms.flatMap(room => room.unitId ? [room.unitId] : []));
  if (units.size > 1) throw new Error('Select an opening contained within one flat. This edit would affect a neighbouring flat.');
  if (previous && oldHost?.arc) throw new Error('Select an opening with a straight original host.');
  if ([previous?.id, host.id, oldHost?.id].some(id => id && locked.has(id)) || hostRooms.some(room =>
    room.isFixed || locked.has(room.id) || locked.has(room.unitId ?? '')
    || room.type === RoomType.Lift || room.type === RoomType.Staircase)) {
    throw new Error('The opening touches a locked room, flat, wall or circulation core.');
  }

  let doors = floor.doors.filter(item => item.id !== previous?.id);
  let windows = floor.windows.filter(item => item.id !== previous?.id);
  if (edit.action !== 'remove') {
    const axis = projectOnSegment(host.startPoint, host.startPoint, host.endPoint);
    if (!axis || !Number.isFinite(edit.offsetMm) || edit.offsetMm < 0 || edit.offsetMm > axis.length
      || !Number.isFinite(edit.widthMm) || edit.widthMm <= 0) {
      throw new Error('Enter a positive width and a centre distance within the host wall.');
    }
    const position = axis.pointAt(edit.offsetMm);
    if (!openingFitsApartmentWall(host, position, edit.widthMm)) {
      throw new Error('The opening does not fit this wall. Reduce its width or move the centre away from the wall ends.');
    }
    const otherOpenings = [...doors, ...windows].filter(item => item.wallId === host.id);
    const hasCollision = otherOpenings.some(item => {
      const geometry = safeCanonicalOpeningGeometry(item, host, 'sillHeight' in item);
      if (!geometry) return true;
      const limits = [geometry.startPoint, geometry.endPoint].map(point =>
        projectOnSegment(point, host.startPoint, host.endPoint)!.along).sort((a, b) => a - b);
      return edit.offsetMm + edit.widthMm / 2 > limits[0]! && edit.offsetMm - edit.widthMm / 2 < limits[1]!;
    });
    if (hasCollision) throw new Error('The opening overlaps another door or window on this wall.');

    const props = { floorId, wallId: host.id, position, width: edit.widthMm,
      openingGeometryVersion: 1 as const, positionReference: 'CENTER' as const };
    if (door || (edit.action === 'add' && edit.kind === 'door')) {
      const sides = door?.connectsRooms ?? (host.roomIds.length === 2 ? [host.roomIds[0]!, host.roomIds[1]!] as const : undefined);
      if (!sides || !sides.every(id => host.roomIds.includes(id) || (id === '__outside__' && host.roomIds.length === 1))) {
        throw new Error('Select a wall shared by the two spaces served by this door.');
      }
      const next: Door = { ...(door ?? createDoor({ ...props, connectsRooms: [sides[0], sides[1]] })), ...props };
      const revised = { ...next, id: door?.id ?? stableValueHash({ kind: 'door', revision: building.version, ...props }), widthMm: next.width };
      doors = door ? floor.doors.map(item => item.id === door.id ? revised : item) : [...doors, revised];
    } else {
      const owners = hostRooms.filter(room => host.roomIds.includes(room.id) && architecturalSpaceRole(room) !== 'OPEN_TO_SKY_VOID');
      const ownerId = window?.roomId ?? (owners.length === 1 ? owners[0]!.id : undefined);
      if (!ownerId || !host.roomIds.includes(ownerId)) throw new Error('Select a wall serving the window’s room.');
      const next: Window = { ...(window ?? createWindow({ ...props, roomId: ownerId })), ...props };
      const revised = { ...next, id: window?.id ?? stableValueHash({ kind: 'window', revision: building.version, ...props }), widthMm: next.width };
      windows = window ? floor.windows.map(item => item.id === window.id ? revised : item) : [...windows, revised];
    }
  }

  const activeHosts = new Set([...doors, ...windows].map(item => item.wallId));
  const affectedHosts = new Set([host.id, oldHost?.id]);
  const editedFloor = { ...floor, doors, windows, walls: floor.walls.map(wall => {
    if (!affectedHosts.has(wall.id) || wall.hasOpening === activeHosts.has(wall.id)) return wall;
    return { ...wall, hasOpening: activeHosts.has(wall.id) };
  }) };
  return acceptApartmentFloorEdit(building, editedFloor);
}

export function acceptApartmentFloorEdit(building: Building, editedFloor: Floor): Building {
  const floorId = editedFloor.id;
  const previousReport = building.metadata.generationReport;
  const recordedFloor = previousReport?.floorAreas?.find(floor => floor.floorId === floorId);
  const brief = building.metadata.generationBrief;
  const areaTarget = previousReport?.areaTargetDiagnostic;
  const measured = measureResidentialFloorAreas(editedFloor, {
    units: brief?.units,
    areaAcceptanceTolerancePercent: areaTarget?.tolerancePercent,
  });
  const units = measured.units.map(unit => {
    const recordedTarget = recordedFloor?.units.find(item => item.unitId === unit.unitId)?.target;
    const target = recordedTarget
      ? measureAreaTarget(recordedTarget.requestedAreaSqFt, unit.carpetMm2 / 1e6, recordedTarget.scope, recordedTarget.tolerancePercent)
      : unit.target;
    if (target && target.status !== 'ACHIEVED' && (brief?.requireAreaTargets || recordedTarget?.status === 'ACHIEVED')) {
      throw new Error(`Flat ${unit.unitIndex} would miss its area target. ${target.explanation} Reduce the edit.`);
    }
    return target ? { ...unit, target } : unit;
  });
  const remeasureTarget = (areaMm2: number) => areaTarget && measureAreaTarget(
    areaTarget.requestedAreaSqFt, areaMm2 / 1e6, areaTarget.scope, areaTarget.tolerancePercent, areaTarget.minFeasibleGrossAreaM2,
  );
  if (areaTarget && (brief?.requireAreaTargets || areaTarget.status === 'ACHIEVED')) {
    const areas = areaTarget.scope === 'PER_APARTMENT_CARPET' ? units.map(unit => unit.carpetMm2)
      : [areaTarget.scope === 'GROSS_FLOOR_AREA' ? measured.grossMm2 : measured.carpetMm2];
    const missed = areas.map(remeasureTarget).find(result => result && result.status !== 'ACHIEVED');
    if (missed) throw new Error(`The edited floor would miss its area target. ${missed.explanation} Reduce the edit.`);
  }
  const floorAreas = previousReport?.floorAreas?.map(floor => floor.floorId === floorId ? { ...measured, units } : floor);
  const representative = floorAreas?.[0];
  const refreshedTarget = areaTarget && representative
    ? remeasureTarget(areaTarget.scope === 'PER_APARTMENT_CARPET' ? Math.min(...representative.units.map(unit => unit.carpetMm2))
      : areaTarget.scope === 'GROSS_FLOOR_AREA' ? representative.grossMm2 : representative.carpetMm2)
    : areaTarget;
  const next = { ...building, version: building.version + 1, updatedAt: new Date().toISOString(),
    floors: building.floors.map(item => item.id === floorId ? editedFloor : item),
    complianceRating: undefined, mepEngineering: undefined,
    metadata: { ...building.metadata, generationReport: previousReport && { ...previousReport, floorAreas, areaTargetDiagnostic: refreshedTarget } },
  };
  const schemaIssue = validateBuildingSchema(next)[0];
  if (schemaIssue) throw new Error(schemaIssue.message);
  const geometry = new GeometryValidator({ autoCorrect: false, columnMergeThresholdMm: MIN_PROVISIONAL_COLUMN_SPACING_MM })
    .audit(next, false).report;
  const blockingGeometry = geometry.errors.find(issue => issue.severity === 'CRITICAL' && !issue.autoCorrected);
  if (blockingGeometry) throw new Error(blockingGeometry.description);
  const closure = validateApartmentClosure({ ...next, floors: [editedFloor] });
  const issue = closure.issues.find(item => item.severity === 'error');
  if (issue) throw new Error(issue.message);
  const projected = withArchitecturalElements(next);
  return { ...projected,
    floors: projected.floors.map(item => item.id === floorId ? item : building.floors.find(before => before.id === item.id)!),
    metadata: { ...projected.metadata,
      ...(brief ? { generationBrief: { ...brief, physicalLayoutHash: physicalLayoutHash(projected) } } : {}),
    },
  };
}

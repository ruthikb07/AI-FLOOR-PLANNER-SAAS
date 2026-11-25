import {
  RoomType, SwingDirection, architecturalSpaceRole, createDoor, createWindow, isPhysicalBoundary,
  stableValueHash, validateBuildingSchema, withArchitecturalElements,
  type Building, type Door, type Floor, type GenerationControlState, type Point, type Wall, type Window,
} from '@ai-floor-planner/core';
import {
  canonicalCurvedOpeningGeometry,
  openingFitsApartmentWall,
  projectOnSegment,
  safeCanonicalOpeningGeometry,
} from '@ai-floor-planner/geometry-engine';
import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { measureAreaTarget, measureResidentialFloorAreas } from '../apartment/apartment-area-targets';
import { physicalLayoutHash } from '../topology/physical-layout-fingerprint';
import { GeometryValidator } from '../validator/geometry-validator';
import { MIN_PROVISIONAL_COLUMN_SPACING_MM } from '../structural/provisional-column-host';

export type OpeningEdit =
  | { readonly action: 'remove'; readonly id: string }
  | {
      readonly action: 'update';
      readonly id: string;
      readonly wallId: string;
      readonly offsetMm: number;
      readonly widthMm: number;
      readonly heightMm?: number;
      readonly sillHeightMm?: number;
      readonly swingDirection?: SwingDirection;
    }
  | {
      readonly action: 'add';
      readonly kind: 'door' | 'window';
      readonly wallId: string;
      readonly offsetMm: number;
      readonly widthMm: number;
      readonly heightMm?: number;
      readonly sillHeightMm?: number;
      readonly swingDirection?: SwingDirection;
    };

function hostWallLengthAndPointAt(host: Wall, offsetMm: number): { lengthMm: number; position: Point } | null {
  if (host.arc) {
    const { center, radiusMm, startAngleRad, endAngleRad } = host.arc;
    const sweep = endAngleRad - startAngleRad;
    if (!Number.isFinite(radiusMm) || radiusMm <= 0 || Math.abs(sweep) < 1e-9) return null;
    const lengthMm = radiusMm * Math.abs(sweep);
    if (!Number.isFinite(offsetMm) || offsetMm < 0 || offsetMm > lengthMm) return null;
    const sign = sweep >= 0 ? 1 : -1;
    const theta = startAngleRad + sign * (offsetMm / radiusMm);
    return {
      lengthMm,
      position: {
        x: center.x + radiusMm * Math.cos(theta),
        y: center.y + radiusMm * Math.sin(theta),
      },
    };
  }
  const axis = projectOnSegment(host.startPoint, host.startPoint, host.endPoint);
  if (!axis || !Number.isFinite(offsetMm) || offsetMm < 0 || offsetMm > axis.length) return null;
  return { lengthMm: axis.length, position: axis.pointAt(offsetMm) };
}

export function editApartmentOpening(building: Building, control: GenerationControlState, floorId: string, edit: OpeningEdit): Building {
  const floor = building.floors.find(item => item.id === floorId);
  if (!floor) throw new Error('Select a valid floor to edit openings.');
  if (control.lockedFloorIds.includes(floorId)) throw new Error('Unlock the floor before editing its openings.');

  const door = 'id' in edit ? floor.doors.find(item => item.id === edit.id) : undefined;
  const window = 'id' in edit ? floor.windows.find(item => item.id === edit.id) : undefined;
  const previous = door ?? window;
  if (edit.action !== 'add' && !previous) throw new Error('The selected opening no longer exists.');
  const requestedHost = edit.action === 'remove' ? previous!.wallId : edit.wallId;
  const host = floor.walls.find(wall => wall.id === requestedHost);
  if (!host || !isPhysicalBoundary(host) || host.boundaryRole === 'PARAPET' || host.boundaryRole === 'GUARDRAIL') {
    throw new Error('Select a full-height physical wall to host doors or windows.');
  }

  const locked = new Set([...control.lockedEntityIds, ...control.protectedCoreIds]);
  const oldHost = floor.walls.find(wall => wall.id === previous?.wallId);
  const hostRooms = floor.rooms.filter(room => host.roomIds.includes(room.id) || oldHost?.roomIds.includes(room.id));
  const units = new Set(hostRooms.flatMap(room => room.unitId ? [room.unitId] : []));
  if (units.size > 1) throw new Error('Select an opening contained within one flat. This edit would affect a neighbouring flat.');
  if ([previous?.id, host.id, oldHost?.id].some(id => id && locked.has(id)) || hostRooms.some(room =>
    room.isFixed || locked.has(room.id) || locked.has(room.unitId ?? '')
    || room.type === RoomType.Lift || room.type === RoomType.Staircase)) {
    throw new Error('The opening touches a locked room, flat, wall or circulation core.');
  }

  let doors = floor.doors.filter(item => item.id !== previous?.id);
  let windows = floor.windows.filter(item => item.id !== previous?.id);
  if (edit.action !== 'remove') {
    const resolvedHost = hostWallLengthAndPointAt(host, edit.offsetMm);
    if (!resolvedHost || !Number.isFinite(edit.widthMm) || edit.widthMm <= 0) {
      throw new Error('Enter a positive width and a centre distance within the host wall.');
    }
    const { position } = resolvedHost;
    if (!openingFitsApartmentWall(host, position, edit.widthMm)) {
      throw new Error('The opening does not fit this wall. Reduce its width or move the centre away from the wall ends.');
    }
    const otherOpenings = [...doors, ...windows].filter(item => item.wallId === host.id);
    const hasCollision = otherOpenings.some(item => {
      if (host.arc) {
        try {
          const curved = canonicalCurvedOpeningGeometry(item, host);
          return edit.offsetMm + edit.widthMm / 2 > curved.start && edit.offsetMm - edit.widthMm / 2 < curved.end;
        } catch {
          return Math.hypot(item.position.x - position.x, item.position.y - position.y) < (item.width + edit.widthMm) / 2 + 20;
        }
      }
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
      const sides = door?.connectsRooms ?? (host.roomIds.length === 2 ? [host.roomIds[0]!, host.roomIds[1]!] as const : host.roomIds.length === 1 ? [host.roomIds[0]!, '__outside__'] as const : undefined);
      if (!sides || !sides.every(id => host.roomIds.includes(id) || (id === '__outside__' && host.roomIds.length === 1))) {
        throw new Error('Select a wall shared by the two spaces served by this door.');
      }
      const nextHeight = edit.heightMm ?? door?.height ?? 2100;
      const nextSwing = edit.swingDirection ?? door?.swingDirection ?? SwingDirection.Left;
      if (nextHeight <= 0 || nextHeight > floor.floorHeight) {
        throw new Error('Door height must be positive and not exceed storey height.');
      }
      const next: Door = {
        ...(door ?? createDoor({ ...props, height: nextHeight, swingDirection: nextSwing, connectsRooms: [sides[0], sides[1]] })),
        ...props,
        height: nextHeight,
        swingDirection: nextSwing,
      };
      const revised = { ...next, id: door?.id ?? stableValueHash({ kind: 'door', revision: building.version, ...props }), widthMm: next.width };
      doors = door ? floor.doors.map(item => item.id === door.id ? revised : item) : [...doors, revised];
    } else {
      const owners = hostRooms.filter(room => host.roomIds.includes(room.id) && architecturalSpaceRole(room) !== 'OPEN_TO_SKY_VOID');
      const ownerId = window?.roomId ?? (owners.length === 1 ? owners[0]!.id : owners[0]?.id);
      if (!ownerId || !host.roomIds.includes(ownerId)) throw new Error('Select a wall serving the window’s room.');
      const nextSill = edit.sillHeightMm ?? window?.sillHeight ?? 900;
      const nextHeight = edit.heightMm ?? window?.height ?? 1200;
      if (nextSill < 0 || nextHeight <= 0 || nextSill + nextHeight > floor.floorHeight) {
        throw new Error('Window sill height plus window height must fit within the storey height.');
      }
      const next: Window = {
        ...(window ?? createWindow({ ...props, roomId: ownerId, height: nextHeight, sillHeight: nextSill })),
        ...props,
        height: nextHeight,
        sillHeight: nextSill,
      };
      const revised = { ...next, id: window?.id ?? stableValueHash({ kind: 'window', revision: building.version, ...props }), widthMm: next.width };
      windows = window ? floor.windows.map(item => item.id === window.id ? revised : item) : [...windows, revised];
    }
  }

  const activeHosts = new Set([...doors, ...windows].map(item => item.wallId));
  const affectedHosts = new Set([host.id, oldHost?.id]);
  const editedFloor: Floor = { ...floor, doors, windows, walls: floor.walls.map(wall => {
    if (!affectedHosts.has(wall.id) || wall.hasOpening === activeHosts.has(wall.id)) return wall;
    return { ...wall, hasOpening: activeHosts.has(wall.id) };
  }) };
  if (!floor.apartmentUnits?.length) {
    const rawNext = withArchitecturalElements({
      ...building,
      version: building.version + 1,
      updatedAt: new Date().toISOString(),
      floors: building.floors.map(item => item.id === floorId ? editedFloor : item),
    });
    const schemaErr = validateBuildingSchema(rawNext)[0];
    if (schemaErr) throw new Error(schemaErr.message);
    return {
      ...rawNext,
      floors: rawNext.floors.map(item => item.id === floorId ? item : building.floors.find(b => b.id === item.id)!),
    };
  }
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
  const rawNext = { ...building, version: building.version + 1, updatedAt: new Date().toISOString(),
    floors: building.floors.map(item => item.id === floorId ? { ...editedFloor, architecture: undefined } : item),
    complianceRating: undefined, mepEngineering: undefined,
    metadata: { ...building.metadata, generationReport: previousReport && { ...previousReport, floorAreas, areaTargetDiagnostic: refreshedTarget } },
  };
  const projected = withArchitecturalElements(rawNext);
  const next = {
    ...projected,
    floors: projected.floors.map(item => item.id === floorId ? item : building.floors.find(before => before.id === item.id)!),
  };
  const schemaIssue = validateBuildingSchema(next)[0];
  if (schemaIssue) throw new Error(schemaIssue.message);
  const geometry = new GeometryValidator({ autoCorrect: false, columnMergeThresholdMm: MIN_PROVISIONAL_COLUMN_SPACING_MM })
    .audit(next, false).report;
  const blockingGeometry = geometry.errors.find(issue => issue.severity === 'CRITICAL' && !issue.autoCorrected);
  if (blockingGeometry) throw new Error(blockingGeometry.description);
  const closure = validateApartmentClosure({ ...next, floors: [next.floors.find(f => f.id === floorId)!] });
  const issue = closure.issues.find(item => item.severity === 'error');
  if (issue) throw new Error(issue.message);
  return { ...next,
    metadata: { ...next.metadata,
      ...(brief ? { generationBrief: { ...brief, physicalLayoutHash: physicalLayoutHash(next) } } : {}),
    },
  };
}

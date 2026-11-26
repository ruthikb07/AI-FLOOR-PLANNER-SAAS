/**
 * Typed Adapter between RH Planner's Canonical `Building` Model (`mm`) and
 * OpenBIM Studio's World Space (`m`, right-handed Y-up), Clash Items, IDS
 * Inspectable Entities, 5D QTO Takeoff Rows, and Validated BIM Authoring Edits.
 *
 * Coordinate Convention (Applied Exactly Once):
 *   Canonical `(x, y, z)` mm: `x` = right, `y` = down, `z` = elevation up
 *   OpenBIM World `(X, Y, Z)` m: `X = x / 1000`, `Y = z / 1000`, `Z = -y / 1000`
 */
import * as THREE from 'three';
import {
  DoorType,
  canonicalBuildingHash,
  exchangeRevision,
  validateBuildingSchema,
  type Building,
  type CanonicalExchangeRevision,
  type Floor,
} from '@ai-floor-planner/core';
import { generationBlockingFindings, validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { fitFloorOpeningsInsideWalls, polygonArea } from '@ai-floor-planner/geometry-engine';
import { projectBuildingTo3D } from '@ai-floor-planner/projection-3d';
import { runClashDetection, type ClashCoreItem, type ClashMethod, type ClashRules, type ElementClash } from '../clash/clash-core';
import type { Tri } from '../clash/geometry';
import { stableIfcGuid } from '../ifc-semantics/ifc-guid';
import type { IdsInspectableElement } from '../ids/ids-engine';
import { BUILTIN_CLASSIFICATION_SYSTEMS } from '../schedules/cobie-exporter';
import { resolveElementClassification, type ScheduleAssignmentLike } from '../schedules/schedule-classification';
import type { TakeoffRow } from '../schedules/types';

export interface OpenBimWorldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Forward transform: Canonical `(x, y, z)` mm -> OpenBIM World `{ x, y, z }` metres (applied once). */
export function canonicalToOpenBimWorld(xMm: number, yMm: number, zMm = 0): OpenBimWorldPoint {
  return {
    x: xMm / 1000,
    y: zMm / 1000,
    z: -yMm / 1000,
  };
}

/** Inverse transform: OpenBIM World `{ x, y, z }` metres -> Canonical `{ x, y, z }` mm (applied once). */
export function openBimWorldToCanonical(world: OpenBimWorldPoint): { x: number; y: number; z: number } {
  return {
    x: world.x * 1000,
    y: -world.z * 1000,
    z: world.y * 1000,
  };
}

function boxToTris(box: THREE.Box3): Tri[] {
  const { min: a, max: b } = box;
  const corners: [number, number, number][] = [
    [a.x, a.y, a.z], [b.x, a.y, a.z], [b.x, b.y, a.z], [a.x, b.y, a.z],
    [a.x, a.y, b.z], [b.x, a.y, b.z], [b.x, b.y, b.z], [a.x, b.y, b.z],
  ];
  const quads: [number, number, number, number][] = [
    [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4],
    [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4],
  ];
  const tris: Tri[] = [];
  for (const [i0, i1, i2, i3] of quads) {
    const p0 = corners[i0]!, p1 = corners[i1]!, p2 = corners[i2]!, p3 = corners[i3]!;
    tris.push(new Float32Array([...p0, ...p1, ...p2]), new Float32Array([...p0, ...p2, ...p3]));
  }
  return tris;
}

export interface ProjectedOpenBimModel {
  readonly source: CanonicalExchangeRevision;
  readonly elements: readonly IdsInspectableElement[];
  readonly clashItems: readonly ClashCoreItem[];
  readonly takeoffRows: readonly TakeoffRow[];
  readonly localIdToCanonical: ReadonlyMap<number, { canonicalId: string; kind: string; floorId: string }>;
}

export function projectCanonicalBuildingToOpenBim(
  building: Building,
  options: {
    readonly assignments?: readonly ScheduleAssignmentLike[];
    readonly customProperties?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  } = {},
): ProjectedOpenBimModel {
  const source = exchangeRevision(building);
  const proj3d = projectBuildingTo3D(building);
  const elevByFloor = new Map(proj3d.levels.map(l => [l.floorId, l.elevation * 1000]));
  const assignments = options.assignments ?? [];
  const customProps = options.customProperties ?? {};

  const elements: IdsInspectableElement[] = [];
  const clashItems: ClashCoreItem[] = [];
  const takeoffRows: TakeoffRow[] = [];
  const localIdToCanonical = new Map<number, { canonicalId: string; kind: string; floorId: string }>();
  let nextLocalId = 1;

  for (const floor of building.floors) {
    const baseZMm = elevByFloor.get(floor.id) ?? floor.level * (floor.floorHeight || 3000);
    const heightMm = floor.floorHeight || 3000;

    // Floor Slab
    if (floor.boundary.points.length >= 3) {
      const slabThickMm = floor.slabThicknessMm ?? 150;
      const areaSqm = polygonArea(floor.boundary) / 1e6;
      const volM3 = areaSqm * (slabThickMm / 1000);
      const slabId = `${floor.id}::slab`;
      const cls = resolveElementClassification(slabId, assignments, BUILTIN_CLASSIFICATION_SYSTEMS);
      const xs = floor.boundary.points.map(p => p.x / 1000);
      const zs = floor.boundary.points.map(p => -p.y / 1000);
      const yTop = baseZMm / 1000;
      const yBot = (baseZMm - slabThickMm) / 1000;
      const box = new THREE.Box3(
        new THREE.Vector3(Math.min(...xs), yBot, Math.min(...zs)),
        new THREE.Vector3(Math.max(...xs), yTop, Math.max(...zs)),
      );
      const localId = nextLocalId++;
      localIdToCanonical.set(localId, { canonicalId: slabId, kind: 'slab', floorId: floor.id });
      clashItems.push({
        modelId: 'canonical-arch',
        localId,
        name: `${floor.name} Slab`,
        category: 'IFCSLAB',
        box,
        tris: boxToTris(box),
      });
      elements.push({
        canonicalId: slabId,
        globalId: stableIfcGuid(building.id, slabId),
        ifcClass: 'IFCSLAB',
        name: `${floor.name} Slab`,
        floorId: floor.id,
        floorName: floor.name,
        material: 'RCC M25',
        classificationSystem: cls?.systemName ?? 'Uniclass 2015 (EF)',
        classificationCode: cls?.code ?? 'EF_30_20',
        attributes: { Name: `${floor.name} Slab`, ...(customProps[slabId] ?? {}) },
        propertySets: {
          Pset_SlabCommon: { IsExternal: false, LoadBearing: true, ThicknessMm: slabThickMm, AreaSqm: Number(areaSqm.toFixed(3)) },
        },
      });
      takeoffRows.push({
        key: `authored:${slabId}`,
        source: 'authored',
        label: `${floor.name} Slab`,
        detail: 'IFCSLAB · RCC M25',
        count: 1,
        length: 0,
        area: areaSqm,
        volume: volM3,
        thickness: slabThickMm / 1000,
        level: floor.name,
        classification: `${cls?.systemName ?? 'Uniclass 2015 (EF)'}: ${cls?.code ?? 'EF_30_20'}`,
        properties: { IsExternal: 'false', Material: 'RCC M25', ...(customProps[slabId] ?? {}) },
      });
    }

    // Rooms (`IFCSPACE`)
    for (const room of floor.rooms) {
      const areaSqm = Math.max(room.area || 0, polygonArea(room.boundary)) / 1e6;
      const cls = resolveElementClassification(room.id, assignments, BUILTIN_CLASSIFICATION_SYSTEMS);
      elements.push({
        canonicalId: room.id,
        globalId: stableIfcGuid(building.id, room.id),
        ifcClass: 'IFCSPACE',
        name: room.name,
        floorId: floor.id,
        floorName: floor.name,
        classificationSystem: cls?.systemName,
        classificationCode: cls?.code,
        attributes: { Name: room.name, ObjectType: room.type, ...(customProps[room.id] ?? {}) },
        propertySets: {
          Pset_SpaceCommon: {
            NetPlannedAreaSqm: Number(areaSqm.toFixed(3)),
            IsExternal: Boolean(room.openToSky || room.spaceUse === 'OUTDOOR'),
            Category: room.type,
          },
        },
      });
    }

    // Walls (`IFCWALL`)
    for (const wall of floor.walls) {
      const wallHeightMm = wall.heightMm || heightMm;
      const lenM = Math.hypot(wall.endPoint.x - wall.startPoint.x, wall.endPoint.y - wall.startPoint.y) / 1000;
      const hM = wallHeightMm / 1000;
      const tM = (wall.thickness || 230) / 1000;
      const areaM2 = lenM * hM;
      const volM3 = areaM2 * tM;
      const isExt = wall.wallUse === 'EXTERNAL' || (wall.thickness ?? 0) >= 200;
      const cls = resolveElementClassification(wall.id, assignments, BUILTIN_CLASSIFICATION_SYSTEMS);

      const p1 = canonicalToOpenBimWorld(wall.startPoint.x, wall.startPoint.y, baseZMm);
      const p2 = canonicalToOpenBimWorld(wall.endPoint.x, wall.endPoint.y, baseZMm + wallHeightMm);
      const halfT = tM / 2;
      const box = new THREE.Box3(
        new THREE.Vector3(Math.min(p1.x, p2.x) - halfT, p1.y, Math.min(p1.z, p2.z) - halfT),
        new THREE.Vector3(Math.max(p1.x, p2.x) + halfT, p2.y, Math.max(p1.z, p2.z) + halfT),
      );
      const localId = nextLocalId++;
      localIdToCanonical.set(localId, { canonicalId: wall.id, kind: 'wall', floorId: floor.id });
      clashItems.push({
        modelId: 'canonical-arch',
        localId,
        name: `Wall ${wall.id}`,
        category: 'IFCWALL',
        box,
        tris: boxToTris(box),
      });
      elements.push({
        canonicalId: wall.id,
        globalId: stableIfcGuid(building.id, wall.id),
        ifcClass: 'IFCWALL',
        name: `Wall ${wall.id}`,
        floorId: floor.id,
        floorName: floor.name,
        material: wall.material ?? (isExt ? 'AAC Masonry 230mm' : 'AAC Partition 115mm'),
        classificationSystem: cls?.systemName ?? 'Uniclass 2015 (EF)',
        classificationCode: cls?.code ?? (isExt ? 'EF_25_10_25' : 'EF_25_10_40'),
        attributes: { Name: `Wall ${wall.id}`, ...(customProps[wall.id] ?? {}) },
        propertySets: {
          Pset_WallCommon: {
            IsExternal: isExt,
            LoadBearing: isExt,
            ThicknessMm: wall.thickness || 230,
          },
        },
      });
      takeoffRows.push({
        key: `authored:${wall.id}`,
        source: 'authored',
        label: `Wall ${wall.id}`,
        detail: `IFCWALL · ${wall.thickness || 230}mm`,
        count: 1,
        length: lenM,
        area: areaM2,
        volume: volM3,
        height: hM,
        thickness: tM,
        level: floor.name,
        classification: `${cls?.systemName ?? 'Uniclass 2015 (EF)'}: ${cls?.code ?? (isExt ? 'EF_25_10_25' : 'EF_25_10_40')}`,
        properties: { IsExternal: String(isExt), ThicknessMm: String(wall.thickness || 230), ...(customProps[wall.id] ?? {}) },
      });
    }

    // Doors (`IFCDOOR`) & Windows (`IFCWINDOW`)
    for (const door of floor.doors) {
      if (door.type === DoorType.OpenPassage) continue;
      const cls = resolveElementClassification(door.id, assignments, BUILTIN_CLASSIFICATION_SYSTEMS);
      const areaM2 = (door.width * door.height) / 1e6;
      elements.push({
        canonicalId: door.id,
        globalId: stableIfcGuid(building.id, door.id),
        ifcClass: 'IFCDOOR',
        name: `Door ${door.id}`,
        floorId: floor.id,
        floorName: floor.name,
        material: 'Engineered Timber',
        classificationSystem: cls?.systemName ?? 'Uniclass 2015 (EF)',
        classificationCode: cls?.code ?? 'EF_25_30_25',
        attributes: { Name: `Door ${door.id}`, ...(customProps[door.id] ?? {}) },
        propertySets: {
          Pset_OpeningCommon: { WidthMm: door.width, HeightMm: door.height, HostWallId: door.wallId },
          Pset_DoorCommon: { FireRating: customProps[door.id]?.FireRating ?? 'ND', IsExternal: false },
        },
      });
      takeoffRows.push({
        key: `authored:${door.id}`,
        source: 'authored',
        label: `Door ${door.id}`,
        detail: `IFCDOOR · ${door.width}x${door.height}mm`,
        count: 1,
        length: door.width / 1000,
        area: areaM2,
        volume: areaM2 * 0.045,
        width: door.width / 1000,
        height: door.height / 1000,
        level: floor.name,
        classification: `${cls?.systemName ?? 'Uniclass 2015 (EF)'}: ${cls?.code ?? 'EF_25_30_25'}`,
        properties: { WidthMm: String(door.width), HeightMm: String(door.height), ...(customProps[door.id] ?? {}) },
      });
    }

    for (const win of floor.windows) {
      const cls = resolveElementClassification(win.id, assignments, BUILTIN_CLASSIFICATION_SYSTEMS);
      const areaM2 = (win.width * win.height) / 1e6;
      elements.push({
        canonicalId: win.id,
        globalId: stableIfcGuid(building.id, win.id),
        ifcClass: 'IFCWINDOW',
        name: `Window ${win.id}`,
        floorId: floor.id,
        floorName: floor.name,
        material: 'Powder-Coated Aluminium + DGU Glass',
        classificationSystem: cls?.systemName ?? 'Uniclass 2015 (EF)',
        classificationCode: cls?.code ?? 'EF_25_30_95',
        attributes: { Name: `Window ${win.id}`, ...(customProps[win.id] ?? {}) },
        propertySets: {
          Pset_OpeningCommon: { WidthMm: win.width, HeightMm: win.height, SillHeightMm: win.sillHeight ?? 900, HostWallId: win.wallId },
          Pset_WindowCommon: { ThermalTransmittance: 2.8, IsExternal: true },
        },
      });
      takeoffRows.push({
        key: `authored:${win.id}`,
        source: 'authored',
        label: `Window ${win.id}`,
        detail: `IFCWINDOW · ${win.width}x${win.height}mm`,
        count: 1,
        length: win.width / 1000,
        area: areaM2,
        volume: areaM2 * 0.06,
        width: win.width / 1000,
        height: win.height / 1000,
        level: floor.name,
        classification: `${cls?.systemName ?? 'Uniclass 2015 (EF)'}: ${cls?.code ?? 'EF_25_30_95'}`,
        properties: { WidthMm: String(win.width), HeightMm: String(win.height), ...(customProps[win.id] ?? {}) },
      });
    }

    // Columns (`IFCCOLUMN`)
    for (const col of floor.columns ?? []) {
      const wM = (col.width ?? 300) / 1000;
      const dM = (col.depth ?? 450) / 1000;
      const hM = heightMm / 1000;
      const cWorld = canonicalToOpenBimWorld(col.position.x, col.position.y, baseZMm);
      const box = new THREE.Box3(
        new THREE.Vector3(cWorld.x - wM / 2, cWorld.y, cWorld.z - dM / 2),
        new THREE.Vector3(cWorld.x + wM / 2, cWorld.y + hM, cWorld.z + dM / 2),
      );
      const localId = nextLocalId++;
      localIdToCanonical.set(localId, { canonicalId: col.id, kind: 'column', floorId: floor.id });
      clashItems.push({
        modelId: 'canonical-arch',
        localId,
        name: `Column ${col.id}`,
        category: 'IFCCOLUMN',
        box,
        tris: boxToTris(box),
      });
      elements.push({
        canonicalId: col.id,
        globalId: stableIfcGuid(building.id, col.id),
        ifcClass: 'IFCCOLUMN',
        name: `Column ${col.id}`,
        floorId: floor.id,
        floorName: floor.name,
        material: 'RCC M30',
        classificationSystem: 'Uniclass 2015 (EF)',
        classificationCode: 'EF_20_10',
        attributes: { Name: `Column ${col.id}` },
        propertySets: { Pset_ColumnCommon: { LoadBearing: true, WidthMm: col.width ?? 300, DepthMm: col.depth ?? 450 } },
      });
    }
  }

  return { source, elements, clashItems, takeoffRows, localIdToCanonical };
}

export interface FederatedBoxPrismInput {
  readonly modelId: string;
  readonly globalId: string;
  readonly ifcClass: string;
  readonly name: string;
  readonly minXMm: number;
  readonly maxXMm: number;
  readonly minYMm: number;
  readonly maxYMm: number;
  readonly bottomMm: number;
  readonly topMm: number;
}

export async function runFederatedOpenBimClashCheck(params: {
  readonly projected: ProjectedOpenBimModel;
  readonly federatedPrisms: readonly FederatedBoxPrismInput[];
  readonly method?: ClashMethod;
  readonly rules?: Partial<ClashRules>;
}): Promise<ElementClash[]> {
  const { projected, federatedPrisms, method = 'hard-triangle', rules = {} } = params;
  const items: ClashCoreItem[] = [...projected.clashItems];
  const sides: number[] = projected.clashItems.map(() => 1);
  let refLocalId = 100_000;

  for (const prism of federatedPrisms) {
    const pMin = canonicalToOpenBimWorld(prism.minXMm, prism.maxYMm, prism.bottomMm);
    const pMax = canonicalToOpenBimWorld(prism.maxXMm, prism.minYMm, prism.topMm);
    const box = new THREE.Box3(
      new THREE.Vector3(Math.min(pMin.x, pMax.x), Math.min(pMin.y, pMax.y), Math.min(pMin.z, pMax.z)),
      new THREE.Vector3(Math.max(pMin.x, pMax.x), Math.max(pMin.y, pMax.y), Math.max(pMin.z, pMax.z)),
    );
    items.push({
      modelId: prism.modelId,
      localId: refLocalId++,
      name: `${prism.ifcClass} ${prism.name || prism.globalId}`,
      category: prism.ifcClass,
      box,
      tris: boxToTris(box),
    });
    sides.push(2);
  }

  if (federatedPrisms.length === 0) return [];
  return runClashDetection(items, {
    method,
    sides,
    groups: [],
    selfPairs: false,
    rules: {
      tolerance: rules.tolerance ?? 0.002,
      clearance: rules.clearance ?? 0.05,
      lowerBound: rules.lowerBound ?? 0,
      minVolume: rules.minVolume ?? 1e-6,
      ignoreIdentical: rules.ignoreIdentical ?? false,
      ignoreSameCategory: rules.ignoreSameCategory ?? false,
    },
  });
}

export interface BimCanonicalEditInput {
  readonly currentBuilding: Building;
  readonly expectedSource: CanonicalExchangeRevision;
  readonly floorId: string;
  readonly entityKind: 'wall' | 'door' | 'window' | 'slab';
  readonly canonicalId: string;
  readonly patch: {
    readonly thicknessMm?: number;
    readonly widthMm?: number;
    readonly heightMm?: number;
    readonly sillHeightMm?: number;
    readonly material?: string;
  };
}

export interface BimCanonicalEditResult {
  readonly ok: boolean;
  readonly staleRevision: boolean;
  readonly summary: string;
  readonly blockingFindings: readonly string[];
  readonly candidateBuilding?: Building;
}

export function proposeOpenBimCanonicalEdit(input: BimCanonicalEditInput): BimCanonicalEditResult {
  const { currentBuilding, expectedSource, floorId, entityKind, canonicalId, patch } = input;
  const currentSha = canonicalBuildingHash(currentBuilding);
  if (currentBuilding.version !== expectedSource.revision || currentSha !== expectedSource.sha256) {
    return {
      ok: false,
      staleRevision: true,
      summary: 'Stale BIM model revision.',
      blockingFindings: [
        `Expected revision ${expectedSource.revision}, but active canonical Building is revision ${currentBuilding.version}.`,
      ],
    };
  }

  const fIdx = currentBuilding.floors.findIndex(f => f.id === floorId);
  if (fIdx < 0) {
    return { ok: false, staleRevision: false, summary: 'Floor not found.', blockingFindings: [`Floor ${floorId} not found.`] };
  }
  const sourceFloor = currentBuilding.floors[fIdx]!;
  let updatedFloor: Floor = sourceFloor;
  let summary = '';

  if (entityKind === 'wall') {
    const wIdx = sourceFloor.walls.findIndex(w => w.id === canonicalId);
    if (wIdx < 0) return { ok: false, staleRevision: false, summary: 'Wall not found.', blockingFindings: [`Wall ${canonicalId} not found.`] };
    const wall = sourceFloor.walls[wIdx]!;
    const isExtOrParty = wall.wallUse === 'EXTERNAL' || wall.wallUse === 'UNIT_SEPARATION';
    const nextThickness = patch.thicknessMm ?? wall.thickness;
    if (isExtOrParty && nextThickness < 230) {
      return {
        ok: false,
        staleRevision: false,
        summary: 'Exterior/party wall thickness rejected.',
        blockingFindings: [`Indian residential exterior/unit-separation walls require >= 230 mm thickness (requested ${nextThickness} mm).`],
      };
    }
    if (nextThickness < 100 || nextThickness > 600) {
      return {
        ok: false,
        staleRevision: false,
        summary: 'Wall thickness out of range.',
        blockingFindings: [`Wall thickness must be between 100 mm and 600 mm (requested ${nextThickness} mm).`],
      };
    }
    const nextWalls = sourceFloor.walls.map((w, i) =>
      i === wIdx
        ? { ...w, thickness: nextThickness, ...(patch.material ? { material: patch.material } : {}) }
        : w,
    );
    updatedFloor = { ...sourceFloor, walls: nextWalls };
    summary = `BIM Wall ${canonicalId}: thickness=${nextThickness} mm${patch.material ? `, material=${patch.material}` : ''}`;
  } else if (entityKind === 'door') {
    const dIdx = sourceFloor.doors.findIndex(d => d.id === canonicalId);
    if (dIdx < 0) return { ok: false, staleRevision: false, summary: 'Door not found.', blockingFindings: [`Door ${canonicalId} not found.`] };
    const door = sourceFloor.doors[dIdx]!;
    const nextW = patch.widthMm ?? door.width;
    const nextH = patch.heightMm ?? door.height;
    if (nextW < 600 || nextW > 2400 || nextH < 1800 || nextH > 2800) {
      return {
        ok: false,
        staleRevision: false,
        summary: 'Door size out of architectural bounds.',
        blockingFindings: [`Door dimensions ${nextW}×${nextH} mm exceed 600–2400 × 1800–2800 mm bounds.`],
      };
    }
    const nextDoors = sourceFloor.doors.map((d, i) => (i === dIdx ? { ...d, width: nextW, height: nextH } : d));
    updatedFloor = { ...sourceFloor, doors: nextDoors };
    summary = `BIM Door ${canonicalId}: ${nextW} × ${nextH} mm`;
  } else if (entityKind === 'window') {
    const wIdx = sourceFloor.windows.findIndex(w => w.id === canonicalId);
    if (wIdx < 0) return { ok: false, staleRevision: false, summary: 'Window not found.', blockingFindings: [`Window ${canonicalId} not found.`] };
    const win = sourceFloor.windows[wIdx]!;
    const nextW = patch.widthMm ?? win.width;
    const nextH = patch.heightMm ?? win.height;
    const nextSill = patch.sillHeightMm ?? win.sillHeight ?? 900;
    if (nextW < 450 || nextW > 3600 || nextH < 450 || nextH > 2600 || nextSill < 0 || nextSill + nextH > (sourceFloor.floorHeight || 3000)) {
      return {
        ok: false,
        staleRevision: false,
        summary: 'Window dimensions exceed storey envelope.',
        blockingFindings: [`Window ${nextW}×${nextH} mm @ ${nextSill} mm sill exceeds storey clear height.`],
      };
    }
    const nextWindows = sourceFloor.windows.map((w, i) =>
      i === wIdx ? { ...w, width: nextW, height: nextH, sillHeight: nextSill } : w,
    );
    updatedFloor = { ...sourceFloor, windows: nextWindows };
    summary = `BIM Window ${canonicalId}: ${nextW} × ${nextH} mm (sill ${nextSill} mm)`;
  } else {
    const nextSlab = patch.thicknessMm ?? sourceFloor.slabThicknessMm ?? 150;
    if (nextSlab < 100 || nextSlab > 450) {
      return {
        ok: false,
        staleRevision: false,
        summary: 'Slab thickness out of range.',
        blockingFindings: [`Slab thickness must be between 100 mm and 450 mm.`],
      };
    }
    updatedFloor = { ...sourceFloor, slabThicknessMm: nextSlab };
    summary = `BIM Slab ${sourceFloor.name}: thickness=${nextSlab} mm`;
  }

  const fittedFloor = fitFloorOpeningsInsideWalls(updatedFloor);
  const next: Building = {
    ...currentBuilding,
    floors: currentBuilding.floors.map((f, i) => (i === fIdx ? fittedFloor : f)),
    version: currentBuilding.version + 1,
    updatedAt: new Date().toISOString(),
  };

  const baselineBlockers = new Set<string>([
    ...validateApartmentClosure(currentBuilding).issues
      .filter(i => i.severity === 'error')
      .map(i => `${i.code}: ${i.message}`),
    ...generationBlockingFindings(currentBuilding).map(f => `${f.code}: ${f.message}`),
  ]);

  const schemaErrors = validateBuildingSchema(next);
  const closure = validateApartmentClosure(next);
  const candidateFindings = [
    ...closure.issues.filter(i => i.severity === 'error').map(i => `${i.code}: ${i.message}`),
    ...generationBlockingFindings(next).map(f => `${f.code}: ${f.message}`),
  ];
  const blockers = [
    ...schemaErrors.map(e => `${e.path}: ${e.message}`),
    ...candidateFindings.filter(b => !baselineBlockers.has(b)),
  ];

  return {
    ok: blockers.length === 0,
    staleRevision: false,
    summary,
    blockingFindings: blockers,
    ...(blockers.length === 0 ? { candidateBuilding: next } : {}),
  };
}

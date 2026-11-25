import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getModelBounds, isModelClick, modelFitDistance } from '../../services/model-camera';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { EditorSelection, PlancraftFurnitureElementType, Point, Polygon } from '@ai-floor-planner/core';
import { DoorType } from '@ai-floor-planner/core';
import { computeStairSolids } from '@ai-floor-planner/geometry-engine';
import { makeProjectionShape as makeShape } from './projection-shape';
import {
  millimetersToSceneUnits,
  furnitureSolidHeightMm,
  slabSolidRegions,
  type Building3DProjection,
  type ProjectionSource,
} from '@ai-floor-planner/projection-3d';
import {
  type ModelCameraPreset,
  type ModelFloorMode,
  type ModelLayerVisibility,
  type ModelViewMode,
} from '../../services/projection-preferences';

const MM_TO_M = millimetersToSceneUnits(1);
const EXPLODED_GAP_M = 1.8;

export type ArchitecturalMaterialPalette = 'travertine' | 'concrete' | 'coastal';
export type BuildingLightingMode = 'day' | 'golden' | 'night';
export type FurnitureCategoryId =
  | 'bed_master'
  | 'sofa_living'
  | 'dining_set'
  | 'wardrobe_full'
  | 'kitchen_modular'
  | 'bath_fixtures';

export const ALL_FURNITURE_CATEGORY_IDS: readonly FurnitureCategoryId[] = [
  'bed_master',
  'sofa_living',
  'dining_set',
  'wardrobe_full',
  'kitchen_modular',
  'bath_fixtures',
] as const;

const furniturePresentation: Partial<Record<PlancraftFurnitureElementType, {
  category: FurnitureCategoryId;
  role: MaterialRoleKey;
}>> = {
  bed: { category: 'bed_master', role: 'furnBed' },
  sofa: { category: 'sofa_living', role: 'furnWood' },
  l_sofa: { category: 'sofa_living', role: 'furnWood' },
  sectional_sofa: { category: 'sofa_living', role: 'furnWood' },
  table: { category: 'dining_set', role: 'furnWood' },
  round_table: { category: 'dining_set', role: 'furnWood' },
  chair: { category: 'dining_set', role: 'furnWood' },
  wardrobe: { category: 'wardrobe_full', role: 'furnWood' },
  counter: { category: 'kitchen_modular', role: 'furnStone' },
  fridge: { category: 'kitchen_modular', role: 'furnStone' },
  toilet: { category: 'bath_fixtures', role: 'furnCeramic' },
  bathtub: { category: 'bath_fixtures', role: 'furnCeramic' },
  shower: { category: 'bath_fixtures', role: 'furnCeramic' },
  sink: { category: 'bath_fixtures', role: 'furnCeramic' },
};
export interface OpeningFinishOverride {
  readonly frameColorHex?: number;
  readonly doorColorHex?: number;
  readonly glassColorHex?: number;
  readonly glassOpacity?: number;
}

export interface ThreeBuildingSceneProps {
  readonly projection: Building3DProjection;
  readonly activeFloorId: string;
  readonly selection: EditorSelection | null;
  readonly viewMode: ModelViewMode;
  readonly cameraPreset: ModelCameraPreset;
  readonly floorMode: ModelFloorMode;
  readonly exploded: boolean;
  readonly explodeDistance?: number;
  readonly lightingMode?: BuildingLightingMode;
  readonly materialPalette?: ArchitecturalMaterialPalette;
  readonly openingFinish?: OpeningFinishOverride;
  readonly enabledFurnitureCategories?: readonly FurnitureCategoryId[];
  readonly sectionCut?: boolean;
  readonly parallelProjection?: boolean;
  readonly walkthroughActive?: boolean;
  readonly walkCommand?: { readonly action: 'forward' | 'backward' | 'left' | 'right'; readonly seq: number };
  readonly zoomCommand?: { readonly dir: 'in' | 'out'; readonly seq: number };
  readonly linkedSpanStoreys?: 1 | 2 | 3;
  readonly layers: ModelLayerVisibility;
  readonly fitRequest: number;
  readonly fitSite?: boolean;
  readonly snapshotRequest?: number;
  readonly onSelect: (source: ProjectionSource) => void;
  readonly onClearSelection: () => void;
  readonly sceneRef?: React.MutableRefObject<THREE.Scene | null>;
}

const MATERIAL_PALETTES: Record<
  ArchitecturalMaterialPalette,
  {
    wall: number;
    wallRoughness: number;
    spandrel: number;
    teak: number;
    bronze: number;
    slab: number;
    trim: number;
    door: number;
    glass: number;
    stair: number;
    lawn: number;
    road: number;
  }
> = {
  travertine: {
    wall: 0xeae5dc,
    wallRoughness: 0.78,
    spandrel: 0x222730,
    teak: 0x8c5e3c,
    bronze: 0x3b2f27,
    slab: 0xd9d2c5,
    trim: 0x2a2f38,
    door: 0x7a4f30,
    glass: 0x5686a6,
    stair: 0xc9a068,
    lawn: 0x7c9872,
    road: 0x3a404a,
  },
  concrete: {
    wall: 0xd0d6de,
    wallRoughness: 0.72,
    spandrel: 0x1c222b,
    teak: 0x7d5336,
    bronze: 0x2b313b,
    slab: 0xbec6d2,
    trim: 0x202630,
    door: 0x623d20,
    glass: 0x5384ad,
    stair: 0x94a3b8,
    lawn: 0x718d6a,
    road: 0x323943,
  },
  coastal: {
    wall: 0xf4ead8,
    wallRoughness: 0.82,
    spandrel: 0x2a323d,
    teak: 0xa16c44,
    bronze: 0x4d3a2c,
    slab: 0xe3d6c2,
    trim: 0x363d48,
    door: 0x8c5530,
    glass: 0x4292ba,
    stair: 0xcda06e,
    lawn: 0x82a377,
    road: 0x454b56,
  },
};

type MaterialRoleKey =
  | 'wall'
  | 'slab'
  | 'spandrel'
  | 'teak'
  | 'bronze'
  | 'glass'
  | 'balustradeGlass'
  | 'door'
  | 'stair'
  | 'glow'
  | 'soffitLight'
  | 'uplight'
  | 'lawn'
  | 'road'
  | 'plinth'
  | 'paver'
  | 'trunk'
  | 'foliage'
  | 'roomTint'
  | 'furnBed'
  | 'furnWood'
  | 'furnStone'
  | 'furnCeramic';

interface MaterialBank {
  readonly active: Record<MaterialRoleKey, THREE.MeshStandardMaterial>;
  readonly dimmed: Record<MaterialRoleKey, THREE.MeshStandardMaterial>;
  readonly stairLinked: THREE.MeshStandardMaterial;
  readonly edgeLine: THREE.LineBasicMaterial;
  readonly envelopeLine: THREE.LineDashedMaterial;
  readonly linkLine: THREE.LineDashedMaterial;
  readonly selectHighlight: THREE.MeshStandardMaterial;
  readonly allMaterials: THREE.Material[];
}

interface FloorGroupRecord {
  readonly floorId: string;
  readonly floorIndex: number;
  readonly group: THREE.Group;
  readonly layers: {
    readonly floorPlates: THREE.Group;
    readonly ceilingSoffits: THREE.Group;
    readonly walls: THREE.Group;
    readonly openings: THREE.Group;
    readonly stairs: THREE.Group;
    readonly rooms: THREE.Group;
    readonly furnitureByCategory: Record<FurnitureCategoryId, THREE.Group>;
  };
  readonly meshes: Array<{ readonly mesh: THREE.Mesh; readonly role: MaterialRoleKey; readonly isStair?: boolean }>;
}

function createProceduralRoughnessMap(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#c8c8c8';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 2) {
    const band = 194 + Math.round(Math.sin(y * 0.42) * 10);
    ctx.fillStyle = `rgb(${band},${band},${band})`;
    ctx.fillRect(0, y, 128, 2);
  }
  for (let i = 0; i < 850; i++) {
    const x = (i * 47) % 128;
    const y = (i * 83) % 128;
    const v = 172 + ((i * 29) % 48);
    ctx.fillStyle = `rgba(${v},${v},${v},0.32)`;
    ctx.fillRect(x, y, 2, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.needsUpdate = true;
  return tex;
}

function createProceduralTeakSlatTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#8C5E3C';
  ctx.fillRect(0, 0, 256, 256);
  const slatCount = 12;
  const slatH = 256 / slatCount;
  for (let i = 0; i < slatCount; i++) {
    const y = i * slatH;
    const shade = (i % 3) * 7 - 7;
    ctx.fillStyle = `rgb(${140 + shade},${94 + Math.round(shade * 0.7)},${60 + Math.round(shade * 0.5)})`;
    ctx.fillRect(0, y + 2, 256, slatH - 3);
    ctx.fillStyle = 'rgba(72, 42, 22, 0.22)';
    ctx.fillRect(0, y + slatH * 0.45, 256, 1.5);
    ctx.fillStyle = '#3a2214';
    ctx.fillRect(0, y, 256, 2.2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.5, 2.5);
  tex.needsUpdate = true;
  return tex;
}

function createSkyDomeTexture(mode: BuildingLightingMode): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  if (mode === 'night') {
    grad.addColorStop(0.0, '#050915');
    grad.addColorStop(0.45, '#0b1529');
    grad.addColorStop(0.68, '#162744');
    grad.addColorStop(0.84, '#1b2b42');
    grad.addColorStop(1.0, '#0b101b');
  } else if (mode === 'golden') {
    grad.addColorStop(0.0, '#3e73b6');
    grad.addColorStop(0.32, '#6ea2d5');
    grad.addColorStop(0.56, '#c8ddf0');
    grad.addColorStop(0.72, '#f5d9b1');
    grad.addColorStop(0.86, '#fae8cc');
    grad.addColorStop(1.0, '#cfc3b3');
  } else {
    grad.addColorStop(0.0, '#3574bd');
    grad.addColorStop(0.38, '#75b0e2');
    grad.addColorStop(0.66, '#d3e9fa');
    grad.addColorStop(0.82, '#eef5fb');
    grad.addColorStop(1.0, '#d2d8de');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createMaterialBank(
  stoneNormal: THREE.Texture,
  roughnessMap: THREE.Texture | null,
  teakMap: THREE.Texture | null,
): MaterialBank {
  const pal = MATERIAL_PALETTES.travertine;
  const makeRoleSet = (dimFactor: number): Record<MaterialRoleKey, THREE.MeshStandardMaterial> => {
    const isDim = dimFactor < 1;
    const std = (
      color: number,
      roughness: number,
      metalness: number,
      opts: Partial<THREE.MeshStandardMaterialParameters> = {},
    ) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        side: THREE.DoubleSide,
        transparent: isDim || Boolean(opts.transparent),
        opacity: isDim ? Math.min(opts.opacity ?? 1, dimFactor) : (opts.opacity ?? 1),
        depthWrite: !isDim && (opts.depthWrite ?? !opts.transparent),
        ...opts,
      });

    const wall = std(pal.wall, pal.wallRoughness, 0.05, {
      normalMap: stoneNormal,
      normalScale: new THREE.Vector2(0.42, 0.42),
      ...(roughnessMap ? { roughnessMap, bumpMap: roughnessMap, bumpScale: 0.014 } : {}),
    });

    return {
      wall,
      slab: std(pal.slab, 0.72, 0.06),
      spandrel: std(pal.spandrel, 0.54, 0.14),
      teak: std(teakMap ? 0xffffff : pal.teak, 0.48, 0.06, { map: teakMap ?? undefined }),
      bronze: std(pal.bronze, 0.32, 0.72),
      // Fast physical-look low-E glass WITHOUT transmission double-scene render pass!
      glass: std(pal.glass, 0.07, 0.28, {
        transparent: true,
        opacity: isDim ? 0.16 : 0.56,
        envMapIntensity: 1.55,
        depthWrite: false,
      }),
      balustradeGlass: std(0x3b586e, 0.06, 0.22, {
        transparent: true,
        opacity: isDim ? 0.12 : 0.42,
        envMapIntensity: 1.45,
        depthWrite: false,
      }),
      door: std(pal.door, 0.48, 0.08),
      stair: std(pal.stair, 0.55, 0.1),
      glow: std(0xffd79a, 0.4, 0.02, {
        emissive: new THREE.Color(0xffac42),
        emissiveIntensity: 0.24,
        transparent: true,
        opacity: isDim ? 0.06 : 0.22,
        depthWrite: false,
      }),
      soffitLight: std(0xffe6b8, 0.25, 0.05, {
        emissive: new THREE.Color(0xffb44c),
        emissiveIntensity: 0.95,
      }),
      uplight: std(0xffd28c, 0.3, 0.1, {
        emissive: new THREE.Color(0xffaa3d),
        emissiveIntensity: 0.45,
      }),
      lawn: std(pal.lawn, 0.92, 0.02),
      road: std(pal.road, 0.88, 0.04),
      plinth: std(0xbcb3a5, 0.86, 0.04),
      paver: std(0xcbc2b4, 0.82, 0.04),
      trunk: std(0x5b4232, 0.9, 0.02),
      foliage: std(0x4a734d, 0.84, 0.02),
      // Strictly interior subtle floor-zone overlay (with polygonOffset + depthTest=true so it NEVER leaks onto exterior walls!)
      roomTint: std(0x7dd3fc, 0.65, 0.05, {
        transparent: true,
        opacity: isDim ? 0.08 : 0.22,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      furnBed: std(0xe5dfd5, 0.85, 0.02),
      furnWood: std(0x8b6843, 0.72, 0.06),
      furnStone: std(0x475569, 0.42, 0.18),
      furnCeramic: std(0xf8fafc, 0.25, 0.1),
    };
  };

  const active = makeRoleSet(1);
  const dimmed = makeRoleSet(0.2);
  const stairLinked = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    roughness: 0.45,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });
  const edgeLine = new THREE.LineBasicMaterial({ color: 0x8a7d6d, transparent: true, opacity: 0.24 });
  const envelopeLine = new THREE.LineDashedMaterial({ color: pal.trim, dashSize: 0.35, gapSize: 0.2 });
  const linkLine = new THREE.LineDashedMaterial({ color: 0xd97706, dashSize: 0.25, gapSize: 0.14 });
  const selectHighlight = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: new THREE.Color(0xd97706),
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: 0.52,
    roughness: 0.3,
    metalness: 0.15,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const allMaterials: THREE.Material[] = [
    ...Object.values(active),
    ...Object.values(dimmed),
    stairLinked,
    edgeLine,
    envelopeLine,
    linkLine,
    selectHighlight,
  ];

  return { active, dimmed, stairLinked, edgeLine, envelopeLine, linkLine, selectHighlight, allMaterials };
}

function normalizeForMerge(rawGeo: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = rawGeo.index ? rawGeo.toNonIndexed() : rawGeo.clone();
  if (!geo.getAttribute('normal')) {
    geo.computeVertexNormals();
  }
  const posAttr = geo.getAttribute('position');
  const uvAttr = geo.getAttribute('uv');
  if (!uvAttr && posAttr) {
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(posAttr.count * 2), 2));
  }
  // Keep ONLY position, normal, uv so mergeGeometries never rejects mismatched attributes
  for (const attrName of Object.keys(geo.attributes)) {
    if (attrName !== 'position' && attrName !== 'normal' && attrName !== 'uv') {
      geo.deleteAttribute(attrName);
    }
  }
  return geo;
}

class GeometryBatcher {
  private readonly buckets = new Map<MaterialRoleKey, THREE.BufferGeometry[]>();
  private readonly sources = new WeakMap<THREE.BufferGeometry, ProjectionSource>();
  source: ProjectionSource | undefined;

  add(role: MaterialRoleKey, geo: THREE.BufferGeometry, matrix?: THREE.Matrix4): void {
    const clean = normalizeForMerge(geo);
    geo.dispose();
    if (matrix) clean.applyMatrix4(matrix);
    if (this.source) this.sources.set(clean, this.source);
    const list = this.buckets.get(role);
    if (list) list.push(clean);
    else this.buckets.set(role, [clean]);
  }

  addBox(
    role: MaterialRoleKey,
    w: number,
    h: number,
    d: number,
    px: number,
    py: number,
    pz: number,
    rotY = 0,
  ): void {
    if (w <= 0.002 || h <= 0.002 || d <= 0.002) return;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.Matrix4();
    if (rotY !== 0) {
      mat.makeRotationY(rotY);
      mat.setPosition(px, py, pz);
    } else {
      mat.makeTranslation(px, py, pz);
    }
    this.add(role, geo, mat);
  }

  addCylinder(
    role: MaterialRoleKey,
    rTop: number,
    rBot: number,
    h: number,
    segs: number,
    px: number,
    py: number,
    pz: number,
  ): void {
    const geo = new THREE.CylinderGeometry(rTop, rBot, h, segs);
    const mat = new THREE.Matrix4().makeTranslation(px, py, pz);
    this.add(role, geo, mat);
  }

  flush(
    targetGroup: THREE.Group,
    bank: MaterialBank,
    meta: { readonly floorId?: string; readonly layerKind: string; readonly castShadow?: boolean; readonly receiveShadow?: boolean },
    collector?: Array<{ readonly mesh: THREE.Mesh; readonly role: MaterialRoleKey; readonly isStair?: boolean }>,
  ): void {
    for (const [role, geos] of this.buckets.entries()) {
      if (geos.length === 0) continue;
      const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false);
      if (geos.length > 1) {
        geos.forEach(g => g.dispose());
      }
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, bank.active[role]);
      const isTransparent = role === 'glass' || role === 'balustradeGlass' || role === 'glow' || role === 'roomTint';
      mesh.castShadow = Boolean(meta.castShadow && !isTransparent && role !== 'lawn' && role !== 'road' && role !== 'paver');
      mesh.receiveShadow = Boolean(meta.receiveShadow ?? !isTransparent);
      let nextFace = 0;
      const pickRanges: { from: number; to: number; source: ProjectionSource }[] = [];
      for (const geometry of geos) {
        const faceCount = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
        const source = this.sources.get(geometry);
        if (source) pickRanges.push({ from: nextFace, to: nextFace + faceCount, source });
        nextFace += faceCount;
      }
      mesh.userData = {
        pickRanges,
        floorId: meta.floorId,
        layerKind: meta.layerKind,
        materialRole: role,
      };
      targetGroup.add(mesh);
      collector?.push({ mesh, role, isStair: role === 'stair' });
    }
    this.buckets.clear();
  }
}

function openingPose(opening: Building3DProjection['openings'][number], wall: Building3DProjection['walls'][number]) {
  const center = opening.alongWall + opening.width / 2;
  if (wall.arc) {
    const arc = wall.arc;
    const sweep = arc.endAngleRad - arc.startAngleRad;
    const theta = arc.startAngleRad + Math.sign(sweep) * center / arc.radiusMm;
    const ux = -Math.sin(theta) * Math.sign(sweep);
    const uy = Math.cos(theta) * Math.sign(sweep);
    return { x: arc.center.x + arc.radiusMm * Math.cos(theta), y: arc.center.y + arc.radiusMm * Math.sin(theta), ux, uy };
  }
  const ux = (wall.endPoint.x - wall.startPoint.x) / wall.length;
  const uy = (wall.endPoint.y - wall.startPoint.y) / wall.length;
  return { x: wall.startPoint.x + ux * center, y: wall.startPoint.y + uy * center, ux, uy };
}

function disposeGeometryOnly(object: THREE.Object3D): void {
  object.traverse(child => {
    const mesh = child as THREE.Mesh | THREE.LineSegments | THREE.Line;
    mesh.geometry?.dispose();
  });
}

function pointInPolygon2D(pt: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const yi = poly[i]!.y;
    const xj = poly[j]!.x;
    const yj = poly[j]!.y;
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonCenter2D(points: readonly Point[]): Point {
  if (!points.length) return { x: 0, y: 0 };
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/** Pulls room overlay polygon strictly inside room walls by insetMm so blue tint NEVER pokes onto exterior facades. */
function insetPolygonTowardCenter(poly: Polygon, insetMm: number): Polygon {
  if (poly.points.length < 3) return poly;
  const center = polygonCenter2D(poly.points);
  return {
    points: poly.points.map(pt => {
      const dx = center.x - pt.x;
      const dy = center.y - pt.y;
      const d = Math.hypot(dx, dy);
      if (d <= insetMm * 1.4) return pt;
      const shift = Math.min(insetMm, d * 0.25);
      return { x: pt.x + (dx / d) * shift, y: pt.y + (dy / d) * shift };
    }),
  };
}

function isFloorInLinkedSpan(
  projection: Building3DProjection,
  floorId: string | undefined,
  activeFloorId: string,
  linkedSpanStoreys: 1 | 2 | 3,
): boolean {
  if (linkedSpanStoreys <= 1 || !floorId) return false;
  const activeIdx = projection.levels.findIndex(l => l.floorId === activeFloorId);
  const idx = projection.levels.findIndex(l => l.floorId === floorId);
  if (activeIdx < 0 || idx < 0) return false;
  return idx >= activeIdx && idx < activeIdx + linkedSpanStoreys;
}

export const ThreeBuildingScene: React.FC<ThreeBuildingSceneProps> = ({
  projection,
  activeFloorId,
  selection,
  viewMode,
  cameraPreset,
  floorMode,
  exploded,
  explodeDistance,
  lightingMode = 'golden',
  materialPalette = 'travertine',
  openingFinish,
  enabledFurnitureCategories,
  sectionCut = false,
  parallelProjection = false,
  walkthroughActive = false,
  walkCommand,
  zoomCommand,
  linkedSpanStoreys = 1,
  layers,
  fitRequest,
  fitSite = false,
  snapshotRequest = 0,
  onSelect,
  onClearSelection,
  sceneRef,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const pointerStart = useRef<{ x: number; y: number; id: number } | null>(null);
  const [renderError, setRenderError] = useState('');

  // Smooth rAF explode state refs (zero geometry rebuild when dragging explode slider!)
  const explodeCurrentGapRef = useRef(0);
  const explodeTargetGapRef = useRef(0);

  const runtimeRef = useRef<{
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    perspective: THREE.PerspectiveCamera;
    orthographic: THREE.OrthographicCamera;
    fitOrthographic: (halfHeight: number) => void;
    stoneNormal: THREE.Texture;
    roughnessMap: THREE.Texture | null;
    teakMap: THREE.Texture | null;
    skyTextures: Partial<Record<BuildingLightingMode, THREE.CanvasTexture | null>>;
    skyDome: THREE.Mesh;
    materials: MaterialBank;
    floorRecords: FloorGroupRecord[];
    siteContext: THREE.Group | null;
    selectionOverlay: THREE.Group;
    linkedLineGroup: THREE.Group;
    controls: OrbitControls;
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    walkYaw: number;
    requestRender: (dampingFrames?: number) => void;
    renderNow: () => boolean;
  } | null>(null);

  const isExploded = Boolean(exploded || (explodeDistance !== undefined && explodeDistance > 0));

  // Stable structural geometry revision key: UI changes (palette, lighting, explode, layers, selection, camera)
  // NEVER alter this hash, so the static merged buffers are built ONCE per canonical building revision!
  const buildingGeometryKey = useMemo(
    () =>
      [
        projection.buildingId,
        projection.buildingVersion,
        projection.buildingDigest,
        projection.levels.length,
        projection.floorPlates.length,
        projection.walls.length,
        projection.openings.length,
        projection.rooms.length,
        projection.stairs.length,
        projection.coordinatedChajjas?.length ?? 0,
        projection.otsLouverScreens?.length ?? 0,
        projection.galleryCoordinationMode ?? 'DOUBLE_HEIGHT_STAGGER',
      ].join('|'),
    [projection],
  );

  // 1. MOUNT-ONCE WebGLRenderer + Scene + Shared MaterialBank + On-Demand Render Loop
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdbe8f5);
    scene.fog = null;

    const camera = new THREE.PerspectiveCamera(
      38,
      Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight),
      0.05,
      1500,
    );

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch {
      setRenderError(
        '3D could not start. Enable browser hardware acceleration and reload. Your 2D project is unchanged; Blender export is still available.',
      );
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const rawGl = renderer.getContext();
    const dbgInfo = rawGl.getExtension('WEBGL_debug_renderer_info');
    const unmaskedRenderer = dbgInfo
      ? String(rawGl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL) ?? '')
      : String(rawGl.getParameter(rawGl.RENDERER) ?? '');
    const isSoftwareWebGL = /swiftshader|llvmpipe|software|basic render driver/i.test(unmaskedRenderer);
    const resizeDrawingBuffer = (width: number, height: number) => {
      // Keep CSS dimensions and camera aspect while bounding SwiftShader fill cost.
      const pixelRatio = isSoftwareWebGL
        ? Math.min(1, Math.sqrt(500_000 / (width * height)))
        : Math.min(window.devicePixelRatio || 1, 1.5);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height);
      renderer.domElement.dataset.pixelRatio = String(pixelRatio);
    };
    resizeDrawingBuffer(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.autoUpdate = !isSoftwareWebGL;
    renderer.shadowMap.type = isSoftwareWebGL ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.domElement.setAttribute('aria-label', 'Interactive canonical 3D building model');
    renderer.domElement.dataset.softwareRasterizer = isSoftwareWebGL ? 'true' : 'false';
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.zoomSpeed = 1.15;
    controls.minDistance = 0.4;
    controls.maxDistance = 1600;
    // Strict ground lock: camera can NEVER dip beneath the site plinth
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.target.set(5, 2, 5);
    renderer.domElement.setAttribute('data-zoom-to-cursor', 'true');
    renderer.domElement.dataset.maxPolarAngle = controls.maxPolarAngle.toFixed(4);

    const orthographic = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.05, 1000);
    let halfHeight = 20;
    const fitOrthographic = (height: number) => {
      halfHeight = height;
      const h = height * Math.max(1, 1 / camera.aspect);
      orthographic.left = -h * camera.aspect;
      orthographic.right = h * camera.aspect;
      orthographic.top = h;
      orthographic.bottom = -h;
      orthographic.updateProjectionMatrix();
    };
    const currentCamera = () => runtimeRef.current?.camera ?? camera;

    const hemiLight = new THREE.HemisphereLight(0xf6fbff, 0xd8cfc0, 1.2);
    hemiLight.name = 'hemi-light';
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffe8c8, 2.55);
    keyLight.name = 'key-light';
    keyLight.position.set(28, 24, 22);
    keyLight.castShadow = true;
    const shadowMapDim = isSoftwareWebGL ? 1024 : 1536;
    keyLight.shadow.mapSize.set(shadowMapDim, shadowMapDim);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 160;
    keyLight.shadow.camera.left = -40;
    keyLight.shadow.camera.right = 40;
    keyLight.shadow.camera.top = 40;
    keyLight.shadow.camera.bottom = -40;
    keyLight.shadow.bias = -0.00035;
    keyLight.shadow.normalBias = 0.025;
    keyLight.shadow.radius = 2.2;
    scene.add(keyLight);
    scene.add(keyLight.target);

    const fillLight = new THREE.DirectionalLight(0xb2d2f5, 0.58);
    fillLight.name = 'fill-light';
    fillLight.position.set(-22, 16, -18);
    scene.add(fillLight);

    const skyGeo = new THREE.SphereGeometry(520, 24, 16);
    const skyTextures: Partial<Record<BuildingLightingMode, THREE.CanvasTexture | null>> = {
      golden: createSkyDomeTexture('golden'),
    };
    const skyMat = new THREE.MeshBasicMaterial({
      map: skyTextures.golden ?? undefined,
      color: skyTextures.golden ? 0xffffff : 0xdbe8f5,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    skyDome.name = 'sky-dome';
    skyDome.renderOrder = -10;
    scene.add(skyDome);

    const selectionOverlay = new THREE.Group();
    selectionOverlay.name = 'selection-overlay';
    scene.add(selectionOverlay);

    const linkedLineGroup = new THREE.Group();
    linkedLineGroup.name = 'linked-stair-guide';
    scene.add(linkedLineGroup);

    const roughnessMap = createProceduralRoughnessMap();
    const teakMap = createProceduralTeakSlatTexture();
    const stoneNormal = new THREE.TextureLoader().load(
      `${import.meta.env.BASE_URL}architecture/cast-stone-normal.webp`,
      () => {
        if (!disposed) scheduleRender(1);
      },
      undefined,
      () => {},
    );
    stoneNormal.wrapS = stoneNormal.wrapT = THREE.RepeatWrapping;
    stoneNormal.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

    const materials = createMaterialBank(stoneNormal, roughnessMap, teakMap);

    let rafId = 0;
    let remainingFrames = 0;
    let updatingOrbit = false;
    let disposed = false;
    let contextLost = false;
    const canvas = renderer.domElement;
    const gl = renderer.getContext();
    canvas.dataset.contextStatus = 'active';

    const canRender = () => !disposed && !contextLost && !gl.isContextLost();

    const stopRendering = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      remainingFrames = 0;
    };

    const recordStats = () => {
      const calls = renderer.info.render.calls;
      const triangles = renderer.info.render.triangles;
      canvas.dataset.drawCalls = String(calls);
      canvas.dataset.triangles = String(triangles);
      canvas.dataset.geometries = String(renderer.info.memory.geometries);
      canvas.dataset.textures = String(renderer.info.memory.textures);
      const win = window as unknown as { __rh3dStats?: Record<string, number> };
      win.__rh3dStats = {
        ...(win.__rh3dStats ?? {}),
        drawCalls: calls,
        triangles,
      };
    };

    const renderNow = () => {
      if (!canRender()) return false;
      renderer.render(scene, currentCamera());
      if (!canRender()) return false;
      recordStats();
      return true;
    };

    const tick = () => {
      rafId = 0;
      if (!canRender()) return;

      // Smooth rAF explode lerp on per-floor Y offsets (zero geometry rebuild!)
      let explodeAnimating = false;
      const rt = runtimeRef.current;
      const targetGap = explodeTargetGapRef.current;
      const curGap = explodeCurrentGapRef.current;
      if (Math.abs(targetGap - curGap) > 0.002) {
        const nextGap = curGap + (targetGap - curGap) * 0.24;
        explodeCurrentGapRef.current = Math.abs(targetGap - nextGap) < 0.002 ? targetGap : nextGap;
        if (rt) {
          for (const rec of rt.floorRecords) {
            rec.group.position.y = rec.floorIndex * explodeCurrentGapRef.current;
          }
        }
        renderer.shadowMap.needsUpdate = true;
        explodeAnimating = Math.abs(targetGap - explodeCurrentGapRef.current) > 0.002;
      }

      if (remainingFrames > 0) {
        // OrbitControls emits change here. This tick already owns the render.
        updatingOrbit = true;
        controls.update();
        updatingOrbit = false;
        remainingFrames -= 1;
      }

      if (renderNow() && (remainingFrames > 0 || explodeAnimating)) {
        rafId = requestAnimationFrame(tick);
      }
    };

    const scheduleRender = (frames = 1) => {
      if (!canRender()) return;
      remainingFrames = Math.max(remainingFrames, frames);
      if (!rafId) {
        rafId = requestAnimationFrame(tick);
      }
    };

    // Scene updates affect fixed directional-light shadows. Moving the viewing camera does not.
    const requestRender = (frames = 1) => {
      renderer.shadowMap.needsUpdate = true;
      scheduleRender(frames);
    };

    new HDRLoader().load(
      `${import.meta.env.BASE_URL}architecture/daylight.hdr`,
      texture => {
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = texture;
        scheduleRender(1);
      },
      undefined,
      () => {},
    );

    const onControlsChange = () => {
      if (!updatingOrbit) scheduleRender();
    };
    const onControlsStart = () => scheduleRender(24);
    const onControlsEnd = () => scheduleRender(16);
    controls.addEventListener('change', onControlsChange);
    controls.addEventListener('start', onControlsStart);
    controls.addEventListener('end', onControlsEnd);

    const onWheel = () => scheduleRender(14);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: true });

    const syncSize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!canRender() || !width || !height) return;
      const currentSize = renderer.getSize(new THREE.Vector2());
      if (currentSize.x === width && currentSize.y === height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      fitOrthographic(halfHeight);
      resizeDrawingBuffer(width, height);
      scheduleRender(0);
    };

    const releaseSceneResources = () => {
      disposeGeometryOnly(scene);
      materials.allMaterials.forEach(material => material.dispose());
      skyMat.dispose();
      scene.environment?.dispose();
      stoneNormal.dispose();
      roughnessMap?.dispose();
      teakMap?.dispose();
      Object.values(skyTextures).forEach(texture => texture?.dispose());
      keyLight.shadow.dispose();
      keyLight.shadow.map = null;
      keyLight.shadow.mapPass = null;
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      canvas.dataset.contextStatus = 'lost';
      delete canvas.dataset.drawCalls;
      delete canvas.dataset.triangles;
      delete canvas.dataset.geometries;
      delete canvas.dataset.textures;
      stopRendering();
      // Dispose cached GPU allocations while the old Three.js caches still own them.
      // Geometry, materials and texture sources remain available for the next upload.
      releaseSceneResources();
    };

    const onContextRestored = () => {
      // Three.js registers its restoration listener in the renderer constructor.
      contextLost = false;
      canvas.dataset.contextStatus = 'active';
      syncSize();
      requestRender(0);
    };

    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    const resize = new ResizeObserver(syncSize);
    resize.observe(host);

    runtimeRef.current = {
      camera,
      perspective: camera,
      orthographic,
      fitOrthographic,
      stoneNormal,
      roughnessMap,
      teakMap,
      skyTextures,
      skyDome,
      materials,
      floorRecords: [],
      siteContext: null,
      selectionOverlay,
      linkedLineGroup,
      controls,
      renderer,
      scene,
      walkYaw: 0,
      requestRender,
      renderNow,
    };

    if (sceneRef) sceneRef.current = scene;
    requestRender(0);

    return () => {
      disposed = true;
      stopRendering();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      releaseSceneResources();
      scene.environment = null;
      resize.disconnect();
      renderer.domElement.removeEventListener('wheel', onWheel);
      controls.removeEventListener('change', onControlsChange);
      controls.removeEventListener('start', onControlsStart);
      controls.removeEventListener('end', onControlsEnd);
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      if (sceneRef?.current === scene) sceneRef.current = null;
      runtimeRef.current = null;
    };
  }, []);

  // 2. STATIC MERGED GEOMETRY BUILD — Runs ONLY when buildingGeometryKey changes!
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const { scene, materials } = runtime;

    const previous = scene.getObjectByName('building-projection');
    if (previous) {
      scene.remove(previous);
      disposeGeometryOnly(previous);
    }

    const rootGroup = new THREE.Group();
    rootGroup.name = 'building-projection';
    const floorRecords: FloorGroupRecord[] = [];
    const wallById = new Map(projection.walls.map(w => [w.sourceEntityId, w]));
    const plateByFloor = new Map(projection.floorPlates.map(p => [p.floorId, p]));

    const topPlateElevation = projection.floorPlates.length
      ? Math.max(...projection.floorPlates.map(p => p.elevation))
      : 0;

    // --- A. Site Context (Merged into ~9 draw calls) ---
    const siteContext = new THREE.Group();
    siteContext.name = 'site-context';
    const siteBatch = new GeometryBatcher();

    const siteGeometry = new THREE.ShapeGeometry(makeShape(projection.site.plotBoundary));
    siteGeometry.rotateX(-Math.PI / 2);
    siteBatch.add('lawn', siteGeometry, new THREE.Matrix4().makeTranslation(0, -0.02, 0));

    if (projection.site.buildableEnvelope) {
      const points = projection.site.buildableEnvelope.points.map(
        pt => new THREE.Vector3(pt.x * MM_TO_M, 0.02, pt.y * MM_TO_M),
      );
      if (points.length >= 3) {
        points.push(points[0]!.clone());
        const envelope = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          materials.envelopeLine,
        );
        envelope.computeLineDistances();
        siteContext.add(envelope);
      }
    }

    if (projection.site.roadWidth) {
      const xs = projection.site.plotBoundary.points.map(p => p.x);
      const ys = projection.site.plotBoundary.points.map(p => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const width = projection.site.roadWidth;
      const roadPolygons: Record<string, Polygon> = {
        north: { points: [{ x: minX, y: minY - width }, { x: maxX, y: minY - width }, { x: maxX, y: minY }, { x: minX, y: minY }] },
        south: { points: [{ x: minX, y: maxY }, { x: maxX, y: maxY }, { x: maxX, y: maxY + width }, { x: minX, y: maxY + width }] },
        east: { points: [{ x: maxX, y: minY }, { x: maxX + width, y: minY }, { x: maxX + width, y: maxY }, { x: maxX, y: maxY }] },
        west: { points: [{ x: minX - width, y: minY }, { x: minX, y: minY }, { x: minX, y: maxY }, { x: minX - width, y: maxY }] },
      };
      const roadGeo = new THREE.ShapeGeometry(makeShape(roadPolygons[projection.site.roadFacing]!));
      roadGeo.rotateX(-Math.PI / 2);
      siteBatch.add('road', roadGeo, new THREE.Matrix4().makeTranslation(0, -0.025, 0));
    }

    const plinthGeo = new THREE.ExtrudeGeometry(makeShape(projection.site.plotBoundary), {
      depth: 0.14,
      bevelEnabled: false,
    });
    plinthGeo.rotateX(-Math.PI / 2);
    siteBatch.add('plinth', plinthGeo, new THREE.Matrix4().makeTranslation(0, -0.17, 0));

    const pXs = projection.site.plotBoundary.points.map(p => p.x * MM_TO_M);
    const pYs = projection.site.plotBoundary.points.map(p => p.y * MM_TO_M);
    if (pXs.length > 0 && pYs.length > 0) {
      const minXm = Math.min(...pXs);
      const maxXm = Math.max(...pXs);
      const minYm = Math.min(...pYs);
      const maxYm = Math.max(...pYs);
      const midZ = (minYm + maxYm) / 2;
      const plotW = Math.max(8, maxXm - minXm);

      const basePlate = projection.floorPlates[0];
      const bPts = basePlate?.boundary.points ?? [];
      const bMinX = bPts.length ? Math.min(...bPts.map(p => p.x * MM_TO_M)) : minXm + 3;
      const bMaxX = bPts.length ? Math.max(...bPts.map(p => p.x * MM_TO_M)) : maxXm - 3;
      const bMinZ = bPts.length ? Math.min(...bPts.map(p => p.y * MM_TO_M)) : minYm + 3;
      const bMaxZ = bPts.length ? Math.max(...bPts.map(p => p.y * MM_TO_M)) : maxYm - 3;
      const bMidX = (bMinX + bMaxX) / 2;
      const isNorthRoad = projection.site.roadFacing === 'north';
      const isWestRoad = projection.site.roadFacing === 'west';
      const isEastRoad = projection.site.roadFacing === 'east';

      if (isNorthRoad || projection.site.roadFacing === 'south') {
        const zStart = isNorthRoad ? minYm + 0.15 : bMaxZ;
        const zEnd = isNorthRoad ? bMinZ : maxYm - 0.15;
        const paveDepth = Math.max(1.2, zEnd - zStart);
        const paveW = Math.min(plotW * 0.44, 9.0);
        siteBatch.addBox('paver', paveW, 0.04, paveDepth, bMidX, 0.01, (zStart + zEnd) / 2);

        const frontFaceZ = isNorthRoad ? bMinZ : bMaxZ;
        const outSign = isNorthRoad ? -1 : 1;
        const lobbyW = Math.min(Math.max(4.4, (bMaxX - bMinX) * 0.26), 7.6);
        const lobbyH = 2.85;
        const lobbyDepth = 1.15;
        const lobbyZ = frontFaceZ + outSign * (lobbyDepth / 2 - 0.1);

        siteBatch.addBox('glass', lobbyW, lobbyH, lobbyDepth, bMidX, lobbyH / 2 + 0.04, lobbyZ);
        siteBatch.addBox(
          'soffitLight',
          lobbyW - 0.28,
          lobbyH - 0.25,
          lobbyDepth - 0.22,
          bMidX,
          lobbyH / 2 + 0.04,
          lobbyZ - outSign * 0.14,
        );

        for (let m = 0; m <= 4; m++) {
          const mx = bMidX - lobbyW / 2 + (lobbyW * m) / 4;
          siteBatch.addBox('bronze', 0.06, lobbyH, 0.08, mx, lobbyH / 2 + 0.04, frontFaceZ + outSign * (lobbyDepth - 0.12));
        }

        const canopyW = lobbyW + 1.4;
        const canopyD = 2.2;
        const canopyZ = frontFaceZ + outSign * (canopyD / 2 - 0.15);
        siteBatch.addBox('spandrel', canopyW, 0.14, canopyD, bMidX, lobbyH + 0.11, canopyZ);
        siteBatch.addBox('teak', canopyW - 0.12, 0.03, canopyD - 0.12, bMidX, lobbyH + 0.025, canopyZ);
        for (let d = -1; d <= 1; d++) {
          siteBatch.addCylinder('soffitLight', 0.07, 0.07, 0.02, 8, bMidX + d * (canopyW * 0.26), lobbyH + 0.008, canopyZ + outSign * 0.35);
        }
      } else if (isWestRoad || isEastRoad) {
        const xStart = isWestRoad ? minXm + 0.15 : bMaxX;
        const xEnd = isWestRoad ? bMinX : maxXm - 0.15;
        const paveW = Math.max(1.2, xEnd - xStart);
        siteBatch.addBox('paver', paveW, 0.04, Math.min(8.5, (bMaxZ - bMinZ) * 0.4), (xStart + xEnd) / 2, 0.01, midZ);
      }

      const candidateTrees: Array<[number, number]> = [
        [minXm + 1.35, minYm + 1.35],
        [maxXm - 1.35, minYm + 1.35],
        [minXm + 1.35, maxYm - 1.35],
        [maxXm - 1.35, maxYm - 1.35],
        [minXm + 1.35, midZ],
        [maxXm - 1.35, midZ],
      ];
      for (const [tx, tz] of candidateTrees) {
        const ptMm = { x: tx / MM_TO_M, y: tz / MM_TO_M };
        if (!pointInPolygon2D(ptMm, projection.site.plotBoundary.points)) continue;
        if (bPts.length >= 3 && pointInPolygon2D(ptMm, bPts)) continue;
        siteBatch.addCylinder('trunk', 0.10, 0.15, 1.55, 7, tx, 0.775, tz);
        const lowCanopy = new THREE.DodecahedronGeometry(0.92, 1);
        siteBatch.add('foliage', lowCanopy, new THREE.Matrix4().makeTranslation(tx, 2.0, tz));
        const upCanopy = new THREE.DodecahedronGeometry(0.64, 1);
        siteBatch.add('foliage', upCanopy, new THREE.Matrix4().makeTranslation(tx + 0.14, 2.6, tz - 0.1));
      }

      const bollardZ = isNorthRoad ? minYm + 1.25 : maxYm - 1.25;
      const bollardSpan = Math.min(plotW * 0.24, 5.0);
      for (const bx of [bMidX - bollardSpan, bMidX + bollardSpan, bMidX - bollardSpan * 0.55, bMidX + bollardSpan * 0.55]) {
        const ptMm = { x: bx / MM_TO_M, y: bollardZ / MM_TO_M };
        if (!pointInPolygon2D(ptMm, projection.site.plotBoundary.points)) continue;
        siteBatch.addCylinder('spandrel', 0.055, 0.065, 0.68, 7, bx, 0.34, bollardZ);
        siteBatch.addCylinder('soffitLight', 0.05, 0.05, 0.13, 7, bx, 0.62, bollardZ);
      }
    }
    siteBatch.flush(siteContext, materials, { layerKind: 'site', castShadow: true, receiveShadow: true });
    rootGroup.add(siteContext);

    // --- B. Per-Floor Merged Static Subgroups ---
    const doubleHeightRoomSet = new Set((projection.galleryBays ?? []).flatMap(b => b.doubleHeightRoomIds));
    const isDoubleHeightStagger =
      (projection.galleryCoordinationMode ?? 'DOUBLE_HEIGHT_STAGGER') === 'DOUBLE_HEIGHT_STAGGER';
    const coordinatedChajjaWindowSet = new Set((projection.coordinatedChajjas ?? []).flatMap(b => b.windowIds));

    const narrowCutoutsByFloor = new Map<string, Array<{ minX: number; maxX: number; minY: number; maxY: number }>>();
    for (const fl of projection.floorPlates) {
      const boxes: Array<{ minX: number; maxX: number; minY: number; maxY: number }> = [];
      for (const c of fl.cutouts ?? []) {
        if (!c.points.length) continue;
        const xs = c.points.map(p => p.x);
        const ys = c.points.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        if (Math.min(maxX - minX, maxY - minY) < 2400) boxes.push({ minX, maxX, minY, maxY });
      }
      if (boxes.length) narrowCutoutsByFloor.set(fl.sourceEntityId, boxes);
    }

    projection.levels.forEach((lvl, floorIndex) => {
      const floorId = lvl.floorId;
      const floorGroup = new THREE.Group();
      floorGroup.name = `floor-${floorId}`;
      floorGroup.position.y = floorIndex * explodeCurrentGapRef.current;

      const floorPlatesLayer = new THREE.Group();
      floorPlatesLayer.name = 'layer-floorPlates';
      const ceilingSoffitsLayer = new THREE.Group();
      ceilingSoffitsLayer.name = 'layer-ceilingSoffits';
      const wallsLayer = new THREE.Group();
      wallsLayer.name = 'layer-walls';
      const openingsLayer = new THREE.Group();
      openingsLayer.name = 'layer-openings';
      const stairsLayer = new THREE.Group();
      stairsLayer.name = 'layer-stairs';
      const roomsLayer = new THREE.Group();
      roomsLayer.name = 'layer-rooms';
      const furnitureByCategory: Record<FurnitureCategoryId, THREE.Group> = {
        bed_master: new THREE.Group(),
        sofa_living: new THREE.Group(),
        dining_set: new THREE.Group(),
        wardrobe_full: new THREE.Group(),
        kitchen_modular: new THREE.Group(),
        bath_fixtures: new THREE.Group(),
      };
      for (const catId of ALL_FURNITURE_CATEGORY_IDS) {
        furnitureByCategory[catId].name = `layer-furn-${catId}`;
        roomsLayer.add(furnitureByCategory[catId]);
      }

      floorGroup.add(floorPlatesLayer, ceilingSoffitsLayer, wallsLayer, openingsLayer, stairsLayer, roomsLayer);

      const meshes: FloorGroupRecord['meshes'] = [];
      const plateBatch = new GeometryBatcher();
      const soffitBatch = new GeometryBatcher();
      const wallBatch = new GeometryBatcher();
      const openingBatch = new GeometryBatcher();
      const stairBatch = new GeometryBatcher();
      const roomBatch = new GeometryBatcher();
      const furnBatches: Record<FurnitureCategoryId, GeometryBatcher> = {
        bed_master: new GeometryBatcher(),
        sofa_living: new GeometryBatcher(),
        dining_set: new GeometryBatcher(),
        wardrobe_full: new GeometryBatcher(),
        kitchen_modular: new GeometryBatcher(),
        bath_fixtures: new GeometryBatcher(),
      };
      const edgePositions: number[] = [];

      const plate = plateByFloor.get(floorId);
      if (plate && plate.boundary.points.length >= 3) {
        const plateY = plate.elevation * MM_TO_M;
        const thickness = plate.thickness * MM_TO_M;
        for (const { polygon, holes } of slabSolidRegions(plate.boundary, plate.cutouts)) {
          const slabGeo = new THREE.ExtrudeGeometry(makeShape(polygon, holes), { depth: thickness, bevelEnabled: false });
          slabGeo.rotateX(-Math.PI / 2);
          plateBatch.add('slab', slabGeo, new THREE.Matrix4().makeTranslation(0, plateY - thickness, 0));
        }

        // Crisp 150 mm horizontal slab-edge accent trim strictly along the BUILT outer floor perimeter
        const pts = plate.boundary.points;
        const trimH = 0.15;
        const trimD = 0.06;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i]!;
          const b = pts[(i + 1) % pts.length]!;
          const dx = (b.x - a.x) * MM_TO_M;
          const dz = (b.y - a.y) * MM_TO_M;
          const len = Math.hypot(dx, dz);
          if (len < 0.25) continue;
          plateBatch.addBox(
            'spandrel',
            len + 0.04,
            trimH,
            trimD,
            ((a.x + b.x) / 2) * MM_TO_M,
            plateY + trimH / 2,
            ((a.y + b.y) / 2) * MM_TO_M,
            -Math.atan2(dz, dx),
          );
        }

        // Rooftop Crown on topmost terrace slab (wrapped tightly around built roof boundary!)
        const isTopPlate =
          projection.floorPlates.length > 1 && Math.abs(plate.elevation - topPlateElevation) < 5;
        if (isTopPlate) {
          const roofTopY = plateY;
          const parapetH = 1.05;
          const parapetT = 0.2;
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i]!;
            const b = pts[(i + 1) % pts.length]!;
            const dx = (b.x - a.x) * MM_TO_M;
            const dz = (b.y - a.y) * MM_TO_M;
            const len = Math.hypot(dx, dz);
            if (len < 0.35) continue;
            const mx = ((a.x + b.x) / 2) * MM_TO_M;
            const mz = ((a.y + b.y) / 2) * MM_TO_M;
            const rotY = -Math.atan2(dz, dx);
            plateBatch.addBox('wall', len + parapetT * 0.5, parapetH, parapetT, mx, roofTopY + parapetH / 2, mz, rotY);
            plateBatch.addBox('bronze', len + parapetT * 0.8, 0.06, parapetT + 0.08, mx, roofTopY + parapetH + 0.03, mz, rotY);
          }

          const xsM = pts.map(p => p.x * MM_TO_M);
          const zsM = pts.map(p => p.y * MM_TO_M);
          const minX = Math.min(...xsM);
          const maxX = Math.max(...xsM);
          const minZ = Math.min(...zsM);
          const maxZ = Math.max(...zsM);
          const spanX = maxX - minX;
          const spanZ = maxZ - minZ;

          if (spanX >= 8 && spanZ >= 8) {
            const pergolaW = Math.min(8.2, spanX * 0.34);
            const pergolaD = Math.min(5.2, spanZ * 0.24);
            const pergolaH = 2.65;
            const pCenterX = minX + spanX * 0.28;
            const pCenterZ = minZ + spanZ * 0.28;
            if (pointInPolygon2D({ x: pCenterX / MM_TO_M, y: pCenterZ / MM_TO_M }, pts)) {
              for (const [ox, oz] of [
                [-pergolaW / 2, -pergolaD / 2],
                [pergolaW / 2, -pergolaD / 2],
                [-pergolaW / 2, pergolaD / 2],
                [pergolaW / 2, pergolaD / 2],
              ] as const) {
                plateBatch.addBox('spandrel', 0.14, pergolaH, 0.14, pCenterX + ox, roofTopY + pergolaH / 2, pCenterZ + oz);
              }
              plateBatch.addBox('spandrel', pergolaW + 0.3, 0.18, 0.14, pCenterX, roofTopY + pergolaH, pCenterZ - pergolaD / 2);
              plateBatch.addBox('spandrel', pergolaW + 0.3, 0.18, 0.14, pCenterX, roofTopY + pergolaH, pCenterZ + pergolaD / 2);
              plateBatch.addBox('spandrel', 0.14, 0.18, pergolaD + 0.3, pCenterX - pergolaW / 2, roofTopY + pergolaH, pCenterZ);
              plateBatch.addBox('spandrel', 0.14, 0.18, pergolaD + 0.3, pCenterX + pergolaW / 2, roofTopY + pergolaH, pCenterZ);
              const slatCount = Math.max(6, Math.min(12, Math.floor(pergolaW / 0.45)));
              for (let s = 0; s < slatCount; s++) {
                const sx = pCenterX - pergolaW / 2 + 0.25 + ((pergolaW - 0.5) * s) / Math.max(1, slatCount - 1);
                plateBatch.addBox('teak', 0.08, 0.12, pergolaD + 0.24, sx, roofTopY + pergolaH + 0.04, pCenterZ);
              }
            }
            const planterAnchors: Array<[number, number, number, number]> = [
              [minX + spanX * 0.25, minZ + 0.85, Math.min(4.2, spanX * 0.18), 0.55],
              [maxX - spanX * 0.25, minZ + 0.85, Math.min(4.2, spanX * 0.18), 0.55],
              [minX + spanX * 0.25, maxZ - 0.85, Math.min(4.2, spanX * 0.18), 0.55],
              [maxX - spanX * 0.25, maxZ - 0.85, Math.min(4.2, spanX * 0.18), 0.55],
            ];
            for (const [px, pz, pw, pd] of planterAnchors) {
              if (!pointInPolygon2D({ x: px / MM_TO_M, y: pz / MM_TO_M }, pts)) continue;
              plateBatch.addBox('spandrel', pw, 0.46, pd, px, roofTopY + 0.23, pz);
              plateBatch.addBox('foliage', pw - 0.16, 0.42, pd - 0.14, px, roofTopY + 0.58, pz);
            }
          }
        }
      }

      // Architectural Galleries (Teak soffits, downlights, cantilevered decks, glass balustrades)
      const floorRooms = projection.rooms.filter(r => r.floorId === floorId);
      const fKey = floorId.toLowerCase();
      if (plate && !(projection.floorPlates.length > 1 && plate.elevation >= topPlateElevation - 5)) {
        const canonicalFurnitureRooms = new Set<string>();
      for (const item of projection.furniture ?? []) {
        if (item.floorId !== floorId) continue;
        const presentation = furniturePresentation[item.type];
        if (!presentation) continue;
        canonicalFurnitureRooms.add(item.roomId);
        const height = furnitureSolidHeightMm(item) * MM_TO_M;
        const quarterTurn = item.rotationDeg === 90 || item.rotationDeg === 270;
        const width = (quarterTurn ? item.depthMm : item.widthMm) * MM_TO_M;
        const depth = (quarterTurn ? item.widthMm : item.depthMm) * MM_TO_M;
        furnBatches[presentation.category].addBox(presentation.role, width, height, depth,
          (item.xMm + item.widthMm / 2) * MM_TO_M, item.elevation * MM_TO_M + height / 2,
          (item.yMm + item.depthMm / 2) * MM_TO_M, -item.rotationDeg * Math.PI / 180);
      }
      for (const room of floorRooms) {
          if (canonicalFurnitureRooms.has(room.sourceEntityId)) continue;
        const rName = `${room.sourceEntityId} ${room.name}`.toLowerCase();
          if (
            rName.includes('terrace') ||
            rName.includes('roof') ||
            rName.includes('yoga') ||
            rName.includes('gazebo') ||
            rName.includes('stilt') ||
            rName.includes('parking') ||
            fKey.includes('terrace') ||
            fKey.includes('roof') ||
            fKey.includes('stilt')
          ) {
            continue;
          }
          const isBalcony = rName.includes('balcony') || rName.includes('sit-out') || rName.includes('sitout');
          if (!isBalcony || rName.includes('utility') || room.boundary.points.length < 3) continue;

          const floorSurfaceY = (lvl.elevation + plate.thickness) * MM_TO_M;
          const ceilingSoffitY = (lvl.elevation + lvl.floorToFloorHeight - 40) * MM_TO_M;
          const isPrimarySkyDeck =
            rName.includes('sit-out') ||
            rName.includes('sitout') ||
            (room.sourceEntityId.endsWith('__balcony') && !rName.includes('bed'));
          const isDoubleHeightDeck =
            isDoubleHeightStagger && (doubleHeightRoomSet.has(room.sourceEntityId) || isPrimarySkyDeck);

          const pts = room.boundary.points;
          const rc = polygonCenter2D(pts);
          const rW = (Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x))) * MM_TO_M;
          const rD = (Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y))) * MM_TO_M;

          if (!isDoubleHeightDeck && rW >= 0.8 && rD >= 0.8) {
            const soffitGeo = new THREE.ShapeGeometry(makeShape(room.boundary));
            soffitGeo.rotateX(-Math.PI / 2);
            soffitBatch.add('teak', soffitGeo, new THREE.Matrix4().makeTranslation(0, ceilingSoffitY, 0));
            soffitBatch.addCylinder('soffitLight', 0.065, 0.065, 0.02, 8, rc.x * MM_TO_M, ceilingSoffitY - 0.015, rc.y * MM_TO_M);
          }

          const platePts = plate.boundary.points;
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i]!;
            const b = pts[(i + 1) % pts.length]!;
            const dxMm = b.x - a.x;
            const dyMm = b.y - a.y;
            const lenMm = Math.hypot(dxMm, dyMm);
            if (lenMm < 450) continue;
            const ux = dxMm / lenMm;
            const uy = dyMm / lenMm;
            const midMm = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const nA = { x: -uy, y: ux };
            const nB = { x: uy, y: -ux };
            const outA = !pointInPolygon2D({ x: midMm.x + nA.x * 160, y: midMm.y + nA.y * 160 }, platePts);
            const outB = !pointInPolygon2D({ x: midMm.x + nB.x * 160, y: midMm.y + nB.y * 160 }, platePts);
            if (outA === outB) continue;

            const outN = outA ? nA : nB;
            const lenM = lenMm * MM_TO_M;
            const rotY = -Math.atan2(dyMm, dxMm);
            const projM = isDoubleHeightDeck ? 0.72 : isPrimarySkyDeck ? 0.26 : 0.08;
            const slabThickM = 0.16;

            if (projM > 0.1) {
              const deckCenterX = midMm.x * MM_TO_M + outN.x * (projM / 2);
              const deckCenterZ = midMm.y * MM_TO_M + outN.y * (projM / 2);
              plateBatch.addBox('slab', lenM + 0.08, slabThickM, projM, deckCenterX, floorSurfaceY - slabThickM / 2, deckCenterZ, rotY);
              plateBatch.addBox('teak', lenM - 0.04, 0.025, projM - 0.04, deckCenterX, floorSurfaceY - slabThickM - 0.012, deckCenterZ, rotY);
              const pucks = lenM >= 2.2 ? [-lenM * 0.26, lenM * 0.26] : [0];
              for (const pOff of pucks) {
                plateBatch.addCylinder('soffitLight', 0.06, 0.06, 0.018, 8, deckCenterX + ux * pOff, floorSurfaceY - slabThickM - 0.024, deckCenterZ + uy * pOff);
              }
              plateBatch.addBox(
                'spandrel',
                lenM + 0.1,
                slabThickM + 0.02,
                0.05,
                midMm.x * MM_TO_M + outN.x * projM,
                floorSurfaceY - slabThickM / 2,
                midMm.y * MM_TO_M + outN.y * projM,
                rotY,
              );
              for (const endSign of [-1, 1] as const) {
                const endX = midMm.x * MM_TO_M + ux * ((endSign * lenM) / 2) + outN.x * (projM / 2);
                const endZ = midMm.y * MM_TO_M + uy * ((endSign * lenM) / 2) + outN.y * (projM / 2);
                plateBatch.addBox('balustradeGlass', 0.024, 1.02, projM, endX, floorSurfaceY + 0.525, endZ, rotY);
                plateBatch.addBox('bronze', 0.04, 0.036, projM + 0.04, endX, floorSurfaceY + 1.05, endZ, rotY);
                if (isDoubleHeightDeck) {
                  const finH = Math.max(2.2, lvl.floorToFloorHeight * MM_TO_M - slabThickM);
                  plateBatch.addBox(
                    'spandrel',
                    0.14,
                    finH,
                    projM * 0.72,
                    midMm.x * MM_TO_M + ux * (endSign * (lenM / 2 + 0.04)) + outN.x * (projM * 0.36),
                    floorSurfaceY + finH / 2 - slabThickM,
                    midMm.y * MM_TO_M + uy * (endSign * (lenM / 2 + 0.04)) + outN.y * (projM * 0.36),
                    rotY,
                  );
                }
              }
            }

            const frontX = midMm.x * MM_TO_M + outN.x * (projM - 0.04);
            const frontZ = midMm.y * MM_TO_M + outN.y * (projM - 0.04);
            plateBatch.addBox('bronze', lenM, 0.06, 0.06, frontX, floorSurfaceY + 0.03, frontZ, rotY);
            plateBatch.addBox('balustradeGlass', lenM - 0.04, 0.99, 0.024, frontX, floorSurfaceY + 0.54, frontZ, rotY);
            plateBatch.addBox('bronze', lenM + 0.04, 0.038, 0.045, frontX, floorSurfaceY + 1.05, frontZ, rotY);
          }
        }
      }

      // Walls Layer (Merged into 1 single draw call per floor!)
      const floorWalls = projection.walls.filter(w => w.floorId === floorId);
      for (const wall of floorWalls) {
        const dx = wall.endPoint.x - wall.startPoint.x;
        const dy = wall.endPoint.y - wall.startPoint.y;
        const angle = -Math.atan2(dy, dx);
        const ux = dx / Math.max(wall.length, 1);
        const uy = dy / Math.max(wall.length, 1);

        for (const segment of wall.solidSegments) {
          const segmentHeight = (segment.top - segment.bottom) * MM_TO_M;
          const wallY = (wall.elevation + segment.bottom) * MM_TO_M;
          if (wall.arc && wall.arc.radiusMm > 0 && wall.length > 0) {
            const arc = wall.arc;
            const dAng = arc.endAngleRad - arc.startAngleRad;
            const t0 = segment.alongStart / wall.length;
            const t1 = segment.alongEnd / wall.length;
            const a0 = arc.startAngleRad + dAng * t0;
            const a1 = arc.startAngleRad + dAng * t1;
            const subSteps = 6;
            const halfT = wall.thickness / 2;
            const outerPts: Point[] = [];
            const innerPts: Point[] = [];
            for (let k = 0; k <= subSteps; k++) {
              const theta = a0 + ((a1 - a0) * k) / subSteps;
              const cosT = Math.cos(theta);
              const sinT = Math.sin(theta);
              outerPts.push({ x: arc.center.x + (arc.radiusMm + halfT) * cosT, y: arc.center.y + (arc.radiusMm + halfT) * sinT });
              innerPts.unshift({ x: arc.center.x + Math.max(50, arc.radiusMm - halfT) * cosT, y: arc.center.y + Math.max(50, arc.radiusMm - halfT) * sinT });
            }
            const arcGeo = new THREE.ExtrudeGeometry(makeShape({ points: [...outerPts, ...innerPts] }), {
              depth: segmentHeight,
              bevelEnabled: false,
            });
            arcGeo.rotateX(-Math.PI / 2);
            wallBatch.source = wall;
            wallBatch.add('wall', arcGeo, new THREE.Matrix4().makeTranslation(0, wallY, 0));
          } else {
            // Slight 4 mm corner overlap miter closes hairline vertical corner seams cleanly
            const segmentLength = (segment.alongEnd - segment.alongStart) * MM_TO_M + 0.004;
            const alongMid = (segment.alongStart + segment.alongEnd) / 2;
            const cx = (wall.startPoint.x + ux * alongMid) * MM_TO_M;
            const cy = wallY + segmentHeight / 2;
            const cz = (wall.startPoint.y + uy * alongMid) * MM_TO_M;
            wallBatch.source = wall;
            wallBatch.addBox('wall', segmentLength, segmentHeight, wall.thickness * MM_TO_M, cx, cy, cz, angle);

            // Crisp top & bottom horizontal edge lines for subtle architectural drafting definition
            const halfL = segmentLength / 2;
            const x0 = cx - ux * halfL;
            const z0 = cz - uy * halfL;
            const x1 = cx + ux * halfL;
            const z1 = cz + uy * halfL;
            const yTop = wallY + segmentHeight;
            edgePositions.push(x0, yTop, z0, x1, yTop, z1);
          }
        }
      }

      // Openings + Coordinated Chajjas + OTS Louver Fins (Merged into ~6 draw calls per floor!)
      const floorOpenings = projection.openings.filter(o => o.floorId === floorId);
      const floorNarrowCutouts = narrowCutoutsByFloor.get(floorId) ?? [];

      for (const opening of floorOpenings) {
        if (opening.doorType === DoorType.OpenPassage) continue;
        const wall = wallById.get(opening.hostWallId);
        if (!wall || wall.length <= 0) continue;
        const { x: openX, y: openY, ux, uy } = openingPose(opening, wall);
        const angle = -Math.atan2(uy, ux);
        const ox = openX * MM_TO_M;
        const oy = (opening.elevation + opening.bottom + opening.height / 2) * MM_TO_M;
        const oz = openY * MM_TO_M;

        const winW = opening.width * MM_TO_M;
        const winH = opening.height * MM_TO_M;
        const wallThickM = Math.max(0.115, wall.thickness * MM_TO_M);
        const isWin = opening.sourceEntityType === 'window';
        const isSlidingDoor = !isWin && opening.doorType === DoorType.Sliding;

        openingBatch.source = opening;
        openingBatch.addBox(
          isWin || isSlidingDoor ? 'glass' : 'door',
          winW,
          winH,
          Math.max(0.04, wallThickM * 0.28),
          ox,
          oy,
          oz,
          angle,
        );

        if (isWin || isSlidingDoor) {
          const frameDepth = Math.max(0.055, wallThickM * 0.52);
          const casingThick = 0.055;
          const casingDepth = wallThickM + 0.032;

          // Helper to place a box in opening-local (localX along wall, localY vertical) coords
          const addLocal = (role: MaterialRoleKey, bw: number, bh: number, bd: number, lx: number, ly: number) => {
            openingBatch.addBox(role, bw, bh, bd, ox + ux * lx, oy + ly, oz + uy * lx, angle);
          };

          // Recessed charcoal surround casing
          addLocal('spandrel', winW + 0.14, casingThick, casingDepth, 0, winH / 2 + casingThick / 2);
          addLocal('spandrel', winW + 0.14, casingThick, casingDepth, 0, -winH / 2 - casingThick / 2);
          addLocal('spandrel', casingThick, winH + casingThick * 2, casingDepth, -winW / 2 - casingThick / 2, 0);
          addLocal('spandrel', casingThick, winH + casingThick * 2, casingDepth, winW / 2 + casingThick / 2, 0);

          if (isWin && opening.bottom >= 700 && wall.thickness >= 200) {
            const spandrelH = Math.max(0.32, opening.bottom * MM_TO_M - 0.14);
            addLocal('spandrel', winW + 0.12, spandrelH, wallThickM + 0.014, 0, -winH / 2 - spandrelH / 2 - casingThick);
          }

          // Slim dark-bronze mullions
          addLocal('bronze', winW, 0.036, frameDepth, 0, winH / 2 - 0.018);
          addLocal('bronze', winW, 0.036, frameDepth, 0, -winH / 2 + 0.018);
          addLocal('bronze', 0.036, winH, frameDepth, -winW / 2 + 0.018, 0);
          addLocal('bronze', 0.036, winH, frameDepth, winW / 2 - 0.018, 0);
          addLocal('bronze', 0.028, winH, frameDepth * 0.85, 0, 0);

          // Warm 2700K interior glow plane
          addLocal('glow', Math.max(0.2, winW - 0.08), Math.max(0.2, winH - 0.08), 0.014, 0, 0);
        }

        openingBatch.source = undefined;
        // Single non-duplicated fallback chajja ONLY if not covered by coordinatedChajjas and NOT in narrow OTS
        const facesNarrowOts = floorNarrowCutouts.some(
          box => openX >= box.minX - 280 && openX <= box.maxX + 280 && openY >= box.minY - 280 && openY <= box.maxY + 280,
        );
        if (
          isWin &&
          opening.width >= 600 &&
          !facesNarrowOts &&
          !coordinatedChajjaWindowSet.has(opening.sourceEntityId) &&
          (projection.coordinatedChajjas ?? []).length === 0
        ) {
          const nx = -Math.sin(angle);
          const nz = Math.cos(angle);
          openingBatch.addBox(
            'wall',
            winW + 0.3,
            0.1,
            0.6,
            ox + nx * 0.3,
            (opening.elevation + opening.bottom + opening.height) * MM_TO_M + 0.05,
            oz + nz * 0.3,
            angle,
          );
        }
      }

      // Coordinated Continuous 600 mm Chajja Bands on this floor
      for (const band of (projection.coordinatedChajjas ?? []).filter(b => b.floorId === floorId)) {
        const projM = (band.projectionMm || 600) * MM_TO_M;
        const fasciaM = (band.fasciaThicknessMm || 100) * MM_TO_M;
        const bottomY = band.bottom * MM_TO_M;
        if (band.arc && band.arc.radiusMm > 0) {
          const arc = band.arc;
          const midX = (band.startPoint.x + band.endPoint.x) / 2;
          const midY = (band.startPoint.y + band.endPoint.y) / 2;
          const span = Math.hypot(band.endPoint.x - band.startPoint.x, band.endPoint.y - band.startPoint.y);
          const rCenter = Math.hypot(midX - arc.center.x, midY - arc.center.y) || arc.radiusMm;
          const midAng = Math.atan2(midY - arc.center.y, midX - arc.center.x);
          const halfAng = Math.min(0.65, span / 2 / Math.max(500, rCenter));
          const rIn = arc.radiusMm + 115;
          const rOut = rIn + (band.projectionMm || 600);
          const outP: Point[] = [];
          const inP: Point[] = [];
          for (let k = 0; k <= 8; k++) {
            const theta = midAng - halfAng + (2 * halfAng * k) / 8;
            outP.push({ x: arc.center.x + rOut * Math.cos(theta), y: arc.center.y + rOut * Math.sin(theta) });
            inP.unshift({ x: arc.center.x + rIn * Math.cos(theta), y: arc.center.y + rIn * Math.sin(theta) });
          }
          const arcGeo = new THREE.ExtrudeGeometry(makeShape({ points: [...outP, ...inP] }), {
            depth: fasciaM,
            bevelEnabled: false,
          });
          arcGeo.rotateX(-Math.PI / 2);
          openingBatch.add('wall', arcGeo, new THREE.Matrix4().makeTranslation(0, bottomY, 0));
        } else {
          const dxM = (band.endPoint.x - band.startPoint.x) * MM_TO_M;
          const dzM = (band.endPoint.y - band.startPoint.y) * MM_TO_M;
          const lenM = Math.hypot(dxM, dzM);
          if (lenM < 0.3) continue;
          const rotY = -Math.atan2(dzM, dxM);
          const midX = ((band.startPoint.x + band.endPoint.x) / 2) * MM_TO_M;
          const midZ = ((band.startPoint.y + band.endPoint.y) / 2) * MM_TO_M;
          const n = band.outwardNormal;
          openingBatch.addBox('wall', lenM, fasciaM, projM, midX + n.x * (projM / 2), bottomY + fasciaM / 2, midZ + n.y * (projM / 2), rotY);
          openingBatch.addBox('spandrel', lenM + 0.02, fasciaM, 0.032, midX + n.x * projM, bottomY + fasciaM / 2, midZ + n.y * projM, rotY);
        }
      }

      // Vertical Aluminum OTS Louver Fins (Merged!)
      for (const screen of (projection.otsLouverScreens ?? []).filter(s => s.floorId === floorId)) {
        const dxM = (screen.endPoint.x - screen.startPoint.x) * MM_TO_M;
        const dzM = (screen.endPoint.y - screen.startPoint.y) * MM_TO_M;
        const spanM = Math.hypot(dxM, dzM);
        const heightM = Math.max(0.8, (screen.topMm - screen.bottomMm) * MM_TO_M);
        if (spanM < 0.45) continue;
        const rotY = -Math.atan2(dzM, dxM);
        const ux = dxM / spanM;
        const uz = dzM / spanM;
        const n = screen.outwardNormal;
        const startX = screen.startPoint.x * MM_TO_M + n.x * 0.06;
        const startZ = screen.startPoint.y * MM_TO_M + n.y * 0.06;
        const centerY = (screen.elevation + screen.bottomMm) * MM_TO_M + heightM / 2;
        const pitchM = Math.max(0.24, (screen.slatPitchMm || 180) * MM_TO_M);
        const count = Math.max(3, Math.min(14, Math.floor(spanM / pitchM)));
        for (let k = 0; k <= count; k++) {
          const dAlong = (spanM * k) / count;
          openingBatch.addBox('bronze', 0.044, heightM, 0.14, startX + ux * dAlong, centerY, startZ + uz * dAlong, rotY);
        }
        const railX = startX + ux * (spanM / 2);
        const railZ = startZ + uz * (spanM / 2);
        openingBatch.addBox('spandrel', spanM, 0.05, 0.12, railX, (screen.elevation + screen.topMm) * MM_TO_M - 0.025, railZ, rotY);
        openingBatch.addBox('spandrel', spanM, 0.05, 0.12, railX, (screen.elevation + screen.bottomMm) * MM_TO_M + 0.025, railZ, rotY);
        openingBatch.addBox('uplight', spanM * 0.86, 0.03, 0.04, railX + n.x * 0.04, (screen.elevation + screen.bottomMm) * MM_TO_M + 0.06, railZ + n.y * 0.04, rotY);
      }

      // Stairs & Mumty Architectural Solids (Merged!)
      for (const part of (projection.architecturalSolids ?? []).filter(p => p.floorId === floorId)) {
        const stairGeo = new THREE.ExtrudeGeometry(makeShape(part.boundary), {
          depth: Math.max(0.05, (part.top - part.bottom) * MM_TO_M),
          bevelEnabled: false,
        });
        stairGeo.rotateX(-Math.PI / 2);
        stairBatch.add('stair', stairGeo, new THREE.Matrix4().makeTranslation(0, part.bottom * MM_TO_M, 0));
      }
      for (const stair of projection.stairs.filter(
        s => s.floorId === floorId && !projection.architecturalSolids?.some(p => p.sourceEntityId === s.sourceEntityId),
      )) {
        const result = computeStairSolids(stair.canonicalStair, stair.verticalExtent);
        for (const part of result.solids) {
          const stairGeo = new THREE.ExtrudeGeometry(makeShape(part.boundary), {
            depth: Math.max(0.05, (part.top - part.bottom) * MM_TO_M),
            bevelEnabled: false,
          });
          stairGeo.rotateX(-Math.PI / 2);
          stairBatch.add('stair', stairGeo, new THREE.Matrix4().makeTranslation(0, (stair.elevation + part.bottom) * MM_TO_M, 0));
        }
      }

      // Strictly-Interior Inset Room Tint + Interior Cutaway Furniture (NEVER leaks onto exterior walls!)
      for (const room of floorRooms) {
        if (room.boundary.points.length < 3) continue;
        const insetBoundary = insetPolygonTowardCenter(room.boundary, 130);
        const roomGeo = new THREE.ShapeGeometry(makeShape(insetBoundary, room.cutouts));
        roomGeo.rotateX(-Math.PI / 2);
        roomBatch.source = room;
        roomBatch.add('roomTint', roomGeo, new THREE.Matrix4().makeTranslation(0, room.elevation * MM_TO_M + 0.012, 0));

        const rc = polygonCenter2D(room.boundary.points);
        const rx = rc.x * MM_TO_M;
        const rz = rc.y * MM_TO_M;
        const ry = room.elevation * MM_TO_M + 0.02;
        const rName = `${room.sourceEntityId} ${room.name}`.toLowerCase();
        const rXs = room.boundary.points.map(p => p.x * MM_TO_M);
        const rZs = room.boundary.points.map(p => p.y * MM_TO_M);
        const rSpanX = Math.max(0.8, Math.max(...rXs) - Math.min(...rXs));
        const rSpanZ = Math.max(0.8, Math.max(...rZs) - Math.min(...rZs));
        if (rName.includes('bed')) {
          furnBatches.bed_master.addBox('furnBed', Math.min(1.55, rSpanX * 0.52), 0.45, Math.min(1.95, rSpanZ * 0.55), rx, ry + 0.225, rz);
          // Perimeter joinery wardrobe inset cleanly from doors along bedroom side wall
          if (rSpanX >= 2.7 && rSpanZ >= 2.9) {
            const wardW = Math.min(1.65, rSpanX * 0.48);
            const wardZ = Math.min(...rZs) + 0.34;
            furnBatches.wardrobe_full.addBox('furnWood', wardW, 2.05, 0.55, rx, ry + 1.025, wardZ);
          }
        } else if (rName.includes('living') || rName.includes('hall')) {
          furnBatches.sofa_living.addBox('furnWood', Math.min(2.0, rSpanX * 0.52), 0.65, Math.min(0.85, rSpanZ * 0.32), rx, ry + 0.325, rz);
        } else if (rName.includes('dining')) {
          furnBatches.dining_set.addBox('furnWood', Math.min(1.45, rSpanX * 0.48), 0.75, Math.min(0.9, rSpanZ * 0.42), rx, ry + 0.375, rz);
        } else if (rName.includes('kitchen')) {
          furnBatches.kitchen_modular.addBox('furnStone', Math.min(1.9, rSpanX * 0.58), 0.85, 0.6, rx, ry + 0.425, Math.min(...rZs) + 0.38);
        } else if (rName.includes('bath') || rName.includes('toilet') || rName.includes('wc')) {
          furnBatches.bath_fixtures.addBox('furnCeramic', 0.5, 0.42, 0.6, rx, ry + 0.21, rz);
        }
      }

      // Flush every merged batch into its tagged floor layer group
      plateBatch.flush(floorPlatesLayer, materials, { floorId, layerKind: 'floorPlates', castShadow: true, receiveShadow: true }, meshes);
      soffitBatch.flush(ceilingSoffitsLayer, materials, { floorId, layerKind: 'floorPlates', castShadow: false, receiveShadow: true }, meshes);
      wallBatch.flush(wallsLayer, materials, { floorId, layerKind: 'walls', castShadow: true, receiveShadow: true }, meshes);
      if (edgePositions.length >= 6) {
        const edgeGeo = new THREE.BufferGeometry();
        edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
        const edgeLines = new THREE.LineSegments(edgeGeo, materials.edgeLine);
        edgeLines.userData = { floorId, layerKind: 'walls' };
        wallsLayer.add(edgeLines);
      }
      openingBatch.flush(openingsLayer, materials, { floorId, layerKind: 'openings', castShadow: true, receiveShadow: true }, meshes);
      stairBatch.flush(stairsLayer, materials, { floorId, layerKind: 'stairs', castShadow: true, receiveShadow: true }, meshes);
      roomBatch.flush(roomsLayer, materials, { floorId, layerKind: 'rooms', castShadow: false, receiveShadow: true }, meshes);
      for (const catId of ALL_FURNITURE_CATEGORY_IDS) {
        furnBatches[catId].flush(
          furnitureByCategory[catId],
          materials,
          { floorId, layerKind: 'rooms', castShadow: false, receiveShadow: true },
          meshes,
        );
      }

      rootGroup.add(floorGroup);
      floorRecords.push({
        floorId,
        floorIndex,
        group: floorGroup,
        layers: {
          floorPlates: floorPlatesLayer,
          ceilingSoffits: ceilingSoffitsLayer,
          walls: wallsLayer,
          openings: openingsLayer,
          stairs: stairsLayer,
          rooms: roomsLayer,
          furnitureByCategory,
        },
        meshes,
      });
    });

    scene.add(rootGroup);
    runtime.floorRecords = floorRecords;
    runtime.siteContext = siteContext;
    runtime.requestRender(0);
  }, [buildingGeometryKey, projection]);

  // 3. INSTANT (< 5 ms) SHARED MATERIAL PALETTE + OPENING FINISH + X-RAY HOT-SWAP
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const t0 = performance.now();
    const { materials, renderer } = runtime;
    const pal = MATERIAL_PALETTES[materialPalette];
    const xray = viewMode === 'xray';

    const frameHex = openingFinish?.frameColorHex ?? pal.bronze;
    const doorHex = openingFinish?.doorColorHex ?? pal.door;
    const glassHex = openingFinish?.glassColorHex ?? pal.glass;
    const glassBaseOp = openingFinish?.glassOpacity ?? 0.56;

    const applyToSet = (set: Record<MaterialRoleKey, THREE.MeshStandardMaterial>, dimFactor: number) => {
      const isDim = dimFactor < 1;
      const op = (base: number) => (xray ? Math.min(base, 0.34) : isDim ? Math.min(base, dimFactor) : base);

      set.wall.color.setHex(pal.wall);
      set.wall.roughness = pal.wallRoughness;
      set.wall.transparent = xray || isDim;
      set.wall.opacity = op(1);
      set.wall.depthWrite = !xray && !isDim;

      set.slab.color.setHex(pal.slab);
      set.slab.transparent = xray || isDim;
      set.slab.opacity = op(0.98);
      set.slab.depthWrite = !xray && !isDim;

      set.spandrel.color.setHex(pal.spandrel);
      set.spandrel.transparent = xray || isDim;
      set.spandrel.opacity = op(1);
      set.spandrel.depthWrite = !xray && !isDim;

      set.teak.color.setHex(runtime.teakMap ? 0xffffff : pal.teak);
      set.teak.transparent = xray || isDim;
      set.teak.opacity = op(1);
      set.teak.depthWrite = !xray && !isDim;

      set.bronze.color.setHex(frameHex);
      set.bronze.transparent = xray || isDim;
      set.bronze.opacity = op(1);
      set.bronze.depthWrite = !xray && !isDim;

      set.door.color.setHex(doorHex);
      set.door.transparent = xray || isDim;
      set.door.opacity = op(1);
      set.door.depthWrite = !xray && !isDim;

      set.glass.color.setHex(glassHex);
      set.glass.opacity = xray ? 0.24 : isDim ? 0.16 : glassBaseOp;

      set.balustradeGlass.opacity = xray ? 0.2 : isDim ? 0.12 : 0.42;

      set.stair.color.setHex(pal.stair);
      set.stair.transparent = xray || isDim;
      set.stair.opacity = op(1);
      set.stair.depthWrite = !xray && !isDim;

      set.lawn.color.setHex(pal.lawn);
      set.road.color.setHex(pal.road);
    };

    applyToSet(materials.active, 1);
    applyToSet(materials.dimmed, 0.2);

    renderer.domElement.dataset.palette = materialPalette;
    const swapMs = Math.round((performance.now() - t0) * 100) / 100;
    const win = window as unknown as { __rh3dStats?: Record<string, number> };
    win.__rh3dStats = { ...(win.__rh3dStats ?? {}), materialSwapMs: swapMs };
    runtime.requestRender(0);
  }, [materialPalette, openingFinish, viewMode]);

  // 4. INSTANT LIGHTING MODE HOT-SWAP (Day / Sunset / Night — zero geometry rebuild!)
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const { scene, controls, materials, skyTextures, skyDome, renderer } = runtime;
    const hemi = scene.getObjectByName('hemi-light') as THREE.HemisphereLight | undefined;
    const key = scene.getObjectByName('key-light') as THREE.DirectionalLight | undefined;
    const fill = scene.getObjectByName('fill-light') as THREE.DirectionalLight | undefined;
    const nightGlowName = 'night-glow-light';
    let nightGlow = scene.getObjectByName(nightGlowName) as THREE.PointLight | undefined;

    scene.environmentIntensity = lightingMode === 'night' ? 0.16 : lightingMode === 'golden' ? 0.54 : 0.68;

    if (!(lightingMode in skyTextures)) {
      skyTextures[lightingMode] = createSkyDomeTexture(lightingMode);
    }
    const nextSkyTex = skyTextures[lightingMode];
    const skyMat = skyDome.material as THREE.MeshBasicMaterial;
    if (nextSkyTex && skyMat.map !== nextSkyTex) {
      skyMat.map = nextSkyTex;
      skyMat.color.setHex(0xffffff);
      skyMat.needsUpdate = true;
    }

    if (lightingMode === 'night') {
      scene.background = new THREE.Color(0x070d1b);
      if (hemi) {
        hemi.color.setHex(0x22345e);
        hemi.groundColor.setHex(0x090e18);
        hemi.intensity = 0.72;
      }
      if (key) {
        key.color.setHex(0x88a5e0);
        key.position.set(controls.target.x + 24, controls.target.y + 34, controls.target.z + 20);
        key.intensity = 0.68;
      }
      if (fill) {
        fill.color.setHex(0xf5a638);
        fill.intensity = 0.52;
      }
      if (!nightGlow) {
        nightGlow = new THREE.PointLight(0xffbd5c, 2.8, 140, 1.15);
        nightGlow.name = nightGlowName;
        nightGlow.position.set(controls.target.x, Math.max(4, controls.target.y + 4), controls.target.z);
        scene.add(nightGlow);
      } else {
        nightGlow.position.set(controls.target.x, Math.max(4, controls.target.y + 4), controls.target.z);
        nightGlow.visible = true;
      }
    } else if (lightingMode === 'golden') {
      scene.background = new THREE.Color(0xdbe8f5);
      if (hemi) {
        hemi.color.setHex(0xe8f3ff);
        hemi.groundColor.setHex(0x8c7b6a);
        hemi.intensity = 1.16;
      }
      if (key) {
        key.color.setHex(0xffe4bc);
        key.position.set(controls.target.x + 38, controls.target.y + 26, controls.target.z + 28);
        key.intensity = 2.55;
      }
      if (fill) {
        fill.color.setHex(0x9dc2ec);
        fill.intensity = 0.56;
      }
      if (nightGlow) nightGlow.visible = false;
    } else {
      scene.background = new THREE.Color(0xcde3f6);
      if (hemi) {
        hemi.color.setHex(0xf2f8ff);
        hemi.groundColor.setHex(0xb4aa9c);
        hemi.intensity = 1.18;
      }
      if (key) {
        key.color.setHex(0xfff7ea);
        key.position.set(controls.target.x + 26, controls.target.y + 38, controls.target.z + 22);
        key.intensity = 2.45;
      }
      if (fill) {
        fill.color.setHex(0xbcd8f6);
        fill.intensity = 0.48;
      }
      if (nightGlow) nightGlow.visible = false;
    }

    const glowInt = lightingMode === 'night' ? 2.4 : lightingMode === 'golden' ? 0.24 : 0.04;
    const glowOp = lightingMode === 'night' ? 0.82 : lightingMode === 'golden' ? 0.22 : 0.08;
    const soffitInt = lightingMode === 'night' ? 3.2 : lightingMode === 'golden' ? 0.95 : 0.15;
    const uplightInt = lightingMode === 'night' ? 2.6 : lightingMode === 'golden' ? 0.45 : 0.0;

    for (const set of [materials.active, materials.dimmed]) {
      set.glow.emissiveIntensity = glowInt;
      set.glow.opacity = set === materials.active ? glowOp : glowOp * 0.25;
      set.soffitLight.emissiveIntensity = soffitInt;
      set.uplight.emissiveIntensity = uplightInt;
    }

    renderer.domElement.dataset.lighting = lightingMode;
    runtime.requestRender(0);
  }, [lightingMode]);

  // 5. INSTANT LAYER / FLOOR ISOLATION / DIMMING VISIBILITY UPDATE (Zero geometry rebuild!)
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const { floorRecords, siteContext, materials, linkedLineGroup } = runtime;

    const isGroundOrFull =
      !activeFloorId ||
      floorMode !== 'isolate' ||
      activeFloorId.includes('stilt') ||
      activeFloorId.includes('ground') ||
      activeFloorId === projection.floorPlates[0]?.floorId;

    if (siteContext) {
      siteContext.visible = layers.site && isGroundOrFull;
    }

    // Room overlay + furniture ONLY appear when explicitly in 'rooms' view mode OR isolated/cutaway floor mode
    // (NEVER poking light-blue room overlays onto exterior facades in Tower 3D Solid view!)
    const showRoomOverlays = viewMode === 'rooms' || (layers.rooms && (floorMode === 'isolate' || sectionCut));
    const activeFurnSet = new Set<FurnitureCategoryId>(enabledFurnitureCategories ?? ALL_FURNITURE_CATEGORY_IDS);

    for (const rec of floorRecords) {
      const visible = floorMode !== 'isolate' || rec.floorId === activeFloorId;
      rec.group.visible = visible;
      if (!visible) continue;

      rec.layers.floorPlates.visible = layers.floorPlates;
      rec.layers.ceilingSoffits.visible = layers.floorPlates && floorMode !== 'isolate';
      rec.layers.walls.visible = layers.walls;
      rec.layers.openings.visible = layers.openings;
      rec.layers.stairs.visible = layers.stairs;
      rec.layers.rooms.visible = showRoomOverlays;
      for (const catId of ALL_FURNITURE_CATEGORY_IDS) {
        rec.layers.furnitureByCategory[catId].visible = showRoomOverlays && activeFurnSet.has(catId);
      }

      const inLinked = isFloorInLinkedSpan(projection, rec.floorId, activeFloorId, linkedSpanStoreys);
      const isDimmed =
        linkedSpanStoreys > 1
          ? !inLinked
          : floorMode === 'active' && rec.floorId !== activeFloorId;

      const matSet = isDimmed ? materials.dimmed : materials.active;
      for (const entry of rec.meshes) {
        if (entry.isStair && inLinked) {
          entry.mesh.material = materials.stairLinked;
        } else {
          entry.mesh.material = matSet[entry.role];
        }
      }
    }

    // Linked Duplex / Triplex vertical stair guide line
    disposeGeometryOnly(linkedLineGroup);
    linkedLineGroup.clear();
    if (linkedSpanStoreys > 1) {
      const pts: THREE.Vector3[] = [];
      for (const rec of floorRecords) {
        if (!isFloorInLinkedSpan(projection, rec.floorId, activeFloorId, linkedSpanStoreys)) continue;
        const solid = projection.architecturalSolids?.find(
          p => p.floorId === rec.floorId && p.sourceEntityType === 'stair',
        );
        const stair = projection.stairs.find(s => s.floorId === rec.floorId);
        const poly = solid?.boundary ?? stair?.boundary;
        if (!poly?.points.length) continue;
        const c = polygonCenter2D(poly.points);
        const yBase = (solid?.top ?? ((stair?.elevation ?? 0) + 1500)) * MM_TO_M;
        pts.push(new THREE.Vector3(c.x * MM_TO_M, yBase + rec.group.position.y, c.y * MM_TO_M));
      }
      if (pts.length >= 2) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), materials.linkLine);
        line.computeLineDistances();
        linkedLineGroup.add(line);
      }
    }

    runtime.renderer.domElement.dataset.visibleFurnitureCategories = ALL_FURNITURE_CATEGORY_IDS.filter(category =>
      floorRecords.some(record => record.group.visible && record.layers.furnitureByCategory[category].visible
        && record.layers.furnitureByCategory[category].children.length > 0)).join(',');
    runtime.requestRender(0);
  }, [activeFloorId, enabledFurnitureCategories, floorMode, layers, linkedSpanStoreys, projection, sectionCut, viewMode, buildingGeometryKey]);

  // 6. SMOOTH rAF EXPLODE ANIMATION (Moves per-floor group Y only — zero geometry rebuild!)
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const gap = isExploded ? (explodeDistance !== undefined && explodeDistance > 0 ? explodeDistance : EXPLODED_GAP_M) : 0;
    explodeTargetGapRef.current = gap;
    runtime.requestRender(1);
  }, [isExploded, explodeDistance]);

  // 7. LIGHTWEIGHT SELECTION HIGHLIGHT OVERLAY (Zero static rebuild on click!)
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const { selectionOverlay, materials } = runtime;
    delete runtime.renderer.domElement.dataset.selectedCanonicalId;
    disposeGeometryOnly(selectionOverlay);
    selectionOverlay.clear();

    if (selection) {
      const floorIdx = Math.max(0, projection.levels.findIndex(l => l.floorId === selection.floorId));
      const yExplode = floorIdx * explodeCurrentGapRef.current;
      if (selection.entityType === 'room') {
        const room = projection.rooms.find(
          r => r.sourceEntityId === selection.entityId && r.floorId === selection.floorId,
        );
        if (room && room.boundary.points.length >= 3) {
          const inset = insetPolygonTowardCenter(room.boundary, 120);
          const geo = new THREE.ShapeGeometry(makeShape(inset, room.cutouts));
          geo.rotateX(-Math.PI / 2);
          const mesh = new THREE.Mesh(geo, materials.selectHighlight);
          mesh.position.y = room.elevation * MM_TO_M + 0.03 + yExplode;
          selectionOverlay.add(mesh);
        }
      } else if (selection.entityType === 'wall') {
        const wall = projection.walls.find(
          w => w.sourceEntityId === selection.entityId && w.floorId === selection.floorId,
        );
        if (wall) {
          const dx = wall.endPoint.x - wall.startPoint.x;
          const dy = wall.endPoint.y - wall.startPoint.y;
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(wall.length * MM_TO_M + 0.02, wall.height * MM_TO_M + 0.02, wall.thickness * MM_TO_M + 0.04),
            materials.selectHighlight,
          );
          mesh.position.set(
            ((wall.startPoint.x + wall.endPoint.x) / 2) * MM_TO_M,
            (wall.elevation + wall.height / 2) * MM_TO_M + yExplode,
            ((wall.startPoint.y + wall.endPoint.y) / 2) * MM_TO_M,
          );
          mesh.rotation.y = -Math.atan2(dy, dx);
          selectionOverlay.add(mesh);
        }
      } else if (selection.entityType === 'door' || selection.entityType === 'window') {
        const opening = projection.openings.find(
          op => op.sourceEntityId === selection.entityId && op.floorId === selection.floorId,
        );
        const hostWall = opening
          ? projection.walls.find(w => w.sourceEntityId === opening.hostWallId && w.floorId === opening.floorId)
          : undefined;
        if (opening && hostWall && hostWall.length > 0) {
          const { x, y, ux, uy } = openingPose(opening, hostWall);
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(
              Math.max(0.4, opening.width * MM_TO_M + 0.06),
              Math.max(0.4, opening.height * MM_TO_M + 0.06),
              Math.max(0.26, hostWall.thickness * MM_TO_M + 0.1),
            ),
            materials.selectHighlight,
          );
          mesh.position.set(
            x * MM_TO_M,
            (opening.elevation + opening.bottom + opening.height / 2) * MM_TO_M + yExplode,
            y * MM_TO_M,
          );
          mesh.rotation.y = -Math.atan2(uy, ux);
          selectionOverlay.add(mesh);
        }
      }
    }

    if (selection && selectionOverlay.children.length > 0) {
      runtime.renderer.domElement.dataset.selectedCanonicalId = selection.entityId;
    }
    runtime.requestRender(0);
  }, [selection, projection]);

  // 8. SECTION CUT / CUTAWAY CLIPPING PLANE
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const outline =
      projection.floorPlates.find(plate => plate.floorId === activeFloorId)?.boundary ??
      projection.site.plotBoundary;
    const depths = outline.points.map(point => point.y * MM_TO_M);
    runtime.renderer.clippingPlanes =
      sectionCut && depths.length
        ? [new THREE.Plane(new THREE.Vector3(0, 0, -1), (Math.min(...depths) + Math.max(...depths)) / 2)]
        : [];
    runtime.renderer.domElement.dataset.section = sectionCut ? 'on' : 'off';
    runtime.requestRender(0);
  }, [sectionCut, projection, activeFloorId]);

  // 9. CAMERA FIT & PRESETS OR WALKTHROUGH ENTRY
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    runtime.camera = parallelProjection && !walkthroughActive ? runtime.orthographic : runtime.perspective;
    runtime.controls.object = runtime.camera;
    runtime.renderer.domElement.dataset.projection =
      runtime.camera === runtime.orthographic ? 'orthographic' : 'perspective';

    if (walkthroughActive) {
      const level = projection.levels.find(l => l.floorId === activeFloorId) ?? projection.levels[0];
      const floorRooms = projection.rooms.filter(r => r.floorId === (level?.floorId ?? activeFloorId));
      const primaryRoom = floorRooms.find(r => /living|drawing|hall/i.test(r.sourceEntityId)) ?? floorRooms[0];
      const plate =
        projection.floorPlates.find(p => p.floorId === (level?.floorId ?? activeFloorId)) ??
        projection.floorPlates[0];
      const targetPoly = primaryRoom?.boundary.points ?? plate?.boundary.points ?? [{ x: 4000, y: 4000 }];
      const c = polygonCenter2D(targetPoly);
      const floorIdx = Math.max(0, projection.levels.findIndex(l => l.floorId === level?.floorId));
      const elevM = (level?.elevation ?? 0) * MM_TO_M + floorIdx * explodeCurrentGapRef.current;
      const eyeY = elevM + 1.65;
      runtime.walkYaw = 0;
      runtime.camera.position.set(c.x * MM_TO_M, eyeY, c.y * MM_TO_M + 1.8);
      runtime.controls.target.set(c.x * MM_TO_M, eyeY - 0.08, c.y * MM_TO_M - 1.2);
      runtime.camera.far = 300;
      runtime.camera.updateProjectionMatrix();
      runtime.controls.update();
      runtime.requestRender(0);
      return;
    }

    const group = runtime.scene.getObjectByName('building-projection');
    if (!group) return;
    let box: THREE.Box3;
    if (floorMode === 'isolate') {
      const isolatedRec = runtime.floorRecords.find(r => r.floorId === activeFloorId);
      box = isolatedRec ? new THREE.Box3().setFromObject(isolatedRec.group) : getModelBounds(group, false);
    } else {
      box = getModelBounds(group, fitSite);
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const { fov, aspect } = runtime.perspective;
    const distance = modelFitDistance(box, fov, aspect);
    runtime.orthographic.zoom = 1;
    runtime.fitOrthographic(distance * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * Math.min(1, aspect));
    const elevationOffset = new THREE.Vector3(0, parallelProjection ? 0 : distance * 0.2, 0);
    const roadOffsets = { north: 0, east: 90, south: 180, west: 270 } as const;
    const siteAngle = ((projection.site.northDegrees + roadOffsets[projection.site.roadFacing]) * Math.PI) / 180;
    const front = new THREE.Vector3(Math.sin(siteAngle), 0, -Math.cos(siteAngle));
    const right = new THREE.Vector3(-front.z, 0, front.x);
    const positions: Record<ModelCameraPreset, THREE.Vector3> = {
      isometric: center.clone().addScaledVector(new THREE.Vector3(1.18, 0.56, 1.05).normalize(), distance),
      front: center.clone().addScaledVector(front, distance).add(elevationOffset),
      back: center.clone().addScaledVector(front, -distance).add(elevationOffset),
      left: center.clone().addScaledVector(right, -distance).add(elevationOffset),
      right: center.clone().addScaledVector(right, distance).add(elevationOffset),
      top: new THREE.Vector3(center.x, center.y + distance, center.z + 0.001),
    };
    runtime.camera.position.copy(positions[cameraPreset]);
    runtime.camera.far = Math.max(900, distance * 12);
    runtime.camera.updateProjectionMatrix();
    runtime.skyDome.position.copy(center);

    const keyLight = runtime.scene.getObjectByName('key-light') as THREE.DirectionalLight | undefined;
    if (keyLight) {
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(18, Math.hypot(size.x, size.y, size.z) * 0.72);
      const sunOffset =
        lightingMode === 'night'
          ? new THREE.Vector3(24, 34, 20)
          : lightingMode === 'golden'
            ? new THREE.Vector3(38, 26, 28)
            : new THREE.Vector3(26, 38, 22);
      keyLight.position.copy(center).add(sunOffset);
      keyLight.target.position.copy(center);
      keyLight.target.updateMatrixWorld();
      keyLight.shadow.camera.left = -radius;
      keyLight.shadow.camera.right = radius;
      keyLight.shadow.camera.top = radius;
      keyLight.shadow.camera.bottom = -radius;
      keyLight.shadow.camera.far = Math.max(160, radius * 5);
      keyLight.shadow.camera.updateProjectionMatrix();
    }

    runtime.controls.maxDistance = Math.max(1600, distance * 4);
    runtime.controls.minZoom = 0.25;
    runtime.controls.maxZoom = 12;
    runtime.controls.target.copy(center);
    runtime.controls.update();
    runtime.requestRender(0);
  }, [cameraPreset, fitRequest, buildingGeometryKey, activeFloorId, floorMode, fitSite, walkthroughActive, parallelProjection]);

  // 10. ZOOM & WALKTHROUGH & SNAPSHOT HANDLERS
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !zoomCommand || zoomCommand.seq === 0) return;
    const factor = zoomCommand.dir === 'in' ? 0.8 : 1.25;
    if (runtime.camera === runtime.orthographic) {
      runtime.orthographic.zoom = THREE.MathUtils.clamp(runtime.orthographic.zoom / factor, 0.25, 12);
      runtime.orthographic.updateProjectionMatrix();
      runtime.requestRender(0);
      return;
    }
    const dir = runtime.camera.position.clone().sub(runtime.controls.target).multiplyScalar(factor);
    if (dir.length() >= 0.4 && dir.length() <= 1600) {
      runtime.camera.position.copy(runtime.controls.target).add(dir);
      runtime.controls.update();
      runtime.requestRender(0);
    }
  }, [zoomCommand]);

  useEffect(() => {
    if (!walkthroughActive) return;
    const applyStep = (action: 'forward' | 'backward' | 'left' | 'right') => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const forwardVec = runtime.controls.target.clone().sub(runtime.camera.position);
      forwardVec.y = 0;
      if (forwardVec.lengthSq() < 1e-6) forwardVec.set(0, 0, -1);
      forwardVec.normalize();
      if (action === 'forward' || action === 'backward') {
        const delta = forwardVec.multiplyScalar(action === 'forward' ? 0.9 : -0.9);
        runtime.camera.position.add(delta);
        runtime.controls.target.add(delta);
      } else {
        const angle = action === 'left' ? 0.28 : -0.28;
        const offset = runtime.controls.target.clone().sub(runtime.camera.position);
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        runtime.controls.target.copy(runtime.camera.position).add(offset);
      }
      runtime.controls.update();
      runtime.requestRender(0);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') applyStep('forward');
      else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') applyStep('backward');
      else if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') applyStep('left');
      else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') applyStep('right');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [walkthroughActive]);

  useEffect(() => {
    if (!walkthroughActive || !walkCommand || walkCommand.seq === 0) return;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const forwardVec = runtime.controls.target.clone().sub(runtime.camera.position);
    forwardVec.y = 0;
    if (forwardVec.lengthSq() < 1e-6) forwardVec.set(0, 0, -1);
    forwardVec.normalize();
    if (walkCommand.action === 'forward' || walkCommand.action === 'backward') {
      const delta = forwardVec.multiplyScalar(walkCommand.action === 'forward' ? 0.9 : -0.9);
      runtime.camera.position.add(delta);
      runtime.controls.target.add(delta);
    } else {
      const angle = walkCommand.action === 'left' ? 0.35 : -0.35;
      const offset = runtime.controls.target.clone().sub(runtime.camera.position);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      runtime.controls.target.copy(runtime.camera.position).add(offset);
    }
    runtime.controls.update();
    runtime.requestRender(0);
  }, [walkthroughActive, walkCommand]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !snapshotRequest || !runtime.renderNow()) return;
    const link = document.createElement('a');
    link.download = 'architectural-model-view.png';
    link.href = runtime.renderer.domElement.toDataURL('image/png');
    link.click();
  }, [snapshotRequest]);

  // Fast Semantic Raycast against Merged Floor Meshes -> Canonical Room / Wall / Opening Resolution
  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const click = isModelClick(pointerStart.current, event.clientX, event.clientY, event.pointerId);
    pointerStart.current = null;
    if (!click || event.button !== 0) return;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const rect = runtime.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, runtime.camera);
    const buildingGroup = runtime.scene.getObjectByName('building-projection');
    const hits = buildingGroup ? raycaster.intersectObjects(buildingGroup.children, true) : [];
    const hit = hits.find(result => {
      let object: THREE.Object3D | null = result.object;
      for (; object; object = object.parent) if (!object.visible) return false;
      return result.object.userData.floorId
        && runtime.renderer.clippingPlanes.every(plane => plane.distanceToPoint(result.point) >= 0);
    });
    if (!hit) {
      onClearSelection();
      return;
    }

    const hitFloorId = String(hit.object.userData.floorId);
    const faceIndex = hit.faceIndex;
    const pickRanges = hit.object.userData.pickRanges as
      { from: number; to: number; source: ProjectionSource }[] | undefined;
    const direct = faceIndex == null ? undefined : pickRanges?.find(range => range.from <= faceIndex && faceIndex < range.to);
    if (direct) {
      onSelect(direct.source);
      return;
    }

    const worldMm: Point = { x: hit.point.x / MM_TO_M, y: hit.point.z / MM_TO_M };
    const matchedRoom = projection.rooms.find(
      r => r.floorId === hitFloorId && pointInPolygon2D(worldMm, r.boundary.points),
    );
    if (matchedRoom) {
      onSelect(matchedRoom);
      return;
    }
    const matchedPlate = projection.floorPlates.find(p => p.floorId === hitFloorId);
    if (matchedPlate) onSelect(matchedPlate);
  };

  return (
    <div
      ref={hostRef}
      className="three-building-scene"
      onPointerDown={event => {
        pointerStart.current =
          event.button === 0 && event.isPrimary
            ? { x: event.clientX, y: event.clientY, id: event.pointerId }
            : null;
      }}
      onPointerMove={event => {
        if (pointerStart.current && !isModelClick(pointerStart.current, event.clientX, event.clientY, event.pointerId)) {
          pointerStart.current = null;
        }
      }}
      onPointerCancel={() => {
        pointerStart.current = null;
      }}
      onPointerUp={handlePointerUp}
    >
      {renderError && (
        <div className="model-empty-state" role="alert">
          {renderError}
        </div>
      )}
    </div>
  );
};

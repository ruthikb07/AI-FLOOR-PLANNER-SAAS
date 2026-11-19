import React, { useEffect, useRef, useState } from 'react';
import { getModelBounds, isModelClick, modelFitDistance } from '../../services/model-camera';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { EditorSelection, Point, Polygon } from '@ai-floor-planner/core';
import { DoorType } from '@ai-floor-planner/core';
import { computeStairSolids } from '@ai-floor-planner/geometry-engine';
import { makeProjectionShape as makeShape } from './projection-shape';
import { millimetersToSceneUnits, type Building3DProjection, type ProjectionSource } from '@ai-floor-planner/projection-3d';
import { shouldRenderRoomProjection, type ModelCameraPreset, type ModelFloorMode, type ModelLayerVisibility, type ModelViewMode } from '../../services/projection-preferences';

const MM_TO_M = millimetersToSceneUnits(1);
const EXPLODED_GAP_M = 1.8;

export type ArchitecturalMaterialPalette = 'travertine' | 'concrete' | 'coastal';
export type BuildingLightingMode = 'day' | 'golden' | 'night';

function createProceduralRoughnessMap(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#c8c8c8';
  ctx.fillRect(0, 0, 128, 128);
  // Subtle architectural travertine / board-formed concrete micro-grain
  for (let y = 0; y < 128; y += 2) {
    const band = 188 + Math.round(Math.sin(y * 0.42) * 14);
    ctx.fillStyle = `rgb(${band},${band},${band})`;
    ctx.fillRect(0, y, 128, 2);
  }
  for (let i = 0; i < 650; i++) {
    const x = (i * 47) % 128;
    const y = (i * 83) % 128;
    const v = 165 + ((i * 29) % 58);
    ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
    ctx.fillRect(x, y, 2, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.needsUpdate = true;
  return tex;
}

const MATERIAL_PALETTES: Record<
  ArchitecturalMaterialPalette,
  {
    wall: number;
    wallRoughness: number;
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
    wall: 0xf6f0e6,
    wallRoughness: 0.76,
    slab: 0xded5c6,
    trim: 0xb68e4c,
    door: 0x8b5a34,
    glass: 0x5aa9d6,
    stair: 0xc9a068,
    lawn: 0xb8cba7,
    road: 0x4b5563,
  },
  concrete: {
    wall: 0xe6eaf0,
    wallRoughness: 0.72,
    slab: 0xcbd5e1,
    trim: 0x334155,
    door: 0x6b4423,
    glass: 0x60a5fa,
    stair: 0x94a3b8,
    lawn: 0xa7be9c,
    road: 0x374151,
  },
  coastal: {
    wall: 0xf1e6d6,
    wallRoughness: 0.8,
    slab: 0xdccbb4,
    trim: 0xb56d45,
    door: 0x714424,
    glass: 0x38bdf8,
    stair: 0xc89662,
    lawn: 0xa9c39b,
    road: 0x525866,
  },
};

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

type SelectableObject = THREE.Object3D & { userData: ProjectionSource };

function floorOffset(projection: Building3DProjection, floorId: string | undefined, exploded: boolean, customGapM?: number): number {
  if (!exploded || !floorId) return 0;
  const index = projection.levels.findIndex(level => level.floorId === floorId);
  const gap = customGapM !== undefined && customGapM > 0 ? customGapM : EXPLODED_GAP_M;
  return Math.max(0, index) * gap;
}

function shouldShowFloor(floorId: string | undefined, activeFloorId: string, mode: ModelFloorMode): boolean {
  return mode !== 'isolate' || !floorId || floorId === activeFloorId;
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

function floorContextOpacity(
  projection: Building3DProjection,
  floorId: string | undefined,
  activeFloorId: string,
  mode: ModelFloorMode,
  linkedSpanStoreys: 1 | 2 | 3,
): number {
  if (linkedSpanStoreys > 1) {
    return isFloorInLinkedSpan(projection, floorId, activeFloorId, linkedSpanStoreys) ? 1 : 0.24;
  }
  return mode === 'active' && floorId && floorId !== activeFloorId ? 0.15 : 1;
}

function addEdges(mesh: THREE.Mesh, color = 0x8a7d6d, opacity = 0.28): void {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
  mesh.add(edges);
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse(child => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach(value => value.dispose());
    else material?.dispose();
  });
}

function selected(source: ProjectionSource, selection: EditorSelection | null): boolean {
  return Boolean(selection && source.sourceEntityId === selection.entityId && source.floorId === selection.floorId);
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

export const ThreeBuildingScene: React.FC<ThreeBuildingSceneProps> = ({
  projection,
  activeFloorId,
  selection,
  viewMode,
  cameraPreset,
  floorMode,
  exploded,
  explodeDistance,
  lightingMode = 'day',
  materialPalette = 'travertine',
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
  const runtimeRef = useRef<{
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    perspective: THREE.PerspectiveCamera;
    orthographic: THREE.OrthographicCamera;
    fitOrthographic: (halfHeight: number) => void;
    stoneNormal: THREE.Texture;
    roughnessMap: THREE.Texture | null;
    controls: OrbitControls;
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    walkYaw: number;
    requestRender: () => void;
  } | null>(null);

  const isExploded = Boolean(exploded || (explodeDistance !== undefined && explodeDistance > 0));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeaf1f8);
    scene.fog = null;

    const camera = new THREE.PerspectiveCamera(40, Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight), 0.05, 1000);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      setRenderError('3D could not start. Enable browser hardware acceleration and reload. Your 2D project is unchanged; Blender export is still available.');
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.domElement.setAttribute('aria-label', 'Interactive canonical 3D building model');
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.zoomSpeed = 1.15;
    controls.minDistance = 0.2;
    controls.maxDistance = 2000;
    controls.target.set(5, 2, 5);
    renderer.domElement.setAttribute('data-zoom-to-cursor', 'true');
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

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const wheelRaycaster = new THREE.Raycaster();
    const wheelPointer = new THREE.Vector2();
    const planeHit = new THREE.Vector3();

    const handleWheelCursorZoom = (event: WheelEvent) => {
      controls.zoomToCursor = true;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      wheelPointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const activeCamera = currentCamera();
      wheelRaycaster.setFromCamera(wheelPointer, activeCamera);
      const buildingGroup = scene.getObjectByName('building-projection');
      const hits = buildingGroup ? wheelRaycaster.intersectObjects(buildingGroup.children, true) : [];
      const hitPoint = hits.find(hit => renderer.clippingPlanes.every(plane => plane.distanceToPoint(hit.point) >= 0))?.point
        ?? (wheelRaycaster.ray.intersectPlane(groundPlane, planeHit) ? planeHit : null);
      if (hitPoint && event.deltaY < 0) {
        const shift = hitPoint.clone().sub(controls.target).multiplyScalar(0.12);
        controls.target.add(shift);
        activeCamera.position.add(shift);
        const nightGlow = scene.getObjectByName('night-glow-light') as THREE.PointLight | undefined;
        if (nightGlow && nightGlow.visible) {
          nightGlow.position.set(controls.target.x, Math.max(4, controls.target.y + 3), controls.target.z);
        }
      }
      renderer.render(scene, activeCamera);
    };
    renderer.domElement.addEventListener('wheel', handleWheelCursorZoom, { passive: true });

    const hemiLight = new THREE.HemisphereLight(0xf6fbff, 0xd8cfc0, 1.55);
    hemiLight.name = 'hemi-light';
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff9ee, 2.75);
    keyLight.name = 'key-light';
    keyLight.position.set(18, 28, 16);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 120;
    keyLight.shadow.camera.left = -35;
    keyLight.shadow.camera.right = 35;
    keyLight.shadow.camera.top = 35;
    keyLight.shadow.camera.bottom = -35;
    keyLight.shadow.bias = -0.0004;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xd0e6ff, 0.72);
    fillLight.name = 'fill-light';
    fillLight.position.set(-18, 14, -14);
    scene.add(fillLight);

    const grid = new THREE.GridHelper(60, 60, 0x38bdf8, 0x1e293b);
    grid.name = 'ground-grid';
    grid.position.y = -0.04;
    if (Array.isArray(grid.material)) {
      grid.material.forEach(m => { m.transparent = true; m.opacity = 0.28; });
    } else {
      grid.material.transparent = true;
      grid.material.opacity = 0.28;
    }
    scene.add(grid);

    let rafId = 0;
    let dampingFrames = 0;
    let disposed = false;
    const render = () => {
      if (disposed) return;
      renderer.render(scene, currentCamera());
    };
    const tickDamping = () => {
      rafId = 0;
      if (disposed) return;
      controls.update();
      renderer.render(scene, currentCamera());
      if (dampingFrames > 0) {
        dampingFrames--;
        rafId = requestAnimationFrame(tickDamping);
      }
    };
    const requestRender = () => {
      dampingFrames = 18;
      if (!rafId && !disposed) {
        rafId = requestAnimationFrame(tickDamping);
      }
    };

    const roughnessMap = createProceduralRoughnessMap();
    new HDRLoader().load(`${import.meta.env.BASE_URL}architecture/daylight.hdr`, texture => {
      if (disposed) {
        texture.dispose();
        return;
      }
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = texture;
      render();
    }, undefined, () => { /* Direct lights remain active if the environment fails to load. */ });
    const stoneNormal = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}architecture/cast-stone-normal.webp`, () => {
      if (!disposed) render();
    }, undefined, () => { });
    stoneNormal.wrapS = stoneNormal.wrapT = THREE.RepeatWrapping;
    stoneNormal.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    controls.addEventListener('change', render);
    renderer.domElement.addEventListener('pointermove', () => { if (controls.enabled) requestRender(); }, { passive: true });
    const resize = new ResizeObserver(() => {
      if (!host.clientWidth || !host.clientHeight) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      fitOrthographic(halfHeight);
      renderer.setSize(host.clientWidth, host.clientHeight);
      render();
    });
    resize.observe(host);
    runtimeRef.current = {
      camera, perspective: camera, orthographic, fitOrthographic, stoneNormal, roughnessMap, controls, renderer, scene, walkYaw: 0, requestRender,
    };

    if (sceneRef) {
      sceneRef.current = scene;
    }

    render();
    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      scene.environment?.dispose();
      stoneNormal.dispose();
      roughnessMap?.dispose();
      scene.environment = null;
      resize.disconnect();
      renderer.domElement.removeEventListener('wheel', handleWheelCursorZoom);
      controls.removeEventListener('change', render);
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      runtimeRef.current = null;
    };
  }, []);

  // Day / Golden Hour / Night Lighting Mode
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const { scene, renderer, camera, controls } = runtime;
    controls.zoomToCursor = true;
    const hemi = scene.getObjectByName('hemi-light') as THREE.HemisphereLight | undefined;
    const key = scene.getObjectByName('key-light') as THREE.DirectionalLight | undefined;
    const fill = scene.getObjectByName('fill-light') as THREE.DirectionalLight | undefined;
    const grid = scene.getObjectByName('ground-grid') as THREE.GridHelper | undefined;
    const nightGlowName = 'night-glow-light';
    let nightGlow = scene.getObjectByName(nightGlowName) as THREE.PointLight | undefined;

    scene.environmentIntensity = lightingMode === 'night' ? 0.18 : lightingMode === 'golden' ? 0.42 : 0.62;
    if (lightingMode === 'night') {
      scene.background = new THREE.Color(0x070a12);
      if (hemi) {
        hemi.color.setHex(0x1f2d4f);
        hemi.groundColor.setHex(0x080b12);
        hemi.intensity = 0.88;
      }
      if (key) {
        key.color.setHex(0x8fa8e8);
        key.position.set(16, 26, 14);
        key.intensity = 0.85;
      }
      if (fill) {
        fill.color.setHex(0xf59e0b);
        fill.intensity = 0.58;
      }
      if (!nightGlow) {
        nightGlow = new THREE.PointLight(0xffb84d, 3.2, 140, 1.15);
        nightGlow.name = nightGlowName;
        nightGlow.position.set(controls.target.x, Math.max(4, controls.target.y + 4), controls.target.z);
        scene.add(nightGlow);
      } else {
        nightGlow.position.set(controls.target.x, Math.max(4, controls.target.y + 4), controls.target.z);
        nightGlow.visible = true;
      }
      if (grid) grid.visible = true;
    } else if (lightingMode === 'golden') {
      scene.background = new THREE.Color(0x191722);
      if (hemi) {
        hemi.color.setHex(0xffd2a1);
        hemi.groundColor.setHex(0x3a2d24);
        hemi.intensity = 1.25;
      }
      if (key) {
        key.color.setHex(0xffa44a);
        key.position.set(28, 12, 20);
        key.intensity = 2.85;
      }
      if (fill) {
        fill.color.setHex(0x6b95d6);
        fill.intensity = 0.65;
      }
      if (nightGlow) nightGlow.visible = false;
      if (grid) grid.visible = true;
    } else {
      scene.background = new THREE.Color(0xc8d7e4);
      if (hemi) {
        hemi.color.setHex(0xf2f8ff);
        hemi.groundColor.setHex(0xb8aea0);
        hemi.intensity = 1.12;
      }
      if (key) {
        key.color.setHex(0xfff5e4);
        key.position.set(18, 30, 16);
        key.intensity = 2.45;
      }
      if (fill) {
        fill.color.setHex(0xbcd8f6);
        fill.intensity = 0.48;
      }
      if (nightGlow) nightGlow.visible = false;
      if (grid) grid.visible = true;
    }
    // Dynamically modulate Warm 2700K emissive interior glow & pathway bollards
    const glowIntensity = lightingMode === 'night' ? 2.35 : lightingMode === 'golden' ? 1.15 : 0.08;
    scene.traverse(obj => {
      if (obj instanceof THREE.Mesh && obj.userData?.emissiveRole === 'warm2700k') {
        const mat = obj.material as THREE.MeshStandardMaterial;
        if (mat && 'emissiveIntensity' in mat) {
          mat.emissiveIntensity = glowIntensity;
        }
      }
    });
    renderer.render(scene, camera);
  }, [lightingMode]);

  // Construct Canonical Building Geometry + PBR Material Finishes + Duplex Stair Links
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const { camera, renderer, scene } = runtime;
    const previous = scene.getObjectByName('building-projection');
    if (previous) {
      scene.remove(previous);
      disposeObject(previous);
    }

    const palette = MATERIAL_PALETTES[materialPalette];
    const group = new THREE.Group();
    group.name = 'building-projection';
    const xray = viewMode === 'xray';

    const pbrMaterial = (color: number, opacity = 1, roughness = 0.72, metalness = 0.06, useRoughnessMap = false) =>
      new THREE.MeshStandardMaterial({
        color,
        transparent: opacity < 1 || xray,
        opacity: xray ? Math.min(opacity, 0.34) : opacity,
        roughness,
        metalness,
        ...(useRoughnessMap && runtime.roughnessMap ? { roughnessMap: runtime.roughnessMap, bumpMap: runtime.roughnessMap, bumpScale: 0.015 } : {}),
        side: THREE.DoubleSide,
        depthWrite: !xray && opacity >= 0.99,
      });

    const glassMaterial = (opacity = 0.56) =>
      new THREE.MeshPhysicalMaterial({
        color: palette.glass,
        transparent: true,
        opacity: xray ? Math.min(opacity, 0.3) : Math.max(0.42, opacity),
        roughness: 0.08,
        metalness: 0.1,
        transmission: xray ? 0 : 0.65,
        ior: 1.5,
        thickness: 0.08,
        reflectivity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

    const bronzeMullionMaterial = (opacity = 1) =>
      new THREE.MeshStandardMaterial({
        color: 0x7a5c3e,
        transparent: opacity < 1 || xray,
        opacity: xray ? Math.min(opacity, 0.35) : opacity,
        roughness: 0.28,
        metalness: 0.78,
      });

    const currentGlowIntensity = lightingMode === 'night' ? 2.35 : lightingMode === 'golden' ? 1.15 : 0.08;
    const warmInteriorGlowMaterial = (opacity = 1) =>
      new THREE.MeshStandardMaterial({
        color: 0xffd28a,
        emissive: new THREE.Color(0xffa73b),
        emissiveIntensity: currentGlowIntensity,
        transparent: opacity < 1 || xray,
        opacity: xray ? 0.15 : Math.min(0.88, opacity),
        roughness: 0.4,
        metalness: 0.02,
      });

    const addSelectable = (mesh: THREE.Mesh, source: ProjectionSource) => {
      mesh.userData = source;
      group.add(mesh);
    };

    const isGroundOrFull =
      !activeFloorId ||
      floorMode !== 'isolate' ||
      activeFloorId.includes('stilt') ||
      activeFloorId.includes('ground') ||
      activeFloorId === projection.floorPlates[0]?.floorId;

    if (layers.site && isGroundOrFull) {
      const siteContext = new THREE.Group();
      siteContext.name = 'site-context';
      group.add(siteContext);

      const siteGeometry = new THREE.ShapeGeometry(makeShape(projection.site.plotBoundary));
      siteGeometry.rotateX(-Math.PI / 2);
      const site = new THREE.Mesh(siteGeometry, pbrMaterial(palette.lawn, 1, 0.92, 0.02));
      site.position.y = -0.02;
      site.receiveShadow = true;
      site.userData = projection.site;
      addEdges(site, 0x6b8260, 0.45);
      siteContext.add(site);

      if (projection.site.buildableEnvelope) {
        const points = projection.site.buildableEnvelope.points.map(
          point => new THREE.Vector3(point.x * MM_TO_M, 0.02, point.y * MM_TO_M),
        );
        points.push(points[0]!.clone());
        const envelope = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineDashedMaterial({ color: palette.trim, dashSize: 0.35, gapSize: 0.2 }),
        );
        envelope.computeLineDistances();
        siteContext.add(envelope);
      }

      if (projection.site.roadWidth) {
        const xs = projection.site.plotBoundary.points.map(point => point.x);
        const ys = projection.site.plotBoundary.points.map(point => point.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const width = projection.site.roadWidth;
        const roadPolygons = {
          north: { points: [{ x: minX, y: minY - width }, { x: maxX, y: minY - width }, { x: maxX, y: minY }, { x: minX, y: minY }] },
          south: { points: [{ x: minX, y: maxY }, { x: maxX, y: maxY }, { x: maxX, y: maxY + width }, { x: minX, y: maxY + width }] },
          east: { points: [{ x: maxX, y: minY }, { x: maxX + width, y: minY }, { x: maxX + width, y: maxY }, { x: maxX, y: maxY }] },
          west: { points: [{ x: minX - width, y: minY }, { x: minX, y: minY }, { x: minX, y: maxY }, { x: minX - width, y: maxY }] },
        } satisfies Record<string, Polygon>;
        const roadGeometry = new THREE.ShapeGeometry(makeShape(roadPolygons[projection.site.roadFacing]));
        roadGeometry.rotateX(-Math.PI / 2);
        const road = new THREE.Mesh(roadGeometry, pbrMaterial(palette.road, 1, 0.88, 0.04));
        road.position.y = -0.025;
        road.receiveShadow = true;
        siteContext.add(road);
      }

      // Landscaped podium trees, reflective arrival water court, warm pathway bollards & low-contrast urban context massing
      const pXs = projection.site.plotBoundary.points.map(p => p.x * MM_TO_M);
      const pYs = projection.site.plotBoundary.points.map(p => p.y * MM_TO_M);
      if (pXs.length > 0 && pYs.length > 0) {
        const minXm = Math.min(...pXs);
        const maxXm = Math.max(...pXs);
        const minYm = Math.min(...pYs);
        const maxYm = Math.max(...pYs);
        const midX = (minXm + maxXm) / 2;
        const midZ = (minYm + maxYm) / 2;
        const plotW = Math.max(8, maxXm - minXm);
        const plotD = Math.max(8, maxYm - minYm);

        // Multi-tier architectural podium trees along plot perimeter
        const cornerTrees: Array<[number, number]> = [
          [minXm + 1.1, minYm + 1.1],
          [maxXm - 1.1, minYm + 1.1],
          [minXm + 1.1, maxYm - 1.1],
          [maxXm - 1.1, maxYm - 1.1],
          [minXm + 1.1, midZ],
          [maxXm - 1.1, midZ],
        ];
        cornerTrees.forEach(([tx, tz]) => {
          const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.11, 0.17, 1.45, 8),
            pbrMaterial(0x5d4436, 1, 0.9, 0.02),
          );
          trunk.position.set(tx, 0.725, tz);
          trunk.castShadow = true;
          siteContext.add(trunk);

          const lowerCanopy = new THREE.Mesh(
            new THREE.DodecahedronGeometry(0.95, 1),
            pbrMaterial(0x3f6142, 1, 0.84, 0.02),
          );
          lowerCanopy.position.set(tx, 1.95, tz);
          lowerCanopy.castShadow = true;
          siteContext.add(lowerCanopy);

          const upperCanopy = new THREE.Mesh(
            new THREE.DodecahedronGeometry(0.68, 1),
            pbrMaterial(0x527a52, 1, 0.82, 0.02),
          );
          upperCanopy.position.set(tx + 0.15, 2.55, tz - 0.1);
          upperCanopy.castShadow = true;
          siteContext.add(upperCanopy);
        });

        // Reflective arrival water court along front setback
        const waterZ = projection.site.roadFacing === 'north' ? minYm + 1.3 : maxYm - 1.3;
        const waterW = Math.min(plotW * 0.36, 7.2);
        const waterMat = new THREE.MeshPhysicalMaterial({
          color: 0x0b1f2e,
          roughness: 0.05,
          metalness: 0.15,
          clearcoat: 1.0,
          clearcoatRoughness: 0.05,
          reflectivity: 0.95,
        });
        const waterPool = new THREE.Mesh(new THREE.BoxGeometry(waterW, 0.06, 1.5), waterMat);
        waterPool.position.set(midX, 0.02, waterZ);
        waterPool.receiveShadow = true;
        siteContext.add(waterPool);

        // Warm 2700K pathway bollards flanking the arrival court
        const bollardXs = [midX - waterW / 2 - 0.7, midX + waterW / 2 + 0.7, minXm + 2.4, maxXm - 2.4];
        for (const bx of bollardXs) {
          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.06, 0.07, 0.72, 8),
            pbrMaterial(0x1e2430, 1, 0.45, 0.65),
          );
          post.position.set(bx, 0.36, waterZ);
          post.castShadow = true;
          siteContext.add(post);

          const lens = new THREE.Mesh(
            new THREE.CylinderGeometry(0.055, 0.055, 0.14, 8),
            warmInteriorGlowMaterial(1),
          );
          lens.position.set(bx, 0.66, waterZ);
          lens.userData = { emissiveRole: 'warm2700k' };
          siteContext.add(lens);
        }

        // Low-contrast urban context massing blocks far outside the site parcel
        const contextMat = new THREE.MeshStandardMaterial({
          color: 0x161c26,
          roughness: 0.88,
          metalness: 0.08,
          transparent: true,
          opacity: 0.48,
        });
        const neighbors: Array<[number, number, number, number, number]> = [
          [minXm - 14, midZ - 6, 10, 9.5, 14],
          [maxXm + 14, midZ + 4, 11, 12.5, 15],
          [midX - 10, minYm - 18, 13, 8.5, 9],
          [midX + 12, maxYm + 18, 12, 11.0, 9],
        ];
        for (const [nx, nz, nw, nh, nd] of neighbors) {
          if (Math.abs(nx - midX) < plotW * 0.55 && Math.abs(nz - midZ) < plotD * 0.55) continue;
          const mass = new THREE.Mesh(new THREE.BoxGeometry(nw, nh, nd), contextMat);
          mass.position.set(nx, nh / 2 - 0.03, nz);
          mass.receiveShadow = true;
          siteContext.add(mass);
        }
      }
    }

    if (layers.floorPlates) {
      projection.floorPlates.forEach(plate => {
        if (!shouldShowFloor(plate.floorId, activeFloorId, floorMode)) return;
        const geometry = new THREE.ExtrudeGeometry(makeShape(plate.boundary, plate.cutouts), {
          depth: plate.thickness * MM_TO_M,
          bevelEnabled: false,
        });
        geometry.rotateX(-Math.PI / 2);
        const sourceSelected = selected(plate, selection);
        const opacity = floorContextOpacity(projection, plate.floorId, activeFloorId, floorMode, linkedSpanStoreys);
        const mesh = new THREE.Mesh(
          geometry,
          pbrMaterial(sourceSelected ? 0xd97706 : palette.slab, 0.96 * opacity, 0.72, 0.06),
        );
        mesh.position.y = plate.elevation * MM_TO_M + floorOffset(projection, plate.floorId, isExploded, explodeDistance);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        addEdges(mesh, 0x8d8272, 0.28);
        addSelectable(mesh, plate);
      });
    }

    projection.rooms.forEach(room => {
      if (!shouldRenderRoomProjection(room.sourceEntityId, layers.rooms, viewMode, selection)) return;
      if (!shouldShowFloor(room.floorId, activeFloorId, floorMode)) return;
      const geometry =
        viewMode === 'rooms'
          ? new THREE.ExtrudeGeometry(makeShape(room.boundary, room.cutouts), {
            depth: room.height * MM_TO_M * 0.88,
            bevelEnabled: false,
          })
          : new THREE.ShapeGeometry(makeShape(room.boundary, room.cutouts));
      geometry.rotateX(-Math.PI / 2);
      const roomSelected = selected(room, selection);
      const opacity = floorContextOpacity(projection, room.floorId, activeFloorId, floorMode, linkedSpanStoreys);
      const roomMaterial = roomSelected
        ? new THREE.MeshBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: false })
        : pbrMaterial(0x7dd3fc, (viewMode === 'rooms' ? 0.24 : 0.38) * opacity, 0.65, 0.05);
      const mesh = new THREE.Mesh(geometry, roomMaterial);
      mesh.position.y = room.elevation * MM_TO_M + 0.015 + floorOffset(projection, room.floorId, isExploded, explodeDistance);
      mesh.renderOrder = roomSelected ? 20 : 2;
      addSelectable(mesh, room);

      // 3D Furniture & Balcony Railings inside canonical rooms
      if (!xray && room.boundary.points.length >= 3) {
        const rc = polygonCenter2D(room.boundary.points);
        const rx = rc.x * MM_TO_M;
        const rz = rc.y * MM_TO_M;
        const ry = room.elevation * MM_TO_M + 0.02 + floorOffset(projection, room.floorId, isExploded, explodeDistance);
        const rName = room.sourceEntityId.toLowerCase();
        const fOpacity = opacity;

        if (rName.includes('bed')) {
          const bed = new THREE.Mesh(
            new THREE.BoxGeometry(1.6, 0.45, 2.0),
            pbrMaterial(0xe5dfd5, fOpacity, 0.85, 0.02),
          );
          bed.position.set(rx, ry + 0.225, rz);
          bed.castShadow = true;
          group.add(bed);
        } else if (rName.includes('living') || rName.includes('hall')) {
          const sofa = new THREE.Mesh(
            new THREE.BoxGeometry(2.1, 0.65, 0.85),
            pbrMaterial(0x8b6843, fOpacity, 0.8, 0.05),
          );
          sofa.position.set(rx, ry + 0.325, rz);
          sofa.castShadow = true;
          group.add(sofa);
        } else if (rName.includes('dining')) {
          const table = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 0.75, 0.95),
            pbrMaterial(palette.door, fOpacity, 0.5, 0.08),
          );
          table.position.set(rx, ry + 0.375, rz);
          table.castShadow = true;
          group.add(table);
        } else if (rName.includes('kitchen')) {
          const counter = new THREE.Mesh(
            new THREE.BoxGeometry(2.0, 0.85, 0.65),
            pbrMaterial(0x475569, fOpacity, 0.4, 0.2),
          );
          counter.position.set(rx, ry + 0.425, rz);
          counter.castShadow = true;
          group.add(counter);
        } else if (rName.includes('bath') || rName.includes('toilet') || rName.includes('wc')) {
          const fixture = new THREE.Mesh(
            new THREE.BoxGeometry(0.55, 0.42, 0.65),
            pbrMaterial(0xf8fafc, fOpacity, 0.25, 0.1),
          );
          fixture.position.set(rx, ry + 0.21, rz);
          group.add(fixture);
        } else if (rName.includes('balcony') || rName.includes('sitout')) {
          const rail = new THREE.Mesh(
            new THREE.BoxGeometry(1.8, 0.9, 0.05),
            glassMaterial(0.45 * fOpacity),
          );
          rail.position.set(rx, ry + 0.45, rz);
          group.add(rail);
        }
      }
    });

    if (layers.walls) {
      projection.walls.forEach(wall => {
        if (!shouldShowFloor(wall.floorId, activeFloorId, floorMode)) return;
        const dx = wall.endPoint.x - wall.startPoint.x;
        const dy = wall.endPoint.y - wall.startPoint.y;
        const angle = -Math.atan2(dy, dx);
        const ux = dx / Math.max(wall.length, 1);
        const uy = dy / Math.max(wall.length, 1);
        const opacity = floorContextOpacity(projection, wall.floorId, activeFloorId, floorMode, linkedSpanStoreys);
        const sourceSelected = selected(wall, selection);
        wall.solidSegments.forEach((segment, segmentIndex) => {
          const segmentHeight = (segment.top - segment.bottom) * MM_TO_M;
          const wallY =
            (wall.elevation + segment.bottom) * MM_TO_M +
            floorOffset(projection, wall.floorId, isExploded, explodeDistance);
          const wallMat = pbrMaterial(
            sourceSelected ? 0x38bdf8 : palette.wall,
            opacity,
            palette.wallRoughness,
            0.05,
            !sourceSelected && !xray,
          );
          if (!sourceSelected && !xray) {
            wallMat.normalMap = runtime.stoneNormal;
            wallMat.normalScale.set(.45, .45);
          }
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
            const mesh = new THREE.Mesh(arcGeo, wallMat);
            mesh.position.y = wallY;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData = { ...wall, segmentIndex };
            addEdges(mesh, sourceSelected ? 0x0284c7 : 0xb3a592, 0.25);
            group.add(mesh);
            return;
          }
          const segmentLength = (segment.alongEnd - segment.alongStart) * MM_TO_M;
          const alongMid = (segment.alongStart + segment.alongEnd) / 2;
          const geometry = new THREE.BoxGeometry(segmentLength, segmentHeight, wall.thickness * MM_TO_M);
          const mesh = new THREE.Mesh(geometry, wallMat);
          mesh.position.set(
            (wall.startPoint.x + ux * alongMid) * MM_TO_M,
            wallY + segmentHeight / 2,
            (wall.startPoint.y + uy * alongMid) * MM_TO_M,
          );
          mesh.rotation.y = angle;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData = { ...wall, segmentIndex };
          addEdges(mesh, sourceSelected ? 0x0284c7 : 0xb3a592, 0.25);
          group.add(mesh);
        });
      });
    }

    if (layers.openings) {
      projection.openings.forEach(opening => {
        if (opening.doorType === DoorType.OpenPassage) return;
        if (!shouldShowFloor(opening.floorId, activeFloorId, floorMode)) return;
        const wall = projection.walls.find(candidate => candidate.sourceEntityId === opening.hostWallId);
        if (!wall) return;
        const dx = wall.endPoint.x - wall.startPoint.x;
        const dy = wall.endPoint.y - wall.startPoint.y;
        const angle = -Math.atan2(dy, dx);
        const opacity = floorContextOpacity(projection, opening.floorId, activeFloorId, floorMode, linkedSpanStoreys);
        const geometry = new THREE.BoxGeometry(
          opening.width * MM_TO_M,
          opening.height * MM_TO_M,
          Math.max(0.04, wall.thickness * MM_TO_M * 0.3),
        );
        const isWin = opening.sourceEntityType === 'window';
        const mat = selected(opening, selection)
          ? pbrMaterial(0xf59e0b, opacity, 0.3, 0.4)
          : isWin
            ? glassMaterial(0.58 * opacity)
            : pbrMaterial(palette.door, opacity, 0.48, 0.08);
        const mesh = new THREE.Mesh(geometry, mat);
        const centerAlong = opening.alongWall + opening.width / 2;
        mesh.position.set(
          (wall.startPoint.x + (dx / wall.length) * centerAlong) * MM_TO_M,
          (opening.elevation + opening.bottom + opening.height / 2) * MM_TO_M +
          floorOffset(projection, opening.floorId, isExploded, explodeDistance),
          (wall.startPoint.y + (dy / wall.length) * centerAlong) * MM_TO_M,
        );
        mesh.rotation.y = angle;
        if (!isWin) mesh.castShadow = true;
        addSelectable(mesh, opening);

        // Brushed bronze window mullions + Warm 2700K emissive interior glow behind glazing
        if (isWin && !xray) {
          const winW = opening.width * MM_TO_M;
          const winH = opening.height * MM_TO_M;
          const frameDepth = Math.max(0.055, wall.thickness * MM_TO_M * 0.46);
          const mullionMat = bronzeMullionMaterial(opacity);
          const topBar = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.04, 0.045, frameDepth), mullionMat);
          topBar.position.set(0, winH / 2, 0);
          const botBar = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.04, 0.045, frameDepth), mullionMat);
          botBar.position.set(0, -winH / 2, 0);
          const leftBar = new THREE.Mesh(new THREE.BoxGeometry(0.045, winH, frameDepth), mullionMat);
          leftBar.position.set(-winW / 2, 0, 0);
          const rightBar = new THREE.Mesh(new THREE.BoxGeometry(0.045, winH, frameDepth), mullionMat);
          rightBar.position.set(winW / 2, 0, 0);
          const midBar = new THREE.Mesh(new THREE.BoxGeometry(0.032, winH, frameDepth * 0.85), mullionMat);
          mesh.add(topBar, botBar, leftBar, rightBar, midBar);

          // Subtle recessed 2700K interior warm architectural glow plane
          const glowPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(Math.max(0.2, winW - 0.08), Math.max(0.2, winH - 0.08)),
            warmInteriorGlowMaterial(opacity * 0.62),
          );
          glowPlane.position.set(0, 0, -frameDepth * 0.42);
          glowPlane.userData = { emissiveRole: 'warm2700k' };
          mesh.add(glowPlane);
        }

        // 600 mm concrete window chajja (sunshade) projection
        // 600 mm concrete window chajja (sunshade) projection (flat or curved arc)
        if (isWin && opening.width >= 600) {
          const chajjaGeo = new THREE.BoxGeometry(opening.width * MM_TO_M + 0.14, 0.075, 0.6);
          const chajjaMesh = new THREE.Mesh(chajjaGeo, pbrMaterial(palette.slab, opacity, 0.72, 0.05));
          const nx = -Math.sin(angle);
          const nz = Math.cos(angle);
          chajjaMesh.position.set(
            mesh.position.x + nx * 0.3,
            (opening.elevation + opening.bottom + opening.height) * MM_TO_M +
            0.04 +
            floorOffset(projection, opening.floorId, isExploded, explodeDistance),
            mesh.position.z + nz * 0.3,
          );
          chajjaMesh.rotation.y = angle;
          chajjaMesh.castShadow = true;
          group.add(chajjaMesh);
          if (wall.arc && wall.arc.radiusMm > 0 && wall.length > 0) {
            const arc = wall.arc;
            const dAng = arc.endAngleRad - arc.startAngleRad;
            const padAlong = 150;
            const t0 = Math.max(-0.05, (opening.alongWall - padAlong) / wall.length);
            const t1 = Math.min(1.05, (opening.alongWall + opening.width + padAlong) / wall.length);
            const a0 = arc.startAngleRad + dAng * t0;
            const a1 = arc.startAngleRad + dAng * t1;
            const midA = (a0 + a1) / 2;
            const rIn = arc.radiusMm + wall.thickness / 2;
            const rOut = rIn + 600;
            const outP: Point[] = [];
            const inP: Point[] = [];
            for (let k = 0; k <= 6; k++) {
              const theta = a0 + ((a1 - a0) * k) / 6;
              outP.push({ x: arc.center.x + rOut * Math.cos(theta), y: arc.center.y + rOut * Math.sin(theta) });
              inP.unshift({ x: arc.center.x + rIn * Math.cos(theta), y: arc.center.y + rIn * Math.sin(theta) });
            }
            const chajjaGeo = new THREE.ExtrudeGeometry(makeShape({ points: [...outP, ...inP] }), {
              depth: 0.075,
              bevelEnabled: false,
            });
            chajjaGeo.rotateX(-Math.PI / 2);
            const chajjaMesh = new THREE.Mesh(chajjaGeo, pbrMaterial(palette.slab, opacity, 0.72, 0.05));
            chajjaMesh.position.y =
              (opening.elevation + opening.bottom + opening.height) * MM_TO_M +
              floorOffset(projection, opening.floorId, isExploded, explodeDistance);
            chajjaMesh.castShadow = true;
            group.add(chajjaMesh);
            void midA;
          } else {
            const chajjaGeo = new THREE.BoxGeometry(opening.width * MM_TO_M + 0.14, 0.075, 0.6);
            const chajjaMesh = new THREE.Mesh(chajjaGeo, pbrMaterial(palette.slab, opacity, 0.72, 0.05));
            const nx = -Math.sin(angle);
            const nz = Math.cos(angle);
            chajjaMesh.position.set(
              mesh.position.x + nx * 0.3,
              (opening.elevation + opening.bottom + opening.height) * MM_TO_M +
              0.04 +
              floorOffset(projection, opening.floorId, isExploded, explodeDistance),
              mesh.position.z + nz * 0.3,
            );
            chajjaMesh.rotation.y = angle;
            chajjaMesh.castShadow = true;
            group.add(chajjaMesh);
          }
        }
      });
    }

    // Track real canonical stair centroids on linked storeys when Duplex / Triplex visual linkage is active
    const linkedStairPoints: Array<{ floorLevel: number; x: number; y: number; z: number }> = [];

    (projection.architecturalSolids ?? []).forEach(part => {
      if ((part.sourceEntityType === 'stair' && !layers.stairs) || !shouldShowFloor(part.floorId, activeFloorId, floorMode)) return;
      const geometry = new THREE.ExtrudeGeometry(makeShape(part.boundary), {
        depth: (part.top - part.bottom) * MM_TO_M,
        bevelEnabled: false,
      });
      geometry.rotateX(-Math.PI / 2);
      const inLinked = isFloorInLinkedSpan(projection, part.floorId, activeFloorId, linkedSpanStoreys);
      const stairColor = inLinked && part.sourceEntityType === 'stair' ? 0xd97706 : palette.stair;
      const opacity = floorContextOpacity(projection, part.floorId, activeFloorId, floorMode, linkedSpanStoreys);
      const mesh = new THREE.Mesh(geometry, pbrMaterial(stairColor, opacity, 0.55, 0.1));
      const yOffset = floorOffset(projection, part.floorId, isExploded, explodeDistance);
      mesh.position.y = part.bottom * MM_TO_M + yOffset;
      mesh.castShadow = true;
      addEdges(mesh, inLinked ? 0xb45309 : 0x786c5c, 0.35);
      addSelectable(mesh, part);

      if (inLinked && part.sourceEntityType === 'stair') {
        const c = polygonCenter2D(part.boundary.points);
        const lvlIdx = projection.levels.findIndex(l => l.floorId === part.floorId);
        linkedStairPoints.push({
          floorLevel: lvlIdx,
          x: c.x * MM_TO_M,
          y: part.top * MM_TO_M + yOffset,
          z: c.y * MM_TO_M,
        });
      }
    });

    if (layers.stairs) {
      projection.stairs
        .filter(s => !projection.architecturalSolids?.some(p => p.sourceEntityId === s.sourceEntityId))
        .forEach(stair => {
          if (!shouldShowFloor(stair.floorId, activeFloorId, floorMode)) return;
          const result = computeStairSolids(stair.canonicalStair, stair.verticalExtent);
          const inLinked = isFloorInLinkedSpan(projection, stair.floorId, activeFloorId, linkedSpanStoreys);
          const opacity = floorContextOpacity(projection, stair.floorId, activeFloorId, floorMode, linkedSpanStoreys);
          const yOffset = floorOffset(projection, stair.floorId, isExploded, explodeDistance);
          result.solids.forEach(part => {
            const geometry = new THREE.ExtrudeGeometry(makeShape(part.boundary), {
              depth: (part.top - part.bottom) * MM_TO_M,
              bevelEnabled: false,
            });
            geometry.rotateX(-Math.PI / 2);
            const color = selected(stair, selection)
              ? 0xf59e0b
              : inLinked
                ? 0xd97706
                : palette.stair;
            const mesh = new THREE.Mesh(geometry, pbrMaterial(color, opacity, 0.55, 0.1));
            mesh.position.y = (stair.elevation + part.bottom) * MM_TO_M + yOffset;
            mesh.castShadow = true;
            addEdges(mesh, inLinked ? 0xb45309 : 0x786c5c, 0.35);
            addSelectable(mesh, stair);
          });
          if (inLinked && result.solids[0]) {
            const c = polygonCenter2D(result.solids[0].boundary.points);
            const lvlIdx = projection.levels.findIndex(l => l.floorId === stair.floorId);
            linkedStairPoints.push({
              floorLevel: lvlIdx,
              x: c.x * MM_TO_M,
              y: (stair.elevation + (result.solids[0].top ?? 1500)) * MM_TO_M + yOffset,
              z: c.y * MM_TO_M,
            });
          }
        });
    }

    // Visual vertical guide connecting actual canonical stairs on consecutive Duplex/Triplex storeys
    if (linkedSpanStoreys > 1 && linkedStairPoints.length >= 2) {
      const sorted = [...linkedStairPoints].sort((a, b) => a.floorLevel - b.floorLevel);
      const pts = sorted.map(p => new THREE.Vector3(p.x, p.y, p.z));
      const linkLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineDashedMaterial({ color: 0xd97706, dashSize: 0.25, gapSize: 0.14 }),
      );
      linkLine.computeLineDistances();
      group.add(linkLine);
    }

    scene.add(group);
    renderer.render(scene, camera);
  }, [
    activeFloorId,
    exploded,
    explodeDistance,
    isExploded,
    floorMode,
    layers,
    linkedSpanStoreys,
    materialPalette,
    projection,
    selection,
    viewMode,
  ]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const outline = projection.floorPlates.find(plate => plate.floorId === activeFloorId)?.boundary ?? projection.site.plotBoundary;
    const depths = outline.points.map(point => point.y * MM_TO_M);
    runtime.renderer.clippingPlanes = sectionCut && depths.length
      ? [new THREE.Plane(new THREE.Vector3(0, 0, -1), (Math.min(...depths) + Math.max(...depths)) / 2)]
      : [];
    runtime.renderer.domElement.dataset.section = sectionCut ? 'on' : 'off';
    runtime.renderer.render(runtime.scene, runtime.camera);
  }, [sectionCut, projection, activeFloorId]);

  // Camera Fit & Presets OR Eye-Level Walkthrough Entry
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    runtime.camera = parallelProjection && !walkthroughActive ? runtime.orthographic : runtime.perspective;
    runtime.controls.object = runtime.camera;
    runtime.renderer.domElement.dataset.projection = runtime.camera === runtime.orthographic ? 'orthographic' : 'perspective';
    if (walkthroughActive) {
      const level = projection.levels.find(l => l.floorId === activeFloorId) ?? projection.levels[0];
      const floorRooms = projection.rooms.filter(r => r.floorId === (level?.floorId ?? activeFloorId));
      const primaryRoom = floorRooms.find(r => /living|drawing|hall/i.test(r.sourceEntityId)) ?? floorRooms[0];
      const plate = projection.floorPlates.find(p => p.floorId === (level?.floorId ?? activeFloorId)) ?? projection.floorPlates[0];
      const targetPoly = primaryRoom?.boundary.points ?? plate?.boundary.points ?? [{ x: 4000, y: 4000 }];
      const c = polygonCenter2D(targetPoly);
      const elevM = ((level?.elevation ?? 0) * MM_TO_M) + floorOffset(projection, level?.floorId, isExploded, explodeDistance);
      const eyeY = elevM + 1.65;
      runtime.walkYaw = 0;
      runtime.camera.position.set(c.x * MM_TO_M, eyeY, c.y * MM_TO_M + 1.8);
      runtime.controls.target.set(c.x * MM_TO_M, eyeY - 0.08, c.y * MM_TO_M - 1.2);
      runtime.camera.far = 300;
      runtime.camera.updateProjectionMatrix();
      runtime.controls.update();
      runtime.renderer.render(runtime.scene, runtime.camera);
      return;
    }

    const group = runtime.scene.getObjectByName('building-projection');
    if (!group) return;
    const box = getModelBounds(group, fitSite);
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
      isometric: center.clone().addScaledVector(new THREE.Vector3(1, 0.8, 1).normalize(), distance),
      front: center.clone().addScaledVector(front, distance).add(elevationOffset),
      back: center.clone().addScaledVector(front, -distance).add(elevationOffset),
      left: center.clone().addScaledVector(right, -distance).add(elevationOffset),
      right: center.clone().addScaledVector(right, distance).add(elevationOffset),
      top: new THREE.Vector3(center.x, center.y + distance, center.z + 0.001),
    };
    runtime.camera.position.copy(positions[cameraPreset]);
    runtime.camera.far = Math.max(500, distance * 10);
    runtime.camera.updateProjectionMatrix();
    runtime.controls.maxDistance = Math.max(2000, distance * 5);
    runtime.controls.minZoom = 0.25;
    runtime.controls.maxZoom = 12;
    runtime.controls.target.copy(center);
    runtime.controls.update();
    runtime.renderer.render(runtime.scene, runtime.camera);
  }, [cameraPreset, fitRequest, projection, activeFloorId, floorMode, fitSite, walkthroughActive, parallelProjection]);

  // Explicit Zoom In / Zoom Out toolbar command handler
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !zoomCommand || zoomCommand.seq === 0) return;
    const factor = zoomCommand.dir === 'in' ? 0.8 : 1.25;
    if (runtime.camera === runtime.orthographic) {
      runtime.orthographic.zoom = THREE.MathUtils.clamp(runtime.orthographic.zoom / factor, 0.25, 12);
      runtime.orthographic.updateProjectionMatrix();
      runtime.renderer.render(runtime.scene, runtime.camera);
      return;
    }
    const dir = runtime.camera.position.clone().sub(runtime.controls.target);
    dir.multiplyScalar(factor);
    if (dir.length() >= 0.4 && dir.length() <= 1800) {
      runtime.camera.position.copy(runtime.controls.target).add(dir);
      runtime.controls.update();
      runtime.renderer.render(runtime.scene, runtime.camera);
    }
  }, [zoomCommand]);

  // Walkthrough Keyboard + On-Screen Move Controls
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
      runtime.renderer.render(runtime.scene, runtime.camera);
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
    runtime.renderer.render(runtime.scene, runtime.camera);
  }, [walkthroughActive, walkCommand]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !snapshotRequest) return;
    runtime.renderer.render(runtime.scene, runtime.camera);
    const link = document.createElement('a');
    link.download = 'architectural-model-view.png';
    link.href = runtime.renderer.domElement.toDataURL('image/png');
    link.click();
  }, [snapshotRequest]);

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
    const hit = raycaster
      .intersectObjects(runtime.scene.getObjectByName('building-projection')?.children ?? [], true)
      .find(result => {
        const data = (result.object as SelectableObject).userData;
        return Boolean(data.sourceEntityId && data.sourceEntityType) &&
          runtime.renderer.clippingPlanes.every(plane => plane.distanceToPoint(result.point) >= 0);
      });
    if (!hit) {
      onClearSelection();
      return;
    }
    const sourceData = (hit.object as SelectableObject).userData;
    // When clicking on a floor slab while Rooms overlay is hidden, resolve exact room via 2D point-in-polygon
    if (sourceData.sourceEntityType === 'floor' && sourceData.floorId) {
      const worldMm: Point = { x: hit.point.x / MM_TO_M, y: hit.point.z / MM_TO_M };
      const matchedRoom = projection.rooms.find(
        r => r.floorId === sourceData.floorId && pointInPolygon2D(worldMm, r.boundary.points),
      );
      if (matchedRoom) {
        onSelect(matchedRoom);
        return;
      }
    }
    onSelect(sourceData);
  };

  return (
    <div
      ref={hostRef}
      className="three-building-scene"
      onPointerDown={event => {
        pointerStart.current = event.button === 0 && event.isPrimary ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null;
      }}
      onPointerMove={event => {
        if (pointerStart.current && !isModelClick(pointerStart.current, event.clientX, event.clientY, event.pointerId))
          pointerStart.current = null;
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

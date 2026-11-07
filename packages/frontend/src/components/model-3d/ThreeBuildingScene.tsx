import React, { useEffect, useRef, useState } from 'react';
import { getModelBounds, isModelClick, modelFitDistance } from '../../services/model-camera';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { EditorSelection, Polygon } from '@ai-floor-planner/core';
import { DoorType } from '@ai-floor-planner/core';
import { computeStairSolids } from '@ai-floor-planner/geometry-engine';
import { makeProjectionShape as makeShape } from './projection-shape';
import { millimetersToSceneUnits, type Building3DProjection, type ProjectionSource } from '@ai-floor-planner/projection-3d';
import { shouldRenderRoomProjection, type ModelCameraPreset, type ModelFloorMode, type ModelLayerVisibility, type ModelViewMode } from '../../services/projection-preferences';

const MM_TO_M = millimetersToSceneUnits(1);
const EXPLODED_GAP_M = 1.8;

interface ThreeBuildingSceneProps {
  readonly projection: Building3DProjection;
  readonly activeFloorId: string;
  readonly selection: EditorSelection | null;
  readonly viewMode: ModelViewMode;
  readonly cameraPreset: ModelCameraPreset;
  readonly floorMode: ModelFloorMode;
  readonly exploded: boolean;
  readonly layers: ModelLayerVisibility;
  readonly fitRequest: number;
  readonly fitSite?: boolean;
  readonly snapshotRequest?: number;
  readonly onSelect: (source: ProjectionSource) => void;
  readonly onClearSelection: () => void;
}

type SelectableObject = THREE.Object3D & { userData: ProjectionSource };

function floorOffset(projection: Building3DProjection, floorId: string | undefined, exploded: boolean): number {
  if (!exploded || !floorId) return 0;
  const index = projection.levels.findIndex(level => level.floorId === floorId);
  return Math.max(0, index) * EXPLODED_GAP_M;
}

function shouldShowFloor(floorId: string | undefined, activeFloorId: string, mode: ModelFloorMode): boolean {
  return mode !== 'isolate' || !floorId || floorId === activeFloorId;
}

function floorContextOpacity(floorId: string | undefined, activeFloorId: string, mode: ModelFloorMode): number {
  return mode === 'active' && floorId && floorId !== activeFloorId ? 0.13 : 1;
}

function addEdges(mesh: THREE.Mesh, color = 0x64748b): void {
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.42 }));
  mesh.add(edges);
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse(child => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach(value => value.dispose()); else material?.dispose();
  });
}

function selected(source: ProjectionSource, selection: EditorSelection | null): boolean {
  return Boolean(selection && source.sourceEntityId === selection.entityId && source.floorId === selection.floorId);
}

export const ThreeBuildingScene: React.FC<ThreeBuildingSceneProps> = ({
  projection,
  activeFloorId,
  selection,
  viewMode,
  cameraPreset,
  floorMode,
  exploded,
  layers,
  fitRequest,
  fitSite = false,
  snapshotRequest = 0,
  onSelect,
  onClearSelection,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const pointerStart = useRef<{ x: number; y: number; id: number } | null>(null);
  const [renderError, setRenderError] = useState('');
  const runtimeRef = useRef<{ camera: THREE.PerspectiveCamera; controls: OrbitControls; renderer: THREE.WebGLRenderer; scene: THREE.Scene } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1120);
    const camera = new THREE.PerspectiveCamera(38, Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight), 0.05, 500);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      setRenderError('3D could not start. Enable browser hardware acceleration and reload. Your 2D project is unchanged; Blender export is still available.');
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute('aria-label', 'Interactive canonical 3D building model');
    host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.3;
    controls.maxDistance = 2000;
    controls.target.set(5, 2, 5);
    scene.add(new THREE.HemisphereLight(0xddeeff, 0x182235, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
    keyLight.position.set(-12, 22, -8);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const grid = new THREE.GridHelper(60, 60, 0x36506d, 0x17263a);
    grid.position.y = -0.02;
    scene.add(grid);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    const resize = new ResizeObserver(() => {
      if (!host.clientWidth || !host.clientHeight) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
      render();
    });
    resize.observe(host);
    runtimeRef.current = { camera, controls, renderer, scene };
    render();
    return () => {
      resize.disconnect();
      controls.removeEventListener('change', render);
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const { camera, renderer, scene } = runtime;
    const previous = scene.getObjectByName('building-projection');
    if (previous) { scene.remove(previous); disposeObject(previous); }
    const group = new THREE.Group();
    group.name = 'building-projection';
    const xray = viewMode === 'xray';

    const material = (color: number, opacity = 1) => new THREE.MeshStandardMaterial({ color, transparent: opacity < 1 || xray, opacity: xray ? Math.min(opacity, 0.34) : opacity, roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide, depthWrite: !xray });
    const addSelectable = (mesh: THREE.Mesh, source: ProjectionSource) => { mesh.userData = source; group.add(mesh); };

    if (layers.site) {
      const siteContext = new THREE.Group();
      siteContext.name = 'site-context';
      group.add(siteContext);
      const siteGeometry = new THREE.ShapeGeometry(makeShape(projection.site.plotBoundary));
      siteGeometry.rotateX(-Math.PI / 2);
      const site = new THREE.Mesh(siteGeometry, material(0x162a3f, 0.72));
      site.userData = projection.site;
      addEdges(site, 0x36a3d9);
      siteContext.add(site);
      if (projection.site.buildableEnvelope) {
        const points = projection.site.buildableEnvelope.points.map(point => new THREE.Vector3(point.x * MM_TO_M, 0.015, point.y * MM_TO_M));
        points.push(points[0]!.clone());
        const envelope = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: 0x2dd4bf, dashSize: 0.25, gapSize: 0.15 }));
        envelope.computeLineDistances();
        siteContext.add(envelope);
      }
      if (projection.site.roadWidth) {
        const xs = projection.site.plotBoundary.points.map(point => point.x);
        const ys = projection.site.plotBoundary.points.map(point => point.y);
        const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
        const width = projection.site.roadWidth;
        const roadPolygons = {
          north: { points: [{ x: minX, y: minY - width }, { x: maxX, y: minY - width }, { x: maxX, y: minY }, { x: minX, y: minY }] },
          south: { points: [{ x: minX, y: maxY }, { x: maxX, y: maxY }, { x: maxX, y: maxY + width }, { x: minX, y: maxY + width }] },
          east: { points: [{ x: maxX, y: minY }, { x: maxX + width, y: minY }, { x: maxX + width, y: maxY }, { x: maxX, y: maxY }] },
          west: { points: [{ x: minX - width, y: minY }, { x: minX, y: minY }, { x: minX, y: maxY }, { x: minX - width, y: maxY }] },
        } satisfies Record<string, Polygon>;
        const roadGeometry = new THREE.ShapeGeometry(makeShape(roadPolygons[projection.site.roadFacing]));
        roadGeometry.rotateX(-Math.PI / 2);
        const road = new THREE.Mesh(roadGeometry, material(0x243447, 0.78));
        road.position.y = -0.01;
        siteContext.add(road);
      }
    }

    if (layers.floorPlates) projection.floorPlates.forEach(plate => {
      if (!shouldShowFloor(plate.floorId, activeFloorId, floorMode)) return;
      const geometry = new THREE.ExtrudeGeometry(makeShape(plate.boundary, plate.cutouts), { depth: plate.thickness * MM_TO_M, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      const sourceSelected = selected(plate, selection);
      const mesh = new THREE.Mesh(geometry, material(sourceSelected ? 0x22d3ee : 0x94a3b8, 0.9 * floorContextOpacity(plate.floorId, activeFloorId, floorMode)));
      mesh.position.y = plate.elevation * MM_TO_M + floorOffset(projection, plate.floorId, exploded);
      mesh.receiveShadow = true;
      addEdges(mesh);
      addSelectable(mesh, plate);
    });

    projection.rooms.forEach(room => {
      if (!shouldRenderRoomProjection(room.sourceEntityId, layers.rooms, viewMode, selection)) return;
      if (!shouldShowFloor(room.floorId, activeFloorId, floorMode)) return;
      const geometry = viewMode === 'rooms'
        ? new THREE.ExtrudeGeometry(makeShape(room.boundary, room.cutouts), { depth: room.height * MM_TO_M * 0.88, bevelEnabled: false })
        : new THREE.ShapeGeometry(makeShape(room.boundary, room.cutouts));
      geometry.rotateX(-Math.PI / 2);
      const roomSelected = selected(room, selection);
      const roomMaterial = roomSelected
        ? new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.68, side: THREE.DoubleSide, depthTest: false })
        : material(0x38bdf8, (viewMode === 'rooms' ? 0.16 : 0.46) * floorContextOpacity(room.floorId, activeFloorId, floorMode));
      const mesh = new THREE.Mesh(geometry, roomMaterial);
      mesh.position.y = room.elevation * MM_TO_M + 0.012 + floorOffset(projection, room.floorId, exploded);
      mesh.renderOrder = roomSelected ? 20 : 0;
      addSelectable(mesh, room);
    });

    if (layers.walls) projection.walls.forEach(wall => {
      if (!shouldShowFloor(wall.floorId, activeFloorId, floorMode)) return;
      const dx = wall.endPoint.x - wall.startPoint.x;
      const dy = wall.endPoint.y - wall.startPoint.y;
      const angle = -Math.atan2(dy, dx);
      const ux = dx / Math.max(wall.length, 1);
      const uy = dy / Math.max(wall.length, 1);
      wall.solidSegments.forEach((segment, segmentIndex) => {
        const segmentLength = (segment.alongEnd - segment.alongStart) * MM_TO_M;
        const segmentHeight = (segment.top - segment.bottom) * MM_TO_M;
        const alongMid = (segment.alongStart + segment.alongEnd) / 2;
        const geometry = new THREE.BoxGeometry(segmentLength, segmentHeight, wall.thickness * MM_TO_M);
        const mesh = new THREE.Mesh(geometry, material(selected(wall, selection) ? 0x22d3ee : 0xe2e8f0, 0.96 * floorContextOpacity(wall.floorId, activeFloorId, floorMode)));
        mesh.position.set((wall.startPoint.x + ux * alongMid) * MM_TO_M, (wall.elevation + segment.bottom) * MM_TO_M + segmentHeight / 2 + floorOffset(projection, wall.floorId, exploded), (wall.startPoint.y + uy * alongMid) * MM_TO_M);
        mesh.rotation.y = angle;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { ...wall, segmentIndex };
        addEdges(mesh, selected(wall, selection) ? 0x67e8f9 : 0x64748b);
        group.add(mesh);
      });
    });

    if (layers.openings) projection.openings.forEach(opening => {
      if (opening.doorType === DoorType.OpenPassage) return;
      if (!shouldShowFloor(opening.floorId, activeFloorId, floorMode)) return;
      const wall = projection.walls.find(candidate => candidate.sourceEntityId === opening.hostWallId);
      if (!wall) return;
      const dx = wall.endPoint.x - wall.startPoint.x;
      const dy = wall.endPoint.y - wall.startPoint.y;
      const angle = -Math.atan2(dy, dx);
      const geometry = new THREE.BoxGeometry(opening.width * MM_TO_M, opening.height * MM_TO_M, Math.max(0.035, wall.thickness * MM_TO_M * 0.25));
      const color = selected(opening, selection) ? 0xfacc15 : opening.sourceEntityType === 'window' ? 0x38bdf8 : 0x8b5e3c;
      const mesh = new THREE.Mesh(geometry, material(color, (opening.sourceEntityType === 'window' ? 0.48 : 0.86) * floorContextOpacity(opening.floorId, activeFloorId, floorMode)));
      const centerAlong = opening.alongWall + opening.width / 2;
      mesh.position.set((wall.startPoint.x + dx / wall.length * centerAlong) * MM_TO_M, (opening.elevation + opening.bottom + opening.height / 2) * MM_TO_M + floorOffset(projection, opening.floorId, exploded), (wall.startPoint.y + dy / wall.length * centerAlong) * MM_TO_M);
      mesh.rotation.y = angle;
      addSelectable(mesh, opening);
    });

    if (layers.stairs) projection.stairs.forEach(stair => {
      if (!shouldShowFloor(stair.floorId, activeFloorId, floorMode)) return;
      const result = computeStairSolids(stair.canonicalStair, stair.verticalExtent);
      result.solids.forEach(part => {
      const geometry = new THREE.ExtrudeGeometry(makeShape(part.boundary), { depth: (part.top - part.bottom) * MM_TO_M, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, material(selected(stair, selection) ? 0xfacc15 : 0xd4a373, floorContextOpacity(stair.floorId, activeFloorId, floorMode)));
      mesh.position.y = (stair.elevation + part.bottom) * MM_TO_M + floorOffset(projection, stair.floorId, exploded);
      addEdges(mesh);
      addSelectable(mesh, stair);
      });
    });

    scene.add(group);
    renderer.render(scene, camera);
  }, [activeFloorId, exploded, floorMode, layers, projection, selection, viewMode]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const group = runtime.scene.getObjectByName('building-projection');
    if (!group) return;
    const box = getModelBounds(group, fitSite);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const distance = modelFitDistance(box, runtime.camera.fov, runtime.camera.aspect);
    const roadOffsets = { north: 0, east: 90, south: 180, west: 270 } as const;
    const siteAngle = (projection.site.northDegrees + roadOffsets[projection.site.roadFacing]) * Math.PI / 180;
    const front = new THREE.Vector3(Math.sin(siteAngle), 0, -Math.cos(siteAngle));
    const right = new THREE.Vector3(-front.z, 0, front.x);
    const positions: Record<ModelCameraPreset, THREE.Vector3> = {
      isometric: center.clone().addScaledVector(new THREE.Vector3(1, 0.8, 1).normalize(), distance),
      front: center.clone().addScaledVector(front, distance).add(new THREE.Vector3(0, distance * 0.2, 0)),
      back: center.clone().addScaledVector(front, -distance).add(new THREE.Vector3(0, distance * 0.2, 0)),
      left: center.clone().addScaledVector(right, -distance).add(new THREE.Vector3(0, distance * 0.2, 0)),
      right: center.clone().addScaledVector(right, distance).add(new THREE.Vector3(0, distance * 0.2, 0)),
      top: new THREE.Vector3(center.x, center.y + distance, center.z + 0.001),
    };
    runtime.camera.position.copy(positions[cameraPreset]);
    runtime.camera.far = Math.max(500, distance * 10);
    runtime.camera.updateProjectionMatrix();
    runtime.controls.maxDistance = Math.max(2000, distance * 5);
    runtime.controls.target.copy(center);
    runtime.controls.update();
    runtime.renderer.render(runtime.scene, runtime.camera);
  }, [cameraPreset, fitRequest, projection, activeFloorId, floorMode, exploded, fitSite]);

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
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, runtime.camera);
    const hit = raycaster.intersectObjects(runtime.scene.getObjectByName('building-projection')?.children ?? [], true).find(result => {
      const data = (result.object as SelectableObject).userData;
      return Boolean(data.sourceEntityId && data.sourceEntityType);
    });
    if (!hit) { onClearSelection(); return; }
    onSelect((hit.object as SelectableObject).userData);
  };

  return <div ref={hostRef} className="three-building-scene"
    onPointerDown={event => { pointerStart.current = event.button === 0 && event.isPrimary ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null; }}
    onPointerMove={event => { if (pointerStart.current && !isModelClick(pointerStart.current, event.clientX, event.clientY, event.pointerId)) pointerStart.current = null; }}
    onPointerCancel={() => { pointerStart.current = null; }} onPointerUp={handlePointerUp}>
    {renderError && <div className="model-empty-state" role="alert">{renderError}</div>}
  </div>;
};

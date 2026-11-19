import { useEffect, useRef, useState } from 'react';
import { Focus, MoonStar, Sun } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Point, Polygon } from '@ai-floor-planner/core';
import { pointAlongSurveyEdge, type SurveyBoundaryResult, type SurveyEdge } from '@ai-floor-planner/geometry-engine';

type Lighting = 'daylight' | 'dusk';
type SiteDraft = { boundary: SurveyBoundaryResult; envelope?: Polygon; roadEdge: number | null };
type SiteProps = SiteDraft & { selected: number; onSelect: (index: number) => void; onShowPlan: () => void };

const sceneUnits = 8;
const surfaceY = .19;
const home = new THREE.Vector3(7.7, 6.5, 9.4);

const palette = {
  daySky: new THREE.Color('#203b3e'),
  duskSky: new THREE.Color('#10182c'),
  dayGround: new THREE.Color('#344b49'),
  duskGround: new THREE.Color('#222f42'),
  daySun: new THREE.Color('#fff2cc'),
  duskSun: new THREE.Color('#ffab63'),
  dayFill: new THREE.Color('#d0f1ef'),
  duskFill: new THREE.Color('#85a9ff'),
};

function sampleEdge(edge: SurveyEdge, tolerance: number) {
  if (!edge.arc) return [edge.start, edge.end];
  // Display tessellation uses a chord error of at most 0.05% of the plot's larger span.
  const maxAngle = 4 * Math.asin(Math.sqrt(Math.min(1, tolerance / (2 * edge.arc.radiusMm))));
  const count = Math.max(2, Math.ceil(Math.abs(edge.arc.sweepRad) / maxAngle));
  return Array.from({ length: count + 1 }, (_, index) => pointAlongSurveyEdge(edge, index / count));
}

function disposeObjects(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse(object => {
    if (object instanceof THREE.InstancedMesh) object.dispose();
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      geometries.add(object.geometry);
      const entries = Array.isArray(object.material) ? object.material : [object.material];
      entries.forEach(material => materials.add(material));
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}

function buildSite({ boundary, envelope, roadEdge }: SiteDraft) {
  const { bounds } = boundary.metrics!;
  const span = Math.max(bounds.width, bounds.height, 1);
  const factor = sceneUnits / span;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const at = (point: Point, height = surfaceY) => new THREE.Vector3(
    (point.x - centerX) * factor, height, (point.y - centerY) * factor,
  );
  const groundPaths = boundary.edges.map(edge => sampleEdge(edge, span * .0005).map(point => at(point)));
  const ring = groundPaths.flatMap(points => points.slice(0, -1));
  const shape = new THREE.Shape(ring.map(point => new THREE.Vector2(point.x, -point.z)));
  const model = new THREE.Group();
  const surface = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: surfaceY, bevelEnabled: false }), [
    new THREE.MeshStandardMaterial({ color: '#599084', roughness: .82, metalness: .04 }),
    new THREE.MeshStandardMaterial({ color: '#28544e', roughness: .88 }),
  ]);
  surface.rotation.x = -Math.PI / 2;
  surface.castShadow = true;
  surface.receiveShadow = true;
  model.add(surface);

  const edgeLine = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(ring.map(point => point.clone().setY(surfaceY + .012))),
    new THREE.LineBasicMaterial({ color: '#b9e1d4', transparent: true, opacity: .82 }),
  );
  model.add(edgeLine);

  const frontage = roadEdge === null ? undefined : groundPaths[roadEdge];
  if (frontage && frontage.length > 1) {
    const path = new THREE.CurvePath<THREE.Vector3>();
    const points = frontage.map(point => point.clone().setY(surfaceY + .032));
    for (let index = 1; index < points.length; index++) {
      path.add(new THREE.LineCurve3(points[index - 1]!, points[index]!));
    }
    model.add(new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(4, points.length - 1), .033, 6),
      new THREE.MeshStandardMaterial({ color: '#ffcd84', emissive: '#d97b27', emissiveIntensity: .7, roughness: .53 })));
  }

  if (envelope && envelope.points.length > 2) {
    const path = [...envelope.points, envelope.points[0]!].map(point => at(point, surfaceY + .03));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path),
      new THREE.LineDashedMaterial({ color: '#dcf6b2', dashSize: .13, gapSize: .09 }));
    line.computeLineDistances();
    model.add(line);
  }

  const markerGeometry = new THREE.SphereGeometry(.085, 10, 8);
  const markerMaterial = new THREE.MeshStandardMaterial({ color: '#d9f4e8', emissive: '#73ad9e', emissiveIntensity: .45 });
  const markers = boundary.points.map((point, index) => {
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.copy(at(point, surfaceY + .12));
    marker.userData.vertexIndex = index;
    model.add(marker);
    return marker;
  });
  const selection = new THREE.Mesh(new THREE.RingGeometry(.12, .166, 28), new THREE.MeshBasicMaterial({ color: '#ffce88' }));
  selection.rotation.x = -Math.PI / 2;
  selection.visible = false;
  model.add(selection);

  return { model, markers, selection };
}

interface PreviewRuntime {
  setSite: (draft: SiteDraft) => void;
  select: (index: number) => void;
  setLighting: (lighting: Lighting, heading: number) => void;
  resetCamera: () => void;
}

export default function SurveySitePreview({ boundary, envelope, roadEdge, selected, onSelect, onShowPlan }: SiteProps) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<PreviewRuntime>();
  const selectVertex = useRef(onSelect);
  selectVertex.current = onSelect;
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [lighting, setLighting] = useState<Lighting>('daylight');
  const [heading, setHeading] = useState(315);

  useEffect(() => {
    const viewport = host.current;
    if (!viewport) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    } catch {
      setStatus('unavailable');
      return;
    }
    const canvas = renderer.domElement;
    canvas.setAttribute('aria-label', 'Interactive survey site model');
    canvas.setAttribute('role', 'img');
    viewport.appendChild(canvas);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;

    const scene = new THREE.Scene();
    const sky = palette.daySky.clone();
    scene.background = sky;
    scene.fog = new THREE.Fog(palette.daySky, 14, 37);
    const camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
    camera.position.copy(home);
    const controls = new OrbitControls(camera, canvas);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    controls.enableDamping = !motion.matches;
    controls.dampingFactor = .12;
    controls.enablePan = false;
    controls.minDistance = 4.8;
    controls.maxDistance = 24;
    controls.minPolarAngle = .16;
    controls.maxPolarAngle = Math.PI / 2.12;
    controls.update();

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: palette.dayGround, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -.25;
    ground.receiveShadow = true;
    const grid = new THREE.GridHelper(68, 68, '#5c8584', '#5c8584');
    grid.position.y = -.245;
    grid.material.transparent = true;
    grid.material.opacity = .23;
    scene.add(ground, grid);

    const fill = new THREE.HemisphereLight(palette.dayFill, '#344a49', 1.75);
    const sun = new THREE.DirectionalLight(palette.daySun, 2.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    sun.shadow.camera.near = .5;
    sun.shadow.camera.far = 33;
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -.0003;
    sun.shadow.normalBias = .027;
    scene.add(fill, sun, sun.target);

    let site: ReturnType<typeof buildSite> | undefined;
    let frame = 0;
    let stopped = false;
    let ready = false;
    let previousTime = 0;
    let lightMix = 0;
    let lightGoal = 0;
    const targetSun = new THREE.Vector3(-9.2, 10, -9.2);
    sun.position.copy(targetSun);

    function invalidate() {
      if (!frame && !stopped) frame = requestAnimationFrame(render);
    }

    function render(time: number) {
      frame = 0;
      const approach = motion.matches ? 1 : 1 - Math.exp(-15 * Math.min(.09, (time - previousTime) / 1000 || .016));
      previousTime = time;
      if (Math.abs(lightMix - lightGoal) > .002 || sun.position.distanceTo(targetSun) > .015) {
        lightMix = THREE.MathUtils.lerp(lightMix, lightGoal, approach);
        sun.position.lerp(targetSun, approach);
        sky.copy(palette.daySky).lerp(palette.duskSky, lightMix);
        scene.fog!.color.copy(sky);
        ground.material.color.copy(palette.dayGround).lerp(palette.duskGround, lightMix);
        sun.color.copy(palette.daySun).lerp(palette.duskSun, lightMix);
        sun.intensity = THREE.MathUtils.lerp(2.8, 1.85, lightMix);
        fill.color.copy(palette.dayFill).lerp(palette.duskFill, lightMix);
        fill.intensity = THREE.MathUtils.lerp(1.75, .95, lightMix);
        renderer.shadowMap.needsUpdate = true;
        invalidate();
      }
      controls.update();
      renderer.render(scene, camera);
      if (!ready) {
        ready = true;
        setStatus('ready');
      }
    }

    runtime.current = {
      setSite(draft) {
        if (site) {
          scene.remove(site.model);
          disposeObjects(site.model);
        }
        site = buildSite(draft);
        scene.add(site.model);
        renderer.shadowMap.needsUpdate = true;
        invalidate();
      },
      select(index) {
        if (!site) return;
        const marker = site.markers[index];
        site.selection.visible = !!marker;
        if (marker) site.selection.position.copy(marker.position).setY(surfaceY + .042);
        invalidate();
      },
      setLighting(mode, degrees) {
        lightGoal = mode === 'dusk' ? 1 : 0;
        const sunHeading = THREE.MathUtils.degToRad(degrees);
        targetSun.set(Math.sin(sunHeading) * 13, mode === 'dusk' ? 3.9 : 10, -Math.cos(sunHeading) * 13);
        invalidate();
      },
      resetCamera() {
        controls.reset();
        invalidate();
      },
    };

    function resize() {
      const { clientWidth, clientHeight } = viewport!;
      if (!clientWidth || !clientHeight) return;
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      invalidate();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    resize();
    controls.addEventListener('change', invalidate);

    const raycaster = new THREE.Raycaster();
    let pointerStart: { x: number; y: number; id: number } | undefined;
    function start(event: PointerEvent) {
      if (event.isPrimary && event.button === 0) pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    }
    function move(event: PointerEvent) {
      if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) pointerStart = undefined;
    }
    function finish(event: PointerEvent) {
      const tap = pointerStart;
      pointerStart = undefined;
      if (!tap || tap.id !== event.pointerId || !site) return;
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(
        (event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2,
      ), camera);
      const hit = raycaster.intersectObjects(site.markers, false)[0];
      if (hit) selectVertex.current(hit.object.userData.vertexIndex as number);
    }
    function cancel() { pointerStart = undefined; }
    function contextLost() {
      stopped = true;
      cancelAnimationFrame(frame);
      runtime.current = undefined;
      setStatus('unavailable');
    }
    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('webglcontextlost', contextLost);

    return () => {
      stopped = true;
      runtime.current = undefined;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener('change', invalidate);
      controls.dispose();
      canvas.removeEventListener('pointerdown', start);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', finish);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('webglcontextlost', contextLost);
      sun.shadow.dispose();
      disposeObjects(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, []);

  useEffect(() => { runtime.current?.setSite({ boundary, envelope, roadEdge }); }, [boundary, envelope, roadEdge]);
  useEffect(() => { runtime.current?.select(selected); }, [boundary, envelope, roadEdge, selected]);
  useEffect(() => { runtime.current?.setLighting(lighting, heading); }, [lighting, heading]);

  return <section className="rh-survey-site" aria-label="3D site preview" data-testid="survey-site-preview"
      data-status={status} data-lighting={lighting}>
    <div ref={host} className="rh-survey-site-viewport" hidden={status === 'unavailable'} />
    {status === 'unavailable' ? <div className="rh-survey-site-placeholder" role="status">
      <span>3D rendering is unavailable on this device.</span>
      <button type="button" onClick={onShowPlan}>Return to plan</button>
    </div> : <>
      <div className="rh-survey-site-toolbar">
        <div className="rh-survey-view-switch" role="group" aria-label="Site lighting">
          <button type="button" aria-pressed={lighting === 'daylight'} onClick={() => setLighting('daylight')}><Sun size={15} /> Daylight</button>
          <button type="button" aria-pressed={lighting === 'dusk'} onClick={() => setLighting('dusk')}><MoonStar size={15} /> Dusk</button>
        </div>
        <button className="rh-survey-site-reset" type="button" title="Reset site camera" aria-label="Reset site camera"
          onClick={() => runtime.current?.resetCamera()}><Focus size={16} /></button>
      </div>
      <div className="rh-survey-site-footer">
        <label>Sun direction <input type="range" min="0" max="359" value={heading} aria-label="Sun direction"
          aria-valuetext={`${heading} degrees clockwise from north`}
          onChange={event => setHeading(Number(event.target.value))} /><output>{heading}°</output></label>
        <span>Drag to orbit</span>
      </div>
    </>}
  </section>;
}

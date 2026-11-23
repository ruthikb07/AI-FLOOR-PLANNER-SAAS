import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadMumbaiShowcase } from './mumbai-showcase';

export type ShowcaseLightingMode = 'day' | 'golden' | 'night';

interface ShowcaseSceneProps {
  progress: number;
  orbit: boolean;
  night?: boolean;
  lightingMode?: ShowcaseLightingMode;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
// 5 curated architectural camera presets:
// 0: Aerial Overview, 1: Arrival Court, 2: Podium & Street, 3: Facade & Chajjas, 4: Lobby Interior
const cameras = [
  [V(96, 134, 162), V(-12, 42, 2)],
  [V(29, 7.8, 76), V(-2, 16, 18)],
  [V(76, 26, 122), V(-10, 26, 8)],
  [V(46, 51, 45), V(8, 47.5, 4)],
  [V(14, 4.8, 44), V(0, 5.2, 24)],
] as const;
const positions = new THREE.CatmullRomCurve3(cameras.map(([position]) => position), false, 'centripetal');
const targets = new THREE.CatmullRomCurve3(cameras.map(([, target]) => target), false, 'centripetal');

function createSky(sunDirection: THREE.Vector3) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: {
      sunset: { value: 0 },
      evening: { value: 0 },
      sunDirection: { value: sunDirection.clone().normalize() },
      daySky: { value: new THREE.Color('#6694BE') },
      dayHorizon: { value: new THREE.Color('#C9D8E2') },
      sunsetSky: { value: new THREE.Color('#182238') },
      sunsetHorizon: { value: new THREE.Color('#D47D3B') },
      eveningSky: { value: new THREE.Color('#060A13') },
      eveningHorizon: { value: new THREE.Color('#1A2338') },
    },
    vertexShader: `
      varying vec3 worldPoint;
      void main() {
        worldPoint = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float sunset, evening;
      uniform vec3 sunDirection, daySky, dayHorizon, sunsetSky, sunsetHorizon, eveningSky, eveningHorizon;
      varying vec3 worldPoint;
      float grain(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 a = floor(p), t = fract(p);
        t = t * t * (3.0 - 2.0 * t);
        return mix(mix(grain(a), grain(a + vec2(1.0, 0.0)), t.x),
                   mix(grain(a + vec2(0.0, 1.0)), grain(a + 1.0), t.x), t.y);
      }
      void main() {
        vec3 direction = normalize(worldPoint - cameraPosition);
        float skyHeight = smoothstep(-0.06, 0.48, direction.y);
        vec3 dayCol = mix(dayHorizon, daySky, skyHeight);
        vec3 setCol = mix(sunsetHorizon, sunsetSky, pow(skyHeight, 0.72));
        vec3 eveCol = mix(eveningHorizon, eveningSky, skyHeight);
        vec3 sky = mix(dayCol, setCol, sunset);
        sky = mix(sky, eveCol, evening);
        float facingSun = max(0.0, dot(direction, sunDirection));
        float haze = pow(facingSun, 10.0) * mix(0.18, 0.42, sunset) * (1.0 - evening * 0.8);
        vec2 cloudUv = direction.xz / max(0.24, direction.y + 0.27) * vec2(3.8, 7.1);
        float clouds = noise(cloudUv) * 0.62 + noise(cloudUv * 2.1) * 0.26 + noise(cloudUv * 4.3) * 0.12;
        float cloudAlpha = smoothstep(0.55, 0.78, clouds) * smoothstep(-0.02, 0.22, direction.y);
        sky += mix(vec3(0.88, 0.65, 0.42), vec3(1.0, 0.56, 0.22), sunset) * haze;
        vec3 cloudCol = mix(mix(vec3(0.72, 0.76, 0.80), vec3(0.95, 0.62, 0.36), sunset), vec3(0.09, 0.12, 0.19), evening);
        sky = mix(sky, cloudCol, cloudAlpha * 0.36);
        gl_FragColor = vec4(sky, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(390, 24, 16), material);
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  return sky;
}

export default function ResidenceShowcase({ progress, orbit, night = false, lightingMode }: ShowcaseSceneProps) {
  const effectiveLighting: ShowcaseLightingMode = lightingMode ?? (night ? 'night' : 'day');
  const hostRef = useRef<HTMLDivElement>(null);
  const requestRender = useRef<() => void>();
  const input = useRef({ progress, orbit, lightingMode: effectiveLighting });
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  useEffect(() => {
    input.current = { progress, orbit, lightingMode: effectiveLighting };
    requestRender.current?.();
  }, [progress, orbit, effectiveLighting]);

  useEffect(() => {
    if (!hostRef.current) return;
    const host: HTMLDivElement = hostRef.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      setStatus('unavailable');
      return;
    }
    const scene = new THREE.Scene();
    const dayFog = new THREE.Color('#C8D7E0');
    const sunsetFog = new THREE.Color('#2B2635');
    const eveningFog = new THREE.Color('#090E1A');
    const fog = new THREE.FogExp2(dayFog, 0.00265);
    const background = dayFog.clone();
    scene.fog = fog;
    scene.background = background;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.45, 570);
    host.appendChild(renderer.domElement);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const gl = renderer.getContext();
    const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const adapter = rendererInfo ? String(gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)) : '';
    host.dataset.gpu = adapter || String(gl.getParameter(gl.RENDERER));
    const softwareRendering = /swiftshader|llvmpipe|software/i.test(adapter);
    const compact = innerWidth < 760;
    renderer.setPixelRatio(softwareRendering ? .66 : Math.min(devicePixelRatio, compact ? 1 : 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const hemi = new THREE.HemisphereLight('#dce9fa', '#918269', 1.55);
    const sun = new THREE.DirectionalLight('#ffe1b4', 3.2);
    sun.position.set(-52, 131, 122);
    sun.target.position.set(0, 35, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(softwareRendering ? 512 : compact ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -83, right: 83, top: 77, bottom: -72, near: 14, far: 275 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.normalBias = 0.085;
    sun.shadow.bias = -0.00017;
    sun.shadow.radius = 2.6;
    const edgeLight = new THREE.DirectionalLight('#c4dcf4', .56);
    edgeLight.position.set(26, 15, -18);
    const sky = createSky(sun.position);
    const daySun = new THREE.Color('#ffe7c9');
    const sunsetSun = new THREE.Color('#ff9d47');
    const eveningSun = new THREE.Color('#7ca3f0');
    const dayFill = new THREE.Color('#dce9fa');
    const sunsetFill = new THREE.Color('#ffcca0');
    const eveningFill = new THREE.Color('#273a62');
    scene.add(hemi, sun, sun.target, edgeLight, sky);

    // Warm 2700K arrival canopy spotlights
    const fixtures: THREE.SpotLight[] = [];
    for (const x of [-6.2, 0, 6.2]) {
      const fixture = new THREE.SpotLight('#ffb84d', 0, 22, Math.PI * .32, .58, 1.8);
      fixture.position.set(x, 5.4, 30.5);
      fixture.target.position.set(x, .12, 29.2);
      fixtures.push(fixture);
      scene.add(fixture, fixture.target);
    }

    // Reflective Arrival Water Court + Warm 2700K Pathway Bollards
    const arrivalAccents = new THREE.Group();
    arrivalAccents.name = 'arrival-water-and-bollards';
    const waterCourtMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#0c1e2e'),
      roughness: 0.05,
      metalness: 0.18,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      reflectivity: 0.95,
    });
    const waterCourt = new THREE.Mesh(new THREE.BoxGeometry(20, 0.08, 7.2), waterCourtMat);
    waterCourt.position.set(0, 0.06, 39.5);
    waterCourt.receiveShadow = true;
    const waterCurb = new THREE.Mesh(
      new THREE.BoxGeometry(20.6, 0.18, 7.8),
      new THREE.MeshStandardMaterial({ color: '#2b2d34', roughness: 0.55, metalness: 0.25 }),
    );
    waterCurb.position.set(0, 0.02, 39.5);
    waterCurb.receiveShadow = true;
    arrivalAccents.add(waterCurb, waterCourt);

    const bollardPostMat = new THREE.MeshStandardMaterial({ color: '#1b1e26', roughness: 0.42, metalness: 0.65 });
    const bollardLensMat = new THREE.MeshStandardMaterial({
      color: '#ffcf86',
      emissive: new THREE.Color('#ff9d2e'),
      emissiveIntensity: 0.2,
      roughness: 0.18,
      metalness: 0.05,
    });
    const bollardPositions: Array<[number, number]> = [
      [-11.4, 34.5], [-11.4, 39.5], [-11.4, 44.5],
      [11.4, 34.5], [11.4, 39.5], [11.4, 44.5],
    ];
    for (const [bx, bz] of bollardPositions) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.85, 10), bollardPostMat);
      post.position.set(bx, 0.425, bz);
      post.castShadow = true;
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.18, 10), bollardLensMat);
      lens.position.set(bx, 0.78, bz);
      arrivalAccents.add(post, lens);
    }
    scene.add(arrivalAccents);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !softwareRendering;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.zoomToCursor = true;
    controls.minDistance = 14;
    controls.maxDistance = 285;
    controls.maxPolarAngle = Math.PI * .49;
    controls.enabled = input.current.orbit;
    const textures: THREE.Texture[] = [];
    let disposed = false;
    let contextLost = false;
    let ready = false;
    let frame = 0;
    let renderedProgress = input.current.progress;
    let renderedSunset = input.current.lightingMode === 'golden' ? 1 : 0;
    let renderedNight = input.current.lightingMode === 'night' ? 1 : 0;
    let lastLightingKey = '';
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let environment: THREE.WebGLRenderTarget | undefined;
    let showcase: Awaited<ReturnType<typeof loadMumbaiShowcase>> | undefined;

    function schedule() {
      if (!frame && ready && !disposed && !contextLost) frame = requestAnimationFrame(render);
    }
    function applyTrack(value: number) {
      positions.getPoint(value, camera.position);
      targets.getPoint(value, controls.target);
      if (camera.aspect < 1) camera.position.lerp(controls.target, -(1 - camera.aspect) * .55);
      camera.lookAt(controls.target);
    }
    function applyLighting(sunsetAmt: number, nightAmt: number) {
      const key = `${sunsetAmt.toFixed(3)}:${nightAmt.toFixed(3)}`;
      if (key === lastLightingKey) return;
      lastLightingKey = key;
      const glowAmt = Math.min(1, sunsetAmt * 0.65 + nightAmt);
      hemi.color.copy(dayFill).lerp(sunsetFill, sunsetAmt).lerp(eveningFill, nightAmt);
      hemi.intensity = THREE.MathUtils.lerp(THREE.MathUtils.lerp(1.15, 0.92, sunsetAmt), 0.42, nightAmt);
      sun.intensity = THREE.MathUtils.lerp(THREE.MathUtils.lerp(3.2, 2.35, sunsetAmt), 0.46, nightAmt);
      sun.color.copy(daySun).lerp(sunsetSun, sunsetAmt).lerp(eveningSun, nightAmt);
      edgeLight.intensity = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.52, 0.42, sunsetAmt), 0.24, nightAmt);
      for (const material of showcase?.emissives ?? []) {
        const peak = material.name === 'Fixtures' ? 6.8 : 2.35;
        material.emissive.set('#ffb347');
        material.emissiveIntensity = THREE.MathUtils.lerp(0.05, peak, glowAmt);
      }
      bollardLensMat.emissiveIntensity = THREE.MathUtils.lerp(0.15, 4.2, glowAmt);
      scene.environmentIntensity = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.9, 0.56, sunsetAmt), 0.22, nightAmt);
      renderer.toneMappingExposure = THREE.MathUtils.lerp(THREE.MathUtils.lerp(1.08, 1.04, sunsetAmt), 1.02, nightAmt);
      fog.color.copy(dayFog).lerp(sunsetFog, sunsetAmt).lerp(eveningFog, nightAmt);
      background.copy(fog.color);
      sky.material.uniforms.sunset!.value = sunsetAmt;
      sky.material.uniforms.evening!.value = nightAmt;
      fixtures.forEach(light => { light.intensity = 155 * glowAmt; });
      host.dataset.lightProgress = nightAmt.toFixed(3);
      host.dataset.lightingMode = input.current.lightingMode;
    }
    function render() {
      frame = 0;
      if (!ready || disposed || contextLost) return;
      const { progress, orbit, lightingMode: targetMode } = input.current;
      const next = reducedMotion.matches || softwareRendering ? progress : THREE.MathUtils.lerp(renderedProgress, progress, .16);
      const settled = Math.abs(progress - next) < (softwareRendering ? .003 : .0008);
      renderedProgress = settled ? progress : next;
      const targetSunset = targetMode === 'golden' ? 1 : 0;
      const targetNight = targetMode === 'night' ? 1 : 0;
      const nextSunset = reducedMotion.matches || softwareRendering
        ? targetSunset
        : THREE.MathUtils.lerp(renderedSunset, targetSunset, .18);
      const nextNight = reducedMotion.matches || softwareRendering
        ? targetNight
        : THREE.MathUtils.lerp(renderedNight, targetNight, .18);
      const lightingSettled =
        Math.abs(targetSunset - nextSunset) < .004 && Math.abs(targetNight - nextNight) < .004;
      renderedSunset = lightingSettled ? targetSunset : nextSunset;
      renderedNight = lightingSettled ? targetNight : nextNight;
      applyLighting(renderedSunset, renderedNight);
      controls.enabled = orbit;
      if (!orbit) applyTrack(renderedProgress);
      if (orbit) controls.update();
      sky.position.copy(camera.position);
      renderer.render(scene, camera);
      host.dataset.progress = renderedProgress.toFixed(3);
      host.dataset.drawCalls = String(renderer.info.render.calls);
      host.dataset.triangles = String(renderer.info.render.triangles);
      if (!settled || !lightingSettled || (orbit && controls.enableDamping)) schedule();
    }
    function resize() {
      if (!host.clientHeight || !host.clientWidth) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
      schedule();
    }
    const loseContext = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      ready = false;
      cancelAnimationFrame(frame);
      frame = 0;
      setStatus('unavailable');
    };
    const restoreContext = () => {
      contextLost = false;
      if (showcase && textures.length === 4) {
        setStatus('loading');
        void warmUp().catch(() => { if (!disposed) setStatus('unavailable'); });
      }
    };
    controls.addEventListener('change', schedule);
    renderer.domElement.addEventListener('webglcontextlost', loseContext);
    renderer.domElement.addEventListener('webglcontextrestored', restoreContext);

    const source = `${import.meta.env.BASE_URL}architecture/`;
    let hdr: THREE.DataTexture | undefined;
    async function warmUp() {
      if (!hdr || disposed || contextLost) return;
      const pmrem = new THREE.PMREMGenerator(renderer);
      environment?.dispose();
      environment = pmrem.fromEquirectangular(hdr);
      pmrem.dispose();
      scene.environment = environment.texture;
      scene.environmentRotation.y = 2.6;
      for (const texture of textures.slice(0, 3)) renderer.initTexture(texture);
      applyLighting(renderedSunset, renderedNight);
      // Day and dusk share the same light and material topology. Dusk changes uniforms.
      await renderer.compileAsync(scene, camera);
      if (disposed || contextLost) return;
      applyTrack(input.current.progress);
      sky.position.copy(camera.position);
      renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera);
      ready = true;
      render();
      setStatus('ready');
    }

    async function load() {
      const loader = new THREE.TextureLoader();
      const [modelResult, hdrResult, ...maps] = await Promise.allSettled([
        loadMumbaiShowcase(),
        new HDRLoader().loadAsync(source + 'daylight.hdr'),
        ...['cast-stone.webp', 'cast-stone-normal.webp', 'cast-stone-roughness.webp']
          .map(name => loader.loadAsync(source + name)),
      ] as const);
      if (disposed) {
        if (modelResult.status === 'fulfilled') disposeMeshes(modelResult.value.model);
        if (hdrResult.status === 'fulfilled') hdrResult.value.dispose();
        for (const result of maps) if (result.status === 'fulfilled') result.value.dispose();
        return;
      }
      if (modelResult.status === 'fulfilled') {
        showcase = modelResult.value;
        scene.add(showcase.model);
        host.dataset.componentCount = String(showcase.componentCount);
        host.dataset.neighborhoodCount = String(showcase.neighborhoodCount);
      }
      for (const result of maps) if (result.status === 'fulfilled') textures.push(result.value);
      if (hdrResult.status === 'fulfilled') {
        hdr = hdrResult.value;
        textures.push(hdr);
      }
      if (!showcase || !hdr || textures.length !== 4) throw new Error('Required showcase asset unavailable');
      const [albedo, normal, roughness] = textures as [THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture];
      albedo.colorSpace = THREE.SRGBColorSpace;
      for (const texture of [albedo, normal, roughness]) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      }
      for (const stone of showcase.stone) {
        stone.map = albedo;
        stone.normalMap = normal;
        stone.normalScale.set(.43, .43);
        stone.roughnessMap = roughness;
        stone.roughness = .93;
      }
      await warmUp();
    }

    function disposeMeshes(root: THREE.Object3D) {
      const geometry = new Set<THREE.BufferGeometry>();
      const material = new Set<THREE.Material>();
      root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        geometry.add(object.geometry);
        for (const item of Array.isArray(object.material) ? object.material : [object.material]) material.add(item);
      });
      geometry.forEach(item => item.dispose());
      material.forEach(item => item.dispose());
    }

    requestRender.current = schedule;
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    applyTrack(renderedProgress);
    resize();
    void load().catch(error => {
      if (!disposed) {
        console.error('Welcome model failed to load', error);
        setStatus('unavailable');
      }
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      requestRender.current = undefined;
      controls.dispose();
      sun.shadow.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', loseContext);
      renderer.domElement.removeEventListener('webglcontextrestored', restoreContext);
      disposeMeshes(scene);
      environment?.dispose();
      textures.forEach(texture => texture.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="rh-residence-scene" data-testid="residence-showcase" data-status={status} aria-hidden="true" />;
}

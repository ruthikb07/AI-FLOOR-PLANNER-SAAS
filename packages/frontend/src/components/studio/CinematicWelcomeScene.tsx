import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';

export interface CinematicWelcomeSceneProps {
  lightingMode: 'day' | 'night';
  targetProgress: number;
  onWebGLUnavailable?: (reason: string) => void;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function phaseProgress(progress: number, start: number, end: number): number {
  if (end <= start) return progress >= end ? 1 : 0;
  return clamp01((progress - start) / (end - start));
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export const CinematicWelcomeScene: React.FC<CinematicWelcomeSceneProps> = ({
  lightingMode,
  targetProgress,
  onWebGLUnavailable,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const lightingRef = useRef<'day' | 'night'>(lightingMode);
  const progressRef = useRef(targetProgress);
  lightingRef.current = lightingMode;
  progressRef.current = targetProgress;

  const sceneRefs = useRef<{
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    hemi: THREE.HemisphereLight;
    sun: THREE.DirectionalLight;
    fill: THREE.DirectionalLight;
    windowMat: THREE.MeshStandardMaterial;
    glowLamps: THREE.PointLight[];
    renderOnce: () => void;
    scrubTo: (progress: number) => void;
  } | null>(null);

  useEffect(() => {
    sceneRefs.current?.scrubTo(targetProgress);
  }, [targetProgress]);

  // Sync lighting transitions smoothly
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    if (lightingMode === 'night') {
      refs.scene.background = new THREE.Color(0x171b1d);
      refs.scene.fog = new THREE.FogExp2(0x171b1d, 0.011);
      refs.hemi.color.setHex(0x3b4d7a);
      refs.hemi.groundColor.setHex(0x0f172a);
      refs.hemi.intensity = 1.05;
      refs.sun.color.setHex(0xa5b4fc);
      refs.sun.intensity = 1.15;
      refs.fill.color.setHex(0xfbbf24);
      refs.fill.intensity = 0.75;
      refs.windowMat.emissive.setHex(0xf59e0b);
      refs.windowMat.emissiveIntensity = 0.55;
      refs.glowLamps.forEach(l => { l.intensity = 1.4; });
    } else {
      refs.scene.background = new THREE.Color(0xe9e5dc);
      refs.scene.fog = new THREE.FogExp2(0xe9e5dc, 0.0075);
      refs.hemi.color.setHex(0xffffff);
      refs.hemi.groundColor.setHex(0xd6cbb8);
      refs.hemi.intensity = 1.45;
      refs.sun.color.setHex(0xfff8ec);
      refs.sun.intensity = 2.6;
      refs.fill.color.setHex(0xcbe2fa);
      refs.fill.intensity = 0.65;
      refs.windowMat.emissive.setHex(0x38bdf8);
      refs.windowMat.emissiveIntensity = 0.06;
      refs.glowLamps.forEach(l => { l.intensity = 0; });
    }
    refs.renderOnce();
  }, [lightingMode]);

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;

    const motion = matchMedia('(prefers-reduced-motion: reduce)');

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'default',
      });
    } catch (error) {
      onWebGLUnavailable?.(error instanceof Error ? error.message : 'WebGL initialization unavailable');
      return;
    }

    const width = Math.max(1, host.clientWidth || window.innerWidth);
    const height = Math.max(1, host.clientHeight || window.innerHeight);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(lightingRef.current === 'night' ? 0x171b1d : 0xe9e5dc);
    scene.fog = new THREE.FogExp2(lightingRef.current === 'night' ? 0x171b1d : 0xe9e5dc, 0.0075);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 220);
    camera.position.set(16, 12, 26);
    camera.lookAt(0, 5.5, 0);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 700 ? 1.25 : 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      onWebGLUnavailable?.('WebGL context lost');
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

    // Architectural Daylight Lighting
    const hemi = new THREE.HemisphereLight(0xffffff, 0xd6cbb8, lightingRef.current === 'night' ? 1.05 : 1.45);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff8ec, lightingRef.current === 'night' ? 1.15 : 2.6);
    sun.position.set(22, 32, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 90;
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0xcbe2fa, 0.65);
    fill.position.set(-18, 12, -16);
    scene.add(fill);

    // Architectural PBR Materials
    const lawnMat = new THREE.MeshStandardMaterial({ color: 0xb6c7a8, roughness: 0.92, metalness: 0.02 });
    const plazaMat = new THREE.MeshStandardMaterial({ color: 0xe9e1d3, roughness: 0.78, metalness: 0.04 });
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.85, metalness: 0.05 });
    const curbMat = new THREE.MeshStandardMaterial({ color: 0xcfc6b8, roughness: 0.75 });
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0xd9d2c7, roughness: 0.65, metalness: 0.08 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf7f2ea, roughness: 0.68, metalness: 0.04 });
    const coreMat = new THREE.MeshStandardMaterial({ color: 0xbdb5a8, roughness: 0.72, metalness: 0.06 });
    const champagneMat = new THREE.MeshStandardMaterial({ color: 0xc8a25a, roughness: 0.3, metalness: 0.82 });
    const mullionMat = new THREE.MeshStandardMaterial({ color: 0x3b332b, roughness: 0.38, metalness: 0.55 });
    const windowMat = new THREE.MeshStandardMaterial({
      color: 0x67b5e3,
      roughness: 0.1,
      metalness: 0.1,
      transparent: true,
      opacity: 0.66,
      emissive: new THREE.Color(lightingRef.current === 'night' ? 0xf59e0b : 0x38bdf8),
      emissiveIntensity: lightingRef.current === 'night' ? 0.55 : 0.06,
    });
    const solarMat = new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.25, metalness: 0.7 });
    const treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x688f5e, roughness: 0.82 });
    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x6d4c3d, roughness: 0.9 });

    const assemblyRoot = new THREE.Group();
    scene.add(assemblyRoot);

    // 1. SITE GROUP
    const siteGroup = new THREE.Group();
    const ground = new THREE.Mesh(new THREE.BoxGeometry(28, 0.3, 24), lawnMat);
    ground.position.y = -0.16;
    ground.receiveShadow = true;
    siteGroup.add(ground);

    const plaza = new THREE.Mesh(new THREE.BoxGeometry(15.5, 0.16, 13.5), plazaMat);
    plaza.position.y = -0.02;
    plaza.receiveShadow = true;
    siteGroup.add(plaza);

    const road = new THREE.Mesh(new THREE.BoxGeometry(28, 0.12, 4.2), roadMat);
    road.position.set(0, -0.06, 9.6);
    road.receiveShadow = true;
    siteGroup.add(road);

    for (let sx = -10; sx <= 10; sx += 4) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.02, 0.14), plazaMat);
      dash.position.set(sx, 0.01, 9.6);
      siteGroup.add(dash);
    }

    const curb = new THREE.Mesh(new THREE.BoxGeometry(16.2, 0.1, 14.2), curbMat);
    curb.position.y = -0.04;
    siteGroup.add(curb);
    assemblyRoot.add(siteGroup);

    const surveyGrid = new THREE.GridHelper(24, 24, 0x997951, 0xbbac93);
    surveyGrid.position.y = 0.075;
    assemblyRoot.add(surveyGrid);

    const planSegments = [
      [-5.3, -3.7, 5.3, -3.7], [5.3, -3.7, 5.3, 3.7],
      [5.3, 3.7, -5.3, 3.7], [-5.3, 3.7, -5.3, -3.7],
      [-1.4, -3.7, -1.4, 3.7], [1.4, -3.7, 1.4, 3.7],
      [-5.3, -.9, -1.4, -.9], [1.4, -.9, 5.3, -.9],
      [-1.4, -2.1, 1.4, -2.1], [-1.4, .5, 1.4, .5],
      [-5.3, 4.55, 5.3, 4.55], [-6.15, -3.7, -6.15, 3.7],
    ];
    const planGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(
      planSegments.flatMap(([x1, z1, x2, z2]) => [x1!, .12, z1!, x2!, .12, z2!]), 3,
    ));
    const planLines = new THREE.LineSegments(planGeometry, new THREE.LineBasicMaterial({ color: 0x795538 }));
    assemblyRoot.add(planLines);


    // 2. STILT GROUP
    const stiltGroup = new THREE.Group();
    const stiltHeight = 2.1;
    const wingW = 10.6;
    const wingD = 7.4;

    const lobbyBox = new THREE.Mesh(new THREE.BoxGeometry(3.4, stiltHeight, 3.6), coreMat);
    lobbyBox.position.set(0, stiltHeight / 2, -0.5);
    lobbyBox.castShadow = true;
    lobbyBox.receiveShadow = true;
    stiltGroup.add(lobbyBox);

    const portalArch = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.0, 0.25), champagneMat);
    portalArch.position.set(0, 1.0, wingD / 2 - 0.1);
    portalArch.castShadow = true;
    stiltGroup.add(portalArch);
    assemblyRoot.add(stiltGroup);

    // Building Vertical Dimensions
    const floorCount = 5;
    const floorH = 1.9;

    // 3. COLUMNS & SHEAR CORE GROUP
    const columnsGroup = new THREE.Group();
    const totalColH = stiltHeight + floorCount * floorH;
    const colXs = [-wingW / 2 + 0.35, -1.8, 1.8, wingW / 2 - 0.35];
    const colZs = [-wingD / 2 + 0.35, 0, wingD / 2 - 0.35];
    colXs.forEach((x) => {
      colZs.forEach((z) => {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.28, totalColH, 0.28), concreteMat);
        col.position.set(x, totalColH / 2, z);
        col.castShadow = true;
        col.receiveShadow = true;
        columnsGroup.add(col);
      });
    });
    const stairLiftCore = new THREE.Mesh(new THREE.BoxGeometry(2.8, totalColH + 0.4, 2.6), coreMat);
    stairLiftCore.position.set(0, (totalColH + 0.4) / 2, -0.8);
    stairLiftCore.castShadow = true;
    columnsGroup.add(stairLiftCore);
    assemblyRoot.add(columnsGroup);

    // Per-Floor Collections for Sequential Animation
    const slabMeshes: Array<{ mesh: THREE.Object3D; targetY: number }> = [];
    const wallMeshes: Array<{ mesh: THREE.Object3D; floorIdx: number }> = [];
    const glazingMeshes: Array<{ mesh: THREE.Object3D; floorIdx: number }> = [];
    const balconyMeshes: Array<{ mesh: THREE.Object3D; floorIdx: number }> = [];

    const floorsGroup = new THREE.Group();
    const wallsGroup = new THREE.Group();
    const glazingGroup = new THREE.Group();
    const balconiesGroup = new THREE.Group();

    for (let f = 0; f <= floorCount; f++) {
      const elevY = stiltHeight + f * floorH;

      // Slab plate (L-shaped notched architectural silhouette + terrace)
      const slabGroup = new THREE.Group();
      const slabMain = new THREE.Mesh(new THREE.BoxGeometry(wingW, 0.18, wingD), concreteMat);
      slabMain.castShadow = true;
      slabMain.receiveShadow = true;
      slabGroup.add(slabMain);

      const slabBand = new THREE.Mesh(new THREE.BoxGeometry(wingW + 0.08, 0.08, wingD + 0.08), champagneMat);
      slabBand.position.y = -0.05;
      slabGroup.add(slabBand);

      slabGroup.position.y = elevY;
      floorsGroup.add(slabGroup);
      slabMeshes.push({ mesh: slabGroup, targetY: elevY });

      if (f < floorCount) {
        // Exterior & wing walls (leaving recessed facade articulation)
        const floorWallGroup = new THREE.Group();
        floorWallGroup.position.y = elevY + floorH / 2;

        const westWingWall = new THREE.Mesh(new THREE.BoxGeometry(3.4, floorH - 0.2, wingD - 0.4), wallMat);
        westWingWall.position.set(-3.3, 0, 0);
        westWingWall.castShadow = true;
        westWingWall.receiveShadow = true;
        floorWallGroup.add(westWingWall);

        const eastWingWall = new THREE.Mesh(new THREE.BoxGeometry(3.4, floorH - 0.2, wingD - 0.4), wallMat);
        eastWingWall.position.set(3.3, 0, 0);
        eastWingWall.castShadow = true;
        eastWingWall.receiveShadow = true;
        floorWallGroup.add(eastWingWall);

        const northBridgeWall = new THREE.Mesh(new THREE.BoxGeometry(3.4, floorH - 0.2, 2.2), wallMat);
        northBridgeWall.position.set(0, 0, -2.0);
        northBridgeWall.castShadow = true;
        floorWallGroup.add(northBridgeWall);

        wallsGroup.add(floorWallGroup);
        wallMeshes.push({ mesh: floorWallGroup, floorIdx: f });

        // Glazing & champagne mullions
        const floorGlazeGroup = new THREE.Group();
        floorGlazeGroup.position.y = elevY + floorH / 2;

        [-3.3, 0, 3.3].forEach((gx) => {
          const glassPane = new THREE.Mesh(new THREE.BoxGeometry(2.5, floorH - 0.45, 0.08), windowMat);
          glassPane.position.set(gx, 0, wingD / 2 - 0.14);
          floorGlazeGroup.add(glassPane);

          const topFrame = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.08, 0.14), mullionMat);
          topFrame.position.set(gx, (floorH - 0.45) / 2, wingD / 2 - 0.14);
          floorGlazeGroup.add(topFrame);

          const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.06, floorH - 0.45, 0.12), champagneMat);
          mullion.position.set(gx, 0, wingD / 2 - 0.12);
          floorGlazeGroup.add(mullion);
        });

        // Side elevation vertical glass strips
        [-wingW / 2 + 0.15, wingW / 2 - 0.15].forEach((sx) => {
          const sideGlass = new THREE.Mesh(new THREE.BoxGeometry(0.08, floorH - 0.5, 4.4), windowMat);
          sideGlass.position.set(sx, 0, 0);
          floorGlazeGroup.add(sideGlass);
        });

        glazingGroup.add(floorGlazeGroup);
        glazingMeshes.push({ mesh: floorGlazeGroup, floorIdx: f });

        // Staggered Cantilevered Balconies & Chajjas (Odd vs Even offset!)
        const floorBalGroup = new THREE.Group();
        floorBalGroup.position.y = elevY;

        const balPositions = f % 2 === 0 ? [-3.3, 3.3] : [-1.8, 1.8];
        balPositions.forEach((bx) => {
          const deck = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.14, 1.25), concreteMat);
          deck.position.set(bx, 0, wingD / 2 + 0.62);
          deck.castShadow = true;
          deck.receiveShadow = true;
          floorBalGroup.add(deck);

          const railGlass = new THREE.Mesh(new THREE.BoxGeometry(2.74, 0.68, 0.05), windowMat);
          railGlass.position.set(bx, 0.4, wingD / 2 + 1.2);
          floorBalGroup.add(railGlass);

          const handrail = new THREE.Mesh(new THREE.BoxGeometry(2.82, 0.06, 0.09), champagneMat);
          handrail.position.set(bx, 0.76, wingD / 2 + 1.2);
          floorBalGroup.add(handrail);
        });

        // 600mm Window Chajjas above glazed openings
        [-3.3, 0, 3.3].forEach((cx) => {
          const chajja = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.08, 0.55), wallMat);
          chajja.position.set(cx, floorH - 0.22, wingD / 2 + 0.18);
          chajja.castShadow = true;
          floorBalGroup.add(chajja);
        });

        balconiesGroup.add(floorBalGroup);
        balconyMeshes.push({ mesh: floorBalGroup, floorIdx: f });
      }
    }

    assemblyRoot.add(floorsGroup);
    assemblyRoot.add(wallsGroup);
    assemblyRoot.add(glazingGroup);
    assemblyRoot.add(balconiesGroup);

    // 7. ROOF / TERRACE PENTHOUSE & SOLAR PV GROUP
    const roofGroup = new THREE.Group();
    const terraceY = stiltHeight + floorCount * floorH;
    const parapetH = 0.65;

    const parapetF = new THREE.Mesh(new THREE.BoxGeometry(wingW, parapetH, 0.16), wallMat);
    parapetF.position.set(0, terraceY + parapetH / 2, wingD / 2 - 0.08);
    roofGroup.add(parapetF);
    const parapetB = new THREE.Mesh(new THREE.BoxGeometry(wingW, parapetH, 0.16), wallMat);
    parapetB.position.set(0, terraceY + parapetH / 2, -wingD / 2 + 0.08);
    roofGroup.add(parapetB);
    const parapetL = new THREE.Mesh(new THREE.BoxGeometry(0.16, parapetH, wingD), wallMat);
    parapetL.position.set(-wingW / 2 + 0.08, terraceY + parapetH / 2, 0);
    roofGroup.add(parapetL);
    const parapetR = new THREE.Mesh(new THREE.BoxGeometry(0.16, parapetH, wingD), wallMat);
    parapetR.position.set(wingW / 2 - 0.08, terraceY + parapetH / 2, 0);
    roofGroup.add(parapetR);

    const mumty = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.8, 2.8), coreMat);
    mumty.position.set(0, terraceY + 0.9, -0.8);
    mumty.castShadow = true;
    roofGroup.add(mumty);

    // Champagne Pergola Louvers
    for (let px = -3.8; px <= 3.8; px += 0.65) {
      const louver = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 2.2), champagneMat);
      louver.position.set(px, terraceY + 1.2, 2.1);
      roofGroup.add(louver);
    }

    // Tilted Solar PV Panels
    [-3.3, 3.3].forEach((sx) => {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 1.8), solarMat);
      panel.position.set(sx, terraceY + 0.45, -1.6);
      panel.rotation.x = 0.28;
      panel.castShadow = true;
      roofGroup.add(panel);
    });
    assemblyRoot.add(roofGroup);

    // 8. LANDSCAPE GROUP
    const landscapeGroup = new THREE.Group();
    const glowLamps: THREE.PointLight[] = [];
    const treeCoords: Array<[number, number, number]> = [
      [-6.8, -5.2, 1.15],
      [6.8, -5.2, 1.0],
      [-7.2, 4.8, 1.05],
      [7.2, 4.8, 1.2],
      [-9.5, 0.5, 0.9],
      [9.5, -0.5, 0.95],
    ];
    treeCoords.forEach(([tx, tz, sc]) => {
      const tGroup = new THREE.Group();
      tGroup.position.set(tx, 0, tz);
      tGroup.scale.setScalar(sc);

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 1.4, 8), treeTrunkMat);
      trunk.position.y = 0.7;
      trunk.castShadow = true;
      tGroup.add(trunk);

      const canopy1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.95, 1), treeLeafMat);
      canopy1.position.y = 2.0;
      canopy1.castShadow = true;
      tGroup.add(canopy1);

      const canopy2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 1), treeLeafMat);
      canopy2.position.set(0.35, 2.55, 0.2);
      tGroup.add(canopy2);

      landscapeGroup.add(tGroup);
    });

    // Subtle bollard pathway lights
    [-3.5, 3.5].forEach((lx) => {
      const lamp = new THREE.PointLight(0xfbbf24, lightingRef.current === 'night' ? 1.4 : 0, 12);
      lamp.position.set(lx, 1.2, 6.2);
      landscapeGroup.add(lamp);
      glowLamps.push(lamp);
    });
    assemblyRoot.add(landscapeGroup);

    // CHAMPAGNE GOLD SPARKLE PARTICLES (subtle refined shimmer)
    const stateObj = { progress: progressRef.current };

    const applyConstructionProgress = (progress: number) => {
      const clamped = clamp01(progress);
      surveyGrid.visible = clamped < 0.29;
      planLines.visible = clamped < 0.39;
      planGeometry.setDrawRange(0, 2 * Math.floor(planSegments.length * phaseProgress(clamped, 0.015, 0.135)));

      // 0: Site
      const tSite = smoothstep(phaseProgress(clamped, 0.0, 0.11));
      siteGroup.visible = tSite > 0.005 || clamped === 0;
      siteGroup.scale.set(0.75 + 0.25 * Math.max(0.2, tSite), 1, 0.75 + 0.25 * Math.max(0.2, tSite));

      // 1: Stilt
      const tStilt = smoothstep(phaseProgress(clamped, 0.11, 0.22));
      stiltGroup.visible = tStilt > 0.01;
      stiltGroup.scale.set(1, Math.max(0.01, tStilt), 1);

      // 2: Columns & Core
      const tCols = smoothstep(phaseProgress(clamped, 0.22, 0.36));
      columnsGroup.visible = tCols > 0.01;
      columnsGroup.scale.set(1, Math.max(0.01, tCols), 1);

      // 3: Successive Slabs / Floors
      slabMeshes.forEach((item, idx) => {
        const start = 0.32 + idx * 0.028;
        const end = start + 0.06;
        const tSlab = smoothstep(phaseProgress(clamped, start, end));
        item.mesh.visible = tSlab > 0.01;
        item.mesh.position.y = item.targetY + (1 - tSlab) * 2.2;
        item.mesh.scale.setScalar(0.85 + 0.15 * tSlab);
      });

      // 4: Walls
      wallMeshes.forEach((item) => {
        const start = 0.5 + item.floorIdx * 0.025;
        const end = start + 0.06;
        const tWall = smoothstep(phaseProgress(clamped, start, end));
        item.mesh.visible = tWall > 0.01;
        item.mesh.scale.set(1, Math.max(0.01, tWall), 1);
      });

      // 5: Glazing
      glazingMeshes.forEach((item) => {
        const start = 0.64 + item.floorIdx * 0.02;
        const end = start + 0.05;
        const tGlaze = smoothstep(phaseProgress(clamped, start, end));
        item.mesh.visible = tGlaze > 0.01;
        item.mesh.scale.set(tGlaze, 1, 1);
      });

      // 6: Balconies & Chajjas
      balconyMeshes.forEach((item) => {
        const start = 0.75 + item.floorIdx * 0.018;
        const end = start + 0.05;
        const tBal = smoothstep(phaseProgress(clamped, start, end));
        item.mesh.visible = tBal > 0.01;
        item.mesh.scale.set(1, 1, Math.max(0.01, tBal));
      });

      // 7: Roof & Solar
      const tRoof = smoothstep(phaseProgress(clamped, 0.85, 0.93));
      roofGroup.visible = tRoof > 0.01;
      roofGroup.position.y = (1 - tRoof) * 1.8;

      // 8: Landscape
      const tLand = smoothstep(phaseProgress(clamped, 0.93, 1.0));
      landscapeGroup.visible = tLand > 0.01;
      landscapeGroup.scale.set(1, Math.max(0.01, tLand), 1);

      const orbit = -0.55 + clamped * 1.42;
      const framing = Math.max(1, 0.92 / camera.aspect);
      const distance = (29 - Math.sin(clamped * Math.PI) * 8) * framing;
      const targetY = THREE.MathUtils.lerp(0.5, 6, smoothstep(phaseProgress(clamped, 0.1, 0.88)));
      const elevation = THREE.MathUtils.lerp(12, 6.8, smoothstep(phaseProgress(clamped, 0, 0.32)))
        + 7 * smoothstep(phaseProgress(clamped, 0.43, 1));
      camera.position.set(Math.sin(orbit) * distance, elevation * framing, Math.cos(orbit) * distance);
      camera.lookAt(0, targetY, 0);
    };

    const renderOnce = () => renderer.render(scene, camera);
    const update = () => {
      applyConstructionProgress(stateObj.progress);
      renderOnce();
      host.dataset.renderedProgress = stateObj.progress.toFixed(2);
    };
    const scrub = gsap.quickTo(stateObj, 'progress', { duration: 0.28, ease: 'power2.out', onUpdate: update });
    update();

    const resizeObserver = new ResizeObserver(() => {
      if (!host.clientWidth || !host.clientHeight) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
      update();
    });
    resizeObserver.observe(host);

    sceneRefs.current = {
      scene, renderer, camera, hemi, sun, fill, windowMat, glowLamps, renderOnce,
      scrubTo: (target) => {
        if (motion.matches) {
          scrub.tween.pause();
          stateObj.progress = target;
          update();
        } else {
          scrub(target);
        }
      },
    };

    return () => {
      scrub.tween.kill();
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      sun.shadow.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      sceneRefs.current = null;
    };
  }, [onWebGLUnavailable]);

  return (
    <div
      ref={mountRef}
      data-testid="cinematic-welcome-canvas-host"
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
    />
  );
};

export default CinematicWelcomeScene;

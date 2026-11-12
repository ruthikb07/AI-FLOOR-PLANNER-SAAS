/**
 * Cinematic Welcome Scene & 3D Building Assembly
 * Features a realistic multi-story architectural building with balconies, glass, materials, and GSAP animations.
 */
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
gsap.registerPlugin(ScrollTrigger);
import { Sparkles, ArrowRight, Building2, Layers, ShieldCheck, Compass, ChevronDown, Volume2, VolumeX } from 'lucide-react';

export const CinematicWelcomeScene: React.FC<{ onExplore?: () => void; onStartProject?: () => void }> = ({ onExplore, onStartProject }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const buildingGroupRef = useRef<THREE.Group | null>(null);
  const floorGroupsRef = useRef<THREE.Group[]>([]);
  const particleSystemRef = useRef<THREE.Points | null>(null);
  const particleMatchesRef = useRef<Array<{
    start: THREE.Vector3;
    logo: THREE.Vector3;
    target: THREE.Vector3;
    progress: number;
    phase: number;
    freq: number;
    amp: number;
  }>>([]);
  const [audioMuted, setAudioMuted] = useState<boolean>(true); // Initially muted for respectful UX
  const [exploded, setExploded] = useState<boolean>(false);
  const [soloStilt, setSoloStilt] = useState<boolean>(false);

  // Web Audio API state refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const droneOscillatorsRef = useRef<OscillatorNode[]>([]);
  const windChimesGainRef = useRef<GainNode | null>(null);
  const windChimesSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const startDrone = (): void => {
    if (!audioContextRef.current || audioMuted || !masterGainRef.current) return;

    const ctx = audioContextRef.current;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.08; // ~20dB for ambient feel
    droneGain.connect(masterGainRef.current);

    // Create warm harmonic drone with multiple oscillators
    const baseFreq = 55; // A1
    const harmonics = [1, 2, 3, 4, 5, 7, 9]; // Integer ratios for harmonic series
    const oscillators: OscillatorNode[] = [];

    harmonics.forEach((harmonic, index) => {
      const osc = ctx.createOscillator();
      osc.type = index === 0 ? 'sine' : 'triangle';
      osc.frequency.value = baseFreq * harmonic;

      const oscGain = ctx.createGain();
      oscGain.gain.value = 0.3 / Math.sqrt(harmonic + 1);
      osc.connect(oscGain);
      oscGain.connect(droneGain);

      osc.start();
      oscillators.push(osc);
    });

    droneOscillatorsRef.current = oscillators;
  };

  const startWindChimes = (): void => {
    if (!audioContextRef.current || audioMuted) return;

    const ctx = audioContextRef.current;

    // Create noise buffer for wind chimes
    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    // Filtered noise for wind chimes
    const windChimesNoise = ctx.createBufferSource();
    windChimesNoise.buffer = noiseBuffer;
    windChimesNoise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2000;
    filter.Q.value = 1;

    windChimesGainRef.current = ctx.createGain();
    windChimesGainRef.current.gain.value = 0.15;
    windChimesGainRef.current.connect(filter);

    filter.connect(windChimesGainRef.current);
    windChimesGainRef.current.connect(masterGainRef.current!);

    windChimesSourceRef.current = windChimesNoise;
    windChimesNoise.start();
  };

  const playAllAmbientSounds = (): void => {
    startDrone();
    startWindChimes();
  };

  const toggleMute = (): void => {
    if (!audioContextRef.current) {
      // Initialize if not already done
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContext();

      const masterGain = audioContextRef.current.createGain();
      masterGain.connect(audioContextRef.current.destination);
      masterGainRef.current = masterGain;

      playAllAmbientSounds();
    }

    if (!masterGainRef.current) return;

    if (audioMuted) {
      // Unmute
      masterGainRef.current.gain.setTargetAtTime(0.15, audioContextRef.current!.currentTime, 0.5);
      setAudioMuted(false);
    } else {
      // Mute
      masterGainRef.current.gain.setTargetAtTime(0, audioContextRef.current!.currentTime, 0.5);
      setAudioMuted(true);
    }
  };

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      audioContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (floorGroupsRef.current.length === 0) return;

    const floorHeight = 1.6;
    floorGroupsRef.current.forEach((fg, idx) => {
      let targetY = idx * floorHeight;
      let targetOpacity = 1;
      let targetScale = 1;

      if (exploded) {
        targetY = idx * (floorHeight + 2);
      }

      if (soloStilt) {
        if (idx !== 0) {
          targetOpacity = 0.1;
          targetScale = 0.8;
        }
      }

      gsap.to(fg.position, { y: targetY, duration: 1, ease: 'power2.out' });
      fg.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial;
          gsap.to(mat, { opacity: targetOpacity * (mat.transparent ? 0.6 : 1), duration: 1 });
        }
      });
      gsap.to(fg.scale, { x: targetScale, y: targetScale, z: targetScale, duration: 1 });
    });
  }, [exploded, soloStilt]);

  useEffect(() => {
    if (!mountRef.current) return;

    // 1. Scene, Camera, Renderer Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    scene.fog = new THREE.FogExp2(0x0a0a0a, 0.015);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 12, 28);
    camera.lookAt(0, 4, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountRef.current.appendChild(renderer.domElement);

    // 2. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.5);
    sunLight.position.set(15, 25, 15);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.5);
    fillLight.position.set(-15, 10, -15);
    scene.add(fillLight);

    // 3. Reduced Motion Check
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 4. Create Procedural Golden Texture for Particles
    const createGoldenTexture = (): THREE.Texture => {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to create 2D context for particle texture');

      const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(0.3, '#ffd700');
      gradient.addColorStop(0.7, '#ffd700');
      gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 32, 32);

      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      return texture;
    };

    // 5. Particle System Initialization
    const particleGeometry = new THREE.BufferGeometry();
    const PARTICLE_COUNT = 150;
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const particleTracks: Array<{
      start: THREE.Vector3;
      logo: THREE.Vector3;
      target: THREE.Vector3;
      progress: number;
      phase: number;
      freq: number;
      amp: number;
    }> = [];

    // Define trajectory points
    const startPos = new THREE.Vector3(-5, -5, 5);
    const logoPos = new THREE.Vector3(-2, 0, 0);
    const targetPos = new THREE.Vector3(0, 0, 0);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const t = i / PARTICLE_COUNT;
      const arcT = t * t * (3 - 2 * t);
      const x = (1 - arcT) * (1 - arcT) * startPos.x + 2 * (1 - arcT) * arcT * logoPos.x + arcT * arcT * targetPos.x;
      const y = (1 - arcT) * (1 - arcT) * startPos.y + 2 * (1 - arcT) * arcT * logoPos.y + arcT * arcT * targetPos.y;
      const z = (1 - arcT) * (1 - arcT) * startPos.z + 2 * (1 - arcT) * arcT * logoPos.z + arcT * arcT * targetPos.z;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      particleTracks.push({
        start: startPos.clone(),
        logo: logoPos.clone(),
        target: targetPos.clone(),
        progress: 0,
        phase: t * Math.PI * 4,
        freq: 2 + Math.random(),
        amp: 0.3 + Math.random() * 0.3
      });
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const particleMaterial = new THREE.PointsMaterial({
      map: createGoldenTexture(),
      transparent: true,
      opacity: prefersReducedMotion ? 0 : 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      size: 3,
      color: 0xffd700
    });

    const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particleSystem);
    particleSystemRef.current = particleSystem;

    const animateParticleTrail = (
      particleGeometry: THREE.BufferGeometry,
      track: { start: THREE.Vector3; logo: THREE.Vector3; target: THREE.Vector3; progress: number; phase: number; freq: number; amp: number },
      idx: number
    ) => {
      const animate = () => {
        const posAttr = particleGeometry.attributes.position;
        if (!posAttr || track.progress >= 1) return;
        const positions = posAttr.array as any;

        const t = track.progress;
        const alpha = (1 - t) * (1 - t) * (2 - t) + (1 - t) * (1 - t) * t;
        const beta = (1 - alpha) * (1 - alpha) * track.start.x + 2 * (1 - alpha) * alpha * track.logo.x + alpha * alpha * track.target.x;
        const gamma = (1 - alpha) * (1 - alpha) * track.start.y + 2 * (1 - alpha) * alpha * track.logo.y + alpha * alpha * track.target.y;
        const delta = (1 - alpha) * (1 - alpha) * track.start.z + 2 * (1 - alpha) * alpha * track.logo.z + alpha * alpha * track.target.z;

        positions[idx * 3] = beta;
        positions[idx * 3 + 1] = gamma;
        positions[idx * 3 + 2] = delta;

        if (track.progress > 0.9) {
          const hoverT = (track.progress - 0.9) * 10;
          const hoverPhase = Date.now() * 0.002 + track.phase;
          positions[idx * 3 + 1] += Math.sin(hoverPhase) * track.amp * hoverT;
        }

        posAttr.needsUpdate = true;
        requestAnimationFrame(animate);
      };
      animate();
    };

    // 7. Mount particle system
    if (!prefersReducedMotion && particleSystemRef.current && particleTracks.length > 0) {
      const ps = particleSystemRef.current!;
      scene.add(ps);
      particleMatchesRef.current = particleTracks;

      // Start GSAP animation for particle birth
      const particleTl = gsap.timeline();

      particleTracks.forEach((track, idx) => {
        particleTl.to(track, {
          progress: 1,
          duration: 1.5,
          ease: 'power2.out',
          delay: idx * 0.05
        });
        animateParticleTrail(particleGeometry, track, idx);
      });
    }

    // Golden Pulse Glow Layer (parallel to text, requires WebGL canvas shared)
    const glowGroup = new THREE.Group();
    glowGroup.position.set(-2, 1.5, 0);
    scene.add(glowGroup);

    // Create glow rings using translucent cylinders
    const glowRingGeo = new THREE.CylinderGeometry(1.5, 1.5, 3, 64, 1, true);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const glowRing1 = new THREE.Mesh(glowRingGeo, glowMaterial.clone());
    glowRing1.rotation.x = Math.PI / 2;
    glowGroup.add(glowRing1);

    const glowRing2 = new THREE.Mesh(glowRingGeo, glowMaterial.clone());
    glowRing2.rotation.x = Math.PI / 2;
    glowRing2.scale.set(1.3, 1.3, 1.3);
    glowGroup.add(glowRing2);

    // Store glow refs for animation
    if (!prefersReducedMotion) {
      glowGroup.visible = true;
      const glowTl = gsap.timeline();

      // Phase 1: Golden outline fade in (0-1s)
      glowTl.to(glowMaterial, {
        opacity: 0.8,
        duration: 1,
        ease: 'power2.out'
      }, 0);

      // Phase 2: Solid golden fill (1s-2s)
      glowTl.to(glowMaterial, {
        opacity: 0.4,
        backgroundColor: '#ffd700',
        duration: 0.8,
        ease: 'power2.out'
      }, 1);

      // Phase 3: Ripple expansion toward building (building assembly coordinate is 0,4,0)
      glowTl.to(glowMaterial, {
        opacity: 0.2,
        duration: 0.5,
        ease: 'power2.in'
      }, 1.8);

      glowTl.to(glowRing1.scale, {
        x: 0.6,
        y: 0.6,
        z: 0.6,
        duration: 1.2,
        ease: 'power2.in'
      }, 1.8);

      glowTl.to(glowRing2.scale, {
        x: 1.8,
        y: 1.8,
        z: 1.8,
        duration: 1.2,
        ease: 'power1.out'
      }, 1.8);
    }

    // 8. Ground / Plot Formation
    const plotGeometry = new THREE.BoxGeometry(18, 0.4, 18);
    const plotMaterial = new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 0.9, metalness: 0.1 });
    const plotMesh = new THREE.Mesh(plotGeometry, plotMaterial);
    plotMesh.position.y = -0.2;
    plotMesh.receiveShadow = true;
    scene.add(plotMesh);

    // Grid helper on plot
    const gridHelper = new THREE.GridHelper(18, 18, 0xa67c52, 0x262626);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // 9. Constructing Realistic 3D Building Hierarchy
    const buildingGroup = new THREE.Group();
    buildingGroup.position.y = 0;
    scene.add(buildingGroup);
    buildingGroupRef.current = buildingGroup;

    // Materials
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.7 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.6, transmission: 0.6 });
    const bronzeMat = new THREE.MeshStandardMaterial({ color: 0xa67c52, roughness: 0.4, metalness: 0.8 });
    const windowFrameMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.2 });

    // Floors creation (Stilt + 5 Residential Floors + Terrace)
    const totalFloors = 6;
    const floorHeight = 1.6;
    const floorWidth = 8;
    const floorDepth = 6;

    const floorGroups: THREE.Group[] = [];

    for (let i = 0; i < totalFloors; i++) {
      const floorGroup = new THREE.Group();
      floorGroup.position.y = i * floorHeight;
      floorGroup.position.y += (i + 1) * 5;
      floorGroup.scale.set(0.1, 0.1, 0.1);
      floorGroup.userData = { targetY: i * floorHeight } as Record<string, any>;

      // Floor Slab
      const slabGeo = new THREE.BoxGeometry(floorWidth + 0.6, 0.15, floorDepth + 0.6);
      const slab = new THREE.Mesh(slabGeo, concreteMat);
      slab.castShadow = true;
      slab.receiveShadow = true;
      floorGroup.add(slab);

      if (i === 0) {
        // Lobby Entrance
        const entranceFrame = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, 0.2), bronzeMat);
        entranceFrame.position.set(0, 1.25, floorDepth / 2 + 0.3);
        floorGroup.add(entranceFrame);
      } else if (i < totalFloors - 1) {
        // Main residential volume
        const wallsGeo = new THREE.BoxGeometry(floorWidth - 0.2, floorHeight - 0.15, floorDepth - 0.2);
        const walls = new THREE.Mesh(wallsGeo, concreteMat);
        walls.position.y = floorHeight / 2;
        floorGroup.add(walls);

        // Residential Articulation: Window Frames, Mullions, Balcony Glass
        const balconyDepth = 1.4;
        const balGeo = new THREE.BoxGeometry(floorWidth, 0.05, balconyDepth);
        const balcony = new THREE.Mesh(balGeo, concreteMat);
        balcony.position.set(0, 0, floorDepth / 2 + balconyDepth / 2);
        floorGroup.add(balcony);

        // Balcony Railing (Glass)
        const railingGeo = new THREE.BoxGeometry(floorWidth, 0.8, 0.05);
        const railing = new THREE.Mesh(railingGeo, glassMat);
        railing.position.set(0, 0.4, floorDepth / 2 + balconyDepth - 0.05);
        floorGroup.add(railing);

        // Windows with mullions
        const winWidth = 1.4;
        const winHeight = 1.2;
        for (let w = -2.8; w <= 2.8; w += 2) {
          const winFrame = new THREE.Mesh(new THREE.BoxGeometry(winWidth + 0.1, winHeight + 0.1, 0.1), windowFrameMat);
          winFrame.position.set(w, 0.6, floorDepth / 2 - 0.1);
          floorGroup.add(winFrame);

          const winGlass = new THREE.Mesh(new THREE.BoxGeometry(winWidth - 0.1, winHeight - 0.1, 0.05), glassMat);
          winGlass.position.set(w, 0.6, floorDepth / 2 - 0.05);
          floorGroup.add(winGlass);

          // Mullion
          const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.05, winHeight - 0.1, 0.05), windowFrameMat);
          mullion.position.set(w, 0.6, floorDepth / 2 - 0.02);
          floorGroup.add(mullion);
        }
      }

      buildingGroup.add(floorGroup);
      floorGroups.push(floorGroup);
    }
    floorGroupsRef.current = floorGroups;

    // Landscaping (Trees around plot)
    const treeGroup = new THREE.Group();
    const treeGeo = new THREE.ConeGeometry(0.8, 2.5, 8);
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.8 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 });

    const treePositions: Array<[number, number, number]> = [
      [-8, 0, -8], [8, 0, -8], [-8, 0, 8], [8, 0, 8], [-9, 0, 0], [9, 0, 0]
    ];

    treePositions.forEach(([x, y, z]) => {
      const tGroup = new THREE.Group();
      tGroup.position.set(x, y, z);

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1, 8), trunkMat);
      trunk.position.y = 0.5;
      tGroup.add(trunk);

      const leaves = new THREE.Mesh(treeGeo, treeMat);
      leaves.position.y = 2;
      tGroup.add(leaves);

      treeGroup.add(tGroup);
    });
    scene.add(treeGroup);

    // 10. Cinematic Entry & Scroll-Driven Construction Timeline
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: mountRef.current,
        start: "top top",
        end: "+=3000",
        scrub: 1.5,
        markers: false
      }
    });

    floorGroups.forEach((fg, idx) => {
      tl.to(fg.position, {
        y: idx * floorHeight,
        duration: 0.8,
        ease: 'power3.out'
      }, idx * 0.15);

      tl.to(fg.scale, {
        x: 1, y: 1, z: 1,
        duration: 0.8,
        ease: 'back.out(1.2)'
      }, idx * 0.15);
    });

    tl.to(camera.position, {
      x: 14,
      y: 9,
      z: 22,
      duration: 3,
      ease: 'power2.inOut'
    }, 0);

    // 11. Animation Loop & Mouse Parallax
    let mouseX = 0;
    let mouseY = 0;
    const handleMouseMove = (e: MouseEvent) => {
      mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove);

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      if (buildingGroupRef.current) {
        buildingGroupRef.current.rotation.y += 0.002;
      }

      camera.position.x += (mouseX * 4 - camera.position.x) * 0.05;
      camera.position.y += (mouseY * 2 + 9 - camera.position.y) * 0.05;
      camera.lookAt(0, 4, 0);

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      mountRef.current?.removeChild(renderer.domElement);
    };
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    Math.floor(scrollTop / window.innerHeight);
  };

  return (
    <div
      onScroll={handleScroll}
      className="absolute inset-0 z-50 overflow-y-auto custom-scrollbar bg-[#0a0a0a] text-[#FAF8F4] selection:bg-[#A67C52] selection:text-[#0a0a0a]"
    >
      <div ref={mountRef} className="fixed inset-0 z-0 pointer-events-none" />

      <header className="sticky top-0 z-50 w-full max-w-7xl mx-auto px-6 py-4 flex items-center justify-between backdrop-blur-md bg-[#0a0a0a]/80 border-b border-[#222]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#A67C52] to-[#252723] text-[#FAF8F4] flex items-center justify-center font-bold font-serif text-lg shadow-lg">
            RH
          </div>
          <div>
            <span className="text-lg font-bold tracking-wider font-serif text-[#FAF8F4]">RH PLANNER</span>
            <span className="block text-[10px] font-mono text-[#A67C52] uppercase tracking-widest">Architectural 3D & AI Studio</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={toggleMute}
            className="p-2.5 rounded-xl bg-[#141414]/90 hover:bg-[#1a1a1a] border border-[#333] text-[#FAF8F4] transition-all shadow-lg hover:shadow-[#A67C52]/10 cursor-pointer"
            title={audioMuted ? "Enable ambient sounds" : "Mute ambient sounds"}
          >
            {audioMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <button
            onClick={onStartProject}
            className="px-5 py-2.5 rounded-xl bg-[#A67C52] hover:bg-[#b8895c] text-[#0a0a0a] font-bold text-xs tracking-wider uppercase transition-all shadow-lg shadow-[#A67C52]/20 cursor-pointer flex items-center gap-2"
          >
            <Building2 size={15} />
            <span>Start Designing</span>
          </button>
        </div>
      </header>

      <section className="relative min-h-screen flex flex-col justify-between max-w-7xl mx-auto px-6 py-16 z-10 pointer-events-auto">
        <div className="max-w-2xl space-y-8 mt-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#A67C52]/10 border border-[#A67C52]/30 text-[#E8DCCB] text-xs font-mono uppercase tracking-widest">
            <Sparkles size={13} className="text-[#A67C52]" />
            <span>Next-Gen AI Architectural Workspace</span>
          </div>

          <div className="space-y-4">
            <h1 className="text-5xl sm:text-7xl font-serif font-bold tracking-tight text-[#FAF8F4] leading-[1.08]">
              Design Your Vision. <br />
              <span className="bg-gradient-to-r from-[#E8DCCB] via-[#B8A58F] to-[#A67C52] bg-clip-text text-transparent">
                Explore in Real 3D.
              </span>
            </h1>
            <p className="text-base sm:text-lg text-[#B8A58F] leading-relaxed max-w-xl font-light">
              Transform architectural requirements into intelligent floor plans, Maharashtra UDCPR 2020 compliant layouts, and photorealistic 3D building assemblies instantly.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-4">
            <button
              onClick={onStartProject}
              className="px-7 py-4 rounded-xl bg-[#A67C52] hover:bg-[#b8895c] text-[#0a0a0a] font-bold text-sm tracking-wider uppercase flex items-center gap-3 shadow-xl shadow-[#A67C52]/20 transition-all transform hover:-translate-y-0.5 cursor-pointer"
            >
              <Building2 size={18} />
              <span>Launch Studio</span>
              <ArrowRight size={16} />
            </button>

            <button
              onClick={onExplore}
              className="px-6 py-4 rounded-xl bg-[#141414]/90 hover:bg-[#1a1a1a] border border-[#333] text-[#FAF8F4] font-bold text-sm tracking-wider uppercase flex items-center gap-2 backdrop-blur-md transition-all cursor-pointer"
            >
              <Compass size={18} className="text-[#A67C52]" />
              <span>Explore 3D Model</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-8 border-t border-[#222]">
            <div>
              <div className="text-2xl font-bold text-[#FAF8F4] font-serif">UDCPR</div>
              <div className="text-xs text-[#737373] font-mono mt-0.5">2020 Compliant</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-[#FAF8F4] font-serif">0.000</div>
              <div className="text-xs text-[#737373] font-mono mt-0.5">MM² Area Precision</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-[#FAF8F4] font-serif">Three.js</div>
              <div className="text-xs text-[#737373] font-mono mt-0.5">Realtime WebGL 3D</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-[#FAF8F4] font-serif">ETABS</div>
              <div className="text-xs text-[#737373] font-mono mt-0.5">Structural Bridge</div>
            </div>
          </div>
        </div>

        <div className="flex justify-center pb-8 animate-bounce">
          <ChevronDown className="w-6 h-6 text-[#A67C52]" />
        </div>
      </section>

      <section className="relative min-h-screen flex items-center max-w-7xl mx-auto px-6 py-24 z-10 pointer-events-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center w-full">
          <div className="space-y-6 bg-[#141414]/90 p-8 sm:p-12 rounded-3xl border border-[#333] backdrop-blur-xl shadow-2xl">
            <span className="eyebrow text-[#A67C52]">01 • CAPABILITIES</span>
            <h2 className="text-3xl sm:text-5xl font-serif font-bold text-[#FAF8F4]">
              Intelligent Architecture & Code Compliance.
            </h2>
            <p className="text-[#B8A58F] leading-relaxed font-light">
              RH Planner combines rigorous mathematical geometry solvers with AI space planning. Generate staircases, elevators, parking stilts, and multi-unit apartment floors with absolute structural integrity.
            </p>
            <div className="grid grid-cols-2 gap-4 pt-4">
              <div className="p-4 rounded-2xl bg-[#0a0a0a] border border-[#222]">
                <Layers className="w-6 h-6 text-[#A67C52] mb-2" />
                <h4 className="font-bold text-sm text-[#FAF8F4]">Multi-Floor Solver</h4>
                <p className="text-xs text-[#737373] mt-1">Automatic vertical stacking and core alignment.</p>
              </div>
              <div className="p-4 rounded-2xl bg-[#0a0a0a] border border-[#222]">
                <ShieldCheck className="w-6 h-6 text-[#A67C52] mb-2" />
                <h4 className="font-bold text-sm text-[#FAF8F4]">Statutory Audits</h4>
                <p className="text-xs text-[#737373] mt-1">Setbacks, FSI, and ventilation checks.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative min-h-screen flex items-center max-w-7xl mx-auto px-6 py-24 z-10 pointer-events-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center w-full">
          <div className="lg:col-start-2 space-y-6 bg-[#141414]/90 p-8 sm:p-12 rounded-3xl border border-[#333] backdrop-blur-xl shadow-2xl">
            <span className="eyebrow text-[#A67C52]">02 • EXPLORER</span>
            <h2 className="text-3xl sm:text-5xl font-serif font-bold text-[#FAF8F4]">
              Interactive Building Discovery.
            </h2>
            <p className="text-[#B8A58F] leading-relaxed font-light">
              Inspect every architectural detail with the interactive explorer. Explode floor plates, orbit core components, and visualize the structural assembly before construction begins.
            </p>
            <div className="flex flex-wrap gap-4 pt-4">
              <button
                onClick={() => setExploded(!exploded)}
                className="px-6 py-3 rounded-xl bg-[#0a0a0a] border border-[#333] text-xs font-mono text-[#E8DCCB] hover:bg-[#252723] transition-all"
              >
                {exploded ? 'REASSEMBLE FLOORS' : 'EXPLODE FLOORS'}
              </button>
              <button
                onClick={() => setSoloStilt(!soloStilt)}
                className="px-6 py-3 rounded-xl bg-[#0a0a0a] border border-[#333] text-xs font-mono text-[#E8DCCB] hover:bg-[#252723] transition-all"
              >
                {soloStilt ? 'SHOW ALL FLOORS' : 'SOLO STILT FLOOR'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section
        className="relative min-h-screen flex items-center max-w-7xl mx-auto px-6 py-24 z-10 pointer-events-auto section-workflow"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center w-full">
          <div className="lg:col-start-2 space-y-6 bg-[#141414]/90 p-8 sm:p-12 rounded-3xl border border-[#333] backdrop-blur-xl shadow-2xl">
            <span className="eyebrow text-[#A67C52]">02 • WORKFLOW</span>
            <h2 className="text-3xl sm:text-5xl font-serif font-bold text-[#FAF8F4]">
              From Plot Brief to Professional DXF & PDF.
            </h2>
            <p className="text-[#B8A58F] leading-relaxed font-light">
              Configure plot boundaries, road widths, and room schedules in the wizard. Watch the planning engine assemble your building, then inspect it in the 2D CAD studio or 3D isometric viewer.
            </p>
            <ul className="space-y-3 font-mono text-xs text-[#E8DCCB]">
              <li className="flex items-center gap-3 p-3 rounded-xl bg-[#0a0a0a] border border-[#222]">
                <span className="w-6 h-6 rounded-lg bg-[#A67C52] text-[#0a0a0a] font-bold flex items-center justify-center">1</span>
                <span>Enter plot dimensions & UDCPR parameters</span>
              </li>
              <li className="flex items-center gap-3 p-3 rounded-xl bg-[#0a0a0a] border border-[#222]">
                <span className="w-6 h-6 rounded-lg bg-[#A67C52] text-[#0a0a0a] font-bold flex items-center justify-center">2</span>
                <span>Run audited AI space planning pipeline</span>
              </li>
              <li className="flex items-center gap-3 p-3 rounded-xl bg-[#0a0a0a] border border-[#222]">
                <span className="w-6 h-6 rounded-lg bg-[#A67C52] text-[#0a0a0a] font-bold flex items-center justify-center">3</span>
                <span>Export CAD drawings (.dxf/.dwg) & engineering reports</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="relative min-h-screen flex flex-col items-center justify-center text-center max-w-4xl mx-auto px-6 py-24 z-10 pointer-events-auto">
        <div className="bg-[#141414]/95 p-12 sm:p-16 rounded-3xl border border-[#333] backdrop-blur-2xl shadow-2xl space-y-8 w-full">
          <div className="w-16 h-16 rounded-2xl bg-[#A67C52] text-[#0a0a0a] flex items-center justify-center mx-auto shadow-xl">
            <Building2 size={32} />
          </div>
          <div className="space-y-4">
            <h2 className="text-4xl sm:text-6xl font-serif font-bold text-[#FAF8F4]">
              Ready to Design Your Building?
            </h2>
            <p className="text-[#B8A58F] max-w-xl mx-auto font-light">
              Launch the studio now to create your first project with live 3D visualization and automated Maharashtra UDCPR compliance.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-4 pt-4">
            <button
              onClick={onStartProject}
              className="px-8 py-4 rounded-xl bg-[#A67C52] hover:bg-[#b8895c] text-[#0a0a0a] font-bold text-sm tracking-wider uppercase flex items-center gap-3 shadow-2xl shadow-[#A67C52]/30 transition-all transform hover:-translate-y-0.5 cursor-pointer"
            >
              <Building2 size={18} />
              <span>Create New Project Now</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
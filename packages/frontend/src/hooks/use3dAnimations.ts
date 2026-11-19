/**
 * 3D Animation Hook - Safe local Three.js ambient sparkle with proper reduced-motion and GPU cleanup.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export interface ExplosionAnimationConfig {
  enabled: boolean;
  intensity?: number;
  color?: string;
  speed?: number;
}

export interface RotationAnimationConfig {
  enabled: boolean;
  speed?: number;
  axis?: 'x' | 'y' | 'z' | 'auto';
}

export interface BlueprintLineConfig {
  enabled: boolean;
  color?: string;
  speed?: number;
  opacity?: number;
}

export interface ParticleConfig {
  enabled: boolean;
  count?: number;
  color?: string;
  size?: number;
  speed?: number;
}

export interface ConstructionMoveConfig {
  enabled: boolean;
  moveInterval?: number;
  color?: string;
}

export interface GlowPulseConfig {
  enabled: boolean;
  intensity?: number;
  speed?: number;
}

function createProceduralSparkTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255, 250, 230, 1)');
  grad.addColorStop(0.35, 'rgba(220, 185, 110, 0.85)');
  grad.addColorStop(1, 'rgba(220, 185, 110, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export const use3DAnimation = (
  sceneRef: React.RefObject<THREE.Scene | null>,
  config: {
    explosion?: ExplosionAnimationConfig;
    rotation?: RotationAnimationConfig;
    blueprintLines?: BlueprintLineConfig;
    particles?: ParticleConfig;
    constructionMove?: ConstructionMoveConfig;
    glowPulse?: GlowPulseConfig;
  }
) => {
  const groupRef = useRef<THREE.Group | null>(null);
  const particlesRef = useRef<THREE.Points | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || !config.particles?.enabled) {
      return;
    }

    const group = new THREE.Group();
    group.name = 'animated-building-ambience';
    scene.add(group);
    groupRef.current = group;

    const count = Math.min(80, config.particles.count ?? 60);
    const color = config.particles.color ?? '#d4af37';
    const size = config.particles.size ?? 0.14;
    const speed = config.particles.speed ?? 0.35;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 2);

    for (let i = 0; i < count; i++) {
      const radius = 12 + (i % 7) * 1.6;
      const theta = (i / count) * Math.PI * 2;
      positions[i * 3] = Math.cos(theta) * radius;
      positions[i * 3 + 1] = 1.5 + (i % 9) * 1.4;
      positions[i * 3 + 2] = Math.sin(theta) * radius;
      seeds[i * 2] = radius;
      seeds[i * 2 + 1] = theta;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const tex = createProceduralSparkTexture();
    textureRef.current = tex;

    const material = new THREE.PointsMaterial({
      color: new THREE.Color(color),
      size,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      ...(tex ? { map: tex } : {}),
      depthWrite: false,
    });

    const particles = new THREE.Points(geometry, material);
    group.add(particles);
    particlesRef.current = particles;

    let animId = 0;
    const startMs = performance.now();
    const animate = () => {
      animId = requestAnimationFrame(animate);
      const t = (performance.now() - startMs) * 0.001;
      const posAttr = geometry.attributes.position as THREE.BufferAttribute | undefined;
      if (posAttr) {
        for (let i = 0; i < count; i++) {
          const r = seeds[i * 2] ?? 12;
          const a = (seeds[i * 2 + 1] ?? 0) + t * speed * 0.15;
          posAttr.setX(i, Math.cos(a) * r);
          posAttr.setZ(i, Math.sin(a) * r);
        }
        posAttr.needsUpdate = true;
      }
    };
    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      scene.remove(group);
      geometry.dispose();
      material.dispose();
      tex?.dispose();
      textureRef.current = null;
      particlesRef.current = null;
      groupRef.current = null;
    };
  }, [config.particles?.enabled, config.particles?.color, config.particles?.count, config.particles?.size, sceneRef]);

  return {
    animationsActive: Object.values(config).some(c => c?.enabled),
  };
};

export const createExplodeParticles = (
  scene: THREE.Scene,
  color = '#c8a25a',
  count = 50
) => {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const angle = (i / Math.max(1, count)) * Math.PI * 2;
    const radius = 2 + (i % 5);
    positions[i * 3] = radius * Math.cos(angle);
    positions[i * 3 + 1] = (i % 6) * 0.8;
    positions[i * 3 + 2] = radius * Math.sin(angle);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color,
    size: 0.15,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);
  return particles;
};

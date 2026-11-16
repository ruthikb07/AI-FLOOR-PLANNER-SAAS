/**
 * 3D Animation Hook - Crazy React-based 3D building effects reuse across all workspaces
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Animation config types
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

/**
 * Hook factory to attach crazy 3D animations to a Three.js scene
 */
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
  const glowLightRef = useRef<THREE.PointLight | null>(null);
  const timeRef = useRef<number>(0);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Create a wrapper group for all animations
    const group = new THREE.Group();
    group.name = 'animated-building';
    scene.add(group);
    groupRef.current = group;

    // Animate EXPLOSION - scales the building apart
    if (config.explosion?.enabled) {
      const color = config.explosion.color ?? '#fbbf24';
      const speed = config.explosion.speed ?? 5000;

      group.userData.explosion = { target: 1, current: 1, color, speed };

      // Create a light for explosion effect
      const explosionLight = new THREE.PointLight(new THREE.Color(color), 0, 100);
      explosionLight.name = 'explosion-light';
      group.add(explosionLight);
      glowLightRef.current = explosionLight;
    }

    // Animate ROTATION - spins the building
    if (config.rotation?.enabled) {
      const speed = config.rotation.speed ?? 2000; // degrees per second
      group.userData.rotation = { angle: 0, speed };
    }

    // Animate PARTICLES - floating sparks around building
    if (config.particles?.enabled) {
      const count = config.particles.count ?? 400; // Increased count for Aether feel
      const color = config.particles.color ?? '#22d3ee';
      const size = config.particles.size ?? 0.12; // Slightly larger for "Aether" glow
      const particleSpeed = config.particles.speed ?? 1500;

      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      const velocities = new Float32Array(count * 3);

      for (let i = 0; i < count; i++) {
        // Initialize particles in a sphere around building center
        const radius = 10 + Math.random() * 12; // Wider distribution
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = radius * Math.cos(phi);

        // Random velocities
        velocities[i * 3] = (Math.random() - 0.5) * particleSpeed;
        velocities[i * 3 + 1] = (Math.random() - 0.5) * particleSpeed * 0.5 + particleSpeed * 0.5; // Upward bias
        velocities[i * 3 + 2] = (Math.random() - 0.5) * particleSpeed;
      }

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

      const material = new THREE.PointsMaterial({
        color: new THREE.Color(color),
        size,
        transparent: true,
        opacity: 0.8, // More opaque
        blending: THREE.AdditiveBlending,
        map: new THREE.TextureLoader().load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/sprites/spark1.png'),
        depthWrite: false,
      });

      const particles = new THREE.Points(geometry, material);
      group.add(particles);
      particlesRef.current = particles;
    }

    // Animate BLUEPRINT LINES - glowing technical drawing overlay
    if (config.blueprintLines?.enabled) {
      const segmentCount = 12;
      const lineColor = new THREE.Color(config.blueprintLines.color ?? '#818cf8');

      for (let i = 0; i < segmentCount; i++) {
        const angle = (i / segmentCount) * Math.PI * 2;
        const radius = 6 + Math.random() * 2;

        const geometry = new THREE.RingGeometry(2, 2.2, 64);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(
          radius * Math.cos(angle),
          0.02,
          radius * Math.sin(angle)
        );

        const material = new THREE.MeshBasicMaterial({
          color: lineColor,
          transparent: true,
          opacity: config.blueprintLines.opacity ?? 0.3,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });

        const ring = new THREE.Points(geometry, material);
        group.add(ring);
      }

      group.userData.blueprintLines = { speed: config.blueprintLines.speed ?? 2000 };
    }

    // Animate CONSTRUCTION MOVE - shows individual floors moving down
    if (config.constructionMove?.enabled) {
      const moveInterval = config.constructionMove.moveInterval ?? 2000;
      group.userData.constructionMove = {
        interval: moveInterval,
        nextMove: Date.now() + moveInterval
      };
    }

    // Animate GLOW PULSE - soft ambient light pulsing
    if (config.glowPulse?.enabled) {
      const speed = config.glowPulse.speed ?? 1500;

      const pulseLight = new THREE.PointLight(0xffffff, 0, 50);
      pulseLight.name = 'pulse-light';
      group.add(pulseLight);
      glowLightRef.current = pulseLight;
      group.userData.glowPulse = { interval: speed };
    }

    // Animation loop
    let animId = 0;
    const animate = (timestamp: number) => {
      if (!groupRef.current) return;

      const group = groupRef.current;
      const delta = timestamp - (timeRef.current || timestamp);
      timeRef.current = timestamp;

      // EXPLOSION: Scale the building apart
      if (group.userData.explosion) {
        const { target, current, color, speed } = group.userData.explosion as {
          target: number;
          current: number;
          color: string;
          speed: number;
        };

        const step = (Date.now() % speed) / speed;
        const easeStep = step * step * (3 - 2 * step); // Smoothstep
        const newScale = current + (target - current) * (easeStep - current) * 0.05;

        group.scale.set(newScale, newScale, newScale);

        // Pulse the explosion light
        if (glowLightRef.current && glowLightRef.current.name === 'explosion-light') {
          glowLightRef.current.intensity = newScale * 2;
          glowLightRef.current.color.setHex(parseInt(color.replace('#', ''), 16));
        }

        group.userData.explosion.current = newScale;
      }

      // ROTATION: Spin the building
      if (group.userData.rotation) {
        const rotationState = group.userData.rotation as { angle: number; speed: number };
        const rotationSpeed = (rotationState.speed / 1000) * (Math.PI / 180);
        rotationState.angle += rotationSpeed * delta;
        group.rotation.y = rotationState.angle;
      }

      // BLUEPRINT LINES: Rotate group
      if (group.userData.blueprintLines) {
        const bpState = group.userData.blueprintLines as { speed: number };
        const rotationSpeed = (bpState.speed / 1000) * (Math.PI / 180);
        group.rotation.y += rotationSpeed * (delta / 16);
      }

      // CONSTRUCTION MOVE: Drop floors one by one
      if (group.userData.constructionMove) {
        const moveState = group.userData.constructionMove as {
          interval: number;
          nextMove: number;
        };

        if (timestamp > moveState.nextMove) {
          // Move the entire group down and up rapidly
          group.position.y = group.position.y === 0 ? -2 : 0;
          moveState.nextMove = timestamp + moveState.interval;
        }
      }

      // GLOW PULSE: Ambient light breathing effect
      if (group.userData.glowPulse) {
        if (glowLightRef.current && glowLightRef.current.name === 'pulse-light') {
          const pulse = 0.5 + 0.5 * Math.sin(timestamp / (group.userData.glowPulse as { interval: number }).interval * Math.PI * 2);
          glowLightRef.current.intensity = pulse * (config.glowPulse?.intensity ?? 2);
        }
      }

      // PARTICLES: Float particles around building
      if (particlesRef.current) {
        const particles = particlesRef.current;
        const posAttr = particles.geometry.attributes.position;
        const velAttr = particles.geometry.attributes.velocity;

        if (posAttr && velAttr) {
          const positions = posAttr.array as Float32Array;
          const velocities = velAttr.array as Float32Array;

          for (let i = 0; i < positions.length / 3; i++) {
            const vx = velocities[i * 3] ?? 0;
            const vy = velocities[i * 3 + 1] ?? 0;
            const vz = velocities[i * 3 + 2] ?? 0;

            positions[i * 3] = (positions[i * 3] ?? 0) + vx * (delta / 1000);
            positions[i * 3 + 1] = (positions[i * 3 + 1] ?? 0) + vy * (delta / 1000);
            positions[i * 3 + 2] = (positions[i * 3 + 2] ?? 0) + vz * (delta / 1000);

            // Reset particles that go too far
            const px = positions[i * 3] ?? 0;
            const py = positions[i * 3 + 1] ?? 0;
            const pz = positions[i * 3 + 2] ?? 0;
            const dist = Math.sqrt(px * px + py * py + pz * pz);

            if (dist > 20) {
              positions[i * 3] = (Math.random() - 0.5) * 16;
              positions[i * 3 + 1] = (Math.random() - 0.5) * 16;
              positions[i * 3 + 2] = (Math.random() - 0.5) * 16;
            }
          }

          posAttr.needsUpdate = true;
        }
      }

      animId = requestAnimationFrame(animate);
    };

    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      groupRef.current = null;
      particlesRef.current = null;
      glowLightRef.current = null;
    };
  }, [config, sceneRef]);

  return {
    animationsActive: Object.values(config).some(c => c?.enabled),
  };
};

/**
 * Creates particles for building "exploration" effect
 */
export const createExplodeParticles = (
  scene: THREE.Scene,
  color = '#fbbf24',
  count = 50
) => {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 2 + Math.random() * 3;
    positions[i * 3] = radius * Math.cos(angle);
    positions[i * 3 + 1] = Math.random() * 5 - 2.5;
    positions[i * 3 + 2] = radius * Math.sin(angle);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color,
    size: 0.15,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(geometry, material);

  // Initialize velocities
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    velocities[i * 3] = (Math.random() - 0.5) * 100;
    velocities[i * 3 + 1] = (Math.random() - 0.5) * 100 - 50;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 100;
  }
  geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

  scene.add(particles);

  return particles;
};
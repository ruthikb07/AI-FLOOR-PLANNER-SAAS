import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Animation Configuration for FloorIsometricEditor - BlueprintLines Effect
 */
export const FLOOR_ISOMETRIC_BLUEPRINT_CONFIG = {
  blueprintLines: {
    enabled: true,
    color: '#818cf8',
    speed: 2000,
    opacity: 0.3,
  },
} as const;

/**
 * Creates blueprint line effect for floor isometric scene
 */
export function useFloorIsometricBlueprintAnimation(scene: THREE.Scene) {
  const lineGroupRef = useRef<THREE.Group>(new THREE.Group());

  useEffect(() => {
    const group = lineGroupRef.current;
    scene.add(group);

    // Create rotating blueprint lines around the building
    const segmentCount = 12;

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
        color: new THREE.Color('#818cf8'),
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });

      const ring = new THREE.Points(geometry, material);
      ring.rotation.y = angle;
      ring.position.x = Math.cos(angle) * 6;
      ring.position.z = Math.sin(angle) * 6;
      group.add(ring);
    }

    // Animation loop
    let animationTime = 0;
    let animId = 0;
    const animate = () => {
      animationTime += 16;
      group.rotation.y = ((animationTime % 2000) / 2000) * Math.PI * 2;
      animId = requestAnimationFrame(animate);
    };
    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      scene.remove(group);
    };
  }, [scene]);

  return {};
}
import { Box3, Vector3, type Object3D } from 'three';

/** Site context must not drown a small building when fitting the architectural model. */
export function getModelBounds(group: Object3D, includeSite = false): Box3 {
  const bounds = new Box3();
  group.children.filter(child => includeSite || child.name !== 'site-context')
    .forEach(child => bounds.expandByObject(child));
  return bounds.isEmpty() ? new Box3().setFromObject(group) : bounds;
}

export function modelFitDistance(bounds: Box3, verticalFov: number, aspect: number): number {
  const vertical = verticalFov * Math.PI / 360;
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(aspect, 0.1));
  const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 1);
  return radius / Math.sin(Math.min(vertical, horizontal)) * 1.12;
}

export function isModelClick(start: { x: number; y: number; id: number } | null, x: number, y: number, id: number): boolean {
  return Boolean(start && start.id === id && Math.hypot(x - start.x, y - start.y) <= 4);
}

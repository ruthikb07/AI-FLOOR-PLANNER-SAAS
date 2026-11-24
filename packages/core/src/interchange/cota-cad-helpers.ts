export {
  TAU,
  normCadAngle,
  type CadArcEntity,
  type CadCircleEntity,
  type CadDimensionEntity,
  type CadEntity,
  type CadEntityOrigin,
  type CadEntityType,
  type CadLayer,
  type CadLineEntity,
  type CadPoint2D,
  type CadPolylineEntity,
  type CadRectangleEntity,
  type CadTextEntity,
} from './cota-cad-kernel';

export function angleBulgeFromArc(includedAngleRad: number): number {
  return Math.tan(includedAngleRad / 4);
}

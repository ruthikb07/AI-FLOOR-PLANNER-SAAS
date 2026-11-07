/**
 * Customizable Openings & Furniture Specification Contracts (§1A).
 *
 * Defines design styles, materials, and parametric dimensions for
 * doors, windows, and interior fixtures.
 */

import type { Point } from './geometry';
import type { SwingDirection } from './enums';
import type { CanonicalFurnitureItem } from './furniture';

export type OpeningStyleId =
  | 'FLUSH_TIMBER'
  | 'GLASS_FRENCH'
  | 'SLIDING_UPVC'
  | 'CASEMENT_ALUMINUM'
  | 'FIXED_GLAZING';

/** Customizable architectural door or window opening. */
export interface CustomizableOpening {
  readonly id: string;
  readonly floorId: string;
  readonly wallId: string;
  readonly openingType: 'DOOR' | 'WINDOW';
  readonly styleId: OpeningStyleId;
  readonly materialId?: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly sillHeightMm?: number;
  readonly swingDirection?: SwingDirection;
  readonly position: Point;
}

/** Customizable interior architectural fixture and furniture. */
export interface CustomizableFurniture extends CanonicalFurnitureItem {
  readonly styleId?: string;
  readonly materialId?: string;
  readonly heightMm?: number;
  readonly elevationMm?: number;
  readonly color?: string;
}


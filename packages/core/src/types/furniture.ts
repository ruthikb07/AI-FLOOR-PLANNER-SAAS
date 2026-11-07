/**
 * Canonical Furniture & Plancraft DSL Contracts (§1A).
 *
 * Defines the canonical types for interior architectural fixtures and furniture
 * on AIA CAD layer A-FURN. Furniture items are visual/CAD fixtures and do NOT
 * subtract from Usable Carpet Area in the planar area ledger (Delta = 0.000 mm²).
 */

export type PlancraftFurnitureElementType =
  | 'bathtub'
  | 'bed'
  | 'bookshelf'
  | 'car'
  | 'chair'
  | 'coffee_table'
  | 'conference_table'
  | 'counter'
  | 'desk'
  | 'executive_desk'
  | 'filing_cabinet'
  | 'floor_lamp'
  | 'fridge'
  | 'l_sofa'
  | 'office_chair'
  | 'oven'
  | 'round_table'
  | 'sectional_sofa'
  | 'shower'
  | 'sink'
  | 'sofa'
  | 'spiral_staircase'
  | 'staircase'
  | 'stove'
  | 'table'
  | 'toilet'
  | 'tv_console'
  | 'wardrobe'
  | 'whiteboard';

export interface CanonicalFurnitureItem {
  readonly id: string;
  readonly type: PlancraftFurnitureElementType;
  readonly roomId: string;
  readonly siteZoneId?: string;
  readonly flatId?: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly rotationDeg: 0 | 90 | 180 | 270;
  readonly anchorWall?: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' | 'CENTER';
  readonly layer: 'A-FURN';
}

export interface PlancraftDslOutput {
  readonly pcText: string;
  readonly pcfText: string;
}

/**
 * Rendering types for the SVG/Canvas layer.
 */

import type { Floor, Building } from './building';

/** View transform for world-to-screen coordinate mapping. */
export interface ViewTransform {
  readonly scale: number;     // mm-to-px ratio (zoom level)
  readonly offsetX: number;   // pan X in pixels
  readonly offsetY: number;   // pan Y in pixels
}

/** A screen-space point in pixels. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** Options for SVG export. */
export interface ExportOptions {
  readonly includeGrid: boolean;
  readonly includeDimensions: boolean;
  readonly includeRoomLabels: boolean;
  readonly includeRoomAreas?: boolean;
  readonly includeOpenings?: boolean;
  readonly includeNorthArrow: boolean;
  readonly includeScaleBar: boolean;
  readonly includeTitleBlock: boolean;
  readonly includeFurniture?: boolean;
  readonly scale: string;          // e.g., "1:100"
  readonly paperSize: PaperSize;
  readonly orientation: 'portrait' | 'landscape';
  /** Optional floor selection. Defaults to the first floor for compatibility. */
  readonly floorId?: string;
  /** Title-block author metadata. */
  readonly drawnBy?: string;
  readonly projectNumber?: string;
  readonly revision?: string;
}

/** Standard paper sizes for export. */
export type PaperSize = 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'letter' | 'tabloid';

/** Render layer identifiers (ordered bottom to top). */
export enum RenderLayer {
  Grid = 'grid',
  Plot = 'plot',
  SiteZones = 'site_zones',
  Floor = 'floor',
  Rooms = 'rooms',
  Walls = 'walls',
  Openings = 'openings',
  Stairs = 'stairs',
  Columns = 'columns',
  Furniture = 'furniture',
  Annotations = 'annotations',
  Selection = 'selection',
  Guides = 'guides',
}

/** Renderer interface contract. */
export interface Renderer {
  renderFloor(floor: Floor, transform: ViewTransform): string;
  renderBuilding(building: Building, floorLevel: number): string;
  exportSVG(building: Building, options: ExportOptions): string;
}

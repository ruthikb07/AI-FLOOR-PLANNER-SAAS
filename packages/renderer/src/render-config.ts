/**
 * Render Configuration System for the SVG Floor-Plan Renderer.
 *
 * RenderConfig is a pure data object that controls rendering behavior.
 * It is renderer-local and independent of:
 *   - UI state
 *   - Building Model
 *   - Geometry Engine
 *   - Constraint Engine
 *
 * All calls to renderFloor / renderBuilding / exportSVG remain backward-compatible.
 * RenderConfig is always optional — DEFAULT_RENDER_CONFIG preserves existing behavior.
 */

import { RoomType, WallType, RenderLayer } from '@ai-floor-planner/core';

// ─── Display Units ──────────────────────────────────────────────────────────

/** Supported display units for dimensions and annotations. */
export type DisplayUnit = 'mm' | 'm' | 'ft';

// ─── Style Types ────────────────────────────────────────────────────────────

/** Style for wall rendering by type. */
export interface WallStyle {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
}

/** Style for room rendering by type. */
export interface RoomStyle {
  readonly fill: string;
  readonly fillOpacity: number;
}

/** Style for door rendering. */
export interface DoorStyle {
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly arcFill: string;
}

/** Style for window rendering. */
export interface WindowStyle {
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly glassStroke: string;
}

/** Style for column rendering. */
export interface ColumnStyle {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly hatchStroke: string;
}

/** Style for dimension annotations. */
export interface DimensionStyle {
  readonly lineColor: string;
  readonly lineWidth: number;
  readonly textColor: string;
  readonly fontSize: number;
  readonly tickLength: number;
}

/** Style for text labels. */
export interface TextStyle {
  readonly color: string;
  readonly fontSize: number;
  readonly fontWeight: string;
}

/** Style for grid rendering. */
export interface GridStyle {
  readonly stroke: string;
  readonly strokeWidth: number;
}

// ─── RenderConfig ───────────────────────────────────────────────────────────

/**
 * Typed render configuration controlling all rendering behavior.
 * Every field is optional via Partial<RenderConfig> for overrides.
 */
export interface RenderConfig {
  // ── Layer Visibility ──────────────────────────────────────────────────
  readonly layers: Readonly<Record<RenderLayer, boolean>>;

  // ── Display Options ───────────────────────────────────────────────────
  readonly showDimensions: boolean;
  readonly showRoomLabels: boolean;
  readonly showRoomAreas: boolean;
  readonly showNorthArrow: boolean;
  readonly showScaleBar: boolean;
  readonly showGrid: boolean;
  readonly showTitleBlock: boolean;

  // ── Units ─────────────────────────────────────────────────────────────
  readonly displayUnit: DisplayUnit;

  // ── Typography ────────────────────────────────────────────────────────
  readonly fontFamily: string;

  // ── Grid ──────────────────────────────────────────────────────────────
  readonly gridSpacing: number; // mm in world space

  // ── Style Overrides ───────────────────────────────────────────────────
  readonly wallStyles: Readonly<Record<string, WallStyle>>;
  readonly roomStyles: Readonly<Record<string, RoomStyle>>;
  readonly doorStyle: Readonly<DoorStyle>;
  readonly windowStyle: Readonly<WindowStyle>;
  readonly columnStyle: Readonly<ColumnStyle>;
  readonly dimensionStyle: Readonly<DimensionStyle>;
  readonly labelStyle: Readonly<TextStyle>;
  readonly areaStyle: Readonly<TextStyle>;
  readonly gridStyle: Readonly<GridStyle>;
}

// ─── Default Styles ─────────────────────────────────────────────────────────

const DEFAULT_WALL_STYLES: Readonly<Record<string, WallStyle>> = {
  [WallType.External]: { fill: '#1a1a1a', stroke: '#1a1a1a', strokeWidth: 0.5 },
  [WallType.Internal]: { fill: '#333333', stroke: '#333333', strokeWidth: 0.5 },
  [WallType.Partition]: { fill: '#666666', stroke: '#666666', strokeWidth: 0.5 },
};

const DEFAULT_ROOM_STYLES: Readonly<Record<string, RoomStyle>> = {
  [RoomType.Bedroom]:        { fill: '#E3F2FD', fillOpacity: 0.6 },
  [RoomType.Bathroom]:       { fill: '#E8F5E9', fillOpacity: 0.6 },
  [RoomType.Kitchen]:        { fill: '#FFF3E0', fillOpacity: 0.6 },
  [RoomType.Living]:         { fill: '#F3E5F5', fillOpacity: 0.6 },
  [RoomType.Dining]:         { fill: '#FFFDE7', fillOpacity: 0.6 },
  [RoomType.Corridor]:       { fill: '#ECEFF1', fillOpacity: 0.6 },
  [RoomType.Staircase]:      { fill: '#EFEBE9', fillOpacity: 0.6 },
  [RoomType.Lift]:           { fill: '#E1F5FE', fillOpacity: 0.6 },
  [RoomType.Balcony]:        { fill: '#E0F7FA', fillOpacity: 0.6 },
  [RoomType.Parking]:        { fill: '#F5F5F5', fillOpacity: 0.6 },
  [RoomType.Pooja]:          { fill: '#FCE4EC', fillOpacity: 0.6 },
  [RoomType.Utility]:        { fill: '#FAFAFA', fillOpacity: 0.6 },
  [RoomType.Foyer]:          { fill: '#E8EAF6', fillOpacity: 0.6 },
  [RoomType.Study]:          { fill: '#E0F2F1', fillOpacity: 0.6 },
  [RoomType.Storage]:        { fill: '#F5F5F5', fillOpacity: 0.6 },
  [RoomType.ServiceShaft]:    { fill: '#F1F5F4', fillOpacity: 0.6 },
  [RoomType.ServantQuarter]: { fill: '#FBE9E7', fillOpacity: 0.6 },
  [RoomType.Drawing]:        { fill: '#EDE7F6', fillOpacity: 0.6 },
  [RoomType.FamilyLiving]:   { fill: '#F3E5F5', fillOpacity: 0.6 },
  [RoomType.Terrace]:        { fill: '#E0F7FA', fillOpacity: 0.6 },
  [RoomType.Garden]:         { fill: '#E8F5E9', fillOpacity: 0.6 },
  [RoomType.OTS]:            { fill: '#E0F7FA', fillOpacity: 0.6 },
  [RoomType.Porch]:          { fill: '#EDE7F6', fillOpacity: 0.6 },
  [RoomType.Dressing]:       { fill: '#FCE4EC', fillOpacity: 0.6 },
  [RoomType.Custom]:         { fill: '#F5F5F5', fillOpacity: 0.6 },
};

const DEFAULT_DOOR_STYLE: Readonly<DoorStyle> = {
  stroke: '#0066cc',
  strokeWidth: 0.8,
  arcFill: 'none',
};

const DEFAULT_WINDOW_STYLE: Readonly<WindowStyle> = {
  stroke: '#4488cc',
  strokeWidth: 1,
  glassStroke: '#4488cc',
};

const DEFAULT_COLUMN_STYLE: Readonly<ColumnStyle> = {
  fill: '#D5D5D5',
  stroke: '#333333',
  strokeWidth: 1,
  hatchStroke: '#999999',
};

const DEFAULT_DIMENSION_STYLE: Readonly<DimensionStyle> = {
  lineColor: '#0066cc',
  lineWidth: 0.5,
  textColor: '#0066cc',
  fontSize: 9,
  tickLength: 6,
};

const DEFAULT_LABEL_STYLE: Readonly<TextStyle> = {
  color: '#333',
  fontSize: 14,
  fontWeight: '600',
};

const DEFAULT_AREA_STYLE: Readonly<TextStyle> = {
  color: '#666',
  fontSize: 12,
  fontWeight: '400',
};

const DEFAULT_GRID_STYLE: Readonly<GridStyle> = {
  stroke: '#f0f0f0',
  strokeWidth: 0.5,
};

const DEFAULT_LAYERS: Readonly<Record<RenderLayer, boolean>> = {
  [RenderLayer.Grid]: true,
  [RenderLayer.Plot]: true,
  [RenderLayer.SiteZones]: true,
  [RenderLayer.Floor]: true,
  [RenderLayer.Rooms]: true,
  [RenderLayer.Walls]: true,
  [RenderLayer.Openings]: true,
  [RenderLayer.Stairs]: true,
  [RenderLayer.Columns]: true,
  [RenderLayer.Furniture]: true, // Illustrative nominal symbols, not canonical furnishing.
  [RenderLayer.Annotations]: true,
  [RenderLayer.Selection]: false, // Interactive only
  [RenderLayer.Guides]: false,    // Interactive only
};

// ─── Default Configuration ──────────────────────────────────────────────────

/**
 * The canonical default render configuration.
 * Preserves the existing renderer's expected behavior.
 * This object is deeply frozen — it cannot be mutated.
 */
export const DEFAULT_RENDER_CONFIG: Readonly<RenderConfig> = Object.freeze({
  // Layer visibility
  layers: Object.freeze({ ...DEFAULT_LAYERS }),

  // Display options — match current renderer defaults
  showDimensions: true,
  showRoomLabels: true,
  showRoomAreas: true,
  showNorthArrow: true,
  showScaleBar: false,    // New feature — off by default for backward compat
  showGrid: true,
  showTitleBlock: false,   // New feature — off by default for backward compat

  // Units
  displayUnit: 'ft' as DisplayUnit,

  // Typography
  fontFamily: 'Inter, Arial, sans-serif',

  // Grid
  gridSpacing: 1000, // 1m grid spacing in world mm

  // Styles
  wallStyles: Object.freeze({ ...DEFAULT_WALL_STYLES }),
  roomStyles: Object.freeze({ ...DEFAULT_ROOM_STYLES }),
  doorStyle: Object.freeze({ ...DEFAULT_DOOR_STYLE }),
  windowStyle: Object.freeze({ ...DEFAULT_WINDOW_STYLE }),
  columnStyle: Object.freeze({ ...DEFAULT_COLUMN_STYLE }),
  dimensionStyle: Object.freeze({ ...DEFAULT_DIMENSION_STYLE }),
  labelStyle: Object.freeze({ ...DEFAULT_LABEL_STYLE }),
  areaStyle: Object.freeze({ ...DEFAULT_AREA_STYLE }),
  gridStyle: Object.freeze({ ...DEFAULT_GRID_STYLE }),
});

// ─── Config Merging ─────────────────────────────────────────────────────────

/**
 * Safely merge a partial configuration override into the default config.
 * Returns a new frozen config — never mutates the default or input.
 *
 * Supports nested overrides for style objects:
 *   mergeConfig({ wallStyles: { external: { fill: '#000' } } })
 *   → merges the external wall style, keeps other wall styles from default.
 */
export function mergeConfig(overrides: DeepPartial<RenderConfig>): Readonly<RenderConfig> {
  const merged: RenderConfig = {
    // Layer visibility
    layers: Object.freeze({
      ...DEFAULT_RENDER_CONFIG.layers,
      ...(overrides.layers ?? {}),
    }),

    // Display options
    showDimensions: overrides.showDimensions ?? DEFAULT_RENDER_CONFIG.showDimensions,
    showRoomLabels: overrides.showRoomLabels ?? DEFAULT_RENDER_CONFIG.showRoomLabels,
    showRoomAreas: overrides.showRoomAreas ?? DEFAULT_RENDER_CONFIG.showRoomAreas,
    showNorthArrow: overrides.showNorthArrow ?? DEFAULT_RENDER_CONFIG.showNorthArrow,
    showScaleBar: overrides.showScaleBar ?? DEFAULT_RENDER_CONFIG.showScaleBar,
    showGrid: overrides.showGrid ?? DEFAULT_RENDER_CONFIG.showGrid,
    showTitleBlock: overrides.showTitleBlock ?? DEFAULT_RENDER_CONFIG.showTitleBlock,

    // Units
    displayUnit: overrides.displayUnit ?? DEFAULT_RENDER_CONFIG.displayUnit,

    // Typography
    fontFamily: overrides.fontFamily ?? DEFAULT_RENDER_CONFIG.fontFamily,

    // Grid
    gridSpacing: overrides.gridSpacing ?? DEFAULT_RENDER_CONFIG.gridSpacing,

    // Styles — deep merge each style category
    wallStyles: Object.freeze(mergeRecordStyle(
      DEFAULT_RENDER_CONFIG.wallStyles,
      overrides.wallStyles,
    )),
    roomStyles: Object.freeze(mergeRecordStyle(
      DEFAULT_RENDER_CONFIG.roomStyles,
      overrides.roomStyles,
    )),
    doorStyle: Object.freeze({
      ...DEFAULT_RENDER_CONFIG.doorStyle,
      ...(overrides.doorStyle ?? {}),
    }),
    windowStyle: Object.freeze({
      ...DEFAULT_RENDER_CONFIG.windowStyle,
      ...(overrides.windowStyle ?? {}),
    }),
    columnStyle: Object.freeze({
      ...DEFAULT_RENDER_CONFIG.columnStyle,
      ...(overrides.columnStyle ?? {}),
    }),
    dimensionStyle: Object.freeze({
      ...DEFAULT_RENDER_CONFIG.dimensionStyle,
      ...(overrides.dimensionStyle ?? {}),
    }),
    labelStyle: Object.freeze({
      ...DEFAULT_RENDER_CONFIG.labelStyle,
      ...(overrides.labelStyle ?? {}),
    }),
    areaStyle: Object.freeze({
      ...DEFAULT_RENDER_CONFIG.areaStyle,
      ...(overrides.areaStyle ?? {}),
    }),
    gridStyle: Object.freeze({
      ...DEFAULT_RENDER_CONFIG.gridStyle,
      ...(overrides.gridStyle ?? {}),
    }),
  };

  return Object.freeze(merged);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Deep partial type — allows nested partial overrides.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Merge a record of styles, preserving defaults for keys not overridden.
 * Each individual style object is shallowly merged.
 */
function mergeRecordStyle<T extends object>(
  defaults: Readonly<Record<string, T>>,
  overrides?: DeepPartial<Record<string, T>>,
): Record<string, T> {
  if (!overrides) return { ...defaults };

  const result: Record<string, T> = { ...defaults };
  for (const key of Object.keys(overrides)) {
    if (key in result) {
      result[key] = { ...result[key]!, ...(overrides[key] as Partial<T>) } as T;
    } else {
      result[key] = overrides[key] as unknown as T;
    }
  }
  return result;
}

/**
 * Resolve the effective render config from an optional override.
 * If no override is provided, returns DEFAULT_RENDER_CONFIG.
 * If a partial override is provided, merges it with defaults.
 */
export function resolveConfig(config?: Readonly<RenderConfig> | DeepPartial<RenderConfig>): Readonly<RenderConfig> {
  if (!config) return DEFAULT_RENDER_CONFIG;

  // If it looks like a full config (has all required top-level keys), return it directly
  if (isFullConfig(config)) return config as Readonly<RenderConfig>;

  // Otherwise, merge partial overrides
  return mergeConfig(config as DeepPartial<RenderConfig>);
}

/**
 * Check if a config object has all required top-level keys of RenderConfig.
 */
function isFullConfig(config: object): boolean {
  const requiredKeys: (keyof RenderConfig)[] = [
    'layers', 'showDimensions', 'showRoomLabels', 'showRoomAreas',
    'showNorthArrow', 'showScaleBar', 'showGrid', 'showTitleBlock',
    'displayUnit', 'fontFamily', 'gridSpacing',
    'wallStyles', 'roomStyles', 'doorStyle', 'windowStyle',
    'columnStyle', 'dimensionStyle', 'labelStyle', 'areaStyle', 'gridStyle',
  ];
  return requiredKeys.every(key => key in config);
}

// ─── Unit Formatting ────────────────────────────────────────────────────────

/**
 * Format a length value (in mm) for display based on the configured unit.
 */
export function formatLength(mm: number, unit: DisplayUnit): string {
  switch (unit) {
    case 'mm': return `${Math.round(mm)} mm`;
    case 'm':  return `${(mm / 1000).toFixed(1)} m`;
    case 'ft': return `${(mm / 304.8).toFixed(1)}'`;
  }
}

/**
 * Format an area value (in sq mm) for display based on the configured unit.
 */
export function formatArea(sqMm: number, unit: DisplayUnit): string {
  switch (unit) {
    case 'mm': return `${Math.round(sqMm)} sq mm`;
    case 'm':  return `${(sqMm / 1_000_000).toFixed(1)} sq m`;
    case 'ft': return `${(sqMm / 92_903).toFixed(1)} sq ft`;
  }
}

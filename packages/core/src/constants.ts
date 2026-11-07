/**
 * Default values, tolerances, and minimum sizes.
 * All measurements in millimeters (mm) unless otherwise noted.
 */

/** Default dimensions for architectural elements. */
export const DEFAULTS = {
  WALL_THICKNESS_EXTERNAL: 230,    // mm
  WALL_THICKNESS_INTERNAL: 150,    // mm
  WALL_THICKNESS_PARTITION: 115,   // mm
  WALL_THICKNESS_PARTY: 230,       // mm
  WALL_THICKNESS_CORRIDOR: 150,    // mm
  WALL_THICKNESS_SHAFT: 100,       // mm
  FLOOR_HEIGHT: 3000,              // mm (floor-to-floor)
  DOOR_WIDTH: 900,                 // mm
  DOOR_WIDTH_MAIN_ENTRANCE: 1050,  // mm
  DOOR_WIDTH_HABITABLE: 900,       // mm
  DOOR_WIDTH_SERVICE: 750,         // mm
  DOOR_HEIGHT: 2100,               // mm
  BALCONY_MIN_DEPTH: 1200,         // mm
  BALCONY_TARGET_DEPTH: 1570,      // mm
  WINDOW_WIDTH: 1200,              // mm
  WINDOW_HEIGHT: 1200,             // mm
  WINDOW_SILL_HEIGHT: 900,         // mm
  COLUMN_WIDTH: 300,               // mm
  COLUMN_DEPTH: 300,               // mm
  RISER_HEIGHT: 175,               // mm
  TREAD_DEPTH: 250,                // mm
  STAIR_WIDTH: 1000,               // mm
} as const;

/** Numerical tolerances for geometry operations. */
export const TOLERANCES = {
  LINEAR: 1,           // mm — minimum meaningful distance
  AREA: 1,             // sq mm — minimum meaningful area
  ANGULAR: 0.01,       // degrees
  ADJACENCY: 5,        // mm — gap below this = adjacent
  OVERLAP: 100,        // sq mm — overlap below this = rounding artifact
} as const;

/**
 * Minimum room areas by type (sq mm).
 * Based on Indian residential building standards.
 */
export const MINIMUM_ROOM_AREAS: Record<string, number> = {
  bedroom: 9_500_000,         // 9.5 sq m
  bedroom_master: 12_000_000, // 12 sq m
  kitchen: 5_000_000,         // 5 sq m
  bathroom: 2_500_000,        // 2.5 sq m
  living: 12_000_000,         // 12 sq m
  dining: 9_000_000,          // 9 sq m
  utility: 3_000_000,         // 3 sq m
  dressing: 3_000_000,        // 3 sq m
  foyer: 3_500_000,           // 3.5 sq m
  porch: 4_000_000,           // 4 sq m
  ots: 1_000_000,             // 1 sq m (Open to Sky shaft)
};

/**
 * Minimum room dimensions by type (mm).
 * The smallest side of a room must meet this minimum.
 */
export const MINIMUM_DIMENSIONS: Record<string, number> = {
  bedroom: 2700,
  bedroom_master: 3000,
  kitchen: 2100,
  bathroom: 1200,
  living: 3000,
  dining: 2700,
  utility: 1200,
  dressing: 1500,
  foyer: 1500,
  porch: 1800,
  ots: 900,
  corridor: 900,
  staircase: 900,
};

/**
 * Unit conversion factors.
 * Internal unit is always millimeters.
 */
export const UNITS = {
  MM_PER_FOOT: 304.8,
  MM_PER_METER: 1000,
  MM_PER_INCH: 25.4,
} as const;

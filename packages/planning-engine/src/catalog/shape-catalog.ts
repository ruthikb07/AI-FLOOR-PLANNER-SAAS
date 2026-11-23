import type {
  BuildingMassingShape,
  NamedBuildingMassingShape,
  ParametricShapeParams,
  PlanCategory,
} from '@ai-floor-planner/core';

export type ShapeFamilyKind = 'CURVED_RADIAL' | 'POLYGONAL_ANGLED' | 'ORTHOGONAL';

export interface BuildingShapeCatalogEntry {
  readonly id: BuildingMassingShape;
  readonly label: string;
  readonly family: ShapeFamilyKind;
  readonly description: string;
  readonly baseTopologyShape:
    | 'COMPACT_DOUBLE_LOADED'
    | 'H_SHAPE_WING'
    | 'U_SHAPE_COURTYARD'
    | 'L_SHAPE_CORNER'
    | 'CRUCIFORM_PLUS'
    | 'PINWHEEL_CLUSTER'
    | 'STEPPED_OFFSET_BLOCK';
  readonly recommendedCategories: readonly PlanCategory[];
  readonly supportsCurves: boolean;
  readonly supportsNonOrthogonal: boolean;
  readonly defaultParams: ParametricShapeParams;
  /** Miniature preview SVG path in a `0 0 80 60` viewBox. */
  readonly svgPath: string;
}

export interface PlanCategoryCatalogEntry {
  readonly id: PlanCategory;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly defaultShapeId: BuildingMassingShape;
  readonly recommendedFlatsPerFloor: 1 | 2 | 3 | 4 | 5 | 6;
  readonly supportsMultiLevelLink: boolean;
  readonly svgPath: string;
}

export const BUILDING_SHAPE_CATALOG: readonly BuildingShapeCatalogEntry[] = [
  // ─── 1. Curved & Radial Shapes (True Arc / Spline Facades) ─────────────────
  {
    id: 'CURVED_CRESCENT',
    label: 'Curved Crescent',
    family: 'CURVED_RADIAL',
    description: 'Sweeping C-arc residential block with radial wedge flats and central curved spine.',
    baseTopologyShape: 'COMPACT_DOUBLE_LOADED',
    recommendedCategories: ['HIGH_RISE_APARTMENT', 'COURTYARD_CLUSTER_HOUSING', 'LUXURY_VILLA_BUNGALOW'],
    supportsCurves: true,
    supportsNonOrthogonal: true,
    defaultParams: { wings: 2, angleDeg: 35, arcSweepDeg: 75, curvatureRadiusMm: 28000, rotationSeed: 1 },
    svgPath: 'M 10 40 A 42 32 0 0 1 70 40 L 63 48 A 32 24 0 0 0 17 48 Z',
  },
  {
    id: 'WAVE_SERPENTINE',
    label: 'Wave Serpentine',
    family: 'CURVED_RADIAL',
    description: 'S-curve undulating facade with alternating convex and concave living balconies.',
    baseTopologyShape: 'STEPPED_OFFSET_BLOCK',
    recommendedCategories: ['HIGH_RISE_APARTMENT', 'DUPLEX_TRIPLEX_SKY_VILLA'],
    supportsCurves: true,
    supportsNonOrthogonal: true,
    defaultParams: { wings: 3, angleDeg: 25, arcSweepDeg: 60, curvatureRadiusMm: 20000, rotationSeed: 2 },
    svgPath: 'M 8 22 Q 24 8 40 22 T 72 22 L 72 38 Q 56 50 40 38 T 8 38 Z',
  },
  {
    id: 'ROTUNDA_COURTYARD',
    label: 'Rotunda Courtyard',
    family: 'CURVED_RADIAL',
    description: 'Circular annular ring perimeter arranged around a sunlit central garden atrium.',
    baseTopologyShape: 'U_SHAPE_COURTYARD',
    recommendedCategories: ['COURTYARD_CLUSTER_HOUSING', 'HIGH_RISE_APARTMENT', 'LUXURY_VILLA_BUNGALOW'],
    supportsCurves: true,
    supportsNonOrthogonal: true,
    defaultParams: { wings: 4, angleDeg: 90, arcSweepDeg: 360, curvatureRadiusMm: 22000, rotationSeed: 3 },
    svgPath: 'M 40 6 A 24 24 0 1 1 39.9 6 Z M 40 19 A 11 11 0 1 0 40.1 19 Z',
  },
  {
    id: 'ELLIPTICAL_TOWER',
    label: 'Elliptical Tower',
    family: 'CURVED_RADIAL',
    description: 'Aerodynamic oval core-and-wing tower with smooth curved radial perimeter rooms.',
    baseTopologyShape: 'COMPACT_DOUBLE_LOADED',
    recommendedCategories: ['HIGH_RISE_APARTMENT', 'DUPLEX_TRIPLEX_SKY_VILLA'],
    supportsCurves: true,
    supportsNonOrthogonal: true,
    defaultParams: { wings: 4, angleDeg: 90, arcSweepDeg: 140, curvatureRadiusMm: 24000, rotationSeed: 4 },
    svgPath: 'M 40 10 A 30 20 0 1 1 39.9 10 Z',
  },
  {
    id: 'LOTUS_PETAL_RADIAL',
    label: 'Lotus Petal Radial',
    family: 'CURVED_RADIAL',
    description: 'Central circular core ringed by curved petal apartment wings for panoramic daylight.',
    baseTopologyShape: 'CRUCIFORM_PLUS',
    recommendedCategories: ['HIGH_RISE_APARTMENT', 'DUPLEX_TRIPLEX_SKY_VILLA', 'LUXURY_VILLA_BUNGALOW'],
    supportsCurves: true,
    supportsNonOrthogonal: true,
    defaultParams: { wings: 4, angleDeg: 90, arcSweepDeg: 110, curvatureRadiusMm: 16000, rotationSeed: 5 },
    svgPath: 'M 40 8 Q 52 8 50 22 Q 66 20 66 30 Q 66 40 50 38 Q 52 52 40 52 Q 28 52 30 38 Q 14 40 14 30 Q 14 20 30 22 Q 28 8 40 8 Z',
  },
  {
    id: 'BOWFRONT_CHAMFERED',
    label: 'Bowfront Chamfered',
    family: 'CURVED_RADIAL',
    description: 'Orthogonal double-loaded spine articulated with sweeping bow-front living bays and chamfered corners.',
    baseTopologyShape: 'COMPACT_DOUBLE_LOADED',
    recommendedCategories: ['HIGH_RISE_APARTMENT', 'ROW_HOUSE_TOWNHOUSE', 'LUXURY_VILLA_BUNGALOW'],
    supportsCurves: true,
    supportsNonOrthogonal: true,
    defaultParams: { wings: 2, angleDeg: 45, arcSweepDeg: 65, curvatureRadiusMm: 18000, rotationSeed: 6 },
    svgPath: 'M 14 16 L 26 16 Q 40 6 54 16 L 66 16 L 72 24 L 72 36 L 66 44 L 54 44 Q 40 54 26 44 L 14 44 L 8 36 L 8 24 Z',
  },

  // ─── 2. Polygonal & Angled Wing Shapes ─────────────────────────────────────
  {
    id: 'TRIANGULAR_ATRIUM',
    label: 'Triangular Atrium',
    family: 'POLYGONAL_ANGLED',
    description: 'Tapered triangular massing perimeter angled around a bright central OTS courtyard.',
    baseTopologyShape: 'U_SHAPE_COURTYARD',
    recommendedCategories: ['IRREGULAR_PLOT_CUSTOM', 'HIGH_RISE_APARTMENT', 'COURTYARD_CLUSTER_HOUSING'],
    supportsCurves: false,
    supportsNonOrthogonal: true,
    defaultParams: { wings: 3, angleDeg: 60, setbackStepRatio: 0.45, rotationSeed: 7 },
    svgPath: 'M 40 8 L 70 50 L 10 50 Z M 40 26 L 49 41 L 31 41 Z',
  },
  {
    id: 'Y_SHAPE_TRISKELE',
    label: 'Y-Shape Triskele',
    family: 'POLYGONAL_ANGLED',
    description: 'Three 120-degree splayed radial wings radiating around a compact central lift/stair core.',
    baseTopologyShape: 'H_SHAPE_WING',
    recommendedCategories: ['HIGH_RISE_APARTMENT', 'DUPLEX_TRIPLEX_SKY_VILLA'],
    supportsCurves: false,
    supportsNonOrthogonal: true,
    defaultParams: { wings: 3, angleDeg: 120, setbackStepRatio: 0.3, rotationSeed: 8 },
    svgPath: 'M 10 14 L 22 8 L 40 24 L 58 8 L 70 14 L 48 34 L 48 54 L 32 54 L 32 34 Z',
  },
  {
    id: 'BUTTERFLY_V_WING',
    label: 'Butterfly V-Wing',
    family: 'POLYGONAL_ANGLED',
    description: 'Twin splayed 45-degree angled wings capturing cross breeze and open panoramic vistas.',
    baseTopologyShape: 'U_SHAPE_COURTYARD',
    recommendedCategories: ['HIGH_RISE_APARTMENT', 'LUXURY_VILLA_BUNGALOW', 'DUPLEX_TRIPLEX_SKY_VILLA'],
    supportsCurves: false,
    supportsNonOrthogonal: true,
    defaultParams: { wings: 2, angleDeg: 45, setbackStepRatio: 0.28, rotationSeed: 9 },
    svgPath: 'M 8 16 L 22 10 L 40 24 L 58 10 L 72 16 L 64 46 L 40 38 L 16 46 Z',
  },
  {
    id: 'HEXAGONAL_HONEYCOMB',
    label: 'Hexagonal Honeycomb',
    family: 'POLYGONAL_ANGLED',
    description: 'Six-sided faceted honeycomb cluster providing panoramic dual-aspect corners.',
    baseTopologyShape: 'COMPACT_DOUBLE_LOADED',
    recommendedCategories: ['COURTYARD_CLUSTER_HOUSING', 'HIGH_RISE_APARTMENT'],
    supportsCurves: false,
    supportsNonOrthogonal: true,
    defaultParams: { wings: 6, angleDeg: 60, setbackStepRatio: 0.25, rotationSeed: 10 },
    svgPath: 'M 22 10 L 58 10 L 72 30 L 58 50 L 22 50 L 8 30 Z',
  },
  {
    id: 'TRAPEZOIDAL_TAPERED',
    label: 'Trapezoidal Tapered',
    family: 'POLYGONAL_ANGLED',
    description: 'Plot-adaptive tapered wedge envelope hugging irregular site road frontages.',
    baseTopologyShape: 'L_SHAPE_CORNER',
    recommendedCategories: ['IRREGULAR_PLOT_CUSTOM', 'ROW_HOUSE_TOWNHOUSE', 'HIGH_RISE_APARTMENT'],
    supportsCurves: false,
    supportsNonOrthogonal: true,
    defaultParams: { wings: 2, angleDeg: 72, setbackStepRatio: 0.4, rotationSeed: 11 },
    svgPath: 'M 14 14 L 52 10 L 70 48 L 10 48 Z',
  },
  {
    id: 'DIAGONAL_ZIGZAG',
    label: 'Diagonal Zigzag',
    family: 'POLYGONAL_ANGLED',
    description: 'Chevron sawtooth faceted exterior bays granting 3-sided natural ventilation to every residence.',
    baseTopologyShape: 'STEPPED_OFFSET_BLOCK',
    recommendedCategories: ['HIGH_RISE_APARTMENT', 'ROW_HOUSE_TOWNHOUSE', 'DUPLEX_TRIPLEX_SKY_VILLA'],
    supportsCurves: false,
    supportsNonOrthogonal: true,
    defaultParams: { wings: 4, angleDeg: 45, setbackStepRatio: 0.32, rotationSeed: 12 },
    svgPath: 'M 8 18 L 24 10 L 40 20 L 56 10 L 72 20 L 72 44 L 56 52 L 40 42 L 24 52 L 8 42 Z',
  },

  // ─── 3. Classic & Articulated Orthogonal Shapes (Retained & Enhanced) ──────
  {
    id: 'COMPACT_DOUBLE_LOADED',
    label: 'Compact Block',
    family: 'ORTHOGONAL',
    description: 'Efficient double-loaded rectangular block maximizing FSI carpet yield.',
    baseTopologyShape: 'COMPACT_DOUBLE_LOADED',
    recommendedCategories: ['HIGH_RISE_APARTMENT', 'ROW_HOUSE_TOWNHOUSE'],
    supportsCurves: false,
    supportsNonOrthogonal: false,
    defaultParams: { wings: 2, angleDeg: 90, setbackStepRatio: 0, rotationSeed: 13 },
    svgPath: 'M 10 12 L 70 12 L 70 48 L 10 48 Z',
  },
  {
    id: 'H_SHAPE_WING',
    label: 'H-Shape Wing',
    family: 'ORTHOGONAL',
    description: 'Symmetric twin wings separated by sunlit north and south ventilation light wells.',
    baseTopologyShape: 'H_SHAPE_WING',
    recommendedCategories: ['HIGH_RISE_APARTMENT', 'COURTYARD_CLUSTER_HOUSING'],
    supportsCurves: false,
    supportsNonOrthogonal: false,
    defaultParams: { wings: 4, angleDeg: 90, setbackStepRatio: 0.25, rotationSeed: 14 },
    svgPath: 'M 10 10 L 30 10 L 30 22 L 50 22 L 50 10 L 70 10 L 70 50 L 50 50 L 50 38 L 30 38 L 30 50 L 10 50 Z',
  },
  {
    id: 'U_SHAPE_COURTYARD',
    label: 'U-Shape Courtyard',
    family: 'ORTHOGONAL',
    description: 'Three wings framing an open-to-sky landscaped courtyard and cross-breeze channel.',
    baseTopologyShape: 'U_SHAPE_COURTYARD',
    recommendedCategories: ['COURTYARD_CLUSTER_HOUSING', 'HIGH_RISE_APARTMENT', 'LUXURY_VILLA_BUNGALOW'],
    supportsCurves: false,
    supportsNonOrthogonal: false,
    defaultParams: { wings: 3, angleDeg: 90, setbackStepRatio: 0.3, rotationSeed: 15 },
    svgPath: 'M 10 10 L 28 10 L 28 34 L 52 34 L 52 10 L 70 10 L 70 50 L 10 50 Z',
  },
  {
    id: 'L_SHAPE_CORNER',
    label: 'L-Shape Corner',
    family: 'ORTHOGONAL',
    description: 'Dual perpendicular street-hugging wings opening a generous corner setback lawn.',
    baseTopologyShape: 'L_SHAPE_CORNER',
    recommendedCategories: ['IRREGULAR_PLOT_CUSTOM', 'LUXURY_VILLA_BUNGALOW', 'HIGH_RISE_APARTMENT'],
    supportsCurves: false,
    supportsNonOrthogonal: false,
    defaultParams: { wings: 2, angleDeg: 90, setbackStepRatio: 0.35, rotationSeed: 16 },
    svgPath: 'M 10 10 L 36 10 L 36 30 L 70 30 L 70 50 L 10 50 Z',
  },
  {
    id: 'CRUCIFORM_PLUS',
    label: 'Cruciform Plus',
    family: 'ORTHOGONAL',
    description: 'Four cardinal corner cutouts creating 3-sided daylight exposure for corner flats.',
    baseTopologyShape: 'CRUCIFORM_PLUS',
    recommendedCategories: ['HIGH_RISE_APARTMENT', 'DUPLEX_TRIPLEX_SKY_VILLA'],
    supportsCurves: false,
    supportsNonOrthogonal: false,
    defaultParams: { wings: 4, angleDeg: 90, setbackStepRatio: 0.3, rotationSeed: 17 },
    svgPath: 'M 26 8 L 54 8 L 54 20 L 70 20 L 70 40 L 54 40 L 54 52 L 26 52 L 26 40 L 10 40 L 10 20 L 26 20 Z',
  },
  {
    id: 'PINWHEEL_CLUSTER',
    label: 'Pinwheel Cluster',
    family: 'ORTHOGONAL',
    description: 'Swirling offset wings granting unobstructed diagonal view corridors per unit.',
    baseTopologyShape: 'PINWHEEL_CLUSTER',
    recommendedCategories: ['HIGH_RISE_APARTMENT', 'COURTYARD_CLUSTER_HOUSING'],
    supportsCurves: false,
    supportsNonOrthogonal: false,
    defaultParams: { wings: 4, angleDeg: 90, setbackStepRatio: 0.25, rotationSeed: 18 },
    svgPath: 'M 14 10 L 50 10 L 50 22 L 70 22 L 70 48 L 32 48 L 32 36 L 14 36 Z',
  },
  {
    id: 'STEPPED_OFFSET_BLOCK',
    label: 'Stepped Offset Block',
    family: 'ORTHOGONAL',
    description: 'Articulated staggered facades creating deep sky-terrace sitouts and shadow relief.',
    baseTopologyShape: 'STEPPED_OFFSET_BLOCK',
    recommendedCategories: ['HIGH_RISE_APARTMENT', 'DUPLEX_TRIPLEX_SKY_VILLA'],
    supportsCurves: false,
    supportsNonOrthogonal: false,
    defaultParams: { wings: 3, angleDeg: 90, setbackStepRatio: 0.28, rotationSeed: 19 },
    svgPath: 'M 10 14 L 46 14 L 46 8 L 70 8 L 70 44 L 36 44 L 36 52 L 10 52 Z',
  },
  {
    id: 'T_SHAPE_SPINE',
    label: 'T-Shape Spine',
    family: 'ORTHOGONAL',
    description: 'Wide main boulevard bar anchored by an orthogonal rear residential wing.',
    baseTopologyShape: 'H_SHAPE_WING',
    recommendedCategories: ['HIGH_RISE_APARTMENT', 'ROW_HOUSE_TOWNHOUSE', 'LUXURY_VILLA_BUNGALOW'],
    supportsCurves: false,
    supportsNonOrthogonal: false,
    defaultParams: { wings: 3, angleDeg: 90, setbackStepRatio: 0.35, rotationSeed: 20 },
    svgPath: 'M 10 10 L 70 10 L 70 28 L 52 28 L 52 52 L 28 52 L 28 28 L 10 28 Z',
  },
  {
    id: 'O_SHAPE_PERIMETER_COURT',
    label: 'O-Shape Perimeter Court',
    family: 'ORTHOGONAL',
    description: 'Enclosed orthogonal ring perimeter organized around a sunlit interior garden court.',
    baseTopologyShape: 'U_SHAPE_COURTYARD',
    recommendedCategories: ['COURTYARD_CLUSTER_HOUSING', 'HIGH_RISE_APARTMENT'],
    supportsCurves: false,
    supportsNonOrthogonal: false,
    defaultParams: { wings: 4, angleDeg: 90, setbackStepRatio: 0.3, rotationSeed: 21 },
    svgPath: 'M 10 10 L 70 10 L 70 50 L 10 50 Z M 28 22 L 52 22 L 52 38 L 28 38 Z',
  },
  {
    id: 'IRREGULAR_ANGLED_PLOT',
    label: 'Irregular / CAD Site Fit',
    family: 'POLYGONAL_ANGLED',
    description: 'Custom setback-fitted footprint inscribed cleanly within an irregular or imported CAD site polygon.',
    baseTopologyShape: 'COMPACT_DOUBLE_LOADED',
    recommendedCategories: ['IRREGULAR_PLOT_CUSTOM', 'HIGH_RISE_APARTMENT', 'LUXURY_VILLA_BUNGALOW'],
    supportsCurves: false,
    supportsNonOrthogonal: true,
    defaultParams: { wings: 2, angleDeg: 80, setbackStepRatio: 0.18, rotationSeed: 22 },
    svgPath: 'M 12 14 L 62 8 L 70 46 L 18 52 Z',
  },
];

export const PLAN_CATEGORY_CATALOG: readonly PlanCategoryCatalogEntry[] = [
  {
    id: 'HIGH_RISE_APARTMENT',
    label: 'High-Rise Apartment Tower',
    shortLabel: 'Apartment Tower',
    description: 'Multi-unit G+4 to G+20 floors around lift/stair cores with inter-flat OTS ducts.',
    defaultShapeId: 'CURVED_CRESCENT',
    recommendedFlatsPerFloor: 4,
    supportsMultiLevelLink: false,
    svgPath: 'M 14 14 L 66 14 L 66 46 L 14 46 Z M 34 14 L 34 46 M 46 14 L 46 46',
  },
  {
    id: 'LUXURY_VILLA_BUNGALOW',
    label: 'Luxury Villa / Bungalow',
    shortLabel: 'Luxury Villa',
    description: 'Independent G+1 / G+2 villa with spacious living terraces, private lawn & feature stair.',
    defaultShapeId: 'L_SHAPE_CORNER',
    recommendedFlatsPerFloor: 1,
    supportsMultiLevelLink: true,
    svgPath: 'M 12 12 L 42 12 L 42 28 L 68 28 L 68 48 L 12 48 Z',
  },
  {
    id: 'DUPLEX_TRIPLEX_SKY_VILLA',
    label: 'Duplex / Triplex Sky Villa',
    shortLabel: 'Duplex / Triplex',
    description: 'Vertically linked multi-level sky residences with internal stairs and terraced sitouts.',
    defaultShapeId: 'BUTTERFLY_V_WING',
    recommendedFlatsPerFloor: 2,
    supportsMultiLevelLink: true,
    svgPath: 'M 10 16 L 26 10 L 40 22 L 54 10 L 70 16 L 64 46 L 40 38 L 16 46 Z',
  },
  {
    id: 'ROW_HOUSE_TOWNHOUSE',
    label: 'Row House / Townhouse',
    shortLabel: 'Townhouse',
    description: 'Repeatable modular terrace homes sharing party walls with front & rear courts.',
    defaultShapeId: 'COMPACT_DOUBLE_LOADED',
    recommendedFlatsPerFloor: 4,
    supportsMultiLevelLink: true,
    svgPath: 'M 10 14 L 25 14 L 25 46 L 10 46 Z M 25 14 L 40 14 L 40 46 L 25 46 Z M 40 14 L 55 14 L 55 46 L 40 46 Z M 55 14 L 70 14 L 70 46 L 55 46 Z',
  },
  {
    id: 'COURTYARD_CLUSTER_HOUSING',
    label: 'Courtyard Cluster Housing',
    shortLabel: 'Courtyard Cluster',
    description: 'Flats arranged around a shaded landscaped OTS atrium courtyard for natural cooling.',
    defaultShapeId: 'ROTUNDA_COURTYARD',
    recommendedFlatsPerFloor: 4,
    supportsMultiLevelLink: false,
    svgPath: 'M 40 8 A 24 22 0 1 1 39.9 8 Z M 40 20 A 10 10 0 1 0 40.1 20 Z',
  },
  {
    id: 'IRREGULAR_PLOT_CUSTOM',
    label: 'Irregular Plot Custom Envelope',
    shortLabel: 'Irregular Plot',
    description: 'Tapered & polygon-fitting massing wrapping trapezoidal or angled plot setbacks.',
    defaultShapeId: 'TRAPEZOIDAL_TAPERED',
    recommendedFlatsPerFloor: 3,
    supportsMultiLevelLink: false,
    svgPath: 'M 14 14 L 54 8 L 70 48 L 10 48 Z',
  },
];

export const ALL_NAMED_SHAPE_IDS: readonly NamedBuildingMassingShape[] = BUILDING_SHAPE_CATALOG.map(
  s => s.id as NamedBuildingMassingShape,
);

const SHAPE_BY_ID = new Map<string, BuildingShapeCatalogEntry>(
  BUILDING_SHAPE_CATALOG.map(entry => [entry.id, entry]),
);

const CATEGORY_BY_ID = new Map<PlanCategory, PlanCategoryCatalogEntry>(
  PLAN_CATEGORY_CATALOG.map(entry => [entry.id, entry]),
);

export function getPlanCategoryEntry(category?: PlanCategory): PlanCategoryCatalogEntry {
  return (category && CATEGORY_BY_ID.get(category)) ?? PLAN_CATEGORY_CATALOG[0]!;
}

/**
 * Dynamically synthesize an N-shape parametric variant from continuous wing,
 * angle, curvature and step parameters so the catalog supports arbitrary N shapes.
 */
export function synthesizeParametricShape(params: ParametricShapeParams): BuildingShapeCatalogEntry {
  const wings = Math.max(2, Math.min(8, Math.round(params.wings ?? 3)));
  const angleDeg = Math.max(30, Math.min(180, Math.round(params.angleDeg ?? 120)));
  const curvatureRadiusMm = Math.max(6000, Math.min(60000, Math.round(params.curvatureRadiusMm ?? 22000)));
  const arcSweepDeg = Math.max(0, Math.min(360, Math.round(params.arcSweepDeg ?? 60)));
  const stepRatio = Math.max(0.05, Math.min(0.6, Number((params.setbackStepRatio ?? 0.25).toFixed(2))));
  const seed = Math.max(1, Math.round(params.rotationSeed ?? 1));

  const id: BuildingMassingShape = `PARAM_W${wings}_A${angleDeg}_C${arcSweepDeg}_R${Math.round(curvatureRadiusMm / 1000)}K_S${seed}`;
  const supportsCurves = arcSweepDeg > 10;
  const supportsNonOrthogonal = angleDeg !== 90 || supportsCurves;
  const family: ShapeFamilyKind = supportsCurves
    ? 'CURVED_RADIAL'
    : supportsNonOrthogonal
      ? 'POLYGONAL_ANGLED'
      : 'ORTHOGONAL';
  const baseTopologyShape =
    wings >= 4
      ? 'CRUCIFORM_PLUS'
      : wings === 3
        ? 'H_SHAPE_WING'
        : supportsCurves
          ? 'COMPACT_DOUBLE_LOADED'
          : 'STEPPED_OFFSET_BLOCK';

  // Generate dynamic SVG preview polygon/arc around viewBox center (40, 30)
  const cx = 40;
  const cy = 30;
  const outerR = 23;
  const innerR = Math.max(8, Math.round(outerR * (1 - stepRatio)));
  const pts: string[] = [];
  const count = wings * 2;
  const baseAngle = ((seed * 37) % 360) * (Math.PI / 180);
  for (let i = 0; i < count; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const th = baseAngle + (Math.PI * 2 * i) / count;
    const px = (cx + r * Math.cos(th)).toFixed(1);
    const py = (cy + r * 0.85 * Math.sin(th)).toFixed(1);
    if (i === 0) pts.push(`M ${px} ${py}`);
    else if (supportsCurves && i % 2 === 1) pts.push(`Q ${cx} ${cy} ${px} ${py}`);
    else pts.push(`L ${px} ${py}`);
  }
  pts.push('Z');

  return {
    id,
    label: `Parametric ${wings}-Wing (${arcSweepDeg}° / ${angleDeg}°)`,
    family,
    description: `Synthesized ${wings}-wing ${supportsCurves ? 'curved-arc' : 'angled-wing'} parametric configuration (${angleDeg}° splay, ${arcSweepDeg}° sweep, R=${Math.round(curvatureRadiusMm / 1000)}m).`,
    baseTopologyShape,
    recommendedCategories: ['HIGH_RISE_APARTMENT', 'DUPLEX_TRIPLEX_SKY_VILLA', 'IRREGULAR_PLOT_CUSTOM'],
    supportsCurves,
    supportsNonOrthogonal,
    defaultParams: { wings, angleDeg, curvatureRadiusMm, arcSweepDeg, setbackStepRatio: stepRatio, rotationSeed: seed },
    svgPath: pts.join(' '),
  };
}

export function getShapeCatalogEntry(id?: BuildingMassingShape | string, fallbackParams?: ParametricShapeParams): BuildingShapeCatalogEntry {
  if (id === 'IMPORTED_CAD_LAYOUT') {
    return {
      id: 'IMPORTED_CAD_LAYOUT',
      label: 'Imported CAD Layout',
      family: 'ORTHOGONAL',
      description: 'Canonical multi-storey building reconstructed directly from an imported local .DXF / .DWG / .PDF floor plan.',
      baseTopologyShape: 'COMPACT_DOUBLE_LOADED',
      recommendedCategories: ['HIGH_RISE_APARTMENT', 'IRREGULAR_PLOT_CUSTOM', 'LUXURY_VILLA_BUNGALOW'],
      supportsCurves: true,
      supportsNonOrthogonal: true,
      defaultParams: { wings: 2, angleDeg: 90, setbackStepRatio: 0.1, rotationSeed: 1 },
      svgPath: 'M 10 12 L 70 12 L 70 48 L 10 48 Z M 35 12 L 35 48 M 10 30 L 70 30',
    };
  }
  if (id && SHAPE_BY_ID.has(id)) {
    return SHAPE_BY_ID.get(id)!;
  }
  if (id && id.startsWith('PARAM_')) {
    const m = id.match(/^PARAM_W(\d+)_A(\d+)_C(\d+)_R(\d+)K_S(\d+)/);
    if (m) {
      return synthesizeParametricShape({
        wings: Number(m[1]),
        angleDeg: Number(m[2]),
        arcSweepDeg: Number(m[3]),
        curvatureRadiusMm: Number(m[4]) * 1000,
        rotationSeed: Number(m[5]),
        ...fallbackParams,
      });
    }
    return synthesizeParametricShape(fallbackParams ?? {});
  }
  if (fallbackParams && Object.keys(fallbackParams).length > 0) {
    return synthesizeParametricShape(fallbackParams);
  }
  return SHAPE_BY_ID.get('COMPACT_DOUBLE_LOADED')!;
}

/**
 * Selects the next distinct building shape strictly excluding any previously
 * generated shape IDs in `usedShapeIds`, cycling across Curved, Polygonal,
 * Orthogonal and synthesized Parametric variants when needed.
 */
export function pickNextNonRepeatingShape(options: {
  readonly requestedShape?: BuildingMassingShape;
  readonly usedShapeIds?: readonly string[];
  readonly planCategory?: PlanCategory;
  readonly seed?: number;
  readonly autoExplore?: boolean;
  readonly shapeParams?: ParametricShapeParams;
}): BuildingShapeCatalogEntry {
  if (options.requestedShape && !options.autoExplore) {
    return getShapeCatalogEntry(options.requestedShape, options.shapeParams);
  }
  const used = new Set(options.usedShapeIds ?? []);
  const seed = Math.max(1, options.seed ?? 1);
  const categoryPreferred = options.planCategory
    ? BUILDING_SHAPE_CATALOG.filter(e => e.recommendedCategories.includes(options.planCategory!))
    : BUILDING_SHAPE_CATALOG;
  const pool = [
    ...categoryPreferred,
    ...BUILDING_SHAPE_CATALOG.filter(e => !categoryPreferred.includes(e)),
  ];
  const freshPool = pool.filter(e => !used.has(e.id));
  if (freshPool.length > 0) {
    // Rotate evenly between families when auto-exploring so back-to-back regenerations feel distinct
    const idx = (seed - 1) % freshPool.length;
    return freshPool[idx]!;
  }
  // All 21 static catalog entries were already used — synthesize a fresh N-parametric shape
  const synth = synthesizeParametricShape({
    wings: 3 + (seed % 5),
    angleDeg: 40 + ((seed * 25) % 130),
    arcSweepDeg: seed % 2 === 0 ? 45 + ((seed * 15) % 90) : 0,
    curvatureRadiusMm: 16000 + ((seed * 3000) % 18000),
    setbackStepRatio: 0.2 + ((seed % 4) * 0.08),
    rotationSeed: seed + used.size,
  });
  return synth;
}

export function inferPlanCategoryFromPrompt(prompt?: string): PlanCategory | undefined {
  if (!prompt) return undefined;
  const lower = prompt.toLowerCase();
  if (/\b(?:luxury\s+villa|bungalow|independent\s+house|independent\s+villa|private\s+villa)\b/.test(lower)) {
    return 'LUXURY_VILLA_BUNGALOW';
  }
  if (/\b(?:duplex|triplex|sky\s+villa|penthouse|double[\s-]height)\b/.test(lower)) {
    return 'DUPLEX_TRIPLEX_SKY_VILLA';
  }
  if (/\b(?:row[\s-]?house|town[\s-]?house|terrace\s+homes?|party[\s-]?wall\s+homes?)\b/.test(lower)) {
    return 'ROW_HOUSE_TOWNHOUSE';
  }
  if (/\b(?:courtyard\s+cluster|cluster\s+housing|garden\s+courtyard\s+flats|rotunda\s+cluster)\b/.test(lower)) {
    return 'COURTYARD_CLUSTER_HOUSING';
  }
  if (/\b(?:irregular\s+plot|trapezoid(?:al)?\s+plot|custom\s+polygon|angled\s+site)\b/.test(lower)) {
    return 'IRREGULAR_PLOT_CUSTOM';
  }
  if (/\b(?:high[\s-]?rise|apartment\s+tower|multi[\s-]?storey|g\s*\+\s*[4-9]|g\s*\+\s*1\d|stilt\s*\+\s*[4-9])\b/.test(lower)) {
    return 'HIGH_RISE_APARTMENT';
  }
  return undefined;
}

export function inferShapeIdFromPrompt(prompt?: string): BuildingMassingShape | undefined {
  if (!prompt) return undefined;
  const lower = prompt.toLowerCase();
  if (/\b(?:curved\s+crescent|crescent|c[\s-]?arc|sweeping\s+arc)\b/.test(lower)) return 'CURVED_CRESCENT';
  if (/\b(?:wave\s+serpentine|serpentine|s[\s-]?curve|undulating)\b/.test(lower)) return 'WAVE_SERPENTINE';
  if (/\b(?:rotunda|circular\s+courtyard|annular\s+ring|round\s+courtyard)\b/.test(lower)) return 'ROTUNDA_COURTYARD';
  if (/\b(?:elliptical|oval\s+tower|ellipse)\b/.test(lower)) return 'ELLIPTICAL_TOWER';
  if (/\b(?:lotus\s+petal|radial\s+petal|flower\s+wing)\b/.test(lower)) return 'LOTUS_PETAL_RADIAL';
  if (/\b(?:bow[\s-]?front|bay[\s-]?arc|chamfered\s+bow)\b/.test(lower)) return 'BOWFRONT_CHAMFERED';
  if (/\b(?:triangular\s+atrium|triangle|triangular)\b/.test(lower)) return 'TRIANGULAR_ATRIUM';
  if (/\b(?:y[\s-]?shape|triskele|120[\s-]?deg|three[\s-]?wing)\b/.test(lower)) return 'Y_SHAPE_TRISKELE';
  if (/\b(?:butterfly|v[\s-]?wing|splayed\s+wing)\b/.test(lower)) return 'BUTTERFLY_V_WING';
  if (/\b(?:hexagonal|honeycomb|six[\s-]?sided)\b/.test(lower)) return 'HEXAGONAL_HONEYCOMB';
  if (/\b(?:trapezoid|trapezoidal|tapered\s+block|tapered)\b/.test(lower)) return 'TRAPEZOIDAL_TAPERED';
  if (/\b(?:zigzag|sawtooth|chevron)\b/.test(lower)) return 'DIAGONAL_ZIGZAG';
  if (/\b(?:t[\s-]?shape|t[\s-]?wing)\b/.test(lower)) return 'T_SHAPE_SPINE';
  if (/\b(?:o[\s-]?shape|perimeter\s+court)\b/.test(lower)) return 'O_SHAPE_PERIMETER_COURT';
  if (/\b(?:h[\s-]?shape|h[\s-]?wing)\b/.test(lower)) return 'H_SHAPE_WING';
  if (/\b(?:u[\s-]?shape)\b/.test(lower)) return 'U_SHAPE_COURTYARD';
  if (/\b(?:l[\s-]?shape|corner[\s-]?wing)\b/.test(lower)) return 'L_SHAPE_CORNER';
  if (/\b(?:cruciform|plus[\s-]?shape)\b/.test(lower)) return 'CRUCIFORM_PLUS';
  if (/\b(?:pinwheel)\b/.test(lower)) return 'PINWHEEL_CLUSTER';
  if (/\b(?:stepped(?:\s+offset)?)\b/.test(lower)) return 'STEPPED_OFFSET_BLOCK';
  if (/\b(?:compact\s+(?:double[\s-]loaded\s+)?block)\b/.test(lower)) return 'COMPACT_DOUBLE_LOADED';
  if (/\b(?:curved\s+building|curved\s+wall|curved\s+facade|radial\s+wing)\b/.test(lower)) return 'CURVED_CRESCENT';
  return undefined;
}

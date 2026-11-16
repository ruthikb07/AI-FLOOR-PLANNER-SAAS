/**
 * Indian Structural Engineering Codes & Design Verification Contracts (§P3.3).
 *
 * Implements authoritative structural engineering types adhering strictly to:
 * - IS 456:2000 (Plain and Reinforced Concrete - Code of Practice)
 * - IS 875 (Part 1):1987 (Dead Loads - Unit Weights of Materials)
 * - IS 875 (Part 2):1987 (Imposed / Live Loads for Residential Buildings)
 * - IS 875 (Part 3):2015 (Wind Loads on Buildings and Structures)
 * - IS 875 (Part 5):1987 (Special Loads and Combinations)
 * - IS 1893 (Part 1):2016 (Criteria for Earthquake Resistant Design of Structures)
 * - IS 13920:2016 (Ductile Design and Detailing of RC Structures Subjected to Seismic Forces)
 * - IS 1786:2008 (High Strength Deformed Steel Bars for Concrete Reinforcement)
 *
 * ENGINEERING DISCLAIMER:
 * Automated calculations represent internal software design aids only.
 * Professional structural certification requires review and wet-stamping by a licensed Structural Engineer (SE-1).
 */

export const IS_CODE_EDITIONS = {
  RCC_DESIGN: 'IS 456:2000 (Reaffirmed 2021)',
  DEAD_LOADS: 'IS 875 (Part 1):1987 (Reaffirmed 2018)',
  LIVE_LOADS: 'IS 875 (Part 2):1987 (Reaffirmed 2018)',
  WIND_LOADS: 'IS 875 (Part 3):2015 (Third Revision)',
  SPECIAL_LOADS: 'IS 875 (Part 5):1987 (Reaffirmed 2018)',
  SEISMIC_DESIGN: 'IS 1893 (Part 1):2016 (Sixth Revision)',
  DUCTILE_DETAILING: 'IS 13920:2016 (First Revision)',
  REBAR_SPECIFICATION: 'IS 1786:2008 (Fourth Revision)',
} as const;

export type ISCodeStandardKey = keyof typeof IS_CODE_EDITIONS;

/** Supported Concrete Grades per IS 456:2000 Table 2 */
export type IndianConcreteGrade = 'M20' | 'M25' | 'M30' | 'M35' | 'M40';

export interface ConcreteMaterialProperties {
  grade: IndianConcreteGrade;
  /** Characteristic compressive cube strength f_ck in N/mm² (MPa) at 28 days */
  fckNPerMm2: number;
  /** Short-term static modulus of elasticity Ec = 5000 * sqrt(fck) in N/mm² (cl 6.2.3.1) */
  elasticModulusNPerMm2: number;
  /** Mass density in kg/m³ (IS 875 Part 1: plain 2400, reinforced 2500) */
  massDensityKgPerM3: number;
  /** Poisson's ratio (cl 5.2.4: 0.20 for design of RC members) */
  poissonRatio: number;
  /** Thermal expansion coefficient per °C (cl 6.2.4: 9.9e-6) */
  thermalExpansionPerC: number;
  /** Maximum compressive strain in concrete under direct axial load (cl 39.1: 0.002) */
  axialStrainLimit: number;
  /** Maximum compressive strain in bending (cl 38.1(b): 0.0035) */
  bendingStrainLimit: number;
}

export const CONCRETE_PROPERTIES_MAP: Record<IndianConcreteGrade, ConcreteMaterialProperties> = {
  M20: {
    grade: 'M20',
    fckNPerMm2: 20,
    elasticModulusNPerMm2: Math.round(5000 * Math.sqrt(20)), // 22361 N/mm²
    massDensityKgPerM3: 2500,
    poissonRatio: 0.20,
    thermalExpansionPerC: 9.9e-6,
    axialStrainLimit: 0.002,
    bendingStrainLimit: 0.0035,
  },
  M25: {
    grade: 'M25',
    fckNPerMm2: 25,
    elasticModulusNPerMm2: Math.round(5000 * Math.sqrt(25)), // 25000 N/mm²
    massDensityKgPerM3: 2500,
    poissonRatio: 0.20,
    thermalExpansionPerC: 9.9e-6,
    axialStrainLimit: 0.002,
    bendingStrainLimit: 0.0035,
  },
  M30: {
    grade: 'M30',
    fckNPerMm2: 30,
    elasticModulusNPerMm2: Math.round(5000 * Math.sqrt(30)), // 27386 N/mm²
    massDensityKgPerM3: 2500,
    poissonRatio: 0.20,
    thermalExpansionPerC: 9.9e-6,
    axialStrainLimit: 0.002,
    bendingStrainLimit: 0.0035,
  },
  M35: {
    grade: 'M35',
    fckNPerMm2: 35,
    elasticModulusNPerMm2: Math.round(5000 * Math.sqrt(35)), // 29580 N/mm²
    massDensityKgPerM3: 2500,
    poissonRatio: 0.20,
    thermalExpansionPerC: 9.9e-6,
    axialStrainLimit: 0.002,
    bendingStrainLimit: 0.0035,
  },
  M40: {
    grade: 'M40',
    fckNPerMm2: 40,
    elasticModulusNPerMm2: Math.round(5000 * Math.sqrt(40)), // 31623 N/mm²
    massDensityKgPerM3: 2500,
    poissonRatio: 0.20,
    thermalExpansionPerC: 9.9e-6,
    axialStrainLimit: 0.002,
    bendingStrainLimit: 0.0035,
  },
};

/** Supported Steel Reinforcement Grades per IS 1786:2008 Table 3 */
export type IndianSteelGrade = 'Fe415' | 'Fe500' | 'Fe500D' | 'Fe550D';

export interface SteelMaterialProperties {
  grade: IndianSteelGrade;
  /** Characteristic yield strength / 0.2% proof stress fy in N/mm² */
  fyNPerMm2: number;
  /** Minimum ultimate tensile strength fu in N/mm² */
  fuNPerMm2: number;
  /** Elastic modulus Es in N/mm² (cl 5.6.3: 200,000 N/mm²) */
  elasticModulusNPerMm2: number;
  /** Minimum elongation percentage on gauge length 5.65 * sqrt(A) */
  minElongationPercent: number;
  /** Ratio of ultimate tensile strength to actual 0.2% proof stress (ductility requirement IS 13920) */
  tensileToYieldRatio: number;
  /** Limiting moment coefficient Mu_lim / (fck * b * d²) per IS 456 cl 38.1 */
  limitingMomentFactor: number;
}

export const STEEL_PROPERTIES_MAP: Record<IndianSteelGrade, SteelMaterialProperties> = {
  Fe415: {
    grade: 'Fe415',
    fyNPerMm2: 415,
    fuNPerMm2: 485,
    elasticModulusNPerMm2: 200000,
    minElongationPercent: 14.5,
    tensileToYieldRatio: 1.10,
    limitingMomentFactor: 0.138,
  },
  Fe500: {
    grade: 'Fe500',
    fyNPerMm2: 500,
    fuNPerMm2: 545,
    elasticModulusNPerMm2: 200000,
    minElongationPercent: 12.0,
    tensileToYieldRatio: 1.08,
    limitingMomentFactor: 0.133,
  },
  Fe500D: {
    grade: 'Fe500D',
    fyNPerMm2: 500,
    fuNPerMm2: 565,
    elasticModulusNPerMm2: 200000,
    minElongationPercent: 16.0,
    tensileToYieldRatio: 1.10,
    limitingMomentFactor: 0.133,
  },
  Fe550D: {
    grade: 'Fe550D',
    fyNPerMm2: 550,
    fuNPerMm2: 600,
    elasticModulusNPerMm2: 200000,
    minElongationPercent: 14.5,
    tensileToYieldRatio: 1.08,
    limitingMomentFactor: 0.130,
  },
};

/** Dead Load Configuration per IS 875 (Part 1):1987 */
export interface IndianDeadLoadConfig {
  floorFinishKnPerM2: number; // typically 1.0 - 1.5 kN/m²
  externalWallThicknessMm: number; // typically 230 mm or 150 mm
  internalWallThicknessMm: number; // typically 115 mm or 100 mm
  masonryDensityKnPerM3: number; // 19.0 kN/m³ for burnt clay brick, 8.0 kN/m³ for AAC blocks
  plasterThicknessMm: number; // 2 x 12 mm = 24 mm
  plasterDensityKnPerM3: number; // 20.4 kN/m³
  parapetHeightMm: number; // typically 1000 - 1200 mm
  parapetThicknessMm: number; // typically 150 - 230 mm
}

/** Default Residential Dead Load Parameters */
export const DEFAULT_INDIAN_DEAD_LOADS: IndianDeadLoadConfig = {
  floorFinishKnPerM2: 1.0,
  externalWallThicknessMm: 230,
  internalWallThicknessMm: 115,
  masonryDensityKnPerM3: 19.0,
  plasterThicknessMm: 24,
  plasterDensityKnPerM3: 20.4,
  parapetHeightMm: 1050,
  parapetThicknessMm: 150,
};

/** Live / Imposed Loads per IS 875 (Part 2):1987 Table 1 for Residential Buildings */
export interface IndianResidentialLiveLoadConfig {
  /** Living rooms, dining rooms, bedrooms (cl 1.1: 2.0 kN/m²) */
  habitableRoomsKnPerM2: number;
  /** Kitchens, bathrooms, W.C.s (cl 1.2: 2.0 kN/m²) */
  kitchensAndToiletsKnPerM2: number;
  /** Corridors, passages, staircases, lift lobbies (cl 1.3: 3.0 kN/m²) */
  corridorsAndStairsKnPerM2: number;
  /** Balconies (cl 1.4: 3.0 kN/m²) */
  balconiesKnPerM2: number;
  /** Accessible flat roof / terrace (cl 2.1: 1.5 kN/m²) */
  accessibleTerraceKnPerM2: number;
  /** Inaccessible flat roof / terrace (cl 2.2: 0.75 kN/m²) */
  inaccessibleTerraceKnPerM2: number;
  /** Overhead water tank water surcharge allowance (typically 12.0 kN/m² over OHWT footprint) */
  overheadWaterTankKnPerM2: number;
}

export const DEFAULT_INDIAN_LIVE_LOADS: IndianResidentialLiveLoadConfig = {
  habitableRoomsKnPerM2: 2.0,
  kitchensAndToiletsKnPerM2: 2.0,
  corridorsAndStairsKnPerM2: 3.0,
  balconiesKnPerM2: 3.0,
  accessibleTerraceKnPerM2: 1.5,
  inaccessibleTerraceKnPerM2: 0.75,
  overheadWaterTankKnPerM2: 12.0,
};

/** Wind Load Parameters per IS 875 (Part 3):2015 */
export interface IndianWindConfig {
  /** Basic wind speed Vb in m/s (Appendix A: e.g. 39 m/s for Pune/Mumbai, 44 m/s for Delhi, 50 m/s for coastal) */
  basicWindSpeedVbMPerS: number;
  /** Risk coefficient / probability factor k1 (cl 6.3.1: Table 1, 1.0 for general 50-year residential buildings) */
  riskFactorK1: number;
  /** Terrain category (cl 6.3.2.1: Category 1, 2, 3, or 4) */
  terrainCategory: 1 | 2 | 3 | 4;
  /** Topography factor k3 (cl 6.3.3: 1.0 for upwind slope < 3°) */
  topographyFactorK3: number;
  /** Importance factor for cyclonic region k4 (cl 6.3.4: 1.0 for non-cyclonic, 1.15 for cyclonic) */
  cyclonicFactorK4: number;
  /** Wind directionality factor kd (cl 7.2.1: 0.90 for buildings) */
  windDirectionalityFactorKd: number;
  /** Area averaging factor ka (cl 7.2.2: 0.80 to 1.0) */
  areaAveragingFactorKa: number;
  /** Combination factor kc (cl 7.3.3.13: 0.90) */
  combinationFactorKc: number;
}

export const DEFAULT_INDIAN_WIND_CONFIG: IndianWindConfig = {
  basicWindSpeedVbMPerS: 39, // Pune/Western Maharashtra
  riskFactorK1: 1.0,
  terrainCategory: 3, // Well-clad suburban/urban terrain
  topographyFactorK3: 1.0,
  cyclonicFactorK4: 1.0,
  windDirectionalityFactorKd: 0.90,
  areaAveragingFactorKa: 0.90,
  combinationFactorKc: 0.90,
};

/** Seismic Design Parameters per IS 1893 (Part 1):2016 */
export type IndianSeismicZone = 'ZONE_II' | 'ZONE_III' | 'ZONE_IV' | 'ZONE_V';
export type IndianSoilType = 'ROCK_OR_HARD' | 'MEDIUM' | 'SOFT';

export interface IndianSeismicConfig {
  zone: IndianSeismicZone;
  /** Seismic Zone Factor Z (cl 6.4.2 Table 3: Zone II = 0.10, III = 0.16, IV = 0.24, V = 0.36) */
  zoneFactorZ: number;
  /** Importance Factor I (cl 7.2.3 Table 8: 1.0 for residential, 1.2 for > 200 capacity) */
  importanceFactorI: number;
  /** Response Reduction Factor R (cl 7.2.6 Table 9: 5.0 for SMRF per IS 13920, 3.0 for OMRF) */
  responseReductionFactorR: number;
  /** Structural framing type */
  framingType: 'SMRF' | 'OMRF';
  /** Foundation soil classification */
  soilType: IndianSoilType;
  /** Damping ratio (cl 7.2.4: 5% for reinforced concrete buildings) */
  dampingPercent: number;
  /** Building structural height h in meters from base */
  buildingHeightM: number;
  /** Plan dimension d in X-direction in meters */
  planDimensionXM: number;
  /** Plan dimension d in Y-direction in meters */
  planDimensionYM: number;
}

export const SEISMIC_ZONE_FACTORS: Record<IndianSeismicZone, number> = {
  ZONE_II: 0.10,
  ZONE_III: 0.16,
  ZONE_IV: 0.24,
  ZONE_V: 0.36,
};

export const DEFAULT_INDIAN_SEISMIC_CONFIG: IndianSeismicConfig = {
  zone: 'ZONE_III',
  zoneFactorZ: 0.16,
  importanceFactorI: 1.0,
  responseReductionFactorR: 5.0, // SMRF ductile detailing mandated
  framingType: 'SMRF',
  soilType: 'MEDIUM',
  dampingPercent: 5.0,
  buildingHeightM: 12.2, // Stilt + 3 typical floors
  planDimensionXM: 14.0,
  planDimensionYM: 20.0,
};

/** Combined Indian-Code Residential Structural Loading Configuration */
export interface IndianStructuralLoadingConfig {
  configVersion: string;
  sourceBuildingId: string;
  architecturalRevision: number;
  concreteGrade: IndianConcreteGrade;
  rebarGrade: IndianSteelGrade;
  deadLoads: IndianDeadLoadConfig;
  liveLoads: IndianResidentialLiveLoadConfig;
  wind: IndianWindConfig;
  seismic: IndianSeismicConfig;
  /** Review status: must be 'ENGINEER_APPROVED' before construction certification */
  reviewStatus: 'ENGINEERING_INPUTS_REQUIRED' | 'ENGINEERING_REVIEW_PENDING' | 'ENGINEER_APPROVED';
  missingInputs: string[];
}

/** Design Check Results for a Structural Column per IS 456:2000 cl 39 & IS 13920:2016 */
export interface IndianColumnDesignCheck {
  columnId: string;
  mark: string;
  gridRef: string;
  floorId: string;
  floorName: string;
  sectionMm: { width: number; depth: number };
  concreteGrade: IndianConcreteGrade;
  rebarGrade: IndianSteelGrade;
  effectiveLengthXMm: number;
  effectiveLengthYMm: number;
  /** Minimum eccentricity per IS 456 cl 25.4 */
  minEccentricityXMm: number;
  minEccentricityYMm: number;
  governingCombination: string;
  factoredAxialDemandPuKn: number;
  factoredMomentDemandMuxKnm: number;
  factoredMomentDemandMuyKnm: number;
  /** Axial capacity under pure compression Puz in kN */
  axialCapacityPuzKn: number;
  /** Uniaxial moment capacity Mux1 in kNm */
  momentCapacityMux1Knm: number;
  /** Uniaxial moment capacity Muy1 in kNm */
  momentCapacityMuy1Knm: number;
  /** IS 456 cl 39.6 exponent alpha_n */
  alphaN: number;
  /** Biaxial interaction ratio (Mux/Mux1)^alpha_n + (Muy/Muy1)^alpha_n */
  biaxialInteractionRatio: number;
  /** Maximum utilization ratio eta */
  utilizationRatio: number;
  /** Provided longitudinal reinforcement area in mm² */
  longitudinalSteelAreaMm2: number;
  /** Longitudinal reinforcement percentage pt */
  steelPercentagePt: number;
  /** Provided longitudinal bar configuration (e.g. '8-T16 + 4-T12') */
  reinforcementSchedule: string;
  /** Lateral tie details per IS 13920:2016 cl 7.4 */
  confiningTiesSchedule: string;
  status: 'SAFE' | 'OVERSTRESSED' | 'WARNING';
  warnings: string[];
}

/** Design Check Results for a Structural Beam per IS 456:2000 cl 38/40 & IS 13920:2016 */
export interface IndianBeamDesignCheck {
  beamId: string;
  mark: string;
  floorId: string;
  floorName: string;
  spanMm: number;
  sectionMm: { width: number; depth: number };
  concreteGrade: IndianConcreteGrade;
  rebarGrade: IndianSteelGrade;
  governingFlexureCombo: string;
  governingShearCombo: string;
  factoredMaxHoggingMomentMuKnm: number;
  factoredMaxSaggingMomentMuKnm: number;
  factoredShearDemandVuKn: number;
  limitingMomentMulimKnm: number;
  requiredTopSteelMm2: number;
  requiredBottomSteelMm2: number;
  providedTopSteel: string; // e.g. '3-T16'
  providedBottomSteel: string; // e.g. '3-T16'
  /** Nominal shear stress tau_v = Vu / (b * d) in N/mm² */
  nominalShearStressTauVNPerMm2: number;
  /** Maximum permissible shear stress tau_c_max = 0.62 * sqrt(fck) in N/mm² */
  maxShearStressTauCMaxNPerMm2: number;
  /** Permissible shear stress in concrete tau_c in N/mm² */
  concretePermissibleShearTauCNPerMm2: number;
  /** Shear stirrups schedule per IS 13920:2016 cl 6.3 */
  shearStirrupsSchedule: string;
  utilizationRatio: number;
  status: 'SAFE' | 'OVERSTRESSED' | 'WARNING';
  warnings: string[];
}

/** Storey Drift Check per IS 1893 (Part 1):2016 cl 7.11.1 */
export interface IndianStoreyDriftCheck {
  storeyId: string;
  storeyName: string;
  storeyHeightMm: number;
  driftXDemandMm: number;
  driftYDemandMm: number;
  driftRatioX: number;
  driftRatioY: number;
  /** Permissible drift ratio = 0.004 * h per IS 1893 cl 7.11.1 */
  allowableDriftRatio: number; // 0.004
  isCompliant: boolean;
}

/** Complete Indian Code Structural Design Verification Result */
export interface IndianStructuralVerificationResult {
  evaluationTimestamp: string;
  sourceModelSha256: string;
  etabsAnalysisRunId: string;
  standards: {
    concreteCode: string;
    loadingCodes: string[];
    seismicCode: string;
    ductileCode: string;
  };
  materials: {
    concreteGrade: IndianConcreteGrade;
    steelGrade: IndianSteelGrade;
    concrete: ConcreteMaterialProperties;
    steel: SteelMaterialProperties;
  };
  seismicEvaluation: {
    zone: IndianSeismicZone;
    zoneFactorZ: number;
    importanceFactorI: number;
    responseReductionFactorR: number;
    fundamentalPeriodTaSec: number;
    spectralAccelerationRatioSaPerG: number;
    horizontalSeismicCoefficientAh: number;
    totalSeismicWeightWKn: number;
    designBaseShearVBKn: number;
    baseShearDistribution: { storeyName: string; heightMm: number; weightKn: number; lateralForceQiKn: number }[];
  };
  drifts: IndianStoreyDriftCheck[];
  columns: IndianColumnDesignCheck[];
  beams: IndianBeamDesignCheck[];
  equilibrium: {
    appliedVerticalLoadKn: number;
    reactionVerticalLoadKn: number;
    verticalEquilibriumResidualN: number;
    momentEquilibriumResidualNmm: number;
    isEquilibriumSatisfied: boolean;
  };
  deficiencies: {
    memberId: string;
    memberMark: string;
    memberKind: 'COLUMN' | 'BEAM' | 'STOREY';
    checkName: string;
    limitValue: number;
    actualValue: number;
    unit: string;
    message: string;
  }[];
  overallStatus: 'PASS' | 'SAFE_WITH_WARNINGS' | 'OVERSTRESSED' | 'ENGINEERING_INPUTS_REQUIRED';
  engineeringDisclaimer: string;
}


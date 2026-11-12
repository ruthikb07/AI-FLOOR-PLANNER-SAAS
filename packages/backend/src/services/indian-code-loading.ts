import type {
  Building,
  IndianConcreteGrade,
  IndianSteelGrade,
  IndianDeadLoadConfig,
  IndianResidentialLiveLoadConfig,
  IndianWindConfig,
  IndianSeismicConfig,
  IndianStructuralLoadingConfig,
  StructuralLoadCase,
  StructuralLoadCombination,
} from '@ai-floor-planner/core';
import {
  DEFAULT_INDIAN_DEAD_LOADS,
  DEFAULT_INDIAN_LIVE_LOADS,
  DEFAULT_INDIAN_WIND_CONFIG,
  DEFAULT_INDIAN_SEISMIC_CONFIG,
  SEISMIC_ZONE_FACTORS,
} from '@ai-floor-planner/core';
import { ExportError } from './export-selection.js';

export interface StoreyLoadSummary {
  storeyId: string;
  storeyName: string;
  level: number;
  elevationMm: number;
  heightMm: number;
  floorAreaSqm: number;
  slabDeadLoadKn: number;
  finishesDeadLoadKn: number;
  wallsDeadLoadKn: number;
  beamsDeadLoadKn: number;
  columnsDeadLoadKn: number;
  totalDeadLoadKn: number;
  habitableLiveLoadKn: number;
  seismicLiveLoadReductionFactor: number;
  effectiveSeismicLiveLoadKn: number;
  totalStoreySeismicWeightWiKn: number;
  lateralSeismicForceQiKn: number;
}

export interface BuildingSeismicCalculation {
  buildingHeightM: number;
  planDimensionXM: number;
  planDimensionYM: number;
  totalSeismicWeightWKn: number;
  fundamentalPeriodTaSec: number;
  spectralAccelerationSaPerG: number;
  horizontalSeismicCoefficientAh: number;
  designBaseShearVBKn: number;
  storeys: StoreyLoadSummary[];
}

export interface CreateLoadingConfigOptions {
  concreteGrade?: IndianConcreteGrade;
  rebarGrade?: IndianSteelGrade;
  deadLoads?: Partial<IndianDeadLoadConfig>;
  liveLoads?: Partial<IndianResidentialLiveLoadConfig>;
  wind?: Partial<IndianWindConfig>;
  seismic?: Partial<IndianSeismicConfig>;
  engineerApprovalId?: string;
  reviewedInputsProvided?: boolean;
}

/**
 * Indian Structural Code Loading Service (IS 875 Parts 1, 2, 3 and IS 1893:2016 Part 1).
 *
 * Strict Engineering Rules:
 * - Requires explicit, reviewed loading parameters. An approval ID alone cannot substitute for engineering inputs.
 * - Prevents double-counting structural self-weights by deducting slab thickness from beam depth and beam depth from column height.
 * - Calculates storey seismic weights W_i with IS 1893:2016 Table 10 live-load reduction factors.
 * - Computes design base shear V_B and lateral parabolic distribution Q_i across storeys.
 */
export class IndianCodeLoadingService {
  public createLoadingConfig(
    building: Building,
    options: CreateLoadingConfigOptions = {},
  ): IndianStructuralLoadingConfig {
    // Safety check: approval ID alone without reviewed inputs is forbidden
    const hasExplicitInputs =
      options.reviewedInputsProvided === true ||
      (options.deadLoads !== undefined &&
        options.liveLoads !== undefined &&
        options.seismic !== undefined &&
        options.wind !== undefined);

    if (!hasExplicitInputs && options.engineerApprovalId) {
      throw new ExportError(
        'ENGINEERING_INPUTS_REQUIRED',
        'Explicit reviewed material, occupancy, site, soil, wind, seismic and code-edition inputs are required; an approval identifier alone cannot supply them.',
        409,
      );
    }

    const missingInputs: string[] = [];
    if (!options.concreteGrade) missingInputs.push('concreteGrade (IS 456 Table 2)');
    if (!options.rebarGrade) missingInputs.push('rebarGrade (IS 1786 Table 3)');
    if (!options.seismic?.zone) missingInputs.push('seismicZone (IS 1893 Table 3)');
    if (!options.seismic?.soilType) missingInputs.push('soilType (IS 1893 Cl 6.4.2)');
    if (!options.wind?.basicWindSpeedVbMPerS) missingInputs.push('basicWindSpeed (IS 875 Part 3)');

    const concreteGrade: IndianConcreteGrade = options.concreteGrade ?? 'M25';
    const rebarGrade: IndianSteelGrade = options.rebarGrade ?? 'Fe500';

    const deadLoads: IndianDeadLoadConfig = {
      ...DEFAULT_INDIAN_DEAD_LOADS,
      ...(options.deadLoads ?? {}),
    };

    const liveLoads: IndianResidentialLiveLoadConfig = {
      ...DEFAULT_INDIAN_LIVE_LOADS,
      ...(options.liveLoads ?? {}),
    };

    const wind: IndianWindConfig = {
      ...DEFAULT_INDIAN_WIND_CONFIG,
      ...(options.wind ?? {}),
    };

    const zone = options.seismic?.zone ?? 'ZONE_III';
    const zoneFactorZ = SEISMIC_ZONE_FACTORS[zone] ?? 0.16;

    const seismic: IndianSeismicConfig = {
      ...DEFAULT_INDIAN_SEISMIC_CONFIG,
      zone,
      zoneFactorZ,
      ...(options.seismic ?? {}),
    };

    const reviewStatus =
      missingInputs.length === 0 && options.engineerApprovalId
        ? 'ENGINEER_APPROVED'
        : 'ENGINEERING_INPUTS_REQUIRED';

    return {
      configVersion: '1.0.0-IS',
      sourceBuildingId: building?.id ?? 'UNASSIGNED_BUILDING',
      architecturalRevision: building?.version ?? 1,
      concreteGrade,
      rebarGrade,
      deadLoads,
      liveLoads,
      wind,
      seismic,
      reviewStatus,
      missingInputs,
    };
  }

  public calculateSeismicAndGravityLoads(
    building: Building,
    config: IndianStructuralLoadingConfig,
  ): BuildingSeismicCalculation {
    if (!building?.floors || building.floors.length === 0) {
      throw new ExportError('INVALID_BUILDING', 'Building must contain at least one floor for load analysis', 400);
    }

    const floors = building.floors;
    const storeys: StoreyLoadSummary[] = [];
    const concreteDensityKnPerM3 = 25.0; // IS 875 Part 1 reinforced concrete

    // Estimate overall building plan dimensions
    const allPoints = floors.flatMap(f => f.rooms.flatMap(r => r.boundary.points));
    const minX = allPoints.length ? Math.min(...allPoints.map(p => p.x)) : 0;
    const maxX = allPoints.length ? Math.max(...allPoints.map(p => p.x)) : 20000;
    const minY = allPoints.length ? Math.min(...allPoints.map(p => p.y)) : 0;
    const maxY = allPoints.length ? Math.max(...allPoints.map(p => p.y)) : 25000;

    const planDimensionXM = Math.max(5.0, (maxX - minX) / 1000);
    const planDimensionYM = Math.max(5.0, (maxY - minY) / 1000);

    for (let i = 0; i < floors.length; i++) {
      const floor = floors[i]!;
      const isRoof = floor.floorUse === 'ROOF' || i === floors.length - 1;
      const floorElev = (floor as any).elevationMm ?? (floor as any).elevation ?? i * 3000;
      const elevationMm = typeof floorElev === 'number' ? floorElev : i * 3000;
      const prevElev = i === 0 ? 0 : ((floors[i - 1] as any)?.elevationMm ?? (floors[i - 1] as any)?.elevation ?? (i - 1) * 3000);
      const heightMm = i === 0 ? (elevationMm || 3000) : (elevationMm - prevElev);
      const heightM = heightMm / 1000;

      // Calculate floor area in sqm
      let floorAreaSqm = 0;
      if (floor.rooms && floor.rooms.length > 0) {
        for (const room of floor.rooms) {
          // Polygon area in mm² converted to m²
          let areaMm2 = 0;
          const pts = room.boundary.points;
          for (let p = 0; p < pts.length; p++) {
            const next = pts[(p + 1) % pts.length]!;
            areaMm2 += pts[p]!.x * next.y - next.x * pts[p]!.y;
          }
          floorAreaSqm += Math.abs(areaMm2) / 2 / 1e6;
        }
      } else {
        floorAreaSqm = planDimensionXM * planDimensionYM;
      }
      floorAreaSqm = Math.max(10.0, floorAreaSqm);

      // Slabs dead load: 130mm typical / 150mm roof
      const slabThicknessM = isRoof ? 0.15 : 0.13;
      const slabDeadLoadKn = floorAreaSqm * slabThicknessM * concreteDensityKnPerM3;

      // Floor finish dead load per IS 875 Part 1
      const finishesDeadLoadKn = floorAreaSqm * config.deadLoads.floorFinishKnPerM2;

      // Frame self-weights (without double counting slab thickness or joint overlap)
      const numCols = Math.max(6, Math.ceil(floorAreaSqm / 25));
      const colWidthM = 0.30;
      const colDepthM = 0.50;
      const avgBeamDepthM = 0.45;
      const clearColHeightM = Math.max(0.5, heightM - avgBeamDepthM);
      const columnsDeadLoadKn = numCols * (colWidthM * colDepthM * clearColHeightM) * concreteDensityKnPerM3;

      // Framing beams self-weight deducting slab flange: b * (D - t_slab) * L
      const estimatedBeamLengthM = Math.sqrt(floorAreaSqm) * 4;
      const beamWidthM = 0.23;
      const clearBeamDepthM = Math.max(0.1, avgBeamDepthM - slabThicknessM);
      const beamsDeadLoadKn = (beamWidthM * clearBeamDepthM * estimatedBeamLengthM) * concreteDensityKnPerM3;

      // Masonry wall loads
      let wallsDeadLoadKn = 0;
      if (!isRoof) {
        const wallPerimeterM = Math.sqrt(floorAreaSqm) * 3.5;
        const wallHeightM = Math.max(0.5, heightM - avgBeamDepthM);
        const extWallThicknessM = config.deadLoads.externalWallThicknessMm / 1000;
        const intWallThicknessM = config.deadLoads.internalWallThicknessMm / 1000;
        const avgWallThicknessM = (extWallThicknessM * 0.4) + (intWallThicknessM * 0.6);
        const masonryDensity = config.deadLoads.masonryDensityKnPerM3;
        const plasterLoadKnPerM2 = (config.deadLoads.plasterThicknessMm / 1000) * config.deadLoads.plasterDensityKnPerM3;
        wallsDeadLoadKn = wallPerimeterM * wallHeightM * (avgWallThicknessM * masonryDensity + plasterLoadKnPerM2);
      } else {
        // Parapet wall on roof
        const parapetPerimeterM = 2 * (planDimensionXM + planDimensionYM);
        const parapetHeightM = config.deadLoads.parapetHeightMm / 1000;
        const parapetThicknessM = config.deadLoads.parapetThicknessMm / 1000;
        wallsDeadLoadKn = parapetPerimeterM * parapetHeightM * parapetThicknessM * config.deadLoads.masonryDensityKnPerM3;
      }

      const totalDeadLoadKn = slabDeadLoadKn + finishesDeadLoadKn + beamsDeadLoadKn + columnsDeadLoadKn + wallsDeadLoadKn;

      // Live loads per IS 875 Part 2
      let habitableLiveLoadKn = 0;
      let seismicReductionFactor = 0.25;

      if (isRoof) {
        habitableLiveLoadKn = floorAreaSqm * config.liveLoads.accessibleTerraceKnPerM2;
        seismicReductionFactor = 0.0; // IS 1893 Cl 7.3: no live load on roof in seismic weight
      } else if (floor.floorUse === 'STILT_PARKING') {
        habitableLiveLoadKn = floorAreaSqm * 2.5;
        seismicReductionFactor = 0.25;
      } else {
        // Residential floors: mix of habitable rooms (2.0 kN/m²) and circulation/balcony (3.0 kN/m²)
        habitableLiveLoadKn = floorAreaSqm * 2.2;
        seismicReductionFactor = 0.25;
      }

      const effectiveSeismicLiveLoadKn = habitableLiveLoadKn * seismicReductionFactor;
      const totalStoreySeismicWeightWiKn = totalDeadLoadKn + effectiveSeismicLiveLoadKn;

      storeys.push({
        storeyId: floor.id,
        storeyName: floor.name || `Storey_${i}`,
        level: i,
        elevationMm,
        heightMm,
        floorAreaSqm: Math.round(floorAreaSqm * 100) / 100,
        slabDeadLoadKn: Math.round(slabDeadLoadKn * 100) / 100,
        finishesDeadLoadKn: Math.round(finishesDeadLoadKn * 100) / 100,
        wallsDeadLoadKn: Math.round(wallsDeadLoadKn * 100) / 100,
        beamsDeadLoadKn: Math.round(beamsDeadLoadKn * 100) / 100,
        columnsDeadLoadKn: Math.round(columnsDeadLoadKn * 100) / 100,
        totalDeadLoadKn: Math.round(totalDeadLoadKn * 100) / 100,
        habitableLiveLoadKn: Math.round(habitableLiveLoadKn * 100) / 100,
        seismicLiveLoadReductionFactor: seismicReductionFactor,
        effectiveSeismicLiveLoadKn: Math.round(effectiveSeismicLiveLoadKn * 100) / 100,
        totalStoreySeismicWeightWiKn: Math.round(totalStoreySeismicWeightWiKn * 100) / 100,
        lateralSeismicForceQiKn: 0, // Populated below
      });
    }

    // Seismic Base Shear Calculation (IS 1893:2016 Cl 7.2)
    const totalSeismicWeightWKn = storeys.reduce((sum, s) => sum + s.totalStoreySeismicWeightWiKn, 0);
    const topElevationMm = storeys[storeys.length - 1]!.elevationMm;
    const buildingHeightM = Math.max(3.0, topElevationMm / 1000);

    // Fundamental period Ta = 0.09 * h / sqrt(d) (with masonry infills per Cl 7.6.2)
    const governingDimensionD = Math.min(planDimensionXM, planDimensionYM);
    const fundamentalPeriodTaSec = Math.round((0.09 * buildingHeightM / Math.sqrt(governingDimensionD)) * 1000) / 1000;

    // Spectral Acceleration Ratio Sa/g for Medium Soil (Type II per Cl 6.4.2)
    let spectralAccelerationSaPerG = 2.50;
    if (fundamentalPeriodTaSec < 0.10) {
      spectralAccelerationSaPerG = 1.0 + 15.0 * fundamentalPeriodTaSec;
    } else if (fundamentalPeriodTaSec <= 0.55) {
      spectralAccelerationSaPerG = 2.50;
    } else {
      spectralAccelerationSaPerG = Math.max(0.34, 1.36 / fundamentalPeriodTaSec);
    }
    spectralAccelerationSaPerG = Math.round(spectralAccelerationSaPerG * 1000) / 1000;

    // Horizontal Seismic Coefficient Ah = (Z / 2) * (I / R) * (Sa / g) per Cl 6.4.2
    const Z = config.seismic.zoneFactorZ;
    const I = config.seismic.importanceFactorI;
    const R = config.seismic.responseReductionFactorR;
    const horizontalSeismicCoefficientAh = Math.max(
      (Z / 2) * (I / R) * 0.70, // Code minimum threshold
      Math.round(((Z / 2) * (I / R) * spectralAccelerationSaPerG) * 10000) / 10000,
    );

    // Design Base Shear VB = Ah * W
    const designBaseShearVBKn = Math.round((horizontalSeismicCoefficientAh * totalSeismicWeightWKn) * 100) / 100;

    // Parabolic vertical distribution of lateral forces: Qi = VB * (Wi * hi^2) / sum(Wj * hj^2) per Cl 7.6.3
    const denom = storeys.reduce((sum, s) => {
      const hM = s.elevationMm / 1000;
      return sum + s.totalStoreySeismicWeightWiKn * (hM * hM);
    }, 0);

    for (const storey of storeys) {
      const hM = storey.elevationMm / 1000;
      if (denom > 0 && hM > 0) {
        storey.lateralSeismicForceQiKn = Math.round((designBaseShearVBKn * (storey.totalStoreySeismicWeightWiKn * hM * hM) / denom) * 100) / 100;
      } else {
        storey.lateralSeismicForceQiKn = 0;
      }
    }

    return {
      buildingHeightM,
      planDimensionXM,
      planDimensionYM,
      totalSeismicWeightWKn: Math.round(totalSeismicWeightWKn * 100) / 100,
      fundamentalPeriodTaSec,
      spectralAccelerationSaPerG,
      horizontalSeismicCoefficientAh,
      designBaseShearVBKn,
      storeys,
    };
  }

  public generateLoadCasesAndCombinations(
    revisionId: string,
    _seismicCalc: BuildingSeismicCalculation,
  ): {
    loadCases: StructuralLoadCase[];
    loadCombinations: StructuralLoadCombination[];
  } {
    const provenance = {
      sourceArchitecturalRevisionId: revisionId,
      schemaVersion: 1 as const,
      provenance: 'ENGINEER_INPUT' as const,
    };

    // 1. Primary Load Cases
    const loadCases: StructuralLoadCase[] = [
      {
        ...provenance,
        id: 'LC-DEAD',
        name: 'DEAD_LOAD',
        patternType: 'DEAD',
        analysisType: 'LINEAR_STATIC',
        selfWeightMultiplier: 1.0,
        nodalLoads: [],
      },
      {
        ...provenance,
        id: 'LC-LIVE',
        name: 'LIVE_LOAD',
        patternType: 'LIVE',
        analysisType: 'LINEAR_STATIC',
        selfWeightMultiplier: 0.0,
        nodalLoads: [],
      },
      {
        ...provenance,
        id: 'LC-EQX',
        name: 'EARTHQUAKE_X',
        patternType: 'QUAKE',
        analysisType: 'LINEAR_STATIC',
        selfWeightMultiplier: 0.0,
        nodalLoads: [],
      },
      {
        ...provenance,
        id: 'LC-EQY',
        name: 'EARTHQUAKE_Y',
        patternType: 'QUAKE',
        analysisType: 'LINEAR_STATIC',
        selfWeightMultiplier: 0.0,
        nodalLoads: [],
      },
    ];

    // 2. IS 456:2000 Table 18 & IS 1893:2016 Cl 6.3.2 Design Load Combinations
    const loadCombinations: StructuralLoadCombination[] = [
      {
        ...provenance,
        id: 'CO-1.5DL_1.5LL',
        name: '1.5(DL + LL)',
        method: 'LINEAR_ADDITIVE',
        terms: [
          { loadCaseId: 'LC-DEAD', factor: 1.5 },
          { loadCaseId: 'LC-LIVE', factor: 1.5 },
        ],
      },
      {
        ...provenance,
        id: 'CO-1.2DL_1.2LL_1.2EQX',
        name: '1.2(DL + LL + EQX)',
        method: 'LINEAR_ADDITIVE',
        terms: [
          { loadCaseId: 'LC-DEAD', factor: 1.2 },
          { loadCaseId: 'LC-LIVE', factor: 1.2 },
          { loadCaseId: 'LC-EQX', factor: 1.2 },
        ],
      },
      {
        ...provenance,
        id: 'CO-1.2DL_1.2LL_1.2EQY',
        name: '1.2(DL + LL + EQY)',
        method: 'LINEAR_ADDITIVE',
        terms: [
          { loadCaseId: 'LC-DEAD', factor: 1.2 },
          { loadCaseId: 'LC-LIVE', factor: 1.2 },
          { loadCaseId: 'LC-EQY', factor: 1.2 },
        ],
      },
      {
        ...provenance,
        id: 'CO-1.5DL_1.5EQX',
        name: '1.5(DL + EQX)',
        method: 'LINEAR_ADDITIVE',
        terms: [
          { loadCaseId: 'LC-DEAD', factor: 1.5 },
          { loadCaseId: 'LC-EQX', factor: 1.5 },
        ],
      },
      {
        ...provenance,
        id: 'CO-1.5DL_1.5EQY',
        name: '1.5(DL + EQY)',
        method: 'LINEAR_ADDITIVE',
        terms: [
          { loadCaseId: 'LC-DEAD', factor: 1.5 },
          { loadCaseId: 'LC-EQY', factor: 1.5 },
        ],
      },
      {
        ...provenance,
        id: 'CO-0.9DL_1.5EQX',
        name: '0.9DL + 1.5EQX',
        method: 'LINEAR_ADDITIVE',
        terms: [
          { loadCaseId: 'LC-DEAD', factor: 0.9 },
          { loadCaseId: 'LC-EQX', factor: 1.5 },
        ],
      },
      {
        ...provenance,
        id: 'CO-0.9DL_1.5EQY',
        name: '0.9DL + 1.5EQY',
        method: 'LINEAR_ADDITIVE',
        terms: [
          { loadCaseId: 'LC-DEAD', factor: 0.9 },
          { loadCaseId: 'LC-EQY', factor: 1.5 },
        ],
      },
      // Serviceability Combinations (IS 456 Table 18)
      {
        ...provenance,
        id: 'CO-1.0DL_1.0LL',
        name: '1.0(DL + LL) [Serviceability]',
        method: 'LINEAR_ADDITIVE',
        terms: [
          { loadCaseId: 'LC-DEAD', factor: 1.0 },
          { loadCaseId: 'LC-LIVE', factor: 1.0 },
        ],
      },
    ];

    return { loadCases, loadCombinations };
  }
}

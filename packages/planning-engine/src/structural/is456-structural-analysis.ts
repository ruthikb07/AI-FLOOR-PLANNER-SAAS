import {
  RoomType,
  type Building,
  type Column,
  type Floor,
  type StructuralBeam,
} from '@ai-floor-planner/core';
import { polygonArea, polygonBoundingBox } from '@ai-floor-planner/geometry-engine';

export type SeismicZoneCode = 'II' | 'III' | 'IV' | 'V';
export type ConcreteGradeCode = 'M20' | 'M25' | 'M30' | 'M35' | 'M40';
export type SteelGradeCode = 'Fe415' | 'Fe500' | 'Fe550';

export interface StructuralAnalysisInputOptions {
  readonly seismicZone?: SeismicZoneCode;
  readonly concreteGrade?: ConcreteGradeCode;
  readonly steelGrade?: SteelGradeCode;
  /** Soil Safe Bearing Capacity in kN/m² (default 200 kN/m²). */
  readonly safeBearingCapacityKnM2?: number;
  /** Importance factor I per IS 1893:2016 Table 8 (default 1.0 for residential). */
  readonly importanceFactor?: number;
  /** Response reduction factor R per IS 1893:2016 Table 9 (default 5.0 for SMRF). */
  readonly responseReductionFactor?: number;
  /** Floor finish dead load in kN/m² (default 1.5 kN/m²). */
  readonly floorFinishKnM2?: number;
  /** Typical residential live load in kN/m² (default 2.0 kN/m² per IS 875 Part 2). */
  readonly residentialLiveLoadKnM2?: number;
  /** Balcony / corridor / staircase live load in kN/m² (default 3.0 kN/m² per IS 875 Part 2). */
  readonly balconyStairLiveLoadKnM2?: number;
}

export interface StoreySeismicDistribution {
  readonly floorId: string;
  readonly floorName: string;
  readonly level: number;
  readonly elevationM: number;
  readonly seismicWeightKn: number;
  readonly lateralForceQiKn: number;
  readonly cumulativeShearViKn: number;
}

export interface ColumnScheduleRow {
  readonly gridRef: string;
  readonly columnId: string;
  readonly gridCoordLabel: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly sectionLabel: string;
  readonly tributaryAreaM2: number;
  readonly serviceLoadKn: number;
  readonly factoredPuKn: number;
  readonly axialCapacityKn: number;
  readonly utilizationRatio: number;
  readonly rebarPercent: number;
  readonly rebarCallout: string;
  readonly status: 'OK' | 'UPSIZE COLUMN';
}

export interface BeamDesignCheckRow {
  readonly beamId: string;
  readonly label: string;
  readonly beamType: StructuralBeam['type'];
  readonly spanMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly sectionLabel: string;
  readonly factoredUdlKnM: number;
  readonly factoredMuKnM: number;
  readonly factoredVuKn: number;
  readonly actualSpanDepthRatio: number;
  readonly allowableSpanDepthRatio: number;
  readonly status: 'OK' | 'DEEPEN BEAM';
}

export interface SlabDesignCheckSummary {
  readonly floorName: string;
  readonly thicknessMm: number;
  readonly governingShortSpanMm: number;
  readonly governingLongSpanMm: number;
  readonly aspectRatio: number;
  readonly slabAction: 'TWO_WAY' | 'ONE_WAY';
  readonly factoredLoadKnM2: number;
  readonly actualSpanDepthRatio: number;
  readonly allowableSpanDepthRatio: number;
  readonly status: 'OK' | 'INCREASE THICKNESS';
}

export interface FootingScheduleRow {
  readonly gridRef: string;
  readonly columnSection: string;
  readonly serviceLoadKn: number;
  readonly requiredAreaM2: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly footingLabel: string;
  readonly netBearingPressureKnM2: number;
  readonly footingType: 'ISOLATED' | 'COMBINED RECOMMENDED';
}

export interface StructuralAnalysisReport {
  readonly codeStandards: readonly string[];
  readonly disclaimer: string;
  readonly inputs: {
    readonly seismicZone: SeismicZoneCode;
    readonly zoneFactorZ: number;
    readonly concreteGrade: ConcreteGradeCode;
    readonly fckMpa: number;
    readonly steelGrade: SteelGradeCode;
    readonly fyMpa: number;
    readonly safeBearingCapacityKnM2: number;
    readonly importanceFactor: number;
    readonly responseReductionFactor: number;
    readonly floorFinishKnM2: number;
    readonly residentialLiveLoadKnM2: number;
    readonly balconyStairLiveLoadKnM2: number;
  };
  readonly buildingSummary: {
    readonly storeyCount: number;
    readonly totalHeightM: number;
    readonly typicalFloorAreaM2: number;
    readonly columnCountPerFloor: number;
    readonly beamCountPerFloor: number;
    readonly primaryBeamCount: number;
    readonly secondaryBeamCount: number;
    readonly cantileverBeamCount: number;
    readonly maxBeamSpanMm: number;
    readonly typicalSlabThicknessMm: number;
  };
  readonly gravitySummary: {
    readonly slabSelfWeightKn: number;
    readonly beamColumnSelfWeightKn: number;
    readonly masonryInfillLoadKn: number;
    readonly floorFinishLoadKn: number;
    readonly totalDeadLoadKn: number;
    readonly totalLiveLoadKn: number;
    readonly factoredTotalGravityKn: number;
  };
  readonly seismicSummary: {
    readonly seismicWeightWKn: number;
    readonly fundamentalPeriodSec: number;
    readonly spectralAccelSag: number;
    readonly horizontalCoeffAh: number;
    readonly designBaseShearVbKn: number;
    readonly baseShearPercentW: number;
    readonly storeyDistribution: readonly StoreySeismicDistribution[];
  };
  readonly columnSchedule: readonly ColumnScheduleRow[];
  readonly beamChecks: readonly BeamDesignCheckRow[];
  readonly slabCheck: SlabDesignCheckSummary;
  readonly footingSchedule: readonly FootingScheduleRow[];
  readonly healthSummary: {
    readonly columnsOk: number;
    readonly columnsUpsize: number;
    readonly beamsOk: number;
    readonly beamsDeepen: number;
    readonly maxColumnUtilization: number;
    readonly overallStatus: 'PASS_PRELIMINARY' | 'REVIEW_REQUIRED';
  };
}

const ZONE_FACTORS: Record<SeismicZoneCode, number> = {
  II: 0.10,
  III: 0.16,
  IV: 0.24,
  V: 0.36,
};

const CONCRETE_FCK: Record<ConcreteGradeCode, number> = {
  M20: 20,
  M25: 25,
  M30: 30,
  M35: 35,
  M40: 40,
};

const STEEL_FY: Record<SteelGradeCode, number> = {
  Fe415: 415,
  Fe500: 500,
  Fe550: 550,
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function gridLetter(idx: number): string {
  if (idx < 26) return String.fromCharCode(65 + idx);
  return `${String.fromCharCode(65 + Math.floor(idx / 26) - 1)}${String.fromCharCode(65 + (idx % 26))}`;
}

function clusterAxisCoords(values: readonly number[], toleranceMm = 180): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[] = [];
  for (const v of sorted) {
    const existing = clusters.find(c => Math.abs(c - v) <= toleranceMm);
    if (existing === undefined) clusters.push(v);
  }
  return clusters;
}

function suggestRebarCallout(widthMm: number, depthMm: number, reqSteelMm2: number): { percent: number; callout: string } {
  const ag = Math.max(1, widthMm * depthMm);
  const minSteel = 0.008 * ag;
  const targetAst = Math.max(minSteel, reqSteelMm2);
  const pct = Math.min(4.0, Math.max(0.8, (targetAst / ag) * 100));

  const barOptions = [
    { dia: 12, area: 113.1 },
    { dia: 16, area: 201.1 },
    { dia: 20, area: 314.2 },
    { dia: 25, area: 490.9 },
  ];
  for (const bar of barOptions) {
    const rawCount = Math.ceil(targetAst / bar.area);
    const evenCount = Math.max(4, rawCount % 2 === 0 ? rawCount : rawCount + 1);
    if (evenCount <= 12) {
      return { percent: round2(pct), callout: `${evenCount}-${bar.dia}Ø` };
    }
  }
  return { percent: round2(pct), callout: `12-25Ø` };
}

function floorGrossAreaM2(floor: Floor): number {
  const builtRooms = floor.rooms.filter(
    r => r.architecturalRole !== 'OPEN_TO_SKY_VOID' && r.spaceUse !== 'VOID' && !r.openToSky,
  );
  if (builtRooms.length > 0) {
    const sumMm2 = builtRooms.reduce((acc, r) => acc + Math.max(0, r.area || polygonArea(r.boundary)), 0);
    if (sumMm2 > 1_000_000) return sumMm2 / 1_000_000;
  }
  return Math.max(10, polygonArea(floor.boundary) / 1_000_000);
}

/**
 * Computes Voronoi / nearest-column tributary area for each column on the reference floor plate
 * using a fast deterministic 400 mm sampling grid clipped to the actual built rooms.
 */
function computeColumnTributaryAreasM2(floor: Floor, columns: readonly Column[]): Map<string, number> {
  const areas = new Map<string, number>();
  for (const c of columns) areas.set(c.id, 0);
  if (columns.length === 0) return areas;

  const box = polygonBoundingBox(floor.boundary);
  const builtAreaM2 = floorGrossAreaM2(floor);
  const stepMm = Math.max(350, Math.min(600, Math.round(Math.max(box.width, box.height) / 55)));
  const cellAreaM2 = (stepMm * stepMm) / 1_000_000;

  const builtRects = floor.rooms
    .filter(r => r.architecturalRole !== 'OPEN_TO_SKY_VOID' && r.spaceUse !== 'VOID' && !r.openToSky)
    .map(r => polygonBoundingBox(r.boundary));

  let totalSampledM2 = 0;
  for (let x = box.x + stepMm / 2; x < box.x + box.width; x += stepMm) {
    for (let y = box.y + stepMm / 2; y < box.y + box.height; y += stepMm) {
      if (
        builtRects.length > 0 &&
        !builtRects.some(b => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height)
      ) {
        continue;
      }
      let bestId = columns[0]!.id;
      let bestD2 = Number.POSITIVE_INFINITY;
      for (const c of columns) {
        const dx = x - c.position.x;
        const dy = y - c.position.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestId = c.id;
        }
      }
      areas.set(bestId, (areas.get(bestId) ?? 0) + cellAreaM2);
      totalSampledM2 += cellAreaM2;
    }
  }

  // Normalize sampled tributary areas so sum matches exact built floor plate area
  if (totalSampledM2 > 1) {
    const scale = builtAreaM2 / totalSampledM2;
    for (const [id, a] of areas.entries()) {
      areas.set(id, Math.max(2.0, a * scale));
    }
  } else {
    const equal = builtAreaM2 / columns.length;
    for (const c of columns) areas.set(c.id, equal);
  }
  return areas;
}

/**
 * Evaluates a canonical Building under preliminary Indian Standards:
 * - IS 456:2000 (Plain and Reinforced Concrete — Limit State Design)
 * - IS 875 (Parts 1 & 2) (Dead & Imposed Loads)
 * - IS 1893 (Part 1):2016 (Seismic Equivalent Static Base Shear)
 */
export function evaluateIS456StructuralAnalysis(
  building: Building,
  options: StructuralAnalysisInputOptions = {},
): StructuralAnalysisReport {
  const seismicZone: SeismicZoneCode = options.seismicZone ?? 'III';
  const concreteGrade: ConcreteGradeCode = options.concreteGrade ?? 'M25';
  const steelGrade: SteelGradeCode = options.steelGrade ?? 'Fe500';
  const sbc = Math.max(50, Math.min(1000, Number(options.safeBearingCapacityKnM2 ?? 200)));
  const importanceFactor = options.importanceFactor ?? 1.0;
  const responseReductionFactor = options.responseReductionFactor ?? 5.0;
  const floorFinishKnM2 = options.floorFinishKnM2 ?? 1.5;
  const residentialLiveLoadKnM2 = options.residentialLiveLoadKnM2 ?? 2.0;
  const balconyStairLiveLoadKnM2 = options.balconyStairLiveLoadKnM2 ?? 3.0;

  const Z = ZONE_FACTORS[seismicZone];
  const fck = CONCRETE_FCK[concreteGrade];
  const fy = STEEL_FY[steelGrade];

  const sortedFloors = [...building.floors].sort((a, b) => a.level - b.level);
  const refFloor =
    sortedFloors.find(f => f.floorUse === 'RESIDENTIAL' && f.columns.length > 0) ??
    sortedFloors.find(f => f.columns.length > 0) ??
    sortedFloors[0];

  const columns = refFloor?.columns ?? [];
  const beams = refFloor?.beams ?? [];
  const typicalSlabThicknessMm = refFloor?.slabThicknessMm ?? 150;
  const typicalFloorAreaM2 = refFloor ? floorGrossAreaM2(refFloor) : 200;

  // 1. Gravity & Seismic Weight per Floor (IS 875 Part 1/2 + IS 1893 Table 10)
  let totalHeightM = 0;
  let slabSelfWeightKn = 0;
  let beamColumnSelfWeightKn = 0;
  let masonryInfillLoadKn = 0;
  let floorFinishLoadKn = 0;
  let totalLiveLoadKn = 0;

  interface FloorWeightRecord {
    floor: Floor;
    elevM: number;
    wiKn: number;
  }
  const floorWeights: FloorWeightRecord[] = [];

  for (const fl of sortedFloors) {
    const hM = (fl.floorHeight || 3150) / 1000;
    totalHeightM += hM;
    const areaM2 = floorGrossAreaM2(fl);
    const slabTM = (fl.slabThicknessMm ?? 150) / 1000;
    const isTerrace = fl.floorUse === 'ROOF' || /terrace|roof/i.test(fl.name);
    const isStilt = fl.floorUse === 'STILT_PARKING' || /stilt|parking/i.test(fl.name);

    const flSlabDL = areaM2 * slabTM * 25; // 25 kN/m³ RCC
    const flBeamsVolM3 = (fl.beams ?? []).reduce((acc, b) => {
      const lenM = Math.hypot(b.endPoint.x - b.startPoint.x, b.endPoint.y - b.startPoint.y) / 1000;
      return acc + lenM * ((b.widthMm || 230) / 1000) * (Math.max(0.25, ((b.depthMm || 450) - (fl.slabThicknessMm ?? 150)) / 1000));
    }, 0);
    const flColsVolM3 = fl.columns.reduce(
      (acc, c) => acc + ((c.width || 300) / 1000) * ((c.depth || 450) / 1000) * hM,
      0,
    );
    const flFrameDL = (flBeamsVolM3 + flColsVolM3) * 25;

    // AAC / brick masonry infill wall load (~12 kN/m³ effective plastered AAC/hollow block, 0.85 openings factor)
    const flWallDL = isStilt
      ? 0
      : isTerrace
        ? areaM2 * 0.4 // Parapet allowance
        : fl.walls.reduce((acc, w) => {
            const lenM = Math.hypot(w.endPoint.x - w.startPoint.x, w.endPoint.y - w.startPoint.y) / 1000;
            const tM = (w.thickness || 150) / 1000;
            const clearH = Math.max(2.1, hM - 0.45);
            return acc + lenM * tM * clearH * 14 * 0.82;
          }, 0);

    const flFinishDL = areaM2 * (isTerrace ? 2.0 : floorFinishKnM2);

    // Weighted live load: 2.0 kN/m² habitable, 3.0 kN/m² balconies/corridors/stairs, 1.5 kN/m² terrace, 2.5 kN/m² stilt
    let flLL = areaM2 * residentialLiveLoadKnM2;
    if (isTerrace) {
      flLL = areaM2 * 1.5;
    } else if (isStilt) {
      flLL = areaM2 * 2.5;
    } else {
      const heavyAreaM2 = fl.rooms
        .filter(
          r =>
            r.type === RoomType.Balcony ||
            r.type === RoomType.Corridor ||
            r.type === RoomType.Staircase ||
            r.type === RoomType.Utility,
        )
        .reduce((acc, r) => acc + (r.area || 0) / 1_000_000, 0);
      const normalAreaM2 = Math.max(0, areaM2 - heavyAreaM2);
      flLL = normalAreaM2 * residentialLiveLoadKnM2 + heavyAreaM2 * balconyStairLiveLoadKnM2;
    }

    slabSelfWeightKn += flSlabDL;
    beamColumnSelfWeightKn += flFrameDL;
    masonryInfillLoadKn += flWallDL;
    floorFinishLoadKn += flFinishDL;
    totalLiveLoadKn += flLL;

    // IS 1893:2016 Table 10: 25% of LL for <= 3.0 kN/m², 0% for roof/terrace
    const llSeismicFactor = isTerrace ? 0 : 0.25;
    const wiKn = flSlabDL + flFrameDL + flWallDL + flFinishDL + flLL * llSeismicFactor;
    floorWeights.push({ floor: fl, elevM: round2(totalHeightM), wiKn });
  }

  const totalDeadLoadKn = slabSelfWeightKn + beamColumnSelfWeightKn + masonryInfillLoadKn + floorFinishLoadKn;
  const factoredTotalGravityKn = 1.5 * (totalDeadLoadKn + totalLiveLoadKn);
  const seismicWeightWKn = floorWeights.reduce((acc, fw) => acc + fw.wiKn, 0);

  // IS 1893:2016 Cl. 7.6.2 (RC moment frame without brick infill panels / conservative envelope)
  const fundamentalPeriodSec = Math.max(0.15, 0.075 * Math.pow(Math.max(3, totalHeightM), 0.75));
  // Medium soil (Type II) response spectrum Sa/g (IS 1893:2016 Cl. 6.4.2)
  const spectralAccelSag =
    fundamentalPeriodSec <= 0.55
      ? 2.5
      : fundamentalPeriodSec <= 4.0
        ? Math.min(2.5, 1.36 / fundamentalPeriodSec)
        : 0.34;
  const horizontalCoeffAh = (Z / 2) * (importanceFactor / responseReductionFactor) * spectralAccelSag;
  const designBaseShearVbKn = horizontalCoeffAh * seismicWeightWKn;

  const denomWh2 = floorWeights.reduce((acc, fw) => acc + fw.wiKn * fw.elevM * fw.elevM, 0) || 1;
  const rawQi = floorWeights.map(fw => (designBaseShearVbKn * fw.wiKn * fw.elevM * fw.elevM) / denomWh2);
  const storeyDistribution: StoreySeismicDistribution[] = floorWeights.map((fw, idx) => {
    let cumVi = 0;
    for (let k = idx; k < rawQi.length; k++) cumVi += rawQi[k]!;
    return {
      floorId: fw.floor.id,
      floorName: fw.floor.name,
      level: fw.floor.level,
      elevationM: fw.elevM,
      seismicWeightKn: round1(fw.wiKn),
      lateralForceQiKn: round1(rawQi[idx]!),
      cumulativeShearViKn: round1(cumVi),
    };
  });

  // 2. Column Schedule (IS 456:2000 Cl. 39.3 short axially loaded column preliminary sizing)
  const xGridAxes = clusterAxisCoords(columns.map(c => c.position.x));
  const yGridAxes = clusterAxisCoords(columns.map(c => c.position.y));
  const tributaryMap = refFloor ? computeColumnTributaryAreasM2(refFloor, columns) : new Map<string, number>();

  // Average unfactored floor load intensity (DL + LL) per m² over full building stack
  const stackLoadIntensityKnM2 = (totalDeadLoadKn + totalLiveLoadKn) / Math.max(10, typicalFloorAreaM2);

  const columnSchedule: ColumnScheduleRow[] = columns.map((col, idx) => {
    const tribM2 = round2(tributaryMap.get(col.id) ?? typicalFloorAreaM2 / Math.max(1, columns.length));
    const serviceLoadKn = round1(tribM2 * stackLoadIntensityKnM2);
    const factoredPuKn = round1(1.5 * serviceLoadKn);

    const agMm2 = col.width * col.depth;
    // Required steel Asc from Pu = 0.4*fck*(Ag - Asc) + 0.67*fy*Asc (with 0.85 biaxial eccentricity factor)
    const puN = factoredPuKn * 1000;
    const concreteOnlyN = 0.85 * 0.4 * fck * agMm2;
    const steelFactor = 0.85 * (0.67 * fy - 0.4 * fck);
    const reqAscMm2 = puN > concreteOnlyN ? (puN - concreteOnlyN) / Math.max(1, steelFactor) : 0.008 * agMm2;
    const maxAscMm2 = 0.04 * agMm2; // IS 456 Cl. 26.5.3.1(a): 4% practical lap limit
    const designAscMm2 = Math.min(maxAscMm2, Math.max(0.008 * agMm2, reqAscMm2));
    const axialCapacityKn = round1((0.85 * (0.4 * fck * (agMm2 - designAscMm2) + 0.67 * fy * designAscMm2)) / 1000);
    const utilizationRatio = round2(factoredPuKn / Math.max(1, axialCapacityKn));
    const { percent, callout } = suggestRebarCallout(col.width, col.depth, reqAscMm2);

    const xIdx = xGridAxes.findIndex(gx => Math.abs(gx - col.position.x) <= 180);
    const yIdx = yGridAxes.findIndex(gy => Math.abs(gy - col.position.y) <= 180);
    const gridCoordLabel = `${gridLetter(Math.max(0, xIdx))}-${Math.max(1, yIdx + 1)}`;

    return {
      gridRef: col.gridReference || `C${idx + 1}`,
      columnId: col.id,
      gridCoordLabel,
      xMm: Math.round(col.position.x),
      yMm: Math.round(col.position.y),
      widthMm: col.width,
      depthMm: col.depth,
      sectionLabel: `${col.width} × ${col.depth}`,
      tributaryAreaM2: tribM2,
      serviceLoadKn,
      factoredPuKn,
      axialCapacityKn,
      utilizationRatio,
      rebarPercent: percent,
      rebarCallout: callout,
      status: utilizationRatio <= 1.0 && percent <= 4.0 ? 'OK' : 'UPSIZE COLUMN',
    };
  });

  // 3. Beam Design Checks (IS 456:2000 Cl. 23.2.1 span/depth & limit state flexure/shear)
  const typicalFloorLoadKnM2 =
    (typicalSlabThicknessMm / 1000) * 25 + floorFinishKnM2 + residentialLiveLoadKnM2;

  const beamChecks: BeamDesignCheckRow[] = beams
    .map((beam, idx) => {
      const spanMm = Math.round(Math.hypot(beam.endPoint.x - beam.startPoint.x, beam.endPoint.y - beam.startPoint.y));
      const spanM = spanMm / 1000;
      const bMm = beam.widthMm || 230;
      const dTotalMm = beam.depthMm || 450;
      const effDepthMm = Math.max(200, dTotalMm - 40);

      // Tributary slab width + beam self-weight + masonry wall line load (10 kN/m on typical residential beams)
      const tribWidthM = beam.type === 'CANTILEVER' ? 1.5 : Math.min(3.5, Math.max(1.6, spanM * 0.55));
      const selfWtKnM = (bMm / 1000) * (dTotalMm / 1000) * 25;
      const wallLineKnM = beam.type === 'CANTILEVER' ? 2.5 : 8.5;
      const serviceUdlKnM = tribWidthM * typicalFloorLoadKnM2 + selfWtKnM + wallLineKnM;
      const wu = round2(1.5 * serviceUdlKnM);

      // Bending moment & shear coefficients (IS 456 Table 12 & 13 continuous vs cantilever)
      const mu =
        beam.type === 'CANTILEVER'
          ? round1((wu * spanM * spanM) / 2)
          : round1((wu * spanM * spanM) / 10);
      const vu =
        beam.type === 'CANTILEVER'
          ? round1(wu * spanM)
          : round1(0.6 * wu * spanM);

      const actualLd = round1(spanMm / effDepthMm);
      const allowLd = beam.type === 'CANTILEVER' ? 7 : beam.type === 'PRIMARY' ? 26 : 20;
      // Limiting moment capacity Mu,lim = 0.133 * fck * b * d² (for Fe500)
      const muLimKnM = (0.133 * fck * bMm * effDepthMm * effDepthMm) / 1_000_000;
      const status: BeamDesignCheckRow['status'] =
        actualLd <= allowLd && mu <= muLimKnM * 1.15 ? 'OK' : 'DEEPEN BEAM';

      const prefix = beam.type === 'PRIMARY' ? 'PB' : beam.type === 'SECONDARY' ? 'SB' : 'CB';
      return {
        beamId: beam.id,
        label: `${prefix}-${idx + 1}`,
        beamType: beam.type,
        spanMm,
        widthMm: bMm,
        depthMm: dTotalMm,
        sectionLabel: `${bMm} × ${dTotalMm}`,
        factoredUdlKnM: wu,
        factoredMuKnM: mu,
        factoredVuKn: vu,
        actualSpanDepthRatio: actualLd,
        allowableSpanDepthRatio: allowLd,
        status,
      };
    })
    .sort((a, b) => b.spanMm - a.spanMm);

  // 4. Slab Panel Check (governing habitable room panel on typical floor)
  let govLx = 3600;
  let govLy = 4500;
  if (refFloor) {
    for (const r of refFloor.rooms) {
      if (r.architecturalRole === 'OPEN_TO_SKY_VOID' || r.spaceUse === 'VOID') continue;
      const b = polygonBoundingBox(r.boundary);
      const lx = Math.min(b.width, b.height);
      const ly = Math.max(b.width, b.height);
      if (lx > govLx && lx <= 6000) {
        govLx = Math.round(lx);
        govLy = Math.round(ly);
      }
    }
  }
  const slabEffDepth = Math.max(95, typicalSlabThicknessMm - 25);
  const slabRatio = round2(govLy / Math.max(1, govLx));
  const slabAction: SlabDesignCheckSummary['slabAction'] = slabRatio <= 2.0 ? 'TWO_WAY' : 'ONE_WAY';
  const slabActualLd = round1(govLx / slabEffDepth);
  // IS 456 Cl. 24.1 + Fig 4 modification factor (~1.35 for light tension steel) -> 26 * 1.35 = 35 continuous two-way
  const slabAllowLd = slabAction === 'TWO_WAY' ? 35 : 26;
  const slabCheck: SlabDesignCheckSummary = {
    floorName: refFloor?.name ?? 'Typical Floor',
    thicknessMm: typicalSlabThicknessMm,
    governingShortSpanMm: govLx,
    governingLongSpanMm: govLy,
    aspectRatio: slabRatio,
    slabAction,
    factoredLoadKnM2: round2(1.5 * typicalFloorLoadKnM2),
    actualSpanDepthRatio: slabActualLd,
    allowableSpanDepthRatio: slabAllowLd,
    status: slabActualLd <= slabAllowLd ? 'OK' : 'INCREASE THICKNESS',
  };

  // 5. Footing Sizing Estimator from Editable Soil Safe Bearing Capacity (SBC)
  const preliminaryFootings = columnSchedule.map(row => {
    // 10% footing + backfill self-weight allowance per standard Indian foundation practice
    const requiredAreaM2 = round2((1.1 * row.serviceLoadKn) / sbc);
    const colRatio = row.depthMm / Math.max(1, row.widthMm);
    const rawW = Math.sqrt(requiredAreaM2 / Math.max(0.6, Math.min(1.6, colRatio)));
    const rawL = requiredAreaM2 / Math.max(0.6, rawW);
    // Round up to practical 100 mm increments (minimum 1,200 mm isolated pad)
    const widthMm = Math.max(1200, Math.ceil((rawW * 1000) / 100) * 100);
    const lengthMm = Math.max(1200, Math.ceil((rawL * 1000) / 100) * 100);
    const providedAreaM2 = (widthMm * lengthMm) / 1_000_000;
    const netBearingPressureKnM2 = round1(row.serviceLoadKn / Math.max(0.5, providedAreaM2));
    // Preliminary footing depth from cantilever projection & two-way punching shear
    const maxProjMm = Math.max((lengthMm - row.depthMm) / 2, (widthMm - row.widthMm) / 2);
    const depthMm = Math.max(350, Math.ceil(Math.max(maxProjMm * 0.45, Math.sqrt(row.factoredPuKn) * 14) / 50) * 50);

    return {
      row,
      requiredAreaM2,
      lengthMm,
      widthMm,
      depthMm,
      netBearingPressureKnM2,
    };
  });

  const footingSchedule: FootingScheduleRow[] = preliminaryFootings.map((f, i) => {
    const overlapsNeighbor = preliminaryFootings.some((other, j) => {
      if (i === j) return false;
      const dx = Math.abs(f.row.xMm - other.row.xMm);
      const dy = Math.abs(f.row.yMm - other.row.yMm);
      return dx < (f.widthMm + other.widthMm) / 2 + 100 && dy < (f.lengthMm + other.lengthMm) / 2 + 100;
    });
    return {
      gridRef: f.row.gridRef,
      columnSection: f.row.sectionLabel,
      serviceLoadKn: f.row.serviceLoadKn,
      requiredAreaM2: f.requiredAreaM2,
      lengthMm: f.lengthMm,
      widthMm: f.widthMm,
      depthMm: f.depthMm,
      footingLabel: `${(f.lengthMm / 1000).toFixed(1)} × ${(f.widthMm / 1000).toFixed(1)} × ${(f.depthMm / 1000).toFixed(2)} m`,
      netBearingPressureKnM2: f.netBearingPressureKnM2,
      footingType: overlapsNeighbor ? 'COMBINED RECOMMENDED' : 'ISOLATED',
    };
  });

  const columnsOk = columnSchedule.filter(c => c.status === 'OK').length;
  const columnsUpsize = columnSchedule.length - columnsOk;
  const beamsOk = beamChecks.filter(b => b.status === 'OK').length;
  const beamsDeepen = beamChecks.length - beamsOk;
  const maxColumnUtilization = columnSchedule.reduce((m, c) => Math.max(m, c.utilizationRatio), 0);

  return {
    codeStandards: [
      'IS 456:2000 (Limit State RCC Design)',
      'IS 875:1987 Parts 1 & 2 (Dead & Imposed Loads)',
      'IS 1893 (Part 1):2016 (Seismic Base Shear)',
    ],
    disclaimer:
      'Preliminary IS 456:2000 & IS 1893:2016 structural sizing computed deterministically from canonical framing geometry. Licensed structural engineer review, geotechnical soil investigation, and full 3D FEA (CSI ETABS .e2k) are required prior to construction.',
    inputs: {
      seismicZone,
      zoneFactorZ: Z,
      concreteGrade,
      fckMpa: fck,
      steelGrade,
      fyMpa: fy,
      safeBearingCapacityKnM2: sbc,
      importanceFactor,
      responseReductionFactor,
      floorFinishKnM2,
      residentialLiveLoadKnM2,
      balconyStairLiveLoadKnM2,
    },
    buildingSummary: {
      storeyCount: sortedFloors.length,
      totalHeightM: round2(totalHeightM),
      typicalFloorAreaM2: round1(typicalFloorAreaM2),
      columnCountPerFloor: columns.length,
      beamCountPerFloor: beams.length,
      primaryBeamCount: beams.filter(b => b.type === 'PRIMARY').length,
      secondaryBeamCount: beams.filter(b => b.type === 'SECONDARY').length,
      cantileverBeamCount: beams.filter(b => b.type === 'CANTILEVER').length,
      maxBeamSpanMm: beamChecks[0]?.spanMm ?? 0,
      typicalSlabThicknessMm,
    },
    gravitySummary: {
      slabSelfWeightKn: round1(slabSelfWeightKn),
      beamColumnSelfWeightKn: round1(beamColumnSelfWeightKn),
      masonryInfillLoadKn: round1(masonryInfillLoadKn),
      floorFinishLoadKn: round1(floorFinishLoadKn),
      totalDeadLoadKn: round1(totalDeadLoadKn),
      totalLiveLoadKn: round1(totalLiveLoadKn),
      factoredTotalGravityKn: round1(factoredTotalGravityKn),
    },
    seismicSummary: {
      seismicWeightWKn: round1(seismicWeightWKn),
      fundamentalPeriodSec: round2(fundamentalPeriodSec),
      spectralAccelSag: round2(spectralAccelSag),
      horizontalCoeffAh: Number(horizontalCoeffAh.toFixed(4)),
      designBaseShearVbKn: round1(designBaseShearVbKn),
      baseShearPercentW: round2(horizontalCoeffAh * 100),
      storeyDistribution,
    },
    columnSchedule,
    beamChecks,
    slabCheck,
    footingSchedule,
    healthSummary: {
      columnsOk,
      columnsUpsize,
      beamsOk,
      beamsDeepen,
      maxColumnUtilization: round2(maxColumnUtilization),
      overallStatus: columnsUpsize === 0 && beamsDeepen === 0 && slabCheck.status === 'OK'
        ? 'PASS_PRELIMINARY'
        : 'REVIEW_REQUIRED',
    },
  };
}

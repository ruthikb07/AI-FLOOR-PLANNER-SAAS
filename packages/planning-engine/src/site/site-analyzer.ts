/**
 * Site Analyzer for Architectural Planning.
 *
 * Evaluates plot geometry, road-facing orientation, buildable envelope,
 * access gates, parking bay sizing, and daylight axes before building massing begins.
 */

import type {
  Direction,
  PlotShape,
  Setbacks,
  DesignRequirementSpecification,
} from '@ai-floor-planner/core';

export interface SiteAnalysisResult {
  readonly plotWidthMm: number;
  readonly plotDepthMm: number;
  readonly plotAreaMm2: number;
  readonly roadFacing: Direction;
  readonly setbacksMm: Setbacks;
  readonly buildableEnvelope: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly depth: number;
    readonly areaMm2: number;
  };
  readonly frontageWidthMm: number;
  readonly isNarrowLot: boolean;
  readonly isDeepLot: boolean;
  readonly isSquareLot: boolean;
  readonly isIrregular: boolean;
  readonly parkingZone: {
    readonly side: 'left' | 'right';
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly depth: number;
    readonly areaMm2: number;
    readonly spaces: number;
  };
  readonly arrivalZone: {
    readonly side: 'left' | 'right';
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly depth: number;
  };
  readonly solarOrientation: {
    readonly morningSun: Direction;
    readonly afternoonSun: Direction;
    readonly primaryDaylight: Direction;
  };
}

const MIN_CAR_PARKING_WIDTH_MM = 3200; // 3.2m (~10.5 ft)
const MIN_CAR_PARKING_DEPTH_MM = 5000; // 5.0m (~16.4 ft)

export class SiteAnalyzer {
  analyze(spec: DesignRequirementSpecification): SiteAnalysisResult {
    const isFullPlot = !!spec.hard.fullPlotCoverage;
    const plotWidthMm = spec.hard.plotWidthMm;
    const plotDepthMm = spec.hard.plotDepthMm;
    const plotAreaMm2 = plotWidthMm * plotDepthMm;
    const roadFacing = spec.hard.roadFacing;

    const rawSetbacks = isFullPlot
      ? { front: 0, rear: 0, left: 0, right: 0 }
      : (spec.setbacksMm ?? {
          front: Math.min(2500, Math.max(1200, Math.round(plotDepthMm * 0.1))),
          rear: Math.min(1800, Math.max(1000, Math.round(plotDepthMm * 0.08))),
          left: Math.min(1500, Math.max(900, Math.round(plotWidthMm * 0.08))),
          right: Math.min(1500, Math.max(900, Math.round(plotWidthMm * 0.08))),
        });

    const envX = rawSetbacks.left;
    const envY = rawSetbacks.front;
    const envW = Math.max(3000, plotWidthMm - rawSetbacks.left - rawSetbacks.right);
    const envD = Math.max(3000, plotDepthMm - rawSetbacks.front - rawSetbacks.rear);

    const frontageWidthMm = (roadFacing === 'north' || roadFacing === 'south') ? plotWidthMm : plotDepthMm;
    const isNarrowLot = frontageWidthMm < 10500; // Under ~34 ft (like 28' and 29.5' references)
    const isDeepLot = plotDepthMm / Math.max(1, plotWidthMm) >= 1.4;
    const isSquareLot = Math.abs(plotWidthMm - plotDepthMm) / Math.max(plotWidthMm, plotDepthMm) <= 0.15;
    const isIrregular = spec.plotShape !== undefined && spec.plotShape !== ('rectangular' as PlotShape);

    const parkingRequested = spec.hard.parkingRequired || spec.hard.parkingSpacesCount > 0;
    const spaces = Math.max(parkingRequested ? 1 : 0, spec.hard.parkingSpacesCount);
    const parkSide: 'left' | 'right' = (roadFacing === 'south' || roadFacing === 'west') ? 'right' : 'left';

    const parkW = Math.max(MIN_CAR_PARKING_WIDTH_MM, Math.min(4200, Math.round(plotWidthMm * 0.4)));
    const parkD = Math.max(MIN_CAR_PARKING_DEPTH_MM, Math.min(6000, Math.round(plotDepthMm * 0.35)));

    const parkX = parkSide === 'left' ? rawSetbacks.left : plotWidthMm - rawSetbacks.right - parkW;
    const parkY = rawSetbacks.front;

    const arrivalSide: 'left' | 'right' = parkSide === 'left' ? 'right' : 'left';
    const arrivalW = Math.max(2000, plotWidthMm - rawSetbacks.left - rawSetbacks.right - parkW);
    const arrivalD = Math.min(parkD, 2500);
    const arrivalX = arrivalSide === 'right' ? parkX + parkW : rawSetbacks.left;
    const arrivalY = rawSetbacks.front;

    return {
      plotWidthMm,
      plotDepthMm,
      plotAreaMm2,
      roadFacing,
      setbacksMm: rawSetbacks,
      buildableEnvelope: {
        x: envX,
        y: envY,
        width: envW,
        depth: envD,
        areaMm2: envW * envD,
      },
      frontageWidthMm,
      isNarrowLot,
      isDeepLot,
      isSquareLot,
      isIrregular,
      parkingZone: {
        side: parkSide,
        x: parkX,
        y: parkY,
        width: parkW,
        depth: parkD,
        areaMm2: parkW * parkD,
        spaces,
      },
      arrivalZone: {
        side: arrivalSide,
        x: arrivalX,
        y: arrivalY,
        width: arrivalW,
        depth: arrivalD,
      },
      solarOrientation: {
        morningSun: 'east' as Direction,
        afternoonSun: 'west' as Direction,
        primaryDaylight: 'north' as Direction,
      },
    };
  }
}

/**
 * Building Massing & Articulated Footprint Generator.
 *
 * Implements non-rectangular, site-aware massing strategies:
 * - L-Shape Massing with front parking bay & arrival court (References 1 & 2)
 * - Courtyard & Central OTS Light Wells (References 2 & 3)
 * - Stepped / Offset Wing Massing with service articulation (Reference 3)
 * - Compact Massing with large front garden court
 * - Differentiated floor footprints between Ground and Upper levels
 */

import type {
  Point,
  Polygon,
  RoomProgram,
} from '@ai-floor-planner/core';
import type { SiteAnalysisResult } from '../site/site-analyzer';
import type { ArchitecturalStrategyProfile } from '../strategy/design-strategy';

export interface MassingFootprintPlan {
  readonly floorLevel: number;
  readonly boundary: Polygon;
  readonly boundingBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly depth: number;
  };
  readonly parkingBay?: {
    readonly polygon: Polygon;
    readonly width: number;
    readonly depth: number;
  };
  readonly porch?: {
    readonly polygon: Polygon;
    readonly width: number;
    readonly depth: number;
  };
  readonly otsWells: readonly {
    readonly id: string;
    readonly polygon: Polygon;
    readonly width: number;
    readonly depth: number;
  }[];
  readonly balconies: readonly Polygon[];
  readonly strategy: ArchitecturalStrategyProfile;
}

export class MassingGenerator {
  generateMassing(
    siteAnalysis: SiteAnalysisResult,
    strategy: ArchitecturalStrategyProfile,
    _program: RoomProgram,
    floorLevel: number,
    isFullPlot = false,
  ): MassingFootprintPlan {
    const kind = isFullPlot ? 'compact_frontage' : strategy.footprintStrategy;

    // Full Plot Construction (user explicitly enabled 100% building plate)
    if (isFullPlot) {
      return this.generateFullPlotMassing(siteAnalysis, strategy, floorLevel);
    }

    switch (kind) {
      case 'l_shape_court':
        return this.generateLShapeMassing(siteAnalysis, strategy, floorLevel);
      case 'courtyard_centered':
        return this.generateCourtyardOTSMassing(siteAnalysis, strategy, floorLevel);
      case 'offset_stepped':
        return this.generateOffsetSteppedMassing(siteAnalysis, strategy, floorLevel);
      case 'compact_frontage':
      default:
        return this.generateCompactMassing(siteAnalysis, strategy, floorLevel);
    }
  }

  /**
   * 1. L-Shape Massing: Carves an off-street parking bay and entry porch into the front
   * footprint, creating an L-shaped ground floor (as in References 1 & 2).
   * Upper floors cantilever/extend over parking to form a front balcony.
   */
  private generateLShapeMassing(
    site: SiteAnalysisResult,
    strategy: ArchitecturalStrategyProfile,
    floorLevel: number,
  ): MassingFootprintPlan {
    const env = site.buildableEnvelope;
    const park = site.parkingZone;

    // Ground Floor: L-shaped with parking cutout
    if (floorLevel === 0) {
      const maxAllowedW = Math.max(3000, env.width - 4000);
      const cutoutW = Math.min(park.width, Math.min(maxAllowedW, Math.max(3500, Math.round(env.width * 0.40))));
      const maxAllowedD = Math.max(2200, Math.min(2500, Math.round(env.depth * 0.24)));
      const cutoutD = Math.min(park.depth, maxAllowedD);

      // 6-point L-shape polygon with front-left cutout
      // Points: Top-right, Bottom-right, Bottom-left, Inner-corner, Inner-top, etc.
      const points: Point[] = park.side === 'left'
        ? [
            { x: env.x + cutoutW, y: env.y },
            { x: env.x + env.width, y: env.y },
            { x: env.x + env.width, y: env.y + env.depth },
            { x: env.x, y: env.y + env.depth },
            { x: env.x, y: env.y + cutoutD },
            { x: env.x + cutoutW, y: env.y + cutoutD },
          ]
        : [
            { x: env.x, y: env.y },
            { x: env.x + env.width - cutoutW, y: env.y },
            { x: env.x + env.width - cutoutW, y: env.y + cutoutD },
            { x: env.x + env.width, y: env.y + cutoutD },
            { x: env.x + env.width, y: env.y + env.depth },
            { x: env.x, y: env.y + env.depth },
          ];

      const parkPoly: Polygon = {
        points: [
          { x: park.x, y: park.y },
          { x: park.x + cutoutW, y: park.y },
          { x: park.x + cutoutW, y: park.y + cutoutD },
          { x: park.x, y: park.y + cutoutD },
        ],
      };

      const porchW = Math.min(2500, env.width - cutoutW);
      const porchD = 1800;
      const porchPoly: Polygon = {
        points: [
          { x: park.side === 'left' ? env.x + cutoutW : env.x + env.width - cutoutW - porchW, y: env.y },
          { x: (park.side === 'left' ? env.x + cutoutW : env.x + env.width - cutoutW - porchW) + porchW, y: env.y },
          { x: (park.side === 'left' ? env.x + cutoutW : env.x + env.width - cutoutW - porchW) + porchW, y: env.y + porchD },
          { x: park.side === 'left' ? env.x + cutoutW : env.x + env.width - cutoutW - porchW, y: env.y + porchD },
        ],
      };

      return {
        floorLevel,
        boundary: { points },
        boundingBox: { x: env.x, y: env.y, width: env.width, depth: env.depth },
        parkingBay: { polygon: parkPoly, width: cutoutW, depth: cutoutD },
        porch: { polygon: porchPoly, width: porchW, depth: porchD },
        otsWells: [],
        balconies: [],
        strategy,
      };
    }

    // Upper Floor: Extends forward, with a dedicated front road balcony over the parking
    const balconyDepth = 1500;
    const balconyW = Math.min(Math.round(env.width * 0.45), park.width);
    const balconyPoly: Polygon = {
      points: [
        { x: env.x, y: env.y },
        { x: env.x + balconyW, y: env.y },
        { x: env.x + balconyW, y: env.y + balconyDepth },
        { x: env.x, y: env.y + balconyDepth },
      ],
    };

    const upperPoints: Point[] = [
      { x: env.x, y: env.y },
      { x: env.x + env.width, y: env.y },
      { x: env.x + env.width, y: env.y + env.depth },
      { x: env.x, y: env.y + env.depth },
    ];

    return {
      floorLevel,
      boundary: { points: upperPoints },
      boundingBox: { x: env.x, y: env.y, width: env.width, depth: env.depth },
      otsWells: [],
      balconies: [balconyPoly],
      strategy,
    };
  }

  /**
   * 2. Courtyard & OTS Centered Massing:
   * Embeds an Open-To-Sky (OTS) light well in the core/rear to ventilate internal wet areas (Reference 2 & 3).
   */
  private generateCourtyardOTSMassing(
    site: SiteAnalysisResult,
    strategy: ArchitecturalStrategyProfile,
    floorLevel: number,
  ): MassingFootprintPlan {
    const env = site.buildableEnvelope;
    const otsW = 1200; // 1.2m (4 ft)
    const otsD = 1500; // 1.5m (5 ft)
    const otsX = env.x + Math.round(env.width * 0.5) - Math.round(otsW / 2);
    const otsY = env.y + Math.round(env.depth * 0.55);

    const otsPoly: Polygon = {
      points: [
        { x: otsX, y: otsY },
        { x: otsX + otsW, y: otsY },
        { x: otsX + otsW, y: otsY + otsD },
        { x: otsX, y: otsY + otsD },
      ],
    };

    const points: Point[] = [
      { x: env.x, y: env.y },
      { x: env.x + env.width, y: env.y },
      { x: env.x + env.width, y: env.y + env.depth },
      { x: env.x, y: env.y + env.depth },
    ];

    return {
      floorLevel,
      boundary: { points },
      boundingBox: { x: env.x, y: env.y, width: env.width, depth: env.depth },
      otsWells: [{ id: 'central-ots-well', polygon: otsPoly, width: otsW, depth: otsD }],
      balconies: [],
      strategy,
    };
  }

  /**
   * 3. Offset Stepped Massing:
   * Staggers two wings laterally to create articulated garden and service pockets (Reference 3).
   */
  private generateOffsetSteppedMassing(
    site: SiteAnalysisResult,
    strategy: ArchitecturalStrategyProfile,
    floorLevel: number,
  ): MassingFootprintPlan {
    const env = site.buildableEnvelope;
    const stepX = Math.round(env.width * 0.55);
    const stepOffset = Math.min(1200, Math.round(env.depth * 0.10));

    // Stepped front and rear boundaries
    const points: Point[] = [
      { x: env.x, y: env.y + stepOffset },
      { x: env.x + stepX, y: env.y + stepOffset },
      { x: env.x + stepX, y: env.y },
      { x: env.x + env.width, y: env.y },
      { x: env.x + env.width, y: env.y + env.depth - stepOffset },
      { x: env.x + stepX, y: env.y + env.depth - stepOffset },
      { x: env.x + stepX, y: env.y + env.depth },
      { x: env.x, y: env.y + env.depth },
    ];

    return {
      floorLevel,
      boundary: { points },
      boundingBox: { x: env.x, y: env.y, width: env.width, depth: env.depth },
      otsWells: [],
      balconies: [],
      strategy,
    };
  }

  /**
   * 4. Compact Massing:
   * Proportional rectangular massing set back to allow front parking & garden.
   */
  private generateCompactMassing(
    site: SiteAnalysisResult,
    strategy: ArchitecturalStrategyProfile,
    floorLevel: number,
  ): MassingFootprintPlan {
    const env = site.buildableEnvelope;
    const points: Point[] = [
      { x: env.x, y: env.y },
      { x: env.x + env.width, y: env.y },
      { x: env.x + env.width, y: env.y + env.depth },
      { x: env.x, y: env.y + env.depth },
    ];

    return {
      floorLevel,
      boundary: { points },
      boundingBox: { x: env.x, y: env.y, width: env.width, depth: env.depth },
      otsWells: [],
      balconies: [],
      strategy,
    };
  }

  /**
   * 5. Full Plot Massing: Covers 100% of the plot on Ground Floor.
   */
  private generateFullPlotMassing(
    site: SiteAnalysisResult,
    strategy: ArchitecturalStrategyProfile,
    floorLevel: number,
  ): MassingFootprintPlan {
    const w = site.plotWidthMm;
    const d = site.plotDepthMm;

    if (floorLevel === 0) {
      return {
        floorLevel,
        boundary: {
          points: [
            { x: 0, y: 0 },
            { x: w, y: 0 },
            { x: w, y: d },
            { x: 0, y: d },
          ],
        },
        boundingBox: { x: 0, y: 0, width: w, depth: d },
        otsWells: [],
        balconies: [],
        strategy,
      };
    }

    // Upper floor steps back slightly at the front to form a terrace
    const setbackFront = Math.min(2500, Math.round(d * 0.12));
    return {
      floorLevel,
      boundary: {
        points: [
          { x: 0, y: setbackFront },
          { x: w, y: setbackFront },
          { x: w, y: d },
          { x: 0, y: d },
        ],
      },
      boundingBox: { x: 0, y: setbackFront, width: w, depth: d - setbackFront },
      otsWells: [],
      balconies: [],
      strategy,
    };
  }
}

/**
 * Staircase Geometry Foundation.
 * Manages stair bounding envelopes, flight geometry, landing zones, and building code compliance.
 * All measurements in millimeters.
 */

import type { Stair, Polygon, BoundingBox, LineSegment } from '@ai-floor-planner/core';
import { createRect } from './rectangle';
import { containsPolygon, polygonArea, polygonBoundingBox } from './polygon';
import { Direction, StairType } from '@ai-floor-planner/core';

export interface StairSolid {
  readonly boundary: Polygon;
  readonly bottom: number;
  readonly top: number;
  readonly kind: 'tread' | 'landing';
}

/** Architectural geometry only. No headroom, reinforcement or code certification. */
export function computeStairSolids(stair: Stair, rise = stair.riserCount * stair.riserHeight): {
  solids: StairSolid[]; issues: string[];
} {
  const issues: string[] = [];
  const sideways = stair.direction === Direction.East || stair.direction === Direction.West;
  const width = sideways ? stair.length : stair.width;
  const length = sideways ? stair.width : stair.length;
  const n = stair.riserCount, r = stair.riserHeight, t = stair.treadDepth;
  if (![width, length, n, r, t, rise].every(value => Number.isFinite(value) && value > 0)
    || !Number.isInteger(n) || n < 2 || n > 200) return { solids: [], issues: ['Invalid stair dimensions or riser count.'] };
  if (Math.abs(n * r - rise) > 1) issues.push('Stair rise does not match the connected floor elevation.');
  if (!containsPolygon(stair.boundary, createRect(stair.x, stair.y, stair.width, stair.length))
    || Math.abs(polygonArea(stair.boundary) - stair.width * stair.length) > 1) issues.push('Stair boundary and rectangular flight envelope disagree.');
  if (stair.type === StairType.UShaped && n % 2 !== 0) issues.push('Unequal U-stair flights require a reviewed landing model.');
  if (![StairType.Straight, StairType.UShaped].includes(stair.type)) issues.push('This stair type needs a reviewed flight model; no substitute flight is fabricated.');
  const first = Math.ceil(n / 2), second = n - first;
  const landing = stair.landingWidth;
  const run = stair.type === StairType.UShaped ? Math.max(first - 1, second - 1) * t + landing : (n - 1) * t;
  if (run > length + 1 || (stair.type === StairType.UShaped && (!(landing > 0) || landing > length))) issues.push('Flights and turning landing do not fit the stair envelope.');
  if (issues.length) return { solids: [], issues };
  const point = (x: number, y: number) => {
    if (stair.direction === Direction.South) return { x: stair.x + width - x, y: stair.y + length - y };
    if (stair.direction === Direction.East) return { x: stair.x + length - y, y: stair.y + x };
    if (stair.direction === Direction.West) return { x: stair.x + y, y: stair.y + width - x };
    return { x: stair.x + x, y: stair.y + y };
  };
  const solids: StairSolid[] = [];
  const add = (x: number, y: number, w: number, h: number, top: number, kind: StairSolid['kind'], bottom = 0) => {
    solids.push({ boundary: { points: [point(x, y), point(x + w, y), point(x + w, y + h), point(x, y + h)] }, bottom, top, kind });
  };
  if (stair.type === StairType.UShaped) {
    const flight = width / 2;
    for (let i = 1; i < first; i++) add(0, length - i * t, flight, t, i * r, 'tread');
    // Use all available turning space; never stretch the specified treads.
    add(0, 0, width, length - (first - 1) * t, first * r, 'landing');
    for (let i = 1; i < second; i++) add(flight, length - (second - i) * t, flight, t, (first + i) * r, 'tread', first * r);
  } else {
    for (let i = 1; i < n; i++) add(0, length - i * t, width, t, i * r, 'tread');
  }
  return { solids, issues };
}

export interface StairGeometryInfo {
  readonly boundary: Polygon;
  readonly boundingBox: BoundingBox;
  readonly totalArea: number;
  readonly landingPolygon: Polygon;
  readonly walkline: LineSegment;
  readonly flightPolygons: Polygon[];
}

export interface StairValidationResult {
  readonly valid: boolean;
  readonly errors: string[];
  readonly warnings: string[];
}

/** Compute derived geometric structures for a staircase. */
export function computeStairGeometry(stair: Stair): StairGeometryInfo {
  const boundary = stair.boundary && stair.boundary.points.length >= 3
    ? stair.boundary
    : createRect(stair.x, stair.y, stair.width, stair.length);

  const bbox = polygonBoundingBox(boundary);
  const totalArea = polygonArea(boundary);

  // Landing polygon: standard rectangular region at top/bottom of flight
  const landingWidth = stair.landingWidth || stair.width;
  const landingPolygon = createRect(stair.x, stair.y, stair.width, landingWidth);

  // Walkline along center of flight
  const walkline: LineSegment = {
    start: { x: stair.x + stair.width / 2, y: stair.y },
    end: { x: stair.x + stair.width / 2, y: stair.y + stair.length },
  };

  return {
    boundary,
    boundingBox: bbox,
    totalArea,
    landingPolygon,
    walkline,
    flightPolygons: [boundary],
  };
}

/** Compute the clearance envelope required for a staircase (including headroom and landings). */
export function computeStairClearanceEnvelope(stair: Stair): Polygon {
  return stair.boundary && stair.boundary.points.length >= 3
    ? stair.boundary
    : createRect(stair.x, stair.y, stair.width, stair.length);
}

/**
 * Validate staircase dimensions against standard architectural building codes (NBC / IBC):
 * - Minimum tread depth: 250mm (recommended 280-300mm)
 * - Maximum riser height: 190mm (recommended 150-175mm)
 * - Minimum stair width: 900mm (residential), 1200mm (commercial)
 * - Blondel's rule: 2 * Riser + Tread should be between 600mm and 650mm
 * - Landing width >= flight width
 */
export function validateStairDimensions(stair: Stair): StairValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Width checks
  if (stair.width < 800) {
    errors.push(`Stair flight width (${stair.width}mm) is below minimum building code standard (800mm)`);
  } else if (stair.width < 900) {
    warnings.push(`Stair flight width (${stair.width}mm) is narrow (900mm+ recommended for comfort)`);
  }

  // Riser checks
  if (stair.riserHeight > 200) {
    errors.push(`Riser height (${stair.riserHeight}mm) exceeds maximum building code limit (200mm)`);
  } else if (stair.riserHeight < 100) {
    errors.push(`Riser height (${stair.riserHeight}mm) is too low (minimum 100mm)`);
  }

  // Tread checks
  if (stair.treadDepth < 230) {
    errors.push(`Tread depth (${stair.treadDepth}mm) is below minimum safe limit (230mm)`);
  }

  // Blondel's formula: 2R + T ≈ 600mm - 650mm
  const blondel = 2 * stair.riserHeight + stair.treadDepth;
  if (blondel < 580 || blondel > 680) {
    warnings.push(`Stair ergonomic ratio 2R + T (${blondel}mm) is outside optimal comfort range (600mm–650mm)`);
  }

  // Landing checks
  if (stair.landingWidth > 0 && stair.landingWidth < stair.width) {
    warnings.push(`Landing width (${stair.landingWidth}mm) should be at least equal to flight width (${stair.width}mm)`);
  }

  // Total floor connection
  if (stair.connectsFloors[0] === stair.connectsFloors[1]) {
    errors.push(`Stair connectsFloors must connect two different levels (received [${stair.connectsFloors.join(', ')}])`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

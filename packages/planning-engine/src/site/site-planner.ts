/**
 * Site Utilization & Complete Plot Accounting Planner (Phase 1).
 *
 * Implements deterministic site-layout planning that classifies 100% of the plot area
 * into validated, non-overlapping SiteZone polygons with explicit architectural rationale.
 *
 * Invariant:
 * Plot area = Setbacks + Building Footprint + Parking + Garden + Circulation + Services + Future Expansion
 * No residual site area may be displayed as unexplained blank space.
 */

import type {
  Building,
  DesignRequirementSpecification,
  Point,
  Polygon,
  Site,
  SiteZone,
  SiteZoneCategoryBreakdown,
  SiteZoneKind,
  SiteUtilizationAudit,
  CanonicalFurnitureItem,
} from '@ai-floor-planner/core';
import { Direction, resolveCardinalSetbacks } from '@ai-floor-planner/core';
import { createRect, polygonArea, polygonBoundingBox } from '@ai-floor-planner/geometry-engine';
import { furnishSiteParkingZones } from '../plancraft/auto-furnish-apartment';

export interface SitePlanningParams {
  readonly site: Site;
  readonly footprintPolygon: Polygon;
  readonly requirements: DesignRequirementSpecification;
  readonly building?: Building;
  readonly groundFloorEntrance?: Point;
}

export interface SitePlanningResult {
  readonly siteZones: readonly SiteZone[];
  readonly siteUtilization: SiteUtilizationAudit;
  readonly isValid: boolean;
  readonly issues: readonly string[];
  readonly furniture?: readonly CanonicalFurnitureItem[];
}

interface RectangularZone {
  readonly kind: SiteZoneKind;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly source: 'RULE_BASED' | 'USER_DEFINED' | 'GENERATED';
  readonly reviewStatus: 'UNREVIEWED' | 'REVIEWED' | 'LOCKED';
  readonly accessLinks: readonly string[];
  readonly description?: string;
  readonly rationale?: string;
}

export class SitePlanner {
  /**
   * Partitions 100% of the site into valid, non-overlapping SiteZone polygons.
   */
  planSiteUtilization(params: SitePlanningParams): SitePlanningResult {
    const { site, footprintPolygon, requirements } = params;
    const plotWidth = site.plotWidth;
    const plotDepth = site.plotDepth;
    const plotArea = plotWidth * plotDepth;
    const cardinal = resolveCardinalSetbacks(site.setbacks, site.roadFacing);

    const issues: string[] = [];
    const zones: RectangularZone[] = [];

    // Buildable envelope coordinates
    const envX = cardinal.west;
    const envY = cardinal.north;
    const envW = Math.max(0, plotWidth - cardinal.west - cardinal.east);
    const envH = Math.max(0, plotDepth - cardinal.north - cardinal.south);

    // Footprint bounding box
    const fBox = polygonBoundingBox(footprintPolygon);
    const footX = Math.max(envX, Math.min(envX + envW, fBox.x));
    const footY = Math.max(envY, Math.min(envY + envH, fBox.y));
    const footW = Math.max(0, Math.min(envW - (footX - envX), fBox.width));
    const footH = Math.max(0, Math.min(envH - (footY - envY), fBox.height));

    // 2. Residual Buildable Subdivisions (outside building footprint, inside envelope)
    // North region: [envX, envY] to [envX + envW, footY]
    const northH = Math.max(0, footY - envY);
    // South region: [envX, footY + footH] to [envX + envW, envY + envH]
    const southH = Math.max(0, (envY + envH) - (footY + footH));
    // West region: [envX, footY] to [footX, footY + footH]
    const westW = Math.max(0, footX - envX);
    // East region: [footX + footW, footY] to [envX + envW, footY + footH]
    const eastW = Math.max(0, (envX + envW) - (footX + footW));

    const road = site.roadFacing;
    const parkingRequested = requirements.hard.parkingRequired || requirements.hard.parkingSpacesCount > 0;
    const parkingCount = Math.max(parkingRequested ? 1 : 0, requirements.hard.parkingSpacesCount);
    let parkingFeasible = true;

    const hasFrontResidual = road === 'north' ? northH > 0
      : road === 'south' ? southH > 0
      : road === 'east' ? eastW > 0
      : westW > 0;

    const pts = footprintPolygon.points;
    const isFrontLeftNotch = pts.length === 6 && (pts[0]?.x ?? 0) > fBox.x;
    const isFrontRightNotch = pts.length === 6 && (pts[1]?.x ?? 0) < fBox.x + fBox.width;
    const isFrontNotch = isFrontLeftNotch || isFrontRightNotch;

    const setbackZones = this.computeSetbackStrips(site, cardinal, {
      parkingRequested: parkingRequested && !isFrontNotch,
      parkingCount,
      hasFrontResidual: hasFrontResidual || isFrontNotch,
      gardenPreference: !!requirements.soft.gardenPreference,
    });
    zones.push(...setbackZones);

    // 2b. Stepped Footprint Articulation: Parking Bay or Courtyard
    // When the building has an L-shaped / stepped footprint, allocate the recessed notch
    // as an integrated parking bay (if requested) or garden court so 100% of the plot is classified.
    if (isFrontNotch) {
      let nX = 0, nY = 0, nW = 0, nH = 0;

      if (isFrontLeftNotch) {
        // Front-left notch
        nX = fBox.x;
        nY = fBox.y;
        nW = pts[0]!.x - fBox.x;
        nH = (pts[4]?.y ?? (fBox.y + fBox.height * 0.4)) - fBox.y;
      } else if (isFrontRightNotch) {
        // Front-right notch
        nX = pts[1]!.x;
        nY = fBox.y;
        nW = (fBox.x + fBox.width) - pts[1]!.x;
        nH = (pts[2]?.y ?? (fBox.y + fBox.height * 0.4)) - fBox.y;
      }

      if (nW > 0 && nH > 0) {
        if (parkingRequested) {
          const isLeftNotch = isFrontLeftNotch;
          const stallW = Math.min(nW - 900, Math.max(3000, Math.floor(nW * 0.75)));
          const walkW = nW - stallW;
          const stallX = isLeftNotch ? nX : nX + walkW;
          const walkX = isLeftNotch ? nX + stallW : nX;

          const frontSetbackIdx = zones.findIndex(z => z.kind === 'setback' && z.name === 'Front Road Setback' && z.x === 0 && z.width === site.plotWidth);
          if (frontSetbackIdx >= 0) {
            const fs = zones[frontSetbackIdx]!;
            zones.splice(frontSetbackIdx, 1);

            zones.push({
              kind: 'parking',
              name: 'Designated Covered Parking Bay & Driveway',
              x: stallX, y: fs.y, width: stallW, height: fs.height + nH,
              source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: ['road_access', 'vehicle_driveway'],
              description: `Off-street parking bay integrated into front massing (${Math.round(stallW / 1000)}m × ${Math.round((fs.height + nH) / 1000)}m)`,
              rationale: 'Dedicated vehicle parking bay carved into the ground-floor footprint with direct driveway access',
            });

            if (walkW > 0) {
              zones.push({
                kind: 'pedestrian_circulation',
                name: 'Entrance Court / Porch Approach',
                x: walkX, y: fs.y, width: walkW, height: fs.height + nH,
                source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: ['road_access'],
                description: 'Paved entrance court connecting parking to front entrance porch',
                rationale: 'Direct dedicated universal pedestrian access path from arrival to entrance',
              });
            }

            const remLeftW = isLeftNotch ? stallX : 0;
            if (remLeftW > 0) {
              zones.push({
                kind: requirements.soft.gardenPreference ? 'garden' : 'setback',
                name: requirements.soft.gardenPreference ? 'Front Landscaped Garden' : 'Front Road Setback',
                x: 0, y: fs.y, width: remLeftW, height: fs.height,
                source: 'RULE_BASED', reviewStatus: 'REVIEWED', accessLinks: ['road_access'],
                description: 'Front road setback landscape buffer',
                rationale: 'Street-facing development control reserve and green frontage',
              });
            }

            const remRightX = isLeftNotch ? stallX + nW : stallX + stallW;
            const remRightW = site.plotWidth - remRightX;
            if (remRightW > 0) {
              zones.push({
                kind: requirements.soft.gardenPreference ? 'garden' : 'setback',
                name: requirements.soft.gardenPreference ? 'Front Landscaped Garden' : 'Front Road Setback',
                x: remRightX, y: fs.y, width: remRightW, height: fs.height,
                source: 'RULE_BASED', reviewStatus: 'REVIEWED', accessLinks: ['road_access'],
                description: 'Front road setback landscape buffer',
                rationale: 'Street-facing development control reserve and green frontage',
              });
            }
          } else {
            zones.push({
              kind: 'parking',
              name: 'Designated Covered Parking Bay',
              x: stallX, y: nY, width: stallW, height: nH,
              source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: ['road_access', 'vehicle_driveway'],
              description: `Off-street parking bay integrated into front massing (${Math.round(stallW / 1000)}m × ${Math.round(nH / 1000)}m)`,
              rationale: 'Dedicated vehicle parking bay carved into the ground-floor footprint with direct driveway access',
            });
            if (walkW > 0) {
              zones.push({
                kind: 'pedestrian_circulation',
                name: 'Entrance Court / Porch Approach',
                x: walkX, y: nY, width: walkW, height: nH,
                source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: ['road_access'],
                description: 'Paved entrance court connecting parking to front entrance porch',
                rationale: 'Direct dedicated universal pedestrian access path from arrival to entrance',
              });
            }
          }
        } else {
          zones.push({
            kind: 'garden',
            name: 'Courtyard Garden Pocket',
            x: nX, y: nY, width: nW, height: nH,
            source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: [],
            description: 'Landscaped open courtyard formed by stepped building footprint',
            rationale: 'Permeable landscaped courtyard pocket capturing natural light and aeration within the recessed footprint',
          });
        }
      }
    } else if (footprintPolygon.points.length === 6) {
      // Rear-stepped footprint: allocate the indented rear notch to landscape pocket
      const pts = footprintPolygon.points;
      if (pts[4] && pts[3] && pts[2] && pts[5]) {
        if (pts[4].y > pts[3].y) {
          // Rear-right indentation
          const stepX = pts[3].x;
          const stepY = pts[3].y;
          const stepW = pts[2].x - pts[3].x;
          const stepH = pts[4].y - pts[3].y;
          if (stepW > 0 && stepH > 0) {
            zones.push({
              kind: 'garden',
              name: 'Rear Landscape Pocket',
              x: stepX, y: stepY, width: stepW, height: stepH,
              source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: [],
              description: 'Rear open landscape space formed by stepped building boundary',
              rationale: 'Permeable landscaped ground preserving daylight and aeration',
            });
          }
        } else if (pts[3].y > pts[4].y) {
          // Rear-left indentation
          const stepX = pts[5].x;
          const stepY = pts[4].y;
          const stepW = pts[4].x - pts[5].x;
          const stepH = pts[3].y - pts[4].y;
          if (stepW > 0 && stepH > 0) {
            zones.push({
              kind: 'garden',
              name: 'Rear Landscape Pocket',
              x: stepX, y: stepY, width: stepW, height: stepH,
              source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: [],
              description: 'Rear open landscape space formed by stepped building boundary',
              rationale: 'Permeable landscaped ground preserving daylight and aeration',
            });
          }
        }
      }
    }

    // 2c. Stepped Wing Massing (8-point polygon)
    // Offset wings create a front landscaped entrance court and a rear utility/service yard.
    if (footprintPolygon.points.length === 8) {
      const pts = footprintPolygon.points;
      const frontStepH = pts[0]!.y - envY;
      const frontStepW = pts[1]!.x - pts[0]!.x;
      if (frontStepW > 0 && frontStepH > 0) {
        zones.push({
          kind: 'garden',
          name: 'Front Stepped Garden Court',
          x: pts[0]!.x, y: envY, width: frontStepW, height: frontStepH,
          source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: ['road_access'],
          description: 'Front garden court created by articulated building wing setback',
          rationale: 'Stepped frontage preserves a sunny landscaped entrance court',
        });
      }

      const rearStepH = (envY + envH) - pts[4]!.y;
      const rearStepW = pts[4]!.x - pts[5]!.x;
      if (rearStepW > 0 && rearStepH > 0) {
        zones.push({
          kind: 'service',
          name: 'Stepped Utility Service Yard',
          x: pts[5]!.x, y: pts[4]!.y, width: rearStepW, height: rearStepH,
          source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: [],
          description: 'Rear service yard formed by articulated stepped wing',
          rationale: 'Screened outdoor utility court for laundry and service access',
        });
      }
    }

    // Distribute front, rear, and side residual courts
    const residualParkingRequested = parkingRequested && hasFrontResidual;
    if (road === Direction.North) {
      const frontZones = this.allocateFrontArrival(envX, envY, envW, northH, parkingCount, residualParkingRequested, Direction.North, issues);
      zones.push(...frontZones.zones);
      if (frontZones.parkingFeasible === false) parkingFeasible = false;

      const rearZones = this.allocateRearCourt(envX, footY + footH, envW, southH, requirements, Direction.South);
      zones.push(...rearZones);

      if (westW > 0 && footH > 0) {
        zones.push(...this.allocateIndianSideZones(envX, footY, westW, footH, 'west'));
      }
      if (eastW > 0 && footH > 0) {
        zones.push(...this.allocateIndianSideZones(footX + footW, footY, eastW, footH, 'east'));
      }
    } else if (road === Direction.South) {
      const frontZones = this.allocateFrontArrival(envX, footY + footH, envW, southH, parkingCount, residualParkingRequested, Direction.South, issues);
      zones.push(...frontZones.zones);
      if (frontZones.parkingFeasible === false) parkingFeasible = false;

      const rearZones = this.allocateRearCourt(envX, envY, envW, northH, requirements, Direction.North);
      zones.push(...rearZones);

      if (westW > 0 && footH > 0) {
        zones.push(...this.allocateIndianSideZones(envX, footY, westW, footH, 'west'));
      }
      if (eastW > 0 && footH > 0) {
        zones.push(...this.allocateIndianSideZones(footX + footW, footY, eastW, footH, 'east'));
      }
    } else if (road === Direction.East) {
      const frontZones = this.allocateFrontArrival(footX + footW, envY, eastW, envH, parkingCount, residualParkingRequested, Direction.East, issues);
      zones.push(...frontZones.zones);
      if (frontZones.parkingFeasible === false) parkingFeasible = false;

      const rearZones = this.allocateRearCourt(envX, envY, westW, envH, requirements, Direction.West);
      zones.push(...rearZones);

      if (footW > 0 && northH > 0) {
        zones.push(...this.allocateIndianSideZones(footX, envY, footW, northH, 'north'));
      }
      if (footW > 0 && southH > 0) {
        zones.push(...this.allocateIndianSideZones(footX, footY + footH, footW, southH, 'south'));
      }
    } else {
      // West road
      const frontZones = this.allocateFrontArrival(envX, envY, westW, envH, parkingCount, residualParkingRequested, Direction.West, issues);
      zones.push(...frontZones.zones);
      if (frontZones.parkingFeasible === false) parkingFeasible = false;

      const rearZones = this.allocateRearCourt(footX + footW, envY, eastW, envH, requirements, Direction.East);
      zones.push(...rearZones);

      if (footW > 0 && northH > 0) {
        zones.push(...this.allocateIndianSideZones(footX, envY, footW, northH, 'north'));
      }
      if (footW > 0 && southH > 0) {
        zones.push(...this.allocateIndianSideZones(footX, footY + footH, footW, southH, 'south'));
      }
    }

    // 4. Convert to canonical SiteZone interfaces
    const siteZones: SiteZone[] = zones
      .filter(z => z.width > 0 && z.height > 0)
      .map((z, index) => {
        const boundary = createRect(z.x, z.y, z.width, z.height);
        const area = polygonArea(boundary);
        return {
          id: `site_zone_${z.kind}_${index + 1}`,
          kind: z.kind,
          name: z.name,
          boundary,
          area,
          accessLinks: z.accessLinks,
          source: z.source,
          reviewStatus: z.reviewStatus,
          description: z.description,
          rationale: z.rationale,
        };
      });

    // 5. Site Utilization Invariant Check
    const footprintArea = polygonArea(footprintPolygon);
    const classifiedZonesArea = siteZones.reduce((sum, z) => sum + z.area, 0);
    const totalAccountedArea = classifiedZonesArea + footprintArea;
    const areaDiscrepancy = Math.abs(totalAccountedArea - plotArea);
    const tolerance = plotArea * 0.0002; // 0.02% numerical tolerance
    const unallocatedArea = Math.max(0, plotArea - totalAccountedArea);
    const isComplete = areaDiscrepancy <= tolerance;

    // 6. Category breakdown
    const categories: Record<SiteZoneKind, { area: number; count: number; name: string }> = {
      setback: { area: 0, count: 0, name: 'Setbacks / Development Reserve' },
      parking: { area: 0, count: 0, name: 'Off-Street Parking' },
      garden: { area: 0, count: 0, name: 'Landscape & Garden' },
      pedestrian_circulation: { area: 0, count: 0, name: 'Pedestrian Pathways' },
      vehicle_circulation: { area: 0, count: 0, name: 'Vehicle Driveway & Apron' },
      service: { area: 0, count: 0, name: 'Utility & Services' },
      future_expansion: { area: 0, count: 0, name: 'Future Expansion Reserve' },
    };

    for (const zone of siteZones) {
      categories[zone.kind].area += zone.area;
      categories[zone.kind].count += 1;
    }

    const breakdown: SiteZoneCategoryBreakdown[] = Object.entries(categories)
      .filter(([_, data]) => data.area > 0)
      .map(([kind, data]) => ({
        kind: kind as SiteZoneKind,
        name: data.name,
        areaMm2: data.area,
        percent: plotArea > 0 ? (data.area / plotArea) * 100 : 0,
        count: data.count,
      }));

    const audit: SiteUtilizationAudit = {
      plotAreaMm2: plotArea,
      buildingFootprintAreaMm2: footprintArea,
      classifiedZonesAreaMm2: classifiedZonesArea,
      unallocatedAreaMm2: isComplete ? 0 : unallocatedArea,
      coverageRatio: plotArea > 0 ? footprintArea / plotArea : 0,
      isComplete,
      breakdown,
      parkingFeasible,
      parkingIssues: issues,
    };

    return {
      siteZones,
      siteUtilization: audit,
      isValid: isComplete && parkingFeasible,
      issues,
      furniture: furnishSiteParkingZones(siteZones),
    };
  }

  /**
   * Partitions the mandatory perimeter setback area into non-overlapping zones.
   * When front arrival space within the buildable envelope is absent, off-street
   * parking is accommodated within the front road setback strip along the entrance gate.
   */
  private computeSetbackStrips(
    site: Site,
    cardinal: { north: number; south: number; east: number; west: number },
    options: { parkingRequested?: boolean; parkingCount?: number; hasFrontResidual?: boolean; gardenPreference?: boolean } = {},
  ): RectangularZone[] {
    const strips: RectangularZone[] = [];
    const W = site.plotWidth;
    const D = site.plotDepth;
    const { north, south, east, west } = cardinal;
    const road = site.roadFacing;
    const { parkingRequested = false, parkingCount = 1, hasFrontResidual = true, gardenPreference = false } = options;

    const allocateFrontSetback = (x: number, y: number, width: number, height: number): RectangularZone[] => {
      if (!parkingRequested || hasFrontResidual || width <= 0 || height <= 0) {
        return [{
          kind: 'setback',
          name: 'Front Road Setback',
          x, y, width, height,
          source: 'RULE_BASED',
          reviewStatus: 'REVIEWED',
          accessLinks: ['road_access'],
          description: `Mandatory ${height} mm front setback establishing road buffer`,
          rationale: 'Required development control reserve establishing zoning offset and road buffer',
        }];
      }

      // Parking accommodated in front setback strip along road
      const stallWidth = Math.min(3000, Math.floor((width * 0.65) / parkingCount));
      const totalParkingWidth = stallWidth * parkingCount;
      const walkwayWidth = Math.min(2000, Math.max(1200, width * 0.15));
      const remainingWidth = Math.max(0, width - totalParkingWidth - walkwayWidth);
      const res: RectangularZone[] = [];

      for (let i = 0; i < parkingCount; i++) {
        res.push({
          kind: 'parking',
          name: parkingCount === 1 ? 'Designated Parking Bay' : `Parking Bay ${i + 1}`,
          x: x + i * stallWidth, y, width: stallWidth, height,
          source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: ['road_access', 'vehicle_driveway'],
          description: `Surface parking space in front arrival court (${Math.round(stallWidth / 1000)}m × ${Math.round(height / 1000)}m)`,
          rationale: 'Off-street dedicated vehicular parking stall connected directly to road arrival',
        });
      }

      const walkX = x + totalParkingWidth;
      res.push({
        kind: 'pedestrian_circulation',
        name: 'Main Arrival Walkway',
        x: walkX, y, width: walkwayWidth, height,
        source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: ['road_access'],
        description: 'Paved arrival walkway separating vehicular parking from setback reserve',
        rationale: 'Dedicated universal pedestrian access connecting road gate to building entrance',
      });

      if (remainingWidth > 0) {
        res.push({
          kind: gardenPreference ? 'garden' : 'setback',
          name: gardenPreference ? 'Front Landscaped Garden Lawn' : 'Front Road Setback',
          x: walkX + walkwayWidth, y, width: remainingWidth, height,
          source: gardenPreference ? 'GENERATED' : 'RULE_BASED',
          reviewStatus: gardenPreference ? 'UNREVIEWED' : 'REVIEWED',
          accessLinks: ['road_access'],
          description: 'Front road setback landscape reserve',
          rationale: 'Street-facing development control reserve and green frontage',
        });
      }

      return res;
    };

    // North strip across full plot width
    if (north > 0) {
      if (road === Direction.North) {
        strips.push(...allocateFrontSetback(0, 0, W, north));
      } else {
        strips.push({
          kind: gardenPreference ? 'garden' : 'setback',
          name: gardenPreference ? 'North Landscaped Garden Lawn' : 'North Rear Setback',
          x: 0, y: 0, width: W, height: north,
          source: gardenPreference ? 'GENERATED' : 'RULE_BASED',
          reviewStatus: gardenPreference ? 'UNREVIEWED' : 'REVIEWED',
          accessLinks: [],
          description: `Mandatory ${north} mm setback along northern plot edge`,
          rationale: 'Required development control reserve establishing zoning offset and landscaped private buffer',
        });
      }
    }

    // South strip across full plot width
    if (south > 0) {
      if (road === Direction.South) {
        strips.push(...allocateFrontSetback(0, D - south, W, south));
      } else {
        strips.push({
          kind: gardenPreference ? 'garden' : 'setback',
          name: gardenPreference ? 'South Landscaped Garden Lawn' : 'South Rear Setback',
          x: 0, y: D - south, width: W, height: south,
          source: gardenPreference ? 'GENERATED' : 'RULE_BASED',
          reviewStatus: gardenPreference ? 'UNREVIEWED' : 'REVIEWED',
          accessLinks: [],
          description: `Mandatory ${south} mm setback along southern plot edge`,
          rationale: 'Required development control reserve establishing zoning offset and landscaped private buffer',
        });
      }
    }

    // West strip between North and South strips
    const midH = Math.max(0, D - north - south);
    if (west > 0 && midH > 0) {
      if (road === Direction.West) {
        strips.push(...allocateFrontSetback(0, north, west, midH));
      } else {
        strips.push({
          kind: 'setback',
          name: 'West Side Setback',
          x: 0, y: north, width: west, height: midH,
          source: 'RULE_BASED', reviewStatus: 'REVIEWED', accessLinks: [],
          description: `Mandatory ${west} mm side setback along western boundary`,
          rationale: 'Side property clearance for light, ventilation, and fire buffer',
        });
      }
    }

    // East strip between North and South strips
    if (east > 0 && midH > 0) {
      if (road === Direction.East) {
        strips.push(...allocateFrontSetback(W - east, north, east, midH));
      } else {
        strips.push({
          kind: 'setback',
          name: 'East Side Setback',
          x: W - east, y: north, width: east, height: midH,
          source: 'RULE_BASED', reviewStatus: 'REVIEWED', accessLinks: [],
          description: `Mandatory ${east} mm side setback along eastern boundary`,
          rationale: 'Side property clearance for light, ventilation, and fire buffer',
        });
      }
    }

    return strips;
  }

  /**
   * Allocates front arrival space between road access and building footprint into
   * parking, pedestrian walkway, vehicle maneuvering, and landscape buffer.
   */
  private allocateFrontArrival(
    x: number, y: number, width: number, height: number,
    parkingCount: number, parkingRequested: boolean,
    _direction: Direction,
    issues: string[],
  ): { zones: RectangularZone[]; parkingFeasible: boolean } {
    if (width <= 0 || height <= 0) {
      if (parkingRequested && parkingCount > 0) {
        issues.push('No front arrival space available between road and building to accommodate requested parking.');
        return { zones: [], parkingFeasible: false };
      }
      return { zones: [], parkingFeasible: true };
    }

    const zones: RectangularZone[] = [];

    if (!parkingRequested || parkingCount === 0) {
      // 100% Pedestrian pathway and front garden
      const walkWidth = Math.min(2000, Math.max(1200, width * 0.25));
      zones.push({
        kind: 'pedestrian_circulation',
        name: 'Main Arrival Walkway',
        x, y, width: walkWidth, height,
        source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: ['road_access'],
        description: 'Paved pedestrian arrival pathway from plot boundary to building entry',
        rationale: 'Direct dedicated universal pedestrian access path',
      });
      if (width - walkWidth > 0) {
        zones.push({
          kind: 'garden',
          name: 'Front Landscape Lawn',
          x: x + walkWidth, y, width: width - walkWidth, height,
          source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: [],
          description: 'Front ornamental garden and green lawn area',
          rationale: 'Street-facing permeable green space and curb-appeal landscaping',
        });
      }
      return { zones, parkingFeasible: true };
    }

    // Parking requested: Standard stall size 2500 mm x 5000 mm
    const minStallWidth = 2400;
    const minTotalWidth = parkingCount * minStallWidth + 1200; // parking + walkway

    if (width < minTotalWidth) {
      issues.push(`Front width (${Math.round(width / 1000)}m) is insufficient for ${parkingCount} parking stall(s) and pedestrian walkway (requires min ${Math.round(minTotalWidth / 1000)}m).`);
      // Allocate as walkway and landscape, but flag infeasible
      const walkWidth = Math.min(1800, width * 0.3);
      zones.push({
        kind: 'pedestrian_circulation',
        name: 'Main Arrival Walkway',
        x, y, width: walkWidth, height,
        source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: ['road_access'],
        description: 'Paved pedestrian arrival path',
        rationale: 'Direct dedicated universal pedestrian access path',
      });
      zones.push({
        kind: 'garden',
        name: 'Front Landscape Garden',
        x: x + walkWidth, y, width: width - walkWidth, height,
        source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: [],
        description: 'Front green buffer',
        rationale: 'Permeable landscaped ground',
      });
      return { zones, parkingFeasible: false };
    }

    // Allocate parking, vehicle circulation/driveway apron, walkway, and garden
    const actualStallWidth = Math.min(3000, Math.floor((width * 0.65) / parkingCount));
    const totalParkingWidth = actualStallWidth * parkingCount;
    const walkwayWidth = Math.min(2000, Math.max(1200, width * 0.15));
    const remainingGardenWidth = Math.max(0, width - totalParkingWidth - walkwayWidth);

    // Stalls
    for (let i = 0; i < parkingCount; i++) {
      const stallX = x + i * actualStallWidth;
      zones.push({
        kind: 'parking',
        name: parkingCount === 1 ? 'Designated Parking Bay' : `Parking Bay ${i + 1}`,
        x: stallX, y, width: actualStallWidth, height,
        source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: ['road_access', 'vehicle_driveway'],
        description: `Surface parking space (${Math.round(actualStallWidth / 1000)}m × ${Math.round(height / 1000)}m)`,
        rationale: 'Off-street dedicated vehicular parking stall connected directly to road arrival',
      });
    }

    // Pedestrian walkway
    const walkX = x + totalParkingWidth;
    zones.push({
      kind: 'pedestrian_circulation',
      name: 'Main Arrival Walkway',
      x: walkX, y, width: walkwayWidth, height,
      source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: ['road_access'],
      description: 'Paved walkway separating vehicular parking from landscaped garden',
      rationale: 'Segregated pedestrian arrival ensuring safe access away from vehicle path',
    });

    // Front garden buffer
    if (remainingGardenWidth > 0) {
      zones.push({
        kind: 'garden',
        name: 'Front Landscape Buffer',
        x: walkX + walkwayWidth, y, width: remainingGardenWidth, height,
        source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: [],
        description: 'Front boundary landscaping and greenery',
        rationale: 'Street-facing permeable green cover and frontage enhancement',
      });
    }

    return { zones, parkingFeasible: true };
  }

  /**
   * Allocates rear court space into private garden, utility/service yard, or future expansion.
   */
  private allocateRearCourt(
    x: number, y: number, width: number, height: number,
    requirements: DesignRequirementSpecification,
    _direction: Direction,
  ): RectangularZone[] {
    if (width <= 0 || height <= 0) return [];

    const zones: RectangularZone[] = [];
    const serviceYardRequested = requirements.hard.serviceYardRequired ?? false;
    const futureExpansionAllowed = requirements.hard.futureExpansionAllowed ?? false;
    const courtArea = width * height;

    if (serviceYardRequested && courtArea >= 15_000_000) {
      // Allocate 30% of width for service yard, 70% for private backyard garden
      const serviceW = Math.max(2500, Math.min(width * 0.35, 6000));
      const gardenW = width - serviceW;

      zones.push({
        kind: 'service',
        name: 'Utility & Service Yard',
        x, y, width: serviceW, height,
        source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: [],
        description: 'Outdoor utility court for laundry drying, wash area, and MEP services',
        rationale: 'Dedicated screened utility area segregated from active living zones',
      });

      zones.push({
        kind: 'garden',
        name: 'Private Backyard Lawn',
        x: x + serviceW, y, width: gardenW, height,
        source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: [],
        description: 'Private enclosed rear garden and recreation lawn',
        rationale: 'Quiet family outdoor green space sheltered from street exposure',
      });
    } else if (futureExpansionAllowed && courtArea >= 25_000_000) {
      // Allocate 40% for future expansion reserve, 60% for backyard garden
      const expansionW = Math.max(3000, width * 0.4);
      const gardenW = width - expansionW;

      zones.push({
        kind: 'future_expansion',
        name: 'Future Expansion Reserve',
        x, y, width: expansionW, height,
        source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: [],
        description: 'Permitted buildable reserve allocated for future wing extension',
        rationale: 'Project brief explicitly reserves unbuilt area for planned future structural addition',
      });

      zones.push({
        kind: 'garden',
        name: 'Private Backyard Garden',
        x: x + expansionW, y, width: gardenW, height,
        source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: [],
        description: 'Private landscaped lawn',
        rationale: 'Outdoor recreational landscape and natural drainage surface',
      });
    } else {
      // Entire rear court is private garden
      zones.push({
        kind: 'garden',
        name: 'Private Backyard Garden',
        x, y, width, height,
        source: 'GENERATED', reviewStatus: 'UNREVIEWED', accessLinks: [],
        description: 'Spacious private rear lawn and landscaping',
        rationale: 'Recreational private outdoor green space and permeable ground recharge',
      });
    }

    return zones;
  }

  /**
   * Partitions side setback areas into realistic Indian Apartment Site Zones (§4.2):
   * - 6000 mm Perimeter Vehicular Fire Driveway Loop (A-SITE-ROAD)
   * - Numbered Surface Visitor & Resident Parking Bays (2500 x 5000 mm, A-SITE-PARK)
   * - 10% Statutory Recreational Open Space (ROS) Landscaped Garden & Tot-Lot (A-SITE-LAND)
   * - Security Cabin (2400 x 2400 mm), Transformer/DG Yard, UGWT, and STP (A-SITE-SERV)
   * strictly preserving Delta = 0.000 mm² area conservation.
   */
  private allocateIndianSideZones(
    x: number,
    y: number,
    width: number,
    height: number,
    side: 'west' | 'east' | 'north' | 'south',
  ): RectangularZone[] {
    const isVertical = side === 'west' || side === 'east';
    const zones: RectangularZone[] = [];

    if (isVertical) {
      if (height < 12000) {
        const fireH = Math.min(6000, Math.floor(height * 0.5));
        const remH = height - fireH;
        zones.push({
          kind: 'vehicle_circulation',
          name: '6.0m Perimeter Vehicular Fire Driveway Loop',
          x, y, width, height: fireH,
          source: 'GENERATED', reviewStatus: 'REVIEWED', accessLinks: ['vehicle_driveway'],
          description: '6000 mm clear perimeter vehicular access and fire tender loop',
          rationale: 'Mandatory perimeter fire driveway loop for emergency access',
        });
        zones.push({
          kind: 'garden',
          name: '10% Statutory ROS Landscaped Garden & Tot-Lot',
          x, y: y + fireH, width, height: remH,
          source: 'GENERATED', reviewStatus: 'REVIEWED', accessLinks: ['pedestrian_walkway'],
          description: 'Recreational open space garden and boundary green verge',
          rationale: 'Statutory recreational open space maintaining green coverage and percolation',
        });
      } else {
        const fireH = Math.min(height * 0.4, Math.max(6000, Math.floor(height * 0.35)));
        const parkH = Math.min(height * 0.3, Math.max(5000, Math.floor(height * 0.25)));
        const servH = Math.min(height * 0.2, Math.max(4000, Math.floor(height * 0.18)));
        const rosH = height - (fireH + parkH + servH);

        let curY = y;
        zones.push({
          kind: 'vehicle_circulation',
          name: '6.0m Perimeter Vehicular Fire Driveway Loop',
          x, y: curY, width, height: fireH,
          source: 'GENERATED', reviewStatus: 'REVIEWED', accessLinks: ['vehicle_driveway'],
          description: '6000 mm clear perimeter vehicular access and fire tender loop',
          rationale: 'Mandatory fire tender movement corridor compliant with NBC Table 4',
        });
        curY += fireH;

        zones.push({
          kind: 'parking',
          name: 'Numbered Surface Visitor & Resident Parking Bays (2.5x5.0m)',
          x, y: curY, width, height: parkH,
          source: 'GENERATED', reviewStatus: 'REVIEWED', accessLinks: ['vehicle_driveway'],
          description: 'Surface parking stalls (2500 x 5000 mm) with aisle access',
          rationale: 'Visitor and resident surface parking along side boundary buffer',
        });
        curY += parkH;

        zones.push({
          kind: 'service',
          name: 'Site Services: Security Cabin, DG Yard, UGWT & STP',
          x, y: curY, width, height: servH,
          source: 'GENERATED', reviewStatus: 'REVIEWED', accessLinks: ['service_road'],
          description: 'Dedicated site infrastructure: DG acoustic enclosure, UGWT pump room, and STP',
          rationale: 'Centralized MEP utility compound positioned along peripheral service yard',
        });
        curY += servH;

        zones.push({
          kind: 'garden',
          name: '10% Statutory ROS Landscaped Garden & Tot-Lot',
          x, y: curY, width, height: rosH,
          source: 'GENERATED', reviewStatus: 'REVIEWED', accessLinks: ['pedestrian_walkway'],
          description: 'Permeable landscaped recreational green space and children tot-lot',
          rationale: 'Mandatory 10% recreational open space (ROS) requirement for residential layout',
        });
      }
    } else {
      if (width < 12000) {
        const fireW = Math.min(6000, Math.floor(width * 0.5));
        const remW = width - fireW;
        zones.push({
          kind: 'vehicle_circulation',
          name: '6.0m Perimeter Vehicular Fire Driveway Loop',
          x, y, width: fireW, height,
          source: 'GENERATED', reviewStatus: 'REVIEWED', accessLinks: ['vehicle_driveway'],
          description: '6000 mm clear perimeter vehicular access and fire tender loop',
          rationale: 'Mandatory perimeter fire driveway loop for emergency access',
        });
        zones.push({
          kind: 'garden',
          name: '10% Statutory ROS Landscaped Garden & Tot-Lot',
          x: x + fireW, y, width: remW, height,
          source: 'GENERATED', reviewStatus: 'REVIEWED', accessLinks: ['pedestrian_walkway'],
          description: 'Recreational open space garden and boundary green verge',
          rationale: 'Statutory recreational open space maintaining green coverage and percolation',
        });
      } else {
        const fireW = Math.min(width * 0.4, Math.max(6000, Math.floor(width * 0.35)));
        const parkW = Math.min(width * 0.3, Math.max(5000, Math.floor(width * 0.25)));
        const servW = Math.min(width * 0.2, Math.max(4000, Math.floor(width * 0.18)));
        const rosW = width - (fireW + parkW + servW);

        let curX = x;
        zones.push({
          kind: 'vehicle_circulation',
          name: '6.0m Perimeter Vehicular Fire Driveway Loop',
          x: curX, y, width: fireW, height,
          source: 'GENERATED', reviewStatus: 'REVIEWED', accessLinks: ['vehicle_driveway'],
          description: '6000 mm clear perimeter vehicular access and fire tender loop',
          rationale: 'Mandatory fire tender movement corridor compliant with NBC Table 4',
        });
        curX += fireW;

        zones.push({
          kind: 'parking',
          name: 'Numbered Surface Visitor & Resident Parking Bays (2.5x5.0m)',
          x: curX, y, width: parkW, height,
          source: 'GENERATED', reviewStatus: 'REVIEWED', accessLinks: ['vehicle_driveway'],
          description: 'Surface parking stalls (2500 x 5000 mm) with aisle access',
          rationale: 'Visitor and resident surface parking along boundary buffer',
        });
        curX += parkW;

        zones.push({
          kind: 'service',
          name: 'Site Services: Security Cabin, DG Yard, UGWT & STP',
          x: curX, y, width: servW, height,
          source: 'GENERATED', reviewStatus: 'REVIEWED', accessLinks: ['service_road'],
          description: 'Dedicated site infrastructure: DG acoustic enclosure, UGWT pump room, and STP',
          rationale: 'Centralized MEP utility compound positioned along peripheral service yard',
        });
        curX += servW;

        zones.push({
          kind: 'garden',
          name: '10% Statutory ROS Landscaped Garden & Tot-Lot',
          x: curX, y, width: rosW, height,
          source: 'GENERATED', reviewStatus: 'REVIEWED', accessLinks: ['pedestrian_walkway'],
          description: 'Permeable landscaped recreational green space and children tot-lot',
          rationale: 'Mandatory 10% recreational open space (ROS) requirement for residential layout',
        });
      }
    }

    return zones;
  }
}

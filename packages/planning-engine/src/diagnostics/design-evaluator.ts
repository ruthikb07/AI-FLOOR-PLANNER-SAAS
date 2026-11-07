/**
 * Design Evaluator & Architecture Diagnostics
 *
 * Provides non-blocking design intelligence, geometry integrity checks,
 * and human-readable observations (Strengths, Opportunities, Preferences).
 * Replaces the legacy centralized constraint-engine validation gate.
 */

import type {
  Building,
  DesignDiagnostics,
  DiagnosticIssue,
  DesignObservation,
  RoomProgram,
  InstanceDesignGraph,
  Room,
} from '@ai-floor-planner/core';
import { RoomType, MINIMUM_ROOM_AREAS, MINIMUM_DIMENSIONS } from '@ai-floor-planner/core';
import {
  containsPolygon,
  detectRoomCollisions,
  polygonArea,
  polygonBoundingBox,
} from '@ai-floor-planner/geometry-engine';
import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { evaluateInstanceGraph } from '../graph/scorer';
import { evaluateMultiFloorPlanning } from '../multi-floor/planner';

export interface DesignEvaluationOptions {
  readonly program?: RoomProgram;
  readonly designGraph?: InstanceDesignGraph;
  readonly vastuEnabled?: boolean;
  readonly requiredRoomTypes?: readonly RoomType[];
  readonly requiredRoomCounts?: Partial<Record<RoomType, number>>;
}

export function evaluateDesign(
  building: Building,
  options: DesignEvaluationOptions = {},
): DesignDiagnostics {
  const warnings: DiagnosticIssue[] = [];
  const observations: DesignObservation[] = [];
  let geometryHealthy = true;

  if (building.floors.some(f => f.apartmentUnits?.length)) {
    const closure = validateApartmentClosure(building);
    geometryHealthy = closure.hardErrors === 0;
    warnings.push(...closure.issues);
  }
  const allRooms = building.floors.flatMap(floor => floor.rooms);
  const carpetArea = allRooms.reduce((sum, r) => sum + r.area, 0);

  // 1. Geometry Integrity Check
  for (const floor of building.floors) {
    // Check floor boundary validity
    const hasBoundary = floor.boundary && floor.boundary.points.length >= 3;

    for (let i = 0; i < floor.rooms.length; i++) {
      const room = floor.rooms[i]!;

      // Coordinate & dimension sanity
      if (!Number.isFinite(room.x) || !Number.isFinite(room.y) ||
          !Number.isFinite(room.width) || !Number.isFinite(room.height) ||
          room.width <= 0 || room.height <= 0 || room.area <= 0) {
        geometryHealthy = false;
        warnings.push({
          code: 'GEOMETRY_INVALID_DIMENSIONS',
          message: `Room "${room.name}" has invalid or non-finite dimensions.`,
          severity: 'error',
          affectedEntityIds: [room.id],
        });
      }

      // Boundary containment
      if (hasBoundary && !containsPolygon(floor.boundary, room.boundary)) {
        geometryHealthy = false;
        warnings.push({
          code: 'GEOMETRY_OUT_OF_BOUNDS',
          message: `Room "${room.name}" extends beyond the floor boundary.`,
          severity: 'error',
          affectedEntityIds: [room.id],
        });
      }

      // Area and dimension minimums
      const minArea = (MINIMUM_ROOM_AREAS as any)[room.type];
      if (minArea !== undefined && room.area < minArea) {
        geometryHealthy = false;
        warnings.push({
          code: 'GEOMETRY_SUB_MINIMUM_SIZE',
          message: `Room "${room.name}" (${room.type}) area ${room.area} is below minimum ${minArea}.`,
          severity: 'error',
          affectedEntityIds: [room.id],
        });
      }
      const minDim = (MINIMUM_DIMENSIONS as any)[room.type];
      if (minDim !== undefined && Math.min(room.width, room.height) < minDim) {
        geometryHealthy = false;
        warnings.push({
          code: 'GEOMETRY_SUB_MINIMUM_DIMENSION',
          message: `Room "${room.name}" dimension is below minimum ${minDim}.`,
          severity: 'error',
          affectedEntityIds: [room.id],
        });
      }

      // Room collisions / overlaps
      const collisions = detectRoomCollisions(room, [...floor.rooms]);
      if (collisions.length > 0) {
        // Only report critical overlap if significant
        const significant = collisions.filter(c => c.overlapArea > 50000); // > 0.05 m²
        if (significant.length > 0) {
          geometryHealthy = false;
          warnings.push({
            code: 'GEOMETRY_ROOM_COLLISION',
            message: `Room "${room.name}" overlaps with another room on Level ${floor.level}.`,
            severity: 'error',
            affectedEntityIds: [room.id, ...significant.map(c => c.entityB)],
          });
        }
      }
    }
  }

  if (options.requiredRoomTypes && options.requiredRoomTypes.length > 0) {
    const presentTypes = new Set(allRooms.map(r => r.type));
    const siteZoneKinds = new Set(building.site?.siteZones?.map(z => z.kind) ?? []);
    for (const req of options.requiredRoomTypes) {
      const fulfilledOnSite = (req === RoomType.Parking && siteZoneKinds.has('parking'))
        || (req === RoomType.Garden && siteZoneKinds.has('garden'));
      if (!presentTypes.has(req) && !fulfilledOnSite) {
        geometryHealthy = false;
        warnings.push({
          code: 'MISSING_REQUIRED_ROOM_TYPE',
          message: `Required room type "${req}" is missing from the plan.`,
          severity: 'error',
        });
      }
    }
  }

  // 2. Area Efficiency
  const totalFloorArea = building.floors.reduce((sum, floor) => {
    return floor.boundary && floor.boundary.points.length >= 3
      ? sum + polygonArea(floor.boundary)
      : sum;
  }, 0);

  const areaEfficiencyScore = totalFloorArea > 0
    ? Math.max(0, Math.min(100, Math.round((carpetArea / totalFloorArea) * 100)))
    : 75;

  if (areaEfficiencyScore >= 70) {
    observations.push({
      category: 'strength',
      title: 'High Spatial Efficiency',
      description: `Carpet area accounts for ${areaEfficiencyScore}% of floor plate with minimal wasted circulation.`,
      scoreImpact: 10,
    });
  } else if (areaEfficiencyScore < 50) {
    observations.push({
      category: 'opportunity',
      title: 'Underutilized Floor Plate',
      description: `Carpet area is currently ${areaEfficiencyScore}% of the footprint. Room envelopes can be expanded.`,
      scoreImpact: -5,
    });
  }

  // Feasibility Check against Floor Envelope
  if (options.program && totalFloorArea > 0) {
    if (options.program.totalMinAreaMm2 > totalFloorArea) {
      warnings.push({
        code: 'FEASIBILITY_CONFLICT_AREA',
        message: `Requested program minimum area (${Math.round(options.program.totalMinAreaMm2 / 1e6)} m²) exceeds usable floor footprint (${Math.round(totalFloorArea / 1e6)} m²).`,
        severity: 'warning',
      });
      observations.push({
        category: 'opportunity',
        title: 'Space Program Exceeds Footprint',
        description: 'The combined minimum sizes of requested spaces exceed the buildable envelope. Consider adding a floor or reducing room counts.',
        scoreImpact: -10,
      });
    }
  }

  // 3. Adjacency & Functional Relationships
  let adjacencyScore = 75;
  if (options.designGraph) {
    const graphEval = evaluateInstanceGraph(building, options.designGraph);
    adjacencyScore = graphEval.score;
  }

  // Check key relationships
  const kitchen = allRooms.find(r => r.type === RoomType.Kitchen);
  const dining = allRooms.find(r => r.type === RoomType.Dining);
  const living = allRooms.find(r => r.type === RoomType.Living);

  if (kitchen && dining) {
    const dist = Math.hypot(kitchen.x - dining.x, kitchen.y - dining.y);
    if (dist < 8000) {
      observations.push({
        category: 'strength',
        title: 'Direct Kitchen-Dining Relationship',
        description: 'Kitchen is conveniently positioned adjacent to the dining area.',
        scoreImpact: 10,
        affectedEntityIds: [kitchen.id, dining.id],
      });
    } else {
      observations.push({
        category: 'opportunity',
        title: 'Separated Kitchen and Dining',
        description: 'Kitchen is distant from dining area. Consider closer placement for smoother service flow.',
        scoreImpact: -5,
        affectedEntityIds: [kitchen.id, dining.id],
      });
    }
  }

  // 4. Privacy & Zoning
  let privacyScore = 80;
  const bedrooms = allRooms.filter(r => r.type === RoomType.Bedroom);
  const bathrooms = allRooms.filter(r => r.type === RoomType.Bathroom);

  if (living && bedrooms.length > 0) {
    const isolatedBedrooms = bedrooms.filter(b => {
      const dist = Math.hypot(b.x - living.x, b.y - living.y);
      return dist > 4000;
    });

    if (isolatedBedrooms.length >= Math.ceil(bedrooms.length / 2)) {
      observations.push({
        category: 'strength',
        title: 'Good Public/Private Separation',
        description: 'Sleeping areas are well buffered from main living and entertaining zones.',
        scoreImpact: 10,
        affectedEntityIds: isolatedBedrooms.map(b => b.id),
      });
      privacyScore = 90;
    } else {
      observations.push({
        category: 'opportunity',
        title: 'Bedrooms Close to Public Living',
        description: 'One or more bedrooms are directly adjacent to public living spaces without a privacy buffer.',
        scoreImpact: -5,
        affectedEntityIds: bedrooms.filter(b => !isolatedBedrooms.includes(b)).map(b => b.id),
      });
      privacyScore = 65;
    }
  }

  if (bathrooms.length > 0 && living) {
    const directToLiving = bathrooms.filter(b => Math.hypot(b.x - living.x, b.y - living.y) < 2000);
    if (directToLiving.length > 0) {
      observations.push({
        category: 'opportunity',
        title: 'Bathroom Adjacent to Living Area',
        description: 'Consider screening or vestibule entry for bathrooms positioned close to primary social areas.',
        scoreImpact: -5,
        affectedEntityIds: directToLiving.map(b => b.id),
      });
    }
  }

  // 5. Daylight Potential
  let daylightScore = 85;
  for (const floor of building.floors) {
    const floorBedrooms = floor.rooms.filter(r => r.type === RoomType.Bedroom || r.type === RoomType.Living);
    if (floor.boundary && floor.boundary.points.length >= 3) {
      for (const room of floorBedrooms) {
        // Check if room touches boundary
        const onPerimeter = floor.walls.some(w =>
          w.roomIds.includes(room.id) && w.roomIds.length === 1,
        );
        if (!onPerimeter) {
          daylightScore = Math.max(50, daylightScore - 10);
          observations.push({
            category: 'opportunity',
            title: `${room.name} Lacks Direct Exterior Wall`,
            description: `Room is landlocked away from the perimeter. Opening a wall to the outside improves natural light.`,
            scoreImpact: -5,
            affectedEntityIds: [room.id],
          });
        }
      }
    }
  }

  if (daylightScore >= 80) {
    observations.push({
      category: 'strength',
      title: 'Strong Natural Lighting Exposure',
      description: 'Habitable living and sleeping rooms have direct access to exterior perimeter walls.',
      scoreImpact: 10,
    });
  }

  // 6. Circulation & Accessibility
  let circulationScore = 80;
  const doors = building.floors.flatMap(f => f.doors);
  if (doors.length >= allRooms.length - 1) {
    observations.push({
      category: 'strength',
      title: 'Clear Circulation Paths',
      description: 'Rooms have dedicated doorway transitions supporting logical movement across levels.',
      scoreImpact: 5,
    });
  } else if (allRooms.length > 3 && doors.length < allRooms.length / 2) {
    circulationScore = 60;
    observations.push({
      category: 'opportunity',
      title: 'Incomplete Door Connections',
      description: 'Some rooms require additional internal doorway connections.',
      scoreImpact: -10,
    });
  }

  // Check private transit corridor (e.g. entering a bedroom to reach another room)
  for (const floor of building.floors) {
    for (const room of floor.rooms) {
      if (room.type === RoomType.Bedroom) {
        const connectedDoors = floor.doors.filter(d => d.connectsRooms.includes(room.id));
        const otherRoomIds = connectedDoors.flatMap(d => d.connectsRooms.filter(id => id !== room.id && id !== '__outside__' && id !== 'outside'));
        const nonBathOtherRooms = otherRoomIds.map(id => floor.rooms.find(r => r.id === id)).filter(r => r && r.type !== RoomType.Bathroom);
        if (nonBathOtherRooms.length > 1) {
          observations.push({
            category: 'opportunity',
            title: `Private Transit Through ${room.name}`,
            description: `${room.name} functions as a thoroughfare to other rooms, reducing privacy and circulation quality.`,
            scoreImpact: -10,
            affectedEntityIds: [room.id],
          });
        }
      }
    }
  }

  // 7. Functional Zoning & Entrance Alignment
  let zoningScore = 80;
  const entranceDoor = building.floors[0]?.doors.find(d =>
    d.connectsRooms.includes('__outside__') || d.connectsRooms.includes('outside')
  );
  if (entranceDoor) {
    const enteredRoomId = entranceDoor.connectsRooms.find(id => id !== '__outside__' && id !== 'outside');
    const enteredRoom = allRooms.find(r => r.id === enteredRoomId);
    if (enteredRoom) {
      if (enteredRoom.type === RoomType.Living || enteredRoom.type === RoomType.Foyer || enteredRoom.type === RoomType.Corridor) {
        zoningScore += 10;
        observations.push({
          category: 'strength',
          title: 'Direct Public Entrance Flow',
          description: `Main entrance transitions directly into public ${enteredRoom.name}.`,
          scoreImpact: 5,
          affectedEntityIds: [enteredRoom.id],
        });
      } else if (enteredRoom.type === RoomType.Bedroom || enteredRoom.type === RoomType.Bathroom) {
        zoningScore -= 25;
        observations.push({
          category: 'opportunity',
          title: 'Private Room Entrance Conflict',
          description: `Main entrance connects directly into ${enteredRoom.name} (${enteredRoom.type}). Entrance should lead to public or distribution space.`,
          scoreImpact: -15,
          affectedEntityIds: [enteredRoom.id],
        });
      }
    }
  }

  // Bedroom clustering & privacy
  if (bedrooms.length > 1) {
    let totalPairDist = 0;
    let pairs = 0;
    for (let i = 0; i < bedrooms.length; i++) {
      for (let j = i + 1; j < bedrooms.length; j++) {
        if (bedrooms[i]!.floorId === bedrooms[j]!.floorId) {
          totalPairDist += Math.hypot(bedrooms[i]!.x - bedrooms[j]!.x, bedrooms[i]!.y - bedrooms[j]!.y);
          pairs++;
        }
      }
    }
    const avgDist = pairs > 0 ? totalPairDist / pairs : 0;
    if (avgDist > 0 && avgDist < 10000) {
      zoningScore += 10;
    }
  }
  zoningScore = Math.max(20, Math.min(100, zoningScore));
  if (zoningScore >= 85) {
    observations.push({
      category: 'strength',
      title: 'Logical Functional Zoning',
      description: 'Clear segregation between public social areas, kitchen services, and private sleeping quarters.',
      scoreImpact: 10,
    });
  }

  // 8. Room Shape & Aspect Ratio Quality
  let shapeScore = 100;
  const occupiableRooms = allRooms.filter(r =>
    r.type !== RoomType.Corridor && r.type !== RoomType.Staircase && r.type !== RoomType.Lift
  );
  if (occupiableRooms.length > 0) {
    let totalShapePoints = 0;
    const elongatedRooms: Room[] = [];
    for (const room of occupiableRooms) {
      const minDim = Math.min(room.width, room.height);
      const maxDim = Math.max(room.width, room.height);
      const ratio = minDim > 0 ? maxDim / minDim : 3;
      if (ratio <= 1.6) {
        totalShapePoints += 100;
      } else if (ratio <= 2.0) {
        totalShapePoints += 85;
      } else if (ratio <= 2.5) {
        totalShapePoints += 55;
        elongatedRooms.push(room);
      } else {
        totalShapePoints += 25;
        elongatedRooms.push(room);
      }
    }
    shapeScore = Math.round(totalShapePoints / occupiableRooms.length);
    if (shapeScore >= 85) {
      observations.push({
        category: 'strength',
        title: 'Harmonious Room Proportions',
        description: 'Rooms maintain functional, well-proportioned rectangular geometries without narrow slivers.',
        scoreImpact: 5,
      });
    } else if (elongatedRooms.length > 0) {
      observations.push({
        category: 'opportunity',
        title: 'Elongated Room Geometry',
        description: `${elongatedRooms.map(r => r.name).slice(0, 2).join(', ')} exceed 2:1 aspect ratio, which may constrain functional furniture layouts.`,
        scoreImpact: -5,
        affectedEntityIds: elongatedRooms.map(r => r.id),
      });
    }
  }

  // 9. Optional Vastu Guidance
  // 7. Optional Vastu Guidance
  let vastuScore: number | undefined;
  const vastuDetails: { factor: string; points: number; maxPoints: number; description: string }[] = [];

  if (options.vastuEnabled) {
    let vastuPoints = 0;
    let vastuMax = 0;
    const orientation = building.site.orientation ?? 0;
    const firstFloor = building.floors[0];
    const bounds = firstFloor?.boundary && firstFloor.boundary.points.length >= 3
      ? polygonBoundingBox(firstFloor.boundary)
      : { x: 0, y: 0, width: building.site.plotWidth, height: building.site.plotDepth };

    // Kitchen in SE (preferred)
    if (kitchen) {
      vastuMax += 15;
      const center = { x: kitchen.x + kitchen.width / 2, y: kitchen.y + kitchen.height / 2 };
      const q = getQuadrant(center, bounds, orientation);
      const match = quadrantMatches(q, 'SE');
      const pts = match.matches ? 15 : match.partial ? 8 : 0;
      vastuPoints += pts;
      vastuDetails.push({
        factor: 'SC-VASTU-001',
        points: pts,
        maxPoints: 15,
        description: match.matches ? 'Kitchen in Southeast quadrant' : `Kitchen in ${q} (Vastu recommends SE)`,
      });
      observations.push({
        category: 'preference',
        title: 'Vastu: Kitchen in Southeast (Agni)',
        description: match.matches
          ? 'Kitchen is aligned with the auspicious Southeast quadrant for fire and cooking.'
          : 'Kitchen could be positioned in the Southeast (Agni) quadrant for optimal Vastu alignment.',
        scoreImpact: match.matches ? 5 : 0,
        affectedEntityIds: [kitchen.id],
      });
    }

    // Master bedroom in SW
    const master = bedrooms.length > 0 ? bedrooms.reduce((a, b) => a.area > b.area ? a : b) : undefined;
    if (master) {
      vastuMax += 15;
      const center = { x: master.x + master.width / 2, y: master.y + master.height / 2 };
      const q = getQuadrant(center, bounds, orientation);
      const match = quadrantMatches(q, 'SW');
      const pts = match.matches ? 15 : match.partial ? 8 : 0;
      vastuPoints += pts;
      vastuDetails.push({
        factor: 'SC-VASTU-002',
        points: pts,
        maxPoints: 15,
        description: match.matches ? 'Master bedroom in Southwest quadrant' : `Master bedroom in ${q} (Vastu recommends SW)`,
      });
      observations.push({
        category: 'preference',
        title: 'Vastu: Master Bedroom in Southwest (Nairutya)',
        description: match.matches
          ? 'Master bedroom is aligned with the Southwest quadrant for stability.'
          : 'Master bedroom is recommended in the Southwest quadrant for stability.',
        scoreImpact: match.matches ? 5 : 0,
        affectedEntityIds: [master.id],
      });
    }

    // Living in North zone
    if (living) {
      vastuMax += 10;
      const center = { x: living.x + living.width / 2, y: living.y + living.height / 2 };
      const inNorth = isInNorth(center, bounds, orientation);
      const pts = inNorth ? 10 : 0;
      vastuPoints += pts;
      vastuDetails.push({
        factor: 'SC-VASTU-004',
        points: pts,
        maxPoints: 10,
        description: inNorth ? 'Living room in North zone' : 'Living room outside North zone',
      });
      observations.push({
        category: 'preference',
        title: 'Vastu: Living Room in North/East Quadrant',
        description: inNorth
          ? 'Living room receives morning daylight and positive entry energy.'
          : 'Living room orientation could be aligned towards North or East.',
        scoreImpact: inNorth ? 5 : 0,
        affectedEntityIds: [living.id],
      });
    }

    // Pooja in NE
    const pooja = allRooms.find(r => r.type === RoomType.Pooja);
    if (pooja) {
      vastuMax += 15;
      const center = { x: pooja.x + pooja.width / 2, y: pooja.y + pooja.height / 2 };
      const q = getQuadrant(center, bounds, orientation);
      const match = quadrantMatches(q, 'NE');
      const pts = match.matches ? 15 : match.partial ? 8 : 0;
      vastuPoints += pts;
      vastuDetails.push({
        factor: 'SC-VASTU-003',
        points: pts,
        maxPoints: 15,
        description: match.matches ? 'Pooja room in Northeast quadrant' : `Pooja room in ${q} (Vastu recommends NE)`,
      });
      observations.push({
        category: 'preference',
        title: 'Vastu: Pooja Room in Northeast (Ishanya)',
        description: match.matches
          ? 'Pooja room placed in the sacred Northeast zone.'
          : 'Pooja room is recommended in the Northeast zone.',
        scoreImpact: match.matches ? 5 : 0,
        affectedEntityIds: [pooja.id],
      });
    }

    // Bathrooms in West
    if (bathrooms.length > 0) {
      vastuMax += 10;
      const center = { x: bathrooms[0]!.x + bathrooms[0]!.width / 2, y: bathrooms[0]!.y + bathrooms[0]!.height / 2 };
      const inWest = isInWest(center, bounds, orientation);
      const pts = inWest ? 10 : 0;
      vastuPoints += pts;
      vastuDetails.push({
        factor: 'SC-VASTU-005',
        points: pts,
        maxPoints: 10,
        description: inWest ? 'Bathroom in West zone' : 'Bathroom outside West zone',
      });
    }

    // Entrance facing North or East
    const road = building.site.roadFacing;
    if (road) {
      vastuMax += 15;
      const favorable = road === 'north' || road === 'east';
      const pts = favorable ? 15 : 0;
      vastuPoints += pts;
      vastuDetails.push({
        factor: 'SC-VASTU-006',
        points: pts,
        maxPoints: 15,
        description: favorable ? `Entrance faces ${road}` : `Entrance faces ${road} (Vastu recommends North or East)`,
      });
    }

    // Toilet NOT in NE
    if (bathrooms.length > 0) {
      vastuMax += 10;
      const toiletInNE = bathrooms.some(b => {
        const center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        return getQuadrant(center, bounds, orientation) === 'NE';
      });
      const pts = toiletInNE ? 0 : 10;
      vastuPoints += pts;
      vastuDetails.push({
        factor: 'SC-VASTU-008',
        points: pts,
        maxPoints: 10,
        description: toiletInNE ? 'Bathroom in Northeast corner' : 'No bathroom in Northeast corner',
      });
    }

    vastuScore = vastuMax > 0 ? Math.round((vastuPoints / vastuMax) * 100) : 75;
  }

  // 8. Multi-Floor Planning
  const multiFloor = evaluateMultiFloorPlanning(building);
  const multiFloorScore = multiFloor.buildingLevelScore;

  // Composite Overall Score
  const overall = options.vastuEnabled && vastuScore !== undefined
    ? Math.round(
        areaEfficiencyScore * 0.20 +
        adjacencyScore * 0.20 +
        circulationScore * 0.15 +
        privacyScore * 0.15 +
        daylightScore * 0.15 +
        vastuScore * 0.15,
      )
    : Math.round(
        areaEfficiencyScore * 0.25 +
        adjacencyScore * 0.25 +
        circulationScore * 0.20 +
        privacyScore * 0.15 +
        daylightScore * 0.15,
      );

  return {
    geometryHealthy,
    overallScore: overall,
    warnings,
    observations,
    scores: {
      overall,
      areaEfficiency: areaEfficiencyScore,
      circulation: circulationScore,
      privacy: privacyScore,
      daylight: daylightScore,
      adjacency: adjacencyScore,
      zoning: zoningScore,
      shape: shapeScore,
      vastu: vastuScore,
      multiFloor: multiFloorScore,
    },
    vastuDetails,
  };
}

type Quadrant = 'NE' | 'NW' | 'SE' | 'SW';

function getQuadrant(point: { x: number; y: number }, bounds: { x: number; y: number; width: number; height: number }, orientation: number): Quadrant {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const rad = (-orientation * Math.PI) / 180;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  const isNorth = ry < 0;
  const isEast = rx > 0;
  if (isNorth && isEast) return 'NE';
  if (isNorth && !isEast) return 'NW';
  if (!isNorth && isEast) return 'SE';
  return 'SW';
}

function quadrantMatches(actual: Quadrant, target: Quadrant): { matches: boolean; partial: boolean } {
  if (actual === target) return { matches: true, partial: false };
  const isAdjacent = actual[0] === target[0] || actual[1] === target[1];
  return { matches: false, partial: isAdjacent };
}

function isInNorth(point: { x: number; y: number }, bounds: { x: number; y: number; width: number; height: number }, orientation: number): boolean {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const rad = (-orientation * Math.PI) / 180;
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  return ry < 0;
}

function isInWest(point: { x: number; y: number }, bounds: { x: number; y: number; width: number; height: number }, orientation: number): boolean {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const rad = (-orientation * Math.PI) / 180;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  return rx < 0;
}

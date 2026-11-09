/**
 * Schema validation for deserialized Building data.
 *
 * This validates structural correctness (types, references, ranges).
 * It does NOT validate geometric validity (that is the Constraint Engine's job).
 */

import type { Building } from '../types';
import { RoomType } from '../types';
import { mepSchemaErrors } from '../mep/mep-validation';

export interface ValidationError {
  path: string;
  message: string;
  value: unknown;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPositiveNumber(v: unknown): v is number {
  return isFiniteNumber(v) && v > 0;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

const VALID_ROOM_TYPES = new Set(Object.values(RoomType));

// ─── Point Validation ───────────────────────────────────────────────────────

function validatePoint(value: unknown, path: string, errors: ValidationError[]): void {
  if (!isObject(value)) {
    errors.push({ path, message: 'Must be an object with x and y', value });
    return;
  }
  if (!isFiniteNumber(value['x'])) {
    errors.push({ path: `${path}.x`, message: 'Must be a finite number', value: value['x'] });
  }
  if (!isFiniteNumber(value['y'])) {
    errors.push({ path: `${path}.y`, message: 'Must be a finite number', value: value['y'] });
  }
}

// ─── Polygon Validation ─────────────────────────────────────────────────────

function validatePolygon(value: unknown, path: string, errors: ValidationError[]): void {
  if (!isObject(value)) {
    errors.push({ path, message: 'Must be an object with points array', value });
    return;
  }
  const points = value['points'];
  if (!isArray(points)) {
    errors.push({ path: `${path}.points`, message: 'Must be an array', value: points });
    return;
  }
  if (points.length < 3) {
    errors.push({ path: `${path}.points`, message: 'Must have at least 3 points', value: points.length });
  }
  for (let i = 0; i < points.length; i++) {
    validatePoint(points[i], `${path}.points[${i}]`, errors);
  }
}

// ─── Room Validation ────────────────────────────────────────────────────────

export function validateRoomSchema(room: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const path = 'room';

  if (!isObject(room)) {
    errors.push({ path, message: 'Must be an object', value: room });
    return errors;
  }

  if (!isNonEmptyString(room['id'])) {
    errors.push({ path: `${path}.id`, message: 'Must be a non-empty string', value: room['id'] });
  }
  if (!isNonEmptyString(room['floorId'])) {
    errors.push({ path: `${path}.floorId`, message: 'Must be a non-empty string', value: room['floorId'] });
  }
  if (!isString(room['type']) || !VALID_ROOM_TYPES.has(room['type'] as RoomType)) {
    errors.push({ path: `${path}.type`, message: 'Must be a valid RoomType', value: room['type'] });
  }
  if (!isString(room['name'])) {
    errors.push({ path: `${path}.name`, message: 'Must be a string', value: room['name'] });
  }
  if (!isFiniteNumber(room['x'])) {
    errors.push({ path: `${path}.x`, message: 'Must be a finite number', value: room['x'] });
  }
  if (!isFiniteNumber(room['y'])) {
    errors.push({ path: `${path}.y`, message: 'Must be a finite number', value: room['y'] });
  }
  if (!isPositiveNumber(room['width'])) {
    errors.push({ path: `${path}.width`, message: 'Must be a positive number', value: room['width'] });
  }
  if (!isPositiveNumber(room['height'])) {
    errors.push({ path: `${path}.height`, message: 'Must be a positive number', value: room['height'] });
  }

  // Area must match width × height (tolerance: 1 sq mm)
  if (isPositiveNumber(room['width']) && isPositiveNumber(room['height']) && isFiniteNumber(room['area'])) {
    const expectedArea = (room['width'] as number) * (room['height'] as number);
    if (Math.abs((room['area'] as number) - expectedArea) > 1) {
      errors.push({
        path: `${path}.area`,
        message: `Area mismatch: expected ${expectedArea}, got ${room['area'] as number}`,
        value: room['area'],
      });
    }
  }

  if (isObject(room['boundary'])) {
    validatePolygon(room['boundary'], `${path}.boundary`, errors);
  }

  return errors;
}

// ─── Building Validation ────────────────────────────────────────────────────

/** Validate a complete Building model structure. Returns empty array if valid. */
export function validateBuildingSchema(building: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isObject(building)) {
    errors.push({ path: '', message: 'Building must be an object', value: building });
    return errors;
  }

  if (building['regulatoryContext'] !== undefined) errors.push(...validateRegulatoryContextSchema(building['regulatoryContext']));
  // Root fields
  if (!isNonEmptyString(building['id'])) {
    errors.push({ path: 'id', message: 'Must be a non-empty string', value: building['id'] });
  }
  if (!isNonEmptyString(building['projectId'])) {
    errors.push({ path: 'projectId', message: 'Must be a non-empty string', value: building['projectId'] });
  }
  if (!isString(building['name'])) {
    errors.push({ path: 'name', message: 'Must be a string', value: building['name'] });
  }

  // Site
  const site = building['site'];
  if (!isObject(site)) {
    errors.push({ path: 'site', message: 'Must be an object', value: site });
  } else {
    if (!isNonEmptyString(site['id'])) {
      errors.push({ path: 'site.id', message: 'Must be a non-empty string', value: site['id'] });
    }
    if (!isPositiveNumber(site['plotWidth'])) {
      errors.push({ path: 'site.plotWidth', message: 'Must be a positive number', value: site['plotWidth'] });
    }
    if (!isPositiveNumber(site['plotDepth'])) {
      errors.push({ path: 'site.plotDepth', message: 'Must be a positive number', value: site['plotDepth'] });
    }
    if (isObject(site['plotBoundary'])) {
      validatePolygon(site['plotBoundary'], 'site.plotBoundary', errors);
    }
  }

  // Floors
  const floors = building['floors'];
  if (!isArray(floors)) {
    errors.push({ path: 'floors', message: 'Must be an array', value: floors });
  } else {
    const floorIds = new Set<string>();
    const floorLevels = new Set<number>();
    const entityIds = new Set<string>();
    for (let fi = 0; fi < floors.length; fi++) {
      const floor = floors[fi];
      const fp = `floors[${fi}]`;

      if (!isObject(floor)) {
        errors.push({ path: fp, message: 'Must be an object', value: floor });
        continue;
      }

      if (!isNonEmptyString(floor['id'])) {
        errors.push({ path: `${fp}.id`, message: 'Must be a non-empty string', value: floor['id'] });
      } else {
        const floorId = floor['id'] as string;
        if (floorIds.has(floorId)) {
          errors.push({ path: `${fp}.id`, message: `Duplicate floor id "${floorId}"`, value: floorId });
        }
        floorIds.add(floorId);
      }

      if (!isNonEmptyString(floor['buildingId'])) {
        errors.push({ path: `${fp}.buildingId`, message: 'Must be a non-empty string', value: floor['buildingId'] });
      } else if (isNonEmptyString(building['id']) && floor['buildingId'] !== building['id']) {
        errors.push({
          path: `${fp}.buildingId`,
          message: `Floor buildingId "${floor['buildingId']}" does not match building id "${building['id']}"`,
          value: floor['buildingId'],
        });
      }

      if (!isFiniteNumber(floor['level'])) {
        errors.push({ path: `${fp}.level`, message: 'Must be a finite number', value: floor['level'] });
      } else {
        const level = floor['level'] as number;
        if (floorLevels.has(level)) {
          errors.push({ path: `${fp}.level`, message: `Duplicate floor level ${level}`, value: level });
        }
        floorLevels.add(level);
      }

      // Rooms
      const rooms = floor['rooms'];
      if (!isArray(rooms)) {
        errors.push({ path: `${fp}.rooms`, message: 'Must be an array', value: rooms });
      } else {
        for (let ri = 0; ri < rooms.length; ri++) {
          const room = rooms[ri];
          const rp = `${fp}.rooms[${ri}]`;

          if (!isObject(room)) {
            errors.push({ path: rp, message: 'Must be an object', value: room });
            continue;
          }

          // Validate room fields inline (reusing logic)
          if (!isNonEmptyString(room['id'])) {
            errors.push({ path: `${rp}.id`, message: 'Must be a non-empty string', value: room['id'] });
          } else if (entityIds.has(room['id'] as string)) {
            errors.push({ path: `${rp}.id`, message: `Duplicate entity id "${room['id']}"`, value: room['id'] });
          } else {
            entityIds.add(room['id'] as string);
          }
          if (!isString(room['type']) || !VALID_ROOM_TYPES.has(room['type'] as RoomType)) {
            errors.push({ path: `${rp}.type`, message: 'Must be a valid RoomType', value: room['type'] });
          }
          if (!isPositiveNumber(room['width'])) {
            errors.push({ path: `${rp}.width`, message: 'Must be a positive number', value: room['width'] });
          }
          if (!isPositiveNumber(room['height'])) {
            errors.push({ path: `${rp}.height`, message: 'Must be a positive number', value: room['height'] });
          }
          if (!isFiniteNumber(room['x'])) {
            errors.push({ path: `${rp}.x`, message: 'Must be a finite number', value: room['x'] });
          }
          if (!isFiniteNumber(room['y'])) {
            errors.push({ path: `${rp}.y`, message: 'Must be a finite number', value: room['y'] });
          }

          // Area validation
          if (isPositiveNumber(room['width']) && isPositiveNumber(room['height']) && isFiniteNumber(room['area'])) {
            const expected = (room['width'] as number) * (room['height'] as number);
            if (Math.abs((room['area'] as number) - expected) > 1) {
              errors.push({
                path: `${rp}.area`,
                message: `Area mismatch: expected ${expected}, got ${room['area'] as number}`,
                value: room['area'],
              });
            }
          }

          // Boundary validation
          if (isObject(room['boundary'])) {
            validatePolygon(room['boundary'], `${rp}.boundary`, errors);
          }

          // floorId reference
          if (isNonEmptyString(room['floorId']) && isNonEmptyString(floor['id'])) {
            if (room['floorId'] !== floor['id']) {
              errors.push({
                path: `${rp}.floorId`,
                message: `Room floorId "${room['floorId']}" does not match parent floor id "${floor['id']}"`,
                value: room['floorId'],
              });
            }
          }
        }
      }

      // Walls array must exist
      if (!isArray(floor['walls'])) {
        errors.push({ path: `${fp}.walls`, message: 'Must be an array', value: floor['walls'] });
      }
      // Doors array must exist
      if (!isArray(floor['doors'])) {
        errors.push({ path: `${fp}.doors`, message: 'Must be an array', value: floor['doors'] });
      }
      // Windows array must exist
      if (!isArray(floor['windows'])) {
        errors.push({ path: `${fp}.windows`, message: 'Must be an array', value: floor['windows'] });
      }
      // Stairs array must exist
      if (!isArray(floor['stairs'])) {
        errors.push({ path: `${fp}.stairs`, message: 'Must be an array', value: floor['stairs'] });
      }
      // Columns array must exist
      if (!isArray(floor['columns'])) {
        errors.push({ path: `${fp}.columns`, message: 'Must be an array', value: floor['columns'] });
      }

      const parentFloorId = isNonEmptyString(floor['id']) ? floor['id'] : undefined;
      const entityCollections: ReadonlyArray<readonly [string, unknown[]]> = [
        ['walls', isArray(floor['walls']) ? floor['walls'] : []],
        ['doors', isArray(floor['doors']) ? floor['doors'] : []],
        ['windows', isArray(floor['windows']) ? floor['windows'] : []],
        ['stairs', isArray(floor['stairs']) ? floor['stairs'] : []],
        ['columns', isArray(floor['columns']) ? floor['columns'] : []],
      ];
      for (const [collectionName, entities] of entityCollections) {
        for (let entityIndex = 0; entityIndex < entities.length; entityIndex++) {
          const entity = entities[entityIndex];
          const ep = `${fp}.${collectionName}[${entityIndex}]`;
          if (!isObject(entity)) {
            errors.push({ path: ep, message: 'Must be an object', value: entity });
            continue;
          }
          if (!isNonEmptyString(entity['id'])) {
            errors.push({ path: `${ep}.id`, message: 'Must be a non-empty string', value: entity['id'] });
          } else if (entityIds.has(entity['id'] as string)) {
            errors.push({ path: `${ep}.id`, message: `Duplicate entity id "${entity['id']}"`, value: entity['id'] });
          } else {
            entityIds.add(entity['id'] as string);
          }
          if (isNonEmptyString(entity['floorId']) && parentFloorId && entity['floorId'] !== parentFloorId) {
            errors.push({
              path: `${ep}.floorId`,
              message: `${collectionName.slice(0, -1)} floorId "${entity['floorId']}" does not match parent floor id "${parentFloorId}"`,
              value: entity['floorId'],
            });
          }

        }
      }
    }
  }

  // Version
  for(const message of mepSchemaErrors(building))errors.push({path:'mep',message,value:building['mep']});
  if (!isFiniteNumber(building['version'])) {
    errors.push({ path: 'version', message: 'Must be a finite number', value: building['version'] });
  }

  return errors;
}

/** Type guard: check if a value is a valid Building. */
export function isValidBuilding(value: unknown): value is Building {
  return validateBuildingSchema(value).length === 0;
}

/** Optional inputs may be absent, but malformed explicit inputs are never accepted as approvals. */
export function validateRegulatoryContextSchema(input:unknown):ValidationError[]{
 const errors:ValidationError[]=[];
 const fail=(key:string,value:unknown)=>errors.push({path:`regulatoryContext.${key}`,value,message:'Invalid explicit regulatory input'});
 if(!isObject(input)){fail('',input);return errors;}
 const enums:Record<string,readonly unknown[]>={authorityType:['MUNICIPAL_CORPORATION','MUNICIPAL_COUNCIL','REGIONAL_PLAN'],congestionZone:['NON_CONGESTED','CONGESTED'],buildingUsage:['RESIDENTIAL_APARTMENT'],corporationClass:['A','B','C','D'],parkingFactorCategory:['PUNE_PCMC_THANE','NAGPUR_NASHIK','OTHER_MMR','OTHER_CORPORATION','D_CORPORATION','A_COUNCIL','BC_COUNCIL'],rosApplicability:['REQUIRED','EXEMPT_APPROVED_LAYOUT'],drivewayFlow:['ONE_WAY','TWO_WAY']};
 for(const [k,values] of Object.entries(enums))if(input[k]!==undefined&&!values.includes(input[k]))fail(k,input[k]);
 for(const k of ['parkingFloorHeightM','plotAreaSqm','roadWidthM','buildingHeightM','numFloors','originalHoldingAreaSqm','netPlotAreaSqm','approvedPremiumFsi','approvedTdrFsi','approvedAncillaryFsi'])if(input[k]!==undefined&&(!isFiniteNumber(input[k])||(input[k] as number)<0))fail(k,input[k]);
 for(const k of ['roofFsiReviewed','stiltParkingEnabled','standardGreenfieldSchemeConfirmed','amendmentApplicabilityReviewed','fsiExemptionsReviewed'])if(input[k]!==undefined&&typeof input[k]!=='boolean')fail(k,input[k]);
 if(input['numFloors']!==undefined&&!Number.isInteger(input['numFloors']))fail('numFloors',input['numFloors']);
 if(input['reviewedFsiExemptions']!==undefined){const v=input['reviewedFsiExemptions'];if(!Array.isArray(v)||v.some(e=>!isObject(e)||!isNonEmptyString(e['floorId'])||!isNonEmptyString(e['clause'])||!isFiniteNumber(e['areaMm2'])||(e['areaMm2'] as number)<0))fail('reviewedFsiExemptions',v);}
 return errors;
}

import {
  DoorType, EXCHANGE_FRAME, EXCHANGE_MAX_BYTES, canonicalIfcGlobalId, exchangeArtifactDigest, exchangeRevision, isPhysicalBoundary,
  readIfc4Step, stepArgs, stepNumber,
  type Building, type CanonicalExchangeAdapter, type CanonicalExchangeRevision, type ExchangeArtifact, type ExchangeReadback,
  type IfcElementMapping, type IfcExchangeArtifact, type IfcOmission, type Point, type Polygon, type Wall,
} from '@ai-floor-planner/core';
import {
  canonicalCurvedOpeningGeometry,
  canonicalOpeningGeometry,
  polygonArea,
  wallToPolygon,
} from '@ai-floor-planner/geometry-engine';
import { projectBuildingTo3D } from '@ai-floor-planner/projection-3d';
import { IfcStepWriter, exchangeRing, stepList, stepReal, stepString, type StepId } from './ifc-step-writer';

const CURVE_TOLERANCE_MM = 0.5;
const POSITION_TOLERANCE_MM = 0.001;

function assertRevision(expected: CanonicalExchangeRevision, actual: CanonicalExchangeRevision) {
  if (expected.projectId !== actual.projectId || expected.buildingId !== actual.buildingId ||
    expected.revision !== actual.revision || expected.sha256 !== actual.sha256) {
    throw new Error('IFC_STALE_REVISION');
  }
}

function annularWall(wall: Wall): { polygon: Polygon; axisPoints: readonly Point[]; deviation: number } {
  if (!wall.arc) return { polygon: wallToPolygon(wall), axisPoints: [wall.startPoint, wall.endPoint], deviation: 0 };
  const { center, radiusMm, startAngleRad, endAngleRad } = wall.arc;
  const sweep = endAngleRad - startAngleRad;
  const outer = radiusMm + wall.thickness / 2;
  const inner = radiusMm - wall.thickness / 2;
  if (!Number.isFinite(outer) || inner <= 0 || !Number.isFinite(sweep) || Math.abs(sweep) < 1e-9 ||
    Math.abs(sweep) >= 2 * Math.PI) throw new Error('IFC_INVALID_WALL_ARC');
  const maxAngle = 2 * Math.acos(1 - CURVE_TOLERANCE_MM / Math.max(outer, CURVE_TOLERANCE_MM));
  const segments = Math.max(2, Math.ceil(Math.abs(sweep) / maxAngle));
  if (segments > 4096) throw new Error('IFC_CURVE_COMPLEXITY_LIMIT');
  const points = (radius: number) => Array.from({ length: segments + 1 }, (_, i) => {
    const angle = startAngleRad + sweep * i / segments;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
  return {
    polygon: { points: [...points(outer), ...points(inner).reverse()] },
    axisPoints: [wall.startPoint, ...points(radiusMm).slice(1, -1), wall.endPoint],
    deviation: outer * (1 - Math.cos(sweep / (2 * segments))),
  };
}

interface Prism {
  readonly polygon: Polygon;
  readonly holes?: readonly Polygon[];
  readonly bottom: number;
  readonly height: number;
}

function profileArea(polygon: Polygon, holes: readonly Polygon[] = []) {
  return polygonArea(polygon) - holes.reduce((sum, hole) => sum + polygonArea(hole), 0);
}

export class CanonicalIfcExchangeAdapter implements CanonicalExchangeAdapter {
  readonly format = 'IFC4' as const;

  async export(building: Building, revision: CanonicalExchangeRevision): Promise<IfcExchangeArtifact> {
    assertRevision(revision, exchangeRevision(building));
    const projection = projectBuildingTo3D(building);
    const step = new IfcStepWriter();
    const mappings: IfcElementMapping[] = [];
    const omissions: IfcOmission[] = [];
    const globalIds = new Set<string>();
    let maximumCurveChordDeviationMm = 0;
    const guid = (...key: string[]) => {
      // The namespace deliberately excludes revision and geometry.
      const id = canonicalIfcGlobalId(building.projectId, building.id, ...key);
      if (globalIds.has(id)) throw new Error('IFC_DUPLICATE_CANONICAL_ID');
      globalIds.add(id);
      return id;
    };
    const root = (id: string, name: string, description = '$') => [stepString(id), '$', stepString(name), description];
    const up = step.add('IFCDIRECTION', '(0.,0.,1.)');
    const origin = step.add('IFCAXIS2PLACEMENT3D', step.point(0, 0, 0), '$', '$');
    const northAngle = building.site.orientation * Math.PI / 180;
    const north = step.add('IFCDIRECTION', stepList([Math.sin(northAngle), Math.cos(northAngle)].map(stepReal)));
    const context = step.add('IFCGEOMETRICREPRESENTATIONCONTEXT', '$', "'Model'", '3', '0.000001', origin, north);
    const subcontext = (name: string) => step.add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', stepString(name), "'Model'",
      '*', '*', '*', '*', context, '$', '.MODEL_VIEW.', '$');
    const body = subcontext('Body');
    const axis = subcontext('Axis');
    const footprint = subcontext('FootPrint');
    const mm = step.add('IFCSIUNIT', '*', '.LENGTHUNIT.', '.MILLI.', '.METRE.');
    const areaUnit = step.add('IFCSIUNIT', '*', '.AREAUNIT.', '$', '.SQUARE_METRE.');
    const volumeUnit = step.add('IFCSIUNIT', '*', '.VOLUMEUNIT.', '$', '.CUBIC_METRE.');
    const angleUnit = step.add('IFCSIUNIT', '*', '.PLANEANGLEUNIT.', '$', '.RADIAN.');
    const units = step.add('IFCUNITASSIGNMENT', stepList([mm, areaUnit, volumeUnit, angleUnit]));

    const shape = (name: string, type: string, ctx: StepId, items: readonly StepId[]) =>
      step.add('IFCSHAPEREPRESENTATION', ctx, stepString(name), stepString(type), stepList(items));
    const definition = (shapes: readonly StepId[]) => step.add('IFCPRODUCTDEFINITIONSHAPE', '$', '$', stepList(shapes));
    const planShape = (polygon: Polygon) => shape('FootPrint', 'Curve2D', footprint, [step.polyline(exchangeRing(polygon))]);
    const solid = ({ polygon, holes = [], bottom, height }: Prism) => {
      if (height <= 0 || profileArea(polygon, holes) <= 0) throw new Error('IFC_DEGENERATE_EXTRUSION');
      const outer = step.polyline(exchangeRing(polygon));
      const profile = holes.length
        ? step.add('IFCARBITRARYPROFILEDEFWITHVOIDS', '.AREA.', '$', outer, stepList(holes.map(hole => step.polyline(exchangeRing(hole, true)))))
        : step.add('IFCARBITRARYCLOSEDPROFILEDEF', '.AREA.', '$', outer);
      const position = bottom === 0 ? origin : step.add('IFCAXIS2PLACEMENT3D', step.point(0, 0, bottom), '$', '$');
      return step.add('IFCEXTRUDEDAREASOLID', profile, position, up, stepReal(height));
    };
    const bodyShape = (...items: Prism[]) => shape('Body', 'SweptSolid', body, items.map(solid));
    const relationship = (entity: string, key: string[], ...args: string[]) => step.add(entity, ...root(guid('relationship', ...key), ''), ...args);
    const aggregate = (key: string[], parent: StepId, children: readonly StepId[]) => {
      if (children.length) relationship('IFCRELAGGREGATES', key, parent, stepList(children));
    };
    const props = (product: StepId, mapping: IfcElementMapping) => {
      const values = [
        ['CanonicalId', 'IFCIDENTIFIER', mapping.canonicalId],
        ['CanonicalFloorId', 'IFCIDENTIFIER', mapping.floorId],
        ...(mapping.hostWallId === undefined ? [] : [['CanonicalHostWallId', 'IFCIDENTIFIER', mapping.hostWallId]]),
      ];
      const items = values.map(([name, type, value]) => step.add('IFCPROPERTYSINGLEVALUE', stepString(name!), '$',
        type! + '(' + stepString(value!) + ')', '$'));
      const pset = step.add('IFCPROPERTYSET', ...root(guid('pset', mapping.externalId), 'RHPlannerCanonicalIdentity'), stepList(items));
      relationship('IFCRELDEFINESBYPROPERTIES', ['properties', mapping.externalId], stepList([product]), pset);
    };
    const register = (mapping: IfcElementMapping, product: StepId) => {
      mappings.push(mapping);
      props(product, mapping);
      return product;
    };

    const projectGuid = guid('project');
    const project = register({ kind: 'project', floorId: '', canonicalId: building.projectId, externalId: projectGuid, ifcClass: 'IFCPROJECT' },
      step.add('IFCPROJECT', ...root(projectGuid, building.name), '$', '$', '$', stepList([context]), units));
    const siteGuid = guid('site', building.site.id);
    const sitePlace = step.placement(0);
    const site = register({ kind: 'site', floorId: '', canonicalId: building.site.id, externalId: siteGuid, ifcClass: 'IFCSITE',
      profileAreaMm2: polygonArea(building.site.plotBoundary) },
    step.add('IFCSITE', ...root(siteGuid, 'Site'), '$', sitePlace, definition([planShape(building.site.plotBoundary)]),
      '$', '.ELEMENT.', '$', '$', '$', '$', '$'));
    const buildingGuid = guid('building');
    const buildingPlace = step.placement(0, sitePlace);
    const buildingEntity = register({ kind: 'building', floorId: '', canonicalId: building.id, externalId: buildingGuid, ifcClass: 'IFCBUILDING' },
      step.add('IFCBUILDING', ...root(buildingGuid, building.name), '$', buildingPlace, '$', '$', '.ELEMENT.', '$', '$', '$'));
    aggregate(['project-site'], project, [site]);
    aggregate(['site-building'], site, [buildingEntity]);

    const stores: StepId[] = [];
    const materials = new Map<string, StepId>();
    const mappedWallGeometry = new Map(projection.walls.map(wall => [JSON.stringify([wall.floorId, wall.sourceEntityId]), wall]));
    const levels = new Map(projection.levels.map(level => [level.floorId, level]));
    const plates = new Map(projection.floorPlates.map(plate => [plate.floorId, plate]));
    for (const floor of building.floors) {
      const floorId = floor.id;
      const { elevation } = levels.get(floorId)!;
      const mapping = (kind: IfcElementMapping['kind'], canonicalId: string, ifcClass: string): IfcElementMapping =>
        ({ kind, floorId, canonicalId, ifcClass, externalId: guid(kind, floorId, canonicalId) });
      const omit = (kind: IfcOmission['kind'], canonicalId: string, reason: string) => omissions.push({ kind, floorId, canonicalId, reason });
      const place = step.placement(elevation, buildingPlace);
      const levelMapping = { ...mapping('floor', floorId, 'IFCBUILDINGSTOREY'), elevationMm: elevation };
      const storey = register(levelMapping, step.add('IFCBUILDINGSTOREY',
        ...root(levelMapping.externalId, floor.name), '$', place, '$', '$', '.ELEMENT.', stepReal(elevation)));
      stores.push(storey);
      const contained: StepId[] = [];
      const spaces: StepId[] = [];
      const wallIds = new Map<string, StepId>();
      const walls = new Map(floor.walls.map(wall => [wall.id, wall]));
      for (const wall of floor.walls) {
        const geometry = mappedWallGeometry.get(JSON.stringify([floorId, wall.id]));
        if (!isPhysicalBoundary(wall) || !geometry || geometry.height <= 0) {
          omit('wall', wall.id, 'Nonphysical or void-only boundary');
          continue;
        }
        if (wall.boundaryRole === 'GUARDRAIL') {
          const { polygon: railPoly, axisPoints: railAxis, deviation: railDev } = annularWall(wall);
          maximumCurveChordDeviationMm = Math.max(maximumCurveChordDeviationMm, railDev);
          const railEndpoints = [wall.startPoint, wall.endPoint].map(p => ({ x: p.x, y: -p.y }));
          const railShapes = [
            shape('Axis', 'Curve2D', axis, [step.polyline(railAxis.map(p => ({ x: p.x, y: -p.y })), false)]),
            bodyShape({ polygon: railPoly, bottom: 0, height: geometry.height }),
          ];
          const railMap = {
            ...mapping('railing', wall.id, 'IFCRAILING'),
            axisMm: [railEndpoints[0]!.x, railEndpoints[0]!.y, railEndpoints[1]!.x, railEndpoints[1]!.y] as const,
            widthMm: wall.thickness,
            heightMm: geometry.height,
            profileAreaMm2: polygonArea(railPoly),
          };
          const railProduct = register(
            railMap,
            step.add('IFCRAILING', ...root(railMap.externalId, 'Guardrail'), '$', place, definition(railShapes), '$', '.BALUSTRADE.'),
          );
          contained.push(railProduct);
          continue;
        }
        const { polygon, axisPoints, deviation } = annularWall(wall);
        maximumCurveChordDeviationMm = Math.max(maximumCurveChordDeviationMm, deviation);
        const endpoints = [wall.startPoint, wall.endPoint].map(p => ({ x: p.x, y: -p.y }));
        const shapes = [shape('Axis', 'Curve2D', axis, [step.polyline(axisPoints.map(p => ({ x: p.x, y: -p.y })), false)]),
          bodyShape({ polygon, bottom: 0, height: geometry.height })];
        const id = { ...mapping('wall', wall.id, 'IFCWALL'), axisMm: [endpoints[0]!.x, endpoints[0]!.y, endpoints[1]!.x, endpoints[1]!.y] as const,
          widthMm: wall.thickness, heightMm: geometry.height, profileAreaMm2: polygonArea(polygon) };
        const product = register(id, step.add('IFCWALL', ...root(id.externalId, wall.wallUse ?? 'Wall'), '$', place,
          definition(shapes), '$', wall.boundaryRole === 'PARAPET' || wall.wallUse === 'PARAPET' ? '.PARAPET.' : '.NOTDEFINED.'));
        wallIds.set(wall.id, product);
        contained.push(product);
        if (wall.material) {
          const material = materials.get(wall.material) ?? step.add('IFCMATERIAL', stepString(wall.material), '$', '$');
          materials.set(wall.material, material);
          relationship('IFCRELASSOCIATESMATERIAL', ['material', id.externalId], stepList([product]), material);
        }
      }

      for (const room of floor.rooms) {
        if (room.openToSky || room.spaceUse === 'VOID' || room.architecturalRole === 'OPEN_TO_SKY_VOID') {
          omit('room', room.id, 'Open void, no occupied space body');
          continue;
        }
        const id = { ...mapping('room', room.id, 'IFCSPACE'), profileAreaMm2: polygonArea(room.boundary) };
        const representations = [planShape(room.boundary)];
        if (room.clearHeightMm !== undefined && room.clearHeightMm > 0 && room.spaceUse !== 'OUTDOOR') {
          representations.push(bodyShape({ polygon: room.boundary, bottom: 0, height: room.clearHeightMm }));
        }
        spaces.push(register(id, step.add('IFCSPACE', ...root(id.externalId, room.name), '$', place,
          definition(representations), '$', '.ELEMENT.', '.SPACE.', '$')));
      }

      const plate = plates.get(floorId)!;
      if (floor.slabThicknessMm !== undefined && floor.slabThicknessMm > 0) {
        // End-on-end recesses are already cut out of the derived exterior ring.
        const polygon = plate.boundary;
        const seenHoles = new Set<string>();
        const holes = plate.cutouts.filter(hole => {
          const key = hole.points.map(p => JSON.stringify([p.x, p.y])).sort().join();
          if (seenHoles.has(key)) return false;
          seenHoles.add(key);
          return true;
        });
        const id = { ...mapping('slab', floorId, 'IFCSLAB'), profileAreaMm2: profileArea(polygon, holes), heightMm: floor.slabThicknessMm };
        contained.push(register(id, step.add('IFCSLAB', ...root(id.externalId, floor.name + ' slab'), '$', place,
          definition([bodyShape({ polygon, holes, bottom: -floor.slabThicknessMm, height: floor.slabThicknessMm })]), '$',
          floor.floorUse === 'ROOF' ? '.ROOF.' : '.FLOOR.')));
      } else omit('slab', floorId, 'Canonical slab thickness unavailable');

      for (const [kind, openings] of [['door', floor.doors], ['window', floor.windows]] as const) {
        for (const opening of openings) {
          const wall = walls.get(opening.wallId);
          const host = wallIds.get(opening.wallId);
          const hostGeometry = mappedWallGeometry.get(JSON.stringify([floorId, opening.wallId]));
          const isPassage = kind === 'door' && opening.type === DoorType.OpenPassage;
          if (!wall || !host || !hostGeometry) {
            omit(kind, opening.id, 'No exported physical host');
            continue;
          }
          const sill = 'sillHeight' in opening ? opening.sillHeight : 0;
          if (sill < 0 || sill + opening.height > hostGeometry.height + POSITION_TOLERANCE_MM) {
            omit(kind, opening.id, 'Opening exceeds exported host height');
            continue;
          }
          let polygon: Polygon;
          let fillPolygon: Polygon;
          if (wall.arc) {
            let curvedPlacement: ReturnType<typeof canonicalCurvedOpeningGeometry>;
            try {
              curvedPlacement = canonicalCurvedOpeningGeometry(opening, wall);
            } catch {
              omit(kind, opening.id, 'Curved-host opening lacks a valid canonical arc interval');
              continue;
            }
            const { radiusMm, startAngleRad, endAngleRad } = wall.arc;
            const sign = endAngleRad >= startAngleRad ? 1 : -1;
            const tx = -Math.sin(curvedPlacement.thetaCenter) * sign;
            const ty = Math.cos(curvedPlacement.thetaCenter) * sign;
            const halfSweep = Math.abs(curvedPlacement.thetaEnd - curvedPlacement.thetaStart) / 2;
            const sagitta = radiusMm * (1 - Math.cos(halfSweep));
            const cutHalfThk = wall.thickness / 2 + sagitta + 20;
            const fillHalfThk = Math.min(wall.thickness / 2, kind === 'door' ? 25 : 35);
            const halfW = opening.width / 2;
            const cx = opening.position.x;
            const cy = opening.position.y;
            const nx = -ty;
            const ny = tx;
            polygon = {
              points: [
                { x: cx - tx * halfW + nx * cutHalfThk, y: cy - ty * halfW + ny * cutHalfThk },
                { x: cx + tx * halfW + nx * cutHalfThk, y: cy + ty * halfW + ny * cutHalfThk },
                { x: cx + tx * halfW - nx * cutHalfThk, y: cy + ty * halfW - ny * cutHalfThk },
                { x: cx - tx * halfW - nx * cutHalfThk, y: cy - ty * halfW - ny * cutHalfThk },
              ],
            };
            fillPolygon = {
              points: [
                { x: cx - tx * halfW + nx * fillHalfThk, y: cy - ty * halfW + ny * fillHalfThk },
                { x: cx + tx * halfW + nx * fillHalfThk, y: cy + ty * halfW + ny * fillHalfThk },
                { x: cx + tx * halfW - nx * fillHalfThk, y: cy + ty * halfW - ny * fillHalfThk },
                { x: cx - tx * halfW - nx * fillHalfThk, y: cy - ty * halfW - ny * fillHalfThk },
              ],
            };
          } else {
            let placement: ReturnType<typeof canonicalOpeningGeometry>;
            try {
              placement = canonicalOpeningGeometry(opening, wall);
            } catch {
              omit(kind, opening.id, 'Opening lacks a valid canonical centre, interval or host');
              continue;
            }
            const normal = { x: -placement.uy * wall.thickness / 2, y: placement.ux * wall.thickness / 2 };
            const fillRatio = Math.min(1, (kind === 'door' ? 50 : 70) / Math.max(50, wall.thickness));
            const fillNormal = { x: normal.x * fillRatio, y: normal.y * fillRatio };
            const p = placement.startPoint, q = placement.endPoint;
            polygon = {
              points: [
                { x: p.x + normal.x, y: p.y + normal.y },
                { x: q.x + normal.x, y: q.y + normal.y },
                { x: q.x - normal.x, y: q.y - normal.y },
                { x: p.x - normal.x, y: p.y - normal.y },
              ],
            };
            fillPolygon = {
              points: [
                { x: p.x + fillNormal.x, y: p.y + fillNormal.y },
                { x: q.x + fillNormal.x, y: q.y + fillNormal.y },
                { x: q.x - fillNormal.x, y: q.y - fillNormal.y },
                { x: p.x - fillNormal.x, y: p.y - fillNormal.y },
              ],
            };
          }
          const ifcClass = isPassage ? 'IFCOPENINGELEMENT' : kind === 'door' ? 'IFCDOOR' : 'IFCWINDOW';
          const item = mapping(kind, opening.id, ifcClass);
          const openingGlobalId = isPassage ? item.externalId : guid('opening', floorId, kind, opening.id);
          const id = { ...item, hostWallId: opening.wallId, openingGlobalId, widthMm: opening.width, heightMm: opening.height };
          const openingPlace = step.placement(0, place);
          const cut = step.add('IFCOPENINGELEMENT', ...root(openingGlobalId, isPassage ? 'Open passage' : 'Hosted void'), '$', openingPlace,
            definition([bodyShape({ polygon, bottom: sill, height: opening.height })]), '$', '.OPENING.');
          relationship('IFCRELVOIDSELEMENT', ['void', openingGlobalId], host, cut);
          if (isPassage) register(id, cut);
          else {
            const fillShape = definition([bodyShape({ polygon: fillPolygon, bottom: sill, height: opening.height })]);
            const fill = register(id, step.add(ifcClass, ...root(id.externalId, kind === 'door' ? 'Door' : 'Window'), '$', step.placement(0, openingPlace), fillShape, '$',
              stepReal(opening.height), stepReal(opening.width), kind === 'door' ? '.DOOR.' : '.WINDOW.', '.NOTDEFINED.', '$'));
            relationship('IFCRELFILLSELEMENT', ['fill', openingGlobalId], cut, fill);
            contained.push(fill);
          }
        }
      }

      const stairs = new Map<string, Prism[]>();
      for (const part of projection.architecturalSolids ?? []) {
        if (part.floorId !== floorId || part.sourceEntityType !== 'stair') continue;
        const recipe = stairs.get(part.sourceEntityId) ?? [];
        recipe.push({ polygon: part.boundary, bottom: part.bottom - elevation, height: part.top - part.bottom });
        stairs.set(part.sourceEntityId, recipe);
      }
      for (const [sourceId, parts] of stairs) {
        const id = mapping('stair', sourceId, 'IFCSTAIR');
        const canonStair = floor.canonicalStaircases?.find(cs => cs.id === sourceId);
        const stairEntity = register(id, step.add('IFCSTAIR', ...root(id.externalId, 'Stair'), '$', place,
          canonStair ? '$' : definition([bodyShape(...parts)]), '$', '.NOTDEFINED.'));
        contained.push(stairEntity);

        // Emit decomposed IfcStairFlight sub-elements when canonicalStaircases metadata is present (IFC4 CorrectShapeDecomposition)
        if (canonStair) {
          const riserHeightMm = Math.round(floor.floorHeight / Math.max(1, canonStair.riserCount));
          const flightChildren: StepId[] = [];
          const sortedByBottom = [...parts].sort((a, b) => a.bottom - b.bottom);
          const midIdx = Math.max(1, Math.floor(sortedByBottom.length / 2));
          const f1Parts = sortedByBottom.slice(0, midIdx);
          const f2Parts = sortedByBottom.slice(midIdx);
          if (f1Parts.length > 0) {
            const f1Guid = guid('stair-flight', floorId, sourceId, 'flight1');
            const f1Risers = Math.max(1, Math.floor(canonStair.riserCount / 2));
            flightChildren.push(
              step.add('IFCSTAIRFLIGHT', ...root(f1Guid, 'Flight 1'), '$', place,
                definition([bodyShape(...f1Parts)]), '$', String(f1Risers),
                String(Math.max(1, f1Risers - 1)), stepReal(riserHeightMm),
                stepReal(canonStair.treadWidthMm), '.STRAIGHT.'),
            );
          }
          if (f2Parts.length > 0) {
            const f2Guid = guid('stair-flight', floorId, sourceId, 'flight2');
            const f2Risers = Math.max(1, Math.ceil(canonStair.riserCount / 2));
            flightChildren.push(
              step.add('IFCSTAIRFLIGHT', ...root(f2Guid, 'Flight 2'), '$', place,
                definition([bodyShape(...f2Parts)]), '$', String(f2Risers),
                String(Math.max(1, f2Risers - 1)), stepReal(riserHeightMm),
                stepReal(canonStair.treadWidthMm), '.STRAIGHT.'),
            );
          }
          aggregate(['stair-flights', floorId, sourceId], stairEntity, flightChildren);
        }
      }
      for (const stair of floor.stairs) {
        if (!stairs.has(stair.id)) omit('stair', stair.id, 'Legacy stair envelope without canonical flight solids');
      }
      for (const column of floor.columns) omit('column', column.id, 'Provisional framing excluded from architectural exchange');
      for (const beam of floor.beams ?? []) omit('beam', beam.id, 'Provisional framing excluded from architectural exchange');
      for (const item of floor.furniture ?? []) omit('furniture', item.id, 'Furniture is outside the architectural exchange profile');
      aggregate(['spaces', floorId], storey, spaces);
      if (contained.length) relationship('IFCRELCONTAINEDINSPATIALSTRUCTURE', ['contained', floorId], stepList(contained), storey);
    }
    aggregate(['storeys'], buildingEntity, stores);
    if (building.mep || building.mepEngineering) omissions.push({ kind: 'mep', floorId: '', canonicalId: building.id, reason: 'MEP is outside the architectural exchange profile' });
    const bytes = step.encode();
    if (bytes.length > EXCHANGE_MAX_BYTES) throw new Error('IFC_FILE_SIZE_LIMIT');
    const artifact: IfcExchangeArtifact = { bytes, manifest: {
      contractVersion: 1, adapterVersion: 1, format: 'IFC4', unit: 'mm', frame: EXCHANGE_FRAME,
      scope: 'ARCHITECTURAL', source: revision, artifactSha256: exchangeArtifactDigest(bytes),
      elements: mappings, omissions, maximumCurveChordDeviationMm, verification: 'SOFTWARE_READBACK',
    } };
    const result = await this.readback(artifact, revision);
    if (result.lostCanonicalIds.length || result.changedHostIds.length ||
      result.maximumPositionErrorMm > POSITION_TOLERANCE_MM || result.maximumAreaErrorMm2 > 0.1) {
      throw new Error('IFC_SOFTWARE_READBACK_MISMATCH');
    }
    return artifact;
  }

  async readback(artifact: ExchangeArtifact, expected: CanonicalExchangeRevision): Promise<ExchangeReadback> {
    const manifest = artifact.manifest as IfcExchangeArtifact['manifest'];
    assertRevision(expected, manifest.source);
    if (manifest.contractVersion !== 1 || manifest.adapterVersion !== 1 || manifest.format !== 'IFC4' ||
      manifest.unit !== 'mm' || manifest.frame !== EXCHANGE_FRAME ||
      manifest.artifactSha256 !== exchangeArtifactDigest(artifact.bytes)) throw new Error('IFC_ARTIFACT_ENVELOPE_MISMATCH');
    const reader = readIfc4Step(artifact.bytes);
    const voidedHosts = new Map<string, string>();
    const filledVoids = new Map<string, string>();
    for (const entity of reader.entities.values()) {
      if (entity.type === 'IFCRELVOIDSELEMENT') {
        const opening = reader.entity(entity.args[5], 'IFCOPENINGELEMENT');
        if (voidedHosts.has(opening.id)) throw new Error('IFC_MULTIPLE_OPENING_HOSTS');
        voidedHosts.set(opening.id, reader.entity(entity.args[4], 'IFCWALL').id);
      }
      if (entity.type === 'IFCRELFILLSELEMENT') {
        const fill = reader.entity(entity.args[5]);
        if (filledVoids.has(fill.id)) throw new Error('IFC_MULTIPLE_FILLS');
        filledVoids.set(fill.id, reader.entity(entity.args[4], 'IFCOPENINGELEMENT').id);
      }
    }
    const walls = new Map(manifest.elements.filter(item => item.kind === 'wall').map(item =>
      [JSON.stringify([item.floorId, item.canonicalId]), reader.roots.get(item.externalId)?.id]));
    const lostCanonicalIds: string[] = [];
    const changedHostIds: string[] = [];
    let maximumPositionErrorMm = 0;
    let maximumAreaErrorMm2 = 0;
    const seen = new Set<string>();
    for (const mapping of manifest.elements) {
      const entity = reader.roots.get(mapping.externalId);
      if (!entity || entity.type !== mapping.ifcClass || seen.has(mapping.externalId)) {
        lostCanonicalIds.push(mapping.canonicalId);
        continue;
      }
      seen.add(mapping.externalId);
      const compare = (actual: number, target: number) =>
        maximumPositionErrorMm = Math.max(maximumPositionErrorMm, Math.abs(actual - target));
      if (mapping.elevationMm !== undefined) {
        compare(stepNumber(entity.args[9]), mapping.elevationMm);
        const placement = reader.entity(entity.args[5], 'IFCLOCALPLACEMENT');
        const localAxis = reader.entity(placement.args[1], 'IFCAXIS2PLACEMENT3D');
        compare(reader.point(localAxis.args[0])[2]!, mapping.elevationMm);
      }
      let opening: ReturnType<typeof reader.entity> | undefined;
      if (mapping.hostWallId !== undefined) {
        opening = mapping.openingGlobalId ? reader.roots.get(mapping.openingGlobalId) : undefined;
        const hostId = walls.get(JSON.stringify([mapping.floorId, mapping.hostWallId]));
        if (!opening || !hostId || voidedHosts.get(opening.id) !== hostId ||
          (entity.type === 'IFCOPENINGELEMENT' ? opening.id !== entity.id : filledVoids.get(entity.id) !== opening.id)) {
          changedHostIds.push(mapping.canonicalId);
        }
        if (entity.type !== 'IFCOPENINGELEMENT') {
          compare(stepNumber(entity.args[9]), mapping.widthMm!);
          compare(stepNumber(entity.args[8]), mapping.heightMm!);
        }
      }
      const geometricEntity = opening ?? entity;
      if (geometricEntity.args[6] && geometricEntity.args[6] !== '$' &&
        (mapping.axisMm || mapping.profileAreaMm2 !== undefined || mapping.heightMm !== undefined)) {
        const product = reader.entity(geometricEntity.args[6], 'IFCPRODUCTDEFINITIONSHAPE');
        const shapes = stepArgs(product.args[2]!).map(ref => reader.entity(ref, 'IFCSHAPEREPRESENTATION'));
        const itemOf = (identifier: string) => {
          const repr = shapes.find(candidate => candidate.args[1] === identifier);
          return repr && stepArgs(repr.args[3]!)[0];
        };
        if (mapping.axisMm) {
          const vertices = reader.ring(itemOf("'Axis'"));
          const positions = [vertices[0]!, vertices.at(-1)!].flatMap(p => [p.x, p.y]);
          mapping.axisMm.forEach((target, i) => compare(positions[i]!, target));
        }
        const body = itemOf("'Body'");
        const outline = itemOf("'FootPrint'");
        const extrusion = body ? reader.entity(body, 'IFCEXTRUDEDAREASOLID') : undefined;
        if (mapping.heightMm !== undefined && extrusion) compare(stepNumber(extrusion.args[3]), mapping.heightMm);
        if (mapping.profileAreaMm2 !== undefined) {
          const profile = extrusion && reader.entity(extrusion.args[0]);
          const measured = outline
            ? polygonArea({ points: reader.ring(outline) })
            : profileArea({ points: reader.ring(profile?.args[2]) }, profile?.type === 'IFCARBITRARYPROFILEDEFWITHVOIDS'
              ? stepArgs(profile.args[3]!).map(ref => ({ points: reader.ring(ref) })) : []);
          maximumAreaErrorMm2 = Math.max(maximumAreaErrorMm2, Math.abs(measured - mapping.profileAreaMm2));
        }
      }
    }
    return { maximumPositionErrorMm, maximumAreaErrorMm2, maximumArcDeviationMm: manifest.maximumCurveChordDeviationMm,
      lostCanonicalIds, changedHostIds };
  }
}

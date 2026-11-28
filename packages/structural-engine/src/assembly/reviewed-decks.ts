import type { Building } from '@ai-floor-planner/core';
import type { SynthesizedSlabPanel, SynthesizedStructuralSystem } from './canonical-frame-assembler.js';
import type { PhysicalSlab } from '../types/physical-structural-model.js';
import { resolveRectangularSlabTransfer } from '../loads/rectangular-slab-transfer.js';

/** Review of one entire simply supported deck at a structural level. */
export interface RectangularDeckReview {
  readonly boundaryCondition: 'SIMPLY_SUPPORTED_FULL_LEVEL' | 'SIMPLY_SUPPORTED_GRID_BAYS';
  readonly schema: 'RH_RECTANGULAR_DECK_V1';
  readonly architectureSha256: string;
  readonly reference: string;
  readonly supportingFloorId: string;
  readonly surfaceFloorId: string;
  readonly use: 'OCCUPIED' | 'ROOF' | 'TERRACE';
  readonly structuralTopMm: number;
  readonly finishedFloorMm: number;
  readonly thicknessMm: number;
  readonly uniformLiveLoadKnM2: number;
  readonly minimumBearingWidthMm: number;
}

export function isRectangularDeckReview(value: unknown): value is RectangularDeckReview {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  return (r.boundaryCondition === 'SIMPLY_SUPPORTED_FULL_LEVEL' || r.boundaryCondition === 'SIMPLY_SUPPORTED_GRID_BAYS') && r.schema === 'RH_RECTANGULAR_DECK_V1' && typeof r.architectureSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(r.architectureSha256) &&
    [r.reference, r.supportingFloorId, r.surfaceFloorId].every(v => typeof v === 'string' && v.trim().length > 0) &&
    ['OCCUPIED', 'ROOF', 'TERRACE'].includes(String(r.use)) && finite(r.structuralTopMm) &&
    finite(r.finishedFloorMm) && r.finishedFloorMm >= r.structuralTopMm && finite(r.thicknessMm) && r.thicknessMm > 0 &&
    finite(r.uniformLiveLoadKnM2) && r.uniformLiveLoadKnM2 >= 0 && finite(r.minimumBearingWidthMm) && r.minimumBearingWidthMm > 0;
}

export class DeckReviewError extends Error {}

type Ring = Building['floors'][number]['boundary']['points'];

function rectangleBounds(ring: Ring) {
  const xs = [...new Set(ring.map(p=>p.x))].sort((a,b)=>a-b);
  const ys = [...new Set(ring.map(p=>p.y))].sort((a,b)=>a-b);
  if (ring.length!==4 || xs.length!==2 || ys.length!==2 || new Set(ring.map(p=>p.x+','+p.y)).size!==4 ||
      ring.some((p,i)=>(p.x===ring[(i+1)%4]!.x)===(p.y===ring[(i+1)%4]!.y)))
    throw new DeckReviewError('Grid bays require rectangular level boundaries and rectangular full-bay openings.');
  return {minX:xs[0]!,maxX:xs[1]!,minY:ys[0]!,maxY:ys[1]!};
}

function gridBayRings(owner:Building['floors'][number], beams:SynthesizedStructuralSystem['physicalModel']['beams']): Ring[] {
  const box = rectangleBounds(owner.boundary.points);
  const xs = new Set([box.minX,box.maxX]), ys = new Set([box.minY,box.maxY]);
  for (const {startPointMm:a,endPointMm:b} of beams) {
    if (a.x===b.x && a.x>box.minX && a.x<box.maxX) xs.add(a.x);
    if (a.y===b.y && a.y>box.minY && a.y<box.maxY) ys.add(a.y);
  }
  const x=[...xs].sort((a,b)=>a-b), y=[...ys].sort((a,b)=>a-b);
  if ((x.length-1)*(y.length-1)>48) throw new DeckReviewError('Grid bay count exceeds the reviewed mesh budget.');
  const holes=(owner.voidBoundaries ?? []).map(h=>rectangleBounds(h.points));
  for (const hole of holes) {
    if (![hole.minX,hole.maxX].every(i=>xs.has(i)) || ![hole.minY,hole.maxY].every(i=>ys.has(i)))
      throw new DeckReviewError('The approved grid requires each opening edge to coincide with a frame axis.');
  }
  const rings:Ring[]=[];
  for (let j=1;j<y.length;j++) for (let i=1;i<x.length;i++) {
    const x0=x[i-1]!, x1=x[i]!, y0=y[j-1]!, y1=y[j]!;
    const voids=holes.filter(h=>h.minX<=x0 && x1<=h.maxX && h.minY<=y0 && y1<=h.maxY);
    if (voids.length>1) throw new DeckReviewError('Overlapping opening records require review.');
    if (!voids.length) rings.push([{x:x0,y:y0},{x:x0,y:y1},{x:x1,y:y1},{x:x1,y:y0}]);
  }
  if (!rings.length) throw new DeckReviewError('The reviewed grid has no occupied structural bay.');
  return rings;
}

export function applyReviewedDecks(building: Building, system: SynthesizedStructuralSystem, reviews: readonly RectangularDeckReview[]): SynthesizedStructuralSystem {
  if (!reviews.length) return system;
  const replaced = new Set<string>();
  const panels: SynthesizedSlabPanel[] = [];
  const slabs: PhysicalSlab[] = [];
  for (const review of reviews) {
    if (!isRectangularDeckReview(review) || review.architectureSha256 !== system.sourceArchitecturalSha256 ||
        replaced.has(review.supportingFloorId)) throw new DeckReviewError('Invalid, duplicate or stale structural deck review.');
    const owner = building.floors.find(f => f.id === review.surfaceFloorId);
    const support = building.floors.find(f => f.id === review.supportingFloorId);
    const level = system.storeys.find(s => s.id === support?.id);
    if (!owner || !support || !level || level.elevationMm + support.floorHeight !== review.structuralTopMm)
      throw new DeckReviewError('Reviewed deck has no matching frame level.');
    const ownerElevation = system.storeys.find(s => s.id === owner.id)?.elevationMm;
    if (review.use === 'ROOF' ? (owner.id !== support.id || system.storeys.some(s => s.elevationMm > level.elevationMm))
                             : ownerElevation !== review.finishedFloorMm)
      throw new DeckReviewError('The approved surface owner must match the finished level or explicitly own the terminal roof.');
    const grid = review.boundaryCondition === 'SIMPLY_SUPPORTED_GRID_BAYS';
    const unsupportedStair = owner.stairs.some(stair=>{
      if (!grid) return true;
      const waist=system.stairWaists.find(w=>w.floorId===owner.id && w.stairId===stair.id);
      const bounds=waist?.boundsMm;
      return !waist?.hasExplicitStraightFlightGeometry || !bounds || !owner.voidBoundaries?.some(opening=>{
        const hole=rectangleBounds(opening.points);
        return bounds.minX>=hole.minX && bounds.maxX<=hole.maxX && bounds.minY>=hole.minY && bounds.maxY<=hole.maxY;
      });
    });
    if (unsupportedStair || owner.canonicalStaircases?.length || (!grid && owner.voidBoundaries?.length) ||
        building.canonicalStaircases?.some(s => s.floorId === owner.id) ||
        owner.rooms.some(r => r.openToSky || r.spaceUse === 'VOID' || /lift|shaft|stair|courtyard|balcony|ots|open_to_sky/i.test(r.type)))
      throw new DeckReviewError('Openings, stair ownership or projecting decks require coordinated regional analysis.');
    const beams = system.physicalModel.beams.filter(b => b.floorId === support.id && b.topElevationMm === review.structuralTopMm);
    const rings = grid ? gridBayRings(owner,beams) : [owner.boundary.points];
    const grounded = new Set(system.nodes.filter(n => n.restraint?.[2]).map(n => n.index));
    const columns = [...system.physicalModel.columns].sort((a, b) => a.baseElevationMm - b.baseElevationMm);
    for (const column of columns) {
      if (column.topElevationMm > column.baseElevationMm && grounded.has(column.startAnalyticalNodeIndex))
        grounded.add(column.endAnalyticalNodeIndex);
    }
    const columnEnds = new Set(columns.filter(c => c.topElevationMm === review.structuralTopMm &&
      grounded.has(c.endAnalyticalNodeIndex)).map(c => c.endAnalyticalNodeIndex));
    for (const [bayIndex,ring] of rings.entries()) {
      const xs = ring.map(p => p.x), ys = ring.map(p => p.y);
      const boundsMm = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
      const width = boundsMm.maxX - boundsMm.minX, depth = boundsMm.maxY - boundsMm.minY;
      const lxMm = Math.min(width, depth), lyMm = Math.max(width, depth);
      const indices = beams.flatMap(b => b.analyticalElementIndices);
      const id = 'DECK:' + support.id + ':' + owner.id + (grid ? '/bay/'+bayIndex : '');
      const panel: SynthesizedSlabPanel = {
        id, floorId: support.id, floorLevel: support.level, roomName: owner.name, roomType: review.use,
        panelType: lyMm / lxMm > 2 ? 'ONE_WAY' : 'TWO_WAY', lxMm, lyMm, aspectRatioLyLx: lyMm / lxMm,
        areaM2: width * depth / 1e6, thicknessMm: review.thicknessMm, concreteGrade: system.concreteGrade,
        steelGrade: system.steelGrade, discontinuousEdges: 4, boundsMm, exchangeBoundary: ring,
        supportingBeamElementIndices: indices, sizingProvenance: 'USER_OR_OPTIMIZER_ASSIGNED', deckReview: review,
      };
      const transfer = resolveRectangularSlabTransfer(system, panel, review.structuralTopMm, indices, false);
      if (transfer.kind === 'UNRESOLVED') throw new DeckReviewError('Reviewed deck transfer unresolved: ' + transfer.reason);
      const edgeIndices = new Set(transfer.segments.map(seg => seg.elementIndex));
      const supports = beams.filter(b => b.analyticalElementIndices.some(i => edgeIndices.has(i)));
      if (transfer.completeEdges.length !== 4 || supports.some(b => b.widthMm / 2 < review.minimumBearingWidthMm ||
          !columnEnds.has(b.startAnalyticalNodeIndex) || !columnEnds.has(b.endAnalyticalNodeIndex)))
        throw new DeckReviewError('Four full bearing edges with reviewed bearing width and shared column-end nodes are required.');
      const physicalIds = supports.map(b => b.physicalMemberId);
      const supportedPanel = { ...panel, supportingPhysicalBeamIds: physicalIds, supportingBeamElementIndices: [...edgeIndices] };
      panels.push(supportedPanel);
      slabs.push({ ...supportedPanel, kind: 'PHYSICAL_SLAB', physicalMemberId: id, slabMark: id,
        topElevationMm: review.structuralTopMm, supportingAnalyticalElementIndices: [...edgeIndices] });
    }
    replaced.add(support.id);
  }
  return { ...system, slabPanels: [...system.slabPanels.filter(p => !replaced.has(p.floorId)), ...panels],
    physicalModel: { ...system.physicalModel, slabs: [...system.physicalModel.slabs.filter(p => !replaced.has(p.floorId)), ...slabs] } };
}

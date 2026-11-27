import type { Building } from '@ai-floor-planner/core';
import type { SynthesizedSlabPanel, SynthesizedStructuralSystem } from './canonical-frame-assembler.js';
import type { PhysicalSlab } from '../types/physical-structural-model.js';
import { resolveRectangularSlabTransfer } from '../loads/rectangular-slab-transfer.js';

/** Review of one entire simply supported deck at a structural level. */
export interface RectangularDeckReview {
  readonly boundaryCondition: 'SIMPLY_SUPPORTED_FULL_LEVEL';
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
  return r.boundaryCondition === 'SIMPLY_SUPPORTED_FULL_LEVEL' && r.schema === 'RH_RECTANGULAR_DECK_V1' && typeof r.architectureSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(r.architectureSha256) &&
    [r.reference, r.supportingFloorId, r.surfaceFloorId].every(v => typeof v === 'string' && v.trim().length > 0) &&
    ['OCCUPIED', 'ROOF', 'TERRACE'].includes(String(r.use)) && finite(r.structuralTopMm) &&
    finite(r.finishedFloorMm) && r.finishedFloorMm >= r.structuralTopMm && finite(r.thicknessMm) && r.thicknessMm > 0 &&
    finite(r.uniformLiveLoadKnM2) && r.uniformLiveLoadKnM2 >= 0 && finite(r.minimumBearingWidthMm) && r.minimumBearingWidthMm > 0;
}

export class DeckReviewError extends Error {}

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
    if (owner.stairs.length || owner.canonicalStaircases?.length || owner.voidBoundaries?.length ||
        building.canonicalStaircases?.some(s => s.floorId === owner.id) ||
        owner.rooms.some(r => r.openToSky || r.spaceUse === 'VOID' || /lift|shaft|stair|courtyard|balcony|ots|open_to_sky/i.test(r.type)))
      throw new DeckReviewError('Openings, stair ownership or projecting decks require coordinated regional analysis.');
    const ring = owner.boundary.points;
    const xs = ring.map(p => p.x), ys = ring.map(p => p.y);
    const boundsMm = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    const width = boundsMm.maxX - boundsMm.minX, depth = boundsMm.maxY - boundsMm.minY;
    const lxMm = Math.min(width, depth), lyMm = Math.max(width, depth);
    const beams = system.physicalModel.beams.filter(b => b.floorId === support.id && b.topElevationMm === review.structuralTopMm);
    const indices = beams.flatMap(b => b.analyticalElementIndices);
    const id = 'DECK:' + support.id + ':' + owner.id;
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
    const grounded = new Set(system.nodes.filter(n => n.restraint?.[2]).map(n => n.index));
    const columns = [...system.physicalModel.columns].sort((a, b) => a.baseElevationMm - b.baseElevationMm);
    for (const column of columns) {
      if (column.topElevationMm > column.baseElevationMm && grounded.has(column.startAnalyticalNodeIndex))
        grounded.add(column.endAnalyticalNodeIndex);
    }
    const columnEnds = new Set(columns.filter(c => c.topElevationMm === review.structuralTopMm &&
      grounded.has(c.endAnalyticalNodeIndex)).map(c => c.endAnalyticalNodeIndex));
    if (transfer.completeEdges.length !== 4 || supports.some(b => b.widthMm / 2 < review.minimumBearingWidthMm ||
        !columnEnds.has(b.startAnalyticalNodeIndex) || !columnEnds.has(b.endAnalyticalNodeIndex)))
      throw new DeckReviewError('Four full bearing edges with reviewed bearing width and shared column-end nodes are required.');
    const physicalIds = supports.map(b => b.physicalMemberId);
    const supportedPanel = { ...panel, supportingPhysicalBeamIds: physicalIds, supportingBeamElementIndices: [...edgeIndices] };
    panels.push(supportedPanel);
    slabs.push({ ...supportedPanel, kind: 'PHYSICAL_SLAB', physicalMemberId: id, slabMark: id,
      topElevationMm: review.structuralTopMm, supportingAnalyticalElementIndices: [...edgeIndices] });
    replaced.add(support.id);
  }
  return { ...system, slabPanels: [...system.slabPanels.filter(p => !replaced.has(p.floorId)), ...panels],
    physicalModel: { ...system.physicalModel, slabs: [...system.physicalModel.slabs.filter(p => !replaced.has(p.floorId)), ...slabs] } };
}

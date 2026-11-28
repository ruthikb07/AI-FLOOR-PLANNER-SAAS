import type { SynthesizedStaircaseWaist, SynthesizedStructuralSystem } from '../assembly/canonical-frame-assembler.js';

export interface StairBearingReview {
  architectureSha256: string;
  waistId: string;
  lowerBeamId: string;
  upperBeamId: string;
  reference: string;
  method: 'SIMPLY_SUPPORTED_STRAIGHT_FLIGHT';
  liveLoadKnM2: number;
  waistThicknessMm: number;
  minimumBearingMm: number;
  upperLandingMm: number;
}

export function isStairBearingReview(raw: unknown): raw is StairBearingReview {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return typeof r.upperLandingMm === 'number' && Number.isFinite(r.upperLandingMm) &&
    typeof r.minimumBearingMm === 'number' && Number.isFinite(r.minimumBearingMm) && r.minimumBearingMm > 0 && r.method === 'SIMPLY_SUPPORTED_STRAIGHT_FLIGHT' &&
    typeof r.architectureSha256 === 'string' && /^[a-f0-9]{64}$/.test(r.architectureSha256) &&
    [r.waistId,r.lowerBeamId,r.upperBeamId,r.reference].every(s => typeof s === 'string' && s.trim()) &&
    r.lowerBeamId !== r.upperBeamId && typeof r.liveLoadKnM2 === 'number' && Number.isFinite(r.liveLoadKnM2) &&
    r.liveLoadKnM2 >= 0 && typeof r.waistThicknessMm === 'number' && Number.isFinite(r.waistThicknessMm) && r.waistThicknessMm > 0;
}

export function stairBearingEdges(system: SynthesizedStructuralSystem, waist: SynthesizedStaircaseWaist, review: StairBearingReview) {
  const bounds = waist.boundsMm;
  if (!bounds || !waist.flightDirection || waist.baseElevationMm === undefined || waist.topElevationMm === undefined ||
      review.upperLandingMm !== waist.topElevationMm || waist.topElevationMm <= waist.baseElevationMm || !isStairBearingReview(review) ||
      review.architectureSha256 !== system.sourceArchitecturalSha256 || review.waistId !== waist.id)
    throw new Error('Invalid or stale straight stair bearing review.');
  const alongY = ['N','S'].includes(waist.flightDirection);
  const run = alongY ? 1 : 0, cross = alongY ? 0 : 1;
  const runMin = alongY ? bounds.minY : bounds.minX, runMax = alongY ? bounds.maxY : bounds.maxX;
  const crossMin = alongY ? bounds.minX : bounds.minY, crossMax = alongY ? bounds.maxX : bounds.maxY;
  const tol = 1e-5;
  if (Math.abs(runMax-runMin-waist.horizontalSpanMm) > tol || Math.abs(crossMax-crossMin-waist.widthMm) > tol)
    throw new Error('Straight stair span and width must match the full rectangular flight.');
  const sides = [review.lowerBeamId,review.upperBeamId].map((id,end) => {
    const beam = system.physicalModel.beams.find(b => b.physicalMemberId === id);
    if (!beam?.analyticalElementIndices.length || beam.widthMm / 2 < review.minimumBearingMm) throw new Error('Reviewed stair bearing beam is missing.');
    const z = end ? waist.topElevationMm : waist.baseElevationMm;
    const segments = beam.analyticalElementIndices.map(index => {
      const element = system.elements[index];
      if (!element || element.category !== 'BEAM') throw new Error('Reviewed stair requires analytical bearing beams.');
      const pts = [element.startNodeIndex,element.endNodeIndex].map(i => {
        const [x,y,h] = system.nodes[i]!.positionM;
        return [1000*x,-1000*y,1000*h] as const;
      });
      if (pts.some(p => Math.abs(p[2]-z!) > tol) || Math.abs(pts[0]![run]-pts[1]![run]) > tol)
        throw new Error('Reviewed stair beam misses the required transverse bearing or elevation.');
      return { index, side:pts[0]![run], start:Math.min(...pts.map(p=>p[cross])), end:Math.max(...pts.map(p=>p[cross])) };
    }).sort((a,b)=>a.start-b.start);
    const side = segments[0]!.side;
    const ascending = waist.flightDirection === 'S' || waist.flightDirection === 'E';
    if (Math.abs(side - ((end === 1) === ascending ? runMax : runMin)) > tol)
      throw new Error('Stair bearing conflicts with the approved flight direction.');
    if (Math.min(Math.abs(side-runMin),Math.abs(side-runMax)) > tol || Math.abs(segments[0]!.start-crossMin) > tol ||
        Math.abs(segments[segments.length-1]!.end-crossMax) > tol || segments.some((s,i) =>
          s.end <= s.start || Math.abs(s.side-side)>tol || (i>0 && Math.abs(s.start-segments[i-1]!.end)>tol)))
      throw new Error('Reviewed stair requires complete continuous bearing across its width.');
    return {side,indices:segments.map(s=>s.index)};
  });
  if (Math.abs(sides[0]!.side-sides[1]!.side) < waist.horizontalSpanMm-tol)
    throw new Error('Both stair bearings must be on opposite flight ends.');
  return sides.flatMap(s=>s.indices);
}

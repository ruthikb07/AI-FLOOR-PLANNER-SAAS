import type { ApartmentGenerationOutcome, MultiSheetApartmentConfig } from '@ai-floor-planner/core';
import { solveMultiSheetApartmentProject } from './multi-sheet-apartment-solver';

/** Non-throwing generation boundary. Search failure is never proof of infeasibility.
 * Alternatives are generated independently and never substituted for the request.
 */
export function generateApartmentOutcome(config: MultiSheetApartmentConfig): ApartmentGenerationOutcome {
  const dimensions = [config.plotWidthMm, config.plotDepthMm, config.roadWidthMm,
    config.floorToFloorHeightMm ?? 3000, config.stiltHeightMm ?? 3000];
  const sb = config.lotAllotmentMode === 'FULL_LOT_100_PERCENT'
    ? { left: 0, right: 0, front: 0, rear: 0 }
    : config.setbacksMm ?? { left: 3000, right: 3000, front: 4500, rear: 3000 };
  if (dimensions.some(n => !Number.isFinite(n) || n <= 0)
    || Object.values(sb).some(n => !Number.isFinite(n) || n < 0)
    || !Number.isInteger(config.numTypicalFloors) || config.numTypicalFloors < 1 || config.numTypicalFloors > 40
    || !Number.isInteger(config.flatsPerFloor) || config.flatsPerFloor < 1
    || config.units?.length !== config.flatsPerFloor || config.units.some(u => !/^[1-4]BHK$/.test(u.bhkType))) {
    return { status: 'INVALID_INPUT', reason: 'Provide finite positive dimensions, 1–40 floors, nonnegative setbacks and an exact valid BHK unit mix.',
      alternativeChanges: [], alternativeSearch: 'NOT_RUN', professionalReviewRequired: true };
  }
  const width = config.plotWidthMm - sb.left - sb.right;
  const depth = config.plotDepthMm - sb.front - sb.rear;
  const physicallyEmpty = width <= 0 || depth <= 0;
  let reason = 'The requested setbacks leave no positive buildable envelope.';
  if (!physicallyEmpty) {
    try { return { status: 'PLAN', result: solveMultiSheetApartmentProject(config) }; }
    catch (error) { reason = error instanceof Error ? error.message : String(error); }
  }
  // Search the nearest supported flat count and smallest available envelope
  // profile first. This is an explicit alternative proposal, never a site edit.
  const units = config.units!;
  const counts = ([2, 3, 4] as Array<2 | 3 | 4>).sort((a, b) => Math.abs(a - config.flatsPerFloor) - Math.abs(b - config.flatsPerFloor));
  const candidates = counts.flatMap(count => [11000, 18400].map(span => {
    const plotWidthMm = Math.max(config.plotWidthMm, sb.left + sb.right + span);
    const plotDepthMm = Math.max(config.plotDepthMm, sb.front + sb.rear + span);
    const distance = Math.abs(count - config.flatsPerFloor) / config.flatsPerFloor
      + (plotWidthMm - config.plotWidthMm) / config.plotWidthMm + (plotDepthMm - config.plotDepthMm) / config.plotDepthMm;
    return { count, plotWidthMm, plotDepthMm, distance };
  })).filter(c => c.count !== config.flatsPerFloor || c.plotWidthMm !== config.plotWidthMm || c.plotDepthMm !== config.plotDepthMm)
    .sort((a, b) => a.distance - b.distance);
  for (const c of candidates) {
    const changes: string[] = [];
    if (c.count !== config.flatsPerFloor) changes.push(`Flats per floor: ${config.flatsPerFloor} → ${c.count}; unit mix follows the retained units, repeating the last type when needed.`);
    if (c.plotWidthMm !== config.plotWidthMm || c.plotDepthMm !== config.plotDepthMm) changes.push(`Plot: ${config.plotWidthMm} × ${config.plotDepthMm} → ${c.plotWidthMm} × ${c.plotDepthMm} mm; setbacks unchanged.`);
    try {
      const alternative = solveMultiSheetApartmentProject({ ...config, flatsPerFloor: c.count,
        plotWidthMm: c.plotWidthMm, plotDepthMm: c.plotDepthMm,
        units: Array.from({ length: c.count }, (_, i) => ({ ...units[Math.min(i, units.length - 1)]!, unitIndex: i + 1 })) });
      return { status: physicallyEmpty ? 'INFEASIBLE' : 'SEARCH_EXHAUSTED', reason, alternative,
        alternativeChanges: changes, alternativeSearch: 'BOUNDED', professionalReviewRequired: true };
    } catch { /* An alternative is offered only if it actually generated. */ }
  }
  return { status: physicallyEmpty ? 'INFEASIBLE' : 'SEARCH_EXHAUSTED', reason,
    alternativeChanges: [], alternativeSearch: 'BOUNDED', professionalReviewRequired: true };
}

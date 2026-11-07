import { describe, expect, it, vi } from 'vitest';
import {
  Direction,
  applySpaceProgramPreset,
  createBuilding,
  createDefaultFootprintIntent,
  getSpaceProgramPresets,
} from '@ai-floor-planner/core';
import { runGenerationWorkflow } from '../generation/workflow';
import { CandidateGenerator } from '../generator/candidate-generator';

/**
 * Phase 1B / Master PRD §13: the deterministic feasibility engine must reject an
 * impossible program BEFORE any candidate/image generation, return an actionable
 * error, and never silently relax the user's requirements (no bedroom/parking/
 * mandatory-space removal, no plot/setback edits).
 *
 * The fixture uses a valid footprint/program structure but a plot + setbacks
 * whose buildable envelope is far too small for the requested program, so the
 * area-feasibility screen (not the budget layer) is what rejects the request.
 */
function infeasibleInput() {
  const building = createBuilding({
    projectId: 'infeasible-gate',
    name: 'Infeasible fixture',
    site: {
      // ~9.6 x 9.6 m plot with ~3 m setbacks leaves a ~3.6 x 3.6 m envelope.
      plotWidth: 9_600,
      plotDepth: 9_600,
      roadFacing: Direction.North,
      plannedFloorCount: 1,
      setbacks: { front: 3_000, rear: 3_000, left: 3_000, right: 3_000 },
    },
    floors: [{ buildingId: '', level: 0 }],
  });
  // A full 3BHK + parking program is far larger than the tiny envelope.
  const preset = getSpaceProgramPresets('residential').find(c => c.id === 'residential_3bhk')!;
  const program = applySpaceProgramPreset(preset);
  // Footprint kept inside the envelope so the footprint validator passes; only
  // the area feasibility screen should fail.
  const base = createDefaultFootprintIntent(building);
  const footprint = {
    ...base,
    parameters: { ...base.parameters, width: 3_600, depth: 3_600 },
    transform: { ...base.transform, x: 3_000, y: 3_000 },
  };
  return { building, category: 'residential' as const, program, footprint };
}

describe('Phase 1B — feasibility gate blocks impossible programs before generation', () => {
  it('rejects an infeasible program with an actionable error before generating', async () => {
    const spy = vi.spyOn(CandidateGenerator.prototype, 'generateCandidates');
    await expect(runGenerationWorkflow(infeasibleInput())).rejects.toThrow(
      /PLAN_NOT_FEASIBLE|INSUFFICIENT_PLOT_AREA|does not fit/i,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('leaves the user requirements and site intact (no silent relaxation)', async () => {
    const input = infeasibleInput();
    const bedroomBefore = input.program.items
      .filter(i => i.canonicalType === 'bedroom')
      .reduce((sum, i) => sum + i.quantity, 0);
    await expect(runGenerationWorkflow(input)).rejects.toThrow();
    const bedroomAfter = input.program.items
      .filter(i => i.canonicalType === 'bedroom')
      .reduce((sum, i) => sum + i.quantity, 0);
    expect(bedroomAfter).toBe(bedroomBefore);
    expect(input.building.site.plotWidth).toBe(9_600);
    expect(input.building.site.setbacks.front).toBe(3_000);
  });
});

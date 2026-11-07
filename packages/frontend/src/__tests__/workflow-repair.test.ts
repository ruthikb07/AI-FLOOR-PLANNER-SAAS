import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh } from 'three';
import { createBuilding, normalizeDesignRequirementSpecification, RoomType } from '@ai-floor-planner/core';
import { CandidateGenerator, RoomProgramGenerator } from '@ai-floor-planner/planning-engine';
import { getModelBounds, isModelClick, modelFitDistance } from '../services/model-camera';
import { createQuickDesignRequirements, generationStatus, withProjectSite } from '../services/design-site-context';

describe('large-site workflow repairs', () => {
  it('generates the displayed ground-only 2BHK brief without silently adding a balcony', () => {
    const building = createBuilding({ projectId:'default-brief', name:'2BHK', site:{plotWidth:9144,plotDepth:15240,
      setbacks:{front:1524,rear:1219,left:900,right:900}} });
    const spec = createQuickDesignRequirements(building, '2 bedrooms, 2 bathrooms, living, kitchen and dining');
    const program = new RoomProgramGenerator().generateProgram(spec);
    expect(spec.soft.balconyPreferred).toBe(false);
    expect(program.items.some(room => room.type === RoomType.Balcony)).toBe(false);
    const candidates = new CandidateGenerator().generateCandidates(spec, program, 42);
    expect(candidates).toHaveLength(3);
    expect(candidates.every(candidate => candidate.validation.isValid)).toBe(true);
    const requested = new RoomProgramGenerator().generateProgram({ ...spec, soft:{...spec.soft,balconyPreferred:true} });
    expect(requested.items.some(room => room.type === RoomType.Balcony)).toBe(true);
  });
  it('preserves 50 by 60 metres through requirement parsing instead of reverting to 30 by 50 feet', () => {
    const building = createBuilding({ projectId: 'large-site', name: 'Large site', site: { plotWidth: 50000, plotDepth: 60000 } });
    const parsed = normalizeDesignRequirementSpecification({ hard: { plotWidthMm: 9144, plotDepthMm: 15240, bedroomCount: 4 } });
    const result = withProjectSite(parsed, building);
    expect(result.hard.plotWidthMm).toBe(50000);
    expect(result.hard.plotDepthMm).toBe(60000);
    expect(result.hard.bedroomCount).toBe(4);
    expect(result.setbacksMm).toEqual(building.site.setbacks);
    expect(building.site.plotArea / 1e6).toBe(3000);
  });

  it('fits the house rather than the enormous plot, with a separate site fit', () => {
    const root = new Group();
    const house = new Mesh(new BoxGeometry(8, 3, 14));
    house.position.set(5, 1.5, 8);
    root.add(house);
    const site = new Group(); site.name = 'site-context';
    site.add(new Mesh(new BoxGeometry(50, 0.1, 60))); root.add(site);
    const model = getModelBounds(root);
    expect(model.min.x).toBe(1);
    expect(model.max.x).toBe(9);
    expect(getModelBounds(root, true).max.x).toBe(25);
    expect(modelFitDistance(model, 38, 0.6)).toBeGreaterThan(modelFitDistance(model, 38, 1.7));
    expect(modelFitDistance(model, 38, 1.7)).toBeLessThan(40);
  });

  it('does not select a room or refocus while orbit-dragging or finishing another pointer', () => {
    const start = { x: 20, y: 20, id: 1 };
    expect(isModelClick(start, 22, 20, 1)).toBe(true);
    expect(isModelClick(start, 40, 30, 1)).toBe(false);
    expect(isModelClick(start, 20, 20, 2)).toBe(false);
    expect(isModelClick(null, 20, 20, 1)).toBe(false);
  });

  it('never labels an area estimate or failed generation as a verified layout', () => {
    expect(generationStatus(true, true, 0)).toBe('NO VALID LAYOUT GENERATED');
    expect(generationStatus(false, true, 0)).toContain('NOT YET VERIFIED');
    expect(generationStatus(false, true, 3)).toContain('REVIEW REQUIRED');
  });
});

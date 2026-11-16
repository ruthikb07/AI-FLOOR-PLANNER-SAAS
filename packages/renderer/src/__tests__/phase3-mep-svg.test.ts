import { describe, it, expect } from 'vitest';
import {
  createBuilding,
  createFloor,
  Direction,
  type Building,
} from '@ai-floor-planner/core';
import { getFloorContentBounds } from '@ai-floor-planner/geometry-engine';
import { fitToView, renderFloor } from '../index';

describe('Phase 3 Renderer: Engineering Discipline Overlays & Stilt Road Access', () => {
  it('renders M-ELEC, M-PLUMB, A-CEIL, F-FIRE, S-BEAM-CANTILEVER and Stilt IN/OUT gate arrows', () => {
    const stiltFloor = {
      ...createFloor({
        buildingId: 'b-svg',
        level: 0,
        name: 'A-102 STILT_PARKING',
        floorHeight: 3000,
        boundary: {
          points: [
            { x: 2000, y: 2000 },
            { x: 22000, y: 2000 },
            { x: 22000, y: 22000 },
            { x: 2000, y: 22000 },
          ],
        },
      }),
      floorUse: 'STILT_PARKING' as const,
    };

    const building: Building = {
      ...createBuilding({
        projectId: 'p-svg',
        name: 'Phase 3 SVG Test',
        site: {
          plotWidth: 24000,
          plotDepth: 24000,
          roadFacing: Direction.South,
          setbacks: { front: 2000, rear: 2000, left: 2000, right: 2000 },
        },
      }),
      floors: [stiltFloor],
      mepEngineering: {
        schemaVersion: 'RH-MEP-3.0',
        status: 'COORDINATION_PROPOSAL_NOT_CERTIFIED',
        verticalStacks: [],
        summary: { symbols: 4, runs: 2, ceilings: 1, cantileverBeams: 1 },
        floors: [
          {
            floorId: stiltFloor.id,
            floorLevel: 0,
            symbols: [
              { id: 'e1', kind: 'DB', discipline: 'ELECTRICAL', layer: 'M-ELEC-SYMB', position: { x: 4000, y: 4000 }, label: 'DB' },
              { id: 'p1', kind: 'PLUMB_SHAFT', discipline: 'PLUMBING', layer: 'M-PLUMB-FIXT', position: { x: 6000, y: 4000 }, widthMm: 600, depthMm: 900, label: 'SHAFT' },
              { id: 'f1', kind: 'SPRINKLER', discipline: 'FIRE', layer: 'F-FIRE-SYMB', position: { x: 8000, y: 6000 }, label: 'SPK' },
            ],
            runs: [
              { id: 'r1', kind: 'WIRING_LOOP', discipline: 'ELECTRICAL', layer: 'M-ELEC-WIRE', points: [{ x: 4000, y: 4000 }, { x: 8000, y: 4000 }] },
              { id: 'r2', kind: 'CWS', discipline: 'PLUMBING', layer: 'M-PLUMB-PIPE', points: [{ x: 6000, y: 4000 }, { x: 6000, y: 8000 }] },
            ],
            ceilings: [
              {
                id: 'c1',
                kind: 'COVE_GYPSUM',
                roomId: 'r-test',
                outline: [
                  { x: 4000, y: 5000 },
                  { x: 9000, y: 5000 },
                  { x: 9000, y: 9000 },
                  { x: 4000, y: 9000 },
                ],
              },
            ],
            cantileverBeams: [
              {
                id: 'cb1',
                balconyRoomId: 'b1',
                start: { x: 4000, y: 20000 },
                end: { x: 4000, y: 21500 },
                projectionMm: 1500,
                widthMm: 230,
                depthMm: 450,
              },
            ],
          },
        ],
      },
    };

    const bounds = getFloorContentBounds(stiltFloor);
    const svg = renderFloor(
      stiltFloor,
      building,
      fitToView(bounds, 1000, 800),
      1000,
      800,
      {
        disciplines: {
          ARCHITECTURAL: true,
          STRUCTURAL: true,
          ELECTRICAL: true,
          PLUMBING: true,
          FALSE_CEILING: true,
          FIRE_SAFETY: true,
        },
      },
    );

    expect(svg).toContain('M-ELEC-SYMB');
    expect(svg).toContain('M-ELEC-WIRE');
    expect(svg).toContain('M-PLUMB-PIPE');
    expect(svg).toContain('M-PLUMB-FIXT');
    expect(svg).toContain('A-CEIL-GRID');
    expect(svg).toContain('F-FIRE-SYMB');
    expect(svg).toContain('S-BEAM-CANTILEVER');
    expect(svg).toContain('A-SITE-ROAD');
    expect(svg).toContain('data-gate-arrow="IN"');
    expect(svg).toContain('data-gate-arrow="OUT"');
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Direction, createBuilding } from '@ai-floor-planner/core';
import { ArchitecturalCanvas } from '../components/canvas/ArchitecturalCanvas';

describe('ArchitecturalCanvas (6-Sheet 2D CAD Studio & Conservation Ledger)', () => {
  const mockBuilding = createBuilding({
    projectId: 'proj-cad-studio-test',
    name: 'Gulmohar Woods Apartment',
    site: {
      plotWidth: 32000,
      plotDepth: 40000,
      plannedFloorCount: 14,
      roadFacing: Direction.South,
      setbacks: { front: 6000, rear: 4500, left: 4500, right: 4500 },
    },
    floors: [{ buildingId: '', level: 0, name: 'Ground Floor' }],
  });

  it('renders all 6 CAD Sheet Switcher tabs in the studio header bar', () => {
    const html = renderToStaticMarkup(
      createElement(ArchitecturalCanvas, {
        building: mockBuilding,
        activeSheetTab: 2,
        onSelectSheetTab: vi.fn(),
      })
    );

    expect(html).toContain('1. Site &amp; Roadway Plan');
    expect(html).toContain('2. Stilt Parking Plan');
    expect(html).toContain('3. Typical Floor Plan');
    expect(html).toContain('4. Column Schedule');
    expect(html).toContain('5. Terrace Services');
    expect(html).toContain('6. Statutory Area Schedule');
  });

  it('renders FLUX.2 AI concept underlay toggle and slider on Typical Floor tab', () => {
    const html = renderToStaticMarkup(
      createElement(ArchitecturalCanvas, {
        building: mockBuilding,
        activeSheetTab: 2,
        onSelectSheetTab: vi.fn(),
        conceptImageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      })
    );

    expect(html).toContain('FLUX.2 AI Underlay');
    expect(html).toContain('type="range"');
  });

  it('renders persistent 100% Planar Conservation Ledger bar at the bottom with Delta = 0.000 mm²', () => {
    const html = renderToStaticMarkup(
      createElement(ArchitecturalCanvas, {
        building: mockBuilding,
        activeSheetTab: 2,
        onSelectSheetTab: vi.fn(),
      })
    );

    expect(html).toContain('Gross Envelope:');
    expect(html).toContain('Reconciliation Delta: 0.000 mm² (100.00% Allotted)');
  });

  it('renders statutory UDCPR/NBC FSI, RERA carpet and parking schedule table on Sheet 06', () => {
    const html = renderToStaticMarkup(
      createElement(ArchitecturalCanvas, {
        building: mockBuilding,
        activeSheetTab: 5,
        onSelectSheetTab: vi.fn(),
      })
    );

    expect(html).toContain('SHEET 06: FSI, RERA CARPET AREA &amp; PARKING SCHEDULE');
    expect(html).toContain('Gross Plot Area:');
    expect(html).toContain('1. Tenement &amp; RERA Carpet Area Statement (Per Floor)');
    expect(html).toContain('2. Statutory Parking &amp; Vehicular Stall Ledger');
  });
});

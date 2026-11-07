import { describe, it, expect } from 'vitest';
import { renderBuilding } from '../index';
import { createBuilding, RenderLayer, SiteZone } from '@ai-floor-planner/core';

describe('Site Zones SVG Rendering', () => {
  function createBuildingWithSiteZones() {
    const building = createBuilding({
      projectId: 'site-test',
      name: 'Site Test',
      site: { plotWidth: 15000, plotDepth: 15000 },
      floors: [{ buildingId: '', level: 0 }],
    });
    const zones: SiteZone[] = [
      {
        id: 'zone-front-setback',
        kind: 'setback',
        name: 'Front Setback',
        boundary: {
          points: [
            { x: 0, y: 0 },
            { x: 15000, y: 0 },
            { x: 15000, y: 3000 },
            { x: 0, y: 3000 },
          ],
        },
        area: 45,
        accessLinks: [],
        source: 'GENERATED',
        reviewStatus: 'UNREVIEWED',
        rationale: 'Front street buffer and municipal setback standard',
      },
      {
        id: 'zone-parking',
        kind: 'parking',
        name: 'Parking Bay 1',
        boundary: {
          points: [
            { x: 1000, y: 500 },
            { x: 4000, y: 500 },
            { x: 4000, y: 2500 },
            { x: 1000, y: 2500 },
          ],
        },
        area: 6,
        accessLinks: [],
        source: 'GENERATED',
        reviewStatus: 'UNREVIEWED',
        rationale: 'Dedicated covered driveway parking for 1 vehicle',
      },
    ];
    (building.site as any).siteZones = zones;
    return building;
  }

  it('renders site zones layer by default when building has site zones', () => {
    const building = createBuildingWithSiteZones();
    const svg = renderBuilding(building, 0);

    expect(svg).toContain('class="layer-site-zones"');
    expect(svg).toContain('data-layer="site_zones"');
    expect(svg).toContain('data-site-zone-kind="setback"');
    expect(svg).toContain('data-site-zone-kind="parking"');
    expect(svg).toContain('Front Setback');
    expect(svg).toContain('Parking Bay 1');
    expect(svg).toContain('Front street buffer and municipal setback standard');
    expect(svg).toContain('id="site-setback-hatch"');
    expect(svg).toContain('id="site-parking-pattern"');
  });

  it('omits site zones layer when RenderLayer.SiteZones is set to false', () => {
    const building = createBuildingWithSiteZones();
    const svg = renderBuilding(building, 0, 1000, 800, {
      layers: {
        [RenderLayer.SiteZones]: false,
      },
    });

    expect(svg).not.toContain('class="layer-site-zones"');
    expect(svg).not.toContain('data-site-zone-kind="setback"');
  });
});

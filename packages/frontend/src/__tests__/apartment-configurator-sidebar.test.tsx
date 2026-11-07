import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApartmentConfiguratorSidebar } from '../components/studio/ApartmentConfiguratorSidebar';

describe('ApartmentConfiguratorSidebar (Phase 1D Indian Apartment Studio)', () => {
  it('renders all 5 structured control groups in the sidebar', () => {
    const html = renderToStaticMarkup(
      createElement(ApartmentConfiguratorSidebar, {
        onProjectGenerated: vi.fn(),
      })
    );

    // Group 1: Plot, Jurisdiction & Allotment Mode
    expect(html).toContain('1. Plot, Jurisdiction &amp; Allotment');
    expect(html).toContain('Width (m)');
    expect(html).toContain('Depth (m)');
    expect(html).toContain('Road Width (m)');
    expect(html).toContain('Access Sides');
    expect(html).toContain('Statutory Jurisdiction');
    expect(html).toContain('Setbacks + 10% ROS Garden');
    expect(html).toContain('100% Full Footprint');

    // Group 2: Floors & Vertical Stacking
    expect(html).toContain('2. Floors &amp; Vertical Stacking');
    expect(html).toContain('Stack Typology');
    expect(html).toContain('S + N (Stilt)');
    expect(html).toContain('G + N (Ground)');
    expect(html).toContain('B + S + N');
    expect(html).toContain('Typical Floors Count');
    expect(html).toContain('NBC &amp; Fire Act Statutory Ledger');

    // Group 3: Flats Per Floor & BHK Mix
    expect(html).toContain('3. Flats Per Floor &amp; BHK Mix');
    expect(html).toContain('Double (2 Units)');
    expect(html).toContain('Triple (3 Units)');
    expect(html).toContain('Quad (4 Units)');
    expect(html).toContain('Set Uniform BHK across all units:');
    expect(html).toContain('Unit 1');
    expect(html).toContain('Unit 2');

    // Group 4: Parking & Amenities
    expect(html).toContain('4. Parking &amp; Amenities');

    // Group 5: AI Generation & Provenance Bar
    expect(html).toContain('5. AI Generation &amp; Pipeline');
    expect(html).toContain('Architectural Concept Prompt');
    expect(html).toContain('Generate Complete 2D Apartment Project (FLUX.2 + Gemini)');
    expect(html).toContain('FALLBACK_DETERMINISTIC');
  });

  it('displays accurate statutory fire safety badges for high-rise apartment envelopes', () => {
    // 7 typical floors * 3m + 3m stilt = 24.0m height
    const html = renderToStaticMarkup(
      createElement(ApartmentConfiguratorSidebar, {
        onProjectGenerated: vi.fn(),
      })
    );

    expect(html).toContain('24.0 m');
    expect(html).toContain('2 Flights');
    expect(html).toContain('2 Lifts');
    expect(html).toContain('Refuge Floor:');
  });

  it('displays live area calculation matching plot dimensions', () => {
    const html = renderToStaticMarkup(
      createElement(ApartmentConfiguratorSidebar, {
        onProjectGenerated: vi.fn(),
      })
    );

    // Default: 45m x 35m = 1575.0 m² (16,953 sq ft)
    expect(html).toContain('Total Plot Area:');
    expect(html).toContain('1575.0 m²');
    expect(html).toContain('16,953 sq ft');
  });

  it('renders pipeline stages and live status when generating', () => {
    const html = renderToStaticMarkup(
      createElement(ApartmentConfiguratorSidebar, {
        onProjectGenerated: vi.fn(),
        isGenerating: true,
        generationStage: 'SPACE_FILLING_SNAPPER',
        provenance: 'PROVIDER_LLM',
      })
    );

    expect(html).toContain('Solving Coordinated Project…');
    expect(html).toContain('PROVIDER_LLM');
    expect(html).toContain('Orthogonal Space-Filling Snapper');
    expect(html).toContain('Planar Conservation Validated');
  });
});

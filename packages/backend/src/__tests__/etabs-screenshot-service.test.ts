import { describe, it, expect } from 'vitest';
import { ETABSScreenshotService } from '../services/etabs-screenshot-service.js';

describe('ETABSScreenshotService (CSI OAPI Boundary & Evidence)', () => {
  const service = new ETABSScreenshotService();

  it('generates a cryptographically bound screenshot manifest with zero-fabrication attestation', () => {
    const manifest = service.generateScreenshotManifest({
      edbFileName: 'RH_Planner_Structural_Model.edb',
      knownEdbSha256: '98adc38d5e918688243c1377eae85ec47eeb06f1ae71938574cc04d8a946a00a',
      analysisRunId: 'run-acceptance-001',
      etabsVersion: '23.3.2',
    });

    expect(manifest.manifestVersion).toBe('1.0');
    expect(manifest.sourceEdbFileName).toBe('RH_Planner_Structural_Model.edb');
    expect(manifest.sourceEdbSha256).toBe('98adc38d5e918688243c1377eae85ec47eeb06f1ae71938574cc04d8a946a00a');
    expect(manifest.captureEngineStatus).toBe('AUTOMATED_CAPTURE_NOT_AVAILABLE_IN_OAPI');
    expect(manifest.zeroFabricationAttestation.policyEnforced).toBe(true);
    expect(manifest.zeroFabricationAttestation.syntheticMocksQuarantined).toBe(true);
    expect(manifest.oapiInvestigationSummary.inspectedInterfaces).toContain('cView');
    expect(manifest.requiredViews.length).toBeGreaterThanOrEqual(7);

    // Verify key engineer capture views
    const viewTypes = manifest.requiredViews.map(v => v.resultDisplayType);
    expect(viewTypes).toContain('UNDEFORMED_MODEL');
    expect(viewTypes).toContain('DEFORMED_SHAPE');
    expect(viewTypes).toContain('BENDING_MOMENT_M33');
    expect(viewTypes).toContain('SHEAR_FORCE_V22');
    expect(viewTypes).toContain('CONCRETE_DESIGN_COLUMN_PMM');
    expect(viewTypes).toContain('STOREY_DRIFT_PLOT');
  });
});


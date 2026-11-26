import { describe, expect, it } from 'vitest';
import { createArgonRequest } from '../services/argon-request';
import { createSurveyDraft, parseSurveyMeasure, resolveSurveyDraft } from '../services/survey-draft';
import { readSurveyDxf } from '../services/survey-dxf';
import { studioStoreActions } from '../stores/useStudioStore';

const dxf = [
  '0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '90', '4', '70', '1',
  '10', '0', '20', '0', '42', '-1',
  '10', '10', '20', '0', '10', '10', '20', '-10', '10', '0', '20', '-10',
  '0', 'ENDSEC', '0', 'EOF',
].join('\n');

describe('survey setup integration', () => {
  it('converts metric and decimal/fractional imperial values to millimetres', () => {
    expect(parseSurveyMeasure('3.5', 'm')).toBe(3500);
    expect(parseSurveyMeasure('12 3/8', 'ft')).toBeCloseTo(3771.9);
    expect(parseSurveyMeasure('-2-1/2', 'in')).toBeCloseTo(-63.5);
    expect(parseSurveyMeasure('3/0', 'in')).toBeNull();
  });

  it('imports DXF bulges as circular sweeps and preserves declared source units', () => {
    const draft = readSurveyDxf(dxf, 'm', 'ft', 'lot.dxf');
    const boundary = resolveSurveyDraft(draft);
    expect(boundary.issues).toEqual([]);
    expect(boundary.edges[0]?.arc?.sweepRad).toBeCloseTo(Math.PI);
    expect(boundary.metrics?.bounds.height).toBeCloseTo(15_000);
    expect(draft.sourceFile).toBe('lot.dxf');
    expect(() => readSurveyDxf(dxf.replace('70\n1', '70\n0'), 'm', 'm', 'open.dxf')).toThrow(/exactly one closed/);
    expect(() => readSurveyDxf(dxf, undefined, 'm', 'unitless.dxf')).toThrow(/Choose its source units/);
    const declared = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '2', '0', 'ENDSEC', dxf].join('\n');
    expect(readSurveyDxf(declared, undefined, 'm', 'feet.dxf').rows[1]?.xMm).toBe(3048);
    expect(readSurveyDxf(declared, 'm', 'm', 'override.dxf').rows[1]?.xMm).toBe(10_000);
  });

  it('passes exact survey measurements and refuses a missing survey without changing rectangular requests', () => {
    const data = studioStoreActions.getProjectSetupWizardData();
    expect(() => createArgonRequest({ ...data, siteGeometryMode: 'survey' })).toThrow(/exact site boundary/);
    const draft = createSurveyDraft('trapezoid', 32800.25, 30300.75);
    const request = createArgonRequest({ ...data, siteGeometryMode: 'survey', surveyDraft: draft });
    expect(request.surveyBoundary?.points).toEqual(resolveSurveyDraft(draft).points);
    expect(request.plotDepthMm).toBe(30300.75);
    expect(request.surveyBoundary?.roadEdge).toBe(0);
    expect(createArgonRequest({ ...data, siteGeometryMode: 'rectangle' }).plotWidthMm).toBe(data.plotWidthM * 1000);
  });
});

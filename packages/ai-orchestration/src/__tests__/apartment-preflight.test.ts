import { describe, expect, it } from 'vitest';
import {
  evaluateApartmentPreflight,
  type ExpectedApartmentBrief,
  type DetectedApartmentFeatures,
} from '../orchestration/apartment-preflight';

describe('Apartment Visual Preflight Gate (evaluateApartmentPreflight)', () => {
  const standardExpected: ExpectedApartmentBrief = {
    flatsPerFloor: 2,
    unitMix: [
      { unitType: '2bhk', count: 1 },
      { unitType: '3bhk', count: 1 },
    ],
    liftCount: 2,
    stairCount: 2,
    commonCoreRequired: true,
  };

  it('accepts a plan that matches all structural and typological criteria', () => {
    const detected: DetectedApartmentFeatures = {
      isApartmentLayout: true,
      commonCore: true,
      unitSeparation: true,
      flatCount: 2,
      unitMix: ['2BHK', '3BHK'],
      liftCount: 2,
      stairCount: 2,
      balconies: true,
      utilities: true,
      parking: false,
      majorRooms: ['living', 'kitchen', 'master_bed', 'common_bed'],
      labelLanguage: 'English',
      visualQuality: 9,
      confidence: 0.95,
      observations: 'Clean 2-flat layout with central lobby, 2 lifts and 2 staircases.',
    };

    const result = evaluateApartmentPreflight(detected, standardExpected);
    expect(result.pass).toBe(true);
    expect(result.failureReasons).toHaveLength(0);
    expect(result.matchingSummary).toContain('Visual acceptance PASS');
  });

  it('strictly rejects when flat count does not match expected', () => {
    const detected: Partial<DetectedApartmentFeatures> = {
      isApartmentLayout: true,
      commonCore: true,
      unitSeparation: true,
      flatCount: 1, // Wrong! Expected 2
      liftCount: 2,
      stairCount: 2,
      labelLanguage: 'English',
      visualQuality: 8,
    };

    const result = evaluateApartmentPreflight(detected, standardExpected);
    expect(result.pass).toBe(false);
    expect(result.failureReasons.some(r => r.includes('Flat count mismatch'))).toBe(true);
  });

  it('strictly rejects standalone villas pretending to be apartments', () => {
    const detected: Partial<DetectedApartmentFeatures> = {
      isApartmentLayout: false, // Standalone villa!
      commonCore: false,
      flatCount: 1,
      liftCount: 0,
      stairCount: 1,
      labelLanguage: 'English',
      visualQuality: 7,
    };

    const result = evaluateApartmentPreflight(detected, standardExpected);
    expect(result.pass).toBe(false);
    expect(result.failureReasons.some(r => r.includes('single-family villa'))).toBe(true);
  });

  it('strictly rejects Cyrillic or non-English script labels', () => {
    const detected: Partial<DetectedApartmentFeatures> = {
      isApartmentLayout: true,
      commonCore: true,
      unitSeparation: true,
      flatCount: 2,
      liftCount: 2,
      stairCount: 2,
      labelLanguage: 'Cyrillic (Russian)',
      visualQuality: 7,
    };

    const result = evaluateApartmentPreflight(detected, standardExpected);
    expect(result.pass).toBe(false);
    expect(result.failureReasons.some(r => r.includes('Forbidden script detected'))).toBe(true);
  });

  it('strictly rejects missing central common core or missing separate entrances', () => {
    const detected: Partial<DetectedApartmentFeatures> = {
      isApartmentLayout: true,
      commonCore: false, // Missing core!
      unitSeparation: false, // Missing separate units!
      flatCount: 2,
      liftCount: 2,
      stairCount: 2,
      labelLanguage: 'English',
      visualQuality: 7,
    };

    const result = evaluateApartmentPreflight(detected, standardExpected);
    expect(result.pass).toBe(false);
    expect(result.failureReasons.some(r => r.includes('Common central core'))).toBe(true);
    expect(result.failureReasons.some(r => r.includes('Flats lack clear separation'))).toBe(true);
  });

  it('strictly rejects insufficient lift or staircase counts', () => {
    const detected: Partial<DetectedApartmentFeatures> = {
      isApartmentLayout: true,
      commonCore: true,
      unitSeparation: true,
      flatCount: 2,
      liftCount: 1, // Expected 2
      stairCount: 1, // Expected 2
      labelLanguage: 'English',
      visualQuality: 8,
    };

    const result = evaluateApartmentPreflight(detected, standardExpected);
    expect(result.pass).toBe(false);
    expect(result.failureReasons.some(r => r.includes('Lift count insufficient'))).toBe(true);
    expect(result.failureReasons.some(r => r.includes('Staircase count insufficient'))).toBe(true);
  });
});

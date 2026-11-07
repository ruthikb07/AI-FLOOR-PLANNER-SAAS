/**
 * Opt-in review render (PHASE1_RENDER=1): writes the deterministic schematic of
 * every concept strategy (PNG as sent to FLUX + SVG + checks/areas JSON) for the
 * acceptance scenario and the 3/4-flat matrix to scripts/phase1_concepts_output.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { APARTMENT_CONCEPT_STRATEGIES } from '../apartment/layout-planner';
import { generateDeterministicApartmentSchematic } from '../apartment/schematic';
import { renderSchematicPng512 } from '../apartment/schematic-renderer';
import { getApartmentRulesProfile } from '../apartment/jurisdiction';

const OUT = path.resolve(__dirname, '../../../../scripts/phase1_concepts_output');

describe.skipIf(!process.env.PHASE1_RENDER)('Phase 1 review render', () => {
  it('renders every strategy for 2 / 3 / 4 flats', () => {
    fs.mkdirSync(OUT, { recursive: true });
    const rules = getApartmentRulesProfile('pune_pmc', { floorCount: 4, buildingHeightM: 12.4, tenementsPerFloor: 2 });
    const scenarios = [
      { key: 'n2_acceptance', flats: 2, mix: [{ unitType: '2BHK', count: 1, carpetAreaSqFt: 700 }, { unitType: '3BHK', count: 1, carpetAreaSqFt: 1000 }] },
      { key: 'n3', flats: 3, mix: [{ unitType: '2BHK', count: 2 }, { unitType: '3BHK', count: 1 }] },
      { key: 'n4', flats: 4, mix: [{ unitType: '2BHK', count: 2 }, { unitType: '3BHK', count: 2 }] },
    ];
    const summary: unknown[] = [];
    for (const sc of scenarios) {
      for (const st of APARTMENT_CONCEPT_STRATEGIES) {
        const s = generateDeterministicApartmentSchematic({
          siteWidthM: 45, siteDepthM: 50, setbacksM: { front: 3, rear: 2, left: 2, right: 2 },
          flatsPerFloor: sc.flats, unitMix: sc.mix,
          commonCoreConfig: { passengerLifts: 2, staircaseCount: 2, commonLobby: true },
          rulesProfile: rules, strategy: st.id,
        });
        const base = `${sc.key}_c0${st.candidateNumber}_${st.id}`;
        fs.writeFileSync(path.join(OUT, `${base}.png`), renderSchematicPng512(s));
        fs.writeFileSync(path.join(OUT, `${base}.svg`), s.svgScaffold);
        summary.push({
          scenario: sc.key,
          candidate: st.candidateNumber,
          strategy: st.id,
          fits: s.layoutFits,
          adaptations: s.layoutAdaptations,
          footprint: s.buildingFootprint,
          checks: { passed: s.spatialChecks.filter(c => c.status === 'PASS').length, total: s.spatialChecks.length, failed: s.spatialChecks.filter(c => c.status === 'FAIL') },
          doors: s.doors.length,
          areas: s.areaReport,
        });
        expect(s.spatialChecks.filter(c => c.status === 'FAIL')).toEqual([]);
      }
    }
    fs.writeFileSync(path.join(OUT, 'phase1_concepts_summary.json'), JSON.stringify(summary, null, 2));
  });
});

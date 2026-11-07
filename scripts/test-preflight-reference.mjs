import fs from 'node:fs';
import { runGeminiApartmentPreflight, GeminiProvider } from '../packages/ai-orchestration/dist/index.js';

async function testReferencePreflight() {
  console.log('Testing Visual Preflight Gate on normalized reference apartment plan...');
  const imgPath = 'packages/backend/data/reference-images/normalized_512/ref_apartment_01_multi_unit_typical.png';
  const imgBase64 = fs.readFileSync(imgPath).toString('base64');

  const provider = new GeminiProvider({
    apiKey: 'AIzaSyD-ifnD8dd6Z3ZpG-hXizYfOEsoyLpGMLA',
    model: 'gemini-flash-lite-latest',
  });

  const expectedBrief = {
    flatsPerFloor: 2,
    unitMix: [
      { unitType: '2bhk', count: 1 },
      { unitType: '3bhk', count: 1 },
    ],
    liftCount: 2,
    stairCount: 1,
    commonCoreRequired: true,
  };

  const t0 = Date.now();
  const result = await runGeminiApartmentPreflight(provider, imgBase64, expectedBrief);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`Preflight completed in ${elapsed}s:`);
  console.log(`- Pass: ${result.pass}`);
  console.log(`- Summary: ${result.matchingSummary}`);
  console.log(`- Detected:`, JSON.stringify(result.detected, null, 2));
  console.log(`- Failure Reasons:`, result.failureReasons);
}

testReferencePreflight().catch(console.error);

import fs from 'node:fs';
import path from 'node:path';
import { Direction, DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES } from '../packages/core/dist/index.js';
import { generateHardenedResidential } from '../packages/planning-engine/dist/index.js';

const outDir = path.resolve('test-artifacts/verified-exports');
fs.mkdirSync(outDir, { recursive: true });

async function run() {
  console.log('=== REAL-WORLD EXPORT VERIFICATION SUITE ===');

  // 1. Generate canonical 18x25 residential building
  console.log('\n[1/5] Generating canonical 18x25 residential building...');
  const genResult = generateHardenedResidential({
    projectId: 'uat-18x25-residential',
    plotWidthMm: 18000,
    plotDepthMm: 25000,
    roadWidthMm: 12000,
    roadAccessSides: [Direction.North],
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'generic_maharashtra',
    verticalStackType: 'STILT_PLUS_N',
    numTypicalFloors: 3,
    flatsPerFloor: 2,
    units: [
      { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
      { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
    ],
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_ONLY',
  });

  const building = genResult.building;
  console.log(`Building generated: "${building.name}" with ${building.floors.length} floors.`);
  for (const f of building.floors) {
    console.log(`  Floor "${f.name}" (level ${f.level}): ${f.rooms.length} rooms, ${f.doors.length} doors, ${f.windows.length} windows, ${f.columns.length} columns`);
  }

  const BASE_URL = 'http://localhost:4200';

  // 2. Test DXF Export
  console.log('\n[2/5] Testing DXF Export via POST /api/v1/export/dxf...');
  const dxfRes = await fetch(`${BASE_URL}/api/v1/export/dxf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ building, options: { format: 'DXF', standards: 'IS_10711' } })
  });
  console.log(`DXF HTTP Status: ${dxfRes.status} ${dxfRes.statusText}`);
  let dxfPath = '';
  const dxfContentType = dxfRes.headers.get('content-type') || '';
  if (dxfContentType.includes('json')) {
    const dxfJson = await dxfRes.json();
    console.log(`DXF JSON Response:`, JSON.stringify(dxfJson, null, 2));
    if (dxfJson.downloadUrl) {
      const dlRes = await fetch(`${BASE_URL}${dxfJson.downloadUrl}`);
      const dxfBuf = Buffer.from(await dlRes.arrayBuffer());
      dxfPath = path.join(outDir, dxfJson.fileName || 'drawing.dxf');
      fs.writeFileSync(dxfPath, dxfBuf);
      console.log(`Downloaded DXF: ${dxfBuf.length} bytes -> ${dxfPath}`);
    }
  } else {
    const dxfBuf = Buffer.from(await dxfRes.arrayBuffer());
    dxfPath = path.join(outDir, 'drawing.dxf');
    fs.writeFileSync(dxfPath, dxfBuf);
    console.log(`Received binary DXF stream: ${dxfBuf.length} bytes -> ${dxfPath}`);
    const head = dxfBuf.slice(0, 100).toString('utf8');
    const isDxfValid = head.includes('SECTION') || head.includes('HEADER') || dxfBuf.toString('utf8', 0, 500).includes('ENTITIES');
    console.log(`DXF Validity Check: ${isDxfValid ? 'PASSED (valid DXF structure)' : 'FAILED'}`);
  }

  // 3. Test DWG Export
  console.log('\n[3/5] Testing DWG Export via POST /api/v1/export/dwg...');
  const dwgRes = await fetch(`${BASE_URL}/api/v1/export/dwg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ building, options: { format: 'DWG', standards: 'IS_10711' } })
  });
  console.log(`DWG HTTP Status: ${dwgRes.status} ${dwgRes.statusText}`);
  let dwgPath = '';
  const dwgContentType = dwgRes.headers.get('content-type') || '';
  if (dwgContentType.includes('json')) {
    const dwgJson = await dwgRes.json();
    console.log(`DWG JSON Response:`, JSON.stringify(dwgJson, null, 2));
    if (dwgJson.downloadUrl) {
      const dlRes = await fetch(`${BASE_URL}${dwgJson.downloadUrl}`);
      const dwgBuf = Buffer.from(await dlRes.arrayBuffer());
      dwgPath = path.join(outDir, dwgJson.fileName || 'drawing.dwg');
      fs.writeFileSync(dwgPath, dwgBuf);
      console.log(`Downloaded DWG: ${dwgBuf.length} bytes -> ${dwgPath}`);
    }
  } else {
    const dwgBuf = Buffer.from(await dwgRes.arrayBuffer());
    dwgPath = path.join(outDir, 'drawing.dwg');
    fs.writeFileSync(dwgPath, dwgBuf);
    console.log(`Received binary DWG stream: ${dwgBuf.length} bytes -> ${dwgPath}`);
    const magic = dwgBuf.slice(0, 6).toString('ascii');
    console.log(`DWG Magic bytes: "${magic}"`);
    const isDwgValid = magic.startsWith('AC10');
    console.log(`DWG Validity Check: ${isDwgValid ? 'PASSED (AutoCAD DWG signature ' + magic + ')' : 'FAILED'}`);
  }

  // 4. Test Residential Multi-Sheet Package (PDF + CAD)
  console.log('\n[4/5] Testing Residential Multi-Sheet Package via POST /api/v1/export/residential-package...');
  const pkgRes = await fetch(`${BASE_URL}/api/v1/export/residential-package`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ building, options: { standards: ['A'] } })
  });
  console.log(`Package HTTP Status: ${pkgRes.status} ${pkgRes.statusText}`);
  const pkgJson = await pkgRes.json();
  const descriptors = pkgJson.descriptors || pkgJson.manifest?.files || [];
  console.log(`Package Manifest: descriptors=${descriptors.length}, overallStatus=${pkgJson.manifest?.overallStatus}`);
  for (const s of descriptors) {
    console.log(`  File: "${s.fileName}" (${s.fileType}) -> ${s.downloadUrl}`);
    if (s.downloadUrl) {
      const sRes = await fetch(`${BASE_URL}${s.downloadUrl}`);
      const sBuf = Buffer.from(await sRes.arrayBuffer());
      const sPath = path.join(outDir, s.fileName);
      fs.writeFileSync(sPath, sBuf);
      console.log(`    Saved: ${sBuf.length} bytes -> ${sPath}`);
    }
  }

  // 5. Test Blender 5.2 Package Export
  console.log('\n[5/5] Testing Blender 5.2 Procedural Export via POST /api/v1/export/blender-package...');
  const blenderStart = Date.now();
  const blenderRes = await fetch(`${BASE_URL}/api/v1/export/blender-package`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ building, options: { expectedRevision: building.version } })
  });
  const blenderDuration = ((Date.now() - blenderStart) / 1000).toFixed(1);
  console.log(`Blender HTTP Status: ${blenderRes.status} ${blenderRes.statusText} (${blenderDuration}s)`);
  const blenderJson = await blenderRes.json();
  console.log(`Blender Response:`, JSON.stringify(blenderJson, null, 2));

  if (blenderJson.artifacts) {
    for (const art of blenderJson.artifacts) {
      console.log(`  Artifact: "${art.fileName}" (${art.kind}, ${art.sizeBytes} bytes) -> ${art.downloadUrl}`);
      if (art.downloadUrl) {
        const artRes = await fetch(`${BASE_URL}${art.downloadUrl}`);
        const artBuf = Buffer.from(await artRes.arrayBuffer());
        const artPath = path.join(outDir, art.fileName);
        fs.writeFileSync(artPath, artBuf);
        console.log(`    Downloaded ${artBuf.length} bytes to ${artPath}`);
        if (art.fileName.endsWith('.blend')) {
          const magic = artBuf.slice(0, 7).toString('ascii');
          console.log(`    .blend magic: "${magic}" -> ${magic.startsWith('BLENDER') ? 'PASSED (valid Blender file)' : 'FAILED'}`);
        } else if (art.fileName.endsWith('.glb')) {
          const magic = artBuf.slice(0, 4).toString('ascii');
          console.log(`    .glb magic: "${magic}" -> ${magic === 'glTF' ? 'PASSED (valid glTF binary)' : 'FAILED'}`);
        }
      }
    }
  }

  console.log('\n=== EXPORT VERIFICATION SUITE COMPLETE ===');
}

run().catch(err => {
  console.error('Export test failed:', err);
  process.exit(1);
});


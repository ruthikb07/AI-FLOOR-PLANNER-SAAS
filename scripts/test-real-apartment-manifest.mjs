/**
 * Live Real-World Acceptance Test Runner (§27, §28, §30).
 *
 * Runs the exact Section 27 test case against the live backend server:
 * - Project: Multi-unit residential apartment
 * - Jurisdiction: Mumbai / MCGM (DCPR 2034)
 * - Site: 60 × 100 ft (18,288 × 30,480 mm)
 * - Floor: Typical Residential Floor
 * - Flats: 2 (1 × 2BHK, 1 × 3BHK)
 * - Common Core: 2 lifts, 2 staircases, central common lobby
 * - Checks Manifest generation, FLUX invocation, Gemini visual preflight, and acceptance gate.
 */

async function main() {
  console.log('--- STARTING SECTION 27 REAL-WORLD APARTMENT ACCEPTANCE TEST ---');

  const payload = {
    projectId: 'real-test-apt-mcgm',
    projectName: 'Bandra Heights Typical Floor',
    projectType: 'apartment',
    site: {
      plotWidth: 18288, // 60 ft in mm
      plotDepth: 30480, // 100 ft in mm
      roadFacing: 'north',
      orientation: 0,
      setbacks: {
        front: 3000,
        rear: 2000,
        left: 2000,
        right: 2000,
      },
    },
    apartmentConfig: {
      projectType: 'apartment',
      jurisdiction: 'mumbai_mcgm',
      floorCount: 5,
      flatsPerFloor: 2,
      unitMix: [
        { unitType: '2BHK', count: 1, carpetAreaSqFt: 850 },
        { unitType: '3BHK', count: 1, carpetAreaSqFt: 1250 },
      ],
      floorStrategy: 'typical',
      commonCore: {
        passengerLifts: 2,
        serviceLifts: 0,
        staircaseCount: 2,
        commonLobby: true,
        fireStaircaseRequired: false,
      },
      parking: {
        residentParkingCount: 4,
        visitorParkingCount: 2,
        twoWheelerParkingCount: 6,
      },
      amenities: {
        groundSiteAmenities: ['security_cabin', 'generator_backup'],
        buildingAmenities: ['entrance_lobby', 'society_office'],
      },
    },
    preferences: {
      goodDaylight: true,
      goodPrivacy: true,
      efficientCirculation: true,
      vastu: true,
    },
    additionalPrompt: 'Professional Indian apartment floor-plan appearance. Clear separation between 2BHK and 3BHK. English technical drafting labels only.',
    seed: 54321,
    candidateCount: 1,
  };

  console.log('Sending request to http://localhost:4200/api/v1/generation/run...');
  const started = Date.now();

  const res = await fetch('http://localhost:4200/api/v1/generation/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const durationSec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`HTTP ${res.status} received in ${durationSec}s.`);

  if (!res.ok) {
    const errorText = await res.text();
    console.error('Server error response:', errorText);
    process.exit(1);
  }

  const result = await res.json();

  console.log('\n================ GENERATION RESULT ================');
  console.log(`Success: ${result.success}`);
  console.log(`Latency: ${result.latencyMs}ms`);

  if (result.apartmentManifest) {
    console.log('\n--- STRUCTURED GENERATION MANIFEST GENERATED ---');
    console.log(`Jurisdiction: ${result.apartmentManifest.jurisdiction.authority} (${result.apartmentManifest.jurisdiction.ruleProfile})`);
    console.log(`Exact Flats: ${result.apartmentManifest.units.exactCount}`);
    console.log(`Units Breakdown:`);
    for (const u of result.apartmentManifest.units.units) {
      console.log(`  - ${u.label}: ${u.type} (~${u.targetAreaSqFt} sq ft, ${u.bedrooms} Bed, ${u.bathrooms} Bath, ${u.livingRooms} Living, ${u.kitchens} Kitchen, ${u.utilities} Utility, ${u.balconies} Balcony)`);
    }
    console.log(`Room Totals on Floor: ${result.apartmentManifest.roomTotals.bedrooms} Beds, ${result.apartmentManifest.roomTotals.bathrooms} Baths, ${result.apartmentManifest.roomTotals.livingRooms} Living, ${result.apartmentManifest.roomTotals.kitchens} Kitchens, ${result.apartmentManifest.roomTotals.utilities} Utilities, ${result.apartmentManifest.roomTotals.balconies} Balconies`);
    console.log(`Common Core: ${result.apartmentManifest.commonCore.lifts} Lifts, ${result.apartmentManifest.commonCore.stairs} Stairs, Common Lobby: ${result.apartmentManifest.commonCore.commonLobby}`);
    console.log(`Area Allocations: Site: ${result.apartmentManifest.areaAllocations.siteSqFt} sq ft, Envelope: ${result.apartmentManifest.areaAllocations.buildableEnvelopeSqFt} sq ft, Net Residential: ${result.apartmentManifest.areaAllocations.netResidentialSqFt} sq ft`);
  }

  if (result.candidates && result.candidates.length > 0) {
    for (let i = 0; i < result.candidates.length; i++) {
      const c = result.candidates[i];
      console.log(`\n--- CANDIDATE ${i + 1} (Seed: ${c.seed}) ---`);
      console.log(`Status: ${c.status}`);
      if (c.artifact) {
        console.log(`Artifact ID: ${c.artifact.generationId}`);
        console.log(`Image saved at: ${c.artifact.imagePath}`);
      }
      if (c.preflight) {
        console.log(`Preflight PASS: ${c.preflight.pass}`);
        console.log(`Preflight Summary: ${c.preflight.matchingSummary}`);
        console.log(`Preflight Features Detected:`, {
          flatCount: c.preflight.detected.flatCount,
          unitMix: c.preflight.detected.unitMix,
          liftCount: c.preflight.detected.liftCount,
          stairCount: c.preflight.detected.stairCount,
          commonCore: c.preflight.detected.commonCore,
          unitSeparation: c.preflight.detected.unitSeparation,
          labelLanguage: c.preflight.detected.labelLanguage,
          isApartmentLayout: c.preflight.detected.isApartmentLayout,
          visualQuality: c.preflight.detected.visualQuality,
        });
        if (c.preflight.failureReasons && c.preflight.failureReasons.length > 0) {
          console.log(`Failure reasons:`, c.preflight.failureReasons);
        }
      }
      if (c.building) {
        console.log(`Building 2D extracted: ${c.building.floors.length} floors, ${c.building.floors[0]?.rooms.length ?? 0} rooms`);
      }
    }
  }

  if (result.error) {
    console.log(`\nPipeline Error: [${result.error.code}] ${result.error.message}`);
    if (result.error.reasons) {
      console.log(`Reasons:`, result.error.reasons);
    }
  }

  console.log('===================================================\n');
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});

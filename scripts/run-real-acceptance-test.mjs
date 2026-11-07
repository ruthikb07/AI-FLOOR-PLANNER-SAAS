import fs from 'node:fs';

async function runAcceptanceTest() {
  console.log('================================================================');
  console.log('SECTION 36: REAL APARTMENT ACCEPTANCE TEST');
  console.log('================================================================');
  console.log('Project: Apartment');
  console.log('Site: 18.288m x 30.48m (60ft x 100ft)');
  console.log('Floor: Typical residential floor');
  console.log('Flats: 2 (1 x 2BHK, 1 x 3BHK)');
  console.log('Core: 2 lifts, 2 stairs, central common lobby');
  console.log('Preferences: Indian apartment planning, good daylight, privacy, efficient circulation, professional drafting');
  console.log('----------------------------------------------------------------');

  const payload = {
    projectId: 'proj_mumbai_mcgm_acceptance_' + Date.now(),
    projectName: 'Marine View Residences',
    projectType: 'apartment',
    site: {
      plotWidth: 18.288,
      plotDepth: 30.48,
      plannedFloorCount: 4,
      roadFacing: 'north',
      setbacks: { front: 3.0, rear: 2.0, left: 2.0, right: 2.0 },
      orientation: 0,
    },
    apartmentConfig: {
      projectType: 'apartment',
      jurisdiction: 'mumbai_mcgm',
      floorCount: 4,
      flatsPerFloor: 2,
      unitMix: [
        { unitType: '2bhk', count: 1 },
        { unitType: '3bhk', count: 1 },
      ],
      commonCore: {
        passengerLifts: 2,
        serviceLifts: 0,
        staircaseCount: 2,
        fireStaircaseRequired: true,
        commonLobby: true,
      },
      parking: {
        residentParkingCount: 4,
        visitorParkingCount: 1,
        twoWheelerParkingCount: 4,
        fourWheelerParkingCount: 4,
      },
      amenities: {
        groundSiteAmenities: ['visitor_parking'],
        buildingAmenities: ['society_office'],
      },
      floorStrategy: 'typical',
    },
    preferences: {
      vastu: true,
      garden: false,
      parking: true,
    },
    additionalPrompt: 'Indian apartment planning, good daylight, privacy, efficient circulation, professional drafting, top-down orthographic 2D technical drawing',
    candidateCount: 1,
    seed: 54321,
  };

  const t0 = Date.now();
  console.log('Sending request to http://localhost:4200/api/v1/generation/run...');

  try {
    const res = await fetch('http://localhost:4200/api/v1/generation/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`Response received in ${elapsed}s (HTTP ${res.status})`);

    const data = await res.json();
    fs.writeFileSync('scripts/acceptance_result.json', JSON.stringify(data, null, 2));

    console.log('\n--- ACCEPTANCE RUN RESULT ---');
    console.log(`Success: ${data.success}`);
    console.log(`Latency: ${data.latencyMs}ms`);

    if (data.error) {
      console.error('Pipeline Error:', data.error);
    }

    if (data.apartmentManifest) {
      console.log('\n--- MANIFEST ---');
      console.log(`Total Flats: ${data.apartmentManifest.units.exactCount}`);
      console.log(`Unit Mix: ${data.apartmentManifest.units.units.map(u => `${u.label}: ${u.type}`).join(', ')}`);
      console.log(`Core: ${data.apartmentManifest.commonCore.lifts} lifts, ${data.apartmentManifest.commonCore.stairs} stairs`);
      console.log(`Floor Plate Area: ${data.apartmentManifest.areaAllocations?.currentFloorPlateSqFt} sq ft (${data.apartmentManifest.areaAllocations?.currentFloorPlateSqM} sq m)`);
      console.log(`Total Rooms: ${data.apartmentManifest.roomTotals?.bedrooms} beds, ${data.apartmentManifest.roomTotals?.bathrooms} baths`);
    }

    if (data.apartmentSchematic) {
      console.log('\n--- DETERMINISTIC SCHEMATIC ---');
      console.log(`Flats: ${data.apartmentSchematic.flatCount}`);
      console.log(`Units: ${data.apartmentSchematic.units.map(u => `${u.flatLabel}: ${u.unitType}`).join(', ')}`);
      console.log(`Core Lifts: ${data.apartmentSchematic.core.lifts.length}`);
      console.log(`Core Stairs: ${data.apartmentSchematic.core.stairs.length}`);
      console.log(`SVG Scaffold bytes: ${data.apartmentSchematic.svgScaffold?.length ?? 0}`);
    }

    if (data.candidates && data.candidates.length > 0) {
      const cand = data.candidates[0];
      console.log('\n--- CANDIDATE EVALUATION ---');
      console.log(`Status: ${cand.status}`);
      console.log(`Artifact ID: ${cand.artifact?.generationId}`);
      console.log(`Seed: ${cand.seed}`);
      console.log(`Visual Preflight Pass: ${cand.preflight?.pass}`);
      console.log(`Preflight Summary: ${cand.preflight?.matchingSummary}`);
      console.log(`Detected Flats: ${cand.preflight?.detected?.flatCount}`);
      console.log(`Detected Unit Mix: ${JSON.stringify(cand.preflight?.detected?.unitMix)}`);
      console.log(`Detected Lifts: ${cand.preflight?.detected?.liftCount}`);
      console.log(`Detected Stairs: ${cand.preflight?.detected?.stairCount}`);
      console.log(`Detected Core: ${cand.preflight?.detected?.commonCore}`);
      console.log(`English Labels: ${cand.preflight?.detected?.labelLanguage}`);
      console.log(`Apartment Layout: ${cand.preflight?.detected?.isApartmentLayout}`);
      console.log(`Validation Valid: ${cand.validation?.isValid}`);
      console.log(`Validation Healthy: ${cand.validation?.geometryHealthy}`);
      console.log(`Score: ${cand.validation?.overallScore}`);

      if (cand.evaluation) {
        console.log(`Gemini Architectural Score: ${cand.evaluation.overallScore}/100`);
      }
    }
  } catch (err) {
    console.error('Fatal execution error:', err);
  }
}

runAcceptanceTest();

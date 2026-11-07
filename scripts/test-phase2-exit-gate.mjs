import fs from 'node:fs';

async function main() {
  console.log('--- PHASE II EXIT GATE TEST: Live Apartment Generation ---');
  
  const payload = {
    projectId: 'proj_pune_pmc_exit_gate_' + Date.now(),
    projectName: 'Shivaji Nagar Residency (PMC)',
    projectType: 'apartment',
    site: {
      plotWidth: 35,
      plotDepth: 40,
      plannedFloorCount: 5,
      roadFacing: 'north',
      setbacks: { front: 4.5, rear: 3.0, left: 3.0, right: 3.0 },
    },
    apartmentConfig: {
      projectType: 'apartment',
      jurisdiction: 'pune_pmc',
      floorCount: 4,
      flatsPerFloor: 2,
      unitMix: [
        { unitType: '2bhk', count: 1, targetCarpetAreaSqM: 65 },
        { unitType: '3bhk', count: 1, targetCarpetAreaSqM: 95 },
      ],
      commonCore: {
        passengerLifts: 2,
        serviceLifts: 0,
        staircaseCount: 1,
        fireStaircaseRequired: false,
        commonLobby: true,
      },
      parking: {
        residentParkingCount: 8,
        visitorParkingCount: 2,
        twoWheelerParkingCount: 8,
        fourWheelerParkingCount: 8,
      },
      amenities: {
        groundSiteAmenities: ['children_play_area', 'visitor_parking'],
        buildingAmenities: ['society_office'],
      },
      floorStrategy: 'typical',
    },
    candidateCount: 1,
  };

  console.log('Sending generation request to http://localhost:4200/api/v1/generation/run...');
  const t0 = Date.now();

  try {
    const res = await fetch('http://localhost:4200/api/v1/generation/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`Response received in ${elapsed}s (HTTP ${res.status})`);

    const data = await res.json();
    fs.writeFileSync('scripts/last_exit_gate_result.json', JSON.stringify(data, null, 2));

    if (!res.ok) {
      console.error('Request failed:', data);
      process.exit(1);
    }

    console.log('Result Summary:');
    console.log(`- Success: ${data.success}`);
    console.log(`- Project ID: ${data.projectId}`);
    console.log(`- Latency: ${data.latencyMs}ms`);
    console.log(`- Candidates: ${data.candidates?.length ?? 0}`);

    if (data.candidates && data.candidates.length > 0) {
      const c = data.candidates[0];
      console.log(`- Candidate 1 Status: ${c.status}`);
      console.log(`- Image Artifact ID: ${c.artifact?.generationId}`);
      console.log(`- Preflight Pass: ${c.preflight?.pass}`);
      console.log(`- Preflight Summary: ${c.preflight?.matchingSummary}`);
      console.log(`- Preflight Detected:`, JSON.stringify(c.preflight?.detected, null, 2));
      console.log(`- Deterministic Validation Valid: ${c.validation?.isValid}`);
      console.log(`- Rejected Reason: ${c.rejectedReason}`);
      if (c.evaluation) {
        console.log(`- Architectural Evaluation Overall: ${c.evaluation.overallScore}/100`);
        console.log(`- Gemini Critique: ${c.evaluation.critique}`);
      }
    }

    if (data.apartmentSchematic) {
      console.log(`- Deterministic Schematic Flats: ${data.apartmentSchematic.flatsPerFloor}`);
      console.log(`- Units: ${data.apartmentSchematic.units.map(u => `${u.unitType} (Flat ${u.unitNumber})`).join(', ')}`);
      console.log(`- Core Lifts: ${data.apartmentSchematic.core.lifts.length}, Stairs: ${data.apartmentSchematic.core.stairs.length}`);
    }

    if (data.feasibility) {
      console.log(`- Feasibility Status: ${data.feasibility.status}`);
      console.log(`- Plot Area: ${data.feasibility.plotAreaMm2 / 1e6} m²`);
      console.log(`- Buildable Area: ${data.feasibility.buildableAreaMm2 / 1e6} m²`);
    }
  } catch (err) {
    console.error('Error running exit gate test:', err);
    process.exit(1);
  }
}

main();

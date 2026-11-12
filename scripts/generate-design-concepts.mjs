/**
 * Generates the design-concept evidence pack for the reference project.
 *
 * Runs the real production path for a 40 x 50 m, four-flat 2BHK brief and
 * writes, per concept: the canonical building JSON, a room and area schedule,
 * the adjacency graph, core and shaft locations, a ventilation report, the
 * bedroom balcony schedule, the constraint-satisfaction report, the scoring
 * explanation and the layout fingerprint.
 *
 * Usage: node --experimental-strip-types scripts/generate-design-concepts.mjs
 * (run through vitest in this repo; see the acceptance docs for the command).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Direction,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  RoomType,
} from '@ai-floor-planner/core';
import { polygonArea } from '@ai-floor-planner/geometry-engine';
import { generateDesignConcepts } from '../packages/planning-engine/src/topology/generative-topology-engine';
import { solveMultiSheetApartmentProject } from '../packages/planning-engine/src/apartment/multi-sheet-apartment-solver';

// Resolve relative to this file so the output lands in the repository's docs
// directory whatever working directory the runner happens to use.
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs/architecture/concepts');
mkdirSync(OUT, { recursive: true });

const PLOT = { widthMm: 40000, depthMm: 50000 };
const SETBACKS = { front: 4500, rear: 3000, left: 3000, right: 3000 };
const ENVELOPE = {
  x: SETBACKS.left,
  y: SETBACKS.rear,
  w: PLOT.widthMm - SETBACKS.left - SETBACKS.right,
  h: PLOT.depthMm - SETBACKS.rear - SETBACKS.front,
};

const BRIEF =
  'Design a G+4 residential apartment with four 2BHK flats per typical floor, bedroom balconies, '
  + 'functional bathroom ventilation and living-first entrances.';

const UNIT_TYPES = ['2BHK', '2BHK', '2BHK', '2BHK'];

const result = generateDesignConcepts({
  envelope: ENVELOPE,
  flatsPerFloor: 4,
  unitTypes: UNIT_TYPES,
  aiPrompt: BRIEF,
  seed: 1,
  conceptLimit: 3,
});

const index = {
  reference: { plotMm: PLOT, setbacksMm: SETBACKS, envelopeMm: ENVELOPE, brief: BRIEF, seed: 1 },
  engineVersion: result.diagnostics.engineVersion,
  interpretedProgram: result.program,
  conceptCount: result.concepts.length,
  shortfallExplanation: result.shortfallExplanation ?? null,
  diagnostics: result.diagnostics,
  rejected: result.rejected,
  concepts: [],
};

for (const concept of result.concepts) {
  const dir = path.join(OUT, concept.conceptId);
  mkdirSync(dir, { recursive: true });

  // Canonical building for this concept, through the real multi-sheet solver.
  const solved = solveMultiSheetApartmentProject({
    projectId: `concept-${concept.conceptId}`,
    projectName: `${concept.label} (${concept.conceptId})`,
    aiPrompt: BRIEF,
    structuralLayoutMode: 'DEFERRED',
    plotWidthMm: PLOT.widthMm,
    plotDepthMm: PLOT.depthMm,
    roadWidthMm: 12000,
    roadAccessSides: [Direction.North],
    setbacksMm: SETBACKS,
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'generic_maharashtra',
    verticalStackType: 'G_PLUS_N',
    numTypicalFloors: 4,
    flatsPerFloor: 4,
    units: UNIT_TYPES.map((bhkType, i) => ({ unitIndex: i + 1, bhkType, hasUtilityBalcony: true })),
    floorToFloorHeightMm: 3150,
    stiltHeightMm: 3150,
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
  });

  const building = solved.building;
  const floor = building.floors.find(f => f.apartmentUnits?.length);

  writeFileSync(path.join(dir, 'canonical-building.json'), JSON.stringify(building, null, 2));

  // Room and area schedule.
  const rooms = (floor?.rooms ?? []).map(r => ({
    id: r.id,
    flatId: r.unitId ?? null,
    type: r.type,
    name: r.name,
    spaceUse: r.spaceUse ?? null,
    planningZone: r.planningZone ?? null,
    widthMm: r.width,
    heightMm: r.height,
    areaSqm: Number((polygonArea(r.boundary) / 1e6).toFixed(3)),
  }));
  writeFileSync(path.join(dir, 'room-schedule.json'), JSON.stringify(rooms, null, 2));

  const byFlat = {};
  for (const r of rooms) {
    const key = r.flatId ?? 'COMMON';
    byFlat[key] = Number(((byFlat[key] ?? 0) + r.areaSqm).toFixed(3));
  }
  writeFileSync(path.join(dir, 'area-schedule.json'), JSON.stringify({
    perFlatSqm: byFlat,
    sheetAudits: solved.schedule.sheetAudits,
    overallDeltaMm2: solved.schedule.overallDeltaMm2,
  }, null, 2));

  // Adjacency graph, from real door connections.
  const adjacency = (floor?.doors ?? []).map(d => ({
    doorId: d.id,
    type: d.type,
    widthMm: d.width,
    connects: d.connectsRooms,
  }));
  writeFileSync(path.join(dir, 'adjacency-graph.json'), JSON.stringify(adjacency, null, 2));

  // Core, shaft and circulation locations.
  const core = (floor?.rooms ?? [])
    .filter(r => [RoomType.Staircase, RoomType.Lift, RoomType.Corridor, RoomType.ServiceShaft].includes(r.type))
    .map(r => ({
      id: r.id, type: r.type, name: r.name,
      role: r.architecturalRole ?? null, openToSky: r.openToSky ?? false,
      xMm: r.x, yMm: r.y, widthMm: r.width, heightMm: r.height,
    }));
  writeFileSync(path.join(dir, 'core-and-shafts.json'), JSON.stringify(core, null, 2));

  // Ventilation report: every wet room, with its measured opening area.
  const ventilation = (floor?.rooms ?? [])
    .filter(r => r.type === RoomType.Bathroom)
    .map(r => {
      const windows = (floor?.windows ?? []).filter(w => w.roomId === r.id);
      return {
        roomId: r.id,
        name: r.name,
        windowCount: windows.length,
        openingAreaSqm: Number(windows.reduce((s, w) => s + (w.width * w.height) / 1e6, 0).toFixed(4)),
        udcprStatus: 'NOT_VERIFIED',
      };
    });
  writeFileSync(path.join(dir, 'ventilation-report.json'), JSON.stringify({
    note: 'Opening areas are measured from canonical geometry. Regulatory adequacy is NOT_VERIFIED '
      + 'and requires review by a licensed Architect/Engineer before municipal submission.',
    wetRooms: ventilation,
  }, null, 2));

  // Bedroom balcony schedule, straight from the canonical metadata.
  writeFileSync(path.join(dir, 'bedroom-balcony-schedule.json'),
    JSON.stringify(building.metadata.bedroomBalconySchedule ?? [], null, 2));

  // Constraint satisfaction and scoring, with the reasons behind each number.
  writeFileSync(path.join(dir, 'constraint-report.json'), JSON.stringify({
    feasible: concept.score.feasible,
    hardConstraints: concept.score.hardConstraints,
    geometryValidation: {
      isValid: solved.validationReport.isValid,
      errorCount: solved.validationReport.errors.length,
      errors: solved.validationReport.errors.slice(0, 20),
    },
  }, null, 2));

  writeFileSync(path.join(dir, 'scoring-explanation.json'), JSON.stringify({
    familyId: concept.familyId,
    variantId: concept.variantId,
    label: concept.label,
    rationale: concept.rationale,
    rankingExplanation: concept.rankingExplanation,
    emphasizedObjectives: concept.score.emphasized,
    weightedTotal: Number(concept.score.weightedTotal.toFixed(4)),
    objectives: concept.score.objectives,
    disclaimer: 'Scores describe internal software measurements only. They do not establish '
      + 'statutory compliance, structural adequacy or professional approval.',
  }, null, 2));

  writeFileSync(path.join(dir, 'layout-fingerprint.json'), JSON.stringify(concept.fingerprint, null, 2));

  index.concepts.push({
    conceptId: concept.conceptId,
    familyId: concept.familyId,
    variantId: concept.variantId,
    label: concept.label,
    canonicalDigest: concept.fingerprint.digests.canonical,
    adjacencyDigest: concept.fingerprint.digests.adjacency,
    circulationDigest: concept.fingerprint.digests.circulation,
    zoningDigest: concept.fingerprint.digests.zoning,
    weightedTotal: Number(concept.score.weightedTotal.toFixed(4)),
    roomCount: rooms.length,
    geometryValid: solved.validationReport.isValid,
    bedroomBalconies: (building.metadata.bedroomBalconySchedule ?? []).length,
  });

  // eslint-disable-next-line no-console
  console.log(`${concept.conceptId}  ${concept.familyId}/${concept.variantId}  rooms=${rooms.length}  valid=${solved.validationReport.isValid}`);
}

writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2));

// eslint-disable-next-line no-console
console.log(`\nWrote ${result.concepts.length} concept(s) to ${OUT}`);
if (result.shortfallExplanation) console.log(`Shortfall: ${result.shortfallExplanation}`);

# Architectural Generation, Efficiency & Diversity Verification (Phase 5 Gates B, C & D)

## 1. Gate B — 7-Level Requirement Hierarchy & Honest Efficiency Breakdown

- **Implemented Module:** `packages/planning-engine/src/diagnostics/architectural-efficiency.ts`
- **Enforced Hierarchy:**
  1. `PHYSICAL_MANDATORY` (envelope bounds, `< 0.001 mm²` planar conservation, bathroom ventilation, core access, `> 15 m` dual-stair life safety)
  2. `EXPLICIT_USER_CONSTRAINTS` (`NO OTS`, centered footprint, single lift, stair count when `<= 15 m`, separate bedroom balconies, explicit area targets, locked massing)
  3. `LOCKED_ENTITIES` (`lockedFloorIds`, `lockedEntityIds`, `protectedCoreIds`)
  4. `USER_PREFERENCES` (daylight/privacy/efficiency priorities, kitchen size/style, living orientation)
  5. `REFERENCE_IMAGE_GUIDANCE`
  6. `AI_SUGGESTIONS`
  7. `ENGINE_DEFAULTS`
- **Conflict Resolution:** Contradictory prompts (`PROMPT_CONTRADICTION`), undersized plots (`ENVELOPE_TOO_SMALL_FOR_PROGRAM`), excessive unit carpet sums (`CARPET_TARGETS_EXCEED_ENVELOPE`), and high-rise single-stair requests (`HIGH_RISE_STAIR_MINIMUM_OVERRIDE`) return structured diagnostics with **measurable feasible alternatives** (`maxPerFlatCarpetSqFt`, `suggestedFlatsPerFloor`, `requiredPlotWidthMm × requiredPlotDepthMm`).
- **Component-by-Component Efficiency Breakdown (`computeFloorEfficiencyBreakdown`):** Measures exact wall-clipped `modeledHabitableCarpet`, `wallFootprint`, `commonCirculation`, `verticalCore`, `privateUnitCirculation`, `balconyAndOutdoor`, `serviceSpacesAndShafts`, `openToSkyVoids`, and `residualUnassigned` (`< 0.001 mm²`) in `mm²`, `m²`, `sq ft`, and `% of gross plate` — surfaced directly in `Massing Studies`.

---

## 2. Gate C — Multi-Dimensional Design Diversity & Exploration Controls

- **Implemented Module:** `packages/planning-engine/src/topology/diversity-controls.ts`
- **Six-Axis Candidate Comparison (`compareCanonicalBuildingAlternatives`):**
  1. `roomAdjacencyDistance` (shared-wall space-kind multiset Jaccard distance)
  2. `doorCirculationDistance` (door/open-passage room connectivity multiset Jaccard distance)
  3. `apartmentBoundaryDistance` (unit quadrant, aspect ratio, and vertex topology distance)
  4. `coreArrangementShift` (stair/lift/corridor ninth-grid and spine orientation shift)
  5. `physicalGeometryIdentical` (`physicalLayoutHash` equality check)
  6. `massingShapeChanged` (`buildingMassingShape` comparison)
- **Interactive Studio Controls (`ConceptReviewWorkspace` & `ArgonStudioShell`):**
  - `Preserve core`, `Preserve exterior footprint`, `Change internal layout`, `Explore alternative massing`, `Optimize carpet area`, `Improve circulation`, `Improve daylight`, plus `Preserve selected rooms` via entity locks and Protected Localized Regeneration.
  - When no further genuinely distinct layouts exist under active locks, `buildAlternativeExhaustionExplanation()` explains why remaining variants were suppressed rather than returning near-duplicates.

---

## 3. Gate D — Exact Multi-Unit Room & Flat Area Control

- **Implemented Module:** `packages/core/src/models/unit-conversion.ts`
- **Supported Input Formats:** `mm`, `cm`, `m`, `ft`, `in`, compound `ft' in"`, mixed fractions (`12' 6 1/2"`, `165 1/2 sq ft`), `sq ft`, `sq m`, `mm²`, and `Width × Length` dimension pairs (`12' 0" x 15' 0"`, `3600 x 4500 mm`), converted to exact canonical `mm` (`304.8 mm/ft`, `25.4 mm/in`) and `mm²` (`92,903.04 mm²/sq ft`, `1,000,000 mm²/sq m`).
- **Interactive Editor (`InteractivePlanEditorPage.tsx`):** Displays current size, min habitable constraint, lock state, multi-unit target input, live `Δ sq ft` deviation, and protects locked neighbour rooms from shrinking.

## Independent replay

The Phase 5A topology tests executed genuine floor generation, compared physically different plans and rejected repeats. The group and single-room checks are evidence for bounded local changes. The broader diversity workflow still needs review across the nine briefs.

A production HTTP replay used the eight feasible project fixtures and excluded each accepted starting design. Seven second-seed candidates changed architectural geometry under the six-axis comparison. One candidate was refused because the strict unequal-area brief missed Flat 1's target. [Phase 5 project acceptance](PHASE5_REAL_PROJECT_ACCEPTANCE.md)

# RH PLANNER — CONFIRMED CRITICAL BUGS & DEFECT CATALOG

**Date:** 2026-11-13  
**Purpose:** Source-verified catalog of confirmed critical bugs in the RH Planner codebase, with exact file paths, line numbers, root causes, and reproduction conditions.

---

## Confirmed Critical Bugs

### BUG-01: `"Provide a central lift core"` Fails Mandatory Core Placement Regex (Confirmed)
- **File:** `packages/planning-engine/src/topology/architectural-intent.ts` (lines 198–205, 322)
- **Root Cause:** `interpretArchitecturalIntent` sets `core = 'CENTRAL'` when a clause mentions `"central lift core"`, but line 203 only sets `coreIsRequired = true` if the clause matches `/\b(place|position|put|locate|keep|move|shift)\b/`. Standard architectural prompts using `"Provide a central lift core"`, `"with a central lift"`, `"have a central lift"`, or `"include a central core"` leave `coreIsRequired = false`. As a result, `mandatory.corePlacement` is `undefined`, allowing non-central topologies (`LINEAR_SINGLE_LOADED`, `SIDE_CORE`) to win candidate scoring.
- **Impact:** Directly caused the user's prompt in Image 3 to generate a south-edge linear core (`LINEAR_SINGLE_LOADED`) instead of a central core.

### BUG-02: `"NO OTS"` / `"Without OTS"` Throws `IntentConflictError('AMBIGUOUS_VENTILATION_STRATEGY')` (Confirmed)
- **File:** `packages/planning-engine/src/topology/architectural-intent.ts` (lines 216–222)
- **Root Cause:** When a clause contains both `mentionsOts` (`/\b(courtyards?|...|ots|open[\s-]*to[\s-]*sky|voids?|atrium)\b/`) and `NEGATED` (`/\b(no|not|without|avoid|never|skip|omit|exclude)\b/`), `interpretArchitecturalIntent` throws `new IntentConflictError('AMBIGUOUS_VENTILATION_STRATEGY', ...)` instead of setting `ventilationStrategy = 'PERIMETER_ONLY'` (`noOts: true`).
- **Impact:** Any user prompt specifying `"NO OTS"`, `"without OTS"`, or `"no courtyard"` crashes `selectProductionTopology` and forces a silent fallback or error.

### BUG-03: Unused Buildable Envelope Is Converted into a Giant `624.0 m²` `OPEN_TO_SKY_VOID` Room Inside the Building (Confirmed)
- **File:** `packages/planning-engine/src/topology/topology-families.ts` (lines 674–705, 1086–1087, 1554–1607, 1797) and `packages/planning-engine/src/apartment/multi-sheet-apartment-solver.ts` (lines 1236, 1791)
- **Root Cause:**
  1. `generateTopologyCandidates` (`topology-families.ts:1797`) disables `planFootprint` and passes the entire buildable envelope as the building footprint.
  2. `sliceFlatRow` trims any envelope depth/width beyond `target.spanMm` / `target.runMm` into `leftovers`, which every topology family appends to `shaftBoxes` with role `'OPEN_TO_SKY_VOID'`.
  3. On a $46\times 36\text{ m}$ plot ($40\times 30\text{ m}$ buildable envelope), `linearSingleLoaded` uses $40\times 14.4\text{ m}$ for flats + corridor + core and turns the remaining $40\times 15.6\text{ m} = 624.0\text{ m}^2$ into an `"OPEN TO SKY COURT (LIGHT AND AIR VOID)"` room inside the building boundary.
- **Impact:** Produces the massive hatched void across the top 52% of the floor plan in Image 1, prevents centering the building inside the permissible envelope, and falsely inflates `groundCoverageM2` and `consumedFsi`.

### BUG-04: Disconnected Internal Passage Causes `repairApartmentPlan` to Punch a Door Directly Between `Kitchen` and `Master Bedroom` (Confirmed)
- **File:** `packages/planning-engine/src/interpretation/space-filling-snapper.ts` (lines 803, 1087, 1138, 1184–1186) and `packages/planning-engine/src/repair/apartment-error-repair.ts` (lines 1025–1085)
- **Root Cause:**
  1. In `sliceFlatRooms` (`space-filling-snapper.ts`), `livingZone` and `bedZone` are sliced independently along the flat's `y` axis:
     - In `bedZone`, `masterBed` spans `0 .. masterBedH` (`3780 mm`) and `passage` spans `masterBedH .. masterBedH + bathBlockH` (`3780 .. 6780 mm`).
     - In `livingZone`, `utility + kitchen` spans `0 .. serviceDepth` (`0 .. 6400 mm`) and `livingRoom` spans `serviceDepth .. box.h` (`6400 .. 10000 mm`).
  2. Because `serviceDepth` (`6400 mm`) and `masterBedH + bathBlockH` (`6780 mm`) overlap by only `380 mm` (`< 1100 mm` required for a `900 mm` passage opening), `createConnectingDoor` between `livingRoom` and `passage` returns `null`!
  3. When `repairApartmentPlan` runs Pass 4 (`repairPrivacyAndCirculation`, `apartment-error-repair.ts:1049`), the entire private bedroom wing is unreachable from `livingRoom`. The BFS healer picks `master_bed` first and connects it to the adjacent reachable room with the longest shared wall—which is `kitchenRoom`!
- **Impact:** Directly produces the architectural defect in Image 2 where the Master Bedroom opens into the Kitchen and the Internal Passage has no connection to the Living/Dining room.

### BUG-05: `targetCarpetSqFt` (e.g., `2,000 sq. ft.`) Is Silently Dropped by `selectProductionTopology` and Clamped by `FLAT_AREA_BOUNDS_SQM` (Confirmed)
- **File:** `packages/planning-engine/src/topology/production-bridge.ts` (line 79) and `packages/planning-engine/src/topology/topology-families.ts` (lines 78–117, 764–793)
- **Root Cause:** `selectProductionTopology` extracts only `unitTypes = (config.units ?? []).map(u => u.bhkType)` and never forwards `targetCarpetSqFt` to `generateDesignConcepts` or `flatFootprintTarget`. `flatFootprintTarget` hardcodes `FLAT_AREA_BOUNDS_SQM['2BHK'].max = 95` ($95\text{ m}^2$ gross) and `FLAT_BOUNDS.maxSpanMm = 9000`, `maxRunMm = 16000`.
- **Impact:** Any user-specified unit area target (such as `2,000 sq. ft.`) is silently ignored and reduced to $\sim 750\text{–}900\text{ sq. ft.}$ carpet area without warning.

### BUG-06: `"Staircases on both sides"` Flanking Central Lift Is Not Supported by `dissectCoreBand` (Confirmed)
- **File:** `packages/planning-engine/src/topology/architectural-intent.ts` (lines 160–175) and `packages/planning-engine/src/topology/topology-families.ts` (lines 499–502)
- **Root Cause:**
  1. In `architectural-intent.ts`, `"staircases on both sides"` or `"two staircases positioned on either side"` does not match `/\b(2|two|dual|double|twin|pair\s+of)\s+(fire\s+)?stairs?(?:cases?)?\b/` because the quantifier `"two"` is missing or separated (`"staircases on both sides"`).
  2. Even when `stairCount === 2`, `dissectCoreBand` (`topology-families.ts:500`) only stacks `[stairRun, liftBankRun, stairRun, 0]` along the core band (`CENTRAL_CORE_SPINE`) if `stairCount === 2` is parsed, and if `preferOts` is false, any remaining core band length (`tail.h`) is still turned into an `OPEN_TO_SKY_VOID` when `Math.min(tail.w, tail.h) >= 4500 mm` (`roleFor` line 619: `preferOts || Math.min(box.w, box.h) >= CORE_BOUNDS.otsMinSpan * 1.5 ? 'OPEN_TO_SKY_VOID' : 'SERVICE_SHAFT'`)!
- **Impact:** Even when `preferOts` is `false`, `roleFor` (`topology-families.ts:619`) forces any core tail $\ge 4500\text{ mm}$ to become an `OPEN_TO_SKY_VOID`!

### BUG-07: Complete Bypass of Backend & Gemini During Active Generation (Confirmed)
- **File:** `packages/frontend/src/components/argon/ArgonStudioShell.tsx` (lines 89–163), `packages/frontend/src/services/argon-planning.worker.ts` (lines 1–18), `packages/backend/src/server.ts` (lines 176–198)
- **Root Cause:** The frontend Web Worker calls `executeAuditedPlanningPipeline(config)` locally in the browser and never calls the backend server (`http://localhost:4200`). Furthermore, the backend server has no `/api/generate` or `/api/parse-intent` route—only `/api/evaluate/architecture` and `/api/export/*`.
- **Impact:** Gemini is never invoked during plan generation, and there is zero telemetry showing whether AI parsing or deterministic fallback produced the intent.

### BUG-08: `generateTargetedRefinements` Deletes Windows on Selected Rooms (Confirmed)
- **File:** `packages/planning-engine/src/refinement/targeted-regeneration.ts` (line 130)
- **Root Cause:** `rebuildDependencies` returns `windows: floor.windows.filter(window => !selected.has(window.roomId))`, stripping all exterior windows from any room included in targeted regeneration instead of re-hosting them on the room's exterior walls.
- **Impact:** Targeted room regeneration silently destroys exterior windows on modified rooms.

### BUG-09: `createArgonRequest` Clamps `flatsPerFloor` to `2 | 3 | 4` (Confirmed)
- **File:** `packages/frontend/src/services/argon-request.ts` (line 5)
- **Root Cause:** `const flatsPerFloor = ([2, 3, 4].includes(data.flatsPerFloor) ? data.flatsPerFloor : 4) as 2 | 3 | 4;` silently overwrites `1`, `5`, or `6` flats per floor to `4`, even though `MultiSheetApartmentConfig` and `TopologyContext` support `1 | 2 | 3 | 4 | 5 | 6`.


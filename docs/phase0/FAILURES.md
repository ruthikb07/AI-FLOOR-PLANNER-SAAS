# Exact baseline failed tests

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/apartment-error-repair.test.ts > Closed-Loop Hard & Soft Error Auto-Repair Engine (Phase 1D) > detects missing rooms (bedroom/bathroom) and synthesizes them by subdividing oversized zone while preserving Delta = 0.000 mm²

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/apartment-error-repair.test.ts > Closed-Loop Hard & Soft Error Auto-Repair Engine (Phase 1D) > heals corridor-to-bedroom privacy violations by removing direct door and connecting through unit living zone

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/apartment-error-repair.test.ts > Closed-Loop Hard & Soft Error Auto-Repair Engine (Phase 1D) > heals disconnected/orphan rooms by synthesizing connecting doors to reachable spaces

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/apartment-error-repair.test.ts > Closed-Loop Hard & Soft Error Auto-Repair Engine (Phase 1D) > steps down door width within statutory bounds and centers it when wall segment is tight

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/apartment-error-repair.test.ts > Closed-Loop Hard & Soft Error Auto-Repair Engine (Phase 1D) > resolves opening overlaps by deduplicating coincident doors on the same wall

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/apartment-error-repair.test.ts > Closed-Loop Hard & Soft Error Auto-Repair Engine (Phase 1D) > extractApartmentPlan returns a valid building with 0 hard errors and Delta = 0.000 mm²

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/multi-sheet-apartment-solver.test.ts > Multi-Sheet Apartment Project Engine (Phase 1C) > solves S+7 Mid-Rise Triple Flat (3x 3BHK, 15m < height <= 24m, 2 stairs + 2 lifts) with Delta = 0.000 mm²

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/plancraft-integration.test.ts > Plancraft Integration Suite > 2. populateCanonicalFurniture Across Double, Triple, Quad & Mixed Apartments > furnishes Double 2BHK with 0 door-swing collisions and Delta = 0.000 mm² planar ledger conservation

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/plancraft-integration.test.ts > Plancraft Integration Suite > 2. populateCanonicalFurniture Across Double, Triple, Quad & Mixed Apartments > furnishes Double 3BHK with 0 door-swing collisions and Delta = 0.000 mm² planar ledger conservation

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/plancraft-integration.test.ts > Plancraft Integration Suite > 2. populateCanonicalFurniture Across Double, Triple, Quad & Mixed Apartments > furnishes Double 4BHK with 0 door-swing collisions and Delta = 0.000 mm² planar ledger conservation

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/plancraft-integration.test.ts > Plancraft Integration Suite > 2. populateCanonicalFurniture Across Double, Triple, Quad & Mixed Apartments > furnishes Triple 2BHK+3BHK+4BHK with 0 door-swing collisions and Delta = 0.000 mm² planar ledger conservation

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/plancraft-integration.test.ts > Plancraft Integration Suite > 2. populateCanonicalFurniture Across Double, Triple, Quad & Mixed Apartments > furnishes Quad Mixed 2BHK+2BHK+3BHK+4BHK with 0 door-swing collisions and Delta = 0.000 mm² planar ledger conservation

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/space-filling-snapper.test.ts > Phase 1B — Orthogonal Space-Filling Elastic Snapper & Exact Metric Solver > Double Flat (2 Units) > 2x 3BHK in STATUTORY_SETBACK_100_PERCENT mode: stretches buildable envelope cleanly

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/space-filling-snapper.test.ts > Phase 1B — Orthogonal Space-Filling Elastic Snapper & Exact Metric Solver > Double Flat (2 Units) > 2x 4BHK in FULL_LOT_100_PERCENT mode: enforces statutory clearances

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/space-filling-snapper.test.ts > Phase 1B — Orthogonal Space-Filling Elastic Snapper & Exact Metric Solver > Triple Flat (3 Units) > 3x 2BHK in STATUTORY_SETBACK_100_PERCENT mode: passes closure gate

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/space-filling-snapper.test.ts > Phase 1B — Orthogonal Space-Filling Elastic Snapper & Exact Metric Solver > Triple Flat (3 Units) > 3x 3BHK in FULL_LOT_100_PERCENT mode: golden triple flat configuration

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/space-filling-snapper.test.ts > Phase 1B — Orthogonal Space-Filling Elastic Snapper & Exact Metric Solver > Quad Flat (4 Units) > 4x 2BHK in FULL_LOT_100_PERCENT mode: 4 quadrants around central core spine

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/space-filling-snapper.test.ts > Phase 1B — Orthogonal Space-Filling Elastic Snapper & Exact Metric Solver > Quad Flat (4 Units) > 4x 3BHK in STATUTORY_SETBACK_100_PERCENT mode: high density tower layout

- @ai-floor-planner/planning-engine:test:  FAIL  |@ai-floor-planner/planning-engine| src/__tests__/space-filling-snapper.test.ts > Phase 1B — Orthogonal Space-Filling Elastic Snapper & Exact Metric Solver > Quad Flat (4 Units) > Mixed Quad Flat (2BHK + 3BHK + 4BHK + 2BHK) in STATUTORY_SETBACK_100_PERCENT mode

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase3-honest-gate-fallback.test.ts > Phase 3 — preflight rejection is honest (never "Score 0") > preflight FAIL → candidate REJECTED at VISUAL_PREFLIGHT with score null, no evaluation and no interpretation

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase3-honest-gate-fallback.test.ts > Phase 3 — bounded retry then deterministic fallback (Path B) > attempt 1 fail → attempt 2 fail → attempt 3 fail → retry limit reached → FALLBACK_DETERMINISTIC

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase3-honest-gate-fallback.test.ts > Phase 3 — bounded retry then deterministic fallback (Path B) > valid fallback plan → real Gemini architectural evaluation → numeric score

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase3-honest-gate-fallback.test.ts > Phase 3 — bounded retry then deterministic fallback (Path B) > preflight that cannot run is NOT a pass: no FLUX acceptance, no retry spend, fallback used

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase3-honest-gate-fallback.test.ts > Phase 3 — FLUX success path (Path A) > FLUX → preflight PASS on attempt 1 → source FLUX, real Gemini score, no fallback

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase3-honest-gate-fallback.test.ts > Phase 3 — FLUX success path (Path A) > attempt 1 FAIL → attempt 2 PASS → FLUX accepted on the retry seed, rejected attempt stays unscored

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase3-honest-gate-fallback.test.ts > Phase 3 — deterministic fallback preserves exact counts for any N > requested 2 flat(s) → fallback has exactly that many, plus exact lifts/stairs and common lobby

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase4-image-to-2d.test.ts > Phase 4 — acceptance: manifest = interpretation = canonical model > accepts a faithful interpretation into an editable canonical 2D plan

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase4-image-to-2d.test.ts > Phase 4 — room program classification > a day space typed "living" but labelled "LIVING / DINING" fills both roles; a label never adds a bedroom

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase4-image-to-2d.test.ts > Phase 4 — FALLBACK_DETERMINISTIC through the canonical validation path > the deterministic base plan passes every canonical stage and keeps DETERMINISTIC_SCHEMATIC provenance

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase4-image-to-2d.test.ts > Phase 4 — orchestrated paths keep provenance and use the explicit image part > accepted FLUX image → explicit image part → apartment interpretation → ACCEPTED canonical plan (source FLUX)

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase4-image-to-2d.test.ts > Phase 4 — orchestrated paths keep provenance and use the explicit image part > a FLUX image whose interpretation fails hard validation is rejected and the fallback keeps its own provenance

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase5-evaluation-and-sweep.test.ts > Phase 5 — evaluatePlanArchitecturally runs only after hard validation passes > orchestrated apartment: the hard-validation-rejected FLUX plan is not evaluated; only the valid fallback is

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase5-evaluation-and-sweep.test.ts > Phase 5 — evaluatePlanArchitecturally runs only after hard validation passes > valid plan whose evaluation fails stays ACCEPTED but NOT SCORED (stage FAILED, diagnostic recorded)

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase5-evaluation-and-sweep.test.ts > Phase 5 — per-candidate stage state is real (no false success) > preflight-rejected candidate: everything after preflight is SKIPPED; fallback reports its own stages

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase5-evaluation-and-sweep.test.ts > Phase 5 — scale sweep (mocked providers, real deterministic pipeline) > 2 flat(s), FLUX accepted path: manifest = schematic = validated = N, scored only after validation

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/phase5-evaluation-and-sweep.test.ts > Phase 5 — scale sweep (mocked providers, real deterministic pipeline) > 2 flat(s), FLUX rejected → deterministic fallback: exact N preserved, provenance kept

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/two-phase-concepts.test.ts > Two-phase upgrade — Phase 1: four controlled FLUX concepts > valid concepts are interpreted, hard-validated and scored; the user chooses (no auto-apply)

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/two-phase-concepts.test.ts > Two-phase upgrade — Phase 1: four controlled FLUX concepts > a concept rejected at visual preflight is NOT scored; the others continue

- packages/backend test:  FAIL  |@ai-floor-planner/backend| src/__tests__/two-phase-concepts.test.ts > Two-phase upgrade — Phase 1: four controlled FLUX concepts > all four rejected ⇒ deterministic fallback (Candidate 01 plan), never an auto-applied FLUX image

# Livability Phase 0 verification

Date: 2026-11-13. Scope: diagnosis and benchmark only. Production code unchanged.

The governing instructions are AGENTS.md, docs/specs/LIVABILITY_STANDARDS.md,
and the user's phased implementation prompt. The user explicitly requires stopping
after each phase. Phase 1 implementation and the livability scorer remain pending.

## Source corrections to the handoff

1. Silent legacy fallback exists in `multi-sheet-apartment-solver.ts`, after
   `selectProductionTopology` returns undefined. The benchmark now observes that
   actual return, rather than inferring it from a separate topology run.
2. Bathroom positions in `space-filling-snapper.ts` depend on corridor orientation.
   The window loop in the typical-floor solver has no explicit missing-ventilation
   result. Adjacency by itself is not ventilation: the corrected audit requires
   a positive-size window hosted by an external/shaft wall associated with the room.
   This is an opening-presence metric, not a statutory ventilation certification.
3. The living zone receives the remaining depth after the service band. The
   benchmark measures the resulting living/kitchen imbalance.
4. `dissectCoreBand` checks minimum stack width but gives stairs the entire stack
   width. `PERIMETER_HABITABLE` requires a 5800 mm stack for its wrapping flat.
   Aggregate maximum width and maximum height may belong to different stairs;
   they must not be combined into an invented single rectangle.
5. **Floor.stairs is populated in final production output.** Initial empty arrays
   are followed by `coordinateArchitecturalStairs`, which calls the geometry
   engine's stair proposal logic. Phase 2a must inspect and improve this existing
   implementation, not introduce a competing authoritative stair representation.
6. Chajjas already exist as derived presentation defaults in
   `projection-3d/src/building-scene-projector.ts`. Canonical persistence and CAD
   parity remain the relevant work; claiming no existing 3D chajja is incorrect.
7. The 11000 mm envelope check and 2/3/4-flat validation remain. However,
   `MultiSheetApartmentConfig.generationSeed` already reaches topology selection,
   and the concept API already accepts `conceptLimit`. Existing topology families
   and adjacency/core/zoning fingerprints must be extended rather than duplicated.

## Focused benchmark results

| Flats | Cases | Plans produced | Legacy fallback | No plan |
|---|---:|---:|---:|---:|
| 1 | 48 | 0 | 0 | 48 |
| 2 | 48 | 48 | 37 | 0 |
| 3 | 48 | 48 | 38 | 0 |
| 4 | 48 | 48 | 40 | 0 |
| 5 | 48 | 0 | 0 | 48 |
| 6 | 48 | 0 | 0 | 48 |

Fallback: 115/144 produced plans (79.9%). All 144 no-plan cases rejected the
flat count. Separate topology exploration returned zero concepts in 259/288 cases.

| Rejection class | Occurrences |
|---|---:|
| Flat run below minimum | 2112 |
| Every bathroom ventilated | 555 |
| Wing too narrow | 340 |
| Flat oversized | 288 |
| Court infeasible | 192 |
| Unsupported flat count | 144 |
| Core band too small | 72 |
| Every flat reaches facade | 52 |
| Family precondition | 48 |
| Beyond requested concept count | 45 |
| Identical under mirroring/rotation | 44 |
| Core leaves insufficient wrapping-flat run | 16 |
| Similar concept | 13 |

First residential floor measurements across produced plans:

- Bathrooms lacking a hosted external/shaft opening: **524/1272**.
- Maximum stair-room width: **5800 mm**; maximum height independently: **4500 mm**.
- Empty final Floor.stairs arrays: **0/144**.
- Maximum living room: **239.8 m2**; maximum kitchen: **14.4 m2**.
- Worst per-plan maximum-living / maximum-kitchen ratio: **16.67:1**.
  For mixed programs this compares per-floor maxima, not necessarily the same unit.
- Carpet/envelope ratio range: **9.2%-83.7%**.

Focused benchmark passed (288 rows), approximately 246 seconds. This assertion
checks audit execution, not plan quality. Typecheck, lint and build passed for
planning-engine. The package suite finished with **536 passed, 3 failed** across
64 files (61 passed, 3 failed); its benchmark reproduced the focused measurements.
Failures remain in the current production baseline:

- `bedroom-balcony-generation.test.ts:41`: missing balcony/access-door references.
- `multiple-scenarios-audit.test.ts:174`: decimal-site geometry correction error,
  including entrance and utility findings.
- `prompt-placement-production.test.ts:176`: measured width 3000 mm exceeds the
  existing 2300 mm upper assertion.

No tests were weakened. `git diff --check` passed. Repository-wide test/build
checks were not run; the checks above are planning-engine scoped. The overall
quality gate is **NOT PASSED**. Phase 1 should address explicit generation outcomes
and ranked violations while preserving the failing geometry evidence.

## Measurement details

Twelve plots, flat counts 1 through 6, homogeneous 2/3/4-BHK programs and cyclic
2/3/4-BHK mixed programs: 288 cases. A one-flat mixed case necessarily contains
only one unit. Cases outside the current flat-count contract are intentionally
sent to production to record its actual rejection.

Room and ventilation metrics sample the first residential floor of each plan;
they are not whole-building totals. Separate topology rejection counts include
multiple reasons per candidate and are not counts of failed projects. Unsupported
flat-count entries are separately classified. Generation has wall-clock budgets,
so candidate counts can vary under machine load.

Evidence files in `test-artifacts/`:

- `livability-phase0-benchmark.log`: focused run, histogram and fallback table.
- `livability-phase0-results.json`: per-case measurements (most recent test run).
- `livability-phase0-package-tests.log`: planning-engine package suite.
- `livability-phase0-typecheck.log`, `livability-phase0-lint.log`,
  `livability-phase0-build.log`: package checks.

No renderer changes, commits, threshold relaxations or production fixes were made.
Build/test commands may update generated artifacts; existing user changes were
preserved. No before/after quality improvement is claimed in an audit-only phase.

Automated checks provide engineering design assistance and require verification
by a licensed Architect/Engineer before municipal submission.

# Livability Phase 1 implementation

Date: 2026-11-13. No commits. User changes and existing acceptance thresholds preserved.

## Behavior delivered

- Topology generation retains the best assembled failed candidate separately from
  feasible concepts. Fewest failed hard constraints ranks first, then measured
  utility and stable variant identity. Hard failures never become accepted concepts.
- Production attempts this candidate through the existing bounded repair path.
  One legacy comparison protects sheet conservation, final critical findings and
  requested balcony area. If legacy wins, both its use and the comparison are explicit.
- The final canonical building is re-audited after stair/architectural coordination.
  A persisted `generationReport` contains strategy, rejection evidence and ranked
  geometry, closure, raw area-ledger and bathroom-opening findings. Critical findings
  precede warnings. Topology findings are labelled pre-repair evidence.
- Audited generation returns the reviewable building even when closure/geometry
  validation fails. `validationReport.isValid` remains false; no constraint is waived.
- The main Argon UI shows the ranked findings. Completion means processing completed,
  not compliance, professional approval or suitability for construction.
- `generateApartmentOutcome` provides a non-throwing boundary with PLAN, INVALID_INPUT,
  INFEASIBLE and SEARCH_EXHAUSTED outcomes. Only a nonpositive buildable envelope is
  proved INFEASIBLE. Unsupported program counts and algorithmic failures are not.
  At most three independently generated alternatives are tried in normalized
  flat-count/plot-dimension distance order; they never overwrite the requested input.
  The worker exposes structured failure and alternative evidence.

## Limits — Phase 1 acceptance is not complete

The existing 2/3/4-flat domain and 11000 mm envelope limitations still exist in the
legacy solver. The new boundary reports these honestly and may provide a generated
alternative; it cannot promise the requested plan for every physically possible input.
Nor does bounded search prove a globally nearest feasible alternative. Alternatives
can themselves have best-effort findings and are explicitly review-required.

Consequently the user's universal NEVER-BLOCK acceptance requirement remains open.
Expanding supported programs/compact geometry is implementation work, not something
that can be achieved by relabelling these errors or passing failed constraints.
No new shaft, stair geometry, room-program or facade implementation from Phase 2 is
claimed. No professional or statutory acceptance is claimed.

## Verification

- Focused Phase 1 plus existing multi-sheet regression tests: 9 passed.
- Final Phase 1 focused rerun: 4 passed.
- Core suite: 192 passed.
- Planning-engine typecheck/build: passed.
- Workspace lint: passed.
- Workspace typecheck/build and full test orchestration: blocked by existing
  `packages/frontend/src/services/storage.ts:7` importing removed
  `FloorPlanImagePromptRequest` from AI orchestration. This is a source dependency
  error associated with the FLUX removal, not BUILD_ENVIRONMENT_BLOCKED.
- Changed-source diff check: passed.

Planning-engine final suite: **540 passed, 3 failed** (62 passed files, 3 failed).
The same three baseline failures remain: bedroom balcony access references,
decimal-site geometry validity, and the 3000 mm versus 2300 mm bounded-room assertion.
The decimal-site test now receives the building with `isValid=false` instead of
losing it to an exception. Its assertion remains unchanged and failing honestly.

### Before/after: same 288-case direct-solver matrix

| Measurement | Phase 0 | Phase 1 |
|---|---:|---:|
| Plans produced | 144 | 144 |
| Legacy fallback | 115/144 (79.9%) | 112/144 (77.8%) |
| No plan (unsupported 1/5/6 flats) | 144 | 144 |
| Bathrooms without hosted external/shaft opening | 524/1272 | 524/1272 |
| Max stair width / independent max height | 5800 / 4500 mm | 5800 / 4500 mm |
| Worst maximum-living/maximum-kitchen ratio | 16.67:1 | 16.67:1 |
| Empty final Floor.stairs | 0 | 0 |

The three reduced fallback cases use explicit failed candidates, not newly validated
concepts. No increase in accepted distinct fingerprints is claimed. Shaft/stair/room
quality has not improved in this phase; the improvement is retaining and reporting
results rather than hiding failure. **Overall acceptance gate: NOT PASSED.**

Evidence: `test-artifacts/livability-phase1-*.log`. The phase0-results JSON was refreshed
by the initial Phase 1 suite; use the preserved Phase 0 log/report for baseline
figures. Subsequent runs now write `livability-current-results.json` explicitly.

Build/test runs regenerated artifacts. The previously clean generated backend bundle
was restored to its initial content; pre-existing modified artifacts were preserved.

Automated checks provide engineering design assistance and require verification by
a licensed Architect/Engineer before municipal submission.

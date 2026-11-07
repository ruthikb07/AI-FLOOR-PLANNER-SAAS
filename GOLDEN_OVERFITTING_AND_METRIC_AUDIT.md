# Golden 3 × 3BHK overfitting and metric integrity audit

**Source basis:** D: workspace working tree, 2026-10-01. The Golden report is historical evidence, not the authority for current implementation. This file records issues only; no generation code or artifacts were changed.

## Golden values by provenance

| Value | Actual source | Classification | Generalizable? |
|---|---|---|---|
| 50×50 m, North; setbacks 3/2/2/2 m | `packages/ai-orchestration/src/apartment/contract.ts:261-277`; general fallback `:141-145` | Fixture/default assumption, **not** verified site/regulation | No |
| Conflicting Golden setback constant 5/4/4/4 m | `contract.ts:279-293` | Fixture-only constant; differs from creator | No; resolve which scenario was audited |
| 3 units, all 3BHK, 1100 ft² target, 2 lifts, 2 stairs | `contract.ts:245-277` | Golden fixture intent; not universal requirement | Only as one holdout brief |
| `FLAT_01..03` IDs | `contract.ts:165-210` | Deterministically generated IDs; numbering not topology authority | Yes, as identity convention |
| Default 3 × 3BHK when no contract | `apartment/envelope-solver.ts:86-92` | Golden-biased fallback | No in production |
| `THREE_WING_CORE`, North/West/East ordered assignment | `envelope-solver.ts:103-111,152-220` | Valid **candidate topology** for 3 units; fixed ordering/orientation is a fixture bias | Test with orientation, mix, and unequal areas; do not globalize |
| Other family selection by flat count | `envelope-solver.ts:103-117`; `topology-library.ts` | General topology framework but count-to-family heuristic | Conditional |
| Program room sets for 1–4BHK | `apartment/program-registry.ts` | Hard-coded office-like presets, unverified; not Golden-specific | Candidate baseline only |
| Golden `117.45`/`438.35`/ratios | scripts and `output/golden-3x3bhk-phase` | Mixed computed, hard-coded, and copied report values | No until reconciled |

The contract and candidate search do include generalized unit schedules and 2–8 unit language (`contract.ts:1-9,50-78,162-210`; `candidate-search.ts`). Do not label the entire engine overfitted. The specific risk is **implicit Golden fallbacks and one count/orientation pattern** being treated as verified general inputs. The RBEA fixtures are redacted test evidence and are not used to tune exact production coordinates.

Two integrity gaps matter before using the contract as a complete revision identity. `getUnitProgram()` maps an unknown unit string to **3BHK** (`program-registry.ts:552-559`), so an unsupported brief can acquire an invented program. `computeApartmentContractHash()` includes derived buildable width/depth/area but omits the individual front/rear/left/right setback values (`contract.ts:88-122`); swapping front and rear amounts while retaining the same totals can leave the hash unchanged even though access and massing intent differ. Neither behavior should be silently accepted in held-out briefs.

## Metric integrity: current report versus arithmetic

The published `GOLDEN_3X3BHK_ACCEPTANCE_REPORT.md` lists gross 438.35 m², apartments 352.35 m², core 52.50 m², circulation 18 m², efficiency 80.4%, core ratio 7.4%, circulation ratio 5.3%, and cost score 100. These figures **do not all describe one reconciled ledger**:

| Check | Calculation | Result |
|---|---:|---|
| Listed core subparts | lifts 9 + main stair 14 + fire stair 14 + lobby 18 + shafts 6 | **61 m²**, not 52.5 |
| 52.5 m² / 438.35 m² | core ratio | **11.98%**, not 7.4% |
| 18 m² / 438.35 m² | circulation ratio | **4.11%**, not 5.3% |
| 352.35 m² / 438.35 m² | apartment efficiency | **80.38%** (80.4% rounds correctly) |
| Apartments + reported core + circulation + 15 m² wall proxy | 352.35 + 52.5 + 18 + 15 | **437.85 m²**, 0.50 m² below gross |
| Implied area at reported 7.4% / 5.3% | 438.35 × ratios | 32.44 m² core / 23.23 m² circulation; neither appears as the report's areas |

`packages/ai-orchestration/src/__tests__/holdout-acceptance.test.ts:66-88` has a **different**, mathematically reconciled ledger: apartments 352.35 + lift 9 + stairs 28 + shafts 6 + lobby 18 + corridor 10 + walls 15 = 438.35 m². Under its metric definition, core equipment/shafts = **43 m² (9.81%)**, and lobby+corridor = **28 m² (6.39%)**. This test proves the metric function can reconcile supplied numbers; it does **not** prove those areas were measured from Golden geometry.

The preservation script `scripts/generate-golden-phase-artifacts.ts:374-423` writes baseline/stabilized ratios and score as literals (`0.804`, `0.074`, `0.053`, `100`). Its summary repeats fixed strings (`:430-447`). The optimizer's real `calculateCostEfficiencyMetrics` clamps its score to **96** (`packages/ai-orchestration/src/apartment/core-optimizer.ts:396`), so a reported optimizer score of 100 cannot come from that function. The score is a relative planning proxy, never a construction cost estimate.

`output/golden-3x3bhk-phase/02-feasibility/area-budget.json` has `unitId` serialized as an object and room-line IDs beginning `[object Object]_...`, indicating the artifact producer called a string-ID API with an object. The same unit records say `verificationStatus: VERIFIED_FROM_SOURCE` while individual room lines say `UNVERIFIED`. `area-budget.ts:70-134` computes the budget but does not supply a professional source for the room target values. Treat this artifact as unreliable provenance evidence until regenerated and checked.

## Five-run evidence is narrower than claimed

`scripts/generate-golden-phase-artifacts.ts:369-405` sets five seeds and writes `run-metadata.json` fields such as requested/generated flats, core counts, hard errors, preflight and accepted status as **literals**. The schematic `scCanonical` is created once before that loop (`:314`), then its JSON/SVG are copied into each run. These five folders do **not** demonstrate five independent stochastic FLUX→Gemini→Image-to-2D runs or a measured 100% production reliability rate. The separate `scripts/run-golden-3x3bhk.ts` has an executable runner, but its own summary still contains fixed PASS strings and some fallback metrics (`:432-478`); each stage needs traceable run IDs and measured outputs before release claims.

The scripted extraction/canonical artifacts also contain fixed `hardErrors: 0`, `zeroCollisions: true`, and coordinates (`generate-golden-phase-artifacts.ts:280-324`), which are not interchangeable with an actual canonical validator result. The acceptance report's “verified DXF” statement conflicts with `packages/frontend/src/services/advanced-export.ts:11`, where export formats are `svg | pdf | json` only.

## Required future fixes and acceptance evidence

1. Define one area ledger with non-overlapping categories: unit built-up, lift, stair, shaft, lobby, corridor, wall, outdoor/void, residual; state whether lobby is core or circulation, then measure from canonical geometry.
2. Generate all ratios and scores from that ledger, record formulas and inputs, and reject summaries whose components do not reconcile within explicit rounding tolerance.
3. Fix the artifact call/type mismatch and distinguish “computed from code” from “verified architectural source.”
4. Trace each run through contract, candidate, image/preflight, reconstruction, validator, and export IDs with separate seeds and actual outputs. Label deterministic schematic reproductions accurately.
5. Retain Golden as one regression fixture. Accept generalization only against independent 2/3/4 flat, mixed-unit, aspect/orientation, core-choice, and infeasible holdouts, with professional plan review.
6. Correct the acceptance report and release language; no claim of professional, statutory, DXF, or production reliability acceptance follows from these artifacts.

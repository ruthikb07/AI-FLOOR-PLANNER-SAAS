# Phase 6 independent acceptance matrix

Audited main and local detached HEAD are `548929820c9295b1368fea55ce3a316136e1d345`. Repairs are uncommitted. The source manifest identifies the tested overlay. Evidence paths resolve relative to this isolated checkout. The original user checkout and its pending work were preserved.

| # | Requirement | Status | Evidence and disposition |
|---|---|---|---|
| 1 | Foundation lint | VERIFIED | Reproduced both prefer-const diagnostics. Only binding mutability changed at `packages/structural-engine/src/foundation/foundation-design-engine.ts:328` and `:692`. |
| 2 | Production verification | VERIFIED | The final full repair Chromium suite passed 25/25. Suite-level results and caveats appear below. |
| 3 | Large Awatif WASM model | VERIFIED | Pre-repair binary trapped on the original mesh. The audited binary completed four batches of 37 right-hand sides each on that mesh with real WASM, balanced allocation/free counts and equilibrium. |
| 4 | Historical structural failures | PARTIAL | Separated the displacement-check defect and nonconcurrent raft envelope from genuine section failures. Geometry and load paths changed between generations. Project load adequacy and all 1,351 individual checks have no independent sign-off. |
| 5 | Physical identity, load transfer, recovery and quantities | PARTIAL | All generated analytical elements have one owner. Beam ends and column stacks connect. Gravity comparison and closed-form benchmarks pass. Lateral native results differ and tributary loading and detailing remain preliminary. |
| 6 | Individual mixed areas and footprint | VERIFIED | Production request replay reduced the gross plate from 918.00 to 894.54 m². All four apartments meet the fixture tolerance. Exact areas below. |
| 7 | Preserve architectural requirements | PARTIAL | Signed straight-survey, project constraints, strict unequal targets, access and hosted-opening checks have executable coverage. The tested population leaves unverified combinations of protected rooms, ventilation, shapes and split cores. |
| 8 | Online/offline architectural acceptance | PARTIAL | Both worker branches apply the mandatory gate. Backend additionally performs feasibility and bounded recovery. See runtime comparison below. |
| 9 | Stilt drainage and wet walls | PARTIAL | Reproduced connected and disconnected fixtures. Three-flat and courtyard stilt service outlets still need a coordinated route. |
| 10 | Unsupported capabilities | VERIFIED | Scope boundaries documented below. Individual unsupported capabilities remain NOT TESTED for implementation acceptance. |
| 11 | Durable revision-bound provenance | VERIFIED | Disk-backed manifests persist checked results and input/options through backend restart. Six concurrent writes, checksum rejection and typed-array recovery tested. |
| 12 | Scope | VERIFIED | No cinematic UI or unrelated product changes, commits, pushes or merges. Test-generated artifacts are distinguished in the source inventory. |
| 13 | Authoritative matrix | VERIFIED | This file binds the measurements to the audited commit and local source SHA-256 inventory. |

## Architecture

The previous advisory path filled the permissible rectangle and gave flats substantially more area than requested. On an empty brief the deterministic proposal also imposed a default room archetype. A strict unequal allocation was already available. The repair allows that allocator to select the archetype when unspecified, checks the individual measured results, and trials successively smaller reductions of surplus floor depth. Every accepted candidate must pass existing compliance and mandatory blockers. The algorithm retains the advisory contract when the program cannot fit. The bounded search leaves 164.01 m² of void in this fixture and makes no optimality claim.

| Flat | Target ft² | Before ft² | Error | Repaired ft² | Error |
|---|---:|---:|---:|---:|---:|
| 1 | 850 | 1213.76 | +42.80% | 856.45 | +0.76% |
| 2 | 850 | 1382.63 | +62.66% | 863.30 | +1.56% |
| 3 | 1250 | 1939.21 | +55.14% | 1264.82 | +1.19% |
| 4 | 1250 | 1920.01 | +53.60% | 1289.06 | +3.12% |

See [original wizard capture](../../../phase6-evidence/mixed-before/), [baseline floor](../../../phase6-evidence/footprint-before.log) and [compact floor](../../../phase6-evidence/compact.log). The separate strict 3% control requested 720/1050/1420/1750 ft² and measured 723.79/1056.73/1417.44/1756.56 ft². Mixed and strict browser cases also exercise downstream CAD, protected regeneration and functional circulation. Source: `packages/ai-orchestration/src/orchestration/architectural-proposal.ts:1253`, `packages/planning-engine/src/apartment/multi-sheet-apartment-solver.ts:2824`, `:2954`, `packages/frontend/e2e/rh-phase51-project-matrix.spec.ts:113`, `packages/backend/src/__tests__/phase2-architectural-verification.test.ts:104,123`.

Backend gates regular, alternative and recovered candidates in `packages/backend/src/api/generation-routes.ts:300,336,351,376,439`. Browser backend response and final worker output both call requireAcceptedGeneration in `packages/frontend/src/services/argon-planning.worker.ts:75,140`. Main-thread generation also checks results in `packages/frontend/src/services/argon-generation.ts`. Common conditions are defined in `packages/constraint-engine/src/generation-acceptance.ts:158,195`. An equivalent acceptance predicate permits different feasible geometry and does not prove equivalent recovery coverage.

The wet-wall tests at `packages/planning-engine/src/__tests__/wet-wall-risers.test.ts:94` and backend `packages/backend/src/__tests__/phase5-real-project-acceptance.test.ts:663` exercise reservations and outlet routing. The two-flat collector connects. The three-flat case leaves outlets disconnected and the four-flat courtyard has two disconnected outlets. Projected endpoints in protected stilt space and prohibited service crossings constrain the horizontal collector. See `packages/planning-engine/src/mep/mep-synthesizer.ts:299,317,572,636`. Physical chase continuity and a viable service zone through the stilt remain open. Omitted connections must continue to surface in the output.

## Structural forensics and independent checks

[Frozen real-model replay](../../../phase6-evidence/replay.mjs) uses the archived source at 1282cda, the [recovered structural system and captured reviewed request](../../../phase6-evidence/historical-input/). The replay explicitly sets seismic zone V to match the historical run. The old binary trapped with memory access out of bounds on 1,296 nodes, 2,877 elements and 6,804 free DOFs. The current binary ran seven cases and thirty combinations per batch. Linear memory grew from 33,554,432 to 88,604,672 bytes and plateaued. All 40 measured external allocations across four batches were freed, including the C++ return buffers. Worst relative residual was 2.85634e-12. This measures the observed calls and heap plateau over four analyses. Build stack configuration and WASM batching, memory view refresh and cleanup are in `packages/structural-engine/scripts/build-awatif-wasm.mjs:57` and `packages/structural-engine/src/wasm/awatif-wasm-bridge.ts:354,383,436`. [Replay output](../../../phase6-evidence/replay-final.log)

The historical maximum 17.705 was on the 660 mm terrace beam BM_floor_terrace_05_218. The old RCC check used absolute transverse displacement (1282cda, `packages/structural-engine/src/rcc/rcc-design-engine.ts:595`). Frozen-model recovery gives 46.7412 mm absolute, 0.04177 mm relative to the end chord and a 2.64 mm allowance. The same section still carries 270.48 kN shear, with shear stress 4.541 versus limiting 3.1 MPa, and a 73.04 versus limiting 51.19 kN·m bending moment. Correcting the displacement reference does not resolve section capacity. Historical counts were 1,281 beam, 36 column, 29 slab, four drift and one foundation finding. [Independent replay](../../../phase6-evidence/historical-check.log)

Historical raft gross bearing can be reproduced as 119214.6/(28.9 × 37.35) + 0.60 × 25 = 125.44 kPa against 100 kPa. The old load sums support extremes from different combinations. Summing concurrent vertical support reactions first gives a peak of 82,270.64 kN. This independently identifies a demand-envelope error. Eccentric bearing, settlement and geotechnical definitions still require review. The current wizard fixture uses different architecture and frame geometry. Its raft reports net peak 68.74 kPa, gross peak 102.04 kPa and software status DESIGNED_VERIFIED. The engineering disposition remains open.

The current wizard generated 422 nodes and 744 elements for 343 physical columns and 371 physical beams. Independent traversal found one owner per analytical element, 49 continuous column stacks and a column at all 742 physical beam ends. The BBS had 1,932 unique marks summing to 200,204.61 kg versus reported 200,204.60 kg. Independent bar area × length × 7,850 kg/m³ gave 200,208.86 kg. This checks aggregation and units, while anchorage, laps and constructible detailing still require review. Current maximum utilization is 206.435 at plinth column COL_C23_L0 (350 × 550 mm, 12-T28). At 4,674.35 kN axial demand versus 4,853.40 kN pure axial capacity, the reported reduced uniaxial moment capacities are only 36.50 and 18.75 kN·m. Independently substituting the displayed rounded values gives (102.52/36.50)² + (264.21/18.75)² = 206.45, consistent with the reported interaction value. Independent validation of that interaction surface remains open. See `packages/structural-engine/src/rcc/rcc-design-engine.ts:429,1370`. The 371 findings comprise 275 beams, 90 columns and six drift findings. Geometry and support connectivity alone cannot establish adequate framing. [Independent topology, quantities and loads](../../../phase6-evidence/independent.log)

Historical DL + SDL was 71,331.90 kN versus 41,520.95 kN on the current fixture. Historical masonry was 26,072.02 versus 8,226.34 kN. Gravity reactions reconcile to the assembled loads, but these two distinct geometry hashes prevent attributing the reduction entirely to an engineering fix. `packages/structural-engine/src/loads/indian-load-assembler.ts:284` uses approximate group load distribution. There is no independent project load take-off demonstrating correct slab tributaries, wall loads, loads at transfers or site soil capacity. No blanket unit-scale defect is evidenced by the gravity, member and bar benchmarks.

For a simply supported 6 m beam, a 48 kN midspan point load gives 24 kN reactions and 72 kN·m peak moment. A 20 kN/m uniform load gives 60 kN and 90 kN·m. The closed-form beam fixture is at `packages/structural-engine/src/__tests__/awatif-frame-benchmarks.test.ts:225`. Closed-form frame, RCC and foundation tests passed. [Structural run](../../../phase6-evidence/structural.log) Native ETABS 23.3.2 generated and reopened two loaded EDBs and returned force, reaction and displacement tables. Both fixtures have a rotated local axis requiring the TypeScript reference solver on the RH side. Maximum gravity displacement difference was under 1.4e-16 mm and reaction difference under 1.06e-10 N. Across lateral and combined cases the maximum differences were 0.005230 mm and 48.252 N. ETABS shell stiffness and the RH frame-only adapter preclude claiming lateral equivalence. The .NET SDK was unavailable; the existing release bridge with matching C# source was used. [Native run and EDB paths](../../../phase6-evidence/native.log) · [Case-by-case comparison](../../../phase6-evidence/compare-native.log)

Real Chromium exercised structural analysis, per-combination WASM identity and equilibrium, CAD and exchange. See `packages/frontend/e2e/rh-gate2-structural-verification.spec.ts:125,157`. Independent IfcOpenShell read the exported IFC4 and counted eight storeys, 343 columns, 371 beams, 760 slabs and 12 stair flights, zero reported slab/stair omissions. DXF, IFC, PDF and browser renders were captured. A graphical BIM authoring application reopen was not tested. [IFC readback](../../../phase6-evidence/ifc.log) · [IFC](../../../phase6-evidence/structural-studio.ifc) · [DXF](../../../phase6-evidence/structural-studio.dxf) · [PDF](../../../phase6-evidence/structural-studio.pdf) · [Chromium capture](../../../phase6-evidence/structural-studio-analysis.png)

## Persistence and scope

`packages/backend/src/services/structural-evaluation-store.ts:23,37,62` writes hashed gzip chunks and an atomic manifest binding project, architectural revision/digest, structural revision, reviewed inputs, analysis options and results. Routes at `packages/backend/src/api/structural-routes.ts:266,332,351` use these IDs. The previous process-local map evicted older evaluations after four entries. The regression covers six concurrent writes, re-opened storage, typed arrays and corruption. The same full captured request survived a backend process restart, with summary SHA-256 bf37e2d3d333247df8ba01435e8dc736fcd9f031f136e671b95269784cdbb78f and full ULS case available. Persistent storage retention, multi-host deployment and long-term serialization migration remain untested. [Restart evidence](../../../phase6-evidence/persist.log)

| Capability | Implementation acceptance | Current boundary |
|---|---|---|
| Exact curved-site building generation | NOT TESTED | Rejected by `packages/geometry-engine/src/survey-generation.ts:58`. Editing and DXF export have separate scope. |
| Nonzero concave setbacks | NOT TESTED | Explicit rejection at `packages/geometry-engine/src/survey-generation.ts:85`; zero-setback concave handling is separate. |
| PDF reconstruction | NOT TESTED | Export and reference attachment have evidence. Dimensioned architectural reconstruction from PDF has none. |
| Redevelopment stacking | NOT TESTED | `packages/frontend/src/services/redevelopment-feasibility.ts:86` provides program feasibility. No proven owner/rehab/sale multi-storey stacking pipeline. |
| Advanced structural methods | NOT TESTED | See `docs/structural/AWATIF_MILESTONE_5_ACCEPTANCE.md:48` for shell/shear-wall, spectrum, second-order/nonlinear and flexible soil-interaction limits. Native fixtures cannot establish those capabilities in RH. |

## Additional evidence

The actual production worker ran the captured request through a local HTTP backend and again with forced HTTP 503. Both accepted the exact same four measured areas. Both rejected a 200,000 ft² mandatory program on a 13,089 ft² site. The service rejected at feasibility, while the offline worker rejected measured mandatory area failures. CAD plot import also checks generationBlockingFindings before returning geometry in `packages/backend/src/routes/cad-import-routes.ts:101`. Connected provider interpretation and full combinatorial parity remain unverified. [Four worker executions](../../../phase6-evidence/parity-exact.log)

Independent inspection of the real stilt room polygons placed the three-flat outlet at (16700, 26000) mm and four-flat outlets at (3300, 14450) and (34700, 14450) mm, all inside “Open-to-sky courtyard at stilt”. The two-flat outlet at (18100, 17300) mm lands in Core Service Shaft 04 and connects. This identifies an architectural shaft-to-stilt coordination defect upstream of the collector path search. [Measured outlet positions and rooms](../../../phase6-evidence/drain.log)

The maximum pure gravity native-to-RH column start axial force discrepancy across both projects was 1.06e-10 N. Managed ETABS bridge DLL SHA-256 was 2cac8f0d37b7b9a76c3b82511bd53ac5a3d4b9ab6bd38821dd66dda455201ea8 and apphost SHA-256 was 52fbac8783aed1fe859eb47de590126e99bc4f6c05ca61548ed43c589aed4381.

The opposed-core acceptance fixture checks two stair enclosures, the court between them, real doors and landings, stair flight coverage and opposite-side lift doors in `packages/backend/src/__tests__/phase5-real-project-acceptance.test.ts:559,571,584,587`. Locked-flat regeneration and control over partition/opening edits are checked in `packages/backend/src/__tests__/phase2-architectural-verification.test.ts:166,191`.

## Source inventory

The following are SHA-256 hashes of on-disk file bytes. The base commit alone identifies only the unmodified starting tree. The test reports and native artifacts are separate from this source overlay.

| File changed or added | SHA-256 |
|---|---|
| `packages/ai-orchestration/src/orchestration/architectural-proposal.ts` | `902bc7e9bed48e30a8effcb7d8bf09b520dbfb40d82be0a3e3d0a4474865349e` |
| `packages/backend/src/__tests__/phase2-architectural-verification.test.ts` | `b358aaed35de169c3ec0409ba998b9645ec7bc62841bbba663eb5eaf6edd6f61` |
| `packages/backend/src/__tests__/structural-evaluation-store.test.ts` | `79d166c0f45163c1fbb0242acef74c628f064562c36759a397d83d2a1dd674fd` |
| `packages/backend/src/api/structural-routes.ts` | `4376b8b88f082e3d1fe09c1061c105ad7a6193c96506c203e8465625e15be026` |
| `packages/backend/src/services/structural-evaluation-store.ts` | `58c7e9cddd18d19a024fd46e0c10b4678deaef46f113f815ef7c42f5361cb444` |
| `packages/frontend/e2e/rh-gate2-structural-verification.spec.ts` | `a542ebabe750b4eecff103b309a0a2f9d56552c520d4377aa0ce55db053c3203` |
| `packages/frontend/e2e/rh-phase51-project-matrix.spec.ts` | `2726b3c61235586b081a9b429490177e441b6d4631efded5ebe41ed68fcc8a85` |
| `packages/frontend/e2e/rh-studio-workflow.spec.ts` | `d4ad0d1fe3ec8df28505dbc7770daad55df5a079887f155b475c85e0dae824ec` |
| `packages/planning-engine/src/apartment/multi-sheet-apartment-solver.ts` | `73a3123d35820779248453190408990bde00d03ebb12657ebd1833a3067520ef` |
| `packages/structural-engine/src/foundation/foundation-design-engine.ts` | `8069f69667f5d90cf51d406898b98d5c06a96494f6d3a37e64e42e2bc8a76b75` |

This matrix is the one added audit document. [Browser fixture evidence](../../../phase6-evidence/exact-mixed/) includes generated requests, screenshots and acceptance JSON.

## Verification runs

* Production build completed 12/12 tasks with forced execution and zero cache hits. Typecheck and lint each exited 0 across all packages that define the corresponding script. [Build](../../../phase6-evidence/final-exact-build.log) · [Types](../../../phase6-evidence/exact-types.log) · [Lint](../../../phase6-evidence/exact-lint.log)
* Integration tests passed 21/21 root and 35/35 backend. [Root](../../../phase6-evidence/exact-integration.log) · [Backend](../../../phase6-evidence/exact-backend-integration.log)
* Full default Chromium repair suite initially passed 24/25. The welcome-exit test timed out awaiting whole-page load. Its fixture intentionally leaves shader completion pending. The test now starts checking the real scene after navigation commits. It still requires positive loaded component count, successful navigation, scene unmount, a visible project form, two animation frames and zero page errors. The final suite passed 25/25 in 4.1 minutes, with the welcome test passing in 2.7 seconds. The shipped showcase code was untouched. [Initial run](../../../phase6-evidence/browser-full.log) · [Final run](../../../phase6-evidence/exact-browser.log)
* Original mixed and strict unequal wizard matrix cases passed 2/2 on the compact-footprint build. [Browser results](../../../phase6-evidence/exact-mixed.log) · [Captured results](../../../phase6-evidence/exact-mixed/)
* Separate real WebGL context-loss/restoration and release check passed 1/1 across floor and tower views. [Browser log](../../../phase6-evidence/webgl.log)
* Actual native dual-project ETABS run passed 1/1. The browser IFC readback and large-model WASM replay were separate independent executions. [Native log](../../../phase6-evidence/native.log) · [Measured artifact digests](../../../phase6-evidence/artifact-sha256.json)
* The other six wizard matrix projects all passed, including exact signed oblique survey vertices, six-flat density, open stilt and a reference attachment. The attachment fixture recorded live provider influence as pending. Across both invocations the eight project matrix cases passed 8/8. [Six additional cases](../../../phase6-evidence/exact-other-projects.log) · [Project artifacts](../../../phase6-evidence/exact-other-projects/)
* The 288-case planning benchmark generated 288 plans with zero exceptions. It used the existing legacy fallback for 88 cases (30.6%). Its assertion counts exercised cases; it does not independently approve the architecture of all 288.
* Final monorepo unit run exited 0. All 24 Turbo tasks succeeded (20 cache hits). Across twelve packages, 1,876 tests passed, 12 were skipped and none failed. The earlier restricted HTTP run had 52 failures; the host rerun and final run supersede it. The backend advisory regression previously required a missed target and now verifies actual individual areas. [Final full unit log](../../../phase6-evidence/exact-unit.log) · [Initial unit log](../../../phase6-evidence/unit.log)

| Package | Passed | Skipped |
|---|---:|---:|
| core | 198 | 0 |
| geometry-engine | 95 | 0 |
| structural-engine | 36 | 0 |
| projection-3d | 31 | 0 |
| renderer | 89 | 0 |
| constraint-engine | 185 | 0 |
| planning-engine | 617 | 0 |
| cota-integration | 5 | 0 |
| openbim-integration | 3 | 0 |
| ai-orchestration | 150 | 2 |
| backend | 279 | 10 |
| frontend | 188 | 0 |

Seven tracked fixtures regenerated by the tests were archived with their directory structure and the original checkout versions reinstated. [Generated test artifacts](../../../phase6-evidence/test-generated/)

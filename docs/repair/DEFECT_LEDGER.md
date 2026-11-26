# Defect ledger

Baseline `1e0d1fefd87e8550b648e1c62732c5e5c7cf24ce`.

| Defect | Reproduction on baseline or unchanged route | Repair and regression |
| --- | --- | --- |
| HTTP access and input validation | Loopback HTTP requests with a foreign browser origin received 200 for project listing and CAD capabilities, 404 for artifact lookup, and reached evaluation, generation and E2K handlers. A malformed project body reached the store and returned 500. A malformed revision was treated as a resource lookup. Eight new trust-boundary assertions failed. | Enforce the loopback/single-operator or private bearer boundary before dispatch, scope CORS to allowlisted origins, validate media type and size, check project/revision IDs and request shapes, and suppress unexpected error details. `http-trust-boundary.test.ts` covers denial, token mode, allowed preflight and malformed requests through real listeners. Existing live export and local-project round-trip tests cover real file responses. |
| Failed generation accepted | Real 42 m by 34 m, one-typical-floor provisional apartment briefs returned HTTP 200 with `validationReport.isValid=false` and `FLOATING_COLUMN`. The unchanged CAD plot route also returned 200 for the irregular DXF rejection fixture. The initial deferred-framing pinwheel diagnostic passed its audit, so it was unsuitable as a rejection fixture. | Block failed geometry, mandatory closure and critical opening findings in the backend routes, worker and editor boundary. `generation-acceptance-repair.test.ts` covers actual passing and failing solver output and a detached door on a real generated Building. The DXF HTTP regression and Chromium rejection test verify the other production boundaries. |
| Worker failures leave loading active | Chromium threw a standard `DataCloneError` when sending a generation message. The error dialog appeared but the CAD action stayed in its loading state. Worker crash/malformed message/timeout branches had no shared terminal cleanup. | A timed worker task has one cleanup/settlement path. Studio ends the busy state on errors and displays retry/close. `worker-task.test.ts`, room solver tests and the Chromium message-send case cover termination and retry state. |
| Regeneration changes project identity and can lose prior design | Chromium observed a freshly allocated UUID in the regeneration request despite a different active project ID. The old full replacement reset editor history. | Intake allocates a project ID, retries reuse it, and each worker attempt allocates a distinct run ID. Regeneration preserves canonical identity and advances revision, archives the prior envelope, and applies an undoable audited snapshot. Chromium checks the actual request and durable before/after data and downloads the older revision after reload. Core verifies exact application and undo/redo. |
| Failed browser save and legacy migration can misreport or lose data | A second migration after an IndexedDB quota failure deleted the legacy key because the mirror contained it. `flush` inferred success from the same mirror. Chromium aborted an actual save transaction and the baseline displayed no retry or warning. | Verify database readback, preserve differing legacy bytes, report the latest save outcome, retry from the engine's current snapshot and preserve the v1 object store during schema upgrade. The repeated migration, Chromium transaction abort/retry, and real v1 database upgrade are regression cases. |
| Verification absent in Actions | `git ls-files .github` returned no workflows. | The verification workflow installs from the frozen lockfile and runs build, typecheck, package tests, monorepo integration and Chromium against production builds. |

## Baseline command evidence

| Command | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Completed for all 10 workspace projects. |
| `pnpm build` | 9/9 tasks, with Vite chunk-size warning. |
| `pnpm test:integration` | 21 passed across 4 files. |
| `pnpm --filter @ai-floor-planner/backend exec vitest run src/__tests__/http-trust-boundary.test.ts src/__tests__/phase1-exports-and-routes.test.ts` | 2 existing tests passed and all 8 new trust-boundary assertions reproduced the defect. |
| `pnpm --filter @ai-floor-planner/frontend exec vitest run src/__tests__/generation-storage-regression.test.ts` | 22 passed and the new repeated-migration regression failed. |
| `pnpm --filter @ai-floor-planner/frontend exec playwright test --config playwright.repair.config.ts` | Both original repair cases failed on baseline production output. A separate run with `-g 'real IndexedDB abort'` also failed on baseline output. |
| `pnpm --filter @ai-floor-planner/backend exec vitest run src/__tests__/rh-local-all-shapes-and-cad-import.test.ts -t 'does not publish failed'` | The unchanged CAD generation path returned 200 instead of 422. Four tests were skipped by the filter. |


## Final disposition

The six repair areas above are covered by the regressions and verification in [the phase handoff](PHASE_HANDOFF.md). Candidate quality failures remain visible as solver or framing findings and require their own diagnosis. Hosted multi-user authorization and native/provider verification are separate remaining gates.

## Phase 2 generation and geometry repairs

| Defect | Reproduced state | Disposition |
| --- | --- | --- |
| A1/A2 provisional columns | Real audit rejected a 42 × 34 m apartment and stilt staff toilet at seed 1. | Cross-floor support hosts and spacing repaired. Preliminary columns remain concept geometry. |
| A3/A4 floor shape and plot feasibility | 32 × 36 m seed 2 produced a 718 mm balcony and rejected candidate. Irregular DXF import also rejected. | Ledger-preserving shape backoff and frontages repaired; the two stack profiles and the DXF now pass the unchanged mandatory gate. |
| A5 openings and circulation | A 1,200 mm stair boundary was selected as a host for a 1,200 mm passage marker with no fitting returns. | Stair-host selection uses the actual opening fit; foyer repair retains doors and windows across wall rebuilds. |
| B1/B2 area allocation and accuracy | Fixed 310.08 m² floor-plate floor and 15% tolerance produced incorrect outcomes. Unequal target dimensions had no effect in the spaced dual-wing row. | Measured area buckets, target-weighted rows, bounded sizing and configurable tolerance. Strict misses are rejected and advisory misses are shown. |
| C1/C2 mandatory brief and unit support | The no-balcony brief still built balconies. CAD and Studio stopped unit selection at four; exhausted searches could reuse rejected variant IDs. | Honor the supported negative balcony brief, validate core and type/count outputs, expose 1–6 counts, and exclude rejected topology candidates. |
| D1/D2 provider attribution | Provider and deterministic interpretation were ambiguous after errors; unvalidated reference responses could supply default spatial hints. | Report Gemini attempt, model and deterministic fallback separately with sanitized errors. Apply only validated attached-image hints. |

See [Phase 2 architectural verification](PHASE2_ARCHITECTURAL_VERIFICATION.md) for exact configurations, measurements, regression files, and limits. Remaining work includes strict per-unit fit for more irregular and mixed layouts, broader final-geometry diversity checks, additional reference-image spatial constraints, and statutory and native structural verification.

## Phase 3 engineering repairs

| Defect | Verified disposition |
| --- | --- |
| Unequal strict carpet targets missed | The seed-1 four-flat fixture changed from 888.19 / 1,610.46 / 983.81 / 1,472.71 sq ft to 703.75 / 1,106.29 / 1,500.71 / 1,900.80 sq ft against the same 2% brief. Target slots and mandatory geometry checks are preserved. |
| An explicit wave could publish as a stepped massing | Preserve and enforce the lock at the acceptance boundary. The original substitute fails with `LOCKED_MASSING_UNREALIZED`. Realized compact massing passes. |
| Repeated or conflicting design inputs | Exclude an identical final architectural geometry and door graph. Reject a prompt that would remove sized schedule slots. |
| Oblique footprint could cross setbacks | The measured envelope is persisted. The rectangle search rounds inwards and finished floor footprints are checked at the audited boundary. |
| Unsafe local edits and duplicate editor history | The apartment editor supports hosted openings and full-edge rectangular internal partitions through the canonical revision store. A 40 mm window edit and a 50 mm partition move were exercised. Locked geometry and other floors were preserved. |
| Duplicate orbit renders | A browser trace measured up to three renders per frame. Coalescing requests reduced the peak to one and the sample from 66 to 31 renders at the same measured draw count. |
| Export trust and default drawing content | GLB downloads verify the expected revision and canonical source digest. Architectural PDF defaults exclude structural overlays. Unsupported Unicode labels raise an explicit error before publishing a drawing. |

See [Phase 3 verification](PHASE3_FINAL_VERIFICATION.md) for inputs, test runs, native evidence and remaining gaps. Phase 4 adapter contracts are recorded in [integration readiness](PHASE4_INTEGRATION_READINESS.md).

## Phase 3.5 release gates

| Defect | Reproduced state | Disposition |
| --- | --- | --- |
| Provider health and late generation response | Health accepted the presence of a key as reachability. The legacy browser gave up after 45 seconds during live provider retries and could switch to its local solver before the backend answered. | Probe Google for credential acceptance. Increase the worker deadline, retain failure codes and display model fallback or local planning in the study. |
| AI guidance could reject a feasible brief | Gemini’s alternate guidance failed the mandatory room and access requirements on a live four-flat request. | Keep the mandatory audit and test the same brief without optional guidance. The verified alternate differed in geometry and respected all four requirements. |
| Limited local editing | Rectangular partitions only. Edits applied immediately, and strict and advisory carpet targets could be conflated during retargeting. | Audited straight partition moves with oblique geometry, fixed returns, hosted-opening checks, area target verification, before/after preview and stale-revision refusal. |
| Localized Unicode labels | Drawing PDFs rejected Indic labels and compliance reports replaced non-ASCII characters. | Embed and shape fonts and preserve searchable logical labels. Independently reopened Marathi, Hindi, Bengali, Gujarati, Tamil and Latin drawing text. |
| Cinematic UI regression checks | Attribution and inspector controls had disappeared, and some selectors used former captions. | Restore attribution, the inspector toggle and the design-review entry point. The browser hotfix below records the extended Studio workflow and WebGL cleanup checks. |
| CAD and IFC adapter review | External source provenance and native reader fidelity remain unverified. | Add isolated outbound contract and manifest checks. External source and license review remain open. |

See [Phase 3.5 verification](PHASE35_RELEASE_GATE_VERIFICATION.md) for results and remaining release gates.


## Phase 3.5 browser hotfix

| Defect | Reproduced state on `fcc7bcc` | Disposition |
| --- | --- | --- |
| WebGL restored with a blank viewport | Real Chromium restored a lost context and the idle on-demand scene rendered zero new frames in five seconds. | Loss cancels scheduled drawing and releases old GPU allocations. Restore requests a frame on the same scene and camera. Verified on Tower and Floor 3D, across two projects and unmount. |
| Massing Studies appeared missing during generation | HTTP 200 preceded worker acceptance, and the gallery assertion expired with the generation dialog still open. | Keep the existing semantic selectors and wait for audited gallery readiness. The workflow validates a physically different alternate and opens it in CAD. |
| Extended workflow did not find the Tower canvas in time | The timeout trace and screenshot contained the Tower workspace and rendered canvas. | Coalesce scene invalidations and wait for a visible canvas with a positive production draw count. |
| pnpm misreported a failed Playwright invocation | The frontend package resolved Playwright 1.65.0. After a child error, Windows pnpm reported `Command "playwright" not found`. | Call the installed Playwright entry point through package scripts. The negative control preserves the actual child error, and CI uses the same commands. |

See [browser hotfix verification](PHASE35_WEBGL_BROWSER_HOTFIX.md) for commands, repeat-cycle observations and remaining gates.

## Phase 4A AI pipeline optimization & Cota CAD integration

| Defect | Reproduced state on `75716dd` | Disposition |
| --- | --- | --- |
| Redundant LLM calls, slow primary quota cascade & missing token telemetry | `generation-routes.ts` retried Gemini up to `3` times per HTTP call when layout score `< 85`; `gemini-3.8-flash` (20 RPD free-tier quota / default thinking overhead) stalled for `29,647 ms` before cascading, sent `maxOutputTokens: 4096` + full vision schema on text-only prompts, and dropped `usageMetadata`. | Removed outer multi-LLM retries (`<= 1` call per unique brief; `0` on cached repeat), split compact text vs vision schemas, set `thinkingBudget: 0` and `750 / 1,100` token caps, cascaded in `0` retries on `HTTP 429` / `5,500 ms` primary timeout, scrubbed secrets via `redactSecret`, and recorded full token/latency provenance (`10,746 ms` live vision+text run, `1,701` total tokens). |
| Silent brief conflicts & non-vision reference attachments | Contradictory prompt clauses (e.g., conflicting unit counts, `no OTS` + `OTS courtyard`, `no balcony` + `balcony`) and PDF/DXF reference metadata lacked structured conflict/disposition reporting; out-of-range `[0..1]` spatial centroids were clamped rather than rejected. | Added `interpretStructuredBriefRequirements`, `BriefRequirementConflict`, `classifyReferenceAttachment` (`VISION_INLINE_ATTACHED` vs `ADVISORY_METADATA_ONLY`), and strict rejection into `referenceGuidanceRejected`. |
| Async disk-project open clobbered active Studio tab | Clicking `Open from Disk` in `ProjectLibrary` and immediately navigating to `Tower 3D` caused `handleOpenDiskProject` in `ArgonStudioShell.tsx` to overwrite `activeWorkspace` back to `'cad_2d'` once the disk fetch resolved, stalling `rh-webgl-recovery.spec.ts`. | Updated `handleOpenDiskProject` to transition `'library' -> 'cad_2d'` only when `activeWorkspace === 'library'`, preserving explicit user navigation. `test:e2e:webgl` passed all 5 restorations and 3 context releases in `37.8s`. |
| Canonical CAD interchange, drafting isolation & controlled AI-CAD writeback | `PHASE4_CAD_BIM_ADAPTER_CONTRACT.md` defined the interface only; no concrete CAD exchange adapter, Cota 2D snapping/drafting kernel, or natural-language canonical CAD edit preview/refusal bridge existed. | Selectively adapted Apache-2.0 pure-TS 2D geometry/OSNAP/drafting logic from Cota v2.49.3 (root `NOTICE` added; zero React 19 / Three r169 / LGPL `occt-wasm` / GPL `LibreDWG` runtime dependencies), implemented `CanonicalDxfExchangeAdapter`, added `proposeControlledCadEdit` + `/api/v1/cad/edit-proposal` (refusing free-form single-flat regeneration to protect neighbouring flats), and shipped lazy-loaded `PrecisionCadWorkbench.tsx`. |

## Phase 4A.1 AI reliability, cache identity, telemetry & cancellation hotfix (`fix/phase4a-ai-reliability`)

| Defect | Reproduced state on `57a1a358` | Disposition |
| --- | --- | --- |
| Defect 1 — Incomplete AI cache identity | `buildProposalCacheKey()` omitted `roadAccessSides`, `setbacksMm`, `irregularPlotBoundary`, `lockedMassingShape`, fallback/provider config fingerprint, reasoning/token budgets, schema digests, and project/auth scope; changing road side `South -> East` falsely returned `cacheHit: true`. | Canonical SHA-256 `buildProposalCacheKey()` covers the complete effective provider request across 7 structured namespaces (never raw keys or raw base64 bytes). Verified across 15 single-dimension mutations in `phase4a1-reliability-repro.test.ts`. |
| Defect 2 — Incorrect `geminiInvoked` telemetry | `architectural-proposal.ts` evaluated `geminiInvoked: !cacheHit \|\| true` (`true` on every cached call) and lacked explicit invocation state tracking. | Added 6-state `invocationMode` (`LIVE_PROVIDER`, `CACHED_PROVIDER_RESPONSE`, `SHARED_IN_FLIGHT_REQUEST`, `DETERMINISTIC_FALLBACK`, `PROVIDER_FAILURE`, `CANCELLED`) and `geminiInvoked: invocationMode === 'LIVE_PROVIDER'` (`false` on cached and shared follower calls). |
| Defect 3 — Incorrect token accounting | Cached and shared follower calls re-reported historical `response.usage` as live token spend; failed upstream calls without `usageMetadata` had no `'UNKNOWN'` distinction. | Separated `currentRequestTokenUsage` (`0` on cache hit / shared follower, `'UNKNOWN'` when failed upstream call omitted `usageMetadata`) from historical `proposalTokenUsage`, plus per-attempt `failedAttempts[]` telemetry. |
| Defect 4 — Universal `thinkingBudget: 0` & model capability mismatch | Every call hard-coded `thinkingBudget: 0`, degrading complex reasoning and causing `HTTP 400 ("Request contains an invalid argument.")` on live `gemini-3.5-flash-lite` / `gemini-flash-lite-latest`. | Implemented `selectArchitecturalReasoningMode` (`FAST` / `BALANCED` / `DEEP`), `inspectModelThinkingCapabilities` (omitting `thinkingConfig` when `0` is unsupported on Lite models; clamping `>= 128` on `-pro`), and bounded 1-retry recovery for `UNSUPPORTED_THINKING_CONFIG` and `MAX_TOKENS` truncation. |
| Defect 5 — Narrow GitHub Actions branch coverage & missing lint | `.github/workflows/verification.yml` triggered only on `main` and `repair/**` and omitted `pnpm lint`. | Expanded triggers to `main`, `repair/**`, `fix/**`, `feat/**`, `feature/**`, PRs, and `workflow_dispatch`; added `pnpm lint`, parallel `planning-benchmark` job, `GEMINI_API_KEY: ''`, `contents: read`, and separate `.github/workflows/opt-in-live-verification.yml`. |
| Defect 6 — Unbounded cascade latency, missing quota cooldowns & non-propagating cancellation | 5 slow fallback models with `timeoutMs: 320` ran for `933 ms`; `server.ts` hard-clamped `timeoutMs` to `15s` with `maxRetriesOn503: 1` & `maxTotalAttempts: 4`; project-wide `429` retried fallback models; client disconnects still ran geometry synthesis. | Enforced single `deadlineAt` overall deadline (`24s` default), configurable `maxTotalAttempts`, per-model `429`/`503`/`TIMEOUT`/`404` cooldowns, immediate halt on `PROJECT_QUOTA_EXHAUSTED` or `401/403`, and end-to-end `AbortController` propagation (`HTTP 499 REQUEST_CANCELLED` before `executeAuditedPlanningPipeline` + worker `{ type: 'cancel' }`). |
| Defect 7 — Insertion-order `Map` eviction & shared in-flight cancellation bleed | `providerResponseCache` evicted oldest inserted entry rather than LRU; aborting Consumer A aborted Consumer B's shared `inFlightStore` request (`resB` degraded to `DETERMINISTIC`). | Implemented recency-refreshing `BoundedLruCache` (configurable `maxEntries` & `ttlMs`, TTL pruning, invalidation) and `InFlightRequestDeduplicator` with subscriber-isolated `upstreamController` (upstream aborts only when all subscribers cancel; `bypassCache` isolated; stale age guard). |

## Phase 4B IFC and BIM

| Finding | Evidence and disposition |
| --- | --- |
| IFC exchange had no IFC4 writer | The revision-bound adapter writes and reads physical architecture, openings and spatial containment. Eleven generated and edited fixtures passed IfcOpenShell readback. Unsupported geometry is enumerated in the manifest. |
| Reference input needed a canonical isolation boundary | The IFC4 worker validates size, encoding, syntax and supported relationships. References preserve source IDs and read-only placement and apply explicit alignment. Tests reject malformed STEP, unsupported schema, duplicate IDs, dangling references and oversized input. |
| Coordination counted off-storey profiles against its work limit | The desktop full-building reference hit the pair budget. Storey and bounds filtering now precede expensive collision checks in the worker. The production browser completed the same file and the numerical test measured exact hard intersection while excluding the opening and touching faces. |
| Windows preview encountered runtime dependency locks | Vite preview tried to load the build-time PostCSS configuration before serving immutable compiled assets. Preview now skips those plugins and retains the API proxy. |

See [Phase 4B acceptance](../integration/PHASE4B_ACCEPTANCE.md) for the remaining native application, Advanced BIM and professional gates.

## Phase 5 source review

| Defect | Evidence and disposition |
| --- | --- |
| D01 and D02, entity fallback | Reproduced unsafe targets. CAD resolution requires an unambiguous floor, flat, room and opening. An unavailable opening is refused. |
| D03 and D04, local protection | Reproduced undetected protected wall and window metadata changes. Graph checks now include complete protected records. Edits preserve existing opening flags outside their scope. Connected group regeneration stays within the requested group. |
| D05, slab cutouts | Reproduced 52 m² where the clipped union yields 64 m². BIM schedules, IFC and interactive 3D use the actual planar difference. |
| D06, stale saves | Reproduced competing HTTP 200 responses and an unpublished revision accessible by number. The backend compares persisted revision and digest, returns 409 on conflicting writes and gates reads on the published manifest. |
| D07, CAD input validation | Reproduced eight malformed request shapes accepted as HTTP 200. The route validates canonical building, floor, locks, revision, digest, dimensions and edit intent. |
| D08 and D09, proposals and briefs | Reproduced caching of a malformed proposal and loss of text after character 4,000. The provider receives the accepted full brief and only normalized valid proposals enter the LRU. |
| D10, clash coverage | Checked pairs, out-of-storey geometry, excluded scope, invalid or unsupported inputs and open findings are enumerated. |
| D11 and D12, IFC and BIM coverage | Bounded reference representations and typed schedule queries are implemented. General Boolean, mapped and mesh federation, native viewer reopen, BCF and unrestricted semantic interpretation remain outside the verified workflow. |

The continuation reproduced two additional scope defects. The BIM API selected the first storey for an unknown requested floor, and the BIM schedule returned the full active-floor door list for an unknown requested flat. Regression tests exercise refusal before provider invocation and a zero-result diagnostic in the browser query service. An impossible required carpet total previously reached the solver and surfaced a missing entrance ahead of the area conflict. The generation API now returns the exact plot upper-bound conflict and measurable alternatives before interpretation or solving when the required lower bound already exceeds the entire rectangular site.

Phase 5.1 reproduced exact-survey refusal, irregular-plot allocation far above requested carpet and a strict alternative that failed the 3% gate. The repairs preserve measured site geometry, use final carpet areas for target fitting, and search a bounded seed window under the original constraints. The Windows harness now isolates its disk store and scopes archive selection by persistent project ID. [Phase 5.1 acceptance](../integration/PHASE5_1_FINAL_ACCEPTANCE.md)

Architectural and MEP coordination was reproduced on the strict and six-flat studies. The nearest core spaces labeled “MEP / Plumbing Duct” were 8.5–19.8 m from the bathroom edges while schematic pipe routes connected to wet-room corner stacks. New plans label those core spaces as service shafts. The opt-in wet-wall layout reserves bathroom chases and uses those coordinates for the schematic stacks. Alignment, opening clearance and plan rendering are regression-tested. Coverage of every bathroom across arbitrary briefs and detailed collector coordination remain open. [Measured browser review](../integration/PHASE5_FULL_BROWSER_MATRIX.md)

The original four-flat fixture placed both stair and lift pairs within the upper portion of the longitudinal spine. The second roof stair's hosted door pointed into the tank zone and its opening marker was stale. The coordinated four-flat variant places the pairs opposite each other around a central court, opens both stair landings to the connected cross-corridors, and provides a dedicated roof vestibule at both exits. The first split candidate reproduced a 1,170 mm clear sit-out depth against the existing 1,200 mm threshold. The L-shaped public-room layout now includes the existing wall-centreline allowance when sizing the gallery. [Measured browser review](../integration/PHASE5_FULL_BROWSER_MATRIX.md)

## Phase 5.2

Phase 5.2 reproduced a stale-audit acceptance gap by shifting an architectural riser on the second residential storey by 50 mm. The shared contract now measures riser geometry and blocks mismatches during generation and controlled edits. Missing optional reservations remain named warnings. The taller split-core fixture reproduced a nominal 2,350 mm passage with only 2,160 mm clear. Sizing includes wall allowances and acceptance measures the specified clear passage width. [Release evidence](../integration/PHASE5_2_RELEASE_CANDIDATE.md)

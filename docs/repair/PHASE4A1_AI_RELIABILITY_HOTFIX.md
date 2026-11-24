# RH Planner — Phase 4A.1: AI Intelligence, Cache, Telemetry & Pipeline Reliability Hotfix

- **Branch:** `fix/phase4a-ai-reliability` (branched from verified Phase 4A commit `57a1a358af0b15886b44bd6be1efe64ae8ee16f9`)
- **Gate Status:** `INTERNAL ENGINEERING GATE PASSED` · `PROFESSIONAL REVIEW REQUIRED` (statutory UDCPR / structural PE sign-off)
- **Security Guarantee:** Zero API keys, `.env` contents, bearer tokens, or raw base64 reference images appear in source control, frontend bundles, error payloads, or documentation.

---

## 1. Executive Summary

Phase 4A.1 resolves all seven independently identified AI reliability, caching, telemetry, reasoning, CI, deadline/cooldown, and concurrency defects on top of the Phase 4A Cota CAD + AI optimization baseline (`57a1a358`):

1. **Defect 1 — Complete SHA-256 Cache Identity:** Replaced partial config serialization in `buildProposalCacheKey()` with canonical SHA-256 hashing over all 7 effective request namespaces (including `roadAccessSides`, `setbacksMm`, `irregularPlotBoundary`, `lockedMassingShape`, provider/fallback config fingerprint, schema digests, reasoning/token budgets, and `projectId` / hashed `authContextDigest`).
2. **Defect 2 — Exact Invocation Mode Telemetry:** Fixed `geminiInvoked: !cacheHit || true` (always `true`) and introduced 6 explicit `invocationMode` states (`LIVE_PROVIDER`, `CACHED_PROVIDER_RESPONSE`, `SHARED_IN_FLIGHT_REQUEST`, `DETERMINISTIC_FALLBACK`, `PROVIDER_FAILURE`, `CANCELLED`).
3. **Defect 3 — Dual Token Accounting & `'UNKNOWN'` Failed Usage:** Separated `currentRequestTokenUsage` (`0` on cache hit / shared follower; `'UNKNOWN'` when failed HTTP attempts omit `usageMetadata`) from historical `proposalTokenUsage`, plus `failedAttempts[]` diagnostics.
4. **Defect 4 — Capability-Aware Adaptive Reasoning (`FAST` / `BALANCED` / `DEEP`):** Replaced universal `thinkingBudget: 0` with task-complexity classification, per-model capability checks (`inspectModelThinkingCapabilities` — including omitting `thinkingConfig` in `FAST` mode on `gemini-3.5-flash-lite` / `gemini-flash-lite-latest` which reject `0` with `HTTP 400`, and clamping `>= 128` on `-pro` models), and bounded 1-retry recovery for `UNSUPPORTED_THINKING_CONFIG` and `MAX_TOKENS` truncation.
5. **Defect 5 — Comprehensive GitHub Actions Verification:** Expanded `.github/workflows/verification.yml` to run on `main`, `repair/**`, `fix/**`, `feat/**`, `feature/**`, PRs, and `workflow_dispatch`, adding `pnpm lint`, parallel `planning-benchmark`, `GEMINI_API_KEY: ''`, `permissions: contents: read`, and a separate manual `.github/workflows/opt-in-live-verification.yml`.
6. **Defect 6 — Single Provider Deadline, Quota Cooldowns & End-to-End Cancellation:** Removed `server.ts`'s `15s` hard clamp and `maxRetriesOn503: 1` bottleneck; enforced a single configurable `totalDeadlineMs` (`24,000 ms` default) and `maxTotalAttempts`, per-model `429`/`503`/`TIMEOUT`/`404` cooldowns, immediate halt on project-wide `429` or `401/403` auth errors, and end-to-end `AbortController` propagation (`HTTP 499 REQUEST_CANCELLED` before geometry synthesis + worker `{ type: 'cancel' }`).
7. **Defect 7 — Genuine `BoundedLruCache` & Isolated `InFlightRequestDeduplicator`:** Replaced insertion-order `Map` eviction with recency-refreshing LRU + TTL expiration, and isolated subscriber cancellation so aborting Consumer A never cancels Consumer B's shared upstream HTTP call unless all subscribers cancel.

---

## 2. Seven Defects — Reproduction, Root Cause, Fix & Regression Evidence

| ID | Baseline Reproduction (`57a1a358`) | Root Cause | Repair Implementation | Regression Test Evidence |
| --- | --- | --- | --- | --- |
| **D1** | Mutating `roadAccessSides` from `[South]` to `[East]` returned `cacheHit: true` and reused the South-road proposal. | `buildProposalCacheKey()` omitted road orientation, setbacks, irregular boundary, fallback list, budgets, schema digest, and auth/project scope. | Canonical JSON (`canonicalJsonStringify`) + SHA-256 over all 7 effective request namespaces in `architectural-proposal.ts`. | `phase4a1-reliability-repro.test.ts` (15 pairwise mutations produce 15 distinct keys; key-order permutation produces identical key). |
| **D2** | Cached repeat call reported `geminiInvoked: true` and `invocationMode: undefined`. | Boolean bug `!cacheHit \|\| true` unconditionally evaluated to `true`. | `geminiInvoked: invocationMode === 'LIVE_PROVIDER'` + 6-state `AIInvocationMode` across `core`, `ai-orchestration`, and `backend`. | `phase4a1-reliability-repro.test.ts` (verifies all 6 `invocationMode` states). |
| **D3** | Cached repeat and shared follower calls re-reported `440` historical tokens as live spend; `HTTP 500` error without `usageMetadata` reported `undefined` instead of `'UNKNOWN'`. | Single `tokenUsage` field conflated historical proposal cost with per-request spend. | Added `currentRequestTokenUsage` (`0` on cache/follower; `'UNKNOWN'` on unreported failure), `proposalTokenUsage`, and `failedAttempts[]`. | `phase4a1-reliability-repro.test.ts` & `phase4a1-benchmark-and-reliability.test.ts` (Scenarios 9, 10, 12). |
| **D4** | Complex unequal-carpet/irregular brief forced `thinkingBudget: 0`; live `gemini-3.5-flash-lite` returned `HTTP 400 ("Request contains an invalid argument.")` on `thinkingBudget: 0`. | Hard-coded `thinkingBudget: 0` ignored task complexity and model family capabilities. | Added `reasoning-policy.ts` (`FAST`/`BALANCED`/`DEEP`, `inspectModelThinkingCapabilities`) + bounded 1-retry recovery in `gemini.ts`. | `phase4a1-reliability-repro.test.ts`, `phase4a1-benchmark-and-reliability.test.ts`, and live `phase4a-ai-pipeline-verification.test.ts`. |
| **D5** | Pushing `fix/**` or `feat/**` did not trigger CI, and `verification.yml` skipped `pnpm lint` and `288`-case benchmark. | Narrow `branches: [main, 'repair/**']` trigger and incomplete step list. | Updated `.github/workflows/verification.yml` + added `.github/workflows/opt-in-live-verification.yml`. | `phase4a1-reliability-repro.test.ts` (workflow YAML contract assertions) + remote branch push check. |
| **D6** | 5 slow fallback models with `timeoutMs: 320` ran for `933 ms`; project-wide `429` cascaded across fallback models; cancelled HTTP requests still ran multi-second geometry synthesis. | Per-attempt timeout instead of total deadline; no project-vs-model `429` distinction; no `AbortSignal` check before solver. | Single `deadlineAt` (`24s` default), `maxTotalAttempts`, `isProjectWideQuotaError`, `modelCooldownUntil`, `server.ts` disconnect abort, `HTTP 499` pre-solver exit, worker cancel handler. | `phase4a1-reliability-repro.test.ts` (`< 550 ms` deadline, cooldown skip, 1-call project-429 & 403 halts) + `phase4a1-benchmark-and-reliability.test.ts` (`< 400 ms` `HTTP 499` abort). |
| **D7** | Accessing key `'A'` before inserting `'D'` (`maxEntries: 3`) evicted `'A'` instead of LRU `'B'`; aborting Consumer A killed Consumer B's shared request (`DETERMINISTIC` degradation). | Plain `Map` lacked recency re-insertion on `get()`; `inFlightStore` passed Consumer A's `AbortSignal` directly to upstream fetch. | `BoundedLruCache` (recency refresh + TTL) & `InFlightRequestDeduplicator` (dedicated `upstreamController` + subscriber set + `bypassCache` isolation). | `phase4a1-reliability-repro.test.ts` (LRU order, TTL expiry, Consumer A abort while Consumer B + bypass succeed, all-subscriber abort). |

---

## 3. 12-Scenario Benchmark Matrix (`phase4a1-benchmark-and-reliability.test.ts`)

| # | Scenario | Reasoning Mode | `invocationMode` | API Calls | `currentRequestTokenUsage` | Thought Tokens | Cache Hit | AI Stage (`ms`) | Solver Stage (`ms`) | Total (`ms`) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Basic uniform 2BHK residential | `FAST` | `LIVE_PROVIDER` | `1` | `505` | `0` | `false` | `38` | `1,952` | `1,992` |
| 2 | Four unequal strict carpet targets (`700/1100/1500/1900 sq ft`) | `DEEP` | `LIVE_PROVIDER` | `1` | `601` | `96` | `false` | `25` | `3,072` | `3,097` |
| 3 | Mixed-BHK (`2BHK + 3BHK`) | `BALANCED` | `LIVE_PROVIDER` | `1` | `601` | `96` | `false` | `22` | `6,693` | `6,716` |
| 4 | Irregular surveyed polygon plot | `DEEP` | `LIVE_PROVIDER` | `1` | `601` | `96` | `false` | `29` | `1,094` | `1,125` |
| 5 | Changed road orientation (`South -> East`) | `BALANCED` | `LIVE_PROVIDER` | `1` | `601` | `96` | **`false`** | `21` | `5,577` | `5,598` |
| 6 | Complex mandatory constraints (`NO OTS`, centered, `1` lift, `2` stairs, no balconies) | `DEEP` | `LIVE_PROVIDER` | `1` | `601` | `96` | `false` | `30` | `1,032` | `1,063` |
| 7 | Multimodal reference-image vision (`VISION_INLINE_ATTACHED`) | `BALANCED` | `LIVE_PROVIDER` | `1` | `1,241` | `96` | `false` | `21` | `1,047` | `1,070` |
| 8 | Controlled AI CAD window resize (`PREVIEW_READY`) | `FAST` | `LIVE_PROVIDER` | `1` | `182` | `0` | `false` | `602` | `0` | `602` |
| 9 | Repeated cached request (Scenario 3 repeat) | `BALANCED` | **`CACHED_PROVIDER_RESPONSE`** | **`0`** | **`0`** | **`0`** | **`true`** | **`1`** | `6,133` | `6,135` |
| 10 | Concurrent identical follower | `FAST` | **`SHARED_IN_FLIGHT_REQUEST`** | **`0`** | **`0`** | **`0`** | `false` | `25` | — | `25` |
| 11 | Per-model `HTTP 429` primary -> immediate fallback + cooldown | `FAST` | `LIVE_PROVIDER` | `2` | `450` | `0` | `false` | `9` | `1,217` | `1,226` |
| 12 | Complete provider `HTTP 503` outage -> deterministic fallback | `FAST` | **`PROVIDER_FAILURE`** | `2` | **`'UNKNOWN'`** | **`'UNKNOWN'`** | `false` | `6` | `1,142` | `1,148` |

### Live Gemini Multimodal End-to-End Verification (`RUN_LIVE_AI_TESTS=1`)
- **Phase 4A Baseline (`57a1a358`):** `10,746 ms` AI latency (`1,701` tokens), `20,472 ms` CAD-ready, `21,931 ms` 3D-ready.
- **Phase 4A.1 Hotfix (`fix/phase4a-ai-reliability`):** **`5,581 ms`** AI latency (`gemini-3.8-flash` `503` → `gemini-3.1-flash-lite` `503` → `gemini-3.5-flash-lite` `200 OK`, `3` total HTTP calls with `0` wasted retries on `503` models, **`1,576` total tokens**: `1,337` prompt + `239` completion), **`12,693 ms`** CAD-ready (**38.0% faster**), **`13,772 ms`** 3D-ready (**37.2% faster**), `influencedGeometry: true`, and **`0 ms` / `0` API calls / `0` tokens** on immediate cached repeat.

---

## 4. Full Baseline Preservation & Verification Counts

- `pnpm build`: **9/9 tasks passed** (`server.cjs` and frontend production chunks refreshed).
- `pnpm typecheck`: **16/16 tasks passed**.
- `pnpm lint`: **16/16 tasks passed**.
- **Workspace Package Unit Suites (`1,756` passed, `0` failed; `+2` opt-in live Gemini tests also passed):**
  - `@ai-floor-planner/core`: **198 passed** (`24` files)
  - `@ai-floor-planner/geometry-engine`: **95 passed** (`6` files)
  - `@ai-floor-planner/projection-3d`: **31 passed** (`5` files)
  - `@ai-floor-planner/ai-orchestration`: **149 passed** (`12` files)
  - `@ai-floor-planner/renderer`: **89 passed** (`8` files)
  - `@ai-floor-planner/constraint-engine`: **185 passed** (`31` files)
  - `@ai-floor-planner/backend`: **235 passed** (`37` files; `+2` live Gemini opt-in verified; native AutoCAD 2021 `accoreconsole.exe` `12/12` zero-error audits)
  - `@ai-floor-planner/frontend`: **181 passed** (`35` files)
  - `@ai-floor-planner/planning-engine`: **593 passed** (`76` files, including **`288/288`** `phase0-generation-benchmark.test.ts` plans with `0` crashes in `319.7s`)
- **Integration Suites:** **52/52 passed** (`21` monorepo integration + `31` backend HTTP integration).
- **Chromium E2E (`test:e2e:repair`):** **16/16 passed** (`maxPerFrame: 1` orbit render budget, desktop & mobile Precision CAD Studio, AI CAD edit, Undo/Redo, exports, IndexedDB v1→v2 upgrade).
- **Chromium WebGL Context Recovery (`test:e2e:webgl`):** **1/1 passed** (`5` real context restorations + `3` unmount releases).

---

## 5. Remaining Limitations & Phase 4B Readiness

- **Remaining Limitations:**
  1. In-memory `BoundedLruCache` and per-model cooldown maps live per Node.js process (sufficient for local single-operator and single-instance private deployments; horizontally scaled multi-replica deployments would require shared Redis/distributed cache state).
  2. Provider token counters come from upstream `usageMetadata`; exact cloud invoice charges require Google Cloud Billing export reconciliation.
  3. Synchronous inner loops inside `planning-engine` geometry solving check cancellation at stage boundaries rather than mid-polygon-boolean micro-steps, though cancelled HTTP requests exit with `HTTP 499` before entering `executeAuditedPlanningPipeline` and never publish obsolete results.
  4. Statutory municipal submission (UDCPR 2020 / NBC 2016) and structural engineering sign-off remain `PROFESSIONAL REVIEW REQUIRED`.
- **Phase 4B (OpenBIMStudio / IFC) Readiness:** **CONDITIONAL** — all Phase 4A and Phase 4A.1 AI, cache, telemetry, cancellation, Cota 2D CAD, 3D, WebGL, and native CAD gates are green (`INTERNAL ENGINEERING GATE PASSED`); Phase 4B may proceed once the OpenBIMStudio source archive provenance/license audit and native IFC4 spatial hierarchy readback gate are executed.

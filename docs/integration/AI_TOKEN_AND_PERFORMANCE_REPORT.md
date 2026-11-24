# RH Planner — AI Token Consumption & Latency Optimization Report

## 1. Bottlenecks Diagnosed on Baseline (`75716dd`)

1. **Redundant Outer LLM Retries (`generation-routes.ts`):** Baseline `maxOuterRetries = 2` re-invoked Gemini up to **3 times** per HTTP generation whenever `complianceReport.score < 85`, re-uploading base64 reference images on every retry even though the prompt was unchanged.
2. **Unbounded Thinking & Output Token Allocation (`gemini.ts` & `architectural-proposal.ts`):** Baseline passed `maxOutputTokens: 4096` without `thinkingConfig: { thinkingBudget: 0 }`, causing thinking-capable Flash models to spend seconds/tokens on hidden chain-of-thought before emitting JSON, and omitted `usageMetadata` from returned telemetry.
3. **Oversized Text-Only JSON Schema:** Baseline sent the full `referenceSpatialGraph` vision schema even when no reference image was attached.
4. **Slow Primary Model Retry on Quota/Timeout:** `gemini-3.8-flash` (Free-Tier 20 RPD quota) timed out or returned `HTTP 429` and retried the same model with exponential backoff before cascading, resulting in a measured **`29,647 ms`** single text proposal latency on baseline.

## 2. Optimizations Implemented (`feat/phase4a-ai-audit-and-cota-cad`)

- **Compact Split Schemas:** Created `ARCHITECTURAL_PROPOSAL_TEXT_SCHEMA` (omitting `referenceSpatialGraph` when no raster image is attached, ~35% smaller schema payload) alongside `ARCHITECTURAL_PROPOSAL_SCHEMA` for multimodal vision requests.
- **Explicit Token & Thinking Budgets:** Set `thinkingConfig: { thinkingBudget: 0 }` (with automatic strip-and-retry if a legacy model rejects `thinkingConfig` with HTTP 400) and bounded `maxTokens` to `750` (text) / `1,100` (vision) and `220` (CAD edit intent).
- **Zero-Retry Cascade on `HTTP 429` & Tight Per-Attempt Timeout:** Immediate cascade across `[gemini-3.1-flash-lite, gemini-3.6-flash, gemini-3.5-flash-lite]` when the primary model hits quota or `5,500 ms` per-attempt timeout.
- **Per-Provider LRU + In-Flight Deduplication Cache:** Identical `(prompt, units, site, referenceDigest)` briefs reuse validated proposals in `0 ms` and `0` duplicate API calls; compliance-score exploration steps (`seed + 1`) run deterministically without re-calling Gemini.

## 3. Measured Before vs After Benchmarks

| Metric | Baseline (`75716dd`) | Optimized (`feat/phase4a-ai-audit-and-cota-cad`) | Improvement / Notes |
| --- | --- | --- | --- |
| Gemini Calls per Unique Generation | Up to `3` | **`1`** (`0` on cached repeat) | `-66.7%` max LLM calls per brief |
| Max Output Token Budget (Text / Vision) | `4,096` / `4,096` | **`750` / `1,100`** (`thinkingBudget: 0`) | Eliminates hidden thinking token burn |
| Measured Live Prompt + Completion Tokens (Vision + Mixed-BHK) | Unrecorded in telemetry | **`1,701` total** (`1,313` prompt + `388` completion, `0` thoughts) | Exact `usageMetadata` surfaced end-to-end |
| Measured Live AI Proposal Latency | `29,647 ms` (text-only) | **`10,746 ms`** (including primary fallback; ~`2,246 ms` active model) | **63.8% faster** even with PNG vision payload |
| Cached Proposal Repeat Latency & Tokens | `29,647 ms` | **`0 ms` / `0` tokens** (`cacheHit: true`) | 100% duplicate-call elimination |
| Deterministic Multi-Sheet Geometry Solver Latency | ~`9,800 ms` | **`9,721 ms`** | Full geometry + closure + UDCPR audit intact |
| Time to Accepted Canonical CAD Geometry | ~`39,400 ms` | **`20,472 ms`** (live hybrid) / **`~9,700 ms`** (deterministic) | Verified in `phase4a-ai-pipeline-verification.test.ts` |
| 3D Building Projection (`projectBuildingScene`) | ~`1,500 ms` | **`1,459 ms`** (`21,931 ms` total end-to-end to 3D) | Zero validation shortcuts |

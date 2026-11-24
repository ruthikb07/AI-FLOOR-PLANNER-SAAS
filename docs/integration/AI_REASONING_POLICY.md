# RH Planner — Adaptive AI Reasoning & Model Capability Policy

> **Security & Honesty Policy:** Zero API keys, `.env` values, or unverified billing figures appear in this document. Token metrics come directly from Google Generative Language `usageMetadata` and deterministic benchmark telemetry.

---

## 1. Why Universal `thinkingBudget: 0` Was Replaced

Phase 4A initially hard-coded `thinkingConfig: { thinkingBudget: 0 }` across every `GeminiProvider` request. While disabling chain-of-thought reduced latency on simple prompts, empirical verification in Phase 4A.1 exposed two architectural and API compatibility defects:

1. **Complex Spatial & Multi-Constraint Reasoning Degradation:** Irregular surveyed plots, strict unequal per-flat carpet schedules (e.g. `700 / 1,100 / 1,500 / 1,900 sq ft`), and contradictory architectural clauses (`NO OTS` + `central courtyard`) benefit from bounded internal reasoning before emitting strict JSON.
2. **Model Capability Mismatch (`HTTP 400`):** Not all models accept `thinkingConfig` or `thinkingBudget: 0`:
   - Legacy Gemini (`gemini-1.5-*`, `gemini-2.0-*`) and non-Gemini families reject `thinkingConfig` outright (`Unknown name "thinkingConfig"`).
   - Dedicated reasoning / `-pro` models require positive budgets (`>= 128`) and reject `0`.
   - Live endpoint verification confirmed that `gemini-3.5-flash-lite` and `gemini-flash-lite-latest` reject `thinkingBudget: 0` with `HTTP 400 ("Request contains an invalid argument.")`, while succeeding in `~1.18s` when `thinkingConfig` is omitted (`FAST`) or given a positive budget (`512` in `DEEP`).

---

## 2. Three-Tier Application Reasoning Policy (`packages/ai-orchestration/src/orchestration/reasoning-policy.ts`)

`selectArchitecturalReasoningMode(config, seed, hasReferenceImage, overrideMode)` classifies every request into one of three deterministic modes (overridable via request `reasoningMode` or `AI_REASONING_MODE` env var):

| Reasoning Mode | Trigger Conditions | Target `thinkingBudget` | Base `maxOutputTokens` (Text / Vision / CAD Edit) | Primary Use Cases |
| --- | --- | --- | --- | --- |
| **`FAST`** | Uniform residential program (`<= 4` flats/floor, single BHK type), short unambiguous prompt, no raster reference image, `seed === 1`, or controlled CAD edit intent (`POST /api/v1/cad/edit-proposal`) | **`0`** *(or `thinkingConfig` omitted on Lite models that reject `0`; clamped to `128` on `-pro`)* | **`650` / `950` / `240`** | Simple residential extraction, natural-language window/door/partition CAD edits |
| **`BALANCED`** | Multimodal raster reference image attached (`VISION_INLINE_ATTACHED`), mixed-BHK unit mix (e.g. `2BHK + 3BHK`), alternate exploration (`seed > 1` or `autoExploreNovelShape`), or `>= 2` architectural/Vastu directives | **`192`** | **`850` / `1,150`** *(+ `96` output headroom)* | Multimodal sketch interpretation, mixed-unit floor plates, Vastu preference balancing |
| **`DEEP`** | Irregular surveyed plot polygon (`irregularPlotBoundary`), unequal per-unit `targetCarpetSqFt`, `requireAreaTargets: true`, contradictory prompt directives, `5–6` flats/floor, or dense multi-constraint brief (`>= 180` chars & `>= 3` directives) | **`512`** | **`1,100` / `1,450`** *(+ `256` output headroom)* | Strict unequal carpet schedules, irregular sites, conflict resolution, high-density plates |

---

## 3. Model Capability Matrix (`inspectModelThinkingCapabilities`)

| Model Family / Identifier | `supportsThinkingConfig` | `supportsZeroThinking` | `FAST` Payload Behavior | `BALANCED` / `DEEP` Payload Behavior |
| --- | --- | --- | --- | --- |
| `gemini-2.5-flash`, `gemini-3.6-flash`, `gemini-3.8-flash` | `true` | `true` | Sends `thinkingConfig: { thinkingBudget: 0 }` | Sends `thinkingBudget: 192` / `512` |
| `gemini-3.5-flash-lite*`, `gemini-flash-lite-latest` | `true` | `false` (`omitThinkingWhenZero: true`) | Omits `thinkingConfig` (avoids `HTTP 400`) | Sends `thinkingBudget: 192` / `512` |
| `*-pro*`, `*thinking*` (`gemini-2.5-pro`, `gemini-3.1-pro-preview`) | `true` | `false` | Clamps to `minThinkingBudget: 128` | Sends `thinkingBudget: 192` / `512` |
| `gemini-1.*`, `gemini-2.0*`, `gpt-*`, `o1-*`, `o3-*`, `claude-*` | `false` | `false` | Omits `thinkingConfig` | Omits `thinkingConfig` |
| Runtime-discovered unsupported model (`recordModelUnsupportedThinking`) | `false` (cached in process) | `false` | Omits `thinkingConfig` on retry & subsequent calls | Omits `thinkingConfig` |

---

## 4. Bounded Truncation & Parameter Recovery (`packages/ai-orchestration/src/providers/gemini.ts`)

`GeminiProvider` enforces strict single-retry recovery rules inside the overall provider deadline (`totalDeadlineMs`) and `maxTotalAttempts` cap:

1. **Unsupported `thinkingConfig` (`UNSUPPORTED_THINKING_CONFIG`):**
   - If a model returns `HTTP 400` mentioning `thinkingConfig`, `thinkingBudget`, or `"Request contains an invalid argument"` while `thinkingConfig` was attached, `GeminiProvider` calls `recordModelUnsupportedThinking(model)`, strips `thinkingConfig`, and retries **at most once** if attempt and deadline budgets remain.
2. **Output Token Exhaustion / Truncated Structured JSON (`OUTPUT_TOKEN_EXHAUSTED` / `TRUNCATED_OR_INVALID_STRUCTURED_OUTPUT`):**
   - `extractOutputAndFinishReason()` inspects `candidates[0].finishReason`. When `finishReason === 'MAX_TOKENS'`, heuristic bracket-closing repair is disabled and required schema keys are verified so silently truncated proposals are never accepted.
   - On `MAX_TOKENS` or truncated JSON, `GeminiProvider` expands `maxOutputTokens` by `+500` (capped at `2,048`) and reduces `thinkingBudget` to `0` (when supported) for **at most one bounded retry** before cascading or falling back deterministically.

---

## 5. Measured Side-by-Side Mode Benchmark

### A. Controlled Identical-Fixture Comparison (`phase4a1-benchmark-and-reliability.test.ts`)

Fixture: `42 m × 34 m` `G+1` apartment, strict `2%` unequal per-flat carpet targets (`700 / 1,100 / 1,500 / 1,900 sq ft`), Vastu SE kitchen & SW master bedroom brief.

| Mode | Applied `thinkingBudget` | Prompt Tokens | Output Tokens | Thought Tokens | Total Tokens | Retries | Failure Rate | End-to-End Time (`totalMs`) | Accepted Layout & Compliance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **`FAST`** | `0` | `340` | `165` | `0` | **`505`** | `0` | `0%` | `2,524 ms` | `isValid: true` (`score: 100`) |
| **`BALANCED`** | `192` | `340` | `165` | `96` | **`601`** | `0` | `0%` | `2,462 ms` | `isValid: true` (`score: 100`) |
| **`DEEP`** | `512` | `340` | `165` | `96` | **`601`** | `0` | `0%` | `2,434 ms` | `isValid: true` (`score: 100`) |

### B. Live Google Generative Language Verification (`RUN_LIVE_AI_TESTS=1`)

- **Multimodal Vision + Mixed-BHK (`2BHK/820 + 3BHK/1,120 sq ft`) + Mandatory `NO OTS` & Centered Core (`DEEP` / `gemini-3.5-flash-lite`):**
  - `promptTokens: 1,337`, `completionTokens: 239`, `totalTokens: 1,576` (down from `1,701` in Phase 4A).
  - Live AI latency (including `0`-retry fast cascade past two `HTTP 503` preview models): **`5,581 ms`** (down from `10,746 ms` in Phase 4A and `29,647 ms` pre-Phase-4A).
  - End-to-end accepted canonical CAD + 3D scene projection: **`13,772 ms`** (`isValid: true`, `influencedGeometry: true`).

# RH Planner — AI Cache Identity, Concurrency Isolation & Telemetry Verification

> **Security & Billing Disclaimer:** Cache keys use SHA-256 digests and never embed raw API keys, bearer tokens, or raw base64 reference images. Token counters reflect provider-reported `usageMetadata` (or `'UNKNOWN'` when an upstream error omits usage) and must never be interpreted as exact cloud invoice charges without billing-export reconciliation.

---

## 1. Comprehensive SHA-256 Cache Identity (`buildProposalCacheKey`)

In Phase 4A (`57a1a358`), `buildProposalCacheKey()` serialized a partial subset of `MultiSheetApartmentConfig` and omitted `roadAccessSides`, `setbacksMm`, `irregularPlotBoundary`, `lockedMassingShape`, model fallback chains, reasoning budgets, schema digests, and session/project scope — allowing a `South`-road proposal to be served as a false cache hit for an `East`-road plot.

In Phase 4A.1 (`packages/ai-orchestration/src/orchestration/architectural-proposal.ts`), `buildProposalCacheKey()` canonicalizes (`canonicalJsonStringify`, recursive lexicographic key sort) and SHA-256 hashes the **complete effective provider request** across seven structured namespaces:

| Namespace | Included Fields |
| --- | --- |
| **`schemaVersion`** | `'phase4a1-v2'` (automatically invalidates stale cache entries whenever proposal schema semantics change) |
| **`isolationScope`** | `projectId`, `authContextDigest` (16-hex SHA-256 digest of `Authorization` / `x-rh-api-key` header computed in `server.ts`; raw tokens never enter cache keys) |
| **`provider`** | `provider.name`, primary `model`, ordered `fallbackModels[]`, `configFingerprint` (16-hex SHA-256 digest of endpoint base, model list, deadline, `maxTotalAttempts`, and retry policy — never the API key) |
| **`requestParameters`** | `systemPrompt`, `userPrompt`, `responseSchemaName`, `responseSchemaDigest` (`TEXT_SCHEMA_DIGEST` vs `VISION_SCHEMA_DIGEST`), `reasoningMode`, `thinkingBudget`, `maxOutputTokens`, `temperature` |
| **`siteAndEnvelope`** | `plotWidthMm`, `plotDepthMm`, `roadWidthMm`, `roadAccessSides[]`, `setbacksMm`, `lotAllotmentMode`, `jurisdiction`, `irregularPlotBoundary`, `centerBuildingInEnvelope` |
| **`programAndRequirements`** | Normalized `aiPrompt`, `verticalStackType`, `numTypicalFloors`, floor/stilt/basement heights, `flatsPerFloor`, per-unit `(unitIndex, bhkType, targetCarpetSqFt, hasUtilityBalcony, hasServantRoom, hasPoojaRoom)`, `targetAreaSqFt`, `areaTargetScope`, `areaAcceptanceTolerancePercent`, `requireAreaTargets`, parking, dining/study/chajja/gallery flags, `structuralLayoutMode`, `architectureOptions`, `regulatoryContext`, `siteAmenities`, `stiltAmenities`, `terraceAmenities` |
| **`massingAndExploration` & `referenceAttachment`** | `seed`, `buildingMassingShape`, `lockedMassingShape`, `planCategory`, `preferredArchetype`, `autoExploreNovelShape`, `shapeParams`, sorted `rejectedTopologyHashes[]`, `rejectedShapeIds[]`, `rejectedArchetypeIds[]`, plus `referenceAttachment` (`disposition`, `mimeType`, full-bytes SHA-256 `contentDigest`, `byteLength`) |

### Regression Verification (`phase4a1-reliability-repro.test.ts`)
Verified 15 pairwise single-dimension mutations (road side `South -> East`, road width, setbacks, irregular polygon vertex, flat count, mixed-BHK, per-unit carpet target, mandatory prompt, PNG byte content, locked massing shape, seed, rejected topology hashes, reasoning mode, fallback model list, and `projectId` / `authContextDigest`), confirming **15/15 distinct SHA-256 keys**, while cosmetically reordered object property keys produce the **exact same SHA-256 key**.

---

## 2. Bounded True LRU Cache & Isolated In-Flight Deduplication (`lru-proposal-cache.ts`)

### A. `BoundedLruCache<K, V>`
- Replaces plain insertion-order `Map` eviction (`keys().next().value` without recency refresh) with genuine **Least Recently Used** eviction: `get(key)` checks TTL expiration and deletes + re-inserts live hits at the MRU tail.
- Configurable `maxEntries` (default `64`) and `ttlMs` (default `300,000 ms` / `5 min`), plus `pruneExpired()`, `invalidate(key)`, and `invalidateWhere(predicate)`.
- Verified: inserting `A, B, C` (`maxEntries: 3`), reading `A`, and inserting `D` evicts `B` (least recently used) while retaining `A, C, D`.

### B. `InFlightRequestDeduplicator<V>`
- **Caller Cancellation Isolation:** Each upstream provider call owns a dedicated `upstreamController = new AbortController()` and a `subscribers: Set<symbol>`.
  - If Consumer A aborts while Consumer B is awaiting the same in-flight proposal, Consumer A rejects immediately with `ProposalCancelledError` (`invocationMode: 'CANCELLED'`) **without aborting Consumer B's shared upstream HTTP call**.
  - Only when `subscribers.size === 0` (all subscribers cancelled) does `upstreamController.abort()` cancel the underlying network socket.
- **Bypass Isolation:** `bypassCache: true` executes on an isolated `AbortController` and never deletes or overwrites an active shared in-flight entry.
- **Stale Entry Guard:** Entries older than `maxInFlightAgeMs` (`45,000 ms`) are evicted cleanly from the active table so hung promises cannot block subsequent callers indefinitely.

---

## 3. Six-State Invocation Mode & Dual Token Accounting

Phase 4A contained `geminiInvoked: !cacheHit || true` (always `true`) and reused cached `response.usage` as if new tokens were spent on cached repeats. Phase 4A.1 enforces exact state and token separation across `AIProposalTelemetry`:

| `invocationMode` | `geminiInvoked` | `apiCallCount` | `currentRequestTokenUsage` | `proposalTokenUsage` | Meaning |
| --- | --- | --- | --- | --- | --- |
| **`LIVE_PROVIDER`** | `true` | `>= 1` | Provider `TokenUsage` (`prompt + completion + thoughts`) | Provider `TokenUsage` | Fresh live Gemini call succeeded for this request |
| **`CACHED_PROVIDER_RESPONSE`** | **`false`** | **`0`** | **`{ promptTokens: 0, completionTokens: 0, totalTokens: 0 }`** | Original `TokenUsage` | Served from `BoundedLruCache`; zero new network or token usage |
| **`SHARED_IN_FLIGHT_REQUEST`** | **`false`** | **`0`** | **`{ promptTokens: 0, completionTokens: 0, totalTokens: 0 }`** | Leader's `TokenUsage` | Co-subscribed follower on an active leader call; avoids double-counting |
| **`DETERMINISTIC_FALLBACK`** | **`false`** | **`0`** | **`{ promptTokens: 0, completionTokens: 0, totalTokens: 0 }`** | `0` tokens | Provider unconfigured/disabled; deterministic interpreter ran directly |
| **`PROVIDER_FAILURE`** | `true` *(if HTTP call initiated)* / `false` *(if blocked by active project-quota cooldown)* | Actual attempts (`0..N`) | **`'UNKNOWN'`** *(if failed HTTP attempts lacked `usageMetadata`)* or summed partial `TokenUsage` | `'UNKNOWN'` or `0` | Upstream Gemini failed; deterministic fallback produced accepted geometry |
| **`CANCELLED`** | `Boolean(initiatedNewProviderCall)` | Actual attempts before abort | `'UNKNOWN'` *(if aborted mid-flight without usage)* or `0` | `'UNKNOWN'` or `0` | Request aborted by caller/disconnect (`HTTP 499 REQUEST_CANCELLED` before geometry synthesis) |

Every failed upstream HTTP attempt is additionally recorded in `failedAttempts[]` (`{ model, errorCode, failureClass, latencyMs, tokenUsage: partialUsage ?? 'UNKNOWN' }`).

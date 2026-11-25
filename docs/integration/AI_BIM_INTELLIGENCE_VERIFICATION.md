# AI-Assisted BIM & CAD Intelligence Verification (Phase 5B — Gate J)

## 1. Architecture & Zero-Token Deterministic Routing
RH Planner's BIM & CAD Assistant combines a zero-latency deterministic engine (`packages/frontend/src/services/bim-query.ts`) with an optional natural-language classification backend (`POST /api/v1/bim/assistant` in `packages/backend/src/api/bim-assistant-routes.ts`):

1. **Deterministic Factual Execution (`0` Provider API Calls):**
   - Schedule filtering, quantity/area takeoffs, NBC/UDCPR compliance checks, clash & clearance summaries, IFC export readiness/omission explanations, and revision diffs execute **100% deterministically** against canonical geometry, `BimQuantityRow[]`, `IfcExchangeManifest`, and `BimClash[]` with `apiCallCount: 0`.
2. **Preview-Gated Canonical Mutations:**
   - Natural-language edit requests (`LOCAL_REGENERATION`, `DIRECT_EDIT`, `AREA_TARGET_EDIT`) NEVER mutate `editor.building` silently. They synthesize a validated `BimMutationPreview` (`mode: 'PREVIEW_READY'`) showing exact scope, summary, and next canonical building revision; the user must explicitly click **Accept Preview** (recording a full Undo/Redo snapshot) or **Discard**.
3. **AI Provider Reuse, Caching & Untrusted IFC Sanitization:**
   - Ambiguous natural-language phrasing sent to `/api/v1/bim/assistant` reuses `GeminiProvider`, `FAST | BALANCED | DEEP` `ReasoningEffort`, SHA-256 `BoundedLruCache`, token telemetry, and `AbortSignal` cancellation.
   - All external IFC reference names/labels are stripped of control characters, HTML/script tags, and prompt-injection delimiters (`sanitizeUntrustedLabel`) before display or prompt inclusion, and never trigger canonical mutations.

## 2. Supported Command Classes (All 9 Verified)
| # | Command Class | Example Prompt | Execution Path | Mutation Safety |
| --- | --- | --- | --- | --- |
| 1 | `SELECTION_FILTER` | `"Show all doors on Typical Floor 1"` | Deterministic (`0` tokens) | Read-only selection |
| 2 | `QUANTITY_TAKEOFF` | `"Total window area"` / `"Wall length"` | Deterministic (`0` tokens) | Read-only takeoff |
| 3 | `COMPLIANCE_CHECK` | `"Check compliance and narrow doors"` | Deterministic (`0` tokens) | Read-only audit |
| 4 | `CLASH_TRIAGE` | `"Summarize active MEP clashes"` | Deterministic (`0` tokens) | Read-only triage |
| 5 | `LOCAL_REGENERATION` | `"Regenerate Flat 2 only"` | Deterministic preview + `regenerateProtectedScope` | Requires **Accept Preview** + Undo/Redo |
| 6 | `DIRECT_EDIT` | `"Flip door swing"` / `"Set wall thickness to 150 mm"` | Deterministic preview + canonical edit solver | Requires **Accept Preview** + Undo/Redo |
| 7 | `AREA_TARGET_EDIT` | `"Resize Flat 1 to 920 sq ft"` | Multi-unit parser + `regenerateProtectedScope` | Requires **Accept Preview** + Undo/Redo |
| 8 | `EXPORT_READINESS` | `"Check IFC export readiness and omissions"` | Deterministic (`0` tokens) | Read-only manifest check |
| 9 | `REVISION_DIFF` | `"Compare changes since previous revision"` | Deterministic (`0` tokens) | Read-only diff |

## Independent replay

The backend and frontend BIM assistant tests exercised supported deterministic queries, cache telemetry and proposal confirmation. The visible BIM Studio query uses the local deterministic path. The server has a separately tested provider-assisted route. Live Gemini, broader intent coverage and complete native coordination are open.

The BIM API rejects an unresolved target storey before invoking a provider. A flat-scoped local schedule query reports a missing flat with zero matches. The deterministic desktop workflow remains covered by the unified Studio browser test.

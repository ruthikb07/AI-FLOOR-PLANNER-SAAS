# RH Planner — AI Provider Configuration & Security Audit

> **Security Policy:** Zero credential values, prefixes, or `.env` contents are stored in source control, frontend bundles, error payloads, or documentation.

## 1. Environment Variable & Credential Resolution (`packages/backend/src/env.ts`)

| Variable | Role | Default / Behavior |
| --- | --- | --- |
| `GEMINI_API_KEY` | Primary server-side Gemini credential | Preferred when set; never exposed to `VITE_*` |
| `GOOGLE_API_KEY` | Accepted alias when `GEMINI_API_KEY` is unset | Recorded in sanitized `credentialSource: 'GOOGLE_API_KEY'` |
| `GEMINI_MODEL` | Primary structured-output model | `gemini-2.5-flash` default (`gemini-3.8-flash` in operator `.env`) |
| `GEMINI_FALLBACK_MODEL` | First fallback model | `gemini-2.5-flash-lite` default (`gemini-3.1-flash-lite` in operator `.env`) |
| `GEMINI_FALLBACK_MODELS` | Comma-separated cascade chain | Defaults to `[GEMINI_FALLBACK_MODEL, 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview', 'gemini-flash-lite-latest']` |
| `AI_PROVIDER_TIMEOUT_MS` | Provider request timeout budget | `15000` ms default (`12000` ms cap in server runtime; `5500` ms per-attempt timeout when fallback models remain) |
| `RH_BRIEF_INTERPRETER` | Interpreter mode | `gemini` (default) or `local-stub` (explicit dev/CI opt-in) |

## 2. Sanitized Health & Provider Readiness (`GET /api/v1/health`)

- Performs a real credential probe against Google Generative Language (`GET /v1beta/models/<model>`) rather than trusting key length.
- Classifies provider status into:
  - `NOT_CONFIGURED` · `REACHABLE` · `AUTH_FAILED` (`400/401/403`) · `RATE_LIMITED` (`429`) · `QUOTA_EXCEEDED` · `MODEL_UNAVAILABLE` (`404`) · `TEMPORARILY_UNAVAILABLE` (`5xx`) · `TIMEOUT` · `NETWORK_ERROR` · `REQUEST_ERROR`.
- Returns `providers[]` distinguishing `@google/generativelanguage` (`ACTIVE_RUNTIME`) from `openai-responses` (`IMPLEMENTED_NOT_WIRED_IN_RUNTIME`).

## 3. Credential Isolation & Error Redaction Verification

1. **Frontend Bundle Isolation:** `packages/frontend` contains zero `GEMINI_API_KEY` or `GOOGLE_API_KEY` references; Vite only exposes `VITE_*` variables (`VITE_API_PROXY_TARGET`).
2. **HTTP & Exception Scrubbing (`redactSecret` in `providers/http.ts`):** All thrown `ProviderRequestError` messages and upstream diagnostic snippets strip `?key=...`, `Bearer ...`, `AIza...`, `AQ....`, and exact runtime API key substrings before logging or returning telemetry.
3. **Rate-Limit & Free-Tier Quota Cascade:** On `HTTP 429` (`RATE_LIMITED` / Free-Tier 20 RPD per-model limit) or `5,500 ms` primary model timeout, `GeminiProvider` cascades with `0` wasted retries on the exhausted primary model directly to the next fallback model (`gemini-3.1-flash-lite` → `gemini-3.6-flash` → `gemini-3.5-flash-lite`).

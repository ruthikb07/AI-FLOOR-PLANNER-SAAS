# RH Planner — AI Generation & Reference Pipeline Verification

## 1. Automated & Live Verification Suites Executed

- `packages/ai-orchestration`: **143/143 passed** (`npx vitest run`).
- `packages/backend/src/__tests__/phase4a-ai-pipeline-verification.test.ts`: **9/9 passed** (including `RUN_LIVE_AI_TESTS=1` live Gemini multimodal PNG + mixed-BHK test against configured `.env` credentials without exposing keys).
- `packages/backend/src/__tests__/generation-acceptance-repair.test.ts`: **6/6 passed**.
- `packages/backend/src/__tests__/phase2-architectural-verification.test.ts`: **17/17 passed**.

## 2. Verified Capabilities & Guardrails

1. **Live Gemini Multimodal Vision + Mixed-BHK Generation:**
   - Verified with an inline PNG sketch + `2 × 2BHK + 2 × 3BHK` brief (`totalFloors: 4`, `stiltParking: true`).
   - Confirmed `geminiInvoked: true`, `interpretationSource: 'GEMINI'`, `referenceAttachmentDisposition: 'VISION_INLINE_ATTACHED'`, `influencedGeometry: true` (distinct `physicalLayoutHash` vs deterministic baseline), and `overallDeltaMm2 < 0.001`.
2. **Honest Deterministic Fallback Attribution:**
   - When `GEMINI_API_KEY` is absent or unreachable, `/api/v1/projects/generate` returns `interpretationSource: 'DETERMINISTIC'` with explicit `fallbackReason` (`GEMINI_NOT_CONFIGURED`, `RATE_LIMITED`, `TIMEOUT`, etc.) — never masquerading deterministic output as live AI.
3. **Structured Requirement Provenance & Conflict Detection (`interpretStructuredBriefRequirements`):**
   - Classifies parsed clauses into `MANDATORY`, `USER_PREFERENCE`, `AI_SUGGESTION`, `DEFAULT`, `INFERRED_CONSTRAINT`, and `JURISDICTION_VERIFICATION_REQUIRED`.
   - Detects and reports explicit conflicts without silently dropping mandatory constraints:
     - `CONFLICTING_UNIT_COUNT` (e.g., prompt asks for 6 units while unit schedule fixes 4 units — schedule wins).
     - `CONFLICTING_OTS_DIRECTIVE` (prompt requests both `no OTS` and `central OTS courtyard`).
     - `CONFLICTING_BALCONY_DIRECTIVE` (prompt requests `no balconies` alongside `wrap-around balconies`).
     - `CONFLICTING_LOCKED_MASSING` (prompt text contradicts explicit `lockedMassingShape`).
     - `REFERENCE_OVERRIDDEN_BY_BRIEF` (attached reference image hints overridden where explicit user brief specifies hard rules).
4. **Reference Attachment Validation (`classifyReferenceAttachment`):**
   - Supported raster formats (`image/png`, `image/jpeg`, `image/webp` with non-empty base64): `VISION_INLINE_ATTACHED`.
   - Non-vision attachments (`application/pdf`, `image/vnd.dxf`, `image/svg+xml`, metadata-only): `ADVISORY_METADATA_ONLY` (never sent as malformed image bytes).
   - Out-of-bounds `[0..1]` spatial centroids or invalid room enums in AI output are rejected into `referenceGuidanceRejected` rather than clamped into plausible-looking false hints.

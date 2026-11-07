# AI Architectural Floor Planner — Apartment Generation Diagnosis & 5‑Phase Recovery Plan

**Status:** Diagnostic report only. No code was changed to produce this document.
**Scope:** Why the current apartment (and house/villa) image generation produces overlapping, zero‑scoring, or no valid output — and a concrete, phased path to fix it.
**Authority order used (per project memory §69):** Actual repository > Master PRD > Historical memory > Assumption. Every claim below is tied to a specific file in the repo or to verified Cloudflare documentation.

---

## How to read this document

- **Part 1 — What the system actually is** (grounded in the code, not the handoff summary).
- **Part 2 — The problems**, ranked, each with *evidence* (file + line behaviour), *effect*, and *severity*.
- **Part 3 — Reference images**: what you uploaded, what to upload, and how they should be organised.
- **Part 4 — Solution direction**: the one architectural decision that determines everything else.
- **Part 5 — The 5 phases**: goal, problems addressed, work items, and acceptance gates for each.
- **Appendix** — security, model configuration, and a verification checklist.

A short glossary sits at the end.

---

# PART 1 — WHAT THE SYSTEM ACTUALLY IS

This is a pnpm monorepo. The relevant packages for generation are:

| Package | Role in generation |
|---|---|
| `packages/ai-orchestration` | Prompt compiler, apartment manifest/schematic/typologies, FLUX provider, Gemini provider, preflight, vision interpretation, architectural evaluation. |
| `packages/backend` | HTTP routes, the `GenerationOrchestrator` that wires the whole pipeline, credential/env config, artifact store, reference‑image loading. |
| `packages/frontend` | `StudioShell.tsx` drives the Generate experience; `backend-api.ts` calls the orchestrator. |
| `packages/planning-engine`, `geometry-engine`, `constraint-engine` | Deterministic feasibility, geometry, validation. |
| `packages/projection-3d`, `renderer` | Downstream 3D / rendering (out of scope here). |

### The intended pipeline (from `generation-orchestrator.ts`)

```
USER INPUT
   ↓
(apartment) completeness gate  →  deterministic apartment feasibility gate
   ↓
deterministic apartment SCHEMATIC  +  generation MANIFEST  (must agree, or STOP)
   ↓
compile FLUX prompt (+ reference images + schematic scaffold PNG)
   ↓
FLUX (Cloudflare @cf/black-forest-labs/flux-2-klein-4b)  →  raw PNG
   ↓
image quality gate (bytes/format/variance)
   ↓
Gemini apartment visual PREFLIGHT (zero‑tolerance count checks)
   ↓ (only if pass)
persist artifact  →  Gemini vision INTERPRETATION  →  deterministic geometry + HARD VALIDATION
   ↓
Gemini architectural EVALUATION (0–100)
   ↓
candidate (image + validated 2D + score)
```

The architecture on paper matches the memory. The problems are in *how* several stages are implemented, and in one hard structural limit that blocks most flat counts before FLUX is ever called.

### What actually works today

- FLUX **transport design is correct**. `providers/image-generation.ts` sends `multipart/form-data`, lets the runtime set the boundary, and supports up to four `input_image_*` parts. This matches Cloudflare's documented contract for `flux-2-klein-4b` (multipart form data, up to 4 images at 512×512, base64 output). *(Verified against Cloudflare Workers AI changelog/model docs. Content rephrased for licensing compliance.)*
- Reference assets **exist**: `packages/backend/data/reference-images/normalized_512/` contains three apartment PNGs (plus `originals/`).
- The **manifest** (`apartment/manifest.ts`) computes exact per‑floor counts (flats, bedrooms, lifts, stairs, areas) correctly from the brief.
- **Completeness** and **deterministic feasibility** gates (`feasibility.ts`) are substantive and sensible.
- The **stage state machine** and **resumable interpretation** described in memory are present.

So this is not a rebuild. It is a set of targeted defects sitting on a sound skeleton.

---

# PART 2 — THE PROBLEMS

Ranked by how directly they cause the symptoms you described ("scoring 0", "overlapping everything", "no proper image", "can't move forward", "only certain flat counts").

### P1 — The schematic hard‑fails for any flat count other than 2, 3, or 4 (BLOCKER)

**Evidence:** `apartment/schematic.ts`, `generateDeterministicApartmentSchematic()` branches:
```
if (finalFlats.length === 2) { ...2 units... }
else if (finalFlats.length === 3) { ...3 units... }
else { ...always builds exactly 4 quadrant units (loop i < 4)... }
```
`flatCount` is set to `finalFlats.length`, but the `else` branch always pushes **4** `allocatedUnits`.

Then in `generation-orchestrator.ts`, before FLUX is called:
```
validateSchematicMatchesManifest(apartmentSchematic, apartmentManifest)
```
checks `schematic.units.length === manifest.units.units.length`. Consequences:

- **1 flat** → schematic builds 4 units, manifest expects 1 → mismatch → orchestrator returns `schematic_validation` error → **no image generated at all**.
- **5, 6, … flats** → schematic builds only 4 units → mismatch → **hard stop**.
- Only **2, 3, 4** ever reach FLUX.

**Effect:** Directly contradicts your requirement ("1, 2, 3, 4, 6, or any … villas too"). For unsupported counts the user sees a validation error, not a plan.
**Severity:** Critical. This is the first thing to fix because it silently caps the product.

---

### P2 — The apartment prompt is a ~120‑line prose essay sent to a distilled 4‑step model (PRIMARY QUALITY CAUSE)

**Evidence:** `orchestration/image-prompt-compiler.ts`, `compileApartmentFloorPlanImagePrompt()` assembles a `promptLines` array with priority rules, per‑unit breakdowns, "HARD REQUIREMENTS 1–11", 2BHK/3BHK organisation sentences, drawing‑style paragraphs, forbidden‑text lists, etc.

`flux-2-klein-4b` is an **ultra‑fast distilled model with a fixed 4‑step inference process** (confirmed in Cloudflare's launch changelog — the `steps` parameter cannot even be changed). Distilled few‑step diffusion models are weak at long instruction following, exact counting, and legible text.

**Effect:** The model cannot honour "exactly 2 lifts side‑by‑side", "flat 02 must be larger", "English only", etc. It averages the essay into a plausible‑looking but structurally wrong plate → **overlapping rooms, wrong flat/lift/stair counts, villa‑like or gibberish output**. This is exactly the failure mode memory §55 warned about ("a huge natural‑language prompt does not reliably force an image model to produce exact counts").
**Severity:** Critical.

---

### P3 — Square 1024×1024 output, no aspect adaptation

**Evidence:** Both compilers default `width = input.width ?? 1024; height = input.height ?? 1024;`. Nothing maps the plot's width:depth ratio (or flat count) to the image dimensions. The frontend/tests use 1024×1024.

**Effect:** Real apartment floor plates are rectangular; your three reference images are strongly **portrait**. Forcing a multi‑flat, central‑core plate into a square canvas is a direct cause of the **cramping and overlap** you see. klein supports non‑square output up to ~4 MP, so this is free to fix.
**Severity:** High.

---

### P4 — The zero‑tolerance preflight is what stamps "score 0" (SYMPTOM SOURCE)

**Evidence:** `orchestration/apartment-preflight.ts` (`evaluateApartmentPreflight`) fails on *any* deviation: `flatCount !== expected`, `liftCount < expected`, unit‑mix exact match, villa detection, etc. In `generation-orchestrator.ts`, when preflight fails the candidate is pushed as:
```
status: 'REJECTED',
validation: { isValid:false, overallScore: 0, ... }
evaluation: null
```
Interpretation, geometry validation, and the real 0–100 architectural evaluation are **never reached**.

**Effect:** Because P1–P3 make FLUX output structurally wrong, preflight rejects essentially everything, and every candidate surfaces as **score 0 / rejected**. The "0" you see is not an architectural score — it is a placeholder for "failed the gate before scoring." Compounding factor: preflight asks Gemini to *count* flats/lifts in a garbled image; Gemini's counts on messy images are themselves unreliable, so even the occasional decent image can be failed.
**Severity:** High (it is correct behaviour reacting to bad inputs; it becomes a non‑issue once P1–P3 are fixed, but the UX should distinguish "gate‑rejected" from "scored 0").

---

### P5 — Gemini model IDs are fragile / likely invalid → all Gemini stages can 404

**Evidence:** `backend/.env` sets `GEMINI_MODEL=gemini-flash-lite-latest` and `GEMINI_FALLBACK_MODEL=gemini-3.1-flash-lite`. `env.ts` default is `gemini-3.6-flash`. In `providers/gemini.ts`, a `400/404` is thrown **immediately** (no retry, no fallback benefit).

`gemini-3.1-flash-lite` and `gemini-3.6-flash` are not recognised Google model IDs. If the primary alias is unavailable in your region/project, every Gemini call — requirement understanding, **preflight**, interpretation, evaluation — fails with 404.

**Effect:** Independent of the image quality, a bad model ID makes the whole "understanding + preflight + evaluation" half of the two‑AI system dark, which also reads as "nothing moves forward / everything is 0."
**Severity:** High. Cheap to fix; pin to real, currently‑available IDs and verify with a smoke call.

---

### P6 — Reference images are weak and can be silently dropped

**Evidence:**
- `generation-orchestrator.ts::loadApartmentReferenceImages()` loads the three style PNGs **plus** a generated schematic PNG.
- The schematic PNG (`apartment/schematic-renderer.ts`) is a crude **colored‑rectangle** diagram, and rooms inside each flat are placed on a naive **3×3 grid** (`schematic.ts::createSchematicUnit`, `idx % 3` / `Math.floor(idx/3)`) regardless of real adjacency. As a visual reference it is low‑value and adds noise.
- In `providers/image-generation.ts`, if Cloudflare returns **400** with references present, the code **silently retries without any references** (and still keeps other params). If field names or sizes are ever off, references vanish with only a `console.warn`, defeating the entire "reference‑guided" premise and giving no user‑visible signal.

**Effect:** The mechanism meant to enforce Indian‑apartment style and organisation is both weak (box‑diagram scaffold) and unreliable (silent drop). Also, a single style reference showing *4 flats* actively fights a *2‑flat* request (memory §27 says user count must win, but a mismatched reference still biases a weak model).
**Severity:** High.

---

### P7 — Unsupported request fields may be causing the UI "fetch failed"

**Evidence:** `buildCloudflareImageRequestBody()` adds `steps` and (by default) `negative_prompt`. Cloudflare's documented `flux-2-klein-4b` multipart params are `prompt`, `width`, `height` (+ up to 4 image inputs); `steps` is fixed and `negative_prompt` is **not** documented for klein. The 400‑fallback path only triggers *when references are present* and never strips `negative_prompt`/`steps`.

**Effect:** If klein rejects unknown fields with a 400 (or the multipart with 4 large images times out), the UI surfaces a generic `Cloudflare FLUX image generation failed: fetch failed`. The transport *design* is fine; the *payload* may be over‑specified. This must be diagnosed at the request layer (memory §53) before blaming the model.
**Severity:** Medium‑High (blocks generation when it triggers).

---

### P8 — Image is handed to Gemini through a brittle regex

**Evidence:** Preflight, interpretation, and evaluation all embed the image as text: `` `IMAGE (base64 ${mime}):\n${b64}` ``. `providers/gemini.ts::buildGeminiParts()` uses a regex to detect that pattern and convert it to `inlineData`. It works today, but any wording change silently sends a multi‑MB base64 **string as text**, which Gemini cannot interpret as an image → silent vision failure.

**Effect:** Fragile coupling; a latent failure that will resurface on the next refactor.
**Severity:** Medium.

---

### P9 — Villa / bungalow / independent‑house path is under‑served

**Evidence:** For `residential_independent`, the orchestrator uses `compileFloorPlanImagePrompt()` — a reasonable generic compiler — but it still emits **square 1024**, uses **no reference images**, and has weaker English‑label / anti‑gibberish guards than the apartment path.

**Effect:** Your requirement that the system "adapt and shape the image" for villas/bungalows is only partially met; those outputs are untuned.
**Severity:** Medium.

---

### P10 — Consistency / typing niggles (lower priority but worth logging)

- `manifest.ts` default setbacks `{3,2,2,2} m` vs `schematic.ts` `{4.5,3,3,3} m` — different area maths for the "same" project when one path fills defaults.
- `schematic-renderer.ts` imports `DeterministicApartmentSchematic` from `types/apartment.js` while `schematic.ts` defines its own — confirm they are the *same* shape to avoid drift.
- `image-quality-gate.ts` uses byte‑variance as a proxy for "has architectural detail"; a busy but wrong image passes, a clean sparse plan could theoretically fail. Fine as a coarse gate, but it is not a structural check.

**Severity:** Low.

---

### Severity summary

| # | Problem | Severity | Symptom it explains |
|---|---|---|---|
| P1 | Schematic supports only 2/3/4 flats | Critical | "only some counts work", "can't move forward", 1/5/6 blocked |
| P2 | Giant prose prompt to distilled model | Critical | "overlapping everything", wrong counts, gibberish |
| P3 | Square 1024×1024 | High | cramping / overlap |
| P4 | Zero‑tolerance preflight → 0 | High | "scoring 0", rejected |
| P5 | Fragile/invalid Gemini model IDs | High | nothing progresses, 0s |
| P6 | Weak / silently‑dropped references | High | style not Indian‑apartment‑like |
| P7 | Unsupported FLUX fields | Med‑High | "fetch failed" in UI |
| P8 | Regex image passing to Gemini | Medium | latent vision failure |
| P9 | Villa path untuned | Medium | non‑apartment output weak |
| P10 | Setback/type inconsistencies | Low | subtle area drift |

---

# PART 3 — REFERENCE IMAGES

### What you uploaded (and why they are good)

The three images you attached are exactly the right *visual language*:
1. **"Building B" symmetric plate** — 4 corner flats around a central lift/stair core, dry balconies, sit‑outs, ducts, English labels, room dimensions. Classic Indian typical‑floor plate.
2. **Portrait 4‑flat plate** — central lobby + single lift + stair spine, mirrored flats top/bottom, wide balconies, vent shafts.
3. **Portrait 4‑flat plate with types (2C / 2F2 / 2D2)** — foyers, pooja niches, OTS, terraces, lift lobby "Block‑D".

They share: **top‑down orthographic**, **black‑on‑white technical linework**, **clear party walls**, **central core with lift + stair(s)**, **balconies/dry balconies**, **ducts/OTS**, and **English labels**. That is the target aesthetic.

### The problem with using them as‑is

All three show **4 flats** and are **portrait**. If the user asks for **2 flats**, a 4‑flat reference actively pulls a weak model toward 4. Memory §27 is explicit: *user count wins*. So references must be **selected to match the requested flat count**, not thrown in blindly.

### What to upload — a small, labelled reference library

Create a bucketed library so the loader can pick references that match the request. Recommended buckets (2–3 clean images each, 512×512 normalised, cropped to remove title blocks / watermarks / client PII per memory §26):

| Bucket | What it should show |
|---|---|
| `flats_1` | Single large unit per floor (or a villa/independent plate for house mode). |
| `flats_2` | Two mirrored units either side of a central core (lift + 2 stairs). Your image #2 style, but re‑drawn/selected as a **2‑flat** plate. |
| `flats_3` | Three units around a core. |
| `flats_4` | Quad/pinwheel around a central core — your image #1 is ideal. |
| `flats_6` | Six units, double‑loaded corridor or two cores. |
| `villa` | Single‑family bungalow/villa plan for `residential_independent` mode. |

Each image, ideally: orthographic, black linework on white, labelled `LIVING / DINING / KITCHEN / MASTER BEDROOM / BEDROOM 2 / BATH / BALCONY / UTILITY / LIFT / STAIR / COMMON LOBBY / DUCT`, with clear party walls and a visible central core. Keep the **originals** untouched (memory §28) and store provider‑ready 512×512 derivatives separately (the repo already follows this `originals/` + `normalized_512/` split).

> Practical note: you do **not** need dozens of images. 2–3 per bucket is enough to convey style. The *count and organisation* must come from the deterministic schematic + manifest, not from the reference (memory §27, §30).

---

# PART 4 — SOLUTION DIRECTION (the one decision that shapes everything)

Your memory already contains the escape hatch (memory §60). There are two viable architectures:

**Option A — Reference/schematic‑guided FLUX (current intent).**
Keep FLUX as the plan generator; feed it a *short* structured instruction + a *strong* schematic image + count‑matched references. Realistic ceiling: decent‑looking plates, but exact counts remain probabilistic on a distilled model, so the strict preflight will still reject a meaningful fraction.

**Option B — Deterministic base‑plan → FLUX as a styling/presentation layer (memory §60 fallback).**
The deterministic engine already produces exact geometry (schematic + manifest). Render that to a clean base plan image, then use FLUX only to *stylise/present* it (or skip FLUX for the authoritative 2D and use it purely for a "pretty" render). This is the reliable route when **exact flat/lift/stair/room counts are non‑negotiable** — which is precisely your stated requirement ("2 flats means exactly 2").

**Recommendation:** Pursue **A for visual quality, but make B the guarantee of correctness.** Concretely: the deterministic schematic becomes the *source of truth* for counts and zoning; FLUX is asked to render *that specific layout* (image‑to‑image / strong reference) rather than to invent one from text. If FLUX cannot hit the counts after a bounded retry, fall back to the deterministic base‑plan render so the user still gets a correct, editable plan. This satisfies "exactly N flats for any N" and "adapt to villas" without betting correctness on a 4‑step model.

The 5 phases below are ordered to deliver this.

---

# PART 5 — THE FIVE PHASES

Each phase is independently shippable and ends with a concrete acceptance gate. Phases follow the memory's discipline (diagnose → focused change → tests → typecheck → lint → build → real smoke test) and the priority order in memory §67.

## PHASE 1 — Unblock arbitrary flat counts + fix the transport & model config

**Goal:** Make *any* configuration actually reach FLUX and get a byte‑valid image back — including 1, 5, 6 flats and villas — and stop generating on invalid model IDs / rejected payloads.

**Problems addressed:** P1, P5, P7, P10.

**Work items:**
1. **Generalise the schematic** (`apartment/schematic.ts`) to partition the floor plate for **N** flats (1, 2, 3, 4, 6, …) around the core, instead of the hard‑coded 2/3/4/else. Ensure `schematic.units.length === flatsPerFloor === manifest.units.exactCount` for all N so `validateSchematicMatchesManifest` passes. Add a `flats_1` (single‑unit) and villa path.
2. **Pin real Gemini model IDs** in `.env` and `env.ts` defaults (verify each with a one‑shot smoke call). Remove fictional `gemini-3.x` fallbacks.
3. **Trim the FLUX payload** to documented klein params: send `prompt`, `width`, `height`, image inputs only. Drop `steps` and `negative_prompt` (or gate them behind a verified‑supported flag). Add a targeted transport log (status, whether references were included) so "fetch failed" is diagnosable.
4. **Reconcile setback defaults** between `manifest.ts` and `schematic.ts`; confirm the two `DeterministicApartmentSchematic` types are one shape.

**Acceptance gate:**
- For flat counts ∈ {1, 2, 3, 4, 6} and for villa mode, the pipeline reaches the FLUX call (no `schematic_validation` stop) and returns a byte‑valid PNG through the quality gate.
- A no‑reference, no‑negative smoke request to klein returns HTTP 200 + PNG (proves transport independent of references).
- A one‑shot Gemini call on the configured model returns text (proves model ID valid).

## PHASE 2 — Replace the prose prompt with a compact structured instruction + count‑matched references

**Goal:** Stop asking a distilled model to read an essay; give it a short directive and let the *schematic image* carry the structure.

**Problems addressed:** P2, P3, P6, P9.

**Work items:**
1. **Rewrite `compileApartmentFloorPlanImagePrompt`** to emit a *short* prompt (a few tight lines: "orthographic 2D Indian apartment floor plan, N flats around a central lift+stair core, English labels, black linework on white"). Keep the full manifest as *metadata* for logging, not as model prose.
2. **Derive `width`/`height` from the plot aspect ratio** (portrait for deep plots, landscape for wide ones), capped to klein's ~4 MP / 512‑multiple constraints. Never force square.
3. **Upgrade the schematic scaffold image** (`schematic-renderer.ts`) into a genuinely readable line drawing (real room rectangles with labels, core, lifts as `[X][X]`, stairs with tread hatching) so it is worth sending as `input_image`.
4. **Count‑matched reference selection:** load style references from the `flats_N` / `villa` buckets that match the request; never send a 4‑flat reference for a 2‑flat request.
5. **Surface silent reference drops:** if a 400 forces a no‑reference retry, record it on the candidate diagnostics instead of only `console.warn`.
6. **Tune the villa path** (`compileFloorPlanImagePrompt`) with the same aspect + reference logic.

**Acceptance gate:**
- On the memory §65 acceptance scenario (2 flats: 1×2BHK + 1×3BHK, 2 lifts, 2 stairs, common lobby), at least one of a bounded set of seeds produces an image a human agrees *looks like* a 2‑flat Indian apartment plate (manual visual acceptance, per memory §63 — HTTP 200 is not success).
- Output aspect visibly matches the plot proportions.

## PHASE 3 — Make the acceptance gate honest and add the deterministic fallback

**Goal:** Distinguish "gate‑rejected" from "architecturally scored", and guarantee the user always ends with a *correct, editable* plan even when FLUX misses.

**Problems addressed:** P4, and the correctness guarantee from Part 4 (Option B).

**Work items:**
1. **Separate the scores in the UI/state:** a preflight rejection should read as "Rejected at visual preflight: <reasons>", *not* "Score 0/100". Reserve the 0–100 number for the real architectural evaluation.
2. **Bounded retry then fallback:** keep the single seeded replacement (memory §20). If it still fails preflight, **fall back to rendering the deterministic schematic as the authoritative base plan** and mark the candidate `status: FALLBACK_DETERMINISTIC` (never silently claim FLUX succeeded — memory §45).
3. **Loosen preflight where the model is physically weak** (e.g. treat a legible paired lift bank as 2 lifts, already partially handled) without weakening the *count* guarantees — the deterministic fallback is what enforces exact counts, so preflight can advise rather than hard‑block once the fallback exists.

**Acceptance gate:**
- For the §65 scenario, the user *always* receives a plan with exactly the requested flats/lifts/stairs — either a passing FLUX image or the deterministic fallback — and the UI clearly states which path produced it.
- No candidate ever displays "0" as an architectural score for a merely gate‑rejected image.

## PHASE 4 — Strengthen image→2D interpretation and hard validation for apartments

**Goal:** Turn the accepted image (or the deterministic base plan) into a validated canonical 2D model reliably.

**Problems addressed:** P8, plus apartment‑specific validation depth (memory §41–§43, §67 items 7–8).

**Work items:**
1. **Pass images to Gemini as real image parts**, not via the `IMAGE (base64 …)` regex. Give `complete()` an explicit optional image field so preflight/interpretation/evaluation stop depending on prompt wording.
2. **Apartment‑aware interpretation:** ensure the vision schema/prompt captures per‑flat grouping, the core, lifts, stairs, and lobby (not just a flat room list), then normalise into canonical geometry.
3. **Apartment‑specific hard validation:** verify unit count, party‑wall separation, core presence, and that interpreted counts match the manifest before acceptance. Keep deterministic validation authoritative over Gemini (memory §42).

**Acceptance gate:**
- An accepted plan interprets into canonical geometry that passes hard validation, and the validated unit/lift/stair counts equal the manifest.
- Interpretation no longer relies on the regex; a wording change in prompts cannot silently break vision.

## PHASE 5 — Gemini architectural evaluation, UX clarity, and the villa/scale sweep

**Goal:** Deliver the advisory 0–100 evaluation on *valid* plans, make pipeline stages unmistakable in the UI, and prove the system scales across counts and building types.

**Problems addressed:** P9 (completion), memory §48–§49 (honest stage UI), §66 success definition.

**Work items:**
1. **Run `evaluatePlanArchitecturally`** only after hard validation (already the design); show the category breakdown as advisory (memory §43).
2. **Honest stage UI** (memory §49): show the true current stage (Understanding → Feasibility → Generating → Saved → Interpreting → Validating → Evaluating) with real per‑stage state; never show fake progress or a failed stage as success.
3. **Scale sweep as acceptance:** run the full loop for 1, 2, 3, 4, 6 flats and for a villa, confirming exact counts and adaptation each time.

**Acceptance gate:**
- The §66 end‑to‑end loop works for the §65 scenario *and* the scale sweep: user describes → understood → feasible → schematic → image (or fallback) → interpreted → validated → evaluated → editable 2D.
- Quality‑gate discipline (memory §63): focused tests, package tests, typecheck, lint, and a real smoke test recorded — with `INTERNAL ENGINEERING GATE PASSED` / `PROFESSIONAL REVIEW REQUIRED` language, never "should pass."

---

# APPENDIX

## A. Security — act on this now (memory §15/§36)

`packages/backend/.env` currently contains **live** `GEMINI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN` in the working tree. Even though `.env` is git‑ignored, these are real secrets and should be **rotated** (regenerate the Cloudflare token and Gemini key) and kept only in the secure server‑side environment. Do not paste them into docs, issues, or logs. (Values are intentionally not reproduced in this report.)

## B. Model configuration reality check

- **FLUX:** `@cf/black-forest-labs/flux-2-klein-4b` is a real, distilled, **fixed‑4‑step** Cloudflare model using multipart form‑data, up to 4 × 512×512 image inputs, base64 output. Keep the model (memory §4). The limitation is *instruction following*, not availability. If reference‑guided quality proves insufficient, `flux-2-dev` / `flux-2-klein-9b` offer stronger prompt adherence and multi‑reference support at higher latency — but change the model only with evidence (memory §61).
- **Gemini:** replace the fictional `gemini-3.x-flash` / `gemini-3.1-flash-lite` IDs with real, currently‑available IDs and verify with a smoke call; treat the repo/env as authoritative (memory §14).

## C. Verification checklist (per phase, memory §63)

1. Focused unit tests for the changed module.
2. Package test suite.
3. Typecheck + lint.
4. A **real** provider smoke test (not mocked) for FLUX and Gemini.
5. **Manual visual acceptance** wherever image quality matters — HTTP 200 ≠ success.
6. Diff review; no unrelated scope (do not touch `packages/projection-3d` for 2D work — memory cross‑package rule).

## D. Explicitly out of scope (memory §61 "what not to do")

No app rebuild; no removing AiDesignSpec, deterministic geometry, feasibility, or validation; no making FLUX/Gemini the CAD engine; no silent repair of bad images or silent edits to user requirements; no copying reference plan geometry; no claims of code compliance or structural capability; no premature BIM/IFC or load analysis.

## Glossary

- **Manifest** — the exact numeric spec of the floor (counts, areas) computed deterministically before generation.
- **Schematic** — the deterministic geometric scaffold (unit boxes, core, lifts, stairs) that should drive the image.
- **Preflight** — Gemini vision gate that checks a generated image against the brief before it is allowed downstream.
- **Fallback (deterministic)** — rendering the schematic itself as the authoritative plan when FLUX cannot meet the counts.

---

*End of report. No repository code was modified in producing this analysis.*

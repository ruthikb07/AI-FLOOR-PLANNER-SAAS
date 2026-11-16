# RH PLANNER — PHASE 1 IMPLEMENTATION PLAN

**Date:** 2026-11-13  
**Purpose:** Dependency-ordered architectural and engineering roadmap moving from Phase 0 (Deep Audit & Controlled Repair) into Phase 1 (Full AI-Assisted Multi-Candidate Topology & Exact Area-Driven Generation).

---

## 1. Phase 0 Controlled Repairs (Immediate Execution in Current Turn)

Before embarking on Phase 1 UI/workflow expansions, Phase 0 establishes a rock-solid, truthful baseline by repairing the confirmed root causes in the active pipeline:

1. **Authoritative Intent & Constraint Parsing (`architectural-intent.ts`):**
   - Recognize natural architectural verbs (`provide`, `have`, `with`, `include`, `feature`, `use`, `design`, `center`, `centered`) when setting mandatory `corePlacement` (`CENTRAL`, `SIDE`, `SPLIT`, `NORTH`, `SOUTH`, `EAST`, `WEST`).
   - Recognize `"staircases on both sides"` / `"stairs on either side"` / `"flanking staircases"` as `stairCount = 2` (with flanking placement `[stair 1] [central lift + lobby] [stair 2]`).
   - Fix negated OTS (`"no OTS"`, `"without OTS"`, `"no courtyard"`, `"without open to sky"`): instead of throwing `IntentConflictError('AMBIGUOUS_VENTILATION_STRATEGY')`, set mandatory `ventilationStrategy = 'PERIMETER_ONLY'` and `noOts = true`.
   - Parse explicit `"center building"` / `"centered inside permissible building envelope"` and explicit area targets (`2,000 sq. ft.`) + scope (`GROSS_FLOOR_AREA`, `FLOOR_TOTAL_CARPET`, `PER_APARTMENT_CARPET`).
2. **Eliminate Giant Unrequested `OPEN_TO_SKY_VOID` & Center Building Footprint (`topology-families.ts`, `multi-sheet-apartment-solver.ts`):**
   - Fix `roleFor` (`topology-families.ts:616`) and `dissectCoreBand` so that when `noOts` / `PERIMETER_ONLY` is active (or when `preferOts` is false), core leftover tails are classified as `'SERVICE_SHAFT'` (MEP/plumbing/ventilation ducts), never `'OPEN_TO_SKY_VOID'`.
   - When the required building footprint for the requested program is smaller than the permissible plot envelope, **center the building footprint (`envelope`) inside the permissible plot envelope** rather than dumping hundreds of square meters of leftover buildable envelope into `OPEN_TO_SKY_VOID` rooms inside the building!
   - When `noOts` is active, reject any topology candidate that still introduces an `OPEN_TO_SKY_VOID` (`otsAreaOf(partition) > 0`).
3. **Thread Explicit Area Targets (`targetCarpetSqFt` & `areaTargetScope`) Through Topology Sizing (`production-bridge.ts`, `topology-families.ts`):**
   - Pass `targetCarpetSqFt` and `areaTargetScope` from `MultiSheetApartmentConfig` into `selectProductionTopology`, `generateDesignConcepts`, `generateTopologyCandidates`, and `flatFootprintTarget`.
   - Size the flat footprint and centered building envelope directly from the requested area scope:
     - **Scope 1 (`GROSS_FLOOR_AREA` = 2,000 sq. ft. / $185.81\text{ m}^2$):** Constrain the centered building footprint to $185.81\text{ m}^2$ (when compact adaptation is enabled) or surface an explicit feasibility diagnostic when $185.81\text{ m}^2$ gross is below minimum habitable `4 x 2BHK` bounds, while never silently ignoring the target.
     - **Scope 2 (`FLOOR_TOTAL_CARPET` = 2,000 sq. ft. / $185.81\text{ m}^2$):** Target $500\text{ sq. ft.}$ ($46.45\text{ m}^2$) net carpet per apartment across the 4 flats.
     - **Scope 3 (`PER_APARTMENT_CARPET` = 2,000 sq. ft. / $185.81\text{ m}^2$):** Target $2,000\text{ sq. ft.}$ ($185.81\text{ m}^2$) net carpet per apartment ($\approx 220\text{–}235\text{ m}^2$ gross per flat), dynamically scaling `FLAT_BOUNDS` so `partitionDefects` and `sliceFlatRow` do not clamp the flat back down to $95\text{ m}^2$.
4. **Fix Private Passage Alignment & Prevent Bedroom-to-Kitchen Doors (`space-filling-snapper.ts`, `apartment-error-repair.ts`):**
   - In `sliceFlatRooms` (`space-filling-snapper.ts`), coordinate `serviceDepth` with `masterBedH + bathBlockH` so `livingRoom` and `passage` always share at least `1200 mm` of wall (`masterBedH + bathBlockH - serviceDepth >= 1200`), guaranteeing a valid `900 mm` open passage between `Living Room` and `Internal Passage`.
   - In `repairPrivacyAndCirculation` (`apartment-error-repair.ts`), forbid connecting a `Bedroom` directly to a `Kitchen` or `Utility` room; always route bedroom reachability through `Internal Passage`, `Living`, or `Dining`.
5. **Preserve Exterior Windows in Targeted Regeneration (`targeted-regeneration.ts`):**
   - Fix `rebuildDependencies` (`targeted-regeneration.ts:130`) so windows on selected rooms are re-hosted onto their shifted exterior walls rather than deleted.
6. **Reliable AI Invocation Tracing & Backend Intent Endpoint (`server.ts`, `stage-progress-emitter.ts`):**
   - Record explicit `aiTelemetry` on `GenerationOutcome` / `building.metadata.generationBrief` (`geminiInvoked: boolean`, `provider: 'gemini' | 'deterministic-rule-engine'`, `reason: string`, `timestamp: string`) so every generated building truthfully reports whether Gemini was invoked or deterministic parsing was used.

---

## 2. Phase 1 Engineering Roadmap (Next Phase)

### Track 1A: Live Gemini Structured Intent & Multi-Candidate Concept Synthesis
1. **Backend Endpoint (`POST /api/v1/planning/parse-intent`):**
   - Wire `AIOrchestrationService` (`GeminiProvider` with `GEMINI_API_KEY`) to extract structured `ArchitecturalProgram` + room area targets + Vastu orientation constraints + reference image analysis (`buildGeminiParts`), with automatic fallback to deterministic `interpretArchitecturalIntent` when offline or when `GEMINI_API_KEY` is absent.
2. **Genuine Seed Variation & Concept Selector UI:**
   - Pass a fresh or user-incremented `generationSeed` on each **Regenerate** click and expose all ranked `DesignConcept` candidates (`CENTRAL_CORE_SPINE`, `CENTRAL_COURTYARD`, `DUAL_WING`, `SPLIT_CORE`, `SIDE_CORE`) in the studio toolbar so the architect can switch between genuinely distinct topologies in one click.

### Track 1B: Elastic Area-Targeted Room Solver
1. **Replace Fixed-Fraction Room Slicing with Target-Area Constrained Slicing:**
   - Upgrade `sliceFlatRooms` (`space-filling-snapper.ts`) and merge the 3-band solver from `packages/ai-orchestration/src/apartment/layout-planner.ts` so individual room polygons are solved to match `ProgrammaticRoomSpec.targetAreaMm2` scaled to `unit.targetCarpetSqFt` within $\pm 2\%$.
2. **True Open Setback Margin Outside Building Perimeter:**
   - Decouple `siteSheet` plot boundary from `typicalFloor.boundary` when the building footprint is smaller than the permissible setback envelope, ensuring `groundCoverageM2` and `consumedFsi` reflect the exact built slab outline.

### Track 1C: Reference Image Vision-to-Topology Extraction
1. **Multimodal Sketch/Plan Ingestion:**
   - Send `config.referenceImage` (`PNG`/`JPG`/`PDF`) through `GeminiProvider` using `extraction-parser.ts` (`parseExtractionPayload`) to extract core placement, unit grid, and room adjacency constraints into `selectProductionTopology`.


# Engineering rules

## Canonical model

The canonical Building Model is the sole authoritative building state. Requirements and AI interpretation feed structured intent; the Geometry Engine owns geometry, the Constraint Engine owns validation, the renderer handles visualization, and the frontend/editor handles orchestration. SVG, canvas, React components and Three.js must never become independent authoritative geometry. 3D remains a projection of the canonical Building Model.

## AI and engineering safety

AI may interpret, propose and explain. It must not invent or certify soil properties, structural safety, loads, reinforcement, foundations, seismic adequacy, code compliance or professional approval. AI's role in generation is limited to turning a user's brief into structured intent, which is validated deterministically before it can influence geometry. No image-generation model may decide layout, room counts or geometry, and geometry is never derived by reading an image back in: plan generation depends only on the deterministic engines. Safety-critical engineering requires required inputs, validated deterministic calculations/solvers and professional review. Missing safety-critical input must produce explicit uncertainty or blocking, never fabricated assumptions.

## Professional status

Automated tests demonstrate internal software behavior only. Never equate passing tests with professional validation, architectural quality, code compliance, construction readiness or production readiness. Use evidence-appropriate language such as `INTERNAL ENGINEERING GATE PASSED` and `PROFESSIONAL REVIEW REQUIRED`.

## Professional references

RBEA fixtures are evidence, not templates. Never memorize or copy historical x/y coordinates, turn project-specific room placements into global rules, or commit client PII, title blocks or source drawings. Reference dimensions remain evidence-only, not universal minima, unless a separate validated standards system establishes a requirement.

Preserve provenance and uncertainty: `VERIFIED_FROM_SOURCE`, `ASSERTED_FROM_BRIEF`, `AMBIGUOUS`. Proximity does not establish bathroom ownership. Semantic ownership and physical access topology are separate concepts.

## Planning and repair

Diagnose before tuning. Prefer bounded production diffs and never silently expand scope. Do not weaken tests merely to achieve green. Repair is not a substitute for good initial placement. Do not resurrect rejected experiments unless the current task explicitly reopens them with new evidence.

## Cross-package discipline

Do not modify `packages/projection-3d` during unrelated 2D planning work unless an explicit dependency is demonstrated. Avoid changing renderer, scoring, repair, geometry and generation in one pass unless the task explicitly requires that scope.

## Quality gate

For meaningful changes, run focused tests, package tests, relevant full-suite tests, typecheck, lint and diff review. Record actual results; never substitute “should pass” for a required check. If the frontend build is blocked by the known environment/filesystem sandbox issue, report `BUILD_ENVIRONMENT_BLOCKED`, never PASS.

## Git

Check `git status` before substantial work. Commit only when explicitly instructed. Do not use destructive broad cleanup commands on an unknown working tree. Do not pop, apply or drop preserved stashes unless explicitly instructed.

## Source reality

Repository reality overrides handoff summaries. If instructions conflict with actual code, types or tests, stop and report the conflict. Do not silently force the repository to match a summary.

## Product scope

Generation work is residential unless explicitly expanded. Reference drawings may contain mixed-use, commercial or site information for research/context without expanding the active generator scope.


# ARGON 4 persistent architecture specification

Approved 2026-11-08. Preserve the engineering rules above. The vision below is a target specification, not a representation of completed functionality.

## Authoritative technical clarifications
- Audit project-owned source, configurations, scripts and tests, including sibling ../plancraft-source. Exclude node_modules, dist, build, .next, .turbo, .git and ZIP blobs; generated dist-server and coverage are not source.
- Canonical lengths are mm. Required raw planar area error is abs(gross reference area - disjoint component areas) < 0.001 mm2. Never force delta to zero, round before acceptance, or use a length tolerance for area. The user's 0.000 formatting intent must not substitute for the raw comparison (values near 0.001 can round to 0.001).
- Preserve the canonical centreline-cell ledger with clipped wall union, habitable/wet rooms, private/common circulation, stairs, lifts, shafts and explicit voids. Audit unassigned and overlap independently: including unassigned in accounted area does not prove a complete valid plan. Balcony/utility areas follow their intersection with the canonical floor envelope; do not silently change historical accounting or weaken tests.
- Regulatory context must support authorityType MUNICIPAL_CORPORATION or MUNICIPAL_COUNCIL, congestionZone NON_CONGESTED or CONGESTED, plotAreaSqm, roadWidthM, buildingHeightM, numFloors, stiltParkingEnabled and buildingUsage RESIDENTIAL_APARTMENT. Target Maharashtra UDCPR 2020 with versioned applicable amendments plus NBC 2016. Source edition, effective dates, authority applicability and exact clause citations must accompany rules. Unknown inputs produce NOT_VERIFIED or blocking, never assumed compliance.
- Mandatory statutory disclaimer: Automated checks provide engineering design assistance and require verification by a licensed Architect/Engineer before municipal submission.
- Blender 5.2 is the target; inspect projection-3d before integration. The last user clarification was truncated after that instruction. ETABS version and licensed runtime are unverified; v21 UI text is not proof. Do not invent the missing answers.

## Package ownership and shared API contracts
- core owns the authoritative Building/Floor/entity contracts, units, revisions, validation/report/structural/export descriptors and runtime boundary schemas. Imports of shared contracts come from @ai-floor-planner/core; avoid duplicate divergent transport/domain types.
- geometry-engine owns deterministic polygon operations, wall footprints, area ledgers, stair solids and coordinate transformations.
- constraint-engine owns constraint registry, plan validation, closure and acceptance decisions. Validation must be pure; repairs return explicit revised canonical state and are revalidated.
- planning-engine owns requirement-to-layout solving, topology, furnishing and bounded repair; do not disguise an audit-only pass as generation.
- ai-orchestration owns AI interpretation and provider/task routing; AI outputs remain proposals until deterministic checks pass.
- projection-3d derives scene data from the canonical model, retaining entity IDs and revision provenance. It never owns independent geometry.
- renderer and frontend own display, editing orchestration, premium responsive UX, CAD/3D workspaces and previews. Canonical edits pass through validated commands with undo/revision updates. Backend/engineering execution must not be authoritative inside UI components.
- backend owns credentials, validated API boundaries, CAD/PDF serialization, artifact persistence/verification, future Blender jobs and ETABS bridge execution. Existing frontend exporters are migration debt; preserve behavior until contract parity is demonstrated.
- ../plancraft-source is a separate four-package workspace (DSL, furniture, renderer, CLI); it is not included in this monorepo's pnpm checks.
- Export/report responses identify building revision, inputs, units, scope, actual verification and available file bytes. No fixed success flags; reject stale results. Every artifact needs its own preview/export trigger.

## Phase boundaries and verification
Phase 0 permits audit documentation, AGENTS.md and baseline-check outputs only; application packages remain unchanged by the audit. Stop after the report. Phase 1-7 implementation requires a subsequent instruction. Roadmap and evidence live in docs/phase0/AUDIT.md; file inventory in docs/phase0/INVENTORY.md and inventory.json. Never overwrite existing uncommitted work. Tests/build tasks may generate artifacts; record those effects. Passing software checks do not certify a design.

## Complete master vision

## 1. THE ARGON 4 MASTER VISION (NON-NEGOTIABLE SPECIFICATION)

Our objective is to transform this codebase into a production-grade, AI-powered **Architectural Floor Planning, 3D Building Design (Three.js + Blender 5.2), Regulatory Compliance (Maharashtra UDCPR 2020), and Structural Engineering (ETABS) Platform** suitable for real-world architectural and civil engineering workflows.

### Target End-to-End Engineering Workflow:
`Plot Input` → `AI Floor Planning` → `Mathematical Geometry Validation` → `Maharashtra UDCPR 2020 Compliance` → `Interactive 2D CAD Plans` → `Structural Column & Beam Layout` → `Individual Floor 3D Isometric Editing` → `3D Explode & Live Customization` → `Blender 5.2 Realistic 3D Architecture` → `Complete Building Assembly` → `ETABS Structural Analysis` → `ETABS Error Detection & PDF Reporting` → `Independent File Exports`.

### Core Architectural & Engineering Pillars:
1. **Strict Separation of Frontend & Backend Domains (With Shared Contracts in `@ai-floor-planner/core`):**
   - **Frontend Domain (`packages/frontend`, `packages/renderer`):** Premium, zero-overlap UI/UX, modern typography, smooth transitions, genuine multi-stage generation waiting screen, interactive 2D CAD editor, individual floor 3D isometric editor, 3D explode & live element customizer, UDCPR compliance dashboard, ETABS analysis & error viewer, and independent file export hub.
   - **Backend & Engineering Domain (`packages/core`, `packages/planning-engine`, `packages/projection-3d`, `packages/backend` / `cad-export-service.ts`):** Zero-error computational geometry engine, architectural solver, Maharashtra UDCPR 2020 validator, AutoCAD `.dwg`/`.dxf` serializer, Blender 5.2 procedural 3D pipeline, ETABS `.e2k`/OAPI structural bridge, and verified PDF/file exporters.

2. **Geometry Engine — Zero-Error Objective:**
   - Enforce strict planar area conservation: $\Delta = |\text{Gross Area} - \sum \text{Components}| = 0.000\text{ mm}^2$.
   - Enforce Indian wall thickness hierarchy: Exterior/Party = `230 mm`, Corridors = `150 mm`, Internal Partitions = `115 mm`, Shafts = `100 mm`.
   - Mathematically detect and auto-correct or report exact coordinates for:
     - Overlapping or intersecting rooms and walls.
     - Incorrect or floating column (`S-COLS`) and beam (`S-BEAM`) positioning.
     - Invalid or duplicate geometry (e.g., duplicate shared-wall doors, close column clusters, balcony corner columns).
     - Incorrect openings (e.g., flat entrance opening into Kitchen instead of Living Room; exterior doors placed on non-balcony bedroom walls; door-on-window overlaps) and vertical staircase continuity (`OPEN_PASSAGE` lobby access + `900 mm` sliding lift door cutout).
     - Dimension, room label, and parking stall text collisions in both Web SVG and exported AutoCAD `.dwg`/`.dxf` (`AC1032`, `TILEMODE = 1`).

3. **Maharashtra UDCPR 2020 Compliance Engine:**
   - Modular regulatory validation covering FSI (Basic, Premium, TDR, Ancillary), ground coverage, `10%` ROS garden, front/rear/side setbacks ($H/5$, $H/4$), building height vs. road width, Table 8-A stilt parking norms, minimum room dimensions, ventilation ratios, staircases, and fire-safety rules.
   - Display violations with explanations and exact UDCPR clause citations, accompanied by a mandatory statutory disclaimer requiring professional verification.

4. **Blender 5.2 Realistic 3D Architecture, Explode, Customization & Floor Isometric Editor:**
   - **Blender 5.2 Pipeline:** Generate realistic architectural 3D models from approved floor plans including exterior finishes, interior walls, doors, windows, glass facades, chajjas, balconies, railings, facade panels, slabs, columns, beams, PBR materials, textures, lighting, and shadows (never plain white boxes).
   - **Individual Floor Isometric Editor:** Interactive 3D isometric editor for every individual floor (`Stilt`, `1st–4th Floors`, `Terrace`) with 2D/3D switching, rotation, zoom, selection, and live editing synchronized with the full building and geometry validator.
   - **Explode & Live Customization:** Interactive building explode + real-time 3D customization of doors (designs, materials, sizes, swings), windows (sliding, casement, fixed glass), and furniture (beds, sofas, dining tables, wardrobes, kitchen cabinets, bath fixtures) respecting actual room clearances.
   - **Complete Building Assembly:** Full multi-story assembly with accurate slab, staircase, column, and beam alignment, day/night lighting, and exterior/interior inspection.

5. **ETABS Structural Analysis & Error Reporting PDF:**
   - Generate structural grids, columns, beams, floor elevations, and structural models transferred via verified ETABS `.e2k` / CSI API.
   - Apply Indian Standard codes (IS 456, IS 1893 seismic, IS 875 dead/live/wind loads), load combinations, beam/column design checks, displacement, storey drift, and member utilization. Never fabricate structural safety results.
   - Capture actual ETABS errors, warnings, and failed checks into a professional PDF report containing ETABS screenshots, error locations, affected members/floors, severity classification, causes, and suggested engineering corrections, with preview, save, reopen, and independent export options.

6. **Independent File Export — Highest Priority:**
   - Every generated artifact MUST have its own independent export and preview trigger:
     - **Architectural:** Individual floor plans, complete plans, dimensions, elevations, sections, column layouts, and beam layouts.
     - **CAD:** Individual sheet `.DWG`/`.DXF` and complete `.DWG`/`.DXF`.
     - **3D:** Individual floor models, complete building, exploded model, Blender `.blend`, and `.gltf`/`.glb`/`.obj`.
     - **PDF & Documentation:** Individual floor drawings (`FIT_TO_PAGE` scale safeguard), complete drawing set, Geometry Validation Report, UDCPR Compliance Report, ETABS Structural Report, Error Report, and individual screenshots.
   - Verify every exported file on disk/buffer before reporting success.

---

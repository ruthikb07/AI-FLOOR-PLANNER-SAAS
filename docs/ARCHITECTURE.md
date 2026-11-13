# AI Building SaaS — System Architecture

## 1. Product and maturity

AI Building SaaS is an **AI-assisted residential architectural design platform under active development**. Existing foundations generate, edit, evaluate and display building data. They do not establish that every output is architecturally sound, professionally validated, construction ready or production ready.

The active delivery plan is [ROADMAP.md](ROADMAP.md). V1 includes editable residential 2D, meaningful alternatives, coordinated multi-floor architecture, review/finalization, professional exports, canonical-model-driven Blender architecture and elevations/presentation. Structural engineering, foundations/reinforcement, structural 3D and quantities/BOQ/costing are DEFERRED_POST_V1.

Audit anchor: e968720. Source and current verification override this documentation snapshot.

## 2. Canonical authority and flow

Requirements/site/reviewed Program → AI brief interpretation (optional) or rule-based interpretation → validated structured intent → deterministic architectural planner → canonical Building Model with deterministic geometry → architectural validation/evidence/ranking → 2D renderer/editor → reviewed/finalized canonical revision → professional exports and Blender adapter → reproducible architectural 3D/elevations.

The finalization and Blender portions are PLANNED_V1 completion work, not a claim of an implemented end-to-end flow.

The Building Model is the sole authoritative geometry. Requirements/Program metadata describe intent; desired adjacency and ownership do not prove physical doors. AI may interpret, propose and explain, but must not directly author authoritative geometry, bypass validation or invent engineering inputs.

SVG, React state, Three.js projection and Blender meshes cannot become competing building models. There is no AI image-generation path: no image model participates in deciding layout, counts or geometry, and no geometry is read back out of an image. Editing changes canonical data. Dependent evidence, exports and 3D must be invalidated/regenerated for that revision. Full Building-plus-reviewed-Program freshness remains incomplete.

## 3. Current implementation versus targets

IMPLEMENTED denotes code foundations, not professional/product acceptance. PARTIALLY_IMPLEMENTED denotes incomplete V1 capability. PLANNED_V1 describes future delivery.

| Component | Status | Reality and limits |
|---|---|---|
| core | IMPLEMENTED | Canonical entities, factories, immutable updates, serialization, site/Program/footprint and editor-domain foundations. Not a structural analytical model. |
| geometry-engine | IMPLEMENTED | Deterministic geometry and placement checks; not architectural or engineering approval. |
| constraint-engine | IMPLEMENTED | Configured hard checks, soft heuristics, statuses and explanations. Regulatory provider returns no jurisdiction rules; structural-named rules are not engineering analysis. |
| planning-engine | PARTIALLY_IMPLEMENTED | Strategies/ranking, multi-floor planning, repair/targeted regeneration and evidence exist. Layout quality, diversity and complete acceptance remain active work. |
| ai-orchestration | IMPLEMENTED | Provider abstraction, Gemini/OpenAI adapters, normalized brief-interpretation/edit-intent foundations and rule-based interpretation. Image generation, image-to-plan vision interpretation and visual preflight were removed; the package no longer contains an image provider. No implemented Claude adapter found in the provider directory. |
| renderer | IMPLEMENTED | Canonical SVG rendering/export foundation; professional semantic/sheet completeness still needs acceptance. |
| frontend | PARTIALLY_IMPLEMENTED | React/Vite site, Program, footprint, generation, editor, validation, export and model workspaces; local persistence. Not a completed professional workflow. |
| projection-3d | IMPLEMENTED | Canonical browser projection with source IDs, units, levels, floor plates, walls/openings and schematic elements. Not detailed Blender delivery. |
| Review/finalization | PARTIALLY_IMPLEMENTED | Validation/project-persistence foundations; complete revision-finalization and scoped acceptance remain planned. |
| Blender integration | PLANNED_V1 | The separate JSON-wall experiment is outside the primary repository; no integrated canonical Blender bridge established. |
| Professional DXF/DWG | PLANNED_V1 | Current export service offers SVG/PDF/JSON. Genuine DWG needs supported tooling where feasible. |
| Backend services | PLANNED_INFRASTRUCTURE | packages/backend is a directory skeleton, not an implemented API/package establishing hosted services. |
| Structural engineering / BOQ / costing | DEFERRED_POST_V1 | Preserve future interfaces without implementing these capabilities in V1. |

## 4. Current runtime and infrastructure

The frontend uses React, Vite, Three.js, a repository-owned editor store and custom SVG rendering. TypeScript libraries supply domain/planning/geometry/constraint/AI functionality. Vitest tests and pnpm/Turborepo scripts exist; sandbox/configuration limitations may affect which verification commands run.

Current persistence uses browser local storage and JSON interchange. Do not describe it as PostgreSQL persistence, cloud backup or authenticated multi-user isolation.

Fastify, PostgreSQL, Redis, ORM/database services, object storage, authentication/organizations, billing and hosted jobs are **PLANNED_INFRASTRUCTURE**. Earlier diagrams depicting these as running components were aspirational. Infrastructure must follow the supported deployment workflow; full SaaS billing is not a prerequisite for local architectural development.

## 5. Generation, editing and evidence

The frontend collects site, Program and footprint inputs. AI can interpret requirements into structured intent, with normalization and a rule-based alternative; that intent is validated deterministically before it reaches geometry. Deterministic generation creates candidate Buildings, checks geometry/hard requirements and soft preferences, applies existing repair/optimization and returns ranked candidates. Architectural evidence records observations; it neither replaces legacy ranking nor completes final acceptance.

Phase 1 evidence covers required floor intent, explicit bath ownership, physical direct/reviewed private-indirect access, shared/unresolved/not-evaluated states, wet geometric coverage and outdoor/residual observations. ArchitecturalEvidencePanel handles versioned evidence and stale Building revisions. Reviewed-Program freshness, broader acceptance and review/finalization status remain incomplete.

Editor commands operate on canonical data with selection, undo/redo and persistence foundations. Supported workflows require end-to-end verification; do not claim that every conceivable mutation has complete validation or that every historical revision is recoverable without evidence.

RBEA references provide redacted semantic/topological evidence, not generator coordinates. Preserve provenance and uncertainty; names, proximity, ordering and desired graph edges do not establish physical private access.

## 6. Export and Blender boundary

SVG/PDF/JSON export exists. PDF uses fit-to-page scaling and simplified room/opening drawing, so professional scale, geometry, symbols and sheet fidelity remain delivery work. DXF must carry genuine interoperable geometry; DWG requires legitimate supported conversion/tooling, never renaming another format.

The browser projection is separate from the planned **finalized canonical Building → Blender adapter → reproducible Blender model**. Preserve source IDs, units, axes, levels, revision identity, wall dimensions and openings. Regeneration must reflect canonical edits without independent redesign.

Architectural targets include floor plates/slabs, doors/windows, stairs/railings, balconies/terraces/parapets, applicable roofs, materials and site/context. Front/side/rear elevations, exterior perspectives, facade detail, cameras and lighting derive from that geometry. Architectural slab representation is not structural slab design. AI imagery may assist presentation later, never replace geometric truth.

## 7. Security, professional status and verification

The optional VITE_GEMINI_API_KEY frontend configuration is development-only: a client build-time variable exposes the key in frontend assets. Before public release, credentials must remain server-side and browsers call an appropriate backend boundary. Do not record secret values in documentation.

Authentication/authorization, request isolation and hosted data controls are planned—not guaranteed current protections. Provider inputs require minimization/validation; missing engineering inputs remain absent or unknown.

Configured checks and tests demonstrate internal behavior, not load paths, capacity, reinforcement, seismic safety, statutory compliance or construction readiness. Professional review and successful release/build verification are separate gates. A blocked build is BUILD_ENVIRONMENT_BLOCKED, never PASS.

## 8. Future extensibility

Preserve clean canonical floors, walls, openings, rooms, stairs, levels, site and existing support/grid data. Do not add speculative structural systems. A later version may derive an analytical model from finalized architecture, then use validated loads/combinations, solver, reactions, BM/SF/stress/deflection, member design, geotechnical input, foundations, reinforcement and structural 3D under professional oversight. Quantity take-off, BOQ and costing are also later-version work.

No whole-product completion date is asserted. Follow bounded tasks, actual verification and reviewed checkpoints in the active roadmap.

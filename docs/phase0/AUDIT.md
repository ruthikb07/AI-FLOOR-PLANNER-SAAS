# ARGON 4 Phase 0 audit and Phase 1–7 implementation roadmap

Audit date: 8 November 2026, Asia/Calcutta. Status: PHASE 0 DELIVERED; IMPLEMENTATION NOT STARTED. The current application is not demonstrated production ready or professionally validated.

## Scope, location and evidence limits

The application repository root is `C:/Users/ruthi/OneDrive/Desktop/AI BUILDING SAAS - Copy/AI BUILDING SAAS - Copy`. The containing workspace also has `plancraft-source`, a separate npm workspace. Run application pnpm commands from the nested root. Existing AGENTS.md engineering rules were preserved and expanded with the complete master vision and the user's received technical answers. Its previous contents are archived in AGENTS.before.md.

Excluded dependency/build directories, ZIP archives and generated backend bundle contents from source review. The inventory enumerates project files and supporting data/assets; inventory.json records path, bytes, SHA-256, text line counts, declared symbols and imports. Automated indexing is not equivalent to manually understanding every file. Deep review concentrated on canonical contracts, generation/repair/closure, geometry accounting, active frontend wiring, projection, CAD/PDF services, regulatory evaluation, tests and configuration. Binary assets were inventoried, not visually reviewed. No exhaustive security, licensing, vulnerability or legal certification is claimed.

The user's follow-up ends after “Inspect packages/projection-3d first”; no additional Blender/ETABS/DWG clarification was received. Existing code was inspected to resolve what could be verified without questions. No current regulatory rule is legally validated by this audit; clause strings below describe repository behavior only. Current official regulations and amendments must be verified during the compliance implementation phase.

## Working tree and permitted writes

Before auditing, git already reported modifications to backend CAD service and generated server bundle, core multi-sheet contracts, App.tsx, studio.css, planning-engine snapper test/solver/index/snapper/furnisher/geometry validator, renderer SVG, and an untracked frontend components/argon directory. These were preserved. The audit changes AGENTS.md and writes docs/phase0 plus command logs only. pnpm health checks invoke dependent builds under Turbo, so generated bundles, caches and TypeScript incremental output can be refreshed even though application source was not edited. Do not attribute the pre-existing edits to this audit. Tests additionally rewrote six tracked DWG/DXF files under output/cad-export and packages/frontend/output/apartment-geometry-closure/06-pdf/scale-reference.pdf. These generated test side effects were left in place; no user source was restored or overwritten.

## Baseline and environment

Node v24.18.0; pnpm 9.7.0, matching the root packageManager declaration. Root engines require Node >=20. Root workspace includes nine packages via packages/*. Turbo test depends on each package's build; typecheck depends on dependency builds. Root test stopped on planning-engine failure. Remaining backend/frontend/AI suites were then run directly. Some root task results were Turbo cache hits; this is a baseline run, not an all-fresh release gate.

| Check/package | Result | Evidence |
|---|---|---|
| pnpm typecheck | Exit 0; 16/16 tasks successful, zero cached | phase0-typecheck.log |
| pnpm test | Exit 1; 13 successful of 17 tasks, 7 cached | phase0-test.log |
| core | 22 files; 192 tests passed | root test log |
| geometry-engine | 3 files; 82 tests passed | root test log |
| constraint-engine | 31 files; 185 tests passed | root test log |
| renderer | 7 files; 88 tests passed | root test log |
| projection-3d | 2 files; 22 tests passed | root test log |
| planning-engine | 4 failed / 38 passed files; 19 failed / 290 passed tests | root test log |
| ai-orchestration, direct follow-up | 19 passed / 2 skipped files; 242 passed / 2 skipped tests | phase0-remaining-tests.log |
| frontend, direct follow-up | 26 files; 140 tests passed | follow-up log |
| backend, direct follow-up | 4 failed / 10 passed / 3 skipped files; 20 failed / 137 passed / 10 skipped tests | follow-up log |
| sibling plancraft npm test | Exit 1: furniture cannot find tsc; DSL/renderer/CLI report zero tests from dist patterns | phase0-plancraft-tests.log |
| Blender CLI | Installed 5.2.1 LTS, executable at C:/Program Files/Blender Foundation/Blender 5.2/blender.exe | live --version probe |
| Blender Python | Background factory-startup import bpy succeeds; prints 5.2.1 LTS | live --python-expr probe |
| ETABS | No executable/API/license verification performed; no bridge implementation found in application source | source inventory/search |

The nine package summaries total 1,378 passed, 39 failed and 12 skipped tests across the root and follow-up runs. These are combined package outcomes, not the output of one successful monorepo run. Exact failed test names appear in FAILURES.md. Planning failures affect apartment-error-repair, multi-sheet-apartment-solver, plancraft-integration and space-filling-snapper. Backend failures affect phase3-honest-gate-fallback, phase4-image-to-2d, phase5-evaluation-and-sweep and two-phase-concepts. Many assertions expect zero closure errors or ACCEPTED plans and currently receive hard errors or REJECTED. Root causes must be diagnosed rather than weakening those assertions.

No standalone fresh release build, lint run, browser visual acceptance, AutoCAD open/reopen, full generated Blender model/render or licensed ETABS run was completed. Existing tests cannot establish those results. No dependency installation or lockfile update was performed.

## Package inventory and ownership assessment

The exact per-file listing, including each test source, is in INVENTORY.md; inventory.json adds symbol/import indexing. Counts include manifests/configuration and package assets, not just executable source.

| Package | Inventoried files | Current role/status |
|---|---:|---|
| core | 82 | Building/Floor/Room/Wall/Opening, requirements/program, geometry, multi-sheet, structural, customizable, ETABS, regulatory and export contracts. Structural/report types exist without corresponding complete execution pipelines. |
| geometry-engine | 32 | Polygon operations, wall classification/extrusion, clipped-cell area ledger and stair solids. Orthogonal ledger implementation; not a general arbitrary-polygon partition proof. |
| constraint-engine | 78 | Registered constraints, context/scoring, closure and apartment acceptance. Default PlanValidator creates a nonempty registry and rejects empty supplied registries. Closure currently mutates input entities. |
| planning-engine | 98 | Candidate/structured/polygon generation, requirement graph, site/massing, apartment extraction/snapper/repair, furnishing, multi-sheet assembly and newer geometry/UDCPR/progress modules. Significant closure regressions. |
| ai-orchestration | 73 | Providers, apartment brief/feasibility/topology, image planning/preflight/evaluation and editing. Test pass with explicit live skips; service credentials belong on backend. |
| backend | 130 | HTTP server, AI artifact/interpretation orchestration, CAD/PDF exporters and persistence; image/reference assets included. Actual CAD serializer exists, but end-to-end acceptance has gaps. |
| projection-3d | 11 | project-building.ts, settings.ts, types.ts, units.ts, index.ts and two test files. Deterministic derived scene model with IDs/revisions, plates, walls, openings, stairs, columns and site. No Blender generator here. |
| renderer | 18 | svg-renderer.ts, configuration, transforms, furniture/symbol renderers and seven test files. Pure Building-to-SVG intent; CAD/PDF annotation parity not established. |
| frontend | 96 | React editor/store/canvas, legacy studio and new active ARGON shell, Three.js scenes, frontend PDF/Blender exporters, export modal and 26 test files. New ARGON workspaces have major incomplete wiring. |
| sibling plancraft-source | 140 | DSL parser/semantic validation, furniture packs/anchor/layout, scene graph/SVG rendering and CLI, plus examples/rules. Separate package/dependency/test lifecycle; pnpm application checks do not cover it. |

Root configuration: package.json supplies build/dev/test/integration/lint/typecheck/release scripts. pnpm-workspace.yaml contains only packages/* and an unusual allowBuilds.esbuild placeholder string; inspect installer compatibility before any future install. turbo.json builds prerequisite outputs. tsconfig.base.json enables strict/composite/declaration settings, bundler resolution and unchecked-index checking. Package vitest aliases often reference sibling src directly; tests can therefore pass despite stale distributable output. Scripts include bundling/dev startup, provider probes, live acceptance utilities and source-rewrite utilities; the audit did not execute mutation/repair scripts. Do not bulk-run scripts as “health checks.”

## Confirmed bugs and gaps against the vision

### P0: reported geometry closure can be false

`packages/planning-engine/src/validator/geometry-validator.ts`, auditRoomAndWallOverlaps, computes abs(floor polygon area - sum room polygon areas), omitting explicit disjoint wall/void accounting. When autoCorrect is true and delta >0.001 it assigns floorDelta=0.0 without repairing the uncovered/overcounted geometry. This directly violates the requested raw conservation invariant. audit() declares validity from uncorrected critical errors, and an error can be marked autoCorrected before a successful repair/re-audit is established. Area overlap is also compared against toleranceMm, mixing mm² and mm.

`packages/geometry-engine/src/apartment-ledger.ts` is the existing accounting foundation: inside-floor orthogonal cells assign wall union first, then voids, then room categories or unassigned. Gross-accounted includes unassigned; delta=0 can coexist with unassigned space and room overlap. Outdoor/balcony cells outside the floor envelope contribute no floor area. Balcony containment exceptions in constraint-engine permit attachment by shared boundary or connecting door, but floor containment is still checked independently. Preserve this distinction and test projected balconies explicitly.

`packages/constraint-engine/src/apartment-closure.ts` currently raises area mismatch only above 1 mm², not the required <0.001 mm². `apartment-walls.ts` also exposes areaDelta:1. Closure strips unitId/tags and rewrites spaceUse in place despite being a validator. It warns only when unassigned/gross exceeds 15%; a zero ledger delta is not sufficient acceptance. Party-wall thickness check permits values >=220 while its message states minimum 230. Wall generation itself maps exterior/party=230, common/core=150, shaft=100, internal=115; align validation and every entry path without breaking historical fixtures.

### P0: generation handler audits the previous state and discards the brief

`frontend/src/App.tsx` now mounts ArgonStudioShell. Its handleGenerate creates initialBuilding and calls editor.setBuilding, then immediately passes editor.building from the current render to executeAuditedPlanningPipeline. The newly created local building is not the supplied argument. Road width/facing, setbacks, floor/stilt configuration, BHK mix, areas, AI prompt and reference data do not reach that call.

`planning-engine/src/pipeline/stage-progress-emitter.ts` names stages PLOT_BOUNDARY_SOLVE and UNIT_SPATIAL_SLICING but runs no layout generator: it audits existing rooms/openings/columns, re-audits, evaluates the provisional compliance engine, then emits COMPLETE. It does not reject invalid geometry/noncompliance before completion. These events are actual emissions but do not demonstrate genuine generation stages. The existing completion test asserts emitted names and a permissive validity result, not request fidelity. Errors in the shell catch path only log to console and dismiss generation state.

### P0: compliance and structural claims are not measured results

`planning-engine/src/validator/udcpr-engine.ts` sets provided setbacks equal to required setbacks, invents provided parking as max(required,4/8), uses fixed actual travel distance 18,000 mm, initializes stair width even if no stairs exist, guesses jurisdiction from whether roadWidth exists, defaults FSI to 2.0 and permits a 1% FSI overrun. “Open space” is plot minus plinth, treated as recreation, with a hardcoded 15% threshold. It has no requested authorityType/congestionZone contract or verified amendment applicability. These are implementation observations, not endorsed statutory rules.

`frontend/src/components/argon/UdcprEtabsAnalysis.tsx` ignores its editor prop, shows fixed FSI/unit/setback/checklist data, and claims “Structural Integrity Validated” and ETABS verification with generic soil bearing capacity. Its audit/download buttons have no execution handlers. No .e2k/CSI API bridge, actual solver run capture, load combinations/check execution or ETABS screenshot/error PDF generator was found. core/types/etabs.ts provides interfaces only and lacks an explicit unavailable/not-run state. Remove unsupported claims in Phase 1 before presenting engineering acceptance.

### P1: independent export center is currently a static catalog

`frontend/src/components/argon/ExportCenterWorkspace.tsx` ignores editor state; preview, download and bulk export buttons have no handlers. It permanently claims all 14 artifacts verified with a fixed generation time, while its catalog has 12 entries. It labels a compliance “Certificate” without professional approval. Manifest types exist in core, but the active center does not load verified artifact records.

Real underlying export functionality exists: backend cad-export-service.ts uses @node-projects/acad-ts for binary DWG/ASCII DXF with architectural layers, units, model-space flags, dimensions/furniture/structural geometry and scope options. server.ts exposes DWG/DXF/PDF/persist/download endpoints. frontend advanced-export.ts and ExportModal.tsx provide separate export paths and FIT_TO_PAGE safeguards. Reuse and reconcile these; do not replace genuine CAD with renamed text.

CAD verification is too permissive: DWG reader errors are caught, yet validation.isValid only checks nonempty data and AC prefix; DXF “roundTripVerified” checks a SECTION token/size, not a full parse. Reader success/header presence is not geometric fidelity or AutoCAD acceptance. Fixed buffers/private writer-position probing create scale/compatibility risks to test. Regenerating walls/furniture during export also requires parity checks against the approved canonical revision.

Backend pdf-export-service.ts always fits bounds to page but title text says 1:100 ISO A3, even with other paper/scale settings. It falls back to a fabricated blank floor for empty buildings or unknown floor IDs. Frontend PDF path has explicit exact/fit behavior, leaving two differing implementations. Sections/elevations, separate geometry/regulatory/ETABS reports, verified 3D format files and reopenable report previews are not complete in the active hub.

### P1: 3D UI controls and floor selection are incomplete

`FloorIsometricEditor.tsx` displays fixed Stilt/1st–4th/Terrace IDs and heights. Selection changes local text state only; it does not call editor.switchFloor or choose the canonical floor. The viewport is ArchitecturalCanvas (2D), not a floor-specific Three.js isometric editor.

`Building3DCustomizer.tsx` embeds the real ModelWorkspace, but its outer explode slider and day/night states are not passed into that workspace or its scene. Fixture/furniture options are not demonstrated validated canonical edits, and “60 FPS” is fixed text. Existing underlying ModelWorkspace supports canonical selection/floor switching and export functions; wire controls to one shared scene state rather than layering disconnected controls.

ARGON components extensively use Tailwind utility classes, but no Tailwind dependency/plugin/config, utility directives or CDN setup was found in the frontend configuration. Existing CSS is a separate design system. This strongly suggests missing layout/appearance for the new shell; browser visual verification is still required before claiming actual overlaps or pixel behavior.

### Partial Blender capability; full realism/export contract missing

Blender Python generation exists in frontend/src/services/blender-export.ts, not projection-3d. It exports current building ID/version, triangulated plates, box wall segments/openings and actual stair solids; generated Python creates materials, camera, sun, Cycles settings and saves a .blend. It includes a Windows launcher and stale-projection/stair checks. CLI/bpy prerequisites pass on this machine.

This is not a verified photorealistic architectural pipeline: the payload does not include projected columns, beams, full furniture/customization, facade/chajja/railing assemblies or texture libraries. .glb/.gltf/.obj/exploded/per-floor exports and real output reopen checks are not established. No sample generated script/model was executed in this audit. Rendering filepath/settings are configured but no render invocation appears in the script. Backend ownership, job isolation, artifact provenance and actual file validation remain work.

### Architectural boundary gaps

Canonical core contracts and pure renderer/projection foundations are useful. However frontend currently imports planning/constraint/AI packages and owns engineering export generation; the desired strict backend boundary is not yet implemented. Shared TypeScript interfaces do not validate untrusted HTTP/runtime inputs. Structural and new canonical staircase types also coexist with older stair/column representations, requiring explicit adapters and one authoritative editing path. Successful legacy unit tests cannot prove the newly selected ARGON product route works.

## Phase 1–7 implementation roadmap

Each phase ends with focused regression tests, affected package checks, full relevant suite/typecheck/lint/build and a diff review. Record failures and skips separately. Do not start a later phase on assumed acceptance; engineering outputs always require professional verification.

### Phase 1 — truthful generation, geometry and baseline recovery

Files: frontend/components/argon/ArgonStudioShell.tsx, ProjectSetupWizard.tsx, GenerationProgressModal.tsx, UdcprEtabsAnalysis.tsx, ExportCenterWorkspace.tsx; planning-engine/pipeline/stage-progress-emitter.ts, validator/geometry-validator.ts, interpretation/space-filling-snapper.ts, repair/apartment-error-repair.ts, apartment/multi-sheet-apartment-solver.ts; geometry-engine/apartment-ledger.ts and apartment-walls.ts; constraint-engine/apartment-closure.ts; core/types/geometry-validation.ts and requirements/program contracts.

Tasks: map the complete wizard request to canonical requirements and invoke the actual solver using the correct new building; retain revisions/provenance; make stage names correspond to executed work and propagate failures. Replace fake delta assignment with measured disjoint accounting; distinguish units/area tolerances, holes/overlap/unassigned, balcony projection accounting and invalid polygons. Make closure pure; revalidate bounded repairs; enforce wall hierarchy and access continuity. Remove static verified/safe/certificate states and expose unavailable status until real evidence exists. Diagnose all 39 failed cases; preserve valid historical geometry expectations without preserving deceptive success semantics.

Gate: adversarial gap/overlap/duplicate-wall/balcony/failed-repair fixtures cannot pass by rounding; raw area error <0.001 mm², independent complete-partition checks, exact program/core/floor fidelity; no state mutation from validation. Two distinct wizard briefs produce the correct distinct plans. All existing failing suites recovered without weakened checks. Unsupported structural/compliance/export results display not-run/unavailable.

### Phase 2 — independent exports first

Files: core/types/export-manifest.ts; backend/services/cad-export-service.ts, pdf-export-service.ts, server.ts, duplicate api/export-routes.ts and routes/export-routes.ts; frontend/services/advanced-export.ts, components/modals/ExportModal.tsx and argon/ExportCenterWorkspace.tsx. Proposed additions: backend/services/artifact-verifier.ts and artifact-registry.ts, frontend/services/export-client.ts.

Tasks: consolidate production route/contracts and PDF scale behavior; bind every available per-floor/site/full-project CAD/PDF/geometry-report artifact to its own preview/download; explicitly mark future types unavailable. Fail closed on parse/verification failure; store revision, scope, bytes, checksum and verification details. Reject invalid floor IDs/empty geometry; remove fabricated export floors. Preserve AC1032/mm/TILEMODE and entity/layer fidelity; collision-check annotations in drawing coordinates. Show FIT_TO_PAGE as not-to-scale. Stop fixed filenames from obscuring revision-specific artifacts.

Gate: create files, parse/reopen them, compare canonical bounds/entities/openings/layers/units and verify checksums; wrong/corrupt/stale files fail. Independently open representative DWG/DXF in AutoCAD or a qualified compatible viewer, and render PDF pages to confirm no crop/text collisions and honest scale. Every active center button performs its advertised action. Unimplemented exports cannot report success.

### Phase 3 — authoritative, parameterized UDCPR/NBC assistance

Files: core/types/udcpr.ts and requirements.ts; planning-engine/validator/udcpr-engine.ts; ai-orchestration/apartment/jurisdiction.ts; frontend/argon/ProjectSetupWizard.tsx and UdcprEtabsAnalysis.tsx. Proposed: planning-engine/compliance/rules/*, jurisdiction-context.ts, source-registry.ts; backend/services/compliance-report-service.ts.

Tasks: implement the approved authority/congestion/project inputs with explicit mm↔m/mm²↔m² conversion. Verify official source editions/amendments and authority-specific applicability before encoding FSI components, coverage, ROS, setbacks/height/road width, parking, ventilation, rooms, stairs/fire checks. Measure provided geometry/bays/routes rather than assume them. Include source clause/effective date, uncertainty/missing-data states and statutory disclaimer in UI and standalone PDF.

Gate: independently reviewed source-backed boundary fixtures for each jurisdiction/zone; no-stair/no-parking/missing-height cases cannot pass; basic/premium/TDR/ancillary accounting remains distinct; changing geometry invalidates report revision. Licensed review remains required; no automated “certificate.”

### Phase 4 — real floor isometric editing and live customization

Files: frontend/argon/FloorIsometricEditor.tsx, Building3DCustomizer.tsx, model-3d/ModelWorkspace.tsx, ThreeBuildingScene.tsx and supporting scene builders; frontend/stores/editor-store.ts; projection-3d/project-building.ts, types.ts/settings.ts; core/types/customizable.ts; geometry-engine stair/clearance operations.

Tasks: derive floor selectors/elevations from Building, use the real 3D viewport, connect explode/lighting/selection consistently, and implement door/window/furniture commands with canonical IDs, undo/redo and geometry/clearance checks. Resolve the utility-CSS integration and responsive layout through one design-system choice. Keep canonical geometry independent of explode transforms.

Gate: edit a selected floor element and verify corresponding 2D, 3D, validator and export revision changes; invalid clearances blocked; floor switching works for arbitrary counts/heights; undo restores model. Browser interaction/visual checks across desktop and narrow sizes; no fixed performance or completion claims.

### Phase 5 — backend Blender 5.2 realism and 3D artifact verification

Files: projection-3d/project-building.ts/types.ts; frontend/services/blender-export.ts and export center. Proposed: backend/services/blender-job-service.ts, blender-script-generator.ts and blender/templates/*; core 3D artifact/job contracts.

Tasks: move procedural execution/generation to the engineering boundary with validated revision-specific inputs and isolated jobs; preserve existing script-download behavior until parity. Add columns/beams, accurate doors/windows, stairs, slabs, rails/balconies/chajjas/facades and parameterized PBR assets. Support individual floor/full/exploded .blend/.glb/.gltf/.obj plus previews and day/night rendering.

Gate: execute real 5.2 background jobs; verify return codes, nonempty files, reopen .blend through bpy, validate mesh/entity IDs/bounds/alignment/material references and render sample views. Validate each promised exchange format with a parser/viewer; failed jobs never leave verified flags. Approve visual realism separately from geometry correctness.

### Phase 6 — real ETABS bridge and error PDF

Files: core/types/etabs.ts, structural.ts and building.ts; geometry-validator structural suggestions; frontend/argon/UdcprEtabsAnalysis.tsx and export center. Proposed: backend/structural/etabs-adapter.ts, model-mapper.ts, analysis-inputs.ts, result-parser.ts, etabs-report-service.ts and licensed integration fixtures.

Tasks: discover licensed ETABS version/API compatibility; distinguish architectural suggestions from engineer-approved structural input. Generate grids/stories/members, materials/sections, restraints, diaphragm assumptions, explicit Indian-code edition/load inputs and combinations; transfer via verified .e2k/OAPI. Capture solver return codes, logs, actual drift/displacement/design results and member mapping. Generate standalone PDF with actual screenshots, errors/warnings, locations/floors/severity, provenance and suggested corrections requiring engineering review.

Gate: engineer-reviewed benchmark matches a manually constructed ETABS case, including deliberate unstable/overstressed cases; no solver/license/missing-input condition yields SAFE/PASS. PDF preview/save/reopen and per-artifact export verified. Never derive safety from column spacing, generic soil assumptions or a mocked report.

### Phase 7 — integrated production acceptance and hardening

Files: all affected packages; root package.json/turbo.json; tests/integration and release/acceptance scripts; artifact storage/contracts, frontend shell/workspace/error handling.

Tasks: verify Plot→solver→geometry→regulatory→CAD→3D→Blender→ETABS→reports/export sequence with canonical revisions and invalidation; preserve independent exports at every available stage. Add job cancellation/retry/idempotency, input validation, credential boundaries, persistence/reopen, resource limits and representative scale cases. Pin dependency/tool compatibility and document operational/professional boundaries.

Gate: fresh install/build/test/typecheck/lint; separate sibling workspace build/test; browser end-to-end request fidelity and zero-overlap layout checks; real generated file reopen for every advertised format; live Blender and licensed ETABS evidence; source-reviewed jurisdiction cases; stale artifacts invalidated after edits. Report software acceptance separately from licensed design approval.

## Phase 0 disposition

Architecture instructions and source inventory are persisted. Application source was left unchanged by this audit. Confirmed blockers are documented; passing typechecks do not override the 39 test failures or unsupported engineering claims. Ready to execute Phase 1 after the next instruction. Stop here; do not implement roadmap changes during Phase 0.

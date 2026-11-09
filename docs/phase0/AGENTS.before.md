# Engineering rules

## Canonical model

The canonical Building Model is the sole authoritative building state. Requirements and AI interpretation feed structured intent; the Geometry Engine owns geometry, the Constraint Engine owns validation, the renderer handles visualization, and the frontend/editor handles orchestration. SVG, canvas, React components and Three.js must never become independent authoritative geometry. 3D remains a projection of the canonical Building Model.

## AI and engineering safety

AI may interpret, propose and explain. It must not invent or certify soil properties, structural safety, loads, reinforcement, foundations, seismic adequacy, code compliance or professional approval. Safety-critical engineering requires required inputs, validated deterministic calculations/solvers and professional review. Missing safety-critical input must produce explicit uncertainty or blocking, never fabricated assumptions.

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

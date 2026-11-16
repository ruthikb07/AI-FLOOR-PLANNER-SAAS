# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Build all:** `pnpm run build`
- **Lint all:** `pnpm run lint`
- **Test all:** `pnpm run test`
- **Typecheck all:** `pnpm run typecheck`
- **Full Release Verification:** `pnpm run verify:release` (Runs tests, typecheck, build, and lint)

This project uses `turbo` for monorepo orchestration.

## Architecture

This is an AI-powered architectural platform built as a monorepo.

- **`packages/core`**: Authoritative domain models, entity contracts, and validation schemas. All packages import from here to maintain consistency.
- **`packages/geometry-engine`**: Deterministic polygon operations and area ledgers.
- **`packages/constraint-engine`**: Plan validation and closure decisions.
- **`packages/planning-engine`**: Layout solving and topological planning.
- **`packages/frontend` / `packages/renderer`**: UI orchestration, 2D CAD editor, and 3D isometric viewer.
- **`packages/backend`**: Engineering bridge services (CAD serialization, Blender pipeline, ETABS analysis).

## Engineering Rules (from AGENTS.md)

- **Canonical Truth:** The Building Model is the sole authority. 3D/SVG are projections of this model.
- **Safety:** AI may propose but not certify engineering safety (structural, compliance, etc.). Always indicate when professional review is required.
- **Geometry:** Aim for `0.000 mm²` planar area error. Adhere to Indian wall thickness hierarchies.
- **Discipline:** Do not modify `packages/projection-3d` during 2D work unless required.
- **Verification:** Passing software checks does not constitute professional validation. Record evidence; do not assume success.

# Residential computational engine hardening

2026-11-09 — INTERNAL ENGINEERING GATE PASSED

Production source changes for this task are confined to geometry-engine, planning-engine, and constraint-engine. Existing unrelated working-tree changes were preserved. The repository-wide checks also built downstream packages; no frontend, renderer, or projection-3d source was edited for this task.

## Implemented behavior

- `ColumnGridGenerator` searches bounded regular 3000–6000 mm bay configurations against the registered wall envelopes and road-relative setbacks. It generates matching column grids through every registered physical floor, rejects floating/clustered supports, and excludes balconies, voids, cores, and opening/swing envelopes. Columns are provisional geometric sections, not engineered member sizes.
- `BeamNetworkGenerator` generates 230 mm primary connections plus exterior and balcony perimeter members. It rejects disconnected networks and obstruction of registered vertical openings. Its 450 mm provisional depth is a geometry placeholder, not a calculated structural requirement.
- `VerticalCoreContinuitySolver` checks stair enclosure, flights, landing, and lift footprint continuity, common access, ground discharge to a registered driveway with site-gate connectivity, a measured 1500 mm lift cutout, and hosted 900 mm sliding lift doors. It rejects incompatible cores instead of relocating them speculatively.
- `StiltLevelEnclosureGuard` checks actual marked parking bays, driveway clearance, absence of flats, permitted enclosures, and measured security cabin area. Parking and enclosure generation remains with the existing canonical apartment generator; the guard does not invent stalls or replace incompatible layouts.
- `ApartmentUnitPacker.pack` delegates layout creation to the existing canonical multi-sheet solver, then validates living-room entry, room access topology, bedroom count, measured habitable window area, wet-room adjacency, and wall roles/thicknesses. Invalid configurations raise the coded infeasibility error. An incompatible generated layout is rejected rather than reported as a successful pack.
- `OpeningIntegritySolver` proposes bounded jamb adjustments and validates owner-room registration, aperture overlaps, conservative swing conflicts, column obstructions, and exterior bedroom access.
- Geometry now supports straight-edge skewed partitions through event-based trapezoidal integration. Historical orthogonal accounting, clipped wall union, explicit voids, and balcony intersection accounting remain intact. No rounding or residual correction is used for acceptance.
- `validateRawPlanarConservation` independently rejects raw area error, unassigned area, overlaps, and room/void overlap at the strict 0.001 mm² threshold.

## Integration contract and limits

The planning-engine exports `generateHardenedResidential(config)` and `hardenResidentialBuilding(building)`. These are explicit strict-profile APIs. Existing/default generation entry points and UI orchestration have not been redirected to them.

`hardenResidentialBuilding` stages opening, column, and beam proposals, then runs the independent topology, enclosure, area, closure, and geometry gates. Failure returns the original canonical Building reference and `SOLVER_GEOMETRY_INFEASIBLE`; success publishes a single revision and marks the layout provisional. Configuration failures before a Building exists throw `SolverGeometryInfeasibleError` with the same code. Results always state `structuralAnalysis: NOT_RUN`.

The structural profile currently supports registered, unrotated rectangular site/floor envelopes. Skewed area measurement support does not imply skewed structural-grid generation support. Grid search and planar arrangements have explicit work limits. Missing floor roles, a missing terrace level, unsupported geometry, or incompatible physical constraints produce rejection.

Swing hinge handedness is unavailable in the canonical contract, so opening/column checks use conservative envelopes. Close doors and beams touching full registered core envelopes can be rejected even where a more detailed engineered solution could work. These solvers do not infer reinforcement, loads, soil, foundations, or member capacity. Gate connectivity uses explicit site links and boundary geometry; it is not a fire-egress simulation.

RBEA fixture dimensions remain evidence-only under AGENTS.md. No historical client coordinates, drawings, or PII were copied. Numeric hardening policies come from this task's brief (`ASSERTED_FROM_BRIEF`), not a claim of independently verified RBEA or statutory design standards.

## Verification

| Gate | Actual result |
| --- | --- |
| New focused suites | 70 tests passed across 5 files |
| Geometry package tests | 82 passed |
| Planning package tests | 435 passed |
| Repository typecheck | 16/16 tasks successful |
| Repository lint | 16/16 tasks successful |
| Full repository tests and dependency builds | 18/18 tasks successful; 1551 tests passed, 7 existing opt-in tests skipped |
| Scoped tracked diff whitespace check | Passed |

All five required gate commands exited zero on their first attempt. Exact commands, timings, and exit codes are in [gate-results.json](gate-results.json). Package totals are in [test-counts.json](test-counts.json); complete output is in the adjacent gate logs.

The 50 parametric area cases alternate rectangular and sheared envelopes with varying dimensions and a real partition-wall footprint. Each asserts raw `abs(gross - accounted) < 0.001`, zero overlap, and negligible unassigned area while deliberately poisoning cached Room.area. Additional cases cover a microscopic gap despite zero total residual, overlap, clockwise clipping, and an independently known skewed void area. Structural tests exercise six-level continuity, excessive bays, alternative grid counts, clustered supports, balcony/void exclusions, and later-stage transactional rollback. Core, opening, and layout suites contain both accepted isolated examples and adversarial rejection cases. No complete building passing every strict-profile stage is established by these fixtures; the aggregate integration test establishes rollback on rejection.

This status describes internal software verification only. PROFESSIONAL REVIEW REQUIRED. Automated checks provide engineering design assistance and require verification by a licensed Architect/Engineer before municipal submission.

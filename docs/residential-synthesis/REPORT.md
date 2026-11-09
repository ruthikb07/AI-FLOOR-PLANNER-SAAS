# Multi-story residential synthesis

2026-11-09 — INTERNAL ENGINEERING GATE PASSED.

The new `MultiStoryResidentialSynthesizer` generates a complete canonical building from dimensions and unit intent. `generateHardenedResidential(config)` now invokes this pipeline. The rectangular and skewed benchmarks successfully pass the combined strict checks; the previous limitation of having only isolated accepted examples is resolved.

## Generated assembly and acceptance

The layout builder first computes the road-relative setback envelope and fixes a common core and structural footprint. It procedurally packs two residential wings around that anchor, with living-room entrances, private circulation, 2BHK/3BHK inventories, exterior-facing habitable windows, exterior wet-room adjacency, balconies, and explicit bathroom ownership when requested. Ground geometry contains actual marked stalls, open circulation, security and meter rooms. The roof contains open terrace regions, parapets, the stair cover and lift machine room.

The orchestrator then runs the column, stilt, unit, beam, opening, and terrace/core stages in sequence. Final acceptance uses the shared raw planar conservation, apartment closure, geometry audit, and canonical runtime schema checks. Every floor must have raw absolute area error below 0.001 mm², with overlap, unassigned area and room/void overlap checked independently. There is no residual correction or rounding before acceptance.

A successful proposal publishes one revision. A failed synthesis throws `SolverGeometryInfeasibleError`, code `SOLVER_GEOMETRY_INFEASIBLE`, with stage/member diagnostics and coordinates where available. The caller's configuration is never mutated and no partial building is returned. Existing-building hardening continues to return the original Building reference on rejection.

## API

```ts
const result = generateHardenedResidential(config);
const building = result.building; // authoritative canonical state

// Optional surveyed geometry uses the canonical Site.plotBoundary type:
const surveyed = new MultiStoryResidentialSynthesizer().synthesize({
  ...config,
  plotBoundary,
});
```

The result includes the canonical building, structural and permissible envelopes, completed stages, revision-associated floor ledgers, and opening ID registries. Columns reside in each Floor.columns registry; beams reside in Floor.beams and Building.beams; canonical stairs are registered on both the floor and building. Status fields are `statutoryStatus: INTERNAL_GATES_PASSED`, `structuralAnalysis: NOT_RUN`, and `professionalReviewRequired: true`.

For later edits, use `hardenResidentialBuilding(editedBuilding, result.structuralEnvelope)` to retain the explicit structural footprint distinct from balcony extensions. Cached result ledgers describe their recorded revision; recompute them after edits.

## Geometry corrections required for integration

- Structural footprints are distinct from the gross slab polygon and cantilever balconies. Columns remain continuous through all physical floors.
- Split wall segments are evaluated as a bearing-wall union, including closed perpendicular wall junctions. Semantic wall segmentation remains intact.
- Beam/core collision checks use clear opening area after actual enclosing wall solids. Explicit void boundaries always remain full exclusions.
- Beam generation removes already covered collinear intervals, avoiding duplicate primary/perimeter/cantilever members while preserving real crossing joints.
- Bounded grid fallback tries alternative bay counts and interior shifts of 300, 600 and 900 mm in either direction. It preserves end lines, 3000–6000 mm spans, clearance checks, the 64-trial limit and the node budget. A regression case requires a shifted division to avoid openings.
- Parking checks accept valid convex surveyed plot boundaries and normalize wall clipping orientation, so a wall intrusion cannot disappear because its polygon is clockwise.
- Cardinal road frames preserve physical geometry and setback roles. Skewed ground and roof slabs include disjoint, explicitly assigned open circulation polygons.
- Core's existing schema defines Room.area as width × height. Nonrectangular circulation rooms retain that nominal bounding-box cache and carry identifying tags. Their exact areas come from canonical polygon integration, never Room.area. The raw ledger is the area acceptance authority.

## Demonstrated benchmarks

| Case | Physical floors | Columns per floor | Total beams | Largest raw absolute area residual |
| --- | --- | --- | --- | --- |
| 18 × 25 m rectangular plot, 12 m road, stilt + 3 residential + terrace | 5 | 20 | 191 | 1.1920928955078125e-7 mm² |
| 20 × 26 m extents, surveyed trapezoidal plot, stilt + 4 residential + terrace | 6 | 20 | 229 | 5.960464477539063e-8 mm² |

The rectangular benchmark verifies column identity through all floors, real parking and aisles, living-room entries, nonduplicated beams, canonical schema validity, and successful revalidation through the existing hardening API. The skewed benchmark has genuinely nonorthogonal ground and terrace boundaries and passes canonical schema and raw ledger checks. Additional integration cases cover four cardinal road directions with four residential levels, deterministic repeated geometry, atomic rejection of corrupted edits, attached bathroom ownership, duplicate unit identity rejection, and a real wall obstruction in a marked stall. A 6 × 6 m plot consumed by 3 m margins fails with the required coded error without changing the input.

Measured outputs are recorded in [benchmarks.json](benchmarks.json). Gate commands and exit codes are recorded in [gate-results.json](gate-results.json).

## Supported profile and engineering limits

This implementation supports a bounded two-wing topology: two explicitly specified 2BHK/3BHK units per floor, stilt plus 1–40 residential floors and terrace, rectangular or convex skewed surveyed plots, and cardinal road access. Inadequate dimensions, incompatible openings or cores, unsupported geometry or exhausted searches produce explicit infeasibility. It is not a universal packing solver for every plot or flat count.

Default layout margins are provisional design inputs (front 3000 mm, rear and sides 1500 mm); explicit setbacks override them. Additional 115 mm centreline clearance keeps the column/wall footprint inside those margins. These defaults do not establish statutory setbacks. The strict profile generates the service-only stilt required by this task; extra wizard amenities are outside its supported program. Carpet-area targets remain recorded intent rather than an optimized acceptance condition.

Structural member sections and beam depth remain provisional geometry. No loads, foundations, reinforcement, member capacity, soil or seismic calculations were performed. Road width is retained as an input; these internal gates do not certify FSI, height, parking demand or municipal compliance. RBEA fixture coordinates were not copied; project policies retain brief-derived provenance. No frontend, renderer or projection-3d source was edited. Existing unrelated work was preserved.

PROFESSIONAL REVIEW REQUIRED. Automated checks provide engineering design assistance and require verification by a licensed Architect/Engineer before municipal submission.

## Final verification

| Gate | Actual final result |
| --- | --- |
| Geometry package tests | 86 passed |
| Planning package tests | 447 passed |
| Repository typecheck | 16/16 tasks successful |
| Repository lint | 16/16 tasks successful |
| Full repository tests and dependency builds | 18/18 tasks successful; 1567 tests passed, 7 existing opt-in tests skipped |
| Scoped tracked diff whitespace check | Passed |

All 1551 prior passing tests remain passing, with 16 additional regression/integration cases. Final full-run duration was approximately 3m35s with one Vitest worker per package and Turbo concurrency 1. No tests were disabled or weakened. Full package counts are in [test-counts.json](test-counts.json).

The original full runs encountered live Cloudflare health timeouts. Those failure logs remain available in `full-tests.pre-final.log`, `full-tests.parallel-timeout.log` and the attempt log. An intermediate schema review exposed the nominal Room.area contract described above; that run is retained in `full-tests.schema-review.log`. The final complete run passed, including the configured live provider checks.

PowerShell argument-array forwarding preserves the single Turbo separator and delivers worker flags to Vitest directly. Exact arguments are recorded in gate-results.json. Required builds emitted downstream artifacts, including the backend server bundle; source changes for this task remain confined to planning-engine and geometry-engine, reusing the existing constraint-engine checks.

# ARGON 4 Phase 2 — independent exports and CAD workspace

Date: 2026-11-08. Scope: the five authorized Phase 2 workstreams. Phase 1 generation, repair, constraint rules and 3D source were preserved.

## Result

Revision-specific CAD/PDF exports and geometry reports are connected to the active canonical building. Export Center has independent preview/download actions for the site, every actual floor, structural layouts, complete drawing sets and geometry reports. Future UDCPR, Blender and ETABS exports remain disabled with their requested Phase 3/5/6 labels.

This is an **INTERNAL ENGINEERING GATE**, not architectural, regulatory or structural certification. Automated checks provide engineering design assistance and require verification by a licensed Architect/Engineer before municipal submission.

## Implemented behavior

1. **One mounted backend router.** `backend/src/api/export-routes.ts` handles the registry API, legacy binary endpoint aliases, previews and verified downloads. `routes/export-routes.ts` is a compatibility re-export. Fixed canonical aliases and arbitrary unverified server persistence were removed. Unknown floors, empty/invalid geometry and unsupported formats return structured errors.
2. **Immutable artifacts.** Filenames identify the building, canonical revision, drawing kind, floor/scope, revision-hash prefix and full content SHA-256. Manifest records retain the full canonical hash, byte count, scope, floor IDs, units and actual verification results. Persistence rereads bytes; downloads reject changed bytes or inconsistent manifests. Runtime artifacts live under the backend process's `output/cad-export/artifacts` directory and are ignored by Git.
3. **Strict CAD verification.** Both formats are reopened with actual readers. Exceptions and parser notifications fail export. Verification checks AC1032, INSUNITS=4, TILEMODE=1, valid spline settings, entity/layer counts, drawing extents, geometry control points, dimension blocks and annotations. Every floor outline is independently compared with its canonical polygon: closed vertices, Cartesian edge vectors, dimensions and raw area difference below 0.001 mm². Manifest checks retain these source comparisons.
4. **Canonical projections.** Export no longer generates missing walls, furniture, columns or beams, deduplicates canonical columns, or invents blank floors. Selected canonical beams export outside structural-only sheets too. Canonical staircase polygons are retained when supplied. Valid utility sinks remain present; utility/balcony cooking fixtures return `INVALID_FURNITURE_HOST`, requiring correction of the canonical model.
5. **Annotations.** Geometry-engine annotation helpers provide deterministic placement shared by CAD and SVG/PDF rendering. Room titles adapt to clear width; three lines use separate coordinates and both CAD alignment points. Parking labels use compact two-line tags at no more than 80 mm. Site labels use polygon centroids. Room, column and dimension text share collision envelopes; SVG layers are resolved together. Canonical SVG views no longer add illustrative furniture when none exists in the model; explicit illustration helpers retain their own tests.
6. **Honest PDF scales and reports.** Backend and legacy frontend exporters use requested architectural scales when they fit, otherwise fit to page. Paper size and approximate denominator are recorded honestly. Site/floor/complete/structural PDFs and standalone geometry report PDF/JSON are available. Reports retain the canonical hash, raw centerline-cell ledger, wall hierarchy, opening/stair data, audit findings and professional-review status. PDF files pass structural checks and are reopened with pdf-lib; JSON and SVG pass their actual parsers.
7. **Live frontend controls.** `export-client.ts` checks canonical revision/hash and verifies SHA-256 plus byte size before download. Export Center aborts stale work and clears artifacts when model or settings change. CAD preview is rendered from the reopened CAD bytes. The CAD workspace has real floor tabs, independent walls/columns/beams/openings/furniture/stairs/dimensions switches, entity property inspection and verified active-floor quick exports. The modal routes CAD/PDF/SVG through the same backend; remaining local project-data formats explicitly disclose their unverified status.

## Verification gate

The machine-readable final command results are in [gates.json](gates.json); complete logs are in [logs/](logs/). All six gates below passed. Task caching and environment retries are recorded explicitly.

| Gate | Result |
| --- | --- |
| `pnpm --filter @ai-floor-planner/backend test` | PASS — 147 passed, 5 optional live tests skipped |
| `pnpm --filter @ai-floor-planner/frontend test` | PASS — 147 passed across 30 files |
| `pnpm test` script, invoked as `pnpm run test --concurrency=1` | PASS — 18 Turbo tasks; 1,424 passed, 7 skipped across the nine test packages |
| `pnpm typecheck --concurrency=1` | PASS — 16 tasks |
| `pnpm build --concurrency=1` | PASS — 9 tasks |
| `pnpm lint --concurrency=1` | PASS — 16 tasks |

Windows intermittently returned `EBUSY` while opening Vitest/ESLint dependency files. Gates were rerun sequentially with Vitest min/max forks and threads set to 1. Successful Turbo cache hits are reported in the logs; unchanged tasks were not represented as fresh execution. Failed environment attempts are retained. A first `pnpm test --concurrency=1` invocation was rejected by pnpm's built-in command parser; the equivalent package script was run with `pnpm run test --concurrency=1`.

The existing 3D workspace bundle remains over Vite's 500 kB warning threshold. The build succeeds; no 3D source was changed for this export work.

The historical Phase 0 failures in `phase3-honest-gate-fallback`, `phase4-image-to-2d`, `phase5-evaluation-and-sweep` and `two-phase-concepts` pass with their existing assertions. Legacy assertions expecting fixed filenames, blank-building success or a PDF scale-fit exception were replaced with strict assertions for the newly requested behavior. The canonical fixture was extracted from `cad-export.test.ts` so HTTP tests no longer import and rerun that entire test suite. Live export HTTP tests now start their own isolated server instead of silently skipping when port 4200 is absent. Test totals consequently exclude 21 duplicate executions.

## Independent native CAD evidence

Actual **AutoCAD 2021 Core Engine 24.0** opened representative DWG and DXF files. Both returned:

- `Total errors found 0 fixed 0`.
- INSUNITS 4; TILEMODE 1; 960 model entities.
- Actual layer entities: A-WALL 116; S-COLS 100; S-BEAM 189; A-DOOR 28; A-WIND 56; A-FURN 167; A-ANNO-TEXT 85.
- Input SHA-256 unchanged after the native open/audit.

Native inspection exposed defects missed by the original library checks: an invalid default SPLINETYPE, missing anonymous dimension blocks and legacy-encoded DXF text. These were corrected at serialization. Dimension blocks now contain their measured geometry/text; DXF uses UTF-8 and a supported header-variable set. Regression checks reject invalid spline settings, missing dimension blocks and invalid UTF-8.

Native logs: [DWG](logs/autocad-dwg.txt), [DXF](logs/autocad-dxf.txt). The reproducible read-only audit commands are in [native-check.scr](native-check.scr). Exact checked files, immutable manifests and checksum/provenance records are in [evidence/index.json](evidence/index.json).

## PDF and UI evidence

The site, stilt and residential drawing PDFs plus the 15-page geometry report were reopened and rendered with bundled Poppler. First drawing/report pages and an all-page report contact sheet were visually reviewed. The saved 18 pages also passed independent pdfplumber checks using actual character bounds: **zero character-box overlaps**. See [font-bound checks](evidence/pdf-font-bounds-checks.json), [residential](evidence/floor_typical.png), [stilt](evidence/floor_stilt.png), [site](evidence/site_plan.png) and [report pages](evidence/report-contact.png). Poppler emitted a missing Symbol display-font warning; these files use Helvetica/Courier and their rendered text was checked.

New backend tests exercise every real floor, site and complete/structural DWG/DXF/PDF, source immutability, reports, parser failures, missing floors, changed source boundaries, corrupted bytes, immutable checksums, native dimension prerequisites, utility furniture and exact/fit scales. Frontend interaction tests exercise every active Export Center button, future disabled actions, stale-result rejection, download checksums, all seven actual CAD layer switches, property selection, dynamic floor tabs and quick exports.

The worktree contained substantial pre-existing Phase 0/1 and user edits. They were preserved. No commit, deployment, municipal submission or professional certification was made.

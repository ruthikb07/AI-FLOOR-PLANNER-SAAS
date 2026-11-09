# Phase 4 — Residential CAD serialization and native AutoCAD export

2026-11-09 — INTERNAL ENGINEERING GATE PASSED.

Standards A and B now serialize canonical multistory assemblies into per-floor and combined model-space sheets. The rectangular stilt + 3 residential floors + terrace benchmark produces 12 DXFs and 12 actual AutoCAD-generated DWGs. All 12 native conversions returned zero AUDIT errors and zero fixes, with observed INSUNITS=4 and TILEMODE=1. Every DWG has an AC1032 binary header, passes reopened geometry checks, and is persisted with a verified checksum.

## Reviewable deliverables

- [Standard A combined DXF](../../output/cad-export/artifacts/phase4-verification/res_A_combined_r2_bc817d70a9b1_7225c2ab7e950d6eb2f84a76929958e91e076d7b96d72817718b85dd06640ff3.dxf)
- [Standard A combined DWG](../../output/cad-export/artifacts/phase4-verification/res_A_combined_r2_bc817d70a9b1_1f36e8f35da92a179d83f36bb389d5514a6b7af80c9d3af42fe9f43b1aae05c9.dwg)
- [Standard B combined DXF](../../output/cad-export/artifacts/phase4-verification/res_B_combined_r2_bc817d70a9b1_c34cc23952d666e3013d831939c12c56859eec6a428559322c88a7beae1a19f2.dxf)
- [Standard B combined DWG](../../output/cad-export/artifacts/phase4-verification/res_B_combined_r2_bc817d70a9b1_cea7af2dc6bf9cf9b79c032adf2e1475243f62496003d297dcd8ef11f8d630cd.dwg)

[Full verification package manifest](../../output/cad-export/artifacts/phase4-verification/.residential-job-9d57df2b-3e1d-433b-97b0-4a978d9476cd/package.manifest.json). [Native evidence and checksums](native-evidence.json). The package contains independent files for every physical floor and both combined sheets, under git-ignored output/cad-export/artifacts/phase4-verification.

## Interfaces

- `CadExportService.exportResidentialPackage(building, options, directory?)` and `ArtifactRegistry.generateResidentialPackage(building, options)` generate the complete package. Options accept `standards: ['A', 'B']` and `nativeAudit` (default true).
- `POST /api/v1/export/residential-package` accepts `{ building, options }` and returns the manifest and independent descriptors. Download and preview URLs use the existing export routes.
- `POST /api/v1/export/artifacts` accepts `format: 'dxf' | 'dwg'` with `options.cadStandard: 'A' | 'B'`, canonical `floorId`, or `exportScope: 'all_floors'`. New-profile DWG requests always use native conversion. A DXF source can optionally request native audit through `nativeCadAudit: true`.
- The synchronous `CadExportService.exportCad` supports new-profile DXF source generation. It rejects new-profile DWG requests with NATIVE_CAD_ASYNC_REQUIRED; unaudited fallback DWGs are not substituted. Existing exports without cadStandard retain their contracts.

Per-file manifests bind building identity, revision, canonical revision hash, scope, source entity IDs, file bytes, checksum and verification. Combined sheets retain explicit per-floor translations. Individual sheets use the same global origin, with CAD Y equal to negative canonical Y; no individual-floor rebasing can introduce column drift. Geometry remains 1:1 in millimetres.

## Standard A

The requested layer names and ACI map are registered and verified after reopening: A-WALL-EXTR 11, A-WALL-INTR 252, S-COLS 5, S-BEAM 4, S-GRID 8, A-DOOR/A-WIND 2, A-FLOR-BALC 3, A-ANNO-TEXT 1, A-ANNO-DIMS 7 and A-PARK-STAL 6. Walls use opening-trimmed double boundaries and solid quadrilateral fills. Columns use canonical footprints and solid fills. Window/door frames are derived from canonical hosts. Swing doors include quarter-circle graphics; sliding/open passages retain their appropriate representation.

Labels use computed polygon centroids and a bounded font fit against room boundaries, wall solids and columns. Annotation boxes must not overlap. Open circulation partition cells and nonhabitable cells without a clear centroid label envelope are explicitly recorded as omissions rather than assigned fabricated clear space. Habitable label failures reject the sheet.

The footer reports measured gross built-up, unit carpet and slab areas in square metres and square feet. Raw values and conventions are retained in the metadata. Gross is canonical centreline gross area; carpet is unit usable area plus its clipped internal partition union; slab is the floor boundary less explicit voids. These are canonical measurement conventions, not a construction formwork quantity or municipal certification. Printed values are rounded for display; geometry and readback acceptance are not rounded. Imperial dimensions are display strings only.

The canonical Door contract lacks hinge handedness. The exported left-jamb swing convention is explicitly schematic, recorded in metadata and printed on Standard A sheets. It does not modify authoritative opening geometry or claim verified hinge selection.

## Standard B

Grid axes and column tags derive from actual registered nodes, with X/Y intersections and cumulative imperial offsets. Dimension text stays clear of both horizontal and vertical dimension strings, with explicit line/text overlap assertions. CENTER2 uses the installed AutoCAD 2021 acadiso.lin pattern (19.05, -3.175, 3.175, -3.175) and an explicit display scale. Primary beam centrelines and bounding polygons use canonical members. Column schedule blocks map C1..CN to source column IDs, sections and grid intersections.

On the stilt/foundation sheet, concentric pedestal/footing diagrams use graphical 2x/3x column-section envelopes. They are explicitly marked NOT TO SCALE and FOUNDATION SIZING NOT PROVIDED. Adjacent diagram collisions reject the sheet. These are presentation diagrams, not assumed soil-dependent foundation sizes, load calculations or structural design. All sections remain provisional and structuralAnalysis is NOT_RUN.

## Headless verification and failure behavior

The runner resolves the installed AutoCAD 2021 accoreconsole.exe, with ACCORECONSOLE_PATH as the configured fallback. The executable was found at C:/Program Files/Autodesk/AutoCAD 2021/accoreconsole.exe (file version 24.0.47.0.0).

Each isolated job uses a generated script, quoted validated paths, no shell, a hidden process window, a bounded timeout and captured console output. Jobs run serially. The script sets FILEDIA=0, TILEMODE=1 and INSUNITS=4, executes AUDIT Y, prints uniquely marked actual variable values, saves as 2018 DWG, then quits. Existing output files are never overwritten. Input bytes must already declare millimetres and are checked for changes during execution.

Acceptance requires a zero process exit, an observed zero-error/zero-fix AUDIT, actual unit/model-space markers, a nonempty AC1032 DWG, a matching output checksum and reopened drawing verification. All CAD entity control points are compared with the serialized source. Reopened slab contours must also retain raw canonical area within 0.001 mm². Required layers and colors are checked again.

A missing executable produces ACCORECONSOLE_SKIPPED / ACCORECONSOLE_BINARY_NOT_FOUND. Process, timeout, audit or readback failures produce ACCORECONSOLE_ERROR. Complete-package manifests become PARTIAL and do not publish an unverified DWG; verified DXF sources remain independently available. Explicit nativeAudit=false produces an honest NOT_REQUESTED skip. There is no renamed-DXF or library-DWG fallback under the new native workflow.

[Autodesk documents](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-62E5383D-8A14-47B4-BFC4-35824CAE8363.htm) that AutoCAD recalculates justified TEXT insertion points from alignment anchors and font metrics. The verifier now follows those documented rules rather than treating valid insertion/alignment differences as corruption. AutoCAD also adds standard non-graphical view-style dictionaries that acad-ts does not fully map. Only those narrowly identified reader limitations are retained as nativeReaderWarnings after verified native audit and byte provenance; all other notifications remain failures. They are not AutoCAD AUDIT errors. The normal non-native verification path remains strict. Layer and graphic rules are task-specified presentation policy; they are not promoted into universal RBEA or statutory requirements.

## Verification coverage

The new tests exercise Standards A/B, layer colors, model-space/units headers, repeated column coordinates on individual floor sheets, cantilever clear-area exclusion, raw serialized slab areas, immutable checksums, native conversion of every package sheet, downloaded bytes, SVG preview, HTTP dispatch and bounded response headers. Negative cases cover discontinuity, off-wall openings (which are rejected instead of projected into the drawing), unavailable executables, actual process failure, script path injection, destination overwrite protection, invalid provenance and package-level partial outcomes.

Source changes are confined to backend and core export contracts. No geometry, planning, frontend, renderer or projection-3d source was edited. Existing uncommitted work was preserved. Required builds can update generated backend bundles; generated PDF string padding is not source whitespace and was not rewritten. Source whitespace checks are recorded separately.

PROFESSIONAL REVIEW REQUIRED. Automated checks provide engineering design assistance and require verification by a licensed Architect/Engineer before municipal submission.

## Primary technical references

- [Autodesk TEXT group-code and justification rules](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-62E5383D-8A14-47B4-BFC4-35824CAE8363.htm).
- [AutoCAD 2021 SAVEAS command](https://help.autodesk.com/cloudhelp/2021/ENU/AutoCAD-Core/files/GUID-1FF801F9-7FEE-4494-854D-4704A7784232.htm).
- [Autodesk Core Console invocation and scripting guidance](https://blog.autodesk.io/getting-started-with-accoreconsole/).

## Final gates

| Gate | Actual result |
| --- | --- |
| Focused CAD/native suites | 15 tests passed |
| Backend package | 168 passed, 5 existing opt-in skips |
| Repository typecheck | 16/16 tasks successful |
| Repository lint | 16/16 tasks successful |
| Full monorepo tests and dependency builds | 18/18 tasks successful; 1582 passed, 7 existing opt-in skips |
| Scoped source whitespace check | Passed |

All 1567 prior passing tests remain passing, with 15 new CAD/native/HTTP regression cases. Final full-run results include the last off-wall source-admission check, the dimension line/text assertions and the configured live provider smoke checks. No native tests were skipped on this machine. No tests were disabled or weakened.

Exact commands, arguments, timings and exit codes are in [gate-results.json](gate-results.json); package totals are in [test-counts.json](test-counts.json). Full output is retained in the adjacent logs. Initial runs exposed an optional-evidence-directory empty-string test-harness issue; that fallback was corrected. Earlier interrupted and retry logs are retained, including environment/filesystem failures. The final complete run passed on its first attempt after the last source change.

The final file review independently rechecked the sizes and SHA-256 checksums of all 24 delivered files. The 12 native audit records retain their actual input/output hashes, process exit codes, observed variables and console log paths. Software gates and AutoCAD AUDIT demonstrate file and software behavior only; they do not certify architectural quality, statutory approval or structural safety.

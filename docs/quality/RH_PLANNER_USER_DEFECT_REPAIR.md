# User defect repair — 2026-11-12

Status: PARTIALLY VERIFIED. Full architectural acceptance remains open.

## Direct evidence
- Inspected supplied recording 20261112-0743-53.1065773.mp4 (35.83 seconds); sampled image at test-artifacts/user-defects-20261112/contact-sheet.png. The visible compliance screen reports zero bathroom opening area and missing clear-height evidence. These are not converted to PASS.
- Multi-sheet apartment solver stores aiPrompt in generationBrief but does not pass it into partitionMacroFootprint. The fixed band topology cannot honor a requested central OTS location.
- space-filling-snapper allocated surplus width on plots >=36m to its central core, producing oversized stairs/lobbies.
- A separate residential-layout-builder caps its envelope at 18m x 26m and uses a bounded two-wing topology. The active UI route still needs end-to-end reproduction before changing that separate path.
- ThreeBuildingScene applied black exponential fog independently of day/night selection.

## Changes
- Bounded the central core width instead of assigning excess plot width to it; apartment wings receive the remaining width.
- Removed distance fog from the model inspection scene and used a light daytime background. Preserved night mode and other presentation code.
- Added decimal-dimension area-conservation checks at 36m, 40m, 50m and 50.0125m widths; retained both stairs and lifts.

## Executed checks
- large-plot-core.test.ts: 4 passed, exit 0.
- planning-engine typecheck: exit 0.
- These checks do not prove circulation, lift manufacturer suitability, ventilation or statutory compliance.

## Outstanding
- Route prompt intent into explicit layout constraints and generate genuinely different feasible topologies.
- Rework lift/stair depth allocation; vertical surplus still expands the lift/lobby band.
- Measure wet-room external/shaft opening adjacency and vertical continuity.
- Reproduce UI journeys at multiple dimensions and inspect daytime 3D after the fix.
- Locate the referenced structural DWG; none was present among the available attachment DWG files in this turn.
- Full planning/frontend regressions, build and native CAD checks remain pending for these architectural edits.
- Do not conflate the existing stilt plus three residential floor fixture with the requested G+4 project.

All uncommitted changes were preserved; no reset, clean, commit, push or merge.

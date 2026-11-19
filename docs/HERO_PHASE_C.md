# RH Planner Phase C static showcase

The welcome page displays **Demonstration model, inspired by Mumbai luxury residential**. The dedicated References & credits view contains the property name and the photographer’s CC BY 4.0 credit. The model uses three illustrative towers, eight detailed neighboring buildings and lower-detail skyline blocks. The user can change camera views, orbit and switch the lighting. The floors retain their assembled transforms throughout.

## Source and regeneration

Blender 5.2.1 LTS ran its bundled Python 3.13.13 in background mode and exported a smoke-test GLB. The [Python build](../scripts/build-mumbai-showcase.py) generates the [welcome-only model](../packages/frontend/public/architecture/mumbai-residential.glb) from the [spec](../scripts/mumbai-showcase.json). It bakes short-range contact occlusion into the vertex finish and uses Meshopt compression. The exported scene preserves floor indices, phase IDs and final transforms. The welcome renderer submits material batches while retaining the source component hierarchy.

```powershell
blender --background --factory-startup --python-exit-code 1 --python scripts/build-mumbai-showcase.py
```

The runtime preloads the GLB, HDR and surface maps. It prepares the environment, awaits `compileAsync`, and renders a warm-up pass before marking the canvas ready. Day and evening share the shader topology and cached sun shadow. The material maps use the existing CC0 WebP files.

## Visual review

- [Street](../test-artifacts/hero-phase-c/01-street.jpg)
- [Three-quarter](../test-artifacts/hero-phase-c/02-three-quarter.jpg)
- [Elevated](../test-artifacts/hero-phase-c/03-elevated.jpg)
- [Facade close-up](../test-artifacts/hero-phase-c/04-facade-close.jpg)
- [Dusk](../test-artifacts/hero-phase-c/05-dusk.jpg)
- [References page with render and source link](../test-artifacts/hero-phase-c/06-reference-comparison.jpg)

The render uses the developer’s documented **3.8 m** residential pitch for Tower E and the two plan-labelled balcony depth cues. The oblique aerial view gives context for the relative proportions of floor bands, glazing and podium. Independent photo-derived scale is unverified. All additional dimensions, including tower counts, massing, column grid, parapets and facade details, are illustrative. [Facade evidence and scale decision](FACADE_GRAMMAR.md#phase-c-scale-decision-and-illustrative-dimensions)

The actual two-image comparison needs the original JPEG at `packages/frontend/public/hero-refs/raheja-vivarea-aerial.jpg`. The Phase C capture records the local file as absent and verifies the credited source-link view. [Asset licence and original filename](ASSET_LICENSES.md#files-to-supply)

## Production measurements

[Chrome capture and gzip inventory](../test-artifacts/hero-phase-c/metrics.json) records the adapter on each view. These are settled static-view counters at 1280 × 800 and DPR 1 under Chrome 158 using Intel UHD Graphics through ANGLE/D3D11. The capture script also checks the required label, model readiness, facade and lighting views, and reference navigation. [Capture script](../packages/frontend/scripts/capture-mumbai-showcase.mjs)

| Gate | Result |
| --- | --- |
| Static Meshopt GLB | **PASS.** 13.09 MB against 15 MB. Verified 615 unique component IDs and no animation tracks in the binary. |
| Initial welcome JavaScript | **PASS.** 374.9 kB gzip against 400 kB, including the scripts requested through readiness. Project workspaces load when opened. |
| Final view | **PASS.** At most 36 draws and 283,372 triangles on Intel UHD Graphics through ANGLE/D3D11. |
| Frontend checks | **PASS.** Production build, typecheck, lint, 176 Vitest tests and two scoped desktop/mobile Playwright tests on Intel UHD Graphics through ANGLE/D3D11. |
| Surface-map format | Existing compressed WebP maps are used at runtime. KTX2 packaging was deferred. |
| Original photo in comparison | **NOT VERIFIED.** The local JPEG was absent. |

The final Intel UHD and RTX 4050 comparison belongs to Part 2. The visual approval gate follows Phase C.

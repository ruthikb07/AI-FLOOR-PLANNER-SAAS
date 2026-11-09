# Phase 5 — procedural 3D and Blender export

Date: 2026-11-09. Status: INTERNAL ENGINEERING GATE PASSED.

## Implementation

The existing schematic projection API remains compatible. The new `projectBuildingScene` derives disposable Z-up millimeter mesh data from the canonical Building; `createThreeBuildingScene` exposes that data as floor groups and selectable Three.js meshes. Neither edits the Building nor creates authoritative plan state.

Slabs subtract canonical lift, staircase, shaft, OTS and explicit void polygons. Overlapping cutouts are subtracted as a union during render tessellation. Cantilever slabs are separate from the main slab without duplicate volumes. Walls retain canonical thickness, with exact centered door/window cuts and preserved solid bands between vertically disjoint openings. Columns reach the next physical floor elevation; ceiling beams retain canonical footprints and depths. Canonical stair flights/landings become stepped meshes, including rotated quadrilateral flights. Unsupported flight shapes fail explicitly. Enclosed utilities remain enclosed; only explicitly outdoor utilities receive balcony treatment.

All building mesh nodes retain source entity, floor, building and canonical revision identifiers. Frames, chajjas, finishes and railings are identified as derived presentation. Presentation defaults include 40 mm frames, 8 mm glazing/finishes, 35 mm door leaves, 500 mm chajja projection, 100 mm balcony curbs and 1,000 mm railing tops. Missing slab thickness uses the existing 150 mm presentation default. These are visualization assumptions, not structural design results.

`generateBlenderScript` produces actual bpy mesh construction and applied EXACT Boolean modifiers. Each Boolean mesh must remain manifold and match the independently tessellated projection within 0.002% relative volume error. This 3D mesh check does not replace or change the canonical planar area invariant.

The script configures metric millimeters, Cycles with EEVEE fallback, sun/sky lighting, ground, perspective and true isometric cameras. The isometric elevation is atan(1/sqrt(2)) = 35.26438968 degrees with 45-degree yaw. Eight Principled materials include glass transmission 1, roughness 0.05 and IOR 1.52. Four procedural albedo images are packed into the native project and embedded in GLBs; tile UVs distinguish habitable and wet areas. Native geometry stays in mm; one explicit 0.001 parent transform converts GLB coordinates to meters.

Compatibility verified against installed Blender 5.2.1 LTS: the new sky model uses MULTIPLE_SCATTERING, and the available EEVEE identifier can be BLENDER_EEVEE rather than BLENDER_EEVEE_NEXT. The browser build uses polygon-clipping's default export.

## Backend boundary and persistence

- POST `/api/v1/export/blender-package`: body `{ building, options?: { expectedRevision } }`.
- GET `/api/v1/export/blender/download/{jobId}/{fileName}`: only published, checksum-matching artifacts.
- `BlenderExportService` validates the core schema, checks requested revision, snapshots canonical input and uses the core canonical revision hash.
- `BlenderRunner` uses BLENDER_PATH or `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`, with shell disabled and a hidden window. Invocation includes `--background --factory-startup --python-exit-code 1 --python`. The Python exit flag prevents Blender's default zero exit status from hiding script exceptions.
- Execution streams output, captures bounded logs, times out after five minutes, and requires exit zero plus a completion receipt. Missing binaries return BLENDER_NOT_FOUND with BLENDER_BINARY_NOT_FOUND detail; failed scripts return BLENDER_RENDER_ERROR.
- A completion manifest is published only after receipt, headers, bytes and checksums are verified. Failed jobs are removed; partial jobs cannot be downloaded. Publishing the manifest avoids renaming native project directories while OneDrive may hold files open.
- Each of seven files has its own SHA-256, byte count, building revision, scope and download URL. The backend job envelope reuses core export descriptors and extends only its local native format discriminator with BLEND, keeping this phase within the requested package scope.

The output root defaults to `output/blender-export/artifacts` relative to the backend process working directory and can be supplied to the service constructor. Generated native files, scripts and execution logs stay git-ignored.

## Verification

| Gate | Actual result |
| --- | --- |
| Projection package tests | 28 passed |
| Backend package tests | 174 passed, 5 existing opt-in skips; repeated successfully in the final full gate |
| Monorepo typecheck | 16/16 tasks passed |
| Monorepo lint | 16/16 tasks passed |
| Full monorepo build/test gate | 18/18 tasks passed; 1,594 tests passed, 7 existing opt-in skips |
| Native Blender execution | Blender 5.2.1 LTS, build 9e2066aef7ef, CYCLES, exit 0 |
| Native reopen and render | PASS: 1,421 building meshes, four packed textures, metric mm, applied modifiers, true isometric camera, actual 800x600 CPU Cycles render |
| Source whitespace review | git diff --check passed for scoped source and this report |

All 1,582 baseline passing tests are preserved; Phase 5 adds 12 passing tests. The existing configured live-provider smoke tests and native AutoCAD tests also ran successfully. No existing test was disabled to obtain this result. On machines without Blender, the two native Blender cases explicitly skip with BLENDER_BINARY_NOT_FOUND in their test name; they ran and passed here.

Commands executed:

```powershell
pnpm --filter @ai-floor-planner/projection-3d run test --pool=threads --maxWorkers=1 --minWorkers=1
pnpm --filter @ai-floor-planner/backend run test --pool=threads --maxWorkers=1 --minWorkers=1
pnpm typecheck --concurrency=1
pnpm lint --concurrency=1
$testArguments=@('run','test','--concurrency=1','--','--pool=threads','--maxWorkers=1','--minWorkers=1')
& pnpm @testArguments
```

Logs: `phase5-projection.log`, `phase5-backend.log`, `phase5-typecheck.log`, `phase5-lint.log`, `phase5-full-suite-final.log` and `phase5-native-inspection.log` at the repository root. The final full gate completed in 2m10.915s; Turbo reused 12 unchanged tasks and executed six affected tasks.

### Native artifact evidence

Fixture: canonical synthesized 18,000 x 25,000 mm site, Stilt + 3 residential floors + Terrace, two units per residential floor. Revision 2, canonical hash `38fc61542e9934b1213e27b35984992d021bc9ae3931f9aa544c6572d8ce08b4`.

Final job directory: `output/blender-export/artifacts/phase5-verification/cbd43a55-e1e3-45b2-ac8e-27e3904da201/`. Its manifest, generated Python, stdout/stderr and Blender receipt accompany the artifacts below. The script applied 439 Booleans; maximum relative volume error was 3.5451524874870756e-7, below the 2e-5 acceptance threshold. This is a rendering mesh comparison, not the planar conservation tolerance.

| Artifact | Actual bytes | SHA-256 |
| --- | ---: | --- |
| building_full_assembly.blend | 11,790,573 | ba57ef8d3422b9b93907885f061f787d52d3685dc8d02543243b83e38d06ec69 |
| building_full_assembly.glb | 2,677,036 | 83782457d8fed7bccd268a817cdb40959d50d493174f692d1263db1ee3c5d924 |
| floor_0_stilt.glb | 258,620 | fdd04c0ad4cb107b574681194e49005a1e7e1aa68afe8063ca3a1726ab8b76b9 |
| floor_1_residential.glb | 791,520 | 26923c5512fc4f1ef4527cab970c092b39f40eb34f0f1f05f5a90dd7dc7c81ec |
| floor_2_residential.glb | 791,180 | 6f9b4e293c49aaccc7a0a3b02db163b75818b2d713474daafbab7d16758d1e84 |
| floor_3_residential.glb | 792,688 | af18086aea90883b9aa9b233296ffa631435a2878a7b3f553cf9ccbb127f62f8 |
| floor_4_terrace.glb | 88,236 | a17de05757e36325261531403e6a7d6b4a9ce3297af21467494d29c4949b4ff1 |

Every GLB passed magic/version/length checks, embedded image checks, per-floor entity provenance and millimeter-to-meter transform checks. The complete GLB retained the glass transmission material. The native project was independently reopened without saving over it, checked for packed textures and camera elevation (35.26439732 degrees measured), then rendered. Additional evidence in the same job directory: `inspect-native.py`, `native-inspection.json` and `isometric-preview.png`.

## Engineering status

PROFESSIONAL REVIEW REQUIRED. Structural adequacy, reinforcement, loading, seismic performance and municipal approval are NOT_VERIFIED. Software and export checks demonstrate internal behavior only.

Automated checks provide engineering design assistance and require verification by a licensed Architect/Engineer before municipal submission.

Blender API reference: [Blender 5.2 glTF export operator](https://docs.blender.org/api/5.2/bpy.ops.export_scene.html). Transmission uses the documented [Principled glTF material mapping](https://docs.blender.org/manual/sl/5.2/addons/scene_gltf2.html).

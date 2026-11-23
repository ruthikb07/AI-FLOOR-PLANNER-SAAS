# Phase 3 engineering verification

**Base** `7358df3760515cea588c2cef5203387d5574f74f` on `repair/stabilize-rh-planner`. Verification ran in isolated Windows worktrees with the frozen pnpm lockfile. The working repair checkout held two generated Phase 1 snapshots and local logs at intake. Those files are outside the implementation commit.

## Architectural generation

| Fixture | Before | Phase 3 evidence |
| --- | --- | --- |
| 42 × 34 m, 4 × 2BHK, seed 1, 700 / 1,100 / 1,500 / 1,900 sq ft | Phase 2 measured 888.19 / 1,610.46 / 983.81 / 1,472.71 sq ft on the same strict brief. The advisory baseline was 863 / 1,014 / 900 / 978 sq ft. | Strict at 2% measured 703.75 / 1,106.29 / 1,500.71 / 1,900.80 sq ft. All four passed the final area and geometry gate. |
| 1BHK + 3BHK, 800 / 1,400 sq ft | The prior row slicer capped and rebalanced the available bands without feedback from measured per-flat carpet. | At 3%, the 42 × 34 m rectangle and oblique quadrilateral each measured 777.27 / 1,425.16 sq ft. The 25 × 32 m narrow site measured 804.20 / 1,430.75 sq ft. The oblique test also checks exact containment against the saved envelope. |
| 32 × 36 m, 4 × 2BHK, seed 2, locked wave | HTTP 200 published a stepped model. | HTTP 422 with `LOCKED_MASSING_UNREALIZED` and no building. An explicit compact control retained its requested and realized shape. The wave result demonstrates a bounded search miss for this brief. |
| Repeated geometry | Exclusions used topology-stage fingerprints. | The published fingerprint is derived from final footprint, physical wall geometry, room and flat boundaries and actual door connections. A request excluding only this fingerprint received HTTP 422 when the same design reappeared. |
| Oblique setbacks | The saved model omitted the computed envelope. A probe found two points outside it by 1.52 and 1.61 mm. | Save the measured envelope and the fitted rectangle. Round the search grid inwards and check the actual corners and finished residential footprint. An empty offset envelope reports that the setbacks leave insufficient buildable space. |
| Conflicting program count | Prompt-driven mixed-BHK interpretation could replace the sized unit list. | A conflicting flat count blocks publication and identifies the schedule conflict. When the slot count agrees, mixed types retain the targets at their specified indices. |

The area refinement uses final wall-clipped carpet feedback and a bounded gross allocation search. It checks each candidate against the same architectural acceptance rules. If a target still misses, the diagnostic identifies the measured area and the current built-up cap when that cap is below the target. The solver has no general proof of infeasibility across all typologies. An exact per-flat result within tolerance is separate from statutory carpet definitions.

## Canonical editing and exports

- The wall and room editor uses one canonical undo/redo history. Hosted door and window changes produce a new revision and audit wall fit, collision, schema, geometry and closure. The generated fixture verifies a 40 mm window width reduction, a floor lock rejection, unchanged other floors, undo, redo, reload, and a downloaded GLB of the edited revision.
- A straight full-length partition between two rectangular rooms in the same flat can move by an exact offset. The regression moves one 50 mm, retains all opening IDs, and preserves other floors, the footprint and unaffected rooms. The move rejects an obstructed opening, fixed zone, load-bearing wall or unsupported boundary arrangement.
- The room-target path uses the deterministic acceptance command. The proportional resize is blocked where it would move other floors, a neighbouring flat or the core. Continuous free-form room relocation and a general independent flat-scale solve remain open.
- The GLB route carries the revision and canonical SHA-256. The client checks both and the GLB header and length before presenting the download. A stale expected revision receives HTTP 409. Default architectural PDFs omit the structural overlay. The PDF service now rejects unsupported Unicode drawing text explicitly. Embedded and shaped Marathi and other Indic-script labels still require a Unicode font pipeline.

## 3D and browser scope

The browser profiled the production tower after generating and comparing two distinct massing studies. One sampled frame contained 183 draw calls and 164,714 triangles. OrbitControls was rendering on its change event and again inside the scheduled animation frame. Reusing the frame scheduled for orbit updates reduced the peak from three renders to one per sampled frame and the total from 66 to 31 for the same 12-step drag and 1.25-second sample. The committed browser regression repeated the interaction with 30 renders and a peak of one per frame. This measures that interaction under headless Chromium. Hardware FPS, GPU allocation and resource behaviour across all controls remain open.

## Verification record

Raw logs remain under `tmp/repair-phase3` in the local repair checkout.

| Command | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed in both isolated worktrees. |
| `pnpm build` | 9/9 tasks. Vite reported its large-chunk warning. |
| `pnpm typecheck` | 16/16 tasks passed. |
| `pnpm exec turbo run lint --concurrency=2` | 16/16 tasks passed. |
| `pnpm exec turbo run test --concurrency=2 --continue` | 18/18 tasks, 1,731 passed and 8 opt-in skips. Planning passed 593 tests in 76 files. The 288-case solver benchmark produced 288 outputs and used legacy partitioning in 88 cases. |
| `pnpm test:integration` | 21 passed in 4 files. |
| `pnpm --filter @ai-floor-planner/backend test:integration` | 31 passed in 4 files. |
| `pnpm --filter @ai-floor-planner/frontend exec playwright test --config playwright.repair.config.ts` | 14 passed in Chromium against the final production builds. |
| `pnpm --filter @ai-floor-planner/backend exec vitest run src/__tests__/generation-acceptance-repair.test.ts src/__tests__/phase2-architectural-verification.test.ts src/__tests__/phase1-exports-and-routes.test.ts` | 25 passed. Earlier iterations exposed the oblique envelope and fixed-host test fixture issues. |

The production Chromium suite covers exact CAD imports, mandatory rejection, revision identity, IndexedDB interruption and recovery, archive and reload, desktop and mobile survey inputs, window editing, partition editing, and download of the edited GLB. The current Studio workflow also verifies image upload, deterministic interpretation, distinct massing comparison, the editor, floor and tower 3D, orbit rendering, structural workspace, GLB download and project reload. The separate legacy cinematic spec returned 1 pass and 3 failures. Two assertions targeted retired welcome/fallback copy. The third expected the retired Design Studies gallery labels after the production app had displayed its Massing Studies gallery.

## Native and live checks

- AutoCAD 2021 Core Console independently converted and audited the fixture DWG. The audit found and fixed zero errors and reported millimetres and model space. Software readback covered DWG and DXF entities and encoded signatures.
- Blender 5.2.1 LTS executed the procedural fixture. Automated readback verified the `.blend` bytes and GLB manifest, scale, materials and floor provenance. A separate `blender -b` reopen loaded `building_full_assembly.blend` with 1,406 objects and metric scene units.
- ETABS 23.3.2 fixture checks used the installed native engine and the existing local bridge binary. Four opt-in tests passed for frame analysis and reopen, two model-only exports, loaded fixture evidence, and authenticated HTTP download and reopen. A separate preliminary residential export/reopen passed. The opt-in report test produced PDFs from hash-valid historical native fixture evidence and rejected the checksum-mismatched control.
- CAD drawing PDFs, JSON projects, architectural GLB, and ETABS `.e2k` were exercised by software-format or HTTP checks. The ETABS native readback evidence applies to the verified EDB fixtures and the preliminary EDB model.
- A live architectural request and the live plot research test each succeeded. A repeat architectural probe failed its live-provider assertion after HTTP 503 on both configured models. The resulting telemetry recorded the attempts and deterministic fallback. Controlled telemetry tests also cover sanitized HTTP 403 and the model fallback contract.

Native evidence and provider opt-ins ran separately from the default 8 skips.

## Release boundary

The verified repair can be used for continued engineering. General room relocation, protected local flat regeneration, shaped Unicode PDF output and complete 3D/browser acceptance remain release gates. Applicable setbacks, FSI, egress, legal carpet definitions and any real-project structure require project-specific licensed review.

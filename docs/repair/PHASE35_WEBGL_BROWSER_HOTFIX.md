# Phase 3.5 WebGL and browser hotfix

The local repair branch started at `fcc7bcc9a282f85a0106f408778e53966c51066f`. The hotfix uses the same audited planning, editor, and persistence paths. Verification ran with production frontend and backend builds in a detached copy outside OneDrive. The original worktree's two generated files and local Phase 2 data were preserved.

## Reproductions and fixes

| Failure | Baseline evidence | Root cause and change |
| --- | --- | --- |
| Tower stays blank after WebGL restoration | Chromium restored a real WebGL2 context on the saved one-floor four-flat fixture. The renderer published zero frames over the next five seconds. The earlier diagnostic reported eight after wheel input. Unmount detached the canvas and released its context. | Three.js r185 rebuilt its internal GL caches. The on-demand app had no context-event lifecycle to schedule a draw. `ThreeBuildingScene.tsx` now clears stale frame statistics, cancels pending work and disposes old GPU allocations on loss. On restore it synchronizes the viewport and requests one frame while keeping the existing scene, camera and controls. Unmount removes both listeners and releases resources. |
| Studio reports missing Massing Studies | The generation response returned HTTP 200 in 19.037 seconds. The 5-second assertion expired while the progress dialog still showed `Generating your building`. A prior trace captured the same region and heading once the worker completed. | The API response arrives before the browser worker's audited acceptance and projection. The test waits for the existing gallery or error dialog, requires actual gallery readiness, and fails if the error dialog appears. The alternate still has to return HTTP 200, publish a distinct physical layout hash, and open in CAD. A previous alternate response took 30.1 seconds, exceeding the former 30-second response deadline. |
| Extended Studio reports missing Tower canvas | The prior timeout trace and screenshot contained the canonical Tower workspace, an attached 1060 × 844 Three.js canvas, and the rendered tower. Playback showed a software-GPU readback stall. | The visibility assertion was expiring during the transition to a usable canvas. Ordinary scene updates now share a single animation-frame request, including mount and resize. The workflow requires a positive draw count and a visible canvas. The 45-second allowance covers initial construction and software rendering during this transition. No headings or selectors were added to the production Studio. |
| pnpm reports Playwright missing after a test error | From the repository root, the filtered command resolved both Playwright shims and returned Playwright 1.65.0. Running it with an intentionally missing config first returned the Playwright config error, then `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` and `Command "playwright" not found`. | pnpm 9.7.0's Windows failure path checks the command name again with `which.sync`. The package scripts now run the installed Playwright entry point with Node from the frontend directory. The same negative control returns the config error and child exit status 1. CI uses those scripts. The frozen lockfile and dependencies are unchanged. |

## Render and resource evidence

The test used Playwright Chromium 1.65.0 with SwiftShader and `WEBGL_lose_context`. It opened two locally saved canonical projects, with two upper floors in the primary project and one floor in the alternate. The test intercepted native WebGL draw calls and counted published frames. It sent no input between loss and recovery.

| View | Cycles | Frames per restoration | WebGL draws per restoration | Three.js geometry / texture counters before → after |
| --- | ---: | ---: | ---: | --- |
| Tower with front camera, upper-floor isolation and Night lighting | 2 | 1 | 51 | 57 / 11 → 27 / 9 → 27 / 9 |
| Floor 3D | 2 | 1 | 57 | 32 / 9 → 32 / 9 → 32 / 9 |
| Tower in second project | 1 | 1 | 75 | 42 / 10 → 42 / 10 |

The restored Tower canvas screenshot was byte-identical to the pre-loss screenshot. The camera preset, upper floor, isolation and Night controls retained their selection. Three.js only re-uploaded the visible scene after the first loss. Every cycle stayed idle during the following 750 ms. All three contexts were released at unmount. The detached canvases registered no subsequent frame writes over the 400 ms observation window. These are live allocation counters, independent of process-wide GPU memory.

The Phase 3.5 Studio orbit reported 30 renders at pointer release and 34 after damping, with a maximum of one render per sampled animation frame. The hotfix's isolated Studio workflow measured 27 and 31 respectively, with the same maximum of one. Both runs reported 183 draw calls and 164,714 triangles in the full tower view.

## Changed files

- `packages/frontend/src/components/model-3d/ThreeBuildingScene.tsx` owns context lifecycle, invalidation and cleanup. It also keeps the synchronous PNG capture path and guards capture while the context is lost.
- `packages/frontend/e2e/rh-studio-workflow.spec.ts` verifies accepted studies, positive Tower draws, editing navigation, structural CAD, GLB download and persisted reload.
- `packages/frontend/e2e/rh-webgl-recovery.spec.ts` and `packages/frontend/playwright.webgl.config.ts` run real repeated loss and restoration against the production preview.
- `packages/frontend/package.json` and `.github/workflows/verification.yml` invoke the package-local runner.



## Verification results

| Command from repository root | Result |
| --- | --- |
| `pnpm build` | Passed, 9/9 tasks. Seven unchanged dependencies used the local build cache. Vite reported its existing chunk-size warning. |
| `pnpm typecheck` | Passed, 16/16 tasks. |
| `pnpm lint` | Passed, 16/16 tasks. |
| `pnpm --filter @ai-floor-planner/frontend run test:e2e:repair rh-studio-workflow.spec.ts` | Passed, 1/1 in 1.5 minutes. |
| `pnpm --filter @ai-floor-planner/frontend run test:e2e:repair` | Passed, 14/14 in 3.2 minutes, including the extended Studio workflow. |
| `pnpm --filter @ai-floor-planner/frontend run test:e2e:webgl` | Passed individually and after the complete browser run. The final run took 50.1 seconds and performed five real restorations. |
| `pnpm test:integration` | Passed, 21 tests in four files. |
| `pnpm --filter @ai-floor-planner/backend run test:integration` | Passed, 31 tests in four files. |
| `pnpm exec turbo run test --only --concurrency=2 --continue '--filter=!@ai-floor-planner/planning-engine'` | Passed, 8/8 tasks and 1,144 tests, with eight existing opt-in skips. Frontend passed 181 tests and backend passed 225. |
| `pnpm --filter @ai-floor-planner/planning-engine run test --exclude '**/phase0-generation-benchmark.test.ts'` | Passed, 592 tests in 75 files. The matrix benchmark ran separately. |
| `pnpm --filter @ai-floor-planner/planning-engine run test src/__tests__/phase0-generation-benchmark.test.ts --maxWorkers=1 --minWorkers=1` | Passed in isolation. The one benchmark test produced plans for 288 of 288 cases in 472.30 seconds, with 88 legacy fallbacks. |

The three package runs totaled 1,737 passing tests. The earlier base run reported an unexpected planning worker exit after 2,629.66 seconds. Running the benchmark separately completed the package verification. The Windows AutoCAD fixture audit reported zero errors. All six backend Blender tests passed, including native export and readback. The existing opt-in provider and native ETABS tests retain their configured skips. The Chromium suite and HTTP tests exercised canonical data, CAD import, editing, GLB output and project reload.

The production and test changes are committed at `92210c1830251f1fcf1a3119735603aa0e76bcd3` on `repair/stabilize-rh-planner`.

## Phase 4A decision

**CONDITIONAL.** The requested browser, build, static and package gates passed. Keep Phase 4A implementation deferred until the upstream Cota and OpenBIMStudio revisions and licenses are verified, and the native exchange acceptance plan is agreed. The existing adapter contract supplies the data and readback boundary. Native ETABS opt-ins and the separate legacy cinematic walkthrough were outside this run.

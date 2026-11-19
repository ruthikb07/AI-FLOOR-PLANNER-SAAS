# RH Planner hero performance baseline

Measured 19 November 2026 against the existing production Vite build on `feature/phase2-room-area-regeneration`, base commit `7a046a3` plus the current worktree. This baseline is for the welcome-page demonstration model.

## Capture method

- Playwright Chromium driving installed Google Chrome 158.0.8127.36, headless, Windows 11, Core i5-13450HX, 1280 × 800 CSS pixels, DPR 1, ordinary motion. The canvas drawing buffer was 1280 × 800. WebGL reported **Intel UHD Graphics through ANGLE/D3D11**. The machine also has an RTX 4050. The measured browser context selected Intel.
- Vite preview served existing production files at `127.0.0.1:4189`. The hero asset was `ResidenceShowcase-C7kOVr2N.js` with SHA-256 `46f7357323a0fbb19803368782452a2c74d2a0f69204e8b281d7b8c76ecade04`.
- The Chrome DevTools Protocol trace used an unmodified production response, a fresh browser context, and user-timing marks around native chapter clicks. It captures cold navigation, then Exterior → Site → Section → Plan → Landscape → Exterior, then the first evening switch. Each action window ends when the rendered progress reaches its requested value. The trace reported no data loss flag and the page emitted no uncaught browser errors. [Chrome trace](../test-artifacts/hero-perf-phase-a/chrome-performance.json.gz) · [Navigation and bundle evidence](../test-artifacts/hero-perf-phase-a/navigation.json)
- A separate browser run sampled `renderer.info` after 255 render calls through a browser-only response hook. The same run tracked WebGL texture allocations. The timing trace and the renderer counters were collected separately so the probe would not inflate reported frame times. Application source and production files were not edited for either measurement. [Renderer evidence](../test-artifacts/hero-perf-phase-a/renderer-info.json)

## Frame timing

Chrome compositor `DrawFrame` timestamp deltas on the page layer tree, in milliseconds. Each pair is entirely inside one marked interaction. These deltas describe compositor draw cadence and do not represent physical display timestamps or GPU execution time. Idle gaps between clicks and time from an interaction mark to its first draw are tracked separately. [Trace summary](../test-artifacts/hero-perf-phase-a/trace-summary.json)

| Interaction | Intervals | Average ms | Median ms | p95 ms | Worst ms | Over 20 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Exterior → Site | 33 | 13.79 | 14.61 | 18.12 | 19.60 | 0 |
| Site → Section | 39 | 14.99 | 13.59 | 30.62 | 49.99 | 9 |
| Section → Plan | 28 | 20.30 | 19.68 | 29.80 | 47.31 | 12 |
| Plan → Landscape | 32 | 14.15 | 13.56 | 21.66 | 33.95 | 5 |
| Landscape → Exterior | 54 | 15.55 | 15.41 | 24.67 | 27.37 | 13 |
| **Camera actions pooled** | **186** | **15.59** | **14.91** | **27.30** | **49.99** | **39** |
| First evening transition | 18 | 21.14 | 23.19 | 34.35 | 35.94 | 14 |
| All marked actions pooled | 204 | 16.08 | 15.26 | 27.73 | 49.99 | 53 |

The first evening action took **1,678.85 ms from the pre-click mark to the first compositor draw**. That startup wait precedes its within-action frame pairs. The Chrome trace recorded a **1,659.74 ms wall-time hero callback** during that wait with **16.27 ms of thread time**. The largest Site → Section hero callback took **112.81 ms**. Across all 194 traced hero callbacks during the marked actions, wall time was 10.90 ms average, 1.46 ms median, 4.21 ms p95 and 1,659.74 ms worst. Layout totaled 4.75 ms across 11 events, with a 0.93 ms maximum. [Chrome trace](../test-artifacts/hero-perf-phase-a/chrome-performance.json.gz) · [Trace summary](../test-artifacts/hero-perf-phase-a/trace-summary.json)

## Renderer workload

The draw counts come from `renderer.info.render.calls` after each render. The installed Three.js renderer resets its per-render counters before the shadow pass. A shadow refresh can therefore increase both calls and triangles. The warm measurements below use the cached shadow map. No post-processing passes were added for the audit. [Renderer evidence](../test-artifacts/hero-perf-phase-a/renderer-info.json)

| Warm view | Draw calls | Triangles | Three.js texture count |
| --- | ---: | ---: | ---: |
| Exterior | 152 | 69,912 | 9 |
| Site | 152 | 69,912 | 9 |
| Section | 87 | 57,888 | 9 |
| Plan | 152 | 69,912 | 9 |
| Landscape | 152 | 69,912 | 9 |
| Exterior, evening | 152 | 69,912 | 9 |
| Peak among sampled shadow-refresh renders | **272** | **136,620** | **9 maximum** |

The scene contains 143 meshes, including 142 instanced meshes with 3,458 instances. The sky dome was the only mesh with frustum culling disabled. Nine mesh batches use transparent materials. There were 79 shadow-refresh renders in the instrumented sequence. The first render registered 272 draws, 136,620 triangles and three textures. [Renderer evidence](../test-artifacts/hero-perf-phase-a/renderer-info.json)

Peak tracked WebGL texture payload was **52,429,856 bytes (50.00 MiB)** with zero unclassified texture levels. The estimate sums dimensions, formats, mip levels and faces seen by the WebGL allocation probe. It includes tracked environment and shadow textures. Renderbuffers, browser-decoded images, driver overhead and total GPU residency were outside this measurement. [Texture allocation records](../test-artifacts/hero-perf-phase-a/renderer-info.json)

## Cold navigation and assets

| Event or payload | Measured result |
| --- | ---: |
| Ready DOM flag | 1,153.50 ms after navigation start |
| HDR response completed | 1,336.60 ms after navigation start |
| Gap from ready flag to HDR response completion | 183.10 ms |
| Landing entry JavaScript, gzip | 249.23 kB |
| Incremental hero and shared renderer chunks, gzip | 163.27 kB |
| All JavaScript loaded on the welcome page, gzip | **412.50 kB** |

The ready flag precedes HDR delivery. The trace then shows a **1,664.97 ms hero callback** starting near 1,390 ms after navigation. Network response times establish resource delivery. They do not independently establish decode, upload or shader completion times. Across the cold sample, compositor draw-interval average was 54.89 ms, median 7.20 ms, p95 300.42 ms and worst 758.99 ms. The cold window includes startup gaps, and a render callback can span beyond that window. JS sizes are sums of gzip-compressed local production files, in decimal kB. [Navigation and bundle evidence](../test-artifacts/hero-perf-phase-a/navigation.json) · [Trace summary](../test-artifacts/hero-perf-phase-a/trace-summary.json)

## First-use lighting diagnostics

The source changes fixture visibility when the evening blend begins. In a separate instrumented browser run, the first switch to evening issued **12 shader compile calls and 6 program links**. Returning to daylight and switching to evening again issued zero new compile or link calls. All six first-evening link-status queries totalled 1.00 ms, with a 0.30 ms maximum. These observations establish first-use shader variants and later reuse. The probe did not reproduce the earlier 1.66-second pause in any of the measured WebGL calls, so the cost of each part of that pause is unverified. [Lighting code](../packages/frontend/src/components/studio/ResidenceShowcase.tsx#L155) · [WebGL probe output](../test-artifacts/hero-perf-phase-a/webgl-call-diagnostics.json)

## Baseline against the requested budgets

- **Draw calls · FAIL on the baseline.** Five of six measured steady views show 152 draws against an under-150 target. The observed shadow-refresh peak was 272.
- **Triangles · PASS for this sample.** The maximum observed was 136,620 against 600,000.
- **First-load JavaScript · FAIL for the whole landing load.** 412.50 kB exceeds 400 kB. The incremental hero and renderer payload is 163.27 kB.
- **Frame pacing · FAIL on the desktop sample.** The five camera actions averaged 15.59 ms between compositor draws and reached 27.30 ms at p95. They produced 39 intervals over 20 ms. The first evening action had a separate 1.68-second first-draw wait.
- **Total texture residency, phone performance and future GLB · NOT VERIFIED.** The texture figure is a payload estimate. No phone or GLB was benchmarked in Phase A.

A repeatable before/after comparison should use the same viewport, adapter, fresh context, chapter clicks and lighting state. Keep the Chrome timing trace free of renderer hooks and collect diagnostic counters in a separate run.

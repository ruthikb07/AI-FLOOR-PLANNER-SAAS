# Defect ledger

Baseline `1e0d1fefd87e8550b648e1c62732c5e5c7cf24ce`.

| Defect | Reproduction on baseline or unchanged route | Repair and regression |
| --- | --- | --- |
| HTTP access and input validation | Loopback HTTP requests with a foreign browser origin received 200 for project listing and CAD capabilities, 404 for artifact lookup, and reached evaluation, generation and E2K handlers. A malformed project body reached the store and returned 500. A malformed revision was treated as a resource lookup. Eight new trust-boundary assertions failed. | Enforce the loopback/single-operator or private bearer boundary before dispatch, scope CORS to allowlisted origins, validate media type and size, check project/revision IDs and request shapes, and suppress unexpected error details. `http-trust-boundary.test.ts` covers denial, token mode, allowed preflight and malformed requests through real listeners. Existing live export and local-project round-trip tests cover real file responses. |
| Failed generation accepted | Real 42 m by 34 m, one-typical-floor provisional apartment briefs returned HTTP 200 with `validationReport.isValid=false` and `FLOATING_COLUMN`. The unchanged CAD plot route also returned 200 for the irregular DXF rejection fixture. The initial deferred-framing pinwheel diagnostic passed its audit, so it was unsuitable as a rejection fixture. | Block failed geometry, mandatory closure and critical opening findings in the backend routes, worker and editor boundary. `generation-acceptance-repair.test.ts` covers actual passing and failing solver output and a detached door on a real generated Building. The DXF HTTP regression and Chromium rejection test verify the other production boundaries. |
| Worker failures leave loading active | Chromium threw a standard `DataCloneError` when sending a generation message. The error dialog appeared but the CAD action stayed in its loading state. Worker crash/malformed message/timeout branches had no shared terminal cleanup. | A timed worker task has one cleanup/settlement path. Studio ends the busy state on errors and displays retry/close. `worker-task.test.ts`, room solver tests and the Chromium message-send case cover termination and retry state. |
| Regeneration changes project identity and can lose prior design | Chromium observed a freshly allocated UUID in the regeneration request despite a different active project ID. The old full replacement reset editor history. | Intake allocates a project ID, retries reuse it, and each worker attempt allocates a distinct run ID. Regeneration preserves canonical identity and advances revision, archives the prior envelope, and applies an undoable audited snapshot. Chromium checks the actual request and durable before/after data and downloads the older revision after reload. Core verifies exact application and undo/redo. |
| Failed browser save and legacy migration can misreport or lose data | A second migration after an IndexedDB quota failure deleted the legacy key because the mirror contained it. `flush` inferred success from the same mirror. Chromium aborted an actual save transaction and the baseline displayed no retry or warning. | Verify database readback, preserve differing legacy bytes, report the latest save outcome, retry from the engine's current snapshot and preserve the v1 object store during schema upgrade. The repeated migration, Chromium transaction abort/retry, and real v1 database upgrade are regression cases. |
| Verification absent in Actions | `git ls-files .github` returned no workflows. | The verification workflow installs from the frozen lockfile and runs build, typecheck, package tests, monorepo integration and Chromium against production builds. |

## Baseline command evidence

| Command | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Completed for all 10 workspace projects. |
| `pnpm build` | 9/9 tasks, with Vite chunk-size warning. |
| `pnpm test:integration` | 21 passed across 4 files. |
| `pnpm --filter @ai-floor-planner/backend exec vitest run src/__tests__/http-trust-boundary.test.ts src/__tests__/phase1-exports-and-routes.test.ts` | 2 existing tests passed and all 8 new trust-boundary assertions reproduced the defect. |
| `pnpm --filter @ai-floor-planner/frontend exec vitest run src/__tests__/generation-storage-regression.test.ts` | 22 passed and the new repeated-migration regression failed. |
| `pnpm --filter @ai-floor-planner/frontend exec playwright test --config playwright.repair.config.ts` | Both original repair cases failed on baseline production output. A separate run with `-g 'real IndexedDB abort'` also failed on baseline output. |
| `pnpm --filter @ai-floor-planner/backend exec vitest run src/__tests__/rh-local-all-shapes-and-cad-import.test.ts -t 'does not publish failed'` | The unchanged CAD generation path returned 200 instead of 422. Four tests were skipped by the filter. |


## Final disposition

The six repair areas above are covered by the regressions and verification in [the phase handoff](PHASE_HANDOFF.md). Candidate quality failures remain visible as solver or framing findings and require their own diagnosis. Hosted multi-user authorization and native/provider verification are separate remaining gates.

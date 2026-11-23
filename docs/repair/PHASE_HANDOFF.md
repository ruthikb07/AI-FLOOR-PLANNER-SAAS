# Phase handoff

Read [the master context](MASTER_CONTEXT.md) for the architecture and deployment contract, and [the defect ledger](DEFECT_LEDGER.md) for the reproductions.

## Changed files

- `packages/backend/src/server.ts`, `api/http-access.ts`, `api/http-input.ts`, `api/{generation,export,etabs-export}-routes.ts`, `routes/{local-project,cad-import}-routes.ts`, `services/local-project-store.ts` protect the mounted routes, validate persisted input and restrict publication of generated results. The backend package configuration, pnpm lockfile and tracked runnable server bundle include the updated boundary.
- `packages/constraint-engine/src/{generation-acceptance,index}.ts` owns the shared generation gate. `packages/core/src/types/building.ts` holds the run ID, and editor engine, command and type changes preserve the audited replacement through undo/redo.
- `packages/frontend/src/services/{argon-request,argon-generation,argon-planning.worker,worker-task,room-area-solver}.ts` own request identity, worker lifetime and result checks. `components/argon/{ArgonStudioShell,GenerationProgressModal,ProjectPortfolio}.tsx` apply accepted revisions and surface errors and archive access. `vite.config.ts` binds local development to loopback.
- `packages/frontend/src/services/{storage,durable-project-store}.ts` and `stores/editor-store.ts` handle browser durability, migration and retry. Backend, core and frontend test files and three Chromium specs cover the regressions and neighboring CAD/survey workflows.
- `.github/workflows/verification.yml` and `packages/frontend/playwright.repair.config.ts` define repeatable verification. The workspace and backend Vitest integration configs target tracked, runnable files.

## Next phase

- Some ordinary briefs still fail existing solver geometry checks, including provisional columns inside habitable rooms or stilt toilets and undersized balcony depth. Keep the rejection in place while diagnosing generation or framing with the exact brief and selected seed.
- The private hosted profile authorizes a single storage library. A multi-user deployment still needs principal-aware storage and project/artifact authorization.
- Browser archive entries are exportable as complete project JSON. An in-place restore UI, cross-tab conflict arbitration and cross-device sync remain separate work.
- Live provider/native verification remains opt-in. Preserve the distinction between software checks, native verification and professional review.


## Verification

| Command | Result on Windows |
| --- | --- |
| `pnpm install --frozen-lockfile` | Pass. Workspace lockfile installed with pnpm 9.7.0. |
| `pnpm build` | Pass, 9/9 tasks. Vite reported the existing large-chunk warning. |
| `pnpm typecheck` and `pnpm lint` | Pass, 16/16 tasks each. |
| `pnpm test` | Full uncached run passed 18/18 tasks, 1,708 tests passed and 7 skipped. The planning benchmark completed its 288-case matrix. AutoCAD's local native probe passed. |
| `pnpm exec turbo run test --concurrency=2` | Final pass, 18/18 tasks, 1,708 tests passed and 7 skipped. Frontend and backend suites reran; 15 unchanged tasks used the local cache. |
| `pnpm test:integration` | Pass, 21 tests across 4 files. |
| `pnpm --filter @ai-floor-planner/backend test:integration` | Pass, 28 tests across 4 files using live HTTP and real planning/export services. Before the integration configuration was repaired, this command exited 1 because its sole include pattern referenced an absent provider-smoke test file. |
| `pnpm --filter @ai-floor-planner/frontend exec playwright test --config playwright.repair.config.ts` | Pass, 11 Chromium tests against the built backend and Vite production preview. This covers a real v1→v2 IndexedDB upgrade, native IndexedDB abort/retry, regenerate/reload/archive, CAD import/disk reload, survey guard, and geometry rejection. |

Live Gemini and six ETABS/native evidence cases were skipped under their existing opt-in gates. Other browser suites with separate fixtures or native dependencies were outside the configured Chromium verification set. GitHub Actions execution remains pending until the repair commit is pushed or used in a pull request.

Intermediate runs caught test wiring and fixture issues. The initial browser success fixture used automatic massing/seed selection and was correctly rejected. The final success fixture uses a real 32 m by 36 m compact brief that passes the same audit. The existing rectangular survey journey now uses that passing input. The existing DXF test confirms explicit rejection for its failed plot-generated design, and the floor-plan import test uses the current framing text. One concurrent local verification attempt reported a Vitest worker exiting on a transient missing `loupe` module after a dependency refresh. A later unbounded pnpm test run also reproduced a five-second frontend timeout under load (180 passed, 1 failed in the frontend). The workflow now limits Turbo to two processes and frontend Vitest to three workers. Assertions and timeouts are unchanged.

Raw logs for this worktree are under `tmp/repair/`. Test-generated reference outputs were excluded from the repair commit.

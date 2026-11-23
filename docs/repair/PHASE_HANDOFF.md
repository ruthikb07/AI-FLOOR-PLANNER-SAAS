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

## Phase 2 handoff

Phase 2 started from `c480f137c874988e0a67d14d04d78be3a6a06194` on the same repair branch. Phase 1's API and editor acceptance gates remain active. The audit now also blocks mandatory intent and strict area misses. See [the architectural evidence](PHASE2_ARCHITECTURAL_VERIFICATION.md) for the production inputs, exact measurements and failure boundaries.

### Changed paths by dependency

- `packages/planning-engine/src/structural/{provisional-column-host,structural-framing-synthesizer}.ts`, `validator/geometry-validator.ts` and `facade/facade-coordination-engine.ts` align preliminary framing and its audit across storeys. The analyzed structural workflow is separate.
- `packages/planning-engine/src/catalog/shape-geometry-synthesizer.ts`, `interpretation/{architectural-placement,space-filling-snapper}.ts`, `pipeline/architectural-connections.ts`, `repair/apartment-error-repair.ts`, `topology/plan-assembler.ts`, and `packages/{geometry-engine/src/apartment-ledger,constraint-engine/src/apartment-closure}.ts` keep balconies, wall ownership and openings measurable after scaling or repair.
- `packages/planning-engine/src/apartment/{apartment-area-targets,multi-sheet-apartment-solver}.ts`, `topology/{architectural-intent,generative-topology-engine,production-bridge,topology-families}.ts`, `pipeline/stage-progress-emitter.ts`, `packages/constraint-engine/src/generation-acceptance.ts`, and the core building/apartment types carry dimensional requirements, diagnostics and topology exclusions through the audit.
- `packages/ai-orchestration/src/{orchestration/architectural-proposal,providers/gemini}.ts`, core AI types, `packages/backend/src/api/generation-routes.ts` and the frontend worker/concept views carry provider attribution and sanitized failures. The compiled backend entry point was refreshed.
- The Studio store and BHK picker and the CAD import modal expose 1–6 flats. `ArgonStudioShell.tsx` shows measured generation findings even when the separate architectural score passes. The existing editor layout and project persistence remain in use.
- Backend generation/CAD regressions, Chromium repair/DXF fixtures, the new Phase 2 audited-building test, topology exhaustion test and provider telemetry regressions cover changed behavior. Prior geometry, planning and project-recovery assertions remain in place.

### Verification on the final source

| Command | Result |
| --- | --- |
| `pnpm exec turbo run test --concurrency=2 --continue` | 18/18 tasks passed in the isolated worktree. 1,722 passed and 8 opt-in tests skipped. Planning passed 593 tests across 76 files, including the 288-case benchmark. The frontend package was rerun after its final selector change. |
| `pnpm build` | 9/9 tasks passed. Vite emitted its large-chunk warning. |
| `pnpm typecheck` | 16/16 tasks passed. |
| `pnpm exec turbo run lint --concurrency=2` | 16/16 tasks passed in the isolated worktree after OneDrive locked an ESLint dependency. |
| `pnpm test:integration` | 21 passed in 4 files. |
| `pnpm --filter @ai-floor-planner/backend test:integration` | 28 passed in 4 files. |
| `pnpm exec turbo run test --concurrency=2 --filter=@ai-floor-planner/frontend` | 181 passed in 35 files, including the amended regression for all six Studio strategies. |
| `pnpm --filter @ai-floor-planner/frontend exec playwright test --config playwright.repair.config.ts` | 11 passed against the final production builds in 3.4 minutes. |
| `pnpm --filter @ai-floor-planner/planning-engine exec vitest run src/__tests__/geometry-validator.test.ts src/__tests__/rh-facade-coordination-and-adaptive-flats.test.ts src/__tests__/rh-gate1-proportions-setbacks-furniture.test.ts src/__tests__/rh-phase2-compliance-gate.test.ts` | 24 passed in 4 files after aligning the preliminary column-spacing checks. |
| `pnpm --filter @ai-floor-planner/ai-orchestration exec vitest run src/__tests__/phase2-architectural-telemetry.test.ts` with `RUN_LIVE_AI_TESTS=1`, again with `RH_PHASE2_REFERENCE_PNG` | 3 passed in each final run. The text run retained HTTP 503 and used the configured Gemini fallback model. The image-bearing run completed on Gemini. |

### Remaining work and next gate

- Exact unequal per-flat carpet targets still miss on the documented 42 × 34 m fixture. The API rejects strict requests outside tolerance. Phase 3 needs a tested per-unit dimensional solve for more typologies, including irregular envelopes and protected core arrangements, before promising exact fit.
- An explicitly requested `WAVE_SERPENTINE` on the seed-2 32 × 36 m case still returns the audited `STEPPED_OFFSET_BLOCK` alternative. Preserve the requested and selected shape metadata. Distinguish unsupported shape fit from program infeasibility before treating the locked shape as mandatory.
- Test equivalence after final wall and room repair across more topology families and seed sequences. Candidate fingerprint exclusions and the demonstrated difference in physical door graphs do not establish universal diversity.
- Live text and image-bearing Gemini requests both completed on the final provider code. Local tests verify supported image guidance and precedence for explicit instructions. Arbitrary image-driven adjacency and room coordinates remain outside the implemented guidance.
- Site-specific authority and approved FSI inputs, stair protection/egress, legal carpet definitions and analyzed framing remain professional review gates. Phase 2 evidence applies to internal geometry and plan acceptance.

Phase 3 engineering can begin from this repair branch. Carry the remaining dimensional, massing, and review gates forward. The 288-case benchmark generated a plan in every case and used legacy partitioning in 88 cases. That benchmark counts solver outputs. The production API and Studio apply the audited acceptance gate before publishing a building.

## Phase 3 handoff

Phase 3 started from `7358df3760515cea588c2cef5203387d5574f74f`. The architectural generation gate now checks locked massing, final-design exclusions, conflicting sized programs and finished footprint containment. The strict area search compares measured carpet and retains the candidate with fewer non-area blockers and a better worst-unit fit.

The apartment editor's validated local revisions support opening edits and full-edge rectangular partition shifts. The editor rejects proportional changes that would rewrite neighbouring flats, floors or cores. PDF drawing exports now default to architectural content. GLB responses include the revision and source digest.

See [Phase 3 engineering verification](PHASE3_FINAL_VERIFICATION.md) for actual results and unresolved acceptance. [Phase 4 integration readiness](PHASE4_INTEGRATION_READINESS.md) defines the adapter contracts and remaining gates. Phase 4 production integration is NOT READY.

Final verification passed 1,731 monorepo tests with 8 opt-in skips, 52 integration tests and 14 Chromium repair tests. Native fixture results and the supplemental legacy browser failures are recorded in the verification report.

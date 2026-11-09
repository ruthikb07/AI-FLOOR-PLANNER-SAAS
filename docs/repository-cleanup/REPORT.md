# Repository cleanup evidence

Date: 2026-11-09. Scope: the user-listed legacy dumps, scripts, root reports and unused sibling workspace.

- Removed 664 original files (45,432,960 bytes).
- Retained 13 required test inputs (2,220,795 bytes) in `tests/fixtures`: three canonical closure JSON fixtures and five real recording/image pairs used by opt-in replay tests.
- Net legacy bytes removed after retaining those inputs: 43,212,165 (43.2 MB / 41.2 MiB).
- Removed all 12 listed Python mutation scripts, all 17 present legacy root reports, and 17 tracked CAD sample artifacts. `AGENTS.before.md` was already absent.
- Verified zero `plancraft-source` references in packages/tests and workspace configuration before deleting the explicitly named sibling directory.
- SHA-256 manifests confirm `AGENTS.md`, `docs/phase0`, `docs/phase1`, `docs/phase2` and `packages/backend/data/reference-images` are unchanged.
- `.ignore` contains the requested scanning exclusions, plus the retained binary replay-fixture directory. `.gitignore` excludes regenerated output and sweep dumps. `rg --files` returned no files from the requested excluded paths.

## Test integrity

Cleanup did not modify production source. Six test files now use stable fixture locations or stop writing persistent debug output. The complex CAD fixture load is mandatory; it can no longer silently skip its assertions when an output dump is missing. The scale test retains all its paper-scale and stale-revision assertions. All retained fixtures have the same SHA-256 hashes as their original bytes. Existing opt-in/live flags are unchanged.

## Verification

| Gate | Result |
| --- | --- |
| `pnpm typecheck --concurrency=1` | PASS: 16/16 Turbo tasks, 0 TypeScript errors |
| `pnpm run test --concurrency=1` with one Vitest thread | PASS: 1,469 passed, 7 existing opt-in skips, 0 failures/errors; 18/18 Turbo tasks |

The test invocation uses PNPM/Turbo pass-through: `pnpm run test --concurrency=1 -- -- --pool=threads --maxWorkers=1 --minWorkers=1`. This keeps package tasks and test workers sequential on OneDrive. The initial invocation with one separator was rejected by Turbo before tests ran; the retained `test-invocation.log` records that CLI error.

Detailed counts, paths, protected-content fingerprints and migrated-fixture hashes: `verification.json`. Local gate logs: `typecheck.log` and `test.log`.

The current suite includes 45 Phase 3 tests added before this cleanup, explaining the increase from the requested 1,424-test baseline to 1,469 passing tests. The final successful run reused 17 successful tasks from the same unchanged source state and completed the backend task. Earlier runs encountered OneDrive `EBUSY` dependency reads and a mapped backend bundle write; those environment attempts are retained in the ignored local `test-*-lock*.log` / `test-ebusy.log` files. No assertions, isolation settings or skip conditions were weakened.

Final post-gate checks: every requested legacy target remains deleted/empty; the duplicate sibling is absent; all retained test inputs match their original SHA-256 hashes; every protected file is unchanged. Generated runtime artifacts remain git-ignored.

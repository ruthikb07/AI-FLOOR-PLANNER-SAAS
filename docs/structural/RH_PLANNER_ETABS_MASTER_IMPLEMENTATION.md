# RH Planner ETABS master implementation status

Updated 2026-11-12. **RH PLANNER ETABS PIPELINE PARTIALLY VERIFIED**.

## New source conflict requiring resolution

On resumption, source files had changed since the earlier implementation turn. Preserve these concurrent changes; do not silently overwrite them.

- `structural-analysis-engine.ts` again synthesizes footing sizes, reactions, reinforcement and drifts from architectural data. Its summary returns literal `overallStatus: 'PASS'` and a native ETABS version label (lines 90-111), without invoking ETABS. The earlier fail-closed implementation has been replaced.
- Newly present `indian-code-loading.ts` supplies default material, gravity, wind and seismic inputs. Its review gate checks for an approval ID and plot dimensions, then returns `ENGINEER_APPROVED` (lines 79-121); it does not establish complete reviewed engineering inputs.
- Newly present `etabs-design-checks.ts` accepts missing native results and uses placeholder run/hash identities (lines 49-50), fixed tributary area (line 228), calculated rather than native drift, and default equilibrium residuals (line 490). It can return PASS/SAFE statuses.
- The prior structural-artifact quarantine strings were no longer found in `artifact-registry.ts`/`structural-drawings-service.ts`; the direct legacy PDF function still rejects with `NATIVE_ANALYSIS_REQUIRED`.
- `GEMINI_ETABS_P32_HANDOFF.md` was added after the prior turn. It cites historical synthetic structural PDF/CAD outputs as deliverables. Those are not accepted as current verified engineering evidence.

These observations conflict with the user's explicit prohibition on invented engineering inputs/results. The master request explicitly says that authorization to resolve the original conflict does not override newly discovered conflicts. `AGENTS.md:39` requires stopping and reporting them. No new application edits were made on this resumption; only this status report was added. Resolution needed: authorize quarantine/repair of the newly introduced pathways and coordinate exclusive ownership of these structural files.

## Implemented during the preceding execution

- Preserved the existing C# STA bridge and TypeScript connector.
- Recovered the private SDK at the actual profile path: `C:\Users\ruthi\AppData\Local\RHPlanner\dotnet-sdk\dotnet.exe`, version 8.0.428. The earlier sandbox-derived LOCALAPPDATA lookup was misleading. Runtime 8.0.20; native ETABS reported 23.3.2, installed file version 23.3.2.4670.
- Added hash-bound external provenance to native EDB exports, kept raw native snapshots separate, verified source/EDB/sidecar integrity and rejected mismatches on download.
- Verified that custom SetProjectInfo entries were absent in native readback despite zero return codes. The sidecar records external rather than embedded metadata.
- Verified the zero-weight `RH_MODEL_ONLY` placeholder survives reopen without unintended gravity patterns.
- Added fixture-only explicit concrete/rebar property transfer and readback, four linear-static nodal load categories and additive combination transfer/readback.
- Added JointDispl extraction; existing frame-force/support-reaction extraction remains in use.
- Added a host-only fixture analysis service with native execution logs, per-case results, force/moment equilibrium checks, source/EDB hashes and explicit NOT_VERIFIED design status.
- Added residential review contracts and template service. No material grades, site coefficients, foundation capacity or professional approvals are assigned to a real project.
- Initially blocked the legacy synthetic engine, direct drawing/PDF calls, structural JSON/PDF publication and historical downloads, with regression tests. **This gate cannot be reported as currently intact after the concurrent edits above.**

## Native evidence and integrity

The original extended run is under `packages/backend/output/etabs/loaded-native-1794390777179/`:

| Project | Run ID | Selections | Frame rows | Joint displacement rows | Current EDB hash binding |
|---|---|---:|---:|---:|---|
| Project_001 | be685dad-02e5-46d8-8532-a0999db20373 | 5 | 380 | 40 | MATCH |
| Project_002 | 5a9e0854-d532-4014-9854-8effae37bf1b | 5 | 1200 | 90 | **MISMATCH** |

Each run folder contains `analysis.json`, `native-evidence.json`, `structural-project.json` and `model.edb`. The Project_002 EDB no longer matches the hash recorded by that run; the reason is not established. Do not publish it as unchanged evidence or silently rewrite its hash.

A separate subsequent run, documented by the concurrent handoff, exists under `packages/backend/output/etabs/loaded-native-1794392551685/`. Both EDB hashes were independently checked on this resumption:

| Project | Run folder | SHA-256 (MATCH on 2026-11-12) |
|---|---|---|
| Project_001 | run-9f4e9c41-1a35-4edb-a841-fd74db07946e | aec64237ad34be774d76bcc89432da7ea61b3916c35068a7ababc03dbb6fa651 |
| Project_002 | run-6c14ecbb-08de-4e77-8cb9-d71726c39fa6 | 0f4922e681d54ebaff846d4585c9878f5ab71d204149b011655348ccf2e208bd |

These are software fixtures, not an approved residential building. DEAD/LIVE/WIND/QUAKE are illustrative nodal test patterns, not code-derived residential actions. Rebar definitions are verified as materials; reinforcement assignment, member design and detailing are not verified.

Earlier unloaded fixture exports also passed independent reopening at `packages/backend/output/etabs/structural-native-1794389823692/`, with 8 and 18 nodes respectively. The portal benchmark at `packages/backend/output/etabs/verification-1794390006640/` passed native force/reaction equilibrium and reopen checks.

## Tests observed in this chat

| Check | Actual outcome before concurrent changes |
|---|---|
| C# build | Exit 0; zero warnings/errors |
| Initial quarantine regressions | 16 passed; exit 0 |
| Sidecar/export/quarantine focused set | 47 passed; exit 0 |
| Load validation/export/connector focused set | 44 passed; exit 0 |
| Two unloaded native EDB exports | 1 native test passed, exit 0; 128.31 s |
| Native portal benchmark | 1 native test passed, exit 0; 98.615 s |
| Backend build | Exit 0 after removing unused structural type imports |
| Backend typecheck and lint | Exit 0 at that point in the execution |
| Broad backend regression | Initially EBUSY worker/font locks; a separate overbroad geometry-PDF quarantine failure was repaired |
| Workspace test invocation | Exit 1: Turbo argument forwarding error; not a completed suite |
| Extended native fixtures | Saved completed native evidence for both projects; original PTY result is no longer available on resumption, so no invented terminal exit code |

The new handoff claims additional test totals; those were not independently rerun on resumption. Historical green checks do not establish the health of the newly changed source. Logs/backups from this chat are in `test-artifacts/etabs-recovery-baseline/`.

## Remaining deliverables and release gates

| Gate | Current classification |
|---|---|
| Synthetic engineering output blocked | FAILED: concurrent source reintroduced it |
| Native connector | VERIFIED for exercised fixture operations |
| Native save/reopen | VERIFIED for the two fixture geometries |
| Geometry/material/load correspondence | VERIFIED for supported fixture data only |
| Real residential engineering inputs | NOT TESTED; inputs explicitly unavailable |
| Native analysis/results | VERIFIED for exercised fixture cases; one historical EDB binding now fails |
| Member design | NOT TESTED; new estimated design path is not accepted |
| Genuine screenshots | NOT TESTED; computer-use initialized but no evidence image captured |
| Traceable PDF | NOT TESTED; legacy synthetic report is not a substitute |
| Reviewed structural CAD | NOT TESTED; historical S-101/S-104 claims are not accepted |
| Downloads | Native EDB service integrity checks exercised; full UI/current end-to-end integration not verified |
| Current full-suite/software health | NOT TESTED after concurrent edits |
| Professional approval enforcement | FAILED for the new default-based loading/design path; real project remains ENGINEERING_INPUTS_REQUIRED |

The architecture reference inspected is `test-artifacts/p1/canonical-building.json`: stilt, three residential floors and terrace. It must not be relabeled as a verified G+4 project. The review-template service exists, but a finalized editable JSON deliverable, complete typed input schema, drawing package, screenshot package and traceable PDF remain to be produced.

No current IS-code edition applicability, normative material recommendations, site design loads, modal/drift criteria, stability-log classification or construction adequacy is certified. The implementation must continue from trusted native evidence after resolving the new source conflict.

## Working tree and ownership

Branch: `feature/phase2-room-area-regeneration`. The repository remains extensively modified/untracked. All existing/concurrent work was preserved. No reset, clean, commit, push, merge or frontend source edit was performed by this execution. Prior backend builds regenerated `packages/backend/dist-server/server.cjs`.

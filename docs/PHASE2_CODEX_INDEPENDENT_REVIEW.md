# Phase 2.5 — Independent code review

Date: 2026-11-10. Status: **NOT READY**. Professional review required.

## 1. Scope and repository provenance

Reviewed the seven requested Phase 2 files, related geometry/closure validators, editor dispatch/history, generation-control persistence, renderer opening interpretation, 3D projection, JSON/local-storage persistence and CAD/PDF export paths. Source behavior, not prior reports, determined findings.

Branch: `feature/phase2-room-area-regeneration`.
Starting/current commit: `a20a44b0a7b277c615bdb672916932fbfb08f78a`.
Changes are uncommitted; no merge, push or main-branch change was performed. AGENTS.md permits commits only on explicit instruction. Pre-existing edits to `docs/PHASE2_ROOM_REGENERATION.md` and `room-area-command.ts` were preserved.

## 2. Confirmed defects and repairs

| Finding | Root cause / evidence | Repair |
| --- | --- | --- |
| Target reset on unit switching | The reset effect depended on `unit`; edited 15.123456 m² became 129.2 sq ft (the original 12 m²), reproduced before repair. Conversion also rounded repeatedly. | Keep the intended target separately in canonical mm²; unit changes only change its displayed value. Native input events and four round trips are tested. |
| Corrupt door identity / hosting | The room-pair loop accepted any door hosted by any affected wall, duplicating one door and dropping another. Existing shared-wall IDs could also be emitted repeatedly. Reproduction failed before repair. | Preserve the existing wall and opening collections, IDs, sizes and connectivity. Translate a host only when every linked room agrees. Reject ambiguous splitting, single-room endpoint reconstruction and detached connectivity. No unrelated door search or automatic aperture resizing. |
| Stale direct-command acceptance | `execute()` ignored its current Building argument. A newer version was overwritten in a red test. | Snapshot canonical state and compare its full fingerprint before mutation. The command requires an acceptance validator; the planning factory re-solves and matches the proposed canonical output. UI dispatch also checks the actual store constraint revision. |
| Preview freshness differed from acceptance | Modal used fabricated `revisionId: 'check'` and empty locks; handler used actual controls. | Both use current controls. Regression verifies fresh preview enabled, then disabled after a lock change even with the same revision ID. |
| Incomplete revision fingerprint | Previous signature omitted columns, beams, metadata and actual lock contents. | Fingerprint the whole Building and GenerationControlState. Tests cover column changes and changed lock contents with unchanged counters. |
| Unjustified capacity rejection | Both UI and solver rejected targets above 85% of floor polygon area. | Use gross floor area only as an upper bound; actual containment, overlap and minimum checks determine feasibility. A 110 m² target in a 120 m² floor is tested. |
| Misleading statutory minima | Unversioned hardcoded maps were labeled universal UDCPR statutory requirements; configured minimum had a 5% waiver. | Rename maps as engineering defaults, retain deprecated compatibility exports, label project/engineering limits honestly, and remove the waiver. No legal-compliance status is granted. |
| Inadequate geometry acceptance | `evaluateDesign` alone tolerates significant overlaps and does not comprehensively validate openings; cached area could produce a false already-met result. | Add deterministic geometry-owned cache, bounds, opening host/interval, overlap and column-clearance checks. Compare changed rooms with fixed stairs; compare moved wall footprints with columns. Preserve existing apartment-closure validation. |
| Incomplete protection | `isFixed` and locked hosts were not consistently enforced; structural preservation could be disabled. | Honor fixed rooms, room/floor/host locks and protected room cores. This operation always preserves structural geometry and rejects moving load-bearing walls. |
| History loss on failed redo | Redo popped its entry before executing a now-fallible validation step. | Pop only after successful execution. Test changing locks between undo and redo preserves the redo entry and unchanged Building. Selections use the room's actual floor. |
| Browser-thread solve | An 80 ms timer merely postponed the synchronous solve. | Use a dedicated module worker; abort/terminate on revision/selection change and unmount. Mocked worker tests verify cancellation, late results and failure handling. Headless/no-Worker fallback remains synchronous. |
| Weak existing UI tests | Assigning `input.value` did not reliably notify React. Claimed resize tests could regenerate the original target. | Use the native input setter followed by actual bubbling input events. |

No new dependency was installed. Geometry checks are in geometry-engine; proposal solving stays in planning-engine; core owns the reversible command and editor history; the frontend only orchestrates and displays canonical proposals.

## 3. Suspicions not established as originally stated

- **Naturally generated partial candidates:** for ordinary finite inputs, existing candidate-generation paths already checked tolerance before assembly. A natural PARTIALLY_FEASIBLE result was not reproduced. However, the public acceptance path had no status guard; it now rejects injected/unsatisfied partial alternatives, and candidate assembly emits only tolerance-satisfying results. No separate partial-acceptance policy was added.
- **Basic undo/redo geometry loss:** existing history snapshots restored fixture geometry correctly. The verified defects were validation bypass, stale selection-floor assumptions and history loss after a rejected redo—not generic snapshot loss.
- **Existing export test:** its title claimed export verification, but it only compared `polygonArea` to `room.area`; it did not serialize CAD. New tests exercise real bytes and DWG read-back.
- **Existing projection test:** it built a hand-authored already-resized room; it did not execute the optimizer or render WebGL. New backend coverage executes accepted regeneration and compares projected wall coordinates. This is still a headless projection test.

## 4. Blocking opening-position contract conflict

`layout/opening-integrity-solver.ts` explicitly treats canonical opening positions as centers and uses intervals `along ± width/2`. `geometry-engine/doors.ts` treats a position as a hinge/start. `renderer/svg-renderer.ts` first tries a start-based interval, falling back to a centered interval only when needed. These interpretations can place the same opening differently.

This audit does **not** silently migrate all historical plans or guess their intended coordinate convention. Physical-floor models with openings now return `OPENING_POSITION_PROFILE_UNSUPPORTED` before regeneration. An actual 18 m × 25 m, stilt + three residential floors + roof synthesis was run; its first bedroom measured 18.6058166667 m². A 15 m² request was blocked without changing the source Building. This is evidence of a limitation, **not a passed successful-regeneration scenario**.

A release needs an explicit opening-position reference contract, migration/version policy, shared geometry helpers and consumer parity tests. Until that is done, broad multi-story room-regeneration readiness cannot be claimed.

## 5. Tests and reproduction evidence

Recorded red runs before the corresponding repairs:
- `phase25-ui-red.log`: 1 failure / 5 passes; edited area reset on unit switch.
- `phase25-engine-red.log`: 2 failures / 16 passes; duplicate/lost doors and stale direct-command acceptance.

Additional safeguards have regression tests; no separate pre-fix failing execution was recorded for every added safeguard. Do not interpret the later test count as a complete historical red/green record.

Focused coverage now includes 30 planning tests, 8 UI/persistence/export tests, 2 mocked-worker tests and 2 backend regeneration/export/profile tests. The original single 3D projection test is also retained. The backend CAD fixture exercises two distinct doors; a planning regression additionally exercises two windows on a shared exterior host.

## 6. User acceptance scenarios

| Requested scenario | Actual evidence |
| --- | --- |
| Generate apartment; 12 → 15 m² bedroom; accept | 12 → 15 fixture resize, actual command execution and history pass. Actual synthesized apartment tested separately and blocked by the incompatible opening profile. Full scenario NOT READY. |
| Repeated unit conversion | Real React change events preserve 15.123456 m² across four metric/imperial round trips. Component test, not browser. |
| Locked neighbors, impossible expansion | Existing solver infeasibility tests plus fixed-room and lock regressions. No forced success. |
| Stale candidate after geometry change | Direct engine execution rejects a changed building; actual control changes also reject replay. |
| Multiple doors/windows | IDs, hosts, sizes and connectivity preserved in fixtures; ambiguous reconstruction rejected. Complex partition splitting remains unsupported. |
| Partial/invalid acceptance | Explicitly rejected by UI and validated command path; candidate geometry replay catches tampering. |
| Undo/redo, save/reload, export | Real EditorEngine history and canonical serialization, LocalStorageProjectStorage, PDF/SVG content, DWG parser round-trip and DXF area text. |
| Same canonical geometry in 2D/3D | Headless wall-coordinate and room-area checks pass. Opening parity and actual WebGL/browser inspection NOT VERIFIED. |

## 7. Quality gates

Final gate results are recorded below after completion. No earlier failed run is reclassified as a pass.

| Gate | Final observed result |
| --- | --- |
| `pnpm build --concurrency=1` | PASS: 9/9 tasks. Latest frontend-only change also rebuilt successfully. |
| `pnpm typecheck --concurrency=1` | PASS: 16/16 tasks. Latest frontend typecheck also passed. |
| `pnpm lint --concurrency=1` | PASS: 16/16 tasks. Latest frontend lint also passed. |
| `pnpm test:unit --concurrency=1 -- --pool=threads --maxWorkers=1 --minWorkers=1` | PASS: 17/17 tasks; 1,469 tests passed, 7 existing skips. Frontend has no test:unit script, so this is not the entire repository suite. |
| `pnpm run test --concurrency=1 -- --pool=threads --maxWorkers=1 --minWorkers=1` | PASS: 18/18 tasks; 1,657 tests passed, 7 existing skips, including 188 frontend tests. |
| Separate integration suite | FAIL: 22 passed, 5 failed; details below. |
| Real browser / WebGL UAT | BLOCKED; no successful browser observation. |

Machine-readable evidence: [phase25/verification.json](phase25/verification.json). Final logs remain in ignored root `phase25-*.log` files. Package runs include native CAD verification: 12 package audits reported zero errors. There are 21 added tests across optimizer, UI, mocked worker and backend coverage.

The initial default-worker unit invocation failed with EBUSY while opening Vitest worker.js. Serial thread execution uses `--concurrency=1 -- --pool=threads --maxWorkers=1 --minWorkers=1`; it does not skip assertions. Intermediate compile failures in newly added tests/checks were repaired and rerun.

Integration invocation: `pnpm run test:integration --pool=threads --maxWorkers=1 --minWorkers=1` — **22 passed, 5 failed**, 3 files passed, 2 failed. Four failures are live Gemini authentication/connectivity checks (HTTP 403 / AUTH_FAILED / unsuccessful completion). The fifth is the repeated-generation equality check: canonical furniture IDs differ. The existing `plancraft/auto-furnish-apartment.ts` creates random IDs with `generateId()`. No provider credentials, assertions or skip conditions were changed. These paths were not repaired as unrelated generation/provider work; they remain release-gate failures.

## 8. Browser and export evidence

- A real local Vite server was started on port 3017.
- In-app browser creation timed out; the retry returned `Timed out waiting for Statsig values`. No page or WebGL interaction was verified, and no screenshot is claimed.
- Component tests use jsdom. Worker lifecycle tests use a fake Worker. Neither proves actual browser worker delivery or WebGL rendering.
- New CAD coverage produced real DWG and DXF buffers from the accepted, saved and reloaded fixture. DWG was read with `acad.DwgReader`; DXF contained the actual `15.0 sq m` annotation. PDF output had a `%PDF-` header and nonempty bytes; SVG contained the resized area.
- Broader native AutoCAD tests execute independently in the package suite. Their results do not establish that the new room-regeneration fixture was inspected in AutoCAD UI.

## 9. Remaining limitations and architectural risks

1. Center/start opening interpretation is unresolved across legacy consumers. Physical-floor regeneration is deliberately blocked rather than misrepresented as valid.
2. Solver supports orthogonal rectangles and full shared partitions. It does not solve arbitrary polygons, split shared walls, complete external-wall reconstruction, furniture repositioning or arbitrary circulation redesign. Conservative rejection may reject feasible designs.
3. Area target is the canonical room polygon area. For centerline-cell apartment models this must not be mislabeled as verified net carpet area; the physical profile is blocked pending contract integration.
4. Existing engineering minima remain defaults, with project minArea honored. Jurisdiction-specific rule applicability, editions and clauses are not inferred. The separate regulatory architecture remains authoritative for its own checks.
5. Acceptance replays the bounded deterministic solver synchronously at command execution. Fixture timing is small, but no browser worst-case performance benchmark was obtained. Proposal generation runs in a worker where available.
6. Basic fixture-level projection parity is narrower than architectural validation, complete opening/egress parity or professional approval.
7. PropertyInspector also retains a separate manual width/depth command path, whose containment/overlap checks do not reuse the full regeneration acceptance policy. It must be included in a broader validated-editor transaction migration; this audit does not certify all historical editing commands.
8. Live integration and browser blockers remain. The old documentation's “Complete” claims are superseded for Phase 2 by this review.

## 10. Delivery decision

**NOT READY.** Verified defects were repaired and reviewable regression coverage added, but the requested complete apartment/browser workflow cannot be certified. Next work must resolve the opening-position contract and complete-wall/circulation behavior, then run real browser/WebGL acceptance and restore all integration gates. Do not merge into main automatically.

Automated checks provide engineering design assistance and require verification by a licensed Architect/Engineer before municipal submission.

# RH Planner — Generation Storage Repair

**Date:** 2026-11-13
**Defect:** generation reached Step 07 ("Finalizing Canonical Manifest") and failed with
*"Storage quota exceeded or storage unavailable."*, losing the completed plan.
**Status:** root cause fixed and verified.

> Automated tests demonstrate internal software behaviour only. They do not certify a
> design, establish statutory compliance or constitute professional review.

---

## 1. The error, traced to source

A single occurrence in the repository:

```
packages/frontend/src/services/storage.ts:247
  throw new Error('Storage quota exceeded or storage unavailable.');
```

It was the `catch` of `LocalStorageProjectStorage.save`. The failing call was
`localStorage.setItem`, so the storage provider was **browser localStorage** — not
IndexedDB, not the backend, not the artifact registry.

Full production pathway:

```
ArgonStudioShell.handleGenerate              components/argon/ArgonStudioShell.tsx:75
  └─ argon-planning.worker                   services/argon-planning.worker.ts
       └─ executeAuditedPlanningPipeline      planning-engine/pipeline/stage-progress-emitter.ts
            ├─ PLOT_BOUNDARY_SOLVE … UDCPR_CHECK   (Step 06 completes)
            └─ COMPLETE                            ("Finalizing Canonical Manifest")
  └─ editor.setBuilding(result.building)      ArgonStudioShell.tsx:94
       └─ projectStorage.save                 stores/editor-store.ts:329
            └─ localStorage.setItem           services/storage.ts:243   ← threw here
```

"Finalizing Canonical Manifest" is the `COMPLETE` stage label
(`GenerationProgressModal.tsx:28`). The geometry had already been generated and had
passed geometric validation, apartment-closure validation and UDCPR evaluation. Only the
save failed.

## 2. Root cause, measured

**The entire canonical Building JSON was being written into `localStorage`**, which gives
an origin roughly 5 MB shared across *every* project.

Measured by serializing real generated buildings (40 × 50 m, four 2BHK flats) through the
production solver. `localStorage` stores UTF-16, so a mostly-ASCII payload costs about
two bytes per character — the figures below are what it actually charges:

| Stack | Floors | Rooms | Walls | Furniture | Envelope | % of 5 MB | Projects before quota |
|---|---|---|---|---|---|---|---|
| G+1 | 2 | 75 | 227 | 226 | 0.71 MB | 14% | ~7 |
| G+2 | 3 | 131 | 396 | 442 | 1.27 MB | 25% | ~3 |
| **G+4** | 5 | 243 | 734 | 874 | **2.39 MB** | **48%** | **~2** |
| G+6 | 7 | 355 | 1072 | 1306 | 3.50 MB | 70% | ~1 |
| **G+10** | 11 | 578 | 1749 | 2168 | **5.73 MB** | **115%** | **0 — fails on first save** |

A single G+4 project consumed about half the entire origin budget. The user's generation
failed because an earlier project already occupied the rest. A G+10 project could never
be saved at all.

### Two aggravating defects in the same path

**The completed plan was discarded.** `setBuilding` called `projectStorage.save` *before*
`engine.setBuilding`, so the quota throw meant the validated building never reached the
editor. A storage problem destroyed a plan that had passed every geometric and regulatory
check — generation success and persistence success were not distinguished.

**The previous record was parsed six times.** `save` called `JSON.parse(previousRaw)`
separately for `spaceProgram`, `footprintIntent`, `generationSession`,
`generationControl`, `floorPlanImage` and `buildingBudget` — six full parses of a
multi-megabyte string on the hot finalization path.

### Why not the backend

`packages/backend/src/server.ts` serves only `/api/v1/health`, `generation/run`,
`generation/resume`, `image/floor-plan`, `image/interpret`, `image/artifacts` and
`architecture/evaluate`. There is **no project-persistence endpoint**, so the durable
store had to be IndexedDB, which has no comparable limit.

## 3. The repair

### New — `services/durable-project-store.ts`

Canonical geometry now lives in IndexedDB (`rh_planner_projects`, store `projects`, keyed
on `projectId`). `localStorage` keeps only the active-project id, about 40 bytes.

**The synchronous-read constraint.** Around eighteen call sites read projects
synchronously — `editor-store`, the Generation, Program, Site, Footprint and Budget
workspaces, `image-to-plan`, `AiConceptImagePanel`. Converting all of them to async would
be a far larger and riskier change than this defect warrants. So the store is
**write-through with an in-memory mirror**:

- `hydrateProjectStorage()` runs in `main.tsx` **before the first render** and loads every
  record into the mirror.
- Reads are served from the mirror, synchronously, exactly as before.
- Writes update the mirror immediately and persist in the background, returning a promise
  carrying the real durability.

### Honest durability reporting

`save()` returns a `SaveOutcome` rather than throwing:

| State | Meaning |
|---|---|
| `PENDING` | The write is in flight. Never reported as saved. |
| `SAVED` | The IndexedDB transaction **completed**. |
| `FAILED` | The transaction aborted; `reason` says why. |
| `UNAVAILABLE` | IndexedDB cannot be used at all. |

`editor-store` exposes this as `persistence`, and `ArgonStudioShell` renders a separate
amber **NOT SAVED** banner — deliberately not an error banner, because the plan is
complete and usable and only its storage is at risk. A failure is never relabelled as
success, and `SAVED` is never claimed before the transaction completes.

### Geometry is no longer lost to a storage failure

`setBuilding` now calls `engine.setBuilding(newBuilding)` **first**, then saves. The plan
opens, the user is taken to the 2D workspace, and persistence is reported separately.

### Integrity and idempotency

- Every record carries a `digest` (FNV-1a over the payload). `verify()` reads back from
  IndexedDB, bypassing the mirror, and checks it — a save is confirmed by reading it, not
  by trusting an event.
- Writes are keyed on `projectId`, so a repeated finalization **overwrites its own
  record** rather than appending a duplicate. Retries are idempotent.
- Writes to one project are serialized, so a retry cannot interleave with the write it
  is retrying and leave the older payload in place.

### No user data is ever deleted

There is no automatic eviction. A full store reports the size needed and states that
*"nothing has been deleted automatically"*. Legacy `localStorage` records are migrated at
hydration, and the original is removed **only after** the durable write confirms — an
interrupted migration loses nothing. A durable record always wins over a stale legacy copy
of the same id.

### Files changed

| File | Change |
|---|---|
| `services/durable-project-store.ts` | **New.** IndexedDB store, mirror, durability reporting, digest verification, usage measurement |
| `services/storage.ts` | Reads and writes go through the durable store; one parse of the previous record instead of six; `save` returns `SaveOutcome`; `hydrateProjectStorage()` added |
| `stores/editor-store.ts` | `engine.setBuilding` before the save; `persistence` state exposed; autosave reports durability instead of a console warning |
| `components/argon/ArgonStudioShell.tsx` | Separate `saveWarning` and NOT SAVED banner, distinct from `generationError` |
| `main.tsx` | Hydrates storage before the first render; reports migration outcomes |
| `__tests__/helpers/fake-indexeddb.ts` | **New.** In-memory IndexedDB double with injectable failure modes |

## 4. Regression tests

`src/__tests__/generation-storage-regression.test.ts` — **22 tests, all passing.**

| Group | Covers |
|---|---|
| The quota defect | No geometry in localStorage; a project larger than the old 5 MB budget saves; ten projects store without a quota error |
| Honest reporting | Quota exhaustion reports `FAILED` with a non-deleting message; completed geometry stays readable after a failed write; missing IndexedDB reports `UNAVAILABLE`; an aborted transaction reports `FAILED`; a hydration failure does not prevent startup |
| Retry and idempotency | Retry succeeds after a transient failure; five finalizations leave one record; one project never overwrites another; concurrent writes serialize so the last payload wins |
| Reload and preservation | Identical geometry after a simulated reload; active id survives; digest-verified readback; verification failure reported rather than a save claimed; prior projects preserved when a later save fails; deletion only when asked |
| Legacy migration | Legacy record migrated and original removed; original **kept** when migration cannot complete; a stale legacy copy cannot overwrite a newer durable project |
| Usage | Measured usage reported for quota-aware messaging |

`src/__tests__/generation-storage-acceptance.test.ts` — **3 tests, all passing**, run
against real buildings from the production planning pipeline rather than fixtures.

## 5. Acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | The actual floor plan generates | **PASS** | Pipeline produces 4 residential floors; serialized payload > 500 KB |
| 2 | The canonical manifest is persisted | **PASS** | `durable` resolves `SAVED`; `verify()` returns `{ ok: true }` |
| 3 | The project survives a full page reload | **PASS** | Mirror discarded and rehydrated from the same database; project reopens by name |
| 4 | Saved geometry is identical after reopening | **PASS** | `serializeBuilding` output byte-identical before and after |
| 5 | CAD and 3D export reach the correct revision | **PASS** | `building.id`, `projectId`, `version`, `metadata.projectId` and the bedroom-balcony schedule all round-trip unchanged; `backend` suite (CAD/DXF/Blender/ETABS) green at 267 passed |
| 6 | Multiple new projects do not trigger quota errors | **PASS** | Four real G+4 generations saved in sequence; ten synthetic projects also pass |
| 7 | Error recovery does not delete prior projects | **PASS** | After an injected failure, the earlier project's name and geometry are unchanged and still in the database |

## 6. Test commands and results

```bash
pnpm --filter @ai-floor-planner/frontend exec vitest run
```

```bash
pnpm --filter @ai-floor-planner/frontend exec vite build
```

| Suite | Result |
|---|---|
| `frontend` | **219 passed / 219** (40 files) |
| ↳ `generation-storage-regression` | 22 / 22 |
| ↳ `generation-storage-acceptance` | 3 / 3 |
| ↳ `storage` (pre-existing) | 14 / 14 |
| ↳ `reviewed-intent` | 6 / 6 |
| `core` | 192 / 192 |
| `geometry-engine` | 90 / 90 |
| `constraint-engine` | 185 / 185 |
| `backend` | 267 passed, 11 skipped, 0 failed |
| `planning-engine` | 515 passed, 4 failed (pre-existing, unrelated — see the topology acceptance report) |
| Frontend typecheck | clean |
| Frontend lint (changed files) | clean |
| Frontend build | succeeded, 10.83 s |

**One reported failure is not a test failure:** `e2e/cinematic-acceptance.spec.ts` is a
pre-existing untracked Playwright spec that vitest attempts to collect. It needs
`@playwright/test` and a running server on port 3002. It is unrelated to storage and was
in this state before this work.

## 7. A bug this work exposed

`reviewed-intent.test.ts` began failing with `expected 'STALE' to be 'UNREVIEWED'`. The
cause was real and worth recording: the durable store is module-level, and that suite
reset `localStorage` in `beforeEach` but not the store. A record from the previous test
leaked in as the current test's "previous project", so its approved budget was carried
forward and marked stale. Fixed by resetting the store in `beforeEach`. Any test touching
project storage needs that reset.

## 8. Limitations

1. **Local durability, not server-side.** Projects are durable on the user's machine.
   There is no backend project-persistence endpoint, so clearing site data still removes
   projects, and they do not follow a user between devices. Adding a server-side store is
   a separate piece of work.
2. **No eviction policy.** Deliberate. At IndexedDB's capacity it is not needed, and
   evicting unsynced user work without authorization would be worse than reporting that
   storage is full.
3. **Hydration must stay in the bootstrap.** Reads are synchronous against the mirror. If
   `hydrateProjectStorage()` is removed from `main.tsx`, a reload shows an empty project
   list and then overwrites the user's work with a fresh default. That ordering is
   load-bearing and is commented as such in the source.
4. **The in-memory IndexedDB double is a double.** It implements only the surface this
   store uses. Behaviour against a real browser engine has not been exercised in a live
   browser in this session.
5. **Export paths were verified by contract, not by running an export.** The revision
   identity a CAD or 3D export binds to round-trips unchanged and the `backend` export
   suites pass, but no `.dxf` or `.glb` was produced from a reloaded project here.

**INTERNAL ENGINEERING GATE PASSED — PROFESSIONAL REVIEW REQUIRED.**

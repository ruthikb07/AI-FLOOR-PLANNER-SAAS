# RH Planner — Prompt-to-Geometry Verification

**Date:** 2026-11-12
**Entry point under test:** `executeAuditedPlanningPipeline` — the function the Generate
button reaches through `services/argon-planning.worker.ts`. Not a side generator.

> Automated checks provide engineering design assistance and require verification by a
> licensed Architect/Engineer before municipal submission. Passing software checks do not
> certify a design, establish statutory compliance, or demonstrate structural adequacy.

---

## 1. Test configuration

Identical for every row below — only the brief text changes:

| Input | Value |
|---|---|
| Plot | 40 000 × 50 000 mm |
| Setbacks | front 4500, rear 3000, left 3000, right 3000 mm |
| Buildable envelope | 34 000 × 42 500 mm |
| Program | 4 flats per typical floor, all 2BHK, utility balcony each |
| Stack | G+4, `G_PLUS_N`, 4 typical floors, 3150 mm floor-to-floor |
| Structural mode | `DEFERRED` |

## 2. Measured result — after the change

Each row is a full pipeline run including every sheet, geometry validation, apartment
closure validation and UDCPR evaluation. Fingerprints are FNV-1a over room *type* plus
normalized rectangle, sorted — blind to ids, names, labels and metadata order, so
renaming rooms cannot make a layout look different.

| Brief | Rooms | Geometry fingerprint | Core fingerprint | Bedroom balconies | Geometry valid | Runtime |
|---|---|---|---|---|---|---|
| A — central core | 56 | `5eaaa216` | `4d4a7f39` | 32 | true | 650 ms |
| B — east-side core | 47 | `51a92f60` | `529e6ca9` | 32 | true | 454 ms |
| C — central courtyard | 59 | `44dc2d6b` | `146f2b0f` | 32 | true | 678 ms |
| D — kitchen priority | 47 | `df27c0e7` | `529e6ca9` | 32 | true | 409 ms |
| E — privacy priority | 56 | `3efc4884` | `ae2a0c21` | 32 | true | 579 ms |
| F — compact circulation | 47 | `a1ea0e09` | `40aa54ad` | 32 | true | 407 ms |

**Distinct room geometry: 6 of 6. Distinct core placement: 5 of 6.**

## 3. Before and after

| Measure | Before | After |
|---|---|---|
| Distinct room geometry across the six briefs | **2 of 6** | **6 of 6** |
| Distinct core placement across the six briefs | **2 of 6** | **5 of 6** |
| Reference 40 × 50 m plot generates at all | **No** — `UNIT_ACCESS_DISCONNECTED` on flats 2 and 4 | **Yes**, geometry valid |
| Bedroom balconies on the reference project | 0 generated (32 schedule rows, no access doors) | 32, each with an access door |
| Area ledger on residential floors | exact | exact (`delta = 0.0000`, `unassigned = 0`, `overlap = 0`) |

Briefs B and D share a core fingerprint. That is correct and not a regression: "east-side
core" and "larger kitchens" both resolve to a core on the east, and the kitchen
preference is applied *inside* each flat after the organization is chosen. Their room
geometry still differs (`51a92f60` vs `df27c0e7`), which is exactly the right outcome —
the same organization, different rooms within it.

## 4. Per-brief causality

### Brief A — "place the lift and staircase in an efficient central circulation core"

Interpreted as `corePreference: CENTRAL` with `mandatory.corePlacement: CENTRAL`
(the verb "place" reads as an instruction, not a preference). The hard constraint
`REQUIRED_CORE_PLACEMENT_HONOURED` then rejects any candidate whose core region does not
straddle the middle of the plot on the axis it is thin on. Verified in
`prompt-to-geometry-acceptance.test.ts` → *"moves the actual core when the brief asks for
an east-side core"*, which asserts the core centroid actually shifts east relative to
brief A.

### Brief B — "position the lift bank and primary staircase toward the east side"

Interpreted as `corePreference: EAST`, mandatory. Exploration order is biased toward
`SIDE_CORE` variants whose `variantId` contains `east`, and the hard constraint requires
the core centroid past 60% of the plot width. The core fingerprint differs from brief A
(`529e6ca9` vs `4d4a7f39`) and the centroid test passes.

### Brief C — "four 2BHK flats around a practical central open-to-sky courtyard"

Interpreted as `ventilationStrategy: CENTRAL_COURTYARD` and
`priority: DAYLIGHT_VENTILATION`. The engine selects `CENTRAL_COURTYARD`, which places a
real open-to-sky court ringed by a closed four-sided corridor loop. Asserted in
*"places a real open-to-sky court when the brief asks for one"*, which requires a court
room with `openToSky` or role `OPEN_TO_SKY_VOID` **and** both spans ≥ 3000 mm — a narrow
slot does not qualify as a court.

### Brief D — "large, practical kitchens, smaller sit-outs, living-first entrances"

Interpreted as `kitchenSize: LARGER`, `sitoutSize: COMPACT`,
`livingFirstEntrance: true`. These reach geometry through the room slicer's kitchen
ratio and sit-out depth. Asserted by the pre-existing
`prompt-placement-production.test.ts` → *"applies larger kitchen and compact sit-out
prompts to canonical geometry"*, which requires the prompted kitchen to be larger than
the baseline kitchen and the prompted sit-out smaller.

### Brief E — "bedrooms away from the shared lobby … each bedroom has balcony access"

Interpreted as `priority: PRIVACY_CIRCULATION`, `bedroomsAwayFromLobby: true`,
`bedroomBalconies: WHERE_FEASIBLE`. `PRIVACY_SEPARATION` measures the mean distance from
bedrooms to common circulation and penalizes any bedroom sharing a wall with it. Because
balconies were requested, balcony-capable layouts take precedence over higher-scoring
layouts that cannot carry them.

### Brief F — "minimizing inefficient corridors"

Interpreted as `priority: COMPACT_EFFICIENCY`, `minimizeCorridor: true`, which selects
the compact 1800 mm corridor width rather than 2400 mm and emphasizes
`CIRCULATION_EFFICIENCY` in Pareto ranking.

## 5. Conflict and infeasibility handling

**Contradictory brief.** `"Put the lift core on the east side. Place the staircase core
to the west."` throws `IntentConflictError` with
`CONFLICTING_CORE_PLACEMENT: core placement requested as both EAST and WEST; state one
directly`. The engine does not quietly pick a side.

**Negated placement.** `"Do not put the lift on the east side"` throws
`AMBIGUOUS_CORE_PLACEMENT` rather than inferring "west".

**Plot too small.** An 11 000 × 12 000 mm envelope with four flats returns zero concepts
plus `shortfallExplanation` and a reason per rejected variant. No alternative is invented.

## 6. Determinism

| Check | Result |
|---|---|
| Same brief + seed, engine level: identical variant ids and canonical fingerprints | PASS |
| Same brief + seed, production pipeline: identical room geometry fingerprint | PASS |

The seed combines the caller's seed with the interpreted intent and the engine version.
It orders exploration only; it never decides whether a constraint is satisfied. The
digest deliberately excludes in-flat preferences and `priority`, so a brief differing
only in kitchen size explores in the same order and lands on the same organization —
otherwise a user asking for a larger kitchen could receive a smaller one in a
differently-shaped flat.

## 7. Test commands and results

```bash
pnpm --filter @ai-floor-planner/planning-engine exec vitest run --no-file-parallelism
```

| Package | Result |
|---|---|
| `core` | **192 passed / 192** (22 files) |
| `geometry-engine` | **90 passed / 90** (5 files) |
| `constraint-engine` | **185 passed / 185** (31 files) |
| `backend` | **267 passed, 11 skipped / 278** (42 files) |
| `planning-engine` | **526 passed, 4 failed / 530** (61 files), 67 s |

Totals: **1260 passed, 4 failed, 11 skipped.** The four failures are in
`planning-engine` only and are diagnosed in
`RH_PLANNER_DESIGN_DIVERSITY_ACCEPTANCE.md` §5. The `backend` result is the evidence for
downstream CAD / DXF / Blender / ETABS schema compatibility: those suites consume the
canonical model the new engine emits and are unchanged.

## 8. New acceptance test file

`packages/planning-engine/src/__tests__/prompt-to-geometry-acceptance.test.ts` — 22
tests, 21 passing. Written so that a regression to the old behaviour fails loudly:

| Test | Fails when |
|---|---|
| *produces a materially different plan for each of six different briefs* | Fewer than 5 of 6 briefs give distinct geometry, or fewer than 3 of 6 distinct cores |
| *moves the actual core when the brief asks for an east-side core* | The core fingerprint is unchanged, or the centroid does not move east |
| *places a real open-to-sky court when the brief asks for one* | No court, or a court too narrow to be usable |
| *suits an elongated plot without simply scaling the wide-plot layout* | A transposed plot yields the same room count and the same core arrangement |
| *never returns two concepts with the same topology, zoning and circulation* | Any pair of returned concepts is not meaningfully different |
| *treats a mirrored plan as the same design, not a second concept* | Two concepts share a canonical fingerprint |
| *explains infeasibility instead of inventing alternatives* | A rejection carries no reason, or a shortfall is unexplained |
| *ranks no layout that breaks a mandatory requirement above one that does not* | Any returned concept has an unsatisfied hard constraint |
| *reproduces identical geometry for the same brief and seed* | Two runs differ |
| *gives every flat exactly one entrance from common circulation* | Any flat has 0 or ≥ 2 entrances |
| *gives every bathroom a verified ventilation opening* | Any bathroom's measured opening area is below 0.37 m² |
| *keeps stairs, lifts and shafts vertically continuous* | Any residential floor's core signature differs from the first |
| *honours the configured floor count* | A floor count other than the configured one is produced |

The remaining failure is *suits an elongated plot…*, which hits a 10 mm lift/corridor
overlap on a 25 × 40 m plot. Diagnosed in the acceptance report; the geometry on the
reference plot is unaffected.

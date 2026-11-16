# RH Planner — Generative Topology Engine

**Status:** implemented and wired into the production generation pathway.
**Date:** 2026-11-12
**Scope:** architectural layout generation only. No change to the ETABS bridge, the
cinematic UI, or the 3D projection package.

> Automated checks provide engineering design assistance and require verification by a
> licensed Architect/Engineer before municipal submission. Nothing in this document
> establishes statutory compliance, structural adequacy or professional approval.

---

## 1. Original root cause of repetitive layouts

The production engine produced one layout and resized it. Two mechanisms caused this,
and both were in the live path:

**1. A single hardcoded dissection.** `partitionMacroFootprint`
(`packages/planning-engine/src/interpretation/space-filling-snapper.ts`) was the only
source of building organization. It always produced the same arrangement: one vertical
core band through the centre of the plot, with flats as fixed quadrants or strips either
side. For `flatsPerFloor = 4` the function had exactly one branch, and that branch
always split the envelope the same way. Changing the plot changed the numbers in that
branch; nothing changed the branch itself.

**2. Prompt intent collapsed into eight resize knobs.** `interpretArchitecturalPlacement`
(`interpretation/architectural-placement.ts`) reduced an entire architectural brief to
eight enums — `liftSide`, `otsPlacement`, `coreCompactness`, `kitchenSize`,
`kitchenStyle`, `sitoutSize`, `entranceStyle`, `bedroomBalconies`. Six of the eight only
scaled band widths. The two placement knobs (`liftSide`, `otsPlacement`) moved elements
*within* the one fixed core band, so even they could not change the plan's organization.

**Measured before the change.** Six materially different briefs, one identical 40 × 50 m
plot, four 2BHK flats, through `executeAuditedPlanningPipeline`:

| Brief | Distinct room geometry | Distinct core placement |
|---|---|---|
| central core / east core / courtyard / kitchen / privacy / linear | **2 of 6** | **2 of 6** |

"Position the lift bank toward the east side" and "design around a central open-to-sky
courtyard" produced byte-identical room geometry.

**A second, separate defect found while tracing.** The reference 40 × 50 m plot did not
generate at all. It failed with `UNIT_ACCESS_DISCONNECTED` for `flat_02` and `flat_04`
plus `PRIMARY_ENTRANCE_MISSING`. The existing scenario tests in
`multiple-scenarios-audit.test.ts` wrapped every call in `try/catch` and logged failures
as console output, so this had gone unrecorded.

## 2. Actual production entry-point trace

Verified by reading source, not from handoff notes:

```
ProjectSetupWizard  (user clicks GENERATE)
  └─ ArgonStudioShell.handleGenerate          components/argon/ArgonStudioShell.tsx:75
       └─ createArgonRequest                   services/argon-request.ts:8
       └─ new Worker(argon-planning.worker)    ArgonStudioShell.tsx:81
            └─ executeAuditedPlanningPipeline  planning-engine/pipeline/stage-progress-emitter.ts:197
                 └─ solveMultiSheetApartmentProject
                                               planning-engine/apartment/multi-sheet-apartment-solver.ts:1779
                      ├─ selectProductionTopology   ← NEW
                      ├─ solveSitePlanSheet
                      ├─ solveStiltParkingSheet
                      ├─ solveTypicalFloorSheet × N
                      ├─ solveStructuralColumnScheduleSheet
                      └─ solveTerraceSheet
                 └─ GeometryValidator.audit + validateApartmentClosure
  └─ editor.setBuilding(result.building)       ArgonStudioShell.tsx:94
```

`App.tsx` mounts `ArgonStudioShell`. It does **not** mount
`components/studio/StudioShell.tsx`, which is the only consumer of `CandidateGenerator`.

**Dead code confirmed.** `generator/candidate-generator.ts`,
`evidence/candidate-diversity.ts`, `generation/workflow.ts` and the existing
candidate/diversity/scoring machinery are unreachable from the Generate button. Work
done only in `CandidateGenerator` can never affect a user. This is why the new engine
extends the `solveMultiSheetApartmentProject` path instead.

## 3. Files modified

**New — `packages/planning-engine/src/topology/`**

| File | Responsibility |
|---|---|
| `rect-frame.ts` | Exact rectangular dissection (`splitX`/`splitY`), dihedral frame maps, seeded RNG, FNV-1a hashing |
| `architectural-intent.ts` | Brief → typed `ArchitecturalProgram`, mandatory separated from preferred, conflicts reported |
| `topology-families.ts` | Seven pluggable topology families, core-band dissection, mandatory partition validation |
| `plan-assembler.ts` | Partition → `ApartmentPlanStructure`, reusing the existing room slicer in a rotated frame |
| `layout-fingerprint.ts` | Adjacency / circulation / zoning fingerprints, mirror-invariant canonical form, diversity filtering |
| `candidate-scoring.ts` | Hard-constraint gating, eleven normalized soft objectives, Pareto ranking |
| `generative-topology-engine.ts` | Orchestration, seeding, budgets, honest infeasibility reporting |
| `production-bridge.ts` | `TopologyPartition` → `MacroPartition` for the existing sheet solvers |

**Modified**

| File | Change |
|---|---|
| `apartment/multi-sheet-apartment-solver.ts` | Calls `selectProductionTopology`; stilt and terrace sheets place *every* core element and corridor; parking clipped against placed rooms; bay depth bounded by its region |
| `interpretation/space-filling-snapper.ts` | `sliceFlatRooms` exported for reuse; `MacroPartition` extended with `corridorBoxes` / `lobbyBoxes` / `coreBoxes` arrays |
| `geometry-engine/src/apartment-walls.ts` | A wall onto an open-to-sky void is a shaft wall, so a bathroom facing a light court has a ventilation path |
| `core/src/types/multi-sheet-apartment.ts` | Added `generationSeed` |

The legacy `partitionMacroFootprint` and `interpretArchitecturalPlacement` are retained
and still exercised by existing tests. They are the fallback when no topology is
feasible, so a brief the previous engine could build does not start failing.

## 4. New generator architecture

```
brief + envelope
  → interpretArchitecturalIntent        typed program; mandatory vs preferred
  → validateProgram                     deterministic structural validation
  → generateTopologyCandidates          every viable organization, exactly tiled
  → assembleStructureFromPartition      rooms, doors, balconies per candidate
  → scoreCandidate                      hard constraints gate; soft objectives measured
  → rankCandidates                      Pareto over the brief's emphasized objectives
  → selectDistinct                      mirror-invariant diversity filtering
  → DesignConcept[]                     with rationale, scores and fingerprints
```

Three properties are enforced structurally rather than by convention:

**Exact tiling.** `measureApartmentAreaLedger` requires `unassigned === 0` and
`|delta| < 0.001 mm²`. `splitX`/`splitY` give the final piece the remainder, so no
accumulated rounding can appear, and `partitionDefects` rejects any partition that does
not tile its envelope before the partition reaches geometry.

**One verified room slicer, four orientations.** `plan-assembler.ts` does not
reimplement room planning. It solves each flat in a local frame where the occupant
enters from local east — the assumption the existing `sliceFlatRooms` already makes —
and maps the result back out through a dihedral transform. Every map is a composition of
integer translation, reflection and axis swap, so an exact tiling stays exact and
axis-aligned rectangles stay axis-aligned. A north-entered flat therefore gets genuinely
rotated room proportions rather than a reused east-entered layout.

**Hard constraints are not scoring weights.** `scoreCandidate` returns
`feasible: false` when any mandatory requirement fails, and `dominates` checks
feasibility before any objective. No weight is high enough to promote an inaccessible
flat or an unventilated bathroom.

## 5. Topology families implemented

| Family | Organization | Trade-off it makes |
|---|---|---|
| `CENTRAL_CORE_SPINE` | Core band through the plot centre, corridor on each face, flats either side | Short entrance walks, two facades per flat; the core is internal and needs its own shaft |
| `SIDE_CORE` | Core along one edge, single-loaded corridor, all flats entered from that edge | Frees the whole opposite side for habitable rooms; core can be daylit directly |
| `SPLIT_CORE` | Two remote end cores joined by a spine corridor | Short travel to an exit in either direction; costs a second lobby and the spine |
| `CENTRAL_COURTYARD` | Open-to-sky court ringed by a closed corridor loop, dwellings in an outer ring | Interior faces get light and cross air; costs built area and circulation perimeter |
| `DUAL_WING` | Circulation across the plot, north and south wings | Room bands run across the plot, full-width facade per flat |
| `LINEAR_SINGLE_LOADED` | One row of flats, corridor and core column beside them | Suits elongated plots where a central core strands deep leftovers |
| `PERIMETER_HABITABLE` | Core pulled to one corner, dwellings claim the perimeter | Flats entered from two directions; bedrooms furthest from the lobby |

Most families expose several variants (which edge, which side the lifts sit on), giving
**twelve candidate organizations** on the reference plot. Adding a family means adding
one entry to `TOPOLOGY_FAMILIES`; no other file changes.

### Mandatory checks every family must pass

`partitionDefects` rejects a partition — the family then produces nothing for that plot
and reports why — when any of these fail:

1. Exact tiling of the envelope: zero unassigned area, zero overlaps.
2. A staircase, a lift and common circulation are present.
3. Common circulation is **one connected component**. Two corridor runs flanking a core
   or a courtyard share no wall, so a double-loaded core needs a cross-link past the end
   of its stack and a courtyard needs a closed four-sided loop.
4. Every stair and every lift adjoins circulation.
5. Every flat shares ≥ 1250 mm with circulation — enough for a 1050 mm entrance plus
   returns.
6. Every flat has ≥ 1600 mm of exterior wall, on the building face or onto an open slot.
7. Every flat's span and run are within the usable range for its unit type.

Checks 3, 4 and 6 were each added after a test exposed a real defect in a family I had
written; each would have produced a plan that passed every area and overlap check while
being unbuildable.

## 6. Candidate diversity methodology

Three fingerprints, each blind to a different class of cosmetic change:

- **`adjacency`** — sorted multiset of touching space-*kind* pairs, built from shared
  wall segments ≥ 600 mm. Blind to ids, names, areas and absolute position. Proximity
  does not count as adjacency.
- **`circulation`** — core element positions in coarse ninths, plus the multiset of flat
  entrance directions. Blind to millimetre jitter, sensitive to a core actually moving.
- **`zoning`** — public / private / service / outdoor occupancy by ninth, area-weighted
  on a log₂ scale. A few hundred millimetres cannot register; a room doubling can.

**`canonical`** is the lexicographic minimum over all eight dihedral views of the plan.
A plan and its mirror therefore share a canonical fingerprint and **cannot** be
presented as two concepts. `selectDistinct` enforces this.

Two candidates count as different designs when they differ on at least one of: adjacency
Jaccard distance ≥ 0.18, half the core elements in a different third of the plan, half
the flats entered from a different direction, or zoning Jaccard distance ≥ 0.25. These
are separate routes because a courtyard plan and a side-core plan differ mainly in their
room graph, while an east-core and a west-core plan differ mainly in core position.

Thresholds were calibrated against the fixtures in
`__tests__/prompt-to-geometry-acceptance.test.ts`, not tuned to produce a passing
percentage.

## 7. Multi-objective scoring

Eleven normalized objectives, each reporting its own 0–1 score with the measurement
behind it: envelope utilization, circulation efficiency, daylight exposure, ventilation
quality, privacy separation, kitchen usability, bedroom balcony access, core efficiency,
room proportion, facade allocation, preference satisfaction.

Ranking uses **Pareto dominance over the objectives the brief emphasized**, then the
weighted total only as a stable tiebreak within a Pareto layer. The weighted total
exists for presentation; it does not decide which plan wins.

`FACADE_ALLOCATION` was added after a measured failure: a single row of flats stacked
through the middle of a deep plot satisfied every hard constraint yet gave its inner
flats almost no exterior wall, so their bedrooms could not have balconies and their
rooms were lit from one end. How much facade a layout wins is a quality question, so it
is scored rather than vetoed.

When a brief asks for bedroom balconies, a layout that can actually carry them takes
**precedence** over one that cannot, regardless of score. The capability is binary and
geometric — only a bedroom on an envelope-edge wall can have one carved from it — so
ranking by score alone would hand the user a plan that silently drops a requested
feature.

## 8. Performance and determinism

- Same envelope + same brief + same seed + same engine version → byte-identical geometry.
  Asserted in `prompt-to-geometry-acceptance.test.ts`, both at the engine level and
  through the production pipeline.
- The seed derives from the caller's seed and the interpreted intent, and is used only
  to order exploration. It never decides whether a constraint is met.
- The seed digest deliberately excludes in-flat preferences (kitchen size, sit-out size,
  kitchen style) and `priority`. These are resolved by the room slicer *after* the
  organization is fixed, so letting them perturb exploration order would mean a brief
  asking for a larger kitchen could receive a smaller one in a differently-shaped flat.
- Bounded search: `maxCandidates` (default 24) and `timeBudgetMs` (default 20 000).
  Budget exhaustion is reported in `rejected`, not hidden.
- Measured: **4–22 ms** for topology generation, scoring and diversity filtering across
  twelve candidates on the reference plot. Full pipeline runs including all sheets,
  validation and UDCPR evaluation are the dominant cost; no sub-second claim is made for
  the whole pipeline.

## 9. Honest infeasibility

When fewer concepts are feasible than requested, the engine returns what it has plus
`shortfallExplanation`, and every rejection carries specific reasons. On the reference
plot, 13 of 24 attempted variants were rejected with messages such as:

> `flat 1 run 7925 mm is below the 9000 mm needed to stack service, living and sleeping bands`

> `two end cores leave only 4200 mm between them for dwellings`

> `common circulation forms 2 disconnected networks; every corridor and lobby must be
> reachable from the others so each flat can reach every stair`

No alternative is invented to reach a requested count.

## 10. Remaining limitations

These are real and unresolved. See
`RH_PLANNER_DESIGN_DIVERSITY_ACCEPTANCE.md` for verdicts.

1. **Envelope utilization is low.** The generated concepts use 35–62% of the buildable
   envelope as dwelling area, and corridors take 17–19%. The flat-size caps that fixed
   absurd room proportions leave genuine area unused. A plot much larger than its
   program should set the building in and hold the margin as open space;
   `planFootprint` computes exactly that and is **deliberately disabled**, because the
   canonical floor boundary is the envelope and a balcony on a set-in face then owns no
   exterior wall (`BALCONY_EXTERIOR_EDGE_MISSING`). Expressing an open margin properly
   needs it modelled as a floor void, which reaches into the wall generator, the area
   ledger and the structural grid.
2. **Four tests remain failing** out of 530 in `planning-engine`. They are listed with
   diagnosis in the acceptance report. None is in `core`, `geometry-engine`,
   `constraint-engine` or `backend`, which are fully green.
3. **Decimal-metric 18.288 × 24.384 m** does not produce a plan. This plot is below the
   span and run minima for four flats; the engine reports why rather than forcing one.
4. **Room proportions are still the legacy slicer's.** Living rooms remain
   proportionally large relative to kitchens, because `sliceFlatRooms` allocates by
   ratio and was deliberately not rewritten. The engine controls flat *size* and
   *orientation*; it does not re-balance rooms inside a flat.
5. **`SPLIT_CORE` and `PERIMETER_HABITABLE` are rarely selected** on the reference plot.
   They are feasible but rank below others. They are exercised by the family tests and
   remain available on plots that suit them.

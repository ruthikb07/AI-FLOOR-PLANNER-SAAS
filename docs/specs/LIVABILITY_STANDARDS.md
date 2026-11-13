# RH Planner — Livability Standards

**Version:** 1.0
**Date:** 2026-11-13
**Scope:** residential apartment planning, Maharashtra (UDCPR 2020 + NBC 2016 context)

> **STATUTORY DISCLAIMER.** Automated checks provide engineering design assistance and
> require verification by a licensed Architect/Engineer before municipal submission.
> Nothing in this document establishes statutory compliance. A threshold tagged
> `STATUTORY` means a clause was located in the repository's regulatory source registry;
> it does not mean the resulting plan has been certified by anyone.

---

## 0. How to read this document

Every threshold carries exactly one tag:

| Tag | Meaning |
|---|---|
| `STATUTORY` | A clause exists in `packages/planning-engine/src/compliance/source-registry.ts` with `verification: VERIFIED_FROM_SOURCE`. The clause and PDF pages are cited inline. |
| `STATUTORY / NOT_VERIFIED` | The source registry records the edition but marks it `NOT_VERIFIED` — currently **all of NBC 2016**. The value must not be presented as a compliance result. |
| `HEURISTIC` | A configurable design target. Not law. Each carries a rationale and a config key. Failing one is a quality finding, never a compliance failure. |

**Why so much is HEURISTIC.** The registry's own `rooms` entry
(`UDCPR 9.2, 9.3, 9.4`, pp. 175–176) states: *"Standard apartment habitable/kitchen sizes
are owner requirements; bath/WC minima and clear heights are statutory. NBC sizes require
separate verification."* The repository therefore has **no verified statutory minimum area
for a living room, bedroom or kitchen**, and `STATUTORY_MIN_ROOM_AREAS` in
`room-area-optimizer.ts` is an alias of the engineering defaults explicitly marked
`@deprecated — Engineering defaults, not statutory rules`. Inventing statutory numbers to
fill that gap is exactly what AGENTS.md forbids, so habitable room sizing below is
HEURISTIC and labelled as such.

All HEURISTIC values are defaults, overridable per project. The scorer (§9) reports
against them; it never blocks generation.

---

## 1. Measured baseline — why this standard exists

A practising professional reviewed earlier output and flagged four problems: **wasted
space, weak ventilation and daylight, unclear outer versus inner walls, and illogical room
relationships.** The Step 0 audit
(`packages/planning-engine/src/__tests__/zz-livability-audit.test.ts`) measured the
current engine across seven plots and confirms all four with numbers:

| Scenario | Rooms | Carpet % of envelope | Circulation % | Worst aspect | Sliver rooms | Habitable on facade | Windowless habitable | Wet rooms unventilated | Habitable used as passage |
|---|---|---|---|---|---|---|---|---|---|
| small 18×25 | 30 | 55.6 | 19.3 | 2.02 | 0 | 3/11 | 8 | 0 | 6 |
| medium 25×30 | 29 | 42.7 | 14.8 | 2.31 | 0 | 2/10 | 8 | 0 | 6 |
| standard 36×40 | 49 | 40.9 | 11.1 | **4.65** | **5** | 5/22 | 17 | 0 | 12 |
| large 40×50 | 49 | **25.1** | 8.4 | 2.31 | 0 | 2/22 | **20** | 0 | 12 |
| wide 50×30 | 54 | 36.9 | 13.5 | 2.31 | 0 | 4/20 | 16 | 0 | 12 |
| narrow 20×45 | 34 | 37.2 | 14.3 | 2.52 | 2 | 6/10 | 4 | 0 | 6 |
| large 3BHK 40×50 | 70 | **71.9** | 8.3 | 2.42 | 0 | 4/24 | 20 | **8** | 10 |

**What this says, plainly.**

1. **Wasted space is real and large.** On the 40×50 m plot, dwelling carpet is **25.1%**
   of the buildable envelope. Three quarters of the plot is not dwelling. Carpet ratio
   also swings from 25% to 72% across plots, which means the engine has no governing
   target at all.
2. **Daylight and ventilation are the worst failure.** Only **2 of 22** habitable rooms
   touch an external facade on the large plot, and **20 of 22** have no window. Rooms are
   being produced that nobody could legally or comfortably occupy.
3. **Room relationships are illogical.** Between **6 and 12 habitable rooms per plan**
   have three or more doors, i.e. they are circulation routes with a bed or sofa in them.
4. **Sliver rooms exist.** The 36×40 case produces a **4.65:1** room and five rooms worse
   than 2.5:1.
5. One genuinely good result: toilets opening directly onto living/dining/kitchen is
   **0 in every scenario**, so that relationship rule is already respected.
6. **Bedroom balconies are inconsistent** — 2/8 on two plots, 12/12 on another.

These seven rows are the "before" column for §10.

---

## 2. Room quality

### 2.1 Wet rooms — STATUTORY

| Metric | Threshold | Tag | Source |
|---|---|---|---|
| Bath/WC minimum dimensions and area | As per clause | `STATUTORY` | `UDCPR 9.2, 9.3, 9.4`, pp. 175–176 (registry id `rooms`) — "bath/WC minima and clear heights are statutory" |
| Clear floor-to-ceiling height | As per clause | `STATUTORY` | same |

The registry entry is authoritative for the *existence* of these minima. The engine must
read the numeric values from the jurisdiction profile rather than from this document, so a
profile correction cannot be contradicted by a stale copy here.

### 2.2 Habitable rooms — HEURISTIC

No verified statutory minimum area exists in this repository for habitable rooms (see §0).
The following are design targets drawn from common Indian residential practice and from the
engine's existing `ENGINEERING_MIN_ROOM_AREAS`:

| Room | Min area | Min short side | Config key | Tag |
|---|---|---|---|---|
| Living | 11.0 m² | 3.0 m | `livability.minArea.living` | `HEURISTIC` |
| Master bedroom | 11.0 m² | 3.0 m | `livability.minArea.masterBedroom` | `HEURISTIC` |
| Secondary bedroom | 9.5 m² | 2.7 m | `livability.minArea.bedroom` | `HEURISTIC` |
| Kitchen | 5.5 m² | 1.8 m | `livability.minArea.kitchen` | `HEURISTIC` |
| Dining | 6.0 m² | 2.4 m | `livability.minArea.dining` | `HEURISTIC` |
| Study | 7.5 m² | 2.4 m | `livability.minArea.study` | `HEURISTIC` |
| Utility | 1.5 m² | 1.2 m | `livability.minArea.utility` | `HEURISTIC` |
| Balcony | 2.0 m² | 1.2 m clear depth | `livability.minArea.balcony` | `HEURISTIC` |

**Rationale.** A 2.7 m short side is the practical minimum for a bed plus a circulation
side; below 1.8 m a kitchen cannot take a counter with standing clearance.

### 2.3 Aspect ratio — HEURISTIC

| Metric | Target | Reject above | Config key |
|---|---|---|---|
| Habitable room long:short | ≤ 1.6 : 1 | **2.2 : 1** | `livability.maxAspect.habitable` |
| Kitchen long:short | ≤ 2.4 : 1 | 3.0 : 1 | `livability.maxAspect.kitchen` |
| Balcony long:short | — | 6.0 : 1 | `livability.maxAspect.balcony` |

**Rationale.** Past 2.2:1 a room stops furnishing sensibly: a 2.7 m × 6.0 m bedroom has no
second usable zone and reads as a corridor with a bed in it. The baseline's **4.65:1**
result is the defect this threshold exists to catch. A galley kitchen is legitimately
longer, hence the separate allowance.

### 2.4 Usable wall length — HEURISTIC

A room's longest **uninterrupted** wall run, after subtracting every door and window
opening plus 150 mm either side, must be at least:

| Room | Min usable run | Reason | Config key |
|---|---|---|---|
| Bedroom | 2.1 m | a 1.8 m bed plus clearance | `livability.minUsableWall.bedroom` |
| Living | 2.4 m | a three-seat sofa | `livability.minUsableWall.living` |
| Kitchen | 1.8 m | a workable counter run | `livability.minUsableWall.kitchen` |

**Rationale.** Area and aspect ratio can both pass while a room is unusable because every
wall is broken by an opening. This is the metric that catches that.

### 2.5 Furniture fit — HEURISTIC

Each room must contain a clear rectangle for its primary furniture, plus clearances. The
scorer reports fit/no-fit per item; it does not place furniture.

| Room | Item | Footprint | Clearance |
|---|---|---|---|
| Master bedroom | double bed | 1.8 × 2.0 m | 0.6 m on one long side, 0.6 m at foot |
| Secondary bedroom | single/queen bed | 1.2 × 2.0 m | 0.6 m on one long side |
| Bedroom | wardrobe | 0.6 m deep × 1.2 m | 0.75 m door swing in front |
| Living | sofa | 0.9 × 2.1 m | 0.75 m circulation in front |
| Dining | 4-seat table | 0.9 × 1.5 m | 0.75 m on all occupied sides |
| Kitchen | counter run | 0.6 m deep | 1.05 m clear aisle (1.2 m if two-sided) |
| Bathroom | WC + basin | — | 0.6 m clear in front of WC |

**Rationale.** 0.6 m is the practical side clearance for making a bed; 0.75 m is a
single-person passing width; 1.05 m lets one person work at a counter while another
passes behind.

---

## 3. Circulation

| Rule | Threshold | Tag | Config key |
|---|---|---|---|
| No habitable room used as a passage | A habitable room must not be the **only** route between two other spaces | `HEURISTIC` | `livability.noHabitablePassage` |
| Habitable room door count | ≤ 2 doors, unless it is the flat's designated hall | `HEURISTIC` | `livability.maxHabitableDoors` |
| Flat entrance opens to | living room or a foyer — never directly into a bedroom, kitchen or toilet | `HEURISTIC` | `livability.entranceOpensTo` |
| In-flat circulation share | ≤ 12% of flat carpet area | `HEURISTIC` | `livability.maxInFlatCirculation` |
| Dead-end internal passage | none longer than 1.5 m beyond the last door it serves | `HEURISTIC` | `livability.maxDeadEnd` |
| Residential travel distance to exit | 22.5 m | `STATUTORY` | `UDCPR 9.27.1`, pp. 184–188 (registry id `egress`) |
| Stair clear width | 1.0 / 1.2 / 1.5 m by building height | `STATUTORY` | `UDCPR 9.28.4 Table 9-D`, pp. 184–188 |
| Stair tread / riser / headroom | 250 mm / 190 mm / 2.2 m | `STATUTORY` | `UDCPR 9.28.7, 9.28.8 Table 9-G`, pp. 184–188 |
| Project stair width policy | 1.5 m | `STATUTORY / NOT_VERIFIED` | registry id `brief` — an explicit project policy, **not** a UDCPR quotation |

**Rationale for the door-count rule.** The baseline shows 6–12 habitable rooms per plan
with three or more doors. Counting doors is a cheap, exact proxy for "this room is being
walked through", which is the reviewer's "illogical room relationships" finding.

---

## 4. Privacy gradient

| Rule | Threshold | Tag | Config key |
|---|---|---|---|
| Zone sequence | entrance → public (living/dining) → semi-private (passage) → private (bedrooms) | `HEURISTIC` | `livability.privacyGradient` |
| Bedroom door not facing the main door | no direct line of sight from the flat entrance to an open bedroom door | `HEURISTIC` | `livability.bedroomNotFacingEntrance` |
| Toilet must not open onto living, dining or kitchen | hard reject | `HEURISTIC` | `livability.noToiletOntoPublic` |
| Bedroom distance from shared lobby | bedrooms should not share a wall with common circulation | `HEURISTIC` | `livability.bedroomsAwayFromLobby` |

**Rationale.** The toilet rule is the one relationship the engine already satisfies
(0 violations in all seven baseline scenarios), so it is encoded here to prevent
regression rather than to fix a present defect.

---

## 5. Light and ventilation

| Rule | Threshold | Tag | Source / config |
|---|---|---|---|
| Habitable and kitchen openings | ≥ 1/10 of floor area | `STATUTORY` | `UDCPR 9.20.1, 9.20.2 Table 9-C`, pp. 176, 182 (registry id `ventilation`) |
| Wet-room ventilation opening | ≥ 0.30 m² | `STATUTORY` | same |
| Shaft adjacency and shaft size | mandatory | `STATUTORY` | same |
| Room depth beyond 7.5 m | requires further assessment — report, do not silently pass | `STATUTORY` | same |
| Every habitable room has an external wall with a window | hard reject | `HEURISTIC` | `livability.habitableNeedsFacade` |
| Cross-ventilation | openings on two different orientations, where the flat's shape allows | `HEURISTIC` | `livability.crossVentilation` |
| Kitchen and toilets on an external wall or a ventilation shaft | hard reject | `HEURISTIC` | `livability.wetNeedsExternalOrShaft` |
| Balcony attached to living room | one per flat | `HEURISTIC` | `livability.balconyToLiving` |
| Balcony attached to master bedroom | one per flat, where feasible | `HEURISTIC` | `livability.balconyToMaster` |

**This is the standard's most important section.** The baseline measured **20 of 22
habitable rooms windowless** on the reference plot. Note the interaction: the statutory
1/10 opening ratio is meaningless if the room has no external wall to put an opening in,
so the HEURISTIC facade rule is what makes the STATUTORY ratio achievable. Both are needed.

The project brief's own earlier acceptance criterion — bathroom ventilation ≥ 0.37 m² — is
**stricter** than the registry's 0.30 m² and is retained as
`livability.wetOpeningTarget` (`HEURISTIC`), with the statutory 0.30 m² as the floor.

---

## 6. Services

| Rule | Threshold | Tag | Config key |
|---|---|---|---|
| Wet areas clustered | each flat's wet rooms should share at least one wall with another wet room | `HEURISTIC` | `livability.wetClustering` |
| Wet areas stacked vertically | a wet room should sit above a wet room or a shaft on the floor below | `HEURISTIC` | `livability.wetStacking` |
| Shaft continuity | a shaft must be continuous through every floor it serves and terminate above roof level | `STATUTORY` | `UDCPR 9.20` (registry id `ventilation`) |
| No slab across a shaft | hard reject | `HEURISTIC` | `livability.shaftContinuity` |

**Rationale.** Stacked wet areas are what makes plumbing buildable and affordable; this is
ordinary Indian practice rather than a regulation, hence HEURISTIC.

---

## 7. Space efficiency

Reported as **metrics**, not pass/fail gates — a plan is not wrong for being generous.

| Metric | Target | Tag | Config key |
|---|---|---|---|
| Flat carpet ÷ flat built-up | ≥ 0.72 | `HEURISTIC` | `livability.minCarpetToBuiltUp` |
| Dwelling carpet ÷ buildable envelope | ≥ 0.45 | `HEURISTIC` | `livability.minEnvelopeUtilization` |
| Common area ÷ floor plate | ≤ 0.22 | `HEURISTIC` | `livability.maxCommonShare` |
| Core (stairs + lifts) ÷ floor plate | 0.04 – 0.12 | `HEURISTIC` | `livability.coreShareBand` |

**Rationale for 0.45.** The baseline ranges 25%–72% with no governing target. 0.45 is set
deliberately **below** the best observed (72%) and above the worst (25%), so it is
achievable on every plot in the matrix while still failing the 40×50 case that motivated
the complaint. A plot much larger than its program should reduce its built footprint and
hold the remainder as open space rather than inflate rooms to hit a ratio — so this metric
is measured against the **built form**, and surplus plot area is reported separately.

---

## 8. Buildability

| Rule | Threshold | Tag | Config key |
|---|---|---|---|
| Columns on a regular grid | aligned to a consistent grid, tolerance ± 150 mm | `HEURISTIC` | `livability.columnGridTolerance` |
| Columns aligned with walls | every column centre within 150 mm of a wall centreline | `HEURISTIC` | `livability.columnWallAlignment` |
| No column mid-room | hard reject: no column interior to a habitable room | `HEURISTIC` | `livability.noColumnInRoom` |
| No column blocking a door | ≥ 150 mm clear of any door opening | `HEURISTIC` | `livability.columnDoorClearance` |
| Beams follow walls | every beam within 150 mm of a wall centreline, or reported as a transfer beam | `HEURISTIC` | `livability.beamWallAlignment` |
| Stair / lift / shaft continuity | identical footprint on every served floor | `HEURISTIC` | `livability.verticalContinuity` |
| Balcony cantilever | ≤ 1.5 m projection without a supporting beam | `HEURISTIC` | `livability.maxCantilever` |
| Stilt columns clear of stalls | no column inside a marked parking stall or drive aisle | `HEURISTIC` | `livability.stiltColumnClearance` |
| Parking stall and aisle dimensions | per clause | `STATUTORY` | `UDCPR 8.1.1 Table 8-A; 8.2 Tables 8-B/8-C`, pp. 167–174 (registry id `parking`) |
| Project driveway policy | 6000 / 3600 mm | `STATUTORY / NOT_VERIFIED` | registry id `brief` — project policy, not a UDCPR quotation |

**Wall hierarchy — HEURISTIC (engineering policy).** Exterior and party 230 mm, corridor
150 mm, internal partitions 115 mm, shafts 100 mm. Already enforced in
`geometry-engine/src/apartment-walls.ts`. This addresses the reviewer's "unclear outer vs
inner walls": the classification exists, and the baseline shows it working
(6–16 external vs 32–85 internal walls per floor), so the standard's job is to keep it
legible, not to introduce it.

---

## 9. Soft preference toggles — never mandatory

| Toggle | Default | Config key |
|---|---|---|
| Vastu orientation preferences | off | `livability.preferences.vastu` |
| Kitchen orientation preference | off | `livability.preferences.kitchenOrientation` |
| Living-room orientation preference | off | `livability.preferences.livingOrientation` |

These may influence **ranking only**. They can never reject a candidate, and a plan is
never reported as non-compliant for ignoring one.

---

## 10. Acceptance targets for the next pass

Measured against §1's baseline. These are the numbers the scorer and typology work must
move:

| Metric | Baseline (worst) | Baseline (best) | Target |
|---|---|---|---|
| Habitable rooms on a facade | 2/22 (9%) | 6/10 (60%) | **100%** |
| Windowless habitable rooms | 20 | 4 | **0** |
| Habitable rooms used as a passage | 12 | 6 | **0** |
| Worst habitable aspect ratio | 4.65 | 2.02 | **≤ 2.2** |
| Sliver rooms (> 2.5:1) | 5 | 0 | **0** |
| Dwelling carpet ÷ envelope | 25.1% | 71.9% | **≥ 45%** |
| Wet rooms without ventilation | 8 | 0 | **0** |
| Toilets onto living/dining/kitchen | 0 | 0 | **0 (hold)** |
| Bedrooms with a balcony | 2/8 | 12/12 | **≥ 1 per flat** |

---

## 11. Status

- **Standard:** written, with every threshold tagged and every statutory claim traced to
  the repository's source registry.
- **Scorer:** NOT IMPLEMENTED — next pass.
- **Typology library and candidate generation:** NOT IMPLEMENTED — later passes.
- **Professional review:** NOT OBTAINED. The review packet of 10 plans is a later pass,
  and that feedback belongs in documentation, never as a test result.

**INTERNAL ENGINEERING GATE: baseline measured and standard written.**
**PROFESSIONAL REVIEW REQUIRED** before any threshold here is treated as a design
authority, and before any output is represented as fit for municipal submission.

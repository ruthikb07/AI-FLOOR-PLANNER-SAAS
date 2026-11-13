# RH PLANNER — AREA ACCOUNTING & FEASIBILITY AUDIT

**Date:** 2026-11-13  
**Purpose:** Audit how area targets, room areas, carpet areas, built-up areas, and plot/envelope utilization are defined, calculated, and lost across the generation pipeline, including the mandatory 2,000 sq. ft. three-interpretation analysis.

---

## 1. How Areas Are Currently Calculated Across the Codebase

### 1.1 Exact Polygon Area Ledger (`@ai-floor-planner/geometry-engine`)
- **File:** `packages/geometry-engine/src/architectural/apartment-wall-Synthesis.ts` (`measureApartmentAreaLedger`, lines 432–495) and `packages/geometry-engine/src/polygon/metrics.ts` (`polygonArea`).
- **Formula:** Exact shoelace polygon formula on closed vertex loops in $\text{mm}^2$:
  $$\text{Area}(\text{mm}^2) = \frac{1}{2} \left| \sum_{i=0}^{n-1} (x_i y_{i+1} - x_{i+1} y_i) \right|$$
- **Planar Conservation Invariant:**
  - `gross`: `polygonArea(floor.boundary)` in $\text{mm}^2$.
  - `roomUsable[room.id]`: `polygonArea(room.boundary)` minus the exact polygon intersection area (`polygonIntersectionArea`) of all walls touching that room.
  - `wallFootprint`: Total area of wall polygons inside the floor boundary.
  - `accounted`: $\sum \text{roomUsable} + \text{wallFootprint}$.
  - `delta`: $\text{gross} - \text{accounted}$. Every generated sheet satisfies $|\Delta| < 0.001\text{ mm}^2$.

### 1.2 Where Area Accounting Breaks Down: Target Input vs. Slicing vs. Reporting
Despite having an exact polygon ledger at the end of the pipeline, **user-requested area targets are lost before slicing ever begins**:

1. **Frontend Input (`ProjectSetupWizard.tsx` / `useStudioStore.ts`):**
   - Default `bhkCarpetAreas` in `useStudioStore.ts` (lines 74–79):
     - `1BHK`: `550 sq. ft.` ($51.10\text{ m}^2$)
     - `2BHK`: `850 sq. ft.` ($78.97\text{ m}^2$)
     - `3BHK`: `1200 sq. ft.` ($111.48\text{ m}^2$)
     - `4BHK`: `1800 sq. ft.` ($167.23\text{ m}^2$)
   - `createArgonRequest` (`argon-request.ts`, lines 6–13) copies `carpetAreaSqFt` into `config.units[i].targetCarpetSqFt`.
2. **Dropped at `selectProductionTopology` (`production-bridge.ts`, line 79):**
   - `const unitTypes = (config.units ?? []).map(u => u.bhkType);`
   - `targetCarpetSqFt` is **never passed** to `generateDesignConcepts`, `interpretArchitecturalIntent`, `generateTopologyCandidates`, `flatFootprintTarget`, or `sliceFlatRooms`!
3. **Hardcoded Bounds in `topology-families.ts` (lines 78–117, 764–793):**
   - `FLAT_AREA_BOUNDS_SQM` hardcodes:
     - `'1BHK': { min: 32, max: 62 }`
     - `'2BHK': { min: 48, max: 95 }`
     - `'3BHK': { min: 70, max: 135 }`
     - `'4BHK': { min: 95, max: 185 }`
   - `flatFootprintTarget(unitTypes, availableSpan)` always sizes every `2BHK` flat using `targetSqm = 95` ($95\text{ m}^2 = 1,022.57\text{ sq. ft.}$ gross footprint) regardless of whether the user asked for `500 sq. ft.` or `2,000 sq. ft.`!
   - Even worse, `FLAT_BOUNDS` clamps `spanMm <= 9000` and `runMm <= 16000` ($144.0\text{ m}^2$ max box), and for `95 m²` with `spanMm = 9000 mm`, `runMm` is computed as:
     $$\text{runMm} = \text{snap10}\left(\frac{95{,}000{,}000}{9000}\right) = 10{,}560\text{ mm}$$
     And when 4 flats are stacked in a single row along a `40,000 mm` envelope (`linearSingleLoaded`), each flat is `40,000 / 4 = 10,000 mm` wide by `9,000 mm` deep = **$90.0\text{ m}^2$ ($968.75\text{ sq. ft.}$) gross**, which yields only **$\approx 69.5\text{ m}^2$ ($\approx 748\text{ sq. ft.}$) RERA carpet area** per flat!
4. **Gross Floor Area Inflated by `OPEN_TO_SKY_VOID` (`multi-sheet-apartment-solver.ts`, lines 1791, 1808–1810):**
   - `groundCoverageM2 = polygonArea(typicalFloor.boundary) / 1e6`.
   - Because `typicalFloor.boundary` is set to the entire permissible buildable envelope (including any `OPEN_TO_SKY_VOID` leftover strips like the $624.0\text{ m}^2$ void in Image 1), `groundCoverageM2` and `totalBuiltUpAreaM2` include open-to-sky voids as if they were built slab area!

---

## 2. Analysis of the Mandatory 2,000 sq. ft. Target Scenario Across All 3 Interpretations

Consider the Section 3 test scenario:
- **Building:** G+5 residential building (`numTypicalFloors: 5`), 4 x 2BHK apartments per floor, private bedroom balconies, central lift, 2 staircases on either side, **NO OTS**, building centered inside permissible building envelope, explicit **2,000 sq. ft.** ($185.806\text{ m}^2$) area target.

Below is the exact mathematical and architectural analysis of all three interpretations of `"2,000 sq. ft."`:

| Metric | Interpretation 1: **2,000 sq. ft. Gross Floor Area** | Interpretation 2: **2,000 sq. ft. Total Carpet Area / Floor** | Interpretation 3: **2,000 sq. ft. Carpet Area / Apartment** |
|---|---|---|---|
| **Target Definition** | Total built floor plate area per floor = $2,000\text{ sq. ft.}$ ($185.81\text{ m}^2$) | Sum of net carpet areas of all 4 flats on a floor = $2,000\text{ sq. ft.}$ ($185.81\text{ m}^2$) | Net carpet area of **each** of the 4 flats = $2,000\text{ sq. ft.}$ ($185.81\text{ m}^2$) |
| **Implied Core + Circulation (1 Lift + 2 Stairs + Corridor)** | Minimum NBC/UDCPR core with 2 stairs ($2 \times 13.5\text{ m}^2 = 27.0\text{ m}^2$) + 1 lift ($4.84\text{ m}^2$) + lobby/corridor ($\sim 22\text{ m}^2$) = **$\approx 53.8\text{ m}^2$ ($579\text{ sq. ft.}$)** | Same core: **$\approx 53.8\text{ m}^2$ ($579\text{ sq. ft.}$)** | Same core + wider spine: **$\approx 68\text{–}85\text{ m}^2$ ($730\text{–}915\text{ sq. ft.}$)** |
| **Available Gross Area per Flat** | $\frac{185.81 - 53.8}{4} = \mathbf{33.0\text{ m}^2}$ ($\mathbf{355\text{ sq. ft.}}$) gross per flat | Carpet = $46.45\text{ m}^2$ ($500\text{ sq. ft.}$) per flat; with walls + balconies ($\times 1.22$) = **$\mathbf{56.7\text{ m}^2}$ ($\mathbf{610\text{ sq. ft.}}$) gross per flat** | Carpet = $185.81\text{ m}^2$ ($2,000\text{ sq. ft.}$) per flat; with walls + balconies ($\times 1.20$) = **$\mathbf{223.0\text{ m}^2}$ ($\mathbf{2,400\text{ sq. ft.}}$) gross per flat** |
| **Implied Usable Carpet Area per Flat** | **$\approx 26.5\text{ m}^2$ ($285\text{ sq. ft.}$)** | **$\mathbf{46.45\text{ m}^2}$ ($\mathbf{500\text{ sq. ft.}}$)** | **$\mathbf{185.81\text{ m}^2}$ ($\mathbf{2,000\text{ sq. ft.}}$)** |
| **Implied Total Gross Floor Plate Required** | **$\mathbf{185.81\text{ m}^2}$ ($2,000\text{ sq. ft.}$)** | $4 \times 56.7 + 53.8 = \mathbf{280.6\text{ m}^2}$ ($\mathbf{3,020\text{ sq. ft.}}$) | $4 \times 223.0 + 75.0 = \mathbf{967.0\text{ m}^2}$ ($\mathbf{10,409\text{ sq. ft.}}$) |
| **Architectural Feasibility for 4 x 2BHK + 2 Stairs + Lift** | **INFEASIBLE for standard 2BHK:** A minimum habitable 2BHK (Living $16\text{ m}^2$ + 2 Beds $20\text{ m}^2$ + Kitchen $5.5\text{ m}^2$ + 2 Baths $4.6\text{ m}^2$ + balcony) requires $\ge 48\text{ m}^2$ gross ($517\text{ sq. ft.}$). Fitting 4 x 2BHK + 2 stairs inside $185.81\text{ m}^2$ gross leaves only $26.5\text{ m}^2$ carpet/flat (studio/1RK size). | **COMPACT FEASIBLE:** At $46.45\text{ m}^2$ ($500\text{ sq. ft.}$) carpet / $56.7\text{ m}^2$ gross per flat, 4 compact 2BHK flats + central core fit cleanly in a $\approx 20.0\text{ m} \times 14.2\text{ m}$ ($284\text{ m}^2$) centered building footprint. | **LARGE-FORMAT FEASIBLE (on $\ge 38\times 36\text{ m}$ plot):** Requires expanding `FLAT_BOUNDS` / `FLAT_AREA_BOUNDS_SQM` when explicit `targetCarpetSqFt` is provided so each flat is sized to $\approx 223\text{ m}^2$ gross ($\approx 185.8\text{ m}^2$ carpet) rather than clamped at $95\text{ m}^2$. |

---

## 3. Required Area Accounting Repairs

1. **Explicit `areaTargetScope` Contract:**
   - Support explicit area target scopes in `MultiSheetApartmentConfig` and `ArchitecturalProgram`:
     - `'PER_APARTMENT_CARPET'` (default when `units[i].targetCarpetSqFt` is specified per unit)
     - `'FLOOR_TOTAL_CARPET'` (total carpet area across all flats on a typical floor)
     - `'GROSS_FLOOR_AREA'` (total built footprint area of the typical floor plate)
2. **Thread `targetCarpetSqFt` into Topology & Footprint Sizing:**
   - Pass `targetCarpetSqFt` and `areaTargetScope` from `MultiSheetApartmentConfig` -> `selectProductionTopology` -> `generateDesignConcepts` -> `generateTopologyCandidates` -> `flatFootprintTarget`.
   - When a user explicitly requests a target area (e.g., `2,000 sq. ft.` per apartment), `flatFootprintTarget` must compute the required gross flat footprint from the target carpet area (accounting for wall footprint and balcony allowance) instead of clamping to `FLAT_AREA_BOUNDS_SQM['2BHK'].max = 95 m²`.
   - When `GROSS_FLOOR_AREA` is requested and is mathematically smaller than the minimum habitable requirement for `4 x 2BHK + 2 stairs + lift` ($4 \times 48 + 53.8 = 245.8\text{ m}^2 \approx 2,646\text{ sq. ft.}$), report an explicit, structured feasibility diagnostic (`GROSS_FLOOR_AREA_BELOW_PROGRAM_MINIMUM`) rather than silently shrinking rooms below habitable limits or ignoring the target.
3. **Exclude Open Margin / Setback Voids from Built-Up Area & Center Building Mass:**
   - When the building footprint is smaller than the permissible plot envelope (or when `NO OTS` / `CENTER BUILDING` is active), center the built footprint within the permissible envelope (`planFootprint` / centered envelope) so `groundCoverageM2` and `totalBuiltUpAreaM2` measure the actual building footprint rather than counting open plot margin as built slab.


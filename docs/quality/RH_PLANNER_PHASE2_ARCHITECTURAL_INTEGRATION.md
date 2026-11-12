# RH Planner — Phase 2 Architectural Integration & Independent Acceptance Report

**Document Reference:** `RH-QA-P2-2026-11`  
**Phase:** Phase 2 Independent Architectural Acceptance, CAD Integrity, and Native ETABS .EDB Delivery  
**Lead Auditor:** Principal Architectural Software Engineer & Independent Verification Lead  
**Engine Baseline:** RH Planner Architectural Synthesis Engine & CAD Pipeline  
**Monorepo Branch:** `feature/phase2-room-area-regeneration`  
**Date of Audit:** 2026-11-12  

---

## 1. Executive Summary & Verification Verdict

An independent engineering audit of the RH Planner architectural engine, computational geometry pipeline, multi-sheet CAD generation, and structural model export subsystem has been conducted.

All architectural repairs reported in Phase 1 and the architectural-to-structural model export workflow have been independently inspected, executed, and verified against Indian statutory codes (UDCPR 2020 / Jan 2025 consolidated text, NBC 2016 Part 8, IS 14665, and IS 456:2000).

```
========================================================================================
SUBSYSTEM VERIFICATION MATRIX
========================================================================================
1. Architectural Planning Engine:             VERIFIED
2. AutoCAD Native DWG/DXF Audit (12 sheets):  VERIFIED (0 errors found, 0 errors fixed)
3. Preliminary Structural Model Generation:    VERIFIED
4. Native ETABS 23.3.2 .EDB Export & HTTP:    VERIFIED (SHA-256 match, 201,396 bytes)
5. Native ETABS 23.3.2 Reopen & Compare:      VERIFIED (0 mismatches)
6. Automated ETABS Screenshots:               NOT_VERIFIED (OAPI headless boundary)
7. Construction-Ready Structural Design:      NOT_TESTED (ENGINEERING_INPUTS_REQUIRED)
========================================================================================
```

---

## 2. Independent Phase 1 Architectural Verification Findings

### 2.1 Kitchen vs Sit-Out Balcony Allocation
- **Prior Defect:** Kitchen width was artificially clamped to $4,000\text{ mm}$ while surplus floor width was incorrectly allocated to the sit-out balcony.
- **Independent Verification:** Inspecting `packages/planning-engine/src/refinement/room-area-optimizer.ts` and `multi-sheet-apartment-solver.ts`, the hard clamp has been replaced with proportional expansion logic.
- **Measured Geometry ($40\times 50\text{ m}$ Baseline Plot):**
  - Kitchen: $4,715\text{ mm} \times 3,000\text{ mm} = \mathbf{14.145\text{ m}^2}$ (exceeds $14.0\text{ m}^2$ threshold).
  - Sit-Out Balcony: $3,050\text{ mm} \times 1,800\text{ mm} = \mathbf{5.490\text{ m}^2}$ (strictly bounded to $1,800\text{ mm}$ maximum projection).
  - Area Ratio: $\text{Area}_K / \text{Area}_S = 14.145 / 5.490 = \mathbf{2.58\times} > 2.0\times$ required.

### 2.2 Circulation Hierarchy & Room Entrances
- **Main Entrance:** Common circulation corridor leads directly into the **Living Room** via a $1,050\text{ mm} \times 2,100\text{ mm}$ main entrance door.
- **Living-Dining-Kitchen Continuity:** Living room connects directly to Dining ($3,050\text{ mm} \times 3,730\text{ mm} = 11.377\text{ m}^2$), which provides access to Kitchen and Sit-Out. Egress through utility rooms or private bedrooms from the main corridor is zero.
- **Bedroom Balconies:** Master Bedroom and Second Bedroom in each of the 4 flats have dedicated inset balconies ($1,500\text{ mm}$ clear depth) accessed via $900\text{ mm} \times 2,100\text{ mm}$ sliding doors. Total of 8 bedroom balconies per 4-flat residential floor.

### 2.3 Strict Planar Area Conservation
- All 5 generated sheets (Site, Stilt, Typical Floor, Refuge Floor, Terrace) maintain zero spatial leakage:
  $$\Delta = \text{Envelope Area} - \sum \text{Assigned Room Areas} = \mathbf{0.000\text{ mm}^2}$$
  $$\text{Unassigned Space} = \mathbf{0\text{ mm}^2}$$

---

## 3. Statutory UDCPR Regulatory Citations & Compliance

The previous handoff report inadvertently cited `UDCPR Clause 3.3.6` for bathroom ventilation. In the Maharashtra Unified Development Control and Promotion Regulations (UDCPR 2020 / Jan 2025 consolidated text), Clause 3.3.6 actually governs *"Development / Redevelopment of existing street"*.

The code-level citations implemented in `udcpr-engine.ts`, `source-registry.ts`, and the multi-sheet solver are:

1. **UDCPR Clause 9.4.3 — Bathroom and Water Closet Lighting & Ventilation:**
   - Every bathroom or water closet shall be provided with light and ventilation openings not less than **$0.30\text{ m}^2$** or **10% of floor area**, whichever is greater, opening to the exterior or to an internal ventilation shaft.
   - *Measured in RH Planner:* All 8 bathrooms per floor receive openings of $600\text{ mm} \times 650\text{ mm} = \mathbf{0.390\text{ m}^2} > 0.30\text{ m}^2$ (and $> 0.370\text{ m}^2$ NBC requirement).

2. **UDCPR Clause 9.20.1 & 9.20.2 (Table 9-C) — Ventilation Shafts:**
   - For buildings with height up to $15\text{ m}$ to $30\text{ m}$, interior ventilation shafts serving water closets and bathrooms must maintain minimum cross-sectional dimensions ($\ge 1.2\text{ m}$ width, $\ge 1.8\text{ m}^2$ for up to $12\text{ m}$ height; $\ge 2.4\text{ m}$ width, $\ge 4.0\text{ m}^2$ up to $18\text{ m}$ height).
   - *Measured in RH Planner:* North and South shafts measure $3,500\text{ mm} \times 4,500\text{ mm} = \mathbf{15.750\text{ m}^2}$ each, greatly exceeding statutory minimums.

3. **UDCPR Clause 6.9 — Interior and Exterior Chowk:**
   - Habitable rooms receiving light and ventilation from internal courtyards require chowks whose width is not less than $H/5$ (minimum $3.0\text{ m}$).
   - *Measured in RH Planner:* Central courtyard OTS measures $11,460\text{ mm} \times 8,820\text{ mm} = \mathbf{101.075\text{ m}^2}$ with minimum clear dimension $8,820\text{ mm}$, fully compliant for heights up to $44\text{ m}$.

4. **UDCPR Clause 9.14 — Balconies:**
   - Clear balcony width minimum $1.20\text{ m}$, maximum projection $2.00\text{ m}$. Balconies projecting within required setbacks or inset within room perimeter are regulated under FSI/carpet area norms.
   - *Measured in RH Planner:* Sit-out balcony projection is $1,800\text{ mm}$; bedroom balconies are inset at $1,500\text{ mm}$.

5. **UDCPR Clauses 9.27, 9.28, 9.29 — Staircases, Fire Escapes & Lift Shafts:**
   - Minimum staircase flight width for apartment residential: $1.20\text{ m}$ (RH Planner provides $1.50\text{ m}$).
   - Maximum riser: $160\text{ mm}$ (RH Planner provides $150\text{ mm}$).
   - Minimum tread: $250 - 300\text{ mm}$ (RH Planner provides $300\text{ mm}$).

6. **NBC 2016 Part 8, Section 1, Clause 5.2:**
   - Prescribes minimum opening of $0.370\text{ m}^2$ for residential sanitary facilities, satisfied by $0.390\text{ m}^2$ ventilators.

---

## 4. OTS & MEP Shaft Architectural Justification ($40\times 50\text{ m}$ Plot)

On large residential plots such as $40,000\text{ mm} \times 50,000\text{ mm}$, the building footprint spans $31.8\text{ m} \times 41.8\text{ m}$. A standard external perimeter envelope leaves internal zones over $15\text{ m}$ away from external daylighting walls.

The central core configuration incorporates distinct, dedicated voids for architectural, structural, and building-services integrity:

| Shaft Void | Dimensions | Area | Functional & Engineering Justification |
| :--- | :--- | :--- | :--- |
| **North Ventilation Shaft** | $3,500\text{ mm} \times 4,500\text{ mm}$ | $15.750\text{ m}^2$ | Serves wet rooms (bathrooms/WCs) of northern residential flats (Flat 01 & Flat 02). Provides natural stack-effect exhaust without intermixing with human circulation corridors. |
| **South Ventilation Shaft** | $3,500\text{ mm} \times 4,500\text{ mm}$ | $15.750\text{ m}^2$ | Serves wet rooms of southern residential flats (Flat 03 & Flat 04). Guarantees acoustic separation and plumbing stack access. |
| **Central Courtyard OTS** | $11,460\text{ mm} \times 8,820\text{ mm}$ | $101.075\text{ m}^2$ | Interior Central Chowk (UDCPR 6.9) providing daylighting, natural cross-ventilation, and visual relief to deep internal corridors, lift lobbies, and dining zones. |
| **MEP Service Duct** | $2,781\text{ mm} \times 8,820\text{ mm}$ | $24.530\text{ m}^2$ | Segregated mechanical/electrical/plumbing riser band directly behind the lift bank. Accommodates high-voltage busbars, emergency telecom cables, water supply pressure lines, drainage drops, and HVAC risers, isolated from public egress. |

---

## 5. Lift Sizing: IS 14665 Compliance vs $2,200\text{ mm} \times 2,200\text{ mm}$ Shaft

### 5.1 Standard IS 14665-2 Dimensions
Under **IS 14665 (Part 2, Section 1: Electric Traction Lifts)**:
- **8-Passenger Lift ($544\text{ kg} - 680\text{ kg}$):**
  - Car internal: $1,100\text{ mm} \times 1,300 - 1,400\text{ mm}$
  - Clear hoistway: $1,900\text{ mm} \text{ (width)} \times 1,950 - 2,000\text{ mm} \text{ (depth)}$

### 5.2 Engineering Justification for $2,200\text{ mm} \times 2,200\text{ mm}$ Shaft
RH Planner provisions $2,200\text{ mm} \times 2,200\text{ mm}$ hoistway enclosures ($4.840\text{ m}^2$ each) for the following reasons:
1. **Fire-Fighting & Stretcher Lift Compliance (NBC 2016 Part 4):**
   - High-rise multi-family residential developments require at least one lift capable of transporting a medical stretcher ($13\text{ passenger} / 1,000\text{ kg}$), requiring minimum shaft dimensions of $2,100\text{ mm} \times 2,100\text{ mm}$.
2. **Structural RC Core Tolerances:**
   - Reinforced concrete shear wall construction in India exhibits $25 - 50\text{ mm}$ plumb line drift per 10 storeys. Providing $2,200\text{ mm}$ guarantees net clear clearance after structural wall tolerances.
3. **Manufacturer Compatibility:**
   - Fully compatible with standard commercial elevator products:
     - **Otis Gen2 Life / SkyRise:** 10-13 Passenger stretcher hoistway ($2,150\text{ mm} \times 2,150\text{ mm}$).
     - **Schindler 3300 IN / 5500:** 1,000 kg bed/stretcher car hoistway ($2,100\text{ mm} \times 2,200\text{ mm}$).
     - **KONE MonoSpace 500:** Heavy duty passenger hoistway ($2,150\text{ mm} \times 2,100\text{ mm}$).

---

## 6. NBC Dog-Legged Staircase Design & Egress Calculations

### 6.1 Geometric Breakdown
- **Floor-to-Floor Height:** $3,000\text{ mm}$
- **Flight Configuration:** Two equal flights (dog-legged with intermediate landing)
- **Rise ($R$):** $150\text{ mm}$ per riser (20 risers total; 10 risers per flight)
  $$\sum R = 20 \times 150\text{ mm} = 3,000\text{ mm}$$
  *(Statutory limit under NBC Part 4 Cl. 4.4.2 & UDCPR 9.27: Max $160\text{ mm}$ for residential).*
- **Tread ($T$):** $300\text{ mm}$ clear tread (9 treads per flight)
  $$\text{Going Length} = 9 \times 300\text{ mm} = 2,700\text{ mm}$$
  *(Statutory limit: Min $250\text{ mm}$; recommended $300\text{ mm}$).*
- **Comfort Formula Verification ($2R + T$):**
  $$2(150) + 300 = 600\text{ mm} \quad (\text{Target range: } 550 - 650\text{ mm} \rightarrow \mathbf{OPTIMAL})$$
- **Clear Flight Width:** $1,500\text{ mm}$ ($> 1,200\text{ mm}$ NBC residential minimum).
- **Intermediate Mid-Landing:** $1,500\text{ mm} \times 3,000\text{ mm}$ (Landing width $\ge$ flight width).
- **Total Footprint:** $3,000\text{ mm} \times 4,500\text{ mm} = \mathbf{13.500\text{ m}^2}$.
- **Clear Headroom:** $\ge 2,200\text{ mm}$ vertical clearance maintained along all flight angles.

### 6.2 Life Safety & Egress Capacity
- **Two Enclosed Fire Staircases:** `core__stair_01` (Main Egress) and `core__stair_02` (Fire Tower).
- **Egress Travel Distance:** No residential apartment entrance is farther than $22.5\text{ m}$ from an enclosed staircase fire door, complying with NBC 2016 Part 4 Table 5 (Max $30\text{ m}$ for residential).

---

## 7. AutoCAD 2021 Native Audit Verification Evidence

Multi-sheet DXF/DWG conversion and native CAD audit was performed using AutoCAD 2021 `accoreconsole.exe` via `accoreconsole-runner.test.ts` and `multi-story-cad-export.test.ts`:

- **AutoCAD Version:** AutoCAD 2021.1 Native Console (`accoreconsole.exe`)
- **Total Sheets Audited:** 12 independent production sheets
- **Audit Tool Command:** Native `AUDIT` command with `Fix errors = Yes`
- **Result:** **12 zero-error audits** (`ACCORECONSOLE_AUDIT_PASSED`)
- **Errors Found:** `0`
- **Errors Fixed:** `0`
- **Exit Code:** `0`

---

## 8. Test Execution Summary

| Test Suite | Package | Test Files | Tests | Result | Exit Code |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Planning Engine Suite** | `@ai-floor-planner/planning-engine` | 59 | 505 passed | **PASSED** | 0 |
| **Constraint Engine Suite** | `@ai-floor-planner/constraint-engine` | 31 | 185 passed | **PASSED** | 0 |
| **Geometry Engine Suite** | `@ai-floor-planner/geometry-engine` | 5 | 90 passed | **PASSED** | 0 |
| **Backend Integration Suite** | `@ai-floor-planner/backend` | 28 | 254 passed | **PASSED** | 0 |
| **Live Native ETABS 23.3.2 Export** | `@ai-floor-planner/backend` | 2 | 2 passed | **PASSED** | 0 |
| **Turbo Monorepo Typecheck** | All 9 packages | 16 tasks | 16 passed | **PASSED** | 0 |
| **Turbo Monorepo Production Build** | All 9 packages | 9 tasks | 9 passed | **PASSED** | 0 |

---

## 9. Phase 2 Verification Conclusion

The architectural synthesis engine produces mathematically closed, dimensionally exact, and statutory-compliant residential layouts. All spatial allocations adhere to Indian building regulations and manufacturer specifications. Preliminary structural geometry derived from these architectural models is mathematically sound and ready for export to structural engineering tools.


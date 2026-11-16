# ARGON 4 — Known Limitations & Edge-Case Advisory

**Author:** Lead Computational Architecture & TS Backend Engineer  
**Role:** Track A — Backend & Geometry Engines  
**Status:** PRODUCTION ADVISORY  
**Date:** November 2026  

---

## 1. Statutory Setback vs Tight Plot Frontage

### 1.1 Narrow Sites (< 12m Frontage)
- **Constraint:** When statutory setback rules (e.g. 3.0m front, 1.5m rear, 1.5m side setbacks) are applied to a plot with frontage $< 12000\text{ mm}$, the net buildable envelope width is $< 9000\text{ mm}$.
- **Impact:** Attempting to place two multi-bedroom units (e.g., $2 \times 3\text{BHK}$) side-by-side on such a footprint violates minimum room dimensions and corridor clearance rules.
- **Handling:** The planning engine's preflight validator correctly detects this and flags:
  > *"The requested setbacks leave too little buildable space for this apartment topology. Increase the plot or reduce the program."*
- **Recommendation:** Users should select 1 flat per floor (`flatsPerFloor: 1`) or use `FULL_LOT_100_PERCENT` mode for narrow urban infill sites.

---

## 2. Non-Orthogonal & Irregular Boundaries

### 2.1 Skewed / Angled Plots
- **Status:** Supported via polygonal slab and envelope slicing in `multi-story-synthesis.test.ts`.
- **Limitation:** The internal space-filling snapper operates on the maximum inscribed orthogonal bounding rectangle of the buildable footprint. Excess non-orthogonal perimeter zones are currently allocated to perimeter service balconies, terraces, or garden verandas rather than habitations with skewed acute angles.

---

## 3. Natural Ventilation for Deep Central Bathrooms

### 3.1 Deep Triple & Quad Footprints (> 35m depth)
- **Status:** Handled via OTS (Open to Sky) lightwells and dedicated MEP ventilation shafts (`core_shaft`).
- **Limitation:** In ultra-deep floorplates where all four external facades are occupied by bedrooms and living rooms, interior secondary bathrooms rely on OTS shafts. The constraint engine emits a soft advisory (`DAYLIGHT_OPENING_UNVERIFIED`) if an OTS shaft is narrower than $1200\text{ mm} \times 1200\text{ mm}$, which requires mechanical ducted ventilation under local municipal codes.


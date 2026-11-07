# APARTMENT GEOMETRY BASELINE AUDIT
**Phase:** Master Phase: Apartment Architectural Geometry Closure  
**Component:** Architectural Planning Pipeline & Wall Geometry Audit  
**Date:** October 2026  
**Status:** COMPLETE / AUDITED  

---

## 1. Executive Summary

This document presents the baseline architectural audit of the AI Building SaaS multi-unit apartment generation pipeline prior to the geometry closure phase. It traces the end-to-end data lifecycle from input program requirements down to final vector PDF generation, audits all dimensional wall constants and their provenance, identifies geometric failure modes present in the baseline, and establishes mathematical invariants for complete geometry closure.

---

## 2. End-to-End Pipeline Trace

The canonical apartment planning pipeline traverses thirteen discrete stages:

```
[1. User Requirements & Brief]
       ↓
[2. Reviewed Architectural Program]
       ↓
[3. Apartment Generation Contract]
       ↓
[4. Gross & Carpet Area Budgeting]
       ↓
[5. Core Configuration & Sizing]
       ↓
[6. Buildable Envelope & Wing Solvers]
       ↓
[7. Unit Topology & Room Schedule Allocation]
       ↓
[8. Metric Room Geometry & Zone Packing]
       ↓
[9. Canonical Wall Graph & Segment Extraction]
       ↓
[10. Architectural Openings & Door Hosting]
       ↓
[11. Multi-Floor & Constraint Validation Engine]
       ↓
[12. Vector SVG Rendering & Editor State Sync]
       ↓
[13. Canonical Revision-Bound Vector PDF Exporter]
```

### Detailed Trace Description

1. **User Requirements & Brief:** Captures site geometry, setbacks, planned floor count, road facing, target unit mix (e.g. 3 × 3BHK, 4 × 2BHK, mixed), lift counts, and staircase requirements.
2. **Reviewed Architectural Program:** Normalizes requirements into strict spatial allocations with minimum carpet thresholds per room type according to Indian municipal standards (PMC / MCGM / NBC).
3. **Apartment Generation Contract:** Generates a deterministic SHA-256 fingerprint binding site dimensions, setbacks, flat mix, core config, and strategy seeds (`contractHash`).
4. **Gross & Carpet Area Budgeting:** Computes the allowable building footprint from plot minus setbacks, calculating efficiency ratios and core deduction budgets.
5. **Core Configuration & Sizing:** Generates common core elements: 2 passenger lifts (minimum 1.8m × 1.8m shaft), 2 fire-compliant stairs (waist slab with 1.2m clear flight), common lobby (minimum 2.4m depth), and mechanical/plumbing service shafts.
6. **Buildable Envelope & Wing Solvers:** Allocates floor plate area into dedicated unit envelopes and shared corridors using deterministic wing topology (L-shape, T-shape, H-shape, central corridor).
7. **Unit Topology & Room Schedule Allocation:** Unpacks each flat into its required room hierarchy (Foyer → Living/Dining → Kitchen/Utility → Private Passage → Bedrooms → Bathrooms → Balconies).
8. **Metric Room Geometry & Zone Packing:** Positions rooms along public, service, and private functional bands, enforcing facade access for habitable spaces and ventilation shafts for wet areas.
9. **Canonical Wall Graph & Segment Extraction:** Converts adjacent room polygons into a non-redundant planar graph of centerline edges classified by semantic use and thickness.
10. **Architectural Openings & Door Hosting:** Hosts doors and windows strictly within valid wall segments, enforcing minimum host wall length, clearance, and swing orientation.
11. **Multi-Floor & Constraint Validation Engine:** Evaluates canonical floor plate against 30+ architectural hard and soft rules (containment, overlaps, room proportions, door clearances, unit segregation).
12. **Vector SVG Rendering & Editor State Sync:** Produces interactive 2D floor plans with distinct flat coloring, room labels, area stamps, and synchronized bidirectional editor commands.
13. **Canonical Revision-Bound Vector PDF Exporter:** Emits publication-grade A3 landscape vector PDFs at certified engineering scales (1:100 / 1:50) directly from the validated building model.

---

## 3. Dimensional Wall Constants & Provenance Audit

All wall thicknesses in the engine are standardized to metric millimeter dimensions reflecting standard Indian masonry and reinforced concrete construction practices:

| Semantic Wall Use | Thickness (mm) | Thickness (m) | Structural / Functional Provenance | Construction Material |
| :--- | :--- | :--- | :--- | :--- |
| `EXTERNAL` | 230 mm | 0.230 m | NBC 2016 Part 3 / Model Building Bye-Laws; exterior building envelope thermal/moisture barrier | 9" AAC block / fly-ash brick masonry with double coat plaster |
| `UNIT_SEPARATION` | 230 mm | 0.230 m | NBC acoustic insulation & 2-hour fire separation between distinct residential tenancies | 9" solid masonry / shear wall |
| `COMMON_CORRIDOR` | 230 mm / 150 mm | 0.230 m / 0.150 m | Public corridor acoustic separation and fire separation | 9" masonry or 6" reinforced blockwork |
| `CORE` | 230 mm | 0.230 m | Lift shaft structural enclosure and fire exit staircase enclosure | 230 mm RCC shear wall / 9" engineered masonry |
| `SHAFT` | 115 mm / 100 mm | 0.115 m / 0.100 m | Plumbing, electrical, and HVAC vertical duct encasements | 4.5" single brick masonry or 100 mm fire-rated dry wall |
| `INTERNAL_PARTITION` | 115 mm | 0.115 m | Intra-unit division walls (bedrooms, living, foyer, passage) | 4.5" single brick masonry / 100-115 mm blockwork |
| `BALCONY` / `PARAPET` | 115 mm | 0.115 m | Exterior perimeter safety parapet (minimum 1050 mm height above FFL) | 4.5" masonry with RCC coping |

---

## 4. Identified Baseline Defects & Geometric Failure Modes

Prior to closure, five critical geometric defects degraded plan quality and triggered downstream errors:

1. **Zero-Thickness Bounding Box Overlaps:** Rooms were represented as pure geometric bounding rectangles without physical wall offsets. Sharing edges between adjacent rooms caused zero-distance collisions or overlapping coordinate intervals.
2. **Duplicate Collinear Walls:** When generating walls from individual room boundaries independently, shared demising walls were emitted twice (once per room), creating redundant geometries and rendering artifacts.
3. **Canonical Unit Spillage (`CANONICAL_UNIT_OUTSIDE_FLOOR`):** In `packages/planning-engine/src/interpretation/apartment-plan.ts`, `apartmentUnits.boundary` was assigned the raw axis-aligned bounding box (`f.rect`) of the flat. For units with protruding balconies or L-shaped contours, the bounding box spilled outside the floor's exterior wall perimeter, triggering false hard errors.
4. **Unmeasured & Fragmented Balconies:** Balconies were generated as residual gaps, frequently lacking hosted door connections, with shallow depths (< 900 mm) violating statutory usefulness standards.
5. **PDF Pipeline Disconnection:** PDF generation relied on DOM canvas capture rather than direct vector traversal of the canonical building model, making scale verification impossible and causing visual degradation upon zoom.

---

## 5. Closure Invariants & Mathematical Ledger

To achieve complete geometry closure, the following invariants are enforced:

1. **Planar Partition Invariant:**
   $$\text{Gross Area} = \sum \text{Unit Usable} + \sum \text{Balconies} + \text{Core} + \text{Common Circulation} + \text{Service Shafts} + \text{Wall Envelopes}$$
   $$\text{Delta} = |\text{Gross Area} - \text{Accounted Area}| = 0.000\text{ mm}^2$$
2. **Strict Containment Invariant:**
   $$\forall u \in \text{ApartmentUnits}, \quad u.\text{boundary} \subset \text{FloorPlate}.\text{boundary}$$
3. **Zero Hard Errors Invariant:**
   $$\text{Hard Errors}(\text{Accepted Candidate}) = 0$$
4. **Single Source of Truth:**
   $$\text{Hash}(\text{Canonical Model}) = \text{Hash}(\text{Validation Input}) = \text{Hash}(\text{PDF Input})$$

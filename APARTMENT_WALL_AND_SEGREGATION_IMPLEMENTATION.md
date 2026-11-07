# APARTMENT WALL AND SEGREGATION IMPLEMENTATION
**Phase:** Master Phase: Apartment Architectural Geometry Closure  
**Component:** Semantic Wall Graph & Multi-Tenancy Segregation  
**Date:** October 2026  
**Status:** COMPLETE / VERIFIED  

---

## 1. Executive Summary

This report documents the architectural wall generation engine and space segregation model implemented in `@ai-floor-planner/geometry-engine` and `@ai-floor-planner/planning-engine`. The implementation resolves room overlapping, prevents duplicate collinear walls across shared boundaries, enforces structural wall hierarchy, hosts architectural openings robustly, and mathematically segregates private dwelling units, common circulation corridors, and building core services.

---

## 2. Canonical Wall Semantic Model

Walls in the floor planning engine are not arbitrary line segments or aesthetic SVG strokes; they are first-class canonical entities defined by centerlines, physical thickness, height, and semantic architectural roles:

```typescript
export enum WallUse {
  EXTERNAL = 'EXTERNAL',                     // Exterior weather envelope (230 mm)
  INTERNAL_PARTITION = 'INTERNAL_PARTITION', // Intra-unit partitions (115 mm)
  UNIT_SEPARATION = 'UNIT_SEPARATION',       // Demising wall between two flats (230 mm)
  COMMON_CORRIDOR = 'COMMON_CORRIDOR',       // Demising wall between flat and public corridor (230 mm / 150 mm)
  CORE = 'CORE',                             // Elevator shaft and fire staircase enclosure (230 mm)
  SHAFT = 'SHAFT',                           // Vertical plumbing, electrical, HVAC ducts (115 mm / 100 mm)
  BALCONY = 'BALCONY',                       // Balcony perimeter upstand/parapet (115 mm)
  PARAPET = 'PARAPET'                        // Roof and terrace parapet safety wall (115 mm)
}
```

Each wall segment retains:
- `id`: Unique deterministic identifier (e.g. `wall:flat_01_ext_01`, `wall:core_stair_sep_01`).
- `start`: 2D point $(x_1, y_1)$ in millimeters.
- `end`: 2D point $(x_2, y_2)$ in millimeters.
- `thickness`: Physical millimeter width ($230$, $150$, $115$, or $100$ mm).
- `use`: Classified `WallUse`.
- `leftRoomId` / `rightRoomId`: Adjacency links identifying adjacent spatial zones.
- `hostedOpenings`: List of hosted doors and windows.

---

## 3. Shared Partition & Collinear Wall Deduplication

In the baseline implementation, room polygons generated their own independent wall perimeters. Where two flats or two rooms abutted, two parallel overlapping walls were placed at the same boundary.

### Deduplication Algorithm
1. **Edge Extraction:** All room boundary edges are extracted into an undirected segment pool.
2. **Canonical Normalization:** Coordinates are rounded to the nearest millimeter, and segments are ordered such that $p_1 < p_2$ lexicographically.
3. **Co-incidence Merging:** If edge $e_A$ between Room 1 and Edge $e_B$ between Room 2 share the same centerline:
   - Exactly **one** canonical `Wall` entity is generated.
   - Adjacency is recorded with both `leftRoomId` and `rightRoomId`.
   - The wall thickness is assigned by the **highest-priority semantic use**:
     $$\text{Priority: } \text{CORE} > \text{EXTERNAL} > \text{UNIT\_SEPARATION} > \text{COMMON\_CORRIDOR} > \text{SHAFT} > \text{INTERNAL\_PARTITION}$$
4. **Result:** Zero duplicate collinear segments, zero overlapping wall bounding boxes, and zero self-intersection warnings.

---

## 4. Wall Join & Intersection Geometry

Centerline-based walls expand into 2D polygon solids through half-thickness offsets:
$$\text{Polygon} = \text{Offset}(\text{Centerline}, \pm \frac{\text{Thickness}}{2})$$

At intersections:
- **L-Corners (2 walls):** Endpoints are mitered to form crisp $90^\circ$ exterior and interior corners.
- **T-Junctions (3 walls):** The continuous wall maintains an unbroken exterior face; the intersecting branch terminates cleanly at the face of the continuous wall.
- **Cross-Intersections (4 walls):** Form a four-way intersecting solid without self-intersecting holes or overlapping polygons.
- **Room Usable Area Convention:** The room usable carpet area is calculated as:
  $$\text{Usable Area} = \text{Area}(\text{Centerline Cell}) - \text{Area}(\text{Clipped Wall Union})$$
  This corresponds directly to `CENTRELINE_CELLS_MINUS_CLIPPED_WALL_UNION` in the area ledger.

---

## 5. Architectural Opening Hosting Rules

Openings (doors and windows) are strictly constrained by physical wall geometry:

1. **Host Wall Requirement:** Every opening must reference a valid `wallId`.
2. **Dimensional Capacity:** The width of the opening $W_{\text{door}}$ plus minimum jamb offsets $J_{\text{min}} = 150\text{ mm}$ at each side cannot exceed the host wall segment length:
   $$W_{\text{door}} + 2 \cdot J_{\text{min}} \le L_{\text{wall}}$$
3. **No Hanging Doors:** Openings situated on corners, non-existent walls, or virtual room dividers are prohibited.
4. **Swing Enclosure:** Door swings are modeled as $90^\circ$ arcs that must swing into the destination room without intersecting opposing walls, plumbing fixtures, or electrical shafts.

---

## 6. Unit, Common, and Core Segregation

The apartment plan establishes unequivocal functional segregation across three spatial tiers:

```
[ Common Circulation Corridor / Lift Lobby ]
       │
       ▼ (Acoustic & Fire Door: 1000 mm × 2100 mm)
[ Unit Transition Foyer ]  <-- Public Zone of Flat
       │
       ▼
[ Living & Dining Room ]   <-- Semi-Public Living Core
       ├──> Balcony (Private Exterior Access)
       ├──> Kitchen & Utility (Wet Service Zone)
       │
       ▼ (Intermediate Privacy Passage)
[ Private Bedroom Suite ]  <-- Private Quiet Zone
       └──> Ensuite Bathroom
```

### Segregation Enforcement Invariants
1. **Direct Entrance Restriction:** No elevator lobby or common public corridor may open directly into a bedroom or a bathroom. Entry is exclusively permitted into a transition Foyer or Living/Dining space.
2. **Wet Service Vertical Stacking:** All kitchens, utilities, and bathrooms are adjacent to dedicated vertical plumbing shafts (`SHAFT`), preventing acoustic disturbances and plumbing crossovers.
3. **Acoustic Unit Demising:** Partition walls dividing separate residential flats (`UNIT_SEPARATION`) are guaranteed $230\text{ mm}$ thickness, providing standard acoustic dampening and 2-hour fire separation.
4. **Boundary Integrity:** Unit boundaries are derived by tracing the outer perimeter of the unit's enclosing walls rather than axis-aligned bounding boxes. Consequently:
   $$\text{containsPolygon}(\text{FloorBoundary}, \text{UnitBoundary}) \equiv \text{TRUE}$$
   Zero units spill outside the floor plate, eliminating `CANONICAL_UNIT_OUTSIDE_FLOOR` errors.

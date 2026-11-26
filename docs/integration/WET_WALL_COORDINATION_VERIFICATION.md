# Wet-wall coordination verification

## Shared shafts outside bathrooms

Coordinated generation now reserves shared shafts in available perimeter or common-access service pockets. It leaves bathroom and toilet polygons intact and preserves the central open-to-sky courtyard. An existing peripheral inter-flat ventilation space can share an edge with a separately enclosed shaft when the remaining ventilation span and existing openings can be preserved. Candidate placement first covers the greatest number of nearby flats, then favors shorter plan separation and a smaller footprint. A shaft can serve two to four nearby flats in a multi-flat project.

The coverage calculation measures plan distance to a possible reservation and records the modeled access edge. Pipe lengths, gradients, load, cleanout access, fire stopping and the sanitary sewer connection require engineering coordination. The MEP overlay requires a physical reservation for a stack. Shared shafts are shown without unverified floor branches or collectors. A required bathroom with no suitable shared pocket prevents publication. Optional shortfalls identify the affected bathrooms.

The 38 × 32 m production fixture has two 600 × 1,600 mm perimeter shafts on each residential floor. Each serves two flats, covering all eight bathrooms per floor. The resulting shaft footprint totals 1.92 m² per floor. All bathroom polygons, the central court and both stair routes were preserved. The geometry tests also cover one shaft shared by three and four flats.

## Earlier Phase 5.2 checkpoint

The default 600 × 900 mm allowance is schematic. `architectureOptions.wetWallRiserSizeMm` accepts positive project dimensions. The solver checks area, residual geometry and hosted openings before reserving a corner. Straight-sided orthogonal wet-room polygons can supply a convex corner when the exact polygon area ledger is preserved. The opt-in sharing path can attach two adjacent bathrooms in the same flat to one physical chase. The default keeps the verified separate risers for the four-flat fixture.

The shared architecture acceptance calculation reads modeled chase footprints across residential storeys. A physically shifted chase triggers a critical error even when audit metadata still describes the earlier building. The solver evaluates required chase feasibility while choosing its topology. `requireWetWallRisers` blocks an infeasible brief and identifies the affected bath. An optional reservation miss carries the bath name and reason in a warning. Schematic MEP displays only the physical reservations in coordinated mode. Plumbing chases retain a separate role from ventilation shafts and open-to-sky spaces.

The default fixture has eight aligned risers per residential storey. A tight mixed-BHK fixture exposes missing reservations without drawing unsupported stacks. A custom orthogonal corner and same-flat sharing have geometry-level regression evidence. Automatic riser assignment across materially different storey programs still requires compatible footprints. Detailed branch routing, utility-space coordination, pipe sizing, slab penetrations, maintenance access and drainage engineering require further design and verification.

Two focused geometry tests passed for a custom 550 × 750 mm chase in a stepped bath and one chase shared by two adjacent baths. The real HTTP fixture preserved the default eight reservations on each residential floor and refused a mandatory 5,000 × 5,000 mm reservation while naming the affected rooms.

# Wet-wall coordination verification

## Shared shafts outside bathrooms

Coordinated generation now reserves shared shafts in available perimeter or common-access service pockets. It leaves bathroom and toilet polygons intact and preserves the central open-to-sky courtyard. An existing peripheral inter-flat ventilation space can share an edge with a separately enclosed shaft when the remaining ventilation span and existing openings can be preserved. Candidate placement first covers the greatest number of nearby flats, then favors shorter plan separation and a smaller footprint. A shaft can serve two to four nearby flats in a multi-flat project.

The coverage calculation measures plan distance to a possible reservation and records the modeled access edge. The MEP overlay requires a physical reservation for a stack. A required bathroom with no suitable shared pocket prevents publication. Optional shortfalls identify the affected bathrooms.

The 38 × 32 m production fixture has two 600 × 1,600 mm perimeter shafts on each residential floor. Each serves two flats, covering all eight bathrooms per floor. The resulting shaft footprint totals 1.92 m² per floor. All bathroom polygons, the central court and both stair routes were preserved. The geometry tests also cover one shaft shared by three and four flats.

## Schematic drainage follow-up

Compact two- and three-flat layouts can reserve a service pocket at the end of a shared corridor or lobby if existing openings and adjoining access edges remain available. The route planner checks candidate runs and collector geometry against the site or floor outline and avoids modeled stairs, lifts, voids, vehicle aisles and other flats where applicable. An obstructed run is omitted. A collector is recorded only when a proposed stilt connection and trunk both fit. The plan measures emitted pipe centreline lengths and reports unconnected risers.

The four-flat courtyard fixture retains both aligned perimeter shafts. The two residential levels contain 40 proposed drainage runs totaling 338.94 m of plan centreline. Both projected stilt outlets land in inter-flat open-to-sky voids and remain unresolved. The two-flat test layout has a schematic collector proposal. The three-flat layout reserves a shared shaft and produces residential branch proposals. Its stilt connection remains unresolved. The blocked-stilt regression rejects a route through a protected obstruction and reports the disconnected shafts.

The output is `SCHEMATIC_UNSIZED`. Diameter and fall values are proposal inputs. Available invert, developed vertical fall, fixture loads, venting, cleanouts, fire stopping and the sanitary sewer tie-in remain to be coordinated. [CPWD guide to NBC 2016, Part 9](https://cpwd.gov.in/Publication/Booklet-Guide-for-Using-NBC-2016.pdf)

## Earlier Phase 5.2 checkpoint

The default 600 × 900 mm allowance is schematic. `architectureOptions.wetWallRiserSizeMm` accepts positive project dimensions. The solver checks area, residual geometry and hosted openings before reserving a corner. Straight-sided orthogonal wet-room polygons can supply a convex corner when the exact polygon area ledger is preserved. The opt-in sharing path can attach two adjacent bathrooms in the same flat to one physical chase. The default keeps the verified separate risers for the four-flat fixture.

The shared architecture acceptance calculation reads modeled chase footprints across residential storeys. A physically shifted chase triggers a critical error even when audit metadata still describes the earlier building. The solver evaluates required chase feasibility while choosing its topology. `requireWetWallRisers` blocks an infeasible brief and identifies the affected bath. An optional reservation miss carries the bath name and reason in a warning. Schematic MEP displays only the physical reservations in coordinated mode. Plumbing chases retain a separate role from ventilation shafts and open-to-sky spaces.

The default fixture has eight aligned risers per residential storey. A tight mixed-BHK fixture exposes missing reservations without drawing unsupported stacks. A custom orthogonal corner and same-flat sharing have geometry-level regression evidence. Automatic riser assignment across materially different storey programs still requires compatible footprints. Detailed branch routing, utility-space coordination, pipe sizing, slab penetrations, maintenance access and drainage engineering require further design and verification.

Two focused geometry tests passed for a custom 550 × 750 mm chase in a stepped bath and one chase shared by two adjacent baths. The real HTTP fixture preserved the default eight reservations on each residential floor and refused a mandatory 5,000 × 5,000 mm reservation while naming the affected rooms.

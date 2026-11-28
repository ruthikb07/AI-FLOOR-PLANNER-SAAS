# Coupled slab and frame verification

## Mesh handoff

POST /api/v1/structural/deck-topology accepts an optional meshProposal together with the saved evaluationId and its canonical building. First request the topology without a proposal to obtain the supporting floor and physical region IDs. Supply those IDs, unique mesh node IDs and quadrilateral connectivity in counter-clockwise order in structural XY. A node with frameNodeIndex uses that exact analytical node. A node with pointMm uses a canonical plan coordinate and receives its own analytical index.

The backend obtains the floor region, openings, beam identities, analytical children, frame coordinates and frame revision from the saved evaluation. It reports candidate thickness and material provenance separately. A missing thickness is returned as null. Shared nodes retain the saved structural coordinates. Additional mesh nodes are numbered after the saved frame node array, and each quadrilateral carries its ordered analytical indices. These additional indices apply to one proposed region on this evaluation. Combining independently numbered regional proposals requires a building-level assembly.

The worker checks convex quadrilaterals, upward orientation, coplanar shared nodes, coverage of the polygon minus holes, area overlap, uncovered interior edges and identity agreement with beam subdivisions. It compares planar areas in square millimetres against the existing 0.01 mm² deck tolerance. It rejects unsupported frame-to-plate offsets or beams requiring a subdivision. The shared-edge receipt maps actual physical beam IDs to analytical frame IDs, node indices and adjacent plates.

## Independent checks

Eight 2 × 2 m elements cover a 6 × 6 m surface with a 2 × 2 m central opening. Analytical coverage is 32 m². Oblique frame edges are tested using a shear transformation of the entire mesh. Negative cases include a filled opening, coincident independent nodes, overlapping plates, wrong elevation, stale region ID, inverted element and hanging node. The production HTTP regression uses a 4 × 2.5 m deck and checks both acceptance of four shared edges and rejection after replacing one shared node with an independent point at the same coordinates. It reads back the saved evaluation to verify that load takeoff did not change.

## Engineering status

**VERIFIED FOR DEFINED SCOPE** for geometric compatibility of one proposed horizontal quadrilateral region with coincident straight beam axes. **BLOCKED** for using an apartment mesh to assign gravity or size members. The receipt does not establish adequate bearing, support stiffness, diaphragm behaviour, plate quality under refinement or permissible load combinations. Load-source mapping across floors, prevention of duplicated stiffness and loads, compatible offsets and independently benchmarked coupled deflections, member actions and reactions remain open. The building-level shell solve remains gated.

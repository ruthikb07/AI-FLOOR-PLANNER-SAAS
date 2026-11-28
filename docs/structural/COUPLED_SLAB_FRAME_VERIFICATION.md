# Coupled slab and frame verification

## Mesh handoff

POST /api/v1/structural/deck-topology accepts an optional meshProposal together with the saved evaluationId and its canonical building. First request the topology without a proposal to obtain the supporting floor and physical region IDs. Supply those IDs, unique mesh node IDs and quadrilateral connectivity in counter-clockwise order in structural XY. A node with frameNodeIndex uses that exact analytical node. A node with pointMm uses a canonical plan coordinate and receives its own analytical index.

The backend obtains the floor region, openings, beam identities, analytical children, frame coordinates and frame revision from the saved evaluation. It reports candidate thickness and material provenance separately. A missing thickness is returned as null. Shared nodes retain the saved structural coordinates. Additional mesh nodes are numbered after the saved frame node array, and each quadrilateral carries its ordered analytical indices. These additional indices apply to one proposed region on this evaluation. Combining independently numbered regional proposals requires a building-level assembly.

The worker checks convex quadrilaterals, upward orientation, coplanar shared nodes, coverage of the polygon minus holes, area overlap, uncovered interior edges and identity agreement with beam subdivisions. It compares planar areas in square millimetres against the existing 0.01 mm² deck tolerance. It rejects unsupported frame-to-plate offsets or beams requiring a subdivision. The shared-edge receipt maps actual physical beam IDs to analytical frame IDs, node indices and adjacent plates.

## Independent checks

Eight 2 × 2 m elements cover a 6 × 6 m surface with a 2 × 2 m central opening. Analytical coverage is 32 m². Oblique frame edges are tested using a shear transformation of the entire mesh. Negative cases include a filled opening, coincident independent nodes, overlapping plates, wrong elevation, stale region ID, inverted element and hanging node. The production HTTP regression uses a 4 × 2.5 m deck and checks both acceptance of four shared edges and rejection after replacing one shared node with an independent point at the same coordinates. It reads back the saved evaluation to verify that load takeoff did not change.

## Engineering status

**VERIFIED FOR DEFINED SCOPE** for geometric compatibility of one proposed horizontal quadrilateral region with coincident straight beam axes. **BLOCKED** for using an apartment mesh to assign gravity or size members. The receipt does not establish adequate bearing, support stiffness, diaphragm behaviour, plate quality under refinement or permissible load combinations. Load-source mapping across floors, prevention of duplicated stiffness and loads, compatible offsets and independently benchmarked coupled deflections, member actions and reactions remain open. The building-level shell solve remains gated.

## Constant-curvature numerical benchmark

The local PyNite worker also passed an independent bending patch on a horizontal 6 m by 2 m cantilever with two concentric edge beams. The root is clamped across the full width. Both beams and the 0.2 m plate have E = 24 GPa, and the plate has zero Poisson ratio. Each beam has I = 0.0005 m⁴. The end couples are proportional to the component bending stiffnesses and produce a constant curvature of 0.0001 m⁻¹. The mesh receipt supplies the actual shared node indices to the worker.

| Hand-calculated quantity | Expected result |
|---|---:|
| Free-edge vertical displacement | −1.800 mm |
| Free-edge rotation about Y | 0.000600 rad |
| Total root moment about Y | −5.600 kN·m |
| Bending moment magnitude along each beam | 1.200 kN·m |
| Longitudinal plate bending moment magnitude | 1.600 kN·m/m |

The 4-, 8- and 16-quad meshes each meet 10⁻⁸ m displacement, 10⁻⁸ rad rotation and 10⁻⁶ moment tolerances in the units above for moments. This checks bending compatibility and action recovery in an exactly representable elastic field. Distributed floor gravity, realistic slab-to-beam offsets, stair bearings, reactions for either apartment and mesh convergence for their geometries remain open.

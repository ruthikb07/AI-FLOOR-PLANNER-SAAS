# Building connectivity verification

The pinned PyNite physical member searches all model nodes for collinear interior points when preparing its finite elements. This can attach a separately supported plate at an incidental plan and elevation coincidence even when both components independently pass a connectivity graph test.

The regression places a fully restrained independent deck vertex at midspan of a cantilever. With a 3 kN tip force, a 4 m span and EI = 24000 kN m², the baseline worker returned a tip displacement of -0.333333 mm. The analytical reference is -2.666667 mm. The repaired mixed-model adapter creates exactly one internal member between each pair of explicit analytical child endpoints. The test checks the reference deflection to 1e-8 relative tolerance and all six reactions of every independent plate node to 1e-8 absolute tolerance. The distributed gravity suite exercises genuinely shared endpoints as positive controls.

Full archive continuity remains open. All registered components can now be meshed, but the coordinated floor triangulation now partitions all clipped physical axes and region boundaries together. Exact archive replay reduced directed nonconforming flags from 22 and 20 to zero in both archives. The 42 and 32 remaining directed interfaces have matching geometric partitions and require engineering continuity review. See the per-floor interface counts in the [archive replay](6a-evidence/adaptive-apartment-replay.json).

## Explicit continuity review

The automatic deck HTTP request accepts optional interface reviews bound to the saved evaluation ID, supporting floor, two physical region IDs, a review reference and the connection type MONOLITHIC_FULL_INTERFACE. This preview shares all six DOFs along that complete common edge. It rejects unknown, duplicate, stale, incompatible and conflicting frame identities. A returned floor registry identifies competing beam station lists before a global solver can consume them. The review does not modify the saved evaluation. Moment releases, partial contact and movement joints require their own connection models.

With a 2 m by 2 m loaded bay connected to an equal unloaded bay clamped at its far edge, a pressure of 2 kN/m² gives 8 kN and 24 kN m at the root. The managed mixed-element worker matches both to 1e-7. Removing the review disconnects the loaded bay and the worker rejects the model. Neither archive supplies this review. The original archive has ten element-level candidate conflicts across its five registered floors and the second has nine across three floors.

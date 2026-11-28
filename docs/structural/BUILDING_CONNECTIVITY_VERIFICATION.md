# Building connectivity verification

The pinned PyNite physical member searches all model nodes for collinear interior points when preparing its finite elements. This can attach a separately supported plate at an incidental plan and elevation coincidence even when both components independently pass a connectivity graph test.

The regression places a fully restrained independent deck vertex at midspan of a cantilever. With a 3 kN tip force, a 4 m span and EI = 24000 kN m², the baseline worker returned a tip displacement of -0.333333 mm. The analytical reference is -2.666667 mm. The repaired mixed-model adapter creates exactly one internal member between each pair of explicit analytical child endpoints. The test checks the reference deflection to 1e-8 relative tolerance and all six reactions of every independent plate node to 1e-8 absolute tolerance. The distributed gravity suite exercises genuinely shared endpoints as positive controls.

Full archive continuity remains open. All registered components can now be meshed, but multiple boundary partitions still disagree, and matching coordinates cannot decide which interfaces transfer six degrees of freedom. See the per-floor interface counts in the [archive replay](6a-evidence/adaptive-apartment-replay.json).

# BIM clash verification

Import retains the IFC4 project GlobalId, entity GlobalIds, source length unit, storey elevations, content SHA-256 and operator-selected discipline. The reference remains read-only. Display uses a separate 2D overlay. Alignment applies explicit right-handed X/Y/Z translation and planar rotation after converting the source length unit to millimetres. References and alignments are session-scoped.

The checker tests selected-storey straight canonical walls with validated openings against supported single convex vertical prisms. A bounds test limits work. Convex clipping and intersecting height intervals establish intersection volume and location. Canonical opening intervals are subtracted before the comparison, and face-only contact is excluded. Results bind wall, reference ID, revision and measured intersection. Clicking a result selects the canonical wall.

`bim-studio.test.ts` measured 256,000 mm³ of overlap, ignored the same prism in a door void and found no clash at touching faces. Arbitrary mesh and Boolean geometry, clearance metrics, multi-prism coordination, slab-versus-MEP checks, issue status persistence and BCF are outside this verified profile.

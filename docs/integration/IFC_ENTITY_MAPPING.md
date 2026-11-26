# IFC4 entity mapping

| Canonical source | IFC4 representation | Evidence and limits |
| --- | --- | --- |
| Project, site, building, levels | IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey | Separate stable GlobalIds, nested local placements, explicit millimetres, north direction and site plan outline. |
| Physical wall or parapet | IfcWall with Axis and Body | Canonical endpoints and thickness. Curved sections use an annular profile and a sampled axis. Body chord limit 0.5 mm. Nonphysical boundaries and unsupported guards are listed as omissions. |
| Room | IfcSpace in its storey | Ordered plan profile. A body requires a recorded clear height. Open-to-sky voids remain unoccupied. |
| Door or window | IfcDoor or IfcWindow plus IfcOpeningElement | Exact canonical width, height and sill, and explicit void and fill relationships. Door leaf and glazing solids are outside this profile. Open passages publish the opening alone. Legacy, unresolved curved-host or out-of-range openings are listed as omissions. |
| Built floor and roof slab | IfcSlab with FLOOR or ROOF classification | Projected outline, explicit slab cutouts and recorded thickness. Missing thickness prevents volume export. |
| Canonical stair | IfcStair with treads and landings | Projected solids carry real canonical geometry. Standalone IfcStairFlight occurrences and legacy stair envelopes are outside this profile. |
| Framing and services | Declared omissions | Preliminary framing, furniture and MEP stay outside architectural IFC4. |

Linear coordinates use `(x, -y, z)` exactly once. The writer assigns area and volume units independently of the millimetre length unit. Existing room area is measured from boundary vertices. Spaces aggregate under their storey. Product containment covers modeled physical entities, and opening host and fill relationships remain distinct. Explicit wall materials use IfcRelAssociatesMaterial.

GlobalIds use the first 128 bits of the SHA-256 of a versioned project, building, entity and storey key, compressed by the adapted OpenBIMStudio helper. The revision stays out of element identity. The manifest pins canonical and artifact SHA-256 separately and states software readback status. Independently validated files and unsupported mappings are recorded in the [round-trip report](IFC_ROUNDTRIP_VERIFICATION.md).

IFC4 is the implemented schema. [buildingSMART IFC4 ADD2 TC1](https://technical.buildingsmart.org/standards/ifc/ifc-schema-specifications/)

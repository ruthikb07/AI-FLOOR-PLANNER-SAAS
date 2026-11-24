# IFC4 independent round-trip verification

`phase4b-ifc-exchange.test.ts` generates real audited models and writes evidence when `RH_IFC_EVIDENCE_DIR` is set. `scripts/verify-ifc4.py` independently opens the exact IFC artifact with IfcOpenShell and checks the native IFC schema, GlobalId uniqueness, project and revision binding, declared units, storey placements, room boundaries, wall axes and thickness, opening geometry, host and fill relationships, slab profiles, and representative meshes. It does not invoke the TypeScript writer for readback.

Before running, the geometric bounds were set at 0.001 mm for positions and dimensions, 0.1 mm² for profile area, and 0.5 mm for the annular wall approximation. SITE, IFC spatial hierarchy and IFC openings are tested separately from professional verification.

The first nine-file independent run covered the bungalow, one-to-six-flat apartment fixtures, strict unequal carpet, mixed-BHK rotunda, stilt and multi-storey profiles. The rotunda included 12 curved walls and 22 slab cutouts. Independent dimensions matched within tolerance. IFC validation checked the authored format and representative meshing. Native Revit, Archicad, FreeCAD and Bonsai reopen remains unverified.

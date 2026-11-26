# Native IFC reopen verification

**UNVERIFIED.** The Windows installed-application inventory did not show a compatible Revit, Archicad, FreeCAD, Bonsai, Solibri or BIMvision desktop installation. The existing Blender verification established its native RH package path. It did not establish a working IFC desktop import plugin. No additional desktop BIM software was installed.

The Phase 5 anchor passed 20 independent IfcOpenShell 0.9.0.post1 schema and geometry readbacks. The first Phase 5.1 run passed all 22, including exact oblique and concave site outlines. These checks validate the canonical site outline, identities, types, storey and coordinate placement, opening hosts, wall and slab geometry and representative meshes. Desktop application verification remains required for the hierarchy, elevations, straight and curved walls, openings, stair flights, slab voids, parapets and object identity. [Phase 5.1 independent IFC job](https://github.com/ruthikb07/AI-FLOOR-PLANNER-SAAS/actions/runs/45657646226/job/139358542106)

Production BIM reference coordination supports the scoped read-only IFC representation profile. General arbitrary IFC geometry, BCF and unrestricted external writeback remain outside this profile. [IFC exchange design](PHASE4B_ACCEPTANCE.md)

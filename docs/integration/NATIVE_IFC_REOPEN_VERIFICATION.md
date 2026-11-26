# Native IFC reopen verification

**PARTIAL.** FreeCAD 1.1.4 opened IFC4 files on Windows in Phase 5.2. The rectangular and exact surveyed examples passed the sampled aperture checks. The rotated and curved example still has occupied samples at canonical apertures.

## Phase 5.1 baseline

The prior Windows installed-application inventory did not show a compatible Revit, Archicad, FreeCAD, Bonsai, Solibri or BIMvision desktop installation. The existing Blender verification established its native RH package path. It did not establish a working IFC desktop import plugin.

The Phase 5 anchor passed 20 independent IfcOpenShell 0.9.0.post1 schema and geometry readbacks. The first Phase 5.1 run passed all 22, including exact oblique and concave site outlines. These checks validate the canonical site outline, identities, types, storey and coordinate placement, opening hosts, wall and slab geometry and representative meshes. Desktop application verification remains required for the hierarchy, elevations, straight and curved walls, openings, stair flights, slab voids, parapets and object identity. [Phase 5.1 independent IFC job](https://github.com/ruthikb07/AI-FLOOR-PLANNER-SAAS/actions/runs/45657646226/job/139358542106)

Production BIM reference coordination supports the scoped read-only IFC representation profile. General arbitrary IFC geometry, BCF and unrestricted external writeback remain outside this profile. [IFC exchange design](PHASE4B_ACCEPTANCE.md)

## Phase 5.2

The operator authorized the official FreeCAD Windows package for Phase 5.2. The portable 1.1.4 release is isolated in the evidence folder. The archive matched official SHA-256 `4828741fc91ee37fafcdb97a1abacb18b04ba451ac4372d9ff7a7349b36f4d6d`. The native executable has a valid Authenticode signature from The FreeCAD project association AISBL. The GUI reported FreeCAD 1.1.4 and source commit `4fd3bf320d9566a27e60069fc8387448aaa3a094`. [Official release](https://github.com/FreeCAD/FreeCAD/releases/tag/1.1.4)

The first native imports reopened the exact oblique survey and open-stilt multi-storey IFC4 files. File digests matched the manifests and all nine storey elevations matched at 0 mm error. FreeCAD materialized 327 and 1,548 GUID-bearing records. The absent native objects were six and forty `open_passage` door records, respectively. The IFC4 files retain these records.

The exact surveyed site matched all signed canonical vertices in the embedded IFC footprint after applying the documented coordinate transform and allowing ring winding reversal. Native wall solids cleared all 55 sampled door and window opening centers in that model. The rectangular wet-wall export and the IFC exported by the production browser each cleared all 181 sampled hosted aperture centers.

The browser export opened as a four-storey model with 893 GUID-bearing objects and a matching file digest. All four courtyard slab center samples were clear. A second FreeCAD session reopened the saved native document and matched the six lift shaft and 16 plumbing reservation footprints to the canonical model by GUID. It recovered two stair assemblies on each storey, including the terrace stair headhouses. The six full stairs each returned 18 native solids and two embedded IFC flight bodies. FreeCAD presents the flight geometry under the parent objects. The lift and riser exports describe reservations using `IfcSpace` geometry.

In the rotated and curved fixture, 63 of 87 opening center samples were clear. The 24 occupied samples included rotated straight openings and curved-host windows. Increasing cutter depth in a local experiment reduced the clear count to 59, so that change was discarded. The clean schema readback is recorded independently from these native geometry results.

Local evidence is under `%LOCALAPPDATA%\RHPlanner\phase5-2`, including `freecad-native-final.json`, `freecad-padding-and-courtyard.json`, `freecad-browser-spaces.json` and the reopened `freecad-native\courtyard.FCStd`.

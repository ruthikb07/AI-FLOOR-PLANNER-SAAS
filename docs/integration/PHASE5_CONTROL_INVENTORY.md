# Phase 5.1 Studio control inventory

Control evidence is scoped to the cited production browser workflow. Rows with partial evidence remain open for individual control-level acceptance.

The retained Windows browser traces add 488 distinct observed DOM control entries, including 155 explicit test IDs, in `control-inventory-observed-traces.json` under the Phase 5.1 evidence directory. These are observations of rendered DOM states across the traces. The table records the actions with outcome evidence.

| Workspace and control | Expected action and observed result | Evidence or remaining scope |
| --- | --- | --- |
| Brief, survey editor | Edit/import measured boundaries, maintain history, designate frontage, return precise validation | `rh-survey-setup` exercised desktop editing, mobile fractional input and DXF, exact generation, failed closure and curved survey DXF. |
| Brief, strict carpet, per-flat target, tolerance | Carry entered requirements to the planner and refuse impossible programs | Wizard and API regressions. |
| Brief, prefer exterior living and wet-wall risers | Opt into per-flat exposure and pipe-chase placement | The production wizard passed the option to generation, published it in the canonical study, and displayed the plan. The paired HTTP/renderer regression verifies aligned risers and the `PR` labels. |
| Massing, Plan/Building, study selection and Open in CAD | Display the selected canonical candidate and open it in CAD | `rh-studio-workflow` and `rh-survey-setup`. The survey screenshots exposed pale study labels against a light chip in Obsidian. The study buttons now use the matching Studio surface and text styles, with a browser assertion for each surface. |
| Massing, Preserve core, Preserve exterior footprint | Keep exact locked geometry or refuse the new study | Focused all-storey comparison regression. Individual toggle combinations are partial. |
| Massing, internal layout, massing, carpet, circulation and daylight | Request alternate geometry with the chosen priorities | Basic alternative workflow verified. Individual prioritization effects are unverified. |
| Interactive Plan, room customization and targeted refinements | Apply supported requests while protecting rooms, core and floor outlines | Local refinement tests and editor navigation exercised. Full room-by-room browser inventory remains open. |
| Precision CAD, AI preview, accept, localized Flat 2 regeneration | Propose then commit only scoped changes and advance revision | `rh-phase4a-cad-workflow`, `rh-phase5-unified-studio`; matching protection digests were observed. |
| Precision CAD, wall/door/window operations and floor selection | Edit or refuse supported inputs against the selected floor and host | Direct opening inspection, window edit and wall/door target regressions. Interactive breadth is partial. |
| Precision CAD, undo/redo | Reverse and restore the same canonical revision | Browser revision assertions and protect-edit tests. |
| Floor 3D, view mode | Open a real rendered floor | Browser canvas assertion. Detailed furniture placement remains scoped to supported orthogonal rooms. |
| Tower 3D, orbit, perspective/orthographic, section, exploded | Change camera or view state against the same model | Production orbit/section and projection assertions. Full exploded settings per project remain unverified. |
| Tower 3D, Cutaway, furniture categories, Dining, Day/Golden/Night | Change visible objects or decorative lighting without changing model identity | Browser verified cutaway, master-bed category and night light. Individual dining and placement controls remain partial. |
| BIM, storey, schedule, property inspector and query | Select the physical occurrence and report canonical quantities | Browser checked window identity, host, dimensions, total area, and BIM-to-CAD/Tower selection. |
| BIM, IFC4 import/alignment, clash and clearance | Coordinate read-only reference geometry and show checked scope | Browser IFC export/reimport/alignment and wall clash. Numerical clearance and unsupported representation tests carry the remaining evidence. |
| Project library, save, reload and revision archive | Save the current revision, reload identity and open exact archived revisions | Browser workflow and stale-save regression, with archive identity scoped by project ID. |
| Export Center, paper/scale and professional files | Verify current revision, produce correct format bytes and download | Export-format provenance below. All scope/format combinations remain unverified. |

## Export provenance

| Format | Verified scope |
| --- | --- |
| DWG, DXF and PDF | Prior production replay covered eight first-residential-floor files per format. All 24 receipts matched the revision and digests and the native AutoCAD audit reported zero errors across 12 representative DWG/DXF files. PDF was checked as drawing output. |
| IFC4 | Canonical source revision and file SHA-256 verified in Chromium. Phase 5 had 20 independent readbacks. Phase 5.1 adds two exact survey fixtures to the independent parser job. Native BIM reopen remains unverified. |
| GLB | Download, binary header, source revision and SHA-256 were checked against persisted models. Structural geometry requires its applicable model. |
| Blender | Prior native Blender 5.2 produced seven verified files including a complete scene package. The evidence is version-bound to the baseline. |
| ETABS | Prior ETABS 23.3.2 independently reopened two revision-bound native EDB files in model-only scope. |

See the historical [Phase 5 acceptance evidence](PHASE5_ACCEPTANCE.md) for the native export links and provenance.

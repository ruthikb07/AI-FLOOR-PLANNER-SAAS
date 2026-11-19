# RH Planner rebuild audit and implementation map

The previous split welcome uses a photograph over the same small assembly model. A fixed side rail, repeating panel headers and similar report cards carry the same composition into setup and delivery. The shell owns workflow transitions, the wizard writes a persisted draft, the worker owns generation, and CAD, engineering and export consume the editor's canonical building.

| Surface | Previous composition | New composition and action |
| --- | --- | --- |
| Welcome | Split photograph and primitive assembly | Full-viewport architectural scene with an original terraced residence, material lighting, scroll-driven close-up, elevation, section and plan |
| Project entry | Three buttons over the hero | Architectural choice spread with before and after site references and direct entry into the draft |
| Setup | Form card with a static photo strip | Working land parcel and massing surface alongside site, program, owner and briefing sheets |
| Generation | Dialog list | Measured site context alongside real worker stages and existing recovery controls |
| Concepts | Regeneration toolbar | Read-only canonical snapshots and measured comparison, with explicit model selection |
| CAD and 3D | Persistent photo navigation rail | Full-width drawing and model surfaces with a horizontal workflow and focused tools |
| Engineering and delivery | Similar stacked panels | Data-led engineering evidence and sheet/artifact delivery sections |
| Project library | Project dropdown | Dedicated saved project view with snapshot plan previews and reopen controls |

## Components and data

| Area | Components | Data and actions |
| --- | --- | --- |
| Welcome and project entry | `RHWelcomeScreen`, `ResidenceShowcase`, `terrace-residence.ts` and `rh-atelier.css` replace the visible split welcome and its assembly scene. | Five camera chapters share one Three.js renderer. Native scrolling drives a reversible camera path and a separated-floor study. Drag orbit and daylight/evening controls operate on the model. Project choices enter the working intake. |
| Site, floors and redevelopment | `ProjectSetupWizard`, `ParcelStudy` and `RedevelopmentProgramPanel` | The same persisted draft feeds the site, building envelope, floor stack and owner level requests. The axonometric SVG is drawn from current parcel dimensions, road and setback values. Redevelopment switches between existing and proposed blocks. |
| Brief and references | `Stage4PromptAndUpload` and existing reference workflow | The requirements notebook appends selected prompts to the written brief. PDF signature checks, local page preview and user verification remain in the intake. DXF and image workflows use their existing services. |
| Generation and concepts | `GenerationProgressModal`, `ConceptReviewWorkspace` and `ConceptModel` | The modal reads planning worker events. Completed models produce real plan thumbnails and 3D previews. A distinct alternative can be opened and saved separately to preserve the original project. |
| Architectural and structural CAD | `ArgonStudioShell`, `ArchitecturalCADWorkspace`, `InteractivePlanEditorPage` and `StructuralCADWorkspace` | The studio uses horizontal workflow navigation, a drawing banner and a collapsible inspector. Canvas selection, geometry overlays, room dimensions, audits and framing commands keep their canonical source. |
| Floor and whole-building 3D | `FloorIsometricEditor`, `Building3DCustomizer`, `ModelWorkspace` and `ThreeBuildingScene` | The canonical projection uses HDR reflections, PBR shading and a stone normal map. Perspective and orthographic cameras, sectional clipping, floor isolation, explode, lighting presets and model selection are available. Clipping also applies to picking. |
| Engineering | `UdcprEtabsAnalysis` and `ETABSExportPanel` | The rule bar and filters count actual results from the regulatory evaluator. ETABS output and verified native analysis have their own reported statuses. |
| Delivery | `ExportCenterWorkspace` | The issue desk displays a live plan preview, output settings, per-artifact status, byte verification and the existing drawing, model and ETABS export clients. |
| Project library | `ProjectLibrary`, `services/storage.ts` and `stores/editor-store.ts` | The library opens real IndexedDB project snapshots and records recent saved revision numbers and timestamps. Reopening a project updates the active-project pointer used on reload. |

## Flagship 3D and installed assets

Terrace Residence is original stepped two-wing geometry with recessed balconies, bronze fins, stone cladding, entrance canopy, planted podium and rooftop pools. Three.js builds it from instanced meshes with mapped stone, HDR sky reflections, shadowed lighting and layered glass. The renderer adjusts pixel ratio and shadows, renders on interaction or camera motion, and releases its controls, assets and WebGL context on unmount. The photography shows separate buildings. The three supplied WhatsApp videos informed the arrival, facade framing and assembly direction. Their footage stays outside the website.

See the [asset license and provenance manifest](../../packages/frontend/public/architecture/ASSET_LICENSES.md) for the photographs, creators, Poly Haven source IDs, dates and rights.

## Feature status

| Status | Scope |
| --- | --- |
| IMPLEMENTED | New welcome and workflow navigation, real architectural photography, reversible navigable demo scene, responsive new construction and redevelopment entry, reactive parcel and floor stack, briefs and reference upload, actual worker progress, canonical concept selection, drafting and model review, regulatory checks, artifact exports, saved projects and recent revision metadata. |
| PARTIALLY IMPLEMENTED | Photographic fidelity remains below the supplied videos. The flagship and studio are real-time architectural renders. The parcel and existing-building previews are axonometric schematics. Linked owner levels are recorded as requests and highlighted, with the final placement subject to the solver. The homepage presents one demo property through several architectural views. Distinct generated concepts appear in the working studio. PDF pages can be previewed and verified manually. The recent revision list stores metadata with the latest geometry. |
| NOT IMPLEMENTED | Automatic PDF-to-CAD reconstruction, restoring older saved geometry from the revision list, production field profiling, and certification of native structural analysis. The new scope does not extend the existing walkthrough or interior customization features. |

## Architectural site boundary requirement

Site geometry is a required generation input for surveyed projects. The production planning route must accept ordered straight and circular edges in millimetres, preserve the measured boundary and road frontage, and validate the buildable envelope and generated geometry against that site. Ventilation, circulation, stairs, lifts, shafts, balconies and residual areas must be assessed on the resulting layout. 2D, 3D, CAD and Blender must derive from the same canonical site and building geometry. Any tessellated representation must declare its tolerance. Missing regulatory inputs require an explicit unresolved status.

The setup wizard now captures and validates a local surveyed draft in the Site step. Editable geometry supports coordinates, bearings, length-and-angle traverses and closed model-space DXF lightweight polylines. Setback previews support independent entered margins on convex straight parcels. Concave and curved setback solutions, road reservations, PDF tracing and calibration, and surveyed building generation and exports remain pending. The production request adapter blocks surveyed generation until a route accepts its exact geometry. The original rectangular workflow remains available.

The geometry suite passed 95 tests and the frontend suite passed 176. Three Chromium checks exercised desktop editing, mobile DXF import and drawing, and real rectangular generation after visiting the survey editor. Frontend and geometry lint and type checks passed. The frontend production build passed with Vite's chunk-size warning. [Browser screenshots](../../test-artifacts/survey-ui-acceptance) · [DXF lightweight polyline reference](https://help.autodesk.com/cloudhelp/2017/ENU/AutoCAD-DXF/files/GUID-748FC305-F3F2-4F74-825A-61F04D757A50.htm)

### Survey CAD integration

**Download boundary DXF** exports a valid surveyed parcel as one closed model-space polyline in millimetres. An open polyline on `SITE-ROAD-FRONTAGE` identifies the selected edge. Both polylines preserve circular segments as signed bulges. The importer reads declared drawing units and restores the frontage when the tagged polyline matches a boundary edge. [Chromium screenshots and sample DXF](../../test-artifacts/survey-cad-integration)

AutoCAD 2021 Core Console opened a curved survey DXF and ran `AUDIT` with zero errors and zero fixes. An independent read of the native DWG confirmed the same four boundary vertices, the two frontage vertices and the signed arc bulge of −0.41421356237309503. This export represents site geometry only. The rectangular generation endpoint returns `SURVEY_GENERATION_UNSUPPORTED` when supplied surveyed geometry. Surveyed building generation, curved and concave setback solving, and PDF tracing remain pending.

The production checks covered survey editing, DXF reimport, mobile and WebGL fallback, and switching back to rectangular generation before opening the generated model in orthographic and section views. The frontend suite passed 176 tests, the geometry suite passed 95, and all three focused backend checks passed. The existing combined backend generation and export test exceeded its 60-second limit on two runs.

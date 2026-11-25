# Phase 5 project acceptance matrix

The production generation HTTP route passed nine deterministic cases. Eight cases returned audited canonical geometry, and the conflicting area request returned HTTP 422. All eight accepted cases passed disk save and archived-revision readback with the same canonical digest, SVG generation, IFC export and GLB download with matching revision and digest. Windows IfcOpenShell 0.9.0.post1 independently validated the eight new IFC4 files. The architectural IFC profile declares omitted entities, including furniture, nonphysical boundaries and provisional framing.

| Scenario | Observed evidence | Remaining evidence |
| --- | --- | --- |
| Bungalow, 28 × 24 m | 4BHK program and 27 first-residential-floor records including circulation and service spaces | Custom program and low-rise functional review |
| Compact apartment, 18.5 × 25 m | Two units and shared access, 34 residential-floor records | Compact-site editing and project-specific circulation review |
| Irregular outline, 40 × 33 m | Legacy oblique polygon intake. The two advisory targets of 850 and 1,250 ft² achieved 2,566.43 and 3,812.61 ft² | Exact surveyed edge and envelope intake. Both advisory targets remain unmet |
| Four-flat mixed BHK, 38 × 32 m | Four mixed units with a shared core, 65 residential-floor records | Full mixed-BHK edit and revision workflow |
| Unequal areas, 42 × 34 m | All four required carpet targets within 3% | Full editing and professional export workflow |
| Six-flat floor, 50 × 40 m | Six flats and 83 residential-floor records | Architectural review of internal travel and common access |
| Open-stilt tower, 38 × 32 m | Four residential levels above stilt, six modeled storeys, 67 records on the first residential floor | Project-specific native exchange and stilt review |
| Reference attachment, 38 × 32 m | Used RH Planner's existing Phase 2 typical-floor drawing. The deterministic route recorded the attachment with zero provider calls and no image-derived geometry influence | Authorized live interpretation and verified effect on a matching control plan |
| Infeasible requirements, 18 × 20 m | HTTP 422 and no building. 13,200 ft² of required carpet, or 12,540 ft² at the lower tolerance bound, exceeded the entire 3,875 ft² plot. The diagnostic gave quantitative site and target adjustments | Wizard-level refusal and qualified review of any revised brief |

All eight first residential floors recorded a raw planar ledger delta of 0 mm² and passed the functional and element-realism audits. In the Windows evidence run, the feasible solver times spanned 0.45–4.16 seconds with zero provider calls. The public endpoint refuses exact surveyed-boundary requests. The oblique fixture uses the separate legacy polygon input.

The eight first-residential-floor SVGs were visually reviewed in Chromium. The compact and six-flat sheets show narrow internal access routes, and the irregular sheet shows large, lightly furnished living rooms. The mixed and unequal-area cases show different flat sizes against a shared core. The visuals cover plan arrangement and drawing output. Project-specific architectural acceptance and the full browser chain covering alternatives, protected edits and every exchange format remain open.

## Measured carpet areas for the unequal-target project

| Flat | Requested ft² | Achieved ft² | Error | Recorded status |
| --- | ---: | ---: | ---: | --- |
| 1 | 720 | 723.79 | +0.53% | ACHIEVED |
| 2 | 1,050 | 1,056.73 | +0.64% | ACHIEVED |
| 3 | 1,420 | 1,417.44 | −0.18% | ACHIEVED |
| 4 | 1,750 | 1,756.56 | +0.37% | ACHIEVED |

The Windows logs, generated SVGs, Chromium contact sheets, model snapshots, IFC files and manifests are retained separately from source under `%LOCALAPPDATA%/RHPlanner/phase5-codex-20261125`.

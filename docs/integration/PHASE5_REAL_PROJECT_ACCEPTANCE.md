# Phase 5 project acceptance matrix

The recovered deterministic suite ran eight feasible briefs plus one conflict case. On the recovered baseline the nine assertions passed. Rechecks on the revised implementation also passed all nine in the backend run that subsequently hit a Windows dependency read lock while loading the separate IFC suite.

| Scenario | Executed verification | Remaining evidence |
| --- | --- | --- |
| Bungalow, 28 × 24 m | Generated, geometry and floor-area audits, SVG structure, IFC software readback | Custom room program, visual review and full workflow |
| Compact apartment, 18.5 × 25 m | Generated, geometry and floor-area audits, SVG structure | End-to-end editing and exchange |
| Irregular plot, 40 × 33 m oblique outline | Generated from the irregular boundary fixture, geometry and floor-area audits, SVG structure | Ordered surveyed edges and envelope through the browser and every export |
| Four-flat mixed BHK, 38 × 32 m | Generated, geometry and floor-area audits, SVG structure | Full mixed-BHK workspace workflow |
| Unequal areas, 42 × 34 m | Generated with required 720, 1,050, 1,420 and 1,750 ft² targets and a 3% configured tolerance | A per-flat independently reported request-to-achieved table |
| Six-flat floor, 50 × 40 m | Generated, geometry and floor-area audits, SVG structure | Circulation and architectural visual review |
| Open-stilt tower, 38 × 32 m | Generated four residential levels above stilt, geometry and floor-area audits, SVG, IFC software readback | Full export and native replay |
| Reference attachment, 38 × 32 m | Generated through the deterministic engine with a one-pixel attachment fixture | Genuine reference input and measured effect on the accepted plan |
| Infeasible requirements, 18 × 20 m | Deterministic requirement conflict and measurable alternatives | Production workflow resulting in explicit refusal |

The SVG assertions check document output and room labels. The IFC test in this matrix checks two of the briefs in the software adapter. The separate twelve-file IfcOpenShell suite provides independent parser and solid checks. The nine briefs have not completed the full chain from intake through alternative generation, editing, saved history and professional exchange.

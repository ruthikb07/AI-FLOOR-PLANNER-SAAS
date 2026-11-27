# Reinforcement detailing verification

RH Planner details physical column, beam, slab, stair and footing groups. Each BBS mark carries physical member IDs, storey, component category, diameter, shape identifier, cutting length, count and design/lap weights. The JSON includes explicit canonical geometry where the model supplies it. Physical ownership is used to avoid repeated material through analytical beam subdivision. The reviewed snapshot, not drawing geometry, owns design and schedule data.

| Scope | Status |
| --- | --- |
| Unique column bars and perimeter positions | VERIFIED for the audited rectangular benchmark. Regression rejects overlapping or out-of-section bars at the fiber worker. |
| Column ties, beam stirrups, top/bottom beam bars and slab/stair/footing reinforcement | PARTIAL. Deterministic layouts and schedules exist. Geometry-free rules and supported shape counts require member-level constructibility, confinement and bend verification. |
| Anchorage, transitions, laps, joint anchorage and congestion | PARTIAL. Generated lengths and grouping require a professional detailing audit. Complete 3D clash-checking and robust connection cases remain open. |
| BBS arithmetic, IFC and drawing agreement | PARTIAL. A successful mass reconciliation verifies schedule arithmetic. Complete independent per-bar geometry correspondence across exports remains open. |
| Construction certification | UNSUPPORTED by the automated pathway. The regenerated real project drawings and schedules are diagnostic. |

[BBS reconciliation](BBS_AND_BOQ_RECONCILIATION.md) · [Report specification](STRUCTURAL_ANALYSIS_REPORT_SPECIFICATION.md)

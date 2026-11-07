# ARCHITECTURE TRACE: CANONICAL APARTMENT PLANNING PIPELINE
**Run ID:** `apartment-geometry-20261009-closure`

## 1. End-to-End Pipeline Stages

```
[1. User Requirements & Brief]
       ↓
[2. Reviewed Architectural Program]
       ↓
[3. Apartment Generation Contract (SHA-256)]
       ↓
[4. Gross & Carpet Area Budgeting]
       ↓
[5. Core Configuration & Sizing]
       ↓
[6. Buildable Envelope & Wing Solvers]
       ↓
[7. Unit Topology & Room Schedule Allocation]
       ↓
[8. Metric Room Geometry & Zone Packing]
       ↓
[9. Canonical Wall Graph & Segment Extraction]
       ↓
[10. Architectural Openings & Door Hosting]
       ↓
[11. Multi-Floor & Constraint Validation Engine]
       ↓
[12. Vector SVG Rendering & Editor State Sync]
       ↓
[13. Canonical Revision-Bound Vector PDF Exporter]
```

## 2. Geometry Authority
- **Authority:** All authoritative building geometry resides in the `Building` model in `@ai-floor-planner/core`.
- **Projections:** 2D SVG canvas, Three.js 3D viewport, and PDF deliverables are pure projections of the canonical building model.
- **AI Boundary:** LLM/FLUX models are strictly restricted to non-authoritative concept generation and brief interpretation. Generated images never dictate canonical room coordinates or statutory dimensions.

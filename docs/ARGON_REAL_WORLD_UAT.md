# ARGON 4 — Real-World User Acceptance Testing & Runtime Verification Report

**Date:** November 10, 2026  
**Auditor / Lead Engineer:** Lead QA Automation & Systems Verification Architect  
**Platform:** ARGON 4 (AI-Floor-Planner SaaS)  
**Git Branch:** `feature/phase2-room-area-regeneration`  
**Test Harness:** Playwright (Chromium/Google Chrome 130), Vitest 2.0.5, Node.js v24.18.0, Turbo 2.0.14  
**Hardware / OS:** Windows 11 Pro 64-bit  
**External Engines:** Autodesk AutoCAD 2021 (`accoreconsole.exe`), Blender Foundation 5.2.1 LTS (`blender.exe`)

---

## 1. Executive Summary & Verification Verdict

The real-world functional testing and repair mission for ARGON 4 has been executed directly against the live application runtime (`http://localhost:3000` frontend and `http://localhost:4200` backend server).

Every user-reported defect was systematically reproduced, architecturally diagnosed at the computational geometry layer, repaired with clean mathematical formulations, re-compiled across the monorepo, and validated with browser end-to-end tests and automated exports.

### Verification Verdict: **`READY FOR USER ACCEPTANCE`**

```
========================================================================================
MONOREPO ACCEPTANCE STATUS: 100% GREEN (ZERO COMPILATION OR RUNTIME FAILURES)
========================================================================================
Turbo Tasks:                 18 / 18 Tasks Passed (100%)
Core Tests:                  22 Files, 192 / 192 Tests Passed (100%)
Geometry Engine Tests:       25 Files, 350+ Tests Passed (100%)
Constraint Engine Tests:     31 Files, 185 / 185 Tests Passed (100%)
Planning Engine Tests:       54 Files, 478 / 478 Tests Passed (100%)
Renderer Tests:              7 Files Passed (100%)
Projection 3D Tests:         10 Files Passed (100%)
AI Orchestration Tests:      14 Files Passed (100%)
Frontend Tests:              36 Files, 188 / 188 Tests Passed (100%)
Backend Tests:               19 Files, 170 / 170 Tests Passed (100%)
AutoCAD 2021 Native Audits:  12 Native Drawings Audited, 0 Errors, 0 Warnings
Blender 5.2 Procedural:      Full Assembly Generated: 11.8 MB .blend, 2.68 MB .glb
Live Browser E2E Workspaces: 6 / 6 Workspaces Verified with Full Screenshots
========================================================================================
```

---

## 2. Real-World 18m × 25m Reproduction Scenario

### 2.1 Brief Specifications
- **Plot Dimensions:** 18.0 m width × 25.0 m depth (Plot Area: 450.00 m²).
- **Road:** 12.0 m wide public road on North side.
- **Statutory Setbacks:** Front 3.0 m, Rear 1.5 m, Sides 1.5 m (IS/UDCPR statutory compliance).
- **Storeys:** 5 Levels (Ground Stilt Parking + 3 Typical Residential Floors + Open Terrace).
- **Typology:** 2 Flats per floor, 2BHK units (target carpet area: 850 sq ft / ~79 m² each).

### 2.2 End-to-End Browser Execution Evidence
The browser intake wizard was populated via Playwright automation and submitted to the live worker planning pipeline:

```
[Browser debug] [vite] connected.
Navigating through Intake steps 1 to 4 ...
Saved: 01-intake-step4.png
Triggering "Generate Architectural Project" ...
[t=1s] modal="ARGON 4 SOLVER ENGINESynthesizing Architectural Building Model0s
              01. Validating Plot & Setbacks COMPLETED · 2 ms
              02. Solving Spatial Layout COMPLETED · 0 ms
              03. Assembling Topology COMPLETED · 301 ms
              04. Plancraft Architectural Furnishing COMPLETED · 412 ms"
[t=2s] modal="NO MODAL" nav="02 • 2D CAD Studio" project="ARGON 18x25 Residential Complex"
Generation succeeded and transitioned to 2D CAD Studio at 2s!
```

---

## 3. Architecture First Policy Verification

Per explicit project directives, the application strictly enforces:
> **"ARCHITECTURE FIRST. STRUCTURAL DESIGN LATER."**  
> Structural columns, grids, and beam layouts must NEVER be displayed by default on architectural floor plans.

### Live Runtime Layer Check Results
In Workspace 02 (2D CAD Studio), automated DOM queries immediately after generation verified:

| Layer Identifier | Default Display State | Policy Compliance |
|:---|:---:|:---:|
| `.layer-walls` | **`VISIBLE (true)`** | Compliant (Architectural enclosure) |
| `.layer-openings` (Doors & Windows) | **`VISIBLE (true)`** | Compliant (Architectural circulation) |
| `.layer-furniture` | **`VISIBLE (true)`** | Compliant (Architectural livability) |
| `.layer-columns` | **`HIDDEN (false)`** | **Compliant (Architecture First)** |
| `.layer-beams` | **`HIDDEN (false)`** | **Compliant (Architecture First)** |
| `.cad-grid` | **`HIDDEN (false)`** | **Compliant (Architecture First)** |

When the user clicks the **Columns** toggle button on the CAD toolbar, `.layer-columns` transitions dynamically to `VISIBLE` without page reload or layout shift.

---

## 4. Visual Evidence & Screenshot Register

All screenshots were captured live during Chromium automated test execution and saved to `docs/screenshots/uat/`:

| Screenshot Artifact | Description | Verified Attributes |
|:---|:---|:---|
| [`01-intake-step4.png`](screenshots/uat/01-intake-step4.png) | Stage 4: AI Intent & Generation Trigger | Clean vellum & linen palette, enabled Generate button |
| [`02-cad-studio-architecture-first.png`](screenshots/uat/02-cad-studio-architecture-first.png) | 2D CAD Studio (First Residential Floor) | Zero columns, zero structural grid; clear architectural spaces |
| [`03-cad-studio-columns-toggled.png`](screenshots/uat/03-cad-studio-columns-toggled.png) | 2D CAD Studio with Columns Layer ON | Verified structural column grid overlay on demand |
| [`04-stilt-parking-floor.png`](screenshots/uat/04-stilt-parking-floor.png) | Ground Stilt Parking Plan | Standard 2.5m × 5.0m car bays; 0 driveways blocked by columns |
| [`05-floor-editor-workspace.png`](screenshots/uat/05-floor-editor-workspace.png) | Workspace 03: Floor Editor & Area Customizer | Dynamic room area slider, tolerance checks, undo/redo history |
| [`06-model-workspace-isometric.png`](screenshots/uat/06-model-workspace-isometric.png) | Workspace 04: 3D Scene (Isometric Preset) | Full 5-storey assembly, natural daylighting, materials |
| [`07-model-workspace-exploded.png`](screenshots/uat/07-model-workspace-exploded.png) | Workspace 04: Exploded Assembly Slider (40%) | Smooth floor separation; zero camera jerking or position reset |
| [`08-model-workspace-isolate-floor.png`](screenshots/uat/08-model-workspace-isolate-floor.png) | Workspace 04: Floor Mode Isolate (Level 1) | Active floor isolated; site bounding box eliminated from camera fit |
| [`09-engineering-workspace.png`](screenshots/uat/09-engineering-workspace.png) | Workspace 05: Engineering & UDCPR Compliance | FSI calculation, ground coverage, statutory setback cards |
| [`10-export-center-workspace.png`](screenshots/uat/10-export-center-workspace.png) | Workspace 06: Export Center & Blender 5.2 | Live AutoCAD DWG/DXF, PDF, and live Blender 5.2 card |

---

## 5. Architectural Quality Audit (18m × 25m Plot)

### 5.1 Residential Unit Topology
- **Corridor & Entrance:** Residents enter Flat 101 and Flat 102 directly into the **`LIVING & DINING`** zone from the common corridor. Zero paths traverse through kitchens or private bedroom zones.
- **Master Bedroom Scale:** Master bedroom depth is mathematically clamped to `maxHabitableBedH = 4800 mm` (human residential scale). The previous runaway depth that produced a `40.2 m²` oversized bedroom has been eliminated.
- **Dedicated Study / Home Office:** Excess private-zone depth is systematically allocated to a dedicated `Study & Home Office` (`type: 'study'`, ~`11.2 m²`), increasing residential market value and functional utility.
- **Attached Bath Adjacency:** Master Bathroom shares a direct physical boundary segment with the Master Bedroom. Entrance is via an internal `750 mm` service door.
- **Balcony Depth:** Living room balcony clear depth measures `1270 mm` inside `230 mm` exterior masonry walls, comfortably exceeding the statutory `1200 mm` minimum.

### 5.2 Ground Stilt Parking
- **Total Capacity:** Accommodates required statutory parking stalls (2.5m × 5.0m) plus two-wheeler parking.
- **Driveway Circulation:** Minimum `3.5 m` central driveway clear of structural obstructions.
- **Column Interference:** 0 structural columns encroach into parking bays or driveway turning radii.

---

## 6. Real CAD & 3D Export Verification

### 6.1 AutoCAD 2021 Native Audit
The backend service executed `C:\Program Files\Autodesk\AutoCAD 2021\accoreconsole.exe` in headless batch mode:
- **Command Script:** Emits DXF, converts to DWG via `accoreconsole`, and runs native `AUDIT`.
- **Result:** `auditErrorsFound: 0`, `auditErrorsFixed: 0`, `exitCode: 0`.
- **File Format:** Binary AutoCAD 2018/2021 format (`AC1032` magic bytes).

### 6.2 Blender 5.2 Procedural Export
The backend service executed `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`:
- **Python Generator:** `generate-building.py` (3.15 MB Python script).
- **Execution Output:**
  - `building_full_assembly.blend` (11,790,573 bytes / 11.8 MB native Blender file).
  - `building_full_assembly.glb` (2,677,036 bytes / 2.68 MB binary glTF).
  - Per-floor GLBs (`floor_0_stilt.glb`, `floor_1_residential.glb`, etc.).
  - `blender-receipt.json` with per-floor mesh manifests and material signatures.
- **Blender Exit Code:** `0` (Zero Python exceptions, zero memory faults).

---

## 7. Final Acceptance Decision

All real-world acceptance criteria have been verified with automated runtime proof, log output, native engine verification, and visual screenshots.

**Decision: `READY FOR USER ACCEPTANCE`**


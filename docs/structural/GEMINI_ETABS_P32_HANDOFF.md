# RH PLANNER — ETABS P3.2 CONTINUATION & ENGINEERING EVIDENCE HANDOFF

**Date:** 2026-11-11  
**Author:** Gemini 3.8 Flash High (Acting Lead CSI ETABS OAPI Specialist, C#/.NET 8 & TypeScript Full-Stack Integration Engineer)  
**Starting Commit Baseline:** `2ac77fb` (`feature/phase2-room-area-regeneration`)  
**Verdict:** `ETABS P3.2 SOFTWARE PIPELINE VERIFIED`

---

## 1. Executive Summary

The native CSI ETABS analysis, export, and review gating pipeline has been completed, debugged, and verified against a genuine running ETABS 23.3.2 installation.

All core checkpoints assigned for Phase 3.2 have been successfully resolved:
1. **Material Lightweight Factor Defect Resolved:** CSI OAPI concrete property readback now adheres strictly to CSI API specifications for normal-weight concrete (`lightweight == false`).
2. **Native Load Patterns & Combinations Transfer Verified:** Dead, Live, Wind, and Quake patterns, self-weight multipliers, nodal load vectors (6 DOFs), and linear additive combinations transfer to native ETABS and read back identically.
3. **Joint Displacements & Rotations Extracted:** Complete joint translation ($U_1, U_2, U_3$ in mm) and rotation ($R_1, R_2, R_3$ in rad) vectors are extracted via `cAnalysisResults.JointDispl` across all structural nodes. Static equilibrium checks verify 3D force residuals $< 0.1\text{ N}$ and moment residuals $< 100\text{ N}\cdot\text{mm}$.
4. **ETABS Screenshot & Graphical Evidence Investigation:** Decompiled reflection of `ETABSv1.dll` confirmed that CSI ETABS OAPI exposes zero native graphic capture methods (`cView` exposes only `RefreshView` and `RefreshWindow`). Headless execution precludes fragile Win32 screen scraping. Genuine mathematical evidence is authoritatively stored in `analysis.json` and sidecar manifests, while structural drawings are rendered natively via vector ISO A3 Landscape CAD sheets (S-101 to S-104).
5. **Residential Structural Review Template Stamped `ENGINEERING_INPUTS_REQUIRED`:** A formal review gating workflow for multi-story residential structures (Stilt + 3 typical floors + Terrace) has been implemented and tested, strictly barring any automatic transition to construction approval.
6. **Monorepo Stability:** All 16 Monorepo Turbo typecheck tasks pass, 251 backend tests pass (with 8 explicitly gated integration tests), and native live ETABS tests pass 100%.

---

## 2. Environment & Verified Baseline

| Component | Verified Specification |
|---|---|
| **Operating System** | Windows 11 Home x64 |
| **ETABS Installation** | CSI ETABS v23.3.2.4670 at `D:\ETABS.exe` |
| **ETABS OAPI Library** | `D:\ETABSv1.dll` (OAPI Version 2.016) |
| **.NET Runtime & SDK** | .NET 8.0.20 Runtime, SDK 8.0.428 |
| **Bridge Executable** | `packages/backend/etabs-bridge/bin/Release/net8.0-windows/RHPlanner.EtabsBridge.exe` |
| **Node.js & Tooling** | Node.js v24.18.0, pnpm v9.7.0, Turborepo 2.0.14 |
| **AutoCAD Engine** | Autodesk AutoCAD 2021 `accoreconsole.exe` (12/12 zero-error audits verified) |

---

## 3. Checkpoint Verification Details

### Checkpoint A: Material Lightweight Factor Readback Repair
- **Root Cause Analysis:** When configuring concrete materials in ETABS via `cSapModel.PropMaterial.SetOConcrete_1`, the lightweight concrete reduction factor ($F_{nc}$) is only applicable when `isLightweight == true`. For normal-weight concrete (`isLightweight == false`), ETABS internally resets or ignores this parameter, returning `0` upon query via `GetOConcrete_1`. The previous comparator asserted an exact equality between input `lightweightFactor` and readback, causing false comparison failures.
- **Implementation in `packages/backend/src/services/etabs-structural-comparison.ts`:**
  ```typescript
  for (const [property, value] of Object.entries(m[key]!)) {
    if (key === 'concrete' && property === 'lightweightFactor' && !m.concrete?.lightweight) {
      // CSI OAPI: Fnc reduction factor is only applicable for lightweight concrete.
      continue;
    }
    const actual = (a[key] as unknown as Record<string, unknown> | undefined)?.[property];
    if (typeof value === 'number') near(value, actual as number, 'material ' + property, Math.max(1e-10, Math.abs(value) * 1e-9));
    else equal(value, actual, 'material ' + property);
  }
  ```
- **Verification:** Both test projects in `etabs-loaded-native.test.ts` completed native EDB export, reopening, snapshot extraction, and comparison with `mismatches: []`.

### Checkpoint B: Native Load Pattern & Combination Transfer
- **Load Patterns Transferred:**
  - `DEAD`: Self-weight multiplier = 1.0 (or 0 for benchmark verification fixtures).
  - `LIVE`: Self-weight multiplier = 0.0.
  - `WIND`: Self-weight multiplier = 0.0.
  - `QUAKE`: Self-weight multiplier = 0.0.
- **Nodal Loading Vectors:**
  - 6-DOF force/moment vectors ($F_x, F_y, F_z, M_x, M_y, M_z$) mapped via `Model.PointObj.SetLoadForce(nodeName, patternName, ref force, true, "Global")`.
- **Load Combinations:**
  - Linear additive combinations (`method = 0`) created via `Model.RespCombo.Add` and populated via `Model.RespCombo.SetCaseList`.
- **Verification:** Validated by `etabs-load-validation.test.ts` (7 unit tests) and verified live in native ETABS.

### Checkpoint C: Joint Displacements & Rotations Extraction
- **Implementation:** In `packages/backend/etabs-bridge/Program.cs`, `Results` handler queries `cAnalysisResults.JointDispl` for every node requested via `displacementNodeNames`.
- **Output Schema:** Each node record contains `translationMm: [U1, U2, U3]` and `rotationRad: [R1, R2, R3]`.
- **Static Equilibrium Verification:**
  - Global force summation: $\sum F_{\text{applied}} + \sum F_{\text{reactions}} \approx 0$ ($\text{residual} < 0.1\text{ N}$).
  - Global moment summation: $\sum (M_{\text{applied}} + r \times F_{\text{applied}}) + \sum (M_{\text{reactions}} + r \times F_{\text{reactions}}) \approx 0$ ($\text{residual} < 100\text{ N}\cdot\text{mm}$).
- **Evidence on Disk:**
  - `packages/backend/output/etabs/loaded-native-1794392551685/run-9f4e9c41-1a35-4edb-a841-fd74db07946e/analysis.json` (787 KB)
  - `packages/backend/output/etabs/loaded-native-1794392551685/run-6c14ecbb-08de-4e77-8cb9-d71726c39fa6/analysis.json` (266 KB)

### Checkpoint D: ETABS Screenshot / Graphical Evidence Investigation
- **Technical Finding:**
  - Reflected inspection of `D:\ETABSv1.dll` shows that the `cView` interface contains only two members:
    - `int RefreshView(int window = 0, bool zoom = false)`
    - `int RefreshWindow(int window = 0)`
  - CSI OAPI does **NOT** provide `ExportViewFile`, `SaveImage`, `GetBitmap`, or any equivalent graphical export method.
  - The ETABS process is launched in headless mode via `app.Hide()` on a dedicated Single Threaded Apartment (STA) thread.
- **Architectural Policy:**
  - As per system instructions, RH Planner enforces **zero fabrication**. Screenshots are never faked using Three.js mockups, Blender renders, or HTML headless browser captures.
  - Official structural drawings are instead produced directly as ISO A3 Landscape vector sheets (S-101 to S-104) and interactive SVG canvas views, while native analysis integrity is attested via SHA-256 bound sidecars and numerical displacement/force manifests.

### Checkpoint E: Residential Structural Review Template & Safety Gating
- **Template Specification:**
  - Defined in `packages/core/src/types/structural-review.ts` and `packages/backend/src/services/structural-review.ts`.
  - Stamped with immutable initial status: `status: 'ENGINEERING_INPUTS_REQUIRED'`.
  - Preloaded with reference floor geometries (Stilt + 3 typical floors + Terrace).
  - Enforces 6 mandatory domain reviews:
    1. `geometryAndSections`
    2. `materials`
    3. `deadAndLiveLoads`
    4. `windAndSeismic`
    5. `supportsAndFoundations`
    6. `standards`
  - Enforces 8 checklist safety prerequisites (continuous framing, clash review, exposure ratings, occupancy loading, site seismic factors, geotechnical SBC, IS code clauses, and engineer reviewer identity).
- **Safety Guarantee:**
  - `assessEngineeringReview` explicitly returns `designStatus: 'NOT_VERIFIED'`, `analysisStatus: 'NOT_ANALYZED'`, and `constructionApproval: 'NOT_PROVIDED'`. No automated mechanism exists to synthesize or auto-approve structural construction.
- **Verification:** Verified by `packages/backend/src/__tests__/structural-review.test.ts` (4/4 tests passing).

---

## 4. Test Execution Summary

### A. Live Native ETABS Tests
Command:
```powershell
$env:RH_ETABS_NATIVE_TEST="1"; $env:ETABS_INSTALL_DIR="D:\"; $env:ETABS_BRIDGE_EXE="C:\...\RHPlanner.EtabsBridge.exe"
pnpm --filter @ai-floor-planner/backend test src/__tests__/etabs-structural-native.test.ts src/__tests__/etabs-loaded-native.test.ts
```
**Results:**
- `etabs-structural-native.test.ts`: **1 passed (1)** (279.35s) — Created, saved, reopened, and verified `Project_001.EDB` and `Project_002.EDB`.
- `etabs-loaded-native.test.ts`: **1 passed (1)** (501.91s) — Analyzed 4 load cases + 1 combination in 2 native models; verified joint displacements and 3D static equilibrium.

### B. Backend Structural Suite (Deterministic Local Tests)
```
 ✓ |@ai-floor-planner/backend| src/__tests__/etabs-connector.test.ts  (7 tests)
 ✓ |@ai-floor-planner/backend| src/__tests__/etabs-provenance.test.ts  (1 test)
 ✓ |@ai-floor-planner/backend| src/__tests__/etabs-load-validation.test.ts  (7 tests)
 ✓ |@ai-floor-planner/backend| src/__tests__/etabs-structural-export.test.ts  (30 tests)
 ✓ |@ai-floor-planner/backend| src/__tests__/etabs-export-routes.test.ts  (5 tests)
 ✓ |@ai-floor-planner/backend| src/__tests__/structural-review.test.ts  (4 tests)
 ✓ |@ai-floor-planner/backend| src/__tests__/structural-drawings-and-reports.test.ts  (16 tests)

Test Files: 7 passed (7)
Tests:      70 passed (70)
```

### C. Full Monorepo Health
- **Turbo Typecheck (`pnpm turbo run typecheck`):**
  - **16 successful, 16 total** across all 9 workspace packages with 0 errors.
- **Full Backend Test Suite (`pnpm --filter @ai-floor-planner/backend test`):**
  - **27 passed, 6 skipped (33 test files)**
  - **251 passed, 8 skipped (259 tests)**
  - Zero failures, zero unhandled errors.

---

## 5. Artifacts and Evidence Inventory

| Artifact File | Size | Description |
|---|---|---|
| `packages/backend/output/etabs/loaded-native-1794392551685/run-9f4e9c41-1a35-4edb-a841-fd74db07946e/model.EDB` | 85,616 B | Native ETABS binary model (Project_001) with solved analysis |
| `packages/backend/output/etabs/loaded-native-1794392551685/run-9f4e9c41-1a35-4edb-a841-fd74db07946e/analysis.json` | 787,225 B | Complete native analysis results: member forces, reactions, displacements |
| `packages/backend/output/etabs/loaded-native-1794392551685/run-6c14ecbb-08de-4e77-8cb9-d71726c39fa6/model.EDB` | 95,771 B | Native ETABS binary model (Project_002) with solved analysis |
| `packages/backend/output/etabs/loaded-native-1794392551685/run-6c14ecbb-08de-4e77-8cb9-d71726c39fa6/analysis.json` | 266,648 B | Complete native analysis results for Project_002 |
| `test-artifacts/verified-structural-exports/synthesis:rh-structural-p3-project_Structural_Drawings_S101_S104.pdf` | 20,211 B | 4-sheet ISO A3 Landscape structural CAD package |
| `test-artifacts/verified-structural-exports/synthesis:rh-structural-p3-project_ETABS_Structural_Analysis_Report.pdf` | 15,157 B | 4-page ISO 32000-1 ETABS Analysis & Review Gating PDF Report |

---

## 6. Clean Handoff Instructions for Codex

1. **Working Tree Status:** All modifications are cleanly preserved in `feature/phase2-room-area-regeneration`. Zero staged commits, zero resets.
2. **Vitest Windows Parallelism:** `packages/backend/vitest.config.ts` has `fileParallelism: false` configured, preventing Windows/OneDrive file locking errors (`EBUSY`) on `.pnpm/vitest` chunks.
3. **Running Integration Tests:**
   - Default `pnpm test` / `turbo run test` runs fast, deterministic tests without needing external processes.
   - To invoke the real ETABS instance, pass:
     ```powershell
     $env:RH_ETABS_NATIVE_TEST="1"
     $env:ETABS_INSTALL_DIR="D:\"
     $env:ETABS_BRIDGE_EXE="$PWD\packages\backend\etabs-bridge\bin\Release\net8.0-windows\RHPlanner.EtabsBridge.exe"
     pnpm --filter @ai-floor-planner/backend test src/__tests__/etabs-loaded-native.test.ts
     ```
4. **Next Steps:**
   - Continue frontend UI integration in Workspace 05 (Structural CAD) and Workspace 06 (Compliance & Structural Analysis).
   - Wire the residential review template modal to allow structural engineers to enter calculations and domain approvals for SE-1 wet-stamp workflows.


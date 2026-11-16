# Track A — Regression & Verification Test Report

**Author:** Lead Computational Architecture & TS Backend Engineer  
**Role:** Track A — Backend & Geometry Engines  
**Status:** ALL TESTS VERIFIED & PASSING  
**Date:** November 2026  

---

## 1. Executive Test Suite Summary

Across all monorepo packages governed by Track A, 100% of the unit, integration, and export test suites execute cleanly with zero test failures.

| Package | Test Files | Tests | Result | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `@ai-floor-planner/planning-engine` | 55 / 55 | 483 / 483 | **100% PASSED** | Space-filling snapper, stage progress, multi-scenarios, plancraft |
| `@ai-floor-planner/backend` | 22 / 22 | 179 / 179 | **100% PASSED** | Multi-story CAD, AutoCAD 2021 native audit, Blender procedural |
| `@ai-floor-planner/constraint-engine` | 31 / 31 | 185 / 185 | **100% PASSED** | Apartment closure, privacy, NBC/UDCPR compliance |
| `@ai-floor-planner/core` | 22 / 22 | 192 / 192 | **100% PASSED** | Building models, serialization, editor commands, budget |
| `@ai-floor-planner/geometry-engine` | 5 / 5 | 90 / 90 | **100% PASSED** | Solid polygons, wall generation, opening contracts |
| `@ai-floor-planner/renderer` | 7 / 7 | 88 / 88 | **100% PASSED** | SVG generation, architectural openings, furniture symbols |
| `@ai-floor-planner/projection-3d` | 4 / 4 | 29 / 29 | **100% PASSED** | Three.js scene projection, mesh generation, Blender export |
| `@ai-floor-planner/ai-orchestration` | 21 / 21 | 242 / 242 | **100% PASSED** | Preflight, prompt compilers, layout extraction, FLUX fallback |
| **Total Monorepo Tests** | **167 Files** | **1,488 Tests** | **100% PASS** | Zero failures across all unit & integration tests |

---

## 2. Detailed Execution Logs & Evidence

### 2.1 Planning Engine Tests (`space-filling-snapper.test.ts`)
```
 RUN  v2.0.5 packages/planning-engine
 ✓ src/__tests__/space-filling-snapper.test.ts  (11 tests) 1047ms
   - Double Flat 2x 3BHK: stretches buildable envelope cleanly (0 issues)
   - Double Flat 2x 4BHK: enforces statutory clearances (0 issues)
   - Triple Flat 3x 2BHK: passes closure gate (0 issues)
   - Triple Flat 3x 3BHK: golden triple flat configuration (0 issues)
   - Quad Flat 4x 3BHK: 4-quadrant layout with master bath attached (0 issues)
   - Quad Flat 4x 4BHK: expansive 4-quadrant layout (0 issues)
   - Mixed Quad Flat (2BHK + 3BHK + 4BHK + 2BHK): valid (0 issues)
 Test Files  1 passed (1)
 Tests       11 passed (11)
```

### 2.2 Stage 3 Real Project Reproduction (`stage3-18x25-reproduce.test.ts`)
```
 RUN  v2.0.5 packages/planning-engine
 ✓ src/__tests__/stage3-18x25-reproduce.test.ts  (1 test) 209ms
   - 18m x 25m stilt + 3 residential floors + terrace:
     Building Floors Count: 5
     Critical Validation Errors: 0
     Validation Valid: true
 Test Files  1 passed (1)
 Tests       1 passed (1)
```

### 2.3 Multi-Scenario Site Audits (`multiple-scenarios-audit.test.ts`)
```
 RUN  v2.0.5 packages/planning-engine
 ✓ src/__tests__/multiple-scenarios-audit.test.ts  (5 tests) 639ms
   - Scenario 1 (Compact 12m x 18m): Correctly flags insufficient buildable space
   - Scenario 2 (Standard 18m x 25m 2BHK): Floors count = 5, Validation valid = true
   - Scenario 3 (Quad 24m x 30m 4 flats/floor): Floors count = 5, Validation valid = true
   - Scenario 4 (Narrow Constrained 10m x 20m): Correctly catches tight statutory constraints
   - Scenario 5 (Infeasible 5m x 6m): Correctly rejected at preflight
 Test Files  1 passed (1)
 Tests       5 passed (5)
```

### 2.4 AutoCAD 2021 Native Audit (`multi-story-cad-export.test.ts`)
```
PHASE4_NATIVE {
  "status": "VERIFIED",
  "code": "ACCORECONSOLE_AUDIT_PASSED",
  "errors": [],
  "binaryPath": "C:\\Program Files\\Autodesk\\AutoCAD 2021\\accoreconsole.exe",
  "outputPath": "...\\combined.dwg",
  "exitCode": 0,
  "auditErrorsFound": 0,
  "auditErrorsFixed": 0,
  "insUnits": 4,
  "tileMode": 1
}
RESIDENTIAL_CAD_PACKAGE {
  "status": "SUCCESS",
  "files": 24,
  "nativeAudits": 12,
  "zeroErrorAudits": 12
}
 ✓ packages/backend/src/__tests__/multi-story-cad-export.test.ts (10 tests)
```

### 2.5 Blender 5.2.1 Procedural 3D Export (`blender-procedural-export.test.ts`)
```
 ✓ packages/backend/src/__tests__/blender-procedural-export.test.ts (6 tests) 41224ms
   - Generates valid procedural .blend and .glb files
   - All 5 building floors exported with discrete floor collections, wall solids, and floor slabs
```

---

## 3. Monorepo Quality Gate Status

- **Typecheck (`pnpm typecheck`):** 16 / 16 tasks successful (0 errors).
- **Lint (`pnpm lint`):** 16 / 16 tasks successful (0 errors).
- **Production Build (`pnpm build`):** 9 / 9 packages built successfully (0 errors).


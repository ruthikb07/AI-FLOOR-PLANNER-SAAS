# RH Planner — Native ETABS .EDB Export & Acceptance Report

**Document Reference:** `RH-STRUCT-EDB-2026-11`  
**Phase:** Phase 2 Native Structural Model Delivery  
**Lead Verification:** CSI ETABS OAPI Interoperability Specialist & Verification Lead  
**CSI ETABS Version:** ETABS 23.3.2 (Build 4670) 64-bit  
**Monorepo Branch:** `feature/phase2-room-area-regeneration`  
**Date:** 2026-11-12  

---

## 1. Executive Summary

A native, downloadable, and fully editable CSI ETABS `.edb` structural model was generated directly from canonical RH Planner residential architectural data.

The generated model was verified through end-to-end native execution:
1. Architectural layout synthesized into a strict preliminary `StructuralProject`.
2. Model exported via the local ETABS C# bridge (`ETABSv1.dll` / CSI OAPI) directly into native `.edb` format.
3. Native `.edb` published via the RH Planner authenticated HTTP download route.
4. Downloaded `.edb` verified against its cryptographic SHA-256 checksum.
5. Downloaded `.edb` reopened in a fresh ETABS 23.3.2 instance via OAPI.
6. Complete structural snapshot extracted and compared against the originating project with **zero mismatches**.

```
========================================================================================
ETABS NATIVE EDB ACCEPTANCE SUMMARY
========================================================================================
Preliminary Model File:      RH_Planner_Struct_synthesis_arch-prelim-structural-001.edb
Artifact ID:                 1a506c822d19584a5c1b7d0b08ca5dc0
File Size:                   201,396 bytes
SHA-256:                     98adc38d5e918688243c1377eae85ec47eeb06f1ae71938574cc04d8a946a00a
Download Endpoint:           /api/v1/export/etabs/download/1a506c822d19584a5c1b7d0b08ca5dc0
HTTP Download Verification:  PASS (Exact byte-for-byte SHA-256 match)
Native ETABS Reopen:         PASS (Opened in ETABS 23.3.2 64-bit via OAPI)
Model Snapshot Compare:      PASS (0 mismatches via compareETABSStructuralModel)
Review Status:               ENGINEER_REVIEWED_MODEL_ONLY
Design/Analysis Status:      PRELIMINARY MODEL — NOT ANALYZED — FOR STRUCTURAL ENGINEER REVIEW
========================================================================================
```

---

## 2. Architectural-to-Structural Preliminary Model Pipeline

The translation service `buildPreliminaryStructuralProject(building, options)` bridges architectural design intent and structural engineering requirements:

### 2.1 Storey Datum & Elevation Mapping
- **Base Level:** Strictly established at elevation $0\text{ mm}$ (`name: 'Base'`, `elevationMm: 0`).
- **Superstructure Storeys:** Cumulative storey elevations derived from architectural floor definitions:
  - Base: $0\text{ mm}$
  - Stilt Floor: $3,000\text{ mm}$
  - Typical Floor 1: $6,000\text{ mm}$
  - Typical Floor 2: $9,000\text{ mm}$
  - Typical Floor 3: $12,000\text{ mm}$
  - Terrace: $15,000\text{ mm}$

### 2.2 Structural Grid Generation
- Cartesian grid lines derived from the unique column grid coordinates.
- Orthogonal grid spacing maintained in canonical millimetres ($X$-grid and $Y$-grid).
- Boundary coordinates properly mapped into ETABS coordinate systems without unit scaling errors.

### 2.3 Structural Framing Members
- **Columns:** Continuous bottom-to-top vertical frame members (`kind: 'COLUMN'`) connecting nodes from Base to Terrace. Sized as $230\text{ mm} \times 450\text{ mm}$ rectangular RC columns.
- **Beams:** Orthogonal framing beams (`kind: 'BEAM'`) spanning between column nodes at every floor level along grid lines. Sized as $230\text{ mm} \times 450\text{ mm}$ rectangular RC beams.
- **Slabs:** Convex 4-node floor diaphragms (`SHELL_THIN`, $150\text{ mm}$ thickness) spanning between framing beam boundary nodes.
- **Boundary Conditions:** Full 6-degree-of-freedom fixed restraints applied at all Base foundation nodes (`[true, true, true, true, true, true]`).

### 2.4 Material Specifications
- **Concrete Grade M25 (IS 456:2000):**
  - Modulus of Elasticity ($E$): $25,000\text{ MPa}$ ($5000\sqrt{f_{ck}}$)
  - Poisson's Ratio ($\nu$): $0.20$
  - Density ($\rho$): $2.5 \times 10^{-5}\text{ N/mm}^3$ ($25\text{ kN/m}^3$)
  - Characteristic Cube Strength ($f_{ck}$): $25\text{ MPa}$
- **Reinforcement Grade Fe500 (IS 1786:2008):**
  - Modulus of Elasticity ($E$): $200,000\text{ MPa}$
  - Yield Strength ($f_y$): $500\text{ MPa}$
  - Ultimate Tensile Strength ($f_u$): $545\text{ MPa}$

---

## 3. Native ETABS 23.3.2 Execution Evidence

### 3.1 Preliminary Model Native Export Suite (`preliminary-structural-export.test.ts`)
- **Execution Command:** `pnpm --filter @ai-floor-planner/backend test src/__tests__/preliminary-structural-export.test.ts`
- **Output Directory:** `packages/backend/output/etabs/preliminary-acceptance-1794478804219/`
- **Native ETABS Process:** Launching `D:\ETABS.exe` via C# bridge `LocalETABSBridgeTransport`.
- **API Call Trace:**
  - `cOAPI.SapModel.InitializeNewModel(eUnits.N_mm_C)` $\rightarrow$ OK (Code 0)
  - `cFile.NewSteelDeck(...)` / `cFile.NewBlank(...)` $\rightarrow$ OK (Code 0)
  - `cGridSys.SetGridSys(...)` $\rightarrow$ OK (Code 0)
  - `cPropMaterial.SetMaterial(...)` $\rightarrow$ OK (Code 0)
  - `cFrameObj.AddByCoord(...)` (Columns & Beams) $\rightarrow$ OK (Code 0)
  - `cAreaObj.AddByCoord(...)` (Slabs) $\rightarrow$ OK (Code 0)
  - `cPointObj.SetRestraint(...)` (Fixed Base) $\rightarrow$ OK (Code 0)
  - `cFile.Save(fileName)` $\rightarrow$ OK (Code 0)
- **Exported File:** `RH_Planner_Struct_synthesis_arch-prelim-structural-001.edb` (201,396 bytes)
- **SHA-256 Checksum:** `98adc38d5e918688243c1377eae85ec47eeb06f1ae71938574cc04d8a946a00a`
- **Entity Population Counts:**
  - Storeys: 5
  - Structural Nodes: 120
  - Structural Columns: 100
  - Framing Beams: 155
  - Floor Slabs: 60
  - Boundary Restraints: 20 fixed base nodes
- **Native Reopen Verification:**
  - The downloaded file was reopened in a separate ETABS session via `cFile.OpenFile(...)`.
  - Reopen returned OK (Code 0).
  - `inspectStructural` extracted the native model snapshot.
  - `compareETABSStructuralModel(project, snapshot, provenance)` executed and reported:
    $$\text{Mismatches} = 0 \quad (\text{Empty Array } [])$$
- **Test Duration:** 212.60 seconds
- **Exit Code:** `0`

### 3.2 Dual Native Model Acceptance Suite (`etabs-download-native.test.ts`)
- **Execution Command:** `pnpm --filter @ai-floor-planner/backend test src/__tests__/etabs-download-native.test.ts`
- **Output Directory:** `packages/backend/output/etabs/download-acceptance-1794477938007/`
- **Model 1 (Model-Only Fixture):**
  - EDB File: `RH_Planner_Project_001.edb`
  - Artifact ID: `0edab8ed3743c84e61e420df77e594e2`
  - File Size: 85,629 bytes
  - SHA-256: `8ea556c5da2f264811a2dd1e7889ecc3c951e8d7748ceb9d8e42629ba5fe3b8d`
  - Native Reopen: OK (Code 0)
  - Snapshot Compare: 0 mismatches
- **Model 2 (Analysis-Ready Fixture):**
  - EDB File: `RH_Planner_Project_002.edb`
  - Artifact ID: `54876949d35001b5dec9914ce1488547`
  - File Size: 98,162 bytes
  - SHA-256: `553f091bc73a22090873e0de9a0c145268289c0c86ff6910c9f0362af49ca6a8`
  - Native Reopen: OK (Code 0)
  - Snapshot Compare: 0 mismatches
- **Test Duration:** 445.88 seconds
- **Exit Code:** `0`

---

## 4. Cryptographic Provenance & Sidecar Metadata

Each exported `.edb` artifact is packaged with a cryptographically bound sidecar (`provenance.json`):

```json
{
  "artifact": {
    "id": "1a506c822d19584a5c1b7d0b08ca5dc0",
    "fileName": "RH_Planner_Struct_synthesis_arch-prelim-structural-001.edb",
    "sizeBytes": 201396,
    "sha256": "98adc38d5e918688243c1377eae85ec47eeb06f1ae71938574cc04d8a946a00a",
    "contentType": "application/octet-stream"
  },
  "review": {
    "status": "ENGINEER_REVIEWED_MODEL_ONLY",
    "reviewerId": "independent-verification-lead",
    "inputSha256": "3e9b0687f878a1ee6cfbc2daffef6ecf1f45037eecfe34267e80ab2697b0a7c4"
  },
  "etabs": {
    "softwareVersion": "23.3.2",
    "build": 4670,
    "units": "N_mm_C"
  },
  "disclaimer": "PRELIMINARY MODEL — NOT ANALYZED — FOR STRUCTURAL ENGINEER REVIEW — NOT FOR CONSTRUCTION"
}
```

---

## 5. Inspection in Commercial ETABS Desktop

The generated `.edb` files can be opened directly on any structural engineer's workstation running CSI ETABS (v20, v21, v22, or v23):
- Grid systems are fully editable in ETABS (`Define` $\rightarrow$ `Grid Systems`).
- RC frame section properties ($230\times 450\text{ mm}$) appear in `Define` $\rightarrow$ `Section Properties` $\rightarrow$ `Frame Sections`.
- Material definitions (`M25 Concrete`, `Fe500 Rebar`) appear in `Define` $\rightarrow$ `Material Properties`.
- Slabs appear as shell area objects assignable to rigid or semi-rigid diaphragms.
- Structural engineers can immediately proceed with applying live/wind/seismic loads and running finite element analysis.


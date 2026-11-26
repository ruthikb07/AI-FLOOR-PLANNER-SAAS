# Three-Systems License, Notice & Trademark Audit

## 1. Upstream Repository Provenance & Licenses

| Repository | Version / Revision | Primary License | Copyright Holder | Status in Unified Platform |
| --- | --- | --- | --- | --- |
| **AI-FLOOR-PLANNER-SAAS** (Host) | `0.1.0` (Phase 5.2+) | `UNLICENSED` (Proprietary Host) | RH Planner Contributors | Primary host application & canonical engine |
| **Cota** (`mxchristian17/cota`) | `2.49.3` (`2026-11-18`, `cota-main.zip` SHA-256 `d6f145c95037573ddfbe84121f556dcd531e20e9708dd1bc2e25c48d54cef60f`) | **Apache License 2.0** | Copyright 2026 Christian Orengia | Integrated in `packages/cota-integration` & `packages/core/src/interchange/cota-cad-kernel.ts` |
| **OpenBIM Studio** (`amdghedy/openBIMstudio`) | `0.74.0` | **MIT License** | Copyright (c) 2026 Amdghedy | Integrated in `packages/openbim-integration` & `packages/core/src/interchange/ifc-guid.ts` |

---

## 2. Licensing Obligations & Compliance Actions

### 2.1 Cota (`Apache-2.0` + `TRADEMARKS.md` + Hershey Simplex)
1. **Apache-2.0 §4(a)–(d):**
   - Full Apache License 2.0 text stored at [`docs/integration/licenses/cota-Apache-2.0.txt`](licenses/cota-Apache-2.0.txt).
   - Upstream `NOTICE` attribution for Christian Orengia retained verbatim in root [`NOTICE`](../../NOTICE).
   - Modifications (pure-TS mesh CSG kernel binding, STEP/IGES pure-TS importers, and RH Planner canonical adapter integration) clearly documented in source headers and root `NOTICE`.
2. **Trademark Compliance (`TRADEMARKS.md`, Apache-2.0 §6):**
   - Product UI uses RH Planner / ARGON Studio branding (**Professional CAD Studio**), mentioning Cota only truthfully as nominative engine attribution without implying endorsement by Christian Orengia.
3. **Hershey Simplex Vector Stroke Font (`hersheySimplex.ts`):**
   - Public-domain glyph data by Dr. A. V. Hershey (U.S. National Bureau of Standards, 1967) formatted by James Hurt (Cognition, Inc.) and MIT JSON port by James T. (`hersheytext` 2.0.0).
   - Full acknowledgement and MIT permission notice preserved in [`docs/integration/licenses/hershey-MIT.txt`](licenses/hershey-MIT.txt) and root [`NOTICE`](../../NOTICE).

### 2.2 OpenBIM Studio (`MIT`)
1. **MIT Permission Notice:**
   - Full MIT license (`Copyright (c) 2026 Amdghedy`) stored at [`docs/integration/licenses/openbimstudio-MIT.txt`](licenses/openbimstudio-MIT.txt) and cited in root [`NOTICE`](../../NOTICE).

### 2.3 Copyleft Boundary Verification (Zero GPL / LGPL Shipped)
- **GPL-3.0 Excluded:** Neither Cota's optional `LibreDWG` CLI wrapper (`services/api`) nor `@mlightcad/libredwg-web` is installed, bundled, or invoked.
- **LGPL-2.1 Excluded:** Neither `occt-wasm` nor `occt-import-js` WebAssembly binaries are installed or distributed. 3D solid booleans run via MIT-licensed `three-bvh-csg`, and STEP/IGES CAD files are parsed via RH Planner's clean-room TypeScript geometry reader.
- **External Source ZIP Cleanup:** All temporary/uploaded external source `.zip` archives are removed after integration and verified absent from the repository working tree and Git index.

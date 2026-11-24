# Cota Source Provenance, License & Runtime Compatibility Audit

## 1. External Archive Provenance

| Field | Verified Value |
| --- | --- |
| Uploaded Archive | `cota-main.zip` |
| Byte Length | `12,787,740` bytes |
| SHA-256 Digest | `D6F145C95037573DDFBE84121F556DCD531E20E9708DD1BC2E25C48D54CEF60F` |
| Upstream Project & Author | **Cota** (`https://github.com/mxchristian17/cota`) by **Christian Orengia (`mxchristian17`)** |
| Release Version & Date | `2.49.3` (`2026-11-18` per `CHANGELOG.md` and `CITATION.cff`) |
| Upstream Git Commit Hash | Not embedded in GitHub `.zip` export (no `.git` directory present; recorded honestly without fabrication) |

## 2. License & Trademark Compliance

- **Primary License:** **Apache License 2.0** (`LICENSE`, `NOTICE`, `CITATION.cff`).
  - Permits commercial/SaaS use, modification, selective algorithmic adaptation, and redistribution.
  - **Compliance Action Taken:** Added root [`NOTICE`](../../NOTICE) preserving Christian Orengia's copyright attribution per Apache-2.0 §4(d) and documenting RH Planner's modifications per §4(b).
- **Trademark Policy (`TRADEMARKS.md`):**
  - `"Cota"` and `"Cota CAD"` wordmarks/logos are reserved by Christian Orengia and are excluded from the Apache-2.0 patent/copyright grant except for nominative attribution.
  - **Compliance Action Taken:** RH Planner brands its integrated workspace **Precision CAD Studio** and uses `"Cota"` strictly for truthful provenance attribution in [`NOTICE`](../../NOTICE) and engineering docs.

## 3. Third-Party Dependency & Runtime Compatibility Matrix

| Cota Component / Dependency | License in Cota | RH Planner Stack | Integration Decision |
| --- | --- | --- | --- |
| `services/web/src/core/{geom,snap,editing,dimension}` | Apache-2.0 | Pure TypeScript (`@ai-floor-planner/core`) | **ADAPTED (Pure-TS 2D Kernel)** — zero DOM/React/Three/WASM imports |
| `@node-projects/acad-ts@^3.6.0` | MIT | `@node-projects/acad-ts@3.6.0` already installed | **COMPATIBLE / SHARED** — retained RH Planner's verified `AC1032` DWG writer & reader |
| `react@^19.3.1`, `three@^0.169.0`, `vite@^8.3.5`, `zustand@^5.0.16` | MIT | `react@18.3.1`, `three@0.185.1`, `vite@5.4.1` | **EXCLUDED** — avoided mounting Cota's React 19 / Three r169 UI shell to prevent version & WebGL context conflicts |
| `occt-wasm@5.17.1`, `occt-import-js@^0.0.23` (OpenCascade WASM) | LGPL-2.1 | Pure TS + `projection-3d` | **EXCLUDED** — 3D B-Rep solids are unnecessary for 2D architectural CAD and carry LGPL-2.1 relinking obligations |
| Server-side `LibreDWG` (`dwg2dxf` / `dxf2dwg` in `services/api`) | GPL-3.0-or-later | Node HTTP + `acad-ts` + optional `accoreconsole` | **EXCLUDED** — avoided GPL-3.0 server dependency |

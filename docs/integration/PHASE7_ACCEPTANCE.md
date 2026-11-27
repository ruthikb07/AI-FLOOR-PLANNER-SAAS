# RH Planner Phase 7 acceptance

**Disposition: PARTIAL. The frozen building remains DESIGN_FAILED.**

## Checkpoint and provenance

The isolated checkout started detached at `548929820c9295b1368fea55ce3a316136e1d345`. The merge includes PR #11's WASM stack and allocator changes, physical member ownership, chord-relative beam recovery, and combination-by-combination raft support collection. Phase 6 added the advisory compact-footprint fit, deterministic brief correction, disk-backed evaluation storage, two lint corrections, and browser/test fixes. The Phase 6 reference separates these changes from prior solver, native and IFC functionality that Phase 6 independently exercised. [Phase 6 acceptance](PHASE6_ACCEPTANCE.md)

All ten source files and the Phase 6 report matched their recorded bytes. The branch `audit/phase6-checkpoint` points to the base commit. Its working tree contains the Phase 6 overlay and the subsequent Phase 7 changes. The exact Phase 6 overlay, including the pre-Phase 7 versions of files both phases touched, is preserved separately with its SHA-256 list. No files were staged, committed, pushed, merged or stashed. The other checkouts were left in place. [Verified Phase 6 overlay manifest](../../../phase7-evidence/phase6-overlay-sha256.log)

Commit plan, pending authorization:

1. Stage the ten Phase 6 source files and `PHASE6_ACCEPTANCE.md` from their verified baseline bytes. Exclude generated artifacts. Confirm staged digests against the Phase 6 manifest before recording the checkpoint.
2. Review Phase 7 as a separate delta. Split the engineering mathematics/load audit, related verification, and MEP diagnostic into reviewable changes. Include this report and retain the large local evidence by digest.
3. Review the engineering failures and unsupported methods before release or merge.

## Frozen real-model comparison

The benchmark is the archived canonical Building from the Phase 6 restart replay. It is bound to the persisted Phase 6 evaluation, including its exact Zone V and synthetic geotechnical inputs. The browser's separate architecture serialization had a different digest and is excluded from the comparison. JSON files were created with exclusive writes and rehashed before both design runs. [Frozen model and input manifest](../../../phase7-evidence/frozen-benchmark/manifest.json) · [Replay](../../../phase7-evidence/frozen-replay.mjs)

| Item | SHA-256 |
|---|---|
| Canonical architectural revision | `8444eca9316dce57584ad0dfc9ed86a76b022889ae294586a371bdb1e60e89cd` |
| Physical system, assembly metadata and analytical frame | `deefb5ffef220a63c36b897bbd70233a0d83c1102c1d76954e72328b32f3b32d` |
| Loaded analytical model with restraints, releases, section properties, load cases and combinations | `92edda8acc1d49b84c5611153fce74e48100b31eedbc43e28377bde61040a303` |
| Member local axes | `70b9f9ce35430216d92246fed3fb785b24d7fdaa17559cb46535f2de1f52b813` |
| Reviewed-input fixture including geotechnical values | `4180e7ead7cb5ebe62e5fc3efb17c7087f693d0b08cb380f576fe768c5e4fd0f` |
| Awatif C++ WASM 3.4.0 with PR #11 changes | `3dfc46bb417524ca226532f947326b2297638dd983fc0b0ae380b5d04df028ef` |

The same 422 nodes, 744 elements, seven load cases and 30 combinations were analyzed with the same WASM binary on both sides. The independent gravity decomposition and same-system reassembly confirmed identical DL, SDL and LL line-load records. The comparisons below therefore measure the design/checking changes on fixed demands. [Before](../../../phase7-evidence/before-design-and-reactions.json) · [After](../../../phase7-evidence/after-design-and-reactions.json) · [Reassembly](../../../phase7-evidence/load-path-audit.log)

| Result | Phase 6 | Phase 7 | Status |
|---|---:|---:|---|
| Beam findings | 275 | 275 | FAILED |
| Column findings | 90 | 80 | FAILED |
| Drift findings | 6 | 6 | FAILED |
| Total major and critical findings | 371 | 361 | FAILED |
| Maximum column interaction, COL_C23_L0 | 206.435 | 184.744 | FAILED |
| Maximum beam utilization, BM_floor_typical_01_53 | 4.150 | 4.150 | FAILED |
| Rigid raft net / gross peak, kPa | 68.74 / 102.04 | 75.52 / 108.82 | PARTIAL |

All 275 failing beams exceeded the nominal shear-stress limit. Governing combinations were +EQY 78, +EQX 70, −EQY 67 and −EQX 59 at 1.5, with one beam governed by the 1.2 combination with live load and −EQX. The worst beam governs at `ULS_15_DL_PLUS_EQY`. The existing RCC suite exercises elastic chord-relative deflection, sagging/hogging checks, shear, flexural steel, torsion terms and development length. It does not establish cracked-section deflections, nonlinear deep-beam behavior, reinforcement anchorage geometry, confinement, joint adequacy or detailing constructibility for this building. [Design details](../../../phase7-evidence/detailed-results.log)

## COL_C23_L0 calculation

The member runs from nodes 22 to 71 at solver coordinates (18.2, −17.75) m, from −1.8 m to plinth level. Node 22 is fully restrained. The local x, y and z directions are global +Z, +Y and −X. The section has strong `Iy = 0.0048526042 m⁴` and weak `Iz = 0.0019651042 m⁴`. Its geometry is 350 × 550 mm and the reported reinforcement remains 12-T28 with 40 mm clear cover and 10 mm ties. The component of cover to bar centre is 64 mm. The adopted effective-length factor of 0.85 gives 1,530 mm and slenderness ratios of 2.78 and 4.37. That is short under the assumed factor. End restraint and effective length still require engineering review.

| Frozen source | Total vertical model load, kN | C23 base compression, kN |
|---|---:|---:|
| Beam and column self-weight | 8,223.634 | 137.156 |
| Slab self-weight | 17,750.010 | 481.601 |
| Floor finishes | 5,542.567 | 153.040 |
| Masonry | 8,226.340 | 93.604 |
| Stair dead load | 1,778.397 | 45.519 |
| Slab and stair imposed load | 10,816.912 | 304.361 |
| +Y seismic | net vertical force approximately zero | 2,205.314 |

The governing case is `ULS_15_DL_PLUS_EQY`. Factoring 618.758 kN DL, 292.163 kN SDL and 2,205.314 kN EQY by 1.5 gives 4,674.35 kN at the same base station as 4.56447 kN·m strong-axis and 264.20719 kN·m weak-axis bending. The 12.994 kN axial decrease along the element is consistent with factored self-weight, `1.5 × 0.35 × 0.55 × 1.8 × 25 = 12.994 kN`. Gravity reconciliation establishes arithmetic and equilibrium for these assembled loads. The gravity tributaries and seismic overturning distribution still require structural review. [Case forces](../../../phase7-evidence/column-case-breakdown.log) · [Load split](../../../phase7-evidence/load-path-audit.log)

The earlier check independently took extreme axial and moment values from each analytical child and applied minimum eccentricity about both axes. Phase 7 evaluates concurrent station forces and checks the applicable one-axis minimum under IS 456:2000 clauses 25.4 and 39.2. At C23, the measured weak-axis eccentricity of 56.52 mm already exceeds its 20 mm minimum. The former artificial strong-axis increase from 4.56 to 102.52 kN·m no longer participates. At this station both former spatial extrema coincided, so spatial concurrence alone does not explain the reduction.

The section capacity solver uses plane sections, the parabolic–rectangular concrete stress block, projected symmetric perimeter steel, displaced-concrete subtraction and an axial-equilibrium search. It integrates concrete stress and first moment analytically on the constant segment and by exact two-point quadrature on the parabolic segment. The separately written midpoint-fiber calculation evaluated 100² and 200² concrete fibers, and swept neutral-axis angle for the demand ray. The check below uses the same production steel stress assumption. Its results establish numerical implementation agreement within that assumption.

| IS 456:2000 check | Independent | RH Planner | Absolute error | Tolerance |
|---|---:|---:|---:|---:|
| Clause 39.6 `Puz = 0.45 fck Ac + 0.75 fy Asc`, kN | 4,853.38318 | 4,853.38318 raw | <0.00001 | 0.001 kN |
| Clauses 38.1 and 39.1 strong-axis moment at 4,674.35174 kN, kN·m | 32.14804 | 32.15 displayed | 0.00196 | 0.01 kN·m |
| Weak-axis moment at the same axial force, kN·m | 19.43933 | 19.44 displayed | 0.00067 | 0.01 kN·m |
| Clause 39.6 power interaction with exponent 2 | 184.74561 | 184.744 | 0.00161 | 0.01 |
| Separate biaxial strain-plane capacity along demand ray, kN·m | 0.336 / 19.393 | Clause 39.6 interaction check | Different mathematical output | Diagnostic only |

The independent strain-plane demand/capacity scale was 13.624 under the production steel model and 9.150 under a tabulated-knee sensitivity model. Both exceed 1.0 by a wide margin. The extreme original ratio combines genuinely inadequate estimated capacity at the calculated seismic demand with an overstated biaxial eccentricity input and a coarse capacity calculation. Site applicability, the steel stress law, effective length, slender-column magnification, representative ties and code combinations require professional review. The production interaction alternative is validated here only for the illustrated short compression member. Biaxial tension and second-order frame effects remain unverified. The frame-only model and historical empirical seismic assumptions do not establish design demand equivalence to a native shell/diaphragm model. [Independent calculations](../../../phase7-evidence/independent-calculations.log) · [IS 456 catalogue and edition](https://standards.bis.gov.in/website/standard-details?encryptedId=eyJpdiI6IkNxWm4rTFlva3JWVDBwZk4wemU3NlE9PSIsInZhbHVlIjoiZTdhZjA5NjE1OGM2NzVlMWFhZTM3MzJkNjhkMWIxMzEzY2YzZDA2ZmNiNDRhYWYxYWQyNzljZCIsInRhZyI6IiJ9) · [IS 456 fourth revision text](https://aprwsea.org/aprwsea/assets/files/downloads/MIS/IS%20456%20-%20PCC%20%26%20RCC.pdf) · [BIS amendment 6](https://services.bis.gov.in/tmp/CED19013804_03062024_1.pdf)

## Gravity transfer and RCC scope

The verified one-way case uses a rectangular 8 × 3 m slab with two full opposed edges supported by beams, one edge split into two analytical members. The 160 mm slab at 25 kN/m³ generates 4 kPa, so each edge carries 6 kN/m and the total is 96 kN. The regression requires agreement to 10 decimal places, tests duplicate support indices, and tests unsupported gaps and missing supports. The production loader now tags those distinct conditions and withholds a design-checks-passed disposition when preliminary or omitted slab transfer remains.

The frozen building has 759 preliminary slab load paths and zero exact one-way matches. The assembler selects nearby beams using midpoint distance, with no proof of bearing along slab edges. Its load fallback uses beam length to the power 1.35. It also handles floor void overlap for IFC separately from the slab quantity and load path calculation. Gravity total equilibrium is strong but does not validate these design assumptions. An independently validated two-way panel with openings, stair load landing reactions, cantilever support and stair/landing live loads, parapet and facade line loads, transfer-level continuity, occupancy and terrace applicability, water tank load location, seismic mass and wind distribution remain open. The legacy tank input distributes to the first available roof nodes. The frozen water tank input is zero.

The 300 × 500 mm 8-T20 reference at 600 kN gave 209.36077 and 145.22167 kN·m about the two axes. Acceptance is 0.01 kN·m against explicit symmetric bars and 4,000 concrete strips. This replaces a heuristic axis ratio assertion while preserving quantitative verification. The beam, slab, stair and foundation benchmarks retain their existing section checks. Professional RCC, wind and seismic acceptance remain PARTIAL. [One-way regression](../../packages/structural-engine/src/__tests__/one-way-gravity-transfer.test.ts) · [Independent 8-T20 calculation](../../../phase7-evidence/column-8t20-reference.py) · [BIS foundation and load standard catalogue](https://standards.bis.gov.in/website/standard-details?encryptedId=eyJpdiI6InRsM1NSbVVXSi9YK2RhaE11cDJGOHc9PSIsInZhbHVlIjoiNC9iVXV0OEY0akZHVjFVWHpZZGxMdz09IiwibWFjIjoiMGRiY2ZiZjgxNjdlZTkwN2ZhMWQyMTc4M2Y2NjQyYjRiOTg2MTFjY2QxZmUwZTY2Mzc3MGFlOGQyYmNjMDJlNyIsInRhZyI6IiJ9)

## Raft review

The earlier raft added a lever arm at support nodes already on the founding plane, combined reflected canonical and right-handed solver coordinates, and used a partial ULS support sum when deducting pressure inside each punching perimeter. The updated SLS moments translate signed reactions using `M + r × R` at the actual contact plane. Every ULS sum is accumulated before evaluating any punching perimeter. The order-invariance regression reverses the support list and verifies pressures and moment shift independently. Physical loss of contact is checked against gross contact pressure. Acceptance uses unrounded values.

The corrected controlling service combination is `SLS_10_DL_08_LL_08_PLUS_EQX`, with `P = 50,174.48 kN`, `Mx = 718.76 kN·m` and `My = −48,600.20 kN·m`. Dimensions are 25.75 × 34.35 m, thickness 0.9 m, and excavation overburden at the stated founding depth is 33.3 kPa. Uniform full-contact weight plus the corner moment contribution gives 75.5204 kPa net, 108.8204 kPa gross, and a 82.9307 kPa gross minimum in this combination. The report records all service combinations and both pressure bases. The fixture enters 100 kPa as SBC and the existing implementation treats that value as net. No real site report confirms the basis. A 100 kPa gross limit would be exceeded.

| Calculated raft item | Phase 6 | Phase 7 |
|---|---:|---:|
| Factored vertical load at `ULS_15_DL_LL`, kN | 78,506.8 | 78,506.8 |
| Punching demand / capacity, MPa | 1.112 / 1.250 | 1.098 / 1.250 |
| One-way shear demand / capacity, MPa | 0.151 / 0.291 | 0.151 / 0.291 |
| Flexure utilization | 0.967 | 0.967 |
| Sliding / overturning factor | 14.23 / 35.98 | 14.23 / 22.47 |
| Estimated immediate settlement, mm | 6.61 | 7.26 |

The case now reports `PRELIMINARY_GEOTECHNICAL`. The 7.26 mm estimate uses a correlation because the fixture lacks a reviewed settlement modulus. It cannot validate settlement or allowable bearing. Raft strip flexure and one-way shear still use averaged bay geometry, and punching uses a uniform pressure deduction. Differential settlement, contact redistribution, soil stratigraphy, groundwater and design pressure basis remain open. Flexible raft and pile groups are explicitly UNSUPPORTED. [All service reaction sums and corner pressures](../../../phase7-evidence/independent-calculations.log)

## Direct solver matrix and native evidence

The Phase 7 native comparison strips shells from the two existing illustrative structural fixtures and sets all frame roll angles to zero. This yields a single-storey and a multi-storey asymmetric 3D frame. WASM and Sparse-LU receive the identical analytical model. ETABS independently creates, analyzes and reopens two EDBs. Lateral differences persist after shell removal, so shell stiffness alone cannot account for the earlier difference.

| Case | WASM vs Sparse-LU | ETABS vs WASM | Status |
|---|---|---|---|
| 3D one- and two-storey frame gravity | Within 1e-8 absolute + 1e-8 relative in native RH units for reactions, displacements, end forces and stations | Worst 1.04e-17 mm and 1.09e-11 N for translations, support forces and column start axial forces. Tolerances 1e-5 mm and 0.01 N | VERIFIED for the metrics listed |
| Same frames, lateral and combined | Same tolerance and equilibrium | Project 001 combined 0.003532 mm / 1.136 N. Project 002 combined 0.006693 mm / 8.294 N | PARTIAL, differences measured, equivalence unresolved |
| Simply supported, fixed and cantilever closed-form fixtures, portals, releases | Existing structural unit benchmarks exercise analytical reactions, forces, deflection and supported releases | Dedicated native permutations absent | PARTIAL |
| Rotated local axes | Explicit Sparse-LU fallback for unsupported WASM rotation | Phase 6 gravity results matched the native reference. The native shell cases are outside the Phase 7 direct comparison | UNSUPPORTED in WASM, PARTIAL for comparison |
| General native station shear/moment and modal equivalence | Local fixture coverage | Axial and shear/bending magnitude readback completed for the two orthogonal 3D fixtures. Sign mapping for all orientations and native modal validation are open | NOT TESTED for complete equivalence |

Native result station replay compared 52 and 170 force rows per case. Observed maximum lateral or combined differences were 8.294 N axial, 7.224 N shear magnitude and 0.01819 kN·m bending magnitude. The comparison evaluates RH forces at the reported ETABS stations. ETABS reports many end stations at support faces instead of joint centrelines. Section shear flexibility remains a model difference to isolate. [Station comparison](../../../phase7-evidence/native-station-replay.log) · [CSI frame axes](https://docs.csiamerica.com/help-files/etabs/Menus/Assign/Frame/Local_Axes_Frames.htm) · [CSI end length offsets](https://docs.csiamerica.com/help-files/etabs/Menus/Assign/Frame/End_Length_Offset.htm)

ETABS 23.3.2 executable SHA-256 `7d8e927403f78add7f2b60d11e28590649f0eb1b0308604e6b9cccc77837b348`. Native evidence uses the existing bridge with executable SHA-256 `52fbac8783aed1fe859eb47de590126e99bc4f6c05ca61548ed43c589aed4381`. [Native measurements](../../../phase7-evidence/native-phase7.log) · [Project 001 EDB and results](../../packages/backend/output/etabs/phase7-frames-1795777733324/run-a18e22be-a67b-4f86-b756-8f03e4701253/) · [Project 002 EDB and results](../../packages/backend/output/etabs/phase7-frames-1795777733324/run-79b3e8d9-bca7-4611-a4dd-916c3c84e5d1/)

The large archived WASM model contains 1,296 nodes and 2,877 elements. Two repeated and two concurrently requested batches each solved 37 right-hand sides with actual `AWATIF_CPP_WASM` and residuals at or below 2.857e-12. Linear memory grew from 33,554,432 to 88,604,672 bytes and plateaued. All 40 instrumented external allocations were freed. Process RSS after the batches was 2,846,900,224 bytes under overlapping workloads. That measurement includes JavaScript and retained analysis results. It does not establish a memory bound for parallel workers. [Large model replay](../../../phase7-evidence/large-wasm-replay.log)

## Architecture, service continuity and generation

The stilt fixture remains connected for two flats. The three-flat fixture emits one infeasible chase diagnostic. The four-flat courtyard fixture emits two. The projected rectangles intersect protected OTS geometry, so the output carries each affected stack, floor and courtyard entity ID, and no prohibited collector segment is emitted. The separate blocked route fixture checks collector suppression. These are schematic continuity outcomes. There is no verified relocation or designed collector route for the three obstructed chases. Physical maintenance access, pipe sizing, invert elevations and site connection remain unverified. [Drainage regressions](../../../phase7-evidence/phase7-drainage-serial.log)

The exact mixed-BHK request measured 856.447, 863.300, 1,264.821 and 1,289.056 ft² against 850, 850, 1,250 and 1,250 ft². The Phase 6 gross plate reduction from 918.00 to 894.54 m² reproduced. Phase 7 probes intermediate depths after the first feasible plan. At 24.8 m depth the existing gate accepts 877.20 m² gross with 150.06765 m² of wall-clipped recess. Two perimeter OTS polygons remain at 116.01 and 40.14 m² raw area. The four measured apartment areas are identical to the Phase 6 result. Phase 7 classified the three canonical `OPEN_TO_SKY_VOID` recesses. Their raw polygons are 116.01, 17.34 and 40.14 m². The wall-clipped disjoint ledger records 164.01055 m² of net recess, 213.957675 m² of common circulation, 33.8225 m² of core and 4.74 m² of service space. Category totals close at 894.54 m² with zero residual. The intended setbacks outside the floor plate and private balcony areas are excluded from the recess total. The geometry does not establish whether every recess is needed for ventilation. Joint width/depth and apartment allocation optimization across diverse topologies remains open. The four proportional width/depth probes reverted to a 918 m² plate and failed the compliance gate. The production refinement retains a known valid allocation as it searches depth. [Area inventory](../../../phase7-evidence/area-inventory.log) · [Measured voids before refinement](../../../phase7-evidence/detailed-results.log) · [Refined production replay](../../../phase7-evidence/refined-mixed-replay.log) · [Depth probes](../../../phase7-evidence/mixed-envelope-refinement.log)

The same production browser worker ran with backend HTTP and forced HTTP 503. Both generated the same four areas and rejected a mandatory 200,000 ft² program. The backend rejected it at feasibility. Offline rejected it after measured candidate validation. Both executions were deterministic. The final online and offline bundles each measured 877.20 m² gross and 150.06765 m² of void. Both modes again rejected the impossible program. Live provider influence, complete recovery parity, cancellation across all pathways and lower fallback use are NOT TESTED for Phase 7 acceptance. The existing backend can try alternatives and bounded recovery. Both paths enforce the mandatory-generation gate. [Initial worker replay](../../../phase7-evidence/worker-parity-phase7.log) · [Final worker replay](../../../phase7-evidence/worker-parity-final.log)

The uncached 288-case planning benchmark generated 288 plans and still used its legacy fallback in 88 cases (30.6%). [Planning benchmark output](../../../phase7-evidence/phase7-unit-all.log)

Demand-dependent optimization remains gated on validation of the actual load paths and remaining beam and lateral checks. The production benchmark received no section or architecture changes. The controlled optimizer fixture reruns global stiffness, verifies protected geometry by hash and compares quantities. Its remaining preliminary inputs now block an optimizer-verified result.

## Software and artifacts

The Phase 6 uncached attempt ran with zero cache hits and finished 45/48 tasks. Concurrent Vitest worker update timeouts and test timeouts prevented a clean suite result. The source archive records the tested Phase 6 bytes. Phase 7 build, package typecheck and lint completed 36/36 tasks with zero cache hits. Existing size and cota lint warnings appear in the log. Root integration passed 21/21 and backend integration passed 35/35. [Phase 6 run](../../../phase7-evidence/phase6-unforced-cache-disabled.log) · [Phase 7 build/typecheck/lint](../../../phase7-evidence/phase7-build-types-lint.log) · [Root integration](../../../phase7-evidence/phase7-root-integration.log) · [Backend integration](../../../phase7-evidence/phase7-backend-integration.log)

The frozen Phase 7 evaluation persisted through two distinct backend processes. A browser assistant request initially timed out while reloading a full result. The updated store persists solver identity in the checksum-bound header and reads that header for current assistant requests. Legacy results continue to use their original complete read path. The cold final backend returned the deterministic assistant response with WASM provenance in 115 ms in the measured loopback run. The final backend also read the earlier persisted record in 1,353 ms and retained its complete numerical case and export status. The full governing case restored under the same evaluation ID and decoded snapshot digest. IFC4, DXF and PDF export responses all retained `DIAGNOSTIC_NOT_FOR_CONSTRUCTION`. Independent IfcOpenShell 0.9.0.post1 read the IFC4 with eight storeys, 343 columns, 371 beams, 760 slabs and 12 stair flights. Native graphical BIM reopening is NOT TESTED. [Initial persistence and export digests](../../../phase7-evidence/persistence-and-export.log) · [Final cold assistant replay](../../../phase7-evidence/persistence-and-export-final.log) · [IFC readback](../../../phase7-evidence/phase7-ifc-readback.log) · [IFC4](../../../phase7-evidence/frozen-design.ifc) · [DXF](../../../phase7-evidence/frozen-design.dxf) · [PDF](../../../phase7-evidence/frozen-design.pdf)

- Final TypeScript and lint checks completed 24/24 forced tasks with zero cache hits. The final backend and its workspace dependencies rebuilt successfully. Vite independently built the final frontend bundle into the evidence directory. The final structural package passed 38/38, the drainage fixtures passed 7/7, and the focused final backend regression run passed 18/18. [Final typecheck and lint](../../../phase7-evidence/final-overlay-typecheck-lint.log) · [Backend rebuild](../../../phase7-evidence/phase7-backend-rebuild.log) · [Frontend bundle](../../../phase7-evidence/phase7-frontend-final-build.log) · [Structural tests](../../../phase7-evidence/structural-acceptance-final.log) · [Backend regressions](../../../phase7-evidence/backend-regression-refresh.log)
- The uncached aggregate unit run completed 10/12 package tasks with zero cache hits. It recorded a core OneDrive file-lock error, a native Blender timeout and a structural-store reload mismatch while the overlay was being updated. The clean core retry passed 198/198. The final backend targeted run and real process restart both passed the updated structural-store path. The isolated real Blender 5.2 regression also passed on retry. [Aggregate unit log](../../../phase7-evidence/phase7-unit-all.log) · [Core retry](../../../phase7-evidence/core-serial-retry.log) · [Blender retry](../../../phase7-evidence/blender-serial-retry.log)
- The full Chromium repair run passed 21/25. Its failures were the structural assistant response wait, IndexedDB migration download wait, hosted-window revision refresh and current-studio generation response wait. The first focused structural retry hit a navigation timeout. A subsequent retry of all four failures against the final frontend and backend passed 4/4, including live structural analysis, the assistant, structural exports, migration, hosted-window revision and the studio reference, massing, orbit and export flow. The assistant and export checks also succeeded in the real cold backend. [Full Chromium](../../../phase7-evidence/chromium-repair.log) · [First structural browser retry](../../../phase7-evidence/chromium-gate2-retry.log) · [Final four-flow retry](../../../phase7-evidence/chromium-final-repair-retry.log)
- The final production browser passed the mixed-BHK UI flow and confirmed protected entity equality on regeneration. The strict-unequal UI case generated its plan and then timed out waiting for the massing-alternative HTTP response. The final production worker independently met the exact strict 3% request in both modes, delivering 723.79, 1,056.73, 1,417.44 and 1,756.56 ft² for targets of 720, 1,050, 1,420 and 1,750 ft². [Final mixed-BHK and strict-area browser log](../../../phase7-evidence/chromium-final-mixed.log) · [Strict worker replay](../../../phase7-evidence/worker-strict-final.log) · [Mixed-BHK acceptance artifact](../../../phase7-evidence/chromium-final-mixed/rh-phase51-project-matrix-project-4-Four-flat-mixed-BHK/acceptance.json)


- The 14-case standard Chromium project and survey matrix finished 14/14 after the backend rebuild. It exercised the mixed and strict-area wizards, exact oblique survey, independent project shapes, open stilt, reference attachment and protected regeneration. The final browser worker was tested separately using its rebuilt assets. [Project and survey matrix](../../../phase7-evidence/chromium-matrix.log)

The seven regenerated tracked test artifacts were archived and restored to their initial checkpoint bytes in the isolated checkout. [Generated artifact inventory](../../../phase7-evidence/generated-test-artifacts.log)

## Source inventory and remaining gates

Line ranges are in the Phase 7 working tree. For files touched in Phase 6, they identify the delta from the verified Phase 6 overlay. All changed package source hashes, including the inherited Phase 6 files, are in the combined overlay manifest.

| Phase 7 file | Lines | SHA-256 |
|---|---|---|
| `packages/backend/src/__tests__/phase7-three-solver.test.ts` | 1–101 | `8a5bb75395891fceb831ccf644d1343d6d9d5ad38480073817692798a5367d91` |
| `packages/backend/src/__tests__/structural-evaluation-store.test.ts` | 14, 26–29 | `e46b74a1a97edd0c6ebb5c9cb871d5d3c7265c07d142548ff74a3c939d0ae316` |
| `packages/backend/src/api/structural-routes.ts` | 92–96, 106, 189, 219, 273–275, 453 | `d5dc01e0a9a331d815b902f5d54e60725d8b9c8a0cf446527a845b962f089742` |
| `packages/backend/src/services/structural-evaluation-store.ts` | 11, 44–47, 66, 79–82 | `c679f69a8a2769e1945c02fc7fa399146394c5d2bfe6c93420541bfd329fa651` |
| `packages/core/src/mep/mep-engineering-plan.ts` | 126, 134–140 | `f197bee983e5af2d7f3b0e9bca5472e457cbf1a7cf7b8f1b155296931acb93b5` |
| `packages/frontend/e2e/rh-phase51-project-matrix.spec.ts` | 120–121 | `8df686ecae25dcbe57ced2ae39bac1f3a77bef0d1960b6e88fc7f0a373bb9b8f` |
| `packages/planning-engine/src/__tests__/wet-wall-risers.test.ts` | 99–107 | `c8a0b0b955010a4e29f423ce8acb9c9d2dd9d3fd6de12f8b310ae30b9d809f5f` |
| `packages/planning-engine/src/apartment/multi-sheet-apartment-solver.ts` | 2834–2851, 2855–2866 | `f9ca1b39b4207132d6bd2c82f2e047ab3ea5337e078442c3fe77cd9ba6f8b421` |
| `packages/planning-engine/src/mep/mep-synthesizer.ts` | 33, 520–521, 580–588, 631–648, 652–655 | `65060987b3deed48d00cbb9ff1f824f49ff691973a8e6d233baa4db63056466f` |
| `packages/structural-engine/src/__tests__/engineering-acceptance-matrix.test.ts` | 575–578, 598–600, 622–624, 650–652, 677–679, 697–699, 815–817, 819 | `551b3507d2c4d4d7b9c10da5d9acad36eac465faa399deb7c72d848e013064aa` |
| `packages/structural-engine/src/__tests__/independent-foundation-verification.test.ts` | 387–409 | `49b95988d273d04d61f4f0a4cebe0d0973d303b5bea03f63f51cbed1a5965967` |
| `packages/structural-engine/src/__tests__/independent-rcc-verification.test.ts` | 442–453 | `83999da9e1bbd0d54b021f5e8e6799f320ca8d35c7633aa2142009d2dd7811a5` |
| `packages/structural-engine/src/__tests__/one-way-gravity-transfer.test.ts` | 1–51 | `53639d6b61d25bcd420bd0642142823e800df9796b8518ee90d73c6ca253daee` |
| `packages/structural-engine/src/__tests__/optimization-reanalysis-benchmarks.test.ts` | 203–206, 209–211 | `abda2fa7a993e111c9c83a7021d83c8c2551c865c1ffed1fede80298ec63ab63` |
| `packages/structural-engine/src/__tests__/rcc-and-foundation-benchmarks.test.ts` | 260–263, 355–362 | `007cf44e27a2db7fc277a423f3df03fe284119261e2c88a56b37b09c82c48c9a` |
| `packages/structural-engine/src/foundation/foundation-design-engine.ts` | 105, 334, 387, 466–469, 475, 482–484, 1310, 1358, 1370–1376, 1378, 1379, 1389, 1391–1392, 1397, 1399–1401, 1431, 1433, 1449, 1472, 1558–1566, 1568–1569, 1573–1575 | `dcfb91f65ef3682358d9494e908cf5de0a1f0a647030cb826332a75fd41a0af3` |
| `packages/structural-engine/src/loads/indian-load-assembler.ts` | 29, 105–109, 158–210, 305, 307, 310–313, 318, 324–329, 351–353, 726 | `83e053fcae48e7ee7b61817249f6220199f53ea9bf4fdb64f7d3d32fa090b762` |
| `packages/structural-engine/src/optimization/defect-and-optimizer.ts` | 530–531, 534–537 | `c39fe20776e496d4221c55636286cb8584faaa96d77534caa954d5b40f80175a` |
| `packages/structural-engine/src/rcc/rcc-design-engine.ts` | 135, 149, 151, 404, 412–416, 418, 421–439, 442–451, 453–500, 502–506, 1114, 1126, 1131–1132, 1135, 1138–1160, 1166–1176, 1178–1193, 1195–1213, 1222, 1234, 1237, 1259, 1280–1282, 1287, 1346, 1360 | `3b232ac035549ad3963fc8bef0ee5549d442da6b4ef87ee20ed54f7ab58f50e8` |

[Combined source SHA-256 manifest](../../../phase7-evidence/final-source-overlay.json)

The structural status remains FAILED on the captured production frame. Independent gravity, uniaxial capacity, signed raft contact, deployment persistence and the specific native gravity comparisons are VERIFIED as scoped. Project load transfer, RCC detailing, raft design, drainage coordination, architectural optimization and online/offline parity remain PARTIAL. Full native lateral/modal equivalence, live AI execution and independent authorized professional review remain open. Flexible raft and pile groups are UNSUPPORTED. Failed diagnostic drawings are retained for engineer review with their approval status intact.


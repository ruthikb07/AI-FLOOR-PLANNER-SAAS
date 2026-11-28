# Milestone 6A.3–6A.4 acceptance

**Partial. Complete building gravity transfer and member sizing remain gated.**

The recovered source starts at `351985b247bf9e9926eddf71cd5fc2f3fe0394fd`. All three hosted jobs passed on that baseline. The original non-synchronized checkout's Git pointer referenced its former location. The continuation uses a non-synchronized clone from the exact commit and preserves the original checkout and draft source. [Baseline GitHub Actions](https://github.com/ruthikb07/AI-FLOOR-PLANNER-SAAS/actions/runs/46113686136)

| Gate | Status | Evidence |
|---|---|---|
| A. Automatic conforming meshes | Partial | Exact coverage, open and oblique regions, quality checks and bounded refinement work in fixture scope. The larger archive regions and some adjacent edge partitions fail. [Mesh verification](AUTOMATIC_CONFORMING_MESH_VERIFICATION.md) |
| B. Building-wide identity | Partial | Collision-free candidate node and plate identity across floors and regions. Analytical child subdivision, load remapping and refined-edge connectivity remain open. [Assembly](BUILDING_WIDE_COUPLED_ASSEMBLY.md) |
| C. Distributed gravity | Partial | Independent concentric, one-way, two-way and continuous elastic benchmarks pass. Openings, obliquity and nonuniform project pressure need independent response cases. [Benchmarks](DISTRIBUTED_GRAVITY_BENCHMARKS.md) |
| D. Beam–slab offsets | Open | Current matching-edge receipts require coincident elevations. Actual beam/slab offsets and composite stiffness require independent verification. |
| E. Stair and cantilever | Partial | Distributed clamped cantilever and simply supported and continuous inclined strip references verified. Actual stair/landing transfer and balcony root torsion remain open. [Verification](STAIR_AND_CANTILEVER_TRANSFER_VERIFICATION.md) |
| F. Complete reviewed building | Open | Synthetic two-storey coupled gravity transfers 64 kN in one solve. Production canonical review, frame/deck loads and full coupled results remain open. |
| G. Archived projects | Partial | Exact archived mesh replay covers all ten structural levels, with blocked roof and rejection records. Complete coupled bearing and load path evidence remains open. [Force and geometry ledger](APARTMENT_GRAVITY_LOAD_CLOSURE.json) |
| H. Sizing gate | Preserved | The existing incomplete-gravity gate remains active. Mesh and alignment preview requests read the existing evaluation and do not update it. |
| I. Framing alternatives | Partial | Original, fixed-end straight and fixed-column eccentric layouts can be compared in a read-only selected-chain preview. Full clearance, detailing and loaded reanalysis remain open. [Alignment evidence](STRUCTURAL_ALIGNMENT_OPTIMIZATION.md) |
| J. Chromium production workflow | Partial | Production Chromium generated and rendered the deck mesh and reached the existing frame analysis and export checks. The Windows Gate 2 run exhausted its original 240-second budget at a subsequent invalid-request test. Coupled shell analysis remains gated by the production evaluation. |
| K. Regressions | Partial | Production build, workspace typecheck and lint, focused saved-evaluation HTTP and worker checks passed. Full CAD, BIM, planning and structural regression results depend on the new hosted run. |
| L. Hosted CI | Pending | The baseline run identifies the recovered commit. The new commit must have its own green run. |
| M. Windows reliability | Open | The 37-test worker run took 388.59 s under concurrent Windows work. Two concrete fiber cases took 330.02 s and 35.45 s. A cold worker ping including process startup and shutdown took 4.30 s. These measurements do not isolate the whole-model G+5 gap. |

## Apartment load closure

| Archive | Candidate deck area | Geometrically meshed | Quads | Verified bearing area | Historical unassigned DL / SDL / LL |
|---|---:|---:|---:|---:|---:|
| Original | 3534.3175 m² | 43.7175 m² | 19 | 0 m² | 12,350.186 / 3,941.219 / 7,271.098 kN |
| Second | 1996.491 m² | 39.279 m² | 22 | 0 m² | 7,490.788 / 2,369.716 / 4,364.259 kN |

Both terminal structural levels still require a reviewed roof disposition. The archive run performs geometry generation and records the prior evaluated loads. Applied coupled loads and reactions are absent from this run. No load credit was claimed for mesh geometry. The verified legacy conventional transfer and frame-only scope remain separately documented. [Production deck baseline](PRODUCTION_DECK_INTEGRATION_VERIFICATION.md)

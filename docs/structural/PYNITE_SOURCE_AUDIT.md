# PyNite source audit

The recovered worker imports PyNiteFEA 3.2.1 at commit `fdf3e12b102716b7009e64335be6916377d70f31`. The local clone and the installed Python distribution's `direct_url.json` both identify that commit. `pyproject.toml` and `uv.lock` retain that pin. RH Planner invokes the unmodified upstream library from `tools/structural-python-worker/worker_main.py`. [Upstream source](https://github.com/JWock82/Pynite/tree/fdf3e12b102716b7009e64335be6916377d70f31)

| Upstream component | RH Planner use | Boundary |
| --- | --- | --- |
| `FEModel3D`, `Member3D`, `Analysis` | Six-DOF linear 3D frames with prismatic axial, biaxial flexural, torsional and shear-force recovery. The adapter translates RH Planner Z-up coordinates and local roll into PyNite conventions. Inputs use m, kN, kN·m and kN/m². | Element flexural formulation is Euler–Bernoulli. Force recovery and cross-solver comparisons cover defined fixtures. |
| Restraints, releases, springs, point and distributed loads, combinations | Apply native restraints, member-end releases, nodal loads and local/global member loads. Preserve concurrent solved combinations. The canonical load engine explicitly assembles member self-weight. | Spring direction and nonlinear behavior need separate project verification. Signed result comparison matters, especially for rotated local axes. |
| `Plate3D`, `Quad3D` | Worker supports explicit plates/quads and pressure loads. Benchmarks exercise direct mesh refinement and displacement recovery. | The canonical building path rejects shell analysis until it can build validated panels, openings, interfaces and matching slab-load transfer. |
| `analyze_PDelta` | Frame-only second-order execution, with a column amplification benchmark. The adapter rejects models containing plates or quads. | Project applicability, local stability, imperfections and broader nonlinear behavior remain open. |
| Upstream modal, pushover, optional visualization, VTK and reporting | Excluded from the integration. RH Planner owns its canonical model, output and independent verification. | Upstream availability alone confers no application capability. |

The prior optional upstream test run recorded 688 passed, 2 failed and 2 skipped. Both failures imported VTK, which the headless worker does not install. The current worker and structural package logs describe application verification. [Recovered upstream log](../../../carbon4-evidence/upstream-pytest.log)

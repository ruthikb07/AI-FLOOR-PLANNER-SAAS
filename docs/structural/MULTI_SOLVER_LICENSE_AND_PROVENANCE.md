# Multi-solver license and provenance

| Component | Recovered identity | Distribution disposition |
| --- | --- | --- |
| Awatif | v3.4.0 upstream `a9017ec55343c07cb0c5f0e832b3214f97106641`. The local PR #11 WASM hash is `3dfc46bb417524ca226532f947326b2297638dd983fc0b0ae380b5d04df028ef`. | MIT. Retain upstream copyright, Eigen/MPL notices and local modification history. [Awatif audit](AWATIF_LICENSE_AND_DEPENDENCY_AUDIT.md) |
| PyNiteFEA | v3.2.1 at `fdf3e12b102716b7009e64335be6916377d70f31` | MIT. Existing license copy matches upstream after line-ending normalization. [License](../integration/licenses/pynite-MIT.txt) |
| Concrete Properties | v0.8.0 at `13bfb7bfd75b265bcd418e2f8ed72106a0362678` | MIT. Existing license copy matches upstream bytes. [License](../integration/licenses/concrete-properties-MIT.txt) |
| sectionproperties / CyTriangle / Triangle | 3.10.2 / 3.0.2 / embedded Triangle implementation | The wrapper declares LGPL-3.0 and imports the separate Triangle implementation. Triangle's author requires a license to sell or include the code in commercial products. Verify the exact distributed binary and obtain rights or replace the dependency before commercial distribution. [CyTriangle source](https://github.com/m-clare/cytriangle) · [Triangle license statement](https://www.cs.cmu.edu/~quake/triangle.html) |
| NumPy / SciPy / Shapely | 2.5.5 / 1.18.1 / 2.2.0 | Preserve distribution notices and review the bundled native libraries, including GEOS and the numerical runtime for each target wheel. |
| IfcOpenShell | 0.9.0.post1 | Independent readback tool in the evidence environment. The application IFC exporter does not depend on it. |
| ETABS | 23.3.2 in historical native evidence | External licensed verification host. No CSI binaries were added to this overlay. |

Both Python dependencies are installed by their exact VCS pins. The worker checks the installed distribution version and VCS metadata before execution. The installed environment's full dependency versions and declared license metadata are in the audit log. Package metadata alone does not establish native binary redistribution rights. Commercial distribution acceptance remains open. [Installed metadata](../../../carbon4-evidence/recovery-20261127/python-license-metadata.log)

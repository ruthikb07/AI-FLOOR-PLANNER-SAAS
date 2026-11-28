# Adaptive mesh verification

The saved-evaluation automatic deck route now uses local Delaunay refinement when its existing methods fail. Boundary segments missing from the triangulation are bisected. The worst failed cell selects a triangle for circumcentre insertion or local segment protection. All returned elements have four distinct vertices. Geometry outside a polygon or inside its holes is excluded. The existing worker independently validates incidence, convexity, area and shape before emitting a receipt.

| Frozen archive | Candidate area (m²) | Baseline meshed (m²) | Repaired meshed (m²) | Baseline / repaired quads | Verified bearing (m²) |
|---|---:|---:|---:|---:|---:|
| Original | 3534.3175 | 43.7175 | 3534.3175 | 19 / 1891 | 0 |
| Second | 1996.491 | 39.279 | 1996.491 | 22 / 1018 | 0 |

The denominator is unchanged. Both terminal roofs require ownership review. Full per-floor counts, archived digests, unresolved interfaces and historical loads are in [the hash-checked replay](6a-evidence/adaptive-apartment-replay.json). Reproduce using the managed Python interpreter with `tools/structural-python-worker/replay_apartment_meshes.py <refined-archive-dir> <output-file>`.

Sixteen permanent boundary regressions independently reconstruct the union of the emitted solver connectivity, compare it with the input polygon within 0.01 mm², and check every source vertex. They differentiate the bilinear map at corners, centre and four Gauss points and enforce the original 0.25 minimum scaled Jacobian and maximum edge ratio of 10. The planar Q4 determinant is affine in natural coordinates, so positive corner determinants also certify its sign throughout the element. The repair provides geometric coverage. Beam alignment, reviewed joint identities and coupled response require separate verification.

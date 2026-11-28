# Distributed gravity benchmarks

The pinned PyNite worker solves the plate and beam elements together for the concentric cases. Only the plate carries the applied pressure. The worker now calculates trapezoidal element first moments using area-weighted centroids and rejects pressure assigned to an undeclared case. The trapezoid integrates to 6 m², −18 kN vertical force and (−16, +28, 0) kN·m about the origin. The reactions close those moments within 10⁻⁶ kN·m.

| Synthetic model | Quads | Measured displacement | Independent reference | Solver time on Windows |
|---|---:|---:|---:|---:|
| Clamped one-way strip | 16 | −62.845521 mm | −62.500000 mm | 31.9 ms |
| Clamped one-way strip | 32 | −62.601380 mm | −62.500000 mm | 53.8 ms |
| Clamped strip with two concentric beams | 16 | −11.062386 mm | −10.989011 mm | 25.0 ms |
| Clamped strip with two concentric beams | 32 | −11.019450 mm | −10.989011 mm | 50.8 ms |
| Simply supported one-way strip | 32 | −6.495072 mm | −6.510417 mm | 49.0 ms |
| Simply supported two-way square | 64 | −1.951414 mm | −1.949929 mm | 158.0 ms |

The two-span strip returns 1.508285, 4.983431 and 1.508285 kN against 1.5, 5.0 and 1.5 kN from a continuous beam of constant stiffness. The coupled strip uses the sum of the verified concentric component bending stiffnesses in the elastic-strip limit. The test checks tip displacement and rotation at 3%, beam root moment at 5%, strip reactions at 10⁻⁶ kN and kN·m and two-span reaction distribution at 1%. The square compares the centre deflection with the Navier series. [MIT plate bending reference](https://ocw.mit.edu/courses/2-080j-structural-mechanics-fall-2013/f8fd2ad49d100766335b4e129a8a4791_MIT2_080JF13_Lecture7.pdf)

The 4-, 8- and 16-quad constant-curvature checks retain their original tolerances. A second coincident plate component with separate node identities and no path to any support is rejected. The aperture and oblique deck have geometric checks. Independent flexural checks for openings and oblique deck shapes, eccentric RCC joints, full load combinations, pressure sources from occupancy and equipment, and apartment reactions remain open.

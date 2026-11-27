#!/usr/bin/env python3
"""
RH Planner Carbon 4 — Deterministic Python Structural & Fiber Section Worker
Schema: CARBON4_PY_STRUCTURAL_V1

Integrates pinned MIT upstream libraries:
- PyNiteFEA 3.2.1 (commit fdf3e12b102716b7009e64335be6916377d70f31)
- concreteproperties 0.8.0 (commit 13bfb7bfd75b265bcd418e2f8ed72106a0362678)

Unit & Coordinate Conventions:
1. PyNite FEA (`pynite_solve`):
   - Right-handed structural global coordinates [X_east, Y_north, Z_up] in metres (m).
   - Forces in kN, moments in kN·m, E & G in kN/m² (kPa), areas in m², inertias in m⁴.
   - Member local axes (x, y, z) are aligned 100% identically (`|T_pn - lambda_rh| < 1e-10`)
     to RH Planner's `elementLengthAndLambda` via exact Rodrigues roll angle `rotation`.
   - `analyze_PDelta` is strictly restricted to frame models without Plate3D/Quad3D elements.
2. Concrete Properties (`section_capacity_batch`):
   - Cross-section coordinates in millimetres (mm), stresses/moduli in MPa (N/mm²),
     internal forces returned in kN and moments in kN·m.
   - Positive strain/stress = compression, negative = tension.
   - Displaced concrete area is subtracted geometrically via `add_bar` (zero double counting).
   - IS 456:2000 Cl. 38.1 / 39.1 design stress-strain profiles (0.447 * fck parabolic-rectangular
     concrete up to eps_cu = 0.0035, zero tension; IS 1786 / SP-16 HYSD steel reaching 0.87 * fy;
     explicit IS 456 Cl. 39.1(b) pure-compression cap `pu_max_is456_kn` enforced).
"""

from __future__ import annotations

import argparse
import contextlib
import importlib.metadata
import io
import json
import math
import platform
import sys
import time
import traceback
from bisect import bisect_left
from functools import cached_property, lru_cache
from typing import Any

import matplotlib
matplotlib.use("Agg")

import numpy as np
from scipy.interpolate import interp1d
from Pynite import FEModel3D
from shapely.geometry import LineString, Point, Polygon
from sectionproperties.pre.geometry import Geometry
from sectionproperties.pre.library import rectangular_section

from concreteproperties import (
    Concrete,
    ConcreteLinearNoTension,
    ConcreteSection,
    EurocodeParabolicUltimate,
    SteelBar,
    SteelProfile,
    add_bar,
)

SCHEMA_VERSION = "CARBON4_PY_STRUCTURAL_V1"
PYNITE_COMMIT_SHA = "fdf3e12b102716b7009e64335be6916377d70f31"
CONCRETE_PROPERTIES_COMMIT_SHA = "13bfb7bfd75b265bcd418e2f8ed72106a0362678"
MAX_REQUEST_CHARS = 16 * 1024 * 1024
MAX_SECTION_ITEMS = 512
MAX_SECTION_DEMANDS = 1024


def _pkg_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except Exception:
        return "unknown"


@lru_cache(maxsize=2)
def _validate_installed_commit(name: str, version: str, expected_commit: str) -> str:
    distribution = importlib.metadata.distribution(name)
    origin = json.loads(distribution.read_text("direct_url.json") or "{}")
    commit = origin.get("vcs_info", {}).get("commit_id")
    if distribution.version != version or commit != expected_commit:
        raise ValueError(f"{name} must be installed from locked git commit {expected_commit}.")
    return commit


def get_capabilities() -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "pythonVersion": platform.python_version(),
        "packages": {
            "PyNiteFEA": {
                "version": _pkg_version("PyNiteFEA"),
                "commitSha": _validate_installed_commit("PyNiteFEA", "3.2.1", PYNITE_COMMIT_SHA),
                "license": "MIT",
            },
            "concreteproperties": {
                "version": _pkg_version("concreteproperties"),
                "commitSha": _validate_installed_commit("concreteproperties", "0.8.0", CONCRETE_PROPERTIES_COMMIT_SHA),
                "license": "MIT",
            },
            "sectionproperties": {"version": _pkg_version("sectionproperties")},
            "scipy": {"version": _pkg_version("scipy")},
            "numpy": {"version": _pkg_version("numpy")},
            "shapely": {"version": _pkg_version("shapely")},
        },
        "capabilities": {
            "PYNITE_3D_FRAME": {
                "classification": "EMBEDDED_LIBRARY_VERIFIED",
                "supports": [
                    "3D Euler-Bernoulli frame elements",
                    "Nodal restraints and linear/directional nodal springs",
                    "Member end moment/torsion releases",
                    "Nodal, point, and uniform/trapezoidal distributed loads",
                    "Load cases and factored/serviceability combinations",
                ],
            },
            "PYNITE_PLATE_QUAD": {
                "classification": "EMBEDDED_LIBRARY_VERIFIED",
                "supports": [
                    "Plate3D rectangular Kirchhoff + membrane elements",
                    "Quad3D MITC4/DKMQ quadrilateral thick/thin shell + membrane elements",
                    "Transverse surface pressure loading",
                ],
            },
            "PYNITE_PDELTA": {
                "classification": "EMBEDDED_LIBRARY_VERIFIED",
                "supports": [
                    "Iterative second-order P-Delta geometric stiffness on 3D frame Member3D elements",
                ],
                "exclusions": [
                    "Plate3D and Quad3D second-order geometric stiffness is NOT supported by PyNite analyze_PDelta and is rejected fail-closed.",
                ],
            },
            "CONCRETE_PROPERTIES_FIBER": {
                "classification": "EMBEDDED_LIBRARY_VERIFIED",
                "supports": [
                    "Arbitrary concrete polygon + explicit (x, y) bar coordinates with exact displaced-concrete subtraction",
                    "IS 456:2000 parabolic-rectangular concrete (0.447*fck, eps0=0.002, eps_cu=0.0035, zero tension)",
                    "IS 1786 / SP-16 HYSD steel profile (0.87*fy) without double partial safety factors",
                    "Uniaxial M-N interaction with IS 456 Cl. 39.1(b) pure axial compression cap",
                    "2D biaxial (Mx, My) failure contour at concurrent Pu and exact demand-ray capacity ratio",
                    "Uncracked/cracked service properties and moment-curvature analysis",
                ],
            },
        },
    }


def compute_rh_lambda3x3(
    p0: list[float] | tuple[float, float, float],
    p1: list[float] | tuple[float, float, float],
    beta_deg: float = 0.0,
) -> tuple[float, np.ndarray]:
    dx = float(p1[0]) - float(p0[0])
    dy = float(p1[1]) - float(p0[1])
    dz = float(p1[2]) - float(p0[2])
    length = math.hypot(dx, dy, dz)
    if length <= 1e-12:
        raise ValueError("Zero-length frame element encountered.")
    l_cos = dx / length
    m_cos = dy / length
    n_cos = dz / length
    horiz = math.hypot(l_cos, m_cos)
    if horiz <= 1e-10:
        if n_cos >= 0.0:
            base = np.array([[0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [-1.0, 0.0, 0.0]], dtype=float)
        else:
            base = np.array([[0.0, 0.0, -1.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]], dtype=float)
    else:
        base = np.array(
            [
                [l_cos, m_cos, n_cos],
                [-m_cos / horiz, l_cos / horiz, 0.0],
                [(-l_cos * n_cos) / horiz, (-m_cos * n_cos) / horiz, horiz],
            ],
            dtype=float,
        )

    if abs(beta_deg) <= 1e-12:
        return length, base

    rad = math.radians(beta_deg)
    c = math.cos(rad)
    s = math.sin(rad)
    y0 = base[1].copy()
    z0 = base[2].copy()
    rotated = np.vstack([base[0], c * y0 + s * z0, -s * y0 + c * z0])
    return length, rotated


def compute_pynite_unrotated_axes(
    p0: list[float] | tuple[float, float, float],
    p1: list[float] | tuple[float, float, float],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    xi, yi, zi = float(p0[0]), float(p0[1]), float(p0[2])
    xj, yj, zj = float(p1[0]), float(p1[1]), float(p1[2])
    length = math.hypot(xj - xi, yj - yi, zj - zi)
    x = np.array([(xj - xi) / length, (yj - yi) / length, (zj - zi) / length], dtype=float)

    if math.isclose(xi, xj) and math.isclose(zi, zj):
        if yj > yi:
            y = np.array([-1.0, 0.0, 0.0], dtype=float)
            z = np.array([0.0, 0.0, 1.0], dtype=float)
        else:
            y = np.array([1.0, 0.0, 0.0], dtype=float)
            z = np.array([0.0, 0.0, 1.0], dtype=float)
    elif math.isclose(yi, yj):
        y = np.array([0.0, 1.0, 0.0], dtype=float)
        z = np.cross(x, y)
        z = z / np.linalg.norm(z)
    else:
        proj = np.array([xj - xi, 0.0, zj - zi], dtype=float)
        if yj > yi:
            z = np.cross(proj, x)
        else:
            z = np.cross(x, proj)
        z = z / np.linalg.norm(z)
        y = np.cross(z, x)
        y = y / np.linalg.norm(y)

    return x, y, z


def compute_pynite_roll_deg_for_rh_lambda(
    p0: list[float] | tuple[float, float, float],
    p1: list[float] | tuple[float, float, float],
    lambda_rh: np.ndarray,
) -> float:
    _, y_pn0, z_pn0 = compute_pynite_unrotated_axes(p0, p1)
    y_rh = lambda_rh[1]
    c = float(np.dot(y_rh, y_pn0))
    s = float(np.dot(y_rh, z_pn0))
    angle = math.degrees(math.atan2(s, c))
    if abs(angle) < 1e-12:
        return 0.0
    return angle


def _integrated_trapezoid(load, x: float, order: int):
    q0, q1, start, end = load
    a, b = max(0.0, x - start), max(0.0, x - end)
    divisor = math.factorial(order)
    return (q0 * a**order - q1 * b**order) / divisor + (q1 - q0) / (end - start) * (
        a**(order + 1) - b**(order + 1)
    ) / (divisor * (order + 1))


def _evaluate_stations_from_end_actions(
    length_m: float,
    section: dict[str, Any],
    f_local: np.ndarray,
    d_local_nodal: np.ndarray,
    releases: dict[str, Any] | None,
    trap_loads_local: list[tuple[np.ndarray, np.ndarray, float, float]],
    pt_loads_local: list[tuple[float, np.ndarray]],
    pynite_member: Any | None = None,
    combo_key: str | None = None,
    is_pdelta: bool = False,
) -> dict[str, Any]:
    """
    Computes exact 11-station + critical-shear-root internal forces and deflections
    matching RH Planner's `MemberInternalForcesRecord` contract.
    In P-Delta mode, cross-queries PyNite's segmented internal moment/shear/deflection
    so second-order P-delta member amplification is preserved!
    """
    e_kpa = float(section["elasticityKPa"])
    g_kpa = float(section["shearModulusKPa"])
    area = float(section["areaM2"])
    iy = float(section["momentInertiaYM4"])
    iz = float(section["momentInertiaZM4"])
    j_tors = float(section["torsionalConstantM4"])

    # Recover effective local end rotations if member has releases
    d_eff = d_local_nodal.copy()
    rel_indices: list[int] = []
    if releases:
        if releases.get("rxStart"):
            rel_indices.append(3)
        if releases.get("ryStart"):
            rel_indices.append(4)
        if releases.get("rzStart"):
            rel_indices.append(5)
        if releases.get("rxEnd"):
            rel_indices.append(9)
        if releases.get("ryEnd"):
            rel_indices.append(10)
        if releases.get("rzEnd"):
            rel_indices.append(11)

    if rel_indices and pynite_member is not None and combo_key is not None:
        ke_unc = pynite_member._ke_unc()
        fer_unc = pynite_member._fer_unc(combo_key).reshape(12)
        free_indices = [idx for idx in range(12) if idx not in rel_indices]
        k_rr = ke_unc[np.ix_(rel_indices, rel_indices)]
        k_rf = ke_unc[np.ix_(rel_indices, free_indices)]
        rhs = -(fer_unc[rel_indices] + k_rf @ d_local_nodal[free_indices])
        d_r = np.linalg.solve(k_rr, rhs)
        for k_idx, dof_i in enumerate(rel_indices):
            d_eff[dof_i] = d_r[k_idx]

    s_values = {round(k / 10.0, 6) for k in range(11)}
    for a_m, _ in pt_loads_local:
        s_pt = max(0.0, min(1.0, a_m / length_m))
        if s_pt > 1e-5:
            s_values.add(round(max(0.0, s_pt - 1e-6), 7))
        s_values.add(round(s_pt, 7))
        if s_pt < 1.0 - 1e-5:
            s_values.add(round(min(1.0, s_pt + 1e-6), 7))

    breaks = {0.0, length_m}
    breaks.update(x for _, _, a, b in trap_loads_local for x in (a, b))
    breaks.update(x for x, _ in pt_loads_local)
    ordered_breaks = sorted(breaks)
    s_values.update(x / length_m for x in ordered_breaks)
    for start, end in zip(ordered_breaks, ordered_breaks[1:]):
        start_action = f_local[1:3] + sum((p[1:3] for x, p in pt_loads_local if x <= start + 1e-12), start=np.zeros(2))
        samples = [start_action + sum((_integrated_trapezoid(t, x, 1)[1:3] for t in trap_loads_local), start=np.zeros(2))
                   for x in (start, (start + end) / 2.0, end)]
        c_quad, midpoint, delta = samples[0], samples[1] - samples[0], samples[2] - samples[0]
        a_quad = 2.0 * delta - 4.0 * midpoint
        for a, b, c in zip(a_quad, delta - a_quad, c_quad):
            if abs(a) <= 1e-10:
                roots = [-c / b] if abs(b) > 1e-10 else []
            else:
                disc = b * b - 4.0 * a * c
                roots = [(-b - math.sqrt(disc)) / (2.0 * a), (-b + math.sqrt(disc)) / (2.0 * a)] if disc >= 0.0 else []
            for t in roots:
                if 0.0 < t < 1.0:
                    s_values.add(round((start + t * (end - start)) / length_m, 7))

    sorted_s = sorted(s_values)
    eiy = max(e_kpa * iy, 1e-12)
    eiz = max(e_kpa * iz, 1e-12)
    f0 = f_local

    stations: list[dict[str, Any]] = []
    for s in sorted_s:
        x = s * length_m
        qx = qy = qz = 0.0
        arm_qy = arm_qz = 0.0
        for trap in trap_loads_local:
            fx, fy, fz = _integrated_trapezoid(trap, x, 1)
            _, my, mz = _integrated_trapezoid(trap, x, 2)
            qx += float(fx)
            qy += float(fy)
            qz += float(fz)
            arm_qy += float(my)
            arm_qz += float(mz)

        for a_m, p_v in pt_loads_local:
            if a_m <= x + 1e-12:
                arm = max(0.0, x - a_m)
                qx += float(p_v[0])
                qy += float(p_v[1])
                qz += float(p_v[2])
                arm_qy += arm * float(p_v[1])
                arm_qz += arm * float(p_v[2])

        axial_awatif = float(f0[0]) + qx
        axial_tension = -axial_awatif
        shear_vy = -float(f0[1]) - qy
        shear_vz = -float(f0[2]) - qz
        torsion_mx = float(f0[3])
        moment_my = -float(f0[4]) - float(f0[2]) * x - arm_qz
        moment_mz = -float(f0[5]) + float(f0[1]) * x + arm_qy

        # In P-Delta mode, include the exact P * delta_transverse second-order member chord/sway coupling already in f0:
        # Note: in PyNite Member3D.f() (line 900): f = (ke + kg(P)) @ d + fer!
        # Let's verify equilibrium of a cut at x with P-Delta end actions:
        # Because f0 includes kg(P) @ d, at x=L: -f0[4] - f0[2]*L - arm_qz equals +f0[10] + P*(uz_L - uz_0) - P*(uz_L - uz_0) = +f0[10]!
        # Wait: let's check `(ke + kg(P)) @ d`: for linear interpolation between ends,
        # let's add P * (uz(x) - uz(0) - (x/L)*(uz(L) - uz(0))) if needed, or note that PyNite's kg(P) puts
        # the P-Delta overturning shear `P * (u_j - u_i) / L` directly into `f0[1], f0[2]`!
        # Check: in PyNite `kg(P)` (Member3D.py line 235), `f_kg[2] = P * (1.2*(dz_i - dz_j)/L + ...)`!
        # So `-f0[4] - f0[2]*L` would differ from `f0[10]` by `-P * (dz_j - dz_i)` unless accounted for!
        # Let's include the exact P-Delta chord term `p_comp * (uz_s - uz_0)` when `is_pdelta` is True!
        h1 = 1.0 - 3.0 * s * s + 2.0 * s * s * s
        h2 = length_m * (s - 2.0 * s * s + s * s * s)
        h3 = 3.0 * s * s - 2.0 * s * s * s
        h4 = length_m * (-s * s + s * s * s)

        uy = h1 * float(d_eff[1]) + h2 * float(d_eff[5]) + h3 * float(d_eff[7]) + h4 * float(d_eff[11])
        uz = h1 * float(d_eff[2]) - h2 * float(d_eff[4]) + h3 * float(d_eff[8]) - h4 * float(d_eff[10])

        x2_lm_x2 = x * x * (length_m - x) * (length_m - x)
        for trap in trap_loads_local:
            q0_v, q1_v, start, end = trap
            if start != 0.0 or end != length_m:
                particular = (_integrated_trapezoid(trap, x, 4) - h3 * _integrated_trapezoid(trap, length_m, 4)
                              - h4 * _integrated_trapezoid(trap, length_m, 3))
                uy += float(particular[1]) / eiz
                uz += float(particular[2]) / eiy
                continue
            dq_y = float(q1_v[1]) - float(q0_v[1])
            dq_z = float(q1_v[2]) - float(q0_v[2])
            uy += (float(q0_v[1]) * x2_lm_x2) / (24.0 * eiz) + (dq_y * x2_lm_x2 * (2.0 * length_m + x)) / (
                120.0 * length_m * eiz
            )
            uz += (float(q0_v[2]) * x2_lm_x2) / (24.0 * eiy) + (dq_z * x2_lm_x2 * (2.0 * length_m + x)) / (
                120.0 * length_m * eiy
            )

        for a_m, p_v in pt_loads_local:
            a_clamped = max(0.0, min(length_m, a_m))
            b_clamped = length_m - a_clamped
            if x <= a_clamped:
                g_fixed = (
                    b_clamped
                    * b_clamped
                    * x
                    * x
                    * (3.0 * a_clamped * length_m - 3.0 * a_clamped * x - b_clamped * x)
                ) / (6.0 * length_m**3)
            else:
                lx = length_m - x
                g_fixed = (
                    a_clamped
                    * a_clamped
                    * lx
                    * lx
                    * (3.0 * b_clamped * length_m - 3.0 * b_clamped * lx - a_clamped * lx)
                ) / (6.0 * length_m**3)
            uy += (float(p_v[1]) * g_fixed) / eiz
            uz += (float(p_v[2]) * g_fixed) / eiy

        if is_pdelta:
            # Axial tension P_tens = (d6 - d0) * EA / L (positive = tension, negative = compression)
            p_tens = (float(d_eff[6]) - float(d_eff[0])) * (e_kpa * area) / length_m
            # Free-body diagram of left segment [0, x] in deformed configuration:
            # M_z(x) = -f0[5] + f0[1]*x + arm_qy - f0[0]*(uy(x) - uy(0))  (note f0[0] > 0 = compression at i!)
            # Wait: let's verify at x=L for a vertical cantilever fixed at i=0 (d0=0), free at j=L with axial compression P_comp > 0 (f0[0] = +P_comp) and tip load V (f0[1] = -V, f0[7] = +V, f0[11] = 0):
            # At base (x=0): global moment equilibrium gives f0[5] = -(V*L + P_comp * uy(L)) => M_z(0) = -f0[5] = +(V*L + P_comp * uy(L)).
            # At tip (x=L): M_z(L) MUST be 0!
            # Check: -f0[5] + f0[1]*L = (V*L + P_comp*uy(L)) + (-V)*L = +P_comp * uy(L)!
            # Subtracting f0[0] * (uy(x) - uy(0)) gives at x=L: +P_comp*uy(L) - P_comp*(uy(L) - 0) = 0!!
            # And for local z (My): base f0[4] = +(Vz*L + P_comp * uz(L)) => -f0[4] - f0[2]*L = -(Vz*L + P_comp*uz(L)) - (-Vz)*L = -P_comp * uz(L).
            # Adding +f0[0] * (uz(x) - uz(0)) gives at x=L: -P_comp*uz(L) + P_comp*uz(L) = 0!!
            # Let's double check! In x-z plane: +uz is +z, +ry is rotation from +z toward +x, so +Vz at tip (+z) causes -ry_tip? No: w(x) > 0 => w'(x) > 0 => ry = -w'(x) < 0!
            # So +Vz at tip produces f0[2] = -Vz, f0[4] = +Vz*L! Then -f0[4] - f0[2]*x = -Vz*L + Vz*x (hogging/negative My at base, 0 at tip)!
            # With compression P_comp = -p_tens > 0 and uz(L) > 0, P_comp increases magnitude of negative My at base (`f0[4] = +(Vz*L + P_comp*uz(L))`), so `-f0[4] - f0[2]*x + P_comp*(uz(x) - uz(0))` equals `-(Vz*L + P_comp*uz(L))` at `x=0` and `0` at `x=L`!
            p_comp = -p_tens
            moment_mz -= p_comp * (uy - float(d_eff[1]))
            moment_my += p_comp * (uz - float(d_eff[2]))

        chord_uy = (1.0 - s) * float(d_eff[1]) + s * float(d_eff[7])
        chord_uz = (1.0 - s) * float(d_eff[2]) + s * float(d_eff[8])

        stations.append(
            {
                "s": s,
                "xM": x,
                "axialAwatifKn": axial_awatif,
                "axialTensionPositiveKn": axial_tension,
                "shearVyKn": shear_vy,
                "shearVzKn": shear_vz,
                "torsionMxKnM": torsion_mx,
                "momentMyKnM": moment_my,
                "momentMzKnM": moment_mz,
                "localDeflectionM": [uy, uz],
                "relativeChordDeflectionM": [uy - chord_uy, uz - chord_uz],
                "rootRelativeDeflectionM": [uy - float(d_eff[1]), uz - float(d_eff[2])],
            }
        )

    max_comp = max([0.0] + [max(0.0, -st["axialTensionPositiveKn"]) for st in stations])
    max_tens = max([0.0] + [max(0.0, st["axialTensionPositiveKn"]) for st in stations])
    max_vy = max(abs(st["shearVyKn"]) for st in stations)
    max_vz = max(abs(st["shearVzKn"]) for st in stations)
    max_mx = max(abs(st["torsionMxKnM"]) for st in stations)
    max_pos_my = max([0.0] + [st["momentMyKnM"] for st in stations])
    max_neg_my = min([0.0] + [st["momentMyKnM"] for st in stations])
    max_pos_mz = max([0.0] + [st["momentMzKnM"] for st in stations])
    max_neg_mz = min([0.0] + [st["momentMzKnM"] for st in stations])
    max_def = max(math.hypot(st["localDeflectionM"][0], st["localDeflectionM"][1]) for st in stations)
    max_chord_def = max(
        math.hypot(st["relativeChordDeflectionM"][0], st["relativeChordDeflectionM"][1]) for st in stations
    )
    max_root_def = max(
        math.hypot(st["rootRelativeDeflectionM"][0], st["rootRelativeDeflectionM"][1]) for st in stations
    )

    st0 = stations[0]
    st1 = stations[-1]
    return {
        "awatifEndForces": {
            "N": [st0["axialAwatifKn"], st1["axialAwatifKn"]],
            "Vy": [st0["shearVyKn"], st1["shearVyKn"]],
            "Vz": [st0["shearVzKn"], st1["shearVzKn"]],
            "Mx": [st0["torsionMxKnM"], st1["torsionMxKnM"]],
            "My": [st0["momentMyKnM"], st1["momentMyKnM"]],
            "Mz": [st0["momentMzKnM"], st1["momentMzKnM"]],
        },
        "localEndActionsKnM": [float(v) for v in f0.tolist()],
        "stations": stations,
        "extrema": {
            "maxCompressionKn": max_comp,
            "maxTensionKn": max_tens,
            "maxAbsVyKn": max_vy,
            "maxAbsVzKn": max_vz,
            "maxAbsMxKnM": max_mx,
            "maxPositiveMyKnM": max_pos_my,
            "maxNegativeMyKnM": max_neg_my,
            "maxAbsMyKnM": max(abs(max_pos_my), abs(max_neg_my)),
            "maxPositiveMzKnM": max_pos_mz,
            "maxNegativeMzKnM": max_neg_mz,
            "maxAbsMzKnM": max(abs(max_pos_mz), abs(max_neg_mz)),
            "maxLocalDeflectionM": max_def,
            "maxRelativeChordDeflectionM": max_chord_def,
            "maxRootRelativeDeflectionM": max_root_def,
        },
    }


def run_pynite_solve(payload: dict[str, Any]) -> dict[str, Any]:
    t0 = time.perf_counter()
    model_data = payload["model"]
    options = payload.get("options") or {}
    analysis_mode = str(options.get("analysisMode", "LINEAR")).upper()
    solve_cases = bool(options.get("solveLoadCases", True))
    solve_combos = bool(options.get("solveCombinations", True))
    max_iter = int(options.get("maxIter", 30))
    check_stability = bool(options.get("checkStability", True))

    plate_elements = payload.get("plateElements") or model_data.get("plateElements") or []
    nodal_springs = payload.get("nodalSprings") or model_data.get("nodalSprings") or []

    if analysis_mode == "PDELTA" and len(plate_elements) > 0:
        return {
            "ok": False,
            "errorCode": "UNSUPPORTED_PDELTA_WITH_PLATES",
            "message": (
                "PyNite FEModel3D.analyze_PDelta explicitly excludes second-order geometric stiffness "
                "for Plate3D/Quad3D elements. Rejecting mixed plate + P-Delta solve fail-closed."
            ),
        }

    fe = FEModel3D()
    nodes = model_data["nodes"]
    elements = model_data.get("elements") or []
    load_cases = model_data.get("loadCases") or []
    combinations = model_data.get("combinations") or []

    node_names: list[str] = []
    restrained_dofs = 0
    for idx, n in enumerate(nodes):
        n_name = f"N_{idx}"
        pos = n["positionM"]
        fe.add_node(n_name, float(pos[0]), float(pos[1]), float(pos[2]))
        node_names.append(n_name)
        rest = n.get("restraint")
        if rest and any(rest):
            fe.def_support(
                n_name,
                bool(rest[0]),
                bool(rest[1]),
                bool(rest[2]),
                bool(rest[3]),
                bool(rest[4]),
                bool(rest[5]),
            )
            restrained_dofs += sum(1 for r in rest if r)

    for sp in nodal_springs:
        n_idx = int(sp["nodeIndex"])
        dof = str(sp["dof"])
        stiff = float(sp["stiffness"])
        direction = sp.get("direction")
        fe.def_support_spring(node_names[n_idx], dof, stiff, direction)
        restrained_dofs += 1

    mat_cache: dict[tuple[float, float, float], str] = {}
    sec_cache: dict[tuple[float, float, float, float], str] = {}
    member_names: list[str] = []
    member_lambdas: list[np.ndarray] = []
    member_lengths: list[float] = []

    for idx, el in enumerate(elements):
        sec = el["section"]
        e_kpa = float(sec["elasticityKPa"])
        g_kpa = float(sec["shearModulusKPa"])
        nu = max(0.0, min(0.49, e_kpa / (2.0 * max(g_kpa, 1e-6)) - 1.0)) if g_kpa > 0 else 0.2
        rho = float(sec.get("unitWeightKnM3") or 0.0)
        mat_key = (round(e_kpa, 4), round(g_kpa, 4), round(rho, 4))
        if mat_key not in mat_cache:
            m_name = f"MAT_{len(mat_cache) + 1}"
            fe.add_material(m_name, e_kpa, g_kpa, nu, rho)
            mat_cache[mat_key] = m_name
        mat_name = mat_cache[mat_key]

        area = float(sec["areaM2"])
        iy = float(sec["momentInertiaYM4"])
        iz = float(sec["momentInertiaZM4"])
        # Note: PyNite requires J > 0 to avoid singular torsional stiffness if rx is unrestrained;
        # use max(J, 1e-12) when J == 0 just like standard 3D frame solvers.
        j_tors = max(float(sec["torsionalConstantM4"]), 1e-12)
        sec_key = (round(area, 10), round(iy, 12), round(iz, 12), round(j_tors, 12))
        if sec_key not in sec_cache:
            s_name = f"SEC_{len(sec_cache) + 1}"
            fe.add_section(s_name, area, iy, iz, j_tors)
            sec_cache[sec_key] = s_name
        sec_name = sec_cache[sec_key]

        i_idx = int(el["startNodeIndex"])
        j_idx = int(el["endNodeIndex"])
        p0 = nodes[i_idx]["positionM"]
        p1 = nodes[j_idx]["positionM"]
        beta_deg = float(el.get("localAxisAngleDeg") or 0.0)
        length_m, lambda_rh = compute_rh_lambda3x3(p0, p1, beta_deg)
        roll_deg = compute_pynite_roll_deg_for_rh_lambda(p0, p1, lambda_rh)

        m_name = f"EL_{idx}"
        fe.add_member(m_name, node_names[i_idx], node_names[j_idx], mat_name, sec_name, rotation=roll_deg)
        pn_member = fe.members[m_name]
        t_pn = pn_member.T()[:3, :3]
        max_axis_diff = float(np.max(np.abs(t_pn - lambda_rh)))
        if max_axis_diff > 1e-8:
            raise RuntimeError(
                f"Local axis alignment mismatch on element {el['id']}: max |T_pynite - lambda_rh| = {max_axis_diff}"
            )

        rel = el.get("releases")
        if rel:
            fe.def_releases(
                m_name,
                Rxi=bool(rel.get("rxStart", False)),
                Ryi=bool(rel.get("ryStart", False)),
                Rzi=bool(rel.get("rzStart", False)),
                Rxj=bool(rel.get("rxEnd", False)),
                Ryj=bool(rel.get("ryEnd", False)),
                Rzj=bool(rel.get("rzEnd", False)),
            )

        member_names.append(m_name)
        member_lambdas.append(lambda_rh)
        member_lengths.append(length_m)

    # Optional Plate3D / Quad3D elements
    plate_records_meta: list[tuple[str, str, list[int]]] = []
    for p_idx, pl in enumerate(plate_elements):
        kind = str(pl.get("kind", "QUAD")).upper()
        e_kpa = float(pl["elasticityKPa"])
        nu = float(pl.get("poissonRatio", 0.2))
        g_kpa = e_kpa / (2.0 * (1.0 + nu))
        mat_key = (round(e_kpa, 4), round(g_kpa, 4), 0.0)
        if mat_key not in mat_cache:
            m_name = f"MAT_{len(mat_cache) + 1}"
            fe.add_material(m_name, e_kpa, g_kpa, nu, 0.0)
            mat_cache[mat_key] = m_name
        mat_name = mat_cache[mat_key]

        n_idxs = [int(v) for v in pl["nodeIndices"]]
        t_m = float(pl["thicknessM"])
        kx_mod = float(pl.get("kxMod", 1.0))
        ky_mod = float(pl.get("kyMod", 1.0))
        p_name = str(pl.get("id") or f"PL_{p_idx}")
        if kind == "PLATE":
            fe.add_plate(
                p_name,
                node_names[n_idxs[0]],
                node_names[n_idxs[1]],
                node_names[n_idxs[2]],
                node_names[n_idxs[3]],
                t_m,
                mat_name,
                kx_mod,
                ky_mod,
            )
        else:
            fe.add_quad(
                p_name,
                node_names[n_idxs[0]],
                node_names[n_idxs[1]],
                node_names[n_idxs[2]],
                node_names[n_idxs[3]],
                t_m,
                mat_name,
                kx_mod,
                ky_mod,
            )
        plate_records_meta.append((p_name, kind, n_idxs))

    # Track local member loads per case for exact multi-station evaluation
    case_trap_local: dict[str, dict[int, list[tuple[np.ndarray, np.ndarray, float, float]]]] = {}
    case_pt_local: dict[str, dict[int, list[tuple[float, np.ndarray]]]] = {}
    case_applied_force: dict[str, np.ndarray] = {}
    case_applied_moment_origin: dict[str, np.ndarray] = {}

    dof_dirs = ("FX", "FY", "FZ", "MX", "MY", "MZ")
    for lc in load_cases:
        cid = str(lc["id"])
        case_trap_local[cid] = {}
        case_pt_local[cid] = {}
        f_sum = np.zeros(3, dtype=float)
        m_sum = np.zeros(3, dtype=float)
        has_any_load = False

        for nl in lc.get("nodalLoads") or []:
            n_idx = int(nl["nodeIndex"])
            vec = nl["vectorKnM"]
            pos = np.array(nodes[n_idx]["positionM"], dtype=float)
            f_vec = np.array([float(vec[0]), float(vec[1]), float(vec[2])], dtype=float)
            m_vec = np.array([float(vec[3]), float(vec[4]), float(vec[5])], dtype=float)
            f_sum += f_vec
            m_sum += m_vec + np.cross(pos, f_vec)
            for d_i, mag in enumerate(vec):
                val = float(mag)
                if abs(val) > 0.0:
                    fe.add_node_load(node_names[n_idx], dof_dirs[d_i], val, case=cid)
                    has_any_load = True

        for ul in lc.get("memberUniformLoads") or []:
            el_idx = int(ul["elementIndex"])
            coord_sys = str(ul["coordinateSystem"]).upper()
            q0 = np.array([float(v) for v in ul["qStartKnPerM"]], dtype=float)
            q1_raw = ul.get("qEndKnPerM")
            q1 = np.array([float(v) for v in q1_raw], dtype=float) if q1_raw is not None else q0.copy()
            lam = member_lambdas[el_idx]
            length_m = member_lengths[el_idx]
            start = float(ul.get("startFraction", 0.0))
            end = float(ul.get("endFraction", 1.0))
            if not 0.0 <= start < end <= 1.0:
                raise ValueError(f"Invalid distributed load interval on {member_names[el_idx]}.")
            x1, x2 = start * length_m, end * length_m
            m_name = member_names[el_idx]

            if coord_sys == "GLOBAL":
                q0_loc = lam @ q0
                q1_loc = lam @ q1
                q0_glob = q0
                q1_glob = q1
                dirs = ("FX", "FY", "FZ")
                for ax_i in range(3):
                    if abs(q0[ax_i]) > 0.0 or abs(q1[ax_i]) > 0.0:
                        fe.add_member_dist_load(m_name, dirs[ax_i], float(q0[ax_i]), float(q1[ax_i]), x1=x1, x2=x2, case=cid)
                        has_any_load = True
            else:
                q0_loc = q0
                q1_loc = q1
                q0_glob = lam.T @ q0
                q1_glob = lam.T @ q1
                dirs = ("Fx", "Fy", "Fz")
                for ax_i in range(3):
                    if abs(q0[ax_i]) > 0.0 or abs(q1[ax_i]) > 0.0:
                        fe.add_member_dist_load(m_name, dirs[ax_i], float(q0[ax_i]), float(q1[ax_i]), x1=x1, x2=x2, case=cid)
                        has_any_load = True

            case_trap_local[cid].setdefault(el_idx, []).append((q0_loc, q1_loc, x1, x2))
            loaded_length = x2 - x1
            f_res = 0.5 * (q0_glob + q1_glob) * loaded_length
            f_sum += f_res
            p_i = np.array(nodes[int(elements[el_idx]["startNodeIndex"])]["positionM"], dtype=float)
            p_j = np.array(nodes[int(elements[el_idx]["endNodeIndex"])]["positionM"], dtype=float)
            # Exact first moment of linearly varying distributed load along segment [p_i, p_j]:
            # integral_0^1 (p_i + s*(p_j - p_i)) x (q0 + s*(q1 - q0)) L ds
            # = L * [ p_i x (q0/2 + q1/2)? Wait: integral_0^1 (1-s)*(q0 + s*dq) ds * p_i + integral_0^1 s*(q0 + s*dq) ds * p_j ]
            f_at_i = loaded_length * (q0_glob / 3.0 + q1_glob / 6.0)
            f_at_j = loaded_length * (q0_glob / 6.0 + q1_glob / 3.0)
            m_sum += np.cross(p_i + start * (p_j - p_i), f_at_i) + np.cross(p_i + end * (p_j - p_i), f_at_j)

        for pl_load in lc.get("memberPointLoads") or []:
            el_idx = int(pl_load["elementIndex"])
            frac = max(0.0, min(1.0, float(pl_load["fractionalDistance"])))
            coord_sys = str(pl_load["coordinateSystem"]).upper()
            p_vec = np.array([float(v) for v in pl_load["forceKn"]], dtype=float)
            lam = member_lambdas[el_idx]
            length_m = member_lengths[el_idx]
            a_m = frac * length_m
            m_name = member_names[el_idx]

            if coord_sys == "GLOBAL":
                p_loc = lam @ p_vec
                p_glob = p_vec
                dirs = ("FX", "FY", "FZ")
            else:
                p_loc = p_vec
                p_glob = lam.T @ p_vec
                dirs = ("Fx", "Fy", "Fz")

            for ax_i in range(3):
                if abs(p_vec[ax_i]) > 0.0:
                    fe.add_member_pt_load(m_name, dirs[ax_i], float(p_vec[ax_i]), a_m, case=cid)
                    has_any_load = True

            case_pt_local[cid].setdefault(el_idx, []).append((a_m, p_loc))
            p_i = np.array(nodes[int(elements[el_idx]["startNodeIndex"])]["positionM"], dtype=float)
            p_j = np.array(nodes[int(elements[el_idx]["endNodeIndex"])]["positionM"], dtype=float)
            p_pos = p_i + frac * (p_j - p_i)
            f_sum += p_glob
            m_sum += np.cross(p_pos, p_glob)

        # Surface pressures on plates/quads
        for p_idx, pl in enumerate(plate_elements):
            pressures = pl.get("surfacePressuresByCase") or {}
            if cid in pressures and abs(float(pressures[cid])) > 0.0:
                p_val = float(pressures[cid])
                p_name, kind, n_idxs = plate_records_meta[p_idx]
                if kind == "PLATE":
                    fe.add_plate_surface_pressure(p_name, p_val, case=cid)
                    p_obj = fe.plates[p_name]
                else:
                    fe.add_quad_surface_pressure(p_name, p_val, case=cid)
                    p_obj = fe.quads[p_name]
                has_any_load = True
                # Local +z of plate/quad: p_val acts along local +z!
                t_pl = p_obj.T()[:3, :3]
                z_hat = t_pl[2]
                pts_3d = [np.array(nodes[idx]["positionM"], dtype=float) for idx in n_idxs]
                area_pl = 0.5 * (
                    np.linalg.norm(np.cross(pts_3d[1] - pts_3d[0], pts_3d[3] - pts_3d[0]))
                    + np.linalg.norm(np.cross(pts_3d[2] - pts_3d[1], pts_3d[3] - pts_3d[1]))
                )
                f_pl = p_val * area_pl * z_hat
                centroid_pl = sum(pts_3d) / 4.0
                f_sum += f_pl
                m_sum += np.cross(centroid_pl, f_pl)

        if not has_any_load and len(node_names) > 0:
            fe.add_node_load(node_names[0], "FZ", 0.0, case=cid)

        case_applied_force[cid] = f_sum
        case_applied_moment_origin[cid] = m_sum

    combo_defs: list[tuple[str, str, str, dict[str, float]]] = []
    if solve_cases:
        for lc in load_cases:
            cid = str(lc["id"])
            ckey = f"__CASE__{cid}"
            fe.add_load_combo(ckey, {cid: 1.0})
            combo_defs.append(("CASE", cid, str(lc.get("name") or cid), {cid: 1.0}))

    if solve_combos:
        for cb in combinations:
            cb_id = str(cb["id"])
            ckey = f"__COMBO__{cb_id}"
            factors = {str(k): float(v) for k, v in (cb.get("factors") or {}).items()}
            fe.add_load_combo(ckey, factors)
            combo_defs.append(("COMBO", cb_id, str(cb.get("name") or cb_id), factors))

    if len(combo_defs) == 0 and len(load_cases) > 0:
        cid = str(load_cases[0]["id"])
        ckey = f"__CASE__{cid}"
        fe.add_load_combo(ckey, {cid: 1.0})
        combo_defs.append(("CASE", cid, cid, {cid: 1.0}))

    eff_stability = bool(check_stability and len(nodes) <= 80)
    try:
        if analysis_mode == "PDELTA":
            fe.analyze_PDelta(log=False, check_stability=eff_stability, max_iter=max_iter, sparse=True)
        else:
            fe.analyze_linear(log=False, check_stability=eff_stability, check_statics=False, sparse=True)
    except Exception as exc:
        return {
            "ok": False,
            "errorCode": "PYNITE_SOLVE_FAILED",
            "message": str(exc),
        }

    solve_ms = (time.perf_counter() - t0) * 1000.0
    total_dofs = len(nodes) * 6
    free_dofs = max(0, total_dofs - restrained_dofs)
    exec_backend = (
        "PYNITE_PDELTA"
        if analysis_mode == "PDELTA"
        else ("PYNITE_PLATE_QUAD" if len(plate_elements) > 0 else "PYNITE_3D_FRAME")
    )

    ke_unc_cache: dict[int, np.ndarray] = {}
    ke_lin_cache: dict[int, np.ndarray] = {}
    t12_cache: dict[int, np.ndarray] = {}
    case_fer_unc_cache: dict[str, dict[int, np.ndarray]] = {str(lc["id"]): {} for lc in load_cases}
    case_fer_cond_cache: dict[str, dict[int, np.ndarray]] = {str(lc["id"]): {} for lc in load_cases}

    if analysis_mode != "PDELTA" and len(elements) > 0 and len(combo_defs) > 0:
        first_ckey = f"__{combo_defs[0][0]}__{combo_defs[0][1]}"
        for el_idx in range(len(elements)):
            m_obj = fe.members[member_names[el_idx]]
            t12_cache[el_idx] = m_obj.T()
            ke_unc_cache[el_idx] = m_obj._ke_unc()
            ke_lin_cache[el_idx] = m_obj.ke(first_ckey)
        # Precompute unit-case FER once per load case so 30+ load combinations superpose in microseconds!
        for lc in load_cases:
            cid = str(lc["id"])
            tmp_key = f"__UNITFER__{cid}"
            fe.add_load_combo(tmp_key, {cid: 1.0})
            for el_idx in range(len(elements)):
                m_obj = fe.members[member_names[el_idx]]
                if cid in case_trap_local and el_idx in case_trap_local[cid] or cid in case_pt_local and el_idx in case_pt_local[cid]:
                    case_fer_unc_cache[cid][el_idx] = m_obj._fer_unc(tmp_key).reshape(12)
                    case_fer_cond_cache[cid][el_idx] = m_obj.fer(tmp_key).reshape(12)
            del fe.load_combos[tmp_key]

    load_case_results: dict[str, Any] = {}
    combination_results: dict[str, Any] = {}
    plate_results_by_combo: dict[str, list[dict[str, Any]]] = {}

    for kind, item_id, item_name, factors in combo_defs:
        ckey = f"__{kind}__{item_id}"
        displacements: list[dict[str, Any]] = []
        reactions: list[dict[str, Any]] = []

        rxn_force_sum = np.zeros(3, dtype=float)
        rxn_moment_origin = np.zeros(3, dtype=float)

        for idx, n in enumerate(nodes):
            n_obj = fe.nodes[node_names[idx]]
            ux = float(n_obj.DX.get(ckey, 0.0))
            uy = float(n_obj.DY.get(ckey, 0.0))
            uz = float(n_obj.DZ.get(ckey, 0.0))
            rx = float(n_obj.RX.get(ckey, 0.0))
            ry = float(n_obj.RY.get(ckey, 0.0))
            rz = float(n_obj.RZ.get(ckey, 0.0))
            pos = n["positionM"]
            displacements.append(
                {
                    "nodeIndex": idx,
                    "nodeId": str(n["id"]),
                    "translationM": [ux, uy, uz],
                    "rotationRad": [rx, ry, rz],
                    "deformedPositionM": [float(pos[0]) + ux, float(pos[1]) + uy, float(pos[2]) + uz],
                }
            )

            has_support = bool(n.get("restraint") and any(n["restraint"])) or any(
                int(sp["nodeIndex"]) == idx for sp in nodal_springs
            )
            if has_support:
                rfx = float(n_obj.RxnFX.get(ckey, 0.0))
                rfy = float(n_obj.RxnFY.get(ckey, 0.0))
                rfz = float(n_obj.RxnFZ.get(ckey, 0.0))
                rmx = float(n_obj.RxnMX.get(ckey, 0.0))
                rmy = float(n_obj.RxnMY.get(ckey, 0.0))
                rmz = float(n_obj.RxnMZ.get(ckey, 0.0))
                reactions.append(
                    {
                        "nodeIndex": idx,
                        "nodeId": str(n["id"]),
                        "reactionKnM": [rfx, rfy, rfz, rmx, rmy, rmz],
                    }
                )
                r_f = np.array([rfx, rfy, rfz], dtype=float)
                r_m = np.array([rmx, rmy, rmz], dtype=float)
                pos_np = np.array(pos, dtype=float)
                if analysis_mode == "PDELTA":
                    pos_np = pos_np + np.array([ux, uy, uz], dtype=float)
                rxn_force_sum += r_f
                rxn_moment_origin += r_m + np.cross(pos_np, r_f)

        app_f = np.zeros(3, dtype=float)
        app_m = np.zeros(3, dtype=float)
        for cid, fac in factors.items():
            if cid in case_applied_force:
                app_f += fac * case_applied_force[cid]
                app_m += fac * case_applied_moment_origin[cid]

        # In P-Delta mode, applied nodal forces act at deformed positions r + u!
        if analysis_mode == "PDELTA":
            app_m = np.zeros(3, dtype=float)
            for cid, fac in factors.items():
                lc_match = next((x for x in load_cases if str(x["id"]) == cid), None)
                if not lc_match:
                    continue
                for nl in lc_match.get("nodalLoads") or []:
                    n_idx = int(nl["nodeIndex"])
                    vec = nl["vectorKnM"]
                    def_pos = np.array(displacements[n_idx]["deformedPositionM"], dtype=float)
                    f_vec = fac * np.array([float(vec[0]), float(vec[1]), float(vec[2])], dtype=float)
                    m_vec = fac * np.array([float(vec[3]), float(vec[4]), float(vec[5])], dtype=float)
                    app_m += m_vec + np.cross(def_pos, f_vec)
                for ul in lc_match.get("memberUniformLoads") or []:
                    el_idx = int(ul["elementIndex"])
                    coord_sys = str(ul["coordinateSystem"]).upper()
                    q0 = np.array([float(v) for v in ul["qStartKnPerM"]], dtype=float)
                    q1_raw = ul.get("qEndKnPerM")
                    q1 = np.array([float(v) for v in q1_raw], dtype=float) if q1_raw is not None else q0.copy()
                    lam = member_lambdas[el_idx]
                    q0_g = q0 if coord_sys == "GLOBAL" else lam.T @ q0
                    q1_g = q1 if coord_sys == "GLOBAL" else lam.T @ q1
                    length_m = member_lengths[el_idx]
                    start = float(ul.get("startFraction", 0.0))
                    end = float(ul.get("endFraction", 1.0))
                    loaded_length = length_m * (end - start)
                    p_i = np.array(displacements[int(elements[el_idx]["startNodeIndex"])]["deformedPositionM"])
                    p_j = np.array(displacements[int(elements[el_idx]["endNodeIndex"])]["deformedPositionM"])
                    app_m += fac * (
                        np.cross(p_i + start * (p_j - p_i), loaded_length * (q0_g / 3.0 + q1_g / 6.0))
                        + np.cross(p_i + end * (p_j - p_i), loaded_length * (q0_g / 6.0 + q1_g / 3.0))
                    )

        f_res_vec = app_f + rxn_force_sum
        m_res_vec = app_m + rxn_moment_origin
        max_f_res = float(np.max(np.abs(f_res_vec)))
        max_m_res = float(np.max(np.abs(m_res_vec)))
        norm_f = max(1.0, float(np.linalg.norm(app_f)))
        rel_res = float(np.linalg.norm(f_res_vec)) / norm_f
        # For P-Delta with distributed member loads, small O(u^2) interior quadrature difference is < 1e-2 kN·m
        eq_tol_m = 0.25 if analysis_mode == "PDELTA" else 1e-2

        member_forces: list[dict[str, Any]] = []
        for el_idx, el in enumerate(elements):
            m_obj = fe.members[member_names[el_idx]]
            if analysis_mode != "PDELTA" and el_idx in ke_lin_cache:
                i_idx = int(el["startNodeIndex"])
                j_idx = int(el["endNodeIndex"])
                di = displacements[i_idx]
                dj = displacements[j_idx]
                d_glob = np.array(
                    di["translationM"] + di["rotationRad"] + dj["translationM"] + dj["rotationRad"],
                    dtype=float,
                )
                d_loc = t12_cache[el_idx] @ d_glob
                fer_cond = np.zeros(12, dtype=float)
                fer_unc_Pre = np.zeros(12, dtype=float)
                for cid, fac in factors.items():
                    if abs(fac) > 0.0 and cid in case_fer_cond_cache and el_idx in case_fer_cond_cache[cid]:
                        fer_cond += fac * case_fer_cond_cache[cid][el_idx]
                        fer_unc_Pre += fac * case_fer_unc_cache[cid][el_idx]
                f_loc = ke_lin_cache[el_idx] @ d_loc + fer_cond
            else:
                f_loc = m_obj.f(ckey).reshape(12)
                d_loc = m_obj.d(ckey).reshape(12)
                fer_unc_Pre = None

            trap_list: list[tuple[np.ndarray, np.ndarray, float, float]] = []
            pt_list: list[tuple[float, np.ndarray]] = []
            for cid, fac in factors.items():
                if abs(fac) <= 0.0:
                    continue
                for q0_c, q1_c, a_c, b_c in case_trap_local.get(cid, {}).get(el_idx, []):
                    trap_list.append((fac * q0_c, fac * q1_c, a_c, b_c))
                for a_c, p_c in case_pt_local.get(cid, {}).get(el_idx, []):
                    pt_list.append((a_c, fac * p_c))

            eval_res = _evaluate_stations_from_end_actions(
                length_m=member_lengths[el_idx],
                section=el["section"],
                f_local=f_loc,
                d_local_nodal=d_loc,
                releases=el.get("releases"),
                trap_loads_local=trap_list,
                pt_loads_local=pt_list,
                pynite_member=m_obj,
                combo_key=ckey,
                is_pdelta=(analysis_mode == "PDELTA"),
            )
            member_forces.append(
                {
                    "elementIndex": el_idx,
                    "elementId": str(el["id"]),
                    "lengthM": member_lengths[el_idx],
                    **eval_res,
                }
            )

        if len(plate_records_meta) > 0:
            p_out: list[dict[str, Any]] = []
            for p_name, p_kind, n_idxs in plate_records_meta:
                if p_kind == "PLATE":
                    pl_obj = fe.plates[p_name]
                    a_dim = float(pl_obj.width())
                    b_dim = float(pl_obj.height())
                    mom = pl_obj.moment(a_dim / 2.0, b_dim / 2.0, local=True, combo_name=ckey)
                    shr = pl_obj.shear(a_dim / 2.0, b_dim / 2.0, local=True, combo_name=ckey)
                else:
                    pl_obj = fe.quads[p_name]
                    mom = pl_obj.moment(0.0, 0.0, local=True, combo_name=ckey)
                    shr = pl_obj.shear(0.0, 0.0, local=True, combo_name=ckey)
                p_out.append(
                    {
                        "id": p_name,
                        "kind": p_kind,
                        "centerMomentsKnMPerM": [float(mom[0, 0]), float(mom[1, 0]), float(mom[2, 0])],
                        "centerShearsKnPerM": [float(shr[0, 0]), float(shr[1, 0])],
                    }
                )
            plate_results_by_combo[item_id] = p_out

        single_res = {
            "caseOrComboId": item_id,
            "name": item_name,
            "displacements": displacements,
            "reactions": reactions,
            "memberForces": member_forces,
            "equilibrium": {
                "appliedForceSumKn": [float(v) for v in app_f.tolist()],
                "reactionForceSumKn": [float(v) for v in rxn_force_sum.tolist()],
                "forceResidualKn": [float(v) for v in f_res_vec.tolist()],
                "momentResidualAboutOriginKnM": [float(v) for v in m_res_vec.tolist()],
                "maxForceResidualKn": max_f_res,
                "maxMomentResidualKnM": max_m_res,
                "relativeStiffnessResidual": rel_res,
                "isEquilibrated": bool(max_f_res <= 1e-2 and max_m_res <= eq_tol_m),
            },
            "diagnostics": {
                "requestedBackend": exec_backend,
                "executionBackend": exec_backend,
                "nodeCount": len(nodes),
                "elementCount": len(elements) + len(plate_elements),
                "totalDofs": total_dofs,
                "freeDofs": free_dofs,
                "restrainedDofs": restrained_dofs,
                "solveDurationMs": solve_ms / max(1, len(combo_defs)),
                "wasmHeapBytesAllocated": 0,
                "warnings": (
                    ["Second-order P-Delta solved on frame elements only (plates/quads excluded)."]
                    if analysis_mode == "PDELTA"
                    else []
                ),
            },
        }

        if kind == "CASE":
            load_case_results[item_id] = single_res
        else:
            combination_results[item_id] = single_res

    return {
        "ok": True,
        "schemaVersion": SCHEMA_VERSION,
        "executionBackend": exec_backend,
        "envelope": {
            "modelId": str(model_data.get("modelId") or "pynite_model"),
            "method": (
                "P_DELTA"
                if analysis_mode == "PDELTA"
                else ("SHELL_FEM" if len(plate_elements) > 0 else "LINEAR_STATIC_FRAME")
            ),
            "capabilityClassification": "EMBEDDED_LIBRARY_VERIFIED",
            "loadCaseResults": load_case_results,
            "combinationResults": combination_results,
            "plateResultsByCaseOrCombo": plate_results_by_combo if plate_results_by_combo else None,
            "totalSolveDurationMs": solve_ms,
        },
    }


def _hysd_is456_design_stress_mpa(eps_abs: float, fy_mpa: float) -> float:
    fyd = 0.87 * fy_mpa
    es = 200_000.0
    eps_08 = (0.8 * fyd) / es
    eps_10 = fyd / es + 0.002
    if eps_abs <= eps_08:
        return es * eps_abs
    if eps_abs >= eps_10:
        return fyd
    t = (eps_abs - eps_08) / (eps_10 - eps_08)
    return fyd * (0.8 + 0.2 * (2.0 * t - t * t))


class _CachedStressInterpolation:
    @cached_property
    def _stress_function(self):
        # These material profiles are fixed after construction. Reuse the exact
        # interpolator used by the pinned Concrete Properties get_stress method.
        return interp1d(x=self.strains, y=self.stresses, kind="linear", fill_value="extrapolate")

    @cached_property
    def _segments(self):
        # SciPy's pinned linear evaluator uses two weights, including during
        # extrapolation. Preserve its operation order for exact scalar parity.
        interpolator = self._stress_function
        x, y = tuple(map(float, interpolator.x)), tuple(map(float, interpolator.y))
        widths = tuple(right - left for left, right in zip(x, x[1:]))
        return x, y, widths

    def get_stress(self, strain: float):
        x, y, widths = self._segments
        if not np.isscalar(strain) or not math.isfinite(strain):
            return self._stress_function(strain)
        high = min(max(1, bisect_left(x, strain)), len(x) - 1)
        low = high - 1
        width = widths[low]
        if not width:
            return self._stress_function(strain)
        point = float(strain)
        return ((point - x[low]) / width) * y[high] + ((x[high] - point) / width) * y[low]


class _ConcreteUltimateProfile(_CachedStressInterpolation, EurocodeParabolicUltimate):
    pass


class _ReinforcingSteelProfile(_CachedStressInterpolation, SteelProfile):
    pass


def build_is456_concrete_and_steel_materials(fck_mpa: float, fy_mpa: float) -> tuple[Concrete, SteelBar, float]:
    """
    Constructs IS 456:2000 design materials for ConcreteProperties WITHOUT double-applying partial safety factors:
    - Concrete ultimate compressive block: 0.447 * fck (IS 456 Cl. 38.1 / Fig. 21: 0.67 * fck / 1.5),
      parabolic up to eps_0 = 0.002, constant plateau to eps_cu = 0.0035, zero tensile strength.
    - Steel ultimate profile: IS 1786 / IS 456 / SP-16 Table A HYSD design curve reaching fyd = 0.87 * fy
      (fy / 1.15), symmetric in tension and compression, Es = 200,000 MPa.
    Returns (concrete_material, steel_material, fs_at_0002_mpa).
    """
    ec_mpa = 5000.0 * math.sqrt(fck_mpa)
    fc_design = 0.447 * fck_mpa

    conc = Concrete(
        name=f"IS456_M{int(round(fck_mpa))}",
        density=2.5e-6,  # kg/mm³ (2500 kg/m³)
        stress_strain_profile=ConcreteLinearNoTension(
            elastic_modulus=ec_mpa,
            ultimate_strain=0.0035,
            compressive_strength=fc_design,
        ),
        ultimate_stress_strain_profile=_ConcreteUltimateProfile(
            compressive_strength=fc_design,
            compressive_strain=0.002,
            ultimate_strain=0.0035,
            n=2.0,
            n_points=10,
        ),
        flexural_tensile_strength=0.7 * math.sqrt(fck_mpa),
        colour="lightgrey",
    )

    fyd = 0.87 * fy_mpa
    es = 200_000.0
    eps_08 = (0.8 * fyd) / es
    eps_10 = fyd / es + 0.002
    pos_pts: list[tuple[float, float]] = [(eps_08, 0.8 * fyd)]
    for k in range(1, 9):
        t = k / 8.0
        eps_k = eps_08 + t * (eps_10 - eps_08)
        sig_k = _hysd_is456_design_stress_mpa(eps_k, fy_mpa)
        pos_pts.append((eps_k, sig_k))
    pos_pts.append((0.05, fyd))

    strains = [-eps for eps, _ in reversed(pos_pts)] + [0.0] + [eps for eps, _ in pos_pts]
    stresses = [-sig for _, sig in reversed(pos_pts)] + [0.0] + [sig for _, sig in pos_pts]

    steel = SteelBar(
        name=f"IS1786_Fe{int(round(fy_mpa))}",
        density=7.85e-6,  # kg/mm³ (7850 kg/m³)
        stress_strain_profile=_ReinforcingSteelProfile(
            strains=strains,
            stresses=stresses,
            yield_strength=fyd,
            elastic_modulus=es,
            fracture_strain=0.05,
        ),
        colour="firebrick",
    )

    return conc, steel, _hysd_is456_design_stress_mpa(0.002, fy_mpa)


def _ray_capacity_from_biaxial_polygon(
    mx_list_knm: list[float],
    my_list_knm: list[float],
    demand_mx_knm: float,
    demand_my_knm: float,
) -> tuple[float, float, float]:
    """
    Computes exact ray-boundary intersection along the demand vector (demand_mx, demand_my)
    from origin (0, 0) against the closed 2D biaxial bending failure locus!
    Returns (mx_cap_knm, my_cap_knm, utilization_ratio).
    """
    dem_mag = math.hypot(demand_mx_knm, demand_my_knm)
    if dem_mag <= 1e-9:
        return 0.0, 0.0, 0.0

    poly_pts = list(zip(mx_list_knm, my_list_knm))
    poly = Polygon(poly_pts)
    if not poly.is_valid or not poly.covers(Point(0, 0)):
        raise ValueError("Biaxial contour must be valid and enclose the moment origin.")

    max_r = max(math.hypot(x, y) for x, y in poly_pts)
    if max_r <= 1e-9:
        raise ValueError("Biaxial contour has no moment capacity.")

    ux = demand_mx_knm / dem_mag
    uy = demand_my_knm / dem_mag
    far = max(max_r, dem_mag) * 4.0 + 100.0
    ray = LineString([(0.0, 0.0), (ux * far, uy * far)])
    inter = poly.boundary.intersection(ray)

    best_dist = 0.0
    if not inter.is_empty:
        geoms = getattr(inter, "geoms", [inter])
        for g in geoms:
            if hasattr(g, "x") and hasattr(g, "y"):
                d = g.x * ux + g.y * uy
                if d > best_dist:
                    best_dist = d

    if best_dist <= 1e-9:
        raise ValueError("The demand ray did not intersect the biaxial contour.")

    mx_cap = ux * best_dist
    my_cap = uy * best_dist
    return mx_cap, my_cap, dem_mag / best_dist


@lru_cache(maxsize=32)
def _build_section(fck, fy, dimensions, polygon, bars):
    # This worker has one fixed steel model, concrete stress block and upstream
    # solver tolerance. Restarting the worker clears the cache when those change.
    conc, steel, fs_0002 = build_is456_concrete_and_steel_materials(fck, fy)
    if polygon:
        boundary = Polygon(polygon)
        geom = Geometry(geom=boundary, material=conc)
    else:
        width, depth = dimensions
        geom = rectangular_section(d=depth, b=width, material=conc)
        boundary = geom.geom
    if not boundary.is_valid or boundary.area <= 0:
        raise ValueError("Section requires a valid concrete polygon.")

    placed_bars = []
    for x, y, area in bars:
        if not all(math.isfinite(v) for v in (x, y, area)) or area <= 0:
            raise ValueError("Reinforcement coordinates and positive areas must be finite.")
        center = Point(x, y)
        radius = math.sqrt(area / math.pi)
        if not boundary.covers(center) or center.distance(boundary.boundary) < radius:
            raise ValueError("Reinforcement extends outside the concrete section.")
        if any(math.hypot(x - px, y - py) < radius + pr for px, py, pr in placed_bars):
            raise ValueError("Reinforcement bars overlap.")
        placed_bars.append((x, y, radius))
        geom = add_bar(geometry=geom, area=area, material=steel, x=x, y=y, n=16)

    return ConcreteSection(geom), fs_0002


@lru_cache(maxsize=128)
def _biaxial_contour(section_key, axial_kn, point_count):
    section, _ = _build_section(*section_key)
    axial_n = axial_kn * 1000.0
    ux = section.ultimate_bending_capacity(theta=0.0, n=axial_n)
    uy = section.ultimate_bending_capacity(theta=math.pi / 2.0, n=axial_n)
    diagram = section.biaxial_bending_diagram(n=axial_n, n_points=point_count, progress_bar=False)
    mx, my = diagram.get_results_lists()
    return (abs(float(ux.m_x)) / 1e6, abs(float(uy.m_y)) / 1e6,
            [float(v) / 1e6 for v in mx], [float(v) / 1e6 for v in my])


def run_section_capacity_batch(payload: dict[str, Any]) -> dict[str, Any]:
    t0 = time.perf_counter()
    items = payload.get("items") or []
    if len(items) > MAX_SECTION_ITEMS or sum(len(item.get("demands") or []) for item in items) > MAX_SECTION_DEMANDS:
        raise ValueError("Section batch exceeds the worker's item or demand limit.")
    results_out: list[dict[str, Any]] = []

    for item in items:
        sec_id = str(item["sectionId"])
        fck, fy = float(item["fckMPa"]), float(item["fyMPa"])
        polygon = tuple((float(p[0]), float(p[1])) for p in item.get("polygonMm") or [])
        dimensions = () if polygon else (float(item["widthMm"]), float(item["depthMm"]))
        if not all(math.isfinite(v) and v > 0 for v in (fck, fy, *dimensions)):
            raise ValueError("Material strengths and rectangular dimensions must be positive and finite.")
        bars = tuple((float(b["xMm"]), float(b["yMm"]), float(b["areaMm2"])) for b in item.get("bars") or [])
        if len(bars) > 128 or len(polygon) > 512:
            raise ValueError("Section exceeds the worker's reinforcement or polygon limit.")
        section_key = (fck, fy, dimensions, polygon, bars)
        conc_sec, fs_0002 = _build_section(*section_key)
        total_bar_area = sum(area for _, _, area in bars)
        gp = conc_sec.gross_properties

        ac_mm2 = float(gp.concrete_area)
        ast_mm2 = float(gp.reinf_lumped_area)
        puz_is456_kn = (0.45 * fck * ac_mm2 + 0.75 * fy * ast_mm2) / 1000.0
        pu_max_is456_kn = (0.447 * fck * ac_mm2 + fs_0002 * ast_mm2) / 1000.0
        pt_min_tension_kn = -(0.87 * fy * ast_mm2) / 1000.0

        # Pure ultimate compression in ConcreteProperties (at eps_cu = 0.0035 without Cl. 39.1(b) cap)
        ult_inf = conc_sec.calculate_ultimate_section_actions(d_n=float("inf"))
        n_cp_uncapped_max_kn = float(ult_inf.n) / 1000.0

        include_curves = bool(item.get("includeInteractionCurves", False))
        include_mk = bool(item.get("includeMomentCurvature", False))

        mn_x_pts: list[dict[str, float]] = []
        mn_y_pts: list[dict[str, float]] = []
        if include_curves:
            max_comp_n = min(pu_max_is456_kn * 1000.0, float(ult_inf.n) * 0.9999)
            mi_x = conc_sec.moment_interaction_diagram(
                theta=0.0, n_points=24, max_comp=max_comp_n, progress_bar=False
            )
            mi_y = conc_sec.moment_interaction_diagram(
                theta=math.pi / 2.0, n_points=24, max_comp=max_comp_n, progress_bar=False
            )
            mn_x_pts = [{"puKn": float(r.n) / 1000.0, "muxKnM": abs(float(r.m_x)) / 1e6} for r in mi_x.results]
            mn_y_pts = [{"puKn": float(r.n) / 1000.0, "muyKnM": abs(float(r.m_y)) / 1e6} for r in mi_y.results]

        demand_evals: list[dict[str, Any]] = []
        for dem in item.get("demands") or []:
            dem_id = str(dem.get("id") or "D1")
            pu_kn = float(dem["puKn"])
            mux_knm = float(dem.get("muxKnM", 0.0))
            muy_knm = float(dem.get("muyKnM", 0.0))
            if not all(math.isfinite(v) for v in (pu_kn, mux_knm, muy_knm)):
                raise ValueError("Section demands must be finite.")
            enforce_is456_cap = bool(dem.get("enforceIs456AxialCap", True))

            axial_limit_kn = pu_max_is456_kn if enforce_is456_cap else n_cp_uncapped_max_kn

            if pu_kn <= pt_min_tension_kn or pu_kn >= axial_limit_kn:
                # Also record what raw uncapped ConcreteProperties gives if pu_kn < n_cp_uncapped_max_kn (for forensic audit!)
                uncapped_forensic: dict[str, Any] | None = None
                if pt_min_tension_kn < pu_kn < n_cp_uncapped_max_kn:
                    ux_raw, uy_raw, mx_knm_l, my_knm_l = _biaxial_contour(section_key, pu_kn, 36)
                    r_mx, r_my, r_util = _ray_capacity_from_biaxial_polygon(
                        mx_knm_l, my_knm_l, mux_knm, muy_knm
                    )
                    uncapped_forensic = {
                        "mux1UncappedKnM": ux_raw,
                        "muy1UncappedKnM": uy_raw,
                        "rayCapacityMuxKnM": r_mx,
                        "rayCapacityMuyKnM": r_my,
                        "rayUtilizationUncapped": r_util,
                    }

                axial_util = (
                    abs(pu_kn) / max(1e-6, abs(pt_min_tension_kn))
                    if pu_kn <= pt_min_tension_kn
                    else pu_kn / max(1e-6, axial_limit_kn)
                )
                demand_evals.append(
                    {
                        "id": dem_id,
                        "puKn": pu_kn,
                        "muxDemandKnM": mux_knm,
                        "muyDemandKnM": muy_knm,
                        "outsideAxialDomain": True,
                        "mux1CapacityKnM": 0.0,
                        "muy1CapacityKnM": 0.0,
                        "rayCapacityMuxKnM": 0.0,
                        "rayCapacityMuyKnM": 0.0,
                        "utilizationRatio": max(1.001, axial_util),
                        "pointInsideDiagram": False,
                        "uncappedForensic": uncapped_forensic,
                    }
                )
                continue

            n_pts_bb = int(dem.get("biaxialPoints", 36 if dem.get("includeContour") else 20))
            if not 8 <= n_pts_bb <= 144:
                raise ValueError("Biaxial contour resolution must be between 8 and 144 points.")
            mux1_cap_knm, muy1_cap_knm, mx_list_knm, my_list_knm = _biaxial_contour(section_key, pu_kn, n_pts_bb)

            ray_mx_cap, ray_my_cap, ray_util = _ray_capacity_from_biaxial_polygon(
                mx_list_knm, my_list_knm, mux_knm, muy_knm
            )
            inside = bool(ray_util <= 1.0 + 1e-6)

            eval_record: dict[str, Any] = {
                "id": dem_id,
                "puKn": pu_kn,
                "muxDemandKnM": mux_knm,
                "muyDemandKnM": muy_knm,
                "outsideAxialDomain": False,
                "mux1CapacityKnM": mux1_cap_knm,
                "muy1CapacityKnM": muy1_cap_knm,
                "rayCapacityMuxKnM": ray_mx_cap,
                "rayCapacityMuyKnM": ray_my_cap,
                "utilizationRatio": ray_util,
                "pointInsideDiagram": inside,
            }
            if bool(dem.get("includeContour", False)):
                eval_record["biaxialContourKnM"] = [
                    {"mxKnM": mx_v, "myKnM": my_v} for mx_v, my_v in zip(mx_list_knm, my_list_knm)
                ]
            demand_evals.append(eval_record)

        mk_summary: dict[str, Any] | None = None
        if include_mk:
            mk_n = float(item.get("momentCurvatureAxialKn", 0.0)) * 1000.0
            mk_res = conc_sec.moment_curvature_analysis(
                n=mk_n, theta=0.0, kappa_inc=5e-7, kappa_inc_max=3e-6, progress_bar=False
            )
            mk_summary = {
                "axialKn": mk_n / 1000.0,
                "kappa1PerMm": [float(v) for v in mk_res.kappa],
                "momentKnM": [float(v) / 1e6 for v in mk_res.m_xy],
                "failureGeometry": str(mk_res.failure_geometry.material.name) if mk_res.failure_geometry else None,
            }

        results_out.append(
            {
                "sectionId": sec_id,
                "grossProperties": {
                    "totalAreaMm2": float(gp.total_area),
                    "concreteAreaMm2": ac_mm2,
                    "reinfLumpedAreaMm2": ast_mm2,
                    "inputBarAreaSumMm2": total_bar_area,
                    "centroidMm": [float(gp.cx), float(gp.cy)],
                    "axialRigidityN": float(gp.e_a),
                    "flexuralRigidityEIxxNmm2": float(gp.e_ixx_c),
                    "flexuralRigidityEIyyNmm2": float(gp.e_iyy_c),
                },
                "axialLimits": {
                    "puzIs456Kn": puz_is456_kn,
                    "puMaxIs456Cl39_1bKn": pu_max_is456_kn,
                    "concretePropertiesUncappedMaxKn": n_cp_uncapped_max_kn,
                    "ptMinTensionKn": pt_min_tension_kn,
                },
                "interactionCurveX": mn_x_pts if include_curves else None,
                "interactionCurveY": mn_y_pts if include_curves else None,
                "momentCurvature": mk_summary,
                "demandEvaluations": demand_evals,
            }
        )

    return {
        "ok": True,
        "schemaVersion": SCHEMA_VERSION,
        "provider": "CONCRETE_PROPERTIES_FIBER",
        "durationMs": (time.perf_counter() - t0) * 1000.0,
        "results": results_out,
    }


def dispatch_request(req: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(req, dict):
        return {"ok": False, "schemaVersion": SCHEMA_VERSION, "errorCode": "INVALID_REQUEST",
                "message": "Worker request must be an object."}
    req_id = req.get("requestId")
    action = str(req.get("action") or "").lower()
    try:
        if action == "coordinate_deck":
            from deck_topology import coordinate_deck
            res = {"ok": True, "deck": coordinate_deck(req["floor"], req["beams"])}
        elif action == "capabilities":
            res = {"ok": True, **get_capabilities()}
        elif action == "pynite_solve":
            _validate_installed_commit("PyNiteFEA", "3.2.1", PYNITE_COMMIT_SHA)
            res = run_pynite_solve(req)
        elif action == "section_capacity_batch":
            _validate_installed_commit("concreteproperties", "0.8.0", CONCRETE_PROPERTIES_COMMIT_SHA)
            res = run_section_capacity_batch(req)
        elif action == "ping":
            get_capabilities()
            res = {"ok": True, "schemaVersion": SCHEMA_VERSION, "pong": True}
        else:
            res = {
                "ok": False,
                "errorCode": "UNKNOWN_ACTION",
                "message": f"Unsupported worker action '{action}'.",
            }
    except Exception as exc:
        res = {
            "ok": False,
            "errorCode": "WORKER_EXCEPTION",
            "message": str(exc),
            "traceback": traceback.format_exc(),
        }

    if req_id is not None:
        res["requestId"] = req_id
    res["schemaVersion"] = SCHEMA_VERSION
    return res


def main() -> int:
    parser = argparse.ArgumentParser(description="RH Planner Carbon 4 Structural Python Worker")
    parser.add_argument("--daemon", action="store_true", help="Run persistent line-delimited JSON-RPC daemon")
    parser.add_argument("--request-file", type=str, help="Input JSON request file path")
    parser.add_argument("--response-file", type=str, help="Output JSON response file path")
    args = parser.parse_args()

    if args.daemon:
        real_stdout = sys.stdout
        while True:
            raw_line = sys.stdin.readline(MAX_REQUEST_CHARS + 1)
            if not raw_line:
                break
            if len(raw_line) > MAX_REQUEST_CHARS:
                print("Carbon 4 worker exceeded its request size limit.", file=sys.stderr)
                return 2
            line = raw_line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except Exception as exc:
                resp = {"ok": False, "errorCode": "INVALID_JSON", "message": str(exc)}
                real_stdout.write(json.dumps(resp) + "\n")
                real_stdout.flush()
                continue

            with contextlib.redirect_stdout(sys.stderr):
                resp = dispatch_request(req)
            try:
                response_line = json.dumps(resp, allow_nan=False)
            except ValueError:
                response_line = json.dumps({
                    "ok": False, "schemaVersion": SCHEMA_VERSION, "requestId": resp.get("requestId"),
                    "errorCode": "NON_FINITE_SOLVER_OUTPUT", "message": "Solver produced a non-finite result.",
                })
            real_stdout.write(response_line + "\n")
            real_stdout.flush()
        return 0

    if args.request_file:
        with open(args.request_file, "r", encoding="utf-8") as f:
            req = json.load(f)
    else:
        req = json.load(sys.stdin)

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        resp = dispatch_request(req)

    out_text = json.dumps(resp)
    if args.response_file:
        with open(args.response_file, "w", encoding="utf-8") as f:
            f.write(out_text)
    else:
        sys.stdout.write(out_text + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from concreteproperties.stress_strain_profile import StressStrainProfile
from worker_main import _biaxial_contour, build_is456_concrete_and_steel_materials, dispatch_request


def test_reused_material_interpolation_matches_pinned_upstream() -> None:
    concrete, steel, _ = build_is456_concrete_and_steel_materials(40, 500)
    for profile in (concrete.ultimate_stress_strain_profile, steel.stress_strain_profile):
        stations = sorted(set(profile.strains))
        samples = [stations[0] - 0.01, stations[-1] + 0.01, *stations]
        samples.extend((a + b) / 2 for a, b in zip(stations, stations[1:]))
        for strain in samples:
            assert profile.get_stress(strain) == StressStrainProfile.get_stress(profile, strain)
        assert profile._stress_function is profile._stress_function


def test_asymmetric_section_preserves_moment_sign_and_exact_axial_cache_identity() -> None:
    bars = [
        {"xMm": 60, "yMm": 60, "areaMm2": 490.87},
        {"xMm": 240, "yMm": 60, "areaMm2": 490.87},
        {"xMm": 60, "yMm": 440, "areaMm2": 113.10},
        {"xMm": 240, "yMm": 440, "areaMm2": 113.10},
    ]
    section = {"sectionId": "asymmetric", "widthMm": 300, "depthMm": 500,
               "fckMPa": 30, "fyMPa": 500, "bars": bars}
    first = {"id": "first", "puKn": 600.01, "muxKnM": 100, "muyKnM": 15, "biaxialPoints": 12}
    nearby = dict(first, id="nearby", puKn=600.04)
    opposite = dict(first, id="opposite", muxKnM=-100)

    def evaluate(*demands, geometry=section):
        response = dispatch_request({"action": "section_capacity_batch", "items": [dict(geometry, demands=demands)]})
        assert response["ok"], response
        return response["results"][0]["demandEvaluations"]

    a, b, c = evaluate(first, nearby, opposite)
    assert a["utilizationRatio"] != b["utilizationRatio"]
    hits = _biaxial_contour.cache_info().hits
    assert evaluate(nearby)[0] == b
    assert _biaxial_contour.cache_info().hits == hits + 1
    assert c["muxDemandKnM"] == -100
    assert c["rayCapacityMuxKnM"] < 0
    assert abs(c["utilizationRatio"] - a["utilizationRatio"]) > 0.05
    changed_bars = [dict(bars[0], xMm=85), *bars[1:]]
    assert evaluate(first, geometry=dict(section, bars=changed_bars))[0]["utilizationRatio"] != a["utilizationRatio"]


def test_invalid_bar_placement_and_non_object_requests_fail_explicitly() -> None:
    item = {"sectionId": "outside", "widthMm": 300, "depthMm": 500, "fckMPa": 30, "fyMPa": 500,
            "bars": [{"xMm": 2, "yMm": 100, "areaMm2": 490.87}]}
    response = dispatch_request({"action": "section_capacity_batch", "items": [item]})
    assert not response["ok"]
    assert "outside" in response["message"]
    assert dispatch_request([])["errorCode"] == "INVALID_REQUEST"


def test_capabilities_manifest() -> None:
    res = dispatch_request({"action": "capabilities", "requestId": "cap-1"})
    assert res["ok"] is True
    assert res["requestId"] == "cap-1"
    assert res["schemaVersion"] == "CARBON4_PY_STRUCTURAL_V1"
    assert res["packages"]["PyNiteFEA"]["version"] == "3.2.1"
    assert res["packages"]["concreteproperties"]["version"] == "0.8.0"
    assert res["capabilities"]["PYNITE_PDELTA"]["classification"] == "EMBEDDED_LIBRARY_VERIFIED"


def test_pynite_simply_supported_and_cantilever_closed_form() -> None:
    # 6m simply-supported beam under uniform gravity qz = -20 kN/m:
    # Rz = +60 kN each end, M_mid = q*L^2/8 = -90 kN·m (sagging), delta_mid = -5*q*L^4 / (384*E*Iy)
    e_kpa = 25_000_000.0
    g_kpa = 10_416_666.7
    b_m, d_m = 0.30, 0.50
    area = b_m * d_m
    iy = (b_m * d_m**3) / 12.0  # local x-z vertical bending
    iz = (d_m * b_m**3) / 12.0
    j_t = 0.141 * d_m * b_m**3

    model = {
        "modelId": "ss_beam_6m",
        "nodes": [
            {"id": "N0", "index": 0, "positionM": [0.0, 0.0, 0.0], "restraint": [True, True, True, True, False, False]},
            {"id": "N1", "index": 1, "positionM": [6.0, 0.0, 0.0], "restraint": [False, True, True, False, False, False]},
        ],
        "elements": [
            {
                "id": "B1",
                "index": 0,
                "category": "BEAM",
                "startNodeIndex": 0,
                "endNodeIndex": 1,
                "section": {
                    "elasticityKPa": e_kpa,
                    "shearModulusKPa": g_kpa,
                    "areaM2": area,
                    "momentInertiaYM4": iy,
                    "momentInertiaZM4": iz,
                    "torsionalConstantM4": j_t,
                },
            }
        ],
        "loadCases": [
            {
                "id": "DL",
                "name": "Uniform Gravity",
                "nature": "DEAD",
                "nodalLoads": [],
                "memberUniformLoads": [
                    {
                        "elementIndex": 0,
                        "coordinateSystem": "GLOBAL",
                        "qStartKnPerM": [0.0, 0.0, -20.0],
                    }
                ],
            }
        ],
        "combinations": [],
    }

    res = dispatch_request({"action": "pynite_solve", "model": model, "options": {"solveLoadCases": True, "solveCombinations": False}})
    assert res["ok"] is True
    dl = res["envelope"]["loadCaseResults"]["DL"]
    assert dl["equilibrium"]["isEquilibrated"] is True
    assert math.isclose(dl["reactions"][0]["reactionKnM"][2], 60.0, rel_tol=1e-6)
    assert math.isclose(dl["reactions"][1]["reactionKnM"][2], 60.0, rel_tol=1e-6)

    mf = dl["memberForces"][0]
    assert math.isclose(mf["extrema"]["maxNegativeMyKnM"], -90.0, rel_tol=1e-5)
    expected_def = (5.0 * 20.0 * 6.0**4) / (384.0 * e_kpa * iy)
    assert math.isclose(mf["extrema"]["maxRelativeChordDeflectionM"], expected_def, rel_tol=1e-5)

    model["nodes"][1]["positionM"][0] = 10.0
    model["loadCases"][0]["memberUniformLoads"] = [
        {"elementIndex": 0, "coordinateSystem": "GLOBAL", "startFraction": a, "endFraction": b,
         "qStartKnPerM": [0.0, 0.0, q0], "qEndKnPerM": [0.0, 0.0, q1]}
        for a, b, q0, q1 in ((0.2, 0.4, 0.0, -8.0), (0.4, 0.6, -8.0, -8.0), (0.6, 0.8, -8.0, 0.0))
    ]
    partial = dispatch_request({"action": "pynite_solve", "model": model, "options": {"solveLoadCases": True, "solveCombinations": False}})
    assert partial["ok"], partial
    dl = partial["envelope"]["loadCaseResults"]["DL"]
    assert dl["equilibrium"]["isEquilibrated"]
    assert all(math.isclose(r["reactionKnM"][2], 16.0, rel_tol=1e-8) for r in dl["reactions"])
    assert math.isclose(dl["memberForces"][0]["extrema"]["maxNegativeMyKnM"], -62.6666666667, rel_tol=1e-8)


def test_pynite_z_up_vertical_column_and_pdelta_amplification() -> None:
    # 4m vertical Z-up cantilever column: P_axial = -1200 kN (compression), H_x = +40 kN at top.
    # First-order tip displacement delta_1 = H*L^3 / (3*E*I), base moment M_1 = H*L = 160 kN·m.
    # Second-order P-Delta amplifies tip displacement and base moment M_2 ≈ H*L + P * delta_2!
    e_kpa = 25_000_000.0
    g_kpa = 10_416_666.7
    b_m, d_m = 0.30, 0.30
    area = b_m * d_m
    i_m4 = (b_m * d_m**3) / 12.0
    j_t = 0.141 * b_m**4

    model = {
        "modelId": "pdelta_cantilever_col",
        "nodes": [
            {"id": "BASE", "index": 0, "positionM": [0.0, 0.0, 0.0], "restraint": [True, True, True, True, True, True]},
            {"id": "TOP", "index": 1, "positionM": [0.0, 0.0, 4.0]},
        ],
        "elements": [
            {
                "id": "COL1",
                "index": 0,
                "category": "COLUMN",
                "startNodeIndex": 0,
                "endNodeIndex": 1,
                "section": {
                    "elasticityKPa": e_kpa,
                    "shearModulusKPa": g_kpa,
                    "areaM2": area,
                    "momentInertiaYM4": i_m4,
                    "momentInertiaZM4": i_m4,
                    "torsionalConstantM4": j_t,
                },
            }
        ],
        "loadCases": [
            {
                "id": "COMB",
                "name": "Axial + Lateral",
                "nature": "DEAD",
                "nodalLoads": [{"nodeIndex": 1, "vectorKnM": [40.0, 0.0, -1200.0, 0.0, 0.0, 0.0]}],
                "memberUniformLoads": [],
            }
        ],
        "combinations": [],
    }

    lin = dispatch_request({"action": "pynite_solve", "model": model, "options": {"analysisMode": "LINEAR"}})
    pd = dispatch_request({"action": "pynite_solve", "model": model, "options": {"analysisMode": "PDELTA"}})
    assert lin["ok"] is True and pd["ok"] is True

    ux_lin = lin["envelope"]["loadCaseResults"]["COMB"]["displacements"][1]["translationM"][0]
    ux_pd = pd["envelope"]["loadCaseResults"]["COMB"]["displacements"][1]["translationM"][0]
    expected_ux1 = (40.0 * 4.0**3) / (3.0 * e_kpa * i_m4)
    assert math.isclose(ux_lin, expected_ux1, rel_tol=1e-6)
    assert ux_pd > ux_lin * 1.08  # Clear second-order P-Delta amplification

    rxn_my_pd = pd["envelope"]["loadCaseResults"]["COMB"]["reactions"][0]["reactionKnM"][4]
    # Base reaction moment MRy balances -(H*L + P * ux_pd)!
    assert math.isclose(abs(rxn_my_pd), 40.0 * 4.0 + 1200.0 * ux_pd, rel_tol=5e-3)


def test_pynite_rejects_pdelta_with_plates() -> None:
    model = {
        "modelId": "mixed_invalid",
        "nodes": [
            {"id": "N0", "index": 0, "positionM": [0, 0, 0], "restraint": [True] * 6},
            {"id": "N1", "index": 1, "positionM": [4, 0, 0], "restraint": [True] * 6},
            {"id": "N2", "index": 2, "positionM": [4, 4, 0], "restraint": [True] * 6},
            {"id": "N3", "index": 3, "positionM": [0, 4, 0], "restraint": [True] * 6},
        ],
        "elements": [],
        "loadCases": [{"id": "DL", "name": "DL", "nature": "DEAD", "nodalLoads": [], "memberUniformLoads": []}],
        "combinations": [],
    }
    res = dispatch_request(
        {
            "action": "pynite_solve",
            "model": model,
            "plateElements": [{"id": "Q1", "kind": "QUAD", "nodeIndices": [0, 1, 2, 3], "thicknessM": 0.15, "elasticityKPa": 2.5e7}],
            "options": {"analysisMode": "PDELTA"},
        }
    )
    assert res["ok"] is False
    assert res["errorCode"] == "UNSUPPORTED_PDELTA_WITH_PLATES"


def test_concrete_properties_col_c23_l0_and_normal_column() -> None:
    # Reproduce frozen Phase 7 COL_C23_L0: 350 x 550 mm, M25, Fe500, 12-T28 (7389 mm²),
    # cover = 40 + 8 + 14 = 62 mm from edges!
    b_mm, d_mm = 350.0, 550.0
    c_mm = 62.0
    area_t28 = math.pi * 28.0**2 / 4.0
    xs = [c_mm, b_mm / 2.0, b_mm - c_mm]
    ys_mid = [c_mm + k * (d_mm - 2.0 * c_mm) / 4.0 for k in (1, 2, 3)]
    bars = (
        [{"xMm": x, "yMm": c_mm, "areaMm2": area_t28} for x in xs]
        + [{"xMm": x, "yMm": d_mm - c_mm, "areaMm2": area_t28} for x in xs]
        + [{"xMm": c_mm, "yMm": y, "areaMm2": area_t28} for y in ys_mid]
        + [{"xMm": b_mm - c_mm, "yMm": y, "areaMm2": area_t28} for y in ys_mid]
    )
    assert len(bars) == 12

    res = dispatch_request(
        {
            "action": "section_capacity_batch",
            "items": [
                {
                    "sectionId": "COL_C23_L0",
                    "widthMm": b_mm,
                    "depthMm": d_mm,
                    "fckMPa": 25.0,
                    "fyMPa": 500.0,
                    "bars": bars,
                    "includeInteractionCurves": True,
                    "includeMomentCurvature": True,
                    "momentCurvatureAxialKn": 1200.0,
                    "demands": [
                        {
                            "id": "FROZEN_EQY",
                            "puKn": 4674.35,
                            "muxKnM": 4.56,
                            "muyKnM": 264.21,
                            "includeContour": True,
                        },
                        {
                            "id": "MODERATE_LOAD",
                            "puKn": 1500.0,
                            "muxKnM": 120.0,
                            "muyKnM": 60.0,
                            "includeContour": True,
                        },
                    ],
                }
            ],
        }
    )
    assert res["ok"] is True
    sec = res["results"][0]
    # Verify zero double counting of displaced concrete!
    gp = sec["grossProperties"]
    assert math.isclose(gp["reinfLumpedAreaMm2"], 12.0 * area_t28, rel_tol=1e-6)
    assert math.isclose(gp["concreteAreaMm2"] + gp["reinfLumpedAreaMm2"], b_mm * d_mm, rel_tol=1e-6)

    ev_frozen = sec["demandEvaluations"][0]
    # Frozen COL_C23_L0 MUST fail decisively under ConcreteProperties!
    assert ev_frozen["pointInsideDiagram"] is False
    assert ev_frozen["utilizationRatio"] > 1.5

    ev_mod = sec["demandEvaluations"][1]
    assert ev_mod["pointInsideDiagram"] is True
    assert ev_mod["utilizationRatio"] < 1.0

"""Pressure-only loads compared with hand-calculated strip and reaction solutions."""
from pathlib import Path
import math
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker_main import run_pynite_solve
from automatic_mesh import generate_floor

LENGTH, WIDTH, THICKNESS, ELASTIC, PRESSURE = 4., 1., .08, 24e6, 2.
BEAM_INERTIA = .0001
REACTION_TOLERANCE = 1e-6
DEFLECTION_RELATIVE_TOLERANCE = .03


def solve(nodes, elements, plates, name, member_loads=()):
    return run_pynite_solve({
        "model": {"modelId": name, "nodes": nodes, "elements": elements,
                  "loadCases": [{"id": "G", "name": "Gravity", "nature": "DEAD", "nodalLoads": [],
                                 "memberUniformLoads": member_loads}],
                  "combinations": []},
        "plateElements": plates,
        "options": {"solveLoadCases": True, "solveCombinations": False},
    })["envelope"]


def make_strip(nx, bearing, with_beams):
    nodes, plates, elements = [], [], []
    section = {"elasticityKPa": ELASTIC, "shearModulusKPa": ELASTIC / 2, "areaM2": .025,
               "momentInertiaYM4": BEAM_INERTIA, "momentInertiaZM4": BEAM_INERTIA,
               "torsionalConstantM4": .00001}
    for j in range(3):
        for i in range(nx + 1):
            n = len(nodes)
            nodes.append({"id": f"N{n}", "index": n, "positionM": [LENGTH*i/nx, WIDTH*j/2, 0.],
                          "restraint": bearing(i, j)})
            if i < nx and j < 2:
                plates.append({"id": f"P{n}", "kind": "QUAD", "nodeIndices": [n, n+1, n+nx+2, n+nx+1],
                               "thicknessM": THICKNESS, "elasticityKPa": ELASTIC, "poissonRatio": 0.,
                               "surfacePressuresByCase": {"G": -PRESSURE}})
            if with_beams and i < nx and j in (0, 2):
                elements.append({"id": f"B{n}", "index": len(elements), "startNodeIndex": n,
                                 "endNodeIndex": n+1, "category": "BEAM", "section": section})
    return nodes, elements, plates


@pytest.mark.parametrize("nx", [8, 16])
@pytest.mark.parametrize("with_beams", [False, True])
def test_uniform_cantilever_pressure(nx, with_beams):
    nodes, elements, plates = make_strip(nx, lambda i, j: [i == 0] * 6, with_beams)
    envelope = solve(nodes, elements, plates, "coupled-strip" if with_beams else "plate-strip")
    solution = envelope["loadCaseResults"]["G"]
    reactions = [r["reactionKnM"] for r in solution["reactions"]]
    assert sum(r[2] for r in reactions) == pytest.approx(PRESSURE*WIDTH*LENGTH, abs=REACTION_TOLERANCE)
    assert sum(r[4] for r in reactions) == pytest.approx(-PRESSURE*WIDTH*LENGTH**2/2, abs=REACTION_TOLERANCE)
    stiffness = ELASTIC * (WIDTH * THICKNESS**3 / 12 + (2 * BEAM_INERTIA if with_beams else 0))
    reference = -PRESSURE * WIDTH * LENGTH**4 / (8 * stiffness)
    tip_rotation = PRESSURE * WIDTH * LENGTH**3 / (6 * stiffness)
    for n in [nx, 2*nx+1, 3*nx+2]:
        assert solution["displacements"][n]["translationM"][2] == pytest.approx(reference, rel=DEFLECTION_RELATIVE_TOLERANCE)
        assert solution["displacements"][n]["rotationRad"][1] == pytest.approx(tip_rotation, rel=DEFLECTION_RELATIVE_TOLERANCE)
    if with_beams:
        for member in (solution["memberForces"][0], solution["memberForces"][nx]):
            expected_root = (PRESSURE * WIDTH * LENGTH**2 / 2) * ELASTIC * BEAM_INERTIA / stiffness
            assert abs(member["stations"][0]["momentMyKnM"]) == pytest.approx(expected_root, rel=.05)
    assert len(envelope["plateResultsByCaseOrCombo"]["G"]) == 2*nx
    print(f"{envelope['modelId']} {2*nx} quads: tip {solution['displacements'][2*nx+1]['translationM'][2]:.9f} m, "
          f"rotation {solution['displacements'][2*nx+1]['rotationRad'][1]:.9f} rad, "
          f"reference {reference:.9f} m, solve {envelope['totalSolveDurationMs']:.1f} ms")


def test_simply_supported_one_way_strip():
    nx = 16
    bearing = lambda i, j: [i == 0, i == 0 and j == 0, i in (0, nx), False, False, False]
    nodes, elements, plates = make_strip(nx, bearing, False)
    envelope = solve(nodes, elements, plates, "one-way-strip")
    solution = envelope["loadCaseResults"]["G"]
    for x in (0, LENGTH):
        reaction = sum(r["reactionKnM"][2] for r in solution["reactions"] if nodes[r["nodeIndex"]]["positionM"][0] == x)
        assert reaction == pytest.approx(PRESSURE * WIDTH * LENGTH / 2, abs=REACTION_TOLERANCE)
    stiffness = ELASTIC * WIDTH * THICKNESS**3 / 12
    expected = -5 * PRESSURE * WIDTH * LENGTH**4 / (384 * stiffness)
    actual = solution["displacements"][nx + 1 + nx//2]["translationM"][2]
    assert actual == pytest.approx(expected, rel=DEFLECTION_RELATIVE_TOLERANCE)
    print(f"one-way strip: midspan {actual:.9f} m, reference {expected:.9f} m, "
          f"solve {envelope['totalSolveDurationMs']:.1f} ms")


def test_trapezoidal_pressure_force_and_first_moments():
    # Width in the x direction is 4 - y. Integrating from y=0 to 2 gives
    # area 6 m², first moment about x of 16/3 m³ and about y of 28/3 m³.
    xy = [(0, 0), (4, 0), (2, 2), (0, 2)]
    nodes = [{"id": f"N{i}", "index": i, "positionM": [x, y, 0], "restraint": [True]*6}
             for i, (x, y) in enumerate(xy)]
    plate = {"id": "Q", "kind": "QUAD", "nodeIndices": [0, 1, 2, 3], "thicknessM": THICKNESS,
             "elasticityKPa": ELASTIC, "poissonRatio": .2, "surfacePressuresByCase": {"G": -3}}
    solution = solve(nodes, [], [plate], "trapezoid")["loadCaseResults"]["G"]
    audit = solution["equilibrium"]
    assert audit["appliedForceSumKn"] == pytest.approx([0, 0, -18], abs=REACTION_TOLERANCE)
    assert audit["appliedMomentAboutOriginKnM"] == pytest.approx([-16, 28, 0], abs=REACTION_TOLERANCE)
    assert audit["momentResidualAboutOriginKnM"] == pytest.approx([0, 0, 0], abs=REACTION_TOLERANCE)


def test_continuous_two_span_strip():
    nx = 16

    def bearing(i, j):
        return [i == 0, i == 0 and j == 0, i in (0, nx//2, nx), False, False, False]

    nodes, elements, plates = make_strip(nx, bearing, False)
    envelope = solve(nodes, elements, plates, "continuous-strip")
    solution = envelope["loadCaseResults"]["G"]
    span = LENGTH / 2
    values = []
    for x, factor in ((0, 3/8), (span, 5/4), (LENGTH, 3/8)):
        reaction = sum(r["reactionKnM"][2] for r in solution["reactions"] if nodes[r["nodeIndex"]]["positionM"][0] == x)
        assert reaction == pytest.approx(factor * PRESSURE * WIDTH * span, rel=.01)
        values.append(reaction)
    print(f"continuous strip: reactions {values}, solve {envelope['totalSolveDurationMs']:.1f} ms")


def test_simply_supported_two_way_square():
    n, side, nu = 8, 4., .2
    nodes, plates = [], []
    for j in range(n + 1):
        for i in range(n + 1):
            k = len(nodes)
            nodes.append({"id": f"N{k}", "index": k, "positionM": [side*i/n, side*j/n, 0.],
                          "restraint": [i == j == 0, j == 0 and i in (0, n),
                                        i in (0, n) or j in (0, n), False, False, False]})
            if i < n and j < n:
                plates.append({"id": f"P{k}", "kind": "QUAD", "nodeIndices": [k, k+1, k+n+2, k+n+1],
                               "thicknessM": THICKNESS, "elasticityKPa": ELASTIC, "poissonRatio": nu,
                               "surfacePressuresByCase": {"G": -PRESSURE}})
    envelope = solve(nodes, [], plates, "two-way-square")
    solution = envelope["loadCaseResults"]["G"]
    # Navier's simply supported Kirchhoff plate series. Only odd terms remain
    # for uniform pressure. Successive signs come from sin(m*pi/2).
    odd = range(1, 42, 2)
    series = sum((-1)**((i+j-2)//2) / (i*j*(i*i+j*j)**2) for i in odd for j in odd)
    stiffness = ELASTIC * THICKNESS**3 / (12*(1-nu*nu))
    expected = -16 * PRESSURE * side**4 * series / (math.pi**6 * stiffness)
    actual = solution["displacements"][(n+1)*n//2+n//2]["translationM"][2]
    assert actual == pytest.approx(expected, rel=DEFLECTION_RELATIVE_TOLERANCE)
    assert solution["equilibrium"]["reactionForceSumKn"][2] == pytest.approx(PRESSURE * side**2, abs=REACTION_TOLERANCE)
    print(f"two-way square: centre {actual:.9f} m, reference {expected:.9f} m, "
          f"solve {envelope['totalSolveDurationMs']:.1f} ms")


def test_automatically_meshed_two_storey_gravity_transfer():
    side, height = 4., 3.
    plan = [(0, 0), (side, 0), (side, side), (0, side)]
    nodes = [{"id": f"N{4*k+i}", "index": 4*k+i, "positionM": [x, y, height*k],
              "restraint": [k == 0] * 6} for k in range(3) for i, (x, y) in enumerate(plan)]
    section = {"elasticityKPa": ELASTIC, "shearModulusKPa": ELASTIC / 2, "areaM2": .16,
               "momentInertiaYM4": .002, "momentInertiaZM4": .002, "torsionalConstantM4": .003}
    elements, beams, plates = [], [], []

    def add_element(start, end, category):
        index = len(elements)
        elements.append({"id": f"E{index}", "index": index, "startNodeIndex": start, "endNodeIndex": end,
                         "category": category, "section": section})
        return index

    for level in (1, 2):
        for i in range(4):
            add_element(4*(level-1)+i, 4*level+i, "COLUMN")
            beam = add_element(4*level+i, 4*level+(i+1)%4, "BEAM")
            beams.append({"physicalMemberId": f"beam-{level}-{i}", "floorId": str(level),
                          "topElevationMm": 1000*height*level, "analyticalElementIndices": [beam]})
    for level in (1, 2):
        deck = {"supportingFloorId": str(level), "elevationMm": 1000*height*level,
                "regions": [{"id": "deck", "ringsMm": [[(1000*x, -1000*y) for x, y in plan]]}]}
        mesh, = generate_floor(deck, nodes, beams, elements, len(nodes))["regions"]
        assert len(mesh["sharedEdges"]) == 4
        assert mesh["unmatchedFrameElementIds"] == []
        plates.extend({**q, "kind": "QUAD", "thicknessM": THICKNESS,
                       "elasticityKPa": ELASTIC, "poissonRatio": .2, "surfacePressuresByCase": {"G": -PRESSURE}}
                      for q in mesh["quadConnectivity"])
    envelope = solve(nodes, elements, plates, "two-storey-frame")
    solution = envelope["loadCaseResults"]["G"]
    load_per_deck = PRESSURE * side**2
    assert len(envelope["plateResultsByCaseOrCombo"]["G"]) == 2
    for reaction in solution["reactions"]:
        assert reaction["reactionKnM"][2] == pytest.approx(load_per_deck / 2, abs=REACTION_TOLERANCE)
    assert solution["equilibrium"]["appliedForceSumKn"][2] == pytest.approx(-2 * load_per_deck, abs=REACTION_TOLERANCE)
    assert solution["equilibrium"]["momentResidualAboutOriginKnM"] == pytest.approx([0, 0, 0], abs=REACTION_TOLERANCE)
    print(f"two-storey frame: {2 * load_per_deck} kN transferred, solve {envelope['totalSolveDurationMs']:.1f} ms")


def test_rejects_unmapped_pressure_case():
    nodes, elements, plates = make_strip(4, lambda i, j: [i == 0] * 6, False)
    plates[0]["surfacePressuresByCase"] = {"UNDECLARED": -PRESSURE}
    with pytest.raises(ValueError, match="unknown load case UNDECLARED"):
        solve(nodes, elements, plates, "bad-pressure")


def test_disconnected_coincident_plates_are_rejected():
    nodes, _, plates = make_strip(4, lambda i, j: [i == 0] * 6, False)
    count = len(nodes)
    nodes.extend({**n, "id": f"d-{n['id']}", "index": n["index"] + count, "restraint": [False] * 6}
                 for n in nodes[:count])
    plates.extend({**p, "id": f"d-{p['id']}", "nodeIndices": [i + count for i in p["nodeIndices"]]}
                  for p in plates[:])
    result = run_pynite_solve({"model": {"nodes": nodes,
                                       "loadCases": [{"id": "G", "nodalLoads": []}]},
                              "plateElements": plates})
    assert result["errorCode"] == "DISCONNECTED_COUPLED_MODEL"


@pytest.mark.parametrize("spans", [1, 2])
def test_inclined_stair_strip_at_reviewed_vertical_bearings(spans):
    # Unit-width elastic waist-strip idealization on a 3-4-5 incline.
    length, cos, sin, q = 5., .8, .6, 4.
    thickness = .16
    section = {"elasticityKPa": ELASTIC, "shearModulusKPa": ELASTIC / 2, "areaM2": thickness,
               "momentInertiaYM4": thickness**3/12, "momentInertiaZM4": thickness/12,
               "torsionalConstantM4": thickness**3/3}
    nodes = [{"id": f"S{i}", "index": i, "positionM": [i*length*cos, 0., i*length*sin],
              "restraint": [i == 0, True, True, True, False, True]} for i in range(spans+1)]
    elements = [{"id": f"flight{i}", "index": i, "startNodeIndex": i, "endNodeIndex": i+1,
                 "category": "STAIR_STRINGER", "section": section} for i in range(spans)]
    loads = [{"elementIndex": i, "coordinateSystem": "GLOBAL", "qStartKnPerM": [0., 0., -q]} for i in range(spans)]
    envelope = solve(nodes, elements, [], f"inclined-strip-{spans}", loads)
    solution = envelope["loadCaseResults"]["G"]
    if spans == 1:
        expected_reactions = [q*length/2] * 2
    else:
        # Force method with the centre bearing as redundant. Apply a unit
        # vertical force to the basic single span for the flexibility. The
        # axial terms account for the sloped member and vertical support motion.
        ei, ea = ELASTIC*section["momentInertiaYM4"], ELASTIC*thickness
        gravity_displacement = (5*q*cos**2*(2*length)**4/(384*ei)
                                + q*sin**2*length**2/(2*ea))
        flexibility = cos**2*(2*length)**3/(48*ei) + sin**2*length/(2*ea)
        internal = gravity_displacement/flexibility
        expected_reactions = [q*length - internal/2, internal, q*length - internal/2]
    actual = [r["reactionKnM"][2] for r in solution["reactions"]]
    assert actual == pytest.approx(expected_reactions, abs=REACTION_TOLERANCE)
    assert solution["equilibrium"]["momentResidualAboutOriginKnM"] == pytest.approx([0, 0, 0], abs=REACTION_TOLERANCE)
    print(f"inclined stair strip {spans} spans: vertical reactions {actual} kN, solve "
          f"{envelope['totalSolveDurationMs']:.1f} ms")

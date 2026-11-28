"""Shared-DOF bending patch for a horizontal plate and two concentric edge beams."""
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deck_mesh import check_deck_mesh
from worker_main import run_pynite_solve


@pytest.mark.parametrize("nx", [2, 4, 8])
def test_coupled_cantilever_constant_curvature(nx):
    length, width, thickness = 6.0, 2.0, 0.2
    elastic, inertia, curvature = 24e6, .0005, .0001
    ny = 2
    section = {"elasticityKPa": elastic, "shearModulusKPa": elastic/2, "areaM2": .05,
               "momentInertiaYM4": inertia, "momentInertiaZM4": inertia, "torsionalConstantM4": .0002}
    nodes, vertices, quads, beams, elements, loads = [], [], [], [], [], []
    frame_indices = {}

    def index(i, j):
        return j * (nx + 1) + i

    for j in range(ny + 1):
        for i in range(nx + 1):
            n = index(i, j)
            x, y = length * i / nx, width * j / ny
            if j in (0, ny):
                frame_indices[n] = len(nodes)
                vertices.append({"id": str(n), "frameNodeIndex": len(nodes)})
                nodes.append({"id": str(n), "index": len(nodes), "positionM": [x, y, 0.]})
            else:
                vertices.append({"id": str(n), "pointMm": [1000*x, -1000*y]})
            if i < nx and j < ny:
                quads.append({"id": f"P{i}_{j}", "nodeIds": list(map(str, [
                    n, index(i+1, j), index(i+1, j+1), index(i, j+1)]))})
    for j in (0, ny):
        children = []
        for i in range(nx):
            children.append(len(elements))
            elements.append({"id": f"B{j}_{i}", "index": len(elements), "startNodeIndex": frame_indices[index(i,j)],
                             "endNodeIndex": frame_indices[index(i+1,j)], "section": section, "category": "BEAM"})
        beams.append({"physicalMemberId": f"B{j}", "floorId": "F", "topElevationMm": 0,
                      "analyticalElementIndices": children})
    region = {"id": "R", "ringsMm": [[[0,0], [6000,0], [6000,-2000], [0,-2000]]]}
    receipt = check_deck_mesh({"regions": [region], "supportingFloorId": "F", "elevationMm": 0},
                              {"regionId": "R", "nodes": vertices, "quads": quads}, nodes, beams, elements)
    # Build the solver topology from the receipt. In this patch, only the frame nodes
    # are pre-existing. The centre row is appended by the handoff.
    active_indices = {v["id"]: v["index"] for v in receipt["nodes"]}
    solver_nodes = [{"id": v["id"], "index": v["index"], "positionM": v["positionM"],
                     "restraint": [v["positionM"][0] == 0] * 6}
                    for v in sorted(receipt["nodes"], key=lambda v: v["index"])]
    plates = [{**q, "kind": "QUAD", "thicknessM": thickness, "elasticityKPa": elastic,
               "poissonRatio": 0.0} for q in receipt["quadConnectivity"]]
    # For nu=0 and constant curvature there is no twisting or transverse shear.
    # Each edge beam takes EI*k; the plate end couple per unit width is D*k.
    plate_couple = elastic * thickness**3 / 12 * curvature
    beam_couple = elastic * inertia * curvature
    for j in range(ny+1):
        edge = j in (0, ny)
        trib = width / ny * (.5 if edge else 1)
        applied = plate_couple * trib + (beam_couple if edge else 0)
        loads.append({"nodeIndex": active_indices[str(index(nx,j))], "vectorKnM": [0,0,0,0,applied,0]})
    result = run_pynite_solve({"model": {"modelId": "bending-patch", "nodes": solver_nodes, "elements": elements,
        "loadCases": [{"id": "M", "name": "End couples", "nature": "DEAD", "nodalLoads": loads}], "combinations": []},
        "plateElements": plates, "options": {"solveLoadCases": True, "solveCombinations": False}})
    envelope = result["envelope"]
    solved = envelope["loadCaseResults"]["M"]
    # Predeclared absolute tolerances in physical units for this exact patch.
    for load in loads:
        tip = solved["displacements"][load["nodeIndex"]]
        assert tip["translationM"][2] == pytest.approx(-curvature * length**2 / 2, abs=1e-8)
        assert tip["rotationRad"][1] == pytest.approx(curvature * length, abs=1e-8)
    reaction = sum(r["reactionKnM"][4] for r in solved["reactions"])
    assert reaction == pytest.approx(-(width * plate_couple + 2 * beam_couple), abs=1e-6)
    for member in solved["memberForces"]:
        for station in member["stations"]:
            assert abs(station["momentMyKnM"]) == pytest.approx(beam_couple, abs=1e-6)
            assert abs(station["momentMzKnM"]) < 1e-6
    for plate in envelope["plateResultsByCaseOrCombo"]["M"]:
        mx, my, mxy = plate["centerMomentsKnMPerM"]
        assert abs(mx) == pytest.approx(plate_couple, abs=1e-6)
        assert abs(my) < 1e-6 and abs(mxy) < 1e-6

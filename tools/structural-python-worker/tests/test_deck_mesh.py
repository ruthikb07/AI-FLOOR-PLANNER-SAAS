from copy import deepcopy
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deck_mesh import check_deck_mesh


def mesh_fixture():
    # A 6 x 6 m floor opening occupies the centre 2 x 2 m bay: 32 m2 of plate.
    scale = 2000
    nodes = [{"id": f"{x},{y}", "pointMm": [x * scale, y * scale]} for y in range(4) for x in range(4)]
    frames = []
    for x in range(4):
        nodes[x] = {"id": f"{x},0", "frameNodeIndex": x}
        frames.append({"index": x, "positionM": [x * 2, 0, 3]})
    quads = [{"id": f"P{x}{y}", "nodeIds": [f"{x},{y}", f"{x},{y+1}", f"{x+1},{y+1}", f"{x+1},{y}"]}
             for y in range(3) for x in range(3) if (x, y) != (1, 1)]
    surface = {"id": "R", "ringsMm": [[[0, 0], [6000, 0], [6000, 6000], [0, 6000]],
                                      [[2000, 2000], [4000, 2000], [4000, 4000], [2000, 4000]]]}
    deck = {"supportingFloorId": "F", "elevationMm": 3000, "regions": [surface]}
    beams = [{"physicalMemberId": "B", "floorId": "F", "topElevationMm": 3000, "analyticalElementIndices": [0, 1, 2]}]
    elements = [{"id": f"B{i}", "startNodeIndex": i, "endNodeIndex": i+1} for i in range(3)]
    return deck, {"regionId": "R", "nodes": nodes, "quads": quads}, frames, beams, elements


def test_hole_and_shared_frame_edge_identities():
    receipt = check_deck_mesh(*mesh_fixture())
    assert receipt["nodes"][0] == {"id": "0,0", "index": 0, "positionM": [0, 0, 3], "sharesFrameDofs": True}
    assert receipt["nodes"][4]["index"] == 4
    assert receipt["quadConnectivity"][0] == {"id": "P00", "nodeIndices": [0, 4, 5, 1]}
    assert receipt["quadCount"] == 8
    assert receipt["gapMm2"] == receipt["outsideMm2"] == receipt["overlapMm2"] == 0
    assert [r["frameNodeIndices"] for r in receipt["sharedEdges"]] == [[0, 1], [1, 2], [2, 3]]
    assert receipt["gravityStatus"] == "BEARING_AND_LOAD_TRANSFER_UNVERIFIED"


@pytest.mark.parametrize("fault", ["same_coordinates", "opening", "overlap", "wrong_level", "missing_region", "inverted"])
def test_rejects_invalid_coupling(fault):
    deck, proposal, nodes, beams, elements = mesh_fixture()
    if fault == "same_coordinates":
        proposal["nodes"][1] = {"id": "1,0", "pointMm": [2000, 0]}
    elif fault == "opening":
        proposal["quads"].append({"id": "opening", "nodeIds": ["1,1", "1,2", "2,2", "2,1"]})
    elif fault == "overlap":
        duplicate = deepcopy(proposal["quads"][0])
        duplicate["id"] = "duplicate"
        proposal["quads"].append(duplicate)
    elif fault == "wrong_level":
        nodes[0]["positionM"][2] += .001
    elif fault == "missing_region":
        proposal["regionId"] = "other"
    else:
        proposal["quads"][0]["nodeIds"].reverse()
    with pytest.raises(ValueError):
        check_deck_mesh(deck, proposal, nodes, beams, elements)


def test_preserves_oblique_frame_geometry():
    deck, proposal, nodes, beams, elements = mesh_fixture()
    for region in deck["regions"]:
        for ring in region["ringsMm"]:
            for point in ring:
                point[1] += point[0] / 10
    for node in nodes:
        node["positionM"][1] -= node["positionM"][0] / 10
    for vertex in proposal["nodes"]:
        if "pointMm" in vertex:
            vertex["pointMm"][1] += vertex["pointMm"][0] / 10
    receipt = check_deck_mesh(deck, proposal, nodes, beams, elements)
    assert receipt["quadCount"] == 8
    assert len(receipt["sharedEdges"]) == 3

def test_zero_area_gap_does_not_hide_a_hanging_node():
    deck, proposal, frames, beams, elements = mesh_fixture()
    # Split just one plate into two. The adjacent plate still has one undivided edge.
    proposal["nodes"].extend([{"id": "mid-left", "pointMm": [0, 1000]},
                              {"id": "mid-right", "pointMm": [2000, 1000]}])
    proposal["quads"][0]["nodeIds"] = ["0,0", "mid-left", "mid-right", "1,0"]
    proposal["quads"].append({"id": "extra", "nodeIds": ["mid-left", "0,1", "1,1", "mid-right"]})
    with pytest.raises(ValueError, match="Nonconforming"):
        check_deck_mesh(deck, proposal, frames, beams, elements)

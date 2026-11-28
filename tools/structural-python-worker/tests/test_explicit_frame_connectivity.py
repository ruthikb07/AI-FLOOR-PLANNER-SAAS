"""A separately restrained deck has a vertex on an unrelated beam axis."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker_main import run_pynite_solve


def model():
    positions = [(0,0,0),(4,0,0),(2,0,0),(3,1,0),(2,2,0),(1,1,0)]
    nodes = [dict(id=f"N{i}", index=i, positionM=p, restraint=[i != 1]*6)
             for i,p in enumerate(positions)]
    section = dict(elasticityKPa=24e6, shearModulusKPa=10e6, areaM2=.1,
                   momentInertiaYM4=.001, momentInertiaZM4=.001, torsionalConstantM4=.001)
    member = dict(id="B",index=0,startNodeIndex=0,endNodeIndex=1,section=section)
    load = dict(id="G", name="Tip", nature="DEAD", nodalLoads=[dict(nodeIndex=1,vectorKnM=[0,0,-3,0,0,0])])
    return dict(model=dict(modelId="independent",nodes=nodes,elements=[member],loadCases=[load],combinations=[]),
                plateElements=[dict(id="slab",kind="QUAD",nodeIndices=[2,3,4,5],elasticityKPa=24e6,thicknessM=.1,poissonRatio=.2)])


def test_unconnected_deck_vertex_on_beam_cannot_provide_a_support():
    result = run_pynite_solve(model())["envelope"]["loadCaseResults"]["G"]
    tip = result["displacements"][1]["translationM"][2]
    assert tip == pytest.approx(-3*4**3/(3*24e6*.001), rel=1e-8)
    for reaction in result["reactions"]:
        if reaction["nodeIndex"] >= 2:
            assert reaction["reactionKnM"] == pytest.approx([0]*6, abs=1e-8)

def test_explicit_child_load_remapping_and_release_identity():
    from frame_subdivision import subdivide
    payload = model()
    beam = payload["model"]["elements"][0]
    beam.update(interiorNodeIndices=[2], parentMemberId="physical", releases={"rxEnd": False, "ryStart": False})
    case = payload["model"]["loadCases"][0]
    case.update(nodalLoads=[], memberUniformLoads=[dict(elementIndex=0,coordinateSystem="GLOBAL",
                qStartKnPerM=[0,0,-2],qEndKnPerM=[0,0,-8],startFraction=.25,endFraction=.625)],
                memberPointLoads=[dict(elementIndex=0,coordinateSystem="GLOBAL",fractionalDistance=.5,forceKn=[0,0,-4])])
    result = subdivide(payload["model"])
    a,b = result["elements"]
    assert a["endNodeIndex"] == b["startNodeIndex"] == 2
    assert a["releases"] == {"ryStart":False} and b["releases"] == {"rxEnd":False}
    first,second = result["loadCases"][0]["memberUniformLoads"]
    assert first["qEndKnPerM"] == second["qStartKnPerM"] == [0,0,-6]
    assert len(result["loadCases"][0]["memberPointLoads"]) == 1
    # Remove the independent plate and leave the split joint free. The fixed
    # root alone carries 7.5 kN at x=1.9 m and 4 kN at x=2 m.
    payload.pop("plateElements")
    payload["model"]["nodes"] = payload["model"]["nodes"][:3]
    payload["model"]["nodes"][2]["restraint"] = [False]*6
    solution = run_pynite_solve(payload)["envelope"]["loadCaseResults"]["G"]
    assert solution["reactions"][0]["reactionKnM"] == pytest.approx([0,0,11.5,0,-22.25,0],abs=1e-8)
    assert [m["parentStationRange"] for m in solution["memberForces"]] == [[0,.5],[.5,1]]
    assert all(m["parentMemberId"] == "physical" for m in solution["memberForces"])


def test_off_axis_child_is_rejected():
    from frame_subdivision import subdivide
    payload = model()
    payload["model"]["elements"][0]["interiorNodeIndices"] = [3]
    with pytest.raises(ValueError,match="outside parent axis"):
        subdivide(payload["model"])

def test_saved_deck_candidate_connects_only_a_complete_registered_edge_chain():
    from automatic_mesh import generate_floor
    from test_deck_mesh import mesh_fixture
    deck, _, frame, beams, elements = mesh_fixture()
    beams[0]["analyticalElementIndices"] = [0]
    elements[0]["endNodeIndex"] = 3
    receipt, = generate_floor(deck, frame, beams, elements, 40)["regions"]
    candidate, = receipt["beamSubdivisionCandidates"]
    assert candidate["physicalMemberId"] == "B" and candidate["elementId"] == "B0"
    assert all(i >= 40 for i in candidate["interiorNodeIndices"])
    assert len(candidate["edgePlateIds"]) == 3
    assert receipt["gravityStatus"] == "BEARING_AND_LOAD_TRANSFER_UNVERIFIED"

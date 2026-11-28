from test_deck_mesh import mesh_fixture
from automatic_mesh import generate_floor


def test_grid_generates_opening_and_uses_building_registry():
    deck, _, frames, beams, elements = mesh_fixture()
    first = generate_floor(deck, frames, beams, elements, 41)
    mesh, = first["regions"]
    assert mesh["quadCount"] == 8
    assert mesh["gapMm2"] == mesh["outsideMm2"] == mesh["overlapMm2"] == 0
    private = {n["index"] for n in mesh["nodes"] if not n["sharesFrameDofs"]}
    assert private == set(range(41, 53))
    # Region IDs are scoped to the supporting storey, even if supplied twice.
    deck["supportingFloorId"] = "upper"
    for beam in beams:
        beam["floorId"] = "upper"
    second = generate_floor(deck, frames, beams, elements, first["nextFreeNodeIndex"])
    other, = second["regions"]
    assert {v["index"] for v in other["nodes"] if not v["sharesFrameDofs"]}.isdisjoint(private)
    assert {q["id"] for q in mesh["quadConnectivity"]}.isdisjoint(q["id"] for q in other["quadConnectivity"])


def test_boundary_fitted_mesh_preserves_oblique_opening():
    deck, _, frames, beams, elements = mesh_fixture()
    for ring in deck["regions"][0]["ringsMm"]:
        for point in ring:
            point[1] += point[0] / 4
    for node in frames:
        node["positionM"][1] -= node["positionM"][0] / 4
    mesh, = generate_floor(deck, frames, beams, elements, len(frames))["regions"]
    assert mesh["method"] == "BOUNDARY_FITTED_QUADS"
    assert mesh["areaMm2"] == 32_000_000
    assert mesh["quadCount"] == 24
    assert max(mesh[f"{part}Mm2"] for part in ("gap", "outside", "overlap")) < 0.01
    assert mesh["quality"]["minScaledCornerJacobian"] >= 0.25
    assert mesh["unmatchedFrameElementIds"] == ["B0", "B1", "B2"]


def test_adjacent_decks_share_only_explicit_frame_nodes():
    left = {"id": "left", "ringsMm": [[[0, 0], [0, 2000], [2000, 2000], [2000, 0]]]}
    right = {"id": "right", "ringsMm": [[[2000, 0], [2000, 2000], [4000, 2000], [4000, 0]]]}
    deck = {"supportingFloorId": "level", "elevationMm": 3000, "regions": [left, right]}
    frame = [{"index": 0, "positionM": [2, 0, 3]}, {"index": 1, "positionM": [2, -2, 3]}]
    beams = [{"physicalMemberId": "B", "floorId": "level", "topElevationMm": 3000,
              "analyticalElementIndices": [0]}]
    elements = [{"id": "B0", "startNodeIndex": 0, "endNodeIndex": 1}]
    a, b = generate_floor(deck, frame, beams, elements, len(frame))["regions"]
    assert a["boundaryInterfaces"] == [{"regionId": "right", "lengthMm": 2000, "status": "SHARED_FRAME_DOFS"}]
    assert {n["index"] for n in a["nodes"]} & {n["index"] for n in b["nodes"]} == {0, 1}

    a, b = generate_floor(deck, frame, [], elements, len(frame))["regions"]
    assert a["boundaryInterfaces"][0]["status"] == "CONTINUITY_REVIEW_REQUIRED"
    assert {n["index"] for n in a["nodes"]}.isdisjoint(n["index"] for n in b["nodes"])


def test_adjacent_regions_flag_hanging_boundary_partition():
    left = {"id": "left", "ringsMm": [[[0, 0], [0, 2000], [2000, 2000], [2000, 0]]]}
    right = {"id": "right", "ringsMm": [[[2000, 0], [2000, 1000], [2000, 2000], [4000, 2000], [4000, 0]]]}
    deck = {"supportingFloorId": "level", "elevationMm": 3000, "regions": [left, right]}
    a, b = generate_floor(deck, [], [], [], 0)["regions"]
    assert a["boundaryInterfaces"][0]["status"] == b["boundaryInterfaces"][0]["status"] == "NONCONFORMING_INTERFACE"


def test_coordinated_floor_removes_hanging_partition_without_merging_independent_nodes():
    left = {"id": "left", "ringsMm": [[[0,0],[0,2000],[2000,2000],[2000,0]]]}
    right = {"id": "right","ringsMm": [[[2000,0],[2000,1000],[2000,2000],[4000,2000],[4000,0]]]}
    deck = {"supportingFloorId":"F","elevationMm":3000,"bearingLines":[],"regions":[left,right]}
    a,b = generate_floor(deck,[],[],[],0)["regions"]
    assert a["method"] == b["method"] == "COORDINATED_FLOOR_QUADS"
    assert all(r["boundaryInterfaces"][0]["status"] == "CONTINUITY_REVIEW_REQUIRED" for r in (a,b))
    assert {n["index"] for n in a["nodes"]}.isdisjoint(n["index"] for n in b["nodes"])


def test_four_corner_deck_respects_diagonal_frame_constraint():
    ring = [[0,0],[0,4000],[4000,4000],[4000,0]]
    deck = {"supportingFloorId":"F","elevationMm":3000,"regions":[{"id":"R","ringsMm":[ring]}],
            "bearingLines":[{"axisMm":[ring[0],ring[2]]}]}
    frame = [{"index":0,"positionM":[0,0,3]},{"index":1,"positionM":[4,-4,3]}]
    beams = [{"physicalMemberId":"P","floorId":"F","topElevationMm":3000,"analyticalElementIndices":[0]}]
    elements = [{"id":"E","startNodeIndex":0,"endNodeIndex":1}]
    region, = generate_floor(deck,frame,beams,elements,2)["regions"]
    assert region["method"] == "COORDINATED_FLOOR_QUADS"
    candidate, = region["beamSubdivisionCandidates"]
    assert len(candidate["interiorNodeIndices"]) >= 1
    assert all(len(plates) == 2 for plates in candidate["edgePlateIds"])



def test_reviewed_monolithic_edge_reuses_dofs_and_rejects_unknown_region():
    import pytest
    left = {"id":"L","ringsMm":[[[0,0],[0,2000],[2000,2000],[2000,0]]]}
    right = {"id":"R","ringsMm":[[[2000,0],[2000,2000],[4000,2000],[4000,0]]]}
    deck = {"supportingFloorId":"F","elevationMm":3000,"bearingLines":[],"regions":[left,right]}
    review = {"regionIds":["R","L"],"connection":"MONOLITHIC_FULL_INTERFACE","reference":"controlled-fixture"}
    result = generate_floor(deck,[],[],[],26,[review])
    a,b = result["regions"]
    assert a["boundaryInterfaces"][0]["status"] == "REVIEWED_MONOLITHIC_DOFS"
    def interface(region):
        return {(n["index"],n["id"]) for n in region["nodes"] if n["positionM"][0] == 2}
    assert interface(a) == interface(b)
    unique = {n["index"] for r in (a,b) for n in r["nodes"]}
    assert unique == set(range(26,result["nextFreeNodeIndex"]))
    with pytest.raises(ValueError,match="Invalid or duplicate"):
        generate_floor(deck,[],[],[],26,[dict(review,regionIds=["L","missing"])])

def test_monolithic_joint_transfers_pressure_across_a_region_without_supports():
    import pytest
    from worker_main import run_pynite_solve
    left = {"id":"L","ringsMm":[[[0,0],[0,2000],[2000,2000],[2000,0]]]}
    right = {"id":"R","ringsMm":[[[2000,0],[2000,2000],[4000,2000],[4000,0]]]}
    deck = {"supportingFloorId":"F","elevationMm":0,"bearingLines":[],"regions":[left,right]}
    review = {"regionIds":["R","L"],"connection":"MONOLITHIC_FULL_INTERFACE","reference":"controlled-fixture"}
    for reviews in ([],[review]):
        receipts = generate_floor(deck,[],[],[],0,reviews)["regions"]
        by_id,plates = {},[]
        for region in receipts:
            for node in region["nodes"]:
                by_id[node["index"]] = dict(node, restraint=[node["positionM"][0] == 0]*6)
            for quad in region["quadConnectivity"]:
                plates.append(dict(quad, kind="QUAD", thicknessM=.10, elasticityKPa=24e6, poissonRatio=.2,
                                   surfacePressuresByCase={"G":-2. if region["regionId"] == "R" else 0.}))
        payload = dict(model=dict(modelId="coupled-interface",nodes=[by_id[i] for i in range(len(by_id))],
                                  elements=[],loadCases=[dict(id="G",name="gravity")],combinations=[]),
                       plateElements=plates)
        solution = run_pynite_solve(payload)
        if not reviews:
            assert solution["errorCode"] == "DISCONNECTED_COUPLED_MODEL"
            continue
        reactions = solution["envelope"]["loadCaseResults"]["G"]["reactions"]
        assert sum(r["reactionKnM"][2] for r in reactions) == pytest.approx(8,abs=1e-7)
        assert sum(r["reactionKnM"][4] for r in reactions) == pytest.approx(-24,abs=1e-7)

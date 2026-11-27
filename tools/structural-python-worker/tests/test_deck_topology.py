from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from deck_topology import coordinate_deck


def box(x, y, width, height):
    return {"points": [{"x": a, "y": b} for a, b in
                       [(x, y), (x + width, y), (x + width, y + height), (x, y + height)]]}


def test_bays_cross_partitions_and_preserve_overlapping_void_sources():
    shaft = box(2, 2, 2, 3)
    floor = {"id": "F", "floorHeight": 3000, "elevationMm": 0, "boundary": box(0, 0, 20, 10), "voidBoundaries": [shaft],
             "rooms": [{"id": "lift", "type": "lift", "boundary": shaft},
                       {"id": "bed", "type": "bedroom", "boundary": box(0, 0, 3, 4)}]}
    beam = {"floorId": "F", "topElevationMm": 3000, "physicalMemberId": "B", "analyticalElementIds": ["a", "b"],
            "startPointMm": {"x": 10, "y": 0}, "endPointMm": {"x": 10, "y": 10}, "widthMm": 1}
    result = coordinate_deck(floor, [beam, {**beam, "physicalMemberId": "LOW", "topElevationMm": 2999}])
    assert sorted(r["areaMm2"] for r in result["regions"]) == [94, 100]
    assert [line["memberId"] for line in result["bearingLines"]] == ["B"]
    assert result["openingAreaMm2"] == 6
    assert result["gapMm2"] == result["overlapMm2"] == 0
    assert all(r["bearingCandidates"][0]["axisContactLengthMm"] == 10 for r in result["regions"])
    assert result["gravityStatus"] == "BEARING_VERIFICATION_REQUIRED"


def test_oblique_outline_with_two_disconnected_pieces():
    outline = {"points": [{"x": 0, "y": 0}, {"x": 12, "y": 0}, {"x": 0, "y": 12}]}
    floor = {"id": "T", "elevationMm": 3600, "floorHeight": 2900,
             "boundary": outline, "voidBoundaries": [box(3, -1, 2, 14)]}
    result = coordinate_deck(floor, [])
    assert result["elevationMm"] == 6500
    assert result["openingAreaMm2"] == 16
    assert sorted(region["areaMm2"] for region in result["regions"]) == [24.5, 31.5]
    assert all(not region["bearingCandidates"] for region in result["regions"])

def test_registered_upper_surface_retains_floor_landing_only():
    support = {"id": "stilt", "elevationMm": 0, "floorHeight": 3400, "boundary": box(0, 0, 20, 12)}
    stair = {"id": "S", "polygon": box(1, 1, 4, 5), "floorLanding": box(1, 1, 4, 1),
             "midLanding": box(1, 5, 4, 1), "flight1": box(1, 2, 2, 3), "flight2": box(3, 2, 2, 3),
             "flightRiserCounts": [7, 8], "riserCount": 15}
    floor = {"id": "terrace", "elevationMm": 3400, "floorHeight": 3000, "boundary": box(0, 0, 15, 10),
             "canonicalStaircases": [stair]}
    deck = coordinate_deck(floor, [], supporting_floor=support, registered_surface=True)
    assert deck["deckAreaMm2"] == 134
    assert deck["openingAreaMm2"] == 16
    assert deck["retainedLandingAreaMm2"] == 4
    assert deck["elevationMm"] == 3400
    assert deck["supportingFloorId"] == "stilt"
    assert deck["stairComponents"][0]["midMm"] == 4800

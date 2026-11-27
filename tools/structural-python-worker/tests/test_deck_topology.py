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

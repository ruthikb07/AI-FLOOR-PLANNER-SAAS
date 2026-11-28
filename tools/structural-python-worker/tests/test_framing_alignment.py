from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from framing_alignment import preview_alignment


def fixture():
    points = [(0, 0), (4000, 350), (8000, 0)]
    columns = [{"physicalMemberId": f"{floor}:{i}", "floorId": floor, "stackId": f"C{i}",
                "endAnalyticalNodeIndex": i + 3*level, "centerXMm": x, "centerYMm": y,
                "widthMm": 400, "depthMm": 500, "rotationDeg": 0}
               for level, floor in enumerate(("stilt", "upper")) for i, (x, y) in enumerate(points)]
    beams = [{"physicalMemberId": f"B{i}", "floorId": "stilt", "startAnalyticalNodeIndex": i,
              "endAnalyticalNodeIndex": i+1, "depthMm": 400,
              "startPointMm": dict(zip(("x", "y"), a)), "endPointMm": dict(zip(("x", "y"), b))}
             for i, (a, b) in enumerate(zip(points, points[1:]))]
    outline = {"points": [{"x": x, "y": y} for x, y in [(-1000, -1000), (9000, -1000), (9000, 1000), (-1000, 1000)]]}
    return beams, columns, [{"id": "stilt", "floorUse": "STILT_PARKING", "boundary": outline},
                            {"id": "upper", "boundary": outline}]


def test_straight_line_moves_the_stack_and_preserves_existing_frame():
    beams, columns, floors = fixture()
    result = preview_alignment("stilt", list(reversed(beams)), columns, floors)
    assert [row["distanceMm"] for row in result["columnAxisDeviations"]] == [0, 350, 0]
    assert result["straightWithExistingColumns"]["status"] == "AXIS_MISSES_COLUMN"
    assert [s["jointSpanMm"] for s in result["straightWithStackMoves"]["spans"]] == [4000, 4000]
    assert [move["floorId"] for move in result["straightWithStackMoves"]["moves"]] == ["stilt", "upper"]
    assert all(move["toMm"] == [4000, 0] for move in result["straightWithStackMoves"]["moves"])
    assert result["straightWithStackMoves"]["moves"][0]["parkingReviewRequired"]
    assert columns[1]["centerYMm"] == columns[4]["centerYMm"] == 350


def test_rejects_chain_with_missing_column_bearing():
    beams, columns, floors = fixture()
    with pytest.raises(ValueError, match="column-top joint"):
        preview_alignment("stilt", beams, columns[1:], floors)

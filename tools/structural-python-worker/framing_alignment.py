"""Preview alternatives for a selected chain of column-supported physical beams."""
from collections import defaultdict
import math

from shapely.affinity import rotate, translate
from shapely.geometry import LineString, Point, box

from deck_topology import AREA_TOL_MM2, polygon, xy


def _bearing_columns(beams, columns):
    joints = defaultdict(list)
    for beam in beams:
        a, b = beam["startAnalyticalNodeIndex"], beam["endAnalyticalNodeIndex"]
        joints[a].append((b, beam))
        joints[b].append((a, beam))
    tips = sorted(node for node, links in joints.items() if len(links) == 1)
    if len(tips) != 2 or any(len(links) > 2 for links in joints.values()):
        raise ValueError("Select one continuous, unbranched beam chain")
    supports = defaultdict(list)
    for column in columns:
        supports[column["endAnalyticalNodeIndex"]].append(column)
    if any(len(supports[node]) != 1 for node in joints):
        raise ValueError("Each selected beam endpoint must reach one column-top joint")
    order, members = [tips[0]], []
    while len(members) < len(beams):
        next_link = [(node, beam) for node, beam in joints[order[-1]] if node not in order]
        if len(next_link) != 1:
            raise ValueError("Selected beams are disconnected or contain a loop")
        node, beam = next_link[0]
        order.append(node)
        members.append(beam)
    return [supports[node][0] for node in order], members


def _centre(column):
    return column["centerXMm"], column["centerYMm"]


def _section(column):
    x, y = _centre(column)
    w, d = column["widthMm"] / 2, column["depthMm"] / 2
    return rotate(box(x-w, y-d, x+w, y+d), column["rotationDeg"], origin=(x, y))


def _spans(points, beams):
    return [{"beamId": beam["physicalMemberId"], "startMm": list(a), "endMm": list(b),
             "jointSpanMm": math.dist(a, b), "spanDepthRatio": math.dist(a, b) / beam["depthMm"]}
            for a, b, beam in zip(points, points[1:], beams)]


def _clearance_changes(column, delta, floor):
    before = _section(column)
    after = translate(before, *delta)
    try:
        outline = polygon(floor["boundary"])
        outside = after.difference(outline).area - before.difference(outline).area
        protected = [(f"void-{i}", boundary) for i, boundary in enumerate(floor.get("voidBoundaries") or [])]
        protected.extend((stair["id"], stair["polygon"]) for stair in floor.get("canonicalStaircases") or [])
        protected.extend((room["id"], room["boundary"]) for room in floor.get("rooms", []))
        changed = [{"entityId": "floor-boundary", "addedOverlapMm2": outside}] if outside > AREA_TOL_MM2 else []
        for entity_id, boundary in protected:
            footprint = polygon(boundary)
            extra = footprint.intersection(after).area - footprint.intersection(before).area
            if extra > AREA_TOL_MM2:
                changed.append({"entityId": entity_id, "addedOverlapMm2": extra})
        return changed
    except ValueError:
        return [{"entityId": floor["id"], "addedOverlapMm2": None}]


def preview_alignment(floor_id, beams, columns, floors):
    if not 2 <= len(beams) <= 32 or any(beam["floorId"] != floor_id for beam in beams):
        raise ValueError("Select two to 32 physical beams on one structural level")
    support, ordered = _bearing_columns(beams, [c for c in columns if c["floorId"] == floor_id])
    points = [_centre(column) for column in support]
    for a, b, beam in zip(points, points[1:], ordered):
        axis = [xy(beam[key]) for key in ("startPointMm", "endPointMm")]
        if any(min(math.dist(p, q) for q in axis) > 1e-6 for p in (a, b)):
            raise ValueError("This chain already contains eccentric beam-end geometry")
    chord = LineString([points[0], points[-1]])
    if chord.length <= 1e-6:
        raise ValueError("The chain endpoints coincide")
    along = [chord.project(Point(point)) for point in points]
    if any(b - a <= 1e-6 for a, b in zip(along, along[1:])):
        raise ValueError("The chain reverses direction along its endpoint axis")
    projected = [tuple(chord.interpolate(station).coords[0]) for station in along]
    deviations = [math.dist(a, b) for a, b in zip(points, projected)]
    by_floor = {floor["id"]: floor for floor in floors}
    moves = []
    for column, old, new, distance in zip(support, points, projected, deviations):
        if distance <= 1e-6:
            continue
        delta = new[0] - old[0], new[1] - old[1]
        for lift in columns:
            if lift["stackId"] != column["stackId"]:
                continue
            floor = by_floor.get(lift["floorId"])
            moves.append({"columnId": lift["physicalMemberId"], "stackId": lift["stackId"],
                          "floorId": lift["floorId"], "fromMm": list(_centre(lift)),
                          "toMm": [a + b for a, b in zip(_centre(lift), delta)],
                          "affectedPlanAreas": _clearance_changes(lift, delta, floor) if floor else [],
                          "parkingReviewRequired": floor is None or floor.get("floorUse") == "STILT_PARKING"})

    # An axis inside a section is a plan fit only. The resulting joint would
    # require compatible eccentric connection stiffness and reanalysis.
    eccentric_fits = all(_section(column).covers(Point(position))
                         for column, position in zip(support, projected))
    return {
        "floorId": floor_id, "reviewStatus": "STRUCTURAL_AND_ARCHITECTURAL_REVIEW_REQUIRED",
        "columnAxisDeviations": [{"columnId": column["physicalMemberId"], "distanceMm": deviation,
                                  "rotationDeg": column["rotationDeg"]}
                                 for column, deviation in zip(support, deviations)],
        "existing": {"spans": _spans(points, ordered)},
        "straightWithStackMoves": {"spans": _spans(projected, ordered), "moves": moves,
                                   "status": "ARCHITECTURAL_APPROVAL_REQUIRED" if moves else "ALREADY_STRAIGHT"},
        "straightWithExistingColumns": {
            "spans": _spans(projected, ordered),
            "status": ("ALREADY_STRAIGHT" if not moves else
                       "ECCENTRIC_CONNECTION_REVIEW_REQUIRED" if eccentric_fits else "AXIS_MISSES_COLUMN"),
        },
    }

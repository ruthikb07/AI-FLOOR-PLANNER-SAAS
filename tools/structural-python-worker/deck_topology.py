"""Coordinate planar deck geometry in canonical millimetres. Bearings are candidates."""
import math

from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize, unary_union

AREA_TOL_MM2 = 0.01
OPEN_SPACE_TYPES = {"lift", "service_shaft", "staircase", "ots", "courtyard", "open_to_sky"}


def xy(point):
    pair = (float(point["x"]), float(point["y"]))
    if not all(math.isfinite(value) for value in pair):
        raise ValueError("Non-finite canonical coordinate")
    return pair


def polygon(boundary):
    if not boundary or boundary.get("segments") or boundary.get("arcs"):
        raise ValueError("A linear canonical boundary is required")
    shape = Polygon([xy(point) for point in boundary["points"]])
    if not shape.is_valid or shape.area <= AREA_TOL_MM2:
        raise ValueError("Invalid canonical polygon")
    return shape


def rings(region):
    return [list(region.exterior.coords), *[list(hole.coords) for hole in region.interiors]]


def edge_bearings(cell, bearings):
    """Exclude transverse beam ends from longitudinal edge bearing candidates."""
    contacts = []
    for beam, axis, face in bearings:
        (ax, ay), (bx, by) = axis.coords
        segments = []
        for ring_index, ring in enumerate(rings(cell)):
            for edge_index, (start, end) in enumerate(zip(ring, ring[1:])):
                dx, dy = end[0] - start[0], end[1] - start[1]
                edge = LineString([start, end])
                # Dimensionless sine of the angle. This check never moves an edge.
                if abs(dx * (by - ay) - dy * (bx - ax)) > 1e-10 * edge.length * axis.length:
                    continue
                overlap = edge.intersection(face)
                if overlap.length > 0:
                    segments.append({"ringIndex": ring_index, "edgeIndex": edge_index,
                                     "contactMm": list(overlap.coords),
                                     "faceContactLengthMm": overlap.length,
                                     "axisContactLengthMm": edge.intersection(axis).length})
        if segments:
            contacts.append({"memberId": beam["physicalMemberId"],
                             "analyticalElementIds": beam["analyticalElementIds"],
                             "segments": segments,
                             "faceContactLengthMm": sum(item["faceContactLengthMm"] for item in segments),
                             "axisContactLengthMm": sum(item["axisContactLengthMm"] for item in segments)})
    return contacts


def coordinate_deck(floor, beams):
    outline = polygon(floor["boundary"])
    sources = [(f"void-{i}", v) for i, v in enumerate(floor.get("voidBoundaries") or [])]
    sources.extend((room["id"], room.get("boundary")) for room in floor.get("rooms", [])
                   if room["type"] in OPEN_SPACE_TYPES)
    sources.extend((flight["id"], flight.get("boundary")) for flight in floor.get("stairs", []))
    holes = [(key, polygon(boundary)) for key, boundary in sources]
    void = unary_union([shape for _, shape in holes]).intersection(outline)
    deck = outline.difference(void)
    elevation = float(floor["elevationMm"]) + float(floor["floorHeight"])
    if not math.isfinite(elevation):
        raise ValueError("Invalid storey deck elevation")
    bearings = []
    cuts = [deck.boundary]
    for beam in beams:
        if beam["floorId"] != floor["id"] or beam["topElevationMm"] != elevation:
            continue
        axis = LineString([xy(beam["startPointMm"]), xy(beam["endPointMm"])])
        width = float(beam["widthMm"])
        if axis.length == 0 or not math.isfinite(width) or width <= 0:
            raise ValueError("Invalid beam bearing geometry")
        face = axis.buffer(width / 2, cap_style=2)
        bearings.append((beam, axis, face))
        cuts.append(axis.intersection(deck))
    regions = []
    cells = sorted((cell for cell in polygonize(unary_union(cuts)) if deck.covers(cell)),
                   key=lambda cell: (cell.bounds, cell.area, cell.wkb_hex))
    for i, cell in enumerate(cells):
        contacts = edge_bearings(cell, bearings)
        regions.append({"id": f"{floor['id']}:deck:{i+1}", "ringsMm": rings(cell),
                        "areaMm2": cell.area, "bearingCandidates": contacts})
    union = unary_union(cells)
    gap = deck.symmetric_difference(union).area
    overlap = abs(sum(cell.area for cell in cells) - union.area)
    if max(gap, overlap, abs(outline.area - void.area - union.area)) > AREA_TOL_MM2:
        raise ValueError("Deck coverage does not reconcile")
    return {"floorId": floor["id"], "elevationMm": elevation,
            "bearingLines": [{"memberId": beam["physicalMemberId"], "axisMm": list(axis.coords),
                              "faceRingsMm": rings(face), "analyticalElementIds": beam["analyticalElementIds"]}
                             for beam, axis, face in bearings], "footprintAreaMm2": outline.area, "openingAreaMm2": void.area,
            "openingSources": [{"id": key, "ringsMm": rings(shape)} for key, shape in holes],
            "deckAreaMm2": union.area, "gapMm2": gap, "overlapMm2": overlap, "regions": regions,
            "gravityStatus": "BEARING_VERIFICATION_REQUIRED"}

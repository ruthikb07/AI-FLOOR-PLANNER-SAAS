"""Check a proposed horizontal deck mesh against saved physical geometry and frame DOFs."""
from collections import defaultdict
import math

from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

from deck_topology import AREA_TOL_MM2


def frame_plan_point(node):
    x, y, _ = node["positionM"]
    return x * 1000, -y * 1000


def frame_segments(deck, surface, frame_nodes, beams, frame_elements):
    for beam in beams:
        if beam["floorId"] != deck["supportingFloorId"] or beam["topElevationMm"] != deck["elevationMm"]:
            continue
        for index in beam["analyticalElementIndices"]:
            element = frame_elements[index]
            start, end = (element[key] for key in ("startNodeIndex", "endNodeIndex"))
            line = LineString([frame_plan_point(frame_nodes[i]) for i in (start, end)])
            if line.intersection(surface).length > 1e-6:
                yield beam["physicalMemberId"], element["id"], start, end, line


def check_deck_mesh(deck, proposal, frame_nodes, beams, frame_elements, *, require_frame_connection=True):
    regions = [r for r in deck["regions"] if r["id"] == proposal["regionId"]]
    if len(regions) != 1:
        raise ValueError("Unknown physical deck region")
    region = regions[0]
    outer, *holes = region["ringsMm"]
    surface = Polygon(outer, holes)
    vertices, quads = proposal["nodes"], proposal["quads"]
    if not 4 <= len(vertices) <= 25000 or not 1 <= len(quads) <= 20000:
        raise ValueError("Mesh size is outside the supported range")

    points, shared = {}, {}
    for vertex in vertices:
        key = vertex["id"]
        if not isinstance(key, str) or not key or key in points:
            raise ValueError("Duplicate or invalid mesh node ID")
        if "frameNodeIndex" in vertex:
            index = vertex["frameNodeIndex"]
            if type(index) is not int or not 0 <= index < len(frame_nodes) or "pointMm" in vertex:
                raise ValueError("Invalid shared frame node reference")
            node = frame_nodes[index]
            x, y, z = node["positionM"]
            if node["index"] != index or abs(z * 1000 - deck["elevationMm"]) > 1e-6:
                raise ValueError("Shared frame node has a different index or elevation")
            point = (x * 1000, -y * 1000)
            shared[key] = index
        else:
            x, y = vertex["pointMm"]
            point = (float(x), float(y))
        if not all(math.isfinite(v) for v in point):
            raise ValueError("Non-finite mesh coordinate")
        points[key] = point
    if len(set(points.values())) != len(points):
        raise ValueError("Coincident mesh nodes have distinct identities")

    cells, incidence, quad_ids, used = [], defaultdict(list), set(), set()
    for quad in quads:
        ids = quad["nodeIds"]
        if not isinstance(quad["id"], str) or not quad["id"] or quad["id"] in quad_ids:
            raise ValueError("Duplicate or invalid quad ID")
        quad_ids.add(quad["id"])
        if len(ids) != 4 or len(set(ids)) != 4 or not set(ids) <= points.keys():
            raise ValueError("Quad requires four distinct registered nodes")
        used.update(ids)
        coordinates = [points[i] for i in ids]
        cell = Polygon(coordinates)
        # Canonical Y increases downwards. Clockwise canonical rings face +Z in solver coordinates.
        if (not cell.is_valid or cell.area <= AREA_TOL_MM2 or cell.exterior.is_ccw or
                len(cell.convex_hull.exterior.coords) != 5 or not cell.equals(cell.convex_hull)):
            raise ValueError("Folded, inverted or degenerate quad")
        cells.append(cell)
        for a, b in zip(ids, ids[1:] + ids[:1]):
            incidence[tuple(sorted((a, b)))].append(quad["id"])
    if used != points.keys():
        raise ValueError("Unreferenced mesh node")
    mesh = unary_union(cells)
    gap = surface.difference(mesh).area
    outside = mesh.difference(surface).area
    overlap = sum(c.area for c in cells) - mesh.area
    if max(gap, outside, abs(overlap)) > AREA_TOL_MM2:
        raise ValueError("Quad coverage has gaps, overlap or crosses the physical boundary or opening")

    shared_edges = {}
    # Linear tolerance for floating-point interpolation on an oblique boundary,
    # on the same millimetre scale as the saved frame elevation check.
    boundary = surface.boundary
    boundary_band = None
    for (a, b), adjacent in incidence.items():
        edge = LineString([points[a], points[b]])
        if len(adjacent) > 2:
            raise ValueError("Nonconforming mesh edge or hanging node")
        if len(adjacent) == 1 and not boundary.covers(edge):
            if boundary_band is None:
                boundary_band = boundary.buffer(1e-6)
            if not boundary_band.covers(edge):
                raise ValueError("Nonconforming mesh edge or hanging node")
        if a in shared and b in shared:
            shared_edges[tuple(sorted((shared[a], shared[b])))] = adjacent

    connections, unmatched = [], []
    for beam_id, element_id, start, end, _ in frame_segments(deck, surface, frame_nodes, beams, frame_elements):
        adjacent = shared_edges.get(tuple(sorted((start, end))))
        if adjacent is None:
            if require_frame_connection:
                raise ValueError(f"Frame element {element_id} requires matching plate edge node identities")
            unmatched.append(element_id)
        else:
            connections.append({"physicalBeamId": beam_id, "elementId": element_id,
                                "frameNodeIndices": [start, end], "plateIds": adjacent})
    if require_frame_connection and not connections:
        raise ValueError("No shared beam and plate edge in the selected region")
    analytical_indices = dict(shared)
    next_index = len(frame_nodes)
    mesh_nodes = []
    for key, (x, y) in points.items():
        if key not in analytical_indices:
            analytical_indices[key] = next_index
            next_index += 1
        mesh_nodes.append({"id": key, "index": analytical_indices[key],
                           "positionM": (frame_nodes[shared[key]]["positionM"] if key in shared else
                                         [x / 1000, -y / 1000, deck["elevationMm"] / 1000]),
                           "sharesFrameDofs": key in shared})
    connectivity = [{"id": quad["id"], "nodeIndices": [analytical_indices[k] for k in quad["nodeIds"]]}
                    for quad in quads]
    return {"nodes": mesh_nodes, "quadConnectivity": connectivity, "status": "MESH_GEOMETRY_CHECKED", "regionId": region["id"], "quadCount": len(cells),
            "gapMm2": gap, "outsideMm2": outside, "overlapMm2": overlap, "sharedEdges": connections,
            **({} if require_frame_connection else {"unmatchedFrameElementIds": sorted(set(unmatched))}),
            "gravityStatus": "BEARING_AND_LOAD_TRANSFER_UNVERIFIED"}

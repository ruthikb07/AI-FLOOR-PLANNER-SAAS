"""Deterministic quadrilateral proposals for registered horizontal deck regions."""
from collections import defaultdict
import math
from urllib.parse import quote

from shapely import constrained_delaunay_triangles
from shapely.geometry import LineString, MultiLineString, Polygon, box
from shapely.strtree import STRtree

from adaptive_mesh import adaptive_quads
from deck_mesh import check_deck_mesh, frame_segments

MAX_QUADS = 20_000
MAX_NODES = 25_000
MAX_FLOOR_CORNERS = 25_000
MAX_ASPECT_RATIO = 10
MIN_SCALED_JACOBIAN = 0.25
LENGTH_TOL_MM = 1e-6


def _grid_cells(surface, points, quad_budget, *, balanced=False):
    if len(points) == 4 and not surface.interiors and surface.equals(surface.convex_hull):
        return [surface]
    xs, ys = (sorted({p[k] for p in points}) for k in (0, 1))
    if balanced:
        min_x, min_y = (min(b - a for a, b in zip(axis, axis[1:])) for axis in (xs, ys))
        if min(min_x, min_y) <= LENGTH_TOL_MM:
            raise ValueError("Grid contains near-coincident boundary coordinates")
        cap_x, cap_y = .99 * MAX_ASPECT_RATIO * min_y, .99 * MAX_ASPECT_RATIO * min_x
        subdivisions = [[math.ceil((b - a) / limit) for a, b in zip(axis, axis[1:])]
                        for axis, limit in ((xs, cap_x), (ys, cap_y))]
        if math.prod(sum(parts) for parts in subdivisions) > quad_budget:
            raise ValueError("Balanced grid exceeds the quadrilateral budget")
        xs, ys = ([a + (b - a) * i / n for a, b, n in zip(axis, axis[1:], parts) for i in range(n)]
                  + [axis[-1]] for axis, parts in zip((xs, ys), subdivisions))
    if (len(xs) - 1) * (len(ys) - 1) > quad_budget:
        raise ValueError("Grid exceeds the quadrilateral budget")
    cells = []
    for x0, x1 in zip(xs, xs[1:]):
        for y0, y1 in zip(ys, ys[1:]):
            cell = box(x0, y0, x1, y1)
            if surface.covers(cell):
                cells.append(cell)
            elif surface.intersection(cell).area > 0:
                raise ValueError("Grid crosses an oblique deck boundary")
    return cells


def _quad_cells(surface, quad_budget):
    # Triangles partition the polygon geometrically. Split each into three
    # convex four-node cells before passing any connectivity to the solver handoff.
    triangles = constrained_delaunay_triangles(surface.normalize()).geoms
    if 3 * len(triangles) > quad_budget:
        raise ValueError("Boundary-fitted mesh exceeds the quadrilateral budget")
    cells = []
    for triangle in sorted(triangles, key=lambda t: t.normalize().wkb):
        vertices = list(triangle.exterior.coords)[:-1]
        midpoints = [tuple((a + b) / 2 for a, b in zip(p, q))
                     for p, q in zip(vertices, vertices[1:] + vertices[:1])]
        centre = tuple(math.fsum(axis) / 3 for axis in zip(*vertices))
        cells.extend(Polygon([p, midpoints[i], centre, midpoints[i - 1]])
                     for i, p in enumerate(vertices))
    return cells


def _proposal(region, cells, supports, quad_budget):
    if not 1 <= len(cells) <= quad_budget:
        raise ValueError("Mesh exceeds the quadrilateral budget or contains no cells")
    vertices, quads = {}, []
    max_aspect, min_jacobian = 1, 1
    for cell in cells:
        coords = list(cell.exterior.coords)[:-1]
        if len(coords) != 4:
            raise ValueError("Expected four distinct quadrilateral corners")
        if cell.exterior.is_ccw:
            coords.reverse()
        ids, lengths = [], []
        for i, p in enumerate(coords):
            a, b = coords[i - 1], coords[(i + 1) % 4]
            u, v = (a[0] - p[0], a[1] - p[1]), (b[0] - p[0], b[1] - p[1])
            lu, lv = math.hypot(*u), math.hypot(*v)
            if min(lu, lv) <= LENGTH_TOL_MM:
                raise ValueError("Quadrilateral has a zero-length or near-coincident edge")
            lengths.append(lv)
            min_jacobian = min(min_jacobian, (u[0] * v[1] - u[1] * v[0]) / (lu * lv))
            if p not in vertices:
                vertex = {"id": str(len(vertices))}
                indices = supports.get(p, ())
                if len(indices) == 1:
                    vertex["frameNodeIndex"], = indices
                else:
                    vertex["pointMm"] = list(p)
                vertices[p] = vertex
            ids.append(vertices[p]["id"])
        max_aspect = max(max_aspect, max(lengths) / min(lengths))
        if max_aspect > MAX_ASPECT_RATIO or min_jacobian < MIN_SCALED_JACOBIAN:
            raise ValueError("Quad exceeds aspect ratio 10 or scaled corner Jacobian below 0.25")
        quads.append({"id": str(len(quads)), "nodeIds": ids})
    if len(vertices) > MAX_NODES:
        raise ValueError("Mesh exceeds the node budget")
    return {"regionId": region["id"], "nodes": list(vertices.values()), "quads": quads}, {
        "maxEdgeAspectRatio": max_aspect, "minScaledCornerJacobian": min_jacobian}


def generate_region(deck, region, frame_nodes, beams, elements, quad_budget):
    outer, *holes = region["ringsMm"]
    surface = Polygon(outer, holes)
    supports = defaultdict(set)
    for _, _, start, end, axis in frame_segments(deck, surface, frame_nodes, beams, elements):
        for point, index in zip(axis.coords, (start, end)):
            if abs(frame_nodes[index]["positionM"][2] * 1000 - deck["elevationMm"]) <= LENGTH_TOL_MM:
                supports[point].add(index)
    boundary_points = {tuple(p) for ring in region["ringsMm"] for p in ring}

    def check(cells, method):
        proposal, quality = _proposal(region, cells, supports, quad_budget)
        receipt = check_deck_mesh(deck, proposal, frame_nodes, beams, elements, require_frame_connection=False)
        receipt.update({"method": method, "quality": quality, "areaMm2": surface.area,
                        "boundaryInterfaces": []})
        return receipt

    try:
        return check(_grid_cells(surface, boundary_points | supports.keys(), quad_budget), "RECTANGULAR_GRID")
    except ValueError:
        pass
    # Coordinate lines from incidental frame endpoints can create slivers.
    # Keep the deck boundary and report any frame elements left unmatched.
    try:
        return check(_grid_cells(surface, boundary_points, quad_budget, balanced=True), "BALANCED_GRID")
    except ValueError:
        pass
    try:
        return check(_quad_cells(surface, quad_budget), "BOUNDARY_FITTED_QUADS")
    except ValueError:
        return check(adaptive_quads(surface, quad_budget), "ADAPTIVE_BOUNDARY_QUADS")


def _boundary_edges(receipt):
    def plan_position(node):
        x, y, _ = node["positionM"]
        return round(x * 1000, 9), round(-y * 1000, 9)

    points = {node["index"]: plan_position(node) for node in receipt["nodes"]}
    edges = defaultdict(int)
    for plate in receipt["quadConnectivity"]:
        ids = plate["nodeIndices"]
        for a, b in zip(ids, ids[1:] + ids[:1]):
            edges[tuple(sorted((a, b)))] += 1
    return [(a, b, LineString((points[a], points[b]))) for (a, b), n in edges.items() if n == 1]


def _check_interfaces(results, regions):
    boundaries = [Polygon(region["ringsMm"][0], region["ringsMm"][1:]).boundary for region in regions]
    tree = STRtree(boundaries)
    edges = {}
    for i, j in sorted((int(i), int(j)) for i, j in zip(*tree.query(boundaries, predicate="intersects")) if i < j):
        common = boundaries[i].intersection(boundaries[j])
        if common.length <= LENGTH_TOL_MM:
            continue
        pair = [results[i], results[j]]
        band = common.buffer(LENGTH_TOL_MM)
        partitions = []
        for index in (i, j):
            if index not in edges:
                edges[index] = _boundary_edges(results[index]) if "nodes" in results[index] else []
            partitions.append([edge for edge in edges[index] if band.covers(edge[2])])
        first, second = partitions
        first_coordinates = {frozenset(line.coords): (a, b) for a, b, line in first}
        second_coordinates = {frozenset(line.coords): (a, b) for a, b, line in second}
        coverage = MultiLineString([line for _, _, line in first]).length
        conforming = (abs(coverage - common.length) <= LENGTH_TOL_MM
                      and first_coordinates.keys() == second_coordinates.keys())
        # Merging is only justified by the same saved analytical connection.
        same_edge_dofs = conforming and first_coordinates == second_coordinates
        for region, neighbour in (pair, pair[::-1]):
            if "nodes" in region:
                region["boundaryInterfaces"].append({
                    "regionId": neighbour["regionId"], "lengthMm": common.length,
                    "status": ("SHARED_FRAME_DOFS" if same_edge_dofs else
                               "CONTINUITY_REVIEW_REQUIRED" if conforming else "NONCONFORMING_INTERFACE")})


def generate_floor(deck, frame_nodes, beams, elements, first_free):
    if type(first_free) is not int or first_free < len(frame_nodes):
        raise ValueError("Invalid building node registry offset")
    results = []
    quad_budget = MAX_QUADS
    corners = sum(len(ring) for region in deck["regions"] for ring in region["ringsMm"])
    region_ids = [region["id"] for region in deck["regions"]]
    if len(region_ids) != len(set(region_ids)):
        raise ValueError("Duplicate deck region identity")
    for region in deck["regions"]:
        try:
            if corners > MAX_FLOOR_CORNERS:
                raise ValueError("Floor exceeds the boundary vertex budget")
            receipt = generate_region(deck, region, frame_nodes, beams, elements, quad_budget)
        except ValueError as error:
            results.append({"regionId": region["id"], "status": "MESH_REVIEW_REQUIRED",
                            "reason": str(error)})
            continue
        scope = "/".join(quote(id, safe="") for id in (deck["supportingFloorId"], region["id"]))
        remap = {}
        for node in receipt["nodes"]:
            original = node["index"]
            if not node["sharesFrameDofs"]:
                node["index"] = first_free
                first_free += 1
            remap[original] = node["index"]
            node["id"] = f"frame/{original}" if node["sharesFrameDofs"] else f"plate/{scope}/{node['id']}"
        for plate in receipt["quadConnectivity"]:
            plate["id"] = f"quad/{scope}/{plate['id']}"
            plate["nodeIndices"] = [remap[i] for i in plate["nodeIndices"]]
        for edge in receipt["sharedEdges"]:
            edge["plateIds"] = [f"quad/{scope}/{i}" for i in edge["plateIds"]]
        results.append(receipt)
        quad_budget -= receipt["quadCount"]
    if corners <= MAX_FLOOR_CORNERS:
        _check_interfaces(results, deck["regions"])
    return {"regions": results, "nextFreeNodeIndex": first_free}

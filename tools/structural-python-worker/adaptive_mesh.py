"""Locally refine a planar Delaunay partition and recover every boundary segment."""

import numpy as np
from scipy.spatial import Delaunay, QhullError
from shapely import contains_xy
from shapely.geometry import LineString, Polygon


def adaptive_quads(surface, budget):
    points = []
    indices = {}

    def index(point):
        key = tuple(point)
        if key not in indices:
            indices[key] = len(points)
            points.append(key)
        return indices[key]

    segments = []
    for ring in (surface.exterior, *surface.interiors):
        ids = [index(p) for p in ring.coords]
        segments.extend(zip(ids, ids[1:]))

    for _ in range(min(4096, budget)):
        if len(points) > budget or budget < 3:
            raise ValueError("Adaptive boundary refinement exceeds the mesh budget")
        xy = np.array(points)
        try:
            triangles = Delaunay(xy).simplices
        except QhullError as error:
            raise ValueError("Adaptive Delaunay partition failed") from error
        edges = {tuple(sorted((a, b))) for tri in triangles for a, b in zip(tri, np.roll(tri, -1))}
        recovered = []
        for a, b in segments:
            if tuple(sorted((a, b))) in edges:
                recovered.append((a, b))
            else:
                mid = index((xy[a] + xy[b]) / 2)
                recovered.extend(((a, mid), (mid, b)))
        if len(recovered) != len(segments):
            segments = recovered
            continue

        centres = xy[triangles].mean(axis=1)
        inside = triangles[contains_xy(surface, centres[:, 0], centres[:, 1])]
        if len(inside) * 3 > budget:
            raise ValueError("Adaptive quad count exceeds the mesh budget")
        # Edge midpoints and barycentres partition each triangle into three Q4s.
        # Evaluate those actual cells before selecting the next refinement.
        vertices = xy[inside]
        mids = (vertices + np.roll(vertices, -1, axis=1)) / 2
        centres = np.broadcast_to(vertices.mean(axis=1)[:, None, :], vertices.shape)
        cells = np.stack((vertices, mids, centres, np.roll(mids, 1, axis=1)), axis=2)
        sides = np.roll(cells, -1, axis=2) - cells
        lengths = np.linalg.norm(sides, axis=3)
        previous = np.roll(sides, 1, axis=2)
        jac = previous[..., 0] * sides[..., 1] - previous[..., 1] * sides[..., 0]
        scaled = jac / (lengths * np.roll(lengths, 1, axis=2))
        bad = ((lengths.max(axis=2) > 10 * lengths.min(axis=2)) |
               (scaled.min(axis=2) < .250001)).any(axis=1)
        if not bad.any():
            return [Polygon(corners) for corners in cells.reshape(-1, 4, 2)]
        # Refine at the circumcentre of the worst triangle. An encroached
        # constrained segment must be bisected first to recover its boundary.
        bad_ids = np.flatnonzero(bad)
        worst = bad_ids[np.argmin(scaled[bad].min(axis=(1, 2)))]
        a, b, c = vertices[worst]
        matrix = np.array([b - a, c - a])
        candidate = a + np.linalg.solve(2 * matrix, np.sum(matrix * matrix, axis=1))
        starts, ends = xy[np.array(segments)].transpose(1, 0, 2)
        encroached = np.sum((starts - candidate) * (ends - candidate), axis=1) <= 0
        splits = {tuple(sorted(edge)) for edge, flag in zip(segments, encroached) if flag}
        if not splits and not contains_xy(surface, *candidate):
            ray = LineString([vertices[worst].mean(axis=0), candidate])
            splits = {tuple(sorted(edge)) for edge in segments if ray.intersects(LineString(xy[list(edge)]))}
        if not splits:
            if not contains_xy(surface, *candidate) or tuple(candidate) in indices:
                raise ValueError("Constrained refinement cannot insert the required circumcentre")
            index(candidate)
            continue
        updated = []
        for a, b in segments:
            if tuple(sorted((a, b))) in splits:
                mid = index((xy[a] + xy[b]) / 2)
                updated.extend(((a, mid), (mid, b)))
            else:
                updated.append((a, b))
        segments = updated
    raise ValueError("Adaptive refinement did not converge within the iteration budget")

import json
import sys
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import Polygon, Point
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from automatic_mesh import generate_floor


RINGS = json.loads((Path(__file__).parent / "fixtures/rejected_apartment_rings.json").read_text())


@pytest.mark.parametrize("key", RINGS)
def test_archived_region_coverage_and_isoparametric_jacobian(key):
    outer, *holes = RINGS[key]
    surface = Polygon(outer, holes)
    deck = {"supportingFloorId": "floor", "elevationMm": 3000,
            "regions": [{"id": key, "ringsMm": RINGS[key]}]}
    receipt, = generate_floor(deck, [], [], [], 0)["regions"]
    xy = {v["index"]: np.array(v["positionM"][:2]) * 1000 for v in receipt["nodes"]}
    # Use solver XY orientation, bilinear shape-function derivatives, and an
    # independent union of the exported connectivity, including opening rings.
    natural = np.array([[-1,-1], [1,-1], [1,1], [-1,1]])
    cells = []
    for element in receipt["quadConnectivity"]:
        corners = np.array([xy[i] for i in element["nodeIndices"]])
        cells.append(Polygon(corners * [1,-1]))
        lengths = np.linalg.norm(corners - np.roll(corners, 1, axis=0), axis=1)
        assert lengths.max() / lengths.min() <= 10
        for xi, eta in np.vstack((natural, natural / np.sqrt(3), [0,0])):
            derivatives = np.column_stack((natural[:,0]*(1+natural[:,1]*eta),
                                           natural[:,1]*(1+natural[:,0]*xi))) / 4
            jac = corners.T @ derivatives
            assert np.linalg.det(jac) / np.prod(np.linalg.norm(jac, axis=0)) >= .25
    assert surface.symmetric_difference(unary_union(cells)).area <= .01
    assert all(min(Point(p).distance(Point(v * [1,-1])) for v in xy.values()) <= 1e-6
               for ring in RINGS[key] for p in ring)

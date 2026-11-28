"""Identify complete, identity-bound slab edge chains along straight frame members."""
from collections import defaultdict
import math

from shapely import STRtree
from shapely.geometry import LineString, Polygon

from deck_mesh import frame_segments


def beam_subdivision_candidates(deck, region, receipt, frame, beams, elements):
    nodes = {node["index"]: node["positionM"] for node in receipt["nodes"]}
    incidence = defaultdict(list)
    for quad in receipt["quadConnectivity"]:
        ids = quad["nodeIndices"]
        for a, b in zip(ids, ids[1:] + ids[:1]):
            incidence[tuple(sorted((a,b)))].append(quad["id"])
    edges = list(incidence)
    lines = [LineString([(nodes[i][0]*1000, -nodes[i][1]*1000) for i in edge]) for edge in edges]
    tree = STRtree(lines)
    candidates = []
    outer, *holes = region["ringsMm"]
    for member, element, start, end, axis in frame_segments(deck, Polygon(outer, holes), frame, beams, elements):
        if start not in nodes or end not in nodes:
            continue
        band = axis.buffer(1e-6)
        chain = []
        for index in tree.query(band, predicate="covers"):
            a,b = edges[index]
            x,y = lines[index].coords
            origin,finish = axis.coords
            dx,dy = finish[0]-origin[0],finish[1]-origin[1]
            def station(p):
                return ((p[0]-origin[0])*dx+(p[1]-origin[1])*dy)/axis.length
            s,t = station(x),station(y)
            if s > t:
                s,t,a,b = t,s,b,a
            chain.append((s,t,a,b))
        chain.sort()
        if (len(chain) < 2 or chain[0][2] != start or chain[-1][3] != end or
                any(left[3] != right[2] for left,right in zip(chain,chain[1:]))):
            continue
        if not math.isclose(sum(t-s for s,t,_,_ in chain),axis.length,abs_tol=1e-6,rel_tol=0):
            continue
        candidates.append({"physicalMemberId":member, "elementId":element,
                           "interiorNodeIndices":[edge[3] for edge in chain[:-1]],
                           "edgePlateIds":[incidence[tuple(sorted((a,b)))] for _,_,a,b in chain]})
    return candidates

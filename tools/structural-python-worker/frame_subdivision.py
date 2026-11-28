"""Expand explicitly identified frame joints and remap canonical member loads."""
from bisect import bisect_right
from math import dist, isfinite


def subdivide(model):
    elements = model.get("elements", [])
    if not any(e.get("interiorNodeIndices") for e in elements):
        return model
    nodes = model["nodes"]
    children, intervals = [], []
    for i, element in enumerate(elements):
        if element["index"] != i:
            raise ValueError("Frame registry indices must match model order")
        first, last = element["startNodeIndex"], element["endNodeIndex"]
        p, q = (nodes[index]["positionM"] for index in (first, last))
        axis = [b-a for a,b in zip(p,q)]
        length = dist(p,q)
        if not isfinite(length) or length <= 1e-9:
            raise ValueError("Invalid parent frame length")
        stations = [(0., first), (1., last)]
        for idx in element.get("interiorNodeIndices", []):
            if type(idx) is not int or not 0 <= idx < len(nodes):
                raise ValueError("Unknown subdivision node")
            point = nodes[idx]["positionM"]
            fraction = sum((x-a)*d for x,a,d in zip(point,p,axis)) / length**2
            projected = [a + fraction*d for a,d in zip(p,axis)]
            if not 0 < fraction < 1 or dist(point,projected) > 1e-9:
                raise ValueError("Subdivision node is outside parent axis")
            stations.append((fraction,idx))
        stations.sort()
        spans = []
        for j, ((a,start),(b,end)) in enumerate(zip(stations, stations[1:])):
            if (b-a)*length <= 1e-9:
                raise ValueError("Duplicate or near-coincident subdivision station")
            child = dict(element, index=len(children))
            child.pop("interiorNodeIndices", None)
            if len(stations) > 2:
                child.update(id=f"{element['id']}/child/{j}", startNodeIndex=start, endNodeIndex=end,
                             parentMemberId=element.get("parentMemberId") or element["id"],
                             sourceElementId=element["id"], parentStationRange=[a,b])
                child["releases"] = {k:v for k,v in element.get("releases",{}).items()
                                     if (a == 0 and k.endswith("Start")) or (b == 1 and k.endswith("End"))}
            spans.append((a,b,len(children)))
            children.append(child)
        intervals.append(spans)
    if len({c["id"] for c in children}) != len(children):
        raise ValueError("Duplicate analytical child identity")

    def spans_for(load):
        index = load["elementIndex"]
        if type(index) is not int or not 0 <= index < len(intervals):
            raise ValueError("Unknown load parent element")
        return intervals[index]

    cases = []
    for case in model.get("loadCases", []):
        line, point = [], []
        for load in case.get("memberUniformLoads", []):
            start, end = load.get("startFraction",0.), load.get("endFraction",1.)
            if not 0 <= start < end <= 1:
                raise ValueError("Invalid parent load interval")
            q0 = load["qStartKnPerM"]
            q1 = load.get("qEndKnPerM",q0)
            def intensity(s):
                return [x+(y-x)*(s-start)/(end-start) for x,y in zip(q0,q1)]
            for a,b,index in spans_for(load):
                left,right = max(start,a),min(end,b)
                if right > left:
                    line.append(dict(load, elementIndex=index, startFraction=(left-a)/(b-a),
                                     endFraction=(right-a)/(b-a), qStartKnPerM=intensity(left),
                                     qEndKnPerM=intensity(right)))
        for load in case.get("memberPointLoads", []):
            fraction = load["fractionalDistance"]
            if not 0 <= fraction <= 1:
                raise ValueError("Invalid parent point load station")
            spans = spans_for(load)
            j = min(bisect_right([span[1] for span in spans],fraction),len(spans)-1)
            a,b,index = spans[j]
            point.append(dict(load, elementIndex=index, fractionalDistance=(fraction-a)/(b-a)))
        cases.append(dict(case, memberUniformLoads=line, memberPointLoads=point))
    return dict(model, elements=children, loadCases=cases)

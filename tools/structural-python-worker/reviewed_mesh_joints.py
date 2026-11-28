"""Apply explicit monolithic joint reviews to matching plate edge partitions."""
def apply_joint_reviews(results, reviews, first_free, boundary_edges):
    from shapely.geometry import MultiLineString
    from shapely.ops import unary_union

    by_id = {r["regionId"]: r for r in results}
    nodes = {node["index"]: node for r in results for node in r.get("nodes", [])}
    parent = {i: i for i in nodes}

    def root(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    seen = set()
    for review in reviews:
        ids = review["regionIds"]
        if (len(ids) != 2 or len(set(ids)) != 2 or not set(ids) <= by_id.keys()
                or review["connection"] != "MONOLITHIC_FULL_INTERFACE"
                or not review["reference"].strip() or frozenset(ids) in seen):
            raise ValueError("Invalid or duplicate deck continuity review")
        seen.add(frozenset(ids))
        a, b = (by_id[key] for key in ids)
        interfaces = [item for region,other in ((a,b),(b,a)) for item in region.get("boundaryInterfaces", [])
                      if item["regionId"] == other["regionId"]]
        if len(interfaces) != 2 or any(i["status"] == "NONCONFORMING_INTERFACE" for i in interfaces):
            raise ValueError("Reviewed regions require a complete conforming common edge")
        def edge_map(region):
            return {frozenset(line.coords): dict(zip(line.coords,(start,end)))
                    for start,end,line in boundary_edges(region)}
        left,right = edge_map(a),edge_map(b)
        common = left.keys() & right.keys()
        geometry = unary_union(MultiLineString([tuple(edge) for edge in common]))
        if abs(geometry.length-interfaces[0]["lengthMm"]) > 1e-6:
            raise ValueError("Reviewed interface coverage differs from registered geometry")
        for edge in common:
            for point in edge:
                x,y = sorted((root(left[edge][point]),root(right[edge][point])))
                if x == y:
                    continue
                if nodes[y]["sharesFrameDofs"]:
                    raise ValueError("Review cannot merge distinct saved frame joints")
                parent[y] = x
        for interface in interfaces:
            interface.update(status="REVIEWED_MONOLITHIC_DOFS", reviewReference=review["reference"])

    private = sorted({root(i) for i in nodes if not nodes[root(i)]["sharesFrameDofs"]})
    compact = {old:first_free+j for j,old in enumerate(private)}
    def mapped(i):
        r = root(i)
        return compact.get(r,r)
    for region in results:
        if "nodes" not in region:
            continue
        region["nodes"] = [dict(nodes[root(node["index"])], index=mapped(node["index"]))
                           for node in region["nodes"]]
        for quad in region["quadConnectivity"]:
            quad["nodeIndices"] = [mapped(i) for i in quad["nodeIndices"]]
        for candidate in region["beamSubdivisionCandidates"]:
            candidate["interiorNodeIndices"] = [mapped(i) for i in candidate["interiorNodeIndices"]]
    return first_free+len(private)
def joint_registry(regions):
    """Collect a unique node/plate registry and detect conflicting beam station chains."""
    from collections import defaultdict
    candidates = defaultdict(list)
    nodes = {}
    plates = []
    for region in regions:
        if "nodes" not in region:
            continue
        for node in region["nodes"]:
            if nodes.setdefault(node["index"], node) != node:
                raise ValueError("Contradictory analytical node identity at a shared interface")
        plates.extend(dict(p, physicalRegionId=region["regionId"]) for p in region["quadConnectivity"])
        for candidate in region["beamSubdivisionCandidates"]:
            candidates[candidate["elementId"]].append(candidate)
    if len({p["id"] for p in plates}) != len(plates):
        raise ValueError("Duplicate analytical plate identity across regions")
    splits, conflicts = [], []
    for element_id, group in sorted(candidates.items()):
        chains = {(item["physicalMemberId"],tuple(item["interiorNodeIndices"])) for item in group}
        if len(chains) == 1:
            physical, chain = chains.pop()
            splits.append(dict(elementId=element_id,physicalMemberId=physical,interiorNodeIndices=list(chain)))
        else:
            conflicts.append(element_id)
    return {"distinctNodes":len(nodes),"distinctQuads":len(plates),
            "frameSubdivisionCandidates":splits,"conflictingElementIds":conflicts}

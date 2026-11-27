"""Read an exported RH Planner structural IFC4 and compare its physical products (incl. IfcStairFlight solids) to the evaluation snapshot."""

import argparse
from collections import Counter
import json
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.validate
import numpy as np
from ifcopenshell.util.element import get_psets
from ifcopenshell.util.placement import get_local_placement


def close(actual, expected, label, tolerance=0.0001):
    if not np.allclose(actual, expected, rtol=0, atol=tolerance):
        raise AssertionError(f"{label}: expected {expected}, found {actual}")


def verify(ifc_path, snapshot_path):
    model = ifcopenshell.open(str(ifc_path))
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    assert model.schema == "IFC4"
    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(model, logger)
    assert not logger.statements, [(row.get("message"), str(row.get("instance"))) for row in logger.statements[:10]]
    roots = [item.GlobalId for item in model.by_type("IfcRoot")]
    assert len(roots) == len(set(roots))
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)

    system = snapshot["system"]
    design = snapshot["rccDesign"]
    provenance = get_psets(model.by_type("IfcBuilding")[0])["Pset_RHPlannerStructuralDesign"]
    assert provenance["ArchitecturalSha256"] == system["sourceArchitecturalSha256"]
    assert provenance["ArchitecturalRevision"] == system["sourceArchitecturalRevision"]
    assert provenance["PhysicalColumnCount"] == len(design["columns"])
    assert provenance["PhysicalBeamCount"] == len(design["beams"])
    assert provenance["AnalyticalElementCount"] == len(system["elements"])

    storeys = {item.Name: item for item in model.by_type("IfcBuildingStorey")}
    for floor in system["storeys"]:
        storey = storeys[floor["name"] or floor["id"]]
        close(storey.Elevation, floor["elevationMm"], storey.Name)
        close(get_local_placement(storey.ObjectPlacement)[2, 3], floor["elevationMm"], storey.Name + " placement")

    products = {
        item.Tag: item
        for kind in ("IfcColumn", "IfcBeam", "IfcSlab", "IfcFooting", "IfcStairFlight")
        for item in model.by_type(kind)
    }
    counts = Counter()

    def vertices(product):
        shape = ifcopenshell.geom.create_shape(settings, product)
        result = np.asarray(shape.geometry.verts).reshape(-1, 3)
        assert len(result) >= 8, product.Tag
        counts[product.is_a()] += 1
        return result

    # 1. Verify Physical Columns & Physical Beams (spanning first..last child analytical element!)
    for collection in ("columns", "beams"):
        for member in design[collection]:
            identifier = member.get("physicalMemberId") or member["elementId"]
            product = products[identifier]
            assert product.is_a("IfcColumn" if collection == "columns" else "IfcBeam")
            child_indices = member.get("analyticalElementIndices") or [member["elementIndex"]]
            first_el = system["elements"][child_indices[0]]
            last_el = system["elements"][child_indices[-1]]
            start = np.asarray(system["nodes"][first_el["startNodeIndex"]]["positionM"])
            end = np.asarray(system["nodes"][last_el["endNodeIndex"]]["positionM"])
            axis = (end - start) / np.linalg.norm(end - start)
            mesh = vertices(product)
            distance = (mesh - start) @ axis
            close([float(distance.min()), float(distance.max())], [0, float(np.linalg.norm(end - start))], identifier + " span")
            close(mesh[distance < 0.0001].mean(axis=0), start, identifier + " section centroid")
            props = get_psets(product)["Pset_RHPlannerStructuralDesign"]
            close(props["WidthMm"], member["widthMm"], identifier + " width")
            close(props["DepthMm"], member["depthMm"], identifier + " depth")
            assert props["DesignStatus"] == member["status"], identifier

    # 2. Verify Physical Slabs
    panel_by_id = {panel["id"]: panel for panel in system["slabPanels"]}
    omitted_slabs = 0
    for slab in design["slabs"]:
        identifier = slab["panelId"]
        panel = panel_by_id[identifier]
        if "exchangeBoundary" not in panel or panel["exchangeBoundary"] is None:
            omitted_slabs += 1
            assert identifier not in products, identifier
            continue
        product = products[identifier]
        assert product.is_a("IfcSlab") and product.PredefinedType == "FLOOR"
        mesh = vertices(product)
        ring = np.asarray([[point["x"] / 1000, -point["y"] / 1000] for point in panel["exchangeBoundary"]])
        close(mesh[:, :2].min(axis=0), ring.min(axis=0), identifier + " plan min")
        close(mesh[:, :2].max(axis=0), ring.max(axis=0), identifier + " plan max")
        close(np.ptp(mesh[:, 2]), slab["thicknessMm"] / 1000, identifier + " thickness")
    assert provenance["OmittedSlabPanelCount"] == omitted_slabs

    # 3. Verify Stair-Waist Inclined Solids (IfcStairFlight)
    waist_by_id = {w["id"]: w for w in system["stairWaists"]}
    omitted_stairs = 0
    exported_stairs = 0
    for stair in design["stairs"]:
        identifier = stair["waistId"]
        waist = waist_by_id[identifier]
        if not waist.get("ifcSolidGeometrySupported") or "boundsMm" not in waist:
            omitted_stairs += 1
            assert identifier not in products, identifier
            continue
        product = products[identifier]
        assert product.is_a("IfcStairFlight") and product.PredefinedType == "STRAIGHT"
        mesh = vertices(product)
        assert np.ptp(mesh[:, 2]) > 1.0, identifier + " inclined rise"
        props = get_psets(product)["Pset_RHPlannerStructuralDesign"]
        close(props["WaistThicknessMm"], waist["waistThicknessMm"], identifier + " waist thickness")
        assert props["DesignStatus"] == stair["status"], identifier
        exported_stairs += 1

    assert provenance["OmittedStairWaistCount"] == omitted_stairs
    assert provenance["ExportedStairWaistCount"] == exported_stairs

    # 4. Verify Physical Foundations
    for footing in snapshot["foundationDesign"]["footings"]:
        identifier = footing["footingId"]
        product = products[identifier]
        assert product.is_a("IfcSlab" if footing["typology"] == "RIGID_RAFT" else "IfcFooting")
        mesh = vertices(product)
        close(
            np.ptp(mesh, axis=0),
            [footing["lengthXMm"] / 1000, footing["widthYMm"] / 1000, footing["thicknessMm"] / 1000],
            identifier + " extent",
        )
        close(mesh[:, 2].min(), -footing["excavationDepthM"], identifier + " bottom elevation")

    assert len(products) == sum(counts.values())
    return {
        "schema": model.schema,
        "storeys": len(storeys),
        "products": dict(counts),
        "omittedSlabs": omitted_slabs,
        "exportedStairs": exported_stairs,
        "omittedStairs": omitted_stairs,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ifc", type=Path)
    parser.add_argument("snapshot", type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.ifc, args.snapshot), indent=2))

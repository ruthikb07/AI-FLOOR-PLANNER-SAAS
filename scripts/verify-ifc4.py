"""Validate generated RH Planner IFC4 files using IfcOpenShell and canonical fixtures."""
import hashlib
import json
import math
import sys
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.validate
from ifcopenshell.util.placement import get_local_placement
from ifcopenshell.util.unit import calculate_unit_scale


def area(points):
    return abs(sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(points, points[1:] + points[:1]))) / 2


def outline(entity, name):
    shape = next(rep for rep in entity.Representation.Representations if rep.RepresentationIdentifier == name)
    return [tuple(p.Coordinates) for p in shape.Items[0].Points]


def verify(path):
    local = path.with_suffix(".building.json")
    manifest = json.loads(path.with_suffix(".manifest.json").read_text(encoding="utf8"))
    canonical = json.loads(local.read_text(encoding="utf8"))
    assert hashlib.sha256(path.read_bytes()).hexdigest() == manifest["artifactSha256"]
    assert (canonical["id"], canonical["projectId"], canonical["version"]) == tuple(
        manifest["source"][key] for key in ("buildingId", "projectId", "revision")
    )
    model = ifcopenshell.open(str(path))
    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(model, logger)
    assert not logger.statements, json.dumps(logger.statements[:12], default=str)
    assert model.schema == "IFC4"
    assert calculate_unit_scale(model) == 0.001
    roots = model.by_type("IfcRoot")
    assert len({r.GlobalId for r in roots}) == len(roots)
    floors = {f["id"]: f for f in canonical["floors"]}
    guid_map = {(x["kind"], x["floorId"], x["canonicalId"]): x["externalId"] for x in manifest["elements"]}
    max_endpoint = max_elevation = max_room_area = max_opening = max_thickness = max_cutter_center = 0.0
    counts = {}
    cutouts = arc_walls = 0
    max_curve_chord = 0.0
    geometric_samples = set()
    mesh_settings = ifcopenshell.geom.settings()
    for mapped in manifest["elements"]:
        entity = model.by_guid(mapped["externalId"])
        assert entity.is_a().upper() == mapped["ifcClass"]
        assert entity.GlobalId == mapped["externalId"]
        kind = mapped["kind"]
        counts[kind] = counts.get(kind, 0) + 1
        if kind == "site" and (canonical.get("metadata", {}).get("irregularPlotBoundary") or {}).get("sourceFormat") == "survey":
            site_points = [(p["x"], -p["y"]) for p in canonical["site"]["plotBoundary"]["points"]]
            site_outline = outline(entity, "FootPrint")
            assert len(site_outline) == len(site_points) + 1 and site_outline[0] == site_outline[-1]
            assert any(all(math.dist(actual, expected) <= 0.001 for actual, expected in zip(site_outline, order))
                       for order in (site_points, list(reversed(site_points))))
        floor_id = mapped["floorId"]
        floor = floors.get(floor_id)
        if floor is None:
            continue
        source_id = mapped["canonicalId"]
        storey = model.by_guid(guid_map[("floor", floor_id, floor_id)])
        if kind == "floor":
            z = get_local_placement(entity.ObjectPlacement)[2, 3]
            max_elevation = max(max_elevation, abs(z - floor.get("elevationMm", mapped["elevationMm"])),
                                abs(entity.Elevation - z))
            assert len(entity.Decomposes) == 1
        elif kind == "room":
            room = next(r for r in floor["rooms"] if r["id"] == source_id)
            target = area([(p["x"], -p["y"]) for p in room["boundary"]["points"]])
            max_room_area = max(max_room_area, abs(area(outline(entity, "FootPrint")) - target))
            assert entity.Decomposes[0].RelatingObject == storey
        elif kind == "wall":
            wall = next(w for w in floor["walls"] if w["id"] == source_id)
            axis = outline(entity, "Axis")
            for p, point in zip((axis[0], axis[-1]), (wall["startPoint"], wall["endPoint"])):
                max_endpoint = max(max_endpoint, math.hypot(p[0] - point["x"], p[1] + point["y"]))
            body = next(r for r in entity.Representation.Representations if r.RepresentationIdentifier == "Body").Items[0]
            polygon = [p.Coordinates for p in body.SweptArea.OuterCurve.Points]
            if wall.get("arc"):
                arc_walls += 1
                a = wall["arc"]
                assert len(polygon) > 5
                expected = (a["radiusMm"] - wall["thickness"] / 2, a["radiusMm"] + wall["thickness"] / 2)
                for point in polygon:
                    radius = math.hypot(point[0] - a["center"]["x"], point[1] + a["center"]["y"])
                    assert min(abs(radius - ideal) for ideal in expected) <= 0.001
                cx, cy = a["center"]["x"], -a["center"]["y"]
                for point, other in zip(polygon, polygon[1:]):
                    radius = math.hypot(point[0] - cx, point[1] - cy)
                    other_radius = math.hypot(other[0] - cx, other[1] - cy)
                    if abs(radius - other_radius) < 0.001:
                        midpoint_radius = math.hypot((point[0] + other[0]) / 2 - cx, (point[1] + other[1]) / 2 - cy)
                        max_curve_chord = max(max_curve_chord, radius - midpoint_radius)
            else:
                fx, fy = axis[0]
                dx, dy = axis[1][0] - fx, axis[1][1] - fy
                projections = [((p[0] - fx) * -dy + (p[1] - fy) * dx) / math.hypot(dx, dy) for p in polygon]
                max_thickness = max(max_thickness, abs(max(projections) - min(projections) - wall["thickness"]))
            assert entity.ContainedInStructure[0].RelatingStructure == storey
        elif kind in ("door", "window"):
            opening = next(item for item in floor[kind + "s"] if item["id"] == source_id)
            void = model.by_guid(mapped["openingGlobalId"])
            assert len(void.VoidsElements) == 1
            host_wall_entity = void.VoidsElements[0].RelatingBuildingElement
            assert host_wall_entity.GlobalId == guid_map[("wall", floor_id, opening["wallId"])]
            body = void.Representation.Representations[0].Items[0]
            points = [p.Coordinates for p in body.SweptArea.OuterCurve.Points][:-1]
            center = [sum(p[i] for p in points) / len(points) for i in (0, 1)]
            max_cutter_center = max(max_cutter_center, math.hypot(center[0] - opening["position"]["x"],
                                                               center[1] + opening["position"]["y"]))
            max_opening = max(max_opening, abs(body.Depth - opening["height"]))
            if entity.is_a() != "IfcOpeningElement":
                assert void.HasFillings[0].RelatedBuildingElement == entity
                max_opening = max(max_opening, abs(entity.OverallWidth - opening["width"]),
                                  abs(entity.OverallHeight - opening["height"]))
                assert entity.Representation is not None
            host_wall_spec = next(w for w in floor["walls"] if w["id"] == opening["wallId"])
            if host_wall_spec.get("arc") and "curved_void_wall" not in geometric_samples:
                curved_shape = ifcopenshell.geom.create_shape(mesh_settings, host_wall_entity)
                assert len(curved_shape.geometry.verts) >= 24 and len(curved_shape.geometry.faces) >= 24
                geometric_samples.add("curved_void_wall")
        elif kind == "slab":
            body = entity.Representation.Representations[0].Items[0]
            assert abs(body.Depth - floor["slabThicknessMm"]) <= 0.001
            if body.SweptArea.is_a("IfcArbitraryProfileDefWithVoids"):
                cutouts += len(body.SweptArea.InnerCurves)
        if kind in ("wall", "slab", "stair") and kind not in geometric_samples:
            mesh_target = entity
            if kind == "stair" and entity.Representation is None:
                assert len(entity.IsDecomposedBy) == 1
                flights = [child for child in entity.IsDecomposedBy[0].RelatedObjects if child.is_a("IfcStairFlight")]
                assert len(flights) >= 1
                mesh_target = flights[0]
            shape = ifcopenshell.geom.create_shape(mesh_settings, mesh_target)
            assert len(shape.geometry.verts) >= 12 and len(shape.geometry.faces) >= 12
            geometric_samples.add(kind)

    assert max(max_elevation, max_endpoint, max_opening, max_thickness, max_cutter_center) <= 0.001
    assert max_room_area <= 0.1
    assert max_curve_chord <= 0.5
    return dict(file=path.name, schema=model.schema, roots=len(roots), entities=sum(1 for _ in model), mapped=counts,
                omissions=len(manifest["omissions"]), holes=cutouts, curved_walls=arc_walls, max_curve_chord_mm=max_curve_chord,
                max_endpoint_mm=max_endpoint, max_elevation_mm=max_elevation, max_room_area_mm2=max_room_area,
                max_opening_mm=max_opening, max_wall_thickness_mm=max_thickness, max_cutter_center_mm=max_cutter_center,
                mesh_classes=sorted(geometric_samples))


if __name__ == "__main__":
    paths = sorted(Path(sys.argv[1]).glob("*.ifc"))
    if not paths:
        raise SystemExit("No IFC fixtures found.")
    for fixture in paths:
        print(json.dumps(verify(fixture), sort_keys=True))

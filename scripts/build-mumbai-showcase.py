"""Build the welcome-only demonstration. Run with Blender's bundled Python."""

import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
import random
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "packages/frontend/public/architecture"
ARGS = argparse.ArgumentParser()
ARGS.add_argument("--output", type=Path, default=ASSETS / "mumbai-residential.glb")
OPTIONS = ARGS.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
SPEC = json.loads((Path(__file__).with_name("mumbai-showcase.json")).read_text())
DESIGN = SPEC["illustrative"]
PITCH = SPEC["residentialPitch"]["metres"]
BALCONIES = SPEC["balconyPlanDepths"]["metres"]
RANDOM = random.Random(52781)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system = "METRIC"


def linear(channel):
    return channel / 12.92 if channel <= .04045 else ((channel + .055) / 1.055) ** 2.4


def rgb(hex_color):
    return tuple(linear(int(hex_color[i:i + 2], 16) / 255) for i in (0, 2, 4))


def create_material(name, rough, metal=0, alpha=1, emission=None):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    shader = nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = rough
    shader.inputs["Metallic"].default_value = metal
    color = nodes.new("ShaderNodeVertexColor")
    color.layer_name = "Finish"
    material.node_tree.links.new(color.outputs["Color"], shader.inputs["Base Color"])
    if alpha < 1:
        material.surface_render_method = "BLENDED"
        shader.inputs["Alpha"].default_value = alpha
    material.use_backface_culling = True
    if emission:
        shader.inputs["Emission Color"].default_value = (*rgb(emission), 1)
        shader.inputs["Emission Strength"].default_value = .08
    return material


MATERIALS = {
    "Stone": create_material("Stone", .68),
    "Mineral finish": create_material("Mineral finish", .81),
    "Bronze aluminium": create_material("Bronze aluminium", .41, .63),
    "Recessed glazing": create_material("Recessed glazing", .15, .51),
    "Curtains": create_material("Curtains", .79),
    "Occupied interiors": create_material("Occupied interiors", .57, .15, emission="f4b477"),
    "Balcony guards": create_material("Balcony guards", .24, .25, .32),
    "Water": create_material("Water", .20, .46),
    "Planting": create_material("Planting", .87),
    "Fixtures": create_material("Fixtures", .40, .09, emission="ffbc6e"),
}


class Geometry:
    """Store material and finish per face before building a mesh and its cavity bake."""

    def __init__(self):
        self.positions = []
        self.faces = []
        self.finishes = []

    def append(self, points, faces, material, color):
        start = len(self.positions)
        self.positions.extend(points)
        self.faces.extend(tuple(start + index for index in face) for face in faces)
        shade = rgb(color)
        self.finishes.extend((material, shade) for _ in faces)

    def prism(self, outline, bottom, top, material, color):
        count = len(outline)
        points = [(x, y, z) for z in (bottom, top) for x, y in outline]
        faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
        faces.extend((i, (i + 1) % count, (i + 1) % count + count, i + count)
                     for i in range(count))
        self.append(points, faces, material, color)

    def box(self, x, y, z, width, depth, height, material, color, chamfer=0):
        left, right = x - width / 2, x + width / 2
        front, back = y - depth / 2, y + depth / 2
        outline = [(left, front), (right, front), (right, back), (left, back)]
        if chamfer:
            c = min(chamfer, width * .25, depth * .25)
            outline = [(left + c, front), (right - c, front), (right, front + c),
                       (right, back - c), (right - c, back), (left + c, back),
                       (left, back - c), (left, front + c)]
        self.prism(outline, z - height / 2, z + height / 2, material, color)

    def crown(self, x, y, z, width, depth, height, material, color, sides=8):
        points = [(x, y, z - height), (x, y, z + height)]
        for elevation, scale, angle in [(-.48, .83, 0), (.27, 1, math.pi / sides)]:
            for i in range(sides):
                a = angle + i * math.tau / sides
                variation = RANDOM.uniform(.86, 1.18)
                points.append((x + math.cos(a) * width * scale * variation,
                               y + math.sin(a) * depth * scale * variation,
                               z + elevation * height * variation))
        faces = []
        for i in range(sides):
            j = (i + 1) % sides
            faces.extend([(0, 2 + j, 2 + i), (2 + i, 2 + j, 2 + sides + j),
                          (2 + i, 2 + sides + j, 2 + sides + i), (1, 2 + sides + i, 2 + sides + j)])
        self.append(points, faces, material, color)

    def occluders(self):
        return [face for face, (name, _) in zip(self.faces, self.finishes)
                if name in {"Stone", "Mineral finish", "Bronze aluminium"}]

    def object(self, name, origin, batch, floor, phase, ao=None):
        if not self.faces:
            return
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.positions, [], self.faces)
        for material in MATERIALS.values():
            mesh.materials.append(material)
        slots = {name: index for index, name in enumerate(MATERIALS)}
        for poly, (material, _) in zip(mesh.polygons, self.finishes):
            poly.material_index = slots[material]
        mesh.update()

        colors = mesh.color_attributes.new(name="Finish", type="BYTE_COLOR", domain="CORNER")
        uvs = mesh.uv_layers.new(name="Surface")
        for poly, (material, tint) in zip(mesh.polygons, self.finishes):
            n = poly.normal
            # Two short hemisphere rays per corner bake local occlusion into the vertex finish.
            side = n.cross(Vector((0, 0, 1) if abs(n.z) < .9 else (1, 0, 0))).normalized()
            rays = [(n + side * .72).normalized(), (n - side * .72).normalized()]
            base = .85 + .15 * max(0, n.z) - .11 * max(0, -n.z)
            face_center = poly.center.copy()
            for corner in poly.loop_indices:
                point = mesh.vertices[mesh.loops[corner].vertex_index].co
                shade = base
                if ao and material in {"Stone", "Mineral finish", "Bronze aluminium", "Curtains"}:
                    start = point.lerp(face_center, .13) + n * .035
                    for direction in rays:
                        _, _, _, distance = ao.ray_cast(start, direction, .83)
                        if distance is not None:
                            shade -= .155 * (1 - distance / .83)
                colors.data[corner].color = (*(channel * shade for channel in tint), 1)
                axis = point.x if abs(n.y) >= abs(n.x) else point.y
                uvs.data[corner].uv = (point.x / 2, point.y / 2) if abs(n.z) > .65 else (axis / 2, point.z / 2)

        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = origin
        obj["componentId"] = name
        obj["batch"] = batch
        obj["floorIndex"] = floor
        obj["structuralPhase"] = phase
        obj["finalTranslationGltf"] = (origin[0], origin[2], -origin[1])
        obj["dimensionStatus"] = "illustrative"


def bake_floor(parts, batch, level, origin):
    vertices, faces = [], []
    for geometry in parts.values():
        offset = len(vertices)
        vertices.extend(geometry.positions)
        faces.extend(tuple(i + offset for i in face) for face in geometry.occluders())
    ao = BVHTree.FromPolygons(vertices, faces) if faces else None
    for phase, geometry in parts.items():
        geometry.object(f"{batch}.{level:02}.{phase}", origin, batch, level, phase, ao)


STONE = "dfd6c3"
FASCIA = "eee4d4"
FRAME = "63554a"
LINE = "343d3b"
WINDOWS = ["415a5d", "547076", "607070", "48636d", "5b6c66", "566b6c"]
CURTAINS = ["d3c9b2", "a99c87", "a9ac9d", "cabda5"]


def facade(parts, width, depth, level, rear=False):
    """Build a recessed facade with local bay segments on either long face."""
    sign = 1 if rear else -1
    face = sign * depth / 2
    glass_y = face - sign * DESIGN["glazingSetback"]
    count = 4
    step = (width - 1.6) / count
    wall = parts["wall"]
    detail = parts["finish"]
    window = parts["glazing"]
    balcony = parts["balcony"]
    guard = parts["railing"]

    for index in range(count):
        x = (index - 1.5) * step
        has_balcony = (index != 2) if not rear else index in {0, 3}
        w = step - (.94 if has_balcony else 1.72)
        sill = .34 if has_balcony else .81
        head = PITCH - .46
        clear = head - sill
        wall.box(x, face - sign * .28, sill / 2, step, .58, sill,
                 "Mineral finish", "c4b5a1" if index == 2 else STONE)
        wall.box(x, face - sign * .28, (head + PITCH) / 2, step, .58, PITCH - head,
                 "Stone", FASCIA)
        for side in (-1, 1):
            column = (step - w) / 2
            wall.box(x + side * (step - column) / 2, face - sign * .14, (head + sill) / 2,
                     column, .81, clear, "Stone", STONE if index != 2 else "c3b09a")
            detail.box(x + side * w / 2, glass_y, (head + sill) / 2, .052, .076, clear,
                       "Bronze aluminium", FRAME)
        for z in (sill + .04, head - .04):
            detail.box(x, glass_y, z, w, .085, .074, "Bronze aluminium", FRAME)
        panes = 3 if has_balcony else 2
        for pane in range(panes):
            center = x - w / 2 + (pane + .5) * w / panes
            occupied = (level * 13 + index * 7 + pane * 3 + int(rear)) % 17 < 3
            window.box(center, glass_y - sign * .045, (head + sill) / 2, w / panes - .037, .028,
                       clear - .085, "Occupied interiors" if occupied else "Recessed glazing",
                       "444434" if occupied else RANDOM.choice(WINDOWS))
            if pane:
                detail.box(center - w / panes / 2, glass_y + sign * .009, (head + sill) / 2,
                           .043, .09, clear - .04, "Bronze aluminium", FRAME)
            if (level + index * 5 + pane * 7) % 11 < 3:
                window.box(center + w / panes * .22, glass_y + sign * .01, (head + sill) / 2,
                           w / panes * .38, .018, clear * .96, "Curtains", RANDOM.choice(CURTAINS))
        if not has_balcony:
            if index == 2:
                projection = DESIGN["chajjaProjection"]
                detail.box(x, face + sign * (projection / 2 - .08), head + .13, w + .44,
                           projection + .16, .16, "Stone", FASCIA, .07)
                for i in range(6):
                    detail.box(x - w / 2 + .23 + i * .18, face + sign * .06, (head + sill) / 2,
                               .045, .31, clear + .09, "Bronze aluminium", "876f54")
            continue

        extension = BALCONIES[(index + int(rear)) % 2]
        if level >= 21 and index == 0:
            extension = BALCONIES[0]
        span = w + .61
        center_y = face + sign * extension / 2
        rail_y = face + sign * (extension - .09)
        height = DESIGN["balconyGuardHeight"]
        balcony.box(x, center_y, .14, span, extension + .24, .27, "Stone", FASCIA, .18)
        balcony.box(x, center_y, .287, span - .24, extension + .04, .034, "Mineral finish", "a49379", .13)
        balcony.box(x, center_y, .006, span - .29, extension + .09, .043, "Mineral finish", "a5947c", .15)
        guard.box(x, rail_y, .31 + height, span - .24, .06, .058, "Bronze aluminium", "665b4d")
        for post in range(4):
            post_x = x + (post / 3 - .5) * (span - .30)
            guard.box(post_x, rail_y, .31 + height / 2, .045, .046, height, "Bronze aluminium", FRAME)
        for panel in range(3):
            guard.box(x + (panel - 1) * (span - .30) / 3, rail_y, .31 + height / 2,
                      (span - .30) / 3 - .035, .018, height - .12, "Balcony guards", "7c9696")
        for side in (-1, 1):
            rx = x + side * (span - .31) / 2
            guard.box(rx, center_y, .31 + height, .061, extension - .16, .058, "Bronze aluminium", FRAME)
            guard.box(rx, center_y, .31 + height / 2, .018, extension - .2, height - .14, "Balcony guards", "839a97")
        if (level + index) % 4 == 1 and not rear:
            px = x + span * .29
            detail.box(px, center_y, .49, .73, .40, .37, "Stone", "8b7862", .07)
            detail.crown(px, center_y, .80, .37, .26, .25, "Planting", "58724b", 6)
        if (level + index) % 6 == 2 and not rear:
            detail.box(x - span * .20, center_y + .24, .68, .81, .64, .15, "Mineral finish", "a2957d", .09)
            detail.box(x - span * .20, center_y + .46, .93, .8, .12, .43, "Mineral finish", "c8b898")


def flanks(parts, width, depth, level):
    starts = [-depth * .29, 0, depth * .29]
    for side in (-1, 1):
        face = side * width / 2
        parts["wall"].box(face - side * .23, 0, .47, .52, depth - .6, .94,
                          "Mineral finish", "d0c4b1")
        parts["wall"].box(face - side * .23, 0, PITCH - .24, .52, depth - .6, .48,
                          "Stone", FASCIA)
        length = depth * .245
        for sign in (-1, 1):
            corner_width = depth * (.5 - .29 - .245 / 2)
            parts["wall"].box(face - side * .35, sign * (depth / 2 - corner_width / 2),
                              PITCH / 2, .72, corner_width, PITCH, "Stone", STONE, .07)
            parts["finish"].box(face - side * .085, sign * (depth / 2 - .42), PITCH / 2,
                                .23, .065, PITCH - .08, "Bronze aluminium", "ad9981")
        for j, y in enumerate(starts):
            parts["glazing"].box(face - side * .47, y, 2.08, .035, length, 2.27,
                                 "Occupied interiors" if (j + level * 5) % 13 == 1 else "Recessed glazing",
                                 RANDOM.choice(WINDOWS))
            parts["finish"].box(face - side * .40, y, 2.08, .11, .052, 2.29,
                                "Bronze aluminium", FRAME)
            for sign in (-1, 1):
                parts["wall"].box(face - side * .14, y + sign * length / 2, 2.08, .69,
                                  .66, 2.28, "Stone", STONE)
                parts["finish"].box(face + side * .22, y + sign * length / 2, 2.08, .37,
                                    .105, 2.55, "Bronze aluminium", "8d7559")
        parts["finish"].box(face + side * .08, 0, PITCH - .18, .36, depth + .23, .17,
                            "Stone", FASCIA, .05)


def tower(t):
    base = sum(DESIGN["podium"]["levels"])
    for level in range(t["levels"]):
        scale = .92 if level >= t["levels"] - 2 else 1
        w, d = t["width"] * scale, t["depth"] * scale
        parts = defaultdict(Geometry)
        slab = DESIGN["slabThickness"]
        parts["slab"].box(0, 0, slab / 2, w + .35, d + .44, slab, "Stone", FASCIA, .28)
        parts["core"].box(0, .4, PITCH / 2, w * .31, d * .43, PITCH, "Mineral finish", "a89e8c")
        # Posts and headers sit behind the exterior finish and align through the typical stack.
        for x in (-w * .385, -w * .12, w * .12, w * .385):
            for y in (-d * .361, d * .355):
                parts["column"].box(x, y, PITCH / 2, .55, .56, PITCH, "Mineral finish", "beb3a0")
        for y in (-d * .361, d * .355):
            parts["beam"].box(0, y, PITCH - .31, w * .82, .44, .55, "Mineral finish", "c9bdab")
        facade(parts, w, d, level)
        facade(parts, w, d, level, rear=True)
        flanks(parts, w, d, level)
        bake_floor(parts, t["id"], level, (t["x"], t["y"], base + level * PITCH))

    roof = Geometry()
    w, d = t["width"] * .92, t["depth"] * .92
    roof.box(0, 0, .09, w + .78, d + .78, .44, "Stone", FASCIA, .36)
    roof.box(-1.75, .5, 1.33, w * .34, d * .44, 2.48, "Mineral finish", "b3a694", .12)
    roof.box(-1.75, .5, 2.62, w * .34 + .35, d * .44 + .3, .24, "Stone", STONE, .12)
    roof.box(w * .22, 2, .81, 2.8, 3.2, 1.36, "Mineral finish", "a29c90", .16)
    parapet = DESIGN["roofParapetHeight"]
    for sign in (-1, 1):
        roof.box(0, sign * (d / 2 + .14), parapet / 2, w + .35, .20, parapet, "Stone", STONE)
        roof.box(sign * (w / 2 + .14), 0, parapet / 2, .20, d + .35, parapet, "Stone", STONE)
        for i in range(10):
            roof.box(-w * .17 + i * w * .038, sign * (d * .22 + .61), 1.52, .085, .14, 1.5,
                     "Bronze aluminium", "917d66")
    roof.object(f"{t['id']}.roof", (t["x"], t["y"], base + t["levels"] * PITCH),
                t["id"], t["levels"], "roof")


def tree(geometry, x, y, z, size, palm=False):
    geometry.box(x, y, z + size * .39, size * .05, size * .05, size * .78,
                 "Mineral finish", "62554b")
    if palm:
        # Drooping, folded fronds catch distinct highlights above the entry.
        for i in range(9):
            a = i * math.tau / 9 + RANDOM.uniform(-.14, .14)
            dx, dy = math.cos(a), math.sin(a)
            p = Vector((x, y, z + size * .78))
            tip = p + Vector((dx * size * .43, dy * size * .43, -size * .11))
            mid = p + Vector((dx * size * .24, dy * size * .24, size * .072))
            wing = Vector((-dy, dx, 0)) * size * .085
            geometry.append([p, mid - wing, tip, mid + wing, mid],
                            [(0, 1, 4), (4, 1, 2), (0, 4, 3), (4, 2, 3),
                             (4, 1, 0), (2, 1, 4), (3, 4, 0), (3, 2, 4)],
                            "Planting", RANDOM.choice(["47694a", "57754c", "668754"]))
    else:
        for i in range(7):
            a = i * math.tau / 7
            offset = size * (.18 if i else .03)
            geometry.crown(x + math.cos(a) * offset, y + math.sin(a) * offset,
                           z + size * (.77 + RANDOM.uniform(-.12, .13)), size * .22,
                           size * .21, size * .255, "Planting",
                           RANDOM.choice(["3c5640", "52664a", "526f42", "728457"]), 7)


def site():
    podium = DESIGN["podium"]
    width, depth = podium["width"], podium["depth"]
    base = sum(podium["levels"])
    front = -depth / 2 + 3
    levels = Geometry()
    paving = Geometry()
    gardens = Geometry()
    glass = Geometry()
    fixtures = Geometry()
    foundations = Geometry()
    foundations.box(0, 2, -.62, width, depth, 1.24, "Mineral finish", "837568")
    foundations.object("site.foundation", (0, 0, 0), "site", -1, "foundation")
    for level, height in enumerate(podium["levels"]):
        bottom = sum(podium["levels"][:level])
        for x in (-width * .375, width * .375):
            levels.box(x, 2, bottom + height / 2, width * .25, depth - .4, height,
                       "Mineral finish", "8f8374", .5)
        levels.box(0, 8.2, bottom + height / 2, width * .50, depth - 13, height,
                   "Mineral finish", "908473", .4)
        levels.box(0, 2, bottom + height - .17, width + 1.1, depth + .9, .38, "Stone", STONE, 1.05)
        for i in range(27):
            x = (i - 13) * 3.3
            levels.box(x, front, bottom + height / 2, .43, .85, height, "Stone", "c3b7a3", .055)
            if level == 1 or abs(x) > 10:
                for fin in range(8):
                    glass.box(x + .27 + fin * .34, front + .04, bottom + height * .55, .055,
                              .25, height * .65, "Bronze aluminium", "94816a")
    for x in (-7.4, 7.4):
        levels.box(x, front - 3.1, base * .38, .55, .7, base * .76, "Stone", STONE, .09)
    levels.box(0, front - 2.7, base * .77, 16.5, 6.5, .44, "Stone", FASCIA, .26)
    levels.box(0, front - 2.7, base * .74, 16.1, 6.25, .14, "Bronze aluminium", "776555", .25)
    for i in range(11):
        x = (i - 5) * 1.12
        glass.box(x, front + .7, 2.7, 1.01, .05, 5.1,
                  "Occupied interiors" if i % 4 else "Recessed glazing", "55625a")
        glass.box(x - .54, front + .66, 2.7, .06, .12, 5.1, "Bronze aluminium", FRAME)
    for x in (-5.8, -2.9, 0, 2.9, 5.8):
        fixtures.box(x, front - 3.55, base * .73, .24, .24, .05, "Fixtures", "fff1c6")
    for x in (-40, -21, 21, 40):
        fixtures.box(x, front - .48, 2.45, .16, .18, .45, "Fixtures", "fff0c4")

    # Keep the vertical offsets in node transforms so Meshopt's shared exponent
    # cannot round wide, nearly coplanar surfaces to the same elevation.
    ground = Geometry()
    ground.box(0, 10, -.12, 1200, 1200, .24, "Mineral finish", "808276")
    ground.object("site.ground", (0, 0, -.17), "site", -1, "landscape")
    road = Geometry()
    road.box(0, -46.7, -.07, 250, 12.5, .14, "Mineral finish", "454b49")
    road.object("site.road.main", (0, 0, .014), "site", -1, "landscape")
    side_roads = Geometry()
    side_roads.box(53.6, -2, -.07, 11.5, 100, .14, "Mineral finish", "4b5150")
    side_roads.box(-53.8, -1, -.07, 11.0, 100, .14, "Mineral finish", "4b5150")
    side_roads.object("site.road.sides", (0, 0, -.018), "site", -1, "landscape")
    paving.box(0, 0, -.06, width + 2, depth + 5.5, .24, "Stone", "c5b9a5", .65)
    paving.box(0, -38.5, .024, 186, 3.7, .17, "Stone", "b2a58e")
    paving.box(0, -54.4, .028, 187, 2.9, .18, "Stone", "b2a58e")
    for i in range(-23, 24):
        paving.box(i * 4.4, -46.8, .032, 1.65, .127, .015, "Mineral finish", "d3c9ac")
    for x in (-30, 34):
        for i in range(9):
            paving.box(x + i * .48, -46.8, .033, .245, 7.3, .016, "Mineral finish", "d3c9ac")
    for i in range(-13, 14):
        for row in range(4):
            paving.box(i * 3.3, -30.4 - row * 1.55, .059, 3.27, 1.52, .055,
                       "Stone", RANDOM.choice(["beb19c", "c5b9a5", "c0b19b", "b5a790"]))
    for x in (-36, -25, 23, 37):
        gardens.box(x, -35, .24, 8.4, 2.5, .43, "Stone", "a79b86", .25)
        gardens.box(x, -35, .47, 8.1, 2.19, .21, "Planting", "576448", .22)
        for i in range(2):
            tree(gardens, x + (i - .5) * 3, -35.1, .54, RANDOM.uniform(5.1, 7.1), True)
    for i in range(14):
        x = -52 + i * 8.0
        y = -57.5 + RANDOM.uniform(-.65, .65)
        gardens.box(x, y, .025, 3, 3, .24, "Stone", "ae9e85", .24)
        tree(gardens, x, y, .12, RANDOM.uniform(3.35, 5.17), i % 4 == 0)
    for i in range(7):
        x = (i - 3) * 11.25
        if abs(x) > 10:
            gardens.box(x, -32.1, .61, 5.3, 1.22, .75, "Planting", "556847", .2)
    for x in (-39, -15, 36):
        gardens.box(x, -13.5, base + .18, 8.4, 16, .37, "Stone", "b4a68e", .35)
        gardens.box(x, -13.5, base + .39, 7.8, 15.4, .16, "Planting", "657352", .3)
        for i in range(4):
            tree(gardens, x + RANDOM.uniform(-2.8, 2.8), -19.5 + i * 3.8, base + .48,
                 RANDOM.uniform(2.7, 4.9), i % 3 == 0)
    for i in range(23):
        x = -46 + i * 4.1
        tree(gardens, x, 30 + RANDOM.uniform(-1.5, 1.5), .03, RANDOM.uniform(3.7, 7.9))
    for side in (-1, 1):
        for i in range(9):
            tree(gardens, side * 46.35, -28 + i * 6.5, .015, RANDOM.uniform(3.9, 6.1), i % 4 == 0)
    for x in (-41, -14, 15, 41):
        levels.box(x, -39.6, 2.62, .10, .10, 5.2, "Bronze aluminium", "4e5350")
        levels.box(x, -40.14, 5.12, .15, 1.1, .10, "Bronze aluminium", "4e5350")
        fixtures.box(x, -40.60, 5.05, .25, .40, .092, "Fixtures", "f0dbc3")
    pool_x, pool_y = 1, -17.2
    levels.box(pool_x, pool_y, base + .10, 16.6, 6.4, .24, "Stone", "c4b69e", .34)
    levels.box(pool_x, pool_y, base + .234, 15.7, 5.65, .017, "Water", "367d85", .26)
    for i in range(12):
        levels.box(pool_x - 7.52 + i * 1.36, pool_y, base + .246, .028, 5.10, .009, "Water", "649ca1")
    for x, y, tint in [(-12, -45, "afa89d"), (22, -49, "565e66"), (51, -15, "74685f"),
                       (6, -30.4, "2c4c55"), (-29, -50, "c2b4a2")]:
        is_side = x > 48
        w, d = (1.81, 4.37) if is_side else (4.37, 1.81)
        levels.box(x, y, .48, w, d, .67, "Mineral finish", tint, .29)
        glass.box(x - .11, y, .98, w * (.81 if is_side else .58), d * (.58 if is_side else .81),
                  .51, "Recessed glazing", "4a5756", .26)
        for sx in (-1, 1):
            for sy in (-1, 1):
                levels.box(x + sx * w * .33, y + sy * d * .42, .31, w * .14, d * .21,
                           .46, "Mineral finish", "353833", .075)
        for sign in (-1, 1):
            fixtures.box(x + sign * (w / 2 - .19), y - sign * (d / 2 - .28), .53,
                         .17, .14, .15, "Fixtures", "efe0b5")
    for phase, geometry in {"podium": levels, "landscape": paving, "planting": gardens,
                            "glazing": glass, "fixtures": fixtures}.items():
        geometry.object(f"site.{phase}", (0, 0, 0), "site", -1, phase)


def context():
    for index, (x, y, w, d, levels) in enumerate(DESIGN["neighbours"]):
        geometry = Geometry()
        pitch = 2.96
        color = ["b0a392", "a09584", "9aa19c", "a7a298"][index % 4]
        height = levels * pitch
        geometry.box(0, 0, height / 2, w, d, height, "Mineral finish", color, .15)
        geometry.box(0, 0, height + .22, w + .35, d + .30, .38, "Stone", "aea89a", .14)
        geometry.box(-w * .22, 0, height + .81, w * .36, d * .44, 1.45, "Mineral finish", color)
        for level in range(levels):
            z = (level + .58) * pitch
            for side in (-1, 1):
                if (index + level) % 3:
                    geometry.box(0, side * (d / 2 + .10), z - .98, w + .22, .32, .19,
                                 "Stone", "b5ab9d")
                for bay in range(5):
                    geometry.box((bay - 2) * w / 5.25, side * (d / 2 + .026), z,
                                 w * .126, .052, 1.54, "Recessed glazing", RANDOM.choice(WINDOWS))
                for bay in range(4):
                    geometry.box(side * (w / 2 + .027), (bay - 1.5) * d / 4.25, z,
                                 .052, d * .163, 1.47, "Recessed glazing", RANDOM.choice(WINDOWS))
        geometry.object(f"context.{index:02}", (x, y, 0), "context", -1, "surroundings")

    # Lower-detail city blocks keep the horizon and the long street from ending at the podium.
    distant = Geometry()
    for row in range(3):
        for column in range(13):
            x = (column - 6) * 21 + RANDOM.uniform(-4, 4)
            y = 77 + row * 23 + RANDOM.uniform(-5, 5)
            w, d = RANDOM.uniform(9, 18), RANDOM.uniform(10, 18)
            height = RANDOM.uniform(7, 23) + (7 if column % 4 == 1 else 0)
            color = RANDOM.choice(["a4a29a", "a99b8c", "9fa6a3", "b3a89a", "8f9795"])
            distant.box(x, y, height / 2, w, d, height, "Mineral finish", color)
            distant.box(x, y, height + .14, w + .32, d + .3, .28, "Stone", "b8b4aa")
            distant.box(x - w * .1, y, height + .8, w * .53, d * .63, 1.44, "Mineral finish", color)
            for level in range(1, int(height / 3.2)):
                z = level * 3.2
                for bay in range(4):
                    distant.box(x + (bay - 1.5) * w * .21, y - d / 2 - .022, z,
                                w * .12, .052, 1.13, "Recessed glazing", "56666a")
    distant.object("context.skyline", (0, 0, 0), "context", -1, "surroundings")


for building in DESIGN["towers"]:
    tower(building)
site()
context()

OPTIONS.output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(OPTIONS.output.resolve()),
    export_format="GLB",
    export_extras=True,
    export_animations=False,
    export_vertex_color="NAME",
    export_vertex_color_name="Finish",
    export_all_vertex_colors=False,
    export_meshopt_compression_enable=True,
    export_meshopt_extension="EXT_meshopt_compression",
)
print(f"Generated {OPTIONS.output} ({OPTIONS.output.stat().st_size:,} bytes)")

import type { BuildingScene } from "../building-scene-projector";
import { MEP_MATERIALS } from '@ai-floor-planner/core';

/** No executable input interpolation: canonical scene and paths are JSON string literals. */
export function generateBlenderScript(
  scene: BuildingScene,
  outputDirectory: string,
): string {
  return (
    "SCENE_JSON = " +
    JSON.stringify(JSON.stringify(scene)) +
    "\nOUTPUT_DIRECTORY = " +
    JSON.stringify(outputDirectory) +
    "\n" +
    "MEP_MATERIAL_JSON = "+JSON.stringify(JSON.stringify(MEP_MATERIALS))+"\n"+
    BLENDER_PROGRAM
  );
}

const BLENDER_PROGRAM = String.raw`
import bpy
import bmesh
import json
import math
import os
from mathutils import Vector

data = json.loads(SCENE_JSON)
os.makedirs(OUTPUT_DIRECTORY, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.length_unit = 'MILLIMETERS'
scene.unit_settings.scale_length = 0.001
for engine in ('CYCLES', 'BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
    try:
        scene.render.engine = engine
        break
    except (TypeError, ValueError, RuntimeError):
        continue
else:
    raise RuntimeError('No supported Cycles/EEVEE render engine')
if scene.render.engine == 'CYCLES':
    scene.cycles.samples = 32
scene.render.resolution_x = 1600
scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
scene.world.use_nodes = True
world_nodes = scene.world.node_tree.nodes
sky = world_nodes.new('ShaderNodeTexSky')
sky_types = {item.identifier for item in sky.bl_rna.properties['sky_type'].enum_items}
sky.sky_type = 'MULTIPLE_SCATTERING' if 'MULTIPLE_SCATTERING' in sky_types else 'NISHITA'
sky.sun_elevation = math.radians(38)
scene.world.node_tree.links.new(sky.outputs['Color'], world_nodes.get('Background').inputs['Color'])
world_nodes.get('Background').inputs['Strength'].default_value = 0.25
sun_data = bpy.data.lights.new('Architectural Sun', 'SUN')
sun_data.energy = 3.0
sun_data.angle = math.radians(3)
sun = bpy.data.objects.new('Architectural Sun', sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(25), math.radians(-30), math.radians(-25))

def material(name, color, roughness=0.7, metallic=0.0, transmission=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1.0)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Transmission Weight'].default_value = transmission
    p.inputs['IOR'].default_value = 1.52
    return mat

materials = {
    'MAT_Wall_Exterior': material('MAT_Wall_Exterior', (0.83, 0.76, 0.66), 0.82),
    'MAT_Wall_Interior': material('MAT_Wall_Interior', (0.88, 0.87, 0.82), 0.85),
    'MAT_Concrete_Structural': material('MAT_Concrete_Structural', (0.38, 0.39, 0.40), 0.9),
    'MAT_Glass_Aperture': material('MAT_Glass_Aperture', (0.90, 0.96, 1.0), 0.05, transmission=1.0),
    'MAT_Metal_Railing': material('MAT_Metal_Railing', (0.055, 0.065, 0.075), 0.26, metallic=0.82),
    'MAT_Floor_Tile': material('MAT_Floor_Tile', (0.72, 0.68, 0.59), 0.38),
    'MAT_Floor_Wet': material('MAT_Floor_Wet', (0.36, 0.47, 0.49), 0.52),
    'MAT_Door': material('MAT_Door', (0.22, 0.105, 0.045), 0.6),
}
def srgb_to_linear(value):
    return value/12.92 if value<=0.04045 else ((value+0.055)/1.055)**2.4
for name, spec in json.loads(MEP_MATERIAL_JSON).items():
    color = tuple(srgb_to_linear(int(spec['color'][i:i+2],16)/255.0) for i in (1,3,5))
    materials[name] = material(name, color, spec['roughness'], spec['metalness'])
# Real packed image textures survive glTF export; unsupported procedural-only nodes do not.
for key in ('MAT_Wall_Exterior', 'MAT_Concrete_Structural', 'MAT_Floor_Tile', 'MAT_Floor_Wet'):
    mat = materials[key]
    p = mat.node_tree.nodes.get('Principled BSDF')
    color = tuple(p.inputs['Base Color'].default_value)[:3]
    image = bpy.data.images.new(key + '_Albedo', width=64, height=64, alpha=True)
    pixels = []
    for y in range(64):
        for x in range(64):
            grout = key.startswith('MAT_Floor') and (x < 2 or y < 2)
            grain = 0.96 + 0.08 * (((x*17+y*31) % 97)/96.0)
            pixels.extend([v * (0.55 if grout else grain) for v in color] + [1.0])
    image.pixels.foreach_set(pixels)
    image.pack()
    texture = mat.node_tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    mat.node_tree.links.new(texture.outputs['Color'], p.inputs['Base Color'])

root = bpy.data.objects.new('Canonical Building (mm)', None)
root['buildingId'] = data['buildingId']
root['canonicalRevision'] = data['canonicalRevision']
scene.collection.objects.link(root)
floor_objects = {f['id']: [] for f in data['floors']}
collections = {}
for f in data['floors']:
    collection = bpy.data.collections.new(f['name'])
    scene.collection.children.link(collection)
    collections[f['id']] = collection

def mesh_object(name, geometry, collection):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(geometry['vertices'], [], geometry['faces'])
    mesh.validate(verbose=False)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.0001)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj

boolean_count = 0
max_boolean_relative_volume_error = 0.0
for node in data['meshes']:
    obj = mesh_object(node['id'], node.get('boolean', {}).get('base', node['geometry']), collections[node['floorId']])
    obj.parent = root
    for key in ('sourceEntityId', 'floorId', 'buildingId', 'canonicalRevision', 'kind', 'provenance'):
        obj[key] = node[key]
    obj.data.materials.append(materials[node['material']])
    bpy.context.view_layer.objects.active = obj
    for index, cutter_data in enumerate(node.get('boolean', {}).get('cutters', [])):
        cutter = mesh_object('temporary_cut', cutter_data, scene.collection)
        modifier = obj.modifiers.new('Canonical opening or vertical void', 'BOOLEAN')
        modifier.operation = 'DIFFERENCE'
        modifier.solver = 'EXACT'
        modifier.object = cutter
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
        boolean_count += 1
    if node.get('boolean'):
        # Verify actual Blender Boolean output against the independently tessellated derived mesh.
        vertices = node['geometry']['vertices']
        origin = vertices[0]
        terms = []
        for face in node['geometry']['faces']:
            a, b, c = ([vertices[i][j]-origin[j] for j in range(3)] for i in face)
            terms.append((a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6.0)
        expected = abs(math.fsum(terms))
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        actual = abs(bm.calc_volume(signed=True))
        manifold = all(e.is_manifold for e in bm.edges)
        bm.free()
        error = abs(actual-expected)/max(expected,1.0)
        max_boolean_relative_volume_error = max(error,max_boolean_relative_volume_error)
        if not manifold or error > 0.00002:
            raise RuntimeError('Boolean mesh validation failed: '+node['id']+' relative error '+str(error))
    # World-aligned box UVs in mm: one tile per 600 mm, wet tiles per 300 mm.
    uv = obj.data.uv_layers.new(name='Canonical_mm_UV')
    tile = 300 if node['material'] == 'MAT_Floor_Wet' else 600
    for poly in obj.data.polygons:
        axis = max(range(3), key=lambda a: abs(poly.normal[a]))
        axes = [a for a in range(3) if a != axis]
        for li in poly.loop_indices:
            co = obj.data.vertices[obj.data.loops[li].vertex_index].co
            uv.data[li].uv = (co[axes[0]]/tile, co[axes[1]]/tile)
    floor_objects[node['floorId']].append(obj)

points = [Vector(v) for node in data['meshes'] for v in node['geometry']['vertices']]
lo = Vector(tuple(min(p[a] for p in points) for a in range(3)))
hi = Vector(tuple(max(p[a] for p in points) for a in range(3)))
center = (lo+hi)/2
size = max(hi-lo)
bpy.ops.mesh.primitive_plane_add(size=size*5, location=(center.x,center.y,lo.z-20))
ground = bpy.context.object
ground.name = 'Presentation Ground'
ground['sourceEntityId'] = data['buildingId']
ground['buildingId'] = data['buildingId']
ground['canonicalRevision'] = data['canonicalRevision']
ground['provenance'] = 'DERIVED_PRESENTATION'
ground.data.materials.append(material('MAT_Ground', (0.19, 0.22, 0.18), 0.95))

def camera(name, orthographic):
    cam_data = bpy.data.cameras.new(name)
    cam = bpy.data.objects.new(name, cam_data)
    scene.collection.objects.link(cam)
    # Equal XYZ offsets give exactly atan(1/sqrt(2)) = 35.26438968 degrees elevation, 45 degrees yaw.
    cam.location = center + Vector((size, -size, size if orthographic else size*0.65))
    cam.rotation_euler = (center-cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam_data.clip_start = 10
    cam_data.clip_end = size*30
    if orthographic:
        cam_data.type = 'ORTHO'
        cam_data.ortho_scale = size*1.7
    else:
        cam_data.lens = 35
    return cam

camera('True Isometric 35.264deg 45deg', True)
scene.camera = camera('Architectural Perspective', False)
scene['canonicalRevision'] = data['canonicalRevision']
scene['engineeringStatus'] = 'PROFESSIONAL REVIEW REQUIRED; structural adequacy NOT_VERIFIED'
scene['statutoryDisclaimer'] = 'Automated checks provide engineering design assistance and require verification by a licensed Architect/Engineer before municipal submission.'
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUTPUT_DIRECTORY, 'building_full_assembly.blend'), compress=False)

def export_glb(filename, objects):
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for obj in objects:
        obj.select_set(True)
    # glTF's unit is meters. The Blender exporter ignores unit_settings.scale_length.
    # Apply one explicit parent transform, retaining unscaled mm geometry in the native .blend.
    root.scale = (0.001, 0.001, 0.001)
    bpy.context.view_layer.update()
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUTPUT_DIRECTORY, filename), export_format='GLB',
        use_selection=True, export_apply=True, export_extras=True, export_materials='EXPORT',
        export_animations=False, export_yup=True)
    root.scale = (1, 1, 1)
    bpy.context.view_layer.update()

export_glb('building_full_assembly.glb', [o for values in floor_objects.values() for o in values])
for f in data['floors']:
    export_glb(f['fileName'], floor_objects[f['id']])
receipt = {
    'buildingId': data['buildingId'], 'canonicalRevision': data['canonicalRevision'],
    'blenderVersion': bpy.app.version_string, 'engine': scene.render.engine,
    'units': 'mm', 'glbUnits': 'm', 'objectCount': sum(map(len, floor_objects.values())),
    'booleanCount': boolean_count, 'boundsMm': [list(lo),list(hi)],
    'maxBooleanRelativeVolumeError': max_boolean_relative_volume_error,
    'materials': list(materials), 'floors': data['floors'],
}
with open(os.path.join(OUTPUT_DIRECTORY, 'blender-receipt.json'), 'w', encoding='utf-8') as f:
    json.dump(receipt, f, indent=2)
print('ARGON_BLENDER_COMPLETE ' + json.dumps(receipt), flush=True)
`;

import bpy
from mathutils import Vector
import json

print("=== BLENDER 5.2 PYTHON INSPECTION ===")
print(f"Blender Version: {bpy.app.version_string}")
print(f"File Path: {bpy.data.filepath}")

collections = [c.name for c in bpy.data.collections]
print(f"Collections count: {len(collections)}")
print(f"Collections: {collections}")

objects = bpy.data.objects
print(f"Total objects count: {len(objects)}")

# Group by floor / category
floors_found = set()
mesh_types = {}
materials = set()

for obj in objects:
    name = obj.name
    obj_type = obj.type
    mesh_types[obj_type] = mesh_types.get(obj_type, 0) + 1
    
    for coll in obj.users_collection:
        floors_found.add(coll.name)
            
    for slot in obj.material_slots:
        if slot.material:
            materials.add(slot.material.name)

print(f"\nObject Types: {mesh_types}")
print(f"Floor Collections in Scene ({len(floors_found)}): {sorted(list(floors_found))}")
print(f"Materials ({len(materials)}): {sorted(list(materials))}")

# Check bounding box of full scene
min_coords = [float('inf')] * 3
max_coords = [float('-inf')] * 3

for obj in objects:
    if obj.type == 'MESH':
        for corner in obj.bound_box:
            world_corner = obj.matrix_world @ Vector(corner)
            for i in range(3):
                min_coords[i] = min(min_coords[i], world_corner[i])
                max_coords[i] = max(max_coords[i], world_corner[i])

width_x = max_coords[0] - min_coords[0] if min_coords[0] != float('inf') else 0
depth_y = max_coords[1] - min_coords[1] if min_coords[1] != float('inf') else 0
height_z = max_coords[2] - min_coords[2] if min_coords[2] != float('inf') else 0

print(f"\nScene Dimensions (Meters):")
print(f"  Width (X): {width_x:.3f} m")
print(f"  Depth (Y): {depth_y:.3f} m")
print(f"  Height (Z): {height_z:.3f} m")

# Inspect openings
doors = [o.name for o in objects if "door" in o.name.lower()]
windows = [o.name for o in objects if "window" in o.name.lower()]
walls = [o.name for o in objects if "wall" in o.name.lower()]
columns = [o.name for o in objects if "column" in o.name.lower()]
stairs = [o.name for o in objects if "stair" in o.name.lower()]
slabs = [o.name for o in objects if "slab" in o.name.lower()]

print(f"\nStructural & Architectural Elements:")
print(f"  Walls: {len(walls)}")
print(f"  Columns: {len(columns)}")
print(f"  Floor Slabs: {len(slabs)}")
print(f"  Doors / Openings: {len(doors)}")
print(f"  Windows: {len(windows)}")
print(f"  Stairs / Steps: {len(stairs)}")

result = {
    "blender_version": bpy.app.version_string,
    "total_objects": len(objects),
    "collections": collections,
    "floors_count": len([c for c in collections if c != 'Collection']),
    "dimensions_m": { "width": width_x, "depth": depth_y, "height": height_z },
    "elements": {
        "walls": len(walls),
        "columns": len(columns),
        "slabs": len(slabs),
        "doors": len(doors),
        "windows": len(windows),
        "stairs": len(stairs)
    },
    "materials": sorted(list(materials))
}

with open("C:/Users/ruthi/OneDrive/Desktop/AI BUILDING SAAS - Copy/AI BUILDING SAAS - Copy/output/blender-inspection-result.json", "w") as f:
    json.dump(result, f, indent=2)

print("\nInspection successfully written to output/blender-inspection-result.json")

import type { Building, Polygon } from '@ai-floor-planner/core';
import { DoorType } from '@ai-floor-planner/core';
import type { Building3DProjection } from '@ai-floor-planner/projection-3d';
import { computeStairSolids } from '@ai-floor-planner/geometry-engine';
import { stairModelIssues } from '@ai-floor-planner/planning-engine';
import { ExtrudeGeometry } from 'three';
import { makeProjectionShape } from '../components/model-3d/projection-shape';

/** Current canonical project only. Derived triangles are transport, never model state. */
export function createBlenderExport(building: Building, projection: Building3DProjection): { filename: string; content: string } {
  if (projection.buildingId !== building.id || projection.buildingVersion !== building.version) throw new Error('Stale 3D projection. Refresh the model before export.');
  const issues = stairModelIssues(building);
  if (issues.length) throw new Error(`Resolve stair geometry/access before Blender export: ${issues.join(' ')}`);
  const meshes: { name: string; vertices: number[][]; faces: number[][]; color: number[] }[] = [];
  const solid = (name: string, boundary: Polygon, cutouts: readonly Polygon[], bottom: number, height: number, color: number[]) => {
    const geometry = new ExtrudeGeometry(makeProjectionShape(boundary, cutouts), { depth: height / 1000, bevelEnabled: false });
    const positions = geometry.getAttribute('position');
    const vertices = Array.from({ length: positions.count }, (_, i) => [positions.getX(i), -positions.getY(i), positions.getZ(i) + bottom / 1000]);
    const indices = geometry.index ? Array.from(geometry.index.array) : vertices.map((_, i) => i);
    const faces = Array.from({ length: indices.length / 3 }, (_, i) => [indices[i * 3]!, indices[i * 3 + 2]!, indices[i * 3 + 1]!]);
    meshes.push({ name, vertices, faces, color });
    geometry.dispose();
  };
  projection.floorPlates.forEach(plate => solid(`Floor_${plate.floorId}`, plate.boundary, plate.cutouts, plate.elevation, plate.thickness, [0.73, 0.73, 0.69, 1]));
  const boxes: { name: string; center: number[]; dimensions: number[]; angle: number; color: number[] }[] = [];
  projection.walls.forEach(wall => {
    const dx = wall.endPoint.x - wall.startPoint.x, dy = wall.endPoint.y - wall.startPoint.y;
    if (wall.length <= 0) return;
    const angle = Math.atan2(dy, dx);
    const box = (name: string, start: number, width: number, bottom: number, height: number, thickness: number, color: number[]) => {
      const center = start + width / 2;
      boxes.push({ name, center: [(wall.startPoint.x + dx / wall.length * center) / 1000, (wall.startPoint.y + dy / wall.length * center) / 1000, (wall.elevation + bottom + height / 2) / 1000],
        dimensions: [width / 1000, thickness / 1000, height / 1000], angle, color });
    };
    wall.solidSegments.forEach((segment, i) => box(`Wall_${wall.sourceEntityId}_${i}`, segment.alongStart, segment.alongEnd - segment.alongStart, segment.bottom, segment.top - segment.bottom, wall.thickness, [0.72, 0.69, 0.6, 1]));
    projection.openings.filter(opening => opening.hostWallId === wall.sourceEntityId && opening.doorType !== DoorType.OpenPassage)
      .forEach(opening => box(`${opening.sourceEntityType}_${opening.sourceEntityId}`, opening.alongWall, opening.width, opening.bottom, opening.height, 30,
        opening.sourceEntityType === 'window' ? [0.22, 0.55, 0.65, 0.6] : [0.35, 0.2, 0.1, 1]));
  });
  projection.stairs.forEach(stair => {
    const result = computeStairSolids(stair.canonicalStair, stair.verticalExtent);
    if (result.issues.length) throw new Error(result.issues.join(' '));
    result.solids.forEach((part, i) => solid(`Stair_${stair.sourceEntityId}_${part.kind}_${i}`, part.boundary, [], stair.elevation + part.bottom, part.top - part.bottom, [0.65, 0.57, 0.43, 1]));
  });
  const payload = { buildingId: building.id, buildingVersion: building.version, status: 'ARCHITECTURAL MODEL — NOT RCC DESIGN OR CONSTRUCTION APPROVAL', meshes, boxes };
  // Double JSON encoding keeps user-controlled names out of executable Python.
  const encoded = JSON.stringify(JSON.stringify(payload));
  return { filename: `building-${building.id.replace(/[^a-zA-Z0-9_-]/g, '_')}-v${building.version}.py`, content: `# Exported from the current AI Floor Planner project. Clears the active Blender scene.
# Run: blender --background --python-exit-code 1 --python THIS_FILE.py
import bpy
import json
from pathlib import Path
from mathutils import Vector

DATA = json.loads(${encoded})
output = Path(__file__).resolve().with_suffix('.blend')
if output.exists():
    raise RuntimeError('Output already exists. Rename this script or move the existing .blend before running again.')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0
scene['building_id'] = DATA['buildingId']
scene['building_version'] = DATA['buildingVersion']
scene['review_status'] = DATA['status']

def material(obj, color):
    mat = bpy.data.materials.new(obj.name + '_material')
    mat.diffuse_color = color
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = color
    shader.inputs['Roughness'].default_value = 0.65
    obj.data.materials.append(mat)

for item in DATA['meshes']:
    mesh = bpy.data.meshes.new(item['name'])
    mesh.from_pydata(item['vertices'], [], item['faces'])
    mesh.update()
    obj = bpy.data.objects.new(item['name'], mesh)
    scene.collection.objects.link(obj)
    material(obj, item['color'])
for item in DATA['boxes']:
    bpy.ops.mesh.primitive_cube_add(size=1, location=item['center'])
    obj = bpy.context.object
    obj.name = item['name']
    obj.dimensions = item['dimensions']
    obj.rotation_euler.z = item['angle']
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    material(obj, item['color'])
bounds = [obj.matrix_world @ Vector(corner) for obj in scene.objects if obj.type == 'MESH' for corner in obj.bound_box]
if not bounds:
    raise RuntimeError('No building geometry to export.')
low = Vector(tuple(min(point[i] for point in bounds) for i in range(3)))
high = Vector(tuple(max(point[i] for point in bounds) for i in range(3)))
center = (low + high) / 2
span = max((high - low).length, 5.0)
bpy.ops.object.camera_add(location=center + Vector((1, -1.2, 1.1)).normalized() * span * 1.8)
camera = bpy.context.object
camera.name = 'Architectural_Review_Camera'
camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = span * 1.2
camera.data.clip_end = span * 20
scene.camera = camera
bpy.ops.object.light_add(type='SUN', location=center + Vector((0, 0, span)))
bpy.context.object.rotation_euler = (0.45, -0.45, -0.5)
bpy.context.object.data.energy = 2.5
scene.world = scene.world or bpy.data.worlds.new('Architectural World')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.62, 0.72, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.render.resolution_x = 1400
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(output.with_suffix('.png'))
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_distance = span * 1.5
            area.spaces.active.region_3d.view_location = center
            area.spaces.active.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
bpy.ops.wm.save_as_mainfile(filepath=str(output))
print('LIVE PROJECT TO BLENDER SUCCESS: ' + str(output))
` };
}

/** One downloadable launcher, not a .py that Windows opens with ordinary Python.
 * The payload is data, kept after an exit so batch never interprets Python or client text.
 */
export function createBlenderLauncher(building: Building, projection: Building3DProjection, timestamp = Date.now()): { filename: string; content: string } {
  const script = createBlenderExport(building, projection);
  const bytes = new TextEncoder().encode(script.content);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const payload = btoa(binary);
  const filename = script.filename.replace(/\.py$/, `-${timestamp}.cmd`);
  const command = [
    "$ErrorActionPreference='Stop'; try {",
    '$launcher=$env:PLANNER_LAUNCHER; $lines=Get-Content -LiteralPath $launcher;',
    "$marker=[Array]::IndexOf($lines,'::PLANNER_DATA'); if($marker -lt 0){throw 'Missing export payload'};",
    "$script=[IO.Path]::ChangeExtension($launcher,'py'); $blend=[IO.Path]::ChangeExtension($launcher,'blend');",
    "if((Test-Path -LiteralPath $script) -or (Test-Path -LiteralPath $blend)){throw 'Export already exists. Open the .blend beside this launcher, or download a new export.'};",
    "$blender='C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';",
    'if(!(Test-Path -LiteralPath $blender)){$blender=(Get-Command blender -ErrorAction Stop).Source};',
    "[IO.File]::WriteAllBytes($script,[Convert]::FromBase64String(($lines[($marker+1)..($lines.Length-1)] -join '')));",
    '& $blender --background --python-exit-code 1 --python $script;',
    "if($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $blend)){throw 'Blender generation failed. See the error above.'};",
    'Start-Process -FilePath $blender -ArgumentList ([string][char]34+$blend+[char]34); exit 0',
    '} catch { Write-Host $_ -ForegroundColor Red; exit 1 }',
  ].join(' ');
  return { filename, content: [
    '@echo off',
    'setlocal',
    'set "PLANNER_LAUNCHER=%~f0"',
    'echo Building the exported architectural model in Blender. Please wait...',
    `powershell.exe -NoProfile -Command "${command}"`,
    'if errorlevel 1 pause',
    'exit /b',
    '::PLANNER_DATA',
    payload,
    '',
  ].join('\r\n') };
}

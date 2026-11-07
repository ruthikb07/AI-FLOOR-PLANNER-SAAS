import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { addRoom, addStair, createBuilding, createGenerationControlState, rectToPolygon, RoomType } from '@ai-floor-planner/core';
import { coordinateStairAccess } from '@ai-floor-planner/planning-engine';
import { projectBuildingTo3D } from '@ai-floor-planner/projection-3d';
import { createBlenderExport, createBlenderLauncher } from '../services/blender-export';
import { ModelWorkspace } from '../components/model-3d/ModelWorkspace';

function buildingWithCore() {
  let b = createBuilding({ projectId: 'blender-test', name: 'Live project', site: { plotWidth: 10000, plotDepth: 10000 },
    floors: [0, 1].map(level => ({ buildingId: '', level, boundary: rectToPolygon(0, 0, 10000, 10000), floorHeight: 3000 })) });
  for (const floor of b.floors) {
    b = addRoom(b, floor.id, { floorId: floor.id, type: RoomType.Staircase, x: 1000, y: 1000, width: 4000, height: 4200 });
    b = addStair(b, floor.id, { floorId: floor.id, x: 1100, y: 1100, width: 1200, length: 3000, connectsFloors: [0, 1], verticalCoreId: 'core' });
  }
  return b;
}

describe('live-project Blender export', () => {
  it('packages Python as data in a single Windows launcher with visible failures and no command-length overflow', () => {
    const b = coordinateStairAccess(buildingWithCore()).building;
    const projection = projectBuildingTo3D(b);
    const launcher = createBlenderLauncher(b, projection, 123);
    const [commands, payload] = launcher.content.split('::PLANNER_DATA\r\n');
    expect(launcher.filename).toMatch(/-123\.cmd$/);
    expect(commands).toContain('--python-exit-code 1 --python');
    expect(commands).toContain('if errorlevel 1 pause');
    expect(commands).toContain('exit /b');
    expect(Math.max(...commands!.split('\r\n').map(line => line.length))).toBeLessThan(8191);
    expect(new TextDecoder().decode(Uint8Array.from(atob(payload!.trim()), value => value.charCodeAt(0))))
      .toBe(createBlenderExport(b, projection).content);
  });

  it('includes a framed review camera, lights and PNG render settings in the saved Blender scene', () => {
    const b = coordinateStairAccess(buildingWithCore()).building;
    const script = createBlenderExport(b, projectBuildingTo3D(b)).content;
    expect(script).toContain('scene.camera = camera');
    expect(script).toContain("bpy.ops.object.light_add(type='SUN'");
    expect(script).toContain("scene.render.engine = 'CYCLES'");
    expect(script).toContain("scene.render.image_settings.file_format = 'PNG'");
  });
  it('exposes the stair review and Blender export in the actual model workspace', () => {
    const b = buildingWithCore();
    vi.stubGlobal('localStorage', { getItem: () => null });
    try {
    const markup = renderToStaticMarkup(createElement(ModelWorkspace, { building:b, generationControl:createGenerationControlState(),
      activeFloorId:b.floors[0]!.id, selection:null, onSelectEntity:()=>undefined, onClearSelection:()=>undefined, onSwitchFloor:()=>undefined, onApplyBuilding:()=>undefined }));
    expect(markup).toContain('Stair review');
    expect(markup).toContain('Export Blender');
    } finally { vi.unstubAllGlobals(); }
  });
  it('embeds this project version, actual flights and the upper-floor void without duplicating the top stair', () => {
    const b = coordinateStairAccess(buildingWithCore()).building;
    const projection = projectBuildingTo3D(b);
    const artifact = createBlenderExport(b, projection);
    const line = artifact.content.split('\n').find(value => value.startsWith('DATA = json.loads('))!;
    const payload = JSON.parse(JSON.parse(line.slice('DATA = json.loads('.length, -1)));
    expect(payload.buildingId).toBe(b.id);
    expect(payload.buildingVersion).toBe(b.version);
    expect(payload.meshes.filter((mesh: { name: string }) => mesh.name.startsWith('Stair_'))).toHaveLength(17);
    expect(payload.meshes.filter((mesh: { name: string }) => mesh.name.startsWith('Floor_'))).toHaveLength(2);
    expect(projection.floorPlates[1]!.cutouts).toHaveLength(1);
    expect(artifact.content).toContain("scene.unit_settings.scale_length = 1.0");
    expect(artifact.content).toContain('if output.exists():');
    expect(artifact.content).not.toContain('architect-feedback');
  });
  it('blocks invalid flight geometry rather than shipping an empty stairwell', () => {
    const b = buildingWithCore();
    expect(() => createBlenderExport(b, projectBuildingTo3D(b))).toThrow('Resolve stair');
  });
  it('refuses a stale or foreign projection', () => {
    const b = coordinateStairAccess(buildingWithCore()).building;
    expect(() => createBlenderExport({ ...b, version: b.version + 1 }, projectBuildingTo3D(b))).toThrow('Stale');
  });
});

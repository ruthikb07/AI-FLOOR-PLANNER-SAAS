import * as THREE from 'three';
import { addTerraceStreetscape, type ShowcaseBlock as Block, type ShowcaseFixture } from './terrace-streetscape';

export function buildTerraceResidence(scene: THREE.Scene) {
  const stone = new THREE.MeshStandardMaterial({ color: '#e4ccab', roughness: .72 });
  const darkStone = new THREE.MeshStandardMaterial({ color: '#50423a', roughness: .9 });
  const timber = new THREE.MeshStandardMaterial({ color: '#865b41', roughness: .75 });
  const bronze = new THREE.MeshStandardMaterial({ color: '#80664b', metalness: .7, roughness: .32 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#577981', metalness: .33, roughness: .15, clearcoat: .95, clearcoatRoughness: .11 });
  const windowGlow = new THREE.MeshPhysicalMaterial({
    color: '#627b81', emissive: '#f5a95d', emissiveIntensity: .02, metalness: .14,
    roughness: .24, clearcoat: .8,
  });
  const guard = new THREE.MeshPhysicalMaterial({ color: '#b6d2ca', roughness: .15, metalness: .43, transparent: true, opacity: .29, depthWrite: false, side: THREE.DoubleSide });
  const pavement = new THREE.MeshStandardMaterial({ color: '#a49682', roughness: .97 });
  const road = new THREE.MeshStandardMaterial({ color: '#303a3e', roughness: .96 });
  const planting = new THREE.MeshStandardMaterial({ color: '#3d4c31', roughness: .96 });
  const leaf = new THREE.MeshStandardMaterial({ color: '#617649', roughness: .87 });
  const warm = new THREE.MeshStandardMaterial({ color: '#e0b477', emissive: '#db925d', emissiveIntensity: .15, roughness: .39, metalness: .22 });
  const water = new THREE.MeshPhysicalMaterial({ color: '#52776d', metalness: .53, roughness: .16, clearcoat: .8 });
  const cube = new THREE.BoxGeometry();
  const crownGeometry = new THREE.IcosahedronGeometry(1, 2);
  const scratch = new THREE.Object3D();
  function batch(parent: THREE.Object3D, material: THREE.Material, values: Block[], geometry: THREE.BufferGeometry = cube) {
    if (!values.length) return;
    const meshes = new THREE.InstancedMesh(geometry, material, values.length);
    for (let i = 0; i < values.length; i++) {
      const [x, y, z, w, h, d] = values[i]!;
      scratch.position.set(x, y, z);
      scratch.scale.set(w, h, d);
      scratch.updateMatrix();
      meshes.setMatrixAt(i, scratch.matrix);
      if (material === glass || material === windowGlow || material === stone) {
        const variant = (Math.sin((x + y * 2.8 + z) * 1.43) + 1) / 2;
        const shade = material === stone ? .87 + variant * .14 : .63 + variant * .37;
        meshes.setColorAt(i, new THREE.Color().setRGB(shade, shade, shade));
      }
    }
    meshes.castShadow = material !== guard && material !== water && material !== warm;
    meshes.receiveShadow = material !== guard;
    parent.add(meshes);
  }

  batch(scene, road, [[0, -.67, 0, 185, 1, 185]]);
  batch(scene, pavement, [[0, -.22, -2, 52, .55, 31], [0, .04, 10.6, 33, .28, 7.5], [0, .11, 15, 48, .13, 1.9]]);
  const markings = new THREE.MeshStandardMaterial({ color: '#d6d2c1', roughness: .97 });
  batch(scene, markings, Array.from({ length: 12 }, (_, index) => [-35 + index * 6, -.158, 20.5, 2.9, .02, .11]));
  batch(scene, darkStone, [[0, 1.9, -1.4, 28.2, 3.8, 13.8], [0, 0.31, 5.8, 29.2, .4, 4.65]]);
  batch(scene, stone, [[0, 3.86, -1.38, 30, .5, 15.7], [-1.6, 3.53, 8.6, 11.7, .42, 4.3]]);
  batch(scene, timber, [[-1.6, 3.28, 8.6, 11.6, .11, 4.16]]);
  const entryGlass: Block[] = [];
  const entryBronze: Block[] = [];
  for (let i = 0; i < 15; i++) {
    const x = -12.6 + i * 1.8;
    entryGlass.push([x, 1.8, 5.57, 1.7, 2.95, .13]);
    entryBronze.push([x + .86, 1.81, 5.64, .09, 3.05, .12]);
  }
  entryBronze.push([-6.9, 1.65, 10.48, .29, 3.3, .34], [3.65, 1.65, 10.48, .29, 3.3, .34]);
  batch(scene, glass, entryGlass);
  batch(scene, bronze, entryBronze);
  batch(scene, warm, [
    [-4.2, 3.20, 8.5, 1.25, .036, .08], [-1.6, 3.20, 8.5, 1.25, .036, .08],
    [1.0, 3.20, 8.5, 1.25, .036, .08], [-8.4, .46, 6.9, 1.08, .055, .04],
    [7.9, .46, 6.9, 1.08, .055, .04],
  ]);
  const { neighborhoodCount, fixtures } = addTerraceStreetscape(scene, batch, windowGlow, warm);
  const addWallLight = (position: [number, number, number], target: [number, number, number], eveningIntensity: number) => {
    const light = new THREE.SpotLight('#ffc181', 0, 13, .47, .89, 2);
    light.position.set(...position);
    light.target.position.set(...target);
    scene.add(light, light.target);
    const fixture: ShowcaseFixture = { light, eveningIntensity };
    fixtures.push(fixture);
  };
  addWallLight([-.8, 3.09, 8.45], [-.8, .1, 7.2], 35);
  addWallLight([14.85, .46, 4.2], [13.1, 5.6, 3.9], 90);
  addWallLight([-15, .48, 4.0], [-13.1, 5.4, 3.7], 84);
  const gardens: Block[] = [[-17.3, .1, 3.4, 4.8, .30, 19.8], [17.3, .1, 1.2, 5.2, .32, 20], [11.4, .14, 11.7, 9.8, .33, 3.4], [-14.1, .14, 12.5, 8.8, .33, 3.5]];
  batch(scene, planting, gardens);
  batch(scene, water, [[15.9, .15, 8.15, 3.8, .12, 7.6]]);
  const trunks: Block[] = [];
  const crowns: Block[] = [];
  const underbrush: Block[] = [];
  for (let i = 0; i < 54; i++) {
    const garden = gardens[i % gardens.length]!;
    const x = garden[0] + (Math.sin(i * 24.173) * .44) * garden[3];
    const z = garden[2] + (Math.sin(i * 7.137) * .45) * garden[5];
    if (i % 3 !== 0) {
      underbrush.push([x, .48, z, .45, .41, .59]);
      continue;
    }
    const h = 1.65 + Math.abs(Math.sin(i * 17)) * 2.0;
    trunks.push([x, h * .48, z, .14, h, .14]);
    for (let j = 0; j < 5; j++) {
      const phase = i + j * 1.257;
      crowns.push([x + Math.sin(phase) * .56, h + j * .14, z + Math.cos(phase) * .59, .64 + j * .08, .68, .58 + j * .06]);
    }
  }
  batch(scene, timber, trunks, new THREE.CylinderGeometry(.5, .62, 1, 7));
  batch(scene, leaf, crowns, crownGeometry);
  batch(scene, planting, underbrush, crownGeometry);

  const floors: THREE.Group[] = [];
  const panels: THREE.Object3D[] = [];
  const height = 3.15;
  for (let level = 0; level < 9; level++) {
    const floor = new THREE.Group();
    floors.push(floor);
    scene.add(floor);
    const y = 4.12 + level * height;
    const masonry: Block[] = [];
    const bronzePieces: Block[] = [];
    const wood: Block[] = [];
    const glazing: Block[] = [];
    const litGlazing: Block[] = [];
    const windowScreens: Block[] = [];
    const rails: Block[] = [];
    const lights: Block[] = [];
    const interior: Block[] = [];
    const partitions: Block[] = [];
    const enclosure = new THREE.Group();
    floor.add(enclosure);
    panels.push(enclosure);
    for (const wing of [-1, 1]) {
      if (wing === 1 && level >= 7) continue;
      const top = wing === -1 ? 8 : 6;
      const bays = level >= top - 1 ? 3 : 5;
      const bay = 2.47;
      const width = bays * bay;
      const x = wing * (6.64 + (bays === 3 ? .78 : 0));
      const depth = wing === -1 ? 12.15 : 10.85;
      const z = wing === -1 ? -.33 : -1.85;
      const front = z + depth / 2;
      const back = z - depth / 2;
      const overhang = 1.58 + ((level + (wing === 1 ? 1 : 0)) % 3) * .29;
      masonry.push([x, y, z, width + .38, .33, depth + .32],
        [x, y, front + overhang * .48, width + .54, .29, overhang + .3]);
      wood.push([x, y - .18, front + overhang * .51, width + .28, .065, overhang + .06]);
      for (let i = 0; i <= bays; i++) {
        const px = x - width / 2 + i * bay;
        masonry.push([px, y + 1.56, front - .1, i % 2 === 0 ? .37 : .22, height, .29]);
        bronzePieces.push([px, y + .59, front + overhang + .08, .055, 1.20, .052]);
        if (i === bays) continue;
        const center = px + bay / 2;
        const frontGlass = (i * 7 + level * 3 + (wing === 1 ? 2 : 0)) % 11 < 4 ? litGlazing : glazing;
        frontGlass.push([center, y + 1.6, front + .025, bay - .32, 2.69, .082]);
        glazing.push([center, y + 1.67, back, bay - .39, 2.53, .08]);
        bronzePieces.push([center, y + 1.6, front + .09, .062, 2.69, .075],
          [center, y + .27, front + .10, bay - .29, .09, .074],
          [center, y + 2.91, front + .10, bay - .28, .095, .074],
          [center, y + 1.19, front + overhang + .08, bay - .018, .06, .08]);
        rails.push([center, y + .69, front + overhang + .053, bay - .086, .99, .018]);
        if (level < top) lights.push([center - .28, y + 2.968, front + .57, .74, .028, .048]);
        partitions.push([px + .072, y + .88, z + .78, .14, 1.56, depth - 1.92]);
        partitions.push([center, y + .88, z - 1.63, bay - .16, 1.56, .15]);
        if (frontGlass === litGlazing) {
          windowScreens.push([center + .71, y + 1.71, front + .068, .36, 2.34, .033]);
        }
        if ((i + level) % 3 === 1) {
          interior.push([center, y + .31, front + .85, .76, .62, .49]);
          batch(floor, planting, [[center, y + .75, front + .85, .40, .35, .33]], crownGeometry);
        }
      }
      for (const side of [-1, 1]) {
        const sx = x + side * width / 2;
        const wallFace = sx + side * .22;
        partitions.push([sx, y + 1.61, z - 2.75, .39, 3.035, 5.6]);
        // Rainscreen joints and raised cedar fins remain legible from the orbit camera.
        for (let row = 0; row < 3; row++) {
          for (let panel = 0; panel < 4; panel++) {
            const joint = (row % 2 ? .14 : 0) - 2.1 + panel * 1.4;
            masonry.push([wallFace, y + .61 + row * 1.016, z - 2.75 + joint, .084, .99,
              row % 2 && panel === 3 ? 1.22 : 1.373]);
          }
        }
        for (let fin = 0; fin < 7; fin++) {
          wood.push([wallFace + side * .085, y + 1.62, z - 1.33 + fin * .172, .154, 2.99, .076]);
        }
        bronzePieces.push([wallFace + side * .116, y + .115, z - 2.76, .13, .071, 5.54]);
        for (let j = 0; j < 3; j++) {
          const pz = front - 1.1 - j * 1.48;
          glazing.push([sx + side * .06, y + 1.58, pz, .09, 2.42, 1.21]);
          bronzePieces.push([sx + side * .16, y + 1.57, pz - .59, .20, 2.8, .09]);
        }
      }
      if (level === top) {
        masonry.push([x, y + height + .04, z, width + .55, .46, depth + .54],
          [x + .60, y + height + .79, z - 2.35, 3.95, 1.23, 3.26],
          [x, y + height + .57, back - .06, width + .42, .76, .25]);
        batch(floor, water, [[x - .74, y + height + .30, front - 2.3, width * .52, .11, 2.38]]);
        for (let slat = 0; slat < 14; slat++) wood.push([x - 2.68 + slat * .42, y + height + 2.12, z + .15, .12, .17, 3.28]);
        for (const dx of [-2.6, 2.6]) bronzePieces.push([x + dx, y + height + 1.27, z + 1.67, .13, 1.86, .14]);
      }
    }
    batch(floor, stone, masonry);
    batch(floor, timber, wood);
    batch(floor, darkStone, interior);
    batch(floor, darkStone, partitions);
    batch(enclosure, bronze, bronzePieces);
    batch(enclosure, glass, glazing);
    batch(enclosure, windowGlow, litGlazing);
    batch(enclosure, timber, windowScreens);
    batch(enclosure, guard, rails);
    batch(enclosure, warm, lights);
  }
  return { floors, panels, stone, warm, windowGlow, fixtures, neighborhoodCount };
}

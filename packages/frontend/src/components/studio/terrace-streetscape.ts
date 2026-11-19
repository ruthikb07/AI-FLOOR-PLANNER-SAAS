import * as THREE from 'three';

export type ShowcaseBlock = [x: number, y: number, z: number, w: number, h: number, d: number];
export type ShowcaseBatch = (parent: THREE.Object3D, material: THREE.Material, values: ShowcaseBlock[], geometry?: THREE.BufferGeometry) => void;

export interface ShowcaseFixture {
  light: THREE.PointLight | THREE.SpotLight;
  eveningIntensity: number;
}

const ordinary = (color: string, roughness = .85) => new THREE.MeshStandardMaterial({ color, roughness });

const contextBuildings = [
  { x: -35, z: -10, width: 13, depth: 13, levels: 5, bays: 5, palette: 1 },
  { x: 31, z: -13, width: 15, depth: 14, levels: 5, bays: 6, palette: 0 },
  { x: -13, z: -32, width: 17, depth: 13, levels: 7, bays: 5, palette: 2 },
  { x: 13, z: -38, width: 14, depth: 13, levels: 8, bays: 5, palette: 1 },
  { x: -41, z: -35, width: 15, depth: 12, levels: 6, bays: 5, palette: 0 },
  { x: 41, z: -38, width: 16, depth: 14, levels: 7, bays: 5, palette: 2 },
] as const;

export function addTerraceStreetscape(
  scene: THREE.Scene,
  batch: ShowcaseBatch,
  windowGlow: THREE.MeshPhysicalMaterial,
  lamps: THREE.MeshStandardMaterial,
) {
  const context = new THREE.Group();
  context.name = 'Illustrative neighborhood';
  scene.add(context);
  const cladding = ['#a4988a', '#82797a', '#839498'].map(color => ordinary(color));
  const buildingMasses: ShowcaseBlock[][] = cladding.map(() => []);
  const concrete = ordinary('#c0b7a7');
  const graphite = ordinary('#414c50', .7);
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#506a76', metalness: .22, roughness: .29, clearcoat: .45, envMapIntensity: .7,
  });
  const sidewalk: ShowcaseBlock[] = [
    [0, -.10, 26.6, 144, .15, 2.5], [-28.4, -.10, -17, 2.5, .15, 58],
    [27.1, -.10, -15.0, 1.9, .15, 52],
  ];
  const stoneBands: ShowcaseBlock[] = [];
  const recesses: ShowcaseBlock[] = [];
  const windows: ShowcaseBlock[] = [];
  const litWindows: ShowcaseBlock[] = [];

  contextBuildings.forEach(({ x, z, width, depth, levels, bays, palette }, buildingIndex) => {
    const floorHeight = 2.9;
    const podiumHeight = 2.65;
    const height = podiumHeight + levels * floorHeight;
    const towerX = x + (palette === 2 ? .7 : 0);
    const roofShift = palette === 1 ? .4 : -1.35;
    sidewalk.push([x, -.16, z, width + 3.8, .19, depth + 3.9]);
    recesses.push([x, podiumHeight / 2, z, width + .4, podiumHeight, depth + .25]);
    buildingMasses[palette]!.push(
      [towerX, podiumHeight + levels * floorHeight / 2, z, width, levels * floorHeight, depth],
      [towerX - width * .21, height + .88, z + roofShift, width * .32, 1.52, depth * .32],
    );
    stoneBands.push([towerX, height + .09, z, width + .62, .30, depth + .62]);
    recesses.push([towerX, height + .43, z - depth / 2, width + .4, .42, .18],
      [towerX, height + .43, z + depth / 2, width + .4, .42, .18]);
    for (let level = 0; level < levels; level++) {
      const bottom = podiumHeight + level * floorHeight;
      const facadeBay = (width - 1.1) / bays;
      const sideBays = Math.max(3, bays - 1);
      const sideBay = (depth - .9) / sideBays;
      for (const sign of [-1, 1]) {
        const face = z + sign * (depth / 2 + .038);
        const side = towerX + sign * (width / 2 + .033);
        if (palette !== 2 || level % 2 === 0) {
          stoneBands.push([towerX, bottom + .26, face + sign * .10, width - .35, .22, palette === 0 ? .7 : .31],
            [side + sign * .075, bottom + .26, z, .27, .16, depth - .22]);
        }
        for (let column = 0; column < bays; column++) {
          const cx = towerX - (bays - 1) * facadeBay / 2 + column * facadeBay;
          const w = facadeBay * (palette === 2 ? .79 : .59);
          recesses.push([cx, bottom + 1.55, face, w + .12, 1.79, .085]);
          const panes = (column * 3 + level * 7 + buildingIndex + sign) % 7 < 2 ? litWindows : windows;
          panes.push([cx, bottom + 1.55, face + sign * .049, w, 1.65, .027]);
        }
        for (let column = 0; column < sideBays; column++) {
          const cz = z - (sideBays - 1) * sideBay / 2 + column * sideBay;
          const panes = (column + level * 5 + buildingIndex) % 7 === 0 ? litWindows : windows;
          panes.push([side + sign * .037, bottom + 1.53, cz, .084, 1.59, sideBay * .53]);
        }
      }
    }
  });
  cladding.forEach((material, index) => batch(context, material, buildingMasses[index]!));
  batch(context, concrete, [...sidewalk, ...stoneBands]);
  batch(context, graphite, recesses);
  batch(context, glass, windows);
  batch(context, windowGlow, litWindows);

  const crosswalk: ShowcaseBlock[] = [];
  for (const x of [-25, 25]) {
    for (let lane = 0; lane < 9; lane++) crosswalk.push([x, -.155, 17.15 + lane * .86, 2.55, .024, .41]);
  }
  batch(context, ordinary('#bcb5a5'), crosswalk);
  const streetTrees: ShowcaseBlock[] = [];
  const trunks: ShowcaseBlock[] = [];
  for (const x of [-38, -30, -21, -11, 0, 11, 21, 31, 40]) {
    const z = 27.4;
    const height = 2.9 + Math.cos(x * .43) * .32;
    trunks.push([x, height / 2, z, .16, height, .16]);
    streetTrees.push([x - .29, height, z + .26, 1.15, 1.18, 1.05],
      [x + .65, height + .22, z - .1, .76, 1.04, .92]);
  }
  batch(context, ordinary('#665243'), trunks, new THREE.CylinderGeometry(.48, .63, 1, 7));
  batch(context, ordinary('#405b43'), streetTrees, new THREE.IcosahedronGeometry(1, 1));

  const poles: ShowcaseBlock[] = [];
  const emitters: ShowcaseBlock[] = [];
  const fixtures: ShowcaseFixture[] = [];
  for (const x of [-30, -15, 0, 15, 30]) {
    poles.push([x, 2.05, 25.9, .12, 4.15, .12],
      [x, 4.08, 25.51, .095, .095, .86],
      [x, 4.05, 25.07, .28, .12, .45]);
    emitters.push([x, 3.98, 25.07, .24, .03, .39]);
    if (x === -15 || x === 15) {
      const light = new THREE.PointLight('#ffbb79', 0, 11, 2);
      light.position.set(x, 3.9, 25.05);
      context.add(light);
      fixtures.push({ light, eveningIntensity: 72 });
    }
  }
  batch(context, graphite, poles);
  batch(context, lamps, emitters);
  return { neighborhoodCount: contextBuildings.length, fixtures };
}

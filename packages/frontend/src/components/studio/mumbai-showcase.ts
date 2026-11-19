import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const assetRoot = `${import.meta.env.BASE_URL}architecture/`;

export async function loadMumbaiShowcase() {
  const { scene: source } = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(assetRoot + 'mumbai-residential.glb');
  source.updateMatrixWorld(true);

  type StaticBatch = { material: THREE.Material; meshes: THREE.Mesh[]; district: string };
  const batches = new Map<string, StaticBatch>();
  const components = new Set<string>();
  source.traverse(object => {
    if (object.userData.componentId) components.add(object.userData.componentId);
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    let parent: THREE.Object3D | null = object;
    while (parent && !parent.userData.batch) parent = parent.parent;
    const district = String(parent?.userData.batch ?? 'site');
    const key = `${district}:${object.material.uuid}`;
    const batch: StaticBatch = batches.get(key) ?? { material: object.material, meshes: [], district };
    batch.meshes.push(object);
    batches.set(key, batch);
  });

  // Keep the GLB's component hierarchy and transforms for later floor/phase controls.
  // The static view submits one material batch per tower and surrounding district.
  const model = new THREE.Group();
  source.visible = false;
  model.add(source);
  const emissives: THREE.MeshStandardMaterial[] = [];
  const stone: THREE.MeshStandardMaterial[] = [];
  for (const { material, meshes, district } of batches.values()) {
    const parts = meshes.map(mesh => mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
    const geometry = mergeGeometries(parts);
    parts.forEach(part => part.dispose());
    if (!geometry) throw new Error(`Could not batch showcase geometry for ${material.name}`);
    const batch = new THREE.Mesh(geometry, material);
    batch.name = `${district} · ${material.name}`;
    batch.castShadow = district !== 'context' && ['Stone', 'Mineral finish', 'Planting'].includes(material.name);
    batch.receiveShadow = district !== 'context' && !material.transparent;
    model.add(batch);
    if (material instanceof THREE.MeshStandardMaterial) {
      if (material.name === 'Stone' && !stone.includes(material)) stone.push(material);
      if (material.emissive.getHex() !== 0 && !emissives.includes(material)) emissives.push(material);
      if (material.name === 'Balcony guards') {
        material.depthWrite = false;
        batch.renderOrder = 2;
      }
    }
  }
  const neighborhoodCount = [...components].filter(id => /^context\.\d+$/.test(id)).length;
  return { model, stone, emissives, componentCount: components.size, neighborhoodCount };
}

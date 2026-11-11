import * as THREE from 'three';

export interface StaticInstance { matrix: THREE.Matrix4; color?: THREE.Color }
interface InstanceStyle { name?: string; castShadow?: boolean; receiveShadow?: boolean; renderOrder?: number }

/** Keep full-detail static instances in local spatial batches. One map-wide
 * bounding sphere prevents Three.js from culling even the houses behind the
 * camera. Batches share the original geometry/material/texture, while each
 * camera (main, mirror, 360, shadow) performs its own normal frustum culling. */
export function addSpatialInstances(
  parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[],
  instances: readonly StaticInstance[], style: InstanceStyle = {}, cellSize = 100,
): THREE.InstancedMesh[] {
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('Invalid scenery cell size');
  if (!instances.length) return [];
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const centre = geometry.boundingSphere!.center;
  const buckets = new Map<string, StaticInstance[]>();
  const point = new THREE.Vector3();
  for (const instance of instances) {
    point.copy(centre).applyMatrix4(instance.matrix);
    const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.z / cellSize)}`;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = []; buckets.set(key, bucket); }
    bucket.push(instance);
  }
  const result: THREE.InstancedMesh[] = [];
  for (const bucket of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, bucket.length);
    mesh.name = style.name ?? '';
    mesh.castShadow = style.castShadow ?? false;
    mesh.receiveShadow = style.receiveShadow ?? true;
    mesh.renderOrder = style.renderOrder ?? 0;
    const colored = bucket.some(instance => instance.color !== undefined);
    bucket.forEach((instance, index) => {
      mesh.setMatrixAt(index, instance.matrix);
      if (colored) mesh.setColorAt(index, instance.color ?? new THREE.Color(0xffffff));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    parent.add(mesh); result.push(mesh);
  }
  return result;
}

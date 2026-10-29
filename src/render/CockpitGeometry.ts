import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { COCKPIT_RIG } from "./CockpitRig.ts";

/** Continuous dashboard volume, authored in metres around the driver's eye. */
export function dashboardGeometry(): THREE.BufferGeometry {
  const sections = 48;
  const profile: [number, number][] = [[.54,.62],[.51,.78],[.57,.89],[.75,.94],[1.14,.94],[1.23,.86],[1.25,.63]];
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let i = 0; i <= sections; i++) {
    const z = -1.0 + i * 2 / sections;
    const driverBinnacle = .048 * Math.exp(-(((z + .46) / .31) ** 2));
    for (let j = 0; j < profile.length; j++) {
      const [x,y] = profile[j];
      positions.push(x + .035 * z * z, y + (j >= 2 && j <= 4 ? driverBinnacle : 0), z);
      uv.push(j / (profile.length - 1), i / sections);
    }
  }
  const ring = profile.length;
  for (let i = 0; i < sections; i++) for (let j = 0; j < ring; j++) {
    const a = i * ring + j, b = (i + 1) * ring + j, next = (j + 1) % ring;
    indices.push(a, b, i * ring + next, i * ring + next, b, (i + 1) * ring + next);
  }
  // End caps close the dashboard against each door.
  for (let j = 1; j < ring - 1; j++) {
    indices.push(0, j, j + 1);
    indices.push(sections * ring, sections * ring + j + 1, sections * ring + j);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function leatherGrain(): THREE.DataTexture {
  const size = 64, data = new Uint8Array(size * size * 4);
  let state = 71;
  for (let i = 0; i < size * size; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const value = 225 + state % 30;
    data.set([value, value, value, 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(12, 12); texture.needsUpdate = true;
  return texture;
}

/** All wheel parts share a pivot on the longitudinal axis. Spokes and switches
 * therefore rotate with the rim instead of remaining floating in the cabin. */
export function makeSteeringWheel(leather: THREE.Material, metal: THREE.Material): THREE.Group {
  const wheel = new THREE.Group();
  wheel.name = "steering-wheel";
  wheel.position.copy(COCKPIT_RIG.wheel);
  wheel.rotation.z = -.22;
  const spin = new THREE.Group(); spin.name = "wheel-spin"; wheel.add(spin);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < 48; i++) {
    const angle = i * Math.PI * 2 / 48;
    points.push(new THREE.Vector3(0, Math.max(-.165, Math.cos(angle) * .193), Math.sin(angle) * .193));
  }
  const rim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 96, .023, 10, true), leather);
  spin.add(rim);
  const hub = new THREE.Mesh(new RoundedBoxGeometry(.07, .105, .145, 3, .025), leather);
  hub.position.x = -.014; spin.add(hub);
  for (const side of [-1, 1]) {
    const spoke = new THREE.Mesh(new RoundedBoxGeometry(.035, .042, .125, 2, .01), metal);
    spoke.position.set(.006, -.025, side * .12); spoke.rotation.x = side * .12; spin.add(spoke);
    const switchBank = new THREE.Mesh(new RoundedBoxGeometry(.015, .033, .069, 2, .008), leather);
    switchBank.position.set(-.016, -.017, side * .112); spin.add(switchBank);
    const marker = new THREE.Mesh(new THREE.BoxGeometry(.002, .008, .018), metal);
    marker.position.set(-.025, -.012, side * .112); spin.add(marker);
  }
  const lowerSpoke = new THREE.Mesh(new RoundedBoxGeometry(.035, .113, .04, 2, .009), metal);
  lowerSpoke.position.set(.009, -.102, 0); spin.add(lowerSpoke);
  return wheel;
}

export function disposeVehicle(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  root.traverse(object => {
    if(typeof object.userData.disposeRenderTarget==="function")object.userData.disposeRenderTarget();
    if (object instanceof THREE.Mesh) {
      if (!object.userData.sharedVehicleAsset) geometries.add(object.geometry);
      if(!object.userData.sharedCabinMaterial)for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      if(object.userData.exteriorGlass)materials.add(object.userData.exteriorGlass);
      if(object.userData.driverGlass)materials.add(object.userData.driverGlass);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  // Shadow and licence textures are shared across cars and stay cached.
  materials.forEach(material => material.dispose());
}

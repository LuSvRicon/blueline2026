import * as THREE from "three";

/** One coordinate system for the interior and driver's camera, in metres.
 * The car points along +X; its driver's side is -Z. */
export const COCKPIT_RIG = {
  eye: new THREE.Vector3(-.60, 1.30, -.43),
  wheel: new THREE.Vector3(.23, .90, -.43),
  cluster: new THREE.Vector3(.51, 1.075, -.43),
  infotainment: new THREE.Vector3(.48, .985, .29),
  horizontalFov: 96,
  pitch: -8 * Math.PI / 180,
};

/** PerspectiveCamera.fov is vertical; the cockpit UI exposes horizontal FOV. */
export function cockpitVerticalFov(horizontal: number, aspect: number): number {
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(horizontal / 2)) / Math.max(aspect, .1)));
}

export function cockpitCameraPose(x: number, z: number, yaw: number, height: number, lookYaw = 0, lookPitch = 0): { position: THREE.Vector3; target: THREE.Vector3 } {
  const eye = COCKPIT_RIG.eye;
  const position = new THREE.Vector3(x + eye.x * Math.cos(yaw) - eye.z * Math.sin(yaw), height, z + eye.x * Math.sin(yaw) + eye.z * Math.cos(yaw));
  const heading = yaw + lookYaw, pitch = COCKPIT_RIG.pitch + lookPitch;
  const target = position.clone().add(new THREE.Vector3(Math.cos(heading) * Math.cos(pitch), Math.sin(pitch), Math.sin(heading) * Math.cos(pitch)).multiplyScalar(25));
  return { position, target };
}

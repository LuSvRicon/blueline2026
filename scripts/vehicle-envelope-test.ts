import assert from "node:assert/strict";
import * as THREE from "three";
// @ts-expect-error Test-only GLB reader keeps real vertices, without browser image decoding.
import { geometryOnly } from "./inspect-vehicle-assets.mjs";
import { Vehicle, EGO_DIMS, vehicleProfileDimensions } from "../src/vehicle/Vehicle.ts";
import { getVehiclePhysicsProfile, REAL_VEHICLE_IDS } from "../src/vehicle/VehicleProfiles.ts";
import { Body2D, bodyContact, sweepBodies } from "../src/core/collision.ts";
import { prepareImportedVehicle } from "../src/render/ImportedVehicles.ts";
import { attachDetailedVehicle } from "../src/render/DetailedVehicle.ts";
import { IMPORTED_CABINS, installImportedCabinEquipment, setImportedCabinView } from "../src/render/ImportedCabin.ts";
import { COCKPIT_RIG, cockpitCameraPose, cockpitVerticalFov } from "../src/render/CockpitRig.ts";
import { disposeVehicle } from "../src/render/CockpitGeometry.ts";
import { Simulation } from "../src/sim/Simulation.ts";
import { CarFleet } from "../src/render/CarFleet.ts";

// Assertions use independently recorded source dimensions. The VF9 body-only
// width is explicitly an assumption; its published mirror width is separate.
const expected = {
  vf9: [5.118, 2.004, 3.15],
  santafe: [4.785, 1.9, 2.765],
  everest: [4.914, 1.923, 2.9],
  civic: [4.595, 1.89, 2.735],
} as const;

for (const id of REAL_VEHICLE_IDS) {
  const profile = getVehiclePhysicsProfile(id);
  const direct = new Vehicle(19, -7, .23, 12, EGO_DIMS, { profileId: id });
  assert.deepEqual([direct.dims.length, direct.dims.width, direct.dims.wheelbase], expected[id], `${id}: constructor must use the selected body`);
  const car = new Vehicle(19, -7, .23, 12);
  car.delta = .1;
  car.applyPhysicsProfile(id);
  assert.deepEqual(car.dims, direct.dims, `${id}: selector and constructor disagree`);
  assert.deepEqual([car.x, car.y, car.yaw, car.v, car.delta], [19, -7, .23, 12, .1], `${id}: changing vehicle must preserve pose/speed`);
  assert.deepEqual(car.dims, vehicleProfileDimensions(profile));
  assert(profile.dimensionSourceUrls?.every(url => url.startsWith("https://")), `${id}: missing primary dimension source`);
  const dimsSnapshot = car.dims;
  car.applyPhysicsProfile("composite");
  assert.deepEqual(car.dims, EGO_DIMS, "return to legacy reference dimensions");
  assert.deepEqual(dimsSnapshot, direct.dims, "profile change mutated an earlier frame's dimensions");

  // Contact and swept contact must agree with the selected car's bumpers and
  // sides, at straight and rotated headings, rather than a universal 4.7m box.
  for (const yaw of [0, Math.PI / 3]) {
    const body: Body2D = { x: 0, y: 0, yaw, ...direct.dims };
    const other = (along: number, side: number): Body2D => ({
      x: Math.cos(yaw) * along - Math.sin(yaw) * side,
      y: Math.sin(yaw) * along + Math.cos(yaw) * side,
      yaw, length: 4.6, width: 1.9,
    });
    const bumperDistance = (direct.dims.length + 4.6) / 2;
    const sideDistance = (direct.dims.width + 1.9) / 2;
    assert(!bodyContact(body, other(bumperDistance + .02, 0), 0), `${id}: false bumper contact`);
    assert(bodyContact(body, other(bumperDistance - .02, 0), 0), `${id}: missed bumper overlap`);
    assert(!bodyContact(body, other(0, sideDistance + .02), 0), `${id}: false side contact`);
    assert(bodyContact(body, other(0, sideDistance - .02), 0), `${id}: missed side overlap`);
    const hit = sweepBodies(body, body, other(bumperDistance + 1, 0), other(bumperDistance - 1, 0), 0);
    assert(hit && Math.abs(hit.time - .5) < 1e-6, `${id}: swept bumper does not match body footprint`);
  }

  const prepared = prepareImportedVehicle((await geometryOnly(`public/models/imported/${id}.glb`)).scene, id);
  const host = new THREE.Group(), shell = new THREE.Group(); host.add(shell);
  Object.assign(host.userData, { visualDims: direct.dims, shell, wheels: [] });
  assert(attachDetailedVehicle(host, 0x223355, prepared));
  const fitted = host.userData.importedRoot as THREE.Group;
  fitted.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(fitted, true), size = bounds.getSize(new THREE.Vector3());
  assert(Math.abs(size.x - direct.dims.length) < .01, `${id}: rendered length ${size.x} != collision ${direct.dims.length}`);
  assert(Math.abs(size.z - direct.dims.width) < .01, `${id}: rendered width ${size.z} != collision ${direct.dims.width}`);
  assert(Math.abs(bounds.min.y) < .01, `${id}: asset floats after fit`);
  assert.equal(host.userData.wheels.length, 4, `${id}: lost wheel animation rig`);

  // Equipment and the driver's eye share the same per-instance scale. Test
  // real imported cabins at wide desktop and short landscape-phone viewports.
  const rig = IMPORTED_CABINS[id];
  if (rig) {
    const bsm = { left: new THREE.MeshStandardMaterial(), right: new THREE.MeshStandardMaterial() };
    installImportedCabinEquipment(fitted, {
      makeMirror: (w, h, name) => {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial()); mesh.name = name; return mesh;
      },
      blindSpot: bsm, instrument: new THREE.Texture(), navigation: new THREE.Texture(),
    });
    setImportedCabinView(fitted, true); fitted.updateMatrixWorld(true);
    const eye = new THREE.Vector3(...rig.eye).multiply(fitted.scale), ray = new THREE.Raycaster();
    const hits = (point: THREE.Vector3) => {
      ray.set(eye, point.clone().sub(eye).normalize());
      return ray.intersectObject(fitted, true).filter(hit => {
        const mat = (hit.object as THREE.Mesh).material as THREE.Material;
        return !(mat.transparent && mat.opacity < .05);
      });
    };
    for (const angle of [-.15, 0, .15]) assert.equal(hits(eye.clone().add(new THREE.Vector3(50 * Math.cos(angle), 0, 50 * Math.sin(angle))))[0], undefined, `${id}: resized cabin blocks road horizon`);
    for (const name of ["imported-mirror-left", "imported-mirror-right", "imported-rearview-mirror", "imported-live-cluster", "imported-live-navigation"]) {
      const part = fitted.getObjectByName(name)!;
      assert.equal(hits(part.getWorldPosition(new THREE.Vector3()))[0]?.object.name, name, `${id}: resized cabin hides ${name}`);
    }
    for (const aspect of [16 / 9, 1280 / 456, 844 / 216]) {
      const camera = new THREE.PerspectiveCamera(cockpitVerticalFov(COCKPIT_RIG.horizontalFov, aspect), aspect, .04, 500);
      const pose = cockpitCameraPose(0, 0, 0, eye.y, 0, 0, eye, rig.pitch, rig.viewYaw);
      camera.position.copy(pose.position); camera.lookAt(pose.target); camera.updateMatrixWorld(true);
      for (const side of ["left", "right"]) {
        const mirror = fitted.getObjectByName(`imported-mirror-${side}`)!;
        for (const u of [-.065, .065]) for (const v of [-.025, .025]) {
          const point = mirror.localToWorld(new THREE.Vector3(u, v, 0)).project(camera);
          assert(Math.abs(point.x) < .98 && Math.abs(point.y) < .95 && point.z < 1, `${id}: resized ${side} mirror clipped at ${aspect}`);
        }
      }
    }
  }
  disposeVehicle(host);
  console.log(`${id}: ${size.x.toFixed(3)} × ${size.z.toFixed(3)} m render/body envelope, contacts, swept contacts, wheels and cabin clearances PASS`);
}

assert.equal(getVehiclePhysicsProfile("vf9").bodyWidthProvenance, "simulation-assumption");
assert.equal(getVehiclePhysicsProfile("vf9").overallWidthIncludingMirrorsM, 2.254);
const custom = new Vehicle(0, 0, 0, 0, { length: 3.6, width: 1.6, wheelbase: 2.2 });
custom.applyPhysicsProfile("vf9"); custom.applyPhysicsProfile("composite");
assert.deepEqual(custom.dims, { length: 3.6, width: 1.6, wheelbase: 2.2 }, "custom reference fixture was lost");
assert.equal(custom.physicsProfile.wheelbaseM, 2.2);

// Exercise actual fleet switching, not just the GLB helper. Canvas draw calls
// are irrelevant here; no browser or GPU rendering claim is made by this test.
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const context = new Proxy({ canvas: { width: 256, height: 256 } }, {
  get: (target, name) => name in target ? target[name as keyof typeof target]
    : name === "createRadialGradient" || name === "createLinearGradient" ? () => ({ addColorStop: () => {} }) : () => {},
});
Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ width: 256, height: 256, getContext: () => context }) } });
try {
  const sim = new Simulation({ trafficCount: 0 }); sim.traffic.clear();
  const fleet = new CarFleet(sim), publicGroup = fleet.group;
  fleet.setNight(true); fleet.setCockpitView(true);
  for (const id of [...REAL_VEHICLE_IDS, "composite"] as const) {
    const previous = fleet.group.children.find(o => o.userData.builtKind === "ego")!;
    const oldTextures = previous.userData.ownedCabinTextures as THREE.Texture[];
    let disposed = 0; oldTextures.forEach(texture => texture.addEventListener("dispose", () => disposed++));
    sim.setVehicleProfile(id); fleet.update(1 / 60, 0);
    const current = fleet.group.children.find(o => o.userData.builtKind === "ego")!;
    assert.notEqual(current, previous, `${id}: physical profile changed without rebuilding fallback geometry`);
    assert.equal(fleet.group, publicGroup, "fleet replaced the public scene group");
    assert.deepEqual(current.userData.visualDims, sim.ego.dims, `${id}: fleet has stale geometry`);
    assert.equal(previous.parent, null, "old visual remains in world");
    assert.equal(disposed, oldTextures.length, "repeated vehicle switches leak owned display/grain textures");
    assert((current.userData.headlampBeams as THREE.SpotLight[]).every(beam => beam.intensity > 0), "night lighting lost after switch");
    assert.equal(current.userData.cockpit.visible, true, "cockpit view lost after switch");
  }
  for (const texture of fleet.group.children[0].userData.ownedCabinTextures as THREE.Texture[]) texture.dispose();
  disposeVehicle(fleet.group);
} finally {
  if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument); else Reflect.deleteProperty(globalThis, "document");
}
console.log("VEHICLE-ENVELOPE PASS — four real assets fit their own body envelope, profile switching/collision/cabin/phone-FOV and visual resource lifetime verified. Nominal dimensions remain a simulation model.");

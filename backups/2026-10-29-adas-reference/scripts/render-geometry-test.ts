import assert from "node:assert/strict";
import * as THREE from "three";
import { dashboardGeometry, makeSteeringWheel, disposeVehicle } from "../src/render/CockpitGeometry.ts";
import { ribbon } from "../src/render/RoadView.ts";
import { Simulation } from "../src/sim/Simulation.ts";
import { projectEgoPoint } from "../src/core/viewProjection.ts";

const dash = dashboardGeometry();
dash.computeBoundingBox();
const size = dash.boundingBox!.getSize(new THREE.Vector3());
assert(size.z > 1.8 && size.z < 2.1 && size.y > .3, "dashboard must be a full-width metre-scale volume");
const pos = dash.getAttribute("position"), index = dash.getIndex()!;
let volume = 0;
for (let i = 0; i < index.count; i += 3) {
  const a = new THREE.Vector3().fromBufferAttribute(pos, index.getX(i));
  const b = new THREE.Vector3().fromBufferAttribute(pos, index.getX(i+1));
  const c = new THREE.Vector3().fromBufferAttribute(pos, index.getX(i+2));
  volume += a.dot(b.cross(c)) / 6;
}
assert(volume > .1, "closed dashboard faces must point outwards");
const sim = new Simulation({ trafficCount: 0 });
const road = ribbon(sim.path, 0, 5.55, .02, false);
const normals = road.getAttribute("normal");
for (let i = 0; i < normals.count; i++) assert(normals.getY(i) > .99, "road normals must face the sky for PBR lighting");
const wheel = makeSteeringWheel(new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial());
const bounds = new THREE.Box3().setFromObject(wheel).getSize(new THREE.Vector3());
assert(bounds.y < .5 && bounds.z < .5 && bounds.y > .3, "wheel diameter must match a passenger car");
assert.deepEqual(projectEgoPoint(10,0,0,0,0,1,50,50), [50,40], "ahead projects upward");
assert.deepEqual(projectEgoPoint(0,2,0,0,0,1,50,50), [52,50], "right side must agree with the main driving camera");
let geometryDisposals = 0, materialDisposals = 0;
const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
geometry.addEventListener("dispose",()=>geometryDisposals++); material.addEventListener("dispose",()=>materialDisposals++);
const group = new THREE.Group(); group.add(new THREE.Mesh(geometry,material),new THREE.Mesh(geometry,material));
disposeVehicle(group);
assert.equal(geometryDisposals,1); assert.equal(materialDisposals,1);
console.log("RENDER-GEOMETRY PASS — dashboard volume/winding, wheel scale, road lighting normals, map projection and resource disposal. Visual appearance still needs browser verification.");

import assert from "node:assert/strict";
import * as THREE from "three";
import { dashboardGeometry, makeSteeringWheel, disposeVehicle } from "../src/render/CockpitGeometry.ts";
import { ribbon, RoadView } from "../src/render/RoadView.ts";
import { ARHudView } from "../src/render/ARHudView.ts";
import { TracksView } from "../src/render/TracksView.ts";
import { ParkingView } from "../src/render/ParkingView.ts";
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

// Verify 3D AR HUD (Lane Carpet, Chevrons, 3D Target Lock Cage, and Stop Wall)
const arSim = new Simulation({ trafficCount: 0 });
arSim.setControlMode("adas");
const f = arSim.path.toFrenet(arSim.ego.x, arSim.ego.y);
arSim.traffic.addTestVehicle("car", arSim.road.laneOf(f.d), f.s + 22, 10);
arSim.step(1 / 60);
const arHud = new ARHudView();
arHud.update(arSim, 1 / 60, false);
const arMesh = arHud.group.children[0] as THREE.Mesh;
const arLines = arHud.group.children[1] as THREE.LineSegments;
assert(arMesh.geometry.drawRange.count > 0, "AR HUD must emit lane carpet and stop wall triangles");
assert(arLines.geometry.drawRange.count > 40, "AR HUD must emit lane rails, chevrons, and 3D target lock cage");

const tracksView = new TracksView();
tracksView.update([{ id: 1, px: 10, py: 5, vx: 12, vy: 0, length: 4.6, width: 1.9, age: 5, misses: 0 }]);
assert(tracksView.object.geometry.drawRange.count >= 24, "TracksView must render 3D volumetric bounding cage + velocity arrow");

// Verify RoadView streetlights and nighttime light pool toggle
const roadView = new RoadView(sim.road);
const streetlights = roadView.group.getObjectByName("road-streetlights")!;
assert(streetlights && streetlights.children.length === 4, "RoadView must build instanced streetlight poles, arms, luminaire heads, and light pools");
roadView.setNight(true);
assert.equal(streetlights.children[3].visible, true, "Streetlight ground pools must illuminate at night");
roadView.setNight(false);
assert.equal(streetlights.children[3].visible, false, "Streetlight ground pools must turn off during the day");

// Verify ParkingView perpendicular 90-degree bay rendering
sim.prepareParkingLab("perpendicular");
const parkingView = new ParkingView(sim);
parkingView.update();
assert.equal(parkingView.group.children[0].children.length, 3, "ParkingView must render all 3 perpendicular bays with wheel stoppers");

console.log("RENDER-GEOMETRY PASS — dashboard volume/winding, wheel scale, road lighting normals, streetlights, 3D AR HUD, 3D perception cages, perpendicular bays, map projection and resource disposal. Visual appearance still needs browser verification.");

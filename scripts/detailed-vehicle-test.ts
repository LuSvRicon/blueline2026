import assert from "node:assert/strict";
import * as THREE from "three";
import {prepareDetailedVehicle,attachDetailedVehicle} from "../src/render/DetailedVehicle.ts";
import {disposeVehicle} from "../src/render/CockpitGeometry.ts";
const source=new THREE.Group();
const paint=new THREE.MeshStandardMaterial({name:"Paint 1 Carmine"});
const body=new THREE.Mesh(new THREE.BoxGeometry(2,1,4.6),paint); body.position.y=.9; source.add(body);
for(const side of [-1,1])for(const front of [true,false]) {
  const wheel=new THREE.Group(); wheel.name=`Wheel${front?"Front":"Rear"}${side<0?"L":"R"}`;
  wheel.position.set(side*.9,.34,front?1.4:-1.4);
  wheel.add(new THREE.Mesh(new THREE.SphereGeometry(.34),new THREE.MeshStandardMaterial())); source.add(wheel);
}
const signal=new THREE.Mesh(new THREE.BoxGeometry(1.8,.1,.1),new THREE.MeshStandardMaterial({name:"Signallight"}));
signal.name="BodyTurnsignalsRear"; signal.position.set(0,1,-2);source.add(signal);
const prepared=prepareDetailedVehicle(source);
function car(){const g=new THREE.Group();const shell=new THREE.Group();g.add(shell);g.userData.shell=shell;g.userData.wheels=[];return g;}
const first=car(),second=car();
assert(attachDetailedVehicle(first,0xff0000,prepared));assert(attachDetailedVehicle(second,0x00ff00,prepared));
assert.equal(first.userData.wheels.length,4);
assert.equal(first.userData.wheels.filter((wheel:{front:boolean})=>wheel.front).length,2);
assert.notEqual(first.userData.bodyMats[0],second.userData.bodyMats[0]);
assert.notEqual(first.userData.turnLeft,first.userData.turnRight);
let sharedDisposals=0;
first.traverse(o=>{if(o instanceof THREE.Mesh){if(o.userData.sharedVehicleAsset){o.geometry.addEventListener("dispose",()=>sharedDisposals++);}
  if(Array.isArray(o.material))assert(o.geometry.groups.length>0,"multi-material GLB must have draw groups");
}});
const bounds=new THREE.Box3().setFromObject(first),size=bounds.getSize(new THREE.Vector3());
assert(Math.abs(size.x-4.6)<.001);assert(Math.abs(size.z-1.9)<.001);assert(Math.abs(bounds.min.y)<.001);
disposeVehicle(first);assert.equal(sharedDisposals,0,"disposing one car must retain shared asset geometry");
assert.equal(attachDetailedVehicle(second,0,prepared),false);
console.log("DETAILED-VEHICLE PASS — orientation/scale, draw groups, wheel refs, independent paint/signals and shared-geometry lifetime.");

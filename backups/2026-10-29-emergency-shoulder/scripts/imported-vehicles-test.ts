import assert from "node:assert/strict";
// @ts-expect-error Test-only Node GLB reader strips textures; geometry stays real.
import {geometryOnly} from "./inspect-vehicle-assets.mjs";
import * as THREE from "three";
import {prepareImportedVehicle} from "../src/render/ImportedVehicles.ts";
import {attachDetailedVehicle,replaceDetailedVehicle} from "../src/render/DetailedVehicle.ts";
import {VEHICLE_MODELS} from "../src/render/VehicleCatalog.ts";
const car=new THREE.Group(),shell=new THREE.Group();car.add(shell);car.userData.shell=shell;car.userData.wheels=[];
for(const model of VEHICLE_MODELS){
 const gltf=await geometryOnly(`public/models/imported/${model.file}`);
 const prepared=prepareImportedVehicle(gltf.scene,model.id);
 const box=new THREE.Box3().setFromObject(prepared,true),size=box.getSize(new THREE.Vector3());
 assert(Math.abs(size.x-4.6)<.01,`${model.id} length ${size.x}`);assert(Math.abs(size.z-1.9)<.01,`${model.id} width ${size.z}`);
 assert(Math.abs(box.min.y)<.01,`${model.id} grounded`);
 const wheels=prepared.children.filter(object=>object.name.startsWith("Wheel"));assert.equal(wheels.length,4,`${model.id} four wheels`);
 assert(replaceDetailedVehicle(car,0x223355,prepared,model.id));assert.equal(shell.children.filter(o=>o.name==="ImportedVehicle").length,1);
 assert(car.userData.brakeLamps.length>0,`${model.id} brake lamps bound`);assert(car.userData.headLamps.length>0,`${model.id} headlamps bound`);
 assert.equal(attachDetailedVehicle(car,0,prepared),false);
 let draws=0;prepared.traverse(o=>{if(o instanceof THREE.Mesh){draws++;assert(o.geometry.getAttribute("position").array instanceof Float32Array);}});
 assert(draws<140,`${model.id} too many draw calls ${draws}`);
 console.log(`${model.name}: ${draws} batches, 4 wheels, geometry/ground/replace PASS`);
}
console.log("IMPORTED-VEHICLES PASS — all four actual optimized GLBs, float decoding, axis/size, wheels and switching.");

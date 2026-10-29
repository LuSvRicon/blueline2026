import assert from "node:assert/strict";
import * as THREE from "three";
// @ts-expect-error Test-only reader preserves real GLB geometry without browser textures.
import {geometryOnly} from "./inspect-vehicle-assets.mjs";
import {prepareImportedVehicle} from "../src/render/ImportedVehicles.ts";
import {IMPORTED_CABINS,installImportedCabinEquipment,setImportedCabinView} from "../src/render/ImportedCabin.ts";
import {COCKPIT_RIG,cockpitCameraPose,cockpitVerticalFov} from "../src/render/CockpitRig.ts";
for(const id of ["santafe","civic"] as const){
 const root=prepareImportedVehicle((await geometryOnly(`public/models/imported/${id}.glb`)).scene,id);
 const rig=IMPORTED_CABINS[id]!;
 const bsm={left:new THREE.MeshStandardMaterial(),right:new THREE.MeshStandardMaterial()};
 installImportedCabinEquipment(root,{makeMirror:(w,h,name)=>{const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial());mesh.name=name;return mesh;},blindSpot:bsm,instrument:new THREE.Texture(),navigation:new THREE.Texture()});
 const steering=root.getObjectByName("asset-steering-wheel")!;
 assert(steering.children.length>0,`${id}: actual steering geometry is articulated`);
 root.updateMatrixWorld(true);
 const wheelSize=new THREE.Box3().setFromObject(steering,true).getSize(new THREE.Vector3());
 assert(wheelSize.x<.30&&wheelSize.y<.45&&wheelSize.z<.45,`${id}: steering rig must not include dashboard or seat geometry`);
 const windows:THREE.Mesh[]=[];root.traverse(o=>{if(o instanceof THREE.Mesh&&o.userData.cabinWindow)windows.push(o);});
 assert(windows.length>0);
 const originals=windows.map(o=>o.material);
 setImportedCabinView(root,true);root.updateMatrixWorld(true);
 for(const mesh of windows)assert((mesh.material as THREE.Material).opacity<.05);
 const eye=new THREE.Vector3(...rig.eye),ray=new THREE.Raycaster();
 function hits(target:THREE.Vector3){ray.set(eye,target.clone().sub(eye).normalize());return ray.intersectObject(root,true).filter(h=>{
  const m=(h.object as THREE.Mesh).material as THREE.Material;return !(m.transparent&&m.opacity<.05);
 });}
 for(const angle of [-.15,0,.15])assert.equal(hits(eye.clone().add(new THREE.Vector3(Math.cos(angle)*50,0,Math.sin(angle)*50)))[0],undefined,`${id}: clear road horizon`);
 for(const name of ["imported-mirror-left","imported-mirror-right","imported-rearview-mirror","imported-live-cluster","imported-live-navigation"]){
  const object=root.getObjectByName(name)!;
  assert.equal(hits(object.getWorldPosition(new THREE.Vector3()))[0]?.object.name,name,`${id}: ${name} visible from eye`);
  if(name==="imported-rearview-mirror")for(const u of [-.065,0,.065])for(const v of [-.018,0,.018]){
    const target=object.localToWorld(new THREE.Vector3(u,v,0));
    assert.equal(hits(target)[0]?.object.name,name,`${id}: rear mirror sample ${u}/${v} clear`);
  }
 }
 for(const side of ["left","right"]){
  const mirror=root.getObjectByName(`imported-mirror-${side}`)!;
  const normal=new THREE.Vector3(0,0,1).applyQuaternion(mirror.quaternion);
  const reflected=mirror.position.clone().sub(eye).normalize().reflect(normal);
  assert(reflected.x<-.9&&reflected.z*(side==="left"?-1:1)>0,`${id}: mirror faces rearward and outward`);
  assert(root.getObjectByName(`imported-bsm-${side}`));
  const led=root.getObjectByName(`imported-bsm-${side}`) as THREE.Mesh;
  assert.equal(led.material,bsm[side],`${id}: BSM shares actual event-driven material`);
  assert.equal(hits(led.getWorldPosition(new THREE.Vector3()))[0]?.object.name,led.name,`${id}: BSM visible on mirror`);
 }
 for(const name of ["imported-mirror-left","imported-mirror-right","imported-rearview-mirror"]){
  const mirror=root.getObjectByName(name)!;
  const normal=new THREE.Vector3(0,0,1).applyQuaternion(mirror.quaternion);
  const outgoing=mirror.position.clone().sub(eye).normalize().reflect(normal);
  ray.set(mirror.position.clone().addScaledVector(outgoing,.01),outgoing);
  const hit=ray.intersectObject(root,true).find(h=>{const m=(h.object as THREE.Mesh).material as THREE.Material;return !(m.transparent&&m.opacity<.05);});
  assert.equal(hit,undefined,`${id}: ${name} rearward view blocked by ${hit?.object.name}`);
 }
 for(const yaw of [0,Math.PI/2,Math.PI]){
  const pose=cockpitCameraPose(0,0,yaw,eye.y,0,0,eye,rig.pitch);
  assert(Math.abs(pose.position.length()-eye.length())<1e-10,`${id}: model eye rotates with car`);
 }
 for(const aspect of [16/9,1280/456,1920/760]){
  const camera=new THREE.PerspectiveCamera(cockpitVerticalFov(COCKPIT_RIG.horizontalFov,aspect),aspect,.04,500);
  const pose=cockpitCameraPose(0,0,0,eye.y,0,0,eye,rig.pitch,rig.viewYaw);
  camera.position.copy(pose.position);camera.lookAt(pose.target);camera.updateMatrixWorld(true);
  for(const side of ["left","right"]){
   const lens=root.getObjectByName(`imported-mirror-${side}`)!;
   for(const u of [-.065,.065])for(const v of [-.025,.025]){
    const point=lens.localToWorld(new THREE.Vector3(u,v,0)).project(camera);
    assert(Math.abs(point.x)<.98&&Math.abs(point.y)<.95&&point.z<1,`${id}: ${side} mirror cut off at aspect ${aspect}`);
   }
  }
 }
 setImportedCabinView(root,false);
 windows.forEach((o,i)=>assert.equal(o.material,originals[i],`${id}: 360/exterior restore original glass`));
 assert.equal(root.getObjectByName("imported-cabin-equipment")!.visible,false);
 console.log(`${id}: real interior, steering rig, clear horizon, live displays, mirrors, glass restore PASS`);
}
assert.equal(IMPORTED_CABINS.vf9,undefined);assert.equal(IMPORTED_CABINS.everest,undefined);
console.log("IMPORTED-CABIN PASS");

import assert from "node:assert/strict";
import * as THREE from "three";
import {Scene} from "../src/render/Scene.ts";
import {DrivingMirror,mirrorCameraPose} from "../src/render/DrivingMirror.ts";
import {disposeVehicle} from "../src/render/CockpitGeometry.ts";

// Exercise the actual follow-camera implementation without creating a GPU.
const view=Object.create(Scene.prototype) as Scene;
Object.assign(view,{cameraMode:"chase",projectedCameraMode:null,camera:new THREE.PerspectiveCamera(55,2.5,.1,500),renderer:{domElement:{classList:{toggle:()=>{}}}},key:new THREE.DirectionalLight(),camPos:new THREE.Vector3(),camLook:new THREE.Vector3()});
for(let i=0;i<120;i++){
 const x=i*30/60;view.updateCamera(x,0,0,1/60,30);
 const distance=x-view.camera.position.x;
 assert(distance>=7&&distance<=10,"follow camera must remain close at highway speed instead of accumulating translation lag");
 assert(view.camera.position.y>=2.5&&view.camera.position.y<=4.5,"follow camera remains at driving-game height");
}

let now=1000;const originalPerformance=globalThis.performance;
Object.defineProperty(globalThis,"performance",{value:{now:()=>now},configurable:true});
try{
 for(const yaw of [0,Math.PI/2,-1.2]){
  const host=new THREE.Group();host.position.set(75,0,20);host.rotation.y=-yaw;host.userData.builtKind="ego";host.userData.visualDims={length:4.7,width:2};
  const world=new THREE.Scene();world.add(host);world.updateMatrixWorld(true);
  for(const side of ["left","right","rear"] as const){
   const mirror=new DrivingMirror(.20,.09,`test-${side}`);host.add(mirror);
   const pose=mirrorCameraPose(host,side),forward=new THREE.Vector3(Math.cos(yaw),0,Math.sin(yaw));
   assert(pose.direction.dot(forward)<-.95,`${side}: must view real traffic behind the host`);
   const local=host.worldToLocal(pose.position.clone());
   assert(side==="rear"?local.x<-2.35:Math.abs(local.z)>1,"mirror camera must be outside the body");
   let renders=0,activeTarget:unknown=null,scissorEnabled=true;
   const viewport=new THREE.Vector4(0,0,1280,456),scissor=viewport.clone();
   const renderer={xr:{enabled:true},shadowMap:{autoUpdate:true},getRenderTarget:()=>activeTarget,getViewport:(v:THREE.Vector4)=>v.copy(viewport),getScissor:(v:THREE.Vector4)=>v.copy(scissor),getScissorTest:()=>scissorEnabled,setScissorTest:(v:boolean)=>scissorEnabled=v,setRenderTarget:(v:unknown)=>activeTarget=v,setViewport:()=>{},setScissor:()=>{},clear:()=>{},render:(_world:THREE.Scene,camera:THREE.Camera)=>{
    renders++;assert.equal(mirror.visible,false,"mirror pass cannot recursively render itself");
    assert(camera.getWorldDirection(new THREE.Vector3()).dot(pose.direction)>.999);
   }};
   const draw=()=>mirror.onBeforeRender(renderer as unknown as THREE.WebGLRenderer,world,new THREE.PerspectiveCamera(),mirror.geometry,new THREE.MeshBasicMaterial(),null as unknown as THREE.Group);
   draw();assert.equal(renders,1);assert.equal(activeTarget,null);assert.equal(mirror.visible,true);assert(scissorEnabled&&renderer.xr.enabled&&renderer.shadowMap.autoUpdate);
   now+=10;draw();assert.equal(renders,1,"throttle secondary rendering");now+=35;draw();assert.equal(renders,2,"mirror remains live");
   const camera=mirror.mirrorCamera;camera.updateMatrixWorld(true);
   const actor=pose.position.clone().addScaledVector(pose.direction,25);
   assert(Math.abs(actor.clone().project(camera).x)<.001,"rear actor reaches the mirror's centre");
   const shifted=actor.clone().add(new THREE.Vector3(0,0,1).applyQuaternion(host.quaternion));
   assert(Math.abs(shifted.project(camera).x)>.02,"moving traffic changes its image position");
   assert.equal(mirror.getRenderTarget().texture.repeat.x,-1,"mirror image is horizontally reflected");
   let disposed=false;mirror.getRenderTarget().addEventListener("dispose",()=>disposed=true);disposeVehicle(mirror);assert(disposed);mirror.removeFromParent();
  }
 }
}finally{Object.defineProperty(globalThis,"performance",{value:originalPerformance,configurable:true});}
console.log("VIEW-QUALITY PASS — close follow at speed, real rear/side views, moving actors, render-state restoration and mirror disposal.");

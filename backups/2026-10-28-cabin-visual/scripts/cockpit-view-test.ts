import assert from "node:assert/strict";
import * as THREE from "three";
import { createCarInterior } from "../src/render/CarInterior.ts";
import { COCKPIT_RIG, cockpitCameraPose, cockpitVerticalFov } from "../src/render/CockpitRig.ts";
import { disposeVehicle } from "../src/render/CockpitGeometry.ts";
import { Scene, type SurroundView } from "../src/render/Scene.ts";

const cabin = createCarInterior({
  bodyMaterial: new THREE.MeshStandardMaterial(),
  blindSpotMaterials: { left: new THREE.MeshStandardMaterial(), right: new THREE.MeshStandardMaterial() },
  makeMirror: (width, height, name) => { const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial()); mesh.name=name; return mesh; },
  canvasFactory: () => ({getContext:()=>null}) as unknown as HTMLCanvasElement,
});
cabin.group.visible = true; cabin.group.updateMatrixWorld(true);
const eye = COCKPIT_RIG.eye;
const ray = new THREE.Raycaster();
function firstOpaqueHit(target: THREE.Vector3): string | undefined {
  ray.set(eye,target.clone().sub(eye).normalize());
  return ray.intersectObject(cabin.group,true).find(hit => {
    const material=(hit.object as THREE.Mesh).material;
    return !Array.isArray(material) && !(material.transparent && material.opacity < .05);
  })?.object.name;
}
for(const child of cabin.wheelSpin.children) child.name = "steering-wheel-part";
// A mesh may be correctly sized yet buried inside the dashboard. Cast actual
// eye-to-screen rays through the complete assembled interior to catch that bug.
for (const [name, centre, width, height] of [
  ["instrument-screen",COCKPIT_RIG.cluster,.55,.205],
  ["infotainment-screen",COCKPIT_RIG.infotainment,.42,.255],
] as const) {
  for (const y of [-.8,0,.8]) for (const z of [-.8,0,.8]) {
    const sample=centre.clone().add(new THREE.Vector3(0,y*height/2,z*width/2));
    const hit=firstOpaqueHit(sample);
    const rimAtLowerEdge=name==="instrument-screen" && y<0 && hit==="steering-wheel-part";
    assert(hit===name || rimAtLowerEdge,`${name} sample ${y}/${z} is hidden by ${hit}`);
  }
}
for(const side of ["left","right"]) {
  const lens=cabin.group.getObjectByName(`cabin-mirror-${side}`)!;
  assert.equal(firstOpaqueHit(lens.getWorldPosition(new THREE.Vector3())),lens.name,`${side} mirror must be visible from driver seat`);
  assert(cabin.group.getObjectByName(`${side}-blind-spot-led`),"BSM lamp must be attached to each mirror");
  const led=cabin.group.getObjectByName(`${side}-blind-spot-led`)!;
  assert.equal(firstOpaqueHit(led.localToWorld(new THREE.Vector3(0,.017,0))),led.name,`${side} BSM lamp must not be buried in mirror housing`);
}
for(const heading of [-12,0,12]) {
  const angle=THREE.MathUtils.degToRad(heading);
  const target=eye.clone().add(new THREE.Vector3(Math.cos(angle),0,Math.sin(angle)).multiplyScalar(100));
  assert.equal(firstOpaqueHit(target),undefined,"central forward horizon must remain clear of opaque cabin parts");
}
for(const angle of [.05,.6,1.15]) {
  for(const wiper of cabin.wipers) {
    wiper.rotation.z=angle;cabin.group.updateMatrixWorld(true);
    wiper.traverse(child=>{
      if(!(child instanceof THREE.Mesh))return;
      const positions=child.geometry.getAttribute("position");
      for(let index=0;index<positions.count;index++) {
        const point=child.localToWorld(new THREE.Vector3().fromBufferAttribute(positions,index));
        const distance=Math.abs((point.x-1.18)*.62+(point.y-.97)*.69)/Math.hypot(.62,.69);
        assert(distance<.035,"wipers must sweep along the sloped glass instead of rotating through it");
      }
    });
  }
}
for(const aspect of [16/9,1280/(720-148),1920/(1080-148),3440/(1440-148)]) {
  const camera=new THREE.PerspectiveCamera(cockpitVerticalFov(96,aspect),aspect,.04,1000);
  const horizontal=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*aspect));
  assert(Math.abs(horizontal-96)<1e-9,"wide windows must preserve horizontal FOV instead of stretching the cabin");
}
for(const yaw of [0,Math.PI/2,Math.PI,-1.4]) {
  const pose=cockpitCameraPose(150,60,yaw,eye.y);
  const forward=new THREE.Vector3(Math.cos(yaw),0,Math.sin(yaw));
  const right=new THREE.Vector3(-Math.sin(yaw),0,Math.cos(yaw));
  const offset=pose.position.clone().sub(new THREE.Vector3(150,eye.y,60));
  assert(Math.abs(offset.dot(forward)-eye.x)<1e-10);
  assert(Math.abs(offset.dot(right)-eye.z)<1e-10,"driver eye must remain on left seat in every heading");
}
const steeringRoot=cabin.wheelSpin.parent!;
const columnTilt=steeringRoot.quaternion.clone();
cabin.wheelSpin.rotation.x=2.4;cabin.group.updateMatrixWorld(true);
assert(steeringRoot.quaternion.angleTo(columnTilt)<1e-9,"steering input must rotate spokes without rotating column tilt");
const windscreen=cabin.group.getObjectByName("sloped-windscreen")!;
assert(windscreen && cabin.group.getObjectByName("left-door-panel") && cabin.group.getObjectByName("roof-headliner"));

// Exercise the real surround-camera positioning without initializing a GPU.
Object.defineProperty(globalThis,"window",{value:{innerWidth:1280},configurable:true});
const scene=Object.create(Scene.prototype) as Scene;
const surroundCamera=new THREE.PerspectiveCamera();
Object.assign(scene,{
  surroundCamera,scene:new THREE.Scene(),
  renderer:{domElement:{clientHeight:800},setScissorTest:()=>{},setScissor:()=>{},setViewport:()=>{},render:()=>{}},
});
const viewport={getBoundingClientRect:()=>({left:1000,bottom:780,width:230,height:134})} as HTMLElement;
for(const yaw of [0,Math.PI/2,-1.2]) {
  const forward=new THREE.Vector3(Math.cos(yaw),0,Math.sin(yaw));
  const right=new THREE.Vector3(-Math.sin(yaw),0,Math.cos(yaw));
  for(const [view,direction] of [["front",forward],["rear",forward.clone().negate()],["left",right.clone().negate()],["right",right]] as [SurroundView,THREE.Vector3][]) {
    scene.renderSurroundView(viewport,10,20,yaw,view);
    assert(surroundCamera.getWorldDirection(new THREE.Vector3()).dot(direction)>.99,`${view} camera must face its labelled direction`);
    assert(surroundCamera.position.clone().sub(new THREE.Vector3(10,0,20)).dot(direction)>.9,`${view} camera must be mounted on the correct side`);
  }
}
disposeVehicle(cabin.group);
console.log("COCKPIT-VIEW PASS — screen/mirror/BSM visibility, clear horizon, wide-screen FOV, driver anchoring, steering axis and all four surround-camera directions. Geometry verification is not visual approval.");

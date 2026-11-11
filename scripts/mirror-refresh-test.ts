import assert from 'node:assert/strict';
import * as THREE from 'three';
import {DrivingMirror} from '../src/render/DrivingMirror.ts';

const originalPerformance=Object.getOwnPropertyDescriptor(globalThis,'performance');
let now=0;
Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>now}});
try{
 for(const interval of [100,250,16.667]){
  const scene=new THREE.Scene(),host=new THREE.Group();host.userData.builtKind='ego';scene.add(host);
  const views=['left','right','rear'].map(side=>new DrivingMirror(.3,.15,side));host.add(...views);scene.updateMatrixWorld(true);
  const camera=new THREE.PerspectiveCamera();camera.userData.staggerMirrors=true;
  const renders=new Map(views.map(view=>[view.mirrorCamera,0]));let target:THREE.WebGLRenderTarget|null=null,scissorTest=true;
  const renderer={xr:{enabled:false},shadowMap:{autoUpdate:true},getRenderTarget:()=>target,
   getViewport:(v:THREE.Vector4)=>v.set(2,3,800,600),getScissor:(v:THREE.Vector4)=>v.set(4,5,700,500),getScissorTest:()=>scissorTest,
   setScissorTest:(v:boolean)=>{scissorTest=v;},setRenderTarget:(v:THREE.WebGLRenderTarget|null)=>{target=v;},
   setViewport:()=>{},setScissor:()=>{},clear:()=>{},render:(_s:THREE.Scene,c:THREE.PerspectiveCamera)=>{renders.set(c,(renders.get(c)??0)+1);}} as unknown as THREE.WebGLRenderer;
  function frame(active=views){
   now+=interval;DrivingMirror.beginMainPass();const before=[...renders.values()].reduce((a,b)=>a+b,0);
   for(const view of active)view.onBeforeRender(renderer,scene,camera,view.geometry,view.material as THREE.Material,null as never);
   const after=[...renders.values()].reduce((a,b)=>a+b,0);
   assert(after-before<=1,'Mirror staggering multiplied scene passes');
   assert.equal(target,null);assert.equal(renderer.shadowMap.autoUpdate,true);assert.equal(scissorTest,true);
  }
  for(let i=0;i<18;i++)frame();
  for(const view of views)assert((renders.get(view.mirrorCamera)??0)>=3,`${interval}ms: ${view.side} mirror starved in fixed draw order`);
  const before=renders.get(views[2].mirrorCamera)!;
  // The other mirrors remain visible=true but are outside the camera frustum:
  // their callbacks no longer run and must not reserve rendering forever.
  for(let i=0;i<12;i++)frame([views[2]]);
  assert(renders.get(views[2].mirrorCamera)!>before+2,'Off-screen mirrors blocked the only visible reflection');
  const skipped=[...renders.values()].reduce((a,b)=>a+b,0);camera.userData.skipMirrorPass=true;
  for(let i=0;i<3;i++)frame();
  assert.equal([...renders.values()].reduce((a,b)=>a+b,0),skipped,'Surround/exterior camera rendered recursive mirrors');
  for(const view of views){view.userData.disposeRenderTarget();view.geometry.dispose();(view.material as THREE.Material).dispose();}
 }
 console.log('MIRROR REFRESH PASS — all three reflections at 4/10/60 FPS, single-pass budget, off-frustum recovery and no recursive surround pass.');
}finally{
 if(originalPerformance)Object.defineProperty(globalThis,'performance',originalPerformance);else Reflect.deleteProperty(globalThis,'performance');
}

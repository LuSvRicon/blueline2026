import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Scene} from '../src/render/Scene.ts';
import {DrivingMirror} from '../src/render/DrivingMirror.ts';
import {disposeVehicle} from '../src/render/CockpitGeometry.ts';

// Exercise the real surround render/copy code against the renderer API. In a
// short window the inset can exceed the remaining main WebGL viewport.
for(const ratio of [.8,1.25,2])for(const mainHeight of [160,480]){
 const scene=Object.create(Scene.prototype) as Scene;
 const originalTarget={name:'previous target'},oldViewport=new THREE.Vector4(3,4,300,150),oldScissor=new THREE.Vector4(5,6,100,90);
 let target:unknown=originalTarget,viewport=oldViewport.clone(),scissor=oldScissor.clone(),scissorTest=true,rendered=false,copied=false;
 const canvas={width:Math.round(500*ratio),height:Math.round(mainHeight*ratio),clientWidth:500,clientHeight:mainHeight};
 const renderer={domElement:canvas,getPixelRatio:()=>ratio,getRenderTarget:()=>target,setRenderTarget:(value:unknown)=>target=value,
  getViewport:(v:THREE.Vector4)=>v.copy(viewport),getScissor:(v:THREE.Vector4)=>v.copy(scissor),getScissorTest:()=>scissorTest,
  setViewport:(x:number|THREE.Vector4,y?:number,w?:number,h?:number)=>{viewport=x instanceof THREE.Vector4?x.clone():new THREE.Vector4(x,y,w,h);},
  setScissor:(x:number|THREE.Vector4,y?:number,w?:number,h?:number)=>{scissor=x instanceof THREE.Vector4?x.clone():new THREE.Vector4(x,y,w,h);},
  setScissorTest:(value:boolean)=>scissorTest=value,
  render:()=>{rendered=true;assert.equal(target,null,'surround must draw into the main canvas rather than a stale render target');},
 };
 Object.assign(scene,{renderer,scene:new THREE.Scene(),surroundCamera:new THREE.PerspectiveCamera()});
 const surface={width:360,height:210,getBoundingClientRect:()=>({width:360,height:210}),getContext:()=>({clearRect:()=>{},drawImage:(_canvas:unknown,x:number,y:number,w:number,h:number)=>{
  copied=true;assert(x>=0&&y>=0,'camera source crop extends above the physical canvas');
  assert(x+w<=canvas.width+.01&&y+h<=canvas.height+.01,'camera source crop extends outside the physical canvas');
  assert(Math.abs(w/h-360/210)<.001,'surround image is stretched by clipping only one dimension');
 }})} as unknown as HTMLCanvasElement;
 scene.renderSurroundView(surface,0,0,0,'360');
 assert(rendered&&copied);assert.equal(target,originalTarget);assert.deepEqual(viewport,oldViewport);assert.deepEqual(scissor,oldScissor);assert(scissorTest);
 renderer.render=()=>{throw new Error('simulated secondary render failure');};
 assert.throws(()=>scene.renderSurroundView(surface,0,0,0,'rear'),/simulated secondary/);
 assert.equal(target,originalTarget,'failed camera render leaked render target');assert.deepEqual(viewport,oldViewport);assert.deepEqual(scissor,oldScissor);assert(scissorTest);
}

// Mirror rendering must restore ALL lenses and state when a nested render
// fails, then be able to retry rather than leaving a permanently black mirror.
{
 const world=new THREE.Scene(),host=new THREE.Group();host.userData.builtKind='ego';world.add(host);
 const lenses=['left','right','rear'].map(side=>new DrivingMirror(.2,.09,`runtime-${side}`));host.add(...lenses);lenses[1].visible=false;
 let target:unknown={name:'postprocessing target'},scissorTest=true,xr=true,shadows=true,renders=0;
 const initialTarget=target,oldViewport=new THREE.Vector4(1,2,300,200),oldScissor=new THREE.Vector4(2,3,90,70);
 let viewport=oldViewport.clone(),scissor=oldScissor.clone(),fail=true;
 const renderer={getRenderTarget:()=>target,setRenderTarget:(value:unknown)=>target=value,
  getViewport:(v:THREE.Vector4)=>v.copy(viewport),getScissor:(v:THREE.Vector4)=>v.copy(scissor),getScissorTest:()=>scissorTest,
  setViewport:(v:THREE.Vector4)=>viewport=v.clone(),setScissor:(v:THREE.Vector4)=>scissor=v.clone(),setScissorTest:(value:boolean)=>scissorTest=value,
  xr:{get enabled(){return xr;},set enabled(value:boolean){xr=value;}},
  shadowMap:{get autoUpdate(){return shadows;},set autoUpdate(value:boolean){shadows=value;}},clear:()=>{},
  render:()=>{renders++;assert(lenses.every(l=>!l.visible),'mirror render recursed into a visible lens');if(fail)throw new Error('mirror failure');},
 } as unknown as THREE.WebGLRenderer;
 const draw=()=>lenses[0].onBeforeRender(renderer,world,new THREE.PerspectiveCamera(),lenses[0].geometry,new THREE.MeshBasicMaterial(),null as unknown as THREE.Group);
 assert.throws(draw,/mirror failure/);
 assert.equal(target,initialTarget);assert.deepEqual(viewport,oldViewport);assert.deepEqual(scissor,oldScissor);
 assert(scissorTest&&xr&&shadows);assert.deepEqual(lenses.map(l=>l.visible),[true,false,true]);
 fail=false;draw();assert.equal(renders,2,'failed mirror update incorrectly throttled the retry');
 assert.equal(target,initialTarget);assert.deepEqual(lenses.map(l=>l.visible),[true,false,true]);
 disposeVehicle(host);
}
console.log('RENDER-RUNTIME PASS — short viewport/DPR crops fit canvas, preserve aspect, and surround/mirrors restore GPU state after successful/failed secondary rendering.');

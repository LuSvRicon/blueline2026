import assert from "node:assert/strict";
import type { Scene } from "../src/render/Scene.ts";
import { CabinLookControls } from "../src/ui/CabinLookControls.ts";

class ElementStub extends EventTarget {
  isContentEditable=false;style={display:"none"};type="text";
  constructor(public tagName="DIV"){super();}
}
class CanvasStub extends ElementStub {
  classes=new Set<string>();
  classList={add:(name:string)=>this.classes.add(name),remove:(name:string)=>this.classes.delete(name)};
  setPointerCapture(_id:number):void{}
}
const win=new EventTarget(),menu=new ElementStub(),canvas=new CanvasStub();
Object.defineProperties(globalThis,{
  window:{value:win,configurable:true},HTMLElement:{value:ElementStub,configurable:true},
  document:{value:{getElementById:(id:string)=>id==="intro"?menu:null},configurable:true},
});
let view:[number,number]=[0,0],paused=false;
const scene={cameraMode:"cockpit",setCabinLook:(yaw:number,pitch=0)=>{view=[yaw,pitch];}};
const controls=new CabinLookControls(canvas as unknown as HTMLCanvasElement,scene as unknown as Scene,()=>paused);
function key(type:string,code:string,target?:ElementStub):void {
  const event=new Event(type,{cancelable:true});Object.defineProperty(event,"code",{value:code});
  if(target)Object.defineProperty(event,"target",{value:target});win.dispatchEvent(event);
}
function pointer(type:string,x:number,y:number,button=2):void {
  const event=new Event(type,{cancelable:true});
  for(const [name,value] of Object.entries({pointerId:7,clientX:x,clientY:y,button}))Object.defineProperty(event,name,{value});
  canvas.dispatchEvent(event);
}
controls.update();key("keydown","Numpad4");assert(view[0]<0);key("keyup","Numpad4");assert.deepEqual(view,[0,0]);
key("keydown","Numpad6");key("keydown","Numpad8");assert(view[0]>0&&view[1]>0);key("keydown","Numpad5");assert.deepEqual(view,[0,0]);
pointer("pointerdown",100,100);pointer("pointermove",170,80);assert(view[0]>0&&view[1]>0,"right drag must look right/up");
pointer("pointerup",170,80);assert.deepEqual(view,[0,0]);assert(!canvas.classes.has("cabin-looking"));
key("keydown","Numpad4",new ElementStub("SELECT"));assert.deepEqual(view,[0,0],"settings retain keyboard input");
key("keydown","Numpad4");paused=true;controls.update();assert.deepEqual(view,[0,0],"pause releases the glance");paused=false;controls.update();
menu.style.display="flex";key("keydown","Numpad6");assert.deepEqual(view,[0,0]);menu.style.display="none";
key("keydown","Numpad4");win.dispatchEvent(new Event("blur"));assert.deepEqual(view,[0,0]);
scene.cameraMode="chase";controls.update();pointer("pointerdown",100,100);pointer("pointermove",200,200);assert.deepEqual(view,[0,0],"other cameras retain their own pointer controls");
console.log("CABIN-LOOK PASS — held glances, right-drag directions, recenter, form focus, pause/menu/blur and camera isolation.");

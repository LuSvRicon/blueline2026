import assert from 'node:assert/strict';
import {TouchSteering} from '../src/ui/TouchSteering.ts';
import {DriveControls} from '../src/ui/DriveControls.ts';
import {Simulation} from '../src/sim/Simulation.ts';

// Exercise production event handlers and DriveControls together. Pointer
// capture here is a fixture; real hardware multi-touch still needs device QA.
class ElementStub extends EventTarget {
  tagName='BUTTON';type='button';isContentEditable=false;disabled=false;
  dataset:Record<string,string>={};style={display:'none',setProperty:()=>{}};
  attrs=new Map<string,string>();captured=new Set<number>();classes=new Set<string>();
  classList={add:(s:string)=>this.classes.add(s),remove:(s:string)=>this.classes.delete(s)};
  insertAdjacentHTML(){} setAttribute(k:string,v:string){this.attrs.set(k,v);}
  focus(){doc.activeElement=this;} getBoundingClientRect(){return {width:160};}
  setPointerCapture(id:number){this.captured.add(id);} hasPointerCapture(id:number){return this.captured.has(id);}
  releasePointerCapture(id:number){this.captured.delete(id);}
  querySelector(){return this;} querySelectorAll(){return modes;}
}
const pad=new ElementStub(),root=new ElementStub(),intro=new ElementStub();
const modes=['buttons','drag'].map(mode=>{const e=new ElementStub();e.dataset.steeringMode=mode;return e;});
const doc=Object.assign(new EventTarget(),{hidden:false,activeElement:null as ElementStub|null,getElementById:(id:string)=>id==='intro'?intro:id==='ui'?root:pad});
const storage=new Map<string,string>();
Object.defineProperties(globalThis,{
  window:{value:new EventTarget(),configurable:true},document:{value:doc,configurable:true},HTMLElement:{value:ElementStub,configurable:true},
  navigator:{value:{getGamepads:()=>[]},configurable:true},
  localStorage:{value:{getItem:(k:string)=>storage.get(k),setItem:(k:string,v:string)=>storage.set(k,v)},configurable:true},
});
const sim=new Simulation({trafficCount:0});sim.setControlMode('manual');sim.ego.v=0;
const controls=new DriveControls(sim),widget=new TouchSteering(root as unknown as HTMLElement,controls);
const point=(type:string,pointerId:number,clientX:number)=>{const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId,clientX,button:0});pad.dispatchEvent(e);};
const step=(frames=60)=>{for(let n=0;n<frames;n++)controls.update(1/60);widget.update(sim.telemetry);};
modes[1].dispatchEvent(new Event('click'));
assert.equal(root.dataset.steeringInput,'drag');assert.equal(modes[1].attrs.get('aria-pressed'),'true');
controls.setPedalInputs(1,0);point('pointerdown',1,100);point('pointermove',1,130);step();
assert(sim.driverInput.steer>.45&&sim.driverInput.steer<.55,'drag must provide proportional, positive steering');
assert.equal(sim.driverInput.throttle,1,'steering must preserve an independent accelerator finger');
point('pointerdown',2,10);point('pointermove',2,-100);point('pointerup',2,-100);step();
assert(sim.driverInput.steer>.45,'a second finger must not hijack the steering contact');
point('pointerup',1,130);step();assert.equal(sim.driverInput.steer,0);assert.equal(sim.driverInput.throttle,1);
assert.equal(pad.captured.size,0);

point('pointerdown',3,5);step();assert.equal(sim.driverInput.steer,0,'starting near an edge must not jump the steering');
point('pointermove',3,-500);step();assert(sim.driverInput.steer<-.99&&sim.driverInput.steer>=-1);
point('pointercancel',3,-500);step();assert.equal(sim.driverInput.steer,0);

point('pointerdown',4,40);point('pointermove',4,100);step();controls.clear();
point('pointermove',4,110);step();assert.equal(sim.driverInput.steer,0,'old motion must not restore steering after a reset');
point('pointerdown',5,40);point('pointermove',5,100);step();sim.paused=true;widget.update(sim.telemetry);sim.paused=false;step();
assert.equal(sim.driverInput.steer,0);assert.equal(pad.captured.size,0);

point('pointerdown',6,40);point('pointermove',6,100);step();modes[0].dispatchEvent(new Event('click'));step();
assert.equal(root.dataset.steeringInput,'buttons');assert.equal(sim.driverInput.steer,0);assert.equal(pad.captured.size,0);
point('pointermove',6,-100);step();assert.equal(sim.driverInput.steer,0);
modes[1].dispatchEvent(new Event('click'));point('pointerdown',7,40);point('pointermove',7,-20);step();
assert(sim.driverInput.steer<-.9);point('lostpointercapture',7,-20);step();assert.equal(sim.driverInput.steer,0);
// A settings sheet owns input without pausing the running simulation.
root.dataset.drawerOpen='true';
const key=new Event('keydown',{cancelable:true});Object.assign(key,{code:'KeyW'});
window.dispatchEvent(key);step();assert.equal(sim.driverInput.throttle,0);assert.equal(controls.canDrive,false);assert.equal(sim.paused,false);
root.dataset.drawerOpen='false';step();assert.equal(controls.canDrive,true);assert.equal(sim.driverInput.throttle,0);
controls.dispose();
console.log('TOUCH-STEERING PASS — proportional drag, relative origin, clamp, independent throttle, pointer ownership, release/cancel, reset, pause and input-mode changes.');

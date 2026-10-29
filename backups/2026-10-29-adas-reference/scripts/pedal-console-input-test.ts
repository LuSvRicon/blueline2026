import assert from 'node:assert/strict';
import {DriveControls} from '../src/ui/DriveControls.ts';
import {PedalControls} from '../src/ui/PedalControls.ts';
import {CenterConsoleControls} from '../src/ui/CenterConsoleControls.ts';
import {Simulation} from '../src/sim/Simulation.ts';

// DOM event fixtures exercise the actual component handlers. They do not claim
// to emulate physical touch hardware or browser pointer-capture implementation.
const elements=new Map<string,ElementStub>();
const doc=Object.assign(new EventTarget(),{hidden:false,activeElement:null as ElementStub|null,getElementById:(id:string)=>elements.get(id)??null});
class ElementStub extends EventTarget {
 tagName='BUTTON';type='button';isContentEditable=false;disabled=false;textContent='';
 dataset:Record<string,string>={};style={display:'none',width:'',left:'',setProperty:()=>{}};
 parentElement:ElementStub|null=null;
 private classes=new Set<string>();
 classList={toggle:(name:string,on?:boolean)=>{const add=on??!this.classes.has(name);if(add)this.classes.add(name);else this.classes.delete(name);return add;},add:(name:string)=>this.classes.add(name)};
 constructor(public id=''){super();if(id)elements.set(id,this);}
 setAttribute(){} setPointerCapture(){} insertAdjacentHTML(){}
 focus(){doc.activeElement=this;}
 querySelector(selector:string){if(selector==='.brake-meter-user')return userFill;if(selector==='.brake-meter-adas')return adasFill;return null;}
 querySelectorAll(selector:string){return selector==='.gear-select'?gearButtons:[];}
}
const ids=['intro','pedal-accelerator','pedal-brake','pedal-brake-caption','steer-left','steer-right','steering-value','pedal-brake-value',
 'console-state','console-alert','console-engine','console-epb','console-engine-state','console-engine-label','console-epb-label'];
for(const id of ids)new ElementStub(id);
const userFill=new ElementStub(),adasFill=new ElementStub(),root=new ElementStub();
const gearButtons=['P','R','N','D'].map(gear=>{const button=new ElementStub();button.dataset.gear=gear;return button;});
const win=Object.assign(new EventTarget(),{clearTimeout,setTimeout});
Object.defineProperties(globalThis,{
 window:{value:win,configurable:true},document:{value:doc,configurable:true},HTMLElement:{value:ElementStub,configurable:true},
 navigator:{value:{getGamepads:()=>[]},configurable:true},
});
const sim=new Simulation({trafficCount:0});sim.setControlMode('manual');sim.traffic.clear();sim.pedestrians.clear();
const controls=new DriveControls(sim),pedals=new PedalControls(root as unknown as HTMLElement,controls);
const consoleControls=new CenterConsoleControls(root as unknown as HTMLElement,sim);
const step=()=>controls.update(1/60);
const point=(id:string,type:string,pointerId:number)=>{const e=new Event(type,{cancelable:true});Object.defineProperty(e,'pointerId',{value:pointerId});elements.get(id)!.dispatchEvent(e);};
const click=(element:ElementStub)=>element.dispatchEvent(new Event('click'));

doc.activeElement=new ElementStub();doc.activeElement.tagName='SELECT';step();
point('pedal-accelerator','pointerdown',1);step();
assert.equal(doc.activeElement,elements.get('pedal-accelerator'),'pedal failed to leave the focused settings input');
assert.equal(sim.driverInput.throttle,1);
point('pedal-accelerator','pointerdown',2);point('pedal-accelerator','pointerup',1);step();
assert.equal(sim.driverInput.throttle,1,'lifting one finger released another held accelerator contact');
point('pedal-brake','pointerdown',3);step();assert.equal(sim.driverInput.brake,1);
point('pedal-accelerator','pointercancel',2);step();
assert.equal(sim.driverInput.throttle,0);assert.equal(sim.driverInput.brake,1,'accelerator release cleared the independently held brake');
point('pedal-brake','lostpointercapture',3);step();assert.equal(sim.driverInput.brake,0);

point('steer-left','pointerdown',4);point('steer-left','pointerdown',5);point('steer-left','pointerup',4);step();
assert(sim.driverInput.steer<0,'lifting one steering finger cleared another left hold');
point('steer-right','pointerdown',6);for(let i=0;i<90;i++)step();
assert.equal(sim.driverInput.steer,0,'opposite held steering buttons must cancel');
point('steer-right','pointercancel',6);step();assert(sim.driverInput.steer<0,'remaining left hold was lost');
point('steer-left','pointerup',5);for(let i=0;i<90;i++)step();assert.equal(sim.driverInput.steer,0);

point('pedal-accelerator','pointerdown',7);step();controls.clear();
// Before the next render/update, a fresh brake press must not resurrect the
// stale throttle cached inside PedalControls.
point('pedal-brake','pointerdown',8);step();
assert.equal(sim.driverInput.throttle,0,'a fresh brake after reset restored stale cached throttle');assert.equal(sim.driverInput.brake,1);
point('pedal-brake','pointerup',8);point('pedal-accelerator','pointerup',7);step();
pedals.update(sim.telemetry);

sim.startRecording();sim.step(1/60);sim.stopRecording();assert(sim.startReplay());consoleControls.update();
assert(gearButtons.every(button=>button.disabled),'PRND was enabled during replay');
assert(elements.get('console-engine')!.disabled&&elements.get('console-epb')!.disabled,'ignition/EPB enabled during replay');
const before={gear:sim.gear,engine:sim.engineOn,epb:sim.epbEngaged};
click(gearButtons[0]);click(elements.get('console-engine')!);click(elements.get('console-epb')!);
assert.deepEqual({gear:sim.gear,engine:sim.engineOn,epb:sim.epbEngaged},before,'queued control click modified replay state');
sim.stopReplay();consoleControls.update();assert(gearButtons.every(button=>!button.disabled));
controls.dispose();
console.log('PEDAL-CONSOLE-INPUT PASS — form-to-pedal focus, multi-pointer cancellation, independent pedals, reset revisions and replay PRND/ignition/EPB guards.');

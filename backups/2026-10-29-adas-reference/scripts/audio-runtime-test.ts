import assert from 'node:assert/strict';
import {SimulationAudio} from '../src/audio/SimulationAudio.ts';
import {Simulation} from '../src/sim/Simulation.ts';

// Web Audio contract test: output gain and clock synchronization. This does
// not evaluate the acoustic quality of a speaker or synthesized engine sound.
class Param {
 value=0; targets:number[]=[];
 setTargetAtTime(value:number){this.value=value;this.targets.push(value);}
 setValueAtTime(value:number){this.value=value;}
 exponentialRampToValueAtTime(value:number){this.value=value;}
}
class Node {
 gain=new Param();frequency=new Param();Q=new Param();pan=new Param();
 connect(other:unknown){return other as Node;}
 start(){} stop(){}
}
class Context {
 currentTime=100;sampleRate=32;destination=new Node();
 createGain(){return new Node();}createOscillator(){return new Node();}
 createBiquadFilter(){return new Node();}createBufferSource(){return new Node();}
 createStereoPanner(){return new Node();}
 createBuffer(_channels:number,n:number){return{getChannelData:()=>new Float32Array(n)};}
 async resume(){}
}
Object.assign(globalThis,{window:{AudioContext:Context},AudioContext:Context});
const audio=new SimulationAudio();audio.setVolume(.23);await audio.setEnabled(true);
const internals=audio as any;
assert.equal(internals.master.gain.value,.23,'volume selected before enabling was discarded');
await audio.setEnabled(false);audio.setVolume(.9);
assert.equal(internals.master.gain.value,0,'moving volume slider unmuted disabled audio');
await audio.setEnabled(true);assert.equal(internals.master.gain.value,.9,'enable did not restore selected volume');
audio.setVolume(NaN);assert.equal(internals.master.gain.value,.9,'non-finite gain reached the audio graph');
const sim=new Simulation({trafficCount:0});sim.setControlMode('manual');
sim.traffic.clear();sim.pedestrians.clear();sim.indicator=-1;
let ticks=0;internals.playTick=()=>ticks++;
for(const time of [0,.1,.38]){sim.metrics.time=time;audio.update(sim);}
assert.equal(ticks,1,'initial relay phase generated duplicate clicks');
sim.metrics.time=.39;audio.update(sim);assert.equal(ticks,2,'visual relay edge did not produce a tick');
internals.context.currentTime+=10;audio.update(sim);assert.equal(ticks,2,'audio clock drifted while simulation time was unchanged');
sim.paused=true;audio.update(sim);sim.paused=false;audio.update(sim);assert.equal(ticks,3,'relay did not resynchronize after pause');
sim.indicator=1;audio.update(sim);assert.equal(ticks,4,'changing signal side lost its relay feedback');
let finishResume!:()=>void;
internals.context.resume=()=>new Promise<void>(resolve=>{finishResume=resolve;});
const pendingEnable=audio.setEnabled(true);
await audio.setEnabled(false);finishResume();await pendingEnable;
assert.equal(audio.enabled,false,'stale asynchronous enable overrode the later mute request');
assert.equal(internals.master.gain.value,0,'stale asynchronous enable restored audible output');
// Autoplay succeeds on allowed browsers; blocked autoplay waits for a gesture
// without claiming that a suspended AudioContext is already producing sound.
const entryDoc=new EventTarget();Object.assign(globalThis,{document:entryDoc});
class EntryContext extends Context {
 state='suspended';allow=false;
 async resume(){if(this.allow)this.state='running';}
}
Object.assign(globalThis,{window:{AudioContext:EntryContext},AudioContext:EntryContext});
const entry=new SimulationAudio();entry.startOnEntry();
await Promise.resolve();await Promise.resolve();
assert.equal(entry.enabled,false,'blocked autoplay was reported as enabled');
const entryInternals=entry as any;entryInternals.context.allow=true;
entryDoc.dispatchEvent(new Event('pointerdown'));await Promise.resolve();await Promise.resolve();
assert.equal(entry.enabled,true,'first gesture failed to unlock startup audio');
assert.equal(entryInternals.master.gain.value,1,'startup audio did not use 100% volume');
await entry.setEnabled(false);entryDoc.dispatchEvent(new Event('keydown'));await Promise.resolve();
assert.equal(entry.enabled,false,'startup retry undid an explicit mute');
console.log('AUDIO-RUNTIME PASS — disabled gain, saved volume, non-finite input and simulation-clock relay synchronization.');

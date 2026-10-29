import assert from 'node:assert/strict';
import {ADASController} from '../src/sim/ADAS.ts';
import {Vehicle} from '../src/vehicle/Vehicle.ts';
import {ReferencePath} from '../src/world/ReferencePath.ts';
import {Road} from '../src/world/Road.ts';
import {TRACKS} from '../src/world/track.ts';
const dt=1/60;
for(const id of ['city','neighborhood'] as const)for(const kph of [100,120,140])for(const mu of [1,.72]){
 const track=TRACKS.find(t=>t.id===id)!,path=new ReferencePath(track.controlPoints,6),road=new Road(path,track.road?.lanes??3,track.road?.laneWidth??3.7,track.road);
 const center=road.laneCenter(Math.min(1,road.numLanes-1)),p=path.toCartesian(150,center);
 const ego=new Vehicle(p.x,p.y,p.heading,kph/3.6,undefined,{maxSpeed:42});ego.surfaceMu=mu;ego.limitLateralGrip=true;
 const adas=new ADASController();let error=0,saturated=false,maxBrake=0;
 for(let t=0;t<65;t+=dt){
  const f=path.toFrenet(ego.x,ego.y);error=Math.max(error,Math.abs(f.d-center));
  const out=adas.update({ego,egoS:f.s,egoD:f.d,path,road,obstacles:[],desiredSpeed:kph/3.6,input:{steer:0,throttle:0,brake:0},dt,speedControl:e=>e});
  assert(!out.status.aeb,'curve braking was mislabeled as collision AEB');
  maxBrake=Math.max(maxBrake,-out.accel);ego.step(out.steer,out.accel,dt);saturated ||= ego.tractionLimited;
 }
 assert(error<.35,`${id}/${kph}/${mu}: ACC joined too fast and left lane: ${error}`);
 assert(!saturated,`${id}/${kph}/${mu}: preview failed to reserve tyre grip`);
 console.log(`${id}/${kph}km/h/mu=${mu}: max offset=${error.toFixed(3)}m, max requested decel=${maxBrake.toFixed(2)}m/s²`);
}
{
 const track=TRACKS.find(t=>t.id==='city')!,path=new ReferencePath(track.controlPoints,6),road=new Road(path);
 // Find a straight immediately before a tight curve, without placing the car
 // inside an already physically impossible turn.
 let station:number|undefined;
 for(let s=0;s<path.length;s+=2)if(path.curvatureAt(s)<.001&&path.maxCurvatureAhead(s,50)>.025){station=s;break;}
 assert(station!==undefined);const p=path.toCartesian(station,road.laneCenter(1)),ego=new Vehicle(p.x,p.y,p.heading,38.9);
 const adas=new ADASController();adas.config.acc=false;
 const frame={ego,egoS:station,egoD:road.laneCenter(1),path,road,obstacles:[],desiredSpeed:38.9,input:{steer:0,throttle:1,brake:0},dt,speedControl:(e:number)=>e};
 const out=adas.update(frame);
 assert(out.status.laneSupportLimited&&out.status.takeoverRequired,'imminent grip limit only warned after entering bend');
 assert.equal(out.accel,ego.maxAccel,'lane support took over pedals while ACC was off');
 adas.config.acc=true;const braking=adas.update({...frame,input:{steer:0,throttle:0,brake:.6}});
 assert.equal(braking.status.accState,'cancelled');assert.equal(braking.accel,-.6*ego.maxDecel,'curve controller overrode foot brake priority');
}
console.log('ACC-CURVE-RECOVERY PASS — late engagement, dry/wet, shared grip, early warning, pedal priority');

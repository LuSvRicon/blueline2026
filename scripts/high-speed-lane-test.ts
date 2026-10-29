import assert from 'node:assert/strict';
import {ADASController} from '../src/sim/ADAS.ts';
import {Vehicle} from '../src/vehicle/Vehicle.ts';
import {ReferencePath} from '../src/world/ReferencePath.ts';
import {Road} from '../src/world/Road.ts';
import {TRACKS} from '../src/world/track.ts';
import {Simulation} from '../src/sim/Simulation.ts';

// Exercise the steering loop at a fixed speed so ACC, speed signs, AEB and
// road-edge collision correction cannot hide a lane-tracking failure.
let failures: string[] = [];
for(const id of ['city','boulevard','ring-road','motorway','national'] as const){
 const track=TRACKS.find(t=>t.id===id)!;
 const path=new ReferencePath(track.controlPoints,6);
 const road=new Road(path,track.road?.lanes??3,track.road?.laneWidth??3.7,track.road);
 const lane=1,center=road.laneCenter(lane);
 for(const kph of [60,100,140]){
  const p=path.toCartesian(0,center+.35),ego=new Vehicle(p.x,p.y,p.heading,kph/3.6,undefined,{maxSpeed:42});
  const adas=new ADASController();
  adas.config.acc=false;
  let max=0,lateMax=0,departed=false;
  for(let i=0;i<45*60;i++){
   const f=path.toFrenet(ego.x,ego.y);
   const error=Math.abs(f.d-center);
   max=Math.max(max,error);if(i>5*60)lateMax=Math.max(lateMax,error);
   departed ||= error+ego.dims.width/2>road.laneWidth/2;
   const out=adas.update({ego,egoS:f.s,egoD:f.d,path,road,obstacles:[],desiredSpeed:kph/3.6,
    input:{steer:0,throttle:0,brake:0},dt:1/60,speedControl:e=>e});
   ego.step(out.steer,0,1/60);
  }
  console.log(`${id} ${kph}km/h: max offset=${max.toFixed(3)}m, settled=${lateMax.toFixed(3)}m, lane departure=${departed}`);
  if(departed||lateMax>.3)failures.push(`${id}/${kph}: lane error ${lateMax.toFixed(3)}m`);
 }
}
assert.deepEqual(failures,[],'lane centering must retain the original lane at high speed');

let stepWorst=0;
for(const id of ['city','motorway','ring-road'] as const)for(const dt of [1/30,1/120])for(const lane of [0,1,2]){
 const track=TRACKS.find(t=>t.id===id)!,path=new ReferencePath(track.controlPoints,6);
 const road=new Road(path,track.road?.lanes??3,track.road?.laneWidth??3.7,track.road);
 const center=road.laneCenter(lane),p=path.toCartesian(0,center+.35);
 const ego=new Vehicle(p.x,p.y,p.heading+.01,140/3.6,undefined,{maxSpeed:42}),adas=new ADASController();adas.config.acc=false;
 for(let time=0;time<45;time+=dt){
  const f=path.toFrenet(ego.x,ego.y);
  const error=Math.abs(f.d-center);stepWorst=Math.max(stepWorst,error);
  assert(error+ego.dims.width/2<road.laneWidth/2,`${id}/${lane}/${dt}: body crossed lane boundary`);
  const out=adas.update({ego,egoS:f.s,egoD:f.d,path,road,obstacles:[],desiredSpeed:140/3.6,input:{steer:0,throttle:0,brake:0},dt,speedControl:e=>e});
  ego.step(out.steer,0,dt);
 }
}
console.log(`18 lane/step-size stress runs at 140km/h: maximum offset=${stepWorst.toFixed(3)}m, no lane boundary crossed`);

// With the actual friction-circle limiter on, ACC must shed speed BEFORE the
// bend. Constant-speed stress above isolates the steering math only.
for(const id of ['city','motorway','national'] as const)for(const mu of [1,.6]){
 const track=TRACKS.find(t=>t.id===id)!;
 const path=new ReferencePath(track.controlPoints,6);
 const road=new Road(path,track.road?.lanes??3,track.road?.laneWidth??3.7,track.road);
 const center=road.laneCenter(1),p=path.toCartesian(id==='motorway'?450:id==='national'?250:150,center);
 const ego=new Vehicle(p.x,p.y,p.heading,140/3.6,undefined,{maxSpeed:42});
 ego.surfaceMu=mu;ego.limitLateralGrip=true;
 const adas=new ADASController();let max=0,curveLimited=false,maxCurveSpeed=0,gripLimited=false;
 for(let i=0;i<65*60;i++){
  const f=path.toFrenet(ego.x,ego.y);
  max=Math.max(max,Math.abs(f.d-center));
  const out=adas.update({ego,egoS:f.s,egoD:f.d,path,road,obstacles:[],desiredSpeed:140/3.6,
   input:{steer:0,throttle:0,brake:0},dt:1/60,speedControl:e=>e});
  curveLimited ||= out.status.curveSpeedLimited;
  if(path.curvatureAt(f.s)>.003)maxCurveSpeed=Math.max(maxCurveSpeed,ego.v*3.6);
  ego.step(out.steer,out.accel,1/60);gripLimited ||= ego.tractionLimited;
 }
 console.log(`ACC/grip ${id}/mu=${mu}: max offset=${max.toFixed(3)}m, curve cap=${curveLimited}, tyre saturation=${gripLimited}, bend speed=${maxCurveSpeed.toFixed(1)}km/h`);
 assert(curveLimited,`${id}/${mu}: ACC ignored curve preview`);
 assert(max<.35,`${id}/${mu}: curve approach left lane, offset=${max}`);
 assert(!gripLimited,`${id}/${mu}: ACC entered bend beyond available tyre grip`);
}

// Lane ownership must survive an external shove across paint; it may change
// after a deliberate driver takeover, or after an assisted lane change.
{
 const track=TRACKS.find(t=>t.id==='city')!,path=new ReferencePath(track.controlPoints,6),road=new Road(path);
 const center=road.laneCenter(1),p=path.toCartesian(150,center);
 const ego=new Vehicle(p.x,p.y,p.heading,100/3.6),adas=new ADASController();
 const update=(steer=0)=>{const f=path.toFrenet(ego.x,ego.y);return adas.update({ego,egoS:f.s,egoD:f.d,path,road,obstacles:[],desiredSpeed:100/3.6,
  input:{steer,throttle:0,brake:0},dt:1/60,speedControl:e=>e});};
 update();const displaced=path.toCartesian(150,center+2);ego.x=displaced.x;ego.y=displaced.y;
 assert(update().steer<0,'external drift silently changed target to the adjacent lane');
 assert(update(.3).steer>.15,'lane centering resisted driver takeover');
 for(let i=0;i<65;i++)update();
 assert(update().steer>0,'after deliberate takeover, lane centering did not acquire the new lane');
 ego.v=40;const corner=path.toCartesian(0,0);ego.x=corner.x;ego.y=corner.y;ego.yaw=corner.heading;
 adas.config.acc=false;
 assert(update().status.laneSupportLimited&&adas.status.takeoverRequired,'impossible curve speed concealed lane-support limits');
 assert(!update().status.curveSpeedLimited,'curve preview took over longitudinal control with ACC off');
 assert(!adas.update({ego,egoS:0,egoD:0,path,road,obstacles:[],desiredSpeed:40,input:{steer:0,throttle:0,brake:0},dt:1/60,speedControl:e=>e,laneConfidence:0}).status.laneCenteringActive,'lane support steered without lane recognition');
}

// End-to-end Simulation applies the same command; no low posted limit or
// traffic target should make this a low-speed test in disguise.
for(const trackId of ['motorway','ring-road'] as const){
 const sim=new Simulation({trackId,trafficCount:0});sim.setControlMode('adas');
 sim.traffic.clear();sim.pedestrians.clear();sim.trafficLights=[];sim.roadSigns=[];sim.usePerception=false;
 sim.setAccSpeedKph(140);sim.adas.config.acc=false;sim.adas.config.isa=false;
 sim.ego.v=140/3.6;
 const initial=sim.path.toFrenet(sim.ego.x,sim.ego.y),center=sim.road.laneCenter(sim.road.laneOf(initial.d));
 let max=0;
 for(let i=0;i<45*60;i++){
  sim.setDriverInput({steer:0,throttle:1,brake:0});sim.step(1/60);
  const f=sim.path.toFrenet(sim.ego.x,sim.ego.y);max=Math.max(max,Math.abs(f.d-center));
 }
 assert(sim.ego.v>38,`${trackId}: supposed high-speed integration test slowed down`);
 assert(max<.35&&sim.metrics.collisions===0&&sim.metrics.offRoadTime===0,`${trackId}: integrated lane error=${max}`);
 console.log(`Simulation ${trackId}: speed=${(sim.ego.v*3.6).toFixed(0)}km/h, max offset=${max.toFixed(3)}m, no contact or departure`);
}
console.log('HIGH-SPEED-LANE PASS');

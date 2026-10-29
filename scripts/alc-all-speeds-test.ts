import assert from 'node:assert/strict';
import {ADASController, type ADASFrame} from '../src/sim/ADAS.ts';
import {Simulation} from '../src/sim/Simulation.ts';
import {Vehicle,EGO_DIMS} from '../src/vehicle/Vehicle.ts';
import {wrapAngle} from '../src/core/math.ts';

const dt=1/60;
let physicalRuns=0;
// Fixed-speed physical rig isolates lateral capability: speed is held by the
// test rig, while actual bicycle steering/grip integrate every pose. This is
// complemented below by complete Simulation runs with real ACC acceleration.
for(const startS of [500,150])for(const mu of [1,.72])for(const kph of [.5,1,3,5,10,15,30,50,79,80,100,130,160,180,198])for(const direction of [-1,1] as const){
  if(startS===150&&kph>50)continue; // Curves retain the vehicle's physical grip limits.
  const sim=new Simulation({trackId:'motorway',trafficCount:0}),road=sim.road,path=sim.path;
  const start=path.toCartesian(startS,road.laneCenter(1));
  const ego=new Vehicle(start.x,start.y,start.heading,kph/3.6,EGO_DIMS,{maxSpeed:55});ego.limitLateralGrip=true;ego.surfaceMu=mu;
  const c=new ADASController();let completed=false,maxLat=0,maxMove=0,maxSteerStep=0,prevSteer=0;
  const seconds=Math.max(18,18/ego.v*1.8+8);
  for(let i=0;i<seconds*60;i++){
    const f=path.toFrenet(ego.x,ego.y),frame:ADASFrame={ego,egoS:f.s,egoD:f.d,path,road,obstacles:[],desiredSpeed:ego.v,
      input:{steer:0,throttle:0,brake:0},dt,speedControl:e=>e,indicator:direction};
    const out=c.update(frame),x=ego.x,y=ego.y;
    assert(!out.status.alcAborted,`ALC aborted at ${kph}km/h, mu=${mu}: ${out.status.alcReason}`);
    ego.step(out.steer,0,dt);maxLat=Math.max(maxLat,Math.abs(ego.lateralAccel));maxMove=Math.max(maxMove,Math.hypot(ego.x-x,ego.y-y));
    maxSteerStep=Math.max(maxSteerStep,Math.abs(ego.delta-prevSteer));prevSteer=ego.delta;
    assert(Number.isFinite(ego.x+ego.y+ego.yaw));
    assert(f.d-ego.dims.width/2>=road.forwardLeftEdge-.1&&f.d+ego.dims.width/2<=road.forwardRightEdge+.1,'car left its carriageway');
    if(out.status.alcComplete){completed=true;break;}
  }
  const f=path.toFrenet(ego.x,ego.y);
  assert(completed,`did not complete ${kph}km/h, dir=${direction}, mu=${mu}, d=${f.d}`);
  assert(Math.abs(f.d-road.laneCenter(1+direction))<.32&&Math.abs(wrapAngle(ego.yaw-path.cartesianAt(f.s).heading))<.09);
  assert(maxLat<4.5&&maxSteerStep<=1.2*dt+.0001&&maxMove<=ego.v*dt+.001,'discontinuous or harsh lane change');
  physicalRuns++;console.log(`${kph}km/h, ${direction<0?'left':'right'}, mu=${mu}, s=${startS}: completed, max lateral=${maxLat.toFixed(2)}m/s2`);
}
// A standing signal neither changes lateral position nor progresses the route;
// after moving, the request arms normally without another stalk press.
{
  const sim=new Simulation({trackId:'motorway',trafficCount:0}),c=new ADASController(),ego=sim.ego;
  const p=sim.path.toFrenet(ego.x,ego.y);ego.v=0;
  const frame=():ADASFrame=>({ego,egoS:p.s,egoD:p.d,path:sim.path,road:sim.road,obstacles:[],desiredSpeed:0,input:{steer:0,throttle:0,brake:0},dt,speedControl:e=>e,indicator:1});
  for(let i=0;i<600;i++)c.update(frame());
  assert.equal(c.status.alc,'armed');assert.match(c.status.alcReason,/đứng yên/);assert.equal(c.captureState().alcProgress,0);
  ego.v=1/3.6;for(let i=0;i<40;i++)c.update(frame());assert.equal(c.status.alc,'active');
  const progress=c.captureState().alcProgress;ego.v=0;
  for(let i=0;i<600;i++)c.update(frame());assert.equal(c.captureState().alcProgress,progress);assert.equal(c.status.alc,'active');
  const restored=new ADASController();restored.restoreState(c.captureState(),c.status);assert.deepEqual(restored.captureState(),c.captureState());
}
// Real integration from 0 and low initial speeds: no fake fixed-speed override.
for(const initial of [0,1,5,15,30,60]){
  const sim=new Simulation({trackId:'motorway',trafficCount:0});sim.setControlMode('adas');sim.setTrafficCount(0);sim.setAccSpeedKph(50);
  sim.ego.v=initial/3.6;sim.toggleIndicator(1);let firstActive:number|null=null,completed=false;
  for(let i=0;i<15*60;i++){sim.step(dt);if(firstActive===null&&sim.adas.status.alc==='active')firstActive=sim.ego.v*3.6;completed||=sim.adas.status.alcComplete;}
  assert(firstActive!==null&&completed&&sim.indicator===0&&sim.metrics.collisions===0&&sim.metrics.offRoadTime===0,`integration failed from ${initial}km/h`);
  if(initial<=5)assert(firstActive<15,'a hidden low-speed entry gate remains');
  console.log(`ACC integration from ${initial}km/h: ALC began at ${firstActive.toFixed(1)}km/h, completed without contact`);
}
// A nearby slow lead/rear pair with a measured bumper gap is feasible at crawl;
// a rapidly approaching rear car remains a rejection at that same ego speed.
{
  const sim=new Simulation({trackId:'motorway',trafficCount:0}),c=new ADASController(),ego=sim.ego;ego.v=1;
  const p=sim.path.toFrenet(ego.x,ego.y),target=sim.road.laneCenter(2);
  const obstacle=(ds:number,v:number)=>({s:p.s+ds,d:target,v,vd:0,width:1.9,length:4.6,kind:'car' as const});
  const frame=(obstacles:ADASFrame['obstacles']):ADASFrame=>({ego,egoS:p.s,egoD:p.d,path:sim.path,road:sim.road,obstacles,desiredSpeed:1,input:{steer:0,throttle:0,brake:0},dt,speedControl:e=>e,indicator:1});
  for(let i=0;i<40;i++)c.update(frame([obstacle(12,1),obstacle(-12,1)]));assert.equal(c.status.alc,'active');
  const blocked=new ADASController();for(let i=0;i<40;i++)blocked.update(frame([obstacle(-100,25)]));
  assert.equal(blocked.status.alc,'blocked');assert.match(blocked.status.alcReason,/khoảng trống/);
}
// All speeds does not authorise using an emergency shoulder as a travel lane.
{
  const sim=new Simulation({trackId:'motorway',trafficCount:0}),c=new ADASController(),ego=sim.ego;
  const w=sim.path.toCartesian(500,sim.road.shoulderCenter);Object.assign(ego,{x:w.x,y:w.y,yaw:w.heading,v:5});
  for(let i=0;i<40;i++)c.update({ego,egoS:500,egoD:sim.road.shoulderCenter,path:sim.path,road:sim.road,obstacles:[],desiredSpeed:5,input:{steer:0,throttle:0,brake:0},dt,speedControl:e=>e,indicator:1});
  assert.equal(c.status.alc,'blocked');assert.match(c.status.alcReason,/Không có làn/);
}
console.log(`ALL-SPEED ALC PASS: ${physicalRuns} physical speed/direction/grip/curve runs, standing wait, replay, six ACC integrations and slow/fast traffic gap checks.`);

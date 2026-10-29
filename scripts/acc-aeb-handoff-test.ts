import assert from 'node:assert/strict';
import {ADASController,type ADASFrame} from '../src/sim/ADAS.ts';
import {Simulation} from '../src/sim/Simulation.ts';
const dt=1/60;
// Ordinary pedal-to-ACC handback must not jump to zero acceleration. AEB
// remains outside this comfort limiter, even on the very same release frame.
for(const held of [1,60]){
 const sim=new Simulation({trackId:'motorway',trafficCount:0}),ego=sim.ego,c=new ADASController();
 const w=sim.path.toCartesian(500,sim.road.laneCenter(1));Object.assign(ego,{x:w.x,y:w.y,yaw:w.heading,v:20});
 const frame=(throttle=0):ADASFrame=>({ego,egoS:500,egoD:sim.road.laneCenter(1),path:sim.path,road:sim.road,obstacles:[],desiredSpeed:25,input:{steer:0,throttle,brake:0},dt,speedControl:e=>e});
 for(let i=0;i<held;i++){const out=c.update(frame(1));ego.step(out.steer,out.accel,dt);}
 const previous=ego.a,out=c.update(frame());assert(Math.abs(out.accel-previous)/dt<=2.51,'ACC handback jumped instead of transitioning from applied acceleration');
 const emergency=c.update({...frame(),obstacles:[{s:520,d:sim.road.laneCenter(1),v:0,vd:0,width:2,length:4.7,kind:'car'}]});
 assert(emergency.status.aeb&&emergency.accel<=-ego.maxDecel*.99&&!emergency.status.accActive,'comfort limiter delayed emergency braking');
 const saved=c.captureState(),restored=new ADASController();restored.restoreState(saved,c.status);assert.deepEqual(restored.captureState(),saved);
}
// Actual integrated shoulder exit: the destination is the RIGHTMOST running
// lane, not one lane further in (laneOf clamps shoulder d to that outer lane).
for(const perception of [false,true])for(const weather of ['clear','rain'] as const){
 const sim=new Simulation({trackId:'motorway',trafficCount:0});sim.setControlMode('adas');sim.setTrafficCount(0);sim.usePerception=perception;sim.setWeather(weather);
 const start=sim.path.toFrenet(sim.ego.x,sim.ego.y),w=sim.path.toCartesian(start.s,sim.road.shoulderCenter);
 Object.assign(sim.ego,{x:w.x,y:w.y,yaw:w.heading,v:5/3.6});sim.setAccSpeedKph(50);sim.toggleIndicator(-1);
 let completed=false,active=false;
 for(let i=0;i<15*60;i++){sim.step(dt);active||=sim.adas.status.alc==='active';completed||=sim.adas.status.alcComplete;}
 const f=sim.path.toFrenet(sim.ego.x,sim.ego.y);
 assert(active&&completed&&sim.indicator===0&&Math.abs(f.d-sim.road.laneCenter(2))<.35,`shoulder exit failed: ${weather}/${perception}: ${sim.adas.status.alcReason}, d=${f.d}`);
 assert.equal(sim.metrics.collisions,0);assert.equal(sim.metrics.offRoadTime,0);
 console.log('shoulder exit',weather,perception,'completed at d',f.d);
}
{
 const sim=new Simulation({trackId:'motorway',trafficCount:0}),c=new ADASController(),ego=sim.ego;
 const w=sim.path.toCartesian(500,sim.road.shoulderCenter);Object.assign(ego,{x:w.x,y:w.y,yaw:w.heading,v:2});
 for(let i=0;i<60;i++)c.update({ego,egoS:500,egoD:sim.road.shoulderCenter,path:sim.path,road:sim.road,obstacles:[{s:420,d:sim.road.laneCenter(2),v:35,vd:0,width:2,length:4.7,kind:'car'}],desiredSpeed:2,input:{steer:0,throttle:0,brake:0},dt,speedControl:e=>e,indicator:-1});
 assert.equal(c.status.alc,'blocked');assert.match(c.status.alcReason,/khoảng trống/);
}
console.log('ACC/AEB HANDOFF PASS — pedal release jerk, urgent brake priority, replay, shoulder exit and fast-rear rejection.');
for(const weather of ['clear','rain'] as const){
 const sim=new Simulation({trackId:'motorway',trafficCount:0});sim.setControlMode('adas');sim.setTrafficCount(0);sim.setWeather(weather);sim.setAccSpeedKph(50);
 const p=sim.path.toFrenet(sim.ego.x,sim.ego.y),w=sim.path.toCartesian(p.s,sim.road.laneCenter(2));Object.assign(sim.ego,{x:w.x,y:w.y,yaw:w.heading,v:5/3.6});
 sim.toggleIndicator(1);let complete=false;for(let i=0;i<15*60;i++){sim.step(dt);complete||=sim.adas.status.alcComplete;}
 let f=sim.path.toFrenet(sim.ego.x,sim.ego.y);assert(complete&&Math.abs(f.d-sim.road.shoulderCenter)<.3&&sim.indicator===0&&sim.metrics.collisions===0&&sim.metrics.offRoadTime===0,'shoulder entry/keeping failed');
 sim.toggleIndicator(-1);complete=false;for(let i=0;i<15*60;i++){sim.step(dt);complete||=sim.adas.status.alcComplete;}
 f=sim.path.toFrenet(sim.ego.x,sim.ego.y);assert(complete&&Math.abs(f.d-sim.road.laneCenter(2))<.3&&sim.indicator===0&&sim.metrics.collisions===0&&sim.metrics.offRoadTime===0,'return after shoulder entry failed');
 console.log('shoulder round trip',weather,'PASS');
}

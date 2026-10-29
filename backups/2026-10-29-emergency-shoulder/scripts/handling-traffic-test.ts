import assert from 'node:assert/strict';
import {Vehicle} from '../src/vehicle/Vehicle.ts';
import {Simulation} from '../src/sim/Simulation.ts';
import {ADASController} from '../src/sim/ADAS.ts';
import {PedestrianManager} from '../src/pedestrian/PedestrianManager.ts';
const dt=1/60;
const reversing=new Vehicle(0,0,0,3);reversing.limitLateralGrip=true;reversing.step(0,-2,dt,-1);
assert(reversing.frontLoadFraction<.5&&reversing.bodyPitch>0,'reverse braking load/pitch used forward signs');
for(const mode of ['manual','adas','classical'] as const){
 const sim=new Simulation({trafficCount:0});sim.setControlMode(mode);sim.step(dt);
 assert(sim.ego.limitLateralGrip,`${mode} bypassed grip`);
}
for(const mu of [.35,.72,1]){
 const car=new Vehicle(0,0,0,30);car.limitLateralGrip=true;car.surfaceMu=mu;
 let previous=0,saturated=false;
 for(let i=0;i<90;i++){
  car.step(.5,-7,dt);assert(Math.abs(car.delta-previous)<=1.2*dt+1e-8);previous=car.delta;
  assert(Math.hypot(car.a,car.lateralAccel)<=mu*9.81+1e-6);saturated ||= car.tractionLimited;
 }
 assert(saturated);assert(car.frontLoadFraction>.5,'braking did not transfer load forwards');
 assert(car.bodyPitch<0);const state=car.x;car.step(NaN,0,dt);assert.equal(car.x,state);
}
// Real integrated ACC approach from rest: no impossible constant-speed urban
// corner expectation, and no collision guardrail to conceal lane departure.
for(const weather of ['clear','rain'] as const){
 const sim=new Simulation({trafficCount:0});sim.setControlMode('adas');sim.setWeather(weather);
 sim.traffic.clear();sim.pedestrians.clear();sim.trafficLights=[];sim.roadSigns=[];sim.usePerception=false;sim.setAccSpeedKph(140);
 let capped=false,maxError=0;
 for(let i=0;i<65*60;i++){sim.step(dt);capped ||= sim.adas.status.curveSpeedLimited;maxError=Math.max(maxError,Math.abs(sim.telemetry.laneOffset));}
 assert(capped);assert(maxError<.5,`${weather} ACC lane error ${maxError}`);assert.equal(sim.metrics.collisions,0);
 console.log(`Integrated ACC/${weather}: max lane offset ${maxError.toFixed(3)}m`);
}
const sim=new Simulation({trafficCount:0}),pm=new PedestrianManager(sim.road);
const p=pm.add({s:150,fromD:-5,toD:5});
pm.update(dt,0,sim.path.length,[{s:150,d:0,v:0}]);assert.equal(p.state,'waiting','walker started through a parked car');
p.state='crossing';p.d=-1.9;pm.update(.2,0,sim.path.length,[{s:150,d:0,v:0}]);assert(p.yielding);assert.equal(pm.lateralVel(p),0);
pm.update(.2,0,sim.path.length,[]);assert(!p.yielding&&p.d>-1.9,'walker did not resume after clearance');
const adas=new ADASController(),f=sim.path.toFrenet(sim.ego.x,sim.ego.y);sim.ego.v=20;
const frame={ego:sim.ego,egoS:f.s,egoD:f.d,path:sim.path,road:sim.road,desiredSpeed:20,input:{steer:0,throttle:0,brake:0},dt,speedControl:(e:number)=>e};
assert(adas.update({...frame,obstacles:[{s:f.s-60,d:f.d+3.7,v:40,vd:0,length:4.7,width:2,kind:'car' as const}]}).status.blindSpotRight,'fast rear approach not warned');
assert(!adas.update({...frame,obstacles:[{s:f.s-60,d:f.d+3.7,v:15,vd:0,length:4.7,width:2,kind:'car' as const}]}).status.blindSpotRight,'departing rear traffic falsely warned');
const emergency=new ADASController();
assert(emergency.update({...frame,obstacles:[{s:f.s+12,d:f.d,v:0,vd:0,length:4.7,width:2,kind:'car' as const}]}).status.aeb);
const dropped=emergency.update({...frame,obstacles:[],input:{steer:0,throttle:1,brake:0}});
assert(dropped.status.aeb&&dropped.accel<0,'brief track loss abandoned an ongoing emergency stop');
// Same ordinary NPC and road geometry: wet conditions reduce curve demand.
const trafficSim=new Simulation({trafficCount:0});trafficSim.traffic.clear();
const npc=trafficSim.traffic.addTestVehicle('car',1,0,10,30);npc.changeCooldown=999;
trafficSim.traffic.surfaceMu=1;trafficSim.traffic.update(dt,{s:500,d:0,v:0,length:4.7});const drySpeed=npc.v;
npc.s=0;npc.v=10;trafficSim.traffic.surfaceMu=.72;trafficSim.traffic.update(dt,{s:500,d:0,v:0,length:4.7});
assert(npc.v<drySpeed,'NPC curve approach ignored wet surface');
console.log('HANDLING-TRAFFIC PASS — shared grip, actuator, load response, ACC curves, pedestrian yielding and rear approach warning.');

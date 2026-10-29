import assert from "node:assert/strict";
import {Simulation} from "../src/sim/Simulation.ts";
import {mod,wrapDiff} from "../src/core/math.ts";

const failures:string[]=[];
for(const cancelled of [false,true])for(const throttle of [0,1])for(const perception of [false,true]){
 const sim=new Simulation({trafficCount:0,seed:1});sim.traffic.clear();sim.pedestrians.clear();sim.trafficLights=[];sim.roadSigns=[];
 sim.setControlMode("adas");sim.usePerception=perception;sim.ego.v=25;sim.adas.config.timeGap=1;sim.adas.config.isa=false;
 if(cancelled)sim.adas.cancelCruise();
 const straight=sim.path.toCartesian(150,0);Object.assign(sim.ego,{x:straight.x,y:straight.y,yaw:straight.heading});
 const f=sim.path.toFrenet(sim.ego.x,sim.ego.y);
 const lead=sim.traffic.addTestVehicle("car",sim.road.laneOf(f.d),f.s+28+4.7,25,25);
 sim.traffic.update=dt=>{lead.v=Math.max(0,lead.v-8*dt);lead.s=mod(lead.s+lead.v*dt,sim.path.length);};
 let min=Infinity,aeb=false,hold=false;
 for(let i=0;i<10*60;i++){
  sim.setDriverInput({steer:0,throttle,brake:0});sim.step(1/60);
  const e=sim.path.toFrenet(sim.ego.x,sim.ego.y),gap=wrapDiff(lead.s,e.s,sim.path.length)-(sim.ego.dims.length+lead.length)/2;
  min=Math.min(min,gap);aeb||=sim.adas.status.aeb;hold||=sim.adas.status.aebHolding;
 }
 console.log({cancelled,throttle,perception,minGap:+min.toFixed(2),collisions:sim.metrics.collisions,aeb,hold,speed:sim.ego.v});
 if(sim.metrics.collisions||min<1||sim.ego.v>.1)failures.push(`hard-braking lead: throttle=${throttle}, perception=${perception}, gap=${min.toFixed(2)}, collisions=${sim.metrics.collisions}`);
}
// The browser's new scenario button uses real TrafficManager integration.
for(const weather of ["clear","rain"] as const){
 const sim=new Simulation({trafficCount:0,seed:9});sim.traffic.clear();sim.pedestrians.clear();sim.trafficLights=[];sim.roadSigns=[];
 sim.setControlMode("adas");sim.setWeather(weather);sim.ego.v=20;sim.setAccSpeedKph(72);sim.adas.config.timeGap=1;
 const straight=sim.path.toCartesian(150,0);Object.assign(sim.ego,{x:straight.x,y:straight.y,yaw:straight.heading});
 sim.addScenarioEvent("lead-hard-brake");const lead=sim.traffic.cars[0];let min=Infinity;
 for(let i=0;i<12*60;i++){
  sim.step(1/60);const e=sim.path.toFrenet(sim.ego.x,sim.ego.y);
  min=Math.min(min,wrapDiff(lead.s,e.s,sim.path.length)-(sim.ego.dims.length+lead.length)/2);
 }
 assert.equal(sim.metrics.collisions,0,`${weather}: scenario button must not contact lead`);assert(min>1,`${weather}: clearance ${min}`);
 assert(sim.adas.status.aebHolding&&sim.telemetry.finalBrakeForce===1,"stopped emergency hold must keep real brake pressure");
 // Releasing the accelerator must not drop the brake hold into the obstacle.
 for(const throttle of [1,0,1])for(let i=0;i<60;i++){sim.setDriverInput({steer:0,throttle,brake:0});sim.step(1/60);}
 assert.equal(sim.ego.v,0);assert.equal(sim.metrics.collisions,0);
 lead.kind="car";lead.v=2;lead.desiredSpeed=12;sim.setDriverInput({steer:0,throttle:0,brake:0});sim.adas.resumeCruise();
 for(let i=0;i<180;i++)sim.step(1/60);
 assert(sim.ego.v>.5&&!sim.adas.status.aebHolding,"hold must release when lead pulls away and the driver resumes ACC");
 assert.equal(sim.metrics.collisions,0);
 console.log(`${weather}: real scenario, ${min.toFixed(2)}m clearance, 100% brake hold, no contact`);
}
// Reproduce the user's longer run and shortest selectable ACC headway.
for(const profile of ["international","vietnam"] as const){
 const sim=new Simulation({seed:1});sim.setTrafficProfile(profile);sim.setControlMode("adas");sim.adas.config.timeGap=1;sim.setAccSpeedKph(75);
 let collisionAt:number|null=null;
 for(let i=0;i<300*60;i++){
  sim.step(1/60);
  if(sim.metrics.collisions){collisionAt=i/60;break;}
 }
 console.log({profile,collisionAt,lead:sim.adas.status.leadGap,pressure:sim.adas.status.adasBrakeForce,aeb:sim.adas.status.aeb});
 if(collisionAt!==null)failures.push(`${profile}: collision at ${collisionAt.toFixed(2)}s`);
}
assert.equal(failures.length,0,failures.join("\n"));
console.log("AEB-FOLLOWING PASS — moving lead emergency braking, noisy perception, held throttle and five-minute shortest-headway runs.");

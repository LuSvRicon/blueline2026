import assert from 'node:assert/strict';
import {Simulation} from '../src/sim/Simulation.ts';
import {bodyContact} from '../src/core/collision.ts';
import {trafficBody,resolveTrafficContacts} from '../src/traffic/TrafficContacts.ts';
import {ADASController} from '../src/sim/ADAS.ts';
import {Vehicle} from '../src/vehicle/Vehicle.ts';

for(const direction of [1,-1] as const){
 const sim=new Simulation({trafficCount:0});sim.setControlMode('manual');sim.traffic.clear();sim.pedestrians.clear();
 const p=sim.path.toCartesian(250,0),wall=sim.path.toCartesian(250+direction*22,0);
 Object.assign(sim.ego,{x:p.x,y:p.y,yaw:p.heading,v:40});
 if(direction===-1){sim.ego.v=0;sim.setGear('R');sim.ego.v=40;}
 sim.staticWorld.add({id:'thin-wall',kind:'barrier',x:wall.x,y:wall.y,yaw:wall.heading+Math.PI/2,length:20,width:.08});
 sim.setDriverInput({steer:0,throttle:1,brake:0});
 for(let i=0;i<90;i++)sim.step(1/60);
 const f=sim.path.toFrenet(sim.ego.x,sim.ego.y);
 assert(Math.abs(f.s-250)<20,`wall tunneling ${direction}: ${f.s}`);assert.equal(sim.ego.v,0);assert(sim.metrics.collisions>0);
 console.log(`static wall ${direction>0?'forward':'reverse'}: high-speed sweep blocks penetration`);
}
for(const weather of ['clear','rain'] as const)for(const perception of [true,false]){
 const sim=new Simulation({trafficCount:0});sim.setControlMode('adas');sim.traffic.clear();sim.pedestrians.clear();sim.setWeather(weather);sim.usePerception=perception;
 const p=sim.path.toCartesian(250,0),wall=sim.path.toCartesian(310,0);Object.assign(sim.ego,{x:p.x,y:p.y,yaw:p.heading,v:15});
 sim.staticWorld.add({id:'building',kind:'building',x:wall.x,y:wall.y,yaw:wall.heading,length:3,width:4});sim.setDriverInput({steer:0,throttle:1,brake:0});
 let intervened=false;for(let i=0;i<600;i++){sim.step(1/60);intervened ||=sim.adas.status.aeb||sim.adas.status.aebHolding;}
 assert(intervened,`static AEB ${weather}/${perception}`);assert.equal(sim.metrics.collisions,0);assert.equal(sim.ego.v,0);
}
const sim=new Simulation({trafficCount:0});sim.traffic.clear();
const a=sim.traffic.addTestVehicle('car',1,250,0),b=sim.traffic.addTestVehicle('car',1,280,0);
const before=new Map([a,b].map(c=>[c.id,trafficBody(c,sim.road)]));a.s=290;b.s=245;
assert.equal(resolveTrafficContacts([a,b],before,sim.road),1);assert(a.disabled&&b.disabled);assert(!bodyContact(trafficBody(a,sim.road),trafficBody(b,sim.road),0));
sim.traffic.contactCount=7;sim.startRecording();sim.step(1/60);sim.stopRecording();const count=sim.traffic.contactCount;sim.reset();sim.startReplay();sim.step(1/60);sim.step(1/60);assert.equal(sim.traffic.contactCount,count,'NPC incident counter survives replay');

// Same stopped object beside a turning path: warn only if the predicted body
// corridor intersects it. Road-station proximity alone is insufficient.
const p=sim.path.toCartesian(250,0),ego=new Vehicle(p.x,p.y,p.heading,12),adas=new ADASController({laneCentering:false});
const curvature=Math.tan(.6*ego.maxSteer)/ego.dims.wheelbase,t=1.2,angle=p.heading+12*curvature*t;
const target=sim.path.toFrenet(p.x+(Math.sin(angle)-Math.sin(p.heading))/curvature,p.y-(Math.cos(angle)-Math.cos(p.heading))/curvature);
const frame={ego,egoS:250,egoD:0,path:sim.path,road:sim.road,desiredSpeed:12,input:{steer:.6,throttle:1,brake:0},dt:1/60,speedControl:()=>0};
adas.update({...frame,obstacles:[{s:target.s,d:target.d,v:0,vd:0,length:4.6,width:1.9,kind:'car'}]});
assert(adas.status.aeb,'turning into an adjacent obstacle must trigger');
adas.clearStatus();adas.update({...frame,obstacles:[{s:270,d:0,v:0,vd:0,length:4.6,width:1.9,kind:'car'}]});
assert(!adas.status.aeb,'object on the old straight path must not brake a safe turn away');
console.log('STATIC-TRAFFIC-ADAS PASS — thin barriers, reverse, physical NPC contacts, static perception/AEB in rain and steering-path discrimination.');

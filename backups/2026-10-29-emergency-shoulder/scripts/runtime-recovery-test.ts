import assert from 'node:assert/strict';
import {Simulation} from '../src/sim/Simulation.ts';
import {stopTrafficAfterImpact,resolveTrafficContacts,trafficBody} from '../src/traffic/TrafficContacts.ts';
import {stoppedTrafficAhead} from '../src/traffic/TrafficStatus.ts';
import {wrapDiff} from '../src/core/math.ts';
const dt=1/60;
function empty(){const sim=new Simulation({trafficCount:0});sim.setControlMode('manual');sim.traffic.clear();sim.pedestrians.clear();sim.trafficLights=[];sim.roadSigns=[];return sim;}
// Actual rear-end contact through Simulation: the lead must stop first and
// remain collidable, then depart under its own IDM motion after the pause.
{
 const sim=empty(),p=sim.path.toCartesian(150,sim.road.laneCenter(1));Object.assign(sim.ego,{x:p.x,y:p.y,yaw:p.heading,v:12});
 const lead=sim.traffic.addTestVehicle('car',1,161,0,8);lead.changeCooldown=999;
 sim.setDriverInput({steer:0,throttle:1,brake:0});
 for(let i=0;i<180&&sim.metrics.collisions===0;i++)sim.step(dt);
 assert.equal(sim.metrics.collisions,1,'fixture did not actually rear-end lead');
 assert(lead.disabled&&lead.impactPause!>0,'contact did not pause the lead');
 const stopS=lead.s;sim.setDriverInput({steer:0,throttle:0,brake:1});
 for(let i=0;i<60;i++)sim.step(dt);
 assert(lead.disabled&&Math.abs(wrapDiff(lead.s,stopS,sim.path.length))<.01,'lead skipped the impact pause');
 for(let i=0;i<5*60;i++)sim.step(dt);
 assert(!lead.disabled&&lead.v>1&&wrapDiff(lead.s,stopS,sim.path.length)>1,'ordinary lead remained permanently disabled');
 assert.equal(sim.metrics.collisions,1,'restart drove back through the ego');
 console.log('Actual rear-end: impact retained, 3-second pause, lead drives away, no new collision');
}
{
 const sim=empty(),car=sim.traffic.addTestVehicle('car',1,150,0,10),blocker=sim.traffic.addTestVehicle('stalled',1,155,0,0);
 stopTrafficAfterImpact(car);const stopped=car.s;
 const ego={s:700,d:0,v:0,length:4.7};
 for(let i=0;i<6*60;i++)sim.traffic.update(dt,ego,true);
 assert(car.disabled&&car.s===stopped,'recovery crossed an occupied swept path');
 assert.match(stoppedTrafficAhead(sim.road,sim.traffic.cars,140,car.d)??'',/sau va chạm/);
 blocker.s=350;
 for(let i=0;i<3*60;i++)sim.traffic.update(dt,ego,true);
 assert(!car.disabled&&car.v>1,'recovery failed to resume when clearance returned');
 assert.equal(sim.traffic.contactCount,0,'recovery used collisions to escape');
 const wreck=sim.traffic.addTestVehicle('truck',2,500,0,0);wreck.disabled=true;
 for(let i=0;i<5*60;i++)sim.traffic.update(dt,ego,true);
 assert(wreck.disabled&&wreck.v===0,'scripted breakdown was incorrectly recovered');
}
// Actual NPC-NPC contact separates bodies by .04m. The recovery clearance
// must permit the front actor to move away from that contact, then its follower.
{
 const sim=empty(),rear=sim.traffic.addTestVehicle('car',1,150,15,8),front=sim.traffic.addTestVehicle('car',1,158,0,8);
 rear.changeCooldown=front.changeCooldown=999;
 const before=new Map([rear,front].map(c=>[c.id,trafficBody(c,sim.road)]));rear.s=156;
 assert.equal(resolveTrafficContacts([rear,front],before,sim.road),1);
 assert(rear.disabled&&front.disabled);
 for(let i=0;i<10*60;i++)sim.traffic.update(dt,{s:700,d:0,v:0,length:4.7},true);
 assert(!front.disabled&&front.v>1,'front NPC could not separate from padded contact');
 assert(!rear.disabled&&rear.v>.5,'rear NPC could not follow after front departed');
 assert.equal(sim.traffic.contactCount,0,'recovering NPC pair collided again');
 console.log('NPC pair: both resume in order after actual swept contact');
}
// Reverse-only test traffic waiting off the road must not create a phantom
// predicted crossing in front of a forward-driving ambient vehicle.
{
 const a=empty(),b=empty();
 for(const sim of [a,b]){const car=sim.traffic.addTestVehicle('car',1,150,5,10);car.changeCooldown=999;}
 const crossing=a.traffic.addCrossingVehicle('motorcycle',175,10);crossing.d=-8;crossing.crossingToD=8;crossing.activationGear='R';
 const ego={s:700,d:0,v:0,length:4.7,gear:'D'};
 for(let i=0;i<2*60;i++){a.traffic.update(dt,ego,true);b.traffic.update(dt,ego,true);}
 assert(!crossing.crossingStarted);
 assert(Math.abs(a.traffic.cars[0].s-b.traffic.cars[0].s)<1e-6,'untriggered crossing made ambient traffic brake');
 console.log('Untriggered R crossing: no phantom braking in D');
}
// A 2.55m bus must see the edge of a 2.5m truck halfway between two lanes.
// The previous lane index used a fixed 1.9m neighbour and let the bus pass
// through a 2.5cm physical overlap at the edge of the long body.
{
 const sim=empty(),bus=sim.traffic.addTestVehicle('bus',2,150,10,10),truck=sim.traffic.addTestVehicle('truck',1,185,0,0);
 truck.d=1.2;truck.disabled=true;bus.changeCooldown=999;
 for(let i=0;i<12*60;i++)sim.traffic.update(dt,{s:700,d:0,v:0,length:4.7},true);
 assert.equal(sim.traffic.contactCount,0,'wide bus ignored partially occupied corridor');
 assert(bus.v<.5&&bus.s<truck.s-(bus.length+truck.length)/2,'bus failed to queue before the wide truck');
 console.log('Wide-body occupancy: bus queues behind partially merged truck without contact');
}
// Radar velocity must describe executed lateral motion, rather than the
// uncapped request to reach a lane centre. A pending crossing has no velocity.
{
 const sim=empty();sim.setControlMode('adas');sim.traffic.clear();
 const car=sim.traffic.addTestVehicle('car',2,150,8,8);car.lane=1;car.changeCooldown=999;
 const observe=(sim as unknown as {trafficLateralSpeed(c:typeof car):number}).trafficLateralSpeed.bind(sim);
 assert.equal(observe(car),0,'unexecuted lane command appeared as motion');
 for(let i=0;i<60;i++){
  const oldD=car.d;sim.traffic.update(dt,{s:700,d:0,v:0,length:4.7},true);
  assert(Math.abs(observe(car)-(car.d-oldD)/dt)<1e-8,'radar reported commanded rather than actual lane-change speed');
  assert(Math.abs(observe(car))<=1.1+1e-8);
 }
 const crossing=sim.traffic.addCrossingVehicle('car',200,5);assert.equal(observe(crossing),0,'pending crossing was already moving in radar');
 crossing.crossingStarted=true;assert(Math.abs(observe(crossing))===5);
}
// Rear truck previews the oriented body of a slower merging motorcycle.
// Brake through acceleration integration, never erase a contact or set v=0.
{
 const sim=empty(),bike=sim.traffic.addTestVehicle('motorcycle',2,1158,10,10),truck=sim.traffic.addTestVehicle('truck',2,1145,14,14);
 bike.d=0;bike.shareOffset=0;bike.changeCooldown=truck.changeCooldown=999;
 let slowed=false;
 for(let i=0;i<10*60;i++){
  const previous=truck.v;sim.traffic.update(dt,{s:700,d:0,v:0,length:4.7},true);
  assert(previous-truck.v<=8*dt+1e-8,'NPC anticipation stopped a vehicle without integrating braking');
  slowed ||= truck.v<10;
 }
 assert(slowed,'rear truck never anticipated the merge');
 assert.equal(sim.traffic.contactCount,0,'rear truck hit merging bike on curve');
 assert(!truck.disabled&&!bike.disabled);
 console.log('NPC anticipation: rear truck brakes progressively before bike merges on curve');
}
console.log('RUNTIME-RECOVERY PASS');

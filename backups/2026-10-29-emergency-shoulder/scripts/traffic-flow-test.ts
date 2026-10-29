import assert from 'node:assert/strict';
import {Simulation} from '../src/sim/Simulation.ts';
import {wrapDiff} from '../src/core/math.ts';
for(const seed of [20261028,1,9])for(const weather of ['clear','rain'] as const){
const sim=new Simulation({seed});sim.setTrafficProfile('vietnam');sim.setControlMode('adas');sim.traffic.populateDistrict(0,48);sim.reset();sim.setWeather(weather);
let previous=0;
let travel=0;const stations=new Map(sim.traffic.cars.map(c=>[c.id,c.s]));
for(let i=0;i<300*60;i++){
 sim.step(1/60);
 for(const car of sim.traffic.cars)assert((car.mergeWaitTime??0)<=1.2+1/60,'ambient car waited indefinitely half-way through a blocked lane change');
 for(const car of sim.traffic.cars){travel+=Math.abs(wrapDiff(car.s,stations.get(car.id)??car.s,sim.path.length));stations.set(car.id,car.s);}
 if(sim.traffic.contactCount!==previous){
  console.log(`Contact at ${(i/60).toFixed(2)}s`,sim.traffic.cars.filter(c=>c.disabled).map(c=>({id:c.id,kind:c.kind,s:+c.s.toFixed(1),d:+c.d.toFixed(2),lane:c.lane,yaw:c.headingOffset})));
  previous=sim.traffic.contactCount;
  break;
 }
}
assert.equal(sim.traffic.contactCount,0,'ordinary district traffic crashed and permanently blocked the road');
assert(travel/sim.traffic.count>200,'zero-contact result hid a frozen traffic stream');
console.log(`District seed=${seed}/${weather}: 300 seconds, 48 NPCs, no ambient impacts, mean travel=${(travel/sim.traffic.count).toFixed(0)}m`);
}
console.log('TRAFFIC-FLOW PASS');

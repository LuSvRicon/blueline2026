import assert from 'node:assert/strict';
import {Simulation} from '../src/sim/Simulation.ts';
import {TRACKS} from '../src/world/track.ts';
import {wrapDiff} from '../src/core/math.ts';
for(const track of TRACKS.filter(t=>t.road)){
 for(const mode of ['classical','adas'] as const)for(const weather of ['clear','rain','fog'] as const){
  const sim=new Simulation({trackId:track.id,seed:20261028});sim.setTrafficProfile('vietnam');sim.setControlMode(mode);sim.setWeather(weather);sim.reset();
  const opposite=sim.traffic.cars.filter(c=>c.oncoming);assert(opposite.length>0,`${track.id}: oncoming traffic`);
  assert(opposite.every(c=>c.v<0&&c.d>sim.road.centerDivider));
  for(let lane=0;lane<sim.road.numLanes;lane++)assert.equal(sim.road.laneOf(sim.road.laneCenter(lane)),lane);
  if(track.road!.motorway){assert(!sim.traffic.cars.some(c=>c.kind==='motorcycle'));assert.equal(sim.trafficLights.length,0);assert.equal(sim.pedestrians.count,0);}
  if(track.id==='neighborhood')assert(sim.traffic.cars.every(c=>c.kind!=='bus'&&c.kind!=='truck'));
  if(sim.road.numLanes===1){assert(!sim.supportsScenario('cutin'));assert(!sim.supportsEvent('motorcycle-cutin'));}
  const first=opposite[0],start=first.s;
  for(let i=0;i<30*60;i++)sim.step(1/60);
  assert(wrapDiff(first.s,start,sim.path.length)<-1,'opposite actors must actually move backwards in s');
  assert.equal(sim.metrics.collisions,0,`${track.id}/${mode}/${weather}: collision`);
  assert.equal(sim.metrics.offRoadTime,0,`${track.id}/${mode}/${weather}: offroad`);
  assert(sim.metrics.distance>25,`${track.id}/${mode}/${weather}: no progress`);
  assert(sim.candidates.every(candidate=>candidate.targetLane>=0&&candidate.targetLane<sim.road.numLanes),'planner must not select opposing lanes');
 }
 console.log(`${track.name}: 2 controllers x 3 weather conditions, oncoming flow, legal lanes, progress and no contact PASS`);
}
const district=new Simulation();district.traffic.profile='vietnam';district.traffic.populateDistrict(0,48);
assert.equal(district.traffic.count,48);assert(district.traffic.cars.every(c=>c.s>50&&c.s<650));
for(const mode of ['classical','adas'] as const){
 const sim=new Simulation();sim.setTrafficProfile('vietnam');sim.traffic.populateDistrict(0,48);sim.setControlMode(mode);sim.reset();
 assert.equal(sim.traffic.count,48,'density survives changing drive mode/reset');
 for(let i=0;i<180*60;i++)sim.step(1/60);
 assert.equal(sim.metrics.collisions,0,`dense district/${mode}: collision`);assert.equal(sim.metrics.offRoadTime,0);
}
console.log('ROAD-PROFILES PASS — four new road layouts, 24 deterministic 30-second rollouts and denser city distribution.');

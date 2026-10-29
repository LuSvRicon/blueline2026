import assert from 'node:assert/strict';
import {Simulation} from '../src/sim/Simulation.ts';
import {TRACKS} from '../src/world/track.ts';
import {SCENARIOS} from '../src/ui/scenarios.ts';
let count=0;const failures:string[]=[];
for(const track of TRACKS){
 for(const scenario of SCENARIOS)for(const mode of ['classical','adas'] as const)for(const weather of ['clear','rain','fog'] as const){
  const sim=new Simulation({trackId:track.id,seed:20261028});if(!sim.supportsScenario(scenario.id))continue;
  sim.setTrafficProfile('vietnam');sim.setControlMode(mode);sim.setScenario(scenario.id);sim.setWeather(weather);
  for(let i=0;i<20*60;i++)sim.step(1/60);count++;
  if(sim.metrics.collisions||sim.metrics.offRoadTime||![sim.ego.x,sim.ego.y,sim.ego.v].every(Number.isFinite))failures.push(`${track.id}/${scenario.id}/${mode}/${weather}: contacts ${sim.metrics.collisions}, offroad ${sim.metrics.offRoadTime}`);
 }
 console.log(`${track.id}: compatible scenarios checked`);
}
assert.equal(failures.length,0,failures.join('\n'));
console.log(`NETWORK-MATRIX PASS — ${count} compatible map/scenario/controller/weather combinations, 20 simulated seconds each.`);

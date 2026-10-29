import assert from "node:assert/strict";
import { Simulation } from "../src/sim/Simulation.ts";
import { TRACKS } from "../src/world/track.ts";
import { TrafficLight } from "../src/world/TrafficLight.ts";

for (const track of TRACKS) for (const mode of ["classical","adas"] as const) {
  const sim = new Simulation({ trackId: track.id }); sim.setControlMode(mode); sim.reset();
  for(let i=0;i<1200;i++) sim.step(1/60);
  assert.equal(sim.metrics.collisions,0,`${track.id}/${mode}: collision`);
  assert.equal(sim.metrics.offRoadTime,0,`${track.id}/${mode}: off road`);
  assert(sim.metrics.distance>15,`${track.id}/${mode}: must make progress`);
  console.log(`${track.name}/${mode}: ${sim.path.length.toFixed(0)}m loop, ${sim.metrics.distance.toFixed(0)}m driven`);
}
const pedSim = new Simulation({ trafficCount: 0 });
const person = pedSim.pedestrians.add({s:100,fromD:8,toD:-8,wait:0});
for(let i=0;i<600;i++)pedSim.pedestrians.update(1/60,0,pedSim.path.length,[{s:40,d:0,v:15}]);
assert.equal(person.state,"waiting","ordinary pedestrians must not walk into traffic just because three seconds elapsed");
pedSim.pedestrians.update(1/60,0,pedSim.path.length,[]);
assert.equal(person.state,"crossing","person must use a safe gap instead of waiting forever");

const junction = new Simulation({trafficCount:0}); junction.traffic.clear(); junction.traffic.junctionTraffic=true;
const light = new TrafficLight(45,{green:4,yellow:1,red:12});
junction.traffic.spawnJunctionCrossings(3.3,[light],0);
assert.equal(junction.traffic.cars.length,0,"cross traffic must not spawn while the main road is green");
light.restoreTime(5);
for(let i=0;i<8 && !junction.traffic.cars.length;i++)junction.traffic.spawnJunctionCrossings(3.3,[light],0);
assert(junction.traffic.cars.some(car=>car.crossing && car.signalS===light.s),"red phase must be wired to real crossing actors");

const reverse = new Simulation({trafficCount:0}); reverse.setControlMode("adas"); reverse.setScenario("reverse-crossing"); reverse.usePerception=false;
const bike=reverse.traffic.cars[0], start=bike.d;
for(let i=0;i<30;i++)reverse.step(1/60);
assert.equal(bike.d,start,"rear challenge must wait for Reverse");
assert.equal(reverse.gear,"P","reverse challenge should start safely parked");
assert(reverse.setGear("R")); assert(reverse.setParkingBrake(false));
let warned=false,braked=false;
reverse.setDriverInput({steer:0,throttle:.5,brake:0});
for(let i=0;i<240;i++){reverse.step(1/60);warned ||=reverse.telemetry.rctaActive;braked ||=reverse.telemetry.rearAeb;}
assert(warned && braked,"rear scenario must actually warn and brake");
assert.equal(reverse.metrics.collisions,0,"rear scenario must avoid contact");
for(const scenario of ["school-zone","market-street","roadworks"] as const){
 const sim=new Simulation();sim.setScenario(scenario);
 assert(sim.roadSigns.some(sign=>sign.valueKph===30),`${scenario}: must have a working 30km/h sign`);
 sim.setScenario("highway");assert(!sim.roadSigns.some(sign=>sign.id.includes("school")||sign.id.includes("market")||sign.id.includes("works")),"scenario signs must be cleared on reset");
}
console.log(`MAPS-TRAFFIC PASS — ${TRACKS.length} maps, controllers, safe pedestrian gap, signal-controlled crossing, RCTA challenge and scenario cleanup.`);

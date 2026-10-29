// Regression checks for full-throttle AEB stops and non-evasive lead traffic.

import { Simulation } from "../src/sim/Simulation.ts";
import { wrapDiff } from "../src/core/math.ts";

let seed = 7319;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error("ADAS-BRAKE-TEST FAIL:", message);
    process.exit(1);
  }
}

const dt = 1 / 60;
function checkEmergencyStop(
  usePerception: boolean,
  initialSpeed = 28,
  obstacleDistance = 75,
  weather: "clear" | "rain" | "fog" = "clear",
): void {
  const sim = new Simulation({ trafficCount: 0 });
  sim.traffic.cars = [];
  sim.usePerception = usePerception;
  const start = sim.path.toFrenet(sim.ego.x, sim.ego.y);
  const lane = sim.road.laneOf(start.d);
  const obstacle = sim.traffic.addTestVehicle("stalled", lane, start.s + obstacleDistance, 0, 0);
  const adjacentLane = lane + 1 < sim.road.numLanes ? lane + 1 : lane - 1;
  const adjacentVehicle = sim.traffic.addTestVehicle("car", adjacentLane, start.s + 35, 18, 18);
  adjacentVehicle.changeCooldown = 0;
  sim.ego.v = initialSpeed;
  sim.setWeather(weather);
  sim.setControlMode("adas");

  let aebWasApplied = false;
  for (let i = 0; i < 12 * 60; i++) {
    // Simulate a driver holding the accelerator to test the AEB override.
    sim.setDriverInput({ steer: 0, throttle: 1, brake: 0 });
    sim.step(dt);
    aebWasApplied ||= sim.telemetry.adas.aeb && sim.telemetry.accel <= -sim.ego.maxDecel;
  }

  const stopped = sim.path.toFrenet(sim.ego.x, sim.ego.y);
  const finalGap = wrapDiff(obstacle.s, stopped.s, sim.path.length) - (sim.ego.dims.length + obstacle.length) / 2;
  assert(aebWasApplied, `AEB did not override the held accelerator (perception=${usePerception})`);
  assert(sim.metrics.collisions === 0, `AEB contacted the stationary vehicle (perception=${usePerception}, ${sim.metrics.collisions} collision events)`);
  assert(adjacentVehicle.lane === adjacentLane, `an adjacent-lane vehicle moved into the brake test path (perception=${usePerception})`);
  assert(sim.ego.v < 0.2, `AEB did not remain stopped while throttle was held (perception=${usePerception}, ${sim.ego.v.toFixed(2)} m/s)`);
  assert(finalGap > 1, `AEB left insufficient clearance (perception=${usePerception}, ${finalGap.toFixed(2)} m)`);
  console.log(`AEB stop (${usePerception ? "sensor tracks" : "ground-truth test"}, ${weather}): ${sim.ego.v.toFixed(2)} m/s, ${finalGap.toFixed(1)} m clearance, ${sim.metrics.collisions} collisions`);
}

checkEmergencyStop(false);
checkEmergencyStop(true);
checkEmergencyStop(true, 40, 150);
checkEmergencyStop(true, 40, 150, "fog");

const scenarioSim = new Simulation();
scenarioSim.setTrafficProfile("vietnam");
scenarioSim.setScenario("stalled");
scenarioSim.setControlMode("adas");
const stalledVehicle = scenarioSim.traffic.cars.find((car) => car.kind === "stalled");
if (!stalledVehicle) throw new Error("the stalled-vehicle scenario did not create its fixed lead vehicle");
let scenarioAebApplied = false;
for (let i = 0; i < 10 * 60; i++) {
  scenarioSim.setDriverInput({ steer: 0, throttle: 1, brake: 0 });
  scenarioSim.step(dt);
  scenarioAebApplied ||= scenarioSim.telemetry.adas.aeb;
}
const scenarioEnd = scenarioSim.path.toFrenet(scenarioSim.ego.x, scenarioSim.ego.y);
const scenarioGap = wrapDiff(stalledVehicle.s, scenarioEnd.s, scenarioSim.path.length)
  - (scenarioSim.ego.dims.length + stalledVehicle.length) / 2;
assert(scenarioAebApplied, "AEB did not trigger in the named Vietnam traffic scenario");
assert(scenarioSim.metrics.collisions === 0, `named stalled scenario recorded ${scenarioSim.metrics.collisions} collisions`);
assert(scenarioSim.ego.v < 0.2, `AEB failed to hold in the named scenario (${scenarioSim.ego.v.toFixed(2)} m/s)`);
assert(scenarioGap > 1, `named scenario stopped too close to the stalled vehicle (${scenarioGap.toFixed(2)} m)`);
console.log(`Vietnam stalled scenario: ${scenarioSim.ego.v.toFixed(2)} m/s, ${scenarioGap.toFixed(1)} m clearance, 0 collisions`);

const trafficSim = new Simulation();
trafficSim.traffic.cars = [];
const ego = trafficSim.path.toFrenet(trafficSim.ego.x, trafficSim.ego.y);
const egoLane = trafficSim.road.laneOf(ego.d);
const lead = trafficSim.traffic.addTestVehicle("car", egoLane, ego.s + 28, 10, 10);
lead.changeCooldown = 0;
  trafficSim.traffic.update(0.1, { s: ego.s, d: ego.d, v: 28, length: trafficSim.ego.dims.length }, true);
assert(lead.lane === egoLane, "the lead vehicle changed lanes only to yield to the fast-closing ego");
console.log("traffic behavior: a stable lead vehicle holds its lane during an ego-only approach");

console.log("\nADAS-BRAKE-TEST PASS — simulated AEB stops before the obstacle; lead traffic does not evade the brake test.");

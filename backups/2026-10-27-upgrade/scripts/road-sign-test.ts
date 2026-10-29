// Check that posted speed-limit signs affect the classical planner target.

import { Simulation } from "../src/sim/Simulation.ts";
import { mod } from "../src/core/math.ts";

function fail(message: string): never {
  console.error("ROAD-SIGN-TEST FAIL:", message);
  process.exit(1);
}

const sim = new Simulation();
sim.setDesiredSpeed(26);
sim.traffic.cars = [];
const sign = sim.roadSigns[0];
const egoS = mod(sign.s - 50, sim.path.length);
const lane = Math.floor(sim.road.numLanes / 2);
const start = sim.path.toCartesian(egoS, sim.road.laneCenter(lane));
sim.ego.x = start.x;
sim.ego.y = start.y;
sim.ego.yaw = start.heading;
sim.ego.v = 10;

for (let i = 0; i < 10; i++) sim.step(1 / 60);
const limit = sign.valueKph / 3.6;
if (sim.planner.config.desiredSpeed > limit + 0.05) {
  fail(`planner target ${sim.planner.config.desiredSpeed.toFixed(2)} m/s ignored the ${sign.valueKph} km/h sign`);
}

console.log(`road sign: ${sign.valueKph} km/h posted limit applied to the planner target`);
console.log("\nROAD-SIGN-TEST PASS — speed limit signs affect AI Auto planning.");

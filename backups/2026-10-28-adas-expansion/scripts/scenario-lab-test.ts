// Verify scenario-lab actions create live actors in the headless simulation.

import { Simulation } from "../src/sim/Simulation.ts";
import { wrapDiff } from "../src/core/math.ts";

function fail(message: string): never {
  console.error("SCENARIO-LAB-TEST FAIL:", message);
  process.exit(1);
}

const sim = new Simulation();
sim.traffic.cars = [];
const ego = sim.path.toFrenet(sim.ego.x, sim.ego.y);
const lane = sim.road.laneOf(ego.d);

sim.addScenarioEvent("stopped-lead");
const stoppedLead = sim.traffic.cars.find((car) => car.kind === "stalled");
if (!stoppedLead || Math.abs(wrapDiff(stoppedLead.s, ego.s, sim.path.length) - 42) > 1e-6) {
  fail("stopped-lead event was not placed at the requested approach distance");
}

sim.addScenarioEvent("motorcycle-cutin");
const motorcycle = sim.traffic.cars.find((car) => car.kind === "motorcycle");
if (!motorcycle || motorcycle.cutInLane !== lane || motorcycle.cutInTimer <= 0) {
  fail("motorcycle cut-in event was not created with its target lane and delay");
}
if (motorcycle.lane === lane) fail("motorcycle should begin in an adjacent lane");

sim.addScenarioEvent("pedestrian-crossing");
if (sim.pedestrians.count !== 1) fail("pedestrian crossing event did not add a pedestrian");
sim.step(1 / 60);
if (sim.pedestrians.peds[0].state !== "crossing") fail("event pedestrian did not begin crossing");

sim.traffic.cars = [];
sim.addScenarioEvent("vehicle-crossing");
const crossing = sim.traffic.cars.find((car) => car.crossing);
if (!crossing) fail("cross-traffic event did not add a crossing vehicle");
if (crossing.kind !== "car" || crossing.v !== 0 || crossing.crossingSpeed <= 0) fail("cross-traffic vehicle has invalid motion setup");
const startD = crossing.d;
sim.usePerception = false;
sim.step(0.5);
if (Math.abs(crossing.d - startD) < 1) fail("cross-traffic vehicle did not move laterally");
const crossingObstacle = (sim as unknown as { obstacles: () => Array<{ vd: number }> }).obstacles()
  .find((obstacle) => obstacle.vd > 0);
if (!crossingObstacle) fail("crossing lateral velocity was not exposed to the planner");
for (let i = 0; i < 60; i++) sim.traffic.update(0.1, { s: ego.s, d: ego.d, v: sim.ego.v, length: 4.6 });
if (crossing.crossing || sim.traffic.cars.includes(crossing)) fail("cross-traffic vehicle did not exit after traversing the road");

sim.addScenarioEvent("motorcycle-weave");
const weavingBikes = sim.traffic.cars.filter((car) => car.kind === "motorcycle" && car.weaveRemaining > 0);
if (weavingBikes.length !== 2) fail("motorcycle-weave event did not create two scripted motorcycles");

sim.pedestrians.clear();
sim.traffic.cars = [];
sim.addScenarioEvent("bus-stop");
const eventBus = sim.traffic.cars.find((car) => car.kind === "bus");
if (!eventBus || eventBus.stopTimer <= 0 || sim.pedestrians.count !== 1) fail("bus-stop event did not create a stopped bus and crossing pedestrian");

console.log("scenario lab: stopped lead, cut-ins, crossing traffic, weaving motorcycles, and bus-stop pedestrians were created");
console.log("\nSCENARIO-LAB-TEST PASS — event tools modify the live simulation.");

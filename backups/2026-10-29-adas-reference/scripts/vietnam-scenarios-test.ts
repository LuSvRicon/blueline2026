// Verify the added Vietnam-focused scenario setups and their actor behavior.

import { Simulation } from "../src/sim/Simulation.ts";
import { EgoSnapshot } from "../src/traffic/TrafficManager.ts";

let seed = 44017;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function fail(message: string): never {
  console.error("VIETNAM-SCENARIOS-TEST FAIL:", message);
  process.exit(1);
}

function assert(condition: boolean, message: string): void {
  if (!condition) fail(message);
}

const sim = new Simulation();
sim.setTrafficProfile("vietnam");

sim.setScenario("motorcycle-weave");
const weavers = sim.traffic.cars.filter((car) => car.kind === "motorcycle" && car.weaveRemaining > 0);
assert(weavers.length === 3, "motorcycle-weave scenario should create three scripted bikes");
const initialLanes = weavers.map((bike) => bike.lane);
const ego = sim.path.toFrenet(sim.ego.x, sim.ego.y);
const egoSnapshot: EgoSnapshot = { s: ego.s, d: ego.d, v: sim.ego.v, length: 4.6 };
for (let i = 0; i < 70; i++) sim.traffic.update(1 / 60, egoSnapshot);
assert(weavers.some((bike, index) => bike.lane !== initialLanes[index] && bike.weaveRemaining < 4), "scripted motorcycles should weave between adjacent lanes");

sim.setScenario("bus-stop");
const stoppedBus = sim.traffic.cars.find((car) => car.kind === "bus" && car.stopTimer > 0);
assert(stoppedBus, "bus-stop scenario should create a scheduled bus stop");
assert(sim.pedestrians.count > 0, "bus-stop scenario should include a crossing pedestrian");
for (let i = 0; i < 60; i++) sim.step(1 / 60);
assert(stoppedBus.v === 0 && stoppedBus.stopTimer > 0, "bus should remain stopped during passenger boarding");

sim.setScenario("traffic-jam");
assert(sim.traffic.count === 9, "traffic-jam scenario should form a three-lane queue");
assert(sim.traffic.cars.every((car) => car.stopTimer > 0 && car.v === 0), "queued traffic should start stopped and release gradually");

sim.setScenario("truck-breakdown");
const brokenTruck = sim.traffic.cars.find((car) => car.kind === "truck" && car.disabled);
assert(brokenTruck && brokenTruck.v === 0, "truck-breakdown scenario should add a disabled truck");

sim.setScenario("vietnam-rush");
assert(sim.traffic.cars.filter((car) => car.kind === "motorcycle").length >= 2, "Vietnam rush should include a motorcycle-heavy flow");
assert(sim.pedestrians.count > 0 && sim.trafficLights.length > 0, "Vietnam rush should combine pedestrians and signalized intersections");

console.log("Vietnam scenarios: motorcycle weaving, bus boarding, queued congestion, disabled truck, and mixed rush hour verified");
console.log("\nVIETNAM-SCENARIOS-TEST PASS — added scenario actors behave as configured.");

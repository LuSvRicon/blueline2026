// Verify profile-specific traffic actors and the repeatable blind-spot setup.

import { Simulation } from "../src/sim/Simulation.ts";
import { TrafficProfile } from "../src/traffic/TrafficManager.ts";
import { wrapDiff } from "../src/core/math.ts";

function fail(message: string): never {
  console.error("TRAFFIC-PROFILE-TEST FAIL:", message);
  process.exit(1);
}

let seed = 2026;
Math.random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

function countKinds(profile: TrafficProfile, sim: Simulation): Record<string, number> {
  sim.setTrafficProfile(profile);
  sim.setTrafficCount(40);
  return sim.traffic.cars.reduce<Record<string, number>>((counts, car) => {
    counts[car.kind] = (counts[car.kind] ?? 0) + 1;
    return counts;
  }, {});
}

const sim = new Simulation();
const international = countKinds("international", sim);
if (international.motorcycle || international.bus) fail("international profile unexpectedly spawned Vietnam-specific vehicle kinds");

const vietnam = countKinds("vietnam", sim);
if ((vietnam.motorcycle ?? 0) < 10) fail("Vietnam profile did not create a substantial motorcycle mix");
if (!vietnam.bus || !vietnam.car) fail("Vietnam profile should include buses and passenger cars");
console.log(`Vietnam traffic: ${vietnam.motorcycle} motorcycles, ${vietnam.bus} buses, ${vietnam.car} cars, ${vietnam.truck ?? 0} trucks`);

sim.setScenario("blindspot");
const ego = sim.path.toFrenet(sim.ego.x, sim.ego.y);
const blindSpotTarget = sim.traffic.cars
  .filter((car) => wrapDiff(car.s, ego.s, sim.path.length) < -1)
  .sort((a, b) => Math.abs(wrapDiff(a.s, ego.s, sim.path.length)) - Math.abs(wrapDiff(b.s, ego.s, sim.path.length)))[0];
if (!blindSpotTarget) fail("blind-spot scenario did not place a vehicle behind the ego");
if (blindSpotTarget.kind !== "motorcycle") fail("Vietnam blind-spot scenario should use a motorcycle");
if (Math.abs(blindSpotTarget.d - ego.d) < sim.road.laneWidth * 0.7) fail("blind-spot target was not placed in an adjacent lane");

console.log("blind-spot scenario: a motorcycle starts beside and behind the ego");
console.log("\nTRAFFIC-PROFILE-TEST PASS — international and Vietnam actor profiles are distinct.");

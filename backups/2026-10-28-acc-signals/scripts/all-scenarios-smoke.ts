// Full named-scenario smoke pass: one profile-matched rollout per scenario.

import { Simulation } from "../src/sim/Simulation.ts";
import type { ScenarioName } from "../src/traffic/TrafficManager.ts";

let seed = 20261027;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const cases: { scenario: ScenarioName; profile: "international" | "vietnam" }[] = [
  { scenario: "highway", profile: "international" },
  { scenario: "dense", profile: "international" },
  { scenario: "trucks", profile: "international" },
  { scenario: "stalled", profile: "international" },
  { scenario: "cutin", profile: "international" },
  { scenario: "crossing", profile: "international" },
  { scenario: "occluded", profile: "international" },
  { scenario: "jaywalker", profile: "international" },
  { scenario: "blindspot", profile: "vietnam" },
  { scenario: "lights", profile: "international" },
  { scenario: "rush", profile: "international" },
  { scenario: "motorcycle-weave", profile: "vietnam" },
  { scenario: "bus-stop", profile: "vietnam" },
  { scenario: "traffic-jam", profile: "vietnam" },
  { scenario: "truck-breakdown", profile: "vietnam" },
  { scenario: "vietnam-rush", profile: "vietnam" },
];

for (const { scenario, profile } of cases) {
  const sim = new Simulation();
  sim.setTrafficProfile(profile);
  sim.setScenario(scenario);
  for (let step = 0; step < 1800; step++) {
    sim.step(1 / 60);
    if (![sim.ego.x, sim.ego.y, sim.ego.yaw, sim.ego.v].every(Number.isFinite)) {
      throw new Error(`${profile}/${scenario}: non-finite ego state at step ${step}`);
    }
  }
  if (sim.metrics.collisions !== 0) {
    throw new Error(`${profile}/${scenario}: ${sim.metrics.collisions} collision events`);
  }
  if (sim.metrics.offRoadTime > 0) {
    throw new Error(`${profile}/${scenario}: off-road for ${sim.metrics.offRoadTime.toFixed(2)} seconds`);
  }
  console.log(`${profile}/${scenario}: ${sim.metrics.distance.toFixed(0)} m, 0 collisions, on-road`);
}

console.log(`\nALL-SCENARIOS-SMOKE PASS — ${cases.length} named scenarios checked.`);

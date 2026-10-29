// Smoke-run the new Vietnam-focused situations through the full simulation.

import { Simulation } from "../src/sim/Simulation.ts";

let seed = 102;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const scenarios = ["motorcycle-weave", "bus-stop", "traffic-jam", "truck-breakdown", "vietnam-rush"] as const;
const dt = 1 / 60;

for (const scenario of scenarios) {
  const sim = new Simulation();
  sim.setTrafficProfile("vietnam");
  sim.setScenario(scenario);
  for (let i = 0; i < 2500; i++) sim.step(dt);

  const ego = sim.path.toFrenet(sim.ego.x, sim.ego.y);
  const offRoad = Math.abs(ego.d) >= sim.road.totalWidth / 2;
  console.log(`${scenario}: ${sim.metrics.collisions} va chạm · lệch đường ${sim.metrics.offRoadTime.toFixed(1)} giây · đi ${sim.metrics.distance.toFixed(0)} m`);
  if (!Number.isFinite(sim.ego.v) || sim.metrics.collisions > 0 || sim.metrics.offRoadTime > 0 || offRoad) {
    console.error(`VIETNAM-SCENARIO-SMOKE FAIL: ${scenario} left the drivable area or recorded a collision`);
    process.exit(1);
  }
}

console.log("\nVIETNAM-SCENARIO-SMOKE PASS — all added cases remained on-road without collisions.");

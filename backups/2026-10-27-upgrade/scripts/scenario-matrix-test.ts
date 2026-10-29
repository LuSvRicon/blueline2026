import { Simulation } from "../src/sim/Simulation.ts";
import { SCENARIOS } from "../src/ui/scenarios.ts";

// Broaden the existing one-rollout scenario check across weather and controllers.
const vietnam = new Set(["blindspot", "motorcycle-weave", "bus-stop", "traffic-jam", "truck-breakdown", "vietnam-rush"]);
const failures: string[] = [];
let checked = 0;
for (const { id } of SCENARIOS) {
  for (const mode of ["classical", "adas"] as const) {
    for (const weather of ["clear", "rain", "fog"] as const) {
      const sim = new Simulation({ seed: 20261027 });
      sim.setTrafficProfile(vietnam.has(id) ? "vietnam" : "international");
      sim.setControlMode(mode);
      sim.setScenario(id);
      sim.setWeather(weather);
      let finite = true;
      for (let frame = 0; frame < 20 * 60; frame++) {
        sim.step(1 / 60);
        if (![sim.ego.x, sim.ego.y, sim.ego.yaw, sim.ego.v].every(Number.isFinite)) { finite = false; break; }
      }
      checked++;
      if (!finite || sim.metrics.collisions || sim.metrics.offRoadTime > 0) {
        failures.push(`${id}/${mode}/${weather}: finite=${finite}, collisions=${sim.metrics.collisions}, offRoad=${sim.metrics.offRoadTime.toFixed(2)}s`);
      }
    }
  }
  console.log(`${id}: 2 controllers × 3 weather conditions checked`);
}
if (failures.length) throw new Error(`SCENARIO-MATRIX FAIL (${failures.length}/${checked}):\n${failures.join("\n")}`);
console.log(`SCENARIO-MATRIX PASS — ${checked} deterministic 20-second rollouts, finite state, no ego collisions or road departures.`);
